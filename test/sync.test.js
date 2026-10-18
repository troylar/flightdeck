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

rule('Follow-ups and suggested map changes are kept on the run and printed on the receipt', async () => {
  const { a } = await twoComputers();
  const r = await get(a), map = R.mapOf(r);
  done(r, map, 'approved', 'person-casey', NOW);
  R.differently(r, map, 'approved', 'Approved in the change board instead', 'person-casey', NOW);
  R.addFollowUp(r, { text: 'Automate the flag check', owner: 'person-blake', ticket: 'ABC-9' }, 'person-casey', NOW);
  assert.throws(() => R.addFollowUp(r, { text: '  ' }, 'person-casey', NOW), /Say what/);
  r._notes = [{ id: 'n1', step: 'flags', text: 'Flags live in values-prod.yaml now', by: 'person-blake', kind: 'map' }];
  await repo.saveRun(a, r, 'casey');
  const back = await get(a); back._notes = r._notes;
  same(back.followUps.map(f => f.text), ['Automate the flag check']);
  assert.strictEqual(R.suggestions(back, map).length, 2);
  const text = R.receipt(back, map, id => id, NOW, []);
  assert.ok(/Follow-ups\n  - Automate the flag check \(person-blake\) \[ABC-9\]/.test(text));
  assert.ok(/Suggested checklist changes/.test(text));
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

run();
