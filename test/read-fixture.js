// A small team folder for the READ tests (flightdeck processes, process, runs, run, next, followups): one published checklist,
// a running run with people in its roles, an ended run with a follow-up and a decision on it, and a planned run. Synthetic
// people only (their people.json entries carry emails, so a test can prove they never leave). files() gives {path: text};
// toDisk() writes them into a real folder with old file times, so nothing in it looks like a save still in progress.
'use strict';
const fs = require('fs'), path = require('path');
const { example, exampleSetup, sampleDone, completeRun } = require('./harness');

const NOW = '2026-10-20T09:00:00.000Z';
const OLD = new Date('2026-01-01T00:00:00.000Z');

async function build(PF) {
  const R = PF.run, repo = PF.repo, EX = exampleSetup(PF);
  const people = example('people.json'), md = example('maps/drafts/release.md');
  const mem = new PF.fs.MemoryFS('read:' + Math.random(), null);
  mem.reset({ 'people.json': people, 'maps/drafts/release.md': md, 'proposals/plan-release-2026-10-24.json': example('proposals/plan-release-2026-10-24.json') });
  const pub = await repo.publish(mem, md, { people: JSON.parse(people), ...EX, by: 'person-avery', changes: 'First version', existing: [], now: NOW, rand: 'aaaa1111' });
  if (pub.blockers) throw new Error(String(pub.blockers));
  const d = await repo.loadAll(mem), v1 = d.processes[0].index.latest;
  const roles = { 'release-lead': 'person-casey', qa: 'person-morgan', backend: 'person-blake' };
  const r1 = R.create(v1, { title: 'Release 2026.10.20', details: { ticket: 'ABC-200', commit: 'aaa111', environment: 'production' }, roles, by: 'person-casey', session: 'w1', now: NOW, id: 'run1' });
  const map = R.mapOf(r1);
  sampleDone(PF)(r1, map, map.phases[0].steps[0].id, 'person-casey', NOW);
  await repo.saveRun(mem, r1, 'w1');
  const r2 = R.create(v1, { title: 'Release 2026.10.13', details: { ticket: 'ABC-100', commit: 'bbb222', environment: 'production' }, roles, by: 'person-casey', session: 'w1', now: '2026-10-13T09:00:00.000Z', id: 'run2' });
  completeRun(PF, r2, '2026-10-13T10:00:00.000Z');
  r2.state = 'completed'; r2.ended = { outcome: 'Completed', by: 'person-casey', byName: 'Casey Nguyen', at: '2026-10-13T10:00:00.000Z' };
  r2.followUps.push({ id: 'fu1', text: 'Rotate the deploy key', owner: 'person-blake', ticket: '', step: '', from: '', by: 'person-casey', at: '2026-10-13T10:00:00.000Z' });
  r2.followUps.push({ id: 'fu2', text: 'Write down the rollback steps', owner: 'person-morgan', ticket: '', step: '', from: '', by: 'person-casey', at: '2026-10-13T10:00:00.000Z' });
  await repo.saveRun(mem, r2, 'w1');
  const files = {};
  Object.keys(mem.files).forEach(p => { files[p] = mem.files[p].t; });
  files['followups/release/run2.fu1.w2.1.json'] = JSON.stringify({ kind: 'followup-decision', fv: 1, process: 'release', run: 'run2', followUp: 'fu1', status: 'ticket', ticket: 'ABC-124', by: 'person-blake', at: '2026-10-14T09:00:00.000Z', rev: 1, seen: null }, null, 2) + '\n';
  return { files, folder: v1.info.folder, people: JSON.parse(people) };
}

function toDisk(files, dir) {
  Object.keys(files).forEach(p => {
    const f = path.join(dir, ...p.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, files[p]);
    fs.utimesSync(f, OLD, OLD);
  });
  return dir;
}

module.exports = { build, toDisk, NOW, OLD };
