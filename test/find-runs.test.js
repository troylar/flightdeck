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
async function more(app, id, h) { const d = moreOf(h || app.html() + app.overlay(), id); assert.ok(d, 'a Show more for ' + id); app.click('more', id, d); await app.tick(5); return d; }
const fuKeys = h => [...h.matchAll(/<li class="fu[^"]*" id="fu-([^"]+)"/g)].map(m => un(m[1]).replace(/--/g, '/'));
const fuId = k => 'fud-' + k.replace(/[^A-Za-z0-9]/g, c => '_' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
const typeFind = async (app, id, v) => { app.set('find-' + id, v); app.input('find-' + id, v); await app.tick(5); };
/* The options a select draws: [value, label, selected]. */
function options(html, id) {
  const m = new RegExp('<select id="' + id.replace(/[-/]/g, '\\$&') + '"[^>]*>([\\s\\S]*?)</select>').exec(html); if (!m) return null;
  return [...m[1].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map(x => [un(x[1]), un(x[3]), /selected/.test(x[2])]);
}
const MORE = '#more';
/* A select stand-in as the page drew it: its tag and its data- attributes (data-kselect, data-cur, data-step), as a browser's
   dataset has them. */
function asDrawn(app, id) {
  const m = new RegExp('<select id="' + id + '"([^>]*)>').exec(app.html()), el = app.el(id), d = {};
  assert.ok(m, id + ' is drawn');
  m[1].replace(/\sdata-([\w-]+)(?:="([^"]*)")?/g, (x, k, v) => { d[k.replace(/-(\w)/g, (y, c) => c.toUpperCase())] = un(v || ''); return x; });
  el.dataset = d; el.tagName = 'SELECT';
  return el;
}
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
  assert.ok(d && d.focus === '[id="fu-t-' + d.next + '"]', JSON.stringify(d));
  app.click('more', 'fu', d); await app.tick(5);
  assert.strictEqual(fuKeys(app.html()).length, 100);
  assert.ok(app.node(d.focus) && app.doc.activeElement === app.node(d.focus), 'focus is on the first added row\'s text');
  assert.ok(/<span class="fu-text" id="fu-t-[^"]+" tabindex="-1">/.test(app.html()));
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

rule('Moved to with 51 destinations: its Find box focused but never typed in stays through a refresh that leaves 49, with focus; it goes once focus leaves', async () => {
  const fx = fixture({ size: { running: 47, plans: 0, ended: 3, followUps: 6, procs: 2, versions: 2, stages: 1, members: 1, health: 1, many: 2, steps: 8, legacy: 1, archived: 1, hot: 1, teamValues: 1, people: 6, tags: 2 } });
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fx);
  const runFiles = () => Object.keys(app.fs.files).filter(f => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(f) && JSON.parse(app.fs.files[f].t).state === 'running');
  const plans = Object.keys(app.fs.files).filter(f => /^proposals\/[^/]+\.json$/.test(f) && !/\.status-/.test(f)).length;
  const end = async p => { const r = JSON.parse(app.fs.files[p].t); r.ended = { outcome: 'Cancelled', at: new Date().toISOString(), by: 'person-blake' }; r.state = 'cancelled'; await app.fs.write(p, JSON.stringify(r, null, 2) + '\n'); };
  const tinyRuns = () => runFiles().filter(f => /^runs\/tiny\//.test(f));
  for (const p of tinyRuns().slice(0, runFiles().length + plans - 51)) await end(p);
  await reread(app);
  assert.strictEqual(runFiles().length + plans, 51, 'set-up: 51 places');
  const { key, to } = await movedForm(app, 0);
  assert.ok(new RegExp('id="find-' + to + '"').test(app.html()), 'set-up: the Find box, with 51');
  const box = app.el('find-' + to); box.focus(); app.fire('focusin', { target: app.node('[id="find-' + to + '"]') || box }); await app.tick(5);
  for (const p of tinyRuns().slice(0, 2)) await end(p);
  await reread(app);
  const h = app.html();
  assert.strictEqual(candidates(options(h, to), ['']).length, 49, 'set-up: 49 left');
  assert.ok(new RegExp('id="find-' + to + '"[^>]*value=""').test(h), 'the untouched box stays while it has focus');
  assert.strictEqual(app.activeId(), 'find-' + to, 'and keeps focus');
  app.el(to).focus(); app.fire('focusout', { target: app.el('find-' + to) }); await app.tick(5); app.click('dismiss'); await app.tick(5);
  assert.ok(!new RegExp('id="find-' + to + '"').test(app.html()), 'it goes once focus leaves it');
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

rule('K.select: Show more counts only the choices still hidden, kept ones too: none hidden, none offered; 49 hidden, 49 offered and added', () => {
  const PF = loadViews(), K = PF.vk, items = n => Array.from({ length: n }, (x, i) => ({ v: 'v' + i, t: 'Choice ' + i }));
  const opts = r => [...r.select.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]).filter(v => v !== MORE);
  let r = K.select({}, 'sel', items(51), 'v50', {});
  assert.strictEqual(opts(r).length, 51, 'all 51 drawn, the kept one too');
  assert.ok(r.select.indexOf(MORE) < 0 && !r.more, 'nothing left to show');
  r = K.select({}, 'sel', items(100), 'v60', {});
  assert.strictEqual(opts(r).length, 51);
  assert.ok(/<option value="#more">Show 49 more…</.test(r.select), 'says the 49 hidden: ' + r.select.slice(-80));
  const step = +(/data-step="(\d+)"/.exec(r.select) || [])[1];
  assert.ok(step > 0 && new RegExp('data-act="sel-more"[^>]*data-step="' + step + '"').test(r.more), 'both say how far the page grows');
  r = K.select({ more: { sel: 50 + step } }, 'sel', items(100), 'v60', {});
  assert.strictEqual(opts(r).length, 100, 'and adds those 49');
  assert.ok(r.select.indexOf(MORE) < 0, 'with nothing left');
  r = K.select({}, 'sel', items(200), 'v120', { around: 150 });
  const n0 = opts(r).length, st2 = +(/data-step="(\d+)"/.exec(r.select) || [])[1], said = +(/Show (\d+) more…/.exec(r.select) || [])[1];
  r = K.select({ more: { sel: 50 + st2 } }, 'sel', items(200), 'v120', { around: 150 });
  assert.strictEqual(opts(r).length - n0, said, 'around a choice too: it adds what it says (' + said + ')');
});

rule('Show 50 more… and Show more choices widen a dropdown without changing its choice; nothing else hears the special option', async () => {
  const app = await bigApp();
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'versions'); await app.tick(10);
  app.click('ptab', 'insights'); await app.tick(20);
  const cur = options(app.html(), 'ins-folder').filter(x => x[2])[0][0];
  assert.strictEqual(asDrawn(app, 'ins-folder').dataset.cur, cur);
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
  assert.strictEqual(asDrawn(app, 'corr-move').dataset.cur, 'after:s389');
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

/* Found in the headless check: the save's read joined one already under way, so Runs was drawn before the plan was in it. */
rule('Just planned: a plan saved while a read is under way is still drawn and focused once that read and the one after the save land', async () => {
  const { gate } = require('./app-harness');
  const fx = fixture({ size: { running: 4, plans: 0, ended: 3, followUps: 6, procs: 2, versions: 2, stages: 1, members: 1, health: 1, many: 2, steps: 8, legacy: 1, archived: 1, hot: 1, teamValues: 1, people: 6, tags: 2 } });
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fx);
  app.click('nav', 'runs'); await app.tick(10);
  app.select('rf-process', 'versions'); await app.tick(10);
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'tiny'); await app.tick(10);
  app.click('plan-run', 'tiny'); await app.tick(10);
  app.set('run-title', 'Planned during a read').set('plan-when', '2099-01-01T09:00');
  app.chooseApprovers();
  /* A read starts and lists the plans before the plan is written, then is held there. */
  const fsl = app.fs.list.bind(app.fs), g = gate(); let held = 0;
  app.fs.list = function (p) { if (!held && /^proposals\/?$/.test(p)) { held = 1; const before = fsl(p); return g.p.then(() => before); } return fsl(p); };
  const was = app.PF.perf.n['load.done'] || 0;
  app.click('refresh'); await app.tick(20);
  assert.strictEqual(held, 1, 'set-up: a read is held on the plans listing');
  app.submitForm('plan-form'); await app.tick(60);
  assert.ok(Object.keys(app.fs.files).some(f => /^proposals\/plan-tiny-[a-z0-9]{8}\.json$/.test(f)), 'set-up: the plan is written while the read is held');
  assert.strictEqual(app.PF.perf.n['load.done'] || 0, was, 'set-up: the held read hasn\'t finished');
  g.open(); await app.tick(200);
  app.fs.list = fsl;
  const id = Object.keys(app.fs.files).filter(f => /^proposals\/plan-tiny-[a-z0-9]{8}\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(p => p.title === 'Planned during a read')[0].id;
  const h = app.html();
  assert.ok(/id="jp-h">Just planned</.test(h) && new RegExp('id="card-' + id + '"').test(h), 'drawn in Just planned');
  assert.strictEqual(app.activeId(), 'card-' + id, 'focused');
  assert.ok(options(h, 'rf-process').some(x => x[0] === 'versions' && x[2]), 'the filter unchanged');
});

const todos = h => [...h.matchAll(/<li class="todo (?!ack)[^"]*" id="(todo-_[A-Za-z0-9_]+)"/g)].map(m => m[1]);
rule('Home: Needs you shows 10 and Show more adds 10, focusing the first one added; the count says how many need you, and only drawn rows are built (a counted draw)', async () => {
  const app = await bigApp();
  app.click('nav', 'home'); await app.tick(10);
  let h = app.html();
  assert.strictEqual(todos(h).length, 10);
  const n = +(/(\d+) things need you\./.exec(h) || [])[1];
  assert.ok(n > 20, 'the count is every one: ' + n);
  app.PF.perf.n['home.todo'] = 0; let r0 = app.PF.perf.n.render || 0;
  app.click('dismiss'); await app.tick(5);
  let draws = (app.PF.perf.n.render || 0) - r0;
  assert.ok(draws >= 1 && app.PF.perf.n['home.todo'] === 10 * draws, 'each draw builds the 10 drawn rows, not ' + n + ': ' + app.PF.perf.n['home.todo'] + ' in ' + draws);
  const d = moreOf(h, 'home-todo'), first = todos(h);
  /* The 11th row's title, by an id from what the row is (2.11), never its place. */
  assert.ok(d && /^#todo-_[A-Za-z0-9_]+-t$/.test(d.focus) && first.indexOf(d.focus.slice(1, -2)) < 0, JSON.stringify(d));
  app.click('more', 'home-todo', d); await app.tick(5);
  h = app.html();
  assert.strictEqual(todos(h).length, 20, 'Show more adds 10');
  assert.strictEqual(todos(h)[10], d.focus.slice(1, -2), 'the first one added');
  assert.ok(app.node(d.focus) && app.doc.activeElement === app.node(d.focus), 'focus on the first one added');
  app.PF.perf.n['home.todo'] = 0; r0 = app.PF.perf.n.render || 0;
  app.click('dismiss'); await app.tick(5);
  draws = (app.PF.perf.n.render || 0) - r0;
  assert.ok(draws >= 1 && app.PF.perf.n['home.todo'] === 20 * draws);
});

rule('Home: Your corrections shows 10 of 30, and Show more adds 10', () => {
  const PF = loadViews(), V = PF.views, people = [{ id: 'person-casey', name: 'Casey Nguyen' }];
  const acks = Array.from({ length: 30 }, (x, i) => ({ key: 'k' + i, kind: 'declined', by: 'person-casey', reason: 'Reason <' + i + '>', process: 'release', group: { target: { kind: 'step', step: 's' + i }, text: 'Step ' + i } }));
  const state = { view: 'home', me: 'person-casey', more: {}, unfold: {}, disc: {} };
  const ctx = { state, data: { people, runs: [], plans: [], processes: [], drafts: [], skills: [], legacy: [], validations: [] }, now: () => Date.now(), peopleById: { 'person-casey': people[0] }, processes: () => [], processTitle: id => id, acks: () => acks, findRun: () => null };
  let h = V.home(ctx);
  assert.strictEqual((h.match(/<li class="todo ack/g) || []).length, 10);
  assert.ok(/Reason &lt;0&gt;/.test(h) && !/Reason <0>/.test(h), 'escaped');
  const d = moreOf(h, 'home-acks'), dk = k => PF.vk.domKey(k);
  /* Each row by its acknowledgment's key (2.11), never its place. */
  assert.ok(d && d.next === 'k10' && d.focus === '#ack-' + dk('k10') + '-t' && /Show 10 more/.test(h), JSON.stringify(d));
  state.more['home-acks'] = 20;
  h = V.home(ctx);
  assert.strictEqual((h.match(/<li class="todo ack/g) || []).length, 20);
  assert.ok(h.indexOf('id="ack-' + dk('k19') + '"') >= 0 && h.indexOf('id="ack-' + dk('k20') + '"') < 0);
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

/* ---------- Checks, Why is this here?, notices, copies, proposal review, What's in the folder, Flight plan ---------- */
const lis = (h, re) => (h.match(re) || []).length;
rule('Checks with 400 commands to fill in draw 50 in the overview and the editor, build only those, and publishing is still blocked on all of them', async () => {
  const app = await bigApp();
  app.click('nav', 'processes'); await app.tick(5);
  app.PF.perf.n['checks.row'] = 0;
  app.click('open-process', 'commands'); await app.tick(10);
  let h = app.html();
  assert.strictEqual(lis(h, /<li id="checks-ov-_[A-Za-z0-9_]+"/g), 50, 'the overview draws 50');
  const d = moreOf(h, 'checks-ov');
  assert.ok(d && /Showing 50 of 40\d/.test(h), 'and says how many there are');
  app.PF.perf.n['checks.row'] = 0; const c0 = app.PF.perf.n.render || 0; app.click('dismiss'); await app.tick(5);
  const cd = (app.PF.perf.n.render || 0) - c0;
  assert.ok(cd >= 1 && app.PF.perf.n['checks.row'] === 50 * cd, 'each draw builds 50 rows: ' + app.PF.perf.n['checks.row'] + ' in ' + cd);
  app.click('more', 'checks-ov', d); await app.tick(5);
  assert.strictEqual(lis(app.html(), /<li id="checks-ov-_[A-Za-z0-9_]+"/g), 100);
  assert.ok(app.node(d.focus) && app.doc.activeElement === app.node(d.focus), 'Show more focuses the first one added');
  app.click('ptab', 'edit'); await app.tick(10); app.click('ins-tab', 'checks'); await app.tick(10);
  h = app.html();
  assert.strictEqual(lis(h, /<li id="checks-ed-_[A-Za-z0-9_]+"/g), 50, 'the editor draws 50');
  assert.ok(/aria-label="Checks: 40\d tips"/.test(h), 'and counts every one: ' + (/aria-label="Checks: [^"]*"/.exec(h) || [''])[0]);
  /* 400 things to fix: 50 drawn, and Publish is held for all 400. */
  const steps = Array.from({ length: 400 }, (x, i) => '- [ ] {no.such.type} Blocked step ' + i + ' {#b' + i + '}\n').join('');
  await app.fs.write('maps/drafts/blocked.md', '---\nprocess: blocked\ntitle: Blocked\nowner: person-avery\n---\n\n## Only · READ-DO {#only}\n' + steps);
  app.click('nav', 'processes'); await app.tick(5); app.focus(); await app.tick(200);
  app.click('open-process', 'blocked'); await app.tick(10);
  h = app.html();
  assert.strictEqual(lis(h, /<li id="checks-ov-_[A-Za-z0-9_]+"/g), 50, 'the overview draws 50 of 400 to fix');
  assert.ok(lis(h, /<span class="lvl bad">Fix<\/span>/g) === 50 && /Showing 50 of 4\d\d/.test(h));
  assert.ok(/data-act="publish" data-id="blocked"[^>]*disabled/.test(h), 'Publish is held');
  app.click('ptab', 'edit'); await app.tick(10); app.click('ins-tab', 'checks'); await app.tick(10);
  assert.ok(/aria-label="Checks: 4\d\d things to fix before publishing"/.test(app.html()), 'the editor counts every one');
});

rule('Why is this here? with 300 members draws 20, each with its whole reason and the run it came from, built only when drawn', async () => {
  const app = await bigApp(), { facts } = fixture();
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', facts.landed); await app.tick(10);
  app.click('select', 's0'); await app.tick(10);
  let h = app.html();
  const runs = lis(h, /<button class="linkish" id="pm-s0-_[A-Za-z0-9_]+-run"/g), whys = lis(h, /<dt id="pm-s0-_[A-Za-z0-9_]+" tabindex="-1">Why · /g);
  assert.strictEqual(runs, 20, '20 source runs');
  assert.strictEqual(whys, 20, 'and their 20 reasons');
  assert.ok(/Suggested in 300 runs: /.test(h) && /, and 280 more<\/p>/.test(h), 'the count is all of them');
  app.PF.perf.n['prov.member'] = 0; const p0 = app.PF.perf.n.render || 0; app.click('dismiss'); await app.tick(5);
  const pd = (app.PF.perf.n.render || 0) - p0;
  assert.ok(pd >= 1 && app.PF.perf.n['prov.member'] === 20 * pd, 'built only when drawn: ' + app.PF.perf.n['prov.member'] + ' in ' + pd);
  const d = moreOf(h, 'prov-s0');
  app.click('more', 'prov-s0', d); await app.tick(5);
  assert.strictEqual(lis(app.html(), /<button class="linkish" id="pm-s0-_[A-Za-z0-9_]+-run"/g), 40);
  assert.ok(app.node(d.focus) && app.doc.activeElement === app.node(d.focus), 'Show more focuses the first added member\'s reason: ' + d.focus);
});

rule('300 unreadable note lines are one notice, announced once, with the lines 50 at a time in its fold, every file and line reachable', async () => {
  const app = await bigApp(), { facts } = fixture();
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', facts.busy); await app.tick(10);
  let h = app.html();
  assert.strictEqual(lis(h, /couldn't be read\. It may still be arriving|couldn&#39;t be read\. It may still be arriving/g), 0, 'no notice per line');
  assert.strictEqual(lis(h, /note lines can(&#39;|')t be read\./g), 1, 'one summary');
  assert.ok(/<b role="status">300 note lines can/.test(h), 'announced once, with the count');
  app.fire('toggle', { target: { dataset: { disc: 'badnotes:' + facts.busy }, open: true } }); app.click('dismiss'); await app.tick(5);
  h = app.html();
  assert.strictEqual(lis(h, /<li id="badnote-_[A-Za-z0-9_]+"/g), 50, '50 in the fold');
  let seen = lis(h, /<li id="badnote-_[A-Za-z0-9_]+"/g);
  for (let i = 0; i < 10 && moreOf(app.html(), 'badnotes'); i++) { const d = moreOf(app.html(), 'badnotes'); app.click('more', 'badnotes', d); await app.tick(5); assert.ok(app.doc.activeElement === app.node(d.focus), 'focus on the first added line'); }
  seen = lis(app.html(), /<li id="badnote-_[A-Za-z0-9_]+"/g);
  assert.strictEqual(seen, 300, 'every line reachable');
  assert.ok(/<code>[^<]+\.jsonl<\/code>, line \d+/.test(app.html()), 'file and line');
});

rule('A run with 300 recovery copies draws 20; the copy being compared, and the one being confirmed for deletion, stay drawn through Show more and a refresh', async () => {
  const app = await bigApp(), { facts } = fixture();
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', facts.copies); await app.tick(10);
  let h = app.html();
  const rows = h => [...h.matchAll(/<code id="copy-([^"]+)" tabindex="-1">/g)].map(m => un(m[1]));
  assert.strictEqual(rows(h).length, 20, '20 copies');
  assert.ok(/300 other versions of this run|30\d other versions of this run/.test(h), 'the heading counts every one');
  let d = moreOf(h, 'copies');
  app.click('more', 'copies', d); await app.tick(5);
  assert.strictEqual(rows(app.html()).length, 40);
  assert.ok(app.doc.activeElement === app.node(d.focus), 'focus on the first added copy\'s name');
  for (let i = 0; i < 6; i++) { d = moreOf(app.html(), 'copies'); app.click('more', 'copies', d); await app.tick(5); }
  const all = rows(app.html()), c150 = all[149];
  assert.ok(c150, 'set-up: copy 150 drawn');
  /* Back to a page of 20, then compare copy 150 (as its own Compare would, drawn). */
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', facts.copies); await app.tick(10);
  assert.ok(rows(app.html()).indexOf(c150) < 0, 'set-up: copy 150 past the page');
  app.click('compare-copy', c150); await app.tick(40);
  h = app.html();
  assert.ok(rows(h).length <= 21 && rows(h).indexOf(c150) >= 0, 'compared: drawn after the page, ' + rows(h).length);
  assert.ok(/The copy you(&#39;|')re working on/.test(h));
  await reread(app);
  assert.ok(rows(app.html()).indexOf(c150) >= 0, 'and after a refresh');
  d = moreOf(app.html(), 'copies'); app.click('more', 'copies', d); await app.tick(5);
  assert.strictEqual(rows(app.html()).filter(x => x === c150).length, 1, 'and through Show more, once');
  const c200 = all[199] || all[all.length - 1];
  app.click('delete-copy', c200); await app.tick(5);
  assert.ok(rows(app.html()).indexOf(c200) >= 0 && new RegExp('data-act="delete-copy" data-id="' + c200.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '">Yes, delete it').test(app.html()), 'the one being deleted, with its confirm');
  app.click('unpick'); await app.tick(5);
});

rule('Proposal review with 300 records draws 20 in the dialog, Show more focuses inside it, and what it allows still reads every record', async () => {
  const app = await bigApp();
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'versions'); await app.tick(10);
  const m = /data-act="prop-review" data-id="([^"]+)"/.exec(app.html());
  assert.ok(m, 'set-up: a proposal');
  app.click('prop-review', un(m[1])); await app.tick(80);
  let o = app.overlay();
  assert.ok(/What happened before \((\d+)\)/.test(o) && +/What happened before \((\d+)\)/.exec(o)[1] >= 300, 'every record counted');
  assert.strictEqual(lis(o, /<li id="prop-rec-_[A-Za-z0-9_]+"/g), 20);
  const d = moreOf(o, 'prop-recs');
  assert.ok(d && d.dialog === '1', 'Show more in a dialog');
  app.click('more', 'prop-recs', d); await app.tick(10);
  o = app.overlay();
  assert.strictEqual(lis(o, /<li id="prop-rec-_[A-Za-z0-9_]+"/g), 40);
  assert.ok(app.doc.activeElement === app.node(d.focus), 'focus inside the dialog, on the first added record');
  app.click('close-overlay'); await app.tick(5);
});

rule('What\'s in the folder with 300 areas draws 50, largest first, and Show more focuses the first one added', async () => {
  const app = await bigApp();
  app.click('nav', 'settings'); await app.tick(5); app.click('health'); await app.tick(40);
  for (let i = 0; i < 200 && !/What's in the folder|What&#39;s in the folder/.test(app.html()); i++) await app.tick(20);
  app.fire('toggle', { target: { dataset: { disc: 'hz-areas' }, open: true } }); app.click('dismiss'); await app.tick(5);
  let h = app.html();
  const areas = h => [...h.matchAll(/<code id="hz-area-([^"]+)" tabindex="-1">/g)].map(m => un(m[1]));
  assert.strictEqual(areas(h).length, 50);
  assert.ok(/data-disc="hz-areas" open/.test(h), 'its fold stays open');
  const d = moreOf(h, 'hz-areas');
  app.click('more', 'hz-areas', d); await app.tick(5);
  assert.strictEqual(areas(app.html()).length, 100);
  assert.ok(app.doc.activeElement === app.node(d.focus), 'focus on the first added');
});

rule('Flight plan: 300 skills on a step and 300 for the whole checklist draw 3 per line and "+N more skills", building only those', async () => {
  const app = await bigApp();
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'steps'); await app.tick(10);
  app.PF.perf.n['fp.skill'] = 0;
  app.click('flight', 'plan'); await app.tick(10);
  app.click('fp-steps', 'show'); await app.tick(10);
  const h = app.html();
  assert.ok(/\+297 more skills/.test(h), '+N more: ' + (h.match(/\+\d+ more skills?/g) || []).join(', '));
  assert.ok(lis(h, /class="badge b-skill"/g) <= 3, 'a step names 3 skills');
  assert.ok(lis(h, /<b>Autopilot<\/b>/g) <= 6, 'the start line and the phase line name 3 each');
  app.PF.perf.n['fp.skill'] = 0; const f0 = app.PF.perf.n.render || 0; app.click('dismiss'); await app.tick(5);
  const fd = (app.PF.perf.n.render || 0) - f0;
  assert.ok(fd >= 1 && app.PF.perf.n['fp.skill'] <= 9 * fd, 'built only those: ' + app.PF.perf.n['fp.skill'] + ' in ' + fd);
  app.click('flight', 'list'); await app.tick(5);
});

/* ---------- Start and Plan's roles; removed drafts ---------- */
rule('Plan a run on a 300-role checklist: 20 role rows, Find reaches role 300, Show more focuses the first new one, chosen roles stay through Show more, Find and a refresh, and the plan saves the roles 2.10 saves', async () => {
  const app = await bigApp();
  const open = async () => { app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'roles'); await app.tick(10); app.click('plan-run', 'roles'); await app.tick(20); };
  const roleRows = h => [...h.matchAll(/<label class="field" for="role-(r\d+)"/g)].map(m => m[1]);
  /* What every role would be with nothing paged (2.10's form). */
  app.PF.vk.PAGE_OFF = 'start-roles';
  await open();
  const want = {};
  for (const m of app.html().matchAll(/<select id="role-(r\d+)" data-role="[^"]*"[^>]*>([\s\S]*?)<\/select>/g)) { const sel = /<option value="([^"]+)" selected>/.exec(m[2]); if (sel) want[m[1]] = sel[1]; }
  assert.strictEqual(roleRows(app.html()).length, 300, 'set-up: every role, paging off');
  app.PF.vk.PAGE_OFF = null;
  app.click('cancel-plan'); await app.tick(5);
  await open();
  let h = app.html();
  assert.deepStrictEqual(roleRows(h), Array.from({ length: 20 }, (x, i) => 'r' + (i + 1)), '20, in checklist order');
  assert.strictEqual(lis(h, /<input type="hidden" id="role-r\d+" data-role=/g), 280, 'the rest keep their values');
  assert.ok(/id="find-start-roles"/.test(h), 'Find a role');
  app.set('role-r5', 'person-blake'); app.select('role-r5', 'person-blake'); await app.tick(5);
  await typeFind(app, 'start-roles', 'r250');
  h = app.html();
  /* Code review round 12: with Find the page is the matches; a chosen role Find leaves out is an ordinary kept row, its value
     in its hidden field. */
  const hiddenVal = (h, r) => { const m = new RegExp('<input type="hidden" id="role-' + r + '" data-role="' + r + '" value="([^"]*)"').exec(h); return m ? m[1] : null; };
  assert.deepStrictEqual(roleRows(h), ['r250'], 'Find reaches role 250, the one match');
  assert.strictEqual(hiddenVal(h, 'r5'), 'person-blake', 'the chosen r5 keeps its value in its hidden field');
  app.set('role-r250', 'person-morgan'); app.select('role-r250', 'person-morgan'); await app.tick(5);
  await typeFind(app, 'start-roles', 'r300');
  h = app.html();
  assert.deepStrictEqual(roleRows(h), ['r300'], 'Find reaches role 300, the one match');
  assert.ok(hiddenVal(h, 'r5') === 'person-blake' && hiddenVal(h, 'r250') === 'person-morgan', 'both chosen roles keep their values');
  app.click('find-clear', 'start-roles'); await app.tick(5);
  const d = moreOf(app.html(), 'start-roles');
  app.click('more', 'start-roles', d); await app.tick(5);
  h = app.html();
  assert.strictEqual(roleRows(h).filter(r => r !== 'r250').length, 40, 'Show more adds 20');
  assert.strictEqual(app.activeId(), 'role-r21', 'focus on the first new one');
  app.set('run-title', 'Planned with 300 roles').set('plan-when', '2099-02-01T09:00');
  app.el('find-start-roles') && app.el('role-r21').focus();
  await reread(app);
  h = app.html();
  assert.ok(roleRows(h).indexOf('r250') >= 0 && roleRows(h).indexOf('r5') >= 0, 'chosen roles survive a refresh');
  assert.strictEqual(app.el('role-r5').value, 'person-blake');
  assert.strictEqual(app.el('role-r250').value, 'person-morgan');
  app.chooseApprovers().submitForm('plan-form'); await app.tick(120);
  const made = Object.keys(app.fs.files).filter(f => /^proposals\/plan-roles-[a-z0-9]{8}\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(p => p.title === 'Planned with 300 roles');
  assert.strictEqual(made.length, 1, 'the plan is saved');
  assert.deepStrictEqual(made[0].roles, Object.assign({}, want, { r5: 'person-blake', r250: 'person-morgan' }), 'every role as 2.10 saves it, with the two chosen');
});

rule('Plan on 300 roles: Find role 21, give it someone, Clear, then Show more adds the 20 roles after it, focusing role 22, never the kept one', async () => {
  const app = await bigApp();
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'roles'); await app.tick(10); app.click('plan-run', 'roles'); await app.tick(20);
  const roleRows = h => [...h.matchAll(/<label class="field" for="role-(r\d+)"/g)].map(m => m[1]);
  await typeFind(app, 'start-roles', 'r21');
  assert.ok(roleRows(app.html()).indexOf('r21') >= 0, 'set-up: Find reaches role 21');
  app.set('role-r21', 'person-blake'); app.select('role-r21', 'person-blake'); await app.tick(5);
  app.click('find-clear', 'start-roles'); await app.tick(5);
  let h = app.html();
  assert.deepStrictEqual(roleRows(h), Array.from({ length: 21 }, (x, i) => 'r' + (i + 1)), 'roles 1-20, and the kept role 21');
  const d = moreOf(h, 'start-roles');
  assert.strictEqual(d.next, 'r22', 'Show more names the first role not drawn');
  assert.strictEqual(d.focus, '[id="role-r22"]');
  assert.ok(/>Show 20 more</.test(h), 'and says how many it adds');
  app.click('more', 'start-roles', d); await app.tick(5);
  h = app.html();
  const rows = roleRows(h);
  assert.deepStrictEqual(rows, Array.from({ length: 41 }, (x, i) => 'r' + (i + 1)), '20 more: roles 1-41, each once');
  assert.strictEqual(app.activeId(), 'role-r22', 'focus on the first one added');
  assert.strictEqual(app.el('role-r21').value, 'person-blake', 'the kept choice stays');
  app.click('cancel-plan'); await app.tick(5);
});

/* ---------- the other forms that ask for every role (code review of 2.11) ---------- */
const roleRowsOf = (h, pre) => [...h.matchAll(new RegExp('<label class="field" for="' + pre + '(r\\d+)"', 'g'))].map(m => m[1]);
/* What a form sends for every role with nothing paged: each drawn select's chosen person. */
function rolesDrawn(h, pre) { const out = {}; for (const m of h.matchAll(new RegExp('<select id="' + pre + '(r\\d+)" data-role="[^"]*"[^>]*>([\\s\\S]*?)</select>', 'g'))) { const sel = /<option value="([^"]+)" selected>/.exec(m[2]); out[m[1]] = sel ? sel[1] : ''; } return out; }

rule('Start a test run on 300 roles: 20 role rows with Find, a changed role kept through Find and Show more, and the test run starts with the roles 2.10 gives it', async () => {
  const app = await bigApp();
  const open = async () => { app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'roles'); await app.tick(10); const m = /data-act="start-test" data-id="([^"]+)"/.exec(app.html()); assert.ok(m, 'set-up: the staged version'); app.click('start-test', m[1]); await app.tick(10); };
  app.PF.vk.PAGE_OFF = 'test-roles';
  await open();
  const want = rolesDrawn(app.html(), 'role-');
  assert.strictEqual(Object.keys(want).length, 300, 'set-up: every role, paging off');
  app.PF.vk.PAGE_OFF = null;
  await open();
  let h = app.html();
  assert.deepStrictEqual(roleRowsOf(h, 'role-'), Array.from({ length: 20 }, (x, i) => 'r' + (i + 1)), '20, in checklist order');
  assert.strictEqual(lis(h, /<input type="hidden" id="role-r\d+" data-role=/g), 280, 'the rest keep their values');
  assert.ok(/id="find-test-roles"/.test(h), 'Find a role');
  await typeFind(app, 'test-roles', 'r250');
  assert.deepStrictEqual(roleRowsOf(app.html(), 'role-'), ['r250'], 'Find reaches role 250');
  app.set('role-r250', 'person-morgan'); app.select('role-r250', 'person-morgan'); await app.tick(5);
  app.click('find-clear', 'test-roles'); await app.tick(5);
  h = app.html();
  assert.ok(roleRowsOf(h, 'role-').indexOf('r250') >= 0 && roleRowsOf(h, 'role-').length === 21, 'the changed role stays drawn');
  await more(app, 'test-roles');
  assert.strictEqual(roleRowsOf(app.html(), 'role-').length, 41);
  assert.strictEqual(app.activeId(), 'role-r21');
  app.set('run-title', 'Test with 300 roles').submitForm('start-form'); await app.tick(200);
  const made = Object.keys(app.fs.files).filter(f => /^runs\/roles\/[^/]+\/run\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(r => r.title === 'Test with 300 roles');
  assert.strictEqual(made.length, 1, 'the test run is saved');
  assert.deepStrictEqual(made[0].roles, Object.assign({}, want, { r250: 'person-morgan' }), 'every role as 2.10 gives it, with the one changed');
});

rule('A linked step starting a 300-role run: its dialog draws 20 roles with Find, a changed role is kept through Find and Show more, and the child starts with the roles 2.10 gives it', async () => {
  const app = await bigApp();
  const open = async () => { app.click('nav', 'home'); await app.tick(5); app.click('open-run', fixture().facts.rolelink); await app.tick(10); if (/data-act="takeover"/.test(app.html())) { app.click('takeover'); await app.tick(40); } app.click('select', 'kid'); await app.tick(10); app.click('start-child', 'kid'); await app.tick(20); };
  app.PF.vk.PAGE_OFF = 'cs-roles';
  await open();
  const want = rolesDrawn(app.overlay(), 'cs-role-');
  assert.strictEqual(Object.keys(want).length, 300, 'set-up: every role, paging off');
  app.PF.vk.PAGE_OFF = null; app.click('close-overlay'); await app.tick(5);
  await open();
  let h = app.overlay();
  assert.deepStrictEqual(roleRowsOf(h, 'cs-role-'), Array.from({ length: 20 }, (x, i) => 'r' + (i + 1)), '20, in checklist order');
  assert.strictEqual(lis(h, /<input type="hidden" id="cs-role-r\d+" data-role=/g), 280, 'the rest keep their values');
  await typeFind(app, 'cs-roles', 'r250');
  assert.deepStrictEqual(roleRowsOf(app.overlay(), 'cs-role-'), ['r250'], 'Find reaches role 250');
  app.set('cs-role-r250', 'person-morgan'); app.select('cs-role-r250', 'person-morgan'); await app.tick(5);
  app.click('find-clear', 'cs-roles'); await app.tick(5);
  h = app.overlay();
  assert.ok(roleRowsOf(h, 'cs-role-').indexOf('r250') >= 0 && roleRowsOf(h, 'cs-role-').length === 21, 'the changed role stays drawn');
  assert.ok(/<option value="person-morgan" selected>/.test(h.slice(h.indexOf('id="cs-role-r250"'))), 'with its choice');
  const d = moreOf(h, 'cs-roles');
  assert.ok(d && d.dialog === '1', 'Show more in the dialog moves the dialog\'s focus');
  app.click('more', 'cs-roles', d); await app.tick(5);
  assert.strictEqual(roleRowsOf(app.overlay(), 'cs-role-').length, 41);
  app.set('cs-ticket', 'T-300'); app.input('cs-ticket', 'T-300'); await app.tick(5);
  app.submitForm('child-start-form'); await app.tick(200);
  const made = Object.keys(app.fs.files).filter(f => /^runs\/roleskid\/[^/]+\/run\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t));
  assert.strictEqual(made.length, 1, 'the child is started: ' + made.length);
  assert.deepStrictEqual(made[0].roles, Object.assign({}, want, { r250: 'person-morgan' }), 'every role as 2.10 gives it, with the one changed');
});

rule('A run\'s Details with 300 roles: Add people draws 20 role chips with Find; the role being edited stays drawn through Find and Show more', async () => {
  const app = await bigApp();
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', fixture().facts.roles); await app.tick(10);
  if (/data-act="takeover"/.test(app.html())) { app.click('takeover'); await app.tick(40); }
  if (!/id="rw-details"/.test(app.html())) { app.click('run-details'); await app.tick(5); }
  if (/data-act="show-roles"/.test(app.html())) { app.click('show-roles'); await app.tick(5); }
  const chips = h => [...h.matchAll(/data-act="edit" data-id="role:(r\d+)"/g)].map(m => m[1]);
  let h = app.html();
  assert.deepStrictEqual(chips(h), Array.from({ length: 20 }, (x, i) => 'r' + (i + 1)), '20 chips, in checklist order');
  assert.ok(/id="find-det-roles"/.test(h), 'Find a role');
  await typeFind(app, 'det-roles', 'r250');
  assert.deepStrictEqual(chips(app.html()), ['r250']);
  app.click('edit', 'role:r250'); await app.tick(5);
  app.click('find-clear', 'det-roles'); await app.tick(5);
  h = app.html();
  assert.ok(/data-scope="edit:role:r250"/.test(h) && /You(&#39;|')re editing this one/.test(h), 'the role being edited stays, labeled');
  const d = moreOf(h, 'det-roles');
  assert.strictEqual(d.next, 'r21');
  app.click('more', 'det-roles', d); await app.tick(5);
  assert.strictEqual(chips(app.html()).length, 40, '20 more chips');
  assert.strictEqual(app.activeId(), '[data-act="edit"][data-id="role:r21"]', 'focus on the first one added');
  app.click('unedit'); await app.tick(5);
});

/* Code review round 2. */
const hiddenOfAt = (h, role) => (new RegExp('<input type="hidden" id="role-' + role + '" data-role="[^"]*" value="([^"]*)"').exec(h) || [])[1];
/* As Blake, who isn't the rotation's suggestion for these roles (no one who never had one is), so only Just me puts Blake in them. */
rule('Plan on 300 roles: Just me sets every role, drawn or not, and it stays so through Show more, Find and a refresh; the plan saves you in every role', async () => {
  const app = await bigApp();
  app.choose('person-blake'); await app.tick(5);
  try {
    app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'roles'); await app.tick(10); app.click('plan-run', 'roles'); await app.tick(20);
    const selOf = (h, role) => { const m = new RegExp('<select id="role-' + role + '"[^>]*>([\\s\\S]*?)</select>').exec(h); return m && (/<option value="([^"]+)" selected>/.exec(m[1]) || [])[1]; };
    let h = app.html();
    assert.ok(/data-act="just-me"/.test(h), 'set-up: Just me');
    assert.ok(selOf(h, 'r2') !== 'person-blake' && hiddenOfAt(h, 'r200') !== 'person-blake', 'set-up: Blake isn\'t suggested');
    app.click('just-me'); await app.tick(5);
    h = app.html();
    assert.strictEqual(selOf(h, 'r2'), 'person-blake', 'a drawn role is you');
    assert.strictEqual(hiddenOfAt(h, 'r200'), 'person-blake', 'a role not drawn is you too');
    await more(app, 'start-roles');
    assert.strictEqual(selOf(app.html(), 'r21'), 'person-blake', 'a role Show more draws is you');
    await typeFind(app, 'start-roles', 'r250');
    assert.strictEqual(selOf(app.html(), 'r250'), 'person-blake', 'and one Find reaches');
    app.click('find-clear', 'start-roles'); await app.tick(5);
    app.set('run-title', 'Just me on 300 roles').set('plan-when', '2099-03-01T09:00');
    await reread(app);
    h = app.html();
    assert.strictEqual(hiddenOfAt(h, 'r300'), 'person-blake', 'through a refresh');
    app.chooseApprovers().submitForm('plan-form'); await app.tick(120);
    const made = Object.keys(app.fs.files).filter(f => /^proposals\/plan-roles-[a-z0-9]{8}\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(p => p.title === 'Just me on 300 roles');
    assert.strictEqual(made.length, 1, 'the plan is saved');
    const roles = made[0].roles;
    assert.strictEqual(Object.keys(roles).length, 300);
    assert.deepStrictEqual(Object.keys(roles).filter(k => roles[k] !== 'person-blake'), [], 'every role is you');
  } finally { app.click('nav', 'runs'); await app.tick(5); app.choose('person-avery'); await app.tick(5); }
});

rule('A run\'s Details with 300 roles, seen by someone who isn\'t recording: Show 20 more focuses the first role it adds, in a wrapper that takes focus', async () => {
  const app = await bigApp();
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', fixture().facts.rolesTeam); await app.tick(10);
  if (!/id="rw-details"/.test(app.html())) { app.click('run-details'); await app.tick(5); }
  let h = app.html();
  assert.ok(/<span class="chip-at" id="det-role-r1" tabindex="-1"><button class="chip[^"]*" data-act="edit" data-id="role:r1" disabled>/.test(h), 'a viewer\'s chip is disabled, in a wrapper that takes focus');
  const d = moreOf(h, 'det-roles');
  assert.strictEqual(d.focus, '[id="det-role-r21"]');
  app.click('more', 'det-roles', d); await app.tick(5);
  assert.strictEqual(app.activeId(), 'det-role-r21', 'focus on the first one added');
});

rule('Many removed drafts are one notice on Checklists, announced once, with a way to each 50 at a time; Show more focuses the first added, and each editor\'s text is kept', async () => {
  const fx = fixture({ size: { running: 2, plans: 0, ended: 3, followUps: 6, procs: 2, versions: 2, stages: 1, members: 1, health: 1, many: 2, steps: 8, legacy: 1, archived: 1, hot: 1, teamValues: 1, people: 6, tags: 2 } });
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fx);
  const N = 60, id = i => 'lost-' + String(i).padStart(3, '0');
  for (let i = 0; i < N; i++) await app.fs.write('maps/drafts/' + id(i) + '.md', '---\nprocess: ' + id(i) + '\ntitle: Lost ' + i + '\nowner: person-avery\n---\n\n## Only · READ-DO {#only}\n- [ ] Step {#s}\n');
  app.click('nav', 'processes'); await app.tick(5); app.focus(); await app.tick(300);
  for (let i = 0; i < N; i++) {
    app.click('open-process', id(i)); await app.tick(5); app.click('ptab', 'edit'); await app.tick(5);
    const text = /<textarea[^>]*id="draft-editor"[^>]*>([\s\S]*?)<\/textarea>/.exec(app.html())[1];
    app.input('draft-editor', un(text) + '\nEDITED ' + i); await app.tick(5);
  }
  app.click('nav', 'processes'); await app.tick(5);
  for (let i = 0; i < N; i++) delete app.fs.files['maps/drafts/' + id(i) + '.md'];
  await reread(app);
  let h = app.html();
  assert.strictEqual(lis(h, /whose draft was removed from the folder/g), 0, 'no notice per draft');
  assert.ok(/<b role="status">60 drafts you were editing aren(&#39;|')t in the folder anymore\.<\/b>/.test(h), 'one notice, announced once');
  app.fire('toggle', { target: { dataset: { disc: 'lost-drafts' }, open: true } }); app.click('dismiss'); await app.tick(5);
  h = app.html();
  const links = h => lis(h, /<li><button class="linkish" data-act="open-process" data-id="lost-\d+">/g);
  assert.strictEqual(links(h), 50);
  const d = moreOf(h, 'lost-drafts');
  app.click('more', 'lost-drafts', d); await app.tick(5);
  assert.strictEqual(links(app.html()), 60);
  assert.ok(app.doc.activeElement === app.node(d.focus), 'focus on the first added link');
  app.click('open-process', id(55)); await app.tick(10);
  assert.ok(/EDITED 55/.test(app.html()), 'its edits are kept');
});


/* Code review round 3. */
/* A role choice is still unsaved after a redraw draws it as the control's own value: go() and the browser's Back refuse, as
   2.10 refuses a choice not redrawn, whether it's a drawn role, Just me, a role past the first 20, or only roles not drawn. */
async function planForm(app) {
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'roles'); await app.tick(10); app.click('plan-run', 'roles'); await app.tick(20);
  assert.ok(/id="plan-form"/.test(app.html()), 'set-up: the Plan form');
}
const selOfAt = (h, role) => { const m = new RegExp('<select id="role-' + role + '"[^>]*>([\\s\\S]*?)</select>').exec(h); return m ? (/<option value="([^"]+)" selected>/.exec(m[1]) || [, ''])[1] : null; };
async function refused(app, what) {
  await reread(app);
  const at = app.url();
  app.click('go', null, { view: 'process', process: 'tiny' }); await app.tick(10);
  assert.ok(/id="plan-form"/.test(app.html()) && app.url() === at, what + ': go() refused');
  app.back(); await app.settle();
  assert.ok(/id="plan-form"/.test(app.html()), what + ': Back refused');
}
async function leavePlan(app) { app.click('cancel-plan'); await app.tick(10); app.click('nav', 'runs'); await app.tick(5); }
rule('Plan on 300 roles: a role changed, then a refresh: go() and Back are refused, as in 2.10', async () => {
  const app = await bigApp();
  await planForm(app);
  try {
    const was = selOfAt(app.html(), 'r2'), to = was === 'person-morgan' ? 'person-casey' : 'person-morgan';
    app.select('role-r2', to); await app.tick(5);
    await refused(app, 'a drawn role');
  } finally { await leavePlan(app); }
});
rule('Plan on 300 roles: Just me, then a refresh: go() and Back are refused', async () => {
  const app = await bigApp();
  app.choose('person-blake'); await app.tick(5);
  try {
    await planForm(app);
    app.click('just-me'); await app.tick(5);
    await refused(app, 'Just me');
  } finally { await leavePlan(app); app.choose('person-avery'); await app.tick(5); }
});
rule('Plan on 300 roles: a role Show more draws, changed, then a refresh: go() and Back are refused', async () => {
  const app = await bigApp();
  await planForm(app);
  try {
    await more(app, 'start-roles');
    const was = selOfAt(app.html(), 'r25'), to = was === 'person-morgan' ? 'person-casey' : 'person-morgan';
    app.select('role-r25', to); await app.tick(5);
    await refused(app, 'a role past the first 20');
  } finally { await leavePlan(app); }
});
rule('Plan on 300 roles: Just me, then the 20 drawn roles set back: the roles not drawn still count, so go() and Back are refused', async () => {
  const app = await bigApp();
  app.choose('person-blake'); await app.tick(5);
  try {
    await planForm(app);
    const h0 = app.html(), was = {};
    for (let i = 1; i <= 20; i++) was['r' + i] = selOfAt(h0, 'r' + i);
    assert.ok(hiddenOfAt(h0, 'r200') !== 'person-blake', 'set-up: role 200 isn\'t Blake');
    app.click('just-me'); await app.tick(5);
    for (let i = 1; i <= 20; i++) { app.select('role-r' + i, was['r' + i]); await app.tick(2); }
    assert.strictEqual(hiddenOfAt(app.html(), 'r200'), 'person-blake', 'set-up: role 200 is Blake, not drawn');
    await refused(app, 'roles not drawn');
  } finally { await leavePlan(app); app.choose('person-avery'); await app.tick(5); }
});

/* Show more in one list of a page never focuses the same item drawn in another list on it. */
rule('Skills: with 60 needing an update and Needs an update expanded, All skills\' Show more focuses its own row, not the same skill in Needs an update', () => {
  const PF = loadViews(), V = PF.views, mk = i => ({ skill: { name: 'sk ' + String(i).padStart(3, '0'), file: 'sk' + String(i).padStart(3, '0') + '.json', group: [], tags: [], implements: 1 }, status: { s: 'update', text: '' } });
  const procs = [{ id: 'p', title: 'P', group: [], category: 'C', latest: { info: { version: 1 } }, skills: Array.from({ length: 60 }, (x, i) => mk(i)) }];
  const ctx = { state: { tags: [], more: { 'sk-att': 100 } }, data: { validations: [], people: [], failed: {} }, processes: () => procs, peopleById: {}, run: () => null, now: () => Date.now() };
  const sp = V.skillsPage(ctx), allAt = sp.indexOf('id="all-h"');
  const d = moreOf(sp.slice(allAt), 'skills');
  assert.ok(d && d.focus, 'All skills has Show more');
  const m = /^\[id="([^"]+)"\]$/.exec(d.focus);
  assert.ok(m, 'focus names one row by its id: ' + d.focus);
  /* Before Show more, the row it adds isn't drawn anywhere; once drawn, the selector names it, in All skills, once. */
  const hits = (h, id) => [...h.matchAll(new RegExp('id="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g'))].map(x => x.index);
  assert.strictEqual(hits(sp, m[1]).length, 0, 'not drawn before Show more');
  assert.ok(new RegExp('data-act="open-skill" data-id="' + d.next + '"').test(sp.slice(0, allAt)), 'set-up: the same skill is drawn in Needs an update');
  ctx.state.more.skills = 100;
  const sp2 = V.skillsPage(ctx), at = hits(sp2, m[1]);
  assert.strictEqual(at.length, 1, 'that id is drawn once');
  assert.ok(at[0] > sp2.indexOf('id="all-h"'), 'in All skills');
  const att = moreOf(sp.slice(0, allAt), 'sk-att');
  assert.ok(!att, 'Needs an update is all drawn');
});
rule('Checklists: Show more in the list focuses its own row, not a lost-drafts link to the same checklist above it', () => {
  const PF = loadViews(), V = PF.views;
  const procs = Array.from({ length: 60 }, (x, i) => ({ id: 'q' + String(i).padStart(2, '0'), title: 'Q ' + String(i).padStart(2, '0'), group: ['G'], category: 'C', tags: [], skills: [], clashes: [], latest: { info: { version: 1, folder: 'v1' } } }));
  const ctx = { state: { tags: [], renamed: true, groupsOpen: { G: true } }, data: { validations: [], people: [], failed: {} }, processes: () => procs, lostDrafts: () => ['q50', 'q51'], peopleById: {}, run: () => null, now: () => Date.now() };
  const h = V.processesPage(ctx), d = moreOf(h, 'processes');
  assert.ok(d && d.next === 'q50', 'Show more adds q50: ' + JSON.stringify(d));
  assert.ok(/^#procs-all /.test(d.focus), 'scoped to the list: ' + d.focus);
  assert.ok(h.indexOf('id="procs-all"') > h.indexOf('data-act="open-process" data-id="q50"'), 'the lost-drafts link to q50 comes first on the page');
});

rule('Screen share of a team run with 300 roles: Who\'s on what draws 20 roles, and Show more adds 20 with focus on the first one added', async () => {
  const app = await bigApp();
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', fixture().facts.rolesTeam); await app.tick(10);
  assert.ok(/data-act="mission"/.test(app.html()), 'set-up: a team run has Screen share');
  app.click('mission'); await app.tick(10);
  const rows = h => [...h.matchAll(/<li id="ms-role-(r\d+)" tabindex="-1">/g)].map(m => m[1]);
  let h = app.html();
  assert.deepStrictEqual(rows(h), Array.from({ length: 20 }, (x, i) => 'r' + (i + 1)), '20, in checklist order');
  assert.ok(/<li id="ms-role-r1" tabindex="-1"><span>r1<\/span><span class="row">[\s\S]*?Blake/.test(h), 'with who has each');
  const d = moreOf(h, 'ms-roles:' + fixture().facts.rolesTeam);
  assert.ok(d && d.focus === '[id="ms-role-r21"]', 'Show more: ' + JSON.stringify(d));
  app.click('more', 'ms-roles:' + fixture().facts.rolesTeam, d); await app.tick(5);
  assert.strictEqual(rows(app.html()).length, 40);
  assert.strictEqual(app.activeId(), 'ms-role-r21', 'focus on the first one added');
  app.click('exit-mission'); await app.tick(5);
});


/* The test page reads a drawn screen as nodes once per redraw. A closing tag ends its element, so reading a 300-role form
   with every person in every select (150,000 nodes, the paging-off set-up above) takes well under a second, not minutes,
   and a node's ancestors are the elements it's inside, not every element before it. */
rule('The test page reads a big drawn screen in linear time, and a closing tag ends its element', () => {
  const app = boot({ domFocus: true });
  const sel = i => '<label class="field" for="s' + i + '">Role ' + i + '</label><select id="s' + i + '">' + Array.from({ length: 60 }, (x, j) => '<option value="v' + i + '-' + j + '">P ' + j + '</option>').join('') + '</select>';
  app.el('app')._html = '<form>' + Array.from({ length: 1500 }, (x, i) => sel(i)).join('') + '</form>';
  const t = Date.now();
  assert.ok(app.doc.querySelector('#s1499 option[value="v1499-59"]'), 'the last option, inside its select');
  assert.ok(Date.now() - t < 5000, 'read in ' + (Date.now() - t) + 'ms');
  assert.strictEqual(app.doc.querySelector('#s0 option[value="v1-0"]'), null, 'an option in the next select isn\'t inside the one before it');
  assert.strictEqual(app.doc.querySelector('label option'), null, 'a label closed before the select holds no options');
});

/* ---------- Code review round 4 ---------- */
/* A newer read that arrives on its own (the window coming back into focus), leaving focus where it is. */
async function arrive(app) {
  const was = app.PF.perf.n['load.done'] || 0;
  app.focus();
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(5);
}
/* A small folder whose Needs you is mostly plans, so one arriving early moves the rows below it. */
async function plansApp() {
  const fx = fixture({ size: { running: 1, plans: 30, ended: 2, followUps: 1, procs: 2, versions: 2, stages: 1, members: 1, health: 1, many: 2, steps: 8, legacy: 1, archived: 1, hot: 1, teamValues: 1, people: 6, tags: 2 } });
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fx);
  return app;
}
const todoRow = (h, id) => { const i = h.indexOf('<li class="todo plan" id="' + id + '"'); return i < 0 ? '' : h.slice(i, h.indexOf('</li>', i)); };
const planOf = row => (/data-act="review-plan" data-id="([^"]+)"/.exec(row) || [])[1];
rule('Home: Needs you keeps the task under focus when an earlier plan arrives, is deleted, or the plans reorder (rows keyed by what they are, not their place)', async () => {
  const app = await plansApp();
  app.click('nav', 'home'); await app.tick(10);
  const d = moreOf(app.html(), 'home-todo');
  app.click('more', 'home-todo', d); await app.tick(5);
  const id = d.focus.slice(1, -2), plan = planOf(todoRow(app.html(), id));
  assert.ok(plan && app.activeId() === id + '-t', 'set-up: the 11th row, a plan, focused: ' + app.activeId());
  const title = /<b id="[^"]+" tabindex="-1">([^<]*)/.exec(todoRow(app.html(), id))[1];
  const on = what => {
    const h = app.html(), row = todoRow(h, id);
    assert.strictEqual(app.activeId(), id + '-t', what + ': focus stays on the row');
    assert.strictEqual(planOf(row), plan, what + ': the same plan under it, and its Review button');
    assert.ok(row.indexOf(title) >= 0, what + ': its own title');
  };
  const src = JSON.parse(app.fs.files['proposals/plan-00000.json'].t), t0 = Date.parse(src.when);
  const early = id => Object.assign({}, src, { id, title: 'Arrived early ' + id, when: new Date(t0 - 30 * 60000).toISOString() });
  /* Inserted: a plan that sorts first arrives. */
  await app.fs.write('proposals/plan-early.json', JSON.stringify(early('plan-early')));
  await arrive(app);
  on('an earlier plan inserted');
  /* Deleted: the plan above it goes. */
  await app.fs.remove('proposals/plan-00000.json'); await arrive(app);
  on('a plan above it deleted');
  /* Reordered: the plan above it moves below it. */
  const moved = JSON.parse(app.fs.files['proposals/plan-early.json'].t); moved.when = new Date(t0 + 20 * 3600000 + 1800000).toISOString();
  await app.fs.write('proposals/plan-early.json', JSON.stringify(moved)); await arrive(app);
  on('the plans reordered');
});

rule('Home: Your corrections rows are keyed by their acknowledgment, so one inserted, deleted or reordered above never turns a row into another', () => {
  const PF = loadViews(), V = PF.views, people = [{ id: 'person-casey', name: 'Casey Nguyen' }];
  let acks = Array.from({ length: 30 }, (x, i) => ({ key: 'k' + i, kind: 'declined', by: 'person-casey', reason: 'Reason ' + i, process: 'release', group: { target: { kind: 'step', step: 's' + i }, text: 'Step ' + i } }));
  const state = { view: 'home', me: 'person-casey', more: { 'home-acks': 20 }, unfold: {}, disc: {} };
  const ctx = { state, data: { people, runs: [], plans: [], processes: [], drafts: [], skills: [], legacy: [], validations: [] }, now: () => Date.now(), peopleById: { 'person-casey': people[0] }, processes: () => [], processTitle: id => id, acks: () => acks, findRun: () => null };
  const rowOf = (h, reason) => { const i = h.indexOf('Reason ' + reason + '<'); const a = h.lastIndexOf('<li class="todo ack', i); return /id="([^"]+)"/.exec(h.slice(a))[1]; };
  const id = rowOf(V.home(ctx), 10), text = h => { const i = h.indexOf('id="' + id + '"'); return h.slice(i, h.indexOf('</li>', i)); };
  const same = what => { const h = V.home(ctx); assert.ok(/Reason 10</.test(text(h)) && h.indexOf('id="' + id + '-t"') >= 0, what + ': ' + text(h).slice(0, 200)); };
  acks = [{ key: 'new', kind: 'declined', by: 'person-casey', reason: 'Arrived', process: 'release', group: { target: { kind: 'step', step: 'x' }, text: 'X' } }].concat(acks); same('inserted above');
  acks = acks.filter(a => a.key !== 'k3'); same('deleted above');
  acks = acks.slice().reverse(); same('reordered');
});

/* ---------- code review round 9 ---------- */
rule('Round 9: Plan on 300 roles keeps what every role started as through a refresh after another run moves the rotation: role 250, not drawn, and role 2, drawn, stay, each compared with its new default as 2.10\'s select is; the plan saves them', async () => {
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fixture());
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'roles'); await app.tick(10); app.click('plan-run', 'roles'); await app.tick(20);
  const selOf = (h, role) => { const m = new RegExp('<select id="role-' + role + '"[^>]*>([\\s\\S]*?)</select>').exec(h); return m && (/<option value="([^"]+)" selected>/.exec(m[1]) || [])[1]; };
  const sugOf = (h, role) => (new RegExp('for="role-' + role + '">' + role + ' <span class="small">· suggestion: ([^<(]*)').exec(h) || [])[1];
  const wasOf = (h, role) => (new RegExp('id="role-' + role + '" data-role="[^"]*"[^>]*data-was="([^"]*)"').exec(h) || [])[1];
  let h = app.html();
  const r250 = hiddenOfAt(h, 'r250'), r2 = selOf(h, 'r2'), sug2 = sugOf(h, 'r2');
  assert.ok(r250 && r2 && sug2, 'set-up: role 250 hidden, role 2 drawn, each suggested');
  /* Another run gives them the very people suggested now, so the rotation suggests someone else. */
  const src = Object.keys(app.fs.files).find(f => /^runs\/roles\/[^/]+\/run\.json$/.test(f) && /"title": "Roles run 0"/.test(app.fs.files[f].t));
  const run = JSON.parse(app.fs.files[src].t);
  run.id = 'rot9abcd'; run.title = 'Moves the rotation'; run.created = new Date().toISOString(); run.roles = Object.assign({}, run.roles, { r2: r2, r250: r250 });
  await app.fs.write('runs/roles/rot9abcd/run.json', JSON.stringify(run, null, 2));
  app.set('run-title', 'Kept through the rotation').set('plan-when', '2099-04-01T09:00');
  await reread(app);
  h = app.html();
  assert.ok(sugOf(h, 'r2') && sugOf(h, 'r2') !== sug2, 'set-up: the suggestion for role 2 moved: ' + sug2 + ' to ' + sugOf(h, 'r2'));
  assert.strictEqual(hiddenOfAt(h, 'r250'), r250, 'role 250, not drawn, keeps what it started as');
  assert.strictEqual(selOf(h, 'r2'), r2, 'role 2, drawn, keeps it too');
  /* Code review round 16: what each is compared with is its default as drawn now (the new suggestion), as 2.10's carried
     select is compared with its newly drawn default; so each counts as unsaved, as there. */
  const sel2 = /<select id="role-r2"[^>]*>([\s\S]*?)<\/select>/.exec(h)[1], now2 = wasOf(h, 'r2');
  assert.ok(now2 && now2 !== r2 && new RegExp('<option value="' + now2 + '"[^>]*>' + sugOf(h, 'r2').trim()).test(sel2), 'role 2 is compared with the new suggestion: ' + now2);
  assert.ok(wasOf(h, 'r250') && wasOf(h, 'r250') !== r250, 'and role 250 with its new default: ' + wasOf(h, 'r250'));
  await more(app, 'start-roles'); await more(app, 'start-roles');
  for (let i = 0; i < 12; i++) await more(app, 'start-roles');
  assert.strictEqual(selOf(app.html(), 'r250'), r250, 'drawn later by Show more, still what it started as');
  app.chooseApprovers().submitForm('plan-form'); await app.tick(120);
  const made = Object.keys(app.fs.files).filter(f => /^proposals\/plan-roles-[a-z0-9]{8}\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(p => p.title === 'Kept through the rotation');
  assert.strictEqual(made.length, 1, 'the plan is saved');
  assert.strictEqual(made[0].roles.r250, r250); assert.strictEqual(made[0].roles.r2, r2);
});


/* ---------- code review round 10 ---------- */
rule('Round 10: Plan on 300 roles, the people suggested for role 2 (drawn) and role 250 (not drawn) marked inactive while it\'s open: after a refresh each is its new default, as 2.10\'s select is, role 250 drawn by Show more is the same, and the plan saves neither inactive person', async () => {
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
  await into(app, fixture());
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'roles'); await app.tick(10); app.click('plan-run', 'roles'); await app.tick(20);
  const selOf = (h, role) => { const m = new RegExp('<select id="role-' + role + '"[^>]*>([\\s\\S]*?)</select>').exec(h); return m ? (/<option value="([^"]+)" selected>/.exec(m[1]) || [])[1] || '' : null; };
  const wasOf = (h, role) => (new RegExp('id="role-' + role + '" data-role="[^"]*"[^>]*data-was="([^"]*)"').exec(h) || [])[1];
  let h = app.html();
  const r250 = hiddenOfAt(h, 'r250'), r2 = selOf(h, 'r2');
  assert.ok(r250 && r2, 'set-up: role 250 hidden and role 2 drawn, each with someone suggested');
  /* Someone marks both people inactive in people.json while the form is open. */
  const ppl = JSON.parse(app.fs.files['people.json'].t);
  ppl.forEach(p => { if (p.id === r2 || p.id === r250) p.inactive = true; });
  await app.fs.write('people.json', JSON.stringify(ppl, null, 2));
  app.set('run-title', 'After the directory changed').set('plan-when', '2099-05-01T09:00');
  await reread(app);
  h = app.html();
  /* Code review round 16: 2.10's select can't hold an inactive person, so it shows its default as drawn now: the rotation's
     suggestion among the people still on the team. A role not drawn is the same. */
  const now2 = selOf(h, 'r2'), now250 = hiddenOfAt(h, 'r250');
  assert.ok(now2 && now2 !== r2 && now2 !== r250, 'role 2, drawn, is its new default, someone on the team: ' + now2);
  assert.strictEqual(wasOf(h, 'r2'), now2, 'and is compared with it');
  assert.ok(now250 && now250 !== r250 && now250 !== r2, 'role 250, not drawn, is its new default too, as its box would be: ' + now250);
  assert.strictEqual(wasOf(h, 'r250'), now250, 'and is compared with it');
  for (let i = 0; i < 14 && selOf(app.html(), 'r250') === null; i++) await more(app, 'start-roles');
  h = app.html();
  assert.strictEqual(selOf(h, 'r250'), now250, 'drawn by Show more, role 250 is the same');
  assert.strictEqual(wasOf(h, 'r250'), now250);
  app.chooseApprovers().submitForm('plan-form'); await app.tick(120);
  const made = Object.keys(app.fs.files).filter(f => /^proposals\/plan-roles-[a-z0-9]{8}\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(p => p.title === 'After the directory changed');
  assert.strictEqual(made.length, 1, 'the plan is saved');
  assert.ok(made[0].roles.r250 === now250 && made[0].roles.r2 === now2, 'neither inactive person is planned: ' + made[0].roles.r250 + ', ' + made[0].roles.r2);
});
rule('Round 10: Plan with role 250 hidden after its person is marked inactive saves the same roles whether role 250 is drawn first or not', async () => {
  const plans = [];
  for (const draw of [false, true]) {
    const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true }); await app.tick(60);
    await into(app, fixture());
    app.click('nav', 'processes'); await app.tick(5); app.click('open-process', 'roles'); await app.tick(10); app.click('plan-run', 'roles'); await app.tick(20);
    const r250 = hiddenOfAt(app.html(), 'r250');
    const ppl = JSON.parse(app.fs.files['people.json'].t); ppl.forEach(p => { if (p.id === r250) p.inactive = true; });
    await app.fs.write('people.json', JSON.stringify(ppl, null, 2));
    app.set('run-title', 'Drawn ' + draw).set('plan-when', '2099-05-02T09:00');
    await reread(app);
    if (draw) for (let i = 0; i < 14 && !/<select id="role-r250"/.test(app.html()); i++) await more(app, 'start-roles');
    app.chooseApprovers().submitForm('plan-form'); await app.tick(120);
    const made = Object.keys(app.fs.files).filter(f => /^proposals\/plan-roles-[a-z0-9]{8}\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(p => p.title === 'Drawn ' + draw)[0];
    assert.ok(made, 'set-up: the plan is saved');
    plans.push(made.roles);
  }
  assert.deepStrictEqual(plans[1], plans[0], 'paging changes nothing the plan saves');
});

run();
