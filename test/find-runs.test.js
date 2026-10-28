// Find things in big folders (2.11), slice 3: Runs and Home. Follow-ups (Find, paging, the row being edited kept), Planned
// and Just planned, Home's three lists, and the bounded dropdowns (K.select), on the big folder (test/bounds-fixture.js).
'use strict';
const assert = require('assert');
const { loadViews, rule, run } = require('./harness');
const { boot } = require('./app-harness');
const { fixture, into } = require('./bounds-fixture');

const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let big = null;
async function bigApp() {
  if (big) return big;
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fixture());
  return (big = app);
}
/* A newer read of the folder, as the app's own Check the folder now does it. */
async function reread(app) {
  const was = app.PF.perf.n['load.done'] || 0;
  app.click('refresh');
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(5);
}
function moreOf(html, id) {
  const m = new RegExp('<button[^>]*data-act="more" data-id="' + id.replace(/[-/]/g, '\\$&') + '"([^>]*)>').exec(html); if (!m) return null;
  const d = {}; m[1].replace(/data-([\w-]+)="([^"]*)"/g, (x, k, v) => { d[k] = un(v); return x; }); return d;
}
const fuKeys = h => [...h.matchAll(/<li class="fu[^"]*" id="fu-([^"]+)"/g)].map(m => un(m[1]).replace(/--/g, '/'));
const fuId = k => 'fud-' + k.replace(/[^A-Za-z0-9]/g, c => '_' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
const typeFind = async (app, id, v) => { app.set('find-' + id, v); app.input('find-' + id, v); await app.tick(5); };
/* The options a select draws: [value, label, selected]. */
function options(html, id) {
  const m = new RegExp('<select id="' + id.replace(/[-/]/g, '\\$&') + '"[^>]*>([\\s\\S]*?)</select>').exec(html); if (!m) return null;
  return [...m[1].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map(x => [un(x[1]), un(x[3]), /selected/.test(x[2])]);
}
const MORE = '#more';
const candidates = (opts, special) => opts.filter(o => o[0] !== MORE && special.indexOf(o[0]) < 0);
async function followUps(app, chip) {
  app.click('nav', 'followups'); await app.tick(10);
  if (chip) { app.click('fu-filter', chip); await app.tick(5); }
}

/* ---------- Follow-ups ---------- */
rule('Follow-ups: 5,000 draw 50 a chip, oldest open first, with Show more focusing the first one it adds; Find narrows over all of them', async () => {
  const app = await bigApp(); await followUps(app);
  let h = app.html();
  assert.strictEqual(fuKeys(h).length, 50);
  assert.ok(/Open · 5000</.test(h) || /Open · 5,000</.test(h) || /Open · \d+</.test(h), 'the heading counts every one');
  const d = moreOf(h, 'fu');
  assert.ok(d && d.focus === '[id="fu-' + d.next.replace(/\//g, '--') + '"] .fu-text', JSON.stringify(d));
  app.click('more', 'fu', d); await app.tick(5);
  assert.strictEqual(fuKeys(app.html()).length, 100);
  assert.ok(app.node(d.focus) && app.doc.activeElement === app.node(d.focus), 'focus is on the first added row\'s text');
  assert.ok(/<span class="fu-text" tabindex="-1">/.test(app.html()));
  await typeFind(app, 'fu', 'follow up 4321');
  h = app.html();
  assert.deepStrictEqual(fuKeys(h).length, 1, 'one match');
  assert.ok(/role="status">1 of [\d,]+ match</.test(h));
  app.click('fu-filter', 'all'); await app.tick(5);
  assert.strictEqual(fuKeys(app.html()).length, 1, 'Find stays across chips');
  app.click('find-clear', 'fu'); await app.tick(5);
  assert.strictEqual(fuKeys(app.html()).length, 50, 'All: 50 again');
  app.click('fu-filter', 'open'); await app.tick(5);
});

rule('Follow-ups: an open Won\'t do form on row 300 is drawn through Show more, a Find that leaves it out, Open → All → Yours, and a newer read that marks it done; then Save does what 2.10 does', async () => {
  const app = await bigApp(); await followUps(app);
  for (let i = 0; i < 6; i++) { app.click('more', 'fu', moreOf(app.html(), 'fu')); await app.tick(5); }
  const key = fuKeys(app.html())[299], base = fuId(key), [proc, runId, id] = key.split('/');
  app.click('fu-pick', key, { status: 'wont' }); await app.tick(5);
  assert.strictEqual(app.activeId(), base + '-reason', 'the form opens with focus in its box');
  app.set(base + '-reason', 'Covered by the platform team');
  const drawn = () => new RegExp('id="' + base + '-reason"').test(app.html());
  app.click('fu-filter', 'open'); await app.tick(5);
  assert.strictEqual(fuKeys(app.html()).length, 51, 'set-up: back to the first page, and the row kept');
  assert.ok(drawn(), 'kept past the first page');
  assert.ok(/You&#39;re editing this one/.test(app.html()));
  await typeFind(app, 'fu', 'nothing matches this');
  assert.ok(drawn(), 'kept when Find leaves it out');
  app.click('find-clear', 'fu'); await app.tick(5);
  for (const chip of ['all', 'mine', 'open']) { app.click('fu-filter', chip); await app.tick(5); assert.ok(drawn(), 'kept on ' + chip); }
  const F = app.PF.followups, rec = F.decision({ process: proc, run: runId, id }, 'person-blake', 'done', {}, new Date().toISOString(), null);
  await app.fs.write('followups/' + proc + '/' + F.fileName(rec, 'w-other'), JSON.stringify(rec, null, 2) + '\n');
  await reread(app);
  const h = app.html();
  assert.ok(drawn(), 'kept after a newer read decided it');
  assert.ok(/<b>No longer open:<\/b> done by Blake Ortiz/.test(h), 'and marked');
  app.click('fu-save', key); await app.tick(40);
  const mine = Object.keys(app.fs.files).filter(p => p.indexOf('followups/' + proc + '/' + runId + '.' + id + '.') === 0 && p.indexOf('w-other') < 0);
  assert.strictEqual(mine.length, 1, 'Save wrote a decision, as 2.10 does for a row decided under it: ' + mine);
  const saved = JSON.parse(app.fs.files[mine[0]].t);
  assert.strictEqual(saved.status, 'wont'); assert.strictEqual(saved.reason, 'Covered by the platform team');
  assert.strictEqual(saved.rev, 2, 'following the newer decision'); assert.strictEqual(saved.seen, F.fileName(rec, 'w-other'));
});

rule('Follow-ups: a newer read that removes the follow-up draws it from its snapshot as Removed elsewhere, with what\'s typed, Copy my text and Cancel, and no Save', async () => {
  const app = await bigApp(); await followUps(app);
  const key = fuKeys(app.html())[10], base = fuId(key), [proc, runId, id] = key.split('/');
  app.click('fu-pick', key, { status: 'wont' }); await app.tick(5);
  app.set(base + '-reason', 'Typed before it went');
  const path = 'runs/' + proc + '/' + runId + '/run.json', was = app.fs.files[path].t, r = JSON.parse(was);
  r.followUps = r.followUps.filter(f => f.id !== id);
  await app.fs.write(path, JSON.stringify(r, null, 2) + '\n');
  try {
    await reread(app);
    const h = app.html(), row = h.slice(h.indexOf('id="fu-' + key.replace(/\//g, '--') + '"'));
    assert.ok(/class="fu fu-gone"/.test(h) && /<b>Removed elsewhere\.<\/b>/.test(row), 'marked');
    assert.ok(new RegExp('id="' + base + '-reason"').test(row), 'its box is drawn');
    assert.ok(/data-act="fu-copy"/.test(row) && /data-act="fu-cancel"/.test(row) && !new RegExp('data-act="fu-save" data-id="' + key).test(h), 'Copy my text and Cancel, never Save');
    app.click('fu-cancel', key); await app.tick(5);
    assert.ok(!/fu-gone/.test(app.html()), 'Cancel lets it go');
  } finally { await app.fs.write(path, was); await reread(app); }
});

/* ---------- Moved to ---------- */
async function movedForm(app, nth) {
  await followUps(app);
  const key = fuKeys(app.html())[nth || 0], base = fuId(key);
  app.click('fu-pick', key, { status: 'moved' }); await app.tick(5);
  return { key, base, to: base + '-to' };
}
rule('Moved to with 10,000 running runs and 5,000 plans: 50 candidates, None and Show 50 more…; Find a run or plan finds run 9,000, and the choice and the Find text survive a refresh', async () => {
  const app = await bigApp(), { key, base, to } = await movedForm(app, 3);
  let o = options(app.html(), to);
  assert.strictEqual(candidates(o, ['']).length, 50, '50 candidates');
  assert.strictEqual(o.length, 52, 'plus None and Show 50 more…');
  assert.ok(o[0][0] === '' && o[o.length - 1][0] === MORE && /Show 50 more…/.test(o[o.length - 1][1]));
  assert.ok(/<optgroup label="Running">/.test(app.html()));
  assert.ok(new RegExp('<label for="find-' + to + '">Find a run or plan</label><input type="search" id="find-' + to + '" data-find="' + to + '" data-sel-find="' + to + '" data-nav-safe data-bound').test(app.html()), 'the box, safe to leave');
  await typeFind(app, to, 'running 9000');
  o = options(app.html(), to);
  const hit = o.filter(x => x[1] === 'Running 9000');
  assert.strictEqual(hit.length, 1, 'found: ' + JSON.stringify(o.slice(0, 4)));
  app.select(to, hit[0][0]); await app.tick(5);
  app.set(base + '-link', 'https://example.com/moved');
  await reread(app);
  o = options(app.html(), to);
  assert.ok(o.some(x => x[0] === hit[0][0]), 'the choice is still an option');
  assert.ok(new RegExp('id="find-' + to + '"[^>]*value="running 9000"').test(app.html()), 'and the Find text');
  assert.strictEqual(app.el(to).value, hit[0][0]);
  await typeFind(app, to, 'planned 4');
  o = options(app.html(), to);
  assert.ok(o.some(x => x[0] === hit[0][0]), 'kept whatever Find shows');
  assert.ok(candidates(o, ['']).length <= 51 && o.some(x => /^plan:/.test(x[0])));
  app.click('fu-cancel', key); await app.tick(5);
});

rule('Moved to: choosing only a destination, then typing in its Find box or a refresh, then go(), Back and Forward are each refused as unsaved work, and the choice is still there', async () => {
  const app = await bigApp(), { key, to } = await movedForm(app, 4);
  const opt = candidates(options(app.html(), to), [''])[7][0];
  app.select(to, opt); await app.tick(5);
  await typeFind(app, to, 'running');
  await reread(app);
  const at = app.url();
  app.click('go', null, { view: 'process', process: 'tiny' }); await app.tick(10);
  assert.ok(/data-act="fu-save" data-id="/.test(app.html()) && app.url() === at, 'go() refused');
  app.back(); await app.settle();
  assert.ok(new RegExp('id="' + to + '"').test(app.html()), 'Back refused');
  app.forward(); await app.settle();
  assert.ok(new RegExp('id="' + to + '"').test(app.html()), 'Forward refused');
  assert.ok(options(app.html(), to).some(x => x[0] === opt), 'the choice is still an option');
  app.click('fu-cancel', key); await app.tick(5);
});

rule('Moved to: a chosen run that ends, a run removed from the folder and a plan that starts are each still the choice, marked, and Save writes exactly the reference 2.10 writes', async () => {
  const app = await bigApp(), F = app.PF.followups;
  const save = async (key, want) => {
    const [proc, runId, id] = key.split('/'), before = new Set(Object.keys(app.fs.files));
    app.click('fu-save', key); await app.tick(40);
    const made = Object.keys(app.fs.files).filter(p => !before.has(p) && p.indexOf('followups/' + proc + '/' + runId + '.' + id + '.') === 0);
    assert.strictEqual(made.length, 1, 'one decision written');
    assert.deepStrictEqual(JSON.parse(app.fs.files[made[0]].t).to, want);
    await app.fs.remove(made[0]); await reread(app);
  };
  /* A run that ends. */
  let f = await movedForm(app, 5);
  await typeFind(app, f.to, 'running 77');
  let pick = options(app.html(), f.to).filter(x => x[1] === 'Running 77')[0][0];
  app.select(f.to, pick); await app.tick(5);
  const rpath = 'runs/' + pick + '/run.json', rwas = app.fs.files[rpath].t, rr = JSON.parse(rwas);
  rr.ended = { outcome: 'Cancelled', at: new Date().toISOString(), by: 'person-blake' }; rr.state = 'cancelled';
  await app.fs.write(rpath, JSON.stringify(rr, null, 2) + '\n'); await reread(app);
  let h = app.html();
  assert.ok(options(h, f.to).some(x => x[0] === pick && x[1] === 'Running 77 (ended)'), 'marked (ended)');
  assert.ok(/That run has ended\. Choose where it moved to, or keep it\./.test(h));
  app.set(f.to, pick);
  await save(f.key, { run: pick });
  await app.fs.write(rpath, rwas);
  /* A run removed from the folder. */
  f = await movedForm(app, 6);
  await typeFind(app, f.to, 'running 78');
  pick = options(app.html(), f.to).filter(x => x[1] === 'Running 78')[0][0];
  app.select(f.to, pick); await app.tick(5);
  const gpath = 'runs/' + pick + '/run.json', gwas = app.fs.files[gpath].t;
  await app.fs.remove(gpath); await reread(app);
  h = app.html();
  assert.ok(options(h, f.to).some(x => x[0] === pick && x[1] === 'Running 78 (no longer in the folder)'), 'marked as gone');
  assert.ok(/That run is no longer in the folder\. Saving still records that the work moved there; choose another to change it\./.test(h));
  app.set(f.to, pick);
  await save(f.key, { run: pick });
  await app.fs.write(gpath, gwas);
  /* A plan that starts. */
  f = await movedForm(app, 7);
  await typeFind(app, f.to, 'planned 4999');
  pick = options(app.html(), f.to).filter(x => x[1] === 'Planned 4999')[0][0];
  app.select(f.to, pick); await app.tick(5);
  const planId = pick.slice(5), plan = JSON.parse(app.fs.files['proposals/' + planId + '.json'].t);
  plan._hash = app.PF.util.hash(JSON.stringify(app.PF.run.testLast ? app.PF.run.testLast(plan) : plan));
  const dec = app.PF.plans.decision(plan, 'accepted', 'started1', 'person-blake', new Date().toISOString(), null, '2.11.0'), dpath = 'proposals/' + planId + '.status-w-other-d.json';
  await app.fs.write(dpath, JSON.stringify(dec, null, 2) + '\n'); await reread(app);
  h = app.html();
  assert.ok(options(h, f.to).some(x => x[0] === pick && x[1] === 'Planned 4999 (started)'), 'marked (started): ' + JSON.stringify(options(h, f.to).slice(0, 3)));
  assert.ok(/That plan has started\. Choose where it moved to, or keep it\./.test(h));
  app.set(f.to, pick);
  await save(f.key, { plan: planId });
  await app.fs.remove(dpath); await reread(app);
  assert.ok(F, 'followups loaded');
});

rule('Moved to with 51 destinations and Find matching one, then a refresh leaving 49: the box, its text, the choice, a typed link and focus stay; Clear shows all 49 and keeps the empty box while it has focus; it goes once focus leaves', async () => {
  const fx = fixture({ size: { running: 47, plans: 0, ended: 3, followUps: 6, procs: 2, versions: 2, stages: 1, members: 1, health: 1, many: 2, steps: 8, legacy: 1, archived: 1, hot: 1, teamValues: 1, people: 6, tags: 2 } });
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fx);
  const runFiles = () => Object.keys(app.fs.files).filter(f => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(f) && JSON.parse(app.fs.files[f].t).state === 'running');
  /* Exactly 51 places to move to: the running runs (the fixture's and the examples') and the examples' one plan. */
  const plans = Object.keys(app.fs.files).filter(f => /^proposals\/[^/]+\.json$/.test(f) && !/\.status-/.test(f)).length;
  const end = async p => { const r = JSON.parse(app.fs.files[p].t); r.ended = { outcome: 'Cancelled', at: new Date().toISOString(), by: 'person-blake' }; r.state = 'cancelled'; await app.fs.write(p, JSON.stringify(r, null, 2) + '\n'); };
  const tinyRuns = () => runFiles().filter(f => /^runs\/tiny\//.test(f) && /^Running (?!3$)\d+$/.test(JSON.parse(app.fs.files[f].t).title));
  for (const p of tinyRuns().slice(0, runFiles().length + plans - 51)) await end(p);
  await reread(app);
  assert.strictEqual(runFiles().length + plans, 51, 'set-up: 51 places');
  const { key, base, to } = await movedForm(app, 0);
  assert.strictEqual(candidates(options(app.html(), to), ['']).length, 50, 'set-up: 51 to choose from, 50 drawn');
  await typeFind(app, to, 'running 3');
  const pick = options(app.html(), to).filter(x => x[1] === 'Running 3')[0][0];
  app.select(to, pick); await app.tick(5);
  app.set(base + '-link', 'https://example.com/x');
  app.el('find-' + to).focus(); app.set('find-' + to, 'running 3');
  /* Two runs end elsewhere: 49 left. */
  for (const p of tinyRuns().slice(0, 2)) await end(p);
  await reread(app);
  let h = app.html();
  assert.ok(new RegExp('id="find-' + to + '"[^>]*value="running 3"').test(h), 'the box and its text stay');
  assert.ok(options(h, to).some(x => x[0] === pick), 'the choice');
  assert.ok(new RegExp('id="' + base + '-link"').test(h), 'the link box');
  assert.strictEqual(app.activeId(), 'find-' + to, 'focus');
  app.click('find-clear', to); await app.tick(5);
  h = app.html();
  assert.strictEqual(candidates(options(h, to), ['']).length, 49, 'Clear: all 49');
  assert.ok(new RegExp('id="find-' + to + '"[^>]*value=""').test(h), 'the empty box stays while it has focus');
  assert.strictEqual(app.activeId(), 'find-' + to);
  app.el(to).focus(); app.fire('focusout', { target: app.el('find-' + to) }); await app.tick(5); app.click('dismiss'); await app.tick(5);
  assert.ok(!new RegExp('id="find-' + to + '"').test(app.html()), 'it goes once focus leaves it, with 49 left');
  app.click('fu-cancel', key); await app.tick(5);
});

/* ---------- the other bounded dropdowns ---------- */
rule('K.select: 50 candidates plus the chosen one in its place, Show 50 more… and Show more choices widen without changing the choice, repeated labels say where they are, and every label goes through esc()', () => {
  const PF = loadViews(), K = PF.vk, items = Array.from({ length: 200 }, (x, i) => ({ v: 'v' + i, t: i % 2 ? 'Confirm the result' : 'Do part ' + i, place: 'step ' + (i + 1) }));
  items.push({ v: 'x', t: '<b>"x"</b>' });
  let r = K.select({}, 'sel', items, 'v150', { lead: '<option value="">Choose…</option>', noun: 'place' });
  const opts = [...r.select.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)];
  assert.strictEqual(opts.filter(o => o[1] && o[1] !== MORE).length, 51, '50 and the chosen one');
  assert.ok(opts.some(o => o[1] === 'v150' && /selected/.test(o[2])), 'chosen, in its place');
  assert.ok(opts[opts.length - 1][1] === MORE && /Show 50 more…/.test(opts[opts.length - 1][3]));
  assert.ok(/data-act="sel-more" data-id="sel"[^>]*>Show more choices</.test(r.more));
  assert.ok(/Confirm the result · step 2</.test(r.select), 'a repeated label says where it is');
  assert.ok(/id="find-sel"/.test(r.box) && /Find a place/.test(r.box));
  r = K.select({ more: { sel: 250 } }, 'sel', items, 'v150', {});
  assert.ok(/&lt;b&gt;&quot;x&quot;&lt;\/b&gt;/.test(r.select) && !/<b>"x"/.test(r.select), 'escaped');
  r = K.select({ find: { q: { sel: 'result step 180' } } }, 'sel', items, 'v150', {});
  assert.deepStrictEqual([...r.select.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]), ['v150', 'v179'], 'Find on a place reaches it; the chosen one stays');
  r = K.select({}, 'sel', items.slice(0, 300), 'v120', { around: 120 });
  const vs = [...r.select.matchAll(/<option value="(v\d+)"/g)].map(m => +m[1].slice(1));
  assert.ok(vs[0] === 95 && vs[vs.length - 1] === 144 && vs.length === 50, 'the 50 around the current one, in order: ' + vs[0] + '…' + vs[vs.length - 1]);
  r = K.select({}, 'sel', items.slice(0, 10), 'v1', {});
  assert.strictEqual(r.box, '', 'no box for a short list');
  assert.ok(/id="find-sel"/.test(K.select({ selFocus: 'sel' }, 'sel', items.slice(0, 10), 'v1', {}).box), 'unless it has focus');
});

rule('Filter runs: Process and Version list at most 50, Find reaches process 900 and version 3, and Any stays first', () => {
  const PF = loadViews(), V = PF.views, runs = [];
  for (let i = 1; i <= 1000; i++) runs.push({ process: 'proc-' + String(i).padStart(4, '0'), id: 'r' + i, folder: 'v1-x', version: 1, title: 'Run ' + i, state: 'ended', recorder: {}, roles: {}, steps: {} });
  for (let v = 1; v <= 300; v++) runs.push({ process: 'versions', id: 'v' + v, folder: 'v' + v + '-abc', version: v, title: 'V run ' + v, state: 'ended', recorder: {}, roles: {}, steps: {} });
  PF.run.isTest = () => false;
  const st = { runFilter: {}, disc: { rf: true } }, ctx = { state: st, data: { runs, people: [] }, processTitle: id => id === 'versions' ? 'Many versions' : 'Process ' + +id.slice(5) };
  let o = options(V.runsFilterBar(ctx), 'rf-process');
  assert.strictEqual(candidates(o, ['']).length, 50);
  assert.ok(o[0][0] === '' && o[0][1] === 'Any' && o[o.length - 1][0] === MORE, 'Any first, Show 50 more… last');
  assert.ok(o[1][1] === 'Many versions' || o[1][1] === 'Process 1', 'by name');
  st.find = { q: { 'rf-process': 'process 900' } };
  o = options(V.runsFilterBar(ctx), 'rf-process');
  assert.deepStrictEqual(candidates(o, ['']).map(x => x[0]), ['proc-0900']);
  st.find = null; st.runFilter = { process: 'versions' };
  o = options(V.runsFilterBar(ctx), 'rf-folder');
  assert.strictEqual(candidates(o, ['']).length, 50);
  assert.strictEqual(candidates(o, [''])[0][0], 'v300-abc', 'newest first');
  st.find = { q: { 'rf-folder': 'v3 ' } };
  st.find.q['rf-folder'] = 'v3-abc';
  o = options(V.runsFilterBar(ctx), 'rf-folder');
  assert.deepStrictEqual(candidates(o, ['']).map(x => x[0]), ['v3-abc'], 'Find reaches version 3');
  st.find = null; st.runFilter = { process: 'versions', folder: 'v3-abc' };
  o = options(V.runsFilterBar(ctx), 'rf-folder');
  assert.ok(o.some(x => x[0] === 'v3-abc' && x[2]), 'a chosen version past the page is drawn, chosen');
  assert.strictEqual(candidates(o, ['']).length, 51);
});

rule('The checklist\'s version picker and How runs go\'s version each list at most 50 of 300 versions, Find reaches version 3, and a version opened by URL is the chosen option', async () => {
  const app = await bigApp();
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'versions'); await app.tick(10);
  let o = options(app.html(), 'map-ver');
  assert.ok(o && candidates(o, ['', 'draft']).length === 50, 'map-ver: 50 versions');
  assert.ok(o.filter(x => x[0] === MORE).length === 1 && o.length <= 52, 'and Show 50 more…, total ' + o.length);
  await typeFind(app, 'map-ver', 'v3 ·');
  o = options(app.html(), 'map-ver');
  const three = o.filter(x => /^v3 · /.test(x[1]));
  assert.strictEqual(three.length, 1, 'Find reaches v3');
  app.select('map-ver', three[0][0]); await app.tick(10);
  app.click('find-clear', 'map-ver'); await app.tick(5);
  o = options(app.html(), 'map-ver');
  assert.ok(o.some(x => x[0] === three[0][0] && x[2]), 'chosen v3 stays drawn, chosen, with Find cleared');
  assert.strictEqual(candidates(o, ['', 'draft']).length, 51);
  app.click('ptab', 'insights'); await app.tick(20);
  o = options(app.html(), 'ins-folder');
  const insWas = o.filter(x => x[2])[0][0];
  assert.strictEqual(candidates(o, []).length, 50, 'ins-folder: 50');
  await typeFind(app, 'ins-folder', 'v3 ');
  o = options(app.html(), 'ins-folder');
  assert.ok(o.some(x => /^v3 /.test(x[1])), 'Find reaches v3 on How runs go');
  app.select('ins-folder', o.filter(x => /^v3 /.test(x[1]))[0][0]); await app.tick(10);
  app.click('find-clear', 'ins-folder'); await app.tick(5);
  assert.ok(options(app.html(), 'ins-folder').some(x => /^v3 /.test(x[1]) && x[2]), 'chosen and drawn');
  app.select('ins-folder', insWas); await app.tick(10);
  /* By URL: the checklist at version 3, from somewhere else. */
  app.click('nav', 'home'); await app.tick(5);
  app.typeHash('#/process/versions/v/' + three[0][0]); await app.settle(); await app.tick(10);
  const byUrl = options(app.html(), 'map-ver');
  assert.ok(byUrl && byUrl.some(x => x[0] === three[0][0] && x[2]), 'a version opened by URL is the chosen option');
  assert.strictEqual(candidates(byUrl, ['', 'draft']).length, 51);
});

rule('Show 50 more… and Show more choices widen a dropdown without changing its choice; nothing else hears the special option', async () => {
  const app = await bigApp();
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'versions'); await app.tick(10);
  app.click('ptab', 'insights'); await app.tick(20);
  const cur = options(app.html(), 'ins-folder').filter(x => x[2])[0][0];
  app.el('ins-folder').dataset = { cur }; app.el('ins-folder').tagName = 'SELECT';
  app.select('ins-folder', MORE); await app.tick(10);
  let o = options(app.html(), 'ins-folder');
  assert.ok([100, 101].indexOf(candidates(o, []).length) >= 0, 'widened to 100, and the chosen one: ' + candidates(o, []).length);
  assert.ok(o.some(x => x[0] === cur && x[2]), 'the choice is unchanged');
  assert.strictEqual(app.el('ins-folder').value, cur, 'the box shows it again');
  assert.ok(/id="ins-h"/.test(app.html()), 'still on How runs go');
  app.click('sel-more', 'ins-folder'); await app.tick(10);
  assert.ok([150, 151].indexOf(candidates(options(app.html(), 'ins-folder'), []).length) >= 0, 'Show more choices');
  assert.strictEqual(app.activeId(), 'ins-folder', 'focus goes to the dropdown');
});

/* ---------- the Phase select, Move it to ---------- */
async function phaseSelect(app, where) {
  const o = options(app.html(), 'rw-phase');
  assert.ok(o, where + ': the Phase select is drawn');
  const c = candidates(o, []);
  assert.strictEqual(c.length, 50, where + ': 50 candidates');
  assert.ok(o.length <= 51 && o[o.length - 1][0] === MORE, where + ': and Show 50 more…, total ' + o.length);
  const nums = c.map(x => +x[1].split('.')[0]);
  assert.ok(nums.every((n, i) => !i || n === nums[i - 1] + 1), where + ': in checklist order');
  assert.ok(c.some(x => x[2]), where + ': the current phase is an option, chosen');
  await typeFind(app, 'rw-phase', '300.');
  let f = options(app.html(), 'rw-phase');
  assert.ok(f.some(x => /^300\. /.test(x[1])), where + ': Find reaches phase 300');
  assert.ok(f.some(x => x[2]), where + ': the current phase stays an option');
  app.click('find-clear', 'rw-phase'); await app.tick(5);
  app.click('sel-more', 'rw-phase'); await app.tick(10);
  assert.strictEqual(candidates(options(app.html(), 'rw-phase'), []).length, 100, where + ': Show more choices adds 50');
  assert.strictEqual(app.activeId(), 'rw-phase', where + ': focus kept on the select');
}
rule('The Phase select on a 300-phase checklist lists 50 phases in order around the current one, on the run screen and in Practice; Find reaches phase 300, Show more reaches the rest, and the current phase and Find text survive a refresh', async () => {
  const app = await bigApp(), { facts } = require('./bounds-fixture').fixture();
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', facts.phases); await app.tick(10);
  app.click('takeover'); await app.tick(40);
  await phaseSelect(app, 'run screen');
  await typeFind(app, 'rw-phase', 'phase 299');
  const cur = options(app.html(), 'rw-phase').filter(x => x[2])[0][0];
  await reread(app);
  assert.strictEqual(app.el('find-rw-phase').value, 'phase 299', 'Find text survives a refresh');
  const o = options(app.html(), 'rw-phase');
  assert.ok(o.some(x => x[0] === cur && x[2]) && o.some(x => /^299\. /.test(x[1])), 'and the current phase and the match');
  app.click('find-clear', 'rw-phase'); await app.tick(5);
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'phases'); await app.tick(10);
  app.click('ptab', 'edit'); await app.tick(10); app.click('pr-open'); await app.tick(60);
  await phaseSelect(app, 'Practice');
  app.click('find-clear', 'rw-phase'); await app.tick(5);
  app.click('pr-back'); await app.tick(20); app.click('nav', 'home'); await app.tick(5);
  assert.ok(/id="todo-h"/.test(app.html()), 'set-up: out of Practice');
});

rule('Move it to on a 400-step checklist with 200 "Confirm the result" steps: 50 places around the step, each saying where it is; Find reaches step 390 by its place, Show more widens without changing the choice, and the choice and the correction text survive a refresh with focus kept', async () => {
  const app = await bigApp(), { facts } = require('./bounds-fixture').fixture();
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', facts.steps); await app.tick(10);
  app.click('takeover'); await app.tick(40); app.click('select', 's199'); await app.tick(10);
  app.click('corr-open', 's199', { mode: 'correct' }); await app.tick(10);
  app.click('corr-op', 'move'); await app.tick(10);
  let o = options(app.html(), 'corr-move');
  const c = candidates(o, ['']);
  assert.strictEqual(c.length, 50, '50 places');
  assert.ok(o[0][0] === '' && o[o.length - 1][0] === MORE && o.length === 52, 'Choose… first, Show 50 more… last, total ' + o.length);
  assert.ok(c.some(x => x[0] === 'after:s198') && c.some(x => x[0] === 'after:s200'), 'around the step being corrected');
  const confirm = c.filter(x => /^After "Confirm the result \(v2\)" · Phase \d+, step \d+$/.test(x[1]));
  assert.ok(confirm.length >= 20, 'each repeated place names where it is: ' + confirm.length);
  app.set('corr-why', 'It belongs near the end'); app.input('corr-why', 'It belongs near the end'); await app.tick(5);
  await typeFind(app, 'corr-move', 'phase 8, step 40');
  o = options(app.html(), 'corr-move');
  assert.deepStrictEqual(candidates(o, ['']).map(x => x[0]), ['after:s389'], 'Find on its place reaches step 390');
  assert.strictEqual(app.el('corr-why').value, 'It belongs near the end', 'the correction text is untouched while typing in Find');
  app.select('corr-move', 'after:s389'); await app.tick(10);
  app.click('find-clear', 'corr-move'); await app.tick(5);
  o = options(app.html(), 'corr-move');
  assert.ok(o.some(x => x[0] === 'after:s389' && x[2]), 'the choice stays, in its place');
  assert.strictEqual(candidates(o, ['']).length, 51);
  app.el('corr-move').dataset = { cur: 'after:s389' }; app.el('corr-move').tagName = 'SELECT';
  app.select('corr-move', MORE); await app.tick(10);
  o = options(app.html(), 'corr-move');
  assert.strictEqual(candidates(o, ['']).length, 101, 'Show 50 more… widens');
  assert.ok(o.some(x => x[0] === 'after:s389' && x[2]), 'without changing the choice');
  app.click('sel-more', 'corr-move'); await app.tick(10);
  assert.strictEqual(candidates(options(app.html(), 'corr-move'), ['']).length, 151, 'Show more choices widens');
  assert.strictEqual(app.activeId(), 'corr-move');
  app.el('corr-move').focus();
  /* Someone else adds a note, and the open run is read again as coming back to the window does, so nothing takes focus. */
  const renders = app.PF.perf.n.render || 0;
  await app.fs.write('runs/steps/stepsrun/notes-elsewhere.jsonl', JSON.stringify({ id: 'elsewhere', at: new Date().toISOString(), by: 'person-blake', session: 'elsewhere', step: 's3', text: 'A note from elsewhere' }) + '\n');
  app.focus(); await app.tick(80);
  assert.ok((app.PF.perf.n.render || 0) > renders, 'set-up: the run was read again and drawn');
  o = options(app.html(), 'corr-move');
  assert.ok(o && o.some(x => x[0] === 'after:s389' && x[2]), 'the choice survives a refresh');
  assert.strictEqual(app.el('corr-why').value, 'It belongs near the end', 'and the correction text');
  assert.strictEqual(app.activeId(), 'corr-move', 'and focus');
  app.click('corr-cancel'); await app.tick(5);
});

/* ---------- Planned, Just planned and Home ---------- */
const planCards = h => [...h.matchAll(/<button class="card plan"[^>]*data-id="([^"]+)"/g)].map(m => un(m[1]));
rule('Planned: 5,000 plans draw 50 soonest first, the heading counts them all, and Show more adds 50 with focus on the first one added', async () => {
  const app = await bigApp();
  app.click('nav', 'runs'); await app.tick(10);
  let h = app.html();
  const ids = planCards(h);
  assert.strictEqual(ids.length, 50);
  assert.ok(/id="planned-h">Planned · 5,0\d\d</.test(h), 'the heading counts every plan');
  assert.deepStrictEqual(ids.slice(0, 3), ['plan-00000', 'plan-00001', 'plan-00002'], 'soonest first');
  const d = moreOf(h, 'runs-planned');
  assert.ok(d, 'Show more');
  app.click('more', 'runs-planned', d); await app.tick(5);
  const after = planCards(app.html());
  assert.strictEqual(after.length, 100);
  assert.deepStrictEqual(after.slice(0, 50), ids, 'the first 50 unchanged');
  assert.ok(app.node(d.focus) && app.doc.activeElement === app.node(d.focus), 'focus on the first card added: ' + d.focus);
  assert.strictEqual(un(app.doc.activeElement.attrs ? app.doc.activeElement.attrs['data-id'] : app.doc.activeElement.dataset.id), after[50]);
});

async function planTiny(app, title) {
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'tiny'); await app.tick(10);
  app.click('plan-run', 'tiny'); await app.tick(10);
  app.set('run-title', title).set('plan-when', '2099-01-01T09:00');
  app.chooseApprovers().submitForm('plan-form'); await app.tick(120);
  const made = Object.keys(app.fs.files).filter(f => /^proposals\/plan-tiny-[a-z0-9]{8}\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(p => p.title === title);
  assert.strictEqual(made.length, 1, 'set-up: the plan is saved');
  return made[0].id;
}
rule('Just planned: a plan saved while a Runs filter is on, and again while a cohort from How runs go is on, is drawn at the top, focused and scrolled to, with the filter or cohort unchanged; it goes when you leave Runs', async () => {
  const app = await bigApp();
  app.click('nav', 'runs'); await app.tick(10);
  app.select('rf-process', 'versions'); await app.tick(10);
  const chipsOf = h => (/<div class="rf-chips"[\s\S]*?<\/div>/.exec(h) || [''])[0], filter = chipsOf(app.html());
  assert.ok(/versions|Many versions/.test(filter), 'set-up: the filter is on');
  const id = await planTiny(app, 'Planned under a filter');
  let h = app.html();
  assert.ok(/id="jp-h">Just planned</.test(h), 'the Just planned card');
  assert.strictEqual((h.match(new RegExp('id="card-' + id + '"', 'g')) || []).length, 1, 'one card with its id');
  assert.ok(h.indexOf('id="card-' + id + '"') < h.indexOf('rf-process'), 'above the filters');
  assert.strictEqual(app.activeId(), 'card-' + id, 'focused');
  assert.strictEqual(chipsOf(h), filter, 'the filter is unchanged');
  assert.ok(options(h, 'rf-process').some(x => x[0] === 'versions' && x[2]), 'and still drawn as chosen');
  app.click('nav', 'home'); await app.tick(5); app.click('nav', 'runs'); await app.tick(5);
  assert.ok(!/id="jp-h"/.test(app.html()), 'gone after leaving Runs');
  app.click('rf-clear', 'all'); await app.tick(5);
  /* A cohort: the runs behind a number in How runs go. */
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'versions'); await app.tick(10);
  app.click('ptab', 'insights'); await app.tick(20);
  const m = /data-act="ins-runs" data-id="([^"]+)"/.exec(app.html());
  assert.ok(m, 'set-up: a number to open');
  app.click('ins-runs', un(m[1])); await app.tick(10);
  const bannerOf = h => (/<div[^>]*id="ins-banner"[\s\S]*?<\/div>/.exec(h) || [''])[0], cohort = bannerOf(app.html());
  assert.ok(cohort, 'set-up: a cohort');
  const id2 = await planTiny(app, 'Planned under a cohort');
  h = app.html();
  assert.ok(/id="jp-h">Just planned</.test(h) && new RegExp('id="card-' + id2 + '"').test(h), 'drawn in Just planned');
  assert.strictEqual(app.activeId(), 'card-' + id2, 'focused');
  assert.strictEqual(bannerOf(h), cohort, 'the cohort is unchanged');
});

const todos = h => [...h.matchAll(/<li class="todo (?!ack)[^"]*" id="(todo-\d+)"/g)].map(m => m[1]);
rule('Home: Needs you shows 10 and Show more adds 10, focusing the first one added; the count says how many need you, and only drawn rows are built (a counted draw)', async () => {
  const app = await bigApp();
  app.click('nav', 'home'); await app.tick(10);
  let h = app.html();
  assert.strictEqual(todos(h).length, 10);
  const n = +(/(\d+) things need you\./.exec(h) || [])[1];
  assert.ok(n > 20, 'the count is every one: ' + n);
  app.PF.perf.n['home.todo'] = 0;
  app.click('dismiss'); await app.tick(5);
  assert.strictEqual(app.PF.perf.n['home.todo'], 10, 'one draw builds the 10 drawn rows, not ' + n);
  const d = moreOf(h, 'home-todo');
  assert.ok(d && d.focus === '#todo-10 b', JSON.stringify(d));
  app.click('more', 'home-todo', d); await app.tick(5);
  h = app.html();
  assert.strictEqual(todos(h).length, 20, 'Show more adds 10');
  assert.ok(app.node(d.focus) && app.doc.activeElement === app.node(d.focus), 'focus on the first one added');
  app.PF.perf.n['home.todo'] = 0;
  app.click('dismiss'); await app.tick(5);
  assert.strictEqual(app.PF.perf.n['home.todo'], 20);
});

rule('Home: Your corrections shows 10 of 30, and Show more adds 10', () => {
  const PF = loadViews(), V = PF.views, people = [{ id: 'person-casey', name: 'Casey Nguyen' }];
  const acks = Array.from({ length: 30 }, (x, i) => ({ key: 'k' + i, kind: 'declined', by: 'person-casey', reason: 'Reason <' + i + '>', process: 'release', group: { target: { kind: 'step', step: 's' + i }, text: 'Step ' + i } }));
  const state = { view: 'home', me: 'person-casey', more: {}, unfold: {}, disc: {} };
  const ctx = { state, data: { people, runs: [], plans: [], processes: [], drafts: [], skills: [], legacy: [], validations: [] }, now: () => Date.now(), peopleById: { 'person-casey': people[0] }, processes: () => [], processTitle: id => id, acks: () => acks, findRun: () => null };
  let h = V.home(ctx);
  assert.strictEqual((h.match(/<li class="todo ack/g) || []).length, 10);
  assert.ok(/Reason &lt;0&gt;/.test(h) && !/Reason <0>/.test(h), 'escaped');
  const d = moreOf(h, 'home-acks');
  assert.ok(d && d.focus === '#ack-10 b' && /Show 10 more/.test(h), JSON.stringify(d));
  state.more['home-acks'] = 20;
  h = V.home(ctx);
  assert.strictEqual((h.match(/<li class="todo ack/g) || []).length, 20);
  assert.ok(/id="ack-19"/.test(h) && !/id="ack-20"/.test(h));
});

rule('Home: Your follow-ups shows 10 of 50, Show more adds 10 with focus on the first one added, and the link to all follow-ups stays', async () => {
  const fx = fixture({ size: { running: 2, plans: 0, ended: 4, followUps: 300, procs: 2, versions: 2, stages: 1, members: 1, health: 1, many: 2, steps: 8, legacy: 1, archived: 1, hot: 1, teamValues: 1, people: 6, tags: 2 } });
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fx);
  app.click('nav', 'home'); await app.tick(10);
  let h = app.html();
  const mine = +(/id="fu-home-h">Your follow-ups · (\d+)</.exec(h) || [])[1];
  assert.ok(mine >= 40, 'set-up: many are mine: ' + mine);
  assert.strictEqual(fuKeys(h).length, 10);
  assert.ok(/data-act="nav" data-id="followups">All open follow-ups · \d+/.test(h), 'the link to all of them');
  const d = moreOf(h, 'home-fu');
  assert.ok(d, 'Show more');
  app.click('more', 'home-fu', d); await app.tick(5);
  assert.strictEqual(fuKeys(app.html()).length, 20);
  assert.ok(app.node(d.focus) && app.doc.activeElement === app.node(d.focus), 'focus on the first one added');
});

/* ---------- Export evidence and the builder's linked step ---------- */
rule('Export evidence: the process select lists 50 of 1,000 by name, Find reaches checklist 900, and the dates typed survive the redraws', async () => {
  const app = await bigApp();
  app.click('nav', 'runs'); await app.tick(10);
  app.click('ev-range'); await app.tick(10);
  let o = options(app.overlay(), 'ev-proc');
  assert.ok(o, 'set-up: the dialog');
  assert.strictEqual(candidates(o, []).length, 50, '50 candidates');
  assert.ok(o.length <= 52 && o[o.length - 1][0] === MORE, 'total ' + o.length);
  app.set('ev-from', '2026-01-02'); app.input('ev-from', '2026-01-02');
  app.set('ev-through', '2026-02-03'); app.input('ev-through', '2026-02-03'); await app.tick(5);
  await typeFind(app, 'ev-proc', 'process 900');
  const ov = app.overlay();
  o = options(ov, 'ev-proc');
  assert.ok(o.some(x => x[0] === 'proc-0900'), 'Find reaches checklist 900: ' + JSON.stringify(o.slice(0, 3)));
  assert.ok(/id="ev-from"[^>]*value="2026-01-02"/.test(ov) && /id="ev-through"[^>]*value="2026-02-03"/.test(ov), 'the dates are kept');
  app.select('ev-proc', 'proc-0900'); await app.tick(5);
  app.click('find-clear', 'ev-proc'); await app.tick(5);
  o = options(app.overlay(), 'ev-proc');
  assert.ok(o.some(x => x[0] === 'proc-0900' && x[2]), 'the choice stays, chosen');
  assert.ok(/id="ev-from"[^>]*value="2026-01-02"/.test(app.overlay()), 'and the dates');
  app.click('close-overlay'); await app.tick(5);
});

rule('The builder\'s linked checklist and pinned version list 50 each, keep their special choices, Find reaches checklist 900 and version 3, and typing in Find leaves the draft text alone', async () => {
  const app = await bigApp();
  const md = '---\nprocess: linker\ntitle: Linker\nowner: person-avery\n---\n\n## Build · READ-DO {#build}\n- [ ] {run.process} Run the child {#s}\n  process: versions\n  version: 250\n';
  await app.fs.write('maps/drafts/linker.md', md);
  app.click('nav', 'processes'); await app.tick(5); app.focus(); await app.tick(200);
  app.click('open-process', 'linker'); await app.tick(10); app.click('ptab', 'edit'); await app.tick(10);
  app.click('ed-mode', 'builder'); await app.tick(10); app.click('ob-sel', 's'); await app.tick(10);
  let h = app.html(), o = options(h, 'ob-link-proc');
  assert.ok(o, 'set-up: the linked step\'s form');
  assert.strictEqual(o[0][0], '', 'Choose one first');
  assert.ok(o.some(x => x[0] === '__other'), 'Other ID… stays');
  assert.ok(o.some(x => x[0] === 'versions' && x[2]), 'the linked checklist is chosen');
  assert.ok(candidates(o, ['', '__other']).length <= 51 && candidates(o, ['', '__other']).length >= 50, 'about 50 candidates and the chosen one: ' + candidates(o, ['', '__other']).length);
  assert.ok(o[o.length - 1][0] === MORE || o[o.length - 2][0] === MORE, 'Show 50 more…');
  await typeFind(app, 'ob-link-proc', 'process 900');
  o = options(app.html(), 'ob-link-proc');
  assert.ok(o.some(x => x[0] === 'proc-0900'), 'Find reaches checklist 900');
  assert.ok(o.some(x => x[0] === 'versions' && x[2]), 'the chosen one stays');
  let v = options(app.html(), 'ob-link-vn');
  assert.ok(v, 'the pinned version select');
  assert.strictEqual(candidates(v, []).length, 51, '50 newest and the pinned v250');
  assert.strictEqual(candidates(v, [])[0][0], '300', 'newest first');
  assert.ok(v.some(x => x[0] === '250' && x[2]), 'the pinned version, chosen');
  await typeFind(app, 'ob-link-vn', 'v3');
  v = options(app.html(), 'ob-link-vn');
  assert.ok(v.some(x => x[0] === '3'), 'Find reaches version 3');
  app.click('save-draft'); await app.tick(80);
  assert.strictEqual(app.fs.files['maps/drafts/linker.md'].t, md, 'typing in Find leaves the draft text alone');
  app.click('find-clear', 'ob-link-vn'); await app.tick(5); app.click('find-clear', 'ob-link-proc'); await app.tick(5);
  app.click('ob-done'); await app.tick(5); app.click('ed-mode', 'markdown'); await app.tick(5);
});

run();
