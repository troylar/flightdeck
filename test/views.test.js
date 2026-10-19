// The screens, rendered without a browser: what a run file or a failed save can make them show.
'use strict';
const assert = require('assert');
const { completeRun, loadViews, example, exampleSetup, rule, run, sampleDone } = require('./harness');
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
  state.unfold = { verify: true }; state.pick = { kind: 'fields', id: 'close' };
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
  state.sel = 'notes';
  let html = V.run(ctx);
  assert.ok(/data-act="start-child" data-id="notes"/.test(html) && /Start the Check in code run/.test(html));
  assert.ok(/data-act="toggle" data-id="notes" disabled title="Checked when its linked run completes"/.test(html) && !/data-act="toggle" data-id="notes">/.test(html), 'no ordinary Done: completion comes from the child');
  const child = R.create(childPub, { title: 'Child', details: { commit: r.details.commit }, by: 'person-casey', session: 'me', now: NOW, parent: { process: 'release', id: r.id, step: 'notes' } });
  R.linkChild(r, R.mapOf(r), 'notes', { process: 'check-in', id: child.id }, 'person-casey', NOW);
  ctx.findRun = k => k === 'check-in/' + child.id ? child : null;
  html = V.run(ctx);
  assert.ok(/Child run: <b>Child<\/b>/.test(html) && !/data-act="start-child"/.test(html));
  ctx.run = () => child; ctx.findRun = k => k === 'release/' + r.id ? r : null;
  assert.ok(/part of <button class="linkish" data-act="open-run" data-id="release\/run1">Release<\/button>/.test(V.run(ctx)), 'the child links back from its header');
  state.runDetails = true;
  assert.ok(/Part of <b>Release<\/b>\. When this run ends, that run's step is checked/.test(V.run(ctx)), 'and Details explains how');
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
  state.view = 'run'; state.sel = 'notes';
  r.steps.notes = { s: 'open', child: { process: 'check-in', id: 'old1', inputs: { commit: 'old' } } };
  ctx.latestPub = id => id === 'check-in' ? ctx.data.processes[0].index.latest : null;
  const html = V.run(ctx);
  assert.ok(/no longer counts/.test(html), 'stale child explained');
});

rule('Run screen: a replacement child that was saved but not linked is offered with Link it, even while an older child is linked', () => {
  const { r, ctx } = setup(null, { sel: 'notes' });
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
  const { r, ctx } = setup(null, { sel: 'notes' });
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

rule('Plans: Runs lists them soonest first with the time in words and who planned them; Home shows the ones due within a day', () => {
  const { ctx } = setup();
  const latest = ctx.data.processes[0].index.latest, at = h => new Date(Date.parse(NOW) + h * 3600000).toISOString();
  ctx.processes = () => [{ id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: null }];
  ctx.data.plans = [
    { id: 'p-later', process: 'release', title: 'In three days', when: at(72), by: 'person-blake', created: at(-5) },
    { id: 'p-none', process: 'release', title: 'No time yet', by: 'AI assistant', created: at(-9) },
    { id: 'p-late', process: 'release', title: 'Overdue <b>one</b>', when: at(-24), by: 'person-casey', created: at(-30) },
    { id: 'p-soon', process: 'release', title: 'Later today', when: at(2), by: 'person-casey', created: at(-1) },
    { id: 'p-bad', process: 'release', title: 'Bad time', when: 'next week', by: 'person-casey', created: at(-8) }
  ];
  const runs = V.runs(ctx), order = ['p-late', 'p-soon', 'p-later', 'p-none', 'p-bad'].map(id => runs.indexOf('data-id="' + id + '"'));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'soonest first, then those without a usable time, oldest first: ' + order);
  assert.ok(/was due yesterday/.test(runs) && /in 2 hours/.test(runs) && /in 3 days/.test(runs), 'times in words');
  assert.ok(/planned by Blake/.test(runs), 'who planned it, by name');
  assert.ok(!/<b>one<\/b>/.test(runs), 'titles are escaped');
  const home = V.home(ctx);
  assert.ok(/Overdue &lt;b&gt;one&lt;\/b&gt; is planned for [^<]*was due yesterday/.test(home), 'past due: on Home');
  assert.ok(/Later today is planned for [^<]*in 2 hours/.test(home), 'due within a day: on Home');
  assert.ok(!/In three days/.test(home), 'not due yet: only under Runs');
  assert.ok(/planned &quot;No time yet&quot;|planned "No time yet"/.test(home), 'no time: Home as before');
  assert.strictEqual((home.match(/>Review and start</g) || []).length, 2, 'one Start for each due plan');
});

rule('Plans: a plan made for an older version starts on it, with the differences and a one-click switch; plan mode saves instead', () => {
  const { ctx, state } = setup();
  const b2 = P.build(example('maps/drafts/release.md').replace('## ', '## Added in v2 {#added}\n- [ ] {confirm} A new step {#new-one}\n\n## Gate: New gate {#g-new}\n\n## '), { people, ...EX, by: 'person-avery', changes: 'Second', existing: [{ version: 1 }], now: NOW, rand: 'view0002' });
  assert.ok(!b2.blockers, JSON.stringify(b2.blockers));
  const v1 = ctx.data.processes[0].index.latest, v2 = P.verify(b2.folder, b2.files);
  const proc = { id: 'release', title: 'Production release', category: 'Releases', latest: v2, all: [v2, v1], clashes: [], broken: [], skills: [], draft: null };
  ctx.processes = () => [proc]; ctx.suggestRole = () => null;
  ctx.data.plans = [{ id: 'plan-1', process: 'release', version: 1, title: 'Planned', details: { ticket: 'ABC-9' }, roles: {}, by: 'person-blake', _hash: 'h1' }];
  state.view = 'start'; state.processId = 'release'; state.planId = 'plan-1';
  let html = V.start(ctx);
  assert.ok(/This plan was made for v1\. v2 is now published\./.test(html), 'says which version and what is newer');
  assert.ok(/data-act="plan-diff"[^>]*>See what changed/.test(html) && /data-act="plan-latest" data-id="plan-1">Switch to v2/.test(html));
  assert.ok(html.includes('data-folder="' + v1.info.folder + '"'), 'the form starts v1 until switched');
  state.planDiff = true;
  assert.ok(/class="diff"[\s\S]*Added in v2/.test(V.start(ctx)), 'the differences, from the published files');
  state.planPick = { key: ctx.fsKey, plan: 'plan-1', hash: 'h1', folder: v2.info.folder };
  html = V.start(ctx);
  assert.ok(html.includes('data-folder="' + v2.info.folder + '"') && /Switched to v2/.test(html) && !/data-act="plan-latest"/.test(html));
  state.planPick.hash = 'changed';
  assert.ok(/This plan was made for v1/.test(V.start(ctx)), 'a switch made on an earlier version of the plan doesn\'t carry over');
  proc.all = [v2]; state.planPick = null;
  html = V.start(ctx);
  assert.ok(/made for v1, which can't be used anymore\. It starts on v2/.test(html.replace(/&#39;/g, "'")) && html.includes('data-folder="' + v2.info.folder + '"'), 'a removed version falls back to the latest, and says so');
  // Plan mode: the same form, with a time and a note, saving instead of starting.
  state.planId = null; state.planning = { process: 'release', from: 'release/run1', title: 'Release', details: { ticket: 'ABC-7' }, roles: { qa: 'person-morgan' } };
  html = V.start(ctx);
  assert.ok(/<h1>Plan a run<\/h1>/.test(html) && /id="plan-form"/.test(html) && !/id="start-form"/.test(html));
  assert.ok(/<label class="field" for="plan-when">When \(optional\)<input type="datetime-local" id="plan-when"/.test(html), 'a labeled date and time');
  assert.ok(/<label class="field" for="plan-note">/.test(html) && />Save the plan</.test(html) && !/Start the run/.test(html));
  assert.ok(/id="detail-ticket"[^>]*value="ABC-7"/.test(html) && !/id="detail-tag"/.test(html), 'prefilled; a detail a step sets is not asked for');
  state.fieldErr = { id: 'plan-when', msg: 'Enter a date and time, or leave it blank.' };
  assert.ok(/id="plan-when" value="" aria-invalid="true" aria-describedby="ferr-plan-when"/.test(V.start(ctx)) && /id="ferr-plan-when" role="alert"/.test(V.start(ctx)), 'the error is next to its field');
});

rule('Runs: a run and its receipt offer to plan another like it once its process is published', () => {
  const { ctx, state, r } = setup();
  assert.ok(!/plan-from-run/.test(V.run(ctx)), 'no published process: no offer');
  ctx.processes = () => [{ id: 'release', latest: ctx.data.processes[0].index.latest }];
  assert.ok(V.run(ctx).includes('data-act="plan-from-run" data-id="release/' + r.id + '">Plan another like this'));
  state.view = 'receipt';
  assert.ok(/data-act="plan-from-run"/.test(V.receipt(ctx)));
  state.me = '';
  assert.ok(!/plan-from-run/.test(V.run(ctx)), 'only for someone who has chosen who they are');
});

rule('Process page: one page; the checklist shows in place with its Markdown on request, older versions with a way back, Edit checks and previews; a conflict shows both versions', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest;
  const p = { id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: latest.md }, draftChanged: false };
  ctx.processes = () => [p]; ctx.data.validations = []; state.processId = 'release';
  let html = V.process(ctx);
  assert.ok(/id="cl-h"[^>]*>The checklist</.test(html) && !/class="seg tabs"/.test(html) && !/>Map</.test(html), 'no tabs; the checklist is the page');
  assert.ok(/data-act="ptab" data-id="edit"/.test(html) && /data-act="flight" data-id="md" aria-pressed="false">Markdown</.test(html), 'Edit, and Markdown as one of the views');
  state.clView = 'md'; html = V.process(ctx);
  assert.ok(/id="map-source"/.test(html) && /process: release/.test(html) && /data-act="copy-map"/.test(html), 'Markdown on request, with Copy');
  state.clView = 'list';
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
  assert.ok(/class="ob" id="ob"/.test(html) && !/id="draft-editor"/.test(html) && /Unsaved changes/.test(html) && /Preview/.test(html), 'the builder by default');
  state.builder = false; html = V.process(ctx);
  assert.ok(/id="draft-editor"/.test(html) && /Unsaved changes/.test(html) && /Preview/.test(html) && /Changed lines · 1 new or changed, 1 removed/.test(html), 'Markdown on request, with the lines changed');
  state.editor.text = 'not a map';
  assert.ok(/Won.t publish yet/.test(V.process(ctx)), 'live checks');
  state.editor.conflict = { theirs: 'their text', theirsHash: 'y' };
  html = V.process(ctx);
  assert.ok(/Someone else changed this draft/.test(html) && /their text/.test(html) && /data-act="draft-keep-mine"/.test(html));
});

rule('Draft builder: phases as cards, steps as draggable rows, gates as striped bars, and a side form for what\'s selected', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest;
  const p = { id: 'release', title: 'Production release', latest, all: [latest], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: latest.md }, draftChanged: false };
  ctx.processes = () => [p]; ctx.data.validations = []; state.processId = 'release'; state.ptab = 'edit';
  state.editor = { pid: 'release', base: latest.md, baseHash: 'x', text: null };
  let html = V.process(ctx);
  assert.ok(/data-act="ed-mode" data-id="builder" aria-pressed="true"/.test(html) && /data-act="ed-mode" data-id="markdown" aria-pressed="false"/.test(html), 'a Builder | Markdown switch');
  assert.ok(/Phase 1<\/div>/.test(html) && /data-ob-phase="prep"/.test(html) && /<span class="cat">DO-CONFIRM<\/span>/.test(html), 'phase cards');
  assert.ok(/<li class="ob-step" draggable="true" data-ob-step="approved">/.test(html) && /b-must/.test(html) && /<span class="ob-chip">\^commit<\/span>/.test(html), 'rows with must-do and run detail chips');
  assert.ok(/class="fp-gate ob-gate"[^>]*><div class="ob-gate-copy"><span class="fp-gate-t">.*Gate: Ready to deploy/.test(html), 'a named gate is a striped bar');
  assert.ok(/class="fp-gate implicit ob-gate"/.test(html) && /aria-label="Add a gate to Verify in production"/.test(html), 'a phase without one offers to add it');
  assert.ok(/<li class="ob-slot" aria-hidden="true" data-ob-place="before:approved" data-for="step" data-say="first, inside Before production changes" data-ob-drop="before:approved"><span>Cleared to land here · or move with Alt\+Up \/ Alt\+Down<\/span><\/li>/.test(html), 'landing slots');
  assert.ok(/data-act="ob-add" data-id="verify" data-track="1">.*Add a step to Wrap-up/.test(html), 'add a step to a track');
  assert.ok(/aria-describedby="ob-kbd"/.test(html) && /id="ob-kbd"/.test(html), 'the keyboard way is described');
  assert.ok(!/class="panel stack ob-form"/.test(html), 'no side form until something is selected');
  state.obSel = { pid: 'release', kind: 'step', key: 'flags' }; html = V.process(ctx);
  assert.ok(/<li class="ob-step sel"[^>]*data-ob-step="flags">/.test(html) && /aria-pressed="true" aria-describedby="ob-kbd"/.test(html), 'the selected row');
  assert.ok(/<textarea id="ob-text" rows="2" maxlength="200" data-enter="ob-commit">Feature flags set in the deploy values<\/textarea>/.test(html), 'its text, without @role or ^detail');
  assert.ok(/<input type="radio" name="ob-mark" id="ob-mark-must" value="must" data-bound checked><span><b>Must do<\/b>/.test(html) && /id="ob-mark-planned" value="planned" data-bound><span>/.test(html) && /<option value="confirm" selected>Confirm</.test(html), 'the kind as one choice of three, and the type');
  assert.ok(/data-act="ob-role" data-id="backend" aria-pressed="true"/.test(html) && /data-act="ob-role" data-id="qa" aria-pressed="false"/.test(html), 'roles from the checklist');
  assert.ok(/class="ob-chip" data-act="ob-bind" data-id="environment" aria-pressed="true"/.test(html) && /data-id="commit" aria-pressed="false"/.test(html), 'run details as amber chips');
  assert.ok(/for="ob-fld-where">Where to check/.test(html) && /for="ob-fld-looks">True when/.test(html), 'the fields its type asks for');
  assert.ok(/ID <code>flags<\/code>/.test(html) && /data-act="ob-move" data-id="flags" data-dir="up"/.test(html) && /data-act="ob-del"/.test(html), 'its ID, and buttons to move and delete');
  state.obSel = { pid: 'release', kind: 'phase', key: 'prep' }; html = V.process(ctx);
  assert.ok(/<input id="ob-ph-title"[^>]*value="Before production changes">/.test(html) && /<option value="DO-CONFIRM" selected>/.test(html), 'a phase\'s name and mode');
  assert.ok(/<input id="ob-g-title"[^>]*value="Ready to deploy">/.test(html) && /<option value="release-lead" selected>@release-lead/.test(html) && /id="ob-g-approves"[^>]*value="deploy of `\^commit` to \^environment"/.test(html), 'its gate');
  state.obAdd = { pid: 'release', kind: 'step', phase: 'deploy', track: -1 }; html = V.process(ctx);
  assert.ok(/<label class="sr" for="ob-new-text">New step: what to do<\/label><input id="ob-new-text"[^>]*data-enter="ob-add-go">/.test(html), 'an add-a-step box in place');
  state.builder = false; html = V.process(ctx);
  assert.ok(/id="draft-editor"/.test(html) && !/id="ob"/.test(html) && !/ob-form/.test(html) && !/Changed lines/.test(html), 'Markdown mode is the textarea, with no changes to list');
});

rule('Draft builder: everything from the draft is escaped, and a draft it can\'t read safely sends you to Markdown', () => {
  const { ctx, state } = setup();
  const md = ['---', 'process: x', 'title: X', 'roles: lead', 'context: commit', '---', '## <img src=x onerror=alert(1)> · READ-DO {#one}', '### Track: <u>lane</u> @lead {#lane}',
    '- [ ] {confirm} "><script>alert(1)</script> ^commit {#s1}', '  where: <b>here</b>', '## Gate: <i>gate</i> · owner @lead {#g}', '  approves: <svg onload=alert(1)>', '## Two {#two}', '- [ ] {<x>} Unknown {#s2}', ''].join('\n');
  const p = { id: 'x', title: 'X', latest: null, all: [], clashes: [], broken: [], skills: [], draft: { file: 'x.md', md }, draftChanged: true };
  ctx.processes = () => [p]; ctx.data.validations = []; state.processId = 'x'; state.ptab = 'edit';
  state.editor = { pid: 'x', base: md, baseHash: 'x', text: null };
  const pages = [];
  pages.push(V.process(ctx));
  state.obSel = { pid: 'x', kind: 'step', key: 's1' }; pages.push(V.process(ctx));
  state.obSel = { pid: 'x', kind: 'phase', key: 'one' }; pages.push(V.process(ctx));
  pages.forEach((html, i) => {
    assert.ok(!/<script|<img src=x|<svg onload|<u>lane|<b>here|<i>gate/.test(html), 'page ' + i + ' has nothing raw');
  });
  assert.ok(/&lt;script&gt;/.test(pages[1]) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(pages[2]) && /value="&lt;b&gt;here&lt;\/b&gt;"/.test(pages[1]));
  state.editor = { pid: 'x', base: md.replace(/\n/g, '\r'), baseHash: 'x', text: null };
  const odd = V.process(ctx);
  assert.ok(/can.t edit this draft safely/.test(odd) && /data-act="ed-mode" data-id="markdown">Markdown/.test(odd), 'old Mac line endings: use Markdown');
});

rule('Every editor shows Undo (naming what it undoes), Redo and History, with the same names and keys', () => {
  const { ctx, state } = setup(), TL = PF.timeline;
  const md = ['---', 'process: x', 'title: X', '---', '## One · READ-DO {#one}', '- [ ] {confirm} <b>Smoke</b> tests {#smoke}', '- [ ] {confirm} Two {#two}', ''].join('\n');
  const p = { id: 'x', title: 'X', latest: null, all: [], clashes: [], broken: [], skills: [], draft: { file: 'x.md', md }, draftChanged: true };
  ctx.processes = () => [p]; state.view = 'process'; state.processId = 'x'; state.ptab = 'edit';
  const tl = TL.create(), moved = md.replace('- [ ] {confirm} Two {#two}\n', '').replace('## One · READ-DO {#one}\n', '## One · READ-DO {#one}\n- [ ] {confirm} Two {#two}\n');
  TL.record(tl, md, moved, { kind: 'op', label: 'move', subject: '<b>Smoke</b> tests' });
  state.editor = { pid: 'x', base: md, baseHash: 'x', text: moved, tl };
  const bar = html => { const m = /<div class="undobar" role="toolbar" aria-label="Undo and history">([\s\S]*?)<\/div>/.exec(html); assert.ok(m, 'a toolbar'); return m[1]; };
  const names = h => [...h.matchAll(/<button[^>]*data-act="([\w-]+)"[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1] + ':' + m[2].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ''));
  const keys = h => [...h.matchAll(/aria-keyshortcuts="([^"]*)"/g)].map(m => m[1]);
  state.builder = true; const b = bar(V.process(ctx));
  state.builder = false; const m = bar(V.process(ctx));
  assert.deepStrictEqual(names(b), ['tl-undo:Undo move', 'tl-redo:Redo', 'hist-open:History'], 'the builder');
  assert.deepStrictEqual(names(m), names(b), 'Markdown: the same three, same names');
  assert.ok(/aria-label="Undo the move of &quot;&lt;b&gt;Smoke&lt;\/b&gt; tests&quot;"/.test(b) && !/<b>Smoke/.test(b), 'the full name is said, escaped');
  assert.ok(/data-act="tl-redo" data-id="draft" aria-disabled="true"[^>]*aria-describedby="tl-redo-why-draft"/.test(b) && /id="tl-redo-why-draft">Nothing to redo.</.test(b), 'nothing to redo: still focusable, and says why');
  state.builder = true; state.obSel = { pid: 'x', kind: 'step', key: 'smoke' };
  assert.ok(/data-act="hist-open" data-id="draft" data-item="step:smoke"[^>]*>(?:<span class="ic"[\s\S]*?<\/span>)?History of this step</.test(V.process(ctx)), 'a step\'s own History');
  state.obSel = null;
  // The step-type form: the same toolbar, its own timeline.
  state.view = 'types';
  const form = V.typeFormOf(PF.types.customType({ id: 'risk.level', label: 'Risk', fields: { level: { label: 'Level', kind: 'text' } } }), true), ttl = TL.create(), before = JSON.stringify(form);
  form.fields.pop();
  TL.record(ttl, before, JSON.stringify(form), { kind: 'form', label: 'field removal', subject: 'level' });
  state.typeForm = { def: form, existing: 'risk.level', baseHash: null, tl: ttl };
  const tb = bar(V.types(ctx));
  assert.deepStrictEqual(names(tb), ['tl-undo:Undo field removal', 'tl-redo:Redo', 'hist-open:History'], 'the step-type form');
  assert.deepStrictEqual(keys(tb), keys(b), 'and the same keys');
  assert.ok(/data-act="tl-undo" data-id="type"/.test(tb));
  // Nothing done yet: Undo says so.
  state.typeForm.tl = TL.create();
  assert.ok(/id="tl-undo-why-type">Nothing to undo yet.</.test(V.types(ctx)));
});

rule('History lists this session\'s changes newest first, marks the baseline, and escapes what it shows', () => {
  const { ctx } = setup(), TL = PF.timeline, tl = TL.create();
  TL.record(tl, 'a\n', 'a <script>x</script>\n', { kind: 'op', lines: true, label: 'wording change', subject: '<img src=x>', items: ['step:a'] });
  TL.barrier(tl, 'The draft changed in the folder here. Earlier changes can\'t be undone.');
  TL.record(tl, 'b\n', 'bc\n', { kind: 'typing', lines: true, label: 'typing', subject: 'B', items: ['step:b'] });
  TL.record(tl, 'bc\n', 'bcd\n', { kind: 'op', label: 'move', subject: 'B', items: ['step:b'] });
  TL.undo(tl, 'bcd\n');
  const h = V.historyDrawer(ctx, { scope: 'draft', tl, title: 'Draft of X' });
  assert.ok(/role="dialog" aria-modal="true" aria-labelledby="hist-t"/.test(h) && /<h3>This session<\/h3>/.test(h));
  const order = ['The move of', 'The typing in', 'hist-mark', 'The wording change of'].map(x => h.indexOf(x));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'newest first, with the baseline in its place');
  assert.ok(/Undone · Redo brings it back/.test(h) && /Can't be undone/.test(h));
  assert.ok(!/<script>|<img src=x>/.test(h) && /&lt;script&gt;/.test(h), 'escaped');
  const one = V.historyDrawer(ctx, { scope: 'draft', tl, item: 'step:a', itemName: 'step "A"' });
  assert.ok(/Only changes to <b>step &quot;A&quot;<\/b>/.test(one) && /data-act="hist-item" data-id="">Show all/.test(one) && !/The typing in/.test(one), 'one item, with Show all');
});

rule('Saved history in the History dialog: everything from the files is escaped, and gaps, publications and sources are said in words', () => {
  const { ctx } = setup(), TL = PF.timeline, H = PF.util.hash;
  const raw = { v: 1, kind: 'draft-edit', id: 'e1', process: 'release', writer: 'agent-helper', seq: 1, by: '<img src=x onerror=1>', at: '2026-10-19T09:00:00.000Z', from: H('a'), to: H('b'), seen: null, source: 'restore', version: 4,
    units: ['<script>alert(1)</script>'], items: ['step:a'], hunks: [{ at: 0, del: ['- [ ] {confirm} <b>Old</b> {#a}'], ins: ['- [ ] {confirm} "New" & <i>x</i> {#a}'] }] };
  const e = TL.cleanEntry(JSON.parse(JSON.stringify(raw)), 'agent-helper.jsonl');
  const items = TL.placePublications(TL.refs(TL.order([e], H('c'))), [{ version: 5, hash: H('b'), by: 'person-avery', at: '2026-10-19T10:00:00.000Z' }]);
  const o = { scope: 'draft', tl: TL.create(), mode: 'saved', saved: { state: 'ok', items, bad: 2 }, compare: e.ref, compareMsg: 'The text changed since. Compare and edit it yourself.' };
  const h = V.historyDrawer(ctx, o);
  assert.ok(/data-act="hist-mode" data-id="saved" aria-pressed="true"/.test(h) && /data-act="hist-mode" data-id="session" aria-pressed="false"/.test(h), 'a two-way switch');
  assert.ok(!/<script>|<img src=x|<b>Old<\/b>|<i>x<\/i>/.test(h) && /&lt;script&gt;/.test(h) && /&lt;img src=x/.test(h) && /&quot;New&quot; &amp; &lt;i&gt;/.test(h), 'escaped everywhere, the diff included');
  const at = x => h.indexOf(x);
  assert.ok(at('Changed outside Flightdeck') > 0 && at('Published v5') > at('Changed outside Flightdeck') && at('Restored from v4') > at('Published v5'), 'outside change, then the publication above the save it published');
  assert.ok(/\(AI assistant\)/.test(h) && /2 lines in the history files couldn.t be read/.test(h), 'an AI assistant\'s own file, and unread lines counted');
  assert.ok(/The text changed since\. Compare and edit it yourself\./.test(h) && /<span class="del">- /.test(h) && /<span class="add">\+ /.test(h), 'Compare');
  const one = V.historyDrawer(ctx, Object.assign({}, o, { item: 'step:b', compare: null }));
  assert.ok(/No saved changes to it yet/.test(one) && !/Changed outside/.test(one), 'filtered to one step');
  assert.ok(/Reading the saved history/.test(V.historyDrawer(ctx, Object.assign({}, o, { saved: { state: 'loading' } }))));
  assert.ok(/Couldn.t read the saved history: no &lt;access&gt;/.test(V.historyDrawer(ctx, Object.assign({}, o, { saved: { state: 'error', msg: 'no <access>' } }))));
  const big = TL.cleanEntry(Object.assign({}, raw, { id: 'e2', hunks: undefined, big: true }), 'w.jsonl');
  const hb = V.historyDrawer(ctx, Object.assign({}, o, { saved: { state: 'ok', items: TL.refs([{ entry: big }]) }, compare: null }));
  assert.ok(/Too big to keep line by line/.test(hb) && !/Reverse this change/.test(hb), 'a big change has no Reverse');
});

rule('Step types page lists every type; the form checks a new one as you build it', () => {
  const { ctx, state } = setup();
  ctx.processes = () => []; ctx.data.stepTypes = { types: { 'risk.call': PF.types.customType({ id: 'risk.call', label: 'Risk call', record: [{ name: 'call', label: 'Call', kind: 'text' }] }) }, errors: [{ file: 'bad.json', errors: ['"label" must be 1-40 characters'] }] };
  let html = V.types(ctx);
  assert.ok(/Your team.s types · 1/.test(html) && /Built-in types · \d+/.test(html) && /\{jenkins\.job\}/.test(html) && /data-act="edit-type" data-id="risk.call"/.test(html) && /step-types\/bad\.json/.test(html));
  state.typeForm = { def: { id: 'Bad Id', idSet: true, label: '', hint: '', icon: 'check', fields: [], record: [] }, existing: null, baseHash: null };
  html = V.types(ctx);
  assert.ok(/id="tf-save-why">Add a label to save\./.test(html) && /<p class="ferr" id="tf-err-\d+">The ID can use lowercase letters/.test(html) && !/&quot;label&quot; must be/.test(html), 'what\'s missing is said near Save, and a wrong ID next to it');
  assert.ok(/<button class="btn go" type="submit" form="type-form" aria-describedby="tf-save-why">Save step type/.test(html), 'Save is never silently disabled');
  state.typeForm.def = { id: 'risk.level', label: 'Risk level', hint: '', icon: 'check', fields: [{ name: 'level', label: 'Level', kind: 'choice', options: 'Low, High' }], record: [{ name: 'who', label: 'Who', kind: 'text' }] };
  html = V.types(ctx);
  assert.ok(!/tf-save-why/.test(html) && /options&quot;: \[/.test(html) && /\{risk\.level\} What to do/.test(html) && /<dt>Level<\/dt>/.test(html), 'ready; the checklist line and the run card preview it');
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
  state.typeForm = { def: form, existing: 'risk.level', baseHash: null, tried: true };
  assert.ok(V.typeErrors(form).some(e => /labeled "Change system" has no name/.test(e)), 'an error, not a silent drop');
  const html = V.types(ctx);
  assert.ok(/id="tf-f-k999-name"[^>]*aria-invalid="true" aria-describedby="tf-err-\d+ tf-f-k999-name-help"/.test(html), 'the error points at the name');
  assert.ok(/<p class="ferr" id="tf-err-\d+">/.test(html) && /role="status"/.test(html));
  form.fields.pop();
  form.fields.push({ k: 'k998', name: '', label: '', kind: 'text', options: 'only options' });
  assert.ok(V.typeErrors(form).some(e => /with options has no name/.test(e)), 'options alone count too');
  form.fields.pop();
  form.record.push({ k: 'k997', name: 'verdict', label: 'Verdict', kind: 'choice', options: '' });
  assert.ok(/id="tf-r-k997-optadd"[^>]*aria-invalid="true"/.test(V.types(ctx)), 'a numbered evidence error points at its options');
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
  ctx.data.runs = []; state.processId = 'release'; state.clView = 'plan'; state.mapVer = null;
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
  assert.ok(/data-act="flight" data-id="list" aria-pressed="false">Checklist</.test(html) && /data-act="flight" data-id="plan" aria-pressed="true">Flight plan</.test(html) && /data-act="flight" data-id="md" aria-pressed="false">Markdown</.test(html), 'one switch: Checklist, Flight plan, Markdown');
  assert.ok(/<ol class="fp" aria-label="Flight plan">/.test(html) && />Start</.test(html) && />Landed</.test(html), 'an ordered route');
  assert.strictEqual((html.match(/data-act="flight-phase"/g) || []).length, 3, 'one button per phase');
  assert.ok(/aria-label="Phase 2 of 3, Deploy, Read-Do, 4 steps, then gate Deployed. Show it in the checklist"/.test(html), 'each phase says where it is and what follows');
  assert.ok(/Phase 1 · Do-Confirm/.test(html) && /6 steps · 4 must-do/.test(html), 'mode, steps and must-dos');
  assert.ok(!/data-act="toggle-md"/.test(html) && !/class="ph"/.test(html), 'the checklist itself is not shown');
  state.clView = 'list'; html = V.checklistPanel(ctx, p);
  assert.ok(/data-act="flight" data-id="list" aria-pressed="true"/.test(html) && /<h3 id="cl-ph-1" tabindex="-1">Deploy/.test(html) && !/class="fp"/.test(html), 'Checklist has an anchor per phase');
});

rule('The checklist panel switches between Checklist, Flight plan and Markdown in one control, and Markdown shows the source read-only with Copy', () => {
  const { ctx, p } = flightSetup(), state = ctx.state;
  const pressed = html => [...html.matchAll(/data-act="flight" data-id="(\w+)" aria-pressed="true"/g)].map(m => m[1]);
  state.clView = undefined; let html = V.checklistPanel(ctx, p);
  assert.deepStrictEqual(pressed(html), ['list'], 'Checklist by default, and only one pressed');
  assert.ok(!/data-act="toggle-md"/.test(html), 'no separate Markdown toggle');
  state.clView = 'md'; html = V.checklistPanel(ctx, p);
  assert.deepStrictEqual(pressed(html), ['md'], 'Markdown pressed');
  assert.ok(/<pre class="source" id="map-source" tabindex="0" aria-label="Markdown of this version">/.test(html) && /data-act="copy-map"/.test(html) && /read-only/.test(html), 'the source, read-only, with Copy');
  assert.ok(!/<textarea/.test(html) && !/<ol class="fp"/.test(html), 'not an editor, not the flight plan');
  state.clView = 'plan'; html = V.checklistPanel(ctx, p);
  assert.deepStrictEqual(pressed(html), ['plan']);
  state.clView = 'list';
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
  state.edit = 'detail:commit'; state.runDetails = true;
  assert.ok(/class="inline-edit" data-scope="edit:detail:commit"/.test(V.run(ctx)));
  state.edit = 'detail:environment';
  assert.ok(/data-scope="edit:detail:environment"/.test(V.run(ctx)));
  state.edit = null; state.sel = 'approved';
  assert.ok(/class="fpe-pane rw-ins" id="rw-ins" data-scope="ref:approved"/.test(V.run(ctx)));
  state.pick = { kind: 'block', id: 'approved' };
  assert.ok(/data-scope="block:approved"/.test(V.run(ctx)));
});

/* ---------- Corrections ---------- */
const C = PF.corrections;
let cn = 0;
const cr = (r, o) => C.build(Object.assign({ id: 'c' + (++cn), at: NOW, by: 'person-blake', session: 'w1', map: R.mapOf(r), version: 1, folder: r.folder, step: 'approved', op: 'wording', to: 'Change request approved by the board for tonight\'s window' }, o));
const withShot = () => {
  const md = example('maps/drafts/release.md').replace('{#approved}\n', '{#approved}\n  ![CAB page](images/release/cab.png)\n');
  const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'view0009' });
  return R.create(P.verify(b.folder, b.files), { title: 'T', details: { ticket: 'ABC-1', commit: 'c0ffee1', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'other', now: NOW, id: 'run1' });
};

rule('Run screen: anyone who has said who they are can correct a step; Suggest a fix is gone; only the recorder sees Done differently', () => {
  const r = withShot(); r._notes = []; r._conflicts = [];
  const { ctx, state } = setup(); ctx.run = () => r; ctx.data.runs = [r];
  state.me = 'person-blake'; state.sel = 'approved';
  let html = V.run(ctx), ins = insOf(html);
  assert.ok(!ctx.recording(r), 'set-up: Blake isn\'t recording');
  assert.ok(/<h3 class="rw-h3" id="ins-corr">Corrections<\/h3><button class="mini" data-act="corr-open" data-mode="correct" data-id="approved">.*Correct this step<\/button>/.test(ins), 'from the step');
  assert.ok(/data-act="corr-open" data-mode="correct" data-op="screenshot" data-id="approved" data-shot="images\/release\/cab.png">Replace this screenshot/.test(ins), 'from its screenshot');
  assert.ok(!/fix-open|Suggest a fix|fixform/.test(html), 'Suggest a fix is gone, from steps and phases');
  assert.ok(!/data-mode="differently"/.test(ins), 'a viewer can\'t answer the step');
  state.me = '';
  assert.ok(!/data-act="corr-open"/.test(V.run(ctx)), 'only someone who has said who they are');
  const rec = setup(); rec.state.sel = 'approved';
  ins = insOf(V.run(rec.ctx));
  assert.ok(/data-act="record" data-id="approved">.*Done<\/button><button class="btn" data-act="corr-open" data-mode="differently" data-id="approved">Done differently<\/button><button class="btn" data-act="pick" data-kind="block"/.test(ins), 'the recorder answers with Done, Done differently or Blocked');
  R.pause(rec.r, 'Lunch', 'person-casey', NOW);
  ins = insOf(V.run(rec.ctx));
  assert.ok(!/data-mode="differently"/.test(ins) && /data-mode="correct"/.test(ins), 'paused: no answers, but a correction can still be written');
});

rule('Correct this step: the published text stays; the wording starts filled in, with a live Before/After redline and its text alternative', () => {
  const { ctx, state } = setup(null, { sel: 'approved' });
  state.corrForm = { key: 'release/run1', step: 'approved', mode: 'correct', op: 'wording', scope: 'just', to: 'Change request approved for tonight\'s window', text: '', where: 'after', moveTo: '', roles: ['release-lead'], shot: '', why: '', happened: '', menu: false };
  let ins = insOf(V.run(ctx));
  assert.ok(/<h2 id="ins-h" class="rw-ins-h" tabindex="-1">Change request approved for tonight&#39;s window<\/h2>/.test(ins), 'the step\'s own text is never replaced');
  assert.ok(/<p class="small corr-says"><b>Checklist says<\/b> \(v1\): Change request approved for tonight&#39;s window<\/p>/.test(ins));
  assert.ok(/<textarea id="corr-to" rows="3" maxlength="2000" data-bound aria-describedby="corr-same">Change request approved for tonight&#39;s window<\/textarea><p class="small corr-same" id="corr-same">No wording changed\.<\/p>/.test(ins), 'no change yet, said next to the field');
  assert.ok(/data-act="corr-save" data-id="approved" aria-disabled="true" aria-describedby="corr-conseq corr-same">Save correction/.test(ins) && /Saves a proposal for the checklist\. It doesn't answer the step\./.test(ins));
  assert.ok(/data-act="record" data-id="approved">/.test(ins), 'Done stays: a correction doesn\'t answer the step');
  state.corrForm.to = 'Change request approved by the board for <b>tonight</b>';
  ins = insOf(V.run(ctx));
  assert.ok(/<del>for<\/del><ins>by the board for<\/ins>/.test(ins.replace(/\s+/g, ' ')) || /<ins>by<\/ins>/.test(ins), 'the redline marks what changes');
  assert.ok(/<span class="sr">Before: Change request approved for tonight&#39;s window\. After: Change request approved by the board for &lt;b&gt;tonight&lt;\/b&gt;\.<\/span>/.test(ins) && !/<b>tonight/.test(ins), 'a text alternative, everything escaped');
  assert.ok(!/aria-disabled="true"/.test(ins.slice(ins.indexOf('corr-save'))), 'Save is ready');
  state.corrForm.menu = true; ins = insOf(V.run(ctx));
  assert.ok(/data-act="corr-menu" aria-expanded="true" aria-controls="corr-menu">Change something else/.test(ins));
  ['add', 'move', 'roles', 'remove', 'describe'].forEach(op => assert.ok(new RegExp('data-act="corr-op" data-id="' + op + '"').test(ins), op));
  assert.ok(!/data-id="screenshot"/.test(ins), 'Replace a screenshot only when the step has one');
  assert.ok(/>Remove this step from future versions</.test(ins) && />Describe another problem</.test(ins));
  state.corrForm = Object.assign(state.corrForm, { op: 'remove', menu: false });
  ins = insOf(V.run(ctx));
  assert.ok(/<b>Remove this step from future versions\?<\/b>/.test(ins) && /for="corr-why">Why remove it\? \(required\)/.test(ins) && /data-act="corr-op" data-id="wording"|Edit the wording/.test(ins.replace('aria-expanded="false"', '')) || /Change something else/.test(ins));
  state.fieldErr = { id: 'corr', msg: 'Remove this step from future versions? Say why.', field: 'corr-why' };
  ins = insOf(V.run(ctx));
  assert.ok(/<textarea id="corr-why" rows="2" maxlength="2000" data-bound aria-invalid="true" aria-describedby="ferr-corr"><\/textarea><p class="ferr" id="ferr-corr" role="alert">Remove this step/.test(ins), 'the error sits under its field');
  state.fieldErr = null;
  state.corrForm.op = 'move'; ins = insOf(V.run(ctx));
  assert.ok(/<select id="corr-move" data-bound><option value="">Choose…<\/option><optgroup label="Before production changes"><option value="start:prep">At the start of Before production changes<\/option><option value="after:tests">/.test(ins) && !/value="after:approved"/.test(ins));
  state.corrForm.op = 'roles'; ins = insOf(V.run(ctx));
  assert.ok(/<input type="checkbox" id="corr-role-release-lead" data-bound checked> @release-lead \(Casey Nguyen\)/.test(ins) && /id="corr-role-qa" data-bound>/.test(ins));
  state.corrForm.op = 'add'; ins = insOf(V.run(ctx));
  assert.ok(/id="corr-text"/.test(ins) && /id="corr-where-after" data-bound checked> After this step/.test(ins) && /At the end of Before production changes/.test(ins));
  assert.ok(/<input type="file" id="corr-file" accept="[^"]+" multiple class="sr">/.test(ins) && /data-drop="corr"/.test(ins), 'files can go with any correction');
});

rule('Done differently: what happened first, Just this run or Fix the checklist too, and the consequence above the button', () => {
  const { ctx, state } = setup(null, { sel: 'approved' });
  state.corrForm = { key: 'release/run1', step: 'approved', mode: 'differently', op: 'wording', scope: 'just', to: 'Change request approved for tonight\'s window', text: '', where: 'after', moveTo: '', roles: [], shot: '', why: '', happened: '', menu: false };
  let ins = insOf(V.run(ctx));
  assert.ok(/<h4 class="corr-h" id="corr-h">Done differently<\/h4>/.test(ins) && /<label class="small" for="corr-happened"><b>What happened<\/b> \(required\)<\/label><textarea id="corr-happened"/.test(ins));
  assert.ok(/data-act="corr-scope" data-id="just" aria-pressed="true">Just this run<\/button><button type="button" data-act="corr-scope" data-id="fix" aria-pressed="false">Fix the checklist too/.test(ins));
  assert.ok(!/id="corr-to"/.test(ins) && /id="corr-conseq">Marks this step done differently\.<\/p>/.test(ins) && /data-act="corr-done" data-id="approved" aria-describedby="corr-conseq">Mark done differently/.test(ins));
  assert.ok(/id="rec-number"/.test(ins), 'the step\'s required evidence is still there to fill in');
  state.corrForm.scope = 'fix'; state.corrForm.to = 'Change request approved by phone';
  ins = insOf(V.run(ctx));
  assert.ok(/id="corr-to"/.test(ins) && /Marks this step done differently and proposes a checklist correction\./.test(ins));
  state.fieldErr = { id: 'corr', msg: 'Say what happened.', field: 'corr-happened' };
  assert.ok(/id="corr-happened" rows="2" maxlength="500" data-bound aria-invalid="true" aria-describedby="ferr-corr"><\/textarea><p class="ferr" id="ferr-corr" role="alert">Say what happened\./.test(insOf(V.run(ctx))));
});

rule('A step\'s record: done differently with who and when, View correction and Change answer; its corrections with status, escaped', () => {
  const { r, ctx, state } = setup(r => { const map = R.mapOf(r); sampleDone(PF)(r, map, 'approved', 'person-casey', NOW); R.doneDifferently(r, map, 'approved', 'Approved by phone <b>', 'person-casey', NOW); }, { sel: 'approved' });
  r._notes = [cr(r, { id: 'k1', by: 'person-casey', happened: 'Approved by phone <b>', why: '<img src=x onerror=alert(1)>' }), cr(r, { id: 'k2', op: 'describe', why: 'The CAB page moved' })];
  ctx.data.corrDecisions = [];
  const html = V.run(ctx), ins = insOf(html);
  assert.ok(/<span class="badge b-diff">Done differently<\/span> · Casey Nguyen · [^<]+<span class="rw-diff-t">Approved by phone &lt;b&gt;<\/span>/.test(ins));
  assert.ok(/data-act="goto-corr" data-id="corr-k1">View correction<\/button><button class="mini" data-act="toggle" data-id="approved">Change answer/.test(ins));
  assert.ok(/Corrections · 2<\/h3>/.test(ins) && /<li class="corr" id="corr-k1" tabindex="-1">/.test(ins) && /<dt>Checklist said<\/dt><dd>Change request approved for tonight&#39;s window<\/dd><dt>Suggested<\/dt><dd><span class="redline">/.test(ins), 'Checklist said, then Suggested as a redline');
  assert.ok(/<dt>What happened<\/dt><dd>Approved by phone &lt;b&gt;<\/dd>/.test(ins) && /&lt;img src=x/.test(ins) && !/<img src=x/.test(ins));
  assert.ok(/<span class="pill open">Open<\/span>/.test(ins) && /<dt>Problem<\/dt><dd>The CAB page moved<\/dd>/.test(ins));
  assert.ok(!/data-act="corr-withdraw"/.test(ins.slice(ins.indexOf('id="corr-k2"'), ins.indexOf('rw-notes'))) && /data-act="corr-withdraw"/.test(ins.slice(ins.indexOf('id="corr-k1"'), ins.indexOf('id="corr-k2"'))), 'only the author can withdraw');
  assert.ok(/<span class="badge b-corr">2 corrections<\/span>/.test(html.slice(html.indexOf('id="step-approved"'))), 'the row says so');
  assert.ok(!/The CAB page moved/.test(ins.slice(ins.indexOf('rw-notes'))), 'corrections aren\'t repeated as notes');
});

rule('Run record: the finish page and receipt list Corrections · N with Checklist said, Suggested, What happened and where each stands', () => {
  const { r, ctx } = setup(r => { const map = R.mapOf(r); sampleDone(PF)(r, map, 'tests', 'person-casey', NOW); R.differently(r, map, 'tests', 'Ran it twice', 'person-casey', NOW); });
  r._notes = [cr(r, { id: 'k1' }), cr(r, { id: 'k2', step: 'flags', to: 'Feature flags set in values-prod.yaml' }), { id: 'old', kind: 'fix', fixKind: 'missing', target: { phase: 'verify', step: null }, text: 'Add an error budget check', by: 'person-avery', at: NOW, files: [] }];
  const g = C.status(C.groups(C.collect([r], 'release')), [])[1];
  ctx.data.corrDecisions = [Object.assign(C.decision(g, 'person-avery', 'declined', 'We set them in the job', NOW), { _file: 'x.w.1.json' })];
  let html = V.finish(ctx);
  assert.ok(/<h2>2\. Corrections · 4<\/h2>/.test(html) && /<span class="pill locked">Declined<\/span><span class="small corr-why-no">We set them in the job<\/span>/.test(html));
  assert.ok(/<span class="pill waived">One-off<\/span>/.test(html) && /<div class="corr-step">Full test gate green on the release commit<\/div>/.test(html) && /<dt>What happened<\/dt><dd>Ran it twice<\/dd>/.test(html));
  assert.ok(/data-act="add-followup" data-text="Update the checklist: Change request approved/.test(html), 'Make it a follow-up stays');
  assert.ok(/Phase: Verify in production/.test(html) && /A step is missing: Add an error budget check/.test(html), 'a suggested fix from before 1.13 shows as a problem');
  html = V.receipt(ctx);
  assert.ok(/<h4><span>Corrections · 4<\/span><\/h4>/.test(html) && /\[Declined: We set them in the job\]/.test(html) && /\[One-off\]/.test(html), 'the card and the plain text');
});

rule('Process page: Corrections · N open grouped by step, Suggested in N runs, two proposed changes, and Mark as applied, Decline with a reason, Reopen, Withdraw', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest;
  const r1 = R.create(latest, { title: 'Release <b>1</b>', details: {}, by: 'person-casey', session: 'me', now: NOW, id: 'r1' }), r2 = R.create(latest, { title: 'Release 2', details: {}, by: 'person-casey', session: 'me', now: NOW, id: 'r2' });
  r1._notes = [cr(r1, { id: 'a1', why: 'Say "when" <script>' }), cr(r1, { id: 'a3', step: 'announce', op: 'move', moveTo: 'start:prep', by: 'person-morgan' })];
  r2._notes = [cr(r2, { id: 'a2', by: 'person-avery', happened: 'The board met at 4' }), cr(r2, { id: 'b1', by: 'person-morgan', to: 'Change request approved' })];
  ctx.data.runs = [r1, r2];
  const gs = C.status(C.groups(C.collect([r1, r2], 'release')), []);
  const move = gs.filter(g => g.change.op === 'move')[0];
  ctx.data.corrDecisions = [Object.assign(C.decision(move, 'person-avery', 'declined', 'We post once it\'s sure', NOW), { _file: 'm.w.1.json' })];
  const p = { id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: latest.md }, draftChanged: false };
  ctx.processes = () => [p]; state.processId = 'release'; state.me = 'person-blake';
  let html = V.process(ctx);
  assert.ok(/Corrections · 2 open<\/h2>/.test(html) && /<h3 class="fixgroup">Change request approved for tonight&#39;s window<\/h3><p class="small corr-alts"><b>Two proposed changes\.<\/b>/.test(html));
  assert.ok(/<summary class="small">Suggested in 2 runs<\/summary>/.test(html) && /Release &lt;b&gt;1&lt;\/b&gt;/.test(html) && /Avery Lee · /.test(html), 'the runs behind it, with names inside');
  assert.ok(/<dt>Why · Blake Ortiz<\/dt><dd>Say &quot;when&quot; &lt;script&gt;<\/dd>/.test(html) && /<dt>What happened · Avery Lee<\/dt><dd>The board met at 4<\/dd>/.test(html));
  const first = gs[0].id;
  assert.ok(new RegExp('data-act="corr-applied" data-id="' + first + '">Mark as applied</button><button class="mini" data-act="pick" data-kind="corr-decline" data-id="' + first + '">Decline').test(html), 'anyone, not only the owner');
  assert.ok(!/data-act="corr-withdraw" data-id="' + first + '"/.test(html), 'not Blake\'s alone, so no Withdraw');
  assert.ok(!/We post once/.test(html), 'Open hides decided ones');
  assert.ok(/data-act="copy-corr-brief" data-id="release"/.test(html));
  state.fixFilter = 'all'; html = V.process(ctx);
  assert.ok(/Declined by Avery Lee [^:]*: We post once it&#39;s sure/.test(html) && new RegExp('data-act="corr-reopen" data-id="' + move.id + '"').test(html));
  state.fixFilter = 'open'; state.pick = { kind: 'corr-decline', id: first }; state.fieldErr = { id: 'corr-decline', msg: 'Why not? The runs will show this.' };
  html = V.process(ctx);
  assert.ok(/placeholder="Why not\? The runs will show this\." data-enter="corr-decline"/.test(html) && /id="ferr-corr-decline" role="alert">Why not\?/.test(html) && /aria-invalid="true" aria-describedby="ferr-corr-decline"/.test(html));
  state.pick = null; state.fieldErr = null; state.me = 'person-morgan';
  const morgan = gs.filter(g => g.first.id === 'b1')[0];
  assert.ok(new RegExp('data-act="corr-withdraw" data-id="' + morgan.id + '"').test(V.process(ctx)), 'the author can withdraw their own');
  state.ptab = 'edit'; state.editor = { pid: 'release', base: latest.md, baseHash: 'x', text: latest.md };
  html = V.process(ctx);
  assert.ok(/<span class="badge b-warn">2 open corrections<\/span>/.test(html.slice(html.indexOf('>Preview<'))), 'marked in the editor\'s preview');
  state.ptab = null; state.editor = null; ctx.data.runs = [];
  assert.ok(!/Corrections ·/.test(V.process(ctx)), 'no panel without corrections');
});

rule('Applying a correction: the dialog compares the run\'s version, the draft now and the result, says when the draft has it already, and escapes what people wrote', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest, r1 = R.create(latest, { title: 'R', details: {}, by: 'person-casey', session: 'me', now: NOW, id: 'r1' });
  r1._notes = [cr(r1, { id: 'w1', to: 'Change request <b>approved</b> & signed' }), cr(r1, { id: 'w2', to: 'Change request approved by the board', by: 'person-avery' }), cr(r1, { id: 'd1', step: 'pods', op: 'describe', why: 'Odd <img src=x>' })];
  ctx.data.runs = [r1];
  const p = { id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: latest.md }, draftChanged: false };
  ctx.processes = () => [p]; state.processId = 'release'; state.me = 'person-blake'; ctx.data.corrDecisions = [];
  const gs = C.status(C.groups(C.collect([r1], 'release')), []), by = id => gs.find(g => g.first.id === id), w1 = by('w1'), w2 = by('w2'), d1 = by('d1');
  let html = V.process(ctx);
  assert.ok(new RegExp('data-act="corr-review" data-id="' + w1.id + '">Review and apply<').test(html) && new RegExp('data-act="corr-review" data-id="' + d1.id + '">Review<').test(html));
  let ov = V.corrApply(ctx, { pid: 'release', gid: w1.id });
  assert.ok(/role="dialog" aria-modal="true" aria-labelledby="ca-t"/.test(ov) && /<h3 id="ca-h-from">From the run's v1<\/h3>/.test(ov) && /<h3 id="ca-h-now">Draft now<\/h3>/.test(ov) && /<h3 id="ca-h-res">Proposed result<\/h3>/.test(ov));
  assert.ok(/Change request &lt;b&gt;approved&lt;\/b&gt; &amp; signed/.test(ov) && !/<b>approved<\/b>/.test(ov), 'escaped');
  assert.ok(/>Use this proposal</.test(ov) && /data-act="corr-combine"/.test(ov) && /Two proposed changes to this step/.test(ov), 'alternatives: use one or combine them');
  // Already in the draft: Link, nothing to apply.
  p.draft.md = latest.md.replace('Change request approved for tonight\'s window', 'Change request approved by the board');
  ov = V.corrApply(ctx, { pid: 'release', gid: w2.id });
  assert.ok(/This is already in the draft\./.test(ov) && /data-act="corr-link"[^>]*>Link this correction</.test(ov) && !/data-act="corr-apply"/.test(ov));
  // A described problem: made by hand.
  ov = V.corrApply(ctx, { pid: 'release', gid: d1.id });
  assert.ok(/Flightdeck can&#39;t apply this one for you\./.test(ov) && />Open in the editor</.test(ov) && />Mark as applied</.test(ov) && !/data-act="corr-apply"/.test(ov));
  // Editing: the result in a labeled box, with its error next to it.
  p.draft.md = latest.md;
  ov = V.corrApply(ctx, { pid: 'release', gid: w1.id, edit: { text: 'A <i>' }, err: { field: 'ca-edit', msg: 'Leave out @roles' } });
  assert.ok(/<label class="field" for="ca-edit">Proposed result<textarea id="ca-edit"[^>]*aria-invalid="true" aria-describedby="ferr-ca-edit">A &lt;i&gt;<\/textarea>/.test(ov) && /id="ferr-ca-edit" role="alert">Leave out @roles/.test(ov));
  // Unsaved edits in this window: Apply is off, and says why.
  state.editor = { pid: 'release', base: latest.md, baseHash: 'x', text: latest.md + '\nmore' };
  ov = V.corrApply(ctx, { pid: 'release', gid: w1.id });
  assert.ok(/You have unsaved changes to this draft/.test(ov) && /data-act="corr-apply"[^>]*disabled/.test(ov));
  // Markers: the builder's rows and the Markdown's Open corrections list with Go to line.
  state.editor = { pid: 'release', base: latest.md, baseHash: 'x', text: null }; state.ptab = 'edit';
  html = V.process(ctx);
  assert.ok(/data-ob-step="approved"[\s\S]*?<span class="badge b-warn">2 open corrections<\/span>/.test(html) && /data-ob-step="pods"[\s\S]*?<span class="badge b-warn">1 open correction<\/span>/.test(html.slice(html.indexOf('data-ob-step="pods"'))));
  state.builder = false; html = V.process(ctx);
  const line = latest.md.split('\n').findIndex(l => /\{#approved\}/.test(l)) + 1;
  assert.ok(/<summary class="small">Open corrections · 3<\/summary>/.test(html) && new RegExp('Wording: Change request approved for tonight&#39;s window</span><button type="button" class="linkish" data-act="corr-goto-line" data-id="' + line + '">Go to line ' + line + '<').test(html));
  state.builder = true; state.ptab = null; state.editor = null;
});

rule('Process page: an applied correction whose step changed in the draft since says so', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest, r1 = R.create(latest, { title: 'R', details: {}, by: 'person-casey', session: 'me', now: NOW, id: 'r1' });
  r1._notes = [cr(r1, { id: 'w1' })];
  ctx.data.runs = [r1];
  const g = C.groups(C.collect([r1], 'release'))[0], applied = C.review(g, latest.md).text;
  ctx.data.corrDecisions = [Object.assign(C.cleanDecision(JSON.parse(JSON.stringify(C.decision(g, 'person-avery', 'applied', '', NOW, { result: C.outcome(g, applied) }))), 'release'), { _file: 'g.w.1.json' })];
  const p = { id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: applied }, draftChanged: true };
  ctx.processes = () => [p]; state.processId = 'release'; state.fixFilter = 'all';
  assert.ok(!/Changed since applied/.test(V.process(ctx)));
  p.draft.md = applied.replace('by the board', 'by the change board');
  assert.ok(/<span class="pill review">Changed since applied<\/span>/.test(V.process(ctx)));
  state.fixFilter = 'open';
});

rule('Process page: a group decided twice at once says Needs review; an accepted suggested fix from before 1.13 is Applied (legacy), with no actions', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest, r1 = R.create(latest, { title: 'R', details: {}, by: 'person-casey', session: 'me', now: NOW, id: 'r1' });
  r1._notes = [cr(r1, { id: 'a1' }), { id: 'f1', kind: 'fix', fixKind: 'instructions', target: { phase: 'deploy', step: 'jenkins' }, version: 1, text: 'Say when', by: 'person-avery', at: NOW, files: [] }];
  ctx.data.runs = [r1];
  const g = C.status(C.groups(C.collect([r1], 'release')), [])[0];
  ctx.data.corrDecisions = [Object.assign(C.decision(g, 'person-avery', 'applied', '', NOW), { _file: 'a.w.1.json' }), Object.assign(C.decision(g, 'person-morgan', 'declined', 'No', NOW), { _file: 'b.w.1.json' }),
    C.cleanDecision({ kind: 'fix-decision', suggestion: 'f1', status: 'accepted', by: 'person-casey', at: NOW }, 'release')];
  const p = { id: 'release', title: 'Production release', latest, all: [latest], clashes: [], broken: [], skills: [], draft: null };
  ctx.processes = () => [p]; state.processId = 'release'; state.fixFilter = 'all';
  const html = V.process(ctx);
  assert.ok(/<span class="pill review">Needs review<\/span>/.test(html) && /two people decided at once/.test(html) && new RegExp('data-act="corr-applied" data-id="' + g.id + '"').test(html), 'it can be decided again');
  state.fixFilter = 'open';
  const open = V.process(ctx);
  assert.ok(/Corrections · 1 open<\/h2>/.test(open) && /<span class="pill review">Needs review<\/span>/.test(open), 'Needs review stays under Open, and counts');
  state.fixFilter = 'all';
  const legacy = html.slice(html.indexOf('Applied (legacy)'));
  assert.ok(/<span class="pill passed">Applied \(legacy\)<\/span>/.test(html) && /Flightdeck can't confirm which version has it/.test(legacy) && !/data-act="corr-/.test(legacy.slice(0, legacy.indexOf('</li>'))));
});

/* Corrections slice 3: a wording correction from a run of v1, applied, and v2 published with it. Text people wrote is hostile. */
function landedSetup(o) {
  o = o || {};
  const { ctx, state } = setup();
  const v1 = ctx.data.processes[0].index.latest, r1 = R.create(v1, { title: 'Release <i>A</i>', details: {}, by: 'person-casey', session: 'me', now: NOW, id: 'r1' });
  r1._notes = [cr(r1, { id: 'w1', to: 'Change request approved by the <b>board</b>', why: 'The board <img src=x onerror=alert(1)> meets at 4' }), cr(r1, { id: 'x1', step: 'pods', to: 'New pods stay up <script>', by: 'person-blake' })];
  const g = C.groups(C.collect([r1], 'release'))[0], text = C.review(g, v1.md).text;
  const dApplied = Object.assign(C.cleanDecision(JSON.parse(JSON.stringify(C.decision(g, 'person-avery', 'applied', '', NOW, { result: C.outcome(g, text) }))), 'release'), { _file: g.id + '.w.1.json' });
  const declined = C.groups(C.collect([r1], 'release'))[1];
  const dDeclined = Object.assign(C.cleanDecision(JSON.parse(JSON.stringify(C.decision(declined, 'person-casey', 'declined', 'We watch <u>dashboards</u>', NOW))), 'release'), { _file: 'x.w.1.json' });
  ctx.data.corrDecisions = [dApplied, dDeclined];
  const p = { id: 'release', title: 'Production <em>release</em>', category: 'Releases', latest: v1, all: [v1], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: text }, draftChanged: true };
  ctx.processes = () => [p]; ctx.data.runs = [r1];
  let v2 = null, r2 = null;
  if (!o.unpublished) {
    const list = C.forPublish(text, C.forProcess([r1], 'release', ctx.data.corrDecisions, p)).list;
    const b = P.build(text, { people, ...EX, by: 'person-avery', changes: 'Board wording', existing: [{ version: 1 }], now: NOW, rand: 'view0102', corrections: list });
    v2 = Object.assign(P.verify(b.folder, b.files), { folder: b.folder });
    p.latest = v2; p.all = [v2, v1]; p.draft = { file: 'release.md', md: text }; p.draftChanged = false;
    r2 = R.create(v2, { title: 'Release 2', details: {}, by: 'person-casey', session: 'me', now: NOW, id: 'r2' }); r2._notes = []; r2._conflicts = [];
    ctx.data.runs = [r1, r2];
  }
  return { ctx, state, p, g, r1, r2, v1, v2 };
}

rule('Publishing says how many corrections the version includes, and names applied ones left out because they changed since', () => {
  const { ctx, state, p, g } = landedSetup({ unpublished: true });
  state.view = 'process'; state.processId = 'release'; state.me = 'person-blake';
  let html = V.process(ctx);
  assert.ok(/<p class="small corr-pub" role="status"><b>Included in this version: 1 correction\.<\/b><\/p>/.test(html), html.match(/corr-pub.{0,200}/));
  p.draft.md = p.draft.md.replace('by the <b>board</b>', 'by the board chair');
  html = V.process(ctx);
  assert.ok(/<b>Included in this version: 0 corrections\.<\/b> Left out, changed since applied: "Change request approved for tonight&#39;s window"\./.test(html));
});

rule('Published in vN: the pill on the process page and the run\'s record, and "Changed in vN" with "Why is this here?" only on runs of that version', () => {
  const { ctx, state, g, r1, r2 } = landedSetup();
  state.view = 'process'; state.processId = 'release'; state.me = 'person-blake'; state.fixFilter = 'all';
  let html = V.process(ctx);
  assert.ok(/<span class="pill passed">Published in v2<\/span>/.test(html) && /v2 has it, published /.test(html));
  // The run where it was suggested shows where it stands now.
  state.view = 'run'; ctx.run = () => r1; state.sel = 'approved';
  html = V.run(ctx);
  assert.ok(/<span class="pill passed">Published in v2<\/span>/.test(insOf(html)));
  assert.ok(!/Changed in v/.test(html), 'not on v1\'s runs');
  // A run of v2: the chip on the row and in the step, with why it's there.
  ctx.run = () => r2; state.sel = 'approved';
  html = V.run(ctx);
  assert.ok(/<span class="badge b-changed">Changed in v2<\/span>/.test(rowOf(html, 'approved')) && !/Changed in v2/.test(rowOf(html, 'pods')));
  const ins = insOf(html);
  assert.ok(new RegExp('<details class="prov-why" data-disc="prov:' + g.id + '"><summary class="small">Why is this here\\?</summary>').test(ins));
  assert.ok(/<dt>Before → after<\/dt><dd><span class="redline">/.test(ins) && /<ins>by<\/ins>|<ins>/.test(ins), 'before and after, as a redline');
  assert.ok(/<dt>Why · Blake Ortiz<\/dt><dd>The board &lt;img src=x onerror=alert\(1\)&gt; meets at 4<\/dd>/.test(ins) && !/<img src=x/.test(ins), 'the reason, escaped');
  assert.ok(/Suggested in 1 run: <button class="linkish" data-act="open-run" data-id="release\/r1">Release &lt;i&gt;A&lt;\/i&gt;<\/button>/.test(ins) && /Applied by Avery Lee /.test(ins));
  state.disc = { ['prov:' + g.id]: true };
  assert.ok(/data-disc="prov:[^"]+" open>/.test(insOf(V.run(ctx))), 'stays open across redraws');
  // A v3 that lists it again isn't where it changed.
  const b = P.build(r2.snapshot, { people, ...EX, by: 'person-avery', changes: 'Again', existing: [{ version: 1 }, { version: 2 }], now: NOW, rand: 'view0103', corrections: [{ id: g.id }] });
  const v3 = Object.assign(P.verify(b.folder, b.files), { folder: b.folder }), r3 = R.create(v3, { title: 'Release 3', details: {}, by: 'person-casey', session: 'me', now: NOW, id: 'r3' }); r3._notes = []; r3._conflicts = [];
  ctx.processes()[0].all.unshift(v3); ctx.processes()[0].latest = v3; ctx.data.runs.push(r3); ctx.run = () => r3;
  assert.ok(!/Changed in v/.test(V.run(ctx)), 'only the first version that has it');
});

rule('Home: "Your correction to … is published in vN" and "… declined your correction", each with View change and Dismiss, escaped', () => {
  const { ctx, state } = landedSetup();
  state.view = 'home'; state.me = 'person-blake'; ctx.data.plans = []; ctx.lostDrafts = () => [];
  const html = V.home(ctx), panel = html.slice(html.indexOf('aria-labelledby="ack-h"'));
  assert.ok(/<h2 id="ack-h">Your corrections<\/h2>/.test(html));
  assert.ok(/<b>Your correction to &quot;Change request approved for tonight&#39;s window&quot; is published in v2\.<\/b>/.test(panel), panel);
  assert.ok(/<b>Casey Nguyen declined your correction: We watch &lt;u&gt;dashboards&lt;\/u&gt;<\/b>/.test(panel) && !/<u>dashboards/.test(panel));
  assert.ok(/data-act="ack-view" data-id="l\.release\.v2-view0102" data-process="release">View change<\/button><button class="mini" data-act="ack-dismiss" data-id="l\.release\.v2-view0102"/.test(panel));
  assert.ok(!/things? need/.test(html.slice(0, html.indexOf('aria-labelledby="ack-h"'))) || /Nothing needs you right now\./.test(html), 'acknowledgments never count as needing you');
  ctx.acks = () => [];
  assert.ok(!/ack-h/.test(V.home(ctx)), 'dismissed: gone');
  delete ctx.acks; state.me = 'person-avery';
  assert.ok(!/Your corrections/.test(V.home(ctx)), 'only the author\'s');
});

rule('Process page: an item applied before 1.16 offers "It\'s in vN" for the versions after its own', () => {
  const { ctx, state, p, v2 } = landedSetup();
  // As if v2 had been published by an older copy: it makes the change but doesn't list it.
  const b = P.build(v2.md, { people, ...EX, by: 'person-avery', changes: 'Board wording', existing: [{ version: 1 }], now: NOW, rand: 'view0104' });
  const plain = Object.assign(P.verify(b.folder, b.files), { folder: b.folder });
  p.all = [plain, p.all[1]]; p.latest = plain;
  state.view = 'process'; state.processId = 'release'; state.me = 'person-blake'; state.fixFilter = 'all';
  const html = V.process(ctx);
  assert.ok(/A published version has this change but doesn&#39;t list it\. Flightdeck can&#39;t confirm which version has it\.|A published version has this change but doesn't list it\. Flightdeck can't confirm which version has it\./.test(html));
  assert.ok(/data-act="corr-included" data-id="[^"]+" data-folder="v2-view0104">It's in v2<\/button>/.test(html));
  state.me = '';
  assert.ok(!/corr-included/.test(V.process(ctx)), 'only for someone who has said who they are');
});

/* The builder open on the release draft, for the parts box. */
function partsSetup(types) {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest;
  const p = { id: 'release', title: 'Production release', latest, all: [latest], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: latest.md }, draftChanged: false };
  ctx.processes = () => [p]; state.processId = 'release'; state.ptab = 'edit';
  state.editor = { pid: 'release', base: latest.md, baseHash: 'x', text: null };
  ctx.data.stepTypes = types || { types: EX.customTypes, errors: [] };
  return { ctx, state, p };
}
rule('Parts box: structure, steps and every step type by group, with a gate clearly not a CI result', () => {
  const { ctx } = partsSetup({ types: { 'change.request': PF.types.customType(JSON.parse(example('step-types/change.request.json'))) }, errors: [] });
  const html = V.process(ctx), box = html.slice(html.indexOf('<aside class="fpe-pane fpe-parts"'), html.indexOf('</aside>', html.indexOf('<aside class="fpe-pane fpe-parts"')));
  ['Structure', 'Steps', 'Your team.s step types', 'Built-in step types', 'General', 'Tools', 'Automation'].forEach(h => assert.ok(new RegExp('<h4[^>]*>' + h + '</h4>').test(box), h));
  assert.ok(/data-id="gate" draggable="true" data-ob-part="gate"[^>]*>.*<b>Gate<\/b><small>Someone signs off to go on<\/small>/.test(box), 'the structural gate');
  assert.ok(/<b>Pipeline result<\/b><small>Records a CI build or test result for a commit\. Not a sign-off\.<\/small>/.test(box), 'the CI type says what it records, and that it isn\'t a sign-off');
  assert.ok(/<b>Must-do<\/b>/.test(box) && /<b>Run another process<\/b>/.test(box) && /data-id="type:change\.request"/.test(box), 'presets and the team\'s type');
  assert.strictEqual((box.match(/data-ob-part=/g) || []).length, 6 + 1 + PF.types.LIST.length - 2, 'every type once (Confirm and Run another process are the presets)');
  assert.ok(/<p id="ob-kbd"/.test(html) && /data-act="ob-parts-open"/.test(html), 'a keyboard hint, and Add part for phones');
});

rule('Parts box: search narrows it, an empty result offers to clear, and a team without types is offered one', () => {
  const { ctx, state } = partsSetup({ types: {}, errors: [] });
  let html = V.process(ctx);
  assert.ok(/None yet\. <button type="button" class="linkish" data-act="new-type">Create a step type<\/button>/.test(html), 'no team types yet');
  state.obQ = 'pull';
  html = V.process(ctx);
  assert.ok(/value="pull"/.test(html) && /<b>Pull request<\/b>/.test(html) && !/<b>Jenkins job<\/b>/.test(html) && !/Create a step type/.test(html), 'only matches');
  assert.ok(/<b>Gate<\/b>/.test(html) && /<b>Phase<\/b>/.test(html), 'Structure is always there');
  state.obQ = 'run.process'; assert.ok(/<b>Run another process<\/b>/.test(V.process(ctx)), 'by type ID too');
  state.obQ = 'approval'; assert.ok(/<b>Change request<\/b>|<b>Review<\/b>|<b>Gate<\/b>/.test(V.process(ctx)), 'by what it\'s for');
  state.obQ = '<zz>';
  html = V.process(ctx);
  assert.ok(/No parts match “&lt;zz&gt;”\./.test(html) && /data-act="ob-part-clear">Clear search/.test(html) && !/<zz>/.test(html), 'escaped, with a way out');
});

rule('Parts box: team type names and groups are escaped, and a broken type says it can\'t be used yet', () => {
  const bad = PF.types.customType({ id: 'x.bad', label: '<img src=x onerror=alert(1)>', hint: '<b>hint</b>', group: '<i>Grp</i> / Two', record: [] });
  const { ctx, state } = partsSetup({ types: { 'x.bad': bad }, errors: [{ file: '<svg onload=1>.json', errors: ['bad'] }] });
  const html = V.process(ctx);
  assert.ok(!/<img src=x|<b>hint|<i>Grp|<svg onload/.test(html), 'nothing raw');
  assert.ok(/&lt;img src=x onerror=alert\(1\)&gt;/.test(html) && /&lt;i&gt;Grp&lt; \/ i&gt; \/ Two/.test(html));
  assert.ok(/<b>&lt;svg onload=1&gt;\.json<\/b><span class="small">Can.t use this type yet\.<\/span> <button type="button" class="linkish" data-act="open-types">View errors/.test(html));
  state.obPlace = { pid: 'release', part: 'type:x.bad', at: 'before:flags' };
  const placing = V.process(ctx);
  assert.ok(!/<img src=x/.test(placing) && /Placing &lt;img src=x onerror=alert\(1\)&gt;\./.test(placing), 'the placing strip too');
  assert.ok(/data-say="after “Full test gate green on the release commit”, inside Before production changes"/.test(placing));
});

rule('The 1.14 step types are in the parts box under their group, and in the step-type picker, with no extra wiring', () => {
  const { ctx, state } = partsSetup();
  let html = V.process(ctx);
  const box = html.slice(html.indexOf('<aside class="fpe-pane fpe-parts"'), html.indexOf('</aside>', html.indexOf('<aside class="fpe-pane fpe-parts"')));
  const group = h => box.slice(box.indexOf('>' + h + '</h4>'), box.indexOf('</h4>', box.indexOf('>' + h + '</h4>') + h.length + 6));
  [['jira.sprint', 'Jira sprint', 'Tools'], ['deploy', 'Deploy', 'Tools'], ['verify.health', 'Health check', 'Tools'], ['github.pr', 'GitHub pull request', 'Tools'], ['measure', 'Measure', 'General']].forEach(([id, label, g]) => {
    assert.ok(new RegExp('data-id="type:' + id.replace('.', '\\.') + '"').test(group(g)), id + ' under ' + g);
    assert.ok(new RegExp('<b>' + label + '</b><small>' + PF.util.esc(PF.types.get(id).hint).replace(/[.()]/g, '\\$&') + '</small>').test(box), id + ': its label and hint');
  });
  state.obQ = 'sprint'; html = V.process(ctx);
  assert.ok(/<b>Jira sprint<\/b>/.test(html) && !/<b>Deploy<\/b>/.test(html), 'found by search');
  state.obQ = 'verify.health'; assert.ok(/<b>Health check<\/b>/.test(V.process(ctx)), 'by type ID');
  state.obQ = null; state.obSel = { pid: 'release', kind: 'step', key: 'logs' };
  html = V.process(ctx);
  const picker = html.slice(html.indexOf('<select id="ob-type"'), html.indexOf('</select>', html.indexOf('<select id="ob-type"')));
  assert.ok(/<option value="verify\.health" selected>Health check<\/option>/.test(picker), 'the step\'s own type is chosen');
  ['jira.sprint', 'deploy', 'github.pr', 'measure'].forEach(id => assert.ok(new RegExp('<option value="' + id.replace('.', '\\.') + '">').test(picker), id + ' can be picked'));
});

rule('Draft builder: lanes sit side by side under "Do all lanes", and a lane opens its own form', () => {
  const { ctx, state } = partsSetup();
  let html = V.process(ctx);
  assert.ok(/<div class="ob-lanes" role="group" aria-label="Parallel lanes in Verify in production"><p class="ob-lanes-h">.*Do all lanes\. Finish every lane before the gate\.<\/p>/.test(html));
  assert.ok(/<section class="ob-lane" aria-label="Lane: Product checks">/.test(html) && /<section class="ob-lane" aria-label="Lane: Wrap-up">/.test(html));
  assert.ok(/data-ob-place="lane:verify:1" data-for="lanes"/.test(html) && /data-ob-place="gate:verify" data-for="gate"/.test(html) && /data-ob-place="phase:\^" data-for="phase"/.test(html), 'drop lines for each kind of part');
  assert.ok(!/data-ob-place="gate:prep"/.test(html), 'no gate line where a phase has one');
  state.obSel = { pid: 'release', kind: 'track', key: 'verify', track: 1 };
  html = V.process(ctx);
  assert.ok(/<section class="ob-lane sel"/.test(html) && /<input id="ob-tr-title"[^>]*value="Wrap-up">/.test(html) && /<select id="ob-tr-role" data-bound>/.test(html) && /data-act="ob-ask" data-id="track">Delete this lane/.test(html));
  assert.ok(/data-act="ob-done">Done<\/button>/.test(html), 'Done, for the phone\'s sheet');
  state.obSel = { pid: 'release', kind: 'phase', key: 'prep' }; state.obAsk = { kind: 'phase', key: 'prep' };
  html = V.process(ctx);
  assert.ok(/Delete Before production changes and its 6 steps, with its gate\? Undo brings it back\./.test(html) && /data-act="ob-gate-remove" data-id="prep">Remove this gate/.test(html));
});

rule('Draft editor: a page of its own, with a header landmark, and an inspector of Selected, Checks and Preview tabs', () => {
  const { ctx, state } = partsSetup();
  let html = V.process(ctx);
  assert.ok(/^<div class="fpe" id="fpe"><header class="fpe-head" role="region" aria-labelledby="ed-h"><div class="fpe-id"><button type="button" class="btn fpe-done" data-act="ed-done">/.test(html), 'only the editor, its header first');
  assert.ok(!/class="runhead"/.test(html), 'not the process page around it');
  assert.ok(/<h1 id="ed-h" tabindex="-1">Production release <span class="cat">Draft<\/span><\/h1>/.test(html) && /data-act="tl-undo" data-id="draft" aria-disabled="true"/.test(html) && /data-act="tl-redo" data-id="draft" aria-disabled="true"/.test(html) && /data-act="hist-open" data-id="draft"/.test(html) && /data-act="save-draft"/.test(html));
  assert.ok(/<div class="fpe-tabs" role="tablist" aria-label="Inspector">/.test(html) && /role="tab" id="ins-t-selected" aria-selected="false" aria-controls="ins-p-selected" tabindex="-1"/.test(html), 'a tablist');
  assert.ok(/id="ins-t-preview" aria-selected="true"[^>]*tabindex="0"/.test(html) && /role="tabpanel" id="ins-p-checks" aria-labelledby="ins-t-checks" tabindex="0" hidden/.test(html), 'nothing selected, nothing blocking: Preview');
  state.obSel = { pid: 'release', kind: 'step', key: 'pods' };
  html = V.process(ctx);
  assert.ok(/id="ins-t-selected" aria-selected="true"/.test(html) && /<li class="pv-sel" id="pv-sel" aria-current="true">/.test(html), 'Selected, and the preview marks the step');
  assert.ok(/<nav aria-label="Where it is"><ol class="ob-crumbs"><li>Deploy<\/li><li>Step 10 of 15<\/li><\/ol><\/nav>/.test(html) && /data-act="ob-sel" data-id="approve">Previous step/.test(html), 'where it is, and Previous / Next');
  assert.ok(/<details class="ob-src"><summary>Source details<\/summary><p class="small">Type <code>\{run\.command\}<\/code> · fields <code>command<\/code>/.test(html), 'the Markdown names in Source details');
  state.builder = false; html = V.process(ctx);
  assert.ok(!/ins-t-selected/.test(html) && /<textarea id="draft-editor"/.test(html) && /class="fpe-panes md"/.test(html), 'Markdown: the text and Checks / Preview');
});

rule('Draft editor: which inspector tab shows, and the Checks count', () => {
  const t = (st, sel, blockers, builder) => V.insTabOf(st, sel, blockers, builder !== false);
  assert.strictEqual(t({}, true, 0), 'selected', 'something selected');
  assert.strictEqual(t({}, false, 2), 'checks', 'nothing selected, something blocks');
  assert.strictEqual(t({}, false, 0), 'preview');
  assert.strictEqual(t({ insTabSaved: 'preview' }, false, 2), 'preview', 'the tab chosen before, in this browser');
  assert.strictEqual(t({ insTab: 'checks' }, true, 0), 'checks', 'a tab chosen while something is selected');
  assert.strictEqual(t({ insTab: 'selected' }, false, 1), 'selected', 'Selected when chosen, with its hint');
  assert.strictEqual(t({ insTabSaved: 'preview' }, true, 1), 'selected', 'selecting beats the remembered tab');
  assert.strictEqual(t({}, true, 0, false), 'preview', 'no Selected tab in Markdown');
  const { ctx, state } = partsSetup();
  state.editor.text = state.editor.base.replace('{#flags}', '');
  const html = V.process(ctx);
  assert.ok(/class="chipbtn fpe-checks bad"[^>]*aria-label="Checks: 1 thing to fix before publishing"><span class="fpe-checks-t">Checks <\/span><span class="cnt bad">1<\/span>/.test(html), 'red with a count when something blocks');
  assert.ok(/id="ins-t-checks" aria-selected="true"/.test(html));
});

rule('Draft editor: the parts fold to a rail of icons that keep their names for screen readers', () => {
  const { ctx, state } = partsSetup();
  assert.ok(/data-act="ob-rail" aria-expanded="true"/.test(V.process(ctx)));
  state.partsRail = true;
  const html = V.process(ctx);
  assert.ok(/class="fpe-panes rail"/.test(html) && /data-act="ob-rail" aria-expanded="false"/.test(html) && /title="Gate: Someone signs off to go on" data-tip="Gate"><span class="ob-pic g-gt"/.test(html));
});

rule('Draft editor: in an empty checklist, Step offers to add its phase too', () => {
  const { ctx, state } = partsSetup();
  state.editor.text = '---\nprocess: release\ntitle: Production release\n---\n';
  state.obPlace = { pid: 'release', part: 'step', at: null };
  assert.ok(/Nowhere to put a step\.<\/b> There are no phases yet\. Add a phase first\.<\/p><button type="button" class="btn go" data-act="ob-phase-with" id="ob-phase-with">Add a phase with this step/.test(V.process(ctx)));
});

rule('Preview keeps lanes as labeled groups, and keeps each step\'s labels and its gate sentence whole', () => {
  const { ctx, state } = partsSetup();
  state.insTab = 'preview';
  const html = V.process(ctx);
  assert.ok(/<div class="pv-lanes"><p class="pv-lanes-h">Do all lanes<\/p><div class="pv-lane"><p class="pv-lane-h">Product checks <span class="pv-role">@qa<\/span><\/p><ul>/.test(html), 'lanes as groups');
  assert.ok(/<span class="pv-copy">Smoke prompts return their expected answers<\/span><span class="pv-meta"><span class="badge b-must">Must do<\/span><span class="pv-role">@qa<\/span><\/span>/.test(html), 'copy, then labels');
  assert.ok(/<div class="g"><span class="ic"[^>]*>.*?<\/span><span class="pv-gate-copy">Gate: Deployed · approves <code>\^commit<\/code> running in \^environment<\/span><\/div>/.test(html), 'the gate as one sentence');
});

rule('Draft editor: empty and nothing-selected states say what to do next', () => {
  const { ctx, state } = partsSetup();
  state.insTab = 'selected';
  let html = V.process(ctx);
  assert.ok(/<div class="ob-nosel"><p><b>Nothing selected\.<\/b> Choose a step, lane, phase or gate/.test(html) && /<ul class="ob-sample" aria-hidden="true">/.test(html));
  state.editor.text = '---\nprocess: release\ntitle: Production release\n---\n';
  html = V.process(ctx);
  assert.ok(/<div class="ob-empty"><p><b>This checklist is empty\.<\/b>/.test(html) && /data-act="ob-add-phase">.*Add your first phase<\/button>/.test(html));
  assert.ok(/<details class="ob-help"><summary>Editing help<\/summary><p id="ob-kbd"/.test(html), 'keyboard help folded away');
  assert.ok(/class="linkish fpe-discard" data-act="revert-draft" data-id="release">Discard my changes/.test(html) && !/fpe-discard"[^>]* hidden/.test(html), 'Discard shows when there are changes');
});

/* ---------- The run workspace (1.13) ---------- */
const stripOf = html => html.slice(html.indexOf('<div class="rw-strip"'), html.indexOf('<div class="fpe-alerts'));
const nextOf = html => { const a = html.indexOf('<div class="rw-next"'); return html.slice(a, html.indexOf('<div class="rw-picker"', a)); };
const insOf = html => html.slice(html.indexOf('<aside class="fpe-pane rw-ins"'));
const rowOf = (html, id) => { const a = html.indexOf(' id="step-' + id + '"'); return html.slice(html.lastIndexOf('<li', a), html.indexOf('</li>', a)); };
function playPhase(r, pi) { const map = R.mapOf(r), dn = sampleDone(PF); map.phases[pi].steps.forEach(st => dn(r, map, st.id, 'person-casey', NOW)); R.pass(r, map, pi, 'person-casey', NOW); }

rule('Run workspace: the strip says who records, with the control that goes with it, and what this window saved, in every state', () => {
  const { r, ctx, state } = setup(r => { r.roles.qa = 'person-blake'; });
  let h = stripOf(V.run(ctx));
  assert.ok(/data-k="rec"/.test(h) && /<b>You're recording<\/b> · revision 0/.test(h) && /data-act="pick" data-kind="pause"/.test(h) && /data-act="pick" data-kind="handoff"[^>]*>.*Hand off/.test(h), 'recording here: Pause and Hand off beside it');
  assert.ok(/<span id="fresh" data-k="strip"><span class="small">Folder checked /.test(h), 'when the folder was checked');
  r.savedAt = NOW; assert.ok(/Saved here \d+:\d\d [AP]M · Folder checked/.test(stripOf(V.run(ctx))), 'saved here and folder checked are separate facts');
  state.pendingSaves = { [r.id]: 1 }; assert.ok(/<span class="rw-saving">Saving…<\/span>/.test(stripOf(V.run(ctx))), 'saving');
  state.pendingSaves = {}; state.unsaved[r.id] = r; state.saveErr[r.id] = 'The folder is offline.';
  h = stripOf(V.run(ctx));
  assert.ok(/Your last change isn't saved\./.test(h) && /data-act="retry-save">Try again/.test(h) && /data-act="discard-unsaved">Discard my change/.test(h) && !/Saved here/.test(h), 'a failed save replaces the reassurance');
  assert.ok(/The folder is offline\./.test(V.run(ctx)), 'and says why under the strip');
  delete state.unsaved[r.id];
  r._conflicts = ['run-PC (1).json'];
  assert.ok(/data-act="goto" data-id="rec-t">1 other version · Compare copies/.test(stripOf(V.run(ctx))) && /<h3 id="rec-t" tabindex="-1"/.test(V.run(ctx)), 'a persistent way to the comparison');
  r._conflicts = [];
  state.me = 'person-blake'; h = stripOf(V.run(ctx));
  assert.ok(/data-k="follow"/.test(h) && /Casey Nguyen is recording\.<\/b> You can add notes\./.test(h) && /data-act="pick" data-kind="takeover" data-id="recorder">Take over recording/.test(h), 'following, with take over second');
  state.pick = { kind: 'takeover', id: 'recorder' };
  assert.ok(/Take over from Casey Nguyen\? Only if they can't continue\./.test(stripOf(V.run(ctx))) && /data-act="takeover">Take over/.test(stripOf(V.run(ctx))), 'with the emergency confirmation');
  state.pick = null; state.me = 'person-casey'; r.recorder.session = 'other';
  h = stripOf(V.run(ctx));
  assert.ok(/You're recording in another window\.<\/b> This window is following\./.test(h) && /data-act="takeover">Record here/.test(h), 'the same person in another window');
  r.recorder.session = 'me'; R.handOff(r, 'person-blake', 'person-casey', NOW); state.me = 'person-blake';
  h = stripOf(V.run(ctx));
  assert.ok(/handed recording to you\.<\/b> Their last change hasn't reached this computer yet/.test(h) && !/data-act="pickup"/.test(h), 'a handoff still syncing can\'t be picked up');
  r.rev = r.recorder.handoff.rev;
  h = stripOf(V.run(ctx));
  assert.ok(/data-k="ready"/.test(h) && /Recording is waiting for you<\/b> · revision 1/.test(h) && /data-act="pickup">Pick up recording/.test(h), 'then it can');
});

rule('Run workspace: paused, ended, read-only and no-identity strips', () => {
  const { r, ctx, state } = setup();
  const map = R.mapOf(r);
  R.pause(r, 'Waiting for the change board', 'person-casey', NOW);
  let h = stripOf(V.run(ctx));
  assert.ok(/data-k="paused"/.test(h) && /Paused<\/b> by Casey Nguyen at .*: Waiting for the change board\. Steps, gates and timers wait until it's resumed; deadlines from other tools keep counting\./.test(h) && /data-act="resume"/.test(h), 'reason, who, when, and Resume for the recorder');
  state.me = 'person-blake'; h = stripOf(V.run(ctx));
  assert.ok(!/data-act="resume"/.test(h) && /data-act="pick" data-kind="takeover"/.test(h), 'others keep their way to take over');
  state.me = 'person-casey'; R.resume(r, 'person-casey', NOW); R.end(r, map, 'Cancelled', 'person-casey', 'Casey Nguyen', NOW);
  h = V.run(ctx);
  assert.ok(/data-k="ended"/.test(stripOf(h)) && /<b>Ended: Cancelled<\/b> by Casey Nguyen at/.test(h) && /class="btn go" data-act="receipt"/.test(stripOf(h)), 'ended: who, when, and the Receipt');
  assert.ok(!/data-act="(toggle|record)" data-id="[^"]+">/.test(h) && !/data-act="pick" data-kind="(pause|handoff|block)"/.test(h), 'no recording or completion controls');
  const ro = setup().ctx; ro.run()._unrunnable = 'This version uses checklist features this copy of Flightdeck doesn\'t understand. Update Flightdeck to run it.';
  h = V.run(ro);
  assert.ok(/data-k="ro"/.test(h) && /<b>Read-only in this copy\.<\/b> This version uses/.test(h) && !/data-act="(pickup|takeover|plan-from-run)"/.test(h), 'read-only: the reason, and no way to record');
  const nobody = setup(null, { me: '' });
  h = stripOf(V.run(nobody.ctx));
  assert.ok(/data-k="who"/.test(h) && /<b>Choose who you are<\/b>/.test(h) && /<select id="me-run"><option value="">Choose…<\/option><option value="person-avery">/.test(h), 'choosing who you are, inside the page');
});

rule('Run workspace: a slim header with progress in words, three named panes, and nothing from the old top-of-page layout', () => {
  const { r, ctx, state } = setup();
  playPhase(r, 0);
  const html = V.run(ctx);
  assert.ok(/^<div class="fpe rw" id="rw"><header class="fpe-head rw-head" role="region" aria-labelledby="run-h">/.test(html), 'the run is the page');
  assert.ok(/data-act="nav" data-id="runs">.*Runs<\/button>/.test(html) && /<h1 id="run-h" tabindex="-1">Release<\/h1><span class="small rw-sub">Production release · v1 · started/.test(html));
  assert.ok(/role="progressbar" aria-label="Steps answered" aria-valuemin="0" aria-valuemax="15" aria-valuenow="6" aria-valuetext="6 of 15 steps answered"><i style="width:40%"><\/i><\/span><b>6\/15<\/b><span class="small">answered<\/span>/.test(html), '6/14 answered, said in full for screen readers');
  assert.ok(/data-act="run-details" aria-expanded="false"/.test(html) && /data-act="receipt"/.test(html) && /<details class="rw-menu" data-disc="rw-menu"><summary class="mini">More<\/summary>/.test(html) && /data-act="finish">End run…/.test(html) && /You: <b>Casey Nguyen<\/b>/.test(html));
  assert.ok(/<nav class="fpe-pane rw-rail" aria-label="Phases">/.test(html) && /<section class="fpe-pane rw-list" id="rw-list" aria-label="Checklist">/.test(html) && /<aside class="fpe-pane rw-ins" id="rw-ins" data-open="false" aria-label="Selected step">/.test(html), 'named regions');
  assert.ok(/data-act="goto" data-id="phase-deploy" data-s="current" aria-current="step">/.test(html) && /class="rw-gate g-passed">.*Ready to deploy · Passed/.test(html) && /class="rw-gate g-open">.*Deployed · Waiting on steps/.test(html) && /class="rw-gate g-locked">/.test(html), 'the rail marks the current phase and each gate\'s state');
  assert.ok(/<select id="rw-phase" data-bound><option value="prep">1\. Before production changes · 6\/6 · Ready to deploy: passed<\/option><option value="deploy" selected>/.test(html), 'a compact Phases picker for narrower screens');
  assert.ok(/data-act="timeline" data-id="rail"/.test(html) && /data-act="timeline" data-id="picker"/.test(html) && /data-act="run-fu" data-id="picker"[^>]*>.*Follow-ups · 0/.test(html), 'timeline and follow-ups at every width');
  assert.ok(!/class="runhead"/.test(html) && !/class="headline"/.test(html), 'the old header and headline are gone');
  state.runDetails = true;
  assert.ok(/<section class="rw-details" id="rw-details"/.test(V.run(ctx)) && /data-act="edit" data-id="detail:commit"/.test(V.run(ctx)), 'Details holds every detail, editable by the recorder');
  r.roles = {}; r.recorder.person = 'person-casey';
  assert.ok(!/data-act="mission"/.test(V.run(ctx)), 'a solo run drops Screen share');
});

rule('Run workspace: rows are compact, with the check and the row as separate named controls; amber marks the run\'s place, the outline marks the selection', () => {
  const { r, ctx, state } = setup();
  playPhase(r, 0);
  let html = V.run(ctx), row = rowOf(html, 'merge');
  assert.ok(/^<li class="step next" data-a="open" id="step-merge"><button class="check" role="checkbox" aria-checked="false" aria-label="Merge the release branch to master, not checked, must do" data-act="toggle" data-id="merge">/.test(row), row);
  assert.ok(/<button class="s-pick" data-act="select" data-id="merge" aria-pressed="false" aria-controls="rw-ins"><span class="s-next">Next<\/span>/.test(row), 'selecting is its own control');
  assert.ok(/<span class="s-who">Casey Nguyen<\/span>/.test(row) && /<span class="badge b-must">Must do<\/span>/.test(row), 'who does it; must-do stays quiet');
  state.sel = 'pods'; html = V.run(ctx);
  assert.ok(/<li class="step sel" data-a="open" id="step-pods">/.test(html) && /<li class="step next" data-a="open" id="step-merge">/.test(html), 'browsing elsewhere never moves the run\'s marker');
  assert.ok(/data-act="select" data-id="pods" aria-pressed="true"/.test(html));
  R.block(r, R.mapOf(r), 'pods', 'Failed', 'person-casey', NOW);
  assert.ok(/<span class="badge b-stop">Blocked · Failed<\/span>/.test(rowOf(V.run(ctx), 'pods')), 'a block and its reason on the row');
});

rule('Run workspace: Next up only navigates, stays put while you browse, and follows the headline rules', () => {
  const { r, ctx, state } = setup();
  const map = R.mapOf(r);
  playPhase(r, 0);
  let n = nextOf(V.run(ctx));
  assert.ok(/Next up · Deploy · 4 to go, then the "Deployed" gate/.test(n) && /<b>Merge the release branch to master<\/b>/.test(n) && /data-act="goto" data-id="step-merge">Go to step/.test(n), n);
  assert.ok(!/data-act="(toggle|record|na|pick)"/.test(n), 'never a completion control');
  state.sel = 'merge'; assert.ok(/Selected<span class="rw-kbd"> · Space checks it<\/span>/.test(nextOf(V.run(ctx))));
  state.sel = 'approved'; n = nextOf(V.run(ctx));
  assert.ok(/<b>Merge the release branch to master<\/b>/.test(n) && /data-act="goto" data-id="step-merge">Back to it/.test(n), 'browsing an earlier step: the same next step, one click back');
  R.block(r, map, 'jenkins', 'Waiting on someone', 'person-casey', NOW);
  assert.ok(/data-act="goto" data-id="step-jenkins">Show blocked step/.test(nextOf(V.run(ctx))));
  R.clear(r, map, 'jenkins', 'person-casey', NOW);
  map.phases[1].steps.forEach(st => sampleDone(PF)(r, map, st.id, 'person-casey', NOW));
  n = nextOf(V.run(ctx));
  assert.ok(/data-k="gate ready"/.test(n) && /class="btn go" data-act="goto" data-id="gate-deployed">Review "Deployed"/.test(n), 'a ready gate leads to its own confirmation');
  R.pause(r, 'Lunch', 'person-casey', NOW);
  assert.ok(/data-k="paused"/.test(nextOf(V.run(ctx))) && /<b>Lunch<\/b>/.test(nextOf(V.run(ctx))) && /data-act="resume"/.test(nextOf(V.run(ctx))));
  R.resume(r, 'person-casey', NOW); R.pass(r, map, 1, 'person-casey', NOW); playPhase(r, 2);
  assert.ok(/data-act="finish">Finish the run/.test(nextOf(V.run(ctx))) && /class="btn go" data-act="finish">Finish the run/.test(V.run(ctx)), 'finishing is offered, never implied by the last check');
});

rule('Run workspace: choosing a step changes the whole inspector, and the selected step owns its Done', () => {
  const { r, ctx, state } = setup();
  playPhase(r, 0);
  r._notes = [{ id: 'n1', at: NOW, by: 'person-avery', step: 'jenkins', text: 'Queue is busy', files: [] }];
  state.sel = 'jenkins'; let ins = insOf(V.run(ctx));
  assert.ok(/data-scope="ref:jenkins"/.test(ins) && /<li>Deploy<\/li><li>Step 2 of 4<\/li>/.test(ins) && /<h2 id="ins-h" class="rw-ins-h" tabindex="-1">Start the production deploy job<\/h2>/.test(ins));
  assert.ok(/<b>Job:<\/b> web-app-deploy-prod/.test(ins) && /<code>TICKET=ABC-1 TAG=\(tag not set\)<\/code><button class="mini" data-act="copy"/.test(ins) && /Usually 25m/.test(ins), 'instructions, values with Copy, timing');
  assert.ok(/<h3 class="rw-h3" id="ins-rec">Record the result<\/h3>/.test(ins) && /id="rec-build"/.test(ins) && /data-act="pick" data-kind="fields" data-id="jenkins">/.test(ins), 'evidence and Fill in');
  assert.ok(/data-act="record" data-id="jenkins">.*Done<\/button>/.test(ins) && !/data-act="toggle" data-id="jenkins">/.test(ins), 'Done collects the evidence boxes showing');
  assert.ok(/Notes · 1/.test(ins) && /Queue is busy/.test(ins) && /<textarea id="note-text"/.test(ins), 'notes');
  assert.ok(!/data-act="na"/.test(ins), 'no N/A on a must-do step');
  assert.ok(/data-act="select" data-id="merge" data-nav="1">.*Previous<\/button><button class="mini" data-act="select" data-id="approve" data-nav="1">Next/.test(ins), 'Previous and Next');
  state.sel = 'pods'; ins = insOf(V.run(ctx));
  assert.ok(/Step 4 of 4/.test(ins) && /New pods stay up with no restarts/.test(ins) && /kubectl get pods/.test(ins) && !/web-app-deploy-prod/.test(ins) && !/Queue is busy/.test(ins) && !/id="rec-build"/.test(ins), 'nothing of the last step is left');
  state.sel = 'announce'; state.unfold = { prep: true };
  ins = insOf(V.run(ctx));
  assert.ok(!/data-act="(toggle|record|na|clear)" data-id="announce"/.test(ins) && !/data-mode="differently"/.test(ins), 'a step in a passed phase can\'t be changed');
  const two = setup(); two.state.sel = 'announce';
  ins = insOf(V.run(two.ctx));
  assert.ok(/class="btn go" data-act="record" data-id="announce">.*Done/.test(ins) && /id="rec-sent"/.test(ins) && /Link to the message \(optional\)/.test(ins), 'optional evidence showing is collected by Done');
  assert.ok(/data-act="pick" data-kind="block" data-id="announce">Blocked/.test(ins) && /data-act="na" data-id="announce">N\/A/.test(ins), 'then Blocked, then N/A on a step that isn\'t a must-do');
  two.state.sel = 'flags';
  assert.ok(/class="btn go" data-act="toggle" data-id="flags">.*Done/.test(insOf(V.run(two.ctx))), 'a plain confirm is one click');
  assert.ok(/<div class="cmd msg"><span>Starting the production release of aaa111 \(ABC-1\)/.test(ins), 'a message to post, with Copy');
  two.state.sel = 'announce'; sampleDone(PF)(two.r, R.mapOf(two.r), 'announce', 'person-casey', NOW);
  ins = insOf(V.run(two.ctx));
  assert.ok(/data-act="corr-open" data-mode="differently" data-id="announce">Did it differently\? Say how/.test(ins) && /data-act="toggle" data-id="announce">Uncheck/.test(ins), 'a done step can still say it was done differently');
});

rule('Run workspace: a gate says why it can\'t pass yet; a finished phase folds with its approval kept in view; a later one previews', () => {
  const { r, ctx, state } = setup();
  let html = V.run(ctx);
  assert.ok(/<button class="btn" disabled aria-describedby="gwhy-ready">Pass the gate<\/button><span class="small" id="gwhy-ready">6 unanswered steps<\/span>/.test(html), 'the disabled Pass explains itself');
  assert.ok(/data-act="unfold" data-id="deploy" aria-expanded="false" aria-controls="phase-deploy">Preview steps/.test(html), 'a later phase stays folded with Preview steps');
  playPhase(r, 0);
  html = V.run(ctx);
  assert.ok(/<div class="folded"><span>5 done · 1 N\/A<\/span>|<div class="folded"><span>6 done<\/span>/.test(html), 'a compact summary');
  assert.ok(/class="small g-rec">Passed by Casey Nguyen at \d+:\d\d [AP]M for commit aaa111 · environment production<\/div>/.test(html), 'the exact approval, kept with the folded phase');
  state.unfold = { prep: true };
  assert.ok(/data-act="fold" data-id="prep" aria-expanded="true" aria-controls="phase-prep">Hide steps/.test(V.run(ctx)));
  R.setDetail(r, R.mapOf(r), 'commit', 'bbb222', 'person-casey', NOW); state.unfold = {};
  html = V.run(ctx);
  assert.ok(/<section class="phase" id="phase-prep" data-s="open" data-cur="true"/.test(html) && /Needs review \(was passed\) by Casey Nguyen at \d+:\d\d [AP]M for commit aaa111 · environment production: commit changed/.test(html) && /id="gwhy-ready">2 unanswered steps</.test(html), 'a gate back in review comes back into view with its earlier approval');
});

rule('Run workspace: on a phone the selected step is a sheet with Close, Previous and Next; it stays shut until a step is chosen', () => {
  const { ctx, state } = setup(null, { sel: 'approved', refOpen: false });
  assert.ok(/<aside class="fpe-pane rw-ins" id="rw-ins" data-scope="ref:approved" data-open="false"/.test(V.run(ctx)));
  state.refOpen = true;
  const ins = insOf(V.run(ctx));
  assert.ok(/data-open="true"/.test(ins) && /<div class="rw-ins-top"><button class="mini close" data-act="close-ref">Close<\/button>/.test(ins) && /data-act="select" data-id="tests" data-nav="1">Next/.test(ins) && /data-act="to-row" data-id="approved">Back to the checklist/.test(ins), 'Close is not Done; Previous / Next; a way back');
  assert.ok(/<div class="rw-act" role="group" aria-label="Answer this step">/.test(ins), 'the answer controls in a group kept in reach');
});

rule('Run workspace: attachments show as thumbnails or named files with sizes, never as markup; waiting files list with Remove', () => {
  const base = 'runs/release/run1/files/';
  const { ctx, state } = setup(r => { r._notes = [{ id: 'n1', at: NOW, by: 'person-blake', step: 'approved', text: 'Logs', files: [base + '1-a-w-pods.png', base + '2-b-w-out.log', base + '3-c-w-book.pdf', base + '4-d-w-all.zip'], fileInfo: { [base + '2-b-w-out.log']: { name: '<img src=x onerror=alert(1)>.log', size: 48213 }, [base + '3-c-w-book.pdf']: { name: 'book.pdf', size: 1520331 } } }]; });
  state.sel = 'approved';
  ctx.attachments = (key, step) => step === 'approved' ? [{ id: 'p1', name: 'values.yaml', size: 512, kind: 'text' }] : [];
  const ins = insOf(V.run(ctx));
  assert.ok(/<button class="thumb" data-act="zoom-note" data-id="n1" data-i="0" aria-label="Open pods.png"/.test(ins), 'an image opens the viewer');
  assert.ok(/data-act="att-open" data-id="n1" data-from="note" data-path="runs\/release\/run1\/files\/2-b-w-out\.log" aria-label="Open &lt;img src=x onerror=alert\(1\)&gt;\.log, 47 KB">/.test(ins) && !/<img src=x/.test(ins), 'a text file opens as text; its name is escaped');
  assert.ok(/data-act="att-save"[^>]*data-path="[^"]*book\.pdf" aria-label="Save a copy of book\.pdf, 1\.4 MB">.*<span class="att-n">book\.pdf<\/span><span class="small">1\.4 MB<\/span><span class="att-do">Save<\/span>/.test(ins), 'a PDF saves a copy, with its name and size');
  assert.ok(/<span class="att-n">all\.zip<\/span><span class="att-do">Save<\/span>/.test(ins), 'a name from the path when the note has no details');
  assert.ok(/<ul class="att-list pending" aria-label="Waiting to attach"><li class="att">.*values\.yaml<\/span><span class="small">512 bytes<\/span><button class="mini" data-act="att-remove" data-id="p1" aria-label="Remove values\.yaml">Remove/.test(ins) && /Add note with 1 file/.test(ins));
  assert.ok(/<input type="file" id="note-file" accept="\.png,\.jpg,\.jpeg,\.webp,\.gif,\.pdf,\.zip,\.txt,\.log,\.md,\.csv,\.json,\.yaml,\.yml,[^"]*" multiple class="sr">/.test(ins) && /data-drop="note" data-id="approved"/.test(ins), 'Attach takes several files; the box takes drops');
  state.attErr = { key: 'note:approved', msg: '"x.svg" can\'t be attached.' };
  assert.ok(/<p class="ferr" role="alert" id="atterr-note:approved">&quot;x\.svg&quot; can&#39;t be attached\.<\/p>/.test(insOf(V.run(ctx))), 'a refusal is said next to the box');
  const tp = V.textPreview('out.log', base + '2-b-w-out.log', true, 400000, 'n1', 'note');
  assert.ok(/<pre class="tp-text" id="att-text" tabindex="0"><\/pre>/.test(tp) && /391 KB · showing the first 256 KB/.test(tp) && /role="dialog" aria-modal="true"/.test(tp), 'the text dialog starts empty; the text goes in as text');
});

rule('Screen share keeps who records, a pause, and each blocked or re-check reason in view', () => {
  const { r, ctx, state } = setup();
  playPhase(r, 0);
  R.block(r, R.mapOf(r), 'jenkins', 'Waiting on someone', 'person-casey', NOW);
  state.view = 'mission';
  let m = V.mission(ctx);
  assert.ok(/<div class="m-rec">Casey Nguyen is recording \(you, in this window\)<\/div>/.test(m) && /<li data-a="blocked">.*<span class="m-why">Blocked: Waiting on someone<\/span>/.test(m) && /data-act="exit-mission"/.test(m));
  R.clear(r, R.mapOf(r), 'jenkins', 'person-casey', NOW); R.pause(r, 'Lunch', 'person-casey', NOW);
  assert.ok(/Paused by Casey Nguyen: Lunch/.test(V.mission(ctx)));
});

rule('Run workspace: with Fill in open, Done is disabled with the reason beside it', () => {
  const { ctx } = setup(null, { sel: 'approved', pick: { kind: 'fields', id: 'approved' } });
  const ins = insOf(V.run(ctx));
  assert.ok(/<button class="btn go" disabled aria-describedby="donewhy-approved">.*Done<\/button>/.test(ins) && /id="donewhy-approved">Save or cancel Fill in first\./.test(ins));
  assert.ok(!/data-act="(toggle|record)" data-id="approved"/.test(ins));
});

rule('Run workspace: on a phone the More menu has Receipt too, Details can take focus, and the inspector\'s values wrap', () => {
  const { ctx, state } = setup();
  state.runDetails = true;
  const html = V.run(ctx);
  assert.ok(/class="mini rw-m-phone" data-act="receipt">/.test(html), 'Receipt in More');
  assert.ok(/<h2 id="rw-det-h" class="rw-h2" tabindex="-1">Details<\/h2>/.test(html));
  assert.ok(/<div class="rw-dock"><div class="rw-next"/.test(html), 'Next up and the picker share one pinned bar');
});

/* ---------- Folder health, the connection check, When something goes wrong (1.15) ---------- */
const H = PF.health, CN = PF.connection;
const RECOVERY = require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'recovery.md'), 'utf8');
function healthCtx(mut) {
  const { r, ctx, state } = setup(x => { x.title = 'Night <script>alert(1)</script>'; });
  ctx.releases = { list: [], version: '1.15.0', lastSeen: '1.15.0', fresh: false, newer: null };
  state.view = 'health'; state.fs = { kind: 'folder', name: 'Team <b>ops</b>' };
  r._conflicts = ['run-<img src=x onerror=alert(1)>.json'];
  ctx.data.drafts = []; ctx.data.stepTypes = { types: {}, errors: [] }; ctx.data.jira = { errors: [] }; ctx.data.unreadable = []; ctx.data.failed = {};
  const scan = { at: NOW, ms: 1200, files: 3, bytes: 900, longest: 30, areas: { runs: { files: 2, bytes: 800 }, '(top)': { files: 1, bytes: 100 } }, pubs: {}, list: [{ p: 'people.json', s: 100, m: Date.parse(NOW) }], unreadable: [], truncated: false, contractTexts: {}, installed: null, updates: [] };
  state.healthScan = { n: 1, scan, contract: null };
  ctx.health = full => H.check({ data: ctx.data, scan: full ? scan : null, me: state.me, app: '1.15.0' }, Date.parse(NOW));
  ctx.recovery = RECOVERY; ctx.writer = 'wme'; ctx.device = () => 'Windows · Edge'; ctx.findRun = k => (k === 'release/run1' ? r : null);
  if (mut) mut(ctx, state, r);
  return { ctx, state, r };
}
const buttons = html => (html.match(/<button[^>]*data-act="([^"]+)"/g) || []).length;

rule('Folder health: Needs action first, one button per problem, all clear after, and everything from files escaped', () => {
  const { ctx } = healthCtx();
  const html = V.health(ctx);
  assert.ok(/<h1 id="page-h" tabindex="-1">Folder health<\/h1>/.test(html));
  assert.ok(/class="hz-sum stop"/.test(html) && /1 thing needs action/.test(html));
  assert.ok(html.indexOf('Needs action · 1') < html.indexOf('All clear ·'), 'needs action comes first');
  const issues = html.match(/<li class="hz-issue[\s\S]*?<\/li><\/ul><\/section>|<li class="hz-issue[\s\S]*?<\/button><\/li>/g) || [];
  assert.ok(issues.length >= 1);
  issues.forEach(i => assert.strictEqual(buttons(i), 1, 'exactly one action: ' + i.slice(0, 120)));
  assert.ok(/data-act="open-run" data-id="release\/run1">Compare copies</.test(html));
  assert.ok(!/<script>alert|<img src=x/.test(html) && /Night &lt;script&gt;/.test(html) && /run-&lt;img src=x/.test(html), 'run titles and file names are escaped');
  assert.ok(/Team &lt;b&gt;ops&lt;\/b&gt;/.test(html), 'the folder name is escaped');
  assert.ok(/What's in the folder/.test(html) && /<code>top level<\/code>/.test(html), 'per-area counts');
  assert.ok(/data-act="connection"/.test(html) && /data-act="recovery" data-id=""/.test(html), 'links to the connection check and the guide');
});

rule('Folder health while checking shows progress, and an all-clear folder says so', () => {
  const busy = healthCtx((ctx, st) => { st.healthScan = null; st.healthBusy = true; st.healthFound = 340; ctx.health = () => null; });
  const h1 = V.health(busy.ctx);
  assert.ok(/Checking every file…/.test(h1) && /340 files found so far/.test(h1) && /data-act="health-again" disabled/.test(h1));
  const ok = healthCtx((ctx, st, r) => { r._conflicts = []; });
  const h2 = V.health(ok.ctx);
  assert.ok(/class="hz-sum ok"/.test(h2) && />All clear</.test(h2) && !/Needs action ·/.test(h2));
});

rule('Home says when the team folder needs attention, with one way to see it all', () => {
  const { ctx, state } = healthCtx(); state.view = 'home';
  const html = V.home(ctx);
  assert.ok(/The team folder needs attention/.test(html) && /data-act="health" data-id="">Open Folder health</.test(html));
  const calm = healthCtx((c, s, r) => { r._conflicts = []; }); calm.state.view = 'home';
  assert.ok(!/needs attention/.test(V.home(calm.ctx)));
});

rule('Settings links to Folder health, the connection check and the guide; the top bar\'s can\'t-read state says what to do', () => {
  const { ctx, state } = healthCtx(); state.view = 'settings';
  const set = V.settings(ctx);
  assert.ok(/data-act="health">Check folder health/.test(set) && /data-act="connection"/.test(set) && /data-act="recovery" data-id="">When something goes wrong/.test(set));
  state.folderErr = 'NotReadableError';
  assert.ok(/can't read it<\/span><button[^>]*data-act="refresh"[^>]*>Refresh<\/button><button class="mini" data-act="recovery" data-id="onedrive-isnt-syncing">What to do/.test(V.top(ctx)));
  state.folderErr = null; state.fs = null; state.needsReconnect = { dir: { name: 'Ops' } };
  assert.ok(/data-id="flightdeck-lost-access-to-the-folder">What to do/.test(V.top(ctx)));
});

rule('A run file that can\'t be read is listed on Runs, part of a folder that can\'t be read is said, and drafts sharing a process are named', () => {
  const { ctx, state } = healthCtx(c => { c.data.unreadable = [{ path: 'runs/release/<b>x</b>/run.json', key: 'release/x', why: 'isn\'t complete JSON' }]; c.data.failed = { skills: 'NotReadableError' }; });
  state.view = 'runs';
  const html = V.runs(ctx);
  assert.ok(/A run file can't be read/.test(html) && /runs\/release\/&lt;b&gt;x&lt;\/b&gt;\/run\.json/.test(html) && /data-id="a-file-cant-be-read"/.test(html));
  assert.ok(/Part of the team folder couldn't be read<\/b> \(skills\)/.test(html));
});

rule('Connection check: waiting, answered with a timed route, hints after 3 minutes, and a fixed Send button', () => {
  const sent = Date.parse(NOW);
  const probe = { _file: 'probe-x', id: 'p1', writer: 'wme', by: 'person-casey', at: NOW, seen: [] };
  const ack = { _file: 'ack-p1.wb.json', probe: 'p1', writer: 'wb', by: 'person-blake', device: 'Mac <i>Chrome</i>', at: new Date(sent + 33000).toISOString(), firstSeenAt: new Date(sent + 32000).toISOString(), run: { key: 'release/run1', rev: 3 }, folderReadAt: NOW };
  const { ctx, state } = healthCtx((c, st) => {
    st.view = 'connection';
    st.connSent = [{ file: 'probe-x', id: 'p1', n: 1, at: sent, run: { key: 'release/run1', rev: 3 } }, { file: 'probe-y', id: 'p2', n: 2, at: sent - 200000, run: null }];
    st.conn = { probes: [probe, { _file: 'probe-z', id: 'p3', writer: 'wb', by: 'person-blake', device: 'Mac · Chrome', at: NOW, n: 5, seen: [] }], acks: [ack] };
    st.connSeen = { 'ack-p1.wb.json': sent + 64000 };
    c.now = () => sent + 70000;
  });
  const html = V.connection(ctx);
  assert.ok(/<h1 id="page-h" tabindex="-1">Connection check<\/h1>/.test(html));
  assert.ok(/class="cx-route"/.test(html) && /Sent here/.test(html) && /Seen by Blake Ortiz/.test(html) && /Answer here/.test(html));
  assert.ok(/Blake Ortiz · Mac &lt;i&gt;Chrome&lt;\/i&gt; saw check 1 at [^<]+ on their clock, 32 s after you sent it\./.test(html), 'in words');
  assert.ok(!/<i>Chrome/.test(html), 'device names are escaped');
  assert.ok(/They have &quot;Night &lt;script&gt;/.test(html) && /the same as you/.test(html), 'run titles escaped in the comparison');
  assert.ok(/No answer after 4 min 30 s/.test(html) && /Is OneDrive running there/.test(html), 'hints after 3 minutes');
  assert.ok(/class="cx-foot"/.test(html) && /data-act="conn-send">[\s\S]*Send another check/.test(html));
  assert.ok(/sent check 5 at/.test(html) && /Checks from other computers · 1/.test(html), 'checks from others listed');
  assert.ok(!/synced|everyone/i.test(html.replace(/<[^>]+>/g, ' ')), 'never "synced" or "everyone"');
  state.me = '';
  assert.ok(/data-act="conn-send" disabled/.test(V.connection(ctx)) && /Choose who you are at the top right first/.test(V.connection(ctx)));
  state.fs = { kind: 'memory', name: 'Examples' };
  assert.ok(/only another tab of this browser can answer/.test(V.connection(ctx)));
});

rule('Another computer\'s check offers one-click Answer on other pages, never on the Connection check page itself', () => {
  const p = { _file: 'probe-20261017T210000Z-p1.wb.json', id: 'p1', writer: 'wb', by: 'person-blake', device: 'Mac <b>Chrome</b>', at: NOW, seen: [] };
  const { ctx, state } = healthCtx((c, st) => { c.connPending = () => [p]; st.view = 'home'; });
  const home = V.home(ctx);
  assert.ok(/class="notice cx-ask"/.test(home) && /Blake Ortiz is checking the connection<\/b> from Mac &lt;b&gt;Chrome&lt;\/b&gt;/.test(home));
  assert.ok(/data-act="conn-answer" data-id="probe-20261017T210000Z-p1\.wb\.json">Answer</.test(home) && /data-act="conn-dismiss"/.test(home));
  state.view = 'run';
  assert.ok(/data-act="conn-answer"/.test(V.run(ctx)), 'the run screen too');
  state.view = 'connection';
  assert.ok(!/data-act="conn-answer"/.test(V.connection(ctx)), 'that page answers by itself');
  state.view = 'home'; state.me = '';
  assert.ok(!/data-act="conn-answer"/.test(V.home(ctx)) && /Choose who you are to answer/.test(V.home(ctx)));
});

rule('When something goes wrong shows every section of docs/recovery.md with its anchor, and links stay inside the app', () => {
  const { ctx, state } = healthCtx((c, st) => { st.view = 'recovery'; st.recoveryAt = 'a-run-has-conflict-copies'; st.recBack = { label: 'Back to the run' }; });
  const html = V.recoveryPage(ctx), doc = H.sections(RECOVERY);
  doc.list.forEach(s => assert.ok(html.indexOf('id="rv-' + s.id + '"') >= 0 && html.indexOf('id="rv-h-' + s.id + '"') >= 0, s.id));
  assert.ok(/class="panel rv-sec on" id="rv-a-run-has-conflict-copies"/.test(html), 'the section asked for is marked');
  assert.ok(/<ol><li>Open the run and choose <strong>Compare<\/strong>/.test(html), 'numbered steps are a list');
  assert.ok(/<button type="button" class="linkish" data-act="recovery" data-id="onedrive-isnt-syncing">OneDrive isn&#39;t syncing<\/button>/.test(html), 'a link to another section stays in the app');
  assert.ok(/Updating Flightdeck \(<code>docs\/updating\.md<\/code>\)/.test(html), 'a link to another document names it');
  assert.ok(/id="rv-back"[^>]*>[\s\S]*Back to the run</.test(html));
  assert.ok(!/<a href="updating/.test(html));
});

rule('The run\'s conflict copies and its More menu lead to the guide and to Folder health', () => {
  const { r, ctx } = setup(); r._conflicts = ['run-PC.json'];
  const html = V.run(ctx);
  assert.ok(/data-act="recovery" data-id="a-run-has-conflict-copies">What to do</.test(html));
  assert.ok(/data-act="health">Folder health</.test(html));
});

/* ---------- Getting started and Settings, People (1.15) ---------- */
rule('Setup: the welcome offers Start, Join and the examples, and a browser that can\'t open folders can only look around', () => {
  const { ctx, state } = setup(null, { view: 'home', me: '' });
  let html = V.setup(ctx);
  ['start', 'join', 'examples'].forEach(id => assert.ok(new RegExp('data-act="setup-mode" data-id="' + id + '"').test(html), id));
  assert.ok(!/Choose who you are at the top right/.test(html), 'no who-are-you nag on the welcome');
  ctx.canFolder = false; html = V.setup(ctx);
  assert.ok(/data-id="start" disabled/.test(html) && /data-id="join" disabled/.test(html) && !/data-id="examples" disabled/.test(html));
  assert.ok(/can't open folders/.test(html));
});

rule('Setup: the people step shows each ID before anything is written, -2 on a clash, the backup choice and the honest promise', () => {
  const { ctx, state } = setup(null, { view: 'setup', me: '' });
  state.setup = { mode: 'start', step: 'people', dirName: 'Team <b>', tested: true, me: { name: 'Riley Park', email: '' }, team: [{ k: 't1', name: 'Sam Fox', email: '' }, { k: 't2', name: 'Sam Fox', email: '' }, { k: 't3', name: '', email: '' }], backup: 't2' };
  ctx.setupProgress = () => PF.setup.progress({});
  const html = V.setup(ctx);
  assert.ok(/Saved as <code>person-riley-park<\/code>/.test(html) && /person-sam-fox<\/code>/.test(html) && /person-sam-fox-2<\/code>/.test(html));
  assert.ok(/<option value="t2" selected>Sam Fox \(person-sam-fox-2\)<\/option>/.test(html) && !/value="t3"/.test(html), 'only named teammates can be backup');
  assert.ok(html.indexOf(PF.util.esc(V.PROMISE)) > 0 && /They aren't security/.test(V.PROMISE) && /set by how you share it in OneDrive/.test(V.PROMISE));
  assert.ok(/Team &lt;b&gt;/.test(html), 'the folder name is escaped');
  assert.strictEqual((html.match(/<li class="done/g) || []).length, 1, 'before the folder is created, only the tested folder is done');
  assert.ok(/for="su-me-name"/.test(html) && /for="su-name-t1"/.test(html) && /for="su-backup"/.test(html), 'every box is labeled');
});

rule('Setup: Who are you lists active people only, and the request for someone not listed names the folder owner', () => {
  const { ctx, state } = setup(null, { view: 'setup', me: '', fs: { kind: 'folder', name: 'Team' } });
  ctx.data.people = people.map(p => p.id === 'person-morgan' ? Object.assign({}, p, { inactive: true }) : p);
  ctx.peopleById = Object.fromEntries(ctx.data.people.map(p => [p.id, p]));
  state.setup = { mode: 'join', step: 'who', request: { name: 'Jordan <x>' } };
  const html = V.setup(ctx);
  assert.ok(/data-act="setup-who" data-id="person-avery"/.test(html) && !/data-id="person-morgan"/.test(html));
  assert.ok(/Ask Avery Lee to add you/.test(html) && /Hi Avery,/.test(html) && /Name: Jordan &lt;x&gt;/.test(html));
});

rule('Settings, People: the folder owner gets Add a person and per-person changes; anyone else sees who to ask', () => {
  const { ctx, state } = setup(null, { view: 'settings', me: 'person-avery' });
  let html = V.peoplePanel(ctx);
  assert.ok(/id="people-add-form"/.test(html) && /Folder owner/.test(html) && /Backup owner/.test(html));
  assert.ok(/data-act="people-active" data-id="person-casey"/.test(html) && !/data-act="people-active" data-id="person-avery"/.test(html), 'never yourself');
  assert.ok(/data-act="people-backup" data-id="person-casey"/.test(html) && !/data-act="people-backup" data-id="person-blake"/.test(html));
  assert.ok(!/data-act="[^"]*(delete|remove)/.test(html), 'nobody is ever deleted');
  state.peopleAdd = { name: 'Casey' };
  assert.ok(/person-casey-2/.test(V.peoplePanel(ctx)), 'the new ID is shown before saving');
  state.me = 'person-casey';
  html = V.peoplePanel(ctx);
  assert.ok(!/people-add-form|data-act="people-/.test(html));
  assert.ok(/Avery Lee \(folder owner\) and Blake Ortiz \(backup owner\) change this list/.test(html));
});

rule('Home: Getting started counts the steps done and offers the next one; finished, it says the team is set up', () => {
  const { ctx } = setup(null, { view: 'home' });
  ctx.setupCard = () => PF.setup.progress({ folder: true, people: PF.people.clean(people).filter(p => p.id !== 'person-avery'), me: 'person-blake', processes: [], runs: [], answers: [] });
  let html = V.home(ctx);
  assert.ok(/Getting started · 1 of 5/.test(html), 'without a folder owner, people isn\'t done');
  ctx.setupCard = () => PF.setup.progress({ folder: true, people: PF.people.clean(people), me: 'person-avery', processes: [], runs: [], answers: [] });
  html = V.home(ctx);
  assert.ok(/Getting started · 2 of 5/.test(html) && /data-act="setup-continue" data-id="checklist"/.test(html) && /aria-valuenow="2"/.test(html));
  ctx.setupCard = () => ({ complete: true, steps: [], count: 5, total: 5 });
  assert.ok(/Your team is set up/.test(V.home(ctx)));
  ctx.setupCard = () => null;
  assert.ok(!/Getting started/.test(V.home(ctx)));
});

rule('Setup: every step in the stepper has a full accessible name, even on a phone where only the current label shows', () => {
  const { ctx, state } = setup(null, { view: 'setup', fs: { kind: 'folder', name: 'Team' } });
  state.setup = { mode: 'start', step: 'run', created: true, me: { name: '', email: '' }, team: [], backup: '' };
  ctx.setupProgress = () => { const g = PF.setup.progress({}); g.steps[0].done = g.steps[1].done = g.steps[2].done = true; return g; };
  const html = V.setup(ctx);
  assert.ok(/data-act="setup-step" data-id="people" aria-label="Step 2 of 5: People, done"/.test(html), html.slice(html.indexOf('su-steps'), html.indexOf('su-steps') + 600));
  assert.ok(/aria-current="step" aria-label="Step 4 of 5: First run, current"/.test(html));
  assert.ok(/aria-label="Step 5 of 5: Second computer, not done yet"/.test(html));
});

rule('Setup and Settings: people with the same name are told apart in every picker', () => {
  const { ctx, state } = setup(null, { view: 'setup', me: '' });
  state.setup = { mode: 'start', step: 'people', tested: true, dirName: 'T', me: { name: 'Riley', email: '' }, team: [{ k: 't1', name: 'Sam Fox', email: 'sam@example.com' }, { k: 't2', name: 'Sam Fox', email: '' }], backup: '' };
  ctx.setupProgress = () => PF.setup.progress({});
  const html = V.setup(ctx);
  assert.ok(/<option value="t1">Sam Fox \(sam@example\.com\)<\/option>/.test(html) && /<option value="t2">Sam Fox \(person-sam-fox-2\)<\/option>/.test(html), html.slice(html.indexOf('su-backup'), html.indexOf('su-backup') + 400));
  const two = people.concat([{ id: 'person-avery-2', name: 'Avery Lee', email: '' }]);
  const s2 = setup(null, { view: 'setup', me: 'person-casey', fs: { kind: 'folder', name: 'T' } });
  s2.ctx.data.people = two; s2.ctx.peopleById = Object.fromEntries(two.map(p => [p.id, p]));
  s2.state.setup = { mode: 'start', step: 'second', created: true, me: {}, team: [], to: '' };
  s2.ctx.setupProgress = () => PF.setup.progress({}); s2.ctx.processes = () => []; s2.ctx.releases = { list: [], version: 'dev' };
  assert.ok(/>Avery Lee \(avery@example\.com\)<\/option>/.test(V.setup(s2.ctx)) && />Avery Lee \(person-avery-2\)<\/option>/.test(V.setup(s2.ctx)), 'who is opening it');
  assert.ok(/>Avery Lee \(person-avery-2\)<\/option>/.test(V.top(s2.ctx)), 'the top bar\'s You are');
});


/* ---------- What became of follow-ups (1.16) ---------- */
function fuSetup(stateExtra) {
  const env = setup(r => {
    R.addFollowUp(r, { id: 'fu1', text: 'Fix <img src=x onerror=alert(1)> on the jump box', owner: 'person-casey', ticket: 'ABC-<b>1</b>' }, 'person-casey', '2026-08-01T10:00:00.000Z');
    R.addFollowUp(r, { id: 'fu2', text: 'Ask for a window', owner: 'person-blake' }, 'person-casey', NOW);
    R.addFollowUp(r, { id: 'fu3', text: 'Rotate the password', owner: 'person-casey' }, 'person-casey', NOW);
  }, stateExtra);
  env.ctx.data.fuDecisions = [];
  env.ctx.findRun = k => k === 'release/run1' ? env.r : null;
  return env;
}
const fuDecide = (ctx, id, by, status, o, writer) => {
  const F = PF.followups, x = F.list(ctx.data.runs, ctx.data.fuDecisions).filter(y => y.id === id)[0];
  const d = F.decision(x, by, status, o, NOW, x.decision);
  ctx.data.fuDecisions.push(Object.assign(JSON.parse(JSON.stringify(d)), { _file: F.fileName(d, writer || 'w1') }));
};

rule('Home lists your open follow-ups however old, drops resolved ones, and escapes what they say', () => {
  const { ctx, r, state } = fuSetup({ view: 'home' });
  r.ended = { at: '2026-08-01T11:00:00.000Z', outcome: 'Completed', by: 'person-casey' };
  let html = V.home(ctx);
  assert.ok(/Your follow-ups · 2/.test(html), 'both of Casey\'s, the one from August included');
  assert.ok(/open 77 days/.test(html), 'with how long it has been open');
  assert.ok(!/<img src=x/.test(html) && /Fix &lt;img src=x onerror=alert\(1\)&gt;/.test(html) && /ABC-&lt;b&gt;1&lt;\/b&gt;/.test(html), 'escaped');
  assert.ok(!/Ask for a window/.test(html), 'only yours');
  assert.ok(/All open follow-ups · 3/.test(html));
  fuDecide(ctx, 'fu1', 'person-blake', 'wont', { reason: 'The <script> is gone' });
  html = V.home(ctx);
  assert.ok(/Your follow-ups · 1/.test(html) && !/jump box/.test(html), 'a resolved one drops off');
  state.me = null;
  assert.ok(!/Your follow-ups/.test(V.home(ctx)));
});

rule('Follow-up actions are named for their follow-up, and the open form labels its boxes and ties errors to them', () => {
  const { ctx, state } = fuSetup({ view: 'followups' });
  let html = V.followUpsPage(ctx);
  assert.ok(/<h1 id="page-h" tabindex="-1">Follow-ups<\/h1>/.test(html) && /Open · 3/.test(html));
  assert.ok(/role="group" aria-label="What became of it: Ask for a window"/.test(html), 'the actions are a named group');
  ['done', 'ticket', 'moved', 'wont'].forEach(k => assert.ok(new RegExp('data-act="fu-pick" data-id="release/run1/fu2" data-status="' + k + '" aria-expanded="false"').test(html), k));
  assert.ok(/data-act="open-run" data-id="release\/run1">Release<\/button>/.test(html), 'each links to its run');
  // The form's IDs belong to its follow-up; read them here as fud-… to check the markup.
  const B = PF.followups.formId('release/run1/fu2'), N = h => h.split(B).join('fud');
  state.fuPick = { key: 'release/run1/fu2', status: 'wont' }; state.fieldErr = { id: B + '-reason', msg: 'Why won\'t it be done? Say why.' };
  html = N(V.followUpsPage(ctx));
  assert.ok(/data-status="wont" aria-expanded="true" aria-controls="fud-form"/.test(html));
  assert.ok(/<div class="fu-form" id="fud-form" role="group" aria-labelledby="fud-h">/.test(html));
  assert.ok(/<label class="field" for="fud-reason">Why won't it be done\?<input id="fud-reason" maxlength="300" aria-invalid="true" aria-describedby="fud-reason-hint ferr-fud-reason"/.test(html), 'labeled, invalid, described by its hint and its error');
  assert.ok(/<p class="ferr" id="ferr-fud-reason" role="alert">Why won&#39;t it be done\? Say why\.<\/p>/.test(html));
  state.fuPick = { key: 'release/run1/fu2', status: 'moved' }; state.fieldErr = null;
  html = N(V.followUpsPage(ctx));
  assert.ok(/<label class="field" for="fud-to">The run or plan it moved to<select id="fud-to">/.test(html) && /for="fud-link">Or a link \(optional\)/.test(html));
  assert.ok(!/<option value="release\/run1">/.test(html), 'never the run it came from');
  state.me = null;
  assert.ok(!/data-act="fu-pick"/.test(V.followUpsPage(ctx)) && /Choose who you are/.test(V.followUpsPage(ctx)), 'deciding needs to know who you are');
});

rule('Follow-ups page: Open, Yours and All; a resolved one shows what became of it with safe links, and Reopen', () => {
  const { ctx, state } = fuSetup({ view: 'followups' });
  fuDecide(ctx, 'fu2', 'person-blake', 'done', { link: 'https://example.com/pr/9', note: 'Merged <b>it</b>' });
  fuDecide(ctx, 'fu3', 'person-blake', 'moved', { to: 'release/run1x', link: '' }, 'w2');
  let html = V.followUpsPage(ctx);
  assert.ok(/Open · 1/.test(html) && !/Ask for a window/.test(html));
  state.fuFilter = 'mine';
  assert.ok(/Open and yours · 1/.test(V.followUpsPage(ctx)));
  state.fuFilter = 'all';
  html = V.followUpsPage(ctx);
  assert.ok(/Every follow-up · 3/.test(html));
  assert.ok(/<span class="pill passed">Done<\/span>/.test(html) && /Done: Merged &lt;b&gt;it&lt;\/b&gt; · <a href="https:\/\/example.com\/pr\/9" target="_blank" rel="noopener noreferrer">/.test(html));
  assert.ok(/<span class="pill waived">Moved to another run<\/span>/.test(html) && /Moved to release\/run1x/.test(html), 'a run not in the folder is named, not linked');
  assert.ok(/data-act="fu-reopen" data-id="release\/run1\/fu2">Reopen<\/button>/.test(html));
  // Two decisions at the same rev: Needs review, still open, with every action.
  fuDecide(ctx, 'fu1', 'person-blake', 'done', {}, 'wa');
  ctx.data.fuDecisions.push(Object.assign({}, ctx.data.fuDecisions[ctx.data.fuDecisions.length - 1], { status: 'wont', reason: 'No', _file: 'run1.fu1.wb.1.json' }));
  state.fuFilter = 'open';
  html = V.followUpsPage(ctx);
  assert.ok(/<span class="pill review">Needs review<\/span>/.test(html) && /Two people decided at once\. Decide again\./.test(html));
  assert.ok(/data-id="release\/run1\/fu1" data-status="done"/.test(html) && /data-act="fu-reopen" data-id="release\/run1\/fu1"/.test(html));
});

rule('The run\'s Follow-ups, the finish page and the receipt show each follow-up\'s status', () => {
  const { ctx, state } = fuSetup();
  fuDecide(ctx, 'fu2', 'person-blake', 'ticket', { ticket: 'ABC-77' });
  state.fuOpen = true;
  let html = V.run(ctx);
  assert.ok(/id="rw-fu"/.test(html) && /<span class="pill waived">Moved to a ticket<\/span>/.test(html) && /Moved to <span class="cat">ABC-77<\/span>/.test(html));
  assert.ok(/data-act="remove-followup" data-id="fu1" aria-label="Remove follow-up: Fix &lt;img/.test(html), 'the recorder can still remove one');
  state.view = 'finish';
  html = V.finish(ctx);
  assert.ok(/<span class="pill open">Open<\/span>/.test(html) && /Moved to a ticket/.test(html) && !/data-act="fu-pick"/.test(html), 'statuses, no deciding while finishing');
  html = V.receipt(ctx);
  assert.ok(/<span class="pill waived">Moved to a ticket<\/span>/.test(html) && /Ask for a window \([^)]+\) · Moved to ABC-77/.test(html), 'card and text');
});

rule('Saved history: a step type entry with a malformed definition still draws, and says it couldn\'t be read', () => {
  const { ctx } = setup(), TL = PF.timeline;
  const e = TL.cleanEntry({ v: 1, kind: 'type-edit', id: 't1', type: 'risk.call', writer: 'w1', seq: 1, from: null, to: 'abcdef01', units: ['Changed'], before: { id: 'risk.call', label: { x: 1 } }, after: { id: 'risk.call', label: 'B' } }, 'w1.jsonl');
  let h;
  assert.doesNotThrow(() => { h = V.historyDrawer(ctx, { scope: 'type', tl: TL.create(), mode: 'saved', saved: { state: 'ok', items: TL.refs([{ entry: e }]) }, compare: TL.refs([{ entry: e }])[0].entry.ref }); });
  assert.ok(/couldn.t be read/.test(h));
});

/* ---------- 1.17: Runs shows 50 at a time ---------- */
function manyRuns(running, ended) {
  const { r, ctx, state } = setup();
  const runs = [];
  for (let i = 0; i < running + ended; i++) {
    const x = JSON.parse(JSON.stringify(r)); x.id = 'r' + i; x.title = 'Run ' + i; x._notes = []; x._conflicts = [];
    if (i >= running) { x.state = 'completed'; x.ended = { outcome: 'Completed', at: new Date(Date.parse(NOW) - i * 60000).toISOString() }; }
    runs.push(x);
  }
  ctx.data.runs = runs; state.view = 'runs'; state.filter = 'all'; ctx.fuList = () => []; V.fuList = V.fuList || (() => []);
  return { ctx, state };
}
const cards = html => (html.match(/class="card" data-act="open-run"/g) || []).length;

rule('Runs: the first view shows at most 50 running and 50 finished runs, says how many there are, and Show 50 more adds 50', () => {
  const { ctx, state } = manyRuns(70, 1950);
  let html = V.runs(ctx);
  assert.strictEqual(cards(html), 100, 'at most 100 cards on the first view');
  assert.ok(/Showing 50 of 1,950/.test(html) && /Showing 50 of 70/.test(html));
  assert.ok(/<button class="btn" data-act="more" data-id="runs-ended"[^>]*>Show 50 more<\/button>/.test(html));
  assert.ok(/data-act="more" data-id="runs-running"[^>]*>Show 20 more</.test(html), 'says how many more when it\'s fewer than 50');
  state.more = { 'runs-ended': 100 };
  html = V.runs(ctx);
  assert.strictEqual(cards(html), 150); assert.ok(/Showing 100 of 1,950/.test(html));
  // Newest first, and the next page continues where the first stopped.
  assert.ok(html.indexOf('data-id="release/r70"') < html.indexOf('data-id="release/r71"'));
});

rule('Runs: a short list has no paging line, and growing to 500 cards still renders quickly', () => {
  const small = manyRuns(3, 10);
  const h = V.runs(small.ctx);
  assert.ok(!/Showing \d/.test(h) && !/data-act="more"/.test(h) && cards(h) === 13);
  const { ctx, state } = manyRuns(0, 1950);
  state.more = { 'runs-ended': 500 };
  const t = process.hrtime.bigint(); const html = V.runs(ctx); const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.strictEqual(cards(html), 500);
  assert.ok(ms <= 250, 'rendered 500 cards in ' + ms.toFixed(0) + ' ms');
});

run();
