// The team folder: two windows, one recorder, notes from everyone, conflicts kept visible.
'use strict';
const assert = require('assert');
const { load, example, exampleSetup, rule, run, sampleDone } = require('./harness');
const PF = load(), R = PF.run, repo = PF.repo;
const EX = exampleSetup(PF);
const done = sampleDone(PF);
const NOW = '2026-10-17T21:00:00.000Z';
// Objects from the sandbox have their own prototypes, so compare plain JSON copies.
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const people = example('people.json');

function folder() {
  const fs = new PF.fs.MemoryFS('test:' + Math.random(), null);
  fs.reset({ 'people.json': people, 'maps/drafts/release.md': example('maps/drafts/release.md'), 'skills/release-notes.json': example('skills/release-notes.json'), 'proposals/plan.json': example('proposals/plan-release-2026-10-24.json') });
  return fs;
}
async function published(fs) {
  const res = await repo.publish(fs, example('maps/drafts/release.md'), { people: JSON.parse(people), ...EX, by: 'person-avery', changes: 'First version', existing: [], now: NOW });
  assert.ok(!res.blockers, String(res.blockers));
  return repo.loadAll(fs);
}
async function started(fs) {
  const d = await published(fs);
  const pub = d.processes[0].index.latest;
  const r = R.create(pub, { title: 'Release', details: { commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'casey-laptop', now: NOW, id: 'run1' });
  await repo.saveRun(fs, r, 'casey-laptop');
  return r;
}

rule('Loading reads people, drafts, publications, skills and planned runs', async () => {
  const d = await published(folder());
  assert.strictEqual(d.people.length, 4);
  assert.strictEqual(d.people[0].email, 'avery@example.com');
  assert.strictEqual(d.drafts.length, 1);
  assert.strictEqual(d.processes[0].index.latest.info.version, 1);
  assert.strictEqual(d.skills[0].skill.name, 'release-notes'); assert.strictEqual(d.skills[0].skill.implements, 1);
  assert.strictEqual(d.plans[0].title, 'Release 2026.10.24');
});

rule('Publishing writes the publication record last, and a second publish becomes the next version', async () => {
  const fs = folder();
  await published(fs);
  const md = example('maps/drafts/release.md').replace('Production release', 'Production release (v2)');
  const d1 = await repo.loadAll(fs);
  await repo.publish(fs, md, { people: JSON.parse(people), ...EX, by: 'person-blake', changes: 'Renamed', existing: d1.processes[0].index.all.map(p => p.info), now: NOW });
  const d2 = await repo.loadAll(fs);
  assert.strictEqual(d2.processes[0].index.latest.info.version, 2);
  assert.strictEqual(d2.processes[0].index.all.length, 2, 'old versions stay');
});

rule('Only the recorder\'s window can save the run; another window\'s save is refused and nothing is overwritten', async () => {
  const fs = folder(), r = await started(fs);
  const copy = JSON.parse(JSON.stringify(r)); const map = R.mapOf(copy);
  done(copy, map, 'approved', 'person-avery', NOW);
  await assert.rejects(repo.saveRun(fs, copy, 'avery-desktop'), e => !!e.disk);
  const disk = await repo.loadRun(fs, 'release', 'run1');
  assert.ok(!disk.steps.approved, 'the refused change never reached the file');
});

rule('A save based on an older read is refused, even from the recorder', async () => {
  const fs = folder(), r = await started(fs);
  const stale = await repo.loadRun(fs, 'release', 'run1');
  done(r, R.mapOf(r), 'approved', 'person-casey', NOW);
  await repo.saveRun(fs, r, 'casey-laptop');
  await assert.rejects(repo.saveRun(fs, stale, 'casey-laptop'), e => !!e.disk);
});

rule('Hand off and pick up move recording to another person without conflicts', async () => {
  const fs = folder(), r = await started(fs);
  R.handOff(r, 'person-blake', 'person-casey', NOW);
  await repo.saveRun(fs, r, 'casey-laptop');
  const blakeCopy = await repo.loadRun(fs, 'release', 'run1');
  R.pickUp(blakeCopy, 'person-blake', 'blake-laptop', NOW);
  await repo.saveRun(fs, blakeCopy, 'blake-laptop');
  const disk = await repo.loadRun(fs, 'release', 'run1');
  same(disk.recorder, { person: 'person-blake', session: 'blake-laptop' });
});

rule('Taking over is explicit, and it\'s logged with who it was taken from', async () => {
  const fs = folder(); await started(fs);
  const mine = await repo.loadRun(fs, 'release', 'run1');
  R.takeOver(mine, 'person-avery', 'avery-desktop', NOW);
  await repo.saveRun(fs, mine, 'avery-desktop', { takeover: true });
  const disk = await repo.loadRun(fs, 'release', 'run1');
  assert.strictEqual(disk.recorder.person, 'person-avery');
  assert.ok(disk.log.some(l => /Took over recording from person-casey/.test(l.what)));
});

rule('Everyone can add notes: each window writes its own file, and all notes show up in order', async () => {
  const fs = folder(), r = await started(fs);
  await repo.addNote(fs, r, 'blake-laptop', { id: 'n2', at: '2026-10-17T21:05:00Z', by: 'person-blake', step: 'tests', text: 'Gate run 1842 green' });
  await repo.addNote(fs, r, 'avery-desktop', { id: 'n1', at: '2026-10-17T21:01:00Z', by: 'person-avery', step: 'tests', text: 'Started the gate' });
  await repo.addNote(fs, r, 'blake-laptop', { id: 'n3', at: '2026-10-17T21:06:00Z', by: 'person-blake', step: 'flags', text: 'Flags checked' });
  const disk = await repo.loadRun(fs, 'release', 'run1');
  same(disk._notes.map(n => n.id), ['n1', 'n2', 'n3']);
  const files = (await fs.list('runs/release/run1')).map(f => f.name).sort();
  same(files.filter(n => !/^candidate-/.test(n)), ['notes-avery-desktop.jsonl', 'notes-blake-laptop.jsonl', 'run.json']);
  assert.strictEqual(files.filter(n => /^candidate-/.test(n)).length, 1, 'the newest save\'s receipt stays until the next save');
});

rule('A OneDrive conflict copy of a run is detected and shown, never merged', async () => {
  const fs = folder(), r = await started(fs);
  await fs.write('runs/release/run1/run-CASEY-LAPTOP.json', JSON.stringify(r));
  const disk = await repo.loadRun(fs, 'release', 'run1');
  same(disk._conflicts, ['run-CASEY-LAPTOP.json']);
});

rule('Accepting a planned run records which exact plan was accepted', async () => {
  const fs = folder(); const d = await published(fs);
  const plan = d.plans[0];
  await repo.recordPlanStatus(fs, plan, 'casey-laptop', 'accepted', 'run1', 'person-casey');
  const d2 = await repo.loadAll(fs);
  assert.strictEqual(d2.plans[0]._status.status, 'accepted');
  assert.strictEqual(d2.plans[0]._status.proposalHash, plan._hash);
});

rule('Paths can\'t escape the team folder', async () => {
  const fs = folder();
  assert.throws(() => fs.write('../outside.json', 'x'));
  assert.throws(() => fs.write('runs/../../x', 'x'));
});

rule('A save is refused if the file changed at all since this window read it, even at the same revision', async () => {
  const fs = folder(), r = await started(fs);
  const disk = await repo.loadRun(fs, 'release', 'run1');
  const other = JSON.parse(await fs.read('runs/release/run1/run.json').then(f => f.text));
  other.title = 'Changed elsewhere';
  await fs.write('runs/release/run1/run.json', JSON.stringify(other));
  const map = R.mapOf(disk); done(disk, map, 'approved', 'person-casey', NOW);
  await assert.rejects(repo.saveRun(fs, disk, 'casey-laptop'), e => !!e.disk);
  const after = await repo.loadRun(fs, 'release', 'run1');
  assert.strictEqual(after.title, 'Changed elsewhere', 'the other change survived');
});

rule('An unreadable run file is never overwritten', async () => {
  const fs = folder(), r = await started(fs);
  await fs.write('runs/release/run1/run.json', '{ half a file');
  await assert.rejects(repo.saveRun(fs, r, 'casey-laptop'), e => !!e.unreadable);
  assert.strictEqual((await fs.read('runs/release/run1/run.json')).text, '{ half a file');
});

rule('Two screenshots saved in the same moment get different file names', async () => {
  const fs = folder(), r = await started(fs);
  const names = new Set();
  for (let i = 0; i < 5; i++) names.add(await repo.saveAttachment(fs, r, new Blob(['x'], { type: 'image/png' }), 'w').catch(() => 'x' + i));
  assert.strictEqual(names.size, 5);
});

rule('If an AI assistant changes a plan after someone accepted it, the plan is pending again', async () => {
  const fs = folder(); const d = await published(fs);
  await repo.recordPlanStatus(fs, d.plans[0], 'casey-laptop', 'accepted', 'run1', 'person-casey');
  const plan = JSON.parse((await fs.read('proposals/plan.json')).text); plan.title = 'Release 2026.10.25';
  await fs.write('proposals/plan.json', JSON.stringify(plan));
  const d2 = await repo.loadAll(fs);
  assert.strictEqual(d2.plans[0]._status, null);
  assert.ok(d2.plans[0]._changedAfterDecision);
});

rule('P1: a map can\'t publish while a screenshot it shows is missing, and a published screenshot is checked against its record', async () => {
  const fs = folder();
  const md = '---\nprocess: x\ntitle: X\n---\n## P · READ-DO {#p}\n- [ ] {confirm} Look {#a}\n  ![The job page](images/x/job.png)';
  const res = await repo.publish(fs, md, { people: JSON.parse(people), ...EX, by: 'a', changes: 'x', existing: [], now: NOW });
  assert.ok(res.blockers && /images\/x\/job\.png/.test(res.blockers[0]), 'missing screenshot blocks publishing');
  await fs.write('images/x/job.png', new Blob(['picture one'], { type: 'image/png' }));
  const ok = await repo.publish(fs, md, { people: JSON.parse(people), ...EX, by: 'a', changes: 'x', existing: [], now: NOW });
  assert.ok(!ok.blockers);
  const d = await repo.loadAll(fs, { deep: true });
  const pub = d.processes.filter(p => p.process === 'x')[0].index.latest;
  assert.ok(pub && pub.info.images && pub.info.images['images/x/job.png'], 'the publication records its screenshots');
  const fs2 = new PF.fs.MemoryFS('test:' + Math.random(), null); fs2.files = JSON.parse(JSON.stringify(fs.files));
  delete fs2.files['publications/x/' + ok.folder + '/images/x/job.png'];
  const d2 = await repo.loadAll(fs2, { deep: true });
  assert.ok(!d2.processes.filter(p => p.process === 'x')[0].pubs[0].ok, 'a publication missing its screenshot is not complete');
});

rule('P1: notes from a file are checked: odd shapes are dropped, never rendered', async () => {
  const fs = folder(), r = await started(fs);
  await fs.write('runs/release/run1/notes-x.jsonl', [JSON.stringify({ id: 'n1', at: NOW, by: 'a', step: 'approved', text: 'fine', files: 'not-a-list' }), JSON.stringify({ id: 'n2', at: NOW, by: 'a', step: 'approved', text: 'ok', files: ['runs/release/run1/files/a.png', '../../etc/passwd', 'javascript:x'] })].join('\n'));
  const back = await repo.loadRun(fs, 'release', 'run1');
  same(back._notes.map(n => n.files), [[], ['runs/release/run1/files/a.png']]);
});

rule('P2: an unchanged notes file isn\'t reread on every refresh', async () => {
  const fs = folder(), r = await started(fs);
  await repo.addNote(fs, r, 'w1', { id: 'n1', at: NOW, by: 'a', step: 'approved', text: 'one' });
  let reads = 0; const orig = fs.read.bind(fs); fs.read = p => { if (/notes-/.test(p)) reads++; return orig(p); };
  await repo.loadRun(fs, 'release', 'run1'); await repo.loadRun(fs, 'release', 'run1');
  assert.strictEqual(reads, 1);
  await repo.addNote(fs, r, 'w1', { id: 'n2', at: NOW, by: 'a', step: 'approved', text: 'two' });
  const back = await repo.loadRun(fs, 'release', 'run1');
  assert.strictEqual(back._notes.length, 2, 'a grown file is read again');
});

rule('R3: notes that change while being read are read again next time, not cached as old', async () => {
  const fs = folder(), r = await started(fs);
  await repo.addNote(fs, r, 'w1', { id: 'n1', at: NOW, by: 'a', step: 'approved', text: 'one' });
  const orig = fs.read.bind(fs); let once = true;
  fs.read = p => orig(p).then(f => { if (once && /notes-w1/.test(p)) { once = false; return repo.addNote(fs, r, 'w1', { id: 'n2', at: NOW, by: 'a', step: 'approved', text: 'two' }).then(() => f); } return f; });
  await repo.loadRun(fs, 'release', 'run1', null, true);
  fs.read = orig;
  const back = await repo.loadRun(fs, 'release', 'run1');
  assert.strictEqual(back._notes.length, 2);
});

rule('Skill registrations load one file at a time: bad JSON, arrays and unreadable files are listed with why', async () => {
  const fs = new PF.fs.MemoryFS('t', null);
  fs.reset({ 'people.json': people, 'skills/good.json': JSON.stringify({ name: 'good', implements: 'release@1' }), 'skills/broken.json': '{broken', 'skills/list.json': '[]', 'skills/same.json': JSON.stringify({ name: 'good', implements: 'release@1' }) });
  const d = await repo.loadAll(fs);
  same(d.skills.map(x => [x.file, x.skill ? x.skill.name : null, x.errors.length > 0]).sort(), [['broken.json', null, true], ['good.json', 'good', false], ['list.json', null, true], ['same.json', 'good', false]]);
  assert.ok(d.skills.every(x => !x.skill || x.skill.file), 'each registration knows its file');
});

rule('Sign-offs are read as plain values, so odd JSON can\'t break a page', async () => {
  const fs = new PF.fs.MemoryFS('t2', null);
  fs.reset({ 'people.json': people, 'validations/x.v1.a.json': JSON.stringify({ kind: 'validation', process: 'x', folder: 'v1-a', by: 'p', at: '2026-10-18', note: { toString: null }, version: { toString: null, valueOf: null } }) });
  const d = await repo.loadAll(fs);
  same([d.validations[0].note, d.validations[0].version], ['', 0]);
});

rule('A note on a step with a long ID still belongs to it after a reload', async () => {
  const fs = new PF.fs.MemoryFS('t3', null), id = 'c'.repeat(52);
  fs.reset({ 'people.json': people });
  const md = '---\nprocess: x\ntitle: X\n---\n## P · READ-DO {#p}\n- [ ] {confirm} A {#' + id + '}';
  await repo.publish(fs, md, { people: JSON.parse(people), by: 'a', changes: 'x', existing: [], now: NOW });
  const d0 = await repo.loadAll(fs), pub = d0.processes[0].index.latest;
  const r = R.create(pub, { title: 'T', by: 'a', session: 's', now: NOW });
  await repo.saveRun(fs, r, 's');
  await repo.addNote(fs, r, 's', { id: 'n1', at: NOW, by: 'a', step: id, text: 'hi' });
  const d = await repo.loadAll(fs);
  assert.strictEqual(d.runs[0]._notes[0].step, id);
});

rule('An unreadable skills folder is a folder error, not an empty list', async () => {
  const fs = new PF.fs.MemoryFS('t4', null);
  fs.reset({ 'people.json': people, 'skills/a.json': JSON.stringify({ name: 'a', implements: 'x@1' }) });
  const list = fs.list.bind(fs);
  fs.list = p => p === 'skills' ? Promise.reject(Object.assign(new Error('NotReadableError'), { name: 'NotReadableError' })) : list(p);
  await assert.rejects(repo.loadAll(fs), /NotReadable/);
});

run();
