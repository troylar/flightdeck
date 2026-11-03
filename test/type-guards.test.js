// flightdeck type list, type read and type save (2.14) when what they read fails: every input each command reads, broken
// every way a read can fail (a listing that fails, a file or folder that vanished after it was listed, access denied, a
// file too big, a link), run in this process against real temporary folders with fs shims. A failed or interrupted read
// is always a problem (complete false), never absence (state missing, rev "none") and never a clean answer: a save
// stopped by one says the next step that fits it, and a check it couldn't finish is named in its warnings.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { rule, run, load } = require('./harness');

const FD = require(path.join(__dirname, '..', 'bin', 'flightdeck.js'));
const PF = load(), AJ = PF.appjson, T = PF.types;
const plain = (v) => JSON.parse(JSON.stringify(v));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-guard-')));
const err = (code) => Object.assign(new Error(code + ': from a test shim'), { code });

const ID = 'sample.check', REL = 'step-types/' + ID + '.json', HD = 'history/step-types/' + ID;
const DEF = { id: ID, label: 'Sample check', hint: 'Checks a sample.', fields: { system: { label: 'System', kind: 'text' } }, record: [{ name: 'approval', label: 'Approval', kind: 'text' }] };
const PEOPLE = JSON.stringify([{ id: 'person-avery', name: 'Avery Lee', folderRole: 'owner' }]);
const DRAFT = ['---', 'process: rel', 'title: Release', 'owner: person-avery', 'roles: lead', '---', '', '## Do · READ-DO {#do}', '- [ ] {sample.check} Check the system @lead {#chk}', '  system: Change board', '  require: approval', ''].join('\n');
const NO_SYSTEM = (() => { const d = JSON.parse(JSON.stringify(DEF)); delete d.fields.system; return d; })();
const DRAFTS_UNCHECKED = 'Couldn\'t check drafts in maps/drafts/. Check them for uses of the removed fields before calling this change complete.';

function team(files) {
  const dir = tmp();
  Object.keys(files).forEach((p) => { const f = path.join(dir, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, files[p]); });
  return dir;
}
const full = (dir, rel) => path.join(dir, ...rel.split('/'));
async function cmd(...argv) { const r = await FD.main(argv); return { code: r.code, json: JSON.parse(r.out) }; }
function inputFile(body) { const f = path.join(tmp(), 'in.json'); fs.writeFileSync(f, body); return f; }
async function save(dir, d, expect, extra) {
  const r = await cmd('type', 'save', dir, ID, '--expect', expect, '--from', inputFile(typeof d === 'string' ? d : JSON.stringify(d, null, 2)), '--json', ...(extra || []));
  assert.deepStrictEqual(plain(AJ.conforms(r.json, AJ.WRITE1)), [], 'flightdeck-write/1: ' + JSON.stringify(r.json).slice(0, 400));
  assert.strictEqual(r.code, PF.save.EXIT[r.json.outcome], 'exit code for ' + r.json.outcome);
  return r;
}
async function shims(list, f) {
  const undo = list.map(([name, make]) => { const was = fs[name]; fs[name] = make(was); return () => { fs[name] = was; }; });
  try { return await f(); } finally { undo.reverse().forEach((u) => u()); }
}
/* A folder with the type saved once (so it has a history line), a draft that uses the field the test save removes, and
   people.json. */
async function folder() {
  const dir = team({ 'people.json': PEOPLE, 'maps/drafts/rel.md': DRAFT });
  const r = await save(dir, DEF, 'none');
  assert.strictEqual(r.json.outcome, 'done', r.json.words);
  const rev = sha(fs.readFileSync(full(dir, REL))), hist = HD + '/' + fs.readdirSync(full(dir, HD))[0];
  return { dir, rev, hist };
}

/* One way to break one input: { shims } for the call, after any change to the folder made now. */
const isDir = (rel) => rel === 'step-types' || rel === 'maps/drafts' || rel === HD;
function breakIt(dir, rel, way) {
  const p = full(dir, rel), here = (x) => String(x) === p;
  if (way === 'listing') return [['readdirSync', (was) => function (x) { if (here(x)) throw err('EACCES'); return was.apply(fs, arguments); }]];
  if (way === 'vanished') return isDir(rel) ? [['readdirSync', (was) => function (x) { if (here(x)) throw err('ENOENT'); return was.apply(fs, arguments); }]]
    : [['lstatSync', (was) => function (x) { if (here(x)) throw err('ENOENT'); return was.apply(fs, arguments); }]];
  if (way === 'denied') return [['openSync', (was) => function (x) { if (here(x)) throw err('EACCES'); return was.apply(fs, arguments); }]];
  if (way === 'big') { fs.writeFileSync(p, Buffer.alloc((rel.indexOf('history/') === 0 ? 16 : 1) * 1048576 + 1, 0x20)); return []; }
  if (way === 'link') { const away = path.join(tmp(), 'moved'); fs.renameSync(p, away); fs.symlinkSync(away, p); return []; }
  throw new Error('no way ' + way);
}
const WAYS = (rel) => (isDir(rel) ? ['listing', 'vanished', 'link'] : ['denied', 'vanished', 'big', 'link']);
const named = (problems, rel) => problems.some((x) => x.path === rel || x.path === rel + '/' || x.path.indexOf(rel + '/') === 0);
const STATE = { denied: 'unreadable', vanished: 'vanished', big: 'oversized', link: 'link' };

/* ---------------- type list and type read ---------------- */
for (const rel of ['step-types', REL]) for (const way of WAYS(rel)) {
  rule('Guard: type list with ' + rel + ' broken (' + way + '): partial, exit 4, the path named, never missing or rev "none"', async () => {
    const { dir } = await folder(), list = breakIt(dir, rel, way);
    const r = await shims(list, () => cmd('type', 'list', dir, '--json'));
    assert.deepStrictEqual(plain(AJ.conforms(r.json.data, AJ.SCHEMA2.stepTypes)), [], 'stepTypes');
    assert.strictEqual(r.code, 4, JSON.stringify(r.json).slice(0, 400));
    assert.strictEqual(r.json.complete, false);
    assert.ok(named(r.json.problems, rel), 'named: ' + JSON.stringify(r.json.problems));
    r.json.data.types.forEach((t) => { assert.notStrictEqual(t.state, 'missing', t.file); assert.notStrictEqual(t.rev, 'none', t.file); });
    const row = r.json.data.types.filter((t) => t.file === ID + '.json')[0];
    if (rel === REL) { assert.ok(row, 'the type is still listed'); assert.strictEqual(row.state, STATE[way]); assert.strictEqual(row.rev, null); }
  });
  rule('Guard: type read with ' + rel + ' broken (' + way + '): partial, exit 4, the path named, never missing or rev "none"', async () => {
    const { dir, rev } = await folder(), list = breakIt(dir, rel, way);
    const r = await shims(list, () => cmd('type', 'read', dir, ID, '--json'));
    assert.deepStrictEqual(plain(AJ.conforms(r.json.data, AJ.SCHEMA2.stepType)), [], 'stepType');
    assert.strictEqual(r.code, 4, JSON.stringify(r.json).slice(0, 400));
    assert.strictEqual(r.json.complete, false);
    assert.ok(named(r.json.problems, rel), 'named: ' + JSON.stringify(r.json.problems));
    const t = r.json.data.type;
    assert.notStrictEqual(t.state, 'missing'); assert.notStrictEqual(t.rev, 'none');
    if (rel === REL) { assert.strictEqual(t.state, STATE[way]); assert.strictEqual(t.rev, null); }
    else if (way !== 'link') { assert.deepStrictEqual([t.state, t.rev, t.position, t.selected], ['ok', rev, null, null], 'read on its own; its place is unknown'); }
    else assert.strictEqual(t.rev, null);
  });
}
rule('Guard: type read when step-types/ can\'t be listed and the type isn\'t there: unreadable, rev null, "Whether this type exists is unknown"', async () => {
  const dir = team({ 'step-types/other.check.json': T.fileText({ id: 'other.check', label: 'Other' }) });
  const r = await shims(breakIt(dir, 'step-types', 'listing'), () => cmd('type', 'read', dir, ID, '--json'));
  assert.strictEqual(r.code, 4);
  const t = r.json.data.type;
  assert.deepStrictEqual([t.state, t.rev], ['unreadable', null]);
  assert.deepStrictEqual(t.errors, ['Flightdeck couldn\'t list step-types/. Whether this type exists is unknown. Check folder access before trying again.']);
});
rule('Guard: with nothing broken, a type that isn\'t there is missing, rev "none", complete', async () => {
  const dir = team({ 'step-types/other.check.json': T.fileText({ id: 'other.check', label: 'Other' }) });
  const r = await cmd('type', 'read', dir, ID, '--json');
  assert.deepStrictEqual([r.code, r.json.complete, r.json.data.type.state, r.json.data.type.rev], [0, true, 'missing', 'none']);
});

/* ---------------- type save ---------------- */
rule('Guard: type save with nothing broken: the dry run warns about the draft and is complete', async () => {
  const { dir, rev } = await folder();
  const r = await save(dir, NO_SYSTEM, rev, ['--dry-run', '--asked-by', 'person-avery']);
  assert.deepStrictEqual([r.json.outcome, r.json.complete, r.json.problems.length], ['checked', true, 0], JSON.stringify(r.json.problems));
  assert.ok(r.json.checks.warnings.some((w) => /Draft rel, step chk/.test(w)), JSON.stringify(r.json.checks.warnings));
});
/* What stops a save (the listing, the target, people.json): nothing written, the path named, words that fit the failure. */
for (const rel of ['step-types', REL, 'people.json']) for (const way of WAYS(rel)) {
  rule('Guard: type save with ' + rel + ' broken (' + way + '): nothing written, the path named, the next step fits the failure', async () => {
    const { dir, rev } = await folder(), list = breakIt(dir, rel, way), before = fs.readFileSync(full(dir, REL));
    const r = await shims(list, () => save(dir, NO_SYSTEM, rev, ['--asked-by', 'person-avery']));
    assert.ok(['held', 'failed'].indexOf(r.json.outcome) >= 0, r.json.outcome + ': ' + r.json.words);
    assert.strictEqual(r.json.written, false);
    assert.ok(fs.readFileSync(full(dir, REL)).equals(before), 'the type is unchanged');
    if (r.json.outcome === 'held') { assert.strictEqual(r.json.complete, false); assert.ok(named(r.json.problems, rel), 'named: ' + JSON.stringify(r.json.problems)); }
    const w = r.json.words;
    if (way === 'denied' || way === 'listing') assert.ok(/Access to .* was denied\. Ask the folder owner to check your access, then try again\./.test(w), w);
    if (way === 'big') assert.ok(/over the [0-9.]+ MB Flightdeck reads/.test(w) && !/synced/.test(w), w);
    if (way === 'vanished' && rel !== 'step-types') assert.ok(/synced/.test(w), w);
    if (way !== 'vanished') assert.ok(!/synced/.test(w), 'only a sync says to wait for one: ' + w);
  });
}
/* What a save only checks (drafts, the type's history): the save goes on, the check is named incomplete. */
for (const rel of ['maps/drafts', 'maps/drafts/rel.md', HD, 'HIST']) for (const way of WAYS(rel === 'HIST' ? 'x' : rel)) {
  rule('Guard: type save with ' + (rel === 'HIST' ? 'a history line' : rel) + ' broken (' + way + '): checked, complete false, the path named and the unfinished check said', async () => {
    const { dir, rev, hist } = await folder(), target = rel === 'HIST' ? hist : rel, list = breakIt(dir, target, way);
    const r = await shims(list, () => save(dir, NO_SYSTEM, rev, ['--dry-run', '--asked-by', 'person-avery']));
    assert.strictEqual(r.json.outcome, 'checked', r.json.words);
    assert.strictEqual(r.json.complete, false, JSON.stringify(r.json.problems));
    assert.ok(named(r.json.problems, target), 'named: ' + JSON.stringify(r.json.problems));
    const W = r.json.checks.warnings;
    if (target.indexOf('maps/drafts') === 0) assert.ok(W.indexOf(DRAFTS_UNCHECKED) >= 0, JSON.stringify(W));
    else assert.ok(W.some((x) => x.indexOf('Couldn\'t read ' + HD + '/') === 0), JSON.stringify(W));
  });
}
rule('Guard: a real save whose draft listing fails is done, with complete false and the unchecked drafts in its warnings', async () => {
  const { dir, rev } = await folder();
  const r = await shims(breakIt(dir, 'maps/drafts', 'listing'), () => save(dir, NO_SYSTEM, rev));
  assert.deepStrictEqual([r.json.outcome, r.json.written, r.json.complete], ['done', true, false]);
  assert.ok(r.json.checks.warnings.indexOf(DRAFTS_UNCHECKED) >= 0);
  assert.ok(named(r.json.problems, 'maps/drafts'));
});

/* ---------------- what the checks can't read, and exact names ---------------- */
rule('Guard: a definition the checks can\'t read (a record name {"toString": null}) is refused invalid under --json, never a crash', async () => {
  const dir = team({});
  const body = '{"id":"sample.check","label":"Sample","record":[{"name":{"toString":null},"label":"Answer","kind":"text"}]}';
  const r = await save(dir, body, 'none');
  assert.deepStrictEqual([r.json.outcome, r.json.error && r.json.error.kind, r.code], ['refused', 'invalid', 1], r.json.words);
  assert.ok(!fs.existsSync(full(dir, REL)));
});
rule('Guard: a case-only evidence rename (Approval to approval) warns about a draft that requires Approval, as its checks will fail', async () => {
  const old = JSON.parse(JSON.stringify(DEF)); old.record[0].name = 'Approval';
  const dir = team({ 'people.json': PEOPLE, 'maps/drafts/rel.md': DRAFT.replace('require: approval', 'require: Approval'), [REL]: T.fileText(old) });
  const r = await save(dir, DEF, sha(fs.readFileSync(full(dir, REL))), ['--dry-run']);
  assert.ok(r.json.checks.warnings.some((w) => /Draft rel, step chk: it requires Approval/.test(w)), JSON.stringify(r.json.checks.warnings));
  assert.deepStrictEqual(plain(T.inUse(old, DEF, [{ process: 'rel', text: DRAFT.replace('require: approval', 'require: Approval') }])).length, 1);
});

run();
