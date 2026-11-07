// Loops (3.0, docs/design.md 44): a {for.each} step that starts one linked run of a child checklist per item in a living
// scope, the item sources it passes (item:key, item:title), and the checks a draft and a version get.
'use strict';
const assert = require('assert'), cp = require('child_process'), path = require('path');
const { load, rule, run } = require('./harness');
const PF = load(), M = PF.map, E = PF.envelope, T = PF.types;
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const has = (list, re) => assert.ok(list.some(x => re.test(x)), 'expected ' + re + ' in ' + JSON.stringify(list));
const none = (list, re) => assert.ok(!list.some(x => re.test(x)), 'unexpected ' + re + ' in ' + JSON.stringify(list));

const CHILD = ['---', 'process: validate-story', 'title: Validate a story', 'context: issue, story_title, fix_version, disposition:choice(cleared|needs-work|deferred|unknown)',
  'result: disposition', '---', '', '## Assess · DO-CONFIRM {#assess}', '- [!] {confirm} Read the story {#read}',
  '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work, deferred, unknown', '  sets: disposition=decision', ''].join('\n');
const PARENT = (lines, o) => {
  o = o || {};
  return ['---', 'process: release-readiness', 'title: Release readiness', 'context: ' + (o.context || 'fix_version'), '---', '',
    '## Scope · DO-CONFIRM {#scope}', '- [!] {jira.search} Find the release stories {#release-scope}', '  query: fixVersion = ^fix_version', '',
    '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every release story {#each}'].concat(lines == null ? [
    '  process: validate-story', '  from: #release-scope', '  items: jira.issue', '  pass: issue=item:key, story_title=item:title, fix_version=^fix_version', '  accepts: cleared'] : lines)
    .concat(['', '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', '']).join('\n');
};
const childMap = M.parse(CHILD);
const children = () => ({ map: childMap, title: 'Validate a story', version: 1, latest: true });
const check = (md, opts) => M.check(M.parse(md), Object.assign({ children }, opts || {}));

/* ---------- Syntax and checks ---------- */
rule('A {for.each} step parses with its fields and checks clean against its child', () => {
  const m = M.parse(PARENT());
  same(m.errors, []);
  const s = M.findStep(m, 'each').step;
  same([s.type, s.fields.process, s.fields.from, s.fields.items, s.fields.accepts], ['for.each', 'validate-story', '#release-scope', 'jira.issue', 'cleared']);
  same(check(PARENT()).blockers, []);
  assert.ok(M.features(m).indexOf('loops') >= 0, 'a loop uses the loops feature');
});
rule('loops is a frozen 3.0 feature every family that holds it knows', () => {
  assert.ok(E.FROZEN.indexOf('loops') >= 0);
  same(E.SINCE.loops, '3.0');
  same(E.minimum(['loops']), '3.0');
  assert.ok(E.FAMILIES['flightdeck-checklist'].majors[2].indexOf('loops') >= 0);
  assert.ok(E.FAMILIES['preflight-run'].majors[3].indexOf('loops') >= 0);
  assert.ok(E.FAMILIES['preflight-publication'].majors[2].indexOf('loops') >= 0);
  same(E.FAMILIES['flightdeck-plan'].future[3], '3.0');
});
rule('The built-in {for.each} type freezes as version 5', () => {
  const t = T.get('for.each');
  same([t.id, t.version], ['for.each', 5]);
  same(Object.keys(t.fields).sort(), ['from', 'items', 'max', 'process']);
  same(E.FAMILIES['flightdeck-types'].future[5], '3.0');
});
rule('item:key and item:title are item sources on a {for.each} step only', () => {
  same(PF.links.parse('issue=item:key, t=item:title', { items: true }).entries, [{ name: 'issue', source: 'item', item: 'key' }, { name: 't', source: 'item', item: 'title' }]);
  has(PF.links.parse('issue=item:id', { items: true }).errors, /item:key or item:title/);
  same(PF.links.parse('issue=item:key').entries, [{ name: 'issue', source: 'value', value: 'item:key' }], 'a {run.process} step keeps its 2.x reading');
});
rule('A loop needs accepts:, a child with a result, and accepts it returns', () => {
  has(check(PARENT(['  process: validate-story', '  items: jira.issue', '  pass: issue=item:key'])).blockers, /says nothing it accepts/);
  has(check(PARENT(['  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: shipped'])).blockers, /accepts "shipped", which isn't a result/);
  const plainChild = M.parse(CHILD.replace('result: disposition\n', '').replace('  sets: disposition=decision\n', ''));
  has(check(PARENT(), { children: () => ({ map: plainChild, title: 'Validate a story', version: 1, latest: true }) }).blockers, /declares no result/);
});
rule('from: names a {jira.search} step of this checklist, or is left out for a manual list', () => {
  has(check(PARENT(['  process: validate-story', '  from: #nowhere', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared'])).blockers, /from: names #nowhere/);
  has(check(PARENT(['  process: validate-story', '  from: #ship1', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared'])).blockers, /isn't a \{jira\.search\} step/);
  same(check(PARENT(['  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared'])).blockers, []);
});
rule('items: is a kind Flightdeck knows; max: is a whole number up to 500', () => {
  has(check(PARENT(['  process: validate-story', '  items: github.pr', '  pass: issue=item:key', '  accepts: cleared'])).blockers, /"items" should be one of: jira\.issue/);
  has(check(PARENT(['  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '  max: 900'])).blockers, /"max" should be a whole number from 1 to 500/);
  same(check(PARENT(['  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '  max: 60'])).blockers, []);
  same(PF.loop.KINDS['jira.issue'].label, 'Jira issue');
});
rule('A loop passes details the child has, and its own details must be in context', () => {
  has(check(PARENT(['  process: validate-story', '  items: jira.issue', '  pass: nope=item:key', '  accepts: cleared'])).blockers, /has no run detail nope/);
  has(check(PARENT(['  process: validate-story', '  items: jira.issue', '  pass: issue=item:key, fix_version=^release', '  accepts: cleared'])).blockers, /passes \^release, which isn't listed in context/);
  has(check(PARENT(['  process: validate-story', '  items: jira.issue', '  pass: disposition=item:key', '  accepts: cleared'])).blockers, /a run can't start with its own result/);
});
rule('A loop imports no result into a detail and can\'t start its own checklist', () => {
  has(check(PARENT(['  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '  sets: fix_version=result'])).blockers, /results stay per item/);
  has(check(PARENT(['  process: release-readiness', '  items: jira.issue', '  accepts: cleared'])).blockers, /can't start a run of its own process/);
});

/* ---------- The scope ledger (pure) ---------- */
const LP = PF.loop;
const story = (n, t) => ({ id: String(10000 + n), key: 'ABC-' + n, title: t || 'Story ' + n });
const obs = (ns, o) => Object.assign({ source: { system: 'jira' }, generation: 'g1', query: 'fixVersion = 4.1', observedAt: '2026-11-07T09:00:00Z',
  items: ns.map(n => story(n)), reported: ns.length, fetched: ns.length, complete: true, errors: [] }, o || {});
const req = (id, seen, o) => Object.assign({ id, type: 'request', seen: seen || [], by: { tool: 'release-helper', version: '1.0' }, observation: null, changes: [], children: [] }, o || {});
const dec = (id, seen, proposal, op, items, who) => ({ id, type: 'decision', seen, proposal, op, items, by: { person: who || 'person-morgan' } });
const states = (L) => L.items.map(x => x.key + ':' + x.state + (x.review.length ? '!' : '') + (x.mismatch ? '~' : ''));

rule('An observation adds its items; a complete later one that lacks an item proposes its removal and keeps it required', () => {
  const L = LP.reduce([req('r1', [], { observation: obs([101, 102, 103]) }), req('r2', ['r1'], { observation: obs([101, 102, 104]) })]);
  same(states(L), ['ABC-101:in', 'ABC-102:in', 'ABC-103:proposed', 'ABC-104:in']);
  same(L.pending, [{ uid: 'jira:10103', key: 'ABC-103', proposal: 'r2' }]);
  same(L.heads, ['r2']);
});
rule('An incomplete observation adds what it found and proposes nothing: absence is never removal', () => {
  const L = LP.reduce([req('r1', [], { observation: obs([101, 102]) }), req('r2', ['r1'], { observation: obs([103], { complete: false, reported: 3, fetched: 1, errors: ['Page 2 failed'] }) })]);
  same(states(L), ['ABC-101:in', 'ABC-102:in', 'ABC-103:in']);
  same(L.pending, []);
});
rule('Accepting a removal removes the item; restoring brings it back with its earlier attempts', () => {
  const recs = [req('r1', [], { observation: obs([101, 102]), children: [{ item: story(102), attempt: 1, inputs: { issue: 'ABC-102' } }] }),
    req('r2', ['r1'], { observation: obs([101]) }), dec('d1', ['r2'], 'r2', 'accept', ['jira:10102'])];
  let L = LP.reduce(recs);
  same(states(L), ['ABC-101:in', 'ABC-102:removed']);
  L = LP.reduce(recs.concat([req('r3', ['d1'], { by: { person: 'person-morgan' }, changes: [{ op: 'restore', item: { key: 'ABC-102' }, reason: 'Back in' }] })]));
  same(states(L), ['ABC-101:in', 'ABC-102:in']);
  same(L.items[1].attempt, 1, 'the earlier attempt is kept');
  same(L.items[1].provenance.map(p => p.op), ['add', 'propose-removal', 'accept-removal', 'restore']);
});
rule('Contrary decisions made at once leave the item needing review and required, until a decision that saw both', () => {
  const base = [req('r1', [], { observation: obs([101]) }), req('r2', ['r1'], { observation: obs([]) })];
  let L = LP.reduce(base.concat([dec('d1', ['r2'], 'r2', 'accept', ['jira:10101'], 'person-morgan'), dec('d2', ['r2'], 'r2', 'keep', ['jira:10101'], 'person-avery')]));
  same(states(L), ['ABC-101:in!']);
  same(L.items[0].review[0].ops, ['accept', 'keep']);
  L = LP.reduce(base.concat([dec('d1', ['r2'], 'r2', 'accept', ['jira:10101']), dec('d2', ['r2'], 'r2', 'keep', ['jira:10101']), dec('d3', ['d1', 'd2'], 'r2', 'accept', ['jira:10101'])]));
  same(states(L), ['ABC-101:removed']);
});
rule('A person may exclude an item the source still has: it stays flagged as a mismatch', () => {
  const L = LP.reduce([req('r1', [], { observation: obs([101, 102]) }), req('r2', ['r1'], { by: { person: 'person-morgan' }, changes: [{ op: 'exclude', item: { key: 'ABC-102' }, reason: 'Ships in 4.2' }] }),
    req('r3', ['r2'], { observation: obs([101, 102]) })]);
  same(states(L), ['ABC-101:in', 'ABC-102:removed~']);
  same(L.items[1].removed.reason, 'Ships in 4.2');
});
rule('Records are reduced in causal order, never by clock; the same record twice counts once', () => {
  const a = req('r1', [], { observation: obs([101]) }), b = req('r2', ['r1'], { observation: obs([102], { complete: false }) });
  same(states(LP.reduce([b, a, a])), states(LP.reduce([a, b])));
  same(LP.causal([b, a]).order.map(r => r.id), ['r1', 'r2']);
});
rule('A record that names one this copy can\'t read is held with what follows it; nothing of theirs applies', () => {
  const L = LP.reduce([req('r1', [], { observation: obs([101]) }), req('r2', ['r1', 'gone'], { observation: obs([]) }), req('r3', ['r2'], { changes: [{ op: 'exclude', item: { key: 'ABC-101' } }] })]);
  same(states(L), ['ABC-101:in']);
  same(L.held.map(h => h.record).sort(), ['r2', 'r3']);
  same(L.held.filter(h => h.record === 'r2')[0].missing, ['gone']);
});
rule('Planned children: one per item and attempt, whoever asked first; a second plan is noted, not applied', () => {
  const k = (who) => ({ item: story(101), attempt: 1, inputs: { issue: 'ABC-101' }, owner: who });
  const L = LP.reduce([req('r1', [], { observation: obs([101]), children: [k('person-avery')] }), req('r2', ['r1'], { children: [k('person-morgan')] })]);
  same([L.items[0].attempt, L.items[0].owner, L.items[0].planned.record], [1, 'person-avery', 'r1']);
  same(L.duplicates.map(d => d.record), ['r2']);
});
rule('Exceptions and owners are decisions on an item; withdrawing restores the plain state', () => {
  const L = LP.reduce([req('r1', [], { observation: obs([101]) }), req('r2', ['r1'], { by: { person: 'person-casey' }, changes: [{ op: 'exception', item: { key: 'ABC-101' }, reason: 'Docs only', approver: 'person-morgan', onBehalf: true }, { op: 'owner', item: { key: 'ABC-101' }, owner: 'person-avery' }] })]);
  same([L.items[0].exception.approver, L.items[0].exception.onBehalf, L.items[0].owner], ['person-morgan', true, 'person-avery']);
  const W = LP.reduce([req('r1', [], { observation: obs([101]) }), req('r2', ['r1'], { changes: [{ op: 'exception', item: { key: 'ABC-101' }, reason: 'x', approver: 'p' }] }), req('r3', ['r2'], { changes: [{ op: 'withdraw', item: { key: 'ABC-101' } }] })]);
  same(W.items[0].exception, null);
});
rule('A key added by hand meets its id when an observation reports it: one item', () => {
  const L = LP.reduce([req('r1', [], { by: { person: 'person-morgan' }, changes: [{ op: 'add', item: { key: 'ABC-101' } }] }), req('r2', ['r1'], { observation: obs([101, 102]) })]);
  same(L.items.map(x => x.uid), ['jira:10101', 'jira:10102']);
});
rule('Sixty items, and more than max: every one stays, the overflow is named, nothing is cut', () => {
  const ns = Array.from({ length: 60 }, (_, i) => 101 + i);
  const L = LP.reduce([req('r1', [], { observation: obs(ns) })], { max: 50 });
  same([L.items.length, L.overLimit], [60, { count: 60, max: 50 }]);
  same(LP.reduce([req('r1', [], { observation: obs(ns) })]).overLimit, null);
});

const CHECKER = path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py');
function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* try next */ } } return null; }
rule('check_folder.py --draft gives a loop the app\'s blockers word for word, and the same features', () => {
  const py = python(); if (!py) return;
  const L = (x) => ['  process: validate-story', '  items: jira.issue'].concat(x);
  const cases = [PARENT(), PARENT(L(['  pass: issue=item:key'])), PARENT(L(['  pass: issue=item:id', '  accepts: cleared, cleared'])),
    PARENT(['  process: validate-story', '  from: #nowhere', '  items: jira.issue', '  accepts: cleared', '  max: 0']),
    PARENT(['  process: validate-story', '  from: #ship1', '  items: github.pr', '  accepts: cleared', '  carry: fix_version', '  sets: fix_version=result']),
    PARENT(L(['  pass: x=^zzz_unknown_detail_name', '  accepts: cleared', '  version: 2'])), PARENT(['  process: release-readiness', '  items: jira.issue', '  accepts: cleared'])];
  const src = "import json,sys,importlib.util\nspec=importlib.util.spec_from_file_location('cf',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n" +
    "d=json.load(sys.stdin)\nprint(json.dumps([[m.draft_check(md,[])['blockers'], m.features(m.parse_map(md), {})] for md in d]))";
  const out = JSON.parse(cp.execFileSync(py, ['-I', '-c', src, CHECKER], { input: JSON.stringify(cases), encoding: 'utf8' }));
  cases.forEach((md, i) => {
    const app = M.check(M.parse(md), {}).blockers.filter(b => /Validate every release story/.test(b) && !/Did you mean/.test(b));
    same(out[i][0].filter(b => /Validate every release story/.test(b)).sort(), app.sort(), 'the loop blockers, case ' + i);
    same(out[i][1], M.features(M.parse(md)), 'the features, case ' + i);
  });
  same(out[0][0], []);
});

run();
