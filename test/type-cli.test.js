// flightdeck type list, type read and type save (2.14, slice A2), run in this process against real temporary folders, with
// test hooks (FD._hooks) and fs shims standing in for another writer, a full disk or a folder that refuses hard links. Every
// output is checked against its schema (flightdeck-write/1, or SCHEMA2's stepType and stepTypes inside flightdeck-read/2).
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const { rule, run, load } = require('./harness');

const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js');
const FD = require(BIN);
const PF = load(), AJ = PF.appjson, T = PF.types, U = PF.util, TL = PF.timeline;
const plain = (v) => JSON.parse(JSON.stringify(v));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-type-')));
const err = (code) => Object.assign(new Error(code + ': from a test shim'), { code });
const ROOT_USER = typeof process.getuid === 'function' && process.getuid() === 0;
/* Whether this file system tells x.json and X.json apart (APFS and NTFS usually don't). */
const CASE_SENSITIVE = (() => { const d = tmp(); fs.writeFileSync(path.join(d, 'a'), ''); return !fs.existsSync(path.join(d, 'A')); })();

const DEF = { id: 'sample.check', label: 'Sample check', hint: 'Checks a sample.', fields: { system: { label: 'System', kind: 'text' } }, record: [{ name: 'approval', label: 'Approval', kind: 'text' }] };
const PEOPLE = JSON.stringify([{ id: 'person-avery', name: 'Avery Lee', folderRole: 'owner' }, { id: 'person-blake', name: 'Blake Kim', inactive: true }, { id: 'person-casey', name: 'Casey Ng' }, { id: 'person-casey', name: 'Casey Two', inactive: true }]);
const def = (o) => Object.assign(JSON.parse(JSON.stringify(DEF)), o || {});
const text = (d) => T.fileText(d);

function team(files) {
  const dir = tmp();
  Object.keys(files || {}).forEach((p) => { const f = path.join(dir, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, files[p]); });
  return dir;
}
const at = (dir, id) => path.join(dir, 'step-types', id + '.json');
/* Every file and link under dir (relative paths), for "nothing was written" checks. */
function scan(dir) {
  const out = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), rel = path.relative(dir, p).split(path.sep).join('/'); if (e.isDirectory()) { out.push(rel + '/'); walk(p); } else out.push(rel); } })(dir);
  return out.sort();
}
const WRITE_SCHEMA = () => AJ.WRITE1;
async function cmd(...argv) {
  const r = await FD.main(argv);
  const json = JSON.parse(r.out);
  return { code: r.code, json };
}
function inputFile(body) { const f = path.join(tmp(), 'in.json'); fs.writeFileSync(f, body); return f; }
async function save(dir, id, d, expect, extra) {
  const body = Buffer.isBuffer(d) ? d : typeof d === 'string' ? d : JSON.stringify(d, null, 2);
  const r = await cmd('type', 'save', dir, id, '--expect', expect, '--from', inputFile(body), '--json', ...(extra || []));
  assert.deepStrictEqual(plain(AJ.conforms(r.json, WRITE_SCHEMA())), [], 'flightdeck-write/1: ' + JSON.stringify(r.json).slice(0, 400));
  assert.strictEqual(r.json.contract, 'flightdeck-write/1');
  assert.strictEqual(r.code, PF.save.EXIT[r.json.outcome], 'exit code for ' + r.json.outcome);
  return r;
}
async function read(dir, id) {
  const r = await cmd('type', 'read', dir, id, '--json');
  if (r.json.data) assert.deepStrictEqual(plain(AJ.conforms(r.json.data, AJ.SCHEMA2.stepType)), [], 'stepType: ' + JSON.stringify(r.json.data).slice(0, 300));
  assert.deepStrictEqual(plain(AJ.conforms(r.json, r.json.data ? AJ.SCHEMA2.envelope : AJ.SCHEMA2.error)), [], 'read/2 envelope');
  return r;
}
async function list(dir) {
  const r = await cmd('type', 'list', dir, '--json');
  if (r.json.data) assert.deepStrictEqual(plain(AJ.conforms(r.json.data, AJ.SCHEMA2.stepTypes)), [], 'stepTypes: ' + JSON.stringify(r.json.data).slice(0, 300));
  return r;
}
async function revOf(dir, id) { const r = await read(dir, id); return r.json.data.type.rev; }
/* fs shims, undone however the rule ends. */
async function shims(list, f) {
  const undo = list.map(([name, make]) => { const was = fs[name]; fs[name] = make(was); return () => { fs[name] = was; }; });
  try { return await f(); } finally { undo.reverse().forEach((u) => u()); }
}
async function hooks(h, f) {
  Object.assign(FD._hooks, h);
  try { return await f(); } finally { Object.keys(h).forEach((k) => { delete FD._hooks[k]; }); }
}
/* Which paths each open descriptor points at, for spies. */
function tracking() {
  const byFd = {};
  return { byFd, shim: ['openSync', (was) => function (p) { const fd = was.apply(fs, arguments); byFd[fd] = String(p); return fd; }] };
}
const tmpNames = (dir) => scan(dir).filter((p) => /\.(tmp|probe)$/.test(p));
const historyFiles = (dir, id) => { try { return fs.readdirSync(path.join(dir, 'history', 'step-types', id)); } catch (e) { return []; } };

/* ======================= the create path ======================= */
for (const code of ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']) {
  rule('Link probe: the probe link fails with ' + code + ': no-links, exit 1, the target never existed, the temp removed', async () => {
    const dir = team({});
    const r = await shims([['linkSync', (was) => (a, b) => { if (/\.probe$/.test(b)) throw err(code); return was(a, b); }]], () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.code, r.json.written], ['refused', 'no-links', 1, false]);
    assert.ok(/doesn't allow hard links/.test(r.json.words), r.json.words);
    assert.ok(!fs.existsSync(at(dir, 'sample.check')));
    assert.deepStrictEqual(tmpNames(dir), []);
    assert.strictEqual(r.json.cleanup, null);
    assert.strictEqual(r.json.history, null);
  });
}
rule('Link probe: links refused and the temp can\'t be removed either: no-links, and the temp named in cleanup with its error', async () => {
  const dir = team({});
  const r = await shims([['linkSync', (was) => (a, b) => { if (/\.probe$/.test(b)) throw err('EPERM'); return was(a, b); }], ['unlinkSync', (was) => (p) => { if (/\.tmp$/.test(p)) throw err('EBUSY'); return was(p); }]], () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'no-links']);
  assert.strictEqual(r.json.cleanup.leftover.length, 1);
  assert.ok(/^step-types\/\..*\.tmp$/.test(r.json.cleanup.leftover[0]) && /EBUSY/.test(r.json.cleanup.why), JSON.stringify(r.json.cleanup));
  assert.deepStrictEqual(tmpNames(dir), r.json.cleanup.leftover);
  assert.ok(/A temporary file was left at/.test(r.json.words));
});
for (const code of ['EIO', 'ENOSPC']) {
  rule('Link probe: the probe link fails with ' + code + ': failed/link-check with the real error, never "doesn\'t allow hard links"', async () => {
    const dir = team({});
    const r = await shims([['linkSync', (was) => (a, b) => { if (/\.probe$/.test(b)) throw err(code); return was(a, b); }]], () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.code], ['failed', 'link-check', 1]);
    assert.ok(r.json.error.why.indexOf(code) >= 0 && !/doesn't allow hard links/.test(r.json.words), r.json.words);
    assert.ok(!fs.existsSync(at(dir, 'sample.check')));
  });
}
rule('Link probe: the probe link works but its unlink fails: failed/link-check, the probe named in cleanup, no commit attempted', async () => {
  const dir = team({});
  let targetLinks = 0;
  const r = await shims([['linkSync', (was) => (a, b) => { if (/sample\.check\.json$/.test(b)) targetLinks++; return was(a, b); }], ['unlinkSync', (was) => (p) => { if (/\.probe$/.test(p)) throw err('EBUSY'); return was(p); }]], () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['failed', 'link-check']);
  assert.strictEqual(targetLinks, 0);
  assert.ok(r.json.cleanup.leftover.some((p) => /\.probe$/.test(p)), JSON.stringify(r.json.cleanup));
  assert.ok(!fs.existsSync(at(dir, 'sample.check')));
  tmpNames(dir).forEach((p) => fs.unlinkSync(path.join(dir, p)));
});
for (const orphan of ['sample.check (1).json', 'sample.check-LAPTOP.json']) {
  rule('Copies: an orphan ' + orphan + ' with no sample.check.json, present at R1: copies before any temp file', async () => {
    const dir = team({ ['step-types/' + orphan]: text(DEF) }), tr = tracking();
    const r = await shims([tr.shim], () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.json.written], ['refused', 'copies', false]);
    assert.ok(r.json.words.indexOf(orphan) >= 0 && /A person decides which to keep/.test(r.json.words), r.json.words);
    assert.ok(!Object.values(tr.byFd).some((p) => /\.tmp$/.test(p)), 'no temp file was made');
    assert.deepStrictEqual(scan(dir), ['step-types/', 'step-types/' + orphan]);
  });
  rule('Copies: an orphan ' + orphan + ' written at C (beforeCompare): copies, the temp removed', async () => {
    const dir = team({});
    const r = await hooks({ beforeCompare: () => { fs.mkdirSync(path.join(dir, 'step-types'), { recursive: true }); fs.writeFileSync(path.join(dir, 'step-types', orphan), text(DEF)); } }, () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'copies']);
    assert.deepStrictEqual(scan(dir), ['step-types/', 'step-types/' + orphan]);
  });
}
for (const variant of ['Sample.check-LAPTOP.json', 'sample.check-LAPTOP.JSON']) for (const there of [true, false]) {
  rule('Copies: case variant ' + variant + ', sample.check.json ' + (there ? 'present (edit)' : 'absent (create)') + ', at R1 and at C: copies, nothing created or replaced', async () => {
    const files = there ? { 'step-types/sample.check.json': text(DEF) } : {};
    const d1 = team(Object.assign({ ['step-types/' + variant]: '{}' }, files));
    const exp1 = there ? sha(text(DEF)) : 'none';
    const r1 = await save(d1, 'sample.check', def({ label: 'Changed' }), exp1);
    assert.deepStrictEqual([r1.json.outcome, r1.json.error.kind], ['refused', 'copies']);
    const d2 = team(files);
    const r2 = await hooks({ beforeCompare: () => { fs.mkdirSync(path.join(d2, 'step-types'), { recursive: true }); fs.writeFileSync(path.join(d2, 'step-types', variant), '{}'); } }, () => save(d2, 'sample.check', def({ label: 'Changed' }), exp1));
    assert.deepStrictEqual([r2.json.outcome, r2.json.error.kind], ['refused', 'copies']);
    for (const d of [d1, d2]) {
      assert.deepStrictEqual(tmpNames(d), []);
      if (there) assert.strictEqual(fs.readFileSync(at(d, 'sample.check'), 'utf8'), text(DEF)); else assert.ok(!fs.existsSync(at(d, 'sample.check')));
    }
  });
}
rule('Copies: competing bases: release.json, and release-prod-LAPTOP.json at R1 or written at C: type save release-prod --expect none refuses copies both times', async () => {
  const rel = { id: 'release', label: 'Release' }, prod = { id: 'release-prod', label: 'Release prod' };
  const d1 = team({ 'step-types/release.json': text(rel), 'step-types/release-prod-LAPTOP.json': text(prod) });
  const r1 = await save(d1, 'release-prod', prod, 'none');
  assert.deepStrictEqual([r1.json.outcome, r1.json.error.kind], ['refused', 'copies']);
  const r1b = await save(d1, 'release', def({ id: 'release', label: 'Release 2' }), sha(text(rel)));
  assert.deepStrictEqual([r1b.json.outcome, r1b.json.error.kind], ['refused', 'copies'], 'ambiguous names refuse for both');
  const d2 = team({ 'step-types/release.json': text(rel) });
  const r2 = await hooks({ beforeCompare: () => fs.writeFileSync(path.join(d2, 'step-types', 'release-prod-LAPTOP.json'), text(prod)) }, () => save(d2, 'release-prod', prod, 'none'));
  assert.deepStrictEqual([r2.json.outcome, r2.json.error.kind], ['refused', 'copies']);
  assert.ok(!fs.existsSync(at(d1, 'release-prod')) && !fs.existsSync(at(d2, 'release-prod')));
});

/* Pre-commit failures, shared by both write functions: each a shim on the temp file's descriptor. */
function preCommit(name, mk) {
  return { name, mk };
}
const PRE = [
  preCommit('the temp write returns short and then 0 (the disk accepted no more bytes)', (tr) => ['writeSync', (was) => { let n = 0; return function (fd, buf, off, len) { if (/\.tmp$/.test(tr.byFd[fd] || '')) { n++; return n === 1 ? was.call(fs, fd, buf, off, Math.max(1, Math.floor(len / 2))) : 0; } return was.apply(fs, arguments); }; }]),
  preCommit('the temp write throws ENOSPC', (tr) => ['writeSync', (was) => function (fd) { if (/\.tmp$/.test(tr.byFd[fd] || '')) throw err('ENOSPC'); return was.apply(fs, arguments); }]),
  preCommit('fsync throws EIO', (tr) => ['fsyncSync', (was) => function (fd) { if (/\.tmp$/.test(tr.byFd[fd] || '')) throw err('EIO'); return was.apply(fs, arguments); }]),
  preCommit('the temp read-back throws', (tr) => ['readSync', (was) => function (fd) { if (/\.tmp$/.test(tr.byFd[fd] || '')) throw err('EIO'); return was.apply(fs, arguments); }]),
  preCommit('the temp read-back returns different bytes', (tr) => ['readSync', (was) => function (fd, buf, off) { const n = was.apply(fs, arguments); if (n > 0 && /\.tmp$/.test(tr.byFd[fd] || '')) buf[off || 0] ^= 1; return n; }])
];
for (const replace of [false, true]) for (const p of PRE) for (const stuck of [false, true]) {
  rule('Pre-commit failure in ' + (replace ? 'safeReplace' : 'safeCreate') + ': ' + p.name + (stuck ? ', and the temp unlink fails' : '') + ': failed, nothing committed, exact cleanup', async () => {
    const dir = team(replace ? { 'step-types/sample.check.json': text(DEF) } : {}), tr = tracking();
    const before = replace ? fs.statSync(at(dir, 'sample.check')) : null;
    let commits = 0;
    const list = [tr.shim, p.mk(tr), ['linkSync', (was) => (a, b) => { if (/sample\.check\.json$/.test(b)) commits++; return was(a, b); }], ['renameSync', (was) => (a, b) => { commits++; return was(a, b); }]];
    if (stuck) list.push(['unlinkSync', (was) => (q) => { if (/\.tmp$/.test(q)) throw err('EBUSY'); return was(q); }]);
    const r = await shims(list, () => save(dir, 'sample.check', def({ label: 'Changed' }), replace ? sha(text(DEF)) : 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.written, r.code], ['failed', false, 1], JSON.stringify(r.json.error));
    assert.strictEqual(commits, 0, 'no commit syscall');
    assert.strictEqual(r.json.history, null);
    assert.deepStrictEqual(historyFiles(dir, 'sample.check'), []);
    if (replace) { const now = fs.statSync(at(dir, 'sample.check')); assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(DEF)); assert.strictEqual(now.ino, before.ino); }
    else assert.ok(!fs.existsSync(at(dir, 'sample.check')));
    if (stuck) { assert.strictEqual(r.json.cleanup.leftover.length, 1); assert.deepStrictEqual(tmpNames(dir), r.json.cleanup.leftover); assert.ok(/EBUSY/.test(r.json.cleanup.why)); }
    else { assert.strictEqual(r.json.cleanup, null); assert.deepStrictEqual(tmpNames(dir), []); }
  });
}
rule('History built before T: an original with "tags":[{"toString":null}] goes in as before: null (it fails checkCustom), and the repair goes ahead', async () => {
  const bad = '{\n  "id": "sample.check",\n  "label": "Sample",\n  "tags": [{"toString": null}]\n}\n';
  const dir = team({ 'step-types/sample.check.json': bad });
  const r = await save(dir, 'sample.check', DEF, sha(bad));
  assert.strictEqual(r.json.outcome, 'done', r.json.words);
  assert.strictEqual(r.json.existing, 'malformed');
  assert.deepStrictEqual(r.json.checks.omitted, { before: 'invalid', after: null });
  const line = JSON.parse(fs.readFileSync(path.join(dir, r.json.history.path), 'utf8'));
  assert.strictEqual(line.before, null);
  assert.deepStrictEqual(line.after, DEF);
});
rule('History built before T: histLine throwing once gives the metadata-only line; throwing twice is failed before any temp file', async () => {
  const dir = team({});
  const r = await hooks({ engine: (eng) => { const h = eng.PF.timeline.histLine; let n = 0; eng.PF.timeline.histLine = function (o) { if (n++ === 0) throw new Error('shim'); return h(o); }; } }, () => save(dir, 'sample.check', DEF, 'none'));
  assert.strictEqual(r.json.outcome, 'done');
  assert.deepStrictEqual(r.json.checks.omitted, { before: null, after: 'fallback' });
  assert.ok(r.json.checks.warnings.indexOf('History records this save without its contents.') >= 0, JSON.stringify(r.json.checks.warnings));
  const line = JSON.parse(fs.readFileSync(path.join(dir, r.json.history.path), 'utf8'));
  assert.ok(line.to && line.after == null && line.source === 'agent' && line.units.length === 1, JSON.stringify(line));
  const d2 = team({ 'step-types/sample.check.json': '{"id":' }), tr = tracking();
  const r2 = await shims([tr.shim], () => hooks({ engine: (eng) => { eng.PF.timeline.histLine = () => { throw new Error('shim'); }; } }, () => save(d2, 'sample.check', DEF, sha('{"id":'))));
  assert.deepStrictEqual([r2.json.outcome, r2.json.written], ['failed', false]);
  assert.ok(!Object.values(tr.byFd).some((p) => /\.tmp$/.test(p)), 'no temp file');
  assert.strictEqual(fs.readFileSync(at(d2, 'sample.check'), 'utf8'), '{"id":');
  assert.ok(r2.json.checks.warnings.indexOf('History records this save without the previous version (it wasn\'t a valid step type).') >= 0);
});
rule('afterCompare with --expect none: someone creates the file: changed, their file kept byte for byte, no history', async () => {
  const dir = team({}), theirs = text(def({ label: 'Theirs' }));
  const r = await hooks({ afterCompare: (t) => fs.writeFileSync(t, theirs) }, () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.json.written], ['refused', 'changed', false]);
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), theirs);
  assert.deepStrictEqual(historyFiles(dir, 'sample.check'), []);
  assert.deepStrictEqual(tmpNames(dir), []);
});
rule('Identical-bytes competitor: someone creates the file with our exact bytes after C: changed, written false, nothing read back, no history', async () => {
  const dir = team({});
  const r = await hooks({ afterCompare: (t) => fs.writeFileSync(t, text(DEF)) }, () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.json.written, r.json.back, r.json.rev.now], ['refused', 'changed', false, null, null]);
  assert.strictEqual(r.json.history, null);
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(DEF), 'the competitor\'s file holds those bytes (read by the test, not reported)');
});
rule('afterLink: a hook throwing right after linkSync returns: written true, outcome from the read-back, history attempted', async () => {
  const dir = team({});
  const r = await hooks({ afterLink: () => { throw new Error('after link'); } }, () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.written, r.json.back], ['done', true, 'same']);
  assert.strictEqual(r.json.history.written, true);
});
rule('atUnlink: the temp unlink fails after the link: partial/cleanup, exit 4, written true, the leftover named, history written, the target ours', async () => {
  const dir = team({});
  const r = await hooks({ atUnlink: () => { throw err('EBUSY'); } }, () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.code, r.json.written], ['partial', 'cleanup', 4, true]);
  assert.ok(r.json.cleanup.leftover.length === 1 && /\.tmp$/.test(r.json.cleanup.leftover[0]));
  assert.strictEqual(r.json.history.written, true);
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(DEF));
  assert.ok(/a temporary file was left at/.test(r.json.words) && /It's safe to delete/.test(r.json.words), r.json.words);
});
rule('atUnlink with history also failing: partial/history; cleanup still reported', async () => {
  const dir = team({ 'history/step-types/sample.check': 'a file where a folder goes' });
  const r = await hooks({ atUnlink: () => { throw err('EBUSY'); } }, () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['partial', 'history']);
  assert.strictEqual(r.json.history.written, false);
  assert.ok(r.json.cleanup && r.json.cleanup.leftover.length === 1);
});
rule('Link throws EIO with the target absent: unsure, written null, no history', async () => {
  const dir = team({});
  const r = await shims([['linkSync', (was) => (a, b) => { if (/sample\.check\.json$/.test(b)) throw err('EIO'); return was(a, b); }]], () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.written, r.code], ['unsure', null, 4]);
  assert.strictEqual(r.json.history, null);
  assert.deepStrictEqual(historyFiles(dir, 'sample.check'), []);
  assert.ok(/may or may not have been written by this command/.test(r.json.words) && /No history line was written/.test(r.json.words));
});
rule('Link throws EIO after the shim really created the target with our inode: still unsure, no history', async () => {
  const dir = team({});
  const r = await shims([['linkSync', (was) => (a, b) => { if (/sample\.check\.json$/.test(b)) { was(a, b); throw err('EIO'); } return was(a, b); }]], () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.written], ['unsure', null]);
  assert.strictEqual(r.json.back, 'same', 'read for information only');
  assert.strictEqual(r.json.history, null);
});
rule('The temp unlink fails on a refusal path: still the refusal, exit 1, the leftover named', async () => {
  const dir = team({});
  const r = await shims([['unlinkSync', (was) => (p) => { if (/\.tmp$/.test(p)) throw err('EBUSY'); return was(p); }]], () => hooks({ afterCompare: (t) => fs.writeFileSync(t, 'x') }, () => save(dir, 'sample.check', DEF, 'none')));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.code], ['refused', 'changed', 1]);
  assert.deepStrictEqual(tmpNames(dir), r.json.cleanup.leftover);
  tmpNames(dir).forEach((p) => fs.unlinkSync(path.join(dir, p)));
});
rule('History commit: the history folder is a link or a file: partial/history, history.written false, exit 4, the save stands, nothing outside', async () => {
  const outside = tmp();
  for (const kind of ['link', 'file']) {
    const dir = team({});
    fs.mkdirSync(path.join(dir, 'history', 'step-types'), { recursive: true });
    if (kind === 'link') fs.symlinkSync(outside, path.join(dir, 'history', 'step-types', 'sample.check')); else fs.writeFileSync(path.join(dir, 'history', 'step-types', 'sample.check'), 'x');
    const r = await save(dir, 'sample.check', DEF, 'none');
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.code, r.json.written, r.json.history.written], ['partial', 'history', 4, true, false], kind);
    assert.ok(/its history line couldn't be written/.test(r.json.words) && /The save stands; don't save it again\./.test(r.json.words), r.json.words);
  }
  assert.deepStrictEqual(fs.readdirSync(outside), []);
});
for (const created of [false, true]) {
  rule('History commit: the history link throws EIO with the line ' + (created ? 'really created' : 'absent') + ' afterward: history.written null, "couldn\'t confirm its history line"; the target written true', async () => {
    const dir = team({});
    const r = await shims([['linkSync', (was) => (a, b) => { if (/agent-.*\.jsonl$/.test(b)) { if (created) was(a, b); throw err('EIO'); } return was(a, b); }]], () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.json.written, r.json.history.written], ['partial', 'history', true, null]);
    assert.ok(/couldn't confirm its history line/.test(r.json.words), r.json.words);
  });
}
for (const [back, change, want] of [['other', (t) => fs.writeFileSync(t + '.x', 'theirs') || fs.renameSync(t + '.x', t), 'replaced'], ['missing', (t) => fs.unlinkSync(t), 'replaced'], ['unreadable', (t) => { fs.unlinkSync(t); fs.mkdirSync(t); }, 'unverified']]) {
  rule('History commit unknown with back ' + back + ': ' + want + ' with the confirm sentence', async () => {
    const dir = team({});
    const r = await shims([['linkSync', (was) => (a, b) => { if (/agent-.*\.jsonl$/.test(b)) throw err('EIO'); return was(a, b); }]], () => hooks({ afterCommit: change }, () => save(dir, 'sample.check', DEF, 'none')));
    assert.deepStrictEqual([r.json.outcome, r.json.back, r.json.history.written], [want, back, null]);
    assert.ok(/Flightdeck couldn't confirm its history line either/.test(r.json.words), r.json.words);
  });
}

/* ======================= the replace path ======================= */
const NEW = def({ label: 'Sample check, changed' });
async function edited(files) { const dir = team(Object.assign({ 'step-types/sample.check.json': text(DEF) }, files || {})); return { dir, rev: await revOf(dir, 'sample.check') }; }
rule('Replace: afterRead and beforeCompare hand edits: changed, the hand edit kept byte for byte, no temp file, no history', async () => {
  for (const when of ['afterRead', 'beforeCompare']) {
    const { dir, rev } = await edited(), hand = text(def({ label: 'Hand edit' }));
    const r = await hooks({ [when]: (t) => fs.writeFileSync(t, hand) }, () => save(dir, 'sample.check', NEW, rev));
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.json.written], ['refused', 'changed', false], when);
    assert.ok(/changed since you read it/.test(r.json.words));
    assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), hand);
    assert.deepStrictEqual(tmpNames(dir), []);
    assert.deepStrictEqual(historyFiles(dir, 'sample.check'), []);
  }
});
rule('Replace: a 1 GB sparse replacement between R1 and C: changed, and C reads at most seen.length + 1 bytes', async () => {
  const { dir, rev } = await edited(), tr = tracking();
  let readFromTarget = 0, inC = false;
  const r = await shims([tr.shim, ['readSync', (was) => function (fd) { const n = was.apply(fs, arguments); if (inC && /sample\.check\.json$/.test(tr.byFd[fd] || '')) readFromTarget += n; return n; }]],
    () => hooks({ beforeCompare: (t) => { fs.truncateSync(t, 1 << 30); inC = true; } }, () => save(dir, 'sample.check', NEW, rev)));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'changed']);
  assert.ok(readFromTarget <= Buffer.byteLength(text(DEF)) + 1, 'read ' + readFromTarget);
  assert.deepStrictEqual(tmpNames(dir), []);
  assert.deepStrictEqual(historyFiles(dir, 'sample.check'), []);
  fs.unlinkSync(at(dir, 'sample.check'));
});
rule('Replace: growth during C\'s read: changed', async () => {
  const { dir, rev } = await edited();
  let once = false;
  const r = await hooks({ readChunk: (full, phase) => { if (phase === 'C' && !once) { once = true; fs.appendFileSync(full, ' '); } } }, () => save(dir, 'sample.check', NEW, rev));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'changed']);
});
rule('Replace: atomically replaced during C (C reads the old inode): changed at the path recheck; nothing renamed; the other file kept', async () => {
  const { dir, rev } = await edited(), other = text(def({ label: 'Other' }));
  let once = false;
  const r = await hooks({ readChunk: (full, phase) => { if (phase === 'C' && !once) { once = true; fs.writeFileSync(full + '.x', other); fs.renameSync(full + '.x', full); } } }, () => save(dir, 'sample.check', NEW, rev));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'changed']);
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), other);
});
rule('Replace: deleted during C: changed at the path recheck', async () => {
  const { dir, rev } = await edited();
  let once = false;
  const r = await hooks({ readChunk: (full, phase) => { if (phase === 'C' && !once) { once = true; fs.unlinkSync(full); } } }, () => save(dir, 'sample.check', NEW, rev));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'changed']);
  assert.ok(!fs.existsSync(at(dir, 'sample.check')));
});
rule('Replace: written in place between C\'s snapshot and its final lstat (another length; the same length with mtime advanced): changed, the hand edit kept', async () => {
  for (const same of [false, true]) {
    const { dir, rev } = await edited(), orig = text(DEF), hand = same ? orig.replace('Sample check', 'Sample chock') : orig + ' ';
    const r = await hooks({ afterSnapshot: (full, phase) => { if (phase === 'C') { const st = fs.statSync(full); fs.writeFileSync(full, hand); if (same) fs.utimesSync(full, st.atime, new Date(st.mtimeMs + 5000)); } } }, () => save(dir, 'sample.check', NEW, rev));
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'changed'], same ? 'same length' : 'another length');
    assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), hand);
  }
});
rule('Replace: a metadata-only change before C\'s final lstat (chmod): changed (ctime moved; conservative)', async () => {
  const { dir, rev } = await edited();
  const r = await hooks({ afterSnapshot: (full, phase) => { if (phase === 'C') fs.chmodSync(full, 0o600); } }, () => save(dir, 'sample.check', NEW, rev));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'changed']);
});
rule('Known: a same-length in-place write between C\'s snapshot and its final lstat, with mtime and ctime held at the snapshot\'s (a fake stat layer), passes C: the stated limit (design 1.4)', async () => {
  const { dir, rev } = await edited(), orig = text(DEF), hand = orig.replace('Sample check', 'Sample chock');
  let snap = null, fake = false;
  const r = await shims([['lstatSync', (was) => function (p, o) { const st = was.apply(fs, arguments); if (fake && snap && p === at(dir, 'sample.check') && o && o.bigint) { fake = false; return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { mtimeNs: snap.mtimeNs, ctimeNs: snap.ctimeNs, mtimeMs: snap.mtimeMs, ctimeMs: snap.ctimeMs }); } return st; }]],
    () => hooks({ afterSnapshot: (full, phase) => { if (phase === 'C') { snap = fs.statSync(full, { bigint: true }); fs.writeFileSync(full, hand); fake = true; } } }, () => save(dir, 'sample.check', NEW, rev)));
  assert.strictEqual(r.json.outcome, 'done', 'Known: not detected');
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(NEW), 'the hand edit is replaced: the gap the design states');
});
rule('Replace: the descriptor close failing during C, with no leftover files: failed, "couldn\'t close", cleanup null, no rename, the target unchanged', async () => {
  const { dir, rev } = await edited(), tr = tracking();
  let renames = 0, inC = false;
  const r = await shims([tr.shim, ['closeSync', (was) => function (fd) { const p = tr.byFd[fd] || ''; was.apply(fs, arguments); if (inC && /sample\.check\.json$/.test(p)) { inC = false; throw err('EIO'); } }], ['renameSync', (was) => (a, b) => { renames++; return was(a, b); }]],
    () => hooks({ beforeCompare: () => { inC = true; } }, () => save(dir, 'sample.check', NEW, rev)));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.json.cleanup, renames], ['failed', 'failed', null, 0]);
  assert.ok(/couldn't close/.test(r.json.error.why), r.json.error.why);
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(DEF));
});
rule('Close failure at B, no leftovers: our bytes read back, then the close throws: back unreadable, unverified, cleanup null, history attempted', async () => {
  const { dir, rev } = await edited(), tr = tracking();
  let inB = false;
  const r = await shims([tr.shim, ['closeSync', (was) => function (fd) { const p = tr.byFd[fd] || ''; was.apply(fs, arguments); if (inB && /sample\.check\.json$/.test(p)) { inB = false; throw err('EIO'); } }]],
    () => hooks({ afterCommit: () => { inB = true; } }, () => save(dir, 'sample.check', NEW, rev)));
  assert.deepStrictEqual([r.json.outcome, r.json.back, r.json.cleanup, r.json.written], ['unverified', 'unreadable', null, true]);
  assert.strictEqual(r.json.history.written, true);
});
const fifo = (p) => { try { fs.unlinkSync(p); } catch (e) { /* gone */ } cp.execFileSync('mkfifo', [p]); };
rule('Nonblocking opens: a FIFO swapped in between lstat and open never hangs: failed at C, unverified at B, held at R1, unreadable in type read', async () => {
  if (process.platform === 'win32') return;
  { const { dir, rev } = await edited();
    let renames = 0;
    const r = await shims([['renameSync', (was) => (a, b) => { renames++; return was(a, b); }]], () => hooks({ beforeOpen: (full, phase) => { if (phase === 'C') fifo(full); } }, () => save(dir, 'sample.check', NEW, rev)));
    assert.deepStrictEqual([r.json.outcome, r.json.written, renames], ['failed', false, 0], 'C');
    assert.ok(fs.lstatSync(at(dir, 'sample.check')).isFIFO(), 'the FIFO is untouched');
    assert.deepStrictEqual(tmpNames(dir), []); }
  { const { dir, rev } = await edited();
    const r = await hooks({ beforeOpen: (full, phase) => { if (phase === 'B') fifo(full); } }, () => save(dir, 'sample.check', NEW, rev));
    assert.deepStrictEqual([r.json.outcome, r.json.back, r.json.written], ['unverified', 'unreadable', true], 'B');
    assert.ok(r.json.history.written === true); }
  { const { dir, rev } = await edited();
    const r = await hooks({ beforeOpen: (full, phase) => { if (phase === 'R1') fifo(full); } }, () => save(dir, 'sample.check', NEW, rev));
    assert.deepStrictEqual([r.json.outcome, r.json.written], ['held', false], 'R1'); }
  { const { dir } = await edited();
    const r = await hooks({ beforeOpen: (full, phase) => { if (phase === 'read') fifo(full); } }, () => read(dir, 'sample.check'));
    assert.strictEqual(r.json.data.type.state, 'unreadable'); assert.strictEqual(r.code, 4); }
});
rule('Replace: beforeCompare writes sample.check-LAPTOP.json: copies', async () => {
  const { dir, rev } = await edited();
  const r = await hooks({ beforeCompare: () => fs.writeFileSync(path.join(dir, 'step-types', 'sample.check-LAPTOP.json'), '{}') }, () => save(dir, 'sample.check', NEW, rev));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'copies']);
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(DEF));
});
rule('Late copies: a copy written during C\'s read is refused by the final listing; one written after it is the stated limit (Known), and the next save refuses', async () => {
  { const { dir, rev } = await edited();
    let once = false;
    const r = await hooks({ readChunk: (full, phase) => { if (phase === 'C' && !once) { once = true; fs.writeFileSync(path.join(dir, 'step-types', 'sample.check-LAPTOP.json'), '{}'); } } }, () => save(dir, 'sample.check', NEW, rev));
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'copies']);
    assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(DEF)); }
  { const { dir, rev } = await edited();
    const r = await hooks({ afterFinalListing: () => fs.writeFileSync(path.join(dir, 'step-types', 'sample.check-LAPTOP.json'), text(DEF)) }, () => save(dir, 'sample.check', NEW, rev));
    assert.strictEqual(r.json.outcome, 'done', 'Known: a copy after the final listing isn\'t refused');
    const again = await save(dir, 'sample.check', def({ label: 'Third' }), sha(text(NEW)));
    assert.deepStrictEqual([again.json.outcome, again.json.error.kind], ['refused', 'copies']);
    const got = await PF.repo.loadStepTypes(diskFs(dir));
    assert.ok(got.errors.some((e) => e.file === 'sample.check-LAPTOP.json'), 'the app lists the copy as an error'); }
});
rule('Replace: beforeCompare adds only a BOM: changed (D3: bytes, not text)', async () => {
  const { dir, rev } = await edited();
  const r = await hooks({ beforeCompare: (t) => fs.writeFileSync(t, '﻿' + text(DEF)) }, () => save(dir, 'sample.check', NEW, rev));
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'changed']);
});
for (const state of ['R1 bytes', 'our exact bytes', 'other bytes', 'missing']) {
  rule('Rename throws (shim) with the target holding ' + state + ': unsure, written null, no history', async () => {
    const { dir, rev } = await edited();
    const r = await shims([['renameSync', (was) => (a, b) => {
      if (state === 'our exact bytes') fs.writeFileSync(b, text(NEW)); else if (state === 'other bytes') fs.writeFileSync(b, 'other'); else if (state === 'missing') fs.unlinkSync(b);
      throw err('EIO');
    }]], () => save(dir, 'sample.check', NEW, rev));
    assert.deepStrictEqual([r.json.outcome, r.json.written, r.json.history], ['unsure', null, null]);
    assert.deepStrictEqual(historyFiles(dir, 'sample.check'), []);
    assert.deepStrictEqual(tmpNames(dir), r.json.cleanup ? r.json.cleanup.leftover : []);
  });
}
rule('Rename shim renames, then restores R1\'s bytes and throws: unsure, not failed', async () => {
  const { dir, rev } = await edited();
  const r = await shims([['renameSync', (was) => (a, b) => { was(a, b); fs.writeFileSync(b, text(DEF)); throw err('EIO'); }]], () => save(dir, 'sample.check', NEW, rev));
  assert.deepStrictEqual([r.json.outcome, r.json.written], ['unsure', null]);
});

/* ---------- the app's saveChecked, interleaved with the command (design 1.7, orders A to E) ---------- */
/* The app's folder access, as far as saveChecked uses it, on the real folder: reads decode as File.text() does. */
function diskFs(dir, ctl) {
  const full = (p) => path.join(dir, ...p.split('/'));
  return {
    list: (p) => Promise.resolve().then(() => { let e; try { e = fs.readdirSync(full(p), { withFileTypes: true }); } catch (x) { if (x.code === 'ENOENT') return []; throw x; } return e.map((x) => ({ name: x.name, kind: x.isDirectory() ? 'dir' : x.isFile() ? 'file' : 'link' })); }),
    read: (p) => Promise.resolve().then(() => { let b; try { b = fs.readFileSync(full(p)); } catch (x) { if (x.code === 'ENOENT') return null; throw x; } return { text: new TextDecoder('utf-8').decode(b), size: b.length, mtime: 0 }; }),
    write: (p, t) => (ctl && ctl.write ? ctl.write(p, t, () => fs.writeFileSync(full(p), t)) : Promise.resolve().then(() => { fs.mkdirSync(path.dirname(full(p)), { recursive: true }); fs.writeFileSync(full(p), t); }))
  };
}
/* An app save whose write waits until go() is called. */
function heldApp(dir, appDef, base) {
  let go = null;
  const ready = new Promise((res) => { go = res; });
  const ctl = { write: (p, t, doIt) => new Promise((res) => { ctl.pending = () => { doIt(); res(); }; go(); }) };
  const done = PF.repo.saveStepType(diskFs(dir, ctl), appDef, U.hash(base), { expectText: base });
  return { ctl, ready, done };
}
const APP = def({ label: 'From the app' });
rule('Order A: app compare, then the command\'s commit, then the app\'s write, then both read back: the app reports ok, the command replaced', async () => {
  const { dir, rev } = await edited(), app = heldApp(dir, APP, text(DEF));
  await app.ready;
  const r = await hooks({ afterCommit: () => app.ctl.pending() }, () => save(dir, 'sample.check', NEW, rev));
  const a = await app.done;
  assert.strictEqual(a.ok, true, 'the app reads its own bytes back');
  assert.deepStrictEqual([r.json.outcome, r.json.back], ['replaced', 'other']);
  assert.strictEqual(r.json.rev.now, sha(text(APP)));
});
rule('Order B: command C, app write, command rename, app read-back: the app shows its conflict, the command done', async () => {
  const { dir, rev } = await edited(), app = heldApp(dir, APP, text(DEF));
  await app.ready;
  const r = await hooks({ afterCompare: () => app.ctl.pending() }, () => save(dir, 'sample.check', NEW, rev));
  const a = await app.done;
  assert.strictEqual(r.json.outcome, 'done');
  assert.strictEqual(a.conflict, true, 'the app reads our bytes back and says so');
  assert.strictEqual(a.theirs, text(NEW));
});
rule('Known, order C: command C, app write, app read-back, command rename: app ok, command done, the app\'s save gone (W2; nothing says it can be got back)', async () => {
  const { dir, rev } = await edited(), app = heldApp(dir, APP, text(DEF));
  await app.ready;
  const r = await hooks({ afterCompare: async () => { app.ctl.pending(); await app.done; } }, () => save(dir, 'sample.check', NEW, rev));
  const a = await app.done;
  assert.strictEqual(a.ok, true);
  assert.strictEqual(r.json.outcome, 'done');
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(NEW));
  assert.ok(!/recover|history has it|get it back/i.test(r.json.words));
});
rule('Known, order D (W4\'): the app passes its compare before C and writes after B: command done, app ok, the command\'s save gone', async () => {
  const { dir, rev } = await edited(), app = heldApp(dir, APP, text(DEF));
  await app.ready;
  const r = await save(dir, 'sample.check', NEW, rev);
  app.ctl.pending();
  const a = await app.done;
  assert.strictEqual(r.json.outcome, 'done');
  assert.strictEqual(a.ok, true);
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(APP));
});
rule('Order E (2.1.0+): an editor opened before the command\'s commit compares after it: conflict, nothing written by the app', async () => {
  const { dir, rev } = await edited();
  const r = await save(dir, 'sample.check', NEW, rev);
  assert.strictEqual(r.json.outcome, 'done');
  const a = await PF.repo.saveStepType(diskFs(dir), APP, U.hash(text(DEF)), { expectText: text(DEF) });
  assert.strictEqual(a.conflict, true);
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(NEW));
});
rule('Baseline for the Known rules: two interleaved repo.saveStepType calls on a MemoryFS with a delayed write both report ok, and the first save is gone', async () => {
  const m = new PF.fs.MemoryFS('baseline:' + Math.random(), null);
  m.reset({ 'step-types/sample.check.json': text(DEF) });
  const gates = [];
  const slow = { read: (p, o) => m.read(p, o), write: (p, t) => new Promise((res) => gates.push(() => m.write(p, t).then(res))) };
  const one = PF.repo.saveStepType(slow, def({ label: 'One' }), U.hash(text(DEF)), { expectText: text(DEF) });
  const two = PF.repo.saveStepType(slow, def({ label: 'Two' }), U.hash(text(DEF)), { expectText: text(DEF) });
  for (let i = 0; i < 20 && gates.length < 2; i++) await new Promise((r) => setTimeout(r, 1));
  assert.strictEqual(gates.length, 2, 'both passed their compare');
  gates[0](); const a = await one; gates[1](); const b = await two;
  assert.ok(a.ok && b.ok, 'both say ok');
  assert.ok(m.files['step-types/sample.check.json'].t.indexOf('"One"') < 0, 'the first save is gone: the app-vs-app gap exists today');
});
rule('Known, old editor (1.18.0): the command saves the colliding twin of a stale editor\'s base, and the old editor\'s save succeeds over it; the same pair between two 1.18.0 windows does too', async () => {
  const { loadCopy } = require('./compat-harness');
  const OLD = loadCopy('v1.18.0');
  if (!OLD) return;
  const a = { id: 'sample.check', label: 'Verify result 149599' }, b = { id: 'sample.check', label: 'Verify result 312382' };
  assert.strictEqual(U.hash(text(a)), U.hash(text(b)), 'the fixtures collide');
  assert.strictEqual(U.hash(text(a)), 'e461cc69');
  const dir = team({ 'step-types/sample.check.json': text(a) });
  const r = await save(dir, 'sample.check', b, sha(text(a)));
  assert.strictEqual(r.json.outcome, 'done');
  const stale = def({ label: 'Stale editor' }); delete stale.hint; delete stale.fields; delete stale.record;
  const o = await OLD.repo.saveStepType(diskFs(dir), stale, OLD.util.hash(text(a)));
  assert.ok(o && o.ok, 'the old editor reports ok: ' + JSON.stringify(o));
  assert.ok(/Stale editor/.test(fs.readFileSync(at(dir, 'sample.check'), 'utf8')), 'the command\'s save is gone');
  const m = new OLD.fs.MemoryFS('old:' + Math.random(), null);
  m.reset({ 'step-types/sample.check.json': text(b) });
  const o2 = await OLD.repo.saveStepType(m, stale, OLD.util.hash(text(a)));
  assert.ok(o2 && o2.ok, 'baseline: two 1.18.0 windows');
});
rule('inUse through the command: removing a field or evidence a draft step uses warns, naming the draft and the step, on a dry run too; another type or a published use doesn\'t', async () => {
  const draftMd = ['---', 'process: rel', 'title: Release', 'owner: person-avery', 'roles: lead', '---', '', '## Do · READ-DO {#do}', '- [ ] {sample.check} Check the system @lead {#chk}', '  system: Change board', '  require: approval', ''].join('\n');
  const otherMd = draftMd.replace('process: rel', 'process: other').replace('{sample.check}', '{other.check}');
  const { dir, rev } = await edited({ 'maps/drafts/rel.md': draftMd, 'maps/drafts/other.md': otherMd, 'publications/pub/v1-abc/map.md': draftMd.replace('process: rel', 'process: pub') });
  const noSystem = def(); delete noSystem.fields.system;
  const dry = await save(dir, 'sample.check', noSystem, rev, ['--dry-run']);
  assert.strictEqual(dry.json.outcome, 'checked');
  const w1 = dry.json.checks.warnings.filter((w) => /rel/.test(w) && /chk/.test(w));
  assert.strictEqual(w1.length, 1, JSON.stringify(dry.json.checks.warnings));
  assert.ok(!dry.json.checks.warnings.some((w) => /\bother\b|\bpub\b/.test(w)));
  const r = await save(dir, 'sample.check', noSystem, rev);
  assert.strictEqual(r.json.outcome, 'done');
  assert.strictEqual(r.json.checks.warnings.filter((w) => /rel/.test(w) && /chk/.test(w)).length, 1);
  const noEvidence = def({ record: [] });
  const r2 = await save(dir, 'sample.check', noEvidence, sha(text(noSystem)));
  assert.strictEqual(r2.json.checks.warnings.filter((w) => /rel/.test(w) && /chk/.test(w) && /approval/.test(w)).length, 1, JSON.stringify(r2.json.checks.warnings));
});

/* ======================= the read-back (both options) ======================= */
rule('Ordinary saves read back same: a 206-byte definition, one over 64 KB, and one with non-ASCII text', async () => {
  const small = { id: 'sample.check', label: 'Sample check', hint: 'x'.repeat(10), fields: { system: { label: 'System', kind: 'text' } } };
  small.hint = 'x'.repeat(Math.max(1, 10 + 206 - Buffer.byteLength(text(small))));
  assert.strictEqual(Buffer.byteLength(text(small)), 206);
  const big = def({ fields: {} });
  for (let i = 0; i < 30; i++) big.fields['f' + i] = { label: 'F' + i, kind: 'choice', options: Array.from({ length: 60 }, (x, j) => 'opt-' + i + '-' + j + '-' + 'z'.repeat(20)) };
  assert.ok(Buffer.byteLength(text(big)) > 65536);
  const intl = def({ label: 'Überprüfung ✓' });
  for (const d of [small, big, intl]) {
    const dir = team({});
    const r = await save(dir, 'sample.check', d, 'none');
    assert.deepStrictEqual([r.json.outcome, r.json.back], ['done', 'same'], Buffer.byteLength(text(d)) + ' bytes');
    assert.strictEqual(r.json.rev.now, r.json.rev.after);
  }
});
for (const [name, bytes] of [['shorter', (t) => t.slice(0, 20)], ['equal length, different bytes', (t) => t.replace('Sample', 'Simple')], ['equal bytes (an identical replacement)', (t) => t], ['longer', (t) => t + ' '], ['over the read cap', () => Buffer.alloc(1048576 + 10, 0x20)]]) {
  rule('Read-back: afterCommit replaces the target with a new inode, ' + name + ': back other', async () => {
    const dir = team({});
    const r = await hooks({ afterCommit: (t) => { const b = bytes(text(DEF)); fs.writeFileSync(t + '.x', b); fs.renameSync(t + '.x', t); } }, () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.back, r.json.written], ['replaced', 'other', true]);
    if (/read cap/.test(name)) assert.strictEqual(r.json.rev.now, null);
    else assert.strictEqual(r.json.rev.now, sha(Buffer.from(bytes(text(DEF)))));
    if (/identical/.test(name)) assert.strictEqual(r.json.rev.now, r.json.rev.after);
    assert.strictEqual(r.json.history.written, true);
  });
}
rule('Read-back: written in place (same inode, other bytes, same length): other, rev.now the new bytes\' hash', async () => {
  const dir = team({}), other = text(DEF).replace('Sample', 'Simple');
  const r = await hooks({ afterCommit: (t) => fs.writeFileSync(t, other) }, () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.back, r.json.rev.now], ['replaced', 'other', sha(other)]);
});
rule('Read-back: growing during B: other, rev.now null, why says it changed while being read', async () => {
  const dir = team({});
  let once = false;
  const r = await hooks({ readChunk: (full, phase) => { if (phase === 'B' && !once) { once = true; fs.appendFileSync(full, ' '); } } }, () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.back, r.json.rev.now], ['replaced', 'other', null]);
});
rule('Read-back: written in place between B\'s snapshot and its final lstat: another length is other; the same length with mtime advanced is unstable, never same', async () => {
  { const dir = team({});
    const r = await hooks({ afterSnapshot: (full, phase) => { if (phase === 'B') fs.appendFileSync(full, ' '); } }, () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.back], ['replaced', 'other']); }
  { const dir = team({});
    const r = await hooks({ afterSnapshot: (full, phase) => { if (phase === 'B') { const st = fs.statSync(full); fs.writeFileSync(full, text(DEF).replace('Sample', 'Simple')); fs.utimesSync(full, st.atime, new Date(st.mtimeMs + 5000)); } } }, () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.back, r.json.rev.now], ['unverified', 'unstable', null]); }
});
rule('Read-back: unstable with the bytes intact: a touch during B\'s read, and between the snapshot and the final lstat: unverified, exit 4, history still attempted', async () => {
  for (const when of ['readChunk', 'afterSnapshot']) {
    const dir = team({});
    let once = false;
    const r = await hooks({ [when]: (full, phase) => { if (phase === 'B' && !once) { once = true; const st = fs.statSync(full); fs.utimesSync(full, st.atime, new Date(st.mtimeMs + 7000)); } } }, () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.back, r.code, r.json.rev.now], ['unverified', 'unstable', 4, null], when);
    assert.ok(/couldn't confirm it: it changed while Flightdeck was reading it back/.test(r.json.words));
    assert.strictEqual(r.json.history.written, true);
  }
});
rule('Read-back: replaced during B (other at the final lstat); deleted during B (missing)', async () => {
  { const dir = team({});
    let once = false;
    const r = await hooks({ readChunk: (full, phase) => { if (phase === 'B' && !once) { once = true; fs.writeFileSync(full + '.x', 'theirs'); fs.renameSync(full + '.x', full); } } }, () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.back], ['replaced', 'other']); }
  { const dir = team({});
    let once = false;
    const r = await hooks({ readChunk: (full, phase) => { if (phase === 'B' && !once) { once = true; fs.unlinkSync(full); } } }, () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.back, r.json.rev.now], ['replaced', 'missing', null]);
    assert.ok(/then removed by another change/.test(r.json.words)); }
});
rule('Read-back: afterCommit deletes the target: replaced, back missing; puts a folder or a link there, or the read throws: unverified, back unreadable', async () => {
  { const dir = team({});
    const r = await hooks({ afterCommit: (t) => fs.unlinkSync(t) }, () => save(dir, 'sample.check', DEF, 'none'));
    assert.deepStrictEqual([r.json.outcome, r.json.back, r.json.rev.now, r.json.history.written], ['replaced', 'missing', null, true]); }
  for (const kind of ['folder', 'link', 'throws']) {
    const dir = team({}), tr = tracking();
    let arm = false;
    const r = await shims([tr.shim, ['readSync', (was) => function (fd) { if (arm && /sample\.check\.json$/.test(tr.byFd[fd] || '')) throw err('EIO'); return was.apply(fs, arguments); }]],
      () => hooks({ afterCommit: (t) => { if (kind === 'folder') { fs.unlinkSync(t); fs.mkdirSync(t); } else if (kind === 'link') { fs.unlinkSync(t); fs.symlinkSync(path.join(dir, 'nowhere'), t); } else arm = true; } }, () => save(dir, 'sample.check', DEF, 'none')));
    assert.deepStrictEqual([r.json.outcome, r.json.back, r.json.written], ['unverified', 'unreadable', true], kind);
  }
});
rule('Read-back: replaced, with history failing: replaced, history.written false, and the added sentence', async () => {
  const dir = team({ 'history/step-types/sample.check': 'a file' });
  const r = await hooks({ afterCommit: (t) => fs.writeFileSync(t, 'theirs') }, () => save(dir, 'sample.check', DEF, 'none'));
  assert.deepStrictEqual([r.json.outcome, r.json.history.written], ['replaced', false]);
  assert.ok(/Its history line couldn't be written either/.test(r.json.words), r.json.words);
});

/* ======================= history caps and content ======================= */
function choiceType(n, size) {
  const d = def({ fields: {} });
  for (let i = 0; i < 30; i++) d.fields['f' + i] = { label: 'F' + i, kind: 'choice', options: Array.from({ length: 60 }, (x, j) => ('o' + i + '-' + j + '-' + n).padEnd(size, 'q')) };
  return d;
}
rule('History: a valid ~96 KB type on a create: line written with big: true and no definitions; done; "without its contents"', async () => {
  const d = choiceType('a', 40), dir = team({});
  assert.ok(Buffer.byteLength(text(d)) > 90000 && Buffer.byteLength(text(d)) < 120000, Buffer.byteLength(text(d)) + ' bytes');
  const r = await save(dir, 'sample.check', d, 'none');
  assert.strictEqual(r.json.outcome, 'done');
  const line = JSON.parse(fs.readFileSync(path.join(dir, r.json.history.path), 'utf8'));
  assert.ok(line.big === true && !('after' in line));
  assert.deepStrictEqual(r.json.checks.omitted, { before: null, after: 'cap' });
  assert.ok(r.json.checks.warnings.indexOf('History records this save without its contents.') >= 0);
});
rule('History, pair cap: an edit between two valid definitions of about 37 KB each: big, neither kept, omitted cap/cap, "without its contents" only', async () => {
  const a = choiceType('a', 17), b = choiceType('b', 17);
  assert.ok(Buffer.byteLength(JSON.stringify(a)) > 30000 && Buffer.byteLength(JSON.stringify(a)) < 45000, Buffer.byteLength(JSON.stringify(a)));
  const dir = team({ 'step-types/sample.check.json': text(a) });
  const r = await save(dir, 'sample.check', b, sha(text(a)));
  assert.strictEqual(r.json.outcome, 'done');
  assert.deepStrictEqual(r.json.checks.omitted, { before: 'cap', after: 'cap' });
  const hw = r.json.checks.warnings.filter((w) => /^History/.test(w));
  assert.deepStrictEqual(hw, ['History records this save without its contents.']);
});
rule('History: a 70 KB unknown nested value: big, plus the unused-keys warning', async () => {
  const d = def(); d.fields.system.note = 'n'.repeat(70000);
  const dir = team({});
  const r = await save(dir, 'sample.check', d, 'none');
  assert.strictEqual(r.json.outcome, 'done');
  assert.strictEqual(r.json.checks.omitted.after, 'cap');
  assert.ok(r.json.checks.warnings.some((w) => /fields\.system\.note/.test(w) && /editor/.test(w)), JSON.stringify(r.json.checks.warnings));
});
for (const [what, bad] of [['an unparseable original', '{"id": "sample.check", '], ['a parseable original that fails checkCustom', '{"id":"sample.check","label":""}']]) {
  rule('History: ' + what + ' repaired: before null, omitted.before invalid, the valid after kept, the "wasn\'t a valid step type" warning only', async () => {
    const dir = team({ 'step-types/sample.check.json': bad });
    const rd = await read(dir, 'sample.check');
    assert.strictEqual(rd.json.data.type.state, 'malformed');
    const r = await save(dir, 'sample.check', DEF, rd.json.data.type.rev);
    assert.strictEqual(r.json.outcome, 'done');
    assert.deepStrictEqual(r.json.checks.omitted, { before: 'invalid', after: null });
    const hw = r.json.checks.warnings.filter((w) => /^History/.test(w));
    assert.deepStrictEqual(hw, ['History records this save without the previous version (it wasn\'t a valid step type).']);
    assert.ok(r.json.checks.warnings.some((w) => /malformed|wasn't a step type|repair/i.test(w)), 'a warning names what it was');
    const e = TL.cleanEntry(JSON.parse(fs.readFileSync(path.join(dir, r.json.history.path), 'utf8')), 'x');
    assert.strictEqual(e.before, null); assert.ok(e.after && e.after.label === DEF.label);
  });
}
rule('History, nested-array name: passes checkCustom; the cleaned line is badDef; omitted after cleaned on a create, cleaned both on an edit; never the "wasn\'t valid" words', async () => {
  const d = def({ record: [{ name: [[[[[['answer']]]]]], label: 'Answer', kind: 'text' }] });
  assert.deepStrictEqual(plain(T.checkCustom(JSON.parse(JSON.stringify(d)))), []);
  const dir = team({});
  const r = await save(dir, 'sample.check', d, 'none');
  assert.strictEqual(r.json.outcome, 'done');
  assert.deepStrictEqual(r.json.checks.omitted, { before: null, after: 'cleaned' });
  assert.ok(r.json.checks.warnings.indexOf('History records this save without its contents.') >= 0);
  assert.ok(!r.json.checks.warnings.some((w) => /wasn't a valid/.test(w)));
  const r2 = await save(dir, 'sample.check', def({ label: 'Again', record: d.record }), sha(text(d)));
  assert.deepStrictEqual(r2.json.checks.omitted, { before: 'cleaned', after: 'cleaned' });
});
rule('History: cleanEntry on a hand-made line with an invalid before is badDef, both null (the reader, characterized)', () => {
  const e = TL.cleanEntry({ v: 1, kind: 'type-edit', id: 'p-1', type: 'sample.check', writer: 'p-1', to: 'abcdef12', before: { id: 'sample.check', label: '' }, after: DEF }, 'x');
  assert.ok(e.badDef && e.before === null && e.after === null);
});
rule('History: --dry-run shows the same history warnings and writes nothing', async () => {
  const bad = '{"id":"sample.check","label":""}', dir = team({ 'step-types/sample.check.json': bad }), was = scan(dir);
  const r = await save(dir, 'sample.check', DEF, sha(bad), ['--dry-run']);
  assert.strictEqual(r.json.outcome, 'checked');
  assert.ok(r.json.checks.warnings.indexOf('History records this save without the previous version (it wasn\'t a valid step type).') >= 0);
  assert.deepStrictEqual(scan(dir), was);
});
rule('History: the line passes cleanEntry, isn\'t reversible, and loadEditHistory orders it with the app\'s lines (the FNV chain)', async () => {
  const dir = team({ 'people.json': PEOPLE });
  const app = PF.timeline.histLine({ kind: 'type-edit', id: 'e-1', type: 'sample.check', writer: 'w-avery', seq: 1, by: 'person-avery', at: '2026-11-01T00:00:00Z', from: null, to: U.hash(text(DEF)), before: null, after: DEF, source: 'editor', units: ['Made it'] });
  fs.mkdirSync(path.join(dir, 'history', 'step-types', 'sample.check'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'history', 'step-types', 'sample.check', 'w-avery.jsonl'), JSON.stringify(app) + '\n');
  fs.mkdirSync(path.join(dir, 'step-types'));
  fs.writeFileSync(at(dir, 'sample.check'), text(DEF));
  const r = await save(dir, 'sample.check', NEW, sha(text(DEF)), ['--asked-by', 'person-avery', '--note', 'Renamed the label']);
  assert.strictEqual(r.json.outcome, 'done', r.json.words);
  const line = JSON.parse(fs.readFileSync(path.join(dir, r.json.history.path), 'utf8'));
  assert.strictEqual(line.seen, 'e-1');
  assert.deepStrictEqual([line.from, line.to, line.source, line.units[0]], [U.hash(text(DEF)), U.hash(text(NEW)), 'agent', 'Renamed the label']);
  const e = TL.cleanEntry(line, 'agent.jsonl');
  assert.ok(e && TL.reversible(e) === false);
  const h = await PF.repo.loadEditHistory(diskFs(dir), 'history/step-types/sample.check', U.hash(text(NEW)));
  const ids = h.items.filter((x) => x.entry).map((x) => x.entry.id);
  assert.deepStrictEqual(plain(ids), [r.json.operation, 'e-1']);
  assert.ok(!h.items.some((x) => x.gap), 'one chain, no gap');
});

/* ======================= load position (the 100-file limit) ======================= */
const A = (n) => ({ id: 'a' + String(n).padStart(3, '0'), label: 'A' + n });
function many(n, make) { const files = {}; for (let i = 0; i < n; i++) { const d = A(i); files['step-types/' + d.id + '.json'] = make ? make(d, i) : text(d); } return files; }
const Z = { id: 'zz.check', label: 'Last' };
rule('Load position: the target at 100: done, "number 100 of the step-type files"; at 101: "won\'t load it", a warning, and repo.loadStepTypes skips it', async () => {
  const d1 = team(many(99));
  const r1 = await save(d1, 'zz.check', Z, 'none');
  assert.ok(/As of this save it's number 100 of the step-type files Flightdeck reads/.test(r1.json.words), r1.json.words);
  assert.deepStrictEqual(r1.json.load, { position: 100, limit: 100, selected: true, from: 'C' });
  const d2 = team(many(100));
  const r2 = await save(d2, 'zz.check', Z, 'none');
  assert.strictEqual(r2.json.outcome, 'done');
  assert.ok(/Flightdeck won't load it: it reads only the first 100 step-type files by name, and this is number 101/.test(r2.json.words), r2.json.words);
  assert.ok(r2.json.checks.warnings.some((w) => /first 100/.test(w)));
  const got = await PF.repo.loadStepTypes(diskFs(d2));
  assert.ok(!got.types['zz.check'] && got.over.indexOf('zz.check.json') >= 0);
});
rule('Load position: malformed files and copies sorted before the target take slots; they are selected but not usable', async () => {
  const files = many(97); files['step-types/a-bad.json'] = '{'; files['step-types/a000-LAPTOP.json'] = text(A(0)); files['step-types/a000 (1).json'] = text(A(0));
  const dir = team(files);
  const r = await save(dir, 'zz.check', Z, 'none');
  assert.strictEqual(r.json.load.position, 101);
  const l = await list(dir), bad = l.json.data.types.find((x) => x.file === 'a-bad.json');
  assert.deepStrictEqual([bad.selected, bad.usable, bad.state], [true, false, 'malformed']);
  assert.strictEqual(l.json.data.types.find((x) => x.file === 'a000-LAPTOP.json').copyOf, 'a000.json');
});
rule('Load position: a file with byte 0xFF inside its label: malformed to the command, but selected and usable: the app loads it, and it takes a slot', async () => {
  const ff = Buffer.concat([Buffer.from('{"id":"a-ff","label":"Bad '), Buffer.from([0xff]), Buffer.from('"}\n')]);
  const dir = team({ 'step-types/a-ff.json': ff });
  const rd = await read(dir, 'a-ff');
  assert.deepStrictEqual([rd.json.data.type.state, rd.json.data.type.utf8, rd.json.data.type.selected, rd.json.data.type.usable], ['malformed', false, true, true]);
  const got = await PF.repo.loadStepTypes(diskFs(dir));
  assert.ok(got.types['a-ff'], 'loadStepTypes loads it');
  const r = await save(dir, 'zz.check', Z, 'none');
  assert.strictEqual(r.json.load.position, 2);
});
rule('Load position: non-files take no slot: 100 folders, 100 symlinks, and a mix before the target', async () => {
  { const dir = team({}); fs.mkdirSync(path.join(dir, 'step-types'));
    for (let i = 0; i < 100; i++) fs.mkdirSync(path.join(dir, 'step-types', 'a' + String(i).padStart(3, '0') + '.json'));
    const r = await save(dir, 'zz.check', Z, 'none');
    assert.strictEqual(r.json.load.position, 1);
    assert.ok((await PF.repo.loadStepTypes(diskFs(dir))).types['zz.check']); }
  { const dir = team({}), elsewhere = team(many(100)); fs.mkdirSync(path.join(dir, 'step-types'));
    for (let i = 0; i < 100; i++) { const n = 'a' + String(i).padStart(3, '0') + '.json'; fs.symlinkSync(path.join(elsewhere, 'step-types', n), path.join(dir, 'step-types', n)); }
    const r = await save(dir, 'zz.check', Z, 'none');
    assert.strictEqual(r.json.load.position, 1); }
  { const dir = team(many(99));
    for (let i = 0; i < 5; i++) fs.mkdirSync(path.join(dir, 'step-types', 'b' + i + '.json'));
    fs.symlinkSync(path.join(dir, 'step-types', 'a000.json'), path.join(dir, 'step-types', 'b9.json'));
    const r = await save(dir, 'zz.check', Z, 'none');
    assert.strictEqual(r.json.load.position, 100); }
});
rule('Load position, boundary with malformed files: 99 before the target is 100, selected and usable; 100 is 101, not selected; loadStepTypes agrees', async () => {
  for (const n of [99, 100]) {
    const dir = team(many(n, () => '{'));
    await save(dir, 'zz.check', Z, 'none');
    const rd = await read(dir, 'zz.check'), t = rd.json.data.type;
    assert.deepStrictEqual([t.position, t.selected, t.usable], n === 99 ? [100, true, true] : [101, false, false]);
    assert.strictEqual(!!(await PF.repo.loadStepTypes(diskFs(dir))).types['zz.check'], n === 99);
  }
});
rule('Load position: an uppercase .JSON counts; temp and probe names don\'t; the sort is code-unit order (capitals first)', async () => {
  const dir = team({ 'step-types/B.JSON': '{}', 'step-types/.a.json.1.tmp': 'x', 'step-types/.a.json.1.probe': 'x', 'step-types/a.json': text({ id: 'a', label: 'A' }) });
  const r = await save(dir, 'b.check', { id: 'b.check', label: 'B' }, 'none');
  assert.strictEqual(r.json.load.position, 3, 'B.JSON and a.json sort before b.check.json');
  const l = await list(dir);
  assert.deepStrictEqual(l.json.data.types.filter((x) => x.kind === 'file').map((x) => x.file), ['B.JSON', 'a.json', 'b.check.json']);
});
rule('Load position on a dry run (from R1): no folder is position 1 and isn\'t created; 99 before is 100; 100 before is 101 "wouldn\'t load it"; never "As of this save"', async () => {
  for (const [files, pos] of [[{}, 1], [many(99), 100], [many(100), 101]]) {
    const dir = team(files), was = scan(dir);
    const r = await save(dir, 'zz.check', Z, 'none', ['--dry-run']);
    assert.deepStrictEqual([r.json.outcome, r.json.load.position, r.json.load.from], ['checked', pos, 'R1']);
    assert.ok(/^Checked\. Nothing was written\./.test(r.json.words) && !/As of this save/.test(r.json.words));
    assert.ok(pos === 101 ? /would be number 101, and Flightdeck wouldn't load it/.test(r.json.words) : /it would be number \d+ of the step-type files/.test(r.json.words), r.json.words);
    assert.deepStrictEqual(scan(dir), was, 'nothing written');
    assert.ok(!/uses it|next refresh/.test(r.json.words));
  }
});

/* ======================= type read and type list ======================= */
rule('type read: ok (exit 0) and missing (exit 0, rev "none", no ledger), with and without a step-types/ folder', async () => {
  const dir = team({ 'step-types/sample.check.json': text(DEF) });
  const ok = await read(dir, 'sample.check');
  assert.strictEqual(ok.code, 0);
  assert.deepStrictEqual([ok.json.data.type.state, ok.json.data.type.rev, ok.json.data.type.text, ok.json.data.type.bom, ok.json.data.type.lineEndings], ['ok', sha(text(DEF)), text(DEF), false, 'lf']);
  assert.deepStrictEqual(ok.json.data.type.def, DEF);
  for (const d of [dir, team({})]) {
    const m = await read(d, 'other.check');
    assert.deepStrictEqual([m.code, m.json.data.type.state, m.json.data.type.rev, m.json.problems.length], [0, 'missing', 'none', 0]);
  }
});
rule('type read: malformed (not UTF-8, not JSON, fails checkCustom, name isn\'t the ID): exit 4, malformed in the ledger, text and rev present', async () => {
  const cases = { 'not UTF-8': Buffer.from([0x7b, 0xff, 0x7d]), 'not JSON': '{"id":', 'fails checkCustom': '{"id":"sample.check","label":""}', 'name isn\'t the ID': text(def({ id: 'other.check' })) };
  for (const k of Object.keys(cases)) {
    const dir = team({ 'step-types/sample.check.json': cases[k] }), r = await read(dir, 'sample.check'), t = r.json.data.type;
    assert.deepStrictEqual([r.code, t.state, t.rev], [4, 'malformed', sha(Buffer.from(cases[k]))], k);
    assert.ok(typeof t.text === 'string' && t.errors.length > 0, k);
    assert.ok(r.json.problems.some((p) => p.kind === 'malformed' && p.path === 'step-types/sample.check.json'), k);
  }
});
rule('type read: newer (exit 4, needs), unreadable (mode 000, rev null), oversized (skipped, bytes), link (exit 4)', async () => {
  const newer = '{"format":"flightdeck-step-type/9","id":"sample.check","label":"X"}';
  { const dir = team({ 'step-types/sample.check.json': newer }), r = await read(dir, 'sample.check'), t = r.json.data.type;
    assert.deepStrictEqual([r.code, t.state, t.def], [4, 'newer', null]); assert.ok(t.needs !== undefined && t.rev === sha(newer));
    assert.ok(r.json.problems.some((p) => p.kind === 'newer')); }
  if (!ROOT_USER) { const dir = team({ 'step-types/sample.check.json': text(DEF) }); fs.chmodSync(at(dir, 'sample.check'), 0);
    const r = await read(dir, 'sample.check');
    assert.deepStrictEqual([r.code, r.json.data.type.state, r.json.data.type.rev], [4, 'unreadable', null]);
    assert.ok(r.json.problems.some((p) => p.kind === 'unreadable'));
    fs.chmodSync(at(dir, 'sample.check'), 0o644); }
  { const dir = team({ 'step-types/sample.check.json': Buffer.alloc(1048576 + 1, 0x20) }), r = await read(dir, 'sample.check');
    assert.deepStrictEqual([r.code, r.json.data.type.state, r.json.data.type.rev, r.json.data.type.bytes], [4, 'oversized', null, 1048577]);
    assert.ok(r.json.problems.some((p) => p.kind === 'skipped')); }
  { const dir = team({ 'elsewhere.json': text(DEF) }); fs.mkdirSync(path.join(dir, 'step-types')); fs.symlinkSync(path.join(dir, 'elsewhere.json'), at(dir, 'sample.check'));
    const r = await read(dir, 'sample.check');
    assert.deepStrictEqual([r.code, r.json.data.type.state, r.json.data.type.rev], [4, 'link', null]); }
});
rule('type read: vanished (deleted between lstat and open); replaced between the read and the recheck is read once more; replaced twice is vanished with why', async () => {
  { const dir = team({ 'step-types/sample.check.json': text(DEF) });
    const r = await hooks({ beforeOpen: (full, phase) => { if (phase === 'read') fs.unlinkSync(full); } }, () => read(dir, 'sample.check'));
    assert.deepStrictEqual([r.code, r.json.data.type.state, r.json.data.type.rev], [4, 'vanished', null]);
    assert.ok(r.json.problems.some((p) => p.kind === 'vanished')); }
  { const dir = team({ 'step-types/sample.check.json': text(DEF) });
    let n = 0;
    const r = await hooks({ afterSnapshot: (full, phase) => { if (phase === 'read' && n++ === 0) { fs.writeFileSync(full + '.x', text(NEW)); fs.renameSync(full + '.x', full); } } }, () => read(dir, 'sample.check'));
    assert.deepStrictEqual([r.json.data.type.state, r.json.data.type.rev], ['ok', sha(text(NEW))], 'read once more'); }
  { const dir = team({ 'step-types/sample.check.json': text(DEF) });
    const r = await hooks({ afterSnapshot: (full, phase) => { if (phase === 'read') { fs.writeFileSync(full + '.x', text(NEW) + ' '.repeat(Math.floor(Math.random() * 9))); fs.renameSync(full + '.x', full); } } }, () => read(dir, 'sample.check'));
    assert.deepStrictEqual([r.json.data.type.state, r.json.data.type.rev], ['vanished', null]);
    assert.ok(r.json.problems.some((p) => p.kind === 'vanished' && /changed/.test(p.why))); }
});
rule('type read rev null from any state can\'t be passed back: --expect null is usage; --expect none only as typed', async () => {
  const dir = team({});
  for (const e of ['null', 'NONE', 'None', '', 'abc']) {
    const r = await save(dir, 'sample.check', DEF, e);
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.code], ['refused', 'usage', 1], JSON.stringify(e));
  }
  assert.strictEqual((await save(dir, 'sample.check', DEF, 'none')).json.outcome, 'done');
});
rule('Malformed JSON classes through type read: null, true, 42, "broken", [] and [{}] are def null with exactly ["must be a JSON object"]; an object failing checkCustom keeps def and its own errors', async () => {
  for (const body of ['null', 'true', '42', '"broken"', '[]', '[{}]']) {
    const dir = team({ 'step-types/sample.check.json': body }), t = (await read(dir, 'sample.check')).json.data.type;
    assert.deepStrictEqual([t.state, t.def, t.errors, t.text, t.rev], ['malformed', null, ['must be a JSON object'], body, sha(body)], body);
  }
  const obj = '{"id":"sample.check","label":""}', t = (await read(team({ 'step-types/sample.check.json': obj }), 'sample.check')).json.data.type;
  assert.deepStrictEqual(t.def, { id: 'sample.check', label: '' });
  assert.deepStrictEqual(t.errors, plain(T.checkCustom(JSON.parse(obj))));
});
rule('type save --from [] is invalid with "must be a JSON object", before any read', async () => {
  const dir = team({ 'step-types/sample.check.json': '{' });
  const r = await save(dir, 'sample.check', '[]', 'none');
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.json.existing, r.json.problems], ['refused', 'invalid', null, []]);
  assert.ok(/must be a JSON object/.test(r.json.words));
});
rule('type list: one file in each state, in load order, copies marked, non-files after the files, count of regular files only, exit 4', async () => {
  const dir = team({ 'step-types/a-ok.json': text({ id: 'a-ok', label: 'A' }), 'step-types/b-bad.json': '{', 'step-types/c-new.json': '{"format":"flightdeck-step-type/9","id":"c-new","label":"C"}', 'step-types/a-ok-LAPTOP.json': text({ id: 'a-ok', label: 'A' }), 'elsewhere.json': '{}' });
  fs.mkdirSync(path.join(dir, 'step-types', 'd-folder.json'));
  fs.symlinkSync(path.join(dir, 'elsewhere.json'), path.join(dir, 'step-types', 'e-link.json'));
  const r = await list(dir), rows = r.json.data.types;
  assert.strictEqual(r.code, 4);
  assert.deepStrictEqual(rows.map((x) => x.file), ['a-ok-LAPTOP.json', 'a-ok.json', 'b-bad.json', 'c-new.json', 'd-folder.json', 'e-link.json']);
  assert.deepStrictEqual(rows.map((x) => x.state), ['malformed', 'ok', 'malformed', 'newer', 'link', 'link']);
  assert.deepStrictEqual(rows.map((x) => x.kind), ['file', 'file', 'file', 'file', 'folder', 'link']);
  assert.deepStrictEqual(rows.map((x) => x.position), [1, 2, 3, 4, null, null]);
  assert.strictEqual(rows[0].copyOf, 'a-ok.json');
  assert.strictEqual(r.json.data.count, 4);
  assert.strictEqual(r.json.data.limit, 100);
  const kinds = r.json.problems.map((p) => p.path + ' ' + p.kind).sort();
  assert.ok(kinds.indexOf('step-types/b-bad.json malformed') >= 0 && kinds.indexOf('step-types/c-new.json newer') >= 0 && kinds.indexOf('step-types/e-link.json link') >= 0, kinds.join(', '));
});
rule('type list: 101 regular files: the last isn\'t selected; no folder: [] and exit 0; a folder that can\'t be listed: [] and exit 4', async () => {
  const l = await list(team(many(101)));
  assert.deepStrictEqual(l.json.data.types.map((x) => x.selected).filter((x) => !x).length, 1);
  assert.strictEqual(l.json.data.types[100].selected, false);
  const none = await list(team({}));
  assert.deepStrictEqual([none.code, none.json.data.types], [0, []]);
  if (!ROOT_USER) {
    const dir = team(many(2)); fs.chmodSync(path.join(dir, 'step-types'), 0);
    const r = await list(dir);
    fs.chmodSync(path.join(dir, 'step-types'), 0o755);
    assert.deepStrictEqual([r.code, r.json.data.types], [4, []]);
    assert.ok(r.json.problems.some((p) => p.kind === 'unreadable'));
  }
});

/* ======================= inputs ======================= */
rule('Inputs: a target with a BOM: read, then save with that rev, succeeds, and is written without the BOM', async () => {
  const dir = team({ 'step-types/sample.check.json': '﻿' + text(DEF) });
  const rd = await read(dir, 'sample.check');
  assert.deepStrictEqual([rd.json.data.type.state, rd.json.data.type.bom], ['ok', true]);
  const r = await save(dir, 'sample.check', NEW, rd.json.data.type.rev);
  assert.strictEqual(r.json.outcome, 'done');
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(NEW));
});
rule('Inputs: CRLF and mixed line endings: the rev is over the bytes, the save succeeds, written LF', async () => {
  for (const [body, le] of [[text(DEF).replace(/\n/g, '\r\n'), 'crlf'], [text(DEF).replace('\n', '\r\n'), 'mixed']]) {
    const dir = team({ 'step-types/sample.check.json': body }), rd = await read(dir, 'sample.check');
    assert.deepStrictEqual([rd.json.data.type.lineEndings, rd.json.data.type.rev], [le, sha(body)]);
    const r = await save(dir, 'sample.check', NEW, rd.json.data.type.rev);
    assert.strictEqual(r.json.outcome, 'done');
    assert.ok(!/\r/.test(fs.readFileSync(at(dir, 'sample.check'), 'utf8')));
  }
});
rule('Inputs: UTF-16LE and UTF-16BE with a BOM: utf8 false, malformed; a save with that rev repairs it, with a warning', async () => {
  for (const enc of ['le', 'be']) {
    let b = Buffer.from('﻿' + text(DEF), 'utf16le');
    if (enc === 'be') b = b.swap16();
    const dir = team({ 'step-types/sample.check.json': b }), t = (await read(dir, 'sample.check')).json.data.type;
    assert.deepStrictEqual([t.state, t.utf8], ['malformed', false], enc);
    const r = await save(dir, 'sample.check', DEF, t.rev);
    assert.deepStrictEqual([r.json.outcome, r.json.existing], ['done', 'malformed']);
    assert.ok(r.json.checks.warnings.some((w) => /malformed|repair/i.test(w)));
  }
});
rule('Inputs: invalid bytes differing only in 0xFF and 0xFE between the read and the save: changed', async () => {
  const mk = (x) => Buffer.concat([Buffer.from('{"id":"sample.check","label":"'), Buffer.from([x]), Buffer.from('"}')]);
  const dir = team({ 'step-types/sample.check.json': mk(0xff) }), rev = (await read(dir, 'sample.check')).json.data.type.rev;
  fs.writeFileSync(at(dir, 'sample.check'), mk(0xfe));
  const r = await save(dir, 'sample.check', DEF, rev);
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'changed']);
});
rule('Inputs: an empty file: the rev is the SHA-256 of nothing, never "none"; --expect none over it is changed', async () => {
  const dir = team({ 'step-types/sample.check.json': '' }), t = (await read(dir, 'sample.check')).json.data.type;
  assert.strictEqual(t.rev, sha(''));
  const r = await save(dir, 'sample.check', DEF, 'none');
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'changed']);
});
rule('Inputs: a target over the read cap is held', async () => {
  const dir = team({ 'step-types/sample.check.json': Buffer.alloc(1048576 + 1, 0x20) });
  const r = await save(dir, 'sample.check', DEF, sha(Buffer.alloc(1048576 + 1, 0x20)));
  assert.deepStrictEqual([r.json.outcome, r.code], ['held', 4]);
});
rule('Inputs: input over 256 KB, UTF-16 input, duplicate keys or odd keys: invalid before any read', async () => {
  const dir = team({ 'step-types/sample.check.json': '{' });
  const big = JSON.stringify(def({ hint: 'x' })).replace('"x"', '"' + 'x'.repeat(262144) + '"');
  const bodies = { big, utf16: Buffer.from(JSON.stringify(DEF), 'utf16le'), dup: '{"id":"sample.check","label":"A","label":"B"}', odd: '{"id":"sample.check","label":"A","fields":{"x":{"label":"X","kind":"text","__proto__":{}}}}' };
  for (const k of Object.keys(bodies)) {
    const r = await save(dir, 'sample.check', bodies[k], 'none');
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.json.existing, r.json.problems], ['refused', 'invalid', null, []], k);
  }
});
rule('Inputs: an unreadable target (mode 000) or a listing that fails is held, never missing', async () => {
  if (ROOT_USER) return;
  { const dir = team({ 'step-types/sample.check.json': text(DEF) }); fs.chmodSync(at(dir, 'sample.check'), 0);
    const r = await save(dir, 'sample.check', NEW, 'none');
    fs.chmodSync(at(dir, 'sample.check'), 0o644);
    assert.deepStrictEqual([r.json.outcome, r.code], ['held', 4]); }
  { const dir = team({ 'step-types/other.json': '{}' }); fs.chmodSync(path.join(dir, 'step-types'), 0o311);
    const r = await save(dir, 'sample.check', DEF, 'none');
    fs.chmodSync(path.join(dir, 'step-types'), 0o755);
    assert.deepStrictEqual([r.json.outcome, r.code], ['held', 4]); }
});
rule('Inputs: the target is a folder: failed; step-types/ is a symlink: failed (link), nothing outside; no step-types/: created for none', async () => {
  { const dir = team({}); fs.mkdirSync(at(dir, 'sample.check'), { recursive: true });
    const r = await save(dir, 'sample.check', DEF, 'none');
    assert.deepStrictEqual([r.json.outcome, r.json.written], ['failed', false]); }
  { const dir = team({}), outside = tmp(); fs.symlinkSync(outside, path.join(dir, 'step-types'));
    const r = await save(dir, 'sample.check', DEF, 'none');
    assert.deepStrictEqual([r.json.outcome, r.json.written], ['failed', false]);
    assert.ok(/link/.test(r.json.error.why));
    assert.deepStrictEqual(fs.readdirSync(outside), []); }
  { const dir = team({});
    const r = await save(dir, 'sample.check', DEF, 'none');
    assert.strictEqual(r.json.outcome, 'done');
    assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), text(DEF)); }
});

/* ======================= names ======================= */
rule('Names: fields constructor, toString and hasOwnProperty are invalid with the exact current error, from the command and from repo.saveStepType', async () => {
  for (const f of ['constructor', 'toString', 'hasOwnProperty']) {
    const d = def({ fields: { [f]: { label: 'X', kind: 'text' } } }), dir = team({});
    const r = await save(dir, 'sample.check', d, 'none');
    const words = 'field "' + f + '": names are letters, numbers and dashes, and can\'t reuse link, expect, deadline, evidence, require, at, due, after, sets';
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'invalid'], f);
    assert.strictEqual(r.json.words, 'Nothing was changed. This isn\'t a step type Flightdeck can use: ' + words);
    const m = new PF.fs.MemoryFS('n:' + Math.random(), null);
    await assert.rejects(PF.repo.saveStepType(m, JSON.parse(JSON.stringify(d)), null, { expectText: null }), (e) => e.message === words);
  }
});
rule('Names: ID constructor is invalid with checkCustom\'s words; IDs __proto__ and toString are usage', async () => {
  const dir = team({});
  const r = await save(dir, 'constructor', def({ id: 'constructor' }), 'none');
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'invalid']);
  assert.ok(r.json.words.endsWith('"constructor" is a name Flightdeck keeps for itself; choose another id'), r.json.words);
  for (const id of ['__proto__', 'toString']) {
    const u = await save(dir, id, def({ id }), 'none');
    assert.deepStrictEqual([u.json.outcome, u.json.error.kind], ['refused', 'usage'], id);
  }
  assert.deepStrictEqual(scan(dir), []);
});
rule('Names: the <id> argument must equal the input\'s id (usage); Deploy.check.json beside deploy.check is copies', async () => {
  const dir = team({});
  const u = await save(dir, 'other.check', DEF, 'none');
  assert.deepStrictEqual([u.json.outcome, u.json.error.kind], ['refused', 'usage']);
  const d2 = team({ 'step-types/Deploy.check.json': text({ id: 'deploy.check', label: 'D' }) });
  const r = await save(d2, 'deploy.check', { id: 'deploy.check', label: 'D' }, 'none');
  assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'copies']);
});
rule('Names: control characters in <id> and --asked-by are usage; --asked-by constructor, __proto__ and hasOwnProperty aren\'t a person', async () => {
  const dir = team({ 'people.json': PEOPLE });
  for (const id of ['sample\u0000check', 'sample.check\n', 'sample\u0007']) {
    const r = await save(dir, id, DEF, 'none');
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'usage'], JSON.stringify(id));
  }
  for (const by of ['person-avery\u0000', 'x\ny', 'a'.repeat(81)]) {
    const r = await save(dir, 'sample.check', DEF, 'none', ['--asked-by', by]);
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'usage'], JSON.stringify(by));
  }
  for (const by of ['constructor', '__proto__', 'hasOwnProperty']) {
    const r = await save(dir, 'sample.check', DEF, 'none', ['--asked-by', by]);
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'not-allowed'], by);
  }
  assert.ok(!fs.existsSync(at(dir, 'sample.check')));
});

/* ======================= --asked-by ======================= */
rule('--asked-by: unknown and inactive are not-allowed with their words; a valid person is recorded as by in the history line, and askedBy in the output', async () => {
  const dir = team({ 'people.json': PEOPLE });
  const u = await save(dir, 'sample.check', DEF, 'none', ['--asked-by', 'person-x']);
  assert.strictEqual(u.json.words, 'Nothing was changed. --asked-by person-x isn\'t in people.json.');
  const i = await save(dir, 'sample.check', DEF, 'none', ['--asked-by', 'person-blake']);
  assert.deepStrictEqual([i.json.error.kind], ['not-allowed']);
  assert.ok(/Blake Kim is marked inactive/.test(i.json.words));
  const ok = await save(dir, 'sample.check', DEF, 'none', ['--asked-by', 'person-avery']);
  assert.strictEqual(ok.json.outcome, 'done');
  assert.deepStrictEqual(ok.json.askedBy, { id: 'person-avery', name: 'Avery Lee' });
  const line = JSON.parse(fs.readFileSync(path.join(dir, ok.json.history.path), 'utf8'));
  assert.deepStrictEqual([line.by, line.units], ['person-avery', ['Changed by your AI assistant']]);
});
rule('--asked-by: an unreadable or newer people.json is held; two rows for one ID: the first counts', async () => {
  { const dir = team({ 'people.json': '{"format":"flightdeck-people/9","people":[]}' });
    const r = await save(dir, 'sample.check', DEF, 'none', ['--asked-by', 'person-avery']);
    assert.deepStrictEqual([r.json.outcome, r.code], ['held', 4]);
    assert.ok(/people\.json was made with a newer Flightdeck, so who asked can't be checked/.test(r.json.words), r.json.words); }
  if (!ROOT_USER) { const dir = team({ 'people.json': PEOPLE }); fs.chmodSync(path.join(dir, 'people.json'), 0);
    const r = await save(dir, 'sample.check', DEF, 'none', ['--asked-by', 'person-avery']);
    fs.chmodSync(path.join(dir, 'people.json'), 0o644);
    assert.deepStrictEqual([r.json.outcome, r.code], ['held', 4]); }
  { const dir = team({ 'people.json': PEOPLE });
    const r = await save(dir, 'sample.check', DEF, 'none', ['--asked-by', 'person-casey']);
    assert.strictEqual(r.json.outcome, 'done', 'the first row (active) counts'); }
  { const dir = team({});
    const r = await save(dir, 'sample.check', DEF, 'none', ['--asked-by', 'person-avery']);
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind], ['refused', 'not-allowed'], 'no people.json: nobody is in it'); }
});
rule('type save without --asked-by is allowed (a tool may add step types); --note goes in units', async () => {
  const dir = team({});
  const r = await save(dir, 'sample.check', DEF, 'none', ['--note', 'For the release checklist']);
  assert.deepStrictEqual([r.json.outcome, r.json.askedBy], ['done', null]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, r.json.history.path), 'utf8')).units, ['For the release checklist']);
});

/* ======================= outcomes end to end ======================= */
rule('same: the file already says exactly this: nothing written, exit 0, no history', async () => {
  const dir = team({ 'step-types/sample.check.json': text(DEF) }), was = scan(dir);
  const r = await save(dir, 'sample.check', DEF, sha(text(DEF)));
  assert.deepStrictEqual([r.json.outcome, r.json.written, r.code, r.json.history], ['same', false, 0, null]);
  assert.strictEqual(r.json.words, 'Nothing to change: step-types/sample.check.json already says exactly this.');
  assert.deepStrictEqual(scan(dir), was);
});
rule('newer: a file a newer Flightdeck made is refused whatever --expect says', async () => {
  const body = '{"format":"flightdeck-step-type/9","id":"sample.check","label":"X"}', dir = team({ 'step-types/sample.check.json': body });
  for (const e of [sha(body), 'none']) {
    const r = await save(dir, 'sample.check', DEF, e);
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.json.existing], ['refused', 'newer', 'newer']);
  }
  assert.strictEqual(fs.readFileSync(at(dir, 'sample.check'), 'utf8'), body);
});
rule('done: a create and an edit report the rev, the read-back and the history path; type read then gives the same definition', async () => {
  const dir = team({});
  const c = await save(dir, 'sample.check', DEF, 'none');
  assert.deepStrictEqual([c.json.outcome, c.json.existing, c.json.appLoads, c.json.rev.expected, c.json.rev.before, c.json.rev.after, c.json.rev.now], ['done', 'missing', null, 'none', null, sha(text(DEF)), sha(text(DEF))]);
  assert.ok(/^history\/step-types\/sample\.check\/agent-p-[a-z0-9]+-[a-z0-9]{10}\.jsonl$/.test(c.json.history.path), c.json.history.path);
  assert.strictEqual(c.json.path, 'step-types/sample.check.json');
  assert.ok(/^Saved step-types\/sample\.check\.json\./.test(c.json.words));
  const e = await save(dir, 'sample.check', NEW, c.json.rev.after);
  assert.deepStrictEqual([e.json.outcome, e.json.existing, e.json.appLoads, e.json.rev.before], ['done', 'ok', true, sha(text(DEF))]);
  assert.deepStrictEqual((await read(dir, 'sample.check')).json.data.type.def, NEW);
  assert.strictEqual(historyFiles(dir, 'sample.check').length, 2);
});
rule('checked (--dry-run): the verdict and nothing written, step-types/ not created', async () => {
  const dir = team({});
  const r = await save(dir, 'sample.check', DEF, 'none', ['--dry-run']);
  assert.deepStrictEqual([r.json.outcome, r.json.written, r.code, r.json.history], ['checked', false, 0, null]);
  assert.deepStrictEqual(scan(dir), []);
});
rule('Usage: no --json, no --from, a bad id, an unknown flag: refused usage, exit 1, the flightdeck-write/1 shape', async () => {
  const dir = team({}), f = inputFile(JSON.stringify(DEF));
  for (const argv of [['type', 'save', dir, 'sample.check', '--expect', 'none', '--from', f], ['type', 'save', dir, 'sample.check', '--expect', 'none', '--json'], ['type', 'save', dir, 'Sample', '--expect', 'none', '--from', f, '--json'], ['type', 'save', dir, 'sample.check', '--expect', 'none', '--from', f, '--json', '--force']]) {
    const r = await cmd(...argv);
    assert.deepStrictEqual([r.json.outcome, r.json.error.kind, r.code], ['refused', 'usage', 1], argv.join(' '));
    assert.deepStrictEqual(plain(AJ.conforms(r.json, AJ.WRITE1)), []);
  }
  const u = await cmd('type', 'remove', dir, 'sample.check', '--json');
  assert.strictEqual(u.code, 1, 'no remove');
});
rule('No refusal sends an assistant around the command: refusal words never say write the file, edit step-types/, overwrite or replace the file', async () => {
  const dir = team({ 'step-types/sample.check.json': text(DEF), 'step-types/sample.check-LAPTOP.json': '{}' });
  const outs = [await save(dir, 'sample.check', DEF, 'none'), await save(team({}), 'sample.check', '{"id":"sample.check"}', 'none'), await save(team({ 'step-types/x.json': '{"format":"flightdeck-step-type/9","id":"x","label":"X"}' }), 'x', { id: 'x', label: 'X' }, 'none')];
  outs.forEach((r) => assert.ok(!/write the file|edit step-types\/|overwrite|replace the file/i.test(r.json.words), r.json.words));
});
rule('The command never writes outside step-types/<id>.json, one history line and its own temporary files', async () => {
  const dir = team({ 'people.json': PEOPLE });
  await save(dir, 'sample.check', DEF, 'none', ['--asked-by', 'person-avery']);
  const files = scan(dir).filter((p) => !p.endsWith('/'));
  assert.strictEqual(files.length, 3, files.join(', '));
  assert.ok(files.indexOf('step-types/sample.check.json') >= 0 && files.indexOf('people.json') >= 0 && files.some((p) => /^history\/step-types\/sample\.check\/agent-p-.*\.jsonl$/.test(p)));
});
rule('The read commands print flightdeck-read/2 and never change the folder', async () => {
  const dir = team({ 'step-types/sample.check.json': text(DEF) }), was = scan(dir);
  const r = await read(dir, 'sample.check'), l = await list(dir);
  assert.deepStrictEqual([r.json.contract, l.json.contract], ['flightdeck-read/2', 'flightdeck-read/2']);
  assert.deepStrictEqual(scan(dir), was);
});

run();
