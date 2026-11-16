// Evidence packs for living runs (4.0, docs/design.md 45.5), slice 6: a pack of a run with to-dos holds every record its work
// rests on (the application chain from living.head, its requests and decisions, the receipt it ended with), or says it is
// partial and names what is missing. An independent reader (test/check_pack.py, Python) replays the chain from the packed
// run.json and refuses a pack that calls itself complete without it. A run with no to-dos is packed exactly as in 3.0, and
// making a pack never writes to the folder.
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { rule, run } = require('./harness');
const { BytesFS } = require('./evidence-fixture');
const { made, pack, datePack, SHOT, loopMade, factMade, evidenceMade, spreadMade, rereceipt, roleWorlds, PY, sha, unzip, rezip, checkPack, manifestOf, repacked, forced } = require('./living-worlds');

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
/* A read fails the same whether it comes through read() or blob() (the export's checked reads take a file's bytes). */
const failing = (fsx, test, code) => { const list = fsx.list.bind(fsx), read = fsx.read.bind(fsx), blob = fsx.blob.bind(fsx), e = () => Object.assign(new Error(code + ': it can\'t be read'), { code });
  fsx.list = (p) => test('list', p) ? Promise.reject(e()) : list(p); fsx.read = (p, o) => test('read', p) ? Promise.reject(e()) : read(p, o); fsx.blob = (p, o) => test('read', p) ? Promise.reject(e()) : blob(p, o); return fsx; };

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

/* A manifest made to claim the work complete and its receipt confirmed, as the export said of a receipt resting on copies
   that differ before review round 2: Python's own walk must still find the copies. */
const claimed = (man) => { forced(man); man.runs.forEach((x) => { if (x.living && x.living.receipt && x.living.receipt.state !== 'none') { x.living.receipt.state = 'confirmed'; x.living.receipt.why = ''; } }); };
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
  claimed(man);
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

rule('A chain of 70 runs, each fulfilling the next one\'s spread, is walked to its end: every one packed and named; Python agrees', async () => {
  const W = await made({ todos: 1 }), PF = W.PF, T = PF.todos, base = JSON.parse(W.files[W.runPath]), files = Object.assign({}, W.files), N = 70;
  const ids = Array.from({ length: N }, (_, i) => 'dep-' + (i + 1));
  const hex = (i) => crypto.createHash('sha256').update('s' + i).digest('hex').slice(0, 24);
  const file = (from, to, i) => {
    const r = PF.run.sanitize(JSON.parse(files[W.runPath]));
    const body = { op: 'add', text: 'Covered ' + i, target: { phase: 'draft' }, placement: T.placementFor(PF.run.mapOf(r), { phase: 'draft' }), fulfills: { run: { process: base.process, id: to }, spread: 'sp-' + hex(i), uid: 'jira.issue:key:ABC-' + (i + 1), attempt: 1 } };
    const q = T.buildProposal({ run: { process: base.process, id: from }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-ch' + i, seen: [], at: new Date().toISOString(), body });
    assert.ok(T.cleanFile(JSON.parse(T.text(q)), q.id + '.json').ok, 'set-up: request ' + i + ' reads: ' + JSON.stringify(T.cleanFile(JSON.parse(T.text(q)), q.id + '.json')));
    files['proposals/' + q.id + '.json'] = T.text(q);
  };
  ids.forEach((id, i) => { const o = Object.assign({}, base, { id }); delete o.living; delete o.ended; o.state = 'running'; if (Array.isArray(o.features)) o.features = o.features.filter(f => f !== 'living-runs'); files['runs/' + base.process + '/' + id + '/run.json'] = JSON.stringify(o, null, 2); });
  file(base.id, ids[0], 0);
  ids.slice(0, -1).forEach((id, i) => file(id, ids[i + 1], i + 1));
  const { zip, res } = await pack(PF, new BytesFS(files), W.key);
  assert.strictEqual(res.status, 'complete', JSON.stringify(res.col.unresolved).slice(0, 2000));
  const man = manifestOf(zip), L = man.runs[0].living, keys = (L.deps || []).map(d => d.key);
  ids.forEach((id) => { assert.ok(keys.indexOf(base.process + '/' + id) >= 0, id + ' is named'); assert.ok(man.files.some(f => f.path === 'runs/' + base.process + '/' + id + '/run.json'), id + ' is packed'); });
  if (PY) { const c = checkPack(zip); assert.ok(c.ok, c.out); }
});

rule('A dependency run changed between the checked read and the bytes packed, at the same length, leaves the pack partial', async () => {
  const W = await loopMade(), t = W.files[W.kidPath], i = t.indexOf('"title": "') + 10;
  let n = 0;
  const swap = (x) => { const b = x.files.get(W.kidPath).toString('utf8'); const c = b.charAt(i) === 'Q' ? 'R' : 'Q'; x.files.set(W.kidPath, Buffer.from(b.slice(0, i) + c + b.slice(i + 1))); };
  const fsx = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === W.kidPath && n++ === 1) swap(x); } } });
  const { zip, res } = await pack(W.PF, fsx, W.key);
  assert.ok(n >= 1, 'set-up: the bytes changed before the capture');
  /* The change is seen (RC: discovery's own read is held to its bytes): captured again, so what is packed is what was judged,
     or the pack is partial naming it. Never complete with bytes other than the ones judged. */
  if (res.status === 'complete') {
    const e = unzip(zip), man = manifestOf(zip), f = man.files.filter((x) => x.path === W.kidPath)[0];
    assert.ok(res.col.attempts > 1, 'captured again: ' + res.col.attempts);
    assert.ok(f && e[f.pack].equals(fsx.files.get(W.kidPath)), 'the bytes packed are the run as it is now');
  } else assert.ok(res.col.unresolved.some(u => u.indexOf(W.kidPath) >= 0 && /changed/.test(u)), JSON.stringify(res.col.unresolved));
});

rule('A pending request the receipt names as seen, deleted later, leaves the pack partial by its path; Python refuses a complete claim without it', async () => {
  const W = await made({ todos: 1, pending: true }), PF = W.PF, id = W.pendingId;
  assert.ok(W.run.ended && W.run.living.receipt, 'set-up: ended with a receipt');
  const rec = JSON.parse(W.files['proposals/' + W.run.living.receipt + '.json']);
  assert.ok(rec.seen.indexOf(id) >= 0, 'set-up: the receipt names the pending request: ' + JSON.stringify(rec.seen));
  const full = await pack(PF, new BytesFS(W.files), W.key);
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  const files = Object.assign({}, W.files); delete files['proposals/' + id + '.json'];
  const { res } = await pack(PF, new BytesFS(files), W.key);
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some(u => u.indexOf('proposals/' + id + '.json') >= 0), JSON.stringify(res.col.unresolved));
  if (!PY) return;
  const bad = checkPack(await repacked(PF, full.zip, (e, man, f) => { const x = f('proposals/' + id + '.json'); delete e[x.pack]; man.files = man.files.filter(y => y !== x); }));
  assert.ok(!bad.ok && /receipt/.test(bad.out), bad.out);
});

rule('The shared collector follows a loop item\'s choice and a spread\'s binding to the runs they name: one that can\'t be read is named', async () => {
  const W = await loopMade(), PF = W.PF, self = PF.run.sanitize(JSON.parse(JSON.stringify(W.run)));
  const scope = { id: 'req-flightdeck-' + 'f'.repeat(24), _file: 'req-flightdeck-' + 'f'.repeat(24) + '.json', loop: { process: self.process, run: self.id, step: 'each' }, changes: [{ op: 'choose', run: 'chosen-1' }] };
  const bind = { id: 'req-flightdeck-' + 'e'.repeat(24), _file: 'req-flightdeck-' + 'e'.repeat(24) + '.json', kind: 'proposal', run: { process: self.process, id: self.id }, op: 'spread-bind', dest: { process: 'validate-story', id: 'bound-1' } };
  const D = PF.receipts.deps(self, { records: [bind], scopes: [scope], runs: Object.create(null), runBad: [{ key: 'validate-story/chosen-1', path: 'runs/validate-story/chosen-1/run.json', kind: 'missing', why: 'it isn\'t in the folder' }] });
  const keys = D.runs.map(x => x.process + '/' + x.id);
  assert.ok(keys.indexOf('validate-story/chosen-1') >= 0 && keys.indexOf('validate-story/bound-1') >= 0, JSON.stringify(D.runs));
  assert.ok(D.missing.some(m => m.indexOf('runs/validate-story/chosen-1/run.json (missing)') === 0), JSON.stringify(D.missing));
  assert.ok(D.toRead.some(x => x.id === 'bound-1'), 'the bound run is read next');
});

/* KB: a proposal or scope record packed is the one the checked read judged, byte for byte: a change that keeps the cleaned
   record (whitespace) or keeps the length ("4.0.0" to "4.0.1") still leaves the pack partial, by its path. */
for (const [name, edit] of [['the app version, at the same length', (b) => b.replace('"app": "4.0.0"', '"app": "4.0.1"')], ['whitespace only, at the same length', (b) => b.replace(/\n$/, ' ')]]) {
  rule('A to-do record changed between the checked read and the bytes packed (' + name + ') leaves the pack partial', async () => {
    const W = await made({ todos: 1 });
    const target = Object.keys(W.files).filter(p => /^proposals\/req-flightdeck-/.test(p) && !/\.status-/.test(p))[0];
    const t = W.files[target], c = edit(t);
    assert.ok(c !== t && Buffer.byteLength(c) === Buffer.byteLength(t), 'set-up: the edit keeps the length');
    let n = 0;
    const fsx = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === target && n++ === 1) x.files.set(p, Buffer.from(c)); } } });
    const { res } = await pack(W.PF, fsx, W.key);
    assert.ok(n >= 1, 'set-up: the bytes changed before the capture');
    assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
    assert.ok(res.col.unresolved.some(u => u.indexOf(target) >= 0 && /changed/.test(u)), JSON.stringify(res.col.unresolved));
  });
}

/* KC: what a receipt names as seen is walked as the chain's records are, through what each of those saw in turn: a pending
   request whose own seen names a record not in the pack can't be called complete. */
rule('A record the receipt saw is walked through what it saw: Python refuses a complete claim when a record that one saw isn\'t in the pack', async () => {
  if (!PY) return;
  const W = await made({ todos: 1, pending: true }), PF = W.PF, id = W.pendingId;
  const full = await pack(PF, new BytesFS(W.files), W.key);
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  const ok = checkPack(full.zip); assert.ok(ok.ok, ok.out);
  const gone = 'req-flightdeck-' + '9'.repeat(24);
  const bad = checkPack(await repacked(PF, full.zip, (e, man, f) => { const x = f('proposals/' + id + '.json'), o = JSON.parse(e[x.pack]); o.seen = [gone]; e[x.pack] = Buffer.from(JSON.stringify(o, null, 2) + '\n'); }));
  assert.ok(!bad.ok && /saw/.test(bad.out), bad.out);
});

/* ---- KA: one complete run verdict wherever a dependency is judged: judgeRun, the export and Python agree ---- */
/* Each run the work depends on, in each role (a loop child, a run whose spread a request fulfills, a run a to-do was done on),
   damaged one field at a time: the readers' verdict (readRunOnly, then PF.appjson.judgeRun) names it, the export is partial
   by its path, and Python refuses a pack that calls itself complete with it. */
const DAMAGES = [
  ['created', (k) => { k.created = 'bad'; }],
  ['savedAt', (k) => { k.savedAt = 'bad'; }],
  ['a log time', (k) => { k.log = [{ at: 'bad', by: 'person-avery', what: 'x' }].concat(k.log || []); }],
  ['an ended time', (k) => { k.ended = { outcome: 'Completed', by: 'person-avery', at: 'bad' }; }],
  ['a pause', (k) => { k.pauses = [{ from: 'bad', to: new Date().toISOString(), by: 'person-avery' }]; }],
  ['title', (k) => { k.title = 42; }],
  ['state', (k) => { k.state = 'banana'; }],
  ['followUps text', (k) => { k.followUps = 'broken'; }],
  ['followUps entry', (k) => { k.followUps = [null]; }],
  ['the active pause', (k) => { k.state = 'running'; delete k.ended; k.paused = { by: 'person-avery', at: 'bad', reason: 'x' }; }],
  ['rev', (k) => { k.rev = -1; }],
  ['marks list', (k) => { k.marks = { assess: 'blocked' }; }],
  ['marks value', (k) => { k.marks = { assess: ['banana'] }; }]
];
async function verdicts(X, files) {
  const [proc, id] = X.depKey.split('/');
  const one = await X.PF.repo.readRunOnly(new BytesFS(files), proc, id);
  const judged = one.run ? X.PF.appjson.judgeRun(one.run, one.pub) : (one.bad || []);
  const { zip, res } = await pack(X.PF, new BytesFS(files), X.key);
  return { judged, res, zip, named: res.col.unresolved.filter(u => u.indexOf(X.path) >= 0) };
}

rule('One complete run verdict for every dependency: each damaged field, in each role, is named by judgeRun, the export and Python alike', async () => {
  const misses = [];
  for (const X of await roleWorlds()) {
    const ok = await verdicts(X, X.files);
    assert.strictEqual(ok.judged.length, 0, X.role + ' control: ' + JSON.stringify(ok.judged));
    assert.strictEqual(ok.named.length, 0, X.role + ' control: ' + JSON.stringify(ok.res.col.unresolved));
    assert.ok(ok.zip.length && manifestOf(ok.zip).files.some(f => f.path === X.path), X.role + ': the dependency is packed');
    if (PY) { const c = checkPack(X.force ? await repacked(X.PF, ok.zip, (e, man) => forced(man)) : ok.zip); assert.ok(c.ok, X.role + ' control: ' + c.out); }
    for (const [what, damage] of DAMAGES) {
      const files = Object.assign({}, X.files), k = JSON.parse(files[X.path]); damage(k); files[X.path] = JSON.stringify(k, null, 2);
      const v = await verdicts(X, files), tag = X.role + ' / ' + what + ': ';
      if (!v.judged.length) misses.push(tag + 'judgeRun doesn\'t name it');
      if (v.res.status !== 'partial' || !v.named.length) misses.push(tag + 'the export doesn\'t name it: ' + JSON.stringify(v.res.col.unresolved).slice(0, 300));
      if (!PY) continue;
      const bad = checkPack(await repacked(X.PF, ok.zip, (e, man, f) => { const x = f(X.path), o = JSON.parse(e[x.pack]); damage(o); e[x.pack] = Buffer.from(JSON.stringify(o, null, 2)); if (X.force) forced(man); }));
      if (bad.ok || bad.out.indexOf(X.depKey) < 0) misses.push(tag + 'Python doesn\'t refuse it: ' + bad.out.trim().slice(0, 300));
    }
  }
  assert.strictEqual(misses.length, 0, misses.join('\n'));
});

rule('A dependency run whose version can\'t be read (EIO) is named by the version\'s path, and the pack is partial before anything is confirmed', async () => {
  const W = await loopMade(), k = JSON.parse(W.files[W.kidPath]), dir = 'publications/' + k.process + '/' + k.folder + '/';
  const { zip, res } = await pack(W.PF, failing(new BytesFS(W.files), (op, p) => op === 'read' && p.indexOf(dir) === 0, 'EIO'), W.key);
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some(u => u.indexOf(dir) >= 0 && /\(unreadable\)/.test(u)), JSON.stringify(res.col.unresolved));
  const L = manifestOf(zip).runs[0].living;
  assert.ok(!(L.deps || []).some(d => d.key === W.kidKey && d.confirmed), 'never confirmed: ' + JSON.stringify(L.deps));
});

/* LD: the checked read of proposals/ that fails is named, and the pack is partial, whether or not the run is living yet. */
rule('proposals/ that can\'t be read is named and the pack partial, for a run with a pending request that isn\'t living yet; Python agrees', async () => {
  const W = await made({ todos: 0, end: false });
  const PF = W.PF, T = PF.todos, r = PF.run.sanitize(JSON.parse(JSON.stringify(W.run)));
  const p = T.buildProposal({ run: { process: r.process, id: r.id }, id: T.idFor('flightdeck', 'k-0a1b2d'), by: 'person-blake', seen: [], at: new Date().toISOString(), body: { op: 'add', text: 'Waiting one', target: { phase: 'draft' }, placement: T.placementFor(PF.run.mapOf(r), { phase: 'draft' }) }, app: '4.0.0' });
  W.files['proposals/' + p.id + '.json'] = T.text(p);
  const { zip, res } = await pack(PF, failing(new BytesFS(W.files), (op, q) => op === 'list' && q === 'proposals', 'EIO'), W.key);
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some(u => u.indexOf('proposals/') >= 0), JSON.stringify(res.col.unresolved));
  if (PY) { const c = checkPack(zip); assert.ok(c.ok, c.out); }
});

/* LB: an evidence plan packed is the bytes the checked read judged (its SHA-256), and Python reads the packed plan as a plan. */
rule('An evidence plan changed between the checked read and the bytes packed, at the same length, leaves the pack partial; Python refuses a plan that isn\'t one', async () => {
  const X = (await roleWorlds()).filter(w => w.role === 'evidence')[0], PF = X.PF;
  const [proc, id] = X.key.split('/'), one = await PF.repo.readRunOnly(new BytesFS(X.files), proc, id);
  const planId = 'plan-ev-' + 'a'.repeat(24), path = 'proposals/' + planId + '.json';
  const plan = PF.plans.make(one.pub, { id: planId, process: proc, title: 'Evidence plan', from: X.key, by: 'person-avery', created: new Date().toISOString() }, true, '4.0.0');
  const files = Object.assign({}, X.files, { [path]: JSON.stringify(plan, null, 2) + '\n' });
  const full = await pack(PF, new BytesFS(files), X.key);
  assert.ok(manifestOf(full.zip).files.some(f => f.path === path), 'set-up: the evidence plan is packed: ' + JSON.stringify(full.res.col.unresolved));
  const t = files[path];
  const misses = [];
  for (const [what, a, b] of [['the app version', '"app": "4.0.0"', '"app": "4.0.1"'], ['the title', 'Evidence plan', 'Evidence slam'], ['the pinned version', '"version": 1', '"version": 0']]) {
    if (t.indexOf(a) < 0) { misses.push(what + ': set-up: not in the plan: ' + t.slice(0, 400)); continue; }
    const c = t.replace(a, b);
    let n = 0;
    const fsx = new BytesFS(files, { hooks: { blob: (p, x) => { if (p === path && n++ === 1) x.files.set(p, Buffer.from(c)); } } });
    const { res } = await pack(PF, fsx, X.key);
    if (!(n >= 1 && res.col.unresolved.some(u => u.indexOf(path) >= 0 && /changed/.test(u)))) misses.push(what + ': the export doesn\'t name it: ' + JSON.stringify(res.col.unresolved).slice(0, 300));
  }
  if (PY) {
    const bad = checkPack(await repacked(PF, full.zip, (e, man, f) => { const x = f(path), o = JSON.parse(e[x.pack]); o.pin.version = 0; e[x.pack] = Buffer.from(JSON.stringify(o, null, 2) + '\n'); forced(man); }));
    if (bad.ok || bad.out.indexOf(path) < 0) misses.push('Python accepts a packed plan that isn\'t one: ' + bad.out.trim());
    const ok = checkPack(await repacked(PF, full.zip, (e, man) => forced(man)));
    if (!ok.ok) misses.push('Python refuses the plan as made: ' + ok.out.trim());
  }
  assert.strictEqual(misses.length, 0, misses.join('\n'));
});

/* LC: the version behind each dependency's verdict is packed and held to the bytes judged: one changed during capture is named. */
rule('A dependency\'s version is packed with the bytes its verdict read: a publication.json changed during capture leaves the pack partial', async () => {
  const W = await loopMade(), k = JSON.parse(W.files[W.kidPath]), dir = 'publications/' + k.process + '/' + k.folder + '/', pub = dir + 'publication.json';
  const full = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  const paths = manifestOf(full.zip).files.map(f => f.path);
  ['map.md', 'types.json', 'publication.json'].forEach(n => assert.ok(paths.indexOf(dir + n) >= 0, dir + n + ' is packed: ' + JSON.stringify(paths)));
  if (PY) { const c = checkPack(full.zip); assert.ok(c.ok, c.out); }
  let n = 0;
  const fsx = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === pub && n++ === 1) { const b = x.files.get(p).toString('utf8'); x.files.set(p, Buffer.from('[' + b.slice(1))); } } } });
  const { res } = await pack(W.PF, fsx, W.key);
  assert.ok(n >= 1, 'set-up: the bytes changed before the capture');
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some(u => u.indexOf(pub) >= 0 && /changed/.test(u)), JSON.stringify(res.col.unresolved));
  if (!PY) return;
  const bad = checkPack(await repacked(W.PF, full.zip, (e, man, f) => { const x = f(pub); e[x.pack] = Buffer.from('[' + e[x.pack].toString('utf8').slice(1)); }));
  assert.ok(!bad.ok && bad.out.indexOf(W.kidKey) >= 0, bad.out);
});

/* LF: Python holds the closure to the same one bound as the export: every original reached and every dependency run, together,
   at most 5,000. A chain of records seen in turn that no single queue takes past the bound still crosses it in total. */
/* NE: a loop's children are found where the run's own checklist sends them, its Fill in included (R.fieldsOf), as the
   ending guard finds them: a child folder under the process Fill in set that can't be read is named, and the pack is partial. */
rule('Export finds a loop\'s children through the run\'s effective checklist: after Fill in changes the loop\'s process, a child there that can\'t be read is named', async () => {
  const W = await loopMade(), files = Object.assign({}, W.files), pPath = 'runs/' + W.key + '/run.json', P = JSON.parse(files[pPath]);
  P.fields = Object.assign({}, P.fields, { each: { process: 'check-story' } });
  files[pPath] = JSON.stringify(P, null, 2);
  files['runs/check-story/cs-1/run.json'] = '{ "format": "preflight-run/3", ';
  const { res } = await pack(W.PF, new BytesFS(files), W.key);
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some((u) => u.indexOf('runs/check-story/cs-1/run.json') >= 0), JSON.stringify(res.col.unresolved));
});

rule('Python counts every record reached and every dependency run together against the one 5,000 bound', async () => {
  if (!PY) return;
  const W = await made({ todos: 1, pending: true }), PF = W.PF, id = W.pendingId;
  const full = await pack(PF, new BytesFS(W.files), W.key);
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  /* A chain of N requests the app reads, each seeing the next (built from the last), the pending request seeing the first. */
  const T = PF.todos, r0 = JSON.parse(W.files[W.runPath]), RUN = { process: r0.process, id: r0.id }, at = new Date().toISOString();
  const placement = T.placementFor(PF.run.mapOf(PF.run.sanitize(JSON.parse(JSON.stringify(r0)))), { phase: 'review' });
  const chainOf = (N) => { const out = []; let next = null; for (let i = N - 1; i >= 0; i--) { const q = T.buildProposal({ run: RUN, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-lf' + N + '-' + i, seen: next ? [next] : [], at, body: { op: 'add', text: 'Chained ' + i, target: { phase: 'review' }, placement } }); out.unshift([q.id, T.text(q)]); next = q.id; } return out; };
  const make = (N) => repacked(PF, full.zip, (e, man, f) => {
    const x = f('proposals/' + id + '.json'), o = JSON.parse(e[x.pack]), recs = chainOf(N);
    o.seen = N ? [recs[0][0]] : [];
    e[x.pack] = Buffer.from(JSON.stringify(o, null, 2) + '\n');
    recs.forEach(([rid, text]) => {
      const path = 'proposals/' + rid + '.json', pk = x.pack.slice(0, x.pack.length - x.path.length) + path;
      e[pk] = Buffer.from(text);
      man.files.push(Object.assign({}, x, { path, pack: pk }));
    });
  });
  /* Under the bound, an honest folder: the chain in it, and the receipt made again counting those requests (a receipt's
     claims are replayed against its work, so the repacked one would no longer say what the run ended with). */
  const recs10 = chainOf(10), files10 = Object.assign({}, W.files), pp = 'proposals/' + id + '.json', po = JSON.parse(files10[pp]);
  po.seen = [recs10[0][0]]; files10[pp] = JSON.stringify(po, null, 2) + '\n';
  recs10.forEach(([rid, text]) => { files10['proposals/' + rid + '.json'] = text; });
  const honest10 = await pack(PF, new BytesFS(rereceipt(W, (ev) => ev, (rc) => { rc.counts.asked += 10; rc.counts.pending += 10; rc.counts.waiting += 10; }, files10)), W.key);
  assert.strictEqual(honest10.res.status, 'complete', JSON.stringify(honest10.res.col.unresolved));
  const small = checkPack(honest10.zip);
  assert.ok(small.ok, 'under the bound it holds: ' + small.out);
  const over = checkPack(await make(4998));
  assert.ok(!over.ok && /more|bound|holds at most/.test(over.out), 'over the bound in total: ' + over.out);
});

/* NG: Python counts what the export counts (PF.receipts.deps): every record naming a run the work rests on, whether or not
   anything saw it, with the records reached and the dependency runs, against the one 5,000 bound. */
rule('Python counts every record on the run, seen or not, toward the 5,000 bound, as the export does: 5,000 independent requests refuse both', async () => {
  const W = await made({ todos: 1, pending: true }), PF = W.PF, T = PF.todos, r0 = JSON.parse(W.files[W.runPath]), RUN = { process: r0.process, id: r0.id };
  const placement = T.placementFor(PF.run.mapOf(PF.run.sanitize(JSON.parse(JSON.stringify(r0)))), { phase: 'review' }), at = new Date().toISOString(), made5k = [];
  for (let i = 0; i < 5000; i++) { const q = T.buildProposal({ run: RUN, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-ng' + i, seen: [], at, body: { op: 'add', text: 'Independent ' + i, target: { phase: 'review' }, placement } }); made5k.push([q.id, T.text(q)]); }
  const ids = (N) => made5k.slice(0, N).map((x) => x[0]), texts = {}; made5k.forEach((x) => { texts[x[0]] = x[1]; });
  const rec = (rid) => texts[rid];
  const files = Object.assign({}, W.files);
  ids(5000).forEach((rid) => { files['proposals/' + rid + '.json'] = rec(rid); });
  let refused = null;
  try { const x = await pack(PF, new BytesFS(files), W.key); refused = x.res.status !== 'complete' ? JSON.stringify(x.res).slice(0, 300) : null; } catch (e) { refused = String(e && e.message || e); }
  assert.ok(refused && /at most 5000|holds at most/.test(refused), 'the export refuses it: ' + refused);
  if (!PY) return;
  const full = await pack(PF, new BytesFS(W.files), W.key);
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  const make = (N) => repacked(PF, full.zip, (e, man) => {
    const x = man.files.filter((f) => /^proposals\//.test(f.path))[0];
    ids(N).forEach((rid) => {
      const path = 'proposals/' + rid + '.json', pk = x.pack.slice(0, x.pack.length - x.path.length) + path;
      e[pk] = Buffer.from(rec(rid));
      man.files.push(Object.assign({}, x, { path, pack: pk }));
    });
  });
  const small = checkPack(await make(10));
  assert.ok(small.ok, 'under the bound it holds: ' + small.out);
  const over = checkPack(await make(5000));
  assert.ok(!over.ok && /holds at most/.test(over.out), 'over the bound in total: ' + over.out);
});

/* NF: a loop's scope records are walked through what they saw, as every other record the work rests on, in the export and in
   Python; and Python requires each evidence plan the work's records name, by reference, never from the manifest's labels. */
rule('A scope record\'s seen is in the closure: a missing predecessor leaves the pack partial, and Python refuses a complete claim without it', async () => {
  const W = await loopMade(), sp = Object.keys(W.files).find((p) => /^proposals\/req-/.test(p) && JSON.parse(W.files[p]).loop);
  assert.ok(sp, 'set-up: a scope record');
  const files = Object.assign({}, W.files), o = JSON.parse(files[sp]), gone = 'req-flightdeck-' + '0'.repeat(24);
  o.seen = [gone]; files[sp] = JSON.stringify(o, null, 2);
  const { res, zip } = await pack(W.PF, new BytesFS(files), W.key);
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some((u) => u.indexOf('proposals/' + gone + '.json') >= 0), JSON.stringify(res.col.unresolved));
  if (!PY) return;
  const bad = checkPack(await repacked(W.PF, zip, (e, man) => forced(man)));
  assert.ok(!bad.ok && /scope|saw/.test(bad.out), 'Python refuses: ' + bad.out);
  const full = await pack(W.PF, new BytesFS(W.files), W.key);
  const ok = checkPack(full.zip);
  assert.ok(ok.ok, 'the control holds: ' + ok.out);
});
/* PD: the export's reads of proposals/ and of the runs the work depends on go through the size-checked, budget-counted
   reader: a file over the one-file limit is never read (its size is known first), and what is read counts in the memory the
   pack may use. */
rule('The export reads proposals/ and the runs its work depends on within the size and memory budgets: nothing over the limit is read', async () => {
  const W = await loopMade(), MAX = 1048576, big = 'proposals/plan-big.json';
  const files = Object.assign({}, W.files, { [big]: JSON.stringify({ kind: 'plan', id: 'plan-big', pad: 'x'.repeat(2 * MAX) }) });
  const stats = new Set(), over = [];
  let readBytes = 0;
  const fsx = new BytesFS(files, { hooks: {
    stat: (p) => { stats.add(p); },
    read: (p, x) => { const b = x.files.get(p); if (!b) return; if (/^(proposals|runs)\//.test(p)) readBytes += b.length; if (b.length > MAX) over.push(p + ' (' + b.length + ' bytes)'); if (/^proposals\//.test(p) && !stats.has(p)) over.push(p + ' read before its size was known'); }
  } });
  const parts = [], res = await W.PF.repo.exportEvidence(fsx, { run: W.key }, { sink: (u) => { parts.push(Buffer.from(u)); }, now: () => Date.now(), tz: 'UTC', maxFile: MAX });
  assert.deepStrictEqual(over, [], 'nothing over the limit is read, and every proposal is sized first');
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some((u) => u.indexOf(big) >= 0), 'named by its path: ' + JSON.stringify(res.col.unresolved));
  assert.ok(res.col.retained && res.col.retained.peak >= readBytes, 'what was read is counted: peak ' + (res.col.retained && res.col.retained.peak) + ' of ' + readBytes + ' bytes read');
  const ctl = await W.PF.repo.exportEvidence(new BytesFS(W.files), { run: W.key }, { sink: () => {}, now: () => Date.now(), tz: 'UTC', maxFile: MAX });
  assert.strictEqual(ctl.status, 'complete', 'the control holds: ' + JSON.stringify(ctl.col.unresolved));
});
/* Review round 1 (PR #114): a run's loop children are looked for among a bounded number of run folders. The loop's process
   is listed once (never again per run read there), people.json and follow-up decisions aren't read for it, and each version is
   read once; past the bound the end and the export are refused, named, before any run folder there is read. */
rule('Loop children are looked for among a bounded number of run folders: each process listed once, and past the bound nothing there is read', async () => {
  const W = await loopMade(), PF = W.PF, P = PF.run.sanitize(JSON.parse(W.files['runs/' + W.key + '/run.json'])), K = JSON.parse(W.files[W.kidPath]), kidDir = W.kidPath.replace(/\/[^/]+\/run\.json$/, '');
  const N = 2000, files = Object.assign({}, W.files);
  for (let i = 0; i < N; i++) { const id = 'u' + String(i).padStart(5, '0'), o = JSON.parse(JSON.stringify(K)); o.id = id; o.parent = Object.assign({}, o.parent, { id: 'another-run' }); files[kidDir + '/' + id + '/run.json'] = JSON.stringify(o, null, 2); }
  const count = () => { const c = { lists: {}, reads: {} }; return { c, hooks: { list: (p) => { c.lists[p] = (c.lists[p] || 0) + 1; }, read: (p) => { c.reads[p] = (c.reads[p] || 0) + 1; } } }; };
  const a = count(), got = await PF.repo.readLoopChildren(new BytesFS(files, { hooks: a.hooks }), P);
  assert.strictEqual(JSON.stringify(got.runs.map((r) => r.process + '/' + r.id)), JSON.stringify([W.kidKey]), 'the one child is found among ' + (N + 1) + ' run folders');
  assert.strictEqual(got.unread.length, 0, 'the other runs are read whole: ' + JSON.stringify(got.unread[0]));
  assert.strictEqual(a.c.lists[kidDir], 1, 'the process is listed once, not once per run: ' + a.c.lists[kidDir]);
  assert.strictEqual(a.c.reads['people.json'] || 0, 0, 'people.json isn\'t read for discovery');
  assert.strictEqual(a.c.lists.followups || 0, 0, 'follow-up decisions aren\'t listed for discovery');
  const runReads = Object.keys(a.c.reads).filter((p) => /^runs\/.*\/run\.json$/.test(p)), twice = Object.keys(a.c.reads).filter((p) => a.c.reads[p] > 1 && /^publications\//.test(p));
  assert.strictEqual(runReads.length, N + 1, 'each run there is read once');
  assert.deepStrictEqual(twice, [], 'each version\'s files are read once for all its runs');
  /* Past the bound: refused, named, before a single run folder there is read. */
  const b = count();
  let why = '';
  try { await PF.repo.readLoopChildren(new BytesFS(files, { hooks: b.hooks }), P, { cap: N }); } catch (e) { why = String(e && e.message || e); }
  assert.ok(/hold 2001 run folders; its loop children are looked for among at most 2000, so none of them was read/.test(why), why);
  assert.ok(why.indexOf(kidDir + '/') >= 0, 'the folder is named: ' + why);
  assert.deepStrictEqual(Object.keys(b.c.reads).filter((p) => /^runs\//.test(p)), [], 'no run folder there was read');
  /* The export, at the shipped bound (CHILD_SCAN): run folders past it, never opened, refuse the pack by name. */
  const many = Object.assign({}, W.files);
  for (let i = 0; i < PF.repo.CHILD_SCAN; i++) many[kidDir + '/x' + String(i).padStart(5, '0') + '/run.json'] = '{}';
  const e = count();
  let refused = null;
  try { const x = await pack(PF, new BytesFS(many, { hooks: e.hooks }), W.key); refused = x.res.status !== 'complete' ? JSON.stringify(x.res).slice(0, 600) : null; } catch (err) { refused = String(err && err.message || err); }
  assert.ok(refused && /its loop children are looked for among at most 5000/.test(refused), 'the export refuses it: ' + refused);
  assert.deepStrictEqual(Object.keys(e.c.reads).filter((p) => p.indexOf(kidDir + '/x') === 0), [], 'none of those run folders was read');
});
/* RB: the closure's reads reserve what they may hold before each starts, so reads in flight together never take the pack past
   its memory: a read that doesn't fit is refused by name, and the pack is partial. */
rule('Closure reads in flight together stay within the memory a pack may use: each reserves before it starts', async () => {
  for (const [n, size, cap] of [[4, 200000, 1048576], [8, 80000, 524288]]) {
    const W = await loopMade(), files = Object.assign({}, W.files);
    for (let i = 0; i < n; i++) files['proposals/plan-pad' + i + '.json'] = ' '.repeat(size) + JSON.stringify({ kind: 'plan', id: 'plan-pad' + i, process: 'release-readiness', title: 'Padded ' + i });
    const res = await W.PF.repo.exportEvidence(new BytesFS(files), { run: W.key }, { sink: () => {}, now: () => Date.now(), tz: 'UTC', cap });
    assert.ok(res.col.retained && res.col.retained.peak <= cap, n + ' reads of ' + size + ' bytes: peak ' + (res.col.retained && res.col.retained.peak) + ' within ' + cap);
    assert.ok(res.status === 'complete' || res.col.unresolved.length, 'a pack that isn\'t complete says why');
  }
});
/* PE: the listings the export verifies are the ones its checked reads made (proposals/, each dependency run's folder, each
   loop's child-process folder), listed again at the end: a request, a conflict copy or a child arriving meanwhile is never
   missed by a pack that says it is complete. */
rule('A request arriving after the checked read of proposals/ is never missing from a pack that says it is complete', async () => {
  const W = await made({ todos: 1, end: false }), PF = W.PF, T = PF.todos, r0 = PF.run.sanitize(JSON.parse(W.files[W.runPath]));
  const q = T.buildProposal({ run: { process: r0.process, id: r0.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-late1', seen: [], at: new Date().toISOString(), body: { op: 'add', text: 'Arrived late', target: { phase: 'review' }, placement: T.placementFor(PF.run.mapOf(r0), { phase: 'review' }) } });
  const qp = 'proposals/' + q.id + '.json';
  let n = 0;
  const fsx = new BytesFS(W.files, { hooks: { list: (p, x) => { if (p === 'proposals' && ++n === 2) x.files.set(qp, Buffer.from(T.text(q))); } } });
  const { zip, res } = await pack(PF, fsx, W.key);
  assert.ok(n >= 2, 'set-up: proposals/ listed again');
  const packed = manifestOf(zip).files.some((f) => f.path === qp);
  assert.ok(packed || (res.status === 'partial' && res.col.unresolved.some((u) => /proposals/.test(u))), 'packed, or the pack is partial naming proposals/: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
});
rule('A conflict copy or a new child arriving beside a dependency during capture is seen: the pack never says complete without it', async () => {
  const W = await loopMade(), dir = W.kidPath.replace(/run\.json$/, ''), late = dir + 'run.conflict-late.json';
  let n = 0;
  const fsx = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === W.kidPath && n++ === 1) x.files.set(late, Buffer.from(W.files[W.kidPath])); } } });
  const { zip, res } = await pack(W.PF, fsx, W.key);
  assert.ok(n >= 1, 'set-up: the copy arrived during capture');
  const dep = (manifestOf(zip).runs[0].living.deps || []).filter((d) => d.key === W.kidKey)[0];
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(!dep || !dep.confirmed, 'the dependency isn\'t confirmed');
  assert.ok(res.col.unresolved.some((u) => u.indexOf(W.kidKey) >= 0), 'named: ' + JSON.stringify(res.col.unresolved));
  /* A new child of the loop, arriving after its process's folder was listed. */
  const K = JSON.parse(W.files[W.kidPath]), kid2 = Object.assign({}, K, { id: 'late-kid1' }), kp2 = 'runs/' + K.process + '/late-kid1/run.json';
  let m = 0;
  const fsy = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === W.kidPath && m++ === 1) x.files.set(kp2, Buffer.from(JSON.stringify(kid2, null, 2))); } } });
  const two = await pack(W.PF, fsy, W.key), L2 = manifestOf(two.zip).runs[0].living;
  assert.ok(m >= 1, 'set-up: the child arrived during capture');
  const named = (L2.deps || []).some((d) => d.key === K.process + '/late-kid1') || two.res.col.unresolved.some((u) => u.indexOf('late-kid1') >= 0 || u.indexOf('runs/' + K.process) >= 0);
  assert.ok(named || two.res.status === 'partial', 'the new child is in the closure, or the pack is partial: ' + two.res.status + ' ' + JSON.stringify(two.res.col.unresolved));
});
/* RC: the discovery listings are kept and listed again on every path, a run with no to-dos yet included, and every run
   discovery read is held to its bytes, one it left out (another parent's child) included. */
rule('A first request arriving during capture on a run with no to-dos yet is never missing from a complete pack', async () => {
  const W = await made({ todos: 0, end: false }), PF = W.PF, T = PF.todos, r0 = PF.run.sanitize(JSON.parse(W.files[W.runPath]));
  const q = T.buildProposal({ run: { process: r0.process, id: r0.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-first1', seen: [], at: new Date().toISOString(), body: { op: 'add', text: 'The first one', target: { phase: 'review' }, placement: T.placementFor(PF.run.mapOf(r0), { phase: 'review' }) } });
  const qp = 'proposals/' + q.id + '.json';
  /* It arrives right after the checked read listed proposals/ (as that read sizes the one file there). */
  let n = 0;
  const files = Object.assign({}, W.files, { 'proposals/plan-other.json': JSON.stringify({ kind: 'plan', id: 'plan-other', process: 'other', title: 'Another plan' }) });
  const fsx = new BytesFS(files, { hooks: { stat: (p, x) => { if (/^proposals\//.test(p) && !n++) x.files.set(qp, Buffer.from(T.text(q))); } } });
  const { zip, res } = await pack(PF, fsx, W.key);
  assert.ok(n >= 1, 'set-up: it arrived after the listing');
  const packed = manifestOf(zip).files.some((f) => f.path === qp);
  assert.ok(packed || (res.status === 'partial' && res.col.unresolved.some((u) => /proposals/.test(u))), 'packed, or the pack is partial naming proposals/: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
});
rule('A run discovery left out (another parent\'s child) that becomes this run\'s child during capture is never missed', async () => {
  const W = await loopMade(), K = JSON.parse(W.files[W.kidPath]), other = Object.assign({}, K, { id: 'other-kid', parent: Object.assign({}, K.parent, { id: 'someone-else' }) });
  const op = 'runs/' + K.process + '/other-kid/run.json', mine = JSON.stringify(Object.assign({}, other, { parent: K.parent }), null, 2);
  const files = Object.assign({}, W.files, { [op]: JSON.stringify(other, null, 2) });
  let n = 0;
  const fsx = new BytesFS(files, { hooks: { blob: (p, x) => { if (p === W.kidPath && n++ === 1) x.files.set(op, Buffer.from(mine)); } } });
  const { zip, res } = await pack(W.PF, fsx, W.key);
  assert.ok(n >= 1, 'set-up: its parent changed during capture');
  const L = manifestOf(zip).runs[0].living, named = (L.deps || []).some((d) => d.key === K.process + '/other-kid');
  assert.ok(named || (res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf('other-kid') >= 0)), 'in the closure, or named: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
});
/* PF: whether a run's work is verified is worked out from the packed originals, never from the manifest alone: a run.json that
   names a work head or a receipt, or a packed to-do record on the run, needs the manifest's living section. */
rule('Python works out from the packed run.json whether its work is checked: the living section deleted with every record it rests on is refused', async () => {
  if (!PY) return;
  const W = await made({ todos: 2 }), { zip } = await pack(W.PF, new BytesFS(W.files), W.key);
  const ok = checkPack(zip);
  assert.ok(ok.ok && /living 1/.test(ok.out), 'the control holds: ' + ok.out);
  const strip = (all) => repacked(W.PF, zip, (e, man) => {
    delete man.runs[0].living;
    if (all) man.files.filter((f) => /^proposals\//.test(f.path)).forEach((f) => { delete e[f.pack]; });
    if (all) man.files = man.files.filter((f) => !/^proposals\//.test(f.path));
  });
  const bad = checkPack(await strip(true));
  assert.ok(!bad.ok && /living/.test(bad.out) && bad.out.indexOf(W.key) >= 0, 'Python refuses it: ' + bad.out);
  const bad2 = checkPack(await strip(false));
  assert.ok(!bad2.ok && /living/.test(bad2.out), 'the section deleted alone is refused too: ' + bad2.out);
});
/* PB: Python requires each fact a to-do record rests on (support.fact), by that reference, as NF does for evidence plans: a
   fact removed from the pack, with a manifest made to match, is refused. */
rule('Python requires every fact the work\'s records rest on: a fact removed from the pack, with a manifest made to match, is refused', async () => {
  if (!PY) return;
  const W = await loopMade(), PF = W.PF, T = PF.todos, F = PF.facts, P = PF.run.sanitize(JSON.parse(JSON.stringify(W.run)));
  const got = await PF.repo.readTodos(new BytesFS(W.files)), V = T.view(P, { records: got.records, people: JSON.parse(W.files['people.json']) });
  const x = Object.keys(V.byTodo).map((k) => V.byTodo[k])[0], item = PF.loop.view(P, 'each', { records: got.scopes, runs: [P], procOf: () => null }).rollup.items[0];
  assert.ok(x && item, 'set-up: a to-do and a loop item');
  const at = new Date().toISOString(), BB = { feed: 'bitbucket', site: 'git.example.com' };
  const f = F.build({ run: P, producer: { name: 'git-bot', version: '1.0' }, key: 'prs-1', seen: [], at, app: '4.0.0', loopStep: 'each', uid: item.uid, attempt: 1, source: BB, domain: 'prs', observedAt: at, maxAgeSeconds: 86400, complete: true, reported: 1, fetched: 1, errors: [], entries: [{ id: '1', text: 'Change 1', state: 'merged' }] });
  const fr = T.cleanFile(JSON.parse(T.text(f)), f.id + '.json').record;
  const q = T.buildProposal({ run: { process: P.process, id: P.id }, producer: { name: 'git-bot', version: '1.0' }, seen: [], at, body: { op: 'done', todo: x.id, support: { fact: f.id, content: fr.content, incarnation: x.added, source: BB, domain: 'prs' } } });
  const fp = 'proposals/' + f.id + '.json', files = Object.assign({}, W.files, { [fp]: T.text(f), ['proposals/' + q.id + '.json']: T.text(q) });
  const full = await pack(PF, new BytesFS(files), W.key);
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  assert.ok(manifestOf(full.zip).files.some((y) => y.path === fp), 'set-up: the fact is packed');
  const ok = checkPack(full.zip);
  assert.ok(ok.ok, 'the control holds: ' + ok.out);
  const bad = checkPack(await repacked(PF, full.zip, (e, man, g) => { const y = g(fp); delete e[y.pack]; man.files = man.files.filter((z) => z.path !== fp); forced(man); }));
  assert.ok(!bad.ok && bad.out.indexOf(f.id) >= 0, 'Python refuses it: ' + bad.out);
});
/* PC: a scope record that saw another is followed to it through the same witness index as every to-do record: a valid second
   scope record leaves the pack complete, and Python accepts it. */
rule('A second scope record that saw the first keeps the pack complete: scope records are witnesses too', async () => {
  const W = await loopMade(), sp = Object.keys(W.files).find((p) => /^proposals\/req-/.test(p) && JSON.parse(W.files[p]).loop);
  assert.ok(sp, 'set-up: a scope record');
  const files = Object.assign({}, W.files), first = JSON.parse(files[sp]), id = 'req-flightdeck-' + 'c'.repeat(24);
  const second = Object.assign({}, first, { id, seen: [first.id], created: new Date(Date.parse(first.created) + 1000).toISOString(), changes: [{ op: 'add', item: { id: '', key: 'ABC-102', title: '' } }], children: [] });
  files['proposals/' + id + '.json'] = JSON.stringify(second, null, 2) + '\n';
  const { res, zip } = await pack(W.PF, new BytesFS(files), W.key);
  assert.strictEqual(res.status, 'complete', JSON.stringify(res.col.unresolved));
  const packed = manifestOf(zip).files.map((f) => f.path);
  assert.ok(packed.indexOf(sp) >= 0 && packed.indexOf('proposals/' + id + '.json') >= 0, 'both scope records are packed');
  if (!PY) return;
  const c = checkPack(zip);
  assert.ok(c.ok, c.out);
});
rule('Python requires every evidence plan the work\'s records name: a plan removed from the pack, with a manifest made to match, is refused', async () => {
  if (!PY) return;
  const X = (await roleWorlds()).filter(w => w.role === 'evidence')[0], PF = X.PF;
  const [proc, id] = X.key.split('/'), one = await PF.repo.readRunOnly(new BytesFS(X.files), proc, id);
  const planId = 'plan-ev-' + 'a'.repeat(24), path = 'proposals/' + planId + '.json';
  const plan = PF.plans.make(one.pub, { id: planId, process: proc, title: 'Evidence plan', from: X.key, by: 'person-avery', created: new Date().toISOString() }, true, '4.0.0');
  const files = Object.assign({}, X.files, { [path]: JSON.stringify(plan, null, 2) + '\n' });
  const full = await pack(PF, new BytesFS(files), X.key);
  assert.ok(manifestOf(full.zip).files.some(f => f.path === path), 'set-up: the evidence plan is packed');
  const ok = checkPack(await repacked(PF, full.zip, (e, man) => forced(man)));
  assert.ok(ok.ok, 'the control holds: ' + ok.out);
  const bad = checkPack(await repacked(PF, full.zip, (e, man, f) => { const x = f(path); delete e[x.pack]; man.files = man.files.filter((y) => y.path !== path); forced(man); }));
  assert.ok(!bad.ok && bad.out.indexOf(planId) >= 0, 'Python refuses it: ' + bad.out);
});

/* GB: dependencies come from every checked to-do record naming the run, status files included: an application that hasn't
   landed, whose effect rests on a run that isn't in the folder, leaves the export partial naming that run, and Python, with
   that dependency left out of a manifest made to claim the work complete, refuses it. */
rule('An unlanded application whose effect rests on a run not in the folder: the export is partial naming it, and Python refuses a complete claim without it', async () => {
  const X = (await roleWorlds()).filter(w => w.role === 'evidence')[0], PF = X.PF, T = PF.todos, [proc, id] = X.key.split('/');
  const recs = Object.keys(X.files).filter((p) => /^proposals\/req-/.test(p)).map((p) => [p.slice('proposals/'.length), JSON.parse(String(X.files[p]))]);
  const qf = recs.filter((x) => x[1].kind === 'proposal' && x[1].evidence)[0];
  assert.ok(qf, 'set-up: a request done on evidence');
  const q = T.cleanFile(qf[1], qf[0]).record, eff = JSON.parse(JSON.stringify(T.effectOf(q)));
  eff.evidence = Object.assign({}, eff.evidence, { run: { process: proc, id: 'ghost-run' } });
  const st = T.buildStatus({ kind: 'application', proposal: q.id, run: { process: proc, id }, seen: [q.id], by: 'person-avery', at: new Date().toISOString(), authority: { decision: T.statusName(qf[1].id, 'w-ghost', '0000abce').slice(0, -5) }, previous: '', effect: eff, writer: 'w-ghost', rev: '0000abcd', app: '4.0.0' });
  assert.ok(T.cleanFile(JSON.parse(JSON.stringify(st.file)), st.name).ok, 'set-up: the application reads: ' + JSON.stringify(T.cleanFile(JSON.parse(JSON.stringify(st.file)), st.name)));
  const ghost = 'runs/' + proc + '/ghost-run/run.json', sp = 'proposals/' + st.name;
  const files = Object.assign({}, X.files, { [sp]: T.text(st.file) });
  const got = await pack(PF, new BytesFS(files), X.key);
  assert.strictEqual(got.res.status, 'partial', JSON.stringify(got.res.col.unresolved).slice(0, 300));
  assert.ok(got.res.col.unresolved.some((u) => u.indexOf(ghost) >= 0), 'the export names the run it rests on: ' + JSON.stringify(got.res.col.unresolved).slice(0, 400));
  assert.ok(manifestOf(got.zip).files.some((f) => f.path === sp), 'set-up: the application is packed');
  if (!PY) return;
  const c = checkPack(await repacked(PF, got.zip, (e, man) => { man.runs.forEach((r) => { if (r.living) r.living.deps = (r.living.deps || []).filter((d) => d.key.indexOf('ghost-run') < 0); }); forced(man); }));
  assert.ok(!c.ok && c.out.indexOf('ghost-run') >= 0, 'Python: ' + c.out);
});

/* HB: a reverse fulfillment (the run's own record names a spread, a request on another run fulfills it) makes that other run
   part of the work, transitively, in the export and in Python alike: missing or refused by the readers, the export is partial
   naming it, and Python refuses a pack claiming the work complete with that run left out of the manifest. The valid world
   is a complete pack Python accepts. */
rule('A run that fulfills a spread the run holds is part of its work: missing or malformed, the export is partial and Python refuses a complete claim without it', async () => {
  const X = (await roleWorlds()).filter(w => w.role === 'reverse')[0], PF = X.PF;
  const ok = await pack(PF, new BytesFS(X.files), X.key);
  assert.strictEqual(ok.res.status, 'complete', JSON.stringify(ok.res.col.unresolved).slice(0, 300));
  if (PY) { const c = checkPack(ok.zip); assert.ok(c.ok, 'Python accepts the valid pack: ' + c.out); }
  const q = JSON.parse(String(X.files[X.path])), bad = Object.assign({}, q, { title: 42 });
  for (const [what, patch] of [['missing', { [X.path]: undefined }], ['its title not text', { [X.path]: JSON.stringify(bad, null, 2) }]]) {
    const files = Object.assign({}, X.files, patch); Object.keys(files).forEach((k) => { if (files[k] === undefined) delete files[k]; });
    const got = await pack(PF, new BytesFS(files), X.key);
    assert.strictEqual(got.res.status, 'partial', what + ': ' + JSON.stringify(got.res.col.unresolved).slice(0, 300));
    assert.ok(got.res.col.unresolved.some((u) => u.indexOf(X.path) >= 0), what + ': the export names ' + X.path + ': ' + JSON.stringify(got.res.col.unresolved).slice(0, 400));
    if (!PY) continue;
    const c = checkPack(await repacked(PF, got.zip, (e, man) => {
      man.files.filter((f) => f.path.indexOf('runs/' + X.depKey + '/') === 0).forEach((f) => { delete e[f.pack]; });
      man.files = man.files.filter((f) => f.path.indexOf('runs/' + X.depKey + '/') !== 0);
      man.runs = man.runs.filter((r) => r.key !== X.depKey);
      man.runs.forEach((r) => { if (r.living) r.living.deps = (r.living.deps || []).filter((d) => d.key !== X.depKey); });
      forced(man);
    }));
    assert.ok(!c.ok && c.out.indexOf(X.depKey) >= 0, what + ': Python: ' + c.out);
  }
});

/* RE: every original the closure reaches is read by its own family's reader (the shipped checker's: a to-do record's
   proposal, compound, decision, application, fact or keep, and a loop's scope record), in the export and in Python alike. A
   fact the work rests on is one witness under its id, carrying that id. Each family's damage is made in the folder (the
   export names it and is partial) and in a complete pack rewritten with its hashes made to match (Python refuses it). */
const familyOf = (o) => (o && (o.format === 'flightdeck-plan/3' || o.format === 'flightdeck-plan-status/3') ? 'scope' : o && o.kind === 'decision' ? 'authority decision' : o && o.kind);
async function familyWorlds() {
  const A = await made({ requested: true }), PF = A.PF;
  const P = PF.run.sanitize(JSON.parse(JSON.stringify(A.run))), gotA = await PF.repo.readTodos(new BytesFS(A.files));
  const td = Object.keys(PF.todos.view(P, { records: gotA.records, people: JSON.parse(A.files['people.json']) }).byTodo)[0];
  assert.ok(td, 'set-up: a to-do to keep');
  const keep = PF.learn.build({ run: { process: P.process, id: P.id }, by: 'person-avery', at: new Date().toISOString(), app: '4.0.0', source: { todo: td }, change: { text: 'Check the release notes twice', where: 'end' }, needs: 'It isn\'t placed yet.' });
  A.files = Object.assign({}, A.files, { ['proposals/' + keep.id + '.json']: JSON.stringify(keep, null, 2) + '\n' });
  const B = await loopMade(), T = B.PF.todos, F = B.PF.facts, Q = B.PF.run.sanitize(JSON.parse(JSON.stringify(B.run)));
  const got = await B.PF.repo.readTodos(new BytesFS(B.files)), V = T.view(Q, { records: got.records, people: JSON.parse(B.files['people.json']) });
  const x = Object.keys(V.byTodo).map((k) => V.byTodo[k])[0], item = B.PF.loop.view(Q, 'each', { records: got.scopes, runs: [Q], procOf: () => null }).rollup.items[0];
  const at = new Date().toISOString(), BB = { feed: 'bitbucket', site: 'git.example.com' };
  const f = F.build({ run: Q, producer: { name: 'git-bot', version: '1.0' }, key: 'prs-1', seen: [], at, app: '4.0.0', loopStep: 'each', uid: item.uid, attempt: 1, source: BB, domain: 'prs', observedAt: at, maxAgeSeconds: 86400, complete: true, reported: 1, fetched: 1, errors: [], entries: [{ id: '1', text: 'Change 1', state: 'merged' }] });
  const fr = T.cleanFile(JSON.parse(T.text(f)), f.id + '.json').record;
  const q = T.buildProposal({ run: { process: Q.process, id: Q.id }, producer: { name: 'git-bot', version: '1.0' }, seen: [], at, body: { op: 'done', todo: x.id, support: { fact: f.id, content: fr.content, incarnation: x.added, source: BB, domain: 'prs' } } });
  B.files = Object.assign({}, B.files, { ['proposals/' + f.id + '.json']: T.text(f), ['proposals/' + q.id + '.json']: T.text(q) });
  return [A, B];
}
const OTHER_FACT = 'req-fact-' + 'e'.repeat(24);
const FAMILY_DAMAGE = {
  'proposal': [['at 42', (o) => { o.at = 42; return o; }], ['seen broken', (o) => { o.seen = 'broken'; return o; }]],
  'compound': [['at 42', (o) => { o.at = 42; return o; }]],
  'authority decision': [['at 42', (o) => { o.at = 42; return o; }]],
  'application': [['at 42', (o) => { o.at = 42; return o; }]],
  'keep': [['at 42', (o) => { o.at = 42; return o; }], ['change broken', (o) => { o.change = 'broken'; return o; }]],
  'fact': [['entries broken', (o) => { o.entries = 'broken'; return o; }], ['{}', () => ({})], ['another id', (o) => { o.id = OTHER_FACT; return o; }], ['at 42', (o) => { o.at = 42; return o; }]],
  'scope': [['changes broken', (o) => { o.changes = 'broken'; return o; }], ['seen broken', (o) => { o.seen = 'broken'; return o; }]]
};
rule('Every original the closure reaches is read by its family\'s reader: each family\'s damage leaves the export partial and Python refuses a complete claim', async () => {
  const worlds = await familyWorlds(), seen = {}, off = [];
  for (const W of worlds) {
    const full = await pack(W.PF, new BytesFS(W.files), W.key);
    assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
    if (PY) { const c = checkPack(full.zip); assert.ok(c.ok, 'the control holds: ' + c.out); }
    const paths = manifestOf(full.zip).files.map((y) => y.path).filter((p) => /^proposals\/req-/.test(p));
    for (const p of paths) {
      const fam = familyOf(JSON.parse(W.files[p]));
      for (const [what, damage] of FAMILY_DAMAGE[fam] || []) {
        const name = fam + ' ' + what + ' (' + p + ')', text = JSON.stringify(damage(JSON.parse(W.files[p])), null, 2) + '\n';
        seen[fam] = true;
        const { res } = await pack(W.PF, new BytesFS(Object.assign({}, W.files, { [p]: text })), W.key);
        if (res.status !== 'partial' || !res.col.unresolved.some((u) => u.indexOf(p) >= 0)) off.push('export: ' + name + ' ' + res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 300));
        if (!PY) continue;
        const bad = checkPack(await repacked(W.PF, full.zip, (e, man, g) => { e[g(p).pack] = Buffer.from(text); forced(man); }));
        if (bad.ok) off.push('Python accepts: ' + name);
      }
    }
  }
  assert.deepStrictEqual(Object.keys(seen).sort(), Object.keys(FAMILY_DAMAGE).sort(), 'every family is packed in these worlds');
  assert.deepStrictEqual(off, []);
});
rule('A fact the work rests on is one witness carrying its id: two different copies of it are refused by Python, and the export says which', async () => {
  const B = (await familyWorlds())[1], fp = Object.keys(B.files).find((p) => /^proposals\/req-/.test(p) && JSON.parse(B.files[p]).kind === 'fact');
  const o = JSON.parse(B.files[fp]); o.observedAt = new Date(Date.parse(o.observedAt) - 1000).toISOString();
  const cp2 = fp.replace(/\.json$/, ' (1).json'), files = Object.assign({}, B.files, { [cp2]: JSON.stringify(o, null, 2) + '\n' });
  const { res, zip } = await pack(B.PF, new BytesFS(files), B.key);
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some((u) => u.indexOf(fp.slice(0, -5)) >= 0), JSON.stringify(res.col.unresolved));
  if (!PY) return;
  const full = await pack(B.PF, new BytesFS(B.files), B.key);
  const bad = checkPack(await repacked(B.PF, full.zip, (e, man, g) => { const y = g(fp); e['originals/' + cp2] = Buffer.from(JSON.stringify(o, null, 2) + '\n'); man.files.push(Object.assign({}, y, { path: cp2, pack: 'originals/' + cp2 })); forced(man); }));
  assert.ok(!bad.ok && bad.out.indexOf(fp.slice('proposals/'.length, -5)) >= 0, 'Python refuses it: ' + bad.out);
});/* TD: Python reads every packed original as the app does (one decoder): a byte-order mark is read past, and a file nested
   more than 64 levels deep isn't read. */
const deep65 = () => { let v = 0; for (let i = 0; i < 65; i++) v = [v]; return v; };
rule('Python decodes packed originals as the app does: a byte-order mark on run.json is read, and a scope record or evidence plan nested 65 deep is refused', async () => {
  if (!PY) return;
  const A = await made({ todos: 1 }), bom = Object.assign({}, A.files, { [A.runPath]: '\ufeff' + A.files[A.runPath] });
  const b = await pack(A.PF, new BytesFS(bom), A.key);
  assert.strictEqual(b.res.status, 'complete', 'the app reads it: ' + JSON.stringify(b.res.col.unresolved));
  const c = checkPack(b.zip);
  assert.ok(c.ok, 'Python reads it too: ' + c.out);
  const W = await loopMade(), sp = Object.keys(W.files).find((p) => /^proposals\/req-/.test(p) && JSON.parse(W.files[p]).loop);
  const o = JSON.parse(W.files[sp]); o.ignored = deep65();
  const text = JSON.stringify(o) + '\n', got = await pack(W.PF, new BytesFS(Object.assign({}, W.files, { [sp]: text })), W.key);
  assert.ok(got.res.status === 'partial' && got.res.col.unresolved.some((u) => u.indexOf(sp) >= 0), 'the app refuses it: ' + JSON.stringify(got.res.col.unresolved));
  const full = await pack(W.PF, new BytesFS(W.files), W.key);
  const bad = checkPack(await repacked(W.PF, full.zip, (e, man, g) => { e[g(sp).pack] = Buffer.from(text); forced(man); }));
  assert.ok(!bad.ok, 'Python refuses the deep scope record: ' + bad.out);
  const X = (await roleWorlds()).filter((w) => w.role === 'evidence')[0], PF = X.PF, [proc, id] = X.key.split('/');
  const one = await PF.repo.readRunOnly(new BytesFS(X.files), proc, id), planId = 'plan-ev-' + 'a'.repeat(24), path = 'proposals/' + planId + '.json';
  const plan = PF.plans.make(one.pub, { id: planId, process: proc, title: 'Evidence plan', from: X.key, by: 'person-avery', created: new Date().toISOString() }, true, '4.0.0');
  const fullP = await pack(PF, new BytesFS(Object.assign({}, X.files, { [path]: JSON.stringify(plan, null, 2) + '\n' })), X.key);
  const okP = checkPack(await repacked(PF, fullP.zip, (e, man) => forced(man)));
  assert.ok(okP.ok, 'the plan control holds: ' + okP.out);
  plan.ignored = deep65();
  const badP = checkPack(await repacked(PF, fullP.zip, (e, man, g) => { e[g(path).pack] = Buffer.from(JSON.stringify(plan) + '\n'); forced(man); }));
  assert.ok(!badP.ok && badP.out.indexOf(planId) >= 0, 'Python refuses the deep plan: ' + badP.out);
});/* TB: the keeps a receipt names are in the closure, each a checked keep witness on the run, in the export and in Python. */
rule('A keep the receipt names is in the closure: deleted, the export is partial by its path and Python refuses a complete claim without it', async () => {
  const W = await made({ todos: 1, keep: true }), kp = 'proposals/' + W.keepId + '.json';
  const rc = JSON.parse(W.files['proposals/' + W.run.living.receipt + '.json']);
  assert.deepStrictEqual(rc.keeps, [W.keepId], 'set-up: the receipt names the keep');
  const full = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  const files = Object.assign({}, W.files); delete files[kp];
  const { res } = await pack(W.PF, new BytesFS(files), W.key);
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(kp) >= 0), 'the export names it: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
  if (!PY) return;
  assert.ok(checkPack(full.zip).ok, 'the control holds');
  const bad = checkPack(await repacked(W.PF, full.zip, (e, man, g) => { const y = g(kp); delete e[y.pack]; man.files = man.files.filter((z) => z.path !== kp); }));
  assert.ok(!bad.ok && /receipt/.test(bad.out), 'Python refuses it: ' + bad.out);
});/* TC: the receipt is the one the person who ended the run wrote: a run.json naming another person is a mismatch, in the
   export and in Python. */
rule('A run whose ended.by isn\'t its receipt\'s by leaves the pack partial, and Python refuses a complete claim', async () => {
  const W = await made({ todos: 1 }), r = JSON.parse(W.files[W.runPath]);
  r.ended.by = r.ended.by === 'person-blake' ? 'person-avery' : 'person-blake';
  const files = Object.assign({}, W.files, { [W.runPath]: JSON.stringify(r, null, 2) }), rp = 'proposals/' + W.run.living.receipt + '.json';
  const { res, zip } = await pack(W.PF, new BytesFS(files), W.key);
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(W.run.living.receipt) >= 0), res.status + ' ' + JSON.stringify(res.col.unresolved));
  if (!PY) return;
  const bad = checkPack(await repacked(W.PF, zip, (e, man) => forced(man)));
  assert.ok(!bad.ok && /receipt/.test(bad.out), 'Python refuses it: ' + bad.out);
  assert.ok(rp);
});/* TA: every proposals/ original discovery read is kept by its SHA-256 and read again at the end, one it left out included, and
   those final reads reserve memory as the first ones do. */
rule('A request on another run retargeted to this run during capture, keeping its name, is never missed by a complete pack', async () => {
  const W = await made({ todos: 1 }), PF = W.PF, T = PF.todos, r0 = PF.run.sanitize(JSON.parse(W.files[W.runPath]));
  const mk = (run) => T.buildProposal({ run, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-move1', seen: [], at: '2026-11-10T09:00:00.000Z', body: { op: 'add', text: 'Moved here', target: { phase: 'review' }, placement: T.placementFor(PF.run.mapOf(r0), { phase: 'review' }) } });
  const there = mk({ process: r0.process, id: 'elsewhere1' }), here = mk({ process: r0.process, id: r0.id }), qp = 'proposals/' + there.id + '.json';
  assert.strictEqual(here.id, there.id, 'set-up: the same name either way');
  /* Each capture point after the checked read of it: the k-th folder call after that read retargets it. */
  for (let k = 1; k <= 9; k++) {
    let seen = false, n = 0, moved = false;
    const swap = (x) => { if (seen && !moved && ++n === k) { x.files.set(qp, Buffer.from(T.text(here))); moved = true; } };
    const fsx = new BytesFS(Object.assign({}, W.files, { [qp]: T.text(there) }), { hooks: { read: (p, x) => { swap(x); if (p === qp) seen = true; }, blob: (p, x) => swap(x), stat: (p, x) => swap(x), list: (p, x) => swap(x) } });
    const { zip, res } = await pack(PF, fsx, W.key);
    if (!moved) continue;
    const packed = manifestOf(zip).files.some((f) => f.path === qp);
    assert.ok(packed || (res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(qp) >= 0)), 'point ' + k + ': packed, or named: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
  }
});
rule('The final rereads of what discovery read reserve memory first: the peak the pack reports covers them', async () => {
  const W = await loopMade(), K = JSON.parse(W.files[W.kidPath]), files = Object.assign({}, W.files), SIZE = 200000, kids = [];
  for (let i = 0; i < 4; i++) {
    const id = 'other-kid' + i, o = Object.assign({}, K, { id, parent: Object.assign({}, K.parent, { id: 'someone-else' }) }), p = 'runs/' + K.process + '/' + id + '/run.json';
    files[p] = ' '.repeat(SIZE) + JSON.stringify(o, null, 2); kids.push(p);
  }
  const reads = {}, count = (p) => { if (kids.indexOf(p) >= 0) reads[p] = (reads[p] || 0) + 1; }, fsx = new BytesFS(files, { hooks: { read: count, blob: count } });
  const res = await W.PF.repo.exportEvidence(fsx, { run: W.key }, { sink: () => {}, now: () => Date.now(), tz: 'UTC' });
  assert.ok(kids.every((p) => reads[p] >= 2), 'set-up: each was read by discovery and again at the end: ' + JSON.stringify(reads));
  assert.ok(res.col.retained.peak >= (kids.length + 1) * SIZE * 2, 'peak ' + res.col.retained.peak + ' counts the discovery reads and a reread');
  const tight = await W.PF.repo.exportEvidence(new BytesFS(files), { run: W.key }, { sink: () => {}, now: () => Date.now(), tz: 'UTC', cap: kids.length * SIZE * 2 + 300000 });
  assert.ok(tight.col.retained.peak <= kids.length * SIZE * 2 + 300000, 'within the cap: ' + tight.col.retained.peak);
  assert.ok(tight.status === 'complete' || tight.col.unresolved.length, 'a pack that isn\'t complete says why');
});/* WE: Python reads the receipt witness it resolved under the name it is packed as: one packed only as its synced copy is read. */
rule('A receipt in the folder only as its synced copy (<id> (1).json) is confirmed by the export and by Python alike', async () => {
  const W = await made({ todos: 1 }), id = W.run.living.receipt, files = Object.assign({}, W.files);
  files['proposals/' + id + ' (1).json'] = files['proposals/' + id + '.json']; delete files['proposals/' + id + '.json'];
  const { zip, res } = await pack(W.PF, new BytesFS(files), W.key);
  assert.strictEqual(res.status, 'complete', JSON.stringify(res.col.unresolved));
  if (!PY) return;
  const c = checkPack(zip);
  assert.ok(c.ok, 'Python reads it: ' + c.out);
});/* WB: a byte the app replaces (0xFF in a run's title) is read the same way by Python: the run is there, its pack complete. */
rule('A run.json with a byte that isn\'t UTF-8 (0xFF in its title) is read with a replacement character by the export and by Python alike', async () => {
  const W = await made({ todos: 1 }), files = Object.assign({}, W.files), r = JSON.parse(files[W.runPath]);
  const t = JSON.stringify(r, null, 2), at = t.indexOf('"title": "') + 10, buf = Buffer.concat([Buffer.from(t.slice(0, at)), Buffer.from([0xff]), Buffer.from(t.slice(at))]);
  const fsx = new BytesFS(files); fsx.files.set(W.runPath, buf);
  const { zip, res } = await pack(W.PF, fsx, W.key);
  assert.strictEqual(res.status, 'complete', JSON.stringify(res.col.unresolved));
  if (!PY) return;
  const c = checkPack(zip);
  assert.ok(c.ok, 'Python reads it: ' + c.out);
});/* WD: discovery, capture and the final rereads compare the SHA-256 of the raw bytes: a byte-order mark added to a record after
   it was judged is a change, never passed as the same text. */
rule('A byte-order mark added to a record the work rests on after discovery read it is a change: packed only as judged, or named', async () => {
  const W = await made({ todos: 1 }), hp = 'proposals/' + W.run.living.head + '.json', was = Buffer.from(W.files[hp]);
  let seen = false, moved = false;
  const swap = (x) => { if (seen && !moved) { x.files.set(hp, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), was])); moved = true; } };
  const fsx = new BytesFS(W.files, { hooks: { read: (p, x) => { swap(x); if (p === hp) seen = true; }, blob: (p, x) => { swap(x); if (p === hp) seen = true; }, stat: (p, x) => swap(x), list: (p, x) => swap(x) } });
  const { zip, res } = await pack(W.PF, fsx, W.key);
  assert.ok(moved, 'set-up: the mark was added after the checked read');
  const e = unzip(zip), f = manifestOf(zip).files.filter((y) => y.path === hp)[0], bytes = f && e[f.pack];
  assert.ok((res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(hp) >= 0)) || (bytes && bytes.equals(was)), 'named, or packed as judged: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
});
/* WC: every closure read is bounded by bytes, not only by its stat: a dependency's version file over the one-file limit is
   never read whole, and a file that grows past what was reserved for its final reread is refused, named. */
const measured = (fsx, paths) => {
  const max = {}, note = (p, n) => { max[p] = Math.max(max[p] || 0, n); };
  const blob = fsx.blob.bind(fsx), read = fsx.read.bind(fsx);
  fsx.blob = (p, o) => blob(p, o).then((b) => { if (!b || paths.indexOf(p) < 0) return b; const ab = b.arrayBuffer.bind(b), tx = b.text.bind(b); b.arrayBuffer = () => ab().then((x) => { note(p, x.byteLength); return x; }); b.text = () => tx().then((x) => { note(p, x.length); return x; }); return b; });
  fsx.read = (p, o) => read(p, o).then((f) => { if (f && paths.indexOf(p) >= 0) note(p, f.text.length); return f; });
  return max;
};
rule('A dependency\'s version file over the one-file limit is never read whole: the export names it and is partial', async () => {
  const W = await loopMade(), K = JSON.parse(W.files[W.kidPath]), files = Object.assign({}, W.files), LIM = 65536;
  const pub = Object.keys(files).find((p) => p.indexOf('publications/' + K.process + '/' + K.folder + '/publication.json') === 0);
  assert.ok(pub, 'set-up: the child\'s version');
  files[pub] = files[pub] + ' '.repeat(2 * 1048576);
  const fsx = new BytesFS(files), max = measured(fsx, [pub]);
  const res = await W.PF.repo.exportEvidence(fsx, { run: W.key }, { sink: () => {}, now: () => Date.now(), tz: 'UTC', maxFile: LIM });
  assert.ok(!(max[pub] > LIM + 1), 'read whole: ' + max[pub]);
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(pub) >= 0 || u.indexOf(K.process + '/' + K.id) >= 0), res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 400));
});
rule('A file that shrinks for its final stat and then grows is never reread past what was reserved: refused and named', async () => {
  const W = await made({ todos: 1 }), op = 'proposals/plan-other.json', small = JSON.stringify({ kind: 'plan', id: 'plan-other', process: 'other', title: 'Another plan' }), LIM = 65536;
  const files = Object.assign({}, W.files, { [op]: small });
  let reads = 0;
  const big = Buffer.from(small + ' '.repeat(2100000));
  const fsx = new BytesFS(files, { hooks: { stat: (p, x) => { if (p === op) x.files.set(op, Buffer.from(small)); }, read: (p, x) => { if (p === op && reads++) x.files.set(op, big); }, blob: (p, x) => { if (p === op && reads++) x.files.set(op, big); } } });
  const max = measured(fsx, [op]);
  const res = await W.PF.repo.exportEvidence(fsx, { run: W.key }, { sink: () => {}, now: () => Date.now(), tz: 'UTC', maxFile: LIM });
  assert.ok(reads >= 2, 'set-up: read again at the end');
  assert.ok(!(max[op] > LIM + 1), 'reread past the limit: ' + max[op]);
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(op) >= 0), res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 400));
});
/* XA: the reservation holds through capture and every final reread: a file that grows after its stat is never read past
   it (counted on the bytes each blob gives, slices included), and one whose stat finds nothing is never read at all. */
const bytesRead = (fsx) => {
  const got = {}, blob = fsx.blob.bind(fsx), note = (p, n) => { got[p] = Math.max(got[p] || 0, n); };
  const wrap = (b, p, count) => ({ size: b.size, type: b.type,
    arrayBuffer: () => b.arrayBuffer().then((x) => { count.n += x.byteLength; note(p, count.n); return x; }),
    text: () => b.arrayBuffer().then((x) => { count.n += x.byteLength; note(p, count.n); return Buffer.from(x).toString('utf8'); }),
    slice: (a, z) => wrap(b.slice(a, z), p, count) });
  fsx.blob = (p, o) => blob(p, o).then((b) => b && wrap(b, p, { n: 0 }));
  return got;
};
rule('A file that grows after its stat is never read past it, at capture or at any final reread: the export names it or packs it as judged', async () => {
  const W = await loopMade(), K = JSON.parse(W.files[W.kidPath]), LIM = 65536;
  const vmap = 'publications/' + K.process + '/' + K.folder + '/map.md', prop = Object.keys(W.files).filter((p) => /^proposals\/req-/.test(p)).sort()[0];
  assert.ok(W.files[vmap] && prop, 'set-up: a dependency version and a record');
  for (const target of [vmap, prop, W.kidPath]) {
    for (let at = 1; at <= 5; at++) {
      const was = Buffer.from(W.files[target]), big = Buffer.concat([was, Buffer.alloc(2 * 1048576, 0x20)]);
      let n = 0;
      const fsx = new BytesFS(W.files, { hooks: { stat: (p, x) => { if (p === target) x.files.set(p, was); }, blob: (p, x) => { if (p === target && ++n === at) x.files.set(p, big); } } });
      const got = bytesRead(fsx);
      const parts = [], res = await W.PF.repo.exportEvidence(fsx, { run: W.key }, { sink: (u) => { parts.push(Buffer.from(u)); }, now: () => Date.now(), tz: 'UTC', maxFile: LIM });
      if (n < at) continue;
      assert.ok(!(got[target] > was.length + 1), target + ', blob ' + at + ': ' + got[target] + ' bytes read of ' + was.length);
      const zip = Buffer.concat(parts), f = manifestOf(zip).files.filter((y) => y.path === target)[0], bytes = f && unzip(zip)[f.pack];
      assert.ok((res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(target.split('/').pop()) >= 0 || u.indexOf(K.process + '/' + K.id) >= 0)) || (res.status === 'complete' && bytes && bytes.equals(was)), target + ', blob ' + at + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 300));
    }
  }
});
rule('A dependency\'s screenshot that arrives after its stat found nothing is never read: it\'s missing, not read whole', async () => {
  const W = await loopMade({ shot: true }), shot = Object.keys(W.files).filter((p) => /images\/shot\.png$/.test(p))[0];
  const big = Buffer.concat([SHOT, Buffer.alloc(2 * 1048576)]);
  let first = true;
  const fsx = new BytesFS(W.files, { hooks: { stat: (p, x) => { if (p === shot && first) { first = false; x.files.delete(p); } }, blob: (p, x) => { if (p === shot) x.files.set(p, big); } } });
  const got = bytesRead(fsx);
  await W.PF.repo.exportEvidence(fsx, { run: W.key }, { sink: () => {}, now: () => Date.now(), tz: 'UTC', maxFile: 65536 });
  assert.ok(!first, 'set-up: the screenshot was stat-ed');
  assert.ok(!(got[shot] > 0), 'read after its stat found nothing: ' + got[shot]);
});
/* XB: a screenshot used to verify a dependency's version is held to its bytes too: replaced while the pack is made, the
   dependency is unconfirmed and the pack partial. */
rule('A dependency\'s screenshot replaced after its version was verified (the same length, other bytes) makes the pack partial, named', async () => {
  const W = await loopMade({ shot: true }), shot = Object.keys(W.files).filter((p) => /images\/shot\.png$/.test(p))[0];
  const other = Buffer.from(SHOT); other[other.length - 1] ^= 0x01;
  let n = 0;
  const fsx = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === shot && !n++) setImmediate(() => x.files.set(p, other)); } } });
  const { res } = await pack(W.PF, fsx, W.key);
  assert.ok(n >= 1, 'set-up: the screenshot was read');
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf('shot.png') >= 0 || u.indexOf(W.kidKey) >= 0), res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 400));
});
/* XD: bounded reads close what they open: an export through the command line's reader leaves no file handle open. */
rule('An export through the command line\'s reader closes every file it opens, whatever the number of plans', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const W = await made({ todos: 1 }), FD = require('../bin/flightdeck.js');
  const files = Object.assign({}, W.files);
  for (let i = 0; i < 40; i++) files['proposals/plan-extra-' + i + '.json'] = JSON.stringify({ kind: 'plan', id: 'plan-extra-' + i, process: 'other', title: 'Plan ' + i });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-handles-'));
  Object.keys(files).forEach((p) => { fs.mkdirSync(path.join(dir, path.dirname(p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), files[p]); });
  const open = new Set(), o = fs.openSync, c = fs.closeSync;
  fs.openSync = function () { const fd = o.apply(fs, arguments); open.add(fd); return fd; };
  fs.closeSync = function (fd) { open.delete(fd); return c.apply(fs, arguments); };
  let res;
  try { res = await W.PF.repo.exportEvidence(FD.readAdapter(fs.realpathSync(dir)), { run: W.key }, { sink: () => {}, now: () => Date.now(), tz: 'UTC' }); } finally { fs.openSync = o; fs.closeSync = c; }
  assert.strictEqual(res.status, 'complete', JSON.stringify(res.col && res.col.unresolved));
  assert.strictEqual(open.size, 0, open.size + ' file handles left open');
});
/* XC: a dependency's version is read by Python with the replacement decoder, as the app reads it: bytes that aren't UTF-8
   inside its publication record (a child's change note) give the same verdict in both, through the real version checks. */
rule('A dependency\'s publication record with bytes that aren\'t UTF-8 in its change note is verified by the export and by Python alike', async () => {
  const W = await loopMade(), K = JSON.parse(W.files[W.kidPath]), pub = 'publications/' + K.process + '/' + K.folder + '/publication.json';
  const t = String(W.files[pub]), at = t.indexOf('"changes": "') + 12;
  assert.ok(at > 12, 'set-up: a change note');
  for (const seq of [[0xff], [0xfe], [0x80], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5], [0xe0, 0xa0], [0xe2, 0x82], [0xf0, 0x9f, 0x98], [0xef, 0xbb, 0xbf]]) {
    const files = Object.assign({}, W.files, { [pub]: Buffer.concat([Buffer.from(t.slice(0, at)), Buffer.from(seq), Buffer.from(t.slice(at))]) });
    const { zip, res } = await pack(W.PF, new BytesFS(files), W.key);
    assert.strictEqual(res.status, 'complete', seq + ': ' + JSON.stringify(res.col.unresolved));
    if (!PY) continue;
    const c = checkPack(zip);
    assert.ok(c.ok, seq + ': Python reads it: ' + c.out);
  }
});
/* ZB: a child folder listed under a loop's process and gone before it is read is named, so the end is refused: the ending
   guard's reread of the loop children never skips it. */
rule('A child folder listed and then gone before it is read is unread, named missing, in the ending guard\'s reread of the loop children', async () => {
  const W = await loopMade(), fsx = new BytesFS(W.files), list = fsx.list.bind(fsx);
  let first = true;
  fsx.list = (p) => list(p).then((items) => { if (p !== 'runs/' + W.kid.process || !first) return items; first = false; return items.concat([{ name: 'new-child', kind: 'dir' }]); });
  const out = await W.PF.repo.readLoopChildren(fsx, W.PF.run.sanitize(JSON.parse(JSON.stringify(W.run))));
  assert.ok(out.runs.some((r) => r.id === W.kid.id), 'set-up: the story run is read');
  const u = out.unread.filter((x) => x.path === 'runs/' + W.kid.process + '/new-child/run.json')[0];
  assert.ok(u && u.kind === 'missing', JSON.stringify(out.unread));
});
/* ZC: a path's first read is its baseline: two child runs pinning one version, its screenshot and record replaced (to match
   each other) between their verifications, never export complete on the first verdict's bytes. */
rule('A version two child runs pin, replaced between their two verifications (screenshot and record together), never exports complete', async () => {
  const W = await loopMade({ shot: true, kids: 2 }), kids = Object.keys(W.files).filter((p) => /^runs\/validate-story\/[^/]+\/run\.json$/.test(p));
  assert.strictEqual(kids.length, 2, 'set-up: two story runs');
  const shot = Object.keys(W.files).filter((p) => /images\/shot\.png$/.test(p))[0], pub = shot.replace('images/shot.png', 'publication.json');
  const other = Buffer.from(SHOT); other[other.length - 1] ^= 0x01;
  const info = JSON.parse(String(W.files[pub]));
  info.images['images/shot.png'] = W.PF.util.hash(other.toString('latin1'));
  if (info.payload) info.payload.images['images/shot.png'] = sha(other);
  const pub2 = Buffer.from(JSON.stringify(info, null, 2));
  /* The second run's reads (each the second of its path) see the new record and screenshot; the first run's saw the old. */
  let n = 0, m = 0;
  const fsx = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === pub && ++m === 2) x.files.set(pub, pub2); if (p === shot && ++n === 2) x.files.set(shot, other); } } });
  const { res } = await pack(W.PF, fsx, W.key);
  assert.ok(n >= 2 && m >= 2, 'set-up: the record and screenshot were read for each run (' + m + ', ' + n + ')');
  assert.ok(!(res.status === 'complete' && res.col.attempts === 1), 'complete on the first attempt: ' + JSON.stringify(res.col.unresolved));
});
/* ZD: a loop item's choice names a run of the process its loop step starts: Python requires exactly that process/run key,
   never a packed run of the same id under another process (here the parent's own id). */
rule('Python requires a loop item\'s chosen run under the loop step\'s own process, never a run of that id elsewhere in the pack', async () => {
  if (!PY) return console.log('  (skipped: no Python)');
  const W = await loopMade(), { zip, res } = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(res.status, 'complete', JSON.stringify(res.col.unresolved));
  const scopeP = Object.keys(W.files).filter((p) => /^proposals\/req-/.test(p) && /"loop"/.test(String(W.files[p])))[0];
  assert.ok(scopeP, 'set-up: a loop scope record');
  const chosen = (id) => repacked(W.PF, zip, (e, man, f) => { const x = f(scopeP), o = JSON.parse(e[x.pack]); const add = o.changes.filter((c) => c.op === 'add')[0]; o.changes.push({ op: 'choose', item: add.item, run: id, attempt: 1, candidates: [id, id === W.kid.id ? W.run.id : W.kid.id] }); e[x.pack] = Buffer.from(JSON.stringify(o, null, 2) + '\n'); });
  const good = checkPack(await chosen(W.kid.id));
  assert.ok(good.ok, 'the story run chosen: ' + good.out);
  const bad = checkPack(await chosen(W.run.id));
  assert.ok(!bad.ok && bad.out.indexOf('validate-story/' + W.run.id) >= 0, 'the parent\'s id chosen: ' + bad.out);
});
/* AA: one copy rule: copies of a record are compared as the app compares them (PF.loop.copyBody of the checked record: its
   envelope, format, features and app, isn't what it says), in the export and in Python alike. A copy that differs only in
   the app that wrote it is the same record; one that says something else is two different copies, in both. */
const copyOf = (name) => name.replace(/\.json$/, ' (1).json');
rule('A synced copy of a record that differs only in the app that wrote it is the same record for the export and for Python, every family', async () => {
  const W = await made({ todos: 1, requested: true, keep: true }), { zip } = await pack(W.PF, new BytesFS(W.files), W.key);
  const man = manifestOf(zip), byKind = {};
  man.files.filter((f) => /^proposals\//.test(f.path) && f.role === 'living').forEach((f) => {
    let o; try { o = JSON.parse(String(W.files[f.path])); } catch (e) { return; }
    const k = o.kind || o.format; if (!byKind[k]) byKind[k] = f.path;
  });
  assert.ok(Object.keys(byKind).length >= 4, 'set-up: several families ' + JSON.stringify(Object.keys(byKind)));
  for (const k of Object.keys(byKind)) {
    const p = byKind[k], o = JSON.parse(String(W.files[p]));
    o.app = o.app === '4.0.1' ? '4.0.2' : '4.0.1';
    const files = Object.assign({}, W.files, { [copyOf(p)]: JSON.stringify(o, null, 2) + '\n' });
    const r = await pack(W.PF, new BytesFS(files), W.key);
    assert.strictEqual(r.res.status, 'complete', k + ': ' + JSON.stringify(r.res.col.unresolved));
    assert.ok(manifestOf(r.zip).files.some((f) => f.path === copyOf(p)), k + ': both copies packed');
    if (!PY) continue;
    const c = checkPack(r.zip);
    assert.ok(c.ok, k + ': Python reads it: ' + c.out);
  }
});
/* The Validator (PR #114 round 2): a copy is compared as the app reads it (PF.todos.cleanFile, then PF.loop.copyBody), so one
   that leaves out what readers derive, writes an optional field as null, or carries a "by" a tool's record doesn't read, is
   the same record for the export and for Python, every family. */
rule('A synced copy that leaves out a derived field, or writes an optional one as null, is the same record for the export and for Python, every family', async () => {
  const W = await made({ todos: 1, requested: true, keep: true }), { zip } = await pack(W.PF, new BytesFS(W.files), W.key);
  const man = manifestOf(zip), edits = [];
  man.files.filter((f) => /^proposals\//.test(f.path) && f.role === 'living').forEach((f) => {
    let o; try { o = JSON.parse(String(W.files[f.path])); } catch (e) { return; }
    const k = o.kind || o.format;
    if ((k === 'proposal' || k === 'compound') && o.op === 'add' && 'todo' in o) edits.push([k + ' without its derived to-do id', f.path, (x) => { delete x.todo; }]);
    if ((k === 'proposal' || k === 'compound') && o.op !== 'wont' && !('reason' in o)) edits.push([k + ' with "reason": null', f.path, (x) => { x.reason = null; }]);
    if (k === 'compound' && o.decision && !('reason' in o.decision)) edits.push(['compound with its decision\'s "reason": null', f.path, (x) => { x.decision.reason = null; }]);
    if (k === 'decision' && !('reason' in o)) edits.push(['decision with "reason": null', f.path, (x) => { x.reason = null; }]);
    if ((k === 'proposal' || k === 'fact') && o.producer && !('by' in o)) edits.push([k + ' of a tool with a "by" it doesn\'t read', f.path, (x) => { x.by = 'person-avery'; }]);
  });
  const kinds = edits.map((e) => e[0].split(' ')[0]);
  assert.ok(['proposal', 'compound'].every((k) => kinds.indexOf(k) >= 0), 'set-up: ' + JSON.stringify(edits.map((e) => e[0])));
  const off = [];
  for (const [what, p, edit] of edits) {
    const o = JSON.parse(String(W.files[p])); edit(o);
    const files = Object.assign({}, W.files, { [copyOf(p)]: JSON.stringify(o, null, 2) + '\n' });
    const r = await pack(W.PF, new BytesFS(files), W.key);
    if (r.res.status !== 'complete') { off.push(what + ': the export ' + r.res.status + ' ' + JSON.stringify(r.res.col.unresolved).slice(0, 300)); continue; }
    if (!PY) continue;
    const c = checkPack(r.zip);
    if (!c.ok) off.push(what + ': Python: ' + c.out.slice(0, 300));
  }
  assert.deepStrictEqual(off, []);
});
/* YI: a fact and a keep the work rests on are compared as their readers read them (PF.facts.cleanFile, PF.learn.cleanFile,
   then PF.loop.copyBody), so a copy writing an optional field as null is the same record, and a fact's content is what its
   reader derives: an entry's "link": null is no link, for the export and for Python alike. */
rule('A synced copy of a fact or a keep that writes an optional field as null is the same record for the export and for Python', async () => {
  const [A, B] = await familyWorlds();
  const find = (W, kind) => Object.keys(W.files).find((p) => /^proposals\/req-/.test(p) && JSON.parse(W.files[p]).kind === kind);
  const fp = find(B, 'fact'), kp = find(A, 'keep'), f0 = JSON.parse(B.files[fp]), k0 = JSON.parse(A.files[kp]);
  assert.ok(f0.source.site && !('account' in f0.source) && !('link' in f0.entries[0]), 'set-up: a fact with a site, no account, an entry without a link');
  assert.ok(k0.by && !k0.producer && !('template' in k0) && !('anchor' in k0) && !('reason' in k0), 'set-up: an unplaced person\'s keep without a reason');
  const edits = [
    ['fact with its source\'s "account": null', B, fp, (x) => { x.source.account = null; }],
    ['fact with an entry\'s "link": null', B, fp, (x) => { x.entries[0].link = null; }],
    ['keep with "template" and "anchor" null', A, kp, (x) => { x.template = null; x.anchor = null; }],
    ['keep with "reason" and "base" null', A, kp, (x) => { x.reason = null; x.base = null; }],
    ['keep of a person with "producer" and "key" null', A, kp, (x) => { x.producer = null; x.key = null; }]];
  const off = [];
  for (const [what, W, p, edit] of edits) {
    const o = JSON.parse(String(W.files[p])); edit(o);
    const text = JSON.stringify(o, null, 2) + '\n';
    for (const [how, files] of [['a copy', Object.assign({}, W.files, { [copyOf(p)]: text })], ['the only file', Object.assign({}, W.files, { [p]: text })]]) {
      const r = await pack(W.PF, new BytesFS(files), W.key);
      if (r.res.status !== 'complete') { off.push(what + ', ' + how + ': the export ' + r.res.status + ' ' + JSON.stringify(r.res.col.unresolved).slice(0, 300)); continue; }
      if (!PY) continue;
      const c = checkPack(r.zip);
      if (!c.ok) off.push(what + ', ' + how + ': Python: ' + c.out.slice(0, 300));
    }
  }
  assert.deepStrictEqual(off, []);
});
/* AB: every record the work rests on is held to its copies, a pending request and a loop's scope record included: a copy
   that says something else is named, the pack partial, and Python refuses a complete claim. */
rule('A pending request or a loop scope record with a copy that says something else makes the pack partial, named, and Python refuses it as complete', async () => {
  const P = await made({ todos: 1, pending: true }), L = await loopMade();
  const scopeP = Object.keys(L.files).filter((p) => /^proposals\/req-/.test(p) && /"loop"/.test(String(L.files[p])))[0];
  for (const [what, W, p, edit] of [
    ['a pending request', P, 'proposals/' + P.pendingId + '.json', (o) => { o.text = o.text + ' (edited)'; }],
    ['a scope record', L, scopeP, (o) => { const c = o.changes.filter((x) => x.item)[0]; c.item = Object.assign({}, c.item, { key: 'ABC-999' }); }]]) {
    assert.ok(p && W.files[p], what + ': set-up');
    const o = JSON.parse(String(W.files[p])); edit(o);
    const files = Object.assign({}, W.files, { [copyOf(p)]: JSON.stringify(o, null, 2) + '\n' });
    const { zip, res } = await pack(W.PF, new BytesFS(files), W.key);
    assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(p) >= 0 && /two different copies/.test(u)), what + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 400));
    if (!PY) continue;
    const c = checkPack(await repacked(W.PF, zip, (e, man) => claimed(man)));
    assert.ok(!c.ok && /two different copies/.test(c.out), what + ': Python: ' + c.out);
  }
});
/* AC: an evidence plan is held to its copies as the app groups them (PF.requests.same): copies that differ are each packed,
   named and the work unconfirmed, whichever name is listed first; a plan there only as its synced copy is the plan, for the
   export and for Python alike. */
rule('An evidence plan with a copy that says something else is partial and named, either listing order; one there only as its synced copy is complete, in Python too', async () => {
  const E = (await roleWorlds()).filter((w) => w.role === 'evidence')[0];
  const pp = Object.keys(E.files).filter((p) => /^proposals\/plan-ev-[a-z]+\.json$/.test(p))[0], o = JSON.parse(String(E.files[pp]));
  assert.ok(pp, 'set-up: the evidence plan');
  const other = JSON.stringify(Object.assign({}, o, { title: o.title + ' (edited)' }), null, 2) + '\n';
  for (const first of [true, false]) {
    const rest = Object.assign({}, E.files), files = first ? Object.assign({ [copyOf(pp)]: other }, rest) : Object.assign(rest, { [copyOf(pp)]: other });
    const { zip, res } = await pack(E.PF, new BytesFS(files), E.key);
    assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(pp.slice(0, -5)) >= 0 && /two different copies/.test(u)), (first ? 'copy first' : 'copy last') + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 400));
    const man = manifestOf(zip);
    assert.ok(man.files.some((f) => f.path === pp) && man.files.some((f) => f.path === copyOf(pp)), 'both copies packed');
    if (!PY) continue;
    const c = checkPack(await repacked(E.PF, zip, (e, m) => forced(m)));
    assert.ok(!c.ok && /two different copies/.test(c.out), 'Python: ' + c.out);
  }
  const only = Object.assign({}, E.files); only[copyOf(pp)] = only[pp]; delete only[pp];
  const { zip, res } = await pack(E.PF, new BytesFS(only), E.key);
  assert.strictEqual(res.status, 'complete', 'only its synced copy: ' + JSON.stringify(res.col.unresolved));
  if (!PY) return;
  const c = checkPack(zip);
  assert.ok(c.ok, 'Python reads it: ' + c.out);
});
/* CB: receipt copies are compared by the receipt's own body (ZE's fingerprint: what it froze, never when it was written),
   as the app and the folder checker compare them: a synced copy that differs only in "at" is the same receipt for the export
   and for Python, either listing order. */
rule('A receipt copy that differs only in when it was written is the same receipt for the export and for Python, either listing order', async () => {
  const W = await made({ todos: 1 }), id = W.run.living.receipt, p = 'proposals/' + id + '.json', o = JSON.parse(String(W.files[p]));
  o.at = new Date(Date.parse(o.at) + 60000).toISOString();
  const other = JSON.stringify(o, null, 2) + '\n';
  for (const first of [true, false]) {
    const rest = Object.assign({}, W.files), files = first ? Object.assign({ [copyOf(p)]: other }, rest) : Object.assign(rest, { [copyOf(p)]: other });
    const { zip, res } = await pack(W.PF, new BytesFS(files), W.key);
    assert.strictEqual(res.status, 'complete', (first ? 'copy first' : 'copy last') + ': ' + JSON.stringify(res.col.unresolved).slice(0, 400));
    if (!PY) continue;
    const c = checkPack(zip);
    assert.ok(c.ok, (first ? 'copy first' : 'copy last') + ': Python reads it: ' + c.out);
  }
});
/* CA: the export's receipt verdict sees everything under the receipt's id: a copy that can't be read because it names another
   run, or a valid to-do request carrying the receipt's id, leaves the pack partial naming the receipt, and Python refuses a
   forced complete claim. */
rule('A copy under the receipt\'s id that names another run, or is another kind of record, leaves the pack partial, and Python refuses it as complete', async () => {
  const W = await made({ todos: 1 }), id = W.run.living.receipt, p = 'proposals/' + id + '.json', T = W.PF.todos;
  const o = JSON.parse(String(W.files[p])); o.run = Object.assign({}, o.run, { id: 'someone-else' });
  const q = T.buildProposal({ run: { process: W.run.process, id: 'someone-else' }, id, by: 'person-avery', seen: [], at: new Date().toISOString(), body: { op: 'add', text: 'Another kind', target: { phase: 'review' }, placement: T.placementFor(W.PF.run.mapOf(W.PF.run.sanitize(JSON.parse(JSON.stringify(W.run)))), { phase: 'review' }) }, app: '4.0.0' });
  for (const [what, text] of [['a copy naming another run', JSON.stringify(o, null, 2) + '\n'], ['a copy of another kind', T.text(q)]]) {
    const files = Object.assign({}, W.files, { [copyOf(p)]: text });
    const { zip, res } = await pack(W.PF, new BytesFS(files), W.key);
    assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(p) >= 0), what + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 400));
    if (!PY) continue;
    /* Forced complete with the copy packed beside the receipt (the export names an unread one without packing it). */
    const c = checkPack(await repacked(W.PF, zip, (e, man, get) => {
      forced(man);
      if (get(copyOf(p))) return;
      const f0 = get(p), f1 = Object.assign({}, f0, { path: copyOf(p), pack: f0.pack.replace(/\.json$/, ' (1).json') });
      e[f1.pack] = Buffer.from(text); man.files.push(f1);
    }));
    assert.ok(!c.ok && /receipt/.test(c.out), what + ': Python: ' + c.out);
  }
});
/* CD: Python reads every packed record by its family's reader before asking which run it names: a correctly hashed packed
   request record that the app can't read ([], {}, or a request whose run is 42) names no run it can tell, so it is a
   dependency of every checked run, and a complete claim is refused, as the export of the same folder is partial naming it. */
rule('A packed request record the app can\'t read whose run can\'t be told is refused by Python as complete, as the export names it', async () => {
  const W = await made({ todos: 1 }), p = 'proposals/req-flightdeck-' + 'e'.repeat(24) + '.json';
  const bad = JSON.parse(String(W.files[Object.keys(W.files).filter((k) => /^proposals\/req-flightdeck-/.test(k))[0]])); bad.run = 42;
  for (const [what, text] of [['a list', '[]'], ['an empty object', '{}'], ['a request whose run is 42', JSON.stringify(bad, null, 2)]]) {
    const files = Object.assign({}, W.files, { [p]: text + '\n' });
    const { res } = await pack(W.PF, new BytesFS(files), W.key);
    assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(p) >= 0), what + ': the export names it: ' + res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 300));
    if (!PY) continue;
    const ok = await pack(W.PF, new BytesFS(W.files), W.key);
    const c = checkPack(await repacked(W.PF, ok.zip, (e, man, get) => {
      const f0 = man.files.filter((f) => /^proposals\/req-/.test(f.path))[0], f1 = Object.assign({}, f0, { path: p, pack: f0.pack.replace(/[^/]+$/, p.split('/').pop()) });
      e[f1.pack] = Buffer.from(text + '\n'); man.files.push(f1);
    }));
    assert.ok(!c.ok && c.out.indexOf(p) >= 0, what + ': Python: ' + c.out);
  }
});
/* FB: one file-selection predicate, the loader's (a .json name in any case): a packed request record the app can't read named
   .JSON or .Json is refused by Python as complete, as a .json one is, and a pending request's copy named .JSON that says
   something else is two different copies for the export and for Python alike. */
rule('A packed record named .JSON or .Json is selected as the loader selects it: Python refuses an unreadable one and a copy that differs, as the export does', async () => {
  const W = await made({ todos: 1, pending: true }), ok = await pack(W.PF, new BytesFS(W.files), W.key), hex = 'e'.repeat(24);
  const td = JSON.parse(String(W.files['proposals/' + W.pendingId + '.json'])); td.run = 42;
  for (const ext of ['.JSON', '.Json']) {
    for (const [what, text] of [['an empty object', '{}'], ['a request whose run is 42', JSON.stringify(td, null, 2)]]) {
      const p = 'proposals/req-flightdeck-' + hex + ext, tag = ext + ' × ' + what;
      const { res } = await pack(W.PF, new BytesFS(Object.assign({}, W.files, { [p]: text + '\n' })), W.key);
      assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(p) >= 0), tag + ': the export names it: ' + res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 300));
      if (!PY) continue;
      const c = checkPack(await repacked(W.PF, ok.zip, (e, man) => {
        const f0 = man.files.filter((f) => /^proposals\/req-/.test(f.path))[0], f1 = Object.assign({}, f0, { path: p, pack: f0.pack.slice(0, f0.pack.indexOf(f0.path)) + p });
        e[f1.pack] = Buffer.from(text + '\n'); man.files.push(f1);
      }));
      assert.ok(!c.ok && c.out.indexOf(p) >= 0, tag + ': Python: ' + c.out);
    }
    const p = 'proposals/' + W.pendingId + '.json', o = JSON.parse(String(W.files[p])); o.text = o.text + ' (edited)';
    const cp = p.replace(/\.json$/, ' (1)' + ext), { zip, res } = await pack(W.PF, new BytesFS(Object.assign({}, W.files, { [cp]: JSON.stringify(o, null, 2) + '\n' })), W.key);
    assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(p) >= 0 && /two different copies/.test(u)), ext + ' copy: ' + res.status + ' ' + JSON.stringify(res.col.unresolved).slice(0, 400));
    if (!PY) continue;
    const c = checkPack(await repacked(W.PF, zip, (e, man) => claimed(man)));
    assert.ok(!c.ok && /two different copies/.test(c.out), ext + ' copy: Python: ' + c.out);
  }
});
/* DA: every file under proposals/ is indexed by its file-name id before any family reads it: a copy of a witness (any family
   it rests on) that parses as another family, fails as one, has an unknown format, isn't JSON or names another run holds that
   witness. The loader holds it (the to-do record's run, the scope record's loop, the evidence plan's id) and the export is
   partial. A matrix: every witness family × each kind of copy. */
const DA_COPIES = [
  ['a plan-family file', () => '{"format":"flightdeck-plan/2"}\n'],
  ['a scope-family file', () => '{"format":"flightdeck-plan/3","features":["loops"]}\n'],
  ['an unknown format', () => '{"format":"flightdeck-elsewhere/1","id":"x"}\n'],
  ['a body that isn\'t JSON', () => '{ bad'],
  ['another run', (o) => { const c = JSON.parse(JSON.stringify(o)); if (c.loop) c.loop = Object.assign({}, c.loop, { run: 'someone-else' }); else if (c.run) c.run = Object.assign({}, c.run, { id: 'someone-else' }); else c.process = 'someone-else'; c.at = 42; return JSON.stringify(c, null, 2) + '\n'; }]];
rule('A copy of any witness the work rests on, of another family, malformed, of an unknown format or naming another run, holds that witness in the loader and the export', async () => {
  const W = await made({ todos: 1, requested: true, keep: true, pending: true }), L = await loopMade(), E = (await roleWorlds()).filter((w) => w.role === 'evidence')[0];
  const wit = [];
  const byKind = {};
  Object.keys(W.files).filter((p) => /^proposals\/req-/.test(p)).sort().forEach((p) => { let o; try { o = JSON.parse(String(W.files[p])); } catch (e) { return; } if (o && o.kind && !byKind[o.kind]) byKind[o.kind] = p; });
  ['receipt', 'compound', 'proposal', 'decision', 'application', 'keep'].forEach((k) => { assert.ok(byKind[k], 'set-up: a ' + k + ' ' + JSON.stringify(Object.keys(byKind))); wit.push([k, W, byKind[k]]); });
  wit.push(['scope', L, Object.keys(L.files).filter((p) => /^proposals\/req-/.test(p) && /"loop"/.test(String(L.files[p])))[0]]);
  wit.push(['evidence plan', E, Object.keys(E.files).filter((p) => /^proposals\/plan-ev-[a-z]+\.json$/.test(p))[0]]);
  for (const [fam, X, p] of wit) {
    const o = JSON.parse(String(X.files[p]));
    for (const [what, make] of DA_COPIES) {
      const name = copyOf(p), files = Object.assign({}, X.files, { [name]: make(o) }), tag = fam + ' × ' + what;
      let Pr = null; try { Pr = await X.PF.repo.readPlans(new BytesFS(files), null, null, true); } catch (e) { Pr = null; }
      if (Pr) {
        const f = name.slice('proposals/'.length);
        const held = fam === 'scope' ? Pr.scopesUnread.some((u) => u.file === f && u.loop && u.loop.run === o.loop.run && u.loop.step === o.loop.step)
          : fam === 'evidence plan' ? (Pr.plansUnread || []).some((u) => u.file === f && u.id === o.id) || (what === 'another run')
          : Pr.todosUnread.some((u) => u.file === f && u.run && u.run.process === o.run.process && u.run.id === o.run.id);
        /* A copy read whole as its own family (a scope record of another loop) is a copy that differs: the copy rule holds it. */
        const whole = (Pr.scopes || []).concat(Pr.todos || []).some((x) => x._file === f);
        assert.ok(held || (what === 'another run' && whole), tag + ': the loader holds the witness: ' + JSON.stringify(fam === 'scope' ? Pr.scopesUnread : fam === 'evidence plan' ? Pr.plansUnread : Pr.todosUnread).slice(0, 400));
      }
      const { res } = await pack(X.PF, new BytesFS(files), X.key);
      assert.strictEqual(res.status, 'partial', tag + ': ' + JSON.stringify(res.col.unresolved).slice(0, 300));
    }
  }
});
/* EC: Python validates the packed root run's end as every reader does (end_problem), before confirming its receipt or its
   completeness: each end the readers refuse, in a pack whose manifest says complete, is refused. */
rule('Python refuses a complete pack whose root run\'s end the readers refuse (a time, a who, a field), before its receipt', async () => {
  if (!PY) return;
  const W = await made({ todos: 1, pending: true }), full = await pack(W.PF, new BytesFS(W.files), W.key), rp = 'runs/' + W.key + '/run.json';
  assert.ok(W.run.ended && W.run.living.receipt, 'set-up: ended with a receipt');
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  assert.ok(checkPack(full.zip).ok, 'control');
  const ENDS = [['a time that isn\'t one', (e) => { e.at = 'bad'; }], ['a name that isn\'t text', (e) => { e.byName = 42; }], ['a name over 80', (e) => { e.byName = 'x'.repeat(81); }],
    ['a field this copy doesn\'t know', (e) => { e.extra = 1; }], ['no time', (e) => { delete e.at; }]];
  for (const [what, damage] of ENDS) {
    const c = checkPack(await repacked(W.PF, full.zip, (e, man, f) => { const x = f(rp), o = JSON.parse(e[x.pack]); damage(o.ended); e[x.pack] = Buffer.from(JSON.stringify(o, null, 2) + '\n'); }));
    assert.ok(!c.ok && c.out.indexOf(W.key) >= 0, what + ': Python: ' + c.out);
  }
});
/* IB: Python reads each selected root's run.json, present and parsed as every reader parses it, before it decides whether
   the root has work to check: a root that isn't in the pack, isn't JSON, isn't a run or nests past what any reader reads is
   never part of a complete pack, its living section dropped or not; and living.complete false never sits under a complete
   pack. The export says partial for each of them. */
rule('Python refuses a complete pack whose root run.json is missing, not JSON, not a run or too deep, its living section dropped', async () => {
  const W = await made({ todos: 1, pending: true }), full = await pack(W.PF, new BytesFS(W.files), W.key), rp = 'runs/' + W.key + '/run.json';
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  const deep = '['.repeat(65) + ']'.repeat(65);
  const ROOTS = [['cut', '{'], ['empty', ''], ['null', 'null'], ['a list', '[]'], ['a number', '42'], ['nested 65 deep', deep]];
  for (const [what, text] of ROOTS) {
    const { res } = await pack(W.PF, new BytesFS(Object.assign({}, W.files, { [rp]: text })), W.key);
    assert.strictEqual(res.status, 'partial', what + ': the export: ' + JSON.stringify(res.col.unresolved).slice(0, 300));
  }
  if (!PY) return;
  assert.ok(checkPack(full.zip).ok, 'control');
  const drop = (man) => { man.status = 'complete'; man.runs.forEach((r) => { delete r.living; }); };
  for (const [what, text] of ROOTS.concat([['removed', null]])) {
    const c = checkPack(await repacked(W.PF, full.zip, (e, man, f) => {
      const x = f(rp);
      if (text === null) { delete e[x.pack]; man.files = man.files.filter((y) => y !== x); } else e[x.pack] = Buffer.from(text);
      drop(man);
    }));
    assert.ok(!c.ok && c.out.indexOf(W.key) >= 0, what + ': Python: ' + c.out);
  }
  const c = checkPack(await repacked(W.PF, full.zip, (e, man) => { man.status = 'complete'; man.runs.forEach((r) => { if (r.living) r.living.complete = false; }); }));
  assert.ok(!c.ok && c.out.indexOf(W.key) >= 0, 'living.complete false under a complete pack: Python: ' + c.out);
});
/* JD: a pack made for one run names that run in its manifest exactly once, as every export does (partial ones included):
   a manifest whose runs leave the selected run out, or name it twice, is refused before anything is called complete. */
rule('Python refuses a pack whose manifest leaves out the run it was made for, or names it twice', async () => {
  if (!PY) return;
  const W = await made({ todos: 1, pending: true }), full = await pack(W.PF, new BytesFS(W.files), W.key), rp = 'runs/' + W.key + '/run.json';
  assert.ok(checkPack(full.zip).ok, 'control');
  assert.strictEqual(manifestOf(full.zip).scope.run, W.key, 'set-up: the pack is made for the run');
  const left = checkPack(await repacked(W.PF, full.zip, (e, man, f) => { e[f(rp).pack] = Buffer.from('[]'); man.status = 'complete'; man.runs = []; }));
  assert.ok(!left.ok && left.out.indexOf(W.key) >= 0, 'left out: Python: ' + left.out);
  const twice = checkPack(await repacked(W.PF, full.zip, (e, man) => { man.runs = man.runs.concat([JSON.parse(JSON.stringify(man.runs[0]))]); }));
  assert.ok(!twice.ok && twice.out.indexOf(W.key) >= 0, 'named twice: Python: ' + twice.out);
});
/* JE: an honest partial pack whose root run.json is no run (a list, a number, true, a string) is read without reading the
   root's fields: Python accepts it as partial, and a complete claim on it stays refused. */
rule('Python accepts an honest partial pack whose root run.json is no run, and refuses it claimed complete', async () => {
  const W = await made({ todos: 1, pending: true }), rp = 'runs/' + W.key + '/run.json';
  for (const text of ['[]', '42', 'true', '"run"']) {
    const { res, zip } = await pack(W.PF, new BytesFS(Object.assign({}, W.files, { [rp]: text })), W.key);
    assert.strictEqual(res.status, 'partial', text + ': the export');
    if (!PY) continue;
    const c = checkPack(zip);
    assert.ok(c.ok, text + ': the honest partial pack: ' + c.out);
    const claimed = checkPack(await repacked(W.PF, zip, (e, man) => { forced(man); }));
    assert.ok(!claimed.ok && claimed.out.indexOf(W.key) >= 0, text + ': claimed complete: ' + claimed.out);
  }
});
/* KB-KD: Python checks the manifest's shape once, before anything else (manifest_problem): a scope in neither form the export
   writes, two files from one source path, a run named twice, and the packed run.json originals not matching the manifest's
   runs one to one (a run.json packed as a run without its entry, or not named by any run's work; a run's entry without its
   run.json, unless the pack says partial), in both scope forms and both entry orders. */
const otherRoot = (W, id) => { const o = JSON.parse(String(W.files['runs/' + W.key + '/run.json'])); o.id = id; delete o.living; delete o.ended; o.state = 'running'; if (Array.isArray(o.features)) o.features = o.features.filter(f => f !== 'living-runs'); return JSON.stringify(o, null, 2) + '\n'; };
rule('Python refuses a date-range pack whose manifest drops a run or leaves one out, in either entry order', async () => {
  const W = await made({ todos: 1, pending: true }), proc = W.key.split('/')[0];
  const files = Object.assign({}, W.files, { ['runs/' + proc + '/aa-other/run.json']: otherRoot(W, 'aa-other'), ['runs/' + proc + '/zz-other/run.json']: otherRoot(W, 'zz-other') });
  const full = await datePack(W.PF, new BytesFS(files), proc), man0 = manifestOf(full.zip);
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  assert.strictEqual(man0.runs.length, 3, 'set-up: three runs in the range');
  if (!PY) return;
  assert.ok(checkPack(full.zip).ok, 'control: ' + checkPack(full.zip).out);
  const rjOf = (man, key) => man.files.filter((f) => f.path === 'runs/' + key + '/run.json')[0];
  const cases = [
    ['runs emptied, the living run\'s run.json made []', (e, man) => { e[rjOf(man, W.key).pack] = Buffer.from('[]'); man.runs = []; }],
    ['the first run left out, its run.json made []', (e, man) => { const k = man.runs[0].key; e[rjOf(man, k).pack] = Buffer.from('[]'); man.runs = man.runs.slice(1); }],
    ['the last run left out, its run.json made []', (e, man) => { const k = man.runs[man.runs.length - 1].key; e[rjOf(man, k).pack] = Buffer.from('[]'); man.runs = man.runs.slice(0, -1); }],
    ['the first run left out, its run.json relabeled', (e, man) => { const k = man.runs[0].key; rjOf(man, k).role = 'child run'; man.runs = man.runs.slice(1); }],
    ['a run named twice, the copy first', (e, man) => { man.runs = [JSON.parse(JSON.stringify(man.runs[1]))].concat(man.runs); }],
    ['a run named twice, the copy last', (e, man) => { man.runs = man.runs.concat([JSON.parse(JSON.stringify(man.runs[1]))]); }],
    ['a run of another process', (e, man) => { man.runs[0].key = 'release/' + man.runs[0].key.split('/')[1]; }],
    ['a run whose run.json isn\'t packed, in a complete pack', (e, man) => { man.runs = man.runs.concat([Object.assign({}, man.runs[0], { key: proc + '/not-packed', living: undefined })]); }]
  ];
  for (const [what, edit] of cases) {
    const c = checkPack(await repacked(W.PF, full.zip, edit));
    assert.ok(!c.ok, what + ': Python: ' + c.out);
  }
});
rule('Python refuses a pack whose scope is missing, null, a list or neither form, in a single-run pack and a date-range pack', async () => {
  if (!PY) return;
  const W = await made({ todos: 1, pending: true }), proc = W.key.split('/')[0];
  for (const [form, made2] of [['single run', () => pack(W.PF, new BytesFS(W.files), W.key)], ['date range', () => datePack(W.PF, new BytesFS(W.files), proc)]]) {
    const full = await made2();
    assert.ok(checkPack(full.zip).ok, form + ' control');
    for (const [what, scope] of [['missing', undefined], ['null', null], ['a list', []], ['empty', {}], ['a process without its dates', { process: proc, tz: 'UTC' }], ['a run that isn\'t a key', { run: 42, tz: 'UTC' }], ['both forms', { run: W.key, process: proc, from: '2026-01-01', through: '2026-01-01', tz: 'UTC' }]]) {
      const c = checkPack(await repacked(W.PF, full.zip, (e, man) => { if (scope === undefined) delete man.scope; else man.scope = scope; }));
      assert.ok(!c.ok, form + ', scope ' + what + ': Python: ' + c.out);
    }
  }
});
rule('Python refuses a pack that holds two files from one source path, the copy first or last', async () => {
  if (!PY) return;
  const W = await made({ todos: 1, pending: true }), full = await pack(W.PF, new BytesFS(W.files), W.key);
  const head = JSON.parse(String(W.files['runs/' + W.key + '/run.json'])).living.head, src = 'proposals/' + head + '.json';
  assert.ok(manifestOf(full.zip).files.some((f) => f.path === src), 'set-up: the application is packed');
  for (const first of [true, false]) {
    const c = checkPack(await repacked(W.PF, full.zip, (e, man) => {
      e['originals/proposals/dup.json'] = Buffer.from('[]');
      const f = { pack: 'originals/proposals/dup.json', path: src, size: 2, sha256: '', role: 'living', label: 'A copy' };
      man.files = first ? [f].concat(man.files) : man.files.concat([f]);
    }));
    assert.ok(!c.ok, (first ? 'first' : 'last') + ': Python: ' + c.out);
  }
});
/* KC: an honest partial date-range pack whose other run.json is no run (42) is read without reading that file's fields. */
rule('Python accepts an honest partial date-range pack with a run.json that is no run beside a living run, and refuses it claimed complete', async () => {
  const W = await made({ todos: 1, pending: true }), proc = W.key.split('/')[0];
  const { res, zip } = await datePack(W.PF, new BytesFS(Object.assign({}, W.files, { ['runs/' + proc + '/zz-broken/run.json']: '42' })), proc);
  assert.strictEqual(res.status, 'partial', 'the export');
  if (!PY) return;
  const c = checkPack(zip);
  assert.ok(c.ok, 'the honest partial pack: ' + c.out);
  const claimed = checkPack(await repacked(W.PF, zip, (e, man) => { forced(man); }));
  assert.ok(!claimed.ok, 'claimed complete: ' + claimed.out);
});
/* FD: living work needs run/3. An ended living run written back as run/2 (no run/3 field but its living record) is refused
   by every reader as newer, so the export of it is partial and Python refuses a pack of it that says complete. */
rule('An ended living run written as run/2 is partial in the export, and Python refuses a complete pack of it', async () => {
  const W = await made({ todos: 1, pending: true }), rp = 'runs/' + W.key + '/run.json', full = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.ok(W.run.ended && W.run.living.receipt, 'set-up: ended with a receipt');
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  const RUN3_ONLY = ['features', 'app', 'typesHash', 'payload', 'pins', 'migrations', 'test', 'stage', 'searchSites', 'searchGen', 'searchRec'];
  const two = (o) => { o.format = 'preflight-run/2'; RUN3_ONLY.forEach((f) => { delete o[f]; }); return o; };
  const o = two(JSON.parse(String(W.files[rp])));
  const { res } = await pack(W.PF, new BytesFS(Object.assign({}, W.files, { [rp]: JSON.stringify(o, null, 2) + '\n' })), W.key);
  assert.strictEqual(res.status, 'partial', 'the export: ' + JSON.stringify(res.col.unresolved).slice(0, 300));
  assert.ok(res.col.unresolved.some((u) => u.indexOf(rp) >= 0 && u.indexOf('"living"') >= 0), 'names run.json and its living record: ' + JSON.stringify(res.col.unresolved).slice(0, 300));
  if (!PY) return;
  const c = checkPack(await repacked(W.PF, full.zip, (e, man, f) => { const x = f(rp); e[x.pack] = Buffer.from(JSON.stringify(two(JSON.parse(e[x.pack])), null, 2) + '\n'); }));
  assert.ok(!c.ok && c.out.indexOf(W.key) >= 0, 'Python: ' + c.out);
});
/* GA: the readers' whole verdict on run.json, applied to the packed root run before any gate: a run.json any reader refuses
   (its envelope, an unknown field, a value the readers drop or can't read) is partial in the export, naming run.json, and
   Python refuses a pack of it that claims the work complete with the run's own living metadata. */
rule('An ended living run whose run.json any reader refuses is partial in the export, and Python refuses a complete pack of it', async () => {
  const W = await made({ todos: 1, pending: true }), rp = 'runs/' + W.key + '/run.json', full = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.ok(W.run.ended && W.run.living.receipt, 'set-up: ended with a receipt');
  assert.strictEqual(full.res.status, 'complete', JSON.stringify(full.res.col.unresolved));
  assert.ok(!PY || checkPack(full.zip).ok, 'control');
  const CASES = [['app', (r) => { r.app = 'bad'; }], ['format', (r) => { r.format = 'preflight-run/4'; }], ['an unknown feature', (r) => { r.features = r.features.concat(['future-feature']); }],
    ['an unknown field', (r) => { r.future = 1; }], ['features not a list', (r) => { r.features = 'living-runs'; }], ['created', (r) => { r.created = 'bad'; }],
    ['title', (r) => { r.title = 42; }], ['recorder.person', (r) => { r.recorder.person = 42; }]];
  for (const [what, damage] of CASES) {
    const o = JSON.parse(String(W.files[rp])); damage(o);
    const { res } = await pack(W.PF, new BytesFS(Object.assign({}, W.files, { [rp]: JSON.stringify(o, null, 2) + '\n' })), W.key);
    assert.strictEqual(res.status, 'partial', what + ': the export: ' + JSON.stringify(res.col.unresolved).slice(0, 300));
    assert.ok(res.col.unresolved.some((u) => u.indexOf(rp) >= 0), what + ': names run.json: ' + JSON.stringify(res.col.unresolved).slice(0, 300));
    if (!PY) continue;
    const c = checkPack(await repacked(W.PF, full.zip, (e, man, f) => { const x = f(rp), r = JSON.parse(e[x.pack]); damage(r); e[x.pack] = Buffer.from(JSON.stringify(r, null, 2) + '\n'); }));
    assert.ok(!c.ok && c.out.indexOf(W.key) >= 0, what + ': Python: ' + c.out);
  }
});
/* FA: the raw run's end and living record are judged before every "no living work" gate: a run without to-dos whose run.json
   names the living-runs feature without its record, or holds a living record that is null or a list (sanitizing would
   drop each; an empty head is a living run with nothing landed yet since slice 3), is partial in the export, and Python refuses a pack of it with no living section. */
rule('A run whose living record the readers refuse but sanitizing drops is partial in the export, and Python refuses a pack without a living section', async () => {
  const W = await made({ todos: 1 }), rp = 'runs/' + W.key + '/run.json', ok = await pack(W.PF, new BytesFS(W.files), W.key);
  const bare = Object.assign({}, W.files); Object.keys(bare).filter((k) => /^proposals\//.test(k)).forEach((k) => { delete bare[k]; });
  const LIVING = [['the feature without its record', (o) => { delete o.living; }], ['a null record', (o) => { o.living = null; }], ['a list', (o) => { o.living = []; }]];
  for (const [what, damage] of LIVING) {
    const o = JSON.parse(String(W.files[rp])); damage(o); delete o.ended;
    const { res } = await pack(W.PF, new BytesFS(Object.assign({}, bare, { [rp]: JSON.stringify(o, null, 2) + '\n' })), W.key);
    assert.strictEqual(res.status, 'partial', what + ': the export: ' + JSON.stringify(res.col.unresolved).slice(0, 300));
    assert.ok(res.col.unresolved.some((u) => u.indexOf(rp) >= 0), what + ': names run.json: ' + JSON.stringify(res.col.unresolved).slice(0, 300));
    if (!PY) continue;
    /* A pack of it with no living section and none of its records: only Python's own reading of run.json can refuse it. */
    const c = checkPack(await repacked(W.PF, ok.zip, (e, man, f) => {
      const x = f(rp), r = JSON.parse(e[x.pack]); damage(r); delete r.ended; e[x.pack] = Buffer.from(JSON.stringify(r, null, 2) + '\n');
      man.files.filter((y) => /^proposals\//.test(y.path)).forEach((y) => { delete e[y.pack]; }); man.files = man.files.filter((y) => !/^proposals\//.test(y.path));
      man.runs.forEach((m) => { delete m.living; }); man.status = 'complete';
    }));
    assert.ok(!c.ok && c.out.indexOf(W.key) >= 0, what + ': Python: ' + c.out);
  }
});
/* EA: the file-name index groups every result, successful reads too: a copy under a witness's name that reads whole as
   another record (a 1.x plan, a plan/2, a plan decision of either format, a to-do record of another id, a scope record) holds
   that witness in the loader and the export, as a copy that differs. A matrix: each witness family × each valid record. */
rule('A copy under any witness\'s name that reads whole as another valid record (any family) holds that witness in the loader and the export', async () => {
  const W = await made({ todos: 1, requested: true, keep: true, pending: true }), L = await loopMade(), E = (await roleWorlds()).filter((w) => w.role === 'evidence')[0];
  const byKind = {}, wit = [];
  Object.keys(W.files).filter((p) => /^proposals\/req-/.test(p)).sort().forEach((p) => { let o; try { o = JSON.parse(String(W.files[p])); } catch (e) { return; } if (o && o.kind && !byKind[o.kind]) byKind[o.kind] = p; });
  ['receipt', 'compound', 'proposal', 'decision', 'application', 'keep'].forEach((k) => wit.push([k, W, byKind[k]]));
  const scopeP = Object.keys(L.files).filter((p) => /^proposals\/req-/.test(p) && /"loop"/.test(String(L.files[p])))[0], planP = Object.keys(E.files).filter((p) => /^proposals\/plan-ev-[a-z]+\.json$/.test(p))[0];
  wit.push(['scope', L, scopeP]); wit.push(['evidence plan', E, planP]);
  const DEC = { proposal: 'plan-other', proposalHash: 'x', status: 'declined', run: null, by: 'person-avery', at: '2026-11-09T09:00:00.000Z' };
  const VALID = [['a 1.x plan', String(W.files['proposals/plan-release-2026-10-24.json'])], ['a plan/2', String(E.files[planP])],
    ['a 1.x plan decision', JSON.stringify(Object.assign({ kind: 'status' }, DEC), null, 2) + '\n'],
    ['a plan-status/2 decision', JSON.stringify(Object.assign({ format: 'flightdeck-plan-status/2', app: '4.0.0' }, DEC), null, 2) + '\n'],
    ['a to-do record of another id', String(W.files[Object.keys(W.files).filter((p) => /^proposals\/req-notes-bot-[0-9a-f]+\.json$/.test(p))[0]])],
    ['a scope record', String(L.files[scopeP])]];
  for (const [fam, X, p] of wit) {
    assert.ok(p, 'set-up: a ' + fam);
    const o = JSON.parse(String(X.files[p]));
    for (const [what, text] of VALID) {
      if (text === String(X.files[p])) continue;
      const name = copyOf(p), f = name.slice('proposals/'.length), files = Object.assign({}, X.files, { [name]: text }), tag = fam + ' × ' + what;
      const Pr = await X.PF.repo.readPlans(new BytesFS(files), null, null, true);
      const held = fam === 'scope' ? Pr.scopesUnread.some((u) => u.file === f && u.loop && u.loop.run === o.loop.run && u.loop.step === o.loop.step)
        : fam === 'evidence plan' ? (Pr.plansUnread || []).some((u) => u.file === f && u.id === o.id)
        : Pr.todosUnread.some((u) => u.file === f && u.run && u.run.process === o.run.process && u.run.id === o.run.id);
      assert.ok(held, tag + ': the loader holds the witness: ' + JSON.stringify(fam === 'scope' ? Pr.scopesUnread : fam === 'evidence plan' ? Pr.plansUnread : Pr.todosUnread).slice(0, 400));
      const { res } = await pack(X.PF, new BytesFS(files), X.key);
      assert.strictEqual(res.status, 'partial', tag + ': ' + JSON.stringify(res.col.unresolved).slice(0, 300));
    }
  }
});
/* DC: Python dispatches every packed record by its family before any filter or gate: a request record, a scope record or a
   file of no family that the app can't read and whose run or loop can't be told is part of every checked run's work, whether
   or not the pack has a living section, as the export of the same folder is partial. A matrix: each kind of unreadable
   record × a living pack forced complete and a pack of a run without to-dos. */
rule('Python dispatches every packed record by its family before any filter: an unattributable unreadable record is refused, living section or not', async () => {
  const LW = await made({ todos: 1 }), PW = await made({ todos: 0 }), hex = 'e'.repeat(24);
  const td = JSON.parse(String(LW.files[Object.keys(LW.files).filter((k) => /^proposals\/req-flightdeck-/.test(k))[0]])); td.run = 42;
  const RECS = [['a scope request whose loop is 42', 'req-notes-bot-' + hex, JSON.stringify({ format: 'flightdeck-plan/3', features: ['loops'], id: 'req-notes-bot-' + hex, loop: 42 })],
    ['a plan/3 file of no loop', 'req-bot-' + hex, '{"format":"flightdeck-plan/3"}'], ['a list', 'req-flightdeck-' + hex, '[]'], ['an empty object', 'req-flightdeck-' + hex, '{}'],
    ['a to-do whose run is 42', 'req-flightdeck-' + hex, JSON.stringify(td)]];
  for (const [world, X] of [['a living pack', LW], ['a run without to-dos', PW]]) {
    const ok = await pack(X.PF, new BytesFS(X.files), X.key), [proc, rid] = X.key.split('/');
    /* ED: a malformed scope record whose loop names the selected run is that run's work at the living gate too. */
    const mine = [['a malformed scope request whose loop names this run', 'req-notes-bot-' + hex, JSON.stringify({ format: 'flightdeck-plan/3', features: ['loops'], id: 'req-notes-bot-' + hex, loop: { process: proc, run: rid, step: 'each-item' } })],
      /* FC: a malformed to-do whose run names this run with one key too many is this run's work, as runOf reads it. */
      ['a to-do whose run is this run with an extra key', 'req-flightdeck-' + hex, JSON.stringify(Object.assign({}, td, { run: { process: proc, id: rid, extra: 1 } }))],
      ['a scope request whose loop is this run with an extra key', 'req-notes-bot-' + hex, JSON.stringify({ format: 'flightdeck-plan/3', features: ['loops'], id: 'req-notes-bot-' + hex, loop: { process: proc, run: rid, step: 'each-item', extra: 1 } })]];
    for (const [what, stem, text] of RECS.concat(mine)) {
      const p = 'proposals/' + stem + '.json', tag = world + ' × ' + what;
      const { res } = await pack(X.PF, new BytesFS(Object.assign({}, X.files, { [p]: text + '\n' })), X.key);
      assert.strictEqual(res.status, 'partial', tag + ': the export: ' + JSON.stringify(res.col.unresolved).slice(0, 300));
      if (!PY) continue;
      const c = checkPack(await repacked(X.PF, ok.zip, (e, man) => {
        if (world === 'a living pack') forced(man);
        const f0 = man.files.filter((f) => /^proposals\/|^runs\//.test(f.path))[0], f1 = Object.assign({}, f0, { path: p, pack: f0.pack.slice(0, f0.pack.indexOf(f0.path)) + p });
        e[f1.pack] = Buffer.from(text + '\n'); man.files.push(f1);
      }));
      assert.ok(!c.ok, tag + ': Python: ' + c.out);
    }
  }
});
/* MD: a keep's standing is worked out from its process's runs and versions; when that scan is capped, the pack can't confirm
   it, so it is partial and names why, and Python refuses a complete claim that carries the failure. */
rule('A keep whose standing can\'t be worked out (its process too big to read) leaves the pack partial, and Python refuses a complete claim', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), files = Object.assign({}, W.files);
  /* Another run of the same process, 3 MiB: with an 8 MiB cap, the process is too big to read for where its keeps stand. */
  files['runs/release-notes/padrun0001/run.json'] = JSON.stringify({ format: 'preflight-run/2', pad: 'x'.repeat(3 * 1048576) });
  const ctl = await pack(W.PF, new BytesFS(W.files), W.key, { cap: 8 * 1048576 });
  assert.strictEqual(ctl.res.status, 'complete', 'the control: ' + JSON.stringify(ctl.res.col.unresolved));
  const { zip, res } = await pack(W.PF, new BytesFS(files), W.key, { cap: 8 * 1048576 });
  const mr = manifestOf(zip).runs[0], cl = mr.claims.filter((c) => c.correction === W.keepId)[0];
  assert.ok(cl && !cl.verified && /too big/.test(cl.status), 'set-up: the keep\'s claim can\'t be confirmed ' + JSON.stringify(mr.claims));
  assert.strictEqual(res.status, 'partial', 'the export: ' + JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some((u) => /too big/.test(u) && u.indexOf(W.key) >= 0), JSON.stringify(res.col.unresolved));
  assert.ok(mr.living && !mr.living.complete, 'the living work isn\'t called complete');
  if (!PY) return;
  assert.ok(checkPack(zip).ok, 'the honest partial pack is accepted');
  const bad = checkPack(await repacked(W.PF, zip, (e, man) => forced(man)));
  assert.ok(!bad.ok && /claim|keep/.test(bad.out), 'Python refuses a complete claim: ' + bad.out);
});

/* MC: the manifest's nested shapes, checked before anything reads them: the scope's exact keys, each dependency named once,
   the receipt's metadata typed and agreeing with the packed run (none while it runs; its own id and a confirmed state only
   when the pack's receipt confirms it), and real, ordered days with each readable root started inside them in the pack's
   time zone. */
rule('Python refuses a scope with an extra key, in either form', async () => {
  if (!PY) return;
  const W = await made({ todos: 1, pending: true }), proc = W.key.split('/')[0];
  for (const [form, made2] of [['single run', () => pack(W.PF, new BytesFS(W.files), W.key)], ['date range', () => datePack(W.PF, new BytesFS(W.files), proc)]]) {
    const full = await made2();
    assert.ok(checkPack(full.zip).ok, form + ' control');
    for (const [what, edit] of [['an extra key', (sc) => { sc.extra = 42; }], ['no time zone', (sc) => { delete sc.tz; }], ['a time zone that is no zone', (sc) => { sc.tz = 'Not/AZone'; }], ['a time zone that isn\'t text', (sc) => { sc.tz = 42; }]]) {
      const c = checkPack(await repacked(W.PF, full.zip, (e, man) => edit(man.scope)));
      assert.ok(!c.ok && /scope|time zone/.test(c.out), form + ', ' + what + ': Python: ' + c.out);
    }
  }
});
rule('Python refuses a pack naming a run its work depends on twice, the copy first or last', async () => {
  if (!PY) return;
  const L = await loopMade(), full = await pack(L.PF, new BytesFS(L.files), L.key), man0 = manifestOf(full.zip);
  assert.ok(checkPack(full.zip).ok, 'control: ' + checkPack(full.zip).out);
  assert.ok((man0.runs[0].living.deps || []).length, 'set-up: the parent depends on a run');
  for (const first of [true, false]) {
    const c = checkPack(await repacked(L.PF, full.zip, (e, man) => {
      const lv = man.runs[0].living, d = Object.assign({}, lv.deps[0], { head: 'other', chain: [] });
      lv.deps = first ? [d].concat(lv.deps) : lv.deps.concat([d]);
    }));
    assert.ok(!c.ok && /twice/.test(c.out), (first ? 'first' : 'last') + ': Python: ' + c.out);
  }
});
rule('Python refuses receipt metadata that isn\'t the export\'s or doesn\'t agree with the packed run, running or ended', async () => {
  if (!PY) return;
  const R0 = await made({ todos: 1, end: false }), run = await pack(R0.PF, new BytesFS(R0.files), R0.key);
  assert.strictEqual(manifestOf(run.zip).runs[0].living.receipt, null, 'set-up: a running run has no receipt');
  assert.ok(checkPack(run.zip).ok, 'running control: ' + checkPack(run.zip).out);
  const W = await made({ todos: 1 }), ended = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.ok(checkPack(ended.zip).ok, 'ended control: ' + checkPack(ended.zip).out);
  const id = W.run.living.receipt;
  const cases = [
    ['running, a fabricated confirmed receipt', run, (lv) => { lv.receipt = { id: '', state: 'confirmed', why: '' }; }],
    ['running, a fabricated receipt with an id', run, (lv) => { lv.receipt = { id: id, state: 'confirmed', why: '' }; }],
    ['ended, the receipt dropped', ended, (lv) => { lv.receipt = null; }],
    ['ended, its state a list', ended, (lv) => { lv.receipt.state = []; }],
    ['ended, a state the export never writes', ended, (lv) => { lv.receipt.state = 'fine'; }],
    ['ended, its why a number', ended, (lv) => { lv.receipt.why = 42; }],
    ['ended, an extra key', ended, (lv) => { lv.receipt.extra = 1; }],
    ['ended, the receipt a list', ended, (lv) => { lv.receipt = []; }]
  ];
  for (const [what, base, edit] of cases) {
    const c = checkPack(await repacked(W.PF, base.zip, (e, man) => edit(man.runs[0].living)));
    assert.ok(!c.ok && /receipt|living section/.test(c.out), what + ': Python: ' + c.out);
  }
  /* A receipt the export couldn't confirm, said confirmed: the receipt deleted from the pack, everything else forced. */
  const rp = 'proposals/' + id + '.json';
  const lie = checkPack(await repacked(W.PF, ended.zip, (e, man, g) => { const y = g(rp); delete e[y.pack]; man.files = man.files.filter((z) => z.path !== rp); man.status = 'partial'; man.runs[0].living.complete = false; }));
  assert.ok(!lie.ok && /receipt/.test(lie.out), 'a confirmed receipt the pack doesn\'t hold, in a partial pack: ' + lie.out);
});
rule('Python refuses days that aren\'t real or are out of order, and a root started outside them in the pack\'s time zone', async () => {
  if (!PY) return;
  const W = await made({ todos: 1, pending: true }), proc = W.key.split('/')[0], full = await datePack(W.PF, new BytesFS(W.files), proc);
  assert.ok(checkPack(full.zip).ok, 'control: ' + checkPack(full.zip).out);
  const created = JSON.parse(String(W.files['runs/' + W.key + '/run.json'])).created, day = (ms) => new Date(ms).toISOString().slice(0, 10), t = Date.parse(created);
  const cases = [
    ['February 30th', (sc) => { sc.from = '2026-02-30'; sc.through = '2026-02-30'; }],
    ['month 13', (sc) => { sc.through = '2026-13-01'; }],
    ['the last day before the first', (sc) => { sc.from = day(t + 86400000); sc.through = day(t - 86400000); }],
    ['days after the run started', (sc) => { sc.from = day(t + 86400000); sc.through = day(t + 2 * 86400000); }],
    ['days before the run started', (sc) => { sc.from = day(t - 2 * 86400000); sc.through = day(t - 86400000); }],
    /* 14 hours ahead moves the start to another day unless it's 10:00 or later UTC; 12 hours behind, unless it's before 12:00. */
    ['the same day in a zone where the run started on another', (sc) => { sc.tz = new Date(t).getUTCHours() < 12 ? 'Etc/GMT+12' : 'Pacific/Kiritimati'; }]
  ];
  for (const [what, edit] of cases) {
    const c = checkPack(await repacked(W.PF, full.zip, (e, man) => { edit(man.scope); man.tz = man.scope.tz; }));
    assert.ok(!c.ok && /day|date|range|started/.test(c.out), what + ': Python: ' + c.out);
  }
});

/* NB: a fact a to-do record rests on is followed through what it saw (its seen), in turn, as every other record is: a
   predecessor fact gone from the folder leaves the pack partial by its path, and Python refuses a complete claim without it. */
rule('A fact the work rests on is followed through the facts it saw: one gone leaves the pack partial, and Python refuses a complete claim', async () => {
  const W = await loopMade(), PF = W.PF, T = PF.todos, F = PF.facts, P = PF.run.sanitize(JSON.parse(JSON.stringify(W.run)));
  const got = await PF.repo.readTodos(new BytesFS(W.files)), V = T.view(P, { records: got.records, people: JSON.parse(W.files['people.json']) });
  const x = Object.keys(V.byTodo).map((k) => V.byTodo[k])[0], item = PF.loop.view(P, 'each', { records: got.scopes, runs: [P], procOf: () => null }).rollup.items[0];
  const at = new Date().toISOString(), BB = { feed: 'bitbucket', site: 'git.example.com' };
  const fact = (key, seen, n) => F.build({ run: P, producer: { name: 'git-bot', version: '1.0' }, key, seen, at, app: '4.0.0', loopStep: 'each', uid: item.uid, attempt: 1, source: BB, domain: 'prs', observedAt: at, maxAgeSeconds: 86400, complete: true, reported: n, fetched: n, errors: [], entries: [{ id: '1', text: 'Change 1', state: 'merged' }].concat(n > 1 ? [{ id: '2', text: 'Change 2', state: 'merged' }] : []) });
  const f1 = fact('prs-1', [], 1), f2 = fact('prs-2', [f1.id], 2), fr = T.cleanFile(JSON.parse(T.text(f2)), f2.id + '.json').record;
  assert.deepStrictEqual(fr.seen, [f1.id], 'set-up: the second fact saw the first');
  const q = T.buildProposal({ run: { process: P.process, id: P.id }, producer: { name: 'git-bot', version: '1.0' }, seen: [], at, body: { op: 'done', todo: x.id, support: { fact: f2.id, content: fr.content, incarnation: x.added, source: BB, domain: 'prs' } } });
  const f1p = 'proposals/' + f1.id + '.json', files = Object.assign({}, W.files, { [f1p]: T.text(f1), ['proposals/' + f2.id + '.json']: T.text(f2), ['proposals/' + q.id + '.json']: T.text(q) });
  const full = await pack(PF, new BytesFS(files), W.key);
  assert.strictEqual(full.res.status, 'complete', 'the control: ' + JSON.stringify(full.res.col.unresolved));
  assert.ok(manifestOf(full.zip).files.some((y) => y.path === f1p), 'set-up: the first fact is packed');
  const less = Object.assign({}, files); delete less[f1p];
  const { res } = await pack(PF, new BytesFS(less), W.key);
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(f1.id) >= 0), 'the export names it: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
  if (!PY) return;
  assert.ok(checkPack(full.zip).ok, 'Python accepts the control: ' + checkPack(full.zip).out);
  const bad = checkPack(await repacked(PF, full.zip, (e, man, g) => { const y = g(f1p); delete e[y.pack]; man.files = man.files.filter((z) => z.path !== f1p); forced(man); }));
  assert.ok(!bad.ok && bad.out.indexOf(f1.id) >= 0, 'Python refuses it: ' + bad.out);
});
/* OA: a fact's predecessors are walked depth first: each one a single fact of the same run, and one met again while still
   being followed is a circle, named. The export is partial, the closure ending reads names it, and Python refuses a complete
   claim. */
rule('A fact whose predecessors go round in a circle or aren\'t facts of its run leaves the work unconfirmed, named', async () => {
  const W = await loopMade(), PF = W.PF, T = PF.todos, F = PF.facts, P = PF.run.sanitize(JSON.parse(JSON.stringify(W.run)));
  const got = await PF.repo.readTodos(new BytesFS(W.files)), V = T.view(P, { records: got.records, people: JSON.parse(W.files['people.json']) });
  const x = Object.keys(V.byTodo).map((k) => V.byTodo[k])[0], item = PF.loop.view(P, 'each', { records: got.scopes, runs: [P], procOf: () => null }).rollup.items[0];
  const at = new Date().toISOString(), BB = { feed: 'bitbucket', site: 'git.example.com' };
  const fact = (key, seen, n, run) => F.build({ run: run || P, producer: { name: 'git-bot', version: '1.0' }, key, seen, at, app: '4.0.0', loopStep: 'each', uid: item.uid, attempt: 1, source: BB, domain: 'prs', observedAt: at, maxAgeSeconds: 86400, complete: true, reported: n, fetched: n, errors: [], entries: [{ id: '1', text: 'Change 1', state: 'merged' }].concat(n > 1 ? [{ id: '2', text: 'Change 2', state: 'merged' }] : []) });
  const id2 = F.idFor('git-bot', 'prs-2');
  const other = { process: P.process, id: 'otherrun0001' };
  const worlds = {
    'a circle': () => [fact('prs-1', [id2], 1)],
    'a predecessor that is a request': () => [T.buildProposal({ run: { process: P.process, id: P.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-oa', seen: [], at, body: { op: 'done', todo: x.id } })],
    'a predecessor that is another run\'s fact': () => [fact('prs-1', [], 1, other)]
  };
  const misses = [];
  for (const what of Object.keys(worlds)) {
    const pre = worlds[what]();
    const f2 = fact('prs-2', [pre[0].id], 2), fr = T.cleanFile(JSON.parse(T.text(f2)), f2.id + '.json').record;
    const q = T.buildProposal({ run: { process: P.process, id: P.id }, producer: { name: 'git-bot', version: '1.0' }, seen: [], at, body: { op: 'done', todo: x.id, support: { fact: f2.id, content: fr.content, incarnation: x.added, source: BB, domain: 'prs' } } });
    const files = Object.assign({}, W.files, { ['proposals/' + f2.id + '.json']: T.text(f2), ['proposals/' + q.id + '.json']: T.text(q) });
    pre.forEach((y) => { files['proposals/' + y.id + '.json'] = T.text(y); });
    const read = await PF.repo.readTodos(new BytesFS(files));
    const D = PF.receipts.deps(P, { records: read.records, unread: read.unread, scopes: read.scopes, scopesUnread: read.scopesUnread, runs: {}, kids: {}, runBad: [] });
    const why = what === 'a circle' ? /circle/ : /isn't a fact of the same run/;
    if (!D.missing.some((m) => m.indexOf(pre[0].id) >= 0 && why.test(m))) misses.push(what + ': the closure ending reads doesn\'t name it: ' + JSON.stringify(D.missing));
    const { res, zip } = await pack(PF, new BytesFS(files), W.key);
    if (!(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(pre[0].id) >= 0 && why.test(u)))) misses.push(what + ': the export: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    if (PY) { const c = checkPack(await repacked(PF, zip, (e, man) => forced(man))); if (c.ok || c.out.indexOf(pre[0].id) < 0 || !why.test(c.out)) misses.push(what + ': Python: ' + c.out); }
  }
  assert.deepStrictEqual(misses, []);
});
/* QA: every edge is checked, whatever was walked first: A (this run) and B (another run, which saw A) each rest a to-do
   request, and B -> A is named whichever fact is visited first, by the closure ending reads, the export and Python. */
rule('A fact seen by a fact of another run is named whichever of them is walked first', async () => {
  const W = await loopMade(), PF = W.PF, T = PF.todos, F = PF.facts, P = PF.run.sanitize(JSON.parse(JSON.stringify(W.run)));
  const got = await PF.repo.readTodos(new BytesFS(W.files)), V = T.view(P, { records: got.records, people: JSON.parse(W.files['people.json']) });
  const x = Object.keys(V.byTodo).map((k) => V.byTodo[k])[0], item = PF.loop.view(P, 'each', { records: got.scopes, runs: [P], procOf: () => null }).rollup.items[0];
  const at = new Date().toISOString(), BB = { feed: 'bitbucket', site: 'git.example.com' }, other = { process: P.process, id: 'otherrun0001' };
  const fact = (key, seen, n, run) => F.build({ run, producer: { name: 'git-bot', version: '1.0' }, key, seen, at, app: '4.0.0', loopStep: 'each', uid: item.uid, attempt: 1, source: BB, domain: 'prs', observedAt: at, maxAgeSeconds: 86400, complete: true, reported: n, fetched: n, errors: [], entries: [{ id: '1', text: 'Change 1', state: 'merged' }].concat(n > 1 ? [{ id: '2', text: 'Change 2', state: 'merged' }] : []) });
  const asks = (f) => { const fr = T.cleanFile(JSON.parse(T.text(f)), f.id + '.json').record; return T.buildProposal({ run: { process: P.process, id: P.id }, producer: { name: 'git-bot', version: '1.0' }, seen: [], at, body: { op: 'done', todo: x.id, support: { fact: f.id, content: fr.content, incarnation: x.added, source: BB, domain: 'prs' } } }); };
  /* Keys chosen so A sorts before B in one world and after it in the other: the walk's order follows the ids. */
  const pairOf = (aFirst) => { for (let i = 0; ; i++) { const ka = 'qa-a' + i, kb = 'qa-b' + i, ia = F.idFor('git-bot', ka), ib = F.idFor('git-bot', kb); if ((ia < ib) === aFirst) return [ka, kb]; } };
  const misses = [];
  for (const aFirst of [true, false]) {
    const [ka, kb] = pairOf(aFirst), A = fact(ka, [], 1, P), B = fact(kb, [A.id], 2, other), qa = asks(A), qb = asks(B), what = aFirst ? 'A first' : 'B first';
    const files = Object.assign({}, W.files);
    [A, B, qa, qb].forEach((y) => { files['proposals/' + y.id + '.json'] = T.text(y); });
    const named = (m) => m.indexOf(A.id) >= 0 && m.indexOf(B.id) >= 0 && /isn't a fact of the same run/.test(m);
    const read = await PF.repo.readTodos(new BytesFS(files));
    for (const order of [read.records, read.records.slice().reverse()]) {
      const D = PF.receipts.deps(P, { records: order, unread: read.unread, scopes: read.scopes, scopesUnread: read.scopesUnread, runs: {}, kids: {}, runBad: [] });
      if (!D.missing.some(named)) misses.push(what + ', records ' + (order === read.records ? 'in order' : 'reversed') + ': the closure: ' + JSON.stringify(D.missing));
    }
    const { res, zip } = await pack(PF, new BytesFS(files), W.key);
    if (!(res.status === 'partial' && res.col.unresolved.some(named))) misses.push(what + ': the export: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    if (PY) { const c = checkPack(await repacked(PF, zip, (e, man) => forced(man))); if (c.ok || c.out.indexOf(B.id) < 0 || !/isn't a fact of the same run/.test(c.out)) misses.push(what + ': Python: ' + c.out); }
  }
  assert.deepStrictEqual(misses, []);
});
/* NC: where a keep stands is worked out from its process's other runs; one of them whose run.json or notes can't be read
   (the read fails, finds nothing, or the file is gone when sized) leaves the pack partial, named by its path, and Python
   refuses a complete claim that carries it. */
rule('A keep whose process has a run that can\'t be read leaves the pack partial, named by its path, whichever way the read fails', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), proc = W.key.split('/')[0];
  const other = 'runs/' + proc + '/ctxrun0001/', files = Object.assign({}, W.files, { [other + 'run.json']: otherRoot(W, 'ctxrun0001'), [other + 'notes-w1.jsonl']: '' });
  const ctl = await pack(W.PF, new BytesFS(files), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the control: ' + JSON.stringify(ctl.res.col.unresolved));
  const failing = (how, at) => {
    const fsx = new BytesFS(files), read = fsx.read.bind(fsx), blob = fsx.blob.bind(fsx), stat = fsx.stat.bind(fsx);
    fsx.read = (p) => p === other + at && how !== 'stat' ? (how === 'eio' ? Promise.reject(new Error('EIO: i/o error')) : Promise.resolve(null)) : read(p);
    fsx.blob = (p) => p === other + at && how !== 'stat' ? (how === 'eio' ? Promise.reject(new Error('EIO: i/o error')) : Promise.resolve(null)) : blob(p);
    fsx.stat = (p) => p === other + at && how === 'stat' ? Promise.resolve(null) : stat(p);
    return fsx;
  };
  for (const [what, how, at] of [['run.json read fails (EIO)', 'eio', 'run.json'], ['run.json read finds nothing', 'null', 'run.json'], ['run.json gone when sized', 'stat', 'run.json'], ['notes read fails', 'eio', 'notes-w1.jsonl'], ['notes gone when sized', 'stat', 'notes-w1.jsonl']]) {
    const { res, zip } = await pack(W.PF, failing(how, at), W.key);
    assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(other + at) >= 0), what + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    const mr = manifestOf(zip).runs[0], cl = mr.claims.filter((c) => c.correction === W.keepId)[0];
    assert.ok(cl && !cl.verified && mr.living && !mr.living.complete, what + ': the keep isn\'t confirmed ' + JSON.stringify(mr.claims));
    if (PY) {
      assert.ok(checkPack(zip).ok, what + ': the honest partial pack is accepted');
      const bad = checkPack(await repacked(W.PF, zip, (e, man) => forced(man)));
      assert.ok(!bad.ok, what + ': Python refuses a complete claim: ' + bad.out);
    }
  }
});
/* OB: a run the process folder lists must give its run.json when its own folder is listed: gone by then (its notes still
   there), or a link there, it is named as vanished, the pack is partial, and Python refuses a complete claim. */
rule('A keep whose process lists a run whose run.json is gone, or a link, by its own listing leaves the pack partial, named', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), proc = W.key.split('/')[0];
  const other = 'runs/' + proc + '/ctxrun0001/', files = Object.assign({}, W.files, { [other + 'run.json']: otherRoot(W, 'ctxrun0001'), [other + 'notes-w1.jsonl']: '' });
  const listing = (how) => {
    const fsx = new BytesFS(files), list = fsx.list.bind(fsx);
    fsx.list = (p) => list(p).then((items) => p === other.slice(0, -1) ? (how === 'gone' ? items.filter((i) => i.name !== 'run.json') : items.map((i) => i.name === 'run.json' ? Object.assign({}, i, { kind: 'link' }) : i)) : items);
    return fsx;
  };
  for (const how of ['gone', 'link']) {
    const { res, zip } = await pack(W.PF, listing(how), W.key);
    assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(other + 'run.json') >= 0), how + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    const mr = manifestOf(zip).runs[0], cl = mr.claims.filter((c) => c.correction === W.keepId)[0];
    assert.ok(cl && !cl.verified && mr.living && !mr.living.complete, how + ': the keep isn\'t confirmed ' + JSON.stringify(mr.claims));
    if (PY) assert.ok(!checkPack(await repacked(W.PF, zip, (e, man) => forced(man))).ok, how + ': Python refuses a complete claim');
  }
});
/* OC: another run's files are read within bounds, counting the bytes actually read: one small when sized but over the file
   limit when read, or files that together read past the context budget, are too big, named, and the pack is partial. */
rule('A keep whose process has a run whose files grow past the file limit or the context budget after sizing leaves the pack partial, named', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), proc = W.key.split('/')[0], MiB = 1048576, more = { cap: 32 * MiB, maxFile: MiB };
  const other = 'runs/' + proc + '/ctxrun0001/', base = Object.assign({}, W.files, { [other + 'run.json']: otherRoot(W, 'ctxrun0001') });
  /* Small when sized (the scan's stat and the read's own), as it really is after: the file grew between. */
  const lying = (files) => { const fsx = new BytesFS(files), stat = fsx.stat.bind(fsx), n = new Map(); fsx.stat = (p) => { const k = (n.get(p) || 0) + 1; n.set(p, k); return p.indexOf(other + 'notes-') === 0 && k <= 2 ? stat(p).then((s) => s && Object.assign({}, s, { size: 10 })) : stat(p); }; return fsx; };
  const ctl = await pack(W.PF, lying(Object.assign({}, base, { [other + 'notes-w1.jsonl']: '' })), W.key, more);
  assert.strictEqual(ctl.res.status, 'complete', 'the control: ' + JSON.stringify(ctl.res.col.unresolved));
  const big = Object.assign({}, base, { [other + 'notes-w1.jsonl']: '\n'.repeat(3 * MiB) });
  const many = Object.assign({}, base); for (let i = 0; i < 10; i++) many[other + 'notes-w' + i + '.jsonl'] = '\n'.repeat(MiB - 4096);
  for (const [what, files, at] of [['one file past the limit', big, other + 'notes-w1.jsonl'], ['files past the context budget', many, other + 'notes-w']]) {
    const { res, zip } = await pack(W.PF, lying(files), W.key, more);
    assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(at) >= 0 && /too big/.test(u)), what + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    const mr = manifestOf(zip).runs[0], cl = mr.claims.filter((c) => c.correction === W.keepId)[0];
    assert.ok(cl && !cl.verified, what + ': the keep isn\'t confirmed ' + JSON.stringify(mr.claims));
    if (PY) assert.ok(!checkPack(await repacked(W.PF, zip, (e, man) => forced(man))).ok, what + ': Python refuses a complete claim');
  }
});
/* OD: a run the work depends on that the manifest calls confirmed is checked in full whatever the pack says of itself (its
   run.json as every reader reads it, its version, head, chain and receipt); the runs named are exactly the ones found, the
   root never among them; and each one's role is one its references give it. */
rule('Python checks every dependency called confirmed in full, even in a partial pack, and the named runs and roles are the ones found', async () => {
  if (!PY) return;
  const worlds = await roleWorlds(), ROLES = ['child', 'evidence', 'fulfills'], fake = 'req-notes-bot-' + 'f'.repeat(24);
  const misses = [];
  for (const w of worlds) {
    const honest = await pack(w.PF, new BytesFS(w.files), w.key);
    const lv0 = manifestOf(honest.zip).runs[0].living, myRole = lv0.deps.filter((d) => d.key === w.depKey)[0].role;
    const base = (man) => { if (w.force) forced(man); };
    const partial = (edit) => repacked(w.PF, honest.zip, (e, man, g) => { base(man); man.status = 'partial'; man.runs[0].living.complete = false; man.runs[0].living.missing = ['Something else is missing.']; edit(e, man, g, man.runs[0].living.deps.filter((d) => d.key === w.depKey)[0]); });
    const complete = (edit) => repacked(w.PF, honest.zip, (e, man, g) => { base(man); edit(e, man, g, man.runs[0].living.deps.filter((d) => d.key === w.depKey)[0]); });
    const runAt = (e, g, f) => { const y = g(w.path), o = JSON.parse(e[y.pack]); f(o); e[y.pack] = Buffer.from(JSON.stringify(o, null, 2)); };
    const ctlP = checkPack(await partial(() => {}));
    if (!ctlP.ok) { misses.push(w.role + ': the partial control: ' + ctlP.out); continue; }
    if (!w.force) { const ctlC = checkPack(honest.zip); if (!ctlC.ok) { misses.push(w.role + ': the complete control: ' + ctlC.out); continue; } }
    const cases = [
      ['partial, its run.json {}', partial((e, man, g) => { e[g(w.path).pack] = Buffer.from('{}'); })],
      ['partial, its state damaged', partial((e, man, g) => runAt(e, g, (o) => { o.state = 42; }))],
      ['partial, its head faked', partial((e, man, g, d) => { d.head = fake; })],
      ['partial, its chain faked', partial((e, man, g, d) => { d.chain = [fake]; })],
      ['complete, the root named as its own dependency', complete((e, man) => { const r = man.runs[0]; r.living.deps.push({ key: r.key, role: 'child', head: r.living.head, chain: r.living.chain.slice(), receipt: r.living.receipt ? r.living.receipt.id : '', confirmed: true }); })],
      ['partial, the root named as its own dependency', partial((e, man) => { const r = man.runs[0]; r.living.deps.push({ key: r.key, role: 'child', head: r.living.head, chain: r.living.chain.slice(), receipt: r.living.receipt ? r.living.receipt.id : '', confirmed: true }); })]
    ];
    if (w.role === 'child') cases.push(['partial, its version dropped', partial((e, man) => { const pubs = man.files.filter((f) => /^publications\/validate-story\//.test(f.path)); assert.ok(pubs.length, 'set-up: the child\'s version is packed'); pubs.forEach((f) => { delete e[f.pack]; }); man.files = man.files.filter((f) => pubs.indexOf(f) < 0); })]);
    for (const other of ROLES.filter((x) => x !== myRole)) cases.push(['complete, its role relabeled ' + other, complete((e, man, g, d) => { d.role = other; })]);
    for (const [what, p] of cases) { const c = checkPack(await p); if (c.ok) misses.push(w.role + ', ' + what + ': ' + c.out); }
  }
  assert.deepStrictEqual(misses, []);
});
/* QB: what the keep's process holds is named before anything is filtered: another run's folder or notes listed as a link, a
   listing that fails, and a run.json that won't parse or isn't a run each leave the keep unconfirmed and the pack partial,
   named by path, and Python refuses a complete claim. */
rule('A keep whose process holds a link, a listing that fails or a run.json that isn\'t a run leaves the pack partial, named', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), proc = W.key.split('/')[0];
  const other = 'runs/' + proc + '/ctxrun0001/', files = Object.assign({}, W.files, { [other + 'run.json']: otherRoot(W, 'ctxrun0001'), [other + 'notes-w1.jsonl']: '' });
  const ctl = await pack(W.PF, new BytesFS(files), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the control: ' + JSON.stringify(ctl.res.col.unresolved));
  const asLink = (dir, name) => (fsx) => { const list = fsx.list.bind(fsx); fsx.list = (p) => list(p).then((items) => p === dir ? items.map((i) => i.name === name ? Object.assign({}, i, { kind: 'link' }) : i) : items); };
  const failing = (dir, after) => (fsx) => { const list = fsx.list.bind(fsx); let n = 0; fsx.list = (p) => p === dir && n++ >= after ? Promise.reject(new Error('EIO: i/o error')) : list(p); };
  const cases = [
    ['the run folder listed as a link', files, asLink('runs/' + proc, 'ctxrun0001'), other.slice(0, -1)],
    ['the notes listed as a link', files, asLink(other.slice(0, -1), 'notes-w1.jsonl'), other + 'notes-w1.jsonl'],
    ['the run folder\'s listing fails', files, failing(other.slice(0, -1), 0), other.slice(0, -1)],
    ['the process folder\'s listing fails after the run is found', files, failing('runs/' + proc, 1), 'runs/' + proc],
    ['run.json is "{"', Object.assign({}, files, { [other + 'run.json']: '{' }), null, other + 'run.json'],
    ['run.json is {}', Object.assign({}, files, { [other + 'run.json']: '{}' }), null, other + 'run.json']
  ];
  const misses = [];
  for (const [what, fl, hook, at] of cases) {
    const fsx = new BytesFS(fl); if (hook) hook(fsx);
    let got;
    try { got = await pack(W.PF, fsx, W.key); } catch (e) { misses.push(what + ': the export failed: ' + e.message); continue; }
    const { res, zip } = got;
    if (!(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(at) >= 0))) { misses.push(what + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved)); continue; }
    const mr = manifestOf(zip).runs[0], cl = mr.claims.filter((c) => c.correction === W.keepId)[0];
    if (!(cl && !cl.verified && mr.living && !mr.living.complete)) misses.push(what + ': the keep is confirmed ' + JSON.stringify(mr.claims));
    if (PY && checkPack(await repacked(W.PF, zip, (e, man) => forced(man))).ok) misses.push(what + ': Python accepts a complete claim');
  }
  assert.deepStrictEqual(misses, []);
});
/* QC: reads made at once share the context budget: each slice takes its room before it is read, so ten notes files grown
   after sizing never read past the budget together, and what can't get room is too big, named. */
rule('Files of a keep\'s process read at once never read past the shared context budget together', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), proc = W.key.split('/')[0], MiB = 1048576, CTX = 8 * MiB;
  const other = 'runs/' + proc + '/ctxrun0001/', files = Object.assign({}, W.files, { [other + 'run.json']: otherRoot(W, 'ctxrun0001') });
  for (let i = 0; i < 10; i++) files[other + 'notes-w' + i + '.jsonl'] = '\n'.repeat(MiB - 4096);
  const fsx = new BytesFS(files), stat = fsx.stat.bind(fsx), blob = fsx.blob.bind(fsx), read = { bytes: 0, again: 0 };
  const n = new Map(), opens = new Map();
  fsx.stat = (p) => { const k = (n.get(p) || 0) + 1; n.set(p, k); return p.indexOf(other + 'notes-') === 0 && k <= 2 ? stat(p).then((s) => s && Object.assign({}, s, { size: 10 })) : stat(p); };
  /* What is held is each file's first read; reading it again to confirm it (SC) holds one slice at a time, counted apart. */
  fsx.blob = (p) => blob(p).then((b) => { if (!b || p.indexOf(other + 'notes-') !== 0) return b; const first = !opens.get(p); opens.set(p, 1); return { size: b.size, slice: (a, z) => ({ arrayBuffer: () => b.slice(a, z).arrayBuffer().then((ab) => { if (first) read.bytes += ab.byteLength; else read.again += ab.byteLength; return ab; }) }) }; });
  const { res, zip } = await pack(W.PF, fsx, W.key, { cap: 4 * CTX, maxFile: MiB, pool: false });
  assert.ok(read.bytes <= CTX, 'read ' + read.bytes + ' bytes of notes against a budget of ' + CTX);
  assert.ok(read.again <= read.bytes, 'read again ' + read.again + ' bytes, more than were read');
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(other + 'notes-w') >= 0 && /too big/.test(u)), res.status + ' ' + JSON.stringify(res.col.unresolved));
  const mr = manifestOf(zip).runs[0], cl = mr.claims.filter((c) => c.correction === W.keepId)[0];
  assert.ok(cl && !cl.verified, 'the keep isn\'t confirmed ' + JSON.stringify(mr.claims));
  if (PY) assert.ok(!checkPack(await repacked(W.PF, zip, (e, man) => forced(man))).ok, 'Python refuses a complete claim');
});
/* QD: a dependency called confirmed is established from the packed references whatever the pack says of itself, before
   anything else may stop reading: it must be found from the root, in that role, and check out in full; a root no reader
   reads can't establish one. */
rule('Python refuses a confirmed dependency a partial pack can\'t establish: another role, a run nothing names, or an unread root', async () => {
  if (!PY) return;
  const worlds = await roleWorlds(), ROLES = ['child', 'evidence', 'fulfills'];
  const misses = [];
  for (const w of worlds) {
    const honest = await pack(w.PF, new BytesFS(w.files), w.key);
    const depOf = (man) => man.runs[0].living.deps.filter((d) => d.key === w.depKey)[0];
    const myRole = depOf(manifestOf(honest.zip)).role;
    const partial = (edit) => repacked(w.PF, honest.zip, (e, man, g) => { if (w.force) forced(man); man.status = 'partial'; man.runs[0].living.complete = false; man.runs[0].living.missing = ['Something else is missing.']; edit(e, man, g, depOf(man)); });
    const ctl = checkPack(await partial(() => {}));
    if (!ctl.ok) { misses.push(w.role + ': the control: ' + ctl.out); continue; }
    const cases = ROLES.filter((x) => x !== myRole).map((other) => ['its role relabeled ' + other, partial((e, man, g, d) => { d.role = other; })]);
    cases.push(['a run nothing names added as confirmed', partial((e, man, g, d) => {
      const f = g(w.path), key = w.depKey.split('/')[0] + '/stray-1', path = 'runs/' + key + '/run.json', o = JSON.parse(e[f.pack]); o.id = 'stray-1';
      const nf = Object.assign({}, f, { path, pack: 'originals/' + path }); e[nf.pack] = Buffer.from(JSON.stringify(o, null, 2)); man.files.push(nf);
      man.runs[0].living.deps.push(Object.assign({}, d, { key }));
    })]);
    cases.push(['the root null and the dependency {}', partial((e, man, g) => { e[g('runs/' + w.key + '/run.json').pack] = Buffer.from('null'); e[g(w.path).pack] = Buffer.from('{}'); })]);
    for (const [what, p] of cases) { const c = checkPack(await p); if (c.ok) misses.push(w.role + ', ' + what + ': ' + c.out); }
  }
  assert.deepStrictEqual(misses, []);
});
/* QE: the pack checker never writes, not even a temporary file: each dependency's version is verified from the packed bytes
   in memory. Every write it could make is watched (test/no_writes.py, an audit hook), in every role world. */
rule('check_pack.py writes nothing while it verifies a pack, its dependencies\' versions included', async () => {
  if (!PY) return;
  const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
  const misses = [];
  for (const w of await roleWorlds()) {
    const { zip } = await pack(w.PF, new BytesFS(w.files), w.key);
    const z = w.force ? await repacked(w.PF, zip, (e, man) => forced(man)) : zip;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-nowrite-')), file = path.join(dir, 'pack.zip');
    fs.writeFileSync(file, z);
    const r = cp.spawnSync(PY, ['-I', path.join(__dirname, 'no_writes.py'), path.join(__dirname, 'check_pack.py'), file], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    const wrote = String(r.stderr).split('\n').filter((l) => l.indexOf('WROTE: ') === 0);
    if (wrote.length) misses.push(w.role + ': ' + wrote.slice(0, 4).join(' | '));
    if (!w.force && r.status !== 0) misses.push(w.role + ': the check failed: ' + r.stdout + r.stderr);
  }
  assert.deepStrictEqual(misses, []);
});
/* RA: a dependency the manifest calls confirmed gets the whole closure check, the same one a complete pack gets, even when
   the root's work isn't complete: the child's compound with text 42 or an extra key, or a request on the child resting on a
   fact or a plan the pack doesn't hold, and Python refuses the claim that the child is confirmed. */
rule('Python refuses a confirmed dependency whose own closure isn\'t whole, even in a partial pack', async () => {
  if (!PY) return;
  const W = await loopMade(), PF = W.PF, T = PF.todos, F = PF.facts, K = PF.run.sanitize(JSON.parse(W.files[W.kidPath]));
  const at = new Date().toISOString(), KR = { process: K.process, id: K.id }, td = 'td-' + 'a'.repeat(24), BB = { feed: 'bitbucket', site: 'git.example.com' };
  const item = PF.loop.view(W.run, 'each', { records: (await PF.repo.readTodos(new BytesFS(W.files))).scopes, runs: [W.run], procOf: () => null }).rollup.items[0];
  const f = F.build({ run: KR, producer: { name: 'git-bot', version: '1.0' }, key: 'ra-missing', seen: [], at, app: '4.0.0', loopStep: 'each', uid: item.uid, attempt: 1, source: BB, domain: 'prs', observedAt: at, maxAgeSeconds: 86400, complete: true, reported: 1, fetched: 1, errors: [], entries: [{ id: '1', text: 'Change 1', state: 'merged' }] });
  const fr = T.cleanFile(JSON.parse(T.text(f)), f.id + '.json').record, ev = { plan: 'plan-ev-' + 'b'.repeat(24), run: KR, answer: 'Yes', result: '' };
  const onFact = T.buildProposal({ run: KR, producer: { name: 'git-bot', version: '1.0' }, seen: [], at, body: { op: 'done', todo: td, support: { fact: f.id, content: fr.content, incarnation: at, source: BB, domain: 'prs' } } });
  const onPlan = T.buildProposal({ run: KR, id: PF.detours.requestId(td, ev), by: 'person-avery', seen: [], at, body: { op: 'done', todo: td, evidence: ev }, app: '4.0.0' });
  const { zip } = await pack(PF, new BytesFS(W.files), W.key);
  const partial = (edit) => repacked(PF, zip, (e, man, g) => {
    man.status = 'partial'; const lv = man.runs[0].living; lv.complete = false; lv.missing = ['Something else is missing.'];
    const d = lv.deps.filter((x) => x.key === W.kidKey)[0]; d.confirmed = true; edit(e, man, g, d);
  });
  const recEdit = (fn) => (e, man, g, d) => { const y = g('proposals/' + d.head + '.json'), o = JSON.parse(e[y.pack]); assert.strictEqual(o.kind, 'compound', 'set-up: the child\'s head is a compound'); fn(o); e[y.pack] = Buffer.from(JSON.stringify(o, null, 2)); };
  const addRec = (q) => (e, man, g, d) => { const y = g('proposals/' + d.head + '.json'), path = 'proposals/' + q.id + '.json', nf = Object.assign({}, y, { path, pack: 'originals/' + path }); e[nf.pack] = Buffer.from(T.text(q)); man.files.push(nf); };
  const misses = [];
  const ctl = checkPack(await partial(() => {}));
  if (!ctl.ok) misses.push('the control: ' + ctl.out);
  for (const [what, edit] of [
    ['the child\'s compound with text 42', recEdit((o) => { o.text = 42; })],
    ['the child\'s compound with an extra key', recEdit((o) => { o.extra = 'unread'; })],
    ['a request on the child resting on a fact the pack doesn\'t hold', addRec(onFact)],
    ['a request on the child done on a plan the pack doesn\'t hold', addRec(onPlan)]
  ]) {
    const c = checkPack(await partial(edit));
    if (c.ok) misses.push(what + ': Python accepts the child as confirmed: ' + c.out);
  }
  assert.deepStrictEqual(misses, []);
});
/* RB: another run of a keep's process is judged by the readers' whole verdict before anything is taken from it, its notes'
   torn lines are named, and a decision there listed as a link is named: each leaves the keep unconfirmed and the pack
   partial, named by path, and Python refuses a complete claim. */
rule('A keep whose process has a run the readers refuse, torn notes or a linked decision leaves the pack partial, named', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), proc = W.key.split('/')[0];
  const other = 'runs/' + proc + '/ctxrun0001/', base = Object.assign({}, W.files, { [other + 'run.json']: otherRoot(W, 'ctxrun0001'), [other + 'notes-w1.jsonl']: '' });
  const ctl = await pack(W.PF, new BytesFS(base), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the control: ' + JSON.stringify(ctl.res.col.unresolved));
  const runAs = (fn) => { const o = JSON.parse(base[other + 'run.json']); fn(o); return Object.assign({}, base, { [other + 'run.json']: JSON.stringify(o, null, 2) }); };
  const linkIn = (dir) => (fsx) => { const list = fsx.list.bind(fsx); fsx.list = (p) => list(p).then((items) => p === dir ? items.concat([{ name: 'cd-linked.json', kind: 'link' }]) : items); };
  const cases = [
    ['an unknown field', runAs((o) => { o.zzzUnknown = 1; }), null, other + 'run.json'],
    ['title 42', runAs((o) => { o.title = 42; }), null, other + 'run.json'],
    ['living that isn\'t a living record', runAs((o) => { o.living = { head: 42 }; }), null, other + 'run.json'],
    ['format preflight-run/4', runAs((o) => { o.format = 'preflight-run/4'; }), null, other + 'run.json'],
    ['notes "{"', Object.assign({}, base, { [other + 'notes-w1.jsonl']: '{\n' }), null, other + 'notes-w1.jsonl'],
    ['notes "{ torn"', Object.assign({}, base, { [other + 'notes-w1.jsonl']: '{ torn\n' }), null, other + 'notes-w1.jsonl'],
    ['a decision listed as a link in corrections', base, linkIn('corrections/' + proc), 'corrections/' + proc + '/cd-linked.json'],
    ['a decision listed as a link in suggestions', base, linkIn('suggestions/' + proc), 'suggestions/' + proc + '/cd-linked.json']
  ];
  const misses = [];
  for (const [what, fl, hook, at] of cases) {
    const fsx = new BytesFS(fl); if (hook) hook(fsx);
    const { res, zip } = await pack(W.PF, fsx, W.key);
    if (!(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(at) >= 0))) { misses.push(what + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved)); continue; }
    const mr = manifestOf(zip).runs[0], cl = mr.claims.filter((c) => c.correction === W.keepId)[0];
    if (!(cl && !cl.verified)) misses.push(what + ': the keep is confirmed ' + JSON.stringify(mr.claims));
    if (PY && checkPack(await repacked(W.PF, zip, (e, man) => forced(man))).ok) misses.push(what + ': Python accepts a complete claim');
  }
  assert.deepStrictEqual(misses, []);
});
/* RC: a child folder listed as a link is a named unread dependency in both child scanners: readLoopChildren (what the ending
   guard reads) and the export's, which is then partial, naming it. */
rule('A loop child folder listed as a link is named by both child scanners, and the export is partial', async () => {
  const W = await loopMade(), PF = W.PF, kid = W.kidPath.replace(/\/run\.json$/, ''), dir = kid.replace(/\/[^/]+$/, '');
  const linked = () => { const fsx = new BytesFS(W.files), list = fsx.list.bind(fsx); fsx.list = (p) => list(p).then((items) => p === dir ? items.map((i) => dir + '/' + i.name === kid ? Object.assign({}, i, { kind: 'link' }) : i) : items); return fsx; };
  const got = await PF.repo.readLoopChildren(linked(), W.run);
  assert.ok(got.unread.some((u) => String(u.path).indexOf(kid) === 0), 'the ending guard\'s reader names it: ' + JSON.stringify(got));
  const { res, zip } = await pack(PF, linked(), W.key);
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(kid) >= 0), res.status + ' ' + JSON.stringify(res.col.unresolved));
  if (PY) assert.ok(checkPack(zip).ok, 'Python accepts the honest partial pack: ' + checkPack(zip).out);
});
/* RD: a file of another run that grows after it is opened (the command line's blob keeps its size from the open, while its
   slices read the file as it is) is never taken as whole: the bytes read are confirmed against a fresh stat, and a change is
   named, so the keep isn't confirmed and the pack is partial. */
rule('A keep whose process has a notes file that grows after it is opened leaves the pack partial, named', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), proc = W.key.split('/')[0], notes = 'runs/' + proc + '/ctxrun0001/notes-w1.jsonl';
  const files = Object.assign({}, W.files, { ['runs/' + proc + '/ctxrun0001/run.json']: otherRoot(W, 'ctxrun0001'), [notes]: '{"x":1234567890}' });
  const fsx = new BytesFS(files), blob = fsx.blob.bind(fsx);
  /* It grows after every open, so reading it again (SC) never finds it settled. */
  let grown = 0;
  fsx.blob = (p) => { if (p !== notes) return blob(p); let first = true; return Promise.resolve({
    size: fsx.files.get(p).length,
    slice: (a, z) => { if (first) { first = false; grown++; fsx.files.set(p, Buffer.concat([fsx.files.get(p), Buffer.from('\n'.repeat(1048576))])); } return { arrayBuffer: () => Promise.resolve(Uint8Array.from(fsx.files.get(p).subarray(a, z)).buffer) }; }
  }); };
  const { res, zip } = await pack(W.PF, fsx, W.key);
  assert.ok(grown, 'set-up: the notes grew after they were opened');
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(notes) >= 0), res.status + ' ' + JSON.stringify(res.col.unresolved));
  const mr = manifestOf(zip).runs[0], cl = mr.claims.filter((c) => c.correction === W.keepId)[0];
  assert.ok(cl && !cl.verified, 'the keep isn\'t confirmed ' + JSON.stringify(mr.claims));
  if (PY) assert.ok(!checkPack(await repacked(W.PF, zip, (e, man) => forced(man))).ok, 'Python refuses a complete claim');
});
/* ND: each run the work depends on is named as the export names it: exactly its key, role, head, chain, receipt and
   confirmed, typed; the receipt it names is the packed run's own (none when it has none); and a complete pack confirms
   every one. In every role. */
rule('Python refuses a complete pack whose dependency metadata isn\'t the export\'s or doesn\'t agree with the packed run', async () => {
  if (!PY) return;
  const worlds = await roleWorlds();
  const cases = [
    ['role []', (d) => { d.role = []; }],
    ['a role the export never writes', (d) => { d.role = 'friend'; }],
    ['receipt []', (d) => { d.receipt = []; }],
    ['a receipt the run doesn\'t name', (d) => { d.receipt = 'req-receipt-' + 'a'.repeat(24); }],
    ['receipt deleted', (d) => { delete d.receipt; }],
    ['confirmed false', (d) => { d.confirmed = false; }],
    ['confirmed "yes"', (d) => { d.confirmed = 'yes'; }],
    ['confirmed deleted', (d) => { delete d.confirmed; }],
    ['an extra key', (d) => { d.extra = 1; }],
    ['head 42', (d) => { d.head = 42; }],
    ['a chain of numbers', (d) => { d.chain = [1]; }]
  ];
  const misses = [];
  for (const w of worlds) {
    const full = await pack(w.PF, new BytesFS(w.files), w.key);
    assert.strictEqual(full.res.status, 'complete', w.role + ': ' + JSON.stringify(full.res.col.unresolved));
    assert.ok(checkPack(full.zip).ok, w.role + ' control: ' + checkPack(full.zip).out);
    for (const [what, edit] of cases) {
      const c = checkPack(await repacked(w.PF, full.zip, (e, man) => edit(man.runs[0].living.deps[0])));
      if (c.ok) misses.push(w.role + ', ' + what + ': ' + c.out);
    }
  }
  assert.deepStrictEqual(misses, []);
});
/* SA: a dependency called confirmed is confirmed only with every run its own work requires, walked the way a complete
   pack's work is, whatever those runs' own manifest flags and however the root stands: the child's request done on an
   evidence run that's missing, has title 42 or format /4, and the child's request fulfilling a spread of a run that isn't
   there. Python refuses the child as confirmed. */
rule('Python refuses a confirmed dependency whose own work requires a run that isn\'t whole in the pack', async () => {
  if (!PY) return;
  const W = await loopMade(), PF = W.PF, T = PF.todos, K = PF.run.sanitize(JSON.parse(W.files[W.kidPath]));
  const at = new Date().toISOString(), KR = { process: K.process, id: K.id }, td = 'td-' + 'a'.repeat(24), evp = 'runs/' + K.process + '/evrun1/run.json';
  const ev = { plan: 'plan-ev-' + 'b'.repeat(24), run: { process: K.process, id: 'evrun1' }, answer: 'Yes', result: '' };
  const q = T.buildProposal({ run: KR, id: PF.detours.requestId(td, ev), by: 'person-avery', seen: [], at, body: { op: 'done', todo: td, evidence: ev }, app: '4.0.0' });
  const er = JSON.parse(String(W.files[W.kidPath])); er.id = 'evrun1'; delete er.living; delete er.ended; delete er.parent; er.state = 'running';
  if (Array.isArray(er.features)) er.features = er.features.filter((f) => f !== 'living-runs');
  const one = await PF.repo.readRunOnly(new BytesFS(W.files), K.process, K.id);
  const files = Object.assign({}, W.files, { ['proposals/' + q.id + '.json']: T.text(q), [evp]: JSON.stringify(er, null, 2),
    ['proposals/' + ev.plan + '.json']: JSON.stringify(PF.plans.make(one.pub, { id: ev.plan, process: K.process, title: 'Evidence plan', from: W.kidKey, by: 'person-avery', created: at }, true, '4.0.0'), null, 2) + '\n' });
  const { zip } = await pack(PF, new BytesFS(files), W.key);
  assert.ok(manifestOf(zip).runs[0].living.deps.some((d) => d.key === K.process + '/evrun1' && d.role === 'evidence'), 'set-up: the evidence run is a dependency');
  /* Only the child is called confirmed; the root's own work isn't complete. */
  const partial = (z, edit) => repacked(PF, z, (e, man, g) => {
    man.status = 'partial'; const lv = man.runs[0].living; lv.complete = false; lv.missing = ['Something else is missing.'];
    lv.deps.forEach((d) => { d.confirmed = d.key === W.kidKey; }); edit(e, man, g);
  });
  const runEdit = (fn) => (e, man, g) => { const y = g(evp), o = JSON.parse(e[y.pack]); fn(o); e[y.pack] = Buffer.from(JSON.stringify(o, null, 2)); };
  const misses = [];
  const ctl = checkPack(await partial(zip, () => {}));
  if (!ctl.ok) misses.push('the control: ' + ctl.out);
  for (const [what, edit] of [
    ['the evidence run missing', (e, man, g) => { const y = g(evp); delete e[y.pack]; man.files = man.files.filter((f) => f !== y); }],
    ['the evidence run with title 42', runEdit((o) => { o.title = 42; })],
    ['the evidence run in format preflight-run/4', runEdit((o) => { o.format = 'preflight-run/4'; })]
  ]) {
    const c = checkPack(await partial(zip, edit));
    if (c.ok) misses.push(what + ': Python accepts the child as confirmed');
  }
  /* The child's request fulfills a spread of a run that isn't in the folder: the export is partial and names it. */
  const m = PF.run.mapOf(K), ph = m.phases[0].id;
  const fq = T.buildProposal({ run: KR, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-sa1', seen: [], at,
    body: { op: 'add', text: 'Covered', target: { phase: ph }, placement: T.placementFor(m, { phase: ph }), fulfills: { run: { process: K.process, id: 'gone-1' }, spread: 'sp-' + 'c'.repeat(24), uid: 'jira.issue:key:ABC-1', attempt: 1 } } });
  const g2 = await pack(PF, new BytesFS(Object.assign({}, W.files, { ['proposals/' + fq.id + '.json']: T.text(fq) })), W.key);
  assert.strictEqual(g2.res.status, 'partial', 'set-up: the spread\'s run is missing');
  if (checkPack(await partial(g2.zip, () => {})).ok) misses.push('a request on the child fulfilling a spread of a missing run: Python accepts the child as confirmed');
  assert.deepStrictEqual(misses, []);
});
/* SC: another run's file over one slice, replaced by bytes of the same length after its first slice is read (a run.json
   replaced by a padded {}, notes whose first line is torn while the slice read later is the same): what's read mixes two
   versions of the same size. Every such read is confirmed by reading it again and comparing SHA-256; a difference is read
   again within the export's tries, so the file as it settles is judged: named, the keep unconfirmed, the pack partial. */
rule('A keep whose process has a file replaced at the same size while it is read is judged as it settles, named', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), proc = W.key.split('/')[0], base = 'runs/' + proc + '/ctxrun0001/';
  const L = 1048576 + 4096, pad = (t) => t + ' '.repeat(L - Buffer.byteLength(t));
  const runText = pad(otherRoot(W, 'ctxrun0001')), notesText = '\n'.repeat(L);
  const cases = [
    ['run.json replaced by a padded {}', base + 'run.json', Buffer.from(pad('{}'))],
    ['notes whose first line is torn', base + 'notes-w1.jsonl', Buffer.concat([Buffer.from('{\n'), Buffer.from(notesText.slice(2))])]
  ];
  const misses = [];
  const world = () => new BytesFS(Object.assign({}, W.files, { [base + 'run.json']: runText, [base + 'notes-w1.jsonl']: notesText }));
  const ctl = await pack(W.PF, world(), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the control: ' + JSON.stringify(ctl.res.col.unresolved));
  for (const [what, path, next] of cases) {
    assert.strictEqual(next.length, L, 'set-up: the same length');
    const fsx = world(), blob = fsx.blob.bind(fsx);
    let swapped = false;
    /* Its slices read the file as it is now, as the command line's blob does. */
    fsx.blob = (p) => p !== path ? blob(p) : Promise.resolve(fsx.files.get(p) ? { size: fsx.files.get(p).length, slice: (a, z) => ({ arrayBuffer: () => {
      const ab = Uint8Array.from(fsx.files.get(p).subarray(a, z)).buffer;
      if (!swapped) { swapped = true; fsx.files.set(p, next); }
      return Promise.resolve(ab);
    } }) } : null);
    const { res, zip } = await pack(W.PF, fsx, W.key);
    if (!swapped) { misses.push(what + ': set-up: never swapped'); continue; }
    if (!(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(path) >= 0))) { misses.push(what + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved)); continue; }
    const cl = manifestOf(zip).runs[0].claims.filter((c) => c.correction === W.keepId)[0];
    if (!(cl && !cl.verified)) misses.push(what + ': the keep is confirmed');
  }
  assert.deepStrictEqual(misses, []);
});
/* SD: a keep published in v2, where v2 can't be read: its folder listed as a link, its map.md missing, its record from a
   newer Flightdeck, or its record's hash not matching. Where the keep stands can't be worked out without it: the export
   names the version, the keep isn't confirmed, the pack is partial, and Python refuses a complete claim. */
rule('A keep whose process has a version that can\'t be read leaves the pack partial, named', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), PF = W.PF, C = PF.corrections, proc = W.key.split('/')[0];
  const d = await PF.repo.loadAll(new BytesFS(W.files), {}), runs = d.runs.filter((r) => r.process === proc), members = PF.learn.members(d.todos, runs, proc);
  const v1 = Object.keys(W.files).filter((p) => p.indexOf('publications/' + proc + '/') === 0)[0].split('/')[2], v1base = 'publications/' + proc + '/' + v1 + '/';
  const g = C.forProcess(runs, proc, [], null, members).filter((x) => x.keep)[0], rv = C.review(g, String(W.files[v1base + 'map.md']));
  const dec = C.decision(g, 'person-avery', 'applied', '', new Date().toISOString(), { act: 'a1', result: C.outcome(g, rv.text, rv.added) });
  const gs = C.forProcess(runs, proc, [Object.assign(C.cleanDecision(dec, proc), { _file: g.id + '.w4.1.json' })], null, members);
  const b = PF.publish.build(rv.text, { people: JSON.parse(W.files['people.json']), ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'Kept step', existing: [JSON.parse(String(W.files[v1base + 'publication.json']))], now: Date.now(), rand: 'rn000002', app: '4.0.0', corrections: C.forPublish(rv.text, gs).list });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const v2 = 'publications/' + proc + '/' + b.folder, files = Object.assign({}, W.files, { ['corrections/' + proc + '/' + g.id + '.w4.1.json']: JSON.stringify(dec, null, 2) + '\n' });
  Object.keys(b.files).forEach((k) => { files[v2 + '/' + k] = b.files[k]; });
  const ctl = await pack(PF, new BytesFS(files), W.key), claimOf = (zip) => manifestOf(zip).runs[0].claims.filter((c) => c.correction === W.keepId)[0];
  assert.ok(ctl.res.status === 'complete' && claimOf(ctl.zip).verified && claimOf(ctl.zip).text === 'Published in v2', 'the control: ' + JSON.stringify(manifestOf(ctl.zip).runs[0].claims));
  const record = (fn) => { const o = JSON.parse(files[v2 + '/publication.json']); fn(o); return Object.assign({}, files, { [v2 + '/publication.json']: JSON.stringify(o, null, 2) }); };
  const linked = (fsx) => { const list = fsx.list.bind(fsx); fsx.list = (p) => list(p).then((items) => p === 'publications/' + proc ? items.map((i) => i.name === b.folder ? Object.assign({}, i, { kind: 'link' }) : i) : items); };
  const cases = [
    ['its folder listed as a link', files, linked, v2],
    ['its map.md missing', (() => { const f = Object.assign({}, files); delete f[v2 + '/map.md']; return f; })(), null, v2 + '/map.md'],
    ['its record from a newer Flightdeck', record((o) => { o.format = 'preflight-publication/9'; }), null, v2],
    ['its record\'s hash damaged', record((o) => { o.mapHash = 'deadbeef'; }), null, v2]
  ];
  const misses = [];
  for (const [what, fl, hook, at] of cases) {
    const fsx = new BytesFS(fl); if (hook) hook(fsx);
    const { res, zip } = await pack(PF, fsx, W.key);
    if (!(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(at) >= 0))) { misses.push(what + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved)); continue; }
    const cl = claimOf(zip);
    if (!(cl && !cl.verified)) misses.push(what + ': the keep is confirmed ' + JSON.stringify(cl));
    if (PY && checkPack(await repacked(PF, zip, (e, man) => forced(man))).ok) misses.push(what + ': Python accepts a complete claim');
  }
  assert.deepStrictEqual(misses, []);
});
/* TA: a dependency called confirmed whose own work reaches back to the run itself (a request on it fulfills a spread the run
   holds): the walk from it checks the run's own chain and closure there, once, though the run is never its own dependency.
   With the run's work head gone from a partial pack, Python refuses the dependency as confirmed. */
rule('Python refuses a confirmed dependency whose work reaches back to a run whose own chain isn\'t in the pack', async () => {
  if (!PY) return;
  const w = (await roleWorlds()).filter((x) => x.role === 'reverse')[0];
  const { zip } = await pack(w.PF, new BytesFS(w.files), w.key), head = manifestOf(zip).runs[0].living.head;
  const partial = (edit) => repacked(w.PF, zip, (e, man, g) => {
    man.status = 'partial'; const lv = man.runs[0].living; lv.complete = false; lv.missing = ['Something else is missing.'];
    lv.deps.forEach((d) => { d.confirmed = d.key === w.depKey; }); edit(e, man, g);
  });
  const ctl = checkPack(await partial(() => {}));
  assert.ok(ctl.ok, 'the control: ' + ctl.out);
  const gone = checkPack(await partial((e, man, g) => { const y = g('proposals/' + head + '.json'); delete e[y.pack]; man.files = man.files.filter((f) => f !== y); }));
  assert.ok(!gone.ok && /depends on in turn/.test(gone.out), 'the run\'s work head gone: ' + gone.out);
});
/* A run with a keep (o.keep2: a second one, elsewhere) whose change v2 of its checklist makes: v2 published from the keep's
   group applied to the draft, its applied decision in corrections/. */
async function keptInV2(o) {
  const W = await made(Object.assign({ todos: 1, keep: 'placed' }, o)), PF = W.PF, C = PF.corrections, proc = W.key.split('/')[0];
  const d = await PF.repo.loadAll(new BytesFS(W.files), {}), runs = d.runs.filter((r) => r.process === proc), members = PF.learn.members(d.todos, runs, proc);
  const v1 = Object.keys(W.files).filter((p) => p.indexOf('publications/' + proc + '/') === 0)[0].split('/')[2], v1base = 'publications/' + proc + '/' + v1 + '/';
  const g = C.forProcess(runs, proc, [], null, members).filter((x) => x.keep && x.members.some((m) => m.keep.record === W.keepId))[0], md1 = String(W.files[v1base + 'map.md']), rv = C.review(g, md1);
  const dec = C.decision(g, 'person-avery', 'applied', '', new Date().toISOString(), { act: 'a1', result: C.outcome(g, rv.text, rv.added) });
  const gs = C.forProcess(runs, proc, [Object.assign(C.cleanDecision(dec, proc), { _file: g.id + '.w4.1.json' })], null, members);
  const opts = (corr) => ({ people: JSON.parse(W.files['people.json']), ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'Kept step', existing: [JSON.parse(String(W.files[v1base + 'publication.json']))], now: Date.now(), rand: 'rn000002', app: '4.0.0', corrections: corr });
  const b = PF.publish.build(rv.text, opts(C.forPublish(rv.text, gs).list));
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const v2 = 'publications/' + proc + '/' + b.folder, files = Object.assign({}, W.files, { ['corrections/' + proc + '/' + g.id + '.w4.1.json']: JSON.stringify(dec, null, 2) + '\n' });
  Object.keys(b.files).forEach((k) => { files[v2 + '/' + k] = b.files[k]; });
  /* The same version number and listing, published from v1's unchanged text. */
  const same = PF.publish.build(md1, opts(C.forPublish(rv.text, gs).list));
  assert.ok(!same.blockers && same.folder === b.folder, 'set-up: v1\'s text as v2 ' + JSON.stringify(same.blockers));
  return { W, PF, proc, files, v2, b, unchanged: same, groupId: g.id };
}
/* TB: a "Published in vN" claim is bound to the correction it names, read from the packed originals with its group worked
   out from them, and to the version's own checklist making the change, as the app's landing rules decide: the claim moved
   onto another keep, or v2 holding v1's unchanged text with its listing and the applied decision kept, and Python refuses. */
rule('Python holds a "Published in vN" claim to the correction it names and the change in that version\'s checklist', async () => {
  if (!PY) return;
  const K = await keptInV2({ keep2: true }), PF = K.PF, W = K.W;
  const { res, zip } = await pack(PF, new BytesFS(K.files), W.key);
  const claimOf = (man, id) => man.runs[0].claims.filter((c) => c.correction === id)[0];
  assert.ok(res.status === 'complete' && claimOf(manifestOf(zip), W.keepId).verified, 'set-up: ' + res.status + ' ' + JSON.stringify(manifestOf(zip).runs[0].claims));
  const ctl = checkPack(zip);
  assert.ok(ctl.ok, 'the control: ' + ctl.out);
  const misses = [];
  for (const [what, edit] of [
    ['the claim moved onto the other keep', (e, man) => { const c = claimOf(man, W.keepId), o = claimOf(man, W.keep2Id); if (o) man.runs[0].claims = man.runs[0].claims.filter((x) => x !== o); c.correction = W.keep2Id; }],
    ['the claim naming a correction the pack doesn\'t hold', (e, man) => { claimOf(man, W.keepId).correction = 'req-keep-' + 'f'.repeat(24); }],
    ['v2 holding v1\'s unchanged text, its listing kept', (e, man, g) => { Object.keys(K.unchanged.files).forEach((n) => { const y = g(K.v2 + '/' + n); if (y) e[y.pack] = Buffer.from(K.unchanged.files[n]); }); }]
  ]) {
    const c = checkPack(await repacked(PF, zip, edit));
    if (c.ok) misses.push(what + ': Python accepts');
  }
  assert.deepStrictEqual(misses, []);
});
/* TD: a file of another run changed at the same size during the SECOND read (its already-hashed first slice rewritten, so both
   hashes agree and only the size is the same): the modification time each open and the final stat give is compared too, so
   the change is read again within the export's tries and the file judged as it settles: named, the keep unconfirmed. */
rule('A keep whose process has a file rewritten at the same size during its second read is judged as it settles, named', async () => {
  const W = await made({ todos: 1, keep: 'placed' }), proc = W.key.split('/')[0], base = 'runs/' + proc + '/ctxrun0001/';
  const L = 1048576 + 4096, pad = (t) => t + ' '.repeat(L - Buffer.byteLength(t)), path = base + 'run.json', next = Buffer.from(pad('{}'));
  const fsx = new BytesFS(Object.assign({}, W.files, { [path]: pad(otherRoot(W, 'ctxrun0001')) })), blob = fsx.blob.bind(fsx);
  let opens = 0, swapped = false;
  fsx.blob = (p) => { if (p !== path) return blob(p); const n = ++opens; let k = 0; return Promise.resolve({ size: fsx.files.get(p).length, slice: (a, z) => ({ arrayBuffer: () => {
    const ab = Uint8Array.from(fsx.files.get(p).subarray(a, z)).buffer;
    /* Once the second open has hashed its first slice, that slice is rewritten: the rest is the same bytes. */
    if (n === 2 && ++k === 1 && !swapped) { swapped = true; fsx.files.set(p, next); fsx.mtimes.set(p, fsx.mtimes.get(p) + 2000); }
    return Promise.resolve(ab);
  } }) }); };
  const { res, zip } = await pack(W.PF, fsx, W.key);
  assert.ok(swapped, 'set-up: rewritten during the second read');
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(path) >= 0), res.status + ' ' + JSON.stringify(res.col.unresolved));
  const cl = manifestOf(zip).runs[0].claims.filter((c) => c.correction === W.keepId)[0];
  assert.ok(cl && !cl.verified, 'the keep isn\'t confirmed');
});
/* TE: a keep published in v2, where one of v2's files goes after it was sized (at its next stat, or as it's opened to be
   captured): the version can't be read, so it's named, the keep isn't confirmed, the pack is partial, and Python refuses a
   complete claim. */
rule('A keep whose process has a version file gone after it was sized leaves the pack partial, named', async () => {
  const K = await keptInV2(), PF = K.PF, W = K.W, misses = [];
  for (const n of ['map.md', 'types.json', 'publication.json']) {
    for (const when of ['stat', 'blob']) {
      const fsx = new BytesFS(K.files), path = K.v2 + '/' + n, stat = fsx.stat.bind(fsx), blob = fsx.blob.bind(fsx);
      let k = 0;
      if (when === 'stat') fsx.stat = (p) => { if (p === path && ++k === 2) fsx.files.delete(p); return stat(p); };
      else fsx.blob = (p) => { if (p === path) fsx.files.delete(p); return blob(p); };
      const { res, zip } = await pack(PF, fsx, W.key), what = n + ' gone at its ' + (when === 'stat' ? 'second stat' : 'capture');
      if (fsx.files.has(path)) { misses.push(what + ': set-up: never gone'); continue; }
      if (!(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(path) >= 0 || u.indexOf(K.v2 + ' ') >= 0))) { misses.push(what + ': ' + res.status + ' ' + JSON.stringify(res.col.unresolved)); continue; }
      const cl = manifestOf(zip).runs[0].claims.filter((c) => c.correction === W.keepId)[0];
      if (!(cl && !cl.verified)) misses.push(what + ': the keep is confirmed ' + JSON.stringify(cl));
      if (PY && checkPack(await repacked(PF, zip, (e, man) => forced(man))).ok) misses.push(what + ': Python accepts a complete claim');
    }
  }
  assert.deepStrictEqual(misses, []);
});
/* VA: the run reaches back to itself through a confirmed dependency (rev-1 fulfills a spread it holds), and also depends on
   an evidence run nobody calls confirmed. Walking from rev-1 back to the run expands the run's own dependencies too, so the
   evidence run is walked and checked: missing, title 42 or format /4, and Python refuses rev-1 as confirmed. */
rule('Python walks the run\'s other dependencies when a confirmed dependency\'s walk reaches back to it', async () => {
  if (!PY) return;
  const ws = await roleWorlds(), rev = ws.filter((x) => x.role === 'reverse')[0], ev = ws.filter((x) => x.role === 'evidence')[0];
  /* Both worlds are the same run with their own additions: the reverse world's files win where both have one. */
  const files = Object.assign({}, ev.files, rev.files), PF = rev.PF;
  const { zip } = await pack(PF, new BytesFS(files), rev.key), man0 = manifestOf(zip);
  assert.ok([rev.depKey, ev.depKey].every((k) => man0.runs[0].living.deps.some((d) => d.key === k)), 'set-up: both dependencies ' + JSON.stringify(man0.runs[0].living.deps.map((d) => d.key)));
  const evp = 'runs/' + ev.depKey + '/run.json';
  const partial = (edit) => repacked(PF, zip, (e, man, g) => {
    man.status = 'partial'; const lv = man.runs[0].living; lv.complete = false; lv.missing = ['Something else is missing.'];
    lv.deps.forEach((d) => { d.confirmed = d.key === rev.depKey; }); edit(e, man, g);
  });
  const runEdit = (fn) => (e, man, g) => { const y = g(evp), o = JSON.parse(e[y.pack]); fn(o); e[y.pack] = Buffer.from(JSON.stringify(o, null, 2)); };
  const ctl = checkPack(await partial(() => {}));
  assert.ok(ctl.ok, 'the control: ' + ctl.out);
  const misses = [];
  for (const [what, edit] of [
    ['the evidence run missing', (e, man, g) => { const y = g(evp); delete e[y.pack]; man.files = man.files.filter((f) => f !== y); }],
    ['the evidence run with title 42', runEdit((o) => { o.title = 42; })],
    ['the evidence run in format preflight-run/4', runEdit((o) => { o.format = 'preflight-run/4'; })]
  ]) { if (checkPack(await partial(edit)).ok) misses.push(what + ': Python accepts rev-1 as confirmed'); }
  assert.deepStrictEqual(misses, []);
});
/* VB: a fact a landed done rests on is held to what the done named and the receipt froze: its content, source and domain,
   and the run, item and attempt of the to-do. The fact's entries changed under the same id, or its run changed to another,
   leave the pack partial naming the fact (the ended outcome is unchanged), and Python refuses a complete claim. */
rule('A fact a landed done rests on that no longer says what it said, or names another run, attempt or source, leaves the work unconfirmed, named', async () => {
  const W = await factMade(), PF = W.PF;
  const full = await pack(PF, new BytesFS(W.files), W.key);
  assert.strictEqual(full.res.status, 'complete', 'the control: ' + JSON.stringify(full.res.col.unresolved));
  if (PY) assert.ok(checkPack(full.zip).ok, 'Python accepts the control: ' + checkPack(full.zip).out);
  const f = JSON.parse(W.files[W.factPath]);
  const worlds = {
    'its entries changed': Object.assign({}, f, { entries: [Object.assign({}, f.entries[0], { text: 'Fix the logout' })] }),
    'its run changed': Object.assign({}, f, { run: { process: f.run.process, id: 'otherrun0001' } }),
    'its attempt changed': Object.assign({}, f, { attempt: 2 }),
    'its source changed': Object.assign({}, f, { source: { feed: 'github' } })
  };
  const misses = [];
  for (const what of Object.keys(worlds)) {
    const files = Object.assign({}, W.files, { [W.factPath]: JSON.stringify(worlds[what], null, 2) + '\n' });
    assert.ok(PF.todos.cleanFile(JSON.parse(files[W.factPath]), W.factId + '.json').ok, what + ': set-up: the fact still reads');
    const { res, zip } = await pack(PF, new BytesFS(files), W.key);
    if (!(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(W.factId) >= 0))) misses.push(what + ': the export: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    const lv = manifestOf(zip).runs[0].living;
    if (!lv || lv.receipt.state !== 'confirmed') misses.push(what + ': the receipt stays confirmed: ' + JSON.stringify(lv && lv.receipt));
    if (PY) { const c = checkPack(await repacked(PF, zip, (e, man) => forced(man))); if (c.ok || c.out.indexOf(W.factId) < 0) misses.push(what + ': Python: ' + c.out); }
  }
  assert.deepStrictEqual(misses, []);
});
/* WA: each evidence entry of the receipt is bound to the landed work: its to-do, replayed through the chain, was checked off
   on exactly that evidence, in its current opening. A receipt made again (its id the one its content gives, run.json naming
   it) whose entry names a to-do the work never added, a copy of the fact with the same content about another item, a fact
   that isn't there, or a run and plan that aren't there leaves the pack partial, named; Python refuses a complete claim. */
rule('A receipt\'s evidence that isn\'t the evidence its to-do was checked off on leaves the work unconfirmed, named', async () => {
  const W = await factMade(), PF = W.PF, F = PF.facts, f = JSON.parse(W.files[W.factPath]);
  const ctl = await pack(PF, new BytesFS(rereceipt(W, (ev) => ev)), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the control, the receipt made again as it was: ' + JSON.stringify(ctl.res.col.unresolved));
  if (PY) assert.ok(checkPack(ctl.zip).ok, 'Python accepts the control: ' + checkPack(ctl.zip).out);
  const dupId = F.idFor('git-bot', 'prs-dup'), dup = Object.assign({}, f, { id: dupId, key: 'prs-dup', uid: f.uid.replace('ABC-101', 'ABC-999') });
  assert.ok(PF.todos.cleanFile(JSON.parse(JSON.stringify(dup)), dupId + '.json').ok, 'set-up: the copy is a fact the app reads');
  const worlds = {
    'a to-do the work never added': [(ev) => ev.map((e) => Object.assign({}, e, { todo: 'td-' + '0'.repeat(24) })), {}],
    'a copy of the fact about another item': [(ev) => ev.map((e) => Object.assign({}, e, { fact: dupId })), { ['proposals/' + dupId + '.json']: JSON.stringify(dup, null, 2) + '\n' }],
    'a fact that isn\'t there': [(ev) => ev.map((e) => Object.assign({}, e, { fact: 'req-git-bot-' + 'f'.repeat(24) })), {}],
    'a run and plan that aren\'t there': [(ev) => ev.map((e) => ({ todo: e.todo, plan: 'plan-ev-' + 'b'.repeat(24), run: { process: 'smoke-test', id: 'ghost1' }, answer: '2026-01-01T00:00:00Z 2026-01-01T00:00:00Z', result: 'pass' })), {}]
  };
  const misses = [];
  for (const what of Object.keys(worlds)) {
    const [edit, more] = worlds[what], files = Object.assign(rereceipt(W, edit), more);
    const { res, zip } = await pack(PF, new BytesFS(files), W.key);
    if (!(res.status === 'partial' && res.col.unresolved.some((u) => /receipt/.test(u)))) misses.push(what + ': the export: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    if (PY) { const c = checkPack(await repacked(PF, zip, (e, man) => forced(man))); if (c.ok) misses.push(what + ': Python: ' + c.out); }
  }
  assert.deepStrictEqual(misses, []);
});
/* Review round 1 (PR #114): a receipt's id is its own content, never proof of it. Made again with a recomputed id, a receipt
   that counts more answered steps or to-dos than the run's work, or that leaves out a request still pending at the end, leaves
   the pack partial, named; Python, replaying the packed bytes, refuses a complete claim for each. */
rule('A receipt with a recomputed id whose numbers aren\'t its work, or that leaves out a pending request, leaves the pack partial; Python refuses a complete claim', async () => {
  const W = await made({ todos: 2 }), PF = W.PF, T = PF.todos, r0 = PF.run.sanitize(JSON.parse(W.files[W.runPath]));
  /* A tool's request that saw nothing, pending at the end: the receipt made again as an honest one would have named it. */
  const q = T.buildProposal({ run: { process: r0.process, id: r0.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-loose', seen: [], at: new Date().toISOString(),
    body: { op: 'add', text: 'Ask support', target: { phase: 'draft' }, placement: T.placementFor(PF.run.mapOf(r0), { phase: 'draft' }) } });
  const withLoose = Object.assign({}, W.files, { ['proposals/' + q.id + '.json']: T.text(q) });
  const honest = (rc) => { rc.seen = rc.seen.concat([q.id]).sort(); rc.counts.asked++; rc.counts.pending++; rc.counts.waiting++; };
  const ctl = await pack(PF, new BytesFS(rereceipt(W, (ev) => ev, honest, withLoose)), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the control, the pending request named as an honest receipt names it: ' + JSON.stringify(ctl.res.col.unresolved));
  if (PY) assert.ok(checkPack(ctl.zip).ok, 'Python accepts the control: ' + checkPack(ctl.zip).out);
  const worlds = {
    'answered 999999': (rc) => { honest(rc); rc.counts.answered = 999999; },
    'a to-do more, done': (rc) => { honest(rc); rc.counts.todos++; rc.counts.resolved++; rc.counts.done++; },
    'the pending request left out': (rc) => { honest(rc); rc.seen = rc.seen.filter((x) => x !== q.id); }
  };
  const misses = [];
  for (const what of Object.keys(worlds)) {
    const { res, zip } = await pack(PF, new BytesFS(rereceipt(W, (ev) => ev, worlds[what], withLoose)), W.key);
    if (!(res.status === 'partial' && res.col.unresolved.some((u) => /says something its run's work doesn't/.test(u)))) misses.push(what + ': the export: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    /* The manifest made to claim the work complete, and then its receipt confirmed too: Python's own replay refuses both. */
    if (PY) {
      for (const confirm of [false, true]) {
        const c = checkPack(await repacked(PF, zip, (e, man) => { forced(man); if (confirm) man.runs.forEach((x) => { if (x.living && x.living.receipt) x.living.receipt.state = 'confirmed'; }); }));
        if (c.ok || !/receipt/.test(c.out)) misses.push(what + (confirm ? ', said confirmed' : '') + ': Python: ' + c.out);
      }
    }
  }
  assert.deepStrictEqual(misses, []);
});
/* Review round 2 (PR #114): a receipt is confirmed only on one past, and a request it calls declined needs a decline on it.
   The pending request with a second copy saying other text or naming another run, and a receipt with its id recomputed that
   moves the waiting request into declined (its totals balanced), leave the pack partial, named; Python, replaying the packed
   bytes, refuses a complete claim and a confirmed one for each. */
rule('A receipt resting on a request with a different copy, or calling a waiting request declined, leaves the pack partial; Python refuses a complete claim', async () => {
  const W = await made({ todos: 2 }), PF = W.PF, T = PF.todos, r0 = PF.run.sanitize(JSON.parse(W.files[W.runPath]));
  const q = T.buildProposal({ run: { process: r0.process, id: r0.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-loose', seen: [], at: new Date().toISOString(),
    body: { op: 'add', text: 'Ask support', target: { phase: 'draft' }, placement: T.placementFor(PF.run.mapOf(r0), { phase: 'draft' }) } });
  const withLoose = Object.assign({}, W.files, { ['proposals/' + q.id + '.json']: T.text(q) });
  const honest = (rc) => { rc.seen = rc.seen.concat([q.id]).sort(); rc.counts.asked++; rc.counts.pending++; rc.counts.waiting++; };
  const copyOf = (edit) => { const o = JSON.parse(T.text(q)); edit(o); return Object.assign({}, withLoose, { ['proposals/' + q.id + ' (1).json']: JSON.stringify(o, null, 2) + '\n' }); };
  const ctl = await pack(PF, new BytesFS(rereceipt(W, (ev) => ev, honest, withLoose)), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the control: ' + JSON.stringify(ctl.res.col.unresolved));
  if (PY) assert.ok(checkPack(ctl.zip).ok, 'Python accepts the control: ' + checkPack(ctl.zip).out);
  const worlds = {
    'a copy with other text': [honest, copyOf((o) => { o.text = 'A different task'; })],
    'a copy naming another run': [honest, copyOf((o) => { o.run = { process: r0.process, id: 'r-other' }; })],
    'waiting called declined': [(rc) => { honest(rc); rc.counts.waiting--; rc.counts.declined++; rc.counts.pending--; rc.counts.refused++; }, withLoose]
  };
  const misses = [];
  for (const what of Object.keys(worlds)) {
    const [whole, base] = worlds[what], { res, zip } = await pack(PF, new BytesFS(rereceipt(W, (ev) => ev, whole, base)), W.key);
    if (res.status !== 'partial' || !res.col.unresolved.some((u) => u.indexOf(q.id) >= 0 || /additions declined/.test(u))) misses.push(what + ': the export: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    if (PY) {
      for (const confirm of [false, true]) {
        const c = checkPack(await repacked(PF, zip, (e, man) => { forced(man); if (confirm) man.runs.forEach((x) => { if (x.living && x.living.receipt) x.living.receipt.state = 'confirmed'; }); }));
        if (c.ok || !/receipt|copies/.test(c.out)) misses.push(what + (confirm ? ', said confirmed' : '') + ': Python: ' + c.out);
      }
    }
  }
  assert.deepStrictEqual(misses, []);
});
/* WA: a done that landed on a run's evidence is held to that run as packed: it still gives the answer and result the done
   froze. The run ended again (another ended.at, so another answer) leaves the pack partial naming it, as the app says the
   evidence changed; the receipt's entry naming another run and plan is named too; Python refuses a complete claim. */
rule('A done on a run\'s evidence whose run now gives another answer, or a receipt naming another run, leaves the work unconfirmed, named', async () => {
  const W = await evidenceMade(), PF = W.PF;
  const ctl = await pack(PF, new BytesFS(W.files), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the control: ' + JSON.stringify(ctl.res.col.unresolved));
  if (PY) assert.ok(checkPack(ctl.zip).ok, 'Python accepts the control: ' + checkPack(ctl.zip).out);
  const ev = JSON.parse(W.files[W.evPath]);
  ev.ended.at = new Date(Date.parse(ev.ended.at) + 60000).toISOString();
  const worlds = {
    'its run ended again': Object.assign({}, W.files, { [W.evPath]: JSON.stringify(ev, null, 2) }),
    'the receipt naming another run and plan': rereceipt(W, (es) => es.map((e) => Object.assign({}, e, { plan: 'plan-ev-' + 'b'.repeat(24), run: { process: 'smoke-test', id: 'ghost1' } }))),
    'the receipt naming another answer': rereceipt(W, (es) => es.map((e) => Object.assign({}, e, { answer: e.answer + 'x' })))
  };
  const misses = [];
  for (const what of Object.keys(worlds)) {
    const { res, zip } = await pack(PF, new BytesFS(worlds[what]), W.key);
    if (!(res.status === 'partial' && res.col.unresolved.length)) misses.push(what + ': the export: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    if (PY) { const c = checkPack(await repacked(PF, zip, (e, man) => forced(man))); if (c.ok) misses.push(what + ': Python: ' + c.out); }
  }
  assert.deepStrictEqual(misses, []);
});
/* WC: the check runs both ways: an honest receipt froze the evidence of every to-do the work checked off on evidence, so a
   receipt made again with that entry left out leaves the pack partial, naming the to-do, in the fact world and the
   evidence world alike; Python refuses a complete claim. */
rule('A receipt that leaves out the evidence a landed done rests on leaves the work unconfirmed, named', async () => {
  const misses = [];
  for (const [what, make] of [['the fact world', factMade], ['the evidence world', evidenceMade]]) {
    const W = await make(), PF = W.PF;
    const ctl = await pack(PF, new BytesFS(rereceipt(W, (ev) => ev)), W.key);
    if (ctl.res.status !== 'complete') misses.push(what + ': the control: ' + JSON.stringify(ctl.res.col.unresolved));
    if (PY && !checkPack(ctl.zip).ok) misses.push(what + ': Python, the control: ' + checkPack(ctl.zip).out);
    const { res, zip } = await pack(PF, new BytesFS(rereceipt(W, () => [])), W.key);
    if (!(res.status === 'partial' && res.col.unresolved.some((u) => u.indexOf(W.todo) >= 0 && /receipt/.test(u)))) misses.push(what + ': the export: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
    /* The manifest made to claim the work complete and the receipt confirmed (the export calls it a mismatch: its claims
       are replayed against the work): Python's own replay refuses it, naming the to-do. */
    if (PY) { const c = checkPack(await repacked(PF, zip, (e, man) => { forced(man); man.runs.forEach((x) => { if (x.living && x.living.receipt) x.living.receipt.state = 'confirmed'; }); })); if (c.ok || c.out.indexOf(W.todo) < 0) misses.push(what + ': Python: ' + c.out); }
  }
  assert.deepStrictEqual(misses, []);
});
/* XA: a done on a run's evidence is judged in the opening it landed in, whatever came after. Add, done on a run, reopen, end:
   complete, and Python accepts it. That earlier done made again (its request id, effect and fingerprint, and every reference
   to it) to name the later opening's plan is named by the export, and Python refuses a complete claim. */
rule('A done on a run\'s evidence is held to the opening it landed in, even after the to-do was reopened', async () => {
  const W = await evidenceMade({ reopen: true }), PF = W.PF, T = PF.todos, D = PF.detours;
  const ctl = await pack(PF, new BytesFS(W.files), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the honest history: ' + JSON.stringify(ctl.res.col.unresolved));
  if (PY) assert.ok(checkPack(ctl.zip).ok, 'Python accepts the honest history: ' + checkPack(ctl.zip).out);
  /* The forged history: the done's evidence names the plan of the opening the reopen made. */
  const donePath = Object.keys(W.files).find((p) => /^proposals\/req-evidence-[0-9a-f]{24}\.json$/.test(p)), done = JSON.parse(W.files[donePath]);
  const later = D.planId({ process: W.run.process, id: W.run.id }, W.todo, W.reopenId), e2 = Object.assign({}, done.evidence, { plan: later }), newId = D.requestId(W.todo, e2);
  const files = {};
  Object.keys(W.files).forEach((p) => { const t = W.files[p]; files[p] = typeof t === 'string' && (/^proposals\//.test(p) || p === W.runPath) ? t.split(done.id).join(newId) : t; });
  delete files[donePath];
  const forged = JSON.parse(JSON.stringify(done)); forged.id = newId; forged.evidence = e2; forged.application.effect.evidence = e2; forged.application.fingerprint = T.fingerprint(forged.application.effect);
  files['proposals/' + newId + '.json'] = JSON.stringify(forged, null, 2) + '\n';
  const p1 = JSON.parse(W.files['proposals/' + done.evidence.plan + '.json']);
  files['proposals/' + later + '.json'] = JSON.stringify(Object.assign({}, p1, { id: later }), null, 2) + '\n';
  const F = rereceipt(Object.assign({}, W, { files }), (ev) => ev);
  assert.ok(T.cleanFile(JSON.parse(F['proposals/' + newId + '.json']), newId + '.json').ok, 'set-up: the forged done reads');
  const { res, zip } = await pack(PF, new BytesFS(F), W.key);
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => /another opening/.test(u)), 'the export names it: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
  if (PY) { const c = checkPack(await repacked(PF, zip, (e, man) => forced(man))); assert.ok(!c.ok && /another opening/.test(c.out), 'Python refuses it: ' + c.out); }
});
/* XB: the receipt is bound only to work the app can replay. The done's application made to rest on a clone of its fact (the
   same item and content, another id), its fingerprint made to match but its request left as it was, with the receipt made
   again to name the clone: the app's replay breaks there ("its effect isn't what ... asks for"), so the export is partial,
   naming it, and Python refuses a complete claim. The ended outcome is unchanged. */
rule('Work the app can\'t replay (an application whose effect isn\'t what its request asks for) leaves the pack partial, named', async () => {
  const W = await factMade(), PF = W.PF, T = PF.todos, F = PF.facts, f = JSON.parse(W.files[W.factPath]);
  const cloneId = F.idFor('git-bot', 'prs-clone'), clone = Object.assign({}, f, { id: cloneId, key: 'prs-clone' });
  const appPath = Object.keys(W.files).find((p) => { if (!/^proposals\/.*\.status-/.test(p)) return false; const o = JSON.parse(W.files[p]); return o.kind === 'application' && o.effect && o.effect.op === 'done' && o.effect.support; });
  assert.ok(appPath, 'set-up: the done\'s application');
  const a = JSON.parse(W.files[appPath]); a.effect.support.fact = cloneId; a.fingerprint = T.fingerprint(a.effect);
  const files = Object.assign(rereceipt(W, (ev) => ev.map((e) => Object.assign({}, e, { fact: cloneId }))), { [appPath]: JSON.stringify(a, null, 2) + '\n', ['proposals/' + cloneId + '.json']: JSON.stringify(clone, null, 2) + '\n' });
  const name = appPath.slice('proposals/'.length);
  assert.ok(T.cleanFile(JSON.parse(files[appPath]), name).ok, 'set-up: the application reads on its own');
  const got = await PF.repo.readTodos(new BytesFS(files)), r = PF.run.sanitize(JSON.parse(files[W.runPath]));
  const V = T.view(r, { records: T.recordsFor(got.records, r) });
  assert.ok(V.broken && /isn't what/.test(V.broken.why), 'set-up: the app\'s replay breaks there: ' + JSON.stringify(V.broken));
  const { res, zip } = await pack(PF, new BytesFS(files), W.key);
  assert.ok(res.status === 'partial' && res.col.unresolved.some((u) => /isn't what/.test(u)), 'the export names it: ' + res.status + ' ' + JSON.stringify(res.col.unresolved));
  assert.strictEqual(manifestOf(zip).runs[0].living.receipt.state, 'confirmed', 'the receipt stays confirmed');
  if (PY) { const c = checkPack(await repacked(PF, zip, (e, man) => forced(man))); assert.ok(!c.ok && /isn't what/.test(c.out), 'Python refuses it: ' + c.out); }
});
/* YB: a spread creation that leaves out its optional "spread" (readers derive it from the request's id) is replayed as the
   app replays it: the export is complete, and Python accepts it, its effect read from the body the checker checked. */
rule('A spread creation without its derived "spread" field is replayed as the app replays it, by the export and Python alike', async () => {
  const W = await spreadMade(), PF = W.PF, T = PF.todos;
  const ctl = await pack(PF, new BytesFS(W.files), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the control: ' + JSON.stringify(ctl.res.col.unresolved));
  if (PY) assert.ok(checkPack(ctl.zip).ok, 'Python accepts the control: ' + checkPack(ctl.zip).out);
  const o = JSON.parse(W.files[W.spreadPath]);
  assert.ok(o.spread, 'set-up: the spread creation names its spread');
  delete o.spread;
  const files = Object.assign({}, W.files, { [W.spreadPath]: JSON.stringify(o, null, 2) + '\n' });
  assert.ok(T.cleanFile(JSON.parse(files[W.spreadPath]), W.spreadPath.slice('proposals/'.length)).ok, 'set-up: the app reads it without the field');
  const got = await PF.repo.readTodos(new BytesFS(files)), r = PF.run.sanitize(JSON.parse(files[W.runPath]));
  assert.ok(!T.view(r, { records: T.recordsFor(got.records, r) }).broken, 'set-up: the app replays it');
  const { res, zip } = await pack(PF, new BytesFS(files), W.key);
  assert.strictEqual(res.status, 'complete', 'the export: ' + JSON.stringify(res.col.unresolved));
  if (PY) { const c = checkPack(zip); assert.ok(c.ok, 'Python accepts it: ' + c.out); }
});
/* YA: Python reads the run's work in the app's causal order (PF.loop.causal): a record that saw one it can't follow (a
   circle, a receipt, a fact, a record the folder doesn't hold) is held, with everything after it, and a held link breaks
   the chain. Each forgery keeps every id valid (what a record saw is in no id), the export is partial, and Python refuses
   a complete claim, on the run itself and on a run its work depends on. */
rule('Work whose records can\'t be read in causal order is held: a circle or a predecessor outside the work leaves the pack partial, named', async () => {
  const resee = (files, path, seen) => { const o = JSON.parse(files[path]); o.seen = seen; return Object.assign({}, files, { [path]: JSON.stringify(o, null, 2) + '\n' }); };
  const recs = (files, run) => Object.keys(files).filter((p) => /^proposals\/req-/.test(p)).map((p) => [p, JSON.parse(files[p])]).filter(([, o]) => o.run && o.run.process === run.process && o.run.id === run.id);
  const misses = [];
  const check = async (what, PF, files, key) => {
    const { res, zip } = await pack(PF, new BytesFS(files), key);
    if (res.status !== 'partial') misses.push(what + ': the export: ' + res.status);
    if (PY) { const c = checkPack(await repacked(PF, zip, (e, man) => forced(man))); if (c.ok) misses.push(what + ': Python: ' + c.out); }
  };
  /* The run itself: two to-dos added (compounds A then B, B the head), ended with a receipt. */
  const W = await made({ todos: 2 }), r = JSON.parse(W.files[W.runPath]), mine = recs(W.files, r);
  const A = mine.find(([, o]) => o.kind === 'compound' && o.id !== r.living.head), B = mine.find(([, o]) => o.id === r.living.head);
  assert.ok(A && B && B[1].seen.indexOf(A[1].id) >= 0, 'set-up: B saw A');
  const ctl = await pack(W.PF, new BytesFS(W.files), W.key);
  assert.strictEqual(ctl.res.status, 'complete', 'the control');
  if (PY) assert.ok(checkPack(ctl.zip).ok, 'Python accepts the control: ' + checkPack(ctl.zip).out);
  await check('A saw the head (a circle)', W.PF, resee(W.files, A[0], [B[1].id]), W.key);
  await check('A saw the receipt', W.PF, resee(W.files, A[0], [r.living.receipt]), W.key);
  /* A new request of the run that saw A, which A saw in turn. */
  const T = W.PF.todos, q = T.buildProposal({ run: { process: r.process, id: r.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-ya1', seen: [A[1].id], at: new Date().toISOString(), body: { op: 'add', text: 'Late', target: { phase: 'draft' }, placement: T.placementFor(W.PF.run.mapOf(W.PF.run.sanitize(r)), { phase: 'draft' }) } });
  await check('A saw a request that saw A', W.PF, Object.assign(resee(W.files, A[0], [q.id]), { ['proposals/' + q.id + '.json']: T.text(q) }), W.key);
  /* A fact (informational, never in the causal order) as a predecessor. */
  const FW = await factMade(), fr = JSON.parse(FW.files[FW.runPath]), fm = recs(FW.files, fr), first = fm.find(([, o]) => o.kind === 'compound');
  assert.ok(first, 'set-up: the fact world\'s first compound');
  await check('a record saw a fact', FW.PF, resee(FW.files, first[0], [FW.factId]), FW.key);
  /* A run the work depends on: the story run's own to-do saw itself through its head. */
  const L = await loopMade(), K = L.kid, km = recs(L.files, K), kh = km.find(([, o]) => o.id === K.living.head);
  assert.ok(kh, 'set-up: the story run\'s head');
  await check('the story run\'s head saw itself', L.PF, resee(L.files, kh[0], [kh[1].id]), L.key);
  /* A predecessor of another run (packed: the story run's head) for the parent's own head. */
  const ph = recs(L.files, L.run).find(([, o]) => o.id === L.run.living.head);
  assert.ok(ph, 'set-up: the parent\'s head');
  await check('the parent\'s head saw another run\'s record', L.PF, resee(L.files, ph[0], [kh[1].id]), L.key);
  assert.deepStrictEqual(misses, []);
});
/* YC: a pending spread creation may leave out its derived "spread" (omitted or null); a request on another run fulfilling
   that derived spread still makes that run part of the work, on the run itself and on a run its work depends on. The honest
   pack is complete and Python accepts it; with that run taken out of the pack, Python refuses a complete claim. */
rule('A request fulfilling a spread whose pending creation leaves out its derived id makes its run part of the work, in the export and Python alike', async () => {
  const W = await spreadMade(), PF = W.PF, T = PF.todos, base = JSON.parse(W.files[W.runPath]), at = new Date().toISOString();
  const add = JSON.parse(W.files[W.spreadPath]), r = PF.run.sanitize(base), pair = { uid: 'jira.issue:key:ABC-7', attempt: 1 };
  const clone = (files, id) => { const o = Object.assign({}, base, { id }); delete o.living; delete o.ended; delete o.parent; o.state = 'running'; if (Array.isArray(o.features)) o.features = o.features.filter(f => f !== 'living-runs'); files['runs/' + base.process + '/' + id + '/run.json'] = JSON.stringify(o, null, 2); };
  const write = (files, f, spread) => { const o = JSON.parse(T.text(f)); if (spread === undefined) delete o.spread; else if (spread !== 'written') o.spread = spread; files['proposals/' + f.id + '.json'] = JSON.stringify(o, null, 2) + '\n'; };
  /* A pending spread creation on run `on` (its derived spread written as given), and a request on run `by` fulfilling it. */
  const pending = (files, on, by, key, spread) => {
    const q = T.buildProposal({ run: { process: base.process, id: on }, id: T.idFor('flightdeck', key), by: 'person-avery', seen: [], at, body: { op: 'spread-add', loopStep: add.loopStep, text: 'Late sign-off', child: add.child, scope: add.scope } });
    assert.ok(q.spread, 'set-up: the app derives the spread');
    write(files, q, spread);
    assert.ok(T.cleanFile(JSON.parse(files['proposals/' + q.id + '.json']), q.id + '.json').ok, 'set-up: the app reads the creation without its derived id');
    const ful = T.buildProposal({ run: { process: base.process, id: by }, producer: { name: 'notes-bot', version: '1.0' }, key: PF.spreads.obligationId(q.spread, pair.uid, 1), seen: [], at,
      body: { op: 'add', text: 'Covered', target: { phase: 'ship' }, placement: T.placementFor(PF.run.mapOf(r), { phase: 'ship' }), fulfills: { run: { process: base.process, id: on }, spread: q.spread, uid: pair.uid, attempt: 1 } } });
    files['proposals/' + ful.id + '.json'] = T.text(ful);
  };
  const misses = [];
  for (const [how, spread] of [['written in full (the control)', 'written'], ['omitted', undefined], ['null', null]]) {
    for (const where of ['the run', 'a dependency run']) {
      const files = Object.assign({}, W.files);
      let depKey;
      if (where === 'the run') { clone(files, 'yc-1'); pending(files, base.id, 'yc-1', 'yc-root', spread); depKey = base.process + '/yc-1'; }
      else {
        /* yc-1 fulfills the spread the run holds (named in full); yc-1's own pending creation leaves its id out, and yc-2 fulfills it. */
        clone(files, 'yc-1'); clone(files, 'yc-2');
        const ful = T.buildProposal({ run: { process: base.process, id: 'yc-1' }, producer: { name: 'notes-bot', version: '1.0' }, key: PF.spreads.obligationId(add.spread, pair.uid, 1), seen: [], at,
          body: { op: 'add', text: 'Covered', target: { phase: 'ship' }, placement: T.placementFor(PF.run.mapOf(r), { phase: 'ship' }), fulfills: { run: { process: base.process, id: base.id }, spread: add.spread, uid: pair.uid, attempt: 1 } } });
        files['proposals/' + ful.id + '.json'] = T.text(ful);
        pending(files, 'yc-1', 'yc-2', 'yc-dep', spread);
        depKey = base.process + '/yc-2';
      }
      const what = how + ', on ' + where;
      const ok = await pack(PF, new BytesFS(files), W.key);
      if (ok.res.status !== 'complete') { misses.push(what + ': the export: ' + JSON.stringify(ok.res.col.unresolved).slice(0, 300)); continue; }
      if (!manifestOf(ok.zip).files.some((f) => f.path === 'runs/' + depKey + '/run.json')) misses.push(what + ': the export packs ' + depKey);
      if (!PY) continue;
      const c = checkPack(ok.zip);
      if (!c.ok) misses.push(what + ': Python refuses the honest pack: ' + c.out);
      const gone = checkPack(await repacked(PF, ok.zip, (e, man) => {
        man.files.filter((f) => f.path.indexOf('runs/' + depKey + '/') === 0).forEach((f) => { delete e[f.pack]; });
        man.files = man.files.filter((f) => f.path.indexOf('runs/' + depKey + '/') !== 0);
        man.runs = man.runs.filter((x) => x.key !== depKey);
        man.runs.forEach((x) => { if (x.living) x.living.deps = (x.living.deps || []).filter((d) => d.key !== depKey); });
        forced(man);
      }));
      if (gone.ok || gone.out.indexOf(depKey) < 0) misses.push(what + ': Python, ' + depKey + ' left out: ' + gone.out);
    }
  }
  assert.deepStrictEqual(misses, []);
});
run();
