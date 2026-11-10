// Evidence packs for living runs (4.0, docs/design.md 45.5), slice 6: a pack of a run with to-dos holds every record its work
// rests on (the application chain from living.head, its requests and decisions, the receipt it ended with), or says it is
// partial and names what is missing. An independent reader (test/check_pack.py, Python) replays the chain from the packed
// run.json and refuses a pack that calls itself complete without it. A run with no to-dos is packed exactly as in 3.0, and
// making a pack never writes to the folder.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');
const { BytesFS } = require('./evidence-fixture');

const MD = ['---', 'process: release-notes', 'title: Release notes', 'owner: person-avery', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} Read them {#read}', ''].join('\n');
function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* next */ } } return null; }
const PY = python();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* A folder made through the app: a run, with to-dos landed when todos > 0, ended (with its receipt when living). */
async function made(o) {
  o = o || {};
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const b = PF.publish.build(MD, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand: 'rn000001', app: '4.0.0' });
  Object.keys(b.files).forEach(k => { app.fs.files['publications/release-notes/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-notes'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  for (let i = 0; i < (o.todos || 0); i++) { app.set('td-add', 'To-do ' + (i + 1)); app.click('td-add'); await app.tick(120); app.click('refresh'); await app.tick(400); }
  if (o.end !== false) { app.click('end', 'Cancelled'); await app.tick(300); }
  const runPath = app.files('runs/release-notes/').find(p => /run\.json$/.test(p)), r = JSON.parse(app.fs.files[runPath].t);
  const files = {}; Object.keys(app.fs.files).forEach(p => { files[p] = app.fs.files[p].t; });
  return { PF, files, key: r.process + '/' + r.id, run: r, runPath };
}
async function pack(PF, fsx, key) {
  const parts = [];
  const res = await PF.repo.exportEvidence(fsx, { run: key }, { sink: u => { parts.push(Buffer.from(u)); }, now: () => Date.now(), tz: 'UTC' });
  return { zip: Buffer.concat(parts), res };
}
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), n = buf.readUInt16LE(eocd + 10), out = {};
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8'), lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
    out[name] = buf.slice(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    p += 46 + nl + xl + cl;
  }
  return out;
}
/* The same entries zipped again (a manifest edited, SHA256SUMS made to match): only the living check can then refuse it. */
async function rezip(PF, entries) {
  const parts = [], w = PF.zip.writer({ sink: u => { parts.push(Buffer.from(u)); }, date: new Date() });
  const names = Object.keys(entries).filter(n => n !== 'SHA256SUMS').sort();
  const sums = names.map(n => sha(entries[n]) + '  ' + n).join('\n') + '\n';
  for (const n of names) await w.add(n, new Uint8Array(entries[n]));
  await w.add('SHA256SUMS', new Uint8Array(Buffer.from(sums)));
  await w.finish();
  return Buffer.concat(parts);
}
function checkPack(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-living-')), file = path.join(dir, 'pack.zip');
  fs.writeFileSync(file, zip);
  try { return { ok: true, out: cp.execFileSync(PY, ['-I', path.join(__dirname, 'check_pack.py'), file], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { ok: false, out: String(e.stdout) + String(e.stderr) }; }
}
const manifestOf = (zip) => JSON.parse(unzip(zip)['manifest.json'].toString('utf8'));

rule('A living run\'s pack holds its whole application chain and its receipt, says so, and writes nothing to the folder', async () => {
  const W = await made({ todos: 2 }), fsx = new BytesFS(W.files);
  const { zip, res } = await pack(W.PF, fsx, W.key);
  assert.deepStrictEqual(fsx.mutations, [], 'zero folder writes');
  assert.strictEqual(res.status, 'complete', JSON.stringify(res.col.unresolved));
  const man = manifestOf(zip), mr = man.runs[0], L = mr.living;
  assert.ok(L && L.complete, 'living, complete');
  assert.strictEqual(L.head, W.run.living.head);
  assert.strictEqual(L.chain[L.chain.length - 1], W.run.living.head, 'head last');
  assert.strictEqual(L.chain.length, 2, 'two applications');
  assert.deepStrictEqual([L.receipt.state, L.receipt.id], ['confirmed', W.run.living.receipt]);
  const packed = man.files.map(f => f.path);
  Object.keys(W.files).filter(p => /^proposals\/req-/.test(p)).forEach(p => assert.ok(packed.indexOf(p) >= 0, p + ' is in the pack'));
  assert.ok(man.files.filter(f => f.role === 'living').length >= 3 && man.files.some(f => f.path === 'proposals/' + W.run.living.receipt + '.json'), 'the requests with their applications, and the receipt');
  const page = unzip(zip)['evidence.html'].toString('utf8');
  assert.ok(/Everything the run's work rests on is in this pack/.test(page.replace(/&#39;/g, "'").replace(/\\'/g, "'")), 'said on the page');
});

rule('Python replays the chain from the packed run.json: it accepts the pack, and refuses one that calls itself complete without a link', async () => {
  if (!PY) return console.log('  (skipped: no Python)');
  const W = await made({ todos: 2 }), { zip } = await pack(W.PF, new BytesFS(W.files), W.key);
  const good = checkPack(zip);
  assert.ok(good.ok && /^ok \d+ entries/.test(good.out) && /living 1/.test(good.out), good.out);
  /* The first application taken out, the manifest still saying the work is complete. */
  const e = unzip(zip), man = JSON.parse(e['manifest.json']), first = man.runs[0].living.chain[0], f = man.files.filter(x => x.path === 'proposals/' + first + '.json')[0];
  delete e[f.pack]; man.files = man.files.filter(x => x !== f);
  e['manifest.json'] = Buffer.from(JSON.stringify(man, null, 2) + '\n');
  const bad = checkPack(await rezip(W.PF, e));
  assert.ok(!bad.ok && /chain/.test(bad.out), bad.out);
  /* The receipt rewritten to another outcome: it no longer says what the run ended with. */
  const e2 = unzip(zip), man2 = JSON.parse(e2['manifest.json']), rf = man2.files.filter(x => x.path === 'proposals/' + W.run.living.receipt + '.json')[0];
  const rec = JSON.parse(e2[rf.pack]); rec.outcome = 'Completed'; e2[rf.pack] = Buffer.from(JSON.stringify(rec, null, 2) + '\n'); rf.sha256 = sha(e2[rf.pack]); rf.size = e2[rf.pack].length;
  e2['manifest.json'] = Buffer.from(JSON.stringify(man2, null, 2) + '\n');
  const bad2 = checkPack(await rezip(W.PF, e2));
  assert.ok(!bad2.ok && /receipt/.test(bad2.out), bad2.out);
});

rule('An application missing from the folder makes the pack partial, named by its path; Python agrees', async () => {
  const W = await made({ todos: 2 });
  const head = W.run.living.head, ap = 'proposals/' + head + '.json';
  assert.ok(W.files[ap], 'set-up: the head is a file');
  delete W.files[ap];
  const { zip, res } = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(res.status, 'partial');
  assert.ok(res.col.unresolved.some(u => u.indexOf(ap) >= 0), JSON.stringify(res.col.unresolved));
  const L = manifestOf(zip).runs[0].living;
  assert.ok(!L.complete && L.missing.some(m => m.indexOf(ap) >= 0));
  if (PY) { const c = checkPack(zip); assert.ok(c.ok, c.out); }
});

rule('A receipt the run names that isn\'t in the folder makes the pack partial', async () => {
  const W = await made({ todos: 1 });
  delete W.files['proposals/' + W.run.living.receipt + '.json'];
  const { res } = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(res.status, 'partial');
  assert.ok(res.col.unresolved.some(u => /receipt/.test(u) && u.indexOf(W.run.living.receipt) >= 0), JSON.stringify(res.col.unresolved));
});

rule('A to-do record that can\'t be read makes the pack partial, named by its path', async () => {
  const W = await made({ todos: 1 });
  W.files['proposals/req-flightdeck-broken-0123456789abcdef01234567.json'] = '{ "format": "flightdeck-plan/4"';
  const { res } = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(res.status, 'partial');
  assert.ok(res.col.unresolved.some(u => u.indexOf('req-flightdeck-broken-0123456789abcdef01234567') >= 0), JSON.stringify(res.col.unresolved));
});

rule('A to-do record that keeps changing while the pack is made leaves it partial, never claiming what it can\'t check', async () => {
  const W = await made({ todos: 1 });
  const target = Object.keys(W.files).filter(p => /^proposals\/req-flightdeck-/.test(p) && !/\.status-/.test(p))[0];
  let n = 0;
  const fsx = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === target) { const o = JSON.parse(x.files.get(p).toString('utf8')); o.at = new Date(Date.parse(o.at) + (++n) * 1000).toISOString(); x.files.set(p, Buffer.from(JSON.stringify(o, null, 2) + '\n')); } } } });
  const { res } = await pack(W.PF, fsx, W.key);
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.deepStrictEqual(fsx.mutations, []);
});

rule('A run with no to-dos is packed exactly as in 3.0: no living section, nothing from proposals/', async () => {
  const W = await made({ todos: 0 });
  const { zip, res } = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(res.status, 'complete', JSON.stringify(res.col.unresolved));
  const man = manifestOf(zip);
  assert.strictEqual(man.runs[0].living, undefined);
  assert.ok(!man.files.some(f => /^proposals\//.test(f.path)));
  if (PY) { const c = checkPack(zip); assert.ok(c.ok && /living 0/.test(c.out), c.out); }
});

rule('A pending request on a run that isn\'t living yet is packed and named, before the run gains living', async () => {
  const W = await made({ todos: 0, end: false });
  const PF = W.PF, T = PF.todos, r = PF.run.sanitize(JSON.parse(JSON.stringify(W.run)));
  const p = T.buildProposal({ run: { process: r.process, id: r.id }, id: T.idFor('flightdeck', 'k-0a1b2c'), by: 'person-blake', seen: [], at: new Date().toISOString(), body: { op: 'add', text: 'Waiting one', target: { phase: 'draft' }, placement: T.placementFor(PF.run.mapOf(r), { phase: 'draft' }) }, app: '4.0.0' });
  W.files['proposals/' + p.id + '.json'] = T.text(p);
  const { zip } = await pack(PF, new BytesFS(W.files), W.key);
  const man = manifestOf(zip);
  assert.ok(man.runs[0].living, 'a living section');
  assert.strictEqual(man.runs[0].living.head, '');
  assert.ok(man.files.some(f => f.path === 'proposals/' + p.id + '.json' && f.role === 'living'));
});

run();
