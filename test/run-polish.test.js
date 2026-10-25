// 2.3.1 run screen polish: run details shown in step text, gate names, less noise on the run screen, the editor's words, and
// messages that say which folder or person they're about and only as surely as the outcome is known.
'use strict';
const assert = require('assert');
const { exactOf, loadViews, example, exampleSetup, rule, run, sampleDone } = require('./harness');
const { boot } = require('./app-harness');
const PF = loadViews(), R = PF.run, P = PF.publish, V = PF.views, M = PF.map, K = PF.vk;
const EX = exampleSetup(PF);
const NOW = '2026-10-17T21:00:00.000Z';
const people = JSON.parse(example('people.json'));

function setup(details, mutateRun) {
  const b = P.build(example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'pol00001' });
  const pub = P.verify(b.folder, b.files, exactOf(PF, b.files));
  let r = R.create(pub, { title: 'Release', details: Object.assign({ ticket: 'ABC-1', commit: 'aaa111', environment: 'production' }, details || {}), roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'me', now: NOW, id: 'run1' });
  if (mutateRun) r = mutateRun(r) || r;
  r._notes = r._notes || []; r._conflicts = r._conflicts || [];
  const state = { view: 'run', me: 'person-casey', sel: null, refOpen: true, pick: null, edit: null, unfold: {}, msg: null, pendingFiles: [], unsaved: {}, saveErr: {}, startMode: {}, archive: {}, keys: true };
  const ctx = {
    state, canFolder: true, data: { people, validations: [], processes: [{ process: 'release', pubs: [pub], index: { latest: pub } }], runs: [r], plans: [], drafts: [], skills: [], legacy: [], readAt: NOW },
    now: () => Date.parse(NOW), peopleById: Object.fromEntries(people.map(p => [p.id, p])),
    run: () => r, recording: x => !x.ended && x.recorder.person === state.me && x.recorder.session === 'me',
    attachments: () => [],
    canRecover: x => !x.ended ? x.recorder.person === state.me && x.recorder.session === 'me' : x.recorder.person === state.me,
    processTitle: id => id, processes: () => [], findRun: () => null, latestPub: () => null, suggestRole: () => null, localCopy: () => null,
    img: () => '<img src="blob:test">'
  };
  return { r, ctx, state, b, map: R.mapOf(r) };
}
const nextOf = html => { const a = html.indexOf('<div class="rw-next"'); return html.slice(a, html.indexOf('<div class="rw-picker"', a)); };
const insOf = html => html.slice(html.indexOf('<aside class="fpe-pane rw-ins"'));
const rowOf = (html, id) => { const a = html.indexOf(' id="step-' + id + '"'); return html.slice(html.lastIndexOf('<li', a), html.indexOf('</li>', a)); };
const gateOf = (html, id) => { const a = html.indexOf('id="gate-' + id + '"'); return a < 0 ? '' : html.slice(html.lastIndexOf('<div', a), html.indexOf('</div></div>', a)); };
function playPhase(r, pi) { const map = R.mapOf(r), dn = sampleDone(PF); map.phases[pi].steps.forEach(st => dn(r, map, st.id, 'person-casey', NOW)); R.pass(r, map, pi, 'person-casey', NOW); }
const one = md => M.parse(['---', 'process: t', 'title: T', 'context: server, tag', '---', '', '## A {#a}', md].join('\n')).phases[0].steps[0];

/* ---------- 1. run details show in step text ---------- */

rule('Step text: a reference shows its value when set and ‹name› when not, in plain text and on screen', () => {
  const st = one('- [ ] Deploy ^tag to ^server {#d}');
  assert.strictEqual(st.text, 'Deploy to', 'step.text is unchanged: references are still taken out');
  assert.strictEqual(M.shownText(st, null), 'Deploy ‹tag› to ‹server›');
  assert.strictEqual(M.shownText(st, k => ({ tag: 'v1.2', server: '' })[k]), 'Deploy v1.2 to ‹server›', 'an empty value counts as not set');
  assert.strictEqual(K.stepHtml(st, k => ({ tag: 'v1.2' })[k] || ''), 'Deploy v1.2 to <span class="ref-empty">‹server›</span>');
});

rule('Step text: hostile values and repeated references are escaped; a typed private-use character never stands for a value', () => {
  const st = one('- [ ] Tell ^tag about ^tag  now {#d}');
  const bad = '<b>x</b> "q" & `t`';
  const html = K.stepHtml(st, () => bad);
  assert.ok(!/<b>x<\/b>/.test(html) && html.split('&lt;b&gt;x&lt;/b&gt; &quot;q&quot; &amp; `t`').length === 3 || html.split('&lt;b&gt;x&lt;/b&gt; "q" &amp; `t`').length === 3, 'escaped, twice: ' + html);
  assert.ok(!//.test(html) && !//.test(M.shownText(st, () => 'v')), 'the typed mark is dropped');
  assert.strictEqual(M.shownText(st, () => 'v'), 'Tell v about v now');
  const edge = one('- [ ] ^tag first and last ^server {#e}');
  assert.strictEqual(M.shownText(edge, () => 'X'), 'X first and last X', 'at the start and end of a line');
});

rule('Step text: a reference in a link\'s words is filled in; one in its address never is', () => {
  const st = one('- [ ] Open [the ^tag notes](https://ex.com/^tag/x) {#d}');
  const html = K.stepHtml(st, () => 'v9');
  assert.ok(/>the v9 notes<\/a>/.test(html), 'the words: ' + html);
  assert.ok(!/v9\/x/.test(html), 'the address is not built from a value');
});

rule('Run screen: rows, accessible names, the inspector and Next up show the run\'s details in place', () => {
  const { r, ctx, state } = setup({ tag: 'v2026.10.16' });
  playPhase(r, 0);
  state.sel = 'jenkins';
  const html = V.run(ctx), row = rowOf(html, 'jenkins');
  assert.ok(/Start the production deploy job v2026\.10\.16/.test(row), 'the row');
  assert.ok(/aria-label="Start the production deploy job v2026\.10\.16, /.test(row), 'its checkbox name');
  assert.ok(/<h2 id="ins-h" class="rw-ins-h" tabindex="-1">Start the production deploy job v2026\.10\.16<\/h2>/.test(insOf(html)), 'the inspector');
  assert.ok(/Merge the release branch to master aaa111/.test(nextOf(html)), 'Next up');
  const unset = setup();
  playPhase(unset.r, 0); unset.state.sel = 'jenkins';
  assert.ok(/Start the production deploy job <span class="ref-empty">‹tag›<\/span>/.test(insOf(V.run(unset.ctx))), 'unset reads ‹tag›');
});

rule('Run details in text change nothing saved: step text, publication files and the default headline are as before', () => {
  const { r, b, map } = setup({ tag: 'v1' });
  assert.ok(Object.values(b.files).every(f => !/textParts|‹/.test(typeof f === 'string' ? f : JSON.stringify(f))), 'publication files never carry it');
  assert.ok(!/textParts/.test(JSON.stringify(R.serialize ? R.serialize(r) : r)), 'nor the run');
  const st = M.findStep(map, 'jenkins').step;
  assert.strictEqual(st.text, 'Start the production deploy job');
  const plain = R.headline(r, map), shown = R.headline(r, map, K.shownOpt(r, map));
  assert.strictEqual(typeof plain.text, 'string');
  assert.deepStrictEqual(R.nextUp(r, map, 'person-casey'), R.nextUp(r, map, 'person-casey', undefined), 'no options, the old output');
  assert.ok(shown && typeof shown.text === 'string');
});

rule('Blocked headline: the command line keeps the step text; screens fill in its details', () => {
  const { r, map } = setup({ tag: 'v7' });
  playPhase(r, 0);
  const dn = sampleDone(PF); dn(r, map, 'merge', 'person-casey', NOW);
  R.block(r, map, 'jenkins', 'Queue is down', 'person-casey', NOW);
  const tag = r.details.tag;
  assert.ok(tag, 'set-up: the merge set the tag');
  assert.strictEqual(R.headline(r, map).text, 'Stopped: Start the production deploy job', 'default');
  assert.strictEqual(R.headline(r, map, K.shownOpt(r, map)).text, 'Stopped: Start the production deploy job ' + tag, 'shown');
});

/* ---------- 2. gate names ---------- */

rule('Gates: the run screen and the rail use the gate\'s own title', () => {
  const { r, ctx, state } = setup();
  assert.ok(/<span>Gate: Ready to deploy<\/span>/.test(gateOf(V.run(ctx), 'ready')), 'its title');
  playPhase(r, 0);
  assert.ok(/<span class="pill passed">Passed<\/span>/.test(gateOf(V.run(ctx), 'ready')), 'the pill, once it has settled');
  state.justPassed = 'ready';
  assert.ok(!/class="pill passed"/.test(gateOf(V.run(ctx), 'ready')), 'not beside the Passed stamp');
});

/* ---------- 3. run screen noise ---------- */

rule('A plain step: no type tag, no empty What to do, and no Fill in', () => {
  const { ctx, state, r, map } = setup();
  state.sel = 'rollback';
  const html = V.run(ctx), row = rowOf(html, 'rollback'), ins = insOf(html);
  assert.ok(!/class="type"/.test(row) && !/<span class="type">/.test(ins.slice(0, ins.indexOf('</div>', ins.indexOf('rw-ins-meta')))), 'no Confirm tag');
  assert.ok(!/id="ins-do"/.test(ins) && !/Nothing more to it/.test(ins), 'no What to do');
  assert.ok(!/data-kind="fields" data-id="rollback"/.test(ins), 'no Fill in');
  assert.strictEqual(R.fillOffered(r, map, M.findStep(map, 'rollback').step, PF.types.get('confirm'), false), false);
});

rule('A step with something to do or fill in still offers it', () => {
  const { ctx, state } = setup();
  state.sel = 'flags';
  assert.ok(/id="ins-do"/.test(insOf(V.run(ctx))), 'a plain step with a note has What to do');
  state.sel = 'tests';
  const ins = insOf(V.run(ctx));
  assert.ok(/id="ins-do"/.test(ins) && /<span class="type">/.test(ins), 'a typed step keeps its tag and hint');
});

rule('A run detail not set yet reads "Set <name>"', () => {
  const { ctx, state } = setup();
  state.runDetails = true;
  const html = V.run(ctx);
  assert.ok(/<span class="k">Set tag<\/span>/.test(html) && /<span class="k">commit<\/span>/.test(html), 'unset says Set; set shows its name');
});

/* ---------- 4. editor words ---------- */

rule('Editor: Review & publish replaces Done, and the 2.0 hint is gone', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8');
  assert.ok(/data-act="ed-done"[^>]*>Review &amp; publish/.test(src) || /Review &amp; publish/.test(src), 'the button');
  assert.ok(!/Needs Flightdeck 2\.0 to run\./.test(src), 'no 2.0 hint');
});

/* ---------- 5. messages ---------- */

rule('A planned start\'s run: said only as surely as it\'s known', () => {
  assert.strictEqual(K.unsavedWords({ certain: true }), 'its run didn\'t save');
  assert.strictEqual(K.unsavedWords({ certain: false }), 'Flightdeck couldn\'t confirm whether its run saved');
  assert.strictEqual(K.unsavedWords({ certain: false, saved: true }), 'its run was saved and has changed since');
});

const stageFiles = (app) => app.files('staged/release/').filter(f => /^staged\/release\/stage-[a-z0-9]{8}\/publication\.json$/.test(f));
const runFiles = (app) => app.files('runs/release/').filter(f => /\/run\.json$/.test(f));

rule('Test run: Casey to Morgan and back to Casey while the stage is read again writes nothing and goes nowhere', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const path = 'maps/drafts/release.md', md = app.fs.files[path].t;
  await app.fs.write(path, md.replace(/\n(## [^\n]*\n)/, '\n$1- [ ] {confirm} Tell the on-call channel {#tell-oncall}\n'));
  app.click('refresh'); await app.tick(80);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  app.set('change-note', 'Tell on-call first'); app.click('stage-draft', 'release'); await app.tick(200);
  const folder = JSON.parse(app.fs.files[stageFiles(app)[0]].t).folder;
  app.click('start-test', folder); await app.tick();
  let release; const gate = new Promise(res => { release = res; });
  const orig = app.fs.read.bind(app.fs);
  app.fs.read = (x, o) => new RegExp('^staged/release/' + folder + '/publication\\.json$').test(x) ? gate.then(() => orig(x, o)) : orig(x, o);
  const before = runFiles(app).length, liveBefore = app.live();
  app.submitForm('start-form', {}); await app.tick(20);
  app.choose('person-morgan'); await app.tick(20);
  app.choose('person-casey'); await app.tick(20);
  release(); await app.tick(200);
  app.fs.read = orig;
  assert.strictEqual(runFiles(app).length, before, 'no run');
  assert.ok(!/Test run started/i.test(app.live().slice(liveBefore.length)), 'no announcement');
  assert.ok(!/data-test="1"[^>]*class="rw/.test(app.html()), 'not on a run screen');
});

/* ---------- after a gate passes (practice, which shares the run's rule) ---------- */

const SMALL = ['---', 'process: release', 'title: Production release', 'owner: person-casey', '---', '',
  '## One {#one}', '- [ ] Write it down {#w}', '', '## Gate: First check {#g1}', '',
  '## Two {#two}', '- [ ] Tell the team {#t}', '- [ ] Tell the boss {#b}', '', '## Gate: Second check {#g2}'].join('\n');
async function practiceSmall() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } });
  await app.tick(60); app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/release.md', SMALL);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  app.click('ptab', 'edit'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  assert.ok(/Practice · not recorded/.test(app.html()), 'set-up: practicing');
  return app;
}

rule('After a gate passes, the next phase\'s first open step is selected and its check has focus; after the last, Finish', async () => {
  const app = await practiceSmall();
  app.click('toggle', 'w'); await app.tick();
  app.click('pass', '0'); await app.tick();
  assert.strictEqual(app.selected(), 't', 'the next phase\'s open step');
  assert.strictEqual(app.focused(), '[data-act="toggle"][data-id="t"]');
  app.click('toggle', 't'); await app.tick(); app.click('toggle', 'b'); await app.tick();
  const n = app.asked().length;
  app.click('pass', '1'); await app.tick();
  assert.ok(/pr-done/.test(app.html()) && app.asked().slice(n).includes('.pr-done'), 'practice\'s own completion line');
});

rule('F on a step with nothing to fill in says so instead of opening an empty form', async () => {
  const app = await practiceSmall();
  app.click('select', 'w'); await app.tick();
  const before = app.live().length;
  app.key('f'); await app.tick();
  assert.ok(/Nothing to fill in for this step\./.test(app.live().slice(before)), app.live().slice(before));
  assert.ok(!/data-kind="fields" data-id="w"/.test(app.html()));
});

/* ---------- a planned start whose run may have saved ---------- */

const PLAN = 'plan-release-2026-10-24';
const decisionsOn = app => app.files('proposals/' + PLAN + '.status-');
async function failedStart(app, how) {
  app.choose('person-casey'); await app.tick();
  app.click('review-plan', PLAN); await app.tick();
  const write = app.fs.write;
  app.fs.write = function (p) {
    if (/^runs\/release\/[^/]+\/run\.json$/.test(p)) return how === 'landed' ? write.apply(this, arguments).then(() => { throw new Error('OneDrive is offline'); }) : Promise.reject(new Error('OneDrive is offline'));
    return write.apply(this, arguments);
  };
  app.submitForm('start-form'); await app.tick(120);
  app.fs.write = write;
}
const unsure = /couldn(&#39;|')t confirm whether its run saved/, wrong = /didn(&#39;|')t save/;
async function everywhere(app, what) {
  assert.ok(unsure.test(app.html() + app.live()) && !wrong.test(app.html()), what + ': the message');
  if (/data-act="dismiss"/.test(app.html())) { app.click('dismiss'); await app.tick(); }
  assert.ok(unsure.test(app.html()) && !wrong.test(app.html()), what + ': the banner after the message is gone');
  const n = app.files('runs/release/').length;
  app.click('review-plan', PLAN); await app.tick();
  app.submitForm('start-form'); await app.tick(120);
  assert.ok(unsure.test(app.html() + app.live()) && !wrong.test(app.html()), what + ': a second start');
  assert.strictEqual(app.files('runs/release/').length, n, what + ': nothing more written');
}

rule('A run save that may have landed says Flightdeck couldn\'t confirm it, in the message, the banner and a second start', async () => {
  const app = boot(); await app.tick(60);
  await failedStart(app, 'landed');
  assert.strictEqual(decisionsOn(app).length, 1, 'set-up: the plan is marked started');
  await everywhere(app, 'landed');
});

rule('Try again that fails before writing never turns "couldn\'t confirm" into "didn\'t save"', async () => {
  const app = boot(); await app.tick(60);
  await failedStart(app, 'landed');
  const read = app.fs.read.bind(app.fs);
  app.fs.read = (x, o) => /^proposals\//.test(x) ? Promise.reject(new Error('OneDrive is offline')) : read(x, o);
  app.click('plan-resume', PLAN); await app.tick(160);
  app.fs.read = read;
  await everywhere(app, 'after Try again');
});

rule('A known failure, then a Try again that may have written: "couldn\'t confirm" in its message and the banner, also while it writes', async () => {
  const app = boot(); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  app.click('review-plan', PLAN); await app.tick();
  const read = app.fs.read.bind(app.fs);
  app.fs.read = (x, o) => /^runs\/release\/[^/]+\/run\.json$/.test(x) ? Promise.reject(new Error('OneDrive is offline')) : read(x, o);
  app.submitForm('start-form'); await app.tick(120);
  app.fs.read = read;
  assert.ok(wrong.test(app.html()) && !unsure.test(app.html()), 'set-up: a known failure says didn\'t save');
  if (/data-act="dismiss"/.test(app.html())) { app.click('dismiss'); await app.tick(); }
  assert.ok(wrong.test(app.html()), 'set-up: the banner says so too');
  const write = app.fs.write; let release, seen = null; const gate = new Promise(r => { release = r; });
  app.fs.write = function (p) {
    if (/^runs\/release\/[^/]+\/run\.json$/.test(p)) { seen = app.html(); return gate.then(() => { throw new Error('OneDrive is offline'); }); }
    return write.apply(this, arguments);
  };
  app.click('plan-resume', PLAN); await app.tick(120);
  assert.ok(seen !== null, 'set-up: Try again reached the write');
  await app.tick(); assert.ok(!wrong.test(app.html()), 'while it writes, the banner no longer says didn\'t save');
  release(); await app.tick(120);
  app.fs.write = write;
  assert.ok(/Flightdeck couldn(&#39;|')t confirm whether the run saved: OneDrive is offline/.test(app.html() + app.live()), 'Try again\'s own message');
  await everywhere(app, 'after an uncertain Try again');
});

/* ---------- the rest of after-a-gate ---------- */

rule('Passing a gate in practice while Fill in is open on the selected step keeps that step and its form', async () => {
  const md = SMALL.replace('- [ ] Write it down {#w}', '- [ ] {run.command} Write it down {#w}\n  command: echo hi');
  const app = boot({ localStore: { 'preflight:builder': 'false' } });
  await app.tick(60); app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/release.md', md);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  app.click('toggle', 'w'); await app.tick();
  if (/data-act="pr-ev-skip" data-id="w"/.test(app.html())) { app.click('pr-ev-skip', 'w'); await app.tick(); }
  app.click('select', 'w'); await app.tick();
  assert.ok(/data-act="pick" data-kind="fields" data-id="w"/.test(app.html()), 'set-up: Fill in is offered');
  app.click('pick', 'w', { kind: 'fields' }); await app.tick();
  assert.ok(/data-act="save-fields" data-id="w"/.test(app.html()), 'set-up: Fill in is open');
  app.click('pass', '0'); await app.tick();
  assert.strictEqual(app.selected(), 'w', 'the selection stays');
  assert.ok(/data-act="save-fields" data-id="w"/.test(app.html()), 'Fill in stays open');
});

rule('Passing a gate into a step that starts a child run focuses its inspector heading, not its disabled check', async () => {
  const md = SMALL.replace('- [ ] Tell the team {#t}', '- [ ] {run.process} Check in the notes {#t}\n  process: check-in');
  const app = boot({ localStore: { 'preflight:builder': 'false' } });
  await app.tick(60); app.choose('person-casey'); await app.tick();
  await app.fs.write('maps/drafts/release.md', md);
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  app.click('toggle', 'w'); await app.tick();
  const n = app.asked().length;
  app.click('pass', '0'); await app.tick();
  assert.strictEqual(app.selected(), 't');
  assert.ok(app.asked().slice(n).includes('ins-h') || app.focused() === 'ins-h', 'the heading: ' + app.asked().slice(n).join(' | '));
  assert.ok(!app.asked().slice(n).includes('[data-act="toggle"][data-id="t"]'), 'never its check');
});

/* ---------- the rest of item 1's surfaces ---------- */

rule('Search results, Insights and the readiness list show ‹name› where a reference is', () => {
  const st = one('- [ ] Start the job ^tag {#j}');
  const doc = { kind: 'step', title: st.text, shown: M.shownText(st, null) };
  assert.strictEqual(doc.shown, 'Start the job ‹tag›');
  const { b } = setup(), pub = P.verify(b.folder, b.files, exactOf(PF, b.files)), S = PF.search;
  const inp = { runs: [], people, pubs: [{ process: 'release', pubs: [pub], index: P.index([pub]) }], drafts: [], skills: [], stepTypes: {}, corrDecisions: [], followUps: [] };
  const ix = S.create(); S.sync(ix, S.docs(inp), inp);
  const hit = S.query(ix, 'production deploy job').groups.reduce((a, g) => a.concat(g.items), []).filter(x => x.kind === 'step' && /jenkins$/.test(x.id))[0];
  assert.ok(hit && hit.shown === 'Start the production deploy job ‹tag›', 'a query result carries the display text: ' + JSON.stringify(hit && hit.shown));
  assert.ok(/textParts: s\.textParts/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'core', 'insights.js'), 'utf8')), 'Insights summaries keep the parts');
  assert.strictEqual(K.stepHtml({ id: 'j', text: st.text, textParts: st.textParts }, null), 'Start the job <span class="ref-empty">‹tag›</span>', 'a summary with its parts');
});

rule('A correction\'s label shows the run\'s details in its step text', () => {
  const { r, map } = setup({ tag: 'v5' });
  r._notes = [{ id: 'c1', kind: 'correction', step: 'jenkins', at: NOW, by: 'person-casey', change: { op: 'describe' }, why: 'Queue', happened: 'x' }];
  const c = R.corrections(r, map);
  assert.strictEqual(c[0].stepText, 'Start the production deploy job v5');
});

run();
