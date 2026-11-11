// Living runs (4.0, docs/design.md 45.5), slice 6: plan versus now and the receipt a living run ends with. Plan versus now
// compares the frozen checklist with the work landed and the requests not landed yet, each number with its own denominator,
// never counting a queued or waiting request as applied. A living run ends with an immutable receipt record, named in the
// same save that sets ended; what arrives after is shown apart and never rewrites the ended outcome.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), T = PF.todos, RC = PF.receipts, LP = PF.loop, R = PF.run, M = PF.map, P = PF.publish;
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const AT = '2026-11-10T09:00:00.000Z', LATER = '2026-11-10T10:00:00.000Z';
const PEOPLE = [{ id: 'person-morgan', name: 'Morgan' }, { id: 'person-avery', name: 'Avery' }];
const BOT = { tool: 'notes-bot', version: '1.0' };

const CHILD = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, fix_version, disposition:choice(cleared|needs-work)',
  'result: disposition', '---', '', '## Assess · DO-CONFIRM {#assess}', '- [!] {confirm} Read the story {#read}',
  '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release readiness', 'owner: person-morgan', 'context: fix_version', '---', '', '## Stories · DO-CONFIRM {#stories}',
  '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key, fix_version=^fix_version', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', '- [ ] {confirm} Tell the team {#tell}', ''].join('\n');
const exactOf = (files) => P.exactOf({ 'map.md': new Uint8Array(Buffer.from(files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(files['types.json'], 'utf8')) });
let seq = 0;
function publishMd(md, extra) {
  const b = P.build(md, Object.assign({ by: 'person-morgan', changes: 'x', now: AT, existing: [], rand: 's' + String(++seq).padStart(7, '0'), app: '4.0.0' }, extra || {}));
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  const v = P.verify(b.folder, b.files, exactOf(b.files)); assert.ok(v.ok, v.why); v.folder = b.folder; v.files = b.files;
  return v;
}
const procOf3 = (pubs) => { const i = P.index(pubs); return { latest: i.latest, all: i.all, clashes: i.clashes, broken: [] }; };
const story = (n) => ({ id: String(10000 + n), key: 'ABC-' + n, title: 'Story ' + n });
function scope(key, ns) {
  const obs = { source: { system: 'jira' }, generation: 'g1', query: 'fixVersion = 4.1', observedAt: '2026-11-07T09:00:00Z', items: ns.map(story), reported: ns.length, fetched: ns.length, complete: false, errors: [] };
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: 'r-41', step: 'each' }, observation: obs, changes: [] }, key, { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: [], children: [], now: AT, app: '3.0.0' });
  return LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record;
}
let revs = 0; const rev = () => (++revs).toString(16).padStart(8, '0');

function world() {
  const kp = publishMd(CHILD), procs = { 'validate-story': procOf3([kp]) }, procOf = (id) => procs[id] || null;
  const pp = publishMd(PARENT, { childProcs: procs }); procs['release-readiness'] = procOf3([pp]);
  const r = R.create(pp, { id: 'r-41', title: 'Release 4.1', by: 'person-morgan', session: 'w', now: AT, app: '4.0.0', details: { fix_version: '4.1' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
  r.recorder = { person: 'person-morgan' };
  const W = { r, pp, kp, procOf, recs: [], unread: [], scopes: [scope('s1', [101, 102, 103])], people: { people: PEOPLE } };
  W.push = (rec, name) => { rec._file = name || rec.id + '.json'; W.recs.push(rec); return rec; };
  W.inputs = (extra) => Object.assign({ records: W.recs, unread: W.unread, people: W.people, now: Date.parse(AT), loops: { records: W.scopes, unread: [], procOf: W.procOf }, runs: [W.r] }, extra || {});
  W.view = () => T.view(W.r, { records: W.recs, unread: W.unread, people: W.people });
  W.ask = (body, by, extra) => { const k = 'k-' + rev(), b = by && by.tool ? Object.assign({ key: k }, by) : by || { person: 'person-morgan' }; const Pp = T.prepare(W.r, Object.assign({ body, by: b, key: k, records: W.recs, unread: W.unread, people: W.people, at: AT, app: '4.0.0' }, extra || {})); assert.ok(!Pp.why, Pp.why); W.push(Pp.record, Pp.name); return Pp; };
  /* A request filed straight into the folder (a tool after the run ended, say), as the CLI writes one. */
  W.file = (body) => { const f = T.buildProposal({ run: { process: 'release-readiness', id: 'r-41' }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-' + rev(), seen: [], at: LATER, body }); return W.push(T.cleanFile(JSON.parse(T.text(f)), f.id + '.json').record); };
  W.accept = (id) => {
    const it = T.inbox([W.r], { records: W.recs, unread: W.unread, people: W.people, me: 'person-morgan' }).filter((x) => x.id === id)[0];
    const d = T.decide(W.r, { records: W.recs, unread: W.unread, people: W.people, request: id, op: 'accept', by: 'person-morgan', shown: it.consequence.fingerprint, at: AT, writer: 'w1', rev: rev(), app: '4.0.0' });
    assert.ok(!d.why, d.why); W.push(d.record, d.name); return d;
  };
  W.land = () => {
    for (let i = 0; i < 100; i++) {
      const V = W.view(), q = T.nextQueued(V);
      if (!q) return;
      const plan = T.applyPlan(W.r, V, q);
      if (plan.write) { const s = T.buildStatus(Object.assign({}, plan.write, { by: 'person-morgan', at: AT, writer: 'rec', rev: rev() })); W.push(T.cleanFile(JSON.parse(T.text(s.file)), s.name).record, s.name); continue; }
      if (plan.adopt) { const ae = (plan.adopt.application || plan.adopt).effect; R.todoLand(W.r, R.mapOf(W.r), plan.adopt, { who: 'person-morgan', now: AT, typesHash: W.pp.info.typesHash, app: '4.0.0', todo: ae.todo ? V.byTodo[ae.todo] || null : null }); continue; }
      assert.fail(JSON.stringify(plan));
    }
  };
  W.todo = (text, target) => { const Pp = W.ask({ op: 'add', text, target }); W.land(); return Pp.preview.todo; };
  W.compare = () => { const V = T.view(W.r, { records: W.recs, unread: W.unread, people: W.people, now: Date.parse(AT) }); return RC.compare(W.r, R.mapOf(W.r), V, null, W.inputs()); };
  W.receipt = (outcome, extra) => RC.prepare(W.r, W.inputs(Object.assign({ outcome: outcome || 'Stopped early', by: 'person-morgan', at: AT, app: '4.0.0' }, extra || {})));
  W.end = (outcome) => { const P1 = W.receipt(outcome); assert.ok(!P1.why && !P1.none, P1.why); W.push(P1.record, P1.name); R.end(W.r, R.mapOf(W.r), outcome || 'Stopped early', 'person-morgan', 'Morgan', LATER, { receipt: P1.id }); return P1; };
  return W;
}
/* A request that waits (a tool's, nobody decided it) and one a person accepted that the recorder hasn't landed yet. */
function pendingTwo(W) {
  const waits = W.ask({ op: 'add', text: 'Ask legal', target: { phase: 'ship' } }, BOT);
  const queued = W.ask({ op: 'add', text: 'Check the release notes', target: { phase: 'ship' } }, BOT);
  W.accept(queued.id);
  return { waits, queued };
}

rule('Plan versus now counts a queued or waiting addition as asked, never as applied, each with its own status', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const p = pendingTwo(W);
  const st = (id) => W.view().requests[id].status;
  same([st(p.waits.id), st(p.queued.id)], ['waiting', 'queued']);
  const C = W.compare();
  same([C.counts.asked, C.counts.added, C.counts.queued, C.counts.waiting, C.counts.todos], [3, 1, 1, 1, 1]);
  same([C.counts.applied, C.counts.pending], [1, 2], 'only the landed request is applied');
  const add = C.chips.filter((c) => c.id === 'additions')[0].words;
  assert.strictEqual(add, 'Additions: 1 of 3 asked applied · 1 queued for the recorder · 1 waiting for approval');
  assert.strictEqual(C.chips.filter((c) => c.id === 'changes')[0].words, 'Changes: 1 of 3 requests applied · 2 not applied yet');
});

rule('The Changes line counts declined requests in its total, apart from the ones not applied yet', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  for (const text of ['Ask legal', 'Ask finance']) {
    const q = W.ask({ op: 'add', text, target: { phase: 'ship' } }, BOT);
    const it = T.inbox([W.r], { records: W.recs, unread: W.unread, people: W.people, me: 'person-morgan' }).filter((x) => x.id === q.id)[0];
    const d = T.decide(W.r, { records: W.recs, unread: W.unread, people: W.people, request: q.id, op: 'decline', by: 'person-morgan', shown: it.consequence.fingerprint, at: AT, writer: 'w1', rev: rev(), app: '4.0.0' });
    assert.ok(!d.why, d.why); W.push(d.record, d.name);
  }
  const C = W.compare();
  assert.strictEqual(C.chips.filter((c) => c.id === 'additions')[0].words, 'Additions: 1 of 3 asked applied · 2 declined');
  assert.strictEqual(C.chips.filter((c) => c.id === 'changes')[0].words, 'Changes: 1 of 3 requests applied · 2 declined');
  const P1 = W.receipt('Completed');
  assert.ok(!P1.why && !P1.none, P1.why);
  assert.strictEqual(RC.words(P1.record.counts).chips.filter((c) => c.id === 'changes')[0].words, 'Changes: 1 of 3 requests applied · 2 declined', 'the receipt\'s frozen numbers read the same');
});

rule('Plan versus now keeps the checklist, its items and the to-dos on separate lines, each naming its denominator', () => {
  const W = world();
  const a = W.todo('Post the notes', { phase: 'ship' }); W.todo('Tag the build', { phase: 'ship' });
  W.ask({ op: 'done', todo: a }); W.land();
  const C = W.compare();
  same(C.lines, ['This checklist: 0 of 3 current steps answered', 'Items: 0 of 3 cleared', 'To-dos: 1 of 2 resolved']);
  assert.strictEqual(C.chips.filter((c) => c.id === 'resolutions')[0].words, 'Resolved: 1 of 2 to-dos · 1 done');
  same(C.phases.map((p) => [p.id, p.steps, p.todos, p.open]), [['stories', 1, 0, 0], ['ship', 2, 2, 1]], 'the frozen checklist\'s steps beside the work landed on each phase');
});

rule('Moved work says where it went, and the frozen checklist is never a second plan: its steps stay the version\'s', () => {
  const W = world();
  const a = W.todo('Post the notes', { phase: 'ship' }), b = W.todo('Fix the typo', { phase: 'ship' }), c = W.todo('Write it up', { phase: 'ship' });
  W.ask({ op: 'move', todo: a, to: 'ABC-9' }); W.ask({ op: 'move', todo: b, to: 'https://example.com/x' }); W.ask({ op: 'wont', todo: c, reason: 'Covered' }); W.land();
  const C = W.compare();
  assert.strictEqual(C.chips.filter((x) => x.id === 'resolutions')[0].words, 'Resolved: 3 of 3 to-dos · 1 won\'t do · 2 moved (1 to a ticket, 1 to a link)');
  same(C.phases.map((p) => p.steps), R.mapOf(W.r).phases.map((p) => p.steps.length));
});

rule('A run with no to-dos and no living marker needs no receipt: it ends exactly as in 3.0', () => {
  const W = world();
  same(W.receipt(), { none: true });
  const before = plain(W.r);
  R.end(W.r, R.mapOf(W.r), 'Stopped early', 'person-morgan', 'Morgan', LATER);
  assert.strictEqual(W.r.living, undefined);
  same(Object.keys(plain(W.r)).sort(), Object.keys(before).sort(), 'no field is added');
});

rule('A living run\'s receipt names its work head, plan versus now\'s numbers and the outcome, and reads back as written', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  pendingTwo(W);
  const P1 = W.receipt('Stopped early');
  assert.ok(!P1.why, P1.why);
  same([P1.record.kind, P1.record.head, P1.record.outcome, P1.record.counts.queued, P1.record.counts.waiting, P1.record.counts.added], ['receipt', W.r.living.head, 'Stopped early', 1, 1, 1]);
  assert.ok(/^req-receipt-[0-9a-f]{24}$/.test(P1.id));
  const back = T.cleanFile(JSON.parse(T.text(P1.file)), P1.name);
  assert.ok(back.ok, back.why); same(back.record, P1.record);
  /* Prepared again on the run as it stands it is the same file; at another time it is the same name. */
  same(W.receipt('Stopped early').file, P1.file);
  assert.strictEqual(W.receipt('Stopped early', { at: LATER }).id, P1.id);
  assert.notStrictEqual(W.receipt('Cancelled').id, P1.id, 'another outcome is another receipt');
});

rule('Ending a living run sets ended and living.receipt in the one change, and the run reads back with both', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const P1 = W.end('Stopped early');
  same([W.r.ended.outcome, W.r.living], ['Stopped early', { head: P1.record.head, receipt: P1.id }]);
  const back = R.sanitize(plain(W.r));
  assert.ok(back && !back._unrunnable, back && back._unrunnable);
  same(back.living, { head: P1.record.head, receipt: P1.id });
  same(RC.stateOf(back, W.recs, []).state, 'confirmed');
});

rule('A receipt is named only by an ended run, and a living field with anything else is refused, never cleaned', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const raw = plain(W.r);
  raw.living = { head: raw.living.head, receipt: 'req-receipt-' + '0'.repeat(24) };
  assert.ok(/hasn't ended/.test(R.sanitize(raw)._unrunnable), 'a receipt on a run that has not ended is refused');
  raw.ended = { outcome: 'Stopped early', by: 'person-morgan', byName: 'Morgan', at: LATER }; raw.state = 'stopped';
  assert.ok(!R.sanitize(plain(raw))._unrunnable);
  [{ head: raw.living.head, receipt: 'x' }, { receipt: raw.living.receipt }, { head: raw.living.head, receipt: raw.living.receipt, more: 1 }].forEach((lv) => {
    const x = plain(raw); x.living = lv;
    assert.ok(R.sanitize(x)._unrunnable, JSON.stringify(lv));
  });
  assert.throws(() => R.end(world().r, R.mapOf(W.r), 'Stopped early', 'person-morgan', 'Morgan', LATER, { receipt: 'req-receipt-' + '0'.repeat(24) }), /can't be named/, 'a run without to-dos can\'t name a receipt');
});

rule('Completion is frozen: requests filed after the end are shown apart and never change what the receipt says', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const P1 = W.end('Stopped early');
  const late = W.file({ op: 'add', text: 'One more thing', target: { phase: 'ship' }, placement: { beforeGate: 'ship-confirm' } });
  assert.strictEqual(W.view().requests[late.id].status, 'held', 'an ended run takes nothing');
  const S = RC.stateOf(W.r, W.recs, []);
  same([S.state, S.record.counts], ['confirmed', P1.counts]);
  const after = RC.since(W.r, S.record, W.recs, null);
  same(after.requests.map((x) => x.id), [late.id]);
  assert.ok(/1 request arrived after the run ended\. It stays a notice; the ended outcome is unchanged\./.test(after.lines.join(' ')), after.lines.join(' '));
  same(RC.since(W.r, S.record, W.recs.filter((x) => x.id !== late.id), null).requests, [], 'nothing arrived: nothing is said');
});

rule('A receipt that is missing, can\'t be read or says another head or outcome is a problem named by its path, never confirmed', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const P1 = W.end('Stopped early'), path = 'proposals/' + P1.id + '.json';
  const without = W.recs.filter((x) => x.kind !== 'receipt');
  same([RC.stateOf(W.r, without, []).state, RC.stateOf(W.r, without, []).path, RC.stateOf(W.r, without, []).kind], ['missing', path, 'nofile']);
  const un = RC.stateOf(W.r, without, [{ file: P1.name, why: 'It isn\'t complete JSON.', kind: 'malformed', run: null }]);
  same([un.state, un.path, un.kind], ['unread', path, 'malformed'], JSON.stringify(un));
  const other = Object.assign(plain(W.r), {}); other.ended.outcome = 'Cancelled';
  const mm = RC.stateOf(other, W.recs, []);
  same([mm.state, mm.kind], ['mismatch', 'malformed'], JSON.stringify(mm));
  assert.strictEqual(RC.stateOf(Object.assign(plain(W.r), { living: { head: W.r.living.head } }), W.recs, []).state, 'none', 'ended before receipts: said, not a problem');
});

rule('A receipt isn\'t prepared while any of the run\'s to-do records can\'t be read, its loop can\'t be read, or its chain is broken', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  W.unread.push({ file: 'req-notes-bot-' + 'a'.repeat(24) + '.json', why: 'It isn\'t complete JSON.', run: { process: 'release-readiness', id: 'r-41' } });
  assert.ok(/can't be read yet\. The receipt couldn't say what was done, so the run wasn't ended\./.test(W.receipt().why), W.receipt().why);
  W.unread.length = 0;
  assert.ok(/The loop each or its scope records can't be read here/.test(RC.prepare(W.r, W.inputs({ outcome: 'Stopped early', by: 'person-morgan', at: AT, loops: null })).why));
  const head = W.r.living.head; W.r.living.head = 'req-notes-bot-' + 'b'.repeat(24);
  assert.ok(/isn't in the folder/.test(W.receipt().why), W.receipt().why);
  W.r.living.head = head;
  assert.ok(!W.receipt().why);
});

rule('A spread whose coverage can\'t be worked out refuses the receipt instead of recording it as covered', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const V = LP.view(W.r, 'each', { records: W.scopes, unread: [], runs: [W.r], procOf: W.procOf });
  W.ask({ op: 'spread-add', loopStep: 'each', text: 'Security sign-off', child: { beforeGate: 'assess-confirm' }, scope: PF.spreads.snapshot(V) }, null, { childMap: W.kp.map }); W.land();
  assert.strictEqual(W.view().spreads.length, 1);
  const P1 = W.receipt();
  assert.ok(!P1.why, P1.why);
  same([P1.record.counts.owed, P1.record.coverage.length, P1.record.coverage[0].resolved], [3, 1, 0]);
  const P2 = RC.prepare(W.r, W.inputs({ outcome: 'Stopped early', by: 'person-morgan', at: AT, loops: { records: [], unread: [{ file: 'x.json' }], procOf: W.procOf } }));
  assert.ok(P2.why, 'no loop to read: refused');
});

rule('Every list a receipt keeps is bounded: one over its limit is refused whole when read and before anything is written', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const P1 = W.receipt();
  const keep = (n) => Array.from({ length: n }, (_, i) => 'req-keep-' + (i + 1).toString(16).padStart(24, '0'));
  const over = Object.assign(plain(P1.file), { keeps: keep(501) }); over.id = RC.idFor(over.run, over, over.by);
  const v = T.cleanFile(over, over.id + '.json');
  assert.ok(!v.ok && /"keeps" is a list of at most 500 keep ids/.test(v.why), v.why);
  const at = Object.assign(plain(P1.file), { keeps: keep(500) }); at.id = RC.idFor(at.run, at, at.by);
  assert.ok(T.cleanFile(at, at.id + '.json').ok, 'exactly at the limit reads');
  /* Preflight: 501 keeps on the run refuse the receipt, and nothing is prepared. */
  const keeps = keep(501).map((id) => ({ id, kind: 'keep', run: { process: 'release-readiness', id: 'r-41' } }));
  const P2 = RC.prepare(W.r, W.inputs({ records: W.recs.concat(keeps), outcome: 'Stopped early', by: 'person-morgan', at: AT }));
  assert.ok(/501 keeps; a receipt names at most 500\. Nothing was cut and nothing was ended\./.test(P2.why), P2.why);
  const moved = Object.assign(plain(P1.file), { head: P1.file.head.replace(/.$/, (c) => (c === '0' ? '1' : '0')) });
  assert.ok(/Its id isn't the one its run, who ended it and what it says give/.test(T.cleanFile(moved, moved.id + '.json').why), 'what it says is bound to its name');
});

rule('A receipt never enters the to-do order or the chain, and another receipt later changes nothing the run shows', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const before = W.view();
  const P1 = W.receipt(); W.push(P1.record, P1.name);
  const after = W.view();
  same([after.order, after.chain, after.heads, Object.keys(after.requests)], [before.order, before.chain, before.heads, Object.keys(before.requests)]);
});

rule('The evidence each done rested on is named in the receipt by identity, a fact\'s content or a run\'s answer and result', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const Tv = W.view();
  Tv.todos[0].state = 'done'; Tv.todos[0].support = { fact: 'req-notes-bot-' + 'c'.repeat(24), content: '0123456789abcdef' };
  same(RC.evidenceOf(Tv), [{ todo: Tv.todos[0].id, fact: 'req-notes-bot-' + 'c'.repeat(24), content: '0123456789abcdef' }]);
  Tv.todos[0].support = null; Tv.todos[0].evidence = { plan: 'plan-ev-' + 'd'.repeat(24), run: { process: 'smoke', id: 'k1' }, answer: 'a b', result: 'pass' };
  same(RC.evidenceOf(Tv), [{ todo: Tv.todos[0].id, plan: 'plan-ev-' + 'd'.repeat(24), run: { process: 'smoke', id: 'k1' }, answer: 'a b', result: 'pass' }]);
});

rule('After the end, coverage now uses the current denominator, obligations that arrived are said apart, and the receipt keeps the ended numbers', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const P1 = W.end('Stopped early'), S = RC.stateOf(W.r, W.recs, []);
  const rec = Object.assign({}, S.record, { coverage: [{ spread: 'sp-a', owed: 3, resolved: 2 }] }), frozen = JSON.stringify(rec.coverage);
  const cov = (owed, resolved, more) => ({ spreads: [{ id: 'sp-a', counts: { owed, resolved } }].concat(more || []) });
  /* A new obligation, nothing resolved since: the resolved count alone hides it. */
  const a = RC.since(W.r, rec, W.recs, cov(4, 2));
  same(a.coverage, [{ spread: 'sp-a', then: { owed: 3, resolved: 2 }, now: { owed: 4, resolved: 2 }, arrived: 1 }]);
  assert.ok(a.lines.some((l) => /1 obligation of sp-a arrived after the run ended/.test(l)), a.lines.join(' | '));
  assert.ok(a.lines.some((l) => /Coverage of sp-a now: 2 of 4 resolved \(2 of 3 when the run ended\)/.test(l)), a.lines.join(' | '));
  /* Later notices use the current denominator, never the ended one. */
  const b = RC.since(W.r, rec, W.recs, cov(5, 4));
  assert.ok(b.lines.some((l) => /Coverage of sp-a now: 4 of 5 resolved \(2 of 3 when the run ended\)/.test(l)), b.lines.join(' | '));
  assert.ok(b.lines.some((l) => /2 obligations of sp-a arrived after the run ended/.test(l)), b.lines.join(' | '));
  /* A spread asked after the end is an arrival of its own. */
  const c = RC.since(W.r, rec, W.recs, cov(3, 2, [{ id: 'sp-b', counts: { owed: 2, resolved: 0 } }]));
  same(c.coverage, [{ spread: 'sp-b', then: null, now: { owed: 2, resolved: 0 }, arrived: 2 }]);
  assert.ok(c.lines.some((l) => /Spread sp-b arrived after the run ended: 0 of 2 resolved now/.test(l)), c.lines.join(' | '));
  same(RC.since(W.r, rec, W.recs, cov(3, 2)).coverage, [], 'nothing changed: nothing said');
  assert.strictEqual(JSON.stringify(rec.coverage), frozen, 'the receipt keeps the ended numbers');
  same(RC.words(P1.counts, rec.coverage).lines, RC.words(P1.counts, JSON.parse(frozen)).lines);
});

rule('A run\'s living field is read by its keys, never their order: {receipt, head} reads as {head, receipt}', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const P1 = W.end('Stopped early');
  const a = plain(W.r), b = plain(W.r);
  b.living = { receipt: P1.id, head: a.living.head };
  const ra = R.sanitize(a), rb = R.sanitize(b);
  assert.strictEqual(rb._unrunnable, undefined, String(rb._unrunnable));
  same(rb.living, ra.living);
  same(T.cleanLiving({ receipt: P1.id, head: a.living.head }), { head: a.living.head, receipt: P1.id });
  assert.strictEqual(T.cleanLiving({ receipt: P1.id, head: a.living.head, more: 1 }), null);
  assert.strictEqual(T.cleanLiving({ receipt: P1.id }), null);
});

rule('One receipt verdict: unread, another run\'s and missing receipts are problems with path, kind and why; confirmed and none aren\'t', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const P1 = W.end('Stopped early'), path = 'proposals/' + P1.id + '.json', without = W.recs.filter((x) => x.kind !== 'receipt');
  const v = (recs, un, r) => RC.verdict(r || W.r, recs, un || []);
  same(v(W.recs).problem, null, 'confirmed');
  same([v(without).state, v(without).problem], ['missing', { path, kind: 'nofile', why: v(without).why }]);
  const un = v(without, [{ file: P1.name, why: 'EIO: i/o error', kind: 'unreadable', run: null }]);
  same([un.state, un.problem.kind, un.problem.path], ['unread', 'unreadable', path]);
  const other = v(without, [{ file: P1.name, why: 'is a receipt that isn\'t in its format: Its id isn\'t the one its run, who ended it and what it says give.', kind: 'malformed', run: { process: 'release-readiness', id: 'elsewhere' } }]);
  same([other.state, other.problem.kind], ['unread', 'malformed']);
  const none = v([], [], Object.assign(plain(W.r), { living: { head: W.r.living.head } }));
  same([none.state, none.problem], ['none', null]);
  assert.strictEqual(v(W.recs, [], world().r), null, 'a run that isn\'t an ended living run has no verdict');
});
/* TC: a receipt is the person's who ended the run: another person ending the same work writes another receipt (its id names
   who), the same person again the same file, and a run ended by someone other than its receipt's author is a mismatch. */
rule('A receipt is bound to the person who ends the run: another person gets another receipt, and a run ended by someone else than its receipt says is a mismatch', () => {
  const W = world();
  W.todo('Post the notes', { phase: 'ship' });
  const A = W.receipt('Stopped early', { by: 'person-morgan' }), A2 = W.receipt('Stopped early', { by: 'person-morgan' }), B = W.receipt('Stopped early', { by: 'person-riley' });
  assert.ok(!A.why && !B.why, A.why || B.why);
  same(A2.file, A.file);
  assert.notStrictEqual(B.id, A.id, 'another person is another receipt');
  const back = T.cleanFile(JSON.parse(T.text(B.file)), B.name);
  assert.ok(back.ok, back.why);
  const P1 = W.end('Stopped early'), other = plain(W.r);
  other.ended.by = other.ended.by === 'person-riley' ? 'person-morgan' : 'person-riley';
  const mm = RC.stateOf(other, W.recs, []);
  same([mm.state, mm.kind, mm.path], ['mismatch', 'malformed', 'proposals/' + P1.id + '.json'], JSON.stringify(mm));
});
run();
