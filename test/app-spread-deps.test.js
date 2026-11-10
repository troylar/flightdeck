// Review round 6 (XA, docs/design.md 45.1): the app reads a spread's dependencies through the CLI's own input builder
// (PF.spreads.inputs), so every cell of the CLI's matrix (test/spread-deps.test.js) holds here too: a fulfilled spread whose
// loop is approved, with any dependency absent, unreadable, malformed or newer, keeps its gate from Ready, Pass saves
// nothing, and a fresh good read makes it Ready again. (A link has no meaning in a browser folder.)
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const F = require('./app-spread-fixture');

const SEC_OF = (app) => app.files('proposals/').find(p => { try { const j = JSON.parse(app.fs.files[p].t); return j.op === 'spread-add'; } catch (e) { return false; } });
const KINDS = {
  'a scope record': (app) => F.scopes(app)[0],
  'a later scope record that brought an item in': (app) => F.scopes(app).slice(-1)[0],
  'the spread-add proposal': SEC_OF,
  'the application living.head names': (app) => 'proposals/' + F.parentRun(app).living.head + '.json',
  'an item\'s run': (app) => F.kidOf(app, 'ABC-102'),
  'an item\'s version': (app) => app.files('publications/validate-story/').find(p => /publication\.json$/.test(p)),
  'an item\'s own addition': (app) => 'proposals/' + JSON.parse(app.fs.files[F.kidOf(app, 'ABC-102')].t).living.head + '.json',
  'the run\'s own version': (app) => app.files('publications/release-readiness/').find(p => /publication\.json$/.test(p))
};
const newer = (t, p) => { const j = JSON.parse(t); if (/run\.json$/.test(p)) j.format = 'preflight-run/9'; else if (/publication\.json$/.test(p)) j.format = 'preflight-publication/9'; else j.format = String(j.format).replace(/\/[0-9]+$/, '/5'); return JSON.stringify(j); };
/* Each mode breaks the file and returns what puts it back. */
const MODES = {
  absent: (app, p) => {
    const dir = /run\.json$|publication\.json$/.test(p) ? p.slice(0, p.lastIndexOf('/') + 1) : p, kept = {};
    Object.keys(app.fs.files).forEach(k => { if (k === p || (dir !== p && k.indexOf(dir) === 0)) { kept[k] = app.fs.files[k]; delete app.fs.files[k]; } });
    return () => Object.assign(app.fs.files, kept);
  },
  unreadable: (app, p) => { const read = app.fs.read; app.fs.read = (q, o) => q === p ? Promise.reject(new Error('EIO')) : read.call(app.fs, q, o); return () => { app.fs.read = read; }; },
  malformed: (app, p) => { const was = app.fs.files[p]; app.fs.files[p] = { t: '{"truncated":', m: Date.now() }; return () => { app.fs.files[p] = { t: was.t, m: Date.now() }; }; },
  newer: (app, p) => { const was = app.fs.files[p]; app.fs.files[p] = { t: newer(was.t, p), m: Date.now() }; return () => { app.fs.files[p] = { t: was.t, m: Date.now() }; }; }
};
const gateText = (app) => (F.txt(app.html()).replace(/\s+/g, ' ').match(/Confirm Stories · [A-Za-z ]{0,20}/) || [''])[0];
const passed = (app) => { const g = F.parentRun(app).gates || {}; return Object.keys(g).some(k => g[k] && g[k].s === 'passed'); };
for (const kind of Object.keys(KINDS)) for (const mode of Object.keys(MODES)) {
  rule('XA: ' + kind + ', ' + mode + ': the app holds the gate, Pass saves nothing, and a fresh good read is Ready again', async () => {
    const app = await F.ready();
    const p = KINDS[kind](app);
    assert.ok(p && app.fs.files[p], kind + ': set-up, its file (' + p + ')');
    const undo = MODES[mode](app, p);
    for (let i = 0; i < 2; i++) await F.refresh(app, 300);
    F.backToParent(app); await app.tick(80);
    const off = [];
    if (/· Ready/.test(gateText(app))) off.push('the gate is still Ready');
    app.click('pass', '0'); await app.tick(150);
    if (passed(app)) off.push('Pass saved the gate');
    undo();
    for (let i = 0; i < 3; i++) await F.refresh(app, 300);
    F.backToParent(app); await app.tick(80);
    if (!passed(app) && !/· Ready/.test(gateText(app))) off.push('back: not Ready again (' + gateText(app) + ')');
    assert.deepStrictEqual(off, [], kind + ', ' + mode);
  });
}
run();
