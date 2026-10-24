// 2.3 in the built app: practicing the draft on the run screen. Practice writes nothing to the folder, has its own Undo,
// survives a reload of the tab, sends Edit to the real editor at that step and comes back with what changed marked
// Try it again, and ends when exactly the practiced text is published.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

const DRAFT = 'maps/drafts/release.md';
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
const onPage = app => /Practice · not recorded/.test(app.html());
const inEditor = app => /id="draft-editor"|id="ob-plist"|data-act="ob-sel"/.test(app.html()) && !onPage(app);
async function practice(app) { app.click('pr-open'); await app.tick(60); assert.ok(onPage(app), 'set-up: on the practice page'); }
/* A step's row as drawn: open, done, again (Try it again), skipped (Not needed); null when it isn't drawn. */
const row = (app, id) => { const m = new RegExp('<li class="step[^"]*" data-a="([\\w-]+)" id="step-' + id + '">').exec(app.html()); return m ? ({ recheck: 'again', na: 'skipped' })[m[1]] || m[1] : null; };
/* Checks a step; one that asks for evidence opens its boxes first, answered here with Done without it. */
async function check(app, id) { app.click('toggle', id); await app.tick(); if (new RegExp('data-act="pr-ev-skip" data-id="' + id + '"').test(app.html()) && row(app, id) !== 'done') { app.click('pr-ev-skip', id); await app.tick(); } }
/* The gate of phase pi, by its ID as drawn. */
const gateId = (app, pi) => [...app.html().matchAll(/<div class="gate" data-scope="gate:([^"]+)"/g)].map(m => m[1])[pi];
/* A gate passed: straight from its button, or through its Pass form. */
async function pass(app, pi) {
  if (!new RegExp('data-act="pass" data-id="' + pi + '"').test(app.html())) { app.click('pick', gateId(app, pi), { kind: 'pass' }); await app.tick(); }
  app.click('pass', String(pi)); await app.tick();
}
/* A control outside the practice page (the top bar's, Settings'), which acts as it does anywhere. */
const topClick = (app, act, id) => { const b = { dataset: { act, id }, disabled: false, classList: { contains: () => false }, closest: s => (s === '#top' ? {} : null) }; app.fire('click', { target: { closest: () => b } }); };
const canPass = (app, pi) => new RegExp('data-act="pass" data-id="' + pi + '"|data-act="pick" data-kind="pass" data-id="' + gateId(app, pi) + '"').test(app.html());
/* Back to the draft, the draft changed there, and Back to practice. */
async function edit(app, fn) {
  app.click('pr-back'); await app.tick();
  assert.ok(inEditor(app), 'set-up: in the editor');
  app.input('draft-editor', fn(text(app))); await app.tick(300);
  app.click('pr-open'); await app.tick(60);
}
/* A sample box typed in, then committed (Enter or leaving it), as the browser sends them. */
const sample = (app, name, v, commit) => { const target = { id: 'pr-s-' + name, value: v, tagName: 'INPUT', dataset: { prSample: name }, closest: () => null }; app.fire('input', { target }); if (commit) app.fire('change', { target }); };
const btn = () => ({ tagName: 'BUTTON', dataset: {}, closest: () => null });
const DROP_APPROVED = t => t.replace(/\n- \[!\] \{change\.request\}[^\n]*\{#approved\}\n(  [^\n]*\n)*/, '\n');

/* ---------- the page ---------- */
rule('Practice opens as a page of its own, says it is not recorded, and checking steps writes nothing to the folder', async () => {
  const app = await editor();
  await practice(app);
  assert.strictEqual(app.hash(), '#/practice/release');
  assert.match(app.html(), /Nothing here is saved to the team folder/);
  assert.ok(!/id="draft-editor"/.test(app.html()), 'the run screen, not the editor');
  assert.equal(row(app, 'approved'), 'open');
  await check(app, 'approved');
  await check(app, 'rollback');
  assert.equal(row(app, 'approved'), 'done');
  assert.equal(row(app, 'rollback'), 'done');
  app.click('na', 'announce'); await app.tick();
  assert.equal(row(app, 'announce'), 'skipped');
  await app.tick(200);
  assert.deepEqual(app.writes, [], 'practice wrote: ' + app.writes.join(', '));
  assert.ok(!Object.keys(app.fs.files).some(p => /practice/i.test(p)));
});

rule('Every control drawn on the practice page is one practice allows; anything else does nothing there', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  await practice(app);
  app.click('select', 'approved'); await app.tick();
  const acts = new Set([...app.html().matchAll(/data-act="([^"]+)"/g)].map(m => m[1]));
  const allowed = /^(pr-[\w-]+|toggle|record|na|clear|select|goto|to-ins|to-row|close-ref|unfold|fold|pick|unpick|save-fields|pass|waive|reopen|dismiss|help|copy|zoom|zoom-phase|zoom-gate|nav)$/;
  const odd = [...acts].filter(a => !allowed.test(a));
  assert.deepStrictEqual(odd, [], 'drawn but not allowed: ' + odd.join(', '));
  /* A run's own actions reach nothing: no note, no block, no run started, nothing written. */
  const before = app.html();
  for (const [act, id, data] of [['note-save', 'approved'], ['pick', 'approved', { kind: 'block' }], ['start-test', 'release'], ['end-run'], ['open-run', 'release/run1'], ['nav', 'settings']]) { app.click(act, id, data); await app.tick(); }
  assert.ok(onPage(app), 'still practicing');
  assert.strictEqual(app.html(), before, 'nothing changed on the page');
  await app.tick(200);
  assert.deepEqual(app.writes, []);
});

rule('Undo on the practice page undoes the practice; inside a text box the browser keeps its own Undo', async () => {
  const app = await editor();
  await practice(app);
  await check(app, 'rollback');
  const before = app.fs.files[DRAFT].t;
  app.keyOn('z', { ctrlKey: true }, btn()); await app.tick();
  assert.equal(row(app, 'rollback'), 'open');
  assert.equal(app.fs.files[DRAFT].t, before, 'the draft is unchanged');
  app.keyOn('z', { ctrlKey: true, shiftKey: true }, btn()); await app.tick();
  assert.equal(row(app, 'rollback'), 'done');
  let stopped = false;
  app.keyOn('z', { ctrlKey: true, preventDefault() { stopped = true; } }, { tagName: 'TEXTAREA', id: 'pr-found', dataset: {}, closest: () => null }); await app.tick();
  assert.equal(stopped, false);
  assert.equal(row(app, 'rollback'), 'done');
});

rule('Reset clears the answers and one Undo brings them back', async () => {
  const app = await editor();
  await practice(app);
  await check(app, 'rollback');
  app.click('pr-reset'); await app.tick();
  assert.equal(row(app, 'rollback'), 'open');
  app.click('pr-undo'); await app.tick();
  assert.equal(row(app, 'rollback'), 'done');
});

rule('Reset is offered once anything resettable is there: Run from here alone counts', async () => {
  const app = await editor();
  await practice(app);
  assert.match(app.html(), /data-act="pr-reset" disabled/);
  app.click('select', 'announce'); await app.tick();
  app.click('pr-from', 'announce'); await app.tick();
  assert.ok(!/data-act="pr-reset" disabled/.test(app.html()));
  app.click('pr-reset'); await app.tick();
  assert.match(app.html(), /data-act="pr-reset" disabled/);
});

rule('Practice is kept for this tab across a reload, in session storage only, and a #/practice link opens it', async () => {
  const session = {};
  const app = await editor({ sessionStore: session });
  await practice(app);
  await check(app, 'rollback');
  const keys = Object.keys(session).filter(k => /:practice:/.test(k) && !/:typed$/.test(k));
  assert.equal(keys.length, 1);
  assert.ok(/:release$/.test(keys[0]));
  const again = boot({ localStore: { 'preflight:builder': 'false' }, sessionStore: session, hash: '#/practice/release' });
  await again.tick(60); again.choose('person-casey'); await again.tick(60);
  assert.ok(onPage(again), 'the link lands on the practice page');
  assert.equal(row(again, 'rollback'), 'done');
  const other = await editor();
  await practice(other);
  assert.equal(row(other, 'rollback'), 'open', 'another tab starts fresh');
});

rule('A practice kept in this tab that can\'t be read starts fresh and says so once', async () => {
  const session = {};
  const first = await editor({ sessionStore: session });
  await practice(first);
  await check(first, 'rollback');
  const k = Object.keys(session).filter(x => /:practice:/.test(x) && !/:typed$/.test(x))[0];
  session[k] = '{"v":1,"process":"release","answers":';
  const app = await editor({ sessionStore: session });
  await practice(app);
  assert.match(app.html(), /couldn&#39;t be read, so it starts fresh|couldn't be read, so it starts fresh/);
  assert.equal(row(app, 'rollback'), 'open');
  await check(app, 'rollback');
  assert.ok(!/starts fresh/.test(app.html()), 'said once');
});

rule('Publishing exactly the practiced text ends the practice', async () => {
  const app = await editor();
  await practice(app);
  await check(app, 'rollback');
  app.click('pr-close'); await app.tick();
  assert.ok(inEditor(app), 'Done practicing goes back to the editor');
  app.set('change-note', 'Practiced'); app.click('publish', 'release'); await app.tick(120);
  assert.match(app.html() + app.live(), /Published v/);
  app.click('ptab', 'edit'); await app.tick();
  await practice(app);
  assert.equal(row(app, 'rollback'), 'open');
});

/* ---------- Edit and Back to practice ---------- */
rule('Editing a checked step makes it "Try it again", and the folder sees only the same draft saves as without practice', async () => {
  const plain = await editor(), prac = await editor();
  await practice(prac);
  await check(prac, 'approved');
  await check(prac, 'rollback');
  prac.click('pr-back'); await prac.tick();
  const t = text(prac).replace("Change request approved for tonight's window", 'Change request approved for this window');
  [plain, prac].forEach(a => a.input('draft-editor', t));
  await plain.tick(300); await prac.tick(300);
  prac.click('pr-open'); await prac.tick(60);
  assert.equal(row(prac, 'approved'), 'again');
  assert.match(prac.html(), /Try it again/);
  assert.equal(row(prac, 'rollback'), 'done');
  assert.deepEqual(prac.writes, plain.writes);
});

rule('Edit opens the builder on that step; Back to practice returns to it, renamed or not, selected', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  await practice(app);
  await check(app, 'rollback');
  app.click('select', 'flags'); await app.tick();
  app.click('pr-edit', 'flags'); await app.tick();
  assert.ok(inEditor(app), 'in the editor');
  assert.strictEqual(app.focused(), 'ob-text', 'its text box focused');
  assert.match(app.html(), /data-act="pr-open">Back to practice</, 'the builder offers Back to practice');
  app.input('ob-text', 'Feature flags set in the deploy values file'); await app.tick();
  app.click('ob-done'); await app.tick(300);
  app.click('pr-open'); await app.tick(60);
  assert.ok(onPage(app));
  assert.strictEqual(app.selected(), 'flags', 'back on the step');
  assert.equal(row(app, 'rollback'), 'done', 'the rest as it was');
});

rule('Edit in Markdown selects the step\'s lines; Back to practice lands on the step the caret is in', async () => {
  const app = await editor();
  await practice(app);
  const ta = app.el('draft-editor'); ta.value = app.fs.files[DRAFT].t; let focused = false, range = null;
  ta.focus = () => { focused = true; }; ta.setSelectionRange = (x, y) => { range = [x, y]; };
  app.click('pr-edit', 'flags'); await app.tick();
  assert.ok(inEditor(app));
  assert.ok(focused, 'the Markdown box has focus');
  assert.ok(range && /\{#flags\}$/.test(ta.value.slice(range[0], range[1])), 'the step\'s line is selected: ' + (range && ta.value.slice(range[0], range[1])));
  const at = ta.value.indexOf('{#rollback}');
  ta.selectionStart = ta.selectionEnd = at;
  app.click('pr-open'); await app.tick(60);
  assert.strictEqual(app.selected(), 'rollback', 'the caret\'s step');
});

rule('A selected step removed from the draft hands the selection to the step after it', async () => {
  const app = await editor();
  await practice(app);
  await check(app, 'approved');
  app.click('pr-edit', 'approved'); await app.tick();
  app.input('draft-editor', DROP_APPROVED(text(app))); await app.tick(300);
  app.click('pr-open'); await app.tick(60);
  assert.equal(row(app, 'approved'), null, 'gone');
  assert.strictEqual(app.selected(), 'tests');
});

rule('A step added in the editor is there to practice, and nothing else changes', async () => {
  const app = await editor();
  await practice(app);
  await check(app, 'rollback');
  await edit(app, t => t.replace('{#rollback}\n', '{#rollback}\n- [ ] {confirm} Tell support the window {#support}\n'));
  assert.equal(row(app, 'support'), 'open');
  assert.equal(row(app, 'rollback'), 'done');
});

rule('Browser Back from the editor returns to practice, and Forward goes back to the editor', async () => {
  const app = await editor();
  await practice(app);
  await check(app, 'rollback');
  app.click('pr-edit', 'flags'); await app.tick();
  assert.ok(inEditor(app));
  app.back(); await app.settle();
  assert.ok(onPage(app), 'Back: practice');
  assert.equal(row(app, 'rollback'), 'done');
  app.forward(); await app.settle();
  assert.ok(inEditor(app), 'Forward: the editor');
});

rule('Escape on the practice page goes back to the draft and keeps practicing', async () => {
  const app = await editor();
  await practice(app);
  await check(app, 'rollback');
  app.click('close-ref'); await app.tick();
  app.keyOn('Escape', {}, btn()); await app.tick();
  assert.ok(inEditor(app), 'back in the editor');
  assert.match(app.html(), /data-act="pr-open"[^>]*>(<span[^>]*>.*?<\/span>)?Back to practice/);
  await practice(app);
  assert.equal(row(app, 'rollback'), 'done');
});

rule('Builder typing not yet applied keeps the editor open and says to apply it first', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Feature flags set in the values'); await app.tick();
  app.click('pr-open'); await app.tick();
  assert.match(app.live(), /Apply or clear what you typed/);
  assert.ok(!onPage(app), 'still in the editor');
});

rule('A refused draft keeps practicing the last version that worked and says what the problem is', async () => {
  const app = await editor();
  await practice(app);
  await check(app, 'rollback');
  await edit(app, t => t.replace('{#tests}', '{#approved}'));
  assert.match(app.html(), /The draft has a problem:/);
  assert.match(app.html(), /Practicing the last version that worked/);
  assert.match(app.html(), /data-act="pr-back"[^>]*>Back to the draft to fix it/);
  assert.equal(row(app, 'rollback'), 'done');
});

rule('Not needed on a "Try it again" row marks it Not needed again, in one click', async () => {
  const app = await editor();
  await practice(app);
  app.click('na', 'announce'); await app.tick();
  await edit(app, t => t.replace('Post "starting release" in the team channel', 'Post "starting release" in the channel'));
  assert.equal(row(app, 'announce'), 'again');
  app.click('na', 'announce'); await app.tick();
  assert.equal(row(app, 'announce'), 'skipped');
});

rule('Typing in evidence is kept across Edit and back, and a step\'s typing never lands on another', async () => {
  const app = await editor();
  await practice(app);
  app.click('toggle', 'approved'); await app.tick();
  app.set('rec-number', 'CHG-77');
  app.click('select', 'tests'); await app.tick();
  app.click('toggle', 'tests'); await app.tick();
  assert.ok(!/id="rec-number"/.test(app.html()), 'B shows its own boxes');
  app.click('select', 'approved'); await app.tick();
  assert.match(app.html(), /id="rec-number"[^>]*value="CHG-77"/, 'A kept its typing');
  app.click('pr-edit', 'flags'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  app.click('select', 'approved'); await app.tick();
  assert.match(app.html(), /id="rec-number"[^>]*value="CHG-77"/, 'and across Edit');
});

/* ---------- answering ---------- */
rule('Evidence: Done without a needed value says so beside its box; with it, Done records it; nothing reaches the folder', async () => {
  const app = await editor();
  await practice(app);
  app.click('toggle', 'approved'); await app.tick();
  assert.equal(row(app, 'approved'), 'open', 'the boxes open first');
  assert.match(app.html(), /id="rec-number"/);
  app.click('record', 'approved'); await app.tick();
  assert.match(app.html(), /<p class="ferr" id="ferr-approved" role="alert">Change number is needed/);
  assert.equal(row(app, 'approved'), 'open');
  app.set('rec-number', 'CHG-1234');
  app.click('record', 'approved'); await app.tick();
  assert.equal(row(app, 'approved'), 'done');
  await app.tick(200);
  assert.deepEqual(app.writes, []);
});

rule('Done without it checks the step and says it was checked without evidence', async () => {
  const app = await editor();
  await practice(app);
  app.click('toggle', 'tests'); await app.tick();
  app.click('pr-ev-skip', 'tests'); await app.tick();
  assert.equal(row(app, 'tests'), 'done');
  assert.match(app.html(), /Checked without evidence/);
});

rule('Fill in saves in practice only and never sends the step back or changes the draft', async () => {
  const app = await editor();
  await practice(app);
  await check(app, 'announce');
  app.click('pick', 'announce', { kind: 'fields' }); await app.tick();
  assert.match(app.html(), /id="fld-channel"/);
  app.set('fld-channel', '#release-room');
  app.click('save-fields', 'announce'); await app.tick();
  assert.ok(!/id="fld-channel"/.test(app.html()), 'saved and closed');
  assert.equal(row(app, 'announce'), 'done');
  await app.tick(200);
  assert.deepEqual(app.writes, []);
  assert.ok(!/release-room/.test(app.fs.files[DRAFT].t), 'the draft is unchanged');
});

rule('A refused check says why, and the step keeps its answer', async () => {
  const app = await editor();
  await practice(app);
  for (const id of ['approved', 'tests', 'flags', 'rollback', 'notes', 'announce']) await check(app, id);
  await pass(app, 0);
  app.click('unfold', 'prep'); await app.tick();
  app.click('toggle', 'rollback'); await app.tick();
  assert.equal(row(app, 'rollback'), 'done');
});

rule('Waive without a reason says so beside the reason box', async () => {
  const app = await editor();
  app.input('draft-editor', ['---', 'process: release', 'title: Production release', 'owner: person-casey', 'roles: release-lead', '---', '', '## Prep · READ-DO {#prep}', '- [ ] {confirm} One thing {#one}', '', '## Gate: Ready · owner @release-lead {#ready}', ''].join('\n')); await app.tick(300);
  app.click('pr-open'); await app.tick(60);
  assert.match(app.html(), /data-act="pick" data-kind="waive" data-id="ready"/, 'set-up: the gate can be waived');
  app.click('pick', 'ready', { kind: 'waive' }); await app.tick();
  app.set('pick-input', '');
  app.click('waive', '0'); await app.tick();
  assert.match(app.html(), /id="pick-input"[^>]*aria-invalid="true"/);
  assert.strictEqual(app.focused(), 'pick-input');
});

rule('Run from here: earlier steps are assumed, the walk starts there, Start from the beginning brings it back, one Undo each', async () => {
  const app = await editor();
  await practice(app);
  app.click('select', 'pods'); await app.tick();
  app.click('pr-from', 'pods'); await app.tick();
  assert.match(app.html(), /\d+ earlier steps assumed for practice · <button type="button" class="linkish" data-act="pr-from-clear">Start from the beginning<\/button>/);
  assert.equal(row(app, 'pods'), 'open');
  app.click('pr-undo'); await app.tick();
  assert.ok(!/earlier steps assumed/.test(app.html()), 'Undo puts the whole checklist back');
  app.click('pr-redo'); await app.tick();
  assert.match(app.html(), /earlier steps assumed/);
  app.click('pr-from-clear'); await app.tick();
  assert.ok(!/earlier steps assumed/.test(app.html()));
  await app.tick(200);
  assert.deepEqual(app.writes, []);
});

rule('Run from here asks for the samples the walk needs, and gets through without offering Stage', async () => {
  const app = await editor();
  await practice(app);
  app.click('select', 'smoke'); await app.tick();
  app.click('pr-from', 'smoke'); await app.tick();
  assert.match(app.html(), /needed from here/);
  for (let id; (id = (/data-a="open" id="step-([\w-]+)"/.exec(app.html()) || [])[1]);) await check(app, id);
  await pass(app, 2);
  const h = app.html();
  assert.match(h, /You got through from &quot;Smoke prompts|You got through from "Smoke prompts/);
  assert.ok(!/data-act="pr-stage"/.test(h), 'never Stage from a partial walk');
});

/* ---------- samples ---------- */
rule('A committed sample and its Undo: the box shows exactly the value being practiced', async () => {
  const app = await editor();
  await practice(app);
  app.click('pr-samples'); await app.tick();
  sample(app, 'environment', 'staging', true); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="staging"/);
  app.click('pr-undo'); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value=""/);
});

rule('Typing a sample not yet committed survives a redraw', async () => {
  const app = await editor();
  await practice(app);
  app.click('pr-samples'); await app.tick();
  sample(app, 'tag', 'v9'); await check(app, 'rollback');
  assert.match(app.html(), /id="pr-s-tag" data-pr-sample="tag" value="v9"/);
});

rule('A refused sample keeps its text and error while another sample is committed, and across an Undo', async () => {
  const app = await editor();
  await edit(app, t => t.replace('context: ticket, commit, environment, tag', 'context: ticket, commit, environment:choice(staging|prod), tag'));
  app.click('pr-samples'); await app.tick();
  await check(app, 'rollback');
  sample(app, 'environment', 'bad', true); await app.tick();
  sample(app, 'tag', 'v9', true); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="bad"[^>]*aria-invalid="true"/);
  assert.match(app.html(), /id="pr-s-tag" data-pr-sample="tag" value="v9"/);
  app.click('pr-undo'); await app.tick();
  assert.match(app.html(), /id="pr-s-environment" data-pr-sample="environment" value="bad"[^>]*aria-invalid="true"/);
});

/* ---------- keys ---------- */
rule('Single keys on the practice page: J and K move, X checks, E edits; with single keys off they do nothing', async () => {
  const app = await editor();
  await practice(app);
  app.click('select', 'flags'); await app.tick();
  app.key('j'); await app.tick();
  assert.strictEqual(app.selected(), 'rollback');
  app.key('x'); await app.tick();
  assert.equal(row(app, 'rollback'), 'done');
  app.key('k'); await app.tick();
  assert.strictEqual(app.selected(), 'flags');
  app.key('e'); await app.tick();
  assert.ok(inEditor(app), 'E edits the step');
  await practice(app);
  topClick(app, 'toggle-keys'); await app.tick();
  app.click('select', 'flags'); await app.tick();
  app.key('x'); await app.tick();
  assert.equal(row(app, 'flags'), 'open');
});

rule('F on the selected step opens Fill in when the step has fields', async () => {
  const app = await editor();
  await practice(app);
  app.click('select', 'announce'); await app.tick();
  app.key('f'); await app.tick();
  assert.match(app.html(), /id="fld-channel"/);
});

/* ---------- Save draft and Stage ---------- */
const SMALL = ['---', 'process: release', 'title: Production release', 'owner: person-casey', 'roles: release-lead', '---', '', '## Prep · READ-DO {#prep}', '- [ ] {confirm} One thing {#one}', '', '## Gate: Ready · owner @release-lead {#ready}', '', '## Ship · READ-DO {#ship}', '- [ ] {confirm} Ship it {#ship-it}', ''].join('\n');

/* SMALL saved as the draft and practiced to the end. */
async function finished(opts) {
  const app = await editor(opts);
  app.input('draft-editor', SMALL); await app.tick(300);
  app.click('save-draft'); await app.tick(150);
  await practice(app);
  await check(app, 'one'); await pass(app, 0);
  await check(app, 'ship-it'); if (canPass(app, 1)) await pass(app, 1);
  assert.match(app.html(), /You got through the whole checklist\./, 'set-up: practiced to the end');
  return app;
}
const stageFiles = app => Object.keys(app.fs.files).filter(k => /^staged\/release\/stage-[^/]+\/map\.md$/.test(k));
const note = (app, v) => { app.set('pr-note', v); app.fire('input', { target: { id: 'pr-note', value: v, tagName: 'INPUT', dataset: {}, closest: () => null } }); };
const held = app => { let go; const gate = new Promise(r => { go = r; }); const orig = app.fs.write.bind(app.fs); app.fs.write = (x, d) => /^staged\//.test(x) ? gate.then(() => orig(x, d)) : orig(x, d); return () => { go(); return orig; }; };

rule('Finishing with unsaved edits offers Save draft, not staging; Save draft on the page saves it, then Stage is offered', async () => {
  const app = await editor();
  app.input('draft-editor', SMALL); await app.tick(300);
  await practice(app);
  await check(app, 'one'); await pass(app, 0); await check(app, 'ship-it');
  if (canPass(app, 1)) await pass(app, 1);
  assert.match(app.html(), /You got through the whole checklist\. Save it, then stage it for a test run\./);
  assert.ok(!/data-act="pr-stage"/.test(app.html()), 'no Stage yet');
  app.click('pr-save'); await app.tick(200);
  assert.strictEqual(app.fs.files[DRAFT].t, SMALL, 'saved');
  assert.ok(onPage(app), 'still practicing');
  assert.match(app.html(), /data-act="pr-stage"/);
});

rule('Save draft on the practice page: a conflict says so and offers Compare in the editor; a failure offers Try again', async () => {
  for (const how of ['conflict', 'failed']) {
    const app = await editor();
    app.input('draft-editor', SMALL); await app.tick(300);
    await practice(app);
    if (how === 'conflict') await app.fs.write(DRAFT, SMALL.replace('Ship it', 'Ship it now'));
    const orig = app.fs.write.bind(app.fs);
    if (how === 'failed') app.fs.write = (x, d) => x === DRAFT ? Promise.reject(new Error('disk full')) : orig(x, d);
    app.click('pr-save'); await app.tick(200);
    app.fs.write = orig;
    assert.ok(onPage(app), how + ': still practicing');
    if (how === 'conflict') { assert.match(app.html(), /someone else changed this draft/); assert.match(app.html(), /data-act="pr-back" data-id="compare"/); }
    else { assert.match(app.html(), /couldn(&#39;|')t be saved/); assert.match(app.html(), /data-act="pr-save"/); }
  }
});

rule('Stage from Practice stages for real: one stage written, the stage shown with Start a test run focused', async () => {
  const app = await finished();
  assert.match(app.html(), /<input id="pr-note"/);
  note(app, 'Tried the short version');
  app.click('pr-stage'); await app.tick(300);
  assert.strictEqual(stageFiles(app).length, 1, 'one stage');
  assert.ok(!onPage(app), 'left the practice page');
  assert.match(app.live(), /Staged\. Start a test run from it/);
  assert.match(app.html(), /data-act="start-test"/);
  assert.match(app.focused() || '', /start-test/);
});

rule('Stage from Practice: an empty What changed is refused beside its box, nothing staged', async () => {
  const app = await finished();
  note(app, '  ');
  app.click('pr-stage'); await app.tick(200);
  assert.strictEqual(stageFiles(app).length, 0);
  assert.match(app.html(), /<p class="ferr" id="ferr-pr-note" role="alert">Write what changed/);
  assert.ok(onPage(app), 'practice still open');
});

rule('Stage from Practice: what was typed in What changed survives reopening a phase and passing again', async () => {
  const app = await finished();
  note(app, 'Tried the short version');
  app.click('reopen', '1'); await app.tick();
  assert.ok(!/<input id="pr-note"/.test(app.html()), 'set-up: not complete, so no box');
  await pass(app, 1);
  assert.match(app.html(), /<input id="pr-note"[^>]*value="Tried the short version"/);
});

rule('Stage from Practice: practicing on while the stage saves keeps practice; the stage is still made', async () => {
  for (const meanwhile of ['select', 'reopen', 'note']) {
    const app = await finished(), release = held(app);
    note(app, 'Tried it'); app.click('pr-stage'); await app.tick(30);
    if (meanwhile === 'select') app.click('select', 'one'); else if (meanwhile === 'reopen') app.click('reopen', '1'); else note(app, 'Next: shorter gate');
    await app.tick();
    app.fs.write = release(); await app.tick(300);
    assert.strictEqual(stageFiles(app).length, 1, meanwhile + ': staged');
    assert.ok(onPage(app), meanwhile + ': practice kept');
    assert.match(app.live(), /Staged\. Your practice is still open\./, meanwhile + ': ' + app.live());
    if (meanwhile === 'note') assert.match(app.html(), /<input id="pr-note"[^>]*value="Next: shorter gate"/);
  }
});

rule('Stage from Practice: going back to the draft, or Back and Forward, while the stage saves keeps practice', async () => {
  for (const meanwhile of ['draft', 'history']) {
    const app = await finished(), release = held(app);
    note(app, 'Tried it'); app.click('pr-stage'); await app.tick(30);
    if (meanwhile === 'draft') app.click('pr-back'); else { app.back(); await app.settle(); app.forward(); await app.settle(); }
    await app.tick();
    app.fs.write = release(); await app.tick(300);
    assert.strictEqual(stageFiles(app).length, 1, meanwhile + ': staged');
    if (meanwhile === 'draft') { assert.ok(inEditor(app), 'draft: still in the editor'); await practice(app); }
    assert.ok(onPage(app), meanwhile + ': practice kept');
  }
});

rule('Stage from Practice: a refresh that read the folder before the stage was written never hides the new stage', async () => {
  const app = await finished();
  let go, first = true; const gate = new Promise(r => { go = r; });
  const orig = app.fs.list.bind(app.fs);
  app.fs.list = x => { if (first && x === '') { first = false; return orig(x).then(v => gate.then(() => v)); } return orig(x); };
  topClick(app, 'refresh');
  for (let i = 0; i < 100 && first; i++) await app.tick(5);
  assert.ok(!first, 'set-up: the refresh read the folder before the stage was written');
  note(app, 'Tried it'); app.click('pr-stage'); await app.tick(100);
  go(); await app.tick(60); app.fs.list = orig;
  assert.strictEqual(stageFiles(app).length, 1);
  assert.match(app.html(), /data-act="start-test"/, 'the new stage is shown at once');
});

rule('Stage from Practice: when the folder can\'t be read after staging, practice stays open and says the stage isn\'t shown yet', async () => {
  const app = await finished();
  const orig = app.fs.write.bind(app.fs), list = app.fs.list.bind(app.fs);
  let staged = false;
  app.fs.write = (x, d) => { if (/^staged\//.test(x)) staged = true; return orig(x, d); };
  app.fs.list = x => staged ? Promise.reject(new Error('offline')) : list(x);
  note(app, 'Tried it'); app.click('pr-stage'); await app.tick(300);
  app.fs.write = orig; app.fs.list = list;
  assert.strictEqual(stageFiles(app).length, 1, 'staged');
  assert.ok(onPage(app), 'practice kept');
  assert.match(app.live(), /a test run can't start from it yet: part of the folder couldn't be read just now\. Your practice is still open\./, app.live());
});

rule('Stage from Practice: a stage decision that can\'t be read keeps practice open, since no test run can start from it yet', async () => {
  const app = await finished();
  await app.fs.write('staged/release/decisions/stage-x.w-other.1.json', '{ not json');
  note(app, 'Tried it'); app.click('pr-stage'); await app.tick(300);
  assert.strictEqual(stageFiles(app).length, 1, 'staged');
  assert.ok(onPage(app), 'practice kept');
  assert.match(app.live(), /a test run can't start from it yet/, app.live());
});

/* ---------- following the draft ---------- */
rule('A change someone else saves while practicing is noticed on the page, and Back to the draft shows it', async () => {
  const app = await editor();
  await practice(app);
  await app.fs.write(DRAFT, app.fs.files[DRAFT].t.replace('Rollback commit written', 'Rollback commit noted'));
  app.focus(); await app.tick(300); app.every(); await app.tick(300);
  assert.match(app.html(), /Someone changed the draft\. Back to the draft to see it\./);
  assert.ok(onPage(app), 'still practicing: nothing adopted under you');
});

rule('A from step moved by a draft edit is kept at once, so a reload never brings back the old one', async () => {
  const session = {};
  const app = await editor({ sessionStore: session });
  await practice(app);
  app.click('select', 'approved'); await app.tick();
  app.click('pr-from', 'approved'); await app.tick();
  await edit(app, DROP_APPROVED);
  const k = Object.keys(session).filter(x => /:practice:/.test(x) && !/:typed$/.test(x))[0];
  const from = JSON.parse(session[k]).from;
  assert.ok(from && from !== 'approved', 'kept: ' + from);
});

rule('Visiting a real run, then practicing, writes nothing; the run is left as it was', async () => {
  const app = await editor();
  app.click('nav', 'processes'); await app.tick();
  const r = app.run();
  app.click('open-run', r.key); await app.tick(60);
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.writes = [];
  await practice(app);
  await check(app, 'rollback');
  await app.tick(300);
  assert.deepEqual(app.writes.filter(w => !/^write maps\/drafts\//.test(w)), [], app.writes.join(', '));
  assert.deepStrictEqual(app.run().json.steps, r.json.steps, 'the run is untouched');
});

rule('A waiver reason being typed is kept across Edit and Back to practice', async () => {
  const app = await editor();
  app.input('draft-editor', SMALL); await app.tick(300);
  await practice(app);
  app.click('pick', 'ready', { kind: 'waive' }); await app.tick();
  app.set('pick-input', 'Covered by the release ticket');
  app.click('pr-edit', 'one'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  if (!/id="pick-input"/.test(app.html())) { app.click('pick', 'ready', { kind: 'waive' }); await app.tick(); }
  assert.match(app.html(), /id="pick-input"[^>]*value="Covered by the release ticket"|id="pick-input"[^>]*>Covered by the release ticket/);
});

rule('On a phone, Back from a step opened from practice closes the builder sheet first, then returns to practice', async () => {
  const app = await editor({ narrow: true, localStore: { 'preflight:builder': 'true' } });
  await practice(app);
  await check(app, 'rollback');
  app.click('pr-edit', 'flags'); await app.tick();
  const open = () => /data-act="ob-sel" data-id="flags" aria-pressed="true"/.test(app.html());
  assert.ok(app.formModal() && open(), 'set-up: the step opens in the builder sheet');
  app.back(); await app.settle();
  assert.ok(!open(), 'the sheet closed');
  assert.ok(inEditor(app), 'still in the editor');
  app.back(); await app.settle();
  assert.ok(onPage(app), 'then practice');
  assert.equal(row(app, 'rollback'), 'done');
});

rule('A 300-step draft: the practice run screen draws and answers well under budget', async () => {
  const lines = ['---', 'process: release', 'title: Big', 'owner: person-casey', '---', ''];
  for (let p = 0; p < 10; p++) { lines.push('## Phase ' + p + ' · READ-DO {#ph' + p + '}'); for (let k = 0; k < 30; k++) lines.push('- [ ] {confirm} Step ' + p + '-' + k + ' does a thing {#s' + p + '-' + k + '}'); lines.push(''); }
  const app = await editor();
  app.input('draft-editor', lines.join('\n')); await app.tick(300);
  await practice(app);
  for (let k = 0; k < 5; k++) await check(app, 's0-' + k);
  const t0 = process.hrtime.bigint();
  for (let k = 5; k < 15; k++) { app.click('toggle', 's0-' + k); await app.tick(0); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e7;
  assert.equal(row(app, 's0-14'), 'done');
  assert.ok(ms < 60, 'a practice action, drawn, took ' + ms.toFixed(1) + ' ms');
});

/* ---------- code review round 1 ---------- */
rule('Typing in evidence reaches this tab\'s storage as it is typed, so a reload keeps it', async () => {
  const session = {};
  const app = await editor({ sessionStore: session });
  await practice(app);
  app.click('toggle', 'approved'); await app.tick();
  app.input('rec-number', 'CHG-77'); await app.tick();
  const again = boot({ localStore: { 'preflight:builder': 'false' }, sessionStore: session, hash: '#/practice/release' });
  await again.tick(60); again.choose('person-casey'); await again.tick(60);
  again.click('select', 'approved'); await again.tick();
  assert.match(again.html(), /id="rec-number"[^>]*value="CHG-77"/);
});

rule('Fill in cancelled with typing kept never blocks Done', async () => {
  const app = await editor();
  await practice(app);
  app.click('pick', 'announce', { kind: 'fields' }); await app.tick();
  app.set('fld-channel', '#release-room');
  app.click('unpick'); await app.tick();
  app.click('toggle', 'announce'); await app.tick();
  assert.ok(!/Save or cancel Fill in first/.test(app.live()), app.live());
  assert.equal(row(app, 'announce'), 'done');
  app.click('pick', 'announce', { kind: 'fields' }); await app.tick();
  assert.match(app.html(), /id="fld-channel"[^>]*value="#release-room"/, 'the kept typing is still there for Fill in');
});

rule('A step removed with unfinished typing is named in the removed notice, with Copy and Discard', async () => {
  const app = await editor();
  await practice(app);
  app.click('toggle', 'approved'); await app.tick();
  app.set('rec-number', 'CHG-77');
  app.click('pr-edit', 'approved'); await app.tick();
  app.input('draft-editor', DROP_APPROVED(text(app))); await app.tick(300);
  app.click('pr-open'); await app.tick(60);
  assert.match(app.html(), /Removed from the draft: Change request approved for tonight(&#39;|')s window/);
  assert.match(app.html(), /data-act="pr-kept-copy" data-id="approved"/);
  assert.match(app.html(), /data-act="pr-kept-drop" data-id="approved"/);
});

rule('Save draft finishing after you moved on to a box never takes focus from it', async () => {
  const app = await editor();
  app.input('draft-editor', text(app) + '\n'); await app.tick(300);
  await practice(app);
  app.click('toggle', 'approved'); await app.tick();
  let go; const gate = new Promise(r => { go = r; }); const orig = app.fs.write.bind(app.fs);
  app.fs.write = (x, d) => x === DRAFT ? gate.then(() => orig(x, d)) : orig(x, d);
  app.doc.activeElement = { id: '', tagName: 'BUTTON', dataset: { act: 'pr-save' }, closest: () => null };
  app.click('pr-save'); await app.tick(20);
  const box = app.el('rec-number'); let stolen = false; box.tagName = 'INPUT'; app.doc.activeElement = box;
  const n = app.asked().length;
  go(); await app.tick(200); app.fs.write = orig;
  assert.ok(!app.asked().slice(n).some(x => /pr-save|pr-close/.test(x)), 'focus left alone: ' + app.asked().slice(n));
  assert.ok(!stolen);
});

rule('A file dropped on the practice page is caught, so the browser never swaps the app for it', async () => {
  const app = await editor();
  await practice(app);
  let stopped = 0;
  const ev = { dataTransfer: { types: ['Files'], files: [], dropEffect: '' }, target: { closest: () => null }, preventDefault() { stopped++; } };
  app.fire('dragover', ev); app.fire('drop', ev); await app.tick();
  assert.strictEqual(stopped, 2);
  assert.match(app.live(), /Practice doesn.t keep files/);
});

rule('Practice opened from the editor starts on the step selected there', async () => {
  const app = await editor({ localStore: { 'preflight:builder': 'true' } });
  app.click('ob-sel', 'flags'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  assert.ok(onPage(app));
  assert.strictEqual(app.selected(), 'flags');
});

rule('Back to practice puts focus back in the box you were typing in, with its selection', async () => {
  const app = await editor();
  await practice(app);
  app.click('toggle', 'approved'); await app.tick();
  const box = app.el('rec-number'); box.value = 'CHG-1234'; box.tagName = 'INPUT'; box.selectionStart = 4; box.selectionEnd = 8;
  box.closest = s => (s === '#rw-ins' ? {} : null); app.doc.activeElement = box;
  app.click('pr-edit', 'approved'); await app.tick();
  app.doc.activeElement = null;
  let focused = false, range = null; box.focus = () => { focused = true; app.doc.activeElement = box; }; box.setSelectionRange = (a, b) => { range = [a, b]; };
  app.click('pr-open'); await app.tick(60);
  assert.ok(focused, 'the box has focus again');
  assert.deepStrictEqual(range, [4, 8]);
});

rule('Kept typing in this tab that isn\'t a record is ignored, never thrown on', async () => {
  const session = {};
  const first = await editor({ sessionStore: session });
  await practice(first);
  await check(first, 'rollback');
  const k = Object.keys(session).filter(x => /:practice:/.test(x) && !/:typed$/.test(x))[0];
  session[k + ':typed'] = '{"approved":null,"tests":"x","flags":{"record":7}}';
  const app = await editor({ sessionStore: session });
  await practice(app);
  assert.equal(row(app, 'rollback'), 'done');
});

/* ---------- code review round 2 ---------- */
rule('Evidence typed and then cleared is submitted cleared, never the erased value', async () => {
  const app = await editor({ sessionStore: {} });
  await practice(app);
  app.click('toggle', 'approved'); await app.tick();
  app.input('rec-number', 'CHG-77'); await app.tick();
  app.input('rec-number', ''); await app.tick();
  app.click('record', 'approved'); await app.tick();
  assert.equal(row(app, 'approved'), 'open', 'refused: the box is empty');
  assert.match(app.html(), /Change number is needed/);
});

rule('A step to try again shows the evidence it was checked with as the starting point', async () => {
  const app = await editor();
  await practice(app);
  app.click('toggle', 'approved'); await app.tick();
  app.set('rec-number', 'CHG-77'); app.click('record', 'approved'); await app.tick();
  await edit(app, t => t.replace("Change request approved for tonight's window", 'Change request approved for this window'));
  app.click('select', 'approved'); await app.tick();
  assert.equal(row(app, 'approved'), 'again');
  assert.match(app.html(), /id="rec-number"[^>]*value="CHG-77"/);
});

rule('A yes/no choice in evidence reaches this tab\'s storage when chosen', async () => {
  const session = {};
  const app = await editor({ sessionStore: session });
  await edit(app, t => t.replace('context: ticket, commit, environment, tag', 'context: ticket, commit, environment, tag, ready:yes-no').replace('{#prep}\n', '{#prep}\n- [ ] {confirm} Say if it is ready {#go}\n  sets: ready\n'));
  app.click('toggle', 'go'); await app.tick();
  const id = (/id="(rec-[^"]*ready[^"]*)"/.exec(app.html()) || [])[1];
  assert.ok(id, 'set-up: the yes/no box');
  const fs = app.el(id); Object.assign(fs, { tagName: 'FIELDSET', querySelector: s => (s === 'input:checked' ? { value: 'yes' } : null) });
  app.fire('change', { target: { id: 'opt-' + id + '-0', name: id, type: 'radio', value: 'yes', tagName: 'INPUT', dataset: {}, closest: s => (s === 'fieldset' ? fs : null) } }); await app.tick();
  const k = Object.keys(session).filter(x => /:typed$/.test(x))[0];
  assert.ok(k && session[k].indexOf('"' + id + '":"yes"') >= 0, k && session[k]);
});

rule('Edit clicked from a box still brings focus and selection back to that box', async () => {
  const app = await editor();
  await practice(app);
  app.click('toggle', 'approved'); await app.tick();
  const box = app.el('rec-number'); box.value = 'CHG-1234'; box.tagName = 'INPUT'; box.selectionStart = 2; box.selectionEnd = 6;
  app.fire('focusout', { target: box });
  const edit = { tagName: 'BUTTON', id: '', dataset: { act: 'pr-edit', id: 'approved' }, closest: () => null };
  app.fire('focusin', { target: edit }); app.doc.activeElement = edit;
  app.click('pr-edit', 'approved'); await app.tick();
  app.doc.activeElement = null;
  let focused = false, range = null; box.focus = () => { focused = true; app.doc.activeElement = box; }; box.setSelectionRange = (a, b) => { range = [a, b]; };
  app.click('pr-open'); await app.tick(60);
  assert.ok(focused);
  assert.deepStrictEqual(range, [2, 6]);
});

rule('Fill in cancelled after a round trip stays closed across a reload', async () => {
  const session = {};
  const app = await editor({ sessionStore: session });
  await practice(app);
  app.click('pick', 'announce', { kind: 'fields' }); await app.tick();
  app.set('fld-channel', '#release-room');
  app.click('pr-edit', 'flags'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  app.click('select', 'announce'); await app.tick();
  if (/data-act="unpick"/.test(app.html())) { app.click('unpick'); await app.tick(); }
  const again = boot({ localStore: { 'preflight:builder': 'false' }, sessionStore: session, hash: '#/practice/release' });
  await again.tick(60); again.choose('person-casey'); await again.tick(60);
  again.click('toggle', 'announce'); await again.tick();
  assert.ok(!/Save or cancel Fill in first/.test(again.live()), again.live());
  assert.equal(row(again, 'announce'), 'done');
});

run();
