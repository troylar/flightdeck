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
const { made, pack, loopMade, roleWorlds, PY, sha, unzip, rezip, checkPack, manifestOf, repacked, forced } = require('./living-worlds');

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
  const fsx = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === W.kidPath && !n++) swap(x); } } });
  const { res } = await pack(W.PF, fsx, W.key);
  assert.ok(n >= 1, 'set-up: the bytes changed before the capture');
  assert.strictEqual(res.status, 'partial', JSON.stringify(res.col.unresolved));
  assert.ok(res.col.unresolved.some(u => u.indexOf(W.kidPath) >= 0 && /changed/.test(u)), JSON.stringify(res.col.unresolved));
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
    const fsx = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === target && !n++) x.files.set(p, Buffer.from(c)); } } });
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
    const fsx = new BytesFS(files, { hooks: { blob: (p, x) => { if (p === path && !n++) x.files.set(p, Buffer.from(c)); } } });
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
  const fsx = new BytesFS(W.files, { hooks: { blob: (p, x) => { if (p === pub && !n++) { const b = x.files.get(p).toString('utf8'); x.files.set(p, Buffer.from('[' + b.slice(1))); } } } });
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
  const make = (N) => repacked(PF, full.zip, (e, man, f) => {
    const x = f('proposals/' + id + '.json'), o = JSON.parse(e[x.pack]);
    const ids = Array.from({ length: N }, (_, i) => 'req-flightdeck-' + crypto.createHash('sha256').update('lf' + i).digest('hex').slice(0, 24));
    o.seen = N ? [ids[0]] : [];
    e[x.pack] = Buffer.from(JSON.stringify(o, null, 2) + '\n');
    ids.forEach((rid, i) => {
      const path = 'proposals/' + rid + '.json', pk = x.pack.slice(0, x.pack.length - x.path.length) + path;
      e[pk] = Buffer.from(JSON.stringify({ id: rid, kind: 'proposal', run: o.run, seen: i + 1 < N ? [ids[i + 1]] : [] }) + '\n');
      man.files.push(Object.assign({}, x, { path, pack: pk }));
    });
  });
  const small = checkPack(await make(10));
  assert.ok(small.ok, 'under the bound it holds: ' + small.out);
  const over = checkPack(await make(4998));
  assert.ok(!over.ok && /more|bound|holds at most/.test(over.out), 'over the bound in total: ' + over.out);
});

run();
