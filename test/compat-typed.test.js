// Typed data (2.0 slice 3) against real older releases. A checklist with typed run details or typed evidence publishes as
// preflight-publication/2 and its runs are preflight-run/3: every copy from 1.11.1 on names the version unusable, lists the run
// by name only and writes nothing. A team step type that records a number is flightdeck-step-type/2: older copies can't use it.
// A typed draft is one no older copy publishes. A plain checklist published here stays /1 and its run/2 round-trips.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');

const TAGS = H.bundles.tags().filter(t => t.supported);
const AT = '2026-10-21T12:00:00.000Z';
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

const TYPED = G.CHECKLIST.replace('context: ticket', 'context: ticket, rows:number, due:date, approved:yes-no, env:choice(dev|prod)')
  .replace('  evidence: link\n', '  evidence: date\n')
  .replace('- [ ] {confirm} File the report @lead {#report}', '- [ ] {team.count} Count the rows ^rows @lead {#report}');
const COUNT = { format: 'flightdeck-step-type/2', features: ['typed-evidence'], app: '2.0.0', id: 'team.count', label: 'Count rows', icon: 'doc', hint: 'Counts the rows.', fields: {}, record: [{ name: 'rows', label: 'Rows', kind: 'number', min: '0' }, { name: 'matches', label: 'Matches', kind: 'yes-no' }] };

let written = null;
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 11 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo;
  await m.write('images/scratch.png', new Blob([new Uint8Array(G.PNG)], { type: 'image/png' }));
  await m.write('step-types/team.count.json', JSON.stringify(COUNT, null, 2) + '\n');
  let d = await repo.loadAll(m);
  const customTypes = { 'team.restore': NEW.types.customType(G.STEP_TYPE), 'team.count': NEW.types.customType(COUNT) };
  const res = await repo.publish(m, TYPED, { people: G.PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes: 'Typed details', existing: d.processes[0].index.all.map(p => p.info), now: AT, app: '2.0.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  d = await repo.loadAll(m);
  const v2 = d.processes[0].index.latest;
  assert.strictEqual(v2.info.version, 2);
  const r = NEW.run.create(v2, { title: 'Typed October', details: { ticket: 'ABC-110', rows: '1,234', due: '2026-10-31', approved: 'yes', env: 'prod' }, from: { source: 'plan', details: { ticket: 'ABC-110', rows: '1,234', due: '2026-10-31', approved: 'yes', env: 'prod' } },
    roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: 'w-avery', now: AT, id: 'run-y', app: '2.0.0' });
  await repo.saveRun(m, r, 'w-avery');
  written = { files: H.filesOf(m), folder: v2.info.folder };
  return written;
}

rule('This version publishes a typed checklist as /2 naming typed-details and typed-evidence; its run is run/3 with a migration record', async () => {
  const { files, folder: f2 } = await folder();
  const info = JSON.parse(files['publications/backup/' + f2 + '/publication.json']);
  same([info.format, info.features], ['preflight-publication/2', ['typed-details', 'typed-evidence']]);
  same(JSON.parse(files['publications/backup/' + f2 + '/types.json'])['team.count'].version, 3);
  const r = JSON.parse(files['runs/backup/run-y/run.json']);
  same([r.format, r.features, r.details.rows, r.migrations.map(x => [x.path, x.verdict])], ['preflight-run/3', ['typed-details', 'typed-evidence'], '', [['details.rows', 'ambiguous']]]);
});

TAGS.forEach((t) => rule(t.tag + ': names the typed /2 version unusable, lists the typed run/3 by name only, can\'t use the 2.0 step type, and writes nothing (2.0.0: reads and uses all three)', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, folder: f2 } = await folder(), m = H.memFolder(OLD, files);
  const d = await OLD.repo.loadAll(m, { deep: true }), proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  if (t.major >= 2) {
    assert.strictEqual(proc.index.latest.info.version, 2, 'the typed version is the latest');
    const y2 = d.runs.find(r => r.id === 'run-y');
    assert.ok(y2 && !y2._unrunnable && y2.migrations.length === 1 && y2.details.rows === '', 'the typed run, in full, with its open migration: ' + (y2 && y2._unrunnable));
    same(OLD.types.checkCustom(COUNT), [], 'the 2.0 step type is usable');
    return;
  }
  assert.strictEqual(proc.index.latest.info.version, 1, 'the /1 version stays the latest');
  const v2 = (proc.pubs || []).find(x => x.folder === f2);
  assert.ok(v2 && !v2.ok && v2.unusable, 'the typed version is unusable: ' + JSON.stringify(v2 && v2.why));
  const y = d.runs.find(r => r.id === 'run-y');
  assert.ok(y && y._unrunnable && !Object.keys(y.steps).length && y.title === 'Typed October', 'the typed run: its name only');
  const before = snap(m);
  await assert.rejects(() => OLD.repo.saveRun(m, y, 'w-avery'));
  assert.strictEqual(snap(m), before, 'nothing written');
  // The 2.0 step type is broken there: refused by name (1.21) or for the envelope it doesn't know.
  assert.ok(OLD.types.checkCustom(COUNT).length > 0, t.tag + ' would use the 2.0 step type');
}));

TAGS.forEach((t) => rule(t.tag + ': a typed draft is one it won\'t publish (its context line or its evidence is refused; 2.0.0 publishes it)', () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  if (t.major >= 2) {
    const ok = OLD.map.parse(TYPED), types = { 'team.restore': OLD.types.customType(G.STEP_TYPE), 'team.count': OLD.types.customType(COUNT) };
    same((ok.errors || []).map(e => e.msg).concat(OLD.map.check(ok, { people: G.PEOPLE, types }).blockers), [], 'nothing stops it');
    return;
  }
  const map = OLD.map.parse(TYPED), types = { 'team.restore': OLD.types.customType(G.STEP_TYPE) };
  const errors = (map.errors || []).map(e => e.msg || e.message || String(e)).concat(OLD.map.check(map, { people: G.PEOPLE, types }).blockers);
  assert.ok(errors.length, t.tag + ' would publish a typed draft');
  const ctxOnly = G.CHECKLIST.replace('context: ticket', 'context: ticket, rows:number');
  const m2 = OLD.map.parse(ctxOnly), e2 = (m2.errors || []).map(e => e.msg || e.message || String(e)).concat(OLD.map.check(m2, { people: G.PEOPLE, types }).blockers);
  assert.ok(e2.length, t.tag + ' would publish a typed context line as a plain detail named "rows:number"');
}));

run();
