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

run();
