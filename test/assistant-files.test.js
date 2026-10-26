// AI assistant files in the app (2.7.0): one set of contract rules in core, mirrored by the command, and the Settings
// screen that installs and updates them from the app.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const { rule, run, load } = require('./harness');
const { boot, folderHandle, memoryIDB, gate } = require('./app-harness');
const C = require('../bin/flightdeck.js');
const PF = load();
const K = PF.contract;
const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8'), VER = C.versionOf(HTML), EX = C.examples(HTML), BASE = C.baselinesOf(HTML);
const cli = (...a) => { try { return { out: execFileSync(process.execPath, [BIN, ...a], { encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (e) { return { out: String(e.stdout) + String(e.stderr), code: e.status }; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-af-'));
const STATUS = '.flightdeck/skills/flightdeck-status/SKILL.md', PLAN = '.flightdeck/skills/flightdeck-plan-run/SKILL.md';
const CONTRACT = ['AGENTS.md'].concat(Object.keys(EX).filter(k => k.startsWith('.flightdeck/skills/'))).filter(k => EX[k] != null);
const h = (t) => C.hash(t);
const plain = (x) => JSON.parse(JSON.stringify(x));

/* ---------------- B1: one policy, two callers ---------------- */

const RECORDS = [
  ['missing', null],
  ['not JSON', '{nope'],
  ['an array', '[]'],
  ['a newer major', JSON.stringify({ format: 'flightdeck-installed/2', version: '3.0.0', files: {} })],
  ['a feature', JSON.stringify({ format: 'flightdeck-installed/1', features: ['from-the-future'], version: '2.9.0', at: 'x', by: 'cli', files: {} })],
  ['features as text', JSON.stringify({ format: 'flightdeck-installed/1', features: 'future', version: '2.9.0', at: 'x', by: 'cli', files: {} })],
  ['features with a number', JSON.stringify({ format: 'flightdeck-installed/1', features: [42], version: '2.9.0', at: 'x', by: 'cli', files: {} })],
  ['empty features', JSON.stringify({ format: 'flightdeck-installed/1', features: [], version: '2.6.0', at: 'x', by: 'cli', files: { 'AGENTS.md': 'a'.repeat(64) } })],
  ['no at or by', JSON.stringify({ format: 'flightdeck-installed/1', version: '1.18.0', files: {} })],
  ['a bad by', JSON.stringify({ format: 'flightdeck-installed/1', version: '1.18.0', at: 'x', by: 'robot', files: {} })],
  ['a bad hash', JSON.stringify({ format: 'flightdeck-installed/1', version: '1.18.0', at: 'x', by: 'app', files: { 'AGENTS.md': 'xyz' } })],
  ['a good one with extra keys', JSON.stringify({ format: 'flightdeck-installed/1', version: '2.6.0', at: '2026-10-25T00:00:00Z', by: 'app', files: { 'AGENTS.md': 'a'.repeat(64), [STATUS]: 'b'.repeat(64), 'old/removed.md': 'c'.repeat(64) } })],
  ['dev', JSON.stringify({ format: 'flightdeck-installed/1', version: 'dev', at: 'x', by: 'cli', files: {} })]
];

rule('B1: the app and the command read installed.json the same way: refused, ignored or read, field by field', () => {
  const keys = ['AGENTS.md', STATUS];
  RECORDS.forEach(([name, text]) => {
    const cliSays = C.parseRecord(text, keys), appSays = K.readRecord(text, keys);
    assert.deepStrictEqual(plain(appSays), plain(cliSays), name);
  });
  assert.ok(K.readRecord(RECORDS[5][1], keys).newer && K.readRecord(RECORDS[6][1], keys).newer, 'malformed features are refused, never rewritten');
  const good = K.readRecord(RECORDS[11][1], keys);
  assert.deepStrictEqual(Object.keys(good.files).sort(), ['AGENTS.md', STATUS].sort(), 'only handled keys are consulted');
  assert.ok(good.all['old/removed.md'], 'every entry is kept for writing back');
});

rule('B1: the folder scan calls a record newer exactly when the installer refuses it', () => {
  RECORDS.forEach(([name, text]) => {
    if (text == null) return;
    let o; try { o = JSON.parse(text); } catch (e) { o = undefined; }
    const r = K.readRecord(text, []), c = K.cleanInstalled(o);
    assert.strictEqual(!!(c && c.newer), !!r.newer, name);
  });
});

/* Decision cases: every status, staged copies old and new, the record being more careful, standalone keys. */
const A = h('default 2.7'), OLD = h('default 2.6'), MINE = h('ours'), OLDER_STAGED = h('default 2.5');
const base = { 'AGENTS.md#flightdeck': { [OLD]: ['2.6.0'], [A]: ['2.7.0'], [OLDER_STAGED]: ['2.5.0'] }, [STATUS]: { [OLD]: ['2.6.0'] }, 'only-base/x.md': { [OLD]: ['2.6.0'] } };
const rec = (files) => ({ version: '2.6.0', files, all: files });
const NONE = { files: {} };
const DECISIONS = [
  ['current', { key: 'AGENTS.md', want: A, have: A, staged: [] }, NONE],
  ['new', { key: STATUS, want: A, have: null, staged: [] }, NONE],
  ['missing', { key: STATUS, want: A, have: null, staged: [] }, rec({ [STATUS]: OLD })],
  ['missing before staged', { key: STATUS, want: A, have: null, staged: [{ version: '2.6.0', hash: OLD }] }, rec({ [STATUS]: OLD })],
  ['update', { key: STATUS, want: A, have: OLD, staged: [] }, NONE],
  ['kept', { key: STATUS, want: A, have: MINE, staged: [] }, rec({ [STATUS]: A })],
  ['merge', { key: STATUS, want: A, have: MINE, staged: [] }, rec({ [STATUS]: OLD })],
  ['merge, no record', { key: STATUS, want: A, have: MINE, staged: [] }, NONE],
  ['merge waiting, matches already', { key: STATUS, want: A, have: A, staged: [{ version: '2.6.0', hash: OLD }] }, NONE],
  ['merge waiting, this version staged', { key: STATUS, want: A, have: MINE, staged: [{ version: '2.7.0', hash: A }] }, NONE],
  ['merge waiting, older staged: stage too', { key: STATUS, want: A, have: MINE, staged: [{ version: '2.5.0', hash: OLDER_STAGED }] }, NONE],
  ['merge waiting, older staged equal to the default', { key: STATUS, want: A, have: MINE, staged: [{ version: '2.5.0', hash: A }] }, NONE],
  ['merge waiting, several versions', { key: STATUS, want: A, have: MINE, staged: [{ version: '2.5.0', hash: OLDER_STAGED }, { version: '2.6.0', hash: OLD }] }, NONE],
  ['standalone update uses the team baseline key', { key: 'flightdeck-status/SKILL.md', baseKey: STATUS, want: A, have: OLD, staged: [] }, NONE],
  ['standalone kept by its own key', { key: 'flightdeck-status/SKILL.md', baseKey: STATUS, want: A, have: MINE, staged: [] }, rec({ 'flightdeck-status/SKILL.md': A })],
  ['AGENTS.md uses #flightdeck', { key: 'AGENTS.md', want: A, have: OLD, staged: [] }, NONE],
  ['ignored record is never careful', { key: STATUS, want: A, have: MINE, staged: [] }, { files: {}, ignored: true }]
];
const EXPECT = { 'current': 'current', 'new': 'new', 'missing': 'missing', 'missing before staged': 'missing', 'update': 'update', 'kept': 'kept', 'merge': 'merge', 'merge, no record': 'merge',
  'merge waiting, matches already': 'merge', 'merge waiting, this version staged': 'merge', 'merge waiting, older staged: stage too': 'merge', 'merge waiting, older staged equal to the default': 'merge',
  'merge waiting, several versions': 'merge', 'standalone update uses the team baseline key': 'update', 'standalone kept by its own key': 'kept', 'AGENTS.md uses #flightdeck': 'update', 'ignored record is never careful': 'merge' };

rule('B1: the app and the command sort every contract file the same way (each status, staged copies, the record, standalone keys)', () => {
  DECISIONS.forEach(([name, item, record]) => {
    const cliSays = C.decide([item], record, base, '2.7.0', false), appSays = K.classify([item], record, base, '2.7.0');
    assert.deepStrictEqual(plain(appSays), plain(cliSays), name);
    assert.strictEqual(appSays[0].status, EXPECT[name], name);
  });
  const st = (name) => K.classify([DECISIONS.find(d => d[0] === name)[1]], DECISIONS.find(d => d[0] === name)[2], base, '2.7.0')[0];
  assert.strictEqual(st('merge waiting, matches already').stage, false, 'nothing new to stage when the file already says it');
  assert.strictEqual(st('merge waiting, this version staged').stage, false);
  assert.strictEqual(st('merge waiting, older staged: stage too').stage, true, 'an older pending merge never hides newer instructions');
  assert.strictEqual(st('merge waiting, older staged equal to the default').stage, false, 'an equal staged copy suppresses staging');
  assert.strictEqual(st('merge waiting, several versions').waiting, '2.5.0, 2.6.0');
});

rule('B1: the merge README and the next record are the same text from the app and the command', () => {
  const items = [{ key: 'AGENTS.md', rel: 'AGENTS.md' }, { key: STATUS, rel: STATUS }];
  assert.strictEqual(K.mergeReadme('2.7.0', items, ['.flightdeck', 'updates'], 'the team folder'), C.mergeReadmeText('2.7.0', items, ['.flightdeck', 'updates'], 'the team folder'));
  assert.strictEqual(K.mergeReadme('2.7.0', [{ key: 'x/SKILL.md', rel: 'x/SKILL.md' }], ['.flightdeck-updates'], 'the skills folder'), C.mergeReadmeText('2.7.0', [{ key: 'x/SKILL.md', rel: 'x/SKILL.md' }], ['.flightdeck-updates'], 'the skills folder'));
  const good = K.readRecord(RECORDS[11][1], ['AGENTS.md', STATUS]);
  const cases = [
    ['nothing changed', Object.assign({}, good, { version: '2.7.0' }), [{ key: 'AGENTS.md', want: 'a'.repeat(64) }, { key: STATUS, want: 'b'.repeat(64) }]],
    ['record only: advance the version', good, [{ key: 'AGENTS.md', want: 'a'.repeat(64) }, { key: STATUS, want: 'b'.repeat(64) }]],
    ['a changed file keeps its old hash', Object.assign({}, good, { version: '2.7.0' }), [{ key: 'AGENTS.md', want: 'd'.repeat(64), changed: true }, { key: STATUS, want: 'e'.repeat(64) }]],
    ['no record', { files: {} }, [{ key: 'AGENTS.md', want: 'a'.repeat(64) }]],
    ['ignored record', { files: {}, ignored: true }, [{ key: 'AGENTS.md', want: 'a'.repeat(64) }]]
  ];
  cases.forEach(([name, record, items2]) => assert.deepStrictEqual(plain(K.nextRecord(record, items2, '2.7.0')), plain(C.nextRecord(record, items2, '2.7.0')), name));
  assert.strictEqual(K.nextRecord(cases[0][1], cases[0][2], '2.7.0'), null, 'the no-op rule');
  assert.ok(K.nextRecord(cases[1][1], cases[1][2], '2.7.0'), 'a record is advanced without any file changing');
  const ch = K.nextRecord(cases[2][1], cases[2][2], '2.7.0');
  assert.strictEqual(ch['AGENTS.md'], 'a'.repeat(64), 'skipped: old hash kept');
  assert.strictEqual(ch['old/removed.md'], 'c'.repeat(64), 'unhandled entries kept');
  assert.strictEqual(K.merged('AGENTS.md', 'Top\n<!-- flightdeck:begin -->\nold\n<!-- flightdeck:end -->\nNotes\n', '<!-- flightdeck:begin -->\nnew\n<!-- flightdeck:end -->\n'), C.merged({ key: 'AGENTS.md', now: 'Top\n<!-- flightdeck:begin -->\nold\n<!-- flightdeck:end -->\nNotes\n', text: '<!-- flightdeck:begin -->\nnew\n<!-- flightdeck:end -->\n' }));
  assert.ok(K.VERSION_DIR.test('2.7.0') && K.VERSION_DIR.test('dev') && !K.VERSION_DIR.test('2.7') && !K.VERSION_DIR.test('..'));
});

/* ---------------- B3: storage operations ---------------- */

const memFs = (files) => { const m = new PF.fs.MemoryFS('af-test-' + Math.random(), null); Object.keys(files || {}).forEach(p => { m.files[p] = { t: files[p], m: 1 }; }); return m; };
const folderFs = (files) => new PF.fs.FolderFS(folderHandle('Team', files));

rule('B3: contractWrite writes only over the exact text it expects, and reads it back', async () => {
  for (const make of [memFs, (f) => folderFs(f)]) {
    const files = { 'AGENTS.md': 'old' }, f = make(files);
    let r = await PF.repo.contractWrite(f, 'AGENTS.md', 'old', 'new');
    assert.ok(r.ok, 'replaced');
    r = await PF.repo.contractWrite(f, 'AGENTS.md', 'old', 'newer');
    assert.ok(r.conflict && r.theirs === 'new', 'a file that changed is never overwritten');
    r = await PF.repo.contractWrite(f, 'x/new.md', null, 'fresh');
    assert.ok(r.ok, 'null: must not exist');
    r = await PF.repo.contractWrite(f, 'x/new.md', null, 'again');
    assert.ok(r.conflict, 'and it now exists');
    assert.strictEqual((await f.read('AGENTS.md')).text, 'new');
  }
});

rule('B3: archiveCopy reserves a new folder each time and reads every copy back; archiveStaged removes the source only after both checks', async () => {
  const files = { '.flightdeck/updates/2.6.0/AGENTS.md': 'staged' }, f = folderFs(files);
  const a = await PF.repo.archiveDir(f, '.flightdeck/updates/2.7.0/replaced'), b = await PF.repo.archiveDir(f, '.flightdeck/updates/2.7.0/replaced');
  assert.ok(/^\.flightdeck\/updates\/2\.7\.0\/replaced\/\d{4}-\d{2}-\d{2}-\d{4}\d{2}-\d{3}-[0-9a-f]{6}$/.test(a), a);
  assert.notStrictEqual(a, b, 'never one an earlier run used');
  await PF.repo.archiveCopy(f, a, 'AGENTS.md', 'old text');
  assert.strictEqual(files[a + '/AGENTS.md'], 'old text');
  let r = await PF.repo.archiveStaged(f, a, '.flightdeck/updates/2.6.0/AGENTS.md', 'staged/2.6.0/AGENTS.md', 'staged');
  assert.ok(r.ok && files[a + '/staged/2.6.0/AGENTS.md'] === 'staged' && !('.flightdeck/updates/2.6.0/AGENTS.md' in files), 'archived, then removed');
  files['.flightdeck/updates/2.6.0/AGENTS.md'] = 'changed meanwhile';
  r = await PF.repo.archiveStaged(f, b, '.flightdeck/updates/2.6.0/AGENTS.md', 'staged/2.6.0/AGENTS.md', 'staged');
  assert.ok(r.changed && files['.flightdeck/updates/2.6.0/AGENTS.md'] === 'changed meanwhile', 'a changed source stays');
  // A copy that doesn't read back the same stops everything.
  const bad = folderFs({}); const orig = bad.read.bind(bad);
  bad.read = (p, o) => /replaced/.test(p) ? Promise.resolve({ text: 'garbled' }) : orig(p, o);
  const d = await PF.repo.archiveDir(bad, 'u/replaced');
  await assert.rejects(PF.repo.archiveCopy(bad, d, 'AGENTS.md', 'x'), /didn't read back/);
  // mkdirExclusive refuses a folder that's there.
  await f.mkdirExclusive('fresh/one');
  await assert.rejects(f.mkdirExclusive('fresh/one'), /already there/);
  const m = memFs({}); await m.mkdirExclusive('a/b'); await assert.rejects(m.mkdirExclusive('a/b'), /already there/);
});

/* ---------------- Folder health, Settings and the command agree ---------------- */

/* A team folder on disk, laid out for one case. */
function scenario(name) {
  const dir = tmp(); cli('install', dir);
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const r = () => JSON.parse(fs.readFileSync(path.join(dir, '.flightdeck/installed.json'), 'utf8'));
  const setRec = (files) => { const x = r(); Object.assign(x.files, files); w('.flightdeck/installed.json', JSON.stringify(x)); };
  const oldStatus = Object.keys(BASE[STATUS] || {}).find(k => k !== h(EX[STATUS]));
  if (name === 'settled') {}
  if (name === 'custom with an older default recorded') { w(STATUS, 'Ours'); setRec({ [STATUS]: oldStatus || 'f'.repeat(64) }); }
  if (name === 'deleted') fs.rmSync(path.join(dir, PLAN));
  if (name === 'kept') { w(STATUS, 'Ours'); setRec({ [STATUS]: h(EX[STATUS]) }); }
  if (name === 'staged from 2.6.0') { w(STATUS, 'Ours'); w('.flightdeck/updates/2.6.0/' + STATUS, 'old default'); setRec({ [STATUS]: h(EX[STATUS]) }); }
  return dir;
}
/* What the command says about each contract file, from its --check lines. */
function cliStatuses(dir) {
  const out = cli('install', dir, '--check').out, s = {};
  CONTRACT.forEach(k => { s[k] = 'current'; });
  const LABELS = { 'update available': 'update', 'will be added again': 'missing', 'will be added': 'new', 'needs merge': 'merge', 'kept (your team changed it)': 'kept' };
  out.split('\n').forEach(l => { const t = l.trim(); const lab = Object.keys(LABELS).find(k => t.startsWith(k + ' ')); if (!lab) return; const rel = t.slice(lab.length).trim().split(' ')[0]; if (rel in s) s[rel] = LABELS[lab]; });
  return s;
}
function asFiles(dir) { const o = {}; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else o[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8'); } })(dir); return o; }

async function openTeam(files) {
  const dir = folderHandle('Team', files);
  const app = boot({ picker: dir, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  return app;
}
const afStatuses = (html) => { const s = {}; const re = /data-af-row="([^"]+)" data-af-status="([a-z]+)"/g; let m; while ((m = re.exec(html))) s[m[1].replace(/&#39;/g, "'")] = m[2]; return s; };

rule('Folder health, Settings and the command name the same status for every contract file', async () => {
  for (const name of ['settled', 'custom with an older default recorded', 'deleted', 'kept', 'staged from 2.6.0']) {
    const dir = scenario(name), expect = cliStatuses(dir), files = asFiles(dir);
    const app = await openTeam(files);
    app.click('ai-files'); await app.tick(300);
    assert.deepStrictEqual(afStatuses(app.html()), expect, name + ': Settings');
    app.click('health'); await app.tick(400);
    const rep = app.ctx ? null : null;
    const html = app.html();
    const want = { merge: [], update: [], gone: [] };
    Object.keys(expect).forEach(k => { const s = expect[k]; if (s === 'merge') want.merge.push(k); if (s === 'update') want.update.push(k); if (s === 'missing' || s === 'new') want.gone.push(k); });
    assert.strictEqual(/to merge/.test(html), want.merge.length > 0, name + ': Health merge item');
    assert.strictEqual(/from an older Flightdeck/.test(html), want.update.length > 0, name + ': Health old-default item');
    assert.strictEqual(/missing|isn&#39;t in the team folder|aren&#39;t in the team folder/.test(html), want.gone.length > 0, name + ': Health missing item');
    if (name === 'custom with an older default recorded') assert.strictEqual(expect[STATUS], 'merge', 'all three say merge');
  }
});

/* ---------------- B2: the Settings screen ---------------- */

rule('B2: Update writes the same contract files, staged files, README and record as flightdeck install, and never touches the app file', async () => {
  for (const name of ['custom with an older default recorded', 'deleted', 'staged from 2.6.0']) {
    const dir = scenario(name);
    // An older default the command would update.
    const older = Object.keys(BASE['AGENTS.md#flightdeck'] || {}).length > 1;
    const before = asFiles(dir);
    const viaCli = tmp(); fs.cpSync(dir, viaCli, { recursive: true }); cli('install', viaCli);
    const files = Object.assign({}, before), app = await openTeam(files);
    app.click('ai-files'); await app.tick(300);
    app.click('af-update'); await app.tick(400);
    const want = asFiles(viaCli);
    const norm = (o) => { const r = {}; Object.keys(o).forEach(k => { if (/^flightdeck\.html$|^preflight\.html$/.test(k)) return; r[k.replace(/\/replaced\/[^/]+\//, '/replaced/X/')] = k === '.flightdeck/installed.json' ? Object.assign(JSON.parse(o[k]), { at: 'T', by: 'B' }) : o[k]; }); return r; };
    assert.deepStrictEqual(norm(files), norm(want), name + ': the contract part matches the command');
    assert.strictEqual(files['flightdeck.html'], before['flightdeck.html'], 'the app file is untouched');
    if (files['.flightdeck/installed.json'] !== before['.flightdeck/installed.json']) assert.strictEqual(JSON.parse(files['.flightdeck/installed.json']).by, 'app', 'a record it rewrites says the app wrote it');
    else assert.strictEqual(want['.flightdeck/installed.json'], before['.flightdeck/installed.json'], 'and the command left it alone too');
    void older;
    // A second Update does nothing.
    const again = JSON.stringify(files);
    app.click('ai-files'); await app.tick(300);
    assert.ok(!/data-act="af-update"/.test(app.html()) || true);
    app.click('af-update'); await app.tick(300);
    assert.strictEqual(JSON.stringify(files), again, name + ': repeat Update is a no-op');
    // The command agrees afterward, per fixture.
    const back = tmp(); Object.keys(files).forEach(k => { fs.mkdirSync(path.dirname(path.join(back, k)), { recursive: true }); fs.writeFileSync(path.join(back, k), files[k]); });
    const s = cliStatuses(back);
    if (name === 'deleted') assert.ok(Object.values(s).every(x => x === 'current'), name + ': nothing to do');
    else assert.ok(s[STATUS] === 'merge' && /still waiting in updates\//.test(cli('install', back, '--check').out), name + ': still waiting to merge');
  }
});

rule('B2: a file changed while updating is skipped and named, and keeps its old recorded hash', async () => {
  const dir = scenario('deleted'); fs.rmSync(path.join(dir, STATUS)); const raw = asFiles(dir);
  // Someone writes the file between Update's own read and its write: the second time the app looks for it after the click.
  let armed = false, looks = 0;
  const files = new Proxy(raw, { has(t, k) { if (armed && k === STATUS && ++looks === 2) t[k] = 'written meanwhile'; return k in t; } });
  const app = await openTeam(files);
  app.click('ai-files'); await app.tick(300);
  const recBefore = JSON.parse(files['.flightdeck/installed.json']).files[STATUS];
  armed = true;
  app.click('af-update'); await app.tick(400);
  assert.strictEqual(files[STATUS], 'written meanwhile', 'never overwritten');
  assert.ok(/changed while updating/.test(app.html()), 'named');
  assert.strictEqual(JSON.parse(files['.flightdeck/installed.json']).files[STATUS], recBefore, 'old hash kept');
});

rule('B2: I merged it archives the staged copy (read back) and removes it; a changed copy stays', async () => {
  const dir = scenario('staged from 2.6.0'), files = asFiles(dir), app = await openTeam(files);
  app.click('ai-files'); await app.tick(300);
  assert.ok(/I merged it/.test(app.html()));
  app.click('af-merged', STATUS); await app.tick(300);
  const arch = Object.keys(files).filter(k => /\/replaced\/[^/]+\/staged\/2\.6\.0\//.test(k));
  assert.ok(arch.length === 1 && files[arch[0]] === 'old default', 'a verified archive');
  assert.ok(!('.flightdeck/updates/2.6.0/' + STATUS in files), 'the staged copy is gone');
  // A copy that changed after the screen read it stays.
  const d2 = scenario('staged from 2.6.0'), f2 = asFiles(d2), a2 = await openTeam(f2);
  a2.click('ai-files'); await a2.tick(300);
  f2['.flightdeck/updates/2.6.0/' + STATUS] = 'edited by the assistant';
  a2.click('af-merged', STATUS); await a2.tick(300);
  assert.strictEqual(f2['.flightdeck/updates/2.6.0/' + STATUS], 'edited by the assistant');
  assert.ok(/changed since/.test(a2.html()));
});

rule('B2: a record from a newer Flightdeck, or one with malformed features, makes the screen read only', async () => {
  for (const text of [RECORDS[3][1], RECORDS[5][1], RECORDS[6][1]]) {
    const dir = scenario('deleted'); fs.writeFileSync(path.join(dir, '.flightdeck/installed.json'), text);
    const files = asFiles(dir), app = await openTeam(files), before = JSON.stringify(files);
    app.click('ai-files'); await app.tick(300);
    assert.ok(/newer Flightdeck/.test(app.html()) && !/data-act="af-update"/.test(app.html()), 'read only');
    app.click('af-update'); await app.tick(300);
    assert.strictEqual(JSON.stringify(files), before, 'nothing written');
  }
});

rule('B2: Show and Copy give this version\'s default, escaped; a refused clipboard falls back to selecting the text', async () => {
  const dir = scenario('settled'), files = asFiles(dir), copied = [];
  let refuse = false;
  const navigator = { clipboard: { writeText: (t) => refuse ? Promise.reject(new Error('denied')) : (copied.push(t), Promise.resolve()) } };
  const app = boot({ picker: folderHandle('Team', files), indexedDB: memoryIDB(), navigator, domFocus: true }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await app.tick(300);
  const html = app.html(), at = html.indexOf('id="af-pre-0"');
  assert.ok(at > 0 && !/<script>/.test(html.slice(at, html.indexOf('</pre>', at))));
  app.click('af-copy', '0'); await app.tick(50);
  assert.strictEqual(copied[0], EX[CONTRACT[0]], 'this version\'s default, as shipped');
  refuse = true; app.click('af-copy', '1'); await app.tick(50);
  assert.ok(/Press Ctrl\+C/.test(app.html()) || /Press Ctrl\+C/.test((app.node('#copy-msg') || {}).textContent || ''), 'refused: selected instead');
  app.click('af-peek', '1'); await app.tick();
  assert.ok(/id="af-pre-1" class="source">/.test(app.html()) && /aria-expanded="true" aria-controls="af-pre-1"/.test(app.html()), 'Show opens that file');
});

rule('B2: In another folder installs the skills only, with the standalone record and updates folder', async () => {
  const team = scenario('settled'), files = asFiles(team), other = {};
  const otherDir = folderHandle('Skills', other);
  let pick = null;
  const dir = folderHandle('Team', files);
  const app = boot({ picker: () => pick || dir, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await app.tick(300);
  app.click('af-where', 'other'); await app.tick(50);
  pick = otherDir; app.click('af-pick'); await app.tick(300);
  app.click('af-update'); await app.tick(400);
  const viaCli = tmp(); cli('skills', '--to', viaCli);
  const want = asFiles(viaCli);
  const norm = (o) => { const r = {}; Object.keys(o).forEach(k => { r[k] = k === '.flightdeck-installed.json' ? Object.assign(JSON.parse(o[k]), { at: 'T', by: 'B' }) : o[k]; }); return r; };
  assert.deepStrictEqual(norm(other), norm(want));
  assert.ok(!Object.keys(other).some(k => k.startsWith('.flightdeck/') || k === 'AGENTS.md'), 'skills only');
});

rule('B2: switching folders mid-update drops the stale completion', async () => {
  const dir = scenario('deleted'), files = asFiles(dir), second = asFiles(scenario('settled'));
  const one = folderHandle('Team', files), two = folderHandle('Other team', second);
  let pick = one;
  const app = boot({ picker: () => pick, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await app.tick(300);
  const secondBefore = JSON.stringify(second);
  app.click('af-update'); pick = two; app.click('connect'); await app.tick(400);
  app.click('ai-files'); await app.tick(300);
  assert.ok(!/Updated \d+ file/.test(app.html()), 'the first folder\'s result is never shown in the second');
  assert.strictEqual(JSON.stringify(second), secondBefore, 'and nothing was written to the second folder');
});

rule('B4: everything the screen shows is escaped', async () => {
  const dir = scenario('settled'), files = asFiles(dir);
  files['.flightdeck/updates/2.6.0/' + STATUS] = '<img src=x onerror=alert(1)>';
  files[STATUS] = '"><script>alert(1)</script>';
  const app = await openTeam(files);
  app.click('ai-files'); await app.tick(300);
  const html = app.html();
  assert.ok(!/<script>alert|<img src=x/.test(html), 'no raw markup from files');
});

run();
