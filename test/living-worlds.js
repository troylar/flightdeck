// The worlds the living-run evidence tests share (4.0, slice 6): runs made through the app, a loop parent with a story run,
// and the three roles a run the work depends on can have, each with its folder as files.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const { boot } = require('./app-harness');
const { BytesFS } = require('./evidence-fixture');

const MD = ['---', 'process: release-notes', 'title: Release notes', 'owner: person-avery', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} Read them {#read}', ''].join('\n');
/* A folder made through the app: a run, with to-dos landed when todos > 0, ended (with its receipt when living). */
async function made(o) {
  o = o || {};
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const b = PF.publish.build(MD, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand: 'rn000001', app: '4.0.0' });
  Object.keys(b.files).forEach(k => { app.fs.files['publications/release-notes/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-notes'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  for (let i = 0; i < (o.todos || 0); i++) { app.set('td-add', 'To-do ' + (i + 1)); app.click('td-add'); await app.tick(120); app.click('refresh'); await app.tick(400); }
  /* o.requested: one request filed apart, accepted by a person's decision, then landed by the recorder's window as an application. */
  if (o.requested) {
    const T = PF.todos, rp = app.files('runs/release-notes/').find(p => /run\.json$/.test(p)), r0 = PF.run.sanitize(JSON.parse(app.fs.files[rp].t)), RUN = { process: r0.process, id: r0.id }, at = new Date().toISOString();
    const d = await PF.repo.loadAll(app.fs, {}), V = T.view(r0, { records: d.todos || [], people });
    const body = { op: 'add', text: 'Requested one', target: { phase: 'draft' }, placement: T.placementFor(PF.run.mapOf(r0), { phase: 'draft' }) };
    const q = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'k-req001'), by: 'person-avery', seen: V.heads.slice(0, 50), at, body, app: '4.0.0' });
    await app.fs.write('proposals/' + q.id + '.json', T.text(q));
    const rec = T.cleanFile(JSON.parse(T.text(q)), q.id + '.json').record, V2 = T.view(r0, { records: (d.todos || []).concat([rec]), people });
    const C = T.consequenceOf(r0, V2.map, V2.requests[q.id], V2).fingerprint;
    const st = T.buildStatus({ kind: 'decision', proposal: q.id, run: RUN, seen: [q.id], by: 'person-avery', at, op: 'accept', consequence: C, writer: 'w1', rev: '0000a001', app: '4.0.0' });
    await app.fs.write('proposals/' + st.name, T.text(st.file));
    app.click('refresh'); await app.tick(500); app.click('refresh'); await app.tick(400);
    o.request = { proposal: 'proposals/' + q.id + '.json', decision: 'proposals/' + st.name };
  }
  /* o.pending: a tool's request filed before the end, waiting for approval (the receipt names it as seen). */
  if (o.pending) {
    const T = PF.todos, rp = app.files('runs/release-notes/').find(p => /run\.json$/.test(p)), r0 = PF.run.sanitize(JSON.parse(app.fs.files[rp].t));
    const q = T.buildProposal({ run: { process: r0.process, id: r0.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-pend1', seen: [], at: new Date().toISOString(), body: { op: 'add', text: 'Waiting for approval', target: { phase: 'review' }, placement: T.placementFor(PF.run.mapOf(r0), { phase: 'review' }) } });
    await app.fs.write('proposals/' + q.id + '.json', T.text(q));
    app.click('refresh'); await app.tick(400);
    o.pendingId = q.id;
  }
  /* o.keep: a person keeps the first to-do for next time before the end (the receipt names it in keeps). */
  if (o.keep) {
    const T = PF.todos, rp = app.files('runs/release-notes/').find(p => /run\.json$/.test(p)), r0 = PF.run.sanitize(JSON.parse(app.fs.files[rp].t));
    const d = await PF.repo.loadAll(app.fs, {}), td = Object.keys(T.view(r0, { records: d.todos || [], people }).byTodo)[0];
    /* o.keep 'placed': kept at the end of the draft phase of the run's own checklist, so where it stands is worked out. */
    const pl = o.keep === 'placed' ? PF.learn.prepare(r0, { source: { todo: td }, text: 'Check the release notes twice', place: { phase: 'draft' }, by: { person: 'person-avery' }, records: d.todos || [], people, at: new Date().toISOString(), app: '4.0.0' }) : null;
    if (pl) assert.ok(pl.file && pl.file.anchor, 'set-up: the keep is placed ' + JSON.stringify(pl.why || pl.status));
    const k = pl ? pl.file : PF.learn.build({ run: { process: r0.process, id: r0.id }, by: 'person-avery', at: new Date().toISOString(), app: '4.0.0', source: { todo: td }, change: { text: 'Check the release notes twice', where: 'end' }, needs: 'It isn\'t placed yet.' });
    await app.fs.write('proposals/' + k.id + '.json', JSON.stringify(k, null, 2) + '\n');
    /* o.keep2: the same to-do kept again, at the end of the review phase: another keep, another place. */
    if (o.keep2) {
      const p2 = PF.learn.prepare(r0, { source: { todo: td }, text: 'Ask for a second review', place: { phase: 'review' }, by: { person: 'person-avery' }, records: (d.todos || []).concat([k]), people, at: new Date().toISOString(), app: '4.0.0' });
      assert.ok(p2.file && p2.file.anchor, 'set-up: the second keep is placed ' + JSON.stringify(p2.why || p2.status));
      await app.fs.write('proposals/' + p2.file.id + '.json', JSON.stringify(p2.file, null, 2) + '\n');
      o.keep2Id = p2.file.id;
    }
    app.click('refresh'); await app.tick(400);
    o.keepId = k.id;
  }
  if (o.end !== false) { app.click('end', 'Cancelled'); await app.tick(300); }
  const runPath = app.files('runs/release-notes/').find(p => /run\.json$/.test(p)), r = JSON.parse(app.fs.files[runPath].t);
  const files = {}; Object.keys(app.fs.files).forEach(p => { files[p] = app.fs.files[p].t; });
  return { PF, files, key: r.process + '/' + r.id, run: r, runPath, request: o.request || null, pendingId: o.pendingId || '', keepId: o.keepId || '', keep2Id: o.keep2Id || '' };
}
async function pack(PF, fsx, key, more) {
  const parts = [];
  const res = await PF.repo.exportEvidence(fsx, { run: key }, Object.assign({ sink: u => { parts.push(Buffer.from(u)); }, now: () => Date.now(), tz: 'UTC' }, more || {}));
  return { zip: Buffer.concat(parts), res };
}
/* A pack of every run of a process created today (the process + date range scope). */
async function datePack(PF, fsx, proc) {
  const parts = [], day = new Date().toISOString().slice(0, 10);
  const res = await PF.repo.exportEvidence(fsx, { process: proc, from: day, through: day }, { sink: u => { parts.push(Buffer.from(u)); }, now: () => Date.now(), tz: 'UTC' });
  return { zip: Buffer.concat(parts), res };
}
const KID = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-avery', '---', '',
  '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
/* A loop parent with a to-do, and one story run with a to-do of its own (living, its own application chain). */
/* o.shot: the story's version holds a screenshot (SHOT), so verifying it reads that file's bytes. */
const SHOT = Buffer.from('\x89PNG\r\n\x1a\n' + 'synthetic screenshot bytes '.repeat(8), 'latin1');
async function loopMade(o) {
  o = o || {};
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand, shot) => {
    const img = shot ? { images: { 'images/shot.png': PF.util.hash(SHOT.toString('latin1')) }, imageBytes: { 'images/shot.png': new Uint8Array(SHOT) } } : {};
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '4.0.0', ...img });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
    if (shot) app.fs.files['publications/' + id + '/' + b.folder + '/images/shot.png'] = { t: 'data:image/png;base64,' + SHOT.toString('base64'), m: Date.now() };
  };
  put(KID, 'validate-story', 'vs000001', o.shot); put(PARENT, 'release-readiness', 'rr000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150);
  app.click('loop-start', 'each', { item: 'ABC-101' }); await app.tick(150);
  /* o.kids: a second story run of the same version, started before the first gets its to-do. */
  if (o.kids > 1) { app.click('open-run', app.files('runs/release-readiness/').map(p => JSON.parse(app.fs.files[p].t)).map(r => r.process + '/' + r.id)[0]); await app.tick(80); app.set('loop-add-each', 'ABC-102'); app.click('loop-add', 'each'); await app.tick(150); app.click('loop-start', 'each', { item: 'ABC-102' }); await app.tick(150); }
  const pPath = app.files('runs/release-readiness/').find(p => /run\.json$/.test(p)), kPath = app.files('runs/validate-story/').filter(p => /run\.json$/.test(p)).find(p => JSON.parse(app.fs.files[p].t).parent.item === 'ABC-101' || /ABC-101/.test(app.fs.files[p].t));
  assert.ok(pPath && kPath, 'set-up: a parent and a story run');
  const P0 = JSON.parse(app.fs.files[pPath].t), K0 = JSON.parse(app.fs.files[kPath].t);
  for (const [r, text] of [[K0, 'Check the story'], [P0, 'Post the release notes']]) {
    app.click('open-run', r.process + '/' + r.id); await app.tick(80);
    app.set('td-add', text); app.click('td-add'); await app.tick(120); app.click('refresh'); await app.tick(400);
  }
  const P = JSON.parse(app.fs.files[pPath].t), K = JSON.parse(app.fs.files[kPath].t);
  assert.ok(P.living && K.living && K.living.head, 'set-up: both are living');
  const files = {}; Object.keys(app.fs.files).forEach(p => { const t = app.fs.files[p].t, m = /^data:[^;,]*;base64,(.*)$/.exec(t); files[p] = m ? Buffer.from(m[1], 'base64') : t; });
  return { PF, files, key: P.process + '/' + P.id, run: P, kid: K, kidPath: kPath, kidKey: K.process + '/' + K.id };
}
/* A loop parent whose to-do on ABC-101 a tool checked off on a fact's evidence (a done it was granted, landed), the run then
   ended with its receipt, which names that evidence (4.0, VB). */
async function factMade() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, T = PF.todos, F = PF.facts, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  for (const [md, id, rand] of [[KID, 'validate-story', 'vs000001'], [PARENT, 'release-readiness', 'rr000001']]) {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '4.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  }
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  app.set('loop-add-each', 'ABC-101'); app.click('loop-add', 'each'); await app.tick(150); app.set('loop-add-each', ''); await app.tick();
  const refresh = async () => { app.click('refresh'); await app.tick(300); };
  await refresh();
  const pPath = app.files('runs/release-readiness/').find(p => /run\.json$/.test(p));
  const W = async () => {
    const d = await PF.repo.loadAll(app.fs, {}), parent = d.runs.find(x => x.process === 'release-readiness');
    return { d, parent, items: PF.loop.view(parent, 'each', { records: d.scopes, runs: d.runs, procOf: () => null }).rollup.items };
  };
  const base = { by: { person: 'person-avery' }, people, at: new Date().toISOString(), app: '4.0.0' };
  let w = await W();
  const uid = w.items.find(i => i.key === 'ABC-101').uid, item = { loopStep: 'each', uid, attempt: 1 };
  const add = T.prepare(w.parent, Object.assign({ body: { op: 'add', text: 'Merge the fix', target: { item } }, key: 'k-vb0001', records: w.d.todos, unread: w.d.todosUnread, now: Date.now() }, base));
  assert.ok(!add.why, add.why);
  await app.fs.write('proposals/' + add.name, T.text(add.file)); await refresh(); await refresh();
  w = await W();
  const ob = F.prepare(w.parent, { obs: { key: 'prs-vb', loopStep: 'each', item: 'ABC-101', source: { feed: 'bitbucket', site: 'git.example.com' }, domain: 'prs', observedAt: new Date(Date.now() - 30000).toISOString(), complete: true, reported: 1, entries: [{ id: '17', text: 'Fix the login', state: 'merged' }] },
    by: { tool: 'git-bot', version: '1.0' }, records: w.d.todos, unread: w.d.todosUnread, items: w.items, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
  assert.ok(!ob.why, ob.why);
  await app.fs.write('proposals/' + ob.name, T.text(ob.file));
  w = await W();
  const g = T.grantOf(w.parent, { subject: { tool: 'git-bot' }, ops: ['done'], targets: [{ item }], by: 'person-avery', key: 'g-vb0001', records: w.d.todos, unread: w.d.todosUnread, people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
  assert.ok(!g.why, g.why);
  await app.fs.write('proposals/' + g.name, T.text(g.file));
  w = await W();
  const x = T.view(w.parent, { records: w.d.todos, people, now: Date.now() }).byTodo[add.preview.todo];
  const S = F.supportFor(w.parent, x, ob.id, { records: w.d.todos, unread: w.d.todosUnread, now: Date.now() });
  assert.ok(!S.why, S.why);
  const q = T.prepare(w.parent, { body: { op: 'done', todo: x.id, support: S.support }, by: { tool: 'git-bot', version: '1.0' }, records: w.d.todos, unread: w.d.todosUnread, people, at: new Date().toISOString(), app: '4.0.0', now: Date.now() });
  assert.ok(!q.why, q.why);
  await app.fs.write('proposals/' + q.name, T.text(q.file)); await refresh(); await refresh();
  app.click('end', 'Cancelled'); await app.tick(300);
  const r = JSON.parse(app.fs.files[pPath].t);
  assert.ok(r.ended && r.living && r.living.receipt, 'set-up: the run ended with a receipt');
  const rc = JSON.parse(app.fs.files['proposals/' + r.living.receipt + '.json'].t);
  assert.ok((rc.evidence || []).some(e => e.fact === ob.id), 'set-up: the receipt names the fact: ' + JSON.stringify(rc.evidence));
  const files = {}; Object.keys(app.fs.files).forEach(p => { files[p] = app.fs.files[p].t; });
  return { PF, files, key: r.process + '/' + r.id, run: r, runPath: pPath, factId: ob.id, factPath: 'proposals/' + ob.id + '.json', todo: x.id };
}
/* A loop parent with stories ABC-101 and ABC-102, whose recorder added a spread on the loop in one gesture (a compound,
   landed): the run's work holds a spread creation (4.0, YB). */
async function spreadMade() {
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, T = PF.todos, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  for (const [md, id, rand] of [[KID, 'validate-story', 'vs000001'], [PARENT, 'release-readiness', 'rr000001']]) {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '4.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  }
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  app.set('loop-add-each', 'ABC-101, ABC-102'); app.click('loop-add', 'each'); await app.tick(150); app.set('loop-add-each', ''); await app.tick();
  app.click('refresh'); await app.tick(300);
  const pPath = app.files('runs/release-readiness/').find(p => /run\.json$/.test(p));
  const d = await PF.repo.loadAll(app.fs, {}), r = d.runs.find(x => x.process === 'release-readiness');
  const procOf = (id) => { const x = d.processes.filter(p => p.process === id)[0]; return x ? { latest: x.index.latest, all: x.index.all, clashes: x.index.clashes, broken: [] } : null; };
  const st = PF.map.findStep(PF.run.mapOf(r), 'each'), LV = PF.loop.view(r, 'each', { records: d.scopes, runs: d.runs, procOf }), childMap = PF.pins.childTarget(r, st.step, procOf).pub.map;
  const P = T.prepare(r, { body: { op: 'spread-add', loopStep: 'each', text: 'Security sign-off', child: { beforeGate: 'assess-confirm' }, scope: PF.spreads.snapshot(LV) }, by: { person: 'person-avery' }, key: 'sp-yb0001', records: d.todos, unread: d.todosUnread, people, at: new Date().toISOString(), app: '4.0.0', childMap });
  assert.ok(!P.why, P.why);
  await app.fs.write('proposals/' + P.name, T.text(P.file));
  for (let i = 0; i < 3; i++) { app.click('refresh'); await app.tick(300); }
  const run = JSON.parse(app.fs.files[pPath].t);
  assert.ok(run.living && run.living.head === P.file.id, 'set-up: the spread landed: ' + JSON.stringify(run.living) + ' ' + P.file.kind);
  const files = {}; Object.keys(app.fs.files).forEach(p => { files[p] = app.fs.files[p].t; });
  return { PF, files, key: run.process + '/' + run.id, run, runPath: pPath, spreadPath: 'proposals/' + P.name, spreadId: P.file.id };
}
/* A release-notes run with a to-do linked to a smoke-test checklist: run, completed with pass, accepted in the app (a done on
   that run's evidence, landed), the run then ended with its receipt, which names that evidence (4.0, WA). */
const EVP = ['---', 'process: release-notes', 'title: Release notes', 'owner: person-avery', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', ''].join('\n');
const SMOKE = ['---', 'process: smoke-test', 'title: Smoke test', 'owner: person-avery', 'context: verdict:choice(pass|fail)', 'result: verdict', '---', '',
  '## Test · DO-CONFIRM {#test}', '- [!] {confirm} Run the smoke suite {#suite}', '- [!] {decide} Record the result {#call}', '  options: pass, fail', '  sets: verdict=decision', ''].join('\n');
async function evidenceMade(o) {
  o = o || {};
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, T = PF.todos, people = JSON.parse(app.fs.files['people.json'].t), at = () => new Date().toISOString();
  const refresh = async (ms) => { app.click('refresh'); await app.tick(ms || 250); };
  const pubs = {};
  for (const [md, rand] of [[EVP, 'rn000001'], [SMOKE, 'sm000001']]) {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now: at(), rand, app: '4.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    const proc = PF.map.parse(md).meta.process;
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + proc + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
    const exact = PF.publish.exactOf({ 'map.md': new Uint8Array(Buffer.from(b.files['map.md'], 'utf8')), 'types.json': new Uint8Array(Buffer.from(b.files['types.json'], 'utf8')) });
    pubs[proc] = PF.publish.verify(b.folder, b.files, exact); pubs[proc].folder = b.folder;
  }
  await refresh(80);
  app.click('start', 'release-notes'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  const pPath = app.files('runs/release-notes/').find(p => /run\.json$/.test(p)), parent = () => JSON.parse(app.fs.files[pPath].t);
  const toParent = async () => { const r = parent(); app.click('open-run', r.process + '/' + r.id); await app.tick(120); };
  const kp = pubs['smoke-test'], Q = PF.detours.pinFor({ latest: kp, all: [kp], clashes: [], broken: [] }, 'smoke-test', kp.folder, ['pass']);
  assert.ok(!Q.why, Q.why);
  let d = await PF.repo.loadAll(app.fs, {});
  const P = T.prepare(PF.run.sanitize(parent()), { body: { op: 'add', text: 'Smoke test the build', target: { phase: 'draft' }, checklist: Q.checklist }, by: { person: 'person-avery' }, key: 'ui-wa', records: d.todos, unread: d.todosUnread, people, at: at(), app: '4.0.0' });
  assert.ok(!P.why, P.why);
  app.fs.files['proposals/' + P.name] = { t: T.text(P.file), m: Date.now() };
  await refresh(400); await toParent(); await refresh(300);
  d = await PF.repo.loadAll(app.fs, {});
  const x = T.view(PF.run.sanitize(parent()), { records: d.todos, people }).todos.filter(t => t.text === 'Smoke test the build')[0];
  assert.ok(x && x.checklist, 'set-up: the linked to-do landed');
  const kids = () => app.files('runs/smoke-test/').filter(p => /run\.json$/.test(p)).sort();
  app.click('td-detour', x.id); await app.tick(250);
  app.chooseApprovers().submitForm('start-form'); await app.tick(200);
  const kPath = kids()[0];
  assert.ok(kPath, 'set-up: a run of smoke-test was started');
  const c = JSON.parse(app.fs.files[kPath].t), m = PF.run.mapOf(c), t = at();
  PF.run.done(c, m, 'suite', 'person-avery', t); PF.run.done(c, m, 'call', 'person-avery', t, { decision: 'pass' }); PF.run.pass(c, m, 0, 'person-avery', t); PF.run.end(c, m, 'Completed', 'person-avery', 'Avery', t);
  app.fs.files[kPath] = { t: JSON.stringify(c, null, 2), m: Date.now() };
  await toParent(); await refresh(300);
  app.click('td-evidence', x.id, { run: c.id }); await app.tick(250);
  await refresh(400); await refresh(300);
  /* o.reopen: the to-do reopened by the recorder after its done landed (XA): the receipt then names no evidence. */
  let reopenId = '';
  if (o.reopen) {
    d = await PF.repo.loadAll(app.fs, {});
    const R2 = T.prepare(PF.run.sanitize(parent()), { body: { op: 'reopen', todo: x.id, reason: 'Run it again' }, by: { person: 'person-avery' }, key: 'ui-wa-reopen', records: d.todos, unread: d.todosUnread, people, at: at(), app: '4.0.0' });
    assert.ok(!R2.why, R2.why);
    app.fs.files['proposals/' + R2.name] = { t: T.text(R2.file), m: Date.now() };
    await refresh(400); await refresh(300);
    assert.strictEqual(parent().living.head, R2.file.id, 'set-up: the reopen landed');
    reopenId = R2.file.id;
  }
  app.click('end', 'Cancelled'); await app.tick(300);
  const r = parent();
  assert.ok(r.ended && r.living && r.living.receipt, 'set-up: the run ended with a receipt');
  const rc = JSON.parse(app.fs.files['proposals/' + r.living.receipt + '.json'].t);
  assert.ok(o.reopen ? !(rc.evidence || []).length : (rc.evidence || []).some(e => e.run && e.run.id === c.id), 'set-up: the receipt\'s evidence: ' + JSON.stringify(rc.evidence));
  const files = {}; Object.keys(app.fs.files).forEach(p => { files[p] = app.fs.files[p].t; });
  return { PF, files, key: r.process + '/' + r.id, run: r, runPath: pPath, evPath: kPath, evKey: c.process + '/' + c.id, todo: x.id, reopenId };
}
/* The run's receipt made again as Flightdeck writes one, its evidence edited (edit gets the list and returns the new one): a
   valid receipt under the id its content gives, run.json naming it. Returns the files. */
function rereceipt(W, edit) {
  const files = Object.assign({}, W.files), r = JSON.parse(files[W.runPath]), old = 'proposals/' + r.living.receipt + '.json', rc = JSON.parse(files[old]);
  const f = W.PF.receipts.build({ run: rc.run, by: rc.by, at: rc.at, app: rc.app, head: rc.head, outcome: rc.outcome, seen: rc.seen, counts: rc.counts, coverage: rc.coverage, evidence: edit(JSON.parse(JSON.stringify(rc.evidence))), keeps: rc.keeps });
  delete files[old]; files['proposals/' + f.id + '.json'] = JSON.stringify(f, null, 2) + '\n';
  r.living.receipt = f.id; files[W.runPath] = JSON.stringify(r, null, 2);
  return files;
}
async function roleWorlds() {
  const out = [];
  const L = await loopMade();
  out.push({ role: 'child', PF: L.PF, files: L.files, key: L.key, path: L.kidPath, depKey: L.kidKey, force: false });
  const F = await made({ todos: 1 }), T = F.PF.todos, base = JSON.parse(F.files[F.runPath]);
  const clone = (files, id) => { const o = Object.assign({}, base, { id }); delete o.living; delete o.ended; o.state = 'running'; if (Array.isArray(o.features)) o.features = o.features.filter(f => f !== 'living-runs'); files['runs/' + base.process + '/' + id + '/run.json'] = JSON.stringify(o, null, 2); };
  {
    const files = Object.assign({}, F.files), r = F.PF.run.sanitize(JSON.parse(files[F.runPath]));
    clone(files, 'dep-1');
    const body = { op: 'add', text: 'Covered', target: { phase: 'draft' }, placement: T.placementFor(F.PF.run.mapOf(r), { phase: 'draft' }), fulfills: { run: { process: base.process, id: 'dep-1' }, spread: 'sp-' + 'c'.repeat(24), uid: 'jira.issue:key:ABC-1', attempt: 1 } };
    const q = T.buildProposal({ run: { process: base.process, id: base.id }, producer: { name: 'notes-bot', version: '1.0' }, key: 'k-ka1', seen: [], at: new Date().toISOString(), body });
    files['proposals/' + q.id + '.json'] = T.text(q);
    out.push({ role: 'fulfills', PF: F.PF, files, key: F.key, path: 'runs/' + base.process + '/dep-1/run.json', depKey: base.process + '/dep-1', force: false });
  }
  {
    const PF = F.PF, r = PF.run.sanitize(JSON.parse(JSON.stringify(F.run)));
    const d = await PF.repo.loadAll(new BytesFS(F.files), {}), V = T.view(r, { records: d.todos || [], people: JSON.parse(F.files['people.json']) });
    const td = Object.keys(V.byTodo || {})[0] || (V.todos && V.todos[0] && V.todos[0].id);
    const ev = { plan: 'plan-ev-' + 'a'.repeat(24), run: { process: base.process, id: 'evrun1' }, answer: 'Yes', result: '' };
    const q = T.buildProposal({ run: { process: r.process, id: r.id }, id: PF.detours.requestId(td, ev), by: 'person-avery', seen: V.heads.slice(0, 50), at: new Date().toISOString(), body: { op: 'done', todo: td, evidence: ev }, app: '4.0.0' });
    const files = Object.assign({}, F.files, { ['proposals/' + q.id + '.json']: T.text(q) });
    clone(files, 'evrun1');
    /* The evidence plan the request names, written as the app writes it: the pack reader requires it by that reference. */
    const one = await PF.repo.readRunOnly(new BytesFS(F.files), base.process, base.id);
    files['proposals/' + ev.plan + '.json'] = JSON.stringify(PF.plans.make(one.pub, { id: ev.plan, process: base.process, title: 'Evidence plan', from: F.key, by: 'person-avery', created: new Date().toISOString() }, true, '4.0.0'), null, 2) + '\n';
    out.push({ role: 'evidence', PF, files, key: F.key, path: 'runs/' + base.process + '/evrun1/run.json', depKey: base.process + '/evrun1', force: true });
  }
  /* HB: a reverse fulfillment. The run's own record names a spread (a stop), and a request on another run fulfills that
     spread: that other run is part of the work, found from the spread, never from a record naming the run. */
  {
    const files = Object.assign({}, F.files), r = F.PF.run.sanitize(JSON.parse(files[F.runPath])), at = new Date().toISOString();
    const S = 'sp-' + 'd'.repeat(24), pair = { uid: 'jira.issue:key:ABC-7', attempt: 1 };
    clone(files, 'rev-1');
    const stop = T.buildProposal({ run: { process: base.process, id: base.id }, id: T.idFor('flightdeck', 'rev-stop'), by: 'person-avery', seen: [], at, body: { op: 'spread-stop', spread: S, reason: 'Covered elsewhere', owed: [pair] } });
    const ful = T.buildProposal({ run: { process: base.process, id: 'rev-1' }, producer: { name: 'notes-bot', version: '1.0' }, key: F.PF.spreads.obligationId(S, pair.uid, 1), seen: [], at,
      body: { op: 'add', text: 'Covered', target: { phase: 'draft' }, placement: T.placementFor(F.PF.run.mapOf(r), { phase: 'draft' }), fulfills: { run: { process: base.process, id: base.id }, spread: S, uid: pair.uid, attempt: 1 } } });
    files['proposals/' + stop.id + '.json'] = T.text(stop);
    files['proposals/' + ful.id + '.json'] = T.text(ful);
    out.push({ role: 'reverse', PF: F.PF, files, key: F.key, path: 'runs/' + base.process + '/rev-1/run.json', depKey: base.process + '/rev-1', force: false });
  }
  return out;
}

/* ---- Packs: read, rewritten with their hashes made to match, and checked by the independent reader (test/check_pack.py) ---- */
function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* next */ } } return null; }
const PY = python();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), n = buf.readUInt16LE(eocd + 10), out = {};
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8'), lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
    out[name] = buf.slice(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    p += 46 + nl + xl + cl;
  }
  return out;
}
/* The same entries zipped again (a manifest edited, SHA256SUMS made to match): only the living check can then refuse it. */
async function rezip(PF, entries) {
  const parts = [], w = PF.zip.writer({ sink: u => { parts.push(Buffer.from(u)); }, date: new Date() });
  const names = Object.keys(entries).filter(n => n !== 'SHA256SUMS').sort();
  const sums = names.map(n => sha(entries[n]) + '  ' + n).join('\n') + '\n';
  for (const n of names) await w.add(n, new Uint8Array(entries[n]));
  await w.add('SHA256SUMS', new Uint8Array(Buffer.from(sums)));
  await w.finish();
  return Buffer.concat(parts);
}
function checkPack(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-living-')), file = path.join(dir, 'pack.zip');
  fs.writeFileSync(file, zip);
  try { return { ok: true, out: cp.execFileSync(PY, ['-I', path.join(__dirname, 'check_pack.py'), file], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { ok: false, out: String(e.stdout) + String(e.stderr) }; }
}
const manifestOf = (zip) => JSON.parse(unzip(zip)['manifest.json'].toString('utf8'));
/* Packed entries rewritten, with the manifest's hashes made to match: only the readers' own checks can then refuse it. */
async function repacked(PF, zip, edit) {
  const e = unzip(zip), man = JSON.parse(e['manifest.json']);
  edit(e, man, (path) => man.files.filter(x => x.path === path)[0]);
  man.files.forEach((f) => { if (e[f.pack]) { f.sha256 = sha(e[f.pack]); f.size = e[f.pack].length; } });
  e['manifest.json'] = Buffer.from(JSON.stringify(man, null, 2) + '\n');
  return rezip(PF, e);
}
/* The manifest made to claim the run's work complete (an evidence run's plan isn't in these folders): only Python's own checks can then refuse it. */
const forced = (man) => { man.status = 'complete'; man.runs.forEach((r) => { if (r.living) { r.living.complete = true; r.living.missing = []; (r.living.deps || []).forEach((d) => { d.confirmed = true; }); } }); };

module.exports = { MD, made, pack, datePack, KID, PARENT, SHOT, loopMade, factMade, evidenceMade, spreadMade, rereceipt, roleWorlds, PY, sha, unzip, rezip, checkPack, manifestOf, repacked, forced };
