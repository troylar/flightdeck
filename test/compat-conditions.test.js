// Conditions (2.1 slice 2) against real older releases. A checklist with "only when" publishes as preflight-publication/2
// naming the conditions feature, and its runs are preflight-run/3 naming it too: every copy from 1.11.1 through 2.0.0 names
// the version unusable (2.0.0 says it needs Flightdeck 2.1), lists the run by name only and writes nothing. No older copy
// publishes a draft with "only when".
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');

const TAGS = H.bundles.tags().filter(t => t.supported);
const AT = '2026-10-21T12:00:00.000Z';
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

const COND = G.CHECKLIST.replace('context: ticket', 'context: ticket, risk:choice(low|high)')
  .replace('  evidence: link\n', '  evidence: link\n  only when ^risk is high\n')
  .replace('## Close {#close}\n', '## Close {#close}\n  only when ^ticket is set\n');

let written = null;
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 12 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo;
  await m.write('images/scratch.png', new Blob([new Uint8Array(G.PNG)], { type: 'image/png' }));
  let d = await repo.loadAll(m);
  const customTypes = { 'team.restore': NEW.types.customType(G.STEP_TYPE) };
  const res = await repo.publish(m, COND, { people: G.PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes: 'Conditions', existing: d.processes[0].index.all.map(p => p.info), now: AT, app: '2.1.0' });
  assert.ok(res && !res.blockers, JSON.stringify(res && res.blockers));
  d = await repo.loadAll(m);
  const v2 = d.processes[0].index.latest;
  assert.strictEqual(v2.info.version, 2);
  const r = NEW.run.create(v2, { title: 'Conditional October', details: { ticket: 'ABC-120', risk: 'high' }, roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: 'w-avery', now: AT, id: 'run-k', app: '2.1.0' });
  await repo.saveRun(m, r, 'w-avery');
  written = { files: H.filesOf(m), folder: v2.info.folder };
  return written;
}

rule('This version publishes a checklist with "only when" as /2 naming conditions, stamped 2.1; its run is run/3 naming conditions', async () => {
  const { files, folder: f2 } = await folder();
  const info = JSON.parse(files['publications/backup/' + f2 + '/publication.json']);
  same([info.format, info.features, info.app], ['preflight-publication/2', ['typed-details', 'conditions'], '2.1.0']);
  const r = JSON.parse(files['runs/backup/run-k/run.json']);
  same([r.format, r.features], ['preflight-run/3', ['typed-details', 'conditions']]);
});

TAGS.forEach((t) => rule(t.tag + ': names the version with conditions unusable, lists its run by name only, and writes nothing' + (t.major >= 2 ? ' (it needs Flightdeck 2.1)' : ''), async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, folder: f2 } = await folder(), m = H.memFolder(OLD, files);
  const d = await OLD.repo.loadAll(m, { deep: true }), proc = d.processes.find(p => (p.process || p.id) === 'backup') || d.processes[0];
  assert.strictEqual(proc.index.latest.info.version, 1, 'the /1 version stays the latest');
  const v2 = (proc.pubs || []).find(x => x.folder === f2);
  assert.ok(v2 && !v2.ok && v2.unusable, 'the version is unusable: ' + JSON.stringify(v2 && v2.why));
  if (t.major >= 2) assert.ok(/needs Flightdeck 2\.1/i.test(v2.why), 'and says which release reads it: ' + v2.why);
  const k = d.runs.find(r => r.id === 'run-k');
  assert.ok(k && k._unrunnable && !Object.keys(k.steps).length && k.title === 'Conditional October', 'the run: its name only');
  if (t.major >= 2) assert.ok(/2\.1/.test(k._unrunnable), 'and why: ' + k._unrunnable);
  const before = snap(m);
  await assert.rejects(() => OLD.repo.saveRun(m, k, 'w-avery'));
  assert.strictEqual(snap(m), before, 'nothing written');
}));

TAGS.forEach((t) => rule(t.tag + ': a draft with "only when" is one it won\'t publish', () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const map = OLD.map.parse(COND), types = { 'team.restore': OLD.types.customType(G.STEP_TYPE) };
  const errors = (map.errors || []).map(e => e.msg || e.message || String(e)).concat(OLD.map.check(map, { people: G.PEOPLE, types }).blockers);
  assert.ok(errors.length, t.tag + ' would publish a draft with "only when"');
  const plain = COND.replace('context: ticket, risk:choice(low|high)', 'context: ticket, risk');
  const m2 = OLD.map.parse(plain), e2 = (m2.errors || []).map(e => e.msg || e.message || String(e)).concat(OLD.map.check(m2, { people: G.PEOPLE, types }).blockers);
  assert.ok(e2.some(e => /only when/i.test(e)), t.tag + ' says what it didn\'t understand: ' + e2.join(' | '));
}));

run();
