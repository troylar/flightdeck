// Move to a new checklist in the built app (docs/design.md section 46): the new draft is written as a new file, the steps
// here are replaced as one unsaved Undo entry, and a refusal changes nothing and says why next to its box.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

async function editing() {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  return app;
}
const DRAFT = 'maps/drafts/release.md', NEW = 'maps/drafts/deploy-the-build.md';

rule('App: Move to a new checklist writes the new draft and leaves one unsaved step here that runs it', async () => {
  const app = await editing(), original = app.fs.files[DRAFT].t;
  app.click('ob-sel', 'jenkins'); await app.tick();
  assert.ok(/data-act="ob-ex-open" data-id="jenkins" data-kind="steps"/.test(app.html()), 'a step offers it');
  app.click('ob-ex-open', 'jenkins', { kind: 'steps' }); await app.tick();
  assert.ok(/id="ob-ex-title"/.test(app.html()) && /id="ob-ex-to"/.test(app.html()), 'it asks for a title and the last step');
  app.set('ob-ex-title', 'Deploy the build'); app.select('ob-ex-to', 'pods');
  app.click('ob-ex-go'); await app.tick(80);
  const kid = app.fs.files[NEW] && app.fs.files[NEW].t;
  assert.ok(kid, 'the new draft is in the folder');
  assert.ok(/^process: deploy-the-build$/m.test(kid) && /^title: Deploy the build$/m.test(kid));
  assert.ok(/^context: ticket, tag$/m.test(kid), 'it lists what its steps read');
  assert.ok(/\{#jenkins\}/.test(kid) && /\{#approve\}/.test(kid) && /\{#pods\}/.test(kid), 'the steps keep their IDs');
  assert.strictEqual(app.fs.files[DRAFT].t, original, 'this draft isn\'t saved yet');
  const html = app.html();
  assert.ok(/data-ob-step="deploy-the-build"/.test(html) && !/data-ob-step="jenkins"/.test(html), 'one step took their place');
  assert.ok(/Moved 3 steps to the new checklist Deploy the build\. It passes \^ticket, \^tag to it\./.test(html), 'it says what moved and what is passed');
  assert.ok(/Publish Deploy the build first/.test(html), 'and to publish it first');
  assert.ok(/Draft: not saved\./.test(html));
  app.click('save-draft'); await app.tick(80);
  const saved = app.fs.files[DRAFT].t;
  assert.ok(/- \[!\] \{run\.process\} Deploy the build \{#deploy-the-build\}\n  process: deploy-the-build\n  carry: ticket, tag\n/.test(saved), 'saved as a linked step');
});

rule('App: Undo puts the moved steps back and leaves the new draft', async () => {
  const app = await editing();
  app.click('ob-sel', 'pods'); await app.tick();
  app.click('ob-ex-open', 'pods', { kind: 'steps' }); await app.tick();
  app.set('ob-ex-title', 'Deploy the build'); app.click('ob-ex-go'); await app.tick(80);
  assert.ok(app.fs.files[NEW]);
  app.click('tl-undo', 'draft'); await app.tick();
  assert.ok(/data-ob-step="pods"/.test(app.html()) && !/data-ob-step="deploy-the-build"/.test(app.html()), 'back as it was');
  assert.ok(app.fs.files[NEW], 'the new draft stays');
});

rule('App: a phase whose step sets a detail used later is refused next to the title, and nothing is written', async () => {
  const app = await editing(), before = Object.keys(app.fs.files).sort();
  app.click('ob-sel-phase', 'deploy'); await app.tick();
  app.click('ob-ex-open', 'deploy', { kind: 'phase' }); await app.tick();
  app.set('ob-ex-title', 'Deploy the build'); app.click('ob-ex-go'); await app.tick(80);
  const html = app.html();
  assert.ok(/id="ferr-ob-ex-title"[^>]*>[^<]*Merge the release branch[^<]*\^tag/.test(html), 'the reason is beside the box');
  assert.ok(/id="ob-ex-title"[^>]*aria-invalid="true"/.test(html));
  same(Object.keys(app.fs.files).sort(), before, 'no file written');
  assert.ok(/data-ob-step="merge"/.test(html), 'nothing moved');
});

rule('App: a title taken by another checklist gets a file name of its own', async () => {
  const app = await editing();
  app.click('ob-sel', 'pods'); await app.tick();
  app.click('ob-ex-open', 'pods', { kind: 'steps' }); await app.tick();
  app.set('ob-ex-title', 'Check in'); app.click('ob-ex-go'); await app.tick(80);
  assert.ok(app.fs.files['maps/drafts/check-in-2.md'], 'next to check-in, never over it');
  assert.ok(/^process: check-in-2$/m.test(app.fs.files['maps/drafts/check-in-2.md'].t));
});

rule('App: Cancel closes the form without changing anything', async () => {
  const app = await editing();
  app.click('ob-sel-phase', 'deploy'); await app.tick();
  app.click('ob-ex-open', 'deploy', { kind: 'phase' }); await app.tick();
  assert.ok(/id="ob-ex-title"/.test(app.html()));
  app.click('ob-ex-cancel'); await app.tick();
  assert.ok(!/id="ob-ex-title"/.test(app.html()) && !/Draft: not saved\./.test(app.html()));
});

function same(a, b, msg) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg); }

run();
