// Receipts and pending requests (4.0 slice 6) through every reader: the app's loader, the command (run, next, runs, export)
// and the checker read an ended living run's receipt and a run whose requests haven't landed yet, and agree; and the exact
// shipped 3.0.0 (tools/old-bundles.js: its page, its command and its checker, byte for byte) shows the ended living run by
// name only, can't save it, names its receipt as newer and writes nothing, while a run without to-dos prints what 3.0.0's
// does. The one 3.0 loop behavior 4.0 changes on purpose is named in the 4.0.0 release notes.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');

const TAG = 'v3.0.0', AT = '2026-11-09T09:00:00.000Z', ROOT = path.join(__dirname, '..');
const MD = ['---', 'process: release-notes', 'title: Release notes', 'context: fix_version, kind:choice(minor|major)', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} Read them {#read}', ''].join('\n');
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* next */ } } return null; }
const PY = python();

let written = null;
/* run-l: a living run ended with its receipt. run-q: a run with one tool's request waiting, nothing landed (no living).
   run-p: a run without to-dos. */
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 43 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo, T = NEW.todos, R = NEW.run;
  const res = await repo.publish(m, MD, { people: G.PEOPLE, customTypes: {}, workflows: {}, by: 'person-avery', changes: 'First', existing: [], now: AT, app: '4.0.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  const pv = (await repo.loadAll(m)).processes.find(p => p.process === 'release-notes').index.latest;
  const mk = (id, v) => R.create(pv, { id, title: 'Notes ' + v, by: 'person-avery', session: 'w-avery', now: AT, app: '4.0.0', details: { fix_version: v, kind: 'minor' } });
  const l = mk('run-l', '4.1'), q = mk('run-q', '4.2'), p = mk('run-p', '4.3');
  const map = R.mapOf(l), id = T.idFor('flightdeck', 'seed'), body = { op: 'add', text: 'Check the links', target: { phase: 'draft' }, placement: T.placementFor(map, { phase: 'draft' }) };
  const b = Object.assign({ todo: T.todoIdFor(id) }, body), eff = T.effectOf(b), C = T.consequenceOf(l, map, b, T.view(l, { records: [], people: { people: G.PEOPLE } })).fingerprint;
  const c = T.buildProposal({ kind: 'compound', run: { process: 'release-notes', id: 'run-l' }, id, by: 'person-avery', seen: [], at: AT, body, decision: { by: 'person-avery', consequence: C }, application: { previous: '', effect: eff, fingerprint: T.fingerprint(eff) }, app: '4.0.0' });
  const w = T.buildProposal({ run: { process: 'release-notes', id: 'run-q' }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-q1', seen: [], at: AT, body: Object.assign({}, body, { text: 'Ask legal' }), app: '4.0.0' });
  await repo.saveScope(m, c.id + '.json', c); await repo.saveScope(m, w.id + '.json', w);
  l.living = { head: id }; l.features = NEW.envelope.FROZEN.filter(f => l.features.concat(['living-runs']).indexOf(f) >= 0);
  const d = await repo.loadAll(m);
  const P = NEW.receipts.prepare(l, { outcome: 'Cancelled', by: 'person-avery', at: AT, app: '4.0.0', records: d.todos, unread: d.todosUnread, people: { people: G.PEOPLE }, now: Date.parse(AT), loops: { records: [], unread: [] }, runs: [] });
  assert.ok(!P.why && !P.none, P.why);
  await repo.saveScope(m, P.name, P.file);
  R.end(l, R.mapOf(l), 'Cancelled', 'person-avery', 'Avery', AT, { receipt: P.id });
  await repo.saveRun(m, l, 'w-avery'); await repo.saveRun(m, q, 'w-avery'); await repo.saveRun(m, p, 'w-avery');
  written = { files: H.filesOf(m), receipt: P.name, records: [c.id + '.json', w.id + '.json', P.name] };
  return written;
}
function cli(bin, ...a) { const r = cp.spawnSync(process.execPath, [bin, ...a], { encoding: 'utf8' }); let j = null; try { j = JSON.parse(r.stdout || r.stderr); } catch (e) { j = { raw: r.stdout + r.stderr }; } return { code: r.status, json: j, out: r.stdout + r.stderr }; }
const bare = (j) => { const o = JSON.parse(JSON.stringify(j)); delete o.app; delete o.readAt; return o; };
const MINE = path.join(ROOT, 'bin', 'flightdeck.js');
function tree(files) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-compat-rcpt-')), dir = path.join(root, 'folder'); H.writeTree(dir, files); return { root, dir }; }

rule('This version: the loader, run, next and the checker read the receipt and the pending request, and agree', async () => {
  const { files, receipt } = await folder(), l = JSON.parse(files['runs/release-notes/run-l/run.json']), q = JSON.parse(files['runs/release-notes/run-q/run.json']);
  same([l.living.receipt + '.json', !!l.ended, q.living], [receipt, true, undefined]);
  const NEW = H.loadMain(), d = await NEW.repo.loadAll(H.memFolder(NEW, files));
  assert.ok(d.todos.some(x => x.kind === 'receipt' && x._file === receipt), 'the loader reads the receipt');
  same(NEW.receipts.stateOf(d.runs.find(r => r.id === 'run-l'), d.todos, d.todosUnread).state, 'confirmed');
  const { root, dir } = tree(files);
  try {
    const before = JSON.stringify(H.readTree(dir));
    const rl = cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json');
    same([rl.code, rl.json.data.run.receipt], [0, { id: receipt.replace(/\.json$/, ''), state: 'confirmed', why: null }], rl.out.slice(0, 600));
    const rq = cli(MINE, 'run', dir, 'release-notes/run-q', '--contract', '2', '--json');
    assert.strictEqual(rq.code, 0, rq.out.slice(0, 600));
    same([rq.json.data.run.todoRequests.length, rq.json.data.run.todoRequests[0].status, rq.json.data.run.todoCounts.waiting], [1, 'waiting', 1], 'the pending request is visible before the run gains living');
    const nq = cli(MINE, 'next', dir, 'release-notes/run-q', '--as', 'person-avery', '--contract', '2', '--json');
    assert.ok(nq.json.data.todos, 'next shows its to-dos too');
    const rs = cli(MINE, 'runs', dir, '--contract', '2', '--json');
    assert.ok(rs.json.data.runs.find(r => r.id === 'run-q').todoCounts, 'runs counts them');
    assert.strictEqual(rs.json.data.runs.find(r => r.id === 'run-p').todoCounts, undefined, 'a run without to-dos prints none');
    if (PY) {
      const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8' }));
      assert.deepStrictEqual(res.refused.filter(x => /^proposals\//.test(x.file)), [], 'the checker refuses none of them');
    }
    assert.strictEqual(JSON.stringify(H.readTree(dir)), before, 'reading wrote nothing');
    /* The receipt gone: run names it by its path and exits 4; the run itself is unchanged. */
    fs.unlinkSync(path.join(dir, 'proposals', receipt));
    const gone = cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json');
    assert.strictEqual(gone.code, 4, gone.out.slice(0, 600));
    assert.ok(gone.json.problems.some(x => x.path === 'proposals/' + receipt && x.kind === 'nofile'), JSON.stringify(gone.json.problems));
    same(gone.json.data.run.receipt.state, 'missing');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('This version: run, next, runs and todo list name the same receipt problem (path, kind and why), missing or mismatched', async () => {
  const { files, receipt } = await folder();
  const edit = (dir, rel, fn) => { const f = path.join(dir, rel), o = JSON.parse(fs.readFileSync(f, 'utf8')); fn(o); fs.writeFileSync(f, JSON.stringify(o, null, 2)); };
  const cases = [['missing', (dir) => fs.unlinkSync(path.join(dir, 'proposals', receipt)), 'nofile'],
    ['mismatch', (dir) => edit(dir, 'runs/release-notes/run-l/run.json', (r) => { r.ended.outcome = 'Stopped early'; r.state = 'stopped'; }), 'malformed'],
    ['head', (dir) => edit(dir, 'proposals/' + receipt, (o) => { o.head = 'req-flightdeck-' + 'e'.repeat(24); }), 'malformed'],
    ['another run', (dir) => edit(dir, 'proposals/' + receipt, (o) => { o.run.id = 'run-q'; }), 'malformed'],
    ['another person', (dir) => edit(dir, 'runs/release-notes/run-l/run.json', (r) => { r.ended.by = r.ended.by === 'person-blake' ? 'person-avery' : 'person-blake'; }), 'malformed']];
  /* ID: a named receipt every reader refuses is unread and malformed, with the same first reason, whatever it holds. */
  const put = (text) => (dir) => fs.writeFileSync(path.join(dir, 'proposals', receipt), text);
  [['empty', ''], ['null', 'null'], ['a list', '[]'], ['a number', '5'], ['broken JSON', '{ broken'], ['too deep', '{"a":'.repeat(65) + '1' + '}'.repeat(65)]]
    .forEach(([what, text]) => cases.push([what, put(text), 'malformed']));
  /* KD: a synced copy of the receipt under its id that is another family of record (a plan): which is meant isn't known. */
  cases.push(['a copy of another family', (dir) => fs.writeFileSync(path.join(dir, 'proposals', receipt.replace(/\.json$/, ' (1).json')), JSON.stringify({ format: 'flightdeck-plan/1', kind: 'plan', id: receipt.replace(/\.json$/, ''), process: 'release-notes', title: 'A plan' })), 'malformed']);
  if (process.getuid && process.getuid() !== 0) cases.push(['unreadable', (dir) => fs.chmodSync(path.join(dir, 'proposals', receipt), 0), 'unreadable']);
  for (const [state, damage, kind] of cases) {
    const { root, dir } = tree(files);
    try {
      damage(dir);
      const before = state === 'unreadable' ? '' : JSON.stringify(H.readTree(dir));
      const outs = {
        run: cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json'),
        next: cli(MINE, 'next', dir, 'release-notes/run-l', '--as', 'person-avery', '--contract', '2', '--json'),
        runs: cli(MINE, 'runs', dir, '--contract', '2', '--json'),
        'todo list': cli(MINE, 'todo', 'list', dir, 'release-notes/run-l', '--json')
      };
      const seen = Object.keys(outs).map((k) => { const o = outs[k], p = (o.json.problems || []).filter((x) => x.path === 'proposals/' + receipt); return [k, o.code, p.map((x) => [x.kind, x.why])]; });
      const want = seen[0][2];
      assert.strictEqual(want.length, 1, state + ': run names it once: ' + JSON.stringify(outs.run.json.problems));
      assert.strictEqual(want[0][0], kind, state);
      same(seen, Object.keys(outs).map((k) => [k, 4, want]), state + ': ' + JSON.stringify(seen));
      /* The checker gives the same verdict: the run, its state, the path, the kind and (but for an OS error) the why. */
      if (PY) {
        const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8' }));
        const mine = (res.runReceipts || []).filter((x) => x.run === 'release-notes/run-l');
        assert.strictEqual(mine.length, 1, state + ': ' + JSON.stringify(res.runReceipts));
        same([mine[0].path, mine[0].kind], ['proposals/' + receipt, kind], state + ' checker: ' + JSON.stringify(mine[0]));
        if (state !== 'unreadable') assert.strictEqual(mine[0].why, want[0][1], state + ' checker why');
      }
      if (state !== 'unreadable') assert.strictEqual(JSON.stringify(H.readTree(dir)), before, 'reading wrote nothing');
    } finally { try { fs.chmodSync(path.join(dir, 'proposals', receipt), 0o644); } catch (e) { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); }
  }
  /* Confirmed: the checker says so too, and names no problem. */
  if (PY) {
    const { root, dir } = tree(files);
    try {
      const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8' }));
      same((res.runReceipts || []).map((x) => [x.run, x.state, x.path]), [['release-notes/run-l', 'confirmed', 'proposals/' + receipt]]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

rule('This version: export packs the ended run with its chain and receipt, complete, and Python checks it', async () => {
  const { files, receipt } = await folder(), { root, dir } = tree(files), out = path.join(root, 'out');
  try {
    const before = JSON.stringify(H.readTree(dir));
    const r = cli(MINE, 'export', dir, '--run', 'release-notes/run-l', '--out', out, '--tz', 'UTC');
    assert.strictEqual(r.code, 0, r.out.slice(0, 600));
    const zip = fs.readdirSync(out).filter(n => /\.zip$/.test(n))[0];
    assert.ok(zip, 'a pack');
    if (PY) {
      const o = cp.execFileSync(PY, ['-I', path.join(__dirname, 'check_pack.py'), path.join(out, zip)], { encoding: 'utf8' });
      assert.ok(/living 1/.test(o), o);
    }
    const listing = cp.execFileSync(PY || 'python3', ['-I', '-c', 'import sys, zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', path.join(out, zip)], { encoding: 'utf8' });
    assert.ok(listing.indexOf('originals/proposals/' + receipt) >= 0, 'the receipt is in the pack');
    assert.strictEqual(JSON.stringify(H.readTree(dir)), before, 'export wrote nothing to the folder');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule(TAG + ' (exact, as shipped): shows the ended living run by name only, can\'t save it, never offers its receipt, writes nothing', async () => {
  const OLD = H.loadCopy(TAG); assert.ok(OLD, TAG + ' is recorded (node tools/old-bundles.js)');
  const { files, records } = await folder(), m = H.memFolder(OLD, files);
  const d = await OLD.repo.loadAll(m, { deep: true }), runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  assert.ok(runs['run-l'] && runs['run-l']._unrunnable, 'run-l: name only: ' + (runs['run-l'] && runs['run-l']._unrunnable));
  const ids = records.map(f => f.replace(/\.json$/, ''));
  assert.ok(!(d.plans || []).some(x => ids.indexOf(x.id) >= 0) && !(d.scopes || []).some(x => ids.indexOf(x.id) >= 0), 'never a plan or a scope record');
  const before = snap(m);
  await assert.rejects(() => OLD.repo.saveRun(m, runs['run-l'], 'w-avery'));
  assert.strictEqual(snap(m), before, 'nothing written');
  assert.ok(runs['run-p'] && !runs['run-p']._unrunnable, 'the run without to-dos is recordable');
});

rule(TAG + '\'s command and checker name the receipt as newer and write nothing; run and next print the same for the run without to-dos', async () => {
  const b = H.bundles.get(TAG); assert.ok(b, TAG + ' is recorded');
  const { files, receipt } = await folder(), { root, dir } = tree(files);
  try {
    fs.mkdirSync(path.join(root, 'bin')); fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'bin', 'flightdeck.js'), b.files['flightdeck.js']); fs.writeFileSync(path.join(root, 'dist', 'flightdeck.html'), b.files['flightdeck.html']);
    const OLD = path.join(root, 'bin', 'flightdeck.js'), before = JSON.stringify(H.readTree(dir));
    const all = cli(OLD, 'runs', dir, '--contract', '2', '--json');
    assert.ok((all.json.problems || []).some(x => x.path === 'proposals/' + receipt && x.kind === 'newer'), 'the receipt is newer there: ' + JSON.stringify(all.json.problems));
    const l = cli(OLD, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json');
    assert.ok(l.code !== 0 && (l.json.problems || []).some(x => x.path.indexOf('runs/release-notes/run-l') === 0 && x.kind === 'newer'), 'the run is newer: ' + JSON.stringify(l.json).slice(0, 400));
    if (PY) {
      const ck = path.join(root, 'check_folder.py'); fs.writeFileSync(ck, b.files['check_folder.py']);
      const res = JSON.parse(cp.execFileSync(PY, ['-I', ck, dir], { encoding: 'utf8' }));
      assert.ok(res.refused.some(x => x.file === 'proposals/' + receipt && /newer/.test(x.why)), JSON.stringify(res.refused));
    }
    assert.strictEqual(JSON.stringify(H.readTree(dir)), before, TAG + ' wrote nothing');
    for (const a of [['run', dir, 'release-notes/run-p'], ['next', dir, 'release-notes/run-p', '--as', 'person-avery']]) {
      const theirs = cli(OLD, ...a, '--contract', '2', '--json'), mine = cli(MINE, ...a, '--contract', '2', '--json');
      same([mine.code, bare(mine.json)], [theirs.code, bare(theirs.json)], a[0] + ' run-p prints what ' + TAG + ' prints');
    }
    assert.strictEqual(JSON.stringify(H.readTree(dir)), before, 'this version\'s reads wrote nothing');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('4.0.0\'s release notes name receipts, plan versus now, and the one 3.0 loop behavior 4.0 changes: an approval stays put while a story\'s run can\'t be read', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8'));
  const v4 = (rel.releases || rel).find(r => r.version === '4.0.0'), items = v4 ? v4.items || v4.changes || [] : [];
  assert.ok(v4, '4.0.0 is in the release notes');
  const text = JSON.stringify(items);
  assert.ok(/receipt/i.test(text), 'receipts named');
  assert.ok(/Plan versus now/i.test(text), 'plan versus now named');
  const loop = items.find(x => /approval stays put/i.test(x.title || ''));
  assert.ok(loop && /3\.0/.test(loop.before || '') && loop.area === 'Loops', 'the loop-approval change named, with what 3.0 did');
});

/* ZE: a synced copy of the receipt that differs only in its keys' order is the same receipt, as the app compares them
   (PF.todos.fingerprint: object keys sorted, arrays in order): confirmed by run and by the checker; a copy with another value
   gets the same verdict from both. */
rule('This version: a receipt copy whose counts are written in another key order is the same receipt for run and the checker alike', async () => {
  const { files, receipt } = await folder();
  const rev = (o) => Object.fromEntries(Object.entries(o).reverse());
  const variants = [['counts keys reversed', (c) => { c.counts = rev(c.counts); }, 'confirmed'],
    ['every key reversed', (c) => { const r = rev(c); Object.keys(c).forEach((k) => delete c[k]); Object.assign(c, r); c.counts = rev(c.counts); c.run = rev(c.run); }, 'confirmed'],
    ['each list item\'s keys reversed', (c) => { ['coverage', 'evidence'].forEach((k) => { if (Array.isArray(c[k])) c[k] = c[k].map((x) => (x && typeof x === 'object' ? rev(x) : x)); }); }, 'confirmed'],
    ['a list in another order', (c) => { if (Array.isArray(c.seen) && c.seen.length > 1) c.seen = c.seen.slice().reverse(); else c.seen = (c.seen || []).concat(['req-a-' + '0'.repeat(24)]); }, ''],
    ['a count changed', (c) => { const k = Object.keys(c.counts)[0]; c.counts[k] = (c.counts[k] || 0) + 1; }, '']];
  for (const [what, fn, state] of variants) {
    const { root, dir } = tree(files);
    try {
      const o = JSON.parse(fs.readFileSync(path.join(dir, 'proposals', receipt), 'utf8'));
      assert.ok(o.counts && Object.keys(o.counts).length >= 2, 'set-up: counts with two keys ' + JSON.stringify(o.counts));
      fn(o);
      fs.writeFileSync(path.join(dir, 'proposals', receipt.replace(/\.json$/, ' (1).json')), JSON.stringify(o, null, 2) + '\n');
      const rl = cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json');
      const js = rl.json.data.run.receipt.state;
      if (state) assert.strictEqual(js, state, what + ': ' + rl.out.slice(0, 400));
      if (PY) {
        const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8' }));
        const mine = (res.runReceipts || []).filter((x) => x.run === 'release-notes/run-l');
        assert.strictEqual(mine.length && mine[0].state, js, what + ' checker, as run says: ' + JSON.stringify(res.runReceipts));
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
run();
