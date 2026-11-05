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
rule('kept practice: invalid evidence is dropped on reload as Done refuses it (keys at 0, keys against the count); without evidence stays', () => {
  let st = ans(P.fresh('rel'), 'done', { count: '0' }).state;
  st = ans(st, 'scope', { count: '1', keys: 'PAY-1' }).state;
  const kept = JSON.parse(JSON.stringify(st));
  kept.gates = { ready: { s: 'passed', reason: '', at: NOW, approved: {}, base: 'abcd1234' } };
  assert.deepStrictEqual(Object.keys(P.check(JSON.parse(JSON.stringify(kept)), 'rel', map).gates), ['ready'], 'set-up: a good kept practice keeps its gate');
  [['done', { count: '0', keys: 'PAY-1' }], ['scope', { count: '1', keys: 'PAY-1, PAY-2' }], ['scope', { count: '1', keys: 'nope' }]].forEach(([id, v]) => {
    const f = JSON.parse(JSON.stringify(kept)); f.answers[id].values = v;
    const read = P.check(f, 'rel', map);
    assert.ok(!read.answers[id], id + ' ' + JSON.stringify(v) + ' is dropped');
    assert.deepStrictEqual(Object.keys(read.gates), [], 'and every gate with it');
  });
  const sk = ans(P.fresh('rel'), 'done', null);
  const skipped = P.answer(P.fresh('rel'), map, 'done', 'done', {}, NOW, { skipped: true }).state;
  assert.ok(skipped && skipped.answers.done.skipped, sk.error);
  assert.ok(P.check(JSON.parse(JSON.stringify(skipped)), 'rel', map).answers.done, 'checked without evidence stays');
});
rule('kept practice: reload runs the whole shared evidence check (require:, setter values); an invalid answer goes, with every gate', () => {
  const md = ['---', 'process: req', 'title: Req', 'context: project, tag:pattern(v[0-9]+)', '---', '', '## One · DO-CONFIRM {#one}',
    '- [ ] {jira.search} The release has stories {#find}', '  query: project = ^project', '  results: at least 1', '  require: resultsLink',
    '- [ ] {confirm} Note the tag {#note}', '  sets: tag', '', '## Gate: Ready {#ready}', ''].join('\n');
  const a = P.admit(md, {});
  assert.ok(a.ok, a.why);
  const m = a.map, go = (st, id, values) => { const r = P.answer(st, m, id, 'done', {}, NOW, { values }); assert.ok(r.state, r.error); return r.state; };
  assert.ok(P.answer(P.fresh('req'), m, 'find', 'done', {}, NOW, { values: { count: '1', keys: 'PAY-1' } }).error, 'set-up: Done refuses it without the link');
  let st = go(P.fresh('req'), 'find', { count: '1', keys: 'PAY-1', resultsLink: 'https://j.example.com/issues/?jql=x' });
  const noteKey = P.answer(P.fresh('req'), m, 'note', 'done', {}, NOW, { values: {} }).field;
  assert.ok(noteKey, 'set-up: the setter asks for its value');
  st = go(st, 'note', { [noteKey]: 'v12' });
  const kept = JSON.parse(JSON.stringify(st));
  kept.gates = { ready: { s: 'passed', reason: '', at: NOW, approved: {}, base: 'abcd1234' } };
  assert.deepStrictEqual(Object.keys(P.check(JSON.parse(JSON.stringify(kept)), 'req', m, {}).gates), ['ready'], 'set-up: a good kept practice keeps its gate');
  const noLink = JSON.parse(JSON.stringify(kept)); delete noLink.answers.find.values.resultsLink;
  let read = P.check(noLink, 'req', m, {});
  assert.ok(!read.answers.find, 'a search missing what require: asks for is dropped');
  assert.ok(read.answers.note, 'the good one stays');
  assert.deepStrictEqual(Object.keys(read.gates), [], 'and every gate with it');
  const badTag = JSON.parse(JSON.stringify(kept)); badTag.answers.note.values[noteKey] = 'nope';
  read = P.check(badTag, 'req', m, {});
  assert.ok(!read.answers.note, 'a setter whose value breaks its detail\'s pattern is dropped');
  assert.ok(read.answers.find, 'the good one stays');
  assert.deepStrictEqual(Object.keys(read.gates), [], 'and every gate with it');
  assert.ok(!read.setBy || !Object.values(read.setBy).includes('note'), 'and what it set no longer names it');
  const gone = JSON.parse(JSON.stringify(kept)); delete gone.answers.note.values;
  assert.ok(!P.check(gone, 'req', m, {}).answers.note, 'a setter checked without its value (and not skipped) is dropped');
});
run();
