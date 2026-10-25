// Big folders in the app (2.5.0): a refresh finds each run directly instead of comparing every run with every other, a run
// that can't be read is noted without copying every status, and a first open draws a few times instead of once per batch.
// Counted in operations (PF.perf), with a stepped clock for redraws; the browser gate times the same paths.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const { boot, folderHandle, memoryIDB } = require('./app-harness');
const { generate } = require('../tools/big-folder');

const N = 2000;
function clocks() {
  let off = 0, t = 1000;
  class D extends Date { constructor(...a) { if (a.length) super(...a); else super(Date.now() + off); } static now() { return Date.now() + off; } }
  return { D, perf: { now: () => t }, ahead(ms) { off += ms; t += ms; } };
}
/* The examples' in-browser folder, filled with the synthetic big folder. Listing is by an index (rebuilt after any change), so
   the test's own folder doesn't cost what it measures. */
function fill(app, n) {
  /* Added to the examples' own files, so nothing already shown goes missing. */
  const g = generate(app.PF, { runs: n, running: Math.round(n / 40), recent: Math.round(n / 20) }), fs = app.fs, files = Object.assign({}, fs.files);
  Object.keys(g.files).forEach(p => { files[p] = { t: g.files[p], m: g.mtimes[p] }; });
  fs.files = files; fs.persist = () => true;
  let idx = null;
  const proto = Object.getPrototypeOf(fs);
  ['write', 'append', 'remove', 'reset'].forEach(m => { const f = proto[m]; fs[m] = function () { idx = null; return f.apply(this, arguments); }; });
  fs.list = function (path) {
    if (!idx) { idx = new Map(); Object.keys(this.files).forEach(p => { const parts = p.split('/'); for (let i = 0; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); if (!idx.has(d)) idx.set(d, new Map()); const m = idx.get(d); if (!m.has(parts[i])) m.set(parts[i], i < parts.length - 1 ? 'dir' : 'file'); } }); }
    const d = idx.get(path || ''); return Promise.resolve(d ? [...d].map(([name, kind]) => ({ name, kind })) : []);
  };
  return Object.keys(files).filter(p => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(p)).length;
}
/* Waits for the read under way to finish: the app counts each finished folder read (load.done). */
async function settle(app, since, max) { for (let i = 0; i < (max || 600); i++) { await app.tick(5); if ((app.PF.perf.n['load.done'] || 0) > since) return; } throw new Error('the read never finished'); }
const loads = app => app.PF.perf.n['load.done'] || 0;
async function bigApp(opts) {
  const k = clocks();
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' }, Date: k.D, performance: k.perf }, opts || {})); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const runs = fill(app, N);
  app.PF.perf.reset();
  app.click('refresh'); await settle(app, 0);
  app.click('nav', 'runs'); await app.tick(10);
  return { app, k, runs };
}
const count = (app, k) => app.PF.perf.n[k] || 0;

rule('A refresh of a 2,000-run folder finds each run directly: lookups grow with the runs, not with their square', async () => {
  const { app, k, runs } = await bigApp();
  assert.ok(runs >= 1990, 'set-up: the runs are there: ' + runs);
  assert.ok(app.PF.perf, 'PF.perf counts work');
  /* A routine refresh (cached reads mostly), then Refresh (every file read fresh). */
  for (const [what, go] of [['routine', () => { k.ahead(31000); app.every(); }], ['Refresh', () => app.click('refresh')]]) {
    app.PF.perf.reset();
    go(); await settle(app, 0);
    const seen = count(app, 'runs.inspected'), rebuilt = count(app, 'runs.rebuilds'), dedupe = count(app, 'runs.dedupe');
    assert.ok(seen >= runs, what + ': every run is looked up (counted): ' + seen);
    assert.ok(seen <= 5 * runs, what + ': entries inspected ' + seen + ' ≤ 5 × runs (' + 5 * runs + '); a scan per run is about ' + runs * runs / 2);
    assert.ok(rebuilt <= 2, what + ': the index is built at most twice: ' + rebuilt);
    assert.ok(dedupe <= 3 * runs, what + ': each key is noted once from each side: ' + dedupe);
  }
});

rule('A refresh that reads every run again keeps how to rebuild each one, without copying any run to text', async () => {
  const { app, runs } = await bigApp();
  app.PF.perf.reset();
  app.click('refresh'); await settle(app, 0);
  assert.ok(count(app, 'batch.applied') > 0 || count(app, 'load.done') > 0, 'set-up: the refresh finished');
  assert.strictEqual(count(app, 'baseline.copied'), 0, 'runs copied to text for Discard: ' + count(app, 'baseline.copied') + ' of ' + runs);
});

rule('Two thousand runs that can\'t be read, then read again, change their status in place, without copying the status maps', async () => {
  const { app, k } = await bigApp();
  const files = Object.keys(app.fs.files).filter(p => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(p));
  /* The big folder has a few runs broken on purpose; they stay unreadable throughout. */
  const broken = Object.keys(app.PF.perf.maps().unread || {}).sort();
  /* Like OneDrive placeholders: every run file refuses to be read, for one Refresh. */
  const read = app.fs.read.bind(app.fs);
  app.fs.read = (p, o) => (files.indexOf(p) >= 0 ? Promise.reject(Object.assign(new Error('The cloud file provider is not running.'), { name: 'NotReadableError' })) : read(p, o));
  /* The status maps as they stand before any read fails: a copy anywhere would be a new object. */
  const maps = app.PF.perf.maps();
  assert.ok(maps.unread && maps.missing, 'set-up: both status maps are there before the refresh');
  app.PF.perf.reset();
  app.click('refresh'); await settle(app, 0);
  const during = app.PF.perf.maps();
  assert.ok(during.unread === maps.unread && during.missing === maps.missing, 'the same two maps while every read fails: changed in place, never copied');
  assert.ok(maps.unread && Object.keys(maps.unread).length >= files.length, 'set-up: every run is noted as unreadable: ' + Object.keys(maps.unread || {}).length);
  const html = app.html();
  assert.ok(/couldn(&#39;|')t be read/.test(html) || /can(&#39;|')t be read/.test(html), 'they show as unreadable');
  assert.ok(!/is gone from the team folder/.test(html), 'and none as gone');
  app.fs.read = read;
  app.PF.perf.reset();
  app.click('refresh'); await settle(app, 0);
  assert.ok(!/couldn(&#39;|')t be read on the last check/.test(app.html()), 'they read again');
  const after = app.PF.perf.maps();
  assert.ok(after.unread === maps.unread && after.missing === maps.missing, 'the same two maps throughout: changed in place, never copied');
  assert.deepStrictEqual(Object.keys(after.unread).sort(), broken, 'and every run is off the unreadable list but the ones broken on purpose');
});

/* A real team folder (the picker's), filled with the synthetic folder, whose run files the test can hold back so a first
   open arrives in batches it lets go of. Booted with stepped timers, so a waiting redraw only lands when the test says. */
async function pickerApp(n, opts) {
  const k = clocks(), files = {};
  const g = generate(load(), Object.assign({ runs: n, running: Math.round(n / 40), recent: Math.round(n / 20) }, (opts || {}).gen));
  Object.keys(g.files).forEach(p => { files[p] = g.files[p]; });
  let folder = withBytes(folderHandle('Big', files));
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' }, Date: k.D, performance: k.perf, timers: true, replace: true, picker: () => folder, indexedDB: memoryIDB() }, opts || {})); await app.tick(60);
  app.choose('person-casey'); await app.tick();
  const proto = app.PF.fs.FolderFS.prototype, read = proto.read, held = [];
  let hold = null;
  proto.read = function (p) { if (hold && hold.test(p)) return new Promise(res => held.push(() => res(read.call(this, p)))); return read.call(this, p); };
  app.PF.repo.config.batch = 20;
  return { app, k, files, held, holdRuns(re) { hold = re; }, nextFolder(name, more) { folder = withBytes(folderHandle(name, more)); }, release(m) { held.splice(0, m == null ? held.length : m).forEach(f => f()); }, restore() { proto.read = read; } };
}
/* folderHandle's files, with arrayBuffer() as a real File has it (a save hashes the bytes it reads back). */
function withBytes(dir) {
  return Object.assign({}, dir, {
    getDirectoryHandle: (n, o) => dir.getDirectoryHandle(n, o).then(withBytes),
    getFileHandle: (n, o) => dir.getFileHandle(n, o).then(fh => Object.assign({}, fh, { getFile: () => fh.getFile().then(f => Object.assign({}, f, { arrayBuffer: () => f.text().then(t => new TextEncoder().encode(t).buffer) })) }))
  });
}
const RUNS = /^runs\/[^/]+\/[^/]+\/run\.json$/;
/* Lets held run files go until the next batch lands (the reader keeps 8 in flight, so a batch takes a few releases). */
async function nextBatch(f) {
  const app = f.app, was = count(app, 'batch.applied');
  for (let i = 0; i < 200 && count(app, 'batch.applied') === was; i++) { f.release(); await app.tick(3); }
  assert.ok(count(app, 'batch.applied') > was, 'set-up: a batch landed');
}
const waiting = app => app.pendingTimers().some(t => t.in > 0 && t.in <= 250);

rule('A first open draws once as runs start to arrive, then at most every quarter second, not once per batch', async () => {
  const f = await pickerApp(400), app = f.app;
  app.PF.perf.reset();
  app.click('connect');
  /* Every batch arrives in one go (nothing held): one draw for the first, the rest wait for one later draw. */
  for (let i = 0; i < 600 && !loads(app); i++) await app.tick(2);
  assert.ok(loads(app) > 0, 'set-up: the read finished');
  const batches = count(app, 'batch.applied'), drawn = count(app, 'batch.renders');
  assert.ok(batches >= 15, 'set-up: many batches arrived: ' + batches);
  assert.ok(drawn <= 2, 'batch draws during a burst of ' + batches + ' batches: ' + drawn);
  assert.ok(!/Still reading runs/.test(app.html()), 'the complete result draws at once');
  app.PF.perf.reset();
  app.advanceTimers(1000); await app.tick(5);
  assert.strictEqual(count(app, 'batch.renders'), 0, 'and the batch draw it overtook never lands');
  f.restore();
});

rule('Batches arriving slowly each draw, with their own count', async () => {
  const f = await pickerApp(400), app = f.app;
  f.holdRuns(RUNS);
  app.click('connect'); await app.tick(80);
  const counts = [];
  for (let b = 0; b < 8; b++) {
    await nextBatch(f);
    app.advanceTimers(1000); await app.tick(5);
    const m = /Still reading runs \((\d+) of (\d+)\)/.exec(app.html());
    if (m) counts.push(+m[1]);
  }
  assert.ok(counts.length >= 6, 'each slow batch drew with its count: ' + counts.join(', '));
  assert.ok(counts.every((c, i) => i === 0 || c > counts[i - 1]), 'and the count goes up with each batch: ' + counts.join(', '));
  f.holdRuns(null); f.release(); await app.tick(200);
  f.restore();
});

rule('A click during a waiting batch draw draws at once and drops the waiting one; switching folders drops it too', async () => {
  const f = await pickerApp(400), app = f.app;
  f.holdRuns(RUNS);
  app.click('connect'); await app.tick(80);
  await nextBatch(f);   // the first batch: drawn at once
  await nextBatch(f);   // the next: waiting
  assert.ok(waiting(app), 'set-up: a batch draw is waiting');
  app.PF.perf.reset();
  app.click('nav', 'runs'); await app.tick(5);
  assert.ok(count(app, 'render') >= 1, 'the click drew at once');
  app.advanceTimers(1000); await app.tick(5);
  assert.strictEqual(count(app, 'batch.renders'), 0, 'and the waiting batch draw never lands');
  await nextBatch(f);
  assert.ok(waiting(app), 'set-up: another batch draw waits');
  /* Another team folder, its runs different from the first's: the first folder's reads that land late carry other data. */
  const other = generate(load(), { runs: 120, running: 4, recent: 8, seed: 99 }).files;
  const keysOf = fl => new Set(Object.keys(fl).filter(p => RUNS.test(p)).map(p => p.split('/').slice(1, 3).join('/')));
  const firstOnly = [...keysOf(f.files)].filter(x => !keysOf(other).has(x));
  assert.ok(firstOnly.length > 300, 'set-up: the two folders hold different runs: ' + firstOnly.length);
  f.nextFolder('Other', other);
  app.click('connect'); await app.tick(40);
  app.PF.perf.reset();
  app.advanceTimers(1000); await app.tick(5);
  assert.strictEqual(count(app, 'batch.renders'), 0, 'after switching folders, the old folder\'s batch draw never lands');
  f.holdRuns(null); f.release(); await app.tick(200);
  /* After the switch, with the old folder's reads let go: every lookup is the new folder's, as a scan finds it. */
  assert.strictEqual(Array.from(app.PF.perf.check()).join('; '), '', 'a lookup disagrees with a scan after switching folders');
  app.click('nav', 'runs'); await app.tick(5);
  const shownKeys = [...app.html().matchAll(/data-act="open-run" data-id="([^"]+)"/g)].map(m => m[1].replace(/&#39;/g, "'"));
  assert.ok(shownKeys.length > 0, 'set-up: the other folder\'s runs are listed');
  assert.deepStrictEqual(shownKeys.filter(x => firstOnly.indexOf(x) >= 0), [], 'none of the first folder\'s runs shows in the other');
  for (const v of ['home', 'runs']) {
    app.click('nav', v); await app.tick(5);
    app.PF.perf.draw(); const fast = app.html();
    app.PF.perf.plain = true; app.PF.perf.draw(); const plain = app.html(); app.PF.perf.plain = false;
    assert.ok(fast === plain, v + ' is drawn the same with the lookups as by scanning, after switching folders');
  }
  f.restore();
});

rule('Typing survives a batch draw that lands while you type: a step note, a Fill in value and a follow-up reason keep their text, focus and caret', async () => {
  const f = await pickerApp(400, { gen: { typed: true } }), app = f.app;
  f.holdRuns(RUNS);
  app.click('connect'); await app.tick(80);
  await nextBatch(f);
  /* A running run (read first, so it's in the first batch), picked up by someone on the team, with its step's note box. */
  const people = JSON.parse(f.files['people.json']), me = people.filter(p => !p.inactive)[0].id;
  app.choose(me); await app.tick(10);
  const parse = p => { try { return JSON.parse(f.files[p]); } catch (e) { return null; } };
  const path = Object.keys(f.files).filter(p => RUNS.test(p)).find(p => { const r = parse(p); return r && !r.ended; });
  const key = path.split('/').slice(1, 3).join('/');
  app.click('open-run', key); await app.tick(20);
  app.click('pickup'); await app.tick(40);
  if (app.html().indexOf('id="note-text"') < 0) { const st = (/data-act="sel" data-id="([^"]+)"/.exec(app.html()) || [])[1]; if (st) { app.click('sel', st); await app.tick(10); } }
  /* A box typed in, focused, caret mid-text; then a batch draw lands. Its text, focus and caret are all still there. */
  const survives = async (id, text, what) => {
    assert.ok(app.html().indexOf('id="' + id + '"') >= 0, 'set-up: ' + what + ' is drawn: ' + app.html().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
    app.set(id, text); const box = app.el(id); box.selectionStart = box.selectionEnd = 7;
    box.closest = () => null; app.doc.activeElement = box; app.input(id, text);
    await nextBatch(f);
    assert.ok(waiting(app), 'set-up: a batch draw waits (' + what + ')');
    app.advanceTimers(1000); await app.tick(10);
    assert.ok(count(app, 'batch.renders') > 0, 'set-up: the batch draw landed (' + what + ')');
    /* The harness made the box anew (replace): what's there now, the app put back. */
    assert.strictEqual(app.el(id).value, text, what + ' is still there');
    assert.ok(app.doc.activeElement === app.el(id), what + ' has focus');
    assert.deepStrictEqual([app.el(id).selectionStart, app.el(id).selectionEnd], [7, 7], what + ': the caret is where it was');
  };
  app.el('note-text').tagName = 'TEXTAREA';
  await survives('note-text', 'Waiting on the vendor', 'the step note');
  /* An open Fill in with a value typed in it. */
  const fill = /data-act="pick" data-kind="fields" data-id="([^"]+)"(?! disabled)/.exec(app.html());
  assert.ok(fill, 'set-up: the step offers Fill in');
  app.click('pick', fill[1], { kind: 'fields' }); await app.tick(10);
  const fld = (/<input id="(fld-[\w-]+)"/.exec(app.html()) || [])[1];
  assert.ok(fld, 'set-up: Fill in has a box');
  await survives(fld, 'the release dashboard', 'a value typed in Fill in');
  app.click('unpick'); await app.tick(5);
  /* A follow-up's Won't do reason, on Runs › Follow-ups. */
  app.click('nav', 'followups'); await app.tick(10);
  const fu = /data-act="fu-pick" data-id="([^"]+)" data-status="wont"/.exec(app.html());
  assert.ok(fu, 'set-up: an open follow-up offers Won\'t do');
  app.click('fu-pick', fu[1], { status: 'wont' }); await app.tick(10);
  const why = (/<input id="([^"]+-reason)"/.exec(app.html()) || [])[1];
  await survives(why, 'Covered by the new runbook', 'a follow-up\'s reason');
  f.holdRuns(null); f.release(); await app.tick(200);
  f.restore();
});

/* What one draw of a screen costs, counted from a clean slate after the folder is in. */
async function drawCost(app, go) { app.PF.perf.reset(); await go(); await app.tick(10); return { counted: count(app, 'runs.counted'), procs: count(app, 'procs.inspected'), renders: count(app, 'render') }; }

rule('Home for the owner of 200 processes checks each run\'s standing a few times per draw, not once per process', async () => {
  const { app, runs } = await bigApp();
  app.choose('person-avery'); await app.tick(10);
  const c = await drawCost(app, async () => { app.click('nav', 'home'); });
  assert.ok(c.renders >= 1, 'set-up: Home drew');
  assert.ok(c.counted <= 3 * runs * c.renders, 'runs checked ' + c.counted + ' ≤ 3 × runs per draw (' + 3 * runs + ' × ' + c.renders + '); once per process is about ' + 200 * runs);
});

rule('The runs list finds each run\'s process directly: processes inspected grow with the processes, not runs × processes', async () => {
  const { app } = await bigApp();
  const procs = new Set(Object.keys(app.fs.files).map(p => (/^(?:publications|drafts)\/([^/.]+)/.exec(p) || [])[1]).filter(Boolean)).size;
  assert.ok(procs >= 200, 'set-up: the processes are there: ' + procs);
  const c = await drawCost(app, async () => { app.click('nav', 'home'); await app.tick(5); app.click('nav', 'runs'); });
  assert.ok(c.renders >= 1, 'set-up: the runs list drew');
  assert.ok(c.procs <= 3 * procs * c.renders, 'process entries inspected ' + c.procs + ' ≤ 3 × processes per draw (' + 3 * procs + ' × ' + c.renders + ')');
});

rule('A process page counts its own runs for its stages and sign-off, not every run once per stage', async () => {
  const { app, runs } = await bigApp();
  app.choose('person-avery'); await app.tick(10);
  const pid = 'proc-001';
  const c = await drawCost(app, async () => { app.click('open-process', pid); });
  assert.ok(c.renders >= 1, 'set-up: the process page drew');
  assert.ok(c.counted <= runs, 'runs checked ' + c.counted + ' ≤ runs (' + runs + '): only this process\'s runs are checked');
});

rule('Five hundred people: each draw names everyone once per list, and Settings, People checks each change in one pass', async () => {
  const { app } = await bigApp();
  const many = [{ id: 'person-casey', name: 'Casey Example', email: 'casey@example.com', folderRole: 'owner' }];
  for (let i = 1; i < 500; i++) many.push({ id: 'person-' + i, name: i % 50 === 0 ? 'Sam Twin' : 'Person ' + i, email: 'p' + i + '@example.com' });
  app.fs.files['people.json'] = { t: JSON.stringify(many, null, 2) + '\n', m: Date.now() };
  app.click('refresh'); await settle(app, loads(app));
  const c = await drawCost(app, async () => { app.click('nav', 'settings'); });
  const html = app.html();
  assert.ok(/People · 500/.test(html), 'set-up: Settings, People lists all 500: ' + (html.match(/People · \d+/) || [''])[0]);
  assert.ok(/Sam Twin \(p50@example\.com\)/.test(app.top()), 'twins are still told apart by email in the You are picker');
  const names = count(app, 'people.names'), rows = count(app, 'people.rows');
  assert.ok(names <= 5 * 500 * c.renders, 'names compared ' + names + ' ≤ 5 × people per draw (' + 2500 + ' × ' + c.renders + '); comparing each with everyone is about 250,000');
  assert.ok(rows <= 2 * 500 * c.renders, 'people rows read for permissions ' + rows + ' ≤ 2 × people per draw');
});

run();
