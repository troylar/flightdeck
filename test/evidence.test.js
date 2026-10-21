// Evidence export (docs/design.md section 24, docs/evidence.md): a read-only collector of the raw files, SHA-256 and ZIP
// written in plain JavaScript, the hash graph, and a pack that an independent reader (Python's zipfile) accepts.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const { load, rule, run } = require('./harness');
const { BytesFS, build, NOW } = require('./evidence-fixture');
const PF = load(), S = PF.sha256, Z = PF.zip, E = PF.evidence, repo = PF.repo, P = PF.publish;
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
let fixture = null;
async function folder(opts) { fixture = fixture || await build(load()); return new BytesFS(fixture.files, opts); }

/* The pack as bytes, plus what exportEvidence said. */
async function pack(fsx, scope, opts) {
  const parts = [];
  const res = await repo.exportEvidence(fsx, scope, Object.assign({ sink: u => { parts.push(Buffer.from(u)); }, now: () => Date.parse(NOW), tz: 'UTC' }, opts || {}));
  return { zip: Buffer.concat(parts), res };
}
/* A small reader for the stored (uncompressed) zips these tests make: entries by name, from the central directory. */
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'an end record');
  const n = buf.readUInt16LE(eocd + 10), cdAt = buf.readUInt32LE(eocd + 16), out = {};
  let p = cdAt;
  for (let i = 0; i < n; i++) {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50);
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    assert.ok(flags & 0x800, 'UTF-8 names'); assert.strictEqual(method, 0, 'stored');
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28), data = buf.slice(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    out[name] = { data, crc };
    p += 46 + nl + xl + cl;
  }
  return out;
}
function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* next */ } } return null; }
const PY = python();

/* ---------- SHA-256 ---------- */
rule('SHA-256 in plain JavaScript gives Node\'s digests at the 55, 56 and 64-byte padding boundaries and on 1 MB', () => {
  [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000].forEach(n => {
    const b = Buffer.alloc(n, 0x61);
    assert.strictEqual(S.hex(new Uint8Array(b)), sha(b), n + ' bytes');
  });
  assert.strictEqual(S.hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.strictEqual(S.hex('é ✓ 𝄞'), sha(Buffer.from('é ✓ 𝄞', 'utf8')), 'text is hashed as UTF-8');
  const mb = crypto.randomBytes(1048576);
  assert.strictEqual(S.hex(new Uint8Array(mb)), sha(mb), '1 MB');
});

rule('SHA-256 is incremental: any split of the input into chunks gives the same digest', () => {
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
  for (let t = 0; t < 40; t++) {
    const b = crypto.randomBytes(rnd(5000)), h = S.create();
    for (let at = 0; at < b.length;) { const k = Math.min(b.length - at, rnd(200)); h.update(new Uint8Array(b.slice(at, at + k))); at += k; }
    assert.strictEqual(h.digest(), sha(b), 'split ' + t);
  }
});

/* ---------- ZIP ---------- */
rule('CRC-32 matches the standard check value and zlib', () => {
  assert.strictEqual(Z.crc32(new Uint8Array(Buffer.from('123456789'))), 0xcbf43926);
  const b = crypto.randomBytes(70000), zlib = require('zlib');
  if (zlib.crc32) assert.strictEqual(Z.crc32(new Uint8Array(b)), zlib.crc32(b));
  assert.strictEqual(Z.crc32(new Uint8Array(b.slice(30000)), Z.crc32(new Uint8Array(b.slice(0, 30000)))), Z.crc32(new Uint8Array(b)), 'incremental');
});

rule('ZIP limits follow PKWARE without Zip64, checked with virtual sizes: entries, sizes, offsets and the central directory', () => {
  const MAX = 0xFFFFFFFE;
  assert.ok(Z.plan([{ name: 'a', size: MAX - 31 - 47 - 22 }]).ok, 'just under 4 GiB fits');
  const big = Z.plan([{ name: 'a', size: 0xFFFFFFFF }]);
  assert.ok(!big.ok && /a is 4 GB or more/.test(big.why), big.why);
  const off = Z.plan([{ name: 'a', size: 0x80000000 }, { name: 'b', size: 0x7FFFFFF0 }, { name: 'c', size: 1 }]);
  assert.ok(!off.ok && /past 4 GB/.test(off.why), 'a local header past 4 GiB: ' + off.why);
  const cd = Z.plan([{ name: 'a', size: MAX - 100 }, { name: 'b', size: 0 }]);
  assert.ok(!cd.ok, 'the central directory may not start or end past the limit: ' + cd.why);
  const many = Array.from({ length: 65535 }, (_, i) => ({ name: 'f' + i, size: 0 }));
  assert.ok(Z.plan(many).ok, '65,535 entries fit');
  assert.ok(!Z.plan(many.concat([{ name: 'x', size: 0 }])).ok, '65,536 don\'t');
  const p = Z.plan([{ name: 'ab', size: 10 }]);
  assert.strictEqual(p.bytes, 30 + 2 + 10 + 46 + 2 + 22, 'headers counted exactly');
  assert.ok(!Z.plan([{ name: 'a', size: 10 }], { cap: 100 }).ok, 'a byte cap refuses before building');
});

rule('ZIP names: relative, no "..", no leading slash, no backslash, no drive letter, at most 512 UTF-8 bytes, and unique ignoring case', () => {
  ['../x', 'a/../b', '/x', 'a\\b', 'C:/x', 'c:x', '', 'a//b', './a', 'a/', 'x\u0000y'].forEach(n => assert.ok(Z.checkName(n), 'refused: ' + JSON.stringify(n)));
  assert.strictEqual(Z.checkName('originals/runs/release/run1/run (1).json'), '');
  assert.ok(Z.checkName('é'.repeat(257)), '514 bytes is too long');
  assert.strictEqual(Z.checkName('é'.repeat(256)), '', '512 bytes is fine');
  const bad = Z.checkNames(['a/B.png', 'a/b.png', 'c', 'c']);
  same(bad.map(x => x.name), ['a/b.png', 'c']);
  assert.ok(/differ only in letter case/.test(bad[0].why) && /twice/.test(bad[1].why));
});

rule('The ZIP writer counts every byte it writes: a declared size or CRC that doesn\'t match, a duplicate name or the cap stops it', async () => {
  const parts = [], w = Z.writer({ sink: u => { parts.push(Buffer.from(u)); }, date: new Date(NOW) });
  await w.add('a.txt', new Uint8Array(Buffer.from('hello')));
  await assert.rejects(w.add('A.TXT', new Uint8Array(1)), /letter case/);
  await w.begin('b.bin', 3, Z.crc32(new Uint8Array([1, 2, 3])));
  await w.data(new Uint8Array([1, 2, 4]));
  await assert.rejects(w.end(), /changed while/);
  const w2 = Z.writer({ sink: () => {}, cap: 60 });
  await assert.rejects(w2.add('a.txt', new Uint8Array(40)), /limit/);
});

/* ---------- The collector ---------- */
rule('The collector reads only: with every mutating method throwing, a run with a redundant save receipt is collected and the folder is unchanged', async () => {
  const f = await folder({ strict: true }), before = f.snapshot();
  const col = await repo.collectEvidence(f, { run: 'release/run1' }, { now: () => Date.parse(NOW) });
  assert.strictEqual(f.mutations.length, 0, f.mutations.join(', '));
  assert.strictEqual(f.snapshot(), before);
  assert.ok(col.files.some(x => x.path === 'runs/release/run1/run.json'));
  const ro = repo.readOnly(f);
  ['write', 'append', 'remove'].forEach(m => assert.throws(() => ro[m]('x', 'y'), /read-only/));
  assert.ok(!ro.writeTest && !ro.url, 'only list, read, stat and blob');
});

rule('A pack holds the run\'s reports (copies too, the unreadable flagged) and decisions on them, and says which were accepted', async () => {
  await folder();
  const rep = { format: 'flightdeck-report/1', run: 'release/run1', publication: { folder: 'v1-aaaa1111', version: 1 }, step: 'deploy', verdict: 'pass', producer: { name: 'ci-check', version: '1.0.0' }, created: NOW, id: 'abcd1234' };
  const text = JSON.stringify(rep, null, 2) + '\n', sha = crypto.createHash('sha256').update(text).digest('hex');
  const dec = { format: 'flightdeck-report-decision/1', process: 'release', run: 'run1', step: 'deploy', producer: 'ci-check', report: 'abcd1234', sha256: sha, status: 'accepted', inputs: 'unknown', answer: { at: NOW, by: 'person-casey', fp: 'a'.repeat(64) }, by: 'person-casey', at: NOW, rev: 1, seen: null };
  const dname = 'run1.' + PF.reports.decisionHash({ process: 'release', run: 'run1', step: 'deploy', producer: 'ci-check', id: 'abcd1234' }) + '.w1.1.json';
  const extra = {
    'reports/release/run1.deploy.ci-check.abcd1234.json': Buffer.from(text),
    'reports/release/run1.deploy.ci-check.abcd1234-LAPTOP.json': Buffer.from(text),
    'reports/release/run1.deploy.ci-check.zzzz9999.json': Buffer.from('{"format": "flightdeck-rep'),
    'reports/release/run9.deploy.ci-check.abcd1234.json': Buffer.from(text.replace('run1', 'run9')),
    ['report-decisions/release/' + dname]: Buffer.from(JSON.stringify(dec, null, 2) + '\n')
  };
  const f = new BytesFS(Object.assign({}, fixture.files, extra)), col = await repo.collectEvidence(f, { run: 'release/run1' }, { now: () => Date.parse(NOW) });
  const reps = col.files.filter(x => x.role === 'report').map(x => x.path).sort();
  same(reps, ['reports/release/run1.deploy.ci-check.abcd1234-LAPTOP.json', 'reports/release/run1.deploy.ci-check.abcd1234.json', 'reports/release/run1.deploy.ci-check.zzzz9999.json'], 'this run\'s reports, OneDrive\'s copy and the unreadable one; never another run\'s');
  assert.ok(col.files.filter(x => x.role === 'report').every(x => /a claim, not proof/.test(x.label)));
  assert.ok(/couldn't be read/.test(col.files.filter(x => /zzzz9999/.test(x.path))[0].flag), 'the unreadable one is flagged');
  const d = col.files.filter(x => x.role === 'report decision');
  assert.strictEqual(d.length, 1);
  assert.ok(d[0].label.indexOf('accepted ci-check/abcd1234, sha256 ' + sha) >= 0, d[0].label);
});

rule('A pack keeps every file in the run folder; lineage receipts and temporary files are left out with their real reasons', async () => {
  const f = await folder(), col = await repo.collectEvidence(f, { run: 'release/run1' }, { now: () => Date.parse(NOW) });
  const has = p => col.files.filter(x => x.path === fixture.base + p)[0];
  ['run.json', 'notes-w2.jsonl', 'history-w1.jsonl', 'run-LAPTOP.json', 'run (1).json', 'candidate-other-zzzz9999.json', 'files/20261017-aaaaaa-w2-shot.png', 'files/20261017-bbbbbb-w2-deploy.log'].forEach(p => assert.ok(has(p), p));
  assert.ok(/may not be in run\.json/.test(has('candidate-other-zzzz9999.json').flag), 'the orphan receipt is flagged');
  assert.ok(/OneDrive/.test(has('run-LAPTOP.json').label) && /OneDrive/.test(has('run (1).json').label));
  const lin = col.exclusions.filter(x => /^runs\/release\/run1\/candidate-w1-/.test(x.path));
  assert.ok(lin.length >= 1 && lin.every(x => x.reason === 'already included in run.json, which lists it in its lineage'), JSON.stringify(col.exclusions));
  assert.ok(col.exclusions.some(x => x.path === fixture.base + 'run.json.1a2b.tmp' && x.reason === 'temporary file left by a save'));
  assert.ok(col.exclusions.some(x => x.path === 'people.json' && /people directory and its email fields are left out/.test(x.reason)));
  assert.ok(!col.files.some(x => x.path === 'people.json'));
  const fu = col.files.filter(x => /^followups\//.test(x.path)).map(x => x.path).sort();
  same(fu, ['followups/release/run1.fu1.w2.1-LAPTOP.json', 'followups/release/run1.fu1.w2.1.json', 'followups/release/run1.fu2.w3.1.json'], 'its follow-up decisions, OneDrive\'s copy and the unreadable one; never another run\'s');
  assert.ok(/couldn't be read/.test(col.files.filter(x => x.path === 'followups/release/run1.fu2.w3.1.json')[0].flag));
  assert.ok(col.files.some(x => x.path === 'suggestions/release/f1.w3.json'), 'the legacy decision on this run\'s suggested fix');
  assert.ok(!col.files.some(x => x.path === 'suggestions/release/other.w3.json'), 'not one on another run\'s');
  assert.ok(col.files.some(x => x.path === 'corrections/release/' + fixture.groupId + '.w4.1.json'));
  assert.ok(/may relate to this run/.test(col.files.filter(x => x.path === 'corrections/release/zzz.w5.1.json')[0].flag), 'an unreadable decision is included and flagged');
  ['map.md', 'types.json', 'publication.json'].forEach(n => assert.ok(col.files.some(x => x.path === 'publications/release/' + fixture.v1 + '/' + n), n));
});

rule('A malformed notes line is listed by its line number, and two notes with one ID both appear', async () => {
  const { zip, res } = await pack(await folder(), { run: 'release/run1' });
  const notes = res.col.runs[0].notes.filter(n => n.file === 'notes-w2.jsonl')[0];
  same(notes.malformed, [4]);
  const html = unzip(zip)['evidence.html'].data.toString('utf8');
  assert.ok(html.includes('First note with the shared ID') && html.includes('Second note with the shared ID'));
  assert.ok(/notes-w2\.jsonl.{0,200}line 4/s.test(html), 'the page names the line');
});

rule('evidence.html runs no script: exact CSP, no <script> tag, and markup in a note stays text', async () => {
  const { zip } = await pack(await folder(), { run: 'release/run1' });
  const html = unzip(zip)['evidence.html'].data.toString('utf8');
  assert.ok(html.includes('<meta http-equiv="Content-Security-Policy" content="' + E.CSP + '">'));
  assert.strictEqual(E.CSP, 'default-src \'none\'; img-src data:; style-src \'unsafe-inline\'');
  assert.ok(!/<script/i.test(html), 'no script tag');
  assert.ok(!/<img src=x/i.test(html) && html.includes('&lt;img src=x onerror=alert(2)&gt;') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(/<img [^>]*src="data:image\/png;base64,/.test(html), 'a picture is inline');
});

rule('A run file from a newer Flightdeck is packed as it is, and the page says it shows only what this copy understands', async () => {
  const f = await folder(), p = fixture.base + 'run.json';
  const o = JSON.parse(f.files.get(p).toString('utf8')); o.format = 'preflight-run/9'; o.newThing = { a: 1 };
  f.files.set(p, Buffer.from(JSON.stringify(o)));
  const { zip } = await pack(f, { run: 'release/run1' }), z = unzip(zip);
  assert.ok(z['originals/' + p].data.equals(f.files.get(p)), 'the original bytes');
  assert.ok(z['evidence.html'].data.toString('utf8').includes('This page shows only what this copy understands; the original files are complete.'));
});

rule('A missing run.json still gives a pack of what\'s there, marked partial', async () => {
  const f = await folder(); f.files.delete(fixture.base + 'run.json');
  const { zip, res } = await pack(f, { run: 'release/run1' });
  assert.strictEqual(res.status, 'partial');
  const z = unzip(zip);
  assert.ok(z['originals/' + fixture.notesPath] && z['originals/' + fixture.base + 'run-LAPTOP.json']);
  assert.ok(/run\.json is missing/.test(JSON.parse(z['manifest.json'].data).unresolved.join(' ')));
});

rule('"Published in v2" comes with v2\'s checklist, types and record; without them it reads "Can\'t be confirmed from this pack"', async () => {
  let { zip, res } = await pack(await folder(), { run: 'release/run1' });
  let z = unzip(zip), html = z['evidence.html'].data.toString('utf8');
  const v2 = 'publications/release/' + fixture.v2 + '/';
  ['map.md', 'types.json', 'publication.json'].forEach(n => assert.ok(z['originals/' + v2 + n], n));
  const claim = res.col.runs[0].claims.filter(c => c.group === fixture.groupId)[0];
  assert.ok(claim && claim.text === 'Published in v2' && claim.verified, JSON.stringify(res.col.runs[0].claims));
  assert.ok(html.includes('Published in v2'));
  const f = await folder(); f.files.delete(v2 + 'map.md');
  ({ zip, res } = await pack(f, { run: 'release/run1' }));
  html = unzip(zip)['evidence.html'].data.toString('utf8');
  const c2 = res.col.runs[0].claims.filter(c => c.group === fixture.groupId)[0];
  assert.ok(c2 && !c2.verified && /Can't be confirmed from this pack/.test(c2.status), JSON.stringify(c2));
  assert.ok(html.includes('Can&#39;t be confirmed from this pack'));
});

rule('A /2 v2 proves "Published in v2" by its exact bytes: a byte-order mark added to its map.md (which the app refuses) leaves the claim unconfirmed', async () => {
  const fx = await build(load(), { v2note: true }), v2 = 'publications/release/' + fx.v2 + '/';
  assert.strictEqual(JSON.parse(fx.files[v2 + 'publication.json'].toString('utf8')).format, 'preflight-publication/2', 'v2 is a /2 version');
  let { res } = await pack(new BytesFS(fx.files), { run: 'release/run1' });
  const claim = res.col.runs[0].claims.filter(c => c.group === fx.groupId)[0];
  assert.ok(claim && claim.text === 'Published in v2' && claim.verified, 'as published: ' + JSON.stringify(res.col.runs[0].claims));
  const files = Object.assign({}, fx.files, { [v2 + 'map.md']: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fx.files[v2 + 'map.md']]) });
  const good = await repo.loadAll(new BytesFS(fx.files), { deep: true }), bad = await repo.loadAll(new BytesFS(files), { deep: true });
  assert.ok(good.processes[0].index.all.some(v => v.info.folder === fx.v2), 'the app reads v2 as published');
  assert.ok(!bad.processes[0].index.all.some(v => v.info.folder === fx.v2), 'the app refuses v2 with a byte-order mark');
  ({ res } = await pack(new BytesFS(files), { run: 'release/run1' }));
  const c2 = res.col.runs[0].claims.filter(c => c.group === fx.groupId)[0];
  assert.ok(c2 && !(c2.text === 'Published in v2' && c2.verified), 'with a byte-order mark: ' + JSON.stringify(c2));
});

rule('A run\'s frozen step types that differ from the version\'s types.json are flagged first, in red', async () => {
  const f = await folder(), p = fixture.base + 'run.json';
  const o = JSON.parse(f.files.get(p).toString('utf8')); o.types.confirm = Object.assign({}, o.types.confirm, { label: 'Changed by hand' });
  f.files.set(p, Buffer.from(JSON.stringify(o)));
  const { zip, res } = await pack(f, { run: 'release/run1' });
  const chk = res.col.runs[0].checks;
  assert.ok(chk.some(c => c.id === 'types' && c.ok === false) && chk.some(c => c.id === 'snapshot' && c.ok === true) && chk.some(c => c.id === 'mapHash' && c.ok === true), JSON.stringify(chk));
  const html = unzip(zip)['evidence.html'].data.toString('utf8');
  assert.ok(html.indexOf('class="bad"') >= 0 && html.indexOf('class="bad"') < html.indexOf('<h2'), 'shown before anything else');
});

rule('The hash graph: the manifest covers the payload, SHA256SUMS covers payload and manifest, and the pack\'s own digest is given outside it', async () => {
  const { zip, res } = await pack(await folder(), { run: 'release/run1' }), z = unzip(zip);
  const man = JSON.parse(z['manifest.json'].data), payload = Object.keys(z).filter(n => n !== 'manifest.json' && n !== 'SHA256SUMS');
  same(man.files.map(x => x.pack).concat(man.generated.map(x => x.path)).sort(), payload.sort());
  man.files.forEach(x => assert.strictEqual(sha(z[x.pack].data), x.sha256, x.pack));
  man.generated.forEach(x => assert.strictEqual(sha(z[x.path].data), x.sha256, x.path));
  const sums = z.SHA256SUMS.data.toString('utf8').trim().split('\n').map(l => /^([0-9a-f]{64}) {2}(.+)$/.exec(l));
  assert.ok(sums.every(Boolean));
  same(sums.map(m => m[2]).sort(), payload.concat(['manifest.json']).sort(), 'SHA256SUMS lists payload and manifest, not itself');
  sums.forEach(m => assert.strictEqual(sha(z[m[2]].data), m[1], m[2]));
  assert.strictEqual(res.digest, sha(zip), 'the digest shown is the zip\'s own');
  assert.ok(!zip.includes(Buffer.from(res.digest)), 'never inside the pack');
  const readme = z['README.txt'].data.toString('utf8');
  assert.ok(readme.includes('Compare the pack\'s own digest with one you kept separately. An unsigned pack can\'t prove by itself that it hasn\'t changed, or who made it.'));
  assert.ok(readme.includes(E.PRIVACY));
  // sha256sum -c (or shasum) agrees, when the computer has one.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-sums-'));
  Object.keys(z).forEach(n => { const p = path.join(dir, ...n.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, z[n].data); });
  for (const tool of [['sha256sum', ['-c', 'SHA256SUMS']], ['shasum', ['-a', '256', '-c', 'SHA256SUMS']]]) {
    try { cp.execFileSync(tool[0], tool[1], { cwd: dir, stdio: 'pipe' }); console.log('  (' + tool[0] + ' -c agrees)'); break; } catch (e) { if (e.code !== 'ENOENT') throw new Error(tool[0] + ' disagrees: ' + e.stdout + e.stderr); }
  }
});

rule('An independent reader accepts the pack: Python\'s zipfile checks every CRC and the manifest\'s hashes', async () => {
  if (!PY) return console.log('  (skipped: no Python)');
  const { zip } = await pack(await folder(), { run: 'release/run1' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-zip-')), file = path.join(dir, 'pack.zip');
  fs.writeFileSync(file, zip);
  cp.execFileSync(PY, ['-I', '-m', 'zipfile', '-t', file], { stdio: 'pipe' });
  const out = cp.execFileSync(PY, ['-I', path.join(__dirname, 'check_pack.py'), file], { encoding: 'utf8' });
  assert.ok(/^ok \d+ entries/.test(out), out);
});

rule('A notes file that grows while it\'s collected is collected again, and once it settles the pack is complete', async () => {
  let grows = 1;
  const f = await folder({ hooks: { blob: (p, x) => { if (p === fixture.notesPath && grows-- > 0) x.files.set(p, Buffer.concat([x.files.get(p), Buffer.from('{"id":"late","at":"' + NOW + '","by":"person-blake","text":"late"}\n')])); } } });
  const { res } = await pack(f, { run: 'release/run1' });
  assert.strictEqual(res.status, 'complete');
  assert.strictEqual(res.col.attempts, 2, 'collected twice');
});

rule('A notes file that keeps growing is retried twice, then the pack is partial and says so at the top', async () => {
  const f = await folder({ hooks: { blob: (p, x) => { if (p === fixture.notesPath) x.files.set(p, Buffer.concat([x.files.get(p), Buffer.from('{"id":"late","at":"' + NOW + '","by":"person-blake","text":"late"}\n')])); } } });
  const { zip, res } = await pack(f, { run: 'release/run1' });
  assert.strictEqual(res.status, 'partial');
  assert.strictEqual(res.col.attempts, 3);
  const html = unzip(zip)['evidence.html'].data.toString('utf8');
  assert.ok(/The run changed while this pack was made: notes-w2\.jsonl grew\./.test(html), 'named');
  assert.ok(html.indexOf('notes-w2.jsonl grew') < html.indexOf('<h2'), 'at the top');
});

rule('Without attachments, they are listed with their size and marked left out, never read', async () => {
  const f = await folder(), { zip, res } = await pack(f, { run: 'release/run1' }, { attachments: false });
  const z = unzip(zip);
  assert.ok(!z['originals/' + fixture.shot] && !z['originals/' + fixture.log]);
  const ex = res.col.exclusions.filter(x => x.path === fixture.log)[0];
  assert.ok(ex && ex.reason === 'left out, not hashed' && ex.size === 10, JSON.stringify(ex));
});

rule('The readable report is one page, labeled as not the evidence pack, and lists what it leaves out', async () => {
  const parts = [];
  const res = await repo.exportEvidence(await folder(), { run: 'release/run1' }, { format: 'report', sink: u => parts.push(Buffer.from(u)), now: () => Date.parse(NOW), tz: 'UTC' });
  const html = Buffer.concat(parts).toString('utf8');
  assert.ok(/\.html$/.test(res.name) && html.includes('A readable report, not the evidence pack') && /leaves out/.test(html) && !/<script/i.test(html));
});

rule('Dates are inclusive, from 00:00:00.000 to 23:59:59.999 of the through day in the chosen time zone', () => {
  let r = E.dayRange('2026-10-17', '2026-10-17', 'UTC');
  same([new Date(r.start).toISOString(), new Date(r.end).toISOString()], ['2026-10-17T00:00:00.000Z', '2026-10-17T23:59:59.999Z']);
  r = E.dayRange('2026-10-17', '2026-10-18', 'America/New_York');
  same([new Date(r.start).toISOString(), new Date(r.end).toISOString()], ['2026-10-17T04:00:00.000Z', '2026-10-19T03:59:59.999Z']);
  r = E.dayRange('2026-11-01', '2026-11-01', 'America/New_York');
  same([new Date(r.start).toISOString(), new Date(r.end).toISOString()], ['2026-11-01T04:00:00.000Z', '2026-11-02T04:59:59.999Z'], 'a 25-hour day');
  assert.throws(() => E.dayRange('2026-10-18', '2026-10-17', 'UTC'), /after/);
  assert.throws(() => E.dayRange('2026-02-30', '2026-03-01', 'UTC'), /real date/);
  assert.throws(() => E.dayRange('2026-10-17', '2026-10-17', 'Mars/Base'), /time zone/);
});

rule('Browser caps: 500 MB on a desktop, 150 MB on a phone or low-memory device, and an over-cap pack is refused before anything is read', async () => {
  same([E.capFor({ width: 1440, deviceMemory: 8 }), E.capFor({ width: 375, deviceMemory: 8 }), E.capFor({ width: 1440, deviceMemory: 4 })], [500 * 1048576, 150 * 1048576, 150 * 1048576]);
  const f = await folder(), big = 'runs/release/run1/files/20261017-cccccc-w2-huge.log';
  f.files.set(big, Buffer.alloc(1)); f.stat = p => Promise.resolve(p === big ? { size: 160 * 1048576, mtime: 1 } : BytesFS.prototype.stat.call(f, p));
  const blob0 = f.calls.blob;
  await assert.rejects(repo.exportEvidence(f, { run: 'release/run1' }, { sink: () => {}, cap: E.capFor({ width: 375 }), maxFile: 1e12 }), /about 16\d\.\d MB.*150 MB/);
  assert.strictEqual(f.calls.blob, blob0, 'nothing read');
  const res = await repo.collectEvidence(f, { run: 'release/run1' }, { cap: 500 * 1048576, plan: true });
  assert.ok(res.exclusions.some(x => x.path === big && /over 100 MB/.test(x.reason)), 'a single file over 100 MB is left out with its reason and size');
});

rule('Cancel stops collecting between chunks, and nothing is written', async () => {
  let stop = false, wrote = 0;
  const f = await folder({ hooks: { blob: () => { stop = true; } } });
  await assert.rejects(repo.exportEvidence(f, { run: 'release/run1' }, { sink: () => { wrote++; }, cancelled: () => stop }), e => e.cancelled === true);
  assert.strictEqual(wrote, 0);
});

/* ---------- Review fixes (78edf20) ---------- */
rule('run.json replaced between planning and hashing: what the pack keeps and leaves out follows the bytes in the pack, never the earlier read', async () => {
  const p = 'runs/release/run1/run.json'; let swapped = false;
  const f = await folder({ hooks: { blob: (q, x) => { if (q === p && !swapped) { swapped = true; const o = JSON.parse(x.files.get(q).toString('utf8')); const was = x.files.get(q).toString('utf8'); o.lineage.forEach(t => { was.indexOf(t); }); x.files.set(q, Buffer.from(o.lineage.reduce((txt, t) => txt.split('"' + t + '"').join('"' + 'x'.repeat(t.length) + '"'), was))); } } } });
  const { res } = await pack(f, { run: 'release/run1' });
  const cand = res.col.files.filter(x => /candidate-w1-/.test(x.path));
  assert.ok(cand.length >= 1 && cand.every(x => /may not be in run\.json/.test(x.flag)), 'with other names in the lineage (same size), every receipt is kept and flagged: ' + JSON.stringify(res.col.exclusions));
  assert.ok(!res.col.exclusions.some(x => /candidate-w1-/.test(x.path)), 'none left out as "already included"');
  assert.strictEqual(res.status, 'complete');
  // One snapshot: what decided the exclusions is the run.json in the pack.
  const packed = JSON.parse(unzip((await pack(new BytesFS(Object.fromEntries([...f.files].map(([k, v]) => [k, v])), {}), { run: 'release/run1' })).zip)['originals/' + p].data.toString('utf8').replace(/^\uFEFF/, ''));
  assert.ok(packed.lineage.every(t => /^x+$/.test(t)), 'the packed run.json is the one whose lineage was used');
});

rule('A file rewritten between hashing and writing, with the same size and CRC, stops the pack: its SHA-256 is checked on the second read too', async () => {
  // A copy whose CRC-32 says nothing, so only SHA-256 can tell the bytes apart.
  const PF2 = load(false, (f, src) => f === 'core/zip.js' ? src.replace('function crc32(u8, prev) {', 'function crc32(u8, prev) { return 0;') : src);
  let n = 0;
  const f = await folder({ hooks: { blob: (q, x) => { if (q === fixture.log && ++n === 2) x.files.set(q, Buffer.from('deploy KO\n')); } } });
  await assert.rejects(PF2.repo.exportEvidence(f, { run: 'release/run1' }, { sink: () => {}, keepBytes: false, tz: 'UTC' }), /changed while/);
  assert.strictEqual(n, 2, 'read twice');
});

rule('Planning never reads a file over the limit, nor another run\'s files before sizes are checked, and a pack past the cap reads no notes at all', async () => {
  const other = 'runs/release/run2/notes-w9.jsonl', big = fixture.notesPath, reads = {};
  const files = Object.assign({}, fixture.files);
  files['runs/release/run2/run.json'] = fixture.files['runs/release/run1/run.json'];
  files[other] = Buffer.from('{"id":"o1","text":"other run"}\n');
  const f = new BytesFS(files, { hooks: { read: q => { reads[q] = (reads[q] || 0) + 1; }, blob: q => { reads[q] = (reads[q] || 0) + 1; } } });
  const stat = f.stat.bind(f);
  f.stat = q => q === other || q === big ? stat(q).then(st => st && Object.assign({}, st, { size: 200 * 1048576 })) : stat(q);
  const col = await repo.collectEvidence(f, { run: 'release/run1' }, { cap: 500 * 1048576, plan: true });
  assert.ok(!reads[other] && !reads[big], 'files over 100 MB are never read: ' + JSON.stringify(reads));
  assert.ok(col.exclusions.some(x => x.path === big && /over 100 MB/.test(x.reason)));
  Object.keys(reads).forEach(k => delete reads[k]);
  f.stat = stat;
  await assert.rejects(repo.exportEvidence(f, { run: 'release/run1' }, { sink: () => {}, cap: 4000 }), /limit/);
  assert.ok(!Object.keys(reads).some(k => /notes-/.test(k)), 'refused from sizes alone, before any notes file is read: ' + Object.keys(reads).join(', '));
});

rule('A screenshot shared by many runs is shown once, the estimate covers what the page really holds, and the report is written through checked counters', async () => {
  const files = Object.assign({}, fixture.files), shot = 'publications/release/' + fixture.v1 + '/images/release/big.png';
  files[shot] = Buffer.concat([require('./evidence-fixture').PNG, crypto.randomBytes(1048576)]);
  const t = fixture.files['runs/release/run1/run.json'].toString('utf8');
  for (let i = 2; i <= 6; i++) files['runs/release/run' + i + '/run.json'] = Buffer.from(t.replace(/"id": "run1"/, '"id": "run' + i + '"'));
  const f = new BytesFS(files), scope = { process: 'release', from: '2026-10-17', through: '2026-10-17', tz: 'UTC' };
  const plan = await repo.collectEvidence(f, scope, { plan: true });
  const parts = [], res = await repo.exportEvidence(f, scope, { format: 'report', sink: u => parts.push(Buffer.from(u)), tz: 'UTC' });
  const html = Buffer.concat(parts).toString('utf8');
  assert.strictEqual(res.col.runs.length, 6);
  const shown = html.split('alt="' + shot + '"').length - 1;
  assert.strictEqual(shown, 1, 'the shared screenshot is embedded once');
  assert.ok(res.bytes <= plan.estimate, 'estimate ' + plan.estimate + ' covers the report ' + res.bytes);
  await assert.rejects(repo.exportEvidence(f, scope, { format: 'report', sink: () => {}, tz: 'UTC', cap: res.bytes - 1, maxFile: 1e12, estimateSlack: 0 }), /limit/);
});

rule('Two names that differ only in letter case both go in the pack: the second is renamed first, then every final name is checked', async () => {
  const files = Object.assign({}, fixture.files);
  files['runs/release/run1/files/A.txt'] = Buffer.from('upper');
  files['runs/release/run1/files/a.txt'] = Buffer.from('lower');
  const { zip, res } = await pack(new BytesFS(files), { run: 'release/run1' }), z = unzip(zip);
  assert.strictEqual(res.status, 'complete');
  const a = res.col.files.filter(x => /files\/[Aa]\.txt$/.test(x.path));
  assert.strictEqual(a.length, 2);
  assert.ok(a.some(x => / \(2\)\.txt$/.test(x.pack)), a.map(x => x.pack).join(', '));
  a.forEach(x => assert.ok(z[x.pack] && z[x.pack].data.toString() === (/A\.txt$/.test(x.path) ? 'upper' : 'lower'), x.pack));
});

rule('Days follow the clock in the time zone, across a midnight that is skipped or repeated', () => {
  const day = (t, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  /* The first minute whose local date is d or later, found by walking every minute: an oracle that knows nothing of offsets. */
  const first = (d, tz) => { const g = Date.parse(d + 'T00:00:00Z'); for (let t = g - 16 * 3600000; ; t += 60000) if (day(t, tz) >= d) return t; };
  const next = d => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  [['America/Santiago', '2026-09-05'], ['America/Santiago', '2026-09-06'], ['America/Santiago', '2026-04-04'], ['America/Santiago', '2026-04-05'], ['America/Havana', '2026-03-07'], ['America/Havana', '2026-03-08'],
   ['America/Havana', '2026-10-31'], ['Asia/Beirut', '2026-03-28'], ['Asia/Beirut', '2026-03-29'], ['America/Asuncion', '2026-10-03'], ['Australia/Lord_Howe', '2026-10-04'], ['Europe/London', '2026-03-29'], ['UTC', '2026-10-17']].forEach(([tz, d]) => {
    const r = E.dayRange(d, d, tz);
    assert.strictEqual(new Date(r.start).toISOString(), new Date(first(d, tz)).toISOString(), tz + ' ' + d + ' start');
    assert.strictEqual(new Date(r.end + 1).toISOString(), new Date(first(next(d), tz)).toISOString(), tz + ' ' + d + ' end');
    for (let t = r.start - 3 * 3600000; t <= r.end + 3 * 3600000; t += 15 * 60000) assert.strictEqual(E.inRange(new Date(t).toISOString(), r), day(t, tz) === d, tz + ' ' + new Date(t).toISOString());
  });
  assert.ok(E.inRange('2026-09-06T03:30:00.000Z', E.dayRange('2026-09-05', '2026-09-05', 'America/Santiago')), 'September 5 at 11:30 PM in Santiago');
});

rule('Times a run file can\'t give are "time unknown" on the page, never 1970, and the page says some times couldn\'t be read', async () => {
  const f = await folder(), p = fixture.base + 'run.json';
  const o = JSON.parse(f.files.get(p).toString('utf8')); o.created = 'not a time'; o.log.push({ at: 'later', by: 'person-casey', what: 'Something' }); o.steps[Object.keys(o.steps)[0]].at = null;
  f.files.set(p, Buffer.from(JSON.stringify(o)));
  const { zip, res } = await pack(f, { run: 'release/run1' });
  const html = unzip(zip)['evidence.html'].data.toString('utf8');
  assert.ok(/started time unknown/.test(html), 'the start');
  assert.ok(!/1970-01-01/.test(html) && !/not a time/.test(html.replace(/<p class="warn">[^<]*<\/p>/g, '')), 'never a made-up time, nor the bad text as if it were one');
  assert.ok(/Some times in run\.json couldn(&#39;|')t be read/.test(html) && /Some times in run\.json/.test(res.col.runs[0].limited));
  assert.strictEqual(unzip(zip)['originals/' + p].data.toString('utf8'), JSON.stringify(o), 'the original keeps them as written');
});

/* ---------- Second review (48f49d7) ---------- */
const S2 = require('./evidence-fixture');
function twoRuns(extra) {
  const files = Object.assign({}, fixture.files), t = fixture.files['runs/release/run1/run.json'].toString('utf8');
  files['runs/release/run2/run.json'] = Buffer.from(t.replace(/"id": "run1"/, '"id": "run2"'));
  return Object.assign(files, extra || {});
}
rule('One snapshot per file for the whole pack: a version file that changes mid-export is never packed with one text and checked with another', async () => {
  const map = 'publications/release/' + fixture.v1 + '/map.md';
  let n = 0;
  const f = new BytesFS(twoRuns(), { hooks: { blob: (q, x) => { if (q === map && ++n === 1) setTimeout(() => x.files.set(q, Buffer.concat([x.files.get(q), Buffer.from('\n')])), 0); } } });
  const { zip, res } = await pack(f, { process: 'release', from: '2026-10-17', through: '2026-10-17', tz: 'UTC' }), z = unzip(zip);
  const packed = z['originals/' + map].data.toString('utf8');
  res.col.runs.forEach(rc => {
    const texts = {}; ['map.md', 'types.json', 'publication.json'].forEach(n2 => { texts[n2] = z['originals/publications/release/' + fixture.v1 + '/' + n2].data.toString('utf8'); });
    same(rc.checks, E.checks(rc.raw, texts), rc.key + ': its checks are of the bytes in the pack');
  });
  assert.ok(res.status === 'complete' ? packed === f.files.get(map).toString('utf8') : res.col.unresolved.some(u => /map\.md/.test(u)), 'either collected again (and consistent with the folder) or said so');
});

rule('Attachments in folders under files/ are attachments too: left out with the others', async () => {
  const files = Object.assign({}, fixture.files, { 'runs/release/run1/files/sub/private.pdf': Buffer.from('%PDF private') });
  const col = await repo.collectEvidence(new BytesFS(files), { run: 'release/run1' }, { attachments: false, plan: true });
  assert.ok(!col.files.some(x => /private\.pdf/.test(x.path)) && col.exclusions.some(x => /files\/sub\/private\.pdf$/.test(x.path) && x.reason === 'left out, not hashed'));
});

rule('A decision on this run\'s corrections is always packed, even when other runs are too big to read; then the claim is unconfirmed and the pack partial, saying why', async () => {
  // An older decision whose members name only another run's identical correction belongs to this run's group too.
  const files = twoRuns(), g = fixture.groupId, decPath = 'corrections/release/' + g + '.w4.1.json';
  const dec = JSON.parse(files[decPath].toString('utf8')); dec.members = ['c-other']; files[decPath] = Buffer.from(JSON.stringify(dec, null, 2));
  files['runs/release/run2/notes-w9.jsonl'] = Buffer.from('{"id":"x","text":"x"}\n');
  const f = new BytesFS(files), stat = f.stat.bind(f);
  f.stat = q => q === 'runs/release/run2/notes-w9.jsonl' ? stat(q).then(st => st && Object.assign({}, st, { size: 90 * 1048576 })) : stat(q);
  const { res } = await pack(f, { run: 'release/run1' });
  assert.ok(res.col.files.some(x => x.path === decPath), 'the decision is in the pack');
  const c = res.col.runs[0].claims.filter(x => x.correction === 'c1')[0];
  assert.ok(c && !c.verified && /Can't be confirmed from this pack/.test(c.status), JSON.stringify(res.col.runs[0].claims));
  assert.strictEqual(res.status, 'partial');
  assert.ok(res.col.unresolved.some(u => /too big to read/.test(u)), res.col.unresolved.join(' | '));
});

rule('No file is read before its size is checked, every version record a pack keeps is within one budget, and people.json is sized first', async () => {
  const files = Object.assign({}, fixture.files), big = [];
  for (let i = 3; i < 23; i++) { const b = 'publications/release/v' + i + '-zz' + i + '/'; ['map.md', 'types.json', 'publication.json'].forEach(n => { files[b + n] = Buffer.from('x'); big.push(b + n); }); }
  const statted = new Set(), early = [], reads = {};
  const f = new BytesFS(files, { hooks: { stat: q => statted.add(q), read: q => { reads[q] = 1; if (!statted.has(q)) early.push(q); }, blob: q => { reads[q] = 1; if (!statted.has(q)) early.push(q); } } });
  const stat = f.stat.bind(f);
  f.stat = q => big.indexOf(q) >= 0 || q === 'people.json' ? stat(q).then(st => st && Object.assign({}, st, { size: 60 * 1048576 })) : stat(q);
  const { res } = await pack(f, { run: 'release/run1' }, { cap: 150 * 1048576 });
  assert.deepStrictEqual(early, [], 'read before sized');
  assert.ok(!big.some(q => reads[q]) && !reads['people.json'], 'nothing over budget was read: ' + Object.keys(reads).filter(q => big.indexOf(q) >= 0 || q === 'people.json').join(', '));
  assert.ok(res.col.exclusions.some(x => x.path === 'people.json'), 'people.json is still named as left out');
  assert.ok(res.col.retained && res.col.retained.peak <= res.col.retained.limit && res.col.retained.limit <= 150 * 1048576, 'held at most ' + JSON.stringify(res.col.retained));
});

rule('A UTF-8 byte-order mark on a record is read the same way everywhere: the pack is complete, and the original keeps it', async () => {
  const files = Object.assign({}, fixture.files), p = 'runs/release/run1/run.json';
  files[p] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), files[p]]);
  const { zip, res } = await pack(new BytesFS(files), { run: 'release/run1' });
  assert.strictEqual(res.status, 'complete', res.col.unresolved.join(' '));
  assert.ok(res.col.runs[0].checks.some(c => c.id === 'snapshot' && c.ok === true));
  assert.ok(unzip(zip)['originals/' + p].data.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
});

rule('A file and a folder whose names differ only in letter case can\'t both unpack on Windows: the file is renamed', async () => {
  const files = Object.assign({}, fixture.files, { 'runs/release/run1/extra': Buffer.from('file'), 'runs/release/run1/EXTRA/report.txt': Buffer.from('report') });
  const { zip, res } = await pack(new BytesFS(files), { run: 'release/run1' }), z = unzip(zip);
  const fileRec = res.col.files.filter(x => x.path === 'runs/release/run1/extra')[0];
  assert.ok(fileRec && fileRec.pack !== 'originals/runs/release/run1/extra' && z[fileRec.pack].data.toString() === 'file', fileRec && fileRec.pack);
  assert.ok(z['originals/runs/release/run1/EXTRA/report.txt']);
  assert.ok(/folder/.test((Z.checkNames(['a/x', 'A']) [0] || {}).why || ''), 'checkNames refuses a file named like a folder');
});

/* ---------- Third review (3ba32c5) ---------- */
rule('Decisions unrelated to the pack are read one at a time and let go: what the collection holds in memory stays far below the budget', async () => {
  const files = Object.assign({}, fixture.files);
  for (let i = 0; i < 40; i++) files['corrections/release/z' + i + '.w9.1.json'] = Buffer.from(JSON.stringify({ kind: 'correction-decision', group: 'zz' + i, status: 'declined', reason: 'no', by: 'person-avery', at: NOW, rev: 1, members: ['other' + i], pad: 'x'.repeat(1000000) }));
  const { res } = await pack(new BytesFS(files), { run: 'release/run1' }, { cap: 150 * 1048576 });
  assert.strictEqual(res.status, 'complete', res.col.unresolved.join(' '));
  assert.ok(!res.col.files.some(x => /\/z\d+\.w9/.test(x.path)), 'none of them is in the pack');
  assert.ok(res.col.retained.peak <= 4 * 1048576 + res.col.files.reduce((a, f) => a + f.size, 0), 'held at most ' + (res.col.retained.peak / 1048576).toFixed(1) + ' MB');
});

rule('Files added while a pack is checked are sized and checked against the cap before a retry reads anything', async () => {
  const big = 'runs/release/run1/files/20261017-eeeeee-w2-late.bin';
  let lists = 0;
  const reads = [];
  const f = await folder({ hooks: { list: (q, x) => { if (q === 'runs/release/run1' && ++lists === 3) x.files.set(big, crypto.randomBytes(15 * 1048576)); }, blob: q => reads.push(q) } });
  await assert.rejects(repo.exportEvidence(f, { run: 'release/run1' }, { sink: () => {}, cap: 10 * 1048576 }), /limit/);
  assert.ok(lists >= 4, 'the retry listed the folder again');
  assert.ok(reads.indexOf(big) < 0, 'the new file was never read');
});

rule('The collection never holds more than its budget in memory: past it, nothing more is read and the pack is partial, saying what was left out', async () => {
  const files = Object.assign({}, fixture.files);
  for (let i = 0; i < 6; i++) files['runs/release/run1/files/20261017-ff' + i + '-w2-part.bin'] = crypto.randomBytes(1048576);
  const f = new BytesFS(files), parts = [];
  // A cap the estimate allows, with files that grow once they're listed, so only the accounting while reading can stop it.
  const stat = f.stat.bind(f);
  f.stat = q => /-part\.bin$/.test(q) ? stat(q).then(st => st && Object.assign({}, st, { size: 1 })) : stat(q);
  const res = await repo.exportEvidence(f, { run: 'release/run1' }, { sink: u => parts.push(u), cap: 3 * 1048576, tz: 'UTC' }).then(r => r, e => ({ error: e }));
  assert.ok(res.col, res.error && res.error.message);
  assert.ok(res.col.retained.peak <= 3 * 1048576, 'peak ' + res.col.retained.peak);
  assert.strictEqual(res.status, 'partial');
  assert.ok(res.col.exclusions.some(x => /-part\.bin$/.test(x.path) && /memory/.test(x.reason)) && res.col.unresolved.some(u => /memory/.test(u)), JSON.stringify(res.col.unresolved));
});

/* ---------- Fourth review (efc021d) ---------- */
const gc = (() => { try { require('v8').setFlagsFromString('--expose-gc'); return require('vm').runInNewContext('gc'); } catch (e) { return null; } })();
rule('A decision let go holds nothing of its file: kept fields are copies, and the heap doesn\'t grow with what was read', async () => {
  if (!gc) return console.log('  (skipped: no gc)');
  await folder();
  const files = Object.assign({}, fixture.files);
  for (let i = 0; i < 20; i++) files['corrections/release/y' + i + '.w9.1.json'] = Buffer.from(JSON.stringify({ kind: 'correction-decision', group: 'yy' + i, status: 'declined', reason: 'r'.repeat(900000), by: 'person-avery', at: NOW, rev: 1, members: ['other' + i] }));
  const f = new BytesFS(files);
  gc(); gc();
  const h0 = process.memoryUsage().heapUsed;
  let grew = null;
  await pack(f, { run: 'release/run1' }, { progress: p => { if (p.phase === 'check' && grew == null) { gc(); gc(); grew = process.memoryUsage().heapUsed - h0; } } });
  assert.ok(grew != null && grew < 6 * 1048576, 'the heap grew by ' + (grew / 1048576).toFixed(1) + ' MB while 18 MB of decisions were read');
});

rule('Choosing runs by date reads one run.json at a time, inside the memory budget: never more than the cap at once', async () => {
  await folder();
  const files = Object.assign({}, fixture.files), t = JSON.parse(fixture.files['runs/release/run1/run.json'].toString('utf8'));
  ['old1', 'old2'].forEach(id => { const o = Object.assign({}, t, { id, created: '2026-01-01T00:00:00.000Z', title: 'x'.repeat(2 * 1048576) }); files['runs/release/' + id + '/run.json'] = Buffer.from(JSON.stringify(o)); });
  let inFlight = 0, most = 0;
  const f = new BytesFS(files), rd = f.read.bind(f);
  f.read = q => { inFlight++; most = Math.max(most, inFlight); return new Promise(res => setTimeout(res, 5)).then(() => rd(q)).then(x => { inFlight--; return x; }); };
  const { res } = await pack(f, { process: 'release', from: '2026-10-17', through: '2026-10-17', tz: 'UTC' }, { cap: 3 * 1048576 });
  assert.strictEqual(most, 1, 'one at a time');
  same(res.col.runs.map(r => r.key), ['release/run1']);
  assert.ok(res.col.retained.peak >= 2 * 1048576 && res.col.retained.peak <= 3 * 1048576, 'counted, within the cap: ' + res.col.retained.peak);
});

rule('2.0: the version a run ran goes in the pack by its payload: its files and the screenshots it lists; anything else in its folder is labeled as not part of it', async () => {
  await folder();
  const files = Object.assign({}, fixture.files), base = 'publications/release/' + fixture.v1 + '/', info = JSON.parse(files[base + 'publication.json'].toString());
  same(P.payloadFiles(info), ['map.md', 'types.json', 'publication.json'].concat(Object.keys(info.images || {}).sort()));
  same(P.payloadFiles({ format: 'preflight-publication/2', payload: { images: { 'images/x/b.png': 'a'.repeat(64), 'images/x/a.png': 'b'.repeat(64) } } }), ['map.md', 'types.json', 'publication.json', 'images/x/a.png', 'images/x/b.png']);
  files[base + 'images/release/stray.png'] = require('./evidence-fixture').PNG;
  files[base + 'notes.txt'] = Buffer.from('hand-added');
  const col = await repo.collectEvidence(new BytesFS(files), { run: 'release/run1' }, { plan: true });
  const byPath = p => col.files.filter(x => x.path === base + p)[0];
  assert.strictEqual(byPath('map.md').label, 'The version the run ran');
  assert.ok(byPath('images/release/stray.png') && /isn't part of the version/.test(byPath('images/release/stray.png').label), JSON.stringify(byPath('images/release/stray.png')));
  assert.ok(!byPath('notes.txt'), 'other files in a version folder stay out, as before');
});

rule('2.0: Evidence checks every screenshot in the version\'s payload: a corrupted one fails the version check, as the app refuses the version', async () => {
  const P2 = load(), m = new P2.fs.MemoryFS('ev-shots', null), people = JSON.parse(require('./harness').example('people.json'));
  m.reset({ 'people.json': JSON.stringify(people) });
  const png = require('./evidence-fixture').PNG;
  await m.write('images/x/scratch.png', new Blob([png], { type: 'image/png' }));
  const md = '---\nprocess: x\ntitle: X\n---\n## P {#p}\n  > Use the scratch server.\n  ![The scratch server](images/x/scratch.png)\n- [ ] {confirm} Look {#a}\n';
  const res = await P2.repo.publish(m, md, { people, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.0.0' });
  assert.ok(!res.blockers, String(res.blockers));
  const pub = (await P2.repo.loadAll(m)).processes[0].index.latest;
  assert.strictEqual(pub.info.format, 'preflight-publication/2', 'set-up');
  const r = P2.run.create(pub, { by: 'person-avery', session: 'w-ev', now: NOW, id: 'run1' });
  await P2.repo.saveRun(m, r, 'w-ev');
  const files = require('./evidence-fixture').bytesOf(m), shot = 'publications/x/' + pub.info.folder + '/images/x/scratch.png';
  const good = (await pack(new BytesFS(files), { run: 'x/run1' })).res.col;
  const check = col => col.runs[0].checks.find(c => c.id === 'publication');
  assert.strictEqual(check(good).ok, true, check(good).detail);
  files[shot] = Buffer.concat([files[shot], Buffer.from([0])]);
  const bad = (await pack(new BytesFS(files), { run: 'x/run1' })).res.col;
  assert.strictEqual(check(bad).ok, false, 'a corrupted screenshot fails the check: ' + check(bad).detail);
  assert.ok(/scratch\.png/.test(check(bad).detail), check(bad).detail);
  files[shot] = files[shot].subarray(0, files[shot].length - 1);
  const map = 'publications/x/' + pub.info.folder + '/map.md';
  files[map] = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), files[map]]);
  const bom = (await pack(new BytesFS(files), { run: 'x/run1' })).res.col;
  assert.strictEqual(check(bom).ok, false, 'a byte-order mark in map.md fails it too (the payload is over exact bytes): ' + check(bom).detail);
});

run();
