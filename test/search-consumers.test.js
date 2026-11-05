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
run();
