// Living runs (4.0) against the exact shipped 3.0.0 (tools/old-bundles.js: its page, its command and its checker, byte for
// byte). A run with to-dos is preflight-run/3 naming living-runs, and its to-do records in proposals/ are flightdeck-plan/4
// and flightdeck-plan-status/4 naming living-runs. 3.0.0 shows that run by name only, can't save it, never offers a to-do
// record as a plan or a scope record, and its command and checker name them as newer; none of it writes anything. A run with
// no to-dos is unaffected: 3.0.0 records it as before, and this version's run, next and runs print exactly what 3.0.0's do.
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

let written = null;
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 41 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo, T = NEW.todos, R = NEW.run;
  const res = await repo.publish(m, MD, { people: G.PEOPLE, customTypes: {}, workflows: {}, by: 'person-avery', changes: 'First', existing: [], now: AT, app: '4.0.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  const pv = (await repo.loadAll(m)).processes.find(p => p.process === 'release-notes').index.latest;
  const RUN = { process: 'release-notes', id: 'run-l' };
  const l = R.create(pv, { id: 'run-l', title: 'Notes 4.1', by: 'person-avery', session: 'w-avery', now: AT, app: '4.0.0', details: { fix_version: '4.1', kind: 'minor' } });
  const p = R.create(pv, { id: 'run-p', title: 'Notes 4.2', by: 'person-avery', session: 'w-avery', now: AT, app: '4.0.0', details: { fix_version: '4.2', kind: 'minor' } });
  /* The recorder's own to-do, landed (its compound is the run's living head), and a tool's request waiting for a person. */
  const map = R.mapOf(l), id = T.idFor('flightdeck', 'seed'), body = { op: 'add', text: 'Check the links', target: { phase: 'draft' }, placement: T.placementFor(map, { phase: 'draft' }) };
  const b = Object.assign({ todo: T.todoIdFor(id) }, body), eff = T.effectOf(b), C = T.consequenceOf(l, map, b, T.view(l, { records: [], people: { people: G.PEOPLE } })).fingerprint;
  const c = T.buildProposal({ kind: 'compound', run: RUN, id, by: 'person-avery', seen: [], at: AT, body, decision: { by: 'person-avery', consequence: C }, application: { previous: '', effect: eff, fingerprint: T.fingerprint(eff) }, app: '4.0.0' });
  const q = T.buildProposal({ run: RUN, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-1', seen: [id], at: AT, body: { op: 'done', todo: b.todo }, app: '4.0.0' });
  await repo.saveScope(m, c.id + '.json', c); await repo.saveScope(m, q.id + '.json', q);
  l.living = { head: id }; l.features = NEW.envelope.FROZEN.filter(f => l.features.concat(['living-runs']).indexOf(f) >= 0);
  await repo.saveRun(m, l, 'w-avery'); await repo.saveRun(m, p, 'w-avery');
  written = { files: H.filesOf(m), records: [c.id + '.json', q.id + '.json'] };
  return written;
}

rule('This version writes a run with to-dos as run/3 naming living-runs, and its to-do records as plan/4 naming living-runs', async () => {
  const { files, records } = await folder();
  const l = JSON.parse(files['runs/release-notes/run-l/run.json']), p = JSON.parse(files['runs/release-notes/run-p/run.json']);
  same([l.format, l.features.indexOf('living-runs') >= 0, !!l.living], ['preflight-run/3', true, true]);
  same([p.features.indexOf('living-runs'), p.living], [-1, undefined], 'a run with no to-dos doesn\'t name the feature');
  records.forEach((f) => { const o = JSON.parse(files['proposals/' + f]); same([o.format, o.features], ['flightdeck-plan/4', ['living-runs']]); });
});

rule(TAG + ' (exact, as shipped): shows the run with to-dos by name only, can\'t save it, never offers a to-do record, writes nothing; still records the run without to-dos', async () => {
  const OLD = H.loadCopy(TAG); assert.ok(OLD, TAG + ' is recorded (node tools/old-bundles.js)');
  const { files, records } = await folder(), m = H.memFolder(OLD, files);
  const d = await OLD.repo.loadAll(m, { deep: true }), runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  assert.ok(runs['run-l'] && runs['run-l']._unrunnable && !Object.keys(runs['run-l'].steps).length, 'run-l: name only, read-only: ' + (runs['run-l'] && runs['run-l']._unrunnable));
  assert.ok(/4\.0/.test(String(runs['run-l']._unrunnable)), 'names the version it needs: ' + runs['run-l']._unrunnable);
  const ids = records.map(f => f.replace(/\.json$/, ''));
  assert.ok(!(d.plans || []).some(x => ids.indexOf(x.id) >= 0), 'never a plan');
  assert.ok(!(d.scopes || []).some(x => ids.indexOf(x.id) >= 0), 'never a scope record');
  const before = snap(m);
  await assert.rejects(() => OLD.repo.saveRun(m, runs['run-l'], 'w-avery'));
  assert.strictEqual(snap(m), before, 'nothing written');
  const p = runs['run-p'];
  assert.ok(p && !p._unrunnable, 'run-p is recordable: ' + (p && p._unrunnable));
  p.recorder.session = 'w-avery';
  OLD.run.done(p, OLD.run.mapOf(p), 'write', 'person-avery', AT);
  await OLD.repo.saveRun(m, p, 'w-avery');
  const NEW = H.loadMain(), back = (await NEW.repo.loadAll(H.memFolder(NEW, H.filesOf(m)))).runs.find(r => r.id === 'run-p');
  assert.ok(!back._unrunnable && back.steps.write && back.steps.write.s === 'done' && !back.living, 'this version reads what ' + TAG + ' recorded');
});

function cli(bin, ...a) { const r = cp.spawnSync(process.execPath, [bin, ...a], { encoding: 'utf8' }); let j = null; try { j = JSON.parse(r.stdout || r.stderr); } catch (e) { j = { raw: r.stdout + r.stderr }; } return { code: r.status, json: j }; }
const bare = (j) => { const o = JSON.parse(JSON.stringify(j)); delete o.app; delete o.readAt; return o; };
/* Fields this version added since that release (a contract only gains fields): next's waitingOn (4.1). Taken from this
   version's output only, after checking it's there, so everything else still has to match exactly. */
const added = (j) => { const o = bare(j), n = o.data && o.data.next; if (n && o.data.run && typeof o.data.run === 'string') { assert.ok(Array.isArray(n.waitingOn), 'next says what the run waits on'); delete n.waitingOn; } return o; };
rule(TAG + '\'s command and checker name the run with to-dos and its records as newer and write nothing; run, next and runs print the same for the run without to-dos', async () => {
  const b = H.bundles.get(TAG); assert.ok(b, TAG + ' is recorded');
  const { files, records } = await folder(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-compat-todos-'));
  try {
    fs.mkdirSync(path.join(root, 'bin')); fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'bin', 'flightdeck.js'), b.files['flightdeck.js']); fs.writeFileSync(path.join(root, 'dist', 'flightdeck.html'), b.files['flightdeck.html']);
    const dir = path.join(root, 'folder'); H.writeTree(dir, files);
    const OLD = path.join(root, 'bin', 'flightdeck.js'), MINE = path.join(ROOT, 'bin', 'flightdeck.js'), before = JSON.stringify(H.readTree(dir));
    const l = cli(OLD, 'run', dir, 'release-notes/run-l', '--contract', '2', '--json');
    assert.ok(l.code !== 0 && (l.json.problems || []).some(x => x.path.indexOf('runs/release-notes/run-l') === 0 && x.kind === 'newer'), 'names the run as newer: ' + JSON.stringify(l.json).slice(0, 400));
    const all = cli(OLD, 'runs', dir, '--contract', '2', '--json');
    records.forEach((f) => assert.ok((all.json.problems || []).some(x => x.path === 'proposals/' + f && x.kind === 'newer'), f + ' is newer there: ' + JSON.stringify(all.json.problems)));
    let py = null; for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); py = c; break; } catch (e) { /* next */ } }
    if (py) {
      const ck = path.join(root, 'check_folder.py'); fs.writeFileSync(ck, b.files['check_folder.py']); if (b.files['run_verdict.py']) fs.writeFileSync(path.join(root, 'run_verdict.py'), b.files['run_verdict.py']);
      const res = JSON.parse(cp.execFileSync(py, ['-I', ck, dir], { encoding: 'utf8' }));
      records.forEach((f) => assert.ok(res.refused.some(x => x.file === 'proposals/' + f && /newer/.test(x.why)), f + ': ' + JSON.stringify(res.refused)));
    }
    assert.strictEqual(JSON.stringify(H.readTree(dir)), before, TAG + ' wrote nothing');
    for (const a of [['run', dir, 'release-notes/run-p'], ['next', dir, 'release-notes/run-p', '--as', 'person-avery']]) {
      const theirs = cli(OLD, ...a, '--contract', '2', '--json'), mine = cli(MINE, ...a, '--contract', '2', '--json');
      same([mine.code, added(mine.json)], [theirs.code, bare(theirs.json)], a[0] + ' run-p prints what ' + TAG + ' prints');
    }
    const theirs = cli(OLD, 'runs', dir, '--contract', '2', '--json'), mine = cli(MINE, 'runs', dir, '--contract', '2', '--json');
    same(mine.json.data.runs.find(r => r.id === 'run-p'), theirs.json.data.runs.find(r => r.id === 'run-p'), 'runs lists run-p as ' + TAG + ' does');
    assert.strictEqual(JSON.stringify(H.readTree(dir)), before, 'this version\'s reads wrote nothing');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run();
