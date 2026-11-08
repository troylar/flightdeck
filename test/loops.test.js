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
  same(Object.keys(t.fields).sort(), ['from', 'items', 'max', 'noun', 'process', 'source']);
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

/* ---------- Scope requests and decisions in proposals/ ---------- */
const LOOPT = { process: 'release-readiness', run: 'r-41', step: 'each' };
const intentOf = (o) => { const v = Object.assign({ loop: LOOPT, observation: obs([101, 102]), changes: [] }, o || {}); if (v.seen === undefined) delete v.seen; return v; };
rule('A scope request is flightdeck-plan/3 with loops: an older copy calls it newer, this one never reads it as a plan', () => {
  const c = LP.cleanIntent(intentOf(), 'import-42', { name: 'release-helper', version: '1.0' });
  same(c.errors, []);
  const f = LP.buildRequest(c.intent, { seen: [], children: [], now: '2026-11-07T09:01:00Z', app: '3.0.0' });
  same([f.format, f.features, f.id.slice(0, 19)], ['flightdeck-plan/3', ['loops'], 'req-release-helper-']);
  assert.notStrictEqual(f.id, PF.requests.idFor('release-helper', 'import-42'), 'never the name a plan request with that key gets');
  const pv = PF.plans.clean(JSON.parse(LP.text(f)), f.id + '.json', false);
  same([pv.ok, pv.kind], [false, 'malformed'], 'the plan reader never takes it');
  const back = LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json');
  same([back.ok, back.record.type, back.record.loop, back.record.observation.items.length], [true, 'request', LOOPT, 2]);
});
rule('The observation is checked: ids, keys, totals, pagination; complete only when it says so and adds up', () => {
  const bad = LP.cleanIntent(intentOf({ observation: Object.assign(obs([101]), { items: [{ id: 'x', key: 'abc-1' }] }) }), 'k', { name: 't', version: '1' });
  has(bad.errors, /"id" is the issue's id/); has(bad.errors, /"key" is an issue key/);
  const short = LP.cleanIntent(intentOf({ observation: obs([101], { reported: 3, fetched: 1, complete: true }) }), 'k', { name: 't', version: '1' });
  same([short.errors, short.intent.observation.complete, short.intent.observation.why], [[], false, 'it read 1 of 3 reported matches']);
  has(LP.cleanIntent(intentOf({ observation: obs([101], { complete: 'yes' }) }), 'k', { name: 't', version: '1' }).errors, /"complete" is true or false/);
  const big = LP.cleanIntent(intentOf({ observation: obs(Array.from({ length: 501 }, (_, i) => 101 + i)) }), 'k', { name: 't', version: '1' });
  has(big.errors, /at most 500 items; this one has 501. Nothing is cut/);
});
rule('The canonical intent ignores order and the tool\'s version; a different one names what changed', () => {
  const a = LP.cleanIntent(intentOf(), 'k', { name: 'release-helper', version: '1.0' }).intent;
  const b = LP.cleanIntent(intentOf({ observation: Object.assign(obs([101, 102]), { items: [story(102), story(101)] }) }), 'k', { name: 'release-helper', version: '2.0' }).intent;
  const f = LP.buildRequest(a, { seen: [], children: [], now: 'x', app: '3.0.0' });
  same(LP.differs(b, f), []);
  const c = LP.cleanIntent(intentOf({ changes: [{ op: 'exclude', item: { key: 'ABC-101' }, reason: 'Ships later' }] }), 'k', { name: 'release-helper', version: '1.0' }).intent;
  same(LP.differs(c, f), ['changes']);
});
rule('A decision is flightdeck-plan-status/3 with loops, immutable and named after its request', () => {
  const d = LP.buildDecision({ proposal: 'req-release-helper-0123456789abcdef01234567', loop: LOOPT, op: 'accept', items: ['jira:10101'], seen: ['req-release-helper-0123456789abcdef01234567'], reason: 'Moved out', by: 'person-morgan', writer: 'w1', rev: 'a1b2c3d4', now: 'x', app: '3.0.0' });
  same([d.name, d.file.format, d.file.features], ['req-release-helper-0123456789abcdef01234567.status-w1-a1b2c3d4.json', 'flightdeck-plan-status/3', ['loops']]);
  same(PF.plans.clean(d.file, d.name, false).ok, false);
  const back = LP.cleanDecision(JSON.parse(JSON.stringify(d.file)), d.name);
  same([back.ok, back.record.type, back.record.op, back.record.items], [true, 'decision', 'accept', ['jira:10101']]);
  same(LP.cleanDecision(Object.assign({}, d.file, { op: 'shrug' }), d.name).ok, false);
});

/* ---------- Storage: the folder reader dispatches scope records before plans ---------- */
const memFs = (files) => { const m = new PF.fs.MemoryFS('loops-' + Math.random(), null); Object.keys(files || {}).forEach(p => { m.files[p] = { t: files[p], m: 1 }; }); return m; };
const reqFile = (key, o) => { const c = LP.cleanIntent(intentOf(Object.assign({}, o || {}, { seen: undefined })), key, { name: 'release-helper', version: '1.0' }); same(c.errors, []); return LP.buildRequest(c.intent, { seen: (o && o.seen) || [], children: [], now: '2026-11-07T09:01:00Z', app: '3.0.0' }); };
rule('readPlans reads scope requests and decisions as scope records, never as plans, and a plan beside them as before', async () => {
  const f = reqFile('import-1'), d = LP.buildDecision({ proposal: f.id, loop: LOOPT, op: 'keep', items: ['jira:10101'], seen: [f.id], by: 'person-morgan', writer: 'w1', rev: '0a0b0c0d', now: 'x', app: '3.0.0' });
  const plan = { kind: 'plan', id: 'plan-abc', process: 'release-readiness', version: 1, title: 'Release', details: {}, roles: {} };
  const m = memFs({ ['proposals/' + f.id + '.json']: LP.text(f), ['proposals/' + d.name]: LP.text(d.file), 'proposals/plan-abc.json': JSON.stringify(plan) });
  const bad = [], got = await PF.repo.readPlans(m, bad, null, true);
  same([got.plans.map(p => p.id), got.statuses.length, got.scopes.map(r => r.type).sort(), bad], [['plan-abc'], 0, ['decision', 'request'], []]);
  const all = await PF.repo.loadAll(m, {});
  same([all.plans.map(p => p.id), all.scopes.length], [['plan-abc'], 2]);
});
rule('saveScope writes a scope record once and never replaces one', async () => {
  const f = reqFile('import-2'), m = memFs({});
  await PF.repo.saveScope(m, f.id + '.json', f);
  same(JSON.parse(m.files['proposals/' + f.id + '.json'].t).id, f.id);
  same((await PF.repo.saveScope(m, f.id + '.json', Object.assign({}, f, { created: 'later' }))).conflict, true);
  same(JSON.parse(m.files['proposals/' + f.id + '.json'].t).created, '2026-11-07T09:01:00Z');
  await assert.rejects(PF.repo.saveScope(m, 'plan-x.json', f), /isn't the name of a scope record/);
});
rule('A OneDrive copy that says the same counts once; copies that differ hold the request and everything after it', () => {
  const a = LP.cleanRequest(JSON.parse(LP.text(reqFile('k'))), reqFile('k').id + '.json').record;
  const same2 = Object.assign({}, a, { _file: a.id + '-LAPTOP.json' }), other = Object.assign({}, a, { _file: a.id + ' (1).json', changes: [{ op: 'exclude', item: { id: '', key: 'ABC-101', title: '' }, reason: 'x' }] });
  same(LP.reduce([a, same2]).held, []);
  const L = LP.reduce([a, other]);
  same([L.held.map(h => h.record), L.held[0].why, L.items.length], [[a.id], 'copies', 0]);
});

/* ---------- The gate's roll-up, approval and sticky review (pure) ---------- */
const kid = (n, o) => Object.assign({ id: 'c' + n, process: 'validate-story', title: 'Validate ABC-' + n, recorder: { person: 'person-avery' }, state: 'running', ended: null,
  parent: { process: 'release-readiness', id: 'r-41', step: 'each', item: { uid: 'jira:' + (10000 + n), key: 'ABC-' + n, attempt: 1 } } }, o || {});
const ended = (n, value, o) => kid(n, Object.assign({ state: 'completed', ended: { outcome: 'Completed', at: 'x' }, _result: value }, o || {}));
const RO = (L, runs, o) => LP.rollup(L, runs, Object.assign({ accepts: ['cleared'], result: (c) => ({ value: c._result || '' }), stands: () => '' }, o || {}));
rule('The roll-up counts exactly, keeps scope, outcome and exception apart, and links every blocker to its remedy', () => {
  const ns = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111];
  const L = LP.reduce([req('r1', [], { observation: obs(ns) }), req('r2', ['r1'], { by: { person: 'person-morgan' }, changes: [{ op: 'exception', item: { key: 'ABC-110' }, reason: 'Docs only', approver: 'person-morgan' }] })]);
  const runs = ns.slice(0, 9).map(n => ended(n, 'cleared')).concat([ended(111, 'needs-work', { recorder: { person: 'person-morgan' } })]);
  const R = RO(L, runs);
  same(R.summary, '11 in scope · 9 cleared by validation · 1 approved without a run · 1 needs work');
  same(R.ok, false);
  same(R.blockers.map(b => [b.key, b.kind, b.run]), [['ABC-111', 'result', 'c111']]);
  same(R.blockers[0].text, 'ABC-111 needs work · person-morgan');
  same(RO(L, runs.concat([ended(110, 'needs-work')])).counts.exception, 1, 'an exception never rewrites a needs-work result as cleared');
  same(RO(L, runs.slice(0, 9).concat([ended(111, 'cleared')])).ok, true);
});
rule('Not started, in progress, removed, needs review, competing starts and held records each hold the gate, by name', () => {
  const L = LP.reduce([req('r1', [], { observation: obs([101, 102, 103, 104]) }), req('r2', ['r1'], { by: { person: 'person-morgan' }, changes: [{ op: 'exclude', item: { key: 'ABC-104' }, reason: 'Later' }] })]);
  const R = RO(L, [kid(101), kid(102), kid(102, { id: 'c102b' })]);
  same(R.blockers.map(b => b.key + ':' + b.kind), ['ABC-101:running', 'ABC-102:competing', 'ABC-103:not-started']);
  same([R.counts.inScope, R.counts.removed], [3, 1]);
  same(R.items.filter(i => i.key === 'ABC-102')[0].runs.sort(), ['c102', 'c102b']);
  const H = RO(LP.reduce([req('r1', [], { observation: obs([101]) }), req('r2', ['gone'], { observation: obs([]) })]), [ended(101, 'cleared')]);
  same(H.blockers.map(b => b.kind), ['held']);
});
rule('Approval records scope, decisions and results; any relevant change after it is listed, all of it, add then drop too', () => {
  const r1 = req('r1', [], { observation: obs([101, 102]) });
  const L = LP.reduce([r1]), R = RO(L, [ended(101, 'cleared'), ended(102, 'cleared')]);
  const snap = LP.approval(L, R, { by: 'person-morgan', at: 'x' });
  same([snap.counts.cleared, snap.items.map(i => i.uid + '=' + i.result + '@' + i.run)], [2, ['jira:10101=cleared@c101', 'jira:10102=cleared@c102']]);
  same(LP.changes(snap, L, R), [], 'nothing changed');
  const quiet = LP.reduce([r1, req('r2', ['r1'], { observation: obs([101, 102], { generation: 'g2' }) })]);
  same(LP.changes(snap, quiet, RO(quiet, [ended(101, 'cleared'), ended(102, 'cleared')])), [], 'a repeat observation with nothing new stays quiet');
  const added = LP.reduce([r1, req('r2', ['r1'], { observation: obs([101, 102, 112], { complete: false }) })]);
  same(LP.changes(snap, added, RO(added, [ended(101, 'cleared'), ended(102, 'needs-work')])), ['ABC-102 now returns needs-work (it was cleared).', 'ABC-112 was added after this approval.']);
  const dropped = LP.reduce([r1, req('r2', ['r1'], { by: { person: 'person-casey' }, changes: [{ op: 'add', item: { key: 'ABC-112' } }] }), req('r3', ['r2'], { by: { person: 'person-casey' }, changes: [{ op: 'exclude', item: { key: 'ABC-112' }, reason: 'Wrong one' }] })]);
  same(LP.changes(snap, dropped, RO(dropped, [ended(101, 'cleared'), ended(102, 'cleared')])), ['ABC-112 was added after this approval.', 'ABC-112 was removed from scope after this approval.']);
});

/* ---------- Runs: the pin, children that name their item, approval and its sticky review ---------- */
const P = PF.publish, R = PF.run, AT = '2026-11-07T09:00:00.000Z';
const exactOf = (files) => P.exactOf({ 'map.md': new Uint8Array(Buffer.from(files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(files['types.json'], 'utf8')) });
let seq = 0;
function publishMd(md, extra) {
  const b = P.build(md, Object.assign({ by: 'person-avery', changes: 'x', now: AT, existing: [], rand: 'r' + String(++seq).padStart(7, '0'), app: '3.0.0' }, extra || {}));
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const v = P.verify(b.folder, b.files, exactOf(b.files)); assert.ok(v.ok, v.why); v.folder = b.folder; v.process = M.parse(md).meta.process; v.files = b.files;
  return v;
}
const procOf3 = (pubs) => { const i = P.index(pubs); return { latest: i.latest, all: i.all, clashes: i.clashes, broken: [] }; };
function release() {
  const kp = publishMd(CHILD), procs = { 'validate-story': procOf3([kp]) }, procOf = (id) => procs[id] || null;
  const md = ['---', 'process: release-readiness', 'title: Release readiness', 'context: fix_version', '---', '', '## Stories · DO-CONFIRM {#stories}',
    '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key, fix_version=^fix_version', '  accepts: cleared', '',
    '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
  const pp = publishMd(md, { childProcs: procs });
  const r = R.create(pp, { id: 'r-41', by: 'person-morgan', session: 'w', now: AT, app: '3.0.0', details: { fix_version: '4.1' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
  const kid2 = (n, decision) => {
    const c = R.create(kp, { id: 'k' + n, by: 'person-avery', session: 'w2', now: AT, app: '3.0.0', details: { issue: 'ABC-' + n, fix_version: '4.1' }, parent: { process: 'release-readiness', id: 'r-41', step: 'each', item: { uid: 'jira:' + (10000 + n), key: 'ABC-' + n, attempt: 1 } } });
    const m = R.mapOf(c);
    R.done(c, m, 'read', 'person-avery', AT);
    if (decision) { R.done(c, m, 'verdict', 'person-avery', AT, { decision }); R.pass(c, m, 0, 'person-avery', AT); R.end(c, m, 'Completed', 'person-avery', 'Avery', AT); }
    return c;
  };
  return { r, kp, pp, kid2 };
}
rule('A parent run pins its loop\'s child once; a child names its item and the loops feature, and both read back', () => {
  const { r, kid2 } = release();
  assert.ok(r.features.indexOf('loops') >= 0, 'the parent is a loops run');
  same([r.pins.children.each.process, r.pins.children.each.version], ['validate-story', 1]);
  const c = kid2(101, 'cleared');
  same([c.parent.item, c.features.indexOf('loops') >= 0], [{ uid: 'jira:10101', key: 'ABC-101', attempt: 1 }, true]);
  const back = R.sanitize(plain(c));
  same([back._unrunnable, back.parent.item], [undefined, { uid: 'jira:10101', key: 'ABC-101', attempt: 1 }]);
});
rule('The loop step is approved only with a roll-up that clears; a later change sends it to review with every reason, sticky', () => {
  const { r, kid2 } = release(), map = R.mapOf(r);
  const recs = [LP.cleanRequest(JSON.parse(LP.text(reqFile('a1', { loop: LOOPT }))), reqFile('a1').id + '.json').record];
  const runs = [kid2(101, 'cleared'), kid2(102, 'needs-work')];
  let V = LP.view(r, 'each', { records: recs, runs });
  same([V.rollup.summary, V.rollup.ok], ['2 in scope · 1 cleared by validation · 1 needs work', false]);
  assert.throws(() => R.done(r, map, 'each', 'person-morgan', AT, {}), /approved when every item in scope has an accepted result/);
  runs[1] = kid2(102, 'cleared');
  V = LP.view(r, 'each', { records: recs, runs });
  same(V.rollup.ok, true);
  R.done(r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  same([r.steps.each.s, r.steps.each.loop.summary], ['done', '2 in scope · 2 cleared by validation']);
  const more = recs.concat([LP.cleanRequest(JSON.parse(LP.text(reqFile('a2', { observation: obs([101, 102, 112], { complete: false }), seen: [recs[0].id] }))), reqFile('a2').id + '.json').record]);
  V = LP.view(r, 'each', { records: more, runs });
  same(V.changes, ['ABC-112 was added after this approval.']);
  R.unsettleLoop(r, map, 'each', V.changes, 'person-morgan', AT);
  same(r.steps.each.s, 'recheck');
  V = LP.view(r, 'each', { records: recs, runs });
  same([V.approved, V.review, V.previous.length], [null, ['ABC-112 was added after this approval.'], 1], 'review stays, even if the item goes again; the earlier approval is kept');
  const back = R.sanitize(plain(r));
  same([back._unrunnable, back.steps.each.history.filter(h => h.loop).length], [undefined, 1]);
});

rule('Review round 1: a result recorded again since the approval is a change, even when it returns to the same value', () => {
  const { r, kid2 } = release(), map = R.mapOf(r);
  const recs = [LP.cleanRequest(JSON.parse(LP.text(reqFile('b1', { loop: LOOPT, observation: obs([101]) }))), reqFile('b1').id + '.json').record];
  const runs = [kid2(101, 'cleared')];
  let V = LP.view(r, 'each', { records: recs, runs });
  R.done(r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  const again = kid2(101, 'cleared');
  again.steps.verdict.at = '2026-11-07T10:00:00.000Z';
  V = LP.view(r, 'each', { records: recs, runs: [again] });
  same(V.changes, ['ABC-101\'s result was recorded again after this approval.']);
});
rule('Review round 1: a run on another version or for other inputs never clears its item', () => {
  const { r, kid2 } = release();
  const recs = [LP.cleanRequest(JSON.parse(LP.text(reqFile('b2', { loop: LOOPT, observation: obs([101]) }))), reqFile('b2').id + '.json').record];
  const wrongIssue = kid2(101, 'cleared'); wrongIssue.details.issue = 'ABC-999';
  let V = LP.view(r, 'each', { records: recs, runs: [wrongIssue] });
  same([V.rollup.ok, V.rollup.items[0].status], [false, 'unread']);
  has(V.rollup.blockers.map(b => b.text), /ABC-101's run was started with issue ABC-999, not ABC-101/);
  const wrongVersion = kid2(101, 'cleared'); wrongVersion.folder = 'v9-zzzzzzzz';
  V = LP.view(r, 'each', { records: recs, runs: [wrongVersion], procOf: () => null });
  same(V.rollup.ok, false);
});
rule('Review round 1: a keep and an accept made at once need review in either file order', () => {
  const base = [req('r1', [], { observation: obs([101]) }), req('r2', ['r1'], { observation: obs([]) })];
  const k = dec('d-a', ['r2'], 'r2', 'keep', ['jira:10101']), a = dec('d-b', ['r2'], 'r2', 'accept', ['jira:10101']);
  same(states(LP.reduce(base.concat([k, a]))), ['ABC-101:in!']);
  same(states(LP.reduce(base.concat([a, k]))), ['ABC-101:in!']);
});
rule('Review round 1: result counts hold any result name, constructor and __proto__ included', () => {
  const L = LP.reduce([req('r1', [], { observation: obs([101, 102]) })]);
  const R1 = RO(L, [ended(101, 'constructor'), ended(102, '__proto__')]);
  same([R1.counts.results.constructor, R1.counts.results.__proto__], [1, 1]);
  assert.ok(/1 constructor/.test(R1.summary) && /1 __proto__/.test(R1.summary), R1.summary);
});

rule('Review round 1: a scope record that can\'t be read holds the loop, and readPlans names it', async () => {
  const { r, kid2 } = release();
  const recs = [LP.cleanRequest(JSON.parse(LP.text(reqFile('b3', { loop: LOOPT, observation: obs([101]) }))), reqFile('b3').id + '.json').record];
  let V = LP.view(r, 'each', { records: recs, runs: [kid2(101, 'cleared')] });
  same(V.rollup.ok, true);
  V = LP.view(r, 'each', { records: recs, runs: [kid2(101, 'cleared')], unread: [{ file: 'req-x-' + 'a'.repeat(24) + '.json', why: 'isn\'t complete JSON', loop: null }] });
  same([V.rollup.ok, V.rollup.blockers[0].kind], [false, 'held']);
  const m = memFs({ ['proposals/req-x-' + 'b'.repeat(24) + '.json']: '{"format": "flightdeck-plan/3", "loop": ' });
  const got = await PF.repo.readPlans(m, null, null, false);
  same(got.scopesUnread.map(u => u.file), ['req-x-' + 'b'.repeat(24) + '.json']);
});

rule('Round 2: an approval the folder no longer matches holds the gate, read-only, before any save; nothing is written into the run', () => {
  const { r, kid2 } = release(), map = R.mapOf(r);
  const recs = [LP.cleanRequest(JSON.parse(LP.text(reqFile('c1', { loop: LOOPT, observation: obs([101]) }))), reqFile('c1').id + '.json').record];
  const runs = [kid2(101, 'cleared')];
  const V = LP.view(r, 'each', { records: recs, runs });
  R.done(r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  R.pass(r, map, 0, 'person-morgan', AT);
  LP.markStale([r].concat(runs), { records: recs });
  same(R.gateStatus(r, map, 0), 'passed');
  const before = JSON.stringify(r.steps);
  LP.markStale([r, kid2(101, 'needs-work')], { records: recs });
  same([R.gateStatus(r, map, 0), R.phaseOpen(r, map, 1)], ['review', false]);
  same(JSON.stringify(r.steps), before, 'the run itself is unchanged');
  same(r._loopStale.each, ['ABC-101 now returns needs-work (it was cleared).']);
  LP.markStale([r].concat(runs), { records: recs });
  same([R.gateStatus(r, map, 0), r._loopStale], ['passed', undefined]);
});

/* ---------- What a sync would do: the preview the assistant repeats ---------- */
rule('A sync projects its changes: adds, proposed removals with their open assessments, planned children, approval impact', () => {
  const { r, kid2 } = release();
  const first = LP.cleanRequest(JSON.parse(LP.text(reqFile('p1', { observation: obs([101, 102, 103, 104, 107]) }))), reqFile('p1').id + '.json').record;
  const open107 = kid2(107);
  const V = LP.view(r, 'each', { records: [first], runs: [open107] });
  const c = LP.cleanIntent(intentOf({ observation: obs([101, 102, 103, 108, 109, 110]) }), 'p2', { name: 'release-helper', version: '1.0' });
  const P2 = LP.project(r, V, c.intent, { who: (p) => ({ 'person-avery': 'Avery' })[p] || p });
  same([P2.added.map(x => x.key), P2.proposed.map(x => x.key)], [['ABC-108', 'ABC-109', 'ABC-110'], ['ABC-104', 'ABC-107']]);
  same(P2.children.map(k => [k.item.key, k.attempt, k.inputs.issue, k.inputs.fix_version]), [['ABC-108', 1, 'ABC-108', '4.1'], ['ABC-109', 1, 'ABC-109', '4.1'], ['ABC-110', 1, 'ABC-110', '4.1']]);
  const text = LP.previewText(P2, { title: 'Release readiness', dryRun: true });
  same(text.split('\n').slice(0, 7), ['Release readiness — preview only; no files written.', '', 'Would add 3 stories and request review of 2 removals.',
    'One proposed removal has an assessment in progress.', '3 new assessments are ready to start.', 'No runs would start.', '']);
  assert.ok(/Jira observation: 6 of 6 reported matches read; pagination complete\./.test(text), text);
  assert.ok(/ABC-107 · proposed removal: not in the complete search observed 2026-11-07T09:00:00.000Z · Avery is recording · 1 of 2 steps answered/.test(text), text);
});
rule('An incomplete source adds what it found and says what it couldn\'t propose; a missing input is named per story', () => {
  const { r } = release();
  const V = LP.view(r, 'each', { records: [], runs: [] });
  r.details.fix_version = '';
  const c = LP.cleanIntent(intentOf({ observation: obs([101, 102, 103], { reported: 5, fetched: 3, complete: false, errors: ['Page 2 failed'] }) }), 'p3', { name: 'release-helper', version: '1.0' });
  const P3 = LP.project(r, V, c.intent, {});
  same(P3.children[0].missing, ['fix_version']);
  const text = LP.previewText(P3, { title: 'Release readiness', dryRun: true });
  assert.ok(/Would add 3 stories\./.test(text) && /3 new assessments need fix_version\./.test(text), text);
  assert.ok(/Jira observation: 3 of 5 reported matches read; not complete \(the observation says it isn't complete\)\. Missing stories can't be proposed for removal\. Retry the search\./.test(text), text);
});

const CHECKER = path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py');
function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* try next */ } } return null; }
rule('check_folder.py --draft gives a loop the app\'s blockers word for word, and the same features', () => {
  const py = python(); if (!py) return;
  const L = (x) => ['  process: validate-story', '  items: jira.issue'].concat(x);
  const cases = [PARENT(), PARENT(L(['  pass: issue=item:key'])), PARENT(L(['  pass: issue=item:id', '  accepts: cleared, cleared'])),
    PARENT(['  process: validate-story', '  from: #nowhere', '  items: jira.issue', '  accepts: cleared', '  max: 0']),
    PARENT(['  process: validate-story', '  from: #ship1', '  items: github.pr', '  accepts: cleared', '  carry: fix_version', '  sets: fix_version=result']),
    PARENT(L(['  pass: x=^zzz_unknown_detail_name', '  accepts: cleared', '  version: 2'])), PARENT(['  process: release-readiness', '  items: jira.issue', '  accepts: cleared']),
    PARENT(['  process: validate-story', '  items: item', '  source: deploy-targets', '  noun: environment / environments', '  pass: issue=item:key', '  accepts: cleared']),
    PARENT(['  process: validate-story', '  items: item', '  from: #release-scope', '  source: Deploy Targets!', '  noun: environments', '  pass: issue=item:key', '  accepts: cleared']),
    PARENT(['  process: validate-story', '  items: jira.issue', '  from: #release-scope', '  source: x', '  noun: a/b/c', '  pass: issue=item:key', '  accepts: cleared']),
    PARENT(['  process: validate-story', '  items: item', '  noun: \' / ok', '  pass: issue=item:key', '  accepts: cleared'])];
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

rule('Review round 2 (2): clearing a run detail the loop passes on disqualifies its children; the approval and the gate are held', () => {
  const { r, kid2 } = release(), map = R.mapOf(r);
  const recs = [LP.cleanRequest(JSON.parse(LP.text(reqFile('d1', { loop: LOOPT, observation: obs([101]) }))), reqFile('d1').id + '.json').record];
  const runs = [kid2(101, 'cleared')];
  const V = LP.view(r, 'each', { records: recs, runs });
  R.done(r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  R.pass(r, map, 0, 'person-morgan', AT);
  r.details.fix_version = '';
  const V2 = LP.view(r, 'each', { records: recs, runs });
  same(V2.rollup.ok, false, 'a child started with fix_version 4.1 no longer counts once the run has none');
  assert.ok(/fix_version/.test(V2.rollup.blockers.map(b => b.text).join(' ')), V2.rollup.blockers.map(b => b.text).join(' '));
  LP.markStale([r].concat(runs), { records: recs });
  same(R.gateStatus(r, map, 0), 'review');
});

rule('Review round 3 (1): an approval whose only scope record is unreadable, or gone, is held even with nothing readable left', () => {
  const { r, kid2 } = release(), map = R.mapOf(r);
  const recs = [LP.cleanRequest(JSON.parse(LP.text(reqFile('e1', { loop: LOOPT, observation: obs([101]) }))), reqFile('e1').id + '.json').record];
  const runs = [kid2(101, 'cleared')];
  const V = LP.view(r, 'each', { records: recs, runs });
  R.done(r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  R.pass(r, map, 0, 'person-morgan', AT);
  LP.markStale([r].concat(runs), { records: [], unread: [{ file: reqFile('e1').id + '.json', why: 'cut short', loop: null }] });
  same(R.gateStatus(r, map, 0), 'review', 'unreadable');
  LP.markStale([r].concat(runs), { records: [] });
  same(R.gateStatus(r, map, 0), 'review', 'gone');
  assert.ok(/is gone/.test(r._loopStale.each.join(' ')), r._loopStale.each.join(' '));
  LP.markStale([r].concat(runs), { records: recs });
  same(R.gateStatus(r, map, 0), 'passed');
});

rule('Review round 4 (4): two runs for one attempt compete until a choose record names the one that counts; only a competing run can be chosen', () => {
  const { r, kid2 } = release();
  const a = kid2(101, 'cleared'), b = kid2(101, 'needs-work'); b.id = 'k101b';
  const recs = [LP.cleanRequest(JSON.parse(LP.text(reqFile('f1', { loop: LOOPT, observation: obs([101]) }))), reqFile('f1').id + '.json').record];
  let V = LP.view(r, 'each', { records: recs, runs: [a, b] });
  same([V.rollup.items[0].status, V.rollup.items[0].candidates.slice().sort()], ['competing', ['k101', 'k101b']]);
  same(LP.choiceWhy(V, 'ABC-101', 'k101'), '');
  assert.ok(/isn't one of/.test(LP.choiceWhy(V, 'ABC-101', 'k999')));
  const c = LP.cleanIntent(LP.changeOf(V, 'choose', ['ABC-101'], { run: 'k101' }), 'f2', { name: 'release-helper', version: '1.0' });
  same(c.errors, []);
  const f2 = LP.buildRequest(c.intent, { seen: V.ledger.heads, children: [], now: AT, app: '3.0.0' });
  const recs2 = recs.concat([LP.cleanRequest(JSON.parse(LP.text(f2)), f2.id + '.json').record]);
  V = LP.view(r, 'each', { records: recs2, runs: [a, b] });
  same([V.rollup.items[0].status, V.rollup.items[0].run, V.rollup.ok], ['cleared', 'k101', true]);
  assert.ok(/isn't competing/.test(LP.choiceWhy(V, 'ABC-101', 'k101b')));
});

const chooseRec = (V, key, run, seen, tag) => {
  const c = LP.cleanIntent(LP.changeOf(V, 'choose', ['ABC-101'], { run }), key, { name: 'helper-' + tag, version: '1.0' });
  same(c.errors, []);
  const f = LP.buildRequest(c.intent, { seen, children: [], now: AT, app: '3.0.0' });
  return LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record;
};
rule('Review round 5 (1): two choices made at once that disagree hold the story, whatever their names, until a choice that saw both', () => {
  const { r, kid2 } = release();
  const a = kid2(101, 'cleared'), b = kid2(101, 'needs-work'); b.id = 'k101b';
  const base = LP.cleanRequest(JSON.parse(LP.text(reqFile('g1', { loop: LOOPT, observation: obs([101]) }))), reqFile('g1').id + '.json').record;
  const V0 = LP.view(r, 'each', { records: [base], runs: [a, b] });
  for (const [ta, tb] of [['aa', 'zz'], ['zz', 'aa']]) {
    const x = chooseRec(V0, 'c1', 'k101', [base.id], ta), y = chooseRec(V0, 'c2', 'k101b', [base.id], tb);
    const V = LP.view(r, 'each', { records: [base, x, y], runs: [a, b] });
    same([V.rollup.items[0].status, V.rollup.ok], ['competing', false], ta + tb);
    assert.ok(/at once/.test(V.rollup.blockers.map(q => q.text).join(' ')), V.rollup.blockers.map(q => q.text).join(' '));
    const z = chooseRec(V, 'c3', 'k101', [base.id, x.id, y.id], 'mm');
    const W = LP.view(r, 'each', { records: [base, x, y, z], runs: [a, b] });
    same([W.rollup.items[0].status, W.rollup.items[0].run], ['cleared', 'k101'], 'resolved by a choice that saw both');
  }
});
rule('Review round 5 (2): a choice is for the runs it saw; another run for that attempt makes the story compete again and shows as a change', () => {
  const { r, kid2 } = release(), map = R.mapOf(r);
  const a = kid2(101, 'cleared'), b = kid2(101, 'needs-work'); b.id = 'k101b';
  const base = LP.cleanRequest(JSON.parse(LP.text(reqFile('h1', { loop: LOOPT, observation: obs([101]) }))), reqFile('h1').id + '.json').record;
  const V0 = LP.view(r, 'each', { records: [base], runs: [a, b] });
  const x = chooseRec(V0, 'h2', 'k101', [base.id], 'aa');
  const V = LP.view(r, 'each', { records: [base, x], runs: [a, b] });
  same(V.rollup.ok, true);
  R.done(r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  const c3 = kid2(101, 'cleared'); c3.id = 'k101c';
  const W = LP.view(r, 'each', { records: [base, x], runs: [a, b, c3] });
  same([W.rollup.items[0].status, W.rollup.ok], ['competing', false]);
  assert.ok(W.changes.length > 0, 'shown as a change since the approval');
});
rule('Review round 5 (4, 5): a request naming more than one person is refused; starts are offered only where the loop\'s phase is open', () => {
  const { r, kid2 } = release();
  const base = LP.cleanRequest(JSON.parse(LP.text(reqFile('i1', { loop: LOOPT, observation: obs([101, 102]) }))), reqFile('i1').id + '.json').record;
  const V = LP.view(r, 'each', { records: [base], runs: [] });
  const q = { ops: ['start', 'start'], items: ['ABC-101', 'ABC-102'], actors: ['person-morgan', 'person-outsider'], as: 'person-morgan', reason: '' };
  assert.ok(/more than one person/.test(LP.requestCheck(r, V, q, [{ id: 'person-morgan', name: 'Morgan' }])));
  same(LP.startable(r, V).start.length, 2, 'the loop\'s phase is open here');
  const shut = JSON.parse(JSON.stringify(r)); shut.paused = { by: 'person-morgan', at: AT };
  const S = LP.startable(R.sanitize(shut), V);
  same(S.start.length, 0);
  assert.ok(/paused/.test(S.skip.map(k => k.why).join(' ')), S.skip.map(k => k.why).join(' '));
  assert.ok(kid2);
});

/* Round 6 sweep: every decision folded from proposals/ settles causally; two made at once that disagree hold, whatever their names. */
const base6 = () => req('b0', [], { observation: obs([101]) });
const ch6 = (op, extra) => Object.assign({ op, item: { id: '10101', key: 'ABC-101' } }, extra || {});
rule('Review round 6 (1): an exception renewed and withdrawn at once holds the story for review, whatever the record names', () => {
  for (const [ra, rb] of [['e-aa', 'e-zz'], ['e-zz', 'e-aa']]) {
    const recs = [base6(), req('e-1', ['b0'], { changes: [ch6('exception', { reason: 'Covered by Release 4.0', approver: 'person-morgan' })] }),
      req(ra, ['e-1'], { changes: [ch6('withdraw')] }), req(rb, ['e-1'], { changes: [ch6('exception', { reason: 'Still covered', approver: 'person-morgan' })] })];
    const L = LP.reduce(recs), R0 = RO(L, []);
    same([L.items[0].exception, R0.items[0].status === 'exception'], [null, false], ra + ' first');
    assert.ok(/without a run/.test(R0.blockers.map(b => b.text).join(' ')) && /at once/.test(R0.blockers.map(b => b.text).join(' ')), R0.blockers.map(b => b.text).join(' '));
    const L2 = LP.reduce(recs.concat([req('e-3', [ra, rb], { changes: [ch6('exception', { reason: 'Decided', approver: 'person-morgan' })] })]));
    same([L2.items[0].exception && L2.items[0].exception.record, RO(L2, []).items[0].status], ['e-3', 'exception'], 'settled by one that saw both');
  }
});
rule('Review round 6 sweep: two owners assigned at once leave the story unowned until one that saw both; two plans at once with different inputs plan nothing', () => {
  for (const [ra, rb] of [['o-aa', 'o-zz'], ['o-zz', 'o-aa']]) {
    const recs = [base6(), req(ra, ['b0'], { changes: [ch6('owner', { owner: 'person-avery' })] }), req(rb, ['b0'], { changes: [ch6('owner', { owner: 'person-morgan' })] })];
    const L = LP.reduce(recs);
    same(L.items[0].owner, '', ra + ' first');
    assert.ok(/at once/.test(RO(L, []).items[0].ownerWhy || ''), 'the row says why');
    same(LP.reduce(recs.concat([req('o-3', [ra, rb], { changes: [ch6('owner', { owner: 'person-morgan' })] })])).items[0].owner, 'person-morgan');
  }
  for (const [ra, rb] of [['p-aa', 'p-zz'], ['p-zz', 'p-aa']]) {
    const plan = (v) => [{ item: { id: '10101', key: 'ABC-101' }, attempt: 1, inputs: { story: v }, owner: '' }];
    const L = LP.reduce([base6(), req(ra, ['b0'], { children: plan('ABC-101') }), req(rb, ['b0'], { children: plan('ABC-101 again') })]);
    same(L.items[0].planned, null, ra + ' first');
  }
});
rule('Review round 6 (2): a request held for a record this computer can\'t read is held, not pending; outcomes recorded two ways at once are not pending either', () => {
  const ask = (id, seen) => req(id, seen, { changes: [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-avery' }] });
  const recs = [base6(), ask('q-held', ['b0', 'gone-1'])];
  same(LP.actionsOf({ records: recs, ledger: LP.reduce(recs) }).map(q => q.status), ['held']);
  for (const [da, db] of [['d-aa', 'd-zz'], ['d-zz', 'd-aa']]) {
    const r2 = [base6(), ask('q-1', ['b0']), dec(da, ['q-1'], 'q-1', 'applied', []), dec(db, ['q-1'], 'q-1', 'refused', [])];
    const Q = LP.actionsOf({ records: r2, ledger: LP.reduce(r2) });
    same(Q.map(q => q.status), ['review'], da + ' first');
  }
});

const plan7 = (v, owner) => [{ item: { id: '10101', key: 'ABC-101' }, attempt: 1, inputs: { story: v }, owner: owner || '' }];
rule('Review round 7 (3): a plan\'s suggested owner never settles an owner conflict or replaces an owner someone chose', () => {
  const recs = [base6(), req('o-a', ['b0'], { changes: [ch6('owner', { owner: 'person-avery' })] }), req('o-b', ['b0'], { changes: [ch6('owner', { owner: 'person-morgan' })] }),
    req('p-1', ['o-a', 'o-b'], { children: plan7('ABC-101', 'person-blake') })];
  same(LP.reduce(recs).items[0].owner, '', 'still unassigned: the conflict stands');
  const chosen = [base6(), req('o-c', ['b0'], { changes: [ch6('owner', { owner: 'person-avery' })] }), req('p-2', ['o-c'], { children: plan7('ABC-101', 'person-blake') })];
  same(LP.reduce(chosen).items[0].owner, 'person-avery', 'an owner someone chose stands');
  same(LP.reduce([base6(), req('p-3', ['b0'], { children: plan7('ABC-101', 'person-blake') })]).items[0].owner, 'person-blake', 'with no owner decision, the plan suggests one');
});
rule('Review round 7 (4): two plans in conflict are settled by a third that saw both, or by choosing one of them; the row lists both', () => {
  const two = [base6(), req('p-a', ['b0'], { children: plan7('ABC-101') }), req('p-b', ['b0'], { children: plan7('ABC-101 again') })];
  const row = RO(LP.reduce(two), []).items[0];
  same(row.planConflict && row.planConflict.options.map(o => o.record).sort(), ['p-a', 'p-b']);
  const third = LP.reduce(two.concat([req('p-c', ['p-a', 'p-b'], { children: plan7('ABC-101 decided') })]));
  same(third.items[0].planned && third.items[0].planned.inputs, { story: 'ABC-101 decided' }, 'a third plan that saw both settles it');
  const pick = LP.reduce(two.concat([req('p-d', ['p-a', 'p-b'], { changes: [ch6('plan', { attempt: 1, record: 'p-b' })] })]));
  same(pick.items[0].planned && pick.items[0].planned.inputs, { story: 'ABC-101 again' }, 'choosing one of them settles it');
  same(RO(pick, []).items[0].planConflict, null);
});
rule('Review round 7 (5): an outcome recorded both ways is resolved by the effect it left: a resolve request names the request and what happened', () => {
  const c = LP.cleanIntent({ loop: LOOPT, changes: [{ op: 'resolve', record: 'req-release-helper-0123456789abcdef01234567', outcome: 'applied', as: 'person-morgan' }] }, 'rs', { name: 'release-helper', version: '1.0' });
  same(c.errors, []);
  const rq = req('q-r', ['b0'], { changes: c.intent.changes }), Q = LP.actionsOf({ records: [base6(), rq], ledger: LP.reduce([base6(), rq]) })[0];
  same([Q.ops[0], Q.record, Q.outcome, Q.status], ['resolve', 'req-release-helper-0123456789abcdef01234567', 'applied', 'pending']);
  const { r } = release();
  const target = { id: 'req-x', ops: ['approve'], items: [], status: 'review' };
  assert.ok(/no approval|wasn't carried out|nothing/i.test(LP.resolveWhy(r, 'each', target, 'applied', [])), 'applied, but no effect: refused');
  same(LP.resolveWhy(r, 'each', target, 'refused', []), '', 'refused, and no effect: it may be recorded');
  const start = { id: 'req-y', ops: ['start'], items: ['ABC-101'], status: 'review' }, kidY = { parent: { process: r.process, id: r.id, step: 'each', item: { key: 'ABC-101', request: 'req-y' } } };
  same(LP.resolveWhy(r, 'each', start, 'applied', [kidY]), '');
  assert.ok(LP.resolveWhy(r, 'each', start, 'refused', [kidY]).length > 0, 'refused, but a run it started exists: refused');
  assert.ok(LP.resolveWhy(r, 'each', Object.assign({}, start, { status: 'applied' }), 'applied', [kidY]).length > 0, 'only an outcome recorded both ways is resolved');
});

/* S1, fail closed: no loop record in an unresolved conflict lets the roll-up say ok, whatever the record names, on a removed
   row too; settling needs a record that saw every participant still outstanding. One case per kind of record. */
const b8 = () => req('s0', [], { observation: obs([101, 102]) });
const runs8 = () => [ended(101, 'cleared'), ended(102, 'cleared')];
const on102 = (op, extra) => Object.assign({ op, item: { id: '10102', key: 'ABC-102' } }, extra || {});
const perms = (a) => a.length < 2 ? [a] : [].concat(...a.map((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).map(p => [x].concat(p))));
rule('S1 (scope): three decisions at once, and one that saw only some of them, hold approval until one saw every participant', () => {
  same(RO(LP.reduce([b8()]), runs8()).ok, true, 'baseline');
  for (const [na, nb, nc] of perms(['s-a', 's-m', 's-z'])) {
    const recs = [b8(), req(na, ['s0'], { changes: [on102('exclude', { reason: 'Moved' })] }), req(nb, ['s0'], { changes: [on102('restore')] }), req(nc, ['s0'], { changes: [on102('exclude', { reason: 'Moved' })] }),
      req('s-d', [nb, nc], { changes: [on102('exclude', { reason: 'Moved' })] })];
    same(RO(LP.reduce(recs), runs8()).ok, false, [na, nb, nc].join(' '));
    const all = LP.reduce(recs.concat([req('s-e', ['s-d', na], { changes: [on102('exclude', { reason: 'Moved' })] })]));
    same([RO(all, runs8()).ok, all.items[1].state], [true, 'removed'], 'settled by one that saw every participant');
  }
});
rule('S1 (every kind): an exception, owner, plan, choice or request outcome in conflict holds approval, on a removed row too', () => {
  const gone = req('s-x', ['s0'], { changes: [on102('exclude', { reason: 'Moved' })] });
  const plan = (v, o) => [{ item: { id: '10102', key: 'ABC-102' }, attempt: 1, inputs: { story: v }, owner: o || '' }];
  const ask = req('s-q', ['s0'], { changes: [{ op: 'start', item: { key: 'ABC-102' }, as: 'person-avery' }] });
  const cases = {
    exception: [req('s-e1', ['s-x'], { changes: [on102('exception', { reason: 'Docs', approver: 'person-morgan' })] }), req('s-e2', ['s-x'], { changes: [on102('withdraw')] })],
    owner: [req('s-o1', ['s-x'], { changes: [on102('owner', { owner: 'person-avery' })] }), req('s-o2', ['s-x'], { changes: [on102('owner', { owner: 'person-morgan' })] })],
    plan: [req('s-p1', ['s-x'], { children: plan('a') }), req('s-p2', ['s-x'], { children: plan('b') })],
    choice: [req('s-c1', ['s-x'], { changes: [on102('choose', { run: 'c102', attempt: 1, candidates: ['c102', 'c102b'] })] }), req('s-c2', ['s-x'], { changes: [on102('choose', { run: 'c102b', attempt: 1, candidates: ['c102', 'c102b'] })] })],
    outcome: [ask, dec('s-d1', ['s-q'], 's-q', 'applied', []), dec('s-d2', ['s-q'], 's-q', 'refused', [])]
  };
  for (const k of Object.keys(cases)) {
    for (const removed of [false, true]) {
      const recs = [b8()].concat(removed ? [gone] : []).concat(cases[k].map(r => Object.assign({}, r, { seen: r.seen.map(x => (x === 's-x' && !removed) ? 's0' : x) })));
      const R0 = RO(LP.reduce(recs), runs8());
      same(R0.ok, false, k + (removed ? ' on a removed row' : ''));
      assert.ok(R0.blockers.some(b => /at once|both ways/.test(b.text)), k + ': ' + R0.blockers.map(b => b.text).join(' | '));
    }
  }
});
rule('Review round 8 (4): the suggested owner comes only from the settled plan, whatever the record names', () => {
  const plan = (o) => [{ item: { id: '10102', key: 'ABC-102' }, attempt: 1, inputs: { story: o }, owner: o }];
  for (const [na, nb] of [['p-a', 'p-z'], ['p-z', 'p-a']]) {
    const two = [b8(), req(na, ['s0'], { children: plan('person-avery') }), req(nb, ['s0'], { children: plan('person-morgan') })];
    same(LP.reduce(two).items[1].owner, '', na + ' first: no owner while the plans conflict');
    const pick = LP.reduce(two.concat([req('p-k', [na, nb], { changes: [on102('plan', { attempt: 1, record: nb })] })]));
    same(pick.items[1].owner, nb === 'p-z' ? 'person-morgan' : 'person-morgan', 'the chosen plan\'s owner');
  }
});

rule('Review round 8 (5): the outcome a resolution writes names the resolution, so the resolution is recognized by its effect', () => {
  const d = LP.buildDecision({ proposal: 'req-release-helper-0123456789abcdef01234567', loop: LOOPT, op: 'refused', items: [], seen: ['req-release-helper-0123456789abcdef01234567'], reason: 'r', by: 'person-morgan', writer: 'wa', rev: '0000000a', now: AT, app: '3.0.0', resolver: 'req-release-helper-fedcba9876543210fedcba98' });
  same(d.file.resolver, 'req-release-helper-fedcba9876543210fedcba98');
  const rec = LP.cleanDecision(JSON.parse(JSON.stringify(d.file)), d.name).record;
  same(rec.resolver, 'req-release-helper-fedcba9876543210fedcba98');
  same(LP.resolvedBy({ records: [rec] }, 'req-release-helper-fedcba9876543210fedcba98'), rec.id);
  const { r } = release(), rs = { id: 'req-release-helper-fedcba9876543210fedcba98', ops: ['resolve'], items: [], status: 'review' };
  same(LP.resolveWhy(r, 'each', rs, 'applied', [], [rec]), '', 'a resolution recorded both ways: applied, since its effect is here');
  assert.ok(LP.resolveWhy(r, 'each', rs, 'refused', [], [rec]).length > 0);
});

/* Slice 3b: loops for any list (items: item). */
const IOPT = { source: 'item', kind: 'item', feed: 'deploy-targets' };
const env = (k, t, link) => Object.assign({ key: k }, t ? { title: t } : {}, link ? { link } : {});
const iobs = (keys, o) => Object.assign({ source: { feed: 'deploy-targets' }, generation: 'g1', query: '', observedAt: '2026-11-08T09:00:00Z', items: keys.map(k => env(k)), reported: keys.length, fetched: keys.length, complete: true, errors: [] }, o || {});
const ireq = (id, seen, o) => req(id, seen, Object.assign({ kind: 'item' }, o || {}));
const iclean = (o, kind) => { const e = []; const out = LP.cleanObservation(o, e, kind || 'item'); return { out, e }; };
rule('3b: a generic list kept by hand: keys as written, case-sensitive, titles optional, links http(s) only', () => {
  const L = LP.reduce([ireq('i1', [], { changes: [{ op: 'add', item: env('staging', 'Staging', 'https://staging.example.com/') }, { op: 'add', item: env('Prod') }, { op: 'add', item: env('prod') }] })], IOPT);
  same(L.items.map(x => [x.uid, x.key, x.title]), [['item:key:staging', 'staging', 'Staging'], ['item:key:Prod', 'Prod', ''], ['item:key:prod', 'prod', '']]);
  same(L.items[0].link, 'https://staging.example.com/');
  const bad = (it) => { const e = []; LP.cleanItem(it, e, 'Item 1', 'item'); return e.length > 0; };
  for (const k of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', '-lead', 'a'.repeat(41), 'with space', 'ABC/1', '']) assert.ok(bad(env(k)), 'key refused: ' + k);
  assert.ok(!bad(env('a'.repeat(40))), '40 characters are fine, never cut');
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.c', 'ftp://x.example.com', '/relative', 'https://exa mple.com', 'https://example.com/\u0007', 'http://', 'https://' + 'a'.repeat(2050)]) assert.ok(bad(env('k', '', u)), 'link refused: ' + u);
  assert.ok(!bad(env('k', '', 'http://example.com/a?b=c#d')));
  assert.ok(bad({ key: 'k', id: '10042' }), 'a generic item has no id');
  const e = []; LP.cleanChanges([{ op: 'add', item: env('dup') }, { op: 'add', item: env('dup') }], e, 'item'); has(e, /dup again/);
  const L2 = LP.reduce([ireq('i1', [], { changes: [{ op: 'add', item: env('qa') }] }), ireq('i2', ['i1'], { observation: iclean(iobs(['qa'])).out }), ireq('i3', ['i2'], { observation: iclean(iobs([])).out })], IOPT);
  same(L2.items.map(x => x.key + ':' + x.state), ['qa:in'], 'added by hand, then listed by the feed: still never proposed');
});
rule('3b: a tool feeds a generic list: complete observations propose removing only what that feed enrolled; incomplete ones only add', () => {
  const one = iclean(iobs(['staging', 'prod'])); same(one.e, []); same(one.out.complete, true);
  const L = LP.reduce([ireq('f1', [], { observation: one.out }), ireq('f2', ['f1'], { changes: [{ op: 'add', item: env('qa') }] }),
    ireq('f3', ['f2'], { observation: iclean(iobs(['staging'])).out })], IOPT);
  same(L.items.map(x => x.key + ':' + x.state), ['prod:proposed', 'staging:in', 'qa:in'], 'qa was added by hand: never proposed');
  const inc = LP.reduce([ireq('f1', [], { observation: one.out }), ireq('f3', ['f1'], { observation: iclean(iobs(['staging', 'dev'], { complete: false })).out })], IOPT);
  same(inc.items.map(x => x.key + ':' + x.state), ['prod:in', 'staging:in', 'dev:in'], 'incomplete: adds, proposes nothing');
});
rule('3b: an observation from another feed, or another scope of this feed, is refused before it is reduced', () => {
  const other = iclean(iobs(['staging'], { source: { feed: 'other-feed' } })).out;
  const L = LP.reduce([ireq('f1', [], { observation: iclean(iobs(['staging', 'prod'])).out }), ireq('f2', ['f1'], { observation: other })], IOPT);
  same(L.items.map(x => x.key + ':' + x.state), ['prod:in', 'staging:in'], 'another feed proposes nothing');
  assert.ok(L.duplicates.some(d => d.record === 'f2' && /feed/.test(d.why)), JSON.stringify(L.duplicates));
  const s1 = iclean(iobs(['staging', 'prod'], { source: { feed: 'deploy-targets', account: 'team-a' } })).out, s2 = iclean(iobs(['staging'], { source: { feed: 'deploy-targets', account: 'team-b' } })).out;
  const M2 = LP.reduce([ireq('f1', [], { observation: s1 }), ireq('f2', ['f1'], { observation: s2 })], IOPT);
  same(M2.items.map(x => x.key + ':' + x.state), ['prod:in', 'staging:in'], 'another scope proposes nothing');
  assert.ok(M2.duplicates.some(d => d.record === 'f2' && /scope/.test(d.why)), JSON.stringify(M2.duplicates));
  same(LP.feedWhy(s2, { items: 'item', source: 'deploy-targets' }, M2.observation), M2.duplicates.filter(d => d.record === 'f2')[0].why);
  assert.ok(LP.feedWhy(iobs(['x']), { items: 'item' }, null).length > 0, 'a loop with no source: takes no feed');
});
rule('3b: complete means every reported item was read and listed: items, fetched and reported agree, with no errors', () => {
  for (const [o, ok] of [[{}, true], [{ fetched: 3 }, false], [{ reported: 1 }, false], [{ reported: 3, fetched: 3 }, false], [{ errors: ['page 2 failed'] }, false], [{ complete: false }, false]]) {
    same(iclean(iobs(['staging', 'prod'], o)).out.complete, ok, JSON.stringify(o));
  }
  const j = []; same(LP.cleanObservation(Object.assign(obs([101, 102]), { fetched: 3 }), j).complete, false, 'Jira too: fetched more than reported is not complete');
  const dup = iclean(iobs(['staging', 'staging'])); assert.ok(dup.e.some(x => /twice/.test(x)), dup.e.join(' '));
});
rule('3b: nouns: noun: one / many, one formatter, no guessed plurals; item / items by default, story / stories for Jira', () => {
  const N = LP.nounOf({ noun: 'environment / environments', items: 'item' });
  same([LP.count(1, N), LP.count(3, N), LP.count(0, N)], ['1 environment', '3 environments', '0 environments']);
  same([LP.nounOf({ items: 'item' }).many, LP.nounOf({ items: 'jira.issue' }).many], ['items', 'stories']);
  for (const v of ['environments', 'a / ', ' / b', 'a/b/c', 'x'.repeat(41) + ' / y', '<b> / <b>s']) assert.strictEqual(LP.nounOf({ noun: v, items: 'item' }), null, v);
});
rule('Round 9 (1): a conflict that arrives after approval (owner, plan or a request outcome) holds the approval that is already effective', () => {
  const on = (op, x) => Object.assign({ op, item: { id: '10101', key: 'ABC-101' } }, x || {});
  const qid = 'req-release-helper-' + PF.sha256.hex('st').slice(0, 24);
  const probes = {
    owner: [req('o1', ['d1'], { changes: [on('owner', { owner: 'person-avery' })] }), req('o2', ['d1'], { changes: [on('owner', { owner: 'person-morgan' })] })],
    plan: [req('p1', ['d1'], { children: [{ item: { id: '10101', key: 'ABC-101' }, attempt: 2, inputs: { issue: 'a' }, owner: '' }] }), req('p2', ['d1'], { children: [{ item: { id: '10101', key: 'ABC-101' }, attempt: 2, inputs: { issue: 'b' }, owner: '' }] })],
    outcome: [req(qid, ['d1'], { changes: [{ op: 'start', item: { key: 'ABC-101' }, as: 'person-morgan' }] }),
      { id: qid + '.status-wa-00000001', type: 'decision', proposal: qid, op: 'applied', items: [], seen: [qid], by: { person: 'person-morgan' }, reason: '' },
      { id: qid + '.status-wb-00000002', type: 'decision', proposal: qid, op: 'refused', items: [], seen: [qid], by: { person: 'person-avery' }, reason: '' }]
  };
  Object.keys(probes).forEach((k) => {
    const { r, kid2 } = release(), map = R.mapOf(r), loop = (x) => Object.assign(x, { loop: LOOPT });
    const recs = [LP.cleanRequest(JSON.parse(LP.text(reqFile('d1', { loop: LOOPT, observation: obs([101]) }))), reqFile('d1').id + '.json').record];
    recs[0].id = 'd1';
    const runs = [kid2(101, 'cleared')];
    const V = LP.view(r, 'each', { records: recs, runs });
    same(V.rollup.ok, true, k + ': set-up');
    R.done(r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
    R.pass(r, map, 0, 'person-morgan', AT);
    const all = recs.concat(probes[k].map(loop)), V2 = LP.view(r, 'each', { records: all, runs });
    same(V2.rollup.ok, false, k + ': the conflict holds the roll-up');
    assert.ok(V2.changes.length > 0, k + ': and it is a reason the approval no longer stands');
    LP.markStale([r].concat(runs), { records: all });
    same(R.gateStatus(r, map, 0), 'review', k + ': its gate is held, as in flightdeck run and next');
  });
});
rule('Round 9 (6), round 10: a request names at most 50 heads, a page of a wider frontier, and reads back; writer and reader share one frontier limit, and every writer checks its file before filing', () => {
  const base = req('s0', [], { observation: obs([101, 102]) });
  const heads = Array.from({ length: 51 }, (_, i) => 'req-release-helper-' + PF.sha256.hex('h' + i).slice(0, 24));
  const L = LP.reduce([base].concat(heads.map((id, i) => req(id, ['s0'], { changes: [on102('owner', { owner: i % 2 ? 'person-morgan' : 'person-avery' })] }))));
  same(L.heads.length, 51);
  /* Round 10: writers and readers share one limit of 50 (LIMITS.seen); a wider frontier is named a page at a time (seenFor). */
  same(LP.LIMITS.seen, 50, 'the one limit');
  const page = LP.seenFor(L, ['jira:10102']);
  same([page.seen.length, page.left], [50, 1], 'a page of 50, one left');
  const f = reqFile('resolve-51', { loop: LOOPT, changes: [on102('owner', { owner: 'person-avery' })], seen: page.seen });
  const back = LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json');
  assert.ok(back.ok, back.why);
  same(back.record.seen.length, 50, 'the page reads back whole');
  same(LP.fileWhy(f.id + '.json', f), '', 'a file the reader takes passes');
  const tooMany = Object.assign({}, f, { seen: Array.from({ length: LP.LIMITS.seen + 1 }, (_, i) => 'req-release-helper-' + PF.sha256.hex('x' + i).slice(0, 24)).sort() });
  assert.ok(/seen/.test(LP.fileWhy(f.id + '.json', tooMany)), 'one it would refuse is refused before filing');
  const d = LP.buildDecision({ proposal: f.id, loop: LOOPT, op: 'keep', items: ['jira:10102'], seen: tooMany.seen, by: 'person-avery', writer: 'w1', rev: 'abcdef01', now: AT, app: '3.0.0' });
  assert.ok(/seen/.test(LP.fileWhy(d.name, d.file)), 'decisions share the limit');
  /* Every place that builds a scope record checks it with fileWhy before it is written. */
  const fs0 = require('fs'), path0 = require('path');
  for (const rel of ['src/ui/app.js', 'bin/flightdeck.js']) {
    const lines = fs0.readFileSync(path0.join(__dirname, '..', rel), 'utf8').split('\n');
    lines.forEach((ln, i) => { if (/\bbuild(Request|Decision)\(/.test(ln) && !/function build/.test(ln)) assert.ok(lines.slice(i, i + 4).some(x => /fileWhy\(/.test(x)), rel + ':' + (i + 1) + ' files a scope record without fileWhy'); });
  }
});
rule('Round 9 (7): every conflicting plan is an option, however many and whatever their names; the picker and loop plan accept each', () => {
  const plans = (names) => [b8()].concat(names.map((n, i) => req(n, ['s0'], { children: [{ item: { id: '10102', key: 'ABC-102' }, attempt: 1, inputs: { issue: 'v' + i }, owner: '' }] })));
  const names = Array.from({ length: 21 }, (_, i) => 'p' + String(i).padStart(2, '0'));
  const opts = (recs) => { const R0 = RO(LP.reduce(recs), runs8()), row = R0.items.filter(i => i.key === 'ABC-102')[0]; return { R0, row }; };
  const { R0, row } = opts(plans(names));
  same(row.planConflict.options.length, 21, 'all 21 plans');
  names.forEach(n => same(LP.planWhy({ rollup: R0 }, 'ABC-102', n), '', n));
  const renamed = names.map(n => 'z' + n).reverse(), o2 = opts(plans(renamed)).row.planConflict.options.map(o => o.record).sort();
  same(o2, renamed.slice().sort(), 'names change nothing about which are offered');
  const run = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'views', 'run.js'), 'utf8');
  assert.ok(!/planConflict\.options\.slice\(/.test(run), 'the picker lists every option');
});
rule('Round 10 (4): two people keeping different plans at once, each having seen both, leave both original plans to choose from', () => {
  const kid = (inputs) => [{ item: { id: '10102', key: 'ABC-102' }, attempt: 1, inputs, owner: '' }];
  const pick = (record) => [{ op: 'plan', item: { id: '10102', key: 'ABC-102' }, attempt: 1, record }];
  const recs = [b8(), req('p1', ['s0'], { children: kid({ issue: 'a' }) }), req('p2', ['s0'], { children: kid({ issue: 'b' }) }),
    req('c1', ['s0', 'p1', 'p2'], { changes: pick('p1') }), req('c2', ['s0', 'p1', 'p2'], { changes: pick('p2') })];
  const R0 = RO(LP.reduce(recs), runs8()), row = R0.items.filter(i => i.key === 'ABC-102')[0];
  assert.ok(row.planConflict, 'the two choices conflict');
  same(row.planConflict.options.map(o => o.record + '=' + o.inputs.issue), ['p1=a', 'p2=b'], 'the real plans, not the choice records');
  same(LP.planWhy({ rollup: R0 }, 'ABC-102', 'p1'), '', 'loop plan takes p1');
  same(LP.planWhy({ rollup: R0 }, 'ABC-102', 'p2'), '', 'and p2');
  const R1 = RO(LP.reduce(recs.concat([req('c3', ['c1', 'c2'], { changes: pick('p2') })])), runs8());
  same(R1.items.filter(i => i.key === 'ABC-102')[0].planConflict, null, 'a choice that saw both choices settles it');
});
rule('Round 10 (6): a conflict wider than one record can name settles in pages: each correction settles what it saw, and approval waits for the last page', () => {
  const N = LP.LIMITS.seen + 1, ids = Array.from({ length: N }, (_, i) => 'req-release-helper-' + PF.sha256.hex('pg' + i).slice(0, 24));
  const recs = [b8()].concat(ids.map((id, i) => req(id, ['s0'], { changes: [on102('owner', { owner: i % 2 ? 'person-morgan' : 'person-avery' })] })));
  const L = LP.reduce(recs);
  same(L.heads.length, N, 'set-up: wider than a record can name');
  const s1 = LP.seenFor(L, ['jira:10102']);
  same(s1.seen.length, LP.LIMITS.seen, 'one page');
  same(s1.left, 1, 'and how many are left for the next one');
  const f1 = reqFile('page-1', { loop: LOOPT, changes: [on102('owner', { owner: 'person-avery' })], seen: s1.seen });
  same(LP.fileWhy(f1.id + '.json', f1), '', 'the page is a record every reader takes');
  const r1 = LP.cleanRequest(JSON.parse(LP.text(f1)), f1.id + '.json').record, L1 = LP.reduce(recs.concat([r1]));
  const R1 = RO(L1, runs8());
  same(R1.ok, false, 'approval waits while a page is left');
  assert.ok(R1.items.filter(i => i.key === 'ABC-102')[0].ownerWhy, 'the owner is still in conflict');
  const s2 = LP.seenFor(L1, ['jira:10102']);
  same(s2.left, 0, 'the rest fits');
  const f2 = reqFile('page-2', { loop: LOOPT, changes: [on102('owner', { owner: 'person-avery' })], seen: s2.seen });
  const L2 = LP.reduce(recs.concat([r1, LP.cleanRequest(JSON.parse(LP.text(f2)), f2.id + '.json').record])), R2 = RO(L2, runs8());
  same(R2.items.filter(i => i.key === 'ABC-102')[0].owner, 'person-avery', 'the last page settles it');
  same(R2.ok, true, 'and approval may go ahead');
  assert.ok(RO(L, runs8()).blockers.some(b => /ABC-102: 51 decisions on its owner were made at once, more than one record can settle \(50\)\. Settle these 50 first, then the rest\./.test(b.text)), 'held, saying why in plain words');
  const small = LP.seenFor(LP.reduce(recs.slice(0, 4)), ['jira:10102']);
  same(small.left, 0); same(small.seen, LP.reduce(recs.slice(0, 4)).heads, 'under the limit, a record names the heads as before');
});
rule('Round 11 (2): a page puts the edited slot first: 50 agreeing owners never crowd out 51 conflicting exception decisions', () => {
  const recs = [b8()];
  for (let i = 0; i < 50; i++) recs.push(req('req-release-helper-' + PF.sha256.hex('ow' + i).slice(0, 24), ['s0'], { changes: [on102('owner', { owner: 'person-avery' })] }));
  for (let i = 0; i < 51; i++) recs.push(req('req-release-helper-' + PF.sha256.hex('ex' + i).slice(0, 24), ['s0'], { changes: [on102(i % 2 ? 'withdraw' : 'exception', i % 2 ? {} : { reason: 'Docs', approver: 'person-morgan' })] }));
  const exOut = (L) => (L.items.filter(x => x.key === 'ABC-102')[0].excOut || []).length;
  recs.forEach(x => { x.loop = LOOPT; });
  let all = recs.slice(), L = LP.reduce(all), n = 0;
  assert.ok(exOut(L) > 50, 'set-up: the exception conflict is wider than a page');
  const r = release().r, V0 = () => LP.view(r, 'each', { records: all, runs: [] });
  while (exOut(L) && n < 4) {
    const V = V0(), intent = { loop: LOOPT, changes: [on102('exception', { reason: 'Docs', approver: 'person-morgan' })] };
    const c = LP.cleanIntent(intentOf(intent), 'pg-' + n, { name: 'release-helper', version: '1.0' }), P = LP.project(r, V, c.intent, {});
    const f = LP.buildRequest(c.intent, { seen: P.seen, children: [], now: AT, app: '3.0.0' });
    all = all.concat([LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record]); L = LP.reduce(all); n++;
  }
  same(exOut(L), 0, 'the exception conflict settles, page by page (' + n + ' corrections)');
  assert.ok(n <= 2, 'in two pages: ' + n);
});
rule('Round 9 (5): a Jira observation of another query is refused like another scope of a feed: it proposes nothing', () => {
  const L = LP.reduce([req('q1', [], { observation: obs([101, 102]) }), req('q2', ['q1'], { observation: obs([], { query: 'project = OTHER' }) })]);
  same(L.items.map(x => x.key + ':' + x.state), ['ABC-101:in', 'ABC-102:in'], 'nothing proposed');
  assert.ok(L.duplicates.some(d => d.record === 'q2' && /query/.test(d.why)), JSON.stringify(L.duplicates));
  same(LP.feedWhy(obs([], { query: 'project = OTHER' }), { items: 'jira.issue' }, L.observation), L.duplicates.filter(d => d.record === 'q2')[0].why);
});
rule('Round 9 (8): a link is parsed after its characters are checked: no invalid IPv4 address, no port above 65535', () => {
  for (const u of ['http://999.1.1.1/', 'http://1.2.3.256/', 'http://1.2.3/', 'http://01.2.3.4/', 'https://example.com:65536/', 'https://example.com:99999/', 'https://example.com:0x50/', 'http://1.2.3.4.5/'])
    assert.ok(!LP.httpLink(u), 'refused: ' + u);
  for (const u of ['http://10.0.0.1:8080/x', 'https://example.com:65535/', 'https://a-b.example.com/p?q=1#f', 'http://localhost/']) assert.ok(LP.httpLink(u), 'kept: ' + u);
});
rule('3b: the preview counts in the loop\'s noun and names its feed, never Jira, for a generic list', () => {
  const P = { loop: LOOPT, kind: 'item', noun: { one: 'environment', many: 'environments' }, feed: 'deploy-targets', added: [{ key: 'qa', title: 'QA' }, { key: 'dev', title: '' }], proposed: [], excluded: [{ key: 'old' }], restored: [], children: [], impact: { review: false }, overLimit: null,
    observation: iclean(iobs(['qa', 'dev'], { complete: false })).out };
  const t = LP.previewText(P, { title: 'Deploy everywhere', dryRun: true });
  assert.ok(/Would add 2 environments and remove 1 environment\./.test(t), t);
  assert.ok(/Observation from deploy-targets: 2 of 2 reported matches read; not complete .*Missing environments can't be proposed for removal\. Retry the sync\./.test(t), t);
  assert.ok(!/Jira|stor(y|ies)/.test(t), t);
});
rule('3b: the map: items: item takes source: and noun:, not from:; a kind this copy doesn\'t know is refused, and its runs are read-only', () => {
  const G = (x) => ['---', 'process: deploy-everywhere', 'title: Deploy everywhere', 'owner: person-morgan', '---', '', '## Envs · DO-CONFIRM {#envs}', '- [!] {jira.search} Find {#find}', '  query: x', '- [!] {for.each} Deploy to every environment {#each}', '  process: validate-story'].concat(x, ['  accepts: cleared', '']).join('\n');
  none(check(G(['  items: item', '  source: deploy-targets', '  noun: environment / environments', '  pass: issue=item:key'])).blockers, /Deploy to every environment/);
  has(check(G(['  items: item', '  from: #find', '  pass: issue=item:key'])).blockers, /from: is for Jira/);
  has(check(G(['  items: item', '  source: Deploy Targets!', '  pass: issue=item:key'])).blockers, /"source" is the feed/);
  has(check(G(['  items: item', '  noun: environments', '  pass: issue=item:key'])).blockers, /noun:/);
  has(check(G(['  items: widget', '  pass: issue=item:key'])).blockers, /widget/);
  const md = G(['  items: widget', '  pass: issue=item:key']);
  assert.ok(/widget/.test(PF.publish.unrunnable(md, null)) && /doesn't know/.test(PF.publish.unrunnable(md, null)), PF.publish.unrunnable(md, null));
  const f = { format: 'flightdeck-plan/3', features: ['loops'], id: 'req-release-helper-0123456789abcdef01234567', kind: 'widget', loop: LOOPT, created: AT, seen: [], observation: null, changes: [], children: [] };
  const rq = LP.cleanRequest(f, f.id + '.json'); assert.ok(!rq.ok && /widget/.test(rq.why), JSON.stringify(rq));
});
rule('3b: the slice 3 races on generic items: three decisions at once and a choice in conflict hold approval until one saw every participant', () => {
  const b = ireq('g0', [], { changes: [{ op: 'add', item: env('staging') }, { op: 'add', item: env('prod') }] });
  const kidI = (k, v, id) => ended(0, v, { id: id || 'k-' + k, parent: { process: 'release-readiness', id: 'r-41', step: 'each', item: { uid: 'item:key:' + k, key: k, attempt: 1 } } });
  const runs = [kidI('staging', 'cleared'), kidI('prod', 'cleared')], on = (op, x) => Object.assign({ op, item: env('prod') }, x || {});
  same(RO(LP.reduce([b], IOPT), runs).ok, true);
  const recs = [b, ireq('g-a', ['g0'], { changes: [on('exclude', { reason: 'x' })] }), ireq('g-m', ['g0'], { changes: [on('restore')] }), ireq('g-z', ['g0'], { changes: [on('exclude', { reason: 'x' })] }), ireq('g-d', ['g-m', 'g-z'], { changes: [on('exclude', { reason: 'x' })] })];
  same(RO(LP.reduce(recs, IOPT), runs).ok, false, 'held');
  same(RO(LP.reduce(recs.concat([ireq('g-e', ['g-d', 'g-a'], { changes: [on('exclude', { reason: 'x' })] })]), IOPT), runs).ok, true, 'settled');
  const two = runs.concat([kidI('prod', 'needs-work', 'k-prod-b')]);
  const ch = (id, run) => ireq(id, ['g0'], { changes: [on('choose', { run, attempt: 1, candidates: ['k-prod', 'k-prod-b'] })] });
  same(RO(LP.reduce([b, ch('c-1', 'k-prod'), ch('c-2', 'k-prod-b')], IOPT), two).ok, false, 'two choices at once hold');
});

run();
