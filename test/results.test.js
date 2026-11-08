// Module results (3.0, docs/design.md 43): a checklist's one typed result, set by its decision; a linked step that says which
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
      '- [' + (o.optional ? ' ' : '!') + '] {decide} Record the validation result {#verdict}', '  options: ' + (o.options || 'cleared, needs-work, deferred')])
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

/* ---------- Runs ---------- */
const exactOf = (files) => P.exactOf({ 'map.md': new Uint8Array(Buffer.from(files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(files['types.json'], 'utf8')) });
let seq = 0;
function publish(md, extra) {
  const b = P.build(md, Object.assign({ by: 'person-avery', changes: 'x', now: AT, existing: [], rand: 'r' + String(++seq).padStart(7, '0'), app: '3.0.0' }, extra || {}));
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const v = P.verify(b.folder, b.files, exactOf(b.files)); assert.ok(v.ok, v.why); v.folder = b.folder; v.process = M.parse(md).meta.process; v.files = b.files;
  return v;
}
const proc = (pubs) => { const i = P.index(pubs); return { latest: i.latest, all: i.all, clashes: i.clashes, broken: [] }; };
function child(decision, id, o) {
  const v = o && o.pub || publish(CHILD());
  const c = R.create(v, { id: id || 'kid1', by: 'person-avery', session: 'w', now: AT, app: '3.0.0', details: { issue: (o && o.issue) || 'ABC-104' } });
  const map = R.mapOf(c);
  R.done(c, map, 'read', 'person-avery', AT);
  if (decision) R.done(c, map, 'verdict', 'person-avery', AT, { decision: decision });
  if (decision === null) { R.na(c, map, 'verdict', 'person-avery', AT); R.pass(c, map, 0, 'person-avery', AT); R.end(c, map, 'Completed', 'person-avery', 'Avery', AT); }
  if (decision && !(o && o.open)) { R.pass(c, map, 0, 'person-avery', AT); R.end(c, map, 'Completed', 'person-avery', 'Avery', AT); }
  return c;
}

rule('The decision and the result are one value: one box, Done sets the result, nobody sets it by hand', () => {
  const c = child('Needs-Work', 'kid1', { open: true }), map = R.mapOf(c);
  same(c.features, ['typed-details', 'module-results']);
  const ev = R.evidenceFor(c, M.findStep(map, 'verdict').step).list;
  same(ev.map(d => d.name), ['decision', 'why'], 'no second box for the result');
  same([ev[0].detail, ev[0].required, ev[0].options], ['disposition', true, ['cleared', 'needs-work', 'deferred']]);
  assert.strictEqual(c.details.disposition, 'needs-work');
  assert.throws(() => R.setDetail(c, map, 'disposition', 'cleared', 'person-avery', LATER), /\^disposition is the result its decision sets/);
  const back = R.sanitize(plain(c));
  assert.ok(!back._unrunnable, back._unrunnable);
  same(R.resultOf(c), { name: 'disposition', value: 'needs-work', step: 'verdict', at: AT });
  assert.strictEqual(R.outcomeText(c), '', 'not ended yet');
  R.pass(c, map, 0, 'person-avery', AT); R.end(c, map, 'Completed', 'person-avery', 'Avery', AT);
  assert.strictEqual(R.outcomeText(c), 'Completed · needs-work');
  assert.strictEqual(R.outcomeText(child('cleared', 'kid2')), 'Completed · cleared');
});

function parentRun(kidPub, o) {
  const procs = { 'validate-story': proc([kidPub]) }, procOf = (id) => procs[id] || null;
  const pp = publish(PARENT(o), { childProcs: procs });
  const r = R.create(pp, { explicit: pp.info.format !== 'preflight-publication/2', id: 'rel1', by: 'person-avery', session: 'w', now: AT, app: '3.0.0', details: { issue: 'ABC-104' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
  return { r, map: R.mapOf(r), procOf, pub: pp };
}
const link = (p, c, kidPub) => R.linkChild(p.r, p.map, 'story', { process: 'validate-story', id: c.id, inputs: { issue: c.details.issue }, folder: kidPub.info.folder, format: c.format, pin: p.r.pins.children.story }, 'person-avery', AT, { run: c, procOf: p.procOf });

rule('A linked step is done only when its run completed with a result it accepts; the result comes in with where it came from', () => {
  const kp = publish(CHILD()), p = parentRun(kp), c = child('cleared', 'kid1', { pub: kp });
  link(p, c, kp);
  assert.strictEqual(R.settleChild(p.r, p.map, 'story', c, 'person-avery', LATER, p.procOf), 'done');
  same([p.r.steps.story.s, p.r.steps.story.child.result, p.r.details.story_result], ['done', 'cleared', 'cleared']);
  assert.ok(p.r.log.some(l => /story_result: cleared, from the Validate a story run \(kid1\)/.test(l.what)), JSON.stringify(p.r.log.map(l => l.what)));
  assert.throws(() => R.setDetail(p.r, p.map, 'story_result', 'deferred', 'person-avery', LATER), /\^story_result is the result its linked run returns/);
  assert.strictEqual(R.gateStatus(p.r, p.map, 0), 'ready');
  const back = R.sanitize(plain(p.r));
  assert.ok(!back._unrunnable, back._unrunnable); assert.strictEqual(back.steps.story.child.result, 'cleared');
});

rule('Completed · needs-work holds the parent step with the reason, not as the child\'s failure, and a new run can replace it', () => {
  const kp = publish(CHILD()), p = parentRun(kp), c = child('needs-work', 'kid1', { pub: kp });
  link(p, c, kp);
  assert.strictEqual(R.settleChild(p.r, p.map, 'story', c, 'person-avery', LATER, p.procOf), 'held');
  const a = p.r.steps.story;
  same([a.s, a.reason, !!a.child.failed, a.child.result, p.r.details.story_result], ['blocked', 'Validate a story returned needs-work; this step accepts cleared', false, 'needs-work', 'needs-work']);
  assert.strictEqual(R.resultHeld(p.r, M.findStep(p.map, 'story').step, a), 'Validate a story returned needs-work; this step accepts cleared');
  assert.strictEqual(R.gateStatus(p.r, p.map, 0), 'open');
  assert.ok(!R.canPass(p.r, p.map, 0) && !R.canWaive(p.r, p.map, 0), 'the gate stays closed');
  same(R.headline(p.r, p.map).sub, 'Blocked (Validate a story returned needs-work; this step accepts cleared). Resolve it before anyone moves on.');
  const c2 = child('cleared', 'kid2', { pub: kp });
  link(p, c2, kp);
  assert.strictEqual(R.settleChild(p.r, p.map, 'story', c2, 'person-avery', LAST, p.procOf), 'done');
  same([p.r.steps.story.s, p.r.details.story_result], ['done', 'cleared']);
  const op = publish(CHILD({ optional: true })), none = child(null, 'kid3', { pub: op });
  assert.strictEqual(R.outcomeText(none), 'Completed', 'no decision, no result');
  const p2 = parentRun(op); link(p2, none, op);
  assert.strictEqual(R.settleChild(p2.r, p2.map, 'story', none, 'person-avery', LATER, p2.procOf), 'held');
  assert.strictEqual(p2.r.steps.story.reason, 'Validate a story returned no result; this step accepts cleared');
});

rule('A new result after the gate passed sends it to review, even when it comes back to the same value', () => {
  const kp = publish(CHILD()), p = parentRun(kp), c = child('cleared', 'kid1', { pub: kp });
  link(p, c, kp); R.settleChild(p.r, p.map, 'story', c, 'person-avery', LATER, p.procOf);
  R.pass(p.r, p.map, 0, 'person-avery', LATER);
  assert.strictEqual(R.gateStatus(p.r, p.map, 0), 'passed');
  R.setDetail(p.r, p.map, 'issue', 'ABC-105', 'person-avery', LAST);
  const c2 = child('cleared', 'kid2', { pub: kp, issue: 'ABC-105' });
  link(p, c2, kp);
  assert.strictEqual(R.settleChild(p.r, p.map, 'story', c2, 'person-avery', LAST, p.procOf), 'done');
  assert.strictEqual(R.gateStatus(p.r, p.map, 0), 'review', 'same value, new result: the approval doesn\'t come back');
  const g = p.r.gates[p.map.phases[0].gate.id]; assert.ok(/changed|result/.test(g.reason), g.reason);
  /* A passed record whose phase was reopened underneath it (the step open again): the next result still doesn't restore it. */
  const q = parentRun(kp), k1 = child('cleared', 'kid1', { pub: kp });
  link(q, k1, kp); R.settleChild(q.r, q.map, 'story', k1, 'person-avery', LATER, q.procOf); R.pass(q.r, q.map, 0, 'person-avery', LATER);
  q.r.steps.story.child.failed = true; q.r.steps.story.s = 'open';
  const k2 = child('cleared', 'kid2', { pub: kp });
  link(q, k2, kp); R.settleChild(q.r, q.map, 'story', k2, 'person-avery', LAST, q.procOf);
  same([R.gateStatus(q.r, q.map, 0), q.r.gates[q.map.phases[0].gate.id].reason], ['review', 'A linked run returned a new result']);
});

rule('A step without accepts: settles as before, whatever the result', () => {
  const kp = publish(CHILD()), p = parentRun(kp, { sets: null, accepts: null, context: 'issue' }), c = child('needs-work', 'kid1', { pub: kp });
  link(p, c, kp);
  assert.strictEqual(R.settleChild(p.r, p.map, 'story', c, 'person-avery', LATER, p.procOf), 'done');
  assert.ok(!('result' in p.r.steps.story.child));
});

/* ---------- What the command line gives assistants (flightdeck-read/2) ---------- */
rule('Contract 2: process carries the result and accepts, run and runs the result and outcome, run and next who holds a step', () => {
  const A = PF.appjson, nameOf = (id) => id ? { id, name: id } : null;
  const kp = publish(CHILD()), p = parentRun(kp), c = child('needs-work', 'kid1', { pub: kp });
  link(p, c, kp); R.settleChild(p.r, p.map, 'story', c, 'person-avery', LATER, p.procOf);
  const pr = A.process2({ process: 'validate-story', id: 'validate-story', title: 'Validate a story', pubs: [kp], index: P.index([kp]) }, kp);
  same(pr.result, { name: 'disposition', options: ['cleared', 'needs-work', 'deferred'], step: 'verdict' });
  same(A.conforms(pr, A.SCHEMA2.process), []);
  const ppub = publish(PARENT(), { childProcs: { 'validate-story': proc([kp]) } }), pp = A.process2({ process: 'release', id: 'release', title: 'Release', pubs: [ppub], index: P.index([ppub]) }, ppub);
  const st = pp.phases[0].steps[0];
  assert.ok(!('result' in pp), 'no result of its own'); same([st.accepts, st.imports, st.sets], [['cleared'], 'story_result', ['story_result']]);
  same(A.conforms(pp, A.SCHEMA2.process), []);
  const cr = A.summary2(c, nameOf);
  same([cr.result, cr.outcome], [{ name: 'disposition', value: 'needs-work' }, 'Completed · needs-work']);
  const rr = A.run2(p.r, [], nameOf).run, s0 = rr.steps.filter(x => x.id === 'story')[0];
  same([s0.state, s0.accepts, s0.result, s0.heldBy], ['blocked', ['cleared'], 'needs-work', { process: 'validate-story', id: 'kid1', result: 'needs-work', reason: 'Validate a story returned needs-work; this step accepts cleared' }]);
  assert.ok(!('result' in rr) && !('outcome' in rr), 'a run without a result is as before');
  assert.ok(!('accepts' in rr.steps.filter(x => x.id === 'ship1')[0]), 'a step without module results is as before');
  same(A.conforms({ run: rr }, A.SCHEMA2.run), []);
  const nx = A.next2(p.r, nameOf, null);
  same([nx.next.kind, nx.next.step.heldBy && nx.next.step.heldBy.result], ['blocked', 'needs-work']);
  same(A.conforms(nx, A.SCHEMA2.next), []);
  assert.ok(!('heldBy' in A.next(p.r, nameOf, null).next.step), 'contract 1 is unchanged');
});

/* ---------- Review 04 ---------- */
const settled = (decision) => { const kp = publish(CHILD()), p = parentRun(kp), c = child(decision || 'cleared', 'kid1', { pub: kp }); link(p, c, kp); R.settleChild(p.r, p.map, 'story', c, 'person-avery', LATER, p.procOf); return { kp, p, c, st: M.findStep(p.map, 'story').step }; };
const redecide = (c, value, at) => { c.steps.verdict.values.decision = value; c.steps.verdict.at = at; c.details.disposition = value; };
rule('R04-1: a settled step notices its run changed after it counted it (a new answer, changed and back, a reopened gate) and goes back with its gate to review', () => {
  const { p, c, st } = settled();
  R.pass(p.r, p.map, 0, 'person-avery', LATER);
  assert.strictEqual(R.resultMoved(p.r, st, p.r.steps.story, c, p.procOf), '', 'nothing changed: nothing to do');
  redecide(c, 'needs-work', LAST);
  const why = R.resultMoved(p.r, st, p.r.steps.story, c, p.procOf);
  assert.ok(/Validate a story changed after this step counted it/.test(why), why);
  R.unsettleResult(p.r, p.map, 'story', why, 'person-avery', LAST);
  same([p.r.steps.story.s, R.gateStatus(p.r, p.map, 0), 'result' in p.r.steps.story.child, !!p.r.steps.story.child.failed], ['recheck', 'review', false, false]);
  assert.strictEqual(R.settleChild(p.r, p.map, 'story', c, 'person-avery', LAST, p.procOf), 'held');
  redecide(c, 'cleared', '2026-11-07T12:00:00.000Z');
  const back = R.resultMoved(p.r, st, p.r.steps.story, c, p.procOf);
  assert.ok(back, 'changed and back is still a change');
  R.unsettleResult(p.r, p.map, 'story', back, 'person-avery', LAST);
  assert.strictEqual(R.settleChild(p.r, p.map, 'story', c, 'person-avery', LAST, p.procOf), 'done');
  assert.strictEqual(R.gateStatus(p.r, p.map, 0), 'review', 'the approval doesn\'t come back by itself');
  const q = settled(), cm = R.mapOf(q.c);
  R.reopen(q.c, cm, 0, 'person-avery', LAST);
  assert.ok(/changed after this step counted it/.test(R.resultMoved(q.p.r, q.st, q.p.r.steps.story, q.c, q.p.procOf)), 'a reopened gate is a change');
  const n = parentRun(publish(CHILD()), { sets: null, accepts: null, context: 'issue' });
  assert.strictEqual(R.resultMoved(n.r, M.findStep(n.map, 'story').step, { s: 'done', child: { process: 'validate-story', id: 'x' } }, q.c, n.procOf), '', 'a step without accepts: keeps 2.x behavior');
});

rule('R04-2: a run whose result disagrees with its decision is refused before anything is settled', () => {
  const kp = publish(CHILD()), p = parentRun(kp), c = child('needs-work', 'kid1', { pub: kp });
  c.details.disposition = 'cleared';
  const res = R.resultOf(c);
  same([res.value, !!res.conflict], ['', true]);
  assert.strictEqual(R.outcomeText(c), 'Completed');
  link(p, c, kp);
  const before = JSON.stringify(p.r);
  assert.throws(() => R.settleChild(p.r, p.map, 'story', c, 'person-avery', LATER, p.procOf), /says \^disposition is cleared, but its decision says needs-work/);
  assert.strictEqual(JSON.stringify(p.r), before, 'nothing settled');
});

rule('R04-4: what a step accepts and imports is checked against the version its run actually starts, before anything starts or links', () => {
  const k1 = publish(CHILD()), procs = { 'validate-story': proc([k1]) }, pp = publish(PARENT(), { childProcs: procs });
  const k2 = publish(CHILD({ context: 'issue, disposition:choice(cleared|needs-work|deferred|ready)', options: 'cleared, needs-work, deferred, ready' }), { existing: [k1.info] });
  const later = { 'validate-story': proc([k1, k2]) }, procOf = (id) => later[id] || null;
  const r = R.create(pp, { id: 'rel2', by: 'person-avery', session: 'w', now: AT, app: '3.0.0', details: { issue: 'ABC-104' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) }), map = R.mapOf(r);
  const st = M.findStep(map, 'story').step;
  assert.ok(/\^story_result can't hold every result Validate a story v2 returns \(ready\)/.test(R.resultFit(r, st, k2.map, 2)), R.resultFit(r, st, k2.map, 2));
  assert.strictEqual(R.resultFit(r, st, k1.map), '');
  const c = child('ready', 'kid9', { pub: k2 }), before = JSON.stringify(r);
  assert.throws(() => R.linkChild(r, map, 'story', { process: 'validate-story', id: c.id, inputs: { issue: 'ABC-104' }, folder: k2.info.folder, format: c.format, pin: r.pins.children.story }, 'person-avery', AT, { run: c, procOf }), /can't hold every result/);
  assert.strictEqual(JSON.stringify(r), before, 'nothing linked');
});

rule('R04-6: settling again with the same answer changes nothing, even after the gate passed', () => {
  const { p, c } = settled();
  R.pass(p.r, p.map, 0, 'person-avery', LATER);
  const before = JSON.stringify(p.r);
  assert.strictEqual(R.settleChild(p.r, p.map, 'story', c, 'person-avery', LAST, p.procOf), 'done');
  assert.strictEqual(JSON.stringify(p.r), before);
  const h = settled('needs-work'), hb = JSON.stringify(h.p.r);
  assert.strictEqual(R.settleChild(h.p.r, h.p.map, 'story', h.c, 'person-avery', LAST, h.p.procOf), 'held');
  assert.strictEqual(JSON.stringify(h.p.r), hb);
});

rule('R04-7/8: contract 2 says a step waits for its recorder to settle it, with the run and its result; accepts keeps values with =', () => {
  const A = PF.appjson, nameOf = (id) => id ? { id, name: id } : null;
  const kp = publish(CHILD()), p = parentRun(kp), c = child('needs-work', 'kid1', { pub: kp });
  link(p, c, kp);
  const kids = { 'validate-story/kid1': c };
  const rr = A.run2(p.r, [], nameOf, { kids }).run, s0 = rr.steps.filter(x => x.id === 'story')[0];
  same(s0.awaiting, { process: 'validate-story', id: 'kid1', result: 'needs-work', reason: 'Validate a story ended: Completed · needs-work; this run\'s recorder settles this step when they next open Flightdeck' });
  same(A.conforms({ run: rr }, A.SCHEMA2.run), []);
  const nx = A.next2(p.r, nameOf, null, { kids });
  same(nx.next.step.awaiting && nx.next.step.awaiting.id, 'kid1', JSON.stringify(nx.next));
  same(A.conforms(nx, A.SCHEMA2.next), []);
  R.settleChild(p.r, p.map, 'story', c, 'person-avery', LATER, p.procOf);
  same(A.run2(p.r, [], nameOf, { kids }).run.steps.filter(x => x.id === 'story')[0].awaiting, null, 'settled: nothing awaited');
  const eq = CHILD({ context: 'issue, disposition:choice(ready=yes|no)', options: 'ready=yes, no' });
  const ek = publish(eq), ep = publish(PARENT({ context: 'issue', sets: null, accepts: 'ready=yes' }), { childProcs: { 'validate-story': proc([ek]) } });
  same(A.process2({ process: 'release', id: 'release', title: 'Release', pubs: [ep], index: P.index([ep]) }, ep).phases[0].steps[0].accepts, ['ready=yes']);
});

rule('R04-9/10: a bound result is never taken from a plan or start; a receipt says Completed · result', () => {
  const kp = publish(CHILD());
  const c = R.create(kp, { id: 'kid5', by: 'person-avery', session: 'w', now: AT, app: '3.0.0', details: { issue: 'ABC-104', disposition: 'cleared' } });
  assert.strictEqual(c.details.disposition, '', 'the decision sets it, not the start');
  const done = child('needs-work', 'kid6', { pub: kp });
  assert.ok(/^Status: Ended: Completed · needs-work$/m.test(R.receipt(done, R.mapOf(done), (x) => x, AT)), R.receipt(done, R.mapOf(done), (x) => x, AT));
});

rule('R04-7: flightdeck run and next --contract 2 read the linked run and say the step awaits its recorder, writing nothing', () => {
  const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
  const kp = publish(CHILD()), p = parentRun(kp), c = child('needs-work', 'kid1', { pub: kp }); link(p, c, kp);
  const pp = p.pub;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-results-')), put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('people.json', JSON.stringify({ people: [{ id: 'person-avery', name: 'Avery' }] }));
  [[kp, 'validate-story'], [pp, 'release']].forEach(([v, id]) => Object.keys(v.files).forEach(k => put('publications/' + id + '/' + v.folder + '/' + k, v.files[k])));
  assert.strictEqual(p.r.folder, pp.folder, 'set-up: the parent runs the version written');
  put('runs/release/rel1/run.json', JSON.stringify(p.r)); put('runs/validate-story/kid1/run.json', JSON.stringify(c));
  const before = fs.readFileSync(path.join(dir, 'runs/release/rel1/run.json'), 'utf8');
  const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js'), cli = (...a) => { try { return execFileSync(process.execPath, [BIN, ...a], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { return String(e.stdout); } };
  const rr = JSON.parse(cli('run', dir, 'release/rel1', '--contract', '2', '--json'));
  const st = rr.data.run.steps.filter(x => x.id === 'story')[0];
  same([st.awaiting && st.awaiting.id, st.awaiting && st.awaiting.result], ['kid1', 'needs-work'], JSON.stringify(rr).slice(0, 600));
  const nx = JSON.parse(cli('next', dir, 'release/rel1', '--contract', '2', '--json'));
  same(nx.data.next.step.awaiting && nx.data.next.step.awaiting.id, 'kid1', JSON.stringify(nx).slice(0, 600));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'runs/release/rel1/run.json'), 'utf8'), before, 'nothing written');
});

/* ---------- Review 05 ---------- */
rule('R05-1: a completed run with no recorded decision has no result, so it never clears a parent', () => {
  const kp = publish(CHILD()), p = parentRun(kp), c = child('cleared', 'kid1', { pub: kp });
  delete c.steps.verdict.values;
  const back = R.sanitize(plain(c));
  same([R.resultOf(back).value, !!R.resultOf(back).conflict], ['', true]);
  link(p, back, kp);
  assert.throws(() => R.settleChild(p.r, p.map, 'story', back, 'person-avery', LATER, p.procOf), /its decision says nothing/);
  assert.ok(!R.canPass(p.r, p.map, 0));
});

rule('R05-2: an ended parent is never rewritten; one read-only verdict says its linked run\'s result changed, on the run, in Folder health and in contract 2', () => {
  const A = PF.appjson, nameOf = (id) => id ? { id, name: id } : null;
  const { p, c, st } = settled();
  R.pass(p.r, p.map, 0, 'person-avery', LATER); R.done(p.r, p.map, 'ship1', 'person-avery', LATER); R.pass(p.r, p.map, 1, 'person-avery', LATER);
  R.end(p.r, p.map, 'Completed', 'person-avery', 'Avery', LATER);
  const kids = { 'validate-story/kid1': c };
  assert.strictEqual(R.resultChanged(p.r, st, p.r.steps.story, c), '', 'unchanged: nothing to say');
  same(A.run2(p.r, [], nameOf, { kids }).run.resultsChanged, []);
  redecide(c, 'needs-work', LAST);
  const before = JSON.stringify(p.r);
  assert.strictEqual(R.resultMoved(p.r, st, p.r.steps.story, c, p.procOf), '', 'ended parents are outside settlement');
  assert.ok(/^A linked run's result changed after this run ended/.test(R.resultChanged(p.r, st, p.r.steps.story, c)));
  const marks = R.resultMarks([p.r, c]);
  same(marks.map(m => [m.run, m.step, m.child]), [['rel1', 'story', 'validate-story/kid1']]);
  const hc = PF.health.check({ data: { people: [], runs: [p.r, c], processes: [] }, scan: null, me: 'person-avery', app: '3.0.0' }, Date.parse(LAST));
  assert.ok(hc.issues.some(i => /A linked run's result changed after this run ended/.test(i.title + ' ' + i.detail)), JSON.stringify(hc.issues.map(i => i.title)));
  const rr = A.run2(p.r, [], nameOf, { kids }).run;
  same(rr.resultsChanged.map(x => [x.step, x.id, x.result]), [['story', 'kid1', 'needs-work']]);
  assert.ok(/^A linked run's result changed after this run ended/.test(rr.resultsChanged[0].reason));
  same(rr.steps.filter(x => x.id === 'story')[0].awaiting, null, 'no promise to settle an ended run');
  same(A.conforms({ run: rr }, A.SCHEMA2.run), []);
  assert.strictEqual(JSON.stringify(p.r), before, 'byte for byte as it ended');
});

rule('R05-3: next puts a step awaiting settlement before work further on', () => {
  const A = PF.appjson, nameOf = (id) => id ? { id, name: id } : null;
  const { p, c } = settled();
  R.pass(p.r, p.map, 0, 'person-avery', LATER);
  redecide(c, 'needs-work', LAST);
  const nx = A.next2(p.r, nameOf, null, { kids: { 'validate-story/kid1': c } });
  same([nx.next.kind, nx.next.step.id, nx.next.step.awaiting && nx.next.step.awaiting.id], ['step', 'story', 'kid1']);
  same(A.conforms(nx, A.SCHEMA2.next), []);
});

rule('R05-4: a linked run that can\'t be read makes run and next partial, naming it', () => {
  const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
  const kp = publish(CHILD()), p = parentRun(kp), c = child('needs-work', 'kid1', { pub: kp }); link(p, c, kp);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-results-')), put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('people.json', JSON.stringify({ people: [{ id: 'person-avery', name: 'Avery' }] }));
  [[kp, 'validate-story'], [p.pub, 'release']].forEach(([v, id]) => Object.keys(v.files).forEach(k => put('publications/' + id + '/' + v.folder + '/' + k, v.files[k])));
  put('runs/release/rel1/run.json', JSON.stringify(p.r)); put('runs/validate-story/kid1/run.json', '{');
  const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js'), cli = (...a) => { try { return { code: 0, out: execFileSync(process.execPath, [BIN, ...a], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
  ['run', 'next'].forEach(cmd => {
    const r = cli(cmd, dir, 'release/rel1', '--contract', '2', '--json'), j = JSON.parse(r.out);
    assert.ok(r.code !== 0 && j.complete === false && j.problems.some(x => /runs\/validate-story\/kid1/.test(x.path)), cmd + ': ' + r.out.slice(0, 400));
  });
});

/* ---------- Review 06 ---------- */
rule('R06-1: a linked run that isn\'t in the folder makes run and next partial, naming it (exit 4)', () => {
  const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
  const kp = publish(CHILD()), p = parentRun(kp), c = child('needs-work', 'kid1', { pub: kp }); link(p, c, kp);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-results-')), put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('people.json', JSON.stringify({ people: [{ id: 'person-avery', name: 'Avery' }] }));
  [[kp, 'validate-story'], [p.pub, 'release']].forEach(([v, id]) => Object.keys(v.files).forEach(k => put('publications/' + id + '/' + v.folder + '/' + k, v.files[k])));
  put('runs/release/rel1/run.json', JSON.stringify(p.r));
  const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js'), cli = (...a) => { try { return { code: 0, out: execFileSync(process.execPath, [BIN, ...a], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
  ['run', 'next'].forEach(cmd => {
    const r = cli(cmd, dir, 'release/rel1', '--contract', '2', '--json'), j = JSON.parse(r.out);
    assert.ok(r.code === 4 && j.complete === false && j.problems.some(x => x.path === 'runs/validate-story/kid1/run.json' && x.kind === 'nofile'), cmd + ': ' + r.code + ' ' + r.out.slice(0, 400));
  });
});

rule('R06-2/3: the awaiting step displaces only later work, in next and mine; a pause and earlier work keep their place', () => {
  const A = PF.appjson, nameOf = (id) => id ? { id, name: id } : null;
  const { p, c } = settled();
  R.pass(p.r, p.map, 0, 'person-avery', LATER);
  redecide(c, 'needs-work', LAST);
  const kids = { 'validate-story/kid1': c };
  let nx = A.next2(p.r, nameOf, 'person-avery', { kids });
  same([nx.next.step.id, nx.mine && nx.mine.step.id], ['story', 'story'], JSON.stringify(nx.mine));
  R.pause(p.r, 'Waiting on the vendor', 'person-avery', LAST);
  nx = A.next2(p.r, nameOf, 'person-avery', { kids });
  same(nx.next.kind, 'paused');
  /* Earlier unfinished work in the same phase stays first. */
  const md = PARENT().replace('## Stories · DO-CONFIRM {#stories}\n', '## Stories · DO-CONFIRM {#stories}\n- [!] {confirm} Read the release notes {#notes}\n');
  const kp = publish(CHILD()), procs = { 'validate-story': proc([kp]) }, procOf = (id) => procs[id] || null, pp = publish(md, { childProcs: procs });
  const r = R.create(pp, { id: 'rel3', by: 'person-avery', session: 'w', now: AT, app: '3.0.0', details: { issue: 'ABC-104' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) }), map = R.mapOf(r);
  const k = child('cleared', 'kid7', { pub: kp });
  R.linkChild(r, map, 'story', { process: 'validate-story', id: k.id, inputs: { issue: 'ABC-104' }, folder: kp.info.folder, format: k.format, pin: r.pins.children.story }, 'person-avery', AT, { run: k, procOf });
  nx = A.next2(r, nameOf, 'person-avery', { kids: { 'validate-story/kid7': k } });
  same([nx.next.step.id, nx.mine && nx.mine.step.id], ['notes', 'notes']);
});

run();
