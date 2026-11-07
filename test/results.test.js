// Module results (3.0, docs/design.md 47): a checklist's one typed result, set by its decision; a linked step that says which
// results it accepts and imports the result; settlement that holds the parent on a result it doesn't accept; the gate's
// sticky review when a result changes; "Completed · <result>" wherever a run's outcome shows.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), M = PF.map, P = PF.publish, R = PF.run, E = PF.envelope;
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const AT = '2026-11-07T09:00:00.000Z', LATER = '2026-11-07T10:00:00.000Z', LAST = '2026-11-07T11:00:00.000Z';

const CHILD = (o) => {
  o = o || {};
  return ['---', 'process: validate-story', 'title: Validate a story', 'context: ' + (o.context || 'issue, disposition:choice(cleared|needs-work|deferred)')]
    .concat(o.result === null ? [] : ['result: ' + (o.result || 'disposition')]).concat(['---', '', '## Assess · DO-CONFIRM {#assess}', '- [!] {confirm} Read the story {#read}',
      '- [!] {decide} Record the validation result {#verdict}', '  options: ' + (o.options || 'cleared, needs-work, deferred')])
    .concat(o.sets === null ? [] : ['  sets: ' + (o.sets || 'disposition=decision')]).concat(o.extra || []).join('\n') + '\n';
};
const PARENT = (o) => {
  o = o || {};
  return ['---', 'process: release', 'title: Release', 'context: ' + (o.context || 'issue, story_result:choice(cleared|needs-work|deferred)'), '---', '',
    '## Stories · DO-CONFIRM {#stories}', '- [!] {run.process} Validate the story {#story}', '  process: validate-story']
    .concat(o.sets === null ? [] : ['  sets: ' + (o.sets || 'story_result=result')]).concat(o.accepts === null ? [] : ['  accepts: ' + (o.accepts || 'cleared')])
    .concat(['', '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', '']).join('\n');
};
const blockers = (md, opts) => M.check(M.parse(md), opts || {}).blockers;
const has = (list, re) => assert.ok(list.some(x => re.test(x)), 'expected ' + re + ' in ' + JSON.stringify(list));
const none = (list, re) => assert.ok(!list.some(x => re.test(x)), 'unexpected ' + re + ' in ' + JSON.stringify(list));

/* ---------- Syntax and checks ---------- */
rule('A child with result: and its one decision binding checks clean and uses module-results', () => {
  const m = M.parse(CHILD());
  same(m.errors, []);
  same(M.check(m, {}).blockers, []);
  same(M.features(m), ['typed-details', 'module-results']);
  same(M.setsOf('disposition=decision, tag'), [{ name: 'disposition', from: 'decision' }, { name: 'tag', from: '' }]);
  const d = M.resultDef(m);
  same([d.name, d.options, d.step.id], ['disposition', ['cleared', 'needs-work', 'deferred'], 'verdict']);
  same(M.setBy(m).disposition.map(s => s.id), ['verdict'], 'the start form leaves the result for the run');
});

rule('result: blockers: unknown detail, not a choice, no producer, several, a plain sets:, a binding on another type, options that differ', () => {
  has(blockers(CHILD({ result: 'verdictx' })), /"result" names \^verdictx, which isn't listed in context/);
  has(blockers(CHILD({ context: 'issue, disposition' })), /The result \^disposition must be a choice/);
  has(blockers(CHILD({ sets: null })), /Nothing sets the result \^disposition/);
  has(blockers(CHILD({ extra: ['- [ ] {decide} Again {#again}', '  options: cleared, needs-work, deferred', '  sets: disposition=decision'] })), /set by 2 steps \(verdict, again\); exactly one decision sets it/);
  has(blockers(CHILD({ extra: ['- [ ] {confirm} Note it {#note}', '  sets: disposition'] })), /sets the result \^disposition itself; only its decision sets it/);
  has(blockers(CHILD({ extra: ['- [ ] {confirm} Note it {#note}', '  sets: disposition=decision'] })), /sets \^disposition=decision, but only a \{decide\} step has a decision/);
  has(blockers(CHILD({ options: 'cleared, deferred, needs-work' })), /options must be the result's choices, in the same order: options: cleared, needs-work, deferred/);
  has(blockers(CHILD({ result: null })), /binds \^disposition to its decision, but only the checklist's result is set that way. Add "result: disposition"/);
  has(blockers(CHILD({ sets: 'disposition=answer' })), /"sets: disposition=answer" isn't a binding Flightdeck knows/);
});

const childProcs = (md) => { const m = M.parse(md || CHILD()); return () => ({ map: m, title: m.meta.title, version: 1, latest: true }); };
rule('accepts: and sets: =result check against the child: known results, a compatible choice, a child that returns one', () => {
  same(blockers(PARENT(), { children: childProcs() }), []);
  same(M.features(M.parse(PARENT())), ['typed-details', 'module-results']);
  has(blockers(PARENT({ accepts: 'cleared, ready' }), { children: childProcs() }), /accepts "ready", which isn't a result Validate a story's latest version \(v1\) returns \(cleared, needs-work, deferred\)/);
  has(blockers(PARENT({ context: 'issue, story_result:choice(cleared|needs-work)' }), { children: childProcs() }), /imports Validate a story's result into \^story_result, which must be a choice holding every result it can return/);
  has(blockers(PARENT({ context: 'issue, story_result' }), { children: childProcs() }), /must be a choice holding every result/);
  has(blockers(PARENT(), { children: childProcs(CHILD({ result: null, sets: 'x' , context: 'issue, x' })) }), /declares no result \(result: in its front matter\), so accepts: has nothing to read/);
  has(blockers(PARENT({ accepts: null })), /imports a result into \^story_result but says nothing it accepts/);
  has(blockers(PARENT({ accepts: 'cleared, cleared' })), /accepts "cleared" twice/);
  has(blockers(PARENT({ context: 'issue, disposition, story_result:choice(cleared|needs-work|deferred)' }), { children: childProcs() }), /passes \^disposition to Validate a story, which is the result that checklist returns/);
  has(M.check(M.parse(PARENT({ sets: null, accepts: null })), { children: childProcs() }).suggestions, /returns a result \(cleared, needs-work, deferred\). Add accepts:/);
  has(M.check(M.parse(PARENT()), { children: () => ({ unpublished: true }) }).suggestions, /isn't published yet, so what it returns can't be checked/);
  has(blockers(PARENT().replace('{confirm} Ship it {#ship1}', '{confirm} Ship it {#ship1}\n  sets: story_result=result')), /only a \{run.process\} step has a linked run's result/);
});

rule('module-results is a 3.0 must-understand feature in checklists, publications and runs', () => {
  assert.ok(E.FROZEN.indexOf('module-results') >= 0);
  assert.strictEqual(E.minimum(['module-results', 'passed-details']), '3.0');
  same(E.stamp('preflight-publication', ['module-results'], '3.0.0'), { format: 'preflight-publication/2', features: ['module-results'], app: '3.0.0' });
  same(E.stamp('preflight-run', ['module-results'], '3.0.0').format, 'preflight-run/3');
  const old = E.judge('preflight-publication', { format: 'preflight-publication/2', features: ['module-results', 'not-yet'], app: '3.0.0' });
  assert.ok(!old.ok && /Needs Flightdeck 3\.0/.test(old.why), old.why);
});

run();
