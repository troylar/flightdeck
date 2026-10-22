// Staging in the app (2.1 slice 4): reached only from inside the process page's closed All versions disclosure. Stage the
// draft, retire and reopen it, make it the default; the status on screen is always worked out from the saved files. Anyone may
// do these, and each is logged with their name. Nobody who never stages sees a staging word.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

/* Visible text only: closed <details> bodies (not their summary), hidden and screen-reader-only text left out. */
function visible(html) {
  const out = [], stack = [], re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|([^<]+)/g, VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;
  let hidden = 0, m;
  const pop = () => { const t = stack.pop(); if (t.hide) hidden--; if (t.summaryOf && !t.summaryOf.hide) { t.summaryOf.hide = true; hidden++; } return t; };
  while ((m = re.exec(html))) {
    if (m[5] != null) { if (!hidden) out.push(m[5]); continue; }
    const tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (m[1]) { if (stack.some(t => t.tag === tag)) while (stack.length && pop().tag !== tag); continue; }
    const cls = (/\sclass="([^"]*)"/.exec(attrs) || [])[1] || '';
    const hide = /\shidden(?=[\s=]|$)/.test(attrs) || /\saria-hidden="true"/.test(attrs) || /(^|\s)sr(\s|$)/.test(cls) || /^(script|style|template)$/.test(tag);
    if (!hidden && !hide) out.push('<' + tag + attrs + '>');
    if (VOID.test(tag) || m[4]) continue;
    const t = { tag, hide };
    if (hide) hidden++;
    const up = stack[stack.length - 1];
    if (tag === 'summary' && up && up.closed) t.summaryOf = up;
    if (tag === 'details' && !/\sopen(?=[\s=]|$)/.test(attrs)) t.closed = true;
    stack.push(t);
  }
  return out.join('');
}
const words = (html) => visible(html).replace(/<[^>]*>/g, ' ');

async function withDraftChange(who) {
  const app = boot(); await app.tick(60);
  app.choose(who); await app.tick();
  const path = 'maps/drafts/release.md', md = app.fs.files[path].t;
  const changed = md.replace(/\n(## [^\n]*\n)/, '\n$1- [ ] {confirm} Tell the on-call channel {#tell-oncall}\n');
  assert.ok(changed !== md, 'set-up: a change');
  await app.fs.write(path, changed);
  app.click('refresh'); await app.tick(80);
  app.click('nav', 'processes'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  return app;
}
const stageFiles = (app) => app.files('staged/release/').filter(f => /publication\.json$/.test(f));

rule('Nobody who never stages sees a staging word: the entry is inside the closed All versions disclosure', async () => {
  const app = await withDraftChange('person-casey'), html = app.html();
  assert.ok(/data-act="stage-draft" data-id="release"/.test(html), 'the entry is there');
  assert.ok(!/stag/i.test(words(html)), 'but not on screen: ' + (words(html).match(/[^.]*stag[^.]*/i) || [''])[0]);
  const plain = boot(); await plain.tick(60); plain.choose('person-morgan'); await plain.tick(); plain.click('open-process', 'release'); await plain.tick();
  assert.ok(!/stag/i.test(plain.html()), 'without a changed draft or a stage, nothing about staging is drawn at all');
  assert.ok(!plain.files('').some(f => /^staged\//.test(f)), 'and nothing is written');
});

rule('Stage the draft, retire it, reopen it and make it the default: files only, status from them, and logged with names', async () => {
  const app = await withDraftChange('person-casey');
  app.click('stage-draft', 'release'); await app.tick(100);
  assert.ok(!stageFiles(app).length, 'no change note: nothing staged');
  app.set('change-note', 'Tell on-call first'); app.click('stage-draft', 'release'); await app.tick(200);
  const sf = stageFiles(app);
  assert.strictEqual(sf.length, 1, 'staged once');
  const info = JSON.parse(app.fs.files[sf[0]].t), folder = info.folder;
  assert.ok(info.features.indexOf('staged') >= 0 && info.stagedBy === 'person-casey' && info.stage.proposed === 3, JSON.stringify(info));
  let html = app.html();
  assert.ok(/<details data-disc="vers:release" open>/.test(html), 'the disclosure stays open after staging');
  assert.ok(new RegExp('data-act="promote-stage" data-id="' + folder + '"[^>]*>Make v3 the default<').test(html), 'Make v3 the default');
  assert.ok(/data-act="start" data-id="release"/.test(html) && /v2 · published/.test(html), 'v2 stays the default');

  app.choose('person-morgan'); await app.tick(); app.click('open-process', 'release'); await app.tick();
  app.click('retire-stage', folder); await app.tick(200);
  const dec = app.files('staged/release/decisions/');
  assert.strictEqual(dec.length, 1);
  const d1 = JSON.parse(app.fs.files[dec[0]].t);
  assert.ok(d1.status === 'retired' && d1.by === 'person-morgan' && d1.rev === 1 && d1.seen === null, JSON.stringify(d1));
  html = app.html();
  assert.ok(new RegExp('data-act="reopen-stage" data-id="' + folder + '"').test(html) && !/data-act="promote-stage"/.test(html), 'a retired stage offers Reopen, never Make the default');

  app.click('reopen-stage', folder); await app.tick(200);
  assert.strictEqual(app.files('staged/release/decisions/').length, 2);
  html = app.html();
  assert.ok(/data-act="promote-stage"/.test(html), 'reopened: it can be made the default again');

  app.click('promote-stage', folder); await app.tick(300);
  const v3 = app.files('publications/release/').filter(f => /^publications\/release\/v3-[a-z0-9]+\/publication\.json$/.test(f));
  assert.strictEqual(v3.length, 1, 'published as v3');
  const p3 = JSON.parse(app.fs.files[v3[0]].t);
  assert.ok(p3.publishedBy === 'person-morgan' && p3.stagedFrom.folder === folder, JSON.stringify(p3));
  html = app.html();
  assert.ok(/v3 · published/.test(html), 'v3 is the default now');
  assert.ok(/Published as v3/.test(html) && !/data-act="promote-stage"/.test(html), 'a promoted stage offers nothing more');
});

rule('A process page with a stage, for someone who doesn\'t stage: the stage is only in the closed disclosure', async () => {
  const app = await withDraftChange('person-casey');
  app.set('change-note', 'Tell on-call first'); app.click('stage-draft', 'release'); await app.tick(200);
  const other = boot(); await other.tick(60);
  Object.keys(app.fs.files).forEach(p => { other.fs.files[p] = app.fs.files[p]; });
  other.click('refresh'); await other.tick(80);
  other.choose('person-morgan'); await other.tick(); other.click('open-process', 'release'); await other.tick();
  const html = other.html();
  assert.ok(/data-act="promote-stage"/.test(html), 'it is there');
  assert.ok(!/stag/i.test(words(html)), 'but not on screen');
});

run();
