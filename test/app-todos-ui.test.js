// Living runs (4.0, docs/design.md 45), slice 2: the run screen's easy actions on to-dos. Add one line under the current
// phase, check one off, say why it won't be done, move or defer it, reopen it. Each writes exactly one request (the
// person's compound when they may decide); the acknowledgment says Queued for the recorder, or Waiting for approval, never
// Done: only the recorder's window applies it. Progress names each denominator on its own line.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate } = require('./app-harness');

const MD = ['---', 'process: release-notes', 'title: Release notes', 'owner: person-avery', 'roles: reviewer', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} @reviewer Read them {#read}', ''].join('\n');

async function setup(o) {
  o = Object.assign({}, o || {});
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, o)); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const b = PF.publish.build(o.md || MD, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand: 'rn000001', app: '4.0.0' });
  assert.ok(!b.blockers, JSON.stringify(b.blockers));
  Object.keys(b.files).forEach(k => { app.fs.files['publications/release-notes/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-notes'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  assert.ok(runPath(app), 'set-up: a run was started');
  return app;
}
const runPath = (app) => app.files('runs/release-notes/').find(p => /run\.json$/.test(p));
const theRun = (app) => JSON.parse(app.fs.files[runPath(app)].t);
const apps = (app, id) => app.files('proposals/').filter(p => p.indexOf(id + '.status-') >= 0).map(p => Object.assign(JSON.parse(app.fs.files[p].t), { id: p.slice('proposals/'.length, -'.json'.length) })).filter(x => x.kind === 'application');
let seq = 0;
const hex = (n) => (++seq).toString(16).padStart(n, '0');
/* A person's request, and the recorder's or a role holder's decision accepting exactly what it would do. */
async function request(app, body, o) {
  o = o || {};
  const T = app.PF.todos, r = theRun(app), RUN = { process: r.process, id: r.id }, at = new Date().toISOString();
  const d = await app.PF.repo.loadAll(app.fs, {}), V = T.view(app.PF.run.sanitize(r), { records: d.todos || [], people: JSON.parse(app.fs.files['people.json'].t) });
  if (body.op === 'add' && !body.placement) body.placement = T.placementFor(app.PF.run.mapOf(app.PF.run.sanitize(r)), body.target);
  const p = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'k-' + hex(6)), by: o.by || 'person-avery', seen: V.heads.slice(0, 50), at, body, app: '4.0.0' });
  await app.fs.write('proposals/' + p.id + '.json', T.text(p));
  if (o.decide !== false) {
    const rec = T.cleanFile(JSON.parse(T.text(p)), p.id + '.json').record, V2 = T.view(app.PF.run.sanitize(r), { records: (d.todos || []).concat([rec]), people: JSON.parse(app.fs.files['people.json'].t) });
    const C = T.consequenceOf(app.PF.run.sanitize(r), V2.map, V2.requests[p.id], V2).fingerprint;
    const s = T.buildStatus({ kind: 'decision', proposal: p.id, run: RUN, seen: [p.id], by: { person: o.decider || 'person-avery' }.person, at, op: 'accept', consequence: C, writer: 'w1', rev: hex(8), app: '4.0.0' });
    await app.fs.write('proposals/' + s.name, T.text(s.file));
  }
  return p;
}
const refresh = async (app, ms) => { app.click('refresh'); await app.tick(ms || 250); };
const setPeople = async (app, f) => { const ppl = JSON.parse(app.fs.files['people.json'].t), list = Array.isArray(ppl) ? ppl : ppl.people, next = list.map(f); await app.fs.write('people.json', JSON.stringify(Array.isArray(ppl) ? next : { people: next }, null, 2) + '\n'); };
const failing = (app, re) => { const fs = app.fs, write = fs.write.bind(fs); fs.write = (p, t, o) => re.test(p) ? Promise.reject(new Error('EIO')) : write(p, t, o); return () => { fs.write = write; }; };


const recs = (app) => app.files('proposals/').filter(p => /^proposals\/req-/.test(p));
const one = (app, before) => { const now = recs(app).filter(p => before.indexOf(p) < 0); assert.strictEqual(now.length, 1, 'exactly one record written: ' + JSON.stringify(now)); return JSON.parse(app.fs.files[now[0]].t); };
const gateTitle = (app) => { const r = app.PF.run.sanitize(theRun(app)), m = app.PF.run.mapOf(r); return app.PF.todos.gateTitle(m, m.phases[0].gate.id); };
async function added(app, text) {
  const before = recs(app);
  app.set('td-add', text); app.click('td-add'); await app.tick(120);
  const f = one(app, before);
  await refresh(app, 400);
  return f;
}
const todoOf = (app, text) => { const T = app.PF.todos, r = app.PF.run.sanitize(theRun(app)); const d = { todos: [] }; return { T, r }; };

rule('Add something to do sits under the current phase and names the gate it comes before', async () => {
  const app = await setup();
  const h = app.html();
  assert.ok(/<input[^>]*id="td-add"/.test(h), 'the box');
  assert.ok(h.indexOf('Add something to do') >= 0, 'its label');
  assert.ok(h.indexOf('Before ' + gateTitle(app)) >= 0, 'Before ' + gateTitle(app));
  assert.ok(/id="td-add"[^>]*data-enter="td-add"|data-enter="td-add"[^>]*id="td-add"/.test(h), 'Enter adds it');
});
rule('Adding writes exactly one request, says Queued for the recorder (never Done), and the recorder applies it', async () => {
  const app = await setup();
  const before = recs(app);
  app.set('td-add', 'Check the screenshots'); app.click('td-add'); await app.tick(60);
  const f = one(app, before);
  assert.deepStrictEqual([f.kind, f.text, f.target, f.by], ['compound', 'Check the screenshots', { phase: 'draft' }, 'person-avery'], 'the recorder asks in one gesture');
  const said = app.html();
  assert.ok(/Queued for the recorder/.test(said), 'queued');
  assert.ok(!/role="status"><span>[^<]*\bDone\b/.test(said), 'never Done');
  await refresh(app, 400);
  const r = theRun(app);
  assert.ok(r.living && r.living.head, 'applied');
  const h = app.html();
  assert.ok(h.indexOf('Check the screenshots') >= 0 && /To-dos: 0 of 1/.test(h), 'the row and its own count');
});
rule('Progress names each denominator on its own: this checklist, and to-dos once there are any', async () => {
  const app = await setup();
  assert.ok(/This checklist: 0 of 2/.test(app.html()), 'this checklist');
  assert.ok(!/To-dos:/.test(app.html()) && !/Items:/.test(app.html()), 'no to-dos, no items: neither line');
  await added(app, 'One more thing');
  assert.ok(/This checklist: 0 of 2/.test(app.html()) && /To-dos: 0 of 1/.test(app.html()), 'never blended');
});
rule('Checking one off asks for it; the row shows Done only once it is applied', async () => {
  const app = await setup();
  await added(app, 'Tick me');
  const id = theRun(app).living && app.PF.todos.view(app.PF.run.sanitize(theRun(app)), { records: (await app.PF.repo.loadAll(app.fs, {})).todos, people: JSON.parse(app.fs.files['people.json'].t) }).todos[0].id;
  const before = recs(app);
  app.click('td-done', id); await app.tick(60);
  const f = one(app, before);
  assert.deepStrictEqual([f.kind, f.op, f.todo], ['compound', 'done', id]);
  assert.ok(/Queued for the recorder/.test(app.html()));
  await refresh(app, 400);
  assert.ok(/To-dos: 1 of 1/.test(app.html()), 'applied: counted');
});
async function withTodo(app) {
  await added(app, 'Resolve me');
  const d = await app.PF.repo.loadAll(app.fs, {});
  return app.PF.todos.view(app.PF.run.sanitize(theRun(app)), { records: d.todos, people: JSON.parse(app.fs.files['people.json'].t) }).todos[0].id;
}
rule('Won\'t do needs a reason, Move needs a ticket or a run; nothing is written without one', async () => {
  const app = await setup();
  const id = await withTodo(app);
  let before = recs(app);
  app.click('td-pick', id, { kind: 'wont' }); await app.tick(10);
  assert.ok(/id="td-why"/.test(app.html()), 'the reason box');
  app.click('td-save', id); await app.tick(40);
  assert.deepStrictEqual(recs(app).filter(p => before.indexOf(p) < 0), [], 'no reason: nothing written');
  assert.ok(/Say why it won(&#39;|')t be done/.test(app.html()), 'said');
  app.set('td-why', 'Covered by the release script'); app.click('td-save', id); await app.tick(60);
  const w = one(app, before);
  assert.deepStrictEqual([w.op, w.reason], ['wont', 'Covered by the release script']);
  const app2 = await setup();
  const id2 = await withTodo(app2);
  before = recs(app2);
  app2.click('td-pick', id2, { kind: 'move' }); await app2.tick(10);
  assert.ok(/id="td-to"/.test(app2.html()), 'the destination box');
  app2.set('td-to', 'not a destination'); app2.click('td-save', id2); await app2.tick(40);
  assert.deepStrictEqual(recs(app2).filter(p => before.indexOf(p) < 0), [], 'a bad destination: nothing written');
  app2.set('td-to', 'ABC-123'); app2.click('td-save', id2); await app2.tick(60);
  const m = one(app2, before);
  assert.deepStrictEqual([m.op, m.to], ['move', { ticket: 'ABC-123' }]);
  assert.ok(/Queued for the recorder/.test(app2.html()));
});
rule('Defer opens the Move form; a resolved to-do can be reopened', async () => {
  const app = await setup();
  const id = await withTodo(app);
  assert.ok(/data-act="td-pick"[^>]*data-kind="move"[^>]*>Move or defer/.test(app.html()) || /Move or defer/.test(app.html()), 'one Move or defer action');
  app.click('td-done', id); await app.tick(40); await refresh(app, 400);
  assert.ok(/To-dos: 1 of 1/.test(app.html()), 'set-up: done');
  const before = recs(app);
  app.click('td-reopen', id); await app.tick(60);
  const f = one(app, before);
  assert.deepStrictEqual([f.op, f.todo], ['reopen', id]);
});
rule('Someone who may not decide asks, and the request waits for approval', async () => {
  const app = await setup();
  app.choose('person-casey'); await app.tick();
  const before = recs(app);
  app.set('td-add', 'From Casey'); app.click('td-add'); await app.tick(60);
  const f = one(app, before);
  assert.deepStrictEqual([f.kind, f.by], ['proposal', 'person-casey']);
  assert.ok(/Waiting for approval/.test(app.html()), 'waits');
});
rule('What people type is shown as text, never as markup', async () => {
  const app = await setup();
  await added(app, '<img src=x onerror=alert(1)>');
  const h = app.html();
  assert.ok(h.indexOf('<img src=x') < 0, 'not markup');
  assert.ok(h.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0, 'escaped');
});
rule('Typed and not added, leaving the run asks first', async () => {
  const app = await setup();
  app.set('td-add', 'Half typed'); app.input('td-add', 'Half typed');
  app.click('go', '', { view: 'home' }); await app.tick(20);
  assert.ok(/id="rw"/.test(app.html()), 'still on the run');
  assert.ok(/Finish or cancel this first/.test(app.html()), 'said');
  assert.strictEqual(app.draft('td-add'), 'Half typed', 'the typing is kept');
  app.set('td-add', ''); app.click('go', '', { view: 'home' }); await app.tick(20);
  assert.ok(!/id="rw"/.test(app.html()), 'nothing typed: it goes');
});
rule('On a phone the box and the actions are there; an ended run takes none', async () => {
  const app = await setup({ narrow: true });
  assert.ok(/id="td-add"/.test(app.html()), 'phone width');
  const id = await withTodo(app);
  assert.ok(new RegExp('data-act="td-done"[^>]*data-id="' + id + '"').test(app.html()), 'its check');
  const r0 = theRun(app); r0.ended = { by: 'person-avery', at: new Date().toISOString(), outcome: 'completed' }; r0.state = 'completed'; r0.rev = (r0.rev || 0) + 1;
  await app.fs.write(runPath(app), JSON.stringify(r0, null, 2)); await refresh(app, 300);
  assert.ok(!/id="td-add"/.test(app.html()) && !/data-act="td-done"/.test(app.html()), 'ended: nothing to act on');
});
rule('Enter in the box adds it, as the button does; the box is empty again after', async () => {
  const app = await setup();
  const before = recs(app);
  app.set('td-add', 'By keyboard'); app.keyOn('Enter', {}, { tagName: 'INPUT', id: 'td-add', value: 'By keyboard', dataset: { enter: 'td-add', id: 'draft' }, closest: () => null }); await app.tick(60);
  const f = one(app, before);
  assert.deepStrictEqual([f.text, f.target], ['By keyboard', { phase: 'draft' }]);
  assert.strictEqual(app.draft('td-add'), '', 'cleared');
});
rule('An open to-do holds its gate, and the gate says why', async () => {
  const app = await setup();
  app.click('record', 'write'); await app.tick(80);
  assert.ok(/data-act="pick" data-kind="pass" data-id="draft-confirm"|data-act="pass"/.test(app.html()), 'set-up: the gate is ready');
  await added(app, 'Hold it');
  const h = app.html();
  assert.ok(!/data-act="pick" data-kind="pass" data-id="draft-confirm"/.test(h) && !/data-act="pass" data-id="0"/.test(h), 'held: no Pass');
  assert.ok(/To-do &quot;Hold it&quot; is open|To-do "Hold it" is open/.test(h), 'and why');
});
rule('A request still waiting shows in its phase with its status, and takes no action', async () => {
  const app = await setup();
  app.choose('person-casey'); await app.tick();
  app.set('td-add', 'Waits here'); app.click('td-add'); await app.tick(60);
  await refresh(app, 400);
  const h = app.html();
  assert.ok(/Waits here<\/span> <span class="pill review">Waiting for approval/.test(h), 'listed, waiting');
  assert.ok(!/To-dos:/.test(h), 'not counted until it lands');
});
rule('A save that finishes late clears only what it sent: newer typing in the box stays', async () => {
  const app = await setup();
  const fs = app.fs, write = fs.write.bind(fs), held = [];
  const hold = () => { fs.write = (p, t, o) => /^proposals\/req-/.test(p) ? new Promise((res, rej) => held.push(() => write(p, t, o).then(res, rej))) : write(p, t, o); };
  const release = async () => { fs.write = write; held.splice(0).forEach(f => f()); await app.tick(80); };
  hold();
  app.set('td-add', 'First thing'); app.click('td-add'); await app.tick(20);
  app.set('td-add', 'Newer typing');
  await release();
  assert.strictEqual(app.draft('td-add'), 'Newer typing', 'the newer text stays');
  app.set('td-add', 'Same text'); hold(); app.click('td-add'); await app.tick(20); await release();
  assert.strictEqual(app.draft('td-add'), '', 'unchanged, it is cleared');
  const id = await withTodo(app);
  app.click('td-pick', id, { kind: 'wont' }); await app.tick(10);
  hold();
  app.set('td-why', 'First reason'); app.click('td-save', id); await app.tick(20);
  app.set('td-why', 'Second thoughts');
  await release();
  assert.strictEqual(app.draft('td-why'), 'Second thoughts', 'the newer reason is never wiped by the earlier save');
});
rule('A write that may have happened, asked again, is the same request: never a second one', async () => {
  const app = await setup();
  const fs = app.fs, write = fs.write.bind(fs);
  let once = true;
  fs.write = (p, t, o) => /^proposals\/req-/.test(p) && once ? (once = false, write(p, t, o).then(() => Promise.reject(new Error('EIO')))) : write(p, t, o);
  const before = recs(app);
  app.set('td-add', 'Only once'); app.click('td-add'); await app.tick(60);
  assert.ok(/may or may not have been saved/.test(app.html()), 'said');
  app.click('td-add'); await app.tick(60);
  one(app, before);
  assert.ok(/Queued for the recorder/.test(app.html()), 'the second ask finds the first');
});
run();
