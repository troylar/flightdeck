// Insights: how runs of one publication folder went, counted so every number says what it counts, out of how many runs, and
// which runs it couldn't count. docs/design.md section 23.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { load, rule, run } = require('./harness');
const PF = load(), R = PF.run, P = PF.publish, I = PF.insights, F = PF.followups;
const NOW = '2026-10-17T21:00:00.000Z', T0 = Date.parse(NOW), NOW_MS = T0 + 40 * 86400000;
const at = m => new Date(T0 + m * 60000).toISOString();
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

const MD = ['---', 'process: x', 'title: X', 'context: commit', '---',
  '## Prep · READ-DO {#prep}', '- [ ] {confirm} One {#one}', '- [ ] {confirm} Two {#two}', '## Gate: Ready {#ready}', '  approves: ^commit',
  '## Ship · READ-DO {#ship}', '- [ ] {confirm} Three {#three}', '## Gate: Shipped {#shipped}'].join('\n');
const pubOf = (md, rand) => { const b = P.build(md || MD, { people: [], by: 'a', changes: 'x', existing: [], now: NOW, rand: rand || 'aaaa1111' }); assert.ok(!b.blockers, String(b.blockers)); return P.verify(b.folder, b.files); };
const PUB = pubOf();
const FOLDER = PUB.info.folder;
let n = 0;
/* A run of pub played to the end: every step done, both gates passed (a minute apart from its start), ended Completed.
   o.before(r, map) runs before the steps are answered; o.outcome, o.running, o.minutes change the ending. */
function play(o) {
  o = o || {};
  const r = R.create(o.pub || PUB, { details: { commit: 'aaa' }, roles: {}, by: 'a', session: 's', now: at(0), id: o.id || 'r' + (++n), title: o.title || 'Run ' + n });
  const map = R.mapOf(r);
  if (o.before) o.before(r, map);
  ['one', 'two'].forEach(id => { if (!r.steps[id] || r.steps[id].s !== 'done') R.done(r, map, id, 'a', at(1)); });
  if (o.mid) o.mid(r, map);
  if (o.running === 'early') return r;
  R.pass(r, map, 0, 'a', at(10));
  R.done(r, map, 'three', 'a', at(11));
  if (o.running) return r;
  R.pass(r, map, 1, 'a', at(o.minutes || 30));
  R.end(r, map, o.outcome || 'Completed', 'a', 'A', at(o.minutes || 30));
  r._fileHash = 'h' + r.id;
  return r;
}
const forX = (input, opts) => I.forProcess(Object.assign({ runs: [] }, input), 'x', Object.assign({ now: NOW_MS, folder: FOLDER }, opts || {}));
const step = (res, id) => res.steps.filter(s => s.id === id)[0];

rule('Insights need an explicit now and a publication folder; the same input gives the same output', () => {
  const runs = [play(), play()];
  assert.throws(() => I.forProcess({ runs }, 'x', { folder: FOLDER }), /now/);
  assert.throws(() => I.forProcess({ runs }, 'x', { now: NOW_MS }), /folder/);
  same(forX({ runs }), forX({ runs }));
});

rule('A block archived out of a run\'s retained answers still counts, through the run\'s marks', () => {
  const r = play({ before: (r, map) => {
    R.block(r, map, 'one', 'Waiting', 'a', at(1));
    for (let i = 0; i < 12; i++) { R.clear(r, map, 'one', 'a', at(1)); R.done(r, map, 'one', 'a', at(1)); }
  } });
  assert.ok(!r.steps.one.history.some(h => h.s === 'blocked'), 'set-up: the block is no longer in run.json\'s answers');
  assert.ok(r.marks.one.indexOf('blocked') >= 0, 'set-up: the mark is');
  const s = step(forX({ runs: [r, play()] }), 'one');
  same([s.blocked.hits, s.blocked.n, s.offScript.hits], [1, 2, 1]);
});

rule('A run without marksFrom "start" and no retained deviation is history incomplete, never counted as clean', () => {
  const legacy = play(); delete legacy.marksFrom; delete legacy.marks;
  const legacyBlocked = play({ before: (r, map) => { R.block(r, map, 'one', 'x', 'a', at(1)); } }); delete legacyBlocked.marksFrom;
  const res = forX({ runs: [legacy, legacyBlocked, play()] });
  const s = step(res, 'one');
  same([s.blocked.hits, s.blocked.n, s.blocked.incomplete], [1, 2, 1], 'the legacy run with nothing retained is left out of the denominator and counted apart');
  same(s.blocked.incompleteKeys, ['x/' + legacy.id]);
  same([s.offScript.hits, s.offScript.incomplete], [1, 1]);
  assert.ok(/history incomplete/i.test(I.DEFS.filter(d => d.id === 'blocked')[0].denominator), 'the definition says so');
});

rule('A kept last copy of an unreadable run, a run whose file is gone and a run from a newer copy are left out of every number, and named', () => {
  const ok = play(), unread = play(), gone = play(), newer = play();
  newer._unrunnable = 'This run was saved by a newer copy of Flightdeck.';
  const res = forX({ runs: [ok, unread, gone, newer], runStatus: { ['x/' + unread.id]: 'unread', ['x/' + gone.id]: 'missing' } });
  assert.strictEqual(res.runs.n, 1);
  same(res.duration.n, 1);
  same(step(res, 'one').skipped.n, 1);
  const lines = res.excluded.map(e => e.text);
  assert.ok(lines.indexOf('1 run couldn\'t be read; its last copy isn\'t counted.') >= 0, lines.join(' | '));
  assert.ok(lines.some(l => /^1 run's file is gone from the team folder/.test(l)), lines.join(' | '));
  assert.ok(lines.some(l => /^1 run is from a newer Flightdeck/.test(l)), lines.join(' | '));
  same(res.excluded.map(e => e.keys.length), [1, 1, 1]);
});

rule('Runs that couldn\'t be read at all on the last check say the numbers come from the last read', () => {
  const res = forX({ runs: [play()], failedParts: { runs: 'denied' } });
  assert.ok(res.notes.some(l => /runs folder couldn't be read/.test(l)), res.notes.join(' | '));
});

rule('Decisions that couldn\'t be read flag only the follow-up (or correction) numbers', () => {
  const res = forX({ runs: [play(), play()], decisionsUnread: { followups: 2, corrections: 0 } });
  assert.ok(/2 decisions couldn't be read; those follow-ups may show the wrong status\./.test(res.followUps.note), String(res.followUps.note));
  assert.ok(!res.notes.some(l => /decision/.test(l)), 'not a note on every number');
  assert.ok(!res.corrections.note, 'corrections aren\'t flagged by follow-up decisions');
  const c = forX({ runs: [play()], decisionsUnread: { corrections: 1 } });
  assert.ok(/1 decision on corrections couldn't be read/.test(c.corrections.note) && !c.followUps.note);
});

rule('An incomplete progressive load labels every number as not final', () => {
  const res = forX({ runs: [play()], loading: { done: 640, total: 2000 } });
  assert.strictEqual(res.final, false);
  assert.ok(res.notes.indexOf('Still reading runs (640 of 2,000). These numbers aren\'t final.') >= 0, res.notes.join(' | '));
  assert.strictEqual(forX({ runs: [play()] }).final, true);
});

rule('A run with a gate time before its phase began keeps its step counts and drops its times, with the reason', () => {
  const bad = play({ before: (r, map) => { R.block(r, map, 'one', 'x', 'a', at(1)); } });
  bad.gates.ready.at = at(-5);
  const res = forX({ runs: [bad, play()] });
  same([step(res, 'one').blocked.hits, step(res, 'one').blocked.n], [1, 2], 'its steps still count');
  const prep = res.phases[0], ship = res.phases[1];
  same([prep.n, prep.of], [1, 2]);
  assert.ok(prep.excluded.some(e => /backward/.test(e.text) && e.keys[0] === 'x/' + bad.id), JSON.stringify(prep.excluded));
  same(ship.n, 1, 'the next phase starts at that gate, so it is left out too');
  assert.ok(ship.excluded.some(e => /earlier gate/.test(e.text)), JSON.stringify(ship.excluded));
  same(res.duration.n, 1, 'a gate before the start breaks the run\'s chronology, so its whole time is left out too');
  assert.ok(res.duration.q.excluded.some(g => g.why === 'backward' && g.keys[0] === 'x/' + bad.id));
});

rule('Timing exclusions apply per metric: an unreadable start time drops the run from times only', () => {
  const r = play(); r.created = 'not a time';
  const res = forX({ runs: [r, play()] });
  same([res.duration.n, res.phases[0].n, res.runs.n, step(res, 'one').skipped.n], [1, 1, 2, 2]);
  assert.ok(res.duration.excluded.some(e => /time couldn't be read/.test(e.text)));
});

rule('Long runs are shown, not excluded', () => {
  const res = forX({ runs: [play({ minutes: 60 * 24 * 45 })] }, { now: NOW_MS + 30 * 86400000 });
  same(res.duration.n, 1);
  assert.ok(res.duration.median > 30 * 86400000);
});

rule('Phase time runs from the previous gate\'s settle time to this gate\'s, without paused time', () => {
  const r = play({ mid: (r) => { R.pause(r, 'Lunch', 'a', at(2)); R.resume(r, 'a', at(6)); } });
  const res = forX({ runs: [r] });
  same([res.phases[0].median, res.phases[1].median], [6 * 60000, 20 * 60000]);
});

rule('A reopened gate leaves that phase\'s time out with a reason, and so does a missing earlier gate', () => {
  const reopened = play({ running: true });
  R.setDetail(reopened, R.mapOf(reopened), 'commit', 'bbb', 'a', at(12));
  assert.strictEqual(reopened.gates.ready.s, 'review', 'set-up: the gate went back for review');
  const noFirst = play(); delete noFirst.gates.ready;
  const res = forX({ runs: [reopened, noFirst, play()] }, { includeRunning: true });
  const prep = res.phases[0], ship = res.phases[1];
  assert.ok(prep.excluded.some(e => /reopened/.test(e.text) && e.keys.indexOf('x/' + reopened.id) >= 0), JSON.stringify(prep.excluded));
  assert.ok(prep.excluded.some(e => /wasn't passed or waived/.test(e.text) && e.keys.indexOf('x/' + noFirst.id) >= 0), JSON.stringify(prep.excluded));
  assert.ok(ship.excluded.some(e => /earlier gate/.test(e.text) && e.keys.indexOf('x/' + noFirst.id) >= 0), 'its later phase is left out: it has no start');
  same([prep.n, ship.n], [1, 1]);
});

rule('Two publication folders with the same version number never merge, and each is labeled a clash', () => {
  const a = PUB, b = pubOf(MD, 'bbbb2222');
  assert.strictEqual(a.info.version, b.info.version, 'set-up: both are v1');
  const runs = [play({ pub: a }), play({ pub: b }), play({ pub: b })];
  same([forX({ runs }).runs.n, forX({ runs }, { folder: b.info.folder }).runs.n], [1, 2]);
  const list = I.folders(runs, 'x', [a, b], [1]);
  same(list.map(f => [f.folder, f.version, f.clash, f.runs]).sort(), [[a.info.folder, 1, true, 1], [b.info.folder, 1, true, 2]].sort());
});

rule('Each metric has its own denominator: skipped counts runs with a current answer, the ever counts the runs that reached the step', () => {
  const runs = [play(), play(), play({ running: 'early' })];
  const r3 = runs[2]; R.pass(r3, R.mapOf(r3), 0, 'a', at(2)); R.block(r3, R.mapOf(r3), 'three', 'Not yet', 'a', at(3));
  const res = forX({ runs }, { includeRunning: true });
  const three = step(res, 'three');
  same([three.skipped.n, three.blocked.n, three.blocked.hits], [3, 3, 1]);
  const off = forX({ runs });
  same([step(off, 'three').blocked.n, off.runs.n, off.runs.running], [2, 3, 1], 'running runs are left out of step numbers unless asked for, and still listed as runs');
});

rule('With running runs included, an unanswered step counts as reached only when it has a mark', () => {
  const r = play({ running: 'early' }), map = R.mapOf(r);
  R.pass(r, map, 0, 'a', at(2)); R.block(r, map, 'three', 'x', 'a', at(2)); R.clear(r, map, 'three', 'a', at(3));
  const plain = play({ running: 'early' });
  r.steps.three = { s: 'open' };
  const s = step(forX({ runs: [r, plain] }, { includeRunning: true }), 'three');
  same([s.blocked.n, s.blocked.hits, s.skipped.n], [1, 1, 0]);
});

rule('Any off-script is a union: never more than the sum of its parts, never less than any one of them', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const runs = Array.from({ length: 40 }, () => play({ before: (r, map) => {
    if (rnd() < 0.3) R.block(r, map, 'one', 'x', 'a', at(1));
    if (rnd() < 0.3) { R.clear(r, map, 'one', 'a', at(1)); R.na(r, map, 'one', 'a', at(1)); }
    R.done(r, map, 'one', 'a', at(1));
    if (rnd() < 0.3) R.differently(r, map, 'one', 'other way', 'a', at(1));
  } }));
  const s = step(forX({ runs }), 'one'), parts = ['blocked', 'redone', 'na', 'differently'].map(k => s[k].hits);
  assert.ok(s.offScript.hits <= parts.reduce((a, b) => a + b, 0), 'at most the sum');
  parts.forEach(p => assert.ok(s.offScript.hits >= p, 'at least each part'));
  assert.ok(parts.filter(p => p > 0).length >= 2 && s.offScript.hits < parts.reduce((a, b) => a + b, 0), 'set-up: parts overlap');
});

rule('Rates show from 5 runs up; under 5 it\'s counts only', () => {
  same([I.count(3, 4), I.count(3, 14), I.count(0, 0)], ['3 of 4 runs', '21% · 3 of 14 runs', 'No runs yet']);
  assert.strictEqual(I.rated(4), false); assert.strictEqual(I.rated(5), true);
  assert.strictEqual(I.FEW, 'Too few runs for a rate yet.');
});

rule('A drill-down keeps the runs behind the number clicked; a change to one of them is noticed, and current numbers come from the same spec', () => {
  const runs = [play({ before: (r, map) => R.block(r, map, 'one', 'x', 'a', at(1)) }), play(), play({ before: (r, map) => R.block(r, map, 'one', 'x', 'a', at(1)) })];
  const res = forX({ runs }), sel = I.select(res, 'step:one:blocked');
  same(sel.keys, runs.filter(r => I.matches(r, { process: 'x', folder: FOLDER, path: 'step:one:blocked' })).map(r => 'x/' + r.id));
  assert.ok(/One/.test(sel.label) && /blocked/.test(sel.label), sel.label);
  const spec = I.spec(res, 'step:one:blocked', runs);
  same([spec.keys.length, spec.asOf], [2, NOW_MS]);
  assert.strictEqual(I.changed(spec, runs), 0);
  runs[0].rev = 99;
  assert.strictEqual(I.changed(spec, runs), 1, 'one of them changed');
  assert.strictEqual(I.changed(spec, runs.slice(1)), 1, 'one is gone');
  runs[1].marks = { one: ['blocked'] };
  const again = I.select(forX({ runs }), spec.path);
  same(again.keys.length, 3, 'current numbers recompute from the spec');
  assert.strictEqual(I.select(res, 'nonsense'), null);
});

rule('Corrections count distinct runs of this folder per step, grouped by status', () => {
  const runs = [play(), play(), play()];
  const groups = [
    { target: { step: 'one' }, status: 'open', members: [{ run: runs[0].id, folder: FOLDER }, { run: runs[0].id, folder: FOLDER }, { run: runs[1].id, folder: FOLDER }] },
    { target: { step: 'one' }, status: 'applied', members: [{ run: runs[1].id, folder: FOLDER }, { run: 'elsewhere', folder: 'v9-other' }] }
  ];
  const s = step(forX({ runs, corrections: groups }), 'one');
  same([s.corrections.hits, s.corrections.n, s.corrections.groups], [2, 3, { open: 1, applied: 1 }]);
});

rule('Follow-up ages are by the recorder\'s clock in buckets, and time to a decision uses the current decision', () => {
  const runs = [play(), play(), play()], fus = [];
  const days = d => new Date(NOW_MS - d * 86400000).toISOString();
  [[runs[0], 'f1', 3], [runs[1], 'f2', 10], [runs[2], 'f3', 45]].forEach(([r, id, d]) => { R.addFollowUp(r, { id, text: 'Do ' + id }, 'a', days(d)); });
  R.addFollowUp(runs[0], { id: 'f4', text: 'Broken time' }, 'a', 'garbage');
  R.addFollowUp(runs[1], { id: 'f5', text: 'Decided' }, 'a', days(20));
  const d1 = F.decision({ process: 'x', run: runs[1].id, id: 'f5' }, 'a', 'done', {}, days(19));
  const d2 = F.decision({ process: 'x', run: runs[1].id, id: 'f5' }, 'a', 'wont', { reason: 'No' }, days(16), d1);
  d1._file = 'a'; d2._file = 'b';
  const res = forX({ runs, followUps: F.list(runs, [d1, d2]) });
  same([res.followUps.open.n, res.followUps.open.buckets.map(b => b.keys.length)], [3, [1, 1, 1]]);
  assert.ok(res.followUps.open.excluded.some(e => e.keys.length === 1), 'a time that can\'t be read is left out, and said');
  same([res.followUps.decided.n, res.followUps.decided.median], [1, 4 * 86400000]);
  assert.ok(/recorder's clock/.test(res.followUps.open.clock) && /decider's clock/.test(res.followUps.decided.clock));
  const later = forX({ runs, followUps: F.list(runs, [d1, d2]) }, { now: NOW_MS + 30 * 86400000 });
  same(later.followUps.open.buckets.map(b => b.keys.length), [0, 0, 3], 'now moves only the ages');
});

rule('Who has done each role counts runs of this folder only', () => {
  const other = pubOf(MD, 'cccc3333');
  const runs = [play(), play({ pub: other })];
  runs[0].roles = { lead: 'person-avery' }; runs[1].roles = { lead: 'person-blake' };
  same(Object.keys(forX({ runs }).roles.grid), ['person-avery']);
});

rule('Runs filters: process, folder, outcome and dates, with dates inclusive in local time', () => {
  const a = play(), b = play({ outcome: 'Cancelled' }), c = play({ running: true });
  const day = new Date(Date.parse(a.created)), ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const ids = f => I.filterRuns([a, b, c], f).map(r => r.id);
  same(ids({ process: 'x', outcome: 'Completed' }), [a.id]);
  same(ids({ outcome: 'running' }), [c.id]);
  same(ids({ folder: 'v9-none' }), []);
  same(ids({ from: ymd(day), through: ymd(day) }), [a.id, b.id, c.id], 'the same day, from and through');
  same(ids({ from: ymd(new Date(day.getTime() + 86400000)) }), []);
});

// ---------- Review of 9e7cffc ----------
rule('Times later than now, by the clock of the computer that wrote them, are left out of times with that reason', () => {
  const ahead = play(); ahead.ended.at = new Date(NOW_MS + 400 * 86400000).toISOString();
  const absurd = play(); absurd.ended.at = new Date(T0 + 1e13).toISOString();
  const gate = play(); gate.gates.ready.at = new Date(NOW_MS + 86400000).toISOString();
  const res = forX({ runs: [ahead, absurd, gate, play()] });
  same([res.duration.n, res.duration.of], [1, 4], 'a gate later than now leaves the whole time out too');
  assert.ok(res.duration.excluded.some(e => /later than now, by the recorder's clock/.test(e.text) && e.keys.length === 3), JSON.stringify(res.duration.excluded));
  assert.ok(res.duration.max < 86400000, 'the scale isn\'t stretched by them');
  assert.ok(res.phases[0].excluded.some(e => /later than now/.test(e.text) && e.keys[0] === 'x/' + gate.id), JSON.stringify(res.phases[0].excluded));
});

rule('A gate reopened and passed again leaves its phase out as reopened, from the run\'s log or from its gate times', () => {
  const r = play({ running: true }), m = R.mapOf(r);
  R.reopen(r, m, 0, 'a', at(12)); R.pass(r, m, 0, 'a', at(200)); R.pass(r, m, 1, 'a', at(210)); R.end(r, m, 'Completed', 'a', 'A', at(210));
  const res = forX({ runs: [r, play()] });
  assert.ok(res.phases[0].excluded.some(e => /reopened/.test(e.text) && e.keys[0] === 'x/' + r.id), JSON.stringify(res.phases[0].excluded));
  same([res.phases[0].n, res.phases[0].median], [1, 10 * 60000], 'the 200 minutes aren\'t counted');
  assert.ok(res.phases[1].excluded.some(e => /earlier gate/.test(e.text)));
  // A detail change sends the first gate back for review after the second passed; it's passed again later.
  const b = play({ running: true }), mb = R.mapOf(b);
  R.pass(b, mb, 1, 'a', at(20)); R.setDetail(b, mb, 'commit', 'bbb', 'a', at(25)); R.pass(b, mb, 0, 'a', at(40)); R.end(b, mb, 'Completed', 'a', 'A', at(45));
  const rb = forX({ runs: [b] });
  assert.ok(rb.phases[0].excluded.some(e => /reopened/.test(e.text)), JSON.stringify(rb.phases[0].excluded));
  assert.ok(!rb.phases[1].excluded.some(e => /backward/.test(e.text)), 'not blamed on the clock');
  // Without the log entries, a gate settled after a later gate still says reopened.
  b.log = []; const rc = forX({ runs: [b] });
  assert.ok(rc.phases[0].excluded.some(e => /reopened/.test(e.text)), JSON.stringify(rc.phases[0].excluded));
  assert.ok(/log/.test(I.DEFS.filter(d => d.id === 'phase')[0].denominator), 'the definition says what is detected');
});

rule('A follow-up count and its drill-down agree: the label says how many follow-ups in how many runs', () => {
  const r = play(), r2 = play(), day = new Date(NOW_MS - 86400000).toISOString();
  ['f1', 'f2', 'f3'].forEach(id => R.addFollowUp(r, { id, text: id }, 'a', day));
  const res = forX({ runs: [r, r2], followUps: F.list([r, r2], []) }), b = res.followUps.open.buckets[0];
  same([b.items.length, b.keys.length], [3, 1]);
  assert.ok(/3 follow-ups in 1 run/.test(I.select(res, 'fu:lt7').label), I.select(res, 'fu:lt7').label);
});

rule('A drill-down notices a change to a run\'s follow-up decisions, its corrections\' status or its readability, not only its file', () => {
  const runs = [play(), play()]; R.addFollowUp(runs[0], { id: 'f1', text: 'x' }, 'a', at(5));
  const fus = F.list(runs, []), res = forX({ runs, followUps: fus });
  const sp = I.spec(res, 'runs:all', runs, res);
  assert.strictEqual(I.changed(sp, runs, res), 0);
  const d = F.decision({ process: 'x', run: runs[0].id, id: 'f1' }, 'a', 'done', {}, at(6)); d._file = 'a';
  assert.strictEqual(I.changed(sp, runs, forX({ runs, followUps: F.list(runs, [d]) })), 1, 'a decision');
  const groups = [{ target: { step: 'one' }, status: 'open', members: [{ run: runs[1].id, folder: FOLDER }] }];
  const before = forX({ runs, corrections: groups }), sp2 = I.spec(before, 'runs:all', runs, before);
  assert.strictEqual(I.changed(sp2, runs, forX({ runs, corrections: [Object.assign({}, groups[0], { status: 'applied' })] })), 1, 'a correction decided');
  assert.strictEqual(I.changed(sp, runs, forX({ runs, followUps: fus, runStatus: { ['x/' + runs[1].id]: 'unread' } })), 1, 'a run that can no longer be read');
});

rule('With no readable run the version still comes from the folder\'s runs', () => {
  const r = play(), res = forX({ runs: [r], runStatus: { ['x/' + r.id]: 'unread' } });
  assert.strictEqual(I.spec(res, 'ex:unread', [r]).version, 1);
});

rule('Gates waived and failed are counted per phase, each out of the runs that reached the gate', () => {
  const w = play({ running: true }), mw = R.mapOf(w);
  w.gates.ready = { s: 'waived', by: 'a', at: at(10), reason: 'ok', approved: { commit: 'aaa' } };
  const f = play({ running: 'early' }); R.fail(f, R.mapOf(f), 0, 'Broke', 'a', at(5)); R.end(f, R.mapOf(f), 'Stopped early', 'a', 'A', at(6));
  R.end(w, mw, 'Stopped early', 'a', 'A', at(20));
  const res = forX({ runs: [w, f, play(), play({ running: 'early' })] });
  const g = res.phases[0].gate;
  same([g.waived.hits, g.waived.n, g.failed.hits, g.failed.n], [1, 3, 1, 3]);
  same(I.select(res, 'gate:prep:failed').keys, ['x/' + f.id]);
});

rule('Correction statuses count groups, so they never add up to more than they say', () => {
  const runs = [play(), play()];
  const groups = [{ target: { step: 'one' }, status: 'open', members: [{ run: runs[0].id, folder: FOLDER }, { run: runs[1].id, folder: FOLDER }] },
    { target: { step: 'one' }, status: 'applied', members: [{ run: runs[0].id, folder: FOLDER }] }];
  same(step(forX({ runs, corrections: groups }), 'one').corrections.groups, { open: 1, applied: 1 });
});

rule('Every number\'s runs are exactly the runs matches() picks, so working a number out again by select() is the same as asking matches()', () => {
  const runs = [play({ before: (r, m) => R.block(r, m, 'one', 'x', 'a', at(1)) }), play({ running: 'early' }), play({ outcome: 'Cancelled' }), play(), play(), play(), play()];
  delete runs[3].marksFrom;
  runs[4]._unrunnable = 'newer';
  const f = play({ running: 'early' }); R.fail(f, R.mapOf(f), 0, 'Broke', 'a', at(5)); R.end(f, R.mapOf(f), 'Stopped early', 'a', 'A', at(6)); runs.push(f);
  R.addFollowUp(runs[0], { id: 'f1', text: 'x' }, 'a', at(5)); R.addFollowUp(runs[0], { id: 'f2', text: 'y' }, 'a', at(5)); R.addFollowUp(runs[2], { id: 'f3', text: 'z' }, 'a', at(5));
  const d = F.decision({ process: 'x', run: runs[2].id, id: 'f3' }, 'a', 'done', {}, at(60)); d._file = 'd';
  const input = { runs, runStatus: { ['x/' + runs[5].id]: 'unread', ['x/' + runs[6].id]: 'missing' }, followUps: F.list(runs, [d]),
    corrections: [{ target: { step: 'one' }, status: 'open', members: [{ run: runs[0].id, folder: FOLDER }, { run: runs[5].id, folder: FOLDER }, { run: runs[1].id, folder: 'v9-other' }] }] };
  const ctx = { now: NOW_MS, runStatus: input.runStatus, followUps: input.followUps, corrections: input.corrections };
  [false, true].forEach(includeRunning => {
    const res = forX(input, { includeRunning });
    const paths = ['runs:all', 'runs:running', 'runs:o:Completed', 'runs:o:Cancelled', 'runs:o:Stopped early', 'dur', 'phase:prep', 'phase:ship', 'gate:prep:waived', 'gate:prep:failed', 'gate:ship:failed',
      'ex:unread', 'ex:missing', 'ex:newer', 'fu:lt7', 'fu:d7to30', 'fu:gt30', 'fu:decided'];
    res.steps.forEach(s => ['blocked', 'redone', 'na', 'differently', 'offScript', 'skipped', 'corrections'].forEach(k => { paths.push('step:' + s.id + ':' + k); paths.push('step:' + s.id + ':' + k + ':incomplete'); }));
    let nonEmpty = 0;
    paths.forEach(p => {
      const sel = I.select(res, p); if (!sel) return;
      if (sel.keys.length) nonEmpty++;
      same(runs.filter(r => I.matches(r, { process: 'x', folder: FOLDER, path: p, asOf: NOW_MS, includeRunning }, ctx)).map(r => 'x/' + r.id).sort(), sel.keys.slice().sort(), p + (includeRunning ? ' (running included)' : ''));
    });
    assert.ok(nonEmpty >= 15, 'the paths have runs behind them: ' + nonEmpty);
  });
});

rule('Bad times survive the run file\'s cleanup as bad times: a start that can\'t be read and an end that can\'t be read are left out of times, and the run still counts as ended', () => {
  const badStart = R.sanitize(Object.assign(JSON.parse(JSON.stringify(play())), { created: 'garbage' }));
  const badEndRaw = JSON.parse(JSON.stringify(play())); badEndRaw.ended.at = 'garbage';
  const badEnd = R.sanitize(badEndRaw);
  assert.ok(!badEnd.ended && badEnd.state === 'completed' && badEnd._badTimes.ended === 'Completed', 'set-up: cleanup drops the end, as 1.16 does, and says so for this load');
  const res = forX({ runs: [badStart, badEnd, play()] });
  same([res.duration.n, res.duration.of, res.runs.running, res.pool.n], [1, 3, 0, 3], 'neither is a 56-year run, and the one without an end isn\'t "still going"');
  assert.ok(res.duration.excluded.some(e => /couldn't be read/.test(e.text) && e.keys.length === 2), JSON.stringify(res.duration.excluded));
  same(res.runs.outcomes.Completed.length, 3);
});

rule('A run whose end time can\'t be read counts as ended, by what its file says, until a copy saves it', () => {
  const raw = JSON.parse(JSON.stringify(play())); raw.ended.at = '2026-13-45'; raw.state = 'running';
  const r = R.sanitize(raw);
  same([r.ended, r.state, r._badTimes], [null, 'running', { ended: 'Completed' }], '1.16\'s shape, flagged for this load');
  const res = forX({ runs: [r, play()] });
  same([res.runs.running, res.pool.n, res.duration.n, res.duration.of, res.runs.outcomes.Completed.length], [0, 2, 1, 2, 2]);
  assert.ok(res.duration.excluded.some(e => /a time couldn't be read/.test(e.reason)), JSON.stringify(res.duration.excluded));
  // Known limit: once any copy saves it, the end is gone, as in every earlier version.
  const again = R.sanitize(resaved(r));
  same([again.ended, again._badTimes], [null, undefined]);
  assert.strictEqual(R.sanitize(JSON.parse(JSON.stringify(play())))._badTimes, undefined, 'a clean file has no flag');
});

rule('A run that couldn\'t be read and was never read before is still said: which version it belongs to isn\'t known', () => {
  const res = forX({ runs: [play()], runStatus: { 'x/never-read': 'unread', 'y/other-process': 'unread' } });
  const u = res.excluded.filter(e => e.why === 'unknown')[0];
  assert.ok(u && u.keys.length === 1 && /which version/.test(u.text), JSON.stringify(res.excluded));
});

// ---------- Review of cd78f6f: one time layer, one qualifications object ----------
rule('A follow-up whose own time can\'t be read is left out with that reason, never timed from the run\'s end or start', () => {
  const r = play(); R.addFollowUp(r, { id: 'o1', text: 'open one' }, 'a', at(5)); R.addFollowUp(r, { id: 'd1', text: 'decided one' }, 'a', at(5));
  const raw = JSON.parse(JSON.stringify(r)); raw.followUps.forEach(f => { f.at = 'garbage'; });
  const clean = R.sanitize(raw); clean._fileHash = 'h';
  assert.ok(clean.followUps.every(f => f.at === null), 'set-up: cleanup leaves no time');
  const d = F.decision({ process: 'x', run: r.id, id: 'd1' }, 'a', 'done', {}, at(60)); d._file = 'd';
  const res = forX({ runs: [clean], followUps: F.list([clean], [d]) });
  same([res.followUps.open.n, res.followUps.decided.n], [0, 0], 'no fabricated age or 30-minute duration');
  same([res.followUps.open.q.cohort, res.followUps.decided.q.cohort], [1, 1]);
  assert.ok(/1 follow-up, a time couldn't be read/.test(I.notCounted(res.followUps.open.q)), I.notCounted(res.followUps.open.q));
  assert.ok(/1 follow-up, a time couldn't be read/.test(I.notCounted(res.followUps.decided.q)), I.notCounted(res.followUps.decided.q));
  const late = F.decision({ process: 'x', run: r.id, id: 'd1' }, 'a', 'done', {}, new Date(NOW_MS + 86400000).toISOString()); late._file = 'e';
  const r2 = play(); R.addFollowUp(r2, { id: 'd1', text: 'x' }, 'a', at(5)); late.run = r2.id;
  assert.ok(/later than now, by the decider's clock/.test(I.notCounted(forX({ runs: [r2], followUps: F.list([r2], [late]) }).followUps.decided.q)), 'whose clock');
});

rule('Pauses that overlap (the clock went back) leave the run out of its times instead of subtracting twice', () => {
  const r = play({ running: true }), m = R.mapOf(r);
  R.pause(r, 'wait', 'a', at(12)); R.resume(r, 'a', at(13));
  R.pass(r, m, 1, 'a', at(30)); R.end(r, m, 'Completed', 'a', 'A', at(30));
  r.pauses = [{ from: at(1), to: at(10), by: 'a', reason: 'x' }, { from: at(5), to: at(15), by: 'a', reason: 'y' }];
  const res = forX({ runs: [r, play()] });
  same([res.duration.n, res.duration.of], [1, 2], 'not 11 minutes');
  assert.ok(res.duration.q.excluded.some(g => g.why === 'pauses' && /recorder's clock|clock went back/.test(g.reason)), JSON.stringify(res.duration.q.excluded));
  assert.ok(res.phases[0].q.excluded.some(g => g.why === 'pauses'), 'phases too');
  // Pauses in order are left out once each, and one still under way runs to the time asked about.
  const ok = play(); ok.pauses = [{ from: at(2), to: at(4), by: 'a', reason: 'x' }, { from: at(20), to: at(25), by: 'a', reason: 'y' }];
  same(forX({ runs: [ok] }).duration.median, 23 * 60000);
});

const MD2 = ['---', 'process: x', 'title: X', '---',
  '## Prep · READ-DO {#prep}', '- [ ] {confirm} One {#one}', '## Gate: Ready {#g1}',
  '## Ship · READ-DO {#ship}', '- [ ] {confirm} Three {#three}', '## Gate: Ready {#g2}'].join('\n');
rule('Gate failures are by the gate\'s ID: a log line naming a title two gates share never counts as a failure of the other gate', () => {
  const pub = pubOf(MD2, 'bbbb2222');
  const mk = (fail) => {
    const r = R.create(pub, { details: {}, roles: {}, by: 'a', session: 's', now: at(0), id: 'g' + (++n) }), m = R.mapOf(r);
    R.done(r, m, 'one', 'a', at(1));
    if (fail) { R.fail(r, m, 0, 'Broke', 'a', at(2)); R.reopen(r, m, 0, 'a', at(3)); }
    R.pass(r, m, 0, 'a', at(4)); R.done(r, m, 'three', 'a', at(5)); R.pass(r, m, 1, 'a', at(6)); R.end(r, m, 'Completed', 'a', 'A', at(6));
    return r;
  };
  const failedNow = R.create(pub, { details: {}, roles: {}, by: 'a', session: 's', now: at(0), id: 'gf' }), fm = R.mapOf(failedNow);
  R.done(failedNow, fm, 'one', 'a', at(1)); R.fail(failedNow, fm, 0, 'Broke', 'a', at(2)); R.end(failedNow, fm, 'Stopped early', 'a', 'A', at(3));
  const runs = [mk(true), mk(false), failedNow];
  const res = I.forProcess({ runs }, 'x', { now: NOW_MS, folder: pub.info.folder }), g1 = res.phases[0].gate, g2 = res.phases[1].gate;
  same([g1.failed.hits, g2.failed.hits], [1, 0], 'only the gate failed now, by its record');
  same(g1.failed.keys, ['x/gf']);
  assert.ok(g1.failed.q.excluded.some(g => g.why === 'shared' && g.keys[0] === 'x/' + runs[0].id) && g2.failed.q.excluded.some(g => g.why === 'shared'), 'the log line that can\'t say which gate is said');
  same(I.select(res, 'gate:ship:failed').keys, []);
  same(runs.filter(r => I.matches(r, { process: 'x', folder: pub.info.folder, path: 'gate:ship:failed', asOf: NOW_MS })).length, 0);
});

rule('A drill-down whose number has gone to zero still answers, with no runs, so Show current numbers can show that', () => {
  const r = play(), st = { ['x/' + r.id]: 'unread' };
  const before = forX({ runs: [r], runStatus: st }), sp = I.spec(before, 'ex:unread', [r]);
  same(sp.keys, ['x/' + r.id]);
  const after = forX({ runs: [r] });
  assert.strictEqual(I.changed(sp, [r], after), 1, 'recovered: changed since');
  const now = I.spec(after, 'ex:unread', [r]);
  assert.ok(now && now.keys.length === 0, 'the same number, now zero');
  assert.strictEqual(I.changed(now, [r], after), 0, 'and nothing to warn about');
  assert.ok(I.spec(after, 'runs:o:Cancelled', [r]).keys.length === 0, 'an outcome with no runs');
});

rule('Property: for random runs with random bad times, every number\'s counted, not counted and history incomplete add up to its cohort', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = xs => xs[Math.floor(rnd() * xs.length)];
  const badTime = () => pick([null, 'garbage', '1970-01-01T00:00:00.000Z', new Date(NOW_MS + 86400000 * (1 + rnd() * 400)).toISOString(), new Date(T0 + 1e13).toISOString()]);
  for (let round = 0; round < 25; round++) {
    const runs = [], status = {}, decisions = [];
    let expect = { completed: 0, pool: 0, open: 0 };
    const total = 3 + Math.floor(rnd() * 10);
    for (let i = 0; i < total; i++) {
      const kind = pick(['done', 'done', 'running', 'early', 'cancel']);
      const r = play({ running: kind === 'running' ? true : kind === 'early' ? 'early' : undefined, outcome: kind === 'cancel' ? 'Cancelled' : undefined,
        before: (r, m) => { if (rnd() < 0.3) R.block(r, m, 'one', 'x', 'a', at(1)); } });
      if (kind === 'early' && rnd() < 0.5) R.end(r, R.mapOf(r), 'Stopped early', 'a', 'A', at(9));
      if (rnd() < 0.3) delete r.marksFrom;
      if (rnd() < 0.3) R.addFollowUp(r, { id: 'f' + i, text: 'x' }, 'a', at(5));
      if (rnd() < 0.2 && r.followUps.length) r.followUps[0].at = badTime();
      if (r.followUps.length && rnd() < 0.4) { const d = F.decision({ process: 'x', run: r.id, id: 'f' + i }, 'a', 'done', {}, rnd() < 0.3 ? badTime() : at(40)); d._file = 'd' + i; decisions.push(d); }
      if (rnd() < 0.2) r.created = badTime() || r.created;
      if (rnd() < 0.2 && r.ended) r.ended.at = badTime();
      if (rnd() < 0.2 && r.gates.ready) r.gates.ready.at = badTime();
      if (rnd() < 0.2) r.pauses = [{ from: at(3), to: at(8), by: 'a', reason: 'x' }, { from: at(rnd() < 0.5 ? 4 : 9), to: at(12), by: 'a', reason: 'y' }];
      if (rnd() < 0.3) { const f = pick([-5, 2, 8, 12, 20, 28, 35]), len = pick([1, 3, 6, 15]); r.pauses = [{ from: at(f), to: at(f + len), by: 'a', reason: 'z' }]; }
      if (rnd() < 0.25 && r.ended && r.gates.shipped) r.ended.at = at(pick([5, 15, 25, 40]));
      if (rnd() < 0.2 && r.gates.ready && r.gates.shipped) { const t = r.gates.ready.at; r.gates.ready.at = r.gates.shipped.at; r.gates.shipped.at = t; }
      if (rnd() < 0.15) r._badTimes = { created: true };
      const roll = rnd();
      if (roll < 0.08) status['x/' + r.id] = 'unread'; else if (roll < 0.14) status['x/' + r.id] = 'missing'; else if (roll < 0.2) r._unrunnable = 'newer';
      runs.push(r);
      const readable = !status['x/' + r.id] && !r._unrunnable;
      if (readable && r.ended && r.ended.outcome === 'Completed') expect.completed++;
      if (readable && r.ended) expect.pool++;
    }
    const fus = F.list(runs, decisions);
    fus.forEach(x => { const r = runs.find(y => 'x/' + y.id === x.runKey); if (!status[x.runKey] && !r._unrunnable && x.status === 'open') expect.open++; });
    const res = forX({ runs, runStatus: status, followUps: fus });
    const qs = [['runs', res.runs.q, total], ['duration', res.duration.q, expect.completed], ['fu open', res.followUps.open.q, expect.open]];
    res.phases.forEach(p => { qs.push(['phase ' + p.id, p.q, expect.pool], ['waived ' + p.id, p.gate.waived.q, expect.pool], ['failed ' + p.id, p.gate.failed.q, expect.pool]); });
    res.steps.forEach(s => ['skipped', 'blocked', 'redone', 'na', 'differently', 'offScript'].forEach(k => qs.push([s.id + ' ' + k, s[k].q, expect.pool])));
    qs.push(['fu decided', res.followUps.decided.q, null]);
    qs.forEach(([name, q, cohort]) => {
      const sum = q.counted + q.excluded.reduce((a, g) => a + g.n, 0) + q.incomplete;
      assert.strictEqual(sum, q.cohort, name + ': the parts add up');
      if (cohort != null) assert.strictEqual(q.cohort, cohort, name + ': the cohort is every run it should cover (round ' + round + ')');
      q.excluded.forEach(g => assert.strictEqual(g.keys.length, g.n, name));
    });
    assert.ok(res.duration.values.every(v => v.ms >= 0 && v.ms < 86400000), 'no fabricated or stretched time');
    // Every timed run's raw chronology holds: start, then each settled gate and pause, then the end, no gate inside a pause.
    const inside = (r, lo, hi) => (r.pauses || []).every(p => { const f = Date.parse(p.from), e = Date.parse(p.to); return f >= lo && !(e > hi) && Object.values(r.gates).every(g => { const t = Date.parse(g.at); return !(f < t && t < e); }); });
    res.duration.keys.forEach(k => { const r = runs.find(y => 'x/' + y.id === k); assert.ok(inside(r, Date.parse(r.created), Date.parse(r.ended.at)), 'round ' + round + ': pauses inside ' + k); });
    res.phases.forEach(p => p.keys.forEach(k => { const r = runs.find(y => 'x/' + y.id === k); assert.ok(inside(r, Date.parse(r.created), r.ended && Date.parse(r.ended.at) >= Date.UTC(2000, 0, 1) && Date.parse(r.ended.at) <= NOW_MS ? Date.parse(r.ended.at) : Infinity), 'round ' + round + ': pauses inside ' + k + ' (' + p.id + ')'); }));
    // Every timed run's raw chronology holds: start, then each settled gate, then the end.
    res.duration.keys.forEach(k => {
      const r = runs.find(y => 'x/' + y.id === k), t0 = Date.parse(r.created), t1 = Date.parse(r.ended.at);
      Object.values(r.gates).forEach(g => { const t = Date.parse(g.at); assert.ok(t >= t0 && t <= t1, 'round ' + round + ': gate inside ' + k); });
    });
    const GATE = { prep: 'ready', ship: 'shipped' };
    res.phases.forEach(p => p.keys.forEach(k => {
      const r = runs.find(y => 'x/' + y.id === k), g = Date.parse(r.gates[GATE[p.id]].at), e = r.ended ? Date.parse(r.ended.at) : NaN, end = e >= Date.UTC(2000, 0, 1) && e <= NOW_MS ? e : NaN; // an end that can't be used bounds nothing
      assert.ok(g >= Date.parse(r.created) && !(g > end), 'round ' + round + ': phase ' + p.id + ' of ' + k + ' is inside the run');
    }));
  }
});

// ---------- Review of 13caeb6 ----------
const resaved = r => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k[0] !== '_'))));
rule('Times cleanup drops are flagged from the file as read, so Insights leaves them out until a copy saves the run', () => {
  const raw = JSON.parse(JSON.stringify(play()));
  raw.pauses = [{ from: at(5), to: 'garbage', by: 'a', reason: 'x' }];
  const r = R.sanitize(raw);
  same([r.pauses.length, r._badTimes.pauses], [0, true], 'the pause is dropped, as 1.16 does, and flagged');
  const res = forX({ runs: [r, play()] });
  same([res.duration.n, res.duration.of], [1, 2], 'not a 30-minute run with no pause');
  assert.ok(res.duration.q.excluded.some(g => g.why === 'time'), JSON.stringify(res.duration.q.excluded));
  assert.strictEqual(forX({ runs: [R.sanitize(resaved(r)), play()] }).duration.n, 2, 'known limit: after a save the pause is gone and the run is timed');
  // A log entry whose time can't be read still says what it said, for this load: a reopen is still found.
  const lr = play({ running: true }), m = R.mapOf(lr);
  R.reopen(lr, m, 0, 'a', at(12)); R.pass(lr, m, 0, 'a', at(13)); R.pass(lr, m, 1, 'a', at(30)); R.end(lr, m, 'Completed', 'a', 'A', at(30));
  const lraw = JSON.parse(JSON.stringify(lr)); lraw.log.forEach(l => { if (/^(Reopened|Passed)/.test(l.what)) l.at = 'garbage'; });
  const ls = R.sanitize(lraw);
  assert.ok(!ls.log.some(l => /^Reopened/.test(l.what)) && ls._badTimes.log.some(l => /^Reopened/.test(l.what)));
  assert.ok(forX({ runs: [ls] }).phases[0].q.excluded.some(g => g.why === 'reopened'), 'the reopen is still found');
  // A pause under way whose time can't be read leaves a running run's times out.
  const pr = JSON.parse(JSON.stringify(play({ running: true }))); pr.paused = { by: 'a', at: 'garbage', reason: 'wait' };
  const ps = R.sanitize(pr);
  same([ps.paused, ps._badTimes.paused], [null, true]);
  assert.ok(forX({ runs: [ps] }, { includeRunning: true }).phases[0].q.excluded.some(g => g.why === 'time'));
  // Follow-up and gate times were already kept as null by 1.16; a start becomes 1970, before 2000.
  const all = JSON.parse(JSON.stringify(play())); R.addFollowUp(all, { id: 'f', text: 'x' }, 'a', at(3));
  all.followUps = JSON.parse(JSON.stringify(all.followUps)); all.followUps[0].at = 'bad'; all.gates.ready.at = 'bad'; all.created = 'bad';
  const c = R.sanitize(all);
  same([c.followUps[0].at, c.gates.ready.at, c._badTimes.created], [null, null, true]);
  assert.ok(Date.parse(R.sanitize(resaved(c)).created) < Date.UTC(2000, 0, 1), 'a start that can\'t be read stays before 2000 after a save');
});

rule('A run\'s times hold only in order: a gate passed after the run ended (a clock set back) leaves its times out', () => {
  const r = play({ running: true }), m = R.mapOf(r);
  R.pass(r, m, 1, 'a', at(30)); R.end(r, m, 'Completed', 'a', 'A', at(20));
  const res = forX({ runs: [r, play()] });
  same([res.duration.n, res.duration.of], [1, 2], 'not 20 minutes while its phases add up to 30');
  assert.ok(res.duration.q.excluded.some(g => g.why === 'backward' && g.keys[0] === 'x/' + r.id), JSON.stringify(res.duration.q.excluded));
  assert.ok(res.phases[1].q.excluded.some(g => g.why === 'backward' && g.keys[0] === 'x/' + r.id), 'the last phase too');
  same(res.phases[0].n, 2, 'the first phase ended in order');
});

rule('Pauses must lie inside the run and never around a gate: a pause that ends after the run did (a clock set back) leaves its times out', () => {
  const r = R.create(PUB, { details: { commit: 'aaa' }, roles: {}, by: 'a', session: 's', now: at(0), id: 'pz' + (++n) }), m = R.mapOf(r);
  R.done(r, m, 'one', 'a', at(1)); R.done(r, m, 'two', 'a', at(1)); R.pass(r, m, 0, 'a', at(5));
  R.done(r, m, 'three', 'a', at(6)); R.pass(r, m, 1, 'a', at(15)); R.end(r, m, 'Completed', 'a', 'A', at(15));
  r.pauses = [{ from: at(10), to: at(20), by: 'a', reason: 'x' }];
  const res = forX({ runs: [r, play()] });
  same([res.duration.n, res.duration.of], [1, 2], 'not 10 minutes');
  assert.ok(res.duration.q.excluded.some(g => g.why === 'backward' && g.keys[0] === 'x/' + r.id), JSON.stringify(res.duration.q.excluded));
  same([res.phases[0].n, res.phases[1].n], [1, 1], 'nor 5 + 5');
  // A pause inside the run but around a gate: the phases on both sides are left out, the whole time too.
  const s2 = play(); s2.pauses = [{ from: at(8), to: at(12), by: 'a', reason: 'x' }];
  const r2 = forX({ runs: [s2] });
  same([r2.duration.n, r2.phases[0].n, r2.phases[1].n], [0, 0, 0]);
  // A pause before the start, and one under way before the start.
  const s3 = play(); s3.pauses = [{ from: at(-5), to: at(2), by: 'a', reason: 'x' }];
  same(forX({ runs: [s3] }).duration.n, 0);
  const s4 = play({ running: true }); s4.paused = { by: 'a', at: at(-1), reason: 'x' };
  same(forX({ runs: [s4] }, { includeRunning: true }).phases[0].n, 0);
  // Pauses in order and inside their phases still count.
  const ok = play(); ok.pauses = [{ from: at(2), to: at(4), by: 'a', reason: 'x' }, { from: at(20), to: at(25), by: 'a', reason: 'y' }];
  const rok = forX({ runs: [ok] });
  same([rok.duration.median, rok.phases[0].median, rok.phases[1].median], [23 * 60000, 8 * 60000, 15 * 60000]);
});

rule('The table in docs/design.md section 23 matches DEFS', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'design.md'), 'utf8');
  const a = md.indexOf('<!-- insights-defs:begin -->'), b = md.indexOf('<!-- insights-defs:end -->');
  assert.ok(a > 0 && b > a, 'the table has its markers');
  const rows = md.slice(a, b).split('\n').filter(l => /^\| /.test(l)).slice(1).map(l => l.slice(2, -2).split(' | '));
  same(rows, I.DEFS.map(d => [d.name, d.counts, d.denominator]));
});

run();
