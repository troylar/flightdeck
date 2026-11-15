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
  /* CA: everything under the receipt's id, whatever run it names or kind it is: a copy that can't be read because it names
     another run, and a valid to-do request carrying the receipt's id. */
  cases.push(['a copy naming another run', (dir) => { const o = JSON.parse(fs.readFileSync(path.join(dir, 'proposals', receipt), 'utf8')); o.run.id = 'someone-else'; fs.writeFileSync(path.join(dir, 'proposals', receipt.replace(/\.json$/, ' (1).json')), JSON.stringify(o, null, 2) + '\n'); }, 'malformed']);
  cases.push(['a copy of another kind', (dir) => {
    const NEW = H.loadMain(), T = NEW.todos, l = JSON.parse(fs.readFileSync(path.join(dir, 'runs/release-notes/run-l/run.json'), 'utf8'));
    const q = T.buildProposal({ run: { process: 'release-notes', id: 'run-q' }, id: receipt.replace(/\.json$/, ''), by: 'person-avery', seen: [], at: AT, body: { op: 'add', text: 'Another kind', target: { phase: 'review' }, placement: T.placementFor(NEW.run.mapOf(NEW.run.sanitize(l)), { phase: 'review' }) }, app: '4.0.0' });
    fs.writeFileSync(path.join(dir, 'proposals', receipt.replace(/\.json$/, ' (1).json')), T.text(q));
  }, 'malformed']);
  /* DA: a copy under the receipt's file-name id is part of its verdict whatever family it parses or fails as. */
  [['a plan-family copy', '{"format":"flightdeck-plan/2"}\n'], ['a scope-family copy', '{"format":"flightdeck-plan/3","features":["loops"]}\n'],
    ['an unknown-format copy', '{"format":"flightdeck-elsewhere/1","id":"x"}\n'], ['a copy that isn\'t JSON', '{ bad']]
    .forEach(([what, text]) => cases.push([what, (dir) => fs.writeFileSync(path.join(dir, 'proposals', receipt.replace(/\.json$/, ' (1).json')), text), 'malformed']));
  /* EA: a copy under the receipt's file-name id that reads whole as another record (a plan, a plan decision, another to-do
     record) is grouped with the receipt too: which is meant isn't known. */
  const DEC = { proposal: 'plan-other', proposalHash: 'x', status: 'declined', run: null, by: 'person-avery', at: AT };
  [['a valid 1.x plan of another id', { kind: 'plan', id: 'plan-other', process: 'release-notes' }], ['a valid 1.x plan decision', Object.assign({ kind: 'status' }, DEC)],
    ['a valid plan-status/2 decision', Object.assign({ format: 'flightdeck-plan-status/2', app: '4.0.0' }, DEC)]]
    .forEach(([what, o]) => cases.push([what, (dir) => fs.writeFileSync(path.join(dir, 'proposals', receipt.replace(/\.json$/, ' (1).json')), JSON.stringify(o, null, 2) + '\n'), 'malformed']));
  cases.push(['a valid to-do record of another id', (dir) => { const q = fs.readdirSync(path.join(dir, 'proposals')).filter((n) => /^req-notes-bot-/.test(n))[0]; fs.copyFileSync(path.join(dir, 'proposals', q), path.join(dir, 'proposals', receipt.replace(/\.json$/, ' (1).json'))); }, 'malformed']);
  /* FB: a copy under the receipt's id named .JSON or .Json is selected as the loader selects it, by every reader and the checker. */
  [['an empty object', '{}'], ['a copy that isn\'t JSON', '{ bad'], ['a plan-family copy', '{"format":"flightdeck-plan/2"}\n']].forEach(([what, text]) => ['.JSON', '.Json']
    .forEach((ext) => cases.push([what + ' named ' + ext, (dir) => fs.writeFileSync(path.join(dir, 'proposals', receipt.replace(/\.json$/, ' (1)' + ext)), text), 'malformed'])));
  /* ME: a valid legacy plan under the receipt's id named .JSON, which runs must name as run, next and todo list do. */
  cases.push(['a valid 1.x plan named .JSON', (dir) => fs.writeFileSync(path.join(dir, 'proposals', receipt.replace(/\.json$/, ' (1).JSON')), JSON.stringify({ kind: 'plan', id: 'plan-other', process: 'release-notes' }, null, 2) + '\n'), 'malformed']);
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
      /* ME: and the copies under the receipt's id are named alike by all four, whichever one indexed them. */
      const copyOf = (o) => (o.json.problems || []).filter((x) => x.path.indexOf('proposals/' + receipt.replace(/\.json$/, ' (')) === 0).map((x) => [x.path, x.kind]).sort();
      same(Object.keys(outs).map((k) => [k, copyOf(outs[k])]), Object.keys(outs).map((k) => [k, copyOf(outs.run)]), state + ': the copies: ' + JSON.stringify(Object.keys(outs).map((k) => [k, copyOf(outs[k])])));
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
/* AF: the checker reads a receipt and run.json with the app's replacement decoder: a byte that isn't UTF-8 (FF) in a
   receipt's evidence result, or in run.json's title, reads as the app reads it, and the receipt is confirmed by both. */
rule('This version: a receipt or run.json with a byte that isn\'t UTF-8 is read by the checker as the app reads it: the same verdict from both, never unread', async () => {
  const { files, receipt } = await folder(), NEW = H.loadMain(), rp = 'runs/release-notes/run-l/run.json';
  const FFB = (t, mark) => { const b = Buffer.from(t), at = b.indexOf(Buffer.from(mark)); assert.ok(at >= 0, 'set-up: ' + mark); return Buffer.concat([b.slice(0, at), Buffer.from([0xff]), b.slice(at + Buffer.byteLength(mark))]); };
  const cases = [];
  { const o = JSON.parse(files['proposals/' + receipt]);
    o.evidence = [{ todo: 'td-' + '1'.repeat(24), plan: 'plan-ev-' + '2'.repeat(24), run: { process: 'smoke-test', id: 'k1' }, answer: 'Yes', result: 'pass �' }];
    o.id = NEW.receipts.idFor(o.run, o, o.by);
    const r = JSON.parse(files[rp]); r.living.receipt = o.id;
    const f = Object.assign({}, files); delete f['proposals/' + receipt];
    f['proposals/' + o.id + '.json'] = FFB(JSON.stringify(o, null, 2) + '\n', '�'); f[rp] = JSON.stringify(r, null, 2) + '\n';
    /* The evidence it names isn't the run's (review round 1: a receipt's claims are held to its work), so both read it whole
       and both refuse it for that, in the same words: decoded alike, never unread. */
    cases.push(['FF in the receipt\'s evidence result', f, 'mismatch']); }
  { const r = JSON.parse(files[rp]); r.title = r.title + ' �';
    cases.push(['FF in run.json\'s title', Object.assign({}, files, { [rp]: FFB(JSON.stringify(r, null, 2) + '\n', '�') }), 'confirmed']); }
  for (const [what, f, want] of cases) {
    const { root, dir } = tree(f);
    try {
      const rl = cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json'), got = rl.json.data && rl.json.data.run.receipt;
      assert.strictEqual(got && got.state, want, what + ': ' + rl.out.slice(0, 400));
      if (want === 'mismatch') assert.ok(/the evidence it names for td-1{24} isn't the evidence that to-do was checked off on/.test(got.why), got.why);
      if (PY) {
        const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8' }));
        const mine = (res.runReceipts || []).filter((x) => x.run === 'release-notes/run-l');
        assert.strictEqual(mine.length && mine[0].state, want, what + ' checker: ' + JSON.stringify(res.runReceipts));
        assert.strictEqual(mine[0].why || null, got.why || null, what + ' checker why');
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
/* Review round 1 (PR #114): a receipt's id is its own content, never proof of what it says. A receipt rewritten with its id
   recomputed that counts more answered or more steps than the run has, or whose seen record is gone, is never confirmed: run,
   next, runs, todo list and the folder checker name the same path, kind and why. */
rule('This version: a receipt with a recomputed id whose numbers aren\'t its run\'s work, or a record it rests on gone, is named alike by every reader and the checker', async () => {
  const { files, receipt } = await folder(), NEW = H.loadMain(), rp = 'runs/release-notes/run-l/run.json';
  const forge = (edit) => {
    const o = JSON.parse(files['proposals/' + receipt]); edit(o);
    o.id = NEW.receipts.idFor(o.run, o, o.by);
    const r = JSON.parse(files[rp]); r.living.receipt = o.id;
    const f = Object.assign({}, files); delete f['proposals/' + receipt];
    f['proposals/' + o.id + '.json'] = JSON.stringify(o, null, 2) + '\n'; f[rp] = JSON.stringify(r, null, 2) + '\n';
    return { f, name: o.id + '.json' };
  };
  const seen = JSON.parse(files['proposals/' + receipt]).seen;
  assert.ok(seen.length, 'set-up: the receipt saw a record');
  const gone = Object.assign({}, files); delete gone['proposals/' + seen[0] + '.json'];
  const cases = [['answered 999999', forge((o) => { o.counts.answered = 999999; }), 'malformed', /steps answered, but the run has/],
    ['one step more', forge((o) => { o.counts.steps += 1; }), 'malformed', /for "steps"/],
    ['a to-do more, done', forge((o) => { o.counts.todos += 1; o.counts.resolved += 1; o.counts.done += 1; }), 'malformed', /for "todos"/],
    ['the record it saw gone', { f: gone, name: receipt }, 'nofile', /rests on proposals\/req-/]];
  for (const [what, c, kind, why] of cases) {
    const { root, dir } = tree(c.f);
    try {
      const outs = {
        run: cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json'),
        next: cli(MINE, 'next', dir, 'release-notes/run-l', '--as', 'person-avery', '--contract', '2', '--json'),
        runs: cli(MINE, 'runs', dir, '--contract', '2', '--json'),
        'todo list': cli(MINE, 'todo', 'list', dir, 'release-notes/run-l', '--json')
      };
      const got = Object.keys(outs).map((k) => [k, (outs[k].json.problems || []).filter((x) => x.path === 'proposals/' + c.name).map((x) => [x.kind, x.why])]);
      const want = got[0][1];
      assert.strictEqual(want.length, 1, what + ': run names it once: ' + JSON.stringify(outs.run.json.problems));
      assert.strictEqual(want[0][0], kind, what);
      assert.ok(why.test(want[0][1]), what + ': ' + want[0][1]);
      same(got, Object.keys(outs).map((k) => [k, want]), what + ': ' + JSON.stringify(got));
      assert.notStrictEqual(outs.run.json.data.run.receipt.state, 'confirmed', what);
      if (PY) {
        const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8' }));
        const mine = (res.runReceipts || []).filter((x) => x.run === 'release-notes/run-l');
        same([mine.length, mine[0] && mine[0].path, mine[0] && mine[0].kind, mine[0] && mine[0].why], [1, 'proposals/' + c.name, kind, want[0][1]], what + ' checker: ' + JSON.stringify(res.runReceipts));
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
/* CC: the checker reads an ended run's end as the app does before it looks at its receipt: an end whose time isn't one the app
   reads (not a time, null, past the date range, left out) is dropped by the app, and run names run.json as malformed; the
   checker never confirms the receipt then, and names the same path, kind and first reason. */
rule('This version: an end whose time the app can\'t read is never confirmed by the checker; both name run.json, malformed, with the same reason', async () => {
  const { files } = await folder(), rp = 'runs/release-notes/run-l/run.json';
  for (const at of ['bad', null, '+275760-09-13T00:00:00.001Z', undefined]) {
    const r = JSON.parse(files[rp]); if (at === undefined) delete r.ended.at; else r.ended.at = at;
    const { root, dir } = tree(Object.assign({}, files, { [rp]: JSON.stringify(r, null, 2) + '\n' }));
    try {
      const rl = cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json');
      const p = (rl.json.problems || []).filter((x) => x.path === rp);
      same([rl.code, p.length, p[0] && p[0].kind], [4, 1, 'malformed'], JSON.stringify(at) + ': ' + rl.out.slice(0, 400));
      if (!PY) continue;
      const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8' }));
      const mine = (res.runReceipts || []).filter((x) => x.run === 'release-notes/run-l');
      same(mine.map((x) => [x.path, x.kind, x.why]), [[rp, 'malformed', p[0].why]], JSON.stringify(at) + ' checker: ' + JSON.stringify(res.runReceipts));
      assert.notStrictEqual(mine[0].state, 'confirmed');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
/* IC: the shipped checker's main() reads each run.json once through the readers' bounded parse before anything in it (its
   lineage included): a run.json that is JSON but no run (null, [], 42, a string, true) or nested deeper than any reader reads
   is named at run.json, as run names it, and never crashes the checker. */
rule('This version: a run.json that is no run, or nested past what any reader reads, is named at run.json by run and the checker\'s main() alike', async () => {
  const { files } = await folder(), rp = 'runs/release-notes/run-l/run.json';
  for (const [what, text] of [['null', 'null'], ['a list', '[]'], ['a number', '42'], ['a string', '"run"'], ['true', 'true'], ['50,000 nested lists', '['.repeat(50000) + ']'.repeat(50000)], ['cut', '{']]) {
    const { root, dir } = tree(Object.assign({}, files, { [rp]: text }));
    try {
      const rl = cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json');
      const p = (rl.json.problems || []).filter((x) => x.path === rp);
      same([p.length, p[0] && p[0].kind], [1, 'malformed'], what + ': ' + rl.out.slice(0, 400));
      if (!PY) continue;
      const r = cp.spawnSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8', maxBuffer: 1 << 26 });
      assert.strictEqual(r.status, 0, what + ' checker: ' + String(r.stderr).slice(-600));
      const mine = (JSON.parse(r.stdout).runReceipts || []).filter((x) => x.run === 'release-notes/run-l');
      same(mine.map((x) => [x.state, x.path, x.kind]), [['unread', rp, 'malformed']], what + ' checker: ' + JSON.stringify(mine));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
/* JC: the checker's JSON output is ASCII with every character past it escaped, a lone surrogate included, as JSON.stringify
   writes one: a newer living run titled 199 x's and an emoji, cut by UTF-16 units as the readers cut it, is named in
   complete JSON, with the very words run gives. */
rule('This version: a newer run whose title is cut inside an emoji is named by the checker in complete JSON, in run\'s words', async () => {
  const { files } = await folder(), rp = 'runs/release-notes/run-l/run.json';
  for (const [what, title] of [['199 x\'s and an emoji', 'x'.repeat(199) + '\u{1F600}'], ['99 x\'s and an emoji (cut inside it)', 'x'.repeat(99) + '\u{1F600}'], ['no title', undefined]]) {
    const r = JSON.parse(files[rp]); if (title === undefined) delete r.title; else r.title = title; r.features = r.features.concat(['zz-later']);
    const { root, dir } = tree(Object.assign({}, files, { [rp]: JSON.stringify(r, null, 2) + '\n' }));
    try {
      const rl = cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json');
      const p = (rl.json.problems || []).filter((x) => x.path === rp);
      same([p.length, p[0] && p[0].kind], [1, 'newer'], what + ': ' + rl.out.slice(0, 600));
      if (!PY) continue;
      const c = cp.spawnSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'buffer', maxBuffer: 1 << 26 });
      assert.strictEqual(c.status, 0, what + ': the checker: ' + String(c.stderr).slice(-600));
      const out = c.stdout.toString('latin1');
      assert.ok(!/[^\x00-\x7f]/.test(out), what + ': the checker writes ASCII');
      const mine = (JSON.parse(out).runReceipts || []).filter((x) => x.run === 'release-notes/run-l');
      /* The run named as the readers name it: its title as they keep it, then its folder. */
      const named = (w) => String(w).split(' (release-notes/run-l): ')[0];
      same(mine.map((x) => [x.path, x.kind, named(x.why)]), [[rp, 'newer', named(p[0].why)]], what + ': the checker: ' + JSON.stringify(mine).slice(0, 600));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
/* CE: the shipped checker reads publication.json with the app's replacement decoder (its payload still checked over the raw
   bytes): a byte that isn't UTF-8 (FF) in a version's change note is the version the app reads, current for both. */
rule('This version: a publication.json with a byte that isn\'t UTF-8 in its change note is current for the app and the checker alike', async () => {
  const { files } = await folder(), pp = Object.keys(files).filter((k) => /^publications\/release-notes\/v\d+-[a-z0-9]+\/publication\.json$/.test(k))[0];
  assert.ok(pp, 'set-up: the publication record');
  const t = String(files[pp]), b = Buffer.from(t), at = b.indexOf(Buffer.from('"First"'));
  assert.ok(at >= 0, 'set-up: the change note');
  const f = Object.assign({}, files, { [pp]: Buffer.concat([b.slice(0, at + 4), Buffer.from([0xff]), b.slice(at + 5)]) });
  const folderName = pp.split('/')[2], { root, dir } = tree(f);
  try {
    /* The app's reader (the command reads the folder's bytes with the app's decoder): the version is current, complete. */
    const pr = cli(MINE, 'process', dir, 'release-notes', '--contract', '2', '--json');
    assert.strictEqual(pr.code, 0, pr.out.slice(0, 600));
    same([pr.json.data.version.folder, pr.json.data.version.usable, pr.json.problems || []], [folderName, true, []], 'the app reads it: ' + pr.out.slice(0, 600));
    if (!PY) return;
    const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8' }));
    const pub = res.publications['release-notes'];
    same([pub.current, pub.versions.map((v) => v.status)], [folderName, ['complete']], JSON.stringify(pub));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
/* CF: one problem formatter for every reader: an unattributable request record that isn't complete JSON, and a proposals/
   listing that fails, are named with byte-identical paths, kinds and reasons by run, next, runs and todo list. */
rule('This version: run, next, runs and todo list name an unattributable unread request and a failed proposals/ listing in the same words', async () => {
  const { files } = await folder();
  const cases = [['an unattributable request that isn\'t complete JSON', (dir) => fs.writeFileSync(path.join(dir, 'proposals', 'req-notes-bot-' + 'a'.repeat(24) + '.json'), '{ bad')]];
  if (process.getuid && process.getuid() !== 0) cases.push(['a proposals/ listing that fails', (dir) => fs.chmodSync(path.join(dir, 'proposals'), 0o311)]);
  for (const [what, damage] of cases) {
    const { root, dir } = tree(files);
    try {
      damage(dir);
      const outs = {
        run: cli(MINE, 'run', dir, 'release-notes/run-q', '--contract', '2', '--json'),
        next: cli(MINE, 'next', dir, 'release-notes/run-q', '--as', 'person-avery', '--contract', '2', '--json'),
        runs: cli(MINE, 'runs', dir, '--contract', '2', '--json'),
        'todo list': cli(MINE, 'todo', 'list', dir, 'release-notes/run-q', '--json')
      };
      const seen = Object.keys(outs).map((k) => [k, outs[k].code, (outs[k].json.problems || []).filter((x) => /^proposals/.test(x.path)).map((x) => [x.path, x.kind, x.why])]);
      assert.ok(seen[0][2].length, what + ': run names it: ' + outs.run.out.slice(0, 400));
      same(seen, Object.keys(outs).map((k) => [k, 4, seen[0][2]]), what + ': ' + JSON.stringify(seen));
    } finally { try { fs.chmodSync(path.join(dir, 'proposals'), 0o755); } catch (e) { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); }
  }
});
/* DB: one complete end validation (its fields, their types and caps, an unknown field is newer, its time): each end field
   with each invalid value is refused by every reader alike (run, next, runs and todo list exit 4 naming run.json), the export
   is partial, and the checker names the same path, kind and reason as run before any receipt verdict. */
rule('This version: each end field with each invalid value is refused by the four readers, the export and the checker alike', async () => {
  const { files, receipt } = await folder(), rp = 'runs/release-notes/run-l/run.json', X81 = 'x'.repeat(81);
  const CASES = [['outcome', 'Done'], ['outcome', 42], ['outcome', null], ['by', 42], ['by', X81], ['byName', 42], ['byName', X81], ['byName', true],
    ['at', 'bad'], ['at', null], ['at', '+275760-09-13T00:00:00.001Z'], ['extra', 1], ['future', true], ['the end itself', 'yes'], ['the end itself', []],
    /* EB: a receipt named without an end (null or no end at all), and an outcome that is only text when made into text. */
    ['the end itself', null], ['the end itself', undefined], ['outcome', ['Cancelled']], ['outcome', ['Cancelled'], 'no receipt'],
    /* EE: living data cleanLiving refuses, at run.json with the app's reason. */
    ['living', { head: '' }, 'living'], ['living', 42, 'living'], ['living', 'head-and-more', 'living'], ['living', 'bad receipt', 'living'], ['living', 'both heads empty', 'living'],
    /* FA: judged on the raw run before any "no living work" gate: the feature without the record, an empty or a list record,
       with the run's to-do records there and with proposals/ empty. */
    ...[null, [], 'deleted', { head: '' }].map((v) => ['living', v, 'living']).filter((c) => !(c[1] && c[1].head === '')),
    ...[null, [], 'deleted', { head: '' }].map((v) => ['living', v, 'living, no proposals']),
    /* FD: an ended living run written back as run/2 (no run/3 field but its living record) is refused as run/2 has no living. */
    ['format', 'run/2', 'run/2'], ['format', 'run/2', 'run/2, no proposals']];
  const RUN3_ONLY = ['features', 'app', 'typesHash', 'payload', 'pins', 'migrations', 'test', 'stage', 'searchSites', 'searchGen', 'searchRec'];
  const NEW = H.loadMain();
  for (const [k, v, how] of CASES) {
    const r = JSON.parse(files[rp]);
    if (/^living/.test(how || '')) { if (v === 'deleted') delete r.living; else r.living = v === 'head-and-more' ? Object.assign({}, r.living, { more: 1 }) : v === 'bad receipt' ? Object.assign({}, r.living, { receipt: 'rcpt' }) : v && v.head === '' ? Object.assign({}, r.living, { head: '' }) : v; }
    else if (k === 'format') { r.format = 'preflight-run/2'; RUN3_ONLY.forEach((f) => { delete r[f]; }); }
    else if (k === 'the end itself') { if (v === undefined) delete r.ended; else r.ended = v; } else r.ended[k] = v;
    if (how === 'no receipt') delete r.living.receipt;
    const patch = { [rp]: null };
    if (v === 'both heads empty') {
      const o = JSON.parse(files['proposals/' + receipt]); o.head = ''; o.id = NEW.receipts.idFor(o.run, o, o.by);
      r.living = { head: '', receipt: o.id }; patch['proposals/' + receipt] = undefined; patch['proposals/' + o.id + '.json'] = NEW.todos.text(o);
    }
    patch[rp] = JSON.stringify(r, null, 2) + '\n';
    const fx = Object.assign({}, files, patch); Object.keys(fx).forEach((x) => { if (fx[x] === undefined || (/no proposals/.test(how || '') && /^proposals\//.test(x))) delete fx[x]; });
    const { root, dir } = tree(fx), tag = k + ' = ' + String(JSON.stringify(v)).slice(0, 20) + (how ? ' (' + how + ')' : '');
    try {
      const outs = {
        run: cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json'),
        next: cli(MINE, 'next', dir, 'release-notes/run-l', '--as', 'person-avery', '--contract', '2', '--json'),
        runs: cli(MINE, 'runs', dir, '--contract', '2', '--json'),
        'todo list': cli(MINE, 'todo', 'list', dir, 'release-notes/run-l', '--json')
      };
      const seen = Object.keys(outs).map((n) => [n, outs[n].code, (outs[n].json.problems || []).filter((x) => x.path === rp).map((x) => [x.kind, x.why])]);
      const want = seen[0][2];
      assert.strictEqual(want.length, 1, tag + ': run names run.json once: ' + outs.run.out.slice(0, 400));
      same(seen, Object.keys(outs).map((n) => [n, 4, want]), tag + ': ' + JSON.stringify(seen).slice(0, 800));
      const out = path.join(root, 'out'), ex = cli(MINE, 'export', dir, '--run', 'release-notes/run-l', '--out', out, '--tz', 'UTC');
      const zip = fs.existsSync(out) ? fs.readdirSync(out).filter((n) => /\.zip$/.test(n))[0] : null;
      if (zip) {
        const man = JSON.parse(cp.execFileSync(PY || 'python3', ['-I', '-c', 'import sys, zipfile; print(zipfile.ZipFile(sys.argv[1]).read("manifest.json").decode())', path.join(out, zip)], { encoding: 'utf8' }));
        assert.strictEqual(man.status, 'partial', tag + ': the export is partial: ' + JSON.stringify(man.runs.map((x) => x.living)).slice(0, 400));
      } else assert.notStrictEqual(ex.code, 0, tag + ': the export made no pack and said why: ' + ex.out.slice(0, 300));
      if (!PY) continue;
      const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8' }));
      const mine = (res.runReceipts || []).filter((x) => x.run === 'release-notes/run-l');
      same(mine.map((x) => [x.path, x.kind, x.why]), [[rp, want[0][0], want[0][1]]], tag + ' checker: ' + JSON.stringify(res.runReceipts));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
/* GA: the export and the checker apply the readers' whole verdict on run.json, not a port of part of it: an ended living run
   whose file any reader refuses (its envelope, a field this copy doesn't know, a value it drops or can't read) is refused by
   the four readers, the export is partial, and the checker names run.json with the readers' kind. */
rule('This version: an ended living run whose run.json any reader refuses, for any reason, is refused by the four readers, the export and the checker alike', async () => {
  const { files } = await folder(), rp = 'runs/release-notes/run-l/run.json';
  const CASES = [['app', (r) => { r.app = 'bad'; }], ['format', (r) => { r.format = 'preflight-run/4'; }], ['an unknown feature', (r) => { r.features = r.features.concat(['future-feature']); }],
    ['an unknown field', (r) => { r.future = 1; }], ['features not a list', (r) => { r.features = 'living-runs'; }], ['created', (r) => { r.created = 'bad'; }],
    ['title', (r) => { r.title = 42; }], ['recorder.person', (r) => { r.recorder.person = 42; }]];
  for (const [tag, damage] of CASES) {
    const r = JSON.parse(files[rp]); damage(r);
    const { root, dir } = tree(Object.assign({}, files, { [rp]: JSON.stringify(r, null, 2) + '\n' }));
    try {
      const outs = {
        run: cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json'),
        next: cli(MINE, 'next', dir, 'release-notes/run-l', '--as', 'person-avery', '--contract', '2', '--json'),
        runs: cli(MINE, 'runs', dir, '--contract', '2', '--json'),
        'todo list': cli(MINE, 'todo', 'list', dir, 'release-notes/run-l', '--json')
      };
      const seen = Object.keys(outs).map((n) => [n, outs[n].code, (outs[n].json.problems || []).filter((x) => x.path === rp).map((x) => x.kind)]);
      const kind = seen[0][2][0];
      assert.ok(/^(newer|malformed)$/.test(kind || ''), tag + ': run names run.json: ' + outs.run.out.slice(0, 400));
      same(seen.map((x) => [x[0], x[1], x[2].slice(0, 1)]), Object.keys(outs).map((n) => [n, 4, [kind]]), tag + ': ' + JSON.stringify(seen).slice(0, 800));
      const out = path.join(root, 'out'), ex = cli(MINE, 'export', dir, '--run', 'release-notes/run-l', '--out', out, '--tz', 'UTC');
      const zip = fs.existsSync(out) ? fs.readdirSync(out).filter((n) => /\.zip$/.test(n))[0] : null;
      if (zip) {
        const man = JSON.parse(cp.execFileSync(PY || 'python3', ['-I', '-c', 'import sys, zipfile; print(zipfile.ZipFile(sys.argv[1]).read("manifest.json").decode())', path.join(out, zip)], { encoding: 'utf8' }));
        assert.strictEqual(man.status, 'partial', tag + ': the export is partial: ' + JSON.stringify(man.runs.map((x) => x.living)).slice(0, 400));
        const lv = man.runs.filter((x) => x.key === 'release-notes/run-l')[0].living;
        assert.ok(lv && !lv.complete && lv.missing.some((m) => m.indexOf(rp + ' (' + kind + ')') === 0), tag + ': the export names run.json with the readers\' kind: ' + JSON.stringify(lv).slice(0, 400));
      } else assert.notStrictEqual(ex.code, 0, tag + ': the export made no pack and said why: ' + ex.out.slice(0, 300));
      if (!PY) continue;
      const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py'), dir], { encoding: 'utf8' }));
      const mine = (res.runReceipts || []).filter((x) => x.run === 'release-notes/run-l');
      same(mine.map((x) => [x.state, x.path, x.kind]), [['unread', rp, kind]], tag + ' checker: ' + JSON.stringify(res.runReceipts));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
/* HA: the folder checker writes nothing, a cold import of the run port it ships included: run from a team folder's own skills,
   with no bytecode cached beside it, judging an ended living run's receipt (which loads run_verdict.py), every file in the
   team folder is the same afterward, and no __pycache__ appears. */
rule('This version: the folder checker, run from the team folder\'s own skills with nothing cached, writes nothing there, the run port it loads included', () => {
  if (!PY) return;
  return folder().then(({ files }) => {
    const { root, dir } = tree(files), skills = path.join(dir, '.flightdeck', 'skills', '_flightdeck'), src = path.join(ROOT, 'example-folder', '.flightdeck', 'skills', '_flightdeck');
    try {
      fs.mkdirSync(skills, { recursive: true });
      fs.readdirSync(src).filter((n) => /\.py$/.test(n)).forEach((n) => fs.copyFileSync(path.join(src, n), path.join(skills, n)));
      const snap = () => { const out = []; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) { out.push(path.relative(dir, p) + '/'); walk(p); } else { const st = fs.statSync(p); out.push(path.relative(dir, p) + ' ' + st.size + ' ' + st.mtimeMs); } }); walk(dir); return out.sort(); };
      const before = snap();
      const res = JSON.parse(cp.execFileSync(PY, ['-I', path.join(skills, 'check_folder.py'), dir], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '' }) }));
      assert.ok((res.runReceipts || []).some((x) => x.run === 'release-notes/run-l' && x.state === 'confirmed'), 'set-up: the living run\'s receipt is judged (the run port loaded): ' + JSON.stringify(res.runReceipts));
      same(snap(), before, 'the team folder is unchanged');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
/* HE: a run folder whose run.json is gone (its notes still there) is named at run.json alike by the four readers: each exits 4
   with the same path and kind, todo list too. */
rule('This version: a run folder without its run.json is named at run.json by the four readers alike, todo list included', async () => {
  const { files } = await folder(), rp = 'runs/release-notes/run-l/run.json', fx = Object.assign({}, files);
  delete fx[rp];
  fx['runs/release-notes/run-l/notes-w-1.jsonl'] = JSON.stringify({ id: 'n1', text: 'A note', by: 'person-avery', at: '2026-11-01T10:00:00.000Z' }) + '\n';
  const { root, dir } = tree(fx);
  try {
    const outs = {
      run: cli(MINE, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json'),
      next: cli(MINE, 'next', dir, 'release-notes/run-l', '--as', 'person-avery', '--contract', '2', '--json'),
      runs: cli(MINE, 'runs', dir, '--contract', '2', '--json'),
      'todo list': cli(MINE, 'todo', 'list', dir, 'release-notes/run-l', '--json')
    };
    const seen = Object.keys(outs).map((n) => [n, outs[n].code, (outs[n].json.problems || []).filter((x) => x.path === rp).map((x) => [x.kind, x.why])]);
    assert.strictEqual(seen[0][2].length, 1, 'run names run.json: ' + outs.run.out.slice(0, 400));
    same(seen, Object.keys(outs).map((n) => [n, 4, seen[0][2]]), JSON.stringify(seen).slice(0, 800));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
run();
