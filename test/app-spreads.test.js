// Spreads (4.0, docs/design.md 45.1) in the app, slice 3: the loop shows one row per spread with a chip per story and what
// joined since; the inbox accepts a spread's plain additions together ("Accept N additions"), each its own decision on exactly
// what it showed, and keeps every exception apart; every count said is the count opened. Adding, including and stopping a
// spread go through flightdeck spread and the skills; the app is a faithful view plus easy decisions.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

const KID = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-avery', '---', '',
  '## Stories · DO-CONFIRM {#stories}', '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');

async function setup(o) {
  o = o || {};
  const app = boot({ localStore: { 'preflight:builder': 'false' } }); await app.tick(80); app.choose('person-avery'); await app.tick();
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

rule('The loop shows one spread row with a chip per story; a story that joins is announced as owed', async () => {
  const app = await setup();
  await landedSpread(app);
  let h = txt(app.html());
  assert.ok(/Security sign-off · on 2 stories · 0 done/.test(h), 'the row: ' + (h.match(/Security sign-off[^\n]{0,120}/) || [])[0]);
  assert.ok(/2 open stories; 1 cleared story unchanged/.test(h), 'what it covers');
  const chips = (app.html().match(/<li class="sp-chip[^"]*"[^>]*>[\s\S]*?<\/li>/g) || []).map(txt);
  assert.deepStrictEqual(chips, ['ABC-102 · Not requested yet', 'ABC-103 · Not requested yet'], 'a chip per owed story');
  await addStories(app, 'ABC-104');
  await refresh(app, 200);
  h = txt(app.html());
  assert.ok(/ABC-104 joined\. Security sign-off is owed; not requested yet\./.test(h), 'the arrival is announced');
  assert.ok(/on 3 stories · 0 done/.test(h), 'and counted');
  assert.ok(!/data-act="sp-/.test(app.html()), 'adding, including and stopping go through flightdeck spread, not buttons here');
});

rule('Accept N additions decides each plain addition separately on what it showed; an exception is kept apart; counts are exact', async () => {
  const app = await setup();
  await landedSpread(app);
  await addStories(app, 'ABC-104');
  app.click('loop-start', 'each', { item: 'ABC-104' }); await app.tick(150); backToParent(app); await app.tick(60);
  /* ABC-104's assessment already passed its gate: adding before it reopens that gate, so it is an exception. */
  await finish(app, kidOf(app, 'ABC-104'), 'needs-work', false);
  const ps = await sync(app, ['ABC-102', 'ABC-103', 'ABC-104']);
  await refresh(app, 300);
  assert.strictEqual(await homeCount(app), 3, 'three requests need you');
  app.click('td-inbox', ''); await app.tick(20);
  let h = ov(app);
  const m = /<button[^>]*data-act="td-accept-all"[^>]*>([^<]*)<\/button>/.exec(h);
  assert.ok(m && /Accept 2 additions/.test(m[1]), 'one batch for the two plain additions: ' + (m && m[1]));
  assert.deepStrictEqual(accepts(h), [ps[2].id], 'the exception is its own decision');
  assert.ok(/reopen/i.test(txt(h)), 'and says what it reopens');
  const before = decisions(app).length;
  const bt = m[0], d = {}; bt.replace(/data-(spread|run|ids|fps)="([^"]*)"/g, (x, k, v) => { d[k] = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&'); });
  app.click('td-accept-all', /data-id="([^"]*)"/.exec(bt)[1], d); await app.tick(150);
  const ds = decisions(app).slice(before);
  assert.deepStrictEqual(ds.map(x => [x.proposal, x.op]).sort(), [[ps[0].id, 'accept'], [ps[1].id, 'accept']].sort(), 'two decisions, one per request');
  assert.ok(ds.every(x => typeof x.consequence === 'string' && x.consequence.length > 0), 'each binds what it showed');
  assert.ok(/Accepted 2 additions/.test(txt(ov(app))), 'said: ' + txt(ov(app)).slice(0, 300));
  h = ov(app);
  assert.ok(!/data-act="td-accept-all"/.test(h) && accepts(h).length === 1, 'only the exception is left');
  app.click('close-overlay'); await app.tick();
  assert.strictEqual(await homeCount(app), 1, 'and the count says so');
});

rule('A batch with an outcome that couldn\'t be saved says exactly which; the rest stand and the count is exact', async () => {
  const app = await setup();
  await landedSpread(app);
  const ps = await sync(app, ['ABC-102', 'ABC-103']);
  await refresh(app, 300);
  app.click('td-inbox', ''); await app.tick(20);
  const bt = /<button[^>]*data-act="td-accept-all"[^>]*>/.exec(ov(app))[0], d = {};
  bt.replace(/data-(spread|run|ids|fps)="([^"]*)"/g, (x, k, v) => { d[k] = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&'); });
  /* The second decision's write fails. */
  const fs = app.fs, write = fs.write.bind(fs); let n = 0;
  fs.write = (p, t, o) => /^proposals\/req-.*status-/.test(p) && ++n === 2 ? Promise.reject(new Error('EIO')) : write(p, t, o);
  app.click('td-accept-all', /data-id="([^"]*)"/.exec(bt)[1], d); await app.tick(200);
  fs.write = write;
  const said = txt(ov(app));
  assert.ok(/Accepted 1 of 2 additions/.test(said) && /couldn't be saved/i.test(said), said.slice(0, 400));
  assert.strictEqual(decisions(app).filter(x => ps.some(p => p.id === x.proposal)).length, 1);
  app.click('close-overlay'); await app.tick();
  await refresh(app, 200);
  assert.strictEqual(await homeCount(app), 1, 'the one not saved still needs you, once');
});

/* Review round 1 (SD): a batch is the clicking person's, in the folder and generation of the click, or it stops. */
rule('SD: Accept N additions never continues as another person: changing who you are stops the rest, nothing is written as them', async () => {
  const app = await setup({ kid: KID.replace('owner: person-avery\n', 'owner: person-avery\nroles: reviewer\n') });
  await landedSpread(app);
  /* Blake reviews every story's run too, so Blake could decide them. */
  for (const k of ['ABC-102', 'ABC-103']) { const p = kidOf(app, k), kid = JSON.parse(app.fs.files[p].t); kid.roles = Object.assign({}, kid.roles, { reviewer: 'person-blake' }); kid.rev = (kid.rev || 0) + 1; await app.fs.write(p, JSON.stringify(kid)); }
  const ps = await sync(app, ['ABC-102', 'ABC-103']);
  await refresh(app, 300);
  app.click('td-inbox', ''); await app.tick(20);
  const bt = /<button[^>]*data-act="td-accept-all"[^>]*>/.exec(ov(app));
  assert.ok(bt, 'set-up: the batch');
  const d = {}; bt[0].replace(/data-(ids)="([^"]*)"/g, (x, k, v) => { d[k] = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&'); });
  /* While the first decision is being written, the person picked changes to Blake. */
  const fs = app.fs, write = fs.write.bind(fs); let n = 0;
  fs.write = (p, t, o2) => { if (/^proposals\/req-.*status-/.test(p) && ++n === 1) { app.choose('person-blake'); return new Promise(res => setTimeout(res, 30)).then(() => write(p, t, o2)); } return write(p, t, o2); };
  app.click('td-accept-all', /data-id="([^"]*)"/.exec(bt[0])[1], d); await app.tick(300);
  fs.write = write;
  const ds = decisions(app).filter(x => ps.some(p => p.id === x.proposal));
  assert.ok(ds.every(x => x.by === 'person-avery'), 'nothing written as Blake: ' + JSON.stringify(ds.map(x => x.by)));
  assert.ok(ds.length <= 1, 'the rest stopped: ' + ds.length);
  const said = txt(app.html() + ov(app));
  assert.ok(/stopped/i.test(said) && /changed/i.test(said), said.slice(0, 600));
});
/* Review round 1 (SF): a decision whose read-back failed is unconfirmed, named, read again, and kept for the same retry. */
rule('SF: a batch decision that was written but couldn\'t be read back is read again, never reported as not saved', async () => {
  const app = await setup();
  await landedSpread(app);
  const ps = await sync(app, ['ABC-102', 'ABC-103']);
  await refresh(app, 300);
  const press = async () => {
    app.click('td-inbox', ''); await app.tick(20);
    const bt = /<button[^>]*data-act="td-accept-all"[^>]*>/.exec(ov(app)), d = {};
    bt[0].replace(/data-(ids)="([^"]*)"/g, (x, k, v) => { d[k] = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&'); });
    app.click('td-accept-all', /data-id="([^"]*)"/.exec(bt[0])[1], d); await app.tick(300);
  };
  /* Every read of the first decision written fails from its write on: it is there, but this window can't see it. */
  const fs = app.fs, write = fs.write.bind(fs), read = fs.read.bind(fs); let first = null;
  fs.write = (p, t, o) => { if (!first && /^proposals\/req-.*status-/.test(p)) first = p; return write(p, t, o); };
  fs.read = (p, o) => p === first ? Promise.reject(new Error('EIO')) : read(p, o);
  await press();
  const said = txt(app.html() + ov(app)), which = ps.filter(q => first.indexOf(q.id) >= 0)[0];
  assert.ok(which, 'set-up: a decision was written');
  assert.ok(!/couldn't be saved/.test(said), 'never "not saved": ' + said.slice(0, 500));
  assert.ok(/couldn't confirm/i.test(said) && said.indexOf(which.id) >= 0, 'named as unconfirmed: ' + said.slice(0, 500));
  fs.write = write; fs.read = read;
  app.click('close-overlay'); await app.tick();
  /* Accepting it again is the same record, never a second one. */
  await refresh(app, 300);
  const before = decisions(app).filter(x => x.proposal === which.id).length;
  if (/td-accept-all|td-accept/.test((app.click('td-inbox', ''), await app.tick(20), ov(app)))) { app.click('close-overlay'); await app.tick(); await press(); }
  assert.strictEqual(decisions(app).filter(x => x.proposal === which.id).length, before, 'one decision on it');
  /* And when the read-back fails only once, reading again confirms it. */
  const app2 = await setup(); await landedSpread(app2);
  await sync(app2, ['ABC-102', 'ABC-103']); await refresh(app2, 300);
  const f2 = app2.fs, w2 = f2.write.bind(f2), r2 = f2.read.bind(f2); let one = null, failedOnce = false;
  f2.write = (p, t, o) => { if (!one && /^proposals\/req-.*status-/.test(p)) one = p; return w2(p, t, o); };
  f2.read = (p, o) => { if (p === one && !failedOnce) { failedOnce = true; return Promise.reject(new Error('EIO')); } return r2(p, o); };
  app2.click('td-inbox', ''); await app2.tick(20);
  const bt2 = /<button[^>]*data-act="td-accept-all"[^>]*>/.exec(ov(app2)), d2 = {};
  bt2[0].replace(/data-(ids)="([^"]*)"/g, (x, k, v) => { d2[k] = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&'); });
  app2.click('td-accept-all', /data-id="([^"]*)"/.exec(bt2[0])[1], d2); await app2.tick(300);
  assert.ok(/Accepted 2 additions/.test(txt(app2.html() + ov(app2))), txt(ov(app2)).slice(0, 400));
});
/* Review round 2 (TF): a batch's confirmation read finishing after the folder changed touches nothing there: no record, no
   retry state, no message. */
rule('TF: a batch decision\'s reread that finishes after the folder changed never enters the folder opened next', async () => {
  const app = await setup();
  await landedSpread(app);
  const ps = await sync(app, ['ABC-102', 'ABC-103']);
  await refresh(app, 300);
  const fs = app.fs, write = fs.write.bind(fs), read = fs.read.bind(fs); let first = null, firstText = null, reads = 0, release = null;
  const held = new Promise((res) => { release = res; });
  fs.write = (p, t, o) => { if (!first && /^proposals\/req-.*status-/.test(p)) { first = p; firstText = t; } return write(p, t, o); };
  fs.read = (p, o) => {
    if (p !== first) return read(p, o);
    reads++;
    if (reads === 1) return Promise.reject(new Error('EIO'));
    return held.then(() => ({ text: firstText }));
  };
  app.click('td-inbox', ''); await app.tick(20);
  const bt = /<button[^>]*data-act="td-accept-all"[^>]*>/.exec(ov(app)), d = {};
  bt[0].replace(/data-(ids)="([^"]*)"/g, (x, k, v) => { d[k] = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&'); });
  app.click('td-accept-all', /data-id="([^"]*)"/.exec(bt[0])[1], d); await app.tick(300);
  assert.ok(first && reads >= 2, 'set-up: the read-back failed and the reread waits (' + reads + ')');
  const which = ps.filter(q => first.indexOf(q.id) >= 0)[0];
  /* Another folder: a copy of this one without that acceptance. */
  app.click('close-overlay'); await app.tick();
  fs.id = (fs.id || 'f') + '-copy'; delete fs.files[first];
  await refresh(app, 300);
  const h0 = await homeCount(app);
  assert.strictEqual(h0, 1, 'set-up: the copy still needs a decision on ' + which.id);
  release(); await app.tick(300);
  assert.strictEqual(await homeCount(app), 1, 'the old folder\'s acceptance never enters the copy');
  const shown = txt(app.html() + ov(app) + app.live());
  assert.ok(!/Accepted \d|Couldn't confirm/i.test(shown), 'nothing said here about the old folder\'s batch: ' + shown.slice(0, 400));
});
/* Review round 4 (VC): a batch accepts only what is still a plain addition when it decides and when it writes; one decided
   two ways meanwhile is left for its own decision and named. */
rule('VC: a dispute that arrives on a batch\'s request mid-batch is never settled by it; it is named and left for its own decision', async () => {
  const app = await setup();
  await landedSpread(app);
  const ps = await sync(app, ['ABC-102', 'ABC-103']);
  await refresh(app, 300);
  app.click('td-inbox', ''); await app.tick(20);
  const bt = /<button[^>]*data-act="td-accept-all"[^>]*>/.exec(ov(app)), d = {};
  bt[0].replace(/data-(ids)="([^"]*)"/g, (x, k, v) => { d[k] = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&'); });
  const triples = d.ids.split(' ').map(t => t.split('|')), second = triples[1];
  const fs = app.fs, write = fs.write.bind(fs); let release = null, paused = false;
  const held = new Promise((res) => { release = res; });
  fs.write = (p, t, o) => { if (!paused && /^proposals\/req-.*status-/.test(p)) { paused = true; return held.then(() => write(p, t, o)); } return write(p, t, o); };
  app.click('td-accept-all', /data-id="([^"]*)"/.exec(bt[0])[1], d); await app.tick(100);
  assert.ok(paused, 'set-up: the first save waits');
  /* Two people decide the second request at once, elsewhere. */
  const T = app.PF.todos, [rk, id, fp] = second, run = { process: rk.split('/')[0], id: rk.split('/')[1] };
  for (const [op, w] of [['accept', 'wx1'], ['decline', 'wx2']]) { const st = T.buildStatus({ kind: 'decision', proposal: id, run, seen: [id], by: 'person-avery', at: new Date().toISOString(), op, consequence: fp, writer: w, rev: hex(8), app: '4.0.0' }); await write('proposals/' + st.name, T.text(st.file)); }
  await refresh(app, 300);
  release(); await app.tick(400);
  assert.strictEqual(decisions(app).filter(x => x.proposal === id).length, 2, 'no decision of the batch settles it');
  const said = txt(app.html() + ov(app) + app.live());
  assert.ok(/Accepted 1 of 2/.test(said) && said.indexOf(id) >= 0, 'named, left for its own decision: ' + said.slice(0, 600));
  assert.ok(ps.length === 2, 'set-up');
});
run();
