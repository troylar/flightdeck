// The screens, rendered without a browser: what a run file or a failed save can make them show.
'use strict';
const assert = require('assert');
const { completeRun, loadViews, example, exampleSetup, rule, run } = require('./harness');
const PF = loadViews(), R = PF.run, P = PF.publish, V = PF.views;
const EX = exampleSetup(PF);
const NOW = '2026-10-17T21:00:00.000Z';
const people = JSON.parse(example('people.json'));

function setup(mutateRun, stateExtra) {
  const b = P.build(example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'view0001' });
  const pub = P.verify(b.folder, b.files);
  let r = R.create(pub, { title: 'Release', details: { ticket: 'ABC-1', commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, id: 'run1' });
  if (mutateRun) r = mutateRun(r) || r;
  r._notes = r._notes || []; r._conflicts = r._conflicts || [];
  const state = Object.assign({ view: 'run', me: 'person-casey', sel: null, refOpen: true, pick: null, edit: null, unfold: {}, msg: null, pendingFiles: [], unsaved: {}, saveErr: {}, startMode: {}, archive: {}, keys: true, fs: { kind: 'memory', name: 'x' }, fieldErr: null, showRoles: false, copyView: null }, stateExtra || {});
  const ctx = {
    state, canFolder: true, data: { people, validations: [], processes: [{ process: 'release', pubs: [pub], index: { latest: pub } }], runs: [r], plans: [], drafts: [], skills: [], legacy: [], readAt: NOW },
    now: () => Date.parse(NOW), peopleById: Object.fromEntries(people.map(p => [p.id, p])),
    run: () => r, recording: x => !x.ended && x.recorder.person === state.me && x.recorder.session === 'me',
    attachments: () => [],
    canRecover: x => !x.ended ? x.recorder.person === state.me && x.recorder.session === 'me' : x.recorder.person === state.me,
    processTitle: id => id, processes: () => [], findRun: () => null, latestPub: () => null, suggestRole: () => null, localCopy: () => null,
    img: (src) => '<img src="blob:test">'
  };
  return { r, ctx, state };
}

rule('Run screen: a Jira transition asks for its required fields with hints, filled in from the run where the workflow says', () => {
  const b = P.build(example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'view0002' });
  const r = R.create(P.verify(b.folder, b.files), { title: 'T', details: { ticket: 'ABC-1', commit: 'c0ffee1', environment: 'production' }, roles: { 'release-lead': 'person-casey', qa: 'person-blake', backend: 'person-avery' }, by: 'person-casey', session: 'me', now: NOW, workflows: EX.workflows });
  const { ctx, state } = setup(); ctx.run = () => r; ctx.data.runs = [r];
  state.unfold = { verify: true }; state.pick = { kind: 'record', id: 'close' };
  const html = V.run(ctx);
  assert.ok(/Fix version/.test(html) && /The release name on the board/.test(html), 'field and hint shown');
  assert.ok(/id="rec-jf-deployed-commit-[0-9a-f]{8}"[^>]*value="c0ffee1"/.test(html), 'value from detail:commit filled in');
  assert.ok(/aria-describedby="hint-rec-jf-fix-version-[0-9a-f]{8}"/.test(html), 'hint is tied to its field');
});

rule('Run screen: tracks render side by side, timed steps show a badge and a day timeline, and a paused run hides step actions', () => {
  const { r, ctx, state } = setup();
  state.unfold = { verify: true, deploy: true }; state.timeline = true;
  let html = V.run(ctx);
  assert.ok(/class="tracks"/.test(html) && /Product checks/.test(html) && /Wrap-up/.test(html), 'tracks shown');
  assert.ok(/b-time/.test(html) && /class="timeline"/.test(html) && /Start the production deploy job/.test(html), 'schedule shown');
  assert.ok(/data-act="pick" data-kind="pause"/.test(html), 'recorder can pause');
  R.pause(r, 'Waiting for the change board', 'person-casey', NOW);
  html = V.run(ctx);
  assert.ok(/Paused/.test(html) && /data-act="resume"/.test(html) && /Waiting for the change board/.test(html), 'paused banner with Resume');
  assert.ok(!/data-act="toggle" data-id="[^"]+">/.test(html) && !/data-act="(na|start-step|block)"/.test(html), 'no step can be checked or changed while paused');
});

rule('Run screen: a run-another-process step offers to start the child run, then shows it', () => {
  const { r, ctx, state } = setup();
  const childPub = P.verify.apply(null, (b => [b.folder, b.files])(P.build(example('maps/drafts/check-in.md'), { people, ...EX, by: 'a', changes: 'x', existing: [], now: NOW, rand: 'view0003' })));
  ctx.latestPub = id => id === 'check-in' ? childPub : null;
  let html = V.run(ctx);
  assert.ok(/data-act="start-child" data-id="notes"/.test(html) && /Start the Check in code run/.test(html));
  const child = R.create(childPub, { title: 'Child', details: { commit: r.details.commit }, by: 'person-casey', session: 'me', now: NOW, parent: { process: 'release', id: r.id, step: 'notes' } });
  R.linkChild(r, R.mapOf(r), 'notes', { process: 'check-in', id: child.id }, 'person-casey', NOW);
  ctx.findRun = k => k === 'check-in/' + child.id ? child : null;
  html = V.run(ctx);
  assert.ok(/Child run: <b>Child<\/b>/.test(html) && !/data-act="start-child"/.test(html));
  ctx.run = () => child; ctx.findRun = k => k === 'release/' + r.id ? r : null;
  assert.ok(/Part of <b>/.test(V.run(ctx)), 'the child links back');
});

rule('Screen share stops step timers while paused; the receipt card shows Jira-required evidence; a child for old details offers a new one', () => {
  const { r, ctx, state } = setup();
  const map = R.mapOf(r), started = new Date(Date.parse(NOW) - 30 * 60000).toISOString();
  r.steps.approved = { s: 'open', started: { by: 'person-casey', at: started } };
  R.pause(r, 'Waiting', 'person-casey', new Date(Date.parse(NOW) - 20 * 60000).toISOString());
  state.view = 'mission';
  const m = V.mission(ctx);
  assert.ok(/10:00 · paused/.test(m) && !/data-since/.test(m), 'timer shows active time only');
  R.resume(r, 'person-casey', NOW);
  r.jira = EX.workflows;
  const close = map.phases[2].steps.find(x => x.id === 'close'), key = PF.jira.key('Fix version');
  r.steps.close = { s: 'done', by: 'person-casey', at: NOW, values: { [key]: '2026.10.16' } };
  state.view = 'receipt';
  assert.ok(/Fix version/.test(V.receipt(ctx)) && /2026\.10\.16/.test(V.receipt(ctx)), 'receipt card');
  state.view = 'run';
  r.steps.notes = { s: 'open', child: { process: 'check-in', id: 'old1', inputs: { commit: 'old' } } };
  ctx.latestPub = id => id === 'check-in' ? ctx.data.processes[0].index.latest : null;
  const html = V.run(ctx);
  assert.ok(/no longer counts/.test(html), 'stale child explained');
});

rule('Run screen: a replacement child that was saved but not linked is offered with Link it, even while an older child is linked', () => {
  const { r, ctx } = setup();
  const pub = ctx.data.processes[0].index.latest;
  r.steps.notes = { s: 'open', child: { process: 'check-in', id: 'old1', inputs: { commit: 'old' } } };
  const orphan = { process: 'check-in', id: 'new1', title: 'Check in code for Release', created: NOW, parent: { process: 'release', id: r.id, step: 'notes', inputs: { commit: r.details.commit } } };
  const stale = { process: 'check-in', id: 'older', title: 'Older replaced child', created: '2026-10-01T00:00:00.000Z', parent: { process: 'release', id: r.id, step: 'notes', inputs: { commit: 'other' } } };
  ctx.data.runs = [r, stale, orphan]; ctx.latestPub = () => pub;
  const html = V.run(ctx);
  assert.ok(/data-act="link-child" data-id="notes" data-child="check-in\/new1"/.test(html), 'the current replacement is offered');
  assert.ok(!/Older replaced child/.test(html), 'a child for other details is not');
});

rule('Run screen: a paused run still offers pickup to whoever recording waits for, and Resume only to the recorder', () => {
  const { r, ctx, state } = setup();
  R.pause(r, 'Waiting', 'person-casey', NOW);
  r.recorder.session = null;
  let html = V.run(ctx);
  assert.ok(/Paused/.test(html) && /data-act="pickup"/.test(html) && !/data-act="resume"/.test(html), 'pick up first');
  r.recorder.session = 'me';
  html = V.run(ctx);
  assert.ok(/data-act="resume"/.test(html), 'then Resume');
});

rule('Run screen: a failed child is never offered for linking, and the start button says what it passes on', () => {
  const { r, ctx } = setup();
  const pub = ctx.data.processes[0].index.latest;
  ctx.latestPub = () => pub;
  let html = V.run(ctx);
  assert.ok(/Passes on commit aaa111/.test(html), 'the effective details');
  const parent = { process: 'release', id: r.id, step: 'notes', inputs: { commit: r.details.commit } };
  r.steps.notes = { s: 'blocked', reason: 'x', child: { process: 'check-in', id: 'b', inputs: { commit: r.details.commit }, failed: true } };
  const a = { process: 'check-in', id: 'a', title: 'Child A', created: NOW, details: { commit: r.details.commit }, ended: { outcome: 'Cancelled' }, parent };
  ctx.data.runs = [r, a];
  html = V.run(ctx);
  assert.ok(!/data-act="link-child"/.test(html) && /data-act="start-child"/.test(html), 'a cancelled child: start a new one');
  a.ended = { outcome: 'Completed' }; a.details = { commit: 'changed' };
  assert.ok(!/data-act="link-child"/.test(V.run(ctx)), 'a completed child whose carried commit was changed: not offered');
  a.details = { commit: r.details.commit };
  assert.ok(/data-act="link-child" data-id="notes" data-child="check-in\/a"/.test(V.run(ctx)), 'a completed child with the right commit: offered');
});

rule('Process page: a changed team step type the checklist uses can be republished', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest;
  ctx.processes = () => [{ id: 'release', title: 'Production release', category: 'Releases', latest, all: [], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: '' }, draftChanged: true, typesChanged: ['change.request'] }];
  state.processId = 'release';
  const html = V.process(ctx);
  assert.ok(/Step type change\.request changed since v1; publish to use it/.test(html) && /data-act="publish"/.test(html));
});

rule('Library: unmatched skill registrations are listed with why; prototype-named groups and quoted tags render', () => {
  const { ctx, state } = setup();
  state.view = 'home';
  const proc = { id: 'release', title: 'Production release', category: 'Releases', group: ['constructor', '__proto__'], tags: ['prod"hot'], latest: ctx.data.processes[0].index.latest, all: [], clashes: [], broken: [], draft: null, skills: [], staleSkills: 0 };
  ctx.processes = () => [proc];
  ctx.orphanSkills = () => [{ skill: { name: 'Orphan', process: 'nowhere', implements: 1, steps: null, group: [], tags: [], version: '', location: '' }, errors: [], status: { s: 'missing', text: 'It names the process "nowhere", which isn\'t in this folder.' } }];
  let html = V.processesPage(ctx);
  assert.ok(/constructor/.test(html) && /__proto__/.test(html) && /prod&quot;hot/.test(html), 'groups and tags render');
  html = V.skillsPage(ctx);
  assert.ok(/Orphan/.test(html) && /in this folder/.test(html), 'the unmatched registration is listed');
});

rule('Process page: only the owner is offered the sign-off', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest;
  const runs = [0, 1, 2].map(i => completeRun(PF, R.create(latest, { title: 'R' + i, details: { ticket: 'T', commit: 'c', environment: 'p' }, by: 'person-casey', session: 'me', now: NOW }), NOW));
  ctx.data.runs = runs; ctx.data.validations = [];
  ctx.processes = () => [{ id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: null }];
  state.processId = 'release'; state.me = 'person-blake';
  assert.ok(!/data-kind="signoff"/.test(V.process(ctx)) && /the owner, signs it off/.test(V.process(ctx)));
  state.me = 'person-casey';
  assert.ok(/data-kind="signoff"/.test(V.process(ctx)));
});

rule('Navigation: every section has a page, and the top bar lights the one you\'re in', () => {
  const { ctx, state } = setup();
  ctx.processes = () => [{ id: 'release', title: 'Production release', category: 'Releases', group: ['Engineering'], tags: [], latest: ctx.data.processes[0].index.latest, all: [ctx.data.processes[0].index.latest], clashes: [], broken: [], skills: [], draft: null, staleSkills: 0 }];
  ctx.orphanSkills = () => []; ctx.data.validations = []; ctx.data.stepTypes = { types: {}, errors: [] }; ctx.data.jira = { workflows: {}, errors: [] };
  ctx.releases = { list: [], version: '1.9.1', lastSeen: '1.9.1', fresh: false, newer: null };
  for (const [view, page, h1] of [['home', 'home', /Hi, Casey/], ['runs', 'runs', /Runs/], ['processes', 'processesPage', /Processes/], ['skills', 'skillsPage', /Skills/], ['types', 'types', /Step types/], ['settings', 'settings', /Settings/]]) {
    state.view = view;
    assert.ok(h1.test(V[page](ctx)), view);
    assert.ok(new RegExp('data-id="' + view + '" aria-current="page"').test(V.top(ctx)), view + ' is lit');
  }
  state.view = 'process';
  assert.ok(/data-id="processes" aria-current="page"/.test(V.top(ctx)), 'a process page belongs to Processes');
  state.view = 'home';
  const home = V.home(ctx);
  assert.ok(/Needs you/.test(home) && /you&#39;re recording|you're recording/.test(home) && !/data-act="start-step"/.test(home), 'Home lists what needs you and never opens a run on its own');
});

rule('Run: the top bar keeps the run in view (name, process and version, progress)', () => {
  const { r, ctx, state } = setup();
  ctx.run = () => r; ctx.data.runs = [r]; state.view = 'run';
  ctx.releases = { list: [], version: '1.10.0', lastSeen: '1.10.0', fresh: false, newer: null };
  const top = V.top(ctx);
  assert.ok(/class="runstrip"/.test(top) && top.includes(r.title.replace(/&/g, '&amp;')) && / · v/.test(top) && /\d+\/\d+<\/span>/.test(top));
  state.view = 'home';
  assert.ok(!/class="runstrip"/.test(V.top(ctx)), 'only on a run');
});

rule('Plans: two decisions that disagree are flagged on Runs, on Home and before starting', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest;
  ctx.processes = () => [{ id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: null }];
  ctx.data.plans = [{ id: 'plan-1', process: 'release', title: 'Release next week', by: 'AI assistant', _conflicting: true }];
  assert.ok(/Two decisions on this plan disagree/.test(V.runs(ctx)), 'Runs');
  assert.ok(/Two decisions on it disagree/.test(V.home(ctx)), 'Home');
  state.processId = 'release'; state.planId = 'plan-1';
  assert.ok(/role="alert"><span><b>Two decisions on this plan disagree/.test(V.start(ctx)), 'before starting');
  assert.ok(/data-plan-conflict="1"/.test(V.start(ctx)), 'the form records that the warning was shown');
});

rule('Process page: one page; the checklist shows in place with its Markdown on request, older versions with a way back, Edit checks and previews; a conflict shows both versions', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest;
  const p = { id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: latest.md }, draftChanged: false };
  ctx.processes = () => [p]; ctx.data.validations = []; state.processId = 'release';
  let html = V.process(ctx);
  assert.ok(/id="cl-h"[^>]*>The checklist</.test(html) && !/class="seg tabs"/.test(html) && !/>Map</.test(html), 'no tabs; the checklist is the page');
  assert.ok(/data-act="ptab" data-id="edit"/.test(html) && /data-act="toggle-md"/.test(html), 'Edit and Markdown in place');
  state.showMd = true; html = V.process(ctx);
  assert.ok(/id="map-source"/.test(html) && /process: release/.test(html), 'Markdown on request');
  state.showMd = false;
  const v0 = Object.assign({}, latest, { folder: 'v0-old', info: Object.assign({}, latest.info, { version: 0 }) });
  p.all = [latest, v0]; state.mapVer = 'v0-old'; html = V.process(ctx);
  assert.ok(/an older version/.test(html) && /data-act="back-current"/.test(html) && /data-act="restore-draft" data-id="v0-old"/.test(html) && !/data-act="ptab" data-id="edit"/.test(html), 'an older version has a way back and Restore, not Edit');
  p.all = [latest]; state.mapVer = null;
  state.editor = { pid: 'release', base: latest.md, baseHash: 'x', text: latest.md + '\nmore' };
  assert.ok(/edits in the draft that aren.+t saved/.test(V.process(ctx)) && /Continue editing/.test(V.process(ctx)), 'unsaved edits are mentioned on the page');
  state.editor = null;
  state.ptab = 'edit';
  state.editor = { pid: 'release', base: latest.md, baseHash: 'x', text: latest.md.replace('## Deploy', '## Deploy · NOPE') };
  html = V.process(ctx);
  assert.ok(/id="draft-editor"/.test(html) && /Unsaved changes/.test(html) && /Preview/.test(html));
  state.editor.text = 'not a map';
  assert.ok(/Won.t publish yet/.test(V.process(ctx)), 'live checks');
  state.editor.conflict = { theirs: 'their text', theirsHash: 'y' };
  html = V.process(ctx);
  assert.ok(/Someone else changed this draft/.test(html) && /their text/.test(html) && /data-act="draft-keep-mine"/.test(html));
});

rule('Step types page lists every type; the form checks a new one as you build it', () => {
  const { ctx, state } = setup();
  ctx.processes = () => []; ctx.data.stepTypes = { types: { 'risk.call': PF.types.customType({ id: 'risk.call', label: 'Risk call', record: [{ name: 'call', label: 'Call', kind: 'text' }] }) }, errors: [{ file: 'bad.json', errors: ['"label" must be 1-40 characters'] }] };
  let html = V.types(ctx);
  assert.ok(/Your team.s types · 1/.test(html) && /Built-in types · \d+/.test(html) && /\{jenkins\.job\}/.test(html) && /data-act="edit-type" data-id="risk.call"/.test(html) && /step-types\/bad\.json/.test(html));
  state.typeForm = { def: { id: 'Bad Id', label: '', hint: '', icon: 'check', fields: [], record: [] }, existing: null, baseHash: null };
  html = V.types(ctx);
  assert.ok(/Not ready yet/.test(html) && /id(&quot;)? must be/.test(html) && /type="submit" disabled/.test(html));
  state.typeForm.def = { id: 'risk.level', label: 'Risk level', hint: '', icon: 'check', fields: [{ name: 'level', label: 'Level', kind: 'choice', options: 'Low, High' }], record: [{ name: 'who', label: 'Who', kind: 'text' }] };
  html = V.types(ctx);
  assert.ok(/Ready to save/.test(html) && /options&quot;: \[/.test(html) && /\{risk\.level\} What to do/.test(html));
});

rule('Every built-in type can start a team type that passes the checks', () => {
  PF.types.LIST.forEach(t => {
    const def = V.typeDefOf(Object.assign(V.typeFormOf(t, false), { id: 'team.' + t.id.replace(/\./g, '-'), label: 'Team ' + t.label.slice(0, 30) }));
    const errs = PF.types.checkCustom(def); assert.strictEqual(errs.length, 0, t.id + ': ' + errs.join('; '));
  });
});

rule('Step type form: untouched options round-trip exactly; a named-less row with a label is an error tied to its input', () => {
  const t = PF.types.customType({ id: 'risk.level', label: 'Risk', fields: { level: { label: 'Level', kind: 'choice', options: ['Low\nwith review', ' High '] } } });
  const form = V.typeFormOf(t, true);
  assert.strictEqual(JSON.stringify(V.typeDefOf(form).fields.level.options), JSON.stringify(['Low\nwith review', ' High ']), 'kept exactly');
  form.fields[0].options = 'Low\nHigh';
  assert.strictEqual(JSON.stringify(V.typeDefOf(form).fields.level.options), JSON.stringify(['Low', 'High']), 'an edited list is read one per line');
  const { ctx, state } = setup();
  form.fields.push({ k: 'k999', name: '', label: 'Change system', kind: 'text' });
  state.typeForm = { def: form, existing: 'risk.level', baseHash: null };
  assert.ok(V.typeErrors(form).some(e => /labeled "Change system" has no name/.test(e)), 'an error, not a silent drop');
  const html = V.types(ctx);
  assert.ok(/id="tf-f-k999-name"[^>]*aria-invalid="true" aria-describedby="tf-err-\d+"/.test(html), 'the error points at the name');
  assert.ok(/<li id="tf-err-\d+">/.test(html) && /role="status"/.test(html));
  form.fields.pop();
  form.fields.push({ k: 'k998', name: '', label: '', kind: 'text', options: 'only options' });
  assert.ok(V.typeErrors(form).some(e => /with options has no name/.test(e)), 'options alone count too');
  form.fields.pop();
  form.record.push({ k: 'k997', name: 'verdict', label: 'Verdict', kind: 'choice', options: '' });
  assert.ok(/id="tf-r-k997-options"[^>]*aria-invalid="true"/.test(V.types(ctx)), 'a numbered evidence error points at its options');
  assert.ok(V.typeFormSnapshot(form) !== V.typeFormSnapshot(Object.assign({}, form, { fields: form.fields.concat({ k: 'x', name: '', label: 'half', kind: 'text' }) })), 'a half-filled row is a change');
});

rule('Process page: insights in their own tab; Jira in Settings, step types on their own page', () => {
  const { r, ctx, state } = setup();
  ctx.processes = () => [{ id: 'release', title: 'Production release', category: 'Releases', latest: ctx.data.processes[0].index.latest, all: [], clashes: [], broken: [], skills: [], draft: null }];
  ctx.data.stepTypes = { types: EX.customTypes, errors: [{ file: 'bad.json', errors: ['"label" must be 1-40 characters'] }] };
  ctx.data.jira = { workflows: EX.workflows, errors: [] };
  state.processId = 'release';
  assert.ok(!/How runs go/.test(V.process(ctx)) && !/Team setup/.test(V.process(ctx)), 'the overview stays short');
  state.ptab = 'insights';
  const html = V.process(ctx);
  assert.ok(/How runs go/.test(html) && /Who has done each role/.test(html), 'insights have their own tab');
  ctx.releases = { list: [], version: '1.10.0', lastSeen: '1.10.0', fresh: false, newer: null };
  const set = V.settings(ctx);
  assert.ok(/Release<\/b> · 4 statuses/.test(set) && !/change\.request/.test(set), 'Settings shows Jira, not step types');
  const types = V.types(ctx);
  assert.ok(/change\.request/.test(types) && /step-types\/bad\.json/.test(types), 'team types and their errors are on Step types');
});

/* A process page's checklist panel for a process built around the example release. */
function flightSetup(extra) {
  const { r, ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest;
  const p = Object.assign({ id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: null, draftChanged: false }, extra || {});
  ctx.processes = () => [p, { id: 'check-in', title: 'Developer check-in' }];
  ctx.data.runs = []; state.processId = 'release'; state.flight = true; state.mapVer = null;
  return { r, ctx, state, p, latest };
}
/* A finished run of pub with one step done differently. */
function flightRun(pub, id, step) {
  const H = require('./harness');
  const r = R.create(pub, { title: 'R', details: { ticket: 'ABC-1', commit: 'a1', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, id });
  H.completeRun(PF, r, NOW);
  if (step) R.differently(r, R.mapOf(r), step, 'Did it another way', 'person-casey', NOW);
  return r;
}
const skillOf = (name, steps, implementsV, s, errors) => ({ skill: { name, steps, implements: implementsV, process: 'release' }, status: { s }, errors: errors || [] });

rule('Flight plan: the Checklist | Flight plan switch shows the same version as a vertical route from Start to Landed', () => {
  const { ctx, state, p } = flightSetup();
  let html = V.checklistPanel(ctx, p);
  assert.ok(/data-act="flight" data-id="list" aria-pressed="false">Checklist</.test(html) && /data-act="flight" data-id="plan" aria-pressed="true">Flight plan</.test(html), 'a two-way switch');
  assert.ok(/<ol class="fp" aria-label="Flight plan">/.test(html) && />Start</.test(html) && />Landed</.test(html), 'an ordered route');
  assert.strictEqual((html.match(/data-act="flight-phase"/g) || []).length, 3, 'one button per phase');
  assert.ok(/aria-label="Phase 2 of 3, Deploy, Read-Do, 4 steps, then gate Deployed. Show it in the checklist"/.test(html), 'each phase says where it is and what follows');
  assert.ok(/Phase 1 · Do-Confirm/.test(html) && /6 steps · 4 must-do/.test(html), 'mode, steps and must-dos');
  assert.ok(!/data-act="toggle-md"/.test(html) && !/class="ph"/.test(html), 'the checklist itself is not shown');
  state.flight = false; html = V.checklistPanel(ctx, p);
  assert.ok(/data-act="flight" data-id="list" aria-pressed="true"/.test(html) && /<h3 id="cl-ph-1" tabindex="-1">Deploy/.test(html) && !/class="fp"/.test(html), 'Checklist has an anchor per phase');
});

rule('Flight plan: named gates are checkpoints with owner and what they approve; tracks are lanes; a linked process is a connecting flight', () => {
  const { ctx, p } = flightSetup();
  const html = V.checklistPanel(ctx, p);
  assert.ok(/<div class="fp-gate"><span class="fp-gate-t">/.test(html) && /<span class="sr">Gate: <\/span>Ready to deploy/.test(html), 'a named gate, read as a gate');
  assert.ok(/Owner @release-lead/.test(html) && /Approves deploy of <code>\^commit<\/code> to \^environment/.test(html), 'owner and what it approves');
  assert.ok(/<ul class="fp-lanes" aria-label="Parallel tracks"><li class="fp-lane"><b>Product checks<\/b><span class="small">@qa<\/span><span class="small">2 steps<\/span>/.test(html), 'tracks as lanes');
  assert.ok(/<b>Connecting<\/b> Developer check-in/.test(html), 'a run.process step names the process it starts');
  assert.ok(/fp-gate implicit/.test(html) && /then a check that the phase is done/.test(html), 'a phase without a named gate ends with a plain check');
  assert.ok(!/Autopilot|Turbulence|Typically/.test(html) && /No runs of this version yet\./.test(html), 'no skills, no runs: nothing claimed, and it says why');
});

rule('Flight plan: autopilot only for valid skills built from the version shown; skills behind say so; broken ones claim nothing', () => {
  const { ctx, p, latest } = flightSetup();
  const v = latest.info.version;
  p.skills = [skillOf('release-deploy', ['jenkins', 'approve'], v, 'current'), skillOf('release-notes', null, v, 'current'),
    skillOf('old-deploy', ['merge'], v - 1, 'update'), skillOf('old-notes', ['result'], v - 1, 'unaffected'),
    skillOf('broken-one', ['pods'], v, 'current', ['broken-one.json: needs a "name"']), skillOf('lost-one', ['pods'], v, 'missing')];
  let html = V.checklistPanel(ctx, p);
  assert.ok(/<b>Autopilot<\/b> release-deploy covers 2 steps/.test(html), 'per-phase coverage');
  assert.ok(/<b>Autopilot<\/b> release-notes covers the whole process/.test(html), 'a whole-process skill at the start');
  assert.ok(/fp-stale[^>]*>.*?old-deploy needs an update/.test(html) && /old-notes follows v0/.test(html), 'skills behind the version use the status words');
  assert.ok(!/broken-one|lost-one/.test(html), 'a broken or unmatched registration never claims coverage');
  assert.strictEqual((html.match(/Autopilot/g) || []).length, 2);
  const older = Object.assign({}, latest, { folder: 'v0-old', info: Object.assign({}, latest.info, { version: v - 1, folder: 'v0-old' }) });
  p.all = [latest, older]; ctx.state.mapVer = 'v0-old';
  html = V.checklistPanel(ctx, p);
  assert.ok(/<b>Autopilot<\/b> old-deploy covers 1 step/.test(html) && !/release-deploy|needs an update|follows v/.test(html), 'an older version: only the skills built from it');
  p.draft = { file: 'release.md', md: latest.md }; p.draftChanged = true; ctx.state.mapVer = null;
  html = V.checklistPanel(ctx, p);
  assert.ok(/The draft/.test(html) && !/Autopilot|needs an update|follows v/.test(html), 'a draft: no skill is built from it');
});

rule('Flight plan: times and turbulence come only from runs of the version shown, each phase keeps its own top deviation, and the footnote names the version', () => {
  const { ctx, p, latest } = flightSetup();
  const older = Object.assign({}, latest, { folder: 'v0-old', info: Object.assign({}, latest.info, { version: 0, folder: 'v0-old' }) });
  const mine = ['fp1', 'fp2', 'fp3'].map(id => flightRun(latest, id)), theirs = flightRun(older, 'fp0', 'merge');
  // Ten steps in the first two phases go off-script more than any step in the third, so a global top ten would hide it.
  mine.forEach(r => { const m = R.mapOf(r); ['approved', 'tests', 'flags', 'rollback', 'notes', 'announce', 'merge', 'jenkins', 'approve', 'pods'].forEach(id => R.differently(r, m, id, 'again', 'person-casey', NOW)); });
  R.differently(mine[0], R.mapOf(mine[0]), 'smoke', 'x', 'person-casey', NOW);
  assert.ok(R.analytics(mine, 'release').steps.every(c => c.id !== 'smoke'), 'set-up: the third phase is outside the top ten');
  ctx.data.runs = mine.concat(theirs);
  let html = V.checklistPanel(ctx, p);
  assert.ok(/Typically under a minute/.test(html) && /From 3 runs of v1; paused time isn.t counted\./.test(html), 'numbers say which version they come from');
  assert.strictEqual((html.match(/<b>Turbulence<\/b>/g) || []).length, 3, 'every phase with deviations keeps its own, past the global top ten');
  assert.ok(/off-script 3 times/.test(html) && !/off-script 4 times/.test(html), 'the older run\'s deviation is not added');
  p.draft = { file: 'release.md', md: latest.md.replace('Approve the deploy in Jenkins', 'Approve it') }; p.draftChanged = true;
  html = V.checklistPanel(ctx, p);
  assert.ok(!/Typically|Turbulence/.test(html) && /No runs of this version yet\./.test(html), 'a draft shows no history');
  p.draft = null; p.draftChanged = false; ctx.data.runs = [theirs];
  html = V.checklistPanel(ctx, p);
  assert.ok(!/Typically|Turbulence/.test(html) && /No runs of this version yet\./.test(html), 'only another version has runs: none shown');
});

rule('Flight plan: two phases with the same title show their own typical times', () => {
  const md = ['---', 'process: rv', 'title: RV', 'owner: person-avery', '---', '', '## Review · READ-DO {#r1}', '- [ ] {confirm} A {#a}', '', '## Review · READ-DO {#r2}', '- [ ] {confirm} B {#b}'].join('\n');
  const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'rv000001' }), pub = P.verify(b.folder, b.files);
  const t0 = Date.parse(NOW), at = m => new Date(t0 + m * 60000).toISOString();
  const r = R.create(pub, { title: 'R', details: {}, roles: {}, by: 'person-casey', session: 'me', now: NOW, id: 'rv1' }), map = R.mapOf(r);
  R.done(r, map, 'a', 'person-casey', at(1)); R.pass(r, map, 0, 'person-casey', at(5));
  R.done(r, map, 'b', 'person-casey', at(10)); R.pass(r, map, 1, 'person-casey', at(65));
  const { ctx, p } = flightSetup({ id: 'rv', title: 'RV', latest: pub, all: [pub] });
  ctx.data.runs = [r];
  const html = V.checklistPanel(ctx, p);
  assert.ok(/Typically 5 min/.test(html) && /Typically 1 h</.test(html) && !/Typically 33 min/.test(html), 'not pooled by title');
});

rule('Flight plan: titles from the checklist are escaped, long unbroken names can wrap, and a draft with no phases says how to start one', () => {
  const long = 'x'.repeat(80);
  const md = ['---', 'process: odd', 'title: ' + long, 'owner: person-avery', 'roles: a', 'context: ' + long, '---', '', '## <img src=x onerror=alert(1)>' + long + ' · READ-DO {#one}', '### Track: <b>lane</b>' + long + ' @a {#t}', '- [ ] {confirm} Step <i>x</i> {#s1}', '', '## Gate: <script>bad()</script>' + long + ' · owner @a {#g}', '  approves: <u>it</u>'].join('\n');
  const { ctx, p } = flightSetup({ id: 'odd', title: long, latest: null, all: [], draft: { file: 'odd.md', md }, draftChanged: true });
  let html = V.checklistPanel(ctx, p);
  assert.ok(!/<img|<script|<b>lane|<u>it/.test(html), 'nothing from the file is raw HTML');
  assert.ok(/&lt;img src=x onerror=alert\(1\)&gt;/.test(html) && /&lt;script&gt;bad\(\)&lt;\/script&gt;/.test(html) && /&lt;b&gt;lane&lt;\/b&gt;/.test(html), 'shown as text');
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'page.html'), 'utf8');
  ['.mapview .fp > li {', '.fp-name {', '.fp-go {', '.fp-gate {', '.mapview .fp-lane {'].forEach(sel => {
    const rule = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    assert.ok(/overflow-wrap: anywhere/.test(rule), sel + ' lets a long unbroken name wrap');
  });
  p.draft.md = ['---', 'process: odd', 'title: Odd', '---', ''].join('\n');
  html = V.checklistPanel(ctx, p);
  assert.ok(/Add a phase to see the flight plan\./.test(html) && !/class="fp"/.test(html));
});

rule('P1: a javascript: link written into a run file is never rendered as a link, anywhere', () => {
  const { ctx, state } = setup(r => {
    const raw = JSON.parse(JSON.stringify(r));
    raw.steps.merge = { s: 'done', by: 'person-casey', at: NOW, values: { pr: 'javascript:alert(1)', mergeCommit: 'abc' } };
    raw.steps.tests = { s: 'done', by: 'person-casey', at: NOW, values: { runLink: ' JAVASCRIPT:alert(2)', run: '1' } };
    raw.fields = { jenkins: { page: 'javascript:alert(3)' } };
    return R.sanitize(raw);
  });
  state.unfold = { prep: true, deploy: true, verify: true };
  for (const view of ['run', 'receipt']) {
    state.view = view;
    const html = V[view](ctx);
    assert.ok(!/href="\s*javascript:/i.test(html), view + ' rendered a javascript: link');
  }
});

rule('P1: a change that failed to save stays visible with Try again, even after ending the run or handing it off', () => {
  for (const change of ['end', 'handoff']) {
    const { r, ctx, state } = setup();
    const map = R.mapOf(r);
    if (change === 'end') R.end(r, map, 'Cancelled', 'person-casey', 'Casey', NOW); else R.handOff(r, 'person-blake', 'person-casey', NOW);
    state.unsaved[r.id] = r; state.saveErr[r.id] = 'The folder is offline.';
    for (const view of ['run', 'receipt', 'finish', 'mission']) {
      state.view = view;
      const html = V[view](ctx);
      assert.ok(/data-act="retry-save"/.test(html) && /isn't saved/.test(html), change + ' / ' + view + ' hides the failed save');
    }
  }
});

rule('Notes with odd shapes from a file render without breaking the screen', () => {
  const { ctx, state } = setup(r => { r._notes = [{ id: 'n1', at: NOW, by: 'x', step: 'approved', text: '<img src=x onerror=alert(1)>', files: [] }]; });
  state.sel = 'approved';
  const html = V.run(ctx);
  assert.ok(!/<img src=x/.test(html), 'note text is escaped');
});

rule('Errors are tied to their field for screen readers', () => {
  const { ctx, state } = setup();
  state.pick = { kind: 'record', id: 'tests' }; state.fieldErr = { id: 'tests', msg: 'Run number is needed to check this step.' };
  const r = ctx.run(); r.steps = {}; r.fields = {};
  const mapText = r.snapshot.replace('  pipeline: web-app gate', '  pipeline: web-app gate\n  require: run');
  r.snapshot = mapText;
  const html = V.run(ctx);
  assert.ok(/id="ferr-tests" role="alert"/.test(html));
  assert.ok(/aria-invalid="true" aria-describedby="ferr-tests"/.test(html));
});

rule('R2: an error from core points at the one field it\'s about', () => {
  const { ctx, state } = setup();
  const r = ctx.run(); r.snapshot = r.snapshot.replace('  pipeline: web-app gate', '  pipeline: web-app gate\n  require: run');
  state.pick = { kind: 'fields', id: 'tests' }; state.fieldErr = { id: 'tests', msg: 'Run number is required…', field: 'rec-run' };
  const html = V.run(ctx);
  assert.ok(/id="rec-run" aria-invalid="true"/.test(html));
  assert.ok(!/id="rec-runLink" aria-invalid/.test(html), 'other fields are not marked');
});

rule('R2: an ended run with a conflict copy can still be resolved by whoever recorded or ended it', () => {
  const { r, ctx, state } = setup();
  R.end(r, R.mapOf(r), 'Cancelled', 'person-casey', 'Casey', NOW);
  r._conflicts = ['run-PC (1).json'];
  assert.ok(/data-act="use-copy"/.test(V.run(ctx)), 'the person who ended it can keep a copy');
  state.me = 'person-blake';
  const other = V.run(ctx);
  assert.ok(!/data-act="use-copy"/.test(other) && /data-act="compare-copy"/.test(other), 'others can compare only');
});

rule('R3: every editable area carries its own scope, so typed text can\'t move to another field, step or run', () => {
  const { ctx, state } = setup();
  state.edit = 'detail:commit';
  assert.ok(/class="inline-edit" data-scope="edit:detail:commit"/.test(V.run(ctx)));
  state.edit = 'detail:environment';
  assert.ok(/data-scope="edit:detail:environment"/.test(V.run(ctx)));
  state.edit = null; state.sel = 'approved';
  assert.ok(/class="ref" data-scope="ref:approved"/.test(V.run(ctx)));
  state.pick = { kind: 'block', id: 'approved' };
  assert.ok(/data-scope="block:approved"/.test(V.run(ctx)));
});

run();
