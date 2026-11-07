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
  return { r, map: R.mapOf(r), procOf };
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

run();
