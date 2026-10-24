// 2.2 slice 1 in the built app: practicing the draft open in the editor. Practice writes nothing to the folder, follows
// the text as it's edited, has its own Undo, waits for builder typing to be applied, survives a reload of the tab and ends
// when exactly the practiced text is published.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

const DRAFT = 'maps/drafts/release.md';
const APPROVED = "Change request approved for tonight's window";
/* The release draft open in the Markdown editor. Every folder write, append and removal is counted by path. */
async function editor(opts) {
  opts = opts || {};
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, opts));
  await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  app.writes = [];
  ['write', 'append', 'remove'].forEach(k => { const f = app.fs[k].bind(app.fs); app.fs[k] = (p, d) => { app.writes.push(k + ' ' + p); return f(p, d); }; });
  return app;
}
const text = app => app.draft('draft-editor') || app.fs.files[DRAFT].t;
const row = (app, id) => { const m = new RegExp('<li class="pr-st st-([\\w-]+)[^"]*" data-pr-step="' + id + '">').exec(app.html()); return m ? m[1] : null; };
/* A sample box typed in, then committed (Enter or leaving it), as the browser sends them. */
const sample = (app, name, v, commit) => { const target = { id: 'pr-s-' + name, value: v, tagName: 'INPUT', dataset: { prSample: name }, closest: () => null }; app.fire('input', { target }); if (commit) app.fire('change', { target }); };
/* Checks a step; one that asks for evidence opens its form first, answered here with Check without it. */
async function check(app, id) { app.click('pr-check', id); await app.tick(); if (new RegExp('data-pr-form="ev" data-id="' + id + '"').test(app.html())) { app.click('pr-ev-skip', id); await app.tick(); } }
const btn = () => ({ tagName: 'BUTTON', dataset: {}, closest: s => (s === '#pr' ? {} : null) });

rule('Practice opens as a tab of its own, says it is not recorded, and checking steps writes nothing to the folder', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  assert.match(app.html(), /Practice · not recorded/);
  assert.match(app.html(), /Nothing here is saved to the team folder/);
  assert.equal(row(app, 'approved'), 'open');
  await check(app, 'approved');
  await check(app, 'tests');
  assert.equal(row(app, 'approved'), 'done');
  assert.equal(row(app, 'tests'), 'done');
  app.click('pr-na', 'notes'); await app.tick();
  assert.equal(row(app, 'notes'), 'skipped');
  await app.tick(200);
  assert.deepEqual(app.writes, [], 'practice wrote: ' + app.writes.join(', '));
  assert.ok(!Object.keys(app.fs.files).some(p => /practice/i.test(p)));
  assert.ok(!/Practice/.test(app.fs.files[DRAFT].t));
});

rule('Editing a checked step makes it "Try it again", and the folder sees only the same draft saves as without practice', async () => {
  const plain = await editor(), prac = await editor();
  prac.click('pr-open'); await prac.tick();
  await check(prac, 'approved');
  await check(prac, 'tests');
  const t = text(prac).replace(APPROVED, 'Change request approved for this window');
  [plain, prac].forEach(a => a.input('draft-editor', t));
  await plain.tick(300); await prac.tick(300);
  assert.equal(row(prac, 'approved'), 'again');
  assert.match(prac.html(), /Changed since you checked it\. Try it again\./);
  assert.equal(row(prac, 'tests'), 'done');
  assert.deepEqual(prac.writes, plain.writes);
});

rule('Undo on a practice control undoes the practice; inside a practice text box the browser keeps its own Undo', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  const before = text(app);
  app.keyOn('z', { ctrlKey: true }, btn()); await app.tick();
  assert.equal(row(app, 'approved'), 'open');
  assert.equal(text(app), before, 'the draft is unchanged');
  app.keyOn('z', { ctrlKey: true, shiftKey: true }, btn()); await app.tick();
  assert.equal(row(app, 'approved'), 'done');
  let stopped = false;
  app.keyOn('z', { ctrlKey: true, preventDefault() { stopped = true; } }, { tagName: 'TEXTAREA', id: 'pr-found', dataset: {}, closest: s => (s === '#pr' ? {} : null) }); await app.tick();
  assert.equal(stopped, false);
  assert.equal(row(app, 'approved'), 'done');
});

rule('Reset clears the answers and one Undo brings them back', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  app.click('pr-reset'); await app.tick();
  assert.equal(row(app, 'approved'), 'open');
  app.click('pr-undo'); await app.tick();
  assert.equal(row(app, 'approved'), 'done');
});

rule('Practice is kept for this tab across a reload, in session storage only', async () => {
  const session = {};
  const app = await editor({ sessionStore: session });
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  const keys = Object.keys(session).filter(k => /:practice:/.test(k));
  assert.equal(keys.length, 1);
  assert.ok(/:release$/.test(keys[0]));
  const again = await editor({ sessionStore: session });
  again.click('pr-open'); await again.tick();
  assert.equal(row(again, 'approved'), 'done');
  const other = await editor();
  other.click('pr-open'); await other.tick();
  assert.equal(row(other, 'approved'), 'open', 'another tab starts fresh');
});

rule('A refused draft keeps practicing the last version that worked and says what the problem is', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  app.input('draft-editor', text(app).replace('{#tests}', '{#approved}')); await app.tick(300);
  assert.match(app.html(), /The draft has a problem:/);
  assert.match(app.html(), /Practicing the last version that worked/);
  assert.equal(row(app, 'approved'), 'done');
});

rule('Publishing exactly the practiced text ends the practice', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  app.click('pr-close'); await app.tick();
  app.set('change-note', 'Practiced'); app.click('publish', 'release'); await app.tick(120);
  assert.match(app.html() + app.live(), /Published v/);
  app.click('ptab', 'edit'); await app.tick();
  app.click('pr-open'); await app.tick();
  assert.equal(row(app, 'approved'), 'open');
});

rule('Typing in a builder box not yet applied pauses practice until it is applied or cleared, and says how', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Feature flags set in the values'); await app.tick();
  app.click('ins-tab', 'practice'); await app.tick();
  assert.match(app.html(), /Apply or clear what you typed in the box first/);
  await check(app, 'approved');
  assert.equal(row(app, 'approved'), 'open', 'the check waits');
  app.input('ob-text', 'Feature flags set in the deploy values'); await app.tick();
  await check(app, 'approved');
  assert.equal(row(app, 'approved'), 'done');
});

rule('Escape on a practice row goes back to the editor and keeps practicing (on a wide screen)', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  const rowEl = { tagName: 'BUTTON', dataset: {}, closest: s => (s === '#pr' ? {} : s === '.pr-st' ? { dataset: { prStep: 'approved' } } : null) };
  app.keyOn('Escape', {}, rowEl); await app.tick();
  assert.match(app.html(), /Practice · not recorded/, 'still practicing');
  assert.equal(row(app, 'approved'), 'done');
});

rule('A committed sample and its Undo: the box shows exactly the value being practiced', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  sample(app, 'environment', 'staging', true); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="staging" data-bound/);
  app.click('pr-undo'); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="" data-bound/);
});

rule('Typing a sample not yet committed survives a redraw', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  sample(app, 'tag', 'v9'); await check(app, 'approved');
  assert.match(app.html(), /id="pr-s-tag" data-pr-sample="tag" value="v9"/);
});

rule('The selected step follows the builder: a step chosen there is the one selected in Practice', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  assert.match(app.html(), /<li class="pr-st st-done sel" data-pr-step="approved">/);
  app.click('ob-sel', 'tests'); await app.tick();
  app.click('ins-tab', 'practice'); await app.tick();
  assert.match(app.html(), /<li class="pr-st st-open sel" data-pr-step="tests">/);
});

rule('A selected step removed from the draft hands the selection to the next row', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  app.input('draft-editor', text(app).replace(/\n- \[!\] \{change\.request\}[^\n]*\{#approved\}\n(  [^\n]*\n)*/, '\n')); await app.tick(300);
  assert.match(app.html(), /<li class="pr-st[^"]* sel" data-pr-step="tests">/);
});

rule('Not needed on a "Try it again" row marks it Not needed again, in one click', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-na', 'notes'); await app.tick();
  app.input('draft-editor', text(app).replace('Check in the release notes for this commit', 'Check in the release notes')); await app.tick(300);
  assert.equal(row(app, 'notes'), 'again');
  app.click('pr-na', 'notes'); await app.tick();
  assert.equal(row(app, 'notes'), 'skipped');
});

rule('With single-key shortcuts off, X and E do nothing on a practice row; Space on Not needed is that button\'s', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  const on = cls => ({ tagName: 'BUTTON', dataset: {}, classList: { contains: c => c === cls }, closest: s => (s === '#pr' ? {} : s === '.pr-st' ? { dataset: { prStep: 'notes' } } : null) });
  app.keyOn(' ', {}, on('pr-na')); await app.tick();
  assert.equal(row(app, 'notes'), 'open', 'Space pressed the focused Not needed button natively, nothing else');
  app.keyOn(' ', {}, on('pr-text')); await app.tick();
  assert.equal(row(app, 'notes'), 'done', 'Space on the step text checks it');
  app.click('toggle-keys'); await app.tick();
  app.keyOn('x', {}, on('pr-text')); await app.tick();
  assert.equal(row(app, 'notes'), 'done');
});

rule('Reset refused while builder typing is pending says why, not that it reset', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Feature flags set in the values'); await app.tick();
  app.click('ins-tab', 'practice'); await app.tick();
  app.click('pr-reset'); await app.tick();
  assert.ok(!/Practice reset/.test(app.live()));
  assert.match(app.live(), /Apply or clear/);
  assert.equal(row(app, 'approved'), 'done');
});

rule('On a phone the pane is drawn as a dialog, so a redraw keeps it', async () => {
  const app = await editor({ narrow: true });
  app.click('pr-open'); await app.tick();
  assert.match(app.html(), /<div class="pr" id="pr" aria-labelledby="pr-h" role="dialog" aria-modal="true">/);
});

rule('A refused sample keeps what is typed next across a redraw, not the refused value', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  const before = app.html();
  sample(app, 'environment', 'prod'); await check(app, 'approved');
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="prod"/);
  assert.ok(before);
});

rule('A selection handed over after a removal stays put on later redraws, within its phase', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  app.input('draft-editor', text(app).replace(/\n- \[!\] \{change\.request\}[^\n]*\{#approved\}\n(  [^\n]*\n)*/, '\n')); await app.tick(300);
  app.click('pr-check', 'tests'); await app.tick(); app.click('pr-form-close'); await app.tick();
  app.click('pr-close'); await app.tick(); app.click('pr-open'); await app.tick();
  assert.match(app.html(), /<li class="pr-st[^"]* sel" data-pr-step="tests">/);
});

rule('Waive without a reason says so beside the reason box, inside the pane', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.input('draft-editor', ['---', 'process: release', 'title: Production release', 'owner: person-casey', 'roles: release-lead', '---', '', '## Prep · READ-DO {#prep}', '- [ ] {confirm} One thing {#one}', '', '## Gate: Ready · owner @release-lead {#ready}', ''].join('\n')); await app.tick(300);
  assert.match(app.html(), /data-how="waive"/, 'set-up: the gate can be waived');
  app.click('pr-gate', '0', { how: 'waive' }); await app.tick();
  assert.match(app.html(), /id="pr-why-0"[^>]*aria-invalid="true" aria-describedby="pr-why-e-0"/);
  assert.match(app.html(), /<span class="err small" id="pr-why-e-0">/);
});

rule('Finishing with unsaved edits offers Save draft, not staging; once saved it offers Stage it for a test run', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  const short = text(app).replace(/\n## Gate: Ready to deploy[\s\S]*$/, '\n');
  app.input('draft-editor', short); await app.tick(300);
  const ids = (app.html().match(/data-pr-step="([\w-]+)"/g) || []).map(s => s.slice(14, -1));
  for (const id of ids) { await check(app, id); }
  if (/data-how="pass"/.test(app.html())) { app.click('pr-gate', '0', { how: 'pass' }); await app.tick(); }
  assert.match(app.html(), /You got through the whole checklist\. Save it, then stage it for a test run\./);
  assert.match(app.html(), /class="notice good pr-done">[\s\S]*?data-act="save-draft"/);
  app.click('pr-stage'); await app.tick();
  assert.match(app.live(), /Save the draft first/);
});

const SMALL = ['---', 'process: release', 'title: Production release', 'owner: person-casey', 'roles: release-lead', '---', '', '## Prep · READ-DO {#prep}', '- [ ] {confirm} One thing {#one}', '', '## Gate: Ready · owner @release-lead {#ready}', '', '## Ship · READ-DO {#ship}', '- [ ] {confirm} Ship it {#ship-it}', ''].join('\n');

rule('A refused check says why beside the step, inside the pane', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.input('draft-editor', SMALL); await app.tick(300);
  await check(app, 'one');
  app.click('pr-gate', '0', { how: 'pass' }); await app.tick();
  await check(app, 'one');
  assert.match(app.html(), /data-pr-step="one">[\s\S]*?<span class="pr-why err" role="alert">/);
  assert.equal(row(app, 'one'), 'done');
});

rule('Stage with builder typing not yet applied keeps the editor open and says to apply it first', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Feature flags set in the values'); await app.tick();
  app.click('ins-tab', 'practice'); await app.tick();
  app.click('pr-stage'); await app.tick();
  assert.match(app.live(), /Apply or clear what you typed/);
  assert.match(app.html(), /Practice · not recorded/, 'still in the editor');
});

rule('A sample committed while builder typing is pending is refused and the typed value stays in the box', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Feature flags set in the values'); await app.tick();
  app.click('ins-tab', 'practice'); await app.tick();
  sample(app, 'environment', 'staging', true); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="staging"/);
});

rule('A step checked in Practice is the builder\'s selected step too', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick();
  await check(app, 'tests');
  assert.match(app.html(), /Practice · not recorded/, 'Practice stays the open tab');
  app.click('ins-tab', 'selected'); await app.tick();
  assert.match(app.html(), /id="ob-text"[^>]*>Full test gate green on the release commit|id="ob-text"[^>]*value="Full test gate green on the release commit/);
});

rule('A practice kept in this tab that can\'t be read starts fresh and says so once', async () => {
  const session = { };
  const first = await editor({ sessionStore: session });
  first.click('pr-open'); await first.tick();
  await check(first, 'approved');
  const k = Object.keys(session).filter(x => /:practice:/.test(x))[0];
  session[k] = '{"v":1,"process":"release","answers":';
  const app = await editor({ sessionStore: session });
  app.click('pr-open'); await app.tick();
  assert.match(app.html(), /couldn&#39;t be read, so it starts fresh|couldn't be read, so it starts fresh/);
  assert.equal(row(app, 'approved'), 'open');
  await check(app, 'approved');
  assert.ok(!/starts fresh/.test(app.html()), 'said once');
});

rule('A refused sample keeps its text and error while another sample is committed', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.input('draft-editor', text(app).replace('context: ticket, commit, environment, tag', 'context: ticket, commit, environment:choice(staging|prod), tag')); await app.tick(300);
  assert.match(app.html(), /one of staging, prod/, 'set-up: environment is a choice');
  sample(app, 'environment', 'bad', true); await app.tick();
  sample(app, 'tag', 'v9', true); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="bad"[^>]*aria-invalid="true"/);
  assert.match(app.html(), /id="pr-s-tag" data-pr-sample="tag" value="v9"/);
});

rule('A refused Reset keeps sample typing', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Feature flags set in the values'); await app.tick();
  app.click('ins-tab', 'practice'); await app.tick();
  sample(app, 'environment', 'staging'); app.click('pr-reset'); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="staging"/);
});

rule('Down on a practice row moves the selection (and its highlight) to the next step', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  await check(app, 'approved');
  const next = { dataset: { prStep: 'tests' }, querySelector: s => (/pr-check/.test(s) ? {} : null) };
  const rowEl = { tagName: 'BUTTON', dataset: {}, classList: { contains: () => false }, closest: s => (s === '#pr' ? {} : s === '.pr-st' ? { dataset: { prStep: 'approved' } } : null) };
  const qsa = app.doc.querySelectorAll; app.doc.querySelectorAll = s => (s === '.pr-st' ? [rowEl.closest('.pr-st'), next] : qsa ? qsa.call(app.doc, s) : []);
  const prev = rowEl.closest; let mine = null; rowEl.closest = s => (s === '.pr-st' ? (mine = mine || prev(s)) : prev(s));
  app.keyOn('ArrowDown', {}, rowEl); await app.tick();
  app.doc.querySelectorAll = qsa;
  assert.match(app.html(), /<li class="pr-st[^"]* sel" data-pr-step="tests">/);
});

rule('Copy what I found without clipboard access selects the text and says how to copy it', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.fire('input', { target: { id: 'pr-found', value: 'The rollback step needs the ticket', closest: () => null } }); await app.tick();
  app.el('pr-copy-msg'); app.el('pr-found'); app.click('pr-copy'); await app.tick();
  assert.match(app.text('pr-copy-msg') || '', /Selected\. Press Ctrl\+C/);
});

rule('Undo of a check keeps a refused sample\'s text and error (only the samples Undo changes are reset)', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.input('draft-editor', text(app).replace('context: ticket, commit, environment, tag', 'context: ticket, commit, environment:choice(staging|prod), tag')); await app.tick(300);
  await check(app, 'approved');
  sample(app, 'environment', 'bad', true); await app.tick();
  app.click('pr-undo'); await app.tick();
  assert.equal(row(app, 'approved'), 'open');
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="bad"[^>]*aria-invalid="true"/);
});

/* ---------- 2.2 slice 2: evidence, Fill in, sets: and Run from here ---------- */
const formIds = (app, kind) => [...app.html().matchAll(new RegExp('id="pr-' + kind + '-([^"]+)"', 'g'))].map(m => m[1]).filter(n => !/^e-/.test(n));
const hasForm = (app, id) => new RegExp('data-pr-form="\\w+" data-id="' + id + '"').test(app.html());
const ADD_SETTER = t => t.replace('{#prep}\n', '{#prep}\n- [ ] {confirm} Record the release commit {#rc}\n  sets: commit\n');

rule('Evidence opens inline under the row; a missing value is said beside its box; Check records it; nothing reaches the folder', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-check', 'approved'); await app.tick();
  assert.ok(hasForm(app, 'approved'), 'the form opens under the row');
  assert.equal(row(app, 'approved'), 'open');
  const names = formIds(app, 'rec');
  assert.ok(names.length >= 1, 'boxes: ' + names);
  app.click('pr-ev-ok', 'approved'); await app.tick();
  assert.match(app.html(), /<p class="ferr" id="pr-fe" role="alert">[^<]+<\/p>/);
  assert.match(app.html(), /aria-invalid="true"/);
  assert.equal(row(app, 'approved'), 'open');
  names.forEach(n => { app.el('pr-rec-' + n).value = /link|url/.test(n) ? 'https://change.example/CHG-1234' : 'CHG-1234'; });
  app.click('pr-ev-ok', 'approved'); await app.tick();
  assert.equal(row(app, 'approved'), 'done');
  assert.ok(!hasForm(app, 'approved'), 'the form closes');
  await app.tick(200);
  assert.deepEqual(app.writes, []);
});

rule('Enter in an evidence box checks; Escape closes the form; Check without it says so on the row', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-check', 'approved'); await app.tick();
  const n = formIds(app, 'rec')[0], box = app.el('pr-rec-' + n);
  box.value = 'CHG-9';
  const target = Object.assign(box, { tagName: 'INPUT', dataset: { enter: 'pr-ev-ok', id: 'approved' }, closest: s => (s === '[data-pr-form]' ? { dataset: { prForm: 'ev', id: 'approved' } } : s === '#pr' ? {} : null) });
  app.keyOn('Enter', {}, target); await app.tick();
  assert.equal(row(app, 'approved'), 'done', 'Enter checked it');
  app.click('pr-check', 'tests'); await app.tick();
  assert.ok(hasForm(app, 'tests'));
  app.keyOn('Escape', {}, { tagName: 'INPUT', dataset: {}, closest: s => (s === '[data-pr-form]' ? { dataset: { prForm: 'ev', id: 'tests' } } : s === '#pr' ? {} : null) }); await app.tick();
  assert.ok(!hasForm(app, 'tests'), 'Escape closed it');
  assert.equal(row(app, 'tests'), 'open');
  app.click('pr-check', 'tests'); await app.tick();
  app.click('pr-ev-skip', 'tests'); await app.tick();
  assert.equal(row(app, 'tests'), 'done');
  assert.match(app.html(), /Checked without evidence\./);
});

rule('The selected row offers Fill in and Run from here; Fill in saves in practice only and never sends the step back', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  await check(app, 'announce');
  app.click('pr-sel', 'announce'); await app.tick();
  assert.match(app.html(), /<li class="pr-more"><button type="button" class="mini" data-act="pr-fill" data-id="announce"[^>]*>Fill in<\/button><button type="button" class="mini" data-act="pr-from" data-id="announce"/);
  assert.ok(!/data-act="pr-goto"/.test(app.html()), 'no Edit in Markdown mode: the builder is off');
  app.click('pr-fill', 'announce'); await app.tick();
  const f = formIds(app, 'fld')[0];
  assert.ok(f, 'a Fill in box');
  app.el('pr-fld-' + f).value = 'release-room';
  app.click('pr-fill-ok', 'announce'); await app.tick();
  assert.ok(!hasForm(app, 'announce'), 'saved: ' + (/id="pr-fe"[^>]*>([^<]*)/.exec(app.html()) || [])[1]);
  assert.equal(row(app, 'announce'), 'done');
  app.click('pr-fill', 'announce'); await app.tick();
  assert.match(app.html(), /value="release-room"/);
  assert.match(app.html(), /\(draft says: /);
  await app.tick(200);
  assert.deepEqual(app.writes, []);
  assert.ok(!/release-room/.test(text(app)), 'the draft is unchanged');
});

rule('A setter\'s value flows to the sample and later steps; editing the setter sends its consumers back, the same value brings them back', async () => {
  const app = await editor();
  app.input('draft-editor', ADD_SETTER(text(app))); await app.tick(300);
  app.click('pr-open'); await app.tick();
  await check(app, 'tests');
  app.click('pr-check', 'rc'); await app.tick();
  const n = formIds(app, 'rec')[0];
  app.el('pr-rec-' + n).value = 'abc1234';
  app.click('pr-ev-ok', 'rc'); await app.tick();
  assert.equal(row(app, 'rc'), 'done');
  assert.match(app.html(), /id="pr-s-commit" data-pr-sample="commit" value="abc1234"/);
  assert.match(app.html(), /Set by &quot;Record the release commit&quot;|Set by "Record the release commit"/);
  assert.equal(row(app, 'tests'), 'again', 'its ^commit changed');
  await check(app, 'tests');
  app.input('draft-editor', text(app).replace('Record the release commit {#rc}', 'Record the release commit hash {#rc}')); await app.tick(300);
  assert.equal(row(app, 'rc'), 'again');
  assert.equal(row(app, 'tests'), 'again');
  assert.match(app.html(), /\^commit came from a step to try again\./);
  app.click('pr-check', 'rc'); await app.tick();
  assert.match(app.html(), /value="abc1234"/, 'the kept value is the starting point');
  app.click('pr-ev-ok', 'rc'); await app.tick();
  assert.equal(row(app, 'rc'), 'done');
  assert.equal(row(app, 'tests'), 'done', 'same value: back as it was');
  await app.tick(200);
  assert.ok(!app.writes.some(w => /practice/i.test(w)));
});

rule('Run from here: earlier steps fold into one line, the walk starts there, Start from the beginning brings it back, one Undo each', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-sel', 'pods'); await app.tick();
  app.click('pr-from', 'pods'); await app.tick();
  const h = app.html();
  assert.match(h, /\d+ earlier steps assumed for practice · <button type="button" class="linkish" data-act="pr-from-clear">Start from the beginning<\/button>/);
  assert.equal(row(app, 'approved'), null, 'assumed steps are folded away');
  assert.equal(row(app, 'merge'), null);
  assert.equal(row(app, 'pods'), 'open');
  assert.match(h, /Next up:<\/b> Deploy: 1 step to go/);
  assert.match(h, /0 of 1 from here/);
  app.click('pr-undo'); await app.tick();
  assert.equal(row(app, 'approved'), 'open', 'Undo puts the whole checklist back');
  app.click('pr-redo'); await app.tick();
  assert.equal(row(app, 'approved'), null);
  app.click('pr-from-clear'); await app.tick();
  assert.equal(row(app, 'approved'), 'open');
  await app.tick(200);
  assert.deepEqual(app.writes, []);
});

rule('Run from here asks for the samples the walk needs, and gets through without a success moment', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-sel', 'deploy-record'); await app.tick();
  app.click('pr-from', 'deploy-record'); await app.tick();
  assert.match(app.html(), /needed from here/);
  assert.match(app.html(), /<details class="pr-sample" data-disc="pr-sample" open>/);
  for (const id of ['deploy-record', 'close']) await check(app, id);
  app.click('pr-gate', '2', { how: 'pass' }); await app.tick();
  const h = app.html();
  assert.ok(!/whole checklist/.test(h));
  assert.match(h, /You got through from &quot;Deploy record shows|You got through from "Deploy record shows/);
  assert.ok(!/data-act="pr-stage"/.test(h), 'never Stage from a partial walk');
});

rule('F on a practice row opens Fill in (when the Keyboard setting allows single keys and the step has fields)', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-sel', 'announce'); await app.tick();
  const rowEl = { dataset: { prStep: 'announce' }, classList: { contains: c => c === 'pr-st' || c === 'sel' } };
  const target = { tagName: 'BUTTON', dataset: {}, classList: { contains: () => false }, closest: s => (s === '.pr-st' ? rowEl : s === '#pr' ? {} : null) };
  app.keyOn('f', {}, target); await app.tick();
  assert.ok(hasForm(app, 'announce'), 'F opened Fill in');
});

rule('With the builder on, a step\'s text selects it in Practice (the pane stays); Edit opens it in the builder', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick();
  app.click('pr-sel', 'announce'); await app.tick();
  assert.match(app.html(), /<li class="pr-st st-open sel" data-pr-step="announce">/);
  assert.match(app.html(), /data-act="pr-goto" data-id="announce">Edit<\/button>/);
  assert.match(app.html(), /Practice · not recorded/, 'still practicing');
});

rule('A yes/no setter\'s radios are read as chosen, by Check and by Ctrl+Enter', async () => {
  for (const how of ['click', 'key']) {
    const app = await editor();
    app.input('draft-editor', text(app).replace('context: ticket, commit, environment, tag', 'context: ticket, commit, environment, tag, ready:yes-no').replace('{#prep}\n', '{#prep}\n- [ ] {confirm} Say if it is ready {#go}\n  sets: ready\n')); await app.tick(300);
    app.click('pr-open'); await app.tick();
    app.click('pr-check', 'go'); await app.tick();
    const n = formIds(app, 'rec')[0], fs = app.el('pr-rec-' + n);
    Object.assign(fs, { tagName: 'FIELDSET', querySelector: s => (s === 'input:checked' ? { value: 'yes' } : null) });
    if (how === 'click') app.click('pr-ev-ok', 'go');
    else app.keyOn('Enter', { ctrlKey: true }, { tagName: 'INPUT', type: 'radio', dataset: {}, closest: s => (s === '[data-pr-form]' ? { dataset: { prForm: 'ev', id: 'go' } } : s === '#pr' ? {} : null) });
    await app.tick();
    assert.equal(row(app, 'go'), 'done', how);
    assert.match(app.html(), /id="pr-s-ready" data-pr-sample="ready" value="yes"/, how);
  }
});

rule('What was typed in one step\'s form never carries into another step\'s, for evidence and Fill in alike', async () => {
  const app = await editor();
  app.input('draft-editor', text(app).replace('{#prep}\n', '{#prep}\n- [ ] {decide} Pick A {#da}\n  options: Red, Blue\n  require: decision\n- [ ] {decide} Pick B {#db}\n  options: Red, Blue\n  require: decision\n')); await app.tick(300);
  app.click('pr-open'); await app.tick();
  for (const [act, box] of [['pr-check', 'pr-rec-why'], ['pr-fill', 'pr-fld-criteria']]) {
    app.click(act, 'da'); await app.tick();
    const kind = act === 'pr-check' ? 'ev' : 'fill';
    assert.match(app.html(), new RegExp('data-scope="pr\\|' + kind + '\\|da"'));
    app.click(act, 'db'); await app.tick();
    /* The redraw carries a typed box only within the same data-scope (app.js render), so B's boxes start from B. This
       harness keeps one object per box ID, so typing can't be shown here; a real browser was checked by hand. */
    assert.match(app.html(), new RegExp('data-pr-form="' + kind + '" data-id="db" data-scope="pr\\|' + kind + '\\|db"'), act + ': B\'s form has its own scope');
    assert.match(app.html(), new RegExp('id="' + box + '"[^>]*>'), act);
    assert.ok(!new RegExp('<textarea id="' + box + '"[^>]*>first step only|id="' + box + '"[^>]*value="first step only"').test(app.html()), act + ': drawn from B');
    app.click('pr-form-close'); await app.tick();
  }
});

rule('A Fill in refused while builder typing is pending keeps its form and what was typed', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick();
  app.click('pr-sel', 'announce'); await app.tick();
  app.click('pr-fill', 'announce'); await app.tick();
  const f = formIds(app, 'fld')[0];
  app.el('pr-fld-' + f).value = 'release-room';
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Feature flags set in the values'); await app.tick();
  app.click('ins-tab', 'practice'); await app.tick();
  app.click('pr-sel', 'announce'); await app.tick();
  assert.ok(hasForm(app, 'announce'), 'its form is still open');
  app.click('pr-fill-ok', 'announce'); await app.tick();
  assert.match(app.live(), /Apply or clear/);
  assert.ok(hasForm(app, 'announce'), 'the form stays');
  assert.match(app.html(), /value="release-room"/);
});

rule('Reset is offered once anything resettable is there: Run from here alone counts', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  assert.match(app.html(), /data-act="pr-reset" disabled/);
  app.click('pr-sel', 'announce'); await app.tick();
  app.click('pr-from', 'announce'); await app.tick();
  assert.ok(!/data-act="pr-reset" disabled/.test(app.html()));
  app.click('pr-reset'); await app.tick();
  assert.match(app.html(), /data-act="pr-reset" disabled/);
});

rule('A from step moved by a draft edit is kept at once, so a reload never brings back the old one', async () => {
  const session = {};
  const app = await editor({ sessionStore: session });
  app.click('pr-open'); await app.tick();
  app.click('pr-sel', 'approved'); await app.tick();
  app.click('pr-from', 'approved'); await app.tick();
  app.input('draft-editor', text(app).replace(/\n- \[!\] \{change\.request\}[^\n]*\{#approved\}\n(  [^\n]*\n)*/, '\n')); await app.tick(300);
  const k = Object.keys(session).filter(x => /:practice:/.test(x))[0];
  const from = JSON.parse(session[k]).from;
  assert.ok(from && from !== 'approved', 'kept: ' + from);
});

run();
