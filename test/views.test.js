// The screens, rendered without a browser: what a run file or a failed save can make them show.
'use strict';
const assert = require('assert');
const { completeRun, exactOf, loadViews, example, exampleSetup, rule, run, sampleDone } = require('./harness');
const PF = loadViews(), R = PF.run, P = PF.publish, V = PF.views;
const EX = exampleSetup(PF);
const NOW = '2026-10-17T21:00:00.000Z';
const people = JSON.parse(example('people.json'));

function setup(mutateRun, stateExtra) {
  const b = P.build(example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'view0001' });
  const pub = P.verify(b.folder, b.files, exactOf(PF, b.files));
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
  const r = R.create(P.verify(b.folder, b.files, exactOf(PF, b.files)), { title: 'T', details: { ticket: 'ABC-1', commit: 'c0ffee1', environment: 'production' }, roles: { 'release-lead': 'person-casey', qa: 'person-blake', backend: 'person-avery' }, by: 'person-casey', session: 'me', now: NOW, workflows: EX.workflows });
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
    const section = view === 'skills' || view === 'types' ? 'processes' : view;
    assert.ok(new RegExp('data-id="' + section + '" aria-current="page"').test(V.top(ctx)), view + ' lights ' + section);
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

rule('While a folder\'s first read is under way, Home and Runs say so with counts, and never say there\'s nothing', () => {
  const { ctx, state } = setup();
  ctx.processes = () => []; ctx.data.runs = []; ctx.data.plans = []; ctx.data.legacy = []; state.filter = 'all';
  state.reading = { done: 640, total: 2000 };
  const home = V.home(ctx), runs = V.runs(ctx);
  assert.ok(/<b>Still reading runs \(640 of 2,000\)\.<\/b> Runs you(&#39;|')re recording may not be listed yet\./.test(home), 'Home');
  assert.ok(!/Nothing needs you right now/.test(home) && /Still reading the team folder\./.test(home));
  assert.ok(/<span class="big">…<\/span><span>processes<\/span>/.test(home), 'counts not known yet aren\'t shown as 0');
  assert.ok(/Still reading runs \(640 of 2,000\)/.test(runs) && !/Nothing is running|No finished runs yet/.test(runs), 'Runs');
  state.reading = { done: 0, total: null };
  assert.ok(/<b>Still reading runs\.<\/b>/.test(V.home(ctx)), 'before the runs are listed, no counts');
  state.reading = null;
  assert.ok(!/Still reading/.test(V.home(ctx) + V.runs(ctx)) && /Nothing is running/.test(V.runs(ctx)), 'done');
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
  const v1 = ctx.data.processes[0].index.latest, v2 = P.verify(b2.folder, b2.files, exactOf(PF, b2.files));
  const proc = { id: 'release', title: 'Production release', category: 'Releases', latest: v2, all: [v2, v1], clashes: [], broken: [], skills: [], draft: null };
  ctx.processes = () => [proc]; ctx.suggestRole = () => null;
  ctx.data.plans = [{ id: 'plan-1', process: 'release', version: 1, title: 'Planned', details: { ticket: 'ABC-9' }, roles: {}, by: 'person-blake', _hash: 'h1', _sha: 's1' }];
  state.view = 'start'; state.processId = 'release'; state.planId = 'plan-1';
  let html = V.start(ctx);
  assert.ok(/This plan was made for v1\. v2 is now published\./.test(html), 'says which version and what is newer');
  assert.ok(/data-act="plan-diff"[^>]*>See what changed/.test(html) && /data-act="plan-latest" data-id="plan-1">Switch to v2/.test(html));
  assert.ok(html.includes('data-folder="' + v1.info.folder + '"'), 'the form starts v1 until switched');
  state.planDiff = true;
  assert.ok(/class="diff"[\s\S]*Added in v2/.test(V.start(ctx)), 'the differences, from the published files');
  state.planPick = { key: ctx.fsKey, plan: 'plan-1', hash: 's1', folder: v2.info.folder };
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
  assert.ok(/<h1[^>]*>Plan a run<\/h1>/.test(html) && /id="plan-form"/.test(html) && !/id="start-form"/.test(html));
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
  assert.ok(/class="ob" id="ob"/.test(html) && !/id="draft-editor"/.test(html) && /Unsaved: Save draft before you publish/.test(html) && /Preview/.test(html), 'the builder by default');
  state.builder = false; html = V.process(ctx);
  assert.ok(/id="draft-editor"/.test(html) && /Unsaved: Save draft before you publish/.test(html) && /Preview/.test(html) && /Changed lines · 1 new or changed, 1 removed/.test(html), 'Markdown on request, with the lines changed');
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
  assert.ok(/Phase 1<\/div>/.test(html) && /data-ob-phase="prep"/.test(html) && /<span class="cat mode">Do, then confirm<\/span>/.test(html), 'phase cards');
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

rule('Editor sidebars: each has its own labeled separator, its width is a variable on the panes, and the separator hides where the panes stack', () => {
  const { ctx, state } = setup();
  const seps = html => html.match(/<div class="pane-split"[^>]*>/g) || [];
  const attr = (tag, k) => { const m = new RegExp('\\s' + k + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
  const isSeparator = (tag, key, label, controls) => {
    assert.strictEqual(attr(tag, 'role'), 'separator', key + ' is a separator');
    assert.strictEqual(attr(tag, 'aria-orientation'), 'vertical');
    assert.strictEqual(attr(tag, 'aria-label'), label);
    assert.strictEqual(attr(tag, 'aria-controls'), controls);
    assert.strictEqual(attr(tag, 'tabindex'), '0', 'reached with Tab');
    assert.strictEqual(attr(tag, 'data-split'), key);
    const now = +attr(tag, 'aria-valuenow'), min = +attr(tag, 'aria-valuemin'), max = +attr(tag, 'aria-valuemax');
    assert.ok(min > 0 && min <= now && now <= max, key + ' says its width and range: ' + [min, now, max]);
    return { now, min, max };
  };
  // The step-type editor: one between the form and the Run preview.
  ctx.processes = () => []; ctx.data.stepTypes = { types: {}, errors: [] }; state.view = 'types';
  state.typeForm = { def: { id: 'risk.level', label: 'Risk level', hint: '', icon: 'check', fields: [], record: [] }, existing: null, baseHash: null };
  let html = V.types(ctx);
  assert.strictEqual(seps(html).length, 1);
  const tf = isSeparator(seps(html)[0], 'tf', 'Resize preview', 'tf-preview');
  assert.ok(html.indexOf('class="pane-split"') > html.indexOf('tf-formpane') && html.indexOf('class="pane-split"') < html.indexOf('id="tf-preview"'), 'between the form and the preview');
  assert.ok(/<div class="fpe-panes tf-panes">/.test(html), 'nothing chosen: the layout\'s own width');
  state.panes = { tf: 520 }; html = V.types(ctx);
  assert.ok(/<div class="fpe-panes tf-panes" style="--pane-tf:520px">/.test(html) && attr(seps(html)[0], 'aria-valuenow') === '520', 'a chosen width');
  state.panes = { tf: 99999 }; html = V.types(ctx);
  assert.ok(new RegExp('style="--pane-tf:' + tf.max + 'px"').test(html), 'never wider than its maximum');
  state.panes = { tf: '<b>' }; html = V.types(ctx);
  assert.ok(/<div class="fpe-panes tf-panes">/.test(html) && !/--pane-tf:/.test(html), 'a stored value that isn\'t a number is ignored');
  // The draft editor: the parts and the inspector each have their own.
  const latest = ctx.data.processes[0].index.latest;
  const p = { id: 'release', title: 'Production release', latest, all: [latest], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: latest.md }, draftChanged: false };
  ctx.processes = () => [p]; ctx.data.validations = []; state.view = 'process'; state.processId = 'release'; state.ptab = 'edit';
  state.editor = { pid: 'release', base: latest.md, baseHash: 'x', text: null };
  state.panes = { parts: 260, ins: 480 }; html = V.process(ctx);
  assert.strictEqual(seps(html).length, 2);
  isSeparator(seps(html)[0], 'parts', 'Resize parts', 'ob-parts'); isSeparator(seps(html)[1], 'ins', 'Resize inspector', 'fpe-ins');
  assert.ok(/<aside class="fpe-pane fpe-parts" id="ob-parts"/.test(html) && /<aside class="fpe-pane fpe-ins" id="fpe-ins"/.test(html), 'what each one resizes');
  assert.ok(/<div class="fpe-panes" style="--pane-parts:260px;--pane-ins:480px">/.test(html), 'each width its own');
  state.builder = false; html = V.process(ctx);
  assert.strictEqual(seps(html).length, 1, 'Markdown: only the inspector');
  assert.ok(/<div class="fpe-panes md" style="--pane-ins:480px">/.test(html) && attr(seps(html)[0], 'data-split') === 'ins');
  // Where the panes stack (phones) and where the parts fold to a rail, there's nothing to drag.
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'page.html'), 'utf8');
  const phone = css.split('@media (max-width: 800px)').slice(1).map(b => b.slice(0, b.indexOf('\n}')));
  assert.ok(phone.some(b => /\.pane-split \{ display: none; \}/.test(b)), 'hidden on phones');
  assert.ok(/\.fpe-panes\.rail > \.pane-split\[data-split="parts"\][^{]*\{ visibility: hidden; \}/.test(css), 'the rail has no parts separator');
  const hit = /\.pane-split::before \{[^}]*width: (\d+)px/.exec(css);
  assert.ok(hit && +hit[1] >= 8, 'a hit area of at least 8px');
});

rule('Editor sidebars fit the window together, from the widths chosen, never from what was drawn last', () => {
  const MAIN = V.MAIN_MIN, P = V.PANES, J = x => JSON.parse(JSON.stringify(x));
  // The draft editor's panes at a width: Parts is a rail of 72px from 801 to 1100px, else resizable.
  const builder = (W, prefs, measured) => [
    W <= 1100 ? { key: 'parts', fixed: true, measured: 72 } : { key: 'parts', pref: prefs.parts, measured: measured.parts },
    { key: 'ins', pref: prefs.ins, measured: measured.ins }
  ];
  const mainOf = (W, items, fit) => W - items.reduce((n, it) => n + (it.fixed ? it.measured : fit[it.key].w), 0);
  // The case that swung back and forth: 1101px with {parts: 400, ins: 720} kept.
  let items = builder(1101, { parts: 400, ins: 720 }, { parts: 160, ins: 341 });
  const a = V.fitPanes(1101, items);
  assert.deepStrictEqual([a.parts.w, a.ins.w], [400, 341], 'the inspector gives way first');
  assert.strictEqual(mainOf(1101, items, a), MAIN, 'the outline keeps its 360px');
  const b = V.fitPanes(1101, builder(1101, { parts: 400, ins: 720 }, { parts: 400, ins: 581 }));
  assert.deepStrictEqual(J(b), J(a), 'what was drawn last makes no difference');
  // Every window width: the main pane keeps 360px whenever the narrowest sidebars leave room, and a second pass changes nothing.
  const kept = [{ parts: 400, ins: 720 }, { parts: 160, ins: 720 }, { parts: 400 }, { ins: 720 }, {}, { parts: 300, ins: 300 }];
  for (let W = 800; W <= 2000; W++) kept.forEach(prefs => {
    const defaults = { parts: 208, ins: Math.round(Math.max(320, Math.min(0.27 * W, 400))) };
    const its = builder(W, prefs, defaults), fit = V.fitPanes(W, its);
    const mins = its.reduce((n, it) => n + (it.fixed ? it.measured : prefs[it.key] == null ? it.measured : P[it.key].min), 0);
    if (W - mins >= MAIN) assert.ok(mainOf(W, its, fit) >= MAIN, W + 'px ' + JSON.stringify(prefs) + ': main ' + mainOf(W, its, fit));
    // Drawing the result and fitting again: chosen widths are read from what was chosen, unset ones measure the same default.
    const again = V.fitPanes(W, builder(W, prefs, { parts: fit.parts ? fit.parts.w : 72, ins: fit.ins.w }));
    assert.deepStrictEqual(J(again), J(fit), W + 'px ' + JSON.stringify(prefs) + ': a fixed point after one pass');
    Object.keys(fit).forEach(k => assert.ok(fit[k].w >= P[k].min && fit[k].w <= fit[k].max && fit[k].max <= P[k].max, k + ' within its range at ' + W));
  });
  // The step-type preview alone.
  const tf = V.fitPanes(1024, [{ key: 'tf', pref: 720, measured: 328 }]);
  assert.deepStrictEqual(J(tf), { tf: { w: 1024 - MAIN, max: 1024 - MAIN } });
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

/* ---------- 1.17: How runs go (PF.insights; docs/design.md section 23) ---------- */
function insightsSetup(n, each) {
  const { ctx, state, p, latest } = flightSetup();
  const runs = Array.from({ length: n }, (_, i) => { const r = flightRun(latest, 'in' + i); r.title = 'Run ' + i; r._fileHash = 'h' + i; if (each) each(r, i); return r; });
  ctx.data.runs = runs; ctx.findRun = k => runs.filter(r => r.process + '/' + r.id === k)[0] || null;
  ctx.followUps = () => []; ctx.corrections = () => [];
  state.ptab = 'insights';
  return { ctx, state, p, latest, runs };
}
rule('How runs go: a run title is escaped inside the chart\'s SVG title, the chart has a table equivalent, and under 5 runs only counts show', () => {
  const { ctx, p, runs } = insightsSetup(3, (r, i) => { if (i === 0) r.title = '<img src=x onerror=alert(1)></title><script>bad()</script>'; if (i < 2) R.differently(r, R.mapOf(r), 'approved', 'Other way', 'person-casey', NOW); });
  const html = V.insightsPage(ctx, p);
  assert.ok(!/<img src=x|<script>bad/.test(html), 'nothing from a run is raw markup, in the SVG or anywhere');
  assert.ok(/<title>&lt;img src=x onerror=alert\(1\)&gt;&lt;\/title&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;, under a minute<\/title>/.test(html), 'escaped in the dot\'s title');
  assert.ok(/aria-label="&lt;img src=x/.test(html) && /data-act="go" data-view="run" data-run="release\/in0"/.test(html), 'each dot is a link to its run with an accessible name');
  assert.ok(/The same as a table/.test(html) && /<td><button class="linkish" data-act="go" data-view="run" data-run="release\/in1">Run 1<\/button><\/td>/.test(html), 'the table equivalent');
  assert.ok(html.indexOf(PF.insights.FEW) >= 0, 'says it\'s too few for a rate');
  const hot = html.slice(html.indexOf('id="ins-hot-h"'));
  assert.ok(/data-act="ins-runs" data-id="step:approved:offScript">2 of 3 runs</.test(hot) && !/% · /.test(hot), 'counts, no percentages');
  assert.ok(!/class="ins-fill"/.test(hot.slice(0, hot.indexOf('</section>'))), 'no bars under 5 runs');
  assert.strictEqual(runs.length, 3);
});
rule('How runs go: from 5 runs each number has its own bar against its own denominator, never stacked', () => {
  const { ctx, p } = insightsSetup(6, (r, i) => { const m = R.mapOf(r); if (i < 3) R.differently(r, m, 'approved', 'Other way', 'person-casey', NOW); });
  const html = V.insightsPage(ctx, p), hot = html.slice(html.indexOf('id="ins-hot-h"'), html.indexOf('</section>', html.indexOf('id="ins-hot-h"')));
  assert.ok(/50% · 3 of 6 runs/.test(hot), hot.slice(0, 600));
  const bars = hot.match(/<svg class="ins-bar"[\s\S]*?<\/svg>/g) || [];
  assert.ok(bars.length >= 2, 'Any off-script and Done differently each have a bar');
  bars.forEach(b => { assert.strictEqual((b.match(/class="ins-fill"/g) || []).length, 1); assert.strictEqual((b.match(/class="ins-track"/g) || []).length, 1); });
  assert.ok(/<rect class="ins-fill" width="50"/.test(hot), 'drawn to scale');
});
rule('How runs go: runs that couldn\'t be read, a load still under way and history incomplete are said, with the runs behind them', () => {
  const { ctx, state, p, runs } = insightsSetup(3);
  delete runs[2].marksFrom;
  state.unread = { runs: { ['release/' + runs[0].id]: 'bad JSON' } }; state.reading = { done: 40, total: 2000 };
  const html = V.insightsPage(ctx, p);
  assert.ok(/1 run couldn&#39;t be read; its last copy isn&#39;t counted\./.test(html) && /data-act="ins-runs" data-id="ex:unread">Show it</.test(html), html.slice(0, 2000));
  assert.ok(/Still reading runs \(40 of 2,000\)\. These numbers aren&#39;t final\./.test(html));
  assert.ok(/1 run started before Flightdeck kept a full record/.test(html));
  assert.ok(/data-act="ins-runs" data-id="runs:all">2</.test(html), 'two runs counted');
  assert.ok(/How these are counted/.test(html) && /Ever blocked/.test(html), 'the definitions');
});
rule('Runs: the runs behind a number are exactly the ones clicked, with Back to How runs go, and a change since is said', () => {
  const { ctx, state, runs } = insightsSetup(3, (r, i) => { if (i !== 1) R.differently(r, R.mapOf(r), 'approved', 'Other way', 'person-casey', NOW); });
  const res = PF.insights.forProcess({ runs }, 'release', { now: Date.parse(NOW), folder: runs[0].folder });
  state.view = 'runs'; state.filter = 'all'; state.runFilter = Object.assign(PF.insights.spec(res, 'step:approved:differently', runs), { cohort: true, back: { process: 'release', folder: runs[0].folder, scrollY: 0 } });
  ctx.processTitle = id => id; ctx.data.plans = [];
  let html = V.runs(ctx);
  assert.ok(/data-act="ins-back"[^>]*>.*Back to How runs go/.test(html), 'Back');
  assert.deepStrictEqual((html.match(/data-act="open-run" data-id="([^"]+)"/g) || []).map(x => x.split('"')[3]), ['release/in0', 'release/in2']);
  assert.ok(!/changed since/.test(html));
  runs[2].rev = 9;
  html = V.runs(ctx);
  assert.ok(/1 of these runs changed since\./.test(html) && /data-act="ins-refresh"/.test(html), 'the banner');
  assert.strictEqual((html.match(/data-act="open-run" data-id="([^"]+)"/g) || []).length, 2, 'still the cohort clicked');
  state.runFilter = { outcome: 'Completed', process: 'release' };
  html = V.runs(ctx);
  assert.ok(/<label for="rf-process">Process<\/label>/.test(html) && /<label for="rf-outcome">Outcome<\/label>/.test(html) && /<label for="rf-from">Started from<\/label>/.test(html), 'every filter has a label');
  assert.ok(/Matching runs · 3/.test(html) && /data-act="rf-clear" data-id="outcome"/.test(html), 'chips to remove each filter');
});

rule('Flight plan: each typical time says how many runs it\'s from, the footer counts runs still going apart, and runs it couldn\'t count are said', () => {
  const { ctx, state, p, latest } = flightSetup();
  const done = ['fa', 'fb'].map(id => flightRun(latest, id)), going = R.create(latest, { title: 'G', details: { ticket: 'ABC-1', commit: 'a1', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, id: 'fg' });
  const newer = flightRun(latest, 'fn'); newer._unrunnable = 'newer';
  ctx.data.runs = done.concat([going, newer]); state.reading = { done: 3, total: 10 };
  const html = V.checklistPanel(ctx, p);
  assert.ok(/Typically under a minute <span class="small">\(2 of 3 runs\)/.test(html), 'n on each phase time');
  assert.ok(/typically takes under a minute \(from 2 completed runs\)/.test(html), 'n on the completed-run time');
  assert.ok(/From 2 finished runs of v1\. 1 run still going counts only for what it has done so far\./.test(html) && !/From 3 runs/.test(html), 'the footer doesn\'t count the run still going');
  assert.ok(/1 run is from a newer Flightdeck/.test(html) && /Still reading runs \(3 of 10\)/.test(html), 'what isn\'t counted, and not final');
  ctx.data.runs = [newer]; state.reading = null;
  const only = V.checklistPanel(ctx, p);
  assert.ok(!/No runs of this version yet/.test(only) && /1 run is from a newer Flightdeck/.test(only), 'an excluded run isn\'t "no runs"');
});
rule('How runs go: the dots stay out of the tab order (the table is the keyboard path), at most 300 are drawn, and the table pages', () => {
  const { ctx, p } = insightsSetup(320);
  const html = V.insightsPage(ctx, p), dots = html.match(/<a href="#" class="ins-dot-a"[^>]*>/g) || [];
  assert.strictEqual(dots.length, 300);
  assert.ok(dots.every(d => /tabindex="-1"/.test(d)));
  assert.ok(/The latest 300 of 320 completed runs are drawn; the table has them all\./.test(html));
  assert.ok(/Showing 50 of 320/.test(html), 'the table pages');
});
rule('How runs go: corrections on runs still going show even before any run has finished, and Compare versions says what each row couldn\'t count', () => {
  const { ctx, p, latest } = flightSetup();
  const going = R.create(latest, { title: 'G', details: { ticket: 'ABC-1', commit: 'a1', environment: 'production' }, roles: {}, by: 'person-casey', session: 'me', now: NOW, id: 'cg' });
  going._fileHash = 'g';
  const older = Object.assign({}, latest, { folder: 'v0-old', info: Object.assign({}, latest.info, { version: 0, folder: 'v0-old' }) });
  const old = flightRun(older, 'o1'); old._unrunnable = 'newer';
  ctx.data.runs = [going, old]; ctx.findRun = () => going; ctx.followUps = () => [];
  ctx.corrections = () => [{ target: { step: 'approved' }, status: 'open', members: [{ run: 'cg', folder: latest.info.folder }] }];
  p.all = [latest, older]; ctx.state.ptab = 'insights';
  const html = V.insightsPage(ctx, p);
  assert.ok(!/No finished runs of this version yet/.test(html) && /data-id="step:approved:corrections"/.test(html), 'the correction shows');
  assert.ok(/<th scope="row">v0<\/th><td>0<\/td><td>0<\/td><td>—<\/td><td><span class="small ins-q">Not counted: 1 run, it&#39;s from a newer Flightdeck/.test(html), html.slice(html.indexOf('Compare versions'), html.indexOf('Compare versions') + 900));
});
rule('Runs: the banner over the runs behind a number never says "vnull", and names the folder when two folders share a version number', () => {
  const { ctx, state, runs, latest } = insightsSetup(2);
  const clash = Object.assign({}, latest, { info: Object.assign({}, latest.info, { folder: 'v1-zzzz9999' }) });
  ctx.processes = () => [{ id: 'release', all: [latest, clash], clashes: [1] }];
  ctx.processTitle = id => id; ctx.data.plans = []; state.view = 'runs';
  const res = PF.insights.forProcess({ runs, runStatus: { 'release/never': 'unread' } }, 'release', { now: Date.parse(NOW), folder: 'v1-zzzz9999' });
  state.runFilter = Object.assign(PF.insights.spec(res, 'ex:unknown', runs), { cohort: true, back: { process: 'release', folder: 'v1-zzzz9999', scrollY: 0 } });
  assert.strictEqual(state.runFilter.version, null, 'set-up: no run gives this folder a version');
  let html = V.runs(ctx);
  assert.ok(!/vnull/.test(html) && /release v1 \(folder v1-zzzz9999\)/.test(html), html.slice(html.indexOf('ins-banner'), html.indexOf('ins-banner') + 400));
  const ok = PF.insights.forProcess({ runs }, 'release', { now: Date.parse(NOW), folder: runs[0].folder });
  state.runFilter = Object.assign(PF.insights.spec(ok, 'runs:all', runs), { cohort: true, back: {} });
  html = V.runs(ctx);
  assert.ok(new RegExp('release v1 \\(folder ' + runs[0].folder + '\\)').test(html), 'the other folder of the clash is named too');
});
rule('How runs go: gates waived and failed show per phase with their denominators, and a run never read is said with a way to Folder health', () => {
  const { ctx, state, p } = insightsSetup(3, (r, i) => { if (i === 0) { const g = R.mapOf(r).phases[0].gate.id; r.gates[g] = Object.assign({}, r.gates[g], { s: 'waived', reason: 'ok' }); } });
  state.unread = { runs: { 'release/never-read': true } };
  const html = V.insightsPage(ctx, p);
  assert.ok(/waived in <button class="linkish" data-act="ins-runs" data-id="gate:[^:"]+:waived">1 of 3 runs<\/button>/.test(html), 'waived, out of the runs with a record of the gate');
  assert.ok(/couldn&#39;t be read, so which version it belongs to isn&#39;t known/.test(html) && /data-act="health">Folder health/.test(html), 'the run never read');
});
rule('Compare versions and the flight plan say what each number left out, through the same words as How runs go', () => {
  const { ctx, state, p, latest } = flightSetup();
  const older = Object.assign({}, latest, { folder: 'v0-old', info: Object.assign({}, latest.info, { version: 0, folder: 'v0-old' }) });
  const ahead = flightRun(older, 'o1'); ahead.ended.at = new Date(Date.parse(NOW) + 400 * 86400000).toISOString();
  const a = flightRun(latest, 'fa'), b = flightRun(latest, 'fb', 'approved'); delete a.marksFrom;
  const fut = flightRun(latest, 'fc'); fut.ended.at = new Date(Date.parse(NOW) + 86400000).toISOString();
  ctx.data.runs = [ahead, a, b, fut]; ctx.findRun = () => null; ctx.followUps = () => []; ctx.corrections = () => [];
  p.all = [latest, older]; state.ptab = 'insights';
  const html = V.insightsPage(ctx, p), cmp = html.slice(html.indexOf('Compare versions'));
  assert.ok(/<th scope="row">v0<\/th><td>1<\/td><td>0<\/td><td>—<\/td><td><span class="small ins-q">Not counted: 1 run, a time is later than now, by the recorder&#39;s clock\./.test(cmp), cmp.slice(0, 1200));
  state.ptab = 'checklist';
  const fp = V.checklistPanel(ctx, p);
  assert.ok(/A completed run typically takes [^<]+<\/span><span class="small ins-q">Not counted: 1 run, a time is later than now, by the recorder&#39;s clock\./.test(fp), 'the landed time says what it left out');
  assert.ok(/went off-script in 1 of 2 runs<span class="small ins-q">Not counted: 1 run, history incomplete\./.test(fp), fp.slice(fp.indexOf('Turbulence'), fp.indexOf('Turbulence') + 400));
});
rule('Runs: Show current numbers can come back with no runs, and then says nothing changed', () => {
  const { ctx, state, runs } = insightsSetup(2);
  ctx.processTitle = id => id; ctx.data.plans = []; state.view = 'runs';
  const res = PF.insights.forProcess({ runs }, 'release', { now: Date.parse(NOW), folder: runs[0].folder });
  state.runFilter = Object.assign(PF.insights.spec(res, 'ex:unread', runs), { cohort: true, back: {} });
  const html = V.runs(ctx);
  assert.ok(/id="rf-h" tabindex="-1">0 runs</.test(html) && !/changed since/.test(html), html.slice(html.indexOf('ins-banner'), html.indexOf('ins-banner') + 900));
});
rule('How runs go: every number that left out a run it should have counted, or has history incomplete, says so on the page, even with nothing to count', () => {
  const { ctx, state } = flightSetup();
  const md = ['---', 'process: x', 'title: X', '---', '## Prep · READ-DO {#prep}', '- [ ] {confirm} One {#one}', '## Gate: Ready {#g1}',
    '## Ship · READ-DO {#ship}', '- [ ] {confirm} Three {#three}', '## Gate: Ready {#g2}'].join('\n');
  const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, rand: 'gen00001' }), pub = P.verify(b.folder, b.files, exactOf(PF, b.files));
  const base = Date.parse(NOW) - 86400000, t = m => new Date(base + m * 60000).toISOString();
  const mk = (id, how) => {
    const r = R.create(pub, { title: id, details: {}, roles: {}, by: 'person-casey', session: 'me', now: t(0), id }), m = R.mapOf(r);
    R.done(r, m, 'one', 'person-casey', t(1));
    if (how === 'shared') { R.fail(r, m, 0, 'Broke', 'person-casey', t(2)); R.reopen(r, m, 0, 'person-casey', t(3)); }
    R.pass(r, m, 0, 'person-casey', t(4)); R.done(r, m, 'three', 'person-casey', t(5)); R.pass(r, m, 1, 'person-casey', t(6)); R.end(r, m, 'Completed', 'person-casey', 'C', t(how === 'late' ? 5 : 8));
    if (how === 'incomplete') delete r.marksFrom;
    if (how === 'pauses') r.pauses = [{ from: t(1), to: t(4), by: 'a', reason: 'x' }, { from: t(2), to: t(5), by: 'a', reason: 'y' }];
    if (how === 'future') r.ended.at = new Date(Date.parse(NOW) + 86400000).toISOString();
    if (how === 'fu') { R.addFollowUp(r, { id: 'f1', text: 'x' }, 'person-casey', t(2)); r.followUps[0].at = null; }
    r._fileHash = id;
    return r;
  };
  const runs = ['shared', 'incomplete', 'pauses', 'future', 'late', 'fu', 'plain'].map(h => mk('g-' + h, h));
  ctx.data.runs = runs; ctx.findRun = k => runs.find(r => 'x/' + r.id === k) || null; ctx.corrections = () => [];
  ctx.followUps = () => PF.followups.list(runs, []);
  const p = { id: 'x', title: 'X', latest: pub, all: [pub], clashes: [], broken: [], skills: [] };
  state.ptab = 'insights';
  const html = V.insightsPage(ctx, p), res = V.insightsOf(ctx, 'x', pub.info.folder, false);
  const I = PF.insights, U = PF.util, qs = [['duration', res.duration.q, null], ['open follow-ups', res.followUps.open.q, null], ['decided follow-ups', res.followUps.decided.q, null]];
  res.phases.forEach(x => qs.push(['phase ' + x.id, x.q, null], ['waived ' + x.id, x.gate.waived.q, null], ['failed ' + x.id, x.gate.failed.q, null]));
  res.steps.forEach(s => ['offScript', 'blocked', 'redone', 'na', 'differently', 'skipped', 'corrections'].forEach(k => qs.push([s.id + ' ' + k, s[k].q, 'step:' + s.id + ':' + k])));
  let checked = 0;
  qs.forEach(([name, q, path]) => {
    if (!I.hasProblems(q)) return;
    checked++;
    if (path && q.incomplete) assert.ok(html.indexOf('data-id="' + path + ':incomplete"') >= 0, name + ': its history-incomplete count');
    const line = path ? I.notCounted(q, ['incomplete']) : I.notCounted(q);
    if (line) assert.ok(html.indexOf(U.esc(line)) >= 0, name + ': "' + line + '"');
  });
  assert.ok(checked >= 6, 'the page had problems to say: ' + checked);
  assert.ok(res.phases[1].gate.failed.hits === 0 && /failed at least once in (\d+% · )?0 of 6 runs<span class="small ins-q">Not counted: 1 run, its log says a gate with this title failed/.test(html), 'a failure the log can\'t place shows with no runs failed');
});
rule('Runs: a filter keeps the alert about run files that can\'t be read above its results', () => {
  const { ctx, state } = insightsSetup(2);
  ctx.data.unreadable = [{ path: 'runs/release/in0/run.json', key: 'release/in0', why: 'bad JSON' }];
  ctx.processTitle = id => id; ctx.data.plans = []; state.view = 'runs'; state.runFilter = { outcome: 'Completed' };
  const html = V.runs(ctx);
  assert.ok(/A run file can.t be read/.test(html) && html.indexOf('A run file can') < html.indexOf('Matching runs'), 'the alert first');
});

rule('Flight plan: the Checklist | Flight plan switch shows the same version as a vertical route from Start to Landed', () => {
  const { ctx, state, p } = flightSetup();
  let html = V.checklistPanel(ctx, p);
  assert.ok(/data-act="flight" data-id="list" aria-pressed="false">Checklist</.test(html) && /data-act="flight" data-id="plan" aria-pressed="true">Flight plan</.test(html) && /data-act="flight" data-id="md" aria-pressed="false">Markdown</.test(html), 'one switch: Checklist, Flight plan, Markdown');
  assert.ok(/<ol class="fp" aria-label="Flight plan">/.test(html) && />Start</.test(html) && />Landed</.test(html), 'an ordered route');
  assert.strictEqual((html.match(/data-act="flight-phase"/g) || []).length, 3, 'one button per phase');
  assert.ok(/aria-label="Phase 2 of 3, Deploy, Read, then do, 4 steps, then gate Deployed. Show it in the checklist"/.test(html), 'each phase says where it is and what follows');
  assert.ok(/Phase 1 · Do, then confirm/.test(html) && /6 steps · 4 must-do/.test(html), 'mode, steps and must-dos');
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
  assert.ok(R.analytics(mine, 'release', latest.info.folder, Date.parse(NOW)).steps.every(c => c.id !== 'smoke'), 'set-up: the third phase is outside the top ten');
  ctx.data.runs = mine.concat(theirs);
  let html = V.checklistPanel(ctx, p);
  assert.ok(/Typically under a minute/.test(html) && /From 3 finished runs of v1\. Paused time isn.t counted\./.test(html), 'numbers say which version they come from');
  assert.strictEqual((html.match(/<b>Turbulence<\/b>/g) || []).length, 3, 'every phase with deviations keeps its own, past the global top ten');
  assert.ok(/off-script in 3 of 3 runs/.test(html) && !/of 4 runs/.test(html), 'the older run\'s deviation is not added, and each run counts once');
  p.draft = { file: 'release.md', md: latest.md.replace('Approve the deploy in Jenkins', 'Approve it') }; p.draftChanged = true;
  html = V.checklistPanel(ctx, p);
  assert.ok(!/Typically|Turbulence/.test(html) && /No runs of this version yet\./.test(html), 'a draft shows no history');
  p.draft = null; p.draftChanged = false; ctx.data.runs = [theirs];
  html = V.checklistPanel(ctx, p);
  assert.ok(!/Typically|Turbulence/.test(html) && /No runs of this version yet\./.test(html), 'only another version has runs: none shown');
});

rule('Flight plan: two phases with the same title show their own typical times', () => {
  const md = ['---', 'process: rv', 'title: RV', 'owner: person-avery', '---', '', '## Review · READ-DO {#r1}', '- [ ] {confirm} A {#a}', '', '## Review · READ-DO {#r2}', '- [ ] {confirm} B {#b}'].join('\n');
  const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'rv000001' }), pub = P.verify(b.folder, b.files, exactOf(PF, b.files));
  const t0 = Date.parse(NOW), at = m => new Date(t0 + m * 60000).toISOString();
  const r = R.create(pub, { title: 'R', details: {}, roles: {}, by: 'person-casey', session: 'me', now: NOW, id: 'rv1' }), map = R.mapOf(r);
  R.done(r, map, 'a', 'person-casey', at(1)); R.pass(r, map, 0, 'person-casey', at(5));
  R.done(r, map, 'b', 'person-casey', at(10)); R.pass(r, map, 1, 'person-casey', at(65));
  const { ctx, p } = flightSetup({ id: 'rv', title: 'RV', latest: pub, all: [pub] });
  ctx.data.runs = [r]; ctx.now = () => t0 + 86400000; // its gates are after NOW: times later than now aren't counted
  const html = V.checklistPanel(ctx, p);
  assert.ok(/Typically 5 min/.test(html) && /Typically 1 h </.test(html) && !/Typically 33 min/.test(html), 'not pooled by title');
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

/* ---------- 1.18: the flight plan lists each phase's steps ---------- */
/* One phase's steps disclosure, and one step's row inside it. */
const fpSteps = (html, i) => { const at = html.indexOf('<details class="fp-steps" data-fps="' + i + '"'); return at < 0 ? '' : html.slice(at, html.indexOf('</details>', at) + 10); };
const fpStep = (html, id) => { const at = html.indexOf('data-step="' + id + '"'); return at < 0 ? '' : html.slice(html.lastIndexOf('<li', at), html.indexOf('</li>', at) + 5); };

rule('Flight plan: each phase lists its steps in order under a disclosure that shows the count', () => {
  const { ctx, p, latest } = flightSetup();
  const html = V.checklistPanel(ctx, p);
  assert.strictEqual((html.match(/<details class="fp-steps"/g) || []).length, 3, 'one disclosure per phase');
  assert.ok(/<summary id="fps-0">6 steps · 4 must-do<span class="sr"> in Before production changes<\/span><\/summary>/.test(fpSteps(html, 0)), 'the count is the summary, named for its phase');
  assert.ok(/<summary id="fps-1">4 steps · 4 must-do<span class="sr"> in Deploy<\/span><\/summary>/.test(fpSteps(html, 1)));
  const ids = s => [...s.matchAll(/data-step="([\w-]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(ids(fpSteps(html, 0)), ['approved', 'tests', 'flags', 'rollback', 'notes', 'announce'], 'in checklist order');
  assert.deepStrictEqual(ids(fpSteps(html, 1)), ['merge', 'jenkins', 'approve', 'pods']);
  assert.ok(/<ol class="fp-sl" aria-label="Steps in Deploy">/.test(fpSteps(html, 1)), 'an ordered list, named');
  const jenkins = fpStep(html, 'jenkins');
  assert.ok(/role="img" aria-label="Jenkins job"/.test(jenkins), 'its type icon, named');
  assert.ok(/<button type="button" class="fp-step" data-act="go" data-view="process" data-process="release" data-map-ver="/.test(jenkins) && jenkins.indexOf('data-map-ver="' + latest.info.folder + '"') > 0, 'a button that opens it in this exact version');
  assert.ok(/>Start the production deploy job <span class="ref-empty">‹tag›<\/span><span class="sr">/.test(jenkins), 'its text');
  assert.ok(/<span class="badge b-must">Must do<\/span>/.test(jenkins) && /<span class="pv-role">@backend<\/span>/.test(jenkins), 'must-do and role');
  const notes = fpStep(html, 'notes');
  assert.ok(!/b-must/.test(notes) && /@release-lead/.test(notes), 'a step that isn\'t a must-do has no mark');
});

rule('Flight plan: a step shows the skill built from the version shown that covers it, and nothing from another version', () => {
  const { ctx, p, latest } = flightSetup();
  const v = latest.info.version;
  p.skills = [skillOf('release-deploy', ['jenkins', 'approve'], v, 'current'), skillOf('old-deploy', ['merge'], v - 1, 'update'), skillOf('broken-one', ['pods'], v, 'current', ['bad'])];
  const html = V.checklistPanel(ctx, p);
  assert.ok(/<span class="badge b-skill">.*?release-deploy<\/span>/.test(fpStep(html, 'jenkins')) && /release-deploy/.test(fpStep(html, 'approve')), 'covered by its skill');
  assert.ok(!/b-skill/.test(fpStep(html, 'merge')) && !/b-skill/.test(fpStep(html, 'pods')), 'a skill behind or broken claims nothing');
});

rule('Flight plan: parallel tracks list their steps as lanes side by side, and the gate is the last line', () => {
  const { ctx, p } = flightSetup();
  const html = V.checklistPanel(ctx, p), three = fpSteps(html, 2);
  assert.ok(/<div class="fp-slanes">/.test(three) && !/fp-slanes/.test(fpSteps(html, 1)), 'lanes only where the phase has tracks');
  assert.ok(/<div class="fp-slane"><p class="fp-slane-h"><b>Product checks<\/b> <span class="pv-role">@qa<\/span><\/p><ol class="fp-sl" aria-label="Steps in Product checks">/.test(three), 'each lane names itself and its roles');
  const lane = (s, title) => s.slice(s.indexOf('<b>' + title + '</b>'), s.indexOf('</ol>', s.indexOf('<b>' + title + '</b>')));
  assert.ok(/data-step="smoke"/.test(lane(three, 'Product checks')) && /data-step="logs"/.test(lane(three, 'Product checks')) && !/data-step="result"/.test(lane(three, 'Product checks')));
  assert.ok(/data-step="result"[\s\S]*data-step="deploy-record"[\s\S]*data-step="close"/.test(lane(three, 'Wrap-up')));
  assert.ok(/<p class="fp-sgate">.*?Gate: Ready to deploy<\/span><\/p><\/div><\/details>$/.test(fpSteps(html, 0)), 'a named gate ends the list');
  assert.ok(/<p class="fp-sgate">.*?Phase checked, no named gate<\/span><\/p><\/div><\/details>$/.test(three), 'an unnamed one says so');
});

rule('Flight plan: steps from the checklist are escaped, and a draft\'s steps open the draft', () => {
  const md = ['---', 'process: odd', 'title: Odd', 'owner: person-avery', 'roles: a', '---', '', '## One · READ-DO {#one}', '- [!] {confirm} Step <i>x</i> & "y" @a {#s1}'].join('\n');
  const { ctx, p } = flightSetup({ id: 'odd', title: 'Odd', latest: null, all: [], draft: { file: 'odd.md', md }, draftChanged: true });
  const html = V.checklistPanel(ctx, p), row = fpStep(html, 's1');
  assert.ok(/Step &lt;i&gt;x&lt;\/i&gt; &amp; &quot;y&quot;/.test(row) && !/<i>x/.test(html), 'shown as text');
  assert.ok(/data-process="odd"/.test(row) && !/data-map-ver/.test(row), 'no version: the draft is what\'s shown');
});

rule('Flight plan: phases are open when the checklist has 40 steps or fewer, closed above that, and Show all steps or Hide all steps follows', () => {
  const { ctx, p, state } = flightSetup();
  let html = V.checklistPanel(ctx, p);
  assert.strictEqual((html.match(/<details class="fp-steps"[^>]* open>/g) || []).length, 3, '15 steps: all open');
  assert.ok(/<button type="button" class="mini fp-all" data-act="fp-steps" data-id="hide">Hide all steps<\/button>/.test(html) && html.indexOf('fp-all') < html.indexOf('<ol class="fp"'), 'at the top: everything is open, so Hide');
  const step = i => '- [ ] {confirm} Step ' + i + ' {#s' + i + '}';
  const md = n => ['---', 'process: big', 'title: Big', 'owner: person-avery', '---', '', '## A · READ-DO {#a}'].concat(Array.from({ length: 20 }, (_, i) => step(i)), ['', '## B · READ-DO {#b}'], Array.from({ length: n - 20 }, (_, i) => step(i + 20))).join('\n');
  const big = flightSetup({ id: 'big', title: 'Big', latest: null, all: [], draft: { file: 'big.md', md: md(40) }, draftChanged: true });
  assert.strictEqual((V.checklistPanel(big.ctx, big.p).match(/<details class="fp-steps"[^>]* open>/g) || []).length, 2, '40 steps: open');
  big.p.draft.md = md(41); html = V.checklistPanel(big.ctx, big.p);
  assert.ok((html.match(/<details class="fp-steps"/g) || []).length === 2 && !/<details class="fp-steps"[^>]* open>/.test(html), '41 steps: closed');
  assert.ok(/data-act="fp-steps" data-id="show">Show all steps</.test(html));
  state.fpSteps = { release: { d: false } }; html = V.checklistPanel(ctx, p);
  assert.ok(!/<details class="fp-steps"[^>]* open>/.test(html) && /data-id="show">Show all steps</.test(html), 'Hide all, as kept for this process');
  state.fpSteps = { release: { d: true, p: { 1: false } } }; html = V.checklistPanel(ctx, p);
  assert.ok(/data-fps="0" data-fps-open="1" open>/.test(html) && /data-fps="1" data-fps-open="0">/.test(html) && /data-fps="2" data-fps-open="1" open>/.test(html), 'one phase closed by hand');
  assert.ok(/data-id="show">Show all steps</.test(html), 'not everything is open, so Show');
  state.fpSteps = { other: { d: false } }; html = V.checklistPanel(ctx, p);
  assert.strictEqual((html.match(/<details class="fp-steps"[^>]* open>/g) || []).length, 3, 'another process\'s choice doesn\'t apply');
  state.clView = 'list'; html = V.checklistPanel(ctx, p);
  assert.ok(!/fp-steps|fp-all/.test(html) && /<li id="cl-st-jenkins" tabindex="-1">/.test(html), 'the checklist has no disclosure, and an anchor per step');
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
  /* A version lists every screenshot it shows, as publishing records it. */
  const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'view0009', images: { 'images/release/cab.png': PF.util.hash('cab') }, imageBytes: { 'images/release/cab.png': new Uint8Array([99, 97, 98]) } });
  return R.create(P.verify(b.folder, b.files, exactOf(PF, b.files)), { title: 'T', details: { ticket: 'ABC-1', commit: 'c0ffee1', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'other', now: NOW, id: 'run1' });
};

rule('Run screen: anyone who has said who they are can correct a step; Suggest a fix is gone; only the recorder sees Done differently', () => {
  const r = withShot(); r._notes = []; r._conflicts = [];
  const { ctx, state } = setup(); ctx.run = () => r; ctx.data.runs = [r];
  state.me = 'person-blake'; state.sel = 'approved';
  let html = V.run(ctx), ins = insOf(html);
  assert.ok(!ctx.recording(r), 'set-up: Blake isn\'t recording');
  assert.ok(/<h3 class="rw-h3" id="ins-corr">Corrections<\/h3><button class="mini" data-act="corr-open" data-mode="correct" data-id="approved"[^>]*>.*Correct this step<\/button>/.test(ins), 'from the step');
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
  assert.ok(/<h2>Corrections · 4<\/h2>/.test(html) && /<span class="pill locked">Declined<\/span><span class="small corr-why-no">We set them in the job<\/span>/.test(html));
  assert.ok(/<span class="pill waived">One-off<\/span>/.test(html) && /<div class="corr-step">Full test gate green on the release commit aaa111<\/div>/.test(html) && /<dt>What happened<\/dt><dd>Ran it twice<\/dd>/.test(html));
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
    v2 = Object.assign(P.verify(b.folder, b.files, exactOf(PF, b.files)), { folder: b.folder });
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
  const v3 = Object.assign(P.verify(b.folder, b.files, exactOf(PF, b.files)), { folder: b.folder }), r3 = R.create(v3, { title: 'Release 3', details: {}, by: 'person-casey', session: 'me', now: NOW, id: 'r3' }); r3._notes = []; r3._conflicts = [];
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
  const plain = Object.assign(P.verify(b.folder, b.files, exactOf(PF, b.files)), { folder: b.folder });
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
  assert.ok(/data-act="ob-done">Close<\/button>/.test(html), 'Close, for the phone\'s sheet');
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
  assert.ok(/<span class="pv-copy">Smoke prompts return their expected answers<\/span><span class="pv-meta"><span class="mustmark" role="img" aria-label="Must do" title="Must do">!<\/span><span class="pv-role">@qa<\/span><\/span>/.test(html), 'copy, then labels');
  assert.ok(/<div class="g"><span class="ic"[^>]*>.*?<\/span><span class="pv-gate-copy">Gate: Deployed · approves <b class="dname">commit<\/b> running in <b class="dname">environment<\/b><\/span><\/div>/.test(html), 'the gate as one sentence');
});

rule('Draft editor: Checklist details, a step\'s note and the Questions panel escape everything from the files', () => {
  const { ctx, state } = partsSetup();
  const evil = '"><img src=x onerror=alert(1)>';
  ctx.data.people = [{ id: 'person-a', name: '<b>A</b>', initials: 'A' }, { id: evil, name: evil, initials: 'X' }, { id: 'constructor', name: 'C', initials: 'C' }];
  state.editor.text = ['---', 'process: release', 'title: T', 'owner: ' + evil, 'roles: <i>r</i>', 'context: </textarea><svg>', '---', '',
    '## First · READ-DO {#first}', '- [ ] {confirm} One {#one}', '  > </textarea><script>alert(1)</script>', '',
    '## Questions', '</textarea><script>q()</script>', ''].join('\n');
  state.insTab = 'selected';
  const views = [];
  state.obSel = { pid: 'release', kind: 'details', key: ':details' }; views.push(V.process(ctx));
  state.obSel = { pid: 'release', kind: 'step', key: 'one' }; views.push(V.process(ctx));
  state.obSel = { pid: 'release', kind: 'questions', key: ':questions' }; state.obAsk = { kind: 'questions', key: ':questions' }; views.push(V.process(ctx));
  views.forEach((html, i) => {
    assert.ok(!/<img src=x|<script>|<svg>|<i>r<\/i>|<b>A<\/b>/.test(html), 'view ' + i + ' has no markup from the files');
    assert.strictEqual((html.match(/<\/textarea>/g) || []).length, (html.match(/<textarea/g) || []).length, 'view ' + i + ': every textarea closes once');
  });
  assert.ok(/<option value="person-a">&lt;b&gt;A&lt;\/b&gt;<\/option>/.test(views[0]) && !/<option value="constructor"/.test(views[0]), 'people: escaped, reserved IDs not offered');
  assert.ok(/<textarea id="ob-note" rows="3" maxlength="2000">\n&lt;\/textarea&gt;&lt;script&gt;/.test(views[1]));
  assert.ok(/<textarea id="ob-q-text" rows="8" maxlength="20000">\n&lt;\/textarea&gt;&lt;script&gt;q\(\)/.test(views[2]) && /data-act="ob-q-remove" id="ob-ask-go">Remove section<\/button>/.test(views[2]));
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
  assert.ok(/data-k="rec"/.test(h) && /<b>You're recording<\/b>/.test(h) && !/revision 0/.test(h) && /data-act="pick" data-kind="pause"/.test(h) && /data-act="pick" data-kind="handoff"[^>]*>.*Hand off/.test(h), 'recording here: Pause and Hand off beside it');
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
  assert.ok(/data-k="ready"/.test(h) && /Recording is waiting for you<\/b>/.test(h) && !/revision 1/.test(h) && /data-act="pickup">Pick up recording/.test(h), 'then it can');
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
  assert.ok(/data-k="ended"/.test(stripOf(h)) && /<b>Ended: Canceled<\/b> by Casey Nguyen at/.test(h) && /class="btn go" data-act="receipt"/.test(stripOf(h)), 'ended: who, when, and the Receipt');
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
  assert.ok(/^<li class="step next" data-a="open" id="step-merge"><button class="check" role="checkbox" aria-checked="false" aria-label="Merge the release branch to master aaa111, not checked, must do" data-act="toggle" data-id="merge">/.test(row), row);
  assert.ok(/<button class="s-pick" data-act="select" data-id="merge" aria-pressed="false" aria-controls="rw-ins"><span class="s-next">Next<\/span>/.test(row), 'selecting is its own control');
  assert.ok(/<span class="s-who">Casey Nguyen<\/span>/.test(row) && /<span class="mustmark" role="img" aria-label="Must do" title="Must do">!<\/span>/.test(row), 'who does it; must-do stays quiet');
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
  assert.ok(/Next up · Deploy · 4 to go, then the "Deployed" gate/.test(n) && /<b>Merge the release branch to master aaa111<\/b>/.test(n) && /data-act="goto" data-id="step-merge">Go to step/.test(n), n);
  assert.ok(!/data-act="(toggle|record|na|pick)"/.test(n), 'never a completion control');
  state.sel = 'merge'; assert.ok(/Selected<span class="rw-kbd"> · Space checks it<\/span>/.test(nextOf(V.run(ctx))));
  state.sel = 'approved'; n = nextOf(V.run(ctx));
  assert.ok(/<b>Merge the release branch to master aaa111<\/b>/.test(n) && /data-act="goto" data-id="step-merge">Back to it/.test(n), 'browsing an earlier step: the same next step, one click back');
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
  assert.ok(/data-scope="ref:jenkins"/.test(ins) && /<li>Deploy<\/li><li>Step 2 of 4<\/li>/.test(ins) && /<h2 id="ins-h" class="rw-ins-h" tabindex="-1">Start the production deploy job <span class="ref-empty">‹tag›<\/span><\/h2>/.test(ins));
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
  assert.ok(/<input type="file" id="note-file" accept="\.png,\.jpg,\.jpeg,\.webp,\.gif,\.pdf,\.zip,\.txt,\.log,\.md,\.csv,\.json,\.yaml,\.yml,[^"]*" multiple class="sr" aria-describedby="att-help">/.test(ins) && /data-drop="note" data-id="approved"/.test(ins), 'Attach takes several files; the box takes drops');
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
  assert.strictEqual(cards(html), 108, 'at most 50 running, the 8 newest finished and 50 earlier ones on the first view');
  assert.ok(/Showing 50 of 1,942/.test(html) && /Showing 50 of 70/.test(html));
  assert.ok(/<button class="btn" data-act="more" data-id="runs-ended"[^>]*>Show 50 more<\/button>/.test(html));
  assert.ok(/data-act="more" data-id="runs-running"[^>]*>Show 20 more</.test(html), 'says how many more when it\'s fewer than 50');
  state.more = { 'runs-ended': 100 };
  html = V.runs(ctx);
  assert.strictEqual(cards(html), 158); assert.ok(/Showing 100 of 1,942/.test(html));
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
  assert.strictEqual(cards(html), 508);
  assert.ok(ms <= 250, 'rendered 500 cards in ' + ms.toFixed(0) + ' ms');
});

/* ---------- Search palette (docs/design.md section 22) ---------- */
function palette(q, extra) {
  const { r, ctx, state } = setup();
  r._notes = [{ id: 'x1', at: NOW, by: 'person-blake', step: 'pods', text: 'Pods <img src=x onerror=alert(1)> restarted', files: [], fileInfo: {} }];
  const S = PF.search, ix = S.create(), inp = { runs: [r], people, pubs: ctx.data.processes, drafts: [], skills: [], stepTypes: {}, corrDecisions: [], followUps: [] };
  S.sync(ix, S.docs(inp), inp);
  const res = S.query(ix, q, { status: (extra && extra.status) || {} }), flat = [];
  res.groups.forEach(g => g.items.forEach(x => flat.push(x)));
  state.sx = { q, res, flat, pos: flat.length ? 0 : -1, active: flat.length ? flat[0].id : null };
  ctx.search = () => Object.assign({ building: null, unread: 0, readAt: NOW }, extra || {});
  return V.search(ctx);
}
rule('Search palette: a combobox controlling a grouped listbox, the active option named, and text from files escaped around each hit', () => {
  const html = palette('onerror restarted');
  assert.ok(/<input id="sx-q" type="search" role="combobox" aria-autocomplete="list" aria-controls="sx-list" aria-expanded="true" aria-activedescendant="sx-o-0"/.test(html), 'combobox');
  assert.ok(/<ul id="sx-list" role="listbox" aria-label="Results">/.test(html) && /<ul role="group" aria-labelledby="sx-g-note">/.test(html), 'listbox with labeled groups');
  assert.ok(/<li role="option" id="sx-o-0" class="sx-opt" aria-selected="true"/.test(html), 'the active option');
  assert.ok(!/<img src=x/.test(html), 'no markup from a note');
  assert.ok(/&lt;img src=x <mark>onerror<\/mark>=alert\(1\)&gt; <mark>restarted<\/mark>/.test(html), 'escaped, with the hits marked');
  assert.ok(/<label class="sr" for="sx-q">Search the team folder<\/label>/.test(html) && /role="dialog" aria-modal="true" aria-labelledby="sx-t"/.test(html), 'labeled box in a dialog');
});
rule('Search palette: empty, nothing found, still reading, and a run that couldn\'t be read each say so plainly', () => {
  assert.ok(/Search runs, steps, notes, corrections, follow-ups, step types and skills\./.test(palette('')), 'empty');
  assert.ok(/aria-expanded="false"/.test(palette('')) && / hidden>/.test(palette('')), 'no list while empty');
  assert.ok(/Nothing matches “deploy prod”\. Try fewer words, or a ticket like ABC-123\./.test(palette('deploy prod')), 'nothing found');
  assert.ok(/Nothing matches “&lt;b&gt;”/.test(palette('<b>')), 'the query is escaped too');
  assert.ok(/Reading the team folder…/.test(palette('zzz', { building: { done: 640, total: 2000 } })), 'loading');
  assert.ok(/Still reading 640 of 2,000 runs\./.test(palette('restarted', { building: { done: 640, total: 2000 } })), 'partial results say so');
  const bad = palette('release', { unread: 3, status: { 'release/run1': 'unread' } });
  assert.ok(/3 run files couldn&#39;t be read; their last copies are searched and marked\./.test(bad), 'footer: ' + /sx-foot[^<]*/.exec(bad));
  assert.ok(/Couldn('|&#39;)t be read; last copy/.test(bad), 'the result is marked');
  assert.ok(/Folder last read \d{1,2}:\d{2}:\d{2}/.test(bad), 'when the folder was last read');
});

rule('Export evidence dialog: every stage is labeled, everything from files is escaped, and the pack\'s SHA-256 is offered to keep separately', () => {
  const { ctx } = setup();
  const E = PF.evidence, base = { evidence: true, scope: { run: 'release/run1' }, title: '<script>x</script> night', tz: 'UTC', attachments: true, format: 'pack', form: {} };
  ctx.findRun = () => ctx.data.runs[0];
  let h = V.evidence(ctx, Object.assign({}, base, { stage: 'plan' }));
  assert.ok(/role="dialog"/.test(h) && /aria-labelledby="ev-t"/.test(h) && /id="ev-close"/.test(h) && !/<script>x/.test(h) && /&lt;script&gt;x/.test(h));
  const plan = { keys: ['release/run1'], estimate: 13 * 1048576, attach: { n: 4, bytes: 12.4 * 1048576 }, exclusions: [{ path: 'people.json', reason: 'x' }, { path: 'runs/release/run1/<b>.tmp', reason: 'temporary file left by a save' }] };
  h = V.evidence(ctx, Object.assign({}, base, { stage: 'ready', plan, window: { unsaved: true } }));
  assert.ok(/1 run · \d+ answers? · \d+ notes? · 4 attachments \(12\.4 MB\) · up to 13 MB/.test(h), h.slice(0, 600));
  assert.ok(h.includes(U(E.PRIVACY)), 'the privacy line, before anything is made');
  assert.ok(/This window has a change that isn(&#39;|')t in the team folder yet\. The pack holds only what(&#39;|')s saved in the folder\./.test(h) && /data-act="ev-wait"/.test(h));
  assert.ok(/role="switch"[^>]*aria-checked="true"/.test(h) && /data-act="ev-format" data-id="report" aria-pressed="false"/.test(h));
  assert.ok(/1 file left out/.test(h) && /&lt;b&gt;\.tmp/.test(h), 'people.json is said once, in the privacy line; the rest are listed, escaped');
  h = V.evidence(ctx, Object.assign({}, base, { stage: 'work', progress: { phase: 'read', done: 3, total: 14 } }));
  assert.ok(/Reading 3 of 14 files… Hashing…/.test(h) && /data-act="ev-cancel"/.test(h) && /<progress[^>]*value="21"/.test(h));
  h = V.evidence(ctx, Object.assign({}, base, { stage: 'done', result: { name: 'evidence-<x>.zip', digest: 'ab'.repeat(32), size: 2048, status: 'partial', unresolved: ['The run changed while this pack was made: <i>notes-w3.jsonl</i> grew.'] } }));
  assert.ok(/data-act="ev-save"/.test(h) && h.includes('SHA-256 of this pack:') && h.includes('ab'.repeat(32)) && /Keep it somewhere separate/.test(h) && /data-act="ev-copy"/.test(h));
  assert.ok(/Partial\./.test(h) && /&lt;i&gt;notes-w3\.jsonl/.test(h) && /evidence-&lt;x&gt;\.zip/.test(h));
  h = V.evidence(ctx, Object.assign({}, base, { stage: 'ask', scope: {}, form: { process: '', from: '2026-10-01', through: '2026-10-31' }, err: 'The first day (2026-11-01) is after the last day (2026-10-31).', fieldErr: 'ev-through' }));
  assert.ok(/<label for="ev-proc">/.test(h) && /<label for="ev-from">/.test(h) && /<label for="ev-through">/.test(h) && /id="ev-through"[^>]*aria-invalid="true" aria-describedby="ev-err"/.test(h) && /id="ev-err" role="alert"/.test(h));
  function U(t) { return PF.util.esc(t); }
});

rule('Export evidence is offered on the receipt, in the run\'s More menu and on Runs', () => {
  const { ctx, state } = setup(r => { r.ended = { outcome: 'Completed', by: 'person-casey', at: NOW }; r.state = 'completed'; });
  state.view = 'receipt';
  assert.ok(/data-act="ev-open" data-id="release\/run1"/.test(V.receipt(ctx)));
  state.view = 'run';
  assert.ok(/data-act="ev-open" data-id="release\/run1"/.test(V.run(ctx)));
  ctx.fuList = () => []; V.fuList = () => [];
  assert.ok(/data-act="ev-range"/.test(V.runs(Object.assign(ctx, { state: Object.assign(state, { view: 'runs', filter: 'all' }) }))));
});


rule('The run\'s More menu offers Copy run key, with the key other apps use (process/run)', () => {
  const { ctx } = setup();
  assert.ok(/<button type="button" class="mini" data-act="copy-run-key" data-id="release\/run1">Copy run key<\/button>/.test(V.run(ctx)));
});

/* ---------- 1.19 slice 1: proposals and who's editing (docs/design.md section 27) ---------- */
function proposalPage(extra) {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest, md = latest.md;
  const p = Object.assign({ id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md }, draftChanged: false }, extra || {});
  ctx.processes = () => [p]; ctx.data.validations = []; state.processId = 'release'; state.view = 'process';
  return { ctx, state, p, md };
}
const item = (id, fit, st, more) => Object.assign({ id, fit, rec: { state: st || 'pending', auto: (st || 'pending') === 'pending' }, meta: { id, process: 'release', session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: NOW, note: 'Added the smoke-test step', base: { kind: 'draft' }, size: 1000 } }, more || {});

rule('Process page: proposals are listed with what each is waiting for, and Review, Apply, Decline and Reopen where they apply', () => {
  const { ctx, p } = proposalPage();
  p.proposed = { list: [item('p-a1-aaaaaaaaaa', 'ready'), item('p-a2-bbbbbbbbbb', 'older'), item('p-a3-cccccccccc', 'already', 'maybe'), item('p-a4-dddddddddd', 'declined', 'declined'), item('p-a5-eeeeeeeeee', 'waiting'), item('p-a6-ffffffffff', 'applied-twice', 'applied-twice'), item('p-a7-gggggggggg', 'ready', 'decided-twice'), item('p-a8-hhhhhhhhhh', 'replaced')], bad: [{ name: 'p-zz-zzzzzzzzzz.json', why: 'doesn\'t match its hash yet' }], older: 40 };
  const html = V.process(ctx);
  assert.ok(/id="pp-h"[^>]*>Proposed changes · 8</.test(html), 'a panel with how many');
  assert.ok(/Added the smoke-test step/.test(html), 'what the assistant said it did');
  assert.ok(/data-act="prop-apply" data-id="p-a1-aaaaaaaaaa"/.test(html), 'a fast-forward with no records: Apply');
  assert.ok(!/data-act="prop-apply" data-id="p-a2-bbbbbbbbbb"/.test(html) && /This started from an older draft\./.test(html), 'not a fast-forward: waits, with Review');
  assert.ok(/May already be applied/.test(html) && !/data-act="prop-apply" data-id="p-a3-cccccccccc"/.test(html), 'tried before: Review first');
  assert.ok(/data-act="prop-reopen" data-id="p-a4-dddddddddd"/.test(html) && !/data-act="prop-apply" data-id="p-a4/.test(html), 'declined: Reopen');
  assert.ok(/Waiting for an earlier proposal/.test(html) && /Applied twice/.test(html) && /Decided twice/.test(html) && /Replaced by a newer proposal/.test(html));
  assert.ok(/data-act="prop-review" data-id="p-a2-bbbbbbbbbb"/.test(html) && /data-act="prop-decline" data-id="p-a1-aaaaaaaaaa"/.test(html));
  assert.ok(/1 proposal can.t be read yet/.test(html), 'one that can\'t be read yet is named');
  assert.ok(/and 40 older proposals/.test(html));
});

rule('Process page: a process with only a proposal has a page that says so, and Processes lists it', () => {
  const { ctx, state, p } = proposalPage({ latest: null, all: [], draft: null, title: 'onboard', id: 'onboard', proposedOnly: true });
  state.processId = 'onboard';
  p.proposed = { list: [item('p-a1-aaaaaaaaaa', 'ready')], bad: [], older: 0 };
  const html = V.process(ctx);
  assert.ok(/Proposed, not drafted yet/.test(html) && /data-act="prop-review"/.test(html), html.slice(0, 400));
  state.view = 'processes';
  assert.ok(/Proposed, not drafted yet/.test(V.processesPage(ctx)));
});

rule('Who is editing: the process page and the editor say who and on which computer, as far as this computer can see, and Edit becomes Edit anyway', () => {
  const { ctx, state, p, md } = proposalPage();
  p.editing = [{ writer: 'w2', by: 'person-avery', device: 'Windows · Edge', ago: 8000, main: false }];
  let html = V.process(ctx);
  assert.ok(/Being edited by Avery Lee on Windows · Edge<\/b> \(seen 8 seconds ago\)/.test(html), html.match(/Being edited[^<]*/));
  assert.ok(/Flightdeck shows the editors this computer can see right now\./.test(html));
  assert.ok(/data-act="ptab" data-id="edit"[^>]*>[\s\S]{0,3000}Edit anyway</.test(html), 'Edit anyway');
  state.ptab = 'edit'; state.editor = { pid: 'release', base: md, baseHash: 'x', text: null };
  html = V.process(ctx);
  assert.ok(/Being edited by Avery Lee on Windows · Edge/.test(html), 'in the editor too');
  assert.ok(/data-act="main-editor"[^>]*>Make this the main editor</.test(html));
  p.main = { me: false, ambiguous: true, claimRev: 3 };
  assert.ok(/Two editors claimed this draft at once\. Choose Make this the main editor to settle it\./.test(V.process(ctx)));
  p.main = { me: false, ambiguous: false, by: 'person-avery', lost: true };
  assert.ok(/Avery Lee made their editor the main one for this draft\. You can still edit and save\./.test(V.process(ctx)));
  p.main = { me: true, ambiguous: false };
  assert.ok(/This is the main editor for this draft\./.test(V.process(ctx)));
});

rule('Editor: a proposal that arrives says so with Review, and with unsaved changes says it waits for review; the size shows from 90%', () => {
  const { ctx, state, p, md } = proposalPage();
  state.ptab = 'edit'; state.builder = false;
  state.editor = { pid: 'release', base: md, baseHash: 'x', text: null };
  p.proposed = { list: [item('p-a1-aaaaaaaaaa', 'ready')], bad: [], older: 0 };
  let html = V.process(ctx);
  assert.ok(/Your AI assistant proposed changes\./.test(html) && /data-act="prop-review" data-id="p-a1-aaaaaaaaaa"/.test(html), 'with Review');
  state.editor.text = md + '\nmine';
  html = V.process(ctx);
  assert.ok(/Your AI assistant proposed changes while you have unsaved ones\. They.ll wait for you to review them\./.test(html));
  state.editor.text = md + '\n' + 'x'.repeat(Math.floor(0.95 * 1048576));
  assert.ok(/0\.95 of 1 MB/.test(V.process(ctx)), 'the size in the header');
  // The notice region is not a live region: messages are announced once, through #live.
  assert.ok(!/class="fpe-alerts"[^>]*aria-live/.test(V.process(ctx)));
});

rule('Editor, slice 2: a change from your AI assistant is highlighted with words on its steps; the notices and messages there have no live role (#live announces them once)', () => {
  const { ctx, state, p, md } = proposalPage();
  state.ptab = 'edit'; state.builder = true;
  state.editor = { pid: 'release', base: md, baseHash: 'x', text: null, incoming: { keys: { 'step:flags': true }, who: 'assistant' } };
  p.proposed = { list: [item('p-a1-aaaaaaaaaa', 'older')], bad: [], older: 0 };
  state.msg = { text: 'Your AI assistant changed this draft: 1 step changed. Undo available.', kind: 'good', act: 'tl-undo', id: 'draft', label: 'Undo' };
  const html = V.process(ctx);
  assert.ok(/class="ob-step[^"]*\bob-inc\b[^"]*"[^>]*data-ob-step="flags"/.test(html), 'the changed step is marked');
  assert.ok(/<span class="ob-inc-t">Changed by your AI assistant<\/span>/.test(html), 'in words, not only a color');
  assert.strictEqual((html.match(/ob-inc-t/g) || []).length, 1, 'only that step');
  const alerts = html.slice(html.indexOf('class="fpe-alerts"'), html.indexOf('</div>', html.indexOf('Your AI assistant proposed changes')));
  assert.ok(/Your AI assistant changed this draft: 1 step changed\. Undo available\./.test(alerts) && /data-act="tl-undo"/.test(alerts) && /data-act="dismiss"/.test(alerts));
  assert.ok(!/role="(status|alert)"[^>]*><span>(Your AI assistant|This draft)/.test(alerts), 'no live role on these notices');
  state.editor.incoming.who = 'folder';
  assert.ok(/<span class="ob-inc-t">Changed in the team folder<\/span>/.test(V.process(ctx)));
  // Phone width: the words wrap with the row (no fixed widths), and the tokens exist in both themes (page.html).
  const page = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'page.html'), 'utf8');
  assert.strictEqual((page.match(/--incoming:/g) || []).length, 3, 'light, and both dark blocks');
  assert.strictEqual((page.match(/--on-incoming:/g) || []).length, 3);
});

rule('Review: the change against the draft, its checks, what happened before, and the right actions; nothing from the file reaches the page unescaped', () => {
  const { ctx, md } = proposalPage();
  const evil = '<img src=x onerror=alert(1)>';
  const text = md.replace('title: Production release', 'title: ' + evil);
  const ov = { propReview: true, pid: 'release', id: 'p-a1-aaaaaaaaaa', item: item('p-a1-aaaaaaaaaa', 'ready', 'pending', { meta: Object.assign(item('x', 'ready').meta, { id: 'p-a1-aaaaaaaaaa', note: evil, label: evil }) }), proposal: { text, base: { kind: 'draft', text: md } }, draftText: md, records: [], reviewed: [] };
  let html = V.proposalReview(ctx, ov);
  assert.ok(!/<img/.test(html) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(html), 'escaped');
  assert.ok(/role="dialog"/.test(html) && /aria-modal="true"/.test(html) && /id="pr-t"/.test(html));
  assert.ok(/class="add">\+ title: &lt;img/.test(html), 'the change, line by line');
  assert.ok(/data-act="prop-apply"/.test(html) && /data-act="prop-decline"/.test(html));
  // An interrupted attempt: compare, Mark as applied, Apply again.
  ov.item = item('p-a1-aaaaaaaaaa', 'ready', 'maybe');
  ov.records = [{ name: 'p-a1-aaaaaaaaaa.attempt.w8d2k4.1.json', sha: 'a'.repeat(64), rec: { kind: 'attempt', attempt: 'w8d2k4.1', how: 'apply', by: 'person-casey', at: NOW } }];
  html = V.proposalReview(ctx, ov);
  assert.ok(/Flightdeck started applying this but couldn.t record what happened\./.test(html) && /data-act="prop-mark-applied"/.test(html) && />Apply again</.test(html));
  // Already in the draft: Mark as applied, never Apply.
  ov.item = item('p-a1-aaaaaaaaaa', 'already', 'maybe'); ov.draftText = text;
  html = V.proposalReview(ctx, ov);
  assert.ok(/Already in the draft/.test(html) && /data-act="prop-mark-applied"/.test(html) && !/data-act="prop-apply"/.test(html));
  // Not a fast-forward: says so, no Apply.
  ov.item = item('p-a1-aaaaaaaaaa', 'older'); ov.draftText = md + '\nmore';
  html = V.proposalReview(ctx, ov);
  assert.ok(/This started from an older draft\./.test(html) && !/data-act="prop-apply"/.test(html));
  // A record that can't be read: says which file, no Apply.
  ov.item = item('p-a1-aaaaaaaaaa', 'unknown', 'unknown'); ov.draftText = md;
  ov.records = [{ name: 'p-a1-aaaaaaaaaa.zz.1.json', sha: 'b'.repeat(64), rec: null }];
  html = V.proposalReview(ctx, ov);
  assert.ok(/p-a1-aaaaaaaaaa\.zz\.1\.json/.test(html) && /can.t be read/.test(html) && !/data-act="prop-apply"/.test(html));
  // Thousands of changed lines: too many to show line by line.
  ov.item = item('p-a1-aaaaaaaaaa', 'ready'); ov.records = [];
  ov.proposal = { text: Array.from({ length: 5000 }, (x, i) => 'b' + i).join('\n'), base: { kind: 'draft', text: '' } };
  ov.draftText = Array.from({ length: 5000 }, (x, i) => 'a' + i).join('\n');
  assert.ok(/Too many changes to show line by line/.test(V.proposalReview(ctx, ov)));
});

rule('Draft builder: a step\'s Screenshots section shows thumbnails with their captions as alt text, labeled controls, and a place to add more, all escaped', () => {
  const { ctx, state } = setup();
  const md = ['---', 'process: x', 'title: X', '---', '## One · READ-DO {#one}', '- [ ] {confirm} Alpha {#alpha}', '  ![The <b>flags</b> "page"](images/x/alpha-1.png)', '  ![Second <script>alert(1)</script>](images/x/alpha-2.png)', '- [ ] {confirm} Beta {#beta}', ''].join('\n');
  const p = { id: 'x', title: 'X', latest: null, all: [], clashes: [], broken: [], skills: [], draft: { file: 'x.md', md }, draftChanged: true };
  const asked = [];
  ctx.processes = () => [p]; ctx.data.validations = []; state.view = 'process'; state.processId = 'x'; state.ptab = 'edit'; state.builder = true;
  ctx.img = (src, caption, full, own) => { asked.push([src, own]); return '<img alt="' + PF.util.esc(caption) + '" src="blob:test">'; };
  state.editor = { pid: 'x', base: md, baseHash: 'x', text: null };
  state.obSel = { pid: 'x', kind: 'step', key: 'alpha' };
  let html = V.process(ctx);
  assert.ok(/<h3 class="ob-sec" id="ob-shots-h">Screenshots<\/h3>/.test(html), 'a Screenshots heading');
  assert.ok(/<ol class="ob-shots" aria-labelledby="ob-shots-h">/.test(html), 'a list named by it');
  assert.ok(/<img alt="The &lt;b&gt;flags&lt;\/b&gt; &quot;page&quot;"/.test(html), 'alt text is the caption, escaped');
  assert.ok(!/<script>alert|<b>flags/.test(html), 'nothing raw');
  assert.deepStrictEqual(asked.map(a => a[1]), [true, true], 'thumbnails come from the folder\'s images/, never a run\'s publication');
  assert.ok(/<label class="field" for="ob-shot-cap-0">Caption<span class="sr"> for screenshot 1 of 2<\/span><input id="ob-shot-cap-0" maxlength="200" data-enter="ob-commit" value="The &lt;b&gt;flags&lt;\/b&gt; &quot;page&quot;">/.test(html), 'each caption is a labeled box');
  assert.ok(/data-act="ob-shot-move" data-id="0" data-dir="up" aria-label="Move screenshot 1 up">Move up</.test(html) && /data-act="ob-shot-move" data-id="1" data-dir="down" aria-label="Move screenshot 2 down">Move down</.test(html), 'reorder buttons name which one');
  assert.ok(/data-act="ob-shot-remove" data-id="1" aria-label="Remove screenshot 2: Second &lt;script&gt;alert\(1\)&lt;\/script&gt;">Remove</.test(html), 'Remove names it');
  assert.ok(/Removing takes it out of this draft only\. The image file stays in the folder/.test(html), 'and says the file stays');
  assert.ok(/<div class="ob-shot-add" data-drop="shots" data-id="alpha" role="group" aria-labelledby="ob-shot-add-h">/.test(html), 'a drop zone for this step');
  assert.ok(/<label class="field" for="ob-shot-new">Caption for the next screenshot<input id="ob-shot-new" maxlength="200" data-nav-safe/.test(html), 'the caption for new images is labeled');
  assert.ok(/<label class="btn" for="ob-shot-file">[\s\S]*?Choose files<\/label><input type="file" id="ob-shot-file" class="sr" accept="\.png,\.jpg,\.jpeg,\.webp,\.gif,image\/png,image\/jpeg,image\/webp,image\/gif" multiple aria-describedby="ob-shot-hint">/.test(html), 'Choose files: images only');
  assert.ok(/id="ob-shot-hint">Or drop or paste images here\. PNG, JPEG, WebP or GIF, up to 5 MB each\./.test(html), 'how else to add');
  assert.ok(/<p class="small" id="ob-shot-status" role="status"><\/p>/.test(html), 'a status line, quiet until something is added');
  ctx.shotBusy = () => 2; html = V.process(ctx);
  assert.ok(/id="ob-shot-status" role="status">Adding 2 screenshots…<\/p>/.test(html), 'says what it\'s doing');
  state.fieldErr = { id: 'ob', field: 'ob-shot-file', msg: 'Couldn\'t add "<x>.png": no.' }; html = V.process(ctx);
  assert.ok(/<input type="file" id="ob-shot-file"[^>]* aria-invalid="true" aria-describedby="ferr-ob-shot-file ob-shot-hint"/.test(html) && /<p class="ferr" id="ferr-ob-shot-file" role="alert">Couldn&#39;t add &quot;&lt;x&gt;\.png&quot;: no\.<\/p>/.test(html), 'a refusal shows next to Choose files');
  state.obSel = { pid: 'x', kind: 'step', key: 'beta' }; state.fieldErr = null; ctx.shotBusy = null; html = V.process(ctx);
  assert.ok(/No screenshots yet\./.test(html) && !/class="ob-shots"/.test(html), 'a step without any');
});

rule('Requests: a requested plan names its tool as a claim on Runs, on Home and before starting; copies are said, and differing copies can\'t be started', () => {
  const { ctx, state } = setup();
  const latest = ctx.data.processes[0].index.latest;
  ctx.processes = () => [{ id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: null }];
  const id = 'req-ci-check-' + 'a'.repeat(24), base = { kind: 'plan', id, process: 'release', version: 1, title: 'Backup <b>check</b>', details: {}, roles: {}, note: 'Requested by ci-check.', by: 'ci-check 1.4.0 (a tool)', created: NOW, _file: id + '.json', _hash: 'h1', _copies: 1, _copiesDiffer: false };
  ctx.data.plans = [base];
  const runs = V.runs(ctx), home = V.home(ctx);
  assert.ok(/requested by ci-check, by its own account/.test(runs), 'Runs: ' + runs);
  assert.ok(/ci-check requested/.test(home) && /by its own account/.test(home), 'Home');
  assert.ok(!/<b>check<\/b>/.test(runs + home), 'escaped');
  state.view = 'start'; state.processId = 'release'; state.planId = id;
  let html = V.start(ctx);
  assert.ok(/Requested by ci-check 1\.4\.0, by its own account\. Flightdeck can(&#39;|')t confirm which tool or person wrote this file\. Nothing starts until you start it\./.test(html), html);
  assert.ok(/id="start-submit"(?![^>]*disabled)/.test(html), 'a person can start it');
  // A tool name that tries to look like markup is escaped wherever it shows.
  ctx.data.plans = [Object.assign({}, base, { by: 'ci-check 1.4.0<img src=x> (a tool)' })];
  assert.ok(!/<img/.test(V.runs(ctx) + V.home(ctx) + V.start(ctx)));
  // A plan whose by only looks like a tool's, without a request's name, is shown as any plan.
  ctx.data.plans = [Object.assign({}, base, { id: 'plan-release-x' })];
  state.planId = 'plan-release-x';
  assert.ok(!/by its own account/.test(V.start(ctx) + V.runs(ctx)) && /planned by ci-check 1\.4\.0 \(a tool\)/.test(V.runs(ctx)));
  // Two identical copies: once, with a line; two different ones: both, flagged, and Start is off.
  ctx.data.plans = [Object.assign({}, base, { _copies: 2 })]; state.planId = id;
  assert.ok(/This request arrived twice/.test(V.runs(ctx)) && /This request arrived twice/.test(V.start(ctx)));
  ctx.data.plans = [Object.assign({}, base, { _copies: 2, _copiesDiffer: true, _files: [id + '.json', id + '-LAPTOP.json'] }), Object.assign({}, base, { title: 'Other', _hash: 'h2', _copies: 2, _copiesDiffer: true, _file: id + '-LAPTOP.json', _files: [id + '.json', id + '-LAPTOP.json'] })];
  const flagged = V.runs(ctx);
  assert.strictEqual((flagged.match(/Two different copies of this request are in the folder/g) || []).length, 2);
  assert.strictEqual((flagged.match(new RegExp('id="card-' + id + '"', 'g')) || []).length, 1, 'element ids stay unique');
  html = V.start(ctx);
  assert.ok(/id="start-submit"[^>]*disabled/.test(html) && /-LAPTOP\.json/.test(html) && /delete the wrong one/.test(html), html);
});

/* ---------- 2.0: phase and gate notes and screenshots in runs (and gate notes for every version, D15) ---------- */
const NOTED = ['---', 'process: backup', 'title: Backup check', 'owner: person-avery', 'roles: lead', '---', '', '## Prepare {#prep}', '  > Use the **scratch** server. <script>bad()</script>', '  ![The <b>scratch</b> server](images/b/scratch.png)',
  '- [ ] {confirm} Read the runbook @lead {#read}', '', '## Gate: Restored {#restored}', '  > The restored copy opens.', '  ![Row counts](images/b/counts.png)', '', '## Close {#close}', '- [ ] {confirm} File the report @lead {#file}', ''].join('\n');
function notedRun(md) {
  const images = {}, imageBytes = {};
  ['images/b/scratch.png', 'images/b/counts.png'].forEach((src, k) => { if (md.indexOf(src) >= 0) { images[src] = PF.util.hash(String.fromCharCode(k + 1)); imageBytes[src] = new Uint8Array([k + 1]); } });
  const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, rand: 'note0001', app: '2.0.0', images, imageBytes });
  const pub = P.verify(b.folder, b.files, exactOf(PF, b.files)); assert.ok(pub.ok, pub.why);
  const { ctx, state } = setup(), r = R.create(pub, { title: 'Backup', roles: { lead: 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, id: 'run9' });
  r._notes = []; r._conflicts = []; ctx.run = () => r; ctx.data.runs = [r];
  ctx.img = (src, cap) => '<img data-src="' + src + '" alt="' + PF.util.esc(cap) + '">';
  return { r, ctx, state, pub };
}
rule('Run screen: a phase\'s note and screenshots show at the top of the phase, escaped, and fold away with the phase once it\'s done', () => {
  const { r, ctx, state } = notedRun(NOTED);
  assert.strictEqual(r.format, 'preflight-run/3', 'set-up: a 2.0 run');
  let html = V.run(ctx);
  const ph = html.slice(html.indexOf('<section class="phase" id="phase-prep"'), html.indexOf('<section class="phase" id="phase-close"'));
  assert.ok(/class="ph-note"/.test(ph) && /<strong>scratch<\/strong>/.test(ph), 'the note, as Markdown');
  assert.ok(!/<script>bad/.test(html) && !/<b>scratch<\/b>/.test(html), 'nothing raw');
  assert.ok(/data-act="zoom-phase" data-id="prep" data-i="0" aria-label="Expand: The &lt;b&gt;scratch&lt;\/b&gt; server"/.test(ph), 'a thumbnail that opens larger, labeled by its caption');
  assert.ok(ph.indexOf('class="ph-note"') < ph.indexOf('data-id="read"'), 'above the steps');
  R.done(r, R.mapOf(r), 'read', 'person-casey', NOW, {}); R.pass(r, R.mapOf(r), 0, 'person-casey', NOW);
  state.unfold = {};
  html = V.run(ctx);
  const done = html.slice(html.indexOf('<section class="phase" id="phase-prep"'), html.indexOf('<section class="phase" id="phase-close"'));
  assert.ok(!/class="ph-note"/.test(done), 'folded with the phase once it\'s done');
  state.unfold = { prep: true };
  assert.ok(/class="ph-note"/.test(V.run(ctx)), 'Show steps shows it again');
});
rule('Run screen: a gate\'s note shows above Pass the gate for every version, a 1.x version included, and a 2.0 gate\'s screenshots with it', () => {
  const { ctx } = notedRun(NOTED);
  let html = V.run(ctx), g = html.slice(html.indexOf('id="gate-restored"'));
  assert.ok(/class="note g-note"/.test(g) && /The restored copy opens\./.test(g));
  assert.ok(g.indexOf('g-note') < g.indexOf('Pass the gate'), 'above Pass the gate');
  assert.ok(/data-act="zoom-gate" data-id="restored" data-i="0"/.test(g), 'the gate\'s screenshot');
  const one = notedRun(NOTED.replace('  > Use the **scratch** server. <script>bad()</script>\n  ![The <b>scratch</b> server](images/b/scratch.png)\n', '').replace('  ![Row counts](images/b/counts.png)\n', ''));
  assert.strictEqual(one.pub.info.format, 'preflight-publication/1'); assert.strictEqual(one.r.format, 'preflight-run/2');
  g = V.run(one.ctx); g = g.slice(g.indexOf('id="gate-restored"'));
  assert.ok(/class="note g-note"/.test(g) && /The restored copy opens\./.test(g), 'a /1 version\'s gate note shows too (D15)');
});
rule('Flight plan: a phase\'s note and screenshots and a gate\'s note get a marker, in words', () => {
  const { ctx, state } = flightSetup(), map = PF.map.parse(NOTED);
  const html = V.flightPlan(ctx, { id: 'backup', title: 'Backup check', skills: [] }, map, null);
  assert.ok(/<b>Phase note<\/b> a note and 1 screenshot at the start of this phase/.test(html), html.slice(0, 400));
  assert.ok(/<b>Gate note<\/b> a note and 1 screenshot at the gate/.test(html));
  state.x = 1;
});


/* ---------- Conditions (2.1): one muted line on the process page and the flight plan ---------- */
const CONDMD = ['---', 'process: cond', 'title: Cond', 'context: risk:choice(low|high), ticket', '---', '',
  '## Hotfix · READ-DO {#hot}', '  only when ^ticket is set', '- [ ] {confirm} Page the lead {#page}', '',
  '## Release · READ-DO {#rel}', '- [ ] {confirm} Tell the board {#board}', '  only when ^risk is high', '- [ ] {confirm} Ship it {#ship}', ''].join('\n');
rule('Conditions: the process page and the flight plan show each condition as one muted line, and nothing without one', () => {
  const map = PF.map.parse(CONDMD);
  const pv = V.mapPreview(map, {}, [], 'cl-ph-');
  assert.strictEqual((pv.match(/class="pv-when"/g) || []).length, 2, 'the phase and the step');
  assert.ok(/<p class="pv-when">Only when <b class="dname">ticket<\/b> is set<\/p>/.test(pv), pv);
  assert.ok(/<span class="pv-when">Only when <b class="dname">risk<\/b> is high<\/span>/.test(pv), pv);
  const { ctx } = flightSetup();
  const fp = V.flightPlan(ctx, { id: 'cond', title: 'Cond', skills: [] }, map, null);
  assert.ok(/<div class="fp-line fp-when">[\s\S]*?<span>Only when <b class="dname">ticket<\/b> is set<\/span><\/div>/.test(fp), 'the phase, on its card');
  assert.ok(/<span class="pv-when">Only when <b class="dname">risk<\/b> is high<\/span>/.test(fp), 'the step, in its list');
  const plain = PF.map.parse(CONDMD.split('\n').filter(l => !/only when/.test(l)).join('\n'));
  assert.ok(!/when/i.test(V.mapPreview(plain, {}, [], 'cl-ph-')) && !/Only when|fp-when/.test(V.flightPlan(ctx, { id: 'cond', title: 'Cond', skills: [] }, plain, null)), 'nothing without conditions');
  const hostile = PF.map.parse(CONDMD.replace('context: risk:choice(low|high), ticket', 'context: risk:choice(low|<b>x</b>|high), ticket').replace('^risk is high', '^risk is one of <b>x</b>|high'));
  assert.ok(!/<b>x<\/b>/.test(V.mapPreview(hostile, {}, [], 'cl-ph-')), 'escaped');
});

rule('Conditions: the readiness panel names a conditional step no clean run has needed yet, escaped, and says nothing otherwise', () => {
  const md = CONDMD.replace('Tell the board', 'Tell the <b>board</b>');
  const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'cond0001', app: '2.1.0' });
  assert.ok(!b.blockers, (b.blockers || []).join(' | '));
  const pub = P.verify(b.folder, b.files, exactOf(PF, b.files));
  const done = (k, risk) => {
    const r = R.create(pub, { title: 'R' + k, details: { ticket: 'T', risk }, roles: {}, by: 'person-casey', session: 'me', now: NOW, id: 'run-' + k, app: '2.1.0' }), map = R.mapOf(r);
    map.phases.forEach((ph, i) => { ph.steps.forEach(s => { if (R.applies(r, map, i, s).applies === true) R.done(r, map, s.id, 'person-casey', NOW, {}); }); R.pass(r, map, i, 'person-casey', NOW); });
    R.end(r, map, 'Completed', 'person-casey', 'Casey', NOW); r.marksFrom = 'start'; r._conflicts = [];
    return r;
  };
  const { ctx } = flightSetup();
  ctx.data.runs = [done('a', 'low')];
  const h = V.readyPanel(ctx, { id: 'cond' }, pub);
  assert.ok(/<p class="small">Not yet seen in a clean run: Tell the &lt;b&gt;board&lt;\/b&gt;\.<\/p>/.test(h), h);
  ctx.data.runs.push(done('b', 'high'));
  assert.ok(!/Not yet seen/.test(V.readyPanel(ctx, { id: 'cond' }, pub)), 'seen once a clean run needed it');
  ctx.data.runs = [];
  assert.ok(!/Not yet seen/.test(V.readyPanel(ctx, { id: 'cond' }, pub)), 'no clean runs: the count says it');
});

/* ---------- 2.0 pins and skills: every value from a file is escaped (review round 5) ---------- */
const HOSTILE = '<img src=x onerror=alert(1)>"><svg onload=1>javascript:alert(\'x\')';
const HOSTILE1 = '<img/src=x/onerror=alert(1)>"><svg/onload=1>';
/* No markup from a value: none of its img or svg elements (the app's own icons are svg), and no tag with an onerror or onload attribute once its quoted attribute
   values (escaped, so they can't end early) are set aside. */
function inert(html, what) {
  assert.ok(!/<(img|svg)[\s/]+(src=x|onload)/i.test(html), what + ': a value\'s img or svg element got through: ' + (html.match(/.{0,80}<(img|svg)[\s/]+(src=x|onload).{0,80}/i) || [''])[0]);
  (html.match(/<[a-z][^>]*>/gi) || []).forEach((tag) => {
    const bare = tag.replace(/"[^"]*"/g, '""');
    assert.ok(!/\son(error|load)\b/i.test(bare) && !/'/.test(bare), what + ': an attribute broke out: ' + tag);
  });
  assert.ok(!/href="javascript:/i.test(html), what + ': a javascript: link');
}
rule('Pins and skills screens escape every value from a file: a pin mismatch, Start it as a Flightdeck 2.0 run, Continued in run, Link it, can\'t be matched, a plan that asks or switches', () => {
  // A run/3 parent pinned to a check-in version, whose linked child run says a hostile folder, title and version.
  const pin = { process: 'check-in', version: 1, folder: 'v1-abcd1234', mapHash: 'aaaaaaaa', typesHash: 'bbbbbbbb' };
  const { ctx, state, r } = setup();
  const pub = ctx.data.processes[0].index.latest;
  const three = JSON.parse(JSON.stringify(R.create(pub, { title: HOSTILE, details: { ticket: 'ABC-1', commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, explicit: true, app: '2.0.0', pins: { notes: pin } })));
  three._notes = []; three._conflicts = [];
  const kid = { process: 'check-in', id: 'k1', title: HOSTILE, folder: HOSTILE, version: HOSTILE, format: 'preflight-run/2', state: 'running', created: NOW, steps: {}, gates: {}, details: {}, log: [], parent: { process: 'release', id: three.id, step: 'notes', inputs: {} } };
  three.steps.notes = { s: 'open', child: { process: 'check-in', id: 'k1', inputs: {}, folder: HOSTILE } };
  const pubOf = { latest: pub, all: [pub], clashes: [], broken: [] };
  ctx.run = () => three; ctx.data.runs = [three, kid]; ctx.findRun = (k) => k === 'check-in/k1' ? kid : null; ctx.procOf = () => pubOf;
  state.unfold = { notes: true }; state.sel = 'notes';
  let html = V.run(ctx);
  assert.ok(/That check-in run is on /.test(html), 'set-up: the pin mismatch is shown, with the child\'s folder: ' + (html.match(/Child run:[^]{0,300}/) || [''])[0]);
  inert(html, 'pin mismatch');
  // A run/2 parent whose child is a 2.0 run: "Start it as a Flightdeck 2.0 run", from the child's own title and version.
  const two = JSON.parse(JSON.stringify(r)); two.steps.notes = { s: 'open', child: { process: 'check-in', id: 'k1', inputs: { changed: 'x' } } };
  const kid3 = Object.assign({}, kid, { format: 'preflight-run/3' });
  ctx.run = () => two; ctx.data.runs = [two]; ctx.findRun = (k) => k === 'check-in/k1' ? kid3 : null; ctx.procOf = null; ctx.latestPub = () => null;
  html = V.run(ctx);
  assert.ok(/Start it as a Flightdeck 2\.0 run/.test(html), 'set-up: the offer is shown');
  inert(html, 'Start it as a Flightdeck 2.0 run');
  // The same offer for an existing link, made by an older copy, to a 2.0 child with the details it was started for.
  two.steps.notes = { s: 'open', child: { process: 'check-in', id: 'k1', inputs: R.childDetails(two, PF.map.findStep(R.mapOf(two), 'notes').step, Object.keys(two.details)) } };
  html = V.run(ctx);
  assert.ok(/data-act="continue-two"/.test(html), 'set-up: the offer for a current legacy link');
  inert(html, 'a current legacy link to a 2.0 child');
  // Continued in run, with a hostile run key that a found run makes into a button.
  two.steps.notes = { s: 'blocked', by: 'person-casey', at: NOW, reason: 'Continued in run ' + HOSTILE1 };
  ctx.findRun = () => kid;
  html = V.run(ctx);
  assert.ok(/made with Flightdeck 2\.0/.test(html), 'set-up: continued');
  inert(html, 'Continued in run');
  // An orphan child offered with Link it: its title, process and ID.
  const inputs = R.childDetails(two, PF.map.findStep(R.mapOf(two), 'notes').step, Object.keys(two.details));
  const orphan = Object.assign({}, kid, { id: HOSTILE1, title: HOSTILE, parent: { process: 'release', id: two.id, step: 'notes', inputs } });
  two.steps.notes = { s: 'open' };
  ctx.data.runs = [two, orphan]; ctx.findRun = () => null; ctx.latestPub = () => pub;
  html = V.run(ctx);
  assert.ok(/data-act="link-child"/.test(html), 'set-up: Link it is offered');
  inert(html, 'Link it');
  // A {run.skill} step: what was registered when it was checked, and the warning when the folder registers another version.
  const sb = P.build('---\nprocess: hostile\ntitle: Hostile\n---\n## One {#one}\n- [ ] {run.skill} Write the notes {#write}\n  skill: notes\n  skillVersion: 1.0.0\n', { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, rand: 'viewhost' });
  assert.ok(!sb.blockers, JSON.stringify(sb.blockers));
  const spub = P.verify(sb.folder, sb.files, exactOf(PF, sb.files));
  const sr = JSON.parse(JSON.stringify(R.create(spub, { title: HOSTILE, by: 'person-casey', session: 'me', now: NOW, explicit: true, app: '2.0.0' })));
  sr.steps.write = { s: 'done', by: 'person-casey', at: NOW, skill: { id: 'sk-abcd1234', rev: 1, sha: 'a'.repeat(64), snapshot: { name: HOSTILE, version: '<svg/onload=1>"' } }, history: [{ s: 'open', by: 'person-casey', at: NOW, skill: { id: 'sk-abcd1234', rev: 1, sha: 'a'.repeat(64), snapshot: { name: HOSTILE, version: '"><img src=x>' } } }] };
  const srun = R.sanitize(sr);
  assert.ok(srun && !srun._unrunnable && srun.steps.write.skill, 'set-up: the observed registration is kept: ' + (srun && srun._unrunnable));
  srun._notes = []; srun._conflicts = [];
  ctx.run = () => srun; ctx.data.runs = [srun]; ctx.data.skills = [{ skill: { name: 'notes', version: HOSTILE, location: HOSTILE, file: HOSTILE }, errors: [] }];
  state.sel = 'write'; state.unfold = { write: true };
  html = V.run(ctx);
  assert.ok(/Registered as &lt;img/.test(html) && /The team folder registers &lt;img/.test(html), 'set-up: the observed registration and the warning are shown');
  inert(html, 'observed skill');
  inert(V.receipt(ctx), 'observed skill receipt');
  ctx.data.skills = []; state.sel = null; state.unfold = {};
  // Skills: a registration that can't be matched, with hostile fields everywhere, in the list and on its page.
  const sk = { name: HOSTILE, version: HOSTILE, location: 'javascript:alert(1)', description: HOSTILE, process: HOSTILE, implements: HOSTILE, steps: [HOSTILE1], group: [HOSTILE], tags: [HOSTILE], updated: HOSTILE, file: HOSTILE };
  const status = { s: 'unmatched', text: 'Can\'t be matched: ' + HOSTILE + ' (skill-registrations/' + HOSTILE + '/)' };
  const latest = Object.assign({}, pub, { info: Object.assign({}, pub.info, { version: HOSTILE, folder: HOSTILE }) });
  const proc = { id: 'release', title: HOSTILE, category: HOSTILE, group: [], tags: [], latest, all: [latest], clashes: [], broken: [], draft: null, skills: [{ skill: sk, errors: [HOSTILE], status }], staleSkills: 0 };
  ctx.processes = () => [proc];
  ctx.orphanSkills = () => [{ skill: Object.assign({}, sk, { file: 'orphan-' + HOSTILE }), errors: [HOSTILE], status }];
  ctx.data.runs = []; state.view = 'skills';
  html = V.skillsPage(ctx);
  assert.ok(/can&#39;t be matched|can't be matched/.test(html), 'set-up: listed as can\'t be matched');
  inert(html, 'skills list');
  inert(V.home(ctx), 'home');
  state.view = 'skill'; state.skillFile = HOSTILE;
  html = V.skill(ctx);
  assert.ok(/Can&#39;t be matched/.test(html), 'set-up: the skill page');
  inert(html, 'skill page');
  state.skillFile = 'orphan-' + HOSTILE;
  inert(V.skill(ctx), 'unmatched skill page');
  // A plan/2 whose pinned version can't be used asks; one whose version is older offers the switch.
  const plan = { format: 'flightdeck-plan/2', id: HOSTILE1, process: 'release', version: 1, title: HOSTILE, details: { ticket: HOSTILE }, roles: {}, by: HOSTILE, _hash: 'h1', pin: { process: 'release', version: HOSTILE, folder: 'v9-zzzzzzzz' } };
  ctx.data.plans = [plan]; ctx.suggestRole = () => null;
  state.view = 'start'; state.processId = 'release'; state.planId = HOSTILE1;
  proc.title = 'Release';
  html = V.start(ctx);
  assert.ok(/won&#39;t start on another version by itself|won't start on another version by itself/.test(html), 'set-up: the plan asks: ' + html.slice(0, 600));
  inert(html, 'plan asks');
  plan.pin = { process: 'release', version: 1, folder: pub.info.folder, mapHash: pub.info.mapHash, typesHash: pub.info.typesHash };
  const newer = Object.assign({}, pub, { info: Object.assign({}, pub.info, { version: 2, folder: 'v2-' + 'zzzzzzzz' }) });
  proc.latest = newer; proc.all = [newer, pub]; newer.info.version = HOSTILE;
  html = V.start(ctx);
  assert.ok(/data-act="plan-retarget"[^>]*>Start on v&lt;img/.test(html), 'set-up: the switch is offered: ' + (html.match(/plan-retarget[^]{0,200}/) || [''])[0]);
  inert(html, 'plan switch');
});


/* ---------- 2.0 run fields, fuzzed (review rounds 6 and 7) ---------- */
rule('Every run/3 field 2.0 added, set to a wrong type or a number JavaScript can\'t hold, either makes the run read-only (a save refuses, with nothing written) or round-trips exactly through a save after an unrelated edit, and the run, every step, the receipt and the evidence checks render without throwing or unescaped markup', async () => {
  const { ctx, state } = setup();
  const folder = new PF.fs.MemoryFS('fuzz3:' + Math.random(), null);
  await folder.write('people.json', JSON.stringify(people));
  await PF.repo.publish(folder, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW });
  const pub = (await PF.repo.loadAll(folder)).processes[0].index.latest, seed = Object.fromEntries(Object.keys(folder.files).map(k => [k, folder.files[k].t]));
  ctx.data.processes = [{ process: 'release', pubs: [pub], index: { latest: pub } }];
  const map = R.mapOf(R.create(pub, { by: 'a', session: 'me', now: NOW }));
  const ids = PF.map.steps(map).map(x => x.step.id), skillStep = ids.find(id => id !== 'notes');
  const pin = { process: 'check-in', version: 1, folder: 'v1-abcd1234', mapHash: 'aaaaaaaa', typesHash: 'bbbbbbbb' };
  const seen = { id: 'sk-abcd1234', rev: 2, sha: 'a'.repeat(64), snapshot: { name: 'release-notes', version: '1.2.0', implements: { process: 'release', folder: 'v1-abcd1234', mapHash: 'aaaaaaaa', typesHash: 'bbbbbbbb' }, steps: [skillStep], location: 'https://example.com/x', description: 'Writes notes' } };
  const base = JSON.parse(JSON.stringify(R.create(pub, { title: 'Fuzz', details: { ticket: 'ABC-1', commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, explicit: true, app: '2.0.0', pins: { notes: pin }, id: 'fuzz1' })));
  base.steps[skillStep] = { s: 'done', by: 'person-casey', at: NOW, skill: seen, history: [{ s: 'open', by: 'person-casey', at: NOW, skill: seen }] };
  base.steps.notes = { s: 'open', child: { process: 'check-in', id: 'k1', inputs: { ticket: 'ABC-1' }, folder: 'v1-abcd1234' } };
  base.parent = { process: 'release', id: 'p1', step: 'notes', inputs: { ticket: 'ABC-1' }, folder: 'v1-abcd1234' };
  const ok = R.sanitize(JSON.parse(JSON.stringify(base)));
  assert.ok(ok && !ok._unrunnable && ok.steps[skillStep].skill && ok.steps.notes.child.folder === 'v1-abcd1234' && ok.parent.folder === 'v1-abcd1234', 'set-up: the base run reads back writable, in full: ' + (ok && ok._unrunnable));
  const S = 'steps.' + skillStep + '.skill', H = 'steps.' + skillStep + '.history.0.skill';
  const paths = [S, S + '.id', S + '.rev', S + '.sha', S + '.snapshot', S + '.snapshot.name', S + '.snapshot.version', S + '.snapshot.implements', S + '.snapshot.implements.folder',
    S + '.snapshot.steps', S + '.snapshot.steps.0', S + '.snapshot.location', S + '.snapshot.description', S + '.snapshot.extra',
    H, H + '.rev', H + '.snapshot', H + '.snapshot.name', H + '.snapshot.version', H + '.snapshot.steps',
    'pins', 'pins.children', 'pins.children.notes', 'pins.children.notes.folder', 'pins.children.notes.version', 'pins.children.notes.mapHash', 'pins.children.notes.process',
    'steps.notes.child.folder', 'parent.folder', 'payload', 'payload.pins', 'payload.pins.children', 'payload.map', 'payload.images', 'features', 'typesHash', 'app', 'migrations'];
  const MARK = 'ZQXMARK';
  // A number JavaScript can't hold exactly is written into the file as text: JSON.stringify could never write it.
  const NUM = (t) => ({ __num: t });
  const BAD = [['toString-null', { toString: null, valueOf: null, v: MARK }], ['array', [MARK]], ['number', 42], ['null', null], ['huge', MARK + 'x'.repeat(200000)], ['nested', { a: { b: [MARK, { c: MARK }] } }], ['markup', '<img src=x onerror=alert(1)>' + MARK],
    ['1e999', NUM('1e999')], ['-1e999', NUM('-1e999')], ['2^53+1', NUM('9007199254740993')], ['NaN text', 'NaN'], ['Infinity text', 'Infinity'], ['-0 text', '-0']];
  const set = (o, p, v) => { const ks = p.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) { if (x[ks[i]] == null || typeof x[ks[i]] !== 'object') x[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; x = x[ks[i]]; } x[ks[ks.length - 1]] = v; };
  const at = (o, p) => p.split('.').reduce((x, k) => x == null ? undefined : x[k], o);
  const fileOf = (raw) => JSON.stringify(raw, null, 2).replace(/\{\s*"__num": "([^"]+)"\s*\}/g, '$1');
  let n = 0, readOnly = 0, kept = 0;
  for (const p of paths) for (const [label, v] of BAD) {
    const what = p + ' = ' + label, raw = JSON.parse(JSON.stringify(base));
    set(raw, p, v);
    const text = fileOf(raw);
    let r;
    try { r = R.sanitize(JSON.parse(text)); } catch (e) { assert.fail(what + ': sanitize threw ' + e.message); }
    // In a folder: loaded, edited elsewhere (a log line), saved.
    const m = new PF.fs.MemoryFS('fuzz3:' + Math.random(), null), runPath = 'runs/release/fuzz1/run.json';
    m.reset(Object.assign({}, seed, { [runPath]: text }));
    const loaded = await PF.repo.loadRun(m, 'release', 'fuzz1');
    if (!loaded || loaded._unrunnable) {
      assert.ok(!r || r._unrunnable, what + ': sanitize and the folder agree it\'s read-only');
      if (loaded) {
        const before = JSON.stringify(Object.keys(m.files).sort().map(k => [k, m.files[k].t]));
        R.log(loaded, 'person-casey', NOW, 'An unrelated edit');
        await assert.rejects(() => PF.repo.saveRun(m, loaded, 'me'), what + ': a save refuses');
        assert.strictEqual(JSON.stringify(Object.keys(m.files).sort().map(k => [k, m.files[k].t])), before, what + ': nothing was written');
      }
      readOnly++;
    } else {
      assert.ok(!(v && v.__num), what + ': a number JavaScript can\'t hold exactly never leaves the run writable');
      R.log(loaded, 'person-casey', NOW, 'An unrelated edit');
      await PF.repo.saveRun(m, loaded, 'me');
      const saved = JSON.parse(m.files[runPath].t);
      assert.strictEqual(JSON.stringify(at(saved, p)), JSON.stringify(at(raw, p)), what + ': kept exactly through a save, not dropped or changed');
      kept++;
    }
    if (!r) { n++; continue; }
    r._notes = []; r._conflicts = [];
    ctx.run = () => r; ctx.data.runs = [r]; ctx.findRun = () => null;
    for (const id of [null].concat(r._unrunnable && !Object.keys(r.steps || {}).length ? [] : ids)) {
      state.sel = id; state.unfold = id ? { [id]: true } : {};
      let html;
      try { html = V.run(ctx); } catch (e) { assert.fail(what + ', step ' + id + ': the run view threw ' + e.message); }
      inert(html, what + ', step ' + id);
    }
    state.sel = null;
    try { inert(V.receipt(ctx), what + ': receipt'); } catch (e) { if (e instanceof assert.AssertionError) throw e; assert.fail(what + ': the receipt threw ' + e.message); }
    try { PF.evidence.checks(JSON.parse(text), pub.files || {}, null); } catch (e) { assert.fail(what + ': the evidence checks threw ' + e.message); }
    n++;
  }
  assert.strictEqual(n, paths.length * BAD.length);
  assert.ok(readOnly > 0 && kept > 0, readOnly + ' read-only, ' + kept + ' kept');
});

rule('Back and Forward: the screens it lands on have a heading that takes focus (id and tabindex="-1")', () => {
  const { ctx, state } = setup();
  const head = html => /<h1 id="page-h" tabindex="-1">/.test(html);
  state.view = 'mission'; assert.ok(head(V.mission(ctx)), 'screen share');
  state.view = 'finish'; assert.ok(head(V.finish(ctx)), 'Finish');
  state.view = 'receipt'; assert.ok(head(V.receipt(ctx)), 'the receipt');
  const latest = ctx.data.processes[0].index.latest;
  ctx.processes = () => [{ id: 'release', title: 'Production release', category: 'Releases', latest, all: [latest], clashes: [], broken: [], skills: [], draft: { file: 'release.md', md: '' }, draftChanged: false, typesChanged: [] }];
  state.processId = 'release'; state.view = 'process'; assert.ok(head(V.process(ctx)), 'the process page');
  assert.ok(head(V.pageHead('Runs', 'Runs', '')), 'a page heading without an id gets page-h');
});


rule('Typed values: the start form gives a typed detail its kind\'s box, says what a plan\'s text was when it didn\'t convert, and leaves text boxes as they were', () => {
  const { ctx, state } = setup();
  const md = example('maps/drafts/release.md').replace(/^context: .*$/m, (l) => l + ', rows:number, ok:yes-no, due:date, env:choice(dev|prod)');
  const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'Typed', existing: [], now: NOW, rand: 'view0t01', app: '2.0.0' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const pub = P.verify(b.folder, b.files, exactOf(PF, b.files));
  const proc = { id: 'release', title: 'Production release', category: 'Releases', latest: pub, all: [pub], clashes: [], broken: [], skills: [], draft: null };
  ctx.processes = () => [proc]; ctx.suggestRole = () => null;
  ctx.data.plans = [{ id: 'plan-t', process: 'release', version: pub.info.version, title: 'Planned', details: { ticket: 'ABC-9', rows: '1,234', ok: 'Y', due: '03/04/2026' }, roles: {}, by: 'person-blake', _hash: 'h1' }];
  state.view = 'start'; state.processId = 'release'; state.planId = 'plan-t';
  const html = V.start(ctx);
  assert.ok(/<label class="field" for="detail-ticket">ticket<input id="detail-ticket" data-detail="ticket" maxlength="120" value="ABC-9"><\/label>/.test(html), 'a text detail keeps its box exactly');
  assert.ok(/<input id="detail-rows" inputmode="decimal" maxlength="30" value=""/.test(html) && /Before: &quot;1,234&quot; \(text\)\. Type the number it means\./.test(html), 'a number that didn\'t convert starts empty, with what it was');
  assert.ok(/<fieldset class="field typed" id="detail-ok" data-detail="ok"><legend>ok<\/legend>/.test(html) && /value="yes" checked/.test(html), 'yes/no: a fieldset with a legend; Y converted to yes');
  assert.ok(/<input type="date" id="detail-due"[^>]*value=""/.test(html) && /Pick the date it means/.test(html));
  assert.ok(/name="detail-env" value="dev"/.test(html), 'a short choice is radios');
  ctx.data.plans = []; state.planId = null;
  const plain = V.start(ctx);
  assert.ok(!/<fieldset class="field typed"/.test(V.start(Object.assign({}, ctx, { processes: () => [ctx.data.processes[0].index.latest && { id: 'release', title: 'R', category: 'R', latest: ctx.data.processes[0].index.latest, all: [ctx.data.processes[0].index.latest], clashes: [], broken: [], skills: [], draft: null }] }))), 'a checklist without typed values has no typed boxes');
  assert.ok(plain.length > 0);
});


rule('Typed values: the run shows typed details the way people read them, names one that isn\'t valid, and asks for typed evidence with its box', () => {
  const { ctx, state } = setup();
  const md = example('maps/drafts/release.md').replace(/^context: .*$/m, (l) => l + ', rows:number, due:date').replace(/^(- \[[ !]\] \{confirm\}[^\n]*\{#[a-z0-9-]+\})$/m, '$1\n  evidence: number');
  const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'Typed', existing: [], now: NOW, rand: 'view0t02', app: '2.0.0' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const pub = P.verify(b.folder, b.files, exactOf(PF, b.files));
  const r = R.create(pub, { title: 'T', details: { ticket: 'ABC-1', commit: 'c0ffee1', environment: 'production', rows: '1234567.5', due: '2026-10-31' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, app: '2.0.0' });
  const f = JSON.parse(JSON.stringify(r)); f.details.rows = '12a';
  const back = R.sanitize(f); back._notes = []; back._conflicts = [];
  ctx.run = () => back; ctx.data.runs = [back];
  let html = V.run(ctx);
  assert.ok(/<span class="k">rows<\/span> <code>12a<\/code> <span class="small">needs filling in<\/span>/.test(html), 'flagged beside the run');
  state.runDetails = true; html = V.run(ctx);
  assert.ok(/Oct 31, 2026 \(2026-10-31\)/.test(html), 'a date as people read it, with what is stored');
  assert.ok(/Not a number: &quot;12a&quot;\. Fill in to correct it\./.test(html), 'an invalid value is named, as written');
  const first = PF.map.steps(R.mapOf(back)).find(x => x.step.fields.evidence === 'number').step;
  state.sel = first.id; state.runDetails = false;
  html = V.run(ctx);
  assert.ok(new RegExp('id="rec-evidence" inputmode="decimal"').test(html), 'number evidence: a box for decimals');
});

rule('Typed values: a stored value that isn\'t valid for its kind is shown as written in a plain box, so saving something else never drops it', () => {
  const K = PF.vk;
  const date = K.typedField('fx-due', 'due', { kind: 'date' }, '2026-02-30', '');
  assert.ok(/<input id="fx-due" maxlength="300" value="2026-02-30"/.test(date) && !/type="date"/.test(date), date);
  const yn = K.typedField('fx-ok', 'ok', { kind: 'yes-no' }, 'maybe', '');
  assert.ok(/<input id="fx-ok" maxlength="300" value="maybe"/.test(yn) && !/type="radio"/.test(yn), yn);
  const ch = K.typedField('fx-env', 'env', { kind: 'choice', options: ['dev', 'prod', 'a', 'b', 'c', 'd'] }, 'qa', '');
  assert.ok(/<input id="fx-env" maxlength="300" value="qa"/.test(ch), ch);
  assert.ok(/type="date"[^>]*value="2026-02-28"/.test(K.typedField('fx-d', 'due', { kind: 'date' }, '2026-02-28', '')), 'a valid one gets its kind\'s box');
  assert.ok(/type="date"[^>]*value=""/.test(K.typedField('fx-d', 'due', { kind: 'date' }, '', '')), 'an empty one too');
});

rule('Process page: while a screenshot is being added to the draft, Publish is off and says why', () => {
  const { ctx, state } = setup();
  const md = ['---', 'process: x', 'title: X', 'owner: person-casey', '---', '## One · READ-DO {#one}', '- [ ] {confirm} Alpha {#alpha}', ''].join('\n');
  const p = { id: 'x', title: 'X', category: 'Other', latest: null, all: [], clashes: [], broken: [], skills: [], taken: [], draft: { file: 'x.md', md }, draftChanged: true };
  ctx.processes = () => [p]; ctx.data.validations = []; state.view = 'process'; state.processId = 'x';
  assert.ok(/data-act="publish" data-id="x">/.test(V.process(ctx)), 'set-up: Publish is on');
  ctx.shotBusy = () => 1;
  const html = V.process(ctx);
  assert.ok(/data-act="publish" data-id="x" disabled aria-describedby="pub-why"/.test(html) && /id="pub-why">A screenshot is still being added to this draft\. Publish when it.s done\./.test(html));
});

rule('Home: an owner ID that names something every object has (constructor, toString) isn\'t a person, so the draft goes to everyone', () => {
  const { ctx, state } = setup();
  state.view = 'home'; ctx.data.runs = [];
  ['constructor', 'toString', '__proto__'].forEach(id => {
    const md = ['---', 'process: x', 'title: X', 'owner: ' + id, '---', '## One · READ-DO {#one}', '- [ ] {confirm} Alpha {#alpha}', ''].join('\n');
    ctx.processes = () => [{ id: 'x', title: 'X', category: 'Other', latest: null, all: [], clashes: [], broken: [], skills: [], draft: { file: 'x.md', md }, draftChanged: true, staleSkills: 0 }];
    assert.ok(/X: the draft has unpublished changes/.test(V.home(ctx)), id);
  });
});

rule('Conditions (2.1): a phase not needed shows one line why, steps not needed fold away with their reasons, a held step says what it waits for, and the receipt lists them; a run without conditions shows none of it', () => {
  const plain = setup(), words = /[Nn]ot needed|Waiting ·|only when/;
  assert.ok(!words.test(V.run(plain.ctx)), 'nothing about conditions on a run without any');
  plain.state.view = 'receipt';
  assert.ok(!words.test(V.receipt(plain.ctx)), 'nor on its receipt');
  const md = ['---', 'process: rel', 'title: Release', 'context: ticket, risk:choice(low|high), hotfix:yes-no, amount:number', 'roles: release-lead', '---', '',
    '## Hotfix {#hotfix}', '  only when ^hotfix is yes', '- [ ] {confirm} Page the on-call lead {#page}', '',
    '## Release {#release}', '- [ ] {confirm} Tell the <b>change</b> board {#board}', '  only when ^risk is high',
    '- [ ] {confirm} Get finance sign-off {#finance}', '  only when ^amount is at least 10000', '- [ ] {confirm} Ship it ^ticket {#ship}', ''].join('\n');
  const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'cond0001', app: '2.1.0' });
  assert.ok(!b.blockers, String(b.blockers));
  const pub = P.verify(b.folder, b.files, exactOf(PF, b.files));
  const r = R.create(pub, { title: 'Release', details: { ticket: 'T-1', risk: 'low', hotfix: 'no', amount: '' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, id: 'runc' });
  r.details.amount = '12a'; r._notes = []; r._conflicts = [];
  const { ctx, state } = setup();
  ctx.run = () => r; ctx.data.runs = [r]; ctx.data.processes = [{ process: 'rel', pubs: [pub], index: { latest: pub } }];
  let html = V.run(ctx);
  assert.ok(/Not needed · only when hotfix is yes \(hotfix is no\)/.test(html), 'the skipped phase says why');
  assert.ok(!/Page the on-call lead/.test(html), 'and lists no steps');
  assert.ok(/<details class="folded not-needed"><summary class="small">1 step not needed<\/summary>/.test(html), 'one step folds away');
  assert.ok(/Tell the &lt;b&gt;change&lt;\/b&gt; board · only when risk is high \(risk is low\)/.test(html) && !/<b>change<\/b>/.test(html), 'with its reason, escaped');
  assert.ok(/Waiting · [^<]*12a/.test(html), 'a held step names the value it waits on');
  state.view = 'receipt';
  html = V.receipt(ctx);
  assert.ok(/Not needed in this run/.test(html) && /only when risk is high \(risk is low\)/.test(html), 'the receipt lists what was not needed');
  assert.ok(/class="r-nn"/.test(html) && !/Page the on-call lead/.test(html) && !/<b>change<\/b>/.test(html));
});

run();
