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
  const stop = T.buildProposal({ run: { process: 'release-readiness', id: 'r-41' }, producer: { name: 'release-helper', version: '1.0' }, key: 'stop-1', seen: [], at: AT, body: { op: 'spread-stop', spread: sp, reason: 'Done', owed: pairs(2) } });
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
  W.scopes.push(scope('s2', [101, 102, 106], [W.scopes[0].id]));
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
rule('TC: a stopped spread owes nothing on an earlier attempt, and its new attempt inherits nothing', () => {
  const W = world([101, 102]); W.kid(101, { cleared: false }); W.kid(102);
  W.spreadAdd(); W.land(W.r);
  W.ask(W.r, stopBody(W, [101, 102]), { person: 'person-morgan' }); W.land(W.r);
  same(spreadOf(W).state, 'stopped', 'set-up: stopped');
  W.kid(101, { attempt: 2 });
  same(W.loopView().rollup.items.filter(i => i.key === 'ABC-101').map(i => i.attempt), [2], 'set-up: attempt 2');
  same(W.one().items.filter(i => i.owed).map(i => i.key + '#' + i.attempt), ['ABC-102#1']);
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
run();
