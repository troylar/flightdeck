// Test runs in the app (2.1 slice 5): started from a stage's line under All versions, labeled Test run wherever a run is
// listed or opened, never counted as a real run (Home's tally, How runs go, readiness), and refused on a stage that's retired
// or already the default. The run is built only when it's saved, after the stage and its decisions are read again.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

const stageFiles = (app) => app.files('staged/release/').filter(f => /^staged\/release\/stage-[a-z0-9]{8}\/publication\.json$/.test(f));
const runFiles = (app) => app.files('runs/release/').filter(f => /\/run\.json$/.test(f));
const testRuns = (app) => runFiles(app).map(f => JSON.parse(app.fs.files[f].t)).filter(r => r.test === true);

async function staged(who) {
  const app = boot(); await app.tick(60);
  app.choose(who || 'person-casey'); await app.tick();
  const path = 'maps/drafts/release.md', md = app.fs.files[path].t;
  await app.fs.write(path, md.replace(/\n(## [^\n]*\n)/, '\n$1- [ ] {confirm} Tell the on-call channel {#tell-oncall}\n'));
  app.click('refresh'); await app.tick(80);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  app.set('change-note', 'Tell on-call first'); app.click('stage-draft', 'release'); await app.tick(200);
  const sf = stageFiles(app);
  assert.strictEqual(sf.length, 1, 'set-up: staged');
  return { app, folder: JSON.parse(app.fs.files[sf[0]].t).folder };
}
async function started(who) {
  const { app, folder } = await staged(who);
  app.click('start-test', folder); await app.tick();
  assert.ok(/Start a test run/.test(app.html()) && /data-test="1"/.test(app.html()), 'the test-run form');
  app.submitForm('start-form', {}); await app.tick(200);
  const t = testRuns(app);
  assert.strictEqual(t.length, 1, 'one test run written');
  return { app, folder, r: t[0] };
}

rule('Start a test run from the stage\'s line: run/3 on the stage, test and stage last, by the person who started it, opened and labeled', async () => {
  const { app, folder } = await staged();
  assert.ok(new RegExp('data-act="start-test" data-id="' + folder + '"[^>]*>Start a test run<').test(app.html()), 'offered on the stage\'s line');
  const before = runFiles(app).length;
  app.click('start-test', folder); await app.tick();
  const form = app.html();
  assert.ok(/staged v3/.test(form) && /isn.t counted in How runs go/.test(form) && !/data-act="decline-plan"/.test(form), 'the form says what a test run is');
  app.submitForm('start-form', {}); await app.tick(200);
  assert.strictEqual(runFiles(app).length, before + 1);
  const r = testRuns(app)[0];
  assert.ok(r.format === 'preflight-run/3' && r.features.indexOf('staged') >= 0 && r.features.indexOf('test-run') >= 0 && r.folder === folder && r.version === 3 && r.createdBy === 'person-casey', JSON.stringify([r.format, r.features, r.folder, r.version, r.createdBy]));
  assert.deepStrictEqual(Object.keys(r).slice(-2), ['test', 'stage']);
  assert.deepStrictEqual(r.stage, { folder });
  const html = app.html();
  assert.ok(/class="badge b-test">Test run</.test(html) && /Test run · staged v3/.test(html), 'the run says it\'s a test run, on staged v3');
});

rule('A test run is labeled in Runs, Home, the process page, the receipt and search, and never counted in Home\'s tally', async () => {
  const { app, r } = await started();
  app.click('nav', 'runs'); await app.tick();
  let html = app.html();
  assert.ok(/b-test">Test run</.test(html), 'Runs: labeled');
  app.click('nav', 'home'); await app.tick();
  html = app.html();
  assert.ok(/Test run · [^<]*: you.re recording/.test(html), 'Home: labeled');
  const tally = +(/<span class="big">(\d+)<\/span><span>running<\/span>/.exec(html) || [])[1];
  const running = app.files('runs/').filter(f => /\/run\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(x => x.state === 'running' && x.test !== true).length;
  assert.strictEqual(tally, running, 'Home\'s running tally leaves the test run out');
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(/Test run · staged v3/.test(app.html()), 'process page: labeled in Recent runs');
  const receipt = app.PF.run.receipt(app.PF.run.sanitize(r), app.PF.run.mapOf(app.PF.run.sanitize(r)), x => x, '2026-10-22T10:00:00.000Z');
  assert.ok(/^Flightdeck receipt \(TEST RUN\): /.test(receipt) && /test run on staged v3, not a published version/.test(receipt), 'the receipt says so');
});

rule('How runs go leaves test runs out with a line saying how many, and the stage is never a version to pick there', async () => {
  const { app } = await started();
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'insights'); await app.tick(60);
  const html = app.html();
  assert.ok(/1 test run not counted\./.test(html), 'the line: ' + (html.match(/[^>]*not counted[^<]*/) || [''])[0]);
  assert.ok(!/stage-[a-z0-9]{8}/.test((html.match(/<select[^>]*ins-ver[\s\S]*?<\/select>/) || [''])[0]), 'the stage isn\'t offered as a version');
});

rule('A retired or promoted stage takes no new test run, and says why; nothing is written', async () => {
  const { app, folder } = await staged();
  app.click('retire-stage', folder); await app.tick(200);
  assert.ok(!/data-act="start-test"/.test(app.html()), 'no Start a test run on a retired stage');
  const before = JSON.stringify(app.files(''));
  app.click('start-test', folder); await app.tick();
  assert.ok(/retired/i.test(app.html()) && !/id="start-form"/.test(app.html()), 'it says it\'s retired');
  assert.strictEqual(JSON.stringify(app.files('')), before, 'nothing written');
  app.click('open-process', 'release'); await app.tick();
  app.click('reopen-stage', folder); await app.tick(200);
  app.click('start-test', folder); await app.tick();
  /* Retired by another window after the form was drawn: the save reads the decisions again and refuses. */
  const dec = 'staged/release/decisions/' + folder + '.w-other.9.json';
  await app.fs.write(dec, JSON.stringify({ format: 'flightdeck-stage-decision/1', app: '2.1.0', process: 'release', stage: folder, status: 'retired', reason: '', by: 'person-morgan', at: '2026-10-22T10:00:00.000Z', rev: 9, seen: 2 }, null, 2));
  const runsBefore = runFiles(app).length;
  app.submitForm('start-form', {}); await app.tick(200);
  assert.strictEqual(runFiles(app).length, runsBefore, 'no run written');
  assert.ok(/Couldn&#39;t start the test run: It&#39;s retired/.test(app.html()), 'and it says why');
});

rule('The person is the one who submitted: a change of person while the stage is read again starts nothing', async () => {
  const { app, folder } = await staged();
  app.click('start-test', folder); await app.tick();
  let release; const gate = new Promise(r => { release = r; });
  const orig = app.fs.read.bind(app.fs);
  app.fs.read = (x, o) => new RegExp('^staged/release/' + folder + '/publication\\.json$').test(x) ? gate.then(() => orig(x, o)) : orig(x, o);
  const before = runFiles(app).length;
  app.submitForm('start-form', {}); await app.tick(20);
  app.choose('person-morgan'); await app.tick(20);
  release(); await app.tick(200);
  app.fs.read = orig;
  assert.strictEqual(runFiles(app).length, before, 'nothing started under either name');
});

rule('A follow-up from a test run is real and labeled where follow-ups are listed', async () => {
  const { app, r } = await started();
  const path = 'runs/release/' + r.id + '/run.json', o = JSON.parse(app.fs.files[path].t);
  o.followUps = [{ id: 'f1', text: 'Fix the staging smoke test', owner: 'person-casey', ticket: '', step: '', from: '', by: 'person-casey', at: '2026-10-22T10:00:00.000Z' }];
  await app.fs.write(path, JSON.stringify(o, null, 2));
  app.click('refresh'); await app.tick(120);
  app.click('nav', 'followups'); await app.tick();
  const html = app.html();
  assert.ok(/Fix the staging smoke test/.test(html) && /Test run · <button class="linkish" data-act="open-run"/.test(html), 'listed, labeled');
});

rule('Back and Forward bring the test-run form back as a test-run form, never as an ordinary start', async () => {
  const { app, folder } = await staged();
  app.click('start-test', folder); await app.tick();
  assert.strictEqual(app.hash(), '#/process/release/start/' + folder);
  app.back(); await app.settle();
  assert.ok(!/id="start-form"/.test(app.html()), 'Back leaves the form');
  app.forward(); await app.settle();
  assert.ok(/id="start-form"/.test(app.html()) && /data-test="1"/.test(app.html()) && new RegExp('data-folder="' + folder + '"').test(app.html()), 'Forward: the test-run form again');
  const before = runFiles(app).length;
  app.submitForm('start-form', {}); await app.tick(200);
  assert.strictEqual(runFiles(app).length, before + 1);
  assert.strictEqual(testRuns(app).length, 1, 'a test run, not a counted run');
});

rule('A test run kept in this browser restores as a test run: the window\'s own fields never refuse it', async () => {
  const { app, r } = await started();
  const path = 'runs/release/' + r.id + '/run.json', o = JSON.parse(app.fs.files[path].t);
  const local = Object.assign({}, o, { title: 'Kept here', _path: path, _fileHash: 'x' });
  app.store['preflight:unsaved:' + app.fs.kind + ':' + (app.fs.id || app.fs.name) + ':' + r.id] = JSON.stringify(local);
  app.click('nav', 'runs'); await app.tick(); app.click('open-run', 'release/' + r.id); await app.tick(40);
  assert.ok(/data-act="restore-local"/.test(app.html()), 'offered: ' + (app.html().match(/kept in this browser[^<]*/) || [''])[0]);
  app.click('restore-local'); await app.tick(200);
  const back = JSON.parse(app.fs.files[path].t);
  assert.ok(back.title === 'Kept here' && back.test === true, 'restored: ' + app.live());
  assert.deepStrictEqual(Object.keys(back).slice(-2), ['test', 'stage']);
});

run();
