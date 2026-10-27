// pass: (2.8) against real older releases. A checklist with a pass: line publishes as preflight-publication/2 with the
// passed-details feature, and a run on it is preflight-run/3: every copy from 1.11.1 through 2.7.0 refuses both by name and
// writes nothing. The baseline folder's /1 version and its run/2 (no pass:) stay readable and recordable by every copy.
// Below the floor (1.10.0, 1.11.0) the characterization stands: no format check (H7).
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');
const { cmp } = require('../tools/old-bundles');

const TAGS = H.bundles.tags();
const AT = '2026-10-26T12:00:00.000Z';
const below = (v) => cmp(v, H.bundles.FLOOR) < 0;
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

/* v2 of the baseline checklist with one linked step that passes ^ticket under another name. */
const PASSING = G.CHECKLIST.replace('- [ ] {confirm} File the report @lead {#report}\n',
  '- [ ] {confirm} File the report @lead {#report}\n- [ ] {run.process} Run the follow-up check @lead {#follow}\n  process: follow-up\n  pass: case=^ticket\n');

let written = null;
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 28 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo;
  let d = await repo.loadAll(m);
  const customTypes = { 'team.restore': NEW.types.customType(G.STEP_TYPE) };
  const res = await repo.publish(m, PASSING, { people: G.PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes: 'A follow-up check', existing: d.processes[0].index.all.map(p => p.info), now: AT, app: '2.8.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  d = await repo.loadAll(m);
  const v2 = d.processes[0].index.latest;
  assert.strictEqual(v2.info.version, 2);
  const r = NEW.run.create(v2, { title: 'Backup check with follow-up', details: { ticket: 'ABC-128' }, roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: 'w-avery', now: AT, id: 'run-p', app: '2.8.0' });
  await repo.saveRun(m, r, 'w-avery');
  written = { files: H.filesOf(m), folder: v2.info.folder };
  return written;
}

rule('This version publishes a checklist with pass: as /2 with passed-details, and its run as run/3', async () => {
  const { files, folder: f2 } = await folder();
  const two = JSON.parse(files['publications/backup/' + f2 + '/publication.json']);
  same([two.format, two.features, two.app], ['preflight-publication/2', ['passed-details'], '2.8.0']);
  assert.strictEqual(JSON.parse(files['runs/backup/run-p/run.json']).format, 'preflight-run/3');
});

TAGS.forEach((t) => rule(t.tag + (t.supported ? '' : ' (below the floor)') + ': refuses the pass: version and its run by name and writes nothing; still records the run/2 on the /1 version', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, folder: f2 } = await folder(), m = H.memFolder(OLD, files);
  const d = await OLD.repo.loadAll(m, { deep: true }), proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  const runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  if (below(t.version)) {
    assert.strictEqual(proc.index.latest.info.version, 2, 'below the floor, the /2 version is offered as the latest');
    return;
  }
  const v2 = (proc.pubs || []).find(x => x.folder === f2), n = runs['run-p'];
  assert.strictEqual(proc.index.latest.info.version, 1, 'the /1 version stays the latest');
  assert.ok(v2 && !v2.ok && v2.unusable, 'the pass: version is unusable: ' + JSON.stringify(v2 && v2.why));
  assert.ok(n && n._unrunnable && !Object.keys(n.steps).length && n.title === 'Backup check with follow-up', 'its run: name only, read-only');
  const before = snap(m);
  await assert.rejects(() => OLD.repo.saveRun(m, n, 'w-avery'));
  assert.strictEqual(snap(m), before, 'nothing written');
  const a = runs['run-a'];
  assert.ok(!a._unrunnable, t.tag + ' can record it: ' + a._unrunnable);
  a.recorder.session = 'w-avery';
  OLD.run.done(a, OLD.run.mapOf(a), 'where', 'person-blake', AT, { evidence: 'https://example.com/copies/2026-10' });
  await OLD.repo.saveRun(m, a, 'w-avery');
  const NEW = H.loadMain(), back = (await NEW.repo.loadAll(H.memFolder(NEW, H.filesOf(m)))).runs.find(r => r.id === 'run-a');
  assert.ok(!back._unrunnable && back.steps.where && back.steps.where.s === 'done', 'this version reads what ' + t.tag + ' recorded');
}));

run();
