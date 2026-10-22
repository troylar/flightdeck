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

run();
