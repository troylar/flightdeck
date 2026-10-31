// Find things in big folders (2.11), code review round 20: a version dropdown's Find box someone is using stays drawn, with
// its text, Clear and focus, when a newer read leaves a single version, on the checklist page and on How runs go.
'use strict';
const assert = require('assert');
const { rule, run, load, exactOf } = require('./harness');
const { boot } = require('./app-harness');

const un = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const iso = t => new Date(t).toISOString();
const NOW = Date.parse('2026-10-20T15:00:00Z'), HOUR = 3600000;
const PID = 'manyver';
const md = v => '---\nprocess: ' + PID + '\ntitle: Many versions\ncategory: Synthetic\nowner: person-avery\n---\n\n' +
  '## Do · READ-DO {#ph1}\n- [ ] {confirm} Step of version ' + v + ' {#s1}\n';

/* The examples' folder, read, with a clock the test moves so the app's own beat rereads it without moving focus. */
async function fresh() {
  const clock = { skip: 0 }, perf = { now: () => Number(process.hrtime.bigint() / 1000000n) + clock.skip };
  const app = boot({ localStore: { 'preflight:builder': 'false' }, domFocus: true, performance: perf }); await app.tick(60);
  app.clock = clock;
  app.choose('person-avery'); await app.tick();
  return app;
}
/* Publish md as the next version of its process, written as another window would; returns { folder, pub }. */
async function publishMd(app, md, n, rand) {
  const PF = load(), people = JSON.parse(app.fs.files['people.json'].t), proc = /\nprocess: ([\w-]+)/.exec(md)[1];
  const existing = Array.from({ length: n - 1 }, (x, i) => ({ version: i + 1 }));
  const built = PF.publish.build(md, { people, by: 'person-avery', changes: 'Version ' + n, existing, now: iso(NOW - 1000 * HOUR + n * HOUR), rand });
  assert.ok(!built.blockers, 'set-up: it publishes: ' + (built.blockers || []).join('; '));
  let ok = PF.publish.verify(built.folder, built.files, null, {});
  if (ok.needsBytes) ok = PF.publish.verify(built.folder, built.files, exactOf(PF, built.files), {});
  for (const f of Object.keys(built.files)) await app.fs.write('publications/' + proc + '/' + built.folder + '/' + f, built.files[f]);
  return { folder: built.folder, pub: { folder: built.folder, info: ok.info, map: ok.map, md } };
}
const removeAll = (app, prefix) => app.files(prefix).forEach(p => { delete app.fs.files[p]; });
async function openProc(app, id, tab) {
  app.click('nav', 'processes'); await app.tick(5); app.click('open-process', id); await app.tick(10);
  if (tab) { app.click('ptab', tab); await app.tick(10); }
}
/* Find in use (text and focus) and a newer read: Find, its text, Clear and focus are all still there. */
function kept(app, id, q, where, region) {
  const h = region ? region() : app.html(), fid = 'find-' + id;
  assert.ok(new RegExp('id="' + fid + '"[^>]*value="' + q + '"').test(h), where + ': Find is drawn with "' + q + '" in it');
  assert.ok(new RegExp('data-act="find-clear" data-id="' + id + '"').test(h), where + ': with Clear');
  const a = app.doc.activeElement;
  assert.ok(a && a !== app.doc.body, where + ': something has focus (' + app.activeId() + ')');
  assert.strictEqual(a, app.node('#' + fid), where + ': focus is on Find as drawn now (it is on ' + app.activeId() + ')');
  assert.ok(h.indexOf('id="' + a.id + '"') >= 0, where + ': connected: on the page');
  assert.strictEqual(app.el(fid).value, q, where + ': the box holds the query');
}

/* A checklist with n versions published in the examples' folder, as another window would, then read and opened. */
async function versions(n) {
  const app = await fresh(), folders = [];
  for (let v = 1; v <= n; v++) folders.push((await publishMd(app, md(v), v, 'r20' + String(v).padStart(5, '0'))).folder);
  await reread(app);
  await openProc(app, PID);
  /* Another computer removes every publication but the newest. */
  app.keepNewest = () => folders.slice(0, -1).forEach(f => removeAll(app, 'publications/' + PID + '/' + f + '/'));
  app.newest = folders[folders.length - 1];
  return app;
}
/* A refresh, as Check the folder now does it, without moving focus. */
async function reread(app) {
  const was = app.PF.perf.n['load.done'] || 0;
  app.clock.skip += 61000; app.every(); await app.tick(20); app.every();
  for (let i = 0; i < 4000 && (app.PF.perf.n['load.done'] || 0) <= was; i++) await app.tick(5);
  await app.tick(10);
}
function options(html, id) {
  const m = new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>').exec(html); if (!m) return null;
  return [...m[1].matchAll(/<option value="([^"]*)"/g)].map(x => x[1]);
}
/* Type into a list's Find box with focus in it, as someone does. */
async function typeIn(app, id, q) {
  const box = app.node('#find-' + id);
  assert.ok(box, 'set-up: Find is drawn for ' + id);
  box.focus(); app.fire('focusin', { target: box }); await app.tick(5);
  app.set('find-' + id, q); app.input('find-' + id, q); await app.tick(5);
  app.doc.activeElement = app.node('#find-' + id);
}
function stillThere(app, id, q, where) {
  kept(app, id, q, where);
  assert.ok(/No version matches/.test(app.html()), where + ': saying nothing matches');
}

rule('Round 20: the checklist\'s versions, 60 then 1: Find "v3" with focus in it stays drawn, with its text, Clear and focus', async () => {
  const app = await versions(60);
  assert.strictEqual(options(app.html(), 'map-ver').filter(v => v !== '#more').length, 50, 'set-up: 50 of 60 versions drawn');
  await typeIn(app, 'map-ver', 'v3');
  assert.ok(/id="find-map-ver"[^>]*value="v3"/.test(app.html()), 'set-up: typed');
  app.keepNewest();
  await reread(app);
  assert.deepStrictEqual(options(app.html(), 'map-ver'), [app.newest], 'one version left, the chosen one');
  stillThere(app, 'map-ver', 'v3', 'the checklist');
  app.click('find-clear', 'map-ver'); await app.tick(5);
  app.doc.activeElement = app.doc.body; app.fire('focusout', { target: { id: 'find-map-ver', dataset: { find: 'map-ver' } } }); await app.tick(5);
  /* Leaving draws nothing (code review round 25): the box goes at the next redraw. */
  app.click('ptab', 'overview'); await app.tick(10);
  assert.ok(!/id="find-map-ver"/.test(app.html()), 'cleared and left, one version needs no Find at the next redraw');
});

rule('Round 20: How runs go\'s versions, 60 then 1: Find "v3" with focus in it stays drawn, with its text, Clear and focus', async () => {
  const app = await versions(60);
  app.click('ptab', 'insights'); await app.tick(20);
  assert.strictEqual(options(app.html(), 'ins-folder').filter(v => v !== '#more').length, 50, 'set-up: 50 of 60 versions drawn');
  await typeIn(app, 'ins-folder', 'v3');
  app.keepNewest();
  await reread(app);
  assert.ok(/id="ins-h"/.test(app.html()), 'still on How runs go');
  assert.deepStrictEqual(options(app.html(), 'ins-folder'), [app.newest], 'one version left, the chosen one');
  stillThere(app, 'ins-folder', 'v3', 'How runs go');
});

rule('Round 20: text without focus keeps the box too, on both, and one version with nothing typed draws no Find', async () => {
  const app = await versions(60);
  app.set('find-map-ver', 'v3'); app.input('find-map-ver', 'v3'); await app.tick(5);
  app.click('ptab', 'insights'); await app.tick(20);
  app.set('find-ins-folder', 'v3'); app.input('find-ins-folder', 'v3'); await app.tick(5);
  app.doc.activeElement = app.doc.body;
  app.keepNewest();
  await reread(app);
  let h = app.html();
  assert.ok(/id="find-ins-folder"[^>]*value="v3"/.test(h) && /data-act="find-clear" data-id="ins-folder"/.test(h), 'How runs go: Find and Clear');
  app.click('ptab', 'overview'); await app.tick(10);
  h = app.html();
  assert.ok(/id="find-map-ver"[^>]*value="v3"/.test(h) && /data-act="find-clear" data-id="map-ver"/.test(h), 'the checklist: Find and Clear');
  app.click('find-clear', 'map-ver'); await app.tick(5);
  app.doc.activeElement = app.doc.body; app.fire('focusout', { target: { id: 'find-map-ver', dataset: { find: 'map-ver' } } }); await app.tick(5);
  /* Leaving draws nothing (code review round 25): the box goes at the next redraw. */
  app.click('ptab', 'overview'); await app.tick(10);
  assert.ok(!/id="find-map-ver"/.test(app.html()), 'nothing typed, no focus, one version: no Find at the next redraw');
  assert.ok(/<span class="small">v60<\/span>/.test(app.html()), 'just the version, as before');
});

for (const tab of ['overview', 'insights']) {
  rule('Round 20: 60 versions then none, the draft left: ' + (tab === 'insights' ? 'How runs go\'s' : 'the checklist\'s') + ' Find "v3" stays, with text, Clear and focus', async () => {
    const app = await versions(60), id = tab === 'insights' ? 'ins-folder' : 'map-ver';
    if (tab === 'insights') { app.click('ptab', 'insights'); await app.tick(20); }
    await typeIn(app, id, 'v3');
    app.keepNewest(); removeAll(app, 'publications/' + PID + '/');
    await app.fs.write('maps/drafts/' + PID + '.md', md(61));
    await reread(app);
    assert.ok(!app.files('publications/' + PID + '/').length, 'set-up: no version left');
    kept(app, id, 'v3', tab);
  });
}

rule('Round 20: 60 versions then none and no draft, one damaged publication left: the checklist\'s Find "v3" stays, with text, Clear and focus', async () => {
  const app = await versions(60);
  await typeIn(app, 'map-ver', 'v3');
  removeAll(app, 'publications/' + PID + '/');
  await app.fs.write('publications/' + PID + '/v61-damaged/map.md', '---\nprocess: ' + PID + '\n---\n');
  await reread(app);
  assert.ok(/This checklist has nothing written down yet/.test(app.html()), 'set-up: nothing to show');
  kept(app, 'map-ver', 'v3', 'the checklist');
});

/* ---------- Join: a newer list with nobody active ---------- */
const team = (n, off) => [{ id: 'person-avery', name: 'Avery Lee', email: 'avery@example.com', folderRole: 'owner' }]
  .concat(Array.from({ length: n - 1 }, (x, i) => ({ id: 'person-j' + (i + 1), name: 'Jo ' + String(i + 1).padStart(2, '0'), email: 'jo' + (i + 1) + '@example.com' })))
  .map(p => off ? Object.assign({}, p, { inactive: true }) : p);
rule('Round 20: Join with 60 people, Find "Jo 07" with focus; a newer list where nobody is active: Find your name stays, with text, Clear and focus', async () => {
  const { folderHandle, memoryIDB } = require('./app-harness');
  const files = { 'people.json': JSON.stringify(team(60), null, 2) + '\n' }, dir = folderHandle('Team', files);
  const clock = { skip: 0 }, perf = { now: () => Number(process.hrtime.bigint() / 1000000n) + clock.skip };
  const app = boot({ picker: dir, indexedDB: memoryIDB(), firstRun: true, domFocus: true, performance: perf }); await app.tick(60);
  app.clock = clock;
  app.click('setup-mode', 'join'); await app.tick();
  app.click('setup-open'); await app.tick(200);
  await typeIn(app, 'su-who', 'Jo 07');
  files['people.json'] = JSON.stringify(team(60, true), null, 2) + '\n';
  await reread(app);
  assert.ok(/has no people list yet/.test(app.html()), 'set-up: nobody to choose');
  kept(app, 'su-who', 'Jo 07', 'Join');
});

/* ---------- Start: a newer version with no roles ---------- */
const ROLES = Array.from({ length: 25 }, (x, i) => 'r' + (i + 1));
const roleMd = roles => '---\nprocess: roles25\ntitle: Roles 25\ncategory: Synthetic\nowner: person-avery\n' + (roles.length ? 'roles: ' + roles.join(', ') + '\n' : '') + '---\n\n' +
  '## Do · READ-DO {#ph1}\n- [ ] {confirm} Do it' + (roles.length ? ' @r1' : '') + ' {#s1}\n';
rule('Round 20: Start with 25 roles, With others, Find "r2" with focus; a newer version with no roles: Find a role stays, with text, Clear and focus', async () => {
  const app = await fresh();
  await publishMd(app, roleMd(ROLES), 1, 'r20st001');
  await reread(app);
  await openProc(app, 'roles25');
  app.click('start', 'roles25'); await app.tick(10);
  app.click('start-mode', 'team', { process: 'roles25' }); await app.tick(10);
  await typeIn(app, 'start-roles', 'r2');
  await publishMd(app, roleMd([]), 2, 'r20st002');
  await reread(app);
  assert.ok(/ · v2</.test(app.html()), 'set-up: Start is on v2');
  kept(app, 'start-roles', 'r2', 'Start');
});

/* ---------- a run's Details: roles a newer read leaves to one person ---------- */
rule('Round 20: a run\'s Details with 25 roles for two people, Find "r2" with focus; a newer read leaves it to one person: Find a role stays, with text, Clear and focus', async () => {
  const app = await fresh();
  const { pub } = await publishMd(app, roleMd(ROLES), 1, 'r20rd001');
  const PF = load(), roles = {}; ROLES.forEach((r, i) => { roles[r] = i % 2 ? 'person-casey' : 'person-avery'; });
  const r = PF.run.create(pub, { id: 'r20run', title: 'Roles run', roles, by: 'person-casey', session: 's-r20', now: iso(NOW - HOUR), tz: 'UTC' });
  const c = {}; Object.keys(r).forEach(k => { if (k[0] !== '_') c[k] = r[k]; });
  const path = 'runs/roles25/r20run/run.json';
  await app.fs.write(path, JSON.stringify(c, null, 2) + '\n');
  await reread(app);
  app.click('nav', 'home'); await app.tick(5); app.click('open-run', 'roles25/r20run'); await app.tick(20);
  if (!/id="rw-details"/.test(app.html())) { app.click('run-details'); await app.tick(5); }
  assert.ok(/id="find-det-roles"/.test(app.html()), 'set-up: Find a role over 25 roles');
  await typeIn(app, 'det-roles', 'r2');
  const j = JSON.parse(app.fs.files[path].t);
  Object.keys(j.roles).forEach(k => { j.roles[k] = ''; }); j.rev = (j.rev || 0) + 1;
  await app.fs.write(path, JSON.stringify(j, null, 2) + '\n');
  await reread(app);
  assert.ok(load().run.solo(Object.assign({ roles: {} }, j)), 'set-up: the newer read is a run of one person');
  kept(app, 'det-roles', 'r2', 'Details');
});

/* ---------- the builder ---------- */
const DET = Array.from({ length: 25 }, (x, i) => 'detail' + i);
const fm = (proc, title, ctx) => '---\nprocess: ' + proc + '\ntitle: ' + title + '\ncategory: Synthetic\nowner: person-avery\n' + (ctx.length ? 'context: ' + ctx.join(', ') + '\n' : '') + 'roles: lead\n---\n\n';
async function builderOn(app, proc, step) {
  await reread(app);
  await openProc(app, proc, 'edit');
  app.click('ed-mode', 'builder'); await app.tick(10);
  app.click('ob-sel', step); await app.tick(10);
}
rule('Round 20: a step\'s run details, 25 of them, Find "detail2" with focus; a newer draft with none: Find stays, with text, Clear and focus', async () => {
  const app = await fresh();
  await app.fs.write('maps/drafts/binds.md', fm('binds', 'Binds', DET) + '## Only · READ-DO {#ph1}\n- [ ] {confirm} Check it @lead {#s0}\n');
  await builderOn(app, 'binds', 's0');
  await typeIn(app, 'ob-binds', 'detail2');
  await app.fs.write('maps/drafts/binds.md', fm('binds', 'Binds', []) + '## Only · READ-DO {#ph1}\n- [ ] {confirm} Check it @lead {#s0}\n');
  await reread(app);
  assert.ok(/The checklist lists no run details yet/.test(app.html()), 'set-up: the draft lists none now');
  kept(app, 'ob-binds', 'detail2', 'run details');
});

const kidMd = v => fm('kid', 'Kid', []) + '## Only · READ-DO {#ph1}\n- [ ] {confirm} Kid step ' + v + ' @lead {#s0}\n';
const parMd = pin => fm('par', 'Parent', []) + '## Only · READ-DO {#ph1}\n- [ ] {run.process} Start the kid @lead {#k0}\n  process: kid\n' + (pin ? '  version: ' + pin + '\n' : '');
for (const keepDraft of [true, false]) {
  rule('Round 20: a linked step pinned to v3 of a child with 55 versions, Find "v3" with focus; the child\'s versions removed' + (keepDraft ? ', its draft left' : ' and the child gone') + ': Find stays, with text, Clear and focus', async () => {
    const app = await fresh();
    for (let v = 1; v <= 55; v++) await publishMd(app, kidMd(v), v, 'r20k' + String(v).padStart(4, '0'));
    await app.fs.write('maps/drafts/par.md', parMd(3));
    await builderOn(app, 'par', 'k0');
    await typeIn(app, 'ob-link-vn', 'v3');
    removeAll(app, 'publications/kid/');
    if (keepDraft) await app.fs.write('maps/drafts/kid.md', kidMd(56));
    await reread(app);
    kept(app, 'ob-link-vn', 'v3', 'which version');
  });
}
rule('Round 20: a linked step whose child draft has 25 run details, Find "detail2" with focus; the child leaves the folder: Find stays, with text, Clear and focus', async () => {
  const app = await fresh();
  await app.fs.write('maps/drafts/kid.md', fm('kid', 'Kid', DET) + '## Only · READ-DO {#ph1}\n- [ ] {confirm} Kid step @lead {#s0}\n');
  await app.fs.write('maps/drafts/par.md', parMd(0));
  await builderOn(app, 'par', 'k0');
  await typeIn(app, 'ob-link-rows', 'detail2');
  delete app.fs.files['maps/drafts/kid.md'];
  await reread(app);
  assert.ok(/kid isn(&#39;|')t in this folder/.test(app.html()), 'set-up: the child is gone');
  kept(app, 'ob-link-rows', 'detail2', 'what it passes');
});

/* ---------- Practice: Sample details ---------- */
rule('Round 20: practice from a step that needs 25 run details, Find "detail2" in Sample details; Start from the beginning: the section and its Find stay, with text and Clear', async () => {
  const app = await fresh();
  await app.fs.write('maps/drafts/prac.md', fm('prac', 'Practice 25', DET) + '## Only · READ-DO {#ph1}\n- [ ] {confirm} First @lead {#s0}\n- [ ] {confirm} Use ' + DET.map(d => '^' + d).join(' ') + ' @lead {#s1}\n');
  await reread(app);
  await openProc(app, 'prac', 'edit');
  app.click('pr-open'); await app.tick(60);
  app.click('select', 's1'); await app.tick();
  app.click('pr-from', 's1'); await app.tick();
  assert.ok(/needed from here/.test(app.html()) && /id="find-pr-samples"/.test(app.html()), 'set-up: Sample details with Find');
  app.set('find-pr-samples', 'detail2'); app.input('find-pr-samples', 'detail2'); await app.tick(5);
  app.click('pr-from-clear'); await app.tick();
  const h = app.html();
  assert.ok(!/earlier steps assumed|Practicing from/.test(h), 'set-up: from the beginning');
  assert.ok(/id="pr-sample"/.test(h), 'Sample details stays');
  assert.ok(/id="find-pr-samples"[^>]*value="detail2"/.test(h) && /data-act="find-clear" data-id="pr-samples"/.test(h), 'with Find, its text and Clear');
  assert.ok(/id="pr-s-detail2"/.test(h), 'still filtering');
});

run();
