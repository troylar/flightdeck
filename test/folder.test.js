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

/* Flightdeck 1.16.1's run.js (test/fixtures/run-1.16.1.js): a copy that older team members may still be running. */
const OLD116 = () => load(false, (f, src) => f === 'core/run.js' ? require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'run-1.16.1.js'), 'utf8') : src);
rule('1.17 and 1.16.1 read and write a run the same way, times that can\'t be read included: no loss and no read-only copy either way', async () => {
  const OLD = OLD116(), fs = folder(), r = await started(fs);
  const raw = JSON.parse((await fs.read('runs/release/run1/run.json')).text);
  raw.pauses = [{ from: NOW, to: '2026-10-17T21:05:00.000Z', by: 'person-casey', reason: 'wait' }, { from: NOW, to: 'not a time', by: 'person-casey', reason: 'bad' }];
  raw.log.push({ at: 'not a time', by: 'person-casey', what: 'Reopened gate "x"' });
  raw.followUps = [{ id: 'f1', text: 'Do it', by: 'person-casey', at: 'not a time' }];
  raw.state = 'completed'; raw.ended = { outcome: 'Completed', by: 'person-casey', byName: 'Casey', at: 'not a time' };
  const strip = x => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => k[0] !== '_'))));
  same(strip(R.sanitize(JSON.parse(JSON.stringify(raw)))), strip(OLD.run.sanitize(JSON.parse(JSON.stringify(raw)))), 'the same shapes as 1.16.1');
  await fs.write('runs/release/run1/run.json', JSON.stringify(raw));
  // 1.17 reads it, flags what it can't read, and saves; 1.16.1 reads that and saves; 1.17 reads it again.
  const one = await repo.loadRun(fs, 'release', 'run1');
  assert.ok(one._badTimes && one._badTimes.pauses && one._badTimes.ended === 'Completed' && one._badTimes.log, '1.17 flags them until it saves');
  one.recorder.session = 'casey-laptop';
  await repo.saveRun(fs, one, 'casey-laptop');
  const old = await OLD.repo.loadRun(fs, 'release', 'run1');
  assert.ok(!old._unrunnable, '1.16.1 can record it');
  same(strip(old), strip(one), '1.16.1 reads exactly what 1.17 saved');
  old.recorder.session = 'casey-laptop';
  await OLD.repo.saveRun(fs, old, 'casey-laptop');
  const back = await repo.loadRun(fs, 'release', 'run1');
  assert.ok(!back._unrunnable && !back._badTimes, 'and 1.17 reads what 1.16.1 saved, writable');
  same([back.pauses.length, back.log.length, back.followUps.length, back.state], [one.pauses.length, one.log.length, one.followUps.length, 'completed'], 'nothing lost between them');
  assert.ok(r);
});

rule('Archived history keeps an entry whose time is missing or can\'t be read, past the 300 entries run.json keeps', async () => {
  const fs = folder(), r = await started(fs), map = R.mapOf(r);
  for (let i = 0; i < 320; i++) R.log(r, 'person-casey', new Date(Date.parse(NOW) + i * 1000).toISOString(), 'Entry ' + i);
  await repo.saveRun(fs, r, 'casey-laptop');
  await fs.append('runs/release/run1/history-old-copy.jsonl', JSON.stringify({ id: 'n1', kind: 'log', at: null, by: 'person-casey', what: 'No time' }) + '\n' + JSON.stringify({ id: 'n2', kind: 'answer', at: 'not a time', by: 'person-casey', step: 'x', s: 'done' }) + '\n');
  const h = await repo.loadHistory(fs, r);
  assert.ok(h.filter(x => /^Entry \d+$/.test(x.what)).length >= 20, 'the archived entries');
  same(h.slice(0, 2).map(x => x.id).sort(), ['n1', 'n2'], 'those without a usable time are kept, first');
  assert.ok(map);
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

rule('An unreadable skills folder is named as unread, never an empty list, and the rest of the folder still loads', async () => {
  const fs = new PF.fs.MemoryFS('t4', null);
  fs.reset({ 'people.json': people, 'skills/a.json': JSON.stringify({ name: 'a', implements: 'x@1' }) });
  const list = fs.list.bind(fs);
  fs.list = p => p === 'skills' ? Promise.reject(Object.assign(new Error('NotReadableError'), { name: 'NotReadableError' })) : list(p);
  const d = await repo.loadAll(fs);
  assert.ok(/NotReadable/.test(d.failed.skills), 'the part that failed is named');
  assert.strictEqual(d.people.length, 4, 'everything else loaded');
  // A folder that can't be listed at all is still an unreadable folder.
  fs.list = () => Promise.reject(Object.assign(new Error('NotReadableError'), { name: 'NotReadableError' }));
  await assert.rejects(repo.loadAll(fs), /NotReadable/);
});

rule('A correction goes in its author\'s own notes file; each decision is a new file written once, and the one made after seeing another wins', async () => {
  const fs = folder(), r = await started(fs), C = PF.corrections;
  const n = C.build({ id: 'c1', at: NOW, by: 'person-blake', session: 'blake-laptop', map: R.mapOf(r), step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes', version: 1, folder: r.folder });
  await repo.addNote(fs, r, 'blake-laptop', n);
  assert.ok(fs.files['runs/release/run1/notes-blake-laptop.jsonl'], 'the author\'s own notes file');
  const groups = async () => { const d = await repo.loadAll(fs); return C.status(C.groups(C.collect(d.runs, 'release')), d.corrDecisions); };
  let g = (await groups())[0];
  const p1 = await repo.decideCorrection(fs, C.decision(g, 'person-casey', 'applied', '', '2026-10-17T23:30:00.000Z', { current: g.decision, act: 'a1' }), 'casey-laptop');
  assert.strictEqual(p1, 'corrections/release/' + g.id + '.casey-laptop.1.json');
  // Avery's computer runs 40 minutes behind; she decides after reading Casey's.
  g = (await groups())[0];
  await repo.decideCorrection(fs, C.decision(g, 'person-avery', 'declined', 'We watch the dashboard', '2026-10-17T22:50:00.000Z', { current: g.decision }), 'avery-desktop');
  g = (await groups())[0];
  same([g.status, g.decision.by, g.decision.rev, g.decision.seen, g.label], ['declined', 'person-avery', 2, g.id + '.casey-laptop.1.json', 'Declined']);
  // A file is never written twice: deciding again from the same window and state is refused, and the file is unchanged.
  const before = fs.files[p1];
  await assert.rejects(() => repo.decideCorrection(fs, Object.assign(C.decision(g, 'person-casey', 'applied', '', NOW), { rev: 1 }), 'casey-laptop'), /already in the folder/);
  assert.strictEqual(fs.files[p1], before);
  await assert.rejects(() => repo.decideCorrection(fs, Object.assign(C.decision(g, 'a', 'open', '', NOW), { group: '../x' }), 'w1'));
  same(Object.keys(fs.files).filter(p => p.indexOf('corrections/') === 0).length, 2);
});

rule('Applying a correction saves the draft only over the exact draft it was compared with, and starts a draft from the latest version when there is none', async () => {
  const fs = folder(), r = await started(fs), C = PF.corrections, U = PF.util;
  const n = C.build({ id: 'c1', at: NOW, by: 'person-blake', session: 'blake-laptop', map: R.mapOf(r), step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes with no restarts', version: 1, folder: r.folder });
  await repo.addNote(fs, r, 'blake-laptop', n);
  const g = C.status(C.groups(C.collect((await repo.loadAll(fs)).runs, 'release')), [])[0];
  const base = fs.files['maps/drafts/release.md'].t;
  // Someone (or an AI assistant) changed the draft after it was compared: nothing is written.
  const theirs = base.replace('Rollback commit written', 'Rollback commit and steps written');
  await fs.write('maps/drafts/release.md', theirs);
  const refused = await repo.applyCorrection(fs, { process: 'release', file: 'release.md', base, expect: U.hash(base), group: g });
  same([!!refused.conflict, refused.theirs === theirs, fs.files['maps/drafts/release.md'].t === theirs], [true, true, true]);
  // Over the draft as it is, it's saved and read back.
  const res = await repo.applyCorrection(fs, { process: 'release', file: 'release.md', base: theirs, expect: U.hash(theirs), group: g });
  assert.ok(res.ok && /New pods stay up for 20 minutes with no restarts @backend \{#pods\}/.test(fs.files['maps/drafts/release.md'].t));
  // Applying again: the draft already has it, so it's refused rather than written twice.
  await assert.rejects(() => repo.applyCorrection(fs, { process: 'release', file: 'release.md', base: res.text, expect: res.hash, group: g }), /already has this correction/);
  // A result that doesn't match what the window showed is refused.
  await assert.rejects(() => repo.applyCorrection(fs, { process: 'release', file: 'release.md', base: theirs, expect: U.hash(theirs), group: g, text: 'something else' }), /changed since/);
  // No draft: it starts from the latest version, and an existing file of that name is never replaced.
  await fs.remove('maps/drafts/release.md');
  const pub = (await repo.loadAll(fs)).processes[0].index.latest;
  const made = await repo.applyCorrection(fs, { process: 'release', file: null, base: pub.md, expect: null, group: g });
  same([made.ok, made.file], [true, 'release.md']);
  assert.strictEqual(fs.files['maps/drafts/release.md'].t, C.review(g, pub.md).text);
  await fs.write('maps/drafts/release.md', 'written meanwhile');
  const again = await repo.applyCorrection(fs, { process: 'release', file: null, base: pub.md, expect: null, group: g });
  same([!!again.conflict, fs.files['maps/drafts/release.md'].t], [true, 'written meanwhile']);
});

rule('Corrections decisions and decisions on suggested fixes from before 1.13 both load; one that can\'t be read is reported, not dropped', async () => {
  const fs = folder(), r = await started(fs), C = PF.corrections;
  await repo.addNote(fs, r, 'blake-laptop', { id: 'fx1', at: NOW, by: 'person-blake', session: 'blake-laptop', step: 'jenkins', text: 'Say when it asks', files: [], kind: 'fix', fixKind: 'instructions', target: { phase: 'deploy', step: 'jenkins' }, version: 1 });
  await fs.write('suggestions/release/fx1.casey-laptop.json', JSON.stringify({ kind: 'fix-decision', process: 'release', suggestion: 'fx1', status: 'accepted', by: 'person-casey', at: NOW, rev: 1, latestVersion: 1 }));
  let d = await repo.loadAll(fs);
  const g = C.status(C.groups(C.collect(d.runs, 'release')), d.corrDecisions)[0];
  same([g.first.id, g.change.op, g.status, g.label], ['fx1', 'describe', 'legacy', 'Applied (legacy)']);
  await fs.write('corrections/release/' + g.id + '.w9.1.json', '{');
  await fs.write('suggestions/release/junk.json', JSON.stringify({ kind: 'correction-decision', group: 'g1', status: 'applied', by: 'x', at: NOW }));
  d = await repo.loadAll(fs);
  same(d.corrUnread.map(u => u.dir + '/' + u._file).sort(), ['corrections/' + g.id + '.w9.1.json', 'suggestions/junk.json'], 'half-synced JSON, and a decision in the wrong folder, count as unread');
  const read = fs.read.bind(fs);
  fs.read = p => /^(corrections|suggestions)\//.test(p) ? Promise.reject(new Error('NotReadableError')) : read(p);
  d = await repo.loadAll(fs);
  same([d.corrDecisions.length, d.corrUnread.length], [1, 2], 'a routine refresh keeps the text of a decision it read before, and reads again only what it couldn\'t');
  d = await repo.loadAll(fs, { deep: true });
  same([d.corrDecisions.length, d.corrUnread.length], [0, 3], 'Refresh reads every one, and each that fails is reported');
});

rule('Corrections load with their change and files, and older copies keep them as notes with a plain summary (test/fixtures/notes-corrections-1.13.jsonl)', async () => {
  const fs = folder(), r = await started(fs), C = PF.corrections;
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'notes-corrections-1.13.jsonl'), 'utf8');
  await fs.write('runs/release/run1/notes-w2.jsonl', text);
  const back = await repo.loadRun(fs, 'release', 'run1');
  same(back._notes.map(n => [n.id, n.kind, n.change.op, n.files.length]), [['c-word', 'correction', 'wording', 1], ['c-add', 'correction', 'add', 0], ['c-newer', 'correction', 'describe', 0]], 'a change from a newer copy shows as the problem it describes');
  same([back._notes[0].happened, back._notes[0].fileInfo[back._notes[0].files[0]].name], ['Watched for 20 minutes; two pods restarted at minute 12.', 'pods-watch.log']);
  same(C.groups(C.collect([back], 'release')).map(g => g.members[0].id), ['c-word', 'c-add', 'c-newer']);
  // 1.12's note cleaning, as it shipped: an unknown kind is a plain note, so a copy that old keeps every correction, its
  // files, and its text (the summary), and shows it as a note.
  const legacy = (o, base) => { const files = Array.isArray(o.files) ? o.files.filter(f => typeof f === 'string' && f.indexOf(base + 'files/') === 0 && /^[\w.@\/-]+$/.test(f) && f.indexOf('..') < 0) : []; return { id: o.id, text: o.text.slice(0, 2000), files, kind: o.kind === 'map' || o.kind === 'fix' ? o.kind : undefined }; };
  const old = text.trim().split('\n').map(l => legacy(JSON.parse(l), 'runs/release/run1/'));
  same(old.map(x => [x.id, x.files.length, x.kind]), [['c-word', 1, undefined], ['c-add', 0, undefined], ['c-newer', 0, undefined]]);
  assert.ok(/^Correction to "New pods stay up with no restarts"\. Should say: "New pods stay up for 20 minutes with no restarts"\./.test(old[0].text));
});

rule('A run.json saved by a newer copy opens read-only, and no save, take over or conflict copy from this copy ever writes it', async () => {
  const newerMap = example('maps/drafts/release.md').replace(/^(- \[[ !~]\] \{.*)$/m, '$1\n  when: ^environment is production');
  const edits = { 'a version this copy doesn\'t understand': j => { j.snapshot = newerMap; }, 'a field this copy would drop': j => { j.conditions = { notes: 'skipped' }; } };
  for (const what of Object.keys(edits)) {
    const fs = folder(), r = await started(fs), path = 'runs/release/run1/run.json';
    const j = JSON.parse((await fs.read(path)).text); edits[what](j);
    const text = JSON.stringify(j, null, 2); await fs.write(path, text);
    const files = Object.keys(fs.files).sort();
    const loaded = (await repo.loadAll(fs)).runs.find(x => x.id === 'run1');
    assert.ok(loaded && /doesn't understand\. Update Flightdeck/.test(loaded._unrunnable), what + ': read-only, with the reason');
    await assert.rejects(repo.saveRun(fs, loaded, 'casey-laptop'), e => e.unrunnable, what + ': its own save');
    await assert.rejects(repo.saveRun(fs, loaded, 'avery-desktop', { takeover: true }), e => e.unrunnable, what + ': take over');
    // A window that read the run before the newer copy saved it: refused too, without even a conflict copy.
    await assert.rejects(repo.saveRun(fs, r, 'casey-laptop'), e => e.unrunnable, what + ': an earlier window');
    assert.strictEqual((await fs.read(path)).text, text, what + ': run.json is untouched');
    same(Object.keys(fs.files).sort(), files, what + ': no other file was written');
  }
});

rule('A run on a publication whose format this copy doesn\'t know opens read-only, even if its own checklist reads', async () => {
  const fs = folder(), r = await started(fs), base = 'publications/release/' + r.folder + '/';
  const info = JSON.parse((await fs.read(base + 'publication.json')).text); info.format = 'preflight-publication/2';
  await fs.write(base + 'publication.json', JSON.stringify(info));
  const text = (await fs.read('runs/release/run1/run.json')).text;
  const loaded = (await repo.loadAll(fs, { deep: true })).runs.find(x => x.id === 'run1');
  assert.ok(/doesn't understand\. Update Flightdeck/.test(loaded._unrunnable || ''), 'through loadAll');
  const one = await repo.loadRun(fs, 'release', 'run1');
  assert.ok(/doesn't understand\. Update Flightdeck/.test(one._unrunnable || ''), 'and when the open run is reread');
  await assert.rejects(repo.saveRun(fs, loaded, 'casey-laptop'), e => e.unrunnable);
  assert.strictEqual((await fs.read('runs/release/run1/run.json')).text, text);
});

rule('A run file in a newer run format is listed read-only and never written', async () => {
  const fs = folder(), r = await started(fs), path = 'runs/release/run1/run.json';
  const j = JSON.parse((await fs.read(path)).text); j.format = 'preflight-run/3';
  const text = JSON.stringify(j); await fs.write(path, text);
  const loaded = (await repo.loadAll(fs, { deep: true })).runs.find(x => x.id === 'run1');
  assert.ok(loaded && /saved by a newer copy of Flightdeck/.test(loaded._unrunnable), 'listed, with the reason');
  await assert.rejects(repo.saveRun(fs, r, 'casey-laptop'), e => e.unrunnable);
  assert.strictEqual((await fs.read(path)).text, text);
});

rule('A publication folder replaced by a newer copy\'s (same name, newer format) makes its runs read-only; saves are refused, and a known-good one costs no read', async () => {
  const fs0 = folder(), r = await started(fs0), runPath = 'runs/release/run1/run.json', base = 'publications/release/' + r.folder + '/';
  // Another window on the same folder opens the run before it has read the versions, so it learns the format from the run.
  const fs = new PF.fs.MemoryFS('test:' + Math.random(), null); fs.files = fs0.files;
  const loaded = await repo.loadRun(fs, 'release', 'run1');
  assert.ok(!loaded._unrunnable, 'set-up: writable');
  // A save on a known-good publication reads nothing from it.
  const reads = [], read = fs.read.bind(fs); fs.read = p => { reads.push(p); return read(p); };
  R.setDetail(loaded, R.mapOf(loaded), 'ticket', 'ABC-2', 'person-casey', NOW); await repo.saveRun(fs, loaded, 'casey-laptop');
  fs.read = read;
  assert.ok(!reads.some(p => p.indexOf('publications/') === 0), 'no publication read: ' + reads.join(', '));
  // The folder is removed, then recreated under the same name by a newer copy.
  const saved = {}; Object.keys(fs.files).filter(p => p.indexOf(base) === 0).forEach(p => { saved[p] = fs.files[p].t; delete fs.files[p]; });
  await repo.loadAll(fs, { deep: true });
  const info = JSON.parse(saved[base + 'publication.json']); info.format = 'preflight-publication/2';
  Object.keys(saved).forEach(p => { fs.files[p] = { t: p === base + 'publication.json' ? JSON.stringify(info, null, 2) : saved[p], m: Date.now() + 1000 }; });
  const d = await repo.loadAll(fs, { deep: true });
  assert.ok(!d.processes[0].pubs.find(x => x.folder === r.folder).ok, 'set-up: the publication is unusable');
  const again = d.runs.find(x => x.id === 'run1');
  assert.ok(/doesn't understand\. Update Flightdeck/.test(again._unrunnable || ''), 'the reloaded run is read-only');
  const text = (await fs.read(runPath)).text;
  R.setDetail(loaded, R.mapOf(loaded), 'ticket', 'ABC-3', 'person-casey', NOW);
  await assert.rejects(repo.saveRun(fs, loaded, 'casey-laptop'), e => e.unrunnable, 'the window that loaded it earlier can\'t save');
  assert.ok(loaded._unrunnable, 'and its run is now read-only too');
  assert.strictEqual((await fs.read(runPath)).text, text, 'run.json is untouched');
});

rule('A publication record replaced in place by a newer format between refreshes is caught at save by its changed fingerprint', async () => {
  const fs = folder(), r = await started(fs), base = 'publications/release/' + r.folder + '/', runPath = 'runs/release/run1/run.json';
  const loaded = (await repo.loadAll(fs, { deep: true })).runs.find(x => x.id === 'run1');
  const info = JSON.parse(fs.files[base + 'publication.json'].t); info.format = 'preflight-publication/2';
  fs.files[base + 'publication.json'] = { t: JSON.stringify(info, null, 2), m: fs.files[base + 'publication.json'].m + 1000 };
  const text = (await fs.read(runPath)).text;
  R.setDetail(loaded, R.mapOf(loaded), 'ticket', 'ABC-3', 'person-casey', NOW);
  await assert.rejects(repo.saveRun(fs, loaded, 'casey-laptop'), e => e.unrunnable);
  assert.strictEqual((await fs.read(runPath)).text, text);
});

/* Counts what a folder is asked about publications: stats and reads. */
function counting(fs) {
  const n = { stat: 0, read: 0 }, stat = fs.stat && fs.stat.bind(fs), read = fs.read.bind(fs);
  fs.read = p => { if (p.indexOf('publications/') === 0) n.read++; return read(p); };
  if (stat) fs.stat = p => { if (p.indexOf('publications/') === 0) n.stat++; return stat(p); };
  return n;
}

for (const [what, strip] of [['no size or time at all', fs => { fs.stat = undefined; }], ['an unknown size and time', fs => { const stat = fs.stat.bind(fs); fs.stat = p => stat(p).then(st => st && { size: undefined, mtime: undefined }); }]]) {
  rule('Without file metadata (' + what + '), a publication record replaced in place by a newer format is still refused at save, after routine refreshes', async () => {
    const fs = folder(), r = await started(fs), base = 'publications/release/' + r.folder + '/', runPath = 'runs/release/run1/run.json';
    strip(fs);
    await repo.loadAll(fs);
    const loaded = await repo.loadRun(fs, 'release', 'run1');
    R.setDetail(loaded, R.mapOf(loaded), 'ticket', 'ABC-2', 'person-casey', NOW); await repo.saveRun(fs, loaded, 'casey-laptop');
    await repo.loadAll(fs); await repo.loadAll(fs);
    const info = JSON.parse(fs.files[base + 'publication.json'].t); info.format = 'preflight-publication/2';
    fs.files[base + 'publication.json'] = { t: JSON.stringify(info, null, 2), m: fs.files[base + 'publication.json'].m };
    await repo.loadAll(fs); await repo.loadAll(fs);
    const text = (await fs.read(runPath)).text;
    R.setDetail(loaded, R.mapOf(loaded), 'ticket', 'ABC-3', 'person-casey', NOW);
    await assert.rejects(repo.saveRun(fs, loaded, 'casey-laptop'), e => e.unrunnable);
    assert.strictEqual((await fs.read(runPath)).text, text);
  });
}

rule('A warm routine refresh asks nothing about publications; a save on a known-good one costs one stat and no read', async () => {
  const fs = folder(), r = await started(fs);
  await repo.loadAll(fs);
  const loaded = await repo.loadRun(fs, 'release', 'run1');
  const n = counting(fs);
  await repo.loadAll(fs);
  assert.deepStrictEqual(n, { stat: 0, read: 0 }, 'routine refresh');
  R.setDetail(loaded, R.mapOf(loaded), 'ticket', 'ABC-2', 'person-casey', NOW); await repo.saveRun(fs, loaded, 'casey-laptop');
  assert.deepStrictEqual(n, { stat: 1, read: 0 }, 'one save');
});

rule('A version replaced in place with the same format but different contents can\'t be recorded or started until it\'s checked again', async () => {
  const fs = folder(), r = await started(fs), base = 'publications/release/' + r.folder + '/';
  const d0 = await repo.loadAll(fs), cached = d0.processes[0].index.latest;
  const loaded = await repo.loadRun(fs, 'release', 'run1');
  // Another copy rewrites the version: syntax this copy doesn't know, with a matching record in the known format.
  const md = fs.files[base + 'map.md'].t.replace(/^(- \[[ !~]\] \{.*)$/m, '$1\n  when: ^environment is production');
  const info = JSON.parse(fs.files[base + 'publication.json'].t); info.mapHash = PF.util.hash(md);
  const later = fs.files[base + 'publication.json'].m + 1000;
  fs.files[base + 'map.md'] = { t: md, m: later }; fs.files[base + 'publication.json'] = { t: JSON.stringify(info, null, 2), m: later };
  await repo.loadAll(fs);
  const files = Object.keys(fs.files).sort(), text = fs.files['runs/release/run1/run.json'].t;
  R.setDetail(loaded, R.mapOf(loaded), 'ticket', 'ABC-2', 'person-casey', NOW);
  await assert.rejects(repo.saveRun(fs, loaded, 'casey-laptop'), e => e.unrunnable, 'the open run can\'t save');
  assert.ok(loaded._unrunnable, 'and is read-only');
  // Start, from the version as the page still shows it.
  const fresh = R.create(cached, { title: 'New', details: {}, roles: {}, by: 'person-casey', session: 'casey-laptop', now: NOW, id: 'run2' });
  await assert.rejects(repo.saveRun(fs, fresh, 'casey-laptop'), e => e.unrunnable, 'a new run can\'t start on it');
  same(Object.keys(fs.files).sort(), files, 'no file was written');
  assert.strictEqual(fs.files['runs/release/run1/run.json'].t, text);
  // The next refresh checks that version again, and lists it as unusable.
  const d = await repo.loadAll(fs);
  assert.ok(!d.processes[0].pubs.find(x => x.folder === r.folder).ok, 'listed as unusable after the next refresh');
});

for (const [what, strip] of [['with file metadata', () => {}], ['without file metadata', fs => { fs.stat = undefined; }]]) {
  rule('A publication record that arrives late with a step type this copy can\'t fully read is refused at save (' + what + ')', async () => {
    const fs0 = folder(), r = await started(fs0), base = 'publications/release/' + r.folder + '/', runPath = 'runs/release/run1/run.json';
    const pubText = fs0.files[base + 'publication.json'].t, typesText = fs0.files[base + 'types.json'].t;
    delete fs0.files[base + 'publication.json']; delete fs0.files[base + 'types.json'];
    // A window opens the run while the version's record and step types are still syncing.
    const fs = new PF.fs.MemoryFS('test:' + Math.random(), null); fs.files = fs0.files; strip(fs);
    const loaded = await repo.loadRun(fs, 'release', 'run1');
    assert.ok(!loaded._unrunnable, 'set-up: writable while the record is missing');
    // They arrive, written by a newer copy: same checklist, a frozen type from a newer type version.
    const types = JSON.parse(typesText); types.confirm.version = PF.types.VERSION + 1;
    const tj = JSON.stringify(types, null, 2), info = JSON.parse(pubText); info.typesHash = PF.util.hash(tj);
    fs.files[base + 'types.json'] = { t: tj, m: Date.now() + 1000 }; fs.files[base + 'publication.json'] = { t: JSON.stringify(info, null, 2), m: Date.now() + 1000 };
    const text = fs.files[runPath].t;
    R.setDetail(loaded, R.mapOf(loaded), 'ticket', 'ABC-2', 'person-casey', NOW);
    await assert.rejects(repo.saveRun(fs, loaded, 'casey-laptop'), e => e.unrunnable);
    assert.ok(loaded._unrunnable, 'the run is now read-only');
    assert.strictEqual(fs.files[runPath].t, text, 'run.json is untouched');
  });
}

rule('A run carrying step types this copy can\'t read never vouches for its version: another run on it is still refused when those types arrive', async () => {
  const fs0 = folder(), r = await started(fs0), base = 'publications/release/' + r.folder + '/', path1 = 'runs/release/run1/run.json';
  const pubText = fs0.files[base + 'publication.json'].t, typesText = fs0.files[base + 'types.json'].t;
  // A second run on the same version, saved by a newer copy with a newer version of a step type.
  const newer = JSON.parse(typesText); newer.confirm.version = PF.types.VERSION + 1;
  const r2 = JSON.parse(fs0.files[path1].t); r2.id = 'run2'; r2.title = 'Started by a newer copy'; r2.types = newer;
  await fs0.write('runs/release/run2/run.json', JSON.stringify(r2, null, 2));
  delete fs0.files[base + 'publication.json']; delete fs0.files[base + 'types.json'];
  const fs = new PF.fs.MemoryFS('test:' + Math.random(), null); fs.files = fs0.files;
  const older = await repo.loadRun(fs, 'release', 'run1');
  assert.ok(!older._unrunnable, 'set-up: the older run is writable while the version is syncing');
  assert.ok((await repo.loadRun(fs, 'release', 'run2'))._unrunnable, 'set-up: the newer run is read-only');
  // The version's files arrive, with the newer step type; the newer run is opened and reread.
  const tj = JSON.stringify(newer, null, 2), info = JSON.parse(pubText); info.typesHash = PF.util.hash(tj);
  fs.files[base + 'types.json'] = { t: tj, m: Date.now() + 1000 }; fs.files[base + 'publication.json'] = { t: JSON.stringify(info, null, 2), m: Date.now() + 1000 };
  await repo.loadRun(fs, 'release', 'run2');
  // Back on the older run: pausing it is refused, and nothing is written.
  const text = fs.files[path1].t;
  R.pause(older, 'Lunch', 'person-casey', NOW);
  await assert.rejects(repo.saveRun(fs, older, 'casey-laptop'), e => e.unrunnable);
  assert.strictEqual(fs.files[path1].t, text, 'run.json is untouched');
});

rule('A run started from other checklist contents than its version holds is refused, even once the version is approved for another run', async () => {
  const fs0 = folder(), r = await started(fs0), base = 'publications/release/' + r.folder + '/', path1 = 'runs/release/run1/run.json';
  const pubText = fs0.files[base + 'publication.json'].t, md0 = fs0.files[base + 'map.md'].t;
  // A second run, supported, whose checklist is different contents under the same version folder.
  const md2 = md0.replace(/^(- \[[ !~]\] \{.*)$/m, '- [ ] {confirm} Change window confirmed on the calendar {#window}\n$1');
  const r2 = JSON.parse(fs0.files[path1].t); r2.id = 'run2'; r2.title = 'Other contents'; r2.snapshot = md2; r2.mapHash = PF.util.hash(md2);
  await fs0.write('runs/release/run2/run.json', JSON.stringify(r2, null, 2));
  delete fs0.files[base + 'publication.json']; delete fs0.files[base + 'map.md'];
  const fs = new PF.fs.MemoryFS('test:' + Math.random(), null); fs.files = fs0.files;
  const older = await repo.loadRun(fs, 'release', 'run1');
  assert.ok(!older._unrunnable && !(await repo.loadRun(fs, 'release', 'run2'))._unrunnable, 'set-up: both writable while the version is syncing');
  // The version arrives, matching the second run; that run is reread, which approves the version.
  const info = JSON.parse(pubText); info.mapHash = PF.util.hash(md2);
  fs.files[base + 'map.md'] = { t: md2, m: Date.now() + 1000 }; fs.files[base + 'publication.json'] = { t: JSON.stringify(info, null, 2), m: Date.now() + 1000 };
  assert.ok(!(await repo.loadRun(fs, 'release', 'run2'))._unrunnable, 'the matching run is fine');
  const text = fs.files[path1].t;
  R.pause(older, 'Lunch', 'person-casey', NOW);
  await assert.rejects(repo.saveRun(fs, older, 'casey-laptop'), e => e.unrunnable, 'the older run is refused');
  assert.strictEqual(fs.files[path1].t, text, 'run.json is untouched');
  // That refusal is the older run's own: the matching run still saves.
  const again = await repo.loadRun(fs, 'release', 'run2');
  R.pause(again, 'Lunch', 'person-casey', NOW); await repo.saveRun(fs, again, 'casey-laptop');
});

/* ---------- Attachments on notes and suggestions (1.13) ---------- */
rule('Attachments are saved to the run\'s files/ folder under a cleaned name; kinds outside the list and files over 10 MB are refused', async () => {
  const fs = folder(), r = await started(fs);
  const pdf = await repo.saveAttachment(fs, r, new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'w1', 'Run book (final).pdf');
  assert.ok(/^runs\/release\/run1\/files\/\d+-[a-z0-9]{6}-w1-Run-book-final\.pdf$/.test(pdf), pdf);
  const log = await repo.saveAttachment(fs, r, new Blob(['ok\n'], { type: '' }), 'w1', '../../deploy.log');
  assert.ok(/-w1-deploy\.log$/.test(log) && log.indexOf('..') < 0, log);
  for (const [blob, name] of [[new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg'], [new Blob(['<p>'], { type: 'text/html' }), 'x.html'], [new Blob(['MZ'], { type: 'application/octet-stream' }), 'x.exe']]) {
    await assert.rejects(repo.saveAttachment(fs, r, blob, 'w1', name), /can't be attached/, name);
  }
  const big = { type: 'application/zip', size: 10 * 1024 * 1024 + 1, name: 'big.zip' };
  await assert.rejects(repo.saveAttachment(fs, r, big, 'w1'), /up to 10 MB each/);
  assert.strictEqual(Object.keys(fs.files).filter(p => /\/files\//.test(p)).length, 2, 'nothing refused was written');
});

rule('Notes carrying the new attachment kinds load with their names and sizes, and older copies keep them too (test/fixtures/notes-attachments-1.13.jsonl)', async () => {
  const fs = folder(), r = await started(fs);
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'notes-attachments-1.13.jsonl'), 'utf8');
  await fs.write('runs/release/run1/notes-w2.jsonl', text);
  const back = await repo.loadRun(fs, 'release', 'run1');
  same(back._notes.map(n => [n.id, n.files.length]), [['n-old', 1], ['n-new', 4], ['n-fix', 1], ['n-dots', 1]], 'every note and every file is kept');
  same(back._notes[3].fileInfo[back._notes[3].files[0]].name, 'deploy.output.log', 'a recorded name is cleaned by the same rule');
  const n = back._notes[1];
  same(n.fileInfo[n.files[2]], { name: 'logs.zip', size: 9437184 });
  same(back._notes[0].fileInfo, {}, 'an older note has no details, and still shows');
  assert.strictEqual(back._notes[2].kind, 'fix');
  same(PF.corrections.collect([back], 'release')[0].fileInfo, back._notes[2].fileInfo, 'a suggested fix keeps its files\' details');
  // 1.12's note cleaning, as it shipped: a copy that old keeps these notes and their paths (it shows images, and ignores the rest).
  const legacy = (o, base) => { const files = Array.isArray(o.files) ? o.files.filter(f => typeof f === 'string' && f.indexOf(base + 'files/') === 0 && /^[\w.@\/-]+$/.test(f) && f.indexOf('..') < 0) : []; return { id: o.id, text: o.text, files }; };
  const old = text.trim().split('\n').map(l => legacy(JSON.parse(l), 'runs/release/run1/'));
  same(old.map(x => x.files.length), [1, 4, 1, 1], '1.12 drops neither notes nor files');
});

rule('An attachment named with a run of dots is saved under a name its note keeps', async () => {
  const fs = folder(), r = await started(fs);
  const path = await repo.saveAttachment(fs, r, new Blob(['ok\n'], { type: 'text/plain' }), 'w1', 'deploy..output.log');
  await repo.addNote(fs, r, 'w1', { id: 'd1', at: NOW, by: 'person-casey', step: 'pods', text: 'Output', files: [path], fileInfo: { [path]: { name: 'deploy..output.log', size: 3 } } });
  const back = await repo.loadRun(fs, 'release', 'run1');
  same(back._notes[0].files, [path], 'the file is still listed after a reload');
  same(back._notes[0].fileInfo[path], { name: 'deploy.output.log', size: 3 });
});

/* ---------- Reading never hides a failure; Folder health's scan (1.15) ---------- */
/* A folder whose calls can be slowed, counted and made to fail: the kind of trouble OneDrive causes. */
function faulty(fs, o) {
  o = o || {};
  const calls = { now: 0, max: 0, list: [] };
  ['list', 'read', 'stat', 'blob'].forEach(m => {
    const orig = fs[m].bind(fs);
    fs[m] = p => {
      calls.list.push(m + ' ' + p);
      if (o.fail && o.fail(m, p)) return Promise.reject(Object.assign(new Error('NotReadableError: ' + p), { name: 'NotReadableError' }));
      calls.now++; calls.max = Math.max(calls.max, calls.now);
      return new Promise(res => setTimeout(res, o.delay || 0)).then(() => orig(p)).then(v => { calls.now--; return v; }, e => { calls.now--; throw e; });
    };
  });
  return calls;
}

rule('A run.json that can\'t be understood is listed as unreadable, never just left out', async () => {
  const fs = folder(); await started(fs);
  await fs.write('runs/release/run2/run.json', '{"format": "preflight-run/2", "id": "run2", "proc');
  const d = await repo.loadAll(fs);
  assert.ok(d.runs.some(r => r.id === 'run1') && !d.runs.some(r => r.id === 'run2'));
  same(d.unreadable.map(u => [u.path, u.key]), [['runs/release/run2/run.json', 'release/run2']]);
  assert.ok(/isn't complete JSON/.test(d.unreadable[0].why));
});

rule('One read that fails doesn\'t fail the whole folder: its run or draft is listed as unreadable, and everything else loads', async () => {
  const fs = folder(); await started(fs);
  faulty(fs, { fail: (m, p) => m === 'read' && (p === 'runs/release/run1/run.json' || p === 'maps/drafts/release.md') });
  const d = await repo.loadAll(fs);
  assert.strictEqual(d.people.length, 4, 'people loaded');
  assert.strictEqual(d.processes[0].index.latest.info.version, 1, 'publications loaded');
  same(d.unreadable.map(u => u.path).sort(), ['maps/drafts/release.md', 'runs/release/run1/run.json']);
  assert.strictEqual(d.unreadable.filter(u => u.key)[0].key, 'release/run1', 'the app keeps that run as last read');
  same(d.failed, {});
});

rule('Step types past 100 and skill registrations past 500 are counted and reported, never silently cut', async () => {
  const fs = folder();
  for (let i = 0; i < 103; i++) { const id = 'team.t' + String(i).padStart(3, '0'); await fs.write('step-types/' + id + '.json', JSON.stringify({ id, label: 'T ' + i, icon: 'check' })); }
  for (let i = 0; i < 502; i++) await fs.write('skills/s' + String(i).padStart(3, '0') + '.json', JSON.stringify({ name: 's' + i, process: 'release', implements: 'release@1', location: 'x' }));
  const d = await repo.loadAll(fs);
  assert.strictEqual(d.stepTypes.skipped, 3); assert.strictEqual(Object.keys(d.stepTypes.types).length, 100);
  assert.ok(d.stepTypes.types['team.t000'] && !d.stepTypes.types['team.t102'], 'the first by name, the same on every computer');
  assert.strictEqual(d.skillsSkipped, 3); assert.strictEqual(d.skills.length, 500);
});

rule('Drafts that say the same process: are both read, so both can be reported', async () => {
  const fs = folder();
  await fs.write('maps/drafts/release-LAPTOP.md', example('maps/drafts/release.md'));
  const d = await repo.loadAll(fs);
  same(PF.health.sharedDrafts(d.drafts), [{ process: 'release', files: ['release-LAPTOP.md', 'release.md'] }]);
});

rule('Flightdeck\'s loaders never list connection/, so a copy from before 1.15 never reads or writes it', async () => {
  const fs = folder(); await started(fs);
  await repo.sendProbe(fs, { id: 'k3m9p2q8', n: 1, by: 'person-avery', writer: 'w1', device: 'Mac · Chrome', at: NOW, app: '1.15.0', run: null, seen: [] }, Date.parse(NOW));
  const calls = faulty(fs);
  await repo.loadAll(fs, { deep: true });
  await repo.loadRun(fs, 'release', 'run1');
  assert.ok(calls.list.length > 10 && !calls.list.some(c => /connection/.test(c)), 'nothing under connection/ was listed or read');
  // check_folder.py, the skills' own checker, knows nothing of it either.
  assert.ok(!/connection/.test(example('.flightdeck/skills/_flightdeck/check_folder.py')));
});

rule('Folder health\'s scan reads every file with at most 8 calls in flight, and reports what it can\'t read', async () => {
  const fs = folder(); await started(fs);
  for (let i = 0; i < 40; i++) await fs.write('runs/release/run1/files/f' + i + '.txt', 'x'.repeat(i));
  await fs.write('proposals/broken.json', '{ nope');
  await fs.write('.flightdeck/installed.json', JSON.stringify({ format: 'flightdeck-installed/1', version: '1.15.0' }));
  await fs.write('AGENTS.md', example('AGENTS.md'));
  await fs.write('.flightdeck/updates/1.15.0/AGENTS.md', 'new'); await fs.write('.flightdeck/updates/1.15.0/README.md', 'merge me');
  const calls = faulty(fs, { delay: 2, fail: (m, p) => m === 'stat' && p === 'runs/release/run1/files/f3.txt' });
  let seen = 0;
  const s = await repo.scan(fs, { progress: n => { seen = n; } });
  assert.ok(calls.max <= 8 && calls.max >= 4, 'at most 8 at once, and more than one: ' + calls.max);
  assert.ok(s.files >= 47 && seen === s.files);
  assert.ok(s.unreadable.some(u => u.path === 'proposals/broken.json' && /valid JSON/.test(u.why)));
  assert.ok(s.unreadable.some(u => u.path === 'runs/release/run1/files/f3.txt'));
  assert.strictEqual(s.installed.version, '1.15.0');
  assert.ok(typeof s.contractTexts['AGENTS.md'] === 'string');
  same(s.updates, ['.flightdeck/updates/1.15.0/AGENTS.md']);
  assert.ok(s.areas.runs.files >= 41 && s.areas.runs.bytes > 700 && s.longest > 20);
  assert.ok(Object.keys(s.pubs).length === 1, 'the newest time of each publication folder');
});

rule('Folder health\'s scan stops when its folder is switched, and never mixes two folders', async () => {
  const fs = folder(); await started(fs);
  let live = true, n = 0;
  faulty(fs, { delay: 1 });
  const p = repo.scan(fs, { alive: () => live, progress: () => { if (++n === 2) live = false; } });
  await assert.rejects(p, e => e.cancelled === true);
});

rule('Reading the whole folder keeps at most 8 folder calls in flight, even for a run with many notes files', async () => {
  const fs = folder(); await started(fs);
  for (let i = 0; i < 120; i++) await fs.write('runs/release/run1/notes-w' + i + '.jsonl', JSON.stringify({ id: 'n' + i, at: NOW, by: 'person-casey', text: 'hi' }) + '\n');
  const calls = faulty(fs, { delay: 1 });
  const d = await repo.loadAll(fs, { deep: true });
  assert.strictEqual(d.runs[0]._notes.length, 120);
  assert.ok(calls.max <= 8, 'at most 8 at once: ' + calls.max);
  calls.max = 0;
  await repo.loadRun(fs, 'release', 'run1');
  assert.ok(calls.max <= 8, 'rereading one run too: ' + calls.max);
});

rule('A run whose file is gone from the folder is never written back by a save; only an explicit restore writes it', async () => {
  const fs = folder(), r = await started(fs);
  delete fs.files['runs/release/run1/run.json'];
  Object.keys(fs.files).filter(k => /candidate-/.test(k)).forEach(k => delete fs.files[k]);
  done(r, R.mapOf(r), 'approved', 'person-casey', NOW);
  await assert.rejects(repo.saveRun(fs, r, 'casey-laptop'), e => e.missing === true && /gone from the team folder/.test(e.message));
  assert.ok(!fs.files['runs/release/run1/run.json'] && !Object.keys(fs.files).some(k => /^runs\/release\/run1\//.test(k)), 'nothing written');
  await repo.saveRun(fs, r, 'casey-laptop', { restoreMissing: true });
  assert.ok(JSON.parse(fs.files['runs/release/run1/run.json'].t).steps.approved, 'restored on request');
  // A new run (never saved) is still created by its first save.
  const fresh = R.create((await repo.loadAll(fs)).processes[0].index.latest, { title: 'New', details: {}, roles: {}, by: 'person-casey', session: 'casey-laptop', now: NOW, id: 'run2' });
  await repo.saveRun(fs, fresh, 'casey-laptop');
  assert.ok(fs.files['runs/release/run2/run.json']);
});

/* ---------- people.json, the write test and answers (1.15) ---------- */
rule('Folder: people keep their folder role, and the list carries the file\'s fingerprint for a checked save', async () => {
  const fs = folder(), d = await repo.loadAll(fs);
  same(d.people.map(p => p.folderRole), ['owner', 'backup', '', '']);
  assert.strictEqual(d.people.hash, PF.util.hash(people));
  same(d.people.doc, JSON.parse(people));
  const next = PF.people.add(d.people.doc, 'Jordan Lee', '').doc;
  assert.ok((await repo.savePeople(fs, PF.people.text(next), d.people.hash)).ok);
  const theirs = (await fs.read('people.json')).text;
  await fs.write('people.json', theirs.replace('Jordan Lee', 'Jordan L.'));
  const res = await repo.savePeople(fs, PF.people.text(next), d.people.hash);
  assert.ok(res.conflict, 'a list changed since it was read is never saved over');
  assert.ok(/Jordan L\./.test((await fs.read('people.json')).text));
});

rule('Folder: the write test leaves nothing behind, and a sign-off by the backup owner says so', async () => {
  const fs = folder();
  await repo.writeTest(fs, 'w123');
  assert.deepStrictEqual(Object.keys(fs.files).filter(k => /write-test/.test(k)), []);
  const d = await published(fs), pub = d.processes[0].index.latest;
  await repo.recordValidation(fs, pub, 'w1', 'person-avery', '', { completed: 3, clean: 3, runs: [] }, 'backup');
  await repo.recordValidation(fs, pub, 'w2', 'person-casey', '', { completed: 3, clean: 3, runs: [] });
  const v = Object.keys(fs.files).filter(k => /^validations\//.test(k)).map(k => JSON.parse(fs.files[k].t));
  same(v.map(x => [x.by, x.as || null]).sort(), [['person-avery', 'backup'], ['person-casey', null]]);
});

rule('Folder: answers to connection checks of any age are read once each, and nothing else in connection/ is', async () => {
  const fs = folder(), CN = PF.connection, now = Date.now();
  await repo.sendProbe(fs, { id: 'abcd1234', n: 1, by: 'person-avery', writer: 'wa', device: 'Mac · Chrome', at: new Date(now).toISOString(), app: '1.15.0', run: null, seen: [] }, now);
  const ack = { probe: 'abcd1234', probeFile: CN.probeName(now, 'abcd1234', 'wa'), by: 'person-blake', writer: 'wb', device: 'Windows · Edge', at: new Date(now).toISOString(), firstSeenAt: new Date(now).toISOString(), app: '1.15.0', run: null, folderReadAt: new Date(now).toISOString() };
  await repo.sendAck(fs, ack);
  const seen = {}, got = await repo.loadAnswers(fs, seen);
  same(got.map(x => x.rec && x.rec.by), ['person-blake']);
  got.forEach(x => { seen[x.name] = true; });
  same(await repo.loadAnswers(fs, seen), [], 'read once');
});

rule('Folder: a backup owner\'s sign-off keeps as: "backup" when read back, so it still counts', async () => {
  const fs = folder(), d0 = await published(fs), pub = d0.processes[0].index.latest;
  await repo.recordValidation(fs, pub, 'w1', 'person-avery', '', { completed: 3, clean: 3, runs: [] }, 'backup');
  const d = await repo.loadAll(fs);
  assert.strictEqual(d.validations[0].as, 'backup');
  assert.strictEqual(PF.skills.signoffs(d.validations, pub).length, 1);
  fs.files[Object.keys(fs.files).find(k => /^validations\//.test(k))].t = JSON.stringify(Object.assign(JSON.parse(fs.files[Object.keys(fs.files).find(k => /^validations\//.test(k))].t), { as: { evil: 1 } }));
  assert.ok(!('as' in (await repo.loadAll(fs)).validations[0]), 'anything but "backup" is dropped');
});

rule('Folder: the write test always tries to remove its file and says whether it could', async () => {
  const fs = folder(), path = k => Object.keys(fs.files).filter(x => /write-test/.test(x));
  same(await repo.writeTest(fs, 'w1'), { removed: true });
  const orig = fs.remove; fs.remove = () => Promise.reject(new Error('locked'));
  same(await repo.writeTest(fs, 'w2'), { removed: false, path: '.flightdeck/write-test-w2.tmp' });
  fs.remove = orig; delete fs.files['.flightdeck/write-test-w2.tmp'];
  const read = fs.read; fs.read = p => /write-test/.test(p) ? Promise.resolve({ text: 'something else' }) : read.call(fs, p);
  await assert.rejects(repo.writeTest(fs, 'w3'), /didn't read back/);
  fs.read = read;
  same(path(), [], 'removed even when it read back wrong');
});

rule('Folder: when the write test neither reads back nor removes its file, the error names the file left behind', async () => {
  const fs = folder(), read = fs.read;
  fs.read = p => /write-test/.test(p) ? Promise.reject(new Error('busy')) : read.call(fs, p);
  fs.remove = () => Promise.reject(new Error('locked'));
  await assert.rejects(repo.writeTest(fs, 'w9'), /\.flightdeck\/write-test-w9\.tmp/);
});


/* ---------- What became of follow-ups: decisions in followups/ (1.16) ---------- */
async function withFollowUp(fs) {
  const r = await started(fs);
  R.addFollowUp(r, { id: 'fu1', text: 'Rotate the deploy password', owner: 'person-avery' }, 'person-casey', NOW);
  await repo.saveRun(fs, r, 'casey-laptop');
  return r;
}
rule('A follow-up decision is written once, in followups/, and loads back; a second file of the same name is refused', async () => {
  const fs = folder(), r = await withFollowUp(fs), F = PF.followups;
  const runText = (await fs.read('runs/release/run1/run.json')).text;
  const x = F.list([r], [])[0], rec = F.decision(x, 'person-blake', 'ticket', { ticket: 'ABC-42' }, NOW, null);
  assert.strictEqual(await repo.decideFollowUp(fs, rec, 'blake-laptop'), 'followups/release/run1.fu1.blake-laptop.1.json');
  await assert.rejects(repo.decideFollowUp(fs, rec, 'blake-laptop'), /already in the folder/);
  await assert.rejects(repo.decideFollowUp(fs, Object.assign({}, rec, { run: '../run1' }), 'blake-laptop'), /can't be decided here/);
  assert.strictEqual((await fs.read('runs/release/run1/run.json')).text, runText, 'run.json is unchanged');
  const d = await repo.loadAll(fs);
  same(d.fuDecisions.map(x => [x.status, x.ticket, x._file]), [['ticket', 'ABC-42', 'run1.fu1.blake-laptop.1.json']]);
  same(d.runs[0].followUps.map(f => f.text), ['Rotate the deploy password']);
  const y = F.list(d.runs, d.fuDecisions)[0];
  same([y.status, y.label], ['ticket', 'Moved to a ticket']);
});

rule('A follow-up decision that can\'t be read is reported, never dropped; one this copy doesn\'t understand is too', async () => {
  const fs = folder(); await withFollowUp(fs);
  await fs.write('followups/release/run1.fu1.w1.1.json', '{ "kind": "followup-decision", ');
  await fs.write('followups/release/run1.fu1.w2.1.json', JSON.stringify({ kind: 'followup-decision', process: 'release', run: 'run1', followUp: 'fu1', status: 'archived', by: 'p', at: NOW, rev: 1 }));
  const d = await repo.loadAll(fs);
  same(d.fuDecisions, []);
  same(d.fuUnread.map(u => u._file).sort(), ['run1.fu1.w1.1.json', 'run1.fu1.w2.1.json']);
});

rule('Older copies never list followups/: deciding a follow-up leaves run.json and every file they read as it was', async () => {
  const fs = folder(), r = await withFollowUp(fs), F = PF.followups;
  await repo.decideFollowUp(fs, F.decision(F.list([r], [])[0], 'person-blake', 'wont', { reason: 'Not needed' }, NOW, null), 'blake-laptop');
  // A copy from before 1.16 is this copy without the follow-up decision loader.
  const OLD = load(false, (f, src) => f === 'storage/repo.js' ? src.replace(/loadFollowUpDecisions\(fs, cache, sched[^)]*\),\n/, 'Promise.resolve([]),\n') : src).repo;
  const calls = faulty(fs);
  const d = await OLD.loadAll(fs, { deep: true });
  await OLD.loadRun(fs, 'release', 'run1');
  assert.ok(calls.list.length > 10 && !calls.list.some(c => /followups/.test(c)), 'nothing under followups/ was listed or read');
  same(d.runs[0].followUps.map(f => [f.id, f.text, f.owner]), [['fu1', 'Rotate the deploy password', 'person-avery']], 'the follow-up loads as it always did');
  assert.ok(!d.runs[0]._unrunnable, 'and the run stays writable there');
  assert.ok(!/followups/.test(example('.flightdeck/skills/_flightdeck/check_folder.py')), 'check_folder.py knows nothing of it either');
});


rule('One odd follow-up decision file never hides the others: it\'s listed as unreadable and the rest load', async () => {
  const fs = folder(), r = await withFollowUp(fs), F = PF.followups;
  await repo.decideFollowUp(fs, F.decision(F.list([r], [])[0], 'person-blake', 'done', {}, NOW, null), 'wa');
  await fs.write('followups/release/run1.fu1.wb.1.json', JSON.stringify({ kind: 'followup-decision', process: 'release', run: { toString: 0 }, followUp: 'fu1', status: 'open', by: 'p', at: NOW, rev: 1 }).replace('{"toString":0}', '{"toString":0}'));
  await fs.write('followups/release/stray.json', '{}');
  const d = await repo.loadAll(fs);
  assert.ok(!d.failed['follow-ups'], 'the part still reads');
  same(d.fuDecisions.map(x => x._file), ['run1.fu1.wa.1.json']);
  same(d.fuUnread.map(u => u._file).sort(), ['run1.fu1.wb.1.json', 'stray.json']);
});

rule('A follow-up decision is announced only once it reads back from the folder', async () => {
  const fs = folder(), r = await withFollowUp(fs), F = PF.followups;
  const rec = F.decision(F.list([r], [])[0], 'person-blake', 'done', {}, NOW, null);
  const write = fs.write.bind(fs);
  fs.write = (p, t) => write(p, /^followups\//.test(p) ? '{ "half": ' : t);
  await assert.rejects(repo.decideFollowUp(fs, rec, 'wa'), /didn't read back|didn’t read back/);
});

rule('Two saves of the same follow-up decision at once: one is written, the other refused', async () => {
  const fs = folder(), r = await withFollowUp(fs), F = PF.followups;
  const x = F.list([r], [])[0];
  const one = F.decision(x, 'person-blake', 'done', {}, NOW, null), two = F.decision(x, 'person-blake', 'wont', { reason: 'No' }, NOW, null);
  const res = await Promise.allSettled([repo.decideFollowUp(fs, one, 'wa'), repo.decideFollowUp(fs, two, 'wa')]);
  same(res.map(x => x.status).sort(), ['fulfilled', 'rejected']);
  const kept = JSON.parse((await fs.read('followups/release/run1.fu1.wa.1.json')).text);
  assert.strictEqual(kept.status, res[0].status === 'fulfilled' ? 'done' : 'wont', 'the file holds the one that was said to be written');
});

rule('Saved history: the draft and step-type loaders never list or read history/, so older copies never see it', async () => {
  const fs = folder(); await started(fs);
  // Files that would break a loader that read them: a draft-like .md and a step-type-like .json under history/.
  await fs.write('history/drafts/release/w1.jsonl', '{"v":1}\n');
  await fs.write('history/drafts/release/notes.md', '---\nprocess: other\ntitle: Not a draft\n---\n');
  await fs.write('history/step-types/risk.call/w1.jsonl', '{"v":1}\n');
  await fs.write('history/step-types/bad.json', '{ not json');
  const calls = faulty(fs);
  const d = await repo.loadAll(fs, { deep: true });
  await repo.loadStepTypes(fs);
  await repo.loadRun(fs, 'release', 'run1');
  assert.ok(calls.list.length > 10 && !calls.list.some(c => /history\//.test(c)), 'nothing under history/ was listed or read');
  assert.strictEqual(d.drafts.length, 1, 'only maps/drafts/');
  assert.ok(!d.stepTypes.errors.length, 'no step type from history/');
  assert.ok(!/history/.test(example('.flightdeck/skills/_flightdeck/check_folder.py')), 'the skills\' checker doesn\'t read it either');
});

rule('Saved history: each window appends to its own file, rolls over at 512 KB, and reading checks every line', async () => {
  const fs = folder(), TL = PF.timeline, H = PF.util.hash, roll = {}, dir = repo.historyDir('draft-edit', 'release');
  assert.strictEqual(dir, 'history/drafts/release');
  assert.strictEqual(repo.historyDir('type-edit', 'risk.call'), 'history/step-types/risk.call');
  const line = (id, seq, from, to) => JSON.stringify(TL.histLine({ kind: 'draft-edit', id, process: 'release', writer: 'w1', seq, by: 'person-avery', at: NOW, from: H(from), to: H(to), before: from, after: to, source: 'editor', units: ['The move of "Smoke tests"'], items: ['step:smoke'] }));
  assert.strictEqual(await repo.appendHistory(fs, dir, 'w1', [line('a1', 1, 'x\n', 'x\ny\n')], roll), dir + '/w1.jsonl');
  assert.strictEqual(await repo.appendHistory(fs, dir, 'w1', [line('a2', 2, 'x\ny\n', 'x\ny\nz\n')], roll), dir + '/w1.jsonl', 'the same file');
  // Grow the file past 512 KB: the next line starts w1-2.jsonl, and the full file is never rewritten.
  const full = fs.files[dir + '/w1.jsonl'].t;
  fs.files[dir + '/w1.jsonl'].t = full + ' '.repeat(TL.HIST.ROLL) + '\n';
  assert.strictEqual(await repo.appendHistory(fs, dir, 'w1', [line('a3', 3, 'x\ny\nz\n', 'x\ny\nz\nq\n')], roll), dir + '/w1-2.jsonl');
  assert.ok(fs.files[dir + '/w1.jsonl'].t.indexOf(full) === 0, 'the first file keeps everything');
  await fs.write(dir + '/w2.jsonl', 'not json\n{"v":1,"kind":"draft-edit","id":"x","writer":"w2","to":"zz"}\n' + line('b1', 1, 'x\ny\nz\nq\n', 'x\ny\nz\nq\nr\n').replace('"writer":"w1"', '"writer":"w2"') + '\n');
  await fs.write(dir + '/notes.txt', 'not a history file');
  const calls = faulty(fs, { delay: 2 });
  const res = await repo.loadEditHistory(fs, dir, H('x\ny\nz\nq\nr\n'));
  same(res.items.map(x => x.gap ? 'gap' : x.entry.id), ['b1', 'a3', 'a2', 'a1'], 'all writers, along the chain');
  assert.strictEqual(res.bad, 2, 'two lines couldn\'t be read');
  same(res.files, ['w1-2.jsonl', 'w1.jsonl', 'w2.jsonl']);
  assert.ok(calls.max <= 8 && !calls.list.some(c => /notes\.txt/.test(c)));
});

rule('Saved history: OneDrive\'s copies of a history file are read too, entries seen twice count once, and other names are reported', async () => {
  const fs = folder(), TL = PF.timeline, H = PF.util.hash, dir = 'history/drafts/release';
  const rec = (id, seq, from, to) => JSON.stringify(TL.histLine({ kind: 'draft-edit', id, process: 'release', writer: 'w1', seq, by: 'person-avery', at: NOW, from: H(from), to: H(to), before: from, after: to, units: [], items: [] }));
  const l1 = rec('a1', 1, 'x\n', 'x\ny\n'), l2 = rec('a2', 2, 'x\ny\n', 'x\ny\nz\n'), l3 = rec('a3', 3, 'x\ny\nz\n', 'x\ny\nz\nq\n');
  await fs.write(dir + '/w1.jsonl', l1 + '\n');
  await fs.write(dir + '/w1 (1).jsonl', l1 + '\n' + l2 + '\n');
  await fs.write(dir + '/w1-LAPTOP.jsonl', l2 + '\n' + l3 + '\n');
  await fs.write(dir + '/readme.txt', 'hello');
  const res = await repo.loadEditHistory(fs, dir, H('x\ny\nz\nq\n'));
  same(res.items.map(x => x.gap ? 'gap' : x.entry.id), ['a3', 'a2', 'a1'], 'every entry once, no gap');
  assert.strictEqual(res.bad, 0);
  same(res.unknown, ['readme.txt'], 'a name that isn\'t a history file is reported, not read');
});

rule('Saved history: reading skips lines over 80 KB before parsing them, and reads only each file\'s newest lines', async () => {
  const fs = folder(), TL = PF.timeline, H = PF.util.hash, dir = 'history/drafts/release';
  const lines = [];
  for (let i = 0; i < 3000; i++) lines.push(JSON.stringify(TL.histLine({ kind: 'draft-edit', id: 'e' + i, process: 'release', writer: 'w1', seq: i + 1, from: H('s' + i), to: H('s' + (i + 1)), units: [], items: [] })));
  lines.splice(2999, 0, '{"v":1,"pad":"' + 'p'.repeat(90000) + '"}');
  await fs.write(dir + '/w1.jsonl', lines.join('\n') + '\n');
  const orig = JSON.parse; let parsed = 0, huge = 0;
  JSON.parse = function (t) { parsed++; if (String(t).length > TL.HIST.LINE) huge++; return orig.apply(this, arguments); };
  let res;
  try { res = await repo.loadEditHistory(fs, dir, H('s3000')); } finally { JSON.parse = orig; }
  assert.strictEqual(huge, 0, 'the oversized line was never parsed');
  assert.ok(res.bad >= 1, 'and is counted as unreadable');
  assert.ok(parsed <= TL.HIST.READ + 5, 'only the newest lines were parsed (' + parsed + ')');
  assert.strictEqual(res.items[0].entry.id, 'e2999');
});

rule('Saved history: lines kept for a retry are split across files at 512 KB like any others', async () => {
  const fs = folder(), TL = PF.timeline, dir = 'history/drafts/release', roll = {};
  const recs = Array.from({ length: 10 }, (_, i) => JSON.stringify({ v: 1, i, pad: 'p'.repeat(60000) }));
  await repo.appendHistory(fs, dir, 'w1', recs, roll);
  const files = Object.keys(fs.files).filter(p => p.indexOf(dir + '/') === 0).sort();
  assert.ok(files.length >= 2, 'rolled over');
  files.forEach(p => assert.ok(TL.bytes(fs.files[p].t) <= TL.HIST.ROLL, p + ' stays under 512 KB'));
  const back = files.sort((a, b) => (a.length - b.length) || (a < b ? -1 : 1)).map(p => fs.files[p].t.trim().split('\n').map(l => JSON.parse(l).i)).reduce((a, b) => a.concat(b), []);
  same(back, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'every line once, in order');
});

rule('Saved history: reading looks at each file\'s newest 2,000 lines at most, however many of them are unreadable', async () => {
  const fs = folder(), TL = PF.timeline, H = PF.util.hash, dir = 'history/drafts/release';
  const good = JSON.stringify(TL.histLine({ kind: 'draft-edit', id: 'ok1', process: 'release', writer: 'w1', seq: 1, from: H('a'), to: H('b'), units: [], items: [] }));
  await fs.write(dir + '/w1.jsonl', good + '\n' + Array.from({ length: 25000 }, (_, i) => '{"v":2,"n":' + i + '}').join('\n') + '\n');
  const orig = JSON.parse; let parsed = 0;
  JSON.parse = function () { parsed++; return orig.apply(this, arguments); };
  let res;
  try { res = await repo.loadEditHistory(fs, dir, H('b')); } finally { JSON.parse = orig; }
  assert.ok(parsed <= TL.HIST.READ, 'parsed ' + parsed + ' lines');
  assert.strictEqual(res.bad, TL.HIST.READ, 'the lines looked at that couldn\'t be read');
  assert.strictEqual(res.skipped, 25001 - TL.HIST.READ, 'older lines are counted as not looked at');
});

rule('Saved history: two entries with one ID each get their own reference, so Compare and Reverse act on the one chosen', async () => {
  const fs = folder(), TL = PF.timeline, H = PF.util.hash, dir = 'history/drafts/release';
  const rec = (to, units) => JSON.stringify(TL.histLine({ kind: 'draft-edit', id: 'same1', process: 'release', writer: 'w1', seq: 1, from: H('a\n'), to: H(to), before: 'a\n', after: to, units, items: [] }));
  await fs.write(dir + '/w1.jsonl', rec('a\nb\n', ['First']) + '\n');
  await fs.write(dir + '/w1 (1).jsonl', rec('a\nc\n', ['Second']) + '\n');
  const res = await repo.loadEditHistory(fs, dir, H('a\nc\n'));
  const refs = res.items.filter(x => x.entry).map(x => x.entry.ref);
  assert.ok(refs.length === 2 && refs[0] !== refs[1] && refs.every(r => /^[\w-]{1,40}$/.test(r)), 'distinct, usable as an ID');
  const again = await repo.loadEditHistory(fs, dir, H('a\nc\n'));
  same(again.items.filter(x => x.entry).map(x => x.entry.ref), refs, 'the same on every read');
});

rule('The examples folder in the browser reports file sizes in bytes, so history files roll over at 512 KB of text however it\'s written', async () => {
  const fs = folder(), TL = PF.timeline, dir = 'history/drafts/release';
  await fs.write('x.txt', 'é€😀');
  assert.strictEqual((await fs.stat('x.txt')).size, 2 + 3 + 4);
  const recs = Array.from({ length: 10 }, (_, i) => JSON.stringify({ v: 1, i, pad: 'é'.repeat(30000) }));
  await repo.appendHistory(fs, dir, 'w1', recs.slice(0, 5), {});
  const roll = {}; await repo.appendHistory(fs, dir, 'w1', recs.slice(5), roll);
  Object.keys(fs.files).filter(p => p.indexOf(dir + '/') === 0).forEach(p => assert.ok(TL.bytes(fs.files[p].t) <= TL.HIST.ROLL, p + ' is ' + TL.bytes(fs.files[p].t) + ' bytes'));
});

/* ---------- 1.17: read results, immutable cache entries, the shared pool, sizes from reads ---------- */
async function endedRun(fs, id) {
  const had = await repo.loadAll(fs), d = had.processes.length ? had : await published(fs);
  const pub = d.processes[0].index.latest;
  const r = R.create(pub, { title: 'Ended ' + id, details: { commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'casey-laptop', now: NOW, id });
  R.end(r, R.mapOf(r), 'Cancelled', 'person-casey', 'Casey', NOW);
  await repo.saveRun(fs, r, 'casey-laptop');
  return r;
}

rule('Every run a refresh lists comes back as fresh, cached or unreadable, and only a complete listing of runs/ is marked complete', async () => {
  const fs = folder(); await endedRun(fs, 'old1');
  await fs.write('runs/release/bad1/run.json', '{"format": "preflight-run/2", "id": ');
  const cold = await repo.loadAll(fs);
  assert.strictEqual(cold.runsComplete, true, 'every process folder in runs/ was listed');
  assert.strictEqual(cold.reads['release/old1'].kind, 'fresh');
  assert.strictEqual(cold.reads['release/bad1'].kind, 'unreadable');
  assert.ok(/isn't complete JSON/.test(cold.reads['release/bad1'].why));
  const routine = await repo.loadAll(fs);
  const c = routine.reads['release/old1'];
  assert.strictEqual(c.kind, 'cached', 'an unchanged ended run is cached');
  assert.strictEqual(c.fileHash, cold.reads['release/old1'].run._fileHash);
  assert.ok(!('run' in c), 'a cached result carries no run object to install');
  assert.strictEqual(c.sig, repo.runSig(cold.reads['release/old1'].run), 'its signature matches the fresh read it came from');
});

rule('A cached run is built new from the texts read, so changing one never changes what the folder said', async () => {
  const fs = folder(); await endedRun(fs, 'old1');
  const first = (await repo.loadAll(fs)).reads['release/old1'].run;
  first.title = 'Changed on screen'; first._notes.push({ id: 'local', text: 'not in the folder' }); first.steps.x = { s: 'done' };
  const d = await repo.loadAll(fs), c = d.reads['release/old1'];
  const a = c.build(), b = c.build();
  assert.notStrictEqual(a, b, 'a new object each time');
  assert.strictEqual(a.title, 'Ended old1', 'the folder\'s text, not the changed object');
  assert.ok(!a._notes.some(n => n.id === 'local') && !a.steps.x);
  assert.strictEqual(d.runs.find(r => r.id === 'old1').title, 'Ended old1', 'the runs list is built the same way');
  assert.ok(d.runs.find(r => r.id === 'old1') !== first);
});

rule('A run the app asks to read fresh skips the cache, so a fresh read can clear its failure', async () => {
  const fs = folder(); await endedRun(fs, 'old1');
  await repo.loadAll(fs);
  assert.strictEqual((await repo.loadAll(fs)).reads['release/old1'].kind, 'cached');
  assert.strictEqual((await repo.loadAll(fs, { fresh: ['release/old1'] })).reads['release/old1'].kind, 'fresh');
});

rule('A run folder that disappears from the listing is forgotten by the cache, so one that comes back is read again', async () => {
  const fs = folder(); await endedRun(fs, 'old1');
  await repo.loadAll(fs);
  const saved = {}; Object.keys(fs.files).filter(p => p.indexOf('runs/release/old1/') === 0).forEach(p => { saved[p] = fs.files[p]; delete fs.files[p]; });
  assert.ok(!(await repo.loadAll(fs)).reads['release/old1'], 'not listed, no result');
  Object.assign(fs.files, saved);
  assert.strictEqual((await repo.loadAll(fs)).reads['release/old1'].kind, 'fresh');
});

rule('Runs of one version share one checklist text and one step-type object, but only when they\'re equal', async () => {
  const fs = folder(); await endedRun(fs, 'old1'); await endedRun(fs, 'old2');
  const forged = JSON.parse(fs.files['runs/release/old2/run.json'].t); forged.id = 'odd1'; forged.snapshot += '\n'; forged.types = Object.assign({}, forged.types, { extra: { id: 'extra' } });
  await fs.write('runs/release/odd1/run.json', JSON.stringify(forged));
  const runs = (await repo.loadAll(fs)).runs, a = runs.find(r => r.id === 'old1'), b = runs.find(r => r.id === 'old2'), odd = runs.find(r => r.id === 'odd1');
  assert.strictEqual(a.snapshot, b.snapshot); assert.strictEqual(a.types, b.types, 'the same object');
  assert.notStrictEqual(odd.types, a.types, 'different types are never shared');
  assert.ok(odd.snapshot !== a.snapshot, 'a different checklist keeps its own text');
});

rule('The folder\'s read gives the size and time of the very contents read, and a notes file read with its size isn\'t checked again', async () => {
  const { folderHandle } = require('./app-harness');
  const ffs = new PF.fs.FolderFS(folderHandle('team', { 'a/b.txt': 'hello' }));
  const f = await ffs.read('a/b.txt');
  assert.strictEqual(f.text, 'hello'); assert.strictEqual(f.size, 5); assert.ok(typeof f.mtime === 'number');
  assert.strictEqual(await ffs.read('a/missing.txt'), null);
  const mem = folder(); await mem.write('x.txt', 'é€');
  assert.strictEqual((await mem.read('x.txt')).size, 5, 'the examples folder too, in bytes');
  /* A notes file: stat to see if it changed, then read. Its size and time come with the read, so no second stat. */
  await endedRun(mem, 'old1');
  await repo.addNote(mem, { process: 'release', id: 'old1' }, 'casey-laptop', { id: 'n1', at: NOW, by: 'person-casey', step: 'x', text: 'hi' });
  let stats = 0; const st = mem.stat.bind(mem); mem.stat = p => { if (/notes-/.test(p)) stats++; return st(p); };
  await repo.loadRun(mem, 'release', 'old1');
  assert.strictEqual(stats, 1, 'one stat for the notes file, before reading it');
});

rule('One pool per folder: at most 8 calls at once across loading, thumbnails and the open run, thumbnails at most 4, the open run first', async () => {
  const fs = folder(), pool = repo.poolOf(fs);
  assert.strictEqual(repo.poolOf(fs), pool, 'one per folder');
  assert.notStrictEqual(repo.poolOf(folder()), pool);
  let active = 0, most = 0, thumbs = 0, mostThumbs = 0; const order = [], gates = [];
  const job = (lane, name) => pool(lane, () => { active++; most = Math.max(most, active); if (lane === 'thumb') { thumbs++; mostThumbs = Math.max(mostThumbs, thumbs); } order.push(name);
    return new Promise(res => gates.push(() => { active--; if (lane === 'thumb') thumbs--; res(); })); });
  const all = [];
  for (let i = 0; i < 12; i++) all.push(job('thumb', 't' + i));
  for (let i = 0; i < 12; i++) all.push(job('load', 'l' + i));
  all.push(job('open', 'open'));
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(active, 8); assert.ok(mostThumbs <= 4, 'thumbnails take at most 4');
  gates.shift()();
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(order[order.length - 1], 'open', 'the open run goes next');
  while (gates.length) { gates.shift()(); await new Promise(r => setTimeout(r, 0)); }
  await Promise.all(all);
  assert.ok(most <= 8 && mostThumbs <= 4);
});

/* ---------- 1.17 slice 1b: freshness by elapsed time, decisions read incrementally, progressive batches ---------- */
const MIN = 60000, OLD = '2026-09-01T10:00:00.000Z';
/* An elapsed-time clock the test moves, as performance.now() would. */
function ticking(start) { let t = start || 1000; const c = () => t; c.ahead = ms => { t += ms; }; c.set = ms => { t = ms; }; return c; }
async function oldRun(fs, id, at) {
  const had = await repo.loadAll(fs), d = had.processes.length ? had : await published(fs);
  const r = R.create(d.processes[0].index.latest, { title: 'Ended ' + id, details: { commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey' }, by: 'person-casey', session: 'casey-laptop', now: at || OLD, id });
  R.end(r, R.mapOf(r), 'Cancelled', 'person-casey', 'Casey', at || OLD);
  await repo.saveRun(fs, r, 'casey-laptop');
  return r;
}
/* The same number of bytes and the same time: what size and time alone can never tell apart. */
function sameSizeEdit(fs, path, from, to) {
  assert.strictEqual(from.length, to.length);
  const f = fs.files[path], t = f.t.replace(from, to);
  assert.notStrictEqual(t, f.t, 'set-up: the text changed');
  fs.files[path] = { t, m: f.m };
}

rule('An ended run edited in place with the same size and time is read again within 60 minutes of elapsed time, and at once on Refresh', async () => {
  const fs = folder(), clock = ticking(); await oldRun(fs, 'old1');
  await repo.loadAll(fs, { clock });
  sameSizeEdit(fs, 'runs/release/old1/run.json', 'Ended old1', 'Ended OLD1');
  clock.ahead(MIN / 2);
  const soon = await repo.loadAll(fs, { clock });
  assert.strictEqual(soon.reads['release/old1'].kind, 'cached', 'size and time are a shortcut: unchanged, so not read yet');
  assert.strictEqual((await repo.loadAll(fs, { clock, deep: true })).reads['release/old1'].run.title, 'Ended OLD1', 'Refresh reads it now');
  sameSizeEdit(fs, 'runs/release/old1/run.json', 'Ended OLD1', 'Ended Old1');
  clock.ahead(59 * MIN);
  assert.strictEqual((await repo.loadAll(fs, { clock })).reads['release/old1'].kind, 'cached', 'not yet an hour since Refresh read it');
  clock.ahead(MIN + 1000);
  const late = await repo.loadAll(fs, { clock }), res = late.reads['release/old1'];
  assert.strictEqual(res.kind, 'fresh', 'an hour of elapsed time after its last full read, it\'s read in full');
  assert.strictEqual(res.run.title, 'Ended Old1');
});

rule('A running run that isn\'t open is read in full at least every 5 minutes, even when its size and time never change', async () => {
  const fs = folder(), clock = ticking(); const r = await started(fs);
  await repo.loadAll(fs, { clock });
  sameSizeEdit(fs, 'runs/release/run1/run.json', '"Release"', '"RELEASE"');
  clock.ahead(4 * MIN);
  assert.strictEqual((await repo.loadAll(fs, { clock })).reads['release/run1'].kind, 'cached', 'its size and time say unchanged');
  clock.ahead(MIN);
  const res = (await repo.loadAll(fs, { clock })).reads['release/run1'];
  assert.strictEqual(res.kind, 'fresh'); assert.strictEqual(res.run.title, 'RELEASE');
  assert.ok(r);
});

rule('A notes file edited in place with the same size and time is read again in full past the run\'s maximum age, bypassing the notes cache', async () => {
  const fs = folder(), clock = ticking(); await oldRun(fs, 'old1');
  await repo.addNote(fs, { process: 'release', id: 'old1' }, 'casey-laptop', { id: 'n1', at: OLD, by: 'person-casey', step: 'x', text: 'first words' });
  await repo.loadAll(fs, { clock });
  sameSizeEdit(fs, 'runs/release/old1/notes-casey-laptop.jsonl', 'first words', 'other words');
  clock.ahead(61 * MIN);
  const res = (await repo.loadAll(fs, { clock })).reads['release/old1'];
  assert.strictEqual(res.kind, 'fresh');
  assert.strictEqual(res.run._notes[0].text, 'other words');
});

rule('Every finished run\'s size and time are checked within 10 minutes of elapsed time, a share at a time, never all at once', async () => {
  const fs = folder(), clock = ticking();
  for (let i = 0; i < 20; i++) await oldRun(fs, 'old' + i);
  await repo.loadAll(fs, { clock });
  const lists = {}, list = fs.list.bind(fs); fs.list = p => { const m = /^runs\/release\/(old\d+)$/.exec(p); if (m) lists[m[1]] = (lists[m[1]] || 0) + 1; return list(p); };
  const checked = {}; let most = 0;
  for (let pass = 1; pass <= 20; pass++) {
    clock.ahead(30000); for (const k in lists) delete lists[k];
    await repo.loadAll(fs, { clock });
    most = Math.max(most, Object.keys(lists).length);
    Object.keys(lists).forEach(k => { checked[k] = checked[k] || pass; });
  }
  assert.strictEqual(Object.keys(checked).length, 20, 'every run checked within 10 minutes: ' + Object.keys(checked).sort());
  assert.ok(most <= 2, 'a share each refresh, not every run at once: ' + most);
});

rule('A late note on a finished run is found by the metadata check, without waiting for the hour', async () => {
  const fs = folder(), clock = ticking(); await oldRun(fs, 'old1');
  await repo.loadAll(fs, { clock });
  await repo.addNote(fs, { process: 'release', id: 'old1' }, 'blake-laptop', { id: 'late', at: OLD, by: 'person-blake', step: 'x', text: 'late note' });
  let found = null;
  for (let pass = 1; pass <= 20 && !found; pass++) { clock.ahead(30000); const res = (await repo.loadAll(fs, { clock })).reads['release/old1']; if (res.kind === 'fresh') found = res; }
  assert.ok(found && found.run._notes.some(n => n.id === 'late'), 'read within 10 minutes');
});

rule('An elapsed clock that goes backward never delays a reread: everything is read again', async () => {
  const fs = folder(), clock = ticking(10 * 60 * MIN); await oldRun(fs, 'old1');
  await repo.loadAll(fs, { clock });
  sameSizeEdit(fs, 'runs/release/old1/run.json', 'Ended old1', 'Ended OLD1');
  clock.set(5000);
  const res = (await repo.loadAll(fs, { clock })).reads['release/old1'];
  assert.strictEqual(res.kind, 'fresh', 'a clock that went back can\'t say how old anything is');
  assert.strictEqual(res.run.title, 'Ended OLD1');
});

rule('A run whose read failed is read in full next time, and a cached result is never offered for it', async () => {
  const fs = folder(), clock = ticking(); await oldRun(fs, 'old1');
  await repo.loadAll(fs, { clock });
  const good = fs.files['runs/release/old1/run.json'];
  fs.files['runs/release/old1/run.json'] = { t: '{"format":"preflight-run/2","id":', m: good.m + 1 };
  clock.ahead(61 * MIN);
  assert.strictEqual((await repo.loadAll(fs, { clock })).reads['release/old1'].kind, 'unreadable');
  fs.files['runs/release/old1/run.json'] = good;
  clock.ahead(1000);
  assert.strictEqual((await repo.loadAll(fs, { clock })).reads['release/old1'].kind, 'fresh', 'its cache entry went with the failure');
});

rule('Saving a run drops what the cache knew about it, so the next refresh reads the save even at the same size and time', async () => {
  const fs = folder(), clock = ticking(); const r = await started(fs);
  await repo.loadAll(fs, { clock });
  const m = fs.files['runs/release/run1/run.json'].m;
  const live = (await repo.loadAll(fs, { clock })).reads['release/run1'];
  assert.strictEqual(live.kind, 'cached', 'set-up: an unchanged running run is cached');
  r.title = 'Saved title'; await repo.saveRun(fs, r, 'casey-laptop');
  fs.files['runs/release/run1/run.json'].m = m;
  clock.ahead(1000);
  const res = (await repo.loadAll(fs, { clock })).reads['release/run1'];
  assert.strictEqual(res.kind, 'fresh'); assert.strictEqual(res.run.title, 'Saved title');
});

rule('Decisions already read aren\'t read again on a routine refresh; new ones are, unreadable ones are every time, and Refresh reads them all', async () => {
  const fs = folder(), clock = ticking(); await oldRun(fs, 'old1');
  const dec = (run, rev) => JSON.stringify({ kind: 'followup-decision', process: 'release', run, followUp: 'f1', status: 'done', by: 'person-casey', at: OLD, rev, reason: 'Not needed' });
  await fs.write('followups/release/old1.f1.w1.1.json', dec('old1', 1));
  await fs.write('followups/release/old1.f1.w2.1.json', '{"kind": "followup-decision", ');
  await repo.loadAll(fs, { clock });
  const reads = [], read = fs.read.bind(fs); fs.read = p => { if (/^followups\//.test(p)) reads.push(p); return read(p); };
  await fs.write('followups/release/old1.f1.w3.2.json', dec('old1', 2));
  clock.ahead(30000);
  const d = await repo.loadAll(fs, { clock });
  same(reads.sort(), ['followups/release/old1.f1.w2.1.json', 'followups/release/old1.f1.w3.2.json'], 'only the new file and the one that couldn\'t be read');
  assert.strictEqual(d.fuDecisions.length, 2, 'the one read before still counts'); assert.strictEqual(d.fuUnread.length, 1);
  reads.length = 0;
  sameSizeEdit(fs, 'followups/release/old1.f1.w1.1.json', '"done"', '"wont"');
  clock.ahead(61 * MIN);
  const late = await repo.loadAll(fs, { clock });
  assert.ok(reads.indexOf('followups/release/old1.f1.w1.1.json') >= 0, 'past the hour, read again in full');
  assert.ok(late.fuDecisions.some(x => x._file === 'old1.f1.w1.1.json' && x.status === 'wont'));
  reads.length = 0;
  await repo.loadAll(fs, { clock, deep: true });
  assert.strictEqual(reads.length, 3, 'Refresh reads every decision');
});

rule('Correction decisions are read incrementally too: a file removed is forgotten, one added is read', async () => {
  const fs = folder(), clock = ticking();
  const rec = { kind: 'correction-decision', process: 'release', group: 'g1', status: 'declined', reason: 'No', by: 'person-avery', at: OLD, rev: 1, members: [] };
  await fs.write('corrections/release/g1.w1.1.json', JSON.stringify(rec));
  const first = await repo.loadAll(fs, { clock });
  const n0 = first.corrDecisions.length + first.corrUnread.length;
  assert.strictEqual(n0, 1, 'set-up');
  const reads = [], read = fs.read.bind(fs); fs.read = p => { if (/^corrections\//.test(p)) reads.push(p); return read(p); };
  clock.ahead(30000); await repo.loadAll(fs, { clock });
  same(reads, [], 'nothing new, nothing read');
  await fs.remove('corrections/release/g1.w1.1.json');
  clock.ahead(30000);
  const gone = await repo.loadAll(fs, { clock });
  assert.strictEqual(gone.corrDecisions.length + gone.corrUnread.length, 0, 'a removed file is gone');
});

rule('Progressive loading: results come in batches, running runs first, with the rest pending; only the complete result can make a run missing', async () => {
  const fs = folder(), clock = ticking();
  await started(fs); await oldRun(fs, 'old1'); await oldRun(fs, 'old2');
  const batches = [];
  const d = await repo.loadAll(fs, { clock, batch: 1, priority: { 'release/run1': 0 }, onBatch: b => batches.push(JSON.parse(JSON.stringify({ keys: Object.keys(b.reads), kinds: Object.keys(b.reads).map(k => b.reads[k].kind), pending: b.pending, done: b.done, total: b.total }))) });
  assert.ok(batches.length >= 3, 'one batch per run read: ' + batches.length);
  same(batches[0].keys, ['release/run1'], 'the run known to be running comes first');
  assert.strictEqual(batches[0].total, 3); assert.strictEqual(batches[0].done, 1);
  assert.strictEqual(batches[0].pending.length, 2, 'what isn\'t read yet is pending');
  batches.forEach(b => b.kinds.forEach(k => assert.ok(k === 'fresh' || k === 'unreadable', 'a batch holds only reads: ' + k)));
  assert.ok(!batches.some(b => b.kinds.indexOf('missing') >= 0));
  assert.strictEqual(d.runsComplete, true, 'the final result is the complete one');
  assert.strictEqual(Object.keys(d.reads).length, 3);
});

/* ---------- 1.17 slice 1b review: local writes never extend an age; a sleeping monotonic clock ---------- */
rule('This window saving every 4 minutes never extends a running run\'s 5-minute full read: another computer\'s same-size note edit still shows', async () => {
  const fs = folder(), clock = ticking(), r = await started(fs);
  await repo.addNote(fs, { process: 'release', id: 'run1' }, 'blake-laptop', { id: 'b1', at: NOW, by: 'person-blake', step: 'x', text: 'blake first' });
  await repo.loadAll(fs, { clock });
  sameSizeEdit(fs, 'runs/release/run1/notes-blake-laptop.jsonl', 'blake first', 'blake other');
  let seenAt = null;
  for (let s = 30; s <= 24 * 60 && seenAt == null; s += 30) {
    clock.ahead(30000);
    if (s % 240 === 0) { r.details.commit = 'c' + s; await repo.saveRun(fs, r, 'casey-laptop'); }
    const res = (await repo.loadAll(fs, { clock })).reads['release/run1'];
    const run = res.kind === 'fresh' ? res.run : res.build();
    if (run._notes.some(n => n.text === 'blake other')) seenAt = s;
  }
  assert.ok(seenAt != null && seenAt <= 5 * 60, 'seen within 5 minutes of its last full read, whatever this window saved: ' + seenAt + ' s');
});

rule('A monotonic clock that paused while the computer slept: 8 hours on the wall clock make every run due', async () => {
  const fs = folder(), clock = ticking(); let wall = Date.parse(NOW); await oldRun(fs, 'old1');
  await repo.loadAll(fs, { clock, now: wall });
  sameSizeEdit(fs, 'runs/release/old1/run.json', 'Ended old1', 'Ended OLD1');
  clock.ahead(1000); wall += 8 * 3600000;
  const res = (await repo.loadAll(fs, { clock, now: wall })).reads['release/old1'];
  assert.strictEqual(res.kind, 'fresh', 'asleep for 8 hours is 8 hours old'); assert.strictEqual(res.run.title, 'Ended OLD1');
});

rule('A wall clock that jumps forward makes runs due; both clocks moving together count the time once, never twice', async () => {
  const fs = folder(), clock = ticking(); let wall = Date.parse(NOW); await oldRun(fs, 'old1');
  await repo.loadAll(fs, { clock, now: wall });
  sameSizeEdit(fs, 'runs/release/old1/run.json', 'Ended old1', 'Ended OLD1');
  for (let i = 0; i < 60; i++) { clock.ahead(30000); wall += 30000; assert.strictEqual((await repo.loadAll(fs, { clock, now: wall })).reads['release/old1'].kind, 'cached', 'within the hour at ' + (i + 1) * 30 + ' s: counted once'); }
  clock.ahead(30000); wall += 2 * 3600000;
  assert.strictEqual((await repo.loadAll(fs, { clock, now: wall })).reads['release/old1'].kind, 'fresh', 'a jump forward on the wall clock makes it due');
});

/* ---------- 1.17 slice 1b second review: writes more often than refreshes, the open run's reread, small clock steps ---------- */
async function noteCadence(saveEvery, loadEvery, openEvery) {
  const fs = folder(), clock = ticking(), r = await started(fs);
  await repo.addNote(fs, { process: 'release', id: 'run1' }, 'blake-laptop', { id: 'b1', at: NOW, by: 'person-blake', step: 'x', text: 'blake first' });
  await repo.loadAll(fs, { clock });
  sameSizeEdit(fs, 'runs/release/run1/notes-blake-laptop.jsonl', 'blake first', 'blake other');
  const has = run => run && run._notes.some(n => n.text === 'blake other');
  for (let t = 1000; t <= 60 * MIN; t += 1000) {
    clock.ahead(1000);
    if (saveEvery && t % saveEvery === 0) { r.details.commit = 'c' + t; await repo.saveRun(fs, r, 'casey-laptop'); }
    if (openEvery && t % openEvery === 0 && has(await repo.loadRun(fs, 'release', 'run1'))) return t;
    if (loadEvery && t % loadEvery === 0) { const res = (await repo.loadAll(fs, { clock })).reads['release/run1']; if (has(res.kind === 'fresh' ? res.run : res.build())) return t; }
  }
  return null;
}
for (const [save, every] of [[50000, 60000], [30000, 30000], [45000, 60000]]) {
  rule('Saving every ' + save / 1000 + ' s with a refresh every ' + every / 1000 + ' s still reads a running run in full within 5 minutes', async () => {
    const at = await noteCadence(save, every, 0);
    assert.ok(at != null && at <= 5 * MIN + every, 'seen at ' + at);
  });
}
rule('The open run\'s 5-second reread reads its notes in full past the 5-minute age, even while this window writes every 45 s', async () => {
  const at = await noteCadence(45000, 0, 5000);
  assert.ok(at != null && at <= 5 * MIN + 5000, 'seen at ' + at);
});

rule('A small step back on the wall clock (as time sync does) while elapsed time moves on costs a routine refresh; a big one makes everything due', async () => {
  const fs = folder(), clock = ticking(); let wall = Date.parse(NOW); await oldRun(fs, 'old1');
  await repo.loadAll(fs, { clock, now: wall });
  sameSizeEdit(fs, 'runs/release/old1/run.json', 'Ended old1', 'Ended OLD1');
  for (const back of [1, 500, 30000]) { clock.ahead(30000); wall += 30000 - 30000 - back; assert.strictEqual((await repo.loadAll(fs, { clock, now: wall })).reads['release/old1'].kind, 'cached', back + ' ms back: not everything'); }
  clock.ahead(30000); wall -= 3 * MIN;
  assert.strictEqual((await repo.loadAll(fs, { clock, now: wall })).reads['release/old1'].kind, 'fresh', '3 minutes back: everything is due');
});


/* ---------- Reading for other apps (1.18 READ): read-only loading, every problem per file ---------- */
/* An old save receipt beside a run, not in its lineage, whose contents equal the run: the branch readRun removes. */
async function withEqualReceipt() {
  const fs = folder(), r = await started(fs), text = fs.files['runs/release/run1/run.json'].t;
  const p = 'runs/release/run1/candidate-other-zzzz9999.json';
  await fs.write(p, text.replace(/"rev": \d+/, '"rev": 77'));
  Object.keys(fs.files).forEach(k => { fs.files[k].m = 0; });
  return { fs, r, p };
}

rule('Loading for other apps never removes a save receipt; the app\'s loading still takes that branch and removes it', async () => {
  const { fs, p } = await withEqualReceipt();
  const d = await repo.loadAll(repo.readOnly(fs), { readOnly: true, explain: true, deep: true });
  const run = d.runs.find(x => x.id === 'run1');
  assert.ok(run && fs.files[p], 'the receipt is still there');
  same(run._conflicts, [], 'a receipt that lost nothing isn\'t a conflict');
  const one = await repo.readRunOnly(fs, 'release', 'run1');
  assert.ok(one.run && fs.files[p], 'reading one run keeps it too');
  await repo.loadAll(fs, { deep: true });
  await new Promise(res => setTimeout(res, 0));
  assert.ok(!fs.files[p], 'the app\'s own loading removes it, so the branch the test guards is real');
});

rule('A read-only view refuses every change outright: loading through it without readOnly fails that run instead of deleting', async () => {
  const { fs, p } = await withEqualReceipt();
  const d = await repo.loadAll(repo.readOnly(fs), { deep: true });
  assert.ok(fs.files[p], 'nothing removed');
  assert.ok(d.unreadable.some(u => u.key === 'release/run1' && /read-only/.test(u.why)), JSON.stringify(d.unreadable));
});

rule('Loading with explain names a run folder without run.json; without it the app sees no result, as before', async () => {
  const fs = folder(); await started(fs);
  await fs.write('runs/release/run2/notes-w9.jsonl', '{"id":"n1","text":"hello"}\n');
  const d = await repo.loadAll(fs, { deep: true, explain: true, readOnly: true });
  same(d.nofile, [{ path: 'runs/release/run2/run.json', key: 'release/run2' }]);
  const app = await repo.loadAll(fs, { deep: true });
  assert.ok(!app.reads['release/run2'] && !app.nofile, 'the app is unchanged');
  same(await repo.readRunOnly(fs, 'release', 'run2').then(x => [x.found, x.nofile, x.run]), [true, true, null]);
  same(await repo.readRunOnly(fs, 'release', 'run9').then(x => x.found), false);
});

rule('Loading with explain lists malformed proposals and plans by file; the app\'s plans are what they were', async () => {
  const fs = folder(); await published(fs);
  await fs.write('proposals/plan-broken.json', '{"kind": "plan", ');
  await fs.write('proposals/plan-odd.json', '{"kind": "plan", "id": 7, "process": "release"}');
  await fs.write('proposals/other.json', '{"kind": "something"}');
  const d = await repo.loadAll(fs, { explain: true, readOnly: true });
  same(d.malformed.map(m => m.path).sort(), ['proposals/other.json', 'proposals/plan-broken.json', 'proposals/plan-odd.json']);
  assert.ok(d.malformed.every(m => m.kind === 'malformed' && m.why));
  const app = await repo.loadAll(fs);
  same(app.plans.map(x => x.id), d.plans.map(x => x.id));
  assert.ok(!app.malformed);
});

rule('A run.json that won\'t parse is malformed, and a notes file that can\'t be read is named while the rest of the run loads', async () => {
  const fs = folder(); await started(fs);
  await fs.write('runs/release/run3/run.json', '{"format": "preflight-run/2"');
  await fs.write('runs/release/run1/notes-bad.jsonl', '{"id":"n1","text":"x"}\n');
  const read = fs.read.bind(fs);
  fs.read = p => /notes-bad/.test(p) ? Promise.reject(Object.assign(new Error('too large'), { skipped: true })) : read(p);
  const d = await repo.loadAll(fs, { deep: true, explain: true, readOnly: true });
  assert.ok(d.unreadable.some(u => u.path === 'runs/release/run3/run.json' && u.kind === 'malformed'), JSON.stringify(d.unreadable));
  assert.ok(d.unreadable.some(u => u.path === 'runs/release/run1/notes-bad.jsonl' && u.kind === 'skipped'), JSON.stringify(d.unreadable));
  assert.ok(d.runs.some(x => x.id === 'run1'), 'run1 still loads');
});

rule('The folder wrappers pass read options through: bounded() and the read-only view hand (path, options) to the folder', async () => {
  const got = [];
  const raw = { kind: 'memory', name: 'opts' };
  ['list', 'read', 'stat', 'blob'].forEach(m => { raw[m] = (p, o) => { got.push([m, p, o && o.maxBytes]); return Promise.resolve(m === 'list' ? [] : null); }; });
  const view = repo.lane(repo.readOnly(raw), 'load');
  for (const m of ['list', 'read', 'stat', 'blob']) await view[m]('runs/x', { maxBytes: 1234 });
  same(got, [['list', 'runs/x', 1234], ['read', 'runs/x', 1234], ['stat', 'runs/x', 1234], ['blob', 'runs/x', 1234]]);
});

rule('Every mutating method of a read-only folder throws, and loading for other apps calls none', async () => {
  const { fs } = await withEqualReceipt();
  const EVF = require('./evidence-fixture'), files = {};
  Object.keys(fs.files).forEach(k => { files[k] = fs.files[k].t; });
  const B = new EVF.BytesFS(files, { strict: true });
  B.mtimes.forEach((v, k) => B.mtimes.set(k, 0));
  const d = await repo.loadAll(repo.readOnly(B), { readOnly: true, explain: true, deep: true });
  assert.ok(d.runs.some(x => x.id === 'run1'));
  await repo.readRunOnly(B, 'release', 'run1');
  same(B.mutations, []);
});

rule('Cached decision texts are forgotten only for folders listed this time: a partial listing keeps the rest', async () => {
  const fs = folder();
  await fs.write('followups/a/r1.f1.w1.1.json', '{"a":1}'); await fs.write('followups/b/r1.f1.w1.1.json', '{"b":1}');
  const cache = { dec: {} }, sched = { deep: false, now: 1, due: () => [] };
  const item = (proc, name) => ({ process: proc, name, path: 'followups/' + proc + '/' + name });
  await repo.decisionTexts(fs, cache, sched, { folders: ['followups/a', 'followups/b'], tops: { followups: ['a', 'b'] } }, [item('a', 'r1.f1.w1.1.json'), item('b', 'r1.f1.w1.1.json')], 'fu');
  same(Object.keys(cache.dec).sort(), ['followups/a/r1.f1.w1.1.json', 'followups/b/r1.f1.w1.1.json']);
  await repo.decisionTexts(fs, cache, sched, { folders: ['followups/a'], tops: { followups: ['a', 'b'] } }, [item('a', 'r1.f1.w1.1.json')], 'fu');
  assert.ok(cache.dec['followups/b/r1.f1.w1.1.json'], 'b wasn\'t listed this time, so its text is kept');
  await repo.decisionTexts(fs, cache, sched, { folders: ['followups/a', 'followups/b'], tops: { followups: ['a', 'b'] } }, [item('a', 'r1.f1.w1.1.json')], 'fu');
  assert.ok(!cache.dec['followups/b/r1.f1.w1.1.json'], 'b was listed without the file: forgotten');
  cache.dec['followups/gone/r1.f1.w1.1.json'] = { text: '{}', at: 0 };
  await repo.decisionTexts(fs, cache, sched, { folders: ['followups/a'], tops: { followups: ['a'] } }, [item('a', 'r1.f1.w1.1.json')], 'fu');
  assert.ok(!cache.dec['followups/gone/r1.f1.w1.1.json'], 'a process folder gone from the top listing: forgotten');
  cache.dec['corrections/x/g.w1.1.json'] = { text: '{}', at: 0 };
  await repo.decisionTexts(fs, cache, sched, { folders: ['followups/a'], tops: { followups: ['a'] } }, [item('a', 'r1.f1.w1.1.json')], 'fu');
  assert.ok(cache.dec['corrections/x/g.w1.1.json'], 'another kind\'s folders are never touched');
});

rule('Follow-up and correction decisions loaded by the app still forget a file that\'s gone, and keep the ones still there', async () => {
  const fs = folder(); await started(fs);
  const fu = { kind: 'followup-decision', fv: 1, process: 'release', run: 'run1', followUp: 'f1', status: 'done', by: 'person-blake', at: NOW, rev: 1, seen: null };
  await fs.write('followups/release/run1.f1.w1.1.json', JSON.stringify(fu));
  await fs.write('followups/release/run1.f2.w1.1.json', JSON.stringify(Object.assign({}, fu, { followUp: 'f2' })));
  let d = await repo.loadAll(fs);
  same(d.fuDecisions.map(x => x.followUp).sort(), ['f1', 'f2']);
  await fs.remove('followups/release/run1.f2.w1.1.json');
  d = await repo.loadAll(fs);
  same(d.fuDecisions.map(x => x.followUp), ['f1']);
});


rule('The problem ledger records every failed list and read by path, a listed file gone when read as vanished, and passes options on', async () => {
  const fs = folder(); await fs.write('a/b.json', '{}'); await fs.write('a/c.json', '{}'); await fs.write('a/d.json', '{}');
  const read = fs.read.bind(fs), list = fs.list.bind(fs), seen = [];
  fs.read = (p, o) => { seen.push(o && o.maxBytes); if (p === 'a/c.json') throw new Error('EACCES'); if (p === 'a/d.json') return Promise.reject(Object.assign(new Error('too big'), { skipped: true })); return read(p); };
  fs.list = p => p === 'x' ? Promise.reject(Object.assign(new Error('a link'), { link: true })) : list(p);
  const L = repo.ledger(repo.readOnly(fs));
  await L.fs.list('a');
  await fs.remove('a/b.json');
  assert.strictEqual(await L.fs.read('a/b.json', { maxBytes: 5 }), null);
  await assert.rejects(L.fs.read('a/c.json'), /EACCES/);
  await assert.rejects(L.fs.read('a/d.json'), /too big/);
  await assert.rejects(L.fs.list('x'), /a link/);
  assert.strictEqual(await L.fs.read('never-listed.json'), null);
  same(L.problems().map(p => [p.path, p.kind]), [['a/b.json', 'vanished'], ['a/c.json', 'unreadable'], ['a/d.json', 'skipped'], ['x', 'link']]);
  assert.strictEqual(seen[0], 5, 'read options reach the folder');
  L.note('a/c.json', 'malformed', 'also'); L.note('a/e.json', 'malformed', 'bad');
  same(L.problems().map(p => [p.path, p.kind]), [['a/b.json', 'vanished'], ['a/c.json', 'unreadable'], ['a/d.json', 'skipped'], ['a/e.json', 'malformed'], ['x', 'link']], 'a file that failed to read isn\'t named again as malformed');
  assert.throws(() => L.fs.write('a/z.json', 'x'), /read-only/);
});


rule('The problem ledger records a blob\'s later failures (arrayBuffer, text, a slice\'s) and a folder listed, then marked missing, as vanished', async () => {
  const bad = () => Promise.reject(new Error('EIO'));
  const raw = {
    list: p => { if (p === 'a/gone') { const none = []; none.missing = true; return Promise.resolve(none); } if (p === 'a/never') { const none = []; none.missing = true; return Promise.resolve(none); } return Promise.resolve(p === 'a' ? [{ name: 'gone', kind: 'dir' }, { name: 'empty', kind: 'dir' }] : []); },
    blob: p => Promise.resolve({ size: 3, arrayBuffer: bad, text: bad, slice: () => ({ arrayBuffer: bad }) }),
    read: () => Promise.resolve(null), stat: () => Promise.resolve(null)
  };
  const L = repo.ledger(repo.readOnly(raw));
  await L.fs.list('a'); same(await L.fs.list('a/empty'), []); await L.fs.list('a/gone'); await L.fs.list('a/never');
  await assert.rejects((await L.fs.blob('x.png')).arrayBuffer(), /EIO/);
  await assert.rejects((await L.fs.blob('y.png')).text(), /EIO/);
  await assert.rejects((await L.fs.blob('z.png')).slice(0, 1).arrayBuffer(), /EIO/);
  same(L.problems().map(p => [p.path, p.kind]), [['a/gone', 'vanished'], ['x.png', 'unreadable'], ['y.png', 'unreadable'], ['z.png', 'unreadable']]);
});

/* ---------- 1.19 slice 1: proposals, the soft lock and exact-text saves (docs/design.md section 27) ---------- */
const U = PF.util, PP = PF.proposals;
const RELEASE = example('maps/drafts/release.md');
const sha = t => PF.sha256.hex(t);
/* A proposal as the command line writes it: base and text, with their SHA-256s. */
function proposal(o) {
  return PP.make(Object.assign({ id: 'p-mh4k2a-x7w1k3m9p2', process: 'release', session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: NOW, app: '1.19.0',
    base: { kind: 'draft', ref: 'maps/drafts/release.md', text: RELEASE }, text: RELEASE.replace('title: Production release', 'title: Production release (proposed)'), replaces: null, after: null, note: '' }, o || {}));
}
function proposalFolder(extra) {
  const fs = new PF.fs.MemoryFS('test:' + Math.random(), null);
  const files = { 'people.json': people, 'maps/drafts/release.md': RELEASE };
  fs.reset(Object.assign(files, extra || {}));
  return fs;
}
const put = (fs, p, o) => fs.write('proposed/' + p.process + '/' + p.id + '.json', JSON.stringify(p, null, 2) + '\n');
/* Text of exactly n UTF-8 bytes ending with one character of w bytes (1 to 4), so the limit falls inside or just past it. */
function bytesOf(n, w) { const ch = { 1: 'a', 2: 'é', 3: '€', 4: '\u{1F600}' }[w]; return 'a'.repeat(n - w) + ch; }

rule('Drafts are limited to exactly 1 MB of UTF-8: 1,048,576 bytes is fine, one more is refused, whatever the characters at the edge', () => {
  assert.strictEqual(U.DRAFT_BYTES, 1048576);
  [1, 2, 3, 4].forEach(w => {
    const ok = bytesOf(U.DRAFT_BYTES, w), over = bytesOf(U.DRAFT_BYTES + 1, w);
    assert.strictEqual(U.utf8Bytes(ok), U.DRAFT_BYTES, w + '-byte edge');
    assert.strictEqual(U.draftTooBig(ok), null, w + '-byte character ending exactly at the limit');
    const big = U.draftTooBig(over);
    assert.ok(big && big.bytes === U.DRAFT_BYTES + 1, w + '-byte character one byte over');
  });
  // A 4-byte character straddling the boundary: the text is under a million JavaScript characters but over the limit in bytes.
  const straddle = 'a'.repeat(U.DRAFT_BYTES - 3) + '\u{1F600}';
  assert.ok(straddle.length < U.DRAFT_BYTES && U.draftTooBig(straddle), 'counted in bytes, not characters');
  const msg = U.draftTooBig('x'.repeat(1.2 * 1048576)).why;
  assert.strictEqual(msg, 'Not saved: this draft is 1.2 MB, and Flightdeck saves drafts up to 1 MB. Shorten it by about 0.2 MB (long notes or pasted logs are the usual cause), then save. Your text is still here.');
  assert.strictEqual(U.draftSize('x'.repeat(Math.floor(0.95 * 1048576))), '0.95 of 1 MB', 'the header shows the size from 90%');
  assert.strictEqual(U.draftSize('x'.repeat(Math.floor(0.89 * 1048576))), '', 'and not below');
});

rule('A draft over the limit is never written, and one over the limit in the folder is listed as too big, not loaded', async () => {
  const fs = proposalFolder(), path = 'maps/drafts/release.md';
  const over = '---\nprocess: release\n---\n' + 'x'.repeat(U.DRAFT_BYTES);
  await assert.rejects(() => repo.saveDraft(fs, 'release.md', over, U.hash(RELEASE), { expectText: RELEASE }), e => e.tooBig && /Not saved: this draft is/.test(e.message));
  assert.strictEqual(fs.files[path].t, RELEASE, 'nothing written');
  await assert.rejects(() => repo.saveDraft(fs, 'new.md', over, null, { expectText: null }), e => e.tooBig);
  assert.ok(!fs.files['maps/drafts/new.md']);
  // Reading counts the bytes actually read: 3-byte characters, under the limit in characters, over it in bytes.
  fs.files[path] = { t: '---\nprocess: release\n---\n' + '€'.repeat(400000), m: 1 };
  await assert.rejects(() => fs.read(path, { maxBytes: U.DRAFT_BYTES }), e => e.skipped);
  const d = await repo.loadAll(fs);
  assert.ok(!d.drafts.some(x => x.file === 'release.md'), 'not loaded');
  const u = d.unreadable.filter(x => x.draft === 'release.md')[0];
  assert.ok(u && /1\.1[0-9]? MB, over the 1 MB Flightdeck reads/.test(u.why), JSON.stringify(u));
});

rule('A draft save compares the exact text it expects: an FNV collision is refused, not written over', async () => {
  // These two lines share an FNV-1a fingerprint, and so do any two texts that start with them and go on the same way.
  const a = 'title: Release 6uzx\n' + RELEASE, b = 'title: Release d2ad\n' + RELEASE, path = 'maps/drafts/release.md';
  assert.strictEqual(U.hash(a), U.hash(b), 'set-up: a collision');
  const fs = proposalFolder({ [path]: b });
  const res = await repo.saveDraft(fs, 'release.md', 'mine', U.hash(a), { expectText: a });
  assert.ok(res.conflict && !res.afterWrite && res.theirs === b, 'refused before writing');
  assert.strictEqual(fs.files[path].t, b);
  const ok = await repo.saveDraft(fs, 'release.md', 'mine', U.hash(b), { expectText: b });
  assert.ok(ok.ok && fs.files[path].t === 'mine');
  // Every draft save names the text it expects; a caller that doesn't is refused, so none can fall back on the fingerprint.
  await assert.rejects(() => repo.saveDraft(fs, 'release.md', 'x', U.hash('mine')), /exact text/);
  // null: the file must not exist yet.
  const none = await repo.saveDraft(fs, 'release.md', 'again', null, { expectText: null });
  assert.ok(none.conflict && fs.files[path].t === 'mine');
});

rule('A proposal is valid only when its name, process, front matter, hashes and sizes all check out', () => {
  const p = proposal(), name = p.id + '.json', bytes = t => U.utf8Bytes(t);
  const ok = PP.check(JSON.parse(JSON.stringify(p)), name, 'release', bytes(JSON.stringify(p)));
  assert.ok(ok.ok, ok.why);
  assert.strictEqual(ok.meta.text, undefined, 'metadata only: no texts kept');
  assert.strictEqual(ok.meta.base.text, undefined);
  same([ok.meta.rev, ok.meta.base.rev, ok.meta.base.kind], [sha(p.text), sha(RELEASE), 'draft']);
  const bad = (o, n, proc, b, why) => { const r = PP.check(o, n || name, proc || 'release', b == null ? 100 : b); assert.ok(!r.ok && why.test(r.why), r.why); };
  bad(Object.assign({}, p, { text: p.text + 'x' }), null, null, null, /doesn't match its hash|hash/);
  bad(Object.assign({}, p, { base: Object.assign({}, p.base, { text: 'other' }) }), null, null, null, /hash/);
  bad(p, 'p-other-aaaaaaaaaa.json', null, null, /name/);
  bad(p, null, 'incident', null, /process/);
  bad(proposal({ text: RELEASE.replace('process: release', 'process: incident') }), null, null, null, /process/);
  bad(Object.assign({}, p, { pv: 2 }), null, null, null, /newer|format/);
  bad(Object.assign({}, p, { kind: 'plan' }), null, null, null, /format|kind/);
  bad(null, null, null, null, /read|JSON|format/);
  // Over 4 MB by the bytes read, though under 4 million characters.
  bad(p, null, null, PP.FILE_MAX + 1, /4 MB/);
  const wide = proposal({ text: '---\nprocess: release\n---\n' + '€'.repeat(360000) });
  assert.ok(wide.text.length < U.DRAFT_BYTES && U.utf8Bytes(wide.text) > U.DRAFT_BYTES);
  bad(wide, wide.id + '.json', null, null, /1 MB/);
});

rule('Proposals are listed per process with metadata only; a half-written one is listed as not ready and read again next time', async () => {
  const p = proposal(), fs = proposalFolder();
  await put(fs, p);
  const half = JSON.stringify(proposal({ id: 'p-mh4k2b-aaaaaaaaaa' })).slice(0, 300);
  await fs.write('proposed/release/p-mh4k2b-aaaaaaaaaa.json', half);
  // A process with a proposal and no draft is listed too.
  const q = proposal({ id: 'p-mh4k2c-bbbbbbbbbb', process: 'onboard', base: { kind: 'none', ref: null, text: '' }, text: '---\nprocess: onboard\ntitle: Onboarding\n---\n' });
  await put(fs, q);
  let d = await repo.loadAll(fs);
  const rel = d.proposed.procs.release, on = d.proposed.procs.onboard;
  same(rel.all.map(x => x.id), [p.id]);
  assert.strictEqual(rel.all[0].text, undefined, 'no text in memory');
  same(rel.bad.map(x => x.name), ['p-mh4k2b-aaaaaaaaaa.json']);
  same(on.all.map(x => [x.id, x.base.kind]), [[q.id, 'none']]);
  // The full text is read on demand, verified again.
  const full = await repo.readProposal(fs, 'release', p.id);
  assert.ok(full.ok && full.proposal.text === p.text);
  // The rest arrives: next time it's valid.
  await put(fs, proposal({ id: 'p-mh4k2b-aaaaaaaaaa' }));
  d = await repo.loadAll(fs);
  same(d.proposed.procs.release.all.map(x => x.id).sort(), [p.id, 'p-mh4k2b-aaaaaaaaaa'].sort());
  same(d.proposed.procs.release.bad, []);
});

rule('At most the newest 200 proposals per process are listed, with how many older ones there are', async () => {
  const fs = proposalFolder();
  for (let i = 0; i < 205; i++) await put(fs, proposal({ id: 'p-' + (1000000 + i).toString(36) + '-aaaaaaaaaa', at: new Date(Date.parse(NOW) + i * 1000).toISOString() }));
  const d = await repo.loadAll(fs), rel = d.proposed.procs.release;
  assert.strictEqual(rel.shown.length, 200);
  assert.strictEqual(rel.older, 5);
  assert.ok(rel.shown.every(x => x.id !== 'p-' + (1000000).toString(36) + '-aaaaaaaaaa'), 'the oldest are left out');
});

rule('Attempts and decisions are created once, read back, and refused over a file that is already there', async () => {
  const fs = proposalFolder(), p = proposal();
  await put(fs, p);
  const at = PP.attempt({ proposal: p.id, proposalRev: p.rev, writer: 'w8d2k4', n: 1, how: 'apply', from: sha(RELEASE), by: 'person-casey', at: NOW });
  assert.strictEqual(at.name, p.id + '.attempt.w8d2k4.1.json');
  await repo.writeRecord(fs, 'release', at.name, at.rec);
  await assert.rejects(() => repo.writeRecord(fs, 'release', at.name, at.rec), /already/);
  const dec = PP.decision({ proposal: p.id, proposalRev: p.rev, writer: 'w8d2k4', decisionRev: 1, seen: null, status: 'applied', attempt: 'w8d2k4.1', result: { rev: sha(p.text) }, by: 'person-casey', at: NOW });
  assert.strictEqual(dec.name, p.id + '.w8d2k4.1.json');
  await repo.writeRecord(fs, 'release', dec.name, dec.rec);
  const recs = await repo.listRecords(fs, 'release', p.id);
  same(recs.map(r => r.name).sort(), [at.name, dec.name].sort());
  assert.ok(recs.every(r => r.rec && /^[0-9a-f]{64}$/.test(r.sha)), 'each with the SHA-256 of its bytes');
  assert.strictEqual(PP.recState(recs).state, 'applied');
  // A record a read can't use (half-synced) is kept as unreadable, never dropped.
  await fs.write('proposed/release/' + p.id + '.zz9.1.json', '{"kind":"proposal-deci');
  const again = await repo.listRecords(fs, 'release', p.id);
  assert.ok(again.some(r => r.name === p.id + '.zz9.1.json' && r.rec === null));
  assert.strictEqual(PP.recState(again).state, 'unknown');
});

rule('A proposal\'s state comes from its attempts and decisions together, by decisionRev, never by clocks', () => {
  const pid = 'p-mh4k2a-x7w1k3m9p2', rev = 'a'.repeat(64);
  const A = (w, n) => { const x = PP.attempt({ proposal: pid, proposalRev: rev, writer: w, n, how: 'apply', from: 'b'.repeat(64), by: 'person-casey', at: NOW }); return { name: x.name, sha: sha(JSON.stringify(x.rec)), rec: PP.cleanRecord(JSON.parse(JSON.stringify(x.rec)), x.name) }; };
  const D = (w, r, status, extra) => { const x = PP.decision(Object.assign({ proposal: pid, proposalRev: rev, writer: w, decisionRev: r, seen: null, status, by: 'person-casey', at: NOW }, extra || {})); return { name: x.name, sha: sha(JSON.stringify(x.rec)), rec: PP.cleanRecord(JSON.parse(JSON.stringify(x.rec)), x.name) }; };
  const st = l => PP.recState(l).state;
  assert.strictEqual(st([]), 'pending');
  assert.strictEqual(st([A('w1', 1), D('w1', 1, 'applied', { attempt: 'w1.1', result: { rev } })]), 'applied');
  ['withdrawn', 'not-saved', 'cancelled'].forEach(s => assert.strictEqual(st([A('w1', 1), D('w1', 1, s, { attempt: 'w1.1' })]), 'tried', s));
  assert.strictEqual(st([A('w1', 1), D('w1', 1, 'applied', { attempt: 'w1.1', result: { rev } }), A('w2', 1), D('w2', 1, 'applied', { attempt: 'w2.1', result: { rev } })]), 'applied-twice');
  assert.strictEqual(st([A('w1', 1)]), 'maybe', 'an attempt without an outcome: may already be applied');
  assert.strictEqual(st([{ name: pid + '.attempt.w1.1.json', sha: 'c'.repeat(64), rec: null }]), 'unknown', 'an attempt that can\'t be read');
  assert.strictEqual(st([D('w1', 1, 'declined')]), 'declined');
  assert.strictEqual(st([D('w1', 1, 'declined'), D('w2', 2, 'reopened', { seen: pid + '.w1.1.json' })]), 'reopened');
  assert.strictEqual(st([D('w1', 2, 'declined'), D('w2', 2, 'reopened')]), 'decided-twice', 'two decisions with the same decisionRev');
  // The next decision is one more than the highest, and names it.
  const s = PP.recState([D('w1', 1, 'declined'), D('w2', 2, 'reopened', { seen: pid + '.w1.1.json' })]);
  same([s.nextRev, s.seen], [3, pid + '.w2.2.json']);
  // A decision whose clock says earlier still counts by its decisionRev.
  assert.strictEqual(st([D('w1', 2, 'declined', { at: '2020-01-01T00:00:00.000Z' }), D('w2', 1, 'reopened', { at: '2030-01-01T00:00:00.000Z' })]), 'declined');
  // Only pending, with no record at all, may ever be applied without a person.
  assert.strictEqual(PP.recState([]).auto, true);
  assert.strictEqual(PP.recState([D('w1', 1, 'declined'), D('w2', 2, 'reopened')]).auto, false, 'Reopen makes it reviewable, never automatic');
});

rule('Replacement and dependency: a replacement stands in for P1 with P1\'s base; a dependent waits for P1, in any order of arrival', () => {
  const base = RELEASE, b = RELEASE.replace('Production release', 'B'), c = RELEASE.replace('Production release', 'C');
  const p1 = proposal({ id: 'p-a1-aaaaaaaaaa', text: b });
  const rep = proposal({ id: 'p-a2-bbbbbbbbbb', text: c, replaces: p1.id });
  const dep = proposal({ id: 'p-a3-cccccccccc', base: { kind: 'proposal', ref: p1.id, text: b }, text: c, after: p1.id });
  const meta = p => PP.check(JSON.parse(JSON.stringify(p)), p.id + '.json', 'release', 10).meta;
  const draft = t => ({ exists: true, rev: sha(t) });
  const fit = (metas, recs, dr) => { const o = {}; PP.judge(metas, recs || {}, dr).forEach(x => { o[x.id] = x.fit; }); return o; };
  // Replacement arriving after P1, and before it: P1 is replaced either way; the replacement goes A -> C directly.
  same(fit([meta(p1), meta(rep)], {}, draft(base)), { [p1.id]: 'replaced', [rep.id]: 'ready' });
  same(fit([meta(rep)], {}, draft(base)), { [rep.id]: 'ready' }, 'a replacement on its own is judged on its own');
  // Dependent before P1 arrives: waiting for an earlier proposal.
  same(fit([meta(dep)], {}, draft(base)), { [dep.id]: 'waiting' });
  same(fit([meta(p1), meta(dep)], {}, draft(base)), { [p1.id]: 'ready', [dep.id]: 'waiting' });
  // P1 applied: the draft is B, so the dependent is a fast-forward.
  const applied = { [p1.id]: [{ name: p1.id + '.attempt.w1.1.json', sha: 'x', rec: { kind: 'attempt', proposal: p1.id, attempt: 'w1.1', writer: 'w1', n: 1 } }, { name: p1.id + '.w1.1.json', sha: 'y', rec: { kind: 'decision', proposal: p1.id, writer: 'w1', decisionRev: 1, status: 'applied', attempt: 'w1.1' } }] };
  same(fit([meta(p1), meta(dep)], applied, draft(b)), { [p1.id]: 'applied', [dep.id]: 'ready' });
  // P1 declined, or replaced: the dependent waits for Review.
  const declined = { [p1.id]: [{ name: p1.id + '.w1.1.json', sha: 'y', rec: { kind: 'decision', proposal: p1.id, writer: 'w1', decisionRev: 1, status: 'declined' } }] };
  same(fit([meta(p1), meta(dep)], declined, draft(base)), { [p1.id]: 'declined', [dep.id]: 'review' });
  same(fit([meta(p1), meta(rep), meta(dep)], {}, draft(base)), { [p1.id]: 'replaced', [rep.id]: 'ready', [dep.id]: 'review' });
  // Not a fast-forward: the draft moved on.
  same(fit([meta(p1)], {}, draft(c)), { [p1.id]: 'older' });
  // Already the draft's text: never applied again.
  same(fit([meta(p1)], {}, draft(b)), { [p1.id]: 'already' });
  // No draft: a proposal from nothing or from a version is a fast-forward.
  const fresh = proposal({ id: 'p-a4-dddddddddd', base: { kind: 'none', ref: null, text: '' } });
  same(fit([meta(fresh)], {}, { exists: false, rev: null }), { [fresh.id]: 'ready' });
  // A cycle, or a link to another session, makes a proposal invalid.
  const x = proposal({ id: 'p-b1-aaaaaaaaaa', replaces: 'p-b2-aaaaaaaaaa' }), y = proposal({ id: 'p-b2-aaaaaaaaaa', replaces: 'p-b1-aaaaaaaaaa' });
  same(fit([meta(x), meta(y)], {}, draft(base)), { [x.id]: 'invalid', [y.id]: 'invalid' });
  const other = proposal({ id: 'p-b3-aaaaaaaaaa', session: 's-other0000000', replaces: p1.id });
  same(fit([meta(p1), meta(other)], {}, draft(base)), { [p1.id]: 'ready', [other.id]: 'invalid' });
});

rule('The reviewed set: exactly the records a person saw, by name and SHA-256; anything added, changed or gone differs', () => {
  const r = [{ name: 'a.json', sha: '1', rec: {} }, { name: 'b.json', sha: '2', rec: {} }];
  const seen = PP.reviewed(r);
  assert.ok(PP.sameSet(seen, PP.reviewed(r.slice().reverse())), 'order doesn\'t matter');
  assert.ok(!PP.sameSet(seen, PP.reviewed(r.concat([{ name: 'c.json', sha: '3', rec: {} }]))), 'added');
  assert.ok(!PP.sameSet(seen, PP.reviewed([r[0], { name: 'b.json', sha: '9', rec: {} }])), 'changed: same name, other bytes');
  assert.ok(!PP.sameSet(seen, PP.reviewed([r[0]])), 'gone');
  assert.ok(!PP.reviewed([{ name: 'x.json', sha: '1', rec: null }]), 'an unreadable record can\'t be in a reviewed set');
});

rule('Presence is fresh by its beat in elapsed time; on first sight by its clock; malformed counts as fresh', () => {
  const rec = PP.presence({ writer: 'w1', by: 'person-avery', device: 'Windows · Edge', since: NOW, at: NOW, beat: 1, drafts: ['release'], main: [] });
  const now = Date.parse(NOW);
  // First sight: within 60 s on this computer's clock.
  let f = PP.freshApp(rec, null, 1000, now + 30000);
  assert.ok(f.fresh, 'first sight, 30 s old');
  assert.ok(!PP.freshApp(rec, null, 1000, now + 61000).fresh, 'first sight, 61 s old');
  // Then by its beat: unchanged for 60 s of elapsed time is stale, whatever the clock says.
  f = PP.freshApp(rec, f.memo, 1000 + 59000, now - 3600000);
  assert.ok(f.fresh, 'same beat, 59 s of elapsed time');
  const stale = PP.freshApp(rec, f.memo, 1000 + 61000, now);
  assert.ok(!stale.fresh, 'same beat, 61 s of elapsed time');
  const beat = PP.freshApp(Object.assign({}, rec, { beat: 2 }), stale.memo, 1000 + 62000, now - 86400000);
  assert.ok(beat.fresh, 'a new beat is fresh again, even with a clock far off');
  // The command line looks once: at within 60 s, or ahead of this clock by up to 10 minutes.
  assert.ok(PP.freshCli(rec, now + 59000));
  assert.ok(!PP.freshCli(rec, now + 61000));
  assert.ok(PP.freshCli(rec, now - 9 * 60000), 'another computer\'s clock ahead by 9 minutes');
  assert.ok(!PP.freshCli(rec, now - 11 * 60000), 'more than 10 minutes ahead');
  assert.ok(PP.freshCli(null, now), 'a malformed record counts as fresh: the safe outcome is a proposal');
  assert.strictEqual(PP.cleanPresence({ kind: 'presence', pv: 1, writer: 'w1' }, 'w2.json'), null, 'a record that disagrees with its file name is malformed');
});

rule('The main editor: the highest claimRev among fresh editors wins; equal claims, or no claim and two editors, are ambiguous', () => {
  const ed = (w, main) => PP.presence({ writer: w, by: 'person-' + w, device: 'D', since: NOW, at: NOW, beat: 1, drafts: ['release'], main: main || [] });
  const c = (rev, seen) => [{ process: 'release', claimRev: rev, seen: seen || null }];
  same(PP.mainOf('release', [ed('a')]), { writer: 'a', ambiguous: false, claimRev: 0 }, 'one editor, no claim');
  assert.ok(PP.mainOf('release', [ed('a'), ed('b')]).ambiguous, 'two editors, no claim');
  same(PP.mainOf('release', [ed('a', c(2)), ed('b', c(3)), ed('c')]).writer, 'b', 'three windows: the highest claim wins');
  assert.ok(PP.mainOf('release', [ed('a', c(3)), ed('b', c(3))]).ambiguous, 'two claims with the same claimRev');
  // A claim ends with its presence: only fresh presences are passed in, so b's claim is gone and a's decides.
  same(PP.mainOf('release', [ed('a', c(2)), ed('c')]).writer, 'a');
  // Make this the main editor: one more than the highest claim seen, naming it.
  same(JSON.parse(JSON.stringify(PP.claim('release', [ed('a', c(2)), ed('b', c(3))]))), { process: 'release', claimRev: 4, seen: { writer: 'b', claimRev: 3 } });
  same(JSON.parse(JSON.stringify(PP.claim('release', []))), { process: 'release', claimRev: 1, seen: null });
  // Other processes' claims don't count.
  same(PP.mainOf('release', [ed('a', [{ process: 'incident', claimRev: 9, seen: null }]), ed('b', c(1))]).writer, 'b');
});

rule('What a change from your AI assistant did, in words: steps and phases changed, added and removed, by ID, for the highlight and the notice', () => {
  const a = ['---', 'process: release', 'title: Release', '---', '', '## Prep · READ-DO {#prep}', '- [ ] {confirm} One {#one}', '- [ ] {confirm} Two {#two}', '', '## Ship · READ-DO {#ship}', '- [ ] {confirm} Three {#three}', ''].join('\n');
  const b = a.replace('One {#one}', 'One, changed {#one}').replace('Two {#two}', 'Two, changed {#two}').replace('- [ ] {confirm} Three {#three}', '- [ ] {confirm} Three {#three}\n- [ ] {confirm} Four {#four}').replace('## Ship · READ-DO', '## Ship it · READ-DO');
  const c = PP.changes(a, b);
  same(c.steps, { changed: ['one', 'two'], added: ['four'], removed: [] });
  same(c.phases, { changed: ['ship'], added: [], removed: [] });
  same(c.keys.sort(), ['phase:ship', 'step:four', 'step:one', 'step:two']);
  assert.strictEqual(PP.changeWords(c), '2 steps changed, 1 added, 1 phase changed');
  assert.strictEqual(PP.changeWords(PP.changes(a, a.replace('- [ ] {confirm} Two {#two}\n', ''))), '1 step removed');
  assert.strictEqual(PP.changeWords(PP.changes(a, a.replace('title: Release', 'title: Shipping'))), 'the details at the top changed');
  assert.strictEqual(PP.changeWords(PP.changes(a, a.replace('One {#one}', 'Uno {#one}'))), '1 step changed');
  // A step without an ID is matched by its lines, not its position: adding one above it doesn't make it look changed.
  const k = a.replace('- [ ] {confirm} Three {#three}', '- [ ] {confirm} Plain\n- [ ] {confirm} Three {#three}');
  const c2 = PP.changes(k, k.replace('- [ ] {confirm} Plain', '- [ ] {confirm} New one\n- [ ] {confirm} Plain'));
  assert.strictEqual(PP.changeWords(c2), '1 step added');
  same(c2.keys, ['step:#2']);
});

rule('Presence files: each window writes its own; cleanup deletes only files over 24 hours old whose size and time didn\'t change, at most 20', async () => {
  const fs = proposalFolder(), now = Date.parse(NOW), old = new Date(now - 25 * 3600000).toISOString();
  await repo.writePresence(fs, PP.presence({ writer: 'live', by: 'person-avery', device: 'D', since: NOW, at: NOW, beat: 3, drafts: ['release'], main: [] }));
  for (let i = 0; i < 25; i++) await repo.writePresence(fs, PP.presence({ writer: 'old' + i, by: 'person-avery', device: 'D', since: old, at: old, beat: 1, drafts: [], main: [] }));
  const listed = await repo.loadPresence(fs);
  assert.strictEqual(listed.length, 26);
  assert.ok(listed.every(x => x.rec), 'all readable');
  // A window renews old3 while cleanup is deciding: its file changes between the first look and the delete, so it stays.
  const stat = fs.stat.bind(fs); let n = 0;
  fs.stat = p => { if (p === 'presence/old3.json' && ++n === 2) { fs.files[p] = { t: JSON.stringify(PP.presence({ writer: 'old3', by: 'person-avery', device: 'D', since: old, at: NOW, beat: 2, drafts: ['release'], main: [] })), m: now + 5 }; } return stat(p); };
  const gone = await repo.cleanPresence(fs, now);
  assert.ok(gone <= 20, 'at most 20 a pass: ' + gone);
  assert.ok(fs.files['presence/live.json'], 'a live file stays');
  assert.ok(fs.files['presence/old3.json'], 'renewed during cleanup: kept');
  const left = Object.keys(fs.files).filter(p => /^presence\/old/.test(p)).length;
  assert.strictEqual(left, 25 - gone);
  await repo.removePresence(fs, 'live');
  assert.ok(!fs.files['presence/live.json']);
  // Loading lists presence/ only when it's in the folder: an ordinary folder costs nothing extra.
  const plain = proposalFolder(); let lists = [];
  const list = plain.list.bind(plain); plain.list = p => { lists.push(p); return list(p); };
  await repo.loadAll(plain);
  assert.ok(lists.indexOf('presence') < 0 && lists.indexOf('proposed') < 0, lists.join());
});

rule('An older copy (1.18) loads a folder with proposed/ and presence/ exactly as without them; its Folder health lists them only under the generic checks', async () => {
  const fsMod = require('fs'), path = require('path');
  const OLD = load(false, (f, src) => f === 'storage/repo.js' ? fsMod.readFileSync(path.join(__dirname, 'fixtures', 'repo-1.18.js'), 'utf8') : src);
  const mk = extra => { const fs = new OLD.fs.MemoryFS('old:' + Math.random(), null); fs.reset(Object.assign({ 'people.json': people, 'maps/drafts/release.md': RELEASE }, extra || {})); return fs; };
  const p = proposal(), at = PP.attempt({ proposal: p.id, proposalRev: p.rev, writer: 'w8d2k4', n: 1, how: 'apply', from: sha(RELEASE), by: 'person-casey', at: NOW });
  const extra = {
    ['proposed/release/' + p.id + '.json']: JSON.stringify(p), ['proposed/release/' + at.name]: JSON.stringify(at.rec),
    'proposed/onboard/p-mh4k2c-bbbbbbbbbb.json': JSON.stringify(proposal({ id: 'p-mh4k2c-bbbbbbbbbb', process: 'onboard', base: { kind: 'none', ref: null, text: '' }, text: '---\nprocess: onboard\n---\n' })),
    'presence/w8d2k4.json': JSON.stringify(PP.presence({ writer: 'w8d2k4', by: 'person-casey', device: 'D', since: NOW, at: NOW, beat: 1, drafts: ['release'], main: [] }))
  };
  const plain = await OLD.repo.loadAll(mk()), withNew = await OLD.repo.loadAll(mk(extra));
  const shape = d => JSON.parse(JSON.stringify({ drafts: d.drafts.map(x => x.md), processes: d.processes, plans: d.plans, unreadable: d.unreadable, failed: d.failed, people: d.people }));
  same(shape(withNew), shape(plain), 'the ordinary loaders never list the new folders');
  // Folder health in the older copy: every file is listed and checked by its generic rules; the new folders add no issue.
  const now = Date.parse(NOW);
  const report = async fs => { const scan = await OLD.repo.scan(fs); return OLD.health.check({ data: await OLD.repo.loadAll(fs), scan, me: 'person-casey', app: '1.18.0' }, now); };
  const a = await report(mk()), b = await report(mk(extra));
  same(b.issues.map(i => i.id).sort(), a.issues.map(i => i.id).sort(), 'no new issues');
  // A leftover temporary file in presence/ is reported like any other (the generic check applies there too).
  const tmpFs = mk(Object.assign({}, extra, { 'presence/.w8d2k4.json.tmp': 'x' }));
  tmpFs.files['presence/.w8d2k4.json.tmp'].m = now - 3 * 3600000;
  const c = await report(tmpFs);
  assert.ok(c.issues.some(i => i.id === 'tmp' && i.paths.indexOf('presence/.w8d2k4.json.tmp') >= 0), JSON.stringify(c.issues.map(i => i.id)));
});

rule('A correction that would take the draft over 1 MB is refused before anything is written', async () => {
  const fs = folder(), r = await started(fs), C = PF.corrections;
  const n = C.build({ id: 'c1', at: NOW, by: 'person-blake', session: 'blake-laptop', map: R.mapOf(r), step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes with no restarts, checked twice by the on-call engineer', version: 1, folder: r.folder });
  await repo.addNote(fs, r, 'blake-laptop', n);
  const g = C.status(C.groups(C.collect((await repo.loadAll(fs)).runs, 'release')), [])[0];
  const base0 = fs.files['maps/drafts/release.md'].t + '\n<!-- ', tail = ' -->\n';
  const base = base0 + 'x'.repeat(U.DRAFT_BYTES - U.utf8Bytes(base0) - U.utf8Bytes(tail)) + tail;
  assert.strictEqual(U.utf8Bytes(base), U.DRAFT_BYTES, 'set-up: a draft exactly at the limit');
  await fs.write('maps/drafts/release.md', base);
  assert.ok(U.utf8Bytes(C.review(g, base).text) > U.DRAFT_BYTES, 'set-up: the correction makes it longer');
  await assert.rejects(() => repo.applyCorrection(fs, { process: 'release', file: 'release.md', base, expect: U.hash(base), group: g }), e => e.tooBig);
  assert.strictEqual(fs.files['maps/drafts/release.md'].t, base);
});

/* ---------- 1.19 slice 1, review 1: a proposal's state from all its records and relatives ---------- */
const recOf = (x) => ({ name: x.name, sha: sha(JSON.stringify(x.rec)), rec: PP.cleanRecord(JSON.parse(JSON.stringify(x.rec)), x.name) });
const ATT = (pid, w, n) => recOf(PP.attempt({ proposal: pid, proposalRev: 'a'.repeat(64), writer: w, n, how: 'apply', from: null, by: 'person-casey', at: NOW }));
const DEC = (pid, w, r, status, extra) => recOf(PP.decision(Object.assign({ proposal: pid, proposalRev: 'a'.repeat(64), writer: w, decisionRev: r, seen: null, status, by: 'person-casey', at: NOW }, extra || {})));

rule('Review 1: a decision settles the interrupted attempts it names, so Decline shows Declined and Apply again leaves nothing open', () => {
  const pid = 'p-mh4k2a-x7w1k3m9p2', open = ATT(pid, 'w1', 1);
  assert.strictEqual(PP.recState([open]).state, 'maybe');
  same(PP.recState([open]).open, ['w1.1']);
  const declined = DEC(pid, 'w2', 1, 'declined', { settles: ['w1.1'] });
  assert.strictEqual(PP.recState([open, declined]).state, 'declined', 'the interrupted attempt is settled by the decline');
  // Apply again: its own attempt, and an outcome that settles the earlier one too.
  const again = [open, ATT(pid, 'w2', 1), DEC(pid, 'w2', 1, 'applied', { attempt: 'w2.1', settles: ['w1.1', 'w2.1'], result: { rev: 'b'.repeat(64) } })];
  const st = PP.recState(again);
  same([st.state, st.open], ['applied', []]);
  // Marking the original as applied afterwards isn't a second application: the later decision settled it.
  assert.strictEqual(PP.recState(again.concat([DEC(pid, 'w3', 2, 'applied', { attempt: 'w1.1', settles: ['w1.1'], result: { rev: 'b'.repeat(64) } })])).state, 'applied');
  // Two windows that never saw each other's application are still Applied twice.
  assert.strictEqual(PP.recState([ATT(pid, 'w1', 1), DEC(pid, 'w1', 1, 'applied', { attempt: 'w1.1', settles: ['w1.1'] }), ATT(pid, 'w2', 1), DEC(pid, 'w2', 1, 'applied', { attempt: 'w2.1', settles: ['w2.1'] })]).state, 'applied-twice');
});

rule('Review 1: another window\'s cancelled attempt at a higher decisionRev never hides an application that succeeded', () => {
  const pid = 'p-mh4k2a-x7w1k3m9p2';
  const recs = [ATT(pid, 'w1', 1), ATT(pid, 'w2', 1), DEC(pid, 'w1', 1, 'applied', { attempt: 'w1.1', settles: ['w1.1'], result: { rev: 'b'.repeat(64) } }), DEC(pid, 'w2', 2, 'cancelled', { attempt: 'w2.1', settles: ['w2.1'] })];
  assert.strictEqual(PP.recState(recs).state, 'applied');
  // Its dependent is a fast-forward once the draft is P1's text, whatever P1's records say.
  const B = RELEASE.replace('Production release', 'B'), C = RELEASE.replace('Production release', 'C');
  const p1 = proposal({ id: 'p-a1-aaaaaaaaaa', text: B }), dep = proposal({ id: 'p-a3-cccccccccc', base: { kind: 'proposal', ref: p1.id, text: B }, text: C, after: p1.id });
  const meta = p => PP.check(JSON.parse(JSON.stringify(p)), p.id + '.json', 'release', 10).meta;
  const fit = (r) => PP.judge([meta(p1), meta(dep)], { [p1.id]: r }, { exists: true, rev: sha(B) }).filter(x => x.id === dep.id)[0].fit;
  assert.strictEqual(fit(recs.map(r => Object.assign({}, r, { name: r.name.replace(pid, p1.id), rec: Object.assign({}, r.rec, { proposal: p1.id }) }))), 'ready');
  assert.strictEqual(fit([Object.assign(ATT(p1.id, 'w1', 1)), DEC(p1.id, 'w1', 1, 'cancelled', { attempt: 'w1.1', settles: ['w1.1'] })]), 'ready', 'P1 tried, yet the draft is its text: the dependent starts from the draft');
});

rule('Review 1: the 200-proposal list never drops a parent a listed proposal depends on', async () => {
  const fs = proposalFolder(), B = RELEASE.replace('Production release', 'B');
  const parent = proposal({ id: 'p-0-aaaaaaaaaa', text: B, at: '2026-01-01T00:00:00.000Z' });
  await put(fs, parent);
  for (let i = 0; i < 200; i++) await put(fs, proposal({ id: 'p-' + (1000000 + i).toString(36) + '-aaaaaaaaaa', at: new Date(Date.parse(NOW) + i * 1000).toISOString() }));
  const dep = proposal({ id: 'p-zzzzzz-cccccccccc', base: { kind: 'proposal', ref: parent.id, text: B }, text: B + '\nmore\n', after: parent.id, at: '2026-12-01T00:00:00.000Z' });
  await put(fs, dep);
  const rel = (await repo.loadAll(fs)).proposed.procs.release;
  assert.strictEqual(rel.shown.length, 200, 'still 200 listed');
  assert.ok(rel.all.some(m => m.id === parent.id), 'every proposal\'s metadata is kept for judging');
  const recs = {}; rel.all.forEach(m => { recs[m.id] = []; });
  const x = PP.judge(rel.all, recs, { exists: true, rev: sha(B) }).filter(y => y.id === dep.id)[0];
  assert.strictEqual(x.fit, 'ready');
});

run();
