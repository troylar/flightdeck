// Loops (3.0) against real older releases. A checklist with a {for.each} step publishes as preflight-publication/2 with the
// loops feature; its run and each item's child run (parent.item) are preflight-run/3 naming loops; a scope request in
// proposals/ is flightdeck-plan/3 naming loops. Every recorded copy (each one before 3.0) refuses the version and the runs
// by name, can't publish the draft, never offers the scope request as a plan, and writes nothing. The baseline folder's
// /1 version and its run/2 stay recordable. Below the floor (1.10.0, 1.11.0) the characterization stands.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');
const { cmp } = require('../tools/old-bundles');
const { expects } = require('./compat-matrix');

const TAGS = H.bundles.tags().filter(t => !expects('loops', t.version));
const AT = '2026-11-07T12:00:00.000Z';
const below = (v) => cmp(v, H.bundles.FLOOR) < 0;
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

const CHILD = ['---', 'process: validate-story', 'title: Validate a story', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', '---', '', '## Stories · DO-CONFIRM {#stories}',
  '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', ''].join('\n');

let written = null;
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 31 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo, LP = NEW.loop;
  let res = await repo.publish(m, CHILD, { people: G.PEOPLE, customTypes: {}, workflows: {}, by: 'person-avery', changes: 'First', existing: [], now: AT, app: '3.0.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  let d = await repo.loadAll(m);
  res = await repo.publish(m, PARENT, { people: G.PEOPLE, customTypes: {}, workflows: {}, by: 'person-avery', changes: 'First', existing: [], now: AT, app: '3.0.0', processes: d.processes });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  d = await repo.loadAll(m);
  const pick = (id) => d.processes.find(p => p.process === id).index.latest;
  const procOf = (id) => { const x = d.processes.find(p => p.process === id); return x ? { latest: x.index.latest, all: x.index.all, clashes: x.index.clashes, broken: [] } : null; };
  const pv = pick('release-readiness'), cv = pick('validate-story');
  const r = NEW.run.create(pv, { id: 'run-l', title: 'Release 4.1', by: 'person-avery', session: 'w-avery', now: AT, app: '3.0.0', pins: NEW.pins.atStart(pv.map, pv.info.payload ? pv.info.payload.pins : null, procOf) });
  await repo.saveRun(m, r, 'w-avery');
  const c = NEW.run.create(cv, { id: 'run-k', title: 'ABC-101', by: 'person-avery', session: 'w-avery', now: AT, app: '3.0.0', details: { issue: 'ABC-101' },
    parent: { process: 'release-readiness', id: 'run-l', step: 'each', item: { uid: 'jira:10101', key: 'ABC-101', attempt: 1 } } });
  await repo.saveRun(m, c, 'w-avery');
  const ci = LP.cleanIntent({ loop: { process: 'release-readiness', run: 'run-l', step: 'each' }, changes: [{ op: 'add', item: { id: '10101', key: 'ABC-101', title: 'Checkout' } }] }, 'import-1', { name: 'release-helper', version: '1.0' });
  same(ci.errors, []);
  const f = LP.buildRequest(ci.intent, { seen: [], children: [], now: AT, app: '3.0.0' });
  await repo.saveScope(m, f.id + '.json', f);
  written = { files: H.filesOf(m), pf: pv.info.folder, cf: cv.info.folder, req: f.id };
  return written;
}

rule('This version publishes a loop as /2 with loops, its run and an item\'s run as run/3 naming loops, and a scope request as plan/3', async () => {
  const { files, pf, req } = await folder();
  const two = JSON.parse(files['publications/release-readiness/' + pf + '/publication.json']);
  same([two.format, two.features.indexOf('loops') >= 0], ['preflight-publication/2', true]);
  const k = JSON.parse(files['runs/validate-story/run-k/run.json']);
  same([k.format, k.features.indexOf('loops') >= 0, k.parent.item.key], ['preflight-run/3', true, 'ABC-101']);
  const q = JSON.parse(files['proposals/' + req + '.json']);
  same([q.format, q.features], ['flightdeck-plan/3', ['loops']]);
});

TAGS.forEach((t) => rule(t.tag + (t.supported ? '' : ' (below the floor)') + ': refuses the loop version and both runs by name, can\'t publish the draft, never offers the scope request, writes nothing; still records the run/2 on the /1 version', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, pf, req } = await folder(), m = H.memFolder(OLD, files);
  const d = await OLD.repo.loadAll(m, { deep: true });
  const proc = d.processes.find(p => (p.process || p.id) === 'release-readiness');
  const runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  if (below(t.version)) return;
  const v = proc && (proc.pubs || []).find(x => x.folder === pf);
  assert.ok(!proc || !proc.index.latest || (v && !v.ok), t.tag + ' doesn\'t offer the loop version');
  assert.ok(v && !v.ok && v.unusable, 'the loop version is unusable: ' + JSON.stringify(v && v.why));
  if (cmp(t.version, '2.0.0') >= 0) assert.ok(/needs Flightdeck 3\.0/i.test(String(v.why)), t.tag + ' names the version it needs: ' + v.why);
  ['run-l', 'run-k'].forEach((id) => assert.ok(runs[id] && runs[id]._unrunnable && !Object.keys(runs[id].steps).length, id + ': name only, read-only'));
  assert.ok(!(d.plans || []).some(p => p.id === req), t.tag + ' never offers the scope request as a plan');
  const before = snap(m);
  await assert.rejects(() => OLD.repo.saveRun(m, runs['run-l'], 'w-avery'));
  await assert.rejects(() => OLD.repo.saveRun(m, runs['run-k'], 'w-avery'));
  assert.strictEqual(snap(m), before, 'nothing written');
  let res = null;
  try { res = await OLD.repo.publish(m, PARENT, { people: G.PEOPLE, customTypes: {}, workflows: {}, by: 'person-avery', changes: 'Again', existing: proc.index.all.map(p => p.info), now: AT }); } catch (e) { res = { threw: e.message }; }
  assert.ok(res && (res.threw || (res.blockers && res.blockers.length)), t.tag + ' doesn\'t publish it: ' + JSON.stringify(res && (res.blockers || res.threw)).slice(0, 300));
  assert.strictEqual(snap(m), before, 'publishing wrote nothing');
  const a = runs['run-a'];
  assert.ok(a && !a._unrunnable, t.tag + ' can record it: ' + (a && a._unrunnable));
  a.recorder.session = 'w-avery';
  OLD.run.done(a, OLD.run.mapOf(a), 'where', 'person-blake', AT, { evidence: 'https://example.com/copies/2026-11' });
  await OLD.repo.saveRun(m, a, 'w-avery');
  const NEW = H.loadMain(), back = (await NEW.repo.loadAll(H.memFolder(NEW, H.filesOf(m)))).runs.find(r => r.id === 'run-a');
  assert.ok(!back._unrunnable && back.steps.where && back.steps.where.s === 'done', 'this version reads what ' + t.tag + ' recorded');
}));

run();
