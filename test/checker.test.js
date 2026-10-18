// The assistants' folder checker (example-folder/.flightdeck/skills/_flightdeck/check_folder.py) must agree with the app.
// Builds a real folder on disk with the app's own code, then compares the checker's verdicts with loadAll's.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { load, example, exampleSetup, rule, run } = require('./harness');
const PF = load(), repo = PF.repo;
const EX = exampleSetup(PF);
const NOW = '2026-10-17T21:00:00.000Z';
const people = JSON.parse(example('people.json'));
const CHECKER = path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py');

class DiskFS {
  constructor(root) { this.root = root; this.kind = 'folder'; this.name = path.basename(root); }
  p(rel) { return path.join(this.root, ...rel.split('/')); }
  list(rel) { const d = rel ? this.p(rel) : this.root; return Promise.resolve(fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).map(e => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' })) : []); }
  read(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) ? { text: fs.readFileSync(f, 'utf8'), mtime: fs.statSync(f).mtimeMs } : null); }
  stat(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) ? { size: fs.statSync(f).size, mtime: fs.statSync(f).mtimeMs } : null); }
  blob(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) ? new Blob([fs.readFileSync(f)]) : null); }
  write(rel, data) {
    const f = this.p(rel); fs.mkdirSync(path.dirname(f), { recursive: true });
    if (typeof data === 'string') { fs.writeFileSync(f, data); return Promise.resolve(); }
    return data.arrayBuffer().then(b => fs.writeFileSync(f, Buffer.from(b)));
  }
  append(rel, text) { const f = this.p(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, text); return Promise.resolve(); }
  remove(rel) { fs.unlinkSync(this.p(rel)); return Promise.resolve(); }
}

function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* try next */ } } return null; }

rule('The assistants\' folder checker agrees with the app on complete, damaged and syncing versions, plans and conflicts', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-check-'));
  const d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  await d.write('images/release/job.png', new Blob([Buffer.from([0, 255, 128, 7, 1, 2, 3])], { type: 'image/png' }));
  const md = example('maps/drafts/release.md').replace('{#merge}', '{#merge}\n  ![Le travail — déployé ✓](images/release/job.png)');
  const v1 = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'Première version — ✓', existing: [], now: NOW });
  assert.ok(!v1.blockers, String(v1.blockers));
  const v2 = await repo.publish(d, md + '\n', { people, ...EX, by: 'person-avery', changes: 'Second', existing: [{ version: 1 }], now: NOW });
  fs.appendFileSync(path.join(root, 'publications', 'release', v2.folder, 'map.md'), 'edited by hand');
  await d.write('proposals/plan-a.json', JSON.stringify({ kind: 'plan', id: 'plan-a', process: 'release', version: 1, title: 'Release — ünïcode', details: { ticket: 'ABC-1' }, roles: {} }, null, 2));
  await d.write('proposals/plan-b.json', JSON.stringify({ kind: 'plan', id: 'plan-b', process: 'release', version: 1, title: 'Second plan', details: {}, roles: {} }));
  const loaded = await repo.loadAll(d);
  await repo.recordPlanStatus(d, loaded.plans.find(p => p.id === 'plan-a'), 'w1', 'accepted', null, 'person-casey');
  await d.write('runs/release/r1/run.json', '{}'); await d.write('runs/release/r1/run-PC (1).json', '{}');

  const app = await repo.loadAll(d, { deep: true });
  const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  const pubs = out.publications.release.versions;
  for (const pub of app.processes[0].pubs) {
    const mine = pubs.find(v => v.folder === pub.folder);
    assert.strictEqual(mine.status === 'complete', !!pub.ok, pub.folder + ': app says ' + pub.ok + ', checker says ' + mine.status + ' ' + mine.why);
  }
  assert.strictEqual(out.publications.release.current, v1.folder);
  assert.deepStrictEqual(out.plans.map(p => p.id + ':' + p.status), ['plan-a:decided', 'plan-b:pending']);
  assert.deepStrictEqual(app.plans.map(p => p.id + ':' + !!p._status).sort(), ['plan-a:true', 'plan-b:false']);
  assert.deepStrictEqual(out.conflicts, [{ run: 'release/r1', copies: ['run-PC (1).json'] }]);

  // Change plan-a after the decision: both say it's no longer decided.
  const pa = JSON.parse(fs.readFileSync(path.join(root, 'proposals/plan-a.json'), 'utf8')); pa.title = 'Changed';
  fs.writeFileSync(path.join(root, 'proposals/plan-a.json'), JSON.stringify(pa));
  const out2 = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.strictEqual(out2.plans.find(p => p.id === 'plan-a').status, 'ambiguous');
  assert.ok(!(await repo.loadAll(d, { deep: true })).plans.find(p => p.id === 'plan-a')._status);
  // Same JSON rules as the app (1.0 is written 1), and the same choice of current version when the newest one clashes.
  await d.write('proposals/plan-c.json', '{"kind":"plan","id":"plan-c","process":"release","version":1.0,"title":"C","details":{},"roles":{}}');
  const lc = await repo.loadAll(d, { deep: true });
  await repo.recordPlanStatus(d, lc.plans.find(p => p.id === 'plan-c'), 'w1', 'accepted', null, 'person-casey');
  const v3a = await repo.publish(d, md + '\n\n', { people, ...EX, by: 'a', changes: 'Three', existing: [{ version: 2 }], now: NOW });
  const v3b = await repo.publish(d, md + '\n\n\n', { people, ...EX, by: 'b', changes: 'Three again', existing: [{ version: 2 }], now: NOW });
  assert.strictEqual(v3a.version, 3); assert.strictEqual(v3b.version, 3);
  const app3 = await repo.loadAll(d, { deep: true });
  const out3 = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.strictEqual(out3.plans.find(p => p.id === 'plan-c').status, 'decided', 'the checker writes numbers the way the app does');
  assert.strictEqual(out3.publications.release.current, app3.processes[0].index.latest.folder, 'same current version as the app when the newest clashes');
  assert.deepStrictEqual(out3.publications.release.clash.sort(), [v3a.folder, v3b.folder].sort());
  // Number and key edge cases written the way JavaScript writes them.
  await d.write('proposals/plan-d.json', '{"kind":"plan","id":"plan-d","process":"release","version":1,"title":"D","details":{"10":"x","2":"y","b":"z","a":"w"},"roles":{},"n":[0.000001,1e-7,1e21,123456789012345680000,9007199254740993,-0.5,0]}');
  const ld = await repo.loadAll(d, { deep: true });
  await repo.recordPlanStatus(d, ld.plans.find(p => p.id === 'plan-d'), 'w1', 'accepted', null, 'person-casey');
  const out4 = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.strictEqual(out4.plans.find(p => p.id === 'plan-d').status, 'decided', 'numbers and keys hash the same as in the app');
  await d.write('proposals/plan-e.json', '{"kind":"plan","id":"plan-e","process":"release","version":1,"title":"E \\ud800 lone","details":{"\u0662":"arabic two","\u00b2":"superscript","01":"leading zero","7":"seven"},"roles":{}}');
  const le = await repo.loadAll(d, { deep: true });
  await repo.recordPlanStatus(d, le.plans.find(p => p.id === 'plan-e'), 'w1', 'accepted', null, 'person-casey');
  const out5 = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.strictEqual(out5.plans.find(p => p.id === 'plan-e').status, 'decided', 'unicode digits and lone surrogates hash the same as in the app');
  // Two disagreeing decisions on the same plan: both the app and the checker call it undecided.
  const lf = await repo.loadAll(d, { deep: true }), pb = lf.plans.find(p => p.id === 'plan-b');
  await repo.recordPlanStatus(d, pb, 'w1', 'accepted', null, 'person-casey');
  await repo.recordPlanStatus(d, pb, 'w2', 'declined', null, 'person-blake');
  const lg = await repo.loadAll(d, { deep: true });
  assert.ok(!lg.plans.find(p => p.id === 'plan-b')._status && lg.plans.find(p => p.id === 'plan-b')._conflicting, 'the app doesn\'t pick one');
  const out6 = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.strictEqual(out6.plans.find(p => p.id === 'plan-b').status, 'ambiguous');
  fs.rmSync(root, { recursive: true, force: true });
});

run();
