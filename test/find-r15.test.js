// Find things in big folders (2.11), code review round 15: the Start form's role state (what each role started as, and what
// the form changed) belongs to the folder and the drawing of the form it was made on, and a one-off Done differently row has
// a list key and a row id no correction note can have, whatever its id.
'use strict';
const assert = require('assert');
const { loadViews, rule, run } = require('./harness');
const { boot, folderHandle, memoryIDB } = require('./app-harness');
const { small, fresh, more, moreOf, arrive, iso } = require('./find-twins.test');

const PLAN = 'plan-release-2026-10-24', PLAN_FILE = 'proposals/' + PLAN + '.json';
const selOf = (h, role) => { const m = new RegExp('<select id="role-' + role + '"[^>]*>([\\s\\S]*?)</select>').exec(h); return m ? (/<option value="([^"]+)" selected>/.exec(m[1]) || [])[1] || '' : null; };
/* The runs a folder holds that this plan started, by their run.json. */
const startedFrom = files => Object.keys(files).filter(p => /^runs\/release\/[^/]+\/run\.json$/.test(p)).map(p => JSON.parse(typeof files[p] === 'string' ? files[p] : files[p].t)).filter(r => r.from && r.from.plan === PLAN || r.plan === PLAN || (r.title || '') === 'Release 2026.10.24');
async function reviewPlan(app) {
  app.click('nav', 'runs'); await app.tick(10);
  app.click('review-plan', PLAN); await app.tick(20);
  assert.ok(/<form[^>]*id="start-form"/.test(app.html()), 'set-up: the plan\'s Start form');
}

/* ---------- 1. role state is the folder's and the form's ---------- */
rule('Round 15: the plan changed during an input method composition: Start refuses, the form shows the new plan, and starting again saves the new plan\'s roles', async () => {
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  await reviewPlan(app);
  assert.strictEqual(selOf(app.html(), 'qa'), 'person-morgan', 'set-up: QA is Morgan, as the plan has it');
  assert.strictEqual(selOf(app.html(), 'release-lead'), 'person-blake', 'set-up: the lead is Blake');
  /* Someone changes the plan while an input method is composing in the run name: the form isn't redrawn, so Start is sent
     from the form as drawn before the change (its plan hash), as the harness's submitForm(id, dataset) stands in for. */
  const drawnHash = /data-plan-hash="([^"]*)"/.exec(app.html())[1];
  const plan = JSON.parse(app.fs.files[PLAN_FILE].t);
  plan.roles = Object.assign({}, plan.roles, { qa: 'person-casey', 'release-lead': 'person-morgan' });
  await app.fs.write(PLAN_FILE, JSON.stringify(plan, null, 2));
  for (let k = 0; k < 2; k++) {
    const was = app.PF.perf.n['load.done'] || 0;
    app.click('refresh');
    for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  }
  await app.tick(20);
  assert.notStrictEqual(/data-plan-hash="([^"]*)"/.exec(app.html())[1], drawnHash, 'set-up: the folder now has the changed plan');
  app.submitForm('start-form', { planHash: drawnHash }); await app.tick(40);
  assert.ok(/changed this plan while you were reviewing it/.test(app.html() + app.live()), 'Start refused: the plan changed');
  assert.strictEqual(startedFrom(app.fs.files).length, 0, 'nothing started');
  const h = app.html();
  assert.strictEqual(selOf(h, 'qa'), 'person-casey', 'the form shows the new plan\'s QA');
  assert.strictEqual(selOf(h, 'release-lead'), 'person-morgan', 'and its lead');
  app.chooseApprovers().submitForm('start-form'); await app.tick(160);
  const runs = startedFrom(app.fs.files);
  assert.strictEqual(runs.length, 1, 'the retry starts the run');
  assert.strictEqual(runs[0].roles.qa, 'person-casey', 'with the new plan\'s QA');
  assert.strictEqual(runs[0].roles['release-lead'], 'person-morgan', 'and its lead');
});

/* A team folder this browser remembers but must ask again to use: the examples open first, and Reconnect switches to it in
   place, on the screen you're on (as test/app.test.js). */
async function rememberedFolder(files) {
  const dir = folderHandle('Team', files), idb = memoryIDB();
  dir.queryPermission = () => Promise.resolve('prompt');
  await new Promise(res => { const q = idb.open(); q.onsuccess = () => { const tx = q.result.transaction(); tx.oncomplete = res; tx.objectStore().put({ dir, id: 'team-1' }, 'folder'); }; });
  return idb;
}
rule('Round 15: Reconnect from the examples to a team folder with the same checklist version and plan, its roles different: the Start form shows the team folder\'s and starts with them', async () => {
  const files = {};
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true, indexedDB: await rememberedFolder(files), picker: folderHandle('Other', {}) }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  /* The team folder holds the examples' very files, but its copy of the plan gives QA and the lead to others. */
  Object.keys(app.fs.files).forEach(p => { const t = app.fs.files[p].t; if (!/^data:/.test(t)) files[p] = t; });
  const plan = JSON.parse(files[PLAN_FILE]);
  plan.roles = Object.assign({}, plan.roles, { qa: 'person-casey', 'release-lead': 'person-morgan' });
  files[PLAN_FILE] = JSON.stringify(plan, null, 2);
  await reviewPlan(app);
  assert.strictEqual(selOf(app.html(), 'qa'), 'person-morgan', 'set-up: in the examples, QA is Morgan');
  /* In the examples, the backend role is changed on the form. */
  app.select('role-backend', 'person-blake'); await app.tick(5);
  app.click('reconnect'); await app.tick(200);
  let h = app.html();
  assert.ok(/<form[^>]*id="start-form"/.test(h), 'set-up: still on the plan\'s Start form, now the team folder\'s');
  assert.strictEqual(selOf(h, 'qa'), 'person-casey', 'QA is the team folder\'s plan\'s');
  assert.strictEqual(selOf(h, 'release-lead'), 'person-morgan', 'and so is the lead');
  assert.strictEqual(selOf(h, 'backend'), plan.roles.backend, 'a change made in the examples isn\'t carried over');
  app.chooseApprovers().submitForm('start-form'); await app.tick(200);
  const runs = startedFrom(files);
  assert.strictEqual(runs.length, 1, 'the run starts in the team folder');
  assert.strictEqual(runs[0].roles.qa, 'person-casey', 'with the team folder\'s QA');
  assert.strictEqual(runs[0].roles['release-lead'], 'person-morgan', 'its lead');
  assert.strictEqual(runs[0].roles.backend, plan.roles.backend, 'and its backend, not the examples\' change');
});

/* ---------- 2. a one-off row's key and id are its own ---------- */
/* The landed run's step s0 with n corrections from another computer, the first with the id diff-s0 (what a one-off row on
   s0 was keyed by), then a Done differently answer with no correction: the one-off, newest on the step, after all n. */
async function collide(n) {
  const app = await fresh(), key = small().facts.landed, dir = 'runs/' + key + '/';
  const rj = JSON.parse(app.fs.files[dir + 'run.json'].t), map = app.PF.run.mapOf(rj), C = app.PF.corrections, t0 = Date.parse(rj.created);
  const have = C.forRun(rj, map, { at: true }).filter(c => c.step === 's0').length;
  const mk = (i, id) => C.build({ id, at: iso(t0 + 60000 + i * 1000), by: 'person-blake', session: 'other', map, version: +rj.version, folder: rj.folder, step: 's0', op: 'wording', to: 'worded ' + i, why: 'reason ' + i });
  const notes = Array.from({ length: n - have }, (x, i) => mk(i, i ? 'pre' + i : 'diff-s0'));
  await arrive(app, [[dir + 'notes-pre.jsonl', notes]]);
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', key); await app.tick(10);
  for (const act of ['pickup', 'takeover']) if (new RegExp('data-act="' + act + '"').test(app.html())) { app.click(act); await app.tick(40); }
  app.click('select', 's0'); await app.tick(10);
  app.click('corr-open', 's0', { mode: 'differently' }); await app.tick();
  app.input('corr-happened', 'Did it by hand'); app.click('corr-done', 's0'); await app.tick(120);
  app.click('select', 's0'); await app.tick(10);
  return { app, key };
}
/* A correction row's whole markup, to its </li>. */
const rowOf = (h, id) => { const i = h.indexOf('<li class="corr" id="' + id + '"'); return i < 0 ? '' : h.slice(i, h.indexOf('</li>', i)); };
const corrRows = h => [...h.matchAll(/<li class="corr" id="([^"]+)"/g)].map(m => m[1]);
/* Every Show more of the list, until it has none: the one-off is then drawn, under its own row id, with its own answer. */
async function reach(app, list, what) {
  for (let i = 0; i < 20 && moreOf(app.html(), list); i++) await more(app, list);
  const h = app.html();
  assert.ok(corrRows(h).indexOf('corr-#off-s0') >= 0, what + ': the one-off is reachable: ' + corrRows(h).length + ' rows, ' + corrRows(h).slice(-3).join(' '));
  assert.ok(rowOf(h, 'corr-#off-s0').indexOf('Did it by hand') >= 0, what + ': with its own answer');
  assert.ok(rowOf(h, 'corr-diff-s0').indexOf('reason 0') >= 0, what + ': and the note diff-s0 is drawn as itself');
  assert.strictEqual(new Set(corrRows(h)).size, corrRows(h).length, what + ': no two rows share an id');
  app.node('[id="corr-#off-s0"]').focus(); await app.tick(5);
  assert.strictEqual(app.activeId(), 'corr-#off-s0', what + ': and takes focus');
}
rule('Round 15: a correction note with the id diff-s0 and 20 corrections before step s0\'s one-off answer: the inspector offers Show more, and the one-off is drawn with its own row id', async () => {
  const { app, key } = await collide(20);
  assert.ok(/Corrections · 21</.test(app.html()), 'set-up: 21 corrections on s0, the 20 and the one-off');
  await reach(app, 'rcorr:' + key + ':s0', 'the inspector');
});
rule('Round 15: a correction note with the id diff-s0 and 50 corrections before the one-off: Finish and Receipt offer Show more, and the one-off is drawn with its own row id', async () => {
  const { app, key } = await collide(50);
  for (const [page, list] of [['finish', 'fin-corr:' + key], ['receipt', 'rcpt-corr:' + key]]) {
    app.click(page); await app.tick(10);
    await reach(app, list, page);
    if (page === 'finish') { app.click('exit-mission'); await app.tick(10); }
  }
});

/* Every id a note can have, as the list keys and row ids they make: one-offs on every step never share one with a note. */
rule('Round 15: a one-off row\'s list key and row id are never a note\'s, whatever the note\'s id (diff-<step>, #off-<step>, escaped, empty), and each focus selector finds its own row', () => {
  const PF = loadViews(), V = PF.views;
  const ids = ['diff-s0', 'diff-s1', '#off-s0', '\\#off-s0', '#off-', '', 'corr-diff-s0', 'off-s0', '#1', 'diff-s0#2'];
  const notes = [];
  ids.forEach(id => { for (let n = 1; n <= 3; n++) notes.push({ id, step: 's0', noteAt: n, oneOff: false }); });
  const offs = ['s0', 's1', ''].map(step => ({ id: 'diff-' + step, step, oneOff: true }));
  const items = V.corrItems(notes.concat(offs));
  const keys = items.map(x => x.k), doms = items.map(x => x.dom);
  assert.strictEqual(new Set(keys).size, keys.length, 'no two rows share a list key: ' + keys.join(' | '));
  assert.strictEqual(new Set(doms).size, doms.length, 'no two rows share a row id: ' + doms.join(' | '));
  items.forEach(x => assert.strictEqual(V.corrFocus(x.k), PF.vk.byId(x.dom), 'the focus selector of ' + JSON.stringify(x.k) + ' is its own row\'s'));
  /* A note's row id is what 2.10 drew for it (corr-<id> for the first note with that id). */
  assert.strictEqual(items[0].dom, 'corr-diff-s0');
});

run();
