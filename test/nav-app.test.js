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

run();
