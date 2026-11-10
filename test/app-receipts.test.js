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

rule('A child run that can\'t be read, or its version, right after the receipt is written ends nothing', async () => {
  for (const what of ['run', 'version']) {
    const app = await loopSetup(), kid = kidPaths(app)[0], k = JSON.parse(app.fs.files[kid].t);
    const map = app.files('publications/validate-story/').find(p => p.indexOf('/' + k.folder + '/map.md') >= 0);
    assert.ok(map, 'set-up: the child\'s version');
    await endDamaged(app, () => { if (what === 'run') app.fs.files[kid] = { t: '{ not json', m: Date.now() }; else app.fs.files[map] = { t: app.fs.files[map].t + '\nchanged', m: Date.now() }; });
  }
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

run();
