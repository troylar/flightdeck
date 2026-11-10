// The differential corpus (4.0, slice 6, LA): every run a living run's work depends on, in each of its three roles, mutated
// one place at a time (test/run-corpus.js). The app's verdict on each (readRunOnly, then repo.depVerdict, whose run part is
// PF.appjson.judgeRun) and the pack reader's (test/run_verdict.py, which test/check_pack.py asks) must be the same: both
// accept, or both refuse at the same first path. The export says the same on a sample of them, and the pack reader holds a
// pack that claims more than its export did to it.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { rule, run } = require('./harness');
const { BytesFS } = require('./evidence-fixture');
const { pack, PY, checkPack, repacked, forced, roleWorlds } = require('./living-worlds');
const C = require('./run-corpus');

let built = null;
async function corpus() {
  if (built) return built;
  const roles = await C.build(), cases = [], worlds = [];
  for (const R of roles) {
    const files = {};
    Object.keys(R.X.files).forEach((p) => { if (/^(publications|staged)\//.test(p) || (p.indexOf('runs/' + R.X.depKey + '/') === 0 && p !== R.X.path)) files[p] = String(R.X.files[p]); });
    worlds.push({ world: R.X.role, files });
    for (const c of R.cases) {
      const text = c.text || JSON.stringify(c.run, null, 2);
      const v = await C.jsVerdict(R.X.PF, Object.assign({}, R.X.files, { [R.X.path]: text }), R.X.depKey);
      cases.push({ id: cases.length, role: R.X.role, key: R.X.depKey, name: c.name, text, js: v, R });
    }
  }
  built = { roles, cases, worlds };
  return built;
}
function pyVerdicts(worlds, cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-corpus-')), file = path.join(dir, 'cases.jsonl');
  try {
    fs.writeFileSync(file, worlds.map((w) => JSON.stringify(w)).concat(cases.map((c) => JSON.stringify({ id: c.id, world: c.role, key: c.key, text: c.text }))).join('\n') + '\n');
    const out = cp.execFileSync(PY, ['-I', path.join(__dirname, 'check_pack.py'), '--verdicts', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const by = {};
    out.split('\n').filter(Boolean).forEach((l) => { const x = JSON.parse(l); by[x.id] = x; });
    return by;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

rule('the corpus mutates every place of a dependency run in all three roles, and each base run holds', async () => {
  const { roles, cases } = await corpus();
  assert.strictEqual(roles.length, 4);
  assert.deepStrictEqual(roles.map((R) => R.X.role).join(), 'child,fulfills,evidence,full');
  roles.forEach((R) => {
    const mine = cases.filter((c) => c.role === R.X.role);
    assert.ok(mine.length > 500, R.X.role + ': ' + mine.length + ' cases');
    assert.strictEqual(mine[0].name, 'as written');
    assert.strictEqual(mine[0].js, null, R.X.role + "'s base run holds: " + JSON.stringify(mine[0].js));
    ['steps', 'gates', 'followUps', 'pauses', 'roles', 'fields', 'marks', 'recorder', 'log', 'details'].forEach((f) => assert.ok(mine.some((c) => c.name.indexOf(f + '.') === 0), R.X.role + ' mutates inside ' + f));
    assert.ok(mine.some((c) => /\(dropped\)$/.test(c.name)) && mine.some((c) => /: an unknown key$/.test(c.name)), R.X.role + ' has the drops and the unknown keys');
    assert.ok(mine.some((c) => !c.js) && mine.some((c) => c.js), R.X.role + ' has cases both ways');
  });
});

rule('a time in any form but the one the app writes (toISOString, within the date range) is malformed in every role, wherever it is', async () => {
  /* A loop approval's "at" is part of its snapshot, kept as text (PF.loop.cleanSnapshot): never read as a time. */
  const { cases } = await corpus(), off = cases.filter((c) => /\(not the written form\)$/.test(c.name) && !/\.loop\.at:/.test(c.name) && !c.js);
  assert.ok(cases.filter((c) => /\(not the written form\)$/.test(c.name)).length > 100, 'the corpus tries them');
  assert.strictEqual(off.length, 0, off.length + ' accepted:\n  ' + off.slice(0, 30).map((c) => c.role + ' · ' + c.name).join('\n  '));
});

/* PA: a dependency run is confirmed only as the app writes it. The reviewers' cases are in the corpus, in every role: a value
   kept after a table lookup given as a list, a number too big to be finite and every team value the validator refuses are
   malformed; a valid team value and the documented allowances (a missing key the cleaner fills in) hold. */
rule('a dependency run is confirmed only as the app writes it: the reviewers\' cases are malformed in every role, their controls hold', async () => {
  const { cases } = await corpus(), roles = [...new Set(cases.map((c) => c.role))], bad = [];
  const want = (name, refused, some) => {
    const mine = cases.filter((c) => c.name === name);
    if (!mine.length) { if (!some) bad.push('missing: ' + name); return; }
    mine.forEach((c) => { if (!!c.js !== refused) bad.push(c.role + ' · ' + name + ': ' + (c.js ? 'refused at ' + c.js.path + ' (' + c.js.why + ')' : 'held')); });
  };
  ['(reviewer) state: a list', '(reviewer) a step\'s s: a list', '(reviewer) the outcome: a list', '(reviewer) version: 1e999', '(reviewer) rev: 1e999', '(reviewer) a step\'s by: null',
    '(reviewer) snapshot: only U+0085', '(reviewer) snapshot: only U+001C'].forEach((n) => want(n, true));
  ['(reviewer) a gate\'s was: a list', '(reviewer) a loop approval\'s count: 1e999', '(reviewer) team value: over 120 characters', '(reviewer) team value: empty', '(reviewer) team value: padded',
    '(reviewer) team value: padded with U+FEFF', '(reviewer) team value: a control character', '(reviewer) team value: DEL'].forEach((n) => want(n, true, true));
  ['title: missing (filled in)', 'state: missing (filled in)', 'a pause left on an ended run (dropped)', 'an earlier answer\'s "done differently" with who and when (dropped)', '(reviewer) team value: valid', '(reviewer) team value: 120 characters', '(reviewer) team value: padded with U+0085 (not JavaScript white space)'].forEach((n) => want(n, false, true));
  assert.ok(cases.some((c) => c.name === '(reviewer) team value: valid'), 'a run with a team-value link is in the corpus');
  assert.ok(cases.some((c) => c.name === '(reviewer) a loop approval\'s count: 1e999'), 'a loop approval is in the corpus');
  assert.strictEqual(bad.length, 0, bad.join('\n  '));
  console.log('    ' + cases.filter((c) => /^\(reviewer\)/.test(c.name)).length + ' reviewer cases over ' + roles.length + ' roles');
});

/* RF: with a conflict copy beside the run as well, the pack reader names the first problem depVerdict names: a newer run or
   records it can't keep first, then the conflict copies, then why it's read-only, then anything not as the app writes it. */
rule('with a conflict copy beside it too, the pack reader names the same first problem as depVerdict, in its order', async () => {
  if (!PY) { console.log('    (skipped: no Python)'); return; }
  const { roles, cases, worlds } = await corpus(), more = [], mw = [];
  for (const R of roles) {
    const w = worlds.filter((x) => x.world === R.X.role)[0], conflict = 'runs/' + R.X.depKey + '/run.conflict-w1.json', files = Object.assign({}, w.files, { [conflict]: R.X.files[R.X.path] });
    mw.push({ world: R.X.role + '+conflict', files });
    const mine = cases.filter((c) => c.role === R.X.role), pick = mine.filter((c, i) => /^\(reviewer\)|: null$|: an unknown key$|: empty$/.test(c.name) || i % 25 === 0);
    for (const c of pick) {
      const js = await C.jsVerdict(R.X.PF, Object.assign({}, R.X.files, { [R.X.path]: c.text, [conflict]: R.X.files[R.X.path] }), R.X.depKey);
      more.push({ id: more.length, role: R.X.role + '+conflict', key: c.key, name: c.name, text: c.text, js });
    }
  }
  const py = pyVerdicts(mw, more), off = [];
  more.forEach((c) => { const p = py[c.id], jp = c.js ? c.js.path : null; if (!p || p.path !== jp) off.push(c.role + ' · ' + c.name + ': the app ' + (jp || 'holds') + ', Python ' + (p ? p.path || 'holds' : 'nothing') + (p && p.why ? ' (' + p.why + ')' : '')); });
  assert.ok(more.some((c) => c.js && /\/$/.test(c.js.path)) && more.some((c) => c.js && /run\.json$/.test(c.js.path)), 'both orders are tried');
  console.log('    ' + more.length + ' cases with a conflict copy beside');
  assert.strictEqual(off.length, 0, off.length + ' differ:\n  ' + off.slice(0, 30).join('\n  '));
});

/* RA: every run a shipped fixture holds (its run files, saves and the runs inside a fixture file) is canonical, in the app and
   in the pack reader: a run from a newer Flightdeck, read by name only, is refused as newer before this rule applies. */
rule('every run in a shipped fixture is exactly as the app writes it, in the app and in the pack reader', async () => {
  const PF = require('./harness').load(), root = path.join(__dirname, '..'), runs = [], names = [];
  const files = cp.execFileSync('git', ['ls-files', 'test/fixtures', 'example-folder'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => /\.json$/.test(f));
  const walk = (v, where) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, where + '[' + i + ']')); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.format === 'string' && /^preflight-run\//.test(v.format) && v.steps && typeof v.id === 'string') {
      const r = PF.run.sanitize(JSON.parse(JSON.stringify(v)));
      if (r && !PF.appjson.newerRun(r)) { runs.push(v); names.push(where); }
      return;
    }
    Object.keys(v).forEach((k) => walk(v[k], where + '.' + k));
  };
  files.forEach((f) => { let o; try { o = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch (e) { return; } walk(o, f); });
  assert.ok(runs.length > 150 && names.some((n) => /run-vocabulary-1\.11\.json/.test(n)), 'the fixtures are found: ' + runs.length);
  const js = runs.map((o) => PF.run.canonical(JSON.parse(JSON.stringify(o)))), off = [];
  js.forEach((c, i) => { if (c) off.push('the app: ' + names[i] + ' at ' + c); });
  if (PY) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-canon-')), file = path.join(dir, 'runs.json');
    try { fs.writeFileSync(file, JSON.stringify(runs)); JSON.parse(cp.execFileSync(PY, ['-I', path.join(__dirname, 'check_pack.py'), '--canonical', file], { encoding: 'utf8', maxBuffer: 1 << 26 })).forEach((c, i) => { if (c) off.push('Python: ' + names[i] + ' at ' + c); }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  console.log('    ' + runs.length + ' runs in shipped fixtures');
  assert.deepStrictEqual(off, []);
});

rule('the pack reader gives every case in the corpus the verdict the app gives it: accepted, or refused at the same first path', async () => {
  if (!PY) { console.log('    (skipped: no Python)'); return; }
  const { cases, worlds } = await corpus(), py = pyVerdicts(worlds, cases), off = [];
  cases.forEach((c) => {
    const p = py[c.id], want = c.js ? c.js.path : null, got = p ? p.path : 'no answer';
    if (want !== got) off.push(c.role + ' · ' + c.name + ': the app ' + (want ? 'refuses at ' + want + ' (' + c.js.kind + ')' : 'accepts') + ', Python ' + (got ? 'refuses at ' + got + ' (' + (p && p.why) + ')' : 'accepts'));
  });
  const tally = {};
  cases.forEach((c) => { const t = tally[c.role] = tally[c.role] || { cases: 0, refused: 0 }; t.cases++; if (c.js) t.refused++; });
  console.log('    ' + cases.length + ' cases: ' + Object.keys(tally).map((k) => k + ' ' + tally[k].cases + ' (' + tally[k].refused + ' refused)').join(', '));
  assert.strictEqual(off.length, 0, off.length + ' of ' + cases.length + ' cases differ:\n  ' + (process.env.CORPUS_ALL ? off : off.slice(0, 40)).join('\n  ') + (off.length > 40 && !process.env.CORPUS_ALL ? '\n  …' : ''));
});

/* The export and the pack reader on a sample: the first accepted and the first refused case of every top-level field in each role, every drop and fill-in,
   and every case refused anywhere but the run file. The export names the run (or its version) exactly when the app refuses
   it, and a pack made to claim the work complete is refused by Python exactly then. Conflict copies beside a run aren't
   packed, so those cases are the export's alone. */
rule('the export names a dependency exactly when the app refuses it, and Python holds a complete claim to the same verdict, on a sample of every field in every role', async () => {
  const { roles, cases } = await corpus(), off = [], seen = new Set();
  const sample = cases.filter((c) => {
    const top = c.role + '|' + c.name.replace(/^\(ended\) /, 'ended:').split(/[.:]/)[0] + '|' + !!c.js;
    const pick = !seen.has(top) || /\((dropped|filled in)\)$/.test(c.name) || (c.js && !/\/run\.json$/.test(c.js.path));
    seen.add(top);
    return pick;
  });
  /* The full world (every field family) is the readers' alone: it isn't a dependency of a living run here. */
  for (const R of roles.filter((x) => x.X.role !== 'full')) {
    const X = R.X, base = await pack(X.PF, new BytesFS(Object.assign({}, X.files, { [X.path]: JSON.stringify(R.base, null, 2) })), X.key);
    for (const c of sample.filter((x) => x.role === X.role)) {
      const { zip, res } = await pack(X.PF, new BytesFS(Object.assign({}, X.files, { [X.path]: c.text })), X.key);
      const named = res.col.unresolved.filter((u) => c.js ? u.indexOf(c.js.path) >= 0 : u.indexOf(X.depKey + '/') >= 0 || u.indexOf('/' + JSON.parse(c.text).folder + '/') >= 0);
      if (!!c.js !== !!named.length) off.push(X.role + ' · ' + c.name + ': the app ' + (c.js ? 'refuses at ' + c.js.path : 'accepts') + ', the export names ' + JSON.stringify(named).slice(0, 200));
      if (!PY || (c.js && c.js.kind === 'conflict')) continue;
      const claim = c.js ? await repacked(X.PF, base.zip, (e, man, f) => { e[f(X.path).pack] = Buffer.from(c.text); forced(man); }) : X.force ? await repacked(X.PF, zip, (e, man) => forced(man)) : zip;
      const py = checkPack(claim);
      if (py.ok === !!c.js) off.push(X.role + ' · ' + c.name + ': the app ' + (c.js ? 'refuses at ' + c.js.path : 'accepts') + ', Python ' + (py.ok ? 'accepts a complete claim' : 'refuses: ' + py.out.trim().slice(0, 200)));
    }
  }
  console.log('    ' + sample.length + ' sampled cases through the export');
  assert.strictEqual(off.length, 0, off.length + ' differ:\n  ' + off.slice(0, 40).join('\n  '));
});

/* NC: a test run's dependency on its stage is verified in full by both readers, as PF.publish.verify with stage: the envelope,
   the hashes and payload, the stage record (folder, proposed number, who and when) and what the checklist uses, never only that
   its three files are there. */
rule('a test run\'s staged version is verified in full by the app and Python alike: every damaged stage file is refused at the same path', async () => {
  const X = (await roleWorlds()).find((w) => w.role === 'fulfills'), PF = X.PF, P = PF.publish;
  const r = JSON.parse(X.files[X.path]), md = String(X.files['publications/' + r.process + '/' + r.folder + '/map.md']);
  const b = P.build(md, { by: 'person-avery', changes: 'Try it', now: '2026-11-01T10:00:00.000Z', stage: true, existing: [{ version: r.version }], rand: 'abcd1234', app: '4.0.0' });
  const bytes = (t) => new Uint8Array(Buffer.from(t, 'utf8'));
  const pub = P.verify(b.folder, b.files, P.exactOf({ 'map.md': bytes(b.files['map.md']), 'types.json': bytes(b.files['types.json']) }), { stage: true });
  assert.ok(pub.ok, pub.why);
  const t = PF.run.create(pub, { id: r.id, test: true, title: 'Try it', roles: r.roles, by: 'person-avery', session: 's-1', now: '2026-11-01T10:05:00.000Z', tz: 'UTC', app: '4.0.0', details: r.details });
  const own = {}; Object.keys(t).forEach((k) => { if (k[0] !== '_') own[k] = t[k]; });
  const text = JSON.stringify(own, null, 2), dir = 'staged/' + r.process + '/' + b.folder + '/', info = JSON.parse(b.files['publication.json']);
  const variants = [['as staged', {}]];
  const rec = (name, f) => { const o = JSON.parse(JSON.stringify(info)); f(o); variants.push([name, { 'publication.json': JSON.stringify(o, null, 2) }]); };
  variants.push(['map.md edited', { 'map.md': md + '\nEdited.\n' }], ['types.json edited', { 'types.json': b.files['types.json'] + ' ' }], ['map.md missing', { 'map.md': null }], ['publication.json not JSON', { 'publication.json': '{' }]);
  rec('payload map hash wrong', (o) => { o.payload.map = '0'.repeat(64); });
  rec('payload types hash wrong', (o) => { o.payload.types = '0'.repeat(64); });
  rec('stagedBy missing', (o) => { delete o.stagedBy; });
  rec('stagedAt missing', (o) => { delete o.stagedAt; });
  rec('stage missing', (o) => { delete o.stage; });
  rec('stage.proposed not a number', (o) => { o.stage.proposed = '2'; });
  rec('stage.proposed 0', (o) => { o.stage.proposed = 0; });
  rec('a version number', (o) => { o.version = 2; });
  rec('another folder', (o) => { o.folder = 'stage-zzzz9999'; });
  rec('staged not listed', (o) => { o.features = o.features.filter((f) => f !== 'staged'); });
  rec('a feature this copy doesn\'t know', (o) => { o.features = o.features.concat(['zz-later']); });
  rec('format /1', (o) => { o.format = 'preflight-publication/1'; delete o.features; });
  rec('mapHash wrong', (o) => { o.mapHash = '00000000'; });
  rec('another process', (o) => { o.process = 'other-proc'; });
  const worlds = [], cases = [];
  for (const [name, change] of variants) {
    const files = Object.assign({}, X.files, { [X.path]: text });
    Object.keys(b.files).forEach((n) => { files[dir + n] = b.files[n]; });
    Object.keys(change).forEach((n) => { if (change[n] == null) delete files[dir + n]; else files[dir + n] = change[n]; });
    const js = await C.jsVerdict(PF, files, X.depKey), w = {};
    Object.keys(files).forEach((p) => { if (/^(publications|staged)\//.test(p) || (p.indexOf('runs/' + X.depKey + '/') === 0 && p !== X.path)) w[p] = String(files[p]); });
    worlds.push({ world: 'stage-' + cases.length, files: w });
    cases.push({ id: cases.length, role: 'stage-' + cases.length, key: X.depKey, name, text, js });
  }
  assert.strictEqual(cases[0].js, null, 'the test run on its stage holds: ' + JSON.stringify(cases[0].js));
  assert.ok(cases.slice(1).every((c) => c.js), 'the app refuses every damaged stage: ' + cases.filter((c) => !c.js).map((c) => c.name).join(', '));
  if (!PY) return;
  const py = pyVerdicts(worlds, cases), off = [];
  cases.forEach((c) => { const p = py[c.id], want = c.js ? c.js.path : null, got = p ? p.path : 'no answer'; if (want !== got) off.push(c.name + ': the app ' + (want ? 'refuses at ' + want : 'accepts') + ', Python ' + (got ? 'refuses at ' + got + ' (' + (p && p.why) + ')' : 'accepts')); });
  assert.strictEqual(off.length, 0, off.join('\n  '));
});

/* NA: every place of a run file the app's cleaner reads (PF.run.sanitize and PF.run.repairs, through a proxy that records each
   key and index read), the pack reader's port reads too (test/run_verdict.py, through a tracked copy of the same file). It
   runs on every role's run as written and ended, each holding a valid value of every field, so a field the app checks and
   Python passes over fails here by name. */
const SKIP = new Set(Object.getOwnPropertyNames(Object.prototype).concat(Object.getOwnPropertyNames(Array.prototype), ['toJSON']));
function jsReads(PF, text) {
  const seen = new Set();
  const wrap = (v, at) => {
    if (!v || typeof v !== 'object') return v;
    const name = (t, k) => Array.isArray(t) && /^(0|[1-9]\d*)$/.test(k) ? at + '[' + k + ']' : at ? at + '.' + k : k;
    const rec = (t, k) => { if (typeof k === 'string' && !(Array.isArray(t) && k === 'length') && !(SKIP.has(k) && !Object.prototype.hasOwnProperty.call(t, k))) seen.add(name(t, k)); };
    /* Listing keys (Object.keys, JSON.stringify) asks each key's descriptor right after ownKeys: that isn't a read of it. */
    let listing = new Set();
    return new Proxy(v, {
      get(t, k) { rec(t, k); const x = t[k]; return typeof k === 'string' && Object.prototype.hasOwnProperty.call(t, k) ? wrap(x, name(t, k)) : x; },
      has(t, k) { rec(t, k); return k in t; },
      ownKeys(t) { const ks = Reflect.ownKeys(t); listing = new Set(ks); return ks; },
      getOwnPropertyDescriptor(t, k) { if (listing.has(k)) listing.delete(k); else rec(t, k); return Object.getOwnPropertyDescriptor(t, k); }
    });
  };
  const o = wrap(JSON.parse(text), '');
  PF.run.sanitize(o); PF.run.repairs(o);
  return seen;
}
function pyReads(cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-cover-')), file = path.join(dir, 'cases.jsonl');
  try {
    fs.writeFileSync(file, cases.map((c) => JSON.stringify({ id: c.id, text: c.text })).join('\n') + '\n');
    const out = cp.execFileSync(PY, ['-I', path.join(__dirname, 'check_pack.py'), '--coverage', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const by = {};
    out.split('\n').filter(Boolean).forEach((l) => { const x = JSON.parse(l); by[x.id] = new Set(x.read); });
    return by;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
rule('coverage: every place of a run file the app\'s cleaner reads, the pack reader\'s port reads too (no field left unmirrored)', async () => {
  if (!PY) { console.log('    (skipped: no Python)'); return; }
  const { cases } = await corpus(), pick = cases.filter((c) => c.name === 'as written' || c.name === 'a pause left on an ended run (dropped)');
  assert.strictEqual(pick.length, 8, 'every role, as written and ended');
  const py = pyReads(pick), off = new Set(), all = new Set();
  pick.forEach((c) => {
    const js = jsReads(c.R.X.PF, c.text), p = py[c.id] || new Set();
    [...p].filter((x) => x.indexOf('!crash') === 0).forEach((x) => off.add(c.role + ': Python ' + x));
    js.forEach((x) => { all.add(x.replace(/\[\d+\]/g, '[]')); if (!p.has(x)) off.add(x.replace(/\[\d+\]/g, '[]')); });
  });
  /* Read by the app's cleaner, but never to decide anything: each named with why, and each mutated by the corpus above (the
     parity rule holds every mutation of it to the same verdict). */
  const NO_VERDICT = [[/^types\.[^.]+(\.[^.]+)?\.fields\.[^.]+\.required$/, 'PF.types.checkFields reads it only for an editor tip; unrunnable reads its errors']];
  NO_VERDICT.forEach(([re]) => { const hit = [...off].filter((x) => re.test(x)); hit.forEach((x) => off.delete(x)); assert.ok(!hit.length || cases.some((c) => re.test(c.name.split(':')[0])), re + ' is mutated by the corpus'); });
  console.log('    ' + all.size + ' places the cleaner reads, over ' + pick.length + ' runs (' + NO_VERDICT.length + ' pattern read for no verdict: ' + NO_VERDICT.map((x) => x[1]).join('; ') + ')');
  assert.ok(all.size > 300, 'the runs hold every field: ' + all.size);
  const list = [...off].sort();
  assert.strictEqual(list.length, 0, list.length + ' places the app reads and Python doesn\'t:\n  ' + list.slice(0, 80).join('\n  ') + (list.length > 80 ? '\n  …' : ''));
});
/* A key named like Object.prototype's own (toString, constructor) is read as the file's own in the canonical check, never an
   inherited value: the app and Python give the same verdict and first place. */
rule('A key named like an inherited one is judged as its own in the canonical check, in the app and Python alike', () => {
  const PF = require('./harness').load(), base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'folders', 'v1.10.0', 'runs', 'backup', 'run-a', 'run.json'), 'utf8'));
  const cases = [];
  for (const k of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__defineGetter__']) for (const v of [null, 1, '', {}]) {
    const o = JSON.parse(JSON.stringify(base)); o[k] = v; cases.push([k + '=' + JSON.stringify(v), o]);
    const p = JSON.parse(JSON.stringify(base)), s = Object.keys(p.steps)[0]; p.steps[s][k] = v; cases.push(['steps.' + s + '.' + k + '=' + JSON.stringify(v), p]);
  }
  if (!PY) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-inh-')), file = path.join(dir, 'runs.json');
  let py; try { fs.writeFileSync(file, JSON.stringify(cases.map((c) => c[1]))); py = JSON.parse(cp.execFileSync(PY, ['-I', path.join(__dirname, 'check_pack.py'), '--canonical', file], { encoding: 'utf8' })); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const off = cases.map(([n, o], i) => [n, PF.run.canonical(JSON.parse(JSON.stringify(o))), py[i]]).filter((x) => x[1] !== x[2]);
  assert.deepStrictEqual(off, []);
});
run();
