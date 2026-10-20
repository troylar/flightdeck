// OneDrive between two computers, simulated: each computer has its own copy of the folder, and sync runs only when the test says so.
// Covers what the team folder must survive: delayed sync, handoff, emergency takeover, conflict copies, refresh cost, and history.
'use strict';
const assert = require('assert');
const { load, example, exampleSetup, rule, run, sampleDone } = require('./harness');
const PF = load(), R = PF.run, repo = PF.repo;
const EX = exampleSetup(PF);
const done = sampleDone(PF);
const NOW = '2026-10-17T21:00:00.000Z';
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const people = JSON.parse(example('people.json'));

/* The cloud keeps one version of each file. A computer's copy changes only when it syncs. If both sides changed a file since
   they last agreed, the cloud keeps the one that arrived first and saves the other next to it as "name-HOST.ext", as OneDrive does. */
class Cloud { constructor() { this.files = {}; } }
class Computer {
  constructor(cloud, host) { this.cloud = cloud; this.host = host; this.files = {}; this.base = {}; this.reads = 0; this.kind = 'memory'; this.name = host; }
  _p(path) { if (path.split('/').some(seg => !seg || seg === '.' || seg === '..' || seg.trim() !== seg || /[\\\x00-\x1f]/.test(seg))) throw new Error('Bad path: ' + path); return path; }
  list(path) {
    const prefix = path ? path + '/' : '', seen = {}, out = [];
    Object.keys(this.files).forEach(p => {
      if (p.indexOf(prefix) !== 0) return;
      const rest = p.slice(prefix.length), i = rest.indexOf('/'), name = i < 0 ? rest : rest.slice(0, i);
      if (!seen[name]) { seen[name] = true; out.push({ name, kind: i < 0 ? 'file' : 'dir' }); }
    });
    return Promise.resolve(out);
  }
  read(path) { this.reads++; const t = this.files[this._p(path)]; return Promise.resolve(t == null ? null : { text: t, mtime: 1 }); }
  stat(path) { const t = this.files[path]; return Promise.resolve(t == null ? null : { size: t.length, mtime: this.mt && this.mt[path] || 1 }); }
  blob(path) { const t = this.files[path]; return Promise.resolve(t == null ? null : new Blob([t])); }
  write(path, data) { this._p(path); if (typeof data === 'string') { this.files[path] = data; return Promise.resolve(); } return data.text().then(t => { this.files[path] = t; }); }
  append(path, text) { this.files[path] = (this.files[path] || '') + text; return Promise.resolve(); }
  remove(path) { delete this.files[path]; return Promise.resolve(); }
  sync() {
    const c = this.cloud.files;
    Object.keys(this.files).forEach(p => {
      const mine = this.files[p], base = this.base[p], theirs = c[p];
      if (mine === base) return;
      if (theirs !== undefined && theirs !== base && theirs !== mine) c[p.replace(/(\.\w+)$/, '-' + this.host + '$1')] = mine;
      else c[p] = mine;
    });
    Object.keys(this.base).forEach(p => { if (!(p in this.files) && c[p] === this.base[p]) delete c[p]; });
    this.files = Object.assign({}, c); this.base = Object.assign({}, c);
  }
}

async function twoComputers() {
  const cloud = new Cloud(), a = new Computer(cloud, 'CASEY'), b = new Computer(cloud, 'BLAKE');
  await a.write('people.json', JSON.stringify(people));
  await repo.publish(a, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW });
  const d = await repo.loadAll(a);
  const r = R.create(d.processes[0].index.latest, { title: 'Release', details: { ticket: 'ABC-1', commit: 'aaa111', environment: 'production' }, roles: { 'release-lead': 'person-casey', qa: 'person-blake' }, by: 'person-casey', session: 'casey', now: NOW, id: 'run1' });
  await repo.saveRun(a, r, 'casey');
  a.sync(); b.sync();
  return { cloud, a, b };
}
const get = (fs) => repo.loadRun(fs, 'release', 'run1');

rule('Handing off passes one exact revision; the new recorder continues from it and the old window can no longer write', async () => {
  const { a, b } = await twoComputers();
  const ra = await get(a);
  R.handOff(ra, 'person-blake', 'person-casey', NOW);
  await repo.saveRun(a, ra, 'casey');
  assert.strictEqual(ra.recorder.handoff.rev, ra.rev, 'the handoff names the revision it was saved as');
  let rb = await get(b);
  assert.strictEqual(rb.recorder.person, 'person-casey', 'not synced yet: Blake still sees Casey recording');
  a.sync(); b.sync();
  rb = await get(b);
  assert.ok(!R.waitingForHandoff(rb));
  R.pickUp(rb, 'person-blake', 'blake', NOW);
  done(rb, R.mapOf(rb), 'approved', 'person-blake', NOW);
  await repo.saveRun(b, rb, 'blake');
  assert.ok(/at revision 2/.test(rb.log[rb.log.length - 1].what) || rb.log.some(l => /Picked up recording at revision 2/.test(l.what)));
  b.sync(); a.sync();
  const stale = await get(a);
  stale.recorder = { person: 'person-casey', session: 'casey' };
  await assert.rejects(repo.saveRun(a, stale, 'casey'), e => !!e.disk, 'Casey\'s old window is refused');
});

rule('An emergency takeover while OneDrive is behind never loses either side: the other version arrives as a conflict copy', async () => {
  const { a, b } = await twoComputers();
  const ra = await get(a), rb = await get(b);
  done(ra, R.mapOf(ra), 'approved', 'person-casey', NOW);
  await repo.saveRun(a, ra, 'casey');                    // Casey's change, not synced yet
  R.takeOver(rb, 'person-blake', 'blake', NOW);
  done(rb, R.mapOf(rb), 'tests', 'person-blake', NOW);
  await repo.saveRun(b, rb, 'blake', { takeover: true }); // Blake's, from the older copy
  a.sync(); b.sync();
  const now = await get(b);
  assert.strictEqual(now._conflicts.length, 1, 'one conflict copy, visible in the run');
  const copy = await repo.readCopy(b, now, now._conflicts[0]);
  const both = [now, copy].map(x => Object.keys(x.steps).filter(k => x.steps[k].s === 'done'));
  assert.ok(both.some(s => s.includes('approved')) && both.some(s => s.includes('tests')), 'both answers survive somewhere');
  const lines = R.compare(now, copy, R.mapOf(now), id => id);
  assert.ok(lines.some(l => /here, .* in the copy/.test(l)));
  await repo.removeCopy(b, now, now._conflicts[0]);
  assert.strictEqual((await get(b))._conflicts.length, 0);
});

rule('A refused save keeps this window\'s version as a conflict copy next to the run', async () => {
  const { a } = await twoComputers();
  const mine = await get(a), other = await get(a);
  done(other, R.mapOf(other), 'approved', 'person-casey', NOW);
  await repo.saveRun(a, other, 'casey');
  done(mine, R.mapOf(mine), 'tests', 'person-casey', NOW);
  const err = await repo.saveRun(a, mine, 'casey').catch(e => e);
  assert.ok(err.disk && /run\.conflict-casey-\d+\.json$/.test(err.keptAs));
  const kept = await repo.readCopy(a, await get(a), err.keptAs.split('/').pop());
  assert.strictEqual(kept.steps.tests.s, 'done');
});

rule('History beyond what run.json keeps is appended to a history file, never dropped', async () => {
  const { a } = await twoComputers();
  const r = await get(a), map = R.mapOf(r);
  for (let i = 0; i < 12; i++) { done(r, map, 'approved', 'person-casey', new Date(Date.parse(NOW) + i * 1000).toISOString()); R.clear(r, map, 'approved', 'person-casey', NOW); }
  for (let i = 0; i < 310; i++) r.log.push({ at: NOW, by: 'x', what: 'filler ' + i });
  R.setDetail(r, map, 'ticket', 'ABC-2', 'person-casey', NOW);
  await repo.saveRun(a, r, 'casey');
  assert.ok(r.log.length <= 300 && r.steps.approved.history.length <= 10);
  const h = await repo.loadHistory(a, r);
  assert.ok(h.some(x => x.kind === 'answer' && x.step === 'approved'), 'older answers archived');
  assert.ok(h.some(x => x.kind === 'log'), 'older log entries archived');
  const saved = JSON.parse(a.files['runs/release/run1/run.json']);
  assert.ok(!('_overflow' in saved));
});

rule('Routine refreshes skip complete publications and ended runs; a deep refresh reads everything again', async () => {
  const { a, b } = await twoComputers();
  const r = await get(a);
  R.end(r, R.mapOf(r), 'Cancelled', 'person-casey', 'Casey', NOW);
  await repo.saveRun(a, r, 'casey');
  a.sync(); b.sync();
  b.reads = 0; await repo.loadAll(b); const cold = b.reads;          // people, Jira workflows, 3 publication files, the run
  b.reads = 0; await repo.loadAll(b); const routine = b.reads;       // people and Jira workflows only
  b.reads = 0; await repo.loadAll(b, { deep: true }); const deep = b.reads; // people and the ended run again
  same([cold, routine, deep], [6, 2, 6]);   // each also checks for jira/workflows.json
});

rule('An unreadable folder is an error, never an empty folder', async () => {
  const { a } = await twoComputers();
  a.list = () => Promise.reject(Object.assign(new Error('Access denied'), { name: 'NotAllowedError' }));
  await assert.rejects(repo.loadAll(a), /Access denied/);
});

rule('Reference screenshots are frozen into each published version', async () => {
  const cloud = new Cloud(), a = new Computer(cloud, 'A');
  await a.write('images/release/jenkins.png', 'first picture');
  const md = '---\nprocess: x\ntitle: X\n---\n## P · READ-DO {#p}\n- [ ] {confirm} Look {#a}\n  ![The job page](images/release/jenkins.png)';
  const res = await repo.publish(a, md, { people, ...EX, by: 'a', changes: 'x', existing: [], now: NOW });
  await a.write('images/release/jenkins.png', 'second picture');
  assert.strictEqual(a.files['publications/x/' + res.folder + '/images/release/jenkins.png'], 'first picture');
});

rule('Follow-ups, answers done differently and corrections are kept with the run and printed on the receipt', async () => {
  const { a } = await twoComputers();
  const r = await get(a), map = R.mapOf(r);
  done(r, map, 'approved', 'person-casey', NOW);
  R.differently(r, map, 'approved', 'Approved in the change board instead', 'person-casey', NOW);
  R.addFollowUp(r, { text: 'Automate the flag check', owner: 'person-blake', ticket: 'ABC-9' }, 'person-casey', NOW);
  assert.throws(() => R.addFollowUp(r, { text: '  ' }, 'person-casey', NOW), /Say what/);
  r._notes = [{ id: 'n1', step: 'flags', text: 'Flags live in values-prod.yaml now', by: 'person-blake', kind: 'map', at: NOW }];
  await repo.saveRun(a, r, 'casey');
  const back = await get(a); back._notes = r._notes;
  same(back.followUps.map(f => f.text), ['Automate the flag check']);
  assert.strictEqual(R.corrections(back, map).length, 2);
  const text = R.receipt(back, map, id => id, NOW, back._notes);
  assert.ok(/Follow-ups\n  - Automate the flag check \(person-blake\) \[ABC-9\]/.test(text));
  assert.ok(/Corrections · 2\n/.test(text) && /\[One-off\]/.test(text) && /Problem: Flags live in values-prod\.yaml now/.test(text), text);
});

rule('Two computers decide on the same correction at once: both files are kept, and both computers show Needs review', async () => {
  const { a, b } = await twoComputers(), C = PF.corrections;
  const r = await get(b);
  await repo.addNote(b, r, 'blake', C.build({ id: 'c1', at: NOW, by: 'person-blake', session: 'blake', map: R.mapOf(r), step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes', version: 1, folder: r.folder }));
  b.sync(); a.sync();
  const groupsOn = async fs => { const d = await repo.loadAll(fs); return C.status(C.groups(C.collect(d.runs, 'release')), d.corrDecisions); };
  const ga = (await groupsOn(a))[0], gb = (await groupsOn(b))[0];
  await repo.decideCorrection(a, C.decision(ga, 'person-casey', 'applied', '', NOW, { current: ga.decision }), 'casey');
  await repo.decideCorrection(b, C.decision(gb, 'person-blake', 'declined', 'Ten minutes is enough', NOW, { current: gb.decision }), 'blake');
  assert.strictEqual((await groupsOn(a))[0].label, 'Applied to draft', 'before syncing, each sees its own');
  a.sync(); b.sync(); a.sync();
  const after = [(await groupsOn(a))[0], (await groupsOn(b))[0]];
  same(after.map(g => [g.label, g.tie, g.decision.by]), [['Needs review', true, after[0].decision.by], ['Needs review', true, after[0].decision.by]], 'the same on both');
  const settled = await groupsOn(a);
  await repo.decideCorrection(a, C.decision(settled[0], 'person-casey', 'applied', '', NOW, { current: settled[0].decision }), 'casey');
  a.sync(); b.sync();
  same([(await groupsOn(b))[0].label, (await groupsOn(b))[0].decision.rev], ['Applied to draft', 2], 'deciding again after seeing both settles it');
});

rule('Run files written by earlier versions of Flightdeck still load', async () => {
  const old = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'run-2026-10-17.json'), 'utf8'));
  const r = R.sanitize(old);
  assert.ok(r, 'loads');
  same(r.fields, {}); same(r.followUps, []);
  assert.strictEqual(r.steps.approved.s, 'done');
  assert.ok(R.headline(r, R.mapOf(r)).text);
});

rule('P1: a refused save still archives the history that no longer fits in run.json', async () => {
  const { a } = await twoComputers();
  const mine = await get(a), other = await get(a), map = R.mapOf(mine);
  for (let i = 0; i < 12; i++) { done(mine, map, 'approved', 'person-casey', new Date(Date.parse(NOW) + i * 1000).toISOString()); R.clear(mine, map, 'approved', 'person-casey', NOW); }
  assert.ok((mine._overflow || []).length >= 2, 'overflow is pending');
  done(other, R.mapOf(other), 'tests', 'person-casey', NOW);
  await repo.saveRun(a, other, 'casey');
  await assert.rejects(repo.saveRun(a, mine, 'casey'), e => !!e.disk);
  const h = await repo.loadHistory(a, mine);
  assert.ok(h.filter(x => x.kind === 'answer').length >= 2, 'archived answers survive the refused save');
  await assert.rejects(repo.saveRun(a, mine, 'casey'), e => !!e.disk);
  const again = await repo.loadHistory(a, mine);
  assert.strictEqual(again.length, h.length, 'a retry never duplicates archived records');
});

rule('P1: keeping a conflict copy restores everything in it, keeps the displaced version, and refuses a copy of a different run', async () => {
  const { a } = await twoComputers();
  const cur = await get(a), copy = await get(a), map = R.mapOf(cur);
  R.done(cur, map, 'tests', 'person-casey', NOW, { run: '123' });
  R.done(copy, map, 'tests', 'person-blake', NOW, { run: '456' });
  R.setFields(copy, map, 'merge', { from: 'hotfix' }, null, 'person-blake', NOW);
  R.setRole(copy, map, 'qa', 'person-morgan', 'person-blake', NOW);
  const lines = R.compare(cur, copy, map, id => id);
  assert.ok(lines.some(l => /123.*456|Run number/.test(l)), 'evidence differences are shown: ' + lines.join(' | '));
  assert.ok(lines.some(l => /From branch|merge/.test(l)) && lines.some(l => /qa/.test(l)), 'filled-in values and roles are compared');
  R.adopt(cur, copy, 'person-casey', NOW);
  assert.strictEqual(cur.steps.tests.values.run, '456');
  same(cur.fields.merge, { from: 'hotfix' });
  assert.strictEqual(cur.roles.qa, 'person-morgan');
  const other = JSON.parse(JSON.stringify(copy)); other.id = 'someone-else';
  assert.throws(() => R.adopt(cur, other, 'person-casey', NOW), /different run/);
  const otherMap = JSON.parse(JSON.stringify(copy)); otherMap.mapHash = 'zzzz';
  assert.throws(() => R.adopt(cur, otherMap, 'person-casey', NOW), /different version/);
});

rule('P2: an ended run is reread when a late note or a conflict copy arrives, without rereading quiet ones', async () => {
  const { a, b } = await twoComputers();
  const r = await get(a);
  R.end(r, R.mapOf(r), 'Cancelled', 'person-casey', 'Casey', NOW);
  await repo.saveRun(a, r, 'casey'); a.sync(); b.sync();
  await repo.loadAll(b);
  await repo.addNote(a, r, 'blake', { id: 'late', at: NOW, by: 'person-blake', step: 'approved', text: 'Arrived late' });
  a.sync(); b.sync();
  const d = await repo.loadAll(b);
  assert.ok(d.runs[0]._notes.some(n => n.id === 'late'));
  await b.write('runs/release/run1/run-PC (1).json', b.files['runs/release/run1/run.json']); 
  const d2 = await repo.loadAll(b);
  same(d2.runs[0]._conflicts, ['run-PC (1).json']);
  const copy = await repo.readCopy(b, d2.runs[0], 'run-PC (1).json');
  assert.ok(copy, 'a OneDrive copy name with a space can be opened');
  await repo.removeCopy(b, d2.runs[0], 'run-PC (1).json');
  assert.ok(!('runs/release/run1/run-PC (1).json' in b.files));
});

rule('P2: a deep refresh notices a damaged publication', async () => {
  const { b } = await twoComputers();
  await repo.loadAll(b);
  const key = Object.keys(b.files).find(k => /^publications\/release\/[^/]+\/map\.md$/.test(k));
  b.files[key] = b.files[key] + '\nedited by hand';
  assert.ok((await repo.loadAll(b)).processes[0].pubs[0].ok, 'routine refresh trusts the cache');
  assert.ok(!(await repo.loadAll(b, { deep: true })).processes[0].pubs[0].ok, 'Refresh rereads and catches it');
});

rule('P2: follow-ups stop at 100 with a clear message instead of disappearing later', async () => {
  const { a } = await twoComputers();
  const r = await get(a);
  for (let i = 0; i < 100; i++) R.addFollowUp(r, { text: 'Item ' + i }, 'person-casey', NOW);
  assert.throws(() => R.addFollowUp(r, { text: 'One more' }, 'person-casey', NOW), /100 follow-ups/);
});

rule('R2: history added while an archive write is in progress is never lost', async () => {
  const { a } = await twoComputers();
  const r = await get(a);
  let release; const gate = new Promise(res => { release = res; });
  const orig = a.append.bind(a);
  a.append = (p, t) => gate.then(() => orig(p, t));
  r._overflow = [{ kind: 'log', at: NOW, by: 'x', what: 'original 0', id: 'o0' }];
  const saving = repo.saveRun(a, r, 'casey');
  await new Promise(res => setTimeout(res, 5));
  r._overflow.push({ kind: 'log', at: NOW, by: 'x', what: 'original 1', id: 'o1' });
  release(); await saving;
  a.append = orig;
  await repo.saveRun(a, r, 'casey');
  const h = await repo.loadHistory(a, r);
  same(h.map(x => x.what).sort(), ['original 0', 'original 1']);
});

rule('R2: a failed archive write keeps the records for the next save', async () => {
  const { a } = await twoComputers();
  const r = await get(a);
  r._overflow = [{ kind: 'log', at: NOW, by: 'x', what: 'keep me', id: 'k1' }];
  const orig = a.append.bind(a); a.append = () => Promise.reject(new Error('offline'));
  await assert.rejects(repo.saveRun(a, r, 'casey'), /offline/);
  a.append = orig;
  await repo.saveRun(a, r, 'casey');
  same((await repo.loadHistory(a, r)).map(x => x.what), ['keep me']);
});

rule('R2: comparing copies shows differences in history, deadlines, gate approvals and follow-up details', async () => {
  const { a } = await twoComputers();
  const cur = await get(a), copy = await get(a), map = R.mapOf(cur);
  done(cur, map, 'approved', 'person-casey', NOW); done(copy, map, 'approved', 'person-casey', NOW);
  R.setDetail(copy, map, 'ticket', 'ABC-2', 'person-casey', NOW); R.setDetail(copy, map, 'ticket', 'ABC-1', 'person-casey', NOW);
  done(copy, map, 'approved', 'person-casey', NOW);
  copy.steps.announce = { s: 'open', deadline: { at: '2026-10-17T22:00:00.000Z', by: 'x', set: NOW } };
  R.addFollowUp(cur, { text: 'Same text', owner: 'person-avery', ticket: 'ABC-7' }, 'person-casey', NOW);
  R.addFollowUp(copy, { text: 'Same text', owner: 'person-blake', ticket: 'ABC-8' }, 'person-casey', NOW);
  const lines = R.compare(cur, copy, map, id => id).join(' | ');
  assert.ok(/earlier answers|history/i.test(lines), 'history: ' + lines);
  assert.ok(/deadline/i.test(lines), 'deadline: ' + lines);
  assert.ok(/ABC-8|person-blake/.test(lines), 'follow-up details: ' + lines);
});

rule('R2: unusual but legal copy names (accents, spaces) can be opened and removed', async () => {
  const { b } = await twoComputers();
  const r = await get(b);
  await b.write('runs/release/run1/run-LAPTOP José.json', b.files['runs/release/run1/run.json']);
  const back = await get(b);
  same(back._conflicts, ['run-LAPTOP José.json']);
  assert.ok(await repo.readCopy(b, back, 'run-LAPTOP José.json'));
  await assert.rejects(repo.readCopy(b, back, '../run.json'), /Not a run copy/);
  await repo.removeCopy(b, back, 'run-LAPTOP José.json');
});

rule('R2: caches never hide a change: a bad publication stays bad, and late notes on an ended run show up', async () => {
  const { a, b } = await twoComputers();
  const r = await get(a);
  await repo.addNote(a, r, 'blake', { id: 'n1', at: NOW, by: 'person-blake', step: 'approved', text: 'first' });
  R.end(r, R.mapOf(r), 'Cancelled', 'person-casey', 'Casey', NOW); await repo.saveRun(a, r, 'casey');
  a.sync(); b.sync();
  await repo.loadAll(b);
  await repo.addNote(a, r, 'blake', { id: 'n2', at: NOW, by: 'person-blake', step: 'approved', text: 'second, same file' });
  a.sync(); b.sync();
  assert.ok((await repo.loadAll(b)).runs[0]._notes.some(n => n.id === 'n2'), 'a grown notes file on an ended run is noticed');
  const key = Object.keys(b.files).find(k => /^publications\/release\/[^/]+\/map\.md$/.test(k));
  b.files[key] += '\nedited';
  assert.ok(!(await repo.loadAll(b, { deep: true })).processes[0].pubs[0].ok);
  assert.ok(!(await repo.loadAll(b)).processes[0].pubs[0].ok, 'the next routine refresh doesn\'t bring back the old good copy');
});

rule('R3: a run that changes while it is being read is never cached as the old version', async () => {
  const { a, b } = await twoComputers();
  const r = await get(a);
  R.end(r, R.mapOf(r), 'Cancelled', 'person-casey', 'Casey', NOW); await repo.saveRun(a, r, 'casey'); a.sync(); b.sync();
  const origRead = b.read.bind(b); let once = true;
  b.read = (p) => origRead(p).then(f => {
    if (once && /run1\/run\.json$/.test(p)) { once = false; const x = JSON.parse(b.files[p]); x.title = 'Changed meanwhile'; b.files[p] = JSON.stringify(x); b.mt = Object.assign(b.mt || {}, { [p]: 2 }); }
    return f;
  });
  await repo.loadAll(b);
  b.read = origRead;
  const d = await repo.loadAll(b);
  assert.strictEqual(d.runs[0].title, 'Changed meanwhile', 'the next routine refresh shows the newer run');
});

rule('R3: a copy name like run..json is a legal copy; separators and traversal are not', async () => {
  const { b } = await twoComputers();
  await b.write('runs/release/run1/run..json', b.files['runs/release/run1/run.json']);
  const back = await get(b);
  assert.ok(await repo.readCopy(b, back, 'run..json'));
  await assert.rejects(repo.readCopy(b, back, 'run/../run.json'), /Not a run copy/);
});

rule('R3: comparing copies shows a different blocked reason or a different person answering', async () => {
  const { a } = await twoComputers();
  const cur = await get(a), copy = await get(a), map = R.mapOf(cur);
  R.block(cur, map, 'approved', 'Waiting on someone', 'person-casey', NOW);
  R.block(copy, map, 'approved', 'Failed', 'person-blake', NOW);
  const lines = R.compare(cur, copy, map, id => id).join(' | ');
  assert.ok(/reason/.test(lines) && /answered by/.test(lines), lines);
});

rule('R4: comparing copies shows when each answer was given', async () => {
  const { a } = await twoComputers();
  const cur = await get(a), copy = await get(a), map = R.mapOf(cur);
  done(cur, map, 'approved', 'person-casey', '2026-10-17T20:00:00.000Z');
  done(copy, map, 'approved', 'person-casey', '2026-10-17T20:05:00.000Z');
  assert.ok(/answered at/.test(R.compare(cur, copy, map, id => id).join(' | ')));
});

rule('R14: if the cloud keeps only the last of two saves, the other save still surfaces as a conflict copy', async () => {
  const { a, b, cloud } = await twoComputers();
  repo.config.candidateGraceMs = 0;
  const ra = await get(a), rb = await get(b);
  done(ra, R.mapOf(ra), 'approved', 'person-casey', NOW); await repo.saveRun(a, ra, 'casey', { writer: 'pcA' });
  R.takeOver(rb, 'person-blake', 'blake', NOW); done(rb, R.mapOf(rb), 'tests', 'person-blake', NOW); await repo.saveRun(b, rb, 'blake', { writer: 'pcB', takeover: true });
  a.sync();
  // Last writer wins, no rename: B's run.json simply replaces A's.
  cloud.files['runs/release/run1/run.json'] = b.files['runs/release/run1/run.json'];
  Object.keys(b.files).forEach(k => { if (/candidate-/.test(k)) cloud.files[k] = b.files[k]; });
  b.files = Object.assign({}, cloud.files); b.base = Object.assign({}, cloud.files);
  const now = await get(b);
  const lost = now._conflicts.filter(n => /^candidate-pcA-/.test(n));
  assert.strictEqual(lost.length, 1, 'A\'s replaced save is offered: ' + now._conflicts.join(', '));
  const copy = await repo.readCopy(b, now, lost[0]);
  assert.strictEqual(copy.steps.approved.s, 'done', 'and it holds A\'s answer');
  repo.config.candidateGraceMs = 60000;
});

rule('Follow-up: a receipt whose contents are already current is cleaned up, not shown as a conflict', async () => {
  const { a } = await twoComputers();
  repo.config.candidateGraceMs = 0;
  const r = await get(a);
  done(r, R.mapOf(r), 'approved', 'person-casey', NOW); await repo.saveRun(a, r, 'casey', { writer: 'pcA' });
  // Same change saved again under another receipt name, with a list that no longer mentions the first receipt.
  const cur = JSON.parse(a.files['runs/release/run1/run.json']);
  const stale = JSON.parse(JSON.stringify(cur)); stale.rev = 1; stale.lineage = ['old.zzzzzzzz'];
  a.files['runs/release/run1/candidate-old-zzzzzzzz.json'] = JSON.stringify(stale);
  const back = await get(a);
  assert.ok(!back._conflicts.some(n => /zzzzzzzz/.test(n)), 'not offered as a conflict');
  await new Promise(res => setTimeout(res, 5));
  assert.ok(!('runs/release/run1/candidate-old-zzzzzzzz.json' in a.files), 'and removed');
  repo.config.candidateGraceMs = 60000;
});

rule('Follow-up: on a finished run, a receipt that becomes old enough is rechecked without opening the run', async () => {
  const { a } = await twoComputers();
  const r = await get(a);
  R.end(r, R.mapOf(r), 'Cancelled', 'person-casey', 'Casey', NOW); await repo.saveRun(a, r, 'casey', { writer: 'pcA' });
  const other = JSON.parse(a.files['runs/release/run1/run.json']); other.title = 'A different save'; other.lineage = ['pcB.yyyyyyyy'];
  a.files['runs/release/run1/candidate-pcB-yyyyyyyy.json'] = JSON.stringify(other);
  repo.config.candidateGraceMs = 50;
  a.mt = Object.assign(a.mt || {}, { 'runs/release/run1/candidate-pcB-yyyyyyyy.json': Date.now() });
  const first = await repo.loadAll(a);
  assert.strictEqual(first.runs[0]._conflicts.length, 0, 'still in its grace period');
  await new Promise(res => setTimeout(res, 80));
  const later = await repo.loadAll(a);
  assert.ok(later.runs[0]._conflicts.some(n => /yyyyyyyy/.test(n)), 'shown once old enough, on a routine refresh');
  repo.config.candidateGraceMs = 60000;
});

rule('A run loaded before its publication record synced is refused at save time if that record turns out to be in a newer format', async () => {
  const { cloud, a, b } = await twoComputers();
  const pubPath = Object.keys(cloud.files).find(p => /^publications\/release\/[^/]+\/publication\.json$/.test(p));
  // Blake's computer hasn't received the publication record yet when it loads the run: nothing says it's read-only.
  const good = b.files[pubPath]; delete b.files[pubPath]; delete b.base[pubPath];
  const r = await get(b);
  assert.ok(!r._unrunnable, 'set-up: writable while the record is missing');
  // The record arrives, written by a newer copy in a format this copy doesn't know.
  const info = JSON.parse(good); info.format = 'preflight-publication/2'; cloud.files[pubPath] = JSON.stringify(info);
  b.sync();
  const before = b.files['runs/release/run1/run.json'];
  R.setDetail(r, R.mapOf(r), 'ticket', 'ABC-2', 'person-casey', NOW);
  await assert.rejects(repo.saveRun(b, r, 'casey'), e => e.unrunnable && /needs Flightdeck 2\.0\. This copy shows it but won't run it/.test(e.message));
  assert.ok(/needs Flightdeck 2\.0/.test(r._unrunnable || ''), 'the run is now read-only in this window');
  assert.strictEqual(b.files['runs/release/run1/run.json'], before, 'run.json is untouched');
  // Once a publication's format is known good, a save reads it no more (here on a computer that never loaded the versions).
  cloud.files[pubPath] = good;
  const c = new Computer(cloud, 'AVERY'); c.sync();
  const r2 = await get(c), paths = [], read = c.read.bind(c);
  c.read = p => { paths.push(p); return read(p); };
  R.setDetail(r2, R.mapOf(r2), 'ticket', 'ABC-3', 'person-casey', NOW); await repo.saveRun(c, r2, 'casey');
  R.setDetail(r2, R.mapOf(r2), 'ticket', 'ABC-4', 'person-casey', NOW); await repo.saveRun(c, r2, 'casey');
  assert.ok(!paths.some(p => /publication\.json$/.test(p)), 'no extra read: ' + paths.join(', '));
});

/* ---------- The connection check between two computers (1.15) ---------- */
const CN = PF.connection;
function check(n, writer, by, atMs, seen) { return { id: 'chk' + n + writer.slice(0, 4), n, by, writer, device: writer === 'wa' ? 'Windows · Edge' : 'Mac · Chrome', at: new Date(atMs).toISOString(), app: '1.15.0', run: { key: 'release/run1', rev: 1 }, seen: seen || [] }; }

rule('A connection check goes from A to B and its answer from B to A only as OneDrive delivers each file', async () => {
  const { a, b } = await twoComputers();
  const t0 = Date.now();
  const name = await repo.sendProbe(a, check(1, 'wa', 'person-casey', t0), t0);
  assert.strictEqual((await repo.loadConnection(b, t0)).probes.length, 0, 'not on B until OneDrive delivers it');
  a.sync(); b.sync();
  const onB = await repo.loadConnection(b, t0 + 5000);
  assert.strictEqual(onB.probes.length, 1);
  const p = onB.probes[0];
  assert.strictEqual(p._file, name);
  same(CN.pending(onB, 'wb', null).map(x => x.id), [p.id], 'B has a check to answer');
  const rb = await repo.loadRun(b, 'release', 'run1');
  const ack = await repo.sendAck(b, { probe: p.id, probeFile: p._file, by: 'person-blake', writer: 'wb', device: 'Mac · Chrome', at: new Date(t0 + 6000).toISOString(), firstSeenAt: new Date(t0 + 5000).toISOString(), app: '1.15.0', run: { key: 'release/run1', rev: rb.rev, savedAt: rb.savedAt }, folderReadAt: new Date(t0 + 4000).toISOString() });
  same(CN.pending(await repo.loadConnection(b, t0 + 7000), 'wb', null), [], 'answered: nothing waits on B');
  assert.strictEqual((await repo.loadConnection(a, t0 + 7000)).acks.length, 0, 'the answer isn\'t on A yet');
  b.sync(); a.sync();
  const onA = await repo.loadConnection(a, t0 + 9000);
  const rows = CN.results([{ file: name, id: p.id, n: 1, at: t0, run: { key: 'release/run1', rev: rb.rev } }], onA, { [ack]: t0 + 9000 }, t0 + 9000);
  assert.strictEqual(rows[0].answers.length, 1);
  assert.strictEqual(rows[0].answers[0].roundTrip, 9000, 'the round trip, on A\'s clock alone');
  assert.strictEqual(rows[0].answers[0].run.state, 'same', 'B has the run\'s latest revision');
  // A's next check lists the answer it saw; once that reaches B, B knows its answer arrived.
  assert.ok(!CN.confirmed(await repo.loadConnection(b, t0 + 10000), ack));
  await repo.sendProbe(a, check(2, 'wa', 'person-casey', t0 + 10000, [ack]), t0 + 10000);
  a.sync(); b.sync();
  assert.ok(CN.confirmed(await repo.loadConnection(b, t0 + 11000), ack));
});

rule('Two computers answering one check write two files; a check or an answer is never written over', async () => {
  const { a, b } = await twoComputers();
  const t0 = Date.now(), name = await repo.sendProbe(a, check(1, 'wa', 'person-casey', t0), t0);
  a.sync(); b.sync();
  const p = (await repo.loadConnection(b, t0)).probes[0];
  const rec = w => ({ probe: p.id, probeFile: name, by: 'person-blake', writer: w, device: 'x', at: new Date(t0).toISOString(), firstSeenAt: null, app: '1.15.0', run: null, folderReadAt: null });
  await repo.sendAck(b, rec('wb')); await repo.sendAck(a, rec('wc'));
  await assert.rejects(repo.sendAck(b, rec('wb')), /already in the folder/);
  await assert.rejects(repo.sendProbe(a, check(1, 'wa', 'person-casey', t0), t0), /already in the folder/);
  b.sync(); a.sync(); b.sync();
  assert.strictEqual((await repo.loadConnection(a, t0)).acks.length, 2);
  assert.ok(!Object.keys(a.cloud.files).some(k => /^connection\/.*-(CASEY|BLAKE)\.json$/.test(k)), 'no OneDrive copies: each file has one writer');
});

rule('Only the last 15 minutes of checks are read; files older than 7 days are cleaned up by any window, and nothing else is', async () => {
  const { a, b } = await twoComputers();
  const now = Date.now(), DAY = 86400000;
  const oldName = await repo.sendProbe(a, check(1, 'wa', 'person-casey', now - 8 * DAY), now - 8 * DAY);
  const staleName = await repo.sendProbe(a, check(2, 'wa', 'person-casey', now - 20 * 60000), now - 20 * 60000);
  const freshName = await repo.sendProbe(a, check(3, 'wa', 'person-casey', now - 60000), now - 60000);
  await a.write('connection/ack-chk1wa.wz.json', '{}'); a.mt = { 'connection/ack-chk1wa.wz.json': now - 9 * DAY };
  await a.write('connection/notes.txt', 'not Flightdeck\'s');
  a.sync(); b.sync();
  same((await repo.loadConnection(b, now)).probes.map(p => p._file), [freshName], 'only the fresh check is read');
  b.mt = { 'connection/ack-chk1wa.wz.json': now - 9 * DAY };
  assert.strictEqual(await repo.cleanConnection(b, now), 2, 'B cleans up what A wrote a week ago');
  assert.ok(!b.files['connection/' + oldName] && !b.files['connection/ack-chk1wa.wz.json']);
  assert.ok(b.files['connection/' + staleName] && b.files['connection/' + freshName] && b.files['connection/notes.txt'], 'everything newer, and anything not named like a check, stays');
  b.sync(); a.sync();
  assert.ok(!a.files['connection/' + oldName], 'the deletion reaches A');
});

rule('Saved history: two computers editing one draft each append to their own file, and both computers see both saves in one order', async () => {
  const { a, b } = await twoComputers(), TL = PF.timeline, H = PF.util.hash, path = 'maps/drafts/release.md', dir = repo.historyDir('draft-edit', 'release');
  await a.write(path, example('maps/drafts/release.md')); a.sync(); b.sync();
  /* One computer's save in the app: a checked save, then one line in its own history file. */
  const save = async (fs, writer, seq, seen, change) => {
    const before = (await fs.read(path)).text, after = change(before), res = await repo.saveDraft(fs, 'release.md', after, H(before), { expectText: before });
    if (!res.ok) return res;
    const id = writer + seq, rec = TL.histLine({ kind: 'draft-edit', id, process: 'release', writer, seq, by: 'person-' + writer, at: NOW, from: H(before), to: res.hash, seen, before, after, source: 'editor', units: [], items: [] });
    await repo.appendHistory(fs, dir, writer, [JSON.stringify(rec)], {});
    return id;
  };
  const c1 = await save(a, 'casey', 1, null, t => t.replace('title: Production release', 'title: Production release (weekly)'));
  a.sync(); b.sync();
  const b1 = await save(b, 'blake', 1, c1, t => t + '\n<!-- reviewed -->\n');
  b.sync(); a.sync();
  const c2 = await save(a, 'casey', 2, b1, t => t.replace('(weekly)', '(Thursdays)'));
  a.sync(); b.sync();
  assert.ok(Object.keys(a.cloud.files).filter(p => p.indexOf(dir + '/') === 0).sort().join() === [dir + '/blake.jsonl', dir + '/casey.jsonl'].join(), 'one file per writer, no OneDrive copies');
  const cur = H((await a.read(path)).text);
  const onA = await repo.loadEditHistory(a, dir, cur), onB = await repo.loadEditHistory(b, dir, cur);
  same(onA.items.map(x => x.gap ? 'gap' : x.entry.id), [c2, b1, c1], 'both writers\' saves, newest first, linked by fingerprints');
  same(onA, onB, 'the same on both computers');
  // A save refused because the other computer's change hadn't arrived writes no history line.
  const stale = await repo.saveDraft(b, 'release.md', 'x', H('not what is there'), { expectText: 'not what is there' });
  assert.ok(stale.conflict);
  assert.strictEqual(b.files[dir + '/blake.jsonl'].trim().split('\n').length, 1);
});

/* ---------- 1.17 slice 1b: freshness by elapsed time between two computers ---------- */
function ticking() { let t = 1000; const c = () => t; c.ahead = ms => { t += ms; }; return c; }

rule('A late note on a month-old run arrives on the other computer within the 10-minute sweep, and at once after Refresh', async () => {
  const { a, b } = await twoComputers(), clock = ticking();
  const r = await get(a), MONTH = '2026-09-15T10:00:00.000Z';
  R.end(r, R.mapOf(r), 'Cancelled', 'person-casey', 'Casey', MONTH);
  await repo.saveRun(a, r, 'casey');
  a.sync(); b.sync();
  await repo.loadAll(b, { clock });
  await repo.addNote(a, r, 'avery', { id: 'late', at: NOW, by: 'person-avery', step: 'approved', text: 'Found this a month later' });
  a.sync(); b.sync();
  const now = await repo.loadAll(b, { clock, deep: true });
  assert.ok(now.reads['release/run1'].run._notes.some(n => n.id === 'late'), 'Refresh shows it at once');
  await repo.addNote(a, r, 'avery', { id: 'later', at: NOW, by: 'person-avery', step: 'approved', text: 'And one more' });
  a.sync(); b.sync();
  let seenAt = null;
  for (let pass = 1; pass <= 20 && !seenAt; pass++) {
    clock.ahead(30000);
    const res = (await repo.loadAll(b, { clock })).reads['release/run1'];
    if (res.kind === 'fresh' && res.run._notes.some(n => n.id === 'later')) seenAt = pass * 30;
  }
  assert.ok(seenAt && seenAt <= 600, 'arrived within 10 minutes of elapsed time: ' + seenAt);
});

rule('The open run on one computer shows the other\'s saved change on its next 5-second reread, as before', async () => {
  const { a, b } = await twoComputers(), clock = ticking();
  await repo.loadAll(a, { clock }); await repo.loadAll(b, { clock });
  const mine = await get(a); mine.details.commit = 'bbb222'; await repo.saveRun(a, mine, 'casey');
  a.sync(); b.sync();
  clock.ahead(5000);
  assert.strictEqual((await get(b)).details.commit, 'bbb222', 'the open run\'s reread reads run.json in full');
  const res = (await repo.loadAll(b, { clock })).reads['release/run1'];
  assert.ok(res.kind === 'fresh' ? res.run.details.commit === 'bbb222' : res.fileHash === (await get(b))._fileHash, 'and the routine refresh agrees with it');
});

/* ---------- 1.19 slice 1: proposals between two computers (docs/design.md section 27) ---------- */
const PP = PF.proposals, SHA = t => PF.sha256.hex(t), DRAFT = 'maps/drafts/release.md';
async function draftOnBoth() {
  const two = await twoComputers();
  await two.a.write(DRAFT, example('maps/drafts/release.md')); two.a.sync(); two.b.sync();
  return two;
}
function proposalFrom(base, text, id) {
  return PP.make({ id: id || 'p-mh4k2a-x7w1k3m9p2', process: 'release', session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: NOW, app: '1.19.0', base: { kind: 'draft', ref: DRAFT, text: base }, text, replaces: null, after: null, note: '' });
}
/* The acceptance transaction as one computer's window runs it, at the folder level: an attempt first, then the save with
   the exact text it expects, then the outcome. */
async function applyOn(fs, writer, p, expectText) {
  const at = PP.attempt({ proposal: p.id, proposalRev: p.rev, writer, n: 1, how: 'apply', from: SHA(expectText), by: 'person-casey', at: NOW });
  await repo.writeRecord(fs, 'release', at.name, at.rec);
  const res = await repo.saveDraft(fs, 'release.md', p.text, PF.util.hash(expectText), { expectText });
  const recs = await repo.listRecords(fs, 'release', p.id), st = PP.recState(recs);
  const d = PP.decision({ proposal: p.id, proposalRev: p.rev, writer, decisionRev: st.nextRev, seen: st.seen, status: res.ok ? 'applied' : 'not-saved', attempt: writer + '.1', result: res.ok ? { rev: SHA(p.text) } : null, by: 'person-casey', at: NOW });
  await repo.writeRecord(fs, 'release', d.name, d.rec);
  return res;
}

rule('Known limit, pinned: a window on another computer that checked before the first attempt synced applies the proposal again; once synced, it shows Applied twice', async () => {
  const { a, b } = await draftOnBoth(), A = example('maps/drafts/release.md'), B = A.replace('title: Production release', 'title: B');
  const p = proposalFrom(A, B);
  await a.write('proposed/release/' + p.id + '.json', JSON.stringify(p)); a.sync(); b.sync();
  // Computer 1 applies A -> B, then the person takes it back and saves A.
  assert.ok((await applyOn(a, 'w1', p, A)).ok);
  assert.ok((await repo.saveDraft(a, 'release.md', A, PF.util.hash(B), { expectText: B })).ok);
  // Computer 2 checked earlier and stalled; it resumes before computer 1's files arrive: it sees no attempt and a draft of A.
  same((await repo.listRecords(b, 'release', p.id)).map(r => r.name), [], 'nothing from computer 1 yet');
  assert.ok((await applyOn(b, 'w2', p, A)).ok, 'its save of B succeeds on its own copy');
  a.sync(); b.sync(); a.sync();
  assert.strictEqual(a.files[DRAFT], B, 'the change the person took back reappears: the documented limit');
  const d = await repo.loadAll(a), recs = d.proposed.procs.release.records.filter(r => r.name.indexOf(p.id + '.') === 0);
  assert.strictEqual(PP.recState(recs).state, 'applied-twice', 'and the proposal says so');
});

rule('A proposal written on one computer reaches the other and is listed there once it has synced whole', async () => {
  const { a, b } = await draftOnBoth(), A = example('maps/drafts/release.md');
  const p = proposalFrom(A, A.replace('title: Production release', 'title: From B'));
  await b.write('proposed/release/' + p.id + '.json', JSON.stringify(p));
  let d = await repo.loadAll(a);
  assert.ok(!d.proposed || !d.proposed.procs.release, 'not there before sync');
  b.sync(); a.sync();
  d = await repo.loadAll(a);
  same(d.proposed.procs.release.all.map(x => x.id), [p.id]);
  const full = await repo.readProposal(a, 'release', p.id);
  assert.strictEqual(full.proposal.text, p.text);
});

rule('Late presence: computer B writes the draft directly while A has unsaved work; A\'s save is refused and A\'s text is still A\'s', async () => {
  const { a, b } = await draftOnBoth(), A = example('maps/drafts/release.md');
  // A's window holds an editor, but its presence hasn't reached B.
  await repo.writePresence(a, PP.presence({ writer: 'wa', by: 'person-casey', device: 'D', since: NOW, at: NOW, beat: 1, drafts: ['release'], main: [] }));
  const seen = await repo.loadPresence(b);
  assert.ok(!seen.some(x => x.rec && x.rec.drafts.indexOf('release') >= 0), 'B sees nobody editing');
  const direct = A.replace('title: Production release', 'title: Direct');
  assert.ok((await repo.saveDraft(b, 'release.md', direct, PF.util.hash(A), { expectText: A })).ok);
  b.sync(); a.sync();
  const mine = A.replace('title: Production release', 'title: Mine');
  const res = await repo.saveDraft(a, 'release.md', mine, PF.util.hash(A), { expectText: A });
  assert.ok(res.conflict && res.theirs === direct, 'refused, with theirs to compare');
  assert.strictEqual(a.files[DRAFT], direct);
  assert.ok(mine.indexOf('title: Mine') >= 0, 'A\'s text is the caller\'s to keep (the editor keeps it, with Keep mine / Take theirs)');
});

rule('Decisions from both computers with the same decisionRev show as Decided twice, and the proposal is never applied automatically', async () => {
  const { a, b } = await draftOnBoth(), A = example('maps/drafts/release.md');
  const p = proposalFrom(A, A.replace('title: Production release', 'title: P'));
  await a.write('proposed/release/' + p.id + '.json', JSON.stringify(p)); a.sync(); b.sync();
  const dec = (w, status) => PP.decision({ proposal: p.id, proposalRev: p.rev, writer: w, decisionRev: 1, seen: null, status, by: 'person-casey', at: NOW });
  const da = dec('wa', 'declined'), db = dec('wb', 'reopened');
  await repo.writeRecord(a, 'release', da.name, da.rec); await repo.writeRecord(b, 'release', db.name, db.rec);
  a.sync(); b.sync(); a.sync();
  const st = PP.recState(await repo.listRecords(b, 'release', p.id));
  assert.strictEqual(st.state, 'decided-twice');
  assert.strictEqual(st.auto, false);
});

/* REQUEST (1.20): a request is a plan in proposals/, so its copies and its starts travel like any plan's. */
function requested(d, at, edit) {
  const RQ = PF.requests, pub = d.processes[0].index.latest, x = RQ.clean({ process: 'release', title: 'Backup check · November', details: { ticket: 'ABC-9' }, producer: { name: 'ci-check', version: '1.4.0' } }, 'nov');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(x.errors)), []);
  const plan = RQ.build(x.intent, pub, at);
  if (edit) edit(plan);
  return { id: plan.id, text: RQ.text(plan) };
}

rule('REQUEST: two disconnected computers request one key: both files arrive; the same request shows once, arrived twice', async () => {
  const { a, b } = await twoComputers(), d = await repo.loadAll(a);
  const ra = requested(d, '2026-10-17T21:00:00.000Z'), rb = requested(d, '2026-10-17T21:05:00.000Z');
  await a.write('proposals/' + ra.id + '.json', ra.text); await b.write('proposals/' + rb.id + '.json', rb.text);
  a.sync(); b.sync(); a.sync();
  assert.deepStrictEqual(Object.keys(a.files).filter(p => p.indexOf('proposals/req-') === 0).sort(), ['proposals/' + ra.id + '-BLAKE.json', 'proposals/' + ra.id + '.json'], 'OneDrive kept both');
  for (const c of [a, b]) {
    const all = await repo.loadAll(c), plans = all.plans.filter(p => p.id === ra.id);
    assert.strictEqual(plans.length, 1, 'shown once');
    assert.strictEqual(plans[0]._copies, 2); assert.strictEqual(plans[0]._copiesDiffer, false);
    assert.strictEqual(plans[0]._file, ra.id + '.json', 'the file under its own name');
    const out = PF.appjson.runs([], plans, PF.appjson.names(people), all.processes).planned;
    same(out.map(x => [x.id, x.copies, x.copiesDiffer, x.status]), [[ra.id, 2, false, 'pending']]);
  }
});

rule('REQUEST: two disconnected copies that say different things are both shown, flagged, and neither counts as decided', async () => {
  const { a, b } = await twoComputers(), d = await repo.loadAll(a);
  const ra = requested(d, NOW), rb = requested(d, NOW, p => { p.title = 'Something else'; });
  await a.write('proposals/' + ra.id + '.json', ra.text); await b.write('proposals/' + rb.id + '.json', rb.text);
  a.sync(); b.sync(); a.sync();
  const plans = (await repo.loadAll(b)).plans.filter(p => p.id === ra.id);
  same(plans.map(p => [p._file, p._copies, p._copiesDiffer]), [[ra.id + '.json', 2, true], [ra.id + '-BLAKE.json', 2, true]]);
});

rule('REQUEST: one plan started on two computers while OneDrive was paused shows as conflicting, never as one started run', async () => {
  const { a, b } = await twoComputers(), d = await repo.loadAll(a), ra = requested(d, NOW);
  await a.write('proposals/' + ra.id + '.json', ra.text); a.sync(); b.sync();
  const pa = (await repo.loadAll(a)).plans.filter(p => p.id === ra.id)[0], pb = (await repo.loadAll(b)).plans.filter(p => p.id === ra.id)[0];
  await repo.recordPlanStatus(a, pa, 'wa', 'accepted', 'runa', 'person-casey');
  await repo.recordPlanStatus(b, pb, 'wb', 'accepted', 'runb', 'person-blake');
  a.sync(); b.sync(); a.sync();
  for (const c of [a, b]) {
    const p = (await repo.loadAll(c)).plans.filter(x => x.id === ra.id)[0];
    assert.strictEqual(p._conflicting, true, 'two accepted decisions naming different runs disagree');
    assert.strictEqual(p._status, null);
    assert.strictEqual(PF.appjson.runs([], [p], PF.appjson.names(people), []).planned[0].status, 'conflicting');
  }
  // A start recorded against either copy of the same request counts for it.
  const { a: a2, b: b2 } = await twoComputers(), d2 = await repo.loadAll(a2), r1 = requested(d2, NOW), r2 = requested(d2, '2026-10-17T21:09:00.000Z');
  await a2.write('proposals/' + r1.id + '.json', r1.text); await b2.write('proposals/' + r2.id + '.json', r2.text);
  const pb2 = (await repo.loadAll(b2)).plans.filter(x => x.id === r2.id)[0];
  await repo.recordPlanStatus(b2, pb2, 'wb', 'accepted', 'runb', 'person-blake');
  a2.sync(); b2.sync(); a2.sync();
  const p2 = (await repo.loadAll(a2)).plans.filter(x => x.id === r1.id);
  assert.strictEqual(p2.length, 1);
  assert.ok(p2[0]._status && p2[0]._status.run === 'runb', 'started once, from the copy B had');
});

rule('REQUEST review: copies whose details differ only in a name starting with _ are different copies, never one startable plan', async () => {
  const { a, b } = await twoComputers(), d = await repo.loadAll(a);
  const ra = requested(d, NOW, p => { p.details = { _site: 'east' }; }), rb = requested(d, NOW, p => { p.details = { _site: 'west' }; });
  await a.write('proposals/' + ra.id + '.json', ra.text); await b.write('proposals/' + rb.id + '.json', rb.text);
  a.sync(); b.sync(); a.sync();
  const plans = (await repo.loadAll(a)).plans.filter(p => p.id === ra.id);
  same(plans.map(p => [p._copies, p._copiesDiffer]), [[2, true], [2, true]]);
  assert.strictEqual(PF.requests.same({ id: 'x', roles: { _qa: 'p1' }, _file: 'a' }, { id: 'x', roles: { _qa: 'p2' }, _file: 'b' }), false);
});

rule('REQUEST review: two different copies of one request, each started on its own computer, show as a double start', async () => {
  const { a, b } = await twoComputers(), d = await repo.loadAll(a);
  const ra = requested(d, NOW), rb = requested(d, NOW, p => { p.title = 'Something else'; });
  await a.write('proposals/' + ra.id + '.json', ra.text); await b.write('proposals/' + rb.id + '.json', rb.text);
  const pa = (await repo.loadAll(a)).plans.filter(p => p.id === ra.id)[0], pb = (await repo.loadAll(b)).plans.filter(p => p.id === rb.id)[0];
  await repo.recordPlanStatus(a, pa, 'wa', 'accepted', 'runa', 'person-casey');
  await repo.recordPlanStatus(b, pb, 'wb', 'accepted', 'runb', 'person-blake');
  a.sync(); b.sync(); a.sync();
  for (const c of [a, b]) {
    const plans = (await repo.loadAll(c)).plans.filter(x => x.id === ra.id);
    assert.strictEqual(plans.length, 2);
    assert.ok(plans.every(p => p._conflicting && !p._status), 'both shown, as conflicting');
  }
});

run();
