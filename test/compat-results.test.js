// Module results (3.0) against real older releases. A checklist with result: and a decision bound to it publishes as
// preflight-publication/2 with the module-results feature, and a run on it is preflight-run/3 naming it: every recorded copy
// (each one before 3.0) refuses both by name, can't publish the draft, and writes nothing. The baseline folder's /1 version
// and its run/2 stay readable and recordable by every copy. Below the floor (1.10.0, 1.11.0) the characterization stands.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');
const { cmp } = require('../tools/old-bundles');

const { expects } = require('./compat-matrix');
/* Every recorded copy: none reads module results. */
const TAGS = H.bundles.tags().filter(t => !expects('module-results', t.version));
const AT = '2026-11-07T12:00:00.000Z';
const below = (v) => cmp(v, H.bundles.FLOOR) < 0;
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

/* v2 of the baseline checklist: its result is the restore verdict, set by one decision. */
const RESULTED = G.CHECKLIST.replace('context: ticket', 'context: ticket, verdict:choice(restored|needs-work)\nresult: verdict')
  .replace('- [ ] {confirm} File the report @lead {#report}\n', '- [ ] {confirm} File the report @lead {#report}\n- [!] {decide} Record the restore verdict @lead {#verdict}\n  options: restored, needs-work\n  sets: verdict=decision\n');

let written = null;
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 30 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo;
  let d = await repo.loadAll(m);
  const customTypes = { 'team.restore': NEW.types.customType(G.STEP_TYPE) };
  const res = await repo.publish(m, RESULTED, { people: G.PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes: 'A restore verdict', existing: d.processes[0].index.all.map(p => p.info), now: AT, app: '3.0.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  d = await repo.loadAll(m);
  const v2 = d.processes[0].index.latest;
  assert.strictEqual(v2.info.version, 2);
  const r = NEW.run.create(v2, { title: 'Backup check with a verdict', details: { ticket: 'ABC-130' }, roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: 'w-avery', now: AT, id: 'run-m', app: '3.0.0' });
  await repo.saveRun(m, r, 'w-avery');
  written = { files: H.filesOf(m), folder: v2.info.folder };
  return written;
}

rule('This version publishes a checklist with a result as /2 with module-results, and its run as run/3 naming it', async () => {
  const { files, folder: f2 } = await folder();
  const two = JSON.parse(files['publications/backup/' + f2 + '/publication.json']);
  same([two.format, two.features, two.app], ['preflight-publication/2', ['typed-details', 'module-results'], '3.0.0']);
  const r = JSON.parse(files['runs/backup/run-m/run.json']);
  same([r.format, r.features], ['preflight-run/3', ['typed-details', 'module-results']]);
});

TAGS.forEach((t) => rule(t.tag + (t.supported ? '' : ' (below the floor)') + ': refuses the result version and its run by name, can\'t publish the draft, writes nothing; still records the run/2 on the /1 version', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, folder: f2 } = await folder(), m = H.memFolder(OLD, files);
  const d = await OLD.repo.loadAll(m, { deep: true }), proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  const runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  if (below(t.version)) {
    assert.strictEqual(proc.index.latest.info.version, 2, 'below the floor, the /2 version is offered as the latest');
    return;
  }
  const v2 = (proc.pubs || []).find(x => x.folder === f2), n = runs['run-m'];
  assert.strictEqual(proc.index.latest.info.version, 1, 'the /1 version stays the latest');
  assert.ok(v2 && !v2.ok && v2.unusable, 'the result version is unusable: ' + JSON.stringify(v2 && v2.why));
  if (cmp(t.version, '2.0.0') >= 0) assert.ok(/needs Flightdeck 3\.0/i.test(String(v2.why)), t.tag + ' names the version it needs: ' + v2.why);
  assert.ok(n && n._unrunnable && !Object.keys(n.steps).length && n.title === 'Backup check with a verdict', 'its run: name only, read-only');
  const before = snap(m);
  await assert.rejects(() => OLD.repo.saveRun(m, n, 'w-avery'));
  assert.strictEqual(snap(m), before, 'nothing written');
  /* Publishing the same draft: the old copy reads sets: verdict=decision as a run detail it doesn't have, and stops. */
  let res = null;
  try { res = await OLD.repo.publish(m, RESULTED, { people: G.PEOPLE, customTypes: {}, workflows: {}, by: 'person-avery', changes: 'Again', existing: proc.index.all.map(p => p.info), now: AT }); } catch (e) { res = { threw: e.message }; }
  assert.ok(res && (res.threw || (res.blockers && res.blockers.length)), t.tag + ' doesn\'t publish it: ' + JSON.stringify(res && (res.blockers || res.threw)).slice(0, 300));
  assert.strictEqual(snap(m), before, 'publishing wrote nothing');
  const a = runs['run-a'];
  assert.ok(!a._unrunnable, t.tag + ' can record it: ' + a._unrunnable);
  a.recorder.session = 'w-avery';
  OLD.run.done(a, OLD.run.mapOf(a), 'where', 'person-blake', AT, { evidence: 'https://example.com/copies/2026-11' });
  await OLD.repo.saveRun(m, a, 'w-avery');
  const NEW = H.loadMain(), back = (await NEW.repo.loadAll(H.memFolder(NEW, H.filesOf(m)))).runs.find(r => r.id === 'run-a');
  assert.ok(!back._unrunnable && back.steps.where && back.steps.where.s === 'done', 'this version reads what ' + t.tag + ' recorded');
}));

run();
