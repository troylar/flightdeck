// Conditions (2.1): "only when ^detail is value" on a phase or a step. The syntax and its errors, the truth table, publishing
// as /2 with the conditions feature, and the run rules: what applies is worked out from the run's own details on every read,
// a Not needed step can't be answered and doesn't hold anything up, an unresolved one is held, and a changed detail sends
// answered steps back for a re-check.
'use strict';
const assert = require('assert');
const { load, rule, run, exactOf } = require('./harness');
const PF = load(), C = PF.conditions, M = PF.map, P = PF.publish, R = PF.run, E = PF.envelope;
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const NOW = '2026-10-21T09:00:00.000Z', LATER = '2026-10-21T10:00:00.000Z';
const errOf = (fn) => { try { fn(); } catch (e) { return e.message; } return null; };

const CTX = 'ticket, risk:choice(low|high), hotfix:yes-no, amount:number, path:choice(slow|fast), due:date, runbook:link';
const TYPES = M.parse(['---', 'process: x', 'title: X', 'context: ' + CTX, '---'].join('\n')).meta;
const parse = (t) => C.parse(t, TYPES.context, TYPES.detailTypes);
const MD = ['---', 'process: rel', 'title: Release', 'context: ' + CTX, 'roles: lead', '---', '',
  '## Hotfix · DO-CONFIRM {#hotfix}', '  only when ^hotfix is yes', '- [!] {confirm} Page the on-call lead {#page}', '',
  '## Decide · READ-DO {#decide}', '- [ ] {confirm} Pick the path {#pick}', '  sets: path', '',
  '## Release · READ-DO {#release}', '- [ ] {confirm} Tell the change board {#board}', '  only when ^risk is high',
  '- [ ] {confirm} Get finance sign-off {#finance}', '  only when ^amount is at least 10000', '- [!] {confirm} Ship it ^ticket {#ship}', '',
  '## Fast lane · READ-DO {#fast}', '  only when ^path is fast', '- [ ] {confirm} Take the fast lane {#lane}', ''].join('\n');

function publish(md) {
  const b = P.build(md, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.1.0' });
  assert.ok(!b.blockers, (b.blockers || []).join(' | '));
  const v = P.verify(b.folder, b.files, exactOf(PF, b.files));
  assert.ok(v.ok, v.why);
  return { b, v };
}
const start = (details, o) => R.create(publish((o && o.md) || MD).v, Object.assign({ title: 'Release 5', details: details || {}, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-c1', app: '2.1.0' }, o || {}));
const mapOf = (r) => R.mapOf(r);
const pi = (r, id) => mapOf(r).phases.findIndex(p => p.id === id);
/* Every gate up to (not including) phase id passed or skipped, so its steps can be answered. */
function upTo(r, id) {
  const map = mapOf(r);
  for (let i = 0; i < pi(r, id); i++) {
    if (R.gateStatus(r, map, i) === 'skipped') continue;
    map.phases[i].steps.forEach(s => { if (R.applies(r, map, i, s).applies === true && !R.answered(r, s)) R.done(r, map, s.id, 'person-avery', NOW, s.id === 'pick' ? { [R.detailKey('path')]: 'slow' } : {}); });
    R.pass(r, map, i, 'person-avery', NOW);
  }
}

/* ---------- Syntax ---------- */

rule('Each test parses to its canonical spelling, with its value in canonical form for the detail\'s kind', () => {
  same(parse('^risk is HIGH').test, { name: 'risk', op: 'is', values: ['high'], text: '^risk is high' });
  same(parse('^risk is not low').test.text, '^risk is not low');
  same(parse('^risk is one of low|High').test, { name: 'risk', op: 'oneof', values: ['low', 'high'], text: '^risk is one of low|high' });
  same(parse('^amount is at least 010000.50').test.values, ['10000.5']);
  same(parse('^due is at most 2028-02-29').test.values, ['2028-02-29']);
  same(parse('^hotfix is Yes').test.values, ['yes']);
  same(parse('^ticket is set').test.op, 'set');
  same(parse('^path is not set').test.op, 'notset');
  same(parse('^runbook is not set').test.op, 'notset');
});

rule('A condition that can\'t be read is refused with what to write instead', () => {
  assert.ok(/isn't listed in context/.test(parse('^nope is set').why));
  assert.ok(/isn't a number/.test(parse('^amount is at least 10k').why));
  assert.ok(/choices \(low, high\)/.test(parse('^risk is medium').why));
  assert.ok(/only be tested with is set or is not set/.test(parse('^ticket is ABC').why));
  assert.ok(/only be tested with is set or is not set/.test(parse('^runbook is https://example.com').why));
  assert.ok(/is, is not, is set or is not set/.test(parse('^hotfix is at least yes').why));
  assert.ok(/is, is not, is one of/.test(parse('^risk is at least low').why));
  assert.ok(/2 to 20 values/.test(parse('^risk is one of low').why));
  assert.ok(/listed twice/.test(parse('^risk is one of low|LOW').why));
  assert.ok(/Write a condition as/.test(parse('risk is high').why));
  assert.ok(/Write a condition as/.test(parse('^risk equals high').why));
});

/* ---------- The truth table ---------- */

rule('Truth table: empty makes comparisons false and "is not" true; a waiting or invalid value is unresolved', () => {
  const t = (s) => parse(s).test, NUM = C.defOf(TYPES.detailTypes, 'amount'), CH = C.defOf(TYPES.detailTypes, 'risk'), TXT = C.defOf(TYPES.detailTypes, 'ticket');
  assert.strictEqual(C.evaluate(t('^amount is at least 10'), '', NUM, false), false);
  assert.strictEqual(C.evaluate(t('^amount is 10'), '', NUM, false), false);
  assert.strictEqual(C.evaluate(t('^risk is one of low|high'), '', CH, false), false);
  assert.strictEqual(C.evaluate(t('^risk is not low'), '', CH, false), true);
  assert.strictEqual(C.evaluate(t('^risk is set'), '', CH, false), false);
  assert.strictEqual(C.evaluate(t('^risk is not set'), '', CH, false), true);
  ['^risk is set', '^risk is high', '^risk is not high', '^risk is one of low|high'].forEach(s => {
    assert.strictEqual(C.evaluate(t(s), 'high', CH, true), null, s + ': waiting');
    assert.strictEqual(C.evaluate(t(s), 'High', CH, false), null, s + ': invalid stored value');
  });
  assert.strictEqual(C.evaluate(t('^ticket is set'), 'anything at all', TXT, false), true);
});

rule('Numbers compare as exact decimals, dates by the calendar, choices by their canonical option', () => {
  const t = (s) => parse(s).test, NUM = C.defOf(TYPES.detailTypes, 'amount'), D = C.defOf(TYPES.detailTypes, 'due'), CH = C.defOf(TYPES.detailTypes, 'risk'), YN = C.defOf(TYPES.detailTypes, 'hotfix');
  assert.strictEqual(C.evaluate(t('^amount is at least 9007199254740993'), '9007199254740992', NUM, false), false);
  assert.strictEqual(C.evaluate(t('^amount is at most 9007199254740993'), '9007199254740993', NUM, false), true);
  assert.strictEqual(C.evaluate(t('^amount is 0.10'), '0.1', NUM, false), true);
  assert.strictEqual(C.evaluate(t('^amount is at least -1'), '-1.5', NUM, false), false);
  assert.strictEqual(C.evaluate(t('^due is at least 2028-02-29'), '2028-03-01', D, false), true);
  assert.strictEqual(C.evaluate(t('^due is at most 2028-02-28'), '2028-02-29', D, false), false);
  assert.strictEqual(C.evaluate(t('^risk is HIGH'), 'high', CH, false), true);
  assert.strictEqual(C.evaluate(t('^hotfix is no'), 'yes', YN, false), false);
  assert.strictEqual(C.combine([true, null, false]), false);
  assert.strictEqual(C.combine([true, null]), null);
  assert.strictEqual(C.combine([true, true]), true);
  assert.strictEqual(C.combine([]), true);
});

/* ---------- In a checklist ---------- */

rule('A checklist keeps each "only when" with its phase or step, and every error is a parse error', () => {
  const map = M.parse(MD);
  same(map.errors, []);
  same(map.phases[0].when.map(w => w.text), ['^hotfix is yes']);
  same(map.phases[2].steps[0].when.map(w => w.text), ['^risk is high']);
  assert.ok(!('when' in map.phases[1]) && !('when' in map.phases[2].steps[2]), 'nothing added where there is no condition');
  const bad = (lines, re) => {
    const m = M.parse(['---', 'process: x', 'title: X', 'context: ' + CTX, 'roles: lead', '---', ''].concat(lines).join('\n'));
    assert.ok(m.errors.some(e => re.test(e.msg)), lines.join(' / ') + ': ' + JSON.stringify(m.errors));
    assert.ok(M.check(m, {}).blockers.length, 'a blocker');
    assert.ok(P.unrunnable(['---', 'process: x', 'title: X', 'context: ' + CTX, '---', ''].concat(lines).join('\n'), {}), 'unrunnable');
  };
  bad(['  only when ^risk is high', '## A · READ-DO {#a}', '- [ ] {confirm} A {#a1}'], /right under a phase heading or a step/);
  bad(['## A · READ-DO {#a}', '- [ ] {confirm} A {#a1}', '## Gate: Go {#go}', '  only when ^risk is high'], /A gate can't have/);
  bad(['## A · READ-DO {#a}', '### Track: Left {#left}', '  only when ^risk is high', '- [ ] {confirm} A {#a1}'], /A track can't have/);
  bad(['## A · READ-DO {#a}', '- [ ] {confirm} A {#a1}', '  only when ^risk is high', '  only when ^risk is set', '  only when ^amount is set', '  only when ^hotfix is yes', '  only when ^due is set'], /at most 4/);
  bad(['## A · READ-DO {#a}', '- [ ] {confirm} A {#a1}', '  only when ^amount is 10k'], /isn't a number/);
  bad(['## A · READ-DO {#a}', '- [ ] {confirm} Pick {#a1}', '  sets: path', '- [ ] {confirm} B {#a2}', '  only when ^path is set'], /set in this phase or a later one/);
  bad(['## A · READ-DO {#a}', '  only when ^path is set', '- [ ] {confirm} B {#a2}', '## B · READ-DO {#b}', '- [ ] {confirm} Pick {#b1}', '  sets: path'], /set in this phase or a later one/);
  bad(['## A · READ-DO {#a}', '- [ ] {confirm} Pick {#a1}', '  sets: path', '  only when ^path is set'], /set in this phase or a later one/);
});

rule('A condition on a detail an earlier phase sets is allowed; one a later phase sets is not', () => {
  same(M.parse(MD).errors, []);
  const earlier = MD.replace('  sets: path\n', '').replace('- [!] {confirm} Ship it ^ticket {#ship}', '- [!] {confirm} Ship it ^ticket {#ship}\n  sets: path');
  same(M.parse(earlier).errors, [], 'still an earlier phase');
  const moved = MD.replace('  sets: path\n', '').replace('- [ ] {confirm} Take the fast lane {#lane}', '- [ ] {confirm} Take the fast lane {#lane}\n  sets: path');
  assert.ok(M.parse(moved).errors.some(e => /\^path is set in this phase or a later one/.test(e.msg)));
});

/* ---------- Publishing ---------- */

rule('A checklist with a condition publishes as /2 with the conditions feature, and needs Flightdeck 2.1', () => {
  same(M.features(M.parse(MD)), ['typed-details', 'conditions']);
  const info = JSON.parse(publish(MD).b.files['publication.json']);
  assert.strictEqual(info.format, 'preflight-publication/2');
  same(info.features, ['typed-details', 'conditions']);
  assert.strictEqual(E.minimum(info.features), '2.1');
  assert.strictEqual(E.minimum(['typed-details']), '2.0');
  assert.strictEqual(E.minimum([]), '');
  const n = P.needs(M.parse(MD), {});
  assert.strictEqual(n.needs, '2.1');
  assert.ok(n.names.indexOf('conditions (only when)') >= 0);
  const plain = MD.replace('context: ' + CTX, 'context: ticket, risk, hotfix, amount, path, due, runbook').split('\n').filter(l => !/only when/.test(l)).join('\n');
  assert.strictEqual(JSON.parse(publish(plain).b.files['publication.json']).format, 'preflight-publication/1', 'without conditions or typed details, still /1');
});

rule('A version whose record doesn\'t list conditions, or a /1 version with a condition, is unusable', () => {
  const { b } = publish(MD), info = JSON.parse(b.files['publication.json']);
  const without = Object.assign({}, info, { features: ['typed-details'] });
  const v = P.verify(b.folder, Object.assign({}, b.files, { 'publication.json': JSON.stringify(without) }), exactOf(PF, b.files));
  assert.ok(!v.ok && v.unusable && /conditions/.test(v.why), v.why);
  const one = Object.assign({}, info, { format: 'preflight-publication/1' }); delete one.features; delete one.payload; delete one.app;
  const v1 = P.verify(b.folder, Object.assign({}, b.files, { 'publication.json': JSON.stringify(one) }));
  assert.ok(!v1.ok && v1.unusable, v1.why);
});

rule('A file naming conditions with an older app still says it needs 2.1 (a file can\'t need less than its features)', () => {
  const ENV = load(false, (f, src) => f === 'core/envelope.js' ? src.replace("var PART4 = PART3.concat(['conditions']);", 'var PART4 = PART3;') : src).envelope;
  const v = ENV.judge('preflight-run', { format: 'preflight-run/3', features: ['conditions'], app: '2.0.0' });
  assert.ok(!v.ok && v.needs === '2.1' && /Needs Flightdeck 2\.1/.test(v.why), JSON.stringify(v));
  const w = ENV.judge('preflight-run', { format: 'preflight-run/3', features: ['typed-details', 'conditions'], app: '2.3.0' });
  assert.strictEqual(w.needs, '2.3');
});

/* ---------- Run rules ---------- */

rule('What applies is read from the run\'s details: Not needed steps aren\'t counted, a Not needed phase\'s gate is skipped', () => {
  const r = start({ ticket: 'T-1', risk: 'low', hotfix: 'no', amount: '500' }), map = mapOf(r);
  assert.strictEqual(R.gateStatus(r, map, 0), 'skipped');
  assert.ok(R.gateOk('skipped') && !R.phaseOpen(r, map, 0));
  assert.strictEqual(R.applies(r, map, 0).applies, false);
  assert.ok(/only when \^hotfix is yes \(hotfix is no\)/.test(R.applies(r, map, 0).why), R.applies(r, map, 0).why);
  assert.strictEqual(R.phaseOpen(r, map, 1), true, 'the next phase opens');
  const info = R.phaseInfo(r, map, 2);
  same([info.total, info.left, info.mustLeft, info.notNeeded.map(s => s.id), info.held.length], [1, 1, 1, ['board', 'finance'], 0]);
  assert.strictEqual(R.gateStatus(r, map, 3), 'locked', 'behind an open gate, a phase that isn\'t needed is still locked');
  assert.strictEqual(R.phaseInfo(r, map, 3).skipped, true, 'the path isn\'t fast (not chosen yet)');
  same(R.totals(r, map), { done: 0, total: 2 }, 'pick and ship');
});

rule('A Not needed step can\'t be answered on any path; a needed one still can, and Fill in after its gate still works', () => {
  const r = start({ ticket: 'T-1', risk: 'low', hotfix: 'no', amount: '500' }), map = mapOf(r);
  upTo(r, 'release');
  const why = /This step isn't needed in this run: only when \^risk is high \(risk is low\)/;
  [() => R.done(r, map, 'board', 'person-avery', NOW), () => R.na(r, map, 'board', 'person-avery', NOW), () => R.block(r, map, 'board', 'x', 'person-avery', NOW),
    () => R.start(r, map, 'board', 'person-avery', NOW), () => R.doneDifferently(r, map, 'board', 'by hand', 'person-avery', NOW), () => R.setFields(r, map, 'board', {}, { note: 'x' }, 'person-avery', NOW),
    () => R.clear(r, map, 'board', 'person-avery', NOW)].forEach((fn, k) => assert.ok(why.test(errOf(fn)), k + ': ' + errOf(fn)));
  assert.ok(why.test(R.stepNeeded(r, map, 'board')));
  assert.ok(why.test(R.canStartChild(r, map, 'board')));
  R.done(r, map, 'ship', 'person-avery', NOW);
  R.pass(r, map, 2, 'person-avery', NOW);
  assert.ok(R.phaseOpen(r, map, 3) === false && R.gateStatus(r, map, 3) === 'skipped', 'the fast lane isn\'t needed: the path is slow');
  assert.ok(R.allGatesOk(r, map));
  R.setFields(r, map, 'ship', {}, {}, 'person-avery', LATER);
  R.end(r, map, 'Completed', 'person-avery', 'Avery', LATER);
  assert.strictEqual(r.state, 'completed');
});

rule('Done differently on a step already done, and "did it differently", are refused once it isn\'t needed', () => {
  const r = start({ ticket: 'T-1', risk: 'high', hotfix: 'no', amount: '500' }), map = mapOf(r);
  upTo(r, 'release');
  R.done(r, map, 'board', 'person-avery', NOW);
  R.setDetail(r, map, 'risk', 'low', 'person-avery', NOW);
  assert.ok(/isn't needed/.test(errOf(() => R.doneDifferently(r, map, 'board', 'by hand', 'person-avery', NOW))));
  assert.ok(/isn't needed/.test(errOf(() => R.differently(r, map, 'board', 'by hand', 'person-avery', NOW))));
});

rule('A changed detail sends answered steps its conditions use back for a re-check; needed again means re-checked, not done', () => {
  const r = start({ ticket: 'T-1', risk: 'high', hotfix: 'no', amount: '500' }), map = mapOf(r);
  upTo(r, 'release');
  R.done(r, map, 'board', 'person-avery', NOW);
  R.done(r, map, 'ship', 'person-avery', NOW);
  R.pass(r, map, 2, 'person-avery', NOW);
  assert.strictEqual(R.setDetail(r, map, 'risk', 'low', 'person-avery', LATER), 1);
  assert.strictEqual(r.steps.board.s, 'recheck');
  assert.ok(/risk changed: this step's condition uses it/.test(r.steps.board.reason));
  same(r.marks.board, ['recheck']);
  assert.strictEqual(r.gates[map.phases[2].gate.id].s, 'review');
  assert.ok(/Changed risk from high to low; 1 step need a re-check, 1 step not needed now/.test(r.log[r.log.length - 1].what), r.log[r.log.length - 1].what);
  assert.strictEqual(R.phaseInfo(r, map, 2).left, 0, 'Not needed now: nothing left in the phase');
  R.setDetail(r, map, 'risk', 'high', 'person-avery', LATER);
  assert.strictEqual(r.steps.board.s, 'recheck', 'needed again: still in re-check, never done again by itself');
  assert.strictEqual(R.phaseInfo(r, map, 2).left, 1);
  assert.ok(/1 step now needed/.test(r.log[r.log.length - 1].what), r.log[r.log.length - 1].what);
});

rule('A detail set by an earlier step (sets:) decides a later phase, and changing it re-checks what it decided', () => {
  const r = start({ ticket: 'T-1', risk: 'low', hotfix: 'no', amount: '1' }), map = mapOf(r);
  assert.strictEqual(R.phaseInfo(r, map, 3).skipped, true, 'path is empty: not needed yet');
  upTo(r, 'decide');
  R.done(r, map, 'pick', 'person-avery', NOW, { [R.detailKey('path')]: 'fast' });
  assert.strictEqual(r.details.path, 'fast');
  R.pass(r, map, 1, 'person-avery', NOW);
  R.done(r, map, 'ship', 'person-avery', NOW); R.pass(r, map, 2, 'person-avery', NOW);
  assert.strictEqual(R.gateStatus(r, map, 3), 'open');
  R.done(r, map, 'lane', 'person-avery', NOW);
  R.setFields(r, map, 'pick', {}, { [R.detailKey('path')]: 'slow' }, 'person-avery', LATER);
  assert.strictEqual(r.steps.lane.s, 'recheck', 'through sets: as well');
});

rule('An unresolved condition holds its step: it counts as must-do left, so a passed or a waived gate needs review and the run can\'t complete', () => {
  const md = MD.replace('- [ ] {confirm} Get finance sign-off {#finance}\n  only when ^amount is at least 10000\n', '');
  const r = start({ ticket: 'T-1', hotfix: 'no', amount: '1', risk: '' }, { md, from: { source: 'plan', details: { risk: 'Hi' } } }), map = mapOf(r);
  assert.strictEqual(R.openMigrations(r).length, 1);
  upTo(r, 'release');
  const why = R.held(r, map, map.phases[2].steps[0]);
  assert.ok(/Risk still needs a choice \(it was "Hi" in the plan\)\. Set it in the run's details first\./.test(why), why);
  const info = R.phaseInfo(r, map, 2);
  same([info.left, info.mustLeft, info.held.map(s => s.id)], [2, 2, ['board']]);
  assert.ok(/Risk still needs a choice/.test(errOf(() => R.done(r, map, 'board', 'person-avery', NOW))));
  assert.ok(/Risk still needs a choice/.test(errOf(() => R.setFields(r, map, 'board', {}, {}, 'person-avery', NOW))));
  R.done(r, map, 'ship', 'person-avery', NOW);
  assert.ok(!R.canWaive(r, map, 2), 'can\'t waive with a held step');
  assert.ok(!R.canPass(r, map, 2));
  // A gate passed or waived before the step was held (written by hand here) needs review.
  r.gates[map.phases[2].gate.id] = { s: 'waived', reason: 'x', by: 'person-avery', at: NOW, approved: {} };
  assert.strictEqual(R.gateStatus(r, map, 2), 'review');
  r.gates[map.phases[2].gate.id] = { s: 'passed', by: 'person-avery', at: NOW, approved: {} };
  assert.strictEqual(R.gateStatus(r, map, 2), 'review');
  assert.ok(/every gate/.test(errOf(() => R.end(r, map, 'Completed', 'person-avery', 'Avery', NOW))));
  R.setDetail(r, map, 'risk', 'high', 'person-avery', LATER);
  assert.strictEqual(R.held(r, map, map.phases[2].steps[0]), '');
  assert.strictEqual(R.phaseInfo(r, map, 2).held.length, 0);
  R.done(r, map, 'board', 'person-avery', LATER);
  assert.strictEqual(R.gateStatus(r, map, 2), 'passed');
});

rule('Resolving a waiting detail re-checks an answer its condition used, and the mark outlives the history', () => {
  const md = MD.replace('  only when ^risk is high', '  only when ^risk is not high');
  const r = start({ ticket: 'T-1', hotfix: 'no', amount: '1', risk: '' }, { md }), map = mapOf(r);
  upTo(r, 'release');
  R.done(r, map, 'board', 'person-avery', NOW);
  // The detail is resolved from a migration (as a plan's "Hi" would be): the answered step goes to re-check.
  r.migrations = [{ path: 'details.risk', at: NOW, from: 'Hi', source: 'plan', verdict: 'ambiguous', result: null, resolved: null }];
  R.setDetail(r, map, 'risk', 'low', 'person-avery', LATER);
  assert.strictEqual(r.steps.board.s, 'recheck');
  for (let k = 0; k < 12; k++) { R.done(r, map, 'board', 'person-avery', LATER); R.na(r, map, 'board', 'person-avery', LATER); }
  assert.ok(!r.steps.board.history.some(h => h.s === 'recheck'), 'the re-check left run.json');
  assert.ok(r.marks.board.indexOf('recheck') >= 0, 'its mark stays');
});

rule('A child start is refused once its phase closes while it waits, and once its step isn\'t needed', () => {
  const md = MD.replace('- [ ] {confirm} Tell the change board {#board}', '- [ ] {run.process} Run the board check {#board}\n  process: board-check');
  const r = start({ ticket: 'T-1', risk: 'high', hotfix: 'no', amount: '1' }, { md }), map = mapOf(r);
  upTo(r, 'release');
  assert.strictEqual(R.canStartChild(r, map, 'board'), '');
  r.gates[map.phases[1].gate.id] = { s: 'review', was: 'passed', by: 'person-avery', at: NOW, reason: 'x', approved: {} };
  assert.ok(/isn't open/.test(R.canStartChild(r, map, 'board')));
  delete r.gates[map.phases[1].gate.id]; R.pass(r, map, 1, 'person-avery', NOW);
  R.setDetail(r, map, 'risk', 'low', 'person-avery', NOW);
  assert.ok(/isn't needed/.test(R.canStartChild(r, map, 'board')));
  assert.ok(/isn't needed/.test(errOf(() => R.linkChild(r, map, 'board', { process: 'board-check', id: 'c1' }, 'person-avery', NOW))));
  assert.ok(/ended/.test(R.canStartChild(Object.assign({}, r, { state: 'stopped' }), map, 'board')));
});

rule('A run without conditions reads exactly as before', () => {
  const md = MD.split('\n').filter(l => !/only when/.test(l)).join('\n');
  const r = start({ ticket: 'T-1' }, { md }), map = mapOf(r);
  const info = R.phaseInfo(r, map, 2);
  same(Object.keys(info), ['total', 'done', 'left', 'mustLeft', 'blocked', 'recheck']);
  same(map.phases.map((p, i) => R.gateStatus(r, map, i)), ['open', 'locked', 'locked', 'locked']);
  same(R.applies(r, map, 2, map.phases[2].steps[0]), { applies: true, why: '' });
});

/* ---------- Readiness and skill briefs ---------- */

/* A completed run: every step that applies done, every gate that isn't skipped passed. */
function completed(details, o) {
  const r = start(details, o), map = mapOf(r);
  map.phases.forEach((p, i) => {
    if (R.gateStatus(r, map, i) === 'skipped') return;
    p.steps.forEach(s => { if (R.applies(r, map, i, s).applies === true) R.done(r, map, s.id, 'person-avery', NOW, s.id === 'pick' ? { [R.detailKey('path')]: details.path || 'slow' } : {}); });
    R.pass(r, map, i, 'person-avery', NOW);
  });
  R.end(r, map, 'Completed', 'person-avery', 'Avery', NOW);
  return r;
}

rule('Readiness: a Not needed step or phase is neither required nor a deviation, and a skipped gate is fine', () => {
  const pub = publish(MD).v, runs = ['a', 'b', 'c'].map(k => Object.assign(completed({ ticket: 'T-' + k, risk: 'low', hotfix: 'no', amount: '1' }), { id: 'run-' + k, title: 'Run ' + k }));
  const ready = PF.skills.readiness(runs, pub, null);
  same([ready.completed, ready.clean, ready.deviations], [3, 3, []]);
  same(PF.skills.readiness(runs, pub, ['board', 'ship']).clean, 3);
});

rule('Readiness: a held step, or a covered phase\'s entry gate that only its record says passed, means the run wasn\'t clean', () => {
  const pub = publish(MD).v, r = completed({ ticket: 'T-1', risk: 'high', hotfix: 'no', amount: '1', path: 'fast' });
  assert.strictEqual(PF.skills.readiness([r], pub, ['lane']).clean, 1);
  // Its risk later reads as waiting for a person (as a hand-edited or merged file can): board is held, so the gate before
  // the fast lane derives review although its record says passed.
  r.details.risk = ''; r.migrations = [{ path: 'details.risk', at: NOW, from: 'Hi', source: 'plan', verdict: 'ambiguous', result: null, resolved: null }];
  const lane = PF.skills.readiness([r], pub, ['lane']);
  assert.strictEqual(lane.clean, 0);
  assert.ok(lane.deviations.some(d => d.step === pub.map.phases[2].gate.id && d.kind === 'gate review'), JSON.stringify(lane.deviations));
  const whole = PF.skills.readiness([r], pub, null);
  assert.ok(whole.deviations.some(d => d.step === 'board' && d.kind === 'held' && /Risk still needs a choice/.test(d.note)), JSON.stringify(whole.deviations));
});

rule('Briefs print every condition, say what Not needed means, and never tell the assistant to wait for a gate that is skipped', () => {
  const pub = publish(MD).v;
  const whole = PF.skills.createBrief(pub, null, PF.skills.readiness([], pub, null), []);
  assert.ok(/Only when \^hotfix is yes: otherwise the whole phase isn't needed in the run; skip it and its gate\./.test(whole), whole);
  assert.ok(/- only when: \^risk is high \(otherwise it isn't needed in the run: skip it;/.test(whole));
  assert.ok(/\*\*Gate: confirm "Hotfix" together\*\*\. If this phase isn't needed in the run, its gate shows Not needed and needs no pass; otherwise stop here until a person passes it; never pass it for them\./.test(whole));
  assert.ok(/\*\*Gate: confirm "Decide" together\*\*\. Stop here until a person passes it; never pass it for them\./.test(whole), 'an unconditional phase\'s gate as before');
  const part = PF.skills.createBrief(pub, ['lane'], PF.skills.readiness([], pub, ['lane']), []);
  assert.ok(/Before starting: \*\*Gate: confirm "Release" together\*\*\. If this phase isn't needed in the run, its gate shows Not needed and needs no pass; otherwise stop here until a person passes it; never pass it for them\. Check it has been passed, or shows Not needed, in the run first\./.test(part), part);
  const afterHotfix = PF.skills.createBrief(pub, ['pick'], PF.skills.readiness([], pub, ['pick']), []);
  assert.ok(/Its phase "Hotfix" applies only when \^hotfix is yes\. Check it has been passed, or shows Not needed, in the run first\./.test(afterHotfix), afterHotfix);
});

/* ---------- READ/2 ---------- */

rule('READ/2: a process lists each phase\'s and step\'s conditions; a run says whether each step and gate applies, and why a step is held', () => {
  const AJ = PF.appjson, wrongs = (v, d) => JSON.parse(JSON.stringify(AJ.conforms(v, d))), nameOf = AJ.names([{ id: 'person-avery', name: 'Avery' }]);
  const { v } = publish(MD), proc = { process: 'rel', pubs: [v], index: P.index([v]) };
  const out = AJ.process2(proc, v);
  same(wrongs(out, AJ.SCHEMA2.process), []);
  same(out.phases.map(p => p.when), [['^hotfix is yes'], [], [], ['^path is fast']]);
  same(out.phases[2].steps.map(x => x.id + ':' + x.when.join(',')), ['board:^risk is high', 'finance:^amount is at least 10000', 'ship:']);
  assert.ok(out.features.indexOf('conditions') >= 0);
  const r = start({ ticket: 'T-1', risk: 'low', hotfix: 'no', amount: '' });
  r.details.amount = '12a';
  const back = R.sanitize(JSON.parse(JSON.stringify(r)));
  back._archivedMigrations = [];
  const o = AJ.run2(back, [], nameOf);
  same(wrongs(o, AJ.SCHEMA2.run), []);
  const st = (id) => o.run.steps.find(x => x.id === id);
  same([st('page').applies, st('board').applies, st('finance').applies, st('ship').applies], [false, false, null, true]);
  assert.ok(/12a/.test(st('finance').held), st('finance').held);
  same([st('page').held, st('board').held, st('ship').held], [null, null, null]);
  same(o.run.gates.map(g => g.applies), [false, true, true, false], "path is empty, so the fast lane is not needed");
});

rule('Skipping never opens the way past an earlier gate: a phase after a skipped one stays locked until that earlier gate is through', () => {
  const r = start({ ticket: 'T-1', risk: 'low', hotfix: 'no', amount: '1' }), map = mapOf(r);
  // hotfix (not needed), decide (open), release, fast (not needed: the path isn't fast).
  assert.strictEqual(R.gateStatus(r, map, 1), 'open');
  assert.strictEqual(R.gateStatus(r, map, 3), 'locked', 'not needed, but behind an open gate');
  assert.ok(!R.gateOk(R.gateStatus(r, map, 3)), 'so nothing after it could open');
  upTo(r, 'fast');
  assert.strictEqual(R.gateStatus(r, map, 3), 'skipped', 'every gate before it through: now it is skipped');
  // With release's gate failed, the skipped phase after it is locked again.
  r.gates[map.phases[2].gate.id] = { s: 'failed', by: 'person-avery', at: LATER, reason: 'x', approved: {} };
  assert.strictEqual(R.gateStatus(r, map, 3), 'locked');
});

rule('A phase passed while a step wasn\'t needed goes to review when that step becomes needed, and stays in review after it is answered', () => {
  const r = start({ ticket: 'T-1', risk: 'low', hotfix: 'no', amount: '1' }), map = mapOf(r);
  upTo(r, 'release');
  R.done(r, map, 'ship', 'person-avery', NOW);
  R.pass(r, map, 2, 'person-avery', NOW);
  assert.strictEqual(R.gateStatus(r, map, 2), 'passed');
  R.setDetail(r, map, 'risk', 'high', 'person-avery', LATER);
  assert.strictEqual(r.gates[map.phases[2].gate.id].s, 'review', 'the record says review');
  R.done(r, map, 'board', 'person-avery', LATER);
  assert.strictEqual(R.gateStatus(r, map, 2), 'review', 'never passed again by itself');
});

rule('A detail its condition tests changing re-checks a child-run step, and the linked child no longer checks it by itself', () => {
  const md = MD.replace('- [ ] {confirm} Tell the change board {#board}\n  only when ^risk is high', '- [ ] {run.process} Run the board check {#board}\n  process: board-check\n  carry: ticket\n  only when ^risk is set');
  const r = start({ ticket: 'T-1', risk: 'high', hotfix: 'no', amount: '1' }, { md }), map = mapOf(r);
  upTo(r, 'release');
  const step = map.phases[2].steps.find(s => s.id === 'board');
  same(R.condFields(r, step), ['risk']);
  r.steps.board = { s: 'done', by: 'person-avery', at: NOW, child: { process: 'board-check', id: 'kid1', inputs: { ticket: 'T-1' } } };
  R.setDetail(r, map, 'risk', 'low', 'person-avery', LATER);
  assert.strictEqual(R.applies(r, map, 2, step).applies, true, 'still needed');
  assert.strictEqual(r.steps.board.s, 'recheck');
  assert.strictEqual(r.steps.board.child.failed, true, 'the sync that settles linked children skips it; a new run can replace it');
  same(r.steps.board.child.inputs, { ticket: 'T-1' }, 'what it carried is unchanged');
  // Already in re-check for a carried detail: a condition change still retires the child.
  r.steps.board = { s: 'recheck', by: 'person-avery', at: NOW, reason: 'ticket changed', child: { process: 'board-check', id: 'kid2', inputs: { ticket: 'T-1' } } };
  R.setDetail(r, map, 'risk', 'high', 'person-avery', LATER);
  assert.strictEqual(r.steps.board.child.failed, true, 'a re-check already waiting');
});

rule('Skill signatures: a step covers its own conditions and whether the gates around it need a pass; a checklist without conditions signs as before', () => {
  const S = PF.signature, sig = (md, id) => S.steps(M.parse(md), {}, {}, null)[id].sig;
  const changed = MD.replace('  only when ^amount is at least 10000', '  only when ^amount is at least 20000');
  assert.notStrictEqual(sig(MD, 'finance'), sig(changed, 'finance'), 'its own condition');
  assert.notStrictEqual(sig(MD, 'ship'), sig(changed, 'ship'), 'a sibling decides whether the closing gate is needed');
  assert.notStrictEqual(sig(MD, 'lane'), sig(changed, 'lane'), 'the phase before decides whether the entry gate is needed');
  assert.strictEqual(sig(MD, 'page'), sig(changed, 'page'), 'unrelated phases are untouched');
  const more = MD.replace('- [!] {confirm} Ship it ^ticket {#ship}', '- [!] {confirm} Ship it ^ticket {#ship}\n- [ ] {confirm} Tag it {#tagit}');
  assert.notStrictEqual(sig(MD, 'lane'), sig(more, 'lane'), 'a step without a condition added before decides the entry gate too');
  const plain = MD.split('\n').filter(l => !/only when/.test(l)).join('\n');
  Object.keys(S.steps(M.parse(plain), {}, {}, null)).forEach(id => assert.ok(sig(plain, id).indexOf('"when"') < 0, id));
});

rule('Not needed work keeps no time: its steps and its skipped phase\'s gate are left out of the schedule', () => {
  const md = MD.replace('- [!] {confirm} Page the on-call lead {#page}', '- [!] {confirm} Page the on-call lead {#page}\n  after: 1m').replace('## Decide · READ-DO {#decide}', '## Gate: Paged {#paged}\n  after: 2m\n\n## Decide · READ-DO {#decide}').replace('  only when ^risk is high', '  only when ^risk is high\n  after: 1m');
  const r = start({ ticket: 'T-1', risk: 'low', hotfix: 'no', amount: '1' }, { md }), map = mapOf(r);
  same(R.schedule(r, map, Date.parse(NOW) + 3600000).map(x => x.id), []);
  const yes = start({ ticket: 'T-1', risk: 'high', hotfix: 'yes', amount: '1' }, { md });
  same(R.schedule(yes, mapOf(yes), Date.parse(NOW) + 3600000).map(x => x.id).sort(), ['board', 'page', 'paged']);
});

rule('A child is judged on exactly what it was started with: a carried detail cleared or changed blocks it; a detail only its condition tests is not in its inputs', () => {
  const md = MD.replace('- [ ] {confirm} Tell the change board {#board}\n  only when ^risk is high', '- [ ] {run.process} Run the board check {#board}\n  process: board-check\n  carry: ticket\n  only when ^risk is set');
  const r = start({ ticket: 'T-1', risk: 'high', hotfix: 'no', amount: '1' }, { md }), map = mapOf(r);
  upTo(r, 'release');
  const step = map.phases[2].steps.find(s => s.id === 'board');
  r.steps.board = { s: 'open', child: { process: 'board-check', id: 'kid1', inputs: { ticket: 'T-1', risk: 'high' } } };
  // A child that carried risk (carry: edited since) and cleared it, or changed it, is never done.
  const child = { process: 'board-check', id: 'kid1', details: { ticket: 'T-1', risk: '' }, ended: { outcome: 'Completed' } };
  assert.strictEqual(R.childVerdict(r, step, r.steps.board, child, () => null).s, 'blocked', 'cleared');
  child.details.risk = 'low';
  assert.strictEqual(R.childVerdict(r, step, r.steps.board, child, () => null).s, 'blocked', 'changed');
  // Started as the app starts it now: only what it carries is in its inputs, so a detail only its condition tests isn't compared.
  r.steps.board = { s: 'open', child: { process: 'board-check', id: 'kid1', inputs: { ticket: 'T-1' } } };
  child.details.risk = '';
  same(R.childVerdict(r, step, r.steps.board, child, () => null), { s: 'done' });
  child.details.ticket = 'T-2';
  assert.strictEqual(R.childVerdict(r, step, r.steps.board, child, () => null).s, 'blocked', 'what it carried still counts');
});

run();
