// Baseline team folders written by older releases' own code (docs/design.md section 28). For each release in
// test/fixtures/old-bundles/record.json it loads that release's shipped core and storage (test/compat-harness.js), runs one fixed
// scenario on an in-memory folder using only the writers the capability matrix (test/compat-matrix.js) says it had, and
// writes the folder to test/fixtures/folders/<tag>/. The clock and random numbers are fixed, so the same release always
// writes the same bytes; test/compat.test.js writes each folder again and fails if it differs.
//   node tools/old-folders.js            check every committed folder against what its release writes now
//   node tools/old-folders.js --write    write them (after adding a release, or changing the scenario)
'use strict';
const path = require('path');
const H = require('../test/compat-harness');
const { expects } = require('../test/compat-matrix');

const DIR = path.join(__dirname, '..', 'test', 'fixtures', 'folders');
const AT = '2026-03-02T09:00:00.000Z';
const t = (min) => new Date(Date.parse(AT) + min * 60000).toISOString();

/* Files a person or an AI assistant writes by hand (no release writes them): the same in every folder. */
const PEOPLE = [
  { id: 'person-avery', name: 'Avery Lee', initials: 'AL', email: 'avery@example.com' },
  { id: 'person-blake', name: 'Blake Ortiz', initials: 'BO', email: 'blake@example.com' },
  { id: 'person-casey', name: 'Casey Nguyen', initials: 'CN', email: 'casey@example.com' }
];
const SEED = {
  'people.json': JSON.stringify(PEOPLE, null, 2) + '\n',
  'skills/backup-report.json': JSON.stringify({ name: 'backup-report', version: '1.0.0', location: 'https://example.com/skills/backup-report', implements: 'backup@1', description: 'Writes the backup report.' }, null, 2) + '\n'
};
/* A checklist every release from 1.10.0 on publishes: details, roles, a team step type, required evidence, a gate with a note. */
const CHECKLIST = [
  '---', 'process: backup', 'title: Backup check', 'category: Operations', 'owner: person-avery', 'context: ticket', 'roles: lead, checker', '---', '',
  '## Prepare {#prep}',
  '- [!] {confirm} Read the restore runbook @lead {#read}',
  '- [ ] {team.restore} Restore last night\'s backup ^ticket @checker {#restore}',
  '  system: billing',
  '- [ ] {confirm} Record where the copy is @checker {#where}',
  '  evidence: link', '',
  '## Gate: Restored {#restored}',
  '  > The restored copy opens and its row counts match.', '',
  '## Close {#close}',
  '- [ ] {confirm} File the report @lead {#report}', ''
].join('\n');
const STEP_TYPE = {
  id: 'team.restore', label: 'Restore a backup', icon: 'doc', hint: 'Restores a backup into a scratch copy.',
  fields: { system: { label: 'System', kind: 'text', required: true } },
  record: [{ name: 'copy', label: 'Restored copy', kind: 'text' }]
};
const S1 = 'w-avery', S2 = 'w-blake';

/* The scenario, as one release's own code writes it. Each block runs only where the matrix says the release has the writer.
   Returns the folder's files (path → text). */
async function generate(PF, version) {
  const has = (id) => expects(id, version);
  const repo = PF.repo, R = PF.run, m = H.memFolder(PF, SEED);
  const loaded = () => repo.loadAll(m);
  const ok = (res, what) => { if (!res || res.blockers || res.conflict) throw new Error(version + ': ' + what + ' failed: ' + JSON.stringify(res && (res.blockers || res))); return res; };

  ok(await repo.saveStepType(m, STEP_TYPE, null, {}), 'saving the step type');
  ok(await repo.saveDraft(m, 'backup.md', CHECKLIST, null, { expectText: null }), 'saving the draft');
  const customTypes = { 'team.restore': PF.types.customType(STEP_TYPE) };
  ok(await repo.publish(m, CHECKLIST, { people: PEOPLE, customTypes, workflows: {}, by: 'person-avery', changes: 'First version', existing: [], now: t(1) }), 'publishing');
  let d = await loaded();
  const pub = d.processes[0].index.latest, map = pub.map;

  // One run, answered in part, with a note.
  const r = R.create(pub, { title: 'Backup check March', details: { ticket: 'ABC-101' }, roles: { lead: 'person-avery', checker: 'person-blake' }, by: 'person-avery', session: S1, now: t(2), id: 'run-a' });
  await repo.saveRun(m, r, S1);
  R.done(r, map, 'read', 'person-avery', t(3), {});
  await repo.saveRun(m, r, S1);
  await repo.addNote(m, r, S2, { id: 'n-1', at: t(4), by: 'person-blake', session: S2, step: 'restore', text: 'The scratch database was slow to start.', files: [] });

  // A second run, finished, with a follow-up.
  const r2 = R.create(pub, { title: 'Backup check February', details: { ticket: 'ABC-100' }, roles: { lead: 'person-avery', checker: 'person-avery' }, by: 'person-avery', session: S1, now: t(5), id: 'run-b' });
  R.done(r2, map, 'read', 'person-avery', t(6), {});
  R.done(r2, map, 'restore', 'person-avery', t(7), { copy: 'scratch-2026-02' });
  R.done(r2, map, 'where', 'person-avery', t(8), { evidence: 'https://example.com/copies/2026-02' });
  R.pass(r2, map, 0, 'person-avery', t(9));
  R.done(r2, map, 'report', 'person-avery', t(10), {});
  R.pass(r2, map, 1, 'person-avery', t(10));
  R.addFollowUp(r2, { text: 'Automate the row count check' }, 'person-avery', t(11));
  R.end(r2, map, 'Completed', 'person-avery', 'Avery Lee', t(12));
  await repo.saveRun(m, r2, S1);

  await repo.recordValidation(m, pub, S1, 'person-avery', 'Ran it twice', { completed: 1, clean: 1, runs: ['run-b'] });

  if (has('plans')) {
    ok(await repo.savePlan(m, { kind: 'plan', id: 'plan-backup-april', process: 'backup', version: 1, title: 'Backup check April', details: { ticket: 'ABC-102' }, roles: { lead: 'person-avery', checker: 'person-casey' }, note: 'Casey checks this time.', by: 'AI assistant', created: t(13) }, {}), 'saving the plan');
    d = await loaded();
    const plan = d.plans.find(p => p.id === 'plan-backup-april');
    await repo.recordPlanStatus(m, plan, S1, 'declined', null, 'person-avery');
  }

  if (has('fixes')) {
    const note = PF.fixes.build({ id: 'f-1', at: t(14), by: 'person-blake', session: S2, kind: 'instructions', phase: 'prep', step: 'restore', text: 'Say which scratch server to use.', version: 1 });
    await repo.addNote(m, r, S2, note);
    d = await loaded();
    const s = PF.fixes.collect(d.runs, 'backup').find(x => x.id === 'f-1');
    await repo.decideFix(m, PF.fixes.decision(s, 'person-avery', 'accepted', '', t(15), { latestVersion: 1 }), S1);
  }

  if (has('corrections')) {
    const C = PF.corrections;
    await repo.addNote(m, r, S2, C.build({ id: 'c-1', at: t(16), by: 'person-blake', session: S2, map: R.mapOf(r), step: 'restore', op: 'wording', to: 'Restore last night\'s backup into the scratch server', version: 1, folder: r.folder }));
    d = await loaded();
    const g = C.groups(C.collect(d.runs, 'backup'))[0];
    await repo.decideCorrection(m, C.decision(g, 'person-avery', 'declined', 'The runbook says which server.', t(17), {}), S1);
  }

  if (has('people')) {
    const P = PF.people;
    d = await loaded();
    const doc = JSON.parse((await m.read(P.FILE)).text);
    ok(await repo.savePeople(m, P.text(P.add(doc, 'Morgan Diaz', 'morgan@example.com').doc), PF.util.hash(SEED['people.json']), {}), 'saving people');
  }

  if (has('followups')) {
    const F = PF.followups;
    d = await loaded();
    const x = F.list(d.runs, d.fuDecisions || []).find(f => f.run === 'run-b');
    await repo.decideFollowUp(m, F.decision(x, 'person-avery', 'ticket', { ticket: 'ABC-103' }, t(18), null), S1);
  }

  if (has('saved-history')) {
    const TL = PF.timeline;
    const line = TL.histLine({ kind: 'draft-edit', id: 'h-1', process: 'backup', writer: S1, seq: 1, by: 'person-avery', at: t(19), from: null, to: PF.util.hash(CHECKLIST), before: '', after: CHECKLIST, source: 'editor' });
    await repo.appendHistory(m, 'history/drafts/backup', S1, [line], {});
  }

  if (has('proposals')) {
    // An AI assistant's proposal, in the shape flightdeck draft propose writes, and a window's presence record.
    const PP = PF.proposals, p = PP.make({ id: 'p-mh4k2a-x7w1k3m9p2', process: 'backup', session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: t(20), app: PF.__version,
      base: { kind: 'draft', ref: 'maps/drafts/backup.md', text: CHECKLIST }, text: CHECKLIST.replace('title: Backup check', 'title: Backup check (proposed)'), replaces: null, after: null, note: '' });
    await m.write('proposed/backup/' + p.id + '.json', JSON.stringify(p, null, 2) + '\n');
    await repo.writePresence(m, PP.presence({ writer: S1, by: 'person-avery', device: 'Laptop', since: t(20), at: t(21), beat: 1, drafts: ['backup'], main: [] }));
  }

  return H.filesOf(m);
}

/* The folder each available release writes, by tag (skipped releases are left out). */
async function all() {
  const out = {};
  for (const x of H.bundles.tags()) {
    const PF = H.loadCopy(x.tag, { at: AT, seed: 7 });
    if (PF) out[x.tag] = await generate(PF, x.version);
  }
  return out;
}
/* This version's own folder from the same scenario (every writer it has), for the older releases to read. */
function main() { const PF = H.loadMain({ at: AT, seed: 7 }); return generate(PF, PF.__version); }

if (require.main === module) {
  (async () => {
    const got = await all(), write = process.argv.includes('--write'), bad = [];
    Object.keys(got).forEach(tag => {
      const dir = path.join(DIR, tag);
      if (write) { H.writeTree(dir, got[tag]); console.log('Wrote test/fixtures/folders/' + tag + '/ (' + Object.keys(got[tag]).length + ' files)'); return; }
      let have = {}; try { have = H.readTree(dir); } catch (e) { /* missing */ }
      if (JSON.stringify(have) !== JSON.stringify(got[tag])) bad.push(tag);
    });
    if (!write) { console.log(bad.length ? 'Differ from what the release writes: ' + bad.join(', ') + '. Run node tools/old-folders.js --write' : 'Every folder matches what its release writes'); process.exitCode = bad.length ? 1 : 0; }
  })().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { DIR, AT, SEED, CHECKLIST, STEP_TYPE, PEOPLE, generate, all, main };
