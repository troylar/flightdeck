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

rule('A suggested fix goes in the suggester\'s own notes file, and each person\'s decision in their own file; the decision made after seeing another wins', async () => {
  const fs = folder(), r = await started(fs), F = PF.fixes;
  const n = F.build({ id: 'fx1', at: NOW, by: 'person-blake', session: 'blake-laptop', kind: 'missing', phase: 'deploy', step: 'jenkins', where: 'after', text: 'Check the queue first', version: 1 });
  await repo.addNote(fs, r, 'blake-laptop', n);
  assert.ok(fs.files['runs/release/run1/notes-blake-laptop.jsonl'], 'the suggester\'s own notes file');
  const rec = (by, status, at, reason, current) => F.decision({ process: 'release', id: 'fx1' }, by, status, reason, at, { current, latestVersion: 1 });
  await repo.decideFix(fs, rec('person-casey', 'accepted', '2026-10-17T23:30:00.000Z'), 'casey-laptop');
  // Avery's computer runs 40 minutes behind; she decides after reading Casey's acceptance.
  const seen = (await repo.loadAll(fs)).fixDecisions[0];
  assert.strictEqual(seen._file, 'fx1.casey-laptop.json');
  await repo.decideFix(fs, rec('person-avery', 'declined', '2026-10-17T22:50:00.000Z', 'We do this in the job', seen), 'avery-desktop');
  same(Object.keys(fs.files).filter(p => p.indexOf('suggestions/') === 0).sort(), ['suggestions/release/fx1.avery-desktop.json', 'suggestions/release/fx1.casey-laptop.json']);
  await assert.rejects(() => repo.decideFix(fs, Object.assign(rec('a', 'open', NOW), { suggestion: '../x' }), 'w1'));
  await fs.write('suggestions/release/junk.json', '{"kind":"fix-decision","suggestion":"fx1","status":"merged","by":"x","at":"2099-01-01"}');
  const d = await repo.loadAll(fs), run1 = d.runs.filter(x => x.id === 'run1')[0];
  same([run1._notes[0].kind, run1._notes[0].fixKind, run1._notes[0].target], ['fix', 'missing', { phase: 'deploy', step: 'jenkins', where: 'after' }]);
  assert.strictEqual(d.fixDecisions.length, 2, 'an unknown status is ignored');
  same(d.fixUnread.map(u => u._file), ['junk.json'], 'and reported as unreadable');
  const s = F.withStatus(F.collect(d.runs, 'release'), d.fixDecisions, d.processes[0].index.all.map(v => v.info))[0];
  same([s.status, s.decision.by, s.decision.reason, s.decision.rev, s.decision.seen], ['declined', 'person-avery', 'We do this in the job', 2, 'fx1.casey-laptop.json']);
});

rule('A decision file that can\'t be read is reported, not dropped', async () => {
  const fs = folder(), r = await started(fs), F = PF.fixes;
  await repo.addNote(fs, r, 'blake-laptop', F.build({ id: 'fx1', at: NOW, by: 'person-blake', session: 'blake-laptop', kind: 'missing', phase: 'deploy', step: 'jenkins', where: 'after', text: 'x', version: 1 }));
  await repo.decideFix(fs, F.decision({ process: 'release', id: 'fx1' }, 'person-casey', 'accepted', '', NOW, { latestVersion: 1 }), 'casey-laptop');
  const read = fs.read.bind(fs);
  fs.read = p => /^suggestions\//.test(p) ? Promise.reject(new Error('NotReadableError')) : read(p);
  const d = await repo.loadAll(fs);
  same([d.fixDecisions.length, d.fixUnread.length, d.fixUnread[0].process, d.fixUnread[0]._file], [0, 1, 'release', 'fx1.casey-laptop.json']);
  fs.read = read;
  await fs.write('suggestions/release/fx1.casey-laptop.json', '{');
  const e = await repo.loadAll(fs);
  same([e.fixDecisions.length, e.fixUnread.length], [0, 1], 'half-synced JSON counts as unread, not as no decision');
  await fs.write('suggestions/release/fx1.casey-laptop.json', 'null');
  same([(await repo.loadAll(fs)).fixUnread.length], [1], 'so does a file holding null');
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

run();
