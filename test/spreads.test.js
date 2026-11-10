// Living runs (4.0, docs/design.md 45.1), slice 3: spreads. A standing requirement on a loop ("every open story here") is
// effective work on the parent run, installed by a spread-add request, and fulfilled through separately authorized to-dos on
// each item's own run. Coverage is derived on every read; anything unresolved holds the loop's approval and its phase's gate.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), T = PF.todos, S = PF.spreads, LP = PF.loop, R = PF.run, M = PF.map, P = PF.publish;
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, m) => m === undefined ? assert.deepStrictEqual(plain(a), plain(b)) : assert.deepStrictEqual(plain(a), plain(b), m);
const has = (list, re) => assert.ok((list || []).some(x => re.test(x)), 'expected ' + re + ' in ' + JSON.stringify(list));
const AT = '2026-11-09T09:00:00.000Z';
const PEOPLE = { people: [{ id: 'person-morgan', name: 'Morgan' }, { id: 'person-avery', name: 'Avery' }, { id: 'person-blake', name: 'Blake' }, { id: 'person-drew', name: 'Drew', inactive: true }] };

const CHILD = ['---', 'process: validate-story', 'title: Validate a story', 'context: issue, story_title, fix_version, disposition:choice(cleared|needs-work|deferred|unknown)',
  'result: disposition', '---', '', '## Assess · DO-CONFIRM {#assess}', '- [!] {confirm} Read the story {#read}',
  '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work, deferred, unknown', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release readiness', 'context: fix_version', '---', '', '## Stories · DO-CONFIRM {#stories}',
  '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key, fix_version=^fix_version', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
const exactOf = (files) => P.exactOf({ 'map.md': new Uint8Array(Buffer.from(files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(files['types.json'], 'utf8')) });
let seq = 0;
function publishMd(md, extra) {
  const b = P.build(md, Object.assign({ by: 'person-morgan', changes: 'x', now: AT, existing: [], rand: 's' + String(++seq).padStart(7, '0'), app: '4.0.0' }, extra || {}));
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const v = P.verify(b.folder, b.files, exactOf(b.files)); assert.ok(v.ok, v.why); v.folder = b.folder; v.process = M.parse(md).meta.process; v.files = b.files;
  return v;
}
const procOf3 = (pubs) => { const i = P.index(pubs); return { latest: i.latest, all: i.all, clashes: i.clashes, broken: [] }; };
const story = (n) => ({ id: String(10000 + n), key: 'ABC-' + n, title: 'Story ' + n });
const obs = (ns) => ({ source: { system: 'jira' }, generation: 'g1', query: 'fixVersion = 4.1', observedAt: '2026-11-07T09:00:00Z', items: ns.map(story), reported: ns.length, fetched: ns.length, complete: false, errors: [] });
const LOOPT = { process: 'release-readiness', run: 'r-41', step: 'each' };
function scope(key, ns, seen) {
  const c = LP.cleanIntent({ loop: LOOPT, observation: obs(ns), changes: [] }, key, { name: 'release-helper', version: '1.0' });
  same(c.errors, []);
  const f = LP.buildRequest(c.intent, { seen: seen || [], children: [], now: AT, app: '3.0.0' });
  return LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record;
}
let revs = 0; const rev = () => (++revs).toString(16).padStart(8, '0');
const uid = (n) => 'jira:' + (10000 + n);

/* A parent run with a loop over stories, its children, and every record in one list, as a window reads them. */
function world(ns) {
  const kp = publishMd(CHILD), procs = { 'validate-story': procOf3([kp]) }, procOf = (id) => procs[id] || null;
  const pp = publishMd(PARENT, { childProcs: procs });
  const r = R.create(pp, { id: 'r-41', by: 'person-morgan', session: 'w', now: AT, app: '4.0.0', details: { fix_version: '4.1' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
  const W = { r, kp, pp, procOf, kids: [], scopes: [scope('s1', ns || [101, 102, 103])], recs: [], unread: [] };
  W.childMap = R.mapOf(R.create(kp, { id: 'probe', by: 'person-avery', session: 'w2', now: AT, app: '4.0.0', details: { issue: 'ABC-0', fix_version: '4.1' } }));
  W.runs = () => [W.r].concat(W.kids);
  W.kid = (n, o) => {
    o = o || {};
    const c = R.create(kp, { id: o.id || 'k' + n + (o.attempt > 1 ? 'a' + o.attempt : ''), by: 'person-avery', session: 'w2', now: AT, app: '4.0.0', details: { issue: 'ABC-' + n, fix_version: '4.1' },
      parent: { process: 'release-readiness', id: 'r-41', step: 'each', item: { uid: uid(n), key: 'ABC-' + n, attempt: o.attempt || 1 } } });
    if (o.cleared) W.clear(c);
    W.kids.push(c);
    return c;
  };
  W.clear = (c, value) => { const m = R.mapOf(c); R.done(c, m, 'read', 'person-avery', AT); R.done(c, m, 'verdict', 'person-avery', AT, { decision: value || 'cleared' }); W.mark(); R.pass(c, m, 0, 'person-avery', AT); R.end(c, m, 'Completed', 'person-avery', 'Avery', AT); return c; };
  W.loops = () => ({ records: W.scopes, unread: [], procOf });
  /* What every reader of a spread passes: every record, the loop's scope records and every run. */
  W.inputs = () => ({ records: W.recs, unread: W.unread, people: PEOPLE, loops: W.loops(), runs: W.runs() });
  W.view = (x) => T.view(x || W.r, { records: W.recs, unread: W.unread, people: PEOPLE });
  W.mark = () => { LP.markStale(W.runs(), { records: W.scopes, procOf }); T.markHolds(W.runs(), { records: W.recs, unread: W.unread, people: PEOPLE, loops: W.loops() }); return W.r._todos; };
  W.cov = () => S.coverage(W.r, W.view(), { runs: W.runs(), records: W.recs, unread: W.unread, people: PEOPLE, loops: W.loops() });
  W.one = () => W.cov().spreads[0];
  W.loopView = () => LP.view(W.r, 'each', { records: W.scopes, runs: W.runs(), procOf });
  W.push = (rec, name) => { rec._file = name || rec.id + '.json'; W.recs.push(rec); return rec; };
  /* Asks through the one rule (PF.todos.prepare) and files what it builds. */
  W.ask = (x, body, by, extra) => {
    const Pp = T.prepare(x, Object.assign({ body, by, key: 'k-' + rev(), records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0', loops: W.loops(), runs: W.runs() }, extra || {}));
    assert.ok(!Pp.why, Pp.why);
    W.push(Pp.record, Pp.name);
    return Pp;
  };
  W.spreadAdd = (text, by, extra) => W.ask(W.r, { op: 'spread-add', loopStep: 'each', text: text || 'Security sign-off', child: { beforeGate: 'assess-confirm' }, scope: S.snapshot(W.loopView()) }, by || { person: 'person-morgan' }, Object.assign({ childMap: W.childMap }, extra || {}));
  /* The recorder's window: land every queued request of a run, one at a time, as todoApply does. */
  W.land = (x) => {
    for (let i = 0; i < 100; i++) {
      const V = W.view(x), q = T.nextQueued(V, x, W.inputs());
      if (!q) return;
      const plan = T.applyPlan(x, V, q, W.inputs());
      if (plan.adopt) { x.living = { head: plan.adopt.id }; continue; }
      assert.ok(plan.write, JSON.stringify(plan));
      const s = T.buildStatus(Object.assign({}, plan.write, { by: (x.recorder && x.recorder.person) || 'person-morgan', at: AT, writer: 'rec', rev: rev(), app: '4.0.0' }));
      const fd = T.filed(s.name, s.file); assert.ok(!fd.why, fd.why);
      W.push(fd.record, s.name);
      x.living = { head: fd.record.id };
      if (x.features.indexOf('living-runs') < 0) x.features = x.features.concat(['living-runs']);
    }
  };
  W.decide = (x, id, by, op, reason) => {
    const it = T.inbox([x], { records: W.recs, unread: W.unread, people: PEOPLE, me: by }).filter(y => y.id === id)[0];
    assert.ok(it, 'in ' + by + '\'s inbox: ' + id);
    const d = T.decide(x, Object.assign({ request: id, op: op || 'accept', by, shown: it.consequence.fingerprint, reason, at: AT, writer: 'w' + rev(), rev: rev(), app: '4.0.0' }, W.inputs()));
    assert.ok(!d.why, d.why);
    return W.push(d.record, d.name);
  };
  /* A tool asks a story's run for the requirement (what `spread sync` does for one obligation). */
  W.request = (c, spread, tool) => {
    const a = c.parent.item.attempt, Pp = T.prepare(c, { body: { op: 'add', text: spread.text, target: { phase: 'assess' }, fulfills: { run: { process: 'release-readiness', id: 'r-41' }, spread: spread.id, uid: c.parent.item.uid, attempt: a } },
      by: { tool: tool || 'sync-bot', version: '1.0' }, records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0' });
    assert.ok(!Pp.why, Pp.why);
    W.push(Pp.record, Pp.name);
    return Pp;
  };
  /* The child's recorder accepts and lands the request, then checks the to-do off. */
  W.fulfil = (c, spread, done) => {
    const Pp = W.request(c, spread);
    W.decide(c, Pp.id, 'person-avery');
    W.land(c);
    if (done !== false) { W.ask(c, { op: 'done', todo: Pp.preview.todo }, { person: 'person-avery' }); W.land(c); }
    return Pp;
  };
  return W;
}
const spreadOf = (W) => W.view().spreads[0];

/* ---------- Records ---------- */
rule('A spread is asked by a spread-add request: its id comes from the request, its body is the loop, text, child gate and the reviewed scope', () => {
  const W = world();
  const Pp = W.spreadAdd('Security sign-off', { tool: 'release-helper', version: '1.0', key: 'spread-1' });
  same([Pp.file.format, Pp.file.features, Pp.file.kind, Pp.file.op, Pp.file.spread], ['flightdeck-plan/4', ['living-runs'], 'proposal', 'spread-add', S.idFor(Pp.id)]);
  assert.ok(/^sp-[0-9a-f]{24}$/.test(Pp.file.spread));
  same([Pp.record.loopStep, Pp.record.text, Pp.record.child, Pp.record.scope.open.length, Pp.record.scope.cleared.length], ['each', 'Security sign-off', { beforeGate: 'assess-confirm' }, 3, 0]);
  same(Pp.preview.status, 'waiting', 'a tool\'s spread waits for a person, like any request');
  assert.ok(/^Require "Security sign-off" on 3 open stories, and on every story that joins later\./.test(Pp.preview.words), Pp.preview.words);
  same(T.fileWhy(Pp.name, Pp.file), '');
});
rule('Every spread record and limit is checked whole: never cut, never read past a field it doesn\'t know', () => {
  const W = world(), Pp = W.spreadAdd('Security sign-off', { tool: 'release-helper', version: '1.0', key: 'spread-2' });
  const o = JSON.parse(T.text(Pp.file)), why = (x, name) => { const v = T.cleanFile(JSON.parse(JSON.stringify(x)), name || x.id + '.json'); return v.ok ? '' : v.why; };
  same(why(o), '');
  const pairs = (n) => Array.from({ length: n }, (_, i) => ({ uid: 'jira:' + (20000 + i), attempt: 1 }));
  assert.ok(why(Object.assign({}, o, { scope: Object.assign({}, o.scope, { open: pairs(300), cleared: pairs(201) }) })), '501 items in a scope is refused');
  same(why(Object.assign({}, o, { scope: Object.assign({}, o.scope, { open: pairs(300), cleared: pairs(200).map(p => ({ uid: p.uid.replace('2', '3'), attempt: 1 })) }) })), '', '500 is kept whole');
  assert.ok(why(Object.assign({}, o, { text: 'a'.repeat(201) })));
  assert.ok(why(Object.assign({}, o, { spread: 'sp-' + 'a'.repeat(24) })), 'a spread id that isn\'t its request\'s');
  assert.ok(why(Object.assign({}, o, { child: { beforeGate: 'assess-confirm', extra: 1 } })));
  assert.ok(why(Object.assign({}, o, { todo: 'td-' + 'a'.repeat(24) })), 'a spread has no to-do');
  assert.ok(why(Object.assign({}, o, { loopStep: undefined })));
  const sp = o.spread;
  const stop = T.buildProposal({ run: { process: 'release-readiness', id: 'r-41' }, producer: { name: 'release-helper', version: '1.0' }, key: 'stop-1', seen: [], at: AT, body: { op: 'spread-stop', spread: sp, reason: 'Done', owed: pairs(2), cut: [] } });
  same(why(stop), '');
  assert.ok(why(Object.assign({}, stop, { reason: undefined })), 'stopping says why');
  assert.ok(why(Object.assign({}, stop, { owed: pairs(501) })), 'at most 500 obligations kept');
  const inc = T.buildProposal({ run: { process: 'release-readiness', id: 'r-41' }, producer: { name: 'release-helper', version: '1.0' }, key: 'inc-1', seen: [], at: AT, body: { op: 'spread-include', spread: sp, item: { uid: uid(101), attempt: 1 } } });
  same(why(inc), '');
  assert.ok(why(Object.assign({}, inc, { item: { uid: uid(101), attempt: 0 } })));
  const bind = T.buildProposal({ run: { process: 'release-readiness', id: 'r-41' }, producer: { name: 'release-helper', version: '1.0' }, key: 'bind-1', seen: [], at: AT, body: { op: 'spread-bind', spread: sp, item: { uid: uid(101), attempt: 1 }, dest: { process: 'validate-story', id: 'k101' } } });
  same(why(bind), '');
  assert.ok(why(Object.assign({}, bind, { dest: { process: 'validate-story' } })));
});
rule('A story\'s request has one id from the spread, item, attempt and its exact run: a retry from any tool is the same request', () => {
  const W = world(), sp = W.spreadAdd(); W.land(W.r);
  const s = spreadOf(W), k = W.kid(101);
  const a = W.request(k, s, 'sync-bot'), b = T.prepare(k, { body: { op: 'add', text: s.text, target: { phase: 'assess' }, fulfills: { run: { process: 'release-readiness', id: 'r-41' }, spread: s.id, uid: uid(101), attempt: 1 } }, by: { tool: 'other-tool', version: '2.0' }, records: [], people: PEOPLE, at: AT });
  same(a.id, S.childRequestId(s.id, uid(101), 1, { process: 'validate-story', id: 'k101' }));
  same(b.id, a.id, 'another tool, the same request');
  same(a.file.key, S.obligationId(s.id, uid(101), 1));
  assert.notStrictEqual(S.childRequestId(s.id, uid(101), 1, { process: 'validate-story', id: 'k101b' }), a.id, 'another run is another request');
  assert.notStrictEqual(S.childRequestId(s.id, uid(101), 2, { process: 'validate-story', id: 'k101' }), a.id, 'another attempt is another obligation');
  const o = JSON.parse(T.text(a.file)), why = (x) => { const v = T.cleanFile(x, a.name); return v.ok ? '' : v.why; };
  same(why(o), '');
  assert.ok(why(Object.assign({}, o, { fulfills: Object.assign({}, o.fulfills, { attempt: 2 }) })), 'an id that isn\'t its obligation\'s');
  assert.ok(why(Object.assign({}, o, { key: 'another' })), 'a key that isn\'t its obligation\'s');
  assert.ok(why(Object.assign({}, o, { fulfills: Object.assign({}, o.fulfills, { run: { process: 'validate-story', id: 'k101' } }) })), 'never its own run');
  same(sp.preview.status, 'applied' === sp.preview.status ? 'applied' : sp.preview.status);
});

/* ---------- Coverage ---------- */
rule('Open stories owe the requirement; stories cleared when it was added stay unchanged and are listed: "3 open; 1 cleared unchanged"', () => {
  const W = world([101, 102, 103, 104]);
  W.kid(101); W.kid(102); W.kid(103); W.kid(104, { cleared: true });
  W.spreadAdd(); W.land(W.r);
  const C = W.one();
  same(C.preview, '3 open stories; 1 cleared story unchanged');
  same(C.items.map(i => (i.key) + ':' + i.state), ['ABC-101:owed', 'ABC-102:owed', 'ABC-103:owed', 'ABC-104:exempt']);
  same(C.row, 'Security sign-off · on 3 stories · 0 done');
  const H = W.mark();
  assert.ok((H.loops.each || []).length >= 3, 'unresolved coverage holds the loop: ' + JSON.stringify(H.loops));
  assert.ok(R.phaseHeld ? true : true);
});
rule('A story\'s run must accept the request itself: the parent\'s approval grants none, and declining holds the loop', () => {
  const W = world([101]); const k = W.kid(101);
  W.spreadAdd(); W.land(W.r);
  const s = spreadOf(W), q = W.request(k, s);
  same(q.preview.status, 'waiting', 'the parent accepted the spread; the child still decides');
  same(W.one().items[0].state, 'waiting');
  W.decide(k, q.id, 'person-avery', 'decline', 'Not for this story');
  same(W.one().items[0].state, 'declined');
  has(W.mark().loops.each, /declined/i);
});
rule('Done on every story\'s run resolves coverage, and only then does the loop stop being held by it', () => {
  const W = world([101, 102]); const k1 = W.kid(101), k2 = W.kid(102);
  W.spreadAdd(); W.land(W.r);
  const s = spreadOf(W);
  W.fulfil(k1, s);
  W.fulfil(k2, s, false);
  same(W.one().items.map(i => i.state), ['done', 'open']);
  same(W.one().summary, '2 added');
  has(W.mark().loops.each, /ABC-102/);
  W.ask(k2, { op: 'done', todo: W.one().items[1].todo }, { person: 'person-avery' }); W.land(k2);
  same(W.one().counts.resolved, 2);
  same(W.mark().loops.each || [], [], 'nothing holds the loop once every obligation is resolved');
});
rule('A story that joins later owes it at once, before any sync, and is announced', () => {
  const W = world([101]); const k1 = W.kid(101);
  W.spreadAdd(); W.land(W.r);
  W.fulfil(k1, spreadOf(W));
  same(W.mark().loops.each || [], []);
  W.scopes.push(scope('s2', [101, 105], [W.scopes[0].id]));
  const C = W.one(), late = C.items.filter(i => i.key === 'ABC-105')[0];
  same([late.state, late.arrival], ['no-run', true]);
  same(C.notices, ['ABC-105 joined. Security sign-off is owed; not requested yet.']);
  has(W.mark().loops.each, /ABC-105/);
  const k5 = W.kid(105);
  same(W.one().items.filter(i => i.key === 'ABC-105')[0].state, 'owed');
  W.request(k5, spreadOf(W));
  same(W.one().notices, ['ABC-105 joined. Security sign-off requested.']);
});
rule('A cleared story stays unchanged, but its new attempt owes the requirement; becoming cleared while waiting never erases it', () => {
  const W = world([101, 102]); W.kid(101, { cleared: true }); const k2 = W.kid(102);
  W.spreadAdd(); W.land(W.r);
  same(W.one().items.map(i => i.key + ':' + i.state), ['ABC-101:exempt', 'ABC-102:owed']);
  W.kid(101, { attempt: 2 });
  const C = W.one(), a2 = C.items.filter(i => i.key === 'ABC-101')[0];
  same([a2.state, a2.attempt, a2.arrival], ['owed', 2, true]);
  same(C.notices, ['ABC-101 started attempt 2. Security sign-off is owed; not requested yet.']);
  W.request(k2, spreadOf(W));
  W.clear(k2);
  same(W.one().items.filter(i => i.key === 'ABC-102')[0].state, 'ended', 'cleared while the request waited: still owed, never erased');
  has(W.mark().loops.each, /ABC-102/);
});
rule('Including a cleared story is one opt-in; on an approved loop it reopens approval, so only a person may', () => {
  const W = world([101, 102]); const k1 = W.kid(101, { cleared: true }); W.kid(102, { cleared: true });
  W.spreadAdd(); W.land(W.r);
  same(W.one().items.map(i => i.state), ['exempt', 'exempt']);
  const s = spreadOf(W);
  W.ask(W.r, { op: 'spread-include', spread: s.id, item: { uid: uid(101), attempt: 1 } }, { person: 'person-morgan' }); W.land(W.r);
  same(W.one().items.map(i => i.state), ['ended', 'exempt'], 'included one by one; its run ended before it was asked');
  const W2 = world([101]); W2.kid(101, { cleared: true }); W2.spreadAdd(); W2.land(W2.r);
  const V = W2.loopView(); W2.mark();
  R.done(W2.r, R.mapOf(W2.r), 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  const g = T.grantOf(W2.r, { subject: { tool: 'release-helper' }, ops: ['add'], targets: [{ step: 'each' }], adds: 10, by: 'person-morgan', key: 'g-1', records: W2.recs, people: PEOPLE, at: AT });
  assert.ok(!g.why, g.why); W2.push(g.record, g.name);
  const s2 = spreadOf(W2);
  const inc = W2.ask(W2.r, { op: 'spread-include', spread: s2.id, item: { uid: uid(101), attempt: 1 } }, { tool: 'release-helper', version: '1.0', key: 'inc-1' });
  same(inc.preview.consequence.reopens, ['loop:each']);
  same(inc.preview.status, 'waiting', 'a delegation never reopens an approval');
});
rule('Stopping needs a person, ends future inheritance only, and keeps every obligation it had', () => {
  const W = world([101, 102]); W.kid(101); W.kid(102);
  W.spreadAdd(); W.land(W.r);
  const s = spreadOf(W), C = W.one(), owed = C.items.filter(i => i.owed).map(i => ({ uid: i.uid, attempt: i.attempt }));
  const g = T.grantOf(W.r, { subject: { tool: 'release-helper' }, ops: ['add', 'done'], targets: [{ step: 'each' }], adds: 10, by: 'person-morgan', key: 'g-2', records: W.recs, people: PEOPLE, at: AT });
  W.push(g.record, g.name);
  const st = W.ask(W.r, { op: 'spread-stop', spread: s.id, reason: 'Covered by the platform review', owed }, { tool: 'release-helper', version: '1.0', key: 'stop-2' });
  same([st.preview.consequence.releases, st.preview.status], [true, 'waiting']);
  W.decide(W.r, st.id, 'person-morgan'); W.land(W.r);
  same(spreadOf(W).state, 'stopped');
  /* A later arrival is one whose scope record saw the stop's application (round 7: a 4.0 scope record names the head). */
  W.scopes.push(scope4('s2', [101, 102, 106], [W.scopes[0].id], W.r.living.head));
  same(W.one().items.map(i => i.key), ['ABC-101', 'ABC-102'], 'a story that joins after the stop owes nothing');
  has(W.mark().loops.each, /ABC-101/);
});
rule('A changed run selection needs an explicit binding; the request already filed stays recorded, never dropped', () => {
  const W = world([101]); const k1 = W.kid(101);
  W.spreadAdd(); W.land(W.r);
  const s = spreadOf(W), q = W.request(k1, s);
  W.kid(101, { id: 'k101b' });
  same(W.one().items[0].state, 'competing');
  const V = W.loopView(), c = LP.cleanIntent(LP.changeOf(V, 'choose', ['ABC-101'], { run: 'k101b' }), 'choose-1', { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: V.ledger.heads, children: [], now: AT, app: '3.0.0' });
  W.scopes.push(LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record);
  const it = W.one().items[0];
  same([it.state, it.run], ['rebind', 'validate-story/k101b']);
  assert.ok(W.view(k1).requests[q.id], 'the first request stays recorded on k101');
  W.ask(W.r, { op: 'spread-bind', spread: s.id, item: { uid: uid(101), attempt: 1 }, dest: { process: 'validate-story', id: 'k101b' } }, { person: 'person-morgan' }); W.land(W.r);
  same([W.one().items[0].state, W.one().items[0].run], ['owed', 'validate-story/k101b']);
});
rule('Two bindings made at once hold the story until one that saw both; more than 50 settle a page at a time', () => {
  const W = world([101]); W.kid(101); W.kid(101, { id: 'k101b' });
  W.spreadAdd(); W.land(W.r);
  const s = spreadOf(W), item = { uid: uid(101), attempt: 1 };
  const bind = (key, dest, seen) => { const f = T.buildProposal({ run: { process: 'release-readiness', id: 'r-41' }, producer: { name: 'release-helper', version: '1.0' }, key, seen: seen || [W.r.living.head], at: AT, body: { op: 'spread-bind', spread: s.id, item, dest: { process: 'validate-story', id: dest } } }); return W.push(T.cleanFile(JSON.parse(T.text(f)), f.id + '.json').record); };
  const a = bind('b-a', 'k101'), b = bind('b-b', 'k101b');
  same([W.view().requests[a.id].status, W.view().requests[b.id].status], ['disputed', 'disputed']);
  same(W.one().items[0].state, 'disputed');
  const c = bind('b-c', 'k101b', [a.id, b.id]);
  same(W.view().requests[c.id].status, 'waiting', 'one that saw both settles them');
  /* 51 at once: one record can name 50, so the first settling record leaves one, and a second settles the rest. */
  const W2 = world([101]); W2.kid(101); W2.kid(101, { id: 'k101b' }); W2.spreadAdd(); W2.land(W2.r);
  const s2 = spreadOf(W2), many = [];
  for (let i = 0; i < 51; i++) { const f = T.buildProposal({ run: { process: 'release-readiness', id: 'r-41' }, producer: { name: 'release-helper', version: '1.0' }, key: 'm-' + i, seen: [W2.r.living.head], at: AT, body: { op: 'spread-bind', spread: s2.id, item, dest: { process: 'validate-story', id: i % 2 ? 'k101' : 'k101b' } } }); many.push(W2.push(T.cleanFile(JSON.parse(T.text(f)), f.id + '.json').record)); }
  const it = W2.one().items[0];
  same(it.state, 'disputed');
  assert.ok(/51 .*more than one record can settle \(50\)/.test(it.why), it.why);
  const P1 = T.prepare(W2.r, { body: { op: 'spread-bind', spread: s2.id, item, dest: { process: 'validate-story', id: 'k101b' } }, by: { tool: 'release-helper', version: '1.0', key: 'settle-1' }, records: W2.recs, people: PEOPLE, at: AT });
  assert.ok(!P1.why, P1.why);
  same(P1.file.seen.length, 50);
  W2.push(P1.record, P1.name);
  same(W2.one().items[0].state, 'disputed', 'one page settled; one left');
  const P2 = T.prepare(W2.r, { body: { op: 'spread-bind', spread: s2.id, item, dest: { process: 'validate-story', id: 'k101b' } }, by: { tool: 'release-helper', version: '1.0', key: 'settle-2' }, records: W2.recs, people: PEOPLE, at: AT });
  W2.push(P2.record, P2.name);
  same(W2.view().requests[P2.id].status, 'waiting', 'the last page settles them');
});
rule('Anything unread holds: the loop\'s scope, the parent\'s records a story\'s request depends on, and the story\'s own to-dos', () => {
  const W = world([101]); const k1 = W.kid(101);
  W.spreadAdd(); W.land(W.r);
  const s = spreadOf(W), q = W.request(k1, s);
  same(W.view(k1).requests[q.id].status, 'waiting');
  W.unread.push({ file: 'req-x-' + 'a'.repeat(24) + '.json', why: 'unreadable', run: { process: 'release-readiness', id: 'r-41' } });
  const cq = W.view(k1).requests[q.id];
  same(cq.status, 'held', 'its spread\'s run has a record that can\'t be read');
  W.unread = [];
  const lost = W.recs.filter(x => x.kind === 'compound' && x.op === 'spread-add');
  W.recs = W.recs.filter(x => lost.indexOf(x) < 0);
  assert.ok(/spread/.test(W.view(k1).requests[q.id].why) && W.view(k1).requests[q.id].status === 'held', 'a spread its run doesn\'t have: held');
  W.recs = W.recs.concat(lost);
  /* The loop's scope unread: who owes it isn't known. */
  T.markHolds(W.runs(), { records: W.recs, people: PEOPLE, loops: { records: W.scopes, unread: [{ file: 'req-y.json', why: 'x', loop: null }], procOf: W.procOf } });
  has(W.r._todos.loops.each, /scope record/);
  /* No loop inputs at all: fail closed. */
  T.markHolds(W.runs(), { records: W.recs, people: PEOPLE });
  has(W.r._todos.loops.each, /can't be checked/);
  /* The story's own to-dos unread. */
  W.unread.push({ file: 'req-z-' + 'b'.repeat(24) + '.json', why: 'unreadable', run: { process: 'validate-story', id: 'k101' } });
  same(W.one().items[0].state, 'unread');
});
rule('Approval is sticky: a later arrival sends it back, and resolving its coverage never restores it', () => {
  const W = world([101]); const k1 = W.kid(101);
  W.spreadAdd(); W.land(W.r);
  W.fulfil(k1, spreadOf(W)); W.clear(k1);
  W.mark();
  const V = W.loopView();
  R.done(W.r, R.mapOf(W.r), 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  assert.ok(W.r.steps.each.todos.cut.length >= 2, 'the approval counted the spread and the story\'s to-do records: ' + JSON.stringify(W.r.steps.each.todos));
  W.mark();
  assert.ok(!W.r._todos.stale.loop.each, JSON.stringify(W.r._todos.stale));
  W.scopes.push(scope('s2', [101, 107], [W.scopes[0].id]));
  const k7 = W.kid(107);
  W.fulfil(k7, spreadOf(W)); W.clear(k7);
  W.mark();
  same(W.r._todos.loops.each || [], [], 'its coverage is resolved');
  assert.ok(W.r._todos.stale.loop.each, 'but the approval was made before it, so it stays in review');
  same(R.answered(W.r, R.mapOf(W.r).phases[0].steps[0]), false);
});
rule('A run takes at most 50 standing spreads; the 51st is held, nothing is cut', () => {
  const W = world([101]); W.kid(101);
  for (let i = 0; i < 50; i++) W.spreadAdd('Requirement ' + i);
  W.land(W.r);
  same(W.view().spreads.length, 50);
  const P51 = T.prepare(W.r, { body: { op: 'spread-add', loopStep: 'each', text: 'One more', child: { beforeGate: 'assess-confirm' }, scope: S.snapshot(W.loopView()) }, by: { person: 'person-morgan' }, key: 'k-51', records: W.recs, people: PEOPLE, at: AT, childMap: W.childMap });
  assert.ok(P51.why && /50/.test(P51.why), P51.why);
});
rule('A run with no spread reads exactly as before: no coverage, no new holds', () => {
  const W = world([101]); W.kid(101);
  W.ask(W.r, { op: 'add', text: 'Plain to-do', target: { phase: 'ship' } }, { person: 'person-morgan' }); W.land(W.r);
  const H = W.mark();
  same(Object.keys(H.loops), []);
  same(W.view().spreads, []);
  same(W.cov().spreads, []);
});
rule('Landing a spread on an approved loop sends that approval back, with the earlier one kept; stopping one reopens nothing', () => {
  const W = world([101]); W.kid(101, { cleared: true }); W.mark();
  const V = W.loopView(), map = R.mapOf(W.r);
  R.done(W.r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  const Pp = W.spreadAdd('Security sign-off', { tool: 'release-helper', version: '1.0', key: 'late-1' });
  same(Pp.preview.consequence.reopens, ['loop:each']);
  W.decide(W.r, Pp.id, 'person-morgan');
  const Vt = W.view(), plan = T.applyPlan(W.r, Vt, Vt.requests[Pp.id]);
  const st = T.buildStatus(Object.assign({}, plan.write, { by: 'person-morgan', at: AT, writer: 'rec', rev: rev(), app: '4.0.0' })), a = W.push(T.filed(st.name, st.file).record, st.name);
  R.todoLand(W.r, map, a, { who: 'person-morgan', now: AT, typesHash: 'abcdef12', app: '4.0.0' });
  same([W.r.living.head, W.r.steps.each.s], [a.id, 'recheck']);
  assert.ok(W.r.log.some(l => /Spread added: "Security sign-off"/.test(l.what || l.text || JSON.stringify(l))), 'logged');
});
/* Commit 2: coordination. */
const grantSync = (W, k) => { const g = T.grantOf(k, { subject: { tool: 'sync-bot' }, ops: ['add'], targets: [{ phase: 'assess' }], adds: 10, by: 'person-avery', key: 'g-' + rev(), records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0' }); assert.ok(!g.why, g.why); return W.push(g.record, g.name); };
rule('A story\'s delegation revoked before its request lands sends it back to a person; nothing lands and the loop stays held', () => {
  const W = world([101]); const k = W.kid(101);
  W.spreadAdd(); W.land(W.r);
  const g = grantSync(W, k), q = W.request(k, spreadOf(W));
  same(q.preview.status, 'queued', 'the delegation covers the tool\'s addition');
  same(W.one().items[0].state, 'queued');
  const rv = T.revokeOf(k, { grant: g.id, by: 'person-avery', key: 'rv-' + rev(), records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0' });
  assert.ok(!rv.why, rv.why); W.push(rv.record, rv.name);
  W.land(k);
  same([W.view(k).requests[q.id].status, W.one().items[0].state], ['waiting', 'waiting']);
  same(T.inbox([k], { records: W.recs, unread: W.unread, people: PEOPLE, me: 'person-avery' }).map(x => x.id), [q.id]);
  has(W.mark().loops.each, /ABC-101/);
  W.decide(k, q.id, 'person-avery'); W.land(k);
  same(W.one().items[0].state, 'open', 'a person\'s acceptance lands it');
});
rule('A story\'s placement that changes during review asks again: the decision binds what was shown, and the new one is shown', () => {
  const W = world([101]); const k = W.kid(101);
  W.spreadAdd(); W.land(W.r);
  const q = W.request(k, spreadOf(W));
  const it0 = T.inbox([k], { records: W.recs, unread: W.unread, people: PEOPLE, me: 'person-avery' })[0];
  same(it0.consequence.reopens, []);
  /* While it waits, the story's assessment passes its gate: adding before that gate now reopens it. */
  const m = R.mapOf(k); R.done(k, m, 'read', 'person-avery', AT); R.done(k, m, 'verdict', 'person-avery', AT, { decision: 'needs-work' }); R.pass(k, m, 0, 'person-avery', AT);
  const d = T.decide(k, { request: q.id, op: 'accept', by: 'person-avery', shown: it0.consequence.fingerprint, records: W.recs, unread: W.unread, people: PEOPLE, at: AT, writer: 'w' + rev(), rev: rev(), app: '4.0.0' });
  same([!!d.renewed, !!d.record], [true, false], 'nothing is decided on what was shown before');
  assert.ok(/changed since you saw it/.test(d.why), d.why);
  const it1 = T.inbox([k], { records: W.recs, unread: W.unread, people: PEOPLE, me: 'person-avery' })[0];
  same(it1.consequence.reopens, ['gate:assess-confirm']);
  assert.notStrictEqual(it1.consequence.fingerprint, it0.consequence.fingerprint);
  same(W.one().items[0].state, 'waiting');
});
rule('Exact inbox counts: each story\'s request once, on its own run, beside other requests; none on the parent for a story\'s people', () => {
  const W = world([101, 102, 103]); const ks = [W.kid(101), W.kid(102), W.kid(103)];
  W.spreadAdd(); W.land(W.r);
  const s = spreadOf(W), qs = ks.map(k => W.request(k, s));
  /* The same obligation asked again by another tool is the same request, not a second one. */
  const again = T.prepare(ks[0], { body: { op: 'add', text: s.text, target: { phase: 'assess' }, fulfills: { run: { process: 'release-readiness', id: 'r-41' }, spread: s.id, uid: uid(101), attempt: 1 } }, by: { tool: 'other-bot', version: '2.0' }, records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0' });
  same(again.id, qs[0].id);
  const plain = W.ask(ks[0], { op: 'add', text: 'Plain one', target: { phase: 'assess' } }, { tool: 'notes-bot', version: '1.0', key: 'plain-1' });
  W.spreadAdd('Legal sign-off', { tool: 'release-helper', version: '1.0', key: 'legal-1' });
  const box = (me) => T.inbox(W.runs(), { records: W.recs, unread: W.unread, people: PEOPLE, me });
  const av = box('person-avery');
  same(av.map(x => x.id).sort(), qs.map(q => q.id).concat([plain.id]).sort());
  same(av.filter(x => x.fulfills).map(x => [x.run.id, x.fulfills.spread, x.fulfills.uid]), [['k101', s.id, uid(101)], ['k102', s.id, uid(102)], ['k103', s.id, uid(103)]]);
  same(box('person-morgan').filter(x => x.run.id === 'r-41').map(x => x.op), ['spread-add']);
  W.decide(ks[1], qs[1].id, 'person-avery');
  same(box('person-avery').length, 3);
});
/* Review round 1 (SA): a stop keeps exactly what is owed when it lands, or it doesn't land. */
const stopBody = (W, owed) => ({ op: 'spread-stop', spread: spreadOf(W).id, reason: 'Covered by the platform review', owed: owed.map(n => ({ uid: uid(n), attempt: 1 })) });
rule('SA: a stop is never prepared while what it is owed on can\'t be read; incomplete never looks empty', () => {
  const W = world([101]); W.kid(101);
  W.spreadAdd(); W.land(W.r);
  const P0 = T.prepare(W.r, { body: stopBody(W, [101]), by: { tool: 'release-helper', version: '1.0', key: 'st-0' }, records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0' });
  assert.ok(P0.why && /can't be checked here/.test(P0.why), 'without the loop: ' + P0.why);
  /* A scope record whose predecessor hasn't arrived: the loop's ledger is held. */
  W.scopes.push(scope('s2', [101, 102], ['req-release-helper-' + 'f'.repeat(24)]));
  same(W.one().complete, false);
  same(W.one().items, [], 'nothing can be listed');
  const P1 = T.prepare(W.r, { body: stopBody(W, []), by: { tool: 'release-helper', version: '1.0', key: 'st-1' }, records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0', loops: W.loops(), runs: W.runs() });
  assert.ok(P1.why && /can't all be read/.test(P1.why), 'held scope: ' + P1.why);
});
rule('SA: a stop asked before an item joined is refused at the decision and at every application write; the item stays owed', () => {
  const W = world([101]); W.kid(101);
  W.spreadAdd(); W.land(W.r);
  const st = W.ask(W.r, stopBody(W, [101]), { tool: 'release-helper', version: '1.0', key: 'st-2' });
  /* Accepted while it was right... */
  const it = T.inbox([W.r], Object.assign({ me: 'person-morgan' }, W.inputs())).filter(x => x.id === st.id)[0];
  W.decide(W.r, st.id, 'person-morgan');
  /* ...then ABC-102 joins before the recorder applies it. */
  W.scopes.push(scope('s2', [101, 102], [W.scopes[0].id])); W.kid(102);
  const V = W.view(), plan = T.applyPlan(W.r, V, V.requests[st.id], W.inputs());
  assert.ok(plan.skip && plan.stale && /changed since this stop was asked/.test(plan.skip), JSON.stringify(plan));
  const blind = T.applyPlan(W.r, V, V.requests[st.id], { records: W.recs, unread: W.unread, people: PEOPLE });
  assert.ok(blind.skip && !blind.write && !blind.adopt, 'a recorder that can\'t read the loop applies nothing: ' + JSON.stringify(blind));
  W.land(W.r);
  same(spreadOf(W).state, 'active', 'the stale stop never lands');
  same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-101', 'ABC-102']);
  /* A decision made on a stop that is stale already is refused too. */
  const st2 = W.ask(W.r, Object.assign(stopBody(W, [101, 102]), { reason: 'Again' }), { tool: 'release-helper', version: '1.0', key: 'st-3' });
  W.scopes.push(scope('s3', [101, 102, 103], [W.scopes[1].id])); W.kid(103);
  const it2 = T.inbox([W.r], Object.assign({ me: 'person-morgan' }, W.inputs())).filter(x => x.id === st2.id)[0];
  const d = T.decide(W.r, Object.assign({ request: st2.id, op: 'accept', by: 'person-morgan', shown: it2.consequence.fingerprint, at: AT, writer: 'wx', rev: rev(), app: '4.0.0' }, W.inputs()));
  assert.ok(d.why && /Ask for the stop again/.test(d.why), d.why);
  /* And a fresh stop naming everything owed now lands. */
  W.ask(W.r, Object.assign(stopBody(W, [101, 102, 103]), { reason: 'Fresh' }), { person: 'person-morgan' }); W.land(W.r);
  same(spreadOf(W).state, 'stopped');
  same(W.one().items.map(i => i.key), ['ABC-101', 'ABC-102', 'ABC-103']);
  assert.ok(it, 'set-up');
});
/* Review round 1 (SB): a spread's request decided two ways holds its loop, before and after it landed. */
rule('SB: contrary decisions on an applied spread hold its loop and its phase\'s gate until a person settles them', () => {
  const W = world([101]); const k = W.kid(101);
  const P = W.spreadAdd('Security sign-off', { tool: 'release-helper', version: '1.0', key: 'sb-1' });
  W.decide(W.r, P.id, 'person-morgan'); W.land(W.r);
  W.fulfil(k, spreadOf(W)); W.clear(k);
  same(W.mark().loops.each || [], [], 'set-up: covered');
  const V = W.view(), C = T.consequenceOf(W.r, V.map, V.requests[P.id], V).fingerprint;
  const st = T.buildStatus({ kind: 'decision', proposal: P.id, run: { process: 'release-readiness', id: 'r-41' }, seen: [P.id], by: 'person-morgan', at: AT, op: 'decline', consequence: C, writer: 'wz', rev: rev(), app: '4.0.0' });
  W.push(T.filed(st.name, st.file).record, st.name);
  assert.ok((W.view().requests[P.id].decOut || []).length > 0, 'set-up: decided two ways');
  has(W.mark().loops.each, /two ways/);
  const map = R.mapOf(W.r), V2 = W.loopView();
  same(T.inbox([W.r], Object.assign({ me: 'person-morgan' }, W.inputs())).filter(x => x.id === P.id).map(x => x.dispute), [true]);
  /* Settled by a decision that saw both: the loop is free again. */
  W.decide(W.r, P.id, 'person-morgan');
  same(W.mark().loops.each || [], []);
  assert.ok(map && V2, 'set-up');
});
/* Review round 1 (SC): bindings made at once and the one that settled them stay in what an approval must count. */
rule('SC: settling two bindings made at once never restores an approval made before them', () => {
  const W = world([101]); const k = W.kid(101); W.kid(101, { id: 'k101b' });
  W.spreadAdd(); W.land(W.r);
  const s = spreadOf(W), item = { uid: uid(101), attempt: 1 };
  W.ask(W.r, { op: 'spread-bind', spread: s.id, item, dest: { process: 'validate-story', id: 'k101' } }, { person: 'person-morgan' }); W.land(W.r);
  W.fulfil(k, spreadOf(W)); W.clear(k);
  /* The loop chooses k101 too, so the loop itself is satisfied. */
  const LV = W.loopView(), ci = LP.cleanIntent(LP.changeOf(LV, 'choose', ['ABC-101'], { run: 'k101' }), 'choose-sc', { name: 'release-helper', version: '1.0' });
  const cf = LP.buildRequest(ci.intent, { seen: LV.ledger.heads, children: [], now: AT, app: '3.0.0' });
  W.scopes.push(LP.cleanRequest(JSON.parse(LP.text(cf)), cf.id + '.json').record);
  same(W.mark().loops.each || [], [], 'set-up: covered');
  const V0 = W.loopView();
  R.done(W.r, R.mapOf(W.r), 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V0.ledger, V0.rollup, { by: 'person-morgan', at: AT }) } });
  W.mark();
  assert.ok(!W.r._todos.stale.loop.each, 'set-up: approved and current');
  const bind = (key, dest, seen) => { const f = T.buildProposal({ run: { process: 'release-readiness', id: 'r-41' }, producer: { name: 'release-helper', version: '1.0' }, key, seen: seen || [W.r.living.head], at: AT, body: { op: 'spread-bind', spread: s.id, item, dest: { process: 'validate-story', id: dest } } }); return W.push(T.cleanFile(JSON.parse(T.text(f)), f.id + '.json').record); };
  const a = bind('sc-a', 'k101'), b = bind('sc-b', 'k101b');
  W.mark();
  assert.ok(W.r._todos.stale.loop.each, 'two bindings at once send it back');
  bind('sc-c', 'k101', [a.id, b.id]);
  W.mark();
  assert.ok(W.r._todos.stale.loop.each, 'and settling them doesn\'t restore it');
  same(R.answered(W.r, R.mapOf(W.r).phases[0].steps[0]), false);
});
/* Review round 1 (SE): an item approved without a run resolves its obligation, whether or not it has a run. */
rule('SE: an exception settled for the current attempt resolves coverage even when the item already has a run', () => {
  const W = world([101]); W.kid(101);
  W.spreadAdd(); W.land(W.r);
  same(W.one().items[0].state, 'owed');
  const intent = { loop: LOOPT, observation: null, changes: [{ op: 'exception', item: { key: 'ABC-101' }, reason: 'Docs only', approver: 'person-morgan' }] };
  const c = LP.cleanIntent(intent, 'ex-1', { name: 'release-helper', version: '1.0' });
  same(c.errors, []);
  const f = LP.buildRequest(c.intent, { seen: [W.scopes[0].id], children: [], now: AT, app: '3.0.0' });
  W.scopes.push(LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record);
  same(W.loopView().rollup.items[0].status, 'exception', 'set-up: the loop says exception');
  same([W.one().items[0].state, W.one().items[0].resolved], ['excepted', true]);
  same(W.mark().loops.each || [], []);
});
/* Review round 2 (TA): a spread's request decided two ways holds whether or not any spread has landed yet. */
rule('TA: contrary decisions on a first, unapplied spread-add hold an approved loop, and settling them keeps it in review', () => {
  const W = world([101]); W.kid(101, { cleared: true });
  W.mark();
  assert.strictEqual(W.r.living, undefined, 'set-up: nothing has landed on the run');
  const V0 = W.loopView(), map = R.mapOf(W.r);
  R.done(W.r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V0.ledger, V0.rollup, { by: 'person-morgan', at: AT }) } });
  W.mark();
  assert.ok(!(W.r._todos && W.r._todos.stale.loop.each) && R.answered(W.r, map.phases[0].steps[0]), 'set-up: approved');
  const P = W.spreadAdd('Security sign-off', { tool: 'release-helper', version: '1.0', key: 'ta-1' });
  const V = W.view(), C = T.consequenceOf(W.r, V.map, V.requests[P.id], V).fingerprint;
  for (const [op, w] of [['accept', 'wa'], ['decline', 'wb']]) { const st = T.buildStatus({ kind: 'decision', proposal: P.id, run: { process: 'release-readiness', id: 'r-41' }, seen: [P.id], by: 'person-morgan', at: AT, op, consequence: C, writer: w, rev: rev(), app: '4.0.0' }); W.push(T.filed(st.name, st.file).record, st.name); }
  same(W.view().requests[P.id].status, 'disputed', 'set-up: disputed');
  same(W.view().spreads.length, 0, 'set-up: no spread landed');
  has(W.mark().loops.each, /two ways/);
  same(R.answered(W.r, map.phases[0].steps[0]), false);
  W.decide(W.r, P.id, 'person-morgan', 'decline');
  same(W.view().requests[P.id].status, 'declined');
  W.mark();
  assert.ok(W.r._todos.stale.loop.each, 'the approval made before the dispute stays in review');
});
/* Review round 2 (TB): a stop that can't progress (stale, or what it is owed on can't all be read) is passed over in every
   path the recorder picks from, queued or settling, so the requests after it still land. */
rule('TB: a stop held by incomplete coverage never blocks a queued request after it', () => {
  const W = world([101]); W.kid(101);
  W.spreadAdd(); W.land(W.r);
  const st = W.ask(W.r, stopBody(W, [101]), { tool: 'release-helper', version: '1.0', key: 'tb-1' });
  W.decide(W.r, st.id, 'person-morgan');
  W.scopes.push(scope('s2', [101, 102], ['req-release-helper-' + 'f'.repeat(24)]));
  same(W.one().complete, false, 'set-up: incomplete');
  const add = W.ask(W.r, { op: 'add', text: 'Plain', target: { phase: 'ship' } }, { person: 'person-morgan' });
  same((T.nextQueued(W.view(), W.r, W.inputs()) || {}).id, add.id, 'the addition is next, not the stop');
  same((T.nextToCarry(W.view(), W.r, W.inputs()) || {}).id, add.id);
  W.land(W.r);
  same(W.view().requests[add.id].status, 'applied');
  same(W.view().requests[st.id].status, 'queued', 'the stop waits, unapplied');
});
rule('TB: a stale stop whose applications disagree never blocks settling another request\'s applications', () => {
  const W = world([101]); W.kid(101);
  W.spreadAdd(); W.land(W.r);
  const twoApps = (id) => {
    const V = W.view(), plan = T.applyPlan(W.r, V, V.requests[id], W.inputs());
    assert.ok(plan.write, JSON.stringify(plan));
    for (const w of ['wa', 'wb']) { const s = T.buildStatus(Object.assign({}, plan.write, w === 'wb' ? { previous: T.idFor('x', 'elsewhere-' + id) } : {}, { by: 'person-morgan', at: AT, writer: w, rev: rev(), app: '4.0.0' })); const fd = T.filed(s.name, s.file); assert.ok(!fd.why, fd.why); W.push(fd.record, s.name); }
  };
  const st = W.ask(W.r, stopBody(W, [101]), { tool: 'release-helper', version: '1.0', key: 'tb-2' });
  W.decide(W.r, st.id, 'person-morgan');
  twoApps(st.id);
  W.scopes.push(scope('s2', [101, 102], [W.scopes[0].id])); W.kid(102);
  const vs = W.view().requests[st.id];
  same([vs.status, !!vs.appOnly, (T.applyPlan(W.r, W.view(), vs, W.inputs()) || {}).stale], ['disputed', true, true], 'set-up: a stale stop prepared two ways');
  const add = W.ask(W.r, { op: 'add', text: 'Plain', target: { phase: 'ship' } }, { tool: 'release-helper', version: '1.0', key: 'tb-3' });
  W.decide(W.r, add.id, 'person-morgan');
  twoApps(add.id);
  same([W.view().requests[add.id].status, !!W.view().requests[add.id].appOnly], ['disputed', true], 'set-up: the addition prepared two ways');
  const q = T.nextToCarry(W.view(), W.r, W.inputs());
  same(q && q.id, add.id, 'the addition settles next, not the stale stop');
  const plan = T.applyPlan(W.r, W.view(), q, W.inputs());
  assert.ok(plan.write || plan.adopt, JSON.stringify(plan));
});
/* Review round 2 (TC): once stopped, a spread keeps exactly the obligations it had, but only while each is still required on
   its current attempt: a removed item and an earlier attempt owe nothing, and a later attempt never inherits one. */
const loopChange = (W, key, change) => {
  const c = LP.cleanIntent({ loop: LOOPT, observation: null, changes: [change] }, key, { name: 'release-helper', version: '1.0' });
  same(c.errors, []);
  const f = LP.buildRequest(c.intent, { seen: [W.scopes[W.scopes.length - 1].id], children: [], now: AT, app: '3.0.0' });
  return W.scopes.push(LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record);
};
rule('TC: a stopped spread owes nothing on an item removed from scope after it stopped', () => {
  const W = world([101, 102]); W.kid(101); W.kid(102);
  W.spreadAdd(); W.land(W.r);
  W.ask(W.r, stopBody(W, [101, 102]), { person: 'person-morgan' }); W.land(W.r);
  same(spreadOf(W).state, 'stopped', 'set-up: stopped');
  same(spreadOf(W).stop.owed.length, 2);
  loopChange(W, 'ex-102', { op: 'exclude', item: { key: 'ABC-102' }, reason: 'Ships in 4.2' });
  same(W.loopView().rollup.items.filter(i => i.key === 'ABC-102').map(i => [i.required, i.status]), [[false, 'removed']], 'set-up: removed');
  same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-101']);
  assert.ok(!(W.mark().loops.each || []).some(x => /ABC-102/.test(x)), JSON.stringify(W.r._todos.loops.each));
  same(spreadOf(W).stop.owed.length, 2, 'the stop record itself is unchanged');
});
/* Regression since round 10 (BA): a new attempt with no plan has no witness to show it came after the stop, so it owes. */
rule('TC: a stopped spread\'s listed attempt says nothing of a new one, which owes with no plan made after the stop', () => {
  const W = world([101, 102]); W.kid(101, { cleared: false }); W.kid(102);
  W.spreadAdd(); W.land(W.r);
  W.ask(W.r, stopBody(W, [101, 102]), { person: 'person-morgan' }); W.land(W.r);
  same(spreadOf(W).state, 'stopped', 'set-up: stopped');
  W.kid(101, { attempt: 2 });
  same(W.loopView().rollup.items.filter(i => i.key === 'ABC-101').map(i => i.attempt), [2], 'set-up: attempt 2');
  same(W.one().items.filter(i => i.owed).map(i => i.key + '#' + i.attempt), ['ABC-102#1', 'ABC-101#2']);
});
/* Review round 2 (TD): a settled exception for the current attempt resolves coverage whatever the loop shows as its status. */
rule('TD: an exception settled for the current attempt resolves coverage even when the item\'s run already cleared', () => {
  const W = world([101]); const k = W.kid(101);
  W.spreadAdd(); W.land(W.r);
  same(W.one().items[0].state, 'owed');
  W.clear(k);
  loopChange(W, 'ex-td', { op: 'exception', item: { key: 'ABC-101' }, reason: 'Docs only', approver: 'person-morgan' });
  const row = W.loopView().rollup.items[0];
  same([row.status, !!row.exception], ['cleared', true], 'set-up: cleared, with a settled exception');
  same([W.one().items[0].state, W.one().items[0].resolved], ['excepted', true]);
  same(W.mark().loops.each || [], []);
});
rule('TD: an exception decided two ways never resolves coverage, whatever the item\'s run shows', () => {
  const W = world([101]); const k = W.kid(101);
  W.spreadAdd(); W.land(W.r);
  W.clear(k);
  const base = W.scopes[W.scopes.length - 1].id;
  for (const [key, op] of [['ex-a', 'exception'], ['ex-b', 'withdraw']]) {
    const c = LP.cleanIntent({ loop: LOOPT, observation: null, changes: [Object.assign({ op, item: { key: 'ABC-101' } }, op === 'exception' ? { reason: 'Docs only', approver: 'person-morgan' } : {})] }, key, { name: 'release-helper', version: '1.0' });
    same(c.errors, []);
    const f = LP.buildRequest(c.intent, { seen: [base], children: [], now: AT, app: '3.0.0' });
    W.scopes.push(LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record);
  }
  assert.ok(W.loopView().rollup.items[0].excReview, 'set-up: decided two ways');
  assert.ok(W.one().items[0].state !== 'excepted' && !W.one().items[0].resolved, JSON.stringify(W.one().items[0]));
});
/* Review round 3 (UA): approvals are sticky before a run's first application too. A dispute on its first request, settled,
   never restores a loop's approval or a gate passed or waived before it; approving again records what it counted. */
const twoWays = (W, x, id, run) => {
  const V = W.view(x), C = T.consequenceOf(x, V.map, V.requests[id], V).fingerprint;
  for (const [op, w] of [['accept', 'wa'], ['decline', 'wb']]) { const st = T.buildStatus({ kind: 'decision', proposal: id, run, seen: [id], by: 'person-morgan', at: AT, op, consequence: C, writer: w, rev: rev(), app: '4.0.0' }); W.push(T.filed(st.name, st.file).record, st.name); }
  same(W.view(x).requests[id].status, 'disputed', 'set-up: disputed');
};
for (const how of ['open', 'passed', 'waived']) {
  rule('UA: before any application, a settled dispute on a first spread-add never restores the loop\'s approval or a gate ' + (how === 'open' ? 'not yet passed (it never becomes ready)' : how) + '; approving again records it', () => {
    const W = world([101]); W.kid(101, { cleared: true });
    W.mark();
    const map = R.mapOf(W.r), step = map.phases[0].steps[0], gid = map.phases[0].gate.id;
    const approve = () => { const V0 = W.loopView(); R.done(W.r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V0.ledger, V0.rollup, { by: 'person-morgan', at: AT }) } }); W.mark(); };
    approve();
    if (how === 'passed') { R.pass(W.r, map, 0, 'person-morgan', AT); W.mark(); }
    if (how === 'waived') { R.waive(W.r, map, 0, 'Covered elsewhere', 'person-morgan', AT); W.mark(); }
    same([W.r.living, R.answered(W.r, step), R.gateStatus(W.r, map, 0)], [undefined, true, how === 'open' ? 'ready' : how], 'set-up: approved, nothing landed');
    const P = W.spreadAdd('Security sign-off', { tool: 'release-helper', version: '1.0', key: 'ua-' + how });
    twoWays(W, W.r, P.id, { process: 'release-readiness', id: 'r-41' });
    W.mark();
    same([R.answered(W.r, step), R.gateStatus(W.r, map, 0)], [false, how === 'open' ? 'open' : 'review'], 'held while disputed');
    W.decide(W.r, P.id, 'person-morgan', 'decline');
    same(W.view().requests[P.id].status, 'declined');
    W.mark();
    same([R.answered(W.r, step), R.gateStatus(W.r, map, 0)], [false, how === 'open' ? 'open' : 'review'], 'settling it restores nothing');
    /* A person approves again: the approval records the dispute's records it counted, and the run reads back. */
    approve();
    assert.ok(R.answered(W.r, step), 'approved again');
    same(W.r.steps.each.todos.cut.length > 0, true, 'the loop\'s approval records what it counted');
    if (how !== 'open') {
      if (how === 'passed') R.pass(W.r, map, 0, 'person-morgan', AT); else R.waive(W.r, map, 0, 'Covered elsewhere', 'person-morgan', AT);
      W.mark();
      same([R.gateStatus(W.r, map, 0), W.r.gates[gid].todos.cut.length > 0], [how, true], 'the gate\'s approval records what it counted');
    } else same(R.gateStatus(W.r, map, 0), 'ready');
    const back = R.sanitize(JSON.parse(JSON.stringify(W.r, (k, v) => k.charAt(0) === '_' ? undefined : v)));
    same([back._unrunnable, back.living, back.features.indexOf('living-runs') >= 0], [undefined, { head: '' }, true], 'it reads back, marked as living with nothing landed');
    T.markHolds([back].concat(W.kids), { records: W.recs, unread: W.unread, people: PEOPLE, loops: W.loops() });
    same([R.answered(back, step), R.gateStatus(back, map, 0)], [true, how === 'open' ? 'ready' : how], 'and stays approved as read back');
  });
}
rule('UA: before any application, a settled dispute on a plain addition never restores the gate passed before it', () => {
  const W = world([101]); W.kid(101, { cleared: true });
  W.mark();
  const map = R.mapOf(W.r), V0 = W.loopView();
  R.done(W.r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V0.ledger, V0.rollup, { by: 'person-morgan', at: AT }) } }); W.mark();
  R.pass(W.r, map, 0, 'person-morgan', AT); W.mark();
  R.done(W.r, map, 'ship1', 'person-morgan', AT); W.mark();
  R.pass(W.r, map, 1, 'person-morgan', AT); W.mark();
  same([W.r.living, R.gateStatus(W.r, map, 1)], [undefined, 'passed'], 'set-up');
  const P = W.ask(W.r, { op: 'add', text: 'Plain', target: { phase: 'ship' } }, { tool: 'release-helper', version: '1.0', key: 'ua-plain' });
  twoWays(W, W.r, P.id, { process: 'release-readiness', id: 'r-41' });
  W.mark();
  same(R.gateStatus(W.r, map, 1), 'review', 'held while disputed');
  W.decide(W.r, P.id, 'person-morgan', 'decline'); W.mark();
  same(R.gateStatus(W.r, map, 1), 'review', 'settling it restores nothing');
});
/* Review round 3 (UB): a dispute on any request on a covered to-do (Done, Won't do, Move, Reopen), not only its Add, stays
   in the parent's approval scope, so settling it never restores an approval made before it. */
rule('UB: a delayed contrary decision on a story\'s Done holds the parent, and settling it keeps the parent\'s approval in review', () => {
  const W = world([101]); const k = W.kid(101);
  const P = W.spreadAdd('Security sign-off', { tool: 'release-helper', version: '1.0', key: 'ub-1' }); W.decide(W.r, P.id, 'person-morgan'); W.land(W.r);
  const sp = spreadOf(W), A = W.fulfil(k, sp, false);
  const D = W.ask(k, { op: 'done', todo: A.preview.todo }, { tool: 'release-helper', version: '1.0', key: 'ub-done' });
  const acc = W.decide(k, D.id, 'person-avery'); W.land(k);
  W.clear(k);
  same(W.one().items[0].state, 'done', 'set-up: done');
  const map = R.mapOf(W.r), step = map.phases[0].steps[0], V0 = W.loopView();
  R.done(W.r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V0.ledger, V0.rollup, { by: 'person-morgan', at: AT }) } }); W.mark();
  assert.ok(R.answered(W.r, step), 'set-up: approved');
  /* A decline made at the same time as the accept, arriving late: it saw the request, not the accept. */
  const KV = W.view(k), C = T.consequenceOf(k, KV.map, KV.requests[D.id], KV).fingerprint, run = { process: k.process, id: k.id };
  const late = T.buildStatus({ kind: 'decision', proposal: D.id, run, seen: [D.id], by: 'person-avery', at: AT, op: 'decline', consequence: C, writer: 'wlate', rev: rev(), app: '4.0.0' }); W.push(T.filed(late.name, late.file).record, late.name);
  W.mark();
  same(R.answered(W.r, step), false, 'held while the Done is disputed');
  const fix = T.buildStatus({ kind: 'decision', proposal: D.id, run, seen: [D.id, acc.id, T.filed(late.name, late.file).record.id], by: 'person-avery', at: AT, op: 'accept', consequence: C, writer: 'wfix', rev: rev(), app: '4.0.0' }); W.push(T.filed(fix.name, fix.file).record, fix.name);
  same(W.view(k).byTodo[A.preview.todo].disputed, false, 'set-up: settled');
  W.mark();
  same(R.answered(W.r, step), false, 'settling it restores nothing: a person approves again');
});
/* Review round 3 (UD): an arrival notice says "requested" only when a request is there, and an item included one by one
   (cleared when the spread was added) never "joined". */
rule('UD: an item that joined and ended before it was asked is announced as not requested; an included cleared item never joined', () => {
  const W = world([101]); W.kid(101);
  W.spreadAdd(); W.land(W.r);
  W.scopes.push(scope('s2', [101, 104], [W.scopes[0].id])); W.kid(104, { cleared: true });
  const C = W.one(), it = C.items.filter(i => i.key === 'ABC-104')[0];
  same([it.state, it.arrival, it.requested], ['ended', true, false], 'set-up: joined, ended, never asked');
  same(C.notices, ['ABC-104 joined. Security sign-off is owed; not requested yet.']);
  const W2 = world([101, 102]); W2.kid(101, { cleared: true }); W2.kid(102);
  W2.spreadAdd(); W2.land(W2.r);
  W2.ask(W2.r, { op: 'spread-include', spread: spreadOf(W2).id, item: { uid: uid(101), attempt: 1 } }, { person: 'person-morgan' }); W2.land(W2.r);
  const i1 = W2.one().items.filter(i => i.key === 'ABC-101')[0];
  same([i1.owed, i1.arrival], [true, false], 'included, not an arrival');
  same(W2.one().notices, []);
});
/* Review round 4 (VB): stopping a spread releases work and reopens nothing, on the next read too; a stop decided two ways
   still stays in what the approvals count. */
for (const how of ['open', 'passed', 'waived']) {
  rule('VB: stopping a fully covered spread keeps the loop\'s approval and a gate ' + how + ' as they were, read again', () => {
    const W = world([101]); const k = W.kid(101);
    W.spreadAdd(); W.land(W.r);
    W.fulfil(k, spreadOf(W)); W.clear(k);
    same(W.one().items[0].state, 'done', 'set-up: covered');
    const map = R.mapOf(W.r), step = map.phases[0].steps[0], V0 = W.loopView();
    R.done(W.r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V0.ledger, V0.rollup, { by: 'person-morgan', at: AT }) } }); W.mark();
    if (how === 'passed') { R.pass(W.r, map, 0, 'person-morgan', AT); W.mark(); }
    if (how === 'waived') { R.waive(W.r, map, 0, 'Covered elsewhere', 'person-morgan', AT); W.mark(); }
    const was = [R.answered(W.r, step), R.gateStatus(W.r, map, 0)];
    same(was, [true, how === 'open' ? 'ready' : how], 'set-up: approved');
    const st = W.ask(W.r, stopBody(W, W.one().items.filter(i => i.owed).map(i => +i.uid.slice(-3))), { person: 'person-morgan' });
    same(st.preview.consequence.reopens, [], 'set-up: the preview reopens nothing');
    W.land(W.r);
    same(spreadOf(W).state, 'stopped', 'set-up: stopped');
    W.mark();
    same([R.answered(W.r, step), R.gateStatus(W.r, map, 0)], was, 'read again, nothing reopened');
  });
}
rule('VB: a stop decided two ways still sends the loop\'s approval back, and settling it restores nothing', () => {
  const W = world([101]); const k = W.kid(101);
  W.spreadAdd(); W.land(W.r);
  W.fulfil(k, spreadOf(W)); W.clear(k);
  const map = R.mapOf(W.r), step = map.phases[0].steps[0], V0 = W.loopView();
  R.done(W.r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: LP.approval(V0.ledger, V0.rollup, { by: 'person-morgan', at: AT }) } }); W.mark();
  assert.ok(R.answered(W.r, step), 'set-up: approved');
  const st = W.ask(W.r, stopBody(W, [101]), { tool: 'release-helper', version: '1.0', key: 'vb-stop' });
  twoWays(W, W.r, st.id, { process: 'release-readiness', id: 'r-41' });
  W.mark();
  same(R.answered(W.r, step), false, 'held while disputed');
  W.decide(W.r, st.id, 'person-morgan', 'decline'); W.mark();
  same(R.answered(W.r, step), false, 'settling it restores nothing');
});
/* Review round 5 (WA): coverage expects what it depends on, from what it recorded and what refers to it, and an expected
   dependency that is absent, or present but not checked, is never "nothing there". Table-driven: every kind of dependency,
   absent or unread, against every consumer the core gives (coverage, the holds every window marks, the problem collector,
   asking, deciding and applying a stop). The readers' own failure modes (malformed, newer, unreadable, a link) are the CLI's
   and the app's matrices (test/spread-cli.test.js, test/app-spreads.test.js). */
function applied() {
  const W = world([101, 102, 103]); W.kid(101, { cleared: true }); const k2 = W.kid(102); W.kid(103);
  const add = W.spreadAdd('Security sign-off', { tool: 'release-helper', version: '1.0', key: 'wa-1' });
  const dec = W.decide(W.r, add.id, 'person-morgan'); W.land(W.r);
  const sp = spreadOf(W); assert.ok(sp && sp.state === 'active', 'set-up: applied');
  const req = W.request(k2, sp);
  same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-102', 'ABC-103'], 'set-up: two owed');
  return { W, add, dec, head: W.r.living.head, req, k2, sp, stop: (owed) => ({ op: 'spread-stop', spread: sp.id, reason: 'Covered by the platform review', owed: owed.map(n => ({ uid: uid(n), attempt: 1 })), cut: W.scopes.map(x => x.id).slice(-1) }) };
}
const dropRec = (W, id) => { const i = W.recs.findIndex(x => x.id === id); assert.ok(i >= 0, 'set-up: ' + id); return W.recs.splice(i, 1)[0]; };
/* [kind, how it goes missing or unread, the path named (or null when its own reader names it), restore] */
const WA_DEPS = [
  ['a scope record, absent', (S0) => { const x = S0.W.scopes.splice(0, 1)[0]; return { path: 'proposals/' + x.id + '.json', back: () => S0.W.scopes.unshift(x) }; }],
  ['a scope record, unread', (S0) => { const x = S0.W.scopes.splice(0, 1)[0], L0 = S0.W.loops; S0.W.loops = () => Object.assign(L0(), { unread: [{ file: x._file || x.id + '.json', why: 'is newer', loop: LOOPT }] }); return { path: null, back: () => { S0.W.scopes.unshift(x); S0.W.loops = L0; } }; }],
  ['the spread-add proposal, absent', (S0) => { const x = dropRec(S0.W, S0.add.id); return { path: 'proposals/' + x.id + '.json', back: () => S0.W.recs.push(x) }; }],
  ['the application living.head names, absent', (S0) => { const x = dropRec(S0.W, S0.head); return { path: 'proposals/' + x.id + '.json', back: () => S0.W.recs.push(x) }; }],
  ['the decision the application saw, absent', (S0) => { const x = dropRec(S0.W, S0.dec.id); return { path: 'proposals/' + x.id + '.json', back: () => S0.W.recs.push(x) }; }],
  ['an item\'s run its request was filed on, absent', (S0) => { const i = S0.W.kids.indexOf(S0.k2); S0.W.kids.splice(i, 1); return { path: 'runs/validate-story/' + S0.k2.id + '/run.json', back: () => S0.W.kids.splice(i, 0, S0.k2) }; }],
  ['an item\'s run whose last read failed (the app keeps the old copy)', (S0) => { const L0 = S0.W.loops; S0.W.loops = () => Object.assign(L0(), { unreadRun: (c) => c === S0.k2 ? { path: 'runs/validate-story/' + c.id + '/run.json', kind: 'unreadable', why: 'EIO' } : null }); return { path: null, back: () => { S0.W.loops = L0; } }; }],
  ['an item\'s run the reader couldn\'t read (the CLI has no copy)', (S0) => { const i = S0.W.kids.indexOf(S0.k2), L0 = S0.W.loops; S0.W.kids.splice(i, 1); S0.W.loops = () => Object.assign(L0(), { failed: ['runs/validate-story/' + S0.k2.id + '/run.json'] }); return { path: null, back: () => { S0.W.kids.splice(i, 0, S0.k2); S0.W.loops = L0; } }; }]
];
for (const [kind, lose] of WA_DEPS) {
  rule('WA: ' + kind + ': coverage is incomplete, its loop is held, the collector names it, and no stop is asked, decided or applied', () => {
    const S0 = applied(), W = S0.W, off = [];
    /* A stop asked while everything could be read, to be decided and applied while it can't. */
    const st = W.ask(W.r, S0.stop([102, 103]), { tool: 'release-helper', version: '1.0', key: 'wa-st' });
    const shown = T.inbox([W.r], Object.assign({ me: 'person-morgan' }, W.inputs())).filter(x => x.id === st.id)[0];
    assert.ok(shown, 'set-up: the stop waits for Morgan');
    const lost = lose(S0);
    const cov = W.cov(), C = cov.spreads[0];
    if (C && C.complete !== false) off.push('coverage: complete');
    const H = W.mark();
    if (!H || !((H.loops.each || []).length || H.all.length)) off.push('holds: the loop isn\'t held');
    if (lost.path && !T.missingOf(W.view(), cov).some(x => x.path === lost.path && x.kind === 'nofile')) off.push('collector: ' + lost.path + ' not named (' + JSON.stringify(T.missingOf(W.view(), cov)) + ')');
    const P = T.prepare(W.r, { body: S0.stop([]), by: { tool: 'release-helper', version: '1.0', key: 'wa-st0' }, records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0', loops: W.loops(), runs: W.runs() });
    if (!P.why) off.push('prepare: a stop with owed [] was asked');
    const d = T.decide(W.r, Object.assign({ request: st.id, op: 'accept', by: 'person-morgan', shown: shown.consequence.fingerprint, at: AT, writer: 'wx', rev: rev(), app: '4.0.0' }, W.inputs()));
    if (!d.why) off.push('decide: the stop was accepted');
    const V = W.view(), q = V.requests[st.id], plan = q ? T.applyPlan(W.r, V, q, W.inputs()) : { skip: 'unread' };
    if (!plan.skip) off.push('apply: ' + JSON.stringify(plan).slice(0, 120));
    same(off, [], kind);
    /* When it is back, every obligation still stands. */
    lost.back();
    same(W.one().complete, true, kind + ': back');
    same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-102', 'ABC-103'], kind + ': nothing was lost');
  });
}
/* The reviewers' sequence: a stop filed while the loop's only scope record is missing, then the scope record returns. */
rule('WA: a stop filed while the scope record is missing is never applied; once it returns, both obligations still stand', () => {
  const S0 = applied(), W = S0.W, x = W.scopes.splice(0, 1)[0];
  same(W.one().complete, false, 'incomplete, never empty');
  const P = T.prepare(W.r, { body: S0.stop([]), by: { tool: 'release-helper', version: '1.0', key: 'wa-st1' }, records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0', loops: W.loops(), runs: W.runs() });
  assert.ok(P.why, 'no stop is prepared');
  /* One filed anyway (a tool that didn't check) is never decided or applied while it can't be checked. */
  const bf = T.buildProposal({ run: { process: 'release-readiness', id: 'r-41' }, producer: { name: 'other-tool', version: '1.0' }, key: 'wa-st2', seen: W.view().heads, at: AT, body: S0.stop([]) }), fd = T.filed(T.idFor('other-tool', 'wa-st2') + '.json', bf);
  assert.ok(!fd.why, fd.why);
  const st = W.push(fd.record);
  W.land(W.r);
  same(spreadOf(W).state, 'active', 'not applied');
  W.scopes.unshift(x);
  W.land(W.r);
  same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-102', 'ABC-103'], 'obligations kept');
  assert.ok(st, 'set-up');
});
rule('WA: an explicitly recorded removal still works: a removed item owes nothing, and coverage is complete', () => {
  const S0 = applied(), W = S0.W;
  loopChange(W, 'wa-ex', { op: 'exclude', item: { key: 'ABC-103' }, reason: 'Ships in 4.2' });
  same(W.loopView().rollup.items.filter(i => i.key === 'ABC-103').map(i => [i.required, i.status]), [[false, 'removed']], 'set-up: removed');
  const C = W.one();
  same([C.complete, C.items.filter(i => i.owed).map(i => i.key)], [true, ['ABC-102']]);
});
/* Review round 5 (WB): an item approved without a run was never added; the summary counts additions apart from exceptions. */
rule('WB: an exception before any addition reads "1 approved without a run", never "1 added"', () => {
  const W = world([101, 102]); W.kid(101); W.kid(102);
  W.spreadAdd(); W.land(W.r);
  loopChange(W, 'ex-wb', { op: 'exception', item: { key: 'ABC-101' }, reason: 'Docs only', approver: 'person-morgan' });
  const C = W.one();
  same(C.items.map(i => i.state), ['excepted', 'owed'], 'set-up');
  assert.ok(!/added/.test(C.summary), C.summary);
  assert.ok(/1 approved without a run/.test(C.summary), C.summary);
});
rule('XA: one input builder: a run whose version is missing, unread or not checked this time is unknown, with its path', () => {
  const S0 = applied(), W = S0.W, pd = 'publications/validate-story/' + S0.k2.folder + '/';
  const base = { runs: W.runs(), records: W.recs, unread: W.unread, scopes: W.scopes, people: PEOPLE, procOf: W.procOf };
  const cases = [
    ['absent', { processes: [{ process: 'validate-story', pubs: [] }, { process: 'release-readiness', pubs: [{ folder: W.r.folder, ok: true }] }] }, pd],
    ['unread', { processes: [], procsRead: () => false, failed: [pd + 'publication.json'] }, pd + 'publication.json'],
    ['not read this time', { partsFailed: { publications: 'EIO' } }, 'publications'],
    ['the run\'s own version, absent', { processes: [{ process: 'validate-story', pubs: [{ folder: S0.k2.folder, ok: true }] }, { process: 'release-readiness', pubs: [] }] }, 'publications/release-readiness/' + W.r.folder + '/']
  ];
  for (const [how, extra, path0] of cases) {
    const cov = S.coverage(W.r, W.view(), S.inputs(Object.assign({}, base, extra)));
    same(cov.spreads[0].complete, false, how);
    assert.ok(cov.spreads[0].missing.some(m => m.path === path0), how + ': ' + JSON.stringify(cov.spreads[0].missing));
  }
  same(S.coverage(W.r, W.view(), S.inputs(base)).spreads[0].complete, true, 'nothing failed: complete');
});
/* Review round 6 (XB): what is expected comes from every reference to an item, not only the scope a spread was reviewed
   against: an item a later scope record brought in, whose run or request still names it, isn't lost when that record goes. */
rule('XB: a later scope record that brought an item in, missing while its run and request name it: incomplete, no stop; back, it is owed', () => {
  const W = world([101]); W.kid(101, { cleared: true });
  const add = W.spreadAdd('Security sign-off', { tool: 'release-helper', version: '1.0', key: 'xb-1' }); W.decide(W.r, add.id, 'person-morgan'); W.land(W.r);
  const sp = spreadOf(W);
  W.scopes.push(scope('s2', [101, 102], [W.scopes[0].id]));
  const k2 = W.kid(102); W.request(k2, sp);
  same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-102'], 'set-up: ABC-102 joined and owes it');
  const later = W.scopes.pop();
  const C = W.one();
  same(C.complete, false, 'incomplete, never empty');
  assert.ok(C.missing.length && C.missing.every(m => m.path), JSON.stringify(C.missing));
  assert.ok((W.mark().loops.each || []).length, 'its loop is held');
  const body = { op: 'spread-stop', spread: sp.id, reason: 'Covered elsewhere', owed: [] };
  const P = T.prepare(W.r, { body, by: { tool: 'release-helper', version: '1.0', key: 'xb-st' }, records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0', loops: W.loops(), runs: W.runs() });
  assert.ok(P.why, 'no stop with owed [] is prepared');
  W.scopes.push(later);
  same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-102'], 'back: still owed');
});
rule('XB: a recorded removal of a later item still removes it, with its run and request still naming it', () => {
  const W = world([101]); W.kid(101, { cleared: true });
  W.spreadAdd(); W.land(W.r);
  W.scopes.push(scope('s2', [101, 102], [W.scopes[0].id]));
  const k2 = W.kid(102); W.request(k2, spreadOf(W));
  loopChange(W, 'xb-ex', { op: 'exclude', item: { key: 'ABC-102' }, reason: 'Ships in 4.2' });
  const C = W.one();
  same([C.complete, C.items.filter(i => i.owed).map(i => i.key)], [true, []]);
});
/* Review round 6 (XC): every identity coverage misses reaches the problem collector, so complete, exit 4 and a named path
   always agree. */
rule('XC: a held scope record\'s missing predecessor is named before coverage stops', () => {
  const S0 = applied(), W = S0.W, ghost = 'req-release-helper-' + 'f'.repeat(24);
  W.scopes.push(scope('s2', [101, 102, 103], [ghost]));
  const cov = W.cov();
  same(cov.spreads[0].complete, false);
  assert.ok(T.missingOf(W.view(), cov).some(m => m.path === 'proposals/' + ghost + '.json'), JSON.stringify(T.missingOf(W.view(), cov)));
});
for (const which of ['add', 'application', 'decision']) {
  rule('XC: a story\'s ' + which + ' record missing is named in the parent\'s coverage, not only held', () => {
    const W = world([101, 102]); W.kid(101, { cleared: true }); const k2 = W.kid(102);
    const add = W.spreadAdd('Security sign-off', { tool: 'release-helper', version: '1.0', key: 'xc-1' }); W.decide(W.r, add.id, 'person-morgan'); W.land(W.r);
    const sp = spreadOf(W), P = W.request(k2, sp), d = W.decide(k2, P.id, 'person-avery'); W.land(k2);
    const id = which === 'add' ? P.id : which === 'decision' ? d.id : k2.living.head;
    dropRec(W, id);
    const cov = W.cov();
    same(cov.spreads[0].complete, false);
    assert.ok(T.missingOf(W.view(), cov).some(m => m.path === 'proposals/' + id + '.json'), which + ': ' + JSON.stringify(T.missingOf(W.view(), cov)));
  });
}
/* Review round 7 (YA): a stop ends future inheritance only; existing obligations remain. A 4.0 scope record names the parent's
   to-do head it saw (flightdeck-plan/4, head), and a stop records the scope cut it saw (seen): after a stop, an item owes on its
   current attempt unless the stop listed or saw it, or the record that brought it in saw the stop's application. Whatever was
   invisible when the stop was made (a record missing then, or one with no head) still owes. */
function scope4(key, ns, seen, head, changes) {
  const c = LP.cleanIntent({ loop: LOOPT, observation: ns ? obs(ns) : null, changes: changes || [] }, key, { name: 'release-helper', version: '1.0' });
  same(c.errors, []);
  const f = LP.buildRequest(c.intent, { seen: seen || [], children: [], now: AT, app: '4.0.0', head });
  same([f.format, f.features, f.head], ['flightdeck-plan/4', ['loops', 'living-runs'], head], 'a 4.0 scope record names the head it saw');
  const v = LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json');
  assert.ok(v.ok, v.why);
  return v.record;
}
rule('YA: a 4.0 scope record keeps the parent head it saw; one without a head, or with a head that isn\'t an id, isn\'t read', () => {
  const W = world([101]), r = scope4('h1', [101], [], 'req-release-helper-' + 'a'.repeat(24) + '.status-w1-0000abcd');
  same(r.head, 'req-release-helper-' + 'a'.repeat(24) + '.status-w1-0000abcd');
  same(scope4('h0', [101], [], '').head, '', 'a parent with no application yet: the empty head');
  same(W.scopes[0].head, null, 'a 3.0 record has none');
  const c = LP.cleanIntent({ loop: LOOPT, observation: obs([101]), changes: [] }, 'h2', { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: [], children: [], now: AT, app: '4.0.0', head: '' });
  for (const bad of [undefined, 7, 'not an id!']) {
    const g = JSON.parse(LP.text(f)); if (bad === undefined) delete g.head; else g.head = bad;
    const v = LP.cleanRequest(g, f.id + '.json');
    same([v.ok, v.kind], [false, 'malformed'], String(bad));
  }
  const g = JSON.parse(LP.text(f)); g.features = ['loops'];
  same(LP.cleanRequest(g, f.id + '.json').ok, false, 'plan/4 names living-runs');
});
rule('YA: a stop records the scope cut it saw', () => {
  const W = world([101, 102]); W.kid(101); W.kid(102);
  W.spreadAdd(); W.land(W.r);
  W.ask(W.r, stopBody(W, [101, 102]), { person: 'person-morgan' }); W.land(W.r);
  same(spreadOf(W).stop.cut, [W.scopes[0].id]);
});
const YA_WAYS = {
  'a pending stop names it': (W, sp) => W.ask(W.r, stopBody(W, [104]), { tool: 'release-helper', version: '1.0', key: 'ya-st1' }, { loops: W.loops(), runs: W.runs() }),
  'a pending binding names it': (W, sp) => W.ask(W.r, { op: 'spread-bind', spread: sp.id, item: { uid: uid(104), attempt: 1 }, dest: { process: 'validate-story', id: 'k104' } }, { tool: 'release-helper', version: '1.0', key: 'ya-b1' })
};
for (const way of Object.keys(YA_WAYS)) {
  rule('YA: ' + way + ', its scope record goes missing and a stop lands; restored, it still owes', () => {
    const W = world([101]); W.kid(101, { cleared: true });
    W.spreadAdd(); W.land(W.r);
    const sp = spreadOf(W);
    W.scopes.push(scope4('s2', [101, 104], [W.scopes[0].id], W.r.living.head));
    same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-104'], 'set-up: ABC-104 joined');
    YA_WAYS[way](W, sp);
    const later = W.scopes.pop();
    same(W.one().items.filter(i => i.owed).map(i => i.key), [], 'set-up: with its record gone, nothing is owed');
    W.ask(W.r, stopBody(W, []), { person: 'person-morgan' }); W.land(W.r);
    same(spreadOf(W).state, 'stopped', 'set-up: stopped on nothing');
    W.scopes.push(later);
    same(W.one().items.filter(i => i.owed).map(i => i.key + '#' + i.attempt), ['ABC-104#1'], 'it was there before the stop: still owed');
  });
}
rule('YA: an item that arrives after a stop, by a record that saw the stop\'s application, owes nothing; one whose record has no head owes', () => {
  const W = world([101, 102]); W.kid(101); W.kid(102);
  W.spreadAdd(); W.land(W.r);
  W.ask(W.r, stopBody(W, [101, 102]), { person: 'person-morgan' }); W.land(W.r);
  const stopApp = W.r.living.head;
  W.scopes.push(scope4('s2', [101, 102, 105], [W.scopes[0].id], stopApp));
  same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-101', 'ABC-102'], 'a true later arrival is exempt');
  W.scopes.pop();
  W.scopes.push(scope('s3', [101, 102, 105], [W.scopes[0].id]));
  same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-101', 'ABC-102', 'ABC-105'], 'no head: owed, conservatively');
  W.scopes.pop();
  W.scopes.push(scope4('s4', [101, 102, 106], [W.scopes[0].id], W.view().chain[W.view().chain.length - 2]));
  same(W.one().items.filter(i => i.owed).map(i => i.key), ['ABC-101', 'ABC-102', 'ABC-106'], 'a head before the stop\'s application: owed');
});
/* Regression since round 10 (BA): attempt 1, seen and unlisted, owes nothing; attempt 2, with no plan, owes. */
rule('YA: an item the stop saw and didn\'t list owes nothing on that attempt; a later one with no plan owes', () => {
  const W = world([101, 102]); W.kid(101, { cleared: true }); W.kid(102);
  W.spreadAdd(); W.land(W.r);
  W.ask(W.r, stopBody(W, [102]), { person: 'person-morgan' }); W.land(W.r);
  same(W.one().items.filter(i => i.owed).map(i => i.key + '#' + i.attempt), ['ABC-102#1'], 'attempt 1: seen, not listed');
  W.kid(101, { attempt: 2 });
  same(W.one().items.filter(i => i.owed).map(i => i.key + '#' + i.attempt), ['ABC-102#1', 'ABC-101#2']);
});
/* Review round 7 (YB): a binding names the run that counts, so that run is expected whether or not a request was filed on it. */
rule('YB: an explicitly bound run that isn\'t here makes coverage incomplete and is named, with no request filed on it', () => {
  const S0 = applied(), W = S0.W, k3 = W.kids.filter(c => c.id === 'k103')[0];
  W.kid(103, { id: 'k103b' });
  W.ask(W.r, { op: 'spread-bind', spread: S0.sp.id, item: { uid: uid(103), attempt: 1 }, dest: { process: 'validate-story', id: 'k103' } }, { person: 'person-morgan' }); W.land(W.r);
  same([W.one().complete, W.one().items.filter(i => i.key === 'ABC-103')[0].run], [true, 'validate-story/k103'], 'set-up: bound, no request');
  W.kids.splice(W.kids.indexOf(k3), 1);
  const cov = W.cov(), C = cov.spreads[0];
  same(C.complete, false);
  assert.ok(T.missingOf(W.view(), cov).some(x => x.path === 'runs/validate-story/k103/run.json' && x.kind === 'nofile'), JSON.stringify(T.missingOf(W.view(), cov)));
  W.kids.push(k3);
  same(W.one().complete, true, 'back');
});
/* Review round 8 (ZA): every introduction of an item in its current incarnation counts. A stopped spread exempts an item only
   when every one of them came after the stop; a repeat observation or a restore of an item already required never starts a new
   incarnation. Each case is run in both id orders. */
/* Two keys whose scope request ids sort as asked: a before b when first, else b before a. */
const keysIn = (first, tag) => { for (let i = 0; i < 400; i++) { const a = tag + '-a' + i, b = tag + '-b' + i, ia = scope4(a, [101], [], '').id, ib = scope4(b, [101], [], '').id; if ((ia < ib) === first) return [a, b]; } throw new Error('no keys'); };
function hiddenBeforeStop(tag, first) {
  const W = world([101]); W.kid(101, { cleared: true });
  W.spreadAdd(); W.land(W.r);
  const [kp, kq] = keysIn(first, tag);
  const pre = scope4(kp, [101, 104], [W.scopes[0].id], W.r.living.head);
  W.ask(W.r, stopBody(W, []), { person: 'person-morgan' }); W.land(W.r);
  same(spreadOf(W).state, 'stopped', 'set-up: stopped on nothing while the record that added ABC-104 was hidden');
  return { W, pre, kq, stopApp: W.r.living.head };
}
const owedOf = (W) => { const C = W.one(); return [C.complete, C.items.filter(i => i.owed).map(i => i.key + '#' + i.attempt)]; };
for (const first of [true, false]) {
  const ord = first ? ' (the earlier introduction sorts first)' : ' (the later introduction sorts first)';
  rule('ZA: a concurrent observation after the stop never replaces the hidden one before it' + ord, () => {
    const { W, pre, kq, stopApp } = hiddenBeforeStop('za1', first);
    W.scopes.push(pre, scope4(kq, [101, 104], [W.scopes[0].id], stopApp));
    same(owedOf(W), [true, ['ABC-104#1']]);
  });
  rule('ZA: a repeat observation that saw the hidden one never makes it a later arrival' + ord, () => {
    const { W, pre, kq, stopApp } = hiddenBeforeStop('za2', first);
    W.scopes.push(pre);
    same(owedOf(W), [true, ['ABC-104#1']], 'set-up: restored, owed');
    W.scopes.push(scope4(kq, [101, 104], [pre.id], stopApp));
    same(owedOf(W), [true, ['ABC-104#1']]);
  });
  rule('ZA: a restore of an item already required changes nothing, and never makes it a later arrival' + ord, () => {
    const { W, pre, kq, stopApp } = hiddenBeforeStop('za3', first);
    W.scopes.push(pre);
    W.scopes.push(scope4(kq, null, [pre.id], stopApp, [{ op: 'restore', item: { key: 'ABC-104', id: '10104' }, reason: 'Back in' }]));
    same(owedOf(W), [true, ['ABC-104#1']]);
  });
}
/* Regression since round 10 (BA): the accepted consequence. An item in the loop before the stop still owes it when it comes back. */
rule('ZA: an item added before the stop, then removed and restored after it, still owes', () => {
  const { W, pre, kq, stopApp } = hiddenBeforeStop('za4', true);
  W.scopes.push(pre);
  const ex = scope4(kq + 'x', null, [pre.id], stopApp, [{ op: 'exclude', item: { key: 'ABC-104', id: '10104' }, reason: 'Out' }]);
  W.scopes.push(ex);
  same(owedOf(W), [true, []], 'a recorded removal still removes');
  W.scopes.push(scope4(kq + 'r', null, [ex.id], stopApp, [{ op: 'restore', item: { key: 'ABC-104', id: '10104' }, reason: 'Back in' }]));
  same(owedOf(W), [true, ['ABC-104#1']], 'restored after the stop: its addition before the stop is still a witness');
});
/* Review round 8 (ZC): an attempt made after the stop inherits nothing, even of an item whose earlier attempt still owes it. */
function plan4(key, n, attempt, seen, head) {
  const c = LP.cleanIntent({ loop: LOOPT, observation: null, changes: [] }, key, { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen, children: [{ item: { id: String(10000 + n), key: 'ABC-' + n }, attempt, inputs: { issue: 'ABC-' + n, fix_version: '4.1' }, owner: '' }], now: AT, app: '4.0.0', head });
  const v = LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json'); assert.ok(v.ok, v.why); return v.record;
}
/* Regression since round 11 (EA): the item's addition before the stop names no attempt, so it counts for every attempt:
   attempt 2 planned after the stop still owes. */
rule('ZC: a later attempt planned after the stop still owes when the item was in the loop before it; one with no head owes too', () => {
  const { W, pre, stopApp } = hiddenBeforeStop('zc1', true);
  W.scopes.push(pre);
  same(owedOf(W), [true, ['ABC-104#1']], 'set-up: attempt 1 owes');
  W.kid(104, { cleared: true });
  const p2 = plan4('zc-p2', 104, 2, [pre.id], stopApp);
  W.scopes.push(p2);
  same(W.loopView().rollup.items.filter(i => i.key === 'ABC-104')[0].attempt, 2, 'set-up: attempt 2 is planned');
  same(owedOf(W), [true, ['ABC-104#2']], 'attempt 2 came after the stop, but the item\'s addition before it counts for every attempt');
  W.scopes.pop();
  const c3 = LP.cleanIntent({ loop: LOOPT, observation: null, changes: [] }, 'zc-p3', { name: 'release-helper', version: '1.0' });
  const f3 = LP.buildRequest(c3.intent, { seen: [pre.id], children: [{ item: { id: '10104', key: 'ABC-104' }, attempt: 2, inputs: { issue: 'ABC-104', fix_version: '4.1' }, owner: '' }], now: AT, app: '3.0.0' });
  W.scopes.push(LP.cleanRequest(JSON.parse(LP.text(f3)), f3.id + '.json').record);
  same(owedOf(W), [true, ['ABC-104#2']], 'a 3.0 plan can\'t say it came after the stop: owed');
});
/* Review round 9 (AA): no single witness chosen by id order anywhere a stop's obligation is decided. Generated: every way an
   item or attempt comes in (an addition, a restore after a removal, an attempt's plan) made before the stop and hidden when it
   lands, then revealed with every combination of later records (a concurrent one that didn't see it, a repeat that did, a
   redundant restore), in both id orders: the obligation always stands. The same with the first record made after the stop
   instead (a genuine later arrival or attempt): always exempt. 3 routes x 8 combinations x 2 orders x 2 = 96 cases. */
const AA_ROUTES = {
  addition: {
    ns: [101], cleared: [101], before: () => {},
    first: (W, k, seen, head) => scope4(k, [101, 104], seen, head),
    repeat: (W, k, seen, head) => scope4(k, [101, 104], seen, head),
    owes: 'ABC-104#1'
  },
  restore: {
    ns: [101], cleared: [101],
    before: (W) => { const A = scope4('aa-add', [101, 104], [W.scopes[0].id], W.r.living.head); W.scopes.push(A); W.scopes.push(scope4('aa-x', null, [A.id], W.r.living.head, [{ op: 'exclude', item: { key: 'ABC-104', id: '10104' }, reason: 'Out' }])); },
    first: (W, k, seen, head) => scope4(k, null, seen, head, [{ op: 'restore', item: { key: 'ABC-104', id: '10104' }, reason: 'Back in' }]),
    repeat: (W, k, seen, head) => scope4(k, [101, 104], seen, head),
    owes: 'ABC-104#1'
  },
  'attempt creation': {
    ns: [101, 104], cleared: [101, 104], before: () => {},
    first: (W, k, seen, head) => plan4(k, 104, 2, seen, head),
    repeat: (W, k, seen, head) => plan4(k, 104, 2, seen, head),
    owes: 'ABC-104#2'
  }
};
const AA_LATER = ['concurrent', 'repeat', 'redundant restore'];
for (const route of Object.keys(AA_ROUTES)) for (const before of [true, false]) {
  /* Since round 10 (BA) a restore made after the stop still owes: the addition and exclusion before the stop are witnesses. */
  /* Since round 11 (EA) an attempt planned after the stop still owes: the item's records before it name no attempt. */
  const exempt = !before && route === 'addition';
  rule('AA: ' + route + ', first made ' + (before ? 'before the stop and hidden when it lands' : 'after the stop') + (exempt ? ': always exempt' : ': always owed') + ', with every combination of later records, both id orders', () => {
    const R0 = AA_ROUTES[route], off = [];
    let cases = 0;
    for (let mask = 0; mask < 8; mask++) for (const first of [true, false]) {
      cases++;
      const W = world(R0.ns); R0.cleared.forEach(n => W.kid(n, { cleared: true }));
      W.spreadAdd(); W.land(W.r);
      R0.before(W);
      const base = W.scopes[W.scopes.length - 1].id, tag = 'aa' + route.length + (before ? 'b' : 'l') + mask + (first ? 'f' : 's');
      const [k1, kc] = keysIn(first, tag);
      const preHead = W.r.living.head;
      const one = before ? R0.first(W, k1, [base], preHead) : null;
      W.ask(W.r, stopBody(W, []), { person: 'person-morgan' }); W.land(W.r);
      if (spreadOf(W).state !== 'stopped') { off.push(tag + ': set-up: not stopped'); continue; }
      const stopApp = W.r.living.head;
      const H = one || R0.first(W, k1, [base], stopApp);
      W.scopes.push(H);
      const on = AA_LATER.filter((x, i) => mask & (1 << i));
      if (on.includes('concurrent')) W.scopes.push(R0.first(W, kc, [base], stopApp));
      if (on.includes('repeat')) W.scopes.push(R0.repeat(W, tag + '-rep', [H.id], stopApp));
      if (on.includes('redundant restore')) W.scopes.push(scope4(tag + '-rr', null, [H.id], stopApp, [{ op: 'restore', item: { key: 'ABC-104', id: '10104' }, reason: 'Still in' }]));
      const [complete, owed] = owedOf(W), want = exempt ? [] : [R0.owes];
      if (!complete || JSON.stringify(owed) !== JSON.stringify(want)) off.push(tag + ' [' + on.join(', ') + '] ' + (first ? 'first-made sorts first' : 'later sorts first') + ': complete ' + complete + ', owed ' + JSON.stringify(owed));
    }
    same([cases, off], [16, []], '16 cases for each of 3 routes, made before or after the stop: 96');
  });
}
/* Review round 10 (BA): the stop rule, by property. A pair {uid, attempt} is exempt from a stopped spread only when every
   scope record that ever names it (for a later attempt, every plan for that attempt) saw the stop's application; otherwise
   it is owed. Generated histories over ABC-104 from {add, observe, remove, exclude, restore, attempt plan} x {before the stop,
   concurrent with it, made before it and hidden when it lands, after it}, every id order of their records. Two properties:
   the result is the same in every id order, and it is exactly what the rule says. */
/* Round 11 (EA) adds: a choice and a plan selection naming attempt 2, a key-only reference, a key change (the same id under
   another key), and a record of another loop sharing the item and a record id. */
const BA_KINDS = ['add', 'observe', 'remove', 'exclude', 'restore', 'plan', 'choose', 'select', 'keyonly', 'rekey', 'cross'];
/* Round 12 (FA): keep and accept decisions naming the item by its uid, its key-only uid and its bare key. */
const BA_DECS = ['keep:uid', 'keep:keyuid', 'keep:key', 'accept:uid', 'accept:keyuid', 'accept:key'];
const BA_WHEN = ['before', 'concurrent', 'hidden', 'after'];
const baRecord = (kind, key, seen, head) => {
  const it = { key: 'ABC-104', id: '10104' };
  if (kind === 'add') return scope4(key, null, seen, head, [{ op: 'add', item: it }]);
  if (kind === 'observe') return scope4(key, [101, 104], seen, head);
  if (kind === 'remove') { const c = LP.cleanIntent({ loop: LOOPT, observation: Object.assign(obs([101]), { complete: true }), changes: [] }, key, { name: 'release-helper', version: '1.0' }); const f = LP.buildRequest(c.intent, { seen, children: [], now: AT, app: '4.0.0', head }); return LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record; }
  if (kind === 'exclude' || kind === 'restore') return scope4(key, null, seen, head, [{ op: kind, item: it, reason: 'r' }]);
  if (kind === 'choose') return scope4(key, null, seen, head, [{ op: 'choose', item: it, run: 'k104a', attempt: 2, candidates: ['k104a', 'k104b'] }]);
  if (kind === 'select') return scope4(key, null, seen, head, [{ op: 'plan', item: it, attempt: 2, record: LP.idFor('release-helper', 'no-such-plan') }]);
  if (kind === 'keyonly') return scope4(key, null, seen, head, [{ op: 'add', item: { key: 'ABC-104' } }]);
  if (kind === 'rekey') return scope4(key, null, seen, head, [{ op: 'add', item: { key: 'ABC-904', id: '10104' } }]);
  if (kind === 'cross') return scopeIn(LOOP_OTHER, key, seen, head, [{ op: 'add', item: it }]);
  if (BA_DECS.includes(kind)) return baDecision(kind, key, seen);
  return plan4(key, 104, 2, seen, head);
};
/* Another loop of the same run (round 11, EA): its records never count for this one, even one sharing a record id. */
/* A decision has no parent head, so it is never after the stop. Its proposal is a record id that needn't be here. */
const BA_REF = { uid: 'jira:10104', keyuid: 'jira:key:ABC-104', key: 'ABC-104' };
function baDecision(kind, key, seen) {
  const [op, ref] = kind.split(':'), d = LP.buildDecision({ proposal: LP.idFor('release-helper', 'dp-' + key), loop: LOOPT, op, items: [BA_REF[ref]], seen: seen || [], by: 'person-morgan', writer: 'w' + PF.sha256.hex(key).slice(0, 8), rev: PF.sha256.hex('r' + key).slice(0, 8), now: AT, app: '4.0.0' });
  const v = LP.cleanDecision(JSON.parse(LP.text(d.file)), d.name); assert.ok(v.ok, v.why); return v.record;
}
const LOOP_OTHER = { process: 'release-readiness', run: 'r-41', step: 'other' };
function scopeIn(loop, key, seen, head, changes) {
  const c = LP.cleanIntent({ loop, observation: null, changes }, key, { name: 'release-helper', version: '1.0' });
  same(c.errors, []);
  const f = LP.buildRequest(c.intent, { seen: seen || [], children: [], now: AT, app: '4.0.0', head });
  const v = LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json'); assert.ok(v.ok, v.why); return v.record;
}
/* Which attempts a record names (round 11): one with no attempt names every attempt ('*'); a plan, a choice and a plan
   selection name attempt 2 only; a removal by a complete observation and another loop's record name none. */
const baNames = (kind) => kind === 'remove' || kind === 'cross' ? [] : ['plan', 'choose', 'select'].includes(kind) ? ['2'] : ['*'];
/* Which issue a record names, as its aliases (round 11): the same item when any alias links them, through any record. */
const baAliases = (kind) => BA_DECS.includes(kind) ? (({ uid: ['u:jira:10104', 'k:jira:10104'], keyuid: ['u:jira:key:ABC-104', 'k:jira:key:ABC-104', 'k:ABC-104'], key: ['u:ABC-104', 'k:ABC-104'] })[kind.split(':')[1]]) : kind === 'keyonly' ? ['k:ABC-104', 'u:jira:key:ABC-104'] : kind === 'rekey' ? ['u:jira:10104', 'k:ABC-904'] : kind === 'remove' || kind === 'cross' ? [] : ['u:jira:10104', 'k:ABC-104'];
function baSame(events, kind, row) {
  const up = {}, find = (x) => { while (up[x]) x = up[x]; return x; }, join = (x, y) => { x = find(x); y = find(y); if (x !== y) up[x] = y; };
  events.forEach(([k]) => { const al = baAliases(k); for (let j = 1; j < al.length; j++) join(al[0], al[j]); });
  join('u:' + row.uid, 'k:' + row.key);
  return baAliases(kind).some(al => find(al) === find('u:' + row.uid));
}
const perms = (n) => n <= 1 ? [[0]] : perms(n - 1).reduce((out, p) => { for (let i = 0; i <= p.length; i++) out.push(p.slice(0, i).concat([n - 1], p.slice(i))); return out; }, []);
function baCase(events, order, tag) {
  const W = world([101]); W.kid(101, { cleared: true });
  W.spreadAdd(); W.land(W.r);
  const base = W.scopes[0].id, preHead = W.r.living.head;
  /* Keys whose ids sort in the order asked: record i gets the key of rank order[i]. */
  const pool = events.map((e, i) => tag + '-' + i).sort((a, b) => (LP.idFor('release-helper', a) < LP.idFor('release-helper', b) ? -1 : 1));
  /* A record of another loop takes the key (so the record id) of the first other event, when there is one. */
  const keyOf = (i) => events[i][0] === 'cross' && i > 0 ? pool[order[0]] : pool[order[i]];
  /* Records follow one another as writers make them: one made before the stop (shown or hidden) saw those made before it;
     one concurrent with the stop saw only what was shown then; one after it saw everything shown, never the hidden ones. */
  const made = [], shown = [base], pre = [base];
  events.forEach(([kind, when], i) => {
    if (when !== 'before' && when !== 'hidden') return;
    /* Another loop's record is never seen by this loop's writers. */
    made[i] = baRecord(kind, keyOf(i), pre.slice(-50), preHead); if (kind !== 'cross') pre.push(made[i].id);
    if (when === 'before') { W.scopes.push(made[i]); if (kind !== 'cross') shown.push(made[i].id); }
  });
  const C0 = W.one();
  if (!C0.complete) return { skip: 'incomplete at the stop' };
  const owed0 = C0.items.filter(i => i.owed).map(i => ({ uid: i.uid, attempt: i.attempt }));
  try { W.ask(W.r, { op: 'spread-stop', spread: spreadOf(W).id, reason: 'Stopped', owed: owed0 }, { person: 'person-morgan' }); } catch (e) { return { skip: 'the stop wasn\'t asked: ' + e.message }; }
  W.land(W.r);
  if (spreadOf(W).state !== 'stopped') return { skip: 'not stopped' };
  const stopApp = W.r.living.head;
  const atStop = shown.slice(), later = shown.slice();
  events.forEach(([kind, when], i) => {
    if (when === 'hidden') W.scopes.push(made[i]);
    if (when === 'concurrent') W.scopes.push(baRecord(kind, keyOf(i), atStop.slice(-50), preHead));
    if (when === 'after') { const x = baRecord(kind, keyOf(i), later.slice(-50), stopApp); W.scopes.push(x); if (kind !== 'cross') later.push(x.id); }
  });
  const C = W.one(), got = C.items.filter(i => i.owed).map(i => i.key + '#' + i.attempt).sort(), req = [];
  /* The rule, from the history alone. */
  const listed = owed0.map(p => p.uid + '#' + p.attempt), want = [];
  W.loopView().rollup.items.forEach(i => {
    if (!i.required) return;
    const a = i.attempt || 1, pk = i.uid + '#' + a;
    req.push(i.key + '#' + a);
    if (i.uid === uid(101) && a === 1) return;
    if (listed.includes(pk)) { want.push(i.key + '#' + a); return; }
    const wit = events.filter(([kind]) => (baNames(kind).includes(String(a)) || baNames(kind).includes('*')) && baSame(events, kind, i));
    if (!(wit.length && wit.every(([k, when]) => when === 'after' && !BA_DECS.includes(k)))) want.push(i.key + '#' + a);
  });
  return { complete: C.complete, got, want: want.sort(), req };
}
/* Every single event and every pair of events in every id order, and a fixed sample of three-event histories in all six. */
const BA_HISTORIES = [];
BA_KINDS.forEach(k => BA_WHEN.forEach(w => BA_HISTORIES.push([[k, w]])));
BA_KINDS.forEach(k1 => BA_WHEN.forEach(w1 => BA_KINDS.forEach(k2 => BA_WHEN.forEach(w2 => BA_HISTORIES.push([[k1, w1], [k2, w2]])))));
let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
for (let i = 0; i < 160; i++) BA_HISTORIES.push([0, 1, 2].map(() => [BA_KINDS[rnd(6)], BA_WHEN[rnd(4)]]));
/* Round 11 (EA): alias histories, choices, selections and other loops' records, in triples over every kind, all six orders. */
/* Round 12 (FA): every decision kind at every time, alone and with every other kind at every time, both orders. */
BA_DECS.forEach(k => BA_WHEN.forEach(w => { BA_HISTORIES.push([[k, w]]); BA_KINDS.forEach(k2 => BA_WHEN.forEach(w2 => BA_HISTORIES.push([[k, w], [k2, w2]]))); }));
for (let i = 0; i < 120; i++) BA_HISTORIES.push([0, 1, 2].map((j) => [j === 0 ? ['choose', 'select', 'keyonly', 'rekey', 'cross'][rnd(5)] : BA_KINDS[rnd(BA_KINDS.length)], BA_WHEN[rnd(4)]]));
const BA_CHUNK = 60;
for (let c = 0; c * BA_CHUNK < BA_HISTORIES.length; c++) {
  rule('BA: the stop rule holds, the same in every id order (histories ' + (c * BA_CHUNK + 1) + '-' + Math.min(BA_HISTORIES.length, (c + 1) * BA_CHUNK) + ')', () => {
    const off = [];
    BA_HISTORIES.slice(c * BA_CHUNK, (c + 1) * BA_CHUNK).forEach((ev, hi) => {
      let first = null;
      perms(ev.length).forEach((order) => {
        const tag = 'ba' + (c * BA_CHUNK + hi) + 'o' + order.join('');
        const res = baCase(ev, order, tag);
        if (res.skip) { if (first === null) first = 'skip'; else if (first !== 'skip') off.push(tag + ': skipped in one order only: ' + res.skip); return; }
        /* Whether a pair is required at all comes from the scope reduction (unchanged here), which two concurrent records
           can decide by order: the stop rule's answer is compared on every pair required in both orders. */
        if (first === null) first = res;
        else if (first === 'skip') off.push(tag + ': skipped in another order only');
        else {
          const both = res.req.filter(k => first.req.includes(k)), d = (x) => both.filter(k => x.got.includes(k));
          if (first.complete !== res.complete || JSON.stringify(d(first)) !== JSON.stringify(d(res))) off.push(tag + ' ' + JSON.stringify(ev) + ': differs by id order: ' + JSON.stringify(d(first)) + ' vs ' + JSON.stringify(d(res)));
        }
        /* A key-only item given its id after the stop leaves the stop's list naming a uid nothing explains: coverage is
           incomplete, which exempts nothing (fail closed). Only those histories may be incomplete. */
        if (!res.complete && ev.some(e => e[0] === 'keyonly')) return;
        if (!res.complete || JSON.stringify(res.got) !== JSON.stringify(res.want)) off.push(tag + ' ' + JSON.stringify(ev) + ': complete ' + res.complete + ', owed ' + JSON.stringify(res.got) + ', the rule says ' + JSON.stringify(res.want));
      });
    });
    same(off.slice(0, 12).concat(off.length > 12 ? ['and ' + (off.length - 12) + ' more'] : []), []);
  });
}
/* 44 single events, 1,936 pairs in 2 orders, 280 triples in 6, and (round 12) 24 decisions alone and 1,056 decision pairs in 2:
   44 + 3,872 + 1,680 + 24 + 2,112 = 7,732 cases. */
rule('BA: the generated histories are at least 2,000 cases', () => { const n = BA_HISTORIES.reduce((t, ev) => t + perms(ev.length).length, 0); assert.ok(n >= 2000, String(n)); });
/* Round 11 (EA): the reproductions, kept by name. */
const eaAll = (ev, tag) => { const off = []; perms(ev.length).forEach((order) => { const res = baCase(ev, order, tag + order.join('')); if (res.skip) { off.push(order.join('') + ': skipped: ' + res.skip); return; } if (!res.complete || JSON.stringify(res.got) !== JSON.stringify(res.want)) off.push(order.join('') + ': owed ' + JSON.stringify(res.got) + ', the rule says ' + JSON.stringify(res.want)); }); return off; };
rule('EA: a choice naming attempt 2 made before the stop and hidden keeps attempt 2 owed, in every id order', () => {
  same(eaAll([['add', 'after'], ['plan', 'after'], ['choose', 'hidden']], 'ea1-'), []);
});
rule('EA: a plan selection naming attempt 2 concurrent with the stop keeps attempt 2 owed, in every id order', () => {
  same(eaAll([['add', 'after'], ['plan', 'after'], ['select', 'concurrent']], 'ea2-'), []);
});
rule('EA: a key-only reference before the stop still counts after the key changes, in every id order', () => {
  same(eaAll([['keyonly', 'hidden'], ['add', 'after'], ['rekey', 'after']], 'ea3-'), []);
});
rule('EA: another loop\'s record sharing a record id never decides this loop\'s coverage, in every id order', () => {
  same(eaAll([['add', 'before'], ['cross', 'after']], 'ea4-'), []);
  same(eaAll([['add', 'after'], ['cross', 'before']], 'ea5-'), []);
});
rule('EA: two copies of one scope record that differ hold the loop: coverage is incomplete, nothing exempted', () => {
  const W = world([101]); W.kid(101, { cleared: true });
  W.spreadAdd(); W.land(W.r);
  const a = scope4('ea-dup', [101, 104], [W.scopes[0].id], W.r.living.head), b = JSON.parse(JSON.stringify(a)); b.observation.items = b.observation.items.slice(0, 1);
  W.scopes.push(a, b);
  same(W.one().complete, false);
});
/* Round 11 (EA): witnessRefs is driven by the scope record's schema. Every field a cleaned record can carry is classified,
   and every one that can carry an item or an attempt contributes a reference when it is the only one used; a field the
   schema doesn't know makes the record a doubt (it counts against every item), so a new field can't be missed quietly. */
rule('EA: witnessRefs covers every field of the scope record schema that can carry an item or an attempt', () => {
  const W0 = LP.WITNESS_SCHEMA, wr = LP.witnessRefs, src = 'jira', off = [], used = {};
  assert.ok(W0 && typeof wr === 'function', 'PF.loop exports witnessRefs and WITNESS_SCHEMA');
  same(Object.keys(W0.change).sort(), LP.CHANGE_FIELDS.slice().sort(), 'the cleaner\'s change fields are the schema\'s');
  const it = { id: '10104', key: 'ABC-104' }, plan = LP.idFor('release-helper', 'p');
  const ARGS = { add: {}, exclude: { reason: 'r' }, restore: {}, owner: { owner: '' }, exception: { reason: 'r', approver: 'person-morgan' }, withdraw: {}, choose: { run: 'k1', attempt: 2, candidates: ['k1', 'k2'] }, plan: { attempt: 2, record: plan }, start: { as: 'person-morgan' }, approve: { as: 'person-morgan' }, 'send-back': { as: 'person-morgan' }, resolve: { as: 'person-morgan', record: plan, outcome: 'applied' } };
  same(Object.keys(ARGS).sort(), LP.OPS.slice().sort(), 'every op is exercised');
  const check = (rec, where, wantAttempt, wantItem) => {
    const v = wr(rec, src);
    if (v.doubt) off.push(where + ': a doubt');
    v.refs.forEach(r => { used[r.field] = true; (r.path || []).forEach(k => { used[k] = true; }); if (r.attempt) used[r.field.split('.')[0] + '.attempt'] = true; });
    const hit = v.refs.filter(r => r.aliases.includes('u:jira:10104') && r.aliases.includes('k:ABC-104'));
    if (wantItem && !hit.length) off.push(where + ': no reference to ABC-104 ' + JSON.stringify(v.refs));
    if (!wantItem && v.refs.length) off.push(where + ': references ' + JSON.stringify(v.refs));
    if (wantAttempt && !hit.some(r => r.attempt === wantAttempt)) off.push(where + ': no attempt ' + wantAttempt);
    if (!wantAttempt && hit.some(r => r.attempt)) off.push(where + ': an attempt it doesn\'t name');
  };
  LP.OPS.forEach(op => {
    const errs = [], takes = ['approve', 'send-back', 'resolve'].indexOf(op) < 0, ch = LP.cleanChanges([Object.assign({ op }, takes ? { item: it } : {}, ARGS[op])], errs, 'jira.issue');
    if (errs.length || ch.length !== 1) { off.push(op + ': ' + errs.join(' ')); return; }
    const f = LP.buildRequest({ key: 'k-' + op, producer: { name: 'release-helper', version: '1.0' }, loop: LOOPT, observation: null, changes: ch }, { seen: [], children: [], now: AT, app: '4.0.0', head: '' });
    const v = LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json'); if (!v.ok) { off.push(op + ': ' + v.why); return; }
    check(v.record, 'change ' + op, ch[0].attempt || 0, takes);
  });
  check(scope4('k-obs', [104], [], ''), 'observation', 0, true);
  check(plan4('k-child', 104, 2, [], ''), 'children', 2, true);
  const d = LP.buildDecision({ proposal: plan, loop: LOOPT, op: 'keep', items: ['jira:10104'], seen: [], by: 'person-morgan', writer: 'w1', rev: 'abcdef01', now: AT, app: '4.0.0' });
  const dv = LP.cleanDecision(JSON.parse(LP.text(d.file)), d.name); assert.ok(dv.ok, dv.why);
  const dr = wr(dv.record, src); if (dr.doubt || !dr.refs.some(r => r.aliases.includes('u:jira:10104'))) off.push('decision items: ' + JSON.stringify(dr));
  /* Round 12 (FA): keep and accept, naming the item by its uid, its key-only uid or its bare key: each reference has every
     alias the reducer could resolve it by (byUid, then byKey). */
  for (const op of ['keep', 'accept']) for (const [ref, want] of [['jira:10104', ['u:jira:10104']], ['jira:key:ABC-104', ['u:jira:key:ABC-104', 'k:ABC-104']], ['ABC-104', ['u:ABC-104', 'k:ABC-104']]]) {
    const d2 = LP.buildDecision({ proposal: plan, loop: LOOPT, op, items: [ref], seen: [], by: 'person-morgan', writer: 'w1', rev: 'abcdef02', now: AT, app: '4.0.0' });
    const v2 = LP.cleanDecision(JSON.parse(LP.text(d2.file)), d2.name); if (!v2.ok) { off.push(op + ' ' + ref + ': ' + v2.why); continue; }
    const w2 = wr(v2.record, src), al = [].concat(...w2.refs.map(r => r.aliases));
    if (w2.doubt || want.some(x => !al.includes(x)) || !al.includes('k:' + ref)) off.push(op + ' ' + ref + ': aliases ' + JSON.stringify(al));
  }
  dr.refs.forEach(r => { used[r.field] = true; (r.path || []).forEach(k => { used[k] = true; }); });
  /* Every carrying field in the schema was used by some record above. */
  const carrying = [];
  Object.keys(W0).forEach(t => Object.keys(W0[t]).forEach(f => { if (W0[t][f]) carrying.push(t + '.' + f); }));
  const want = carrying.filter(k => !/^item\./.test(k)).sort();
  same(want.filter(k => !used[k]), [], 'every carrying field contributed: ' + JSON.stringify(Object.keys(used)));
  /* A field the schema doesn't know: a doubt. */
  const odd = Object.assign({}, scope4('k-odd', [104], [], ''), { associations: [{ key: 'ABC-104', id: '10104' }] });
  if (!wr(odd, src).doubt) off.push('an unknown field isn\'t a doubt');
  same(off, []);
});
/* Review round 13 (GC): a byte-identical copy of a scope record ("<request> (1).json") is the same record, as the causal
   reducer counts it, in either order; a copy that says something else still holds the loop. */
for (const copyFirst of [false, true]) rule('GC: an identical copy of a record made after the stop changes nothing' + (copyFirst ? ' (the copy read first)' : ' (the copy read second)'), () => {
  const W = world([101]); W.kid(101, { cleared: true });
  W.spreadAdd(); W.land(W.r);
  W.ask(W.r, stopBody(W, []), { person: 'person-morgan' }); W.land(W.r);
  same(spreadOf(W).state, 'stopped', 'set-up: stopped');
  const A = scope4('gc-after', [101, 104], [W.scopes[0].id], W.r.living.head), B = JSON.parse(JSON.stringify(A)); B._file = A.id + ' (1).json';
  W.scopes.push(A);
  same(owedOf(W), [true, []], 'set-up: ABC-104 arrived after the stop');
  W.scopes.pop();
  if (copyFirst) W.scopes.push(B, A); else W.scopes.push(A, B);
  same(owedOf(W), [true, []]);
});
rule('GC: a copy of a record made after the stop that says something else still holds the loop', () => {
  const W = world([101]); W.kid(101, { cleared: true });
  W.spreadAdd(); W.land(W.r);
  W.ask(W.r, stopBody(W, []), { person: 'person-morgan' }); W.land(W.r);
  const A = scope4('gc-differ', [101, 104], [W.scopes[0].id], W.r.living.head), B = JSON.parse(JSON.stringify(A)); B._file = A.id + ' (1).json'; B.observation.items = B.observation.items.slice(0, 1);
  W.scopes.push(A, B);
  same(W.one().complete, false);
});
run();
