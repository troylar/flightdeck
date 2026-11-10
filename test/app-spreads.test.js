// Spreads (4.0, docs/design.md 45.1) in the app, slice 3: the loop shows one row per spread with a chip per story and what
// joined since; the inbox accepts a spread's plain additions together ("Accept N additions"), each its own decision on exactly
// what it showed, and keeps every exception apart; every count said is the count opened. Adding, including and stopping a
// spread go through flightdeck spread and the skills; the app is a faithful view plus easy decisions.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const F = require('./app-spread-fixture');
const { KID, PARENT, setup, addStories, parentPath, parentRun, kidPaths, kidOf, backToParent, txt, ov, refresh, hex, finish, now, askSpread, sync, decisions, homeCount, accepts, landedSpread, fulfilled } = require('./app-spread-fixture');

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
/* Review round 5 (WA): a story's run whose last read failed is unknown, never the copy kept on screen: coverage, the loop's
   approval and the parent's gate hold until a fresh good read, and Pass saves nothing. */
rule('WA: a story\'s run that couldn\'t be read on the last check holds the loop and the gate; Pass saves nothing until it reads again', async () => {
  const app = await setup();
  await landedSpread(app);
  await fulfilled(app, ['ABC-102', 'ABC-103']);
  backToParent(app); await app.tick(80);
  assert.ok(/Security sign-off · on 2 stories · 2 done/.test(txt(app.html())), 'set-up: fulfilled: ' + (txt(app.html()).match(/Security sign-off[^\n]{0,80}/) || [])[0]);
  app.click('loop-approve', 'each'); await app.tick(200);
  assert.strictEqual(parentRun(app).steps.each.s, 'done', 'set-up: the loop is approved');
  const gateText = () => (txt(app.html()).replace(/\s+/g, ' ').match(/Confirm Stories · [A-Za-z ]{0,20}/) || [''])[0];
  assert.ok(/· Ready/.test(gateText()), 'set-up: the gate is ready: ' + gateText());
  const p102 = kidOf(app, 'ABC-102'), read = app.fs.read.bind(app.fs);
  app.fs.read = (p, o) => p === p102 ? Promise.reject(new Error('EIO')) : read(p, o);
  await refresh(app, 300); backToParent(app); await app.tick(80);
  assert.ok(!/· Ready/.test(gateText()), 'the copy kept on screen isn\'t counted: ' + gateText());
  app.click('pass', '0'); await app.tick(150);
  const g = parentRun(app).gates || {};
  assert.ok(!Object.keys(g).some(k => g[k] && g[k].s === 'passed'), 'Pass saved nothing: ' + JSON.stringify(g));
  app.fs.read = read;
  for (let i = 0; i < 3; i++) await refresh(app, 300);
  backToParent(app); await app.tick(80);
  assert.ok(/· Ready/.test(gateText()), 'a fresh good read counts it again: ' + gateText());
});
/* Review round 7 (YA): the app files a living run's scope change as a 4.0 scope request naming the parent's to-do head. */
rule('YA: the app files a living run\'s scope change as a 4.0 scope request naming the parent head it saw', async () => {
  const app = await F.setup();
  await F.landedSpread(app);
  const head = F.parentRun(app).living.head;
  assert.ok(head, 'set-up: the parent is living');
  await F.addStories(app, 'ABC-104');
  const j = JSON.parse(app.fs.files[F.scopes(app).slice(-1)[0]].t);
  assert.deepStrictEqual([j.format, j.features, j.head], ['flightdeck-plan/4', ['loops', 'living-runs'], head]);
});
/* Review round 9 (AB): Pass held at its write while a story's run of a fulfilled spread stops reading writes nothing. */
rule('AB: Pass on a fulfilled spread\'s loop, held at its write while a story\'s run turns EIO, writes nothing, and is put back', async () => {
  const app = await setup();
  await landedSpread(app);
  await fulfilled(app, ['ABC-102', 'ABC-103']);
  backToParent(app); await app.tick(80);
  app.click('loop-approve', 'each'); await app.tick(200);
  assert.strictEqual(parentRun(app).steps.each.s, 'done', 'set-up: the loop is approved');
  assert.ok(/data-act="pass"/.test(app.html()), 'set-up: the gate is Ready');
  const before = JSON.stringify(app.files('runs/release-readiness/').map(f => [f, app.fs.files[f].t]));
  const read0 = app.fs.read.bind(app.fs), p = parentPath(app), p102 = kidOf(app, 'ABC-102');
  let open, n = 0; const held = new Promise(res => { open = res; });
  app.fs.read = (q, o) => q === p && ++n === 1 ? held.then(() => read0(q, o)) : read0(q, o);
  app.click('pass', '0'); await app.tick(60);
  assert.ok(n > 0, 'set-up: the save reached its read');
  const read1 = app.fs.read;
  app.fs.read = (q, o) => q === p102 ? Promise.reject(new Error('EIO')) : read1(q, o);
  await refresh(app, 400);
  open(); await app.tick(500);
  assert.strictEqual(JSON.stringify(app.files('runs/release-readiness/').map(f => [f, app.fs.files[f].t])), before, 'nothing written');
  app.fs.read = read0;
  for (let i = 0; i < 3; i++) await refresh(app, 300);
  backToParent(app); await app.tick(80);
  assert.ok(/data-act="pass"/.test(app.html()), 'read again: Ready, the tentative pass put back');
});
/* Review round 10 (BB): the same on a fulfilled spread's loop. */
const BB = require('./app-approval-bb');
const bbSpread = {
  prep: async (bo) => { const app = await setup({ boot: bo }); await landedSpread(app); await fulfilled(app, ['ABC-102', 'ABC-103']); backToParent(app); await app.tick(80); return app; },
  kid: (app) => kidOf(app, 'ABC-102'),
  reread: async (app) => { for (let i = 0; i < 3; i++) await refresh(app, 300); backToParent(app); await app.tick(80); }
};
for (const how of Object.keys(BB.WRITES)) rule('BB: ' + how + ' on a fulfilled spread\'s loop rereads its stories\' runs at every write: absent, EIO or version EIO writes nothing', async () => {
  const { cases, off } = await BB.matrix(bbSpread, how);
  assert.deepStrictEqual([cases, off], [6, []]);
});
rule('BB: Use copy of a fulfilled spread\'s parent after Refresh detected a story\'s run EIO keeps nothing, and the copy stays', async () => {
  assert.deepStrictEqual(await BB.useCopyAfterEio(bbSpread), []);
});
/* Review round 12 (FB): the same writes reread what coverage reads besides the runs (the scope records, and the story's to-do records) with no Refresh
   in between: nothing written, the change put back; Use copy too, with and without a Refresh first. */
for (const how of Object.keys(BB.WRITES)) rule('FB: ' + how + ' on a fulfilled spread\'s loop rereads its scope records and to-do records at every write', async () => {
  const deps = Object.keys(BB.DEPS), { cases, off } = await BB.matrix(bbSpread, how, deps);
  assert.deepStrictEqual([cases, off], [deps.length * 2, []]);
});
for (const brk of Object.keys(BB.DEPS)) for (const noRefresh of [false, true]) rule('FB: Use copy on a fulfilled spread\'s loop with ' + brk + (noRefresh ? ', no Refresh first' : ', after Refresh') + ' keeps nothing, and the copy stays', async () => {
  assert.deepStrictEqual(await BB.useCopyAfterEio(bbSpread, brk, noRefresh), []);
});
/* Review round 13 (GA, GB): a scope record that arrives, a conflicting copy of one, and the run's own version gone or
   unreadable, while any approval write waits (at the parent read, after the candidate), on Try again, and on Use copy with
   no Refresh first: nothing written, the change put back, the copy kept. */
for (const how of Object.keys(BB.WRITES)) rule('GA/GB: ' + how + ' on a fulfilled spread\'s loop reads a fresh listing and its own version at every write', async () => {
  const { cases, off } = await BB.matrix(bbSpread, how, BB.GA_GB);
  assert.deepStrictEqual([cases, off], [BB.GA_GB.length * 2, []]);
});
for (const brk of BB.GA_GB) {
  rule('GA/GB: Try again on a fulfilled spread\'s loop after ' + brk + ' writes nothing', async () => { assert.deepStrictEqual(await BB.retryAfter(bbSpread, brk), []); });
  rule('GA/GB: Use copy on a fulfilled spread\'s loop after ' + brk + ', no Refresh first, keeps nothing, and the copy stays', async () => { assert.deepStrictEqual(await BB.useCopyAfterEio(bbSpread, brk, true), []); });
}
/* Review round 14 (HA): the suspension harness (app-approval-bb.js): every approval-writing path x every read inside its
   guard x every input change made while that read waits. Where the guard reads the changed input at or after that point,
   nothing more is written and any recovery source stays. Each rule prints its cell count. */
const HA_CHANGES = BB.HOLD_CHANGES.filter(ch => !/rebuilt/.test(ch));
for (const how of BB.HOLD_PATHS) for (const ch of HA_CHANGES) rule('HA: ' + how + ' on a fulfilled spread\'s loop, ' + ch + ' while a read of its guard waits, writes nothing', async () => {
  const r = await BB.suspension(bbSpread, how, [ch]);
  console.log('HA cells · a fulfilled spread\'s loop · ' + how + ' · ' + ch + ' · ran ' + r.applicable + ' of ' + r.todo + ' it can see (' + r.required + ' read the change), of ' + r.cells + ' cells');
  assert.deepStrictEqual(r.off, []);
});
run();
