// Test runs (2.1 slice 5): a run on a stage, written as preflight-run/3 naming staged and test-run, with test: true and
// stage: { folder } last, exactly as the frozen sample (test/fixtures/v2 run-t). Any other shape of those fields is read-only
// here. A stage takes test runs only; a version never takes one. A test run's version is its stage, checked under staged/.
'use strict';
const assert = require('assert');
const fsN = require('fs'), path = require('path');
const { load, example, exampleSetup, rule, run } = require('./harness');
const PF = load(), P = PF.publish, R = PF.run, repo = PF.repo, E = PF.envelope;
const EX = exampleSetup(PF);
const NOW = '2026-10-22T09:00:00.000Z';
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const people = JSON.parse(example('people.json'));
const MD = example('maps/drafts/release.md');
const CHANGED = MD.replace('Smoke prompts return', 'Smoke prompts all return');
const RUN_T = fsN.readFileSync(path.join(__dirname, 'fixtures', 'v2', 'folder', 'runs', 'backup', 'run-t', 'run.json'), 'utf8');

function folder() {
  const fs = new PF.fs.MemoryFS('tests:' + Math.random(), null);
  fs.reset({ 'people.json': example('people.json'), 'maps/drafts/release.md': MD });
  return fs;
}
const opts = (o) => Object.assign({ people, ...EX, by: 'person-avery', changes: 'Try the new smoke test', now: NOW, app: '2.1.0' }, o || {});
async function staged(fs) {
  const res = await repo.publish(fs, MD, opts({ changes: 'First version', existing: [] }));
  assert.ok(!res.blockers, String(res.blockers));
  const d = await repo.loadAll(fs), p = d.processes[0];
  const st = await repo.stage(fs, CHANGED, opts({ existing: p.pubs.map(x => ({ version: P.versionOf(x.folder) || 0 })), rand: 'abcd1234' }));
  assert.ok(st && !st.blockers, JSON.stringify(st));
  const stage = await repo.readStage(fs, 'release', 'stage-abcd1234');
  assert.ok(stage.ok, stage.why);
  return { d, stage };
}
const start = (pub, o) => R.create(pub, Object.assign({ title: 'Release (test)', details: {}, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-avery', now: NOW, app: '2.1.0', id: 'run-test1' }, o || {}));
const keys = (o) => Object.keys(o);
const snap = (fs) => JSON.stringify(Object.keys(fs.files).sort().map(p => [p, fs.files[p].t]));

/* ---------- Writing ---------- */

rule('A test run on a stage is run/3 naming staged and test-run, on the number the stage proposes, with test and stage last', async () => {
  const fs = folder(), { stage } = await staged(fs);
  const r = start(stage, { test: true });
  same([r.format, r.features, r.folder, r.version, r.test, r.stage], ['preflight-run/3', ['staged', 'test-run'], 'stage-abcd1234', 2, true, { folder: 'stage-abcd1234' }]);
  same(keys(r).slice(-2), ['test', 'stage']);
  same(r.payload, stage.info.payload, 'the stage\'s payload, frozen into the run');
  assert.ok(R.isTest(r) && R.pubDir(r) === 'staged/release/stage-abcd1234/');
  await repo.saveRun(fs, r, 'w-avery');
  const text = fs.files['runs/release/run-test1/run.json'].t, o = JSON.parse(text);
  same(keys(o).slice(-2), ['test', 'stage'], 'saved with test and stage last, as the frozen sample');
  const back = R.sanitize(o);
  assert.ok(back && !back._unrunnable && back.test === true && back.stage.folder === 'stage-abcd1234', back && back._unrunnable);
});

rule('A stage takes test runs only, and only a stage takes a test run', async () => {
  const fs = folder(), { d, stage } = await staged(fs);
  assert.throws(() => start(stage, {}), /test runs only/);
  assert.throws(() => start(d.processes[0].index.latest, { test: true }), /Only a staged version takes test runs/);
  assert.ok(!start(d.processes[0].index.latest, {}).test, 'an ordinary run has no test field');
  assert.ok(!('test' in start(d.processes[0].index.latest, {})) && !('stage' in start(d.processes[0].index.latest, {})));
});

/* ---------- Reading ---------- */

rule('The frozen run-t is read exactly: every field kept as written, in its order, and runnable here', () => {
  const r = R.sanitize(JSON.parse(RUN_T));
  assert.ok(r && !r._unrunnable, r && r._unrunnable);
  same(R.unexplained(JSON.parse(RUN_T)), [], 'nothing it holds is dropped or changed');
  same(R.repairs(JSON.parse(RUN_T)), [], 'nothing repaired');
  same(keys(r), keys(JSON.parse(RUN_T)), 'its fields in the frozen order');
  same([r.features, r.test, r.stage, r.payload], [JSON.parse(RUN_T).features, true, { folder: 'stage-aaaa1111' }, JSON.parse(RUN_T).payload]);
  assert.ok(R.isTest(r) && r.version === 3 && r.folder === 'stage-aaaa1111');
  assert.ok(E.judge('preflight-run', JSON.parse(RUN_T)).ok, 'run/3 knows staged and test-run');
});

rule('Any other shape of the test-run fields is read-only, labeled a test run when it says test, and never saved', async () => {
  const base = JSON.parse(RUN_T);
  const bad = {
    'test is false': Object.assign({}, base, { test: false }),
    'test is a string': Object.assign({}, base, { test: 'yes' }),
    'no stage': (() => { const o = Object.assign({}, base); delete o.stage; return o; })(),
    'stage with an extra key': Object.assign({}, base, { stage: { folder: 'stage-aaaa1111', proposed: 3 } }),
    'stage naming another folder': Object.assign({}, base, { stage: { folder: 'stage-bbbb2222' } }),
    'stage that isn\'t a stage folder': Object.assign({}, base, { stage: { folder: 'v3-aaaa1111' }, folder: 'v3-aaaa1111' }),
    'stage that is a list': Object.assign({}, base, { stage: ['stage-aaaa1111'] }),
    'without test-run': Object.assign({}, base, { features: ['typed-details', 'typed-evidence', 'staged'] }),
    'without staged': Object.assign({}, base, { features: ['typed-details', 'typed-evidence', 'test-run'] }),
    'features but no test fields': (() => { const o = Object.assign({}, base); delete o.test; delete o.stage; return o; })(),
    'no payload': (() => { const o = Object.assign({}, base); delete o.payload; return o; })(),
    'features out of order': Object.assign({}, base, { features: ['typed-details', 'typed-evidence', 'test-run', 'staged'] }),
    'version 0': Object.assign({}, base, { version: 0 }),
    'version as text': Object.assign({}, base, { version: '3' }),
    'test and stage first': (() => { const o = { test: true, stage: base.stage }; Object.keys(base).forEach(k => { if (k !== 'test' && k !== 'stage') o[k] = base[k]; }); return o; })(),
    'a field after stage': Object.assign({}, base, { extra: 1 }),
    'no test, stage kept': (() => { const o = Object.assign({}, base); delete o.test; const st = o.stage; delete o.stage; o.stage = st; return o; })(),
    'an ordinary run on a stage folder': (() => { const o = Object.assign({}, base, { features: ['typed-details', 'typed-evidence'] }); delete o.test; delete o.stage; return o; })()
  };
  const fs = new PF.fs.MemoryFS('bad:' + Math.random(), null);
  for (const name of Object.keys(bad)) {
    const r = R.sanitize(JSON.parse(JSON.stringify(bad[name])));
    assert.ok(r && r._unrunnable, name + ': read-only');
    assert.ok(!('test' in r) || r._unrunnable, name);
    assert.ok(R.isTest(r), name + ': labeled a test run, so it\'s never counted');
    assert.ok(!PF.insights.folders([r], r.process, [], []).some(f => /^stage-/.test(f.folder)), name + ': never a version to choose');
    fs.reset({ ['runs/backup/run-t/run.json']: JSON.stringify(bad[name], null, 2) });
    const before = snap(fs);
    await assert.rejects(() => repo.saveRun(fs, r, 'w-avery'), e => e.unrunnable, name);
    assert.strictEqual(snap(fs), before, name + ': nothing written');
  }
  const two = R.sanitize(Object.assign(JSON.parse(RUN_T), { format: 'preflight-run/2', features: undefined }));
  assert.ok(!two || two._unrunnable, 'a run/2 saying test is read-only');
});

/* ---------- Its version is its stage ---------- */

rule('Saving a test run checks its stage under staged/: a matching stage saves, a changed one refuses, a missing one waits like a syncing version', async () => {
  const fs = folder(), { stage } = await staged(fs);
  const r = start(stage, { test: true });
  await repo.saveRun(fs, r, 'w-avery');
  const again = R.sanitize(JSON.parse(fs.files['runs/release/run-test1/run.json'].t)); again._fileHash = PF.util.hash(fs.files['runs/release/run-test1/run.json'].t);
  again.title = 'Renamed'; await repo.saveRun(fs, again, 'w-avery');
  assert.ok(/Renamed/.test(fs.files['runs/release/run-test1/run.json'].t), 'a test run on its verified stage saves');
  /* A run whose checklist isn't its stage's is refused for that run. */
  const other = R.sanitize(JSON.parse(fs.files['runs/release/run-test1/run.json'].t)); other._fileHash = PF.util.hash(fs.files['runs/release/run-test1/run.json'].t);
  other.mapHash = 'deadbeef'; other.title = 'Mismatch';
  const before = snap(fs);
  await assert.rejects(() => repo.saveRun(fs, other, 'w-avery'), e => e.unrunnable && /changed in the folder/.test(e.message));
  assert.strictEqual(snap(fs), before, 'nothing written');
  const why = await repo.pubProblem(fs, Object.assign({}, r, { version: 9 }));
  assert.ok(/changed in the folder/.test(why), 'the proposed number is its version: ' + why);
  assert.strictEqual(await repo.pubProblem(fs, Object.assign({}, r, { folder: 'stage-zzzz9999', stage: { folder: 'stage-zzzz9999' } })), '', 'a stage not there yet says nothing, as a version still syncing');
});

rule('A test run never reads publications/ for its version, and an ordinary run never reads staged/', async () => {
  const fs = folder(), { d, stage } = await staged(fs);
  const r = start(stage, { test: true }), plain = start(d.processes[0].index.latest, { id: 'run-plain1' });
  const seen = [], orig = fs.read.bind(fs);
  fs.read = (p, o) => { seen.push(p); return orig(p, o); };
  await repo.pubProblem(fs, r); await repo.pubProblem(fs, plain);
  assert.ok(seen.some(p => /^staged\/release\/stage-abcd1234\/publication\.json$/.test(p)) && !seen.some(p => /^publications\/release\/stage-/.test(p)), seen.join(', '));
  assert.ok(seen.some(p => /^publications\/release\/v1-/.test(p)) && seen.filter(p => /^staged\//.test(p)).every(p => /stage-abcd1234/.test(p)), seen.join(', '));
});

rule('A stage that turns out not to verify makes its test runs read-only, named; the stage\'s versions stay untouched', async () => {
  const fs = folder(), { stage } = await staged(fs);
  const r = start(stage, { test: true });
  await repo.saveRun(fs, r, 'w-avery');
  const pj = 'staged/release/stage-abcd1234/publication.json', info = JSON.parse(fs.files[pj].t);
  info.stage = { proposed: 'two' }; await fs.write(pj, JSON.stringify(info, null, 2));
  const why = await repo.pubProblem(fs, R.sanitize(JSON.parse(fs.files['runs/release/run-test1/run.json'].t)));
  assert.ok(why && /proposes/.test(why), why);
  const d = await repo.loadAll(fs, { deep: true }), t = d.runs.find(x => x.id === 'run-test1');
  assert.ok(t && R.isTest(t), 'still listed, still a test run');
  assert.ok(t._unrunnable && /proposes/.test(t._unrunnable), 'read-only on load, with the stage\'s reason: ' + t._unrunnable);
  assert.ok(d.processes[0].pubs.every(p => !/^stage-/.test(p.folder)), 'never a version');
});

rule('startTestRun reads the stage and its decisions again, builds the run only after them, and refuses a retired or promoted stage', async () => {
  const fs = folder(), { d, stage } = await staged(fs), pubs = d.processes[0].pubs;
  const order = [], orig = fs.read.bind(fs);
  fs.read = (p, o) => { order.push('read ' + p); return orig(p, o); };
  const make = (st) => { order.push('make'); return start(st, { test: true, id: 'run-test2' }); };
  const res = await repo.startTestRun(fs, 'release', 'stage-abcd1234', { pubs, session: 'w-avery', writer: 'w-avery', make });
  fs.read = orig;
  assert.ok(res.run && res.run.test === true && fs.files['runs/release/run-test2/run.json'], 'started');
  const at = order.indexOf('make');
  assert.ok(order.slice(0, at).some(x => /staged\/release\/stage-abcd1234\/publication\.json$/.test(x)), 'the stage was read before the run was built: ' + order.join(', '));
  const before = snap(fs);
  const dropped = await repo.startTestRun(fs, 'release', 'stage-abcd1234', { pubs, session: 'w-avery', still: () => false, make: () => { throw new Error('never built'); } });
  assert.ok(dropped.dropped && snap(fs) === before, 'a change of person or folder: nothing built, nothing written');
  await repo.decideStage(fs, 'release', 'stage-abcd1234', 'retired', { by: 'person-blake', now: NOW, window: 'w-blake', app: '2.1.0' });
  const before2 = snap(fs);
  await assert.rejects(() => repo.startTestRun(fs, 'release', 'stage-abcd1234', { pubs, session: 'w-avery', make }), /retired/);
  assert.strictEqual(snap(fs), before2, 'retired: nothing written');
  await repo.decideStage(fs, 'release', 'stage-abcd1234', 'reopened', { by: 'person-blake', now: NOW, window: 'w-blake', app: '2.1.0' });
  await repo.promote(fs, 'release', 'stage-abcd1234', { by: 'person-blake', now: NOW, app: '2.1.0', rand: 'promoted' });
  const after = await repo.loadAll(fs, { deep: true });
  assert.ok(after.processes[0].pubs.length > pubs.length);
  await assert.rejects(() => repo.startTestRun(fs, 'release', 'stage-abcd1234', { pubs, session: 'w-avery', make }), /already the default/, 'promoted after the versions were last read: the listing is read again');
});

rule('startTestRun refuses when the stage can\'t be read at the save, and asks still() again right before the first write', async () => {
  const fs = folder(), { stage } = await staged(fs);
  const pj = 'staged/release/stage-abcd1234/publication.json', orig = fs.read.bind(fs);
  let n = 0;
  fs.read = (p, o) => (p === pj && ++n >= 2 ? Promise.reject(new Error('offline')) : orig(p, o));
  const before = snap(fs);
  await assert.rejects(() => repo.startTestRun(fs, 'release', 'stage-abcd1234', { session: 'w-avery', make: (st) => start(st, { test: true, id: 'run-test3' }) }), /can.t be read now/);
  fs.read = orig;
  assert.strictEqual(snap(fs), before, 'a failed read is never fine: nothing written');
  let asks = 0;
  const still = () => ++asks < 2;
  const res = await repo.startTestRun(fs, 'release', 'stage-abcd1234', { session: 'w-avery', still, make: (st) => start(st, { test: true, id: 'run-test4' }) });
  assert.ok(res.dropped && asks >= 2 && snap(fs) === before, 'the person changed while the run file was checked: nothing written');
  void stage;
});

rule('A test run starts no linked runs: they would be real, counted runs', async () => {
  const fs = folder(), { stage } = await staged(fs);
  const r = start(stage, { test: true }), map = R.mapOf(r);
  const step = map.phases[0].steps[0].id;
  assert.ok(/test run doesn.t start linked runs/.test(R.canStartChild(r, map, step)));
});

rule('A linked run started from a test run names no parent folder (a stage isn\'t a version), so every 2.0 copy reads it in full', async () => {
  const fs = folder(), { stage } = await staged(fs);
  const kid = start(stage, { test: true, id: 'kid1', parent: { process: 'release', id: 'run-test1', step: 'x', folder: 'stage-abcd1234' } });
  assert.ok(kid.parent && !('folder' in kid.parent), JSON.stringify(kid.parent));
  const kid2 = start(stage, { test: true, id: 'kid2', parent: { process: 'release', id: 'run-1', step: 'x', folder: 'v1-aaaa1111' } });
  assert.strictEqual(kid2.parent.folder, 'v1-aaaa1111', 'a version folder is kept, as before');
});

rule('Evidence checks a test run\'s version against the number its stage proposes', () => {
  const base = path.join(__dirname, 'fixtures', 'v2', 'folder', 'staged', 'backup', 'stage-aaaa1111');
  const pub = { 'map.md': fsN.readFileSync(path.join(base, 'map.md'), 'utf8'), 'types.json': fsN.readFileSync(path.join(base, 'types.json'), 'utf8'), 'publication.json': fsN.readFileSync(path.join(base, 'publication.json'), 'utf8') };
  const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
  const images = { '\u0000map.md': { sha256: sha(pub['map.md']) }, '\u0000types.json': { sha256: sha(pub['types.json']) } };
  const pc = (raw) => PF.evidence.checks(raw, pub, images, true).filter(c => c.id === 'publication')[0];
  assert.ok(!/proposes/.test(pc(JSON.parse(RUN_T)).detail), 'run-t is on v3, as its stage proposes: ' + pc(JSON.parse(RUN_T)).detail);
  const nine = pc(Object.assign(JSON.parse(RUN_T), { version: 9 }));
  assert.ok(nine.ok === false && /proposes v3/.test(nine.detail), JSON.stringify(nine));
});

rule('A correction from a test run can land in the stage\'s own promotion, the version it proposes', () => {
  const C = PF.corrections, pubs = [{ ok: true, md: '', info: { version: 2, folder: 'v2-aaaa1111' } }];
  const g = (test) => ({ id: 'g1', status: 'applied', tie: false, members: [{ test, version: 2 }], decision: { status: 'included', folder: 'v2-aaaa1111' }, target: { step: 'x' }, change: { op: 'none' } });
  assert.strictEqual((C.landing([g(true)], pubs)[0].landed || {}).version, 2, 'a test run on staged v2: published in v2');
  assert.strictEqual(C.landing([g(false)], pubs)[0].landed, null, 'a run of v2: never "published in v2"');
});

rule('Role rotation never counts a test run', () => {
  const t = R.sanitize(JSON.parse(RUN_T)), plain = Object.assign({}, t, { test: undefined, _test: undefined, id: 'run-p' });
  t.roles = { lead: 'person-avery' }; plain.roles = { lead: 'person-blake' };
  same(R.rotation([t, plain], 'backup').roles, ['lead']);
  assert.ok(!R.rotation([t, plain], 'backup').grid['person-avery'] && R.rotation([t, plain], 'backup').grid['person-blake'], 'only the real run');
});

rule('The test-run form has its own address, with the stage, so Back and Forward bring the test-run form back', () => {
  const N = PF.nav, h = N.format({ view: 'process', process: 'release', sub: 'start', stage: 'stage-abcd1234' });
  assert.strictEqual(h, '#/process/release/start/stage-abcd1234');
  same(N.parse(h), { view: 'process', process: 'release', sub: 'start', stage: 'stage-abcd1234' });
  same(N.locate({ view: 'start', processId: 'release', planId: null, testStage: 'stage-abcd1234' }), { view: 'process', process: 'release', sub: 'start', stage: 'stage-abcd1234' });
  same(N.locate({ view: 'start', processId: 'release', planId: null, testStage: null }), { view: 'process', process: 'release', sub: 'start' });
  assert.strictEqual(N.parse('#/process/release/start/v2-aaaa1111'), null, 'only a stage folder');
});

run();
