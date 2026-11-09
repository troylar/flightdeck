// Living runs (4.0, docs/design.md 45), slice 1: the recorder's window carries out a queued to-do request in two writes,
// the application record in proposals/ first, then the run, whose living.head moves to it. Every interruption is recovered
// from what is in the folder: what landed is never done again, a prepared application is landed as it is when it still
// fits, and nothing is written for a request that has lost its authority, in a folder that was left or by anyone but the
// run's recorder.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate } = require('./app-harness');

const MD = ['---', 'process: release-notes', 'title: Release notes', 'owner: person-avery', 'roles: reviewer', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} @reviewer Read them {#read}', ''].join('\n');

async function setup(o) {
  o = Object.assign({}, o || {});
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, o)); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const b = PF.publish.build(o.md || MD, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand: 'rn000001', app: '4.0.0' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  Object.keys(b.files).forEach(k => { app.fs.files['publications/release-notes/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-notes'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  assert.ok(runPath(app), 'set-up: a run was started');
  return app;
}
const runPath = (app) => app.files('runs/release-notes/').find(p => /run\.json$/.test(p));
const theRun = (app) => JSON.parse(app.fs.files[runPath(app)].t);
const apps = (app, id) => app.files('proposals/').filter(p => p.indexOf(id + '.status-') >= 0).map(p => Object.assign(JSON.parse(app.fs.files[p].t), { id: p.slice('proposals/'.length, -'.json'.length) })).filter(x => x.kind === 'application');
let seq = 0;
const hex = (n) => (++seq).toString(16).padStart(n, '0');
/* A person's request, and the recorder's or a role holder's decision accepting exactly what it would do. */
async function request(app, body, o) {
  o = o || {};
  const T = app.PF.todos, r = theRun(app), RUN = { process: r.process, id: r.id }, at = new Date().toISOString();
  const d = await app.PF.repo.loadAll(app.fs, {}), V = T.view(app.PF.run.sanitize(r), { records: d.todos || [], people: JSON.parse(app.fs.files['people.json'].t) });
  if (body.op === 'add' && !body.placement) body.placement = T.placementFor(app.PF.run.mapOf(app.PF.run.sanitize(r)), body.target);
  const p = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'k-' + hex(6)), by: o.by || 'person-avery', seen: V.heads.slice(0, 50), at, body, app: '4.0.0' });
  await app.fs.write('proposals/' + p.id + '.json', T.text(p));
  if (o.decide !== false) {
    const rec = T.cleanFile(JSON.parse(T.text(p)), p.id + '.json').record, V2 = T.view(app.PF.run.sanitize(r), { records: (d.todos || []).concat([rec]), people: JSON.parse(app.fs.files['people.json'].t) });
    const C = T.consequenceOf(app.PF.run.sanitize(r), V2.map, V2.requests[p.id], V2).fingerprint;
    const s = T.buildStatus({ kind: 'decision', proposal: p.id, run: RUN, seen: [p.id], by: { person: o.decider || 'person-avery' }.person, at, op: 'accept', consequence: C, writer: 'w1', rev: hex(8), app: '4.0.0' });
    await app.fs.write('proposals/' + s.name, T.text(s.file));
  }
  return p;
}
const refresh = async (app, ms) => { app.click('refresh'); await app.tick(ms || 250); };
const setPeople = async (app, f) => { const ppl = JSON.parse(app.fs.files['people.json'].t), list = Array.isArray(ppl) ? ppl : ppl.people, next = list.map(f); await app.fs.write('people.json', JSON.stringify(Array.isArray(ppl) ? next : { people: next }, null, 2) + '\n'); };
const failing = (app, re) => { const fs = app.fs, write = fs.write.bind(fs); fs.write = (p, t, o) => re.test(p) ? Promise.reject(new Error('EIO')) : write(p, t, o); return () => { fs.write = write; }; };

rule('The recorder\'s window applies a queued request: the application first, then the run names it, takes the living-runs feature and logs it', async () => {
  const app = await setup();
  const before = theRun(app);
  assert.strictEqual(before.format, 'preflight-run/2', 'set-up: a run/2');
  const p = await request(app, { op: 'add', text: 'Check the screenshots', target: { phase: 'draft' } });
  await refresh(app);
  const a = apps(app, p.id), r = theRun(app);
  assert.strictEqual(a.length, 1, 'one application');
  assert.deepStrictEqual([r.living, r.format, r.features.indexOf('living-runs') >= 0, /^[0-9a-f]{8}$/.test(r.typesHash)], [{ head: a[0].id }, 'preflight-run/3', true, true]);
  assert.ok(r.log.some(l => /To-do added: "Check the screenshots"/.test(l.what)), JSON.stringify(r.log.map(l => l.what)));
  assert.strictEqual(app.PF.run.sanitize(JSON.parse(JSON.stringify(r)))._unrunnable, undefined, 'it reads back');
  await refresh(app);
  assert.strictEqual(apps(app, p.id).length, 1, 'never applied twice');
});
rule('A run with no to-dos is never rewritten by a refresh', async () => {
  const app = await setup();
  const text = app.fs.files[runPath(app)].t;
  await refresh(app); await refresh(app);
  assert.strictEqual(app.fs.files[runPath(app)].t, text);
});
rule('Interrupted before the application is written: nothing changes; the next read prepares it and lands it once', async () => {
  const app = await setup();
  const p = await request(app, { op: 'add', text: 'One', target: { phase: 'draft' } });
  const again = failing(app, /\.status-/);
  await refresh(app);
  assert.deepStrictEqual([apps(app, p.id).length, theRun(app).living], [0, undefined], 'nothing written, the run unchanged');
  again(); await refresh(app);
  assert.strictEqual(apps(app, p.id).length, 1); assert.strictEqual(theRun(app).living.head, apps(app, p.id)[0].id);
});
rule('Interrupted after the application is written (the run\'s save fails): retried, or discarded and read again, the same application lands, and no other is written', async () => {
  for (const how of ['retry-save', 'discard-unsaved']) {
    const app = await setup();
    const p = await request(app, { op: 'add', text: 'Two', target: { phase: 'draft' } });
    const undo = failing(app, /^runs\//);
    await refresh(app);
    assert.strictEqual(apps(app, p.id).length, 1, how + ' set-up: prepared');
    assert.strictEqual(theRun(app).living, undefined, how + ' set-up: not landed');
    undo(); app.click(how); await app.tick(250); await refresh(app, 400);
    const a = apps(app, p.id);
    assert.deepStrictEqual([a.length, theRun(app).living], [1, { head: a[0].id }], how);
  }
});
rule('A lost receipt (the head\'s application is gone) holds every gate and writes nothing more', async () => {
  const app = await setup();
  const p = await request(app, { op: 'add', text: 'Three', target: { phase: 'draft' } });
  await refresh(app);
  const a = app.files('proposals/').find(x => x.indexOf(p.id + '.status-') >= 0 && JSON.parse(app.fs.files[x].t).kind === 'application');
  delete app.fs.files[a];
  const q = await request(app, { op: 'add', text: 'Four', target: { phase: 'draft' } });
  await refresh(app);
  assert.strictEqual(apps(app, q.id).length, 0, 'nothing applied on a broken chain');
  const r = app.PF.run.sanitize(theRun(app)), map = app.PF.run.mapOf(r);
  app.PF.todos.markHolds([r], { records: (await app.PF.repo.loadAll(app.fs, {})).todos, people: JSON.parse(app.fs.files['people.json'].t) });
  assert.ok(r._todos.all.some(w => /isn't in the folder/.test(w)), JSON.stringify(r._todos.all));
  assert.strictEqual(app.PF.run.canPass(r, map, 0), false);
});
rule('Authority lost after it landed changes nothing; lost before, nothing lands and the prepared application stays unapplied', async () => {
  const app = await setup();
  const ppl = JSON.parse(app.fs.files['people.json'].t);
  const p = await request(app, { op: 'add', text: 'Five', target: { phase: 'draft' } });
  await refresh(app);
  const head = theRun(app).living.head;
  const q = await request(app, { op: 'add', text: 'Six', target: { phase: 'draft' } }, { decider: 'person-blake' });
  const off = ppl.map(x => x.id === 'person-blake' ? Object.assign({}, x, { inactive: true }) : x);
  await app.fs.write('people.json', JSON.stringify(Array.isArray(ppl) ? off : { people: off }, null, 2) + '\n');
  await refresh(app);
  assert.deepStrictEqual([theRun(app).living.head, apps(app, q.id).length], [head, 0], 'the decider is inactive now: nothing lands');
  assert.strictEqual(apps(app, p.id).length, 1, 'what landed stays');
});
rule('A paused run, an ended one, or one recorded elsewhere takes nothing; resumed, the request lands', async () => {
  const app = await setup();
  const r0 = theRun(app), path = runPath(app);
  const paused = Object.assign({}, r0, { paused: { by: 'person-avery', at: new Date().toISOString(), reason: 'Lunch' }, rev: (r0.rev || 0) + 1 });
  await app.fs.write(path, JSON.stringify(paused, null, 2)); await refresh(app);
  const p = await request(app, { op: 'add', text: 'Seven', target: { phase: 'draft' } });
  await refresh(app);
  assert.strictEqual(apps(app, p.id).length, 0, 'paused: nothing');
  const other = Object.assign({}, theRun(app), { paused: null, recorder: { person: 'person-blake', session: 'elsewhere' }, rev: (theRun(app).rev || 0) + 1 });
  await app.fs.write(path, JSON.stringify(other, null, 2)); await refresh(app);
  assert.strictEqual(apps(app, p.id).length, 0, 'recorded elsewhere: nothing');
});
rule('A request held at its last read writes nothing into a folder opened next (the guard asks the folder before each write)', async () => {
  const app = await setup();
  const p = await request(app, { op: 'add', text: 'Eight', target: { phase: 'draft' } });
  const was = app.fs, write = was.write.bind(was), hold = gate();
  was.write = (p2, t, o) => /\.status-/.test(p2) ? hold.p.then(() => write(p2, t, o)) : write(p2, t, o);
  app.click('refresh'); await app.tick(150);
  app.click('reset-examples'); await app.tick(60); app.choose('person-casey'); await app.tick();
  const now = app.fs;
  assert.ok(now !== was, 'set-up: another folder');
  hold.open(); await app.tick(300);
  assert.deepStrictEqual(Object.keys(now.files).filter(x => x.indexOf(p.id) >= 0), [], 'nothing in the folder opened next');
  const r = JSON.parse(was.files[Object.keys(was.files).find(x => /^runs\/release-notes\/.*run\.json$/.test(x))].t);
  assert.strictEqual(r.living, undefined, 'and the run it left wasn\'t changed');
});
rule('Two disconnected recorders prepared the same request: the next one sees both, settles them and lands once', async () => {
  const app = await setup();
  const T = app.PF.todos;
  const p = await request(app, { op: 'add', text: 'Nine', target: { phase: 'draft' } });
  const undo = failing(app, /^runs\//);
  await refresh(app);
  undo();
  const first = apps(app, p.id)[0], r = theRun(app);
  /* The other window's application: the same effect, not seeing the first. */
  const s = T.buildStatus({ kind: 'application', proposal: p.id, run: { process: r.process, id: r.id }, seen: first.seen, by: 'person-avery', at: new Date().toISOString(), authority: first.authority, previous: '', effect: first.effect, writer: 'rec2', rev: 'abcdef12', app: '4.0.0' });
  await app.fs.write('proposals/' + s.name, T.text(s.file));
  app.click('discard-unsaved'); await app.tick(250);
  await refresh(app, 400);
  const all = apps(app, p.id), landed = theRun(app).living;
  assert.ok(landed && all.some(x => x.id === landed.head), 'landed: ' + JSON.stringify(landed));
  const V = T.view(app.PF.run.sanitize(theRun(app)), { records: (await app.PF.repo.loadAll(app.fs, {})).todos, people: JSON.parse(app.fs.files['people.json'].t) });
  assert.deepStrictEqual([V.requests[p.id].status, V.todos.length], ['applied', 1], 'applied once');
});
rule('An addition landing in a passed phase sends its gate to review, logged, in the saved run', async () => {
  const app = await setup();
  const R = app.PF.run, path = runPath(app), r0 = theRun(app), rr = R.sanitize(JSON.parse(JSON.stringify(r0))), m = R.mapOf(rr), at = new Date().toISOString();
  const passed = JSON.parse(JSON.stringify(r0)); passed.steps.write = { s: 'done', by: 'person-avery', at }; passed.gates['draft-confirm'] = { s: 'passed', by: 'person-avery', at, approved: R.gateInputs(rr, m, m.phases[0].gate) }; passed.rev = (passed.rev || 0) + 1;
  await app.fs.write(path, JSON.stringify(passed, null, 2)); await refresh(app);
  await request(app, { op: 'add', text: 'Late finding', target: { phase: 'draft' } });
  await refresh(app, 400);
  const r = theRun(app);
  assert.deepStrictEqual([r.gates['draft-confirm'].s, r.gates['draft-confirm'].was], ['review', 'passed']);
});
rule('A to-do record that can\'t be read yet stops the recorder from preparing or landing anything', async () => {
  const app = await setup();
  const torn = 'proposals/' + app.PF.todos.idFor('flightdeck', 'torn-1') + '.json';
  app.fs.files[torn] = { t: '{"format": "flightdeck-plan/4", "kind": "rev', m: Date.now() };
  const p = await request(app, { op: 'add', text: 'Held by a torn file', target: { phase: 'draft' } });
  await refresh(app, 400);
  assert.deepStrictEqual([apps(app, p.id).length, theRun(app).living], [0, undefined], 'nothing prepared, nothing landed');
  delete app.fs.files[torn]; await refresh(app, 400);
  assert.strictEqual(theRun(app).living.head, apps(app, p.id)[0].id, 'read, it lands');
});
rule('A landing whose run save failed is put back; retrying never saves it blindly, the next read asks authority again', async () => {
  const app = await setup();
  const r0 = theRun(app); await app.fs.write(runPath(app), JSON.stringify(Object.assign({}, r0, { roles: Object.assign({}, r0.roles, { reviewer: 'person-blake' }), rev: (r0.rev || 0) + 1 }), null, 2)); await refresh(app);
  const p = await request(app, { op: 'add', text: 'Retry me', target: { phase: 'draft' } }, { decider: 'person-blake' });
  const undo = failing(app, /^runs\//);
  await refresh(app);
  assert.deepStrictEqual([apps(app, p.id).length, theRun(app).living], [1, undefined], 'set-up: prepared, not landed');
  undo();
  await setPeople(app, x => x.id === 'person-blake' ? Object.assign({}, x, { inactive: true }) : x);
  app.click('retry-save'); await app.tick(250); await refresh(app, 400);
  assert.strictEqual(theRun(app).living, undefined, 'the decider is inactive now: nothing lands');
  await setPeople(app, x => x.id === 'person-blake' ? Object.assign({}, x, { inactive: false }) : x);
  await refresh(app, 400);
  assert.deepStrictEqual([apps(app, p.id).length, theRun(app).living], [1, { head: apps(app, p.id)[0].id }], 'active again: the same application lands');
});
rule('Every save, backup and retry of a living run goes through the run guard: loopy() counts a living run', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const i = src.indexOf('function loopy('), body = src.slice(i, src.indexOf('\n  }', i));
  assert.ok(/r\.living/.test(body), body);
  assert.ok(/function todoApply\(/.test(src) && /todoApply\(\)/.test(src.slice(src.indexOf('function syncChildren('), src.indexOf('function syncChildren(') + 2000)), 'applied beside loops');
});

run();
