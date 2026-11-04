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

run();
