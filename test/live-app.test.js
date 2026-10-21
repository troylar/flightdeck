// 1.19 slice 2 in the built app: your AI assistant's change appears live in the main open editor. A watcher looks every 2 s
// of elapsed time (a clock the test moves), the change goes through the same acceptance transaction as Apply, it's one
// Undo entry, and the app saves it with its checked save. Races are paused at exact points.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, gate, bus, locks } = require('./app-harness');

const DRAFT = 'maps/drafts/release.md';
const FLAGS = 'Feature flags set in the deploy values';
/* A window with the release draft open in the editor (Markdown unless builder), on a clock the test moves. */
async function live(opts) {
  opts = opts || {};
  const clock = { t: 1000 };
  const app = boot(Object.assign({ localStore: { 'preflight:builder': opts.builder ? 'true' : 'false' }, performance: { now: () => clock.t } }, opts));
  await app.tick(60); app.choose(opts.me || 'person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  if (opts.edit !== false) { app.click('ptab', 'edit'); await app.tick(); }
  app.clock = clock;
  /* Time passes (2.1 s by default) and the app's timers run once: presence, the watcher, refreshes. */
  app.watch = async (ms, n) => { clock.t += ms == null ? 2100 : ms; app.every(); await app.tick(n == null ? 200 : n); };
  return app;
}
/* A proposal written the way flightdeck draft writes one while the draft is open. */
function plant(app, o) {
  const base = o.base != null ? o.base : app.fs.files[DRAFT].t;
  const p = app.PF.proposals.make(Object.assign({ id: 'p-mh4k2a-x7w1k3m9p2', process: 'release', session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: new Date().toISOString(), app: '1.19.0', replaces: null, after: null, note: 'A change' }, o,
    { base: o.baseObj || { kind: 'draft', ref: DRAFT, text: base } }));
  app.fs.files['proposed/release/' + p.id + '.json'] = { t: JSON.stringify(p, null, 2), m: Date.now() };
  return p;
}
const retitle = (t, title) => t.replace('title: Production release', 'title: ' + title);
const recs = (app, id) => Object.keys(app.fs.files).filter(p => p.indexOf('proposed/release/' + id + '.') === 0 && p !== 'proposed/release/' + id + '.json').map(p => JSON.parse(app.fs.files[p].t));
const statuses = (app, id) => recs(app, id).filter(r => r.kind === 'proposal-decision').sort((a, b) => a.decisionRev - b.decisionRev).map(r => r.status);
const attempts = (app, id) => recs(app, id).filter(r => r.kind === 'proposal-attempt');
const said = (app, re) => re.test(app.html()) || re.test(app.live());
/* Every text written to #live, in order. */
function liveLog(app) { const el = app.el('live'), log = []; let t = el.textContent || ''; Object.defineProperty(el, 'textContent', { configurable: true, get: () => t, set: v => { t = v; log.push(v); } }); return log; }
/* Pause the attempt while it's created, or while it's read back. */
function pausedAttempt(app, when) {
  const g = gate(), write = app.fs.write.bind(app.fs), read = app.fs.read.bind(app.fs);
  let reads = 0;
  if (when === 'create') app.fs.write = (p, t) => /\.attempt\./.test(p) ? g.p.then(() => write(p, t)) : write(p, t);
  else app.fs.read = (p, o) => { const r = read(p, o); if (/\.attempt\./.test(p) && ++reads === 2) return r.then(v => g.p.then(() => v)); return r; };
  return { g, restore() { app.fs.write = write; app.fs.read = read; } };
}

rule('Live: a fast-forward proposal appears in the open editor within one look, highlighted, saved as its exact text; one Undo takes it back as unsaved', async () => {
  const app = await live({ builder: true }), A = app.fs.files[DRAFT].t, B = A.replace(FLAGS, 'Feature flags checked by your AI assistant'), log = liveLog(app);
  const p = plant(app, { text: B });
  await app.watch();
  assert.strictEqual(app.fs.files[DRAFT].t, B, 'saved: the proposal\'s exact text');
  assert.deepStrictEqual(attempts(app, p.id).map(a => a.how), ['live']);
  assert.deepStrictEqual(statuses(app, p.id), ['applied']);
  const hist = Object.keys(app.fs.files).filter(x => x.indexOf('history/drafts/release/') === 0).map(x => app.fs.files[x].t).join('\n');
  assert.ok(/"source":"proposal"/.test(hist), 'History: changed by your AI assistant, applied in Flightdeck');
  assert.ok(/class="ob-step[^"]*\bob-inc\b[^"]*"[^>]*data-ob-step="flags"/.test(app.html()), 'the changed step is highlighted');
  assert.ok(/Changed by your AI assistant/.test(app.html()), 'with the words, not only a color');
  assert.strictEqual(log.filter(t => /Your AI assistant changed this draft: 1 step changed\. Undo available\./.test(t)).length, 1, 'announced once: ' + JSON.stringify(log));
  assert.ok(/data-act="tl-undo" data-id="draft"/.test(app.html()) && /Saved/.test(app.html()));
  app.click('tl-undo', 'draft'); await app.tick(60);
  assert.ok(/Unsaved: Save draft before you publish/.test(app.html()), 'Undo makes the draft unsaved; it never writes it');
  assert.strictEqual(app.fs.files[DRAFT].t, B);
  assert.ok(new RegExp(FLAGS).test(app.html()), 'the editor shows the text before the change');
  assert.ok(!/\bob-inc\b/.test(app.html()), 'no highlight once taken back');
  assert.deepStrictEqual(statuses(app, p.id), ['applied'], 'still applied');
  await app.watch(); await app.watch();
  assert.strictEqual(attempts(app, p.id).length, 1, 'never applied again');
});

rule('Live: an Undo before the save starts cancels it: withdrawn, the draft untouched, and never applied again on its own', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t, B = retitle(A, 'B'), p = plant(app, { text: B });
  const g = gate(), list = app.PF.repo.listRecords; let n = 0;
  // Calls: the first look, the look inside the lock, right before adopting, then when the queued save starts (held here).
  app.PF.repo.listRecords = function () { const r = list.apply(this, arguments); return ++n === 4 ? g.p.then(() => r) : r; };
  await app.watch();
  assert.ok(/title: B/.test(app.html()), 'adopted in the editor');
  app.click('tl-undo', 'draft'); await app.tick(40);
  g.open(); await app.tick(200); app.PF.repo.listRecords = list;
  assert.strictEqual(app.fs.files[DRAFT].t, A, 'nothing written');
  assert.deepStrictEqual(statuses(app, p.id), ['withdrawn']);
  assert.ok(said(app, /You took back your AI assistant.s change\. It.s listed on the process page if you want it later\./));
  assert.ok(!/Unsaved: Save draft before you publish/.test(app.html()) && /title: Production release/.test(app.html()), 'the editor is back as it was, nothing unsaved');
  await app.watch(); await app.watch();
  assert.strictEqual(attempts(app, p.id).length, 1, 'not applied again');
  assert.ok(/Your AI assistant proposed changes\./.test(app.html()), 'it waits for Review');
});

rule('Live: an Undo after the save started is an ordinary edit: the change is saved and applied, and the editor holds the earlier text, unsaved', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t, B = retitle(A, 'B'), p = plant(app, { text: B });
  const g = gate(), write = app.fs.write.bind(app.fs);
  let held = false;
  app.fs.write = (path, t) => { if (/^maps\/drafts\//.test(path) && !held) { held = true; return g.p.then(() => write(path, t)); } return write(path, t); };
  await app.watch(); await app.tick(40);
  assert.ok(held, 'the save started');
  app.click('tl-undo', 'draft'); await app.tick(40);
  g.open(); await app.tick(200); app.fs.write = write;
  assert.strictEqual(app.fs.files[DRAFT].t, B, 'saved');
  assert.deepStrictEqual(statuses(app, p.id), ['applied']);
  assert.ok(/Unsaved: Save draft before you publish/.test(app.html()) && /title: Production release/.test(app.html()), 'the undone text stays, unsaved');
  app.click('save-draft'); await app.tick(120);
  assert.strictEqual(app.fs.files[DRAFT].t, A, 'saving it is the person\'s own change');
});

['create', 'read back'].forEach(when => {
  rule('Live, counterexample: typing while the attempt is ' + (when === 'create' ? 'written' : 'read back') + ' keeps the person\'s text; the outcome is cancelled', async () => {
    const app = await live(), A = app.fs.files[DRAFT].t, p = plant(app, { text: retitle(A, 'B') });
    const pause = pausedAttempt(app, when);
    await app.watch(); await app.tick(20);
    assert.strictEqual(attempts(app, p.id).length + (when === 'create' ? 1 : 0) >= 1, true);
    app.input('draft-editor', retitle(A, 'Typed meanwhile')); await app.tick(40);
    pause.g.open(); await app.tick(200); pause.restore();
    assert.strictEqual(app.fs.files[DRAFT].t, A);
    assert.ok(/title: Typed meanwhile/.test(app.html()) && /Unsaved: Save draft before you publish/.test(app.html()));
    assert.deepStrictEqual(statuses(app, p.id), ['cancelled']);
  });
});

rule('Live, counterexample: text waiting in a builder box: the proposal waits, the notice says why, and it\'s announced once', async () => {
  const app = await live({ builder: true }), A = app.fs.files[DRAFT].t, log = liveLog(app);
  app.click('ob-sel', 'flags'); await app.tick();
  app.setScoped('ob-text', 'Typed words'); app.input('ob-text', 'Typed words'); await app.tick();
  const p = plant(app, { text: retitle(A, 'B') });
  await app.watch(); await app.watch(); await app.watch();
  assert.strictEqual(app.fs.files[DRAFT].t, A);
  assert.deepStrictEqual(recs(app, p.id), [], 'no attempt');
  assert.strictEqual(app.draft('ob-text'), 'Typed words');
  assert.ok(/Your AI assistant proposed changes while you have unsaved ones\. They.ll wait for you to review them\./.test(app.html()));
  assert.strictEqual(log.filter(t => /Your AI assistant proposed changes/.test(t)).length, 1, 'announced once: ' + JSON.stringify(log));
  assert.ok(!/<div class="notice"[^>]*role=[^>]*><span>Your AI assistant proposed/.test(app.html()), 'the notice itself has no live role');
});

rule('Live, counterexample: an input method composing: nothing is applied until it ends', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t, B = retitle(A, 'B'), p = plant(app, { text: B });
  app.fire('compositionstart', {}); await app.tick();
  await app.watch(); await app.watch();
  assert.deepStrictEqual(recs(app, p.id), [], 'nothing while composing');
  assert.strictEqual(app.fs.files[DRAFT].t, A);
  app.fire('compositionend', { target: {} }); await app.tick();
  await app.watch();
  assert.strictEqual(app.fs.files[DRAFT].t, B, 'applied once the composition ended');
});

rule('Live, counterexample: switching folders while the attempt is written: cancelled in the folder it started in, nothing saved anywhere', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t, p = plant(app, { text: retitle(A, 'B') }), old = app.fs;
  const pause = pausedAttempt(app, 'create');
  await app.watch(20, 40);
  app.click('reset-examples'); await app.tick(80);
  pause.g.open(); await app.tick(200); pause.restore();
  assert.strictEqual(old.files[DRAFT].t, A);
  assert.ok(Object.keys(old.files).some(k => k.indexOf('proposed/release/' + p.id + '.') === 0 && /"cancelled"/.test(old.files[k].t)), 'cancelled in the old folder');
});

[true, false].forEach(withLocks => {
  rule('Live, counterexample (' + (withLocks ? 'with Web Locks' : 'without Web Locks') + '): window 2 checked and stalled; window 1 applied, the person undid it and saved A; window 2 resumes and never puts B back', async () => {
    const files = {}, L = locks(), Channel = bus(), g = gate();
    const held = { request(name, fn) { return g.p.then(() => L.request(name, fn)); } };
    const w2 = await live({ sharedFiles: files, locks: withLocks ? held : undefined, Channel, me: 'person-blake' });
    const A = files[DRAFT].t, B = retitle(A, 'B');
    let restore = () => {};
    if (!withLocks) { const write = w2.fs.write.bind(w2.fs); w2.fs.write = (path, t) => /\.attempt\./.test(path) ? g.p.then(() => write(path, t)) : write(path, t); restore = () => { w2.fs.write = write; }; }
    const p = plant(w2, { text: B });
    await w2.watch();
    assert.strictEqual(files[DRAFT].t, A, 'window 2 is stalled');
    const w1 = await live({ sharedFiles: files, locks: withLocks ? L : undefined, Channel });
    w1.click('ed-done'); await w1.tick(); w1.click('refresh'); await w1.tick(120);
    w1.click('ptab', 'edit'); await w1.tick();
    w1.click('prop-apply', p.id); await w1.tick(200);
    assert.strictEqual(files[DRAFT].t, B, 'window 1 applied it');
    w1.click('tl-undo', 'draft'); await w1.tick(40);
    w1.click('save-draft'); await w1.tick(120);
    assert.strictEqual(files[DRAFT].t, A, 'the person took it back and saved');
    g.open(); await w2.tick(300); restore();
    assert.strictEqual(files[DRAFT].t, A, 'window 2 found window 1\'s attempt and stopped');
    const rs = recs(w2, p.id);
    assert.strictEqual(rs.filter(r => r.status === 'applied').length, 1, 'applied once');
    if (!withLocks) assert.ok(rs.some(r => r.status === 'cancelled'), 'window 2\'s own attempt: cancelled');
    else assert.strictEqual(rs.filter(r => r.kind === 'proposal-attempt').length, 1, 'window 2 made no attempt');
  });
});

rule('Live: a second proposal arriving during an apply waits its turn and is judged on the result: one from the old draft waits, one that follows is applied next, each its own Undo', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t, B = retitle(A, 'B'), C = retitle(A, 'C');
  const p1 = plant(app, { id: 'p-a1-aaaaaaaaaa', text: B });
  const pause = pausedAttempt(app, 'create');
  await app.watch(20, 40);
  const p2 = plant(app, { id: 'p-a2-bbbbbbbbbb', text: retitle(A, 'Other'), at: new Date(Date.now() + 1000).toISOString() });
  const p3 = plant(app, { id: 'p-a3-cccccccccc', text: C, after: p1.id, at: new Date(Date.now() + 2000).toISOString(), baseObj: { kind: 'proposal', ref: p1.id, text: B } });
  await app.watch();
  pause.g.open(); await app.tick(200); pause.restore();
  assert.strictEqual(app.fs.files[DRAFT].t, B, 'the first applied alone');
  await app.watch(); await app.watch();
  assert.strictEqual(app.fs.files[DRAFT].t, C, 'the one that follows it is a fast-forward now');
  assert.deepStrictEqual(recs(app, p2.id), [], 'the one from the old draft waits for Review');
  assert.ok(/Your AI assistant proposed changes\./.test(app.html()));
  app.click('tl-undo', 'draft'); await app.tick(40);
  assert.ok(/title: B/.test(app.html()), 'one Undo takes back the second');
  app.click('tl-undo', 'draft'); await app.tick(40);
  assert.ok(/title: Production release/.test(app.html()), 'another, the first');
  assert.strictEqual(app.fs.files[DRAFT].t, C, 'Undo never writes the draft');
  assert.ok(p3);
});

rule('Live: two equal claims to be the main editor are ambiguous and pause live apply in both windows until someone claims again', async () => {
  const files = {}, L = locks(), Channel = bus();
  const w1 = await live({ sharedFiles: files, locks: L, Channel });
  const w2 = await live({ sharedFiles: files, locks: L, Channel, me: 'person-avery' });
  await w1.watch(); await w2.watch();
  w1.click('main-editor'); w2.click('main-editor'); await w1.tick(80); await w2.tick(80);
  const A = files[DRAFT].t, p = plant(w1, { text: retitle(A, 'B') });
  await w1.watch(10100); await w2.watch(10100); await w1.watch(); await w2.watch();
  assert.ok(/Two editors claimed this draft at once/.test(w1.html()), w1.html().match(/fpe-alerts[\s\S]{0,800}/));
  assert.strictEqual(files[DRAFT].t, A, 'neither applied it');
  assert.deepStrictEqual(recs(w1, p.id), []);
  assert.ok(/Your AI assistant proposed changes\./.test(w2.html()));
  w2.click('main-editor'); await w2.tick(80);
  await w1.watch(10100); await w2.watch(10100); await w2.watch();
  assert.ok(/This is the main editor for this draft\./.test(w2.html()));
  assert.strictEqual(files[DRAFT].t, retitle(A, 'B'), 'the window that claimed last applied it');
  assert.ok(/title: B/.test(w2.html()));
  assert.deepStrictEqual(attempts(w2, p.id).map(a => a.how), ['live']);
});

rule('Live: without a recent look at presence/ (it couldn\'t be listed, or the window was asleep), nothing is applied until a fresh look', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t, B = retitle(A, 'B'), list = app.fs.list.bind(app.fs);
  let fail = true;
  app.fs.list = p => fail && /^presence/.test(p) ? Promise.reject(new Error('OneDrive is offline')) : list(p);
  const p = plant(app, { text: B });
  await app.watch(25000);
  assert.deepStrictEqual(recs(app, p.id), [], 'presence/ last listed over 20 s ago: no live apply');
  assert.ok(/Your AI assistant proposed changes\./.test(app.html()));
  fail = false;
  await app.watch();
  assert.strictEqual(app.fs.files[DRAFT].t, B, 'applied once presence/ was listed again');
  // A hidden tab doesn't look at all.
  const C = retitle(A, 'C'), p2 = plant(app, { id: 'p-a2-bbbbbbbbbb', text: C, base: B });
  app.doc.hidden = true;
  await app.watch(); await app.watch();
  assert.deepStrictEqual(recs(app, p2.id), [], 'hidden: nothing');
  app.doc.hidden = false;
  await app.watch(25000);
  assert.strictEqual(app.fs.files[DRAFT].t, C);
});

rule('Live: a window that isn\'t the main editor leaves it waiting, with Review, and the main editor applies it', async () => {
  const files = {}, L = locks(), Channel = bus();
  const w1 = await live({ sharedFiles: files, locks: L, Channel });
  const w2 = await live({ sharedFiles: files, locks: L, Channel, me: 'person-avery' });
  await w1.watch(); await w2.watch();
  w1.click('main-editor'); await w1.tick(80);
  await w2.watch(10100);
  const A = files[DRAFT].t, p = plant(w1, { text: retitle(A, 'B') });
  await w2.watch(); await w2.watch();
  assert.deepStrictEqual(recs(w2, p.id), [], 'not the main editor: it waits');
  assert.ok(/Your AI assistant proposed changes\./.test(w2.html()) && /data-act="prop-review"/.test(w2.html()));
  await w1.watch(10100);
  assert.strictEqual(files[DRAFT].t, retitle(A, 'B'), 'the main editor applied it');
  await w2.watch(); await w2.watch();
  assert.ok(/title: B/.test(w2.html()) && !/Unsaved: Save draft before you publish/.test(w2.html()), 'the other editor follows it');
});

rule('Following the folder: an editor with nothing unsaved takes a newer draft as one undoable, announced change, not a barrier', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t, B = retitle(A, 'Theirs');
  await app.fs.write(DRAFT, B);
  await app.watch(); await app.watch();
  assert.ok(/title: Theirs/.test(app.html()) && !/Unsaved: Save draft before you publish/.test(app.html()), 'follows it');
  assert.ok(said(app, /This draft changed in the team folder\. Undo available\./));
  assert.ok(!/aria-disabled="true"[^>]*data-act="tl-undo"|data-act="tl-undo" data-id="draft" aria-disabled="true"/.test(app.html()), 'Undo is available');
  app.click('tl-undo', 'draft'); await app.tick(40);
  assert.ok(/title: Production release/.test(app.html()) && /Unsaved: Save draft before you publish/.test(app.html()), 'one Undo: the earlier text, unsaved');
  assert.strictEqual(app.fs.files[DRAFT].t, B, 'Undo never writes the draft');
});

rule('Apply on the process page with the editor open and nothing unsaved: one Undo entry in the editor, no barrier', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t, B = retitle(A, 'B'), p = plant(app, { text: B });
  app.click('prop-apply', p.id); await app.tick(200);
  assert.strictEqual(app.fs.files[DRAFT].t, B);
  assert.ok(/title: B/.test(app.html()) && !/Unsaved: Save draft before you publish/.test(app.html()));
  app.click('tl-undo', 'draft'); await app.tick(40);
  assert.ok(/title: Production release/.test(app.html()) && /Unsaved: Save draft before you publish/.test(app.html()), 'Undo takes it back as an unsaved edit');
});

rule('Live: an open dialog keeps focus and stays open while a change arrives', async () => {
  const app = await live({ builder: true }), A = app.fs.files[DRAFT].t;
  app.click('hist-open', 'draft'); await app.tick();
  assert.ok(/role="dialog"/.test(app.overlay()));
  const before = app.asked().length;
  plant(app, { text: A.replace(FLAGS, 'Flags, changed') });
  await app.watch();
  assert.ok(/Flags, changed/.test(app.fs.files[DRAFT].t));
  assert.ok(/role="dialog"/.test(app.overlay()), 'the dialog is still open');
  assert.ok(!app.asked().slice(before).some(s => s === 'ed-h' || /ob-sel/.test(s || '')), 'focus wasn\'t moved to the page: ' + app.asked().slice(before));
});

rule('The watcher: one listing of proposed/<process>/ and one stat of the draft every 2 s while the editor is on screen; presence/ every 10 s; nothing off screen', async () => {
  const app = await live(), list = app.fs.list.bind(app.fs), stat = app.fs.stat.bind(app.fs), read = app.fs.read.bind(app.fs), calls = [];
  app.fs.list = p => { calls.push('list ' + p); return list(p); };
  app.fs.stat = p => { calls.push('stat ' + p); return stat(p); };
  app.fs.read = (p, o) => { calls.push('read ' + p); return read(p, o); };
  await app.watch(); await app.watch(); calls.length = 0;
  await app.watch(2100);
  assert.deepStrictEqual(calls.filter(c => !/^(list|read) presence|^read presence/.test(c)).sort(), ['list proposed/release', 'stat ' + DRAFT].sort(), JSON.stringify(calls));
  calls.length = 0;
  await app.watch(1000);
  assert.deepStrictEqual(calls.filter(c => /proposed|drafts/.test(c)), [], 'not before 2 s');
  app.click('ed-done'); await app.tick(); calls.length = 0;
  await app.watch(); await app.watch();
  assert.deepStrictEqual(calls.filter(c => /proposed\/release|maps\/drafts/.test(c)), [], 'off screen: nothing');
});

/* ---------- review of b8d7268 ---------- */
rule('Review: an older full refresh finishing late never puts back presence older than what the watcher saw: a newer claim elsewhere keeps this window from applying', async () => {
  const files = {}, L = locks(), Channel = bus();
  const w1 = await live({ sharedFiles: files, locks: L, Channel });
  const w2 = await live({ sharedFiles: files, locks: L, Channel, me: 'person-avery' });
  await w1.watch(); await w2.watch();
  w1.click('main-editor'); await w1.tick(80);
  await w2.watch(10100); await w1.watch(10100);
  assert.ok(/This is the main editor for this draft\./.test(w1.html()), 'set-up: window 1 is main');
  // Window 1 starts a full refresh; its read of window 2's presence is held, with what it said then.
  const read = w1.fs.read.bind(w1.fs), g = gate(); let armed = true;
  w1.fs.read = (p, o) => { const r = read(p, o); if (armed && /^presence\//.test(p) && files[p] && JSON.parse(files[p].t).by === 'person-avery') { armed = false; return r.then(v => g.p.then(() => v)); } return r; };
  w1.click('refresh'); await w1.tick(20);
  w2.click('main-editor'); await w2.tick(80);
  await w1.watch(10100);
  assert.ok(!/This is the main editor for this draft\./.test(w1.html()), 'the watcher saw window 2\'s newer claim');
  const A = files[DRAFT].t, p = plant(w1, { text: retitle(A, 'B') });
  g.open(); await w1.tick(200); w1.fs.read = read;
  await w1.watch(); await w1.watch();
  assert.deepStrictEqual(recs(w1, p.id), [], 'window 1 applied nothing: window 2 is the main editor');
  assert.strictEqual(files[DRAFT].t, A);
});

rule('Review: when the save starts, live apply is checked again in full: hidden by then, nothing is saved, the change stays in the editor unsaved, and the outcome is recorded', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t, B = retitle(A, 'B'), p = plant(app, { text: B });
  const g = gate(), list = app.PF.repo.listRecords; let n = 0;
  app.PF.repo.listRecords = function () { const r = list.apply(this, arguments); return ++n === 4 ? g.p.then(() => r) : r; };
  await app.watch();
  assert.ok(/title: B/.test(app.html()), 'adopted');
  app.doc.hidden = true;
  g.open(); await app.tick(200); app.PF.repo.listRecords = list;
  assert.strictEqual(app.fs.files[DRAFT].t, A, 'no hidden save');
  assert.deepStrictEqual(statuses(app, p.id), ['cancelled']);
  app.doc.hidden = false; app.click('dismiss'); await app.tick();
  assert.ok(/title: B/.test(app.html()) && /Unsaved: Save draft before you publish/.test(app.html()), 'the change stays in the editor, unsaved');
  assert.ok(/Your AI assistant proposed changes while you have unsaved ones/.test(app.html()), 'with the waiting notice');
});

rule('Review: a save written, then replaced by another change before its read-back says so (never "Nothing was saved"), with its own outcome', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t, B = retitle(A, 'B'), C = retitle(A, 'Someone else'), p = plant(app, { text: B });
  const write = app.fs.write.bind(app.fs); let done = false;
  app.fs.write = (path, t) => write(path, t).then(v => { if (path === DRAFT && !done) { done = true; return write(DRAFT, C).then(() => v); } return v; });
  await app.watch(); await app.tick(100); app.fs.write = write;
  assert.strictEqual(app.fs.files[DRAFT].t, C);
  assert.deepStrictEqual(statuses(app, p.id), ['overwritten']);
  assert.ok(/Your save was written, then replaced by another change\. Compare them below/.test(app.html()), app.html().match(/fpe-alerts[\s\S]{0,600}/));
  assert.ok(!/Nothing was saved/.test(app.html()));
});

rule('Review: a step moved to another phase, or phases reordered, is highlighted and said as a move', async () => {
  const app = await live({ builder: true }), A = app.fs.files[DRAFT].t, PP = app.PF.proposals;
  const flags = A.split('\n').filter(l => /\{#flags\}/.test(l))[0];
  const o = app.PF.outline.parse(A), fl = o.steps.filter(s => s.key === 'flags')[0], lines = A.split('\n');
  const block = lines.slice(fl.line, fl.end), rest = lines.slice(0, fl.line).concat(lines.slice(fl.end));
  const last = app.PF.outline.parse(rest.join('\n')).phases.slice(-1)[0], at = last.contentEnd != null ? last.contentEnd : rest.length;
  const moved = rest.slice(0, at).concat(block, rest.slice(at)).join('\n');
  const c = PP.changes(A, moved);
  assert.ok(flags && c.keys.indexOf('step:flags') >= 0, JSON.stringify(c));
  assert.ok(/1 step moved/.test(PP.changeWords(c)), PP.changeWords(c));
  plant(app, { text: moved });
  await app.watch();
  assert.strictEqual(app.fs.files[DRAFT].t, moved);
  assert.ok(/class="ob-step[^"]*\bob-inc\b[^"]*"[^>]*data-ob-step="flags"/.test(app.html()), 'the moved step is highlighted');
  assert.ok(/1 step moved/.test(app.live()), app.live());
  const ph = app.PF.outline.parse(A).phases, L = A.split('\n'), p0 = ph[0], p1 = ph[1];
  const swapped = L.slice(0, p0.line).concat(L.slice(p1.line, p1.regionEnd), L.slice(p0.line, p1.line), L.slice(p1.regionEnd)).join('\n');
  assert.ok(/phase(s)? moved/.test(PP.changeWords(PP.changes(A, swapped))), PP.changeWords(PP.changes(A, swapped)));
});

rule('Review: proposals the watcher already read stay read: one more arriving costs one proposal read, not all of them again', async () => {
  const app = await live(), A = app.fs.files[DRAFT].t;
  await app.watch(); await app.watch();
  const read = app.fs.read.bind(app.fs), reads = [];
  app.fs.read = (p, o) => { if (/^proposed\/release\/p-[^.]+\.json$/.test(p)) reads.push(p); return read(p, o); };
  for (let i = 0; i < 5; i++) plant(app, { id: 'p-b' + i + '-aaaaaaaaaa', text: retitle(A, 'X' + i), base: retitle(A, 'Y') });
  await app.watch();
  assert.strictEqual(reads.length, 5, 'set-up: the watcher read the five: ' + JSON.stringify(reads));
  reads.length = 0;
  plant(app, { id: 'p-b9-aaaaaaaaaa', text: retitle(A, 'X9'), base: retitle(A, 'Y') });
  await app.watch();
  assert.deepStrictEqual(reads, ['proposed/release/p-b9-aaaaaaaaaa.json']);
});

run();
