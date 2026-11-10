// Plan versus now and receipts (4.0, docs/design.md 45.5) in the app, slice 6: ending a living run writes its receipt record
// first (proposals/req-receipt-*.json, once), then the run's save sets ended and living.receipt together. Nothing is ended
// when the receipt can't say what was done; a run without to-dos ends exactly as in 3.0; what arrives after the end is shown
// apart and never changes the receipt or the outcome.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

const MD = ['---', 'process: release-notes', 'title: Release notes', 'owner: person-avery', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} Read them {#read}', ''].join('\n');

async function setup() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const b = PF.publish.build(MD, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand: 'rn000001', app: '4.0.0' });
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
const receipts = (app) => app.files('proposals/').filter(p => /^proposals\/req-receipt-/.test(p));
const recs = (app) => app.files('proposals/').filter(p => /^proposals\/req-/.test(p));
const refresh = async (app, ms) => { app.click('refresh'); await app.tick(ms || 250); };
const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
async function added(app, text) {
  app.set('td-add', text); app.click('td-add'); await app.tick(120);
  await refresh(app, 400);
  assert.ok(theRun(app).living, 'set-up: the run is living');
}
const end = async (app, outcome) => { app.click('end', outcome || 'Cancelled'); await app.tick(300); };

rule('Ending a living run writes its receipt first, then the run names it as it ends; the receipt page shows it frozen', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  const head = theRun(app).living.head;
  await end(app);
  const r = theRun(app), rs = receipts(app);
  assert.strictEqual(rs.length, 1, 'one receipt record');
  const rec = JSON.parse(app.fs.files[rs[0]].t);
  assert.deepStrictEqual([rec.kind, rec.head, rec.outcome, rec.run.id, rec.by], ['receipt', head, 'Cancelled', r.id, 'person-avery']);
  assert.ok(r.ended && r.ended.outcome === 'Cancelled', 'ended');
  assert.deepStrictEqual(r.living, { head, receipt: rec.id }, 'the same save sets ended and living.receipt');
  assert.strictEqual(app.PF.run.sanitize(JSON.parse(JSON.stringify(r)))._unrunnable, undefined, 'it reads back');
  assert.strictEqual(rs[0], 'proposals/' + rec.id + '.json');
  const t = txt(app.html());
  assert.ok(/Plan versus now/.test(t), 'the receipt page shows it');
  assert.ok(/To-dos: 0 of 1 resolved/.test(t), t.slice(0, 2000));
  assert.ok(/As the receipt froze it when the run ended/.test(t), 'confirmed');
});

rule('A run without to-dos ends exactly as in 3.0: no receipt, no living, nothing more in proposals/', async () => {
  const app = await setup();
  const n = app.files('proposals/').length;
  await end(app);
  const r = theRun(app);
  assert.ok(r.ended, 'ended');
  assert.strictEqual(r.living, undefined);
  assert.strictEqual(app.files('proposals/').length, n);
  assert.ok(!/Plan versus now/.test(txt(app.html())));
});

rule('A receipt whose save fails ends nothing; ending again writes the very same bytes once', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  const fs = app.fs, write = fs.write.bind(fs), runText = app.fs.files[runPath(app)].t;
  let tried = null;
  fs.write = (p, t, o) => { if (/^proposals\/req-receipt-/.test(p)) { tried = t; return Promise.reject(new Error('EIO')); } return write(p, t, o); };
  await end(app);
  assert.strictEqual(receipts(app).length, 0);
  assert.strictEqual(app.fs.files[runPath(app)].t, runText, 'the run is unchanged');
  assert.ok(/The run wasn't ended/.test(txt(app.html())), 'said');
  fs.write = write;
  await end(app);
  assert.strictEqual(receipts(app).length, 1);
  assert.strictEqual(app.fs.files[receipts(app)[0]].t, tried, 'the same bytes as the first try');
  assert.ok(theRun(app).ended);
});

rule('A to-do record that can\'t be read ends nothing and writes nothing, named', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  app.fs.files['proposals/req-flightdeck-broken-0123456789abcdef01234567.json'] = { t: '{ not json', m: Date.now() };
  await refresh(app, 300);
  const before = JSON.stringify(Object.keys(app.fs.files).sort()), runText = app.fs.files[runPath(app)].t;
  await end(app);
  assert.strictEqual(JSON.stringify(Object.keys(app.fs.files).sort()), before, 'zero writes');
  assert.strictEqual(app.fs.files[runPath(app)].t, runText);
  assert.ok(!theRun(app).ended);
});

rule('A person change while the receipt is being written ends nothing', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  const fs = app.fs, read = fs.read.bind(fs); let release = null;
  fs.read = (p, o) => /^proposals\/req-receipt-/.test(p) && !release ? new Promise((res) => { release = () => res(read(p, o)); }) : read(p, o);
  app.click('end', 'Cancelled'); await app.tick(40);
  assert.ok(release, 'the save is under way');
  app.choose('person-blake'); await app.tick(40);
  release(); await app.tick(200);
  fs.read = read;
  assert.strictEqual(receipts(app).length, 0, 'no receipt');
  assert.ok(!theRun(app).ended, 'not ended');
});

rule('The run\'s save that ends it asks the receipt again: a request filed once the receipt is written ends nothing and puts the end back', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  const fs = app.fs, write = fs.write.bind(fs), T = app.PF.todos, r0 = theRun(app), runText = app.fs.files[runPath(app)].t;
  const d = await app.PF.repo.loadAll(app.fs, {}), V = T.view(app.PF.run.sanitize(r0), { records: d.todos || [], people: JSON.parse(app.fs.files['people.json'].t) });
  const p = T.buildProposal({ run: { process: r0.process, id: r0.id }, id: T.idFor('flightdeck', 'k-00a0b1'), by: 'person-avery', seen: V.heads.slice(0, 50), at: new Date().toISOString(), body: { op: 'add', text: 'Late one', target: { phase: 'draft' }, placement: T.placementFor(app.PF.run.mapOf(app.PF.run.sanitize(r0)), { phase: 'draft' }) }, app: '4.0.0' });
  /* Right after the receipt is written, another request lands in the folder: the receipt no longer says everything the run saw. */
  fs.write = (path, t, o) => write(path, t, o).then((x) => { if (/^proposals\/req-receipt-/.test(path)) { fs.write = write; return write('proposals/' + p.id + '.json', T.text(p)).then(() => x); } return x; });
  await end(app);
  fs.write = write;
  const r = theRun(app);
  assert.strictEqual(receipts(app).length, 1, 'the receipt stays, naming nothing');
  assert.ok(!r.ended, 'not ended');
  assert.strictEqual(app.fs.files[runPath(app)].t, runText, 'the run is as it was');
  assert.ok(!app.files(runPath(app).replace(/run\.json$/, '')).some(x => /candidate-/.test(x) && app.fs.files[x].t.indexOf('"receipt"') >= 0), 'no candidate names the receipt');
});

rule('A request filed after the end is shown apart; the receipt and the ended outcome don\'t change', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  await end(app);
  const r0 = theRun(app), rtext = app.fs.files[receipts(app)[0]].t, T = app.PF.todos;
  const d = await app.PF.repo.loadAll(app.fs, {}), V = T.view(app.PF.run.sanitize(r0), { records: d.todos || [], people: JSON.parse(app.fs.files['people.json'].t) });
  const p = T.buildProposal({ run: { process: r0.process, id: r0.id }, id: T.idFor('flightdeck', 'k-00c0d1'), by: 'person-avery', seen: V.heads.slice(0, 50), at: new Date().toISOString(), body: { op: 'add', text: 'After the end', target: { phase: 'draft' }, placement: T.placementFor(app.PF.run.mapOf(app.PF.run.sanitize(r0)), { phase: 'draft' }) }, app: '4.0.0' });
  await app.fs.write('proposals/' + p.id + '.json', T.text(p));
  await refresh(app, 400);
  app.click('open-run', r0.process + '/' + r0.id); await app.tick(120);
  const t = txt(app.html());
  assert.ok(/After it ended/.test(t) && /1 request arrived after the run ended/.test(t), t.slice(0, 3000));
  assert.strictEqual(app.fs.files[receipts(app)[0]].t, rtext, 'the receipt is unchanged');
  assert.deepStrictEqual(theRun(app).ended, r0.ended, 'the outcome is unchanged');
});

rule('A receipt the run names that is missing from the folder is said by its path, never confirmed', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  await end(app);
  const r = theRun(app), path = receipts(app)[0];
  delete app.fs.files[path];
  await refresh(app, 300);
  app.click('open-run', r.process + '/' + r.id); await app.tick(120);
  const t = txt(app.html());
  assert.ok(t.indexOf("isn't in the folder") >= 0 && t.indexOf(path) >= 0, t.slice(0, 3000));
  assert.ok(!/As the receipt froze it/.test(t));
});

run();
