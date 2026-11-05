// The consumer matrix (design sections 5.7 and 10, probe section I4): a done search whose stored record doesn't stand is
// reopened by the reader, so every consumer reads an open step with no change of its own. Each bad record is checked
// before the gate is approved (the gate can't pass, the must-do waiver is refused, Next up offers the step) and after (the
// gate goes to review), against a good control that counts everywhere. Reads change nothing in the file.
'use strict';
const assert = require('assert');
const { load, rule, run, exactOf } = require('./harness');
const PF = load(), R = PF.run, M = PF.map, P = PF.publish, A = PF.appjson;
const NOW = '2026-11-04T15:00:00.000Z', LATER = '2026-11-04T15:10:00.000Z';
const TV = PF.teamValues.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'jira-base-url': { value: 'https://jira.example.com/jira' } } }));
const MD = ['---', 'process: rel', 'title: Release', 'context: project, version', 'roles: lead', '---', '',
  '## Stories · DO-CONFIRM {#stories}',
  '- [!] {jira.search} Every story in ^version has points @lead {#points}', '  query: project = ^project AND fixVersion = ^version AND "Story Points" is EMPTY', '  results: none',
  '- [!] {jira.search} The release has stories @lead {#scope}', '  query: project = ^project AND fixVersion = ^version', '  results: at least 1', '  require: keys',
  '- [ ] {confirm} Tell the team {#tell}', '',
  '## Gate: Ready {#ready}', '  approves: ^version', '',
  '## Build · READ-DO {#build}', '- [ ] {confirm} Build it {#b1}', '',
  '## Gate: Built {#built}', ''].join('\n');
const b = P.build(MD, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.16.0', teamValues: TV });
assert.ok(!b.blockers, (b.blockers || []).join(' | '));
const PUB = P.verify(b.folder, b.files, exactOf(PF, b.files));
const nameOf = A.names([]);
function checked(approve) {
  const r = R.create(PUB, { title: 'R', details: { project: 'PAY', version: '2026.11.0' }, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run1', app: '2.16.0', teamValues: TV }), map = R.mapOf(r);
  const sid = id => R.searchId(r, map, M.findStep(map, id).step);
  R.done(r, map, 'points', 'person-avery', LATER, { searchId: sid('points'), count: '0' });
  R.done(r, map, 'scope', 'person-avery', LATER, { searchId: sid('scope'), count: '2', keys: 'PAY-1, PAY-2' });
  R.done(r, map, 'tell', 'person-avery', LATER);
  if (approve) R.pass(r, map, 0, 'person-avery', LATER);
  return JSON.parse(JSON.stringify(r));
}
const BAD = {
  'damaged identity': o => { o.searchGen.version = 'not-a-generation'; },
  'stale identity (an earlier searchId)': o => { o.steps.points.values.searchId = 'sha256:' + '0'.repeat(64); },
  'failing stored results': o => { o.steps.points.values.count = '3'; o.steps.points.values.keys = 'PAY-7, PAY-8, PAY-9'; },
  'malformed results (count "x")': o => { o.steps.points.values.count = 'x'; },
  'require: keys, keys missing': o => { delete o.steps.scope.values.keys; },
  'damaged recovery generation': o => { o.searchRec.points = '0-zz'; }
};
const STEP = { 'require: keys, keys missing': 'scope' };
/* Every consumer, as the reader gives the run: true when it counts the search as checked. */
function consumers(o, id) {
  const before = JSON.stringify(o), r = R.sanitize(JSON.parse(before)), map = R.mapOf(r), out = {};
  const info = R.phaseInfo(r, map, 0), nu = R.nextUp(r, map), t = R.totals(r, map);
  out.phase = info.left === 0;
  const passed = R.gateStatus(r, map, 0) === 'passed';
  out.canPass = passed || R.canPass(r, map, 0);
  out.pass = passed || (() => { try { R.pass(R.sanitize(JSON.parse(before)), map, 0, 'person-avery', LATER); return true; } catch (e) { return false; } })();
  out.waiver = R.canWaive(r, map, 0) || R.gateStatus(r, map, 0) === 'passed';
  out.nextUp = !(nu.step && nu.step.id === id);
  out.totals = t.done === 5 - 2 || t.done >= 3;
  out.gate = R.gateOk(R.gateStatus(r, map, 0)) || R.gateStatus(r, map, 0) === 'ready';
  out.answered = r.steps[id].s === 'done';
  const line = R.receipt(r, map, x => x, LATER, []).split('\n').filter(l => l.indexOf(M.shownText(M.findStep(map, id).step, M.valuesOf(r))) >= 0)[0] || '';
  out.receipt = /DONE/.test(line);
  out.cli = A.run2(r, [], nameOf).run.steps.filter(s => s.id === id)[0].state === 'done';
  out.next = !(A.next(r, nameOf, null).next.step && A.next(r, nameOf, null).next.step.id === id);
  assert.strictEqual(JSON.stringify(o), before, 'the read changes nothing in the file');
  return out;
}
const names = Object.keys(consumers(checked(false), 'points'));

rule('control: a good record counts everywhere, before and after the gate is approved', () => {
  [false, true].forEach(approve => {
    const c = consumers(checked(approve), 'points');
    assert.deepStrictEqual(names.filter(k => !c[k]), [], (approve ? 'after' : 'before') + ' approval');
  });
});
Object.keys(BAD).forEach(kind => {
  rule('before approval, ' + kind + ': every consumer refuses it; the phase has a step left and Next up offers it', () => {
    const o = checked(false), id = STEP[kind] || 'points'; BAD[kind](o);
    const c = consumers(o, id);
    assert.deepStrictEqual(names.filter(k => c[k]), [], 'should not count: ' + names.filter(k => c[k]).join(', '));
    const r = R.sanitize(JSON.parse(JSON.stringify(o)));
    assert.strictEqual(R.gateStatus(r, R.mapOf(r), 0), 'open');
    assert.ok(/^Reopened when read: /.test(r.steps[id].reason), r.steps[id].reason);
  });
  rule('after approval, ' + kind + ': the gate goes to review and the step is open again', () => {
    const o = checked(true), id = STEP[kind] || 'points'; BAD[kind](o);
    const r = R.sanitize(JSON.parse(JSON.stringify(o))), map = R.mapOf(r);
    assert.strictEqual(R.gateStatus(r, map, 0), 'review');
    assert.strictEqual(r.steps[id].s, 'open'); assert.strictEqual(r.steps[id].reopened, true);
    assert.ok(!R.canPass(r, map, 0));
  });
});

/* ---- The rendered surfaces (design section 10): the same bad records, read as the screens read them ----
   Timers, Screen share, the HTML receipt and its evidence rows, the evidence pack's run section, insights' per-step
   evidence, readiness, track counts and the day timeline. The searches sit in a track and are due a minute after the
   run starts, so a reopened search shows its timer, counts as left in its track and is late on the timeline. */
const PFV = require('./harness').loadViews(), RV = PFV.run, MV = PFV.map, V = PFV.views;
const TVV = PFV.teamValues.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'jira-base-url': { value: 'https://jira.example.com/jira' } } }));
const MD2 = ['---', 'process: rel', 'title: Release', 'context: project, version', 'roles: lead', '---', '',
  '## Stories · DO-CONFIRM {#stories}',
  '### Track: Jira @lead {#tj}',
  '- [!] {jira.search} Every story in ^version has points @lead {#points}', '  query: project = ^project AND fixVersion = ^version AND "Story Points" is EMPTY', '  results: none', '  after: 1m',
  '- [!] {jira.search} The release has stories @lead {#scope}', '  query: project = ^project AND fixVersion = ^version', '  results: at least 1', '  require: keys', '  after: 1m',
  '### Track: Team @lead {#tt}',
  '- [ ] {confirm} Tell the team {#tell}', '',
  '## Gate: Ready {#ready}', '  approves: ^version', '',
  '## Build · READ-DO {#build}', '- [ ] {confirm} Build it {#b1}', '',
  '## Gate: Built {#built}', ''].join('\n');
const b2 = PFV.publish.build(MD2, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.16.0', teamValues: TVV });
assert.ok(!b2.blockers, (b2.blockers || []).join(' | '));
const PUB2 = PFV.publish.verify(b2.folder, b2.files, exactOf(PFV, b2.files));
const SEEN = '2026-11-04T16:00:00.000Z';
/* stage: 'before' (gate open), 'after' (gate passed) or 'completed' (every gate passed and the run ended Completed). */
function recorded(stage) {
  const r = RV.create(PUB2, { title: 'R', details: { project: 'PAY', version: '2026.11.0' }, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run2', app: '2.16.0', teamValues: TVV }), map = RV.mapOf(r);
  const sid = id => RV.searchId(r, map, MV.findStep(map, id).step);
  RV.start(r, map, 'points', 'person-avery', NOW); RV.start(r, map, 'scope', 'person-avery', NOW);
  RV.done(r, map, 'points', 'person-avery', NOW, { searchId: sid('points'), count: '0' });
  RV.done(r, map, 'scope', 'person-avery', NOW, { searchId: sid('scope'), count: '2', keys: 'PAY-1, PAY-2' });
  RV.done(r, map, 'tell', 'person-avery', NOW);
  if (stage !== 'before') RV.pass(r, map, 0, 'person-avery', NOW);
  if (stage === 'completed') { RV.done(r, map, 'b1', 'person-avery', NOW); RV.pass(r, map, 1, 'person-avery', NOW); RV.end(r, map, 'Completed', 'person-avery', 'Avery', NOW); }
  return JSON.parse(JSON.stringify(r));
}
function viewCtx(r, sel) {
  const state = { view: 'run', me: 'person-avery', sel: sel, refOpen: true, pick: null, edit: null, unfold: { stories: true, build: true }, msg: null, pendingFiles: [], unsaved: {}, saveErr: {}, startMode: {}, archive: {}, keys: true, fs: { kind: 'memory', name: 'x' }, fieldErr: null, showRoles: false, copyView: null, more: {} };
  r._notes = r._notes || []; r._conflicts = r._conflicts || [];
  return { state, canFolder: true, data: { people: [], validations: [], processes: [{ process: 'rel', pubs: [PUB2], index: { latest: PUB2 } }], runs: [r], plans: [], drafts: [], skills: [], legacy: [], followUps: [], readAt: SEEN },
    now: () => Date.parse(SEEN), peopleById: {}, run: () => r, recording: x => !x.ended && x.recorder.person === state.me && x.recorder.session === 'w-a', attachments: () => [],
    canRecover: () => true, processTitle: id => id, processes: () => [], findRun: () => null, latestPub: () => null, suggestRole: () => null, localCopy: () => null, img: () => '<img src="blob:test">' };
}
/* The <tag ...>...</tag> element (or line) that holds a step's own markup. */
const around = (h, at, open, close) => { if (at < 0) return ''; const s = h.lastIndexOf(open, at), e = h.indexOf(close, at); return s < 0 || e < 0 ? '' : h.slice(s, e); };
/* Every surface, as the reader gives the run: true when it counts the search as checked. */
function surfaces(o, id) {
  const before = JSON.stringify(o), r = RV.sanitize(JSON.parse(before)), map = RV.mapOf(r), step = MV.findStep(map, id).step, out = {};
  const text = MV.shownText(step, MV.valuesOf(r)), ctx = viewCtx(r, id);
  const page = V.run(ctx), rowAt = page.indexOf('data-act="toggle" data-id="' + id + '"');
  const row = around(page, rowAt, '<li', '</li>');
  out.row = /aria-checked="true"/.test(row);
  out.timers = !/class="timer[^"]*"/.test(row);
  const ins = page.slice(page.indexOf('id="rw-ins"'));
  out.inspector = /class="badge rw-st s-done">Done</.test(ins);
  const sched = RV.schedule(r, map, Date.parse(SEEN)).filter(x => x.what === 'step' && x.id === id)[0];
  out.timeline = !!sched && /^done/.test(sched.status);
  const lateN = RV.schedule(r, map, Date.parse(SEEN)).filter(x => x.status === 'late' || x.status === 'started?').length;
  out.lateCount = lateN === 0 && !/Day timeline · \d+ · \d+ late/.test(page);
  /* Track counts: Next up's, when it's on the phase; otherwise what it would count (unanswered steps in the track). */
  const nu = RV.nextUp(r, map, 'person-avery'), tj = nu.kind === 'step' && nu.phaseIndex === 0 ? nu.tracks.filter(t => t.track.id === 'tj')[0] : null;
  const left = tj ? tj.left : map.phases[0].steps.filter(x => x.track === 'tj' && !RV.answered(r, x)).length;
  out.track = left === 0;
  const ms = V.mission(viewCtx(r, id)), li = around(ms, ms.indexOf(text), '<li', '</li>');
  out.screenShare = !li || (/data-a="done"/.test(li) && !/class="timer/.test(li));
  const rc = V.receipt(viewCtx(r, id)), rrow = around(rc, rc.indexOf(text), '<div class="rrow"', '</div>');
  out.receipt = /class="ric done"/.test(rrow);
  out.evidenceRows = /Search: [0-9a-f]{8}/.test(rrow) && /Results found: /.test(rrow);
  const pack = PFV.evidence.stepRows({ data: { people: [] } }, { run: r, map: map }), tr = around(pack, pack.indexOf(text), '<tr>', '</tr>');
  out.evidencePack = /<td>done/.test(tr) && /Results found: /.test(tr);
  out.insights = PFV.insights.evidence(r, id).current === 'done';
  /* Readiness reads completed runs only: an unfinished run is no evidence either way. */
  if (r.ended) { const rd = PFV.skills.readiness([r], PUB2, null); out.readiness = rd.completed === 1 && rd.clean === 1; }
  assert.strictEqual(JSON.stringify(o), before, 'the read changes nothing in the file');
  return out;
}
const WHEN = { before: 'before approval', after: 'after approval', completed: 'in a completed run' };
['before', 'after', 'completed'].forEach(stage => {
  rule('surfaces, ' + WHEN[stage] + ': a good record counts on every surface', () => {
    const c = surfaces(recorded(stage), 'points'), off = Object.keys(c).filter(k => !c[k]);
    assert.deepStrictEqual(off, [], 'the control counts: ' + JSON.stringify(c));
    if (stage === 'completed') assert.ok('readiness' in c, 'readiness is asked of the completed run');
  });
  Object.keys(BAD).forEach(kind => {
    rule('surfaces, ' + WHEN[stage] + ', ' + kind + ': no surface counts it', () => {
      const o = recorded(stage), id = STEP[kind] || 'points'; BAD[kind](o);
      const c = surfaces(o, id), on = Object.keys(c).filter(k => c[k]);
      assert.deepStrictEqual(on, [], 'should not count: ' + JSON.stringify(c));
    });
  });
});
run();
