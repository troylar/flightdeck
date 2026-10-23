// Staging (2.1 slice 4) against real older releases. This version stages drafts under staged/, promotes one as an ordinary
// version in the lowest format its content needs (here preflight-publication/1 with stagedFrom), and retires another with a
// decision file. Every copy from 1.11.1 through 2.0.0 never lists staged/, takes the promoted version as an ordinary latest
// version it can run, and writes nothing while reading. A stage's own record, read by an older copy as if it were a version,
// is refused by name, never run. A test run on a stage (slice 5) is listed by name only and never saved there. 2.1.0 reads all
// of it as this version does: the stages and their decisions, a test run in full, and its count for the promoted version.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');
const { expects } = require('./compat-matrix');

const TAGS = H.bundles.tags().filter(t => t.supported);
/* Releases that read staged/ (2.1.0 on), and those that never do. */
const STAGES = TAGS.filter(t => expects('staging', t.version)), BEFORE = TAGS.filter(t => !expects('staging', t.version));
const AT = '2026-10-22T12:00:00.000Z';
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

const TRY = G.CHECKLIST.replace('File the report @lead', 'File the report and link it @lead');
const KEEP = G.CHECKLIST.replace('Record where the copy is', 'Record where the restored copy is');

let written = null;
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 14 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo;
  const d = await repo.loadAll(m);
  const customTypes = { 'team.restore': NEW.types.customType(G.STEP_TYPE) };
  const o = (rand, changes) => ({ people: G.PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes, existing: d.processes[0].index.all.map(p => p.info), now: AT, app: '2.1.0', rand });
  const a = await repo.stage(m, TRY, o('tryaaaa1', 'Try a linked report'));
  const b = await repo.stage(m, KEEP, o('keepbbb2', 'Clearer wording'));
  assert.ok(a.folder && b.folder, JSON.stringify([a, b]));
  await repo.decideStage(m, 'backup', a.folder, 'retired', { by: 'person-blake', now: AT, window: 'w-blake', reason: 'Not needed', app: '2.1.0' });
  const p = await repo.promote(m, 'backup', b.folder, { by: 'person-blake', now: AT, app: '2.1.0', rand: 'promoted' });
  written = { files: H.filesOf(m), tried: a.folder, kept: b.folder, promoted: p };
  return written;
}

rule('This version stages under staged/, writes the decision there, and promotes as preflight-publication/1 with stagedFrom', async () => {
  const { files, kept, promoted } = await folder();
  same([promoted.version, promoted.folder], [2, 'v2-promoted']);
  const info = JSON.parse(files['publications/backup/v2-promoted/publication.json']);
  same([info.format, 'features' in info, info.stagedFrom.folder], ['preflight-publication/1', false, kept]);
  same(info.payload, JSON.parse(files['staged/backup/' + kept + '/publication.json']).payload, 'the stage\'s payload, kept on /1');
  assert.ok(files['publications/backup/v2-promoted/images/restore.png'], 'its screenshot is copied');
  assert.ok(Object.keys(files).some(p => /^staged\/backup\/decisions\/stage-tryaaaa1\.w-blake\.1\.json$/.test(p)));
});

STAGES.forEach((t) => rule(t.tag + ': reads staged/ (one stage retired, one promoted), runs the promoted version as the latest, and writes nothing while reading', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, tried, kept } = await folder(), m = H.memFolder(OLD, files), before = snap(m);
  const d = await OLD.repo.loadAll(m, { deep: true }), proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  assert.strictEqual(snap(m), before, 'nothing written while reading');
  const sp = d.stages.procs.backup, pubs = proc.pubs || proc.index.all;
  same(sp.stages.map(x => [x.folder, x.ok]).sort(), [[kept, true], [tried, true]].sort(), 'both stages read');
  same(sp.decisions.map(x => [x.stage, x.status, x.by]), [[tried, 'retired', 'person-blake']], 'and the decision');
  same([OLD.staging.status(sp.stages.find(x => x.folder === tried), sp.decisions, pubs).status, OLD.staging.status(sp.stages.find(x => x.folder === kept), sp.decisions, pubs).status], ['retired', 'promoted']);
  const latest = proc.index.latest;
  assert.ok(latest.ok && latest.info.version === 2 && latest.info.folder === 'v2-promoted' && latest.info.stagedFrom.folder === kept, 'the promoted version is the latest');
  assert.ok(!(proc.pubs || []).some(x => /^stage-/.test(x.folder)), 'no stage is a version');
  const r = OLD.run.create(latest, { title: 'Promoted October', details: { ticket: 'ABC-121' }, roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: 'w-avery', now: AT, id: 'run-p' });
  await OLD.repo.saveRun(m, r, 'w-avery');
  const back = (await OLD.repo.loadAll(m, { deep: true })).runs.find(x => x.id === 'run-p');
  assert.ok(back && !back._unrunnable && back.folder === 'v2-promoted', 'a run on it starts and reads back runnable: ' + (back && back._unrunnable));
}));

BEFORE.forEach((t) => rule(t.tag + ': never lists staged/, runs the promoted version as an ordinary latest version, and writes nothing while reading', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files } = await folder(), m = H.memFolder(OLD, files);
  const listed = [], orig = m.list.bind(m);
  m.list = (x) => { listed.push(x); return orig(x); };
  const before = snap(m);
  const d = await OLD.repo.loadAll(m, { deep: true }), proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  assert.ok(!listed.some(x => /^staged/.test(x)), 'staged/ never listed: ' + listed.filter(x => /^staged/.test(x)).join(', '));
  assert.strictEqual(snap(m), before, 'nothing written while reading');
  const latest = proc.index.latest;
  assert.ok(latest.ok && latest.info.version === 2 && latest.info.folder === 'v2-promoted', 'the promoted version is the latest: ' + JSON.stringify(latest.why));
  assert.ok(!(proc.pubs || []).some(x => /^stage-/.test(x.folder)), 'no stage is a version');
  const r = OLD.run.create(latest, { title: 'Promoted October', details: { ticket: 'ABC-121' }, roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: 'w-avery', now: AT, id: 'run-p' });
  assert.ok(r && !r._unrunnable && r.folder === 'v2-promoted', 'a run on it starts');
  await OLD.repo.saveRun(m, r, 'w-avery');
  const back = (await OLD.repo.loadAll(m, { deep: true })).runs.find(x => x.id === 'run-p');
  assert.ok(back && !back._unrunnable && back.folder === 'v2-promoted', 'and reads back runnable: ' + (back && back._unrunnable));
}));

TAGS.forEach((t) => rule(t.tag + ': a stage\'s own record, read as a version, is refused, never run' + (expects('staging', t.version) ? ' (it reads it by the stage rules only)' : ''), async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, kept } = await folder(), b = 'staged/backup/' + kept + '/';
  const these = { 'publication.json': files[b + 'publication.json'], 'map.md': files[b + 'map.md'], 'types.json': files[b + 'types.json'] }, exact = H.exact2(these['map.md'], these['types.json']);
  const v = OLD.publish.verify(kept, these, expects('staging', t.version) ? exact : undefined);
  assert.ok(!v.ok, t.tag + ' would read a stage as a version');
  if (expects('staging', t.version)) {
    assert.ok(v.unusable && /a stage belongs under staged\//.test(v.why), 'and says it is a stage: ' + v.why);
    assert.ok(OLD.publish.verify(kept, these, exact, { stage: true }).ok, 'by the stage rules it reads');
  } else if (t.major >= 2) assert.ok(/needs Flightdeck 2\.1/i.test(v.why), 'and says which release reads it: ' + v.why);
}));

/* Test runs (2.1 slice 5): this version starts one on a staged version. Every copy from 1.11.1 through 2.0.0 lists it by name
   only (2.0.0 as a test run that needs Flightdeck 2.1), never reads its steps, and refuses to save it, writing nothing. */
let withTest = null;
async function testFolder() {
  if (withTest) return withTest;
  const { files } = await folder(), NEW = H.loadMain({ at: AT, seed: 15 }), m = H.memFolder(NEW, files), repo = NEW.repo;
  const d = await repo.loadAll(m), p = d.processes[0];
  const customTypes = { 'team.restore': NEW.types.customType(G.STEP_TYPE) };
  const st = await repo.stage(m, TRY, { people: G.PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes: 'Try it in a test run', existing: p.index.all.map(x => x.info), now: AT, app: '2.1.0', rand: 'testccc3' });
  const res = await repo.startTestRun(m, 'backup', st.folder, { pubs: p.pubs, session: 'w-avery', writer: 'w-avery', make: (stage) => NEW.run.create(stage, { test: true, title: 'Backup check (test)', details: { ticket: 'ABC-130' }, roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: 'w-avery', now: AT, app: '2.1.0', id: 'run-tst' }) });
  assert.ok(res.run && res.run.test === true, 'set-up: a test run');
  withTest = { files: H.filesOf(m), stage: st.folder };
  return withTest;
}
rule('This version writes a test run as run/3 naming staged and test-run, on the stage, with test and stage last', async () => {
  const { files, stage } = await testFolder(), r = JSON.parse(files['runs/backup/run-tst/run.json']);
  same([r.format, r.features.slice(-2), r.folder, r.test, r.stage, Object.keys(r).slice(-2)], ['preflight-run/3', ['staged', 'test-run'], stage, true, { folder: stage }, ['test', 'stage']]);
});
STAGES.forEach((t) => rule(t.tag + ': reads a test run in full, labeled a test run on its stage, and saves it as run/3 naming staged and test-run', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, stage } = await testFolder(), m = H.memFolder(OLD, files), before = snap(m);
  const d = await OLD.repo.loadAll(m, { deep: true }), r = d.runs.find(x => x.id === 'run-tst');
  assert.strictEqual(snap(m), before, 'nothing written while reading');
  assert.ok(r && !r._unrunnable && OLD.run.isTest(r) && r.folder === stage && r.details.ticket === 'ABC-130', 'in full, a test run: ' + (r && r._unrunnable));
  r.recorder = Object.assign({}, r.recorder, { session: 'w-avery' });
  OLD.run.done(r, OLD.run.mapOf(r), 'read', 'person-avery', AT, {});
  await OLD.repo.saveRun(m, r, 'w-avery');
  const back = JSON.parse(m.files['runs/backup/run-tst/run.json'].t);
  same([back.format, back.features.slice(-2), back.steps.read.s, Object.keys(back).slice(-2)], ['preflight-run/3', ['staged', 'test-run'], 'done', ['test', 'stage']]);
  const proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  assert.ok(proc.index.latest.info.folder === 'v2-promoted' && !(proc.pubs || []).some(x => /^stage-/.test(x.folder)), 'the test run\'s stage is never a version');
}));
BEFORE.forEach((t) => rule(t.tag + ': a test run is listed by name only, never its steps, and saving it writes nothing', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files } = await testFolder(), m = H.memFolder(OLD, files), before = snap(m);
  const d = await OLD.repo.loadAll(m, { deep: true }), r = d.runs.find(x => x.id === 'run-tst');
  assert.strictEqual(snap(m), before, 'nothing written while reading');
  assert.ok(r && r._unrunnable && !Object.keys(r.steps).length && !Object.keys(r.details || {}).length && r.title === 'Backup check (test)', 'name only: ' + (r && r._unrunnable));
  if (t.major >= 2) assert.ok(/^Test run · needs Flightdeck 2\.1\./.test(r._unrunnable) && r._test, 'says it\'s a test run and what it needs: ' + r._unrunnable);
  await assert.rejects(() => OLD.repo.saveRun(m, r, 'w-avery'));
  assert.strictEqual(snap(m), before, 'nothing written');
  const proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  assert.ok(proc.index.latest.info.folder === 'v2-promoted' && !(proc.pubs || []).some(x => /^stage-/.test(x.folder)), 'the test run\'s stage is never a version');
}));

/* Readiness and sign-offs from test runs (2.1 slice 6): this version counts a stage's clean test runs and its sign-off for the
   version promoted from it. Every copy from 1.11.1 through 2.0.0 counts none of them for anything, writes nothing while
   reading, and every release's folder checker still reads the folder. */
let signed = null;
async function signedFolder() {
  if (signed) return signed;
  const NEW = H.loadMain({ at: AT, seed: 16 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo;
  const d = await repo.loadAll(m), p = d.processes[0];
  const customTypes = { 'team.restore': NEW.types.customType(G.STEP_TYPE) };
  const res = await repo.stage(m, KEEP, { people: G.PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes: 'Try it', existing: p.index.all.map(x => x.info), now: AT, app: '2.1.0', rand: 'signddd4' });
  const st = await repo.readStage(m, 'backup', res.folder);
  const roles = { lead: 'person-avery', checker: 'person-blake' };
  for (const i of [1, 2, 3]) {
    const r = NEW.run.create(st, { test: true, title: 'Try ' + i, id: 'run-try' + i, details: { ticket: 'ABC-14' + i }, roles, by: 'person-avery', session: 'w-avery', now: AT, app: '2.1.0' });
    const map = NEW.run.mapOf(r);
    map.phases.forEach((ph, pi) => { ph.steps.forEach(s => { try { NEW.run.done(r, map, s.id, 'person-avery', AT, {}); } catch (e) { /* a step that needs more is left */ } }); try { NEW.run.pass(r, map, pi, 'person-avery', AT); } catch (e) { /* as is */ } });
    r.ended = { outcome: 'Completed', at: AT }; r.state = 'completed';
    await repo.saveRun(m, r, 'w-avery');
  }
  const owner = st.map.meta.owner || 'person-avery';
  await repo.recordStageValidation(m, st, { window: 'w-owner', by: owner, note: 'Tried', evidence: { completed: 3, clean: 3, runs: ['run-try1', 'run-try2', 'run-try3'] }, app: '2.1.0', now: AT });
  const pr = await repo.promote(m, 'backup', res.folder, { by: owner, now: AT, app: '2.1.0', rand: 'signedp5' });
  const after = await repo.loadAll(m, { deep: true }), pub = after.processes[0].index.latest;
  signed = { files: H.filesOf(m), folder: pr.folder, ready: NEW.skills.readiness(after.runs, pub, null), signs: NEW.skills.signoffs(after.validations, pub) };
  return signed;
}
rule('This version counts the stage\'s test runs and sign-off for the version promoted from it', async () => {
  const { ready, signs } = await signedFolder();
  assert.ok(ready.tests === ready.clean && ready.completed === 3 && signs.length === 1 && signs[0].stage, JSON.stringify([ready.completed, ready.clean, ready.tests, ready.deviations.slice(0, 3), signs.length]));
});
STAGES.forEach((t) => rule(t.tag + ': counts the stage\'s test runs and its sign-off for the promoted version, as this version does, and writes nothing while reading', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, folder, ready, signs } = await signedFolder(), m = H.memFolder(OLD, files), before = snap(m);
  const d = await OLD.repo.loadAll(m, { deep: true }), latest = (d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0]).index.latest;
  assert.strictEqual(snap(m), before, 'nothing written while reading');
  assert.ok(latest && latest.ok && latest.info.folder === folder && latest.fromStage && latest.fromStage.ok, 'the promoted version carries its stage');
  const rd = OLD.skills.readiness(d.runs, latest, null);
  same([rd.completed, rd.clean, rd.tests], [ready.completed, ready.clean, ready.tests], 'the same test runs counted');
  same(OLD.skills.signoffs(d.validations || [], latest).length, signs.length, 'and the stage sign-off');
}));
BEFORE.forEach((t) => rule(t.tag + ': counts none of a stage\'s test runs or its sign-off for the promoted version, and writes nothing while reading', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, folder } = await signedFolder(), m = H.memFolder(OLD, files), before = snap(m);
  const d = await OLD.repo.loadAll(m, { deep: true }), proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  assert.strictEqual(snap(m), before, 'nothing written while reading');
  const latest = proc.index.latest;
  assert.ok(latest && latest.ok && latest.info.folder === folder, 'the promoted version is the latest');
  const rd = OLD.skills.readiness(d.runs, latest, null);
  same([rd.completed, rd.clean], [0, 0], 'no test run counted');
  same(OLD.skills.signoffs(d.validations || [], latest).length, 0, 'no stage sign-off counted');
}));
rule('Every release\'s folder checker, and this one, still reads a folder with a stage sign-off and its promoted version', async () => {
  const cp = require('child_process'), fsN = require('fs'), os = require('os'), path = require('path');
  let py = null; for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); py = c; break; } catch (e) { /* next */ } }
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const { files, folder } = await signedFolder(), root = fsN.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-signed-check-')), dir = path.join(root, 'folder');
  try {
    H.writeTree(dir, files);
    const checkers = [['this version', path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py')]];
    TAGS.forEach(t => { const b = H.bundles.get(t.tag); if (b && b.files['check_folder.py']) { const ck = path.join(root, t.tag + '.py'); fsN.writeFileSync(ck, b.files['check_folder.py']); checkers.push([t.tag, ck]); } });
    assert.ok(checkers.length > TAGS.length / 2, 'the old checkers are there');
    for (const [name, ck] of checkers) {
      const p = JSON.parse(cp.execFileSync(py, ['-I', ck, dir], { encoding: 'utf8' })).publications.backup, st = {};
      p.versions.forEach(v => { st[v.folder] = v.status; });
      assert.deepStrictEqual([p.current, st[folder]], [folder, 'complete'], name);
    }
  } finally { fsN.rmSync(root, { recursive: true, force: true }); }
});

/* A /1 record that carries the stage's payload (2.1 keeps it on promotion): every real older copy loads it, runs it and never
   rewrites it, and every release's own folder checker calls it complete and current. */
async function withPayload() {
  const { files, kept } = await folder(), f = Object.assign({}, files), pj = 'publications/backup/v2-promoted/publication.json';
  const info = JSON.parse(f[pj]);
  if (!info.payload) { info.payload = JSON.parse(f['staged/backup/' + kept + '/publication.json']).payload; f[pj] = JSON.stringify(info, null, 2); }
  return { f, pj };
}
TAGS.forEach((t) => rule(t.tag + ': a /1 version carrying the stage\'s payload loads as the latest, runs, and its record is never rewritten', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { f, pj } = await withPayload(), m = H.memFolder(OLD, f), rec = f[pj];
  assert.ok(JSON.parse(rec).payload && JSON.parse(rec).format === 'preflight-publication/1');
  const d = await OLD.repo.loadAll(m, { deep: true }), proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  assert.ok(proc.index.latest.ok && proc.index.latest.info.folder === 'v2-promoted', 'the latest: ' + JSON.stringify(proc.index.latest.why));
  const r = OLD.run.create(proc.index.latest, { title: 'Payload October', details: { ticket: 'ABC-122' }, roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: 'w-avery', now: AT, id: 'run-q' });
  await OLD.repo.saveRun(m, r, 'w-avery');
  const back = (await OLD.repo.loadAll(m, { deep: true })).runs.find(x => x.id === 'run-q');
  assert.ok(back && !back._unrunnable && back.folder === 'v2-promoted', 'runs: ' + (back && back._unrunnable));
  assert.strictEqual(m.files[pj].t, rec, 'the record is never rewritten');
}));
rule('Every release\'s folder checker, and this one, calls a /1 version carrying a payload complete and current', async () => {
  const cp = require('child_process'), fsN = require('fs'), os = require('os'), path = require('path');
  let py = null; for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); py = c; break; } catch (e) { /* next */ } }
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const { f } = await withPayload(), root = fsN.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-payload-check-')), dir = path.join(root, 'folder');
  try {
    H.writeTree(dir, f);
    const checkers = [['this version', path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py')]];
    TAGS.forEach(t => { const b = H.bundles.get(t.tag); if (b && b.files['check_folder.py']) { const ck = path.join(root, t.tag + '.py'); fsN.writeFileSync(ck, b.files['check_folder.py']); checkers.push([t.tag, ck]); } });
    assert.ok(checkers.length > TAGS.length / 2, 'the old checkers are there');
    for (const [name, ck] of checkers) {
      const p = JSON.parse(cp.execFileSync(py, ['-I', ck, dir], { encoding: 'utf8' })).publications.backup, st = {};
      p.versions.forEach(v => { st[v.folder] = v.status; });
      assert.deepStrictEqual([p.current, st['v2-promoted']], ['v2-promoted', 'complete'], name);
    }
  } finally { fsN.rmSync(root, { recursive: true, force: true }); }
});

run();
