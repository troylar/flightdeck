// Living runs (4.0, docs/design.md 45), slice 1: to-do records in proposals/ (proposals, decisions, applications, compounds,
// grants and revokes), their limits, and the one reducer that turns a run's records into its work and each request's status.
'use strict';
const assert = require('assert');
const { load, rule, budget, run } = require('./harness');
const PF = load(), T = PF.todos, M = PF.map, E = PF.envelope, LP = PF.loop;
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, m) => m === undefined ? assert.deepStrictEqual(plain(a), plain(b)) : assert.deepStrictEqual(plain(a), plain(b), m);
const AT = '2026-11-09T09:00:00.000Z';

const MD = ['---', 'process: release-notes', 'title: Release notes', 'context: fix_version', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} Read them {#read}', ''].join('\n');
const MAP = M.parse(MD);
const RUN = { process: 'release-notes', id: 'r-1' };
const run0 = (head) => Object.assign({}, RUN, head ? { living: { head } } : {});
const BOT = { name: 'notes-bot', version: '1.0' };
const ADD = (text, target) => ({ op: 'add', text, target: target || { phase: 'draft' }, placement: { beforeGate: (target && target.phase === 'review') || (target && target.step === 'read') ? 'review-confirm' : 'draft-confirm' } });
function prop(key, body, seen) { return T.buildProposal({ run: RUN, producer: BOT, key, seen: seen || [], at: AT, app: '4.0.0', body }); }
function cleanOf(f, name) { const v = T.cleanFile(JSON.parse(T.text(f)), name || f.id + '.json'); assert.ok(v.ok, v.why); v.record._file = name || f.id + '.json'; return v.record; }
let revs = 0;
const rev = () => (++revs).toString(16).padStart(8, '0');
function dec(pid, op, by, seen, consequence) { const s = T.buildStatus({ kind: 'decision', proposal: pid, run: RUN, seen, by, at: AT, op, consequence: consequence || 'aaaaaaaaaaaaaaaa', writer: 'w1', rev: rev(), app: '4.0.0' }); return cleanOf(s.file, s.name); }
function apply(p, previous, seen, authority) {
  const s = T.buildStatus({ kind: 'application', proposal: p.id, run: RUN, seen: seen || [p.id].concat(previous ? [previous] : []), by: 'person-avery', at: AT, authority: authority || { grant: p.id }, previous: previous || '', effect: T.effectOf(p), writer: 'rec', rev: rev(), app: '4.0.0' });
  return cleanOf(s.file, s.name);
}
const ALL = { map: MAP, authority: () => ({ ok: true, via: 'test' }) };
const statusOf = (Tr, id) => Tr.requests[id].status;
const memFs = (files) => { const m = new PF.fs.MemoryFS('todos-' + Math.random(), null); Object.keys(files).forEach(p => { m.files[p] = { t: files[p], m: 1 }; }); return m; };
const has = (list, re) => assert.ok(list.some(x => re.test(x)), 'expected ' + re + ' in ' + JSON.stringify(list));

/* ---------- The format ---------- */
rule('living-runs is a frozen 4.0 feature of runs, to-do requests and their decisions', () => {
  assert.ok(E.FROZEN.indexOf('living-runs') >= 0);
  same(E.SINCE['living-runs'], '4.0');
  same(E.FAMILIES['flightdeck-plan'].majors[4], ['living-runs']);
  same(E.FAMILIES['flightdeck-plan-status'].majors[4], ['living-runs']);
  same([E.FAMILIES['flightdeck-plan'].future[4], E.FAMILIES['flightdeck-plan-status'].future[4]], ['4.0', '4.0']);
  assert.ok(E.FAMILIES['preflight-run'].majors[3].indexOf('living-runs') >= 0);
  same(E.judge('flightdeck-plan', { format: 'flightdeck-plan/4', features: ['living-runs'] }).ok, true);
  same(E.judge('flightdeck-plan', { format: 'flightdeck-plan/4', features: ['living-runs', 'later'] }).kind, 'newer');
});
rule('A tool\'s proposal is named from its tool and key over ["todo", tool, key]; its to-do\'s id comes from the request that added it', () => {
  const f = prop('k-1', ADD('Check the screenshots'));
  same(f.id, 'req-notes-bot-' + PF.sha256.hex(JSON.stringify(['todo', 'notes-bot', 'k-1'])).slice(0, 24));
  assert.notStrictEqual(f.id, LP.idFor('notes-bot', 'k-1'), 'never the name of a scope request with the same key');
  same([f.format, f.features, f.kind, f.todo], ['flightdeck-plan/4', ['living-runs'], 'proposal', T.todoIdFor(f.id)]);
  assert.ok(/^td-[0-9a-f]{24}$/.test(f.todo));
  const r = cleanOf(f);
  same([r.op, r.text, r.target, r.placement, r.by], ['add', 'Check the screenshots', { phase: 'draft' }, { beforeGate: 'draft-confirm' }, { tool: 'notes-bot', version: '1.0' }]);
  same(T.fileWhy(f.id + '.json', f), '');
});
rule('Every record kind reads back exactly as written', () => {
  const p = prop('k-2', ADD('Add the upgrade note', { step: 'read' }));
  const d = T.buildStatus({ kind: 'decision', proposal: p.id, run: RUN, seen: [p.id], by: 'person-avery', at: AT, op: 'accept', consequence: '0123456789abcdef', reason: 'Yes', writer: 'w1', rev: 'abcdef01' });
  const a = T.buildStatus({ kind: 'application', proposal: p.id, run: RUN, seen: [p.id, d.name.slice(0, -5)], by: 'person-avery', at: AT, authority: { decision: d.name.slice(0, -5) }, previous: '', effect: T.effectOf(cleanOf(p)), writer: 'rec', rev: 'abcdef02' });
  const g = T.buildGrant({ kind: 'grant', id: T.idFor('flightdeck', 'g-1'), run: RUN, seen: [], by: 'person-avery', at: AT, subject: { tool: 'notes-bot' }, ops: ['add', 'done'], targets: [{ phase: 'draft' }], limits: { adds: 5 } });
  const v = T.buildGrant({ kind: 'revoke', id: T.idFor('flightdeck', 'g-2'), run: RUN, seen: [g.id], by: 'person-avery', at: AT, grant: g.id, reason: 'Done with it' });
  const cp = T.buildProposal({ kind: 'compound', id: T.idFor('flightdeck', 'c-1'), run: RUN, by: 'person-avery', seen: [], at: AT, body: { op: 'done', todo: 'td-' + 'a'.repeat(24) },
    decision: { by: 'person-avery', consequence: '0123456789abcdef' }, application: { previous: '', effect: { op: 'done', todo: 'td-' + 'a'.repeat(24) }, fingerprint: T.fingerprint({ op: 'done', todo: 'td-' + 'a'.repeat(24) }) } });
  [[p, p.id + '.json'], [d.file, d.name], [a.file, a.name], [g, g.id + '.json'], [v, v.id + '.json'], [cp, cp.id + '.json']].forEach(([f, name]) => {
    same(T.fileWhy(name, f), '', name);
    const r = cleanOf(f, name);
    assert.strictEqual(r.kind, f.kind, name);
  });
  same(cleanOf(a.file, a.name).effect, { op: 'add', todo: p.todo, text: 'Add the upgrade note', target: { step: 'read' }, placement: { beforeGate: 'review-confirm' } });
});
rule('Every limit refuses a record whole; nothing is cut', () => {
  const why = (f, name) => { const v = T.cleanFile(JSON.parse(JSON.stringify(f)), name || f.id + '.json'); assert.ok(!v.ok, 'expected a refusal'); return v.why; };
  const base = prop('lim', ADD('x'));
  assert.ok(/most is 200/.test(why(Object.assign({}, base, { text: 'a'.repeat(201) }))));
  assert.ok(cleanOf(Object.assign({}, base, { text: 'a'.repeat(200) })).text.length === 200, '200 is allowed, kept whole');
  assert.ok(/most is 300/.test(why(Object.assign({}, base, { reason: 'r'.repeat(301) }))));
  assert.ok(/2048|2,048/.test(why(Object.assign({}, base, { origin: { link: 'https://example.com/' + 'a'.repeat(2048) } }))));
  assert.ok(/at most 50/.test(why(Object.assign({}, base, { seen: Array.from({ length: 51 }, (_, i) => T.idFor('x', 'k' + i)) }))));
  assert.ok(/control character/.test(why(Object.assign({}, base, { text: 'two\nlines' }))));
  assert.ok(/one operation per request/.test(why(Object.assign({}, base, { op: ['add', 'done'] }))));
  assert.ok(/has "extra"/.test(why(Object.assign({}, base, { extra: 1 }))));
  const big = Object.assign({}, base, { requester: 'person-avery' });
  big.origin = { link: 'https://example.com/' + 'a'.repeat(2000) };
  same(T.fileWhy(big.id + '.json', big), '', 'a record within every limit files');
  const wont = prop('w', { op: 'wont', todo: 'td-' + 'b'.repeat(24) });
  assert.ok(/why it won't be done/.test(why(wont)), 'a won\'t-do needs its reason');
  const mv = prop('m', { op: 'move', todo: 'td-' + 'b'.repeat(24) });
  assert.ok(/"to" is/.test(why(mv)), 'a move needs its destination');
  same(cleanOf(prop('m2', { op: 'move', todo: 'td-' + 'b'.repeat(24), to: { ticket: 'ABC-123' } })).to, { ticket: 'ABC-123' });
  assert.ok(/"to" "run"/.test(why(prop('m3', { op: 'move', todo: 'td-' + 'b'.repeat(24), to: { run: 'not a run' } }))));
  const huge = Object.assign({}, base); huge.text = 'a'.repeat(100);
  const t = T.text(huge); assert.ok(t.length < T.LIMITS.bytes);
  same(T.LIMITS.todos, 500); same(T.LIMITS.seen, 50); same(T.LIMITS.bytes, 262144);
  const g = T.buildGrant({ kind: 'grant', id: T.idFor('flightdeck', 'g-wont'), run: RUN, seen: [], by: 'person-avery', at: AT, subject: { tool: 'notes-bot' }, ops: ['wont'], targets: [{ phase: 'draft' }], limits: { adds: 1 } });
  assert.ok(/never drops work/.test(why(g)), 'a grant can\'t carry won\'t do');
  const s = T.buildStatus({ kind: 'application', proposal: base.id, run: RUN, seen: [base.id], by: 'person-avery', at: AT, authority: { grant: base.id }, previous: '', effect: T.effectOf(cleanOf(base)), writer: 'rec', rev: '00000001' });
  s.file.fingerprint = '0'.repeat(16);
  assert.ok(/doesn't match its effect/.test(why(s.file, s.name)));
  assert.ok(/name doesn't say its request/.test(why(s.file, 'req-other-' + 'c'.repeat(24) + '.status-rec-00000001.json')));
});
rule('A record in a newer format or without the feature is refused, named, never read as another kind', () => {
  const f = prop('n', ADD('x'));
  const v = T.cleanFile(Object.assign({}, f, { format: 'flightdeck-plan/5' }), f.id + '.json');
  same([v.ok, v.kind], [false, 'newer']);
  const w = T.cleanFile(Object.assign({}, f, { features: [] }), f.id + '.json');
  same([w.ok, w.kind], [false, 'malformed']);
  assert.ok(T.isTodo(f) && !LP.isScope(f), 'dispatched to the to-do reader, never the loop reader');
});

/* ---------- The reducer ---------- */
rule('Effective work is the chain of applications from the run\'s head: added, done, reopened; a prepared one off the chain changes nothing', () => {
  const p1 = cleanOf(prop('a1', ADD('Check the screenshots')));
  const a1 = apply(p1, '');
  const p2 = cleanOf(prop('a2', { op: 'done', todo: p1.todo }, [a1.id]));
  const a2 = apply(p2, a1.id, [p2.id, a1.id]);
  const recs = [p1, a1, p2, a2];
  let Tr = T.reduce(recs, run0(a1.id), ALL);
  same([Tr.todos.length, Tr.todos[0].state, statusOf(Tr, p1.id), statusOf(Tr, p2.id)], [1, 'open', 'applied', 'queued'], 'a2 is prepared, not reached: queued');
  Tr = T.reduce(recs, run0(a2.id), ALL);
  same([Tr.todos[0].state, statusOf(Tr, p2.id), Tr.chain], ['done', 'applied', [a1.id, a2.id]]);
  const p3 = cleanOf(prop('a3', { op: 'reopen', todo: p1.todo }, [a2.id])), a3 = apply(p3, a2.id, [p3.id, a2.id]);
  Tr = T.reduce(recs.concat([p3, a3]), run0(a3.id), ALL);
  same([Tr.todos[0].state, Tr.todos[0].id, Tr.todos[0].reopened], ['open', p1.todo, 1], 'reopening keeps the to-do\'s identity');
  same(T.reduce(recs, run0(''), ALL).todos, [], 'no head: nothing applied, whatever is prepared');
});
rule('Two copies of one record count once when they say the same; divergent copies hold it and everything after it', () => {
  const p1 = cleanOf(prop('c1', ADD('One'))), a1 = apply(p1, '');
  const copy = Object.assign({}, p1, { _file: p1.id + '-LAPTOP.json' });
  let Tr = T.reduce([p1, copy, a1], run0(a1.id), ALL);
  same([Tr.todos.length, statusOf(Tr, p1.id), Tr.held], [1, 'applied', []]);
  const diverged = Object.assign({}, p1, { text: 'Two' });
  Tr = T.reduce([p1, diverged, a1], run0(a1.id), ALL);
  assert.ok(Tr.held.some(h => h.record === p1.id && h.why === 'copies'), JSON.stringify(Tr.held));
  assert.ok(Tr.broken, 'the chain through it is held: ' + JSON.stringify(Tr.broken));
  same(Tr.todos, [], 'no work is read from a chain that can\'t be trusted');
});
rule('A record that saw one this copy can\'t read is held; a missing or circular application chain fails closed', () => {
  const p1 = cleanOf(prop('m1', ADD('One'))), ghost = T.idFor('other', 'gone');
  const p2 = cleanOf(prop('m2', ADD('Two'), [ghost]));
  let Tr = T.reduce([p1, p2], run0(''), ALL);
  same([statusOf(Tr, p1.id), statusOf(Tr, p2.id)], ['queued', 'held']);
  assert.ok(Tr.held.some(h => h.record === p2.id && h.missing.indexOf(ghost) >= 0));
  const a1 = apply(p1, '');
  Tr = T.reduce([p1], run0(a1.id), ALL);
  assert.ok(Tr.broken && /isn't in the folder/.test(Tr.broken.why), 'a head that names a missing application holds everything');
  same(statusOf(Tr, p1.id), 'held');
  /* a cycle: two applications that each name the other as previous (each saw the other: both held by the reducer) */
  const pa = cleanOf(prop('cy-a', ADD('A'))), pb = cleanOf(prop('cy-b', ADD('B')));
  const sa = T.buildStatus({ kind: 'application', proposal: pa.id, run: RUN, seen: [pa.id], by: 'person-avery', at: AT, authority: { grant: pa.id }, previous: '', effect: T.effectOf(pa), writer: 'rec', rev: 'c0000001' });
  const sb = T.buildStatus({ kind: 'application', proposal: pb.id, run: RUN, seen: [pb.id, sa.name.slice(0, -5)], by: 'person-avery', at: AT, authority: { grant: pb.id }, previous: sa.name.slice(0, -5), effect: T.effectOf(pb), writer: 'rec', rev: 'c0000002' });
  sa.file.previous = sb.name.slice(0, -5); sa.file.seen = [pa.id, sb.name.slice(0, -5)].sort();
  Tr = T.reduce([pa, pb, cleanOf(sa.file, sa.name), cleanOf(sb.file, sb.name)], run0(sb.name.slice(0, -5)), ALL);
  assert.ok(Tr.broken, 'a cycle never reads as work');
  same(Tr.todos, []);
});
rule('The same records in any order and under any file names reduce to the same work and statuses', () => {
  const p1 = cleanOf(prop('o1', ADD('One'))), a1 = apply(p1, '');
  const p2 = cleanOf(prop('o2', ADD('Two', { phase: 'review' }), [a1.id])), a2 = apply(p2, a1.id, [p2.id, a1.id]);
  const p3 = cleanOf(prop('o3', { op: 'done', todo: p1.todo }, [a2.id]));
  const d1 = dec(p3.id, 'accept', 'person-avery', [p3.id]), d2 = dec(p3.id, 'decline', 'person-blake', [p3.id]);
  const recs = [p1, a1, p2, a2, p3, d1, d2], shape = (Tr) => plain({ todos: Tr.todos.map(x => [x.id, x.state, x.disputed]), reqs: T.requestsOf(Tr).map(q => [q.id, q.status, q.why]), heads: Tr.heads.slice().sort() });
  const want = shape(T.reduce(recs, run0(a2.id), ALL));
  for (let i = 0; i < 12; i++) {
    const shuffled = recs.slice().sort(() => Math.random() - 0.5).map(x => Object.assign({}, x, { _file: 'copy-' + i + '-' + x._file }));
    same(shape(T.reduce(shuffled, run0(a2.id), ALL)), want, 'order ' + i);
  }
});
rule('Contrary decisions made at once are disputed and hold the to-do; one that saw both settles it', () => {
  const p1 = cleanOf(prop('d1', ADD('One'))), a1 = apply(p1, '');
  const p2 = cleanOf(prop('d2', { op: 'done', todo: p1.todo }, [a1.id]));
  const yes = dec(p2.id, 'accept', 'person-avery', [p2.id]), no = dec(p2.id, 'decline', 'person-blake', [p2.id]);
  let Tr = T.reduce([p1, a1, p2, yes, no], run0(a1.id), ALL);
  same([statusOf(Tr, p2.id), Tr.todos[0].disputed], ['disputed', true]);
  assert.ok(/at once/.test(Tr.requests[p2.id].why));
  const late = dec(p2.id, 'accept', 'person-casey', [p2.id, yes.id]);
  Tr = T.reduce([p1, a1, p2, yes, no, late], run0(a1.id), ALL);
  same(statusOf(Tr, p2.id), 'disputed', 'one that saw only one side doesn\'t settle it');
  const settle = dec(p2.id, 'decline', 'person-avery', T.seenFor(Tr, [p2.id], [p2.id]).seen);
  Tr = T.reduce([p1, a1, p2, yes, no, late, settle], run0(a1.id), ALL);
  same([statusOf(Tr, p2.id), Tr.todos[0].disputed], ['declined', false]);
});
rule('Two prepared applications of one request at once are disputed until one lands; the one the head reaches is applied', () => {
  const p1 = cleanOf(prop('two', ADD('One')));
  const x = apply(p1, ''), y = T.buildStatus({ kind: 'application', proposal: p1.id, run: RUN, seen: [p1.id], by: 'person-blake', at: AT, authority: { grant: p1.id }, previous: T.idFor('other', 'prev'), effect: T.effectOf(p1), writer: 'rec2', rev: rev() });
  y.file.seen = [p1.id];
  const yc = cleanOf(y.file, y.name);
  let Tr = T.reduce([p1, x, yc], run0(''), ALL);
  same(statusOf(Tr, p1.id), 'disputed');
  Tr = T.reduce([p1, x, yc], run0(x.id), ALL);
  same([statusOf(Tr, p1.id), Tr.requests[p1.id].candidates.length], ['applied', 2], 'the other is kept as a candidate');
});
rule('Past 50 heads a new record names a page: what it must see first; a wider dispute settles a page at a time and holds until the last', () => {
  const ps = Array.from({ length: 60 }, (_, i) => cleanOf(prop('h' + i, ADD('Item ' + i))));
  let Tr = T.reduce(ps, run0(''), ALL);
  same(Tr.heads.length, 60);
  const pg = T.seenFor(Tr, [ps[59].id], [ps[59].id]);
  same([pg.seen.length, pg.seen.indexOf(ps[59].id) >= 0, pg.left], [50, true, 0]);
  const target = ps[0];
  const many = Array.from({ length: 60 }, (_, i) => dec(target.id, i % 2 ? 'accept' : 'decline', 'person-' + i, [target.id]));
  Tr = T.reduce(ps.concat(many), run0(''), ALL);
  same(statusOf(Tr, target.id), 'disputed');
  assert.ok(/more than one record can settle \(50\)/.test(Tr.requests[target.id].why), Tr.requests[target.id].why);
  const page1 = T.seenFor(Tr, [target.id], [target.id]);
  same([page1.seen.length, page1.left], [50, 11]);
  const s1 = dec(target.id, 'accept', 'person-avery', page1.seen);
  Tr = T.reduce(ps.concat(many, [s1]), run0(''), ALL);
  same(statusOf(Tr, target.id), 'disputed', 'still held after the first page');
  assert.ok(Tr.requests[target.id].decOut.length <= 50 && Tr.requests[target.id].decOut.indexOf(s1.id) >= 0, 'the page took the place of what it saw');
  const page2 = T.seenFor(Tr, [target.id], [target.id]);
  same(page2.left, 0);
  const s2 = dec(target.id, 'accept', 'person-avery', page2.seen);
  Tr = T.reduce(ps.concat(many, [s1, s2]), run0(''), ALL);
  same(statusOf(Tr, target.id), 'queued', 'settled after the last page');
});
rule('A run takes 500 to-dos ever added; the next is held whole, never cut', () => {
  const recs = [], ids = [];
  let prev = '';
  for (let i = 0; i < 500; i++) { const p = cleanOf(prop('l' + i, ADD('Item ' + i), prev ? [prev] : [])), a = apply(p, prev, [p.id].concat(prev ? [prev] : [])); recs.push(p, a); prev = a.id; ids.push(p.id); }
  const extra = cleanOf(prop('l500', ADD('One more'), [prev]));
  const Tr = T.reduce(recs.concat([extra]), run0(prev), ALL);
  same([Tr.todos.length, statusOf(Tr, extra.id)], [500, 'held']);
  assert.ok(/500 to-dos added/.test(Tr.requests[extra.id].why));
});
rule('An addition must name its exact placement in the run\'s own checklist; anything else needs placement', () => {
  const bad = cleanOf(prop('p1', { op: 'add', text: 'x', target: { phase: 'draft' }, placement: { beforeGate: 'review-confirm' } }));
  const gone = cleanOf(prop('p2', { op: 'add', text: 'x', target: { phase: 'nowhere' }, placement: { beforeGate: 'nowhere-confirm' } }));
  const Tr = T.reduce([bad, gone], run0(''), ALL);
  same([statusOf(Tr, bad.id), statusOf(Tr, gone.id)], ['held', 'held']);
  assert.ok(/needs placement/.test(Tr.requests[bad.id].why) && /isn't in this run's checklist/.test(Tr.requests[gone.id].why));
  same(T.placementFor(MAP, { step: 'read' }), { beforeGate: 'review-confirm' });
});
rule('Loops keep their reducer: the settlement and paging they share are the same functions', () => {
  assert.strictEqual(typeof LP.settleIn, 'function');
  assert.strictEqual(typeof LP.page, 'function');
  const heads = Array.from({ length: 60 }, (_, i) => 'req-x-' + String(i).padStart(24, '0'));
  same(LP.seenFor({ heads, items: [], requests: {} }, [], [], []).seen.length, 50);
  const P = LP.page(heads, [heads[59]], []);
  same([P.seen.length, P.seen.indexOf(heads[59]) >= 0], [50, true]);
});
budget('Reducing a run with 500 to-dos and 1,500 records stays under 400 ms', () => {
  const recs = []; let prev = '';
  for (let i = 0; i < 500; i++) { const p = cleanOf(prop('b' + i, ADD('Item ' + i), prev ? [prev] : [])), a = apply(p, prev, [p.id].concat(prev ? [prev] : [])); recs.push(p, a); prev = a.id; recs.push(dec(p.id, 'accept', 'person-avery', [p.id])); }
  const t0 = Date.now(); const Tr = T.reduce(recs, run0(prev), ALL); const ms = Date.now() - t0;
  same(Tr.todos.length, 500);
  assert.ok(ms < 400, ms + ' ms');
});

rule('A newer to-do record (living-runs, any format version) holds its run as unread, never reaching another reader', async () => {
  const p = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'c5'), by: 'person-avery', seen: [], at: AT, body: ADD('X') });
  const f5 = Object.assign({}, p, { format: 'flightdeck-plan/5' }), s5 = { format: 'flightdeck-plan-status/5', features: ['living-runs'], kind: 'decision', proposal: p.id, run: RUN };
  const fs = memFs({ ['proposals/' + p.id + '.json']: T.text(f5), ['proposals/' + p.id + '.status-w1-0000abcd.json']: T.text(s5) });
  const d = await PF.repo.readPlans(fs);
  same([d.todos.length, d.todosUnread.length, d.todosUnread.every(u => u.run && u.run.id === 'r-1'), d.plans.length + d.statuses.length + d.scopes.length], [0, 2, true, 0]);
  assert.ok(d.todosUnread.every(u => /newer/.test(u.why)), JSON.stringify(d.todosUnread));
  const r = { process: RUN.process, id: RUN.id, steps: {} };
  T.markHolds([r], { records: d.todos, unread: d.todosUnread, people: { people: [] } });
  assert.ok(r._todos && r._todos.all.length, 'held');
});
rule('A to-do record over 256 KiB in UTF-8 is refused before it is read, and the writer counts bytes', async () => {
  const p = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'f1'), by: 'person-avery', seen: [], at: AT, body: ADD('Big') });
  const t = T.text(p), pad = t.slice(0, -2) + ' '.repeat(262554 - t.length) + '}\n';
  const d = await PF.repo.readPlans(memFs({ ['proposals/' + p.id + '.json']: pad }));
  same([d.todos.length, d.todosUnread.length], [0, 1]);
  assert.ok(/bytes/.test(d.todosUnread[0].why), d.todosUnread[0].why);
  const wide = Object.assign({}, p, { text: 'é'.repeat(140000) });
  assert.ok(/bytes/.test(T.fileWhy(p.id + '.json', wide)), T.fileWhy(p.id + '.json', wide));
  assert.ok(/bytes/.test(LP.fileWhy('req-x.json', { seen: [], title: '\u00e9'.repeat(140000) })), 'a scope record\'s writer counts bytes too');
});
rule('An application\'s effect with a field its op doesn\'t have, or one out of its limit, is refused, never dropped', () => {
  const p = cleanOf(prop('s1', ADD('One'))), d = cleanOf(prop('s2', { op: 'done', todo: p.todo }, [p.id]));
  const s = T.buildStatus({ kind: 'application', proposal: d.id, run: RUN, seen: [d.id], by: 'person-avery', at: AT, authority: { decision: d.id + '.status-w1-00000000' }, previous: '', effect: T.effectOf(d), writer: 'rec', rev: '0000abcd' });
  same(T.cleanFile(JSON.parse(T.text(s.file)), s.name).ok, true, 'set-up');
  [['text', 'x'.repeat(201)], ['text', 'Fine'], ['target', { phase: 'draft' }], ['owner', 'person-avery'], ['origin', { step: 'write' }], ['to', { ticket: 'ABC-1' }], ['placement', { beforeGate: 'draft-confirm' }]].forEach(([k, v]) => {
    const f = JSON.parse(T.text(s.file)); f.effect[k] = v;
    same(T.cleanFile(f, s.name).ok, false, k);
  });
});
run();
