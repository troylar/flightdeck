// 2.10's step form against the 2.9.0 app as it shipped: the same edits, made through each version's own controls, save the
// same Markdown byte for byte. Without the tag (a shallow clone) it's skipped with a message; in CI (CI set) that fails.
'use strict';
const assert = require('assert');
const path = require('path'), cp = require('child_process');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

const ROOT = path.join(__dirname, '..');
function old() {
  try { return cp.execFileSync('git', ['show', 'v2.9.0:dist/flightdeck.html'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1048576, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) {
    if (process.env.CI) throw new Error('v2.9.0 isn\'t in this clone. Fetch the history and tags (git fetch --tags --unshallow).');
    console.log('  (skipped: v2.9.0 isn\'t in this clone; git fetch --tags to run it)');
    return null;
  }
}
async function editorOf(opts) {
  const app = boot(opts); await app.tick(60); app.choose('person-casey'); await app.tick();
  app.click('open-process', 'release'); await app.tick(); app.click('ptab', 'edit'); await app.tick();
  return app;
}
const enter = (app, id, value) => { app.set(id, value); app.input(id, value); app.keyOn('Enter', {}, { tagName: 'INPUT', id, value, dataset: { enter: 'ob-commit' }, closest: () => null }); };
const leave = (app, id, value) => { app.set(id, value); app.input(id, value); app.select(id, value); };
const saved = async app => { app.click('save-draft'); await app.tick(80); return app.fs.files['maps/drafts/release.md'].t; };

rule('2.10 and 2.9.0 save the same Markdown for the same step edits: marks, a guidance field, a note and a type', async () => {
  const html = old(); if (!html) return;
  const was = await editorOf({ html }), now = await editorOf();
  assert.strictEqual(was.fs.files['maps/drafts/release.md'].t, now.fs.files['maps/drafts/release.md'].t, 'the same draft to start');
  for (const app of [was, now]) { app.click('ob-sel', 'flags'); await app.tick(); }
  was.check('ob-mark-planned', true); now.check('ob-planned', true);
  for (const app of [was, now]) { await app.tick(); app.click('ob-sel', 'rollback'); await app.tick(); }
  was.check('ob-mark-step', true); now.check('ob-must', false);
  await was.tick(); await now.tick();
  now.click('ob-show', 'where'); await now.tick();
  for (const app of [was, now]) { enter(app, 'ob-fld-where', 'The release ticket'); await app.tick(); }
  now.click('ob-note-open'); await now.tick();
  for (const app of [was, now]) { leave(app, 'ob-note', 'Write the commit hash, not the branch.'); await app.tick(); }
  for (const app of [was, now]) { app.click('ob-sel', 'announce'); await app.tick(); app.select('ob-type', 'meeting'); await app.tick(); }
  const a = await saved(was), b = await saved(now);
  assert.ok(/- \[~\] \{confirm\} Feature flags/.test(a) && /- \[ \] \{confirm\} Rollback commit[^\n]*\n  where: The release ticket\n/.test(a) && /\{meeting\} Post "starting release"/.test(a), '2.9.0 made every edit:\n' + a);
  assert.strictEqual(b, a, 'byte for byte');
});

run();
