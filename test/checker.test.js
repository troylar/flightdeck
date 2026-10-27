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
  assert.deepStrictEqual(JSON.parse(JSON.stringify(app.plans.map(p => p.id + ':' + !!p._status).sort())), ['plan-a:true', 'plan-b:false']);
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

rule('The checker agrees with the app (2.1.1): an edited plan, a deleted copy, and a start on one version with a decline on another', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-check-'));
  const d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  const v1 = await repo.publish(d, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW });
  assert.ok(!v1.blockers, String(v1.blockers));
  const plan = (id, extra) => JSON.stringify(Object.assign({ kind: 'plan', id, process: 'release', version: 1, title: id, details: {}, roles: {} }, extra || {}), null, 2);
  const page = async (id) => (await repo.loadAll(d, { deep: true })).plans.find(p => p.id === id);
  // Edited after it was started.
  await d.write('proposals/plan-edit.json', plan('plan-edit'));
  await repo.recordPlanStatus(d, await page('plan-edit'), 'w1', 'accepted', 'run-e', 'person-casey');
  await d.write('proposals/plan-edit.json', plan('plan-edit', { note: 'Edited' }));
  // Copy A started, then deleted; copy B differs slightly.
  await d.write('proposals/plan-copy.json', plan('plan-copy'));
  await repo.recordPlanStatus(d, await page('plan-copy'), 'w1', 'accepted', 'run-c', 'person-casey');
  await d.write('proposals/plan-copy (1).json', plan('plan-copy', { note: 'Copy B' }));
  fs.unlinkSync(path.join(root, 'proposals', 'plan-copy.json'));
  // Started on version A, declined on an edited version B.
  await d.write('proposals/plan-mixed.json', plan('plan-mixed'));
  await repo.recordPlanStatus(d, await page('plan-mixed'), 'w1', 'accepted', 'run-m', 'person-casey');
  await d.write('proposals/plan-mixed.json', plan('plan-mixed', { note: 'Edited' }));
  await repo.recordPlanStatus(d, await page('plan-mixed'), 'w2', 'declined', null, 'person-blake');
  const app = await repo.loadAll(d, { deep: true }), out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  const ap = id => app.plans.find(p => p.id === id), ck = id => out.plans.find(p => p.id === id);
  assert.ok(ap('plan-edit')._decidedEarlier && ap('plan-copy')._decidedEarlier && ap('plan-mixed')._conflicting, 'the app');
  for (const id of ['plan-edit', 'plan-copy']) {
    assert.strictEqual(ck(id).status, 'ambiguous', id);
    assert.ok(!/pending again/.test(ck(id).why) && /earlier version/.test(ck(id).why) && /new plan/.test(ck(id).why), id + ': ' + ck(id).why);
  }
  assert.strictEqual(ck('plan-mixed').status, 'ambiguous', 'a start and a decline on different versions disagree');
  assert.ok(/disagree/.test(ck('plan-mixed').why), ck('plan-mixed').why);
  fs.rmSync(root, { recursive: true, force: true });
});

rule('The checker agrees with the app (2.1.1): a started plan\'s missing run, before and after the plan is edited, and which torn files in proposals/ name their plan', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-check-'));
  const d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  const v1 = await repo.publish(d, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW });
  assert.ok(!v1.blockers, String(v1.blockers));
  const plan = (id, extra) => JSON.stringify(Object.assign({ kind: 'plan', id, process: 'release', version: 1, title: id, details: {}, roles: {} }, extra || {}), null, 2);
  const page = async (id) => (await repo.loadAll(d, { deep: true })).plans.find(p => p.id === id);
  // Started, its run never saved: as started, and edited afterwards.
  await d.write('proposals/plan-lost.json', plan('plan-lost'));
  await repo.recordPlanStatus(d, await page('plan-lost'), 'w1', 'accepted', 'run-lost', 'person-casey');
  await d.write('proposals/plan-lost-edit.json', plan('plan-lost-edit'));
  await repo.recordPlanStatus(d, await page('plan-lost-edit'), 'w1', 'accepted', 'run-lost-e', 'person-casey');
  await d.write('proposals/plan-lost-edit.json', plan('plan-lost-edit', { note: 'Edited' }));
  // Started and its run saved, then edited to another process: the run is where it was started, so it isn't missing.
  await d.write('proposals/plan-moved.json', plan('plan-moved'));
  await repo.recordPlanStatus(d, await page('plan-moved'), 'w1', 'accepted', 'run-moved', 'person-casey');
  const pub = (await repo.loadAll(d)).processes.find(x => x.process === 'release').index.latest;
  await repo.saveRun(d, PF.run.create(pub, { title: 'Moved', details: { commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'w1', now: NOW, id: 'run-moved' }), 'w1');
  await d.write('proposals/plan-moved.json', plan('plan-moved', { process: 'check-in' }));
  await d.write('proposals/plan-moved-gone.json', plan('plan-moved-gone'));
  await repo.recordPlanStatus(d, await page('plan-moved-gone'), 'w1', 'accepted', 'run-moved-gone', 'person-casey');
  await d.write('proposals/plan-moved-gone.json', plan('plan-moved-gone', { process: 'check-in' }));
  // Declined and edited: no run to miss.
  await d.write('proposals/plan-declined.json', plan('plan-declined'));
  await repo.recordPlanStatus(d, await page('plan-declined'), 'w1', 'declined', null, 'person-casey');
  await d.write('proposals/plan-declined.json', plan('plan-declined', { note: 'Edited' }));
  // Torn files: standard plan and request names, a legacy ID known through its readable plan, and names that say no plan.
  const REQ = 'req-tool-' + 'b'.repeat(24);
  await d.write('proposals/release-old.json', plan('release-old'));
  const torn = ['plan-torn.json', 'plan-torn.status-w-d.json', REQ + '.status-w.json', 'release-old.status-w.json', 'Copy of plan-torn.json', 'stray.json'];
  for (const n of torn) await d.write('proposals/' + n, '{"kind": "pla');
  const app = await repo.loadAll(d, { deep: true }), out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  const ap = id => app.plans.find(p => p.id === id), ck = id => out.plans.find(p => p.id === id);
  for (const id of ['plan-lost', 'plan-lost-edit', 'plan-declined', 'plan-moved', 'plan-moved-gone']) {
    assert.strictEqual(ck(id).runMissing || '', PF.health.missingRun(app, ap(id)), id + ': ' + JSON.stringify(ck(id)));
  }
  assert.strictEqual(ck('plan-lost-edit').runMissing, 'run-lost-e', 'the edited plan still names its run');
  assert.ok(app.runs.some(r => r.process === 'release' && r.id === 'run-moved') && ap('plan-moved').process === 'check-in', 'set-up: moved plan, its run in the folder');
  assert.ok(!ck('plan-moved').runMissing, 'a plan moved to another process after it started isn\'t missing its run');
  assert.strictEqual(ck('plan-moved-gone').runMissing, 'run-moved-gone', 'a moved plan whose run is nowhere still names it');
  const appUnnamed = n => !!app.planUnread.find(u => u.path === 'proposals/' + n).unnamed;
  for (const n of torn) {
    const c = (out.unreadablePlans || []).find(u => u.file === 'proposals/' + n);
    assert.ok(c, n + ': listed by the checker: ' + JSON.stringify(out.unreadablePlans));
    assert.strictEqual(!!c.unnamed, appUnnamed(n), n);
  }
  assert.deepStrictEqual(torn.filter(appUnnamed), ['Copy of plan-torn.json', 'stray.json']);
  fs.rmSync(root, { recursive: true, force: true });
});

rule('The checker agrees with the app (2.1.1): a malformed start names no missing run, differing copies keep the missing run, and .JSON in capitals is read', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-check-'));
  const d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  const v1 = await repo.publish(d, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW });
  assert.ok(!v1.blockers, String(v1.blockers));
  const plan = (id, extra) => JSON.stringify(Object.assign({ kind: 'plan', id, process: 'release', version: 1, title: id, details: {}, roles: {} }, extra || {}), null, 2);
  const page = async (id) => (await repo.loadAll(d, { deep: true })).plans.find(p => p.id === id);
  // A start whose by isn't text: the app refuses it, so it starts nothing.
  await d.write('proposals/plan-bad-by.json', plan('plan-bad-by'));
  const bad = await repo.recordPlanStatus(d, await page('plan-bad-by'), 'w1', 'accepted', 'run-bad', 'person-casey');
  await d.write(bad, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(path.join(root, bad), 'utf8')), { by: 44 }), null, 2));
  // Started, its run never saved, then an edited copy arrives beside it.
  await d.write('proposals/plan-copies.json', plan('plan-copies'));
  await repo.recordPlanStatus(d, await page('plan-copies'), 'w1', 'accepted', 'run-copies', 'person-casey');
  await d.write('proposals/plan-copies (1).json', plan('plan-copies', { note: 'Edited elsewhere' }));
  // Extensions in capitals: a plan, and a torn file whose name says no plan.
  await d.write('proposals/plan-upper.JSON', plan('plan-upper'));
  await d.write('proposals/Copy of plan-test.JSON', '{"kind": "pla');
  const app = await repo.loadAll(d, { deep: true }), out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  const ap = id => app.plans.find(p => p.id === id), ck = id => out.plans.find(p => p.id === id);
  for (const id of ['plan-bad-by', 'plan-copies']) assert.strictEqual(ck(id).runMissing || '', PF.health.missingRun(app, ap(id)), id + ': ' + JSON.stringify(ck(id)));
  assert.ok(!ck('plan-bad-by').runMissing, 'a malformed start names no run');
  assert.ok(out.refused.some(r => r.file === bad), 'the malformed decision is named, as the app names it: ' + JSON.stringify(out.refused));
  assert.ok(app.plans.filter(p => p.id === 'plan-copies').length === 2 && ck('plan-copies').status === 'ambiguous', 'set-up: copies differ');
  assert.strictEqual(ck('plan-copies').runMissing, 'run-copies', 'differing copies keep the missing run');
  assert.ok(ap('plan-upper') && ck('plan-upper'), 'a plan in .JSON is read by both');
  const torn = 'proposals/Copy of plan-test.JSON', appT = app.planUnread.find(u => u.path === torn), ckT = (out.unreadablePlans || []).find(u => u.file === torn);
  assert.ok(appT && appT.unnamed, 'set-up: the app names it unnamed');
  assert.ok(ckT && ckT.unnamed, 'the checker lists it, unnamed: ' + JSON.stringify(out.unreadablePlans));
  fs.rmSync(root, { recursive: true, force: true });
});

rule('The checker agrees with the app (2.1.1): a refused, newer or torn decision holds its plan, in the app\'s words', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-check-'));
  try {
    const d = new DiskFS(root);
    await d.write('people.json', JSON.stringify(people));
    const v1 = await repo.publish(d, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW });
    assert.ok(!v1.blockers, String(v1.blockers));
    const plan = id => ({ kind: 'plan', id, process: 'release', version: 1, title: id, details: {}, roles: {} });
    const dec = (id, extra) => JSON.stringify(Object.assign({ kind: 'status', proposal: id, proposalHash: PF.util.hash(JSON.stringify(plan(id))), status: 'accepted', run: 'run-' + id, by: 'person-casey', at: NOW }, extra || {}), null, 2);
    for (const id of ['plan-bad-by', 'plan-newer', 'plan-torn-dec', 'plan-bad-switch', 'plan-bad-env', 'plan-both']) await d.write('proposals/' + id + '.json', JSON.stringify(plan(id), null, 2));
    await d.write('proposals/plan-bad-by.status-w-d.json', dec('plan-bad-by', { by: 44 }));
    await d.write('proposals/plan-newer.status-w-d.json', dec('plan-newer', { features: ['from-the-future'] }));
    await d.write('proposals/plan-torn-dec.status-w-d.json', '{"kind": "sta');
    await d.write('proposals/plan-bad-env.status-w-d.json', dec('plan-bad-env', { features: 'from-the-future' }));
    await d.write('proposals/plan-bad-switch.status-w.json', dec('plan-bad-switch', { status: 'retargeted', run: undefined, to: { folder: v1.folder, version: 1 } }));
    // A decision that reads decides it: the malformed one beside it changes nothing.
    await d.write('proposals/plan-both.status-w-d.json', dec('plan-both', { status: 'declined', run: null }));
    await d.write('proposals/plan-both.status-x-d.json', dec('plan-both', { at: 7 }));
    const PFV = load(true), app = await PFV.repo.loadAll(d, { deep: true }), out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    const ap = id => app.plans.find(p => p.id === id), ck = id => out.plans.find(p => p.id === id);
    for (const id of ['plan-bad-by', 'plan-newer', 'plan-torn-dec', 'plan-bad-switch', 'plan-bad-env']) {
      const words = PFV.views.planHeldWhy(ap(id), app);
      assert.ok(words && /can't be started, declined or switched/.test(words), 'set-up: the app holds ' + id + ': ' + words);
      assert.strictEqual(ck(id).status, 'ambiguous', id + ' is held, never pending: ' + JSON.stringify(ck(id)));
      assert.strictEqual(ck(id).why, words, id + ': the app\'s words');
      assert.ok(!ck(id).runMissing, id + ': names no run');
    }
    assert.ok(ap('plan-both')._status && ck('plan-both').status === 'decided' && ck('plan-both').why === 'declined', 'a decision that reads decides it: ' + JSON.stringify(ck('plan-both')));
    const appRefused = JSON.parse(JSON.stringify(app.refused)).filter(r => /^proposals\//.test(r.path)).map(r => r.path + ': ' + r.why).sort();
    assert.strictEqual(appRefused.length, 5, 'set-up: the app refuses five decisions: ' + appRefused.join('; '));
    assert.deepStrictEqual((out.refused || []).filter(r => /^proposals\//.test(r.file)).map(r => r.file + ': ' + r.why).sort(), appRefused, 'refused, with the app\'s reasons');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker agrees with the app (2.1.1): a plan/2 not in its format is refused with the app\'s reason, never pending; a 1.x plan keeps what 1.x did', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-plan2-'));
  try {
    const d = new DiskFS(root);
    await d.write('people.json', JSON.stringify(people));
    const v = await repo.publish(d, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, app: '2.0.0' });
    assert.ok(!v.blockers, String(v.blockers));
    const pub = { info: JSON.parse(v.files['publication.json']) };
    const two = (id, extra) => Object.assign(PF.plans.make(pub, { id, process: 'release', title: id, details: {}, roles: {}, by: 'person-avery', created: NOW }, true, '2.0.0'), extra || {});
    const bad = {
      'plan-t-title': { title: 44 },
      'plan-t-note': { note: false },
      'plan-t-details': { details: { a: true } },
      'plan-t-roles': { roles: { owner: 5 } },
      'plan-t-twoways': { version: 1 },
      'plan-t-pinhash': p => ({ pin: Object.assign({}, p.pin, { mapHash: 'XYZ' }) }),
      'plan-t-pinfolder': p => ({ pin: Object.assign({}, p.pin, { version: p.pin.version + 1 }) }),
      'plan-t-pinextra': p => ({ pin: Object.assign({}, p.pin, { extra: 1 }) }),
      'plan-t-version': { version: 1.5, pin: undefined }
    };
    await d.write('proposals/plan-t-good.json', JSON.stringify(two('plan-t-good'), null, 2));
    for (const [id, x] of Object.entries(bad)) { const p = two(id); await d.write('proposals/' + id + '.json', JSON.stringify(Object.assign(p, typeof x === 'function' ? x(p) : x), null, 2)); }
    await d.write('proposals/plan-t-env.json', JSON.stringify(Object.assign(two('plan-t-env'), { features: [1] }), null, 2));
    await d.write('proposals/plan-t-other.json', JSON.stringify({ format: 'preflight-run/1', id: 'plan-t-other' }, null, 2));
    await d.write('proposals/plan-t-old.json', JSON.stringify({ kind: 'plan', id: 'plan-t-old', process: 'release', version: 1, title: 44, details: {}, roles: {} }, null, 2));
    const app = await repo.loadAll(d, { deep: true }), out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(app.plans.map(p => p.id).sort())), ['plan-t-good', 'plan-t-old'], 'set-up: the app refuses every malformed plan/2');
    assert.deepStrictEqual(out.plans.map(p => p.id + ':' + p.status).sort(), ['plan-t-good:pending', 'plan-t-old:pending'], 'none is listed as a plan to start');
    const appRefused = JSON.parse(JSON.stringify(app.refused)).filter(r => /^proposals\//.test(r.path)).map(r => r.path + ': ' + r.why).sort();
    assert.strictEqual(appRefused.length, Object.keys(bad).length + 2, 'set-up: ' + appRefused.join('; '));
    assert.deepStrictEqual((out.refused || []).filter(r => /^proposals\//.test(r.file)).map(r => r.file + ': ' + r.why).sort(), appRefused, 'refused, with the app\'s reasons');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker agrees with the app (2.1.1): a format name with a line break after it is refused, never read; a plan/2 so named is never pending, a decision so named never decides', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-nl-'));
  try {
    const d = new DiskFS(root);
    await d.write('people.json', JSON.stringify(people));
    const v = await repo.publish(d, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, app: '2.0.0' });
    assert.ok(!v.blockers, String(v.blockers));
    const pub = { info: JSON.parse(v.files['publication.json']) };
    const two = (id) => PF.plans.make(pub, { id, process: 'release', title: id, details: {}, roles: {}, by: 'person-avery', created: NOW }, true, '2.0.0');
    await d.write('proposals/plan-nl-good.json', JSON.stringify(two('plan-nl-good'), null, 2));
    await d.write('proposals/plan-nl-plan.json', JSON.stringify(Object.assign(two('plan-nl-plan'), { format: 'flightdeck-plan/2\n' }), null, 2));
    const held = two('plan-nl-held');
    await d.write('proposals/plan-nl-held.json', JSON.stringify(held, null, 2));
    const dec = Object.assign(PF.plans.decision(Object.assign({ _hash: PF.util.hash(JSON.stringify(held)) }, held), 'accepted', 'run-nl', 'person-casey', NOW, null, '2.0.0'), { format: 'flightdeck-plan-status/2\n' });
    await d.write('proposals/plan-nl-held.status-w-d.json', JSON.stringify(dec, null, 2));
    const PFV = load(true), app = await PFV.repo.loadAll(d, { deep: true }), out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(app.plans.map(p => p.id).sort())), ['plan-nl-good', 'plan-nl-held'], 'set-up: the app refuses the plan/2 with a line break in its format');
    const ck = id => out.plans.find(p => p.id === id);
    assert.ok(!ck('plan-nl-plan') || ck('plan-nl-plan').status !== 'pending', 'never pending: ' + JSON.stringify(ck('plan-nl-plan')));
    const words = PFV.views.planHeldWhy(app.plans.find(p => p.id === 'plan-nl-held'), app);
    // The decision is refused, never read as a start, and holds its plan by its name, in the app's words.
    const nlHeld = ck('plan-nl-held');
    assert.ok(/can't be started, declined or switched/.test(words), 'set-up: the app holds plan-nl-held: ' + words);
    assert.ok(nlHeld.status === 'ambiguous' && nlHeld.why === words, 'as the app shows it: ' + JSON.stringify(nlHeld));
    const appRefused = JSON.parse(JSON.stringify(app.refused)).filter(r => /^proposals\//.test(r.path)).map(r => r.path + ': ' + r.why).sort();
    assert.strictEqual(appRefused.length, 2, 'set-up: ' + appRefused.join('; '));
    assert.deepStrictEqual((out.refused || []).filter(r => /^proposals\//.test(r.file)).map(r => r.file + ': ' + r.why).sort(), appRefused, 'refused, with the app\'s reasons');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker matches names, IDs and hashes whole, as the app does (2.1.1): a line break after one never passes', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const H8 = 'aaaaaaaa', pin = { process: 'release', version: 1, folder: 'v1-abcd1234', mapHash: H8, typesHash: 'bbbbbbbb' }, nl = (o, k) => Object.assign({}, o, { [k]: o[k] + '\n' });
  const req = { id: 'req-backup-script-' + 'a'.repeat(24), by: 'backup-script 1.4.0 (a tool)' };
  const reg = { format: 'flightdeck-skill/2', name: 'notes', id: 'sk-abcdefgh', rev: 1, seen: null, implements: { process: 'release', folder: 'v1-abcd1234', mapHash: H8, typesHash: 'bbbbbbbb' }, steps: ['build'] };
  const regPath = 'skill-registrations/notes/sk-abcdefgh.1.w1.json';
  const cases = [
    ['judge', ['flightdeck-plan', { format: 'flightdeck-plan/2\n' }]], ['judge', ['flightdeck-plan', { format: 'flightdeck-plan/2', features: ['staged\n'] }]],
    ['judge', ['flightdeck-plan', { format: 'flightdeck-plan/9', app: '3.2.1\n' }]], ['judge', ['flightdeck-plan', { format: 'flightdeck-plan/9', app: '3.2.1' }]],
    ['family', [{ format: 'flightdeck-plan-status/2\n' }]], ['family', [{ format: 'flightdeck-plan-status/2' }]],
    ['request', [req]], ['request', [nl(req, 'id')]], ['request', [nl(req, 'by')]],
    ['child', [pin]], ...['process', 'folder', 'mapHash', 'typesHash'].map(k => ['child', [nl(pin, k)]]),
    ['skill', [{ name: 'notes', version: '1.2.0' }]], ['skill', [{ name: 'notes', version: '1.2.0\n' }]],
    ['pins', [{ children: { build: pin } }]], ['pins', [{ children: { 'build\n': pin } }]],
    ['reg', [regPath, reg]], ['reg', [regPath + '\n', reg]], ['reg', [regPath, nl(reg, 'id')]], ['reg', [regPath, Object.assign({}, reg, { implements: nl(reg.implements, 'process') })]]
  ];
  const script = 'import sys, json\nsys.path.insert(0, sys.argv[1])\nimport check_folder as c\nout = []\n' +
    'for f, a in json.loads(sys.stdin.read()):\n' +
    '    if f == "judge": r = c.judge(*a); out.append([r["ok"], "" if r["ok"] else r["kind"], "" if r["ok"] else r.get("needs", "")])\n' +
    '    elif f == "family": out.append({"flightdeck-plan": "plan", "flightdeck-plan-status": "status"}.get(c.plan_family(a[0]), ""))\n' +
    '    elif f == "request": out.append(c.request_tool(a[0]))\n' +
    '    elif f == "child": out.append(c.child_pin_ok(a[0]))\n' +
    '    elif f == "skill": out.append(c.skill_pin_ok(a[0]))\n' +
    '    elif f == "pins": out.append(c.pins_ok(a[0]))\n' +
    '    elif f == "reg": out.append("why" not in c.check_registration(a[0], a[1], "0" * 64))\n' +
    'print(json.dumps(out))';
  const got = JSON.parse(cp.execFileSync(py, ['-I', '-c', script, path.dirname(CHECKER)], { encoding: 'utf8', input: JSON.stringify(cases) }));
  const js = ([f, a]) => {
    if (f === 'judge') { const r = PF.envelope.judge(...a); return [r.ok, r.ok ? '' : r.kind, r.ok ? '' : r.needs || '']; }
    if (f === 'family') return PF.plans.familyOf(a[0], 'x.json');
    if (f === 'request') { const c = PF.requests.claim(a[0]); return c ? c.name : null; }
    if (f === 'child') return PF.pins.childOk(a[0]);
    if (f === 'skill') return PF.pins.skillOk(a[0]);
    if (f === 'pins') return PF.pins.shapeOk(a[0]);
    if (f === 'reg') return !PF.skills.checkV2(a[1], a[0], '0'.repeat(64)).errors.length;
  };
  cases.forEach((c, i) => assert.deepStrictEqual(got[i], js(c), c[0] + ' ' + JSON.stringify(c[1])));
  assert.ok(got.filter(x => x === true).length >= 4, 'set-up: the plain cases pass: ' + JSON.stringify(got));
});

rule('The checker reports the same versions as unusable as the app, with the same reasons, and knows the same step types', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  // Its copy of the built-in step types matches the app's, as far as the check reads them.
  const known = JSON.parse(cp.execFileSync(py, ['-I', '-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import check_folder as c; print(json.dumps({"builtin": c.BUILTIN, "common": c.COMMON, "newer": c.NEWER, "format": c.PUBLICATION_FORMAT, "version": c.TYPES_VERSION}))', path.dirname(CHECKER)], { encoding: 'utf8' }));
  const plain = o => JSON.parse(JSON.stringify(o)), shape = d => plain({ fields: Object.fromEntries(Object.entries(d.fields || {}).map(([k, f]) => [k, f.options ? { kind: f.kind, options: f.options } : { kind: f.kind }])), record: (d.record || []).map(r => ({ name: r.name })) });
  assert.deepStrictEqual(known.builtin, Object.fromEntries(PF.types.LIST.map(t => [t.id, shape(t)])), 'built-in step types');
  assert.deepStrictEqual(known.common, shape({ fields: PF.types.COMMON }).fields, 'fields every step takes');
  assert.strictEqual(known.newer, PF.publish.NEWER); assert.strictEqual(known.version, PF.types.VERSION, 'step type version'); assert.strictEqual(known.format, PF.publish.FORMAT);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-unusable-'));
  const d = new DiskFS(root), U = PF.util, md = example('maps/drafts/check-in.md'), first = /^(- \[!\] \{run\.command\} Branch rebased.*)$/m;
  await d.write('people.json', JSON.stringify(people));
  const v1 = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW });
  assert.ok(!v1.blockers, String(v1.blockers));
  /* Each as a newer copy, a person or an assistant would leave it: every file matches its record. */
  const forge = async (n, text, edit) => {
    const folder = 'v' + n + '-forged' + n, base = 'publications/check-in/' + folder + '/';
    const types = JSON.parse(v1.files['types.json']), info = JSON.parse(v1.files['publication.json']);
    if (edit) edit(types, info);
    const tj = JSON.stringify(types);
    Object.assign(info, { version: n, folder, mapHash: U.hash(text), typesHash: U.hash(tj) });
    await d.write(base + 'map.md', text); await d.write(base + 'types.json', tj); await d.write(base + 'publication.json', JSON.stringify(info));
    return folder;
  };
  const bad = [
    await forge(2, md.replace(first, '$1\n  when: ^branch is release')),
    await forge(3, md.replace(first, '### If the branch is a release\n$1')),
    await forge(4, md.replace(first, '$1\n  choices: rebase, merge')),
    await forge(5, md, (t, info) => { info.format = 'preflight-publication/2'; }),
    await forge(6, md.replace('{confirm} No secrets', '{approve.change} No secrets')),
    await forge(7, md.replace('{confirm} No secrets', '{constructor} No secrets')),
    await forge(8, md.replace(/^## Before the pull request/m, '## Questions\n- Which branch?\n\n## Before the pull request')),
    await forge(9, md, t => { t.confirm = { id: 'confirm', fields: { where: null } }; }),
    await forge(10, md.replace(first, '$1\n  where: Your repository\n  require: build')),
    await forge(12, md, t => { t.confirm.version = 4; }), // 3 is 2.0 typed evidence; 4 is newer than any this copy reads
    await forge(13, md, t => { t.confirm.futureBehavior = 'conditional'; }),
    await forge(14, md, t => { t.confirm.fields.where.when = 'x'; }),
    await forge(15, md, t => { t.confirm.fields.where.kind = 'condition'; }),
    await forge(16, md, t => { t.confirm.record = [{ name: 'proof', label: 'Proof', kind: 'file' }]; }),
    await forge(17, md, t => { t.confirm.record = [{ name: 'proof', label: 'Proof', kind: 'url', skipWhen: 'x' }]; }),
    await forge(18, md, t => { t.confirm.fields = []; })
  ];
  const good = [await forge(20, md, t => { delete t.confirm; }), await forge(19, md, t => { t.confirm.version = PF.types.VERSION; }), await forge(11, md.replace('{confirm} No secrets', '{approve.change} No secrets'), t => { t['approve.change'] = { id: 'approve.change', label: 'Approve', fields: {}, record: [] }; })];

  const app = await repo.loadAll(d, { deep: true }), pubs = app.processes.find(p => p.process === 'check-in').pubs;
  const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' })).publications['check-in'];
  for (const folder of bad) {
    const mine = out.versions.find(v => v.folder === folder), theirs = pubs.find(p => p.folder === folder);
    assert.strictEqual(theirs.ok, false, folder + ': the app refuses it');
    assert.strictEqual(mine.status, 'unusable', folder + ': ' + mine.status + ' ' + mine.why);
    assert.strictEqual(mine.why, theirs.why, folder + ': same reason');
  }
  for (const folder of good.concat([v1.folder])) {
    assert.ok(pubs.find(p => p.folder === folder).ok, folder + ' runs in the app');
    assert.strictEqual(out.versions.find(v => v.folder === folder).status, 'complete', folder);
  }
  assert.strictEqual(out.current, app.processes.find(p => p.process === 'check-in').index.latest.folder, 'the same current version');
  assert.strictEqual(out.current, good[0], 'the newest runnable one');
  fs.rmSync(root, { recursive: true, force: true });
});


rule('A version that lists the corrections it includes (1.16) is complete for the checker and the app alike', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-check-'));
  const d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  const md = example('maps/drafts/release.md');
  const v1 = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, corrections: [{ id: 'g0123456789abcdef', result: { step: 'pods', sig: '0123abcd' } }, { id: 'gfedcba9876543210' }] });
  assert.ok(!v1.blockers, String(v1.blockers));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'publications', 'release', v1.folder, 'publication.json'), 'utf8')).corrections.length, 2);
  const app = await repo.loadAll(d, { deep: true });
  const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.ok(app.processes[0].pubs[0].ok, 'the app runs it');
  assert.strictEqual(out.publications.release.versions.find(v => v.folder === v1.folder).status, 'complete', 'the checker ignores the field');
  assert.strictEqual(out.publications.release.current, v1.folder);
  fs.rmSync(root, { recursive: true, force: true });
});

/* Each older release's own checker (test/compat-harness.js; docs/design.md section 28), on the folder that release wrote and on
   this version's, each with a preflight-publication/2 version beside v1: from 1.11.1 it calls that version unusable and keeps
   v1 current; before 1.11.1 it takes it as the current version (why the supported floor is 1.11.1). */
rule('Each older release\'s checker reads its own folder and this version\'s, and from 1.11.1 calls a /2 version unusable', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const H = require('./compat-harness'), G = require('../tools/old-folders');
  const main = await G.main(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-old-check-'));
  const put = (dir, files) => H.writeTree(dir, files);
  const withV2 = (files) => {
    const f = Object.assign({}, files), v1 = Object.keys(f).find(p => /publication\.json$/.test(p)).replace('publication.json', ''), v2 = v1.replace(/v1-[a-z0-9]+\/$/, 'v2-zzzz2222/');
    f[v2 + 'map.md'] = f[v1 + 'map.md']; Object.keys(f).filter(p => p.indexOf(v1 + 'images/') === 0).forEach(p => { f[v2 + p.slice(v1.length)] = f[p]; }); f[v2 + 'types.json'] = f[v1 + 'types.json'];
    f[v2 + 'publication.json'] = JSON.stringify(Object.assign(JSON.parse(f[v1 + 'publication.json']), { format: 'preflight-publication/2', features: ['typed-details'], version: 2, folder: 'v2-zzzz2222' }));
    return f;
  };
  try {
    for (const t of H.bundles.tags()) {
      const b = H.bundles.get(t.tag);
      if (!b) continue;
      const ck = path.join(root, t.tag + '.py'); fs.writeFileSync(ck, b.files['check_folder.py']);
      for (const [name, files] of [['own', H.readTree(path.join(G.DIR, t.tag))], ['this version', main]]) {
        const dir = path.join(root, t.tag + '-' + name.replace(' ', '-')); put(dir, withV2(files));
        const p = JSON.parse(cp.execFileSync(py, ['-I', ck, dir], { encoding: 'utf8' })).publications.backup;
        const st = {}; p.versions.forEach(v => { st[v.folder] = v.status; });
        const want = t.supported ? ['v1-ab9ysnqh', 'complete', 'unusable'] : ['v2-zzzz2222', 'complete', 'complete'];
        assert.deepStrictEqual([p.current, st['v1-ab9ysnqh'], st['v2-zzzz2222']], want, t.tag + ' on ' + name);
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The assistants\' folder checker agrees with the app on OneDrive copies of a plan and on a plan started twice', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-check-'));
  const d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  await repo.publish(d, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW });
  const plan = (id, extra) => JSON.stringify(Object.assign({ kind: 'plan', id, process: 'release', version: 1, title: 'Requested', details: {}, roles: {}, note: 'Requested by ci-check.', by: 'ci-check 1.4.0 (a tool)', created: NOW }, extra || {}), null, 2) + '\n';
  const A = 'req-ci-check-' + 'a'.repeat(24), B = 'req-ci-check-' + 'b'.repeat(24), C = 'req-ci-check-' + 'c'.repeat(24);
  // The same request twice (another computer's own time), a request whose copies differ, and a plan started on two computers.
  await d.write('proposals/' + A + '.json', plan(A));
  await d.write('proposals/' + A + '-LAPTOP.json', plan(A, { created: '2026-10-18T08:00:00.000Z' }));
  await d.write('proposals/' + B + '.json', plan(B));
  await d.write('proposals/' + B + '-LAPTOP.json', plan(B, { title: 'Other' }));
  await d.write('proposals/' + C + '.json', plan(C));
  let app = await repo.loadAll(d, { deep: true });
  const c = app.plans.find(p => p.id === C);
  await repo.recordPlanStatus(d, c, 'w1', 'accepted', 'run1', 'person-casey');
  await repo.recordPlanStatus(d, c, 'w2', 'accepted', 'run2', 'person-blake');
  // The LAPTOP copy of A was started: the start counts for the request.
  await repo.recordPlanStatus(d, Object.assign({}, app.plans.find(p => p.id === A), { _hash: PF.util.hash(JSON.stringify(JSON.parse(plan(A, { created: '2026-10-18T08:00:00.000Z' })))) }), 'w3', 'accepted', 'run3', 'person-casey');
  app = await repo.loadAll(d, { deep: true });
  const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  const py1 = (id) => out.plans.filter(p => p.id === id);
  const a = app.plans.filter(p => p.id === A);
  assert.strictEqual(a.length, 1); assert.ok(a[0]._status && a[0]._status.run === 'run3');
  assert.deepStrictEqual(py1(A).map(p => [p.file, p.status]), [[A + '.json', 'decided']]);
  assert.ok(app.plans.filter(p => p.id === B).every(p => p._copiesDiffer));
  assert.deepStrictEqual(py1(B).map(p => p.status), ['ambiguous']);
  assert.ok(/different copies/.test(py1(B)[0].why));
  assert.strictEqual(app.plans.find(p => p.id === C)._conflicting, true);
  assert.deepStrictEqual(py1(C).map(p => p.status), ['ambiguous']);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ---------- The format envelope, mirrored (2.0 plan, slice 1b) ---------- */
rule('The checker\'s envelope verdict agrees with PF.envelope.judge on every 2.0 sample and probe it reads, and names a newer version in the app\'s words', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const S = require('../tools/v2-samples'), H = require('./compat-harness'), G = require('../tools/old-folders');
  const objs = [];
  ['folder', 'probes/major', 'probes/feature'].forEach(w => Object.entries(S.tree(w)).forEach(([p, t]) => {
    const fam = PF.envelope.familyOfPath(p);
    if ((fam === 'preflight-publication' || fam === 'flightdeck-step-type') && !/types\.json$/.test(p)) objs.push([fam, JSON.parse(t)]);
  }));
  objs.push(['preflight-publication', { format: 'preflight-publication/1' }], ['flightdeck-step-type', { id: 'x' }], ['preflight-publication', { format: 'preflight-run/2' }], ['preflight-publication', { format: 'acme/1', app: '3.2.1' }], ['preflight-publication', null]);
  const out = JSON.parse(cp.execFileSync(py, ['-I', '-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import check_folder as c; print(json.dumps([c.judge(f, o) for f, o in json.loads(sys.stdin.read())]))', path.dirname(CHECKER)], { encoding: 'utf8', input: JSON.stringify(objs) }));
  objs.forEach(([f, o], i) => {
    const js = PF.envelope.judge(f, o);
    assert.deepStrictEqual([out[i].ok, out[i].ok ? '' : out[i].kind, out[i].ok ? '' : out[i].needs], [js.ok, js.ok ? '' : js.kind, js.ok ? '' : js.needs || ''], f + ' ' + JSON.stringify(o).slice(0, 100));
  });
  assert.deepStrictEqual(JSON.parse(cp.execFileSync(py, ['-I', '-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import check_folder as c; print(json.dumps([c.FROZEN, c.FAMILY_NAMES]))', path.dirname(CHECKER)], { encoding: 'utf8' })), JSON.parse(JSON.stringify([PF.envelope.FROZEN, Object.keys(PF.envelope.FAMILIES)])));
  // On a folder with every 2.0 sample: since slice 3 the typed /2 version is complete and current in both, and the 2.0 step
  // type is read; a step type from a later major is still named in the app's words.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-env-'));
  try {
    const files = Object.assign(H.readTree(path.join(G.DIR, 'v1.18.0')), S.tree('folder'));
    files['step-types/team.later.json'] = JSON.stringify(Object.assign(JSON.parse(files['step-types/team.count.json']), { id: 'team.later', format: 'flightdeck-step-type/3', app: '2.1.0' }));
    H.writeTree(root, files);
    const res = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    const v2 = res.publications.backup.versions.find(v => v.folder === S.PUB2);
    const app = await repo.loadAll(new DiskFS(root)), appV2 = app.processes.find(p => p.process === 'backup').pubs.find(x => x.folder === S.PUB2);
    assert.ok(appV2.ok, appV2.why);
    assert.strictEqual(v2.status, 'complete', v2.why);
    assert.strictEqual(res.publications.backup.current, S.PUB2);
    const st = JSON.stringify(res).indexOf('This step type needs Flightdeck 2.1. This copy shows it but can\'t use or change it.') >= 0;
    assert.ok(st, 'the later step type is named: ' + JSON.stringify(res.teamFiles || res).slice(0, 400));
    assert.ok(res.teamFiles.stepTypes.indexOf('team.count') >= 0, 'the 2.0 step type is read');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker agrees with the app on plans, plan decisions, versions and step types in folders with every 2.0 sample and every probe', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const S = require('../tools/v2-samples'), H = require('./compat-harness'), G = require('../tools/old-folders');
  for (const [label, extra] of [['samples', S.tree('folder')], ['major probes', S.tree('probes/major')], ['feature probes', S.tree('probes/feature')]]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-parity-'));
    try {
      const files = Object.assign(H.readTree(path.join(G.DIR, 'v1.18.0')), extra);
      // A plan whose only decision has a feature this copy doesn't know: the app refuses the decision, and it holds the plan
      // (it may have been started), so the plan is never pending.
      const may = { kind: 'plan', id: 'plan-backup-may', process: 'backup', version: 1, title: 'Backup check May', by: 'person-avery', created: NOW };
      files['proposals/plan-backup-may.json'] = JSON.stringify(may);
      files['proposals/plan-backup-may.status-w-feat.json'] = JSON.stringify({ kind: 'status', proposal: 'plan-backup-may', proposalHash: PF.util.hash(JSON.stringify(may)), status: 'declined', run: null, by: 'person-avery', at: NOW, features: ['from-the-future'] });
      // And a plan with an unknown feature: refused by the app, never pending.
      files['proposals/plan-backup-june.json'] = JSON.stringify(Object.assign({}, may, { id: 'plan-backup-june', features: ['from-the-future'] }));
      H.writeTree(root, files);
      const res = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
      const d = await repo.loadAll(new DiskFS(root), { deep: true });
      const app = {}; d.plans.forEach(p => { app[p.id] = p._status ? 'decided' : (p._conflicting || p._changedAfterDecision || p._copiesDiffer || (p._statusHeld || []).length) ? 'ambiguous' : 'pending'; });
      const mine = {}; res.plans.filter(p => p.status !== 'newer').forEach(p => { mine[p.id] = p.status; });
      assert.deepStrictEqual(mine, app, label + ': plans and their state');
      assert.strictEqual(app['plan-backup-may'], 'ambiguous', 'set-up: the app refuses the decision and holds the plan');
      assert.ok(!('plan-backup-june' in app), 'set-up: the app refuses the plan');
      const refusedApp = JSON.parse(JSON.stringify(d.refused)).filter(r => /^proposals\//.test(r.path)).map(r => r.path).sort();
      const refusedMine = (res.refused || []).filter(r => /^proposals\//.test(r.file)).map(r => r.file).sort();
      assert.deepStrictEqual(refusedMine, refusedApp, label + ': plans and decisions from a newer Flightdeck');
      const pubs = {}; d.processes.forEach(p => (p.pubs || []).forEach(x => { pubs[p.process + '/' + x.folder] = x.ok ? 'complete' : x.unusable ? 'unusable' : 'other'; }));
      Object.keys(res.publications).forEach(proc => res.publications[proc].versions.forEach(v => {
        const a = pubs[proc + '/' + v.folder];
        if (a === 'complete' || a === 'unusable' || v.status === 'complete' || v.status === 'unusable') assert.strictEqual(v.status, a, label + ': ' + proc + '/' + v.folder + ' ' + v.why);
      }));
      const typeRefused = JSON.parse(JSON.stringify(d.refused)).filter(r => /^step-types\//.test(r.path)).map(r => r.path).sort();
      assert.deepStrictEqual(res.teamFiles.problems.filter(p => /needs (Flightdeck|a newer)/.test(p.problem)).map(p => p.file).sort(), typeRefused, label + ': step types');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

/* Slice 2 part 1: a real 2.0 version (phase notes, phase and gate screenshots: preflight-publication/2 with its payload) is
   complete for both; one whose payload doesn't match its files is damaged for both; one whose payload pins another version
   (a later slice) is unusable for both, in the same words. */
rule('The checker reads a 2.0 version with phase notes and phase and gate screenshots like the app: complete, checked by its payload', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-v2-'));
  try {
    const d = new DiskFS(root);
    await d.write('people.json', JSON.stringify(people));
    await d.write('images/x/scratch.png', new Blob([Buffer.from([1, 2, 3, 4])], { type: 'image/png' }));
    await d.write('images/x/counts.png', new Blob([Buffer.from([5, 6, 7, 8, 9])], { type: 'image/png' }));
    const md = '---\nprocess: x\ntitle: X\n---\n## P {#p}\n  > Use the scratch server.\n  ![The scratch server](images/x/scratch.png)\n- [ ] {confirm} Look {#a}\n\n## Gate: Ready {#ready}\n  > Counts match.\n  ![Counts](images/x/counts.png)\n';
    const v = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.0.0' });
    assert.ok(!v.blockers, String(v.blockers));
    const base = 'publications/x/' + v.folder + '/', info = JSON.parse(fs.readFileSync(path.join(root, ...base.split('/'), 'publication.json'), 'utf8'));
    assert.strictEqual(info.format, 'preflight-publication/2', 'set-up');
    const copy = async (n, edit) => {
      const folder = 'v' + n + '-copy000' + n, dst = 'publications/x/' + folder + '/', i = JSON.parse(JSON.stringify(info));
      Object.assign(i, { version: n, folder }); edit(i);
      for (const f of ['map.md', 'types.json', 'images/x/scratch.png', 'images/x/counts.png']) { fs.mkdirSync(path.dirname(path.join(root, ...(dst + f).split('/'))), { recursive: true }); fs.copyFileSync(path.join(root, ...(base + f).split('/')), path.join(root, ...(dst + f).split('/'))); }
      await d.write(dst + 'publication.json', JSON.stringify(i, null, 2));
      return folder;
    };
    const mapOff = await copy(2, i => { i.payload.map = 'a'.repeat(64); });
    const shotOff = await copy(3, i => { i.payload.images['images/x/counts.png'] = 'b'.repeat(64); });
    const pinned = await copy(4, i => { i.payload.pins.children.verify = { process: 'verify', version: 4, folder: 'v4-cccc4444', mapHash: 'aaaa0001', typesHash: 'aaaa0002' }; });
    const later = await copy(5, i => { i.features = ['phase-notes', 'typed-details']; });
    const unlisted = await copy(6, i => { delete i.images['images/x/counts.png']; delete i.payload.images['images/x/counts.png']; });
    /* A byte-order mark the checker's text reading drops: the exact bytes no longer match the payload. */
    const bom = await copy(7, () => {});
    const bomPath = path.join(root, 'publications', 'x', bom, 'map.md');
    fs.writeFileSync(bomPath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), fs.readFileSync(bomPath)]));
    const app = await repo.loadAll(d, { deep: true }), pubs = app.processes.find(p => p.process === 'x').pubs;
    const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' })).publications.x;
    const mine = f => out.versions.find(x => x.folder === f), theirs = f => pubs.find(x => x.folder === f);
    assert.ok(theirs(v.folder).ok, theirs(v.folder).why);
    assert.strictEqual(mine(v.folder).status, 'complete', mine(v.folder).why);
    assert.strictEqual(mine(bom).status, 'damaged', 'a byte-order mark: ' + mine(bom).why);
    for (const f of [mapOff, shotOff]) { assert.ok(!theirs(f).ok && !theirs(f).unusable, f); assert.strictEqual(mine(f).status, 'damaged', f + ': ' + mine(f).why); }
    for (const f of [pinned, later, unlisted]) { assert.ok(!theirs(f).ok && theirs(f).unusable, f); assert.strictEqual(mine(f).status, 'unusable', f); assert.strictEqual(mine(f).why, theirs(f).why, f + ': same words'); }
    assert.strictEqual(out.current, v.folder);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/* Slice 2 part 2: a version with pins (version: on a linked step, skillVersion: on a skill step) is complete for both, and a
   plan/2 with its decisions is read like the app reads it (a switch to another version is not a decision). */
rule('The checker reads a 2.0 version with pins and a plan/2 like the app', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-pins-'));
  try {
    const d = new DiskFS(root);
    await d.write('people.json', JSON.stringify(people));
    const kid = await repo.publish(d, '---\nprocess: verify\ntitle: Verify\n---\n## P {#p}\n- [ ] {confirm} Look {#a}\n', { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.0.0' });
    assert.ok(!kid.blockers, String(kid.blockers));
    const md = '---\nprocess: x\ntitle: X\n---\n## P {#p}\n- [ ] {run.process} Verify it {#v}\n  process: verify\n  version: 1\n- [ ] {run.skill} Notes {#n}\n  skill: release-notes\n  skillVersion: 1.2.0\n';
    const v = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.0.0' });
    assert.ok(!v.blockers, String(v.blockers));
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'publications', 'x', v.folder, 'publication.json'), 'utf8')).payload.pins.children), ['v'], 'set-up: pinned');
    const plan = PF.plans.make({ info: JSON.parse(v.files['publication.json']) }, { id: 'plan-x-a', process: 'x', title: 'X', details: {}, roles: {}, by: 'person-avery', created: NOW }, false, '2.0.0');
    await d.write('proposals/plan-x-a.json', JSON.stringify(plan, null, 2));
    const loaded = await repo.loadAll(d, { deep: true }), p0 = loaded.plans.find(p => p.id === 'plan-x-a');
    await repo.recordPlanStatus(d, p0, 'w1', 'retargeted', null, 'person-casey', { folder: v.folder, version: 1 }, '2.0.0');
    const app = await repo.loadAll(d, { deep: true }), out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    const theirs = app.processes.find(p => p.process === 'x').pubs.find(x => x.folder === v.folder), mine = out.publications.x.versions.find(x => x.folder === v.folder);
    assert.ok(theirs.ok, theirs.why); assert.strictEqual(mine.status, 'complete', mine.why);
    const ap = app.plans.find(p => p.id === 'plan-x-a');
    assert.ok(ap && !ap._status && ap._retarget, 'the app reads the plan/2 and its switch');
    assert.deepStrictEqual(out.plans.filter(p => p.id === 'plan-x-a').map(p => p.status), ['pending']);
    assert.deepStrictEqual((out.refused || []).filter(r => /^proposals\//.test(r.file)), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker matches skill registrations like the app: one with any revision this copy can\'t read (newer, malformed, unreadable) can\'t be matched, never an older revision', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-skreg-'));
  try {
    const d = new DiskFS(root);
    await d.write('people.json', JSON.stringify(people));
    const v = await repo.publish(d, '---\nprocess: verify\ntitle: Verify\n---\n## P {#p}\n- [ ] {confirm} Look {#a}\n', { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.0.0' });
    assert.ok(!v.blockers, String(v.blockers));
    const loaded = await repo.loadAll(d, { deep: true }), pr = loaded.processes.find(p => p.process === 'verify'), proc = { latest: pr.index.latest, all: pr.index.all, clashes: pr.index.clashes, broken: [] };
    const write = async (name, rand, extra) => {
      const g = PF.skills.registration({ name, version: '1.0.0', location: 'here', implements: { process: 'verify', folder: v.folder } }, proc, null, { app: '2.0.0', now: NOW, by: 'person-avery', window: 'w-one', rand });
      assert.ok(g.rec, g.why); await d.write(g.path, JSON.stringify(g.rec, null, 2) + '\n');
      if (extra) await d.write(g.path.replace('.1.w-one.json', '.2.w-two.json'), extra(g.rec));
      return g;
    };
    await write('fine', 'aaaa1111');
    await write('newer', 'bbbb2222', (o) => JSON.stringify(Object.assign({}, o, { format: 'flightdeck-skill/3', rev: 2, seen: 1 })));
    await write('broken', 'cccc3333', () => '{ not json');
    await write('odd', 'dddd4444', (o) => JSON.stringify(Object.assign({}, o, { rev: 2, seen: 1, implements: 'verify@1' })));
    const app = await repo.loadAll(d, { deep: true }), out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    const appSays = (n) => { const l = app.skills.filter(x => (x.skill && x.skill.name === n) || (x.file || '').indexOf('skill-registrations/' + n + '/') === 0); return l.length && l.every(x => x.unmatched) ? 'unmatched' : 'current'; };
    const pySays = (n) => { const x = (out.skills || []).find(s => s.name === n); return x ? x.status : 'absent'; };
    ['fine', 'newer', 'broken', 'odd'].forEach(n => assert.strictEqual(pySays(n), appSays(n), n + ': ' + JSON.stringify(out.skills)));
    assert.deepStrictEqual(['fine', 'newer', 'broken', 'odd'].map(pySays), ['current', 'unmatched', 'unmatched', 'unmatched']);
    assert.ok(/newer Flightdeck/.test(out.skills.find(s => s.name === 'newer').why), out.skills.find(s => s.name === 'newer').why);
    assert.strictEqual(out.skills.find(s => s.name === 'fine').rev, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker refuses a version whose step screenshot its record (and a /2 version\'s payload) doesn\'t list, like the app, /1 and /2', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-stepshot-'));
  try {
    const d = new DiskFS(root);
    await d.write('people.json', JSON.stringify(people));
    await d.write('images/x/job.png', new Blob([Buffer.from([1, 2, 3, 4])], { type: 'image/png' }));
    await d.write('images/x/scratch.png', new Blob([Buffer.from([5, 6, 7])], { type: 'image/png' }));
    const one = '---\nprocess: x\ntitle: X\n---\n## P {#p}\n- [ ] {confirm} Look {#a}\n  ![The job page](images/x/job.png)\n';
    const two = one.replace('## P {#p}\n', '## P {#p}\n  > Use the scratch server.\n  ![The scratch server](images/x/scratch.png)\n');
    const v1 = await repo.publish(d, one, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW });
    const v2 = await repo.publish(d, two, { people, ...EX, by: 'person-avery', changes: 'x', existing: [{ version: 1 }], now: NOW, app: '2.0.0' });
    for (const v of [v1, v2]) {
      const p = path.join(root, 'publications', 'x', v.folder, 'publication.json'), i = JSON.parse(fs.readFileSync(p, 'utf8'));
      delete i.images['images/x/job.png']; if (i.payload) delete i.payload.images['images/x/job.png'];
      fs.writeFileSync(p, JSON.stringify(i, null, 2));
    }
    const app = await repo.loadAll(d, { deep: true }), pubs = app.processes.find(p => p.process === 'x').pubs;
    const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' })).publications.x;
    for (const v of [v1, v2]) {
      const theirs = pubs.find(x => x.folder === v.folder), mine = out.versions.find(x => x.folder === v.folder);
      assert.ok(!theirs.ok && theirs.unusable, v.folder + ': the app refuses it');
      assert.strictEqual(mine.status, 'unusable', v.folder + ': ' + mine.status + ' ' + mine.why);
      assert.strictEqual(mine.why, theirs.why, v.folder + ': same words');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


/* Slice 3: typed run details and typed evidence. Every hand-edited typed version the app refuses, the checker refuses with
   the same words; the good one is complete for both; team step-type files are judged alike. */
rule('The checker agrees with the app on typed run details and typed evidence: declarations, features listed, frozen definitions', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-typed-'));
  try {
    const d = new DiskFS(root), T = PF.types, U = PF.util, sha = (t) => require('crypto').createHash('sha256').update(t, 'utf8').digest('hex');
    const TYPE2 = { format: 'flightdeck-step-type/2', features: ['typed-evidence'], app: '2.0.0', id: 'team.count', label: 'Count rows', icon: 'doc', hint: 'Counts the rows.', fields: {}, record: [{ name: 'rows', label: 'Rows', kind: 'number', min: '0' }, { name: 'matches', label: 'Matches', kind: 'yes-no' }] };
    await d.write('people.json', JSON.stringify(people));
    await d.write('step-types/team.count.json', JSON.stringify(TYPE2, null, 2));
    await d.write('step-types/team.plain-number.json', JSON.stringify({ id: 'team.plain-number', label: 'Plain', fields: {}, record: [{ name: 'n', label: 'N', kind: 'number' }] }));
    await d.write('step-types/team.clash.json', JSON.stringify(Object.assign({}, TYPE2, { id: 'team.clash', record: [{ name: 'env', label: 'Env', kind: 'choice', options: ['Prod', 'prod'] }] })));
    await d.write('step-types/team.newer.json', JSON.stringify(Object.assign({}, TYPE2, { id: 'team.newer', format: 'flightdeck-step-type/3' })));
    const md = '---\nprocess: x\ntitle: X\ncontext: ticket, rows:number, due:date, ok:yes-no, env:choice(dev|prod), runbook:link\n---\n## P {#p}\n- [ ] {team.count} Count ^rows {#count}\n- [ ] {confirm} Note the day ^due {#day}\n  evidence: date\n\n## Gate: Ready {#ready}\n  approves: ^ok\n';
    const v = await repo.publish(d, md, { people, ...EX, customTypes: Object.assign({}, EX.customTypes, { 'team.count': T.customType(TYPE2) }), by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.0.0' });
    assert.ok(!v.blockers, String(v.blockers));
    const base = 'publications/x/' + v.folder + '/', info = JSON.parse(fs.readFileSync(path.join(root, ...base.split('/'), 'publication.json'), 'utf8')), types0 = fs.readFileSync(path.join(root, ...base.split('/'), 'types.json'), 'utf8');
    assert.strictEqual(info.format, 'preflight-publication/2', 'set-up');
    /* A version as a person or an assistant would leave it: every file matches its record and payload. */
    const forge = async (n, text, editTypes, editInfo) => {
      const folder = 'v' + n + '-typed00' + n, dst = 'publications/x/' + folder + '/', i = JSON.parse(JSON.stringify(info)), t = JSON.parse(types0);
      if (editTypes) editTypes(t);
      const tj = JSON.stringify(t, null, 2);
      Object.assign(i, { version: n, folder, mapHash: U.hash(text), typesHash: U.hash(tj) }); i.payload.map = sha(text); i.payload.types = sha(tj);
      if (editInfo) editInfo(i);
      await d.write(dst + 'map.md', text); await d.write(dst + 'types.json', tj); await d.write(dst + 'publication.json', JSON.stringify(i, null, 2));
      return folder;
    };
    const ctx = (c) => md.replace('context: ticket, rows:number, due:date, ok:yes-no, env:choice(dev|prod), runbook:link', 'context: ' + c);
    const bad = [
      await forge(2, md, null, (i) => { i.features = ['typed-evidence']; }),
      await forge(3, md, null, (i) => { i.features = ['typed-details']; }),
      await forge(4, ctx('ticket, rows:money, due:date, ok:yes-no, env:choice(dev|prod), runbook:link')),
      await forge(5, ctx('ticket, rows:number, rows:date, due:date, ok:yes-no, env:choice(dev|prod), runbook:link')),
      await forge(6, ctx('ticket, rows:text, due:date, ok:yes-no, env:choice(dev|prod), runbook:link')),
      await forge(7, ctx('ticket, rows:number, due:date, ok:yes-no, env:choice(dev|Dev), runbook:link')),
      await forge(8, ctx('ticket, rows:number, due:date, ok:yes-no, env:choice(dev), runbook:link')),
      await forge(9, md, (t) => { t['team.count'].version = 2; }),
      await forge(10, md, (t) => { t['team.count'].record[0].min = 'abc'; }),
      await forge(11, md, (t) => { t['team.count'].record[0].min = '5'; t['team.count'].record[0].max = '1'; }),
      await forge(12, md, (t) => { t['team.count'].record[1].unit = 'rows'; }),
      await forge(13, md, (t) => { t['team.count'].version = 4; })
    ];
    const good = [await forge(14, md)];
    const app = await repo.loadAll(d, { deep: true }), pubs = app.processes.find(p => p.process === 'x').pubs;
    const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    const ver = out.publications.x;
    for (const folder of bad) {
      const mine = ver.versions.find(x => x.folder === folder), theirs = pubs.find(p => p.folder === folder);
      assert.ok(!theirs.ok && theirs.unusable, folder + ': the app refuses it as unusable: ' + theirs.why);
      assert.strictEqual(mine.status, 'unusable', folder + ': ' + mine.status + ' ' + mine.why);
      assert.strictEqual(mine.why, theirs.why, folder + ': same reason');
    }
    for (const folder of good.concat([v.folder])) {
      assert.ok(pubs.find(p => p.folder === folder).ok, folder + ' runs in the app');
      assert.strictEqual(ver.versions.find(x => x.folder === folder).status, 'complete', folder);
    }
    /* Team step types (the checker's basic checks): the 2.0 file is a type it lists; a newer major is named, as the app names it. */
    const tf = out.teamFiles;
    assert.ok(tf.stepTypes.indexOf('team.count') >= 0, JSON.stringify(tf));
    assert.ok(tf.problems.some(p => p.file === 'step-types/team.newer.json' && /needs a newer Flightdeck|needs Flightdeck/.test(p.problem)), JSON.stringify(tf.problems));
    assert.ok(!tf.problems.some(p => p.file === 'step-types/team.count.json'), 'the 2.0 file is no problem');
    const appTypes = app.stepTypes || {};
    assert.ok(JSON.stringify(appTypes).indexOf('team.newer') >= 0, 'the app names it too');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker reads conditions (2.1) like the app: the same parse errors, the conditions feature listed, a conditional version complete', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-cond-'));
  try {
    const d = new DiskFS(root), U = PF.util, sha = (t) => require('crypto').createHash('sha256').update(t, 'utf8').digest('hex');
    await d.write('people.json', JSON.stringify(people));
    const md = '---\nprocess: x\ntitle: X\ncontext: ticket, risk:choice(low|high), hot:yes-no, amount:number, due:date, path:choice(slow|fast), runbook:link\n---\n## Decide {#decide}\n- [ ] {confirm} Pick the path {#pick}\n  sets: path\n\n## Release {#rel}\n  only when ^hot is not no\n- [ ] {confirm} Tell the board {#board}\n  only when ^risk is one of HIGH | low\n- [ ] {confirm} Finance {#fin}\n  only when ^amount is at least 010.50\n  only when ^due is at most 2026-12-31\n- [ ] {confirm} Fast {#fast}\n  only when ^path is fast\n- [ ] {confirm} Link {#ln}\n  only when ^runbook is set\n\n## Gate: Ready {#ready}\n';
    const v = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.1.0' });
    assert.ok(!v.blockers, String(v.blockers));
    const base = 'publications/x/' + v.folder + '/', info = JSON.parse(fs.readFileSync(path.join(root, ...base.split('/'), 'publication.json'), 'utf8')), types0 = fs.readFileSync(path.join(root, ...base.split('/'), 'types.json'), 'utf8');
    assert.ok(info.features.indexOf('conditions') >= 0, 'set-up');
    const forge = async (n, text, editInfo) => {
      const folder = 'v' + n + '-cond000' + n, dst = 'publications/x/' + folder + '/', i = JSON.parse(JSON.stringify(info));
      Object.assign(i, { version: n, folder, mapHash: U.hash(text), typesHash: U.hash(types0) }); i.payload.map = sha(text); i.payload.types = sha(types0);
      if (editInfo) editInfo(i);
      await d.write(dst + 'map.md', text); await d.write(dst + 'types.json', types0); await d.write(dst + 'publication.json', JSON.stringify(i, null, 2));
      return folder;
    };
    const swap = (a, b) => { assert.ok(md.indexOf(a) >= 0, a); return md.replace(a, b); };
    const bad = [
      await forge(2, md, (i) => { i.features = i.features.filter(f => f !== 'conditions'); }),
      await forge(3, swap('## Gate: Ready {#ready}\n', '## Gate: Ready {#ready}\n  only when ^hot is yes\n')),
      await forge(4, swap('only when ^hot is not no', 'only when ^nope is yes')),
      await forge(5, swap('only when ^runbook is set', 'only when ^runbook is https://x.test')),
      await forge(6, swap('only when ^risk is one of HIGH | low', 'only when ^risk is one of high')),
      await forge(7, swap('only when ^risk is one of HIGH | low', 'only when ^risk is one of high | | low')),
      await forge(8, swap('only when ^risk is one of HIGH | low', 'only when ^risk is one of high | High')),
      await forge(9, swap('only when ^amount is at least 010.50', 'only when ^amount is at least ten')),
      await forge(10, swap('only when ^hot is not no', 'only when ^hot is maybe')),
      await forge(11, swap('## Decide {#decide}\n', '## Decide {#decide}\n  only when ^path is fast\n')),
      await forge(12, swap('only when ^hot is not no', 'only when hot is yes')),
      await forge(13, swap('only when ^due is at most 2026-12-31', 'only when ^due is at most 2026-02-30')),
      await forge(14, swap('only when ^path is fast', 'only when ^path is fast\n  only when ^hot is yes\n  only when ^risk is high\n  only when ^amount is set\n  only when ^due is set')),
      await forge(15, swap('- [ ] {confirm} Pick the path {#pick}\n', '- [ ] {confirm} Pick the path {#pick}\n  only when ^ticket is one of a | b\n')),
      await forge(16, swap('## Decide {#decide}\n', '## Decide {#decide}\n\nonly when ^hot is yes\n')),
      await forge(18, swap('only when ^hot is not no', 'only when ^hot is\u0085no')),
      await forge(19, swap('only when ^amount is at least 010.50', 'only when ^amount is at least\u001c10')),
      await forge(22, swap('only when ^amount is at least 010.50', 'only when ^amount is at lea\u017ft 10'))
    ];
    const good = [await forge(17, md), await forge(20, swap('only when ^hot is not no', 'only when ^hot is\ufeffnot\u3000no')), await forge(21, swap('  only when ^runbook is set', '\u00a0 only when ^runbook is set')), await forge(23, swap('  only when ^runbook is set', '  ONLY When ^runbook is SET'))];
    const app = await repo.loadAll(d, { deep: true }), pubs = app.processes.find(p => p.process === 'x').pubs;
    const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    const ver = out.publications.x;
    for (const folder of bad) {
      const mine = ver.versions.find(x => x.folder === folder), theirs = pubs.find(p => p.folder === folder);
      assert.ok(!theirs.ok && theirs.unusable, folder + ': the app refuses it as unusable: ' + theirs.why);
      assert.strictEqual(mine.status, 'unusable', folder + ': ' + mine.status + ' ' + mine.why);
      assert.strictEqual(mine.why, theirs.why, folder + ': same reason');
    }
    for (const folder of good.concat([v.folder])) {
      assert.ok(pubs.find(p => p.folder === folder).ok, folder + ' runs in the app');
      assert.strictEqual(ver.versions.find(x => x.folder === folder).status, 'complete', folder);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker reads pass: (2.8) and team: (2.9) like the app: the same errors, the passed-details and team-values features listed, a version with them complete', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-pass-'));
  try {
    const d = new DiskFS(root), U = PF.util, sha = (t) => require('crypto').createHash('sha256').update(t, 'utf8').digest('hex');
    await d.write('people.json', JSON.stringify(people));
    const md = '---\nprocess: x\ntitle: X\ncontext: env, tag\n---\n## Ship {#ship}\n- [ ] {run.process} Deploy {#dep}\n  process: deploy\n  pass: environment=^env, region=us-east-1, notify=?\n\n## Gate: Ready {#ready}\n';
    const v = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.8.0' });
    assert.ok(!v.blockers, String(v.blockers));
    const base = 'publications/x/' + v.folder + '/', info = JSON.parse(fs.readFileSync(path.join(root, ...base.split('/'), 'publication.json'), 'utf8')), types0 = fs.readFileSync(path.join(root, ...base.split('/'), 'types.json'), 'utf8');
    assert.deepStrictEqual(info.features, ['passed-details']);
    const forge = async (n, text, editInfo) => {
      const folder = 'v' + n + '-pass000' + n, dst = 'publications/x/' + folder + '/', i = JSON.parse(JSON.stringify(info));
      Object.assign(i, { version: n, folder, mapHash: U.hash(text), typesHash: U.hash(types0) }); i.payload.map = sha(text); i.payload.types = sha(types0);
      if (editInfo) editInfo(i);
      await d.write(dst + 'map.md', text); await d.write(dst + 'types.json', types0); await d.write(dst + 'publication.json', JSON.stringify(i, null, 2));
      return folder;
    };
    const swap = (b) => md.replace('environment=^env, region=us-east-1, notify=?', b);
    const bad = [
      await forge(2, md, (i) => { i.features = []; }),
      await forge(3, swap('environment=^env,, x=?')), await forge(4, swap('environment')), await forge(5, swap('=^env')), await forge(6, swap('a b=^env')),
      await forge(7, swap('constructor=^env')), await forge(8, swap('a=^env, a=?')), await forge(9, swap('a=')), await forge(10, swap('a=^')), await forge(11, swap('a=x^y')),
      await forge(12, swap('a=team:Bad_Name')), await forge(13, swap('a=x\u0001y')), await forge(14, swap('a=' + 'é'.repeat(121))),
      await forge(15, swap(Array.from({ length: 41 }, (_, k) => 'd' + k + '=?').join(', '))), await forge(16, swap('a=^toString')),
      await forge(21, swap('a=TEAM:base')), await forge(22, swap('a=team:')), await forge(23, swap('base=team:bitbucket-base-url'))
    ];
    const good = [await forge(17, md), await forge(18, swap('a=' + 'é'.repeat(120))), await forge(19, swap('')), await forge(20, swap(' a = ^tag ,b=?')),
      await forge(24, swap('base=team:bitbucket-base-url, env=^env'), (i) => { i.features = ['passed-details', 'team-values']; })];
    const app = await repo.loadAll(d, { deep: true }), pubs = app.processes.find(p => p.process === 'x').pubs;
    const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    const ver = out.publications.x;
    for (const folder of bad) {
      const mine = ver.versions.find(x => x.folder === folder), theirs = pubs.find(p => p.folder === folder);
      assert.ok(!theirs.ok && theirs.unusable, folder + ': the app refuses it as unusable: ' + theirs.why);
      assert.strictEqual(mine.status, 'unusable', folder + ': ' + mine.status + ' ' + mine.why);
      assert.strictEqual(mine.why, theirs.why, folder + ': same reason');
    }
    for (const folder of good.concat([v.folder])) {
      assert.ok(pubs.find(p => p.folder === folder).ok, folder + ' runs in the app: ' + pubs.find(p => p.folder === folder).why);
      assert.strictEqual(ver.versions.find(x => x.folder === folder).status, 'complete', folder);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker reads team-values.json (2.9) like the app: the same state and reason for each file, too large is unreadable, and steps passing a value it lacks are named', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-team-'));
  try {
    const d = new DiskFS(root), T = PF.teamValues, doc = (values, extra) => JSON.stringify(Object.assign({ format: T.FORMAT, values }, extra || {}));
    const check = () => JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    await d.write('people.json', JSON.stringify(people));
    const specimens = [
      ['ok', doc({ 'bitbucket-base-url': { value: 'https://b.example.com', about: 'Base' } })], ['bad JSON', '{'], ['no format', JSON.stringify({ values: {} })],
      ['another family', JSON.stringify({ format: 'flightdeck-people/1', values: {} })], ['newer major', JSON.stringify({ format: 'flightdeck-team-values/9', values: {} })],
      ['newer feature', doc({}, { features: ['folder-values'] })], ['values a list', doc([])], ['bad name', doc({ Bad: { value: 'x' } })],
      ['proto name', doc({ constructor: { value: 'x' } })], ['name ends in a newline', doc({ 'a\n': { value: 'x' } })], ['not an entry', doc({ a: 'x' })], ['extra key', doc({ a: { value: 'x', secret: 'y' } })], ['extra top key', doc({ a: { value: 'x' } }, { extra: 1 })],
      ['empty value', doc({ a: { value: '' } })], ['outer spaces', doc({ a: { value: ' x' } })], ['control', doc({ a: { value: 'x\u0001' } })],
      ['long value', doc({ a: { value: 'é'.repeat(121) } })], ['long about', doc({ a: { value: 'x', about: 'é'.repeat(81) } })],
      ['too many', doc(Object.fromEntries(Array.from({ length: 101 }, (_, k) => ['v' + k, { value: 'x' }])))]
    ];
    for (const [label, text] of specimens) {
      fs.writeFileSync(path.join(root, T.FILE), text);
      const mine = check().teamValues, theirs = T.parse(text);
      assert.strictEqual(mine.state, theirs.state, label + ': ' + JSON.stringify(mine) + ' vs ' + JSON.stringify(theirs));
      assert.strictEqual(mine.why, theirs.why, label + ': same reason');
      assert.strictEqual(mine.readOnly, theirs.readOnly, label + ': same read-only reason');
      if (theirs.state !== 'ok') assert.ok(check().teamFiles.problems.some(p => p.file === T.FILE && p.problem === theirs.why), label + ': named as a problem');
    }
    fs.writeFileSync(path.join(root, T.FILE), doc({ a: { value: 'x' } }) + ' '.repeat(T.MAX_BYTES));
    assert.strictEqual(check().teamValues.state, 'unreadable', 'too large');
    assert.strictEqual((await repo.readTeamValues(new (class extends DiskFS { read(rel, o) { return o && o.maxBytes && fs.statSync(this.p(rel)).size > o.maxBytes ? Promise.reject(new Error('too large')) : super.read(rel); } })(root))).state, 'unreadable', 'the app too');
    // Grown between its size and its read: a valid start past the limit, then more, is never read as the shorter file.
    fs.writeFileSync(path.join(root, T.FILE), doc({ a: { value: 'x' } }) + ' '.repeat(T.MAX_BYTES) + 'junk');
    const grown = cp.execFileSync(py, ['-I', '-c', 'import sys, os, json; sys.path.insert(0, sys.argv[1]); import check_folder as c; os.path.getsize = lambda p: 10; print(json.dumps(c.team_values(sys.argv[2])))', path.dirname(CHECKER), root], { encoding: 'utf8' });
    assert.strictEqual(JSON.parse(grown).state, 'unreadable', grown);
    fs.unlinkSync(path.join(root, T.FILE));
    assert.strictEqual(check().teamValues.state, 'missing');
    await d.write(T.FILE, doc({ 'bitbucket-base-url': { value: 'https://b.example.com' } }));
    const md = '---\nprocess: x\ntitle: X\ncontext: env\n---\n## Ship {#ship}\n- [ ] {run.process} Deploy {#dep}\n  process: deploy\n  pass: base=team:bitbucket-base-url, env=^env\n\n## Gate: Ready {#ready}\n';
    const v = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.9.0' });
    assert.ok(!v.blockers, String(v.blockers));
    assert.deepStrictEqual(check().teamMissing, [], 'set: nothing missing');
    await d.write(T.FILE, doc({}));
    assert.deepStrictEqual(check().teamMissing, [{ process: 'x', step: 'dep', names: ['bitbucket-base-url'] }], 'removed: the step is named');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run();
