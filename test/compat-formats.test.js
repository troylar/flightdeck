// 2.0 formats (slice 2 part 1) against real older releases: what this version's own writers write, read by every tagged copy.
// A checklist that uses nothing new publishes as preflight-publication/1 and its runs stay preflight-run/2: every copy from
// 1.11.1 on reads and records them. One with a phase note and phase and gate screenshots publishes as /2, and a run on it is
// preflight-run/3: every copy from 1.11.1 on refuses both by name and writes nothing. Below the floor (1.10.0, 1.11.0) the
// characterization stands: no format check, so a /2 version is offered as the latest and run/3 is hidden (H7).
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');
const { cmp } = require('../tools/old-bundles');

const TAGS = H.bundles.tags();
const AT = '2026-10-20T12:00:00.000Z';
const below = (v) => cmp(v, H.bundles.FLOOR) < 0;
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

/* v2 of the baseline checklist with 2.0 syntax: a note and a screenshot on a phase, a screenshot on a gate. */
const NOTED = G.CHECKLIST
  .replace('## Prepare {#prep}\n', '## Prepare {#prep}\n  > Use the scratch server, never production.\n  ![The scratch server](images/scratch.png)\n')
  .replace('  > The restored copy opens and its row counts match.\n', '  > The restored copy opens and its row counts match.\n  ![The row counts](images/counts.png)\n');

/* This version's own writers: the baseline folder (v1 /1, run-a and run-b on run/2), then v2 /2 and a run on it. */
let written = null;
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 9 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo;
  const png = () => new Blob([new Uint8Array(G.PNG)], { type: 'image/png' });
  await m.write('images/scratch.png', png()); await m.write('images/counts.png', png());
  let d = await repo.loadAll(m);
  const customTypes = { 'team.restore': NEW.types.customType(G.STEP_TYPE) };
  const res = await repo.publish(m, NOTED, { people: G.PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes: 'Notes on the phase and gate', existing: d.processes[0].index.all.map(p => p.info), now: AT, app: '2.0.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  d = await repo.loadAll(m);
  const v2 = d.processes[0].index.latest;
  assert.strictEqual(v2.info.version, 2);
  const r = NEW.run.create(v2, { title: 'Backup check October', details: { ticket: 'ABC-102' }, roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: 'w-avery', now: AT, id: 'run-n', app: '2.0.0' });
  await repo.saveRun(m, r, 'w-avery');
  written = { files: H.filesOf(m), folder: v2.info.folder };
  return written;
}

rule('This version writes /1 and run/2 for a checklist that uses nothing new, and /2 and run/3 for one that uses 2.0 notes and screenshots', async () => {
  const { files, folder: f2 } = await folder();
  const pubs = Object.keys(files).filter(p => /^publications\/backup\/[^/]+\/publication\.json$/.test(p)).map(p => JSON.parse(files[p]));
  same(pubs.map(i => [i.version, i.format]).sort(), [[1, 'preflight-publication/1'], [2, 'preflight-publication/2']]);
  const two = pubs.find(i => i.version === 2);
  same([two.features, two.app], [['phase-notes', 'phase-shots', 'gate-shots'], '2.0.0']);
  assert.ok(files['publications/backup/' + f2 + '/images/scratch.png'] && files['publications/backup/' + f2 + '/images/counts.png'], 'the phase and gate screenshots are copied into the version');
  same(['run-a', 'run-b', 'run-n'].map(id => JSON.parse(files['runs/backup/' + id + '/run.json']).format), ['preflight-run/2', 'preflight-run/2', 'preflight-run/3']);
});

TAGS.forEach((t) => rule(t.tag + (t.supported ? '' : ' (below the floor)') + ': reads and records the /1 version and its run/2 this version wrote, and refuses the /2 version and run/3 by name, writing nothing', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, folder: f2 } = await folder(), m = H.memFolder(OLD, files);
  const d = await OLD.repo.loadAll(m, { deep: true }), proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  const runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  if (below(t.version)) {
    // H7: no format check before 1.11.1.
    assert.strictEqual(proc.index.latest.info.version, 2, 'below the floor, the /2 version is offered as the latest');
    assert.ok(!runs['run-n'], 'below the floor, run/3 is left out without a word');
    return;
  }
  assert.strictEqual(proc.index.latest.info.version, 1, 'the /1 version stays the latest');
  const v2 = (proc.pubs || []).find(x => x.folder === f2);
  assert.ok(v2 && !v2.ok && v2.unusable, 'the /2 version is unusable: ' + JSON.stringify(v2 && v2.why));
  const n = runs['run-n'];
  assert.ok(n && n._unrunnable && !Object.keys(n.steps).length && n.title === 'Backup check October', 'run/3: its name only, read-only');
  // Zero writes: saving the run/3, or starting a run on the /2 version, is refused.
  const before = snap(m);
  await assert.rejects(() => OLD.repo.saveRun(m, n, 'w-avery'));
  const b = 'publications/backup/' + f2 + '/', v = OLD.publish.verify(f2, { 'publication.json': files[b + 'publication.json'], 'map.md': files[b + 'map.md'], 'types.json': files[b + 'types.json'] });
  assert.ok(!v.ok && v.unusable);
  assert.throws(() => OLD.run.create({ info: v.info, map: OLD.map.parse(files[b + 'map.md']), md: files[b + 'map.md'], types: JSON.parse(files[b + 'types.json']) }, { by: 'person-avery', session: 's', now: AT }));
  assert.strictEqual(snap(m), before, 'nothing written');
  // The run/2 on the /1 version: this copy records a step, and this version reads back exactly what it saved.
  const a = runs['run-a'];
  assert.ok(!a._unrunnable, t.tag + ' can record it: ' + a._unrunnable);
  a.recorder.session = 'w-avery';
  OLD.run.done(a, OLD.run.mapOf(a), 'where', 'person-blake', AT, { evidence: 'https://example.com/copies/2026-10' });
  await OLD.repo.saveRun(m, a, 'w-avery');
  const saved = JSON.parse(m.files['runs/backup/run-a/run.json'].t);
  assert.strictEqual(saved.format, 'preflight-run/2');
  const NEW = H.loadMain(), back = (await NEW.repo.loadAll(H.memFolder(NEW, H.filesOf(m)))).runs.find(r => r.id === 'run-a');
  assert.ok(!back._unrunnable && back.steps.where && back.steps.where.s === 'done', 'this version reads what ' + t.tag + ' recorded');
}));

run();
