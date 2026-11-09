// Living runs (4.0, docs/design.md 45), slice 1: who may authorize a to-do request, and what an open or disputed to-do does
// to the approvals it is governed by. A gate or loop approval never comes back on its own: open to done, or disputed to
// settled, leaves it needing review until a person approves again.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), T = PF.todos, M = PF.map, R = PF.run, P = PF.publish;
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, m) => m === undefined ? assert.deepStrictEqual(plain(a), plain(b)) : assert.deepStrictEqual(plain(a), plain(b), m);
const AT = '2026-11-09T09:00:00.000Z';
const PEOPLE = { people: [{ id: 'person-avery', name: 'Avery' }, { id: 'person-blake', name: 'Blake' }, { id: 'person-casey', name: 'Casey' }, { id: 'person-drew', name: 'Drew', inactive: true }] };

const exactOf = (files) => P.exactOf({ 'map.md': new Uint8Array(Buffer.from(files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(files['types.json'], 'utf8')) });
let seq = 0;
function publishMd(md, extra) {
  const b = P.build(md, Object.assign({ by: 'person-avery', changes: 'x', now: AT, existing: [], rand: 't' + String(++seq).padStart(7, '0'), app: '4.0.0' }, extra || {}));
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const v = P.verify(b.folder, b.files, exactOf(b.files)); assert.ok(v.ok, v.why); v.folder = b.folder; v.files = b.files;
  return v;
}
/* A run/3 checklist (a phase note makes it a 2.0 version), roles reviewer. */
const MD = ['---', 'process: release-notes', 'title: Release notes', 'roles: reviewer', 'context: fix_version', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} @reviewer Read them {#read}', ''].join('\n');
/* The same checklist with a typed detail: a 2.0 version, so its runs are run/3. */
const MD3 = MD.replace('context: fix_version', 'context: fix_version, kind:choice(minor|major)');
function newRun(md) {
  const pub = publishMd(md || MD3);
  const r = R.create(pub, { id: 'r-1', by: 'person-avery', session: 'w', now: AT, app: '4.0.0', details: { fix_version: '4.1' }, roles: { reviewer: 'person-blake' } });
  return { r, pub };
}
const RUN = { process: 'release-notes', id: 'r-1' };
let revs = 0; const rev = () => (++revs).toString(16).padStart(8, '0');
const clean = (f, name) => { const v = T.cleanFile(JSON.parse(T.text(f)), name || f.id + '.json'); assert.ok(v.ok, v.why); return v.record; };
function prop(key, body, seen, by) {
  return clean(T.buildProposal(by ? { run: RUN, id: T.idFor('flightdeck', key), by, seen: seen || [], at: AT, body } : { run: RUN, producer: { name: 'notes-bot', version: '1.0' }, key, seen: seen || [], at: AT, body }));
}
const add = (text, target, md) => { const map = M.parse(md || MD); return { op: 'add', text, target, placement: T.placementFor(map, target) }; };
function decide(q, op, by, consequence, seen) { const s = T.buildStatus({ kind: 'decision', proposal: q.id, run: RUN, seen: seen || [q.id], by, at: AT, op, consequence, writer: 'w1', rev: rev() }); return clean(s.file, s.name); }
function applied(p, previous, authority, seen) { const s = T.buildStatus({ kind: 'application', proposal: p.id, run: RUN, seen: seen || [p.id].concat(previous ? [previous] : []), by: 'person-avery', at: AT, authority, previous: previous || '', effect: T.effectOf(p), writer: 'rec', rev: rev() }); return clean(s.file, s.name); }
function grant(key, ops, targets, adds, by, seen) { return clean(T.buildGrant({ kind: 'grant', id: T.idFor('flightdeck', key), run: RUN, seen: seen || [], by: by || 'person-avery', at: AT, subject: { tool: 'notes-bot' }, ops, targets, limits: { adds: adds == null ? 10 : adds } })); }
function revoke(key, g, seen) { return clean(T.buildGrant({ kind: 'revoke', id: T.idFor('flightdeck', key), run: RUN, seen: seen || [g.id], by: 'person-avery', at: AT, grant: g.id })); }
const memFs = (files) => { const m = new PF.fs.MemoryFS('rules-' + Math.random(), null); Object.keys(files).forEach(p => { m.files[p] = { t: files[p], m: 1 }; }); return m; };
const V = (r, recs) => T.view(r, { records: recs, people: PEOPLE });
const mark = (r, recs) => { T.markHolds([r], { records: recs, people: PEOPLE }); return r; };
const st = (r, recs, id) => V(r, recs).requests[id];
function compound(key, body, by, r) {
  const id = T.idFor('flightdeck', key), b = Object.assign({ todo: T.todoIdFor(id) }, body), eff = T.effectOf(b);
  const C = T.consequenceOf(r, R.mapOf(r), b, V(r, [])).fingerprint;
  return clean(T.buildProposal({ kind: 'compound', run: RUN, id, by, seen: [], at: AT, body, decision: { by, consequence: C }, application: { previous: '', effect: eff, fingerprint: T.fingerprint(eff) } }));
}
/* The recorder's landing of an application, as slice 1 commit 3 does it, enough for these rules: head, feature, review. */
function land(r, a) { r.living = { head: a.id }; if (r.features.indexOf('living-runs') < 0) r.features = PF.envelope.FROZEN.filter(f => r.features.concat(['living-runs']).indexOf(f) >= 0); }

/* ---------- Authority ---------- */
rule('A decision counts only from a person in people.json, active, who records the run or holds one of its roles', () => {
  const { r } = newRun(), map = R.mapOf(r), p = prop('a1', add('Check the links', { phase: 'draft' }));
  const C = T.consequenceOf(r, map, p, V(r, [p])).fingerprint;
  same(st(r, [p], p.id).status, 'waiting', 'a tool\'s request waits for a person');
  same(st(r, [p, decide(p, 'accept', 'person-avery', C)], p.id).status, 'queued', 'the recorder');
  same(st(r, [p, decide(p, 'accept', 'person-blake', C)], p.id).status, 'queued', 'someone in a role');
  [['person-casey', /neither records/], ['person-drew', /inactive/], ['person-zed', /isn't in people\.json/]].forEach(([who, re]) => {
    const q = st(r, [p, decide(p, 'accept', who, C)], p.id);
    same(q.status, 'waiting', who);
    assert.ok(q.ignored.some(x => re.test(x.why)), JSON.stringify(q.ignored));
  });
});
rule('A compound counts only from a person who may decide; otherwise it is ignored with the reason', () => {
  const { r } = newRun();
  const ok = compound('ca1', add('One', { phase: 'draft' }), 'person-avery', r);
  same(V(r, [ok]).requests[ok.id].status, 'queued', 'the recorder');
  [['person-drew', /inactive/], ['person-casey', /neither records/], ['person-zed', /isn't in people\.json/]].forEach(([who, re], i) => {
    const c = compound('cb' + i, add('One', { phase: 'draft' }), who, r), q = V(r, [c]).requests[c.id];
    same(q.status, 'waiting', who);
    assert.ok(q.ignored.some(x => x.record === c.id && re.test(x.why)), JSON.stringify(q.ignored));
    assert.ok(!T.applyPlan(r, V(r, [c]), q).adopt, 'never landed as it is');
  });
});
rule('A grant lets a tool add, check off and reopen on its exact targets within its limit; never drop work or reopen an approval', () => {
  const { r } = newRun(), g = grant('g1', ['add', 'done'], [{ phase: 'draft' }], 1);
  const p1 = prop('b1', add('One', { phase: 'draft' }), [g.id]), p2 = prop('b2', add('Two', { phase: 'draft' }), [g.id, p1.id]), p3 = prop('b3', add('Three', { phase: 'review' }), [g.id]);
  const Tv = V(r, [g, p1, p2, p3]);
  same([Tv.requests[p1.id].status, Tv.requests[p2.id].status, Tv.requests[p3.id].status], ['queued', 'waiting', 'waiting']);
  assert.ok(/limit of 1 additions is used up/.test(Tv.requests[p2.id].why), Tv.requests[p2.id].why);
  same(Tv.requests[p1.id].via, { grant: g.id });
  const a1 = applied(p1, '', { grant: g.id }); land(r, a1);
  const w = prop('b4', { op: 'wont', todo: p1.todo, reason: 'Not needed' }, [a1.id, g.id]), mv = prop('b5', { op: 'move', todo: p1.todo, to: { ticket: 'ABC-123' } }, [a1.id, g.id]);
  const g2 = grant('g2', ['add', 'done', 'reopen'], [{ phase: 'draft' }], 5);
  const Tw = V(r, [g, p1, a1, w, mv, g2]);
  same([Tw.requests[w.id].status, Tw.requests[mv.id].status], ['waiting', 'waiting']);
  assert.ok(/releases work, so a person approves it/.test(Tw.requests[w.id].why));
  r.gates['draft-confirm'] = { s: 'waived', by: 'person-avery', at: AT, reason: 'x', approved: {} };
  const p6 = prop('b6', add('After waiving', { phase: 'draft' }), [a1.id, g2.id]);
  const T6 = V(r, [g, p1, a1, g2, p6]);
  same(T6.requests[p6.id].status, 'waiting');
  assert.ok(/reopens an approval/.test(T6.requests[p6.id].why));
});
rule('A revoke blocks what its grant hasn\'t applied; what landed stays applied', () => {
  const { r } = newRun(), g = grant('g3', ['add'], [{ phase: 'draft' }], 5);
  const p1 = prop('c1', add('One', { phase: 'draft' }), [g.id]), p2 = prop('c2', add('Two', { phase: 'draft' }), [g.id, p1.id]);
  const a1 = applied(p1, '', { grant: g.id }); land(r, a1);
  const x = revoke('x1', g, [g.id, a1.id, p2.id]);
  const Tv = V(r, [g, p1, p2, a1, x]);
  same([Tv.requests[p1.id].status, Tv.requests[p2.id].status], ['applied', 'waiting']);
  assert.ok(/revoked/.test(Tv.requests[p2.id].why));
  const late = prop('c3', add('Made at the same time as the revoke', { phase: 'draft' }), [g.id, a1.id]);
  same(V(r, [g, p1, p2, a1, x, late]).requests[late.id].status, 'waiting', 'a revoke made at once with a request still blocks it');
});
rule('A delegation to a person covers nothing once that person is inactive or not in people.json', () => {
  const { r } = newRun();
  ['person-drew', 'person-zed'].forEach((who, i) => {
    const g = clean(T.buildGrant({ kind: 'grant', id: T.idFor('flightdeck', 'kg' + i), run: RUN, seen: [], by: 'person-avery', at: AT, subject: { person: who }, ops: ['add'], targets: [{ phase: 'draft' }], limits: { adds: 5 } }));
    const p = prop('kp' + i, add('One', { phase: 'draft' }), [g.id], who), q = V(r, [g, p]).requests[p.id];
    same(q.status, 'waiting', who);
  });
  const g = clean(T.buildGrant({ kind: 'grant', id: T.idFor('flightdeck', 'kg9'), run: RUN, seen: [], by: 'person-avery', at: AT, subject: { person: 'person-casey' }, ops: ['add'], targets: [{ phase: 'draft' }], limits: { adds: 5 } }));
  const p = prop('kp9', add('One', { phase: 'draft' }), [g.id], 'person-casey');
  same(V(r, [g, p]).requests[p.id].status, 'queued', 'an active person in people.json');
});
rule('A grant from someone who may not give one covers nothing', () => {
  const { r } = newRun(), g = grant('g4', ['add'], [{ phase: 'draft' }], 5, 'person-casey'), p1 = prop('d1', add('One', { phase: 'draft' }), [g.id]);
  const q = V(r, [g, p1]).requests[p1.id];
  same(q.status, 'waiting');
  assert.ok(/wasn't given by someone who may/.test(q.why), q.why);
});
rule('A decision accepts one exact consequence: when the request would now reopen an approval, it needs consent again', () => {
  const { r } = newRun(), map = R.mapOf(r), p = prop('e1', add('One', { phase: 'draft' }));
  const before = T.consequenceOf(r, map, p, V(r, [p]));
  same(before.reopens, []);
  const d = decide(p, 'accept', 'person-avery', before.fingerprint);
  same(st(r, [p, d], p.id).status, 'queued');
  r.gates['draft-confirm'] = { s: 'passed', by: 'person-avery', at: AT, approved: {} };
  const q = st(r, [p, d], p.id);
  same(q.status, 'waiting');
  assert.ok(/changed after it was approved/.test(q.why), q.why);
  same(T.consequenceOf(r, map, p, V(r, [p])).reopens, ['gate:draft-confirm']);
});
rule('An ended run takes no new work: its requests are kept as notices and its outcome never changes', () => {
  const { r } = newRun(), map = R.mapOf(r), p = prop('f1', add('One', { phase: 'draft' })), d = decide(p, 'accept', 'person-avery', T.consequenceOf(r, map, p, V(r, [p])).fingerprint);
  R.done(r, map, 'write', 'person-avery', AT); R.pass(r, map, 0, 'person-avery', AT); R.done(r, map, 'read', 'person-blake', AT); R.pass(r, map, 1, 'person-avery', AT);
  R.end(r, map, 'Completed', 'person-avery', 'Avery', AT);
  const q = st(r, [p, d], p.id);
  same(q.status, 'held');
  assert.ok(/has ended/.test(q.why));
  mark(r, [p, d]);
  same([R.gateStatus(r, map, 0), R.gateStatus(r, map, 1), r.ended.outcome], ['passed', 'passed', 'Completed']);
});

/* ---------- Approval holds ---------- */
function withTodo(target) {
  const { r } = newRun(), map = R.mapOf(r), p = prop('h1', add('Check the screenshots', target || { phase: 'draft' }), [], 'person-avery');
  const a = applied(p, '', { decision: p.id + '.status-w1-00000000' }); land(r, a);
  return { r, map, p, a, recs: [p, a] };
}
rule('An open to-do holds its phase\'s gate; checked off, the gate is ready again', () => {
  const { r, map, p, a, recs } = withTodo();
  R.done(r, map, 'write', 'person-avery', AT);
  mark(r, recs);
  same([R.gateStatus(r, map, 0), R.canPass(r, map, 0), R.canWaive(r, map, 0)], ['open', false, false]);
  assert.ok(/to-do/i.test(R.headline(r, map).text + R.headline(r, map).sub), JSON.stringify(R.headline(r, map)));
  const d = prop('h2', { op: 'done', todo: p.todo }, [a.id], 'person-avery'), ad = applied(d, a.id, { decision: d.id + '.status-w1-00000000' });
  land(r, ad); mark(r, recs.concat([d, ad]));
  same([R.gateStatus(r, map, 0), R.canPass(r, map, 0)], ['ready', true]);
});
rule('A to-do added after a gate passed or was waived sends it to review; checking it off never restores the approval', () => {
  ['passed', 'waived'].forEach((how) => {
    const { r } = newRun(), map = R.mapOf(r);
    R.done(r, map, 'write', 'person-avery', AT);
    T.markHolds([r], { records: [], people: PEOPLE });
    if (how === 'passed') R.pass(r, map, 0, 'person-avery', AT); else R.waive(r, map, 0, 'Agreed', 'person-avery', AT);
    same(R.gateStatus(r, map, 0), how);
    const p = prop('s1', add('Late finding', { phase: 'draft' }), [], 'person-avery'), a = applied(p, '', { decision: p.id + '.status-w1-00000000' });
    land(r, a); mark(r, [p, a]);
    same([R.gateStatus(r, map, 0), R.canPass(r, map, 0)], ['review', false], how);
    const d = prop('s2', { op: 'done', todo: p.todo }, [a.id], 'person-avery'), ad = applied(d, a.id, { decision: d.id + '.status-w1-00000000' });
    land(r, ad); mark(r, [p, a, d, ad]);
    same(R.gateStatus(r, map, 0), 'review', how + ': done doesn\'t restore it');
    assert.ok(R.canPass(r, map, 0), 'a person passes it again');
    R.pass(r, map, 0, 'person-avery', AT);
    same(r.gates['draft-confirm'].todos, { cut: [a.id] }, 'the approval records what it counted');
    mark(r, [p, a, d, ad]);
    same(R.gateStatus(r, map, 0), 'passed');
  });
});
rule('A to-do on a step holds that step\'s phase gate; a passed earlier gate stays passed', () => {
  const { r } = newRun(), map = R.mapOf(r);
  R.done(r, map, 'write', 'person-avery', AT); T.markHolds([r], { records: [], people: PEOPLE }); R.pass(r, map, 0, 'person-avery', AT); R.done(r, map, 'read', 'person-blake', AT);
  const p = prop('st1', add('Read the upgrade notes too', { step: 'read' }), [], 'person-avery'), a = applied(p, '', { decision: p.id + '.status-w1-00000000' });
  land(r, a); mark(r, [p, a]);
  same([R.gateStatus(r, map, 0), R.gateStatus(r, map, 1)], ['passed', 'open']);
  assert.throws(() => R.end(r, map, 'Completed', 'person-avery', 'Avery', AT), /Pass or waive every gate/);
});
rule('A dispute on a to-do holds its gate, and settling it never restores an approval made before it', () => {
  const { r, map, p, a } = withTodo();
  R.done(r, map, 'write', 'person-avery', AT);
  const d = prop('ds1', { op: 'done', todo: p.todo }, [a.id], 'person-avery'), ad = applied(d, a.id, { decision: d.id + '.status-w1-00000000' });
  land(r, ad); mark(r, [p, a, d, ad]); R.pass(r, map, 0, 'person-avery', AT);
  mark(r, [p, a, d, ad]); same(R.gateStatus(r, map, 0), 'passed');
  const re = prop('ds2', { op: 'reopen', todo: p.todo }, [ad.id]);
  const C = T.consequenceOf(r, map, re, V(r, [p, a, d, ad, re])).fingerprint;
  const yes = decide(re, 'accept', 'person-avery', C), no = decide(re, 'decline', 'person-blake', C);
  const recs = [p, a, d, ad, re, yes, no];
  mark(r, recs);
  same(V(r, recs).requests[re.id].status, 'disputed');
  same(R.gateStatus(r, map, 0), 'review', 'held while disputed');
  const settle = decide(re, 'decline', 'person-avery', C, T.seenFor(V(r, recs), [re.id], [re.id]).seen);
  mark(r, recs.concat([settle]));
  same(V(r, recs.concat([settle])).requests[re.id].status, 'declined');
  same(R.gateStatus(r, map, 0), 'review', 'settled, the approval still needs review');
});
rule('A contrary decision after an application landed keeps the work disputed and the gate held until settled', () => {
  const { r } = newRun(), map = R.mapOf(r), p = prop('bd1', add('Check', { phase: 'draft' }), [], 'person-avery');
  const a = applied(p, '', { decision: p.id + '.status-w1-00000000' }); land(r, a);
  R.done(r, map, 'write', 'person-avery', AT);
  const dn = prop('bd2', { op: 'done', todo: p.todo }, [a.id], 'person-avery'), C = T.consequenceOf(r, map, dn, V(r, [p, a, dn])).fingerprint;
  const yes = decide(dn, 'accept', 'person-avery', C), ad = applied(dn, a.id, { decision: yes.id }, [dn.id, a.id, yes.id]);
  land(r, ad); mark(r, [p, a, dn, yes, ad]); R.pass(r, map, 0, 'person-avery', AT);
  const no = decide(dn, 'decline', 'person-blake', C), recs = [p, a, dn, yes, ad, no], W = V(r, recs);
  same([W.requests[dn.id].status, W.byTodo[p.todo].disputed], ['applied', true]);
  mark(r, recs);
  same([R.gateStatus(r, map, 0), R.canPass(r, map, 0)], ['review', false]);
  const settle = decide(dn, 'accept', 'person-avery', C, [yes.id, no.id]);
  mark(r, recs.concat([settle]));
  same([V(r, recs.concat([settle])).byTodo[p.todo].disputed, R.gateStatus(r, map, 0), R.canPass(r, map, 0)], [false, 'review', true]);
});
rule('A dispute\'s hold on an approval stays when a participant later becomes ineligible', () => {
  const { r } = newRun(), map = R.mapOf(r), p = prop('jd1', add('Check', { phase: 'draft' }), [], 'person-avery');
  const a = applied(p, '', { decision: p.id + '.status-w1-00000000' }); land(r, a);
  R.done(r, map, 'write', 'person-avery', AT);
  const dn = prop('jd2', { op: 'done', todo: p.todo }, [a.id], 'person-avery'), ad = applied(dn, a.id, { decision: dn.id + '.status-w1-00000000' });
  land(r, ad); mark(r, [p, a, dn, ad]); R.pass(r, map, 0, 'person-avery', AT);
  const re = prop('jd3', { op: 'reopen', todo: p.todo }, [ad.id]), C = T.consequenceOf(r, map, re, V(r, [p, a, dn, ad, re])).fingerprint;
  const recs = [p, a, dn, ad, re, decide(re, 'accept', 'person-avery', C), decide(re, 'decline', 'person-blake', C)];
  mark(r, recs); same(R.gateStatus(r, map, 0), 'review', 'set-up');
  const OFF = { people: PEOPLE.people.map(x => x.id === 'person-blake' ? Object.assign({}, x, { inactive: true }) : x) };
  mark(r, recs, OFF);
  same(R.gateStatus(r, map, 0), 'review', 'still needs review');
  const g = grant('jg1', ['add'], [{ phase: 'review' }], 5), x = clean(T.buildGrant({ kind: 'revoke', id: T.idFor('flightdeck', 'jx1'), run: RUN, seen: [g.id], by: 'person-blake', at: AT, grant: g.id }));
  const pg = prop('jg2', add('By the tool', { phase: 'review' }), [g.id, x.id]), all = recs.concat([g, x, pg]);
  same([V(r, all).requests[pg.id].status, V(r, all, OFF).requests[pg.id].status], ['waiting', 'waiting'], 'a revoke never lapses when its maker becomes inactive');
});
rule('A loop item\'s to-do holds the loop\'s approval; work in a child run holds the child, so its result can\'t count', () => {
  const kid = ['---', 'process: validate-story', 'title: Validate a story', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
    '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
  const kp = publishMd(kid), procs = { 'validate-story': { latest: kp, all: [kp], clashes: [], broken: [] } }, procOf = (id) => procs[id] || null;
  const md = ['---', 'process: release-notes', 'title: Release', '---', '', '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
    '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
  const pp = publishMd(md, { childProcs: procs });
  const r = R.create(pp, { id: 'r-1', by: 'person-avery', session: 'w', now: AT, app: '4.0.0', pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) }), map = R.mapOf(r);
  r.steps.each = { s: 'done', by: 'person-avery', at: AT, loop: { by: 'person-avery', at: AT, onBehalf: '', records: [], summary: '0 in scope', counts: {}, items: [] } };
  same(R.answered(r, M.findStep(map, 'each').step), true, 'set-up: approved');
  const p = prop('l1', add('Security sign-off', { item: { loopStep: 'each', uid: 'jira:10101', attempt: 1 } }, md), [], 'person-avery'), a = applied(p, '', { decision: p.id + '.status-w1-00000000' });
  land(r, a); mark(r, [p, a]);
  same(R.answered(r, M.findStep(map, 'each').step), false, 'the item\'s open work holds the loop');
  assert.ok(r._todos.stale.loop.each, 'and the approval made before it needs review');
  const c = R.create(kp, { id: 'k1', by: 'person-avery', session: 'w', now: AT, app: '4.0.0', details: { issue: 'ABC-101' }, parent: { process: 'release-notes', id: 'r-1', step: 'each', item: { uid: 'jira:10101', key: 'ABC-101', attempt: 1 } } }), cm = R.mapOf(c);
  R.done(c, cm, 'verdict', 'person-avery', AT, { decision: 'cleared' });
  const CR = { process: 'validate-story', id: 'k1' };
  const cp = clean(T.buildProposal({ run: CR, id: T.idFor('flightdeck', 'k-1'), by: 'person-avery', seen: [], at: AT, body: { op: 'add', text: 'Child work', target: { phase: 'assess' }, placement: { beforeGate: 'assess-confirm' } } }));
  const cs = T.buildStatus({ kind: 'application', proposal: cp.id, run: CR, seen: [cp.id], by: 'person-avery', at: AT, authority: { decision: cp.id + '.status-w1-00000000' }, previous: '', effect: T.effectOf(cp), writer: 'rec', rev: rev() }), ca = clean(cs.file, cs.name);
  land(c, ca); T.markHolds([c, r], { records: [p, a, cp, ca], people: PEOPLE });
  same(R.canPass(c, cm, 0), false, 'the child can\'t pass its gate, so it can\'t complete with its result');
  assert.ok(!r._todos.loops.assess && !(c._todos.loops.each), 'each run holds only its own work');
});
rule('An optional loop\'s open item to-do holds its phase gate for waiving as for passing', () => {
  const kid = ['---', 'process: validate-story', 'title: Validate a story', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
    '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
  const kp = publishMd(kid), procs = { 'validate-story': { latest: kp, all: [kp], clashes: [], broken: [] } }, procOf = (id) => procs[id] || null;
  const md = ['---', 'process: release-notes', 'title: Release', '---', '', '## Stories · DO-CONFIRM {#stories}', '- [ ] {for.each} Validate every story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
    '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
  const pp = publishMd(md, { childProcs: procs });
  const r = R.create(pp, { id: 'r-1', by: 'person-avery', session: 'w', now: AT, app: '4.0.0', pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) }), map = R.mapOf(r);
  mark(r, []); same(R.canWaive(r, map, 0), true, 'set-up: waivable');
  const p = prop('hl1', add('Security sign-off', { item: { loopStep: 'each', uid: 'jira:10101', attempt: 1 } }, md), [], 'person-avery'), a = applied(p, '', { decision: p.id + '.status-w1-00000000' });
  land(r, a); mark(r, [p, a]);
  same([R.canWaive(r, map, 0), R.canPass(r, map, 0)], [false, false]);
  assert.throws(() => R.waive(r, map, 0, 'Not needed', 'person-avery', AT));
});
const LOOPMD = ['---', 'process: release-notes', 'title: Release', '---', '', '## Stories · DO-CONFIRM {#stories}', '- [ ] {for.each} Validate every story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
function loopRun() {
  const kid = ['---', 'process: validate-story', 'title: Validate a story', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
    '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
  const kp = publishMd(kid), procs = { 'validate-story': { latest: kp, all: [kp], clashes: [], broken: [] } }, procOf = (id) => procs[id] || null;
  const pp = publishMd(LOOPMD, { childProcs: procs });
  return R.create(pp, { id: 'r-1', by: 'person-avery', session: 'w', now: AT, app: '4.0.0', pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
}
rule('An item\'s work landing in a waived phase sends its gate to review, and resolving it never restores the waiver', () => {
  const r = loopRun(), map = R.mapOf(r);
  mark(r, []); R.waive(r, map, 0, 'Not this time', 'person-avery', AT);
  same(R.gateStatus(r, map, 0), 'waived', 'set-up');
  const it = { item: { loopStep: 'each', uid: 'jira:10101', attempt: 1 } };
  const p = prop('o1', add('Security sign-off', it, LOOPMD)), a = applied(p, '', { decision: p.id + '.status-w1-00000000' });
  R.todoLand(r, map, a, { who: 'person-avery', now: AT });
  same(r.gates['stories-confirm'].s, 'review', 'landing sends it to review, approved loop or not');
  const d = prop('o2', { op: 'done', todo: p.todo }, [a.id]), ad = applied(d, a.id, { decision: d.id + '.status-w1-00000001' });
  R.todoLand(r, map, ad, { who: 'person-avery', now: AT });
  r.gates['stories-confirm'] = { s: 'waived', by: 'person-avery', at: AT, reason: 'x', approved: {} };
  mark(r, [p, a, d, ad]);
  same(R.gateStatus(r, map, 0), 'review', 'a waiver made without counting the item\'s work stays in review');
});
rule('A to-do on a phase that isn\'t needed in this run still holds it until the work is resolved', () => {
  const md = ['---', 'process: release-notes', 'title: Release notes', 'context: kind:choice(minor|major)', '---', '',
    '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
    '## Upgrade · DO-CONFIRM {#upgrade}', '  only when ^kind is major', '- [!] {confirm} Write the upgrade guide {#guide}', ''].join('\n');
  const pub = publishMd(md), r = R.create(pub, { id: 'r-1', by: 'person-avery', session: 'w', now: AT, app: '4.0.0', details: { kind: 'minor' } }), map = R.mapOf(r);
  R.done(r, map, 'write', 'person-avery', AT); T.markHolds([r], { records: [], people: PEOPLE }); R.pass(r, map, 0, 'person-avery', AT);
  same(R.gateStatus(r, map, 1), 'skipped', 'set-up: not needed');
  const p = prop('sk1', add('Ask whether it is major', { phase: 'upgrade' }, md), [], 'person-avery'), a = applied(p, '', { decision: p.id + '.status-w1-00000000' });
  land(r, a); mark(r, [p, a]);
  same([R.gateStatus(r, map, 1), R.allGatesOk(r, map)], ['open', false]);
});
rule('A living run whose to-do records weren\'t read holds every approval; one with no records and no marker reads as before', () => {
  const { r } = newRun(), map = R.mapOf(r);
  R.done(r, map, 'write', 'person-avery', AT);
  const before = JSON.stringify(r);
  T.markHolds([r], { records: [], people: PEOPLE });
  same([JSON.stringify(r), R.gateStatus(r, map, 0)], [before, 'ready'], 'an unaffected run is untouched');
  r.living = { head: T.idFor('x', 'y') };
  delete r._todos;
  same(R.gateStatus(r, map, 0), 'open', 'not read: held');
  mark(r, []);
  assert.ok(r._todos.all.some(w => /isn't in the folder/.test(w)), JSON.stringify(r._todos.all));
  same(R.canPass(r, map, 0), false);
});

rule('Keeping a conflict copy never loses the run\'s to-dos: the copy\'s head is kept, or this one\'s when the copy has none, and the difference is listed', () => {
  const { r, map, a } = withTodo(), nameOf = (x) => x;
  const plainCopy = plain(r); delete plainCopy.living; delete plainCopy._todos; plainCopy.features = plainCopy.features.filter(f => f !== 'living-runs');
  same(R.compare(r, plainCopy, map, nameOf).some(l => /To-dos/.test(l)), true, 'listed');
  const kept = plain(r); delete kept._todos;
  R.adopt(kept, R.sanitize(plain(plainCopy)), 'person-avery', AT);
  same([kept.living, kept.features.indexOf('living-runs') >= 0], [{ head: a.id }, true], 'a copy without to-dos keeps this run\'s');
  const p2 = prop('cc2', add('Another', { phase: 'draft' }), [a.id], 'person-avery'), a2 = applied(p2, a.id, { decision: p2.id + '.status-w1-00000000' });
  const ahead = plain(r); land(ahead, a2);
  const cur = plain(r); delete cur._todos;
  R.adopt(cur, R.sanitize(ahead), 'person-avery', AT);
  same(cur.living, { head: a2.id }, 'the copy\'s head');
  const back = R.sanitize(plain(cur)); assert.ok(!back._unrunnable, back._unrunnable);
});
rule('Keeping a run/3 copy with landed to-dos over a run/2 makes this one a run/3 with its head, and the other way keeps this head', () => {
  const { r: cur } = newRun(MD), map = R.mapOf(cur), p = prop('ia1', add('One', { phase: 'draft' }), [], 'person-avery'), a = applied(p, '', { decision: p.id + '.status-w1-00000000' });
  const copy = plain(cur); R.todoLand(copy, map, a, { who: 'person-avery', now: AT, typesHash: 'abcdef12', app: '4.0.0' });
  const c1 = plain(cur);
  assert.throws(() => R.adopt(plain(cur), R.sanitize(plain(copy)), 'person-avery', AT, { typesHash: '12345678' }), /types/);
  R.adopt(c1, R.sanitize(plain(copy)), 'person-avery', AT, { typesHash: 'abcdef12' });
  same([c1.format, c1.living, c1.features.indexOf('living-runs') >= 0, c1.typesHash], ['preflight-run/3', { head: a.id }, true, 'abcdef12']);
  assert.ok(!R.sanitize(plain(c1))._unrunnable, R.sanitize(plain(c1))._unrunnable);
  const c2 = plain(copy); R.adopt(c2, R.sanitize(plain(cur)), 'person-avery', AT, { typesHash: 'abcdef12' });
  same([c2.format, c2.living], ['preflight-run/3', { head: a.id }]);
  assert.ok(!R.sanitize(plain(c2))._unrunnable);
});
/* ---------- Application (commit 3) ---------- */
rule('The recorder\'s next step for a request reads what is there first: landed is done, a prepared application that still fits is landed as it is, otherwise one is prepared on the head', () => {
  const { r } = newRun(), map = R.mapOf(r), p = prop('ap1', add('Check the links', { phase: 'draft' }), [], 'person-avery');
  const C = T.consequenceOf(r, map, p, V(r, [p])).fingerprint, d = decide(p, 'accept', 'person-avery', C), recs = [p, d];
  let W = V(r, recs), plan = T.applyPlan(r, W, W.requests[p.id]);
  assert.ok(plan.write, JSON.stringify(plan));
  same([plan.write.previous, plan.write.authority, plan.write.seen.indexOf(d.id) >= 0], ['', { decision: d.id }, true], 'on no head, by the decision, seeing it (and so the request)');
  const s = T.buildStatus(Object.assign({}, plan.write, { by: 'person-avery', at: AT, writer: 'rec', rev: rev() })), a = clean(s.file, s.name);
  W = V(r, recs.concat([a])); plan = T.applyPlan(r, W, W.requests[p.id]);
  same(plan.adopt && plan.adopt.id, a.id, 'prepared, not landed: landed as it is');
  R.todoLand(r, map, a, { who: 'person-avery', now: AT, typesHash: 'abcdef12', app: '4.0.0' });
  W = V(r, recs.concat([a])); plan = T.applyPlan(r, W, W.requests[p.id]);
  same(plan, { landed: a.id });
  const q = prop('ap2', add('Another', { phase: 'draft' }), [a.id], 'person-avery'), dq = decide(q, 'accept', 'person-blake', T.consequenceOf(r, map, q, V(r, recs.concat([a, q]))).fingerprint);
  const stale = applied(q, '', { decision: dq.id });
  W = V(r, recs.concat([a, q, dq, stale])); plan = T.applyPlan(r, W, W.requests[q.id]);
  same([!!plan.write, plan.write && plan.write.previous, plan.write && plan.write.seen.indexOf(stale.id) >= 0], [true, a.id, true], 'one prepared on another head is seen, and a new one written');
});
rule('Landing names the application, stamps the feature, makes a run/2 a run/3 and refuses one prepared on another head', () => {
  const { r: r2 } = newRun(MD), map = R.mapOf(r2), p = prop('ld1', add('One', { phase: 'draft' }), [], 'person-avery'), a = applied(p, '', { decision: p.id + '.status-w1-00000000' });
  same(r2.format, 'preflight-run/2');
  assert.throws(() => R.todoLand(r2, map, a, { who: 'person-avery', now: AT }), /version can't be read/, 'a run/2 needs its version\'s types fingerprint');
  R.todoLand(r2, map, a, { who: 'person-avery', now: AT, typesHash: 'abcdef12', app: '4.0.0' });
  same([r2.format, r2.features, r2.typesHash, r2.living], ['preflight-run/3', ['living-runs'], 'abcdef12', { head: a.id }]);
  assert.ok(!R.sanitize(plain(r2))._unrunnable, R.sanitize(plain(r2))._unrunnable);
  const pb = prop('ld2', add('Two', { phase: 'draft' }), [a.id], 'person-avery'), b = applied(pb, '', { decision: pb.id + '.status-w1-00000000' });
  assert.throws(() => R.todoLand(r2, map, b, { who: 'person-avery', now: AT }), /changed since/);
});

rule('A dispute among more than 50 prepared applications settles a page at a time and then lands once', () => {
  const { r } = newRun(), map = R.mapOf(r), p = prop('dd1', add('Wide', { phase: 'draft' }), [], 'person-avery');
  const C = T.consequenceOf(r, map, p, V(r, [p])).fingerprint, d = decide(p, 'accept', 'person-avery', C);
  const recs = [p, d];
  for (let i = 0; i < 51; i++) recs.push(applied(p, T.idFor('x', 'prev' + i), { decision: d.id }, [p.id, d.id]));
  let W = V(r, recs), q = W.requests[p.id];
  same([q.status, q.appOnly, q.via], ['disputed', true, { decision: d.id }]);
  let plan, rounds = 0;
  while ((plan = T.applyPlan(r, W, W.requests[p.id])).write && rounds < 5) {
    rounds++; assert.ok(plan.write.seen.length <= 50);
    const s = T.buildStatus(Object.assign({}, plan.write, { by: 'person-avery', at: AT, writer: 'rec', rev: rev() }));
    recs.push(clean(s.file, s.name)); W = V(r, recs);
    if (rounds === 1) same(W.requests[p.id].status, 'disputed', 'held until every one is covered');
  }
  assert.ok(plan.adopt, JSON.stringify(plan)); assert.ok(rounds >= 2 && rounds <= 3, rounds);
  same(W.requests[p.id].status, 'queued');
});
rule('Identical OneDrive copies reduce as one record under their id; different ones hold it', async () => {
  const { r } = newRun(), map = R.mapOf(r), body = add('Copy', { phase: 'draft' });
  const p = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'e1'), by: 'person-avery', seen: [], at: AT, body }), pr = clean(p);
  const C = T.consequenceOf(r, map, pr, V(r, [pr])).fingerprint;
  const s = T.buildStatus({ kind: 'decision', proposal: p.id, run: RUN, seen: [p.id], by: 'person-avery', at: AT, op: 'accept', consequence: C, writer: 'w1', rev: '0000abcd' });
  const base = s.name.slice(0, -5), files = { ['proposals/' + p.id + '.json']: T.text(p), ['proposals/' + p.id + '-LAPTOP.json']: T.text(p), ['proposals/' + s.name]: T.text(s.file), ['proposals/' + base + '-DESKTOP-7Q2.json']: T.text(s.file), ['proposals/' + base + ' (1).json']: T.text(s.file) };
  let d = await PF.repo.readPlans(memFs(files));
  same([d.todosUnread.length, d.todos.length], [0, 5], JSON.stringify(d.todosUnread));
  same(d.todos.map(x => x.id).sort(), [p.id, p.id, base, base, base].sort());
  same(V(r, d.todos).requests[p.id].status, 'queued');
  const other = Object.assign({}, p, { text: 'Different' });
  files['proposals/' + p.id + '-LAPTOP.json'] = T.text(other);
  d = await PF.repo.readPlans(memFs(files));
  const W = V(r, d.todos);
  same(W.requests[p.id].status, 'held');
  mark(r, d.todos); assert.ok(r._todos.all.some(w => /two different copies/.test(w)), JSON.stringify(r._todos.all));
  same(T.cleanFile(JSON.parse(T.text(p)), p.id + '-laptop.json').ok, false, 'a lowercase suffix is not a copy name');
});
rule('An unread or held record for the run stops preparing and landing', () => {
  const { r } = newRun(), map = R.mapOf(r), p = prop('g1', add('One', { phase: 'draft' }), [], 'person-avery');
  const d = decide(p, 'accept', 'person-avery', T.consequenceOf(r, map, p, V(r, [p])).fingerprint);
  const W = T.view(r, { records: [p, d], unread: [{ file: 'req-x.json', why: 'torn', run: null }], people: PEOPLE });
  assert.ok(T.applyPlan(r, W, W.requests[p.id]).skip, 'unread');
  const ghost = decide(p, 'decline', 'person-blake', 'aaaaaaaaaaaaaaaa', [p.id, T.idFor('x', 'missing')]);
  const W2 = V(r, [p, d, ghost]);
  assert.ok(W2.held.length, 'set-up: held');
  assert.ok(T.applyPlan(r, W2, W2.requests[p.id]).skip, 'held');
});
rule('A second application imported after one landed keeps the work disputed until a settling record, and is never replayed', () => {
  const { r } = newRun(), map = R.mapOf(r), p = prop('p1', add('Check', { phase: 'draft' })), a = applied(p, '', { decision: p.id + '.status-w1-00000000' });
  R.todoLand(r, map, a, { who: 'person-avery', now: AT, typesHash: r.typesHash });
  R.done(r, map, 'write', 'person-avery', AT);
  const dn = prop('p2', { op: 'done', todo: p.todo }, [a.id]), dd = dn.id + '.status-w1-00000000';
  const a1 = applied(dn, a.id, { decision: dd }, [dn.id, a.id]), a2 = applied(dn, 'req-x-000000000000000000000000', { decision: dd }, [dn.id]);
  R.todoLand(r, map, a1, { who: 'person-avery', now: AT });
  mark(r, [p, a, dn, a1]); R.pass(r, map, 0, 'person-avery', AT);
  const recs = [p, a, dn, a1, a2], W = V(r, recs);
  same([W.requests[dn.id].status, W.byTodo[p.todo].disputed, W.requests[dn.id].disputedIds.length > 0], ['applied', true, true]);
  mark(r, recs); same([R.gateStatus(r, map, 0), R.canPass(r, map, 0)], ['review', false]);
  const plan = T.applyPlan(r, W, W.requests[dn.id]);
  assert.ok(plan.settle, JSON.stringify(plan));
  const s = T.buildStatus(Object.assign({}, plan.settle, { by: 'person-avery', at: AT, writer: 'rec', rev: rev() })), st = clean(s.file, s.name);
  const W2 = V(r, recs.concat([st]));
  same([W2.requests[dn.id].status, W2.byTodo[p.todo].disputed, W2.chain, W2.todos[0].state], ['applied', false, [a.id, a1.id], 'done']);
  same(T.applyPlan(r, W2, W2.requests[dn.id]), { landed: a1.id });
});
/* ---------- The run file ---------- */
const reread = (r) => R.sanitize(JSON.parse(JSON.stringify(Object.assign({}, r, { _todos: undefined }))));
rule('A living run reads back with its head, its feature and its approvals\' cuts; a malformed marker is read-only', () => {
  const { r, map, p, a, recs } = withTodo();
  R.done(r, map, 'write', 'person-avery', AT);
  const d = prop('m2', { op: 'done', todo: p.todo }, [a.id], 'person-avery'), ad = applied(d, a.id, { decision: d.id + '.status-w1-00000000' });
  land(r, ad); mark(r, recs.concat([d, ad])); R.pass(r, map, 0, 'person-avery', AT);
  const back = reread(r);
  same([back._unrunnable, back.living, back.features.indexOf('living-runs') >= 0, back.gates['draft-confirm'].todos], [undefined, { head: ad.id }, true, { cut: [a.id] }]);
  const bad = (f, re) => { const o = plain(r); delete o._todos; f(o); const b = R.sanitize(o); assert.ok(b._unrunnable || b._needs || b.nameOnly, 'read-only: ' + JSON.stringify(Object.keys(b))); if (re) assert.ok(re.test(String(b._unrunnable || '')), b._unrunnable); };
  bad(o => { o.living = { head: 'not a record' }; });
  bad(o => { o.living = { head: ad.id, more: 1 }; });
  bad(o => { o.features = o.features.filter(x => x !== 'living-runs'); });
  bad(o => { delete o.living; });
  bad(o => { o.gates['draft-confirm'].todos = { cut: 'x' }; });
});
rule('A run with no to-dos reads and saves exactly as before', () => {
  const { r } = newRun(), map = R.mapOf(r);
  R.done(r, map, 'write', 'person-avery', AT); T.markHolds([r], { records: [], people: PEOPLE }); R.pass(r, map, 0, 'person-avery', AT);
  const once = reread(r), text = JSON.stringify(once);
  same([JSON.stringify(reread(once)) === text, 'todos' in r.gates['draft-confirm'], 'living' in r, '_todos' in r, once.features.indexOf('living-runs')], [true, false, false, false, -1]);
  const { r: r2 } = newRun(MD);
  same(r2.format, 'preflight-run/2', 'a version with no 2.0 feature still starts a run/2');
  R.done(r2, R.mapOf(r2), 'write', 'person-avery', AT);
  const once2 = reread(r2); same([JSON.stringify(reread(once2)), 'living' in once2], [JSON.stringify(once2), false]);
  const o = plain(r2); o.living = { head: T.idFor('x', 'y') };
  assert.ok(R.sanitize(o)._unrunnable, 'a run/2 never holds a living marker');
});

run();
