// Team values (2.9) against real older releases. A checklist that passes a team value publishes as preflight-publication/2
// with the team-values feature, and a run on it is preflight-run/3 whose link keeps teamPassed: every copy from 1.11.1
// through 2.8.0 (each one before 2.9) refuses both by name and writes nothing, and team-values.json beside them changes
// nothing they read. The baseline folder's /1 version and its run/2 stay readable and recordable by every copy.
// Below the floor (1.10.0, 1.11.0) the characterization stands: no format check (H7).
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');
const { cmp } = require('../tools/old-bundles');

const { expects } = require('./compat-matrix');
/* Every copy before 2.9 (2.9 and later read team values themselves). */
const TAGS = H.bundles.tags().filter(t => !expects('team-values', t.version));
const AT = '2026-10-27T12:00:00.000Z';
const below = (v) => cmp(v, H.bundles.FLOOR) < 0;
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const TEAM = JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'case-base': { value: 'https://cases.example.com' } } }, null, 2) + '\n';

/* v2 of the baseline checklist with one linked step that passes a team value. */
const PASSING = G.CHECKLIST.replace('- [ ] {confirm} File the report @lead {#report}\n',
  '- [ ] {confirm} File the report @lead {#report}\n- [ ] {run.process} Run the follow-up check @lead {#follow}\n  process: follow-up\n  pass: case=team:case-base\n');

let written = null;
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 29 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo;
  await m.write('team-values.json', TEAM);
  let d = await repo.loadAll(m);
  const customTypes = { 'team.restore': NEW.types.customType(G.STEP_TYPE) };
  const res = await repo.publish(m, PASSING, { people: G.PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes: 'A follow-up check', existing: d.processes[0].index.all.map(p => p.info), now: AT, app: '2.9.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  d = await repo.loadAll(m);
  const v2 = d.processes[0].index.latest;
  assert.strictEqual(v2.info.version, 2);
  const r = NEW.run.create(v2, { title: 'Backup check with follow-up', details: { ticket: 'ABC-129' }, roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: 'w-avery', now: AT, id: 'run-p', app: '2.9.0' });
  r.steps.follow = { s: 'open', child: { process: 'follow-up', id: 'run-f', inputs: {}, teamPassed: { case: { text: 'https://cases.example.com' } } } };
  await repo.saveRun(m, r, 'w-avery');
  written = { files: H.filesOf(m), folder: v2.info.folder };
  return written;
}

rule('This version publishes a checklist that passes a team value as /2 with team-values, and its run as run/3 keeping teamPassed', async () => {
  const { files, folder: f2 } = await folder();
  const two = JSON.parse(files['publications/backup/' + f2 + '/publication.json']);
  same([two.format, two.features, two.app], ['preflight-publication/2', ['passed-details', 'team-values'], '2.9.0']);
  const rj = JSON.parse(files['runs/backup/run-p/run.json']);
  assert.strictEqual(rj.format, 'preflight-run/3');
  assert.ok(rj.features.indexOf('team-values') >= 0, JSON.stringify(rj.features));
  same(rj.steps.follow.child.teamPassed, { case: { text: 'https://cases.example.com' } });
  const NEW = H.loadMain(), back = (await NEW.repo.loadAll(H.memFolder(NEW, files))).runs.find(x => x.id === 'run-p');
  assert.ok(!back._unrunnable, back._unrunnable);
});

TAGS.forEach((t) => rule(t.tag + (t.supported ? '' : ' (below the floor)') + ': refuses the team-value version and its run by name and writes nothing; still records the run/2 on the /1 version', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, folder: f2 } = await folder(), m = H.memFolder(OLD, files), untouched = snap(m);
  const d = await OLD.repo.loadAll(m, { deep: true }), proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  const runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  if (below(t.version)) {
    assert.strictEqual(proc.index.latest.info.version, 2, 'below the floor, the /2 version is offered as the latest');
    return;
  }
  const v2 = (proc.pubs || []).find(x => x.folder === f2), n = runs['run-p'];
  assert.strictEqual(proc.index.latest.info.version, 1, 'the /1 version stays the latest');
  assert.ok(v2 && !v2.ok && v2.unusable, 'the team-value version is unusable: ' + JSON.stringify(v2 && v2.why));
  assert.ok(n && n._unrunnable && !Object.keys(n.steps).length && n.title === 'Backup check with follow-up', 'its run: name only, read-only');
  const named = /Flightdeck 2\.9|newer Flightdeck|Update Flightdeck|team-values/;
  assert.ok(named.test(String(v2.why)), t.tag + ': the version says what it needs: ' + v2.why);
  assert.ok(named.test(String(n._unrunnable)), t.tag + ': the run says what it needs: ' + n._unrunnable);
  assert.strictEqual(snap(m), untouched, 'reading it wrote nothing');
  const before = snap(m);
  await assert.rejects(() => OLD.repo.saveRun(m, n, 'w-avery'));
  assert.strictEqual(snap(m), before, 'nothing written');
  assert.strictEqual(m.files['team-values.json'].t, TEAM, 'team-values.json is left as it is');
  const a = runs['run-a'];
  assert.ok(!a._unrunnable, t.tag + ' can record it: ' + a._unrunnable);
  a.recorder.session = 'w-avery';
  OLD.run.done(a, OLD.run.mapOf(a), 'where', 'person-blake', AT, { evidence: 'https://example.com/copies/2026-10' });
  await OLD.repo.saveRun(m, a, 'w-avery');
  const NEW = H.loadMain(), back = (await NEW.repo.loadAll(H.memFolder(NEW, H.filesOf(m)))).runs.find(r => r.id === 'run-a');
  assert.ok(!back._unrunnable && back.steps.where && back.steps.where.s === 'done', 'this version reads what ' + t.tag + ' recorded');
}));

run();
