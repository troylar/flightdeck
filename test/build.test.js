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

rule('The built page carries the newest release as its version', () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'flightdeck.html'), 'utf8');
  assert.ok(html.includes('<meta name="flightdeck-version" content="' + GOOD[0].version + '">'));
});

rule('the built app carries both version stamps, so copies from before the rename see updates', () => {
  const h = require('fs').readFileSync(require('path').join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8').slice(0, 8192);
  const legacy = /<meta name="preflight-version" content="(\d{1,4}\.\d{1,4}\.\d{1,4})">/.exec(h), now = /<meta name="flightdeck-version" content="([^"]+)">/.exec(h);
  assert.ok(legacy && now && legacy[1] === now[1], 'both stamps, same version');
});

run();
