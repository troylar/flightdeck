// Living runs (4.0, docs/design.md 45.4), slice 5: checklist-linked to-dos. A to-do whose addition pins another checklist's
// exact publication and the results of it that settle it. "Run this checklist" makes an ordinary pinned plan with an id from
// the run, the to-do and its opening, started through the standalone start; the plan's started decision names the run. A
// completed run whose result is accepted supports a done (evidence: plan, run, answer identity, result), decided like any
// done and asked again before every write; nothing resolves on its own, and a later change to that run is said.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), T = PF.todos, D = PF.detours, R = PF.run, M = PF.map, P = PF.publish;
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const AT = '2026-11-10T09:00:00.000Z', LATER = '2026-11-10T11:00:00.000Z';
const PEOPLE = [{ id: 'person-morgan', name: 'Morgan' }, { id: 'person-avery', name: 'Avery' }, { id: 'person-blake', name: 'Blake' }];

const SMOKE = ['---', 'process: smoke-test', 'title: Smoke test', 'owner: person-avery', 'context: verdict:choice(pass|fail)', 'result: verdict', '---', '',
  '## Test · DO-CONFIRM {#test}', '- [!] {confirm} Run the smoke suite {#suite}', '- [!] {decide} Record the result {#call}', '  options: pass, fail', '  sets: verdict=decision', ''].join('\n');
const PLAIN = ['---', 'process: tidy-up', 'title: Tidy up', 'owner: person-avery', '---', '', '## Tidy {#tidy}', '- [ ] {confirm} Clear the desk {#desk}', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release readiness', 'owner: person-morgan', '---', '', '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
const exactOf = (files) => P.exactOf({ 'map.md': new Uint8Array(Buffer.from(files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(files['types.json'], 'utf8')) });
let seq = 0;
function publishMd(md, n) {
  const existing = []; for (let i = 1; i < (n || 1); i++) existing.push({ version: i });
  const b = P.build(md, { by: 'person-morgan', changes: 'x', now: AT, existing, rand: 'd' + String(++seq).padStart(7, '0'), app: '4.0.0' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const v = P.verify(b.folder, b.files, exactOf(b.files)); assert.ok(v.ok, v.why); v.folder = b.folder; v.files = b.files;
  return v;
}
const procOf3 = (pubs, broken) => { const i = P.index(pubs); return { latest: i.latest, all: i.all, clashes: i.clashes, broken: broken || [] }; };
let revs = 0; const rev = () => (++revs).toString(16).padStart(8, '0');

function world() {
  const kp = publishMd(SMOKE), pp = publishMd(PARENT), tp = publishMd(PLAIN);
  const r = R.create(pp, { id: 'r-41', title: 'Release 4.1', by: 'person-morgan', session: 'w', now: AT, app: '4.0.0' });
  r.recorder = { person: 'person-morgan' };
  const W = { r, kp, pp, tp, recs: [], unread: [], people: { people: PEOPLE }, runs: [], statuses: [], plans: [], unreadRuns: [] };
  W.ev = () => ({ runs: W.runs, unreadRuns: W.unreadRuns, plans: PF.repo.groupPlans(W.plans.map(plain).map((p) => Object.assign(p, { _file: p.id + '.json' })), W.statuses.map(plain), W.statusUnread || []) });
  W.push = (rec, name) => { rec._file = name || rec.id + '.json'; W.recs.push(rec); return rec; };
  W.view = () => T.view(W.r, { records: W.recs, unread: W.unread, people: W.people, evidence: W.ev() });
  W.prep = (body, by, extra) => T.prepare(W.r, Object.assign({ body, by: by || { person: 'person-morgan' }, key: 'k-' + rev(), records: W.recs, unread: W.unread, people: W.people, at: AT, app: '4.0.0', evidence: W.ev() }, extra || {}));
  W.ask = (body, by, extra) => { const Pp = W.prep(body, by, extra); assert.ok(!Pp.why, Pp.why); W.push(Pp.record, Pp.name); return Pp; };
  W.land = () => {
    for (let i = 0; i < 100; i++) {
      const V = W.view(), q = T.nextQueued(V);
      if (!q) return;
      const plan = T.applyPlan(W.r, V, q);
      if (plan.adopt) { W.r.living = { head: plan.adopt.id }; continue; }
      assert.ok(plan.write, JSON.stringify(plan));
      const s = T.buildStatus(Object.assign({}, plan.write, { by: 'person-morgan', at: AT, writer: 'rec', rev: rev(), app: '4.0.0' }));
      const fd = T.filed(s.name, s.file); assert.ok(!fd.why, fd.why);
      W.push(fd.record, s.name);
      W.r.living = { head: fd.record.id };
    }
  };
  W.pin = (accepts, pub) => { const Q = D.pinFor(procOf3([pub || W.kp]), (pub || W.kp).info.process || 'smoke-test', (pub || W.kp).folder, accepts); assert.ok(!Q.why, Q.why); return Q.checklist; };
  W.linked = (text, accepts) => { const Pp = W.ask({ op: 'add', text, target: { phase: 'ship' }, checklist: W.pin(accepts) }); W.land(); W.addFile = Pp.file; return W.view().byTodo[Pp.preview.todo]; };
  W.plan = (x) => { const F = D.planFor(W.r, x, W.kp, { by: 'person-avery', at: AT, app: '4.0.0' }); assert.ok(!F.why, F.why); if (!W.plans.some((p) => p.id === F.plan.id)) W.plans.push(F.plan); return F.plan; };
  W.start = (plan, id) => {
    const c = R.create(W.kp, { id, title: 'Smoke ' + id, by: 'person-avery', session: 'w2', now: AT, app: '4.0.0' });
    W.runs.push(c);
    const grouped = PF.repo.groupPlans([Object.assign(plain(plan), { _file: plan.id + '.json' })], [], []);
    W.statuses.push(PF.plans.decision(grouped[0], 'accepted', id, 'person-avery', AT, null, '4.0.0'));
    return c;
  };
  /* Reopened and ended again, as a correction would: a new decision time and a new end. */
  W.reend = (c, verdict, at) => { c.steps.call.at = at; c.steps.call.values.decision = verdict; c.details.verdict = verdict; c.ended = Object.assign({}, c.ended || { outcome: 'Completed' }, { outcome: 'Completed', at }); c.state = 'completed'; return c; };
  W.finish = (c, verdict, at) => { const m = R.mapOf(c); R.done(c, m, 'suite', 'person-avery', at || AT); R.done(c, m, 'call', 'person-avery', at || AT, { decision: verdict }); R.pass(c, m, 0, 'person-avery', at || AT); R.end(c, m, 'Completed', 'person-avery', 'Avery', at || AT); return c; };
  return W;
}
const tool = { tool: 'release-helper', version: '1.0' };

rule('An addition pins its checklist\'s exact version and the results it accepts; a pin that can\'t be made is refused, never guessed', () => {
  const W = world(), pin = W.pin(['pass']);
  same(pin, { process: 'smoke-test', folder: W.kp.folder, version: 1, mapHash: W.kp.info.mapHash, typesHash: W.kp.info.typesHash, accepts: ['pass'] });
  const x = W.linked('Smoke test the build', ['pass']);
  same(x.checklist, pin, 'the to-do carries its pin');
  assert.ok(/no checklist smoke-test/.test(D.pinFor(null, 'smoke-test', W.kp.folder).why));
  assert.ok(/no version v9-/.test(D.pinFor(procOf3([W.kp]), 'smoke-test', 'v9-zzzzzzzz').why));
  const broken = D.pinFor(procOf3([W.kp], [{ folder: 'v2-badbadba', why: 'its map doesn\'t match its fingerprint' }]), 'smoke-test', 'v2-badbadba');
  assert.ok(broken.held && /can't be used: its map doesn't match/.test(broken.why), broken.why);
  assert.ok(/never returns maybe/.test(D.pinFor(procOf3([W.kp]), 'smoke-test', W.kp.folder, ['maybe']).why));
  assert.ok(/has no result to accept/.test(D.pinFor(procOf3([W.tp]), 'tidy-up', W.tp.folder, ['pass']).why));
  assert.ok(/<process>@<version folder>/.test(D.pinFor(procOf3([W.kp]), 'Smoke Test', W.kp.folder).why));
  const big = Object.assign({}, pin, { accepts: Array.from({ length: 21 }, (_, i) => 'r' + i) });
  assert.ok(/1 to 20 results/.test(W.prep({ op: 'add', text: 'x', target: { phase: 'ship' }, checklist: big }).why), 'too many accepts: refused whole, never cut');
  assert.ok(/Only an addition/.test(W.prep({ op: 'done', todo: x.id, checklist: pin }).why));
});

rule('The evidence plan is one ordinary pinned plan per run, to-do and opening: made twice it is the same plan', () => {
  const W = world(), x = W.linked('Smoke test the build');
  const a = D.planFor(W.r, x, W.kp, { by: 'person-avery', at: AT, app: '4.0.0' }).plan, b = D.planFor(W.r, x, W.kp, { by: 'person-avery', at: AT, app: '4.0.0' }).plan;
  same(a, b);
  assert.ok(/^plan-ev-[0-9a-f]{24}$/.test(a.id), a.id);
  same([a.format, a.process, a.pin, a.from], [PF.plans.FORMAT2, 'smoke-test', { folder: W.kp.folder, version: 1, mapHash: W.kp.info.mapHash, typesHash: W.kp.info.typesHash }, 'release-readiness/r-41']);
  const c = PF.plans.clean(plain(a), a.id + '.json');
  assert.ok(c.ok && !c.why, JSON.stringify(c));
  assert.strictEqual(a.id, D.planId({ process: 'release-readiness', id: 'r-41' }, x.id, PF.facts.incarnationOf(x)));
  const other = publishMd(SMOKE.replace('Run the smoke suite', 'Run the whole suite'), 2);
  const F = D.planFor(W.r, x, other, {});
  assert.ok(F.held && /isn't in this folder as it was pinned/.test(F.why), 'another version is never used for a pin');
  const plainTodo = (() => { const Pp = W.ask({ op: 'add', text: 'Just a to-do', target: { phase: 'ship' } }); W.land(); return W.view().byTodo[Pp.preview.todo]; })();
  assert.ok(/isn't linked/.test(D.planFor(W.r, plainTodo, W.kp, {}).why));
});

rule('Evidence is a started run of the plan: not started, not completed and competing starts are each said, and a run is chosen, never guessed', () => {
  const W = world(), x = W.linked('Smoke test the build');
  assert.ok(/No run of smoke-test was started/.test(D.evidenceFor(W.r, x, null, W.ev()).why));
  const plan = W.plan(x);
  assert.ok(/No run of smoke-test was started|Say which run/.test(D.evidenceFor(W.r, x, null, W.ev()).why));
  const c1 = W.start(plan, 'k1');
  assert.ok(/hasn't completed yet/.test(D.evidenceFor(W.r, x, 'k1', W.ev()).why));
  W.finish(c1, 'pass');
  const E = D.evidenceFor(W.r, x, 'k1', W.ev());
  same(E.evidence, { plan: plan.id, run: { process: 'smoke-test', id: 'k1' }, answer: R.answerOf(c1), result: 'pass' });
  assert.ok(/Its run is k1/.test(D.evidenceFor(W.r, x, null, W.ev()).why), 'a run is named even when there is one');
  W.finish(W.start(plan, 'k2'), 'pass');
  assert.ok(/More than one run was started for it \(k1, k2\)/.test(D.evidenceFor(W.r, x, null, W.ev()).why), 'competing starts need a choice');
  assert.strictEqual(D.evidenceFor(W.r, x, 'k2', W.ev()).evidence.run.id, 'k2', 'either can be chosen');
  assert.ok(/wasn't started for this to-do/.test(D.evidenceFor(W.r, x, 'k9', W.ev()).why));
  const ab = W.start(plan, 'k3'), m = R.mapOf(ab); R.end(ab, m, 'Cancelled', 'person-avery', 'Avery', AT);
  assert.ok(/ended cancelled, not completed/.test(D.evidenceFor(W.r, x, 'k3', W.ev()).why));
});

rule('A result the to-do doesn\'t accept is refused; any completed run counts when it names none', () => {
  const W = world(), x = W.linked('Smoke test the build', ['pass']), plan = W.plan(x);
  W.finish(W.start(plan, 'k1'), 'fail');
  assert.ok(/returned fail; this to-do accepts pass/.test(D.evidenceFor(W.r, x, 'k1', W.ev()).why));
  assert.ok(/accepts pass/.test(W.prep({ op: 'done', todo: x.id, evidence: { plan: plan.id, run: { process: 'smoke-test', id: 'k1' }, answer: R.answerOf(W.runs[0]), result: 'fail' } }, tool).preview.why), 'asked anyway, it holds');
  const W2 = world(), y = W2.linked('Smoke test the build'), p2 = W2.plan(y);
  W2.finish(W2.start(p2, 'k1'), 'fail');
  assert.strictEqual(D.evidenceFor(W2.r, y, 'k1', W2.ev()).evidence.result, 'fail');
});

rule('A tool\'s done on evidence is one request by what it rests on, and waits for a person: nothing resolves on its own', () => {
  const W = world(), x = W.linked('Smoke test the build', ['pass']), plan = W.plan(x), c = W.finish(W.start(plan, 'k1'), 'pass');
  const ev = D.evidenceFor(W.r, x, 'k1', W.ev()).evidence;
  const A = W.prep({ op: 'done', todo: x.id, evidence: ev }, tool), B = W.prep({ op: 'done', todo: x.id, evidence: ev }, { tool: 'other-bot', version: '2.0' });
  assert.ok(!A.why, A.why);
  same([A.id, A.id], [D.requestId(x.id, ev), B.id], 'the same from any tool');
  assert.strictEqual(A.file.key, D.requestKey(x.id, ev));
  W.push(A.record, A.name);
  assert.strictEqual(W.view().requests[A.id].status, 'waiting', W.view().requests[A.id].why);
  W.land();
  assert.strictEqual(W.view().byTodo[x.id].state, 'open', 'never checked off by itself');
  const it = T.inbox([W.r], { records: W.recs, people: W.people, me: 'person-morgan', evidence: W.ev() }).filter((y) => y.id === A.id)[0];
  assert.ok(it && /on the run smoke-test\/k1 \(pass\)/.test(it.words), it && it.words);
  const d = T.decide(W.r, { request: A.id, op: 'accept', by: 'person-morgan', shown: it.consequence.fingerprint, records: W.recs, people: W.people, at: AT, writer: 'w1', rev: rev(), evidence: W.ev() });
  assert.ok(!d.why, d.why); W.push(d.record, d.name);
  W.land();
  const done = W.view().byTodo[x.id];
  same([done.state, done.evidence], ['done', ev]);
  assert.strictEqual(D.provenance(W.r, done, W.ev()), '', 'nothing to say while the run stands');
  assert.ok(c);
});

rule('A done whose run changed since it was asked holds, even when the run is changed back to the same result', () => {
  const W = world(), x = W.linked('Smoke test the build', ['pass']), plan = W.plan(x), c = W.finish(W.start(plan, 'k1'), 'pass');
  const ev = D.evidenceFor(W.r, x, 'k1', W.ev()).evidence, A = W.ask({ op: 'done', todo: x.id, evidence: ev }, tool);
  W.reend(c, 'fail', LATER);
  assert.ok(/returned fail/.test(W.view().requests[A.id].why), W.view().requests[A.id].why);
  W.reend(c, 'pass', '2026-11-10T12:00:00.000Z');
  const q = W.view().requests[A.id];
  same([q.status, /not as it was when this was asked/.test(q.why)], ['held', true], q.why);
  assert.ok(T.inbox([W.r], { records: W.recs, people: W.people, me: 'person-morgan', evidence: W.ev() }).every((y) => y.id !== A.id), 'never offered to decide');
  const fresh = D.evidenceFor(W.r, x, 'k1', W.ev()).evidence;
  assert.notStrictEqual(D.requestId(x.id, fresh), A.id, 'asked again on the run as it is now, it is a new request');
});

rule('Evidence that can\'t be read holds: an unread run, an unread plan decision, copies that differ, no evidence given', () => {
  const W = world(), x = W.linked('Smoke test the build'), plan = W.plan(x); W.finish(W.start(plan, 'k1'), 'pass');
  const ev = D.evidenceFor(W.r, x, 'k1', W.ev()).evidence, A = W.ask({ op: 'done', todo: x.id, evidence: ev }, tool);
  const noEv = T.view(W.r, { records: W.recs, unread: W.unread, people: W.people }).requests[A.id];
  same([noEv.status, /can't be checked here/.test(noEv.why)], ['held', true], noEv.why);
  W.unreadRuns = ['smoke-test/k1'];
  assert.ok(/can't be read now/.test(W.view().requests[A.id].why));
  W.unreadRuns = [];
  W.statusUnread = [{ _file: plan.id + '.status-x.json', path: 'proposals/' + plan.id + '.status-x.json', kind: 'unreadable' }];
  assert.ok(/which run it started isn't known/.test(W.view().requests[A.id].why));
  W.statusUnread = [];
  W.runs[0]._unrunnable = 'its checklist is missing';
  assert.ok(/can only be read here/.test(W.view().requests[A.id].why));
});

/* OC: the whole pin, field by field: the plan's pin and the version read fresh against the to-do's, whether or not the run
   carries the field (a preflight-run/2 has no typesHash); and every OneDrive copy name the loader knows is its plan's. */
rule('The evidence verdict compares the whole pin, plan and fresh version, for runs with or without typesHash, and holds every copy of the plan', () => {
  for (const f of ['mapHash', 'typesHash', 'version', 'folder', 'process']) {
    const W = world(), x = W.linked('Smoke test the build'), plan = W.plan(x); W.finish(W.start(plan, 'k1'), 'pass');
    assert.ok(D.evidenceFor(W.r, x, 'k1', W.ev()).evidence, 'set-up: evidence');
    if (f === 'process') W.plans[0].process = 'release-readiness'; else W.plans[0].pin[f] = f === 'version' ? 99 : f === 'folder' ? 'v2-abcd1234' : '0badc0de';
    const E = D.evidenceFor(W.r, x, 'k1', W.ev());
    assert.ok(E.why && E.held, 'plan pin ' + f + ': ' + E.why);
    assert.ok(D.planProblems(W.r, [x], W.ev()).some(q => q.kind === 'unusable'), 'plan pin ' + f + ': a problem for every reader');
  }
  for (const legacy of [false, true]) {
    const W = world(), x = W.linked('Smoke test the build'), plan = W.plan(x), c = W.finish(W.start(plan, 'k1'), 'pass');
    if (legacy) delete c.typesHash;
    const ev = W.ev(); ev.pubs = { 'smoke-test/k1': { folder: W.kp.folder, version: W.kp.info.version, mapHash: W.kp.info.mapHash, typesHash: W.kp.info.typesHash } };
    assert.ok(D.evidenceFor(W.r, x, 'k1', ev).evidence, (legacy ? 'legacy' : 'run/3') + ': set-up: evidence');
    ev.pubs['smoke-test/k1'].typesHash = '0badc0de';
    const E = D.evidenceFor(W.r, x, 'k1', ev);
    assert.ok(E.why && E.held, (legacy ? 'legacy' : 'run/3') + ': the version read now has other step types: ' + E.why);
  }
  for (const name of [' (1).json', '-LAPTOP.json', ' (2).json']) {
    const W = world(), x = W.linked('Smoke test the build'), plan = W.plan(x); W.finish(W.start(plan, 'k1'), 'pass');
    const ev = W.ev(); ev.holds = [{ path: 'proposals/' + plan.id + name, _file: plan.id + name, kind: 'unreadable' }];
    assert.ok(D.planHeld(ev, plan.id).length, name + ': a copy of the plan held');
    assert.ok(D.evidenceFor(W.r, x, 'k1', ev).held, name + ': no evidence past it');
  }
});

rule('A reopened to-do takes a new plan; evidence asked on its earlier opening holds; and a change to its run after it was checked off is said, never undone', () => {
  const W = world(), x = W.linked('Smoke test the build'), plan = W.plan(x), c = W.finish(W.start(plan, 'k1'), 'pass');
  const ev = D.evidenceFor(W.r, x, 'k1', W.ev()).evidence;
  W.ask({ op: 'done', todo: x.id, evidence: ev }); W.land();
  assert.strictEqual(W.view().byTodo[x.id].state, 'done', 'a decider\'s own Accept checks it off');
  const ended = c.ended; delete c.ended; c.state = 'running';
  let done = W.view().byTodo[x.id];
  assert.ok(/was reopened since/.test(D.provenance(W.r, done, W.ev())));
  c.ended = ended; W.reend(c, 'fail', LATER); done = W.view().byTodo[x.id];
  assert.ok(/changed since: it returned fail \(was pass\)/.test(D.provenance(W.r, done, W.ev())), D.provenance(W.r, done, W.ev()));
  assert.strictEqual(done.state, 'done', 'never reopened by itself');
  W.ask({ op: 'reopen', todo: x.id, reason: 'The smoke test failed after all' }); W.land();
  const x2 = W.view().byTodo[x.id];
  same([x2.state, x2.evidence], ['open', null]);
  assert.notStrictEqual(D.planOf(W.r, x2), plan.id, 'a new opening, a new plan');
  assert.ok(/earlier opening/.test(D.evidenceWhy(W.r, { evidence: ev }, x2, W.ev())), 'evidence of its earlier opening no longer applies');
  assert.ok(/No run of smoke-test was started for this to-do/.test(D.evidenceFor(W.r, x2, 'k1', W.ev()).why), 'its earlier run doesn\'t count for the new opening');
});

rule('The run a plan started leads back to the run and to-do it was started for', () => {
  const W = world(), x = W.linked('Smoke test the build'), plan = W.plan(x), c = W.start(plan, 'k1');
  same(D.returnOf(c, W.ev().plans), { from: 'release-readiness/r-41', plan: plan.id });
  assert.strictEqual(D.returnOf(W.r, W.ev().plans), null);
});

rule('Records: a checklist only on an addition, evidence only on a done and never with support, neither on a spread; the id is the evidence\'s', () => {
  const W = world(), x = W.linked('Smoke test the build'), plan = W.plan(x); W.finish(W.start(plan, 'k1'), 'pass');
  const ev = D.evidenceFor(W.r, x, 'k1', W.ev()).evidence, A = W.prep({ op: 'done', todo: x.id, evidence: ev }, tool);
  const f = plain(A.file), ok = T.cleanFile(plain(f), A.name);
  assert.ok(ok.ok, ok.why);
  same(ok.record.evidence, ev);
  const bad = (mut, re) => { const g = plain(f); mut(g); const c = T.cleanFile(g, g.id + '.json'); assert.ok(!c.ok && re.test(c.why), c.why); };
  bad((g) => { g.evidence.result = 'fail'; }, /id isn't the one its to-do and evidence give/);
  bad((g) => { g.key = 'ev-' + '0'.repeat(24); }, /key isn't/);
  bad((g) => { g.evidence.extra = 1; }, /"evidence" has "extra"/);
  bad((g) => { g.checklist = x.checklist; }, /Only an addition has "checklist"/);
  bad((g) => { g.support = { x: 1 }; }, /support/);
  const af = W.addFile, add = T.cleanFile(plain(af), af.id + '.json');
  assert.ok(add.ok && add.record.checklist, 'an addition keeps its checklist');
  const sp = T.cleanFile(Object.assign(plain(af), { op: 'spread-add' }), af.id + '.json');
  assert.ok(!sp.ok);
});

/* CA: a checklist-linked to-do (a detour) that supplies "_supplied" of any JSON type is refused by name with the core
   reader's reason; proposals/ never fails for it. */
rule('A detour record that supplies "_supplied" of any JSON type is refused by name, never failing proposals/', async () => {
  const W = world(); W.linked('Run the smoke test', ['pass']);
  const af = W.addFile, name = af.id + '.json';
  for (const v of ['forged', 7, true, null, {}, [], ['extra'], { order: 'forged' }, { order: 7 }, { order: {} }, { order: ['extra'] }, { order: null }, { _file: 'x.json' }]) for (const lead of [false, true]) {
    const o = Object.assign(lead ? { _bytes: 3 } : {}, plain(af), { _supplied: v }), raw = Object.create(null);
    Object.keys(o).forEach((x) => { raw[x] = o[x]; });
    const core = T.cleanFile(raw, name), tag = JSON.stringify(v) + (lead ? ' after _bytes' : '');
    assert.ok(!core.ok, tag);
    const m = new PF.fs.MemoryFS('ca-' + Math.random(), null); m.files['proposals/' + name] = { t: JSON.stringify(o), m: 1 };
    const d = await PF.repo.readPlans(m), u = d.todosUnread.filter(x => x.file === name)[0];
    assert.ok(u && u.why === core.why, tag + ': ' + JSON.stringify(u) + ' vs ' + core.why);
    const all = await PF.repo.loadAll(m, {});
    assert.ok(!('proposals' in (all.failed || {})), tag + ': ' + JSON.stringify(all.failed));
  }
});

run();
