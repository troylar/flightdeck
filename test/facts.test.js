// Living runs (4.0, docs/design.md 45.2), slice 4: facts. What a tool observed about a loop item (its PRs, commits, status or
// blockers), one record per item, source and domain, with its completeness, freshness and errors. Facts never change work: a
// resolve suggestion is an ordinary done request carrying checked support, and applying it asks again that the evidence holds.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), T = PF.todos, F = PF.facts, LP = PF.loop, R = PF.run, M = PF.map, P = PF.publish;
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, m) => m === undefined ? assert.deepStrictEqual(plain(a), plain(b)) : assert.deepStrictEqual(plain(a), plain(b), m);
const AT = '2026-11-09T09:00:00.000Z', T0 = Date.parse(AT), HOUR = 3600000, NOW = T0 + 3 * HOUR;
const PEOPLE = { people: [{ id: 'person-morgan', name: 'Morgan' }, { id: 'person-avery', name: 'Avery' }] };

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
function scope(key, ns) {
  const c = LP.cleanIntent({ loop: LOOPT, observation: obs(ns), changes: [] }, key, { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: [], children: [], now: AT, app: '3.0.0' });
  return LP.cleanRequest(JSON.parse(LP.text(f)), f.id + '.json').record;
}
let revs = 0; const rev = () => (++revs).toString(16).padStart(8, '0');
const uid = (n) => 'jira:' + (10000 + n);
const BB = { feed: 'bitbucket', site: 'git.example.com' }, JIRA = { feed: 'jira' };
const pr = (n, state) => ({ id: String(n), text: 'Change ' + n, state: state || 'merged' });
const blk = (n, state) => ({ id: 'B-' + n, text: 'Blocker ' + n, state: state || 'open' });

function world(ns) {
  const kp = publishMd(CHILD), procs = { 'validate-story': procOf3([kp]) }, procOf = (id) => procs[id] || null;
  const pp = publishMd(PARENT, { childProcs: procs });
  const r = R.create(pp, { id: 'r-41', by: 'person-morgan', session: 'w', now: AT, app: '4.0.0', details: { fix_version: '4.1' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
  const W = { r, kp, procOf, recs: [], unread: [], scopes: [scope('s1', ns || [101, 102])] };
  W.items = () => LP.view(W.r, 'each', { records: W.scopes, runs: [W.r], procOf }).rollup.items;
  W.push = (rec, name) => { rec._file = name || rec.id + '.json'; W.recs.push(rec); return rec; };
  /* A tool files one observation through the one rule `fact sync` uses (PF.facts.prepare). */
  W.fact = (key, o, tool) => {
    const Pp = F.prepare(W.r, { obs: Object.assign({ key, loopStep: 'each', item: 'ABC-101', source: BB, domain: 'prs', observedAt: AT, complete: true, reported: 1, entries: [pr(1)] }, o || {}), by: { tool: tool || 'git-bot', version: '1.0' }, records: W.recs, unread: W.unread, items: W.items(), at: AT, app: '4.0.0' });
    assert.ok(!Pp.why, Pp.why);
    if (Pp.status === 'new') W.push(Pp.record, Pp.name);
    return Pp;
  };
  /* A fact built by hand, with exactly the seen list given (two windows filing at once). */
  W.raw = (key, o, seen) => {
    const f = F.build(Object.assign({ run: W.r, producer: { name: 'git-bot', version: '1.0' }, key, seen: seen || [], at: AT, app: '4.0.0', loopStep: 'each', uid: uid(101), attempt: 1, source: BB, domain: 'prs', observedAt: AT, maxAgeSeconds: 86400, complete: true, reported: 1, fetched: 1, errors: [], entries: [pr(1)] }, o || {}));
    const v = T.cleanFile(JSON.parse(T.text(f)), f.id + '.json');
    assert.ok(v.ok, v.why);
    return W.push(v.record);
  };
  W.fv = () => F.view(W.r, { records: W.recs, unread: W.unread });
  W.slot = (o) => W.fv().bySlot[F.slotKey(Object.assign({ loopStep: 'each', uid: uid(101), attempt: 1, source: BB, domain: 'prs' }, o || {}))];
  W.view = (now) => T.view(W.r, { records: W.recs, unread: W.unread, people: PEOPLE, now: now === undefined ? NOW : now });
  W.ask = (body, by, extra) => {
    const Pp = T.prepare(W.r, Object.assign({ body, by, key: 'k-' + rev(), records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0', now: NOW }, extra || {}));
    assert.ok(!Pp.why, Pp.why);
    W.push(Pp.record, Pp.name);
    return Pp;
  };
  W.land = (now) => {
    for (let i = 0; i < 100; i++) {
      const V = W.view(now), q = T.nextQueued(V);
      if (!q) return;
      const plan = T.applyPlan(W.r, V, q);
      if (plan.adopt) { W.r.living = { head: plan.adopt.id }; continue; }
      assert.ok(plan.write, JSON.stringify(plan));
      const s = T.buildStatus(Object.assign({}, plan.write, { by: 'person-morgan', at: AT, writer: 'rec', rev: rev(), app: '4.0.0' }));
      const fd = T.filed(s.name, s.file); assert.ok(!fd.why, fd.why);
      W.push(fd.record, s.name);
      W.r.living = { head: fd.record.id };
      if (W.r.features.indexOf('living-runs') < 0) W.r.features = W.r.features.concat(['living-runs']);
    }
  };
  /* An open to-do on story 101, added by the recorder in one gesture. */
  W.todo = (text) => { const Pp = W.ask({ op: 'add', text: text || 'Merge the fix', target: { item: { loopStep: 'each', uid: uid(101), attempt: 1 } } }, { person: 'person-morgan' }); W.land(); return W.view().byTodo[Pp.preview.todo]; };
  W.suggest = (x, factId, tool, now) => {
    const s = F.supportFor(W.r, x, factId, { records: W.recs, unread: W.unread, now: now === undefined ? NOW : now });
    if (s.why) return s;
    return T.prepare(W.r, { body: { op: 'done', todo: x.id, support: s.support }, by: { tool: tool || 'git-bot', version: '1.0' }, records: W.recs, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0', now: now === undefined ? NOW : now });
  };
  return W;
}

/* ---------- Records ---------- */
rule('A fact is one record per item, source and domain, named by ["fact", tool, key], and is never a request', () => {
  const W = world(), Pp = W.fact('prs-1');
  same([Pp.file.format, Pp.file.features, Pp.file.kind, Pp.file.domain, Pp.file.uid, Pp.file.attempt, Pp.file.maxAgeSeconds], ['flightdeck-plan/4', ['living-runs'], 'fact', 'prs', uid(101), 1, 86400]);
  same(Pp.id, 'req-git-bot-' + PF.sha256.hex(JSON.stringify(['fact', 'git-bot', 'prs-1'])).slice(0, 24));
  assert.notStrictEqual(Pp.id, T.idFor('git-bot', 'prs-1'), 'never the id a to-do request with the same key has');
  same(T.fileWhy(Pp.name, Pp.file), '');
  const V = W.view();
  same([V.todos.length, Object.keys(V.requests).length, V.heads.length, V.order.length, V.held.length, V.chain.length], [0, 0, 0, 0, 0, 0], 'it never enters the to-do order or chain');
  T.markHolds([W.r], { records: W.recs, unread: W.unread, people: PEOPLE, now: NOW });
  assert.strictEqual(W.r._todos, undefined, 'a run with facts and no to-dos is left exactly as it was');
});
rule('Every fact field and limit is checked whole: refused, never cut, and a value of the wrong type never throws', () => {
  const W = world(), Pp = W.fact('prs-1'), o = JSON.parse(T.text(Pp.file));
  const why = (x, name) => { let v; try { v = T.cleanFile(JSON.parse(JSON.stringify(x)), name || x.id + '.json'); } catch (e) { return 'THREW ' + e.message; } return v.ok ? '' : v.why; };
  const bad = (x, m) => { const w = why(x); assert.ok(w && !/^THREW/.test(w), m + ': ' + (w || 'accepted')); };
  same(why(o), '');
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  same(why(Object.assign({}, o, { entries: many(100, (i) => pr(i)), reported: 100, fetched: 100 })), '', '100 entries are kept whole');
  bad(Object.assign({}, o, { entries: many(101, (i) => pr(i)), reported: 101, fetched: 101 }), '101 entries');
  bad(Object.assign({}, o, { domain: 'status', entries: [{ id: 'a', text: 'Done', category: 'done' }, { id: 'b', text: 'Done', category: 'done' }], reported: 2, fetched: 2 }), 'one status');
  same(why(Object.assign({}, o, { complete: false, errors: many(20, () => 'e') })), '');
  bad(Object.assign({}, o, { complete: false, errors: many(21, () => 'e') }), '21 errors');
  bad(Object.assign({}, o, { complete: false, errors: ['e'.repeat(301)] }), 'an error over 300');
  same(why(Object.assign({}, o, { source: { feed: 'a'.repeat(60) } })), '');
  bad(Object.assign({}, o, { source: { feed: 'a'.repeat(61) } }), 'a source id over 60');
  bad(Object.assign({}, o, { source: { feed: 'x', team: 'y' } }), 'a source field it doesn\'t know');
  same(why(Object.assign({}, o, { entries: [Object.assign(pr(1), { id: 'a'.repeat(120) })] })), '');
  bad(Object.assign({}, o, { entries: [Object.assign(pr(1), { id: 'a'.repeat(121) })] }), 'an entry id over 120');
  bad(Object.assign({}, o, { entries: [Object.assign(pr(1), { text: 'a'.repeat(201) })] }), 'entry text over 200');
  bad(Object.assign({}, o, { entries: [Object.assign(pr(1), { text: 'a\nb' })] }), 'entry text with a line break');
  bad(Object.assign({}, o, { entries: [pr(1), pr(1)], reported: 2, fetched: 2 }), 'an entry twice');
  bad(Object.assign({}, o, { entries: [Object.assign(pr(1), { state: 'shipped' })] }), 'a state its domain doesn\'t have');
  bad(Object.assign({}, o, { entries: [Object.assign(pr(1), { link: 'javascript:alert(1)' })] }), 'a link that isn\'t http(s)');
  same(why(Object.assign({}, o, { maxAgeSeconds: 1 })), ''); same(why(Object.assign({}, o, { maxAgeSeconds: 604800 })), '');
  bad(Object.assign({}, o, { maxAgeSeconds: 0 }), 'max age 0'); bad(Object.assign({}, o, { maxAgeSeconds: 604801 }), 'max age over a week'); bad(Object.assign({}, o, { maxAgeSeconds: 1.5 }), 'max age not whole');
  bad(Object.assign({}, o, { fetched: 2 }), 'fetched isn\'t the entries');
  bad(Object.assign({}, o, { reported: 2 }), 'complete with fewer fetched than reported');
  bad(Object.assign({}, o, { errors: ['timeout'] }), 'complete with an error');
  same(why(Object.assign({}, o, { complete: false, reported: null })), '', 'a source that doesn\'t say how many');
  bad(Object.assign({}, o, { domain: 'tickets' }), 'a domain it doesn\'t know');
  bad(Object.assign({}, o, { observedAt: 'yesterday' }), 'a time that isn\'t one');
  bad(Object.assign({}, o, { extra: 1 }), 'a field it doesn\'t know');
  bad(JSON.parse(T.text(Pp.file).replace('"kind"', '"__proto__": {"x": 1}, "kind"')), 'a prototype key');
  bad(Object.assign({}, o, { key: 'another' }), 'an id that isn\'t its tool and key\'s');
  bad(Object.assign({}, o, { producer: undefined, key: undefined, by: 'person-morgan' }), 'a person\'s fact');
  bad(Object.assign({}, o, { seen: ['not-an-id'] }), 'seen');
  [['entries', [null]], ['entries', 'x'], ['source', 5], ['source', { feed: 5 }], ['errors', [5]], ['reported', '1'], ['attempt', 1e999], ['complete', 'true'], ['entries', [{ id: 5, text: 't', state: 'open' }]], ['uid', null]].forEach(([k, v]) => bad(Object.assign({}, o, { [k]: v }), k + ' as ' + JSON.stringify(v)));
  const big = T.cleanFile(o, Pp.name, 262145);
  assert.ok(!big.ok, 'a record over 256 KiB of UTF-8');
});

/* ---------- Reduction ---------- */
rule('Domains and sources are independent: complete PRs say nothing about blockers, which read "not checked"', () => {
  const W = world();
  W.fact('prs-1', { entries: [pr(1), pr(2)], reported: 2 });
  const lines = F.itemFacts(W.fv(), 'each', uid(101), 1, NOW);
  same(lines.map((l) => l.domain + ':' + l.state), ['prs:complete', 'commits:unknown', 'status:unknown', 'blockers:unknown']);
  same(lines[0].words, 'PRs (bitbucket · git.example.com): 2 of 2 merged · complete · checked 3 hours ago.');
  same(lines[3].words, 'Blockers: not checked.');
  W.fact('blk-1', { source: JIRA, domain: 'blockers', complete: true, reported: 0, entries: [] });
  W.fact('blk-2', { source: { feed: 'github' }, domain: 'blockers', complete: true, reported: 1, entries: [blk(1)] });
  const l2 = F.itemFacts(W.fv(), 'each', uid(101), 1, NOW).filter((l) => l.domain === 'blockers');
  same(l2.map((l) => l.words), ['Blockers (github): 1 open · complete · checked 3 hours ago.', 'Blockers (jira): none open · complete · checked 3 hours ago.'], 'each source is its own line');
  same(F.itemFacts(W.fv(), 'each', uid(102), 1, NOW), [], 'another item knows nothing');
});
rule('Incomplete empty blockers never read as no blockers, and can\'t support a resolve', () => {
  const W = world(), x = W.todo();
  const f = W.fact('blk-1', { source: JIRA, domain: 'blockers', complete: false, reported: 4, entries: [] });
  const l = F.itemFacts(W.fv(), 'each', uid(101), 1, NOW).filter((y) => y.domain === 'blockers')[0];
  same(l.state, 'partial');
  assert.ok(/0 open of 0 read, 4 reported \(the list is incomplete: this is no sign there are none\)/.test(l.words), l.words);
  assert.ok(!/none open/.test(l.words));
  const s = W.suggest(x, f.id);
  assert.ok(/incomplete/.test(s.why), s.why);
  const u = W.fact('blk-2', { source: JIRA, domain: 'blockers', complete: false, reported: null, entries: [], errors: ['The search timed out'] });
  same(F.stateOf(W.slot({ source: JIRA, domain: 'blockers' }), NOW).state, 'failed', 'a failed read is failed, never empty');
  assert.ok(u.id);
});
rule('Order is causal, never by timestamp: a later record that saw an earlier one replaces it, even dated before it', () => {
  const W = world();
  const a = W.fact('prs-1', { observedAt: '2026-11-09T08:00:00.000Z', entries: [pr(1, 'open')] });
  const b = W.fact('prs-2', { observedAt: '2026-11-09T07:00:00.000Z', entries: [pr(1, 'merged')] });
  same(b.file.seen, [a.id], 'a new fact sees what its slot stands on');
  const S = W.slot();
  same([S.current.id, S.disputed, S.observedAt], [b.id, false, '2026-11-09T07:00:00.000Z'], 'the record that saw the other is current, with its own (older) time');
  /* Two at once, neither seeing the other: the later timestamp doesn't win. */
  const W2 = world();
  W2.raw('a', { observedAt: '2026-11-09T08:00:00.000Z', entries: [pr(1, 'open')] });
  W2.raw('b', { observedAt: '2026-11-09T08:30:00.000Z', entries: [pr(1, 'merged')] });
  same([W2.slot().disputed, W2.slot().current], [true, null]);
  same(F.stateOf(W2.slot(), NOW).state, 'disputed');
  assert.ok(/^PRs \(bitbucket · git\.example\.com\): disputed\. Two observations made at once say different things\./.test(F.words(W2.slot(), NOW).words));
});
rule('Concurrent updates: contrary ones stay disputed until one that saw them all; agreeing ones are one observation, as fresh as the newest', () => {
  const W = world();
  const a = W.raw('a', { entries: [pr(1, 'open')] }), b = W.raw('b', { entries: [pr(1, 'merged')] });
  assert.ok(W.slot().disputed);
  W.raw('c', { entries: [pr(1, 'merged')] }, [a.id]);
  assert.ok(W.slot().disputed, 'one that saw only some keeps it disputed');
  const d = W.fact('d', { entries: [pr(1, 'merged')] });
  same(d.file.seen.slice().sort(), [b.id, W.recs[2].id].sort(), 'the next sync sees the whole front');
  same([W.slot().disputed, W.slot().current.id], [false, d.id], 'and settles it');
  const W2 = world();
  W2.raw('a', { observedAt: '2026-11-09T08:00:00.000Z' }); W2.raw('b', { observedAt: '2026-11-09T08:40:00.000Z' });
  same([W2.slot().disputed, W2.slot().observedAt], [false, '2026-11-09T08:40:00.000Z']);
  /* 51 at once settle a page of 50 at a time. */
  const W3 = world(), ids = [];
  for (let i = 0; i < 51; i++) ids.push(W3.raw('w' + i, { entries: [pr(1, i % 2 ? 'open' : 'merged')] }).id);
  assert.ok(W3.slot().disputed);
  const p1 = W3.fact('page-1');
  same(p1.file.seen.length, 50);
  assert.ok(W3.slot().disputed, 'a page of 50 leaves one');
  W3.fact('page-2');
  same(W3.slot().disputed, false, 'the next page settles it');
});
rule('Causal replacement is only within one item, source and domain', () => {
  const W = world();
  const a = W.fact('prs-1');
  W.raw('blk', { source: JIRA, domain: 'blockers', complete: true, reported: 0, fetched: 0, entries: [] }, [a.id]);
  W.raw('other', { source: { feed: 'github' }, entries: [pr(9, 'open')] }, [a.id]);
  W.raw('next', { attempt: 2, entries: [pr(9, 'open')] }, [a.id]);
  same(W.slot().current.id, a.id, 'a record of another domain, source or attempt that saw it replaces nothing');
});
rule('Unknown, partial, stale, future-dated, failed and held observations are each told apart', () => {
  const W = world(), st = (o) => F.stateOf(W.slot(o), NOW, W.fv()).state;
  same(st(), 'unknown');
  W.fact('a', { domain: 'commits', complete: false, reported: 9, entries: [{ id: 'abc1234', text: 'Fix' }] });
  same(st({ domain: 'commits' }), 'partial');
  W.fact('b', { observedAt: '2026-11-01T09:00:00.000Z' });
  same(st(), 'stale');
  assert.ok(/stale \(good for 1 day\)\.$/.test(F.words(W.slot(), NOW).words));
  W.fact('c', { observedAt: '2026-11-09T13:00:00.000Z' });
  same(st(), 'future', 'more than five minutes after now');
  W.fact('d', { observedAt: '2026-11-09T12:04:00.000Z' });
  same(st(), 'complete', 'within five minutes is a clock\'s drift');
  W.fact('e', { complete: false, reported: null, entries: [], errors: ['401 Unauthorized'] });
  same(st(), 'failed');
  W.unread.push({ file: 'req-git-bot-' + 'a'.repeat(24) + '.json', why: 'cut short', run: { process: 'release-readiness', id: 'r-41' } });
  same(st(), 'held', 'a fact record that can\'t be read: nothing about the run is sure');
  const W2 = world(); W2.fact('a');
  same(F.stateOf(W2.slot(), undefined, W2.fv()).state, 'held', 'no time to judge freshness by: never fresh');
});

/* ---------- Support and de-duplication ---------- */
rule('A resolve suggestion is an ordinary done request with checked support, named by what it rests on', () => {
  const W = world(), x = W.todo(), f = W.fact('prs-1');
  const s = W.suggest(x, f.id);
  assert.ok(!s.why, s.why);
  same([s.file.kind, s.file.op, s.file.todo, s.file.support.fact, s.file.support.domain, s.file.support.content, s.file.support.incarnation], ['proposal', 'done', x.id, f.id, 'prs', f.record.content, x.added]);
  same(s.id, F.suggestionId(x.id, x.added, BB, 'prs', f.record.content));
  same(s.file.key, F.suggestionKey(x.id, x.added, BB, 'prs', f.record.content));
  same(s.preview.status, 'waiting', 'it waits for a person or a delegation like any other done');
  assert.ok(/on evidence: PRs from bitbucket/.test(s.preview.words), s.preview.words);
  const o = JSON.parse(T.text(s.file)), why = (y) => { const v = T.cleanFile(JSON.parse(JSON.stringify(y)), s.name); return v.ok ? '' : v.why; };
  same(why(o), '');
  assert.ok(why(Object.assign({}, o, { support: Object.assign({}, o.support, { content: '0'.repeat(16) }) })), 'an id that isn\'t its support\'s');
  assert.ok(why(Object.assign({}, o, { key: 'k-1' })), 'a key that isn\'t its suggestion\'s');
  assert.ok(why(Object.assign({}, o, { support: Object.assign({}, o.support, { extra: 1 }) })));
  assert.ok(T.prepare(W.r, { body: { op: 'done', todo: x.id, support: s.file.support }, by: { person: 'person-morgan' }, key: 'p1', records: W.recs, people: PEOPLE, at: AT, now: NOW }).why, 'a person checks it off; support is a tool\'s');
  const plain2 = T.prepare(W.r, { body: { op: 'done', todo: x.id }, by: { tool: 'git-bot', version: '1.0', key: 'plain' }, records: W.recs, people: PEOPLE, at: AT, now: NOW });
  assert.notStrictEqual(T.consequenceOf(W.r, R.mapOf(W.r), plain2.record, W.view()).fingerprint, T.consequenceOf(W.r, R.mapOf(W.r), s.record, W.view()).fingerprint, 'approval binds the evidence too');
  same(T.effectOf(s.record).support, s.record.support, 'the application records the evidence');
});
rule('De-duplication: a re-sync that only moves the time, or another tool, makes no second suggestion; a reopening or new content does', () => {
  const W = world(), x = W.todo(), f1 = W.fact('prs-1');
  const s1 = W.suggest(x, f1.id); W.push(s1.record, s1.name);
  const f2 = W.fact('prs-2', { observedAt: '2026-11-09T10:00:00.000Z' });
  same(f2.record.content, f1.record.content);
  same(W.suggest(x, f2.id).id, s1.id, 'timestamps alone don\'t make another suggestion');
  same(W.suggest(x, f2.id, 'other-bot').id, s1.id, 'another tool, the same suggestion');
  /* Declined suppresses the identical repeat: the same id, already filed. */
  const d = T.decide(W.r, { request: s1.id, op: 'decline', by: 'person-morgan', records: W.recs, people: PEOPLE, at: AT, writer: 'w1', rev: rev(), now: NOW });
  assert.ok(!d.why, d.why); W.push(d.record, d.name);
  same(W.view().requests[s1.id].status, 'declined');
  same(W.suggest(x, f2.id).id, s1.id, 'declined, the same suggestion is the same file');
  const f3 = W.fact('prs-3', { entries: [pr(1), pr(2)], reported: 2 });
  assert.notStrictEqual(W.suggest(x, f3.id).id, s1.id, 'new content is another suggestion');
  /* After it is done and reopened, its new opening may be suggested again. */
  const Q = W.ask({ op: 'done', todo: x.id }, { person: 'person-morgan' }); W.land();
  W.ask({ op: 'reopen', todo: x.id }, { person: 'person-morgan' }); W.land();
  const x2 = W.view().byTodo[x.id];
  assert.notStrictEqual(F.incarnationOf(x2), x.added);
  const again = W.suggest(x2, f3.id);
  assert.ok(!again.why, again.why);
  assert.notStrictEqual(again.id, F.suggestionId(x.id, x.added, BB, 'prs', f3.record.content), 'another opening is another suggestion');
  same(T.prepare(W.r, { body: { op: 'done', todo: x.id, support: s1.record.support }, by: { tool: 'git-bot', version: '1.0' }, records: W.recs, people: PEOPLE, at: AT, now: NOW }).preview.status, 'held', 'a suggestion for an earlier opening holds');
  assert.ok(Q.id);
});
rule('Contrary facts suppress a suggestion: a disputed slot, or open blockers on the item', () => {
  const W = world(), x = W.todo(), f = W.fact('prs-1');
  W.fact('blk', { source: JIRA, domain: 'blockers', complete: true, reported: 1, entries: [blk(1)] });
  assert.ok(/Other facts about it disagree: Blockers \(jira\): 1 open/.test(W.suggest(x, f.id).why));
  const W2 = world(), x2 = W2.todo();
  const a = W2.raw('a', { entries: [pr(1, 'open')] }); W2.raw('b', { entries: [pr(1, 'merged')] });
  assert.ok(/disputed/.test(W2.suggest(x2, a.id).why));
  const W3 = world(), x3 = W3.todo(), g = W3.fact('prs-1', { entries: [pr(1, 'open')] });
  assert.ok(/doesn't show it done: 1 of its PRs aren't merged/.test(W3.suggest(x3, g.id).why));
  const W4 = world(), x4 = W4.todo(), old = W4.fact('prs-1'); W4.fact('prs-2', { entries: [pr(1, 'open')] });
  assert.ok(/replaced by a later observation that says something else/.test(W4.suggest(x4, old.id).why));
});
rule('A done on evidence holds until its evidence is fresh, complete and current, at the time it would be applied', () => {
  const W = world(), x = W.todo(), f = W.fact('prs-1');
  const s = W.suggest(x, f.id); W.push(s.record, s.name);
  same(W.view().requests[s.id].status, 'waiting');
  same(W.view(undefined).requests[s.id].status, 'waiting');
  const noClock = T.view(W.r, { records: W.recs, people: PEOPLE });
  same([noClock.requests[s.id].status, noClock.requests[s.id].why], ['held', 'Its evidence\'s freshness can\'t be checked here.'], 'no time to judge by: held');
  const late = W.view(T0 + 25 * HOUR).requests[s.id];
  same(late.status, 'held');
  assert.ok(/stale: checked 25 hours ago, good for 1 day/.test(late.why), late.why);
  /* Accepted, then the evidence changes before the recorder applies it: nothing lands. */
  const it = T.inbox([W.r], { records: W.recs, people: PEOPLE, me: 'person-morgan', now: NOW }).filter((y) => y.id === s.id)[0];
  const d = T.decide(W.r, { request: s.id, op: 'accept', by: 'person-morgan', shown: it.consequence.fingerprint, records: W.recs, people: PEOPLE, at: AT, writer: 'w2', rev: rev(), now: NOW });
  assert.ok(!d.why, d.why); W.push(d.record, d.name);
  same(W.view().requests[s.id].status, 'queued');
  W.fact('prs-2', { entries: [pr(1, 'open')] });
  const q = W.view().requests[s.id];
  same(q.status, 'held');
  assert.ok(/changed since it was suggested/.test(q.why), q.why);
  same(T.applyPlan(W.r, W.view(), q).skip !== undefined, true);
  W.fact('prs-3');
  same(W.view().requests[s.id].status, 'queued', 'evidence that says the same again stands');
  W.land();
  const y = W.view().byTodo[x.id];
  same([y.state, y.support.fact], ['done', f.id], 'the to-do records the evidence it was done on');
  /* Facts never reopen work: a contrary observation later changes nothing. */
  W.fact('prs-4', { entries: [pr(1, 'open')] });
  same(W.view().byTodo[x.id].state, 'done');
});
rule('A contrary fact about the item filed after a suggestion holds it: an open blocker, a disputed sibling, one that can\'t be read in order; once landed, nothing changes', () => {
  for (const how of ['blocker', 'disputed', 'held']) {
    const W = world(), x = W.todo(), f = W.fact('prs-1', { maxAgeSeconds: 18000 });
    const g = T.grantOf(W.r, { subject: { tool: 'git-bot' }, ops: ['done'], targets: [{ item: { loopStep: 'each', uid: uid(101), attempt: 1 } }], by: 'person-morgan', key: 'g1', records: W.recs, people: PEOPLE, at: AT, now: NOW });
    assert.ok(!g.why, g.why); W.push(g.record, g.name);
    const s = W.suggest(x, f.id); assert.ok(!s.why, s.why); W.push(s.record, s.name);
    same(W.view().requests[s.id].status, 'queued', how + ' set-up');
    if (how === 'blocker') W.fact('blk-1', { source: JIRA, domain: 'blockers', complete: true, reported: 1, entries: [blk(1)] });
    if (how === 'disputed') { W.raw('st-a', { source: JIRA, domain: 'status', entries: [{ id: 'ABC-101', text: 'Doing', category: 'doing' }] }); W.raw('st-b', { source: JIRA, domain: 'status', entries: [{ id: 'ABC-101', text: 'Done', category: 'done' }] }); }
    if (how === 'held') W.raw('st-c', { source: JIRA, domain: 'status', entries: [{ id: 'ABC-101', text: 'Done', category: 'done' }] }, [F.idFor('git-bot', 'never-read')]);
    const q = W.view().requests[s.id];
    same(q.status, 'held', how + ': ' + JSON.stringify(q));
    assert.ok(/Other facts about it disagree/.test(q.why), how + ': ' + q.why);
    W.land();
    same(W.view().byTodo[x.id].state, 'open', how + ': nothing landed');
  }
  /* Landed first, then contrary: the work stays done. */
  const W = world(), x = W.todo(), f = W.fact('prs-1');
  const s = W.suggest(x, f.id); W.push(s.record, s.name);
  const it = T.inbox([W.r], { records: W.recs, people: PEOPLE, me: 'person-morgan', now: NOW }).filter((y) => y.id === s.id)[0];
  const d = T.decide(W.r, { request: s.id, op: 'accept', by: 'person-morgan', shown: it.consequence.fingerprint, records: W.recs, people: PEOPLE, at: AT, writer: 'w2', rev: rev(), now: NOW });
  W.push(d.record, d.name); W.land();
  same(W.view().byTodo[x.id].state, 'done');
  W.fact('blk-1', { source: JIRA, domain: 'blockers', complete: true, reported: 1, entries: [blk(1)] });
  same([W.view().byTodo[x.id].state, W.view().requests[s.id].status], ['done', 'applied'], 'landed work is unchanged');
});
rule('Copies of one fact that differ hold every slot and run any copy names, whatever order they are read in, and on whichever run', () => {
  const ST = { source: JIRA, domain: 'status', entries: [{ id: 'ABC-101', text: 'Done', category: 'done' }] };
  const copy = (W, key, o, name) => {
    const f = F.build(Object.assign({ run: W.r, producer: { name: 'git-bot', version: '1.0' }, key, seen: [], at: AT, app: '4.0.0', loopStep: 'each', uid: uid(101), attempt: 1, source: BB, domain: 'prs', observedAt: AT, maxAgeSeconds: 86400, complete: true, reported: 1, fetched: 1, errors: [], entries: [pr(1)] }, o));
    const v = T.cleanFile(JSON.parse(T.text(f)), name || f.id + '.json'); assert.ok(v.ok, v.why);
    return v.record;
  };
  const r42 = { process: 'release-readiness', id: 'r-42' };
  for (const how of ['first-on-101', 'last-on-101', 'other-run', 'other-run-first']) {
    const W = world(), x = W.todo(), f = W.fact('prs-1', { maxAgeSeconds: 18000 });
    const g = T.grantOf(W.r, { subject: { tool: 'git-bot' }, ops: ['done'], targets: [{ item: { loopStep: 'each', uid: uid(101), attempt: 1 } }], by: 'person-morgan', key: 'g1', records: W.recs, people: PEOPLE, at: AT, now: NOW });
    assert.ok(!g.why, g.why); W.push(g.record, g.name);
    const s = W.suggest(x, f.id); assert.ok(!s.why, s.why); W.push(s.record, s.name);
    same(W.view().requests[s.id].status, 'queued', how + ' set-up');
    const id = F.idFor('git-bot', 'st-x');
    const a = copy(W, 'st-x', ST), b = copy(W, 'st-x', Object.assign({}, ST, how.indexOf('other-run') === 0 ? { run: r42, uid: uid(102) } : { uid: uid(102) }), id + ' (1).json');
    if (how === 'first-on-101' || how === 'other-run') { W.push(a, id + '.json'); W.push(b, id + ' (1).json'); } else { W.push(b, id + ' (1).json'); W.push(a, id + '.json'); }
    const S = W.slot({ source: JIRA, domain: 'status' });
    assert.ok(S && S.held.indexOf(id) >= 0, how + ': the slot the 101 copy names is held: ' + JSON.stringify(S && S.held));
    const q = W.view().requests[s.id];
    same(q.status, 'held', how + ': ' + JSON.stringify(q));
    W.land();
    same(W.view().byTodo[x.id].state, 'open', how + ': nothing landed');
    /* The other copy's slot is held too, on the run it names. */
    const other = how.indexOf('other-run') === 0 ? r42 : W.r, OV = F.view(other, { records: W.recs, unread: [] });
    const S2 = OV.bySlot[F.slotKey({ loopStep: 'each', uid: uid(102), attempt: 1, source: JIRA, domain: 'status' })];
    assert.ok(S2 && S2.held.indexOf(id) >= 0, how + ': the 102 copy\'s slot is held on ' + other.id);
    same(F.stateOf(S2, NOW, OV).state, 'held', how);
    /* Nothing can be suggested on a fact whose copies differ. */
    const sf = F.supportFor(W.r, x, id, { records: W.recs, unread: [], now: NOW });
    assert.ok(sf.why && !sf.support, how + ': ' + JSON.stringify(sf));
  }
  /* Copies that say the same thing are one record, as before. */
  const W = world(), x = W.todo(), id = F.idFor('git-bot', 'st-y');
  const a = copy(W, 'st-y', ST); W.push(a, id + '.json'); W.push(copy(W, 'st-y', ST, id + ' (1).json'), id + ' (1).json');
  same(W.slot({ source: JIRA, domain: 'status' }).held, [], 'identical copies are one record');
  assert.ok(x);
});
rule('Copies of one id that differ in kind (a fact and a request) hold both sides: the evidence slot, the request and what came after it', () => {
  /* A request filed under a fact's id: the suggestion resting on that fact holds and nothing lands. */
  for (const order of ['fact-first', 'request-first']) {
    const W = world(), x = W.todo(), f = W.fact('prs-1', { maxAgeSeconds: 18000 });
    const g = T.grantOf(W.r, { subject: { tool: 'git-bot' }, ops: ['done'], targets: [{ item: { loopStep: 'each', uid: uid(101), attempt: 1 } }], by: 'person-morgan', key: 'g1', records: W.recs, people: PEOPLE, at: AT, now: NOW });
    assert.ok(!g.why, g.why); W.push(g.record, g.name);
    const s = W.suggest(x, f.id); assert.ok(!s.why, s.why); W.push(s.record, s.name);
    same(W.view().requests[s.id].status, 'queued', order + ' set-up');
    const p = T.buildProposal({ run: W.r, id: f.id, by: 'person-avery', seen: [], at: AT, body: { op: 'add', text: 'Something else', target: x.target, placement: x.placement } });
    const v = T.cleanFile(JSON.parse(T.text(p)), f.id + ' (1).json'); assert.ok(v.ok, v.why);
    if (order === 'request-first') { const i = W.recs.indexOf(f.record || W.recs.filter((y) => y.id === f.id)[0]); const fr = W.recs.splice(i, 1)[0]; W.push(v.record, f.id + ' (1).json'); W.push(fr, f.id + '.json'); }
    else W.push(v.record, f.id + ' (1).json');
    const S = W.slot();
    assert.ok(S && S.held.indexOf(f.id) >= 0, order + ': the fact\'s slot is held: ' + JSON.stringify(S && S.held));
    const V = W.view();
    same(V.requests[s.id].status, 'held', order + ': ' + JSON.stringify(V.requests[s.id]));
    assert.ok(!V.requests[f.id] || V.requests[f.id].status === 'held', order + ': the request copy is held too');
    W.land();
    same(W.view().byTodo[x.id].state, 'open', order + ': nothing landed');
  }
  /* A fact filed under an applied request's id: the request, its application and the chain after it hold (fail closed). */
  const W = world(), fid = F.idFor('git-bot', 'kk'), x0 = W.todo('First');
  const P = T.buildProposal({ run: W.r, id: fid, by: 'person-avery', seen: [], at: AT, body: { op: 'add', text: 'Merge the fix', target: x0.target, placement: x0.placement } });
  const pv = T.cleanFile(JSON.parse(T.text(P)), fid + '.json'); assert.ok(pv.ok, pv.why); W.push(pv.record, fid + '.json');
  const it = T.inbox([W.r], { records: W.recs, people: PEOPLE, me: 'person-morgan', now: NOW }).filter((y) => y.id === fid)[0];
  assert.ok(it, 'set-up: in the inbox');
  const d = T.decide(W.r, { request: fid, op: 'accept', by: 'person-morgan', shown: it.consequence.fingerprint, records: W.recs, people: PEOPLE, at: AT, writer: 'w2', rev: rev(), now: NOW });
  assert.ok(!d.why, d.why); W.push(d.record, d.name); W.land();
  const V0 = W.view();
  same([V0.todos.length, !!V0.broken], [2, false], 'set-up: the to-do landed under ' + fid + ' (' + P.id + ')');
  const fr = W.raw('kk', {}); fr._file = fid + ' (1).json';
  const V = W.view();
  assert.ok(V.broken && V.todos.length === 0, 'the chain resting on the request whose copies differ holds: ' + JSON.stringify({ broken: V.broken, todos: V.todos.length }));
  assert.ok(W.slot().held.indexOf(fid) >= 0, 'and the fact\'s slot is held');
});

rule('A delegation that covers done applies a suggestion without a person, still only on its evidence', () => {
  const W = world(), x = W.todo(), f = W.fact('prs-1', { maxAgeSeconds: 18000 });
  const g = T.grantOf(W.r, { subject: { tool: 'git-bot' }, ops: ['done'], targets: [{ item: { loopStep: 'each', uid: uid(101), attempt: 1 } }], by: 'person-morgan', key: 'g1', records: W.recs, people: PEOPLE, at: AT, now: NOW });
  assert.ok(!g.why, g.why); W.push(g.record, g.name);
  const s = W.suggest(x, f.id); W.push(s.record, s.name);
  same(W.view().requests[s.id].status, 'queued');
  same(W.view(T0 + 6 * HOUR).requests[s.id].status, 'held', 'stale by the time it would land');
  W.land(T0 + 6 * HOUR);
  same(W.view().byTodo[x.id].state, 'open', 'nothing landed on stale evidence');
  W.land(NOW);
  same(W.view().byTodo[x.id].state, 'done');
});
rule('A retry is already only on the run it was filed on: the same tool, key and observation on another run is taken', () => {
  const W = world(), Pp = W.fact('global-key');
  const r2 = Object.assign(JSON.parse(JSON.stringify(W.r)), { id: 'r-42' });
  const again = F.prepare(r2, { obs: { key: 'global-key', loopStep: 'each', item: 'ABC-101', source: BB, domain: 'prs', observedAt: AT, complete: true, reported: 1, entries: [pr(1)] }, by: { tool: 'git-bot', version: '1.0' }, records: W.recs, unread: W.unread, items: W.items(), at: AT, app: '4.0.0' });
  same([again.status, again.taken, /another run \(release-readiness\/r-41/.test(again.why || '')], [undefined, true, true], JSON.stringify(again));
  same(F.prepare(W.r, { obs: { key: 'global-key', loopStep: 'each', item: 'ABC-101', source: BB, domain: 'prs', observedAt: AT, complete: true, reported: 1, entries: [pr(1)] }, by: { tool: 'git-bot', version: '1.0' }, records: W.recs, unread: W.unread, items: W.items(), at: AT, app: '4.0.0' }).status, 'already', 'on its own run: already');
  assert.ok(Pp.id);
});
rule('At 10,000 fact records a run takes no more, with a message that says what to do; the ones there are kept', () => {
  const W = world(), base = W.fact('base');
  const many = Array.from({ length: F.LIMITS.records - 1 }, (_, i) => Object.assign({}, base.record, { id: F.idFor('git-bot', 'n' + i) }));
  W.recs.push(...many);
  same(W.fv().count, F.LIMITS.records);
  const Pp = F.prepare(W.r, { obs: { key: 'one-more', loopStep: 'each', item: 'ABC-101', source: BB, domain: 'prs', observedAt: AT, complete: true, reported: 1, entries: [pr(1)] }, by: { tool: 'git-bot', version: '1.0' }, records: W.recs, items: W.items(), at: AT });
  assert.ok(/already has 10000 fact records, the most it takes \(10000\)\. Nothing was imported and nothing was removed/.test(Pp.why), Pp.why);
  same(W.fv().count, F.LIMITS.records);
});
rule('Filing: a retry under the same key with the same observation is already; the key with another observation is refused', () => {
  const W = world(), a = W.fact('k1');
  const again = W.fact('k1', { entries: [pr(1)] });
  same([again.status, again.id], ['already', a.id]);
  const other = F.prepare(W.r, { obs: { key: 'k1', loopStep: 'each', item: 'ABC-101', source: BB, domain: 'prs', observedAt: AT, complete: true, reported: 1, entries: [pr(1, 'open')] }, by: { tool: 'git-bot', version: '1.0' }, records: W.recs, items: W.items(), at: AT });
  assert.ok(other.taken && /different observation/.test(other.why));
  const noItem = F.prepare(W.r, { obs: { key: 'k2', loopStep: 'each', item: 'ABC-999', source: BB, domain: 'prs', observedAt: AT, complete: true, reported: 1, entries: [pr(1)] }, by: { tool: 'git-bot', version: '1.0' }, records: W.recs, items: W.items(), at: AT });
  assert.ok(/ABC-999 isn't an item of loop each/.test(noItem.why));
  const noLoop = F.prepare(W.r, { obs: { key: 'k3', loopStep: 'ship1', item: 'ABC-101', source: BB, domain: 'prs', observedAt: AT, complete: true, reported: 1, entries: [pr(1)] }, by: { tool: 'git-bot', version: '1.0' }, records: W.recs, items: W.items(), at: AT });
  assert.ok(/isn't a loop step/.test(noLoop.why));
});

/* #123 (4.1.1): the example in docs/apps.md is one `fact sync` takes as written, only placed on this world's loop. */
rule('The fact sync example in docs/apps.md passes the same check fact sync uses', () => {
  const doc = require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'apps.md'), 'utf8');
  const at = doc.indexOf('`--from` is a JSON file'), m = /```json\n([\s\S]*?)\n```/.exec(doc.slice(at));
  assert.ok(at > 0 && m, 'the example is there');
  const W = world(), ex = JSON.parse(m[1]);
  const Pp = F.prepare(W.r, { obs: Object.assign({}, ex, { loopStep: 'each', item: 'ABC-101' }), by: { tool: 'git-bot', version: '1.0' }, records: W.recs, unread: W.unread, items: W.items(), at: AT, app: '4.0.0' });
  assert.ok(!Pp.why, Pp.why);
});

run();
