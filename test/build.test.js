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

const runList = (env) => cp.spawnSync('bash', [path.join(__dirname, 'run.sh')], { encoding: 'utf8', env: Object.assign({}, process.env, { LIST: '1', TIER: '', ONLY: '', RULE: '' }, env) });
const hasBash = !cp.spawnSync('bash', ['--version']).error;

/* A budget() call as a file makes it: first on its line at any indent, or a callback's body (a loop that registers several). */
const registersBudget = src => /^\s*budget\(|=>\s*budget\(/m.test(src);

rule('test/run.sh runs every test file in test/, once, with every shard of a split file, and the speed budgets of every file that has any', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'run.sh'), 'utf8');
  const jobs = /<<'JOBS_LIST'[^\n]*\n([\s\S]*?)\nJOBS_LIST\n/.exec(sh), budgets = /^(?:export )?BUDGET_FILES="((?:test\/[\w.-]+\.test\.js ?)+)"$/m.exec(sh), left = /^FAST_LEAVES_OUT="([\w. -]*)"$/m.exec(sh);
  assert.ok(jobs && budgets && left, 'test/run.sh has its JOBS_LIST, its BUDGET_FILES and its FAST_LEAVES_OUT');
  const seen = {};
  jobs[1].split('\n').forEach((l) => {
    const m = /^test\/([\w.-]+\.test\.js) (-|(\d+)\/(\d+))$/.exec(l);
    assert.ok(m, 'a job line is "test/<file> -" or "test/<file> i/n": ' + JSON.stringify(l));
    (seen[m[1]] = seen[m[1]] || []).push(m[2]);
  });
  Object.keys(seen).forEach((f) => {
    const s = seen[f];
    if (s.length === 1 && s[0] === '-') return;
    const n = +(s[0].split('/')[1] || 0), want = Array.from({ length: n }, (_, i) => i + '/' + n);
    assert.deepStrictEqual(s.slice().sort((a, b) => parseInt(a, 10) - parseInt(b, 10)), want, f + ' runs once whole, or once per shard of one split');
  });
  const files = fs.readdirSync(__dirname).filter(f => /\.test\.js$/.test(f));
  assert.deepStrictEqual(files.filter(f => !seen[f]), [], 'add these to test/run.sh');
  /* A budget rule runs only in the quiet pass, so a file with one that isn't listed would lose it. */
  const timed = files.filter(f => registersBudget(fs.readFileSync(path.join(__dirname, f), 'utf8'))).sort();
  assert.deepStrictEqual(budgets[1].trim().split(' ').map(f => f.slice(5)).sort(), timed, 'BUDGET_FILES lists exactly the files with budget() rules');
  left[1].trim().split(/\s+/).filter(Boolean).forEach(n => assert.ok(seen[n + '.test.js'], 'FAST_LEAVES_OUT names a file with jobs: ' + n));
});

rule('test/run.sh: fast, rest and perf together are exactly the full run, and ONLY picks just the jobs it names or refuses', () => {
  if (!hasBash) return console.log('  (skipped: no bash)');
  const list = (env) => { const r = runList(env); assert.strictEqual(r.status, 0, r.stderr); return r.stdout.split('\n').filter(Boolean); };
  const full = list({}), fast = list({ TIER: 'fast' }), rest = list({ TIER: 'rest' }), perf = list({ TIER: 'perf' });
  assert.ok(fast.length > 0 && rest.length > 0 && perf.length > 0, 'each tier has jobs');
  assert.deepStrictEqual(fast.concat(rest, perf).sort(), full.slice().sort(), 'nothing is left out or run twice');
  assert.ok(perf.every(j => / budgets$/.test(j)) && !fast.concat(rest).some(j => / budgets$/.test(j)), 'budgets run only in the quiet pass');
  assert.deepStrictEqual(list({ ONLY: 'rules' }), ['test/rules.test.js -']);
  assert.strictEqual(list({ ONLY: 'test/app.test.js' }).length, 12, 'a file is every shard');
  assert.deepStrictEqual(list({ ONLY: 'app.2of12,rules.test.js' }), ['test/app.test.js 2/12', 'test/rules.test.js -']);
  assert.deepStrictEqual(list({ ONLY: 'perf.budgets' }), ['test/perf.test.js budgets']);
  assert.deepStrictEqual(list({ ONLY: 'perf' }), ['test/perf.test.js -', 'test/perf.test.js budgets'], 'a file is all of it');
  assert.strictEqual(runList({ ONLY: 'nothing-called-this' }).status, 2, 'a name no job has is an error, never a pass');
  assert.strictEqual(runList({ TIER: 'nope' }).status, 2, 'so is a tier that doesn\'t exist');
});

rule('A budget() registered inside a loop counts as a file with budgets, and test/run.sh refuses a file with budgets it doesn\'t list', () => {
  const call = 'budget' + "('n', () => {})";   // split so this file doesn't look like it registers one
  assert.ok(registersBudget("[1, 2].forEach(n => {\n  " + call + ";\n});"), 'indented, in a loop');
  assert.ok(registersBudget("[1, 2].forEach(n => " + call + ");"), 'as a callback');
  assert.ok(!registersBudget("const { budget } = require('./harness');\nrule('within budget', () => {});"), 'naming it isn\'t registering one');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-budget-')), f = path.join(dir, 'looped.test.js');
  fs.writeFileSync(f, "const { budget, run } = require(" + JSON.stringify(path.join(__dirname, 'harness')) + ");\n[1, 2].forEach(n => {\n  budget('looped ' + n, () => {});\n});\nrun();\n");
  const go = (env) => cp.spawnSync(process.execPath, [f], { encoding: 'utf8', env: Object.assign({}, process.env, { ONLY: '', SHARD: '' }, env) });
  const off = go({ BUDGETS: 'skip', BUDGET_FILES: 'test/perf.test.js' });
  assert.strictEqual(off.status, 1, off.stdout);
  assert.ok(/isn't in BUDGET_FILES/.test(off.stdout), off.stdout);
  const on = go({ BUDGETS: 'only', BUDGET_FILES: 'test/perf.test.js ' + f });
  assert.strictEqual(on.status, 0, on.stdout);
  assert.ok(/^2 passed, 0 failed/m.test(on.stdout), on.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* test/run.sh with node standing in for one file, which exits with the codes listed, one per attempt, and counts its attempts.
   "F1" prints a FAIL line first, "E0" exits with no results line, "Z0" says no rule ran. busy sets what the machine counts as (PERF_BUSY=0 or 100); sampler makes the load sampler
   fail ("fail") or print nonsense ("junk"). */
function runnerWith(c) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-runner-'));
  const shim = '#!/usr/bin/env bash\n' +
    'case "$1" in\n' +
    '  test/timeline.test.js) echo x >> "$SHIM_DIR/$BUDGETS.ran"; q="$SHIM_DIR/$BUDGETS"; c="$(head -n 1 "$q" 2>/dev/null)"; if [ -n "$c" ]; then tail -n +2 "$q" > "$q.n"; mv "$q.n" "$q"; fi; c="${c:-0}"\n' +
    '    case "$c" in F*) echo "FAIL: a rule"; c="${c#F}";; E*) exit "${c#E}";; Z*) echo "0 passed, 0 failed"; exit "${c#Z}";; esac; echo "1 passed, 0 failed"; exit "$c";;\n' +
    '  tools/old-bundles.js) exit 0;;\n' +
    '  test/machine-load.js) case "${SHIM_SAMPLER:-}" in fail) exit 127;; junk) echo "no idea"; exit 0;; esac;;\n' +
    'esac\nexec "$SHIM_REAL" "$@"\n';
  fs.writeFileSync(path.join(dir, 'node'), shim, { mode: 0o755 });
  Object.keys(c.codes || {}).forEach(k => fs.writeFileSync(path.join(dir, k), c.codes[k].join('\n') + '\n'));
  const env = Object.assign({}, process.env, { PATH: dir + path.delimiter + process.env.PATH, SHIM_DIR: dir, SHIM_REAL: process.execPath, SHIM_SAMPLER: c.sampler || '', SKIP_BUILD: '1', ONLY: 'timeline', TIER: '', RULE: '', LIST: '', TIMES: '', KEEP_LOGS: '', BUDGETS: '', SHARD: '', PERF_WAIT: '0', PERF_BUSY: c.busy ? '0' : '100' });
  const ran = (k) => { try { return fs.readFileSync(path.join(dir, k + '.ran'), 'utf8').split('\n').filter(Boolean).length; } catch (e) { return 0; } };
  return new Promise((res) => {
    let out = '';
    const p = cp.spawn('bash', [path.join(__dirname, 'run.sh')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('close', code => { const got = { code, out, budgetRuns: ran('only'), plainRuns: ran('skip') }; fs.rmSync(dir, { recursive: true, force: true }); res(got); });
  });
}
rule('test/run.sh: the only failure that can end in exit 0 is a segfault with no rule failed in a parallel job that then passes every rule', async () => {
  if (!hasBash) return console.log('  (skipped: no bash)');
  const miss = /SPEED BUDGET RULES FAILED[^\n]*may be the load[^\n]*TIER=perf on a quiet machine[^\n]*\n  machine before the pass: (quiet|busy): [^\n]*\n  machine after the pass: (quiet|busy): /;
  const unknown = /machine before the pass: unknown\n  machine after the pass: unknown/;
  /* name, settings, exit, how many times the budget job and the parallel job run, what the output says */
  const cases = [
    ['every attempt passing', {}, 0, 1, 1],
    ['a segfault with no rule failed, then a full pass', { codes: { skip: [139, 0] } }, 0, 1, 2, /NODE CRASHED \(not a test failure\):\n.*exit 139/],
    ['a time miss on a busy machine, which the next try would meet', { busy: true, codes: { only: ['F1', 0] } }, 1, 1, 1, miss],
    ['a time miss on a quiet machine, which the next try would meet', { codes: { only: ['F1', 0] } }, 1, 1, 1, miss],
    ['a failed check in a budget job, which the next try would pass', { busy: true, codes: { only: [1, 0] } }, 1, 1, 1, miss],
    ['a crash in a budget job, on a busy machine', { busy: true, codes: { only: [139, 0] } }, 1, 1, 1, miss],
    ['a crash in a budget job, on a quiet machine', { codes: { only: [139, 0] } }, 1, 1, 1, miss],
    ['the old exit 3 from a budget job, on a busy machine', { busy: true, codes: { only: [3, 0] } }, 1, 1, 1, miss],
    ['a budget miss with the load sampler failing', { sampler: 'fail', codes: { only: ['F1', 0] } }, 1, 1, 1, unknown],
    ['a budget miss with the load sampler printing nonsense', { sampler: 'junk', codes: { only: ['F1', 0] } }, 1, 1, 1, unknown],
    ['a failing load sampler when every budget is met', { sampler: 'fail' }, 0, 1, 1, /speed budgets: machine unknown/],
    ['an ordinary rule failing, then passing alone', { codes: { skip: [1, 0] } }, 1, 1, 2, /the failure stands/],
    ['exit 3 from an ordinary job, then a pass', { codes: { skip: [3, 0] } }, 1, 1, 2],
    ['a segfault after a rule failed, then a pass', { codes: { skip: ['F139', 0] } }, 1, 1, 2],
    ['a segfault, then a failure', { codes: { skip: [139, 1] } }, 1, 1, 2],
    ['a segfault twice', { codes: { skip: [139, 139] } }, 1, 1, 2],
    ['another signal, then a pass', { codes: { skip: [134, 0] } }, 1, 1, 2],
    ['a failed rule with exit 0', { codes: { skip: ['F0', 0] } }, 1, 1, 2],
    ['a segfault, then a rerun with exit 0 and no results', { codes: { skip: [139, 'E0'] } }, 1, 1, 2],
    ['a segfault, then a rerun where no rule ran', { codes: { skip: [139, 'Z0'] } }, 1, 1, 2]
  ];
  const got = await Promise.all(cases.map(c => runnerWith(c[1])));
  cases.forEach((c, i) => {
    assert.strictEqual(got[i].code, c[2], c[0] + ': exit ' + got[i].code + '\n' + got[i].out);
    assert.strictEqual(got[i].budgetRuns, c[3], c[0] + ': budget job ran ' + got[i].budgetRuns + ' times');
    assert.strictEqual(got[i].plainRuns, c[4], c[0] + ': parallel job ran ' + got[i].plainRuns + ' times');
    if (c[5]) assert.ok(c[5].test(got[i].out), c[0] + ': says so\n' + got[i].out);
  });
});

rule('A rule that never settles fails the file instead of ending it with exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-hung-')), f = path.join(dir, 'hung.test.js');
  fs.writeFileSync(f, 'const { rule, run } = require(' + JSON.stringify(path.join(__dirname, 'harness')) + ');\nrule("hangs", () => new Promise(() => {}));\nrule("never reached", () => {});\nrun();\n');
  const r = cp.spawnSync(process.execPath, [f], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/FAIL: stopped before every rule had run/.test(r.stdout), r.stdout);
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


/* Two function declarations with one name in one scope: the later silently replaces the earlier everywhere in that scope
   (2.11: a list heading's helper and the attachment reader's were both headOf, so a heading lookup got a Promise). */
function dupDecls(src) {
  const KW = /^(return|typeof|case|in|of|delete|void|new|throw|else|do|instanceof|yield|await)$/;
  const scopes = [{ names: Object.create(null) }], stack = [], out = [];
  let i = 0, line = 1, prev = null, prev2 = null, pendingFn = false;
  const tok = (t) => { prev2 = prev; prev = t; };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); for (let k = i; k < e; k++) if (src[k] === '\n') line++; i = e + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      i++; while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; else if (src[i] === '\n') line++; i++; }
      i++; tok('str'); continue;
    }
    if (c === '/' && !(prev && (/^[\w$]+$/.test(prev) && !KW.test(prev) || prev === ')' || prev === ']' || prev === 'str'))) {
      i++; let cls = false;
      while (i < src.length && (cls || src[i] !== '/')) { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; }
      i++; while (/[a-z]/.test(src[i] || '')) i++; tok('str'); continue;
    }
    const w = /^[A-Za-z_$][\w$]*|^\d[\w.]*/.exec(src.slice(i, i + 200));
    if (w) {
      const t = w[0];
      if (prev === 'function' && /^[A-Za-z_$]/.test(t) && (prev2 === null || prev2 === ';' || prev2 === '{' || prev2 === '}')) {
        const s = scopes[scopes.length - 1];
        if (s.names[t]) out.push({ name: t, first: s.names[t], line: line }); else s.names[t] = line;
      }
      if (t === 'function') pendingFn = true;
      i += t.length; tok(t); continue;
    }
    if (c === '{') { if (pendingFn) { scopes.push({ names: Object.create(null) }); stack.push('fn'); pendingFn = false; } else stack.push('blk'); }
    else if (c === '}') { if (stack.pop() === 'fn') scopes.pop(); }
    i++; tok(c);
  }
  if (stack.length) throw new Error('unbalanced braces: ' + stack.length + ' open');
  return out;
}
rule('no source file declares two functions with one name in one scope', () => {
  const sample = "function a() {}\nfunction b() { function a() {} var s = '{ function b() {}', r = /}{/g; /* function b() {} */ }\n" +
    "var o = { a: function a() {} };\nif (x) { y(); }\nfunction a() { return 1 / 2; }\n";
  assert.deepStrictEqual(dupDecls(sample).map(d => [d.name, d.first, d.line]), [['a', 1, 5]], 'the check finds a real repeat, and only that');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
  const found = walk(path.join(ROOT, 'src')).flatMap(f => dupDecls(fs.readFileSync(f, 'utf8')).map(d => path.relative(ROOT, f) + ': ' + d.name + ' (lines ' + d.first + ' and ' + d.line + ')'));
  assert.deepStrictEqual(found, []);
});

run();
