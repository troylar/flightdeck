// AI assistant files in the app (2.12.0): one set of contract rules in core, mirrored by the command, and the Settings
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
const wait = (app) => app.tick(400);

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
  ['dev', JSON.stringify({ format: 'flightdeck-installed/1', version: 'dev', at: 'x', by: 'cli', files: {} })],
  ['entries named like constructor and __proto__', '{"format":"flightdeck-installed/1","version":"2.6.0","at":"x","by":"cli","files":{"constructor":"' + 'a'.repeat(64) + '","__proto__":"' + 'b'.repeat(64) + '","AGENTS.md":"' + 'c'.repeat(64) + '"}}'],
  ['a bad hash under __proto__', '{"format":"flightdeck-installed/1","version":"2.6.0","at":"x","by":"cli","files":{"__proto__":"nope"}}']
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
  const odd = K.readRecord(RECORDS[13][1], ['constructor', 'toString', 'AGENTS.md']);
  assert.strictEqual(odd.files.constructor, 'a'.repeat(64), 'a real entry named constructor is read');
  assert.ok(!Object.prototype.hasOwnProperty.call(odd.files, 'toString'), 'an inherited name is not an entry');
  assert.strictEqual(K.readRecord(RECORDS[14][1], []).ignored, true, 'a bad hash under __proto__ is seen, not skipped');
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

/* A file as an older release shipped it, from its tag: null in a clone without tags (CI=1 fails instead, as the other cross-version rules do). */
function shipped(rel, tag) {
  try { return execFileSync('git', ['show', tag + ':example-folder/' + rel], { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { if (process.env.CI) throw e; console.log('skipped: tag ' + tag + ' is not in this clone'); return null; }
}
const OLD_AGENTS = shipped('AGENTS.md', 'v2.6.0'), OLD_STATUS = shipped(STATUS, 'v2.6.0');
/* A team folder on disk, laid out for one case. */
function scenario(name) {
  const dir = tmp(); cli('install', dir);
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const r = () => JSON.parse(fs.readFileSync(path.join(dir, '.flightdeck/installed.json'), 'utf8'));
  const setRec = (files) => { const x = r(); Object.assign(x.files, files); w('.flightdeck/installed.json', JSON.stringify(x)); };
  const oldStatus = Object.keys(BASE[STATUS] || {}).find(k => k !== h(EX[STATUS]));
  if (name === 'older defaults') { w('AGENTS.md', OLD_AGENTS.replace(/\n*$/, '\n') + '\nOur own team note.\n'); w(STATUS, OLD_STATUS); }
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
  for (const name of ['settled', 'older defaults', 'custom with an older default recorded', 'deleted', 'kept', 'staged from 2.6.0']) {
    if (name === 'older defaults' && OLD_AGENTS == null) continue;
    const dir = scenario(name), expect = cliStatuses(dir), files = asFiles(dir);
    const app = await openTeam(files);
    app.click('ai-files'); await app.tick(300);
    assert.deepStrictEqual(afStatuses(app.html()), expect, name + ': Settings');
    app.click('health'); await app.tick(400);
    const html = app.html();
    const want = { merge: [], update: [], gone: [] };
    Object.keys(expect).forEach(k => { const s = expect[k]; if (s === 'merge') want.merge.push(k); if (s === 'update') want.update.push(k); if (s === 'missing' || s === 'new') want.gone.push(k); });
    assert.strictEqual(/to merge/.test(html), want.merge.length > 0, name + ': Health merge item');
    assert.strictEqual(/from an older Flightdeck/.test(html), want.update.length > 0, name + ': Health old-default item');
    assert.strictEqual(/Flightdeck skills? missing|isn&#39;t in the team folder|aren&#39;t in the team folder/.test(html), want.gone.length > 0, name + ': Health missing item');
    assert.strictEqual(/Open AI assistant files/.test(html), want.merge.length + want.update.length + want.gone.length > 0, name + ': its action opens the screen');
    if (name === 'custom with an older default recorded') assert.strictEqual(expect[STATUS], 'merge', 'all three say merge');
  }
});

/* ---------------- B2: the Settings screen ---------------- */

rule('B2: Update writes the same contract files, staged files, README and record as flightdeck install, and never touches the app file', async () => {
  for (const name of ['older defaults', 'custom with an older default recorded', 'deleted', 'staged from 2.6.0']) {
    if (name === 'older defaults' && OLD_AGENTS == null) continue;
    const dir = scenario(name);
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
    // A second Update does nothing: nothing offers it, and pressing it anyway writes nothing.
    const again = JSON.stringify(files);
    app.click('ai-files'); await app.tick(300);
    assert.ok(!/data-act="af-update"/.test(app.html()), name + ': nothing left to update');
    app.click('af-update'); await app.tick(300);
    assert.strictEqual(JSON.stringify(files), again, name + ': repeat Update is a no-op');
    // The command agrees afterward, per fixture.
    const back = tmp(); Object.keys(files).forEach(k => { fs.mkdirSync(path.dirname(path.join(back, k)), { recursive: true }); fs.writeFileSync(path.join(back, k), files[k]); });
    const s = cliStatuses(back);
    if (name === 'deleted' || name === 'older defaults') assert.ok(Object.values(s).every(x => x === 'current'), name + ': nothing to do');
    if (name === 'older defaults') {
      assert.ok(files['AGENTS.md'].endsWith('Our own team note.\n'), 'Team notes are kept');
      assert.ok(Object.keys(files).some(k => /\/replaced\/[^/]+\/AGENTS\.md$/.test(k) && files[k] === before['AGENTS.md']), 'with a copy of what it replaced');
      continue;
    }
    if (name === 'deleted') continue;
    assert.ok(s[STATUS] === 'merge' && /still waiting in updates\//.test(cli('install', back, '--check').out), name + ': still waiting to merge');
  }
});

rule('B2: a file changed while updating is skipped and named, and keeps its old recorded hash', async () => {
  const dir = scenario('deleted'); fs.rmSync(path.join(dir, STATUS));
  /* Recorded from an older default, so a record that took this version's would differ. */
  const r = JSON.parse(fs.readFileSync(path.join(dir, '.flightdeck/installed.json'), 'utf8')), OLD_HASH = 'f'.repeat(64);
  r.files[STATUS] = OLD_HASH; fs.writeFileSync(path.join(dir, '.flightdeck/installed.json'), JSON.stringify(r));
  const raw = asFiles(dir);
  // Someone writes the file between Update's own read and its write: the second time the app looks for it after the click.
  let armed = false, looks = 0;
  const files = new Proxy(raw, { has(t, k) { if (armed && k === STATUS && ++looks === 2) t[k] = 'written meanwhile'; return k in t; } });
  const app = await openTeam(files);
  app.click('ai-files'); await app.tick(300);
  armed = true;
  app.click('af-update'); await app.tick(400);
  assert.strictEqual(raw[STATUS], 'written meanwhile', 'never overwritten');
  assert.ok(/changed while updating/.test(app.html()), 'named');
  assert.strictEqual(JSON.parse(raw['.flightdeck/installed.json']).files[STATUS], OLD_HASH, 'old hash kept');
  assert.strictEqual(raw[PLAN], EX[PLAN], 'and the rest of the update went ahead');
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

rule('B2: Show and Copy give this version\'s default, escaped; a refused clipboard selects the text and keeps it showing', async () => {
  const dir = scenario('settled'), files = asFiles(dir), copied = [];
  let refuse = false;
  const navigator = { clipboard: { writeText: (t) => refuse ? Promise.reject(new Error('denied')) : (copied.push(t), Promise.resolve()) } };
  const app = boot({ picker: folderHandle('Team', files), indexedDB: memoryIDB(), navigator, domFocus: true }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await app.tick(300);
  const dk = (k) => app.PF.vk.domKey(k), preOf = (k) => { const html = app.html(), at = html.indexOf('id="af-pre-' + dk(k) + '"'); return at < 0 ? null : html.slice(at, html.indexOf('</pre>', at)); };
  assert.ok(/ hidden>$/.test(preOf(STATUS)), 'nothing is drawn until it is asked for: every file on every redraw would be a lot of text');
  app.click('af-copy', CONTRACT[0]); await app.tick(50);
  assert.strictEqual(copied[0], EX[CONTRACT[0]], 'this version\'s default, as shipped');
  refuse = true; app.click('af-copy', STATUS); await app.tick(50);
  assert.ok(/Press Ctrl\+C/.test(app.node('#copy-msg').textContent), 'refused: says how');
  const box = preOf(STATUS), open = box.indexOf('>');
  assert.ok(!/ hidden/.test(box.slice(0, open)), 'on show');
  assert.strictEqual(box.slice(open + 1).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'), EX[STATUS], 'and the box holds the text, escaped as it\'s drawn');
  app.click('af-load'); await wait(app);
  assert.ok(!/ hidden>$/.test(preOf(STATUS).slice(0, preOf(STATUS).indexOf('>') + 1)) && preOf(STATUS).indexOf('name:') > 0, 'and a redraw keeps it there: the person is about to press Ctrl+C');
  app.click('af-peek', STATUS); await app.tick();
  app.click('af-peek', PLAN); await app.tick();
  assert.ok(/aria-expanded="true" aria-controls="af-pre-[^"]+"/.test(app.html()) && preOf(PLAN).indexOf('name:') > 0 && !/hidden/.test(preOf(PLAN).slice(0, 60)), 'Show opens that file, escaped');
  assert.ok(/ hidden>$/.test(preOf(STATUS)), 'and closes the one before it');
  assert.ok(!/<script>/.test(preOf(PLAN)));
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

/* A folder whose first new write waits at a gate: an update caught in the middle, for certain. */
function paused(d, st) {
  return Object.assign({}, d, {
    getDirectoryHandle: (n, o) => d.getDirectoryHandle(n, o).then(c => paused(c, st)),
    getFileHandle: (n, o) => { if (!(st.armed && o && o.create)) return d.getFileHandle(n, o); st.armed = false; st.reached = true; return st.gate.p.then(() => d.getFileHandle(n, o)); }
  });
}

rule('B2: switching folders mid-update stops before its next write, shows nothing in the new folder and writes nothing there', async () => {
  const dir = scenario('deleted'); fs.rmSync(path.join(dir, STATUS));
  const files = asFiles(dir), second = asFiles(scenario('settled')), recBefore = files['.flightdeck/installed.json'];
  const st = { armed: false, gate: gate() }, one = paused(folderHandle('Team', files), st), two = folderHandle('Other team', second);
  let pick = one;
  const app = boot({ picker: () => pick, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await app.tick(300);
  const secondBefore = JSON.stringify(second);
  st.armed = true; app.click('af-update'); await app.tick(100);
  assert.ok(st.reached, 'set-up: caught in the middle');
  pick = two; app.click('connect'); await app.tick(200);
  st.gate.open(); await app.tick(300);
  assert.strictEqual([PLAN, STATUS].filter(k => k in files).length <= 1, true, 'the write under way may finish; no later one starts');
  assert.strictEqual(files['.flightdeck/installed.json'], recBefore, 'and no record');
  app.click('ai-files'); await app.tick(300);
  assert.ok(!/Updated \d+ file/.test(app.html()), 'the first folder\'s result is never shown in the second');
  assert.ok(!/Working…/.test(app.html()), 'nor is its work');
  assert.strictEqual(JSON.stringify(second), secondBefore, 'and nothing was written to the second folder');
});

rule('B2: a second click on Update while one runs starts nothing', async () => {
  if (OLD_AGENTS == null) return;
  const files = asFiles(scenario('older defaults')), st = { armed: false, gate: gate() };
  const app = boot({ picker: paused(folderHandle('Team', files), st), indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await app.tick(300);
  st.armed = true; app.click('af-update'); await app.tick(100);
  assert.ok(st.reached, 'set-up: caught in the middle');
  app.click('af-update'); await app.tick(100);
  st.gate.open(); await app.tick(400);
  const dirs = new Set(Object.keys(files).filter(k => /\/replaced\//.test(k)).map(k => /\/replaced\/([^/]+)\//.exec(k)[1]));
  assert.strictEqual(dirs.size, 1, 'one update, one folder of copies');
  assert.ok(files['AGENTS.md'].endsWith('Our own team note.\n'));
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

/* ---------------- what the old rules didn't try ---------------- */

const handle = (name, files, over) => Object.assign(folderHandle(name, files), over || {});

rule('B2: a record alone can be written or repaired, with no file changing, and then nothing more is offered', async () => {
  for (const [name, change] of [['no record', (d) => fs.rmSync(path.join(d, '.flightdeck/installed.json'))], ['a record Flightdeck did not write', (d) => fs.writeFileSync(path.join(d, '.flightdeck/installed.json'), '{"format":"flightdeck-installed/1"}')], ['an older record', (d) => { const r = JSON.parse(fs.readFileSync(path.join(d, '.flightdeck/installed.json'), 'utf8')); r.version = '2.6.0'; fs.writeFileSync(path.join(d, '.flightdeck/installed.json'), JSON.stringify(r)); }]]) {
    const dir = scenario('settled'); change(dir);
    const files = asFiles(dir), before = Object.assign({}, files), app = await openTeam(files);
    app.click('ai-files'); await wait(app);
    assert.ok(/Save the record of these files/.test(app.html()), name + ': offered');
    app.click('af-update'); await wait(app);
    const rec = JSON.parse(files['.flightdeck/installed.json']);
    assert.strictEqual(rec.version, VER, name); assert.strictEqual(rec.by, 'app', name);
    CONTRACT.forEach(k => assert.strictEqual(files[k], before[k], name + ': ' + k + ' is untouched'));
    assert.ok(!/data-act="af-update"/.test(app.html()), name + ': nothing more to do');
    const parsed = C.parseRecord(files['.flightdeck/installed.json'], CONTRACT);
    assert.ok(!parsed.ignored && !parsed.newer && parsed.version === VER, name + ': the command reads it as its own');
  }
});

rule('B2: text outside AGENTS.md\'s markers isn\'t a change', async () => {
  const dir = scenario('settled'), files = asFiles(dir);
  files['AGENTS.md'] += '\nOur own team note.\n';
  const app = await openTeam(files);
  app.click('ai-files'); await wait(app);
  assert.strictEqual(afStatuses(app.html())['AGENTS.md'], 'current');
});

rule('B2: an archive copy that does not read back stops the replacement, and says so', async () => {
  if (OLD_AGENTS == null) return;
  const raw = asFiles(scenario('older defaults')), was = raw['AGENTS.md'], status = raw[STATUS], rec = raw['.flightdeck/installed.json'];
  const files = new Proxy(raw, { get(t, k) { return typeof k === 'string' && /\/replaced\//.test(k) && k in t ? 'garbled' : t[k]; } });
  const app = await openTeam(files);
  app.click('ai-files'); await wait(app);
  assert.strictEqual(afStatuses(app.html())['AGENTS.md'], 'update', 'set-up');
  app.click('af-update'); await wait(app);
  assert.strictEqual(raw['AGENTS.md'], was, 'nothing replaced');
  assert.strictEqual(raw[STATUS], status, 'nor anything after it');
  assert.strictEqual(raw['.flightdeck/installed.json'], rec, 'and no record of an update that did not happen');
  assert.ok(/didn&#39;t read back the same/.test(app.html()), 'says so');
  assert.ok(!/Working…/.test(app.html()), 'not stuck');
});

rule('B2: a second click, or Open AI assistant files during an update, neither cuts it short nor leaves the screen stuck', async () => {
  const dir = scenario('deleted'); fs.rmSync(path.join(dir, '.flightdeck/installed.json'));
  const files = asFiles(dir), app = await openTeam(files);
  app.click('ai-files'); await wait(app);
  app.click('af-update'); app.click('af-update'); app.click('ai-files'); app.click('af-load');
  await wait(app);
  assert.strictEqual(files[PLAN], EX[PLAN], 'the file was written');
  assert.ok(JSON.parse(files['.flightdeck/installed.json']).by === 'app', 'and the record, the last step');
  assert.ok(!/Working…/.test(app.html()) && !/Checking the files…/.test(app.html()), 'not stuck');
  assert.ok(/All up to date/.test(app.html()), 'and it says where things stand');
  assert.strictEqual(Object.keys(files).filter(k => /\.tmp$/.test(k)).length, 0);
});

rule('B2: while it works, the buttons stay on the page, not disabled, so focus stays; when the button goes, focus goes to the heading', async () => {
  const dir = scenario('deleted'), files = asFiles(dir);
  const app = boot({ picker: folderHandle('Team', files), indexedDB: memoryIDB(), domFocus: true }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  const sel = '[data-act="af-update"]';
  app.node(sel).focus(); await app.tick(1);
  app.click('af-update'); await app.tick(0);
  assert.ok(!/data-act="af-update"[^>]* disabled/.test(app.html()), 'never disabled, which would drop focus');
  await wait(app);
  assert.ok(!app.node(sel), 'set-up: the button is gone');
  assert.strictEqual(app.activeId(), 'set-ai', 'the section\'s heading, never the page');
});

rule('B2: focus elsewhere is left alone when an update finishes', async () => {
  const dir = scenario('deleted'), files = asFiles(dir);
  const app = boot({ picker: folderHandle('Team', files), indexedDB: memoryIDB(), domFocus: true }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  app.click('af-update'); await app.tick(0);
  const other = '[data-act="af-peek"][data-id="AGENTS.md"]';
  app.node(other).focus(); await wait(app);
  assert.strictEqual(app.activeId(), other);
});

rule('B2: read only, with one line saying why: no folder access, the examples, a browser not allowing changes', async () => {
  const noFolder = boot({}); await noFolder.tick(60);
  noFolder.click('nav', 'settings'); await noFolder.tick(50);
  assert.ok(/can&#39;t write to folders/.test(noFolder.html()) && /flightdeck install/.test(noFolder.html()), 'no folder access names the command');
  assert.ok(!/data-act="af-update"/.test(noFolder.html()) && /data-act="af-copy"/.test(noFolder.html()), 'Copy stays');
  const examples = boot({ picker: folderHandle('Team', {}), indexedDB: memoryIDB() }); await examples.tick(60);
  examples.click('ai-files'); await wait(examples);
  assert.ok(/You&#39;re using the examples/.test(examples.html()) && !/data-act="af-update"/.test(examples.html()), 'the examples');
  const dir = scenario('deleted'), files = asFiles(dir), before = JSON.stringify(files);
  let perm = 'granted';
  const app = boot({ picker: handle('Team', files, { queryPermission: () => Promise.resolve(perm) }), indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  perm = 'denied';
  app.click('ai-files'); await wait(app);
  assert.ok(/isn&#39;t allowing changes/.test(app.html()) && !/data-act="af-update"/.test(app.html()), 'permission refused');
  app.click('af-update'); await wait(app);
  assert.strictEqual(JSON.stringify(files), before, 'nothing written');
});

rule('B2: a refused record shows Show and Copy, and keeps every file\'s text', async () => {
  const dir = scenario('kept'); fs.writeFileSync(path.join(dir, '.flightdeck/installed.json'), RECORDS[3][1]);
  const files = asFiles(dir), app = await openTeam(files);
  app.click('ai-files'); await wait(app);
  const html = app.html();
  assert.ok(/data-act="af-peek"/.test(html) && /data-act="af-copy"/.test(html), 'still there');
  assert.ok(!/data-act="af-merged"/.test(html), 'and nothing that writes');
  assert.ok(/flightdeck install/.test(html), 'names the alternative');
});

rule('B2: only a valid version name counts as a waiting copy, as in the command', async () => {
  const dir = scenario('kept');
  for (const bad of ['evil', '2.6', '2.6.0.1', 'v2.6.0']) { fs.mkdirSync(path.join(dir, '.flightdeck/updates', bad, path.dirname(STATUS)), { recursive: true }); fs.writeFileSync(path.join(dir, '.flightdeck/updates', bad, STATUS), 'x'); }
  const expect = cliStatuses(dir), files = asFiles(dir);
  files['.flightdeck/updates/2.5.0'] = 'a file, not a folder: the command refuses the whole install over this; here it just isn\'t a version';
  const app = await openTeam(files);
  app.click('ai-files'); await wait(app);
  assert.strictEqual(expect[STATUS], 'kept', 'the command ignores them');
  assert.deepStrictEqual(afStatuses(app.html()), expect, 'the app too');
  app.click('health'); await wait(app);
  assert.ok(!/to merge/.test(app.html()), 'Folder health too');
});

rule('B2: forty waiting versions keep one short row, and I merged it still puts every copy away', async () => {
  const dir = scenario('kept');
  const vers = Array.from({ length: 40 }, (_, i) => '1.' + i + '.0');
  vers.forEach(v => { fs.mkdirSync(path.join(dir, '.flightdeck/updates', v, path.dirname(STATUS)), { recursive: true }); fs.writeFileSync(path.join(dir, '.flightdeck/updates', v, STATUS), 'copy ' + v); });
  const files = asFiles(dir), app = await openTeam(files);
  app.click('ai-files'); await wait(app);
  assert.ok(/\(in 1\.0\.0, 1\.1\.0, 1\.2\.0 and 37 more\)/.test(app.html()), 'oldest first, then a count');
  app.click('af-merged', STATUS); await app.tick(800);
  vers.forEach(v => assert.ok(!(('.flightdeck/updates/' + v + '/' + STATUS) in files), v + ' removed'));
  const kept = Object.keys(files).filter(k => /\/replaced\/[^/]+\/staged\//.test(k));
  assert.strictEqual(kept.length, 40, 'each kept');
  vers.forEach(v => assert.strictEqual(files[kept.find(k => k.includes('/staged/' + v + '/'))], 'copy ' + v));
});

rule('B2: Copy merge request names each version folder holding a copy, and only a file with one offers it', async () => {
  const dir = scenario('custom with an older default recorded'), files = asFiles(dir), copied = [];
  const navigator = { clipboard: { writeText: (t) => (copied.push(t), Promise.resolve()) } };
  const app = boot({ picker: folderHandle('Team', files), indexedDB: memoryIDB(), navigator }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  assert.strictEqual(afStatuses(app.html())[STATUS], 'merge');
  assert.ok(!/data-act="af-brief"/.test(app.html()), 'no copy waits yet, so no folder to name');
  assert.ok(!/data-act="af-merged"/.test(app.html()));
  app.click('af-update'); await wait(app);
  assert.ok(/data-act="af-brief"/.test(app.html()), 'now there is');
  app.click('af-brief', STATUS); await app.tick(50);
  assert.ok(copied[0].indexOf('`.flightdeck/updates/' + VER + '/`') > 0, 'names the folder');
  assert.strictEqual(copied[0].indexOf('> '), -1, 'without the README\'s quote mark');
});

rule('B2: In another folder is remembered across windows, asks again when the browser does, and refuses the team folder', async () => {
  const idb = memoryIDB(), other = {};
  const dirT = folderHandle('Team', asFiles(scenario('settled')));
  let perm = 'granted';
  const otherDir = handle('Skills', other, { queryPermission: () => Promise.resolve(perm), requestPermission: () => { perm = 'granted'; return Promise.resolve('granted'); } });
  let pick = dirT;
  const one = boot({ picker: () => pick, indexedDB: idb }); await one.tick(60);
  one.click('connect'); await one.tick(200);
  one.click('ai-files'); await wait(one);
  one.click('af-where', 'other'); await one.tick(50);
  assert.ok(/Choose a folder/.test(one.html()) && /data-act="af-copy"/.test(one.html()), 'nothing chosen: choose, and Copy still works');
  one.click('af-pick'); await one.tick(100);
  assert.ok(/the team folder\. Use In the team folder/i.test(one.html()), 'the team folder is refused');
  assert.ok(!Object.keys(dirT.files).some(k => k === '.flightdeck-installed.json'), 'nothing written there');
  pick = otherDir; one.click('af-pick'); await wait(one);
  one.click('af-update'); await wait(one);
  assert.ok(other['.flightdeck-installed.json'], 'written');
  const two = boot({ picker: () => dirT, indexedDB: idb }); await two.tick(60);
  two.click('connect'); await two.tick(200);
  two.click('ai-files'); await wait(two);
  two.click('af-where', 'other'); await wait(two);
  assert.ok(/Using <b>Skills<\/b>/.test(two.html()) && /All up to date/.test(two.html()), 'remembered');
  perm = 'prompt';
  const three = boot({ picker: () => dirT, indexedDB: idb }); await three.tick(60);
  three.click('connect'); await three.tick(200);
  three.click('ai-files'); await wait(three);
  three.click('af-where', 'other'); await wait(three);
  assert.ok(/Allow Skills again/.test(three.html()) && !/data-act="af-update"/.test(three.html()), 'asks, and writes nothing until then');
  three.click('af-allow'); await wait(three);
  assert.ok(/Using <b>Skills<\/b>/.test(three.html()), 'allowed');
});

rule('B2: a folder switch leaves nothing behind: no result, no chosen folder, no file open', async () => {
  const files = asFiles(scenario('deleted')), second = asFiles(scenario('settled'));
  let pick = folderHandle('Team', files);
  const app = boot({ picker: () => pick, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  app.click('af-update'); await wait(app);
  assert.ok(/Updated \d+ file/.test(app.html()), 'set-up');
  app.click('af-peek', STATUS); await app.tick();
  pick = folderHandle('Other team', second); app.click('connect'); await app.tick(200);
  app.click('nav', 'settings'); await wait(app);
  assert.ok(!/Updated \d+ file/.test(app.html()), 'no result from the first folder');
  assert.ok(!/aria-expanded="true" aria-controls="af-pre-/.test(app.html()), 'no file left open');
});

rule('B2: Settings checks the files once for each folder, writes nothing doing it, and typing elsewhere on the page survives', async () => {
  const dir = scenario('deleted'), files = asFiles(dir), before = JSON.stringify(files);
  let reads = 0, armed = false;
  const counted = new Proxy(files, { get(t, k) { if (armed && k === PLAN) reads++; return t[k]; }, has(t, k) { return k in t; } });
  const app = await openTeam(counted);
  armed = true;
  app.click('nav', 'settings'); await wait(app);
  assert.ok(/data-af-status/.test(app.html()), 'each file says where it stands, without asking');
  assert.strictEqual(JSON.stringify(files), before, 'looking writes nothing');
  const n = reads;
  app.click('nav', 'home'); await app.tick(5); app.click('nav', 'settings'); await wait(app);
  assert.strictEqual(reads, n, 'and it looked once');
});

rule('Folder health looks again after an update, rather than showing what was true before', async () => {
  const dir = scenario('deleted'), files = asFiles(dir), app = await openTeam(files);
  app.click('health'); await wait(app);
  assert.ok(/Flightdeck skill missing/.test(app.html()), 'set-up: it says so');
  app.click('ai-files'); await wait(app);
  app.click('af-update'); await wait(app);
  app.click('health'); await wait(app);
  assert.ok(!/Flightdeck skill missing/.test(app.html()), 'the file is back, and it knows');
});

rule('B4: every error and name the screen shows from a file or folder is escaped', async () => {
  const name = '<img src=x onerror=alert(1)>', other = {};
  const app = boot({ picker: () => handle(name, other), indexedDB: memoryIDB() }); await app.tick(60);
  app.click('nav', 'settings'); await app.tick(50);
  app.click('af-where', 'other'); await app.tick(50);
  app.click('af-pick'); await wait(app);
  assert.ok(/Using <b>&lt;img/.test(app.html()), 'the folder name');
  assert.ok(!/<img src=x/.test(app.html()));
  const denied = boot({ picker: handle(name, asFiles(scenario('settled')), { queryPermission: () => Promise.resolve('denied') }), indexedDB: memoryIDB() }); await denied.tick(60);
  denied.click('connect'); await denied.tick(200);
  denied.click('ai-files'); await wait(denied);
  assert.ok(/allowing changes to &lt;img/.test(denied.html()) && !/<img src=x/.test(denied.html()), 'in the read-only line');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'views', 'manage.js'), 'utf8');
  const at = src.indexOf('function assistantFiles(ctx)'), body = src.slice(at, src.indexOf('var keySeq', at));
  assert.ok(!/innerHTML|eval\(|new Function/.test(body), 'no raw HTML in the view');
});

rule('The AI assistant files code never logs and never builds a path from a file', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const a = src.indexOf('Settings, AI assistant files: flightdeck install'), b = src.indexOf('Getting started (views/setup.js', a), body = src.slice(a, b);
  assert.ok(a > 0 && b > a);
  assert.ok(!/console\.|innerHTML|\beval\(|new Function/.test(body));
  assert.ok(/VERSION_DIR\.test\(i\.name\)/.test(body), 'version folders are checked by name');
});

/* ---------------- review round 1 ---------------- */

/* A folder handle with hooks: reads may wait, count or fail, by path. */
function hooked(d, o, prefix) {
  prefix = prefix || '';
  return Object.assign({}, d, {
    getDirectoryHandle: (n, x) => d.getDirectoryHandle(n, x).then(c => hooked(c, o, prefix + n + '/')),
    getFileHandle: (n, x) => {
      const p = prefix + n;
      if (x && x.create) return d.getFileHandle(n, x);
      return d.getFileHandle(n, x).then(h => Object.assign({}, h, { getFile: async () => {
        o.reads = (o.reads || 0) + 1; o.now = (o.now || 0) + 1; o.most = Math.max(o.most || 0, o.now);
        const waiting = /^\.flightdeck\/updates\//.test(p);
        if (waiting) { o.copiesNow = (o.copiesNow || 0) + 1; o.copiesMost = Math.max(o.copiesMost || 0, o.copiesNow); }
        try {
          if (o.delay) await new Promise(r => setTimeout(r, o.delay));
          if (o.wait && o.wait(p)) await o.wait(p);
          if (o.fail && o.fail.test(p)) throw Object.assign(new Error('The file could not be read.'), { name: 'NotReadableError' });
          const f = await h.getFile();
          return Object.assign({}, f, { text: () => { (o.texts = o.texts || []).push(p); return f.text(); } });
        } finally { o.now--; if (waiting) o.copiesNow--; }
      } }));
    }
  });
}

rule('Round 1, 1: I merged it deletes nothing after a folder switch', async () => {
  const dir = scenario('staged from 2.6.0'), files = asFiles(dir), second = asFiles(scenario('settled')), src = '.flightdeck/updates/2.6.0/' + STATUS;
  const st = { armed: false, gate: gate() }, one = paused(folderHandle('Team', files), st);
  let pick = one;
  const app = boot({ picker: () => pick, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  st.armed = true; app.click('af-merged', STATUS); await app.tick(100);
  assert.ok(st.reached, 'set-up: caught while copying');
  pick = folderHandle('Other team', second); app.click('connect'); await app.tick(200);
  st.gate.open(); await wait(app);
  assert.strictEqual(files[src], 'old default', 'the waiting copy is still there');
});

rule('Round 1, 2: a record that would grow past what Flightdeck reads is refused before any file changes', async () => {
  const dir = scenario('deleted');
  const r = JSON.parse(fs.readFileSync(path.join(dir, '.flightdeck/installed.json'), 'utf8')), LIMIT = 8 * 1048576, HASH = 'e'.repeat(64);
  r.version = '2.6.0'; /* so Update has a record to write */
  const room = LIMIT - 200 - JSON.stringify(r).length, each = JSON.stringify({ 'old/0000000.md': HASH }).length - 1;
  for (let i = 0; i < Math.floor(room / each); i++) r.files['old/' + String(i).padStart(7, '0') + '.md'] = HASH;
  const text = JSON.stringify(r);
  assert.ok(text.length <= LIMIT && JSON.stringify(r, null, 2).length > LIMIT, 'set-up: it fits only as it stands');
  fs.writeFileSync(path.join(dir, '.flightdeck/installed.json'), text);
  const files = asFiles(dir), before = Object.keys(files).length, app = await openTeam(files);
  app.click('ai-files'); await app.tick(800);
  assert.ok(/data-act="af-update"/.test(app.html()), 'set-up: it can be read and updated');
  app.click('af-update'); await app.tick(800);
  assert.ok(!(PLAN in files), 'the deleted file isn\'t written');
  assert.strictEqual(files['.flightdeck/installed.json'], text, 'the record stays');
  assert.strictEqual(Object.keys(files).length, before, 'nothing new at all');
  assert.ok(/too big/.test(app.html()) && /Nothing was changed/.test(app.html()), 'says so, in plain words');
  assert.ok(!/Working…/.test(app.html()), 'not stuck');
});

rule('Round 1, 3: closing help after Update\'s button went away puts focus on the section\'s heading', async () => {
  const files = asFiles(scenario('deleted')), st = { armed: false, gate: gate() };
  const app = boot({ picker: paused(folderHandle('Team', files), st), indexedDB: memoryIDB(), domFocus: true }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  app.node('[data-act="af-update"]').focus(); await app.tick(1);
  st.armed = true; app.click('af-update'); await app.tick(100);
  assert.ok(st.reached, 'set-up: Update is running');
  app.click('help'); await app.tick(5);
  st.gate.open(); await wait(app);
  assert.ok(!app.node('[data-act="af-update"]'), 'set-up: the button went while help was open');
  app.key('Escape'); await app.tick(5);
  assert.strictEqual(app.activeId(), 'set-ai', 'the heading, never the page');
});

rule('Round 1, 4: Open AI assistant files during another folder\'s read loads the team folder and isn\'t stuck', async () => {
  const dir = scenario('settled'), other = { 'flightdeck-status/SKILL.md': 'a skill of ours' };
  const g = gate(), o = {}, otherDir = hooked(folderHandle('Skills', other), o);
  let pick = folderHandle('Team', asFiles(dir));
  const app = boot({ picker: () => pick, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  app.click('af-where', 'other'); await app.tick(50);
  o.wait = () => g.p;
  pick = otherDir; app.click('af-pick'); await app.tick(50);
  assert.ok(/Checking the files…/.test(app.html()), 'set-up: its read is under way');
  app.click('ai-files'); await wait(app);
  g.open(); await wait(app);
  assert.ok(!/Checking the files…/.test(app.html()), 'not stuck');
  assert.ok(/data-af-row="AGENTS\.md"/.test(app.html()) && /All up to date/.test(app.html()), 'the team folder\'s files');
});

rule('Round 1, 5: a hundred waiting versions: folders listed first, only files that exist read, a few at a time, no copy kept in memory', async () => {
  const dir = scenario('kept');
  for (let i = 0; i < 100; i++) { const p = path.join(dir, '.flightdeck/updates/1.' + i + '.0', STATUS); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'copy ' + i); }
  const files = asFiles(dir), o = {};
  const app = boot({ picker: hooked(folderHandle('Team', files), o), indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(400);
  o.delay = 1; o.reads = 0; o.most = 0;
  app.click('nav', 'settings'); await app.tick(1500);
  assert.ok(/1\.0\.0, 1\.1\.0, 1\.2\.0 and 97 more/.test(app.html()), 'set-up: it read them all');
  assert.ok(o.reads <= CONTRACT.length + 1 + 100, 'reads ' + o.reads + ': each contract file, the record and each copy that exists');
  assert.ok(o.most <= 8, 'at most 8 at once, it was ' + o.most);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8'), a = src.indexOf('function afRead(tg)'), body = src.slice(a, src.indexOf('function afGuard', a));
  assert.ok(!/version: v, path: p, text/.test(body) && !/x\.text/.test(body), 'a waiting copy is kept as its fingerprints, not its text');
});

rule('Round 1, 6: a waiting copy that is listed but can\'t be read stays a merge, with no all-clear, as the last release says', async () => {
  const bundles = require('../tools/old-bundles');
  const b = bundles.get('v2.11.2');
  if (!b) { if (process.env.CI) throw new Error('2.11.2\'s shipped page is needed'); console.log('skipped: v2.11.2 isn\'t cached'); return; }
  const verdict = async (html, name) => {
    const dir = scenario('settled');
    if (name === 'readable' || name === 'unreadable') { fs.mkdirSync(path.join(dir, '.flightdeck/updates/2.6.0', path.dirname(STATUS)), { recursive: true }); fs.writeFileSync(path.join(dir, '.flightdeck/updates/2.6.0', STATUS), 'old default'); }
    const stray = { 'a sync copy': '.flightdeck/updates/2.6.0/AGENTS-PC.md', 'not a version': '.flightdeck/updates/latest/AGENTS.md', 'a skill this version doesn\'t ship': '.flightdeck/updates/2.6.0/.flightdeck/skills/gone/SKILL.md' }[name];
    if (stray) { fs.mkdirSync(path.join(dir, path.dirname(stray)), { recursive: true }); fs.writeFileSync(path.join(dir, stray), 'a copy'); }
    const o = name === 'unreadable' ? { fail: /^\.flightdeck\/updates\// } : {};
    const app = boot(Object.assign({ picker: hooked(folderHandle('Team', asFiles(dir)), o), indexedDB: memoryIDB() }, html ? { html } : {})); await app.tick(60);
    app.click('connect'); await app.tick(300);
    app.click('health'); await app.tick(800);
    const page = app.html();
    return { merge: /waiting to be merged|for AI assistants to merge/.test(page), clear: /The files for AI assistants (are current|match this version)/.test(page) };
  };
  const STRAY = ['a sync copy', 'not a version', 'a skill this version doesn\'t ship'];
  for (const name of ['settled', 'readable', 'unreadable'].concat(STRAY)) assert.deepStrictEqual(await verdict(null, name), await verdict(b.files['flightdeck.html'], name), name);
  for (const name of ['unreadable'].concat(STRAY)) assert.deepStrictEqual(await verdict(null, name), { merge: true, clear: false }, 'the verdict itself: ' + name);
});

rule('Round 1, 7 and 9: the docs say the race limit the command\'s text has, and close your editors', () => {
  const updating = fs.readFileSync(path.join(__dirname, '..', 'docs', 'updating.md'), 'utf8');
  const at = updating.indexOf('**A file that changes while the app updates.**'), para = updating.slice(at, updating.indexOf('\n', at));
  assert.ok(/instant between/.test(para) && /Close editors on `AGENTS\.md` and the skills/.test(para), 'docs/updating.md, for Update');
  assert.ok(/\*\*I merged it\*\*[^\n]*instant between/.test(updating), 'docs/updating.md, for I merged it');
  const rel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'releases.json'), 'utf8'))[0], first = rel.changes[0].now;
  assert.ok(/instant/.test(first) && /[Cc]lose editors/.test(first), 'the release note');
  const waiver = fs.readFileSync(path.join(__dirname, '..', 'docs', 'rehearsals', '2.12.0-2026-10-31-waiver.md'), 'utf8');
  assert.ok(/fileAway/.test(waiver) && /final comparison/.test(waiver), 'the waiver');
});

/* ---------------- review round 2: one state object per target and folder ---------------- */

rule('Round 2, 1: choosing skills folder B while it reads: A\'s rows are gone, and I merged it can\'t act on B with A\'s fingerprints', async () => {
  const COPY = '.flightdeck-updates/2.6.0/flightdeck-status/SKILL.md', KEY = 'flightdeck-status/SKILL.md';
  const a = { [KEY]: 'ours in A', [COPY]: 'A copy' }, b = { [KEY]: 'ours in B', [COPY]: 'B copy' }, g = gate(), o = {};
  const team = folderHandle('Team', asFiles(scenario('settled')));
  let pick = team;
  const app = boot({ picker: () => pick, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  app.click('af-where', 'other'); await app.tick(50);
  pick = folderHandle('Skills A', a); app.click('af-pick'); await wait(app);
  assert.ok(/data-act="af-merged"/.test(app.html()), 'set-up: A has a waiting merge');
  o.wait = () => g.p;
  pick = hooked(folderHandle('Skills B', b), o); app.click('af-pick'); await app.tick(60);
  assert.ok(/Checking the files…/.test(app.html()) && /Using <b>Skills B<\/b>/.test(app.html()), 'set-up: B is reading');
  assert.ok(!/data-act="af-merged"/.test(app.html()), 'A\'s action is gone');
  assert.ok(!/data-af-status/.test(app.html()), 'and A\'s rows');
  app.click('af-merged', KEY); app.click('af-update'); await app.tick(60);
  o.wait = null; g.open(); await wait(app);
  assert.strictEqual(b[COPY], 'B copy', 'B\'s copy is still there');
  assert.strictEqual(a[COPY], 'A copy', 'and A\'s');
  assert.ok(!Object.keys(b).concat(Object.keys(a)).some(k => /replaced/.test(k)), 'nothing put away anywhere');
  assert.ok(/data-act="af-merged"/.test(app.html()), 'B\'s own rows, once read');
});

rule('Round 2, 1: while a target\'s read is running, Update and I merged it refuse, even in the same folder', async () => {
  const dir = scenario('staged from 2.6.0'), files = asFiles(dir), o = {}, g = gate(), src = '.flightdeck/updates/2.6.0/' + STATUS;
  const app = boot({ picker: hooked(folderHandle('Team', files), o), indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  const before = JSON.stringify(files);
  o.wait = () => g.p;
  app.click('ai-files'); await app.tick(60);
  assert.ok(/Checking the files…/.test(app.html()), 'set-up');
  assert.ok(/data-act="af-merged"[^>]*aria-disabled="true"/.test(app.html()), 'shown as not available');
  app.click('af-merged', STATUS); app.click('af-update'); await app.tick(60);
  o.wait = null; g.open(); await wait(app);
  assert.strictEqual(JSON.stringify(files), before, 'nothing happened');
  assert.ok(files[src]);
});

rule('Round 2, 2: a refused clipboard from another target does nothing here: nothing shown, nothing selected', async () => {
  for (const act of ['af-brief', 'af-copy']) {
    const KEY = 'flightdeck-status/SKILL.md', other = { [KEY]: 'ours', ['.flightdeck-updates/2.6.0/' + KEY]: 'copy' };
    let reject; const navigator = { clipboard: { writeText: () => new Promise((res, rej) => { reject = rej; }) } };
    let pick = folderHandle('Team', asFiles(scenario('settled')));
    let selected = 0;
    const app = boot({ picker: () => pick, indexedDB: memoryIDB(), navigator, domFocus: true, onSelect: () => { selected++; } }); await app.tick(60);
    app.click('connect'); await app.tick(200);
    app.click('ai-files'); await wait(app);
    app.click('af-where', 'other'); await app.tick(50);
    pick = folderHandle('Skills', other); app.click('af-pick'); await wait(app);
    app.click(act, KEY); await app.tick(5);
    app.click('af-where', 'team'); await wait(app);
    reject(new Error('denied')); await app.tick(50);
    assert.strictEqual(selected, 0, act + ': nothing is selected');
    assert.ok(!/Press Ctrl\+C/.test(app.node('#copy-msg').textContent || ''), act + ': and it doesn\'t say to press Ctrl+C');
    app.click('af-peek', 'AGENTS.md'); app.click('af-peek', 'AGENTS.md'); await app.tick(20); /* whatever it left in the state, the next drawing shows */
    const html = app.html();
    assert.ok(!/\.flightdeck-updates/.test(html.slice(html.indexOf('id="af-brief-pre"'), html.indexOf('</pre>', html.indexOf('id="af-brief-pre"')))), act + ': the old folder\'s request isn\'t shown');
    assert.ok(/id="af-brief-pre"[^>]* hidden/.test(html), act + ': its box stays closed');
    assert.ok(!/aria-expanded="true"/.test(html), act + ': no file opens');
    assert.ok(/data-af-row="AGENTS\.md"/.test(html), act + ': set-up: the team folder is showing');
  }
});

/* Every async start, against each way the target or folder can change under it. After it lands, the screen shows only
   the new target, with nothing running, and the new folder is untouched. */
const ASYNC_PATHS = {
  'first look': { busy: false, async start(w) { w.o.wait = () => w.g.p; w.app.click('nav', 'settings'); } , team: true },
  'Check again': { busy: false, async start(w) { w.app.click('ai-files'); await wait(w.app); w.o.wait = () => w.g.p; w.app.click('ai-files'); }, team: true },
  'Update': { busy: true, two: true, after(w) { assert.ok(Object.keys(w.files).length <= w.keys + 1, 'the old folder gets no write after the one under way'); }, async start(w) { w.app.click('ai-files'); await wait(w.app); w.st.armed = true; w.app.click('af-update'); }, team: true },
  'I merged it': { busy: true, scenario: 'staged from 2.6.0', after(w) { assert.ok(w.files['.flightdeck/updates/2.6.0/' + STATUS], 'the copy isn\'t removed'); }, async start(w) { w.app.click('ai-files'); await wait(w.app); w.st.armed = true; w.app.click('af-merged', STATUS); }, team: true },
  'choose a folder': { busy: false, async start(w) { w.app.click('ai-files'); await wait(w.app); w.app.click('af-where', 'other'); await w.app.tick(30); w.next = () => w.g.p.then(() => folderHandle('Leak', {})); w.app.click('af-pick'); } },
  'is it the team folder': { busy: false, async start(w) { w.app.click('ai-files'); await wait(w.app); w.app.click('af-where', 'other'); await w.app.tick(30); w.next = () => folderHandle('Leak', {}); w.sameWait = w.g.p.then(() => false); w.app.click('af-pick'); } },
  'remembered folder': { busy: false, seed: true, async start(w) { w.app.click('ai-files'); await wait(w.app); w.leakPerm = w.g.p.then(() => 'granted'); w.app.click('af-where', 'other'); } },
  'allow again': { busy: false, seed: true, prompt: true, async start(w) { w.app.click('ai-files'); await wait(w.app); w.app.click('af-where', 'other'); await wait(w.app); w.leakAllow = w.g.p.then(() => 'granted'); w.app.click('af-allow'); } },
  'copy refused': { busy: false, async start(w) { w.app.click('ai-files'); await wait(w.app); w.app.click('af-copy', CONTRACT[0]); }, team: true, refuse: true }
};
for (const name of Object.keys(ASYNC_PATHS)) for (const change of ['folder', 'target']) {
  const P = ASYNC_PATHS[name];
  if (change === 'target' && P.busy) continue;
  rule('Round 2, table: ' + name + ', then the ' + change + ' changes', async () => {
    const dirOf = scenario(P.scenario || 'deleted'); if (P.two) fs.rmSync(path.join(dirOf, STATUS));
    const files = asFiles(dirOf), second = asFiles(scenario('settled')), secondBefore = JSON.stringify(second);
    const w = { o: {}, g: gate(), st: { armed: false, gate: null }, files, selected: 0 }; w.st.gate = w.g;
    let reject;
    const navigator = { clipboard: { writeText: () => P.refuse ? new Promise((res, rej) => { reject = rej; }) : Promise.resolve() } };
    const teamDir = Object.assign(paused(hooked(folderHandle('Team', files), w.o), w.st), { isSameEntry: () => w.sameWait || Promise.resolve(false) }), idb = memoryIDB();
    const leak = Object.assign(folderHandle('Leak', {}), { queryPermission: () => w.leakPerm || Promise.resolve(P.prompt ? 'prompt' : 'granted'), requestPermission: () => w.leakAllow || Promise.resolve('granted') });
    if (P.seed) {
      const seed = boot({ picker: () => leak, indexedDB: idb }); await seed.tick(60);
      seed.click('nav', 'settings'); await seed.tick(20); seed.click('af-where', 'other'); await seed.tick(30); seed.click('af-pick'); await seed.tick(100);
    }
    w.next = () => teamDir;
    const app = w.app = boot({ picker: () => w.next(), indexedDB: idb, navigator, onSelect: () => { w.selected++; } }); await app.tick(60);
    app.click('connect'); await app.tick(200);
    await P.start(w); await app.tick(60);
    w.keys = Object.keys(files).length;
    if (change === 'folder') { w.next = () => folderHandle('Second', second); app.click('connect'); await app.tick(200); }
    else if (P.team) { app.click('af-where', 'other'); await app.tick(60); }
    else { app.click('af-where', 'team'); await app.tick(60); }
    w.o.wait = null; w.g.open(); if (reject) reject(new Error('denied')); await wait(app);
    let html = app.html();
    assert.strictEqual(w.selected, 0, 'nothing is selected');
    if (P.after) P.after(w);
    assert.ok(!/Working…/.test(html), 'nothing left running');
    assert.ok(!/Using <b>Leak<\/b>|Allow Leak/.test(html) || (change === 'target' && P.team), 'nothing from the old target');
    assert.ok(!/Press Ctrl\+C/.test((app.node('#copy-msg') || {}).textContent || ''), 'no message from the old target');
    if (change === 'folder') {
      app.click('ai-files'); await wait(app); html = app.html();
      assert.ok(!/Checking the files…/.test(html), 'not stuck');
      const st = afStatuses(html);
      assert.ok(Object.keys(st).length > 0 && Object.values(st).every(x => x === 'current'), 'the new folder\'s own statuses: ' + JSON.stringify(st));
      assert.strictEqual(JSON.stringify(second), secondBefore, 'the new folder is untouched');
    }
  });
}

/* A function in this feature that waits on something, and how it's bound. A new one fails until it's listed here. */
const AF_ASYNC = { afPerm: 'a question, no state', afIsTeam: 'a question, no state', afUse: 'turn', afRead: 'reads only, for a caller that checks', afLoad: 'guard', afUpdate: 'guard', afMerged: 'guard', afPick: 'chooses', afRemembered: 'chooses', afAllow: 'chooses' };
const AF_ACTS = ['ai-files', 'af-load', 'af-where', 'af-pick', 'af-allow', 'af-update', 'af-merged', 'af-peek', 'af-copy', 'af-brief'];
function afAudit(src) {
  const out = [], a = src.indexOf('Settings, AI assistant files: flightdeck install'), b = src.indexOf('Getting started (views/setup.js', a), body = src.slice(a, b), fns = {};
  for (const m of body.matchAll(/\n  function (af\w+)\(/g)) { const next = body.indexOf('\n  function ', m.index + 5); fns[m[1]] = body.slice(m.index, next < 0 ? body.length : next); }
  const WAITS = /\.then\(|\.catch\(|\bawait\b|setTimeout|setInterval/;
  Object.keys(fns).filter(n => WAITS.test(fns[n])).forEach(n => {
    if (!AF_ASYNC[n]) out.push(n + ' waits on something and isn\'t in the table');
    if (AF_ASYNC[n] === 'guard' && !/afGuard\(af\)/.test(fns[n])) out.push(n + ' doesn\'t take the guard');
    if (AF_ASYNC[n] === 'chooses' && !/afTurn\(af\)/.test(fns[n])) out.push(n + ' chooses a folder without taking a turn');
    if (AF_ASYNC[n] === 'turn' && !/if \(!turn\(\)\) return/.test(fns[n])) out.push(n + ' doesn\'t check its turn after waiting');
  });
  ['afUpdate', 'afMerged', 'afBrief'].forEach(n => { if (!/afReady\(af\)/.test(fns[n] || '')) out.push(n + ' doesn\'t refuse before the read has finished'); });
  if ((src.match(/state\.af = /g) || []).length !== 1 || !/state\.af = /.test(fns.afNew || '')) out.push('state.af is assigned somewhere other than afNew');
  if (/\baf\.(where|fs|otherFs|otherAsk)\s*=[^=]/.test(src)) out.push('a state object\'s target changed in place');
  if (!/function \(\) \{ return afLive\(af\); \}/.test(fns.afCopy || '')) out.push('a copy isn\'t bound to its target');
  /* Only the latest choice reaches afUse: each caller holds a turn, and nothing else calls it. */
  Object.keys(fns).filter(n => /afUse\(/.test(fns[n]) && n !== 'afUse').forEach(n => { if (AF_ASYNC[n] !== 'chooses') out.push(n + ' calls afUse without being in the table as choosing'); if (!/afUse\(af, d, turn/.test(fns[n])) out.push(n + ' calls afUse without its turn'); });
  const found = [...src.matchAll(/\n    '(af-[a-z]+|ai-files)': function/g)].map(m => m[1]);
  found.filter(x => !AF_ACTS.includes(x)).forEach(x => out.push(x + ' is an action not in the list'));
  AF_ACTS.forEach(act => { const at = src.indexOf("'" + act + "': function"), code = src.slice(at, src.indexOf("\n    '", at + 5)); if (at < 0) out.push(act + ' is gone'); else if (WAITS.test(code)) out.push(act + ' waits outside a guarded function'); });
  return out;
}

rule('Round 2, source: every async path in this feature is bound to the object it began with, and only afNew makes one', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  assert.deepStrictEqual(afAudit(src), []);
  /* And the check itself catches each way of skipping it. */
  const mark = '\n  function afLoad(';
  const plant = (from, to) => { assert.ok(src.includes(from), 'set-up: ' + from); return afAudit(src.replace(from, to)).length > 0; };
  assert.ok(plant(mark, '\n  function afNewPath() { return Promise.resolve().then(render); }' + mark), 'a new async function');
  assert.ok(plant(mark, '\n  function afLater() { setTimeout(render, 1); }' + mark), 'a timer');
  assert.ok(plant("'af-load': function () {", "'af-load': function () { Promise.resolve().then(render);"), 'a wait in an action');
  assert.ok(plant('\n    \'af-load\': function', '\n    \'af-new\': function () { },\n    \'af-load\': function'), 'a new action');
  assert.ok(plant(mark, '\n  function afX(af) { af.where = 1; state.af = af; }' + mark), 'changing a target in place');
  assert.ok(plant(mark, '\n  function afElse(af, d) { return afUse(af, d, function () { return true; }); }' + mark), 'a new way to choose a folder');
});

rule('Round 2, 3: Folder health reads a waiting copy with a limit, keeps only its fingerprint, and over the limit it stays a merge with no all-clear', async () => {
  const dir = scenario('settled'), big = '.flightdeck/updates/2.6.0/' + STATUS, o = {};
  fs.mkdirSync(path.join(dir, path.dirname(big)), { recursive: true }); fs.writeFileSync(path.join(dir, big), 'x'.repeat(8 * 1048576 + 1));
  const app = boot({ picker: hooked(folderHandle('Team', asFiles(dir)), o), indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(300);
  o.texts = [];
  app.click('health'); await app.tick(800);
  assert.ok(!o.texts.includes(big), 'it isn\'t read');
  const html = app.html();
  assert.ok(/for AI assistants to merge/.test(html), 'it stays a merge');
  assert.ok(!/The files for AI assistants (are current|match this version)/.test(html), 'with no all-clear');
  assert.ok(/can&#39;t be read/.test(html), 'and says it can\'t be read');
  const repoSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'storage', 'repo.js'), 'utf8');
  assert.ok(!/stagedTexts/.test(repoSrc), 'the scan keeps fingerprints, not text');
});

rule('Round 2, 3: Folder health reads waiting copies at most 8 at once', async () => {
  const dir = scenario('staged from 2.6.0'), o = {};
  for (let i = 0; i < 40; i++) { const p = path.join(dir, '.flightdeck/updates/1.' + i + '.0', STATUS); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'a copy ' + i); }
  const app = boot({ picker: hooked(folderHandle('Team', asFiles(dir)), o), indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(300);
  o.delay = 1; o.copiesMost = 0;
  app.click('health'); await app.tick(1500);
  assert.ok(o.copiesMost > 1 && o.copiesMost <= 8, 'at most 8 at once, it was ' + o.copiesMost);
  assert.ok(/for AI assistants to merge/.test(app.html()), 'it stays a merge');
});

rule('Round 2, 5: a contract file that can\'t be read is said to be unreadable, never missing, with no all-clear', async () => {
  for (const [what, fail, path_] of [['AGENTS.md', /^AGENTS\.md$/, 'AGENTS.md'], ['a skill', /flightdeck-status\/SKILL\.md$/, STATUS], ['the record', /^\.flightdeck\/installed\.json$/, '.flightdeck/installed.json']]) {
    const o = { fail };
    const app = boot({ picker: hooked(folderHandle('Team', asFiles(scenario('settled'))), o), indexedDB: memoryIDB() }); await app.tick(60);
    app.click('connect'); await app.tick(300);
    app.click('health'); await app.tick(800);
    const html = app.html();
    assert.ok(!/isn&#39;t in the team folder|Flightdeck skills? missing/.test(html), what + ': not called missing');
    assert.ok(/for AI assistants can&#39;t be read|for AI assistants couldn&#39;t be read/.test(html), what + ': said to be unreadable');
    assert.ok(html.indexOf(path_) > 0, what + ': named');
    assert.ok(!/The files for AI assistants (are current|match this version)/.test(html), what + ': no all-clear');
  }
  /* Without the record, nothing can be said about the other files. */
  const o = { fail: /^\.flightdeck\/installed\.json$/ };
  const app = boot({ picker: hooked(folderHandle('Team', asFiles(scenario('kept'))), o), indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(300);
  app.click('health'); await app.tick(800);
  assert.ok(!/No record of which defaults|for AI assistants to merge|from an older Flightdeck/.test(app.html()), 'no guess about the others');
});

rule('Round 2, 4: the writer inventory names what Settings writes on an established folder', () => {
  const d = fs.readFileSync(path.join(__dirname, '..', 'docs', 'design.md'), 'utf8');
  const row = (p) => d.split('\n').find(l => l.startsWith('  ' + p));
  ['AGENTS.md', '.flightdeck/skills/...', '.flightdeck/installed.json', '.flightdeck/updates/<version>/'].forEach(p => { assert.ok(row(p), p + ' has a row'); assert.ok(/Settings › AI assistant files/.test(row(p)), p + ': names Settings'); });
  assert.ok(/I merged it/.test(row('.flightdeck/updates/<version>/')) && /replaced\//.test(row('.flightdeck/updates/<version>/')), 'I merged it archives and removes');
});

/* ---------------- review round 3 ---------------- */

rule('Round 3, 1: a sync copy left after I merged it stays named in Folder health, with no all-clear', async () => {
  const dir = scenario('staged from 2.6.0'), stray = '.flightdeck/updates/2.6.0/AGENTS-PC.md';
  fs.writeFileSync(path.join(dir, stray), 'a copy OneDrive made');
  const files = asFiles(dir), app = boot({ picker: folderHandle('Team', files), indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  app.click('af-merged', STATUS); await wait(app);
  assert.ok(!('.flightdeck/updates/2.6.0/' + STATUS in files), 'set-up: the file itself was put away');
  assert.ok(stray in files, 'and the other stays');
  app.click('health'); await app.tick(800);
  const html = app.html();
  assert.ok(html.indexOf(stray) > 0, 'it is named');
  assert.ok(/waiting to be merged/.test(html), 'as waiting');
  assert.ok(!/The files for AI assistants (are current|match this version)/.test(html), 'with no all-clear');
});

rule('Round 3, 2: a remembered skills folder that is now the team folder is refused, restored or allowed again, and nothing is written', async () => {
  const OTHER_REC = '.flightdeck-installed.json';
  for (const perm of ['granted', 'prompt']) {
    const idb = memoryIDB(), bFiles = asFiles(scenario('deleted'));
    const b = Object.assign(folderHandle('Shared', bFiles), { queryPermission: () => Promise.resolve(perm), requestPermission: () => Promise.resolve('granted') });
    let pick = folderHandle('Team', asFiles(scenario('settled')));
    const app = boot({ picker: () => pick, indexedDB: idb }); await app.tick(60);
    app.click('connect'); await app.tick(200);
    app.click('ai-files'); await wait(app);
    app.click('af-where', 'other'); await app.tick(50);
    pick = b; app.click('af-pick'); await wait(app);
    assert.ok(/Using <b>Shared<\/b>/.test(app.html()), perm + ': set-up: chosen for skills');
    app.click('connect'); await app.tick(200);
    app.click('ai-files'); await wait(app);
    assert.ok(/data-af-status/.test(app.html()), perm + ': set-up: it is the team folder now');
    app.click('af-where', 'other'); await wait(app);
    const whole = app.html(), html = whole.slice(whole.indexOf('id="set-ai"'), whole.indexOf('</section>', whole.indexOf('id="set-ai"')));
    assert.ok(/the team folder\. Use In the team folder/i.test(html), perm + ': refused, in the picker\'s words');
    assert.ok(!/Using <b>Shared<\/b>|Allow Shared/.test(html), perm + ': not restored, and not offered');
    assert.ok(!/data-act="af-update"/.test(html), perm + ': nothing to update');
    app.click('af-update'); await wait(app);
    assert.ok(!(OTHER_REC in bFiles) && !Object.keys(bFiles).some(k => /^flightdeck-|^\.flightdeck-/.test(k)), perm + ': no standalone files in the team folder');
  }
  /* Allow again checks too: it can be the team folder by the time the person answers. */
  const idb = memoryIDB(), bFiles = {}, team = folderHandle('Team', asFiles(scenario('settled')));
  const b = Object.assign(folderHandle('Shared', bFiles), { queryPermission: () => Promise.resolve('granted'), requestPermission: () => Promise.resolve('granted') });
  const first = boot({ picker: () => b, indexedDB: idb }); await first.tick(60);
  first.click('nav', 'settings'); await first.tick(20); first.click('af-where', 'other'); await first.tick(30); first.click('af-pick'); await first.tick(100);
  b.queryPermission = () => Promise.resolve('prompt');
  let same = false; team.isSameEntry = () => Promise.resolve(same);
  const app = boot({ picker: () => team, indexedDB: idb }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  app.click('af-where', 'other'); await wait(app);
  assert.ok(/Allow Shared again/.test(app.html()), 'set-up: it asks');
  same = true; app.click('af-allow'); await wait(app);
  assert.ok(/the team folder\. Use In the team folder/i.test(app.html()), 'refused when allowed again');
  assert.ok(!/Using <b>Shared<\/b>/.test(app.html()), 'and not used');
  assert.deepStrictEqual(Object.keys(bFiles), [], 'nothing written');
});

rule('Round 3, 3: Update failing after leaving Settings is announced, naming the assistant files; not after a folder change, and not twice on Settings', async () => {
  const start = async () => {
    const o = {}, g = gate(), holder = { pick: hooked(folderHandle('Team', asFiles(scenario('deleted'))), o) };
    const app = boot({ picker: () => holder.pick, indexedDB: memoryIDB() }); await app.tick(60);
    app.click('connect'); await app.tick(200);
    app.click('ai-files'); await wait(app);
    o.wait = () => g.p; app.click('af-update'); await app.tick(40);
    return { app, holder, land: async () => { o.fail = /^AGENTS\.md$/; o.wait = null; g.open(); await wait(app); } };
  };
  const left = await start();
  left.app.click('nav', 'home'); await left.app.tick(40);
  assert.ok(!/AI assistant files/.test(left.app.live()), 'set-up: nothing said yet');
  await left.land();
  assert.ok(/AI assistant files/.test(left.app.live()), 'the screen reader hears it, naming the files: ' + left.app.live());
  const NOTICE = /class="notice warn"[^>]*><span>[^<]*AI assistant files/;
  assert.ok(NOTICE.test(left.app.html()), 'and Home shows it');
  assert.ok(/Open AI assistant files/.test(left.app.html()), 'with a way back');
  const moved = await start();
  moved.app.click('nav', 'home'); await moved.app.tick(40);
  moved.holder.pick = folderHandle('Second', asFiles(scenario('settled'))); moved.app.click('connect'); await moved.app.tick(200);
  await moved.land();
  assert.ok(!/AI assistant files/.test(moved.app.live()), 'the old folder\'s failure isn\'t said in the new one');
  const stayed = await start();
  await stayed.land();
  assert.ok(/af-err/.test(stayed.app.html()), 'on Settings, it shows where it was');
  assert.ok(!NOTICE.test(stayed.app.html()), 'once');
});

/* ---------------- review round 4 ---------------- */

/* The team folder's identity check answers per folder, when told to. */
async function twoFolders(perm, domFocus) {
  const idb = memoryIDB(), aFiles = {}, bFiles = {}, gates = { a: gate(), b: gate() };
  let aPerm = 'granted';
  const A = handle('Skills A', aFiles, { queryPermission: () => Promise.resolve(aPerm), requestPermission: () => (gates.allow ? gates.allow.p : Promise.resolve()).then(() => 'granted') });
  const B = handle('Skills B', bFiles, { queryPermission: () => Promise.resolve('granted') });
  const seed = boot({ picker: () => A, indexedDB: idb }); await seed.tick(60);
  seed.click('nav', 'settings'); await seed.tick(20); seed.click('af-where', 'other'); await seed.tick(30); seed.click('af-pick'); await seed.tick(100);
  aPerm = perm || 'granted';
  const team = folderHandle('Team', asFiles(scenario('settled')));
  team.isSameEntry = (d) => (d === A ? gates.a : gates.b).p.then(() => false);
  const w = { pick: team, A, B, aFiles, bFiles, gates };
  const app = w.app = boot({ picker: () => w.pick, indexedDB: idb, domFocus: !!domFocus }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  return w;
}
const section = (app) => { const h = app.html(), at = h.indexOf('id="set-ai"'); return h.slice(at, h.indexOf('</section>', at)); };
const usesB = async (w) => {
  assert.ok(/Using <b>Skills B<\/b>/.test(section(w.app)), 'the last choice is the one in use');
  w.app.click('af-update'); await wait(w.app); await wait(w.app);
  assert.ok(w.bFiles['.flightdeck-installed.json'], 'Update writes there');
  assert.deepStrictEqual(Object.keys(w.aFiles).filter(k => k !== '.flightdeck-installed.json' && !/SKILL|_flightdeck/.test(k)), [], 'and not to the earlier one');
};

rule('Round 4, 1: a remembered folder\'s check finishing after another is chosen changes nothing, and only the last choice is used', async () => {
  const w = await twoFolders(), app = w.app, before = JSON.stringify(w.aFiles);
  app.click('af-where', 'other'); await app.tick(60);
  w.pick = w.B; app.click('af-pick'); await app.tick(60);
  w.gates.a.open(); await wait(app);
  assert.ok(!/Using <b>Skills A<\/b>/.test(section(app)), 'A doesn\'t take over');
  w.gates.b.open(); await wait(app);
  await usesB(w);
  assert.strictEqual(JSON.stringify(w.aFiles), before, 'A is untouched');
});

rule('Round 4, 1: opening the picker drops a check still running, whatever the picker then does', async () => {
  const w = await twoFolders(), app = w.app, chooser = gate();
  app.click('af-where', 'other'); await app.tick(60);
  w.pick = chooser.p.then(() => w.B); app.click('af-pick'); await app.tick(40);
  w.gates.a.open(); await wait(app);
  assert.ok(!/Using <b>Skills A<\/b>/.test(section(app)), 'A doesn\'t land behind the open picker');
  w.gates.b.open(); chooser.open(); await wait(app);
  await usesB(w);
});

rule('Round 4, 1: Allow answered after another folder is chosen changes nothing', async () => {
  const w = await twoFolders('prompt'), app = w.app; w.gates.a.open();
  w.gates.allow = gate();
  app.click('af-where', 'other'); await wait(app);
  assert.ok(/Allow Skills A again/.test(section(app)), 'set-up: it asks');
  app.click('af-allow'); await app.tick(40);
  w.pick = w.B; app.click('af-pick'); await app.tick(40);
  w.gates.allow.open(); await app.tick(60);
  assert.ok(!/Using <b>Skills A<\/b>/.test(section(app)), 'the answer about A doesn\'t take over');
  w.gates.b.open(); await wait(app);
  await usesB(w);
});

const slowOther = async (domFocus) => {
  const other = {}, st = { armed: false, gate: gate() }, o = {};
  const dir = paused(hooked(handle('Skills', other, { queryPermission: () => Promise.resolve('granted') }), o), st);
  let pick = folderHandle('Team', asFiles(scenario('deleted')));
  const app = boot({ picker: () => pick, indexedDB: memoryIDB(), domFocus: !!domFocus }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.click('ai-files'); await wait(app);
  app.click('af-where', 'other'); await app.tick(50);
  pick = dir; app.click('af-pick'); await wait(app);
  st.armed = true; app.click('af-update'); await app.tick(100);
  assert.ok(st.reached, 'set-up: the Update is under way');
  return { app, other, st, o };
};

rule('Round 4, 2: asking for the team folder during a slow Update elsewhere says so, then goes there when it finishes', async () => {
  const { app, other, st } = await slowOther();
  app.click('nav', 'home'); await app.tick(20);
  app.click('ai-files'); await app.tick(60);
  assert.ok(/Using <b>Skills<\/b>/.test(section(app)) && /Working…/.test(section(app)), 'the Update carries on where it is');
  assert.ok(/Then this shows the team folder/.test(section(app)), 'and it says where it goes next');
  st.gate.open(); await wait(app); await wait(app);
  assert.ok(other['.flightdeck-installed.json'], 'the Update finished');
  const html = section(app);
  assert.ok(!/Using <b>Skills<\/b>/.test(html) && /data-af-row="AGENTS\.md"/.test(html), 'then the team folder is showing');
  assert.ok(/data-act="af-where" data-id="team" aria-pressed="true"/.test(html), 'and In the team folder is the one pressed');
  assert.ok(/data-af-status="(missing|new)"/.test(html), 'with that folder\'s own statuses');
  assert.ok(!/Then this shows/.test(html), 'and the promise is gone');
  assert.ok(/Showing the team folder/.test(app.live()), 'and it says it finished: ' + app.live());
});

rule('Round 4, 2: an Update that fails on the way still goes to the team folder, and says what failed', async () => {
  const { app, st, o } = await slowOther();
  app.click('nav', 'home'); await app.tick(20);
  app.click('ai-files'); await app.tick(60);
  o.fail = /./; st.gate.open(); await wait(app); await wait(app);
  const html = section(app);
  assert.ok(/data-af-row="AGENTS\.md"/.test(html), 'it goes');
  assert.ok(/AI assistant files/.test(app.live()) && /skills folder/.test(app.live()), 'and what failed, and where, is said: ' + app.live());
});

rule('Round 4, 2: without asking, the screen stays where the Update ran', async () => {
  const { app, st } = await slowOther();
  st.gate.open(); await wait(app); await wait(app);
  assert.ok(/Using <b>Skills<\/b>/.test(section(app)) && !/Then this shows/.test(section(app)));
});

/* ---------------- review round 5 ---------------- */

const MAX = 8 * 1048576, SKILL = 'flightdeck-status/SKILL.md';
/* AGENTS.md from an older default whose merge comes to exactly `size` bytes, with Team notes padding it out. */
function bigAgents(size, wide) {
  const dir = scenario('older defaults'), at = path.join(dir, 'AGENTS.md'), base = fs.readFileSync(at, 'utf8');
  const room = size - Buffer.byteLength(K.merged('AGENTS.md', base, EX['AGENTS.md']));
  const pairs = wide ? Math.floor(room / 2) : 0;
  const text = base + 'é'.repeat(pairs) + 'x'.repeat(room - pairs * 2);
  fs.writeFileSync(at, text);
  assert.strictEqual(Buffer.byteLength(K.merged('AGENTS.md', text, EX['AGENTS.md'])), size, 'set-up: the merge comes to the size');
  return dir;
}
const snapshot = (dir) => { const o = asFiles(dir); delete o['flightdeck.html']; return JSON.stringify(o); };
const firstSentence = (t) => { const m = /(AGENTS\.md|\S*installed\.json) would be too big[^.]*\.\d+ MB[^.]*\.\s*Nothing was changed\./.exec(t); return m && m[0]; };

rule('Round 5, 1: the app and the command agree: a merge over the read limit changes nothing, and one exactly at it is written', async () => {
  if (OLD_AGENTS == null) return;
  for (const wide of [false, true]) {
    const name = wide ? 'wide characters' : 'plain';
    const over = bigAgents(MAX + 1, wide), before = snapshot(over), rawBefore = fs.readFileSync(path.join(over, 'AGENTS.md'));
    /* The app, on its own copy of the same folder. */
    const files = asFiles(over), kept = JSON.stringify(files), app = await openTeam(files);
    app.click('ai-files'); await app.tick(1500);
    assert.ok(/data-act="af-update"/.test(app.html()), name + ': set-up: the file can be read and updated');
    app.click('af-update'); await app.tick(1500);
    const said = app.html().replace(/&#39;/g, "'");
    assert.strictEqual(JSON.stringify(files), kept, name + ': the app changes nothing');
    assert.ok(firstSentence(said), name + ': the app says so: ' + (said.match(/af-err[^<]*<?[^<]{0,160}/) || [''])[0]);
    assert.ok(!/Working…/.test(said), name + ': and isn\'t stuck');
    /* The command. */
    const r = cli('install', over);
    assert.notStrictEqual(r.code, 0, name + ': the command refuses: ' + r.out.slice(0, 160));
    assert.strictEqual(snapshot(over), before, name + ': the command changes nothing');
    assert.ok(fs.readFileSync(path.join(over, 'AGENTS.md')).equals(rawBefore));
    assert.strictEqual(firstSentence(r.out), firstSentence(said), name + ': in the same words');
  }
  /* Exactly at the limit both write, and read it back. */
  const fits = bigAgents(MAX), files = asFiles(fits), app = await openTeam(files);
  app.click('ai-files'); await app.tick(1500);
  app.click('af-update'); await app.tick(2500);
  assert.ok(files['AGENTS.md'].includes(EX['AGENTS.md'].slice(0, 40)) && Buffer.byteLength(files['AGENTS.md']) === MAX, 'the app writes it');
  assert.ok(!firstSentence(app.html().replace(/&#39;/g, "'")), 'and says nothing of size');
  assert.strictEqual(cli('install', fits).code, 0, 'the command writes it');
  assert.strictEqual(Buffer.byteLength(fs.readFileSync(path.join(fits, 'AGENTS.md'))), MAX);
});

rule('Round 5, 1: a record too big for the app is too big for the command, and nothing changes', async () => {
  if (OLD_AGENTS == null) return;
  const dir = scenario('deleted'), r = JSON.parse(fs.readFileSync(path.join(dir, '.flightdeck/installed.json'), 'utf8')), HASH = 'e'.repeat(64);
  r.version = '2.6.0';
  const room = MAX - 200 - JSON.stringify(r).length, each = JSON.stringify({ 'old/0000000.md': HASH }).length - 1;
  for (let i = 0; i < Math.floor(room / each); i++) r.files['old/' + String(i).padStart(7, '0') + '.md'] = HASH;
  fs.writeFileSync(path.join(dir, '.flightdeck/installed.json'), JSON.stringify(r));
  const before = snapshot(dir), out = cli('install', dir);
  assert.notStrictEqual(out.code, 0, 'refused: ' + out.out.slice(0, 160));
  assert.ok(/too big/.test(out.out) && /Nothing was changed/.test(out.out), 'in plain words');
  assert.strictEqual(snapshot(dir), before, 'nothing changed');
  assert.ok(!fs.existsSync(path.join(dir, PLAN)), 'the deleted file isn\'t written');
});

rule('Round 5, 2: a target change in the background puts focus on the heading when it removes what had focus, and only then', async () => {
  const dk = (app, k) => app.PF.vk.domKey(k);
  /* The team folder asked for during an Update elsewhere, with a file's text focused. */
  let t = await slowOther(true);
  t.app.click('nav', 'home'); await t.app.tick(20);
  t.app.click('ai-files'); await t.app.tick(60);
  t.app.click('af-peek', SKILL); await t.app.tick(5);
  t.app.node('#af-pre-' + dk(t.app, SKILL)).focus();
  t.st.gate.open(); await wait(t.app); await wait(t.app);
  assert.ok(/data-af-row="AGENTS\.md"/.test(section(t.app)), 'set-up: it moved');
  assert.strictEqual(t.app.activeId(), 'set-ai', 'the heading, never the page');
  /* What's still there keeps focus. */
  t = await slowOther(true);
  t.app.click('nav', 'home'); await t.app.tick(20);
  t.app.click('ai-files'); await t.app.tick(60);
  t.app.node('[data-act="af-where"][data-id="other"]').focus();
  t.st.gate.open(); await wait(t.app); await wait(t.app);
  assert.ok(/af-where/.test(t.app.activeId()), 'the target buttons stay, so focus does: ' + t.app.activeId());
  /* A dialog keeps it. */
  t = await slowOther(true);
  t.app.click('nav', 'home'); await t.app.tick(20);
  t.app.click('ai-files'); await t.app.tick(60);
  t.app.click('af-peek', SKILL); await t.app.tick(5);
  t.app.click('help'); await t.app.tick(5);
  const inDialog = t.app.activeId();
  assert.notStrictEqual(inDialog, 'set-ai', 'set-up');
  t.st.gate.open(); await wait(t.app); await wait(t.app);
  assert.strictEqual(t.app.activeId(), inDialog, 'an open dialog keeps focus');
  /* A remembered folder landing after a file was opened: same class, a state change no one pressed anything for. */
  const w = await twoFolders('granted', true);
  w.app.click('af-where', 'other'); await w.app.tick(60);
  w.app.click('af-peek', SKILL); await w.app.tick(5);
  w.app.node('#af-pre-' + dk(w.app, SKILL)).focus();
  w.gates.a.open(); await wait(w.app);
  assert.ok(/Using <b>Skills A<\/b>/.test(section(w.app)), 'set-up: it landed');
  assert.strictEqual(w.app.activeId(), 'set-ai', 'the text closed, so the heading');
});

/* How each write ends, with what's covering Settings. A case is a folder, what goes wrong, and what the person must hear. */
const COVERS = { 'a dialog': (app) => app.click('help'), 'another screen': (app) => app.click('nav', 'home') };
rule('Round 5, 3: however a write ends, it is announced when Settings is covered, and not doubled when it is not', async () => {
  const OUTCOMES = {
    'Update fails': { scenario: 'deleted', act: ['af-update'], go(c) { c.o.fail = /^AGENTS\.md$/; }, hear: /AI assistant files/, kind: 'warn' },
    'Update skips a changed file': { scenario: 'deleted', act: ['af-update'], race: PLAN, go() {}, hear: /AI assistant files[^]*1 file changed|1 file changed[^]*AI assistant files|Finished[^]*1 file changed/, kind: 'warn' },
    'Update finishes': { scenario: 'deleted', act: ['af-update'], go() {}, hear: /AI assistant files are updated/, kind: 'good' },
    'the check after it fails': { scenario: 'deleted', act: ['af-update'], go(c) { c.o.fail = { test: (p) => p === 'AGENTS.md' && PLAN in c.files }; }, hear: /AI assistant files/, kind: 'warn' },
    'I merged it finishes': { scenario: 'staged from 2.6.0', act: ['af-merged', STATUS], go() {}, hear: /AI assistant files[^]*Put away/, kind: 'good' },
    'I merged it fails': { scenario: 'staged from 2.6.0', act: ['af-merged', STATUS], go(c) { c.o.fail = /updates\/2\.6\.0/; }, hear: /AI assistant file/, kind: 'warn' }
  };
  for (const name of Object.keys(OUTCOMES)) for (const cover of Object.keys(COVERS).concat('nothing')) {
    const X = OUTCOMES[name], raw = asFiles(scenario(X.scenario)), o = {}, g = gate();
    /* Someone writes the file between Update's own read and its write: the second time it's looked for after the click. */
    let racing = false, looks = 0;
    const files = new Proxy(raw, { has(t, k) { if (racing && k === X.race && ++looks === 2) t[k] = 'someone else wrote this'; return k in t; } }), c = { files, o };
    const app = boot({ picker: hooked(folderHandle('Team', files), o), indexedDB: memoryIDB(), domFocus: true }); await app.tick(60);
    app.click('connect'); await app.tick(200);
    app.click('ai-files'); await wait(app);
    racing = !!X.race; o.wait = () => g.p; app.click(...X.act); await app.tick(30);
    if (COVERS[cover]) { COVERS[cover](app); await app.tick(10); }
    const liveBefore = app.live();
    X.go(c); o.wait = null; g.open(); await wait(app); await wait(app);
    const label = name + ' under ' + cover + ': ';
    if (cover === 'nothing') { assert.strictEqual(app.live(), liveBefore, label + 'the screen shows it, so nothing extra is said: ' + app.live()); continue; }
    assert.ok(X.hear.test(app.live()), label + 'said: ' + app.live());
  }
});

rule('Round 5, 3: a dialog over Settings doesn\'t change a move to the team folder: it still says how the write ended', async () => {
  const t = await slowOther(true);
  t.app.click('nav', 'home'); await t.app.tick(20);
  t.app.click('ai-files'); await t.app.tick(60);
  t.app.click('help'); await t.app.tick(5);
  t.st.gate.open(); await wait(t.app); await wait(t.app);
  assert.ok(/Showing the team folder/.test(t.app.live()), t.app.live());
});

run();
