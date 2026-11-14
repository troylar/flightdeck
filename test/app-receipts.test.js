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

/* ---- CA: the receipt is prepared and asked again from the folder read again: scopes, child runs and their versions ---- */
const KID = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-avery', '---', '',
  '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
const pPath = (app) => app.files('runs/release-readiness/').find(p => /run\.json$/.test(p));
const pRun = (app) => JSON.parse(app.fs.files[pPath(app)].t);
const kidPaths = (app) => app.files('runs/validate-story/').filter(p => /run\.json$/.test(p));
const scopeFiles = (app) => app.files('proposals/').filter(p => { try { return !!app.PF.loop.isScope(JSON.parse(app.fs.files[p].t)); } catch (e) { return false; } });
const addStories = async (app, keys) => { app.set('loop-add-each', keys); app.click('loop-add', 'each'); await app.tick(150); app.set('loop-add-each', ''); await app.tick(); };
async function loopSetup() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '4.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(KID, 'validate-story', 'vs000001'); put(PARENT, 'release-readiness', 'rr000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  await addStories(app, 'ABC-101, ABC-102');
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  const r = pRun(app); app.click('open-run', r.process + '/' + r.id); await app.tick(80);
  assert.strictEqual(kidPaths(app).length, 1, 'set-up: one story run');
  app.set('td-add', 'Post the release notes'); app.click('td-add'); await app.tick(120); await refresh(app, 400);
  assert.ok(pRun(app).living, 'set-up: the parent is living');
  return app;
}
/* Ends the parent with damage done to the folder right after its receipt is written: nothing ends, and the run is as it was. */
async function endDamaged(app, damage) {
  const fs = app.fs, write = fs.write.bind(fs), runText = app.fs.files[pPath(app)].t;
  let hit = false;
  fs.write = (p, t, o) => write(p, t, o).then((x) => { if (/^proposals\/req-receipt-/.test(p) && !hit) { hit = true; damage(); } return x; });
  app.click('end', 'Cancelled'); await app.tick(400);
  fs.write = write;
  assert.ok(hit, 'the receipt was written');
  assert.ok(!pRun(app).ended, 'not ended');
  assert.strictEqual(app.fs.files[pPath(app)].t, runText, 'the run is as it was');
}

rule('A loop parent with to-dos ends with its receipt when nothing changes meanwhile (the control for the three below)', async () => {
  const app = await loopSetup();
  app.click('end', 'Cancelled'); await app.tick(400);
  const r = pRun(app);
  assert.ok(r.ended && r.living && r.living.receipt, JSON.stringify(r.living));
  assert.ok(app.fs.files['proposals/' + r.living.receipt + '.json'], 'its receipt is in the folder');
});

rule('A scope item removed right after the receipt is written ends nothing: the receipt is asked again on the scope records read again', async () => {
  const app = await loopSetup(), sc = scopeFiles(app);
  assert.ok(sc.length, 'set-up: scope records');
  const last = sc.slice().sort((a, b) => app.fs.files[a].m - app.fs.files[b].m || (a < b ? -1 : 1)).pop();
  await endDamaged(app, () => { delete app.fs.files[last]; });
});

rule('A scope item added right after the receipt is written ends nothing', async () => {
  const app = await loopSetup(), before = scopeFiles(app);
  await addStories(app, 'ABC-103');
  const added = scopeFiles(app).filter(p => before.indexOf(p) < 0), kept = added.map(p => [p, app.fs.files[p]]);
  assert.ok(added.length, 'set-up: the addition\'s records');
  added.forEach(p => { delete app.fs.files[p]; });
  await refresh(app, 400);
  const r = pRun(app); app.click('open-run', r.process + '/' + r.id); await app.tick(80);
  await endDamaged(app, () => { kept.forEach(([p, f]) => { app.fs.files[p] = f; }); });
});

/* AD: the end is bound to the scope records it was prepared from, not only to their counts: a scope record filed after the
   receipt that removes an unstarted item and adds another (every count the same) ends nothing. */
rule('A scope change that keeps every count (one unstarted item removed, another added) right after the receipt is written ends nothing', async () => {
  const app = await loopSetup(), before = scopeFiles(app);
  app.set('loop-why-each', 'Not this release'); app.click('loop-exclude', 'each', { item: 'ABC-102' }); await app.tick(200);
  await addStories(app, 'ABC-103');
  const added = scopeFiles(app).filter(p => before.indexOf(p) < 0), kept = added.map(p => [p, app.fs.files[p]]);
  assert.ok(added.length >= 2, 'set-up: the removal\'s and the addition\'s records (' + added.length + ')');
  added.forEach(p => { delete app.fs.files[p]; });
  await refresh(app, 400);
  const r = pRun(app); app.click('open-run', r.process + '/' + r.id); await app.tick(80);
  await endDamaged(app, () => { kept.forEach(([p, f]) => { app.fs.files[p] = f; }); });
});

/* AE: a loop item's choice names a run of the process its own loop step starts: a run of that id under another loop's
   process never stands in for it, so the end is refused, naming the missing run by its full path. */
const KID2 = KID.replace('process: validate-story', 'process: other-story').replace('title: Validate a story', 'title: Another story');
const PARENT2 = PARENT.replace("## Ship · READ-DO {#ship}", "- [!] {for.each} Check every other story {#each2}\n  process: other-story\n  items: jira.issue\n  pass: issue=item:key\n  accepts: cleared\n\n## Ship · READ-DO {#ship}");
rule('A loop choice naming a run that is only under another loop\'s process ends nothing, named by its full path', async () => {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => { const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '4.0.0' }); assert.ok(!b.blockers, JSON.stringify(b.blockers)); Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; }); };
  put(KID, 'validate-story', 'vs000001'); put(KID2, 'other-story', 'os000001'); put(PARENT2, 'release-readiness', 'rr000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  await addStories(app, 'ABC-101');
  app.set('loop-add-each2', 'ABC-201'); app.click('loop-add', 'each2'); await app.tick(150);
  app.click('loop-start', 'each2', { item: 'ABC-201' }); await app.tick(150);
  const other = app.files('runs/other-story/').find(p => /run\.json$/.test(p));
  assert.ok(other, 'set-up: a run of the other loop');
  const oid = JSON.parse(app.fs.files[other].t).id, r = pRun(app);
  app.click('open-run', r.process + '/' + r.id); await app.tick(80);
  app.set('td-add', 'Post the release notes'); app.click('td-add'); await app.tick(120); await refresh(app, 400);
  assert.ok(pRun(app).living, 'set-up: the parent is living');
  /* A choice on the first loop naming the other loop's run by its id alone. */
  const sp = scopeFiles(app).find(p => { const o = JSON.parse(app.fs.files[p].t); return o.loop && o.loop.step === 'each' && (o.changes || []).some(c => c.op === 'add'); });
  const o = JSON.parse(app.fs.files[sp].t), item = o.changes.find(c => c.op === 'add').item, id = 'req-flightdeck-' + 'c'.repeat(24);
  const ch = Object.assign({}, o, { id, seen: [o.id], changes: [{ op: 'choose', item, run: oid, attempt: 1, candidates: [oid, 'zz-none'] }] });
  app.fs.files['proposals/' + id + '.json'] = { t: JSON.stringify(ch, null, 2) + '\n', m: Date.now() };
  await refresh(app, 400);
  app.click('open-run', r.process + '/' + r.id); await app.tick(80);
  const runText = app.fs.files[pPath(app)].t;
  app.click('end', 'Cancelled'); await app.tick(400);
  assert.ok(!pRun(app).ended, 'not ended');
  assert.strictEqual(app.fs.files[pPath(app)].t, runText, 'the run is as it was');
  const t = txt(app.html());
  assert.ok(t.indexOf('runs/validate-story/' + oid + '/run.json') >= 0, 'named by its full path: ' + t.slice(t.indexOf('wasn'), t.indexOf('wasn') + 300));
});

rule('A child run that can\'t be read, or its version, right after the receipt is written ends nothing', async () => {
  for (const what of ['run', 'version']) {
    const app = await loopSetup(), kid = kidPaths(app)[0], k = JSON.parse(app.fs.files[kid].t);
    const map = app.files('publications/validate-story/').find(p => p.indexOf('/' + k.folder + '/map.md') >= 0);
    assert.ok(map, 'set-up: the child\'s version');
    await endDamaged(app, () => { if (what === 'run') app.fs.files[kid] = { t: '{ not json', m: Date.now() }; else app.fs.files[map] = { t: app.fs.files[map].t + '\nchanged', m: Date.now() }; });
  }
});

/* HD: the end is asked again on the publication indexes read again right there, never the ones this window cached: a second
   v1 of the loop child's checklist added right after the receipt is written makes the child's pin ambiguous, so fresh pin
   resolution counts it as no match and nothing ends. The control ends with the cleared child counted. */
async function clearKid(app) {
  const path = kidPaths(app)[0], kid = JSON.parse(app.fs.files[path].t), at = new Date(Date.now() + 1000).toISOString(), R = app.PF.run;
  kid.steps.verdict = { s: 'done', by: 'person-avery', at, values: { decision: 'cleared' } };
  kid.details.disposition = 'cleared';
  const rr = R.sanitize(JSON.parse(JSON.stringify(kid))), mm = R.mapOf(rr);
  mm.phases.forEach(p => { if (p.gate) kid.gates[p.gate.id] = { s: 'passed', by: 'person-avery', at, approved: R.gateInputs(rr, mm, p.gate) }; });
  kid.ended = { outcome: 'Completed', by: 'person-avery', at }; kid.state = 'completed'; kid.rev = (kid.rev || 0) + 1;
  await app.fs.write(path, JSON.stringify(kid));
  await refresh(app, 400);
  const r = pRun(app); app.click('open-run', r.process + '/' + r.id); await app.tick(80);
}
rule('A second v1 of a loop child\'s checklist added right after the receipt is written ends nothing: the end asks the versions read again', async () => {
  const ctl = await loopSetup(); await clearKid(ctl);
  ctl.click('end', 'Cancelled'); await ctl.tick(400);
  const r = pRun(ctl), rec = r.ended && JSON.parse(ctl.fs.files['proposals/' + r.living.receipt + '.json'].t);
  assert.ok(rec, 'control: ended with its receipt');
  assert.strictEqual(rec.counts.cleared + ' of ' + rec.counts.items, '1 of 2', 'control: the cleared child counted');

  const app = await loopSetup(); await clearKid(app);
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t);
  const b = PF.publish.build(KID, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'Again', existing: [], now: new Date().toISOString(), rand: 'vs000002', app: '4.0.0' });
  assert.ok(!b.blockers && /^v1-/.test(b.folder), 'set-up: another v1 (' + b.folder + ')');
  await endDamaged(app, () => { Object.keys(b.files).forEach(k => { app.fs.files['publications/validate-story/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; }); });
});

/* ID: a running living run's progress is the shared comparison's (PF.receipts.compare), as its receipt will count it: an
   excluded unstarted item is no longer in scope, so the screen never says more items than the receipt would. */
rule('A running living run\'s progress counts items as its receipt would: an excluded unstarted item is left out', async () => {
  const app = await loopSetup();
  app.set('loop-why-each', 'Not this release'); app.click('loop-exclude', 'each', { item: 'ABC-102' }); await app.tick(200);
  await refresh(app, 400);
  const r = pRun(app); app.click('open-run', r.process + '/' + r.id); await app.tick(120);
  const prog = (app.html().match(/<ul class="rw-counts[^"]*"[^>]*>([\s\S]*?)<\/ul>/) || [])[1] || '';
  const lines = (prog.match(/<li>[\s\S]*?<\/li>/g) || []).map((l) => txt(l).trim());
  assert.ok(lines.indexOf('Items: 0 of 1 cleared') >= 0, 'the running screen counts the items in scope: ' + JSON.stringify(lines));
  assert.ok(!lines.some((l) => /^Items: 0 of 2/.test(l)), 'never the excluded item: ' + JSON.stringify(lines));
  assert.ok(/^This checklist: \d+ of \d+ current steps answered$/.test(lines[0]), 'the comparison\'s own words: ' + JSON.stringify(lines));
});

/* IA: the end asks the whole bounded closure every reader of an evidence pack asks (repo.depClosure, PF.receipts.deps, the
   export's own walk) of the folder read again before each of its writes: a loop child that is itself a living run, cleared
   and ended with its receipt, whose receipt or current application is deleted right after the parent's receipt or a
   candidate of the parent's save is written, ends nothing, named by its path. The control ends with the child counted. */
async function livingKid() {
  const app = await loopSetup(), kp = kidPaths(app)[0], k0 = JSON.parse(app.fs.files[kp].t), kkey = k0.process + '/' + k0.id;
  app.click('open-run', kkey); await app.tick(120);
  app.set('td-add', 'Check the story notes'); app.click('td-add'); await app.tick(150); await refresh(app, 400);
  app.click('open-run', kkey); await app.tick(120);
  const tid = (app.html().match(/data-act="td-done" data-id="([^"]+)"/) || [])[1];
  assert.ok(tid, 'set-up: the child\'s to-do can be checked off');
  app.click('td-done', tid); await app.tick(150); await refresh(app, 400); await refresh(app, 400);
  const kid = JSON.parse(app.fs.files[kp].t), at = new Date(Date.now() + 1000).toISOString(), R = app.PF.run;
  assert.ok(kid.living && kid.living.head, 'set-up: the child is living: ' + JSON.stringify(kid.living));
  kid.steps.verdict = { s: 'done', by: 'person-avery', at, values: { decision: 'cleared' } };
  kid.details.disposition = 'cleared';
  const rr = R.sanitize(JSON.parse(JSON.stringify(kid))), mm = R.mapOf(rr);
  mm.phases.forEach(p => { if (p.gate) kid.gates[p.gate.id] = { s: 'passed', by: 'person-avery', at, approved: R.gateInputs(rr, mm, p.gate) }; });
  delete kid.gates[mm.phases[0].gate.id];
  kid.rev = (kid.rev || 0) + 1;
  await app.fs.write(kp, JSON.stringify(kid, null, 2)); await refresh(app, 400);
  app.click('open-run', kkey); await app.tick(120);
  app.click('pass', '0'); await app.tick(200);
  app.click('end', 'Completed'); await app.tick(400); await refresh(app, 400);
  const k2 = JSON.parse(app.fs.files[kp].t);
  assert.ok(k2.ended && k2.living && k2.living.receipt, 'set-up: the child ended with its receipt: ' + JSON.stringify([k2.ended, k2.living]) + ' ' + ((app.html().match(/id="live"[^>]*>([\s\S]{0,600})/) || [])[1] || '') + ' | ' + txt(app.html()).slice(0, 1500));
  const r = pRun(app); app.click('open-run', r.process + '/' + r.id); await app.tick(120);
  return { app, kid: k2 };
}
rule('A living loop child whose receipt or current application is deleted while the parent ends ends nothing, named by its path', async () => {
  const ctl = await livingKid();
  ctl.app.click('end', 'Cancelled'); await ctl.app.tick(400);
  const r = pRun(ctl.app), rec = r.ended && JSON.parse(ctl.app.fs.files['proposals/' + r.living.receipt + '.json'].t);
  assert.ok(rec, 'control: ended with its receipt');
  assert.strictEqual(rec.counts.cleared + ' of ' + rec.counts.items, '1 of 2', 'control: the living child counted cleared');
  for (const what of ['receipt', 'application']) {
    for (const at of [/^proposals\/req-receipt-/, /\/candidate-[^/]*\.json$/]) {
      const { app, kid } = await livingKid(), gone = 'proposals/' + (what === 'receipt' ? kid.living.receipt : kid.living.head) + '.json';
      assert.ok(app.fs.files[gone], 'set-up: the child\'s ' + what + ' is in the folder (' + gone + ')');
      const pp = pPath(app), fs = app.fs, write = fs.write.bind(fs), runText = app.fs.files[pp].t;
      let hit = false;
      fs.write = (p, t, o) => write(p, t, o).then((x) => { if (!hit && at.test(p) && (at.source.indexOf('candidate') < 0 || p.indexOf(pp.replace(/run\.json$/, '')) === 0)) { hit = true; delete app.fs.files[gone]; } return x; });
      app.click('end', 'Cancelled'); await app.tick(500);
      fs.write = write;
      const tag = what + ' after ' + at.source;
      assert.ok(hit, tag + ': the write was made');
      assert.ok(!pRun(app).ended, tag + ': not ended');
      assert.strictEqual(app.fs.files[pp].t, runText, tag + ': the run is as it was');
      assert.ok(txt(app.html()).indexOf(gone) >= 0, tag + ': named by its path: ' + txt(app.html()).slice(0, 1200));
    }
  }
});

/* JA: one checked dependency snapshot feeds both the receipt and the closure: a child that turns from cleared to needs-work
   (or from Completed to Cancelled) right after the guard's first read of it, before the parent's run.json write, ends
   nothing. The receipt written counted it cleared; the end is asked on what the closure checked, which no longer does. */
rule('A cleared child that changes between the guard\'s reads before the parent\'s run.json write ends nothing', async () => {
  /* After each of the child's reads following the parent's candidate write but the last: a change after the last read
     before the write is the shared folder's known limit (no compare-and-swap), seen by no read at all. */
  for (const [what, at] of [['needs-work', 1], ['needs-work', 2], ['needs-work', 3], ['Cancelled', 2], ['Cancelled', 3]]) {
    const app = await loopSetup(); await clearKid(app);
    const kp = kidPaths(app)[0], pp = pPath(app), fs = app.fs, write = fs.write.bind(fs), read = fs.read.bind(fs), blob = fs.blob ? fs.blob.bind(fs) : null, runText = app.fs.files[pp].t;
    const k = JSON.parse(app.fs.files[kp].t);
    if (what === 'needs-work') { k.steps.verdict.values.decision = 'needs-work'; k.details.disposition = 'needs-work'; } else { k.ended.outcome = 'Cancelled'; k.state = 'cancelled'; }
    k.rev = (k.rev || 0) + 1;
    const changed = JSON.stringify(k);
    let armed = false, flipped = false;
    let nth = 0;
    const after = (p) => (x) => { if (armed && !flipped && p === kp && ++nth === at) { flipped = true; app.fs.files[kp] = { t: changed, m: Date.now() + 5000 }; } return x; };
    fs.write = (p, t, o) => write(p, t, o).then((x) => { if (!armed && p.indexOf(pp.replace(/run\.json$/, '') + 'candidate-') === 0) armed = true; return x; });
    fs.read = (p, o) => read(p, o).then(after(p));
    if (blob) fs.blob = (p, o) => blob(p, o).then(after(p));
    app.click('end', 'Cancelled'); await app.tick(500);
    fs.write = write; fs.read = read; if (blob) fs.blob = blob;
    const tag = what + ' at read ' + at;
    assert.ok(armed && flipped, tag + ': the child changed between the guard\'s reads');
    assert.ok(!pRun(app).ended, tag + ': not ended: ' + JSON.stringify(pRun(app).living));
    assert.strictEqual(app.fs.files[pp].t, runText, tag + ': the run is as it was');
  }
});

/* KA: the children the closure lists last are held to every child read before (the guard's first read, this window's): an
   open child whose whole folder is deleted after the guard's first read of it, before the closure lists the children,
   ends nothing, named by its path. */
rule('An open child deleted between the guard\'s first read and the closure\'s listing ends nothing, named by its path', async () => {
  /* After each of the child's reads following the parent's candidate write: the third is the last guard's first read. */
  for (const at of [1, 2, 3]) {
    const app = await loopSetup();
    const kp = kidPaths(app)[0], dir = kp.replace(/run\.json$/, ''), pp = pPath(app), fs = app.fs, write = fs.write.bind(fs), read = fs.read.bind(fs), runText = app.fs.files[pp].t;
    let armed = false, gone = false, nth = 0;
    const after = (p) => (x) => { if (armed && !gone && p === kp && ++nth === at) { gone = true; app.files(dir).forEach((f) => { delete app.fs.files[f]; }); } return x; };
    fs.write = (p, t, o) => write(p, t, o).then((x) => { if (!armed && p.indexOf(pp.replace(/run\.json$/, '') + 'candidate-') === 0) armed = true; return x; });
    fs.read = (p, o) => read(p, o).then(after(p));
    app.click('end', 'Cancelled'); await app.tick(500);
    fs.write = write; fs.read = read;
    const tag = 'after read ' + at;
    assert.ok(armed && gone, tag + ': the child was deleted between the guard\'s reads');
    assert.ok(!pRun(app).ended, tag + ': not ended: ' + JSON.stringify(pRun(app).living));
    assert.strictEqual(app.fs.files[pp].t, runText, tag + ': the run is as it was');
    assert.ok(txt(app.html()).indexOf(dir + 'run.json') >= 0, tag + ': named by its path: ' + txt(app.html()).slice(0, 800));
  }
});

/* MB: a listed child is judged whole before it can be taken as another run's: one whose file names this run as its loop's
   parent but that the readers refuse (a field this copy doesn't know, a newer format, a parent item that isn't text) ends
   nothing, named by its path, as the export names it. */
rule('A child the readers refuse whose file names this run as its parent ends nothing, named by its path, never skipped as another run\'s', async () => {
  const misses = [];
  for (const [what, damage] of [['a field this copy doesn\'t know', (k) => { k.zzLater = 1; }], ['a newer format', (k) => { k.format = 'preflight-run/4'; }], ['a parent item that isn\'t text', (k) => { k.parent.item = 42; }]]) {
    const app = await loopSetup(), kid = kidPaths(app)[0], fresh = kid.replace(/\/[^/]+\/run\.json$/, '/mbnew001/run.json');
    try {
      /* A new child, never read before, lands right after the receipt is written. */
      await endDamaged(app, () => { const k = JSON.parse(app.fs.files[kid].t); k.id = 'mbnew001'; damage(k); app.fs.files[fresh] = { t: JSON.stringify(k, null, 2), m: Date.now() }; });
      if (txt(app.html()).indexOf(fresh) < 0) misses.push(what + ': not named by its path: ' + txt(app.html()).slice(0, 300));
    } catch (e) { misses.push(what + ': ' + e.message.split('\n')[0]); }
  }
  assert.strictEqual(misses.length, 0, misses.join('\n'));
});

/* MA: every child seen during one ending attempt (the receipt's write and every guard of the save that ends the run) must
   still be in every later listing: a child that appears after the receipt is written (a second open run for an item, so
   the counts stay the same) and is deleted after the parent's candidate is written ends nothing, named by its path. */
rule('A child seen by one ending guard and gone by a later one ends nothing, named by its path', async () => {
  const app = await loopSetup(), kid = kidPaths(app)[0], fresh = kid.replace(/\/[^/]+\/run\.json$/, '/manew001/run.json'), dir = fresh.replace(/run\.json$/, '');
  const pp = pPath(app), fs = app.fs, write = fs.write.bind(fs), runText = app.fs.files[pp].t;
  /* A second open run for the same item: the counts the receipt froze stay the same with it or without it. */
  const k = JSON.parse(app.fs.files[kid].t); k.id = 'manew001';
  let added = false, gone = false;
  fs.write = (p, t, o) => write(p, t, o).then((x) => {
    if (!added && /^proposals\/req-receipt-/.test(p)) { added = true; app.fs.files[fresh] = { t: JSON.stringify(k, null, 2), m: Date.now() }; }
    else if (added && !gone && p.indexOf(pp.replace(/run\.json$/, '') + 'candidate-') === 0) { gone = true; app.files(dir).forEach((f) => { delete app.fs.files[f]; }); }
    return x;
  });
  app.click('end', 'Cancelled'); await app.tick(500);
  fs.write = write;
  assert.ok(added, 'the receipt was written and the child added');
  assert.ok(!pRun(app).ended || !gone, 'not ended: ' + JSON.stringify(pRun(app).living));
  assert.strictEqual(app.fs.files[pp].t, runText, 'the run is as it was');
  if (gone) assert.ok(txt(app.html()).indexOf(fresh) >= 0, 'named by its path: ' + txt(app.html()).slice(0, 600));
  assert.ok(gone, 'the save reached its candidate write, so the later guard is what refuses');
});

rule('An ended living run shows the receipt\'s frozen progress lines, the counts now apart; Copy for Jira carries the frozen summary and arrivals', async () => {
  const app = await loopSetup();
  app.click('end', 'Cancelled'); await app.tick(400);
  const r = pRun(app), rec = JSON.parse(app.fs.files['proposals/' + r.living.receipt + '.json'].t);
  const frozen = app.PF.receipts.words(rec.counts, rec.coverage).lines;
  /* Copy for Jira, from the receipt page the end opens. */
  const pre = app.el('receipt-text'); try { app.click('copy-receipt'); } catch (e) { /* no createRange in the harness */ }
  const text = (app.el('receipt-text') || pre || {}).textContent || '';
  assert.ok(/Plan versus now/.test(text), text.slice(0, 1500));
  frozen.forEach((l) => assert.ok(text.indexOf(l) >= 0, 'copied: ' + l + '\n' + text.slice(0, 1500)));
  /* A request after the end: an arrival in the copied text. */
  const T = app.PF.todos, f = T.buildProposal({ run: { process: r.process, id: r.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-late1', seen: [], at: new Date().toISOString(), body: { op: 'add', text: 'After the end', target: { phase: 'ship' }, placement: T.placementFor(app.PF.run.mapOf(app.PF.run.sanitize(r)), { phase: 'ship' }) } });
  await app.fs.write('proposals/' + f.id + '.json', T.text(f));
  await refresh(app, 400);
  const pre2 = app.el('receipt-text'); try { app.click('copy-receipt'); } catch (e) { /* as above */ }
  const text2 = pre2.textContent || '';
  assert.ok(/After it ended/.test(text2) && /1 request arrived after the run ended/.test(text2), text2.slice(0, 2000));
  /* The run screen: the frozen lines in its progress, and the counts now labeled apart. */
  app.click('open-run', r.process + '/' + r.id); await app.tick(120);
  const h = app.html(), prog = (h.match(/<ul class="rw-counts[^"]*"[^>]*>([\s\S]*?)<\/ul>/) || [])[1] || '';
  frozen.forEach((l) => assert.ok(txt(prog).indexOf(l) >= 0, 'progress: ' + l + ' in ' + txt(prog)));
  assert.ok(/Counted now, after the end/.test(txt(h)), 'the counts now, labeled apart');
});

rule('Copy for Jira of a run without to-dos is exactly as in 3.0: no plan versus now', async () => {
  const app = await setup();
  await end(app);
  app.click('receipt'); await app.tick(60);
  const pre = app.el('receipt-text'); try { app.click('copy-receipt'); } catch (e) { /* as above */ }
  const text = pre.textContent || '';
  const r = app.PF.run.sanitize(theRun(app));
  assert.ok(text.length > 0 && !/Plan versus now|After it ended/.test(text), text.slice(0, 800));
});

/* ---- GA: every path that can set ended on a living run guards the receipt ---- */
rule('A loop child whose whole folder is deleted right after the receipt is written ends nothing, named by its path', async () => {
  const app = await loopSetup(), kid = kidPaths(app)[0], dir = kid.replace(/run\.json$/, '');
  await endDamaged(app, () => { app.files(dir).forEach((p) => { delete app.fs.files[p]; }); });
  assert.ok(txt(app.html()).indexOf(dir + 'run.json') >= 0, 'the missing child is named: ' + txt(app.html()).slice(0, 1500));
});
/* KA: the ending guard judges each child with the verdict every reader gives a run (readRunOnly, then PF.appjson.judgeRun):
   a child changed right after the receipt is written, in any way a reader names, ends nothing, named by its path. */
rule('A child run changed after the receipt is written (a time, its state, its follow-ups, a conflict copy) ends nothing, named by its path', async () => {
  const cases = [
    ['created', (k) => { k.created = 'bad'; }, 'run.json'],
    ['state', (k) => { k.state = 'banana'; }, 'run.json'],
    ['a log time', (k) => { k.log = [{ at: 'bad', by: 'person-avery', what: 'x' }].concat(k.log || []); }, 'run.json'],
    ['followUps', (k) => { k.followUps = 'broken'; }, 'run.json'],
    ['a conflict copy', null, '']
  ];
  const misses = [];
  for (const [what, damage, file] of cases) {
    const app = await loopSetup(), kid = kidPaths(app)[0], dir = kid.replace(/run\.json$/, '');
    try {
      await endDamaged(app, () => {
        const k = JSON.parse(app.fs.files[kid].t);
        if (damage) { damage(k); app.fs.files[kid] = { t: JSON.stringify(k, null, 2), m: Date.now() }; } else { k.title = 'Another copy'; app.fs.files[dir + 'run-OTHER.json'] = { t: JSON.stringify(k, null, 2), m: Date.now() }; }
      });
      if (txt(app.html()).indexOf(dir + file) < 0) misses.push(what + ': not named by its path');
    } catch (e) { misses.push(what + ': ' + e.message.split('\n')[0]); }
  }
  assert.strictEqual(misses.length, 0, misses.join('\n'));
});
/* LE: every run the receipt depends on is judged before each ending-save write, as the export judges it: the runs this run's
   to-dos were done on (evidence) and the runs whose spread one of its requests fulfills, besides its loop children. */
async function withDeps() {
  const app = await setup(); await added(app, 'Post the notes');
  const PF = app.PF, T = PF.todos, base = theRun(app), r = PF.run.sanitize(JSON.parse(JSON.stringify(base)));
  const clone = (id) => { const o = JSON.parse(JSON.stringify(base)); o.id = id; delete o.living; delete o.ended; o.state = 'running'; if (Array.isArray(o.features)) o.features = o.features.filter(f => f !== 'living-runs'); app.fs.files['runs/release-notes/' + id + '/run.json'] = { t: JSON.stringify(o, null, 2), m: Date.now() }; };
  clone('evrun1'); clone('dep-1');
  const d = await PF.repo.loadAll(app.fs, {}), V = T.view(r, { records: d.todos || [], people: JSON.parse(app.fs.files['people.json'].t) });
  const td = Object.keys(V.byTodo || {})[0];
  assert.ok(td, 'set-up: a to-do');
  const ev = { plan: 'plan-ev-' + 'a'.repeat(24), run: { process: 'release-notes', id: 'evrun1' }, answer: 'Yes', result: '' };
  const q1 = T.buildProposal({ run: { process: r.process, id: r.id }, id: PF.detours.requestId(td, ev), by: 'person-avery', seen: V.heads.slice(0, 50), at: new Date().toISOString(), body: { op: 'done', todo: td, evidence: ev }, app: '4.0.0' });
  const body = { op: 'add', text: 'Covered', target: { phase: 'draft' }, placement: T.placementFor(PF.run.mapOf(r), { phase: 'draft' }), fulfills: { run: { process: 'release-notes', id: 'dep-1' }, spread: 'sp-' + 'c'.repeat(24), uid: 'jira.issue:key:ABC-1', attempt: 1 } };
  const q2 = T.buildProposal({ run: { process: r.process, id: r.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-le1', seen: [], at: new Date().toISOString(), body });
  for (const q of [q1, q2]) await app.fs.write('proposals/' + q.id + '.json', T.text(q));
  /* The evidence plan the request names, written as the app writes it: the export and the ending guard require it. */
  const one = await PF.repo.readRunOnly(app.fs, r.process, r.id);
  await app.fs.write('proposals/' + ev.plan + '.json', JSON.stringify(PF.plans.make(one.pub, { id: ev.plan, process: r.process, title: 'Evidence plan', from: r.process + '/' + r.id, by: 'person-avery', created: new Date().toISOString() }, true, '4.0.0'), null, 2) + '\n');
  await refresh(app, 400);
  app.click('open-run', r.process + '/' + r.id); await app.tick(80);
  return app;
}
/* JB: the ending guard asks the evidence plans the work names with the export's own checks (repo.depClosure): a plan
   deleted right after the receipt is written, one never in the folder, or a second copy that says something else ends
   nothing, named by its path. */
rule('An evidence plan the work names, deleted after the receipt is written, missing, or with a differing copy, ends nothing, named by its path', async () => {
  const plan = 'proposals/plan-ev-' + 'a'.repeat(24) + '.json', misses = [];
  for (const what of ['deleted after the receipt', 'never in the folder', 'a differing copy']) {
    const app = await withDeps(), fs = app.fs, write = fs.write.bind(fs), before = app.fs.files[runPath(app)].t;
    assert.ok(app.fs.files[plan], 'set-up: the plan is in the folder');
    if (what === 'never in the folder') delete app.fs.files[plan];
    if (what === 'a differing copy') { const o = JSON.parse(app.fs.files[plan].t); o.title = 'Another evidence plan'; app.fs.files[plan.replace(/\.json$/, ' (1).json')] = { t: JSON.stringify(o, null, 2) + '\n', m: Date.now() }; }
    if (what !== 'deleted after the receipt') { await refresh(app, 400); const r0 = theRun(app); app.click('open-run', r0.process + '/' + r0.id); await app.tick(80); }
    let hit = false;
    fs.write = (p, t, o) => write(p, t, o).then((x) => { if (/^proposals\/req-receipt-/.test(p) && !hit) { hit = true; if (what === 'deleted after the receipt') delete app.fs.files[plan]; } return x; });
    app.click('end', 'Cancelled'); await app.tick(400);
    fs.write = write;
    if (theRun(app).ended) misses.push(what + ': it ended');
    else if (app.fs.files[runPath(app)].t !== before) misses.push(what + ': the run changed');
    else if (txt(app.html()).indexOf(plan) < 0) misses.push(what + ': the plan isn\'t named: ' + txt(app.html()).slice(0, 400));
  }
  assert.strictEqual(misses.length, 0, misses.join('\n'));
});
rule('An evidence run or a fulfilled run changed after the receipt is written ends nothing, named by its path (with the control)', async () => {
  const misses = [];
  for (const [what, path] of [['control', ''], ['evidence run', 'runs/release-notes/evrun1/run.json'], ['fulfilled run', 'runs/release-notes/dep-1/run.json']]) {
    const app = await withDeps(), fs = app.fs, write = fs.write.bind(fs), before = app.fs.files[runPath(app)].t;
    let hit = false;
    fs.write = (p, t, o) => write(p, t, o).then((x) => { if (/^proposals\/req-receipt-/.test(p) && !hit) { hit = true; if (path) { const k = JSON.parse(app.fs.files[path].t); k.title = 42; app.fs.files[path] = { t: JSON.stringify(k, null, 2), m: Date.now() }; } } return x; });
    app.click('end', 'Cancelled'); await app.tick(400);
    fs.write = write;
    const ended = !!theRun(app).ended;
    if (!hit) misses.push(what + ': no receipt was written');
    else if (!path && !ended) misses.push('control: it didn\'t end: ' + txt(app.html()).slice(0, 600));
    else if (path && ended) misses.push(what + ': it ended');
    else if (path && (app.fs.files[runPath(app)].t !== before || txt(app.html()).indexOf(path) < 0)) misses.push(what + ': not named by its path, or the run changed');
  }
  assert.strictEqual(misses.length, 0, misses.join('\n'));
});
/* LE with the mutation corpus (test/run-corpus.js): the evidence run and the fulfilled run filled out with every record a run
   holds, then one place changed right after the receipt is written. The run ends exactly when the export's verdict on the
   changed run (repo.depVerdict) holds; otherwise it ends nothing and names the path. One case per top-level field, the first
   the export refuses, taken in turn from the two roles, with each role's control. */
const CORPUS = require('./run-corpus');
const DEP_PATHS = { evidence: 'runs/release-notes/evrun1/run.json', fulfills: 'runs/release-notes/dep-1/run.json' };
async function guardWorld(role) {
  const app = await withDeps(), path = DEP_PATHS[role], base = CORPUS.enrich(app.PF, JSON.parse(app.fs.files[path].t));
  app.fs.files[path] = { t: JSON.stringify(base, null, 2), m: Date.now() };
  return { app, path, cases: CORPUS.casesOf(base) };
}
const filesOf = (app) => { const o = {}; Object.keys(app.fs.files).forEach((p) => { o[p] = app.fs.files[p].t; }); return o; };
rule('The ending guard on the mutation corpus: a changed evidence or fulfilled run ends the run exactly when the export\'s verdict holds, else names its path', async () => {
  const picks = [], misses = [];
  for (const role of ['evidence', 'fulfills']) {
    const W = await guardWorld(role), key = W.path.split('/').slice(1, 3).join('/'), tops = new Set();
    picks.push({ role, name: 'as written', bad: null });
    for (const c of W.cases) {
      const top = c.name.split(/[.:]/)[0];
      if (tops.has(top)) continue;
      const v = await CORPUS.jsVerdict(W.app.PF, Object.assign(filesOf(W.app), { [W.path]: JSON.stringify(c.run, null, 2) }), key);
      if (v) { tops.add(top); picks.push({ role, name: c.name, bad: v }); }
    }
  }
  const byTop = {}, chosen = picks.filter((p) => p.name === 'as written');
  picks.forEach((p) => { if (p.name !== 'as written') (byTop[p.name.split(/[.:]/)[0]] = byTop[p.name.split(/[.:]/)[0]] || {})[p.role] = p; });
  Object.keys(byTop).forEach((top, i) => { const want = i % 2 ? 'fulfills' : 'evidence'; chosen.push(byTop[top][want] || byTop[top][want === 'evidence' ? 'fulfills' : 'evidence']); });
  for (const p of chosen) {
    const W = await guardWorld(p.role), c = W.cases.find((x) => x.name === p.name), fs = W.app.fs, write = fs.write.bind(fs), before = fs.files[runPath(W.app)].t;
    if (!c) { misses.push(p.role + ' · ' + p.name + ': not in this world'); continue; }
    let hit = false;
    fs.write = (q, t, o) => write(q, t, o).then((x) => { if (/^proposals\/req-receipt-/.test(q) && !hit) { hit = true; fs.files[W.path] = { t: JSON.stringify(c.run, null, 2), m: Date.now() }; } return x; });
    W.app.click('end', 'Cancelled'); await W.app.tick(400);
    fs.write = write;
    const ended = !!theRun(W.app).ended, tag = p.role + ' · ' + p.name + ': ';
    if (!hit) misses.push(tag + 'no receipt was written');
    else if (!p.bad && !ended) misses.push(tag + 'the export accepts it, but the run didn\'t end: ' + txt(W.app.html()).slice(0, 300));
    else if (p.bad && ended) misses.push(tag + 'the export refuses it at ' + p.bad.path + ', but the run ended');
    else if (p.bad && (fs.files[runPath(W.app)].t !== before || txt(W.app.html()).indexOf(p.bad.path) < 0)) misses.push(tag + 'not named by ' + p.bad.path + ', or the run changed');
  }
  assert.ok(chosen.length > 20, chosen.length + ' cases');
  assert.strictEqual(misses.length, 0, misses.length + ' of ' + chosen.length + ':\n' + misses.join('\n'));
});
/* An ended living copy of the run (its receipt in the folder) next to run.json as it was before the end. */
async function endedCopy(app, change) {
  const before = app.fs.files[runPath(app)].t;
  await end(app);
  const ended = JSON.parse(app.fs.files[runPath(app)].t), copy = runPath(app).replace('run.json', 'run-OTHER.json');
  if (change) change(ended);
  await app.fs.write(copy, JSON.stringify(ended, null, 2));
  const r0 = JSON.parse(before); r0.rev = (ended.rev || 0) + 1;
  await app.fs.write(runPath(app), JSON.stringify(r0, null, 2));
  await refresh(app, 300);
  const r = theRun(app); app.click('open-run', r.process + '/' + r.id); await app.tick(80);
  assert.ok(!theRun(app).ended && /data-act="use-copy"/.test(app.html()), 'set-up: the run is open and the ended copy is offered');
  return { copy, receipt: ended.living.receipt };
}
const late = async (app, key) => {
  const r0 = theRun(app), T = app.PF.todos;
  const f = T.buildProposal({ run: { process: r0.process, id: r0.id }, producer: { name: 'notes-bot', version: '1.0' }, key, seen: [], at: new Date().toISOString(), body: { op: 'add', text: 'Filed after the copy', target: { phase: 'review' }, placement: T.placementFor(app.PF.run.mapOf(app.PF.run.sanitize(r0)), { phase: 'review' }) } });
  await app.fs.write('proposals/' + f.id + '.json', T.text(f));
};
rule('Use copy of an ended living copy ends the run with the copy\'s receipt when it still holds (the control)', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  const c = await endedCopy(app);
  app.click('use-copy', 'run-OTHER.json'); await app.tick(400);
  const r = theRun(app);
  assert.ok(r.ended && r.living && r.living.receipt === c.receipt, JSON.stringify(r.living));
});
rule('Use copy of an ended living copy ends nothing when a request was filed after it, its receipt is gone, or it names no receipt', async () => {
  for (const what of ['late', 'gone', 'none']) {
    const app = await setup(); await added(app, 'Post the release notes');
    const c = await endedCopy(app, what === 'none' ? (o) => { delete o.living.receipt; } : null);
    if (what === 'late') await late(app, 'k-late2');
    if (what === 'gone') delete app.fs.files['proposals/' + c.receipt + '.json'];
    app.click('use-copy', 'run-OTHER.json'); await app.tick(400);
    assert.ok(!theRun(app).ended, what + ': not ended');
    assert.ok(app.fs.files[c.copy], what + ': the copy stays to keep again');
  }
});
rule('Restoring an ended living copy kept in this browser asks the receipt too: a request filed after it ends nothing', async () => {
  for (const what of ['ok', 'late']) {
    const app = await setup(); await added(app, 'Post the release notes');
    const c = await endedCopy(app), cp = JSON.parse(app.fs.files[c.copy].t);
    delete app.fs.files[c.copy]; await refresh(app, 300);
    const r0 = theRun(app); app.click('open-run', r0.process + '/' + r0.id); await app.tick(80);
    app.store['preflight:unsaved:' + app.fs.kind + ':' + (app.fs.id || app.fs.name) + ':' + cp.id] = JSON.stringify(cp);
    if (what === 'late') await late(app, 'k-late3');
    app.click('restore-local'); await app.tick(400);
    const r = theRun(app);
    if (what === 'ok') assert.ok(r.ended && r.living.receipt === c.receipt, 'ok: ended with the copy\'s receipt ' + JSON.stringify(r.living));
    else assert.ok(!r.ended, 'late: not ended');
  }
});
rule('An end whose run save fails is put back, never left for Try again: Try again saves no end', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  const fs = app.fs, write = fs.write.bind(fs);
  fs.write = (p, t, o) => /^runs\/release-notes\//.test(p) ? Promise.reject(new Error('EIO')) : write(p, t, o);
  await end(app);
  fs.write = write;
  assert.strictEqual(receipts(app).length, 1, 'set-up: the receipt was written');
  assert.ok(!theRun(app).ended, 'not ended in the folder');
  app.click('retry-save'); await app.tick(300);
  assert.ok(!theRun(app).ended, 'Try again: no end');
  await late(app, 'k-late4'); app.click('retry-save'); await app.tick(300);
  assert.ok(!theRun(app).ended, 'nor after a request filed since');
});

/* ---- IA: recovery validates the copy before touching the live run, and guards every ended living run it adopts ---- */
rule('Use copy clicked twice with the copy\'s receipt missing, damaged or unnamed ends nothing, on disk or on screen, and the copy stays', async () => {
  for (const what of ['gone', 'damaged', 'none']) {
    const app = await setup(); await added(app, 'Post the release notes');
    const c = await endedCopy(app, what === 'none' ? (o) => { delete o.living.receipt; } : null), before = app.fs.files[runPath(app)].t;
    if (what === 'gone') delete app.fs.files['proposals/' + c.receipt + '.json'];
    if (what === 'damaged') app.fs.files['proposals/' + c.receipt + '.json'] = { t: '{ "kind": "receipt"', m: Date.now() };
    if (what !== 'none') await refresh(app, 300);
    assert.ok(/data-act="finish"/.test(app.html()), what + ': set-up: the open run offers its end');
    for (let n = 1; n <= 2; n++) {
      app.click('use-copy', 'run-OTHER.json'); await app.tick(400);
      assert.strictEqual(app.fs.files[runPath(app)].t, before, what + ' ' + n + ': run.json is as it was');
      assert.ok(app.fs.files[c.copy], what + ' ' + n + ': the copy stays');
      assert.ok(/data-act="finish"/.test(app.html()), what + ' ' + n + ': on screen the run is still open');
    }
  }
});
rule('Use copy of an ended copy over a run that already ended with another outcome is refused: the outcome and the receipt stay', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  await end(app);
  const r0 = theRun(app), text0 = app.fs.files[runPath(app)].t, copy = runPath(app).replace('run.json', 'run-OTHER.json');
  const o = JSON.parse(text0); o.ended.outcome = 'Stopped early'; o.state = 'stopped'; o.rev = (o.rev || 0);
  await app.fs.write(copy, JSON.stringify(o, null, 2));
  const r1 = JSON.parse(text0); r1.rev = (r1.rev || 0) + 1; await app.fs.write(runPath(app), JSON.stringify(r1, null, 2));
  const before = app.fs.files[runPath(app)].t;
  await refresh(app, 300); app.click('open-run', r0.process + '/' + r0.id); await app.tick(80);
  for (let n = 1; n <= 2; n++) {
    app.click('use-copy', 'run-OTHER.json'); await app.tick(400);
    assert.strictEqual(app.fs.files[runPath(app)].t, before, n + ': run.json is as it was');
    assert.strictEqual(theRun(app).ended.outcome, 'Cancelled', n + ': the outcome stays');
    assert.ok(app.fs.files[copy], n + ': the copy stays');
  }
});
/* TF: the counts now beside an ended living run's frozen lines come from the same comparison rules (PF.receipts.compare), so
   with nothing changed after the end they read exactly as the frozen lines do. */
rule('With nothing changed after the end, the counts now read exactly as the receipt\'s frozen lines: one set of rules for both', async () => {
  const app = await loopSetup();
  app.click('end', 'Cancelled'); await app.tick(400);
  const r = pRun(app), rec = JSON.parse(app.fs.files['proposals/' + r.living.receipt + '.json'].t);
  const frozen = app.PF.receipts.words(rec.counts, rec.coverage).lines;
  app.click('open-run', r.process + '/' + r.id); await app.tick(120);
  const m = /<p class="small rw-now">([\s\S]*?)<\/p>/.exec(app.html());
  assert.ok(m, 'the counts now are shown');
  assert.strictEqual(txt(m[1]).trim(), 'Counted now, after the end: ' + frozen.join(' · '));
});/* WA: keeping an ended copy asks the shared receipt verdict first: a copy ended by another person than its receipt names
   ends nothing, and the copy stays. */
rule('Use copy of an ended living copy whose ended.by isn\'t its receipt\'s by ends nothing, and the copy stays', async () => {
  const app = await setup(); await added(app, 'Post the release notes');
  const c = await endedCopy(app, (o) => { o.ended.by = o.ended.by === 'person-blake' ? 'person-avery' : 'person-blake'; });
  app.click('use-copy', 'run-OTHER.json'); await app.tick(400);
  assert.ok(!theRun(app).ended, 'not ended: ' + JSON.stringify(theRun(app).ended));
  assert.ok(app.fs.files[c.copy], 'the copy stays to keep again');
});
/* CA: the receipt guard asks the shared verdict on the run as it would end, on every fresh read before each write of the
   save that ends it (recovery included): a copy under the receipt's id that can't be read (it names another run) or that is
   another kind of record, filed after the receipt or after any later write of that save, ends nothing. */
const caCopy = (app, rid, what) => {
  const T = app.PF.todos, r0 = theRun(app), name = 'proposals/' + rid + ' (1).json';
  if (what === 'a plan-family copy') return [name, '{"format":"flightdeck-plan/2"}\n'];
  if (what === 'a scope-family copy') return [name, '{"format":"flightdeck-plan/3","features":["loops"]}\n'];
  /* EA: a copy that reads whole as another record (a plan of another id, a plan decision) is grouped under the id too. */
  if (what === 'a valid plan of another id') return [name, JSON.stringify({ kind: 'plan', id: 'plan-other', process: r0.process }, null, 2) + '\n'];
  if (what === 'a valid plan decision') return [name, JSON.stringify({ kind: 'status', proposal: 'plan-other', proposalHash: 'x', status: 'declined', run: null, by: 'person-avery', at: '2026-11-09T09:00:00.000Z' }, null, 2) + '\n'];
  if (what === 'unreadable copy') { const o = JSON.parse(app.fs.files['proposals/' + rid + '.json'].t); o.run.id = 'someone-else'; return [name, JSON.stringify(o, null, 2) + '\n']; }
  const q = T.buildProposal({ run: { process: r0.process, id: 'someone-else' }, id: rid, by: 'person-avery', seen: [], at: new Date().toISOString(), body: { op: 'add', text: 'Another kind', target: { phase: 'review' }, placement: T.placementFor(app.PF.run.mapOf(app.PF.run.sanitize(r0)), { phase: 'review' }) }, app: '4.0.0' });
  return [name, T.text(q)];
};
const CA_STAGES = [['after the receipt', /^proposals\/req-receipt-[0-9a-f]{24}\.json$/], ['after the candidate', /\/candidate-/], ['after the history', /\/history/]];
rule('A copy under the receipt\'s id that can\'t be read, or is another kind of record, filed at any write of the save that ends the run ends nothing', async () => {
  for (const what of ['unreadable copy', 'another kind', 'a plan-family copy', 'a scope-family copy', 'a valid plan of another id', 'a valid plan decision']) {
    for (const [when, at] of CA_STAGES) {
      const app = await setup(); await added(app, 'Post the release notes');
      const fs = app.fs, write = fs.write.bind(fs), runText = app.fs.files[runPath(app)].t;
      let hit = false;
      fs.write = (p, t, o) => write(p, t, o).then((x) => {
        if (!hit && at.test(p)) { hit = true; const rid = receipts(app)[0].replace(/^proposals\//, '').replace(/\.json$/, ''), [n, body] = caCopy(app, rid, what); return write(n, body).then(() => x); }
        return x;
      });
      await end(app);
      fs.write = write;
      if (!hit) { assert.ok(when !== 'after the receipt', what + ' ' + when + ': the receipt was written'); continue; }
      assert.ok(!theRun(app).ended, what + ' ' + when + ': not ended');
      assert.strictEqual(app.fs.files[runPath(app)].t, runText, what + ' ' + when + ': the run is as it was');
    }
  }
});
rule('Use copy of an ended living copy ends nothing when a copy under its receipt\'s id can\'t be read or is another kind of record, and the copy stays', async () => {
  for (const what of ['unreadable copy', 'another kind', 'a plan-family copy', 'a scope-family copy', 'a valid plan of another id', 'a valid plan decision']) {
    const app = await setup(); await added(app, 'Post the release notes');
    const c = await endedCopy(app), before = app.fs.files[runPath(app)].t;
    /* Filed after this window read the folder: only the guard's fresh read before the save's writes sees it. */
    const [n, body] = caCopy(app, c.receipt, what); app.fs.files[n] = { t: body, m: Date.now() };
    app.click('use-copy', 'run-OTHER.json'); await app.tick(400);
    assert.ok(!theRun(app).ended, what + ': not ended');
    assert.strictEqual(app.fs.files[runPath(app)].t, before, what + ': run.json is as it was');
    assert.ok(app.fs.files[c.copy], what + ': the copy stays to keep again');
  }
});
/* NA: what each ending guard saw is held per parent across the whole dependency closure, not only the root's children: a
   grandchild (release-readiness -> validate-story -> validate-task) read by one guard and gone by a later one ends nothing,
   named by its path, in an end and in Use copy, and Use copy keeps the copy. */
const TASK = KID.replace('process: validate-story', 'process: validate-task').replace('title: Validate a story', 'title: Validate a task');
const KID3 = KID.replace('## Assess · DO-CONFIRM {#assess}\n', ['## Assess · DO-CONFIRM {#assess}', '- [!] {for.each} Validate every part {#eachpart}', '  process: validate-task', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', ''].join('\n'));
const taskPaths = (app) => app.files('runs/validate-task/').filter(p => /run\.json$/.test(p));
async function nestedSetup() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '4.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(TASK, 'validate-task', 'vt000001'); put(KID3, 'validate-story', 'vs000001'); put(PARENT, 'release-readiness', 'rr000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  await addStories(app, 'ABC-101');
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  assert.strictEqual(kidPaths(app).length, 1, 'set-up: one story run');
  const story = JSON.parse(app.fs.files[kidPaths(app)[0]].t);
  app.click('open-run', story.process + '/' + story.id); await app.tick(80);
  app.click('select', 'eachpart'); await app.tick(80);
  app.set('loop-add-eachpart', 'ABC-201'); app.click('loop-add', 'eachpart'); await app.tick(150);
  app.click('loop-start', 'eachpart', { item: 'ABC-201' }); await app.tick(150);
  assert.strictEqual(taskPaths(app).length, 1, 'set-up: one task run under the story: ' + JSON.stringify(app.files('runs/')));
  const r = pRun(app); app.click('open-run', r.process + '/' + r.id); await app.tick(80);
  app.set('td-add', 'Post the release notes'); app.click('td-add'); await app.tick(120); await refresh(app, 400);
  assert.ok(pRun(app).living, 'set-up: the parent is living');
  return app;
}
/* Deletes the grandchild's folder when the parent's run.json gets its candidate (after the receipt, so a later guard reads). */
function dropAtCandidate(app, pp) {
  const fs = app.fs, write = fs.write.bind(fs), task = taskPaths(app)[0], dir = task.replace(/run\.json$/, '');
  const st = { gone: false, task };
  fs.write = (p, t, o) => write(p, t, o).then((x) => {
    if (!st.gone && p.indexOf(pp.replace(/run\.json$/, '') + 'candidate-') === 0) { st.gone = true; app.files(dir).forEach((f) => { delete app.fs.files[f]; }); }
    return x;
  });
  st.restore = () => { fs.write = write; };
  return st;
}
rule('A grandchild seen by one ending guard and gone by a later one ends nothing, named by its path', async () => {
  const app = await nestedSetup(), pp = pPath(app), runText = app.fs.files[pp].t;
  const st = dropAtCandidate(app, pp);
  app.click('end', 'Cancelled'); await app.tick(600);
  st.restore();
  assert.ok(st.gone, 'the save reached its candidate write, so the later guard is what refuses');
  assert.ok(!pRun(app).ended, 'not ended: ' + JSON.stringify(pRun(app).living));
  assert.strictEqual(app.fs.files[pp].t, runText, 'the run is as it was');
  assert.ok(txt(app.html()).indexOf(st.task) >= 0, 'named by its path: ' + txt(app.html()).slice(0, 600));
});
rule('Use copy with a grandchild gone between its guards ends nothing, names it, and keeps the copy', async () => {
  const app = await nestedSetup(), pp = pPath(app), before = app.fs.files[pp].t;
  app.click('end', 'Cancelled'); await app.tick(500);
  assert.ok(pRun(app).ended, 'set-up: the parent ended');
  const ended = JSON.parse(app.fs.files[pp].t), copy = pp.replace('run.json', 'run-OTHER.json');
  await app.fs.write(copy, JSON.stringify(ended, null, 2));
  const r0 = JSON.parse(before); r0.rev = (ended.rev || 0) + 1;
  await app.fs.write(pp, JSON.stringify(r0, null, 2));
  await refresh(app, 300);
  app.click('open-run', r0.process + '/' + r0.id); await app.tick(80);
  assert.ok(!pRun(app).ended && /data-act="use-copy"/.test(app.html()), 'set-up: the ended copy is offered');
  const runText = app.fs.files[pp].t, st = dropAtCandidate(app, pp);
  app.click('use-copy', 'run-OTHER.json'); await app.tick(600);
  st.restore();
  assert.ok(st.gone, 'the recovery reached its candidate write');
  assert.ok(!pRun(app).ended, 'not ended: ' + JSON.stringify(pRun(app).living));
  assert.strictEqual(app.fs.files[pp].t, runText, 'the run is as it was');
  assert.ok(app.fs.files[copy], 'the copy stays');
  assert.ok(txt(app.html()).indexOf(st.task) >= 0, 'named by its path: ' + txt(app.html()).slice(0, 600));
});
/* OE: the children this window already holds are seeded into what the ending guards hold, at every depth: a grandchild
   loaded before the end and gone from every listing the end makes ends nothing, named by its path, in an end and in Use
   copy, and Use copy keeps the copy. */
const dropTask = (app) => { const task = taskPaths(app)[0], dir = task.replace(/run\.json$/, ''); app.files(dir).forEach((f) => { delete app.fs.files[f]; }); return task; };
rule('A grandchild this window loaded and gone before every ending guard\'s listing ends nothing, named by its path', async () => {
  const app = await nestedSetup(), pp = pPath(app), runText = app.fs.files[pp].t;
  const task = dropTask(app);
  app.click('end', 'Cancelled'); await app.tick(600);
  assert.ok(!pRun(app).ended, 'not ended: ' + JSON.stringify(pRun(app).living));
  assert.strictEqual(app.fs.files[pp].t, runText, 'the run is as it was');
  assert.ok(txt(app.html()).indexOf(task) >= 0, 'named by its path: ' + txt(app.html()).slice(0, 600));
});
rule('Use copy with a loaded grandchild gone before every guard\'s listing ends nothing, names it, and keeps the copy', async () => {
  const app = await nestedSetup(), pp = pPath(app), before = app.fs.files[pp].t;
  app.click('end', 'Cancelled'); await app.tick(500);
  assert.ok(pRun(app).ended, 'set-up: the parent ended');
  const ended = JSON.parse(app.fs.files[pp].t), copy = pp.replace('run.json', 'run-OTHER.json');
  await app.fs.write(copy, JSON.stringify(ended, null, 2));
  const r0 = JSON.parse(before); r0.rev = (ended.rev || 0) + 1;
  await app.fs.write(pp, JSON.stringify(r0, null, 2));
  await refresh(app, 300);
  app.click('open-run', r0.process + '/' + r0.id); await app.tick(80);
  assert.ok(!pRun(app).ended && /data-act="use-copy"/.test(app.html()), 'set-up: the ended copy is offered');
  assert.ok(taskPaths(app).length === 1, 'set-up: the grandchild is loaded');
  const runText = app.fs.files[pp].t, task = dropTask(app);
  app.click('use-copy', 'run-OTHER.json'); await app.tick(600);
  assert.ok(!pRun(app).ended, 'not ended: ' + JSON.stringify(pRun(app).living));
  assert.strictEqual(app.fs.files[pp].t, runText, 'the run is as it was');
  assert.ok(app.fs.files[copy], 'the copy stays');
  assert.ok(txt(app.html()).indexOf(task) >= 0, 'named by its path: ' + txt(app.html()).slice(0, 600));
});
run();
