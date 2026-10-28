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

rule('test/run.sh runs every test file in test/', () => {
  const listed = (fs.readFileSync(path.join(__dirname, 'run.sh'), 'utf8').match(/\btest\/[\w.-]+\.test\.js\b/g) || []).map(f => f.slice(5));
  const files = fs.readdirSync(__dirname).filter(f => /\.test\.js$/.test(f));
  assert.deepStrictEqual(files.filter(f => listed.indexOf(f) < 0), [], 'add these to test/run.sh');
});

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
  (function walk(d) { if (Array.isArray(d)) return d.forEach(walk); if (d && typeof d === 'object') Object.keys(d).forEach(k => { if (k[0] !== '$') keys.add(k); walk(d[k]); }); })(Object.values(JSON.parse(JSON.stringify(A.SCHEMA))).concat(Object.values(JSON.parse(JSON.stringify(A.SCHEMA2)))));
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
  assert.ok(r, '1.19.0 has its own release entry');
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

rule('docs/apps.md documents flightdeck plan request: its command, every status, error kind and exit code, and its limits', () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'flightdeck.html'), 'utf8'), core = /<script id="pf-core">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(/PF\.requests = /.test(core), 'core/requests.js is in CORE');
  const PF = require('./harness').load(), Q = PF.requests.CLI, doc = fs.readFileSync(path.join(ROOT, 'docs', 'apps.md'), 'utf8');
  assert.ok(doc.includes('flightdeck plan request '));
  const missing = Q.input.concat(Q.statuses, Q.errors).filter(k => !doc.includes('`' + k + '`'));
  assert.strictEqual(missing.length, 0, 'not in docs/apps.md: ' + missing.join(', '));
  ['--key', '--dry-run'].forEach(f => assert.ok(doc.includes(f), f));
  assert.ok(/doesn't stop two computers/.test(doc) && /exactly once/.test(doc), 'the stated limits');
  const help = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'bin', 'flightdeck.js'), 'help'], { encoding: 'utf8' });
  assert.ok(help.includes('flightdeck plan request <team folder>'), 'the help names it');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes('flightdeck plan request'), 'README');
});

rule('docs/apps.md documents flightdeck report: its commands, every status, error kind and applies value, its flags and contract', () => {
  const PF = require('./harness').load(), Q = PF.reports.CLI, doc = fs.readFileSync(path.join(ROOT, 'docs', 'apps.md'), 'utf8');
  Q.commands.forEach(c => assert.ok(doc.includes('flightdeck report ' + c + ' '), c));
  const missing = Q.statuses.concat(Q.errors, Q.applies, PF.reports.KEYS.filter(k => k !== 'features' && k !== 'app')).filter(k => !doc.includes('`' + k + '`'));
  assert.strictEqual(missing.length, 0, 'not in docs/apps.md: ' + missing.join(', '));
  ['--dry-run', '--strict', '--unmatched-ok', '--folder', 'flightdeck-read/2', 'flightdeck-report/1'].forEach(f => assert.ok(doc.includes(f), f));
  const help = require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'bin', 'flightdeck.js'), 'help'], { encoding: 'utf8' });
  Q.commands.forEach(c => assert.ok(help.includes('flightdeck report ' + c + ' '), 'the help names report ' + c));
});

rule('1.20.0 has its own release entry, in plain words', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), r = rel.filter(x => x.version === '1.20.0')[0];
  assert.ok(r && rel[rel.findIndex(x => x.version === '1.21.0') + 1] === r, '1.20.0 is the release before 1.21.0');
  const text = JSON.stringify(r);
  assert.ok(/plan request/.test(text) && /A person starts/.test(text) && /by its own account/.test(text), text);
});

rule('1.21.0 has its own release entry, in plain words, naming no employer, product or tool', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), r = rel.filter(x => x.version === '1.21.0')[0];
  assert.ok(r && rel[rel.findIndex(x => x.version === '1.22.0') + 1] === r, '1.21.0 is the release before 1.22.0');
  const text = JSON.stringify(r);
  assert.ok(/Needs Flightdeck 2\.0/.test(text) && /no longer read as if it were an older one/.test(text) && /never changes them/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour/i.test(text), 'US English');
});

rule('2.0.0 has its own release entry, in plain US English, naming the notes and screenshots older copies can\'t run', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), r = rel.filter(x => x.version === '2.0.0')[0];
  assert.ok(r, '2.0.0 is listed');
  const text = JSON.stringify(r);
  assert.ok(/phase/i.test(text) && /gate/i.test(text) && /screenshot/i.test(text) && /1\.22 or earlier/.test(text) && !/1\.21 or earlier/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM/i.test(text), 'US English, and your AI assistant, never LLM');
});

rule('2.1.0 has its own release entry above 2.0.1 and 2.0.0: only when, and that a version using it needs Flightdeck 2.1', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), i = rel.findIndex(x => x.version === '2.1.0'), r = rel[i];
  assert.ok(r, '2.1.0 is listed');
  assert.deepStrictEqual(rel.slice(i + 1, i + 3).map(x => x.version), ['2.0.1', '2.0.0'], '2.0.1\'s notes ship with 2.1');
  const text = JSON.stringify(r);
  assert.ok(/only when/i.test(text) && /Not needed/.test(text) && /needs Flightdeck 2\.1/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM/i.test(text), 'US English, and your AI assistant, never LLM');
});

rule('2.3.0 has its own release entry above 2.2.1: Practice on the run screen, Edit and Back to practice', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), i = rel.findIndex(x => x.version === '2.3.0'), r = rel[i];
  assert.ok(r, '2.3.0 is listed'); assert.strictEqual(rel[i + 1].version, '2.2.1');
  const text = JSON.stringify(r);
  assert.ok(/run screen/.test(text) && /Back to practice/.test(text) && /Try it again/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM/i.test(text), 'US English, and your AI assistant, never LLM');
});

rule('2.8.0 has its own release entry above 2.7.0: nested processes that know what the child needs, in plain words', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), at = rel.findIndex(x => x.version === '2.8.0'), r = rel[at];
  assert.ok(at >= 0, 'listed'); assert.strictEqual(rel[at + 1].version, '2.7.0');
  const text = JSON.stringify(r);
  assert.ok(/pass:/.test(text) && /start form/.test(text) && /Flightdeck 2\.8/.test(text) && /Folder health/.test(text) && /Rename/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM|baselines|PF\.|team values/i.test(text), 'US English, plain words, nothing not shipped');
});

rule('2.6.1 has its own release entry above 2.6.0: documentation that matches the app, and how it reaches a folder', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), at = rel.findIndex(x => x.version === '2.6.1'), r = rel[at];
  assert.ok(at >= 0, 'listed'); assert.strictEqual(rel[at + 1].version, '2.6.0');
  const text = JSON.stringify(r);
  assert.ok(/AI assistants/.test(text) && /install <folder>/.test(text) && /When something goes wrong/.test(text) && /quick start/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM|baselines|PF\./i.test(text), 'US English, plain words: no code names');
});

rule('2.6.0 has its own release entry above 2.5.0: Boxes that explain themselves, in plain words', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), i = rel.findIndex(x => x.version === '2.6.0'), r = rel[i];
  assert.ok(r, '2.6.0 is listed'); assert.strictEqual(rel[i + 1].version, '2.5.0');
  const text = JSON.stringify(r);
  assert.ok(/Boxes that explain themselves/.test(text) && /Which job\?/.test(text) && /\+ add/.test(text) && /Where is the pull request\?/.test(text) && /a yes or no/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM|guide\.js|PF\.|aria-|obShown/i.test(text), 'US English, plain words: no code names');
});

rule('2.5.0 has its own release entry above 2.4.0: Big folders, said as what it\'s like with thousands of runs', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), i = rel.findIndex(x => x.version === '2.5.0'), r = rel[i];
  assert.ok(r, '2.5.0 is listed'); assert.strictEqual(rel[i + 1].version, '2.4.0');
  const text = JSON.stringify(r);
  assert.ok(/Big folders/.test(text) && /thousands of runs/.test(text) && /quarter second/.test(text) && /person picker/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM|index|memo|O\(/i.test(text), 'US English, plain words: no index, memo or O()');
});

rule('2.4.0 has its own release entry above 2.3.1: Fresh coat, a minor of improvements in plain words', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), i = rel.findIndex(x => x.version === '2.4.0'), r = rel[i];
  assert.ok(r, '2.4.0 is listed'); assert.strictEqual(rel[i + 1].version, '2.3.1');
  const text = JSON.stringify(r);
  assert.ok(/Fresh coat/.test(text) && /Instrument Sans/.test(text) && /less motion/.test(text) && /disabled controls stay still/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM/i.test(text), 'US English, and your AI assistant, never LLM');
});

rule('2.3.1 has its own release entry above 2.3.0: Run screen polish', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), i = rel.findIndex(x => x.version === '2.3.1'), r = rel[i];
  assert.ok(r, '2.3.1 is listed'); assert.strictEqual(rel[i + 1].version, '2.3.0');
  const text = JSON.stringify(r);
  assert.ok(/Run screen polish/.test(text) && /Review & publish/.test(text) && /couldn't confirm/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM/i.test(text), 'US English, and your AI assistant, never LLM');
});

rule('2.2.1 has its own release entry above 2.2.0: quick capture, a blank process ready to type, Stage from Practice', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), i = rel.findIndex(x => x.version === '2.2.1'), r = rel[i];
  assert.ok(r, '2.2.1 is listed'); assert.strictEqual(rel[i + 1].version, '2.2.0');
  const text = JSON.stringify(r);
  assert.ok(/Enter/.test(text) && /Add a step/.test(text) && /Stage it for a test run/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM/i.test(text), 'US English, and your AI assistant, never LLM');
});

rule('2.2.0 has its own release entry above 2.1.1: Practice, in plain words', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), at = rel.findIndex(x => x.version === '2.2.0'), r = rel[at];
  assert.ok(at >= 0); assert.strictEqual(rel[at + 1].version, '2.1.1');
  const text = JSON.stringify(r);
  assert.ok(/Practice/.test(text) && /Try it again/.test(text) && /never written to the team folder/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM/i.test(text), 'US English, and your AI assistant, never LLM');
});

rule('2.1.1 has its own release entry above 2.1.0: a planned run starts once, Try again, decisions that hold an edited plan, and every computer on 2.1.1', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), r = rel.filter(x => x.version === '2.1.1')[0];
  assert.ok(r); assert.strictEqual(rel[rel.indexOf(r) + 1].version, '2.1.0');
  const text = JSON.stringify(r);
  assert.ok(/Try again/.test(text) && /make a new plan/.test(text) && /Decided on an earlier version/.test(text) && /2\.1\.1 on every computer/.test(text) && /-d\.json/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|LLM/i.test(text), 'US English, and your AI assistant, never LLM');
});

rule('1.22.0 has its own release entry: Back and Forward and the builder\'s details, notes and Questions, a minor with two new changes, in plain words', () => {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8')), r = rel.filter(x => x.version === '1.22.0')[0];
  assert.ok(r && rel[rel.indexOf(r) - 1].version === '2.0.0', '1.22.0 is the release before 2.0.0');
  assert.ok(r.date <= rel[0].date, '2.0.0 is dated on or after 1.22.0');
  assert.deepStrictEqual(r.changes.map(c => c.kind), ['new', 'new']);
  const text = JSON.stringify(r);
  assert.ok(/Checklist details/.test(text) && /Remove section/.test(text) && /note/.test(text), 'the builder change');
  assert.ok(/Back and Forward/.test(text) && /closes an open dialog first/.test(text) && /never loses what you typed/.test(text), text);
  assert.ok(!/colour|cancelled|behaviour|\bAI\b|assistant/i.test(text), 'US English, and no tool named');
});

run();
