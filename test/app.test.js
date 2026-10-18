// The app's own wiring, run against the real built file with a stand-in browser: races between recovery, saving and
// switching folders, paused at exact moments.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate, bus, locks } = require('./app-harness');

// The draft-editor tests below type into the Markdown, so this browser remembers choosing Markdown over the builder.
async function recordingRelease() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } });
  await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick();
  app.click('pickup'); await app.tick(40);
  assert.strictEqual(app.run().json.recorder.person, 'person-casey', 'set-up: Casey is recording');
  return app;
}

rule('App: pausing a run records why, freezes its steps, and Resume adds the pause to the run', async () => {
  const app = await recordingRelease();
  app.click('pick', 'run', { kind: 'pause' }); await app.tick();
  app.set('pick-input', 'Waiting for the change board'); app.click('pause', 'run'); await app.tick(40);
  let j = app.run().json;
  assert.ok(j.paused && j.paused.reason === 'Waiting for the change board', 'saved as paused');
  assert.ok(/data-act="resume"/.test(app.html()));
  app.click('na', 'announce'); await app.tick(40);
  assert.ok(!app.run().json.steps.announce || app.run().json.steps.announce.s !== 'na', 'no step changes while paused');
  app.click('resume', 'run'); await app.tick(40);
  j = app.run().json;
  assert.ok(!j.paused && j.pauses[j.pauses.length - 1].reason === 'Waiting for the change board', 'the new pause is added to the history');
});

rule('App: a run-another-process step starts a linked child run, and the parent step is checked when the child completes', async () => {
  const app = await recordingRelease();
  app.click('reopen', '0'); await app.tick(40);
  // The example's child run was for commit d9d8514; a new commit means the step needs a new child run.
  app.click('edit', 'detail:commit'); app.set('edit-input', 'f00d123'); app.click('save-edit'); await app.tick(40);
  app.click('clear', 'notes'); await app.tick(40);
  app.click('start-child', 'notes'); await app.tick(80);
  const parent = app.run().json, link = parent.steps.notes.child;
  assert.ok(link && link.process === 'check-in', 'parent step links the child');
  const cpath = Object.keys(app.fs.files).find(p => p === 'runs/check-in/' + link.id + '/run.json');
  assert.ok(cpath, 'child run saved');
  const child = JSON.parse(app.fs.files[cpath].t);
  assert.deepStrictEqual({ process: child.parent.process, id: child.parent.id, step: child.parent.step }, { process: 'release', id: parent.id, step: 'notes' });
  assert.strictEqual(child.parent.inputs.commit, 'f00d123', 'the child records the details it was started for');
  assert.strictEqual(link.inputs.commit, 'f00d123');
  assert.strictEqual(child.details.commit, parent.details.commit, 'carried detail');
  // The child is finished elsewhere.
  child.ended = { outcome: 'Completed', by: 'person-avery', at: new Date().toISOString() }; child.state = 'completed'; child.rev = (child.rev || 0) + 1;
  await app.fs.write(cpath, JSON.stringify(child));
  app.click('refresh'); await app.tick(80);
  assert.strictEqual(app.run().json.steps.notes.s, 'done', 'parent step checked');
});

rule('App: clicking Start twice on a child-run step starts one child, and a step that can\'t take one leaves nothing behind', async () => {
  const app = await recordingRelease();
  app.click('reopen', '0'); await app.tick(40);
  // The example's child run was for commit d9d8514; a new commit means the step needs a new child run.
  app.click('edit', 'detail:commit'); app.set('edit-input', 'f00d123'); app.click('save-edit'); await app.tick(40);
  app.click('clear', 'notes'); await app.tick(40);
  const children = () => app.files('runs/check-in/').filter(p => /run\.json$/.test(p)).length, before = children();
  app.click('start-child', 'notes'); app.click('start-child', 'notes'); await app.tick(100);
  assert.strictEqual(children(), before + 1, 'one child run');
  app.click('pick', 'run', { kind: 'pause' }); await app.tick(); app.set('pick-input', 'x'); app.click('pause', 'run'); await app.tick(40);
  app.click('start-child', 'announce'); await app.tick(60);
  assert.strictEqual(children(), before + 1, 'no orphan from a refused start');
});

rule('App: a commit change or a pause while a child run is saving never links the child to the wrong details or leaves it unlinked', async () => {
  const app = await recordingRelease();
  app.click('reopen', '0'); await app.tick(40);
  app.click('edit', 'detail:commit'); app.set('edit-input', 'f00d123'); app.click('save-edit'); await app.tick(40);
  app.click('clear', 'notes'); await app.tick(40);
  const orig = app.PF.repo.saveRun, g = gate(); let held = false;
  app.PF.repo.saveRun = function (fs, run) { const args = arguments; if (!held && run.process === 'check-in') { held = true; return g.p.then(() => orig.apply(this, args)); } return orig.apply(this, args); };
  app.click('start-child', 'notes'); await app.tick(20);
  app.click('edit', 'detail:commit'); app.set('edit-input', 'beef456'); app.click('save-edit'); await app.tick(40);
  app.click('pick', 'run', { kind: 'pause' }); await app.tick(); app.set('pick-input', 'Waiting'); app.click('pause', 'run'); await app.tick(40);
  g.open(); await app.tick(100);
  app.PF.repo.saveRun = orig;
  const link = app.run().json.steps.notes.child;
  assert.ok(link && link.inputs.commit === 'f00d123', 'linked even though the run was paused meanwhile, with the details it was started for');
  assert.ok(/no longer counts/.test(app.html()) || app.run().json.steps.notes.s !== 'done', 'and it doesn\'t count for the new commit');
});

rule('App: examples created just after midnight keep the sprint\'s clock times on the same day as the run', async () => {
  const real = Date, base = new real(); base.setHours(0, 15, 0, 0);
  const offset = base.getTime() - real.now();
  class FakeDate extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + offset); } static now() { return real.now() + offset; } }
  const app = boot({ Date: FakeDate });
  await app.tick(80);
  const k = Object.keys(app.fs.files).find(p => /^runs\/sprint-start\/[^/]+\/run\.json$/.test(p));
  const run = JSON.parse(app.fs.files[k].t), created = new real(run.created);
  assert.strictEqual(created.toDateString(), base.toDateString(), 'the run starts today');
  const R = app.PF.run, items = R.schedule(R.sanitize(run), R.mapOf(R.sanitize(run)), FakeDate.now());
  assert.ok(items.length === 2 && items.every(it => it.ms > FakeDate.now() && it.ms - FakeDate.now() < 24 * 3600000), 'both times are later today');
});

rule('App: editing a team step type that a published checklist uses offers to republish it', async () => {
  const app = await recordingRelease();
  const f = 'step-types/change.request.json', def = JSON.parse(app.fs.files[f].t);
  def.label = 'Change request (CAB)';
  await app.fs.write(f, JSON.stringify(def));
  app.click('refresh'); await app.tick(80);
  app.click('home'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  assert.ok(/Step type change\.request changed since v\d+; publish to use it/.test(app.html()), "shown as a change");
  app.set('change-note', 'New change request label'); app.click('publish', 'release'); await app.tick(80);
  const pubs = app.files('publications/release/').filter(p => /types\.json$/.test(p)).map(p => JSON.parse(app.fs.files[p].t));
  assert.ok(pubs.some(t => t['change.request'] && t['change.request'].label === 'Change request (CAB)'), 'v2 freezes the new definition');
});

rule('App: choosing a Jira action in Fill in shows the fields it needs, so a transition can be saved in one go', async () => {
  const app = await recordingRelease();
  app.click('unfold', 'verify'); await app.tick();
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  app.set('fld-action', 'update'); app.set('fld-status', ''); app.set('fld-issue', 'ABC-4764'); app.set('fld-issueType', 'Release');
  app.click('save-fields', 'close'); await app.tick(40);
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  assert.ok(!/id="fld-status"/.test(app.html()), 'an update has no Move to');
  app.select('fld-action', 'transition'); await app.tick();
  assert.ok(/id="fld-status"/.test(app.html()), 'choosing transition shows Move to before saving');
  app.set('fld-status', 'Done');
  app.click('save-fields', 'close'); await app.tick(40);
  const f = app.run().json.fields.close || {};
  assert.ok((f.action || 'transition') === 'transition' && (f.status || 'Done') === 'Done' && !/Fill in the status/.test(app.html()), 'saved: ' + JSON.stringify(f));
});

rule('App: Fill in checks evidence against the fields being saved, so switching issue type uses that workflow\'s choices', async () => {
  const app = await recordingRelease();
  app.click('unfold', 'verify'); await app.tick();
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  const key = app.PF.jira.key('Resolution');
  app.set('fld-action', 'transition'); app.set('fld-issue', 'ABC-4764'); app.set('fld-status', 'Done'); app.set('fld-issueType', 'Story'); app.set('rec-' + key, 'Done');
  app.click('save-fields', 'close'); await app.tick(40);
  assert.ok(!/should be one of: Released/.test(app.html()), 'checked against Story, not Release');
  assert.strictEqual((app.run().json.fields.close || {}).issueType, 'Story');
  assert.strictEqual(app.run().json.steps.close.values[key], 'Done');
});

rule('App: a process shows as a flight plan, and choosing a phase in it goes back to that phase in the checklist', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  assert.ok(/class="ph"/.test(app.html()) && !/class="fp"/.test(app.html()), 'the checklist first');
  app.click('flight', 'plan'); await app.tick();
  assert.ok(/<ol class="fp"/.test(app.html()) && /data-act="flight" data-id="plan" aria-pressed="true"/.test(app.html()), 'the flight plan');
  assert.ok(/No runs of this version yet\./.test(app.html()) && !/Typically/.test(app.html()) && /<b>Connecting<\/b>/.test(app.html()), 'the current version has no runs of its own yet; its linked check-in shows');
  const v1 = /data-act="view-version" data-id="(v1-[^"]+)"/.exec(app.html())[1];
  app.click('view-version', v1); await app.tick();
  assert.ok(/<ol class="fp"/.test(app.html()) && /Typically/.test(app.html()) && /From \d+ runs of v1;/.test(app.html()), 'v1, which the example runs used, shows their times');
  app.click('flight', 'list'); await app.tick();
  assert.ok(/class="ph"/.test(app.html()) && !/class="fp"/.test(app.html()), 'and back');
  app.click('flight', 'plan'); await app.tick();
  app.click('flight-phase', '1'); await app.tick();
  assert.ok(/<h3 id="cl-ph-1" tabindex="-1">/.test(app.html()) && !/class="fp"/.test(app.html()) && /data-act="flight" data-id="list" aria-pressed="true"/.test(app.html()), 'a phase opens the checklist at that phase');
});

rule('App: the sections switch from the top bar, and Home never opens a run by itself', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  assert.ok(/Needs you/.test(app.html()) && !/id="phase-/.test(app.html()), 'Home lists, it doesn\'t open');
  for (const s of ['runs', 'processes', 'skills', 'types', 'settings', 'home']) { app.click('nav', s); await app.tick(); assert.ok(new RegExp('data-id="' + s + '" aria-current="page"').test(app.top()), s); }
});

/* A focused step row in the builder, as the keyboard handler sees it. */
const rowOf = key => ({ tagName: 'BUTTON', dataset: { act: 'ob-sel', id: key }, closest: sel => /data-ob-step/.test(sel) ? { dataset: { obStep: key } } : null });
const idsOf = (PF, t) => JSON.parse(JSON.stringify(PF.map.steps(PF.map.parse(t)).map(x => x.step.id)));
/* The lines one text has and the other doesn't, counted (a moved line is in both, so it cancels out). */
function lineDelta(a, b) {
  const count = t => t.split('\n').reduce((m, l) => (m[l] = (m[l] || 0) + 1, m), {});
  const A = count(a), B = count(b), gone = [], added = [];
  Object.keys(A).forEach(l => { for (let i = (B[l] || 0); i < A[l]; i++) gone.push(l); });
  Object.keys(B).forEach(l => { for (let i = (A[l] || 0); i < B[l]; i++) added.push(l); });
  return { gone: gone.sort(), added: added.sort() };
}

rule('App: the draft builder moves, edits, adds and deletes steps and adds a phase; the saved Markdown changes only those lines and keeps every ID', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t, PF = app.PF;
  assert.ok(/class="ob" id="ob"/.test(app.html()) && /data-act="ed-mode" data-id="builder" aria-pressed="true"/.test(app.html()), 'the builder is the default');
  app.click('ob-sel', 'flags'); await app.tick();
  assert.ok(/id="ob-text"/.test(app.html()), 'selecting a step opens its form');
  app.click('ob-move', 'flags', { dir: 'up' }); await app.tick();
  app.keyOn('ArrowUp', { altKey: true }, rowOf('rollback')); await app.tick();
  app.keyOn('ArrowUp', { altKey: false }, rowOf('rollback')); await app.tick();
  app.select('ob-fld-where', 'The values file'); await app.tick();
  app.click('ob-role', 'qa'); await app.tick();
  app.click('ob-add-after', 'flags'); await app.tick();
  app.set('ob-new-text', 'Check the dashboards'); app.click('ob-add-go'); await app.tick();
  assert.ok(/<li class="ob-step sel"[^>]*data-ob-step="check-the-dashboards">/.test(app.html()), 'the new step is selected');
  app.click('ob-del', 'announce'); await app.tick();
  app.click('ob-add-phase'); await app.tick();
  app.set('ob-new-title', 'Watch the metrics'); app.select('ob-new-mode', 'DO-CONFIRM'); app.click('ob-add-go'); await app.tick();
  assert.ok(/id="ob-new-text"/.test(app.html()), 'a new phase opens with its add-a-step box');
  app.set('ob-new-text', 'Error rate is flat'); app.click('ob-add-go'); await app.tick();
  assert.ok(/Unsaved changes/.test(app.html()), 'builder edits are unsaved, like typing');
  assert.strictEqual(app.fs.files[path].t, original, 'nothing written yet');
  app.click('save-draft'); await app.tick(80);
  const saved = app.fs.files[path].t;
  const announce = original.split('\n').filter(l => /\{#announce\}|channel: #team-releases|Starting the production release/.test(l)).slice(0, 3);
  const d = lineDelta(original, saved);
  assert.deepStrictEqual(d.gone, ['- [!] {confirm} Feature flags set in the deploy values ^environment @backend {#flags}'].concat(announce).sort(), 'gone: Announce, and the old Flags line');
  assert.deepStrictEqual(d.added, ['', '## Watch the metrics · DO-CONFIRM {#watch-the-metrics}', '- [ ] {confirm} Check the dashboards {#check-the-dashboards}', '- [ ] {confirm} Error rate is flat {#error-rate-is-flat}',
    '- [!] {confirm} Feature flags set in the deploy values ^environment @backend @qa {#flags}', '  where: The values file'].sort(), 'added: only what was asked for');
  const was = idsOf(PF, original), now = idsOf(PF, saved);
  assert.deepStrictEqual(now.slice(0, 5), ['approved', 'flags', 'check-the-dashboards', 'rollback', 'tests'], 'moved by button and by Alt+Up, and not by a bare arrow');
  assert.deepStrictEqual(now.filter(x => was.includes(x)).sort(), was.filter(x => x !== 'announce').sort(), 'every other ID kept');
  assert.ok(!/Unsaved changes/.test(app.html()), 'saved');
});

rule('App: the builder\'s Undo puts back the last change, and the Markdown view lists the lines changed', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-del', 'rollback'); await app.tick();
  assert.ok(!/data-ob-step="rollback"/.test(app.html()) && /Step deleted/.test(app.html()));
  app.click('ob-undo'); await app.tick();
  assert.ok(/data-ob-step="rollback"/.test(app.html()) && !/Unsaved changes/.test(app.html()), 'back, and nothing left unsaved');
  app.click('ob-sel-phase', 'verify'); await app.tick();
  app.set('ob-ph-title', 'Verify it'); app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'ob-ph-title', value: 'Verify it', dataset: { enter: 'ob-commit' }, closest: () => null }); await app.tick();
  app.click('ed-mode', 'markdown'); await app.tick();
  assert.strictEqual(app.store['preflight:builder'], 'false', 'the choice is remembered in this browser');
  assert.ok(/id="draft-editor"/.test(app.html()) && /Changed lines · 1 new or changed, 1 removed/.test(app.html()) && /<code>## Verify it · READ-DO \{#verify\}<\/code>/.test(app.html()));
  app.click('ed-mode', 'builder'); await app.tick();
  assert.ok(/id="ob"/.test(app.html()));
});

/* The builder open on the release draft, as Casey. */
async function builderOn() {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  return app;
}

rule('App: once the editor follows a newer draft from the folder, Undo can\'t bring back the older text over it', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-sel', 'flags'); await app.tick();
  app.select('ob-mark', 'step'); await app.tick();
  app.select('ob-mark', 'must'); await app.tick();
  assert.ok(!/Unsaved changes/.test(app.html()), 'set-up: back to the saved text, with two Undo steps');
  const theirs = original.replace('title: Production release', 'title: Theirs');
  await app.fs.write(path, theirs);
  app.focus(); await app.tick(80);
  assert.ok(/data-act="ob-undo" disabled/.test(app.html()), 'nothing to undo against their version');
  app.click('ob-undo'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.strictEqual(app.fs.files[path].t, theirs, 'their change is still on disk');
});

rule('App: the builder\'s side form shows the step as the folder has it now, and keeps typing when nothing underneath changed', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-sel', 'flags'); await app.tick();
  app.setScoped('ob-text', 'Half typed');
  /* A change elsewhere in the draft leaves what's being typed alone. */
  await app.fs.write(path, original.replace('title: Production release', 'title: Theirs'));
  app.focus(); await app.tick(80);
  assert.strictEqual(app.draft('ob-text'), 'Half typed', 'still there');
  /* A change to this step replaces the box's old value with the new text. */
  await app.fs.write(path, original.replace('title: Production release', 'title: Theirs').replace('Feature flags set in the deploy values', 'Flags set by them'));
  app.focus(); await app.tick(80);
  assert.ok(/id="ob-text" maxlength="200" data-enter="ob-commit" value="Flags set by them"/.test(app.html()), 'drawn from the new text');
  assert.notStrictEqual(app.draft('ob-text'), 'Half typed', 'the old value isn\'t carried over');
});

rule('App: moving a phase without an ID keeps it selected, so the next change goes to that phase', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md';
  await app.fs.write(path, ['---', 'process: release', 'title: Production release', '---', '', '## First · READ-DO', '- [ ] {confirm} One {#one}', '', '## Second · READ-DO', '- [ ] {confirm} Two {#two}', ''].join('\n'));
  app.focus(); await app.tick(80);
  app.click('ob-sel-phase', '#0'); await app.tick();
  app.click('ob-ph-move', '#0', { dir: 'down' }); await app.tick();
  assert.ok(/<li class="ob-phase sel"><div class="ob-ph-head"><div class="fp-eye">Phase 2/.test(app.html()), 'the moved phase is still the selected one');
  app.set('ob-ph-title', 'First, renamed'); app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'ob-ph-title', value: 'First, renamed', dataset: { enter: 'ob-commit' }, closest: () => null }); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const t = app.fs.files[path].t;
  assert.ok(/## Second · READ-DO\n- \[ \] \{confirm\} Two \{#two\}\n\n## First, renamed · READ-DO\n- \[ \] \{confirm\} One \{#one\}/.test(t), t);
});

rule('App: Undo puts the selection back with the text, so a phase without an ID stays the one selected', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md';
  await app.fs.write(path, ['---', 'process: release', 'title: Production release', '---', '', '## First · READ-DO', '- [ ] {confirm} One {#one}', '', '## Second · READ-DO', '- [ ] {confirm} Two {#two}', ''].join('\n'));
  app.focus(); await app.tick(80);
  app.click('ob-sel-phase', '#0'); await app.tick();
  app.click('ob-ph-move', '#0', { dir: 'down' }); await app.tick();
  app.click('ob-undo'); await app.tick();
  assert.ok(/<li class="ob-phase sel"><div class="ob-ph-head"><div class="fp-eye">Phase 1/.test(app.html()), 'First is selected again, back in first place');
  app.set('ob-ph-title', 'First, renamed'); app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'ob-ph-title', value: 'First, renamed', dataset: { enter: 'ob-commit' }, closest: () => null }); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const t = app.fs.files[path].t;
  assert.ok(/## First, renamed · READ-DO\n- \[ \] \{confirm\} One \{#one\}\n\n## Second · READ-DO/.test(t), t);
});

rule('App: a value the builder refuses shows why next to its box, marked invalid for screen readers', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'flags'); await app.tick();
  app.set('ob-text', 'Ask @qa'); app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'ob-text', value: 'Ask @qa', dataset: { enter: 'ob-commit' }, closest: () => null }); await app.tick();
  assert.ok(/<input id="ob-text"[^>]* aria-invalid="true" aria-describedby="ferr-ob-text">/.test(app.html()), 'the box is marked');
  assert.ok(/<p class="ferr" id="ferr-ob-text" role="alert">Choose roles and run details with their buttons/.test(app.html()), 'the reason is next to it');
  app.click('ob-sel', 'rollback'); await app.tick();
  assert.ok(!/aria-invalid="true"/.test(app.html()), 'gone once another step is selected');
});

rule('App: a builder edit saved over someone else\'s change is stopped like any other; keep mine saves the builder\'s text', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-sel', 'pods'); await app.tick();
  app.select('ob-mark', 'step'); await app.tick();
  await app.fs.write(path, original.replace('title: Production release', 'title: Theirs'));
  app.click('save-draft'); await app.tick(60);
  assert.ok(/Someone else changed this draft/.test(app.html()) && /title: Theirs/.test(app.fs.files[path].t), 'stopped, theirs kept');
  app.click('draft-keep-mine'); await app.tick(80);
  assert.ok(/- \[ \] \{run\.command\} New pods stay up/.test(app.fs.files[path].t), 'mine saved');
});

rule('App: a draft saved over someone else\'s change is stopped and shows both; keep mine or take theirs', async () => {
  const app = await recordingRelease();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.input('draft-editor', original.replace('title: Production release', 'title: Mine')); await app.tick(300);
  await app.fs.write(path, original.replace('title: Production release', 'title: Theirs'));
  app.click('save-draft'); await app.tick(60);
  assert.ok(/Someone else changed this draft/.test(app.html()), 'stopped');
  assert.ok(/title: Theirs/.test(app.fs.files[path].t), 'their change is still on disk');
  app.click('draft-keep-mine'); await app.tick(80);
  assert.ok(/title: Mine/.test(app.fs.files[path].t), 'keep mine saves over it, deliberately');
});

rule('App: after a save, a newer draft from someone else replaces the editor\'s text, so the next save never overwrites it', async () => {
  const app = await recordingRelease();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.input('draft-editor', original.replace('title: Production release', 'title: A')); await app.tick(300);
  app.click('save-draft'); await app.tick(80);
  assert.ok(/title: A/.test(app.fs.files[path].t), 'saved A');
  await app.fs.write(path, original.replace('title: Production release', 'title: B'));
  app.focus(); await app.tick(80);
  assert.ok(/title: B/.test(app.html()) && !/title: A\b/.test(app.html()), 'the editor shows B');
  app.click('save-draft'); await app.tick(80);
  assert.ok(/title: B/.test(app.fs.files[path].t), 'B is still there');
});

rule('App: after Take theirs the editor stays on their version, and editing continues from it', async () => {
  const app = await recordingRelease();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.input('draft-editor', original.replace('title: Production release', 'title: Mine')); await app.tick(300);
  await app.fs.write(path, original.replace('title: Production release', 'title: Theirs'));
  app.click('save-draft'); await app.tick(60);
  app.click('draft-take-theirs'); await app.tick(300);
  assert.ok(/title: Theirs/.test(app.html()) && !/title: Mine/.test(app.html()), 'shows theirs');
  app.input('draft-editor', original.replace('title: Production release', 'title: Theirs, then mine')); await app.tick(300);
  app.click('save-draft'); await app.tick(80);
  assert.ok(/title: Theirs, then mine/.test(app.fs.files[path].t), 'saved without another conflict');
});

rule('App: a folder read that started before Take theirs never puts back an older draft', async () => {
  const app = await recordingRelease();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t, read = app.fs.read.bind(app.fs);
  app.input('draft-editor', original.replace('title: Production release', 'title: Mine')); await app.tick(300);
  await app.fs.write(path, original.replace('title: Production release', 'title: B'));
  /* A refresh reads B, then stalls before it finishes. */
  let hold = gate(), armed = true;
  app.fs.read = p => { const r = read(p); if (p === path && armed) { armed = false; return r.then(v => hold.p.then(() => v)); } return r; };
  app.focus(); await app.tick(5);
  await app.fs.write(path, original.replace('title: Production release', 'title: C'));
  app.click('save-draft'); await app.tick(60);
  app.click('draft-take-theirs'); await app.tick(300);
  assert.ok(/title: C/.test(app.html()), 'took C');
  hold.open(); await app.tick(80);
  assert.ok(/title: C/.test(app.html()) && !/title: B/.test(app.html()), 'the stalled read of B is ignored');
});

rule('App: after Take theirs, a later read that finds an earlier text again is followed', async () => {
  const app = await recordingRelease();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.input('draft-editor', original.replace('title: Production release', 'title: Mine')); await app.tick(300);
  await app.fs.write(path, original.replace('title: Production release', 'title: C'));
  app.click('save-draft'); await app.tick(60);
  app.click('draft-take-theirs'); await app.tick(300);
  await app.fs.write(path, original);
  app.focus(); await app.tick(80);
  assert.ok(/title: Production release/.test(app.html()) && !/title: C/.test(app.html()), 'shows the folder as it is now');
});

rule('App: a skill removed while its page is open says so, with the way back', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'skills'); await app.tick(); app.click('open-skill', 'release-deploy.json'); await app.tick();
  const f = app.files('skills/').find(p => /release-deploy/.test(p)); delete app.fs.files[f];
  app.focus(); await app.tick(80);
  assert.ok(/role="alert">That skill isn(&#39;|')t registered in this folder any more/.test(app.html()) && /id="page-back"/.test(app.html()));
});

rule('App: a slow step-type open never replaces a form opened after it', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick();
  const read = app.fs.read.bind(app.fs), g = gate();
  app.fs.read = p => p === 'step-types/change.request.json' ? read(p).then(v => g.p.then(() => v)) : read(p);
  app.click('edit-type', 'change.request'); await app.tick(5);
  app.click('new-type'); await app.tick(); app.input('tf-id', 'risk.call'); await app.tick(300);
  g.open(); await app.tick(80);
  assert.ok(/id="tf-id"[^>]*value="risk.call"/.test(app.html()) && !/Edit \{change.request\}/.test(app.html()), 'the new form stays');
});

rule('App: a slow step-type open does nothing once someone has gone Home and on to a run', async () => {
  const app = await recordingRelease();
  app.click('nav', 'types'); await app.tick();
  const read = app.fs.read.bind(app.fs), g = gate();
  app.fs.read = p => p === 'step-types/change.request.json' ? read(p).then(v => g.p.then(() => v)) : read(p);
  app.click('edit-type', 'change.request'); await app.tick(5);
  app.click('nav', 'home'); await app.tick();
  g.open(); await app.tick(80);
  assert.ok(!/id="type-form"/.test(app.html()), 'stays where the person went');
});

rule('App: changing a new type\'s ID while it saves keeps the form a new type under the new ID', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  app.input('tf-id', 'risk.call'); app.input('tf-label', 'Risk call'); await app.tick(300);
  const write = app.fs.write.bind(app.fs), g = gate();
  app.fs.write = (p, t) => p === 'step-types/risk.call.json' ? g.p.then(() => write(p, t)) : write(p, t);
  app.submit('type-form'); await app.tick(5);
  app.input('tf-id', 'risk.later'); await app.tick(300);
  g.open(); await app.tick(80);
  assert.ok(/New step type/.test(app.html()) && !/readonly/.test(/<input id="tf-id"[^>]*>/.exec(app.html())[0]), 'still a new type, ID editable');
  app.submit('type-form'); await app.tick(120);
  assert.ok(app.fs.files['step-types/risk.later.json'] && app.fs.files['step-types/risk.call.json'], 'both saved, no false conflict');
});

rule('App: a slow new process never takes someone away from where they went', async () => {
  const app = await recordingRelease();
  app.click('nav', 'processes'); await app.tick(); app.click('new-process'); await app.tick();
  app.set('np-id', 'risk-review'); app.set('np-title', 'Risk review');
  const write = app.fs.write.bind(app.fs), g = gate();
  app.fs.write = (p, t) => p === 'maps/drafts/risk-review.md' ? g.p.then(() => write(p, t)) : write(p, t);
  app.submit('new-process-form'); await app.tick(5);
  app.click('nav', 'home'); await app.tick();
  g.open(); await app.tick(120);
  assert.ok(app.fs.files['maps/drafts/risk-review.md'], 'created');
  assert.ok(!/id="draft-editor"/.test(app.html()) && /Created the draft for &quot;Risk review&quot;|Created the draft for "Risk review"/.test(app.html()), 'stayed, and said where it is');
});

rule('App: a restore that can\'t be written keeps the unsaved draft edits', async () => {
  const app = await recordingRelease();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.input('draft-editor', original + '\n<!-- unsaved -->\n'); await app.tick(300);
  app.click('ptab', 'overview'); await app.tick();
  const folder = [...app.html().matchAll(/data-act="view-version" data-id="([^"]+)"/g)].pop()[1];
  app.click('view-version', folder); await app.tick();
  const write = app.fs.write.bind(app.fs);
  app.fs.write = (p, t) => p === path ? Promise.reject(new Error('disk full')) : write(p, t);
  app.click('restore-draft', folder); await app.tick();
  assert.ok(/Replace the draft/.test(app.html()), 'asks first');
  app.click('restore-draft', folder, { sure: '1' }); await app.tick(80);
  assert.ok(/disk full/.test(app.html()), 'says it failed');
  app.fs.write = write;
  app.click('ptab', 'edit'); await app.tick();
  assert.ok(/unsaved --&gt;/.test(app.html()), 'the edits are still there');
});

rule('App: a second save waits for the first, so it never conflicts with this window\'s own save', async () => {
  const app = await recordingRelease();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t, write = app.fs.write.bind(app.fs), g = gate();
  app.fs.write = (p, t) => p === path ? g.p.then(() => write(p, t)) : write(p, t);
  app.input('draft-editor', original.replace('title: Production release', 'title: A')); await app.tick(300);
  app.click('save-draft'); await app.tick(5);
  app.input('draft-editor', original.replace('title: Production release', 'title: B')); await app.tick(300);
  app.click('save-draft'); await app.tick(5);
  assert.ok(/Still saving this draft/.test(app.html()), 'the second save waits');
  g.open(); await app.tick(80); app.fs.write = write;
  app.click('save-draft'); await app.tick(80);
  assert.ok(/title: B/.test(app.fs.files[path].t) && !/Someone else changed this draft/.test(app.html()), 'B saves without a false conflict');
});

rule('App: while a restore saves, the draft can\'t be edited, so nothing typed is replaced', async () => {
  const app = await recordingRelease();
  app.click('open-process', 'release'); await app.tick();
  const path = 'maps/drafts/release.md', write = app.fs.write.bind(app.fs), g = gate();
  const folder = [...app.html().matchAll(/data-act="view-version" data-id="([^"]+)"/g)].pop()[1];
  app.click('view-version', folder); await app.tick();
  app.fs.write = (p, t) => p === path ? g.p.then(() => write(p, t)) : write(p, t);
  app.click('restore-draft', folder); await app.tick();
  if (/Replace the draft/.test(app.html())) { app.click('restore-draft', folder, { sure: '1' }); await app.tick(); }
  assert.ok(/Restoring…/.test(app.html()), 'says it is restoring');
  app.click('ptab', 'edit'); await app.tick();
  assert.ok(!/id="draft-editor"/.test(app.html()) && /You can edit it when that finishes/.test(app.html()), 'no editing meanwhile');
  g.open(); await app.tick(80);
  app.click('ptab', 'edit'); await app.tick();
  assert.ok(/id="draft-editor"/.test(app.html()), 'editable once restored');
});

rule('App: while Keep mine saves, Take theirs can\'t undo it halfway', async () => {
  const app = await recordingRelease();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t, write = app.fs.write.bind(app.fs);
  app.input('draft-editor', original.replace('title: Production release', 'title: Mine')); await app.tick(300);
  await app.fs.write(path, original.replace('title: Production release', 'title: Theirs'));
  app.click('save-draft'); await app.tick(60);
  const g = gate(); app.fs.write = (p, t) => p === path ? g.p.then(() => write(p, t)) : write(p, t);
  app.click('draft-keep-mine'); await app.tick(5);
  assert.ok(!/data-act="draft-take-theirs"/.test(app.html()), 'no Take theirs while saving');
  app.click('draft-take-theirs'); await app.tick();
  g.open(); await app.tick(80);
  assert.ok(/title: Mine/.test(app.fs.files[path].t) && /title: Mine/.test(app.html()), 'mine, consistently');
});

rule('App: a draft removed while it has unsaved edits can be saved again', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick(); app.click('new-process'); await app.tick();
  app.set('np-id', 'risk-review'); app.set('np-title', 'Risk review'); app.submit('new-process-form'); await app.tick(120);
  const path = 'maps/drafts/risk-review.md';
  app.input('draft-editor', app.fs.files[path].t + '\n<!-- kept -->\n'); await app.tick(300);
  delete app.fs.files[path];
  app.focus(); await app.tick(80);
  assert.ok(/This draft was removed from the folder/.test(app.html()) && /kept --&gt;/.test(app.html()), 'the edits are shown');
  app.click('nav', 'types'); await app.tick(); app.click('nav', 'processes'); await app.tick();
  assert.ok(/unsaved edits to <b>risk-review<\/b>/.test(app.html()), 'still findable after leaving');
  app.click('nav', 'home'); await app.tick();
  assert.ok(/Unsaved edits to &quot;risk-review&quot;|Unsaved edits to "risk-review"/.test(app.html()), 'and on Home');
  app.click('open-process', 'risk-review'); await app.tick();
  app.click('recover-draft'); await app.tick(120);
  assert.ok(app.fs.files[path] && /kept -->/.test(app.fs.files[path].t), 'saved again');
});

rule('App: publishing waits for a save in flight, and never publishes a draft other than the one shown', async () => {
  const app = await recordingRelease();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t, write = app.fs.write.bind(app.fs), g = gate();
  app.fs.write = (p, t) => p === path ? g.p.then(() => write(p, t)) : write(p, t);
  app.input('draft-editor', original.replace('title: Production release', 'title: Corrected')); await app.tick(300);
  app.click('save-draft'); await app.tick(5);
  app.click('ptab', 'overview'); await app.tick();
  app.set('change-note', 'Correct the title');
  const before = app.files('publications/release/').length;
  app.click('publish', 'release'); await app.tick(40);
  assert.ok(/Still saving this draft/.test(app.html()) && app.files('publications/release/').length === before, 'no publish while saving');
  g.open(); await app.tick(80); app.fs.write = write;
  /* The draft changes on disk after this page was drawn: publishing shows it instead. */
  await app.fs.write(path, app.fs.files[path].t.replace('title: Corrected', 'title: Changed again'));
  app.set('change-note', 'Correct the title');
  app.click('publish', 'release'); await app.tick(80);
  assert.ok(/nothing was published/.test(app.html()) && app.files('publications/release/').length === before, 'refused when the draft changed');
  app.set('change-note', 'Correct the title');
  app.click('publish', 'release'); await app.tick(120);
  const pubs = app.files('publications/release/').filter(f => /map\.md$/.test(f));
  assert.ok(app.files('publications/release/').length > before && pubs.some(f => /title: Changed again/.test(app.fs.files[f].t)), 'then publishes exactly what is shown');
});

rule('App: publishing freezes the step types as saved, even when a type save finishes just before it', async () => {
  const app = await recordingRelease();
  const tpath = 'step-types/change.request.json', write = app.fs.write.bind(app.fs), g = gate();
  app.fs.write = (p, t) => p === tpath ? g.p.then(() => write(p, t)) : write(p, t);
  app.click('nav', 'types'); await app.tick(); app.click('edit-type', 'change.request'); await app.tick(40);
  app.input('tf-label', 'Change request (CAB)'); await app.tick(300);
  app.submit('type-form'); await app.tick(5);
  /* Publish while that save is paused: the publish queues behind it and must freeze the saved label. */
  app.click('open-process', 'release'); await app.tick();
  const dpath = 'maps/drafts/release.md';
  await app.fs.write(dpath, app.fs.files[dpath].t.replace('title: Production release', 'title: Production release (v3)'));
  app.focus(); await app.tick(80);
  app.set('change-note', 'Retitle');
  app.click('publish', 'release'); await app.tick(5);
  g.open(); await app.tick(160); app.fs.write = write;
  const pub = app.files('publications/release/').filter(f => /types\.json$/.test(f)).map(f => app.fs.files[f].t).find(t => /change\.request/.test(t) && /Change request \(CAB\)/.test(t));
  assert.ok(pub, 'the new version froze the saved label');
});

rule('App: step types are grouped and filtered by tag; a type saves its group and tags', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick();
  assert.ok(/data-group="Tools"/.test(app.html()) && /data-group="Automation"/.test(app.html()), 'built-ins in groups');
  app.click('edit-type', 'change.request'); await app.tick(40);
  app.input('tf-group', 'Releases / Approvals'); app.input('tf-tags', 'cab, prod'); await app.tick(300);
  app.submit('type-form'); await app.tick(120);
  const def = JSON.parse(app.fs.files['step-types/change.request.json'].t);
  assert.strictEqual(JSON.stringify([def.group, def.tags]), JSON.stringify(['Releases / Approvals', ['cab', 'prod']]));
  assert.ok(/data-group="Releases \/ Approvals"/.test(app.html()) && /data-act="tag" data-id="cab"/.test(app.html()), 'grouped and taggable');
  app.click('tag', 'cab'); await app.tick();
  assert.ok(/change\.request/.test(app.html()) && !/data-id="jenkins.job"/.test(app.html()), 'the tag filter narrows the list');
  app.click('nav', 'processes'); await app.tick();
  assert.ok(/Production release/.test(app.html()) && !/aria-pressed="true">#cab/.test(app.html()), 'a tag picked on Step types never filters Processes');
  app.click('nav', 'types'); await app.tick();
  assert.ok(/data-act="tag" data-id="cab" aria-pressed="true"/.test(app.html()), 'and Step types keeps its own filter');
});

rule('App: while a step type saves, its conflict choices wait, so Take theirs never silently does nothing', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('edit-type', 'change.request'); await app.tick(40);
  const path = 'step-types/change.request.json';
  app.input('tf-label', 'Mine'); await app.tick(300);
  await app.fs.write(path, app.fs.files[path].t.replace(/"label": "[^"]*"/, '"label": "Theirs"'));
  app.submit('type-form'); await app.tick(60);
  assert.ok(/data-act="type-take-theirs"/.test(app.html()), 'conflict shown');
  const write = app.fs.write.bind(app.fs), g = gate();
  app.fs.write = (p, t) => p === path ? g.p.then(() => write(p, t)) : write(p, t);
  app.click('type-keep-mine'); await app.tick(5);
  assert.ok(!/data-act="type-take-theirs"/.test(app.html()) && />Saving…</.test(app.html()), 'no Take theirs while saving, and the Save button says so');
  g.open(); await app.tick(80);
  assert.ok(/"label": "Mine"/.test(app.fs.files[path].t));
});

rule('App: a row added to a step type while it saves stays in the form', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('edit-type', 'change.request'); await app.tick(40);
  const write = app.fs.write.bind(app.fs), g = gate();
  app.fs.write = (p, t) => /^step-types\//.test(p) ? g.p.then(() => write(p, t)) : write(p, t);
  app.input('tf-label', 'Change request (CAB)'); await app.tick(300);
  app.submit('type-form'); await app.tick(5);
  app.click('tf-add', 'f'); await app.tick();
  const k = [...app.html().matchAll(/id="tf-f-(k\d+)-label"/g)].pop()[1];
  app.input('tf-f-' + k + '-label', 'Half done'); await app.tick(300);
  g.open(); await app.tick(80);
  assert.ok(/id="type-form"/.test(app.html()) && /value="Half done"/.test(app.html()), 'the form stays open with the new row');
});

rule('App: each draft keeps its own unsaved edits, and a late conflict on one never touches another', async () => {
  const app = await recordingRelease();
  const rel = 'maps/drafts/release.md', chk = 'maps/drafts/check-in.md', relText = app.fs.files[rel].t, chkText = app.fs.files[chk].t;
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.input('draft-editor', relText + '\n<!-- release edit -->\n'); await app.tick(300);
  /* Pause the release save before its check, so it ends as a conflict after another draft has been opened. */
  const g = gate(), read = app.fs.read.bind(app.fs); let paused = false;
  app.fs.read = p => { if (p === rel && !paused) { paused = true; return g.p.then(() => read(p)); } return read(p); };
  app.click('save-draft'); await app.tick(5);
  app.click('open-process', 'check-in'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.input('draft-editor', chkText + '\n<!-- check-in edit -->\n'); await app.tick(300);
  /* Someone else changes the release draft while that save is paused, so it ends as a conflict. */
  app.fs.files[rel] = Object.assign({}, app.fs.files[rel], { t: relText.replace('title: Production release', 'title: Theirs') });
  g.open(); await app.tick(80);
  assert.ok(/title: Theirs/.test(app.fs.files[rel].t), 'their release change is kept');
  assert.ok(/wasn(&#39;|')t saved: someone else changed it/.test(app.html()), 'the conflict is reported');
  assert.ok(/check-in edit/.test(app.html()), 'the check-in edits stay on screen');
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  assert.ok(/release edit/.test(app.html()), 'the release edits are still there');
  app.click('open-process', 'check-in'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  assert.ok(/check-in edit/.test(app.html()), 'and so are the check-in edits');
});

rule('App: a step-type form with changes survives visiting another section; an untouched one closes', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  app.input('tf-id', 'risk.call'); await app.tick(300);
  app.click('nav', 'settings'); await app.tick(); app.click('nav', 'types'); await app.tick();
  assert.ok(/id="tf-id"[^>]*value="risk.call"/.test(app.html()), 'kept');
  app.click('type-cancel'); await app.tick(); app.click('new-type'); await app.tick();
  app.click('nav', 'settings'); await app.tick(); app.click('nav', 'types'); await app.tick();
  assert.ok(!/id="type-form"/.test(app.html()), 'an untouched form closes');
});

rule('App: a step type that can\'t be read says so instead of doing nothing', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick();
  const read = app.fs.read.bind(app.fs);
  app.fs.read = p => /^step-types\//.test(p) ? Promise.reject(new Error('permission denied')) : read(p);
  app.click('edit-type', 'change.request'); await app.tick(40);
  assert.ok(/Couldn(&#39;|')t open step-types\/change.request.json: permission denied/.test(app.html()));
});

rule('App: appearance steps through match-this-computer, light and dark, and is remembered in this browser', async () => {
  const app = boot(); await app.tick(80);
  assert.ok(/data-act="theme" data-id="light"/.test(app.top()), 'starts on match this computer');
  app.click('theme', 'dark'); await app.tick();
  assert.ok(/data-act="theme" data-id="system"/.test(app.top()) && /Appearance: Dark/.test(app.top()));
  const again = boot({ localStore: app.store }); await again.tick(60);
  assert.ok(/Appearance: Dark/.test(again.top()), 'remembered');
  again.click('nav', 'settings'); await again.tick();
  assert.ok(/data-act="theme" data-id="dark" aria-pressed="true"/.test(again.html()), 'Settings shows the choice');
});

rule('App: a new process starts a draft and opens it for editing', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'processes'); await app.tick(); app.click('new-process'); await app.tick();
  app.set('np-id', 'code-review'); app.set('np-title', 'Review code'); app.set('np-group', 'Engineering / Code'); app.set('np-tags', 'review'); app.set('np-context', 'pr'); app.set('np-roles', 'author, reviewer'); app.set('np-owner', 'person-casey');
  app.submit('new-process-form'); await app.tick(120);
  const md = app.fs.files['maps/drafts/code-review.md'];
  assert.ok(md && /process: code-review/.test(md.t) && /group: Engineering \/ Code/.test(md.t) && /owner: person-casey/.test(md.t));
  assert.ok(/id="ed-h"/.test(app.html()) && /class="ob" id="ob"/.test(app.html()), 'opened in the editor, in the builder');
  app.click('nav', 'processes'); await app.tick(); app.click('new-process'); await app.tick();
  app.set('np-id', 'code-review'); app.set('np-title', 'Again'); app.submit('new-process-form'); await app.tick(60);
  assert.ok(/already a process called/.test(app.html()), 'never over an existing one');
});

rule('App: a new step type is saved to step-types/ and listed; an invalid one is refused', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  app.set('tf-id', 'risk.call'); app.set('tf-label', 'Risk call'); app.set('tf-hint', 'A go or no-go call'); app.set('tf-icon', 'fork');
  const fk = /id="tf-f-(k\d+)-name"/.exec(app.html())[1];
  app.set('tf-f-' + fk + '-name', 'level'); app.set('tf-f-' + fk + '-label', 'Level'); app.set('tf-f-' + fk + '-kind', 'choice'); app.set('tf-f-' + fk + '-options', 'Low, with review\nHigh');
  app.click('tf-add', 'r'); await app.tick();
  const rk = /id="tf-r-(k\d+)-name"/.exec(app.html())[1];
  app.set('tf-r-' + rk + '-name', 'call'); app.set('tf-r-' + rk + '-label', 'Call'); app.set('tf-r-' + rk + '-kind', 'text');
  app.submit('type-form'); await app.tick(120);
  const f = app.fs.files['step-types/risk.call.json'];
  assert.ok(f, 'saved');
  const def = JSON.parse(f.t);
  assert.deepStrictEqual([def.fields.level.options, def.record[0].name], [['Low, with review', 'High'], 'call'], 'options keep their commas');
  assert.ok(/data-act="edit-type" data-id="risk.call"/.test(app.html()), 'listed');
  app.click('new-type'); await app.tick(); app.set('tf-id', 'jenkins.job'); app.set('tf-label', 'Mine'); app.submit('type-form'); await app.tick(60);
  assert.ok(/built-in type|already a step type/.test(app.html()) && !app.fs.files['step-types/jenkins.job.json'], 'a built-in id is refused');
});

rule('App: a Jira transition shows its required fields with hints, filled in from the run where the workflow says', async () => {
  const app = await recordingRelease();
  app.click('unfold', 'verify'); await app.tick();
  const r = app.run();
  assert.ok(r.json.jira && r.json.jira.Release, 'the run copied the Release workflow');
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  assert.ok(/The release name on the board/.test(app.html()), 'hint shown in Fill in');
  assert.ok(/id="rec-jf-deployed-commit-[0-9a-f]{8}"[^>]*value="d9d8514"/.test(app.html()), 'prefilled from the run');
});

rule('App: while a conflict copy is being kept, other changes wait; nothing checked meanwhile is lost', async () => {
  const app = await recordingRelease();
  const r = app.run();
  const copy = JSON.parse(JSON.stringify(r.json)); copy.title = 'From the other computer';
  await app.fs.write(r.path.replace('run.json', 'run-OTHER.json'), JSON.stringify(copy));
  app.focus(); await app.tick(40);
  const g = gate(), orig = app.PF.repo.keepDisplaced;
  app.PF.repo.keepDisplaced = function () { return orig.apply(this, arguments).then(where => g.p.then(() => where)); };  // pause right after the backup is written
  app.click('use-copy', 'run-OTHER.json'); await app.tick();
  app.click('toggle', 'approve'); await app.tick(40);
  const refused = /Wait until the copy is kept/.test(app.html());
  g.open(); await app.tick(80);
  app.PF.repo.keepDisplaced = orig;
  const now = app.run().json, approveDone = now.steps.approve && now.steps.approve.s === 'done';
  const backups = app.files(r.path.replace('run.json', 'replaced-')).map(p => JSON.parse(app.fs.files[p].t));
  const conflicts = app.files(r.path.replace('run.json', 'run')).filter(p => !/run\.json$/.test(p));
  const kept = approveDone || backups.some(b => b.steps.approve && b.steps.approve.s === 'done') || conflicts.length > 0;
  assert.ok(refused || kept, 'the check made during recovery was either refused with a message or is kept somewhere');
  if (refused) assert.ok(!approveDone, 'a refused check isn\'t silently applied');
  assert.strictEqual(now.title, 'From the other computer', 'the copy was kept');
});

rule('App: a save that finishes after switching folders leaves the new folder free to refresh', async () => {
  const app = await recordingRelease();
  const g = gate(), orig = app.PF.repo.saveRun; let first = true;
  app.PF.repo.saveRun = function () { const args = arguments; if (!first) return orig.apply(this, args); first = false; return g.p.then(() => orig.apply(this, args)); };
  app.click('toggle', 'approve'); await app.tick();
  app.click('reset-examples'); await app.tick(60);
  g.open(); await app.tick(40);
  app.PF.repo.saveRun = orig;
  let loads = 0; const origLoad = app.PF.repo.loadAll;
  app.PF.repo.loadAll = function () { loads++; return origLoad.apply(this, arguments); };
  app.focus(); await app.tick(40);
  app.PF.repo.loadAll = origLoad;
  assert.ok(loads >= 1, 'refreshing still works after the old folder\'s save finished');
});

rule('App: Try again after a failed reopening save keeps the same save options and succeeds', async () => {
  const app = await recordingRelease();
  app.click('finish'); await app.tick();
  app.click('end', 'Cancelled'); await app.tick(40);
  const r = app.run();
  const copy = JSON.parse(JSON.stringify(r.json)); delete copy.ended; copy.state = 'running'; copy.title = 'Reopened';
  // The run was ended from another window: its file names that window's session.
  const ended = JSON.parse(JSON.stringify(r.json)); ended.recorder.session = 'another-window';
  await app.fs.write(r.path, JSON.stringify(ended));
  await app.fs.write(r.path.replace('run.json', 'run-OTHER.json'), JSON.stringify(copy));
  app.focus(); await app.tick(40);
  const orig = app.PF.repo.saveRun; let fail = true;
  app.PF.repo.saveRun = function () { if (fail) { fail = false; return Promise.reject(new Error('offline')); } return orig.apply(this, arguments); };
  app.click('use-copy', 'run-OTHER.json'); await app.tick(60);
  assert.ok(/isn't saved/.test(app.html()), 'the failed save is shown');
  app.click('retry-save'); await app.tick(60);
  app.PF.repo.saveRun = orig;
  assert.strictEqual(app.run().json.title, 'Reopened', 'Try again saved it');
  assert.ok(!app.files(r.path.replace('run.json', 'run.conflict')).length, 'no conflict copy from the retry');
});

rule('R5: a change saved while another save is pending, a refresh, and a failed save never lose the newest change', async () => {
  const app = await recordingRelease();
  const orig = app.PF.repo.saveRun, g1 = gate(), g2 = gate(); let n = 0;
  const fsWrite = app.fs.write; let paused = false;
  // The first save is paused after it has copied the run, at the moment it writes the file.
  app.fs.write = function (p, d) { if (!paused && /run\.json$/.test(p)) { paused = true; return g1.p.then(() => fsWrite.call(this, p, d)); } return fsWrite.call(this, p, d); };
  app.PF.repo.saveRun = function () { const args = arguments; n++; if (n === 2) return g2.p.then(() => Promise.reject(new Error('offline'))); return orig.apply(this, args); };
  app.click('toggle', 'approve'); await app.tick();          // first save, paused
  app.click('edit', 'detail:commit'); app.set('edit-input', 'new-commit'); app.click('save-edit'); await app.tick();   // second save queued
  g1.open(); await app.tick(20);                              // first finishes; the second is now in flight
  app.focus(); await app.tick(40);                            // a refresh happens meanwhile
  g2.open(); await app.tick(40);                              // the second fails
  app.click('retry-save'); await app.tick(60);
  app.PF.repo.saveRun = orig; app.fs.write = fsWrite;
  assert.strictEqual(app.run().json.details.commit, 'new-commit', 'the newest change is the one saved by Try again');
});

rule('R5: a publish that finishes after switching folders is credited to who published it, and doesn\'t announce in the new folder', async () => {
  const app = await recordingRelease();
  app.click('home'); await app.tick();
  app.click('open-process', 'check-in'); await app.tick();
  const orig = app.PF.repo.publish, g = gate(); let by = null;
  let first = true;
  app.PF.repo.publish = function (fs, md, opts) { const args = arguments; if (!first) return orig.apply(this, args); first = false; by = opts.by; return g.p.then(() => orig.apply(this, args)); };
  app.set('change-note', 'A change'); app.click('publish', 'check-in'); await app.tick();
  app.click('reset-examples'); await app.tick(60);
  app.choose('person-blake'); await app.tick();
  g.open(); await app.tick(40);
  app.PF.repo.publish = orig;
  assert.strictEqual(by, 'person-casey');
  assert.ok(!/Published v/.test(app.html()), 'no success message lands in the other folder');
});

rule('R6: a reload after a conflict never replaces a newer change that failed to save', async () => {
  const app = await recordingRelease();
  const r = app.run();
  // Another computer saved meanwhile, so this window's next save becomes a conflict copy.
  const other = JSON.parse(JSON.stringify(r.json)); other.title = 'Saved elsewhere'; other.rev = (other.rev || 0) + 5;
  await app.fs.write(r.path, JSON.stringify(other));
  const fsWrite = app.fs.write, gw = gate(); let paused = false;
  app.fs.write = function (p, d) { if (!paused && /run\.conflict-/.test(p)) { paused = true; return gw.p.then(() => fsWrite.call(this, p, d)); } return fsWrite.call(this, p, d); };
  const origSave = app.PF.repo.saveRun; let n = 0;
  const origLoadRun = app.PF.repo.loadRun, gl = gate(); let holdLoad = false;
  app.PF.repo.loadRun = function () { const args = arguments; if (holdLoad) { holdLoad = false; return gl.p.then(() => origLoadRun.apply(this, args)); } return origLoadRun.apply(this, args); };
  app.click('toggle', 'approve'); await app.tick();                       // save 1: becomes a conflict, paused writing its copy
  app.click('edit', 'detail:commit'); app.set('edit-input', 'newest-commit'); app.click('save-edit'); await app.tick();
  holdLoad = true;
  app.PF.repo.saveRun = function () { n++; if (n === 1) return Promise.reject(new Error('offline')); return origSave.apply(this, arguments); };
  gw.open(); await app.tick(30);                                        // conflict copy written; its reload is held
  await app.tick(30);                                                   // the commit save fails
  gl.open(); await app.tick(40);                                        // the old reload finishes
  app.PF.repo.saveRun = origSave; app.fs.write = fsWrite; app.PF.repo.loadRun = origLoadRun;
  const everywhere = JSON.stringify(Object.keys(app.fs.files).map(k => app.fs.files[k].t)) + JSON.stringify(app.store) + app.html();
  assert.ok(/newest-commit/.test(everywhere), 'the newest commit is still somewhere: on screen, in the folder or kept in the browser');
  assert.ok(/isn't saved|newest-commit/.test(app.html()), 'and the screen still shows it or says it isn\'t saved');
});

rule('R6: a refresh that started before an edit never brings back the older version', async () => {
  const app = await recordingRelease();
  const origLoadRun = app.PF.repo.loadRun, g = gate(); let hold = true;
  app.PF.repo.loadRun = function () { const args = arguments; if (hold) { hold = false; return origLoadRun.apply(this, args).then(x => g.p.then(() => x)); } return origLoadRun.apply(this, args); };
  app.focus(); await app.tick();                                         // a refresh reads the run (old commit) and is held
  app.click('edit', 'detail:commit'); app.set('edit-input', 'edited-during-read'); app.click('save-edit'); await app.tick(40);
  g.open(); await app.tick(40);
  app.PF.repo.loadRun = origLoadRun;
  app.click('select', 'approve'); await app.tick();                       // any redraw
  assert.ok(/edited-during-read/.test(app.html()), 'the screen keeps the newer commit');
  assert.strictEqual(app.run().json.details.commit, 'edited-during-read');
});

rule('R6: a comparison that finishes after switching folders is never shown in the new one', async () => {
  const app = await recordingRelease();
  const r = app.run();
  await app.fs.write(r.path.replace('run.json', 'run-OTHER.json'), JSON.stringify(Object.assign({}, r.json, { title: 'Other' })));
  app.focus(); await app.tick(40);
  const orig = app.PF.repo.readCopy, g = gate();
  app.PF.repo.readCopy = function () { const args = arguments; return g.p.then(() => orig.apply(this, args)); };
  app.click('compare-copy', 'run-OTHER.json'); await app.tick();
  app.click('reset-examples'); await app.tick(60);
  app.choose('person-casey'); app.click('open-run', app.run().key); await app.tick();
  await app.fs.write(app.run().path.replace('run.json', 'run-OTHER.json'), JSON.stringify(app.run().json)); app.focus(); await app.tick(40);
  g.open(); await app.tick(40);
  app.PF.repo.readCopy = orig;
  assert.ok(!/class="small difflist"/.test(app.html()), 'no comparison from the old folder');
});

rule('R7: an old refresh can\'t bring back an older run after the run was replaced by a newer one (hand off and pick up)', async () => {
  const app = await recordingRelease();
  const origLoadRun = app.PF.repo.loadRun, g = gate(); let hold = true;
  app.PF.repo.loadRun = function () { const args = arguments; if (hold) { hold = false; return origLoadRun.apply(this, args).then(x => g.p.then(() => x)); } return origLoadRun.apply(this, args); };
  app.focus(); await app.tick();                                                   // old refresh, held after reading
  app.click('edit', 'detail:commit'); app.set('edit-input', 'NEWEST-ABA'); app.click('save-edit'); await app.tick(40);
  app.click('pick', 'recorder', { kind: 'handoff' }); app.set('handoff-to', 'person-blake'); app.click('handoff'); await app.tick(40);
  app.choose('person-blake'); await app.tick();
  app.click('pickup'); await app.tick(60);
  g.open(); await app.tick(40);
  app.PF.repo.loadRun = origLoadRun;
  app.click('select', 'approve'); await app.tick();
  assert.strictEqual(app.run().json.details.commit, 'NEWEST-ABA');
  assert.ok(/NEWEST-ABA/.test(app.html()), 'the screen shows the newest commit, not the one the old refresh read');
});

rule('R7: a run whose file is briefly missing keeps its unsaved change on screen', async () => {
  const app = await recordingRelease();
  const r = app.run(), orig = app.PF.repo.saveRun; let fail = true;
  app.PF.repo.saveRun = function () { if (fail) { fail = false; return Promise.reject(new Error('offline')); } return orig.apply(this, arguments); };
  app.click('edit', 'detail:commit'); app.set('edit-input', 'UNSAVED-1'); app.click('save-edit'); await app.tick(40);
  const saved = app.fs.files[r.path]; delete app.fs.files[r.path];
  app.click('home'); await app.tick(); app.focus(); await app.tick(60);
  app.click('open-run', r.key); await app.tick();
  assert.ok(/UNSAVED-1/.test(app.html()) && /isn't saved/.test(app.html()), 'the unsaved change and its warning are still there');
  app.fs.files[r.path] = saved;
  app.click('retry-save'); await app.tick(60);
  app.PF.repo.saveRun = orig;
  assert.strictEqual(app.run().json.details.commit, 'UNSAVED-1');
});

rule('R7: archived answers read for one folder never show in another', async () => {
  const app = await recordingRelease();
  const orig = app.PF.repo.loadHistory, g = gate();
  app.PF.repo.loadHistory = function () { return g.p.then(() => [{ kind: 'answer', step: 'approve', s: 'done', by: 'person-avery', at: '2026-10-17T20:00:00.000Z', id: 'x' }]); };
  app.click('select', 'approve'); app.click('load-history'); await app.tick();
  app.click('reset-examples'); await app.tick(60);
  app.choose('person-casey'); app.click('open-run', app.run().key); await app.tick();
  g.open(); await app.tick(40);
  app.PF.repo.loadHistory = orig;
  app.click('select', 'approve'); await app.tick();
  assert.ok(!/Archived answers/.test(app.html()));
});

rule('R8: an older full refresh can\'t overwrite a newer version accepted after a conflict', async () => {
  const app = await recordingRelease();
  const r = app.run();
  const origSave = app.PF.repo.saveRun, gs = gate(); let holdSave = true;
  app.PF.repo.saveRun = function () { const args = arguments; if (holdSave) { holdSave = false; return gs.p.then(() => origSave.apply(this, args)); } return origSave.apply(this, args); };
  app.click('edit', 'detail:commit'); app.set('edit-input', 'LOCAL-COMMIT'); app.click('save-edit'); await app.tick();   // save held
  const origAll = app.PF.repo.loadAll, gl = gate(); let holdAll = true;
  app.PF.repo.loadAll = function () { const args = arguments; if (holdAll) { holdAll = false; return origAll.apply(this, args).then(x => gl.p.then(() => x)); } return origAll.apply(this, args); };
  app.click('refresh'); await app.tick(20);                                                                           // Refresh: full read, held
  const remote = JSON.parse(app.fs.files[r.path].t); remote.details.commit = 'REMOTE-NEWEST'; remote.rev = (remote.rev || 0) + 9; remote.title = 'Remote';
  await app.fs.write(r.path, JSON.stringify(remote));
  gs.open(); await app.tick(60);                                                                                      // save conflicts; remote accepted
  gl.open(); await app.tick(60);                                                                                      // old full refresh lands
  app.PF.repo.saveRun = origSave; app.PF.repo.loadAll = origAll;
  app.click('select', 'approve'); await app.tick();
  assert.ok(/REMOTE-NEWEST/.test(app.html()), 'the screen keeps the newer accepted version');
});

rule('R8: finishing one note never clears another step\'s draft or attachment', async () => {
  const app = await recordingRelease();
  const orig = app.PF.repo.addNote, g = gate();
  app.PF.repo.addNote = function () { const args = arguments; return g.p.then(() => orig.apply(this, args)); };
  app.click('select', 'approve'); app.set('note-text', 'first note'); app.click('add-note', 'approve'); await app.tick();
  app.click('select', 'pods'); await app.tick();
  app.change('note-file', [new Blob(['png'], { type: 'image/png' })]); await app.tick();
  assert.ok(/1 screenshot attached/.test(app.html()), 'set-up: an attachment waits on the second step');
  g.open(); await app.tick(40);
  app.PF.repo.addNote = orig;
  assert.ok(/1 screenshot attached/.test(app.html()), 'the second step\'s attachment survives the first note finishing');
});

rule('R8: actions that finish after switching folders leave the new folder\'s screen alone', async () => {
  const app = await recordingRelease();
  const r = app.run();
  await app.fs.write(r.path.replace('run.json', 'run-OTHER.json'), JSON.stringify(r.json)); app.focus(); await app.tick(40);
  const orig = app.PF.repo.removeCopy, g = gate();
  app.PF.repo.removeCopy = function () { const args = arguments; return g.p.then(() => orig.apply(this, args)); };
  app.click('delete-copy', 'run-OTHER.json'); app.click('delete-copy', 'run-OTHER.json'); await app.tick();
  app.click('reset-examples'); await app.tick(60);
  app.choose('person-casey'); app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  app.click('pick', 'approve', { kind: 'block' }); await app.tick();
  assert.ok(/What's wrong\?/.test(app.html()), 'set-up: a form is open in the new folder');
  g.open(); await app.tick(40);
  app.PF.repo.removeCopy = orig;
  assert.ok(/What's wrong\?/.test(app.html()), 'the old folder\'s delete doesn\'t close it');
});

rule('R9: text typed into the note box while a note is saving is kept', async () => {
  const app = await recordingRelease();
  const orig = app.PF.repo.addNote, g = gate();
  app.PF.repo.addNote = function () { const args = arguments; return g.p.then(() => orig.apply(this, args)); };
  app.click('select', 'approve'); await app.tick();
  app.set('note-text', 'first note'); app.click('add-note', 'approve'); await app.tick();
  app.set('note-text', 'NEW UNSUBMITTED TEXT'); await app.tick();
  g.open(); await app.tick(40);
  app.PF.repo.addNote = orig;
  assert.strictEqual(app.draft('note-text'), 'NEW UNSUBMITTED TEXT');
});

rule('R9: when a note saves and the box still holds what was sent, the box is cleared', async () => {
  const app = await recordingRelease();
  app.click('select', 'approve'); await app.tick();
  app.set('note-text', 'only note'); app.click('add-note', 'approve'); await app.tick(40);
  assert.strictEqual(app.draft('note-text'), '');
});

rule('R9: a delete that finishes later never closes a different form on the same run', async () => {
  const app = await recordingRelease();
  const r = app.run();
  await app.fs.write(r.path.replace('run.json', 'run-OTHER.json'), JSON.stringify(r.json)); app.focus(); await app.tick(40);
  const orig = app.PF.repo.removeCopy, g = gate();
  app.PF.repo.removeCopy = function () { const args = arguments; return g.p.then(() => orig.apply(this, args)); };
  app.click('delete-copy', 'run-OTHER.json'); app.click('delete-copy', 'run-OTHER.json'); await app.tick();
  app.click('pick', 'approve', { kind: 'block' }); await app.tick();
  g.open(); await app.tick(40);
  app.PF.repo.removeCopy = orig;
  assert.ok(/What's wrong\?/.test(app.html()), 'the block form stays open');
});

rule('R10: a note too long to save is refused with a message, and the text stays', async () => {
  const app = await recordingRelease();
  app.click('select', 'approve'); await app.tick();
  const long = 'x'.repeat(2012);
  app.set('note-text', long); app.click('add-note', 'approve'); await app.tick(40);
  assert.strictEqual(app.draft('note-text'), long, 'the draft is kept');
  assert.ok(/2,000 characters/.test(app.html()), 'the limit is explained');
  const notes = app.files(app.run().path.replace('run.json', 'notes-'));
  assert.ok(!notes.some(p => /x{2000}/.test(app.fs.files[p].t)), 'nothing truncated was saved');
});

rule('R10: a screenshot attached to one step is never filed under another, by mouse or keyboard', async () => {
  const app = await recordingRelease();
  app.click('select', 'approve'); await app.tick();
  app.change('note-file', [new Blob(['png'], { type: 'image/png' })]); await app.tick();
  app.key('j'); await app.tick();
  app.set('note-text', 'note for the next step'); app.click('add-note', app.selected()); await app.tick(60);
  const files = app.files(app.run().path.replace('run.json', 'notes-')).map(p => app.fs.files[p].t).join('\n');
  const notes = files.split('\n').filter(Boolean).map(l => JSON.parse(l));
  const mine = notes.find(n => n.text === 'note for the next step');
  assert.ok(mine && mine.files.length === 0, 'the screenshot stayed with the step it was attached to');
});

rule('R11: a duplicated tab takes its own writer identity, so two windows never append to the same file', async () => {
  const Channel = bus(), shared = {};
  const L = locks();
  const a = boot({ Channel, sessionStore: shared, locks: L }); await a.tick(60);
  const copied = JSON.parse(JSON.stringify(shared));               // the browser copies session storage into the duplicate
  const b = boot({ Channel, sessionStore: copied, locks: L }); await b.tick(80);
  const idA = shared['preflight:session'], idB = copied['preflight:session'];
  assert.ok(idA && idB && idA !== idB, 'the duplicate chose a new identity (' + idA + ' / ' + idB + ')');
});

rule('R11: reloading a window keeps its identity, so its recording continues', async () => {
  const Channel = bus(), shared = {};
  const a = boot({ Channel, sessionStore: shared, locks: locks() }); await a.tick(60);
  const before = shared['preflight:session'];
  const again = boot({ Channel: bus(), sessionStore: shared, locks: locks() }); await again.tick(80);   // the old page is gone: nothing answers
  assert.strictEqual(shared['preflight:session'], before);
});

rule('R12: without window messaging, two windows with a copied identity still write separate notes files', async () => {
  const shared = {};
  const a = boot({ sessionStore: shared }); await a.tick(60);
  const b = boot({ sessionStore: JSON.parse(JSON.stringify(shared)) }); await b.tick(60);
  async function note(app, text) {
    app.choose('person-casey'); await app.tick(); app.click('open-run', app.run().key); await app.tick();
    app.click('select', 'approve'); app.set('note-text', text); app.click('add-note', 'approve'); await app.tick(40);
    return app.files(app.run().path.replace('run.json', 'notes-')).filter(p => /notes-/.test(p) && app.fs.files[p].t.indexOf(text) >= 0)[0];
  }
  const fa = await note(a, 'from window A'), fb = await note(b, 'from window B');
  assert.ok(fa && fb && fa.split('/').pop() !== fb.split('/').pop(), 'different notes files: ' + fa + ' / ' + fb);
});

rule('R12: a plan decision from a duplicated window is its own file, so decisions can never overwrite each other', async () => {
  const shared = {};
  const a = boot({ sessionStore: shared }); await a.tick(60);
  const b = boot({ sessionStore: JSON.parse(JSON.stringify(shared)) }); await b.tick(60);
  async function decline(app) { app.choose('person-casey'); await app.tick(); const plan = app.files('proposals/').find(p => /plan-/.test(p) && !/status/.test(p)); app.click('decline-plan', JSON.parse(app.fs.files[plan].t).id); await app.tick(40); return app.files('proposals/').filter(p => /status/.test(p))[0]; }
  const fa = await decline(a), fb = await decline(b);
  assert.ok(fa && fb && fa.split('/').pop() !== fb.split('/').pop(), fa + ' / ' + fb);
});

async function twoWindows(withLocks) {
  const files = {}, shared = {}, L = withLocks ? locks() : null;
  const a = boot({ sessionStore: shared, sharedFiles: files, locks: L }); await a.tick(60);
  a.choose('person-casey'); await a.tick(); a.click('open-run', a.run().key); await a.tick(); a.click('pickup'); await a.tick(40);
  const b = boot({ sessionStore: JSON.parse(JSON.stringify(shared)), sharedFiles: files, locks: L }); await b.tick(60);
  b.choose('person-casey'); await b.tick(); b.click('open-run', b.run().key); await b.tick(); b.focus(); await b.tick(40);
  return { a, b, files };
}

rule('R13: with locks, two duplicated recording windows save one at a time; the second change becomes a conflict copy, never an overwrite', async () => {
  const { a, b, files } = await twoWindows(true);
  a.click('edit', 'detail:commit'); a.set('edit-input', 'FROM-A'); a.click('save-edit');
  b.click('edit', 'detail:environment'); b.set('edit-input', 'FROM-B'); b.click('save-edit');
  await a.tick(80); await b.tick(80);
  const run = JSON.parse(files[a.run().path].t);
  const copies = Object.keys(files).filter(k => /run\.conflict-/.test(k)).map(k => JSON.parse(files[k].t));
  const everywhere = [run].concat(copies);
  assert.ok(everywhere.some(x => x.details.commit === 'FROM-A'), 'A\'s change is kept');
  assert.ok(everywhere.some(x => x.details.environment === 'FROM-B'), 'B\'s change is kept');
});

rule('R13: without locks, a duplicated window can\'t record at all, so it can\'t overwrite the recorder', async () => {
  const { a, b } = await twoWindows(false);
  assert.ok(/You're recording|Your run/.test(a.html()));
  assert.ok(!/You're recording\.|Your run\./.test(b.html()), 'the duplicate is view-only');
});

rule('R14: without a shared lock, a save overwritten by Record here comes back as a conflict copy', async () => {
  const { a, b, files } = await twoWindows(false);
  a.PF.repo.config.candidateGraceMs = 0; b.PF.repo.config.candidateGraceMs = 0;
  const g = gate(), wA = a.fs.write; let held = false;
  a.fs.write = function (p, d) { if (!held && /\/run\.json$/.test(p)) { held = true; return g.p.then(() => wA.call(this, p, d)); } return wA.call(this, p, d); };
  a.click('edit', 'detail:commit'); a.set('edit-input', 'LOST-UNLESS-KEPT'); a.click('save-edit'); await a.tick(10);   // A's write is held after its check
  b.click('takeover'); await b.tick(60);                                                                              // B records here and saves
  g.open(); await a.tick(40);                                                                                         // A's write lands, then...
  b.click('edit', 'detail:environment'); b.set('edit-input', 'B-ENV'); b.click('save-edit'); await b.tick(60);        // ...B saves over it
  a.fs.write = wA;
  b.focus(); await b.tick(60);
  const everywhere = Object.keys(files).filter(k => /\.json$/.test(k)).map(k => files[k].t).join('\n');
  assert.ok(/LOST-UNLESS-KEPT/.test(everywhere), 'A\'s commit is still in the folder');
  assert.ok(/data-act="compare-copy"/.test(b.html()), 'and B is shown a version to compare');
});

rule('Releases: someone new sees no dot; someone who used an older version sees a dot and a one-time notice', async () => {
  const fresh = boot(); await fresh.tick(60);
  assert.ok(/What's new<span class="ver"> · v\d+\.\d+\.\d+/.test(fresh.top()) && !/wn-dot/.test(fresh.top()), 'a first visit is not a changelog');
  const old = boot({ localStore: { 'preflight:seen-release': '"1.0.0"', 'preflight:me': '"person-casey"' } }); await old.tick(60);
  assert.ok(/wn-dot/.test(old.top()), 'the dot shows');
  assert.ok(/Flightdeck was updated to \d+\.\d+\.\d+/.test(old.html()) && /data-act="whats-new"/.test(old.html()), 'a one-time notice offers What\'s new');
});

rule('Releases: What\'s new lists every release, marks the unseen ones, filters, and clears the dot', async () => {
  const app = boot({ localStore: { 'preflight:seen-release': '"1.4.0"', 'preflight:me': '"person-casey"' } }); await app.tick(60);
  app.click('whats-new'); await app.tick();
  const ov = app.overlay();
  assert.ok(/What's new in Flightdeck/.test(ov) && /1\.0\.0/.test(ov), 'the dialog lists the whole history');
  const after = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'releases.json'), 'utf8')).filter(r => r.version.split('.').map(Number).reduce((d, n, i) => d || n - [1, 4, 0][i], 0) > 0).length;
  assert.strictEqual((ov.match(/New for you/g) || []).length, after, 'only releases after 1.4.0 are new for you');
  app.click('rel-kind', 'fixed'); await app.tick();
  assert.ok(/Fixed<\/span> \d/.test(app.overlay()) && !/<span class="rn-kind rn-k-new">/.test(app.overlay()), 'filtering to fixes shows only fixes');
  app.input('rel-search', 'zzz-nothing'); await app.tick();
  assert.ok(/No changes match/.test(app.overlay()));
  app.click('close-overlay'); await app.tick();
  assert.ok(!/wn-dot/.test(app.top()), 'seen now');
  assert.strictEqual(app.store['preflight:seen-release'], JSON.stringify(app.top().match(/v(\d+\.\d+\.\d+)/)[1]));
});

rule('Releases: a multi-word search keeps its spaces and matches', async () => {
  const app = boot({ localStore: { 'preflight:seen-release': '"1.0.0"', 'preflight:me': '"person-casey"' } }); await app.tick(60);
  app.click('whats-new'); await app.tick();
  app.input('rel-search', 'conflict '); await app.tick();
  assert.ok(/value="conflict "/.test(app.overlay()), 'the trailing space stays while typing');
  app.input('rel-search', 'conflict copy'); await app.tick();
  assert.ok(!/No changes match/.test(app.overlay()), 'two words match');
});

rule('Releases: the update notice is recorded only once it has been shown, and doesn\'t come back', async () => {
  const store = { 'preflight:seen-release': '"1.0.0"', 'preflight:me': '"person-casey"' };
  const first = boot({ localStore: store }); await first.tick(60);
  assert.ok(/Flightdeck was updated/.test(first.html()), 'shown');
  assert.ok(first.store['preflight:toasted-release'], 'and recorded as shown');
  const again = boot({ localStore: first.store }); await again.tick(60);
  assert.ok(!/Flightdeck was updated/.test(again.html()), 'not shown twice');
});

/* ---------- planned runs ---------- */
const releaseRuns = app => app.files('runs/release/').filter(p => /\/run\.json$/.test(p));
const newPlans = (app, before) => app.files('proposals/').filter(p => !/\.status-/.test(p) && before.indexOf(p) < 0);
const pubFolder = (app, v) => app.files('publications/release/v' + v + '-')[0].split('/')[2];

rule('Plans: clicking Save the plan again while it saves never writes the plan twice', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('plan-run', 'release'); await app.tick();
  const before = app.files('proposals/'), write = app.fs.write.bind(app.fs), g = gate();
  app.fs.write = (p, t) => /^proposals\/plan-/.test(p) ? g.p.then(() => write(p, t)) : write(p, t);
  app.set('run-title', 'Release 2026.11.13');
  app.submitForm('plan-form'); await app.tick(5);
  app.submitForm('plan-form'); await app.tick(5);
  assert.ok(/Still saving this plan/.test(app.html()), 'the second click waits');
  g.open(); await app.tick(80);
  assert.strictEqual(newPlans(app, before).length, 1, 'one plan file');
});

rule('Plans: planning a run from a process page writes one new plan file with what was entered, and never replaces a file', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  assert.ok(/data-act="plan-run" data-id="release">Plan a run</.test(app.html()), 'next to Start a run');
  app.click('plan-run', 'release'); await app.tick();
  assert.ok(/<h1>Plan a run<\/h1>/.test(app.html()) && /type="datetime-local" id="plan-when"/.test(app.html()));
  const before = app.files('proposals/');
  app.set('run-title', 'Release 2026.11.06').set('detail-ticket', 'ABC-5000').set('plan-when', '2026-11-06T09:00').set('plan-note', 'Morgan takes QA').set('role-qa', 'person-morgan');
  app.submitForm('plan-form'); await app.tick(80);
  const made = newPlans(app, before);
  assert.strictEqual(made.length, 1, 'one new file');
  assert.ok(/^proposals\/plan-release-[a-z0-9]{8}\.json$/.test(made[0]), made[0]);
  const plan = JSON.parse(app.fs.files[made[0]].t);
  assert.strictEqual(made[0], 'proposals/' + plan.id + '.json');
  assert.deepStrictEqual(Object.keys(plan), ['kind', 'id', 'process', 'version', 'title', 'details', 'roles', 'when', 'note', 'by', 'created']);
  assert.strictEqual(plan.kind, 'plan'); assert.strictEqual(plan.process, 'release'); assert.strictEqual(plan.version, 2, 'the published version shown');
  assert.strictEqual(plan.title, 'Release 2026.11.06');
  assert.deepStrictEqual(plan.details, { ticket: 'ABC-5000' }, 'blank details are left out; they can be filled in when it starts');
  assert.strictEqual(plan.roles.qa, 'person-morgan');
  assert.strictEqual(plan.when, new Date('2026-11-06T09:00').toISOString());
  assert.strictEqual(plan.note, 'Morgan takes QA'); assert.strictEqual(plan.by, 'person-casey');
  assert.ok(/Planned Release 2026\.11\.06\./.test(app.html()) && /<h1>Runs<\/h1>/.test(app.html()), 'goes to Runs and says so');
  assert.ok(app.html().includes('id="card-' + plan.id + '"'), 'listed under Planned');
  // A file with the same name is already there (another computer, or an assistant): nothing is replaced.
  app.fs.files['proposals/plan-release-taken000.json'] = { t: 'THEIRS', m: Date.now() };
  const rid = app.PF.util.randomId;
  app.PF.util.randomId = () => 'taken000';
  try {
    app.click('plan-run', 'release'); await app.tick();
    app.submitForm('plan-form'); await app.tick(80);
  } finally { app.PF.util.randomId = rid; }
  assert.strictEqual(app.fs.files['proposals/plan-release-taken000.json'].t, 'THEIRS', 'never overwritten');
  assert.ok(/already in the folder, so nothing was saved/.test(app.html()), 'says nothing was saved');
});

rule('Plans: a time that can\'t be read is pointed out next to its field, and nothing is saved', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('plan-run', 'release'); await app.tick();
  const before = app.files('proposals/');
  app.set('plan-when', 'whenever'); app.submitForm('plan-form'); await app.tick(40);
  assert.strictEqual(newPlans(app, before).length, 0);
  assert.ok(/id="ferr-plan-when" role="alert"/.test(app.html()));
});

rule('Plans: duplicating a run plans its details and roles on the current version, never what a step set or anything answered, and records where it came from', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const path = releaseRuns(app).find(p => JSON.parse(app.fs.files[p].t).title === 'Release 2026.10.09'), src = JSON.parse(app.fs.files[path].t), key = 'release/' + src.id;
  assert.ok(src.details.tag && src.ended, 'set-up: an ended run with a detail its tag step set');
  app.click('open-run', key); await app.tick();
  assert.ok(app.html().includes('data-act="plan-from-run" data-id="' + key + '"'), 'offered on the run');
  app.click('receipt'); await app.tick();
  assert.ok(/data-act="plan-from-run"/.test(app.html()), 'and on its receipt');
  app.click('plan-from-run', key); await app.tick();
  assert.ok(/<h1>Plan a run<\/h1>/.test(app.html()) && /id="detail-ticket"[^>]*value="ABC-4722"/.test(app.html()) && !/id="detail-tag"/.test(app.html()));
  const before = app.files('proposals/');
  app.submitForm('plan-form'); await app.tick(80);
  const plan = JSON.parse(app.fs.files[newPlans(app, before)[0]].t);
  assert.strictEqual(plan.from, key, 'from the run');
  assert.strictEqual(plan.version, 2, 'the current version, not the run\'s v1');
  assert.strictEqual(plan.title, 'Release 2026.10.09');
  assert.deepStrictEqual(plan.details, { ticket: 'ABC-4722', commit: 'e4c90b2', environment: 'production' }, 'no tag: the run makes it again');
  assert.deepStrictEqual(plan.roles, src.roles);
  assert.ok(!['steps', 'gates', 'fields', 'log', 'followUps', 'notes', 'answers'].some(k => k in plan), 'answers, notes and gates are never copied');
});

rule('Plans: a plan starts on the version it was planned on; See what changed shows the differences; Switch starts the latest', async () => {
  const pinned = boot(); await pinned.tick(60);
  pinned.choose('person-casey'); await pinned.tick();
  pinned.click('review-plan', 'plan-release-2026-10-24'); await pinned.tick();
  assert.ok(/This plan was made for v1\. v2 is now published\./.test(pinned.html()));
  pinned.click('plan-diff'); await pinned.tick();
  assert.ok(/class="diff"/.test(pinned.html()), 'the differences');
  let before = releaseRuns(pinned);
  pinned.submitForm('start-form'); await pinned.tick(120);
  let made = releaseRuns(pinned).filter(p => before.indexOf(p) < 0);
  assert.strictEqual(made.length, 1, 'started');
  let run = JSON.parse(pinned.fs.files[made[0]].t);
  assert.strictEqual(run.version, 1); assert.strictEqual(run.folder, pubFolder(pinned, 1), 'on the version it was planned on');
  assert.ok(pinned.files('proposals/plan-release-2026-10-24.status-').length === 1, 'the plan is marked started');

  const switched = boot(); await switched.tick(60);
  switched.choose('person-casey'); await switched.tick();
  switched.click('review-plan', 'plan-release-2026-10-24'); await switched.tick();
  switched.click('plan-latest', 'plan-release-2026-10-24'); await switched.tick();
  assert.ok(/Switched to v2/.test(switched.html()));
  before = releaseRuns(switched);
  switched.submitForm('start-form'); await switched.tick(120);
  made = releaseRuns(switched).filter(p => before.indexOf(p) < 0);
  run = JSON.parse(switched.fs.files[made[0]].t);
  assert.strictEqual(run.version, 2); assert.strictEqual(run.folder, pubFolder(switched, 2));
});

rule('Plans: when the version a plan pins is gone, it starts on the latest and says so', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const v1 = pubFolder(app, 1);
  app.files('publications/release/' + v1 + '/').forEach(p => { delete app.fs.files[p]; });
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  assert.ok(/made for v1, which can(&#39;|')t be used anymore\. It starts on v2/.test(app.html()));
  const before = releaseRuns(app);
  app.submitForm('start-form'); await app.tick(120);
  const run = JSON.parse(app.fs.files[releaseRuns(app).filter(p => before.indexOf(p) < 0)[0]].t);
  assert.strictEqual(run.version, 2);
});

rule('Plans: an older version can only be started through a plan that pins it, never from a form drawn earlier', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const v1 = pubFolder(app, 1), before = releaseRuns(app);
  // A plain start whose form named v1.
  app.click('start', 'release'); await app.tick();
  app.submitForm('start-form', { folder: v1 }); await app.tick(80);
  assert.deepStrictEqual(releaseRuns(app), before, 'nothing started');
  assert.ok(/A new version was published while you were filling this in/.test(app.html()));
  // A plan switched to the latest, submitted from a form still showing v1.
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  app.click('plan-latest', 'plan-release-2026-10-24'); await app.tick();
  app.submitForm('start-form', { folder: v1 }); await app.tick(80);
  assert.deepStrictEqual(releaseRuns(app), before, 'nothing started');
  assert.ok(/The version this plan starts on changed/.test(app.html()));
});

rule('Plans: the example plan with a time shows on Home with one way to review and start it', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  assert.ok(/Release 2026\.10\.23 is planned for [^<]* · in \d+ (hours|minutes)/.test(app.html()));
  assert.ok(/data-act="review-plan" data-id="plan-release-example-next">Review and start</.test(app.html()));
});

rule('Plans: a switch pins the exact version chosen; a version published after the switch is pointed out, never started silently', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  app.click('plan-latest', 'plan-release-2026-10-24'); await app.tick();
  // Someone publishes v3 (a copy of v2 under a new number), and the folder is read again.
  const v2 = pubFolder(app, 2), v3 = 'v3-zzzzzzzz';
  app.files('publications/release/' + v2 + '/').forEach(p => {
    const t = app.fs.files[p].t, name = p.split('/').pop();
    app.fs.files['publications/release/' + v3 + '/' + name] = { t: name === 'publication.json' ? JSON.stringify(Object.assign(JSON.parse(t), { version: 3, folder: v3 })) : t, m: Date.now() };
  });
  app.click('refresh'); await app.tick(80);
  assert.ok(/You switched this plan to v2\. v3 is now published\./.test(app.html()), 'asks again');
  assert.ok(/Switch to v3/.test(app.html()));
  const before = releaseRuns(app);
  app.submitForm('start-form'); await app.tick(120);
  const run = JSON.parse(app.fs.files[releaseRuns(app).filter(p => before.indexOf(p) < 0)[0]].t);
  assert.strictEqual(run.folder, v2, 'the version chosen, not the newer one');
});

rule('Plans: a switch belongs to one folder and one version of the plan', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  app.click('plan-latest', 'plan-release-2026-10-24'); await app.tick();
  assert.ok(/Switched to v2/.test(app.html()));
  // The plan's file changes (an assistant rewrote it): the switch was made on what it said before.
  const path = 'proposals/plan-release-2026-10-24.json', plan = JSON.parse(app.fs.files[path].t);
  app.fs.files[path] = { t: JSON.stringify(Object.assign(plan, { note: 'Changed' })), m: Date.now() };
  app.click('refresh'); await app.tick(80);
  assert.ok(/This plan was made for v1\. v2 is now published\./.test(app.html()), 'asks again');
  // Switching folders drops the choice: reset the examples (a new folder generation) and the same plan asks again.
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  app.click('plan-latest', 'plan-release-2026-10-24'); await app.tick();
  app.click('reset-examples'); await app.tick(200);
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  assert.ok(/This plan was made for v1\. v2 is now published\./.test(app.html()), 'not carried into another folder');
});

rule('Plans: as time passes, Home picks up a plan entering its last day and the times in words stay current, with no change in the folder', async () => {
  let offset = 0;
  const RealDate = Date;
  class Clock extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); } static now() { return RealDate.now() + offset; } }
  const app = boot({ Date: Clock }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const when = new RealDate(RealDate.now() + 26 * 3600000); when.setMinutes(0, 0, 0);
  app.fs.files['proposals/plan-release-later.json'] = { t: JSON.stringify({ kind: 'plan', id: 'plan-release-later', process: 'release', version: 2, title: 'Release later', details: {}, roles: {}, when: when.toISOString(), by: 'person-casey', created: new RealDate().toISOString() }), m: RealDate.now() };
  app.click('refresh'); await app.tick(80); app.click('home'); await app.tick();
  app.every(); await app.tick();
  assert.ok(!/Release later is planned/.test(app.html()), 'more than a day away: not on Home yet');
  offset = 3 * 3600000;
  app.every(); await app.tick();
  assert.ok(/Release later is planned for [^<]* · in 2\d hours|Release later is planned for [^<]* · tomorrow/.test(app.html()), 'inside its last day: on Home');
  assert.ok(/Release 2026\.10\.23 is planned for [^<]* · (starts now|was due \d+ minutes ago|in \d+ minutes)/.test(app.html()), 'the other plan\'s time words moved on');
});

rule('Plans: a time the clocks skip is pointed out, not saved an hour off', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('plan-run', 'release'); await app.tick();
  const before = app.files('proposals/'), real = app.PF.util.localDateTime;
  app.PF.util.localDateTime = () => ({ error: 'gap' });
  try { app.set('plan-when', '2026-03-08T02:30'); app.submitForm('plan-form'); await app.tick(40); } finally { app.PF.util.localDateTime = real; }
  assert.strictEqual(newPlans(app, before).length, 0);
  assert.ok(/That time doesn(&#39;|')t exist on that day \(clocks change\); pick another\./.test(app.html()));
});

run();
