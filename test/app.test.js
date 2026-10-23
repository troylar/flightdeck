// The app's own wiring, run against the real built file with a stand-in browser: races between recovery, saving and
// switching folders, paused at exact moments.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate, bus, locks, folderHandle, memoryIDB } = require('./app-harness');

// A file that really is a PNG: attachments are checked against their first bytes.
const png = (name) => { const b = new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 73, 72, 68, 82])], { type: 'image/png' }); if (name) b.name = name; return b; };
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
  assert.ok(/<ol class="fp"/.test(app.html()) && /Typically/.test(app.html()) && /From \d+ finished runs? of v1\./.test(app.html()), 'v1, which the example runs used, shows their times');
  app.click('flight', 'list'); await app.tick();
  assert.ok(/class="ph"/.test(app.html()) && !/class="fp"/.test(app.html()), 'and back');
  app.click('flight', 'plan'); await app.tick();
  app.click('flight-phase', '1'); await app.tick();
  assert.ok(/<h3 id="cl-ph-1" tabindex="-1">/.test(app.html()) && !/class="fp"/.test(app.html()) && /data-act="flight" data-id="list" aria-pressed="true"/.test(app.html()), 'a phase opens the checklist at that phase');
});

/* A step's button in the flight plan, as the page drew it: its data-* attributes. */
function fpStepData(html, id) {
  const at = html.indexOf('data-step="' + id + '"'), tag = html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at)), d = {};
  tag.replace(/\sdata-([\w-]+)="([^"]*)"/g, (m, k, v) => { d[k.replace(/-(\w)/g, (x, c) => c.toUpperCase())] = v; });
  return d;
}
const openPhases = html => (html.match(/<details class="fp-steps"[^>]* open>/g) || []).length;

rule('App: choosing a step in the flight plan opens that step in the checklist, in the same version', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  const v1 = /data-act="view-version" data-id="(v1-[^"]+)"/.exec(app.html())[1];
  app.click('view-version', v1); await app.tick();
  app.click('flight', 'plan'); await app.tick();
  const d = fpStepData(app.html(), 'jenkins');
  assert.strictEqual(d.act, 'go'); assert.strictEqual(d.mapVer, v1, 'the step names the version shown');
  app.click('go', undefined, d); await app.tick();
  assert.ok(/data-act="flight" data-id="list" aria-pressed="true"/.test(app.html()) && !/class="fp"/.test(app.html()), 'the checklist');
  assert.ok(/<li id="cl-st-jenkins" tabindex="-1">/.test(app.html()) && app.focused() === 'cl-st-jenkins', 'at that step, with focus on it');
  assert.ok(/You're looking at v1/.test(app.html()), 'still v1');
});

rule('App: Show all steps and Hide all steps open and close every phase, and the choice is kept per process in this browser', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  app.click('flight', 'plan'); await app.tick();
  const n = (app.html().match(/<details class="fp-steps"/g) || []).length;
  assert.ok(n > 1 && openPhases(app.html()) === n, 'a short checklist starts open');
  app.click('fp-steps', 'hide'); await app.tick();
  assert.ok(openPhases(app.html()) === 0 && /data-act="fp-steps" data-id="show">Show all steps</.test(app.html()), 'all closed');
  assert.strictEqual(app.focused(), '[data-act="fp-steps"]', 'focus stays on the control');
  assert.deepStrictEqual(JSON.parse(app.store['preflight:fpSteps']), { release: { d: false } }, 'kept in this browser');
  assert.ok(!app.files('').some(f => /fpSteps/.test(app.fs.files[f].t || '')), 'never in the team folder');
  // Opening one phase by hand is kept too; the control still offers Show all.
  app.fire('toggle', { target: { dataset: { fps: '1', fpsOpen: '0' }, open: true } }); await app.tick();
  assert.deepStrictEqual(JSON.parse(app.store['preflight:fpSteps']), { release: { d: false, p: { 1: true } } });
  assert.ok(/data-fps="1" data-fps-open="1" open>/.test(app.html()) && openPhases(app.html()) === 1 && /data-id="show">Show all steps</.test(app.html()));
  // A toggle the page drew itself (an open phase reported open) changes nothing.
  app.fire('toggle', { target: { dataset: { fps: '1', fpsOpen: '1' }, open: true } }); await app.tick();
  assert.deepStrictEqual(JSON.parse(app.store['preflight:fpSteps']), { release: { d: false, p: { 1: true } } });
  app.click('fp-steps', 'show'); await app.tick();
  assert.ok(openPhases(app.html()) === n && /data-id="hide">Hide all steps</.test(app.html()), 'all open again');
  assert.deepStrictEqual(JSON.parse(app.store['preflight:fpSteps']), { release: { d: true } });
  app.click('fp-steps', 'hide'); await app.tick();
  // Another process keeps its own default; another window in this browser opens the release as it was left.
  app.click('open-process', 'check-in'); await app.tick();
  assert.ok(openPhases(app.html()) > 0, 'another process: its own default');
  const two = boot({ localStore: { 'preflight:fpSteps': app.store['preflight:fpSteps'] } }); await two.tick(80);
  two.choose('person-casey'); await two.tick();
  two.click('open-process', 'release'); await two.tick(); two.click('flight', 'plan'); await two.tick();
  assert.strictEqual(openPhases(two.html()), 0, 'closed, as left');
  // What was kept is read, never trusted.
  const odd = boot({ localStore: { 'preflight:fpSteps': '{"release":{"d":"yes","p":{"x":true,"0":"no","1":false}},"__proto__":{"d":false}}' } }); await odd.tick(80);
  odd.choose('person-casey'); await odd.tick();
  odd.click('open-process', 'release'); await odd.tick(); odd.click('flight', 'plan'); await odd.tick();
  assert.ok(/data-fps="1" data-fps-open="0">/.test(odd.html()) && openPhases(odd.html()) === n - 1, 'only a phase number with true or false counts');
});

rule('App: when the browser refuses storage, Show all steps and Hide all steps still work on the page', async () => {
  const app = boot({ storageThrows: /fpSteps/, localStore: { 'preflight:fpSteps': '{"release":{"d":false}}' } }); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  app.click('flight', 'plan'); await app.tick();
  const n = (app.html().match(/<details class="fp-steps"/g) || []).length;
  assert.strictEqual(openPhases(app.html()), n, 'nothing could be read: the default');
  app.click('fp-steps', 'hide'); await app.tick();
  assert.strictEqual(openPhases(app.html()), 0, 'for this page');
  app.fire('toggle', { target: { dataset: { fps: '0', fpsOpen: '0' }, open: true } }); await app.tick();
  assert.strictEqual(openPhases(app.html()), 1);
  app.click('fp-steps', 'show'); await app.tick();
  assert.strictEqual(openPhases(app.html()), n);
  assert.strictEqual(app.store['preflight:fpSteps'], '{"release":{"d":false}}', 'what was kept before is untouched');
});

rule('App: the sections switch from the top bar, and Home never opens a run by itself', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  assert.ok(/Needs you/.test(app.html()) && !/id="phase-/.test(app.html()), 'Home lists, it doesn\'t open');
  for (const s of ['runs', 'processes', 'skills', 'types', 'settings', 'home']) { app.click('nav', s); await app.tick(); assert.ok(new RegExp('data-id="' + (s === 'skills' || s === 'types' ? 'processes' : s) + '" aria-current="page"').test(app.top()), s); }
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
  assert.ok(/Unsaved: Save draft before you publish/.test(app.html()), 'builder edits are unsaved, like typing');
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
  assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()), 'saved');
});

rule('App: the builder\'s Undo puts back the last change, and the Markdown view lists the lines changed', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-del', 'rollback'); await app.tick();
  assert.ok(!/data-ob-step="rollback"/.test(app.html()) && /Deleted the step\./.test(app.html()));
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/data-ob-step="rollback"/.test(app.html()) && !/Unsaved: Save draft before you publish/.test(app.html()), 'back, and nothing left unsaved');
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

rule('App: once the editor follows a newer draft from the folder, Undo takes it back only in the editor: their draft stays on disk until the person saves', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-sel', 'flags'); await app.tick();
  app.check('ob-mark-step', true); await app.tick();
  app.check('ob-mark-must', true); await app.tick();
  assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()), 'set-up: back to the saved text, with two Undo steps');
  const theirs = original.replace('title: Production release', 'title: Theirs');
  await app.fs.write(path, theirs);
  app.focus(); await app.tick(80);
  assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()), 'followed');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/Unsaved: Save draft before you publish/.test(app.html()), 'their change, taken back in the editor, is an unsaved edit');
  assert.strictEqual(app.fs.files[path].t, theirs, 'Undo never writes the draft');
  app.click('tl-redo', 'draft'); await app.tick();
  assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()), 'Redo: their text again, nothing unsaved');
  assert.strictEqual(app.fs.files[path].t, theirs);
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
  assert.ok(/<textarea id="ob-text" rows="2" maxlength="200" data-enter="ob-commit">Flags set by them<\/textarea>/.test(app.html()), 'drawn from the new text');
  assert.notStrictEqual(app.draft('ob-text'), 'Half typed', 'the old value isn\'t carried over');
});

rule('App: moving a phase without an ID keeps it selected, so the next change goes to that phase', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md';
  await app.fs.write(path, ['---', 'process: release', 'title: Production release', '---', '', '## First · READ-DO', '- [ ] {confirm} One {#one}', '', '## Second · READ-DO', '- [ ] {confirm} Two {#two}', ''].join('\n'));
  app.focus(); await app.tick(80);
  app.click('ob-sel-phase', '#0'); await app.tick();
  app.click('ob-ph-move', '#0', { dir: 'down' }); await app.tick();
  assert.ok(/<li class="ob-phase sel[^"]*"><div class="ob-ph-head"><div class="fp-eye">Phase 2/.test(app.html()), 'the moved phase is still the selected one');
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
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/<li class="ob-phase sel[^"]*"><div class="ob-ph-head"><div class="fp-eye">Phase 1/.test(app.html()), 'First is selected again, back in first place');
  app.set('ob-ph-title', 'First, renamed'); app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'ob-ph-title', value: 'First, renamed', dataset: { enter: 'ob-commit' }, closest: () => null }); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const t = app.fs.files[path].t;
  assert.ok(/## First, renamed · READ-DO\n- \[ \] \{confirm\} One \{#one\}\n\n## Second · READ-DO/.test(t), t);
});

/* The draft editor's text as the page draws it in Markdown. */
const mdOf = app => { const m = /<textarea id="draft-editor"[^>]*>\n([\s\S]*?)<\/textarea>/.exec(app.html()); return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') : null; };
/* Typing redraws the page at most every 250 ms. */
const settle = app => new Promise(r => setTimeout(r, 300)).then(() => app.tick());
/* A key pressed with Cmd (or Ctrl) on an element, and whether the app took it from the browser. */
function cmdKey(app, key, target, mods) { let taken = false; app.keyOn(key, Object.assign({ metaKey: true, preventDefault() { taken = true; } }, mods || {}), target); return taken; }
const undoLabel = app => { const m = /data-act="tl-undo" data-id="draft"[^>]*aria-keyshortcuts[^>]*><span class="ic"[\s\S]*?<\/svg><\/span>([\s\S]*?)<\/button>/.exec(app.html()); return m ? m[1].replace(/<[^>]+>/g, '') : null; };

rule('App: typing in the Markdown keeps the builder\'s Undo, and switching views keeps both', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-del', 'rollback'); await app.tick();
  assert.strictEqual(undoLabel(app), 'Undo step deletion');
  app.click('ed-mode', 'markdown'); await app.tick();
  assert.strictEqual(undoLabel(app), 'Undo step deletion', 'the same Undo in Markdown');
  const t = mdOf(app), at = t.indexOf('{#flags}');
  app.input('draft-editor', t.slice(0, at) + 'now ' + t.slice(at)); await settle(app);
  assert.strictEqual(undoLabel(app), 'Undo typing');
  assert.ok(/aria-label="Undo the typing in &quot;Feature flags set in the deploy values/.test(app.html()), 'named by the step it was typed in');
  app.click('ed-mode', 'builder'); await app.tick();
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(undoLabel(app), 'Undo step deletion', 'the typing went first, and the builder change is still there to undo');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/data-ob-step="rollback"/.test(app.html()) && !/Unsaved: Save draft before you publish/.test(app.html()), 'both undone, back to the saved draft');
  app.click('tl-redo', 'draft'); await app.tick(); app.click('tl-redo', 'draft'); await app.tick();
  app.click('ed-mode', 'markdown'); await app.tick();
  assert.ok(!/\{#rollback\}/.test(mdOf(app)) && /@backend now \{#flags\}/.test(mdOf(app)), 'Redo brought both back');
  assert.strictEqual(app.fs.files[path].t, original, 'nothing written');
});

rule('App: Undo after Save makes the draft unsaved again, and saving it is checked like any other save', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const saved = app.fs.files[path].t;
  assert.ok(!/\{#rollback\}/.test(saved) && !/Unsaved: Save draft before you publish/.test(app.html()), 'set-up: saved without Rollback');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/Unsaved: Save draft before you publish/.test(app.html()) && /data-ob-step="rollback"/.test(app.html()), 'undoing a saved change makes the draft unsaved');
  app.click('save-draft'); await app.tick(80);
  assert.strictEqual(app.fs.files[path].t, original, 'saved back to the original');
  app.click('tl-redo', 'draft'); await app.tick();
  // Someone else changes the draft before this one is saved: the save is refused, never written over theirs.
  const theirs = original.replace('title: Production release', 'title: Theirs');
  await app.fs.write(path, theirs);
  app.click('save-draft'); await app.tick(80);
  assert.strictEqual(app.fs.files[path].t, theirs, 'their change is kept');
  assert.ok(/Someone else changed this draft/.test(app.html()), 'shown as a conflict');
  app.click('hist-open', 'draft'); await app.tick();
  assert.ok(/class="hist-entry"><div class="hist-what">The step deletion of &quot;Rollback commit written in the release ticket&quot;<\/div><div class="small">You · [^<]* · saved/.test(app.overlay()), 'History says the change was saved');
});

rule('App: following a newer draft from the folder is one undoable change: Undo takes it back as unsaved, and the changes before it stay undoable', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md';
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const theirs = app.fs.files[path].t.replace('title: Production release', 'title: Theirs');
  await app.fs.write(path, theirs);
  app.focus(); await app.tick(80);
  assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()), 'the editor follows it, with nothing unsaved');
  assert.ok(!/data-act="tl-undo" data-id="draft" aria-disabled="true"/.test(app.html()), 'Undo is available');
  assert.ok(/This draft changed in the team folder\. Undo available\./.test(app.live()), 'and says so once');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/Unsaved: Save draft before you publish/.test(app.html()) && !/data-ob-step="rollback"/.test(app.html()), 'one Undo takes their change back, as an unsaved edit');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/data-ob-step="rollback"/.test(app.html()), 'and the change before it can still be undone');
  app.click('hist-open', 'draft'); await app.tick();
  assert.ok(/The change from the team folder/.test(app.overlay()), 'History lists it');
  assert.ok(!/class="hist-mark"/.test(app.overlay()), 'no barrier');
  assert.strictEqual(app.fs.files[path].t, theirs, 'their draft is untouched');
});

rule('App: Take theirs and Restore each set a baseline, so Undo can\'t bring back the text they replaced', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-del', 'rollback'); await app.tick();
  const theirs = original.replace('title: Production release', 'title: Theirs');
  await app.fs.write(path, theirs);
  app.click('save-draft'); await app.tick(80);
  app.click('draft-take-theirs'); await app.tick();
  assert.ok(/data-act="tl-undo" data-id="draft" aria-disabled="true"/.test(app.html()) && /data-ob-step="rollback"/.test(app.html()), 'their text, nothing to undo');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/data-ob-step="rollback"/.test(app.html()), 'Undo doesn\'t delete Rollback from their text');
  app.click('hist-open', 'draft'); await app.tick();
  assert.ok(/You took their version here/.test(app.overlay()));
  app.key('Escape'); await app.tick();
  // Restore an older version as the draft.
  app.click('ob-del', 'flags'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const folder = app.files('publications/release/').map(p => p.split('/')[2]).filter(f => /^v1-/.test(f))[0];
  assert.ok(folder, 'set-up: v1 is published');
  app.click('restore-draft', folder); await app.tick();
  app.click('restore-draft', folder, { sure: '1' }); await app.tick(80);
  assert.ok(/Restored v1 as the draft/.test(app.html()), 'restored');
  app.click('ptab', 'edit'); await app.tick();
  assert.ok(/data-act="tl-undo" data-id="draft" aria-disabled="true"/.test(app.html()), 'nothing before the restore can be undone');
  app.click('hist-open', 'draft'); await app.tick();
  assert.ok(/You restored v1 as the draft here/.test(app.overlay()));
});

rule('App: Cmd+Z in the Markdown editor uses the draft\'s Undo, not the browser\'s, and so does the Edit menu', async () => {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const t = mdOf(app), ta = { tagName: 'TEXTAREA', id: 'draft-editor', dataset: {}, closest: () => null };
  app.input('draft-editor', t + 'A'); await app.tick();
  app.input('draft-editor', t + 'AB'); await app.tick();
  assert.ok(cmdKey(app, 'z', ta), 'the app takes Cmd+Z');
  await app.tick();
  assert.strictEqual(mdOf(app), t, 'one Undo takes back the whole run of typing');
  assert.ok(cmdKey(app, 'z', ta, { metaKey: false, ctrlKey: true, shiftKey: true, key: 'Z' }), 'Ctrl+Shift+Z is Redo');
  await app.tick();
  assert.strictEqual(mdOf(app), t + 'AB');
  assert.ok(app.beforeinput('draft-editor', 'historyUndo'), 'the browser\'s own Undo is cancelled');
  await app.tick();
  assert.strictEqual(mdOf(app), t, '...and done by the draft\'s Undo');
  assert.ok(!app.beforeinput('draft-editor', 'insertText'), 'typing isn\'t touched');
  app.input('draft-editor', t + 'pasted', 'insertFromPaste'); await settle(app);
  assert.strictEqual(undoLabel(app), 'Undo paste');
});

rule('App: Cmd+Z in a builder box with typing not yet applied leaves that box\'s own undo alone', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'flags'); await app.tick();
  app.check('ob-mark-step', true); await app.tick();
  assert.ok(/Unsaved: Save draft before you publish/.test(app.html()), 'set-up: one change to undo');
  const box = v => ({ tagName: 'INPUT', id: 'ob-text', value: v, defaultValue: 'Feature flags set in the deploy values', dataset: { enter: 'ob-commit' }, closest: () => null });
  assert.ok(!cmdKey(app, 'z', box('Feature flags, half typed')), 'the browser undoes the typing in the box');
  await app.tick();
  assert.ok(/Unsaved: Save draft before you publish/.test(app.html()), 'and the draft is left alone');
  assert.ok(cmdKey(app, 'z', box('Feature flags set in the deploy values')), 'with nothing typed, the draft\'s Undo');
  await app.tick();
  assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()), 'undone');
  assert.ok(!cmdKey(app, 'z', { tagName: 'SELECT', id: 'me', value: '', dataset: {}, closest: () => null }), 'the name at the top keeps the browser\'s');
});

rule('App: Alt+Up still moves a step and Enter still adds one, next to the Undo and Redo keys', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', PF = app.PF;
  app.click('ob-sel', 'rollback'); await app.tick();
  app.keyOn('ArrowUp', { altKey: true }, rowOf('rollback')); await app.tick();
  app.click('ob-add-after', 'rollback'); await app.tick();
  app.set('ob-new-text', 'Check the dashboards'); app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'ob-new-text', value: 'Check the dashboards', dataset: { enter: 'ob-add-go' }, closest: () => null }); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.deepStrictEqual(idsOf(PF, app.fs.files[path].t).slice(0, 5), ['approved', 'tests', 'rollback', 'check-the-dashboards', 'flags'], 'moved up, and added after it');
  assert.ok(cmdKey(app, 'z', rowOf('check-the-dashboards'), { metaKey: false, ctrlKey: true })); await app.tick();
  assert.ok(!/data-ob-step="check-the-dashboards"/.test(app.html()), 'Ctrl+Z undid the add');
  assert.ok(cmdKey(app, 'y', rowOf('rollback'), { metaKey: false, ctrlKey: true })); await app.tick();
  assert.ok(/data-ob-step="check-the-dashboards"/.test(app.html()), 'Ctrl+Y redid it');
  assert.ok(!cmdKey(app, 'z', rowOf('rollback'), { altKey: true }), 'Alt+Cmd+Z is left alone');
});

rule('App: each Undo and Redo says what it undid or redid, on screen and to screen readers', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'flags'); await app.tick();
  app.click('ob-move', 'flags', { dir: 'up' }); await app.tick();
  assert.ok(/Moved &quot;Feature flags set in the deploy values&quot;. Undo available./.test(app.html()) && /data-act="tl-undo" data-id="draft">Undo<\/button>/.test(app.html()), 'the change says Undo is there, with a button');
  assert.strictEqual(app.live(), 'Moved "Feature flags set in the deploy values". Undo available.');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(app.live(), 'Undid the move of "Feature flags set in the deploy values". Redo available.');
  assert.ok(/data-act="tl-redo" data-id="draft">Redo<\/button>/.test(app.html()), 'with a Redo button');
  assert.ok(/<li class="ob-step sel"[^>]*data-ob-step="flags">/.test(app.html()), 'the step is still selected');
  app.click('tl-redo', 'draft'); await app.tick();
  assert.strictEqual(app.live(), 'Redid the move of "Feature flags set in the deploy values". Undo available.');
  app.click('ob-move', 'flags', { dir: 'up' }); await app.tick();
  app.click('tl-undo', 'draft'); await app.tick();
  const once = app.live();
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(app.live() !== once && app.live().trim() === once.trim(), 'the same words again are announced again');
});

rule('Typed values: Add evidence makes a number, a yes/no or a date as chosen, never text', async () => {
  for (const kind of ['number', 'yes-no', 'date']) {
    const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
    app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
    app.click('tf-add', 'r', { kind }); await app.tick();
    const k = (/data-act="tf-open" data-id="r:(k\d+)"/.exec(app.html()) || [])[1];
    assert.ok(k, kind + ': a row');
    assert.ok(new RegExp('<option value="' + kind + '" selected').test(app.html()), kind + ': ' + (app.html().match(/<select[^>]*-kind"[\s\S]*?<\/select>/) || [''])[0].slice(0, 400));
  }
});

rule('App: in a step type, removing a field and undoing puts it back in place with all it had, and Cmd+Z there uses the same Undo', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  const rows = () => [...app.html().matchAll(/data-act="tf-open" data-id="f:(k\d+)"[^>]*><span class="tf-item-text"><span class="tf-item-t">([^<]*)</g)].map(m => [m[1], m[2]]);
  app.click('tf-add', 'f', { kind: 'choice' }); await app.tick();
  const [k1] = rows()[0];
  app.input('tf-f-' + k1 + '-label', 'Level'); await settle(app);
  assert.ok(new RegExp('id="tf-f-' + k1 + '-name"[^>]*value="level"').test(app.html()), 'the name comes from the label');
  app.set('tf-f-' + k1 + '-optadd', 'Low'); app.click('tf-opt-add', 'f:' + k1); await app.tick();
  app.set('tf-f-' + k1 + '-optadd', 'High'); app.click('tf-opt-add', 'f:' + k1); await app.tick();
  app.click('tf-add', 'f'); await app.tick();
  const k2 = rows()[1][0];
  app.input('tf-f-' + k2 + '-label', 'Owner'); await settle(app);
  assert.ok(/data-act="tl-undo" data-id="type"[^>]*>(?:<span class="ic"[\s\S]*?<\/svg><\/span>)?<span>Undo<span class="tl-what"> typing<\/span><\/span><\/button>/.test(app.html()), 'the step-type form has the same Undo');
  app.click('tf-remove', 'f:' + k1); await app.tick();
  assert.deepStrictEqual(rows().map(r => r[1]), ['Owner']);
  assert.strictEqual(app.live(), 'Removed field "level". Undo available.');
  app.click('tl-undo', 'type'); await app.tick();
  assert.deepStrictEqual(rows(), [[k1, 'Level'], [k2, 'Owner']], 'back first, with its own key');
  app.click('tf-open', 'f:' + k1); await app.tick();
  assert.ok(new RegExp('id="tf-f-' + k1 + '-kind"[^>]*>[\\s\\S]*?<option value="choice" selected>').test(app.html()) && /<li class="tf-chip">Low<button[\s\S]*?<li class="tf-chip">High<button/.test(app.html()), 'with its type and options');
  assert.strictEqual(app.live(), 'Undid the field removal of "level". Redo available.');
  const box = { tagName: 'INPUT', id: 'tf-f-' + k2 + '-label', value: 'Owner', dataset: {}, closest: () => null };
  assert.ok(cmdKey(app, 'z', box), 'Cmd+Z in a box of the form goes to its Undo');
  await app.tick();
  assert.deepStrictEqual(rows().map(r => r[1]), ['Level', 'New field'], 'it undid the typing');
  assert.ok(app.beforeinput('tf-label', 'historyUndo'), 'and the browser\'s own Undo goes there too');
  assert.ok(!cmdKey(app, 'z', { tagName: 'INPUT', id: 'tf-tagadd', value: 'half', defaultValue: '', dataset: {}, closest: () => null }), 'the Add a tag box keeps its own undo while it holds typing');
  app.click('hist-open', 'type', { item: 'field:' + k1 }); await app.tick();
  assert.ok(/Only changes to <b>field level<\/b>/.test(app.overlay()) && /The new option of &quot;High&quot;/.test(app.overlay()) && !/Owner/.test(app.overlay()), 'one field\'s History');
  app.click('hist-item', ''); await app.tick();
  assert.ok(/Owner/.test(app.overlay()), 'Show all');
});

/* A key on an editor's separator: the stand-in has the separator's data, and closest finds it. */
function splitKey(app, key, k, mods) { const sep = { tagName: 'DIV', dataset: { act: 'pane-split', id: key, split: key }, closest: sel => /split|data-act/.test(sel) ? sep : null }; let taken = false; app.keyOn(k, Object.assign({ preventDefault() { taken = true; } }, mods || {}), sep); return taken; }
const splitTag = (app, key) => (new RegExp('<div class="pane-split"[^>]*data-split="' + key + '"[^>]*>').exec(app.html()) || [''])[0];
const splitNow = (app, key) => +(/aria-valuenow="(\d+)"/.exec(splitTag(app, key)) || [])[1];
const paneVar = (app, key) => { const m = new RegExp('class="fpe-panes[^"]*" style="[^"]*--pane-' + key + ':(\\d+)px').exec(app.html()); return m ? +m[1] : null; };

rule('App: the step-type preview resizes from the keyboard, stays put through a redraw, is kept in this browser, and Enter puts it back', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  const start = splitNow(app, 'tf'), min = +/aria-valuemin="(\d+)"/.exec(splitTag(app, 'tf'))[1], max = +/aria-valuemax="(\d+)"/.exec(splitTag(app, 'tf'))[1];
  assert.ok(start > 0 && paneVar(app, 'tf') === null, 'the layout\'s own width to begin with');
  assert.ok(splitKey(app, 'tf', 'ArrowLeft'), 'the key is taken'); await app.tick();
  assert.strictEqual(paneVar(app, 'tf'), start + 16, 'Left moves the divider left: the preview grows by 16px');
  assert.strictEqual(splitNow(app, 'tf'), start + 16, 'and says so');
  splitKey(app, 'tf', 'ArrowLeft', { shiftKey: true }); await app.tick();
  assert.strictEqual(paneVar(app, 'tf'), start + 80, 'Shift moves 64px');
  splitKey(app, 'tf', 'ArrowRight'); await app.tick();
  assert.strictEqual(paneVar(app, 'tf'), start + 64);
  splitKey(app, 'tf', 'Home'); await app.tick();
  assert.strictEqual(paneVar(app, 'tf'), min, 'Home: the narrowest');
  splitKey(app, 'tf', 'ArrowRight', { shiftKey: true }); await app.tick();
  assert.strictEqual(paneVar(app, 'tf'), min, 'never narrower');
  splitKey(app, 'tf', 'End'); await app.tick();
  assert.strictEqual(paneVar(app, 'tf'), max, 'End: the widest');
  splitKey(app, 'tf', 'ArrowLeft'); await app.tick();
  assert.strictEqual(splitNow(app, 'tf'), max, 'never wider');
  assert.strictEqual(JSON.parse(app.store['preflight:panes']).tf, max, 'kept in this browser');
  assert.ok(!app.files('').some(f => /pane/.test(f) || app.fs.files[f].t.indexOf('"tf":') >= 0), 'never in the team folder');
  app.click('tf-add', 'f'); await app.tick();
  assert.ok(/data-act="tf-open" data-id="f:/.test(app.html()) && paneVar(app, 'tf') === max, 'a redraw keeps it');
  assert.ok(!splitKey(app, 'tf', 'a'), 'other keys are left alone');
  splitKey(app, 'tf', 'Enter'); await app.tick();
  assert.ok(paneVar(app, 'tf') === null && splitNow(app, 'tf') === start, 'Enter: the default again');
  assert.ok(!('tf' in JSON.parse(app.store['preflight:panes'])), 'and nothing kept');
  // Another window in this browser opens it at the width kept; a kept value that makes no sense is ignored.
  const two = boot({ localStore: { 'preflight:panes': JSON.stringify({ tf: min + 40, parts: 'wide', ins: -3 }) } }); await two.tick(60); two.choose('person-casey'); await two.tick();
  two.click('nav', 'types'); await two.tick(); two.click('new-type'); await two.tick();
  assert.strictEqual(paneVar(two, 'tf'), min + 40);
});

rule('App: in the draft editor the parts and the inspector each keep their own width', async () => {
  const app = await builderOn();
  const ins = splitNow(app, 'ins'), parts = splitNow(app, 'parts');
  assert.ok(ins > 0 && parts > 0);
  splitKey(app, 'ins', 'ArrowLeft', { shiftKey: true }); await app.tick();
  splitKey(app, 'parts', 'ArrowRight'); await app.tick();
  assert.strictEqual(paneVar(app, 'ins'), ins + 64, 'Left widens the inspector, on the right');
  assert.strictEqual(paneVar(app, 'parts'), parts + 16, 'Right widens the parts, on the left');
  app.click('ed-mode', 'markdown'); await app.tick();
  assert.ok(paneVar(app, 'ins') === ins + 64 && paneVar(app, 'parts') === null, 'the Markdown view has the same inspector, and no parts');
  app.click('ed-mode', 'builder'); await app.tick();
  splitKey(app, 'parts', 'Enter'); await app.tick();
  assert.ok(paneVar(app, 'parts') === null && paneVar(app, 'ins') === ins + 64, 'resetting one leaves the other');
});

rule('App: when the browser refuses storage, the separators still resize and nothing breaks', async () => {
  const app = boot({ storageThrows: /panes/, localStore: { 'preflight:panes': '{"tf":500}' } }); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  const start = splitNow(app, 'tf');
  assert.ok(start > 0);
  splitKey(app, 'tf', 'ArrowLeft'); await app.tick();
  assert.strictEqual(paneVar(app, 'tf'), start + 16, 'for this page');
  splitKey(app, 'tf', 'Enter'); await app.tick();
  assert.strictEqual(paneVar(app, 'tf'), null);
  assert.strictEqual(app.store['preflight:panes'], '{"tf":500}', 'what was kept before is untouched');
});

/* A separator and its panes as a browser has them, for dragging: the live node is what the page finds now. */
function dragSetup(app) {
  const styles = [];
  const box = { setAttribute: (k, v) => styles.push(v), removeAttribute: () => styles.push(null), querySelectorAll: () => [live.sep] };
  const node = () => { const n = { tagName: 'DIV', dataset: { split: 'tf', act: 'pane-split', id: 'tf' }, parentNode: box, attrs: {}, captured: false,
    getAttribute: k => k === 'data-split' ? 'tf' : n.attrs[k], setAttribute: (k, v) => { n.attrs[k] = v; }, focus() {}, setPointerCapture() { n.captured = true; }, releasePointerCapture() { n.captured = false; } };
    n.closest = sel => /pane-split|data-split|data-act/.test(sel) ? n : null; return n; };
  const live = { sep: node() };
  app.el('tf-preview').getBoundingClientRect = () => ({ width: 400 });
  const appEl = app.el('app'), q = appEl.querySelector;
  appEl.querySelector = sel => /pane-split/.test(sel) ? live.sep : q(sel);
  return { live, node, styles };
}
const ptr = (target, x, extra) => Object.assign({ target, pointerId: 7, button: 0, clientX: x }, extra || {});

rule('App: dragging a separator follows the separator the page has now, and a separator gone mid-drag ends the drag', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  const d = dragSetup(app), first = d.live.sep;
  app.fire('pointerdown', ptr(first, 500));
  assert.ok(first.captured && app.rootClasses().includes('pane-drag'), 'captured, and the page selects no text');
  app.fire('pointermove', ptr(first, 450));
  assert.strictEqual(d.styles.pop(), '--pane-tf:450px', 'moving left widens the preview');
  // A redraw replaced the separator (its range changed): the drag goes on with the new one.
  d.live.sep = d.node();
  app.fire('pointermove', ptr(first, 440));
  assert.ok(d.styles.pop() === '--pane-tf:460px' && d.live.sep.attrs['aria-valuenow'] === '460', 'the live separator says the width');
  // It's gone (the panes stacked): the next move ends the drag instead of writing to a detached node.
  d.live.sep = null;
  app.fire('pointermove', ptr(first, 430));
  assert.ok(!app.rootClasses().includes('pane-drag'), 'text can be selected again');
  await app.tick();
  assert.ok(/class="fpe-panes tf-panes" style="--pane-tf:460px"/.test(app.html()), 'the width reached is kept');
});

rule('App: a drag ends on release, cancel, lost capture or leaving the window, and text can always be selected again', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  const d = dragSetup(app);
  const ends = { pointerup: s => app.fire('pointerup', ptr(s, 480)), pointercancel: s => app.fire('pointercancel', ptr(s, 480)), lostpointercapture: s => app.fire('lostpointercapture', ptr(s, 480)), blur: () => app.winFire('blur') };
  for (const [how, end] of Object.entries(ends)) {
    const s = d.live.sep;
    app.fire('pointerdown', ptr(s, 500));
    assert.ok(app.rootClasses().includes('pane-drag'), how + ': dragging');
    end(s);
    assert.ok(!app.rootClasses().includes('pane-drag'), how + ' ends it');
    const n = d.styles.length;
    app.fire('pointermove', ptr(s, 300));
    assert.strictEqual(d.styles.length, n, how + ': a later move resizes nothing');
    await app.tick();
  }
});

/* Blocked site storage: the examples live in this tab only. A badge says so above everything, a dialog explains it once,
   and no message is reworded. */
const BADGE = /id="tab-only"[^>]*role="note"[\s\S]*Tab only: changes vanish on reload[\s\S]*only while this tab is open/;
const blocked = async (opts) => {
  const app = boot(Object.assign({ storageThrows: true }, opts || {})); await app.tick(80);
  if (/id="tab-only-ok"/.test(app.overlay())) { app.click('close-overlay'); await app.tick(); }
  app.click('setup-mode', 'examples'); await app.tick(); app.choose('person-casey'); await app.tick();
  return app;
};
const shown = app => { const m = /<div class="notice[^"]*"(?: role="status")?><span>([\s\S]*?)<\/span>/.exec(app.html()); return m ? m[1] : null; };
const pageCss = () => /<style>([\s\S]*?)<\/style>/.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8'))[1];
const cssRules = css => css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}@]+\{[^{}]*\}/g).map(r => ({ sel: r.slice(0, r.indexOf('{')).trim(), body: r.slice(r.indexOf('{') + 1, -1) }));

rule('App: a browser that refuses all storage still opens the examples, says they last only for this tab, and resizes', async () => {
  const app = boot({ storageThrows: true, firstRun: true }); await app.tick(80);
  assert.ok(app.fs && app.files('runs/').length > 3 && app.files('publications/').length > 3, 'the examples are there, with their run history');
  app.click('close-overlay'); await app.tick();
  app.click('setup-mode', 'examples'); await app.tick(); app.choose('person-casey'); await app.tick();
  assert.ok(BADGE.test(app.badge()), 'and it says they aren\'t kept');
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  const start = splitNow(app, 'tf');
  splitKey(app, 'tf', 'ArrowLeft'); await app.tick();
  assert.strictEqual(paneVar(app, 'tf'), start + 16);
});

rule('App: with storage blocked, the Tab only badge is on every screen, editor, dialog and phone step sheet, and nothing makes it inert', async () => {
  const deny = () => { throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' }); };
  const app = boot({ storageThrows: true, firstRun: true, picker: {}, indexedDB: { open: deny } }); await app.tick(80);
  const on = where => {
    assert.ok(BADGE.test(app.badge()), where + ': the badge is there');
    assert.ok(!/id="tab-only"/.test(app.html() + app.top() + app.overlay()), where + ': drawn once, outside the screen and its dialogs');
    assert.ok(!app.badgeInert(), where + ': and never inert');
    assert.ok(app.rootClasses().includes('tab-only'), where + ': the page leaves room for it');
  };
  on('the explanation dialog'); app.click('close-overlay'); await app.tick();
  assert.ok(/couldn(&#39;|')t read which team folder you used last/.test(app.html()), 'another message doesn\'t replace it');
  on('welcome');
  app.click('setup-mode', 'examples'); await app.tick(); app.choose('person-casey'); await app.tick();
  for (const id of ['home', 'runs', 'processes', 'skills', 'types', 'settings', 'followups']) { app.click('nav', id); await app.tick(); on(id); }
  app.click('health'); await app.tick(40); on('Folder health');
  app.click('connection'); await app.tick(40); on('Connection check');
  app.click('recovery'); await app.tick(); on('When something goes wrong');
  app.click('whats-new'); await app.tick(); on('What\'s new dialog');
  app.click('close-overlay'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick(); on('step-type editor');
  app.click('type-done'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); on('process page');
  app.click('hist-open', 'draft'); await app.tick(); on('History dialog');
  app.click('close-overlay'); await app.tick();
  app.click('ptab', 'edit'); await app.tick(); on('draft editor');
  app.click('ed-done'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(); on('run workspace');
  app.setNarrow(true); await app.tick(); on('phone layout');
  app.click('select', 'approve'); await app.tick();
  assert.ok(/class="[^"]*rw-ins[^"]*"[^>]*data-open="true"/.test(app.html()), 'set-up: the phone step sheet is open');
  on('phone step sheet at 375 px');
});

rule('Page: the Tab only badge is fixed above every layer, safe-area aware, and every sheet, dialog and editor starts below it', () => {
  const rules = cssRules(pageCss()), badge = rules.filter(r => /(^|,)\s*#tab-badge\s*(,|$)/.test(r.sel));
  const z = +(/z-index:\s*(\d+)/.exec(badge.map(r => r.body).join(';')) || [])[1];
  assert.ok(badge.some(r => /position:\s*fixed/.test(r.body)) && z > 0, 'it is fixed, with its own layer');
  assert.ok(badge.some(r => /env\(safe-area-inset-top/.test(r.body)), 'it keeps clear of the phone\'s notch');
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8');
  const others = (html.match(/z-index:\s*\d+/g) || []).map(x => +x.replace(/\D/g, '')).filter(n => n !== z);
  assert.ok(others.length > 5 && others.every(n => n < z), 'every sheet, overlay, dialog and menu sits below it: ' + Math.max(...others) + ' < ' + z);
  assert.ok(!/\btabindex=|<button|<a\s/.test(html.slice(html.indexOf('<div id="tab-badge"'), html.indexOf('</div>', html.indexOf('<div id="tab-badge"')))), 'the shell holds nothing focusable');
  for (const sel of ['.overlay', '.rw-ins[data-open="true"]', '.fpe', '.top', '.fpe-head.rw-head', 'body']) {
    assert.ok(rules.some(r => r.sel.split(',').map(s => s.trim()).includes(sel) && /var\(--keep-h/.test(r.body)), sel + ' starts below the badge');
  }
});

rule('App: the first time the examples are tab-only, a dialog explains it once, and Got it closes it', async () => {
  const session = {};
  const app = boot({ storageThrows: true, firstRun: true, sessionStore: session }); await app.tick(80);
  assert.ok(/role="dialog"[\s\S]*only while this tab is open[\s\S]*id="tab-only-ok"[^>]*>Got it</.test(app.overlay()), 'it explains, with Got it');
  app.click('close-overlay'); await app.tick();
  assert.strictEqual(app.overlay(), '', 'Got it closes it');
  app.click('setup-mode', 'examples'); await app.tick(); app.choose('person-casey'); await app.tick();
  for (const id of ['home', 'runs', 'types', 'settings']) { app.click('nav', id); await app.tick(); }
  app.click('open-run', app.run().key); await app.tick(40);
  assert.ok(!/id="tab-only-ok"/.test(app.overlay()), 'it doesn\'t come back while the tab is open');
  const again = boot({ storageThrows: true, firstRun: true, sessionStore: session }); await again.tick(80);
  assert.ok(!/id="tab-only-ok"/.test(again.overlay()) && BADGE.test(again.badge()), 'nor after a reload in the same session; the badge still shows');
});

rule('App: with storage blocked, no message is reworded: saves, notes and Undo say exactly what they say with storage', async () => {
  const story = async app => {
    const out = [];
    app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
    app.input('tf-label', 'Risk review'); await app.tick(40);
    app.click('type-save'); await app.tick(120); out.push(shown(app));
    app.click('type-done'); await app.tick();
    app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
    app.click('select', 'approve'); app.set('note-text', 'a note'); app.click('add-note', 'approve'); await app.tick(40);
    out.push(app.live(), (/<span class="small rw-ack"[^>]*>(?:<span class="ic"[\s\S]*?<\/span>)?([^<]*)</.exec(app.html()) || [])[1]);
    app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
    app.click('ob-sel', 'flags'); await app.tick();
    app.check('ob-mark-step', true); await app.tick(80); out.push(shown(app));
    app.check('ob-mark-must', true); await app.tick(80); out.push(shown(app));
    return out;
  };
  const normal = boot(); await normal.tick(60); normal.choose('person-casey'); await normal.tick();
  const want = await story(normal), got = await story(await blocked());
  assert.ok(want.every(Boolean) && /^Saved \{risk\.review\}/.test(want[0]) && /Note added/.test(want[1]), 'set-up: each step says something: ' + JSON.stringify(want));
  assert.deepStrictEqual(got, want);
  assert.ok(!got.some(t => /tab only/i.test(t)), 'none of them mention the tab');
});

rule('App: the run strip and both editors say Saved in this tab only while storage is blocked, and Saved with it', async () => {
  const labels = async app => {
    app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
    app.input('tf-label', 'Risk review'); await app.tick(40); app.click('type-save'); await app.tick(120);
    const type = (/class="fpe-state[^"]*"[^>]*>(?:<span class="ic"[\s\S]*?<\/span>)?([^<]*)</.exec(app.html()) || [])[1];
    app.click('type-done'); await app.tick();
    app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
    const strip = (/id="fresh" data-k="strip"><span class="small">([^<·]*?) \d+:\d\d/.exec(app.html()) || [])[1];
    app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
    app.click('ed-mode', 'markdown'); await app.tick();
    app.input('draft-editor', app.el('draft-editor').value + '\n'); await app.tick(40);
    app.click('save-draft', 'release'); await app.tick(80);
    const draft = (/class="fpe-state[^"]*"[^>]*>(?:<span class="ic"[\s\S]*?<\/span>)?([^<]*)</.exec(app.html()) || [])[1];
    return { type, strip, draft };
  };
  assert.deepStrictEqual(await labels(await blocked()), { type: 'Saved in this tab only', strip: 'Saved in this tab only', draft: 'Saved in this tab only' });
  const normal = boot(); await normal.tick(60); normal.choose('person-casey'); await normal.tick();
  assert.deepStrictEqual(await labels(normal), { type: 'Saved', strip: 'Saved here', draft: 'Saved' });
});

rule('App: with storage working, there is no badge, no explanation and no room left for them', async () => {
  const app = boot({ firstRun: true }); await app.tick(80);
  assert.strictEqual(app.badge(), '', 'no badge on the welcome');
  assert.ok(!/id="tab-only-ok"/.test(app.overlay()), 'no explanation');
  app.click('setup-mode', 'examples'); await app.tick(); app.choose('person-casey'); await app.tick();
  for (const id of ['home', 'types']) { app.click('nav', id); await app.tick(); assert.strictEqual(app.badge(), '', id); }
  app.click('open-run', app.run().key); await app.tick(); app.setNarrow(true); await app.tick(); app.click('select', 'approve'); await app.tick();
  assert.strictEqual(app.badge(), '', 'phone step sheet');
  assert.ok(!app.rootClasses().includes('tab-only'), 'and the page leaves no room for it');
});

rule('App: Undo and Redo keep what\'s typed in an open Add a step box, and refuse when the step it goes after would disappear', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', PF = app.PF;
  app.click('ob-move', 'flags', { dir: 'up' }); await app.tick();
  app.click('ob-add-after', 'rollback'); await app.tick();
  app.set('ob-new-text', 'Check the dashboards');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/id="ob-new-text"/.test(app.html()) && app.draft('ob-new-text') === 'Check the dashboards', 'the box and its text stay through Undo');
  app.click('tl-redo', 'draft'); await app.tick();
  assert.ok(/id="ob-new-text"/.test(app.html()) && app.draft('ob-new-text') === 'Check the dashboards', 'and through Redo');
  app.click('ob-add-go'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.deepStrictEqual(idsOf(PF, app.fs.files[path].t).slice(0, 5), ['approved', 'flags', 'tests', 'rollback', 'check-the-dashboards'], 'added where it was asked for');
  // The new step's own Add-after box: undoing the add would take away where it goes.
  app.click('ob-add-after', 'check-the-dashboards'); await app.tick();
  app.set('ob-new-text', 'Watch the error rate');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/data-ob-step="check-the-dashboards"/.test(app.html()), 'nothing undone');
  assert.ok(/Add or cancel the new step you&#39;re writing first/.test(app.html()) || /Add or cancel the new step you're writing first/.test(app.html()), 'it says why');
  assert.strictEqual(app.draft('ob-new-text'), 'Watch the error rate', 'and the text is still there');
});

rule('App: while a save of the draft is still finishing, a refresh never replaces an Undo made meanwhile', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t, write = app.fs.write.bind(app.fs), g = gate();
  app.click('ob-del', 'rollback'); await app.tick();
  // The save writes, then waits before it's done.
  app.fs.write = (p, t) => p === path ? write(p, t).then(() => g.p) : write(p, t);
  app.click('save-draft'); await app.tick(5);
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/data-ob-step="rollback"/.test(app.html()), 'set-up: Rollback back');
  app.focus(); await app.tick(80);
  assert.ok(/data-ob-step="rollback"/.test(app.html()), 'the refresh leaves the Undo alone');
  g.open(); await app.tick(80); app.fs.write = write;
  app.focus(); await app.tick(80);
  assert.ok(/data-ob-step="rollback"/.test(app.html()) && /Unsaved: Save draft before you publish/.test(app.html()), 'after the save lands, the Undo is still there, unsaved');
  assert.ok(!/data-act="tl-redo" data-id="draft" aria-disabled/.test(app.html()), 'and Redo still can put the deletion back');
  app.click('save-draft'); await app.tick(80);
  assert.strictEqual(app.fs.files[path].t, original);
});

rule('App: the step-type editor makes the ID and names from labels, moves rows, edits tags and options with Undo, and asks before leaving unsaved changes', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  assert.ok(/id="tf-save-why">Add a label to save\./.test(app.html()) && !/type="submit"[^>]*disabled/.test(app.html()), 'Save says what\'s missing, and isn\'t disabled');
  app.input('tf-label', 'Change board approval'); await settle(app);
  assert.ok(/<code class="tf-idtok[^"]*">\{change\.board\.approval\}<\/code><button type="button" class="linkish" data-act="tf-id-edit"/.test(app.html()), 'the ID comes from the label, with Change');
  app.click('tf-add', 'f', { kind: 'url' }); await app.tick();
  const ka = /data-act="tf-open" data-id="f:(k\d+)"/.exec(app.html())[1];
  app.input('tf-f-' + ka + '-label', 'Ticket link'); await settle(app);
  app.click('tf-add', 'f'); await app.tick();
  const kb = [...app.html().matchAll(/data-act="tf-open" data-id="f:(k\d+)"/g)][1][1];
  app.input('tf-f-' + kb + '-label', 'Window'); await settle(app);
  app.click('tf-move', 'f:' + kb, { dir: 'up' }); await app.tick();
  const order = () => [...app.html().matchAll(/<span class="tf-item-sub"><code>([\w-]+)<\/code>/g)].map(m => m[1]);
  assert.deepStrictEqual(order(), ['window', 'ticket-link'], 'moved up');
  assert.ok(new RegExp('<li class="tf-item[^"]* flash" data-tf-row="f:' + kb + '"').test(app.html()), 'the moved row glows');
  assert.ok(/  window: …\n  ticket-link: https:\/\/…/.test(app.html()), 'the checklist preview follows');
  app.click('tl-undo', 'type'); await app.tick();
  assert.deepStrictEqual(order(), ['ticket-link', 'window'], 'and the move undoes');
  app.set('tf-tagadd', '#cab'); app.click('tf-tag-add'); await app.tick();
  assert.ok(/<li class="tf-chip">#cab<button type="button" data-act="tf-tag-del" data-id="cab" aria-label="Remove tag cab">/.test(app.html()), 'a tag chip');
  app.click('tl-undo', 'type'); await app.tick();
  assert.ok(!/tf-chip">#cab/.test(app.html()), 'undone');
  app.el('tf-icon-gear').checked = true; app.select('tf-icon-gear', 'gear'); await app.tick();
  assert.ok(/<input type="radio" name="tf-icon" id="tf-icon-gear" value="gear" checked/.test(app.html()), 'the icon is a radio grid');
  app.click('type-done'); await app.tick();
  assert.ok(/This step type has changes that aren.t saved/.test(app.html()) && /id="type-form"/.test(app.html()), 'Done asks first');
  app.click('type-stay'); await app.tick();
  app.click('type-save'); await app.tick(120);
  const def = JSON.parse(app.fs.files['step-types/change.board.approval.json'].t);
  assert.deepStrictEqual([Object.keys(def.fields), def.icon], [['ticket-link', 'window'], 'gear'], 'saved as shown');
});

rule('App: a step type keeps its Undo and History after it\'s saved and opened again', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  app.input('tf-id', 'risk.level'); app.input('tf-label', 'Risk level'); await settle(app);
  app.submit('type-form'); await app.tick(80);
  assert.ok(app.fs.files['step-types/risk.level.json'], 'set-up: saved');
  app.click('edit-type', 'risk.level'); await app.tick(40);
  assert.ok(/data-act="tl-undo" data-id="type" aria-keyshortcuts/.test(app.html()), 'Undo is there');
  app.click('tl-undo', 'type'); await app.tick();
  assert.ok(/<input id="tf-label"[^>]*value=""/.test(app.html()), 'and undoes the typing');
  app.click('hist-open', 'type'); await app.tick();
  assert.ok(/· saved/.test(app.overlay()), 'History says it was saved');
  app.key('Escape'); await app.tick();
  // Changed in the folder meanwhile: the older changes stay listed, behind a baseline.
  app.click('type-cancel'); await app.tick();
  const f = JSON.parse(app.fs.files['step-types/risk.level.json'].t); f.label = 'Theirs';
  await app.fs.write('step-types/risk.level.json', JSON.stringify(f, null, 2) + '\n');
  app.click('edit-type', 'risk.level'); await app.tick(40);
  assert.ok(/<input id="tf-label"[^>]*value="Theirs"/.test(app.html()) && /data-act="tl-undo" data-id="type" aria-disabled="true"/.test(app.html()), 'their version, nothing to undo over it');
  app.click('hist-open', 'type'); await app.tick();
  assert.ok(/The step type changed in the folder here/.test(app.overlay()));
});

rule('App: a step type opened again resumes its Undo only over the exact same file, never one sharing its FNV fingerprint (2.1.0)', async () => {
  const fnv = (h, x) => { for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  app.input('tf-id', 'risk.level'); app.input('tf-label', 'Risk level'); await settle(app);
  app.submit('type-form'); await app.tick(80);
  const path = 'step-types/risk.level.json', text = app.fs.files[path].t, key = '"label": "', at = text.indexOf(key) + key.length, end = text.indexOf('"', at);
  // Two labels whose files share an FNV-1a fingerprint (birthday search from the state after the shared prefix).
  const start = fnv(0x811c9dc5, text.slice(0, at)), seen = new Map(), abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let a = null, b = null, seed = 1;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
  for (let n = 0; !a && n < 4e6; n++) { let x = 'L'; for (let i = 0; i < 10; i++) x += abc[next() % 62]; const h = fnv(start, x); if (seen.has(h) && seen.get(h) !== x) { a = seen.get(h); b = x; } else seen.set(h, x); }
  assert.ok(a, 'set-up: found a collision');
  const ta = text.slice(0, at) + a + text.slice(end), tb = text.slice(0, at) + b + text.slice(end);
  assert.strictEqual(app.PF.util.hash(ta), app.PF.util.hash(tb), 'set-up: a collision');
  app.click('edit-type', 'risk.level'); await app.tick(40); app.click('type-cancel'); await app.tick();
  await app.fs.write(path, ta);
  app.click('edit-type', 'risk.level'); await app.tick(40);
  assert.ok(new RegExp('<input id="tf-label"[^>]*value="' + a + '"').test(app.html()), 'set-up: opened on A ' + a + ' ' + (app.html().match(/<input id="tf-label"[^>]*>/) || [''])[0]);
  app.input('tf-label', a + 'x'); await settle(app); app.click('tl-undo', 'type'); await app.tick();
  app.click('type-cancel'); await app.tick();
  await app.fs.write(path, tb);
  app.click('edit-type', 'risk.level'); await app.tick(40);
  assert.ok(new RegExp('<input id="tf-label"[^>]*value="' + b + '"').test(app.html()), 'the file as it is now, never the form kept from A: ' + (app.html().match(/<input id="tf-label"[^>]*>/) || [''])[0]);
});

rule('App: text moved by dragging in the Markdown is one Undo', async () => {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const t = mdOf(app), word = 'Production release', at = t.indexOf(word), cut = t.slice(0, at) + t.slice(at + word.length), moved = cut + word;
  app.input('draft-editor', cut, 'deleteByDrag'); app.input('draft-editor', moved, 'insertFromDrop'); await settle(app);
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(mdOf(app), t, 'one Undo puts it back where it was');
});

rule('App: typing with an input method is one Undo, and Cmd+Z while composing is left to the input method', async () => {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const t = mdOf(app), ta = app.el('draft-editor');
  app.fire('compositionstart', { target: ta });
  ['k', 'か', 'かn', 'かん', '缶'].forEach(x => app.input('draft-editor', t + x, 'insertCompositionText'));
  assert.ok(!cmdKey(app, 'z', { tagName: 'TEXTAREA', id: 'draft-editor', dataset: {}, closest: () => null }, { isComposing: true }), 'Cmd+Z while composing goes to the input method');
  app.fire('compositionend', { target: ta }); app.input('draft-editor', t + '缶'); await settle(app);
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(mdOf(app), t, 'one Undo takes back the whole composition');
  app.click('tl-redo', 'draft'); await app.tick();
  assert.strictEqual(mdOf(app), t + '缶');
});

rule('App: Tab and Shift+Tab stay inside History, and every dialog, wrapping at the ends', async () => {
  const app = await builderOn(), doc = app.doc;
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('hist-open', 'draft'); await app.tick();
  const btn = n => ({ id: n, dataset: {}, focus() { doc.activeElement = this; }, closest: () => null });
  const ctl = [btn('close'), btn('undo'), btn('redo')], ov = app.el('overlay');
  ov.querySelectorAll = () => ctl; ov.contains = el => ctl.includes(el);
  doc.activeElement = ctl[2];
  let taken = false; app.keyOn('Tab', { preventDefault() { taken = true; } }, ctl[2]);
  assert.ok(taken && doc.activeElement === ctl[0], 'Tab from the last control goes to the first');
  taken = false; app.keyOn('Tab', { shiftKey: true, preventDefault() { taken = true; } }, ctl[0]);
  assert.ok(taken && doc.activeElement === ctl[2], 'Shift+Tab from the first goes to the last');
  doc.activeElement = ctl[1]; taken = false; app.keyOn('Tab', { preventDefault() { taken = true; } }, ctl[1]);
  assert.ok(!taken && doc.activeElement === ctl[1], 'in between, Tab moves as usual');
});

/* The step-type editor on a new type, as Casey. */
async function newTypeOn() {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  return app;
}
const typeDef = app => JSON.parse(/<pre class="source">([\s\S]*?)<\/pre><\/details>/.exec(app.html())[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

rule('App: Undo in a saved step type never changes its ID, so saving it again goes to the same file', async () => {
  const app = await newTypeOn();
  app.input('tf-label', 'Risk'); await settle(app);
  app.fire('focusout', { target: app.el('tf-label') });
  app.input('tf-label', 'Risk level'); await settle(app);
  app.click('type-save'); await app.tick(120);
  assert.ok(app.fs.files['step-types/risk.level.json'], 'set-up: saved as risk.level');
  if (!/id="type-form"/.test(app.html())) { app.click('edit-type', 'risk.level'); await app.tick(40); }
  app.click('tl-undo', 'type'); await app.tick();
  const d = typeDef(app);
  assert.deepStrictEqual([d.id, d.label], ['risk.level', 'Risk'], 'the label goes back; the ID stays');
  app.el('tf-label').value = 'Risk';  // the box as the page draws it now
  app.click('type-save'); await app.tick(120);
  assert.ok(!/Someone else changed this step type/.test(app.html()) && !app.fs.files['step-types/risk.json'], 'no false conflict, no second file');
  assert.strictEqual(JSON.parse(app.fs.files['step-types/risk.level.json'].t).label, 'Risk');
});

rule('App: fast typing in a field\'s label keeps making its name, even before the page redraws', async () => {
  const app = await newTypeOn();
  app.click('tf-add', 'f'); await app.tick();
  const k = /data-act="tf-open" data-id="f:(k\d+)"/.exec(app.html())[1], nm = app.el('tf-f-' + k + '-name');
  nm.value = ''; nm.defaultValue = '';  // the Name box as last drawn: empty
  ['R', 'Ri', 'Risk'].forEach(v => app.input('tf-f-' + k + '-label', v));
  await settle(app);
  assert.ok(new RegExp('id="tf-f-' + k + '-name"[^>]*value="risk"').test(app.html()), 'named from the label');
});

rule('App: typing a step type\'s label quickly is one Undo, even though its ID changes with it', async () => {
  const app = await newTypeOn();
  ['R', 'Ri', 'Ris', 'Risk'].forEach(v => app.input('tf-label', v));
  await settle(app);
  app.click('tl-undo', 'type'); await app.tick();
  assert.deepStrictEqual([typeDef(app).label, typeDef(app).id], ['', ''], 'one Undo takes back the whole word');
});

rule('App: text moved by dragging in a step type\'s box is one Undo', async () => {
  const app = await newTypeOn();
  app.input('tf-hint', 'one two three'); await settle(app);
  app.fire('focusout', { target: app.el('tf-hint') });
  app.input('tf-hint', 'one three', 'deleteByDrag'); app.input('tf-hint', 'one three two', 'insertFromDrop'); await settle(app);
  app.click('tl-undo', 'type'); await app.tick();
  assert.strictEqual(typeDef(app).hint, 'one two three');
});

rule('App: a composition with an input method is its own Undo, apart from typing right before and after it, in both editors', async () => {
  const app = await newTypeOn(), hint = app.el('tf-hint');
  app.fire('compositionstart', { target: hint });
  ['k', 'か', '缶'].forEach(x => app.input('tf-hint', x, 'insertCompositionText'));
  app.fire('compositionend', { target: hint }); app.input('tf-hint', '缶');
  app.input('tf-hint', '缶a'); await settle(app);
  app.click('tl-undo', 'type'); await app.tick();
  assert.strictEqual(typeDef(app).hint, '缶', 'typing after it is separate');
  const md = boot({ localStore: { 'preflight:builder': 'false' } }); await md.tick(60); md.choose('person-casey'); await md.tick();
  md.click('open-process', 'release'); await md.tick(); md.click('ptab', 'edit'); await md.tick();
  const t = mdOf(md), ta = md.el('draft-editor');
  md.input('draft-editor', t + 'x');
  md.fire('compositionstart', { target: ta });
  md.input('draft-editor', t + 'x缶', 'insertCompositionText');
  md.fire('compositionend', { target: ta }); md.input('draft-editor', t + 'x缶'); await settle(md);
  md.click('tl-undo', 'draft'); await md.tick();
  assert.strictEqual(mdOf(md), t + 'x', 'typing before it is separate');
});

rule('App: a dialog\'s Tab trap skips controls that aren\'t shown', async () => {
  const app = await builderOn(), doc = app.doc;
  app.click('hist-open', 'draft'); await app.tick();
  const btn = (n, shown) => ({ id: n, dataset: {}, focus() { doc.activeElement = this; }, closest: () => null, getClientRects: () => (shown ? [{}] : []) });
  const ctl = [btn('close', true), btn('item', true), btn('hidden', false)], ov = app.el('overlay');
  ov.querySelectorAll = () => ctl; ov.contains = el => ctl.includes(el);
  doc.activeElement = ctl[1];
  let taken = false; app.keyOn('Tab', { preventDefault() { taken = true; } }, ctl[1]);
  assert.ok(taken && doc.activeElement === ctl[0], 'Tab from the last shown control wraps');
  taken = false; app.keyOn('Tab', { shiftKey: true, preventDefault() { taken = true; } }, ctl[0]);
  assert.ok(taken && doc.activeElement === ctl[1], 'Shift+Tab never lands on a hidden one');
});

rule('App: too many tags marks the Add a tag box invalid, and Move at the top focuses the row, not a disabled button', async () => {
  const app = await newTypeOn();
  app.input('tf-label', 'Risk'); await settle(app);
  for (let i = 0; i < 11; i++) { app.set('tf-tagadd', 't' + i); app.click('tf-tag-add'); await app.tick(); }
  app.click('type-save'); await app.tick(40);
  assert.ok(/<input id="tf-tagadd"[^>]*aria-invalid="true"[^>]*aria-describedby="tf-err-\d+/.test(app.html()), 'the box points at the error');
  app.click('tf-add', 'f'); await app.tick(); app.click('tf-add', 'f'); await app.tick();
  const k2 = [...app.html().matchAll(/data-act="tf-open" data-id="f:(k\d+)"/g)][1][1];
  app.click('tf-move', 'f:' + k2, { dir: 'up' }); await app.tick();
  const last = app.asked().filter(q => /tf-move|tf-open/.test(q)).pop();
  assert.ok(/data-act="tf-open"/.test(last), 'focus goes to the row: ' + last);
});

rule('App: adding blank fields and evidence, then undoing each, works every time, and a new field\'s label typed quickly is one Undo', async () => {
  const app = await newTypeOn();
  app.click('tf-add', 'f'); await app.tick(); app.click('tf-add', 'r'); await app.tick(); app.click('tf-add', 'f'); await app.tick();
  // The page reads every box, checkboxes included, as it does before any change.
  [...app.html().matchAll(/id="(tf-[fr]-k\d+-(?:required|long))"/g)].forEach(m => { app.el(m[1]).checked = false; });
  app.input('tf-hint', 'x'); await settle(app);
  for (let i = 0; i < 4; i++) { app.click('tl-undo', 'type'); await app.tick(); assert.ok(!/It changed since/.test(app.html()), 'Undo ' + (i + 1) + ' worked'); }
  assert.ok(!/data-act="tf-open"/.test(app.html()), 'all three rows undone');
  app.click('tf-add', 'f'); await app.tick();
  const k = /data-act="tf-open" data-id="f:(k\d+)"/.exec(app.html())[1];
  app.el('tf-f-' + k + '-required').checked = false;
  ['R', 'Ri', 'Ris', 'Risk'].forEach(v => app.input('tf-f-' + k + '-label', v));
  await settle(app);
  app.click('tl-undo', 'type'); await app.tick();
  assert.ok(new RegExp('data-act="tf-open" data-id="f:' + k + '"[^>]*><span class="tf-item-text"><span class="tf-item-t">New field<').test(app.html()), 'one Undo takes back the whole label');
});

rule('App: after saving a type under an ID typed by hand, Undo still reaches the earlier changes', async () => {
  const app = await newTypeOn();
  app.input('tf-label', 'Risk'); await settle(app);
  app.fire('focusout', { target: app.el('tf-label') });
  app.click('tf-id-edit'); await app.tick();
  app.input('tf-id', 'custom.risk'); await settle(app);
  app.click('type-save'); await app.tick(120);
  assert.ok(app.fs.files['step-types/custom.risk.json'], 'set-up: saved under the typed ID');
  app.click('tl-undo', 'type'); await app.tick();
  app.click('tl-undo', 'type'); await app.tick();
  assert.ok(!/It changed since/.test(app.html()), 'no refusal');
  assert.deepStrictEqual([typeDef(app).id, typeDef(app).label], ['custom.risk', ''], 'the label is undone; the saved ID stays');
});

rule('App: on a phone, the step-type Preview is a dialog: focus goes in, Tab stays in, Escape closes it and focus comes back', async () => {
  const app = boot({ narrow: true }); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  app.click('tf-preview'); await app.tick();
  const h = app.html();
  assert.ok(/<aside class="fpe-pane tf-preview open" id="tf-preview" role="dialog" aria-modal="true" aria-labelledby="tf-prev-h"/.test(h), 'a modal dialog');
  assert.ok(/<header class="fpe-head" role="region" aria-labelledby="tf-h" inert/.test(h) && /<section class="fpe-pane tf-formpane" aria-label="Step type" inert/.test(h), 'what\'s behind it can\'t be used');
  assert.ok(app.asked().includes('.tf-prevclose'), 'focus goes to Close');
  const doc = app.doc, btn = n => ({ id: n, dataset: {}, focus() { doc.activeElement = this; }, closest: () => null, getClientRects: () => [{}] });
  const ctl = [btn('close'), btn('last')], pv = app.el('tf-preview');
  pv.querySelectorAll = () => ctl; pv.contains = el => ctl.includes(el);
  doc.activeElement = ctl[1];
  let taken = false; app.keyOn('Tab', { preventDefault() { taken = true; } }, ctl[1]);
  assert.ok(taken && doc.activeElement === ctl[0], 'Tab wraps inside it');
  const before = app.asked().length;
  app.key('Escape'); await app.tick();
  assert.ok(!/tf-preview open/.test(app.html()) && !/aria-labelledby="tf-h" inert/.test(app.html()), 'Escape closes it');
  assert.ok(app.asked().slice(before).includes('.tf-prevbtn'), 'focus comes back to Preview');
});

rule('App: an ID typed letter by letter and saved stays fixed while Undo goes all the way back and Redo all the way forward', async () => {
  const app = await newTypeOn();
  app.input('tf-label', 'Risk'); await settle(app);
  app.fire('focusout', { target: app.el('tf-label') });
  app.click('tf-id-edit'); await app.tick();
  let id = ''; for (const ch of 'custom.risk') { id += ch; app.input('tf-id', id); }
  await settle(app);
  app.fire('focusout', { target: app.el('tf-id') });
  app.input('tf-id', 'custom.risk2'); await settle(app);
  app.click('type-save'); await app.tick(120);
  assert.ok(app.fs.files['step-types/custom.risk2.json'], 'set-up: saved');
  let n = 0;
  while (!/data-act="tl-undo" data-id="type" aria-disabled="true"/.test(app.html()) && n < 10) {
    app.click('tl-undo', 'type'); await app.tick(); n++;
    assert.ok(!/It changed since/.test(app.html()), 'Undo ' + n + ' applied');
    assert.strictEqual(typeDef(app).id, 'custom.risk2', 'the ID stays fixed');
  }
  assert.strictEqual(typeDef(app).label, '', 'back at the start');
  for (let i = 0; i < n; i++) {
    app.click('tl-redo', 'type'); await app.tick();
    assert.ok(!/It changed since/.test(app.html()), 'Redo ' + (i + 1) + ' applied');
    assert.strictEqual(typeDef(app).id, 'custom.risk2');
  }
  assert.strictEqual(typeDef(app).label, 'Risk', 'back at the end');
});

rule('App: widening the screen while the phone Preview is open closes it, so the editor never stays locked', async () => {
  const opts = { narrow: true }, app = boot(opts); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  app.click('tf-preview'); await app.tick();
  assert.ok(/role="dialog" aria-modal="true"/.test(app.html()), 'set-up: open');
  opts.narrow = false;
  app.input('tf-label', 'R'); await settle(app);
  assert.ok(!/aria-modal="true"/.test(app.html()) && !/ inert/.test(app.html()), 'the next redraw draws the editor usable');
});

rule('App: an ID entered with spaces around it is saved trimmed, and Undo still applies, pasted or typed', async () => {
  for (const how of ['paste', 'type']) {
    const app = await newTypeOn();
    app.input('tf-label', 'Risk'); await settle(app);
    app.fire('focusout', { target: app.el('tf-label') });
    app.click('tf-id-edit'); await app.tick();
    if (how === 'paste') app.input('tf-id', ' custom.risk ', 'insertFromPaste');
    else { let id = ''; for (const ch of ' custom.risk ') { id += ch; app.input('tf-id', id); } }
    await settle(app);
    app.click('type-save'); await app.tick(120);
    assert.ok(app.fs.files['step-types/custom.risk.json'], how + ': saved trimmed');
    app.click('tl-undo', 'type'); await app.tick();
    assert.ok(!/It changed since/.test(app.html()), how + ': Undo applied');
    app.click('tl-undo', 'type'); await app.tick();
    assert.ok(!/It changed since/.test(app.html()), how + ': and the one before');
    assert.deepStrictEqual([typeDef(app).id, typeDef(app).label], ['custom.risk', ''], how + ': back to the start, ID fixed');
    app.click('tl-redo', 'type'); await app.tick(); app.click('tl-redo', 'type'); await app.tick();
    assert.ok(!/It changed since/.test(app.html()) && typeDef(app).label === 'Risk', how + ': Redo too');
  }
});

rule('App: a type just saved with a padded ID or label isn\'t unsaved: Done leaves, and reopening keeps its Undo', async () => {
  for (const how of ['paste', 'type']) {
    const app = await newTypeOn();
    app.input('tf-label', ' Risk '); await settle(app);
    app.fire('focusout', { target: app.el('tf-label') });
    app.click('tf-id-edit'); await app.tick();
    if (how === 'paste') app.input('tf-id', ' custom.risk ', 'insertFromPaste');
    else { let id = ''; for (const ch of ' custom.risk ') { id += ch; app.input('tf-id', id); } }
    app.input('tf-hint', ' For the board '); await settle(app);
    app.click('type-save'); await app.tick(120);
    assert.ok(app.fs.files['step-types/custom.risk.json'] && /class="fpe-state just"/.test(app.html()), how + ': saved, and says so');
    app.click('type-done'); await app.tick();
    assert.ok(!/changes that aren.t saved/.test(app.html()) && !/id="type-form"/.test(app.html()), how + ': Done leaves without asking');
    app.click('edit-type', 'custom.risk'); await app.tick(40);
    assert.ok(/role="status"><span class="ic"[\s\S]*?<\/span>Saved</.test(app.html()), how + ': reopened as saved');
    app.click('tl-undo', 'type'); await app.tick();
    assert.ok(!/can.t be undone/.test(app.html()) && !/It changed since/.test(app.html()), how + ': Undo still works');
  }
});

rule('App: the checklist panel\'s Checklist | Flight plan | Markdown choice is remembered while moving around', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  app.click('flight', 'md'); await app.tick();
  assert.ok(/data-act="flight" data-id="md" aria-pressed="true">Markdown/.test(app.html()) && /id="map-source"/.test(app.html()), 'Markdown shown, and pressed');
  app.click('nav', 'runs'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  assert.ok(/data-act="flight" data-id="md" aria-pressed="true"/.test(app.html()), 'still Markdown on coming back');
  app.click('flight', 'list'); await app.tick();
  assert.ok(/data-act="flight" data-id="list" aria-pressed="true"/.test(app.html()) && !/id="map-source"/.test(app.html()), 'back to the checklist');
});

rule('App: a value the builder refuses shows why next to its box, marked invalid for screen readers', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'flags'); await app.tick();
  app.set('ob-text', 'Ask @qa'); app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'ob-text', value: 'Ask @qa', dataset: { enter: 'ob-commit' }, closest: () => null }); await app.tick();
  assert.ok(/<textarea id="ob-text"[^>]* aria-invalid="true" aria-describedby="ferr-ob-text">/.test(app.html()), 'the box is marked');
  assert.ok(/<p class="ferr" id="ferr-ob-text" role="alert">Choose roles and run details with their buttons/.test(app.html()), 'the reason is next to it');
  /* Selecting another step waits for the refused text, so it isn't dropped (1.22.0); cleared, the mark goes with it. */
  app.click('ob-sel', 'rollback'); await app.tick();
  assert.ok(/then choose another/.test(app.live()) && /aria-invalid="true"/.test(app.html()), 'the refused text holds the selection');
  app.input('ob-text', 'Feature flags set in the deploy values'); await app.tick();
  app.click('ob-sel', 'rollback'); await app.tick();
  assert.ok(!/aria-invalid="true"/.test(app.html()), 'gone once another step is selected');
});

rule('App: a builder edit saved over someone else\'s change is stopped like any other; keep mine saves the builder\'s text', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  const path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-sel', 'pods'); await app.tick();
  app.check('ob-mark-step', true); await app.tick();
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
  assert.ok(!/Fixed once saved/.test(app.html()) && /<input id="tf-id"[^>]*value="risk.later"/.test(app.html()), 'still a new type, ID editable');
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
  app.input('tf-group', 'Releases / Approvals'); await app.tick(300);
  app.set('tf-tagadd', 'cab'); app.click('tf-tag-add'); await app.tick();
  app.set('tf-tagadd', '#prod'); app.click('tf-tag-add'); await app.tick();
  app.submit('type-form'); await app.tick(120);
  app.click('type-done'); await app.tick();
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
  app.set('tf-id', 'risk.call'); app.set('tf-label', 'Risk call'); app.set('tf-hint', 'A go or no-go call'); app.el('tf-icon-fork').checked = true;
  app.click('tf-add', 'f', { kind: 'choice' }); await app.tick();
  const fk = /id="tf-f-(k\d+)-name"/.exec(app.html())[1];
  app.set('tf-f-' + fk + '-label', 'Level');
  app.set('tf-f-' + fk + '-optadd', 'Low, with review'); app.click('tf-opt-add', 'f:' + fk); await app.tick();
  app.set('tf-f-' + fk + '-optadd', 'High'); app.click('tf-opt-add', 'f:' + fk); await app.tick();
  app.click('tf-add', 'r'); await app.tick();
  const rk = /id="tf-r-(k\d+)-name"/.exec(app.html())[1];
  app.set('tf-r-' + rk + '-name', 'call'); app.set('tf-r-' + rk + '-label', 'Call'); app.set('tf-r-' + rk + '-kind', 'text');
  app.submit('type-form'); await app.tick(120);
  const f = app.fs.files['step-types/risk.call.json'];
  assert.ok(f, 'saved');
  const def = JSON.parse(f.t);
  assert.deepStrictEqual([def.fields.level.options, def.record[0].name, def.icon], [['Low, with review', 'High'], 'call', 'fork'], 'options keep their commas; the name comes from the label');
  assert.ok(/class="fpe-state just" role="status"><span class="ic"[\s\S]*?<\/span>Saved<\/span>/.test(app.html()), 'Saved, with a check, and you stay in the editor');
  app.click('type-done'); await app.tick();
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
  app.change('note-file', [png('pods.png')]); await app.tick();
  assert.ok(/aria-label="Waiting to attach"><li class="att">.*pods\.png/.test(app.html()), 'set-up: an attachment waits on the second step');
  g.open(); await app.tick(40);
  app.PF.repo.addNote = orig;
  assert.ok(/aria-label="Waiting to attach"><li class="att">.*pods\.png/.test(app.html()), 'the second step\'s attachment survives the first note finishing');
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
  app.change('note-file', [png()]); await app.tick();
  assert.ok(/Add note with 1 file/.test(app.html()), 'set-up: the screenshot waits on the first step');
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
  assert.ok(/<h1[^>]*>Plan a run<\/h1>/.test(app.html()) && /type="datetime-local" id="plan-when"/.test(app.html()));
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
  assert.ok(/Planned Release 2026\.11\.06\./.test(app.html()) && /<h1[^>]*>Runs<\/h1>/.test(app.html()), 'goes to Runs and says so');
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
  assert.ok(/<h1[^>]*>Plan a run<\/h1>/.test(app.html()) && /id="detail-ticket"[^>]*value="ABC-4722"/.test(app.html()) && !/id="detail-tag"/.test(app.html()));
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

rule('Plans: a decision on the plan that can\'t be read holds it: the form says so and nothing starts (2.1.0)', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const torn = 'proposals/plan-release-2026-10-24.status-w-other.json';
  app.fs.files[torn] = { t: '{"kind": "status", "proposal": "plan-rel', m: Date.now() };
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  assert.ok(/isn(&#39;|')t known whether someone already started it/.test(app.html()) && app.html().indexOf(torn) >= 0, (app.html().match(/class="notice[^"]*"[^>]*>[\s\S]{0,300}/g) || []).join(' | '));
  const before = releaseRuns(app);
  app.submitForm('start-form'); await app.tick(120);
  assert.deepStrictEqual(releaseRuns(app), before, 'nothing started');
  assert.ok(!app.files('proposals/').some(f => /\.status-/.test(f) && f !== torn), 'no decision written');
});

rule('Plans: while proposals/ can\'t be read, a plan kept from before can\'t be started, declined or switched (2.1.0)', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const dec = 'proposals/plan-release-2026-10-24.status-w-other.json';
  app.fs.files[dec] = { t: JSON.stringify({ kind: 'status' }), m: Date.now() };
  const read = app.fs.read;
  app.fs.read = function (p) { return p === dec ? Promise.reject(new Error('locked')) : read.apply(this, arguments); };
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  assert.ok(/isn(&#39;|')t known whether someone already started it/.test(app.html()), (app.html().match(/class="notice[^"]*"[^>]*>[\s\S]{0,300}/g) || []).join(' | '));
  const before = releaseRuns(app), decs = app.files('proposals/').length;
  app.submitForm('start-form'); await app.tick(120);
  assert.deepStrictEqual(releaseRuns(app), before, 'nothing started');
  app.click('decline-plan', 'plan-release-2026-10-24'); await app.tick(120);
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  const eyebrow = () => (app.html().match(/<div class="eyebrow">[^<]*/) || [''])[0];
  const was = eyebrow();
  assert.ok(/ · v1/.test(was), 'set-up: on v1: ' + was);
  app.click('plan-latest', 'plan-release-2026-10-24'); await app.tick(120);
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  assert.strictEqual(eyebrow(), was, 'not switched');
  assert.ok(/data-act="plan-latest"/.test(app.html()), 'still asks');
  assert.strictEqual(app.files('proposals/').length, decs, 'no decision written');
});

rule('Plans: a decision listed but gone when read holds its plan: nothing starts (2.1.0)', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const dec = 'proposals/plan-release-2026-10-24.status-w-other.json';
  app.fs.files[dec] = { t: '{}', m: Date.now() };
  const read = app.fs.read;
  app.fs.read = function (p) { return p === dec ? Promise.resolve(null) : read.apply(this, arguments); };
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  const before = releaseRuns(app);
  app.submitForm('start-form'); await app.tick(120);
  assert.deepStrictEqual(releaseRuns(app), before, 'nothing started');
});

rule('Plans: a plan whose own file is listed but gone when read stays shown and held: nothing starts on another version (2.1.0)', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  const file = 'proposals/plan-release-2026-10-24.json', read = app.fs.read;
  assert.ok(app.fs.files[file], 'set-up: the plan\'s file');
  app.fs.read = function (p) { return p === file ? Promise.resolve(null) : read.apply(this, arguments); };
  app.click('refresh'); await app.tick(80);
  assert.ok(/can(&#39;|')t be read/.test(app.html()) && app.html().indexOf(file) >= 0, (app.html().match(/class="notice[^"]*"[^>]*>[\s\S]{0,300}/g) || []).join(' | '));
  const before = releaseRuns(app);
  app.submitForm('start-form'); await app.tick(120);
  assert.deepStrictEqual(releaseRuns(app), before, 'nothing started');
});

rule('Plans: when one of two differing copies of a started plan reads back as gone, the other copy is held: nothing starts (2.1.0)', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const file = 'proposals/plan-release-2026-10-24.json', copy = 'proposals/plan-release-2026-10-24 (1).json';
  const o = JSON.parse(app.fs.files[file].t); o.title = o.title + ' (edited)';
  app.fs.files[copy] = { t: JSON.stringify(o, null, 2), m: Date.now() };
  app.click('refresh'); await app.tick(80);
  const both = (await app.PF.repo.loadAll(app.fs)).plans.find(p => p.id === 'plan-release-2026-10-24');
  assert.ok(both && both._copiesDiffer, 'set-up: two differing copies');
  await app.PF.repo.recordPlanStatus(app.fs, Object.assign({}, both, { _hash: app.PF.util.hash(app.fs.files[file].t) }), 'w-other', 'accepted', 'run-elsewhere', 'person-avery', null, '2.1.0');
  app.click('refresh'); await app.tick(80);
  const read = app.fs.read;
  app.fs.read = function (p) { return p === file ? Promise.resolve(null) : read.apply(this, arguments); };
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  const before = releaseRuns(app), decs = app.files('proposals/').length;
  // 2.1.1: the copy left is decided on an earlier version, so its page has no form at all.
  if (/id="start-form"/.test(app.html())) { app.submitForm('start-form'); await app.tick(120); }
  assert.deepStrictEqual(releaseRuns(app), before, 'nothing started');
  app.click('decline-plan', 'plan-release-2026-10-24'); await app.tick(120);
  app.click('plan-latest', 'plan-release-2026-10-24'); await app.tick(120);
  assert.strictEqual(app.files('proposals/').length, decs, 'no decision written');
});

rule('Plans: two differing copies of a started plan, one gone when read, through two refreshes: the open form starts nothing (2.1.0)', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const file = 'proposals/plan-release-2026-10-24.json', copy = 'proposals/plan-release-2026-10-24 (1).json';
  const o = JSON.parse(app.fs.files[file].t); o.title = o.title + ' (edited)';
  app.fs.files[copy] = { t: JSON.stringify(o, null, 2), m: Date.now() };
  app.click('refresh'); await app.tick(80);
  const both = (await app.PF.repo.loadAll(app.fs)).plans.find(p => p.id === 'plan-release-2026-10-24' && p._file === 'plan-release-2026-10-24.json');
  await app.PF.repo.recordPlanStatus(app.fs, both, 'w-other', 'accepted', 'run-elsewhere', 'person-avery', null, '2.1.0');
  const read = app.fs.read;
  app.fs.read = function (p) { return p === file ? Promise.resolve(null) : read.apply(this, arguments); };
  app.click('refresh'); await app.tick(80);
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  const before = releaseRuns(app), decs = app.files('proposals/').length;
  const form = /id="start-form"/.test(app.html());
  if (form) { app.submitForm('start-form'); await app.tick(120); }
  app.click('decline-plan', 'plan-release-2026-10-24'); await app.tick(120);
  assert.deepStrictEqual(releaseRuns(app), before, 'nothing started');
  assert.strictEqual(app.files('proposals/').length, decs, 'no decision written');
});

rule('Plans: a form left open after another window started or declined the plan starts nothing (2.1.0)', async () => {
  for (const status of ['accepted', 'declined']) {
    const app = boot(); await app.tick(60);
    app.choose('person-casey'); await app.tick();
    app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
    const d = await app.PF.repo.loadAll(app.fs), plan = d.plans.find(p => p.id === 'plan-release-2026-10-24');
    await app.PF.repo.recordPlanStatus(app.fs, plan, 'w-other', status, status === 'accepted' ? 'run-elsewhere' : null, 'person-avery', null, '2.1.0');
    app.click('refresh'); await app.tick(80);
    const before = releaseRuns(app), decs = app.files('proposals/').length;
    app.submitForm('start-form'); await app.tick(120);
    assert.deepStrictEqual(releaseRuns(app), before, status + ': nothing started');
    app.click('decline-plan', 'plan-release-2026-10-24'); await app.tick(120);
    assert.strictEqual(app.files('proposals/').length, decs, status + ': no decision written');
  }
});

rule('Plans: without cross-window locks, a decline clicked right after Start waits its turn: one decision is written, the start (2.1.0)', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  let writes = 0; const write = app.fs.write;
  app.fs.write = function (p) { if (/^proposals\/.*\.status-/.test(p)) writes++; return write.apply(this, arguments); };
  app.submitForm('start-form');
  app.click('decline-plan', 'plan-release-2026-10-24');
  await app.tick(200);
  assert.strictEqual(writes, 1, 'one decision write');
  const st = app.files('proposals/').filter(p => /status/.test(p)).map(p => JSON.parse(app.fs.files[p].t).status);
  assert.deepStrictEqual(st, ['accepted']);
});

/* ---------- 2.1.1: a planned run starts exactly once ---------- */
const PLAN = 'plan-release-2026-10-24';
const decisionsOn = (app, id) => app.files('proposals/' + (id || PLAN) + '.status-').map(p => Object.assign({ _path: p }, JSON.parse(app.fs.files[p].t)));
const runsAndPlans = app => app.files('runs/').concat(app.files('proposals/')).sort().map(p => p + '\u0000' + app.fs.files[p].t);
/* Start the example plan with its run.json write failing: 'lost' never lands, 'landed' lands and then says it failed.
   keepReceipt: removing the save receipt fails too, so it stays. Returns the run ID its decision names and the bytes tried. */
async function failedStart(app, how, opts) {
  const plan = (opts && opts.plan) || PLAN;
  app.choose('person-casey'); await app.tick();
  app.click('review-plan', plan); await app.tick();
  const write = app.fs.write, remove = app.fs.remove; let tried = null;
  app.fs.write = function (p, t) {
    if (/^runs\/release\/[^/]+\/run\.json$/.test(p)) { tried = t; return how === 'landed' ? write.apply(this, arguments).then(() => { throw new Error('OneDrive is offline'); }) : Promise.reject(new Error('OneDrive is offline')); }
    return write.apply(this, arguments);
  };
  if (opts && opts.keepReceipt) app.fs.remove = function (p) { return /\/candidate-/.test(p) ? Promise.reject(new Error('locked')) : remove.apply(this, arguments); };
  app.submitForm('start-form'); await app.tick(120);
  app.fs.write = write; app.fs.remove = remove;
  const dec = decisionsOn(app, plan);
  return { id: dec.length === 1 ? dec[0].run : null, tried, dec };
}
/* A second plan for the same process, a copy of the example plan under another ID. */
const PLAN_B = 'plan-release-2026-10-31';
async function addPlanB(app) {
  const o = JSON.parse(app.fs.files['proposals/' + PLAN + '.json'].t);
  await app.fs.write('proposals/' + PLAN_B + '.json', JSON.stringify(Object.assign(o, { id: PLAN_B, title: 'Release 2026.10.31' }), null, 2));
  app.click('refresh'); await app.tick(80);
}

rule('Plans (2.1.1): a start whose run doesn\'t save leaves one decision naming its run and no run, and the form never starts a second run', async () => {
  const app = boot(); await app.tick(60);
  const before = releaseRuns(app), dirs = () => new Set(app.files('runs/release/').map(p => p.split('/')[2])), had = dirs();
  const { id, dec } = await failedStart(app, 'lost');
  assert.strictEqual(dec.length, 1, 'one decision'); assert.strictEqual(dec[0].status, 'accepted');
  assert.ok(typeof id === 'string' && /^[a-z0-9-]{1,40}$/i.test(id), 'it names the run: ' + id);
  assert.deepStrictEqual(releaseRuns(app), before, 'no run');
  assert.ok(/marked started, but its run didn(&#39;|')t save/.test(app.html()), shown(app));
  assert.ok(/data-act="plan-resume"/.test(app.html()), 'Try again is offered');
  app.submitForm('start-form'); await app.tick(120);
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', PLAN); await app.tick();
  if (/id="start-form"/.test(app.html())) { app.submitForm('start-form'); await app.tick(120); }
  assert.strictEqual(decisionsOn(app).length, 1, 'still one decision');
  assert.deepStrictEqual(releaseRuns(app), before, 'no second run');
  assert.deepStrictEqual([...dirs()].filter(x => !had.has(x)), [], 'no file was ever written under another run ID');
});

rule('Plans (2.1.1): Try again saves exactly the run that was started, on its version, after a switch and a reload, with no second decision', async () => {
  const app = boot(); await app.tick(60);
  const { id, tried } = await failedStart(app, 'lost');
  app.click('plan-latest', PLAN); await app.tick();
  app.click('refresh'); await app.tick(80);
  const path = 'runs/release/' + id + '/run.json';
  assert.ok(!app.fs.files[path], 'set-up: no run yet');
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.ok(app.fs.files[path] && app.fs.files[path].t === tried, 'the exact bytes');
  const run = JSON.parse(tried);
  assert.strictEqual(run.version, 1); assert.strictEqual(run.folder, pubFolder(app, 1), 'the version it was started on, not the one switched to');
  assert.strictEqual(decisionsOn(app).length, 1, 'no second decision');
  assert.ok(/Run started/.test(app.html()), shown(app));
});

rule('Plans (2.1.1): Try again when the run\'s file is already there: the same bytes are success, other text is refused and never overwritten', async () => {
  let app = boot(); await app.tick(60);
  let { id, tried } = await failedStart(app, 'lost');
  const path = () => 'runs/release/' + id + '/run.json';
  await app.fs.write(path(), tried);
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.strictEqual(app.fs.files[path()].t, tried);
  assert.ok(/Run started/.test(app.html()), shown(app));
  assert.deepStrictEqual(app.files('runs/release/' + id + '/').filter(p => /conflict/.test(p)), [], 'no conflict copy');
  app = boot(); await app.tick(60);
  ({ id, tried } = await failedStart(app, 'lost'));
  const other = JSON.stringify(Object.assign(JSON.parse(tried), { title: 'Changed elsewhere' }), null, 2);
  await app.fs.write(path(), other);
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.strictEqual(app.fs.files[path()].t, other, 'never overwritten');
  assert.ok(/has changed since; open it from Runs/.test(app.html()), shown(app));
  assert.deepStrictEqual(app.files('runs/release/' + id + '/'), [path()], 'nothing else written');
});

rule('Plans (2.1.1): a run write that landed but said it failed: Try again finds the same bytes and succeeds, with no conflict copy', async () => {
  const app = boot(); await app.tick(60);
  const { id, tried } = await failedStart(app, 'landed');
  const path = 'runs/release/' + id + '/run.json';
  assert.strictEqual(app.fs.files[path].t, tried, 'set-up: it landed');
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.strictEqual(app.fs.files[path].t, tried);
  assert.deepStrictEqual(app.files('runs/release/' + id + '/').filter(p => /conflict/.test(p)), []);
  assert.ok(/Run started/.test(app.html()), shown(app));
});

rule('Plans (2.1.1): a run that landed, was worked on elsewhere and then lost its run.json is never recreated by Try again', async () => {
  const app = boot(); await app.tick(60);
  const { id } = await failedStart(app, 'landed');
  const dir = 'runs/release/' + id + '/';
  await app.fs.write(dir + 'notes-other.jsonl', JSON.stringify({ id: 'n1', at: '2026-10-23T10:00:00Z', by: 'person-avery', text: 'Started' }) + '\n');
  delete app.fs.files[dir + 'run.json'];
  const before = runsAndPlans(app);
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.deepStrictEqual(runsAndPlans(app), before, 'nothing written');
  assert.ok(/has files but no run\.json/.test(app.html()), shown(app));
});

rule('Plans (2.1.1): Try again allows only this window\'s own leftover save receipt, exactly as it wrote it', async () => {
  for (const extra of [null, 'another receipt', 'changed receipt']) {
    const app = boot(); await app.tick(60);
    const { id, tried } = await failedStart(app, 'lost', { keepReceipt: true });
    const dir = 'runs/release/' + id + '/', cands = app.files(dir).filter(p => /candidate-/.test(p));
    assert.strictEqual(cands.length, 1, 'set-up: the receipt stayed'); assert.strictEqual(app.fs.files[cands[0]].t, tried);
    if (extra === 'another receipt') await app.fs.write(dir + 'candidate-w-other-abcd1234.json', tried);
    if (extra === 'changed receipt') await app.fs.write(cands[0], tried.replace('"rev": 1', '"rev": 2'));
    app.click('plan-resume', PLAN); await app.tick(160);
    if (!extra) { assert.strictEqual((app.fs.files[dir + 'run.json'] || {}).t, tried, 'saved: ' + shown(app)); continue; }
    assert.ok(!app.fs.files[dir + 'run.json'], extra + ': refused');
    assert.ok(/has files but no run\.json/.test(app.html()), extra + ': ' + shown(app));
  }
});

rule('Plans (2.1.1): Try again refuses, and writes nothing, when the run\'s version became one this copy can\'t record on', async () => {
  const app = boot(); await app.tick(60);
  const { id } = await failedStart(app, 'lost');
  const rec = 'publications/release/' + pubFolder(app, 1) + '/publication.json', info = JSON.parse(app.fs.files[rec].t);
  await app.fs.write(rec, JSON.stringify(Object.assign(info, { format: 'preflight-publication/9', app: '9.0.0' })));
  const before = runsAndPlans(app);
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.deepStrictEqual(app.files('runs/release/' + id + '/'), []);
  assert.deepStrictEqual(runsAndPlans(app), before, 'nothing written');
  assert.ok(/read-only here, so nothing was saved/.test(app.html()), shown(app));
});

rule('Plans (2.1.1): a run folder holding only an attachment in a subfolder refuses Try again', async () => {
  const app = boot(); await app.tick(60);
  const { id } = await failedStart(app, 'lost');
  const dir = 'runs/release/' + id + '/';
  await app.fs.write(dir + 'images/x.png', 'png');
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.deepStrictEqual(app.files(dir), [dir + 'images/x.png']);
  assert.ok(/has files but no run\.json/.test(app.html()), shown(app));
});

rule('Plans (2.1.1): only the window that started it, for the same person, gets Try again; everyone else sees it started with its run missing', async () => {
  const files = {};
  const a = boot({ sharedFiles: files }); await a.tick(60);
  const { id } = await failedStart(a, 'lost');
  const dir = 'runs/release/' + id + '/';
  // Another window, or this one reloaded.
  const b = boot({ sharedFiles: files }); await b.tick(60);
  b.choose('person-casey'); await b.tick();
  b.click('review-plan', PLAN); await b.tick();
  assert.ok(!/data-act="plan-resume"/.test(b.html()), 'no Try again in another window');
  assert.ok(/its run isn(&#39;|')t in the folder/.test(b.html()), shown(b));
  b.click('plan-resume', PLAN); await b.tick(160);
  assert.deepStrictEqual(b.files(dir), []);
  b.click('health'); await b.tick(200);
  assert.ok(/its run isn(&#39;|')t in the folder/.test(b.html()) && b.html().includes(id), 'Folder health names it');
  // Another person in the first window.
  a.choose('person-avery'); await a.tick();
  assert.ok(!/data-act="plan-resume"/.test(a.html()), 'no Try again for another person');
  a.click('plan-resume', PLAN); await a.tick(160);
  assert.deepStrictEqual(a.files(dir), []);
});

rule('Plans (2.1.1): Try again waiting on a held lock writes nothing, and never says "Run started", when the person or the folder changes before it gets the lock', async () => {
  for (const which of ['plan', 'run']) for (const change of ['person', 'folder']) {
    const tag = which + ' lock, ' + change, L = locks(), app = boot({ locks: L }); await app.tick(60);
    const { id } = await failedStart(app, 'lost');
    const oldFs = app.fs, dir = 'runs/release/' + id + '/', mine = fs => Object.keys(fs.files).filter(p => p.indexOf(dir) === 0 || /^proposals\//.test(p)).sort().map(p => p + '\u0000' + fs.files[p].t);
    const had = mine(oldFs);
    assert.ok(/data-act="plan-resume"/.test(app.html()), tag + ': set-up, Try again offered');
    const g = gate(); L.request(which === 'plan' ? 'preflight:plan:' + PLAN : 'preflight:run:release/' + id, () => g.p);
    app.click('plan-resume', PLAN); await app.tick(40);
    assert.ok(!oldFs.files[dir + 'run.json'], tag + ': set-up, still waiting');
    if (change === 'folder') { app.click('reset-examples'); await app.tick(60); app.choose('person-casey'); await app.tick(); }
    else { app.choose('person-avery'); await app.tick(); }
    g.open(); await app.tick(200);
    if (change === 'folder') assert.ok(app.fs !== oldFs, tag + ': set-up, another folder');
    assert.deepStrictEqual(mine(oldFs), had, tag + ': nothing written in the first folder');
    assert.deepStrictEqual(app.files(dir), [], tag + ': nor in this one');
    assert.ok(!/Run started/.test(app.html() + app.live()), tag + ': ' + shown(app));
    assert.ok(!/data-act="plan-resume"/.test(app.html()), tag + ': no Try again now');
  }
});

rule('Plans (2.1.1): Try again waiting on a held lock stays canceled when the person changes and changes back before it gets the lock', async () => {
  for (const which of ['plan', 'run']) {
    const tag = which + ' lock', L = locks(), app = boot({ locks: L }); await app.tick(60);
    const { id } = await failedStart(app, 'lost');
    const dir = 'runs/release/' + id + '/', mine = fs => Object.keys(fs.files).filter(p => p.indexOf(dir) === 0 || /^proposals\//.test(p)).sort().map(p => p + '\u0000' + fs.files[p].t);
    const had = mine(app.fs);
    assert.ok(/data-act="plan-resume"/.test(app.html()), tag + ': set-up, Try again offered');
    const g = gate(); L.request(which === 'plan' ? 'preflight:plan:' + PLAN : 'preflight:run:release/' + id, () => g.p);
    app.click('plan-resume', PLAN); await app.tick(40);
    assert.ok(!app.fs.files[dir + 'run.json'], tag + ': set-up, still waiting');
    app.choose('person-avery'); await app.tick();
    app.choose('person-casey'); await app.tick();
    g.open(); await app.tick(200);
    assert.deepStrictEqual(mine(app.fs), had, tag + ': nothing written');
    assert.ok(!/Run started/.test(app.html() + app.live()), tag + ': ' + shown(app));
    assert.ok(!/data-act="plan-resume"/.test(app.html()), tag + ': no Try again now');
  }
});

rule('Plans (2.1.1): changing the person forgets Try again, so switching back to the person who started it doesn\'t bring it back', async () => {
  const app = boot(); await app.tick(60);
  const { id } = await failedStart(app, 'lost');
  assert.ok(/data-act="plan-resume"/.test(app.html()), 'set-up: Try again offered');
  app.choose('person-avery'); await app.tick();
  assert.ok(!/Try again/.test(app.html()), 'nothing says Try again to the new person: ' + shown(app));
  app.choose('person-casey'); await app.tick();
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', PLAN); await app.tick();
  assert.ok(!/data-act="plan-resume"/.test(app.html()), 'not offered again');
  assert.ok(/its run isn(&#39;|')t in the folder/.test(app.html()), shown(app));
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.deepStrictEqual(app.files('runs/release/' + id + '/'), [], 'nothing written');
});

rule('Plans (2.1.1): two plans whose runs didn\'t save each keep their own Try again, and each saves its own run', async () => {
  const app = boot(); await app.tick(60);
  await addPlanB(app);
  const a = await failedStart(app, 'lost');
  const b = await failedStart(app, 'lost', { plan: PLAN_B });
  assert.ok(a.id && b.id && a.id !== b.id, 'set-up: two reserved runs');
  const offered = () => (app.html().match(/data-act="plan-resume" data-id="([^"]+)"/g) || []).map(x => x.replace(/.*data-id="|"$/g, '')).sort();
  assert.deepStrictEqual(offered(), [PLAN, PLAN_B].sort(), 'both Try again offered: ' + shown(app));
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.strictEqual((app.fs.files['runs/release/' + a.id + '/run.json'] || {}).t, a.tried, 'A saved its exact bytes: ' + shown(app));
  app.click('home'); await app.tick();
  assert.deepStrictEqual(offered(), [PLAN_B], 'B still offered on Home: ' + shown(app));
  app.click('plan-resume', PLAN_B); await app.tick(160);
  assert.strictEqual((app.fs.files['runs/release/' + b.id + '/run.json'] || {}).t, b.tried, 'B saved its exact bytes: ' + shown(app));
  app.click('home'); await app.tick();
  assert.deepStrictEqual(offered(), [], 'nothing left to try');
  assert.strictEqual(decisionsOn(app).length, 1); assert.strictEqual(decisionsOn(app, PLAN_B).length, 1);
});

rule('Plans (2.1.1): the second plan\'s Try again works first, and the first plan\'s still works after it', async () => {
  const app = boot(); await app.tick(60);
  await addPlanB(app);
  const a = await failedStart(app, 'lost');
  const b = await failedStart(app, 'lost', { plan: PLAN_B });
  app.click('plan-resume', PLAN_B); await app.tick(160);
  assert.strictEqual((app.fs.files['runs/release/' + b.id + '/run.json'] || {}).t, b.tried, shown(app));
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.strictEqual((app.fs.files['runs/release/' + a.id + '/run.json'] || {}).t, a.tried, shown(app));
});

rule('Plans (2.1.1): changing the person forgets every plan\'s Try again, and switching back brings none back', async () => {
  const app = boot(); await app.tick(60);
  await addPlanB(app);
  const a = await failedStart(app, 'lost');
  const b = await failedStart(app, 'lost', { plan: PLAN_B });
  app.choose('person-avery'); await app.tick();
  assert.ok(!/data-act="plan-resume"/.test(app.html()), 'none offered to the new person');
  app.choose('person-casey'); await app.tick();
  assert.ok(!/data-act="plan-resume"/.test(app.html()), 'none offered again: ' + shown(app));
  app.click('plan-resume', PLAN); await app.tick(160);
  app.click('plan-resume', PLAN_B); await app.tick(160);
  assert.deepStrictEqual(app.files('runs/release/' + a.id + '/').concat(app.files('runs/release/' + b.id + '/')), [], 'nothing written');
});

rule('Plans (2.1.1): a plan waiting on Try again isn\'t started again, and its Try again survives the refusal', async () => {
  const app = boot(); await app.tick(60);
  const a = await failedStart(app, 'lost');
  app.click('review-plan', PLAN); await app.tick();
  if (/id="start-form"/.test(app.html())) { app.submitForm('start-form'); await app.tick(120); }
  assert.strictEqual(decisionsOn(app).length, 1, 'still one decision');
  assert.ok(/data-act="plan-resume" data-id="plan-release-2026-10-24"/.test(app.html()), 'Try again still offered: ' + shown(app));
  app.click('plan-resume', PLAN); await app.tick(160);
  assert.strictEqual((app.fs.files['runs/release/' + a.id + '/run.json'] || {}).t, a.tried, shown(app));
});

rule('Plans (2.1.1): with two plans waiting, a Try again canceled by a person change and change back stays canceled for both', async () => {
  const L = locks(), app = boot({ locks: L }); await app.tick(60);
  await addPlanB(app);
  const a = await failedStart(app, 'lost');
  const b = await failedStart(app, 'lost', { plan: PLAN_B });
  const g = gate(); L.request('preflight:plan:' + PLAN, () => g.p);
  app.click('plan-resume', PLAN); await app.tick(40);
  app.choose('person-avery'); await app.tick();
  app.choose('person-casey'); await app.tick();
  g.open(); await app.tick(200);
  assert.deepStrictEqual(app.files('runs/release/' + a.id + '/'), [], 'A: nothing written');
  assert.ok(!/Run started/.test(app.html() + app.live()), shown(app));
  app.click('plan-resume', PLAN_B); await app.tick(160);
  assert.deepStrictEqual(app.files('runs/release/' + b.id + '/'), [], 'B: nothing written');
});

rule('Plans (2.1.1): a started plan whose run never saved, edited afterwards, still names its missing run on the plan page and in Folder health', async () => {
  const app = boot(); await app.tick(60);
  const { id } = await failedStart(app, 'lost');
  const file = 'proposals/' + PLAN + '.json', o = JSON.parse(app.fs.files[file].t);
  await app.fs.write(file, JSON.stringify(Object.assign(o, { note: 'Edited after it was started' }), null, 2));
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', PLAN); await app.tick();
  assert.ok(/Decided on an earlier version of this plan/.test(app.html()), 'set-up: decided earlier: ' + shown(app));
  assert.ok(/its run isn(&#39;|')t in the folder/.test(app.html()) && app.html().includes(id), 'the plan page names the missing run: ' + shown(app));
  assert.ok(/make a new plan to run it again/.test(app.html()), 'with what to do');
  app.click('health'); await app.tick(200);
  assert.ok(/its run isn(&#39;|')t in the folder/.test(app.html()) && app.html().includes(id), 'Folder health names it');
});

rule('Plans (2.1.1): Try again writes nothing when its decision names another run, an empty one or one too long; a run ID with a slash is refused before any path is made', async () => {
  for (const bad of ['outer/inner', '', 'x'.repeat(41)]) {
    const app = boot(); await app.tick(60);
    const { dec } = await failedStart(app, 'lost');
    const d = JSON.parse(app.fs.files[dec[0]._path].t); d.run = bad;
    await app.fs.write(dec[0]._path, JSON.stringify(d, null, 2));
    const before = runsAndPlans(app);
    app.click('plan-resume', PLAN); await app.tick(160);
    assert.deepStrictEqual(runsAndPlans(app), before, JSON.stringify(bad) + ': nothing written');
  }
  const app = boot(); await app.tick(60);
  const before = runsAndPlans(app);
  for (const id of ['outer/inner', '', 'x'.repeat(41), '..']) {
    await assert.rejects(app.PF.repo.resumeStart(app.fs, PLAN, { process: 'release', id, path: 'runs/release/' + id + '/run.json', text: '{}', dec: 'proposals/' + PLAN + '.status-w-d.json' }, { me: 'person-casey' }), JSON.stringify(id));
  }
  assert.deepStrictEqual(runsAndPlans(app), before);
});

rule('Plans (2.1.1): a switch and then a start in one window keep both records; the start goes to <plan>.status-<window>-d.json', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  await exactPlan(app);
  const v2 = pubFolder(app, 2);
  app.click('review-plan', 'plan-release-exact'); await app.tick();
  app.click('plan-retarget', 'plan-release-exact', { folder: v2 }); await app.tick(120);
  app.submitForm('start-form'); await app.tick(120);
  const recs = decisionsOn(app, 'plan-release-exact');
  assert.deepStrictEqual(recs.map(r => r.status).sort(), ['accepted', 'retargeted']);
  assert.strictEqual(recs.find(r => r.status === 'retargeted').to.folder, v2, 'the switch is kept');
  assert.ok(/-d\.json$/.test(recs.find(r => r.status === 'accepted')._path) && !/-d\.json$/.test(recs.find(r => r.status === 'retargeted')._path), recs.map(r => r._path).join(', '));
});

rule('Plans (2.1.1): a plan declined and then edited stays declined, "Decided on an earlier version", with no way to start, decline or switch it', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('review-plan', PLAN); await app.tick();
  app.click('decline-plan', PLAN); await app.tick(120);
  const path = 'proposals/' + PLAN + '.json', o = JSON.parse(app.fs.files[path].t); o.note = 'Edited after it was declined';
  await app.fs.write(path, JSON.stringify(o, null, 2));
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', PLAN); await app.tick();
  const h = app.html();
  assert.ok(/Decided on an earlier version of this plan/.test(h) && /declined/.test(h), shown(app));
  assert.ok(!/id="start-form"/.test(h) && !/data-act="decline-plan"/.test(h) && !/data-act="plan-latest"/.test(h), 'no start, decline or switch');
  app.click('nav', 'runs'); await app.tick();
  assert.ok(/Decided on an earlier version of this plan/.test(app.html()), 'Runs says so too');
  const n = decisionsOn(app).length;
  app.click('decline-plan', PLAN); await app.tick(120);
  app.click('plan-latest', PLAN); await app.tick(60);
  assert.strictEqual(decisionsOn(app).length, n, 'nothing written');
});

rule('Plans (2.1.1): a start on one version of a plan and a decline on an edited one disagree, on the plan page too', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const page = () => app.PF.repo.loadAll(app.fs).then(d => d.plans.find(p => p.id === PLAN));
  await app.PF.repo.recordPlanStatus(app.fs, await page(), 'w-a', 'accepted', 'run-a', 'person-avery', null, '2.1.0');
  const path = 'proposals/' + PLAN + '.json', o = JSON.parse(app.fs.files[path].t); o.note = 'Edited';
  await app.fs.write(path, JSON.stringify(o, null, 2));
  await app.PF.repo.recordPlanStatus(app.fs, await page(), 'w-b', 'declined', null, 'person-blake', null, '2.1.0');
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', PLAN); await app.tick();
  assert.ok(/Two decisions on this plan disagree/.test(app.html()), shown(app));
});

rule('Runs (2.1.1): a note line that can\'t be read is named on the run page and in Folder health, the notes on either side show, and the warning goes once it reads', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const key = app.run().key, file = 'runs/' + key + '/notes-w-torn.jsonl';
  const note = (id, min, text) => JSON.stringify({ id, at: '2026-10-16T10:' + min + ':00Z', by: 'person-avery', text });
  await app.fs.write(file, note('t1', '01', 'Before the torn line') + '\n{"id": "t2", "at": "2026-10-16T1\n' + note('t3', '03', 'After the torn line') + '\n');
  app.click('refresh'); await app.tick(80);
  app.click('open-run', key); await app.tick(40);
  const warn = /A note in notes-w-torn\.jsonl \(line 2\) couldn(&#39;|')t be read\. It may still be arriving; if it stays, the note on that line is lost and the rest are shown\./;
  assert.ok(warn.test(app.html()), 'the run page names it');
  app.click('health'); await app.tick(200);
  assert.ok(warn.test(app.html()), 'Folder health names it');
  await app.fs.write(file, note('t1', '01', 'Before the torn line') + '\n' + note('t2', '02', 'The middle') + '\n' + note('t3', '03', 'After the torn line') + '\n');
  app.click('refresh'); await app.tick(80);
  app.click('open-run', key); await app.tick(40);
  assert.ok(!/notes-w-torn\.jsonl \(line/.test(app.html()), 'gone once the line reads');
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

/* ---------- Corrections ---------- */
const newNotes = (app, key) => app.files('runs/' + key + '/notes-').filter(p => !/example-session/.test(p)).map(p => app.fs.files[p].t.trim().split('\n').map(l => JSON.parse(l))).flat();

rule('App: anyone viewing a run can correct a step; it starts on the wording, goes in their own notes file with the version and step, and run.json is untouched', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-blake'); await app.tick();
  const { key, path } = app.run(), before = app.fs.files[path].t;
  app.click('open-run', key); await app.tick(20);
  app.click('corr-open', 'pods', { mode: 'correct' }); await app.tick();
  assert.ok(/<textarea id="corr-to"[^>]*>New pods stay up with no restarts<\/textarea>/.test(app.html()) && app.focused() === 'corr-to', 'the wording, filled in, with focus');
  assert.ok(/No wording changed\./.test(app.html()));
  app.input('corr-to', 'New pods stay up for 20 minutes with no restarts'); await app.tick();
  assert.ok(/<div class="corr-prev">[\s\S]*?<ins>[^<]*for 20 minutes[^<]*<\/ins>/.test(app.html()) && !/No wording changed\./.test(app.html()), 'the redline follows the typing');
  app.input('corr-why', 'The cache warms slowly'); app.click('corr-save', 'pods'); await app.tick(60);
  const n = newNotes(app, key).filter(x => x.kind === 'correction')[0];
  assert.ok(n, 'saved');
  assert.deepStrictEqual([n.by, n.version, n.target, n.change, n.from, n.why, n.step], ['person-blake', 1, { phase: 'deploy', step: 'pods' }, { op: 'wording', to: 'New pods stay up for 20 minutes with no restarts' }, 'New pods stay up with no restarts', 'The cache warms slowly', 'pods']);
  assert.ok(/^Correction to "New pods stay up with no restarts"\. Should say:/.test(n.text), 'with a summary older copies show');
  assert.strictEqual(app.fs.files[path].t, before, 'run.json untouched');
  assert.ok(!/id="corr-to"/.test(app.html()) && /Correction saved on this computer\. It doesn&#39;t answer the step\./.test(app.html() + app.live()) || /Correction saved on this computer/.test(app.live()), 'closed, and says it\'s saved here, nothing more');
  assert.ok(/<li class="corr" id="corr-[\w-]+" tabindex="-1">/.test(app.html()) && /<span class="pill open">Open<\/span>/.test(app.html()), 'shown with the step\'s corrections');
});

rule('App: Done differently needs what happened, takes the step\'s evidence like Done, and with Just this run writes no correction', async () => {
  const app = await recordingRelease();
  const { key } = app.run();
  app.click('select', 'jenkins'); await app.tick();
  app.click('corr-open', 'jenkins', { mode: 'differently' }); await app.tick();
  assert.strictEqual(app.focused(), 'corr-happened');
  app.click('corr-done', 'jenkins'); await app.tick(20);
  assert.ok(/id="ferr-corr" role="alert">Say what happened\./.test(app.html()), 'what happened is required');
  app.input('corr-happened', 'Started it from the console; the button was gone'); app.set('rec-build', ''); app.click('corr-done', 'jenkins'); await app.tick(20);
  assert.ok(/id="ferr-jenkins" role="alert">[^<]*is needed to check this step/.test(app.html()) && (app.run().json.steps.jenkins || {}).s !== 'done', 'required evidence still applies, said next to its box');
  app.set('rec-build', 'https://ci.example.com/job/web-app-deploy-prod/88/'); app.click('corr-done', 'jenkins'); await app.tick(60);
  const a = app.run().json.steps.jenkins;
  assert.deepStrictEqual([a.s, a.differently.note, a.values.build], ['done', 'Started it from the console; the button was gone', 'https://ci.example.com/job/web-app-deploy-prod/88/']);
  assert.strictEqual(newNotes(app, key).filter(x => x.kind === 'correction').length, 0, 'just this run: no correction');
  app.click('select', 'jenkins'); await app.tick();
  assert.ok(/<span class="badge b-diff">Done differently<\/span> · Casey Nguyen/.test(app.html()) && /<span class="pill waived">One-off<\/span>/.test(app.html()));
  app.click('select', 'flags'); await app.tick();
  assert.ok(!/data-mode="differently"/.test(app.html().slice(app.html().indexOf('<aside'))), 'not on a step in a passed phase');
});

rule('App: Done differently with Fix the checklist too writes the correction first, then answers; if the run can\'t be saved, the correction stands', async () => {
  const app = await recordingRelease();
  const { key } = app.run();
  app.click('select', 'approve'); await app.tick();
  app.click('corr-open', 'approve', { mode: 'differently' }); await app.tick();
  app.input('corr-happened', 'Approved from the phone app; the console was down');
  app.click('corr-scope', 'fix'); await app.tick();
  assert.ok(/Marks this step done differently and proposes a checklist correction\./.test(app.html()));
  app.input('corr-to', 'Approve the deploy in Jenkins or its phone app before it rolls back');
  const order = [], save = app.PF.repo.saveRun, add = app.PF.repo.addNote;
  app.PF.repo.addNote = function () { order.push('note'); return add.apply(this, arguments); };
  app.PF.repo.saveRun = function () { order.push('run'); return Promise.reject(new Error('OneDrive is offline')); };
  app.click('corr-done', 'approve'); await app.tick(80);
  app.PF.repo.saveRun = save; app.PF.repo.addNote = add;
  assert.deepStrictEqual(order.slice(0, 2), ['note', 'run'], 'the correction is written before the run');
  const n = newNotes(app, key).filter(x => x.kind === 'correction')[0];
  assert.deepStrictEqual([n.step, n.change.to, n.happened], ['approve', 'Approve the deploy in Jenkins or its phone app before it rolls back', 'Approved from the phone app; the console was down']);
  assert.ok(!(app.run().json.steps.approve || {}).differently, 'the run file wasn\'t changed');
  assert.ok(/Your last change isn&#39;t saved|Your last change isn't saved/.test(app.html()), 'the failed save is shown with Try again');
  app.click('retry-save'); await app.tick(60);
  assert.strictEqual(app.run().json.steps.approve.differently.note, 'Approved from the phone app; the console was down');
});

rule('App: on the process page anyone marks a correction applied, declines it with a reason, or reopens it; each decision is a new file, written once', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-morgan'); await app.tick();
  app.click('open-process', 'release'); await app.tick(20);
  assert.ok(/Corrections · 2 open/.test(app.html()) && /Suggested in 2 runs/.test(app.html()), 'the example\'s open ones, one suggested in two runs');
  const id = /data-act="corr-applied" data-id="([\w-]+)"/.exec(app.html())[1];
  const theirs = app.files('corrections/release/').map(p => [p, app.fs.files[p].t]);
  const mine = () => app.files('corrections/release/' + id + '.').filter(p => !/example-session/.test(p)).sort();
  app.click('corr-applied', id); await app.tick(60);
  let d = JSON.parse(app.fs.files[mine()[0]].t);
  assert.deepStrictEqual([d.kind, d.group, d.status, d.by, d.rev, d.members.length], ['correction-decision', id, 'applied', 'person-morgan', 1, 2]);
  assert.ok(/Corrections · 1 open/.test(app.html()) && /Marked as applied to the draft\./.test(app.html() + app.live()));
  app.click('corr-filter', 'all'); await app.tick();
  assert.ok(/<span class="pill ready">Applied to draft<\/span>/.test(app.html()), 'Applied to draft, never "Fixed in vN"');
  app.click('corr-reopen', id); await app.tick(60);
  app.click('pick', id, { kind: 'corr-decline' }); await app.tick();
  app.click('corr-decline', id); await app.tick(20);
  assert.ok(/id="ferr-corr-decline" role="alert">Why not\? The runs will show this\./.test(app.html()), 'a reason is required');
  app.set('pick-input', 'Ten minutes is enough with the new cache'); app.click('corr-decline', id); await app.tick(60);
  assert.strictEqual(mine().length, 3, 'one new file per decision');
  d = mine().map(p => JSON.parse(app.fs.files[p].t)).sort((x, y) => x.rev - y.rev);
  assert.deepStrictEqual(d.map(x => [x.status, x.rev]), [['applied', 1], ['open', 2], ['declined', 3]]);
  assert.ok(/\.1\.json$/.test(d[1].seen) && /Declined by Morgan [^:]+: Ten minutes is enough/.test(app.html()));
  theirs.forEach(([p, text]) => assert.strictEqual(app.fs.files[p].t, text, 'others\' decisions untouched'));
  assert.ok(!/fix-accept|suggestions\//.test(app.html()));
});

/* The release process page as Morgan, with the example's open corrections. */
async function releasePage(opts) {
  const app = boot(opts); await app.tick(80);
  app.choose('person-morgan'); await app.tick();
  app.click('open-process', 'release'); await app.tick(20);
  return app;
}
const podsGroup = app => /data-act="corr-review" data-id="([\w-]+)"/.exec(app.html())[1];
const decisions = (app, id) => app.files('corrections/release/' + id + '.').filter(p => !/example-session/.test(p)).map(p => JSON.parse(app.fs.files[p].t));

rule('App: Apply to draft compares three ways, saves the draft as one undoable change, then records the decision with its result', async () => {
  const app = await releasePage(), path = 'maps/drafts/release.md', before = app.fs.files[path].t, id = podsGroup(app);
  app.click('corr-review', id); await app.tick();
  const ov = app.overlay();
  assert.ok(/role="dialog"/.test(ov) && /From the run&#39;s v\d|From the run's v\d/.test(ov) && />Draft now</.test(ov) && />Proposed result</.test(ov), 'the three columns');
  assert.ok(/<ins>for 20 minutes </.test(ov) && /data-act="corr-apply"[^>]*>Apply to draft</.test(ov));
  app.click('corr-apply', id); await app.tick(100);
  const after = app.fs.files[path].t;
  assert.ok(/New pods stay up for 20 minutes with no restarts @backend \{#pods\}/.test(after));
  assert.strictEqual(after.split('\n').length, before.split('\n').length, 'only the step\'s line changed');
  const [d] = decisions(app, id);
  assert.deepStrictEqual([d.status, d.by, d.rev, typeof d.result.sig], ['applied', 'person-morgan', 1, 'string']);
  assert.ok(!app.overlay() && /Applied correction to &quot;New pods stay up with no restarts&quot;\. Saved to the draft\./.test(app.html()), app.html().slice(0, 0));
  assert.ok(/Corrections · 1 open/.test(app.html()));
  // One entry on the draft editor's timeline, named for what it did; Undo takes it back as an unsaved change in the editor.
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/Undid the applied correction to &quot;New pods stay up with no restarts&quot;\./.test(app.html()) && /Unsaved: Save draft before you publish/.test(app.html()), 'undone in the editor, not saved');
  assert.strictEqual(app.fs.files[path].t, after, 'Undo never writes by itself');
  app.click('save-draft'); await app.tick(80);
  assert.strictEqual(app.fs.files[path].t, before);
  app.click('ptab', 'overview'); await app.tick(40); app.click('corr-filter', 'all'); await app.tick();
  assert.ok(/Changed since applied/.test(app.html()), 'the applied group no longer matches the draft');
});

rule('App: applying is refused while this window has unsaved edits to the draft, and needs a person\'s edit when the step changed', async () => {
  const app = await releasePage({ localStore: { 'preflight:builder': 'false' } }), path = 'maps/drafts/release.md', id = podsGroup(app);
  app.click('ptab', 'edit'); await app.tick();
  const md = app.fs.files[path].t;
  app.input('draft-editor', md.replace('Rollback commit written', 'Rollback commit and steps written')); await app.tick(300);
  assert.ok(/Open corrections · 2/.test(app.html()) && /data-act="corr-goto-line" data-id="\d+">Go to line \d+</.test(app.html()), 'the Markdown lists open corrections with their lines');
  app.click('ptab', 'overview'); await app.tick();
  app.click('corr-review', id); await app.tick();
  assert.ok(/You have unsaved changes to this draft/.test(app.overlay()) && /data-act="corr-apply"[^>]*disabled/.test(app.overlay()));
  app.click('corr-apply', id); await app.tick(60);
  assert.strictEqual(app.fs.files[path].t, md, 'nothing written');
  assert.ok(/role="alert">You have unsaved changes to this draft\. Save or discard/.test(app.overlay()));
  app.click('close-overlay'); await app.tick();
  app.click('revert-draft', 'release'); await app.tick(40);
  // The step changed in the folder since the runs' version: Apply isn't offered; an edit of the result is.
  await app.fs.write(path, md.replace('  command: kubectl get pods -l app=web-app', '  command: kubectl get pods -l app=web-app -w'));
  app.click('refresh'); await app.tick(100);
  app.click('corr-review', id); await app.tick();
  assert.ok(/This step changed in the draft since the run/.test(app.overlay()) && !/data-act="corr-apply"/.test(app.overlay()) && /Edit proposed result/.test(app.overlay()) && /Already addressed/.test(app.overlay()));
  app.click('corr-apply', id); await app.tick(60);
  assert.ok(!/for 20 minutes/.test(app.fs.files[path].t), 'not applied without the person');
  app.click('corr-edit', id); await app.tick();
  app.input('ca-edit', 'New pods stay up for 25 minutes with no restarts');
  app.click('corr-apply', id, { how: 'edit' }); await app.tick(100);
  assert.ok(/New pods stay up for 25 minutes with no restarts @backend \{#pods\}/.test(app.fs.files[path].t) && /-w$/m.test(app.fs.files[path].t), 'their edit, on the draft as it is now');
  assert.strictEqual(decisions(app, id)[0].status, 'applied');
});

rule('App: Already addressed on a step that changed records no result and reads Addressed differently, never Published', async () => {
  const app = await releasePage(), path = 'maps/drafts/release.md', id = podsGroup(app), md = app.fs.files[path].t;
  await app.fs.write(path, md.replace('  command: kubectl get pods -l app=web-app', '  command: kubectl get pods -l app=web-app -w'));
  app.click('refresh'); await app.tick(100);
  app.click('corr-review', id); await app.tick();
  app.click('corr-addressed', id); await app.tick(80);
  const [d] = decisions(app, id);
  assert.deepStrictEqual([d.status, d.addressed, 'result' in d], ['applied', true, false]);
  app.click('corr-filter', 'all'); await app.tick();
  assert.ok(/<span class="pill ready">Addressed differently<\/span>/.test(app.html()) && /Marked as addressed differently by /.test(app.html()));
  assert.ok(!/corr-pub/.test(app.html()) || /Included in this version: 0 corrections\.<\/b><\/p>/.test(app.html()), 'not counted for publishing');
});

rule('App: if the decision can\'t be written after the draft is saved, the next look finds it in the draft and Link records it', async () => {
  const app = await releasePage(), path = 'maps/drafts/release.md', id = podsGroup(app);
  const orig = app.PF.repo.decideCorrection; let fails = 1;
  app.PF.repo.decideCorrection = function () { if (fails-- > 0) return Promise.reject(new Error('OneDrive is offline')); return orig.apply(this, arguments); };
  app.click('corr-review', id); await app.tick();
  app.click('corr-apply', id); await app.tick(100);
  assert.ok(/for 20 minutes/.test(app.fs.files[path].t), 'the draft has it');
  assert.ok(/marking it as applied didn&#39;t save: OneDrive is offline|marking it as applied didn't save: OneDrive is offline/.test(app.html()));
  assert.strictEqual(decisions(app, id).length, 0);
  app.click('corr-review', id); await app.tick();
  assert.ok(/This is already in the draft\./.test(app.overlay()) && /data-act="corr-link"[^>]*>Link this correction</.test(app.overlay()));
  app.click('corr-link', id); await app.tick(80);
  const [d] = decisions(app, id);
  assert.deepStrictEqual([d.status, !!d.result], ['applied', true]);
  assert.ok(/Linked: the draft already has this correction\./.test(app.html()) && !app.overlay());
  app.PF.repo.decideCorrection = orig;
});

rule('App: an edited missing step that was applied but whose decision failed is found on the next look, with Link', async () => {
  const app = await releasePage(), path = 'maps/drafts/release.md';
  const id = /data-act="corr-review" data-id="([\w-]+)"[^>]*>Review and apply</g; let m, ids = []; while ((m = id.exec(app.html()))) ids.push(m[1]);
  const add = ids[ids.length - 1];
  const orig = app.PF.repo.decideCorrection; let fails = 1;
  app.PF.repo.decideCorrection = function () { if (fails-- > 0) return Promise.reject(new Error('OneDrive is offline')); return orig.apply(this, arguments); };
  app.click('corr-review', add); await app.tick();
  assert.ok(/Missing step/.test(app.overlay()), 'set-up: the missing step');
  app.click('corr-edit', add); await app.tick();
  app.input('ca-edit', 'Check the error budget twice');
  app.click('corr-apply', add, { how: 'edit' }); await app.tick(100);
  assert.ok(/Check the error budget twice/.test(app.fs.files[path].t));
  app.click('corr-review', add); await app.tick();
  assert.ok(/This is already in the draft\./.test(app.overlay()) && /data-act="corr-link"/.test(app.overlay()) && !/data-act="corr-apply"/.test(app.overlay()), app.overlay().slice(0, 300));
  app.click('corr-link', add); await app.tick(80);
  assert.strictEqual(decisions(app, add)[0].status, 'applied');
  assert.strictEqual((app.fs.files[path].t.match(/error budget/g) || []).length, 1, 'never added twice');
  app.PF.repo.decideCorrection = orig;
});

rule('App: when the draft can\'t be saved, the applied correction is shown in the editor as unsaved, not hidden', async () => {
  const app = await releasePage(), id = podsGroup(app);
  const orig = app.PF.repo.applyCorrection;
  app.PF.repo.applyCorrection = () => Promise.reject(new Error('OneDrive is offline'));
  app.click('corr-review', id); await app.tick();
  app.click('corr-apply', id); await app.tick(80);
  app.PF.repo.applyCorrection = orig;
  assert.ok(/class="fpe" id="fpe"/.test(app.html()) && /Unsaved: Save draft before you publish/.test(app.html()), 'the editor is open with the unsaved change');
  assert.ok(/Couldn&#39;t save the draft|Couldn't save the draft/.test(app.html()));
});

rule('App: Shift+Tab from the comparison\'s heading stays inside the dialog', async () => {
  const app = await releasePage(), doc = app.doc, id = podsGroup(app);
  app.click('corr-review', id); await app.tick();
  const btn = n => ({ id: n, dataset: {}, focus() { doc.activeElement = this; }, closest: () => null });
  const head = btn('ca-t'), ctl = [btn('ca-close'), btn('apply')], ov = app.el('overlay');
  ov.querySelectorAll = () => ctl; ov.contains = el => el === head || ctl.includes(el);
  doc.activeElement = head;
  let taken = false; app.keyOn('Tab', { shiftKey: true, preventDefault() { taken = true; } }, head);
  assert.ok(taken && doc.activeElement === ctl[1], 'to the last control');
});

rule('App: a correction to a process with no draft starts the draft from the latest version', async () => {
  const app = await releasePage(), path = 'maps/drafts/release.md', id = podsGroup(app);
  await app.fs.remove(path); app.click('refresh'); await app.tick(100);
  app.click('corr-review', id); await app.tick();
  assert.ok(/There&#39;s no draft yet: applying starts one from v2|There's no draft yet: applying starts one from v2/.test(app.overlay()));
  app.click('corr-apply', id); await app.tick(100);
  assert.ok(app.fs.files[path] && /for 20 minutes/.test(app.fs.files[path].t));
});

rule('App: publishing lists the corrections it includes; the author sees it on Home with View change, and Dismiss is remembered in this browser', async () => {
  const app = await releasePage(), id = podsGroup(app);
  app.click('corr-review', id); await app.tick();
  app.click('corr-apply', id); await app.tick(100);
  assert.ok(/<b>Included in this version: 1 correction\.<\/b>/.test(app.html()), 'the publish panel says what the version includes');
  app.set('change-note', 'Watch new pods for 20 minutes'); app.click('publish', 'release'); await app.tick(100);
  assert.ok(/Published v3\. [^<]*It includes 1 correction\./.test(app.html() + app.live()));
  const rec = app.files('publications/release/').filter(p => /^publications\/release\/v3-[a-z0-9]+\/publication\.json$/.test(p)).map(p => JSON.parse(app.fs.files[p].t))[0];
  assert.deepStrictEqual(rec.corrections.map(c => [c.id, typeof c.result.sig]), [[id, 'string']]);
  app.click('corr-filter', 'all'); await app.tick();
  assert.ok(/<span class="pill passed">Published in v3<\/span>/.test(app.html()) && /<span class="pill passed">Published in v2<\/span>/.test(app.html()), 'this one in v3; the example\'s deploy fix in v2');
  // Blake suggested it: Home says so, once per version.
  app.choose('person-blake'); await app.tick(); app.click('home'); await app.tick(20);
  const home = app.html();
  assert.ok(/Your correction to &quot;New pods stay up with no restarts&quot; is published in v3\./.test(home), home.slice(home.indexOf('ack-h') - 40, home.indexOf('ack-h') + 600));
  const key = /data-act="ack-dismiss" data-id="(l\.release\.v3-[a-z0-9]+)"/.exec(home)[1];
  app.click('ack-view', key, { process: 'release' }); await app.tick(20);
  assert.ok(/Corrections · \d+ open/.test(app.html()) && /Published in v3/.test(app.html()), 'View change opens its corrections, all of them');
  app.click('home'); await app.tick(20);
  app.click('ack-dismiss', key); await app.tick(20);
  assert.ok(!new RegExp(key.replace(/\./g, '\\.')).test(app.html()), 'dismissed');
  const stored = Object.keys(app.store).filter(k => /^preflight:acks:/.test(k));
  assert.strictEqual(stored.length, 1); assert.deepStrictEqual(JSON.parse(app.store[stored[0]]), [key]);
  app.click('ack-dismiss', '<img src=x>'); await app.tick();
  assert.deepStrictEqual(JSON.parse(app.store[stored[0]]), [key], 'only keys Flightdeck makes are kept');
});

rule('App: Copy correction brief gives the AI assistant the open corrections with the draft\'s steps and the rules for editing', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(20);
  app.click('copy-corr-brief', 'release'); await app.tick();
  const pre = /<pre id="brief-pre"[^>]*>([\s\S]*?)<\/pre>/.exec(app.html())[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  assert.ok(/^# Corrections: Production release/.test(pre) && /current version v2/.test(pre) && /2 open corrections/.test(pre), pre.slice(0, 200));
  assert.ok(/Edit the process's draft, `maps\/drafts\/release\.md`\. Change no other file\. Keep every existing step ID/.test(pre));
  assert.ok(/Wording: "New pods stay up with no restarts" \{#pods\}/.test(pre) && /command: kubectl get pods -l app=web-app/.test(pre) && /Suggested in 2 runs/.test(pre));
  assert.ok(/Missing step: "Close the release ticket" \{#close\}/.test(pre));
  assert.ok(!/stage 5/.test(pre) && !/hears about it earlier/.test(pre), 'applied and declined ones are left out');
});

rule('App: the correction brief names the draft file the process really has, even when it isn\'t named after the process', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  const md = app.fs.files['maps/drafts/release.md'].t;
  await app.fs.remove('maps/drafts/release.md'); await app.fs.write('maps/drafts/production-release.md', md);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick(20);
  app.click('copy-corr-brief', 'release'); await app.tick();
  const pre = /<pre id="brief-pre"[^>]*>([\s\S]*?)<\/pre>/.exec(app.html())[1];
  assert.ok(/`maps\/drafts\/production-release\.md`/.test(pre) && !/drafts\/release\.md/.test(pre));
});

rule('App: C opens Correct this step on the selected step, Escape closes its menu and then the composer, and only the author can withdraw', async () => {
  const app = await recordingRelease();
  app.click('select', 'flags'); await app.tick();
  app.key('c'); await app.tick();
  assert.ok(/<h4 class="corr-h" id="corr-h">Correct this step<\/h4>/.test(app.html()));
  app.click('corr-menu'); await app.tick();
  assert.ok(/aria-expanded="true" aria-controls="corr-menu"/.test(app.html()));
  app.key('Escape'); await app.tick();
  assert.ok(/aria-expanded="false" aria-controls="corr-menu"/.test(app.html()) && app.focused() === '[data-act="corr-menu"]', 'the menu closes first');
  app.click('corr-op', 'describe'); await app.tick();
  app.input('corr-why', 'The values file is locked during deploys'); app.click('corr-save', 'flags'); await app.tick(60);
  const id = /data-act="corr-withdraw" data-id="([\w-]+)" data-process="release"/.exec(app.html())[1];
  app.click('corr-withdraw', id, { process: 'release' }); await app.tick(60);
  assert.ok(/<span class="pill locked">Withdrawn<\/span>/.test(app.html()));
  app.click('corr-open', 'flags', { mode: 'correct' }); await app.tick();
  app.key('Escape'); await app.tick();
  assert.ok(!/id="corr-h"/.test(app.html()), 'Escape closes the composer');
});

rule('App: a process called constructor and suggestions about steps called constructor, __proto__ or toString show without breaking the page', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/constructor.md', app.fs.files['maps/drafts/release.md'].t.replace('process: release', 'process: constructor').replace('title: Production release', 'title: Odd names'));
  const { key } = app.run();
  const lines = ['constructor', '__proto__', 'toString'].map(id => JSON.stringify({ id, kind: 'fix', fixKind: 'instructions', target: { phase: id, step: id }, version: 1, step: id, text: 'About ' + id, by: 'person-blake', at: '2026-10-16T10:00:00.000Z', files: [] })).join('\n') + '\n';
  await app.fs.write('runs/' + key + '/notes-odd.jsonl', lines);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'constructor'); await app.tick(20);
  assert.ok(/Odd names/.test(app.html()) && !/Corrections ·/.test(app.html()), 'its page opens');
  app.click('open-process', 'release'); await app.tick(20);
  const h = app.html();
  ['constructor', '__proto__', 'toString'].forEach(id => assert.ok(h.includes('About ' + id) && h.includes(id + ' <span class="small">(not in the current version)</span>'), id));
  app.click('ptab', 'edit'); await app.tick(20);
  assert.ok(/data-act="ob-/.test(app.html()), 'the builder opens too');
});

/* ---------- the builder's parts box ---------- */
/* A drop line as the drag handlers find it under the pointer. */
const lineAt = (place, kind) => ({ getAttribute: k => ({ 'data-ob-place': place, 'data-ob-drop': kind === 'step' ? place : null, 'data-say': '', 'data-for': kind })[k], setAttribute() {}, classList: { add() {}, remove() {}, contains: () => false } });
const dragPart = (app, part, place, kind) => {
  app.fire('dragstart', { target: { closest: sel => /data-ob-part/.test(sel) ? { getAttribute: () => part } : null } });
  const line = lineAt(place, kind);
  app.fire('dragover', { target: { closest: sel => /data-for|data-ob-drop/.test(sel) ? line : null } });
  app.fire('drop', { target: { closest: sel => /data-for|data-ob-drop/.test(sel) ? line : null } });
};
const releaseText = app => app.fs.files['maps/drafts/release.md'].t;
const enter = (app, id, value) => app.keyOn('Enter', {}, { tagName: 'INPUT', id, value, dataset: { enter: 'ob-commit' }, closest: () => null });

rule('App: a part dragged onto a line in the outline is added there, selected, with its text ready to type over', async () => {
  const app = await builderOn(), original = releaseText(app);
  assert.ok(/<aside class="fpe-pane fpe-parts" id="ob-parts" aria-labelledby="ob-parts-h">/.test(app.html()) && /data-ob-part="must" aria-pressed="false"/.test(app.html()), 'the parts box is beside the outline');
  dragPart(app, 'must', 'before:flags', 'step'); await app.tick();
  assert.ok(/<li class="ob-step sel ob-new" draggable="true" data-ob-step="new-must-do-step">/.test(app.html()), 'selected and flashed');
  assert.strictEqual(app.focused(), 'ob-text', 'its text box has focus');
  assert.ok(/Added a must-do step after “Full test gate green on the release commit”, inside Before production changes\./.test(app.live()), app.live());
  assert.ok(/<div class="notice good"><span>Added a must-do step[^<]*<\/span><span class="row"><button type="button" class="btn" data-act="tl-undo" data-id="draft">Undo<\/button>/.test(app.html()), 'with a real Undo button');
  assert.ok(/class="ob-switch reveal" for="ob-mark-must"><input type="radio" name="ob-mark" id="ob-mark-must" value="must" data-bound checked>/.test(app.html()), 'Must do is shown, chosen and highlighted');
  assert.ok(/It follows the name until you save the draft/.test(app.html()), 'a new part\'s ID follows its name for now');
  app.set('ob-text', 'Smoke tests pass on staging'); enter(app, 'ob-text', 'Smoke tests pass on staging'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const saved = releaseText(app);
  assert.deepStrictEqual(lineDelta(original, saved), { gone: [], added: ['- [!] {confirm} Smoke tests pass on staging {#smoke-tests-pass-on}'] });
  assert.ok(/\{#tests\}[\s\S]*\{#smoke-tests-pass-on\}[\s\S]*\{#flags\}/.test(saved), 'between the two steps');
  app.click('ob-sel', 'smoke-tests-pass-on'); await app.tick();
  app.set('ob-text', 'Smoke tests green'); enter(app, 'ob-text', 'Smoke tests green'); await app.tick();
  assert.ok(/ID <code>smoke-tests-pass-on<\/code>\. It never changes/.test(app.html()), 'once saved, its ID never changes');
});

rule('App: a dragged part dropped where it can\'t go is refused and nothing changes', async () => {
  const app = await builderOn();
  dragPart(app, 'gate', 'before:flags', 'gate'); await app.tick();
  assert.ok(/Gate can.t go there/.test(app.live()) && !/Unsaved: Save draft before you publish/.test(app.html()), 'refused');
  dragPart(app, 'lanes', 'lane:deploy:0', 'lanes'); await app.tick();
  assert.ok(/Parallel lanes can.t go there/.test(app.live()) && !/Unsaved: Save draft before you publish/.test(app.html()), 'a lane that isn\'t there');
  app.click('ob-part', 'step'); await app.tick();
  app.click('ob-place-at', 'gate:verify'); await app.tick();
  assert.ok(/Step can.t go there/.test(app.live()) && !/Unsaved: Save draft before you publish/.test(app.html()) && /class="ob placing for-step"/.test(app.html()), 'by click too, and still placing');
});

rule('App: placing a part by keyboard announces it, moves among legal places with full names, and Escape returns to the part', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'flags'); await app.tick();
  app.click('ob-part', 'step'); await app.tick();
  assert.strictEqual(app.live(), 'Placing Step. Choose a destination. Escape cancels.');
  assert.ok(/<li class="ob-slot legal on"[^>]*><button type="button" class="ob-dest" data-act="ob-place-at" data-id="before:rollback" tabindex="0" aria-label="Put Step here: Before production changes, after Feature flags set in the deploy values, position 4 of 7"/.test(app.html()), 'starts just after the selected step');
  assert.strictEqual(app.focused(), '[data-act="ob-place-at"][data-id="before:rollback"]');
  assert.ok(/<span id="ob-preview">A step will go after “Feature flags set in the deploy values”, inside Before production changes\.<\/span>/.test(app.html()), 'a sentence preview');
  assert.ok(!/data-ob-place="gate:verify"[^>]*><button/.test(app.html()), 'only places a step can go are buttons');
  const dest = id => ({ tagName: 'BUTTON', dataset: { act: 'ob-place-at', id }, closest: () => null });
  app.keyOn('ArrowDown', {}, dest('before:rollback')); await app.tick();
  assert.strictEqual(app.focused(), '[data-act="ob-place-at"][data-id="before:notes"]');
  app.keyOn('End', {}, dest('before:notes')); await app.tick();
  assert.ok(/data-id="end:verify:1" tabindex="0" aria-label="Put Step here: Verify in production, Wrap-up lane, after Close the release ticket, position 4 of 4"/.test(app.html()), 'the last place, in a lane');
  app.key('Escape'); await app.tick();
  assert.ok(!/class="ob placing/.test(app.html()) && /Canceled\. Nothing was added\./.test(app.live()));
  assert.strictEqual(app.focused(), '[data-act="ob-part"][data-id="step"]', 'focus back on the part');
  app.click('ob-part', 'lanes'); await app.tick();
  app.keyOn('ArrowUp', {}, dest('lane:verify:1')); await app.tick();
  app.click('ob-place-at', 'lane:verify:0'); await app.tick();
  assert.ok(/Added a lane before the Product checks lane, in Verify in production\./.test(app.live()), app.live());
  assert.strictEqual(app.focused(), 'ob-tr-title');
  assert.ok(/<section class="ob-lane sel ob-new" aria-label="Lane: Backend">/.test(app.html()), 'named after a role no lane in the phase has');
});

rule('App: with nowhere to go, placing says why and offers Cancel', async () => {
  const app = await builderOn();
  app.click('ob-sel-phase', 'verify'); await app.tick();
  app.set('ob-g-title', 'Release done'); enter(app, 'ob-g-title', 'Release done'); await app.tick();
  app.click('ob-part', 'gate'); await app.tick();
  assert.ok(/<b>Nowhere to put a gate\.<\/b> Every phase already has a gate\. Select one to edit it\./.test(app.html()));
  assert.strictEqual(app.focused(), 'ob-place-cancel');
  app.click('ob-place-cancel'); await app.tick();
  assert.ok(!/ob-placing/.test(app.html()));
});

rule('App: every new kind of builder change can be undone, back to the saved text', async () => {
  const app = await builderOn();
  const undone = async (what, act) => {
    await act(); await app.tick();
    assert.ok(/Unsaved: Save draft before you publish/.test(app.html()), what + ': changed');
    app.click('tl-undo', 'draft'); await app.tick();
    assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()), what + ': undone exactly');
  };
  await undone('a lane added', async () => dragPart(app, 'lanes', 'lane:deploy:end', 'lanes'));
  await undone('a phase added first', async () => dragPart(app, 'phase', 'phase:^', 'phase'));
  await undone('a gate added', async () => dragPart(app, 'gate', 'gate:verify', 'gate'));
  await undone('a team step type added', async () => dragPart(app, 'type:change.request', 'end:verify:0', 'step'));
  await undone('a lane renamed', async () => { app.click('ob-sel-track', 'verify', { track: '0' }); await app.tick(); app.set('ob-tr-title', 'Checks'); enter(app, 'ob-tr-title', 'Checks'); });
  await undone('a lane given another role', async () => { app.click('ob-sel-track', 'verify', { track: '0' }); await app.tick(); app.select('ob-tr-role', 'backend'); });
  await undone('a lane deleted, its steps kept', async () => { app.click('ob-sel-track', 'verify', { track: '1' }); await app.tick(); app.click('ob-ask', 'track'); await app.tick(); app.click('ob-del-track', 'keep'); });
  assert.ok(/Undid the lane deletion of "Wrap-up"\./.test(app.live()), 'Undo says what it undid: ' + app.live());
  await undone('a lane deleted with its steps', async () => { app.click('ob-sel-track', 'verify', { track: '1' }); await app.tick(); app.click('ob-ask', 'track'); await app.tick(); app.click('ob-del-track', 'all'); });
  await undone('a gate removed', async () => { app.click('ob-sel-phase', 'prep'); await app.tick(); app.click('ob-gate-remove', 'prep'); });
  await undone('a phase deleted', async () => { app.click('ob-sel-phase', 'deploy'); await app.tick(); app.click('ob-ask', 'phase'); await app.tick(); app.click('ob-del-phase', 'deploy'); });
});

rule('App: deleting a lane asks whether its steps stay; the answer is said back', async () => {
  const app = await builderOn();
  app.click('ob-sel-track', 'verify', { track: '1' }); await app.tick();
  assert.ok(/<input id="ob-tr-title"[^>]*value="Wrap-up">/.test(app.html()) && /<option value="release-lead" selected>@release-lead/.test(app.html()), 'the lane\'s form');
  app.click('ob-ask', 'track'); await app.tick();
  assert.ok(/Delete the Wrap-up lane\? Its 3 steps can move up into the phase, or go with it\./.test(app.html()));
  assert.strictEqual(app.focused(), 'ob-ask-go');
  app.key('Escape'); await app.tick();
  assert.ok(!/Delete the Wrap-up lane\?/.test(app.html()), 'Escape cancels the question');
  app.click('ob-ask', 'track'); await app.tick();
  app.click('ob-del-track', 'keep'); await app.tick();
  assert.ok(/Deleted the Wrap-up lane; its steps moved up into the phase\./.test(app.live()));
  app.click('save-draft'); await app.tick(80);
  const t = releaseText(app);
  assert.ok(!/Track: Wrap-up/.test(t) && /## Verify in production · READ-DO \{#verify\}\n- \[ \] \{communicate\} Post the result/.test(t), 'up into the phase');
});

rule('App: the parts box searches, says when nothing matches, and the phone\'s Add part sheet places from the outline', async () => {
  const app = await builderOn();
  app.input('ob-part-q', 'zzz'); await app.tick();
  assert.ok(/No parts match “zzz”\./.test(app.html()) && /data-act="ob-part-clear"/.test(app.html()));
  app.click('ob-part-clear'); await app.tick();
  assert.ok(/data-ob-part="phase"/.test(app.html()));
  app.click('ob-parts-open'); await app.tick();
  assert.ok(/class="ob-sheet" role="dialog" aria-modal="true"/.test(app.overlay()) && /id="ob-part-q2"/.test(app.overlay()));
  app.click('ob-part', 'process'); await app.tick();
  assert.ok(!app.overlay() && /class="ob placing for-step"/.test(app.html()), 'the sheet closes; the place is chosen in the outline');
  app.key('Escape'); await app.tick();
  assert.strictEqual(app.focused(), '[data-act="ob-parts-open"]', 'back to Add part');
});

/* ---------- review fixes: each failed before its fix ---------- */
rule('App: Undo puts back which parts are new, so a restored saved step never takes a new ID', async () => {
  const app = await builderOn();
  app.click('ob-del', 'flags'); await app.tick();
  dragPart(app, 'step', 'before:rollback', 'step'); await app.tick();
  app.set('ob-text', 'Flags'); enter(app, 'ob-text', 'Flags'); await app.tick();
  assert.ok(/data-ob-step="flags"/.test(app.html()), 'set-up: the new step took the free ID flags');
  app.click('tl-undo', 'draft'); await app.tick(); app.click('tl-undo', 'draft'); await app.tick(); app.click('tl-undo', 'draft'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  app.set('ob-text', 'Original flags reworded'); enter(app, 'ob-text', 'Original flags reworded'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(/Original flags reworded \^environment @backend \{#flags\}/.test(releaseText(app)), releaseText(app).split('\n').find(l => /reworded/.test(l)));
});

rule('App: an ID like "constructor" is never mistaken for a new part', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md';
  await app.fs.write(path, ['---', 'process: release', 'title: Production release', '---', '', '## One · READ-DO {#one}', '- [ ] {confirm} Build it {#constructor}', ''].join('\n'));
  app.focus(); await app.tick(80);
  app.click('ob-sel', 'constructor'); await app.tick();
  app.set('ob-text', 'Build the thing'); enter(app, 'ob-text', 'Build the thing'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(/Build the thing \{#constructor\}/.test(app.fs.files[path].t));
});

rule('App: a step\'s kind is one choice of three, and leaving must-do says what that allows', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'flags'); await app.tick();
  assert.ok(/<fieldset class="field ob-kind"><legend>Kind<\/legend>/.test(app.html()) && /type="radio" name="ob-mark" id="ob-mark-must" value="must" data-bound checked/.test(app.html()), 'radio buttons, must-do chosen');
  app.check('ob-mark-planned', true); await app.tick();
  assert.ok(/No longer a must-do step: it can now be marked N\/A or waived\./.test(app.live()), app.live());
  app.click('save-draft'); await app.tick(80);
  assert.ok(/- \[~\] \{confirm\} Feature flags/.test(releaseText(app)));
});

rule('App: on a phone, adding from the properties sheet closes the sheet first, so the new box can be used', async () => {
  const app = boot({ narrow: true }); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  assert.ok(/class="panel stack ob-form"/.test(app.html()), 'set-up: the sheet is open');
  app.click('ob-add-after', 'flags'); await app.tick();
  assert.ok(!/class="panel stack ob-form"/.test(app.html()) && /id="ob-new-text"/.test(app.html()), 'sheet closed, the new box is there');
  app.click('ob-sel-phase', 'deploy'); await app.tick();
  app.click('ob-add-phase', 'deploy'); await app.tick();
  assert.ok(!/class="panel stack ob-form"/.test(app.html()) && /id="ob-new-title"/.test(app.html()));
});

rule('App: links in the Add part sheet close it before going to another screen', async () => {
  const app = await builderOn();
  app.click('ob-parts-open'); await app.tick();
  app.click('new-type'); await app.tick();
  assert.strictEqual(app.overlay(), '', 'the sheet is gone');
  assert.ok(/id="tf-label"/.test(app.html()), 'on the step type form');
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-parts-open'); await app.tick();
  app.click('open-types'); await app.tick();
  assert.strictEqual(app.overlay(), '');
});

rule('App: when a dragged step is dropped or let go, its drop lines go away', async () => {
  const app = await builderOn();
  app.fire('dragstart', { target: { closest: sel => /data-ob-step/.test(sel) ? { getAttribute: () => 'flags', classList: { add() {}, remove() {} } } : null } });
  await app.tick();
  assert.ok(app.bodyClasses().includes('ob-for-move'), 'set-up: lines shown');
  app.fire('dragend', {});
  assert.deepStrictEqual(app.bodyClasses(), []);
});

/* ---------- the full-page editor ---------- */
rule('App: the editor opens as its own page with focus on its heading; Done returns to Edit and says edits stay', async () => {
  const app = await builderOn();
  assert.strictEqual(app.focused(), 'ed-h');
  assert.strictEqual(app.session['preflight:editing'], 'release', 'remembered in this tab');
  app.key('Escape'); await app.tick();
  assert.ok(/id="fpe"/.test(app.html()), 'Escape never closes it');
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('ed-done'); await app.tick();
  assert.ok(!/id="fpe"/.test(app.html()) && /edits in the draft that aren.t saved/.test(app.html()), 'back on the process page, edits kept');
  assert.strictEqual(app.focused(), '[data-act="ptab"][data-id="edit"]');
  assert.ok(/Your changes aren.t saved yet/.test(app.live()));
  assert.strictEqual(app.session['preflight:editing'], undefined);
});

rule('App: a refresh while editing comes back to the editor', async () => {
  const app = boot({ sessionStore: { 'preflight:editing': 'release' } }); await app.tick(80);
  assert.ok(/id="fpe"/.test(app.html()) && /Production release <span class="cat">Draft/.test(app.html()));
  assert.strictEqual(app.focused(), 'ed-h');
});

rule('App: the inspector\'s tabs switch by click and arrow keys; Checks and Preview are remembered; selecting shows Selected', async () => {
  const app = await builderOn();
  app.click('ins-tab', 'checks'); await app.tick();
  assert.ok(/id="ins-t-checks" aria-selected="true"/.test(app.html()) && app.store['preflight:insTab'] === '"checks"');
  const tab = id => ({ tagName: 'BUTTON', dataset: { act: 'ins-tab', id }, closest: () => null });
  app.keyOn('ArrowRight', {}, tab('checks')); await app.tick();
  assert.ok(/id="ins-t-preview" aria-selected="true"/.test(app.html()) && app.focused() === '#ins-t-preview');
  app.keyOn('ArrowRight', {}, tab('preview')); await app.tick();
  assert.ok(/id="ins-t-selected" aria-selected="true"/.test(app.html()), 'wraps around');
  app.click('ins-tab', 'preview'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  assert.ok(/id="ins-t-selected" aria-selected="true"/.test(app.html()), 'selecting switches to Selected');
  const again = boot({ localStore: { 'preflight:insTab': '"checks"' } }); await again.tick(60); again.choose('person-casey'); await again.tick();
  again.click('open-process', 'release'); await again.tick(); again.click('ptab', 'edit'); await again.tick();
  assert.ok(/id="ins-t-checks" aria-selected="true"/.test(again.html()), 'remembered in this browser');
});

rule('App: the parts rail toggle is remembered in this browser', async () => {
  const app = await builderOn();
  app.click('ob-rail'); await app.tick();
  assert.ok(/class="fpe-panes rail"/.test(app.html()) && app.store['preflight:partsRail'] === 'true');
  assert.strictEqual(app.focused(), '[data-act="ob-rail"]');
  app.click('ob-rail'); await app.tick();
  assert.ok(!/fpe-panes rail/.test(app.html()) && app.store['preflight:partsRail'] === 'false');
});

rule('App: Redo puts back what Undo took, and Undo returns focus to the item it restores', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'rollback'); await app.tick();
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/Undid the step deletion of "Rollback commit written in the release ticket"\./.test(app.live()), app.live());
  assert.strictEqual(app.focused(), '[data-act="ob-sel"][data-id="rollback"]');
  assert.ok(/data-act="tl-redo" data-id="draft"[^>]*aria-label="Redo the step deletion of/.test(app.html()));
  app.click('tl-redo', 'draft'); await app.tick();
  assert.ok(!/data-ob-step="rollback"/.test(app.html()) && /Redid the step deletion of/.test(app.live()));
  app.click('tl-undo', 'draft'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick(); app.check('ob-mark-step', true); await app.tick();
  assert.ok(/data-act="tl-redo" data-id="draft" aria-disabled="true"/.test(app.html()), 'a new change clears Redo');
});

rule('App: Step in an empty checklist adds a phase with the step in it, as one change', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md';
  await app.fs.write(path, '---\nprocess: release\ntitle: Production release\n---\n');
  app.focus(); await app.tick(80);
  app.click('ob-part', 'step'); await app.tick();
  assert.strictEqual(app.focused(), 'ob-place-cancel');
  app.click('ob-phase-with'); await app.tick();
  assert.ok(/<li class="ob-step sel ob-new"[^>]*data-ob-step="new-step">/.test(app.html()) && app.focused() === 'ob-text');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()), 'one Undo takes both back');
});

rule('App: saving shows a quiet Saved check beside Save for a moment', async () => {
  const app = await builderOn();
  app.click('ob-del', 'rollback'); await app.tick();
  assert.ok(/class="linkish fpe-discard" data-act="revert-draft" data-id="release">/.test(app.html()));
  app.click('save-draft'); await app.tick(80);
  assert.ok(/<span class="fpe-state just" role="status"><span class="ic"[^>]*>.*?<\/span>Saved<\/span>/.test(app.html()), 'the check icon with Saved');
  assert.ok(/class="linkish fpe-discard"[^>]* hidden>/.test(app.html()), 'Discard keeps its place, hidden');
  await new Promise(r => setTimeout(r, 2100)); await app.tick(40);
  assert.ok(/<span class="fpe-state" role="status">Saved<\/span>/.test(app.html()), 'then just Saved');
});

/* ---------- second visual review: each failed before its fix ---------- */
rule('App: text typed into the builder\'s form and not yet applied counts as unsaved, for the header and for leaving the page', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'flags'); await app.tick();
  assert.ok(!app.leaveWarns(), 'set-up: nothing unsaved');
  app.input('ob-text', 'Flags half typed'); await new Promise(r => setTimeout(r, 300)); await app.tick();
  assert.ok(app.leaveWarns(), 'leaving asks first');
  assert.ok(/Unsaved: Save draft before you publish/.test(app.html()), 'the header says so');
  enter(app, 'ob-text', 'Flags half typed'); await app.tick();
  assert.ok(app.leaveWarns() && /Unsaved: Save draft before you publish/.test(app.html()), 'once applied, it is an ordinary unsaved change');
  app.click('save-draft'); await app.tick(80);
  assert.ok(!app.leaveWarns(), 'saved');
});

rule('App: widening a phone past the breakpoint closes the properties sheet\'s modal state', async () => {
  const app = boot({ narrow: true }); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  assert.ok(app.topInert() && app.formModal(), 'set-up: the sheet is modal');
  app.setNarrow(false); await app.tick(30);
  assert.ok(!app.topInert() && !app.formModal(), 'released');
});

rule('App: a successful save is confirmed quietly beside Save, not with a notice', async () => {
  const app = await builderOn();
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(!/<div class="notice[^"]*"(?: role="status")?><span>Draft saved\./.test(app.html()), 'no notice');
  assert.ok(/fpe-state just/.test(app.html()) && /Draft saved\./.test(app.live()), 'the check beside Save, and still announced');
});

/* ---------- third review: typed-but-unapplied text is never dropped ---------- */
rule('App: text typed and not yet applied keeps the editor from following a newer draft, and saving it is a conflict', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-sel', 'flags'); await app.tick();
  app.setScoped('ob-text', 'Typed words'); app.input('ob-text', 'Typed words'); await app.tick();
  await app.fs.write(path, original.replace('Feature flags set in the deploy values', 'Flags set by them'));
  app.focus(); await app.tick(80);
  assert.strictEqual(app.draft('ob-text'), 'Typed words', 'the typed text is still there');
  assert.ok(app.leaveWarns() && /Unsaved: Save draft before you publish/.test(app.html()));
  enter(app, 'ob-text', 'Typed words'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(/Someone else changed this draft/.test(app.html()) && /Flags set by them/.test(app.fs.files[path].t), 'a conflict, theirs kept');
});

rule('App: on a phone, Escape or Done on the sheet applies typed text, or keeps the sheet open with the reason', async () => {
  const app = boot({ narrow: true }); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  app.setScoped('ob-text', 'Ask @qa'); app.input('ob-text', 'Ask @qa'); await app.tick();
  app.key('Escape'); await app.tick();
  assert.ok(/class="panel stack ob-form"/.test(app.html()) && /id="ferr-ob-text"/.test(app.html()) && app.leaveWarns(), 'refused: the sheet stays, with why');
  app.setScoped('ob-text', 'Phone words'); app.input('ob-text', 'Phone words'); await app.tick();
  app.key('Escape'); await app.tick();
  assert.ok(!/class="panel stack ob-form"/.test(app.html()), 'closed');
  app.click('save-draft'); await app.tick(80);
  assert.ok(/Phone words \^environment @backend \{#flags\}/.test(app.fs.files['maps/drafts/release.md'].t), 'applied, then saved');
});

/* ---------- final narrow check: typing that's undone or discarded doesn't stay "unsaved" ---------- */
rule('App: typing put back to what the step says is no longer unsaved, and the editor follows newer drafts again', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-sel', 'flags'); await app.tick();
  app.setScoped('ob-text', 'Something else'); app.input('ob-text', 'Something else'); await app.tick();
  assert.ok(app.leaveWarns(), 'set-up: pending');
  app.setScoped('ob-text', 'Feature flags set in the deploy values'); app.input('ob-text', 'Feature flags set in the deploy values'); await app.tick();
  assert.ok(!app.leaveWarns(), 'back to what it says: nothing unsaved');
  await app.fs.write(path, original.replace('Rollback commit written in the release ticket', 'Rollback written by them'));
  app.focus(); await app.tick(80);
  assert.ok(/Rollback written by them/.test(app.html()), 'follows the newer draft');
});

rule('App: Discard my changes also drops typed text that was refused, and the editor follows newer drafts again', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-sel', 'flags'); await app.tick();
  app.setScoped('ob-text', 'Ask @qa'); app.input('ob-text', 'Ask @qa'); enter(app, 'ob-text', 'Ask @qa'); await app.tick();
  assert.ok(/id="ferr-ob-text"/.test(app.html()) && app.leaveWarns(), 'set-up: refused, still pending');
  app.click('revert-draft', 'release'); await app.tick();
  assert.ok(!app.leaveWarns() && !/Unsaved: Save draft before you publish/.test(app.html()), 'nothing unsaved');
  await app.fs.write(path, original.replace('Rollback commit written in the release ticket', 'Rollback written by them'));
  app.focus(); await app.tick(80);
  assert.ok(/Rollback written by them/.test(app.html()), 'follows the newer draft');
});

rule('App: typed text in a box that is no longer on screen isn\'t left counted as unsaved', async () => {
  const app = await builderOn();
  app.click('ob-sel-phase', 'deploy'); await app.tick();
  app.setScoped('ob-ph-title', 'Deploy it'); app.input('ob-ph-title', 'Deploy it'); await app.tick();
  assert.ok(app.leaveWarns(), 'set-up: pending');
  app.click('ed-mode', 'markdown'); await app.tick();
  assert.ok(!app.leaveWarns(), 'the box left the screen without being applied');
});

rule('App: a change of spaces inside a value (a command\'s arguments) counts as unsaved typing', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'pods'); await app.tick();
  app.setScoped('ob-fld-command', 'kubectl get pods  -l app=web-app'); app.input('ob-fld-command', 'kubectl get pods  -l app=web-app'); await app.tick();
  assert.ok(app.leaveWarns(), 'two spaces are a real change');
  app.setScoped('ob-fld-command', ' kubectl get pods -l app=web-app '); app.input('ob-fld-command', ' kubectl get pods -l app=web-app '); await app.tick();
  assert.ok(!app.leaveWarns(), 'spaces at the ends are not, as applying trims them');
});

rule('App: a version this copy doesn\'t understand says why, can\'t be picked or started, a plan for it falls back, and a run on it is read-only', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  // The examples' own versions and runs, played through this copy's rules, are all runnable here.
  app.files('runs/').filter(p => /\/run\.json$/.test(p)).forEach(p => { const r = app.PF.run.sanitize(JSON.parse(app.fs.files[p].t)); assert.ok(r && !r._unrunnable, p + ': ' + (r && r._unrunnable)); });
  app.files('publications/').filter(p => /\/publication\.json$/.test(p)).forEach(p => { const d = p.replace(/publication\.json$/, ''), f = n => (app.fs.files[d + n] || {}).t; const v = app.PF.publish.verify(d.split('/')[2], { 'map.md': f('map.md'), 'types.json': f('types.json'), 'publication.json': f('publication.json') }); assert.ok(v.ok, p + ': ' + v.why); });
  const U = app.PF.util, md = app.fs.files['maps/drafts/release.md'].t.replace(/^(- \[[ !~]\] \{.*)$/m, '$1\n  when: ^environment is production');
  // v3, written by a newer Flightdeck: every file matches its record, so only the content check can stop it.
  const src = app.files('publications/release/').find(p => /publication\.json$/.test(p)).replace(/publication\.json$/, '');
  const types = app.fs.files[src + 'types.json'].t, info = JSON.parse(app.fs.files[src + 'publication.json'].t), base = 'publications/release/v3-newer123/';
  Object.assign(info, { version: 3, folder: 'v3-newer123', mapHash: U.hash(md), typesHash: U.hash(types), images: {} });
  const put = (p, t) => { app.fs.files[p] = { t, m: Date.now() }; };
  put(base + 'map.md', md); put(base + 'types.json', types); put(base + 'publication.json', JSON.stringify(info));
  put('proposals/plan-newer.json', JSON.stringify({ kind: 'plan', id: 'plan-newer', process: 'release', version: 3, title: 'On v3', details: {}, roles: {} }));
  const run = app.run().json, rpath = 'runs/release/newer1/run.json';
  put(rpath, JSON.stringify(Object.assign({}, run, { id: 'newer1', title: 'Started by a newer copy', snapshot: md, folder: 'v3-newer123', version: 3, recorder: { person: 'person-blake', session: 'other' } })));
  app.click('refresh'); await app.tick(80);
  const NEWER = /This version uses checklist features this copy of Flightdeck doesn&#39;t understand\. Update Flightdeck to run it\./;

  app.click('open-process', 'release'); await app.tick();
  let h = app.html();
  assert.ok(new RegExp('v3-newer123: ' + NEWER.source).test(h), 'the process page says why');
  assert.ok(new RegExp('<option value="" disabled>v3 · can\'t be used here: ' + NEWER.source).test(h), 'the version picker says why and can\'t pick it');
  assert.ok(!/value="v3-newer123"/.test(h) && !/data-id="v3-newer123"/.test(h), 'never offered to view or compare');
  app.click('start', 'release'); await app.tick();
  assert.ok(/data-folder="v2-/.test(app.html()) && !/v3-newer123/.test(app.html()), 'a new run starts on v2');

  app.click('review-plan', 'plan-newer'); await app.tick();
  h = app.html();
  assert.ok(new RegExp('This plan was made for v3, which can\'t be used here: ' + NEWER.source + '.*It starts on v2\\.').test(h), 'the plan falls back and says so');
  const before = app.files('runs/release/').length;
  app.submitForm('start-form'); await app.tick(80);
  const started = app.files('runs/release/').filter(p => /run\.json$/.test(p)).map(p => JSON.parse(app.fs.files[p].t)).find(r => r.title === 'On v3');
  assert.ok(started && started.version === 2, 'the planned run started on v2, never on v3');
  assert.ok(app.files('runs/release/').length > before);

  const text = app.fs.files[rpath].t, files = app.files('runs/release/newer1/');
  app.click('open-run', 'release/newer1'); await app.tick();
  assert.ok(/<b>Read-only in this copy\.<\/b> This version uses checklist features/.test(app.html()), 'the run says why it is read-only');
  assert.ok(/This copy shows the parts it understands, and can't record it or save over it\./.test(app.html()), 'and that it shows only what it understands');
  assert.ok(!/data-act="(pickup|takeover)"/.test(app.html()), 'no way to record it is offered');
  assert.ok(!/data-act="plan-from-run"/.test(app.html()), 'nor to plan another like it');
  const plans = app.files('proposals/').length;
  app.click('plan-from-run', 'release/newer1'); await app.tick(40);
  assert.ok(!/id="plan-form"/.test(app.html()) && app.files('proposals/').length === plans, 'planning from it is refused');
  app.click('pickup'); await app.tick(40); app.click('takeover'); await app.tick(40);
  app.click('toggle', run.steps && Object.keys(run.steps)[0] || 'approve'); await app.tick(40);
  assert.strictEqual(app.fs.files[rpath].t, text, 'run.json is never written');
  assert.deepStrictEqual(app.files('runs/release/newer1/'), files, 'nor any copy next to it');

  // A run file in a newer run format: listed and opened read-only with the reason, never written.
  const fpath = 'runs/release/newer2/run.json', ftext = JSON.stringify(Object.assign({}, run, { format: 'preflight-run/3', id: 'newer2', title: 'Newer format' }));
  put(fpath, ftext); app.click('refresh'); await app.tick(80);
  app.click('open-run', 'release/newer2'); await app.tick();
  assert.ok(/Newer format/.test(app.html()) && /Made with Flightdeck 2\.0\. This copy shows its name only and won&#39;t change it\./.test(app.html()), 'shown with the reason');
  app.click('pickup'); await app.tick(40); app.click('takeover'); await app.tick(40);
  assert.strictEqual(app.fs.files[fpath].t, ftext, 'never written');
});

/* ---------- The run workspace (1.13) ---------- */
const file = (bytes, type, name) => { const b = new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type }); b.name = name; return b; };
const notesOf = app => app.files(app.run().path.replace('run.json', 'notes-')).map(p => app.fs.files[p].t).join('\n').split('\n').filter(Boolean).map(l => JSON.parse(l));

rule('App: checking the step Next up points at selects the next one in its phase, puts focus on its check and says so once', async () => {
  const app = await recordingRelease();
  assert.strictEqual(app.nextStep(), 'jenkins', 'set-up: the deploy job is next');
  assert.strictEqual(app.selected(), 'jenkins', 'a run opens on its next step');
  app.set('rec-build', 'https://ci.example.com/job/web-app-deploy-prod/88/');
  app.click('toggle', 'jenkins'); await app.tick(40);
  const j = app.run().json;
  assert.ok(j.steps.jenkins.s === 'done' && j.steps.jenkins.values.build === 'https://ci.example.com/job/web-app-deploy-prod/88/', 'the row\'s check collected the evidence typed in the inspector');
  assert.strictEqual(app.selected(), 'approve', 'the next step in the phase is selected');
  assert.strictEqual(app.focused(), '[data-act="toggle"][data-id="approve"]', 'focus is on its check, ready for Space');
  assert.strictEqual(app.live(), '"Start the production deploy job" checked. Next: "Approve the deploy in Jenkins before it rolls back".');
  assert.ok(!/<div class="notice[^"]*" role="status"><span>"Start the production deploy job" checked/.test(app.html()), 'announced, not shown as a notice');
});

rule('App: a step checked out of order stays selected; so does one with a note still being written', async () => {
  const app = await recordingRelease();
  app.click('select', 'approve'); await app.tick();
  app.click('record', 'approve'); await app.tick(40);
  assert.strictEqual(app.run().json.steps.approve.s, 'done');
  assert.strictEqual(app.selected(), 'approve', 'checked out of order: stays');
  app.click('select', 'jenkins'); await app.tick();
  app.set('note-text', 'Queue is busy, about six minutes'); app.set('rec-build', 'https://ci.example.com/job/1/');
  app.click('record', 'jenkins'); await app.tick(40);
  assert.strictEqual(app.run().json.steps.jenkins.s, 'done');
  assert.strictEqual(app.selected(), 'jenkins', 'the note being written keeps the selection');
  assert.strictEqual(app.draft('note-text'), 'Queue is busy, about six minutes');
  assert.ok(/isn't sent yet, so this step stays selected/.test(app.live()));
});

rule('App: Done with required evidence missing opens the box it needs; checking the last step of a phase leads to its gate', async () => {
  const app = await recordingRelease();
  app.click('select', 'pods'); await app.tick();
  app.click('toggle', 'jenkins'); await app.tick(40);
  assert.strictEqual(app.selected(), 'jenkins', 'the step with missing evidence is selected');
  assert.strictEqual(app.focused(), 'rec-build', 'and its box gets focus');
  assert.ok(!app.run().json.steps.jenkins || app.run().json.steps.jenkins.s !== 'done', 'nothing checked without it');
  app.set('rec-build', 'https://ci.example.com/job/2/'); app.click('record', 'jenkins'); await app.tick(40);
  app.click('record', 'approve'); await app.tick(40);
  app.click('record', 'pods'); await app.tick(40);
  assert.strictEqual(app.run().json.steps.pods.s, 'done');
  assert.strictEqual(app.focused(), '#gate-deployed .btn.go', 'the gate\'s own button, which still asks to confirm');
  assert.ok(/Next: the "Deployed" gate\./.test(app.live()));
  assert.ok(!app.run().json.gates.deployed || app.run().json.gates.deployed.s !== 'passed', 'the gate is never passed for you');
});

rule('App: Space or X checks the selected step once, even when held; B opens the reason and Escape returns to the step', async () => {
  const app = await recordingRelease();
  app.click('select', 'approve'); await app.tick();
  app.keyOn(' ', { repeat: true }); await app.tick(40);
  assert.ok(!app.run().json.steps.approve || app.run().json.steps.approve.s !== 'done', 'a held key repeating does nothing');
  app.keyOn('x'); await app.tick(40);
  assert.strictEqual(app.run().json.steps.approve.s, 'done', 'X is Space');
  app.click('select', 'pods'); await app.tick();
  app.key('b'); await app.tick();
  assert.ok(/data-scope="block:pods"/.test(app.html()), 'the reasons');
  app.key('Escape'); await app.tick();
  assert.ok(!/data-scope="block:pods"/.test(app.html()) && app.focused() === '[data-act="select"][data-id="pods"]', 'closed, focus back on the step');
});

rule('App: J and K open a folded phase they move into; Next up and the rail move the selection and never answer anything', async () => {
  const app = await recordingRelease();
  const before = JSON.stringify(app.run().json.steps);
  app.click('select', 'merge'); await app.tick();
  assert.ok(!/id="step-announce"/.test(app.html()), 'set-up: the finished phase is folded');
  app.key('k'); await app.tick();
  assert.strictEqual(app.selected(), 'announce');
  assert.ok(/data-act="fold" data-id="prep" aria-expanded="true"/.test(app.html()), 'its phase opened, with Hide steps');
  app.click('goto', 'step-pods'); await app.tick();
  assert.strictEqual(app.selected(), 'pods');
  app.click('goto', 'phase-verify'); app.click('goto', 'gate-deployed'); await app.tick();
  assert.strictEqual(JSON.stringify(app.run().json.steps), before, 'navigation changed nothing in the run');
});

rule('App: notes take several files of the allowed kinds, saved under their own cleaned names with sizes; others are refused next to the box', async () => {
  const app = await recordingRelease();
  app.click('select', 'approve'); await app.tick();
  const pdf = file('%PDF-1.7 runbook', 'application/pdf', 'Run book (v2).pdf'), log = file('pods restarted 0\n<script>alert(1)</script>\n', '', 'deploy output.log'), zip = file([0x50, 0x4B, 3, 4, 0, 0], 'application/zip', 'logs.zip');
  app.change('note-file', [pdf, log, zip, file('<svg onload=alert(1)>', 'image/svg+xml', 'logo.svg')]); await app.tick(40);
  let h = app.html();
  assert.ok(/Run-book-v2\.pdf/.test(h) && /deploy-output\.log/.test(h) && /logs\.zip/.test(h) && /Add note with 3 files/.test(h), 'three wait, with cleaned names');
  assert.ok(/id="atterr-note:approve">&quot;logo\.svg&quot; can&#39;t be attached\. Flightdeck attaches PNG, JPEG, WebP or GIF images, PDF, text/.test(h), 'the SVG is refused, next to the box');
  app.change('note-file', [{ name: 'huge.zip', type: 'application/zip', size: 11 * 1024 * 1024, slice() { return this; } }]); await app.tick(20);
  assert.ok(/&quot;huge\.zip&quot; is 11 MB\. Attachments can be up to 10 MB each\./.test(app.html()), 'too big, said with its size');
  app.change('note-file', [file('<html>', 'image/png', 'fake.png')]); await app.tick(20);
  assert.ok(/&quot;fake\.png&quot; doesn&#39;t look like a \.png file inside/.test(app.html()), 'a file that isn\'t what it says');
  app.set('note-text', 'Output and the runbook'); app.click('add-note', 'approve'); await app.tick(60);
  const n = notesOf(app).find(x => x.text === 'Output and the runbook');
  assert.strictEqual(n.files.length, 3);
  assert.ok(n.files.every(f => app.fs.files[f]), 'each file is in the run\'s files/ folder');
  assert.deepStrictEqual(n.files.map(f => n.fileInfo[f].name), ['Run-book-v2.pdf', 'deploy-output.log', 'logs.zip']);
  assert.ok(n.files.every(f => /^runs\/release\/[^/]+\/files\/\d+-[a-z0-9]+-[a-z0-9]+-[\w.-]+$/.test(f)), 'paths older copies keep');
  h = app.html();
  assert.ok(/data-act="att-save"[^>]*aria-label="Save a copy of Run-book-v2\.pdf, \d+ bytes"/.test(h) && /data-act="att-open"[^>]*aria-label="Open deploy-output\.log, \d+ bytes"/.test(h), 'shown as named files with sizes');
  assert.ok(/Note added to this step\./.test(h) && /Note added to "Approve the deploy in Jenkins before it rolls back"\./.test(app.live()), 'acknowledged where it was added');
  // A text file opens as plain text: the dialog's markup never holds the file, the text goes in as textContent.
  const path = n.files[1];
  app.set('att-text', '');
  app.click('att-open', n.id, { from: 'note', path }); await app.tick(40);
  assert.ok(/<pre class="tp-text" id="att-text" tabindex="0"><\/pre>/.test(app.overlay()) && !/<script>/.test(app.overlay()), 'nothing from the file in the markup');
  assert.strictEqual(app.text('att-text'), 'pods restarted 0\n<script>alert(1)</script>\n');
  app.click('close-overlay'); await app.tick();
  app.set('att-text', 'untouched');
  app.click('att-open', n.id, { from: 'note', path: 'runs/release/other/files/secret.log' }); await app.tick(40);
  assert.strictEqual(app.overlay(), '', 'only files of that note open');
});

rule('App: a pasted or dropped file waits with the selected step\'s note, or with the correction being written', async () => {
  const app = await recordingRelease();
  app.click('select', 'approve'); await app.tick();
  app.fire('paste', { target: { closest: () => null }, clipboardData: { items: [{ kind: 'file', getAsFile: () => png('pasted.png') }, { kind: 'string' }] } }); await app.tick(40);
  assert.ok(/pasted\.png/.test(app.html()) && /Add note with 1 file/.test(app.html()), 'pasted into the note');
  const zone = kind => ({ closest: s => s === '[data-drop]' ? { getAttribute: k => (k === 'data-drop' ? kind : 'approve'), classList: { add() {}, remove() {}, contains: () => false } } : null });
  app.fire('drop', { target: zone('note'), dataTransfer: { types: ['Files'], files: [file('a,b\n1,2\n', 'text/csv', 'counts.csv')] } }); await app.tick(40);
  assert.ok(/counts\.csv/.test(app.html()) && /Add note with 2 files/.test(app.html()), 'dropped onto the note');
  app.click('corr-open', 'approve', { mode: 'correct' }); await app.tick();
  app.fire('drop', { target: zone('corr'), dataTransfer: { types: ['Files'], files: [file('x: 1\n', '', 'values.yaml')] } }); await app.tick(40);
  assert.ok(/data-scope="corr:approve" data-drop="corr"[\s\S]*values\.yaml/.test(app.html()), 'dropped onto the correction');
  app.input('corr-to', 'Approve the deploy in Jenkins within 30 minutes'); app.click('corr-save', 'approve'); await app.tick(60);
  const fx = notesOf(app).find(x => x.kind === 'correction' && x.step === 'approve');
  assert.ok(fx && fx.files.length === 1 && fx.fileInfo[fx.files[0]].name === 'values.yaml', 'the correction carries the file');
  assert.ok(/Add note with 2 files/.test(app.html()), 'the note\'s files still wait with the note');
});

/* ---------- Review fixes (1.13) ---------- */
rule('App: evidence typed on a step stays with it when you move away, marks its row as a draft, and keeps auto-advance from leaving it', async () => {
  const app = await recordingRelease();
  // Jenkins's build link saved with Fill in, not yet checked.
  app.click('pick', 'jenkins', { kind: 'fields' }); await app.tick();
  app.set('rec-build', 'https://ci.example.com/job/7/'); app.click('save-fields', 'jenkins'); await app.tick(40);
  app.click('select', 'pods'); await app.tick();
  app.set('rec-result', 'RESTARTS 0 on all three pods');
  app.click('toggle', 'jenkins'); await app.tick(40);
  assert.strictEqual(app.run().json.steps.jenkins.s, 'done', 'set-up: the next step was checked from its row');
  assert.strictEqual(app.selected(), 'pods', 'never moved away from a step holding typed evidence');
  app.click('select', 'approve'); await app.tick();
  const row = id => { const h = app.html(), at = h.indexOf(' id="step-' + id + '"'); return h.slice(at, h.indexOf('</li>', at)); };
  assert.ok(/<span class="s-draft">Draft<\/span>/.test(row('pods')) && !/s-draft/.test(row('approve')), 'the row says it holds a draft');
  app.click('select', 'pods'); await app.tick();
  assert.ok(/<textarea id="rec-result"[^>]*>RESTARTS 0 on all three pods<\/textarea>/.test(app.html()), 'back on the step, the evidence is still there');
  app.click('record', 'pods'); await app.tick(40);
  assert.strictEqual(app.run().json.steps.pods.values.result, 'RESTARTS 0 on all three pods');
  assert.ok(!/s-draft/.test(app.html()), 'once used, the draft is gone');
});

rule('App: an open Fill in comes back with its values after J or K, and Cancel drops it', async () => {
  const app = await recordingRelease();
  app.click('pick', 'approve', { kind: 'fields' }); await app.tick();
  app.set('fld-system', 'Jenkins (prod)'); app.set('rec-reference', 'APPROVAL-12');
  app.key('j'); await app.tick();
  assert.strictEqual(app.selected(), 'pods');
  app.key('k'); await app.tick();
  const h = app.html();
  assert.ok(/data-scope="fields:approve"/.test(h) && /id="fld-system"[^>]*value="Jenkins \(prod\)"/.test(h) && /id="rec-reference"[^>]*value="APPROVAL-12"/.test(h), 'Fill in reopens with what was typed');
  app.click('unpick'); await app.tick();
  app.click('select', 'pods'); app.click('select', 'approve'); await app.tick();
  assert.ok(!/APPROVAL-12/.test(app.html()), 'Cancel discards it');
});

rule('App: while Fill in is open, Done waits: the row\'s check and Space don\'t answer the step, and say why', async () => {
  const app = await recordingRelease();
  app.click('pick', 'approve', { kind: 'fields' }); await app.tick();
  app.set('rec-reference', 'APPROVAL-12');
  app.click('toggle', 'approve'); await app.tick(40);
  assert.ok(!app.run().json.steps.approve || app.run().json.steps.approve.s !== 'done', 'not checked with the form still open');
  assert.ok(/Save or cancel Fill in first/.test(app.html()), 'says why, next to Done');
  assert.strictEqual(app.draft('rec-reference'), 'APPROVAL-12', 'nothing typed is lost');
});

rule('App: Undo and Redo never lose text typed in a builder box and not applied; they say to apply or clear it first', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'flags'); await app.tick();
  app.click('ob-move', 'flags', { dir: 'up' }); await app.tick();
  app.input('ob-text', 'Ask @qa before continuing'); await app.tick();
  enter(app, 'ob-text', 'Ask @qa before continuing'); await app.tick();
  assert.ok(/role="alert">Choose roles and run details with their buttons/.test(app.html()), 'set-up: refused, still typed');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.strictEqual(app.draft('ob-text'), 'Ask @qa before continuing', 'the typing is kept');
  assert.ok(/Apply or clear what you typed/.test(app.html()), 'and Undo says why it waits');
  assert.deepStrictEqual([...new Set([...app.html().matchAll(/data-ob-step="([\w-]+)"/g)].map(m => m[1]))].slice(0, 3), ['approved', 'flags', 'tests'], 'the move is not undone');
});

rule('App: undoing an applied wording change back to the saved text leaves nothing unsaved', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Flags reworded'); await app.tick();
  enter(app, 'ob-text', 'Flags reworded'); await app.tick();
  assert.ok(/Unsaved: Save draft before you publish/.test(app.html()), 'set-up: changed');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()), 'back to saved, with no typing left pending');
});

rule('App: a part saved once keeps its ID even when Undo goes back past changes made before the save', async () => {
  const app = await builderOn();
  dragPart(app, 'step', 'before:rollback', 'step'); await app.tick();
  app.set('ob-text', 'Persistent step'); enter(app, 'ob-text', 'Persistent step'); await app.tick();
  app.check('ob-mark-must', true); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(/\{#persistent-step\}/.test(releaseText(app)), 'set-up: saved with its ID');
  app.click('tl-undo', 'draft'); await app.tick();
  app.click('ob-sel', 'persistent-step'); await app.tick();
  app.set('ob-text', 'Renamed saved step'); enter(app, 'ob-text', 'Renamed saved step'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(/Renamed saved step \{#persistent-step\}/.test(releaseText(app)), releaseText(app).split('\n').find(l => /Renamed/.test(l)));
});

rule('App: Cmd+Z in the parts search undoes the search text, not the checklist', async () => {
  const app = await builderOn();
  app.click('ob-del', 'rollback'); await app.tick();
  for (const id of ['ob-part-q', 'ob-part-q2']) {
    assert.ok(!cmdKey(app, 'z', { tagName: 'INPUT', id, type: 'search', value: 'jenkins', defaultValue: 'jenkins', dataset: {}, closest: () => null }), id + ': left to the browser');
  }
  await app.tick();
  assert.ok(!/data-ob-step="rollback"/.test(app.html()), 'the deletion stays');
});

rule('App: a part that was ever saved keeps its ID, even after it was deleted, saved, and brought back by Undo', async () => {
  const app = await builderOn();
  dragPart(app, 'step', 'before:rollback', 'step'); await app.tick();
  app.set('ob-text', 'Persistent step'); enter(app, 'ob-text', 'Persistent step'); await app.tick();
  app.check('ob-mark-must', true); await app.tick();
  app.click('save-draft'); await app.tick(80);
  app.click('ob-del', 'persistent-step'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(!/persistent-step/.test(releaseText(app)), 'set-up: deleted and saved');
  app.click('tl-undo', 'draft'); await app.tick(); app.click('tl-undo', 'draft'); await app.tick();
  app.click('ob-sel', 'persistent-step'); await app.tick();
  app.set('ob-text', 'Renamed saved step'); enter(app, 'ob-text', 'Renamed saved step'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(/Renamed saved step \{#persistent-step\}/.test(releaseText(app)), releaseText(app).split('\n').find(l => /Renamed/.test(l)));
});

/* A new type with a Choice field "Risk" open, and text typed in its Add an option box. Returns the field's key and box id. */
async function optionTyped(app, text) {
  app.input('tf-label', 'Risk review'); await settle(app);
  app.fire('focusout', { target: app.el('tf-label') });
  app.click('tf-add', 'f', { kind: 'choice' }); await app.tick();
  const k = /data-act="tf-open" data-id="f:(k\d+)"/.exec(app.html())[1], box = 'tf-f-' + k + '-optadd';
  app.input('tf-f-' + k + '-label', 'Risk'); await settle(app);
  app.fire('focusout', { target: app.el('tf-f-' + k + '-label') });
  app.set(box, text);
  return { k, box };
}
const optionsOf = app => { const f = typeDef(app).fields.risk; return f ? f.options || null : 'no field'; };

rule('App: leaving an Add an option box adds the option as one Undo step, whatever the person does next', async () => {
  const triggers = {
    'leaving the box': async (app, t) => app.fire('focusout', { target: app.el(t.box) }),
    'closing the field': async (app, t) => app.click('tf-open', 'f:' + t.k),
    'opening another field': async (app, t) => { app.click('tf-add', 'r'); await app.tick(); },
    'adding a field': async (app) => app.click('tf-add', 'f'),
    'adding evidence': async (app) => app.click('tf-add', 'r'),
    'Done': async (app) => app.click('type-done'),
    'Save': async (app) => app.click('type-save')
  };
  for (const [what, act] of Object.entries(triggers)) {
    const app = await newTypeOn(), t = await optionTyped(app, '  Ask QA first  ');
    await act(app, t); await app.tick(80);
    app.gone(t.box);
    assert.deepStrictEqual(optionsOf(app), ['Ask QA first'], what + ': added, trimmed');
    if (/changes that aren.t saved/.test(app.html())) { app.click('type-stay'); await app.tick(); }
    // Undo the steps that came after it (a new row), then the option itself.
    while (JSON.stringify(optionsOf(app)) === '["Ask QA first"]') { app.click('tl-undo', 'type'); await app.tick(); }
    assert.ok(!/Add or clear what you typed/.test(app.html()), what + ': Undo never waits');
    assert.deepStrictEqual(optionsOf(app), [], what + ': one Undo removes the option');
  }
});

rule('App: removing a field, changing its type, or Undo first add the option typed in it, so Undo can bring it back', async () => {
  let app = await newTypeOn(), t = await optionTyped(app, 'Ask QA first');
  app.click('tf-remove', 'f:' + t.k); await app.tick(); app.gone(t.box);
  assert.strictEqual(optionsOf(app), 'no field', 'removed');
  app.click('tl-undo', 'type'); await app.tick();
  assert.deepStrictEqual(optionsOf(app), ['Ask QA first'], 'Undo brings the field back with the option');

  app = await newTypeOn(); t = await optionTyped(app, 'Ask QA first');
  app.select('tf-f-' + t.k + '-kind', 'text'); await app.tick(); app.gone(t.box);
  app.click('tl-undo', 'type'); await app.tick();
  assert.deepStrictEqual(optionsOf(app), ['Ask QA first'], 'undoing the type change shows the option was added first');

  app = await newTypeOn(); t = await optionTyped(app, 'Ask QA first');
  app.click('tl-undo', 'type'); await app.tick();
  assert.ok(!/Add or clear what you typed/.test(app.html()), 'Undo never waits');
  assert.deepStrictEqual(optionsOf(app), [], 'Undo takes back the option it just added');
  app.click('tl-redo', 'type'); await app.tick();
  assert.deepStrictEqual(optionsOf(app), ['Ask QA first'], 'and Redo puts it back');
});

rule('App: an option typed into a field Save opened is added when the person leaves it, and undoes in one step', async () => {
  const app = await newTypeOn();
  app.input('tf-label', 'Risk review'); await settle(app);
  app.click('tf-add', 'f', { kind: 'choice' }); await app.tick();
  const k = /data-act="tf-open" data-id="f:(k\d+)"/.exec(app.html())[1], box = 'tf-f-' + k + '-optadd';
  app.input('tf-f-' + k + '-label', 'Risk'); await settle(app);
  app.click('tf-open', 'f:' + k); await app.tick();
  app.click('type-save'); await app.tick(40);
  assert.ok(new RegExp('id="' + box + '"').test(app.html()), 'set-up: Save opened the field to show what\'s missing');
  app.set(box, 'Low');
  app.click('tl-undo', 'type'); await app.tick(); app.gone(box);
  app.click('tl-redo', 'type'); await app.tick();
  assert.deepStrictEqual(optionsOf(app), ['Low'], 'nothing typed is lost');
});

rule('App: a tag typed and not added is added on leaving the box or typing a comma, as one Undo step; a repeat is left out', async () => {
  const app = await newTypeOn();
  app.input('tf-label', 'Risk review'); await settle(app);
  const tags = () => typeDef(app).tags || [];
  app.set('tf-tagadd', ' #cab '); app.fire('focusout', { target: app.el('tf-tagadd') }); await app.tick();
  assert.deepStrictEqual(tags(), ['cab'], 'leaving the box adds it');
  app.set('tf-tagadd', 'prod'); app.keyOn(',', {}, { tagName: 'INPUT', id: 'tf-tagadd', value: 'prod', dataset: {}, closest: () => null }); await app.tick();
  assert.deepStrictEqual(tags(), ['cab', 'prod'], 'a comma adds it');
  app.set('tf-tagadd', 'cab'); app.fire('focusout', { target: app.el('tf-tagadd') }); await app.tick();
  assert.deepStrictEqual(tags(), ['cab', 'prod'], 'a repeat is left out');
  app.click('tl-undo', 'type'); await app.tick();
  assert.deepStrictEqual(tags(), ['cab'], 'one Undo per tag');
});

/* ---------- Review round 2 (1.13) ---------- */
rule('App: Screen share by keyboard and back keeps evidence and a note typed on the step', async () => {
  const app = await recordingRelease();
  app.click('select', 'pods'); await app.tick();
  app.set('rec-result', 'RESTARTS 0'); app.set('note-text', 'Watched the dashboard');
  app.key('m'); await app.tick();
  assert.ok(/m-rec|exit-mission/.test(app.html()), 'set-up: screen share');
  app.key('m'); await app.tick();
  assert.ok(/<textarea id="rec-result"[^>]*>RESTARTS 0<\/textarea>/.test(app.html()) && /<textarea id="note-text"[^>]*>Watched the dashboard<\/textarea>/.test(app.html()));
});

rule('App: Done differently waits while Fill in is open, says why, and keeps what was typed', async () => {
  const app = await recordingRelease();
  app.click('select', 'approve'); await app.tick();
  app.click('corr-open', 'approve', { mode: 'differently' }); await app.tick();
  app.input('corr-happened', 'Approved from the phone app');
  app.click('pick', 'approve', { kind: 'fields' }); await app.tick();
  app.set('fld-system', 'Jenkins (phone)');
  app.click('corr-done', 'approve'); await app.tick(40);
  assert.ok((app.run().json.steps.approve || {}).s !== 'done', 'not answered');
  assert.ok(/Save or cancel Fill in first\./.test(app.html()));
  assert.strictEqual(app.draft('fld-system'), 'Jenkins (phone)');
  assert.ok(/data-scope="fields:approve"/.test(app.html()), 'Fill in is still open');
});

rule('App: a field cleared in Fill in stays cleared after J and K, and the row says Draft', async () => {
  const app = await recordingRelease();
  app.click('pick', 'approve', { kind: 'fields' }); await app.tick();
  assert.ok(/id="fld-system"[^>]*value="Jenkins"/.test(app.html()), 'set-up: the checklist says Jenkins');
  app.set('fld-system', '');
  app.key('j'); await app.tick();
  assert.ok(/id="step-approve"[\s\S]*?s-draft/.test(app.html().slice(app.html().indexOf('id="step-approve"'), app.html().indexOf('id="step-pods"'))), 'a cleared field is a draft');
  app.key('k'); await app.tick();
  assert.ok(/data-scope="fields:approve"/.test(app.html()) && /id="fld-system"[^>]*value=""/.test(app.html()), 'still cleared');
});

/* ---------- Review round 3 (1.13) ---------- */
rule('App: Done differently finishes against its run after you leave; if the step can\'t be answered, the run says so until you act', async () => {
  const app = await recordingRelease();
  const orig = app.PF.repo.addNote, g = gate();
  app.PF.repo.addNote = function () { const a = arguments; return g.p.then(() => orig.apply(this, a)); };
  app.click('select', 'approve'); await app.tick();
  app.click('corr-open', 'approve', { mode: 'differently' }); await app.tick();
  app.input('corr-happened', 'Approved from the phone app'); app.click('corr-scope', 'fix'); await app.tick();
  app.input('corr-to', 'Approve the deploy in Jenkins or its phone app before it rolls back');
  app.click('corr-done', 'approve'); await app.tick();
  app.click('home'); await app.tick();
  g.open(); await app.tick(80);
  app.PF.repo.addNote = orig;
  assert.strictEqual(app.run().json.steps.approve.s, 'done', 'answered, though the run was closed');
  assert.strictEqual(app.run().json.steps.approve.differently.note, 'Approved from the phone app');
  // When the answer can't land (here the run was paused meanwhile), the run keeps a notice until the person acts.
  const app2 = await recordingRelease(), g2 = gate(), add2 = app2.PF.repo.addNote;
  app2.PF.repo.addNote = function () { const a = arguments; return g2.p.then(() => add2.apply(this, a)); };
  app2.click('select', 'approve'); await app2.tick();
  app2.click('corr-open', 'approve', { mode: 'differently' }); await app2.tick();
  app2.input('corr-happened', 'Approved from the phone app'); app2.click('corr-scope', 'fix'); await app2.tick();
  app2.input('corr-to', 'Approve it in the phone app');
  app2.click('corr-done', 'approve'); await app2.tick();
  app2.click('pick', 'run', { kind: 'pause' }); await app2.tick(); app2.set('pick-input', 'Lunch'); app2.click('pause', 'run'); await app2.tick(40);
  g2.open(); await app2.tick(80);
  assert.ok(app2.run().json.paused && (app2.run().json.steps.approve || {}).s !== 'done', 'set-up: paused before the answer could land');
  app2.click('home'); await app2.tick(); app2.click('open-run', app2.run().key); await app2.tick(20);
  assert.ok(/Correction saved; the step wasn(&#39;|')t marked done\./.test(app2.html()) && /data-act="corr-open" data-mode="differently" data-id="approve">Mark it now/.test(app2.html()), 'a notice that stays on the run');
});

rule('App: while Done differently is finishing, Fill in waits and says why', async () => {
  const app = await recordingRelease(), g = gate(), orig = app.PF.repo.addNote;
  app.PF.repo.addNote = function () { const a = arguments; return g.p.then(() => orig.apply(this, a)); };
  app.click('select', 'approve'); await app.tick();
  app.click('corr-open', 'approve', { mode: 'differently' }); await app.tick();
  app.input('corr-happened', 'Approved from the phone app'); app.click('corr-scope', 'fix'); await app.tick();
  app.input('corr-to', 'Approve it in the phone app');
  app.click('corr-done', 'approve'); await app.tick();
  assert.ok(/data-kind="fields" data-id="approve" disabled aria-describedby="fillwhy-approve"/.test(app.html()) && /Finishing the answer…/.test(app.html()));
  app.click('pick', 'approve', { kind: 'fields' }); await app.tick();
  assert.ok(!/data-scope="fields:approve"/.test(app.html()), 'Fill in doesn\'t open');
  g.open(); await app.tick(80); app.PF.repo.addNote = orig;
  assert.strictEqual(app.run().json.steps.approve.s, 'done');
  assert.ok(!/fillwhy-approve/.test(app.html()));
});

rule('App: choosing an open composer\'s button again keeps what was typed and just focuses it', async () => {
  const app = await recordingRelease();
  app.click('select', 'approve'); await app.tick();
  app.click('corr-open', 'approve', { mode: 'differently' }); await app.tick();
  app.input('corr-happened', 'Approved from the phone app');
  app.click('corr-open', 'approve', { mode: 'differently' }); await app.tick();
  assert.ok(/<textarea id="corr-happened"[^>]*>Approved from the phone app<\/textarea>/.test(app.html()) && app.focused() === 'corr-happened');
  app.click('corr-open', 'approve', { mode: 'correct' }); await app.tick();
  assert.ok(/<h4 class="corr-h" id="corr-h">Correct this step/.test(app.html()), 'the other composer still opens');
});

/* ---------- Review round 4 (1.13): one answer path ---------- */
rule('App: Done differently landing on one step leaves another step\'s open Fill in and its edits alone', async () => {
  const app = await recordingRelease(), g = gate(), orig = app.PF.repo.addNote;
  app.PF.repo.addNote = function () { const a = arguments; return g.p.then(() => orig.apply(this, a)); };
  app.click('select', 'approve'); await app.tick();
  app.click('corr-open', 'approve', { mode: 'differently' }); await app.tick();
  app.input('corr-happened', 'Approved from the phone app'); app.click('corr-scope', 'fix'); await app.tick();
  app.input('corr-to', 'Approve it in the phone app'); app.click('corr-done', 'approve'); await app.tick();
  app.click('select', 'pods'); await app.tick();
  app.click('pick', 'pods', { kind: 'fields' }); await app.tick();
  app.set('fld-command', 'kubectl get pods -n web');
  g.open(); await app.tick(80); app.PF.repo.addNote = orig;
  assert.strictEqual(app.run().json.steps.approve.s, 'done', 'set-up: the answer landed');
  assert.ok(/data-scope="fields:pods"/.test(app.html()), 'Pods\' Fill in is still open');
  app.click('select', 'jenkins'); await app.tick(); app.click('select', 'pods'); await app.tick();
  assert.ok(/id="fld-command"[^>]*(value="kubectl get pods -n web"|>kubectl get pods -n web<)/.test(app.html()), 'and its edit is kept');
});

rule('App: checking a row answers that step with its own typed evidence, and waits for its unsaved Fill in, whatever is selected', async () => {
  const app = await recordingRelease();
  app.click('select', 'pods'); await app.tick();
  app.set('rec-result', 'RESTARTS 0 @pods');
  app.click('select', 'approve'); await app.tick();
  app.click('pick', 'approve', { kind: 'fields' }); await app.tick();
  app.set('fld-system', 'Jenkins (phone)');
  app.click('select', 'jenkins'); await app.tick();
  app.click('toggle', 'approve'); await app.tick(40);
  assert.ok((app.run().json.steps.approve || {}).s !== 'done' && /Save or cancel Fill in first\./.test(app.html() + app.live()), 'Approve waits for its Fill in');
  app.click('toggle', 'pods'); await app.tick(40);
  assert.strictEqual(app.run().json.steps.pods.values.result, 'RESTARTS 0 @pods', 'Pods carries what was typed on Pods');
  app.click('select', 'approve'); await app.tick();
  assert.ok(/id="fld-system"[^>]*value="Jenkins \(phone\)"/.test(app.html()), 'Approve\'s Fill in edit is still there');
});

rule('App: drafts belong to their team folder; another folder with the same run never shows them', async () => {
  const app = await recordingRelease();
  app.click('select', 'pods'); await app.tick();
  app.set('note-text', 'Only in folder A');
  app.click('select', 'approve'); await app.tick();
  const id = app.fs.id; app.fs.id = id + '-copy';
  app.click('select', 'pods'); await app.tick();
  assert.ok(!/Only in folder A/.test(app.html()) && !/s-draft/.test(app.html()), 'not in the other folder');
  app.click('select', 'approve'); await app.tick(); app.fs.id = id;
  app.click('select', 'pods'); await app.tick();
  assert.ok(/<textarea id="note-text"[^>]*>Only in folder A<\/textarea>/.test(app.html()), 'still there in its own folder');
});

/* ---------- 1.13.1 ---------- */
rule('App: Fill in starts from the evidence typed on the step, and saving it keeps that evidence', async () => {
  const app = await recordingRelease();
  app.click('select', 'pods'); await app.tick();
  app.set('rec-result', 'RESTARTS 0');
  app.click('pick', 'pods', { kind: 'fields' }); await app.tick();
  assert.ok(/data-scope="fields:pods"/.test(app.html()) && /id="rec-result"[^>]*(value="RESTARTS 0"|>RESTARTS 0<)/.test(app.html()), 'Fill in shows what was typed');
  app.set('fld-command', 'kubectl get pods -n web'); app.click('save-fields', 'pods'); await app.tick(40);
  assert.strictEqual(app.run().json.steps.pods.values.result, 'RESTARTS 0', 'saved with the Fill in');
  app.click('toggle', 'pods'); await app.tick(40);
  const a = app.run().json.steps.pods;
  assert.deepStrictEqual([a.s, a.values.result], ['done', 'RESTARTS 0'], 'Done records it');
});

rule('App: Done differently whose run save is refused as a conflict says the step wasn\'t marked done, never that it was saved', async () => {
  const app = await recordingRelease();
  const orig = app.PF.repo.addNote, g = gate();
  app.PF.repo.addNote = function () { const a = arguments; return g.p.then(() => orig.apply(this, a)); };
  app.click('select', 'approve'); await app.tick();
  app.click('corr-open', 'approve', { mode: 'differently' }); await app.tick();
  app.input('corr-happened', 'Approved from the phone app'); app.click('corr-scope', 'fix'); await app.tick();
  app.input('corr-to', 'Approve it in the phone app'); app.click('corr-done', 'approve'); await app.tick();
  // Another computer saves the run while the correction is being written.
  const r = app.run(), other = JSON.parse(JSON.stringify(r.json)); other.title = 'Saved elsewhere'; other.rev = (other.rev || 0) + 5;
  await app.fs.write(r.path, JSON.stringify(other));
  g.open(); await app.tick(120); app.PF.repo.addNote = orig;
  assert.ok((app.run().json.steps.approve || {}).s !== 'done', 'set-up: the step isn\'t answered on disk');
  const said = app.html() + app.live();
  assert.ok(!/Saved on this computer/.test(said), 'no success message');
  assert.ok(/Correction saved; the step wasn(&#39;|')t marked done\./.test(app.html()) && /data-act="corr-open" data-mode="differently" data-id="approve">Mark it now/.test(app.html()), 'the notice with Mark it now');
  app.click('home'); await app.tick(); app.click('open-run', app.run().key); await app.tick(20);
  assert.ok(/Correction saved; the step wasn(&#39;|')t marked done\./.test(app.html()), 'and it stays after reopening');
});

rule('App: a row check or Done refused as a conflict ends on the conflict message, not on "checked"', async () => {
  for (const act of ['toggle', 'record']) {
    const app = await recordingRelease();
    app.click('select', 'pods'); await app.tick();
    const r = app.run(), other = JSON.parse(JSON.stringify(r.json)); other.title = 'Saved elsewhere'; other.rev = (other.rev || 0) + 5;
    await app.fs.write(r.path, JSON.stringify(other));
    app.click(act, 'pods'); await app.tick(120);
    assert.ok((app.run().json.steps.pods || {}).s !== 'done', act + ': set-up: not answered on disk');
    assert.ok(/saved this run from another window or computer/.test(app.html()) && !/checked\. Next:/.test(app.live()), act + ': the conflict is what\'s said last');
  }
});

rule('App: evidence typed just before the team folder changes stays with its own folder and comes back there', async () => {
  const app = await recordingRelease();
  assert.strictEqual(app.selected(), 'jenkins', 'set-up: Jenkins is selected');
  app.set('rec-build', '#481 @jenkins');
  const id = app.fs.id; app.fs.id = id + '-b';
  app.click('select', 'jenkins'); await app.tick();
  assert.ok(!/#481 @jenkins/.test(app.html()) && !/s-draft/.test(app.html()), 'not shown in the other folder');
  app.fs.id = id; app.click('select', 'jenkins'); await app.tick();
  assert.ok(/id="rec-build"[^>]*(value="#481 @jenkins"|>#481 @jenkins<)/.test(app.html()), 'back in its own folder, the box still holds it');
});

rule('App: unchecking a step after the team folder changed and back shows the evidence it was checked with, and checking it again keeps it', async () => {
  const app = await recordingRelease();
  app.set('rec-build', '#481 @jenkins'); app.click('toggle', 'jenkins'); await app.tick(40);
  assert.strictEqual(app.run().json.steps.jenkins.values.build, '#481 @jenkins', 'set-up: checked with it');
  const id = app.fs.id; app.fs.id = id + '-b';
  app.click('select', 'jenkins'); await app.tick();
  app.fs.id = id; app.click('select', 'jenkins'); await app.tick();
  app.click('toggle', 'jenkins'); await app.tick(40);
  assert.ok(app.run().json.steps.jenkins.s !== 'done', 'set-up: unchecked');
  assert.ok(/id="rec-build"[^>]*value="#481 @jenkins"/.test(app.html()) && app.draft('rec-build') === '#481 @jenkins', 'the box shows it');
  app.click('select', 'approve'); await app.tick(); app.click('toggle', 'jenkins'); await app.tick(40);
  assert.deepStrictEqual([app.run().json.steps.jenkins.s, app.run().json.steps.jenkins.values.build], ['done', '#481 @jenkins'], 'checked again with it, not with an empty box');
});

/* A seeded walk through the run: whatever order things happen in, what's typed on a step is never lost and never lands on
   another step. Values carry their step's ID, so a value on the wrong step is caught. */
rule('App: random sequences of selecting, typing evidence, Fill in, checking, Done differently with held writes, moving and switching folders never lose or misplace typed values', async () => {
  const STEPS = ['jenkins', 'approve', 'pods'], EV = { jenkins: 'rec-build', pods: 'rec-result' };
  for (let seed = 1; seed <= (+process.env.TYPED_SEEDS || 6); seed++) {
    let x = seed * 9301 + 49297; const rnd = n => { x = (x * 9301 + 49297) % 233280; return Math.floor(x / 233280 * n); };
    const app = await recordingRelease();
    const typed = {}; let held = null, orig = app.PF.repo.addNote, n = 0;
    const sel = () => app.selected();
    const check = what => {
      const j = app.run().json;
      STEPS.forEach(st => { const v = (j.steps[st] || {}).values || {}; Object.keys(v).forEach(k => { if (/@\w+/.test(v[k])) assert.ok(v[k].endsWith('@' + st), 'seed ' + seed + ' after ' + what + ': ' + st + ' has ' + v[k]); }); });
    };
    for (let step = 0; step < 30; step++) {
      const op = rnd(9), st = STEPS[rnd(3)];
      if (op === 0) { app.click('select', st); await app.tick(); }
      else if (op === 1 && sel() && EV[sel()] && new RegExp('id="' + EV[sel()] + '"').test(app.html()) && !/data-scope="fields:/.test(app.html())) { const v = 'v' + (++n) + ' @' + sel(); app.set(EV[sel()], v); typed[sel()] = v; }
      else if (op === 2 && sel()) { app.click('pick', sel(), { kind: 'fields' }); await app.tick(); }
      else if (op === 3) { app.click('unpick'); await app.tick(); }
      else if (op === 4) { app.click('toggle', st); await app.tick(40); }
      else if (op === 5 && sel() && !held && /data-mode="differently" data-id="/.test(app.html())) {
        const s0 = sel(); held = gate(); const h = held;
        app.PF.repo.addNote = function () { const a = arguments; return h.p.then(() => orig.apply(this, a)); };
        app.click('corr-open', s0, { mode: 'differently' }); await app.tick();
        if (/id="corr-happened"/.test(app.html())) { app.input('corr-happened', 'Did it another way @' + s0); app.click('corr-scope', 'fix'); await app.tick(); app.input('corr-to', 'Another way for ' + s0 + ' ' + n); app.click('corr-done', s0); await app.tick(); }
      }
      else if (op === 6 && held) { held.open(); held = null; app.PF.repo.addNote = orig; await app.tick(80); }
      else if (op === 7) { const k = app.run().key; app.click('home'); await app.tick(); app.click('open-run', k); await app.tick(20); }
      else if (op === 8) { const id = app.fs.id; app.fs.id = id + '-b'; app.click('select', st); await app.tick(); assert.ok(!/s-draft/.test(app.html()), 'seed ' + seed + ': no drafts from another folder'); app.fs.id = id; app.click('select', st); await app.tick(); }
      check('op ' + op);
    }
    if (held) { held.open(); app.PF.repo.addNote = orig; await app.tick(80); }
    check('the end');
    // Every value typed on a step that isn't answered yet is still in its box.
    const j = app.run().json;
    for (const st of Object.keys(typed)) {
      if ((j.steps[st] || {}).s === 'done') { const v = (j.steps[st].values || {})[EV[st].slice(4)]; if (v && /@/.test(v)) assert.ok(v.endsWith('@' + st)); continue; }
      app.click('unpick'); await app.tick(); app.click('select', st); await app.tick();
      const h = app.html(), box = h.slice(h.indexOf('id="' + EV[st] + '"'), h.indexOf('id="' + EV[st] + '"') + 400);
      assert.ok(box.includes(typed[st].replace(/@/g, '@')), 'seed ' + seed + ': ' + st + ' still holds ' + typed[st]);
    }
  }
});

rule('App: Start your team on an empty folder: a write test, people with IDs and roles, the contract, a first checklist owned by you, a run, and a second person', async () => {
  const { example } = require('./harness'), cli = require('../bin/flightdeck.js');
  const written = [], files = new Proxy({}, { set(t, k, v) { written.push(k); t[k] = v; return true; } });
  const dir = folderHandle('Team', files);
  const app = boot({ picker: dir, indexedDB: memoryIDB(), firstRun: true });
  await app.tick(60);
  assert.ok(/Start your team/.test(app.html()) && /Look around the examples/.test(app.html()) && !/At a glance/.test(app.html()), 'the welcome, not the examples');
  app.click('setup-mode', 'start'); await app.tick();
  assert.ok(/Choose the team folder/.test(app.html()));
  app.click('setup-pick'); await app.tick(80);
  assert.ok(written.some(k => /^\.flightdeck\/write-test-[a-z0-9]+\.tmp$/.test(k)), 'a test file was written');
  assert.deepStrictEqual(Object.keys(files).filter(k => !k.endsWith('/')), [], 'and removed');
  assert.ok(/Flightdeck can save files in <b>Team<\/b>/.test(app.html()));
  app.click('setup-next', 'people'); await app.tick();
  app.input('su-me-name', 'Riley Park'); app.input('su-name-t1', 'Sam Fox');
  app.click('setup-add-row'); await app.tick(); app.input('su-name-t2', 'Sam Fox');
  app.select('su-backup', 't1'); await app.tick();
  assert.ok(/person-sam-fox-2/.test(app.html()), 'IDs shown before saving');
  app.submit('setup-people-form'); await app.tick(300);
  const ppl = JSON.parse(files['people.json']);
  assert.deepStrictEqual(ppl.map(p => [p.id, p.folderRole || '']), [['person-riley-park', 'owner'], ['person-sam-fox', 'backup'], ['person-sam-fox-2', '']]);
  assert.strictEqual(app.store['preflight:me'], '"person-riley-park"');
  assert.ok(/## Team notes/.test(files['AGENTS.md']) && files['AGENTS.md'].indexOf('<!-- flightdeck:begin -->') === 0);
  const rec = JSON.parse(files['.flightdeck/installed.json']), keys = Object.keys(files).filter(k => k === 'AGENTS.md' || k.startsWith('.flightdeck/skills/')).sort();
  assert.strictEqual(rec.by, 'app'); assert.strictEqual(rec.format, 'flightdeck-installed/1');
  assert.strictEqual(rec.version, cli.versionOf(require('fs').readFileSync(require('path').join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8')));
  assert.deepStrictEqual(Object.keys(rec.files).sort(), keys);
  keys.forEach(k => assert.strictEqual(rec.files[k], cli.hash(cli.managed(k, files[k])), k + ': the app and the command hash it the same way'));
  assert.ok(!Object.keys(files).some(k => k.startsWith('maps/')), 'no checklist until one is chosen');
  assert.ok(/Your first checklist/.test(app.html()) && /Sam Fox is its backup owner/.test(app.html()));
  app.click('setup-tpl', 'check-in'); await app.tick();
  app.click('setup-publish', 'check-in'); await app.tick(300);
  const md = files['maps/drafts/check-in.md'];
  assert.strictEqual(md, example('maps/drafts/check-in.md').replace(/^owner: .*$/m, 'owner: person-riley-park').replace('roles: author, reviewer\n---', 'roles: author, reviewer\nbackup: person-sam-fox\n---'), 'only the owner and backup lines differ from the starter');
  const pubInfo = Object.keys(files).find(k => /^publications\/check-in\/v1-[^/]+\/publication\.json$/.test(k));
  assert.ok(pubInfo && /First version/.test(files[pubInfo]), 'published as v1, "First version"');
  assert.ok(/is published/.test(app.html()));
  app.click('setup-next', 'run'); await app.tick();
  app.click('setup-run', 'check-in'); await app.tick();
  assert.ok(/aria-checked="true" data-act="start-mode" data-id="solo"/.test(app.html()), 'the start form, on my own');
  app.submitForm('start-form'); await app.tick(200);
  const runPath = Object.keys(files).find(k => /^runs\/check-in\/[^/]+\/run\.json$/.test(k));
  assert.ok(runPath, 'the run started');
  app.click('nav', 'home'); await app.tick(40);
  assert.ok(/Getting started · 3 of 5/.test(app.html()), 'three steps done');
  // The run finishes (as its recorder's window writes it), and Sam answers a connection check from another computer.
  const P = app.PF, R = P.run, r = JSON.parse(files[runPath]), map = R.mapOf(r), now = new Date().toISOString();
  map.phases.forEach((ph, pi) => { ph.steps.forEach(st => { const v = {}; R.evidenceFor(r, st).list.forEach(d => { if (d.required) v[d.name] = d.kind === 'url' ? 'https://example.com/1' : 'ok'; }); R.done(r, map, st.id, 'person-riley-park', now, v); }); R.pass(r, map, pi, 'person-riley-park', now); });
  R.end(r, map, 'Completed', 'person-riley-park', 'Riley Park', now); r.rev = (r.rev || 0) + 1;
  files[runPath] = JSON.stringify(r);
  app.click('refresh'); await app.tick(200);
  assert.ok(/Getting started · 4 of 5/.test(app.html()) && /data-act="setup-continue" data-id="second"/.test(app.html()));
  const t0 = new Date(Date.now() - 3600000).toISOString();
  files['connection/ack-abcd1234.wsam.json'] = JSON.stringify(P.connection.ack({ probe: 'abcd1234', probeFile: 'probe-x', by: 'person-sam-fox', writer: 'wsam', device: 'Windows · Edge', at: t0, firstSeenAt: t0, app: '1.15.0', run: null, folderReadAt: t0 }));
  app.click('refresh'); await app.tick(200);
  assert.ok(/Your team is set up/.test(app.html()), 'an answer from Sam, even an hour old, completes it');
  app.click('setup-hide'); await app.tick();
  assert.ok(!/Your team is set up|Getting started/.test(app.html()), 'hidden in this browser');
  assert.ok(!Object.keys(files).some(k => /write-test/.test(k)));
});

rule('App: the welcome shows once; Look around remembers the examples, and the examples banner leads back', async () => {
  const app = boot({ firstRun: true }); await app.tick(60);
  assert.ok(/Join your team's folder/.test(app.html()));
  app.click('setup-mode', 'examples'); await app.tick();
  assert.ok(/At a glance/.test(app.html()) && /data-act="setup-mode" data-id="welcome"/.test(app.html()));
  assert.strictEqual(app.store['preflight:look-around'], 'true');
  app.click('setup-mode', 'welcome'); await app.tick();
  assert.ok(/Start your team/.test(app.html()));
});

rule('App: joining opens the folder and asks who you are; nothing is written, and someone not listed copies a request', async () => {
  const { example } = require('./harness');
  const files = { 'people.json': example('people.json').replace('"person-morgan", "name": "Morgan Diaz", "initials": "MD", "email": "morgan@example.com"', '"person-morgan", "name": "Morgan Diaz", "initials": "MD", "email": "morgan@example.com", "inactive": true'), 'maps/drafts/check-in.md': example('maps/drafts/check-in.md') };
  const before = JSON.stringify(files), dir = folderHandle('Team', files);
  const app = boot({ picker: dir, indexedDB: memoryIDB(), firstRun: true }); await app.tick(60);
  app.click('setup-mode', 'join'); await app.tick();
  app.click('setup-open'); await app.tick(200);
  const html = app.html();
  assert.ok(/Who are you\?/.test(html) && /data-act="setup-who" data-id="person-casey"/.test(html) && !/data-id="person-morgan"/.test(html), 'active people only');
  app.input('su-rq-name', 'Jordan Fox'); await app.tick();
  assert.ok(/Ask Avery Lee to add you/.test(app.html()) && /Name: Jordan Fox/.test(app.html()));
  app.click('setup-who', 'person-casey'); await app.tick();
  assert.strictEqual(app.store['preflight:me'], '"person-casey"');
  assert.ok(/Hi, Casey/.test(app.html()) && !/Getting started/.test(app.html()), 'a member never sees Getting started');
  app.click('nav', 'settings'); await app.tick();
  assert.ok(!/people-add-form|data-act="people-/.test(app.html()), 'a member gets no people changes');
  assert.strictEqual(JSON.stringify(files), before, 'joining wrote nothing');
});

rule('App: Settings, People: the folder owner adds (-2 on a clash), marks inactive and picks a backup; a changed people.json is never saved over', async () => {
  const { example } = require('./harness');
  const files = { 'people.json': example('people.json') }, dir = folderHandle('Team', files);
  const app = boot({ picker: dir, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.choose('person-avery'); await app.tick();
  app.click('nav', 'settings'); await app.tick();
  app.input('pa-name', 'Casey'); await app.tick();
  assert.ok(/person-casey-2/.test(app.html()));
  app.submit('people-add-form'); await app.tick(200);
  let list = JSON.parse(files['people.json']);
  assert.deepStrictEqual(list.slice(0, 4), JSON.parse(example('people.json')), 'everyone already there is untouched');
  assert.strictEqual(list[4].id, 'person-casey-2');
  app.click('people-active', 'person-morgan', { on: '' }); await app.tick(200);
  app.click('people-backup', 'person-casey'); await app.tick(200);
  list = JSON.parse(files['people.json']);
  assert.strictEqual(list[3].inactive, true);
  assert.deepStrictEqual(list.map(p => p.folderRole || ''), ['owner', '', 'backup', '', '']);
  files['people.json'] = files['people.json'].replace('Blake Ortiz', 'Blake O.');
  const theirs = files['people.json'];
  app.click('people-active', 'person-morgan', { on: '1' }); await app.tick(200);
  assert.strictEqual(files['people.json'], theirs, 'refused: the file changed since the page was drawn');
  assert.ok(/changed since this page was drawn/.test(app.html()) && /Blake O\./.test(app.html()), 'says so and shows the list as it is now');
  app.click('people-active', 'person-morgan', { on: '1' }); await app.tick(200);
  assert.ok(!JSON.parse(files['people.json'])[3].inactive, 'the same change made again goes through');
  app.choose('person-blake'); await app.tick();
  assert.ok(!/people-add-form/.test(app.html()));
  app.click('people-backup', 'person-morgan'); await app.tick(100);
  assert.ok(!/"folderRole": "backup"[^}]*person-morgan|person-morgan[^}]*"folderRole": "backup"/.test(files['people.json']), 'a member\'s change is refused');
});

/* ---------- Folder health, the connection check, When something goes wrong (1.15) ---------- */
rule('App: Folder health reads the folder, lists a conflict copy under Needs action, and its one button opens the run; Home says so too', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const run = app.run();
  await app.fs.write(run.path.replace('run.json', 'run.conflict-wx-1.json'), JSON.stringify(run.json));
  app.click('nav', 'settings'); await app.tick();
  assert.ok(/data-act="health">Check folder health/.test(app.html()));
  app.click('health'); await app.tick(200);
  let html = app.html();
  assert.ok(/Folder health<\/h1>/.test(html) && /Needs action · 1/.test(html) && /All clear ·/.test(html), 'scanned and grouped');
  assert.ok(/files in /.test(html) && /What's in the folder/.test(html));
  assert.ok(new RegExp('data-act="open-run" data-id="' + run.key.replace('/', '\\/') + '">Compare copies').test(html));
  app.click('nav', 'home'); await app.tick();
  assert.ok(/The team folder needs attention/.test(app.html()) && /data-act="health"/.test(app.html()), 'Home line');
  app.click('open-run', run.key); await app.tick(40);
  assert.ok(/data-act="recovery" data-id="a-run-has-conflict-copies">What to do/.test(app.html()));
});

rule('App: What to do opens that section of the guide in the app, and Back returns to the run', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(40);
  app.click('recovery', 'a-run-has-conflict-copies'); await app.tick();
  const html = app.html();
  assert.ok(/When something goes wrong<\/h1>/.test(html) && /class="panel rv-sec on" id="rv-a-run-has-conflict-copies"/.test(html), 'the guide, at that section');
  assert.ok(/Back to the run/.test(html) && app.focused() === 'rv-h-a-run-has-conflict-copies', 'its heading takes focus');
  assert.ok(/aria-current="page">Settings</.test(app.top()), 'it belongs to Settings');
  app.click('recovery-back'); await app.tick(40);
  assert.ok(/class="fpe rw"/.test(app.html()) && /Release 2026\.10\.16/.test(app.html()), 'back on the run');
});

rule('App: a run file that stops parsing stays on screen as last read, the Runs page lists it, and Folder health needs action', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const run = app.run();
  await app.fs.write(run.path, '{"format":"preflight-run/2","id":');
  app.click('nav', 'runs'); await app.tick(); app.click('refresh'); await app.tick(80);
  const html = app.html();
  assert.ok(/A run file can't be read/.test(html) && html.indexOf(run.path) >= 0, 'listed by its file');
  assert.ok(/Release 2026\.10\.16/.test(html), 'the run is still shown, as last read');
  app.click('health'); await app.tick(200);
  assert.ok(/A run file can(&#39;|')t be read/.test(app.html()) && /data-id="a-file-cant-be-read">What to do/.test(app.html()));
});

rule('App: a connection check from one window is answered with one click in another, and the sender sees the answer timed', async () => {
  const files = {};
  const a = boot({ sharedFiles: files }); await a.tick(60);
  const b = boot({ sharedFiles: files }); await b.tick(60);
  a.choose('person-casey'); b.choose('person-blake'); await a.tick(); await b.tick();
  a.click('connection'); await a.tick(40);
  assert.ok(/Connection check<\/h1>/.test(a.html()) && /data-act="conn-send"/.test(a.html()));
  a.click('conn-send'); await a.tick(60);
  const probe = Object.keys(files).filter(k => /^connection\/probe-/.test(k));
  assert.strictEqual(probe.length, 1, 'one check file');
  const rec = JSON.parse(files[probe[0]].t);
  assert.ok(rec.kind === 'connection-probe' && rec.cv === 1 && rec.n === 1 && rec.by === 'person-casey' && rec.run && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(rec.run.key), JSON.stringify(rec));
  assert.ok(/Check 1/.test(a.html()) && /Waiting/.test(a.html()));
  // B is on Home: its next refresh finds the check and offers Answer; nothing is answered by itself there.
  b.click('refresh'); await b.tick(60);
  assert.ok(/Casey Nguyen is checking the connection/.test(b.html()) && /data-act="conn-answer"/.test(b.html()));
  assert.strictEqual(Object.keys(files).filter(k => /^connection\/ack-/.test(k)).length, 0, 'not answered without a click');
  b.click('conn-answer', probe[0].split('/')[1]); await b.tick(60);
  const ack = Object.keys(files).filter(k => /^connection\/ack-/.test(k));
  assert.strictEqual(ack.length, 1);
  const ar = JSON.parse(files[ack[0]].t);
  assert.ok(ar.probe === rec.id && ar.by === 'person-blake' && ar.firstSeenAt && ar.run && ar.run.key === rec.run.key);
  assert.ok(!/data-act="conn-answer"/.test(b.html()), 'answered: the banner goes');
  // A lists connection/ every 5 seconds on that page.
  await new Promise(r => setTimeout(r, 5100)); a.every(); await a.tick(60);
  assert.ok(/saw check 1 at/.test(a.html()) && /Their answer reached this computer/.test(a.html()) && /class="cx-route"/.test(a.html()));
});

rule('App: on the Connection check page, checks from other windows are answered by themselves', async () => {
  const files = {};
  const a = boot({ sharedFiles: files }); await a.tick(60);
  const b = boot({ sharedFiles: files }); await b.tick(60);
  a.choose('person-casey'); b.choose('person-blake'); await a.tick(); await b.tick();
  b.click('connection'); await b.tick(40);
  a.click('connection'); await a.tick(40); a.click('conn-send'); await a.tick(60);
  await new Promise(r => setTimeout(r, 5100)); b.every(); await b.tick(80);
  assert.strictEqual(Object.keys(files).filter(k => /^connection\/ack-/.test(k)).length, 1, 'B answered by itself');
  assert.ok(/You answered at/.test(b.html()));
});

/* A clock the test moves forward, for what happens minutes later. */
function clock() { let off = 0; class D extends Date { constructor(...a) { if (a.length) super(...a); else super(Date.now() + off); } static now() { return Date.now() + off; } } return { D, ahead(ms) { off += ms; } }; }

rule('App: a run whose own file stops reading says so in the run workspace, and changes to it are refused, not saved over it', async () => {
  const app = await recordingRelease();
  const run = app.run();
  await app.fs.write(run.path, '{"format":"preflight-run/2","id":');
  app.click('refresh'); await app.tick(80);
  let html = app.html();
  assert.ok(/class="fpe rw"/.test(html) && /couldn't be read on the last check/.test(html) && /data-act="recovery" data-id="a-file-cant-be-read"/.test(html), 'said in the run workspace');
  const step = Object.keys(run.json.steps).find(k => run.json.steps[k].s === 'open') || 'announce';
  app.click('na', step); await app.tick(40);
  assert.strictEqual(app.fs.files[run.path].t, '{"format":"preflight-run/2","id":', 'nothing written over it');
  assert.ok(/wasn(&#39;|')t changed/.test(app.html()) && !/Your last change isn't saved/.test(app.html()), 'refused before changing anything');
});

rule('App: when part of the folder can\'t be read, the run workspace says so too', async () => {
  const app = await recordingRelease();
  const list = app.fs.list.bind(app.fs);
  app.fs.list = p => p === 'runs' ? Promise.reject(new Error('NotReadableError')) : list(p);
  app.click('refresh'); await app.tick(80);
  assert.ok(/Part of the team folder couldn't be read/.test(app.html()) && /class="fpe rw"/.test(app.html()));
  app.click('na', 'announce'); await app.tick(40);
  assert.ok(/wasn(&#39;|')t changed/.test(app.html()), 'runs weren\'t read this time: changes wait');
});

rule('App: a draft that can\'t be read stays as last read, says so, and isn\'t edited or saved over', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const read = app.fs.read.bind(app.fs);
  app.fs.read = p => p === 'maps/drafts/release.md' ? Promise.reject(new Error('NotReadableError')) : read(p);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  const html = app.html();
  assert.ok(!/wasn't found/.test(html) && /Production release/.test(html), 'still there');
  assert.ok(/release\.md couldn't be read on the last check/.test(html), 'marked unreadable');
  app.click('ptab', 'edit'); await app.tick();
  assert.ok(!/fpe-on/.test(app.bodyClasses().join(' ')) && /isn(&#39;|')t edited until it can be read/.test(app.html()), 'not opened for editing');
});

rule('App: an answer from a window that couldn\'t read the run says its revision is unknown', async () => {
  const files = {};
  const a = boot({ sharedFiles: files }); await a.tick(60);
  const b = boot({ sharedFiles: files }); await b.tick(60);
  a.choose('person-casey'); b.choose('person-blake'); await a.tick(); await b.tick();
  a.click('connection'); await a.tick(40); a.click('conn-send'); await a.tick(60);
  const probe = JSON.parse(files[Object.keys(files).find(k => /^connection\/probe-/.test(k))].t);
  const read = b.fs.read.bind(b.fs);
  b.fs.read = p => /^runs\//.test(p) && /run\.json$/.test(p) ? Promise.reject(new Error('NotReadableError')) : read(p);
  b.click('refresh'); await b.tick(80);
  b.click('conn-answer', Object.keys(files).find(k => /^connection\/probe-/.test(k)).split('/')[1]); await b.tick(60);
  const ack = JSON.parse(files[Object.keys(files).find(k => /^connection\/ack-/.test(k))].t);
  assert.ok(ack.run && ack.run.key === probe.run.key && ack.run.unknown === true, JSON.stringify(ack.run));
});

rule('App: the hints appear on their own when a check has waited 3 minutes, and an answered check stays answered after 15', async () => {
  const c = clock(), files = {};
  const a = boot({ sharedFiles: files, Date: c.D }); await a.tick(60);
  const b = boot({ sharedFiles: files, Date: c.D }); await b.tick(60);
  a.choose('person-casey'); b.choose('person-blake'); await a.tick(); await b.tick();
  a.click('connection'); await a.tick(40); a.click('conn-send'); await a.tick(60);
  assert.ok(!/Things to look at/.test(a.html()));
  c.ahead(190000); a.every(); await a.tick(60);
  assert.ok(/Things to look at/.test(a.html()), 'hints once 3 minutes pass, without a new file');
  b.click('refresh'); await b.tick(60);
  b.click('conn-answer', Object.keys(files).find(k => /^connection\/probe-/.test(k)).split('/')[1]); await b.tick(60);
  c.ahead(6000); a.every(); await a.tick(60);
  assert.ok(/1 answer/.test(a.html()) && !/Things to look at/.test(a.html()));
  c.ahead(16 * 60000); a.every(); await a.tick(60);
  assert.ok(/1 answer/.test(a.html()) && /saw check 1/.test(a.html()) && !/Things to look at/.test(a.html()), 'still answered after the check left the 15-minute window');
});

rule('App: a run whose file is deleted while it\'s open is marked gone, never written back by itself, and only Restore it here brings it back', async () => {
  const c = clock();
  const app = boot({ localStore: { 'preflight:builder': 'false' }, Date: c.D }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  const run = app.run(), path = run.path, dir = path.replace('run.json', '');
  Object.keys(app.fs.files).filter(k => k.indexOf(dir) === 0).forEach(k => delete app.fs.files[k]);
  c.ahead(6000); app.every(); await app.tick(80);
  let html = app.html();
  assert.ok(/This run(&#39;|')s file is gone from the team folder/.test(html) && /data-act="restore-missing"/.test(html) && /data-id="a-runs-file-is-gone">What to do/.test(html), 'said, with both actions');
  app.click('pick', 'run', { kind: 'pause' }); await app.tick(); app.set('pick-input', 'x'); app.click('pause', 'run'); await app.tick(40);
  app.click('na', 'announce'); await app.tick(40);
  assert.ok(!app.fs.files[path], 'not recreated by a change');
  app.click('nav', 'runs'); await app.tick();
  assert.ok(/file is gone/.test(app.html()), 'marked in the list');
  app.click('open-run', run.key); await app.tick(40);
  app.click('restore-missing'); await app.tick(80);
  assert.ok(app.fs.files[path], 'restored on request');
  const j = JSON.parse(app.fs.files[path].t);
  assert.ok(j.log.some(l => /Restored this run(')?s file/.test(l.text || l.what || JSON.stringify(l))), 'logged');
  assert.ok(!/file is gone from the team folder/.test(app.html()));
});

rule('App: a full refresh that no longer finds a saved run keeps it, marked gone, instead of dropping it silently', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const run = app.run(), dir = run.path.replace('run.json', '');
  Object.keys(app.fs.files).filter(k => k.indexOf(dir) === 0).forEach(k => delete app.fs.files[k]);
  app.click('nav', 'runs'); app.click('refresh'); await app.tick(80);
  assert.ok(/Release 2026\.10\.16/.test(app.html()) && /file is gone/.test(app.html()));
  app.click('nav', 'home'); await app.tick();
  assert.ok(/The team folder needs attention/.test(app.html()));
});

rule('App: Discard my change after a refused save of a gone run puts back the version read, and Restore it here never saves the discarded change', async () => {
  const app = await recordingRelease();
  const run = app.run(), path = run.path, dir = path.replace('run.json', '');
  Object.keys(app.fs.files).filter(k => k.indexOf(dir) === 0).forEach(k => delete app.fs.files[k]);
  app.click('pick', 'run', { kind: 'pause' }); await app.tick(); app.set('pick-input', 'Discard me'); app.click('pause', 'run'); await app.tick(60);
  assert.ok(!app.fs.files[path] && /file is gone from the team folder/.test(app.html()), 'refused and marked gone');
  app.click('discard-unsaved'); await app.tick(80);
  assert.ok(!/Discard me/.test(app.html()), 'the discarded pause is gone from the screen');
  app.click('restore-missing'); await app.tick(80);
  const j = JSON.parse(app.fs.files[path].t);
  assert.ok(!j.paused && !(j.pauses || []).some(p => p.reason === 'Discard me'), 'the discarded change was never saved');
  assert.ok(!JSON.stringify(j.log).includes('Discard me'));
});

rule('App: a read that found the file missing but finished after a successful save never marks the run gone', async () => {
  const c = clock();
  const app = boot({ localStore: { 'preflight:builder': 'false' }, Date: c.D }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  const run = app.run(), dir = run.path.replace('run.json', '').replace(/\/$/, '');
  const saved = {}; Object.keys(app.fs.files).filter(k => k.indexOf(dir + '/') === 0).forEach(k => { saved[k] = app.fs.files[k]; delete app.fs.files[k]; });
  const list = app.fs.list.bind(app.fs), g = gate(); let held = false;
  app.fs.list = p => { if (p === dir && !held) { held = true; return list(p).then(x => g.p.then(() => x)); } return list(p); };
  c.ahead(6000); app.every(); await app.tick(20);
  assert.ok(held, 'the reread is holding');
  Object.assign(app.fs.files, saved);
  app.click('pick', 'run', { kind: 'pause' }); await app.tick(); app.set('pick-input', 'Kept'); app.click('pause', 'run'); await app.tick(60);
  assert.ok(JSON.parse(app.fs.files[run.path].t).paused, 'the save succeeded');
  g.open(); await app.tick(80);
  assert.ok(!/file is gone from the team folder/.test(app.html()), 'the stale read doesn\'t mark it gone');
  app.click('resume', 'run'); await app.tick(60);
  assert.ok(!JSON.parse(app.fs.files[run.path].t).paused, 'still recordable');
});

/* ---------- Reads, saves, Discard and Restore on one run, in every order (round 4) ---------- */
/* The example release recorded by Casey, on a clock the test moves, with run.json writes that can be held: hold() makes the
   next write of run.json wait (before or after it lands) until release(). */
async function heldRelease(opts) {
  opts = opts || {};
  const c = clock();
  const app = boot({ localStore: { 'preflight:builder': 'false' }, Date: c.D }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  const run = app.run(), path = run.path, dir = path.replace(/\/run\.json$/, '');
  const write = app.fs.write.bind(app.fs), read = app.fs.read.bind(app.fs);
  let hold = null, holdRead = null;
  /* holdRead(): the next read of run.json reads the file now but answers only on release, as a slow OneDrive read would. */
  app.fs.read = p => { if (p !== path || !holdRead) return read(p); const g = holdRead; holdRead = null; return read(p).then(v => g.p.then(() => v)); };
  app.fs.write = (p, data) => {
    if (p !== path || !hold) return write(p, data);
    const h = hold; hold = null;
    return h.after ? write(p, data).then(() => h.g.p) : h.g.p.then(() => write(p, data));
  };
  const t = { app, c, run, path, dir, read,
    hold(after) { const g = gate(); hold = { g, after }; return g; },
    holdRead() { const g = gate(); holdRead = g; return g; },
    wipe() { Object.keys(app.fs.files).filter(k => k.indexOf(dir + '/') === 0).forEach(k => delete app.fs.files[k]); },
    commit(v) { app.click('edit', 'detail:commit'); app.set('edit-input', v); app.click('save-edit'); },
    disk() { const f = app.fs.files[path]; if (!f) return null; try { return JSON.parse(f.t); } catch (e) { return 'broken'; } } };
  return t;
}

rule('App: Discard my change waits while Restore it here is saving, so a discarded change is never written by the restore', async () => {
  const t = await heldRelease(), app = t.app;
  t.wipe(); t.commit('KEEP-OR-DISCARD'); await app.tick(60);
  assert.ok(/file is gone from the team folder/.test(app.html()) && !t.disk());
  const g = t.hold(false);
  app.click('restore-missing'); await app.tick(20);
  app.click('discard-unsaved'); await app.tick(20);
  assert.ok(/Wait for the save to finish/.test(app.html()), 'Discard is refused while the restore is saving');
  g.open(); await app.tick(80);
  const d = t.disk();
  assert.ok(d && d.details.commit === 'KEEP-OR-DISCARD' && /KEEP-OR-DISCARD/.test(app.html()), 'what was restored is what the screen shows; nothing claimed discarded');
});

rule('App: a save that landed is the version Discard goes back to, even when a later change is still waiting', async () => {
  const t = await heldRelease(), app = t.app;
  const g = t.hold(true);
  t.commit('SAVED-A'); await app.tick(20);
  t.commit('PENDING-B'); await app.tick(20);
  t.wipe();
  g.open(); await app.tick(80);
  assert.ok(/file is gone from the team folder/.test(app.html()), 'B was refused: the file is gone');
  app.click('discard-unsaved'); await app.tick(60);
  assert.ok(/SAVED-A/.test(app.html()) && !/PENDING-B/.test(app.html()), 'back to the save that landed, not before it');
  app.click('restore-missing'); await app.tick(80);
  const d = t.disk();
  assert.ok(d.details.commit === 'SAVED-A' && JSON.stringify(d.log).indexOf('SAVED-A') >= 0, 'the restored run keeps save A and its log');
});

rule('App: an old read that found run.json unreadable never makes a run read-only after a later save succeeded', async () => {
  const t = await heldRelease(), app = t.app, g = gate();
  let first = true;
  const read = app.fs.read.bind(app.fs);
  app.fs.read = p => { if (p === t.path && first) { first = false; return g.p.then(() => ({ text: '{"format":"preflight-run/2","id":', mtime: 1 })); } return read(p); };
  t.c.ahead(6000); app.every(); await app.tick(20);
  t.commit('AFTER-READ'); await app.tick(60);
  assert.strictEqual(t.disk().details.commit, 'AFTER-READ', 'the save succeeded');
  g.open(); await app.tick(80);
  assert.ok(!/couldn't be read on the last check/.test(app.html()), 'the stale read is ignored');
  t.commit('STILL-WRITABLE'); await app.tick(60);
  assert.strictEqual(t.disk().details.commit, 'STILL-WRITABLE');
});

rule('App: in any order of edits, held and refused saves, deletions, restores, discards and stale or fresh rereads, a discarded change never reaches the folder, a landed save is never rolled back by a read, and a gone run comes back only by Restore', async () => {
  for (let seed = 1; seed <= (+process.env.SEEDS || 24); seed++) {
    let x = seed * 7919; const rnd = n => { x = (x * 48271) % 2147483647; return x % n; };
    const t = await heldRelease(), app = t.app;
    const discarded = new Set(); let n = 0, gone = false, holds = [], lastGood = null, minRev = t.disk().rev, lastText = null, lastRev = 0, external = false;
    const log = [];
    const commitShown = () => { const m = /<span class="k">commit<\/span> <code>([^<]*)<\/code>/.exec(app.html()); return m ? m[1] : null; };
    for (let step = 0; step < 45; step++) {
      const a = ['edit', 'edit', 'edit', 'hold', 'hold-after', 'hold-read', 'release', 'release', 'delete', 'restore', 'discard', 'reread', 'reread', 'refresh', 'corrupt', 'fix'][rnd(16)];
      log.push(a);
      const before = t.disk();
      if (a === 'edit') t.commit('V' + seed + '-' + (++n));
      else if (a === 'hold' || a === 'hold-after') holds.push(t.hold(a === 'hold-after'));
      else if (a === 'hold-read') { holds.push(t.holdRead()); t.c.ahead(6000); app.every(); }
      else if (a === 'release') { const h = holds.shift(); if (h) h.open(); }
      else if (a === 'delete') { t.wipe(); gone = true; }
      else if (a === 'restore') { app.click('restore-missing'); }
      else if (a === 'discard') {
        const shown = commitShown(), pending = /Your last change isn(&#39;|')t saved/.test(app.html());
        app.click('discard-unsaved'); await app.tick(5);
        const ok = pending && !/Wait for the save to finish/.test(app.html());
        if (ok && shown && !(before && before.details && before.details.commit === shown)) discarded.add(shown);
        /* Discard goes back to the last saved file, exactly, when nothing outside this window wrote the file since. */
        if (ok && lastText && !external) assert.strictEqual(commitShown(), JSON.parse(lastText).details.commit, 'Discard went back to something other than the last saved file · seed ' + seed + ' after ' + log.join(','));
      }
      else if (a === 'reread') { t.c.ahead(6000); app.every(); }
      else if (a === 'refresh') app.click('refresh');
      else if (a === 'corrupt' || a === 'fix') external = true;
      if (a === 'corrupt') { if (before && before !== 'broken') { lastGood = app.fs.files[t.path].t; app.fs.files[t.path] = { t: '{"format":"preflight-run/2","id":', m: Date.now() }; } }
      if (a === 'fix') { if (lastGood && t.disk() === 'broken') { app.fs.files[t.path] = { t: lastGood, m: Date.now() }; } }
      await app.tick(30);
      const d = t.disk(), where = 'seed ' + seed + ' after ' + log.join(',');
      if (d && d !== 'broken') {
        assert.ok(!discarded.has(d.details.commit), 'a discarded change reached the folder: ' + d.details.commit + ' · ' + where);
        if (a !== 'fix') assert.ok(d.rev >= minRev, 'the folder went back from revision ' + minRev + ' to ' + d.rev + ' · ' + where);
        /* Every write this window makes is a new revision after the last one that landed: a restore never rewrites an older one. */
        const text = app.fs.files[t.path].t;
        if (lastText !== null && text !== lastText && a !== 'fix') assert.ok(d.rev > lastRev, 'revision ' + d.rev + ' written over revision ' + lastRev + ' · ' + where);
        if (text !== lastText && a !== 'fix') external = false;
        lastText = text; lastRev = d.rev;
        minRev = Math.max(minRev, d.rev); gone = false;
      }
      if (gone) assert.ok(!d || a === 'restore' || log.slice(log.lastIndexOf('delete')).indexOf('restore') >= 0, 'a gone run came back without Restore · ' + where);
    }
    // Let everything finish, then a fresh read must agree with the folder.
    holds.forEach(h => h.open()); await app.tick(80);
    app.click('refresh'); await app.tick(80);
    const d = t.disk();
    if (d && d !== 'broken') {
      assert.ok(!discarded.has(d.details.commit), 'final: a discarded change in the folder · seed ' + seed);
      assert.ok(!/file is gone from the team folder|couldn't be read on the last check/.test(app.html()), 'final: a readable run in the folder is shown as gone or unreadable · seed ' + seed + ' · ' + log.join(','));
    }
  }
});

rule('App: a run file that reads again clears "couldn\'t be read" even while a change of this window waits, and that change can still be saved', async () => {
  const t = await heldRelease(), app = t.app;
  const g = t.hold(true);
  t.commit('SAVED-A'); await app.tick(30);
  t.commit('WAITING-B'); await app.tick(30);
  const good = app.fs.files[t.path].t;
  app.fs.files[t.path] = { t: '{"format":"preflight-run/2","id":', m: Date.now() };
  g.open(); await app.tick(30);
  assert.ok(/couldn't be read on the last check/.test(app.html()) && /Your last change isn(&#39;|')t saved/.test(app.html()), 'set-up: B\'s save found the file unreadable');
  app.fs.files[t.path] = { t: good, m: Date.now() }; await app.tick(30);
  app.click('refresh'); await app.tick(80);
  assert.ok(!/couldn't be read on the last check/.test(app.html()), 'the file reads again, and the screen says so');
  assert.ok(/Your last change isn(&#39;|')t saved/.test(app.html()) && /WAITING-B/.test(app.html()), 'B still waits, on screen');
  app.click('retry-save'); await app.tick(80);
  assert.strictEqual(t.disk().details.commit, 'WAITING-B', 'Try again saves it');
});

rule('App: the 5-second reread of a run whose file reads again redraws the run, so "couldn\'t be read" goes away without a full refresh', async () => {
  const t = await heldRelease(), app = t.app;
  const g = t.hold(true);
  t.commit('SAVED-A'); await app.tick(30);
  t.commit('WAITING-B'); await app.tick(30);
  const good = app.fs.files[t.path].t;
  app.fs.files[t.path] = { t: '{"format":"preflight-run/2","id":', m: Date.now() };
  g.open(); await app.tick(30);
  assert.ok(/couldn't be read on the last check/.test(app.html()), 'set-up');
  app.fs.files[t.path] = { t: good, m: Date.now() };
  t.c.ahead(6000); app.every(); await app.tick(80);
  assert.ok(!/couldn't be read on the last check/.test(app.html()), 'the open-run reread alone clears it on screen');
  assert.ok(/WAITING-B/.test(app.html()), 'B still waits');
});

rule('App: Discard goes back to exactly what the save wrote, even when a later change was folded into that save', async () => {
  const t = await heldRelease(), app = t.app;
  const r1 = t.holdRead();
  t.commit('SAVED-A'); await app.tick(20);
  t.commit('SAVED-B'); await app.tick(20);
  const w = t.hold(true);
  r1.open(); await app.tick(20);
  assert.strictEqual(t.disk().details.commit, 'SAVED-B', 'the first save wrote the run as it was by then: with B');
  delete app.fs.files[t.path];
  w.open(); await app.tick(80);
  assert.ok(/file is gone from the team folder/.test(app.html()));
  app.click('discard-unsaved'); await app.tick(60);
  assert.ok(/SAVED-B/.test(app.html()), 'Discard shows what landed');
  app.click('restore-missing'); await app.tick(80);
  const d = t.disk();
  assert.strictEqual(d.details.commit, 'SAVED-B', 'the restore writes what landed, not an older snapshot');
  assert.ok(JSON.stringify(d.log).indexOf('SAVED-B') >= 0, 'with B\'s log entry');
});

rule('App: setup refuses a folder that already has Flightdeck files for AI assistants, and replaces nothing', async () => {
  const files = { '.flightdeck/skills/flightdeck-status/SKILL.md': 'our own version' }, before = JSON.stringify(files), dir = folderHandle('Team', files);
  const app = boot({ picker: dir, indexedDB: memoryIDB(), firstRun: true }); await app.tick(60);
  app.click('setup-mode', 'start'); await app.tick();
  app.click('setup-pick'); await app.tick(80);
  assert.ok(/isn(&#39;|')t empty: it already has Flightdeck files/.test(app.html()), 'says why');
  assert.ok(!/data-act="setup-next"/.test(app.html()));
  assert.strictEqual(JSON.stringify(files), before);
});

rule('App: Getting started never counts an answer from another team folder', async () => {
  const { example } = require('./harness');
  const a = { 'people.json': example('people.json') }, b = { 'people.json': example('people.json') };
  const opts = { picker: folderHandle('A', a), indexedDB: memoryIDB() }, app = boot(opts); await app.tick(60);
  const t0 = new Date().toISOString();
  a['connection/ack-abcd1234.wb.json'] = JSON.stringify(app.PF.connection.ack({ probe: 'abcd1234', probeFile: 'probe-x', by: 'person-blake', writer: 'wb', device: 'Windows · Edge', at: t0, firstSeenAt: t0, app: '1.15.0', run: null, folderReadAt: t0 }));
  app.choose('person-avery'); await app.tick();
  app.click('connect'); await app.tick(200);
  app.click('nav', 'home'); await app.tick(100);
  assert.ok(/Getting started · 3 of 5/.test(app.html()), 'folder A: Blake answered');
  opts.picker = folderHandle('B', b);
  app.click('connect'); await app.tick(200);
  app.click('nav', 'home'); await app.tick(100);
  assert.ok(/Getting started · 2 of 5/.test(app.html()), 'folder B: nobody has answered here');
});


rule('App: anyone says what became of a follow-up in a file of its own; Won\'t do needs a reason, Home drops it, Reopen brings it back, run.json never changes', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-morgan'); await app.tick();
  assert.ok(/Your follow-ups · 1/.test(app.html()) && /Add a cache warm-up to the deploy job/.test(app.html()), 'Morgan\'s open follow-up is on Home');
  const key = /data-act="fu-pick" data-id="([^"]+)" data-status="wont"/.exec(app.html())[1], runKey = key.split('/').slice(0, 2).join('/');
  const runFile = 'runs/' + runKey + '/run.json', runText = app.fs.files[runFile].t;
  const mine = () => app.files('followups/release/').filter(p => !/example-session/.test(p)).sort();
  app.click('fu-pick', key, { status: 'wont' }); await app.tick();
  const B = app.PF.followups.formId(key), N = () => app.html().split(B).join('fud');
  assert.ok(/id="fud-reason"/.test(N()) && /aria-expanded="true" aria-controls="fud-form"/.test(N()), 'the form opens under its button');
  app.click('fu-save', key); await app.tick(20);
  assert.ok(/id="ferr-fud-reason" role="alert">Why won&#39;t it be done\? Say why\./.test(N()), 'a reason is required');
  assert.strictEqual(mine().length, 0, 'nothing written');
  app.set(B + '-reason', 'The new cache warms itself'); app.click('fu-save', key); await app.tick(60);
  assert.strictEqual(mine().length, 1);
  const d = JSON.parse(app.fs.files[mine()[0]].t);
  assert.deepStrictEqual([d.kind, d.status, d.reason, d.by, d.rev, d.seen], ['followup-decision', 'wont', 'The new cache warms itself', 'person-morgan', 1, null]);
  assert.ok(/^followups\/release\/[\w-]+\.[\w-]+\.[\w-]+\.1\.json$/.test(mine()[0]));
  assert.ok(!/Your follow-ups/.test(app.html()) && /Marked won&#39;t do|Marked won't do/.test(app.html() + app.live()), 'it drops off Home');
  app.click('nav', 'followups'); await app.tick(20);
  app.click('fu-filter', 'all'); await app.tick();
  assert.ok(/<span class="pill locked">Won&#39;t do<\/span>/.test(app.html()) && /Won't do: The new cache warms itself · Morgan/.test(app.html()), 'all of them, with what became of it');
  app.click('fu-reopen', key); await app.tick(60);
  assert.strictEqual(mine().length, 2, 'one new file per decision');
  const d2 = JSON.parse(app.fs.files[mine().filter(p => /\.2\.json$/.test(p))[0]].t);
  assert.deepStrictEqual([d2.status, d2.rev, d2.seen], ['open', 2, mine()[0].split('/').pop()]);
  app.click('nav', 'home'); await app.tick(20);
  assert.ok(/Your follow-ups · 1/.test(app.html()), 'reopened, it\'s back on Home');
  assert.strictEqual(app.fs.files[runFile].t, runText, 'run.json is unchanged');
});


rule('App: what was typed in one follow-up\'s form never goes with another\'s', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-morgan'); await app.tick();
  app.click('nav', 'followups'); await app.tick(20);
  const keys = [...app.html().matchAll(/data-act="fu-pick" data-id="([^"]+)" data-status="done"/g)].map(m => m[1]);
  assert.ok(keys.length >= 2, 'set-up: two open follow-ups');
  const F = app.PF.followups, [a, b] = keys;
  app.click('fu-pick', a, { status: 'done' }); await app.tick();
  app.set(F.formId(a) + '-link', 'https://example.com/a-evidence'); app.set(F.formId(a) + '-note', 'A note'); await app.tick();
  app.click('fu-pick', b, { status: 'done' }); await app.tick();
  assert.ok(app.html().indexOf('id="' + F.formId(b) + '-link"') >= 0 && app.html().indexOf('id="' + F.formId(a) + '-link"') < 0, 'only B\'s form, with its own boxes');
  app.click('fu-save', b); await app.tick(60);
  const file = app.files('followups/release/').filter(p => !/example-session/.test(p))[0], d = JSON.parse(app.fs.files[file].t);
  assert.strictEqual(d.followUp, b.split('/')[2]);
  assert.ok(!d.link && !d.note, 'B saved none of A\'s evidence: ' + JSON.stringify(d));
});

rule('App: a follow-up decision that finishes after switching folders leaves the new folder able to decide', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-morgan'); await app.tick();
  const orig = app.PF.repo.decideFollowUp, g = gate();
  // Only this window's decision waits; the examples' own seeding writes straight through.
  app.PF.repo.decideFollowUp = function (fs, rec, writer) { const args = arguments; return writer === 'example-session' ? orig.apply(this, args) : g.p.then(() => orig.apply(this, args)); };
  const key = /data-act="fu-pick" data-id="([^"]+)" data-status="done"/.exec(app.html())[1];
  app.click('fu-pick', key, { status: 'done' }); await app.tick();
  app.click('fu-save', key); await app.tick();
  app.click('reset-examples');
  for (let i = 0; i < 50 && !/Examples reset\./.test(app.html() + app.live()); i++) await app.tick(20);
  assert.ok(/Examples reset\./.test(app.html() + app.live()), 'set-up: the folder switched while the decision was saving');
  g.open(); await app.tick(40);
  app.PF.repo.decideFollowUp = orig;
  app.choose('person-morgan'); await app.tick();
  const k2 = /data-act="fu-pick" data-id="([^"]+)" data-status="done"/.exec(app.html())[1];
  app.click('fu-pick', k2, { status: 'done' }); await app.tick();
  assert.ok(!/fu-save[^>]*disabled/.test(app.html()), 'Save isn\'t stuck');
  const before = app.files('followups/release/').length;
  app.click('fu-save', k2); await app.tick(60);
  assert.strictEqual(app.files('followups/release/').length, before + 1, 'the new folder\'s decision is written');
});


rule('App: while one follow-up\'s decision saves, another\'s form stays open, keeps its text and saves on its own', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-morgan'); await app.tick();
  app.click('nav', 'followups'); await app.tick(20);
  const [a, b] = [...app.html().matchAll(/data-act="fu-pick" data-id="([^"]+)" data-status="done"/g)].map(m => m[1]);
  const F = app.PF.followups, orig = app.PF.repo.decideFollowUp, g = gate();
  app.PF.repo.decideFollowUp = function (fs, rec) { const args = arguments; return rec.run + '/' + rec.followUp === a.split('/').slice(1).join('/') ? g.p.then(() => orig.apply(this, args)) : orig.apply(this, args); };
  app.click('fu-pick', a, { status: 'done' }); await app.tick();
  app.click('fu-save', a); await app.tick();
  app.click('fu-pick', b, { status: 'wont' }); await app.tick();
  const box = F.formId(b) + '-reason';
  assert.ok(app.html().indexOf('id="' + box + '"') >= 0, 'B\'s form opens while A saves');
  assert.ok(!new RegExp('data-act="fu-save" data-id="' + b.replace(/\//g, '\\/') + '"[^>]*disabled').test(app.html()), 'B\'s Save is enabled');
  app.set(box, 'Not ours any more'); await app.tick();
  g.open(); await app.tick(60);
  assert.ok(app.html().indexOf('id="' + box + '"') >= 0, 'A finishing leaves B\'s form open');
  assert.strictEqual(app.draft(box), 'Not ours any more', 'with its text');
  app.click('fu-save', b); await app.tick(60);
  app.PF.repo.decideFollowUp = orig;
  const mine = app.files('followups/release/').filter(p => !/example-session/.test(p)).map(p => JSON.parse(app.fs.files[p].t));
  assert.deepStrictEqual(mine.map(d => d.status).sort(), ['done', 'wont'], 'both saved');
});

/* ---------- Saved history (docs/design.md section 20, slice 2) ---------- */
const histLines = (app, dir) => app.files(dir + '/').filter(p => /\.jsonl$/.test(p)).map(p => app.fs.files[p].t.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))).reduce((a, b) => a.concat(b), []);

rule('App: a successful save adds one line to this window\'s own history file; a refused save adds nothing', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', dir = 'history/drafts/release', H = app.PF.util.hash, original = app.fs.files[path].t;
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  let lines = histLines(app, dir);
  assert.strictEqual(lines.length, 1, 'one line');
  const l = lines[0], files = app.files(dir + '/');
  assert.ok(files.length === 1 && /^history\/drafts\/release\/[a-z0-9]{10}\.jsonl$/.test(files[0]) && files[0].indexOf(l.writer) > 0, 'named for this window');
  assert.ok(l.v === 1 && l.kind === 'draft-edit' && l.process === 'release' && l.by === 'person-casey' && l.source === 'editor' && l.seen === null, 'who and how');
  assert.strictEqual(l.from, H(original)); assert.strictEqual(l.to, H(app.fs.files[path].t), 'the fingerprints before and after');
  assert.ok(/The step deletion of "Rollback/.test(l.units[0]) && l.items.indexOf('step:rollback') >= 0 && l.hunks.some(h => h.del.some(x => /\{#rollback\}/.test(x))), 'what changed');
  // Someone else changes the draft: the next save is refused, and no line is added.
  const theirs = app.fs.files[path].t.replace('title: Production release', 'title: Theirs');
  await app.fs.write(path, theirs);
  app.click('ob-del', 'flags'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(/Someone else changed this draft/.test(app.html()), 'refused');
  assert.strictEqual(histLines(app, dir).length, 1, 'nothing added for the refused save');
  // Keep mine saves over theirs: a line that says so, from their fingerprint.
  app.click('draft-keep-mine'); await app.tick(80);
  lines = histLines(app, dir);
  assert.ok(lines.length === 2 && lines[1].source === 'keep-mine' && lines[1].seq > lines[0].seq && lines[1].seen === lines[0].id, 'kept mine, in order');
  assert.strictEqual(lines[1].from, H(theirs), 'from their version');
});

rule('App: a history line that couldn\'t be written is kept and written ahead of the next save\'s', async () => {
  const app = await builderOn(), dir = 'history/drafts/release';
  const orig = app.fs.append; let fail = true;
  app.fs.append = function (p, t) { return fail && /^history\//.test(p) ? Promise.reject(new Error('OneDrive is busy')) : orig.call(this, p, t); };
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()) && !app.files(dir + '/').length, 'the draft saved; its history line didn\'t');
  fail = false;
  app.click('ob-del', 'flags'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const lines = histLines(app, dir);
  assert.strictEqual(lines.length, 2, 'both lines');
  assert.ok(lines[0].seq < lines[1].seq && lines[1].from === lines[0].to && /Rollback/.test(lines[0].units[0]) && /Feature flags/.test(lines[1].units[0]), 'the kept one first');
  app.fs.append = orig;
});

rule('App: Saved history lists every save in the team folder, with a publication and an outside change in their places', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md';
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  // An AI assistant edits the draft by hand, then the person saves another change.
  await app.fs.write(path, app.fs.files[path].t.replace('title: Production release', 'title: Production release <b>now</b>'));
  app.focus(); await app.tick(80);
  app.click('ob-del', 'flags'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  app.click('hist-open', 'draft'); await app.tick();
  assert.ok(/<h3>This session<\/h3>/.test(app.overlay()) && /data-act="hist-mode" data-id="session" aria-pressed="true"/.test(app.overlay()), 'This session first');
  app.click('hist-mode', 'saved'); await app.tick(40);
  const h = app.overlay();
  assert.ok(/data-act="hist-mode" data-id="saved" aria-pressed="true"/.test(h) && /<h3>Saved history<\/h3>/.test(h), 'the switch');
  const at = x => h.indexOf(x);
  assert.ok(at('Feature flags') > 0 && at('Changed outside Flightdeck') > at('Feature flags') && at('Rollback commit') > at('Changed outside Flightdeck'), 'newest first, the outside change between the saves');
  assert.ok((h.match(/Saved in Flightdeck/g) || []).length === 2 && /Casey/.test(h), 'who and how');
  assert.ok(/data-act="hist-compare"/.test(h) && /Reverse this change/.test(h));
  // One step's history: only the saves that touched it.
  app.key('Escape'); await app.tick();
  app.click('ob-sel', 'smoke'); await app.tick();
  app.click('hist-open', 'draft', { item: 'step:smoke' }); await app.tick(40);
  assert.ok(/<h3>Saved history<\/h3>/.test(app.overlay()) && /No saved changes to it yet/.test(app.overlay()), 'the switch is remembered; nothing for this step');
  app.click('hist-item', 'step:flags'); await app.tick();
  assert.ok(/Feature flags/.test(app.overlay()) && !/Rollback commit/.test(app.overlay()) && !/Changed outside/.test(app.overlay()), 'filtered to the step');
});

rule('App: Reverse this change undoes a saved change in the editor only when its lines are still there; otherwise Compare opens', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', original = app.fs.files[path].t;
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const saved = app.fs.files[path].t;
  app.click('hist-open', 'draft'); await app.tick();
  app.click('hist-mode', 'saved'); await app.tick(40);
  const id = /data-act="hist-reverse" data-id="([\w-]+)"/.exec(app.overlay())[1];
  app.click('hist-reverse', id); await app.tick();
  assert.ok(/Reversed that change in the editor/.test(app.html()) && /Unsaved: Save draft before you publish/.test(app.html()), 'reversed, not saved');
  assert.strictEqual(app.fs.files[path].t, saved, 'nothing written');
  app.key('Escape'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.strictEqual(app.fs.files[path].t, original, 'saving it brings the step back exactly');
  assert.strictEqual(histLines(app, 'history/drafts/release').pop().source, 'reverse', 'saved as a reversal');
  // The lines around it changed since: Reverse refuses, leaves the text alone and opens Compare.
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  app.click('ed-mode', 'markdown'); await app.tick();
  const edited = mdOf(app).replace('New features ship off', 'New features ship dark');
  app.input('draft-editor', edited); await settle(app);
  app.click('hist-open', 'draft'); await app.tick(40);
  const newest = /data-act="hist-reverse" data-id="([\w-]+)"/.exec(app.overlay())[1];
  app.click('hist-reverse', newest); await app.tick();
  assert.ok(/<p class="notice warn" role="status">The text changed since\. Compare and edit it yourself\.<\/p>/.test(app.overlay()), 'Compare, with why');
  assert.ok(/id="hist-cmp-/.test(app.overlay()) && /<span class="del">- [^<]*Rollback commit/.test(app.overlay()), 'showing the change');
  assert.strictEqual(mdOf(app), edited, 'the text is left as it was');
});

rule('App: a step type\'s saves are kept field by field, and a field\'s History shows only its own', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  app.input('tf-id', 'risk.level'); app.input('tf-label', 'Risk level'); await settle(app);
  app.submit('type-form'); await app.tick(80);
  app.input('tf-label', 'Risk level <i>now</i>'); await settle(app);
  app.submit('type-form'); await app.tick(80);
  const lines = histLines(app, 'history/step-types/risk.level');
  assert.ok(lines.length === 2 && lines[0].source === 'new' && lines[0].from === null && lines[1].source === 'editor' && lines[1].from === lines[0].to, 'created, then saved');
  assert.ok(lines[1].kind === 'type-edit' && lines[1].type === 'risk.level' && lines[1].before.label === 'Risk level' && lines[1].after.label === 'Risk level <i>now</i>' && lines[1].items.indexOf('type:label') >= 0, 'before and after');
  app.click('hist-open', 'type'); await app.tick();
  app.click('hist-mode', 'saved'); await app.tick(40);
  const h = app.overlay();
  assert.ok(/Created in Flightdeck/.test(h) && /Saved in Flightdeck/.test(h) && /<summary class="small">Label<\/summary>/.test(h), 'field by field');
  assert.ok(/Risk level &lt;i&gt;now&lt;\/i&gt;/.test(h) && !/<i>now<\/i>/.test(h), 'escaped');
  assert.ok(!/Reverse this change/.test(h), 'step types have Compare, not Reverse');
});

rule('App: restoring a version is kept as Restored from vN', async () => {
  const app = await builderOn();
  app.click('ob-del', 'flags'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const folder = app.files('publications/release/').map(p => p.split('/')[2]).filter(f => /^v1-/.test(f))[0];
  app.click('restore-draft', folder); await app.tick();
  app.click('restore-draft', folder, { sure: '1' }); await app.tick(80);
  const last = histLines(app, 'history/drafts/release').pop();
  assert.ok(last.source === 'restore' && last.version === 1 && last.units[0] === 'Restored v1 as the draft');
  app.click('ptab', 'edit'); await app.tick();
  app.click('hist-open', 'draft'); await app.tick();
  app.click('hist-mode', 'saved'); await app.tick(40);
  assert.ok(/Restored from v1/.test(app.overlay()) && /Published v1/.test(app.overlay()), 'and the publication it matches is placed');
});

rule('App: Reverse this change waits, like Undo, while a builder box holds wording that isn\'t applied', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md';
  app.click('ob-del', 'rollback'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const saved = app.fs.files[path].t;
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Ask @qa before continuing'); await app.tick();
  enter(app, 'ob-text', 'Ask @qa before continuing'); await app.tick();
  assert.ok(/role="alert">Choose roles and run details with their buttons/.test(app.html()), 'set-up: refused, still typed');
  app.click('hist-open', 'draft'); await app.tick();
  app.click('hist-mode', 'saved'); await app.tick(40);
  const id = /data-act="hist-reverse" data-id="([\w-]+)"/.exec(app.overlay())[1];
  app.click('hist-reverse', id); await app.tick();
  assert.strictEqual(app.draft('ob-text'), 'Ask @qa before continuing', 'the typing is kept');
  assert.ok(/Apply or clear what you typed in the box first/.test(app.html()), 'and it says why it waits');
  assert.ok(!/data-ob-step="rollback"/.test(app.html()), 'nothing reversed');
  assert.strictEqual(app.fs.files[path].t, saved);
});

rule('App: Saved history lists names in the history folder it didn\'t read, and Compare and Reverse act on the entry chosen when two share an ID', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md', dir = 'history/drafts/release', TL = app.PF.timeline, H = app.PF.util.hash;
  const base = app.fs.files[path].t, one = base.replace('title: Production release', 'title: One'), two = base.replace('title: Production release', 'title: Two');
  const rec = (to, unit) => JSON.stringify(TL.histLine({ kind: 'draft-edit', id: 'dup1', process: 'release', writer: 'agent-helper', seq: 1, from: H(base), to: H(to), before: base, after: to, units: [unit], items: [] }));
  await app.fs.write(dir + '/agent-helper.jsonl', rec(one, 'Made it One') + '\n');
  await app.fs.write(dir + '/agent-helper (1).jsonl', rec(two, 'Made it Two') + '\n');
  await app.fs.write(dir + '/notes.txt', 'x');
  await app.fs.write(path, two); app.focus(); await app.tick(80);
  app.click('hist-open', 'draft'); await app.tick();
  app.click('hist-mode', 'saved'); await app.tick(40);
  let h = app.overlay();
  assert.ok(/Not read, since they aren.t history files: notes\.txt/.test(h), 'the other name is listed');
  assert.ok(!/older line/.test(h), 'nothing skipped here');
  const refs = [...h.matchAll(/data-act="hist-compare" data-id="([\w-]+)"/g)].map(m => m[1]);
  assert.ok(refs.length === 2 && refs[0] !== refs[1], 'each has its own reference');
  app.click('hist-compare', refs[1]); await app.tick();
  h = app.overlay();
  assert.strictEqual((h.match(/id="hist-cmp-/g) || []).length, 1, 'only the one chosen opens');
  // Reverse the one that made it Two (the newest, since the draft says Two).
  const twoRef = /Made it Two[\s\S]*?data-act="hist-reverse" data-id="([\w-]+)"/.exec(h)[1];
  app.click('hist-reverse', twoRef); await app.tick();
  app.click('ed-mode', 'markdown'); await app.tick();
  assert.ok(/title: Production release\n/.test(mdOf(app)), 'the change chosen was reversed');
});

/* ---------- 1.17: go() keeps what's typed, read results, paging, slow refreshes, lazy thumbnails ---------- */
const endedPath = app => Object.keys(app.fs.files).find(p => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(p) && JSON.parse(app.fs.files[p].t).ended);

rule('go(): an unsent note survives going somewhere else and is there again on the way back; the step is unfolded, selected and flashed', async () => {
  const app = await recordingRelease(), key = app.run().key;
  app.click('select', 'approve'); await app.tick();
  app.set('note-text', 'unsent words'); await app.tick();
  app.click('go', '', { view: 'process', process: 'release' }); await app.tick();
  assert.ok(/data-act="ptab"/.test(app.html()) && !/id="note-text"/.test(app.html()), 'on the process page');
  app.click('go', '', { view: 'run', run: key, step: 'approve' }); await app.tick();
  assert.strictEqual(app.selected(), 'approve');
  assert.strictEqual(app.draft('note-text'), 'unsent words', 'the unsent note came back');
  assert.ok(/<li class="step sel[^"]*\bflash\b[^"]*"[^>]*id="step-approve"/.test(app.html()), 'flashed');
  assert.ok(app.asked().indexOf('[data-act="select"][data-id="approve"]') >= 0 && app.asked().indexOf('#step-approve') >= 0, 'focused and scrolled into view');
});

rule('go(): text typed in a builder box and not applied refuses the jump, with the existing message, and stays', async () => {
  const app = await builderOn();
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Half typed'); await app.tick();
  app.click('go', '', { view: 'runs' }); await app.tick();
  assert.ok(/Apply or clear what you typed in the box first/.test(app.html()), 'says why');
  assert.ok(/id="ob-text"/.test(app.html()) && app.draft('ob-text') === 'Half typed', 'still in the editor, with the typing');
  assert.strictEqual(app.focused(), '#ob-text');
});

rule('go(): a correction being written is kept for its run and step, comes back on return, and Cancel clears it', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-blake'); await app.tick();
  const { key } = app.run();
  app.click('open-run', key); await app.tick(20);
  app.click('corr-open', 'pods', { mode: 'correct' }); await app.tick();
  app.input('corr-why', 'The cache warms slowly'); await app.tick();
  app.click('go', '', { view: 'home' }); await app.tick();
  assert.ok(!/id="corr-why"/.test(app.html()), 'it went');
  app.click('go', '', { view: 'run', run: key, step: 'pods' }); await app.tick();
  assert.ok(/<textarea id="corr-why"[^>]*>The cache warms slowly<\/textarea>/.test(app.html()), 'the correction is back, as written');
  app.click('corr-cancel'); await app.tick();
  app.click('go', '', { view: 'home' }); await app.tick();
  app.click('go', '', { view: 'run', run: key, step: 'pods' }); await app.tick();
  assert.ok(!/id="corr-why"/.test(app.html()), 'Cancel cleared it');
});

rule('go(): a dialog with nothing typed in it is closed first; one with typing in it is never replaced', async () => {
  const app = await builderOn();
  app.click('help'); await app.tick();
  assert.ok(app.overlay(), 'set-up: help is open');
  app.click('go', '', { view: 'runs' }); await app.tick();
  assert.strictEqual(app.overlay(), '', 'help closed');
  assert.ok(/<h1[^>]*>Runs<\/h1>/.test(app.html()), 'and on Runs');
  app.click('go', '', { view: 'process', process: 'release', ptab: 'edit' }); await app.tick();
  app.click('ob-parts-open'); await app.tick();
  assert.ok(app.overlay(), 'set-up: the Add part sheet is open');
  app.click('go', '', { view: 'runs' }); await app.tick();
  assert.strictEqual(app.overlay(), '', 'nothing typed in it: closed, nothing lost');
  const b = boot(); await b.tick(80); b.choose('person-morgan'); await b.tick();
  b.click('open-process', 'release'); await b.tick(20);
  const id = /data-act="corr-review" data-id="([\w-]+)"/.exec(b.html())[1];
  b.click('corr-review', id); await b.tick(20);
  b.click('corr-ca-declining'); await b.tick();
  const sheet = b.overlay();
  assert.ok(/id="ca-reason"/.test(sheet), 'set-up: a reason box in the dialog');
  b.set('ca-reason', 'Not this time'); await b.tick();
  b.click('go', '', { view: 'runs' }); await b.tick();
  assert.ok(/id="ca-reason"/.test(b.overlay()), 'not replaced');
  assert.strictEqual(b.draft('ca-reason'), 'Not this time');
  assert.ok(/Finish or cancel this first\./.test(b.live() + b.html()));
});

rule('go(): on a phone, an open step sheet is closed before going; keys typed while an input method is composing do nothing', async () => {
  const app = boot({ narrow: true }); await app.tick(60); app.choose('person-casey'); await app.tick();
  const key = app.run().key;
  app.click('open-run', key); await app.tick(); app.click('select', 'approve'); await app.tick();
  assert.ok(/id="rw-ins"[^>]*data-open="true"/.test(app.html()), 'set-up: the step sheet is open');
  app.click('go', '', { view: 'run', run: key, step: 'pods' }); await app.tick();
  assert.ok(/id="rw-ins"[^>]*data-open="false"/.test(app.html()), 'closed, so the step is shown in the list');
  assert.strictEqual(app.selected(), 'pods');
  const wide = boot(); await wide.tick(60); wide.choose('person-casey'); await wide.tick();
  wide.click('open-run', wide.run().key); await wide.tick();
  const was = wide.selected();
  wide.keyOn('j', { isComposing: true }); await wide.tick();
  assert.strictEqual(wide.selected(), was, 'j while composing doesn\'t move');
  wide.keyOn('j'); await wide.tick();
  assert.notStrictEqual(wide.selected(), was, 'and does once composing ends');
});

rule('A run that couldn\'t be read is cleared only by reading its file again, never by what the cache remembers', async () => {
  const app = boot(); await app.tick(60);
  const path = endedPath(app), key = path.split('/').slice(1, 3).join('/'), good = Object.assign({}, app.fs.files[path]);
  app.click('nav', 'runs'); await app.tick();
  app.click('open-run', key); await app.tick();
  app.fs.files[path] = { t: '{"format":"preflight-run/2","id":', m: good.m };
  app.focus(); await app.tick(80);
  assert.ok(/couldn(&#39;|')t be read/.test(app.html()), 'set-up: marked unreadable');
  app.fs.files[path] = good;
  app.click('nav', 'runs'); await app.tick();
  const read = app.fs.read.bind(app.fs); let reads = 0; app.fs.read = p => { if (p === path) reads++; return read(p); };
  app.focus(); await app.tick(80);
  assert.ok(reads >= 1, 'its run.json was read again');
  assert.ok(!/run file can(&#39;|')t be read/.test(app.html()), 'and only then cleared');
});

rule('Runs: the 8 newest finished runs and 50 earlier ones at first, Show 50 more adds the next ones and moves focus to the first new run', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  const src = JSON.parse(app.fs.files[endedPath(app)].t);
  for (let i = 0; i < 70; i++) { const c = Object.assign({}, src, { id: 'copy' + String(i).padStart(2, '0'), title: 'Copy ' + i }); c.ended = Object.assign({}, src.ended, { at: new Date(Date.parse(src.ended.at) - (i + 1) * 60000).toISOString() }); await app.fs.write('runs/' + src.process + '/' + c.id + '/run.json', JSON.stringify(c)); }
  app.click('nav', 'runs'); app.click('refresh'); await app.tick(120);
  const finished = () => { const h = app.html(), at = h.indexOf('<h2>Finished'); return (h.slice(at).match(/data-act="open-run"/g) || []).length; };
  assert.strictEqual(finished(), 58);
  assert.ok(/Showing 50 of \d+/.test(app.html()));
  const next = /data-act="more" data-id="runs-ended" data-next="([^"]+)"/.exec(app.html())[1].replace(/&amp;/g, '&');
  app.click('more', 'runs-ended', { next }); await app.tick();
  assert.ok(finished() > 58, 'more shown');
  assert.ok(/^\[data-act="open-run"\]\[data-id="[^"]+"\]$/.test(app.focused()), 'focus on the first new one: ' + app.focused());
});

rule('Folder health says when refreshing is slow on this computer after 3 slow routine refreshes', async () => {
  const c = clock();
  const app = boot({ Date: c.D }); await app.tick(60); app.choose('person-casey'); await app.tick();
  const orig = app.PF.repo.loadAll;
  app.PF.repo.loadAll = function (fs, o) { c.ahead(17000); return orig.call(this, fs, o); };
  for (let i = 0; i < 3; i++) { c.ahead(31000); app.every(); await app.tick(40); }
  app.PF.repo.loadAll = orig;
  app.click('health'); await app.tick(200);
  assert.ok(/Refreshing takes about 17 seconds on this computer/.test(app.html()), 'listed in Folder health');
});

rule('Thumbnails load only once they scroll into view, through the folder\'s shared pool', async () => {
  const observers = [];
  class IO { constructor(cb) { this.cb = cb; this.seen = []; observers.push(this); } observe(el) { this.seen.push(el); } unobserve() {} disconnect() { this.seen = []; } }
  const app = boot({ localStore: { 'preflight:builder': 'false' }, IntersectionObserver: IO }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  app.click('select', 'approve'); app.set('note-text', 'with a picture'); app.change('note-file', [png('pods.png')]); await app.tick();
  app.click('add-note', 'approve'); await app.tick(80);
  const blob = app.fs.blob.bind(app.fs); let blobs = 0; app.fs.blob = p => { if (/\/files\//.test(p)) blobs++; return blob(p); };
  app.click('select', 'pods'); await app.tick(); app.click('select', 'approve'); await app.tick(40);
  const m = /data-thumb="([^"]+)"/.exec(app.html());
  assert.ok(m, 'a placeholder waits to be seen');
  assert.strictEqual(blobs, 0, 'nothing read before it\'s seen');
  observers.forEach(o => o.cb([{ isIntersecting: true, target: { dataset: { thumb: m[1].replace(/&amp;/g, '&') } } }], o));
  await app.tick(40);
  assert.strictEqual(blobs, 1, 'read once it\'s in view');
});

/* ---------- 1.17 review: every inline form, stale thumbnail jobs, detached placeholders, revealing the target ---------- */
const refused = (app, id, value) => {
  assert.ok(/Finish or cancel this first\./.test(app.html() + app.live()), id + ': says why');
  assert.ok(new RegExp('id="' + id + '"').test(app.html()), id + ': still on screen');
  assert.strictEqual(app.draft(id), value, id + ': the typing is kept');
};

rule('go(): a reason typed to decline a correction refuses the jump and stays', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-morgan'); await app.tick();
  app.click('open-process', 'release'); await app.tick(20);
  const id = /data-act="corr-applied" data-id="([\w-]+)"/.exec(app.html())[1];
  app.click('pick', id, { kind: 'corr-decline' }); await app.tick();
  app.set('pick-input', 'Ten minutes is enough'); await app.tick();
  app.click('go', '', { view: 'runs' }); await app.tick();
  refused(app, 'pick-input', 'Ten minutes is enough');
});

rule('go(): every inline form with typing refuses the jump: a pause reason, a follow-up decision and a new follow-up', async () => {
  let app = await recordingRelease();
  app.click('pick', 'run', { kind: 'pause' }); await app.tick();
  app.set('pick-input', 'Waiting for the board'); await app.tick();
  app.click('go', '', { view: 'home' }); await app.tick();
  refused(app, 'pick-input', 'Waiting for the board');

  app = boot(); await app.tick(80); app.choose('person-morgan'); await app.tick();
  const key = /data-act="fu-pick" data-id="([^"]+)" data-status="wont"/.exec(app.html())[1], B = app.PF.followups.formId(key);
  app.click('fu-pick', key, { status: 'wont' }); await app.tick();
  app.set(B + '-reason', 'Not needed'); await app.tick();
  app.click('go', '', { view: 'runs' }); await app.tick();
  refused(app, B + '-reason', 'Not needed');

  app = await recordingRelease();
  app.click('finish'); await app.tick();
  app.set('fu-text', 'Tidy the dashboard'); await app.tick();
  app.click('go', '', { view: 'home' }); await app.tick();
  refused(app, 'fu-text', 'Tidy the dashboard');
});

rule('go(): a change note to publish, and a run\'s title and details on Start, refuse the jump with the typing kept', async () => {
  let app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  const d = 'maps/drafts/release.md'; await app.fs.write(d, app.fs.files[d].t.replace('title: Production release', 'title: Production release (new)'));
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick(20);
  assert.ok(/id="change-note"/.test(app.html()), 'set-up: the publish form is there');
  app.set('change-note', 'Clarify the deploy step'); await app.tick();
  app.click('go', '', { view: 'runs' }); await app.tick();
  refused(app, 'change-note', 'Clarify the deploy step');
  app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('start', 'release'); await app.tick();
  app.set('run-title', 'Release 2026.11.06'); await app.tick();
  app.click('go', '', { view: 'home' }); await app.tick();
  refused(app, 'run-title', 'Release 2026.11.06');
  app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('start', 'release'); await app.tick();
  app.set('detail-ticket', 'ABC-5000'); await app.tick();
  app.click('go', '', { view: 'home' }); await app.tick();
  refused(app, 'detail-ticket', 'ABC-5000');
});

rule('go(): a choice left as drawn never blocks; a changed one does', async () => {
  let app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('start', 'release'); await app.tick();
  const role = /id="(role-[\w-]+)"/.exec(app.html())[1];
  app.click('go', '', { view: 'runs' }); await app.tick();
  assert.ok(/<h1[^>]*>Runs<\/h1>/.test(app.html()) && !/Finish or cancel this first/.test(app.html() + app.live()), 'an untouched role choice doesn\'t block');
  app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('start', 'release'); await app.tick();
  app.select(role, 'person-morgan'); await app.tick();
  app.click('go', '', { view: 'runs' }); await app.tick();
  assert.ok(/Finish or cancel this first\./.test(app.html() + app.live()) && new RegExp('id="' + role + '"').test(app.html()), 'a changed one does');
});

/* A typed checklist published into the example folder, and its start form open. */
async function typedStart() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-casey'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t);
  const md = ['---', 'process: typed', 'title: Typed', 'owner: person-avery', 'context: ticket, ok:yes-no, rows:number, env:choice(dev|test|prod|stage|qa|perf)', '---', '', '## Prep · READ-DO {#prep}', '- [ ] {confirm} One {#one}'].join('\n');
  const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now: new Date().toISOString(), rand: 'ty000001', app: '2.0.0' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  Object.keys(b.files).forEach(k => { app.fs.files['publications/typed/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  app.click('refresh'); await app.tick(80);
  app.click('start', 'typed'); await app.settle();
  assert.ok(/id="opt-detail-ok-0"/.test(app.html()) && /<select id="detail-env"/.test(app.html()), 'set-up: the typed start form');
  return app;
}

rule('Typed values: a yes/no, a choice or a number chosen on the start form keeps Back and go() from dropping it; untouched ones never block', async () => {
  for (const [what, act] of [['yes/no', a => a.check('opt-detail-ok-0', true)], ['choice', a => a.select('detail-env', 'prod')], ['number', a => a.set('detail-rows', '12')]]) {
    let app = await typedStart(); act(app); await app.tick();
    app.back(); await app.settle();
    assert.ok(/Finish or cancel this first\./.test(app.html() + app.live()) && /id="detail-ok"/.test(app.html()), what + ': Back waits');
    app = await typedStart(); act(app); await app.tick();
    app.click('go', '', { view: 'home' }); await app.tick();
    assert.ok(/Finish or cancel this first\./.test(app.html() + app.live()) && /id="detail-ok"/.test(app.html()), what + ': go() waits');
  }
  const app = await typedStart(); app.back(); await app.settle();
  assert.ok(!/id="detail-ok"/.test(app.html()) && !/Finish or cancel this first/.test(app.html() + app.live()), 'nothing chosen: Back goes');
});

rule('go(): with nothing typed, every screen and dialog of the examples lets you go', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  const key = app.run().key;
  const screens = [
    ['home', () => app.click('nav', 'home')], ['runs', () => app.click('nav', 'runs')], ['follow-ups', () => app.click('nav', 'followups')],
    ['processes', () => app.click('nav', 'processes')], ['skills', () => app.click('nav', 'skills')], ['step types', () => app.click('nav', 'types')],
    ['settings', () => app.click('nav', 'settings')], ['process', () => app.click('open-process', 'release')],
    ['process edit', () => { app.click('open-process', 'release'); app.click('ptab', 'edit'); }], ['process insights', () => { app.click('open-process', 'release'); app.click('ptab', 'insights'); }],
    ['start', () => app.click('start', 'release')], ['run', () => app.click('open-run', key)], ['run, a step', () => { app.click('open-run', key); app.click('select', 'approve'); }],
    ['run, pickup', () => { app.click('open-run', key); app.click('pickup'); }], ['finish', () => { app.click('open-run', key); app.click('finish'); }],
    ['receipt', () => { app.click('open-run', key); app.click('receipt'); }], ['folder health', () => app.click('health')], ['connection check', () => app.click('connection')],
    ['help', () => app.click('help')], ['what\'s new', () => app.click('whats-new')], ['add part sheet', () => { app.click('open-process', 'release'); app.click('ptab', 'edit'); app.click('ob-parts-open'); }]
  ];
  for (const [name, open] of screens) {
    app.click('nav', 'home'); await app.tick(5); open(); await app.tick(20);
    const before = app.live();
    app.click('go', '', { view: 'skills' }); await app.tick(20);
    assert.ok(!/Finish or cancel this first|Apply or clear/.test(app.live() === before ? app.html() : app.live() + app.html()), name + ': nothing typed, nothing blocks');
    assert.ok(/<h1[^>]*>Skills<\/h1>/.test(app.html()) && app.overlay() === '', name + ': went');
  }
});

rule('A thumbnail waiting for its turn never reads through a folder opened after it was queued', async () => {
  const observers = [];
  class IO { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} unobserve() {} disconnect() {} }
  const app = boot({ localStore: { 'preflight:builder': 'false' }, IntersectionObserver: IO }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  app.click('select', 'approve'); app.set('note-text', 'with a picture'); app.change('note-file', [png('pods.png')]); await app.tick();
  app.click('add-note', 'approve'); await app.tick(80);
  app.click('select', 'pods'); await app.tick(); app.click('select', 'approve'); await app.tick(40);
  const thumb = /data-thumb="([^"]+)"/.exec(app.html())[1].replace(/&amp;/g, '&');
  // Hold every thumbnail turn, so the job has to wait in the queue.
  const pool = app.PF.repo.poolOf(app.fs), held = [];
  for (let i = 0; i < 4; i++) pool('thumb', () => new Promise(r => held.push(r)));
  let blobs = 0; const proto = app.PF.fs.MemoryFS.prototype, orig = proto.blob;
  proto.blob = function (p) { if (/\/files\//.test(p)) blobs++; return orig.call(this, p); };
  observers.forEach(o => o.cb([{ isIntersecting: true, target: { dataset: { thumb } } }], o));
  await app.tick(5);
  app.click('reset-examples'); await app.tick(120);
  held.forEach(r => r()); await app.tick(40);
  proto.blob = orig;
  assert.strictEqual(blobs, 0, 'the old job stopped before reading');
});

rule('Thumbnail placeholders that leave the page stop being watched', async () => {
  const watched = new Set();
  class IO { constructor(cb) { this.cb = cb; } observe(el) { watched.add(el); } unobserve(el) { watched.delete(el); } disconnect() { watched.clear(); } }
  const app = boot({ localStore: { 'preflight:builder': 'false' }, IntersectionObserver: IO }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  app.click('select', 'approve'); app.set('note-text', 'with a picture'); app.change('note-file', [png('pods.png')]); await app.tick();
  app.click('add-note', 'approve'); await app.tick(80);
  for (let i = 0; i < 5; i++) { app.click('select', 'pods'); await app.tick(); app.click('select', 'approve'); await app.tick(); }
  assert.strictEqual(watched.size, 1, 'only the placeholder on screen is watched');
  app.click('select', 'pods'); await app.tick();
  assert.strictEqual(watched.size, 0, 'none once it\'s gone');
});

rule('go(): a step in the run already open is scrolled into view, on a phone too', async () => {
  for (const narrow of [false, true]) {
    const app = boot({ narrow }); await app.tick(60); app.choose('person-casey'); await app.tick();
    const key = app.run().key;
    app.click('open-run', key); await app.tick(40);
    const before = app.asked().length;
    app.click('go', '', { view: 'run', run: key, step: 'pods' }); await app.tick(40);
    assert.ok(app.asked().slice(before).indexOf('#step-pods') >= 0, (narrow ? 'phone' : 'laptop') + ': revealed');
  }
});

/* ---------- 1.17 third review: input kept in app state survives leaving the screen ---------- */
rule('A correction\'s "Move it to" and "Who should do it" choices come back after going elsewhere; switching folders clears them', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-blake'); await app.tick();
  const { key } = app.run();
  app.click('open-run', key); await app.tick(20);
  app.click('corr-open', 'pods', { mode: 'correct' }); await app.tick();
  app.click('corr-op', 'move'); await app.tick();
  const opts = [...app.html().slice(app.html().indexOf('id="corr-move"')).split('</select>')[0].matchAll(/<option value="([^"]*)"/g)].map(m => m[1]).filter(Boolean);
  const to = opts[opts.length - 1];
  app.select('corr-move', to); await app.tick();
  app.click('go', '', { view: 'runs' }); await app.tick();
  assert.ok(!/id="corr-move"/.test(app.html()), 'it went');
  app.click('go', '', { view: 'run', run: key, step: 'pods' }); await app.tick();
  assert.ok(new RegExp('<option value="' + to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*selected').test(app.html()), 'the choice is back');
  app.click('corr-op', 'roles'); await app.tick();
  const role = /id="(corr-role-[\w-]+)"/.exec(app.html())[1];
  app.check(role, !new RegExp('id="' + role + '"[^>]*checked').test(app.html())); await app.tick();
  const was = new RegExp('id="' + role + '"[^>]*checked').test(app.html());
  app.click('go', '', { view: 'runs' }); await app.tick();
  app.click('go', '', { view: 'run', run: key, step: 'pods' }); await app.tick();
  assert.strictEqual(new RegExp('id="' + role + '"[^>]*checked').test(app.html()), was, 'the role choice is back');
  app.click('reset-examples'); await app.tick(150);
  app.choose('person-blake'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(20); app.click('select', 'pods'); await app.tick();
  assert.ok(!/id="corr-move"|id="corr-roles"/.test(app.html()), 'a new folder starts clean');
});

rule('Files picked for a note with no text yet come back after going elsewhere; removing one clears it, and switching folders clears them', async () => {
  const app = await recordingRelease(), key = app.run().key;
  app.click('select', 'approve'); await app.tick();
  app.change('note-file', [png('pods.png')]); await app.tick();
  assert.ok(/aria-label="Waiting to attach"><li class="att">.*pods\.png/.test(app.html()), 'set-up: waiting to attach');
  app.click('go', '', { view: 'runs' }); await app.tick();
  app.click('go', '', { view: 'run', run: key, step: 'approve' }); await app.tick();
  assert.ok(/aria-label="Waiting to attach"><li class="att">.*pods\.png/.test(app.html()), 'still waiting to attach');
  const id = /data-act="att-remove" data-id="([^"]+)"/.exec(app.html())[1];
  app.click('att-remove', id); await app.tick();
  assert.ok(!/pods\.png/.test(app.html()), 'removed on request');
  app.change('note-file', [png('again.png')]); await app.tick();
  app.click('reset-examples'); await app.tick(150);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(20); app.click('select', 'approve'); await app.tick();
  assert.ok(!/again\.png/.test(app.html()), 'a new folder starts clean');
});

rule('New process: what was submitted and refused comes back after going elsewhere; Cancel clears it', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  app.click('new-process'); await app.tick();
  app.set('np-id', 'release'); app.set('np-title', 'Another release'); app.submit('new-process-form'); await app.tick(20);
  assert.ok(/There(&#39;|')s already a process called "release"/.test(app.html() + app.live()), 'set-up: refused');
  app.click('go', '', { view: 'runs' }); await app.tick();
  assert.ok(!/id="np-id"/.test(app.html()), 'it went');
  app.click('new-process'); await app.tick();
  assert.ok(/id="np-title"[^>]*value="Another release"/.test(app.html()) && /id="np-id"[^>]*value="release"/.test(app.html()), 'the form is back as submitted');
  app.click('np-cancel'); await app.tick();
  app.click('new-process'); await app.tick();
  assert.ok(/id="np-title"[^>]*value=""/.test(app.html()), 'Cancel cleared it');
});

/* ---------- 1.17 fourth review: input belongs to the context it was typed in ---------- */
async function twoRuns(opts) {
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, opts || {}));
  await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick();
  app.click('pickup'); await app.tick(40);
  const a = app.run();
  const copy = JSON.parse(app.fs.files[a.path].t); copy.id = 'twin0001'; copy.title = 'Twin release';
  await app.fs.write('runs/release/twin0001/run.json', JSON.stringify(copy));
  app.click('refresh'); await app.tick(80);
  return { app, A: a.key, B: 'release/twin0001' };
}

rule('Fill in typed in one run never shows up in another run at the same step, and is there again in its own', async () => {
  const { app, A, B } = await twoRuns();
  app.click('open-run', A); await app.tick(); app.click('unfold', 'verify'); await app.tick();
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  app.set('fld-issue', 'ABC-1111'); await app.tick();
  app.click('open-run', B); await app.tick(); app.click('unfold', 'verify'); await app.tick();
  app.click('select', 'close'); await app.tick();
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  assert.ok(!/ABC-1111/.test(app.html()), 'not in the other run');
  app.click('unpick'); await app.tick();
  app.click('open-run', A); await app.tick(); app.click('unfold', 'verify'); await app.tick();
  app.click('select', 'close'); await app.tick();
  assert.ok(/id="fld-issue"[^>]*value="ABC-1111"/.test(app.html()), 'back in its own run');
  assert.ok(!/ABC-1111/.test(app.fs.files['runs/release/twin0001/run.json'].t), 'never saved into the other run');
});

rule('Opening a correction on another step keeps the one already being written, and it comes back', async () => {
  const app = boot(); await app.tick(80); app.choose('person-blake'); await app.tick();
  const { key } = app.run();
  app.click('open-run', key); await app.tick(20);
  app.click('corr-open', 'pods', { mode: 'correct' }); await app.tick();
  app.input('corr-why', 'Pods reason'); await app.tick();
  app.click('corr-open', 'approve', { mode: 'correct' }); await app.tick();
  assert.ok(!/Pods reason/.test(app.html()), 'the other step starts clean');
  app.input('corr-why', 'Approve reason'); await app.tick();
  app.click('corr-open', 'pods', { mode: 'correct' }); await app.tick();
  assert.ok(/<textarea id="corr-why"[^>]*>Pods reason<\/textarea>/.test(app.html()), 'the first one is back');
  app.click('corr-open', 'approve', { mode: 'correct' }); await app.tick();
  assert.ok(/<textarea id="corr-why"[^>]*>Approve reason<\/textarea>/.test(app.html()), 'and the second');
});

rule('New process: a creation that finishes late never clears or leaves a newer form', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  const orig = app.PF.repo.loadAll, g = gate(); let hold = false;
  app.PF.repo.loadAll = function () { const args = arguments, self = this; return hold ? g.p.then(() => orig.apply(self, args)) : orig.apply(self, args); };
  app.click('new-process'); await app.tick();
  app.set('np-id', 'risk-review'); app.set('np-title', 'Risk review'); hold = true; app.submit('new-process-form'); await app.tick(40);
  hold = false;
  app.click('go', '', { view: 'runs' }); await app.tick();
  app.click('new-process'); await app.tick();
  app.input('np-id', 'release'); app.input('np-title', 'Second try'); app.submit('new-process-form'); await app.tick(20);
  g.open(); await app.tick(80);
  app.PF.repo.loadAll = orig;
  assert.ok(app.fs.files['maps/drafts/risk-review.md'], 'set-up: the first draft was created');
  assert.ok(/id="np-title"/.test(app.html()) && app.draft('np-title') === 'Second try', 'still on the newer form, as submitted');
  assert.ok(/Created the draft for "Risk review"\. Open it from Processes\./.test(app.html() + app.live()), 'told where the first one is');
});

rule('Across runs, steps, corrections, notes and leaving, input never shows in another context and is never lost without Cancel', async () => {
  for (const seed of [3, 11, 29]) {
    const files = {}, gone = [];
    const { app, A, B } = await twoRuns({ indexedDB: await rememberedFolder(files), picker: folderHandle('Other', {}) });
    sameRunsFolder(app, files);
    // High bits only: an LCG's low bits cycle (x % 2 alternates), which would leave half the actions never chosen.
    let x = seed; const rnd = n => { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; return (x >>> 16) % n; };
    const want = { corr: {}, note: {}, fill: {} }; let run = null, step = null, n = 0;
    const ctxKey = () => run + '|' + step;
    for (let i = 0; i < 80; i++) {
      const a = rnd(10);
      if (a === 0 || !run) { run = [A, B][rnd(2)]; app.click('open-run', run); await app.tick(); step = /<li class="step sel[^"]*"[^>]*id="step-([\w-]+)"/.exec(app.html()); step = step ? step[1] : null; }
      else if (a === 1) { step = ['pods', 'approve'][rnd(2)]; app.click('select', step); await app.tick(); }
      else if (a === 2 && step) { app.click('corr-open', step, { mode: 'correct' }); await app.tick(); const t = 'C' + seed + '-' + (++n) + 'z'; app.input('corr-why', t); await app.tick(); want.corr[ctxKey()] = t; }
      else if (a === 3 && step) { const t = 'N' + seed + '-' + (++n) + 'z'; app.set('note-text', t); await app.tick(); want.note[ctxKey()] = t; }
      else if (a === 4) { app.click('go', '', { view: ['runs', 'home', 'processes'][rnd(3)] }); await app.tick(); run = null; step = null; continue; }
      else if (a === 5 && /id="corr-why"/.test(app.html())) { app.click('corr-cancel'); await app.tick(); delete want.corr[ctxKey()]; }
      else if (a === 7) {
        // Fill in with an action that decides its fields, then another small form on the same step, canceled.
        step = 'close'; app.click('go', '', { view: 'run', run, step }); await app.tick();
        if (!/id="fld-action"/.test(app.html())) { app.click('pick', step, { kind: 'fields' }); await app.tick(); }
        app.select('fld-action', 'create'); await app.tick();
        const t = 'P' + seed + '-' + (++n) + 'z'; app.set('fld-project', t); app.select('fld-project', t); await app.tick();
        want.fill[ctxKey()] = ['fld-project', t];
        app.click('pick', step, { kind: ['block', 'differently', 'deadline'][rnd(3)] }); await app.tick(); app.click('unpick'); await app.tick();
        app.click('pick', step, { kind: 'fields' }); await app.tick();
        const h7 = app.html();
        assert.ok(/<option selected>create<\/option>/.test(h7) && new RegExp('id="fld-project"[^>]*value="' + t + '"').test(h7), 'seed ' + seed + ' step ' + i + ': Fill in back after another form on its step, its action and fields together');
      }
      else if (a === 8 && !gone.length && i > 10 && run) {
        // Fill in open with an action chosen, as the folder changes under it.
        step = 'close'; app.click('go', '', { view: 'run', run, step }); await app.tick();
        if (!/id="fld-action"/.test(app.html())) { app.click('pick', step, { kind: 'fields' }); await app.tick(); }
        app.select('fld-action', 'create'); await app.tick();
        const t = 'X' + seed + '-' + (++n) + 'z'; app.set('fld-project', t); app.select('fld-project', t); await app.tick();
        want.fill[ctxKey()] = ['fld-project', t];
        Object.keys(want).forEach(t => Object.keys(want[t]).forEach(k => gone.push(t === 'fill' ? want[t][k][1] : want[t][k])));
        want.corr = {}; want.note = {}; want.fill = {};
        // The same run stays on screen, as after reconnecting: nothing typed in the last folder may come along.
        app.click('reconnect'); await app.tick(200); app.goneUndrawn();
        app.click('save-fields', step); await app.tick(60);
      }
      else if (a === 9) {
        const orig = app.PF.repo.loadAll, g = gate(); let hold = true, id = 'np-' + seed + '-' + (++n);
        app.PF.repo.loadAll = function () { const args = arguments, self = this; return hold ? g.p.then(() => orig.apply(self, args)) : orig.apply(self, args); };
        app.click('new-process'); await app.tick();
        app.set('np-id', id); app.set('np-title', 'T ' + id); app.submit('new-process-form'); await app.tick(20);
        hold = false; app.set('np-title', 'Edited ' + id); app.input('np-title', 'Edited ' + id); await app.tick();
        g.open(); await app.tick(60); app.PF.repo.loadAll = orig;
        assert.ok(/id="np-title"/.test(app.html()) && app.draft('np-title') === 'Edited ' + id, 'seed ' + seed + ': typing after a submit keeps the form');
        assert.ok(new RegExp('Created the draft for "T ' + id + '"\\. Open it from Processes\\.').test(app.html() + app.live()), 'seed ' + seed + ': told where the draft is');
        app.click('np-cancel'); await app.tick(); run = null; step = null; continue;
      }
      else if (a === 6 && step) {
        if (!/id="fld-/.test(app.html())) { app.click('pick', step, { kind: 'fields' }); await app.tick(); }
        const f = /id="(fld-[\w-]+)"[^>]*value="/.exec(app.html());
        if (f) { const t = 'F' + seed + '-' + (++n) + 'z'; app.set(f[1], t); app.select(f[1], t); await app.tick(); want.fill[ctxKey()] = [f[1], t]; }
      }
      if (!run || !step) continue;
      const html = app.html();
      gone.forEach(t => assert.ok(html.indexOf(t) < 0, 'seed ' + seed + ' step ' + i + ': ' + t + ' from the last folder shown' + (process.env.DBG ? ' :: ' + html.slice(Math.max(0, html.indexOf(t) - 300), html.indexOf(t) + 50) : '')));
      Object.keys(want.corr).filter(k => k !== ctxKey()).forEach(k => assert.ok(html.indexOf('>' + want.corr[k] + '<') < 0, 'seed ' + seed + ' step ' + i + ': ' + k + '\'s correction shown in ' + ctxKey()));
      Object.keys(want.note).filter(k => k !== ctxKey()).forEach(k => assert.ok(html.indexOf('>' + want.note[k] + '<') < 0, 'seed ' + seed + ' step ' + i + ': ' + k + '\'s note shown in ' + ctxKey()));
      Object.keys(want.fill).filter(k => k !== ctxKey()).forEach(k => assert.ok(html.indexOf('"' + want.fill[k][1] + '"') < 0, 'seed ' + seed + ' step ' + i + ': ' + k + '\'s Fill in shown in ' + ctxKey()));
    }
    gone.forEach(t => Object.keys(files).forEach(p => assert.ok(String(files[p]).indexOf(t) < 0, 'seed ' + seed + ': ' + t + ' from the last folder saved into ' + p)));
    // Every context still has what was typed in it.
    for (const k of new Set(Object.keys(want.corr).concat(Object.keys(want.note), Object.keys(want.fill)))) {
      const [r, st] = k.split('|');
      app.click('go', '', { view: 'run', run: r, step: st }); await app.tick();
      if (want.fill[k]) assert.ok(new RegExp('id="' + want.fill[k][0] + '"[^>]*value="' + want.fill[k][1] + '"').test(app.html()), 'seed ' + seed + ': Fill in kept for ' + k);
      if (want.note[k]) assert.ok(new RegExp('<textarea id="note-text"[^>]*>' + want.note[k] + '</textarea>').test(app.html()), 'seed ' + seed + ': note kept for ' + k);
      if (want.corr[k]) { app.click('corr-open', st, { mode: 'correct' }); await app.tick(); assert.ok(new RegExp('<textarea id="corr-why"[^>]*>' + want.corr[k] + '</textarea>').test(app.html()), 'seed ' + seed + ': correction kept for ' + k); }
    }
  }
});

/* ---------- 1.17 fifth review: another form on the same step, typing after a submit, other folders ---------- */
rule('Fill in survives opening Blocked on the same step: its action and the fields for that action come back together, and Save keeps them', async () => {
  const app = await recordingRelease();
  app.click('unfold', 'verify'); await app.tick();
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  app.select('fld-action', 'create'); await app.tick();
  app.set('fld-project', 'PRJ'); app.set('rec-key', 'PRJ-42'); await app.tick();
  app.click('pick', 'close', { kind: 'block' }); await app.tick();
  app.click('unpick'); await app.tick();
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  const h = app.html();
  assert.ok(/<option selected>create<\/option>/.test(h), 'the action chosen');
  assert.ok(/id="fld-project"[^>]*value="PRJ"/.test(h), 'the field typed for that action');
  assert.ok(/id="rec-key"[^>]*value="PRJ-42"/.test(h), 'the evidence typed');
  app.click('save-fields', 'close'); await app.tick(60);
  const f = (app.run().json.fields || {}).close || {};
  assert.strictEqual(f.action, 'create'); assert.strictEqual(f.project, 'PRJ', 'saved with the action shown');
});

rule('New process: typing after Create the draft keeps the form when the creation finishes late, and says where the draft is', async () => {
  const app = boot(); await app.tick(80); app.choose('person-casey'); await app.tick();
  const orig = app.PF.repo.loadAll, g = gate(); let hold = false;
  app.PF.repo.loadAll = function () { const args = arguments, self = this; return hold ? g.p.then(() => orig.apply(self, args)) : orig.apply(self, args); };
  app.click('new-process'); await app.tick();
  app.set('np-id', 'risk-review'); app.set('np-title', 'Risk review'); hold = true; app.submit('new-process-form'); await app.tick(40);
  hold = false;
  app.set('np-title', 'Risk review, edited'); app.input('np-title', 'Risk review, edited'); await app.tick();
  g.open(); await app.tick(80);
  app.PF.repo.loadAll = orig;
  assert.ok(/id="np-title"/.test(app.html()) && app.draft('np-title') === 'Risk review, edited', 'still on the form, with the edit');
  assert.ok(/Created the draft for "Risk review"\. Open it from Processes\./.test(app.html() + app.live()));
});

/* A real team folder holding the same runs as the examples, as a copy of them would. */
/* A team folder this browser remembers but must ask again to use: the examples open first, and Reconnect switches to it
   in place, on the screen you're on. */
async function rememberedFolder(files) {
  const dir = folderHandle('Team', files), idb = memoryIDB();
  dir.queryPermission = () => Promise.resolve('prompt');
  await new Promise(res => { const q = idb.open(); q.onsuccess = () => { const tx = q.result.transaction(); tx.oncomplete = res; tx.objectStore().put({ dir, id: 'team-1' }, 'folder'); }; });
  return idb;
}
function sameRunsFolder(app, files) { Object.keys(app.fs.files).forEach(p => { const t = app.fs.files[p].t; if (!/^data:/.test(t)) files[p] = t; }); }
rule('Opening another folder never brings Fill in, a correction or picked files from the last one, even for a run with the same name', async () => {
  const files = {}, other = {};
  const app = boot({ localStore: { 'preflight:builder': 'false' }, indexedDB: await rememberedFolder(files), picker: folderHandle('Other', other) }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const key = app.run().key, path = app.run().path;
  app.click('open-run', key); await app.tick(); app.click('pickup'); await app.tick(40);
  sameRunsFolder(app, files); sameRunsFolder(app, other);
  app.click('unfold', 'verify'); await app.tick();
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  app.select('fld-action', 'create'); await app.tick();
  app.set('fld-project', 'EXAMPLES-ONLY'); await app.tick();
  app.select('fld-project', 'EXAMPLES-ONLY'); await app.tick();
  // Reconnect stays on the run: the same run in the other folder is on screen at once.
  app.click('reconnect'); await app.tick(200); app.goneUndrawn();
  assert.ok(/Release 2026\.10\.16/.test(app.html()), 'set-up: the same run, now from the team folder');
  assert.ok(!/EXAMPLES-ONLY/.test(app.html()), 'not shown in the other folder');
  assert.ok(!/id="fld-action"/.test(app.html()), 'Fill in isn\'t open there');
  app.click('save-fields', 'close'); await app.tick(60);
  assert.ok(!/EXAMPLES-ONLY/.test(files[path] || ''), 'Save there writes nothing from the last folder');
  app.click('open-run', key); await app.tick(40); app.click('unfold', 'verify'); await app.tick(); app.click('select', 'close'); await app.tick();
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  assert.ok(!/EXAMPLES-ONLY/.test(app.html()), 'nor when it opens');
  assert.ok(!/<option selected>create<\/option>/.test(app.html()), 'nor its action');
  app.click('save-fields', 'close'); await app.tick(60);
  assert.ok(!/EXAMPLES-ONLY/.test(files[path] || ''), 'never saved into the other folder');
  // And on to a third folder holding the same run: Fill in typed in the team folder stays with the team folder.
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  app.select('fld-action', 'create'); await app.tick();
  app.set('fld-project', 'TEAM-ONLY'); app.select('fld-project', 'TEAM-ONLY'); await app.tick();
  app.click('connect'); await app.tick(200); app.goneUndrawn();
  app.click('open-run', key); await app.tick(40); app.click('go', '', { view: 'run', run: key, step: 'close' }); await app.tick();
  assert.ok(/Release 2026\.10\.16/.test(app.html()), 'set-up: the same run, now from the third folder');
  assert.ok(!/TEAM-ONLY/.test(app.html()), 'not in the third folder');
  app.click('pick', 'close', { kind: 'fields' }); await app.tick();
  assert.ok(!/TEAM-ONLY/.test(app.html()) && !/<option selected>create<\/option>/.test(app.html()), 'nor when Fill in opens there');
  app.click('save-fields', 'close'); await app.tick(60);
  assert.ok(!/TEAM-ONLY/.test(other[path] || ''), 'never saved into the third folder');
});

/* ---------- 1.17 sixth review: a placeholder is watched by what the observer tracks, never by a mark on the node ---------- */
/* Two runs of the release on one publication, whose Pods step shows a screenshot frozen in that publication. Both draw the
   same thumbnail key, so moving from one to the other at that step keeps the placeholder node, as morph does. */
async function twoRunsWithShot(IO) {
  const app = boot({ localStore: { 'preflight:builder': 'false' }, IntersectionObserver: IO }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const a = app.run(), j = a.json;
  j.snapshot = j.snapshot.replace('{#pods}\n', '{#pods}\n  ![The pods](images/release/pods.png)\n'); j.shotsFrozen = true;
  assert.ok(/images\/release\/pods\.png/.test(j.snapshot), 'set-up: the step shows a screenshot');
  await app.fs.write('publications/release/' + j.folder + '/images/release/pods.png', png());
  await app.fs.write(a.path, JSON.stringify(j));
  const b = Object.assign(JSON.parse(JSON.stringify(j)), { id: j.id + '-b', title: 'Release 2026.10.16 (moved here)' });
  delete b.lineage;
  const bPath = a.path.replace(j.id, b.id);
  await app.fs.write(bPath, JSON.stringify(b));
  // Wait, with a bound, until the app has read run B (it's listed on Runs), rather than for a fixed number of ticks: how
  // many turns a refresh takes depends on the elapsed-time schedule.
  app.click('nav', 'runs'); app.click('refresh');
  const end = Date.now() + 5000;
  while (!/Release 2026\.10\.16 \(moved here\)/.test(app.html()) && Date.now() < end) { await app.tick(5); if (!/\(moved here\)/.test(app.html())) app.click('refresh'); }
  assert.ok(/Release 2026\.10\.16 \(moved here\)/.test(app.html()), 'set-up: run B is read');
  app.click('nav', 'home');
  // A redraw Home's clock deferred (250 ms) lands now, not in the middle of the test.
  await new Promise(res => setTimeout(res, 300)); await app.tick(20);
  return { app, A: a.key, B: 'release/' + b.id };
}
const shotKey = html => { const m = /data-thumb="([^"]+)"/.exec(html); return m && m[1].replace(/&amp;/g, '&'); };

rule('A thumbnail loading in one run still loads after moving to another run of the same publication at the same step', async () => {
  const watched = new Set(), observers = [];
  // Like a browser: observing a placeholder that's on screen reports it as in view.
  class IO { constructor(cb) { this.cb = cb; observers.push(this); } observe(el) { watched.add(el); setTimeout(() => { if (watched.has(el)) this.cb([{ isIntersecting: true, target: el }], this); }, 0); } unobserve(el) { watched.delete(el); } disconnect() { watched.clear(); } }
  const { app, A, B } = await twoRunsWithShot(IO);
  let reads = 0; const proto = app.PF.fs.MemoryFS.prototype, orig = proto.blob;
  proto.blob = function (p) { if (/pods\.png$/.test(p)) reads++; return orig.call(this, p); };
  // Hold every thumbnail turn, so the job is still loading when the person moves on.
  const pool = app.PF.repo.poolOf(app.fs), held = [];
  for (let i = 0; i < 4; i++) pool('thumb', () => new Promise(r => held.push(r)));
  app.click('go', '', { view: 'run', run: A, step: 'pods' }); await app.tick(20);
  assert.ok(shotKey(app.html()), 'run A: the screenshot waits');
  assert.strictEqual(watched.size, 0, 'run A: seen, so no longer watched; its job is queued');
  // "Moved to another run": the same publication and step, so the same placeholder.
  app.click('go', '', { view: 'run', run: B, step: 'pods' }); await app.tick(20);
  assert.ok(/Release 2026\.10\.16 \(moved here\)/.test(app.html()) && shotKey(app.html()), 'run B: the same screenshot waits');
  held.forEach(r => r()); await app.tick(60);
  proto.blob = orig;
  assert.ok(!shotKey(app.html()), 'no placeholder left behind');
  assert.ok(/<img alt="The pods" src="blob:/.test(app.html()), 'the screenshot shows in run B');
  assert.strictEqual(reads, 2, 'read once for each run: the discarded job and the one run B asked for, no more');
});

rule('After every redraw, each thumbnail placeholder still waiting is watched or has a job running', async () => {
  for (let seed = 1; seed <= (+process.env.THUMB_SEEDS || 6); seed++) {
    let x = seed * 7919; const rnd = n => { x = (x * 48271) % 2147483647; return x % n; };
    const watched = new Set(), observers = [];
    // This observer reports only when the test says something scrolled into view.
    class IO { constructor(cb) { this.cb = cb; observers.push(this); } observe(el) { watched.add(el); } unobserve(el) { watched.delete(el); } disconnect() { watched.clear(); } }
    const { app, A, B } = await twoRunsWithShot(IO);
    let jobs = 0; const poolOf = app.PF.repo.poolOf;
    app.PF.repo.poolOf = function (fs) { const p = poolOf.call(this, fs); return (lane, fn) => lane !== 'thumb' ? p(lane, fn) : (jobs++, p(lane, fn).then(v => { jobs--; return v; }, e => { jobs--; throw e; })); };
    let held = [];
    // Holds still queued behind others take their turn only once those finish, so release until none is left.
    const releaseAll = async () => { while (held.length) { const h = held; held = []; h.forEach(r => r()); await app.tick(5); } };
    const log = [];
    for (let i = 0; i < 24; i++) {
      const op = rnd(7);
      log.push(op);
      if (op === 0) app.click('go', '', { view: 'run', run: A, step: 'pods' });
      else if (op === 1) app.click('go', '', { view: 'run', run: B, step: 'pods' });
      else if (op === 2) [...watched].forEach(el => observers.forEach(o => o.cb([{ isIntersecting: true, target: el }], o)));
      else if (op === 3) { const pool = poolOf.call(app.PF.repo, app.fs); for (let k = 0; k < 4; k++) pool('thumb', () => new Promise(r => held.push(r))); }
      else if (op === 4) await releaseAll();
      else if (op === 5) app.click('select', rnd(2) ? 'approve' : 'pods');
      else app.click('home');
      await app.tick(40);
      const key = shotKey(app.html());
      if (key) assert.ok([...watched].some(el => el.dataset.thumb === key) || jobs > 0, 'seed ' + seed + ' after ' + log.join(',') + ': the placeholder is neither watched nor loading');
    }
    await releaseAll(); await app.tick(40);
    const key = shotKey(app.html());
    if (key) assert.ok([...watched].some(el => el.dataset.thumb === key), 'seed ' + seed + ' after ' + log.join(',') + ' jobs ' + jobs + ': once every job settled, the waiting placeholder is watched');
    app.PF.repo.poolOf = poolOf;
  }
});

/* ---------- 1.17 slice 1b: freshness by elapsed time, progressive loading, and their races ---------- */
/* Two clocks the test moves: the wall clock (Date, which a person can set back) and elapsed time (performance.now()). */
function clocks() {
  let off = 0, t = 1000;
  class D extends Date { constructor(...a) { if (a.length) super(...a); else super(Date.now() + off); } static now() { return Date.now() + off; } }
  return { D, perf: { now: () => t }, ahead(ms) { off += ms; t += ms; }, wallBack(ms) { off -= ms; }, wallAhead(ms) { off += ms; }, perfAhead(ms) { t += ms; } };
}
const SEPT = 'Release 2026.09.18';
function runFile(app, title) { return Object.keys(app.fs.files).find(p => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(p) && JSON.parse(app.fs.files[p].t).title === title); }
/* An edit another computer made in place: the same number of bytes and the same time, so size and time can't see it. */
function sameSizeEdit(app, path, from, to) {
  const f = app.fs.files[path], t = f.t.split(from).join(to);
  assert.ok(from.length === to.length && t !== f.t, 'set-up: a same-size edit');
  app.fs.files[path] = { t, m: f.m };
}
async function onRuns(k) {
  const app = boot({ Date: k.D, performance: k.perf }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('nav', 'runs'); await app.tick();
  return app;
}
const countLoads = app => { const orig = app.PF.repo.loadAll, n = { loads: 0 }; app.PF.repo.loadAll = function () { n.loads++; return orig.apply(this, arguments); }; return n; };

rule('App: a finished run edited in place at the same size and time shows within an hour of elapsed time, and at once after Refresh', async () => {
  const k = clocks(), app = await onRuns(k), path = runFile(app, SEPT);
  sameSizeEdit(app, path, SEPT, 'RELEASE 2026.09.18');
  k.ahead(31000); app.every(); await app.tick(60);
  assert.ok(app.html().indexOf(SEPT) >= 0, 'size and time say nothing changed, so it isn\'t read yet');
  k.ahead(60 * 60000); app.every(); await app.tick(80);
  assert.ok(/RELEASE 2026\.09\.18/.test(app.html()), 'an hour of elapsed time later, it\'s read in full');
  sameSizeEdit(app, path, 'RELEASE 2026.09.18', 'Release 2026-09-18');
  app.click('refresh'); await app.tick(80);
  assert.ok(/Release 2026-09-18/.test(app.html()), 'Refresh reads it at once');
});

rule('App: setting the computer\'s clock back never delays a refresh or a reread', async () => {
  const k = clocks(), app = await onRuns(k), path = runFile(app, SEPT);
  k.ahead(31000); app.every(); await app.tick(60);
  const n = countLoads(app);
  sameSizeEdit(app, path, SEPT, 'RELEASE 2026.09.18');
  k.wallBack(2 * 3600000);
  k.ahead(31000); app.every(); await app.tick(60);
  assert.ok(n.loads >= 1, 'the routine refresh still came 30 seconds of elapsed time later');
  k.wallBack(2 * 3600000);
  k.ahead(60 * 60000); app.every(); await app.tick(80);
  assert.ok(/RELEASE 2026\.09\.18/.test(app.html()), 'the hour is elapsed time, whatever the wall clock says');
});

rule('App: a hidden tab reads nothing, and when it\'s shown again the runs past their maximum age are read in full', async () => {
  const k = clocks(), app = await onRuns(k), path = runFile(app, SEPT), n = countLoads(app);
  sameSizeEdit(app, path, SEPT, 'RELEASE 2026.09.18');
  app.doc.hidden = true;
  for (let i = 0; i < 3; i++) { k.ahead(30 * 60000); app.every(); await app.tick(20); }
  assert.strictEqual(n.loads, 0, 'nothing is read while the tab is hidden');
  app.doc.hidden = false;
  app.every(); await app.tick(80);
  assert.strictEqual(n.loads, 1, 'one refresh on return');
  assert.ok(/RELEASE 2026\.09\.18/.test(app.html()), 'what went past its maximum age while hidden is read in full');
});

rule('App: a run file that fails to read keeps its last copy and "can\'t be read", and a cached result never clears that; a fresh read does', async () => {
  const k = clocks(), app = await onRuns(k), path = runFile(app, SEPT), good = app.fs.files[path];
  app.fs.files[path] = { t: '{"format":"preflight-run/2","id":', m: good.m + 1 };
  app.click('refresh'); await app.tick(80);
  assert.ok(/A run file can(&#39;|')t be read/.test(app.html()) && app.html().indexOf(SEPT) >= 0, 'marked, and its last copy is still listed');
  /* A refresh that offers only a cached result for it (as if the cache still vouched for it) changes nothing. */
  const orig = app.PF.repo.loadAll, key = path.split('/').slice(1, 3).join('/');
  app.PF.repo.loadAll = function (fs, o) {
    return orig.call(this, fs, Object.assign({}, o, { fresh: [], onBatch: null })).then(d => {
      const built = JSON.parse(good.t); built._fileHash = 'x';
      d.reads[key] = { kind: 'cached', sig: 'cached-sig', fileHash: 'x', build: () => Object.assign({}, built) };
      d.unreadable = d.unreadable.filter(u => u.key !== key);
      return d;
    });
  };
  app.fs.files[path] = good;
  k.ahead(31000); app.every(); await app.tick(80);
  app.click('open-run', key); await app.tick(20);
  assert.ok(/couldn(&#39;|')t be read on the last check/.test(app.html()), 'a cached result never clears the failure');
  app.PF.repo.loadAll = orig;
  app.click('nav', 'runs'); k.ahead(31000); app.every(); await app.tick(80);
  app.click('open-run', key); await app.tick(20);
  assert.ok(!/couldn(&#39;|')t be read on the last check/.test(app.html()), 'the next refresh reads it fresh, which clears it');
});

rule('App: Refresh reads every run file again, whatever the cache knows', async () => {
  const k = clocks(), app = await onRuns(k);
  const reads = new Set(), read = app.fs.read.bind(app.fs); app.fs.read = p => { if (/^runs\/[^/]+\/[^/]+\/run\.json$/.test(p)) reads.add(p); return read(p); };
  k.ahead(31000); app.every(); await app.tick(60);
  const all = Object.keys(app.fs.files).filter(p => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(p));
  assert.ok(reads.size < all.length, 'a routine refresh reads only some: ' + reads.size + ' of ' + all.length);
  reads.clear();
  app.click('refresh'); await app.tick(80);
  assert.strictEqual(reads.size, all.length, 'Refresh reads them all');
});

/* A real team folder holding the examples' runs, whose run files the test can hold back so a first open arrives in batches. */
function heldFolder(app) {
  const files = {}; sameRunsFolder(app, files);
  const proto = app.PF.fs.FolderFS.prototype, read = proto.read, held = [];
  let hold = null;
  proto.read = function (p) { if (hold && hold.test(p)) return new Promise(res => held.push(() => res(read.call(this, p)))); return read.call(this, p); };
  return { files, held, holdRuns(re) { hold = re; }, release(n) { held.splice(0, n == null ? held.length : n).forEach(f => f()); }, restore() { proto.read = read; } };
}

rule('App: a big folder\'s first open shows runs as they\'re read, says it\'s still reading, and never calls a run not read yet gone', async () => {
  const files = {}, picker = folderHandle('Team', files);
  const app = boot({ picker, indexedDB: memoryIDB() }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const h = heldFolder(app); Object.assign(files, h.files);
  app.PF.repo.config.batch = 1;
  h.holdRuns(/^runs\/release\/[^/]+\/run\.json$/);
  app.click('connect'); await app.tick(200);
  app.choose('person-casey'); await app.tick(40);
  let html = app.html();
  assert.ok(/Still reading runs \(\d+ of 13\)/.test(html), 'Home says it\'s still reading, with counts: ' + (/Still reading[^<]*/.exec(html) || [''])[0]);
  assert.ok(/Runs you(&#39;|')re recording may not be listed yet/.test(html), 'and that runs being recorded may be missing');
  assert.ok(!/gone|can(&#39;|')t be read/.test(html), 'nothing not read yet is called gone or unreadable');
  app.click('nav', 'runs'); await app.tick(20);
  html = app.html();
  assert.ok(/Still reading runs/.test(html), 'Runs says so too');
  assert.ok(/Check in code for Release 2026\.09\.18/.test(html), 'runs read so far are listed');
  assert.ok(!/Release 2026\.10\.16/.test(html.replace(/Check in code for Release 2026\.10\.16/g, '')), 'a run not read yet isn\'t listed yet');
  h.holdRuns(null); h.release(); await app.tick(200);
  html = app.html();
  assert.ok(!/Still reading runs/.test(html), 'done reading');
  assert.ok(/Release 2026\.09\.18/.test(html) && /Release 2026\.10\.16/.test(html), 'every run is listed');
  h.restore();
});

rule('App: a run never in any batch is never marked gone, even when the batches before it were complete', async () => {
  const files = {}, picker = folderHandle('Team', files);
  const app = boot({ picker, indexedDB: memoryIDB() }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const h = heldFolder(app); Object.assign(files, h.files);
  app.PF.repo.config.batch = 1;
  app.click('connect'); await app.tick(200);
  app.click('nav', 'runs'); await app.tick(20);
  /* A deep refresh in batches, with one run's file held back until the end. */
  h.holdRuns(/^runs\/release\/[^/]+\/run\.json$/);
  app.click('refresh'); await app.tick(120);
  assert.ok(!/is gone|file is gone/.test(app.html()), 'held runs are pending, never gone');
  assert.ok(/Release 2026\.10\.16/.test(app.html()), 'and they stay listed as last read');
  h.holdRuns(null); h.release(); await app.tick(120);
  assert.ok(!/is gone|file is gone/.test(app.html()));
  h.restore();
});

rule('App: switching folders in the middle of a batched first open drops every later batch from the old folder', async () => {
  const files = {}, other = { 'people.json': JSON.stringify([{ id: 'person-casey', name: 'Casey Example', email: 'casey@example.com' }]) };
  const opts = { picker: folderHandle('Team', files), indexedDB: memoryIDB() }, app = boot(opts); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const h = heldFolder(app); Object.assign(files, h.files);
  app.PF.repo.config.batch = 1;
  h.holdRuns(/^runs\/.*\/run\.json$/);
  app.click('connect'); await app.tick(100);
  h.release(2); await app.tick(40);
  opts.picker = folderHandle('Other', other);
  h.holdRuns(null);
  app.click('connect'); await app.tick(150);
  h.release(); await app.tick(150);
  app.click('nav', 'runs'); await app.tick(40);
  const html = app.html();
  assert.ok(!/Release 2026|Check in code/.test(html), 'nothing from the first folder shows in the second');
  assert.ok(!/Still reading runs/.test(html), 'the second folder finished reading');
  h.restore();
});

/* A seeded walk through a recorded run while the rest of the folder arrives in batches: reads of other runs wait until the
   walk lets them go. Whatever the order, no run is shown gone, a discarded change never reaches the folder, and the last
   read agrees with the folder. High bits only: an LCG's low bits cycle, which would leave actions never chosen. */
rule('App: in any order of batched reads, edits, refused saves, Discard, keeping a copy, newer reads of the open run and switching folders, nothing is lost or shown gone', async () => {
  for (let seed = 1; seed <= (+process.env.LOAD_SEEDS || 8); seed++) {
    let x = seed * 2654435761 >>> 0; const rnd = n => { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; return (x >>> 16) % n; };
    const k = clocks(), other = { 'people.json': JSON.stringify([{ id: 'person-casey', name: 'Casey Example', email: 'casey@example.com' }]) };
    const app = boot({ localStore: { 'preflight:builder': 'false' }, Date: k.D, performance: k.perf, picker: folderHandle('Other', other), indexedDB: memoryIDB() }); await app.tick(60);
    app.choose('person-casey'); await app.tick();
    app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
    const run = app.run(), path = run.path, dir = path.replace(/\/run\.json$/, '');
    app.PF.repo.config.batch = 1;
    const titles = Object.keys(app.fs.files).filter(p => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(p)).map(p => JSON.parse(app.fs.files[p].t)).filter(j => j.ended).map(j => j.title);
    const queue = [], inner = app.fs.read.bind(app.fs);
    app.fs.read = p => (/^runs\//.test(p) && p.indexOf(dir + '/') !== 0 ? new Promise(res => queue.push(() => res(inner(p)))) : inner(p));
    const discarded = new Set(), log = []; let n = 0, switched = false;
    const disk = () => JSON.parse(app.fs.files[path].t);
    const commitShown = () => { const m = /<span class="k">commit<\/span> <code>([^<]*)<\/code>/.exec(app.html()); return m ? m[1] : null; };
    const commit = v => { app.click('edit', 'detail:commit'); app.set('edit-input', v); app.click('save-edit'); };
    for (let step = 0; step < 40 && !switched; step++) {
      const a = ['refresh', 'refresh', 'release', 'release', 'release', 'release-all', 'edit', 'edit', 'external', 'discard', 'keep-copy', 'reread', 'runs', 'switch'][rnd(14)];
      log.push(a);
      const where = () => 'seed ' + seed + ' after ' + log.join(',');
      if (a === 'refresh') app.click('refresh');
      else if (a === 'release') { const f = queue.shift(); if (f) f(); }
      else if (a === 'release-all') queue.splice(0).forEach(f => f());
      else if (a === 'edit') commit('V' + seed + '-' + (++n));
      else if (a === 'external') {
        /* Another computer saves the run: this window's next save is refused and kept as a conflict copy, and its reread is a
           newer read of the open run than any batch still on its way. */
        const j = disk(); j.rev += 1; j.details.environment = 'E' + seed + '-' + (++n); j.savedAt = new Date().toISOString();
        app.fs.files[path] = { t: JSON.stringify(j, null, 2), m: Date.now() };
      }
      else if (a === 'discard') {
        const shown = commitShown(), pending = /Your last change isn(&#39;|')t saved/.test(app.html());
        app.click('discard-unsaved'); await app.tick(5);
        if (pending && shown && disk().details.commit !== shown && !/Wait for the save to finish/.test(app.html())) discarded.add(shown);
      }
      else if (a === 'keep-copy') { const m = /data-act="use-copy" data-id="([^"]+)"/.exec(app.html()); if (m) { app.click('use-copy', m[1].replace(/&amp;/g, '&')); discarded.clear(); } }
      else if (a === 'reread') { k.ahead(6000); app.every(); }
      else if (a === 'runs') {
        app.click('nav', 'runs'); await app.tick(20);
        const html = app.html();
        titles.forEach(t => assert.ok(html.indexOf('>' + t + '<') >= 0, 'a run read before stays listed while others are read again: ' + t + ' · ' + where()));
        app.click('open-run', run.key); await app.tick(10);
      }
      else if (a === 'switch') { switched = true; app.click('connect'); }
      await app.tick(30);
      const html = app.html();
      assert.ok(!/file is gone from the team folder|is gone from the team folder/.test(html), 'a run shown gone · ' + where());
      const d = disk();
      assert.ok(!discarded.has(d.details.commit), 'a discarded change reached the folder: ' + d.details.commit + ' · ' + where());
    }
    queue.splice(0).forEach(f => f()); await app.tick(80);
    if (switched) {
      await app.tick(100); app.click('nav', 'runs'); await app.tick(40);
      assert.ok(!titles.some(t => app.html().indexOf('>' + t + '<') >= 0), 'nothing from the first folder after switching · seed ' + seed + ' · ' + log.join(','));
      continue;
    }
    app.fs.read = inner;
    app.click('refresh'); await app.tick(120);
    const html = app.html();
    assert.ok(!/is gone from the team folder|couldn(&#39;|')t be read on the last check|Still reading runs/.test(html), 'final: settled · seed ' + seed + ' · ' + log.join(','));
    if (!/Your last change isn(&#39;|')t saved/.test(html)) assert.strictEqual(commitShown(), disk().details.commit, 'final: the screen agrees with the folder · seed ' + seed + ' · ' + log.join(','));
    assert.ok(!discarded.has(disk().details.commit), 'final: no discarded change in the folder · seed ' + seed);
  }
});

rule('App: after the computer slept (elapsed timer paused, wall clock 8 hours on), coming back reads every run past its age', async () => {
  const k = clocks(), app = await onRuns(k), path = runFile(app, SEPT);
  k.ahead(31000); app.every(); await app.tick(60);
  sameSizeEdit(app, path, SEPT, 'RELEASE 2026.09.18');
  k.wallAhead(8 * 3600000); k.perfAhead(1000);
  app.fire('visibilitychange'); app.focus(); app.every(); await app.tick(80);
  assert.ok(/RELEASE 2026\.09\.18/.test(app.html()), 'coming back after sleep reads what went past its age');
});

rule('App: focusing the window while a run is open rereads that run, never the whole folder each time', async () => {
  const k = clocks(), app = boot({ Date: k.D, performance: k.perf }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(40);
  const n = countLoads(app);
  for (let s = 1; s <= 300; s++) { k.ahead(1000); if (s % 10 === 0) app.focus(); app.every(); await app.tick(5); }
  assert.ok(n.loads <= 6, 'about one full refresh a minute, as without focusing: ' + n.loads);
});

rule('App: a run open in this window that also writes a note every 45 s still shows another computer\'s same-size note edit within its 5-minute age', async () => {
  const k = clocks(), app = boot({ Date: k.D, performance: k.perf }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  const run = app.run(), [proc, id] = run.key.split('/'), np = run.path.replace('run.json', 'notes-blake-laptop.jsonl');
  await app.fs.write(np, JSON.stringify({ id: 'b1', at: new Date().toISOString(), by: 'person-blake', step: 'announce', text: 'BLAKEFIRST' }) + '\n');
  for (let i = 0; i < 70; i++) { k.ahead(1000); app.every(); await app.tick(5); }
  app.click('select', 'announce'); await app.tick(20);
  assert.ok(/BLAKEFIRST/.test(app.html()), 'set-up: the note shows on its step');
  const f = app.fs.files[np]; app.fs.files[np] = { t: f.t.replace('BLAKEFIRST', 'BLAKEOTHER'), m: f.m };
  let seen = null;
  for (let s = 1; s <= 8 * 60 && seen == null; s++) {
    k.ahead(1000);
    if (s % 45 === 0) await app.PF.repo.addNote(app.fs, { process: proc, id }, 'casey-laptop', { id: 'c' + s, at: new Date().toISOString(), by: 'person-casey', step: 'announce', text: 'casey ' + s });
    app.every(); await app.tick(5);
    if (/BLAKEOTHER/.test(app.html())) seen = s;
  }
  assert.ok(seen != null && seen <= 6 * 60, 'shown at ' + seen + ' s');
});

/* ---------- 1.17: insights (docs/design.md section 23) ---------- */
rule('Insights: a number opens exactly the runs behind it on Runs, a change since is said, and Back to How runs go returns to the version picked', async () => {
  const app = boot(); await app.tick(80);
  app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'insights'); await app.tick();
  const v1 = /<option value="(v1-[^"]+)" selected>/.exec(app.html());
  assert.ok(v1, 'the version with runs is picked');
  const m = /data-act="ins-runs" data-id="(step:pods:offScript)">(\d+) of (\d+) runs</.exec(app.html());
  assert.ok(m, 'Any off-script on a step, out of its own runs');
  app.click('ins-runs', m[1]); await app.tick();
  let html = app.html();
  assert.ok(/id="ins-banner"/.test(html) && /Back to How runs go/.test(html), 'the banner');
  const shown = (html.match(/data-act="open-run" data-id="([^"]+)"/g) || []).map(x => x.split('"')[3]);
  assert.strictEqual(shown.length, +m[2], 'exactly the runs counted');
  assert.ok(!/changed since/.test(html));
  // Another computer changes one of them.
  const path = 'runs/' + shown[0] + '/run.json', o = JSON.parse(app.fs.files[path].t);
  o.rev = (o.rev || 0) + 1; o.title = o.title + ' (edited)';
  app.fs.files[path] = Object.assign({}, app.fs.files[path], { t: JSON.stringify(o, null, 2), m: Date.now() + 1000 });
  app.click('refresh'); await app.tick(80);
  html = app.html();
  assert.ok(/1 of these runs changed since\./.test(html) && /data-act="ins-refresh"/.test(html), 'the change is said');
  assert.strictEqual((html.match(/data-act="open-run"/g) || []).length, +m[2], 'still the cohort clicked, not asked again');
  app.click('ins-refresh'); await app.tick();
  assert.ok(!/changed since/.test(app.html()), 'current numbers');
  app.click('ins-back'); await app.tick();
  html = app.html();
  assert.ok(/How runs go/.test(html) && new RegExp('<option value="' + v1[1] + '" selected>').test(html), 'back on the version picked');
  assert.ok(!/id="ins-banner"/.test(html));
  app.click('nav', 'runs'); await app.tick();
  assert.ok(!/id="ins-banner"/.test(app.html()) && /Finished/.test(app.html()), 'Back leaves Runs unfiltered');
});

rule('Insights: picking another version redraws the numbers for that folder only; Runs filters narrow the list and each chip removes one', async () => {
  const app = boot(); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'insights'); await app.tick();
  const v2 = /<option value="(v2-[^"]+)"/.exec(app.html())[1];
  app.select('ins-folder', v2); await app.tick();
  assert.ok(new RegExp('<option value="' + v2 + '" selected>').test(app.html()) && /data-id="runs:all"/.test(app.html()) === false, 'v2 has no runs of its own: nothing borrowed from v1');
  app.click('nav', 'runs'); await app.tick();
  app.select('rf-process', 'release'); await app.tick();
  app.select('rf-outcome', 'Completed'); await app.tick();
  let html = app.html();
  const n = +/Matching runs · (\d+)/.exec(html)[1];
  assert.ok(n > 0 && (html.match(/data-act="open-run"/g) || []).length === n, 'only matching runs');
  app.click('rf-clear', 'outcome'); await app.tick();
  assert.ok(+/Matching runs · (\d+)/.exec(app.html())[1] > n, 'the chip removed one filter');
  app.click('rf-clear', 'all'); await app.tick();
  assert.ok(!/Matching runs/.test(app.html()) && /Finished/.test(app.html()));
});


/* ---------- 1.17: Search (docs/design.md section 22) ---------- */
const sxBox = app => { const q = app.el('sx-q'); q.tagName = 'INPUT'; q.type = 'search'; return q; };
const sxType = async (app, text) => { sxBox(app); app.input('sx-q', text); await app.tick(40); };
const sxKey = (app, key, mods) => app.keyOn(key, mods, sxBox(app));
const sxIds = app => [...app.overlay().matchAll(/role="option"[^>]*data-id="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));

rule('Search: Ctrl+K opens it from anywhere, / only while single-key shortcuts are on, and never while typing or composing', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.keyOn('k', { ctrlKey: true }); await app.tick(40);
  assert.ok(/role="combobox"/.test(app.overlay()), 'Ctrl+K opened it');
  assert.ok(/Search runs, steps, notes, corrections, follow-ups, step types and skills\./.test(app.overlay()), 'the empty state says what it searches');
  app.key('Escape'); await app.tick();
  assert.strictEqual(app.overlay(), '', 'Escape closed it');
  app.keyOn('k', { metaKey: true }); await app.tick(40);
  assert.strictEqual(app.overlay(), '', 'off a Mac, the Windows or Super key with K is not taken');
  app.key('/'); await app.tick(40);
  assert.ok(/role="combobox"/.test(app.overlay()), '/ opened it'); app.key('Escape'); await app.tick();
  app.keyOn('/', { isComposing: true }); await app.tick();
  assert.strictEqual(app.overlay(), '', 'not while an input method is composing');
  app.keyOn('/', {}, { tagName: 'TEXTAREA', id: 'note-text', dataset: {}, closest: () => null }); await app.tick();
  assert.strictEqual(app.overlay(), '', 'not while typing');
  app.click('toggle-keys'); await app.tick();
  app.key('/'); await app.tick();
  assert.strictEqual(app.overlay(), '', 'not with single-key shortcuts off');
  app.keyOn('k', { ctrlKey: true }); await app.tick(40);
  assert.ok(/role="combobox"/.test(app.overlay()), 'Ctrl+K still works with them off');
  app.click('search'); await app.tick();
  assert.ok(/role="combobox"/.test(app.overlay()), 'and the top bar button');
  assert.ok(/data-act="search"/.test(app.top()), 'the button is in the top bar');
});

rule('Search: results are grouped and highlighted, the arrow keys move the active one, and Enter goes there through go()', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.keyOn('k', { ctrlKey: true }); await app.tick(40);
  await sxType(app, 'deploy');
  const ov = app.overlay();
  assert.ok(/role="listbox"/.test(ov) && /role="group"/.test(ov) && /<mark>deploy<\/mark>/i.test(ov), 'a grouped, highlighted list');
  const ids = sxIds(app);
  assert.ok(ids.length >= 2, 'set-up: several results: ' + ids.join(', '));
  assert.ok(new RegExp('aria-activedescendant="sx-o-0"').test(ov) && /id="sx-o-0"[^>]*aria-selected="true"/.test(ov), 'the first is active');
  sxKey(app, 'ArrowDown'); await app.tick();
  assert.ok(/aria-activedescendant="sx-o-1"/.test(app.overlay()), 'Down moves to the next');
  sxKey(app, 'ArrowUp'); sxKey(app, 'ArrowUp'); await app.tick();
  assert.ok(new RegExp('aria-activedescendant="sx-o-' + (ids.length - 1) + '"').test(app.overlay()), 'Up from the first wraps to the last');
  sxKey(app, 'ArrowDown'); await app.tick();
  const home = app.html(), active = /aria-selected="true" data-act="sx-open" data-id="([^"]+)"/.exec(app.overlay())[1];
  assert.strictEqual(active, ids[0].replace(/&/g, '&amp;'), 'back on the first');
  sxKey(app, 'Enter'); await app.tick(40);
  assert.strictEqual(app.overlay(), '', 'Enter closed it');
  assert.notStrictEqual(app.html(), home, 'and went to the result');
});

rule('Search: an open palette that receives new data shows the new result without another keystroke, and keeps the active row', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  await sxType(app, 'zebracrossing');
  assert.ok(/Nothing matches “zebracrossing”\. Try fewer words, or a ticket like ABC-123\./.test(app.overlay()), 'set-up: nothing yet');
  const { key } = app.run();
  await app.fs.write('runs/' + key + '/notes-other.jsonl', JSON.stringify({ id: 'zz1', at: '2026-10-16T10:00:00.000Z', by: 'person-blake', session: 'other', step: 'pods', text: 'The zebracrossing sign was down', files: [] }) + '\n');
  app.focus(); await app.tick(120);
  assert.ok(/<mark>zebracrossing<\/mark>/.test(app.overlay()), 'the new note is listed without typing again');
  assert.ok(/1 result/.test(app.live()), 'and the count is announced: ' + app.live());
  await sxType(app, 'deploy');
  sxKey(app, 'ArrowDown'); sxKey(app, 'ArrowDown'); await app.tick();
  const activeId = () => /aria-selected="true" data-act="sx-open" data-id="([^"]+)"/.exec(app.overlay())[1];
  const was = activeId(), notesN = () => +((/>Notes <span>([\d,]+)<\/span>/.exec(app.overlay()) || [0, 0])[1]), n0 = notesN();
  await app.fs.write('runs/' + key + '/notes-third.jsonl', JSON.stringify({ id: 'zz2', at: '2026-10-16T11:00:00.000Z', by: 'person-blake', session: 'third', step: 'pods', text: 'Deploy deploy deploy, the deploy', files: [] }) + '\n');
  app.focus(); await app.tick(120);
  assert.strictEqual(notesN(), n0 + 1, 'set-up: the new note is counted');
  assert.strictEqual(activeId(), was, 'the active row is the same result');
});

rule('Search: a note replaced with other words, same number of notes, is found by its new words in the open palette', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  const { key } = app.run(), path = 'runs/' + key + '/notes-other.jsonl';
  const line = text => JSON.stringify({ id: 'zz1', at: '2026-10-16T10:00:00.000Z', by: 'person-blake', session: 'other', step: 'pods', text, files: [] }) + '\n';
  await app.fs.write(path, line('Quokkas everywhere')); app.click('refresh'); await app.tick(120);
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  await sxType(app, 'quokkas');
  assert.ok(/<mark>Quokkas<\/mark>/.test(app.overlay()), 'set-up: found');
  await app.fs.write(path, line('Wombats everywhere')); app.focus(); await app.tick(120);
  assert.ok(!/<mark>Quokkas<\/mark>/.test(app.overlay()), 'the old words no longer find it');
  await sxType(app, 'wombats');
  assert.ok(/<mark>Wombats<\/mark>/.test(app.overlay()), 'the new words do');
});

rule('Search: a run whose file couldn\'t be read is still searched from its last copy, marked, and counted in the footer', async () => {
  const app = boot(); await app.tick(60);
  const path = endedPath(app), title = JSON.parse(app.fs.files[path].t).title;
  app.fs.files[path] = { t: '{"format":"preflight-run/2","id":', m: app.fs.files[path].m };
  app.click('refresh'); await app.tick(120);
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  await sxType(app, title);
  assert.ok(/Couldn(&#39;|’|')t be read; last copy/.test(app.overlay()), 'the result is marked');
  assert.ok(/1 run file couldn(&#39;|’|')t be read; its last copy is searched and marked\./.test(app.overlay()), 'the footer says so');
  assert.ok(/Folder last read \d{1,2}:\d{2}:\d{2}/.test(app.overlay()), 'and when the folder was last read');
});

rule('Search: opening a result never loses typing: an unsent note comes back, unapplied builder text refuses, and a dialog with typing isn\'t replaced', async () => {
  const app = await recordingRelease(), key = app.run().key;
  app.click('select', 'approve'); await app.tick();
  app.set('note-text', 'unsent words'); await app.tick();
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  await sxType(app, 'production release');
  const proc = sxIds(app).find(id => /^pub:release\//.test(id));
  assert.ok(proc, 'set-up: the process is listed: ' + sxIds(app).join(', '));
  app.click('sx-open', proc); await app.tick(40);
  assert.ok(/data-act="ptab"/.test(app.html()), 'on the process page');
  app.click('go', '', { view: 'run', run: key, step: 'approve' }); await app.tick();
  assert.strictEqual(app.draft('note-text'), 'unsent words', 'the unsent note came back');

  const b = await builderOn();
  b.click('ob-sel', 'flags'); await b.tick();
  b.input('ob-text', 'Half typed'); await b.tick();
  b.keyOn('k', { ctrlKey: true }); await b.tick(60);
  await sxType(b, 'runs');
  b.click('sx-open', 'page:runs'); await b.tick(40);
  assert.strictEqual(b.overlay(), '', 'the palette closed so the message and the box can be seen');
  assert.ok(/Apply or clear what you typed in the box first/.test(b.html()), 'says why');
  assert.ok(b.draft('ob-text') === 'Half typed' && b.focused() === '#ob-text', 'the typing stays, with focus on it');

  const c = boot(); await c.tick(80); c.choose('person-morgan'); await c.tick();
  c.click('open-process', 'release'); await c.tick(20);
  const id = /data-act="corr-review" data-id="([\w-]+)"/.exec(c.html())[1];
  c.click('corr-review', id); await c.tick(20); c.click('corr-ca-declining'); await c.tick();
  c.set('ca-reason', 'Not this time'); await c.tick();
  c.keyOn('k', { ctrlKey: true }); await c.tick(40);
  assert.ok(/id="ca-reason"/.test(c.overlay()) && !/role="combobox"/.test(c.overlay()), 'the dialog with typing stays');
  assert.ok(/Finish or cancel this first\./.test(c.live() + c.html()));
  c.click('help'); await c.tick();
});

rule('Search: a read-only dialog gives way to it, and on a phone a jump from it closes the step sheet', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('help'); await app.tick();
  app.keyOn('k', { ctrlKey: true }); await app.tick(40);
  assert.ok(/role="combobox"/.test(app.overlay()) && !/Keyboard/.test(app.overlay()), 'help gave way');
  const ph = boot({ narrow: true }); await ph.tick(60); ph.choose('person-casey'); await ph.tick();
  const key = ph.run().key;
  ph.click('open-run', key); await ph.tick(); ph.click('select', 'approve'); await ph.tick();
  assert.ok(/id="rw-ins"[^>]*data-open="true"/.test(ph.html()), 'set-up: the step sheet is open');
  ph.keyOn('k', { ctrlKey: true }); await ph.tick(40);
  await sxType(ph, 'pods');
  const hit = sxIds(ph).find(x => /^step:|^note:|^run:/.test(x));
  assert.ok(hit, 'set-up: a result: ' + sxIds(ph).join(', '));
  ph.click('sx-open', hit); await ph.tick(40);
  assert.strictEqual(ph.overlay(), '');
  assert.ok(!/id="rw-ins"[^>]*data-open="true"/.test(ph.html()), 'the sheet closed');
});

rule('Search: switching folders while the index is being built leaves nothing from the old folder', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  const { key } = app.run();
  await app.fs.write('runs/' + key + '/notes-other.jsonl', JSON.stringify({ id: 'zz1', at: '2026-10-16T10:00:00.000Z', by: 'person-blake', session: 'other', step: 'pods', text: 'Oldfolderword here', files: [] }) + '\n');
  app.click('refresh'); await app.tick(120);
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  await sxType(app, 'oldfolderword');
  assert.ok(/<mark>Oldfolderword<\/mark>/.test(app.overlay()), 'set-up: found in this folder');
  app.key('Escape'); await app.tick();
  const jobs = []; const start = app.PF.search.start;
  app.PF.search.start = function () { const j = start.apply(this, arguments); jobs.push(j); return j; };
  // A build starts (the data changed), and the folder is switched before it can finish.
  app.keyOn('k', { ctrlKey: true });
  app.click('reset-examples');
  await app.tick(120);
  app.PF.search.start = start;
  assert.ok(jobs.length >= 1 && jobs.slice(0, -1).every(j => j.canceled || j.done), 'the older build stopped');
  if (!/role="combobox"/.test(app.overlay())) { app.keyOn('k', { ctrlKey: true }); await app.tick(60); }
  await sxType(app, 'oldfolderword');
  assert.ok(!/<mark>Oldfolderword<\/mark>/.test(app.overlay()), 'nothing from the old folder');
  assert.ok(/Nothing matches/.test(app.overlay()));
});

/* ---------- Search, after review ---------- */
rule('Search: background refreshes that change nothing shown are not announced again; a change in the results is', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  const { key } = app.run();
  app.click('open-run', key); await app.tick(60);
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  await sxType(app, 'deploy');
  for (let i = 0; i < 6; i++) { app.el('live').textContent = 'SENTINEL'; app.every(); await app.tick(80); assert.strictEqual(app.live(), 'SENTINEL', 'refresh ' + i + ' said nothing'); }
  for (let i = 0; i < 2; i++) { app.el('live').textContent = 'SENTINEL'; app.focus(); await app.tick(150); assert.strictEqual(app.live(), 'SENTINEL', 'focus ' + i + ' said nothing'); }
  await app.fs.write('runs/' + key + '/notes-other.jsonl', JSON.stringify({ id: 'zz9', at: '2026-10-16T10:00:00.000Z', by: 'person-blake', session: 'other', step: 'pods', text: 'Deploy waited', files: [] }) + '\n');
  app.click('refresh'); await app.tick(150);
  assert.ok(/\d+ results/.test(app.live()), 'a new result is announced: ' + app.live());
});

rule('Search: a result whose target is gone keeps the palette open and says so', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  const query = app.PF.search.query;
  app.PF.search.query = function () { const r = query.apply(this, arguments); r.groups.unshift({ kind: 'run', label: 'Runs', total: 1, items: [{ id: 'run:release/gone', kind: 'run', title: 'Gone run', sub: '', text: '', target: { view: 'run', run: 'release/gone' }, status: '', at: '' }] }); r.total++; return r; };
  await sxType(app, 'gone');
  app.click('sx-open', 'run:release/gone'); await app.tick(40);
  app.PF.search.query = query;
  assert.ok(/role="combobox"/.test(app.overlay()), 'still open');
  assert.ok(/That run isn(&#39;|')t in this folder anymore\./.test(app.overlay()), 'says so in the palette');
  assert.ok(/That run isn't in this folder anymore\./.test(app.live()), 'and to screen readers');
});

rule('Search: opening a process moves focus to its heading', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  await sxType(app, 'production release');
  const proc = sxIds(app).find(id => /^pub:release\//.test(id));
  app.click('sx-open', proc); await app.tick(40);
  assert.ok(/<h1 id="page-h" tabindex="-1">Production release<\/h1>/.test(app.html()), 'the heading can take focus');
  assert.strictEqual(app.focused(), 'page-h');
});

rule('Search: on a Mac, Cmd+K opens it and Ctrl+K is left to the text box', async () => {
  const mac = boot({ navigator: { platform: 'MacIntel' } }); await mac.tick(60); mac.choose('person-casey'); await mac.tick();
  const box = { tagName: 'INPUT', id: 'me', dataset: {}, closest: () => null };
  mac.keyOn('k', { ctrlKey: true }, box); await mac.tick(40);
  assert.strictEqual(mac.overlay(), '', 'Ctrl+K in a text box on a Mac does nothing here');
  mac.keyOn('k', { metaKey: true }, box); await mac.tick(40);
  assert.ok(/role="combobox"/.test(mac.overlay()), 'Cmd+K opens search');
  assert.ok(/aria-keyshortcuts="Meta\+K"/.test(mac.top()) && /⌘K/.test(mac.top()), 'the button says Cmd+K');
  const pc = boot(); await pc.tick(60); pc.choose('person-casey'); await pc.tick();
  pc.keyOn('k', { ctrlKey: true }, box); await pc.tick(40);
  assert.ok(/role="combobox"/.test(pc.overlay()), 'elsewhere Ctrl+K opens it');
  assert.ok(/aria-keyshortcuts="Control\+K"/.test(pc.top()));
});

rule('Search: while the folder is still being read, the palette says how far it got and fills in as runs arrive', async () => {
  const files = {}, picker = folderHandle('Team', files);
  const app = boot({ picker, indexedDB: memoryIDB() }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const h = heldFolder(app); Object.assign(files, h.files);
  app.PF.repo.config.batch = 1;
  h.holdRuns(/^runs\/release\/[^/]+\/run\.json$/);
  app.click('connect'); await app.tick(200);
  app.choose('person-casey'); await app.tick(40);
  app.keyOn('k', { ctrlKey: true }); await app.tick(40);
  await sxType(app, 'release 2026');
  let ov = app.overlay();
  assert.ok(/Still reading \d+ of 13 runs\./.test(ov), 'says how far the folder\'s first read got: ' + (/sx-foot[^>]*>([^<]*)/.exec(ov) || [])[1]);
  assert.ok(/Check in code for <mark>Release<\/mark> <mark>2026<\/mark>/.test(ov), 'runs read so far are found');
  assert.ok(!/>Release 2026\.10\.16</.test(ov.replace(/<\/?mark>/g, '')), 'a run not read yet isn\'t');
  h.holdRuns(null); h.release(); await app.tick(200);
  ov = app.overlay();
  assert.ok(!/Still reading/.test(ov), 'done reading');
  assert.ok(/<mark>Release<\/mark> <mark>2026<\/mark>\.10\.16/.test(ov), 'the rest arrived without typing again');
  h.restore();
});

/* ---------- Search, second review ---------- */
rule('Search: Ctrl+K puts focus in the search box, so typing right away lands there, also when it was already open', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  const doc = app.doc, ov = app.el('overlay'), q = sxBox(app), drawn = () => /id="sx-q"/.test(ov.innerHTML);
  q.focus = function () { doc.activeElement = this; };
  ov.querySelector = sel => sel === '#sx-q' && drawn() ? q : null;
  ov.contains = el => el === q && drawn();
  app.keyOn('k', { ctrlKey: true }); await app.tick(40);
  assert.strictEqual(doc.activeElement, q, 'focus is in the search box');
  const t = doc.activeElement; t.value = 'deploy'; app.fire('input', { target: t }); await app.tick(40);
  assert.ok(/<mark>deploy<\/mark>/i.test(app.overlay()), 'what was typed is searched');
  doc.activeElement = doc.body;
  app.keyOn('k', { ctrlKey: true }); await app.tick(40);
  assert.strictEqual(doc.activeElement, q, 'Ctrl+K on the open palette brings focus back to the box');
});

rule('Search: a result for a version or a step that left the folder says so and never opens another version', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  const folders = [...new Set(app.files('publications/release/').map(p => p.split('/')[2]))].sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
  const v1 = folders.find(f => /^v1-/.test(f)), latest = folders[folders.length - 1];
  assert.ok(v1 && latest !== v1, 'set-up: release has v1 and a later version');
  app.files('publications/release/' + v1 + '/').forEach(p => { delete app.fs.files[p]; });
  app.click('refresh'); await app.tick(150);
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  /* What a catch-up still under way can show: results listed before v1 was removed. */
  const stale = [{ id: 'pub:release/' + v1, kind: 'version', title: 'Production release', sub: 'v1', text: '', target: { view: 'process', process: 'release', mapVer: v1 }, status: '', at: '' },
    { id: 'step:release/' + latest + '/no-such-step', kind: 'step', title: 'Gone step', sub: '', text: '', target: { view: 'process', process: 'release', mapVer: latest, step: 'no-such-step' }, status: '', at: '' }];
  const query = app.PF.search.query;
  app.PF.search.query = function () { const r = query.apply(this, arguments); r.groups.unshift({ kind: 'version', label: 'Versions', total: 2, items: stale }); r.total += 2; return r; };
  await sxType(app, 'production');
  const home = app.html();
  app.click('sx-open', stale[0].id); await app.tick(40);
  assert.ok(/role="combobox"/.test(app.overlay()), 'still open');
  assert.ok(/That version isn(&#39;|')t in this folder anymore\./.test(app.overlay()), 'says the version is gone');
  assert.strictEqual(app.html(), home, 'no other version was opened');
  app.click('sx-open', stale[1].id); await app.tick(40);
  app.PF.search.query = query;
  assert.ok(/That step isn(&#39;|')t in this folder anymore\./.test(app.overlay()), 'says the step is gone');
  assert.strictEqual(app.html(), home, 'and stayed put');
});

rule('Search: a ticket changed on the open run is found by its new value even when its save fails, and the old one no longer finds the run', async () => {
  const app = await recordingRelease(), key = app.run().key, old = app.run().json.details.ticket;
  assert.ok(old, 'set-up: the run has a ticket');
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  await sxType(app, old);
  assert.ok(sxIds(app).indexOf('run:' + key) >= 0, 'set-up: the old ticket finds the run');
  app.key('Escape'); await app.tick();
  const orig = app.PF.repo.saveRun;
  app.PF.repo.saveRun = () => Promise.reject(new Error('offline'));
  app.click('edit', 'detail:ticket'); app.set('edit-input', 'ABC-9876'); app.click('save-edit'); await app.tick(60);
  assert.ok(/ABC-9876/.test(app.html()) && !/ABC-9876/.test(app.fs.files[app.run().path].t), 'set-up: shown, not saved');
  app.keyOn('k', { ctrlKey: true }); await app.tick(60);
  await sxType(app, 'ABC-9876');
  assert.ok(sxIds(app).indexOf('run:' + key) >= 0, 'the new ticket finds the run');
  await sxType(app, old);
  assert.ok(sxIds(app).indexOf('run:' + key) < 0, 'the old ticket no longer does');
  app.PF.repo.saveRun = orig;
});

rule('App: another computer replacing a note on the open run with one of the same size at the same time shows after the full reread, without selecting the step again', async () => {
  const k = clocks(), app = boot({ Date: k.D, performance: k.perf }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  const run = app.run(), np = run.path.replace('run.json', 'notes-blake-laptop.jsonl');
  await app.fs.write(np, JSON.stringify({ id: 'b1', at: new Date().toISOString(), by: 'person-blake', step: 'announce', text: 'BLAKEFIRST' }) + '\n');
  for (let i = 0; i < 70; i++) { k.ahead(1000); app.every(); await app.tick(5); }
  app.click('select', 'announce'); await app.tick(20);
  assert.ok(/BLAKEFIRST/.test(app.html()), 'set-up: the note shows on its step');
  const f = app.fs.files[np]; app.fs.files[np] = { t: f.t.replace('BLAKEFIRST', 'BLAKEOTHER'), m: f.m };
  /* A running run is read in full every 5 minutes of elapsed time; nothing else on the page may be what redraws it. */
  let seen = null;
  for (let s = 1; s <= 12 * 60 && seen == null; s++) { k.ahead(1000); app.every(); await app.tick(5); if (/BLAKEOTHER/.test(app.html())) seen = s; }
  assert.ok(seen != null && seen <= 6 * 60, 'the replaced note shows after the full reread, with the step still selected: ' + seen + ' s');
  assert.ok(!/BLAKEFIRST/.test(app.html()), 'and the old text is gone');
});

rule('App: a follow-up decision another computer rewrites with one of the same size and time shows once it\'s read again, without leaving the page', async () => {
  const k = clocks(), app = boot({ Date: k.D, performance: k.perf }); await app.tick(80);
  app.choose('person-morgan'); await app.tick();
  const key = /data-act="fu-pick" data-id="([^"]+)" data-status="wont"/.exec(app.html())[1];
  app.click('fu-pick', key, { status: 'wont' }); await app.tick();
  app.set(app.PF.followups.formId(key) + '-reason', 'REASONFIRST'); app.click('fu-save', key); await app.tick(60);
  app.click('nav', 'followups'); await app.tick(20);
  app.click('fu-filter', 'all'); await app.tick();
  assert.ok(/REASONFIRST/.test(app.html()), 'set-up: the decision shows');
  const path = app.files('followups/release/').find(p => !/example-session/.test(p) && /REASONFIRST/.test(app.fs.files[p].t)), f = app.fs.files[path];
  app.fs.files[path] = { t: f.t.replace('REASONFIRST', 'REASONOTHER'), m: f.m };
  for (let s = 0; s < 4; s++) { k.ahead(30 * 60000); app.every(); await app.tick(60); }
  const html = app.html();
  assert.ok(/REASONOTHER/.test(html) && !/REASONFIRST/.test(html), 'the rewritten decision shows on the page that was open');
});

rule('App: Export evidence plans, makes a pack with progress, offers its SHA-256, and never writes to the folder', async () => {
  const app = boot({}); await app.tick(60);
  const before = JSON.stringify(app.fs.files);
  const k = Object.keys(app.fs.files).filter(p => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(p))[0].split('/').slice(1, 3).join('/');
  app.click('ev-open', k); await app.tick(80);
  let ov = app.overlay();
  assert.ok(/up to \d/.test(ov) && /people directory and its email fields are left out/.test(ov), ov.slice(0, 800));
  app.click('ev-make'); await app.tick(400);
  ov = app.overlay();
  assert.ok(/SHA-256 of this pack:<\/span><code id="ev-sha">[0-9a-f]{64}<\/code>/.test(ov) && /data-act="ev-save"/.test(ov), ov.slice(0, 1200));
  assert.strictEqual(JSON.stringify(app.fs.files), before, 'nothing written to the team folder');
  app.click('ev-format', 'report'); await app.tick();
  app.click('close-overlay'); await app.tick();
  assert.ok(!/ev-box/.test(app.overlay()), 'closed');
});

rule('App: Cancel stops an export and returns to the choices; closing the dialog stops it too', async () => {
  const app = boot({}); await app.tick(60);
  const k = Object.keys(app.fs.files).filter(p => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(p))[0].split('/').slice(1, 3).join('/');
  app.click('ev-open', k); await app.tick(80);
  app.click('ev-make'); app.click('ev-cancel'); await app.tick(200);
  assert.ok(/data-act="ev-make"/.test(app.overlay()) && !/ev-sha/.test(app.overlay()), 'back to the choices, nothing made');
  app.click('ev-make'); app.click('close-overlay'); await app.tick(200);
  assert.strictEqual(app.overlay(), '', 'closing cancels; nothing reopens');
});

rule('App: Runs › Export evidence… asks for a process and two days, checks them, and plans the runs that started then', async () => {
  const app = boot({}); await app.tick(60);
  app.click('ev-range'); await app.tick();
  assert.ok(/id="ev-proc"/.test(app.overlay()) && /time zone/.test(app.overlay()));
  app.set('ev-proc', 'release').set('ev-from', '2026-11-02').set('ev-through', '2026-11-01');
  app.click('ev-check'); await app.tick();
  assert.ok(/after the last day/.test(app.overlay()) && /aria-invalid="true"/.test(app.overlay()));
  app.set('ev-from', '2000-01-01').set('ev-through', '2099-12-31');
  app.click('ev-check'); await app.tick(120);
  assert.ok(/\d+ runs? · /.test(app.overlay()) && /Change the days/.test(app.overlay()), app.overlay().slice(0, 800));
});

/* REQUEST (1.20): another app asks for a run with flightdeck plan request; a person starts it here. The folder the app has
   open is copied to disk, the real command runs on it, and the file it wrote is put back as OneDrive would. */
function requestThroughCli(app, body, key) {
  const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-req-'));
  Object.keys(app.fs.files).filter(p => typeof app.fs.files[p].t === 'string').forEach(p => { const f = path.join(dir, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, app.fs.files[p].t); });
  const inFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-req-in-')), 'r.json');
  fs.writeFileSync(inFile, JSON.stringify(body));
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'flightdeck.js'), 'plan', 'request', dir, inFile, '--key', key, '--json'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout), rel = j.data.request.file;
  return { id: j.data.request.id, rel, text: fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8') };
}
const ASKED = { process: 'release', title: 'Release requested by a script', details: { ticket: 'ABC-777', environment: 'production' }, roles: { qa: 'person-morgan' }, producer: { name: 'ci-check', version: '1.4.0' } };

rule('Requests: a requested run shows as a planned run naming the tool as a claim, and a person starts it', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const req = requestThroughCli(app, ASKED, '2026-11');
  const runsBefore = releaseRuns(app);
  app.fs.files[req.rel] = { t: req.text, m: Date.now() };
  app.click('refresh'); await app.tick(80);
  assert.deepStrictEqual(releaseRuns(app), runsBefore, 'nothing starts by itself');
  assert.ok(/ci-check requested "Release requested by a script" \(by its own account\)/.test(app.html()), 'on Home, as a claim');
  app.click('nav', 'runs'); await app.tick();
  const card = new RegExp('<button class="card plan" id="card-' + req.id + '"[^>]*>[\\s\\S]*?</button>').exec(app.html());
  assert.ok(card && /requested by ci-check, by its own account/.test(card[0]) && /Release requested by a script/.test(card[0]), card ? card[0] : app.html());
  app.click('review-plan', req.id); await app.tick();
  const html = app.html();
  assert.ok(/Requested by ci-check 1\.4\.0, by its own account\./.test(html) && /can(&#39;|')t confirm which tool or person wrote this file/.test(html), 'the claim, said as one');
  assert.ok(/id="detail-ticket"[^>]*value="ABC-777"/.test(html) && /id="start-submit"(?![^>]*disabled)/.test(html));
  app.submitForm('start-form'); await app.tick(120);
  const made = releaseRuns(app).filter(p => runsBefore.indexOf(p) < 0);
  assert.strictEqual(made.length, 1, 'the person started it');
  const run = JSON.parse(app.fs.files[made[0]].t);
  assert.strictEqual(run.title, 'Release requested by a script'); assert.strictEqual(run.details.ticket, 'ABC-777');
  assert.strictEqual(run.recorder.person, 'person-casey', 'the person who started it records it, never the tool');
  assert.strictEqual(app.files('proposals/' + req.id + '.status-').length, 1, 'the request is marked started, like any plan');
  assert.strictEqual(JSON.parse(app.fs.files[app.files('proposals/' + req.id + '.status-')[0]].t).run, run.id);
  assert.strictEqual(app.fs.files[req.rel].t, req.text, 'the request file itself is never changed');
  app.click('nav', 'runs'); await app.tick();
  assert.ok(!new RegExp('data-act="review-plan" data-id="' + req.id + '"').test(app.html()), 'started, so no longer planned');
});

rule('Requests: an identical OneDrive copy shows the request once, arrived twice; copies that differ are flagged and can\'t be started', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const req = requestThroughCli(app, ASKED, 'twice');
  app.fs.files[req.rel] = { t: req.text, m: Date.now() };
  app.fs.files['proposals/' + req.id + '-LAPTOP.json'] = { t: req.text.replace(/"created": "[^"]*"/, '"created": "2026-01-01T00:00:00.000Z"'), m: Date.now() };
  app.click('refresh'); await app.tick(80);
  app.click('nav', 'runs'); await app.tick();
  assert.strictEqual((app.html().match(new RegExp('data-act="review-plan" data-id="' + req.id + '"', 'g')) || []).length, 1, 'shown once');
  assert.ok(/This request arrived twice/.test(app.html()));
  app.fs.files['proposals/' + req.id + '-LAPTOP.json'] = { t: req.text.replace('Release requested by a script', 'Another title'), m: Date.now() };
  app.click('refresh'); await app.tick(80);
  assert.strictEqual((app.html().match(new RegExp('data-act="review-plan" data-id="' + req.id + '"', 'g')) || []).length, 2, 'both shown');
  assert.ok(/Two different copies of this request are in the folder/.test(app.html()));
  app.click('review-plan', req.id); await app.tick();
  assert.ok(/id="start-submit"[^>]*disabled/.test(app.html()) && /delete the wrong one/.test(app.html()), 'can\'t be started until a person deletes one');
  const before = releaseRuns(app);
  app.submitForm('start-form'); await app.tick(120);
  assert.deepStrictEqual(releaseRuns(app), before, 'nothing started');
  delete app.fs.files['proposals/' + req.id + '-LAPTOP.json'];
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', req.id); await app.tick();
  app.submitForm('start-form'); await app.tick(120);
  assert.strictEqual(releaseRuns(app).length, before.length + 1, 'once one is deleted, it starts');
});

rule('App (2.0): anyone viewing a run can suggest a change to a phase\'s note or a gate\'s; it is written as a cv 2 correction naming that phase or gate', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const md = app.fs.files['maps/drafts/release.md'].t;
  await app.fs.write('maps/drafts/release.md', md.replace(/(## Gate: Ready to deploy[^\n]*\n  approves:[^\n]*\n)/, '$1  > Check the change board first.\n'));
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  app.set('change-note', 'Gate note'); app.click('publish', 'release'); await app.tick(100);
  const before = releaseRuns(app);
  app.click('start', 'release'); await app.tick();
  app.submitForm('start-form'); await app.tick(120);
  const made = releaseRuns(app).filter(p => before.indexOf(p) < 0)[0], run = JSON.parse(app.fs.files[made].t), key = 'release/' + run.id;
  app.click('open-run', key); await app.tick(20);
  assert.ok(/<div class="note g-note">[\s\S]*?Check the change board first\.[\s\S]*?data-act="nc-open" data-kind="gate" data-id="ready"/.test(app.html()), 'the note, with a way to suggest a change');
  app.click('nc-open', 'ready', { kind: 'gate' }); await app.tick();
  assert.ok(/<textarea id="nc-to-gate-ready"[^>]*>Check the change board first\.<\/textarea>/.test(app.html()) && app.focused() === 'nc-to-gate-ready', 'filled in with the note, with focus');
  app.click('nc-save', 'ready', { kind: 'gate' }); await app.tick(40);
  assert.ok(/No wording changed\./.test(app.html()), 'an unchanged note is refused, by name');
  app.input('nc-to-gate-ready', 'Check the change board and the freeze calendar first.'); app.input('nc-why-gate-ready', 'Freezes block deploys'); app.click('nc-save', 'ready', { kind: 'gate' }); await app.tick(60);
  const notes = newNotes(app, key).filter(n => n.kind === 'correction');
  assert.strictEqual(notes.length, 1);
  const n = notes[0];
  assert.deepStrictEqual([n.cv, n.step, n.target, n.change, n.why, n.version, n.folder], [2, '', { gate: 'ready' }, { op: 'wording', to: 'Check the change board and the freeze calendar first.' }, 'Freezes block deploys', run.version, run.folder]);
  assert.ok(/Correction to the note of the gate "Ready to deploy"/.test(n.text), n.text);
  assert.ok(!/id="nc-to-gate-ready"/.test(app.html()), 'closed'); assert.ok(/Correction saved on this computer\./.test(app.html() + app.live()), 'said');
});

rule('App (2.0): while a note correction saves, its boxes are read-only, so nothing typed then is lost when the composer closes', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const md = app.fs.files['maps/drafts/release.md'].t;
  await app.fs.write('maps/drafts/release.md', md.replace(/(## Gate: Ready to deploy[^\n]*\n  approves:[^\n]*\n)/, '$1  > Check the change board first.\n'));
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  app.set('change-note', 'Gate note'); app.click('publish', 'release'); await app.tick(100);
  const before = releaseRuns(app);
  app.click('start', 'release'); await app.tick();
  app.submitForm('start-form'); await app.tick(120);
  const run = JSON.parse(app.fs.files[releaseRuns(app).filter(p => before.indexOf(p) < 0)[0]].t), key = 'release/' + run.id;
  app.click('open-run', key); await app.tick(20);
  app.click('nc-open', 'ready', { kind: 'gate' }); await app.tick();
  const orig = app.PF.repo.addNote, g = gate();
  app.PF.repo.addNote = function () { const args = arguments; return g.p.then(() => orig.apply(this, args)); };
  app.input('nc-to-gate-ready', 'Submitted note.'); app.click('nc-save', 'ready', { kind: 'gate' }); await app.tick();
  const h = app.html();
  assert.ok(/<textarea id="nc-to-gate-ready"[^>]* readonly[^>]*>Submitted note\.<\/textarea>/.test(h) && /<textarea id="nc-why-gate-ready"[^>]* readonly/.test(h), 'read-only while saving');
  app.input('nc-to-gate-ready', 'New typing while saving'); await app.tick();
  assert.ok(/<textarea id="nc-to-gate-ready"[^>]*>Submitted note\.<\/textarea>/.test(app.html()), 'what is shown is what is being saved');
  g.open(); await app.tick(60);
  app.PF.repo.addNote = orig;
  const notes = newNotes(app, key).filter(n => n.kind === 'correction');
  assert.strictEqual(notes.length, 1); assert.strictEqual(notes[0].change.to, 'Submitted note.');
  assert.ok(!/id="nc-to-gate-ready"/.test(app.html()), 'closed once saved');
});

rule('App (2.0): the publish panel names the 2.0 features a draft uses and what that means for teammates on 1.22 or earlier; a draft that uses none says nothing', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const md = app.fs.files['maps/drafts/release.md'].t;
  await app.fs.write('maps/drafts/release.md', md.replace(/(## Gate: Ready to deploy[^\n]*\n  approves:[^\n]*\n)/, '$1  > Check the change board first.\n'));
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  assert.ok(/data-act="publish"/.test(app.html()) && !/Needs Flightdeck 2\.0/.test(app.html()), 'a gate note is not new: every copy since 1.10 publishes it');
  const phaseNoted = md.replace(/(\n## [^\n]*\{#[\w-]+\}\n)/, '$1  > Read the runbook first.\n');
  assert.notStrictEqual(phaseNoted, md, 'set-up: a phase note');
  await app.fs.write('maps/drafts/release.md', phaseNoted);
  app.click('refresh'); await app.tick(80);
  const h = app.html();
  assert.ok(/<p class="small pub-needs"[^>]*><b>Needs Flightdeck 2\.0:<\/b> a note on a phase\./.test(h), h.slice(h.indexOf('change-note'), h.indexOf('change-note') + 1500));
  assert.ok(/Teammates on Flightdeck 1\.22 or earlier see this version but can(&#39;|')t run it/.test(h));
});

rule('App (2.0): what is typed in a note correction is kept per run and per phase or gate: opening another one, or leaving the run, never loses it', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const md = app.fs.files['maps/drafts/release.md'].t
    .replace(/(## Gate: Ready to deploy[^\n]*\n  approves:[^\n]*\n)/, '$1  > Check the change board first.\n')
    .replace(/(## Gate: Deployed[^\n]*\n  approves:[^\n]*\n)/, '$1  > Watch the error rate.\n');
  await app.fs.write('maps/drafts/release.md', md);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  app.set('change-note', 'Gate notes'); app.click('publish', 'release'); await app.tick(100);
  const before = releaseRuns(app);
  app.click('start', 'release'); await app.tick();
  app.submitForm('start-form'); await app.tick(120);
  const run = JSON.parse(app.fs.files[releaseRuns(app).filter(p => before.indexOf(p) < 0)[0]].t), key = 'release/' + run.id;
  app.click('open-run', key); await app.tick(20);
  app.click('nc-open', 'ready', { kind: 'gate' }); await app.tick();
  app.input('nc-to-gate-ready', 'Check the change board and the freeze calendar.'); app.input('nc-why-gate-ready', 'Freezes block deploys'); await app.tick();
  app.click('nc-open', 'deployed', { kind: 'gate' }); await app.tick();
  const h = app.html();
  assert.ok(/<textarea id="nc-to-gate-deployed"[^>]*>Watch the error rate\.<\/textarea>/.test(h), 'Deployed\'s own composer');
  assert.ok(/<textarea id="nc-to-gate-ready"[^>]*>Check the change board and the freeze calendar\.<\/textarea>/.test(h) && /<textarea id="nc-why-gate-ready"[^>]*>Freezes block deploys<\/textarea>/.test(h), 'Ready\'s typing is still there');
  app.click('home'); await app.tick(); app.click('open-run', key); await app.tick(20);
  assert.ok(/<textarea id="nc-to-gate-ready"[^>]*>Check the change board and the freeze calendar\.<\/textarea>/.test(app.html()), 'and after leaving the run and coming back');
  app.click('nc-cancel', 'ready', { kind: 'gate' }); await app.tick();
  assert.ok(!/id="nc-to-gate-ready"/.test(app.html()) && /id="nc-to-gate-deployed"/.test(app.html()), 'Cancel closes only its own');
  app.click('nc-save', 'deployed', { kind: 'gate' }); await app.tick(40);
  assert.ok(/No wording changed\./.test(app.html()), 'an unchanged note is refused');
});


rule('App (2.0): a note correction whose note changed in the draft since the run\'s version needs a person\'s edit: its review shows the run\'s note, says it changed, and Apply never drops the newer wording', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const path = 'maps/drafts/release.md', md = app.fs.files[path].t;
  await app.fs.write(path, md.replace(/(## Gate: Ready to deploy[^\n]*\n  approves:[^\n]*\n)/, '$1  > Check the change board first.\n'));
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  app.set('change-note', 'Gate note'); app.click('publish', 'release'); await app.tick(100);
  const before = releaseRuns(app);
  app.click('start', 'release'); await app.tick();
  app.submitForm('start-form'); await app.tick(120);
  const run = JSON.parse(app.fs.files[releaseRuns(app).filter(p => before.indexOf(p) < 0)[0]].t), key = 'release/' + run.id;
  app.click('open-run', key); await app.tick(20);
  app.click('nc-open', 'ready', { kind: 'gate' }); await app.tick();
  app.input('nc-to-gate-ready', 'Check the freeze calendar first.'); app.input('nc-why-gate-ready', 'Freezes block deploys'); app.click('nc-save', 'ready', { kind: 'gate' }); await app.tick(60);
  // Meanwhile the draft's note gains an instruction the run's version never had.
  const draft = app.fs.files[path].t, newer = 'Check the change board first, and preserve the database.';
  assert.ok(/  > Check the change board first\.\n/.test(draft), 'set-up: the draft has the published note');
  await app.fs.write(path, draft.replace('  > Check the change board first.\n', '  > ' + newer + '\n'));
  app.choose('person-morgan'); await app.tick();
  app.click('refresh'); await app.tick(100);
  app.click('open-process', 'release'); await app.tick(20);
  const ids = []; const re = /data-act="corr-review" data-id="([\w-]+)"/g; let m; while ((m = re.exec(app.html()))) if (ids.indexOf(m[1]) < 0) ids.push(m[1]);
  let id = null;
  for (const x of ids) { app.click('corr-review', x); await app.tick(); if (/freeze calendar/.test(app.overlay())) { id = x; break; } app.click('close-overlay'); await app.tick(); }
  assert.ok(id, 'the note correction is listed for review');
  const ov = app.overlay();
  assert.ok(/This note changed in the draft since the run/.test(ov), 'it says the note changed: ' + ov.slice(0, 2000));
  assert.ok(!/Not recorded\./.test(ov) && /<p class="ca-text">Check the change board first\.<\/p>/.test(ov), 'the run\'s note, as its version had it');
  assert.ok(!/data-act="corr-apply"/.test(ov) && /Edit proposed result/.test(ov), 'no direct Apply');
  app.click('corr-apply', id); await app.tick(80);
  assert.ok(app.fs.files[path].t.indexOf(newer) >= 0, 'a direct Apply never drops the newer instruction');
});

/* ---------- 2.0 pins (slice 2 part 2) ---------- */
/* A plan/2 pinned to release v1's exact folder, written into the folder as the app or an AI assistant would. */
async function exactPlan(app) {
  const d = await app.PF.repo.loadAll(app.fs), v1 = d.processes.find(p => p.process === 'release').index.all.find(p => p.info.version === 1);
  const plan = app.PF.plans.make(v1, { id: 'plan-release-exact', process: 'release', title: 'Release exact', details: {}, roles: {}, by: 'person-avery', created: new Date().toISOString() }, true, '2.0.0');
  await app.fs.write('proposals/plan-release-exact.json', JSON.stringify(plan, null, 2));
  app.click('refresh'); await app.tick(80);
}
rule('Pins: a plan/2 starts on its exact folder; offering the latest is an explicit "Start on v2 instead", never a quiet switch', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  await exactPlan(app);
  app.click('review-plan', 'plan-release-exact'); await app.tick();
  assert.ok(/This plan was made for v1\. v2 is now published\./.test(app.html()));
  assert.ok(/data-act="plan-retarget"[^>]*>Start on v2 instead</.test(app.html()) && !/data-act="plan-latest" data-id="plan-release-exact"/.test(app.html()), 'only the explicit switch');
  const before = releaseRuns(app);
  app.submitForm('start-form'); await app.tick(120);
  const made = releaseRuns(app).filter(p => before.indexOf(p) < 0), run = JSON.parse(app.fs.files[made[0]].t);
  assert.strictEqual(run.folder, pubFolder(app, 1));
  const st = JSON.parse(app.fs.files[app.files('proposals/plan-release-exact.status-')[0]].t);
  assert.strictEqual(st.format, 'flightdeck-plan-status/2'); assert.strictEqual(st.status, 'accepted'); assert.strictEqual(st.run, run.id);
});

rule('Pins: a routine refresh shows a switch made in another window, and two switches that disagree, on the open plan (2.1.0)', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  await exactPlan(app);
  const v1 = pubFolder(app, 1), v2 = pubFolder(app, 2);
  app.click('review-plan', 'plan-release-exact'); await app.tick();
  const eyebrow = () => (app.html().match(/<div class="eyebrow">[^<]*/) || [''])[0];
  assert.ok(/ · v1/.test(eyebrow()), 'set-up: on v1: ' + eyebrow());
  const p0 = () => app.PF.repo.loadAll(app.fs).then(d => d.plans.find(p => p.id === 'plan-release-exact'));
  await app.PF.repo.recordPlanStatus(app.fs, await p0(), 'w-avery', 'retargeted', null, 'person-avery', { folder: v2, version: 2 }, '2.1.0');
  app.winFire('focus'); await app.tick(160);
  assert.ok(/ · v2/.test(eyebrow()), 'the switch shows: ' + eyebrow());
  await app.PF.repo.recordPlanStatus(app.fs, await p0(), 'w-blake', 'retargeted', null, 'person-blake', { folder: v1, version: 1 }, '2.1.0');
  app.winFire('focus'); await app.tick(160);
  assert.ok(/two people switched it to different versions/.test(app.html()) && !/id="start-form"/.test(app.html()), (app.html().match(/class="notice[^"]*"[^>]*>[\s\S]{0,300}/g) || []).join(' | '));
});

rule('Pins: a plan/2 whose folder is gone asks and starts nothing; "Start on v2 instead" writes the switch (plan-status/2, retargeted) and then starts on v2', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  await exactPlan(app);
  const v1 = pubFolder(app, 1), v2 = pubFolder(app, 2);
  app.files('publications/release/' + v1 + '/').forEach(p => { delete app.fs.files[p]; });
  app.click('refresh'); await app.tick(80);
  app.click('review-plan', 'plan-release-exact'); await app.tick();
  const h = app.html();
  assert.ok(/This plan starts on [^<]* v1 \(v1-[a-z0-9]+\), which can(&#39;|')t be used here: [^<]*isn(&#39;|')t in this folder\. It won(&#39;|')t start on another version by itself\./.test(h), h.slice(0, 2000));
  assert.ok(!/id="start-form"/.test(h), 'no form to start it');
  const before = releaseRuns(app);
  app.click('plan-retarget', 'plan-release-exact', { folder: v2 }); await app.tick(120);
  const sw = app.files('proposals/plan-release-exact.status-').map(p => JSON.parse(app.fs.files[p].t));
  assert.strictEqual(sw.length, 1); assert.strictEqual(sw[0].status, 'retargeted'); assert.deepStrictEqual(sw[0].to, { folder: v2, version: 2 });
  assert.deepStrictEqual(releaseRuns(app), before, 'switching starts nothing');
  assert.ok(/Switched to v2/.test(app.html()));
  app.submitForm('start-form'); await app.tick(120);
  const run = JSON.parse(app.fs.files[releaseRuns(app).filter(p => before.indexOf(p) < 0)[0]].t);
  assert.strictEqual(run.folder, v2);
});

rule('Pins: a run/2 parent whose child is now a 2.0 version refuses to start it, offers "Start it as a Flightdeck 2.0 run", and that continues it end to end; Reopen stays refused', async () => {
  const app = await recordingRelease();
  app.click('reopen', '0'); await app.tick(40);
  app.click('edit', 'detail:commit'); app.set('edit-input', 'f00d123'); app.click('save-edit'); await app.tick(40);
  app.click('clear', 'notes'); await app.tick(40);
  // check-in gets a 2.0 version (a phase note).
  const d = await app.PF.repo.loadAll(app.fs), ci = d.processes.find(p => p.process === 'check-in'), md = ci.index.latest.md.replace(/\n## ([^\n]+)\n/, '\n## $1\n  > Use the scratch server.\n');
  const res = await app.PF.repo.publish(app.fs, md, { people: d.people, customTypes: d.stepTypes.types, workflows: {}, by: 'person-avery', changes: '2.0', existing: ci.index.all.map(p => p.info), now: new Date().toISOString(), app: '2.0.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  assert.strictEqual(JSON.parse(res.files['publication.json']).format, 'preflight-publication/2', 'set-up');
  app.click('refresh'); await app.tick(80);
  const parentKey = app.run().key, children = () => app.files('runs/check-in/').filter(p => /run\.json$/.test(p)).length, before = children();
  app.click('select', 'notes'); await app.tick();
  assert.ok(/needs a run made with Flightdeck 2\.0\. Start a new run of this checklist on v\d+ to use it\./.test(app.html()));
  assert.ok(/data-act="continue-two" data-id="notes">Start it as a Flightdeck 2\.0 run</.test(app.html()));
  app.click('start-child', 'notes'); await app.tick(80);
  assert.strictEqual(children(), before, 'never starts a 2.0 child for a run/2 parent');
  const runsBefore = releaseRuns(app);
  app.click('continue-two', 'notes'); await app.tick(400);
  const made = releaseRuns(app).filter(p => runsBefore.indexOf(p) < 0);
  assert.strictEqual(made.length, 1, 'one new run');
  const n = JSON.parse(app.fs.files[made[0]].t), old = JSON.parse(app.fs.files['runs/' + parentKey + '/run.json'].t);
  assert.strictEqual(n.format, 'preflight-run/3'); assert.deepStrictEqual(n.features.indexOf('pinned-children') >= 0, true);
  assert.strictEqual(n.folder, old.folder, 'the same /1 version');
  assert.deepStrictEqual(n.details, old.details); assert.deepStrictEqual(n.roles, old.roles);
  assert.ok(!Object.keys(n.steps).some(k => n.steps[k].s === 'done'), 'no answers copied');
  assert.strictEqual(n.pins.children.notes.folder, res.folder, 'its child is pinned to the 2.0 version');
  assert.strictEqual(old.steps.notes.s, 'blocked'); assert.strictEqual(old.steps.notes.reason, 'Continued in run release/' + n.id);
  assert.ok(app.html().indexOf(n.title.replace(/&/g, '&amp;')) >= 0 && /(continued)/.test(n.title), 'the new run is open');
  // The new run starts its child on the pin.
  app.click('start-child', 'notes'); await app.tick(120);
  const link = JSON.parse(app.fs.files['runs/release/' + n.id + '/run.json'].t).steps.notes.child;
  assert.ok(link && link.folder === res.folder, 'the child starts on the pinned version: ' + JSON.stringify(link));
  const child = JSON.parse(app.fs.files['runs/check-in/' + link.id + '/run.json'].t);
  assert.strictEqual(child.format, 'preflight-run/3'); assert.strictEqual(child.parent.folder, n.folder);
  // Back on the old run, Reopen stays refused.
  app.click('open-run', parentKey); await app.tick(40);
  app.click('clear', 'notes'); await app.tick(60);
  const again = JSON.parse(app.fs.files['runs/' + parentKey + '/run.json'].t);
  assert.strictEqual(again.steps.notes.s, 'blocked', 'still blocked');
  assert.ok(/continued in run release\//.test(app.html()), 'says why');
});

rule('Pins: a run/2 parent with an existing link to a completed 2.0 child, inputs unchanged, is never checked by it, shows "Start it as a Flightdeck 2.0 run" with why, and that continues it', async () => {
  const app = await recordingRelease();
  app.click('reopen', '0'); await app.tick(40);
  app.click('edit', 'detail:commit'); app.set('edit-input', 'f00d123'); app.click('save-edit'); await app.tick(40);
  app.click('clear', 'notes'); await app.tick(40);
  const d = await app.PF.repo.loadAll(app.fs), ci = d.processes.find(p => p.process === 'check-in'), md = ci.index.latest.md.replace(/\n## ([^\n]+)\n/, '\n## $1\n  > Use the scratch server.\n');
  const res = await app.PF.repo.publish(app.fs, md, { people: d.people, customTypes: d.stepTypes.types, workflows: {}, by: 'person-avery', changes: '2.0', existing: ci.index.all.map(p => p.info), now: new Date().toISOString(), app: '2.0.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  app.click('refresh'); await app.tick(80);
  const parentKey = app.run().key, parentPath = 'runs/' + parentKey + '/run.json', parent = JSON.parse(app.fs.files[parentPath].t);
  assert.strictEqual(parent.format, 'preflight-run/2', 'set-up: a run/2 parent');
  // A link an older copy could have made: the 2.0 child, started with the parent's current details, then completed.
  const d2 = await app.PF.repo.loadAll(app.fs), v2 = d2.processes.find(p => p.process === 'check-in').index.all.find(p => p.info.folder === res.folder);
  const step = app.PF.map.findStep(app.PF.run.mapOf(parent), 'notes').step, inputs = app.PF.run.childDetails(parent, step, Object.keys(parent.details));
  const kid = app.PF.run.create(v2, { id: 'twokid1', title: 'Check in (2.0)', details: Object.assign({}, inputs), roles: parent.roles, by: 'person-casey', session: 'w-other', now: new Date().toISOString(), parent: { process: parent.process, id: parent.id, step: 'notes', inputs }, app: '2.0.0', pins: {} });
  assert.strictEqual(kid.format, 'preflight-run/3', 'set-up: a 2.0 child');
  kid.state = 'completed'; kid.ended = { outcome: 'Completed', by: 'person-casey', at: new Date().toISOString() };
  await app.PF.repo.saveRun(app.fs, kid, 'w-other');
  parent.steps.notes = { s: 'open', child: { process: 'check-in', id: 'twokid1', inputs } };
  await app.fs.write(parentPath, JSON.stringify(parent, null, 2));
  app.click('refresh'); await app.tick(200);
  app.click('open-run', parentKey); await app.tick(40);
  app.click('select', 'notes'); await app.tick();
  assert.notStrictEqual(JSON.parse(app.fs.files[parentPath].t).steps.notes.s, 'done', 'never checked by a 2.0 child');
  const h = app.html();
  assert.ok(/needs a run made with Flightdeck 2\.0/.test(h), 'says why: ' + (h.match(/class="childbox"[^]{0,400}/) || [''])[0]);
  assert.ok(/data-act="continue-two" data-id="notes">Start it as a Flightdeck 2\.0 run</.test(h), 'the offer is shown');
  const runsBefore = releaseRuns(app);
  app.click('continue-two', 'notes'); await app.tick(400);
  const made = releaseRuns(app).filter(p => runsBefore.indexOf(p) < 0);
  assert.strictEqual(made.length, 1, 'one new run');
  const n = JSON.parse(app.fs.files[made[0]].t);
  assert.strictEqual(n.format, 'preflight-run/3');
  assert.strictEqual(JSON.parse(app.fs.files[parentPath].t).steps.notes.reason, 'Continued in run release/' + n.id);
});

/* A run/3 (continued from the example release) whose notes step is pinned to check-in's 2.0 version. */
async function pinnedRelease() {
  const app = await recordingRelease();
  app.click('reopen', '0'); await app.tick(40);
  app.click('edit', 'detail:commit'); app.set('edit-input', 'f00d123'); app.click('save-edit'); await app.tick(40);
  app.click('clear', 'notes'); await app.tick(40);
  const d = await app.PF.repo.loadAll(app.fs), ci = d.processes.find(p => p.process === 'check-in'), v1 = ci.index.latest, md = v1.md.replace(/\n## ([^\n]+)\n/, '\n## $1\n  > Use the scratch server.\n');
  const res = await app.PF.repo.publish(app.fs, md, { people: d.people, customTypes: d.stepTypes.types, workflows: {}, by: 'person-avery', changes: '2.0', existing: ci.index.all.map(p => p.info), now: new Date().toISOString(), app: '2.0.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  app.click('refresh'); await app.tick(80);
  const runsBefore = releaseRuns(app);
  app.click('select', 'notes'); await app.tick();
  app.click('continue-two', 'notes'); await app.tick(400);
  const made = releaseRuns(app).filter(p => runsBefore.indexOf(p) < 0), n = JSON.parse(app.fs.files[made[0]].t);
  assert.strictEqual(n.pins.children.notes.folder, res.folder, 'set-up: pinned to v2');
  return { app, n, v1, v2folder: res.folder };
}
rule('Pins: a run/3 never adopts or settles from a child run on another version than its pin: no Link it for it, Link it refuses, and a hand-edited link never checks the step', async () => {
  const { app, n, v1, v2folder } = await pinnedRelease();
  const runPath = 'runs/release/' + n.id + '/run.json';
  app.click('start-child', 'notes'); await app.tick(120);
  const linked = JSON.parse(app.fs.files[runPath].t).steps.notes.child;
  assert.ok(linked && linked.folder === v2folder, 'set-up: started on the pin');
  const k = JSON.parse(app.fs.files['runs/check-in/' + linked.id + '/run.json'].t);
  // A run of check-in v1 that names the same step as its parent: an orphan on the wrong version, newer than the right one.
  const o = app.PF.run.create(v1, { id: 'wrongver1', title: 'Check in on v1', details: k.details, roles: k.roles, by: 'person-casey', session: 'w-other', now: new Date(Date.now() + 60000).toISOString(), parent: k.parent });
  await app.PF.repo.saveRun(app.fs, o, 'w-other');
  // The link that didn't land: the step has no child yet.
  const unl = JSON.parse(app.fs.files[runPath].t); delete unl.steps.notes; await app.fs.write(runPath, JSON.stringify(unl, null, 2));
  app.click('refresh'); await app.tick(80);
  app.click('open-run', 'release/' + n.id); await app.tick(40);
  app.click('select', 'notes'); await app.tick();
  const h = app.html();
  assert.ok(!/data-act="link-child" data-id="notes" data-child="check-in\/wrongver1"/.test(h), 'never offered: ' + (h.match(/data-act="link-child"[^>]*>/) || [''])[0]);
  assert.ok(new RegExp('data-act="link-child" data-id="notes" data-child="check-in/' + k.id + '"').test(h), 'the pinned one is offered');
  app.click('link-child', 'notes', { child: 'check-in/wrongver1' }); await app.tick(80);
  assert.ok(!(JSON.parse(app.fs.files[runPath].t).steps.notes || {}).child, 'Link it refuses another version');
  // A hand-edited link to it, ended Completed: the step is never checked from it.
  const hand = JSON.parse(app.fs.files[runPath].t); hand.steps.notes = { s: 'open', child: { process: 'check-in', id: 'wrongver1', inputs: k.parent.inputs, folder: v2folder } }; await app.fs.write(runPath, JSON.stringify(hand, null, 2));
  const done = JSON.parse(app.fs.files['runs/check-in/wrongver1/run.json'].t); done.state = 'completed'; done.ended = { outcome: 'Completed', by: 'person-casey', at: new Date().toISOString() }; await app.fs.write('runs/check-in/wrongver1/run.json', JSON.stringify(done, null, 2));
  app.click('refresh'); await app.tick(200);
  assert.notStrictEqual(JSON.parse(app.fs.files[runPath].t).steps.notes.s, 'done', 'never checked by a run on another version');
});

rule('Pins: a step whose linked run fails its pin shows "Start a new … run", and clicking it starts one child, on the pinned folder', async () => {
  const { app, n, v1, v2folder } = await pinnedRelease();
  const runPath = 'runs/release/' + n.id + '/run.json';
  app.click('start-child', 'notes'); await app.tick(120);
  const k = JSON.parse(app.fs.files['runs/check-in/' + JSON.parse(app.fs.files[runPath].t).steps.notes.child.id + '/run.json'].t);
  const o = app.PF.run.create(v1, { id: 'wrongver2', title: 'Check in on v1', details: k.details, roles: k.roles, by: 'person-casey', session: 'w-other', now: new Date().toISOString(), parent: k.parent });
  await app.PF.repo.saveRun(app.fs, o, 'w-other');
  // A hand-edited link to the wrong version, with the inputs still current.
  const hand = JSON.parse(app.fs.files[runPath].t); hand.steps.notes = { s: 'open', child: { process: 'check-in', id: 'wrongver2', inputs: k.parent.inputs, folder: v2folder } }; await app.fs.write(runPath, JSON.stringify(hand, null, 2));
  app.click('refresh'); await app.tick(80);
  app.click('open-run', 'release/' + n.id); await app.tick(40);
  app.click('select', 'notes'); await app.tick();
  assert.ok(/data-act="start-child" data-id="notes">Start a new /.test(app.html()), 'the button is shown');
  const kids = () => app.files('runs/check-in/').filter(p => /\/run\.json$/.test(p)), before = kids();
  app.click('start-child', 'notes'); await app.tick(160);
  const made = kids().filter(p => before.indexOf(p) < 0);
  assert.strictEqual(made.length, 1, 'one new child: ' + before.length + ' -> ' + kids().length);
  const c = JSON.parse(app.fs.files[made[0]].t), link = JSON.parse(app.fs.files[runPath].t).steps.notes.child;
  assert.strictEqual(c.folder, v2folder, 'on the pinned folder');
  assert.ok(link && link.id === c.id && link.folder === v2folder, 'and linked: ' + JSON.stringify(link));
});

rule('Pins: Link it on an orphan child, for a step with no pin yet, pins the step to the orphan\'s version; after a newer version and a changed detail, the next child still starts on that pin', async () => {
  const { app, n, v2folder } = await pinnedRelease();
  const runPath = 'runs/release/' + n.id + '/run.json';
  app.click('start-child', 'notes'); await app.tick(120);
  const k = JSON.parse(app.fs.files['runs/check-in/' + JSON.parse(app.fs.files[runPath].t).steps.notes.child.id + '/run.json'].t);
  // The parent as it would be had check-in not been published when it started: no pin for the step, and no link.
  const p = JSON.parse(app.fs.files[runPath].t); delete p.pins; p.features = (p.features || []).filter(f => f !== 'pinned-children'); delete p.steps.notes;
  await app.fs.write(runPath, JSON.stringify(p, null, 2));
  const d = await app.PF.repo.loadAll(app.fs), ci = d.processes.find(x => x.process === 'check-in'), v2 = ci.index.all.find(x => x.info.folder === v2folder);
  const o = app.PF.run.create(v2, { id: 'orphan2', title: 'Check in, recovered', details: k.details, roles: k.roles, by: 'person-casey', session: 'w-other', now: new Date(Date.now() + 60000).toISOString(), parent: k.parent, app: '2.0.0', pins: {} });
  await app.PF.repo.saveRun(app.fs, o, 'w-other');
  app.click('refresh'); await app.tick(80);
  app.click('open-run', 'release/' + n.id); await app.tick(40);
  app.click('select', 'notes'); await app.tick();
  assert.ok(/data-act="link-child" data-id="notes" data-child="check-in\/orphan2"/.test(app.html()), 'Link it is offered for the orphan');
  app.click('link-child', 'notes', { child: 'check-in/orphan2' }); await app.tick(80);
  const after = JSON.parse(app.fs.files[runPath].t);
  assert.ok(after.steps.notes && after.steps.notes.child && after.steps.notes.child.id === 'orphan2', 'linked: ' + JSON.stringify(after.steps.notes));
  assert.ok(after.pins && after.pins.children && after.pins.children.notes && after.pins.children.notes.folder === v2folder, 'pinned to the orphan\'s version: ' + JSON.stringify(after.pins));
  assert.strictEqual(after.pins.children.notes.mapHash, v2.info.mapHash); assert.strictEqual(after.pins.children.notes.typesHash, v2.info.typesHash);
  // check-in v3 is published, and a detail the child carries changes: the next child starts on the pin, not on v3.
  const v3 = await app.PF.repo.publish(app.fs, v2.md.replace(/\n## ([^\n]+)\n/, '\n## $1\n  > And the staging server.\n'), { people: d.people, customTypes: d.stepTypes.types, workflows: {}, by: 'person-avery', changes: 'v3', existing: ci.index.all.map(x => x.info), now: new Date().toISOString(), app: '2.0.0' });
  assert.ok(v3 && !v3.blockers && v3.folder !== v2folder, 'set-up: v3 published');
  app.click('refresh'); await app.tick(80);
  app.click('open-run', 'release/' + n.id); await app.tick(40);
  app.click('edit', 'detail:commit'); app.set('edit-input', 'beef456'); app.click('save-edit'); await app.tick(60);
  app.click('select', 'notes'); await app.tick();
  const kids = () => app.files('runs/check-in/').filter(x => /\/run\.json$/.test(x)), before = kids();
  app.click('start-child', 'notes'); await app.tick(160);
  const made = kids().filter(x => before.indexOf(x) < 0);
  assert.strictEqual(made.length, 1, 'one new child: ' + app.html().match(/class="msg[^"]*"[^>]*>[^<]*/g));
  assert.strictEqual(JSON.parse(app.fs.files[made[0]].t).folder, v2folder, 'on the pinned version, not v3');
});

rule('Pins: a plan switch waiting behind another write is dropped, and says so, if the folder or the person changes first; it never lands in another folder', async () => {
  for (const change of ['folder', 'person']) {
    const app = boot(); await app.tick(60);
    app.choose('person-casey'); await app.tick();
    await exactPlan(app);
    const oldFs = app.fs, v2 = pubFolder(app, 2);
    // An earlier write holds the queue: a publish.
    app.click('open-process', 'check-in'); await app.tick();
    const orig = app.PF.repo.publish, g = gate(); let first = true;
    app.PF.repo.publish = function () { const a = arguments; if (!first) return orig.apply(this, a); first = false; return g.p.then(() => orig.apply(this, a)); };
    app.set('change-note', 'A change'); app.click('publish', 'check-in'); await app.tick();
    app.click('review-plan', 'plan-release-exact'); await app.tick();
    const calls = [], rec = app.PF.repo.recordPlanStatus;
    app.PF.repo.recordPlanStatus = function (fs, plan, w, status) { calls.push(status); return rec.apply(this, arguments); };
    app.click('plan-retarget', 'plan-release-exact', { folder: v2 }); await app.tick();
    if (change === 'folder') { app.click('reset-examples'); await app.tick(60); app.choose('person-blake'); await app.tick(); }
    else { app.choose('person-blake'); await app.tick(); }
    g.open(); await app.tick(120);
    app.PF.repo.publish = orig; app.PF.repo.recordPlanStatus = rec;
    if (change === 'folder') assert.ok(app.fs !== oldFs, 'set-up: another folder');
    assert.deepStrictEqual(calls.filter(s => s === 'retargeted'), [], change + ': nothing recorded');
    assert.ok(!Object.keys(app.fs.files).some(p => /^proposals\/plan-release-exact\.status-/.test(p)), change + ': nothing in this folder');
    assert.ok(!Object.keys(oldFs.files).some(p => /^proposals\/plan-release-exact\.status-/.test(p)), change + ': nor in the first');
    assert.ok(/wasn(&#39;|')t switched/.test(app.html()), change + ': it says so');
  }
});

rule('Plans: a decline waiting behind another write is dropped, and says so, if the folder or the person changes first; it never lands in another folder (2.1.0)', async () => {
  for (const change of ['folder', 'person']) {
    const app = boot(); await app.tick(60);
    app.choose('person-casey'); await app.tick();
    const oldFs = app.fs, mine = fs => Object.keys(fs.files).filter(p => /^proposals\/plan-release-2026-10-24\.status-/.test(p)).length, had = mine(oldFs);
    app.click('open-process', 'check-in'); await app.tick();
    const orig = app.PF.repo.publish, g = gate(); let first = true;
    app.PF.repo.publish = function () { const a = arguments; if (!first) return orig.apply(this, a); first = false; return g.p.then(() => orig.apply(this, a)); };
    app.set('change-note', 'A change'); app.click('publish', 'check-in'); await app.tick();
    const calls = [], rec = app.PF.repo.recordPlanStatus;
    app.PF.repo.recordPlanStatus = function (fs, plan, w, status) { calls.push(status); return rec.apply(this, arguments); };
    app.click('decline-plan', 'plan-release-2026-10-24'); await app.tick();
    if (change === 'folder') { app.click('reset-examples'); await app.tick(60); app.choose('person-blake'); await app.tick(); }
    else { app.choose('person-blake'); await app.tick(); }
    const now = mine(app.fs);
    g.open(); await app.tick(120);
    app.PF.repo.publish = orig; app.PF.repo.recordPlanStatus = rec;
    if (change === 'folder') assert.ok(app.fs !== oldFs, 'set-up: another folder');
    assert.deepStrictEqual(calls.filter(s => s === 'declined'), [], change + ': nothing recorded');
    assert.strictEqual(mine(app.fs), now, change + ': nothing in this folder');
    assert.strictEqual(mine(oldFs), had, change + ': nor in the first');
    assert.ok(/wasn(&#39;|')t declined/.test(app.html() + app.live()), change + ': it says so');
  }
});

/* ---------- Back and Forward (docs/design.md section 29) ---------- */
const navBoot = async (o) => { const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, o || {})); await app.tick(80); if (!(o && o.nobody)) { app.choose('person-casey'); await app.tick(); } return app; };
const hashes = app => app.entries().map(e => e.hash);
// Every entry is numbered by its place, as Flightdeck writes them: no two share an n, and none is missing.
const numbered = app => app.entries().forEach((e, i) => assert.ok(e.state && e.state.fd === 1 && e.state.n === i && Object.keys(e.state).sort().join() === 'f,fd,n', 'entry ' + i + ' ' + JSON.stringify(e)));
const onRun = app => /id="run-h"/.test(app.html());
const onReceipt = app => /<div class="eyebrow">Receipt ·/.test(app.html());
const onHome = app => /<div class="eyebrow">Home<\/div>/.test(app.html());
const onProcess = (app, title) => /<h1 id="page-h" tabindex="-1">/.test(app.html()) && app.html().indexOf('data-act="ptab"') >= 0 && (!title || app.html().indexOf('>' + title + '</h1>') >= 0);
const back = async app => { app.back(); await app.settle(); };
const fwd = async app => { app.forward(); await app.settle(); };
// Every hash ever written: route words and IDs only.
const ID_ONLY = /^#\/[a-z0-9._\/-]*$/i;

rule('Back and Forward: Home, a process, a run and its receipt, back and forth, each on its own screen and hash', async () => {
  const app = await navBoot();
  assert.strictEqual(app.hash(), '#/');
  assert.strictEqual(app.scrollRestoration(), 'manual');
  app.click('open-process', 'release'); await app.tick();
  const key = app.run().key;
  app.click('open-run', key); await app.tick();
  app.click('receipt'); await app.tick();
  assert.deepStrictEqual(hashes(app), ['#/', '#/process/release', '#/run/' + key, '#/run/' + key + '/receipt']);
  assert.strictEqual(app.index(), 3); numbered(app);
  await back(app); assert.ok(onRun(app), 'the run'); assert.strictEqual(app.hash(), '#/run/' + key);
  await back(app); assert.ok(onProcess(app), 'the process'); assert.strictEqual(app.hash(), '#/process/release');
  await back(app); assert.ok(onHome(app), 'Home'); assert.strictEqual(app.index(), 0);
  await fwd(app); await fwd(app); await fwd(app);
  assert.ok(onReceipt(app), 'the receipt again'); assert.strictEqual(app.index(), 3);
  assert.deepStrictEqual(hashes(app), ['#/', '#/process/release', '#/run/' + key, '#/run/' + key + '/receipt'], 'nothing added or lost');
  numbered(app); assert.strictEqual(app.reloads(), 0); assert.strictEqual(app.popMismatch(), 0);
});

rule('Back and Forward: typing, filters, selecting steps, the checklist views, dialogs, refreshes and folder reads add no entry', async () => {
  const app = await navBoot();
  const key = app.run().key;
  app.click('open-run', key); await app.tick();
  const before = JSON.stringify(hashes(app)), at = app.index();
  app.key('j'); await app.tick(); app.key('j'); await app.tick(); app.key('k'); await app.tick();
  app.click('select', 'announce'); await app.tick();
  app.key('?'); await app.tick(); app.key('Escape'); await app.tick();
  app.click('refresh'); await app.tick(60);
  app.every(); await app.tick(40); app.every(); await app.tick(40);
  assert.strictEqual(JSON.stringify(hashes(app)), before); assert.strictEqual(app.index(), at);
  app.click('open-process', 'release'); await app.tick();
  const two = JSON.stringify(hashes(app));
  app.click('flight', 'plan'); await app.tick(); app.click('flight', 'md'); await app.tick(); app.click('flight', 'list'); await app.tick();
  app.click('nav', 'runs'); await app.tick();
  const three = JSON.stringify(hashes(app));
  app.click('filter', 'all'); await app.tick(); app.click('filter', 'mine'); await app.tick();
  assert.strictEqual(JSON.stringify(hashes(app)), three, 'filters push nothing');
  assert.notStrictEqual(two, three);
  numbered(app);
});

rule('Back and Forward: one action that changes process, version and tab makes one entry', async () => {
  const app = await navBoot();
  const n = app.entries().length;
  app.click('go', null, { view: 'process', process: 'release', ptab: 'insights' }); await app.tick();
  assert.strictEqual(app.entries().length, n + 1);
  assert.strictEqual(app.hash(), '#/process/release/insights');
  await back(app); assert.ok(onHome(app));
});

rule('Back and Forward: hostile hashes typed into the address bar land on Home with a message, never on the page', async () => {
  const app = await navBoot();
  app.click('open-process', 'release'); await app.tick();
  const bad = ['#/run/<script>/x', '#/run/a/%3Cscript%3E', '#/process/%E0%A4%A', '#/' + 'x'.repeat(10000), '#/process/../x', '#/process/a%2Fb', '#/process/a%01b', '#/types/__proto__', '#/run/a/b/c/d/e/f/g', '#/nowhere-at-all'];
  for (const h of bad) {
    app.click('open-process', 'release'); await app.tick();
    app.typeHash(h); await app.settle();
    assert.ok(onHome(app), 'Home for ' + h.slice(0, 40));
    assert.ok(/That link isn't one Flightdeck can open\./.test(app.live()), app.live());
    assert.strictEqual(app.hash(), '#/');
    ['<script>', '%3Cscript', 'nowhere-at-all', '__proto__', 'x'.repeat(50)].forEach(t => { assert.ok(app.html().indexOf(t) < 0 && app.live().indexOf(t) < 0 && app.top().indexOf(t) < 0, t); });
  }
  numbered(app); assert.strictEqual(app.reloads(), 0);
});

rule('Back and Forward: a browser that refuses the History API still works as before, with nothing written', async () => {
  const app = await navBoot({ historyThrows: true });
  app.click('open-process', 'release'); await app.tick();
  app.click('open-run', app.run().key); await app.tick();
  assert.ok(onRun(app), 'still navigates');
  assert.deepStrictEqual(app.entries(), [{ hash: '', state: null }]);
  app.click('nav', 'runs'); await app.tick();
  assert.ok(/<div class="eyebrow">Runs<\/div>/.test(app.html()));
});

rule('Back and Forward: every screen and tab has a route', async () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8');
  const pages = /var PAGES = \{([^}]*)\}/.exec(src)[1].split(',').map(x => x.split(':')[0].trim().replace(/'/g, ''));
  const app = await navBoot(), N = app.PF.nav;
  assert.ok(pages.length >= 18, pages.join());
  pages.concat(['home']).forEach(v => ['overview', 'edit', 'insights'].forEach(ptab => {
    const loc = N.locate({ view: v, processId: 'release', runKey: 'release/abc', ptab, mapVer: null, planId: 'plan-x', skillFile: 'x.json', recoveryAt: '', typeForm: null });
    assert.ok(loc, 'a route for ' + v);
    const back = N.parse(N.format(loc));
    assert.ok(back && (v === 'home' || back.view !== 'home'), v + ' → ' + N.format(loc));
  }));
});

rule('Back and Forward: editor Done and the version picker push, so Back returns to the editor and the earlier version', async () => {
  const app = await navBoot();
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  assert.strictEqual(app.hash(), '#/process/release/edit');
  app.click('ed-done'); await app.tick();
  assert.strictEqual(app.hash(), '#/process/release');
  await back(app);
  assert.ok(/id="ed-h"/.test(app.html()), 'the editor again'); assert.strictEqual(app.hash(), '#/process/release/edit');
  await back(app);
  assert.strictEqual(app.hash(), '#/process/release');
  const vers = [...app.html().matchAll(/<option value="(v\d+-[a-z0-9]+)"/g)].map(m => m[1]);
  assert.ok(vers.length >= 2, 'the example has versions: ' + vers.join());
  // v2 is the current version, v1 the first: picking v1 then v2, Back shows v1, Back again the page's default.
  // The page redraws the picker from the version shown (syncBound); this stand-in keeps a chosen value, so it is let go.
  app.select('map-ver', vers[1]); await app.tick(); app.gone('map-ver');
  app.select('map-ver', vers[0]); await app.tick(); app.gone('map-ver');
  assert.strictEqual(app.hash(), '#/process/release/v/' + vers[0]);
  await back(app); assert.strictEqual(app.hash(), '#/process/release/v/' + vers[1]); assert.ok(/<option value="v1-[a-z0-9]+" selected>/.test(app.html()), 'v1 shown');
  await back(app); assert.strictEqual(app.hash(), '#/process/release');
  numbered(app);
});

rule('Back and Forward: a move within one screen kind pushes: run to its child run, one recovery section to another', async () => {
  const app = await navBoot();
  const key = app.run().key;
  app.click('open-run', key); await app.tick();
  app.click('select', 'notes'); await app.tick();
  const child = /data-act="open-run" data-id="(check-in\/[a-z0-9-]+)"/.exec(app.html());
  assert.ok(child, 'the release links its check-in run');
  app.click('open-run', child[1]); await app.tick();
  assert.strictEqual(app.hash(), '#/run/' + child[1]);
  await back(app); assert.strictEqual(app.hash(), '#/run/' + key); assert.ok(app.html().indexOf('Release 2026.10.16') >= 0);
  app.click('recovery', 'run-missing'); await app.tick();
  app.click('recovery', 'a-runs-file-is-gone'); await app.tick();
  app.click('recovery', 'onedrive-isnt-syncing'); await app.tick();
  assert.strictEqual(app.hash(), '#/recovery/onedrive-isnt-syncing');
  await back(app); assert.strictEqual(app.hash(), '#/recovery/a-runs-file-is-gone');
  numbered(app);
});

rule('Back and Forward: Back with a builder box typed and not applied refuses, keeps the typing and focus, and leaves the entries alone', async () => {
  const app = await navBoot({ localStore: {}, domFocus: true });
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  app.click('ed-done'); await app.tick();
  await back(app);
  assert.strictEqual(app.hash(), '#/process/release/edit');
  app.click('ob-sel', 'flags'); await app.tick();
  const was = /<textarea id="ob-text"[^>]*>([^<]*)</.exec(app.html())[1];
  app.input('ob-text', 'Half typed'); await app.tick();
  const list = JSON.stringify(app.entries());
  await back(app);
  assert.ok(/Apply or clear what you typed in the box first/.test(app.live()), app.live());
  assert.ok(/id="ed-h"/.test(app.html()), 'still the editor');
  assert.strictEqual(app.hash(), '#/process/release/edit'); assert.strictEqual(app.index(), 2);
  assert.strictEqual(JSON.stringify(app.entries()), list, 'the entry after it is still there');
  assert.strictEqual(app.draft('ob-text'), 'Half typed'); assert.strictEqual(app.activeId(), 'ob-text');
  // Cleared, Forward goes where it went before.
  app.input('ob-text', was); await app.tick();
  await fwd(app);
  assert.strictEqual(app.hash(), '#/process/release'); assert.ok(!/id="ed-h"/.test(app.html()));
  assert.strictEqual(app.reloads(), 0); numbered(app);
});

rule('Back and Forward: Back from a step type with changes shows the leave prompt; Leave without saving lands on the list', async () => {
  const app = await navBoot({ domFocus: true });
  app.click('nav', 'types'); await app.tick();
  app.click('edit-type', 'change.request'); await app.tick(40);
  assert.strictEqual(app.hash(), '#/types/edit/change.request');
  app.input('tf-label', 'Changed by me'); await app.tick();
  await back(app); await app.tick(40);
  assert.ok(/This step type has changes that aren.t saved/.test(app.html()), 'the prompt');
  assert.strictEqual(app.hash(), '#/types/edit/change.request'); assert.strictEqual(app.index(), 2);
  assert.strictEqual(app.activeId(), '[data-act="type-save"]');
  app.click('type-cancel'); await app.tick();
  assert.ok(!/id="type-form"/.test(app.html()), 'the list');
  assert.deepStrictEqual(hashes(app), ['#/', '#/types', '#/types']); assert.strictEqual(app.index(), 2);
  numbered(app);
});

rule('Back and Forward: Back from the draft editor with unsaved text goes, says so, and the text is there on Forward', async () => {
  const app = await navBoot();
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  const text = /<textarea[^>]*id="draft-editor"[^>]*>([\s\S]*?)<\/textarea>/.exec(app.html())[1];
  app.input('draft-editor', text.replace('Production release', 'Production release EDITED')); await app.tick(20);
  await back(app);
  assert.strictEqual(app.hash(), '#/process/release'); assert.ok(!/id="ed-h"/.test(app.html()));
  assert.ok(/Your changes aren.t saved yet/.test(app.live()), app.live());
  await fwd(app);
  assert.ok(/id="ed-h"/.test(app.html()) && /Production release EDITED/.test(app.html()), 'the text is in the editor');
});

rule('Back and Forward: Fill in, its values and a note are kept as drafts and come back, by Forward and by a click', async () => {
  const app = await navBoot();
  const key = app.run().key;
  app.click('open-run', key); await app.tick(); app.click('pickup'); await app.tick(40);
  const step = app.nextStep();
  app.click('pick', step, { kind: 'fields' }); await app.tick();
  app.set('fld-job', 'KEPT-1'); await app.tick();
  await back(app);
  assert.ok(onHome(app));
  await fwd(app);
  assert.ok(onRun(app) && /id="fld-job"/.test(app.html()), 'Fill in drawn open again');
  assert.strictEqual(app.draft('fld-job'), 'KEPT-1');
  app.click('nav', 'home'); await app.tick();
  app.click('open-run', key); await app.tick();
  assert.ok(/id="fld-job"/.test(app.html()), 'and after a click back to the run');
  assert.strictEqual(app.draft('fld-job'), 'KEPT-1');
  await back(app); await back(app);
  assert.ok(onRun(app) && /id="fld-job"/.test(app.html()), 'and by Back');
});

rule('Back and Forward: Back closes an open dialog and stays, focus back on its opener; a dialog holding typing refuses', async () => {
  const app = await navBoot({ domFocus: true });
  app.click('open-run', app.run().key); await app.tick();
  const list = JSON.stringify(app.entries());
  app.click('help'); await app.tick();
  assert.ok(/id="help-t"/.test(app.overlay()), 'set-up: help is open');
  await back(app);
  assert.strictEqual(app.overlay(), '', 'closed'); assert.ok(onRun(app), 'still the run');
  assert.strictEqual(JSON.stringify(app.entries()), list); assert.strictEqual(app.index(), 1);
  assert.strictEqual(app.activeId(), '[data-act="help"]');
  const b = await navBoot({ nobody: true }); b.choose('person-morgan'); await b.tick();
  b.click('open-process', 'release'); await b.tick(20);
  const id = /data-act="corr-review" data-id="([\w-]+)"/.exec(b.html())[1];
  b.click('corr-review', id); await b.tick(20); b.click('corr-ca-declining'); await b.tick();
  b.set('ca-reason', 'Not this time'); await b.tick();
  await back(b);
  assert.ok(/id="ca-reason"/.test(b.overlay()), 'not closed'); assert.strictEqual(b.draft('ca-reason'), 'Not this time');
  assert.ok(/Finish or cancel this first\./.test(b.live()));
  assert.strictEqual(b.hash(), '#/process/release'); assert.strictEqual(b.index(), 1); assert.strictEqual(b.reloads(), 0);
});

rule('Back and Forward: on a phone, Back closes the step sheet first and stays on the run; one holding a typed reason stays open', async () => {
  const app = await navBoot({ narrow: true, domFocus: true });
  app.click('open-run', app.run().key); await app.tick(); app.click('pickup'); await app.tick(40);
  const step = app.nextStep();
  app.click('select', step); await app.tick();
  const sheet = app.node('.rw-ins[data-open="true"]');
  assert.ok(sheet && sheet.getAttribute('role') === 'dialog' && sheet.getAttribute('aria-modal') === 'true' && app.topInert(), 'set-up: the sheet is open and modal');
  await back(app);
  assert.ok(!app.node('.rw-ins[data-open="true"]'), 'closed'); assert.ok(onRun(app));
  assert.strictEqual(app.hash(), '#/run/' + app.run().key); assert.strictEqual(app.index(), 1);
  app.click('select', step); await app.tick();
  app.click('pick', step, { kind: 'block' }); await app.tick();
  assert.ok(/id="pick-input"/.test(app.html()), 'set-up: the Block reason box');
  app.set('pick-input', 'Waiting on the board'); await app.tick();
  await back(app); await back(app);
  assert.ok(app.node('.rw-ins[data-open="true"]'), 'the sheet stays open');
  assert.ok(/Finish or cancel this first\./.test(app.live()));
  assert.strictEqual(app.activeId(), 'pick-input'); assert.strictEqual(app.draft('pick-input'), 'Waiting on the board');
  assert.strictEqual(app.hash(), '#/run/' + app.run().key); assert.strictEqual(app.reloads(), 0);
});

rule('Back and Forward: a link to a run that isn\'t in the folder opens its process with a message, replacing the entry', async () => {
  const app = await navBoot({ hash: '#/run/release/no-such-run' });
  assert.ok(onProcess(app), 'the process page');
  assert.ok(/That run isn.t in this folder anymore\./.test(app.live()));
  assert.deepStrictEqual(hashes(app), ['#/process/release']); numbered(app);
  const two = await navBoot({ hash: '#/run/gone-process/abc' });
  assert.ok(/<div class="eyebrow">Runs<\/div>/.test(two.html())); assert.deepStrictEqual(hashes(two), ['#/runs']);
});

rule('Back and Forward: a link to a run whose read failed isn\'t called gone, and opens once Refresh reads it', async () => {
  const app = await navBoot();
  const src = app.run(), j = Object.assign({}, src.json, { id: 'later-run', title: 'Later run' });
  await app.fs.write('runs/release/later-run/run.json', JSON.stringify(j));
  const list = app.fs.list.bind(app.fs); let fail = true;
  app.fs.list = p => fail && p === 'runs' ? Promise.reject(new Error('NotReadableError')) : list(p);
  app.click('refresh'); await app.tick(80);
  app.typeHash('#/run/release/later-run'); await app.settle();
  assert.ok(onProcess(app) && /That run wasn.t found, but part of the team folder couldn.t be read just now\. Refresh tries again\./.test(app.live()) && !/isn.t in this folder anymore/.test(app.live()), app.live());
  fail = false; app.click('refresh'); await app.tick(80); await app.settle();
  assert.ok(onRun(app) && /Later run/.test(app.html()), 'opened once read');
  assert.strictEqual(app.hash(), '#/run/release/later-run');
  /* Moving elsewhere first drops the retry. */
  await app.fs.write('runs/release/third-run/run.json', JSON.stringify(Object.assign({}, j, { id: 'third-run', title: 'Third run' })));
  fail = true; app.click('refresh'); await app.tick(80);
  app.typeHash('#/run/release/third-run'); await app.settle();
  assert.ok(/Refresh tries again/.test(app.live()), 'set-up: not read');
  app.click('nav', 'runs'); await app.tick();
  fail = false; app.click('refresh'); await app.tick(80); await app.settle();
  assert.ok(!onRun(app), 'stays where it was moved to');
});

rule('Back and Forward: a link to the current version while publications couldn\'t be read waits for them, not the draft', async () => {
  const app = boot({ localStore: { 'preflight:builder': 'false' }, hash: '#/process/release/current' });
  const proto = app.PF.fs.MemoryFS.prototype, list = proto.list; let fail = true;
  proto.list = function (p) { return fail && /^publications/.test(p) ? Promise.reject(new Error('NotReadableError')) : list.call(this, p); };
  await app.tick(80); app.choose('person-casey'); await app.tick(); await app.settle();
  assert.ok(/That version wasn.t found, but part of the team folder couldn.t be read just now\. Refresh tries again\./.test(app.live()), app.live());
  fail = false; app.click('refresh'); await app.tick(80); await app.settle();
  assert.strictEqual(app.hash(), '#/process/release/current', 'the published version opens once read');
});

rule('Back and Forward: a link to a process whose draft couldn\'t be read isn\'t called gone, and opens once Refresh reads it', async () => {
  const app = await navBoot(), path = 'maps/drafts/later.md';
  await app.fs.write(path, ['---', 'process: later', 'title: Later process', '---', '', '## One · READ-DO {#one}', '- [ ] {confirm} Do it {#it}', ''].join('\n'));
  const read = app.fs.read.bind(app.fs); let fail = true;
  app.fs.read = p => fail && p === path ? Promise.reject(new Error('NotReadableError')) : read(p);
  app.click('refresh'); await app.tick(80);
  app.typeHash('#/process/later'); await app.settle();
  assert.ok(/That process wasn.t found, but part of the team folder couldn.t be read just now\. Refresh tries again\./.test(app.live()), app.live());
  fail = false; app.click('refresh'); await app.tick(80); await app.settle();
  assert.ok(onProcess(app, 'Later process'), 'opened once read');
  assert.strictEqual(app.hash(), '#/process/later');
  /* A target the folder was read without any failure is gone, and says so. */
  app.typeHash('#/process/never'); await app.settle();
  assert.ok(/That process isn.t in this folder anymore\./.test(app.live()), app.live());
});

/* The examples' folder fingerprint, as entries made in them carry it. */
async function examplesFp() { const a = boot(); await a.tick(60); return a.entries()[0].state.f; }
/* A remembered team folder holding a copy of another boot's examples (its runs have other IDs than a new boot's). */
async function teamCopy() { const src = boot(); await src.tick(80); const files = {}; sameRunsFolder(src, files); return { files, key: src.run().key, fp: src.PF.util.hash('folder:team-1') }; }

rule('Back and Forward: an entry from another folder is refused, nothing of it opens, and the next Back reaches the one before', async () => {
  const fp = await examplesFp();
  const app = await navBoot({ entries: [{ hash: '#/', state: { fd: 1, n: 0, f: fp } }, { hash: '#/runs', state: { fd: 1, n: 1, f: 'deadbeef' } }, { hash: '#/processes', state: { fd: 1, n: 2, f: fp } }] });
  assert.ok(/<div class="eyebrow">Processes<\/div>/.test(app.html()), 'the reload lands on its own entry');
  await back(app);
  assert.ok(/That page was in another team folder, so it wasn.t opened\./.test(app.live()));
  assert.ok(/<div class="eyebrow">Processes<\/div>/.test(app.html()), 'nothing of it opened');
  assert.deepStrictEqual(app.entries()[1], { hash: '#/processes', state: { fd: 1, n: 1, f: fp } }, 'replaced with where you are');
  await back(app);
  assert.ok(onHome(app)); assert.strictEqual(app.index(), 0); assert.strictEqual(app.reloads(), 0);
});

rule('Back and Forward: a reload on a run link while the folder needs Reconnect shows Home, then the team folder\'s run after Reconnect', async () => {
  const t = await teamCopy();
  const app = await navBoot({ indexedDB: await rememberedFolder(t.files), picker: folderHandle('Other', {}), hash: '#/run/' + t.key, historyState: { fd: 1, n: 3, f: t.fp } });
  assert.ok(onHome(app), 'Home first'); assert.ok(/Reconnect to open the page you linked to\./.test(app.html()));
  assert.strictEqual(app.hash(), '#/run/' + t.key, 'the address bar keeps the link');
  app.click('reconnect'); await app.tick(200);
  assert.ok(onRun(app), 'the run'); assert.strictEqual(app.hash(), '#/run/' + t.key);
  assert.deepStrictEqual(app.entries(), [{ hash: '#/run/' + t.key, state: { fd: 1, n: 3, f: t.fp } }]);
});

rule('Back and Forward: while Reconnect is pending, a pasted link waits and never opens the examples\' copy; inside the examples Back and Forward work', async () => {
  const t = await teamCopy();
  const app = await navBoot({ indexedDB: await rememberedFolder(t.files), picker: folderHandle('Other', {}) });
  const exKey = app.run().key;
  app.click('open-process', 'release'); await app.tick();
  app.click('open-run', exKey); await app.tick();
  await back(app); assert.ok(onProcess(app), 'Back inside the examples'); await fwd(app); assert.ok(onRun(app), 'and Forward');
  app.click('nav', 'home'); await app.tick();
  app.typeHash('#/process/release'); await app.settle();
  assert.ok(onHome(app), 'waits on Home'); assert.ok(/Reconnect to open the page you linked to\./.test(app.html()));
  // A Back to a team-folder entry waits the same way.
  app.click('reconnect'); await app.tick(200);
  assert.ok(onProcess(app), 'opens after Reconnect'); assert.strictEqual(app.hash(), '#/process/release');
  assert.ok(app.html().indexOf(t.key.split('/')[1]) >= 0 && app.html().indexOf(exKey.split('/')[1]) < 0, 'the team folder\'s release, not the examples\'');
  assert.ok(app.entries().every(e => e.state && e.state.fd === 1), 'every entry is numbered');
});

rule('Back and Forward: a link opened inside the examples while Reconnect waits drops it with a message', async () => {
  const t = await teamCopy();
  const app = await navBoot({ indexedDB: await rememberedFolder(t.files), picker: folderHandle('Other', {}), hash: '#/process/release', historyState: null });
  assert.ok(onHome(app));
  app.click('nav', 'runs'); await app.tick();
  assert.ok(/The linked page wasn.t opened\./.test(app.live()));
  app.click('reconnect'); await app.tick(200);
  assert.ok(!onProcess(app), 'nothing opens after Reconnect');
});

rule('Back and Forward: focus goes to the new screen\'s heading after Back', async () => {
  const app = await navBoot({ domFocus: true });
  app.click('open-process', 'release'); await app.tick();
  app.click('open-run', app.run().key); await app.tick();
  app.click('nav', 'runs'); await app.tick();
  await back(app); assert.strictEqual(app.activeId(), 'run-h');
  await back(app); assert.strictEqual(app.activeId(), 'page-h'); assert.ok(onProcess(app));
  await back(app); assert.strictEqual(app.activeId(), 'page-h'); assert.ok(onHome(app));
});

rule('Back and Forward: only route words and IDs reach the address bar and history state', async () => {
  const app = await navBoot();
  const key = app.run().key, r = app.run().json;
  app.click('open-process', 'release'); await app.tick();
  app.click('open-run', key); await app.tick(); app.click('mission'); await app.tick(); app.click('exit-mission'); await app.tick();
  app.click('receipt'); await app.tick();
  app.click('nav', 'skills'); await app.tick();
  const sk = /data-act="open-skill" data-id="([^"]+)"/.exec(app.html())[1];
  app.click('open-skill', sk); await app.tick();
  app.click('nav', 'runs'); await app.tick();
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  app.click('nav', 'settings'); await app.tick(); app.click('nav', 'types'); await app.tick(); app.click('health'); await app.tick(40); app.click('connection'); await app.tick(40);
  const words = [r.title, sk, 'Casey', 'person-casey', 'examples', 'preflight'].concat(Object.values(r.details || {}).filter(v => String(v).length > 3));
  app.entries().forEach(e => {
    assert.ok(ID_ONLY.test(e.hash), e.hash);
    words.forEach(w => assert.ok(e.hash.toLowerCase().indexOf(String(w).toLowerCase()) < 0, e.hash + ' has ' + w));
    assert.deepStrictEqual(Object.keys(e.state).sort(), ['f', 'fd', 'n']); assert.ok(/^[0-9a-f]{8}$/.test(e.state.f));
  });
  assert.ok(hashes(app).indexOf('#/skill/' + app.PF.util.hash(sk)) >= 0);
  assert.ok(hashes(app).indexOf('#/plan/' + app.PF.util.hash('plan-release-2026-10-24')) >= 0);
});

rule('Back and Forward: Alt+Left in the picture viewer leaves the picture alone (it is the browser\'s Back)', async () => {
  const app = await navBoot();
  const r = app.run(), lines = r.json.snapshot.split('\n'), i = lines.findIndex(l => /\{#announce\}/.test(l));
  lines.splice(i + 1, 0, '  ![Picture one](images/release/a.png)', '  ![Picture two](images/release/b.png)');
  r.json.snapshot = lines.join('\n'); r.json.rev = (r.json.rev || 0) + 1;
  await app.fs.write(r.path, JSON.stringify(r.json)); app.click('refresh'); await app.tick(80);
  app.click('open-run', r.key); await app.tick(); app.click('select', 'announce'); await app.tick();
  app.click('zoom', 'announce', { i: '0' }); await app.tick();
  assert.ok(/Picture one/.test(app.overlay()), 'set-up: the first picture');
  app.keyOn('ArrowLeft', { altKey: true }); await app.tick();
  app.keyOn('ArrowRight', { altKey: true }); await app.tick();
  app.keyOn('ArrowRight', { metaKey: true }); await app.tick();
  assert.ok(/Picture one/.test(app.overlay()) && !/Picture two<\/figcaption>/.test(app.overlay()), 'not stepped');
  app.keyOn('ArrowRight'); await app.tick();
  assert.ok(/Picture two/.test(app.overlay()), 'a plain arrow still steps');
});

rule('Back and Forward: the default page, the current version and an older one are three places, each showing its own text', async () => {
  const app = await navBoot();
  const path = 'maps/drafts/release.md';
  await app.fs.write(path, app.fs.files[path].t.replace('Post "starting release" in the team channel', 'Post DRAFTONLY in the team channel'));
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  // The checklist's own row for the step (the page also lists the draft's changes).
  const draftShown = a => /id="cl-st-announce"[^>]*>(?:(?!<\/li>)[\s\S])*DRAFTONLY/.test(a.html());
  assert.ok(draftShown(app), 'set-up: the page shows the draft');
  app.click('back-current'); await app.tick();
  assert.strictEqual(app.hash(), '#/process/release/current'); assert.ok(!draftShown(app));
  const v1 = /<option value="(v1-[a-z0-9]+)"/.exec(app.html())[1];
  app.select('map-ver', v1); await app.tick(); app.gone('map-ver');
  assert.strictEqual(app.hash(), '#/process/release/v/' + v1);
  const v1Text = app.html();
  await back(app); assert.ok(!draftShown(app) && /<option value="v2-[a-z0-9]+" selected>/.test(app.html()), 'the current version');
  await back(app); assert.ok(draftShown(app), 'the draft again'); assert.strictEqual(app.hash(), '#/process/release');
  await fwd(app); assert.ok(!draftShown(app)); assert.strictEqual(app.hash(), '#/process/release/current');
  await fwd(app); assert.strictEqual(app.html(), v1Text, 'the older version, the same as before');
  numbered(app);
});

rule('Back and Forward: a running run\'s receipt is reached again by Back, Forward and a reload on its link', async () => {
  const app = await navBoot();
  const key = app.run().key;
  app.click('open-run', key); await app.tick(); app.click('receipt'); await app.tick();
  await back(app); assert.ok(onRun(app)); await fwd(app); assert.ok(onReceipt(app) && /In progress/.test(app.html()));
  const again = await navBoot({ localStore: app.store, hash: '#/run/' + key + '/receipt', historyState: app.entries()[app.index()].state });
  assert.ok(onReceipt(again), 'a reload on the link'); assert.strictEqual(again.hash(), '#/run/' + key + '/receipt');
});

rule('Back and Forward: step types: a type called new, a new form, and a changed form kept across Back-menu jumps', async () => {
  const app = await navBoot();
  const def = JSON.parse(app.fs.files['step-types/change.request.json'].t); def.id = 'new'; def.label = 'Called new';
  await app.fs.write('step-types/new.json', JSON.stringify(def, null, 2)); app.click('refresh'); await app.tick(80);
  app.click('nav', 'types'); await app.tick();
  app.click('edit-type', 'new'); await app.tick(40);
  assert.strictEqual(app.hash(), '#/types/edit/new'); assert.ok(/value="Called new"/.test(app.html()));
  app.click('type-cancel'); await app.tick();
  app.click('new-type'); await app.tick();
  assert.strictEqual(app.hash(), '#/types/new');
  // An unchanged new form: a jump to the type's entry opens that type.
  app.go(-2); await app.settle(); await app.tick(40);
  assert.ok(/value="Called new"/.test(app.html()), 'type A opens'); assert.strictEqual(app.hash(), '#/types/edit/new');
  await fwd(app); await fwd(app); await app.tick(40);
  assert.ok(/That new step type was closed\./.test(app.live()), app.live()); assert.strictEqual(app.hash(), '#/types');
  // A changed new form B: the jump keeps B with the prompt, at B's place.
  app.click('new-type'); await app.tick(); app.input('tf-label', 'Form B'); await app.tick();
  const at = app.index();
  app.go(-3); await app.settle(); await app.tick(40); await app.settle();
  assert.ok(/Form B/.test(app.html()) && /This step type has changes that aren.t saved/.test(app.html()), 'B kept, with the prompt');
  assert.ok(/Save or leave this step type first, then go back again\./.test(app.live()), app.live() + JSON.stringify(app.entries()));
  assert.strictEqual(app.index(), at); assert.strictEqual(app.hash(), '#/types/new');
  // From another screen, a #/types entry while B is kept shows B's prompt under B's own location.
  app.click('nav', 'runs'); await app.tick();
  await back(app);
  assert.ok(/This step type has changes that aren.t saved/.test(app.html()) && /Form B/.test(app.html()));
  assert.strictEqual(app.hash(), '#/types/new'); numbered(app); assert.strictEqual(app.reloads(), 0);
});

rule('Back and Forward: a slow step-type read from Back never reopens over a later Back to the list', async () => {
  const app = await navBoot();
  app.click('nav', 'types'); await app.tick();
  app.click('edit-type', 'change.request'); await app.tick(40);
  app.click('type-cancel'); await app.tick();
  app.click('nav', 'runs'); await app.tick();
  const read = app.fs.read.bind(app.fs), g = gate();
  app.fs.read = p => p === 'step-types/change.request.json' ? read(p).then(v => g.p.then(() => v)) : read(p);
  app.click('nav', 'types'); await app.tick();
  app.go(-3); await app.settle(); await app.tick(5);
  assert.ok(!/id="type-form"/.test(app.html()), 'the read is still on its way');
  await back(app); await app.tick(5);
  g.open(); await app.tick(80); await app.settle();
  assert.ok(!/id="type-form"/.test(app.html()), 'stays on the list');
  assert.ok(/^#\/types$/.test(app.hash()), app.hash()); numbered(app); assert.strictEqual(app.reloads(), 0);
});

rule('Back and Forward: screen share, the receipt and Finish return to the run with Fill in and a correction open, values intact', async () => {
  for (const [go, leave] of [['mission', 'back'], ['receipt', 'back'], ['finish', 'back'], ['mission', 'exit-mission'], ['receipt', 'escape']]) {
    const app = await navBoot();
    const key = app.run().key;
    app.click('open-run', key); await app.tick(); app.click('pickup'); await app.tick(40);
    const step = app.nextStep();
    app.click('pick', step, { kind: 'fields' }); await app.tick();
    app.set('fld-job', 'JOB-9'); await app.tick();
    app.click('corr-open', step, { mode: 'correct' }); await app.tick();
    app.input('corr-why', 'WHY-9'); await app.tick();
    app.click(go); await app.tick();
    if (leave === 'back') await back(app); else if (leave === 'escape') { app.key('Escape'); await app.tick(); } else { app.click(leave); await app.tick(); }
    assert.ok(onRun(app), go + ' ' + leave + ': the run');
    assert.ok(/id="fld-job"/.test(app.html()) && app.draft('fld-job') === 'JOB-9', go + ' ' + leave + ': Fill in open with its value');
    assert.ok(/id="corr-why"/.test(app.html()) && app.draft('corr-why') === 'WHY-9', go + ' ' + leave + ': the correction open with its text');
  }
});

rule('Back and Forward: Back to a draft removed from the folder while it had unsaved edits shows its recovery page', async () => {
  const app = await navBoot();
  app.click('open-process', 'incident'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  const text = /<textarea[^>]*id="draft-editor"[^>]*>([\s\S]*?)<\/textarea>/.exec(app.html())[1];
  app.input('draft-editor', text + '\nEDITED-LINE'); await app.tick(20);
  app.click('nav', 'home'); await app.tick();
  delete app.fs.files['maps/drafts/incident.md'];
  Object.keys(app.fs.files).filter(p => /^publications\/incident\//.test(p)).forEach(p => { delete app.fs.files[p]; });
  app.click('refresh'); await app.tick(80);
  await back(app);
  assert.ok(/This draft was removed from the folder/.test(app.html()) && /EDITED-LINE/.test(app.html()), app.live());
});

rule('Back and Forward: a click while Back puts the address bar back after closing a dialog still gets its own entry', async () => {
  const app = await navBoot();
  app.click('nav', 'runs'); await app.tick();
  app.click('nav', 'settings'); await app.tick();
  app.key('?'); await app.tick();
  app.back(); await new Promise(r => setTimeout(r, 0)); app.holdPops();
  app.click('nav', 'skills'); await app.tick();
  app.releasePops(); await app.settle();
  assert.strictEqual(app.hash(), '#/skills');
  assert.deepStrictEqual(hashes(app), ['#/', '#/runs', '#/settings', '#/skills']);
  await back(app);
  assert.strictEqual(app.hash(), '#/settings'); numbered(app); assert.strictEqual(app.reloads(), 0);
});

rule('Back and Forward: overlapping moves never reload, never reuse a number, and end on the drawn entry', async () => {
  const app = await navBoot({ localStore: {} });
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Half typed'); await app.tick();
  app.holdPops(); app.back(); app.back(); app.releasePops();
  await app.settle(); await new Promise(r => setTimeout(r, 1200)); await app.settle();
  assert.strictEqual(app.hash(), '#/process/release/edit'); assert.strictEqual(app.index(), 2);
  assert.deepStrictEqual(hashes(app), ['#/', '#/process/release', '#/process/release/edit']);
  assert.ok(/id="ed-h"/.test(app.html()) && app.draft('ob-text') === 'Half typed');
  // A typed hash refused while a dialog is open, then the dialog again and Back.
  const b = await navBoot();
  b.click('open-process', 'release'); await b.tick();
  b.key('?'); await b.tick();
  b.typeHash('#/runs'); await b.settle();
  assert.strictEqual(b.overlay(), '', 'the dialog closed first'); assert.ok(onProcess(b));
  b.key('?'); await b.tick();
  await back(b); await new Promise(r => setTimeout(r, 50)); await b.settle();
  assert.strictEqual(b.reloads(), 0); numbered(b);
  assert.strictEqual(b.overlay(), ''); assert.ok(onProcess(b));
  assert.strictEqual(app.reloads(), 0); assert.strictEqual(app.popMismatch() + b.popMismatch(), 0);
});

rule('Back and Forward: text typed in Add a tag on an otherwise unchanged form isn\'t lost: it becomes a tag and the form is kept', async () => {
  const app = await navBoot();
  app.click('nav', 'types'); await app.tick();
  app.click('edit-type', 'change.request'); await app.tick(40);
  app.click('type-cancel'); await app.tick();
  app.click('new-type'); await app.tick();
  app.set('tf-tagadd', 'risky');
  app.go(-2); await app.settle(); await app.tick(40);
  assert.ok(/This step type has changes that aren.t saved/.test(app.html()), 'the prompt, not closed');
  assert.ok(/#risky/.test(app.html()), 'the text became a tag');
  assert.strictEqual(app.hash(), '#/types/new');
});

rule('Back and Forward: the start form never shows another folder\'s planning, by click or by history', async () => {
  const t = await teamCopy();
  const app = await navBoot({ picker: folderHandle('B', t.files), indexedDB: memoryIDB() });
  app.click('open-run', app.run().key); await app.tick();
  app.click('plan-from-run', app.run().key); await app.tick();
  assert.ok(/Plan a run/.test(app.html()) && /Release 2026\.10\.16/.test(app.html()), 'set-up: planning from folder A\'s run');
  app.click('connect'); await app.tick(200);
  app.click('open-process', 'release'); await app.tick();
  app.click('start', 'release'); await app.tick();
  assert.ok(!/Plan a run/.test(app.html()), 'by click: a plain start form');
  app.click('nav', 'runs'); await app.tick();
  app.typeHash('#/process/release/start'); await app.settle();
  assert.ok(/id="start-form"/.test(app.html()) && !/Plan a run/.test(app.html()), 'by history: a plain start form');
});

rule('Back and Forward: skill file names the loader accepts round-trip as a fingerprint, by Back, Forward and a reload', async () => {
  const app = await navBoot();
  const base = JSON.parse(app.fs.files['skills/pr-opener.json'].t);
  const names = ['backup checks.json', 'backup (1).json', 'バックアップの確認と復元の手順書を毎週見直すための自動化スキルです一二三四.json'];
  for (const [i, n] of names.entries()) await app.fs.write('skills/' + n, JSON.stringify(Object.assign({}, base, { name: 'skill-' + i }), null, 2));
  app.click('refresh'); await app.tick(80);
  for (const n of names) {
    app.click('nav', 'skills'); await app.tick();
    assert.ok(app.html().indexOf('data-act="open-skill" data-id="' + n + '"') >= 0, 'listed: ' + n);
    app.click('open-skill', n); await app.tick();
    const h = '#/skill/' + app.PF.util.hash(n);
    assert.strictEqual(app.hash(), h);
    await back(app); await fwd(app);
    assert.strictEqual(app.hash(), h); assert.ok(/<div class="eyebrow">Skill/.test(app.html()), 'Forward opens it');
    const again = await navBoot({ localStore: app.store, hash: h, historyState: app.entries()[app.index()].state });
    assert.ok(/<div class="eyebrow">Skill/.test(again.html()) && again.html().indexOf('skill-' + names.indexOf(n)) >= 0, 'a reload opens it: ' + n);
  }
});

rule('Back and Forward: starting a run from a plan or the start form makes one entry, the run\'s, also when the person moves meanwhile', async () => {
  const app = await navBoot();
  app.click('nav', 'runs'); await app.tick();
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  const before = hashes(app);
  app.submitForm('start-form'); await app.tick(200);
  assert.ok(onRun(app), 'set-up: started');
  assert.deepStrictEqual(hashes(app).slice(0, -1), before); assert.ok(/^#\/run\/release\//.test(app.hash()));
  app.click('open-process', 'release'); await app.tick(); app.click('start', 'release'); await app.tick();
  const two = hashes(app);
  app.submitForm('start-form'); await app.tick(200);
  assert.deepStrictEqual(hashes(app).slice(0, -1), two); assert.ok(/^#\/run\/release\//.test(app.hash()));
  // Paused in the folder's read: the person visits Runs and Settings, then the run lands after them.
  app.click('start', 'release'); await app.tick();
  const list = app.fs.list.bind(app.fs), g = gate(); let armed = true;
  app.fs.list = p => { if (armed && p === 'runs') { armed = false; return list(p).then(x => g.p.then(() => x)); } return list(p); };
  const three = hashes(app);
  app.submitForm('start-form'); await app.tick(60);
  app.click('nav', 'runs'); await app.tick(); app.click('nav', 'settings'); await app.tick();
  g.open(); await app.tick(200);
  assert.deepStrictEqual(hashes(app).slice(0, three.length), three);
  assert.deepStrictEqual(hashes(app).slice(three.length, -1), ['#/runs', '#/settings']); assert.ok(/^#\/run\/release\//.test(app.hash()));
  numbered(app);
});

rule('Back and Forward: a decided plan never reopens with Start the run or Decline; its files are unchanged', async () => {
  const app = await navBoot();
  app.click('nav', 'runs'); await app.tick();
  app.click('review-plan', 'plan-release-2026-10-24'); await app.tick();
  app.submitForm('start-form'); await app.tick(200);
  const key = app.run && /^#\/run\/(.*)$/.exec(app.hash())[1];
  app.click('nav', 'runs'); await app.tick();
  app.click('review-plan', 'plan-release-example-next'); await app.tick();
  app.click('decline-plan', 'plan-release-example-next'); await app.tick(100);
  const files = JSON.stringify(Object.keys(app.fs.files).filter(p => /^proposals\//.test(p)).map(p => [p, app.fs.files[p].t]));
  const startOrDecline = h => /id="start-form"/.test(h) || /data-act="decline-plan"/.test(h);
  await back(app); assert.ok(!startOrDecline(app.html()) && /That plan was declined\./.test(app.live()), 'declined: Runs');
  for (let i = 0; i < 3; i++) await back(app);
  assert.ok(!startOrDecline(app.html()) && onRun(app) && app.hash() === '#/run/' + key, 'accepted: its run (' + app.hash() + ')');
  const again = await navBoot({ localStore: app.store, hash: '#/plan/' + app.PF.util.hash('plan-release-example-next') });
  assert.ok(!startOrDecline(again.html()) && /That plan was declined\./.test(again.live()), 'a reload too');
  assert.strictEqual(JSON.stringify(Object.keys(app.fs.files).filter(p => /^proposals\//.test(p)).map(p => [p, app.fs.files[p].t])), files);
});

rule('Back and Forward: Getting started belongs to its folder; Start your team survives a trip to Runs and back', async () => {
  const { example } = require('./harness');
  const a = {}, b = { 'people.json': example('people.json') }, opts = { localStore: { 'preflight:builder': 'false' }, picker: folderHandle('A', a), indexedDB: memoryIDB() };
  const app = boot(opts); await app.tick(80);
  app.click('setup-mode', 'start'); await app.tick();
  app.click('setup-pick'); await app.tick(80);
  app.click('setup-next', 'people'); await app.tick();
  app.input('su-me-name', 'Riley Park'); await app.tick();
  app.click('nav', 'runs'); await app.tick();
  await back(app);
  assert.ok(/id="su-h"/.test(app.html()) && /Riley Park/.test(app.html() + app.draft('su-me-name')), 'the wizard, still open, with its input');
  assert.strictEqual(app.hash(), '#/setup');
  // Another folder opened with Change team folder: nothing of the wizard comes along.
  app.click('nav', 'runs'); await app.tick();
  opts.picker = folderHandle('B', b);
  app.click('connect'); await app.tick(200);
  app.choose('person-avery'); await app.tick();
  app.click('nav', 'settings'); await app.tick();
  for (const how of ['back', 'typed']) {
    if (how === 'back') { app.go(-2); await app.settle(); } else { app.typeHash('#/setup'); await app.settle(); }
    // The wizard's entry was made in the examples, so Back refuses it as another folder's; typed, it's Getting started closed.
    assert.ok(how === 'back' ? /That page was in another team folder, so it wasn.t opened\./.test(app.live()) : onHome(app) && /Getting started was closed\. Continue it from Home\./.test(app.live()), how + ': ' + app.live());
    assert.ok(!/Riley Park/.test(app.html()) && !/id="su-h"/.test(app.html()), how + ': nothing of folder A');
    app.click('nav', 'settings'); await app.tick();
  }
});

rule('Back and Forward: Add a person typed in one folder is empty in the next, by click and by Back', async () => {
  const { example } = require('./harness');
  const a = { 'people.json': example('people.json') }, b = { 'people.json': example('people.json') }, opts = { picker: folderHandle('A', a), indexedDB: memoryIDB() };
  const app = boot(opts); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.choose('person-avery'); await app.tick();
  app.click('nav', 'settings'); await app.tick();
  app.input('pa-name', 'Folder A Person'); app.input('pa-email', 'a@example.com'); await app.tick();
  app.click('nav', 'runs'); await app.tick();
  opts.picker = folderHandle('B', b);
  app.click('connect'); await app.tick(200); app.goneUndrawn();
  app.click('nav', 'settings'); await app.tick();
  assert.ok(!/Folder A Person|a@example\.com/.test(app.html()), 'by click: empty');
  app.click('nav', 'runs'); await app.tick();
  await back(app);
  assert.ok(/<div class="eyebrow">Settings<\/div>/.test(app.html()) && !/Folder A Person|a@example\.com/.test(app.html()), 'by Back: empty');
  app.submit('people-add-form'); await app.tick(200);
  assert.ok(!/Folder A Person/.test(b['people.json']), 'nothing of A\'s submitted to B');
});

rule('Back and Forward: IDs the readers accept round-trip: a plan ID with dots and a 90-character process ID', async () => {
  const app = await navBoot();
  const plan = JSON.parse(app.fs.files['proposals/plan-release-2026-10-24.json'].t); plan.id = 'plan-release-2026.10.20';
  await app.fs.write('proposals/plan-release-2026.10.20.json', JSON.stringify(plan, null, 2));
  const long = 'p' + 'ab-'.repeat(29) + 'z', draft = app.fs.files['maps/drafts/check-in.md'].t.replace(/^process: .*$/m, 'process: ' + long);
  assert.strictEqual(long.length, 89 + 0 * 1 || long.length);
  await app.fs.write('maps/drafts/' + long + '.md', draft);
  app.click('refresh'); await app.tick(80);
  app.click('nav', 'runs'); await app.tick();
  app.click('review-plan', 'plan-release-2026.10.20'); await app.tick();
  const ph = app.hash(); assert.strictEqual(ph, '#/plan/' + app.PF.util.hash('plan-release-2026.10.20'));
  app.click('open-process', long); await app.tick();
  assert.strictEqual(app.hash(), '#/process/' + long);
  await back(app); assert.ok(/id="start-form"/.test(app.html()), 'the plan again'); await fwd(app); assert.ok(onProcess(app));
  for (const h of [ph, '#/process/' + long]) {
    const again = await navBoot({ localStore: app.store, hash: h, historyState: app.entries()[0].state });
    assert.strictEqual(again.hash(), h, 'a reload keeps ' + h);
    assert.ok(h === ph ? /id="start-form"/.test(again.html()) : onProcess(again), 'and opens it');
  }
});

rule('Back and Forward: the browser\'s place and the drawn entry stay right through held links, typed hashes and guarded jumps', async () => {
  // (b) entries 0 to 4 with 4 drawn; a jump to entry 1 held for Reconnect; a typed hash becomes entry 2 and cuts 3 and 4;
  // Reconnect opens it; then a guarded Back to entry 1 is put back on entry 2.
  const t = await teamCopy();
  const app = await navBoot({ localStore: {}, indexedDB: await rememberedFolder(t.files), picker: folderHandle('Other', {}) });
  app.click('nav', 'runs'); await app.tick(); app.click('nav', 'processes'); await app.tick(); app.click('nav', 'skills'); await app.tick(); app.click('nav', 'settings'); await app.tick();
  numbered(app); assert.strictEqual(app.index(), 4);
  const entries = app.entries(); entries[1] = { hash: '#/process/release', state: { fd: 1, n: 1, f: t.fp } };
  const b = await navBoot({ localStore: {}, indexedDB: await rememberedFolder(t.files), picker: folderHandle('Other', {}), entries, index: 4 });
  b.go(-3); await b.settle();
  assert.strictEqual(b.index(), 1); assert.ok(/<div class="eyebrow">Settings<\/div>/.test(b.html()) || onHome(b), 'held: the screen stays');
  b.typeHash('#/process/release/edit'); await b.settle();
  assert.deepStrictEqual(hashes(b).length, 3); assert.strictEqual(b.index(), 2); numbered(b);
  b.click('reconnect'); await b.tick(200);
  assert.strictEqual(b.hash(), '#/process/release/edit'); assert.ok(/id="ed-h"/.test(b.html()), 'opened in the team folder');
  b.click('ob-sel', 'flags'); await b.tick(); b.input('ob-text', 'typed'); await b.tick();
  await back(b);
  assert.ok(/Apply or clear what you typed/.test(b.live()));
  assert.strictEqual(b.index(), 2); assert.strictEqual(b.hash(), '#/process/release/edit'); numbered(b); assert.strictEqual(b.reloads(), 0);
});

rule('Back and Forward: End the run lands on the receipt in Finish\'s place, so Back never reopens Finish of an ended run', async () => {
  const app = await navBoot();
  const key = app.run().key;
  app.click('open-run', key); await app.tick(); app.click('pickup'); await app.tick(40);
  app.click('finish'); await app.tick();
  assert.strictEqual(app.hash(), '#/run/' + key + '/finish');
  app.click('end', 'Cancelled'); await app.tick(60);
  assert.ok(onReceipt(app), 'set-up: ended');
  assert.deepStrictEqual(hashes(app), ['#/', '#/run/' + key, '#/run/' + key + '/receipt']);
  await back(app); assert.ok(onRun(app));
  const again = await navBoot({ localStore: app.store, hash: '#/run/' + key + '/finish' });
  assert.ok(onReceipt(again) && again.hash() === '#/run/' + key + '/receipt', 'a link to Finish of an ended run is its receipt');
});

rule('Back and Forward: every promise callback in the app that changes a route field holds the URL, replaces, or is a known landing', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  // The callback's body, by its braces (strings and comments skipped).
  const bodyAt = i => {
    let d = 0, q = null;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j) + 1; continue; }
      if (c === '{') d++; else if (c === '}' && !--d) return src.slice(i, j + 1);
    }
    return src.slice(i);
  };
  const ROUTE = /state\.(view|processId|runKey|ptab|mapVer|planId|skillFile|recoveryAt|typeForm)\s*=[^=]|setView\(|openRun\(|\bhome\(\)/;
  // Held (holdNav), replacing (H.mode), opening a folder (useFs replaces), or the person's own save, start or decline
  // landing, which pushes like the click it finishes (docs/design.md section 29).
  const OK = ['releaseNav(held)', 'heldOwn(held', 'H.mode = \'replace\'', 'useFs(', 'Plan declined', 'Created the draft for', 'Planned \' + plan.title', 'savedDraft(file', 'Published \' + f.title'];
  const re = /\.then\(function\s*\([^)]*\)\s*\{/g; let m; const found = [];
  while ((m = re.exec(src))) { const b = bodyAt(m.index + m[0].length - 1); if (ROUTE.test(b)) found.push(b); }
  assert.ok(found.length >= 10, 'the scan finds the callbacks: ' + found.length);
  assert.deepStrictEqual(found.filter(b => !OK.some(k => b.indexOf(k) >= 0)).map(b => b.replace(/\s+/g, ' ').slice(0, 160)), []);
});

/* ---------- Back and Forward with what 2.0 added (the 1.22 merge) ---------- */
rule('Back and Forward (2.0): a plan/2 link reopens its review on its exact version, then switched after "Start on v2 instead", and once started opens its run', async () => {
  const app = await navBoot();
  await exactPlan(app);
  const fp = '#/plan/' + app.PF.util.hash('plan-release-exact');
  app.click('review-plan', 'plan-release-exact'); await app.tick();
  assert.strictEqual(app.hash(), fp);
  app.click('nav', 'runs'); await app.tick();
  await back(app);
  assert.strictEqual(app.hash(), fp);
  assert.ok(/This plan was made for v1\. v2 is now published\./.test(app.html()) && /id="start-form"/.test(app.html()), 'Back reopens the review on v1');
  // Its folder goes: the link reopens the question, never a quiet switch; the person switches; the link keeps the switch.
  const v1 = pubFolder(app, 1), v2 = pubFolder(app, 2);
  app.files('publications/release/' + v1 + '/').forEach(p => { delete app.fs.files[p]; });
  app.click('nav', 'runs'); await app.tick(); app.click('refresh'); await app.tick(80);
  await back(app);
  assert.ok(/It won(&#39;|')t start on another version by itself\./.test(app.html()) && !/id="start-form"/.test(app.html()), 'asks, with no form');
  app.click('plan-retarget', 'plan-release-exact', { folder: v2 }); await app.tick(120);
  assert.ok(/Switched to v2/.test(app.html()));
  await back(app); await fwd(app);
  assert.strictEqual(app.hash(), fp);
  assert.ok(/Switched to v2/.test(app.html()) && /id="start-form"/.test(app.html()), 'the switch is kept by Back and Forward');
  const before = releaseRuns(app);
  app.submitForm('start-form'); await app.tick(200);
  const made = releaseRuns(app).filter(p => before.indexOf(p) < 0), run = JSON.parse(app.fs.files[made[0]].t), key = 'release/' + run.id;
  assert.strictEqual(run.folder, v2); assert.strictEqual(app.hash(), '#/run/' + key);
  await back(app);
  assert.ok(onRun(app) && app.hash() === '#/run/' + key && !/id="start-form"/.test(app.html()), 'the accepted plan/2 opens its run (' + app.hash() + ')');
  numbered(app); assert.strictEqual(app.reloads(), 0);
});

rule('Back and Forward (2.0): a link to a run this copy can only read opens it read-only; its Finish link lands on the run and nothing is written', async () => {
  const app = await navBoot();
  const src = JSON.parse(app.fs.files[releaseRuns(app)[0]].t), fpath = 'runs/release/ro-two/run.json';
  const text = JSON.stringify(Object.assign({}, src, { format: 'preflight-run/3', features: ['a-later-feature'], app: '2.1.0', id: 'ro-two', title: 'Later run', ended: null, state: 'running' }));
  await app.fs.write(fpath, text);
  app.click('refresh'); await app.tick(80);
  for (const sub of ['finish', '']) {
    app.click('nav', 'runs'); await app.tick();
    app.typeHash('#/run/release/ro-two' + (sub ? '/' + sub : '')); await app.settle();
    assert.ok(onRun(app) && /Later run/.test(app.html()), sub + ': the run');
    assert.ok(/Read-only in this copy|shows its name only/.test(app.html()), sub + ': says why it is read-only');
    assert.strictEqual(app.hash(), '#/run/release/ro-two', sub + ': the address bar says the run');
  }
  await back(app); await fwd(app);
  assert.ok(onRun(app) && /Later run/.test(app.html()), 'Forward opens it again');
  assert.strictEqual(app.fs.files[fpath].t, text, 'never written');
  assert.deepStrictEqual(app.files('runs/release/ro-two/'), [fpath]);
  numbered(app);
});

rule('Back and Forward (2.0): a skill registered in skill-registrations/ keeps its link when a newer revision arrives, by Back, Forward and a reload', async () => {
  const app = await navBoot();
  const d = await app.PF.repo.loadAll(app.fs), v1 = d.processes.find(p => p.process === 'release').index.all.find(p => p.info.version === 1).info;
  const reg = (rev, version) => JSON.stringify({ format: 'flightdeck-skill/2', app: '2.0.0', id: 'sk-aaaa1111', rev, seen: rev > 1 ? rev - 1 : null, name: 'release-notes', version, location: 'https://example.com/skills/release-notes',
    implements: { process: 'release', folder: v1.folder, mapHash: v1.mapHash, typesHash: v1.typesHash }, description: 'Writes the release notes.', by: 'person-avery', updated: new Date().toISOString() }, null, 2) + '\n';
  const r1 = 'skill-registrations/release-notes/sk-aaaa1111.1.w-avery.json', r2 = 'skill-registrations/release-notes/sk-aaaa1111.2.w-avery.json';
  await app.fs.write(r1, reg(1, '1.0.0'));
  app.click('refresh'); await app.tick(80);
  app.click('nav', 'skills'); await app.tick();
  assert.ok(app.html().indexOf('data-act="open-skill" data-id="' + r1 + '"') >= 0, 'set-up: listed');
  app.click('open-skill', r1); await app.tick();
  const h = '#/skill/' + app.PF.util.hash('skill-registrations/release-notes/');
  assert.strictEqual(app.hash(), h, 'named by its name, not its revision file');
  app.click('nav', 'runs'); await app.tick();
  await app.fs.write(r2, reg(2, '2.0.0'));
  app.click('refresh'); await app.tick(80);
  await back(app);
  assert.strictEqual(app.hash(), h);
  assert.ok(/<div class="eyebrow">Skill/.test(app.html()) && /2\.0\.0/.test(app.html()) && !/isn(&#39;|')t in this folder anymore/.test(app.live()), 'Back opens its current revision: ' + app.live());
  await back(app); await fwd(app);
  assert.ok(/<div class="eyebrow">Skill/.test(app.html()) && /2\.0\.0/.test(app.html()), 'Forward too');
  const again = await navBoot({ localStore: app.store, hash: h, historyState: app.entries()[app.index()].state });
  assert.ok(/<div class="eyebrow">Skill/.test(again.html()) && /2\.0\.0/.test(again.html()), 'and a reload');
  // A legacy registration keeps its file as its key.
  assert.strictEqual(app.PF.nav.skillKey('pr-opener.json'), 'pr-opener.json');
});

rule('Back and Forward (2.0): a phase\'s note typed and not applied holds Back like a step\'s note, keeps the typing, and leaving the box applies it', async () => {
  const app = await navBoot({ localStore: {}, domFocus: true });
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel-phase', 'verify'); await app.tick();
  assert.ok(/id="ob-ph-note"/.test(app.html()), 'set-up: the phase form has its note');
  const list = JSON.stringify(app.entries());
  app.input('ob-ph-note', 'Half a phase note'); await app.tick();
  await back(app);
  assert.ok(/Apply or clear what you typed in the box first \(leaving the box applies it\)/.test(app.live()), app.live());
  assert.ok(/id="ed-h"/.test(app.html()) && JSON.stringify(app.entries()) === list, 'still the editor, entries untouched');
  assert.strictEqual(app.draft('ob-ph-note'), 'Half a phase note'); assert.strictEqual(app.activeId(), 'ob-ph-note');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/Apply or clear what you typed in the box first \(leaving the box applies it\), then Undo/.test(app.live()), 'Undo waits: ' + app.live());
  leave(app, 'ob-ph-note', 'Line one.\nLine two.'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(/\{#verify\}\r?\n  > Line one\.\r?\n  > Line two\.\r?\n/.test(releaseText(app)), 'applied as the phase\'s note: ' + releaseText(app));
  // A value the draft normalizes (a trailing line break) shows as the draft has it, and nothing is left waiting.
  leave(app, 'ob-ph-note', 'Line one.\nLine two.\n'); await app.tick();
  assert.strictEqual(app.draft('ob-ph-note'), 'Line one.\nLine two.', 'the box shows the note as the draft has it');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(!/Apply or clear what you typed/.test(app.live()), 'Undo isn\'t held up: ' + app.live());
  app.click('tl-redo', 'draft'); await app.tick();
  await back(app);
  assert.ok(!/id="ed-h"/.test(app.html()), 'Back goes once it is applied');
});

rule('Back and Forward (2.0): "Start it as a Flightdeck 2.0 run" makes one entry, the new run\'s, also when the person moves meanwhile; Back returns to the old run', async () => {
  for (const moves of [false, true]) {
    const app = await recordingRelease();
    app.click('reopen', '0'); await app.tick(40);
    app.click('edit', 'detail:commit'); app.set('edit-input', 'f00d123'); app.click('save-edit'); await app.tick(40);
    app.click('clear', 'notes'); await app.tick(40);
    const d = await app.PF.repo.loadAll(app.fs), ci = d.processes.find(p => p.process === 'check-in'), md = ci.index.latest.md.replace(/\n## ([^\n]+)\n/, '\n## $1\n  > Use the scratch server.\n');
    const res = await app.PF.repo.publish(app.fs, md, { people: d.people, customTypes: d.stepTypes.types, workflows: {}, by: 'person-avery', changes: '2.0', existing: ci.index.all.map(p => p.info), now: new Date().toISOString(), app: '2.0.0' });
    assert.ok(res && !res.blockers, 'set-up: ' + JSON.stringify(res && res.blockers));
    app.click('refresh'); await app.tick(80);
    const parentKey = app.run().key;
    app.click('select', 'notes'); await app.tick();
    const before = hashes(app), runsBefore = releaseRuns(app);
    assert.strictEqual(app.hash(), '#/run/' + parentKey, 'set-up: on the old run');
    const list = app.fs.list.bind(app.fs), g = gate(); let armed = moves;
    app.fs.list = p => { if (armed && p === 'runs') { armed = false; return list(p).then(x => g.p.then(() => x)); } return list(p); };
    app.click('continue-two', 'notes');
    if (moves) { await app.tick(200); app.click('nav', 'runs'); await app.tick(); app.click('nav', 'settings'); await app.tick(); g.open(); }
    await app.tick(400);
    app.fs.list = list;
    const made = releaseRuns(app).filter(p => runsBefore.indexOf(p) < 0);
    assert.strictEqual(made.length, 1, 'one new run');
    const id = JSON.parse(app.fs.files[made[0]].t).id;
    assert.strictEqual(app.hash(), '#/run/release/' + id, moves + ': the new run');
    assert.deepStrictEqual(hashes(app).slice(0, before.length), before);
    assert.deepStrictEqual(hashes(app).slice(before.length, -1), moves ? ['#/runs', '#/settings'] : [], moves + ': one entry, after any the person made');
    if (moves) { await back(app); await back(app); }
    await back(app);
    assert.ok(onRun(app) && app.hash() === '#/run/' + parentKey, moves + ': Back returns to the old run');
    numbered(app); assert.strictEqual(app.reloads(), 0);
  }
});

/* ---------- checklist details, notes and the Questions section in the builder (1.22.0) ---------- */
const addBox = (app, id, key, value) => { app.set(id, value); app.input(id, value); app.keyOn('Enter', {}, { tagName: 'INPUT', id, value, dataset: { enter: 'ob-meta-add', id: key }, closest: () => null }); };
const leave = (app, id, value) => { app.input(id, value); app.select(id, value); };
const QDRAFT = ['---', 'process: release', 'title: Production release', 'owner: person-casey', 'roles: lead', 'context: ticket', '---', '',
  '## First · READ-DO {#first}', '- [!] {confirm} One @lead ^ticket {#one}', '',
  '## Questions for the owner', '', '- Who signs off?', '- Which window?', ''].join('\n');

rule('Builder: Checklist details adds and removes roles and run details, and sets the owner and backup; Save changes only those lines', async () => {
  const app = await builderOn(), original = releaseText(app);
  assert.ok(/data-act="ob-sel-details" aria-pressed="false"/.test(app.html()) && /Owner Casey Nguyen · backup Avery Lee/.test(app.html()), 'the card, at a glance');
  app.click('ob-sel-details'); await app.tick();
  const html = app.html();
  assert.ok(/<h2 id="ob-form-h">[\s\S]*?Checklist details<\/h2>/.test(html), 'its form');
  assert.ok(/<select id="ob-owner" data-bound><option value="">Nobody yet<\/option>[\s\S]*?<option value="person-casey" selected>/.test(html), 'owner');
  assert.ok(/<select id="ob-backup" data-bound><option value="">No backup<\/option>[\s\S]*?<option value="person-avery" selected>/.test(html), 'backup');
  assert.ok(/data-act="ob-meta-del" data-key="roles" data-id="qa" aria-label="Remove @qa"/.test(html) && /data-act="ob-meta-del" data-key="context" data-id="tag"/.test(html), 'each with Remove');
  addBox(app, 'ob-add-role', 'roles', 'ops'); await app.tick();
  assert.ok(/Added @ops\./.test(app.live()) && app.draft('ob-add-role') === '', 'added, the box emptied: ' + app.live());
  assert.strictEqual(app.focused(), '#ob-add-role');
  addBox(app, 'ob-add-ctx', 'context', 'region'); await app.tick();
  addBox(app, 'ob-add-ctx', 'context', 'two words'); await app.tick();
  assert.ok(/<p class="ferr" id="ferr-ob-add-ctx" role="alert">A run detail is one word/.test(app.html()), 'refused next to its box');
  assert.strictEqual(app.draft('ob-add-ctx'), 'two words', 'the typing stays');
  app.input('ob-add-ctx', ''); await app.tick();
  app.click('ob-meta-del', 'backend', { key: 'roles' }); await app.tick();
  assert.ok(/@backend is still used by the step “Feature flags set in the deploy values”/.test(app.html()), 'a role in use isn\'t removed');
  app.click('ob-meta-del', 'ops', { key: 'roles' }); await app.tick();
  assert.ok(/Removed @ops\./.test(app.live()), app.live());
  app.select('ob-backup', ''); await app.tick();
  app.select('ob-owner', 'person-morgan'); await app.tick();
  assert.ok(/The owner is now Morgan Diaz\./.test(app.live()), app.live());
  assert.strictEqual(app.draft('ob-owner'), 'person-morgan', 'a choice is left as chosen');
  app.click('save-draft'); await app.tick(80);
  assert.deepStrictEqual(lineDelta(original, releaseText(app)), { gone: ['backup: person-avery', 'context: ticket, commit, environment, tag', 'owner: person-casey'], added: ['context: ticket, commit, environment, tag, region', 'owner: person-morgan'] });
});

rule('Builder conditions: one closed "Only when…" line until it is used; a step\'s and a phase\'s conditions round-trip through the text', async () => {
  const app = await builderOn(), original = releaseText(app);
  app.click('ob-sel', 'flags'); await app.tick();
  assert.ok(/<details class="ob-when" data-disc="ob-when:release:flags"><summary>Only when…<\/summary>/.test(app.html()), 'closed, one quiet line');
  assert.ok(!/id="ob-when"[^>]*maxlength/.test(app.html()), 'no length limit below what four conditions can need');
  assert.strictEqual((app.html().match(/Only when/g) || []).length, 1, 'said once');
  leave(app, 'ob-when', '^ticket is set'); await app.tick();
  assert.ok(/Changed when "Feature flags set in the deploy values" applies\. Undo available\./.test(app.live()), app.live());
  assert.ok(/<details class="ob-when" data-disc="ob-when:release:flags" open>/.test(app.html()), 'open while it has one');
  /* The browser reports the open it drew as a toggle: that is remembered for this step only, never for the next one. */
  app.fire('toggle', { target: { dataset: { disc: 'ob-when:release:flags' }, open: true } }); await app.tick();
  app.click('ob-sel', 'rollback'); await app.tick();
  assert.ok(/<details class="ob-when" data-disc="ob-when:release:rollback"><summary>/.test(app.html()), 'another step stays closed');
  app.fire('toggle', { target: { dataset: { disc: 'ob-when:other:rollback' }, open: true } }); await app.tick();
  assert.ok(/<details class="ob-when" data-disc="ob-when:release:rollback"><summary>/.test(app.html()), 'a step with the same ID in another checklist doesn\'t open it');
  app.click('ob-sel', 'flags'); await app.tick();
  leave(app, 'ob-when', 'only when'); await app.tick();
  assert.ok(/Write a condition as/.test(app.html()), 'refused beside the box, never read as no condition');
  leave(app, 'ob-when', '^ticket is set'); await app.tick();
  assert.strictEqual(app.draft('ob-when'), '^ticket is set');
  leave(app, 'ob-when', '^nope is set'); await app.tick();
  assert.ok(/isn&#39;t listed in context/.test(app.html()) && /id="ob-when"[^>]*aria-invalid="true"/.test(app.html()), 'refused beside the box');
  assert.strictEqual(app.draft('ob-when'), '^nope is set', 'what was typed stays in the box');
  leave(app, 'ob-when', '^tag is set'); await app.tick();
  assert.ok(/later one \(sets:\)/.test(app.html()), 'a detail a later step sets is refused, with why');
  leave(app, 'ob-when', '^ticket is set'); await app.tick();
  app.click('ob-sel-phase', 'verify'); await app.tick();
  assert.ok(/<details class="ob-when" data-disc="ob-ph-when:release:verify"><summary>Only when…<\/summary>/.test(app.html()), 'the phase has the same closed line');
  leave(app, 'ob-ph-when', 'only when ^tag is set'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const after = releaseText(app);
  assert.deepStrictEqual(lineDelta(original, after), { gone: [], added: ['  only when ^tag is set', '  only when ^ticket is set'] });
  assert.strictEqual(JSON.stringify(app.PF.map.parse(after).errors.map(e => e.msg)), '[]');
  app.click('ob-sel', 'flags'); await app.tick();
  leave(app, 'ob-when', ''); await app.tick();
  app.click('ob-sel-phase', 'verify'); await app.tick();
  leave(app, 'ob-ph-when', ''); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.strictEqual(releaseText(app), original, 'removing them gives the text back byte for byte');
});

rule('Builder conditions: a condition written another way is shown, read-only, and left to Markdown', async () => {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  const md = app.fs.files['maps/drafts/release.md'].t, odd = md.replace(/(\n- \[[ !~]\] [^\n]*\{#flags\}\n)/, '$1  Only when ^ticket is set\n');
  assert.notStrictEqual(odd, md, 'set-up');
  await app.fs.write('maps/drafts/release.md', odd);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  const h = app.html();
  assert.ok(!/id="ob-when"/.test(h) && /Edit them in Markdown/.test(h) && /<li>\^ticket is set<\/li>/.test(h), 'no box, the text, and where to change it');
  assert.ok(/<details class="ob-when" data-disc="ob-when:release:flags" open>/.test(h), 'open, since it has one');
});

rule('Builder: the step form edits its note; no "in Markdown" is left for roles, run details or notes', async () => {
  const app = await builderOn(), original = releaseText(app);
  app.click('ob-sel', 'flags'); await app.tick();
  assert.ok(/<textarea id="ob-note" rows="3" maxlength="2000">\nNew features ship off\. Turn them on in the environment&#39;s values file, never in code\.<\/textarea>/.test(app.html()), 'the note, in a box');
  assert.ok(!/edit notes in Markdown|Add them to "roles:" in Markdown|lists no run details \("context:"\)/.test(app.html()));
  leave(app, 'ob-note', 'New features ship off.\n\nTurn them on in the values file.'); await app.tick();
  assert.ok(/Changed the note of "Feature flags set in the deploy values"\. Undo available\./.test(app.live()), app.live());
  app.click('save-draft'); await app.tick(80);
  assert.deepStrictEqual(lineDelta(original, releaseText(app)), { gone: ['  > New features ship off. Turn them on in the environment\'s values file, never in code.'], added: ['  >', '  > New features ship off.', '  > Turn them on in the values file.'] });
  /* A step that has no note gets one; a box applied with what the draft already says shows exactly that, and nothing waits. */
  app.click('ob-sel', 'rollback'); await app.tick();
  leave(app, 'ob-note', 'Paste the SHA.'); await app.tick();
  app.input('ob-note', '\n\nPaste the SHA.'); await app.tick();
  app.select('ob-note', '\n\nPaste the SHA.'); await app.tick();
  assert.strictEqual(app.draft('ob-note'), 'Paste the SHA.', 'the box shows the note as the draft has it');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(!/Apply or clear what you typed/.test(app.live()) && /Undid/.test(app.live()), 'Undo isn\'t held up: ' + app.live());
});

rule('Builder: a draft with no roles or run details offers to add them from the step form', async () => {
  const app = await builderOn();
  await app.fs.write('maps/drafts/release.md', ['---', 'process: release', 'title: Production release', '---', '', '## First · READ-DO {#first}', '- [ ] {confirm} One {#one}', ''].join('\n'));
  app.focus(); await app.tick(80);
  app.click('ob-sel', 'one'); await app.tick();
  assert.ok(/The checklist lists no roles yet\.<\/span> <button type="button" class="linkish" data-act="ob-sel-details" data-focus="ob-add-role">Add roles<\/button>/.test(app.html()));
  assert.ok(/data-act="ob-sel-details" data-focus="ob-add-ctx">Add run details<\/button>/.test(app.html()));
  app.click('ob-sel-details', null, { focus: 'ob-add-role' }); await app.tick();
  assert.strictEqual(app.focused(), '#ob-add-role');
  addBox(app, 'ob-add-role', 'roles', 'lead'); await app.tick();
  app.click('ob-sel', 'one'); await app.tick();
  app.click('ob-role', 'lead'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.strictEqual(releaseText(app), ['---', 'process: release', 'title: Production release', 'roles: lead', '---', '', '## First · READ-DO {#first}', '- [ ] {confirm} One @lead {#one}', ''].join('\n'));
});

rule('Builder: the Questions section opens in a panel, its text is edited there, and Remove section asks in the page; Undo brings it back', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md';
  await app.fs.write(path, QDRAFT); app.focus(); await app.tick(80);
  assert.ok(/It still has a Questions section, so it can.t be published yet\./.test(app.html()) && /data-act="ob-sel-questions">Open the Questions<\/button>/.test(app.html()));
  assert.ok(!/Answer the questions in Markdown/.test(app.html()));
  app.click('ob-sel-questions'); await app.tick();
  assert.ok(/<textarea id="ob-q-text" rows="8" maxlength="20000">\n\n- Who signs off\?\n- Which window\?<\/textarea>/.test(app.html()), 'its text, the blank line under the heading kept');
  assert.strictEqual(app.focused(), 'ob-q-text');
  leave(app, 'ob-q-text', '\n- Who signs off? Casey.\n- Which window?'); await app.tick();
  assert.ok(/Changed the Questions section\. Undo available\./.test(app.live()), app.live());
  leave(app, 'ob-q-text', '## Not allowed'); await app.tick();
  assert.ok(/id="ferr-ob-q-text" role="alert">A line starting with ## or ### Track: would end the Questions section/.test(app.html()));
  leave(app, 'ob-q-text', '\n- Who signs off? Casey.\n- Which window?'); await app.tick();
  app.click('ob-ask', 'questions'); await app.tick();
  assert.ok(/Remove the Questions section and everything in it\? Undo brings it back\./.test(app.html()) && /data-act="ob-q-remove" id="ob-ask-go">Remove section<\/button>/.test(app.html()));
  assert.strictEqual(app.focused(), 'ob-ask-go');
  app.key('Escape'); await app.tick();
  assert.ok(!/Remove the Questions section and everything/.test(app.html()) && /id="ob-q-text"/.test(app.html()), 'Escape cancels, the panel stays');
  app.click('ob-ask', 'questions'); await app.tick();
  app.click('ob-ask-cancel'); await app.tick();
  assert.ok(!/Remove the Questions section and everything/.test(app.html()), 'Cancel too');
  app.click('ob-ask', 'questions'); await app.tick();
  app.click('ob-q-remove'); await app.tick();
  assert.ok(/Removed the Questions section\./.test(app.live()) && !/id="ob-q-note"/.test(app.html()), app.live());
  assert.ok(!/It still has a Questions section/.test(app.html()) && !/id="ob-q-text"/.test(app.html()), 'the notice and the panel are gone');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/id="ob-q-note"/.test(app.html()), 'Undo brings it back');
  app.click('tl-redo', 'draft'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  const t = releaseText(app);
  assert.strictEqual(t, QDRAFT.slice(0, QDRAFT.indexOf('## Questions')));
  assert.ok(!app.PF.map.check(app.PF.map.parse(t), {}).blockers.some(b => /Questions/.test(b)), 'nothing about Questions blocks publishing');
});

rule('Builder: typing in the note, Questions or an Add box and not applying it holds Back, Undo and Reverse, and keeps the typing', async () => {
  const app = await navBoot({ localStore: {}, domFocus: true });
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  app.click('ob-sel', 'flags'); await app.tick();
  app.click('ob-mark-step'); app.check('ob-mark-step', true); await app.tick();
  const list = JSON.stringify(app.entries());
  app.input('ob-note', 'Half a note'); await app.tick();
  await back(app);
  assert.ok(/Apply or clear what you typed in the box first \(leaving the box applies it\)/.test(app.live()), app.live());
  assert.ok(/id="ed-h"/.test(app.html()) && JSON.stringify(app.entries()) === list, 'still the editor, entries untouched');
  assert.strictEqual(app.draft('ob-note'), 'Half a note'); assert.strictEqual(app.activeId(), 'ob-note');
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/Apply or clear what you typed in the box first \(leaving the box applies it\), then Undo/.test(app.live()), 'Undo waits: ' + app.live());
  app.input('ob-note', 'New features ship off. Turn them on in the environment\'s values file, never in code.'); await app.tick();
  app.click('ob-sel-details'); await app.tick();
  app.input('ob-add-role', 'half'); await app.tick();
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/Apply or clear what you typed in the box first \(Enter applies it\), then Undo/.test(app.live()), app.live());
  await back(app);
  assert.ok(/id="ed-h"/.test(app.html()) && app.draft('ob-add-role') === 'half', 'Back refused');
  app.input('ob-add-role', ''); await app.tick();
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/Undid/.test(app.live()), app.live());
});

rule('Builder: people, roles and run details from the files are escaped; hostile IDs are never offered; an inactive owner stays chosen', async () => {
  const app = await builderOn();
  const ppl = JSON.parse(app.fs.files['people.json'].t);
  ppl.push({ id: '"><img src=x onerror=alert(1)>', name: '<b>Bad</b>' }, { id: '__proto__', name: 'Proto' }, { id: 'person-ok', name: '<i>Ok</i>' });
  ppl.forEach(p => { if (p.id === 'person-casey') p.inactive = true; });
  await app.fs.write('people.json', JSON.stringify(ppl));
  await app.fs.write('maps/drafts/release.md', ['---', 'process: release', 'title: Production release', 'owner: person-casey', 'backup: person-gone', 'roles: <script>x</script>, lead', 'context: "><svg>', '---', '', '## First · READ-DO {#first}', '- [ ] {confirm} One {#one}', ''].join('\n'));
  app.click('refresh'); await app.tick(80);
  app.click('ob-sel-details'); await app.tick();
  const html = app.html();
  assert.ok(!/<img src=x|<script>x|<svg>|<b>Bad|<i>Ok/.test(html), 'nothing from the files is markup');
  assert.ok(/&lt;script&gt;x&lt;\/script&gt;/.test(html) && /&lt;i&gt;Ok&lt;\/i&gt;/.test(html));
  assert.ok(!/value="&quot;&gt;&lt;img/.test(html) && !/<option value="__proto__"/.test(html), 'hostile IDs aren\'t offered');
  assert.ok(/<option value="person-casey" selected>Casey Nguyen \(inactive\)<\/option>/.test(html), 'the inactive owner stays chosen');
  assert.ok(/<option value="person-gone" selected>person-gone \(not in people\.json\)<\/option>/.test(html), 'and a backup who left the file');
  addBox(app, 'ob-add-ctx', 'context', 'region'); await app.tick();
  app.click('save-draft'); await app.tick(80);
  assert.ok(/owner: person-casey\nbackup: person-gone\n/.test(releaseText(app)), 'kept through an unrelated change');
});

rule('Builder: text a box refused, or hasn\'t applied yet, holds choosing something else in the outline, so it is never dropped', async () => {
  const app = await builderOn();
  await app.fs.write('maps/drafts/release.md', QDRAFT); app.focus(); await app.tick(80);
  app.click('ob-sel-questions'); await app.tick();
  leave(app, 'ob-q-text', 'Keep this\n## Extra heading'); await app.tick();
  assert.ok(/id="ferr-ob-q-text"/.test(app.html()), 'refused');
  app.click('ob-sel-details'); await app.tick();
  assert.ok(/Apply or clear what you typed in the box first \(leaving the box applies it\), then choose another\./.test(app.live()), app.live());
  assert.ok(/id="ob-q-text"/.test(app.html()) && app.draft('ob-q-text') === 'Keep this\n## Extra heading', 'still there');
  assert.strictEqual(app.focused(), '#ob-q-text');
  app.input('ob-q-text', '\n- Who signs off?\n- Which window?'); await app.tick();
  app.click('ob-sel-details'); await app.tick();
  addBox(app, 'ob-add-role', 'roles', 'two words'); await app.tick();
  ['ob-sel', 'ob-sel-phase', 'ob-add-phase', 'ob-add'].forEach(a => { app.click(a, a === 'ob-sel' ? 'one' : 'first'); });
  await app.tick();
  assert.ok(/then choose another/.test(app.live()) && app.draft('ob-add-role') === 'two words' && /Checklist details<\/h2>/.test(app.html()), 'the Add box keeps its text, the form stays');
  app.select('ob-owner', 'person-morgan'); await app.tick();
  assert.ok(/then change anything else\./.test(app.live()) && app.draft('ob-add-role') === 'two words' && /<option value="person-casey" selected>/.test(app.html()), 'another change waits too: ' + app.live());
  app.click('ob-meta-del', 'lead', { key: 'roles' }); await app.tick();
  assert.ok(/then change anything else\./.test(app.live()) && app.draft('ob-add-role') === 'two words' && /data-act="ob-meta-del" data-key="roles" data-id="lead"/.test(app.html()), 'Remove waits too');
  /* A second box applied while the first still holds refused text waits as well, so neither is lost. */
  addBox(app, 'ob-add-ctx', 'context', 'region'); await app.tick();
  assert.ok(/then change anything else\./.test(app.live()) && app.draft('ob-add-role') === 'two words' && app.draft('ob-add-ctx') === 'region', app.live());
  app.click('ob-part', 'step'); await app.tick();
  assert.ok(/then choose another/.test(app.live()) && !/class="ob placing/.test(app.html()) && app.draft('ob-add-role') === 'two words', 'choosing a part waits too');
  /* Clearing the second box leaves the first one protected: Undo and Done wait for it. */
  app.input('ob-add-ctx', ''); await app.tick();
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/Apply or clear what you typed in the box first \(Enter applies it\), then Undo/.test(app.live()) && app.draft('ob-add-role') === 'two words', app.live());
  app.click('ob-done'); await app.tick();
  assert.ok(/Checklist details<\/h2>/.test(app.html()) && app.draft('ob-add-role') === 'two words', 'Done keeps the form open');
  app.input('ob-add-role', ''); await app.tick();
  addBox(app, 'ob-add-ctx', 'context', 'region'); await app.tick();
  assert.ok(/Added \^region\./.test(app.live()), app.live());
  app.click('ob-sel', 'one'); await app.tick();
  assert.ok(/id="ob-note"/.test(app.html()), 'cleared, the step opens');
});

rule('Builder: refused text beside an open Add box holds Undo, and Cancel never lets a newer draft drop it', async () => {
  const app = await builderOn(), path = 'maps/drafts/release.md';
  await app.fs.write(path, QDRAFT); app.focus(); await app.tick(80);
  app.click('ob-sel-details'); await app.tick();
  addBox(app, 'ob-add-role', 'roles', 'ops'); await app.tick();
  assert.ok(/Added @ops\./.test(app.live()), 'set-up: ' + app.live());
  app.click('ob-add-phase', 'first'); await app.tick();
  addBox(app, 'ob-add-role', 'roles', 'two words'); await app.tick();
  assert.ok(/id="ob-new-title"/.test(app.html()) && /id="ferr-ob-add-role"/.test(app.html()), 'set-up: Add phase open, the role refused');
  app.set('ob-new-title', 'Later'); app.input('ob-new-title', 'Later'); await app.tick();
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/then Undo/.test(app.live()) && app.draft('ob-add-role') === 'two words' && /data-id="ops"/.test(app.html()), 'Undo waits: ' + app.live());
  /* Nothing else unsaved: a newer draft would be followed, but not while the refused text is on screen. */
  const two = await builderOn();
  await two.fs.write(path, QDRAFT); two.focus(); await two.tick(80);
  two.click('ob-sel-details'); await two.tick();
  two.click('ob-add-phase', 'first'); await two.tick();
  addBox(two, 'ob-add-role', 'roles', 'two words'); await two.tick();
  await two.fs.write(path, QDRAFT.replace('owner: person-casey', 'owner: person-morgan')); two.focus(); await two.tick(80);
  two.click('ob-add-cancel'); await two.tick(); two.focus(); await two.tick(80);
  assert.ok(two.draft('ob-add-role') === 'two words' && /Checklist details<\/h2>/.test(two.html()), 'the refused text stays');
  assert.ok(/<option value="person-casey" selected>/.test(two.html()), 'the newer draft waits for it');
});

rule('Builder: Done with typing in two boxes applies neither over the other and keeps the form open', async () => {
  const app = await builderOn();
  await app.fs.write('maps/drafts/release.md', QDRAFT); app.focus(); await app.tick(80);
  app.click('ob-sel-details'); await app.tick();
  app.set('ob-add-role', 'qa'); app.input('ob-add-role', 'qa'); app.set('ob-add-ctx', 'region'); app.input('ob-add-ctx', 'region'); await app.tick();
  app.click('ob-done'); await app.tick();
  assert.ok(/Checklist details<\/h2>/.test(app.html()) && app.draft('ob-add-role') === 'qa' && app.draft('ob-add-ctx') === 'region', 'both kept: ' + app.live());
  assert.ok(/Apply or clear what you typed in the box first/.test(app.live()), app.live());
});

/* A release version whose child-run step applies only when ^environment is set, and a run of it Casey records. */
async function conditionalRelease(cond) {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const d = await app.PF.repo.loadAll(app.fs), rel = d.processes.find(p => p.process === 'release');
  const md = rel.index.latest.md.replace('{#notes}\n', '{#notes}\n  only when ' + (cond || '^environment is set') + '\n');
  assert.notStrictEqual(md, rel.index.latest.md, 'set-up: a condition');
  const res = await app.PF.repo.publish(app.fs, md, { people: d.people, customTypes: d.stepTypes.types, workflows: {}, by: 'person-avery', changes: 'Conditions', existing: rel.index.all.map(p => p.info), now: new Date().toISOString(), app: '2.1.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  app.click('refresh'); await app.tick(80);
  const before = releaseRuns(app);
  app.click('start', 'release'); await app.tick();
  app.set('run-title', 'Conditional release'); app.set('detail-ticket', 'T-1'); app.set('detail-commit', 'f00d123'); app.set('detail-environment', 'production');
  app.submitForm('start-form'); await app.tick(120);
  const made = releaseRuns(app).filter(p => before.indexOf(p) < 0);
  assert.strictEqual(made.length, 1, 'set-up: started');
  const r = JSON.parse(app.fs.files[made[0]].t);
  assert.ok(r.features.indexOf('conditions') >= 0 && r.details.environment === 'production', 'set-up: a run of the conditional version');
  app._runPath = made[0];
  app.click('open-run', 'release/' + r.id); await app.tick();
  assert.ok(/data-act="start-step"/.test(app.html()), 'set-up: recording here');
  return app;
}

rule('Conditions (2.1): a child run is never started for a step that isn\'t needed, even when its detail changes while the start waits to be written', async () => {
  const app = await conditionalRelease();
  const children = () => app.files('runs/check-in/').filter(p => /run\.json$/.test(p)).length, before = children();
  const orig = app.PF.repo.saveRun, g = gate(); let held = false;
  app.PF.repo.saveRun = function (fs, run) { const args = arguments; if (!held && run.process === 'release') { held = true; return g.p.then(() => orig.apply(this, args)); } return orig.apply(this, args); };
  // A write already waiting (a follow-up), then Start, then the detail cleared: the start's own write comes after the change.
  app.set('fu-text', 'Check the dashboards'); app.click('add-followup'); await app.tick(5);
  assert.ok(held, 'set-up: the first write waits');
  app.click('start-child', 'notes'); await app.tick(5);
  app.click('edit', 'detail:environment'); app.set('edit-input', ''); app.click('save-edit'); await app.tick(5);
  g.open(); await app.tick(160);
  app.PF.repo.saveRun = orig;
  const j = app.run().json;
  assert.strictEqual(j.details.environment, '', 'set-up: the detail was cleared');
  assert.strictEqual(children(), before, 'no child run written');
  assert.ok(!(j.steps.notes && j.steps.notes.child), 'and nothing linked');
  assert.ok(/isn(&#39;|')t needed in this run/.test(app.html() + (app.live ? app.live() : '')), 'says why');
  app.click('start-child', 'notes'); await app.tick(80);
  assert.strictEqual(children(), before, 'refused straight away once the detail is empty');
  app.click('edit', 'detail:environment'); app.set('edit-input', 'production'); app.click('save-edit'); await app.tick(40);
  app.click('start-child', 'notes'); await app.tick(120);
  assert.strictEqual(children(), before + 1, 'needed again, it starts');
});

rule('Conditions (2.1): a child-run step whose condition tests a carried detail changed A to B to A stays in re-check after Refresh, and a new child replaces the retired link', async () => {
  const app = await conditionalRelease('^commit is set');
  app.click('start-child', 'notes'); await app.tick(120);
  let j = app.run().json, link = j.steps.notes.child;
  assert.ok(link && link.inputs.commit === 'f00d123', 'set-up: a child for commit f00d123');
  const cpath = 'runs/check-in/' + link.id + '/run.json', child = JSON.parse(app.fs.files[cpath].t);
  child.ended = { outcome: 'Completed', by: 'person-avery', at: new Date().toISOString() }; child.state = 'completed'; child.rev = (child.rev || 0) + 1;
  await app.fs.write(cpath, JSON.stringify(child));
  app.click('refresh'); await app.tick(120);
  assert.strictEqual(app.run().json.steps.notes.s, 'done', 'set-up: the child checked the step');
  app.click('edit', 'detail:commit'); app.set('edit-input', 'beef456'); app.click('save-edit'); await app.tick(60);
  app.click('edit', 'detail:commit'); app.set('edit-input', 'f00d123'); app.click('save-edit'); await app.tick(60);
  app.click('refresh'); await app.tick(160);
  j = app.run().json;
  assert.strictEqual(j.steps.notes.s, 'recheck', 'never checked again by the original child');
  assert.ok(j.steps.notes.child.retired && j.steps.notes.child.failed && j.steps.notes.child.id === link.id, 'its link is retired, in the file');
  app.click('start-child', 'notes'); await app.tick(160);
  j = app.run().json;
  assert.ok(j.steps.notes.child.id !== link.id && !j.steps.notes.child.retired, 'a new child replaces it');
  const said = j.log.filter(l => /Replaced/.test(l.what)).pop();
  assert.ok(said && /retired/.test(said.what) && !/didn't complete/.test(said.what), said && said.what);
});

run();
