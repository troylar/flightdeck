// The app's spread world, shared by the app's spread tests (test/app-spreads.test.js) and its dependency matrix
// (test/app-spread-deps.test.js): a parent run with a loop over three stories and their runs, ABC-101 cleared.
'use strict';
const assert = require('assert');
const { boot } = require('./app-harness');

const KID = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-avery', '---', '',
  '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');

async function setup(o) {
  o = o || {};
  /* o.boot: more for boot (the approval harness clones a prepared app: shared files, Web Locks, its session store). */
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, o.boot || {})); await app.tick(80); app.choose('person-avery'); await app.tick();
  const PF = app.PF, people = JSON.parse(app.fs.files['people.json'].t), now = new Date().toISOString();
  const put = (md, id, rand) => {
    const b = PF.publish.build(md, { people, ...require('./harness').exampleSetup(PF), by: 'person-avery', changes: 'First', existing: [], now, rand, app: '4.0.0' });
    assert.ok(!b.blockers, JSON.stringify(b.blockers));
    Object.keys(b.files).forEach(k => { app.fs.files['publications/' + id + '/' + b.folder + '/' + k] = { t: b.files[k], m: Date.now() }; });
  };
  put(o.kid || KID, 'validate-story', 'vs000001');
  put(PARENT, 'release-readiness', 'rr000001');
  app.click('refresh'); await app.tick(80);
  app.click('start', 'release-readiness'); await app.settle();
  app.chooseApprovers().submitForm('start-form'); await app.tick(120);
  await addStories(app, 'ABC-101, ABC-102, ABC-103');
  for (const k of ['ABC-101', 'ABC-102', 'ABC-103']) { app.click('loop-start', 'each', { item: k }); await app.tick(150); backToParent(app); await app.tick(60); }
  assert.strictEqual(kidPaths(app).length, 3, 'set-up: three story runs');
  await finish(app, kidOf(app, 'ABC-101'), 'cleared', true);
  return app;
}
/* Adds stories from the loop's box, as typed; the box is left empty after, as a person leaves it. */
const addStories = async (app, keys) => { app.set('loop-add-each', keys); app.click('loop-add', 'each'); await app.tick(150); app.set('loop-add-each', ''); await app.tick(); };
const parentPath = (app) => app.files('runs/release-readiness/').find(p => /run\.json$/.test(p));
const parentRun = (app) => JSON.parse(app.fs.files[parentPath(app)].t);
const kidPaths = (app) => app.files('runs/validate-story/').filter(p => /run\.json$/.test(p));
const kidOf = (app, key) => kidPaths(app).find(p => JSON.parse(app.fs.files[p].t).parent.item.key === key);
const backToParent = (app) => { const r = parentRun(app); app.click('open-run', r.process + '/' + r.id); };
const txt = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const ov = (app) => app.overlay() || '';
const refresh = async (app, ms) => { app.click('refresh'); await app.tick(ms || 250); };
let seq = 0; const hex = (n) => (++seq).toString(16).padStart(n, '0');
/* A story's run recorded with a verdict and its gate passed; ended only when asked. */
async function finish(app, path, decision, end) {
  const kid = JSON.parse(app.fs.files[path].t), at = new Date(Date.now() + 1000).toISOString(), R = app.PF.run;
  kid.steps.verdict = { s: 'done', by: 'person-avery', at, values: { decision } };
  kid.details.disposition = decision;
  const rr = R.sanitize(JSON.parse(JSON.stringify(kid))), mm = R.mapOf(rr);
  mm.phases.forEach(p => { if (p.gate) kid.gates[p.gate.id] = { s: 'passed', by: 'person-avery', at, approved: R.gateInputs(rr, mm, p.gate) }; });
  if (end) { kid.ended = { outcome: 'Completed', by: 'person-avery', at }; kid.state = 'completed'; }
  kid.rev = (kid.rev || 0) + 1;
  await app.fs.write(path, JSON.stringify(kid));
  await refresh(app, 150);
}
/* What the folder holds now, read as a window reads it. */
async function now(app) {
  const PF = app.PF, d = await PF.repo.loadAll(app.fs, {});
  const procOf = (id) => { const x = d.processes.filter(p => p.process === id)[0]; return x ? { latest: x.index.latest, all: x.index.all, clashes: x.index.clashes, broken: [] } : null; };
  return { d, procOf, people: JSON.parse(app.fs.files['people.json'].t), parent: d.runs.find(x => x.process === 'release-readiness') };
}
/* A tool asks for the spread on the loop (what flightdeck spread add writes). */
async function askSpread(app, text) {
  const PF = app.PF, T = PF.todos, W = await now(app), r = W.parent, x = PF.map.findStep(PF.run.mapOf(r), 'each');
  const LV = PF.loop.view(r, 'each', { records: W.d.scopes, runs: W.d.runs, procOf: W.procOf }), childMap = PF.pins.childTarget(r, x.step, W.procOf).pub.map;
  const P = T.prepare(r, { body: { op: 'spread-add', loopStep: 'each', text, child: { beforeGate: 'assess-confirm' }, scope: PF.spreads.snapshot(LV) }, by: { tool: 'release-helper', version: '1.0', key: 'sp-' + hex(6) }, records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0', childMap });
  assert.ok(!P.why, P.why);
  await app.fs.write('proposals/' + P.name, T.text(P.file));
  return P;
}
/* A tool asks each story's run for it (what flightdeck spread sync writes), one request per story. */
async function sync(app, keys) {
  const PF = app.PF, T = PF.todos, out = [];
  for (const key of keys) {
    const W = await now(app), sp = T.view(W.parent, { records: W.d.todos, people: W.people }).spreads[0], kid = W.d.runs.find(x => x.process === 'validate-story' && x.parent && x.parent.item && x.parent.item.key === key);
    const P = T.prepare(kid, { body: { op: 'add', text: sp.text, target: { phase: 'assess' }, fulfills: { run: { process: W.parent.process, id: W.parent.id }, spread: sp.id, uid: kid.parent.item.uid, attempt: kid.parent.item.attempt } }, by: { tool: 'sync-bot', version: '1.0' }, records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0' });
    assert.ok(!P.why, P.why);
    await app.fs.write('proposals/' + P.name, T.text(P.file));
    out.push(P);
  }
  return out;
}
const decisions = (app) => app.files('proposals/').map(p => JSON.parse(app.fs.files[p].t)).filter(x => x.kind === 'decision');
const homeCount = (app) => { app.click('go', '', { view: 'home' }); return app.tick(40).then(() => { const m = /(\d+) to-do requests? needs? your decision/.exec(app.html()); return m ? Number(m[1]) : 0; }); };
const accepts = (h) => { const out = []; const re = /data-act="td-accept" data-id="([^"]+)"/g; let m; while ((m = re.exec(h))) out.push(m[1]); return out; };
async function landedSpread(app) {
  const P = await askSpread(app, 'Security sign-off');
  await refresh(app, 300);
  assert.strictEqual(await homeCount(app), 1, 'the spread waits for a person');
  app.click('td-inbox', ''); await app.tick(20);
  assert.ok(/Require &quot;Security sign-off&quot; on 2 open stories|Require "Security sign-off" on 2 open stories/.test(ov(app)), ov(app));
  const b = /data-act="td-accept" data-id="([^"]+)" data-run="([^"]+)" data-fp="([^"]+)"/.exec(ov(app));
  app.click('td-accept', b[1], { run: b[2], fp: b[3] }); await app.tick(80);
  app.click('close-overlay'); await app.tick();
  for (let i = 0; i < 4; i++) await refresh(app, 300);
  backToParent(app); await app.tick(80);
  return P;
}

async function fulfilled(app, keys) {
  const PF = app.PF, T = PF.todos;
  for (const key of keys) {
    let W = await now(app);
    const sp = T.view(W.parent, { records: W.d.todos, people: W.people }).spreads[0], kid = W.d.runs.find(x => x.process === 'validate-story' && x.parent && x.parent.item && x.parent.item.key === key);
    const A = T.prepare(kid, { body: { op: 'add', text: sp.text, target: { phase: 'assess' }, fulfills: { run: { process: W.parent.process, id: W.parent.id }, spread: sp.id, uid: kid.parent.item.uid, attempt: kid.parent.item.attempt } }, by: { person: 'person-avery' }, key: 'wa-' + hex(6), records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0' });
    assert.ok(!A.why, A.why);
    await app.fs.write('proposals/' + A.name, T.text(A.file));
    for (let i = 0; i < 3; i++) await refresh(app, 300);
    W = await now(app);
    const k2 = W.d.runs.find(x => x.id === kid.id);
    const D = T.prepare(k2, { body: { op: 'done', todo: A.preview.todo }, by: { person: 'person-avery' }, key: 'wa-' + hex(6), records: W.d.todos, unread: W.d.todosUnread, people: W.people, at: new Date().toISOString(), app: '4.0.0' });
    assert.ok(!D.why, D.why);
    await app.fs.write('proposals/' + D.name, T.text(D.file));
    for (let i = 0; i < 3; i++) await refresh(app, 300);
    await finish(app, kidOf(app, key), 'cleared', true);
  }
}

/* The loop's scope records, oldest first (the app's loop-add requests). */
const scopes = (app) => app.files('proposals/').filter(p => { try { const j = JSON.parse(app.fs.files[p].t); return j.loop && Array.isArray(j.changes); } catch (e) { return false; } })
  .sort((x, y) => JSON.parse(app.fs.files[x].t).seen.length - JSON.parse(app.fs.files[y].t).seen.length);
/* A spread fulfilled on every story, ABC-104 brought in by a later scope record among them, and the loop approved: the gate is Ready. */
async function ready() {
  const app = await setup();
  await landedSpread(app);
  await addStories(app, 'ABC-104');
  app.click('loop-start', 'each', { item: 'ABC-104' }); await app.tick(150); backToParent(app); await app.tick(60);
  await fulfilled(app, ['ABC-102', 'ABC-103', 'ABC-104']);
  backToParent(app); await app.tick(80);
  app.click('loop-approve', 'each'); await app.tick(200);
  assert.strictEqual(parentRun(app).steps.each.s, 'done', 'set-up: the loop is approved');
  const g = (txt(app.html()).replace(/\s+/g, ' ').match(/Confirm Stories · [A-Za-z ]{0,20}/) || [''])[0];
  assert.ok(/· Ready/.test(g), 'set-up: the gate is Ready: ' + g);
  return app;
}
module.exports = { KID, PARENT, setup, addStories, parentPath, parentRun, kidPaths, kidOf, backToParent, txt, ov, refresh, hex, finish, now, askSpread, sync, decisions, homeCount, accepts, landedSpread, fulfilled, scopes, ready };
