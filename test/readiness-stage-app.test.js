// Readiness and sign-offs from test runs in the app (2.1 slice 6): a stage's line under All versions says how many clean test
// runs it has once it has any, and offers its owner Sign off staged vN once there are enough; the sign-off is a
// flightdeck-validation/2 file. Once the stage is made the default, Ready for a skill counts them for that version, labeled.
'use strict';
const assert = require('assert');
const { rule, run, completeRun } = require('./harness');
const { boot } = require('./app-harness');

const stageFiles = (app) => app.files('staged/release/').filter(f => /^staged\/release\/stage-[a-z0-9]{8}\/publication\.json$/.test(f));
const ROLES = { 'release-lead': 'person-avery', qa: 'person-blake', backend: 'person-casey' };

async function staged(who) {
  const app = boot(); await app.tick(60);
  app.choose(who || 'person-casey'); await app.tick();
  const path = 'maps/drafts/release.md', md = app.fs.files[path].t;
  /* Without its linked-run step: a test run starts no linked runs, so that step could never be checked in one. */
  const plain = md.replace(/- \[ \] \{run\.process\}[^\n]*\n(  [^\n]*\n)*/, '');
  assert.ok(plain !== md, 'set-up: the linked-run step taken out');
  await app.fs.write(path, plain.replace(/\n(## [^\n]*\n)/, '\n$1- [ ] {confirm} Tell the on-call channel {#tell-oncall}\n'));
  app.click('refresh'); await app.tick(80);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  app.set('change-note', 'Tell on-call first'); app.click('stage-draft', 'release'); await app.tick(200);
  const sf = stageFiles(app);
  assert.strictEqual(sf.length, 1, 'set-up: staged');
  return { app, folder: JSON.parse(app.fs.files[sf[0]].t).folder };
}
/* n finished, clean test runs on the stage, written as this copy writes them. */
async function tested(app, folder, n) {
  const PF = app.PF, st = await PF.repo.readStage(app.fs, 'release', folder);
  for (let i = 1; i <= n; i++) {
    const r = completeRun(PF, PF.run.create(st, { test: true, title: 'Try ' + i, id: 'run-try' + i, details: { ticket: 'T', commit: 'c', environment: 'p', tag: 'v1' }, roles: ROLES, by: 'person-avery', session: 'w', now: '2026-10-22T09:00:00.000Z', app: '2.1.0' }), '2026-10-22T09:00:00.000Z');
    await PF.repo.saveRun(app.fs, r, 'w');
  }
  app.click('refresh'); await app.tick(120);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
}
const line = (app, folder) => { const h = app.html(), i = h.indexOf('data-id="' + folder + '"'); return i < 0 ? '' : h.slice(h.lastIndexOf('<li', i), h.indexOf('</li>', i)); };

rule('A stage with no test runs says nothing new; with some, its line says how many are clean', async () => {
  const { app, folder } = await staged();
  assert.ok(!/clean test run/.test(app.html()), 'no test runs: no new words');
  await tested(app, folder, 2);
  assert.ok(/2 of 3 clean test runs/.test(line(app, folder)), line(app, folder));
  assert.ok(!/data-act="signoff-stage"/.test(app.html()), 'not enough yet: no sign-off');
});

rule('With enough clean test runs, the owner signs off the staged version: a flightdeck-validation/2 file, then said on its line', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  assert.ok(new RegExp('data-act="signoff-stage" data-id="' + folder + '"[^>]*>Sign off staged v3<').test(app.html()), line(app, folder));
  const before = app.files('validations/').length;
  app.click('signoff-stage', folder); await app.tick(200);
  const files = app.files('validations/').filter(f => f.indexOf('validations/release.' + folder + '.') === 0);
  assert.strictEqual(app.files('validations/').length, before + 1);
  assert.strictEqual(files.length, 1, 'named for the process, the stage and this window');
  const rec = JSON.parse(app.fs.files[files[0]].t);
  assert.ok(rec.format === 'flightdeck-validation/2' && rec.stage.folder === folder && rec.stage.proposed === 3 && rec.by === 'person-casey' && rec.evidence.clean === 3 && rec.evidence.runs.length === 3, JSON.stringify(rec));
  assert.ok(/Signed off by /.test(line(app, folder)) && !/data-act="signoff-stage"/.test(app.html()), line(app, folder));
});

rule('Someone other than the owner sees the count but no sign-off, and nothing is written for them', async () => {
  const { app, folder } = await staged('person-blake');
  await tested(app, folder, 3);
  assert.ok(/3 of 3 clean test runs/.test(line(app, folder)) && !/data-act="signoff-stage"/.test(app.html()), line(app, folder));
  const before = JSON.stringify(app.files(''));
  app.click('signoff-stage', folder); await app.tick(100);
  assert.strictEqual(JSON.stringify(app.files('')), before, 'nothing written');
});

rule('Made the default, the version counts its stage\'s test runs and sign-off for a skill, and says they were on the stage', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  app.click('signoff-stage', folder); await app.tick(200);
  app.click('promote-stage', folder); await app.tick(300);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(60);
  const html = app.html();
  assert.ok(/Ready for a skill\?/.test(html), 'the panel is there');
  assert.ok(/<b>Yes\.<\/b> v3 was signed off by [^<]* while it was staged/.test(html), (html.match(/Ready for a skill\?[\s\S]{0,400}/) || [''])[0]);
});

rule('A version made the default without its stage\'s exact bytes counts none of them', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  app.click('signoff-stage', folder); await app.tick(200);
  app.click('promote-stage', folder); await app.tick(300);
  const mp = app.files('publications/release/').filter(f => /\/v3-[^/]+\/map\.md$/.test(f))[0];
  await app.fs.write(mp, '﻿' + app.fs.files[mp].t);
  app.click('refresh'); await app.tick(160);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(60);
  const html = app.html();
  assert.ok(!/signed off by [^<]* while it was staged/.test(html) && !/test run/i.test((html.match(/Ready for a skill\?[\s\S]{0,400}/) || [''])[0]), (html.match(/Ready for a skill\?[\s\S]{0,400}/) || [''])[0]);
});

rule('A stage whose only test run is still going says 0 of 3 clean, and offers no sign-off', async () => {
  const { app, folder } = await staged('person-casey');
  const PF = app.PF, st = await PF.repo.readStage(app.fs, 'release', folder);
  const r = PF.run.create(st, { test: true, title: 'Going', id: 'run-going', details: { ticket: 'T', commit: 'c', environment: 'p', tag: 'v1' }, roles: ROLES, by: 'person-avery', session: 'w', now: '2026-10-22T09:00:00.000Z', app: '2.1.0' });
  await PF.repo.saveRun(app.fs, r, 'w');
  app.click('refresh'); await app.tick(120);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(/0 of 3 clean test runs/.test(line(app, folder)), line(app, folder));
  assert.ok(!/data-act="signoff-stage"/.test(app.html()));
});

rule('A stage retired in another window after the page was drawn is not signed off', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  assert.ok(/data-act="signoff-stage"/.test(app.html()), 'set-up: offered');
  await app.PF.repo.decideStage(app.fs, 'release', folder, 'retired', { by: 'person-blake', now: '2026-10-22T10:00:00.000Z', window: 'w-blake', reason: 'Not this one', app: '2.1.0' });
  const before = app.files('validations/').length;
  app.click('signoff-stage', folder); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written');
  assert.ok(/save the sign-off/.test(app.html()), (app.html().match(/class="[^"]*(bad|warn)[^"]*"[^>]*>[^<]*/g) || []).join(' | '));
});

rule('A test run that changed in the folder after the page was drawn is judged as it is now: nothing signed off on stale counts', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  assert.ok(/data-act="signoff-stage"/.test(app.html()), 'set-up: offered');
  app.files('runs/release/run-try3/').forEach(f => { delete app.fs.files[f]; });
  const before = app.files('validations/').length;
  app.click('signoff-stage', folder); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written');
  assert.ok(/clean test runs; it has 2/.test(app.html()), 'it says why');
});

rule('Copies of one test run in other run folders never make enough for a sign-off', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 1);
  for (const id of ['run-copy2', 'run-copy3']) app.files('runs/release/run-try1/').forEach(f => { app.fs.files[f.replace('/run-try1/', '/' + id + '/')] = Object.assign({}, app.fs.files[f]); });
  app.click('refresh'); await app.tick(120);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(!/data-act="signoff-stage"/.test(app.html()), line(app, folder));
  const before = app.files('validations/').length;
  app.click('signoff-stage', folder); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written');
});

async function promotedTested(app, folder) {
  await tested(app, folder, 3);
  app.click('promote-stage', folder); await app.tick(300);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(60);
}
const panel = (app) => (app.html().match(/Ready for a skill\?[\s\S]{0,600}/) || [''])[0];

rule('Versions kept from before while publications/ can\'t be read count none of their stage\'s test runs', async () => {
  const { app, folder } = await staged('person-casey');
  await promotedTested(app, folder);
  assert.ok(/data-act="pick" data-kind="signoff" data-id="release"/.test(app.html()), 'set-up: v3 can be signed off on its test runs: ' + panel(app));
  const orig = app.fs.list.bind(app.fs);
  app.fs.list = (x) => /^publications/.test(x) ? Promise.reject(new Error('offline')) : orig(x);
  app.click('refresh'); await app.tick(160);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(60);
  assert.ok(!/data-act="pick" data-kind="signoff" data-id="release"/.test(app.html()), panel(app));
});

rule('Signing off the default version on test runs reads them again first: one changed since, nothing is written', async () => {
  const { app, folder } = await staged('person-casey');
  await promotedTested(app, folder);
  assert.ok(/data-act="pick" data-kind="signoff" data-id="release"/.test(app.html()), 'set-up: offered');
  app.files('runs/release/run-try3/').forEach(f => { delete app.fs.files[f]; });
  const before = app.files('validations/').length;
  app.click('pick', 'release', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'release'); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written');
  assert.ok(/it has 2 now/.test(app.html()), 'it says why');
});

rule('With its test runs unchanged, the default version is signed off on them', async () => {
  const { app, folder } = await staged('person-casey');
  await promotedTested(app, folder);
  const before = app.files('validations/').length;
  app.click('pick', 'release', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'release'); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before + 1, panel(app));
});

rule('A refresh landing while the test runs are read again never brings back the count it replaced', async () => {
  const { app, folder } = await staged('person-casey');
  await promotedTested(app, folder);
  const R = app.PF.repo, orig = R.loadRun, pending = [];
  R.loadRun = (...a) => new Promise(res => { pending.push(() => orig(...a).then(res)); });
  const before = app.files('validations/').length;
  app.click('pick', 'release', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'release'); await app.tick(40);
  assert.ok(pending.length >= 3, 'set-up: the reread is waiting (' + pending.length + ')');
  const rp = 'runs/release/run-try3/run.json', o = JSON.parse(app.fs.files[rp].t);
  o.ended = Object.assign({}, o.ended, { outcome: 'Stopped early' });
  await app.fs.write(rp, JSON.stringify(o, null, 2) + '\n');
  app.click('refresh'); await app.tick(200);
  R.loadRun = orig; pending.splice(0).forEach(go => go()); await app.tick(200);
  const recs = app.files('validations/').map(f => JSON.parse(app.fs.files[f].t)).filter(v => v.process === 'release' && v.evidence && v.evidence.clean >= 3);
  assert.strictEqual(recs.length, 0, 'never signed on 3 clean: ' + JSON.stringify(recs) + ' ' + JSON.stringify(JSON.parse(app.fs.files[rp].t).ended));
});

/* ---------- With 2.0.1's rule: only runs read cleanly now count ---------- */

rule('A stage\'s test run whose file was replaced by another run\'s stops counting on its line, though its last copy stays on screen', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  assert.ok(/data-act="signoff-stage"/.test(app.html()), 'set-up: offered');
  app.fs.files['runs/release/run-try3/run.json'] = { t: app.fs.files['runs/release/run-try1/run.json'].t, m: Date.now() + 1 };
  app.click('refresh'); await app.tick(160);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(/2 of 3 clean test runs/.test(line(app, folder)) && !/data-act="signoff-stage"/.test(app.html()), line(app, folder));
});

rule('Signing off the default version on test runs never counts a run on screen whose latest read wasn\'t it', async () => {
  const { app, folder } = await staged('person-casey');
  await promotedTested(app, folder);
  const PF = app.PF, d = await PF.repo.loadAll(app.fs), pub = d.processes.filter(p => p.process === 'release')[0].index.latest;
  assert.strictEqual(pub.info.version, 3, 'set-up: v3 is the default');
  const r = completeRun(PF, PF.run.create(pub, { title: 'Real one', id: 'run-real1', details: { ticket: 'T', commit: 'c', environment: 'p', tag: 'v1' }, roles: ROLES, by: 'person-avery', session: 'w', now: '2026-10-22T09:00:00.000Z', app: '2.1.0' }), '2026-10-22T09:00:00.000Z');
  await PF.repo.saveRun(app.fs, r, 'w');
  app.click('refresh'); await app.tick(160);
  // Its file is then replaced by another run's: it stays on screen, but no longer counts.
  app.fs.files['runs/release/run-real1/run.json'] = { t: app.fs.files['runs/release/run-try1/run.json'].t, m: Date.now() + 1 };
  app.click('refresh'); await app.tick(160);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(60);
  assert.ok(/data-act="pick" data-kind="signoff" data-id="release"/.test(app.html()), 'set-up: offered on its 3 test runs: ' + panel(app));
  // One test run is gone by the time it's read again: 2 are left, and the run on screen mustn't make up the third.
  app.files('runs/release/run-try3/').forEach(f => { delete app.fs.files[f]; });
  const before = app.files('validations/').length;
  app.click('pick', 'release', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'release'); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written: ' + JSON.stringify(app.files('validations/').map(f => JSON.parse(app.fs.files[f].t).evidence || null)));
  assert.ok(/it has 2 now/.test(app.html()), 'it says why');
});

/* Holds every read of a test run's run.json until released. */
function holdTestRuns(app) {
  const read = app.fs.read, pending = [];
  app.fs.read = function (p) { const a = arguments, self = this; return /^runs\/release\/run-try\d\/run\.json$/.test(p) ? new Promise((res, rej) => pending.push(() => read.apply(self, a).then(res, rej))) : read.apply(self, a); };
  return { pending, release() { app.fs.read = read; pending.splice(0).forEach(go => go()); } };
}
function runsUnlisted(app) { const list = app.fs.list; app.fs.list = function (p) { return p === 'runs' ? Promise.reject(new Error('offline')) : list.apply(this, arguments); }; return () => { app.fs.list = list; }; }

rule('A refresh that can\'t list the runs folder while a version sign-off reads its test runs again signs nothing', async () => {
  const { app, folder } = await staged('person-casey');
  await promotedTested(app, folder);
  const before = app.files('validations/').length, h = holdTestRuns(app);
  app.click('pick', 'release', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'release'); await app.tick(40);
  assert.ok(h.pending.length >= 3, 'set-up: the reread is waiting (' + h.pending.length + ')');
  runsUnlisted(app);
  app.click('refresh'); await app.tick(200);
  h.release(); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written');
});

rule('A refresh that can\'t list the runs folder while a stage sign-off reads its test runs again signs nothing', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  const before = app.files('validations/').length, h = holdTestRuns(app);
  app.click('signoff-stage', folder); await app.tick(40);
  assert.ok(h.pending.length >= 3, 'set-up: the reread is waiting (' + h.pending.length + ')');
  runsUnlisted(app);
  app.click('refresh'); await app.tick(200);
  h.release(); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written');
});

rule('A test run a version sign-off found gone stops counting on the page at once', async () => {
  const { app, folder } = await staged('person-casey');
  await promotedTested(app, folder);
  app.files('runs/release/run-try3/').forEach(f => { delete app.fs.files[f]; });
  app.click('pick', 'release', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'release'); await app.tick(200);
  assert.ok(/it has 2 now/.test(app.html()), 'set-up: refused');
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(60);
  assert.ok(!/data-act="pick" data-kind="signoff" data-id="release"/.test(app.html()), panel(app));
});

rule('A test run a stage sign-off found gone stops counting on its line at once', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  app.files('runs/release/run-try3/').forEach(f => { delete app.fs.files[f]; });
  app.click('signoff-stage', folder); await app.tick(200);
  assert.ok(/clean test runs; it has 2/.test(app.html()), 'set-up: refused');
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(/2 of 3 clean test runs/.test(line(app, folder)) && !/data-act="signoff-stage"/.test(app.html()), line(app, folder));
});

/* ---------- A stage sign-off's own reread is said at once, even when a refresh began while it waited (2.1.0) ---------- */

rule('A stage sign-off that waited for the folder, with a refresh landing meanwhile, still stops counting a test run it found gone', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  const list = app.fs.list; let held = null, first = true;
  app.fs.list = function (p) { const a = arguments, self = this; if (first && p === 'publications/release') { first = false; return new Promise((res, rej) => { held = () => list.apply(self, a).then(res, rej); }); } return list.apply(this, arguments); };
  app.click('signoff-stage', folder); await app.tick(40);
  assert.ok(held, 'set-up: the sign-off is waiting on its first read');
  app.click('refresh'); await app.tick(200);
  app.files('runs/release/run-try3/').forEach(f => { delete app.fs.files[f]; });
  const before = app.files('validations/').length;
  held(); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written');
  assert.ok(/clean test runs; it has 2/.test(app.html()), 'it says why');
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(/2 of 3 clean test runs/.test(line(app, folder)) && !/data-act="signoff-stage"/.test(app.html()), line(app, folder));
});

/* ---------- A sign-off file that can't be read: can't tell, never "not signed off" (2.1.0) ---------- */

rule('A stage sign-off file that can\'t be read: its line says it can\'t tell and offers no sign-off, and none is written', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  const torn = 'validations/release.' + folder + '.w-other.json';
  app.fs.files[torn] = { t: '{"format": "flightdeck-validation/2", "app": "2.1', m: Date.now() };
  app.click('refresh'); await app.tick(160);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(/Can(&#39;|')t tell whether it was signed off/.test(line(app, folder)) && line(app, folder).indexOf(torn) >= 0, line(app, folder));
  assert.ok(!/data-act="signoff-stage"/.test(app.html()), 'no sign-off offered');
  const before = app.files('validations/').length;
  app.click('signoff-stage', folder); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written');
  // Its own reread inside the lock refuses too, whatever the page drew.
  const st = await app.PF.repo.readStage(app.fs, 'release', folder);
  await assert.rejects(() => app.PF.repo.signOffStage(app.fs, 'release', folder, { window: 'w-x', by: 'person-casey', runIds: ['run-try1', 'run-try2', 'run-try3'],
    check: () => ({ as: null, evidence: { completed: 3, clean: 3, runs: [] } }) }), new RegExp(torn.replace(/\./g, '\\.')));
  assert.ok(st.ok, 'set-up: the stage reads');
  assert.strictEqual(app.files('validations/').length, before, 'still nothing written');
});

rule('A stage sign-off made with a newer Flightdeck: its line says so and to update, no sign-off is offered, and its own reread refuses', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  const newer = 'validations/release.' + folder + '.w-other.json';
  app.fs.files[newer] = { t: JSON.stringify({ format: 'flightdeck-validation/3', app: '2.2.0', process: 'release', folder }), m: Date.now() };
  app.click('refresh'); await app.tick(160);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(/Signed off with a newer Flightdeck: update to see it/.test(line(app, folder)), line(app, folder));
  assert.ok(!/data-act="signoff-stage"/.test(app.html()), 'no sign-off offered');
  const before = app.files('validations/').length;
  await assert.rejects(() => app.PF.repo.signOffStage(app.fs, 'release', folder, { window: 'w-x', by: 'person-casey', runIds: ['run-try1', 'run-try2', 'run-try3'],
    check: () => ({ as: null, evidence: { completed: 3, clean: 3, runs: [] } }) }), /newer Flightdeck/);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written');
});

rule('JSON named like a stage sign-off that isn\'t one is ignored: the stage can still be signed off', async () => {
  const { app, folder } = await staged('person-casey');
  await tested(app, folder, 3);
  app.fs.files['validations/release.' + folder + '.w-other.json'] = { t: JSON.stringify({ hello: 'world' }), m: Date.now() };
  app.click('refresh'); await app.tick(160);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(/data-act="signoff-stage"/.test(app.html()), 'offered: ' + line(app, folder));
});

rule('A version sign-off file that can\'t be read: Ready for a skill says it can\'t tell and names it, and nothing is signed off', async () => {
  const { app, folder } = await staged('person-casey');
  await promotedTested(app, folder);
  assert.ok(/data-act="pick" data-kind="signoff" data-id="release"/.test(app.html()), 'set-up: offered');
  const torn = app.files('publications/release/').some(f => /\/v3-/.test(f)) ? 'validations/release.v3.w-other.json' : '';
  assert.ok(torn, 'set-up: v3');
  app.fs.files[torn] = { t: '{"kind": "validation", "proc', m: Date.now() };
  app.click('refresh'); await app.tick(160);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(60);
  assert.ok(/Can(&#39;|')t tell yet/.test(panel(app)) && panel(app).indexOf(torn) >= 0, panel(app));
  assert.ok(!/data-act="pick" data-kind="signoff" data-id="release"/.test(app.html()), 'no sign-off offered');
  const before = app.files('validations/').length;
  app.click('signoff', 'release'); await app.tick(200);
  assert.strictEqual(app.files('validations/').length, before, 'nothing written');
  // Once it arrives whole, it's read: a sign-off by someone else counts for nothing, and the owner is offered it again.
  app.fs.files[torn] = { t: JSON.stringify({ kind: 'validation', process: 'release', version: 3, folder: app.files('publications/release/').filter(f => /\/v3-[^/]+\/publication\.json$/.test(f))[0].split('/')[2], by: 'person-blake', at: '2026-10-22T10:00:00.000Z', note: '' }), m: Date.now() + 1 };
  app.click('refresh'); await app.tick(160);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(60);
  assert.ok(/data-act="pick" data-kind="signoff" data-id="release"/.test(app.html()), panel(app));
});

rule('A sign-off read before keeps counting while its file can\'t be read, and Folder health names the file', async () => {
  const { app, folder } = await staged('person-casey');
  await promotedTested(app, folder);
  app.click('pick', 'release', { kind: 'signoff' }); await app.tick();
  app.click('signoff', 'release'); await app.tick(200);
  const mine = app.files('validations/').filter(f => /^validations\/release\.v3\./.test(f))[0];
  assert.ok(mine, 'set-up: signed off');
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(60);
  assert.ok(/<b>Yes\.<\/b>/.test(panel(app)), 'set-up: ' + panel(app));
  app.fs.files[mine] = { t: app.fs.files[mine].t.slice(0, 20), m: Date.now() + 1 };
  app.click('refresh'); await app.tick(160);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(60);
  assert.ok(/<b>Yes\.<\/b>/.test(panel(app)), 'what it said last time: ' + panel(app));
  assert.ok(app.html().indexOf(mine) >= 0, 'the process page names it');
  const rep = app.PF.health.check({ data: await app.PF.repo.loadAll(app.fs), scan: null, me: 'person-casey', app: '2.1.0' }, Date.now());
  assert.ok(rep.issues.some(i => (i.paths || []).indexOf(mine) >= 0), JSON.stringify(rep.issues.map(i => i.detail)));
});

run();
