// Round 19: the write-time guard is enforced where the bytes are written, not where a writer is called. The folder the app
// opens is registered with repo, and repo's run writer (the candidate, run.json, a conflict copy) and scope record writer
// refuse any write that doesn't hand over a token one of the app's guards made, for that run and revision, right before the
// write. However a write is reached (an alias, a wrapper, a property, an object made from the folder, a token made by
// hand), in the test build (FLIGHTDECK_STRICT_GUARDS) it throws, and nothing is written.
//
// The writers, for reference (documentation only; nothing here depends on the list): save() (every mutateRun, so every
// loopEdit, X, Reopen, Hand off, Try again: the ordinary fresh guard unless the change names its own), loopLaunch (a story's
// run: the fresh guard, with a create binding), launchChild, continueTwo, csHarvest, resumeStart and startTestRun (new runs:
// a create capability, refused when run.json is there), and scopeSave (every scope record: its fresh guard, or the report
// token of a carried-out request's outcome).
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

async function opened(html) {
  const app = boot(Object.assign({ localStore: { 'preflight:builder': 'false' } }, html ? { html } : {}));
  await app.tick(80); app.choose('person-avery'); await app.tick(80);
  return app;
}
/* A run in the opened folder, read as the app reads one (its fingerprint set). */
function aRun(app) {
  const p = app.files('runs/').find(f => /\/run\.json$/.test(f));
  const r = app.PF.run.sanitize(JSON.parse(app.fs.files[p].t));
  r._fileHash = app.PF.repo.fileHash(app.fs.files[p].t);
  return { r, p, text: app.fs.files[p].t };
}
const snapshot = (app) => JSON.stringify(app.files('').map(f => [f, app.fs.files[f].t]));
/* What a call did: threw (synchronously), rejected, or resolved; and whether anything in the folder changed. */
async function outcome(app, call) {
  const before = snapshot(app);
  let how = 'resolved', why = '';
  try { const p = call(); await Promise.resolve(p).then(null, (e) => { how = 'rejected'; why = e && e.message; }); } catch (e) { how = 'threw'; why = e && e.message; }
  await app.tick(100);
  return { how, why, wrote: snapshot(app) !== before };
}

const MUTANTS = {
  'an alias of the writer': (app, r) => { const w = app.PF.repo.saveRun; return w(app.fs, r, 'mutant'); },
  'a helper that wraps it': (app, r) => { const h = (f, x) => app.PF.repo.saveRun(f, x, 'mutant', { writer: 'mutant' }); return h(app.fs, r); },
  'a call through a property': (app, r) => { const o = { s: app.PF.repo.saveRun }; return o.s(app.fs, r, 'mutant'); },
  'an object made from the folder': (app, r) => app.PF.repo.saveRun(Object.create(app.fs), r, 'mutant'),
  'a guard that answers true': (app, r) => app.PF.repo.saveRun(app.fs, r, 'mutant', { recheck: () => true })
};
for (const m of Object.keys(MUTANTS)) rule('A run written through ' + m + ', without its guard\'s token, throws in the test build and writes nothing', async () => {
  const app = await opened(), { r } = aRun(app);
  r.title = 'Changed by a mutant';
  const o = await outcome(app, () => MUTANTS[m](app, r));
  assert.deepStrictEqual([o.how === 'resolved', o.wrote], [false, false], JSON.stringify(o));
  assert.ok(/guard didn't admit/.test(o.why), 'refused by the writer\'s check: ' + o.why);
});
rule('A token made by hand, shaped like the guard\'s, is refused: it was never made by the guard', async () => {
  const app = await opened(), { r } = aRun(app), key = r.process + '/' + r.id;
  r.title = 'Changed with a forged token';
  const o = await outcome(app, () => app.PF.repo.saveRun(app.fs, r, 'mutant', { recheck: () => ({ kind: 'fresh', runs: { [key]: r.rev || 0 }, create: '' }) }));
  assert.deepStrictEqual([o.how, o.wrote], ['rejected', false], JSON.stringify(o));
});
rule('A new run written without its create capability throws in the test build and writes nothing', async () => {
  const app = await opened(), { r } = aRun(app);
  const n = JSON.parse(JSON.stringify(r)); n.id = 'mutant-new-run'; delete n._fileHash;
  const o = await outcome(app, () => { const w = app.PF.repo.saveRun; return w(app.fs, n, 'mutant'); });
  assert.deepStrictEqual([o.how, o.wrote], ['threw', false], JSON.stringify(o));
});
const SCOPE = 'req-mutant-0123456789abcdef01234567.json';
const scopeFile = () => ({ format: 'flightdeck-plan/3', features: ['loops'] });
for (const [m, call] of [
  ['an alias of the scope writer', (app) => { const w = app.PF.repo.saveScope; return w(app.fs, SCOPE, scopeFile(), {}); }],
  ['a call through a property, with a guard that answers true', (app) => { const o = { s: app.PF.repo.saveScope }; return o.s(app.fs, SCOPE, scopeFile(), { recheck: () => true }); }]
]) rule('A scope record written through ' + m + ' is refused and nothing is written', async () => {
  const app = await opened();
  const o = await outcome(app, () => call(app));
  assert.ok(o.how !== 'resolved' || !o.wrote, JSON.stringify(o));
  assert.strictEqual(o.wrote, false);
  assert.ok(o.how === 'threw' || /guard didn't admit/.test(o.why), 'refused by the writer\'s check: ' + JSON.stringify(o));
});
/* The same mutants made in the app's own source: a click handler that aliases, wraps or calls the writer through a property,
   built into the page. Each click throws in the test build and writes nothing. */
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8');
const ANCHOR = "    'loop-unsettle': function (id) {";
const SOURCE = {
  alias: "'mutant': function () { var w = repo.saveRun; w(state.fs, data.runs[0], SESSION, { writer: WRITER }); },",
  helper: "'mutant': function () { var h = function (r) { return repo.saveRun(state.fs, r, SESSION, { writer: WRITER }); }; h(data.runs[0]); },",
  property: "'mutant': function () { var o = { put: PF.repo.saveRun }; o.put(state.fs, data.runs[0], SESSION, { writer: WRITER }); },",
  scope: "'mutant': function () { var w = repo.saveScope; w(state.fs, '" + SCOPE + "', { format: 'flightdeck-plan/3' }, {}); },"
};
for (const m of Object.keys(SOURCE)) rule('A writer reached by ' + m + ' in the app\'s own source throws when clicked in the test build, and nothing is written', async () => {
  assert.strictEqual(HTML.split(ANCHOR).length, 2, 'set-up: one place to put the mutant');
  const app = await opened(HTML.replace(ANCHOR, '    ' + SOURCE[m] + '\n' + ANCHOR));
  const o = await outcome(app, () => app.click('mutant', ''));
  assert.deepStrictEqual([o.how, o.wrote], ['threw', false], JSON.stringify(o));
});

run();
