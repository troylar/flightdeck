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
const btn = () => ({ tagName: 'BUTTON', dataset: {}, closest: s => (s === '#pr' ? {} : null) });

rule('Practice opens as a tab of its own, says it is not recorded, and checking steps writes nothing to the folder', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  assert.match(app.html(), /Practice · not recorded/);
  assert.match(app.html(), /Nothing here is saved to the team folder/);
  assert.equal(row(app, 'approved'), 'open');
  app.click('pr-check', 'approved'); await app.tick();
  app.click('pr-check', 'tests'); await app.tick();
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
  prac.click('pr-check', 'approved'); await prac.tick();
  prac.click('pr-check', 'tests'); await prac.tick();
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
  app.click('pr-check', 'approved'); await app.tick();
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
  app.click('pr-check', 'approved'); await app.tick();
  app.click('pr-reset'); await app.tick();
  assert.equal(row(app, 'approved'), 'open');
  app.click('pr-undo'); await app.tick();
  assert.equal(row(app, 'approved'), 'done');
});

rule('Practice is kept for this tab across a reload, in session storage only', async () => {
  const session = {};
  const app = await editor({ sessionStore: session });
  app.click('pr-open'); await app.tick();
  app.click('pr-check', 'approved'); await app.tick();
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
  app.click('pr-check', 'approved'); await app.tick();
  app.input('draft-editor', text(app).replace('{#tests}', '{#approved}')); await app.tick(300);
  assert.match(app.html(), /The draft has a problem:/);
  assert.match(app.html(), /Practicing the last version that worked/);
  assert.equal(row(app, 'approved'), 'done');
});

rule('Publishing exactly the practiced text ends the practice', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-check', 'approved'); await app.tick();
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
  app.click('pr-check', 'approved'); await app.tick();
  assert.equal(row(app, 'approved'), 'open', 'the check waits');
  app.input('ob-text', 'Feature flags set in the deploy values'); await app.tick();
  app.click('pr-check', 'approved'); await app.tick();
  assert.equal(row(app, 'approved'), 'done');
});

rule('Escape on a practice row goes back to the editor and keeps practicing (on a wide screen)', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-check', 'approved'); await app.tick();
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
  sample(app, 'tag', 'v9'); app.click('pr-check', 'approved'); await app.tick();
  assert.match(app.html(), /id="pr-s-tag" data-pr-sample="tag" value="v9"/);
});

rule('The selected step follows the builder: a step chosen there is the one selected in Practice', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick();
  app.click('pr-check', 'approved'); await app.tick();
  assert.match(app.html(), /<li class="pr-st st-done sel" data-pr-step="approved">/);
  app.click('ob-sel', 'tests'); await app.tick();
  app.click('ins-tab', 'practice'); await app.tick();
  assert.match(app.html(), /<li class="pr-st st-open sel" data-pr-step="tests">/);
});

rule('A selected step removed from the draft hands the selection to the next row', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-check', 'approved'); await app.tick();
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
  app.click('pr-check', 'approved'); await app.tick();
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
  sample(app, 'environment', 'prod'); app.click('pr-check', 'approved'); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="prod"/);
  assert.ok(before);
});

rule('A selection handed over after a removal stays put on later redraws, within its phase', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-check', 'approved'); await app.tick();
  app.input('draft-editor', text(app).replace(/\n- \[!\] \{change\.request\}[^\n]*\{#approved\}\n(  [^\n]*\n)*/, '\n')); await app.tick(300);
  app.click('pr-check', 'tests'); app.click('pr-check', 'tests'); await app.tick();
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
  for (const id of ids) { app.click('pr-check', id); await app.tick(); }
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
  app.click('pr-check', 'one'); await app.tick();
  app.click('pr-gate', '0', { how: 'pass' }); await app.tick();
  app.click('pr-check', 'one'); await app.tick();
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
  app.click('pr-check', 'tests'); await app.tick();
  assert.match(app.html(), /Practice · not recorded/, 'Practice stays the open tab');
  app.click('ins-tab', 'selected'); await app.tick();
  assert.match(app.html(), /id="ob-text"[^>]*>Full test gate green on the release commit|id="ob-text"[^>]*value="Full test gate green on the release commit/);
});

rule('A practice kept in this tab that can\'t be read starts fresh and says so once', async () => {
  const session = { };
  const first = await editor({ sessionStore: session });
  first.click('pr-open'); await first.tick();
  first.click('pr-check', 'approved'); await first.tick();
  const k = Object.keys(session).filter(x => /:practice:/.test(x))[0];
  session[k] = '{"v":1,"process":"release","answers":';
  const app = await editor({ sessionStore: session });
  app.click('pr-open'); await app.tick();
  assert.match(app.html(), /couldn&#39;t be read, so it starts fresh|couldn't be read, so it starts fresh/);
  assert.equal(row(app, 'approved'), 'open');
  app.click('pr-check', 'approved'); await app.tick();
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
  app.click('pr-check', 'approved'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Feature flags set in the values'); await app.tick();
  app.click('ins-tab', 'practice'); await app.tick();
  sample(app, 'environment', 'staging'); app.click('pr-reset'); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="staging"/);
});

rule('Down on a practice row moves the selection (and its highlight) to the next step', async () => {
  const app = await editor();
  app.click('pr-open'); await app.tick();
  app.click('pr-check', 'approved'); await app.tick();
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

run();
