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
  /* o.requested: one request filed apart, accepted by a person's decision, then landed by the recorder's window as an application. */
  if (o.requested) {
    const T = PF.todos, rp = app.files('runs/release-notes/').find(p => /run\.json$/.test(p)), r0 = PF.run.sanitize(JSON.parse(app.fs.files[rp].t)), RUN = { process: r0.process, id: r0.id }, at = new Date().toISOString();
    const d = await PF.repo.loadAll(app.fs, {}), V = T.view(r0, { records: d.todos || [], people });
    const body = { op: 'add', text: 'Requested one', target: { phase: 'draft' }, placement: T.placementFor(PF.run.mapOf(r0), { phase: 'draft' }) };
    const q = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'k-req001'), by: 'person-avery', seen: V.heads.slice(0, 50), at, body, app: '4.0.0' });
    await app.fs.write('proposals/' + q.id + '.json', T.text(q));
    const rec = T.cleanFile(JSON.parse(T.text(q)), q.id + '.json').record, V2 = T.view(r0, { records: (d.todos || []).concat([rec]), people });
    const C = T.consequenceOf(r0, V2.map, V2.requests[q.id], V2).fingerprint;
    const st = T.buildStatus({ kind: 'decision', proposal: q.id, run: RUN, seen: [q.id], by: 'person-avery', at, op: 'accept', consequence: C, writer: 'w1', rev: '0000a001', app: '4.0.0' });
    await app.fs.write('proposals/' + st.name, T.text(st.file));
    app.click('refresh'); await app.tick(500); app.click('refresh'); await app.tick(400);
    o.request = { proposal: 'proposals/' + q.id + '.json', decision: 'proposals/' + st.name };
  }
  if (o.end !== false) { app.click('end', 'Cancelled'); await app.tick(300); }
  const runPath = app.files('runs/release-notes/').find(p => /run\.json$/.test(p)), r = JSON.parse(app.fs.files[runPath].t);
  const files = {}; Object.keys(app.fs.files).forEach(p => { files[p] = app.fs.files[p].t; });
  return { PF, files, key: r.process + '/' + r.id, run: r, runPath, request: o.request || null };
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

rule('A malformed to-do record naming a run that isn\'t living yet makes its pack partial, by the record\'s path and kind; Python agrees', async () => {
  const W = await made({ todos: 0 });
  const bad = 'proposals/req-flightdeck-' + 'c'.repeat(24) + '.json';
  W.files[bad] = JSON.stringify({ format: 'flightdeck-plan/4', features: ['living-runs'], kind: 'proposal', run: { process: W.run.process, id: W.run.id } });
  const fsx = new BytesFS(W.files), { zip, res } = await pack(W.PF, fsx, W.key);
  assert.deepStrictEqual(fsx.mutations, []);
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  const L = manifestOf(zip).runs[0].living;
  assert.ok(L && !L.complete, 'a living section that isn\'t complete');
  assert.ok(L.missing.some(m => m.indexOf(bad) === 0 && /\(malformed\)/.test(m)), JSON.stringify(L.missing));
  if (PY) { const c = checkPack(zip); assert.ok(c.ok && /living 1/.test(c.out), c.out); }
  /* A malformed record naming another run leaves this one's pack as in 3.0. */
  const W2 = await made({ todos: 0 });
  W2.files[bad] = JSON.stringify({ format: 'flightdeck-plan/4', features: ['living-runs'], kind: 'proposal', run: { process: W2.run.process, id: 'someone-else' } });
  const two = await pack(W2.PF, new BytesFS(W2.files), W2.key);
  assert.strictEqual(manifestOf(two.zip).runs[0].living, undefined);
});

rule('A pack needs each application\'s request and the decision that authorized it: either gone makes it partial by path, and Python refuses a complete claim without them', async () => {
  const W = await made({ requested: true });
  const ap = Object.keys(W.files).find(p => p === 'proposals/' + W.run.living.head + '.json'), a = JSON.parse(W.files[ap]);
  assert.deepStrictEqual([a.kind, a.proposal + '', !!(a.authority && a.authority.decision)], ['application', W.request.proposal.slice('proposals/'.length, -5), true], 'set-up: a separate application');
  const full = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  for (const gone of [W.request.proposal, W.request.decision]) {
    const files = Object.assign({}, W.files); delete files[gone];
    const { zip, res } = await pack(W.PF, new BytesFS(files), W.key);
    assert.strictEqual(res.status, 'partial', gone + ': ' + JSON.stringify(res.col.unresolved));
    const L = manifestOf(zip).runs[0].living;
    assert.ok(!L.complete && L.missing.some(m => m.indexOf(gone) === 0), gone + ': ' + JSON.stringify(L.missing));
    if (PY) { const c = checkPack(zip); assert.ok(c.ok, c.out); }
  }
  if (!PY) return;
  for (const gone of [W.request.proposal, W.request.decision]) {
    const e = unzip(full.zip), man = JSON.parse(e['manifest.json']), f = man.files.filter(x => x.path === gone)[0];
    assert.ok(f, 'set-up: packed ' + gone);
    delete e[f.pack]; man.files = man.files.filter(x => x !== f);
    e['manifest.json'] = Buffer.from(JSON.stringify(man, null, 2) + '\n');
    const bad = checkPack(await rezip(W.PF, e));
    assert.ok(!bad.ok && /request|authority|saw/.test(bad.out), gone + ': ' + bad.out);
  }
});

/* ---- GB: one bounded closure over every run the work depends on: loop children, evidence runs, fulfillment parents ---- */
const KID = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-avery', '---', '',
  '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
/* A loop parent with a to-do, and one story run with a to-do of its own (living, its own application chain). */
async function loopMade() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '4.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(KID, 'validate-story', 'vs000001'); put(PARENT, 'release-readiness', 'rr000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  const pPath = app.files('runs/release-readiness/').find(p => /run\.json$/.test(p)), kPath = app.files('runs/validate-story/').find(p => /run\.json$/.test(p));
  assert.ok(pPath && kPath, 'set-up: a parent and a story run');
  const P0 = JSON.parse(app.fs.files[pPath].t), K0 = JSON.parse(app.fs.files[kPath].t);
  for (const [r, text] of [[K0, 'Check the story'], [P0, 'Post the release notes']]) {
    app.click('open-run', r.process + '/' + r.id); await app.tick(80);
    app.set('td-add', text); app.click('td-add'); await app.tick(120); app.click('refresh'); await app.tick(400);
  }
  const P = JSON.parse(app.fs.files[pPath].t), K = JSON.parse(app.fs.files[kPath].t);
  assert.ok(P.living && K.living && K.living.head, 'set-up: both are living');
  const files = {}; Object.keys(app.fs.files).forEach(p => { files[p] = app.fs.files[p].t; });
  return { PF, files, key: P.process + '/' + P.id, run: P, kid: K, kidPath: kPath, kidKey: K.process + '/' + K.id };
}
const failing = (fsx, test, code) => { const list = fsx.list.bind(fsx), read = fsx.read.bind(fsx), e = () => Object.assign(new Error(code + ': it can\'t be read'), { code });
  fsx.list = (p) => test('list', p) ? Promise.reject(e()) : list(p); fsx.read = (p, o) => test('read', p) ? Promise.reject(e()) : read(p, o); return fsx; };

rule('A loop child\'s own work is in the parent\'s pack: its run, its chain and its records, named as a dependency; Python accepts it', async () => {
  const W = await loopMade(), { zip, res } = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(res.status, 'complete', JSON.stringify(res.col.unresolved));
  const man = manifestOf(zip), L = man.runs[0].living, paths = man.files.map(f => f.path);
  assert.ok(paths.indexOf(W.kidPath) >= 0 && paths.indexOf('proposals/' + W.kid.living.head + '.json') >= 0, 'the child and its head application');
  assert.ok((L.deps || []).some(d => d.key === W.kidKey && d.role === 'child' && d.chain && d.chain[d.chain.length - 1] === W.kid.living.head), JSON.stringify(L.deps));
  if (PY) { const c = checkPack(zip); assert.ok(c.ok, c.out); }
});

rule('A loop child with a missing application makes the parent\'s pack partial by its path; Python refuses a complete claim without it', async () => {
  const W = await loopMade(), ap = 'proposals/' + W.kid.living.head + '.json';
  const full = await pack(W.PF, new BytesFS(W.files), W.key);
  const files = Object.assign({}, W.files); delete files[ap];
  const { zip, res } = await pack(W.PF, new BytesFS(files), W.key);
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some(u => u.indexOf(ap) >= 0), JSON.stringify(res.col.unresolved));
  if (PY) { const c = checkPack(zip); assert.ok(c.ok, c.out); }
  if (!PY) return;
  const e = unzip(full.zip), man = JSON.parse(e['manifest.json']), f = man.files.filter(x => x.path === ap)[0];
  assert.ok(f, 'set-up: packed');
  delete e[f.pack]; man.files = man.files.filter(x => x !== f);
  e['manifest.json'] = Buffer.from(JSON.stringify(man, null, 2) + '\n');
  const bad = checkPack(await rezip(W.PF, e));
  assert.ok(!bad.ok && bad.out.indexOf(W.kidKey) >= 0, bad.out);
});

rule('Two different copies of a link in the chain (a compound) make the pack ambiguous by path; Python refuses a complete claim with both packed', async () => {
  const W = await made({ todos: 1 }), head = W.run.living.head, ap = 'proposals/' + head + '.json', o = JSON.parse(W.files[ap]);
  assert.strictEqual(o.kind, 'compound', 'set-up: the recorder\'s own add is a compound');
  o.at = new Date(Date.parse(o.at) + 1000).toISOString();
  const files = Object.assign({}, W.files, { ['proposals/' + head + ' (1).json']: JSON.stringify(o, null, 2) + '\n' });
  const { zip, res } = await pack(W.PF, new BytesFS(files), W.key);
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some(u => u.indexOf(ap) >= 0 && /two different copies/.test(u)), JSON.stringify(res.col.unresolved));
  if (!PY) return;
  const e = unzip(zip), man = JSON.parse(e['manifest.json']);
  assert.ok(man.files.some(f => f.path === 'proposals/' + head + ' (1).json'), 'both copies are packed');
  man.status = 'complete'; man.runs[0].living.complete = true; man.runs[0].living.missing = [];
  e['manifest.json'] = Buffer.from(JSON.stringify(man, null, 2) + '\n');
  const bad = checkPack(await rezip(W.PF, e));
  assert.ok(!bad.ok && /cop/.test(bad.out), bad.out);
});

rule('A child folder that can\'t be listed, a child run.json missing or one that can\'t be read makes the pack partial, by path and kind', async () => {
  const W = await loopMade(), dir = W.kidPath.replace(/run\.json$/, '');
  const cases = [
    ['listing', (f) => failing(f, (op, p) => op === 'list' && p === 'runs/validate-story', 'EIO'), 'runs/validate-story', 'unreadable'],
    ['missing', (f) => f, W.kidPath, 'missing'],
    ['read', (f) => failing(f, (op, p) => op === 'read' && p === W.kidPath, 'EIO'), W.kidPath, 'unreadable']
  ];
  for (const [what, wrap, path, kind] of cases) {
    const files = Object.assign({}, W.files);
    if (what === 'missing') { delete files[W.kidPath]; files[dir + 'notes.txt'] = 'kept'; }
    const { zip, res } = await pack(W.PF, wrap(new BytesFS(files)), W.key);
    assert.strictEqual(res.status, 'partial', what + ': ' + JSON.stringify(res.col.unresolved));
    assert.ok(res.col.unresolved.some(u => u.indexOf(path) >= 0 && u.indexOf('(' + kind + ')') >= 0), what + ': ' + JSON.stringify(res.col.unresolved));
    if (PY) { const c = checkPack(zip); assert.ok(c.ok, what + ': ' + c.out); }
  }
});

rule('An evidence run that is malformed makes the pack partial by its path and kind, never packed as confirmed', async () => {
  const W = await made({ todos: 1 }), PF = W.PF, T = PF.todos, r = PF.run.sanitize(JSON.parse(JSON.stringify(W.run)));
  const d = await PF.repo.loadAll(new BytesFS(W.files), {}), V = T.view(r, { records: d.todos || [], people: JSON.parse(W.files['people.json']) });
  const td = Object.keys(V.byTodo || {})[0] || (V.todos && V.todos[0] && V.todos[0].id);
  assert.ok(td, 'set-up: a to-do');
  const ev = { plan: 'plan-ev-' + 'a'.repeat(24), run: { process: 'release-notes', id: 'evrun1' }, answer: 'Yes', result: '' };
  const q = T.buildProposal({ run: { process: r.process, id: r.id }, id: PF.detours.requestId(td, ev), by: 'person-avery', seen: V.heads.slice(0, 50), at: new Date().toISOString(), body: { op: 'done', todo: td, evidence: ev }, app: '4.0.0' });
  const files = Object.assign({}, W.files, { ['proposals/' + q.id + '.json']: T.text(q), 'runs/release-notes/evrun1/run.json': '{ broken' });
  assert.ok(T.cleanFile(JSON.parse(T.text(q)), q.id + '.json').ok, 'set-up: the done request reads');
  const { zip, res } = await pack(PF, new BytesFS(files), W.key);
  assert.strictEqual(res.status, 'partial');
  assert.ok(res.col.unresolved.some(u => u.indexOf('runs/release-notes/evrun1/run.json') >= 0 && /\((malformed|unreadable)\)/.test(u)), JSON.stringify(res.col.unresolved));
  const L = manifestOf(zip).runs[0].living;
  assert.ok(!(L.deps || []).some(x => x.key === 'release-notes/evrun1' && x.confirmed), 'never confirmed');
  if (PY) { const c = checkPack(zip); assert.ok(c.ok, c.out); }
});

/* ---- IB, IC: the full run verdict for every dependency, a complete and byte-exact walk, every durable reference ---- */
/* Packed entries rewritten, with the manifest's hashes made to match: only the readers' own checks can then refuse it. */
async function repacked(PF, zip, edit) {
  const e = unzip(zip), man = JSON.parse(e['manifest.json']);
  edit(e, man, (path) => man.files.filter(x => x.path === path)[0]);
  man.files.forEach((f) => { if (e[f.pack]) { f.sha256 = sha(e[f.pack]); f.size = e[f.pack].length; } });
  e['manifest.json'] = Buffer.from(JSON.stringify(man, null, 2) + '\n');
  return rezip(PF, e);
}
rule('A dependency run with a time the app can\'t read is judged as run judges it: the pack is partial by its path; Python refuses a complete claim with it', async () => {
  const W = await loopMade();
  const full = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  for (const [what, damage] of [['created', (k) => { k.created = 'bad'; }], ['log', (k) => { k.log[0].at = 'bad'; }]]) {
    const files = Object.assign({}, W.files), k = JSON.parse(files[W.kidPath]); damage(k); files[W.kidPath] = JSON.stringify(k, null, 2);
    const { res } = await pack(W.PF, new BytesFS(files), W.key);
    assert.strictEqual(res.status, 'partial', what + ': ' + JSON.stringify(res.col.unresolved));
    assert.ok(res.col.unresolved.some(u => u.indexOf(W.kidPath) >= 0 && /\(malformed\)/.test(u)), what + ': ' + JSON.stringify(res.col.unresolved));
    if (!PY) continue;
    const bad = checkPack(await repacked(W.PF, full.zip, (e, man, f) => { const x = f(W.kidPath), o = JSON.parse(e[x.pack]); damage(o); e[x.pack] = Buffer.from(JSON.stringify(o, null, 2)); }));
    assert.ok(!bad.ok && bad.out.indexOf(W.kidKey) >= 0 && /times/.test(bad.out), what + ': ' + bad.out);
  }
});

run();
