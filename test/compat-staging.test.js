// Staging (2.1 slice 4) against real older releases. This version stages drafts under staged/, promotes one as an ordinary
// version in the lowest format its content needs (here preflight-publication/1 with stagedFrom), and retires another with a
// decision file. Every copy from 1.11.1 through 2.0.0 never lists staged/, takes the promoted version as an ordinary latest
// version it can run, and writes nothing while reading. A stage's own record, read by an older copy as if it were a version,
// is refused by name, never run.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');

const TAGS = H.bundles.tags().filter(t => t.supported);
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

TAGS.forEach((t) => rule(t.tag + ': never lists staged/, runs the promoted version as an ordinary latest version, and writes nothing while reading', async () => {
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

TAGS.forEach((t) => rule(t.tag + ': a stage\'s own record, read as a version, is refused, never run', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, kept } = await folder(), b = 'staged/backup/' + kept + '/';
  const v = OLD.publish.verify(kept, { 'publication.json': files[b + 'publication.json'], 'map.md': files[b + 'map.md'], 'types.json': files[b + 'types.json'] });
  assert.ok(!v.ok, t.tag + ' would read a stage as a version');
  if (t.major >= 2) assert.ok(/needs Flightdeck 2\.1/i.test(v.why), 'and says which release reads it: ' + v.why);
}));

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
