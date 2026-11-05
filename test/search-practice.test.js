// Practice with Jira searches (2.16, sections 5.2 and 5.9 R14-1): a practice search has no identity, its results must
// meet the rule to check it, and a kept practice is read only with the draft it was kept for, dropping a checked search
// whose kept results don't meet the rule (and with it every gate).
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), P = PF.practice;
const NOW = '2026-11-04T15:00:00.000Z';
const MD = ['---', 'process: rel', 'title: Release', 'context: project, version', '---', '', '## Stories · DO-CONFIRM {#stories}',
  '- [!] {jira.search} Stories are Done in ^version {#done}', '  query: project = ^project AND fixVersion = ^version AND status != Done', '  results: none',
  '- [ ] {jira.search} The release has stories {#scope}', '  query: project = ^project AND fixVersion = ^version', '  results: at least 1', '',
  '## Gate: Ready {#ready}', ''].join('\n');
const ad = P.admit(MD, {});
assert.ok(ad.ok, ad.why);
const map = ad.map;
const ans = (st, id, values) => P.answer(st, map, id, 'done', {}, NOW, { values });

rule('practice: results that meet the rule check the search, with no searchId; results that break it are refused', () => {
  let st = P.fresh('rel');
  const ok = ans(st, 'done', { count: '0' });
  assert.ok(ok.state, ok.error);
  assert.deepStrictEqual(Object.keys(ok.state.answers.done.values), ['count']);
  const bad = ans(st, 'done', { count: '2', keys: 'PAY-1, PAY-2' });
  assert.ok(!bad.state && /don't meet the rule/.test(bad.error), bad.error);
  assert.match(ans(st, 'scope', { count: '0' }).error, /don't meet the rule/);
  assert.ok(ans(st, 'scope', { count: '3', keys: 'PAY-1 +2 more' }).state);
  assert.match(ans(st, 'done', {}).error, /number of results is needed/);
});
rule('kept practice: read only with its draft (R14-1); a checked search whose kept results break the rule is dropped, with every gate', () => {
  let st = ans(P.fresh('rel'), 'done', { count: '0' }).state;
  st = ans(st, 'scope', { count: '1', keys: 'PAY-1' }).state;
  const kept = JSON.parse(JSON.stringify(st));
  kept.gates = { ready: { s: 'passed', reason: '', at: NOW, approved: {}, base: 'a'.repeat(64) } };
  assert.throws(() => P.check(kept, 'rel'), /needs the draft it was kept for/);
  const back = P.check(JSON.parse(JSON.stringify(kept)), 'rel', map);
  assert.ok(back.answers.done && back.answers.scope);
  const forged = JSON.parse(JSON.stringify(kept)); forged.answers.done.values.count = '4';
  const read = P.check(forged, 'rel', map);
  assert.ok(!read.answers.done, 'the failing search is dropped');
  assert.ok(read.answers.scope, 'the good one stays');
  assert.deepStrictEqual(Object.keys(read.gates), [], 'and every gate with it');
});
run();
