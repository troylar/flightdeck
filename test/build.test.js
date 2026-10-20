// The release notes: build.py refuses a bad releases.json, escapes release text inside the page, and writes the changelog.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { rule, run } = require('./harness');
const ROOT = path.join(__dirname, '..');
const GOOD = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8'));
function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* next */ } } return null; }
const py = python();

function check(releases) {
  const file = path.join(os.tmpdir(), 'preflight-releases-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(file, JSON.stringify(releases));
  try { return { ok: true, out: cp.execFileSync(py, [path.join(ROOT, 'build.py'), '--check-releases', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, err: String(e.stderr || e.message) }; }
  finally { fs.rmSync(file, { force: true }); }
}
const clone = () => JSON.parse(JSON.stringify(GOOD));

rule('The shipped release notes are valid, and CHANGELOG.md is exactly what they generate', () => {
  if (!py) return console.log('  (skipped: no Python)');
  const r = check(GOOD);
  assert.ok(r.ok, r.err);
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), r.out, 'run python build.py to regenerate CHANGELOG.md');
});

rule('A bad release entry fails the build with a clear reason', () => {
  if (!py) return console.log('  (skipped: no Python)');
  const cases = [
    [x => { [x[0], x[1]] = [x[1], x[0]]; }, /must come after|dated after/],
    [x => { x[1].version = x[0].version; }, /appears twice/],
    [x => { x[0].version = '1.6'; }, /MAJOR\.MINOR\.PATCH/],
    [x => { x[0].date = '17 Oct'; }, /YYYY-MM-DD/],
    [x => { x[0].date = '20261017'; }, /YYYY-MM-DD/],
    [x => { x[0].date = '2026-W42-6'; }, /YYYY-MM-DD/],
    [x => { x[0].date = '2026-02-30'; }, /not a real date/],
    [x => { x[0].changes[0].kind = 'feature'; }, /kind must be one of/],
    [x => { x[0].changes[0].titel = 'typo'; }, /unknown field/],
    [x => { x[0].changes[0].now = ''; }, /now must be/],
    [x => { x[0].changes = []; }, /at least one change/],
    [x => { x[0].headline = 'x'.repeat(141); }, /headline/]
  ];
  cases.forEach(([mutate, want]) => { const x = clone(); mutate(x); const r = check(x); assert.ok(!r.ok && want.test(r.err), 'expected ' + want + ', got ' + (r.err || 'success')); });
});

rule('Release text can never close the page\'s script', () => {
  if (!py) return console.log('  (skipped: no Python)');
  const js = cp.execFileSync(py, ['-c', 'import build, json, sys; print(build.releases_js(json.load(sys.stdin)))'], { cwd: ROOT, input: JSON.stringify([{ t: '</script><!--<script> \u2028 \u2029' }]), encoding: 'utf8' });
  assert.ok(!/<|\u2028|\u2029/.test(js), js);
  assert.deepStrictEqual(JSON.parse(js), [{ t: '</script><!--<script> \u2028 \u2029' }]);
});

rule('People see "your AI assistant", never "LLM", anywhere in the built app', () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'flightdeck.html'), 'utf8').replace(/[A-Za-z0-9+/=]{200,}/g, '');
  const hits = html.match(/.{0,40}\bLLMs?\b.{0,40}/g) || [];
  assert.deepStrictEqual(hits, []);
});

rule('The built page carries the newest release as its version', () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'flightdeck.html'), 'utf8');
  assert.ok(html.includes('<meta name="flightdeck-version" content="' + GOOD[0].version + '">'));
});

rule('the built app carries both version stamps, so copies from before the rename see updates', () => {
  const h = require('fs').readFileSync(require('path').join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8').slice(0, 8192);
  const legacy = /<meta name="preflight-version" content="(\d{1,4}\.\d{1,4}\.\d{1,4})">/.exec(h), now = /<meta name="flightdeck-version" content="([^"]+)">/.exec(h);
  assert.ok(legacy && now && legacy[1] === now[1], 'both stamps, same version');
});

rule('The baselines list this version\'s AGENTS.md and skills, and the built app carries exactly src/baselines.json', () => {
  const B = require('../tools/baselines.js'), b = B.load();
  assert.deepStrictEqual(B.problems(b, B.version()), []);
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'flightdeck.html'), 'utf8'), m = /var BASELINES = (\{.*\});\n/.exec(html);
  assert.ok(m, 'the app embeds the baselines on one line');
  assert.deepStrictEqual(JSON.parse(m[1]), b, 'run python build.py');
  assert.ok(Object.keys(b.files['AGENTS.md#flightdeck']).length > 1, 'earlier releases are recorded too (node tools/baselines.js --backfill)');
});


rule('The shapes for other apps are built into the core block, and docs/apps.md documents every field, problem kind and exit code', () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'flightdeck.html'), 'utf8'), core = /<script id="pf-core">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(/PF\.appjson = /.test(core), 'core/appjson.js is in CORE');
  const PF = require('./harness').load(), A = PF.appjson, doc = fs.readFileSync(path.join(ROOT, 'docs', 'apps.md'), 'utf8');
  const keys = new Set();
  (function walk(d) { if (Array.isArray(d)) return d.forEach(walk); if (d && typeof d === 'object') Object.keys(d).forEach(k => { if (k[0] !== '$') keys.add(k); walk(d[k]); }); })(Object.values(JSON.parse(JSON.stringify(A.SCHEMA))));
  const missing = [...keys].filter(k => !doc.includes('`' + k + '`'));
  assert.deepStrictEqual(missing, [], 'fields not in docs/apps.md');
  A.KINDS.forEach(k => assert.ok(doc.includes('`' + k + '`'), 'problem kind ' + k));
  ['0', '1', '4', '5'].forEach(c => assert.ok(new RegExp('\\| `?' + c + '`? \\|').test(doc), 'exit code ' + c));
  ['processes', 'process', 'runs', 'run', 'next', 'followups'].forEach(c => assert.ok(doc.includes('flightdeck ' + c + ' '), c));
  assert.ok(doc.includes('People-directory email fields are omitted.'));
});

rule('docs/apps.md documents flightdeck-draft/1: every field of draft read and draft save, every error kind and exit code', () => {
  const PF = require('./harness').load(), D = PF.proposals.CLI, doc = fs.readFileSync(path.join(ROOT, 'docs', 'apps.md'), 'utf8');
  assert.ok(doc.includes('flightdeck-draft/1'));
  ['flightdeck draft read ', 'flightdeck draft save ', 'flightdeck draft propose '].forEach(c => assert.ok(doc.includes(c), c));
  const missing = D.read.concat(D.save, D.errors, D.outcomes, D.why, D.links).filter(k => !doc.includes('`' + k + '`'));
  assert.strictEqual(missing.length, 0, 'not in docs/apps.md: ' + missing.join(', '));
  ['--expect', '--from', '--base', '--session', '--label', '--by', '--note', '--after-earlier', '--or-latest'].forEach(f => assert.ok(doc.includes(f), f));
});

rule('1.19.0 has its own release entry, and its text promises exactly slices 1 and 2: live apply with nothing unsaved, never a merge', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), r = rel.filter(x => x.version === '1.19.0')[0];
  assert.ok(r && rel[0] === r, '1.19.0 is the newest release');
  const text = JSON.stringify(r);
  assert.ok(!/merg|never silently|always appears|instantly|real[- ]time/i.test(text), 'nothing slice 3 promises, and no promise beyond a few seconds');
  assert.ok(/proposal/i.test(text) && /draft read, save and propose/.test(text), 'slice 1');
  assert.ok(/with nothing unsaved/.test(text) && /within a few seconds/.test(text) && /One Undo takes it back/.test(text) && /OneDrive/.test(text) && /Decline/.test(text), 'slice 2, with its limits');
});

rule('Only the display uses the newest-200 list of proposals: judging, Apply, decisions and the command line use every proposal', () => {
  const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const files = ['src/ui/app.js', 'src/storage/repo.js', 'bin/flightdeck.js', 'src/ui/views/process.js', 'src/ui/views/manage.js', 'src/ui/views/home.js'];
  const uses = files.map(f => [f, (src(f).match(/\.shown\b/g) || []).length]).filter(x => x[1]);
  assert.deepStrictEqual(uses, [['src/ui/app.js', 1]], 'the capped list (shown) is read in one place, the display filter in processes()');
  files.forEach(f => assert.ok(!/(pr|pr2|x|procs\.\w+|procs\[\w+\])\.proposals\b/.test(src(f)), f + ' reads a capped list under its old name'));
});

run();
