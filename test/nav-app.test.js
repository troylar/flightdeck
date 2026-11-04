// 2.16 in the built app: one way to move around (docs/design.md section 29). The checklist page's view strip, the
// workspace's shared header (Edit | Practice and its one primary), the way back named for where it goes, Back and Escape.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot, bus, locks } = require('./app-harness');

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
    assert.ok(new RegExp('<h1 id="(ed-h|run-h)" class="sr" tabindex="-1">Production release, ' + (view === 'edit' ? 'Edit' : 'Practice') + '</h1>').test(h), view + ': the h1 is visually hidden and names the view');
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

rule('Workspace: ‹ <title> is one browser Back when the checklist page opened it, from Edit and from Practice; from a typed link it moves there', async () => {
  for (const pr of [false, true]) {
    const app = await edit({ domFocus: true });
    if (pr) { app.click('pr-open'); await app.tick(60); }
    const n = app.entries().length, i = app.index(), b = backs(head(app))[0];
    app.click(b.act, b.id); await app.settle();
    assert.ok(onOverview(app), pr + ': the checklist page');
    assert.deepStrictEqual([app.entries().length, app.index()], [n, i - 1], pr + ': by browser Back, not a new entry');
    assert.strictEqual(app.focused(), pr ? '[data-act="pv-practice"]' : '[data-act="ptab"][data-id="edit"]', pr + ': focus on the view left');
    app.forward(); await app.settle();
    assert.ok(pr ? onPage(app) : inEditor(app), pr + ': Forward returns to the view');
  }
  const typed = await start({ hash: '#/process/release/edit' }); await typed.tick(80);
  const n = typed.entries().length, i = typed.index();
  typed.click('ed-done'); await typed.settle();
  assert.ok(onOverview(typed), 'typed: the checklist page');
  assert.deepStrictEqual([typed.entries().length, typed.index()], [n + 1, i + 1], 'typed: moved there');
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
  assert.deepStrictEqual(JSON.parse(JSON.stringify(app.PF.nav.entry(last).b)), { h: '#/process/release', f: last.b.f }, 'b is the checklist page');
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
  assert.deepStrictEqual([b.text, b.act, b.id], ['Production release', 'open-process', 'release'], JSON.stringify(b));
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
  app.click('nav', 'settings'); await app.tick(); app.click('nav', 'types'); await app.tick(); app.click('new-type'); await app.tick();
  assert.strictEqual(back1(app).text, 'Step types');
  const ws = await start({ localStore: { 'preflight:builder': 'true' } });
  ws.click('open-process', 'release'); await ws.tick(); ws.click('ptab', 'edit'); await ws.tick();
  ws.click('ob-sel', 'flags'); await ws.tick();
  const n = ws.entries().length;
  ws.click('new-type'); await ws.tick();
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
    assert.deepStrictEqual([app.index(), app.entries().length], [i - 1, n], v + ': Escape is browser Back to Settings');
    app.forward(); await app.settle();
    const c = back1(app); app.click(c.act, c.id); await app.settle();
    assert.deepStrictEqual([app.hash(), app.index(), app.entries().length], ['#/settings', i - 1, n], v + ': ‹ Settings is browser Back');
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
  a.click('new-type'); await a.tick();
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

run();
