// 2.0.1: two records that were counted for the wrong person or twice. A person's ID is compared exactly wherever it decides
// whose sign-off, correction or run something is, never cut to fit first; and a run.json counts only in its own folder,
// runs/<its process>/<its id>/, so a copy of a run in another run folder is named, never counted twice.
'use strict';
const assert = require('assert');
const { completeRun, load, example, exampleSetup, rule, run } = require('./harness');
const { boot } = require('./app-harness');
const { BytesFS, build: evidenceFolder } = require('./evidence-fixture');
const PF = load(), R = PF.run, S = PF.skills, C = PF.corrections, M = PF.map, repo = PF.repo;
const EX = exampleSetup(PF);
const NOW = '2026-10-17T21:00:00.000Z';
const people = JSON.parse(example('people.json'));
// Objects from the sandbox have their own prototypes, so compare plain JSON copies.
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const P80 = 'person-' + 'a'.repeat(73), P81 = P80 + 'b';
assert.strictEqual(P80.length, 80);

function folder(extraPeople) {
  const fs = new PF.fs.MemoryFS('test:' + Math.random(), null);
  fs.reset({ 'people.json': JSON.stringify(people.concat(extraPeople || [])) });
  return fs;
}
async function publish(fs, meta) {
  const md = meta ? M.withMeta(example('maps/drafts/release.md'), meta) : example('maps/drafts/release.md');
  const res = await repo.publish(fs, md, { people, ...EX, by: 'person-avery', changes: 'First version', existing: [], now: NOW });
  assert.ok(!res.blockers, String(res.blockers));
  return (await repo.loadAll(fs)).processes[0].index.latest;
}
async function cleanRun(fs, pub, id) {
  const r = completeRun(PF, R.create(pub, { title: 'Release ' + id, details: { commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'w1', now: NOW, id }), NOW);
  await repo.saveRun(fs, r, 'w1');
  return r;
}
const runFile = (fs, id) => fs.files['runs/release/' + id + '/run.json'].t;
const put = (fs, path, text) => { fs.files[path] = { t: text, m: Date.now() }; };
const sign = (pub, by, extra) => Object.assign({ kind: 'validation', process: pub.map.meta.process, version: pub.info.version, folder: pub.info.folder, by, at: NOW, note: '' }, extra || {});

/* ---------- Sign-offs: the owner's ID is compared exactly ---------- */

rule('Sign-off: someone whose ID shares an 80-character owner ID\'s first 80 characters isn\'t the owner', async () => {
  const fs = folder([{ id: P80, name: 'Long Owner' }, { id: P80 + 'x', name: 'Someone Else' }]), pub = await publish(fs, { owner: P80 });
  assert.strictEqual(pub.map.meta.owner, P80);
  put(fs, 'validations/release.v1.wx.json', JSON.stringify(sign(pub, P80 + 'x')));
  let d = await repo.loadAll(fs);
  assert.strictEqual(d.validations[0].by, P80 + 'x', 'read exactly as written');
  assert.strictEqual(S.signoffs(d.validations, pub).length, 0, 'not counted as the owner\'s');
  put(fs, 'validations/release.v1.wo.json', JSON.stringify(sign(pub, P80)));
  d = await repo.loadAll(fs);
  same(S.signoffs(d.validations, pub).map(v => v.by), [P80], 'the owner\'s own sign-off counts');
});

rule('Sign-off: an owner whose ID is over 80 characters signs off and it counts; the backup owner is compared exactly too', () => {
  const pub = { map: { meta: { process: 'release', owner: P81, backup: P80 } }, info: { folder: 'v1-abcd1234', version: 1 } };
  const read = raw => S.cleanValidation(raw).rec;
  assert.strictEqual(S.signoffs([read(sign(pub, P81))], pub).length, 1, 'the long owner\'s sign-off');
  assert.strictEqual(S.signoffs([read(sign(pub, P81 + 'c'))], pub).length, 0, 'not someone sharing its first 80');
  assert.strictEqual(S.signoffs([read(sign(pub, P80 + 'z', { as: 'backup' }))], pub).length, 0, 'not as the backup either');
  assert.strictEqual(S.signoffs([read(sign(pub, P80, { as: 'backup' }))], pub).length, 1, 'the backup\'s own');
});

rule('Sign-off: the process and version folder it names are compared exactly, never cut to 60 characters', () => {
  const P60 = 'p'.repeat(60), F60 = 'v1-' + 'f'.repeat(57);
  const pub = { map: { meta: { process: P60, owner: 'person-casey' } }, info: { folder: F60, version: 1 } };
  const read = raw => S.cleanValidation(raw).rec;
  assert.strictEqual(S.signoffs([read(sign(pub, 'person-casey'))], pub).length, 1);
  assert.strictEqual(S.signoffs([read(sign(pub, 'person-casey', { process: P60 + 'q' }))], pub).length, 0, 'another process');
  assert.strictEqual(S.signoffs([read(sign(pub, 'person-casey', { folder: F60 + 'g' }))], pub).length, 0, 'another folder');
});

/* ---------- Corrections: who wrote one is compared exactly ---------- */

function correctionRun(pub, id, by) {
  const r = R.create(pub, { title: 'Release ' + id, details: { commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'w1', now: NOW, id });
  const note = C.build({ id: 'c1', at: NOW, by, session: 'w2', map: R.mapOf(r), step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes', version: 1, folder: r.folder });
  return { r, note: Object.assign({ id: 'c1', at: NOW, by, session: 'w2', step: 'pods', text: 'New pods stay up for 20 minutes' }, note) };
}

rule('Corrections: a withdrawal counts only from the author\'s exact ID, never from one sharing its first 80 characters', async () => {
  const fs = folder(), pub = await publish(fs);
  const { r, note } = correctionRun(pub, 'run1', P80);
  await repo.saveRun(fs, r, 'w1');
  put(fs, 'runs/release/run1/notes-w2.jsonl', JSON.stringify(note) + '\n');
  const d = await repo.loadAll(fs), g = C.groups(C.collect(d.runs, 'release'))[0];
  assert.ok(g && g.members[0].by === P80, 'the author, as written');
  const raw = C.decision(g, P80, 'withdrawn', '', NOW);
  const forged = C.cleanDecision(Object.assign({}, raw, { by: P80 + 'x' }), 'release', 'g.wx.1.json');
  assert.strictEqual(forged.by, P80 + 'x', 'a decision\'s author is read exactly');
  assert.strictEqual(C.status([g], [forged])[0].status, 'open', 'someone else\'s withdrawal doesn\'t count');
  assert.strictEqual(C.status([g], [C.cleanDecision(raw, 'release', 'g.wa.1.json')])[0].status, 'withdrawn', 'the author\'s does');
});

rule('Corrections: a note whose author shares an author\'s first 80 characters never replaces that author\'s correction, and a long author\'s note keeps its ID', async () => {
  const fs = folder(), pub = await publish(fs);
  const { r, note } = correctionRun(pub, 'run1', P80);
  await repo.saveRun(fs, r, 'w1');
  const other = Object.assign({}, note, { id: 'c2', by: P80 + 'x', session: 'w3', replaces: 'c1', to: undefined });
  put(fs, 'runs/release/run1/notes-w2.jsonl', JSON.stringify(note) + '\n');
  put(fs, 'runs/release/run1/notes-w3.jsonl', JSON.stringify(other) + '\n');
  const d = await repo.loadAll(fs), mine = d.runs[0]._notes.map(n => [n.id, n.by]);
  same(mine, [['c1', P80], ['c2', P80 + 'x']], 'both authors as written');
  assert.ok(C.collect(d.runs, 'release').some(c => c.id === 'c1'), 'the author\'s correction is still there');
});

/* ---------- Runs: a person ID longer than Flightdeck keeps makes the run read-only, never cut ---------- */

rule('Runs: a run naming its recorder, or who ended it, by an ID over 80 characters is read-only, so it is never recovered or saved with the ID cut', async () => {
  const fs = folder(), pub = await publish(fs), r = await cleanRun(fs, pub, 'run1');
  const base = JSON.parse(runFile(fs, 'run1'));
  [['recorder', o => { o.recorder.person = P81; }], ['ended', o => { o.ended.by = P81; }]].forEach(([what, edit]) => {
    const o = JSON.parse(JSON.stringify(base)); edit(o);
    const s = R.sanitize(o);
    assert.ok(s._unrunnable && /longer than the 80 characters/.test(s._unrunnable), what + ': ' + s._unrunnable);
    assert.throws(() => R.adopt(R.sanitize(JSON.parse(JSON.stringify(base))), s, 'person-casey', NOW), /longer than the 80 characters/, what + ': a copy with it is never kept');
    const ok = R.sanitize(JSON.parse(JSON.stringify(base)));
    assert.ok(!ok._unrunnable, what + ': an ordinary run is not');
  });
  // However the file holds its answers, gates and roles (a list where a map belongs is still read entry by entry).
  const first = Object.keys(base.steps)[0], gate = Object.keys(base.gates)[0];
  [['an answer in a list', o => { o.steps = [Object.assign({}, o.steps[first], { by: P81 })]; }], ['a gate in a list', o => { o.gates = [Object.assign({}, o.gates[gate], { by: P81 })]; }],
    ['roles in a list', o => { o.roles = [P81]; }], ['an earlier answer', o => { o.steps[first].history = [{ s: 'done', by: P81, at: NOW }]; }]].forEach(([what, edit]) => {
    const o = JSON.parse(JSON.stringify(base)); edit(o);
    assert.ok(/longer than the 80 characters/.test(R.sanitize(o)._unrunnable || ''), what);
  });
  const o = JSON.parse(JSON.stringify(base)); o.recorder.person = P81; put(fs, 'runs/release/run1/run.json', JSON.stringify(o));
  const d = await repo.loadAll(fs), got = d.runs[0];
  assert.ok(got._unrunnable, 'read-only when read from the folder');
  await assert.rejects(repo.saveRun(fs, got, 'w1'));
  assert.strictEqual(JSON.parse(runFile(fs, 'run1')).recorder.person, P81, 'the file keeps the whole ID');
  assert.ok(r);
});

/* ---------- Runs: a run.json counts only in its own folder ---------- */

rule('Runs: a copy of a run in another run folder isn\'t read as a run, is named with where it belongs, and stays in the folder', async () => {
  const fs = folder(), pub = await publish(fs);
  await cleanRun(fs, pub, 'run1'); await cleanRun(fs, pub, 'run2');
  assert.strictEqual(S.readiness((await repo.loadAll(fs)).runs, pub, null).clean, 2, 'set-up: two clean runs');
  put(fs, 'runs/release/run9/run.json', runFile(fs, 'run1'));
  const d = await repo.loadAll(fs);
  same(d.runs.map(x => x.id).sort(), ['run1', 'run2'], 'run1 once');
  const r = S.readiness(d.runs, pub, null);
  assert.ok(r.clean === 2 && r.completed === 2 && !r.enough, 'two clean runs, not three: ' + JSON.stringify([r.clean, r.completed]));
  const u = (d.unreadable || []).filter(x => x.path === 'runs/release/run9/run.json');
  assert.ok(u.length === 1 && /belongs to release\/run1, not to the folder it's in/.test(u[0].why), JSON.stringify(d.unreadable));
  assert.ok(fs.files['runs/release/run9/run.json'], 'the copy is left as it is');
  const f = PF.health.check({ data: d, scan: null, me: 'person-casey' }, Date.parse(NOW)).issues.filter(x => x.id === 'unreadable-runs')[0];
  assert.ok(f && /run9\/run\.json belongs to release\/run1/.test(f.detail) && /move it to its own folder, or delete it/.test(f.detail) && !/backup/.test(f.detail), f && f.detail);
  const forApps = await repo.loadAll(fs, { readOnly: true, explain: true, deep: true });
  same(forApps.runs.map(x => x.id).sort(), ['run1', 'run2'], 'other apps read the same runs');
});

rule('Runs: a copy alone, with its own folder gone, is named and not counted until it\'s moved back', async () => {
  const fs = folder(), pub = await publish(fs);
  await cleanRun(fs, pub, 'run1');
  put(fs, 'runs/release/run9/run.json', runFile(fs, 'run1'));
  Object.keys(fs.files).filter(k => k.indexOf('runs/release/run1/') === 0).forEach(k => delete fs.files[k]);
  const d = await repo.loadAll(fs);
  same(d.runs.map(x => x.id), []);
  assert.ok((d.unreadable || []).some(x => x.path === 'runs/release/run9/run.json' && /belongs to release\/run1/.test(x.why)));
  assert.strictEqual(await repo.loadRun(fs, 'release', 'run9', null, true, false, []), null, 'opening it reads nothing either');
});

rule('Runs: a run whose process name is over 60 characters is named, never read under the cut name, so nothing is saved into another process\'s folder', async () => {
  const fs = folder(), pub = await publish(fs), P61 = 'q'.repeat(61);
  await cleanRun(fs, pub, 'run1');
  const o = JSON.parse(runFile(fs, 'run1')); o.process = P61;
  put(fs, 'runs/' + P61 + '/run1/run.json', JSON.stringify(o));
  for (const opts of [undefined, { readOnly: true, explain: true, deep: true }]) {
    const d = await repo.loadAll(fs, opts);
    assert.ok(!d.runs.some(x => x.process !== 'release'), JSON.stringify(d.runs.map(x => x.process + '/' + x.id)));
    assert.ok((d.unreadable || []).some(x => x.path === 'runs/' + P61 + '/run1/run.json'), JSON.stringify(d.unreadable));
  }
});

/* ---------- Evidence: a misplaced run.json is never read as its folder's run ---------- */

let evFixture = null;
async function evFiles() { evFixture = evFixture || await evidenceFolder(load()); return Object.assign({}, evFixture.files); }
async function evPack(files, scope) {
  return repo.exportEvidence(new BytesFS(files), scope, { sink: () => {}, now: () => Date.parse(NOW), tz: 'UTC' });
}

rule('Evidence: by date, a run folder holding another run\'s run.json is included and named, never dated by the other run', async () => {
  const files = await evFiles(), o = JSON.parse(files['runs/release/run1/run.json'].toString('utf8'));
  o.created = '2026-01-01T09:00:00.000Z';
  files['runs/release/run7/run.json'] = Buffer.from(JSON.stringify(o));
  const res = await evPack(files, { process: 'release', from: '2026-10-17', through: '2026-10-17', tz: 'UTC' });
  assert.ok(res.col.runs.some(x => x.key === 'release/run7'), JSON.stringify(res.col.runs.map(x => x.key)));
  assert.ok(res.col.unresolved.some(x => /^runs\/release\/run7: run\.json belongs to release\/run1/.test(x) || /^release\/run7: run\.json belongs to release\/run1/.test(x)), JSON.stringify(res.col.unresolved));
});

rule('Evidence: a packed folder holding another run\'s run.json says so and isn\'t read as that run; a copy adds nothing to where corrections stand', async () => {
  const files = await evFiles();
  Object.keys(files).filter(k => k.indexOf('runs/release/run1/') === 0).forEach(k => { files['runs/release/run8/' + k.slice('runs/release/run1/'.length)] = files[k]; });
  const res = await evPack(files, { run: 'release/run8' }), rc = res.col.runs[0];
  assert.strictEqual(rc.run, null, 'not read as release/run8');
  assert.ok(/belongs to release\/run1/.test(rc.limited) && res.col.unresolved.some(x => /^release\/run8: run\.json belongs to release\/run1/.test(x)), rc.limited + ' | ' + JSON.stringify(res.col.unresolved));
  assert.ok(Object.keys(rc.source.listing || {}).length || (rc.source.listing || []).length, 'its files are listed');
  const alone = await evPack(await evFiles(), { run: 'release/run1' }), withCopy = await evPack(files, { run: 'release/run1' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(withCopy.col.runs[0].corrections)), JSON.parse(JSON.stringify(alone.col.runs[0].corrections)), 'the same corrections and standing');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(withCopy.col.runs[0].claims)), JSON.parse(JSON.stringify(alone.col.runs[0].claims)), 'the same claims');
});

rule('Evidence: a run.json in another run\'s folder that names no process is never read as that folder\'s run either', async () => {
  const files = await evFiles(), o = JSON.parse(files['runs/release/run1/run.json'].toString('utf8'));
  delete o.process;
  Object.keys(files).filter(k => k.indexOf('runs/release/run1/') === 0).forEach(k => { files['runs/release/run9/' + k.slice('runs/release/run1/'.length)] = files[k]; });
  files['runs/release/run9/run.json'] = Buffer.from(JSON.stringify(o));
  const res = await evPack(files, { run: 'release/run9' }), rc = res.col.runs[0];
  assert.strictEqual(rc.run, null);
  assert.ok(/belongs to \(no process\)\/run1/.test(rc.limited) && !(rc.corrections || []).length, rc.limited);
});

/* ---------- The app: only runs read now count toward a sign-off ---------- */

function checkInRuns(app) { return app.files('runs/check-in/').filter(p => /\/run\.json$/.test(p)); }
async function twoCleanCheckIns() {
  const app = boot(); await app.tick(80);
  app.files('validations/').forEach(p => delete app.fs.files[p]);
  // Two clean check-ins; the rest ended early, so they never count.
  let kept = 0;
  checkInRuns(app).forEach(p => {
    const o = JSON.parse(app.fs.files[p].t);
    if (kept < 2 && !/login fix/.test(o.title)) { kept++; return; }
    o.ended.outcome = 'Stopped early'; o.state = 'stopped';
    app.fs.files[p] = { t: JSON.stringify(o), m: Date.now() };
  });
  app.choose('person-avery'); await app.tick();
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'check-in'); await app.tick();
  return app;
}
const cleanCheckIns = app => checkInRuns(app).filter(p => JSON.parse(app.fs.files[p].t).ended.outcome === 'Completed');
const readyText = html => { const m = /Ready for a skill\?<\/h[23]>([\s\S]{0,400})/.exec(html); return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : ''; };

rule('App: a copy of a check-in in another run folder doesn\'t count toward signing off, and is named', async () => {
  const app = await twoCleanCheckIns();
  const before = readyText(app.html());
  assert.ok(/2 of 3 clean runs/.test(before), 'set-up: ' + before);
  const [one] = cleanCheckIns(app), id = one.split('/')[2];
  app.fs.files['runs/check-in/copy0001/run.json'] = { t: app.fs.files[one].t, m: Date.now() };
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'check-in'); await app.tick();
  const after = readyText(app.html());
  assert.ok(/2 of 3 clean runs/.test(after) && !/data-kind="signoff"/.test(app.html()), 'still two: ' + after);
  assert.ok(app.fs.files['runs/check-in/copy0001/run.json'], 'the copy is left as it is');
  assert.ok(id);
});

rule('App: a counted run whose file is replaced by another run\'s stops counting at the next read, though its last copy stays on screen', async () => {
  const app = await twoCleanCheckIns();
  const runs = cleanCheckIns(app);
  // A third clean check-in, so the version is ready to sign off.
  const third = JSON.parse(app.fs.files[runs[0]].t); third.id = 'third001';
  app.fs.files['runs/check-in/third001/run.json'] = { t: JSON.stringify(third), m: Date.now() };
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/data-kind="signoff"/.test(app.html()), 'set-up: ready to sign off: ' + readyText(app.html()));
  app.click('nav', 'home'); await app.tick();
  assert.ok(/is ready for a skill/.test(app.html()), 'set-up: Home says so');
  app.fs.files['runs/check-in/third001/run.json'] = { t: app.fs.files[runs[1]].t, m: Date.now() + 1 };
  app.click('refresh'); await app.tick(120);
  assert.ok(!/is ready for a skill/.test(app.html()), 'Home no longer says it\'s ready');
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/2 of 3 clean runs/.test(readyText(app.html())) && !/data-kind="signoff"/.test(app.html()), readyText(app.html()));
});

for (const how of ['replaced by another run\'s', 'gone']) rule('App: a run with a change that couldn\'t be saved doesn\'t count, nor once its file is ' + how + ', though it stays on screen', async () => {
  const app = await twoCleanCheckIns();
  const runs = cleanCheckIns(app), third = JSON.parse(app.fs.files[runs[0]].t), path = 'runs/check-in/third001/run.json';
  // A third check-in, every step done, waiting for someone to pick up recording; Avery does, in this window.
  third.id = 'third001'; third.title = 'Third check-in'; delete third.ended; third.state = 'running'; third.recorder = { person: 'person-avery', session: null };
  app.fs.files[path] = { t: JSON.stringify(third), m: Date.now() };
  app.click('refresh'); await app.tick(120);
  app.click('open-run', 'check-in/third001'); await app.tick(40);
  app.click('pickup'); await app.tick(40);
  assert.strictEqual(JSON.parse(app.fs.files[path].t).recorder.person, 'person-avery', 'set-up: Avery records it here');
  const orig = app.PF.repo.saveRun;
  app.PF.repo.saveRun = function () { return Promise.reject(new Error('offline')); };
  app.click('finish'); await app.tick();
  app.click('end', 'Completed'); await app.tick(60);
  assert.ok(/isn't saved/.test(app.html()), 'set-up: ending it isn\'t saved');
  // A change that couldn't be saved isn't what the folder holds, so it doesn't count, before or after the file changes.
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/2 of 3 clean runs/.test(readyText(app.html())) && !/data-kind="signoff"/.test(app.html()), 'unsaved, not counted: ' + readyText(app.html()));
  app.click('pick', 'check-in', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'check-in'); await app.tick(80);
  assert.deepStrictEqual(app.files('validations/'), [], 'no sign-off written');
  if (/gone/.test(how)) app.files('runs/check-in/third001/').forEach(k => delete app.fs.files[k]);
  else app.fs.files[path] = { t: app.fs.files[runs[1]].t, m: Date.now() + 1 };
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/2 of 3 clean runs/.test(readyText(app.html())), readyText(app.html()));
  // Routine refreshes, from memory where they can, never count it again while its file still isn't it.
  for (let i = 0; i < 2; i++) { app.focus(); await app.tick(120); }
  app.PF.repo.saveRun = orig;
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/2 of 3 clean runs/.test(readyText(app.html())), 'after routine refreshes: ' + readyText(app.html()));
  app.click('open-run', 'check-in/third001'); await app.tick(40);
  assert.ok(/Third check-in/.test(app.html()) && /isn't saved/.test(app.html()), 'its unsaved work is still on screen');
});

async function threeCleanCheckIns() {
  const app = await twoCleanCheckIns();
  const runs = cleanCheckIns(app), third = JSON.parse(app.fs.files[runs[0]].t); third.id = 'third001'; third.title = 'Third check-in';
  app.fs.files['runs/check-in/third001/run.json'] = { t: JSON.stringify(third), m: Date.now() };
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/data-kind="signoff"/.test(app.html()), 'set-up: ready to sign off: ' + readyText(app.html()));
  return app;
}

rule('App: while the runs folder can\'t be read, no run counts toward a sign-off and nothing is signed off', async () => {
  const app = await threeCleanCheckIns();
  const list = app.fs.list;
  app.fs.list = function (p) { return p === 'runs' ? Promise.reject(new Error('offline')) : list.apply(this, arguments); };
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(!/data-kind="signoff"/.test(app.html()) && /0 of 3 clean runs/.test(readyText(app.html())), readyText(app.html()));
  app.click('pick', 'check-in', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'check-in'); await app.tick(80);
  assert.deepStrictEqual(app.files('validations/'), [], 'no sign-off written');
  app.fs.list = list;
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/data-kind="signoff"/.test(app.html()), 'counted again once it reads');
});

rule('App: while the whole team folder can\'t be read, no run counts toward a sign-off and nothing is signed off', async () => {
  const app = await threeCleanCheckIns();
  const list = app.fs.list;
  app.fs.list = function (p) { return !p ? Promise.reject(new Error('offline')) : list.apply(this, arguments); };
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(!/data-kind="signoff"/.test(app.html()), readyText(app.html()));
  app.click('pick', 'check-in', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'check-in'); await app.tick(80);
  assert.deepStrictEqual(app.files('validations/'), [], 'no sign-off written');
  app.fs.list = list;
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/data-kind="signoff"/.test(app.html()), 'counted again once it reads');
});

rule('App: a run restored after its file went missing counts again at once', async () => {
  const app = await threeCleanCheckIns();
  // Whoever recorded it restores it.
  app.choose(JSON.parse(app.fs.files['runs/check-in/third001/run.json'].t).recorder.person); await app.tick();
  app.click('open-run', 'check-in/third001'); await app.tick(40);
  app.files('runs/check-in/third001/').forEach(k => delete app.fs.files[k]);
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/2 of 3 clean runs/.test(readyText(app.html())), 'set-up: not counted while gone: ' + readyText(app.html()));
  app.click('open-run', 'check-in/third001'); await app.tick(40);
  app.click('restore-missing'); await app.tick(80);
  assert.ok(app.fs.files['runs/check-in/third001/run.json'], 'set-up: restored');
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/3 clean runs/.test(readyText(app.html())) && !/of 3 clean runs/.test(readyText(app.html())), readyText(app.html()));
});

rule('App: finishing a run whose file was replaced by another run\'s keeps your version aside, and it doesn\'t count toward a sign-off', async () => {
  const app = await twoCleanCheckIns();
  const runs = cleanCheckIns(app), third = JSON.parse(app.fs.files[runs[0]].t), path = 'runs/check-in/third001/run.json';
  third.id = 'third001'; third.title = 'Third check-in'; delete third.ended; third.state = 'running'; third.recorder = { person: 'person-avery', session: null };
  app.fs.files[path] = { t: JSON.stringify(third), m: Date.now() };
  app.click('refresh'); await app.tick(120);
  app.click('open-run', 'check-in/third001'); await app.tick(40);
  app.click('pickup'); await app.tick(40);
  assert.strictEqual(JSON.parse(app.fs.files[path].t).recorder.person, 'person-avery', 'set-up: Avery records it here');
  const other = app.fs.files[runs[1]].t;
  app.fs.files[path] = { t: other, m: Date.now() + 1 };
  app.click('finish'); await app.tick();
  app.click('end', 'Completed'); await app.tick(80);
  assert.strictEqual(app.fs.files[path].t, other, 'the file there is never written over');
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(/2 of 3 clean runs/.test(readyText(app.html())) && !/data-kind="signoff"/.test(app.html()), readyText(app.html()));
  app.click('pick', 'check-in', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'check-in'); await app.tick(80);
  assert.deepStrictEqual(app.files('validations/'), [], 'no sign-off written');
});

run();
