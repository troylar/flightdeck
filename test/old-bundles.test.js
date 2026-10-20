// Older releases of the app as they shipped (dist/flightdeck.html at each tag, never edited), run in the app harness on files
// this version writes. Covers what older copies still in a team folder do with a request from flightdeck plan request: they
// must list it as an ordinary planned run and let a person start it, without changing or losing anything.
// Without the tags (a shallow clone) each bundle is skipped with a message; in CI (CI set) that's a failure instead.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { rule, run } = require('./harness');
const { boot } = require('./app-harness');

const ROOT = path.join(__dirname, '..');
/* Every release since request files can meet them (1.13 onward); 1.19.0 is merged but not tagged yet, so its merge commit. */
const BUNDLES = [['1.13.0', 'v1.13.0'], ['1.13.1', 'v1.13.1'], ['1.14.0', 'v1.14.0'], ['1.15.0', 'v1.15.0'], ['1.16.0', 'v1.16.0'], ['1.16.1', 'v1.16.1'],
  ['1.17.0', 'v1.17.0'], ['1.18.0', 'v1.18.0'], ['1.19.0', 'f5021b6']];

function bundle(name, ref) {
  let html;
  try { html = cp.execFileSync('git', ['show', ref + ':dist/flightdeck.html'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1048576, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) {
    if (process.env.CI) throw new Error(name + ': its dist/flightdeck.html (' + ref + ') isn\'t in this clone. Fetch the history and tags (git fetch --tags --unshallow).');
    console.log('  (skipped ' + name + ': ' + ref + ' isn\'t in this clone; git fetch --tags to run it)');
    return null;
  }
  assert.ok(html.includes('<meta name="flightdeck-version" content="' + name + '">'), ref + ' is Flightdeck ' + name);
  return html;
}

/* The folder an app has open, copied to disk; this version's flightdeck plan request run on it; the file it wrote. */
function request(app, body, key) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-old-'));
  Object.keys(app.fs.files).filter(p => typeof app.fs.files[p].t === 'string').forEach(p => { const f = path.join(dir, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, app.fs.files[p].t); });
  const inFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-old-in-')), 'r.json');
  fs.writeFileSync(inFile, JSON.stringify(body));
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'bin', 'flightdeck.js'), 'plan', 'request', dir, inFile, '--key', key, '--json'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout).data.request;
  return { id: j.id, rel: j.file, text: fs.readFileSync(path.join(dir, ...j.file.split('/')), 'utf8') };
}
const BODY = { process: 'release', title: 'Requested release', details: { ticket: 'ABC-555' }, roles: { qa: 'person-morgan' }, note: 'From the monthly script.', producer: { name: 'ci-check', version: '1.4.0' } };
const runsOf = (app) => app.files('runs/release/').filter(p => /\/run\.json$/.test(p));

BUNDLES.forEach(([name, ref]) => {
  rule(name + ' lists a request this version wrote (and its OneDrive copy) as a planned run, and a person starts it there; nothing is changed or lost', async () => {
    const html = bundle(name, ref);
    if (!html) return;
    const app = boot({ html }); await app.tick(60);
    app.choose('person-casey'); await app.tick();
    const req = request(app, BODY, 'old-' + name);
    const copy = req.text.replace(/"created": "[^"]*"/, '"created": "2026-01-01T00:00:00.000Z"');
    app.fs.files[req.rel] = { t: req.text, m: Date.now() };
    app.fs.files['proposals/' + req.id + '-LAPTOP.json'] = { t: copy, m: Date.now() };
    app.click('refresh'); await app.tick(80);
    app.click('nav', 'runs'); await app.tick();
    const page = app.html();
    assert.ok(page.includes('data-act="review-plan" data-id="' + req.id + '"'), name + ': listed as a planned run');
    assert.ok(/Requested release/.test(page) && /ci-check 1\.4\.0 \(a tool\)/.test(page), name + ': its title, and who asked, as the plan says');
    const before = runsOf(app);
    app.click('review-plan', req.id); await app.tick();
    assert.ok(/id="detail-ticket"[^>]*value="ABC-555"/.test(app.html()), name + ': its details on the start form');
    app.submitForm('start-form'); await app.tick(150);
    const made = runsOf(app).filter(p => before.indexOf(p) < 0);
    assert.strictEqual(made.length, 1, name + ': started by the person');
    const r = JSON.parse(app.fs.files[made[0]].t);
    assert.strictEqual(r.details.ticket, 'ABC-555'); assert.strictEqual(r.title, 'Requested release');
    assert.strictEqual(r.recorder.person, 'person-casey', name + ': the person records it');
    assert.ok(app.files('proposals/' + req.id + '.status-').length >= 1, name + ': marked started like any plan');
    assert.strictEqual(app.fs.files[req.rel].t, req.text, name + ': the request file itself is never changed');
    assert.strictEqual(app.fs.files['proposals/' + req.id + '-LAPTOP.json'].t, copy, name + ': nor its copy');
    assert.deepStrictEqual(app.files('proposals/').filter(p => p.indexOf('proposals/' + req.id) === 0 && !/\.status-/.test(p)).sort(), [req.rel, 'proposals/' + req.id + '-LAPTOP.json'].sort(), name + ': nothing else written as the request');
  });
});

run();
