// Big folders (2.5.0): the work a refresh, a person picker, Settings › People and Folder health do grows with the folder, not
// with its square. Counted in operations (PF.perf), so the numbers are the same on every computer; the browser gate times them.
// Each faster path is checked against the old one, kept here as the oracle.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

/* ---------- Folder health: old save receipts ---------- */

const HOUR = 3600000, NOW = Date.parse('2026-10-25T12:00:00.000Z'), OLD = NOW - 3 * HOUR, YOUNG = NOW - 10 * 60000;
/* The 2.4.0 loop, word for word: every file, once per run. */
function oldReceipts(runs, list, now, tmpMs) {
  const cands = [];
  runs.forEach(function (r) {
    var dir = 'runs/' + r.process + '/' + r.id + '/', lin = r.lineage || [], newest = lin[lin.length - 1];
    list.forEach(function (f) { if (f.p.indexOf(dir) !== 0 || f.p.slice(dir.length).indexOf('/') >= 0) return; var m = /^candidate-(.+)-([a-z0-9]{8})\.json$/.exec(f.p.slice(dir.length)); if (m && lin.indexOf(m[1] + '.' + m[2]) >= 0 && m[1] + '.' + m[2] !== newest && f.m != null && now - f.m > tmpMs) cands.push(f.p); });
  });
  return cands;
}
function receiptFolder() {
  const runs = [
    { process: 'release', id: 'run-1', title: 'One', lineage: ['dev-a.aaaaaaaa', 'dev-a.bbbbbbbb', 'dev-b.cccccccc'], ended: { at: '2026-10-20T00:00:00.000Z' } },
    { process: 'release', id: 'run-10', title: 'Ten', lineage: ['dev-a.dddddddd', 'dev-a.eeeeeeee'], ended: { at: '2026-10-20T00:00:00.000Z' } },
    { process: 'check-in', id: 'run-2', title: 'Two', lineage: ['dev-c.ffffffff', 'dev-c.gggggggg'], ended: { at: '2026-10-20T00:00:00.000Z' } }
  ];
  const list = [
    { p: 'runs/release/run-1/run.json', m: OLD },
    { p: 'runs/release/run-1/candidate-dev-a-bbbbbbbb.json', m: OLD },        // in the lineage, not the newest, old: reported
    { p: 'runs/release/run-1/candidate-dev-a-aaaaaaaa.json', m: OLD },        // the same, a second one: reported, in list order
    { p: 'runs/release/run-1/candidate-dev-b-cccccccc.json', m: OLD },        // the newest: not reported
    { p: 'runs/release/run-1/candidate-dev-z-zzzzzzzz.json', m: OLD },        // a tag not in the lineage: not reported
    { p: 'runs/release/run-1/candidate-dev-a-aaaaaaaa.json.tmp', m: OLD },    // not a receipt's name
    { p: 'runs/release/run-1/attachments/candidate-dev-a-aaaaaaaa.json', m: OLD }, // one folder deeper: not reported
    { p: 'runs/release/run-10/candidate-dev-a-dddddddd.json', m: OLD },       // run-10's own: reported for run-10 only
    { p: 'runs/release/run-10/candidate-dev-a-dddddddd.json', m: null },      // no time: not reported
    { p: 'runs/check-in/run-2/candidate-dev-c-ffffffff.json', m: YOUNG },     // recent: not reported
    { p: 'runs/check-in/run-2/candidate-dev-c-ffffffff.json', m: OLD },       // old: reported
    { p: 'runs/check-in/run-20/candidate-dev-c-ffffffff.json', m: OLD }       // a run that isn't in the folder: not reported
  ];
  return { runs, list };
}
function healthOf(PF, runs, list) {
  const rep = PF.health.check({ data: { runs, people: [], processes: [] }, scan: { list, unreadable: [] }, me: 'person-casey', app: '2.5.0' }, NOW);
  const i = rep.issues.filter(x => x.id === 'candidates')[0];
  return i ? i.paths : [];
}

rule('Folder health finds old save receipts by run folder: the same receipts, in the same order, as checking every file for every run', () => {
  const PF = load(), f = receiptFolder();
  const want = oldReceipts(f.runs, f.list, NOW, 2 * HOUR);
  assert.strictEqual(want.length, 4, 'the oracle finds the four receipts the folder plants: ' + want.join(', '));
  same(healthOf(PF, f.runs, f.list), want, 'the same receipts in the same order');
  /* Runs in another order report in that order. */
  const rev = f.runs.slice().reverse();
  same(healthOf(PF, rev, f.list), oldReceipts(rev, f.list, NOW, 2 * HOUR), 'run order is kept');
});

rule('Folder health\'s receipt check looks at each file once, not once per run (2,000 runs, 10,000 files)', () => {
  const PF = load(), runs = [], list = [];
  for (let i = 0; i < 2000; i++) {
    const id = 'run-' + i, lin = ['dev-a.' + ('0000000' + i).slice(-8), 'dev-a.zzzzzzzz'];
    runs.push({ process: 'p' + (i % 50), id, title: id, lineage: lin, ended: { at: '2026-10-20T00:00:00.000Z' } });
    const dir = 'runs/p' + (i % 50) + '/' + id + '/';
    list.push({ p: dir + 'run.json', m: OLD }, { p: dir + 'candidate-dev-a-' + ('0000000' + i).slice(-8) + '.json', m: OLD }, { p: dir + 'notes.md', m: OLD }, { p: dir + 'attachments/a.png', m: OLD }, { p: dir + 'candidate-dev-a-zzzzzzzz.json', m: OLD });
  }
  assert.ok(PF.perf, 'PF.perf counts work');
  PF.perf.reset();
  const got = healthOf(PF, runs, list);
  const checks = PF.perf.n['health.receiptPaths'] || 0;
  assert.ok(checks <= list.length + runs.length, 'path checks ' + checks + ' ≤ files + runs (' + (list.length + runs.length) + '); checking every file for every run is ' + runs.length * list.length);
  assert.strictEqual(got.length, Math.min(2000, 50), 'every old receipt is found (an issue lists the first 50): ' + got.length);
});

/* ---------- People: pickers and permissions ---------- */

function folk() {
  return [
    { id: 'p-ann', name: 'Ann Lee', email: 'ann@a.com', folderRole: 'owner' },
    { id: 'p-ann2', name: ' ann lee ', email: 'ann2@a.com' },          // a twin by name (case and spaces don't matter)
    { id: 'p-bo', name: 'Bo Chen', email: 'bo@a.com', folderRole: 'backup' },
    { id: 'p-bo', name: 'Bo Chen', email: 'bo-again@a.com', inactive: true }, // the same ID twice: not twins of each other
    { id: 'p-cy', name: '', email: 'cy@a.com' },                       // a blank name
    { id: 'p-di', name: 'Di Park', inactive: true },
    { id: 'p-ed', name: 'Ed Ruiz', email: '' }                          // no email: the ID stands in
  ];
}

rule('People: a picker names everyone as label() would, with twins (two IDs sharing a name) given their email, for any list a picker uses', () => {
  const PF = load(), P = PF.people;
  assert.strictEqual(typeof P.labeler, 'function', 'PF.people.labeler(list) builds a picker\'s namer once');
  const all = folk();
  [all, all.filter(p => !p.inactive), all.slice(0, 3), [all[3], all[2]], []].forEach((list, n) => {
    const name = P.labeler(list);
    list.forEach(p => assert.strictEqual(name(p), P.label(p, list), 'list ' + n + ', ' + p.id + ': ' + name(p)));
  });
  /* A person named against a list they aren't in (a picker that lists only some people) is still named by that list. */
  const name = P.labeler([all[1]]);
  assert.strictEqual(name(all[0]), P.label(all[0], [all[1]]));
});

rule('People: a 500-person picker compares names about once per person, not once per pair', () => {
  const PF = load(), P = PF.people, list = [];
  for (let i = 0; i < 500; i++) list.push({ id: 'p-' + i, name: 'Person ' + (i % 450), email: 'p' + i + '@a.com' });
  assert.ok(PF.perf, 'PF.perf counts work');
  PF.perf.reset();
  const name = P.labeler(list), out = list.map(name);
  const n = PF.perf.n['people.names'] || 0;
  assert.ok(n <= 2 * list.length, 'name comparisons ' + n + ' ≤ 2 × people; one label() per person is ' + list.length * list.length);
  same(out, list.map(p => P.label(p, list)), 'the same labels');
});

rule('People: permits() answers every change exactly as allowed() does, with the first row for an ID, in one pass over people', () => {
  const PF = load(), P = PF.people;
  assert.strictEqual(typeof P.permits, 'function', 'PF.people.permits(people, me)');
  const folders = [folk(), folk().map(p => p.id === 'p-ann' ? Object.assign({}, p, { inactive: true }) : p), folk().filter(p => p.folderRole !== 'owner'), []];
  const acts = ['add', 'inactive', 'active', 'backup', 'owner', 'nonsense'];
  folders.forEach((people, n) => {
    ['p-ann', 'p-bo', 'p-ed', 'p-nobody'].forEach(me => {
      const can = P.permits(people, me);
      people.map(p => p.id).concat(['p-gone']).forEach(id => acts.forEach(act => {
        assert.strictEqual(can(act, id), P.allowed(people, me, act, id), 'folder ' + n + ', me ' + me + ', ' + act + ' ' + id);
      }));
    });
  });
  const many = []; for (let i = 0; i < 500; i++) many.push({ id: 'p-' + i, name: 'P' + i, folderRole: i === 0 ? 'owner' : undefined });
  PF.perf.reset();
  const can = P.permits(many, 'p-0');
  many.forEach(p => ['inactive', 'backup', 'owner'].forEach(a => can(a, p.id)));
  const scans = PF.perf.n['people.rows'] || 0;
  assert.ok(scans <= 2 * many.length, 'rows looked at ' + scans + ' ≤ 2 × people; allowed() per person and change is ' + 3 * many.length * many.length);
});

/* ---------- Runs by key ---------- */

rule('Runs by key: a hit is the run at its position now, a miss costs one look and no rebuild, and appends keep the index', () => {
  const PF = load(), key = r => r.process + '/' + r.id, scan = (a, k) => a.find(r => key(r) === k) || null;
  assert.strictEqual(typeof (PF.util && PF.util.keyIndex), 'function', 'PF.util.keyIndex(keyOf)');
  const idx = PF.util.keyIndex(key), runs = [];
  for (let i = 0; i < 8000; i++) idx.push(runs, { process: 'p' + (i % 40), id: 'run-' + i });
  PF.perf.reset();
  for (let i = 0; i < 8000; i++) assert.strictEqual(idx.find(runs, 'p' + (i % 40) + '/run-' + i), runs[i]);
  assert.strictEqual(PF.perf.n['runs.rebuilds'] || 0, 0, 'appends through push never rebuild');
  assert.ok((PF.perf.n['runs.inspected'] || 0) <= 8000, 'one look per hit: ' + PF.perf.n['runs.inspected']);
  PF.perf.reset();
  for (let i = 0; i < 1000; i++) assert.strictEqual(idx.find(runs, 'nowhere/run-' + i), null);
  assert.strictEqual(PF.perf.n['runs.rebuilds'] || 0, 0, 'misses never rebuild');
  assert.ok((PF.perf.n['runs.inspected'] || 0) <= 1000, 'one look per miss: ' + PF.perf.n['runs.inspected'] + ' (a scan is 8,000,000)');
  /* Replaced in place with the same key: the new object. */
  const fresh = { process: 'p3', id: 'run-3', rev: 2 }; runs[3] = fresh;
  assert.strictEqual(idx.find(runs, 'p3/run-3'), fresh, 'the run now at that position');
  /* A new array (a complete read) or a change of length behind its back: rebuilt once, then right. */
  const next = runs.slice().reverse();
  PF.perf.reset();
  next.forEach(r => assert.strictEqual(idx.find(next, key(r)), r));
  assert.strictEqual(PF.perf.n['runs.rebuilds'], 1, 'one rebuild for a new array');
  next.push({ process: 'late', id: 'run-x' });
  assert.strictEqual(idx.find(next, 'late/run-x'), next[next.length - 1], 'a push it didn\'t see is found after a rebuild');
  /* A position whose run changed key (nothing does that today; replacements keep the key): looking up the run that was there
     finds the mismatch, rebuilds, and answers right from then on. Never a wrong run. */
  const was = key(next[0]);
  next[0] = { process: 'moved', id: 'run-y' };
  assert.strictEqual(idx.find(next, was), null, 'the run that was there is gone');
  assert.strictEqual(idx.find(next, 'moved/run-y'), next[0], 'and the one there now is found');
  /* Duplicates: the first, as a scan finds. */
  const dup = [{ process: 'a', id: '1', n: 1 }, { process: 'a', id: '1', n: 2 }], di = PF.util.keyIndex(key);
  assert.strictEqual(di.find(dup, 'a/1'), scan(dup, 'a/1'));
});

/* ---------- Folder health's limits, from the browser gate's measurements ---------- */

rule('The run-count limits come from measurements: stop first, warning strictly below it and qualified, never beyond what was measured', () => {
  const pick = require('../tools/scale-limits.js').pick;
  /* m[size] = { open: open work in ms, freeze: longest refresh task in ms }, the worst workload at 4× */
  const ok = { open: 10000, freeze: 100 }, slow = { open: 40000, freeze: 400 }, stuck = { open: 60000, freeze: 900 };
  same(pick({ 2000: ok, 4000: ok, 6000: ok, 8000: ok, 10000: ok }), { warn: 8000, stop: 10000 }, 'all pass');
  /* A limit between two of the sizes measured (every 2,000) asks for the size halfway between, once; nothing is interpolated. */
  same(pick({ 2000: ok, 4000: ok, 6000: slow, 8000: slow, 10000: stuck }), { need: [5000, 9000] }, 'a crossing asks for the halfway sizes');
  same(pick({ 2000: ok, 4000: ok, 5000: slow, 6000: slow, 8000: slow, 9000: slow, 10000: stuck }), { warn: 4000, stop: 9000 }, 'then the largest size that passes');
  same(pick({ 2000: slow, 4000: slow, 6000: slow, 7000: stuck, 8000: stuck, 10000: stuck, 1000: ok }), { warn: 1000, stop: 6000 }, 'no warning size until 1,000');
  same(pick({ 2000: slow, 3000: stuck, 4000: stuck, 1000: ok }), { warn: 1000, stop: 2000 }, 'stop at the smallest sample, warning at 1,000');
  same(pick({ 2000: slow, 3000: stuck, 4000: stuck, 1000: slow }), { need: [500] }, 'asks for the next smaller size before deciding');
  same(pick({ 2000: slow, 3000: stuck, 4000: stuck, 1000: slow, 500: slow }), { keep: true, warn: 500, stop: 2000 }, 'nothing qualifies: the limits stay');
  same(pick({ 2000: stuck, 4000: stuck }), { keep: true, warn: 500, stop: 2000 }, 'stop fails at 2,000: the limits stay');
  same(pick({ 2000: slow, 3000: stuck, 4000: stuck }), { need: [1000] }, 'asks for 1,000 when nothing below stop qualifies');
  same(pick({ 2000: ok, 4000: ok, 5000: ok, 6000: stuck }), { warn: 4000, stop: 5000 }, 'a halfway size measured is used as it is');
  /* Never beyond what was measured, and warning is always below stop. */
  for (let i = 0; i < 200; i++) {
    let x = (i + 1) * 2654435761 >>> 0; const rnd = n => { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; return (x >>> 16) % n; };
    const m = {}; [500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000].forEach(sz => { if (sz >= 2000 && sz % 2000 === 0 || rnd(2)) m[sz] = [ok, slow, stuck][rnd(3)]; });
    const r = pick(m);
    if (r.need) { r.need.forEach(sz => assert.ok(!(sz in m), 'asks only for sizes not measured: ' + sz)); continue; }
    assert.ok(r.warn < r.stop, 'warning below stop: ' + JSON.stringify(r));
    assert.ok(r.stop <= 10000 && (r.keep || r.stop in m), 'stop is a measured size: ' + JSON.stringify(r));
  }
});

rule('Guards: runs are added only through the run index, and every per-draw memo is cleared by renderNow', () => {
  const fs = require('fs'), path = require('path'), src = path.join(__dirname, '..', 'src');
  const files = ['ui', 'ui/views', 'storage', 'core'].flatMap(d => fs.readdirSync(path.join(src, d)).filter(f => f.endsWith('.js')).map(f => path.join(src, d, f)));
  files.forEach(f => {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!/\bdata\.runs\.(push|unshift|splice)\(/.test(text), path.relative(src, f) + ': data.runs changes only through runIdx.push');
  });
  const app = fs.readFileSync(path.join(src, 'ui', 'app.js'), 'utf8');
  const memos = new Set();
  for (const m of app.matchAll(/^  var ([^;]+);/gm)) m[1].split(/,\s*(?![^()\[\]{}]*[)\]}])/).forEach(d => { const n = d.trim().split(/\s*=/)[0]; if (/(Memo|Cache)$/.test(n)) memos.add(n); });
  /* Kept across draws on purpose, each keyed by what it reads, so none is a per-draw memo: the runs a read found older than
     what's shown (retried by the next read), Folder health (keyed by its inputs), a draft's SHA-256 (by its text) and report
     contents (reread after each read of the folder). Any other memo has to be cleared by renderNow. */
  ['staleCache', 'healthMemo', 'shaMemo', 'repCache'].forEach(n => memos.delete(n));
  assert.ok(memos.size >= 6, 'set-up: the memos are found: ' + [...memos].join(', '));
  const body = /function renderNow\(\) \{([\s\S]*?)\n  \}/.exec(app)[1];
  memos.forEach(n => assert.ok(new RegExp('\\b' + n + ' = ').test(body), n + ' is cleared by renderNow'));
  assert.ok(/\bpplBy = /.test(body), 'the people map is built afresh for each draw');
});

run();
