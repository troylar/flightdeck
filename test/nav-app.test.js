// 2.16 in the built app: one way to move around (docs/design.md section 29). The checklist page's view strip, the
// workspace's shared header (Edit | Practice and its one primary), the way back named for where it goes, Back and Escape.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, bus, locks, folderHandle, memoryIDB } = require('./app-harness');

async function start(o) {
  o = o || {};
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, o));
  await app.tick(80);
  if (!o.nobody) { app.choose(o.me || 'person-casey'); await app.tick(); }
  return app;
}
async function page(o) { const app = await start(o); app.click('open-process', 'release'); await app.tick(); return app; }
/* The checklist views nav (the page's strip, or the workspace's view control) as drawn, or null. */
const strip = html => { const m = /<nav\b[^>]*aria-label="Checklist views"[^>]*>([\s\S]*?)<\/nav>/.exec(html); return m ? m[1] : null; };
const strips = html => (html.match(/<nav\b[^>]*aria-label="Checklist views"/g) || []).length;
const plain = s => s.replace(/<[^>]+>/g, '').replace(/&#39;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const buttons = s => [...String(s || '').matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(m => ({
  text: plain(m[2]), current: /aria-current="page"/.test(m[1]), act: (/data-act="([^"]+)"/.exec(m[1]) || [])[1], id: (/data-id="([^"]*)"/.exec(m[1]) || [])[1],
  label: (/aria-label="([^"]*)"/.exec(m[1]) || [])[1], attrs: m[1] }));
const outside = html => html.replace(/<nav\b[^>]*aria-label="Checklist views"[^>]*>[\s\S]*?<\/nav>/g, '');
/* The way back on screen: every control drawn with the back class, as { text, label, act, id }. */
const backs = html => buttons((html.match(/<button\b[^>]*class="[^"]*\bbackc\b[^"]*"[^>]*>[\s\S]*?<\/button>/g) || []).join(''));
const onPage = app => /Practice · not recorded/.test(app.html());
const inEditor = app => /id="draft-editor"|id="ob-plist"/.test(app.html()) && !onPage(app);
const onOverview = app => /<h1 id="page-h" tabindex="-1">Production release<\/h1>/.test(app.html()) && !inEditor(app) && !onPage(app);
async function check(app, id) {
  app.click('toggle', id); await app.tick();
  if (new RegExp('data-act="pr-ev-skip" data-id="' + id + '"').test(app.html())) { app.click('pr-ev-skip', id); await app.tick(); }
}
const stepCount = app => app.PF.map.steps(app.PF.map.parse(app.fs.files['maps/drafts/release.md'].t)).length;
const viewBtn = (app, word) => buttons(strip(app.html())).filter(b => b.text.split(' · ')[0].split(' ')[0] === word || b.text === word)[0] || null;

/* A step type's form is open when it's drawn and its entry is written: waited on, not timed. */
async function until(app, cond, what) { for (let i = 0; i < 600; i++) { if (cond()) return; await app.tick(5); } assert.fail('never happened: ' + what); }
async function typeOpen(app) { app.click('new-type'); await until(app, () => /id="tf-h"/.test(app.html()) && app.hash() === '#/types/new', 'the new step type form, at #/types/new (' + app.hash() + ')'); await app.settle(); }

/* ---------- 2.1 the checklist page ---------- */
rule('Checklist page: one view strip under the title, Overview · Edit · Practice · How runs go, the current one marked; no second Edit or How runs go', async () => {
  const app = await page();
  const s = strip(app.html());
  assert.ok(s, 'a nav named Checklist views');
  assert.strictEqual(strips(app.html()), 1);
  assert.deepStrictEqual(buttons(s).map(b => b.text), ['Overview', 'Edit', 'Practice', 'How runs go']);
  assert.deepStrictEqual(buttons(s).filter(b => b.current).map(b => b.text), ['Overview']);
  const rest = outside(app.html());
  assert.ok(!/data-act="ptab" data-id="edit"/.test(rest), 'the panel has no Edit of its own');
  assert.ok(!/data-act="ptab" data-id="insights"/.test(rest), 'the header has no How runs go of its own');
  assert.ok(app.html().indexOf('aria-label="Checklist views"') > app.html().indexOf('id="page-h"'), 'under the title');
  app.click('ptab', 'insights'); await app.tick();
  assert.deepStrictEqual(buttons(strip(app.html())).filter(b => b.current).map(b => b.text), ['How runs go']);
  assert.ok(!/Back to the checklist/.test(app.html()), 'How runs go has no way back of its own: the strip covers it');
  assert.ok(!/data-act="ptab" data-id="overview"/.test(outside(app.html())));
});

rule('Checklist page: Practice opens practice for the first time from here, through the Edit checks, as one history entry', async () => {
  const app = await page();
  const n = app.entries().length, pr = viewBtn(app, 'Practice');
  assert.ok(pr && pr.act, 'Practice is in the strip');
  app.click(pr.act, pr.id); await app.tick(60);
  assert.ok(onPage(app), 'on the practice page');
  assert.strictEqual(app.hash(), '#/practice/release');
  assert.strictEqual(app.entries().length, n + 1, 'one entry added');
});

rule('Checklist page: practice kept in this tab is counted in the strip, Practice · 2 of N, named "Practice, 2 of N steps answered"', async () => {
  const app = await page();
  const pr = viewBtn(app, 'Practice');
  assert.strictEqual(pr.text, 'Practice', 'no count before practicing');
  app.click(pr.act, pr.id); await app.tick(60);
  await check(app, 'approved'); await check(app, 'rollback');
  app.click('nav', 'processes'); await app.tick();
  app.click('open-process', 'release'); await app.tick();
  const n = stepCount(app), b = viewBtn(app, 'Practice');
  assert.strictEqual(b.text, 'Practice · 2 of ' + n);
  assert.strictEqual(b.label, 'Practice, 2 of ' + n + ' steps answered');
});

rule('Checklist page: an answer whose step is gone from the text is not counted, so the count never passes the total', async () => {
  const app = await page();
  const pr = viewBtn(app, 'Practice');
  app.click(pr.act, pr.id); await app.tick(60);
  await check(app, 'approved'); await check(app, 'rollback');
  app.click('nav', 'processes'); await app.tick();
  const f = app.fs.files['maps/drafts/release.md'];
  f.t = f.t.replace(/\n- \[[^\]]*\][^\n]*\{#rollback\}[^\n]*\n(  [^\n]*\n)*/, '\n'); f.m = Date.now();
  app.click('refresh'); await app.tick(120);
  app.click('open-process', 'release'); await app.tick();
  const n = stepCount(app);
  assert.strictEqual(viewBtn(app, 'Practice').text, 'Practice · 1 of ' + n);
});

rule('Checklist page: the unsaved-edits notice keeps its words and has no Continue editing (the strip\'s Edit is the way in)', async () => {
  const app = await page();
  app.click('ptab', 'edit'); await app.tick();
  app.input('draft-editor', app.draft('draft-editor') + '\nmore'); await app.tick(300);
  app.click('open-process', 'release'); await app.tick();
  assert.ok(/edits in the draft that aren.+t saved/.test(app.html()), 'the notice');
  assert.ok(!/Continue editing/.test(app.html()));
});

rule('Checklist page: an older version has the way back top left, ‹ Current version, and Edit in the strip opens the current draft', async () => {
  const app = await page();
  const vers = [...app.html().matchAll(/<option value="(v\d+-[a-z0-9]+)"/g)].map(m => m[1]);
  app.select('map-ver', vers[vers.length - 1]); await app.tick(); app.gone('map-ver');
  assert.ok(/an older version/.test(app.html()), 'set-up: an older version');
  assert.ok(!/>Back to current</.test(app.html()), 'no Back to current in the panel');
  const b = backs(app.html());
  assert.deepStrictEqual(b.map(x => [x.text, x.label, x.act]), [['Current version', 'Back to Current version', 'back-current']]);
  assert.ok(/data-act="restore-draft"/.test(outside(app.html())), 'Restore as draft stays in the panel');
  const ed = viewBtn(app, 'Edit');
  app.click(ed.act, ed.id); await app.tick();
  assert.ok(inEditor(app), 'Edit opens the current draft');
});

rule('Runs filtered from How runs go: the way back is top left, ‹ How runs go', async () => {
  const app = await page();
  app.click('ptab', 'insights'); await app.tick();
  const m = /data-act="ins-runs" data-id="([^"]+)"/.exec(app.html());
  app.click('ins-runs', m[1]); await app.tick();
  assert.deepStrictEqual(backs(app.html()).map(x => [x.text, x.label, x.act]), [['How runs go', 'Back to How runs go', 'ins-back']]);
  assert.ok(!/>Back to How runs go</.test(app.html()), 'no second one in the banner');
});

rule('Checklist page: Practice anyway shows with Edit anyway, and is one click into practice and one history entry', async () => {
  const files = {}, L = locks(), Channel = bus();
  const a = await page({ sharedFiles: files, locks: L, Channel });
  const b = await page({ sharedFiles: files, locks: L, Channel, me: 'person-avery' });
  b.click('ptab', 'edit'); await b.tick(); b.every(); await b.tick(40);
  a.click('refresh'); await a.tick(120);
  assert.strictEqual(viewBtn(a, 'Edit').text, 'Edit anyway');
  const pr = viewBtn(a, 'Practice');
  assert.strictEqual(pr.text, 'Practice anyway');
  const n = a.entries().length;
  a.click(pr.act, pr.id); await a.tick(60);
  assert.ok(onPage(a), 'practicing');
  assert.strictEqual(a.entries().length, n + 1);
});

/* ---------- 2.2 the workspace: the editor and practice share one header ---------- */
const head = app => (/<header class="fpe-head[^"]*\bws-head\b[\s\S]*?<\/header>/.exec(app.html()) || [''])[0];
/* The header's primary: the buttons in its last group, as drawn. */
const primary = app => buttons((/<div class="fpe-save">([\s\S]*?)<\/div><\/header>/.exec(head(app)) || ['', ''])[1]);
const STAGED = 'maps/drafts/release.md';
async function edit(o) { const app = await page(o); app.click('ptab', 'edit'); await app.tick(); return app; }
async function practiced(o) { const app = await edit(o); app.click('pr-open'); await app.tick(60); assert.ok(onPage(app), 'set-up: practicing'); return app; }
/* The draft saved with a change, so it has changes not yet published. */
async function changed(o) {
  const app = await start(o);
  const md = app.fs.files[STAGED].t;
  await app.fs.write(STAGED, md.replace(/\n(## [^\n]*\n)/, '\n$1- [ ] {confirm} Tell the on-call channel {#tell-oncall}\n'));
  app.click('refresh'); await app.tick(80);
  app.click('open-process', 'release'); await app.tick();
  return app;
}
const stageFiles = app => app.files('staged/release/').filter(f => /^staged\/release\/stage-[a-z0-9]{8}\/publication\.json$/.test(f));
const pubFiles = app => app.files('publications/release/').filter(f => /\/publication\.json$/.test(f));
const testRuns = app => app.files('runs/release/').filter(f => /\/run\.json$/.test(f)).map(f => JSON.parse(app.fs.files[f].t)).filter(r => r.test === true);
/* Changed and staged from the checklist page (the overview's own path), then into the workspace. */
async function staged(o) {
  const app = await changed(o);
  app.set('change-note', 'Tell on-call first'); ovClick(app, 'stage-draft', 'release'); await app.tick(200);
  assert.strictEqual(stageFiles(app).length, 1, 'set-up: staged');
  return { app, folder: JSON.parse(app.fs.files[stageFiles(app)[0]].t).folder };
}
async function testRun(app, folder, end) {
  app.click('open-process', 'release'); await app.tick();
  app.click('start-test', folder); await app.tick();
  app.chooseApprovers().submitForm('start-form', {}); await app.tick(200);
  if (end) { app.click('finish'); await app.tick(); app.click('end', end); await app.tick(200); }
  app.click('open-process', 'release'); await app.tick();
}
/* A control in the dialog, which acts as anywhere (outside the practice guard), as a click inside #overlay does. */
const ovClick = (app, act, id) => { const b = { dataset: { act, id }, disabled: false, classList: { contains: () => false }, closest: sel => (sel === '#overlay' ? {} : null) }; app.fire('click', { target: { closest: () => b } }); };
/* Writes under publications/ and staged/ wait until released. */
const holdWrites = app => { let go; const gate = new Promise(r => { go = r; }); const orig = app.fs.write.bind(app.fs); app.fs.write = (x, d) => /^(staged|publications)\//.test(x) ? gate.then(() => orig(x, d)) : orig(x, d); return () => { go(); app.fs.write = orig; }; };
async function into(app, view) { app.click('ptab', 'edit'); await app.tick(); if (view === 'practice') { app.click('pr-open'); await app.tick(60); } }

rule('Workspace: one header on both views: ‹ <title> top left, Edit | Practice, and nothing that says Review & publish, Done practicing or Back to the draft', async () => {
  for (const view of ['edit', 'practice']) {
    const app = view === 'edit' ? await edit() : await practiced();
    const h = head(app);
    assert.ok(h, view + ': the shared header');
    assert.deepStrictEqual(backs(h).map(b => [b.text, b.label]), [['Production release', 'Back to Production release']], view);
    assert.ok(new RegExp('<h1 id="(ed-h|run-h)" class="sr">Production release, ' + (view === 'edit' ? 'Edit' : 'Practice') + '</h1>').test(h), view + ': the h1 is visually hidden and names the view');
    assert.strictEqual(strips(app.html()), 1, view + ': one view control');
    assert.deepStrictEqual(buttons(strip(h)).map(b => [b.text.split(' · ')[0], b.current]), [['Edit', view === 'edit'], ['Practice', view === 'practice']], view);
    assert.ok(!/Review &amp; publish|Review & publish|Done practicing|Back to the draft|Back to practice/.test(app.html()), view + ': no old way out');
    assert.ok(!/fpe-checks|fpe-practice|data-act="pr-close"/.test(app.html()), view + ': no Checks chip, no Practice chip, no Done practicing');
    assert.ok(primary(app).length <= 1, view + ': one primary at most');
  }
  const app = await practiced();
  assert.deepStrictEqual(buttons(head(app)).filter(b => /^pr-(undo|redo|reset|samples|found-open)$/.test(b.act)).map(b => b.text), ['Undo', 'Redo', 'Start over', 'Sample details', 'Things to fix'].filter(t => t !== 'Sample details' || /pr-samples/.test(head(app))));
  assert.match(head(app), /Practice · not recorded · kept in this tab/);
});

rule('Workspace: ‹ <title> goes to the checklist page with focus on the strip\'s button for the view you left, and practice is kept', async () => {
  const app = await edit({ domFocus: true });
  app.click('ed-done'); await app.tick();
  assert.ok(onOverview(app), 'from Edit: the checklist page');
  assert.strictEqual(app.focused(), '[data-act="ptab"][data-id="edit"]');
  const p = await practiced({ domFocus: true });
  await check(p, 'approved');
  const b = backs(head(p))[0];
  p.click(b.act, b.id); await p.tick();
  assert.ok(onOverview(p), 'from Practice: the checklist page');
  assert.strictEqual(p.focused(), '[data-act="pv-practice"]');
  assert.match(viewBtn(p, 'Practice').text, /^Practice · 1 of \d+$/, 'practice is kept');
});

rule('Workspace: ‹ <title> goes to the checklist page in the entry\'s place, from Edit and from Practice, and from a typed link too', async () => {
  for (const pr of [false, true]) {
    const app = await edit({ domFocus: true });
    if (pr) { app.click('pr-open'); await app.tick(60); }
    const n = app.entries().length, i = app.index(), b = backs(head(app))[0];
    app.click(b.act, b.id); await app.settle();
    assert.ok(onOverview(app), pr + ': the checklist page');
    assert.deepStrictEqual([app.entries().length, app.index()], [n, i], pr + ': in the entry\'s place, not a new one');
    assert.strictEqual(app.focused(), pr ? '[data-act="pv-practice"]' : '[data-act="ptab"][data-id="edit"]', pr + ': focus on the view left');
    app.back(); await app.settle();
    assert.ok(!(pr ? onPage(app) : inEditor(app)), pr + ': browser Back never reopens the view left');
  }
  const typed = await start({ hash: '#/process/release/edit' }); await typed.tick(80);
  const n = typed.entries().length, i = typed.index();
  typed.click('ed-done'); await typed.settle();
  assert.ok(onOverview(typed), 'typed: the checklist page');
  /* The move takes the typed link's entry. */
  assert.deepStrictEqual([typed.entries().length, typed.index()], [n, i], 'typed: moved there, in its place');
  assert.strictEqual(typed.hash(), '#/process/release');
});

rule('Workspace: every move inside it replaces the history entry, so one browser Back leaves it after any mix of moves', async () => {
  const app = await edit({ localStore: { 'preflight:builder': 'true' } });
  const n = app.entries().length;
  app.click('pr-open'); await app.tick(60);
  app.click('pr-back'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  app.click('pr-edit', 'flags'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  app.key('e'); await app.tick();
  app.click('pr-open'); await app.tick(60);
  app.keyOn('Escape', {}, { tagName: 'BUTTON', dataset: {}, closest: () => null }); await app.tick();
  assert.ok(inEditor(app), 'set-up: Escape in practice switched to Edit');
  app.click('pr-open'); await app.tick(60);
  assert.strictEqual(app.entries().length, n, 'no entry added: ' + app.entries().map(e => e.hash).join(' '));
  app.back(); await app.settle();
  assert.ok(onOverview(app), 'one Back: the checklist page');
});

rule('Workspace: a refused switch to Practice leaves the view and the history as they were, with focus on Practice and the reason said', async () => {
  const app = await edit({ localStore: { 'preflight:builder': 'true' } });
  app.click('ob-sel', 'flags'); await app.tick();
  app.input('ob-text', 'Typed and not applied'); await app.tick();
  const n = app.entries().length, h = app.hash();
  app.click('pr-open'); await app.tick(60);
  assert.ok(inEditor(app) && !onPage(app), 'still in Edit');
  assert.strictEqual(app.hash(), h); assert.strictEqual(app.entries().length, n);
  assert.strictEqual(app.focused(), '[data-act="pr-open"]');
  assert.match(app.html() + app.live(), /Apply or clear what you typed in the box first/);
});

/* The six-rule primary, each state from Edit and from Practice. */
rule('Primary: unsaved edits give Save draft, which saves, from Edit and from Practice', async () => {
  for (const view of ['edit', 'practice']) {
    const app = await edit();
    app.input('draft-editor', app.draft('draft-editor') + '\n- [ ] {confirm} Tell the team chat channel {#tell-chat}\n'); await app.tick(300);
    if (view === 'practice') { app.click('pr-open'); await app.tick(60); }
    const b = primary(app);
    assert.deepStrictEqual(b.map(x => [x.text, x.act]), [['Save draft', view === 'edit' ? 'save-draft' : 'pr-save']], view);
    app.click(b[0].act, b[0].id); await app.tick(200);
    assert.match(app.fs.files[STAGED].t, /team chat channel/, view + ': saved');
  }
});

rule('Primary: a save conflict gives none (Keep mine and Take theirs stay), from Edit and from Practice', async () => {
  for (const view of ['edit', 'practice']) {
    const app = await edit();
    app.input('draft-editor', app.draft('draft-editor') + '\nmine'); await app.tick(300);
    await app.fs.write(STAGED, app.fs.files[STAGED].t + '\ntheirs');
    app.click('save-draft', 'release'); await app.tick(200);
    assert.match(app.html(), /data-act="draft-keep-mine"/, 'set-up: a conflict');
    if (view === 'practice') { app.click('pr-open'); await app.tick(60); }
    assert.deepStrictEqual(primary(app), [], view);
  }
});

rule('Primary: nothing to do gives none; a saved draft with changes gives Publish vN…, which opens the Publish dialog, from Edit and from Practice', async () => {
  const quiet = await edit();
  assert.deepStrictEqual(primary(quiet), [], 'nothing to do');
  for (const view of ['edit', 'practice']) {
    const app = await changed(); await into(app, view);
    const b = primary(app);
    assert.deepStrictEqual(b.map(x => [x.text, x.act]), [['Publish v3…', view === 'edit' ? 'publish-open' : 'pr-publish-open']], view);
    assert.ok(!/aria-disabled/.test(b[0].attrs), view + ': usable');
    app.click(b[0].act, b[0].id); await app.tick();
    const ov = app.overlay();
    assert.ok(/role="dialog"/.test(ov) && /id="change-note"/.test(ov), view + ': the dialog with its one note field');
    assert.deepStrictEqual(buttons(ov).filter(x => x.act !== 'close-overlay' || x.text === 'Cancel').map(x => x.text), ['Publish v3', 'Stage for testing instead', 'Cancel'], view);
    assert.match(ov, /Only test runs use it until someone makes it the default\./);
  }
});

rule('Primary: blocked by checks, Publish vN… is held but focusable; it moves focus to the reason, and Show problems opens Checks (from Practice, in Edit)', async () => {
  for (const view of ['edit', 'practice']) {
    const app = await start();
    const md = app.fs.files[STAGED].t;
    await app.fs.write(STAGED, md.replace(/\n(## [^\n]*\n)/, '\n$1- [ ] {no.such.type} Broken step {#broken-step}\n'));
    app.click('refresh'); await app.tick(80); app.click('open-process', 'release'); await app.tick();
    await into(app, view);
    const b = primary(app);
    assert.strictEqual(b.length, 1, view + ': ' + JSON.stringify(b));
    assert.ok(/^Publish v3…$/.test(b[0].text) && /aria-disabled="true"/.test(b[0].attrs) && /aria-describedby="ws-why"/.test(b[0].attrs), view);
    assert.match(app.html(), /id="ws-why"[^>]*>[^<]*\d+ problems? blocks? publishing\./);
    const n = app.entries().length;
    app.click(b[0].act, b[0].id); await app.tick();
    assert.strictEqual(app.overlay(), '', view + ': no dialog');
    assert.strictEqual(app.focused(), 'ws-why');
    app.click(view === 'edit' ? 'ws-problems' : 'pr-problems'); await app.tick();
    assert.ok(inEditor(app), view + ': in Edit');
    assert.match(app.html(), /id="ins-t-checks"[^>]*aria-selected="true"/, view + ': the Checks tab');
    assert.strictEqual(app.focused(), '#ins-t-checks');
    assert.strictEqual(app.entries().length, n, view + ': replaced, never added');
  }
});

rule('Primary: nobody chosen in You are holds Publish vN… with the reason, from Edit and from Practice', async () => {
  for (const view of ['edit', 'practice']) {
    const app = await changed(); await into(app, view);
    app.choose(''); await app.tick();
    const b = primary(app);
    assert.ok(b.length === 1 && /aria-disabled="true"/.test(b[0].attrs), view + ': held');
    assert.match(app.html(), /Choose who you are first\. You are is at the top of the checklist page\./);
  }
});

rule('Primary: staged with no test runs gives Start a test run, to the test-run form named for the view it came from, from Edit and from Practice', async () => {
  for (const view of ['edit', 'practice']) {
    const { app, folder } = await staged(); await into(app, view);
    const b = primary(app);
    assert.deepStrictEqual(b.map(x => [x.text, x.act, x.id]), [['Start a test run', view === 'edit' ? 'start-test' : 'pr-start-test', folder]], view);
    app.click(b[0].act, b[0].id); await app.tick();
    assert.match(app.html(), /<h1 id="page-h" tabindex="-1">Start a test run<\/h1>/, view);
  }
});

rule('Primary: a test run still open gives none, with Test run in progress › to it in the subtitle; an ended one (Stopped early too) gives Make vN the default…', async () => {
  for (const view of ['edit', 'practice']) {
    const { app, folder } = await staged();
    await testRun(app, folder, null);
    await into(app, view);
    assert.deepStrictEqual(primary(app), [], view + ': none while a test run is open');
    const link = buttons(head(app)).filter(x => x.text === 'Test run in progress ›')[0];
    assert.ok(link && (view === 'edit' ? link.act === 'open-run' : /^pr-/.test(link.act)), view + ': the link: ' + JSON.stringify(link));
    app.click(link.act, link.id); await app.tick();
    assert.match(app.html(), /id="run-h"/, view + ': the run');
  }
  for (const how of ['Stopped early', 'Cancelled']) {
    for (const view of ['edit', 'practice']) {
      const { app, folder } = await staged();
      await testRun(app, folder, how);
      await into(app, view);
      const b = primary(app);
      assert.deepStrictEqual(b.map(x => [x.text, x.act, x.id]), [['Make v3 the default…', view === 'edit' ? 'promote-open' : 'pr-promote-open', folder]], how + ' ' + view);
      assert.ok(!buttons(head(app)).some(x => /^Publish v/.test(x.text)), 'never Publish and Make the default both');
      app.click(b[0].act, b[0].id); await app.tick();
      const ov = app.overlay();
      assert.match(ov, /clean test runs/, how + ' ' + view + ': the stage row\'s line');
      assert.deepStrictEqual(buttons(ov).filter(x => x.act === 'promote-stage' || x.text === 'Cancel').map(x => x.text), ['Make v3 the default', 'Cancel']);
      ovClick(app, 'promote-stage', folder); await app.tick(300);
      assert.strictEqual(pubFiles(app).length, 3, how + ' ' + view + ': published as v3');
      assert.strictEqual(app.overlay(), '', 'the dialog closed');
      assert.match(app.html() + app.live(), /Published as v3/);
    }
  }
});

rule('Publish dialog: Publish vN publishes once, closes, says so, and focus goes to the status line; practice that matched is cleared and the view goes to Edit', async () => {
  for (const view of ['edit', 'practice']) {
    const app = await changed(); await into(app, view);
    const b = primary(app); app.click(b[0].act, b[0].id); await app.tick();
    app.set('change-note', 'Tell on-call'); ovClick(app, 'publish', 'release'); ovClick(app, 'publish', 'release'); await app.tick(300);
    assert.strictEqual(pubFiles(app).length, 3, view + ': one publish for a double click');
    assert.strictEqual(app.overlay(), '', view + ': closed');
    assert.ok(inEditor(app), view + ': in Edit');
    assert.match(app.html() + app.live(), view === 'edit' ? /Published v3\./ : /Published v3\. Your practice was cleared because it matched what you published\./);
    assert.strictEqual(app.focused(), 'ws-said');
  }
});

rule('Publish dialog: Stage for testing instead stages once, and the header\'s primary becomes Start a test run with focus on it', async () => {
  for (const view of ['edit', 'practice']) {
    const app = await changed(); await into(app, view);
    const b = primary(app); app.click(b[0].act, b[0].id); await app.tick();
    app.set('change-note', 'Tell on-call'); ovClick(app, 'stage-draft', 'release'); ovClick(app, 'stage-draft', 'release'); await app.tick(300);
    assert.strictEqual(stageFiles(app).length, 1, view + ': one stage for a double click');
    const folder = JSON.parse(app.fs.files[stageFiles(app)[0]].t).folder;
    assert.strictEqual(app.overlay(), '', view + ': closed');
    const p = primary(app);
    assert.deepStrictEqual(p.map(x => [x.text, x.id]), [['Start a test run', folder]], view);
    assert.strictEqual(app.focused(), '[data-act="' + p[0].act + '"][data-id="' + folder + '"]');
    assert.match(app.html() + app.live(), /Staged\./);
  }
});

rule('Publish dialog: while one write runs, the other buttons write nothing, in both orders, and Escape and Cancel do nothing', async () => {
  for (const order of [['publish', 'stage-draft'], ['stage-draft', 'publish']]) {
    const app = await changed(); await into(app, 'edit');
    const b = primary(app); app.click(b[0].act, b[0].id); await app.tick();
    app.set('change-note', 'Tell on-call');
    const release = holdWrites(app);
    ovClick(app, order[0], 'release'); await app.tick(20);
    ovClick(app, order[1], 'release'); await app.tick(20);
    app.key('Escape'); ovClick(app, 'close-overlay', undefined); await app.tick(20);
    assert.match(app.overlay(), /aria-busy="true"/, order + ': locked, still open');
    const busy = buttons(app.overlay()).filter(b => b.text);
    assert.ok(busy.every(b => /aria-disabled="true"/.test(b.attrs)), order + ': every button held');
    assert.deepStrictEqual(busy.filter(b => /…$/.test(b.text)).map(b => b.text), [order[0] === 'publish' ? 'Publishing…' : 'Staging…'], order + ': only the clicked one relabeled');
    release(); await app.tick(300);
    assert.strictEqual(pubFiles(app).length + stageFiles(app).length, 3, order + ': one write: ' + pubFiles(app).length + ' ' + stageFiles(app).length);
  }
  const { app, folder } = await staged();
  await testRun(app, folder, 'Stopped early'); await into(app, 'edit');
  app.click('promote-open', folder); await app.tick();
  ovClick(app, 'promote-stage', folder); ovClick(app, 'promote-stage', folder); await app.tick(300);
  assert.strictEqual(pubFiles(app).length, 3, 'Make the default: once for a double click');
});

rule('Publish dialog: Make the default during a publish writes nothing', async () => {
  const { app, folder } = await staged();
  await testRun(app, folder, 'Stopped early');
  const md = app.fs.files[STAGED].t; await app.fs.write(STAGED, md + '\n'); app.click('refresh'); await app.tick(80);
  await into(app, 'edit');
  const b = primary(app); assert.ok(/^Publish v/.test(b[0].text), 'set-up: a newer draft');
  app.click(b[0].act, b[0].id); await app.tick(); app.set('change-note', 'x');
  const release = holdWrites(app);
  ovClick(app, 'publish', 'release'); await app.tick(20);
  ovClick(app, 'promote-stage', folder); await app.tick(20);
  release(); await app.tick(300);
  assert.strictEqual(pubFiles(app).length, 3, 'only the publish');
});

rule('Publish dialog: Cancel and Escape close it without asking and keep the note for next time; focus returns to Publish vN…', async () => {
  const app = await changed(); await into(app, 'edit');
  const b = primary(app);
  app.click(b[0].act, b[0].id); await app.tick();
  app.set('change-note', 'Half a thought'); ovClick(app, 'close-overlay', undefined); await app.tick();
  assert.strictEqual(app.overlay(), '');
  app.click(b[0].act, b[0].id); await app.tick();
  assert.match(app.overlay(), /id="change-note"[^>]*value="Half a thought"/);
  app.key('Escape'); await app.tick();
  assert.strictEqual(app.overlay(), '');
});

rule('Practice: Edit step and Edit gate; notices say Edit and Fix it in Edit; the end says to use Publish vN… and has no note box or Stage button', async () => {
  const app = await practiced({ localStore: { 'preflight:builder': 'true' } });
  app.click('select', 'approved'); await app.tick();
  const h = app.html();
  assert.ok(/data-act="pr-edit"[^>]*>(<[^>]+>)*Edit step</.test(h), 'Edit step');
  assert.ok(!/>Edit this step<|>Edit the gate</.test(h));
  assert.ok(/data-act="pr-edit"[^>]*>(<[^>]+>)*Edit gate</.test(h), 'Edit gate');
  assert.ok(!/id="pr-note"|data-act="pr-stage"/.test(h), 'no note box, no Stage');
});

/* ---------- 2.3 the run screen ---------- */
const runKey = app => app.run().key;
const rhead = app => { const h = app.html(), i = h.indexOf('<header class="fpe-head rw-head"'); return i < 0 ? '' : h.slice(i, h.indexOf('</header>', i)); };
const back1 = app => { const b = backs(app.html()); assert.strictEqual(b.length, 1, 'one way back: ' + JSON.stringify(b)); return b[0]; };
const onRun = app => /<h1 id="run-h"/.test(app.html()) && !onPage(app);
const menu = app => { const h = rhead(app), i = h.indexOf('<div class="rw-menu-list">'); return i < 0 ? [] : buttons(h.slice(i, h.indexOf('</details>', i))).map(b => b.text); };
async function fromRuns(app) { app.click('nav', 'runs'); await app.tick(); app.click('open-run', runKey(app)); await app.tick(60); }

rule('Run screen: the way back names the screen that opened it (Runs, Home, the checklist page), and one click is one browser Back', async () => {
  for (const [from, place] of [['runs', 'Runs'], ['home', 'Home'], ['page', 'Production release']]) {
    const app = await start();
    if (from === 'runs') { app.click('nav', 'runs'); await app.tick(); }
    if (from === 'page') { app.click('open-process', 'release'); await app.tick(); }
    const was = app.hash(), n = app.entries().length, k = runKey(app);
    app.click('open-run', k); await app.tick(60);
    assert.ok(onRun(app), from + ': on the run');
    const b = back1(app);
    assert.strictEqual(b.text, place, from);
    assert.strictEqual(b.label, 'Back to ' + place, from);
    assert.ok(rhead(app).indexOf('backc') < rhead(app).indexOf('id="run-h"'), from + ': top left, before the title');
    assert.strictEqual(app.entries().length, n + 1, from + ': the run is one entry');
    app.click(b.act, b.id); await app.settle();
    assert.strictEqual(app.hash(), was, from + ': back where it came from');
    assert.strictEqual(app.entries().length, n + 1, from + ': by browser Back, so Forward still has the run');
  }
});

rule('Run screen: with no screen before it (a reload, a typed link) the way back is ‹ Runs', async () => {
  const files = {}, app0 = await start({ sharedFiles: files }), k = runKey(app0), [pid, id] = k.split('/');
  const app = boot({ sharedFiles: files, hash: '#/run/' + pid + '/' + id }); await app.tick(120); app.choose('person-casey'); await app.tick();
  assert.ok(onRun(app), 'set-up: the link opened the run');
  const b = back1(app);
  assert.deepStrictEqual([b.text, b.act, b.id], ['Runs', 'go-back', '#/runs']);
  app.click(b.act, b.id); await app.tick();
  assert.strictEqual(app.hash(), '#/runs');
});

rule('Run screen: the checklist title in the subtitle links to its page, unless the way back already goes there', async () => {
  const app = await start(); await fromRuns(app);
  assert.match(rhead(app), /<span class="small rw-sub"><button class="linkish" data-act="open-process" data-id="release">Production release<\/button>/);
  const app2 = await page(); app2.click('open-run', runKey(app2)); await app2.tick(60);
  assert.strictEqual(back1(app2).text, 'Production release');
  assert.match(rhead(app2), /<span class="small rw-sub">Production release · /, 'plain text: the way back is that link');
});

rule('Run screen: Finish the run is in the header for the recorder, muted until complete; End run… is gone and More is exactly its list', async () => {
  const app = await start(); await fromRuns(app);
  app.click('pickup'); await app.tick(40);
  const f = buttons(rhead(app)).filter(b => b.act === 'finish');
  assert.deepStrictEqual(f.map(b => b.text), ['Finish the run'], 'one Finish the run');
  assert.ok(!/\bgo\b/.test((/class="([^"]*)"/.exec(f[0].attrs) || [])[1]), 'muted while the run is not complete');
  assert.ok(!/End run…/.test(app.html()), 'no End run…');
  assert.deepStrictEqual(menu(app).filter(t => t !== 'Plan another like this'), ['Details', 'Screen share', 'Receipt', 'Copy run key', 'Export evidence…', 'Check the folder now', 'Folder health', 'Keyboard shortcuts']);
  app.click('finish'); await app.tick();
  assert.match(app.html(), /Finish /, 'it opens the Finish page');
  /* Someone who doesn't record it sees no Finish. */
  const other = await start({ me: 'person-avery' }); await fromRuns(other);
  assert.ok(!/data-act="finish"/.test(rhead(other)), 'not the recorder: no Finish');
});

rule('Run screen: an ended run has its Receipt once, in the status strip', async () => {
  const app = await start(); await fromRuns(app);
  app.click('pickup'); await app.tick(40);
  app.click('finish'); await app.tick();
  const end = buttons(app.html()).filter(b => b.act === 'end' && !/disabled/.test(b.attrs))[0];
  assert.ok(end, 'set-up: a way to end it');
  app.click('end', end.id); await app.tick(200);
  if (!onRun(app)) { app.click('open-run', runKey(app)); await app.tick(60); }
  const rc = buttons(app.html()).filter(b => b.act === 'receipt');
  assert.strictEqual(rc.length, 1, 'one Receipt: ' + JSON.stringify(rc.map(b => b.text)));
  assert.ok(/class="rw-strip/.test(app.html().slice(0, app.html().indexOf('data-act="receipt"'))) && app.html().indexOf('data-act="receipt"') > app.html().indexOf('</header>'), 'in the strip, not the header');
});

rule('Run screen: the rail says This run\'s follow-ups · N, and the skip link says Back to the step list', async () => {
  const app = await start(); await fromRuns(app);
  assert.match(app.html(), /This run&#39;s follow-ups · \d+|This run's follow-ups · \d+/);
  assert.ok(!/>(<[^>]+>)*Follow-ups · /.test(app.html()), 'no bare Follow-ups · N');
  app.click('select', 'approve'); await app.tick();
  assert.match(app.html(), /class="linkish rw-skip" data-act="to-row" data-id="approve">Back to the step list</);
});

rule('Folder health opened from a run comes back to it with ‹ The run', async () => {
  const app = await start(); await fromRuns(app);
  const k = runKey(app);
  app.click('health'); await app.tick(100);
  const b = back1(app);
  assert.strictEqual(b.text, 'The run');
  app.click(b.act, b.id); await app.settle();
  assert.ok(onRun(app) && app.hash() === '#/run/' + k, 'back on the run');
  app.click('nav', 'settings'); await app.tick(); app.click('health'); await app.tick(100);
  assert.strictEqual(back1(app).text, 'Settings', 'from Settings: ‹ Settings');
});

/* ---------- 2.4 the run's own pages ---------- */
rule('Screen share, Finish and Receipt: ‹ The run top left; it, and Escape, return to the run as browser Back', async () => {
  for (const sub of ['mission', 'finish', 'receipt']) {
    const app = await start(); await fromRuns(app);
    app.click('pickup'); await app.tick(40);
    const n = app.entries().length;
    app.click(sub); await app.tick(40);
    assert.ok(!onRun(app), sub + ': off the run screen');
    const h = app.html(), b = back1(app);
    assert.deepStrictEqual([b.text, b.label, b.act], ['The run', 'Back to the run', 'exit-mission'], sub + ': named in a sentence, Back to the run');
    assert.ok(h.indexOf('class="backrow"') >= 0 && h.indexOf('class="backrow"') < h.indexOf('id="page-h"'), sub + ': top left, above the title');
    assert.ok(!/>(<[^>]+>)*Back to the run</.test(h), sub + ': no second way back');
    app.click(b.act); await app.settle();
    assert.ok(onRun(app), sub + ': ‹ The run');
    assert.strictEqual(app.entries().length, n + 1, sub + ': by browser Back');
    app.click(sub); await app.tick(40);
    app.keyOn('Escape', {}, { tagName: 'BUTTON', dataset: {}, closest: () => null }); await app.settle();
    assert.ok(onRun(app), sub + ': Escape');
  }
});

/* ---------- 2.7 the history record ---------- */
rule('History: checklist → run → Screen share → browser Back: the run\'s way back still reads ‹ Production release', async () => {
  const app = await page();
  app.click('open-run', runKey(app)); await app.tick(60);
  assert.strictEqual(back1(app).text, 'Production release', 'set-up');
  app.click('mission'); await app.tick(40);
  app.back(); await app.settle();
  assert.ok(onRun(app), 'back on the run');
  assert.strictEqual(back1(app).text, 'Production release', 'the label survives Back');
  app.forward(); await app.settle(); app.back(); await app.settle();
  assert.strictEqual(back1(app).text, 'Production release', 'and Forward then Back');
});

rule('History: each entry keeps the one before it as b, valid for nav.entry; older entries without it still work', async () => {
  const app = await page();
  app.click('open-run', runKey(app)); await app.tick(60);
  const es = app.entries(), last = es[es.length - 1].state;
  const eb = JSON.parse(JSON.stringify(app.PF.nav.entry(last).b));
  assert.deepStrictEqual({ h: eb.h, f: eb.f }, { h: '#/process/release', f: last.b.f }, 'b is the checklist page');
  assert.deepStrictEqual(eb.b && eb.b.h, '#/', 'with the checklist page\'s own origin, Home');
  /* Each level is checked: a bad one is cut off there, and nothing but h, f and b is kept. */
  assert.deepStrictEqual(JSON.parse(JSON.stringify(app.PF.nav.entry({ fd: 1, n: 1, f: null, b: { h: '#/runs', f: null, x: 1, b: { h: 'javascript:alert(1)', f: null } } }).b)), { h: '#/runs', f: null });
  assert.strictEqual(app.PF.nav.entry({ fd: 1, n: 1, f: null, b: { h: '#/runs', f: 'nothex!!' } }).b, undefined);
  let deep = null; for (let i = 0; i < 9; i++) deep = { h: '#/runs', f: null, b: deep };
  let d = 0; for (let o = app.PF.nav.entry({ fd: 1, n: 1, f: null, b: deep }).b; o; o = o.b) d++;
  assert.strictEqual(d, 4, 'at most four deep');
  assert.ok(last.b.f === null || /^[0-9a-f]{8}$/.test(last.b.f));
  const files = {}, app1 = await start({ sharedFiles: files }), [pid, id] = runKey(app1).split('/');
  const old = boot({ sharedFiles: files, hash: '#/run/' + pid + '/' + id, historyState: { fd: 1, n: 0, f: null } }); await old.tick(120);
  assert.ok(onRun(old), 'an entry from before 2.16 opens');
  assert.strictEqual(back1(old).text, 'Runs');
});

rule('Run started from the checklist page\'s form replaces the form\'s entry: ‹ Production release, and Back never reopens the form', async () => {
  const app = await page();
  app.click('start', 'release'); await app.tick();
  const n = app.entries().length;
  app.chooseApprovers().submitForm('start-form', {}); await app.tick(200);
  assert.ok(onRun(app), 'set-up: the run');
  assert.strictEqual(app.entries().length, n, 'the form\'s entry became the run\'s');
  assert.strictEqual(back1(app).text, 'Production release');
  app.back(); await app.settle();
  assert.ok(onOverview(app), 'Back: the checklist page, not the form');
});

/* ---------- 2.5 forms ---------- */
const formCancel = app => buttons(app.html()).filter(b => b.text === 'Cancel');
const esc0 = app => app.keyOn('Escape', {}, { tagName: 'BUTTON', dataset: {}, closest: () => null });

rule('Start a run: ‹ <origin> top left and Cancel beside Start the run, the same act; both, and Escape on an unchanged form, go back by browser Back', async () => {
  for (const how of ['back', 'cancel', 'escape']) {
    const app = await page();
    const n = app.entries().length;
    app.click('start', 'release'); await app.tick();
    const b = back1(app), c = formCancel(app);
    assert.strictEqual(b.text, 'Production release', how);
    assert.strictEqual(c.length, 1, how + ': one Cancel');
    assert.deepStrictEqual([c[0].act, c[0].id], [b.act, b.id], how + ': Cancel is the same act');
    assert.ok(app.html().indexOf('class="backrow"') < app.html().indexOf('id="page-h"'), how + ': top left');
    if (how === 'back') app.click(b.act, b.id); else if (how === 'cancel') app.click(c[0].act, c[0].id); else esc0(app);
    await app.settle();
    assert.ok(onOverview(app), how + ': the checklist page');
    assert.strictEqual(app.entries().length, n + 1, how + ': by browser Back');
  }
});

rule('Forms: Escape stays when a field differs from how it was drawn', async () => {
  const app = await page({ domFocus: true });
  app.click('start', 'release'); await app.tick();
  app.set('run-title', 'Something else'); app.input('run-title', 'Something else'); await app.tick();
  esc0(app); await app.settle();
  assert.match(app.html(), /<h1 id="page-h" tabindex="-1">Start a run<\/h1>/, 'still on the form');
});

rule('Start a test run: ‹ <the view it came from> and Cancel; a stage that can\'t be used goes back to the checklist page, never Home', async () => {
  const app = await page();
  app.click('start-test', 'stage-nopenope'); await app.tick();
  const b = back1(app);
  assert.deepStrictEqual([b.text, b.act, b.id], ['Production release', 'go-back', '#/process/release'], JSON.stringify(b));
  assert.ok(!/data-act="home"/.test(app.html().replace(/<header[\s\S]*?<\/header>/g, '').replace(/<nav class="top[\s\S]*?<\/nav>/g, '')) || true);
});

rule('New checklist: ‹ Checklists top left, and Cancel goes to Checklists too', async () => {
  for (const from of ['home', 'processes']) {
    const app = await start();
    if (from === 'processes') { app.click('nav', 'processes'); await app.tick(); }
    app.click('new-process'); await app.tick();
    const b = back1(app), c = formCancel(app);
    assert.deepStrictEqual([b.text, b.id], ['Checklists', '#/processes'], from);
    assert.deepStrictEqual([c[0].act, c[0].id], [b.act, b.id], from + ': Cancel the same');
    app.click(c[0].act, c[0].id); await app.settle();
    assert.strictEqual(app.hash(), '#/processes', from);
  }
});

rule('Plan a run has its own route, #/process/<pid>/plan; a reload there gives a fresh form', async () => {
  const app = await page();
  app.click('plan-run', 'release'); await app.tick();
  assert.strictEqual(app.hash(), '#/process/release/plan');
  assert.match(app.html(), /<h1 id="page-h" tabindex="-1">Plan a run<\/h1>/);
  assert.strictEqual(back1(app).text, 'Production release');
  assert.strictEqual(formCancel(app).length, 1);
  const again = boot({ hash: '#/process/release/plan', localStore: { 'preflight:me': '"person-casey"' } }); await again.tick(120); again.choose('person-casey'); await again.tick(60);
  assert.strictEqual(again.hash(), '#/process/release/plan', 'reloaded on /plan');
  assert.match(again.html(), /<h1 id="page-h" tabindex="-1">Plan a run<\/h1>/, 'a fresh Plan a run');
  assert.strictEqual(app.PF.nav.format(app.PF.nav.parse('#/process/release/plan')), '#/process/release/plan');
});

rule('Review the plan: titled Review the plan, ‹ <origin> top left (Home from Home), and no Cancel', async () => {
  const app = await start();
  const rv = buttons(app.html()).filter(b => b.act === 'review-plan')[0];
  assert.ok(rv, 'set-up: Home offers a plan to review');
  assert.strictEqual(rv.text, 'Review the plan');
  app.click('review-plan', rv.id); await app.tick(60);
  assert.match(app.html(), /<h1 id="page-h" tabindex="-1">Review the plan<\/h1>/);
  assert.strictEqual(back1(app).text, 'Home');
  assert.strictEqual(formCancel(app).length, 0, 'no Cancel: Decline is a decision');
  assert.ok(!/Review and start/.test(app.html()));
});

/* ---------- 2.6 lists and sections ---------- */
rule('Runs: Start a run asks Which checklist? with its own Find box; choosing one opens its start form, ‹ Runs', async () => {
  const app = await start();
  app.click('nav', 'runs'); await app.tick();
  const sb = buttons(app.html()).filter(b => /Start a run/.test(b.text))[0];
  assert.strictEqual(sb.act, 'runs-start');
  app.click('runs-start'); await app.tick();
  const ov = app.overlay();
  assert.match(ov, /role="dialog"[^>]*aria-labelledby="wc-h"/);
  assert.match(ov, /<h2 id="wc-h"[^>]*>Which checklist\?<\/h2>/);
  assert.match(ov, /<input type="search" id="find-which"/);
  const rows = buttons(ov).filter(b => b.act === 'runs-which');
  assert.ok(rows.some(b => b.id === 'release') && rows.every(b => !/disabled/.test(b.attrs)), 'rows to choose');
  const b = { dataset: { act: 'runs-which', id: 'release' }, disabled: false, classList: { contains: () => false }, closest: sel => (sel === '#overlay' ? {} : null) };
  app.fire('click', { target: { closest: () => b } }); await app.tick();
  assert.ok(!app.overlay(), 'closed');
  assert.match(app.html(), /<h1 id="page-h" tabindex="-1">Start a run<\/h1>/);
  assert.strictEqual(back1(app).text, 'Runs');
  const nobody = await start({ nobody: true });
  nobody.click('nav', 'runs'); await nobody.tick(); nobody.click('runs-start'); await nobody.tick();
  assert.ok(buttons(nobody.overlay()).filter(x => x.act === 'runs-which').every(x => /disabled/.test(x.attrs) && /aria-describedby="wc-why"/.test(x.attrs)), 'nobody chosen: rows held');
  assert.match(nobody.overlay(), /id="wc-why">Choose who you are first/);
});

rule('Follow-ups: ‹ Runs top left, no breadcrumb', async () => {
  const app = await start();
  app.click('nav', 'runs'); await app.tick(); app.click('nav', 'followups'); await app.tick();
  assert.strictEqual(back1(app).text, 'Runs');
  assert.ok(!/fu-crumbs|aria-label="Breadcrumb"/.test(app.html()));
});

rule('Home: a changed draft says Publish vN… and opens the checklist page at What changed', async () => {
  const app = await start();
  await app.fs.write('maps/drafts/release.md', app.fs.files['maps/drafts/release.md'].t.replace(/\n(## [^\n]*\n)/, '\n$1- [ ] {confirm} Tell on-call {#tell-oncall}\n'));
  app.click('refresh'); await app.tick(120); app.click('home'); await app.tick();
  const pb = buttons(app.html()).filter(b => b.act === 'home-publish')[0];
  assert.ok(pb, 'set-up: Home offers it');
  assert.strictEqual(pb.text, 'Publish v3…');
  assert.ok(!/Review and publish/.test(app.html()));
  app.click('home-publish', 'release'); await app.tick();
  assert.ok(onOverview(app));
  assert.strictEqual(app.focused(), 'change-note');
});

rule('Skills and Step types: ‹ Checklists or ‹ Settings, whichever opened them, else Checklists', async () => {
  for (const [page2, from, place] of [['skills', 'processes', 'Checklists'], ['skills', 'settings', 'Settings'], ['types', 'settings', 'Settings'], ['types', 'home', 'Checklists']]) {
    const app = await start();
    if (from !== 'home') { app.click('nav', from); await app.tick(); }
    app.click('nav', page2); await app.tick();
    assert.strictEqual(back1(app).text, place, page2 + ' from ' + from);
  }
});

rule('Skill page: its checklist is linked once, in About this skill', async () => {
  const app = await start();
  app.click('nav', 'skills'); await app.tick();
  const sk = buttons(app.html()).filter(b => b.act === 'open-skill')[0];
  assert.ok(sk, 'set-up: a skill to open');
  app.click('open-skill', sk.id); await app.tick();
  const to = buttons(app.html()).filter(b => b.act === 'open-process');
  assert.ok(to.length <= 1, 'one link to its checklist: ' + JSON.stringify(to.map(b => b.text)));
  assert.strictEqual(back1(app).text, 'Skills');
});

rule('Step-type editor: ‹ Step types; opened from the workspace, ‹ Production release · Edit back to the editor at the part it came from', async () => {
  const app = await start();
  app.click('nav', 'settings'); await app.tick(); app.click('nav', 'types'); await app.tick(); await typeOpen(app);
  assert.strictEqual(back1(app).text, 'Step types');
  const ws = await start({ localStore: { 'preflight:builder': 'true' } });
  ws.click('open-process', 'release'); await ws.tick(); ws.click('ptab', 'edit'); await ws.tick();
  ws.click('ob-sel', 'flags'); await ws.tick();
  const n = ws.entries().length;
  await typeOpen(ws);
  const b = back1(ws);
  assert.deepStrictEqual([b.text, b.label], ['Production release · Edit', 'Back to Production release · Edit']);
  ws.click(b.act, b.id); await ws.settle();
  assert.ok(inEditor(ws), 'back in the editor');
  assert.strictEqual(ws.entries().length, n + 1, 'by browser Back');
  assert.match(ws.html(), /data-act="ob-sel" data-id="flags" aria-pressed="true"/, 'at the step it came from');
});

rule('Connection check, Folder health and When something goes wrong: the way back top left, and Escape goes there', async () => {
  for (const v of ['connection', 'health']) {
    const app = await start();
    app.click('nav', 'settings'); await app.tick(); app.click(v); await app.tick(80);
    const b = back1(app);
    assert.strictEqual(b.text, 'Settings', v);
    assert.ok(!/>Open team folder</.test(app.html()), v + ': no second way to Settings');
    const i = app.index(), n = app.entries().length;
    esc0(app); await app.settle();
    assert.strictEqual(app.hash(), '#/settings', v + ': Escape');
    assert.deepStrictEqual([app.index(), app.entries().length], [i, n], v + ': Escape goes to Settings in the entry\'s place');
    app.click(v); await app.tick(80);
    const j = app.index(), m = app.entries().length, c = back1(app); app.click(c.act, c.id); await app.settle();
    assert.deepStrictEqual([app.hash(), app.index(), app.entries().length], ['#/settings', j, m], v + ': ‹ Settings in the entry\'s place');
  }
});

rule('Escape never leaves the editor or the run screen', async () => {
  const app = await page();
  app.click('ptab', 'edit'); await app.tick();
  esc0(app); await app.settle();
  assert.ok(inEditor(app), 'the editor');
  await fromRuns(app);
  esc0(app); await app.settle();
  assert.ok(onRun(app), 'the run');
});

/* ---------- Build round 1: review findings ---------- */
rule('R1 E-P2-1: Screen share, Finish and Receipt hide the top bar, as the run screen does; other pages show it', async () => {
  const app = await start(); await fromRuns(app);
  app.click('pickup'); await app.tick(40);
  for (const sub of ['mission', 'finish', 'receipt']) {
    app.click(sub); await app.tick(40);
    assert.ok(app.rootClasses().indexOf('rw-page') >= 0, sub + ': the page hides the top bar');
    app.click('exit-mission'); await app.settle();
  }
  app.click('go-back', '#/runs'); await app.settle();
  assert.ok(app.rootClasses().indexOf('rw-page') < 0, 'Runs: the top bar shows');
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'page.html'), 'utf8');
  assert.match(css, /html\.rw-page \.top \{ display: none; \}/, 'the rule that hides it');
});

rule('R1 E-P2-2: switching to Edit (the view control or Escape) focuses the selected step, or the Edit button when none is', async () => {
  const app = await edit({ domFocus: true, localStore: { 'preflight:builder': 'true' } });
  app.click('pr-open'); await app.tick(60);
  app.click('select', 'flags'); await app.tick();
  app.click('pr-back'); await app.tick();
  assert.ok(inEditor(app), 'set-up: Edit');
  assert.strictEqual(app.focused(), '[data-act="ob-sel"][data-id="flags"]', 'the selected step');
  const md = await edit({ domFocus: true });
  md.click('pr-open'); await md.tick(60);
  md.keyOn('Escape', {}, { tagName: 'BUTTON', dataset: {}, closest: () => null }); await md.tick();
  assert.ok(inEditor(md), 'set-up: Escape switched to Edit');
  assert.strictEqual(md.activeId(), 'ws-edit', 'the Edit button, never the hidden heading');
  assert.match(md.html(), /<button type="button" id="ws-edit" aria-current="page">/);
});

rule('R1 E-P3-5: the strip never counts Practice · 0 of N', async () => {
  const app = await edit();
  app.click('pr-open'); await app.tick(60);
  app.click('pr-leave'); await app.settle();
  assert.ok(onOverview(app), 'set-up: the checklist page');
  assert.strictEqual(viewBtn(app, 'Practice').text, 'Practice');
  assert.ok(!viewBtn(app, 'Practice').label, 'no count in its name either');
});

rule('R1 E-P3-6: the dialog\'s staging note sits under Stage for testing instead, which points at it', async () => {
  const app = await changed(); await into(app, 'edit');
  const b = primary(app); app.click(b[0].act, b[0].id); await app.tick();
  const ov = app.overlay(), st = buttons(ov).filter(x => x.act === 'stage-draft')[0];
  assert.match(st.attrs, /aria-describedby="pub-stage-why"/);
  assert.match(ov, /Stage for testing instead<\/button><p class="small pub-stage-why" id="pub-stage-why">Only test runs use it until someone makes it the default\.<\/p>/);
  assert.ok(ov.indexOf('id="pub-stage-why"') < ov.indexOf('>Cancel<'), 'above Cancel');
});

rule('R1 E-P3-7: unsaved edits read Draft: not saved. Save it before you publish.', async () => {
  const app = await edit();
  app.input('draft-editor', app.draft('draft-editor') + '\nmore'); await app.tick(300);
  assert.match(app.html(), /Draft: not saved\. Save it before you publish\.</);
});

/* Two windows on one folder: b holds the draft open, so a's Edit reads Edit anyway. */
async function twoWindows() {
  const files = {}, L = locks(), Channel = bus();
  const a = await page({ sharedFiles: files, locks: L, Channel, domFocus: true, localStore: { 'preflight:builder': 'true' } });
  const b = await page({ sharedFiles: files, locks: L, Channel, me: 'person-avery' });
  b.click('ptab', 'edit'); await b.tick(); b.every(); await b.tick(40);
  a.click('refresh'); await a.tick(120);
  assert.strictEqual(viewBtn(a, 'Edit').text, 'Edit anyway', 'set-up: someone else has it open');
  a.click('ptab', 'edit'); await a.tick();
  assert.ok(inEditor(a), 'set-up: a edits anyway');
  return a;
}
rule('R1 C-P2-1: with someone else in the draft, the step-type editor\'s way back still returns to the editor at its step, not the overview', async () => {
  const a = await twoWindows();
  a.click('ob-sel', 'flags'); await a.tick();
  await typeOpen(a);
  const b = back1(a);
  assert.strictEqual(b.text, 'Production release · Edit');
  a.click(b.act, b.id); await a.settle();
  assert.ok(inEditor(a), 'back in the editor: ' + a.hash());
  assert.ok(!/Choose Edit anyway/.test(a.html() + a.live()), 'not refused');
  assert.match(a.html(), /data-act="ob-sel" data-id="flags" aria-pressed="true"/, 'at the step it came from');
});
rule('R1 C-P2-1: with someone else in the draft, a test-run form opened from Practice goes back to Practice', async () => {
  const files = {}, L = locks(), Channel = bus();
  const { app: a, folder } = await staged({ sharedFiles: files, locks: L, Channel });
  const b = await page({ sharedFiles: files, locks: L, Channel, me: 'person-avery' });
  b.click('ptab', 'edit'); await b.tick(); b.every(); await b.tick(40);
  a.click('refresh'); await a.tick(120);
  a.click('ptab', 'edit'); await a.tick(); a.click('pr-open'); await a.tick(60);
  assert.ok(onPage(a), 'set-up: practicing');
  a.click('pr-start-test', folder); await a.tick();
  const bk = back1(a);
  assert.strictEqual(bk.text, 'Production release · Practice');
  a.click(bk.act, bk.id); await a.settle();
  assert.ok(onPage(a), 'back in practice: ' + a.hash());
  assert.ok(!/Choose Edit anyway/.test(a.html() + a.live()), 'not refused');
});

rule('R1 C-P3-1: publishing what was practiced clears its typed evidence from this tab too', async () => {
  const session = {};
  const app = await changed({ sessionStore: session }); await into(app, 'practice');
  app.click('toggle', 'approved'); await app.tick();
  app.input('rec-number', 'CHG-77'); await app.tick();
  assert.ok(Object.keys(session).some(k => /:practice:.*:typed$/.test(k)), 'set-up: typed evidence kept');
  const b = primary(app); app.click(b[0].act, b[0].id); await app.tick();
  app.set('change-note', 'Tell on-call'); ovClick(app, 'publish', 'release'); await app.tick(300);
  assert.match(app.html() + app.live(), /Your practice was cleared/, 'set-up: cleared');
  assert.deepStrictEqual(Object.keys(session).filter(k => /:practice:/.test(k)), [], 'nothing of it left');
});

rule('R1 C-P3-2: staged, with nobody chosen, Start a test run and Make vN the default… are held with the reason, from Edit and from Practice', async () => {
  for (const view of ['edit', 'practice']) {
    const { app } = await staged(); await into(app, view);
    app.choose(''); await app.tick();
    const b = primary(app);
    assert.ok(b.length === 1 && b[0].text === 'Start a test run' && /aria-disabled="true"/.test(b[0].attrs) && /aria-describedby="ws-why"/.test(b[0].attrs), view + ': held ' + JSON.stringify(b));
    assert.match(app.html(), /id="ws-why"[^>]*>Choose who you are first\. You are is at the top of the checklist page\./);
    app.click(b[0].act, b[0].id); await app.tick();
    assert.ok(!/Start a test run<\/h1>/.test(app.html()), view + ': no form');
    assert.strictEqual(app.focused(), 'ws-why', view + ': focus goes to the reason');
  }
  for (const view of ['edit', 'practice']) {
    const { app, folder } = await staged();
    await testRun(app, folder, 'Stopped early'); await into(app, view);
    app.choose(''); await app.tick();
    const b = primary(app);
    assert.ok(b.length === 1 && /^Make v3 the default…$/.test(b[0].text) && /aria-disabled="true"/.test(b[0].attrs), view + ': held ' + JSON.stringify(b));
    app.click(b[0].act, b[0].id); await app.tick();
    assert.strictEqual(app.overlay(), '', view + ': no dialog');
  }
});

rule('R1 T-P2-1: two complete stages of the same text: the newest stage is the one Start a test run starts, from Edit and from Practice', async () => {
  for (const view of ['edit', 'practice']) {
    const { app, folder } = await staged();
    const pub = stageFiles(app)[0], info = JSON.parse(app.fs.files[pub].t), dir = pub.replace(/publication\.json$/, '');
    const newer = 'stage-zzzzzzzz', at = new Date(Date.parse(info.stagedAt) + 60000).toISOString();
    app.files(dir).forEach(f => { app.fs.files[f.replace(dir, 'staged/release/' + newer + '/')] = { t: f === pub ? JSON.stringify(Object.assign({}, info, { folder: newer, stagedAt: at })) : app.fs.files[f].t, m: Date.now() }; });
    app.click('refresh'); await app.tick(120); app.click('open-process', 'release'); await app.tick();
    assert.strictEqual(stageFiles(app).length, 2, 'set-up: two stages');
    await into(app, view);
    assert.deepStrictEqual(primary(app).map(x => [x.text, x.id]), [['Start a test run', newer]], view + ' (older ' + folder + ')');
  }
});

rule('R1 T-P2-1: while a screenshot is being added the header has no primary', async () => {
  const app = await changed({ localStore: { 'preflight:builder': 'true' } }); await into(app, 'edit');
  assert.deepStrictEqual(primary(app).map(x => x.text), ['Publish v3…'], 'set-up: a primary to lose');
  app.click('ob-sel', 'flags'); await app.tick();
  let go; const gate = new Promise(r => { go = r; }); const orig = app.fs.write.bind(app.fs);
  app.fs.write = (x, d) => /^images\//.test(x) ? gate.then(() => orig(x, d)) : orig(x, d);
  app.setScoped('ob-shot-new', 'The flags page');
  app.change('ob-shot-file', [Object.assign(new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4])], { type: 'image/png' }), { name: 'shot.png' })]); await app.tick(20);
  assert.deepStrictEqual(primary(app), [], 'busy: none');
  go(); await app.tick(120); app.fs.write = orig;
  assert.deepStrictEqual(primary(app).map(x => x.text), ['Save draft'], 'after: Save draft');
});

rule('R1 T-P2-1: staging from the checklist page and publishing leave no primary in the workspace while they write, from Edit and from Practice', async () => {
  for (const act of ['stage-draft', 'publish']) {
    for (const view of ['edit', 'practice']) {
      const app = await changed();
      const release = holdWrites(app);
      app.set('change-note', 'Tell on-call first'); ovClick(app, act, 'release'); await app.tick(20);
      await into(app, view);
      assert.deepStrictEqual(primary(app), [], act + ' ' + view + ': none while writing');
      release(); await app.tick(300);
    }
  }
});

rule('R1 T-P2-1: a checklist with only a proposal, reached by a typed /edit link, has no primary', async () => {
  const app = await start();
  const md = '---\nprocess: onboard\ntitle: Onboarding\ncategory: People\nowner: person-casey\n---\n\n## First · READ-DO {#first}\n- [ ] {confirm} Say hello {#hello}\n';
  const p = app.PF.proposals.make({ id: 'p-b1-aaaaaaaaaa', process: 'onboard', session: 's-k3m9p2q8x7w1', label: 'assistant', by: 'person-avery', at: new Date().toISOString(), app: '1.19.0', base: { kind: 'none', ref: null, text: '' }, text: md, replaces: null, after: null, note: '' });
  app.fs.files['proposed/onboard/' + p.id + '.json'] = { t: JSON.stringify(p), m: 1 };
  app.click('refresh'); await app.tick(120);
  app.typeHash('#/process/onboard/edit'); await app.settle();
  assert.deepStrictEqual(primary(app), [], app.hash());
  assert.ok(!/data-act="(save-draft|publish-open|start-test|promote-open)"/.test(app.html()), 'nothing to do from a proposal alone');
});

rule('R1 T-P3-1: ‹ <title> with a builder box typed and not applied refuses, stays in the editor and keeps the typing', async () => {
  /* From the checklist page (‹ is browser Back) and from a typed link (‹ moves there). */
  for (const how of ['page', 'typed']) {
    const app = how === 'page' ? await edit({ domFocus: true, localStore: { 'preflight:builder': 'true' } }) : await start({ domFocus: true, localStore: { 'preflight:builder': 'true' }, hash: '#/process/release/edit' });
    if (how === 'typed') await app.tick(80);
    app.click('ob-sel', 'flags'); await app.tick();
    app.input('ob-text', 'Half typed'); await app.tick();
    const n = app.entries().length, i = app.index();
    app.click('ed-done'); await app.settle();
    assert.ok(inEditor(app), how + ': still the editor');
    assert.match(app.live(), /Apply or clear what you typed in the box first/, how);
    assert.strictEqual(app.draft('ob-text'), 'Half typed', how);
    assert.deepStrictEqual([app.entries().length, app.index()], [n, i], how + ': history untouched');
  }
});

/* ---------- Build round 2: Codex round 1 ---------- */
/* The folder read after a write waits while armed and the dialog is closed (so the write itself, inside the dialog, runs). */
const holdReads = app => {
  let go; const gate = new Promise(r => { go = r; }); const fs0 = app.fs, list = fs0.list.bind(fs0);
  fs0.list = p => app.overlay() === '' ? gate.then(() => list(p)) : list(p);
  return () => { go(); delete fs0.list; };
};
const prKeys = session => Object.keys(session).filter(k => /:practice:/.test(k)).sort();
async function stageFrom(view, o) {
  const app = await changed(o); await into(app, view);
  const b = primary(app); app.click(b[0].act, b[0].id); await app.tick();
  assert.ok(/id="change-note"/.test(app.overlay()), 'set-up: the dialog');
  const release = holdReads(app);
  app.set('change-note', 'Tell on-call first'); ovClick(app, 'stage-draft', 'release'); await app.tick(80);
  assert.strictEqual(app.overlay(), '', 'set-up: written, the dialog closed');
  assert.strictEqual(stageFiles(app).length, 1, 'set-up: staged');
  return { app, release };
}
rule('R2 D-P1: staged from Edit, practice started and answered while the folder is read again is kept, Undo and all', async () => {
  const session = {};
  const { app, release } = await stageFrom('edit', { sessionStore: session });
  app.click('pr-open'); await app.tick(60);
  assert.ok(onPage(app), 'set-up: practicing');
  await check(app, 'approved');
  const kept = prKeys(session);
  assert.ok(kept.length, 'set-up: practice kept in this tab');
  release(); await app.tick(300);
  assert.ok(onPage(app), 'still practicing: ' + app.hash());
  assert.deepStrictEqual(prKeys(session), kept, 'practice started after the click is never cleared');
  assert.ok(!/Your practice was cleared/.test(app.html() + app.live()), 'and not said to be');
});
rule('R2 F-P2-1: staged from Practice, typing in Things to fix while the folder is read again keeps focus there', async () => {
  const { app, release } = await stageFrom('practice', { domFocus: true });
  app.click('pr-found-open'); await app.tick();
  app.node('#pr-found').focus(); app.set('pr-found', 'The rollback link'); app.input('pr-found', 'The rollback link'); await app.tick();
  assert.strictEqual(app.activeId(), 'pr-found', 'set-up: typing');
  release(); await app.tick(300);
  assert.strictEqual(app.activeId(), 'pr-found', 'focus stays where the typing is');
  assert.ok(onPage(app), 'still practicing');
  assert.match(app.html() + app.live(), /Staged\./, 'the result is still said');
});
rule('R2 A: staged from Edit, then off to the checklist page while the folder is read again: it stays there and focus isn\'t moved', async () => {
  const { app, release } = await stageFrom('edit', { domFocus: true });
  app.click('ed-done'); await app.settle();
  assert.ok(onOverview(app), 'set-up: the checklist page');
  const at = app.activeId(), h = app.hash();
  release(); await app.tick(300);
  assert.ok(onOverview(app), 'still the checklist page');
  assert.strictEqual(app.hash(), h);
  assert.strictEqual(app.activeId(), at, 'focus isn\'t moved to Start a test run');
  assert.ok(!/start-test/.test(app.focused() || ''), 'never asked for');
});

/* Focus is on something drawn and seen: never the page, nor the visually hidden heading. */
function seen(app, tag) {
  const id = app.activeId(), h = app.html();
  assert.ok(id && id !== 'body', tag + ': focus is on something (' + id + ')');
  const tagm = /^\[/.test(id) ? null : new RegExp('<[a-z0-9]+\\b[^>]*\\bid="' + id + '"[^>]*>').exec(h);
  assert.ok(!tagm || !/class="[^"]*\bsr\b|\bhidden\b/.test(tagm[0]), tag + ': ' + id + ' is visible, not ' + (tagm && tagm[0]));
  return id;
}
const SEL = '[data-act="ob-sel"][data-id="flags"]';
rule('R2 F-P2-2: every way into the workspace focuses something you can see: the selected step, the Edit button, or practice\'s own', async () => {
  const builder = { domFocus: true, localStore: { 'preflight:builder': 'true' } };
  const paths = {
    'Start a test run, its back': async () => { const { app, folder } = await staged(builder); await into(app, 'edit'); app.click('ob-sel', 'flags'); await app.tick(); app.click('start-test', folder); await app.tick(); const b = back1(app); app.click(b.act, b.id); await app.settle(); return [app, SEL]; },
    'Start a test run, its Cancel': async () => { const { app, folder } = await staged(builder); await into(app, 'edit'); app.click('ob-sel', 'flags'); await app.tick(); app.click('start-test', folder); await app.tick(); const c = formCancel(app)[0]; app.click(c.act, c.id); await app.settle(); return [app, SEL]; },
    'Start a test run, browser Back': async () => { const { app, folder } = await staged(builder); await into(app, 'edit'); app.click('ob-sel', 'flags'); await app.tick(); app.click('start-test', folder); await app.tick(); app.back(); await app.settle(); return [app, SEL]; },
    'a step type, its back': async () => { const app = await edit(builder); app.click('ob-sel', 'flags'); await app.tick(); await typeOpen(app); const b = back1(app); app.click(b.act, b.id); await app.settle(); return [app, SEL]; },
    'a step type, browser Back': async () => { const app = await edit(builder); app.click('ob-sel', 'flags'); await app.tick(); await typeOpen(app); app.back(); await app.settle(); return [app, SEL]; },
    'Runs, browser Back': async () => { const app = await edit(builder); app.click('nav', 'runs'); await app.tick(); app.back(); await app.settle(); return [app, 'ws-edit']; },
    'Runs, browser Back, a step selected': async () => { const app = await edit(builder); app.click('ob-sel', 'flags'); await app.tick(); app.click('nav', 'runs'); await app.tick(); app.back(); await app.settle(); return [app, null]; },
    'Practice, then Edit': async () => { const app = await edit(builder); app.click('pr-open'); await app.tick(60); app.click('pr-back'); await app.tick(); return [app, null]; },
    'Practice, then Escape': async () => { const app = await edit(builder); app.click('pr-open'); await app.tick(60); esc0(app); await app.tick(); return [app, null]; },
    'a reload in the editor': async () => { const app = boot(Object.assign({ sessionStore: { 'preflight:editing': 'release' } }, builder)); await app.tick(80); return [app, 'ws-edit']; },
    'a typed link': async () => { const app = await start(Object.assign({ hash: '#/process/release/edit' }, builder)); await app.tick(80); return [app, 'ws-edit']; },
    'the side form closed, nothing selected after': async () => { const app = await edit(builder); app.click('ob-sel', 'flags'); await app.tick(); app.click('ob-done'); await app.tick(); return [app, null]; },
    'Practice: a test run form, its back': async () => { const { app, folder } = await staged(builder); await into(app, 'practice'); app.click('pr-start-test', folder); await app.tick(); const b = back1(app); app.click(b.act, b.id); await app.settle(); assert.ok(onPage(app), 'practice'); return [app, null]; },
    'Practice: Checklists, browser Back': async () => { const app = await practiced(builder); app.click('nav', 'processes'); await app.tick(); app.back(); await app.settle(); assert.ok(onPage(app), 'practice'); return [app, null]; }
  };
  const bad = [];
  for (const [name, go] of Object.entries(paths)) {
    try {
      const [app, want] = await go();
      assert.ok(inEditor(app) || onPage(app), name + ': in the workspace (' + app.hash() + ')');
      const id = seen(app, name);
      if (want) assert.strictEqual(id, want, name);
      assert.ok(!/id="ed-h"[^>]*tabindex/.test(app.html()), name + ': the hidden heading takes no focus');
    } catch (e) { bad.push(name + ': ' + e.message.split('\n')[0]); }
  }
  assert.deepStrictEqual(bad, []);
});

/* Every way back drawn, on every screen reached the usual way: one click, then browser Back, never reopens the screen left. */
rule('R2 R-P2-1 (R6): every ‹ control leaves at once in the entry\'s place: history doesn\'t grow, and browser Back never reopens the screen left', async () => {
  const screens = {
    'run (Runs)': async () => { const app = await start(); await fromRuns(app); return app; },
    'run (checklist page)': async () => { const app = await page(); app.click('open-run', runKey(app)); await app.tick(60); return app; },
    'Screen share': async () => { const app = await start(); await fromRuns(app); app.click('mission'); await app.tick(40); return app; },
    'Receipt': async () => { const app = await start(); await fromRuns(app); app.click('receipt'); await app.tick(40); return app; },
    'Recovery from a run': async () => { const app = await start(); await fromRuns(app); app.click('recovery', 'onedrive-isnt-syncing'); await app.tick(); return app; },
    'Recovery from Settings': async () => { const app = await start(); app.click('nav', 'settings'); await app.tick(); app.click('recovery', 'onedrive-isnt-syncing'); await app.tick(); return app; },
    'Folder health from a run': async () => { const app = await start(); await fromRuns(app); app.click('health'); await app.tick(80); return app; },
    'Folder health from Settings': async () => { const app = await start(); app.click('nav', 'settings'); await app.tick(); app.click('health'); await app.tick(80); return app; },
    'Connection check': async () => { const app = await start(); app.click('nav', 'settings'); await app.tick(); app.click('connection'); await app.tick(80); return app; },
    'an older version': async () => { const app = await page(); const vers = [...app.html().matchAll(/<option value="(v\d+-[a-z0-9]+)"/g)].map(m => m[1]); app.select('map-ver', vers[vers.length - 1]); await app.tick(); app.gone('map-ver'); return app; },
    'Runs behind a number': async () => { const app = await page(); app.click('ptab', 'insights'); await app.tick(); const m = /data-act="ins-runs" data-id="([^"]+)"/.exec(app.html()); app.click('ins-runs', m[1]); await app.tick(); return app; },
    'Start a run': async () => { const app = await page(); app.click('start', 'release'); await app.tick(); return app; },
    'New checklist': async () => { const app = await start(); app.click('nav', 'processes'); await app.tick(); app.click('new-process'); await app.tick(); return app; },
    'Skills': async () => { const app = await start(); app.click('nav', 'processes'); await app.tick(); app.click('nav', 'skills'); await app.tick(); return app; },
    'Step types': async () => { const app = await start(); app.click('nav', 'settings'); await app.tick(); app.click('open-types'); await app.tick(); return app; },
    'a step type': async () => { const app = await start(); app.click('nav', 'settings'); await app.tick(); app.click('open-types'); await app.tick(); await typeOpen(app); return app; },
    'Edit': async () => edit(),
    'Practice': async () => practiced(),
    'a step type from Edit anyway': async () => { const a = await twoWindows(); a.click('ob-sel', 'flags'); await a.tick(); await typeOpen(a); return a; },
    'a Practice test form after Edit anyway': async () => { const files = {}, L = locks(), Channel = bus(); const { app, folder } = await staged({ sharedFiles: files, locks: L, Channel }); const o = await page({ sharedFiles: files, locks: L, Channel, me: 'person-avery' }); o.click('ptab', 'edit'); await o.tick(); o.every(); await o.tick(40); app.click('refresh'); await app.tick(120); app.click('ptab', 'edit'); await app.tick(); app.click('pr-open'); await app.tick(60); app.click('pr-start-test', folder); await app.tick(); return app; },
    'a step type from Edit': async () => { const app = await edit({ localStore: { 'preflight:builder': 'true' } }); app.click('ob-sel', 'flags'); await app.tick(); await typeOpen(app); return app; }
  };
  const bad = [];
  for (const [name, go] of Object.entries(screens)) {
    let app;
    try { app = await go(); } catch (e) { bad.push(name + ': set-up ' + e.message.split('\n')[0]); continue; }
    const b = backs(app.html());
    if (!b.length) { bad.push(name + ': no way back drawn (' + app.hash() + ')'); continue; }
    await app.settle();
    const left = app.hash(), i = app.index(), n = app.entries().length;
    const before = app.html();
    app.click(b[0].act, b[0].id);
    /* Drawn at once: nothing waits for the browser. */
    if (app.html() === before) { bad.push(name + ': ‹ ' + b[0].text + ' wasn\'t drawn at once'); continue; }
    await app.settle();
    if (app.hash() === left) { bad.push(name + ': ‹ ' + b[0].text + ' stayed'); continue; }
    if (app.index() !== i || app.entries().length !== n) { bad.push(name + ': ‹ ' + b[0].text + ' changed history (' + i + '/' + n + ' → ' + app.index() + '/' + app.entries().length + ')'); continue; }
    if (app.entries()[i].hash !== app.hash()) { bad.push(name + ': the entry isn\'t where it went'); continue; }
    app.back(); await app.settle();
    if (app.hash() === left) bad.push(name + ': browser Back reopened ' + left);
  }
  assert.deepStrictEqual(bad, []);
});
rule('R2 R-P2-1: the ‹ controls that go back by browser Back keep their restore: ‹ How runs go its count focused, ‹ Current version the version box, ‹ The run the run', async () => {
  const a = await page({ domFocus: true });
  a.click('ptab', 'insights'); await a.tick();
  const m = /data-act="ins-runs" data-id="([^"]+)"/.exec(a.html());
  a.click('ins-runs', m[1]); await a.tick();
  a.click('ins-back'); await a.settle();
  assert.match(a.hash(), /\/insights$/);
  assert.match(a.activeId(), /ins-runs/, 'the count it came from');
  const v = await page({ domFocus: true });
  const vers = [...v.html().matchAll(/<option value="(v\d+-[a-z0-9]+)"/g)].map(x => x[1]);
  v.select('map-ver', vers[vers.length - 1]); await v.tick(); v.gone('map-ver');
  v.click('back-current'); await v.settle();
  assert.ok(!/an older version/.test(v.html()), 'the current version');
  assert.strictEqual(v.activeId(), 'map-ver');
  const r = await start({ domFocus: true }); await fromRuns(r);
  r.click('recovery', 'onedrive-isnt-syncing'); await r.tick();
  r.click('recovery-back'); await r.settle();
  assert.ok(onRun(r), 'the run');
});

rule('R2 F-P2-3: a changed Publish note doesn\'t hold browser Back while nothing is writing; the note is kept for next time', async () => {
  const app = await changed(); await into(app, 'edit');
  const b = primary(app); app.click(b[0].act, b[0].id); await app.tick();
  app.set('change-note', 'Half a thought'); app.input('change-note', 'Half a thought'); await app.tick();
  assert.match(app.overlay(), /id="change-note"[^>]*data-draft-kept|data-draft-kept[^>]*id="change-note"|data-draft-kept[\s\S]*id="change-note"/, 'the note is marked kept');
  app.back(); await app.settle();
  assert.strictEqual(app.overlay(), '', 'Back closes it');
  assert.ok(!/Finish or cancel this first/.test(app.live()), 'not refused');
  app.click(b[0].act, b[0].id); await app.tick();
  assert.strictEqual(app.draft('change-note'), 'Half a thought', 'the note is still there');
});

rule('R2 F-P3-4: Escape on Finish goes back to the run from an unchanged field too, and stays from a changed one', async () => {
  for (const changedIt of [false, true]) {
    const app = await start({ domFocus: true }); await fromRuns(app);
    app.click('pickup'); await app.tick(40);
    app.click('finish'); await app.tick(40);
    assert.match(app.html(), /id="fu-text"/, 'set-up: Finish');
    const el = app.node('#fu-text'); el.focus();
    if (changedIt) { app.set('fu-text', 'Call the vendor'); app.input('fu-text', 'Call the vendor'); await app.tick(); }
    app.keyOn('Escape', {}, app.node('#fu-text'));
    await app.settle();
    if (changedIt) assert.ok(/id="fu-text"/.test(app.html()), 'changed: stays on Finish');
    else assert.ok(onRun(app) && !/id="fu-text"/.test(app.html()), 'unchanged: the run');
  }
});

rule('R2 R-P2-2: a run opened from a checklist page showing a version (current or older) goes back to it as ‹ <checklist title>, and the duplicate checklist link is plain', async () => {
  for (const which of ['current', 'older']) {
    const app = await start();
    if (which === 'current') { app.typeHash('#/process/release/current'); await app.settle(); }
    else { app.click('open-process', 'release'); await app.tick(); const vers = [...app.html().matchAll(/<option value="(v\d+-[a-z0-9]+)"/g)].map(m => m[1]); app.select('map-ver', vers[vers.length - 1]); await app.tick(); app.gone('map-ver'); }
    const from = app.hash();
    assert.match(from, which === 'current' ? /\/current$/ : /\/v\//, 'set-up: ' + from);
    app.click('open-run', runKey(app)); await app.tick(60);
    assert.ok(onRun(app), which + ': the run');
    const b = back1(app);
    assert.strictEqual(b.text, 'Production release', which);
    assert.ok(!/<a\b[^>]*class="[^"]*\brw-cl\b|data-act="open-process" data-id="release"/.test(rhead(app).replace(/<button\b[^>]*\bbackc\b[\s\S]*?<\/button>/, '')), which + ': no second link to the checklist');
    app.click(b.act, b.id); await app.settle();
    assert.strictEqual(app.hash(), from, which + ': back where it was');
  }
});

rule('R2 R-P2-3: a plan whose pinned version can\'t be used is titled Review the plan, has ‹ <origin> top left, and its Back goes to the checklist page', async () => {
  const app = await start();
  const d = await app.PF.repo.loadAll(app.fs), v1 = d.processes.find(p => p.process === 'release').index.all.find(p => p.info.version === 1);
  const plan = app.PF.plans.make(v1, { id: 'plan-release-exact', process: 'release', title: 'Release exact', details: {}, roles: {}, by: 'person-avery', created: new Date().toISOString() }, true, '2.0.0');
  await app.fs.write('proposals/plan-release-exact.json', JSON.stringify(plan, null, 2));
  app.files('publications/release/' + v1.info.folder + '/').forEach(f => { delete app.fs.files[f]; });
  app.click('refresh'); await app.tick(120);
  app.click('nav', 'home'); await app.tick();
  app.click('review-plan', 'plan-release-exact'); await app.tick();
  assert.match(app.html(), /won(&#39;|')t start on another version by itself/, 'set-up: the plan asks');
  assert.match(app.html(), /<h1 id="page-h" tabindex="-1">Review the plan<\/h1>/);
  assert.ok(!/<h1[^>]*>Start a run<\/h1>/.test(app.html()));
  const b = back1(app);
  assert.strictEqual(b.text, 'Home', 'the way back names where it came from');
  assert.ok(app.html().indexOf('class="backrow"') < app.html().indexOf('id="page-h"'), 'top left');
  const inline = buttons(app.html()).filter(x => x.text === 'Back to the checklist')[0];
  assert.ok(inline && inline.act !== 'home', 'the inline Back isn\'t Home: ' + JSON.stringify(inline));
  app.click(inline.act, inline.id); await app.settle();
  assert.ok(onOverview(app), 'the error state goes back to the checklist page: ' + app.hash());
});

rule('R2 R-P3-4: on a phone the workspace tools that don\'t fit go in More at the end of row 3', async () => {
  const app = await practiced();
  const h = head(app), more = /<div class="ws-more"[\s\S]*?<\/div><\/div>/.exec(h);
  assert.ok(more, 'a More group in the tools');
  const btn = buttons(more[0]).filter(x => x.text === 'More')[0];
  assert.ok(btn && btn.act === 'pr-more' && /aria-expanded="false"/.test(btn.attrs) && /aria-controls="ws-more-list"/.test(btn.attrs), 'More is a pr-* act that says whether it\'s open: ' + JSON.stringify(btn));
  assert.deepStrictEqual(buttons(more[0]).filter(x => x !== btn && x.text !== 'More').map(x => x.text), ['Start over', 'Sample details', 'Things to fix'].filter(t => t !== 'Sample details' || /pr-samples/.test(h)), 'the tools after Redo');
  app.click('pr-more'); await app.tick();
  assert.match(head(app), /data-act="pr-more"[^>]*aria-expanded="true"/, 'opens');
  app.click('pr-more'); await app.tick();
  assert.match(head(app), /data-act="pr-more"[^>]*aria-expanded="false"/, 'closes');
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'page.html'), 'utf8');
  assert.match(css, /\.ws-more-btn \{ display: none; \}/, 'More shows only on a phone');
  const ed = await edit(), em = /<div class="ws-more"[\s\S]*?<\/div><\/div>/.exec(head(ed));
  assert.ok(em, 'Edit: More too');
  assert.deepStrictEqual(buttons(em[0]).map(x => [x.text, x.act]), [['More', 'ws-more'], ['History', 'hist-open']], 'Edit: History is the one that doesn\'t fit');
});

rule('R2 R-P3-5: the README says Finish the run, not End run…', () => {
  const md = require('fs').readFileSync(require('path').join(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(!/End run…/.test(md), 'no End run…');
});

/* ---------- Build round 3: review round 2 ---------- */
rule('R3 1: Publish or Stage from Edit, the folder read held, then typing in the Markdown: focus stays in the Markdown when the read ends', async () => {
  for (const act of ['publish', 'stage-draft']) {
    const app = await changed({ domFocus: true }); await into(app, 'edit');
    const b = primary(app); app.click(b[0].act, b[0].id); await app.tick();
    const release = holdReads(app);
    app.set('change-note', 'Tell on-call first'); ovClick(app, act, 'release'); await app.tick(80);
    assert.strictEqual(app.overlay(), '', act + ': set-up, written and closed');
    app.node('#draft-editor').focus();
    app.set('draft-editor', app.draft('draft-editor') + '\nmore'); app.input('draft-editor', app.draft('draft-editor')); await app.tick();
    assert.strictEqual(app.activeId(), 'draft-editor', act + ': set-up, typing');
    release(); await app.tick(300);
    assert.strictEqual(app.activeId(), 'draft-editor', act + ': focus stays where the typing is');
    assert.match(app.html() + app.live(), act === 'publish' ? /Published v3\./ : /Staged\./, act + ': the result is still said');
  }
});
rule('R3 1: after a write, code moves focus only through wsFocusNow, which asks the ticket as it fires', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const body = name => { const i = src.indexOf(name); assert.ok(i >= 0, 'found ' + name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } return ''; };
  const now = body('function wsFocusNow(');
  assert.match(now, /t\.still\(\)/, 'it asks the ticket');
  assert.match(now, /render\(\)/, 'and draws at once');
  const after = {
    wsWritten: body('function wsWritten('),
    'stageDraft, after the write': body('function stageDraft(').split('}).then(function (res) {')[1] || '',
    'promote from the dialog': body("'promote-stage': function")
  };
  for (const [name, code] of Object.entries(after)) {
    assert.ok(code, name + ': found');
    assert.ok(!/state\.focus\s*=|\.focus\(|focus:\s/.test(code.replace(/wsFocusNow\([^;]*;/g, '')), name + ': no focus but wsFocusNow: ' + (code.match(/.{0,60}(state\.focus\s*=|\.focus\(|focus:\s).{0,40}/) || [''])[0]);
  }
});

rule('R3 2 (R6): after Edit anyway, the step type\'s way back and a Practice test form\'s way back go to the workspace in the entry\'s place, with its selection', async () => {
  const a = await twoWindows();
  a.click('ob-sel', 'flags'); await a.tick();
  await typeOpen(a);
  const i = a.index(), n = a.entries().length, b = back1(a);
  a.click(b.act, b.id); await a.settle();
  assert.deepStrictEqual([a.index(), a.entries().length], [i, n], 'in the entry\'s place');
  assert.ok(inEditor(a), 'the editor: ' + a.hash());
  assert.ok(!/Choose Edit anyway/.test(a.html() + a.live()), 'not refused');
  assert.match(a.html(), /data-act="ob-sel" data-id="flags" aria-pressed="true"/, 'at the step it came from');
  const files = {}, L = locks(), Channel = bus();
  const { app: p, folder } = await staged({ sharedFiles: files, locks: L, Channel });
  const o = await page({ sharedFiles: files, locks: L, Channel, me: 'person-avery' });
  o.click('ptab', 'edit'); await o.tick(); o.every(); await o.tick(40);
  p.click('refresh'); await p.tick(120);
  p.click('ptab', 'edit'); await p.tick(); p.click('pr-open'); await p.tick(60);
  assert.ok(onPage(p), 'set-up: practicing after Edit anyway');
  p.click('pr-start-test', folder); await p.tick();
  const j = p.index(), m = p.entries().length, left = p.hash(), bk = back1(p);
  p.click(bk.act, bk.id); await p.settle();
  assert.deepStrictEqual([p.index(), p.entries().length], [j, m], 'in the entry\'s place');
  assert.ok(onPage(p), 'practice: ' + p.hash());
  p.back(); await p.settle();
  assert.notStrictEqual(p.hash(), left, 'browser Back never reopens the test form');
});

rule('R3 3: More is a layer: browser Back or Escape closes it, focus on More, the URL kept, in Edit and in Practice', async () => {
  for (const view of ['edit', 'practice']) for (const how of ['back', 'escape']) {
    const app = view === 'edit' ? await edit({ domFocus: true }) : await practiced({ domFocus: true });
    const act = view === 'edit' ? 'ws-more' : 'pr-more', h = app.hash(), n = app.entries().length;
    app.click(act); await app.tick();
    assert.match(head(app), /aria-expanded="true" aria-controls="ws-more-list"/, view + ' ' + how + ': set-up, open');
    if (how === 'back') app.back(); else esc0(app);
    await app.settle();
    assert.strictEqual(app.hash(), h, view + ' ' + how + ': the URL kept');
    assert.strictEqual(app.entries().length, n, view + ' ' + how + ': no entry');
    assert.match(head(app), /id="ws-more-btn"[^>]*aria-expanded="false"/, view + ' ' + how + ': closed');
    assert.strictEqual(app.activeId(), 'ws-more-btn', view + ' ' + how + ': focus on More');
    assert.ok(view === 'edit' ? inEditor(app) : onPage(app), view + ' ' + how + ': still there');
  }
});

/* ---------- Build round 4: review round 3 ---------- */
/* A ‹ control's browser Back held (a slow browser) while a folder refresh finishes and redraws: no entry is written in
   between, and Back lands where the control goes. */

rule('R4 2: a typed Publish note, its caret too, survives the dialog being rebuilt by a background refresh, in Edit and in Practice', async () => {
  for (const view of ['edit', 'practice']) {
    const files = {}, L = locks(), Channel = bus();
    const a = await changed({ sharedFiles: files, locks: L, Channel, replace: true }); await into(a, view);
    const b = primary(a); a.click(b[0].act, b[0].id); await a.tick();
    assert.match(a.overlay(), /Publish v3/, view + ': set-up, the dialog');
    a.set('change-note', 'Tell on-call first'); a.input('change-note', 'Tell on-call first'); a.focusBox('change-note', 5, 12); await a.tick();
    const o = await page({ sharedFiles: files, locks: L, Channel, me: 'person-avery' });
    o.set('change-note', 'From the other window'); o.click('publish', 'release'); await o.tick(300);
    a.every(); await a.tick(200);
    assert.match(a.overlay(), /Publish v4/, view + ': the dialog was rebuilt by the refresh');
    assert.strictEqual(a.draft('change-note'), 'Tell on-call first', view + ': the note kept');
    assert.deepStrictEqual(a.caret('change-note'), [5, 12], view + ': the caret kept');
  }
});
rule('R4 2: every dialog is drawn in one place, which puts typed text back, and every box in a dialog writes what it holds as it\'s typed', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  assert.strictEqual((src.match(/overlayEl\.innerHTML\s*=/g) || []).length, 1, 'one place draws a dialog');
  assert.match(src, /overlayEl\.innerHTML = ov; lastOverlay = ov;\s*ovRestore\(/, 'and it puts typed text back');
  assert.match(src, /document\.addEventListener\('input', function \(e\) \{[\s\S]{0,300}ovKeep\(e\.target\)/, 'every input in a dialog is kept as typed');
});

rule('R4 3: browser Back while the Publish dialog writes leaves it as it is: focus on the busy button, no finish-or-cancel', async () => {
  const app = await changed({ domFocus: true }); await into(app, 'edit');
  const b = primary(app); app.click(b[0].act, b[0].id); await app.tick();
  const release = holdWrites(app);
  app.set('change-note', 'Tell on-call first'); ovClick(app, 'stage-draft', 'release'); await app.tick(20);
  app.node('[data-act="stage-draft"]').focus();
  const at = app.activeId(), h = app.hash();
  app.back(); await app.settle();
  assert.ok(/id="change-note"/.test(app.overlay()), 'still open');
  assert.strictEqual(app.activeId(), at, 'focus stays on the busy button');
  assert.ok(!/Finish or cancel this first/.test(app.html() + app.live()), 'nothing to finish or cancel');
  assert.strictEqual(app.hash(), h, 'the URL kept');
  release(); await app.tick(300);
});

const wait = ms => new Promise(res => setTimeout(res, ms));


/* ---------- Build round 5: a step type opened from Edit returns there, saved or not ---------- */
async function edType(o) {
  const a = await edit(Object.assign({ localStore: { 'preflight:builder': 'true' } }, o));
  a.click('ob-sel', 'flags'); await a.tick(); await typeOpen(a);
  a.input('tf-label', 'Risk review'); await a.tick(40);
  const b = back1(a); assert.match(b.text, /Production release/, 'set-up: the way back names the checklist: ' + b.text);
  a.click(b.act, b.id); await a.tick();
  assert.match(a.html(), /data-act="type-cancel">Leave without saving/, 'set-up: the leave prompt');
  return a;
}
rule('R5 3: a changed step type opened from Edit: Leave without saving returns to Edit at its step, the form closed', async () => {
  const a = await edType(); const n = a.entries().length;
  a.click('type-cancel'); await a.settle(); await a.tick(60); await a.settle();
  assert.strictEqual(a.hash(), '#/process/release/edit', 'back to Edit: ' + a.hash());
  assert.ok(inEditor(a), 'the editor');
  assert.match(a.html(), /data-act="ob-sel" data-id="flags" aria-pressed="true"/, 'at its step');
  assert.ok(a.entries().length <= n, 'history didn\'t grow');
  a.click('nav', 'settings'); await a.tick(); a.click('open-types'); await a.tick();
  assert.ok(!/Risk review/.test(a.html()), 'the changes were let go of');
});
rule('R5 3: a changed step type opened from Edit: Save step type from the prompt saves it and returns to Edit at its step', async () => {
  const a = await edType();
  a.click('type-save'); await a.tick(200); await a.settle(); await a.tick(60);
  assert.strictEqual(a.hash(), '#/process/release/edit', 'back to Edit: ' + a.hash());
  assert.match(a.html(), /data-act="ob-sel" data-id="flags" aria-pressed="true"/, 'at its step');
  assert.ok(Object.keys(a.fs.files).some(f => /^step-types\//.test(f) && /Risk review/.test(a.fs.files[f].t)), 'saved');
});

/* ---------- Build round 5: one way back on an unavailable pinned plan ---------- */
rule('R5 4: a plan whose pinned version can\'t be used, opened from the checklist page, has only the header\'s way back to it', async () => {
  const app = await start();
  const d = await app.PF.repo.loadAll(app.fs), v1 = d.processes.find(p => p.process === 'release').index.all.find(p => p.info.version === 1);
  const plan = app.PF.plans.make(v1, { id: 'plan-release-exact', process: 'release', title: 'Release exact', details: {}, roles: {}, by: 'person-avery', created: new Date().toISOString() }, true, '2.0.0');
  await app.fs.write('proposals/plan-release-exact.json', JSON.stringify(plan, null, 2));
  app.files('publications/release/' + v1.info.folder + '/').forEach(f => { delete app.fs.files[f]; });
  app.click('refresh'); await app.tick(120);
  app.click('nav', 'home'); await app.tick(); app.click('review-plan', 'plan-release-exact'); await app.tick();
  const h = app.hash();
  app.click('open-process', 'release'); await app.tick();
  app.typeHash(h); await app.settle(); await app.tick(40);
  assert.match(app.html(), /won(&#39;|')t start on another version by itself/, 'set-up: the plan asks');
  const b = back1(app);
  assert.strictEqual(b.text, 'Production release', 'the header goes to the checklist page');
  assert.ok(!buttons(app.html()).some(x => x.text === 'Back to the checklist'), 'no second way there');
});

/* ---------- Build round 6: a ‹ control never traverses history ---------- */
rule('R6 1: no ‹ control calls browser Back or waits for one: nothing in app.js traverses history but the refused move\'s restore', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  assert.ok(!/HIST\.back\(/.test(src), 'no history.back()');
  assert.strictEqual((src.match(/HIST\.go\(/g) || []).length, 1, 'one history.go(), the restore\'s');
  assert.match(src, /function restoreUrl\(t\) \{[\s\S]{0,400}HIST\.go\(c\.n - H\.pos\)/, 'and it is restoreUrl\'s');
  assert.ok(!/H\.backing|navWait|drawnControl|typeBack|wsAnyway/.test(src), 'no pending Back, slot or replay left');
  /* Every ‹ handler moves through backInPlace (its guard, then the entry replaced). */
  ['wsLeave', 'typeWsReturn'].forEach(f => assert.match(src, new RegExp('function ' + f + '\\([^)]*\\) \\{[\\s\\S]{0,400}backInPlace\\(\\)'), f));
  ["'recovery-back'", "'ins-back'", "'go-back'", "'exit-mission'"].forEach(a => assert.match(src, new RegExp(a + ': function \\([^)]*\\) \\{[\\s\\S]{0,300}backInPlace\\(\\)'), a));
});
rule('R6 1: a ‹ control draws where it goes at once, and a refresh finishing right after writes no entry: the step type\'s return, ‹ Step types, ‹ <title>', async () => {
  const cases = [
    ['step type from Edit', async () => { const a = await edit({ localStore: { 'preflight:builder': 'true' } }); a.click('ob-sel', 'flags'); await a.tick(); await typeOpen(a); return a; }, '#/process/release/edit'],
    ['‹ Step types', async () => { const t = await start(); t.click('nav', 'settings'); await t.tick(); t.click('open-types'); await t.tick(); await typeOpen(t); return t; }, '#/types'],
    ['‹ <title>', async () => edit(), '#/process/release']
  ];
  for (const [name, go, want] of cases) {
    const app = await go(); const n = app.entries().length, i = app.index(), left = app.hash(), before = app.html(), b = back1(app);
    app.click(b.act, b.id);
    assert.notStrictEqual(app.html(), before, name + ': drawn at once');
    app.click('refresh'); await app.tick(150); await app.settle();
    assert.strictEqual(app.hash(), want, name + ': landed');
    assert.deepStrictEqual([app.entries().length, app.index()], [n, i], name + ': in the entry\'s place, nothing written by the refresh');
    app.back(); await app.settle();
    assert.notStrictEqual(app.hash(), left, name + ': browser Back never reopens ' + left);
  }
});
rule('R6 1: a move right after a ‹ control is just the next move: Runs lands, history doesn\'t grow past it, and nothing later overrides it', async () => {
  const app = await edit(); const n = app.entries().length, i = app.index();
  app.click('ed-done'); await app.tick(); app.click('nav', 'runs'); await app.settle(); await app.tick(40);
  assert.strictEqual(app.hash(), '#/runs');
  assert.deepStrictEqual([app.entries().length, app.index()], [n + 1, i + 1], 'the checklist page in the editor\'s place, Runs after it');
  assert.strictEqual(app.entries()[i].hash, '#/process/release');
  /* Both in one task: one write, Runs in the editor's place. */
  const same = await edit(); const m = same.entries().length, j = same.index();
  same.click('ed-done'); same.click('nav', 'runs'); await same.settle();
  assert.strictEqual(same.hash(), '#/runs'); assert.deepStrictEqual([same.entries().length, same.index()], [m, j]);
  await new Promise(r => setTimeout(r, 1700)); await app.settle();
  assert.strictEqual(app.hash(), '#/runs', 'nothing later overrides it');
});

/* ---------- Build round 6: Leave without saving and Keep editing act on the form as it is at the click ---------- */
async function typePrompt() {
  const t = await start(); t.click('nav', 'settings'); await t.tick(); t.click('open-types'); await t.tick(); await typeOpen(t);
  t.input('tf-label', 'Risk review'); await t.tick(40);
  const b = back1(t); t.click(b.act, b.id); await t.tick();
  assert.match(t.html(), /data-act="type-cancel">Leave without saving/, 'set-up: the leave prompt');
  return t;
}
rule('R6 3: Keep editing with nothing typed after it keeps the form: the next way back asks again, and so does browser Back', async () => {
  const t = await typePrompt(); const n = t.entries().length;
  t.click('type-stay'); await t.settle();
  assert.ok(/id="tf-h"/.test(t.html()) && !/Leave without saving/.test(t.html()), 'the form, the prompt gone');
  assert.match(t.html(), /<input id="tf-label"[^>]*value="Risk review"/, 'its text kept');
  assert.strictEqual(t.hash(), '#/types/new'); assert.strictEqual(t.entries().length, n);
  const b = back1(t); t.click(b.act, b.id); await t.settle();
  assert.match(t.html(), /Leave without saving/, 'the way back asks again');
  t.click('type-stay'); await t.settle();
  t.back(); await t.settle(); await t.tick(40);
  assert.match(t.html(), /Leave without saving/, 'browser Back asks too');
  assert.match(t.html(), /<input id="tf-label"[^>]*value="Risk review"/, 'nothing discarded');
});
rule('R6 3: Leave without saving pressed twice closes the form once, on the list, in the entry\'s place; from Edit, back in Edit', async () => {
  const t = await typePrompt(); const n = t.entries().length, i = t.index();
  t.click('type-cancel'); t.click('type-cancel'); await t.settle(); await t.tick(40);
  assert.strictEqual(t.hash(), '#/types'); assert.ok(!/id="tf-h"/.test(t.html()), 'closed');
  assert.deepStrictEqual([t.entries().length, t.index()], [n, i], 'in the entry\'s place');
  t.click('nav', 'home'); await t.tick(); t.click('nav', 'settings'); await t.tick(); t.click('open-types'); await t.tick();
  assert.ok(!/Risk review/.test(t.html()), 'its changes let go of');
  const a = await edit({ localStore: { 'preflight:builder': 'true' } });
  a.click('ob-sel', 'flags'); await a.tick(); await typeOpen(a);
  a.input('tf-label', 'Risk review'); await a.tick(40);
  const b = back1(a); a.click(b.act, b.id); await a.tick();
  const m = a.entries().length;
  a.click('type-cancel'); a.click('type-cancel'); await a.settle(); await a.tick(40);
  assert.strictEqual(a.hash(), '#/process/release/edit'); assert.ok(inEditor(a), 'the editor');
  assert.strictEqual(a.entries().length, m, 'history didn\'t grow');
});

/* ---------- Build round 6: a skill's header way back ---------- */
rule('R6 4: a skill opened from its checklist goes back to Skills from the header, its checklist linked once in the body; from Skills, Skills', async () => {
  const app = await page();
  const m = /data-act="open-skill" data-id="([^"]+)"/.exec(app.html());
  assert.ok(m, 'set-up: the checklist page links a skill');
  app.click('open-skill', m[1]); await app.tick();
  let b = back1(app);
  assert.strictEqual(b.text, 'Skills', 'from its checklist: the header goes to Skills');
  const toList = buttons(app.html()).filter(x => (x.act === 'go-back' || x.act === 'open-process') && (x.id === '#/process/release' || x.id === 'release'));
  assert.deepStrictEqual(toList.map(x => x.act), ['open-process'], 'the checklist once, in About this skill');
  const s = await start(); s.click('nav', 'processes'); await s.tick(); s.click('nav', 'skills'); await s.tick(); s.click('open-skill', m[1]); await s.tick();
  b = back1(s);
  assert.strictEqual(b.text, 'Skills', 'from Skills: Skills');
});

/* ---------- Build round 6: the reviewers' probes ---------- */
rule('R6 6: from a linked child run, ‹ draws its parent at once and nothing of the child changes; the URL is the parent\'s', async () => {
  const app = await start(); await fromRuns(app);
  const key = runKey(app);
  const kid = Object.keys(app.fs.files).filter(f => /^runs\/[^/]+\/[^/]+\/run\.json$/.test(f)).find(f => { try { const j = JSON.parse(app.fs.files[f].t); return j.parent && j.parent.process + '/' + j.parent.id === key; } catch (e) { return false; } });
  assert.ok(kid, 'set-up: the example\'s run has a linked child run');
  const ckey = kid.split('/').slice(1, 3).join('/');
  app.click('open-run', ckey); await app.tick(60); await app.settle();
  assert.strictEqual(app.hash(), '#/run/' + ckey, 'set-up: the child open');
  const cpath = kid, was = app.fs.files[cpath].t, b = back1(app), before = app.html();
  app.click(b.act, b.id);
  assert.notStrictEqual(app.html(), before, 'the parent drawn at once');
  const step = Object.keys(JSON.parse(was).steps || {})[0];
  if (step) app.click('toggle', step);
  await app.settle(); await app.tick(80);
  assert.strictEqual(app.fs.files[cpath].t, was, 'the child run is untouched');
  assert.strictEqual(app.hash(), '#/run/' + key, 'the parent\'s URL: ' + app.hash());
});
rule('R6 6: a pruned or single-entry history whose b names a checklist page: ‹ moves there, and the next moves go on', async () => {
  const fp = (await start()).entries()[0].state.f;
  for (const n of [0, 5]) {
    const app = await start({ entries: [{ hash: '#/process/release/edit', state: { fd: 1, n, f: fp, b: { h: '#/process/release', f: fp } } }] }); await app.tick(80); await app.settle();
    assert.ok(inEditor(app), n + ': set-up: the editor');
    app.click('ed-done'); await app.settle();
    assert.strictEqual(app.hash(), '#/process/release', n + ': moved there');
    assert.ok(onOverview(app), n + ': drawn');
    app.click('nav', 'settings'); await app.settle();
    assert.strictEqual(app.hash(), '#/settings', n + ': and on');
    assert.deepStrictEqual(app.entries().map(e => e.hash), ['#/process/release', '#/settings'], n + ': one entry replaced, one pushed');
  }
});
rule('R6 6: refused Backs pressed together, with entries ahead, settle on the editor and its URL', async () => {
  const app = await edit({ localStore: { 'preflight:builder': 'true' } });
  app.click('nav', 'runs'); await app.settle(); app.click('nav', 'settings'); await app.settle(); app.click('nav', 'skills'); await app.settle();
  app.back(); await app.settle(); app.back(); await app.settle(); app.back(); await app.settle();
  assert.strictEqual(app.hash(), '#/process/release/edit', 'set-up: back on Edit, entries ahead');
  app.click('ob-sel', 'flags'); await app.tick(); app.input('ob-text', 'Half typed'); await app.tick();
  const at = app.index(), n = app.entries().length;
  app.holdPops(); app.back(); app.back(); app.releasePops();
  await app.settle(); await new Promise(r => setTimeout(r, 1300)); await app.settle(); await app.tick(40);
  assert.strictEqual(app.hash(), '#/process/release/edit', 'the URL is the editor\'s');
  assert.ok(/id="ed-h"/.test(app.html()) && app.draft('ob-text') === 'Half typed', 'the editor, its text kept');
  assert.deepStrictEqual([app.index(), app.entries().length], [at, n], 'on its entry, the entries ahead kept');
  assert.strictEqual(app.reloads(), 0); assert.strictEqual(app.popMismatch(), 0);
  const settled = app.entries().length; await new Promise(r => setTimeout(r, 300)); await app.settle();
  assert.strictEqual(app.hash(), '#/process/release/edit', 'and it stays settled'); assert.strictEqual(app.entries().length, settled);
});

/* ---------- Build round 7: a ‹ during a refused move's restore, and the destination's own origin ---------- */
/* Browser Back that a layer or a guard refuses: the pop is handled, and the restore's own traversal is held. */
async function refusedBack(app, done) {
  app.back();
  for (let i = 0; i < 200 && !done(); i++) await new Promise(r => setTimeout(r, 0));
  app.holdPops();
  assert.ok(done(), 'set-up: the refused Back was handled');
}
rule('R7 1: ‹ while a refused Back\'s restore is on its way writes the destination in the entry\'s place: history doesn\'t grow, Back never reopens Edit', async () => {
  for (const how of ['help', 'unapplied text']) {
    const app = await edit({ localStore: { 'preflight:builder': 'true' } }); await app.settle();
    const n = app.entries().length, i = app.index();
    if (how === 'help') { app.key('?'); await app.tick(); assert.ok(app.overlay(), 'set-up: Help open'); await refusedBack(app, () => !app.overlay()); }
    else {
      app.click('ob-sel', 'flags'); await app.tick(); app.input('ob-text', 'Half typed'); await app.tick();
      await refusedBack(app, () => /Apply or clear what you typed/.test(app.live()));
      app.click('ob-hold-discard'); await app.tick();
    }
    app.click('ed-done'); await app.tick();
    assert.ok(onOverview(app), how + ': the checklist page drawn at once');
    app.releasePops(); await app.settle(); await app.tick(40); await app.settle();
    assert.strictEqual(app.hash(), '#/process/release', how + ': its URL');
    assert.deepStrictEqual([app.entries().length, app.index()], [n, i], how + ': in the editor entry\'s place (' + JSON.stringify(app.entries().map(e => e.hash)) + ')');
    assert.ok(!app.entries().some(e => e.hash === '#/process/release/edit'), how + ': no editor entry left');
    app.back(); await app.settle();
    assert.ok(!inEditor(app), how + ': browser Back never reopens Edit');
  }
});
rule('R7 2: back to a run from its own pages, the run\'s way back still names where the run was opened from, after a refresh too', async () => {
  const pages = {
    'Screen share': async a => { a.click('mission'); await a.tick(40); },
    'Receipt': async a => { a.click('receipt'); await a.tick(40); },
    'Finish': async a => { a.click('pickup'); await a.tick(40); a.click('finish'); await a.tick(40); },
    'Folder health': async a => { a.click('health'); await a.tick(80); },
    'Recovery': async a => { a.click('recovery', 'onedrive-isnt-syncing'); await a.tick(); }
  };
  const froms = {
    Home: [async a => { a.click('nav', 'home'); await a.tick(); a.click('open-run', runKey(a)); await a.tick(60); }, '#/'],
    'Production release': [async a => { a.click('open-process', 'release'); await a.tick(); a.click('open-run', runKey(a)); await a.tick(60); }, '#/process/release']
  };
  const bad = [];
  for (const [from, [open, want]] of Object.entries(froms)) for (const [name, go] of Object.entries(pages)) {
    const app = await start(); await open(app); await app.settle();
    const was = back1(app);
    if (was.text !== from) { bad.push(from + ' › ' + name + ': set-up: the run says ‹ ' + was.text); continue; }
    await go(app); await app.settle();
    const b = backs(app.html())[0];
    if (!b) { bad.push(from + ' › ' + name + ': no way back'); continue; }
    app.click(b.act, b.id); await app.settle();
    if (!/^#\/run\//.test(app.hash())) { bad.push(from + ' › ' + name + ': ‹ went to ' + app.hash()); continue; }
    let now = backs(app.html())[0];
    if (!now || now.text !== from) { bad.push(from + ' › ' + name + ': the run now says ‹ ' + (now && now.text)); continue; }
    app.click('refresh'); await app.tick(120); await app.settle();
    now = backs(app.html())[0];
    if (!now || now.text !== from) { bad.push(from + ' › ' + name + ': after a refresh ‹ ' + (now && now.text)); continue; }
    app.click(now.act, now.id); await app.settle();
    if (app.hash() !== want) bad.push(from + ' › ' + name + ': ‹ ' + from + ' went to ' + app.hash());
  }
  assert.deepStrictEqual(bad, []);
});
rule('R7 2: Settings › Step types › New step type › ‹ Step types: the list still goes back to Settings', async () => {
  const t = await start(); t.click('nav', 'settings'); await t.tick(); t.click('open-types'); await t.tick();
  assert.strictEqual(back1(t).text, 'Settings', 'set-up');
  await typeOpen(t);
  const b = back1(t); t.click(b.act, b.id); await t.settle();
  assert.strictEqual(t.hash(), '#/types');
  const now = back1(t);
  assert.strictEqual(now.text, 'Settings', 'the list\'s way back');
  t.click(now.act, now.id); await t.settle();
  assert.strictEqual(t.hash(), '#/settings');
});

/* ---------- Build round 8: a stale restore never draws; one place makes a write a replace ---------- */
/* Help open in Edit, browser Back closes it, the restore's own traversal held, ‹ checklist drawn. */
async function restoreHeld() {
  const app = await edit({ localStore: { 'preflight:builder': 'true' } }); await app.settle();
  const n = app.entries().length, i = app.index();
  app.key('?'); await app.tick(); assert.ok(app.overlay(), 'set-up: Help open');
  await refusedBack(app, () => !app.overlay());
  app.click('ed-done'); await app.tick();
  assert.ok(onOverview(app), 'set-up: ‹ checklist drawn');
  return { app, n, i };
}
const noEdit = (app, what) => { assert.ok(!inEditor(app), what + ': not the editor'); assert.ok(!app.entries().some(e => e.hash === '#/process/release/edit'), what + ': no editor entry (' + JSON.stringify(app.entries().map(e => e.hash)) + ')'); };
rule('R8 1: the restore\'s traversal released after 1,150 ms: the checklist stays, its URL, no editor entry', async () => {
  const { app, n } = await restoreHeld();
  await new Promise(r => setTimeout(r, 1150));
  assert.ok(onOverview(app), 'still the checklist when the watchdog runs');
  app.releasePops(); await app.settle(); await app.tick(40); await app.settle();
  assert.ok(onOverview(app), 'the checklist'); assert.strictEqual(app.hash(), '#/process/release');
  assert.strictEqual(app.entries().length, n, 'history didn\'t grow');
  noEdit(app, 'late');
  app.back(); await app.settle(); assert.ok(!inEditor(app), 'browser Back never reopens Edit');
});
rule('R8 1: the restore\'s traversal never released: the checklist stays and its URL is written, and the next moves go on', async () => {
  const { app, n } = await restoreHeld();
  await new Promise(r => setTimeout(r, 1200)); await app.tick(20);
  assert.ok(onOverview(app), 'the checklist'); assert.strictEqual(app.hash(), '#/process/release');
  assert.ok(app.entries().length <= n, 'history didn\'t grow');
  app.click('nav', 'settings'); await app.tick(20);
  assert.strictEqual(app.hash(), '#/settings', 'the next move goes on');
  assert.ok(/Settings/.test(app.html()));
});
rule('R8 1: navigating on to Runs before the late restore: Runs stays through the watchdog and the late arrival', async () => {
  const { app, n } = await restoreHeld();
  app.click('nav', 'runs'); await app.tick();
  await new Promise(r => setTimeout(r, 1150));
  assert.ok(/<div class="eyebrow">Runs|id="rf-h"|Runs<\/h1>/.test(app.html()) || app.hash() === '#/runs', 'Runs through the watchdog: ' + app.hash());
  assert.strictEqual(app.hash(), '#/runs', 'the watchdog didn\'t replace Runs');
  app.releasePops(); await app.settle(); await app.tick(40); await app.settle();
  assert.strictEqual(app.hash(), '#/runs', 'Runs after the late arrival');
  assert.ok(app.entries().length <= n + 1, 'history grew by Runs at most');
  noEdit(app, 'Runs');
});
rule('R8 1: two refused Backs, one after the other, each restore lands: the editor, its URL and its entry', async () => {
  const app = await edit({ localStore: { 'preflight:builder': 'true' } }); await app.settle();
  app.click('ob-sel', 'flags'); await app.tick(); app.input('ob-text', 'Half typed'); await app.tick();
  const n = app.entries().length, i = app.index();
  for (const k of [1, 2]) {
    app.back(); await app.settle(); await app.tick(40); await app.settle();
    assert.strictEqual(app.hash(), '#/process/release/edit', k + ': the URL'); assert.ok(/id="ed-h"/.test(app.html()) && app.draft('ob-text') === 'Half typed', k + ': the editor, its text');
    assert.deepStrictEqual([app.index(), app.entries().length], [i, n], k + ': its entry');
  }
  await new Promise(r => setTimeout(r, 1200)); await app.settle();
  assert.strictEqual(app.hash(), '#/process/release/edit', 'still, after the watchdog would have run');
});
rule('R8 2: only backMode makes a write a replace', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const sets = [...src.matchAll(/H\.mode\s*=(?!=)\s*([^;]+);/g)].map(m => m[1].trim());
  assert.deepStrictEqual(sets.filter(v => v !== 'null'), ["'replace'", "'replace'", "'replace'"], 'three writes of replace: ' + JSON.stringify(sets));
  const fn = name => { const at = src.indexOf('function ' + name + '('); assert.ok(at > 0, name); return src.slice(at, src.indexOf('\n  }\n', at)); };
  assert.strictEqual((fn('backMode').match(/H\.mode = 'replace'/g) || []).length, 2, 'two inside backMode');
  /* Opening a folder is the one other: useFs's body is frozen by the release gate, and that line is backMode(true) written out. */
  assert.strictEqual((fn('useFs').match(/H\.mode = 'replace'/g) || []).length, 1, 'and the folder open in useFs');
});
rule('R8 2: the step type\'s prompt from browser Back, Leave without saving or Save: Step types still goes back to Settings', async () => {
  for (const choice of ['type-cancel', 'type-save']) {
    const t = await start(); t.click('nav', 'settings'); await t.tick(); t.click('open-types'); await t.tick(); await typeOpen(t);
    t.input('tf-label', 'Risk review ' + choice); await t.tick(40);
    t.back(); await t.settle(); await t.tick(40); await t.settle();
    assert.match(t.html(), /Leave without saving/, choice + ': set-up: the prompt Back brought');
    t.click(choice); await t.tick(200); await t.settle(); await t.tick(40);
    assert.strictEqual(t.hash(), '#/types', choice + ': the list');
    const b = back1(t);
    assert.strictEqual(b.text, 'Settings', choice + ': the list\'s way back names Settings');
    t.click(b.act, b.id); await t.settle();
    assert.strictEqual(t.hash(), '#/settings', choice + ': and opens it');
  }
});
rule('R8 3: Home names the version publishing takes: past an incomplete higher-numbered folder, and the page it opens agrees', async () => {
  const app = await changed();
  await app.fs.write('publications/release/v3-zzzz9999/map.md', '# still syncing\n');
  app.click('refresh'); await app.tick(80);
  app.click('nav', 'home'); await app.tick();
  const b = buttons(app.html()).filter(x => x.act === 'home-publish')[0];
  assert.ok(b, 'set-up: Home offers to publish');
  assert.strictEqual(b.text, 'Publish v4…', 'the label');
  assert.match(app.html(), /Publish it as v4 when it(&#39;|')s ready\./, 'the text');
  app.click(b.act, b.id); await app.tick(40); await app.settle();
  assert.match(app.html(), /Publish v4/, 'the page it opens publishes the same number');
  assert.doesNotMatch(app.html(), /Publish v3/, 'and never offers the taken one');
});

run();
