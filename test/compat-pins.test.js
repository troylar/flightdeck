// 2.0 pins (slice 2 part 2) against real older releases: what this version's own writers write, read by every tagged copy
// from the floor on. A version that pins a linked run (version:) is /2 and refused by name; a plan pinned to an exact folder
// is plan/2 and never shown, so an older copy can never start it on the latest; a skill registered with flightdeck skill
// register leaves a tombstone an older copy refuses to match; a run/2 parent this version writes is recorded by older
// copies and back, with its child pending; the run/3 offered for it ("Start it as a Flightdeck 2.0 run") is name-only there,
// and the old parent stays fully readable. Below the floor (1.10.0, 1.11.0) there is no format check: characterization only.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const H = require('./compat-harness');
const G = require('../tools/old-folders');

const TAGS = H.bundles.tags();
const AT = '2026-10-20T12:00:00.000Z';
const snap = (m) => JSON.stringify(Object.keys(m.files).sort().map(p => [p, m.files[p].t]));

const CHILD = ['---', 'process: verify', 'title: Verify the copy', 'context: ticket', '---', '', '## Check {#check}', '- [ ] {confirm} Open the copy {#open}', ''].join('\n');
const PARENT = ['---', 'process: nightly', 'title: Nightly', 'context: ticket', 'roles: lead', '---', '', '## Run {#run}', '- [ ] {run.process} Verify the copy @lead {#verify}', '  process: verify', '- [ ] {confirm} Note it @lead {#note}', ''].join('\n');
const LINKED = '- [ ] {run.process} Verify the copy @lead {#verify}\n  process: verify\n';
const PINNED = G.CHECKLIST.replace('- [ ] {confirm} File the report @lead {#report}', LINKED + '  version: 1\n- [ ] {confirm} File the report @lead {#report}');

/* This version's own writers: the baseline folder, a child process and a parent on /1, v2 of backup pinning its child (/2),
   a run/2 parent with its child pending, one continued as a 2.0 run, a plan/2 with a switch, and a registered skill. */
let written = null;
async function folder() {
  if (written) return written;
  const NEW = H.loadMain({ at: AT, seed: 11 }), m = H.memFolder(NEW, await G.main()), repo = NEW.repo, R = NEW.run;
  const customTypes = { 'team.restore': NEW.types.customType(G.STEP_TYPE) };
  const opts = (existing, changes) => ({ people: G.PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes, existing, now: AT, app: '2.0.0' });
  const ok = (res, what) => { assert.ok(res && !res.blockers, what + ': ' + JSON.stringify(res && res.blockers)); return res; };
  ok(await repo.publish(m, CHILD, opts([], 'First')), 'verify');
  ok(await repo.publish(m, PARENT, opts([], 'First')), 'nightly');
  let d = await repo.loadAll(m);
  const backup = d.processes.find(p => p.process === 'backup');
  ok(await repo.publish(m, PINNED, opts(backup.index.all.map(p => p.info), 'Verify the copy, v1 of it')), 'backup v2');
  d = await repo.loadAll(m);
  const pubOf = (id) => d.processes.find(p => p.process === id).index, v1 = pubOf('backup').all.find(p => p.info.version === 1), v2 = pubOf('backup').all.find(p => p.info.version === 2) || null;
  const nightly = pubOf('nightly').latest, verify = pubOf('verify').latest;
  const two = JSON.parse(H.filesOf(m)['publications/backup/' + (await m.list('publications/backup')).map(x => x.name).find(n => /^v2-/.test(n)) + '/publication.json']);
  // A run/2 parent with its child pending.
  const base = { by: 'person-avery', session: 'w-avery', now: AT, app: '2.0.0' };
  const p = R.create(nightly, Object.assign({ id: 'run-p', title: 'Nightly October', details: { ticket: 'ABC-300' }, roles: { lead: 'person-avery' } }, base));
  const k = R.create(verify, Object.assign({ id: 'run-k', title: 'Verify for Nightly', details: { ticket: 'ABC-300' }, roles: {}, parent: { process: 'nightly', id: 'run-p', step: 'verify', inputs: { ticket: 'ABC-300' } } }, base));
  R.linkChild(p, R.mapOf(p), 'verify', { process: 'verify', id: 'run-k', inputs: { ticket: 'ABC-300' } }, 'person-avery', AT);
  await repo.saveRun(m, k, 'w-avery'); await repo.saveRun(m, p, 'w-avery');
  // A run/2 parent continued as a Flightdeck 2.0 run, and its step blocked "Continued in run".
  const q = R.create(nightly, Object.assign({ id: 'run-q', title: 'Nightly November', details: { ticket: 'ABC-301' }, roles: { lead: 'person-avery' } }, base));
  const procOf = (id) => { const x = pubOf(id); return x ? { latest: x.latest, all: x.all, clashes: x.clashes, broken: [] } : null; };
  const x = R.continuation(q, nightly, Object.assign({ id: 'run-x', pins: NEW.pins.atStart(nightly.map, null, procOf) }, base));
  R.continued(q, R.mapOf(q), 'verify', x, 'person-avery', AT);
  await repo.saveRun(m, x, 'w-avery'); await repo.saveRun(m, q, 'w-avery');
  // A plan pinned to v1's exact folder: plan/2, and a person's switch to v2.
  const plan = NEW.plans.make(v1, { id: 'plan-backup-exact', process: 'backup', title: 'Backup check December', details: { ticket: 'ABC-302' }, roles: { lead: 'person-avery' }, by: 'person-avery', created: AT }, true, '2.0.0');
  ok(await repo.savePlan(m, plan, {}), 'the plan');
  const loaded = (await repo.loadAll(m)).plans.find(x2 => x2.id === plan.id);
  await repo.recordPlanStatus(m, loaded, 'w-avery', 'retargeted', null, 'person-avery', { folder: two.folder, version: 2 }, '2.0.0');
  // A skill registered against v1's exact folder, the way flightdeck skill register writes it.
  const reg = NEW.skills.registration({ name: 'backup-report', version: '2.0.0', location: 'https://example.com/skills/backup-report', implements: { process: 'backup', folder: v1.info.folder } }, procOf('backup'), null, { app: '2.0.0', now: AT, by: 'person-avery', window: 'w-avery', rand: 'cccc3333' });
  assert.ok(reg.rec, reg.why);
  await m.write(reg.path, JSON.stringify(reg.rec, null, 2) + '\n');
  await m.write('skills/backup-report.json', JSON.stringify(NEW.skills.tombstone(reg.rec), null, 2) + '\n');
  written = { files: H.filesOf(m), v2: two, plan: plan.id, v2pub: v2 };
  return written;
}

rule('This version writes a /2 version for version:, run/2 parents with a pending child, a run/3 continuation on /1, a plan/2 with a switch, and a skill registration with its tombstone', async () => {
  const { files, v2 } = await folder(), NEW = H.loadMain(), d = await NEW.repo.loadAll(H.memFolder(NEW, files), { deep: true });
  assert.strictEqual(v2.format, 'preflight-publication/2'); assert.deepStrictEqual(v2.features, ['pinned-children']);
  assert.deepStrictEqual(Object.keys(v2.payload.pins.children), ['verify']);
  const runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  assert.deepStrictEqual(['run-p', 'run-k', 'run-q', 'run-x'].map(id => runs[id].format), ['preflight-run/2', 'preflight-run/2', 'preflight-run/2', 'preflight-run/3']);
  assert.ok(!runs['run-x']._unrunnable && runs['run-x'].pins.children.verify, 'the continuation pins its child');
  assert.strictEqual(runs['run-q'].steps.verify.reason, 'Continued in run nightly/run-x');
  const plan = d.plans.find(p => p.id === 'plan-backup-exact');
  assert.ok(plan && plan.format === 'flightdeck-plan/2' && plan._retarget && plan._retarget.to.version === 2);
  const sk = d.skills.filter(s => (s.skill && s.skill.name === 'backup-report') || s.file === 'backup-report.json');
  assert.ok(sk.length === 1 && sk[0].skill.regId === 'sk-cccc3333' && !sk[0].errors.length, JSON.stringify(sk.map(s => [s.file, s.errors])));
});

TAGS.forEach((t) => rule(t.tag + (t.supported ? '' : ' (below the floor)') + ': refuses the pinned /2 version by name, never shows the plan/2, refuses the tombstoned skill, reads the run/3 continuation by name only, and records the run/2 parents this version wrote', async () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const { files, v2, plan } = await folder(), m = H.memFolder(OLD, files);
  const d = await OLD.repo.loadAll(m, { deep: true });
  const backup = d.processes.find(p => (p.process || p.id) === 'backup');
  const runs = Object.fromEntries(d.runs.map(r => [r.id, r]));
  if (!t.supported) {
    // H7: no format check before 1.11.1, so the /2 version is offered as the latest; the plan/2 still has no kind, so it
    // isn't listed as a plan either.
    assert.ok(!d.plans.some(p => p.id === plan), 'below the floor the plan/2 isn\'t a plan either');
    return;
  }
  // The pinned /2 version: unusable, named with the Flightdeck it needs, and never the latest.
  const pub = (backup.pubs || []).find(x => x.folder === v2.folder);
  assert.ok(pub && !pub.ok && pub.unusable && /needs Flightdeck 2\.0|newer Flightdeck|Update Flightdeck/.test(pub.why), JSON.stringify(pub && pub.why));
  assert.strictEqual(backup.index.latest.info.version, 1);
  // plan/2: not a plan here, so it can never start on the latest.
  assert.ok(!d.plans.some(p => p.id === plan), 'the plan/2 is never shown');
  // The tombstone: never matched to a version by number.
  const sk = d.skills.find(s => s.file === 'backup-report.json');
  assert.ok(sk && sk.errors.length, 'the tombstone is refused: ' + JSON.stringify(sk));
  assert.ok(!d.skills.some(s => s.skill && s.skill.name === 'backup-report' && !(s.errors || []).length), 'no copy of the skill is matched');
  // The run/3 continuation: its name only; the old parent, fully, with its step blocked where it continued.
  const x = runs['run-x'], q = runs['run-q'];
  assert.ok(x && x._unrunnable && !Object.keys(x.steps).length, 'run/3: its name only');
  assert.ok(q && !q._unrunnable && q.steps.verify.s === 'blocked' && q.steps.verify.reason === 'Continued in run nightly/run-x', JSON.stringify(q && q.steps.verify));
  const before = snap(m);
  await assert.rejects(() => OLD.repo.saveRun(m, x, 'w-avery'));
  assert.strictEqual(snap(m), before, 'nothing written');
  // The run/2 parent with its child pending: this copy takes over recording and saves; this version reads it back, still
  // linked, and can hand it on (the child is a run/2); the older copy picks it up again.
  const p = runs['run-p'];
  assert.ok(p && !p._unrunnable && p.steps.verify.child.id === 'run-k', t.tag + ' reads the parent: ' + (p && p._unrunnable));
  OLD.run.takeOver(p, 'person-blake', 'w-blake', AT);
  await OLD.repo.saveRun(m, p, 'w-blake', { takeover: true });
  const NEW = H.loadMain(), nm = H.memFolder(NEW, H.filesOf(m)), nd = await NEW.repo.loadAll(nm, { deep: true }), np = nd.runs.find(r => r.id === 'run-p');
  assert.ok(!np._unrunnable && np.recorder.person === 'person-blake' && np.steps.verify.child.id === 'run-k', 'this version reads what ' + t.tag + ' recorded');
  NEW.run.handOff(np, 'person-avery', 'person-blake', AT, NEW.run.legacyLinks(np, (key) => nd.runs.find(r => r.process + '/' + r.id === key)));
  await NEW.repo.saveRun(nm, np, 'w-blake');
  const od = await OLD.repo.loadAll(H.memFolder(OLD, H.filesOf(nm)), { deep: true }), op = od.runs.find(r => r.id === 'run-p');
  assert.ok(!op._unrunnable && op.recorder.person === 'person-avery' && op.steps.verify.child.id === 'run-k', t.tag + ' reads the hand-off back');
}));

/* Every way the pin syntax can be written, alone and in pairs: what this version publishes as /1 must be a checklist every
   copy from the floor on accepts too, so syntax an older parser rejects is always /2 here. */
const BASE = G.CHECKLIST.replace('- [ ] {confirm} File the report @lead {#report}', LINKED + '- [ ] {run.skill} Write it up @lead {#writeup}\n  skill: backup-report\n- [ ] {confirm} File the report @lead {#report}');
const AT_LINK = '  process: verify\n', AT_SKILL = '  skill: backup-report\n', AT_CONFIRM = '- [ ] {confirm} File the report @lead {#report}\n';
const VARIANTS = {
  'version: 1': [AT_LINK, AT_LINK + '  version: 1\n'],
  'empty version:': [AT_LINK, AT_LINK + '  version:\n'],
  'version: 0': [AT_LINK, AT_LINK + '  version: 0\n'],
  'version: 1.5': [AT_LINK, AT_LINK + '  version: 1.5\n'],
  'version: v1': [AT_LINK, AT_LINK + '  version: v1\n'],
  'Version: 1': [AT_LINK, AT_LINK + '  Version: 1\n'],
  'skillVersion: 1.2.0': [AT_SKILL, AT_SKILL + '  skillVersion: 1.2.0\n'],
  'empty skillVersion:': [AT_SKILL, AT_SKILL + '  skillVersion:\n'],
  'skillVersion with a space': [AT_SKILL, AT_SKILL + '  skillVersion: 1 2\n'],
  'skillVersion on the linked step': [AT_LINK, AT_LINK + '  skillVersion: 1.2.0\n'],
  'version on a confirm step': [AT_CONFIRM, AT_CONFIRM + '  version: 1\n']
};
function variants() {
  const names = Object.keys(VARIANTS), out = [];
  names.forEach((a, i) => { out.push([a]); names.slice(i + 1).forEach(b => out.push([a, b])); });
  return out.map(ns => ({ name: ns.join(' + '), md: ns.reduce((md, n) => md.replace(VARIANTS[n][0], VARIANTS[n][1]), BASE) }));
}
const lineErrors = (PF, md) => { const map = PF.map.parse(md); return JSON.parse(JSON.stringify((map.errors || []).map(e => e.msg || e.message || String(e)).concat(PF.map.check(map, { people: G.PEOPLE, types: { 'team.restore': PF.types.customType(G.STEP_TYPE) } }).blockers))); };
rule('The pin syntax variants: every one this version accepts uses a 2.0 feature (so it publishes as /2)', () => {
  const NEW = H.loadMain();
  assert.deepStrictEqual(lineErrors(NEW, BASE), [], 'the base checklist is fine');
  const accepted = variants().filter(v => !lineErrors(NEW, v.md).length);
  assert.ok(accepted.length > 0);
  accepted.forEach(v => assert.ok(NEW.publish.features(NEW.map.parse(v.md)).length > 0, v.name + ' is accepted but would publish as /1'));
});
TAGS.filter(t => t.supported).forEach((t) => rule(t.tag + ': every pin-syntax checklist this version would publish as /1 is one it accepts too', () => {
  const OLD = H.loadCopy(t.tag); if (!OLD) return;
  const NEW = H.loadMain(), bad = [];
  assert.deepStrictEqual(lineErrors(OLD, BASE), [], 'the base checklist is fine there');
  variants().forEach(v => {
    if (lineErrors(NEW, v.md).length || NEW.publish.features(NEW.map.parse(v.md)).length) return;
    const theirs = lineErrors(OLD, v.md);
    if (theirs.length) bad.push(v.name + ': ' + theirs[0]);
  });
  assert.deepStrictEqual(bad, [], 'published as /1 here, refused there');
}));

run();
