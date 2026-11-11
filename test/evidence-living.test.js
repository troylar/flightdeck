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
const { made, pack, SHOT, loopMade, roleWorlds, PY, sha, unzip, rezip, checkPack, manifestOf, repacked, forced } = require('./living-worlds');

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
  const small = checkPack(await make(10));
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
    const c = checkPack(await repacked(W.PF, zip, (e, man) => forced(man)));
    assert.ok(!c.ok && /two different copies/.test(c.out), what + ': Python: ' + c.out);
  }
});
run();
