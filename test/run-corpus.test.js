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
      const text = JSON.stringify(c.run, null, 2);
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
  assert.strictEqual(roles.length, 3);
  assert.deepStrictEqual(roles.map((R) => R.X.role).join(), 'child,fulfills,evidence');
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
  const { cases } = await corpus(), off = cases.filter((c) => /\(not the written form\)$/.test(c.name) && !c.js);
  assert.ok(cases.filter((c) => /\(not the written form\)$/.test(c.name)).length > 100, 'the corpus tries them');
  assert.strictEqual(off.length, 0, off.length + ' accepted:\n  ' + off.slice(0, 30).map((c) => c.role + ' · ' + c.name).join('\n  '));
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
  assert.strictEqual(off.length, 0, off.length + ' of ' + cases.length + ' cases differ:\n  ' + off.slice(0, 40).join('\n  ') + (off.length > 40 ? '\n  …' : ''));
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
  for (const R of roles) {
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

run();
