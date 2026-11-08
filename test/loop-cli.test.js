// flightdeck loop (3.0, docs/apps.md): read a loop, and ask for scope changes by writing one file in proposals/ once.
// Previews write nothing; a retry writes nothing; a key with other content is refused; runs are never started.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { load, rule, run } = require('./harness');
const PF = load(), R = PF.run;
const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js');
const cli = (...a) => { try { return { out: execFileSync(process.execPath, [BIN, ...a], { encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (e) { return { out: String(e.stdout) + String(e.stderr), code: e.status }; } };
const json = (...a) => { const r = cli(...a); return Object.assign(JSON.parse(r.out), { code: r.code }); };
const AT = '2026-11-07T09:00:00.000Z';
class DiskFS {
  constructor(root) { this.root = root; this.kind = 'folder'; this.name = path.basename(root); }
  p(rel) { return path.join(this.root, ...rel.split('/')); }
  list(rel) { const d = rel ? this.p(rel) : this.root; return Promise.resolve(fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).map(e => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' })) : []); }
  read(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) ? { text: fs.readFileSync(f, 'utf8'), mtime: fs.statSync(f).mtimeMs } : null); }
  stat(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) ? { size: fs.statSync(f).size, mtime: fs.statSync(f).mtimeMs } : null); }
  blob(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) ? new Blob([fs.readFileSync(f)]) : null); }
  write(rel, data) { const f = this.p(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return Promise.resolve(); }
  append(rel, text) { const f = this.p(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, text); return Promise.resolve(); }
  remove(rel) { fs.unlinkSync(this.p(rel)); return Promise.resolve(); }
}
const CHILD = ['---', 'process: validate-story', 'title: Validate a story', 'context: issue, fix_version, disposition:choice(cleared|needs-work|deferred|unknown)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {confirm} Read the story {#read}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work, deferred, unknown', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'context: fix_version', '---', '', '## Stories · DO-CONFIRM {#stories}',
  '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key, fix_version=^fix_version', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
const people = [{ id: 'person-morgan', name: 'Morgan' }, { id: 'person-avery', name: 'Avery' }];
const obs = (ns, o) => Object.assign({ source: { system: 'jira' }, generation: 'g1', query: 'fixVersion = 4.1', observedAt: '2026-11-07T09:42:00Z',
  items: ns.map(n => ({ id: String(10000 + n), key: 'ABC-' + n, title: 'Story ' + n })), reported: ns.length, fetched: ns.length, complete: true, errors: [] }, o || {});
async function folder(md) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-loop-')), d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  await PF.repo.publish(d, CHILD, { people, by: 'person-morgan', changes: 'First', existing: [], now: AT, app: '3.0.0' });
  let all = await PF.repo.loadAll(d, {});
  const pr = await PF.repo.publish(d, md || PARENT, { people, by: 'person-morgan', changes: 'First', existing: [], now: AT, app: '3.0.0', processes: all.processes }); if (pr.blockers) throw new Error(JSON.stringify(pr.blockers));
  all = await PF.repo.loadAll(d, {});
  const procOf = (id) => { const x = all.processes.filter(p => p.process === id)[0]; return x ? { latest: x.index.latest, all: x.index.all, clashes: x.index.clashes, broken: [] } : null; }, pp = procOf('release-readiness').latest;
  const r = R.create(pp, { id: 'r-41', by: 'person-morgan', session: 'w', now: AT, app: '3.0.0', details: { fix_version: '4.1' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
  await d.write('runs/release-readiness/r-41/run.json', JSON.stringify(r, null, 2));
  const kid = async (n, decision) => {
    const c = R.create(procOf('validate-story').latest, { id: 'k' + n, by: 'person-avery', session: 'w2', now: AT, app: '3.0.0', details: { issue: 'ABC-' + n, fix_version: '4.1' }, parent: { process: 'release-readiness', id: 'r-41', step: 'each', item: { uid: 'jira:' + (10000 + n), key: 'ABC-' + n, attempt: 1 } } });
    const m = R.mapOf(c); R.done(c, m, 'read', 'person-avery', AT);
    if (decision) { R.done(c, m, 'verdict', 'person-avery', AT, { decision }); R.pass(c, m, 0, 'person-avery', AT); R.end(c, m, 'Completed', 'person-avery', 'Avery', AT); }
    await d.write('runs/validate-story/k' + n + '/run.json', JSON.stringify(c, null, 2));
  };
  return { root, d, kid };
}
const ls = (root) => fs.existsSync(path.join(root, 'proposals')) ? fs.readdirSync(path.join(root, 'proposals')).sort() : [];

rule('sync --dry-run previews in plain words and JSON and writes nothing; sync writes one request once; a retry writes nothing', async () => {
  const { root } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs.json');
  fs.writeFileSync(f, JSON.stringify(obs([101, 102, 103])));
  const T = ['--tool', 'release-helper@1.0', '--key', 'import-1'];
  const text = cli('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--dry-run', ...T);
  assert.strictEqual(text.code, 0, text.out);
  assert.ok(/^Release 4\.1 — preview only; no files written\.\n\nWould add 3 stories\.\n3 new assessments are ready to start\.\nNo runs would start\./.test(text.out), text.out);
  assert.deepStrictEqual(ls(root), []);
  const pre = json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--dry-run', '--json', ...T);
  assert.deepStrictEqual([pre.code, pre.data.status, pre.data.added.length, pre.data.runsStarted, pre.data.children[0].inputs], [0, 'would-request', 3, 0, { fix_version: '4.1', issue: 'ABC-101' }]);
  const w = json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', ...T);
  assert.deepStrictEqual([w.code, w.data.status, w.data.membershipVisible], [0, 'requested', false]);
  assert.deepStrictEqual(ls(root), [w.data.request.id + '.json']);
  const again = json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', ...T);
  assert.deepStrictEqual([again.data.status, ls(root).length], ['already', 1]);
  assert.ok(/^Already requested\. Nothing written\./.test(again.data.preview));
  fs.writeFileSync(f, JSON.stringify(obs([101, 102])));
  const taken = json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', ...T);
  assert.deepStrictEqual([taken.code, taken.error.kind], [1, 'key-taken']);
  assert.ok(/Changed fields: observation\. Read that request \(flightdeck loop read\) before choosing a new key\. Nothing was written\./.test(taken.error.why), taken.error.why);
});
rule('read shows the items, exact counts and blockers; review records a person\'s decision on proposed removals', async () => {
  const { root, kid } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs.json');
  await kid(101, 'cleared'); await kid(102, 'needs-work'); await kid(103);
  fs.writeFileSync(f, JSON.stringify(obs([101, 102, 103])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'a');
  const r1 = json('loop', 'read', root, 'release-readiness/r-41', 'each', '--json');
  assert.deepStrictEqual([r1.code, r1.data.summary, r1.data.ok], [0, '3 in scope · 1 cleared by validation · 1 needs work · 1 in progress', false]);
  assert.deepStrictEqual(r1.data.blockers.map(b => b.text), ['ABC-102 needs work · Avery', 'ABC-103 is in progress · Avery']);
  fs.writeFileSync(f, JSON.stringify(obs([101, 102])));
  const s2 = json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'b');
  assert.deepStrictEqual(s2.data.proposed.map(p => [p.key, p.open, p.recorder.name]), [['ABC-103', true, 'Avery']]);
  assert.ok(/One proposed removal has an assessment in progress\./.test(s2.data.preview), s2.data.preview);
  const no = json('loop', 'review', root, 'release-readiness/r-41', 'each', '--accept', 'ABC-101', '--as', 'person-morgan', '--tool', 'release-helper@1.0', '--key', 'c', '--json');
  assert.deepStrictEqual([no.code, no.error.kind], [1, 'invalid']);
  const rv = json('loop', 'review', root, 'release-readiness/r-41', 'each', '--accept', 'ABC-103', '--as', 'person-morgan', '--tool', 'release-helper@1.0', '--key', 'c', '--json');
  assert.deepStrictEqual([rv.code, rv.data.status], [0, 'requested'], JSON.stringify(rv));
  const again = json('loop', 'review', root, 'release-readiness/r-41', 'each', '--accept', 'ABC-103', '--as', 'person-morgan', '--tool', 'release-helper@1.0', '--key', 'c', '--json');
  assert.deepStrictEqual([again.code, again.data && again.data.status], [0, 'already'], 'an identical retry writes nothing: ' + JSON.stringify(again.error || ''));
  const other = json('loop', 'review', root, 'release-readiness/r-41', 'each', '--keep', 'ABC-103', '--as', 'person-morgan', '--tool', 'release-helper@1.0', '--key', 'c', '--json');
  assert.deepStrictEqual([other.code, other.error && other.error.kind], [1, 'key-taken'], 'the same key for another decision is refused');
  const r2 = json('loop', 'read', root, 'release-readiness/r-41', 'each', '--json');
  assert.deepStrictEqual([r2.data.summary, r2.data.items.filter(i => i.key === 'ABC-103')[0].state], ['2 in scope · 1 cleared by validation · 1 needs work', 'removed']);
  const ex = json('loop', 'exception', root, 'release-readiness/r-41', 'each', '--item', 'ABC-102', '--reason', 'Docs only', '--approver', 'person-morgan', '--as', 'person-morgan', '--tool', 'release-helper@1.0', '--key', 'd', '--json');
  assert.strictEqual(ex.data.status, 'requested', JSON.stringify(ex));
  const r3 = json('loop', 'read', root, 'release-readiness/r-41', 'each', '--json');
  assert.deepStrictEqual([r3.data.summary, r3.data.ok], ['2 in scope · 1 cleared by validation · 1 approved without a run', true]);
});
rule('A missing run, a step that isn\'t a loop, a missing tool or key: each named, nothing written', async () => {
  const { root } = await folder();
  assert.strictEqual(json('loop', 'read', root, 'release-readiness/nope', 'each', '--json').code, 5);
  assert.ok(/isn't a loop/.test(json('loop', 'read', root, 'release-readiness/r-41', 'ship1', '--json').error.why));
  assert.ok(/--tool/.test(json('loop', 'add', root, 'release-readiness/r-41', 'each', '--keys', 'ABC-1', '--key', 'k', '--json').error.why));
  const add = json('loop', 'add', root, 'release-readiness/r-41', 'each', '--keys', 'ABC-201, https://jira.example.com/browse/ABC-202', '--key', 'k', '--tool', 'release-helper@1.0', '--json');
  assert.deepStrictEqual(add.data.added.map(x => x.key), ['ABC-201', 'ABC-202']);
});

rule('Round 2: flightdeck run holds a loop\'s approved gate once the folder no longer matches the approval, writing nothing', async () => {
  const { root, d, kid } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs2.json');
  await kid(101, 'cleared');
  fs.writeFileSync(f, JSON.stringify(obs([101])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'g1');
  const all = await PF.repo.loadAll(d, {}), r = all.runs.find(x => x.id === 'r-41'), map = R.mapOf(r);
  const V = PF.loop.view(r, 'each', { records: all.scopes, runs: all.runs });
  assert.strictEqual(V.rollup.ok, true, V.rollup.summary);
  R.done(r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: PF.loop.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  R.pass(r, map, 0, 'person-morgan', AT);
  const clean = JSON.parse(JSON.stringify(r, (k, v) => (k[0] === '_' ? undefined : v)));
  fs.writeFileSync(path.join(root, 'runs/release-readiness/r-41/run.json'), JSON.stringify(clean, null, 2));
  const gate = () => json('run', root, 'release-readiness/r-41', '--contract', '2', '--json').data.run.gates[0].status;
  assert.strictEqual(gate(), 'passed');
  await kid(101, 'needs-work');
  const before = fs.readFileSync(path.join(root, 'runs/release-readiness/r-41/run.json'), 'utf8');
  assert.strictEqual(gate(), 'review', 'the CLI agrees with every window before any save');
  assert.strictEqual(fs.readFileSync(path.join(root, 'runs/release-readiness/r-41/run.json'), 'utf8'), before, 'nothing written');
});

rule('Round 2: the CLI asks, the recorder applies: start, start-all, approve and send-back are requests, previewed and shown by read', async () => {
  const { root, kid } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs3.json');
  await kid(101, 'cleared');
  fs.writeFileSync(f, JSON.stringify(obs([101, 102, 103])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 's1');
  const T = ['--tool', 'release-helper@1.0', '--as', 'person-morgan'];
  const pre = json('loop', 'start-all', root, 'release-readiness/r-41', 'each', '--dry-run', '--key', 's2', '--json', ...T);
  assert.deepStrictEqual([pre.code, pre.data.status, pre.data.start.map(k => k.key), pre.data.skip.map(k => k.key + ':' + k.why)], [0, 'would-request', ['ABC-102', 'ABC-103'], ['ABC-101:already started']]);
  assert.ok(/Would ask the recorder to start 2 runs: ABC-102, ABC-103\.\nSkipped: ABC-101 \(already started\)\./.test(pre.data.preview), pre.data.preview);
  assert.strictEqual(ls(root).length, 1, 'a preview writes nothing');
  const go = json('loop', 'start-all', root, 'release-readiness/r-41', 'each', '--key', 's2', '--json', ...T);
  assert.strictEqual(go.data.status, 'requested');
  const again = json('loop', 'start-all', root, 'release-readiness/r-41', 'each', '--key', 's2', '--json', ...T);
  assert.strictEqual(again.data.status, 'already', 'a retry writes nothing');
  const no = json('loop', 'approve', root, 'release-readiness/r-41', 'each', '--key', 's3', '--json', ...T);
  assert.deepStrictEqual([no.code, no.error.kind], [1, 'invalid']);
  const back = json('loop', 'send-back', root, 'release-readiness/r-41', 'each', '--key', 's4', '--json', ...T);
  assert.deepStrictEqual([back.code, back.error.kind], [1, 'invalid']);
  const rd = json('loop', 'read', root, 'release-readiness/r-41', 'each', '--json');
  assert.deepStrictEqual(rd.data.requests.map(q => [q.ops.join(','), q.items.join(','), q.status, q.as]), [['start,start', 'ABC-102,ABC-103', 'pending', 'person-morgan']]);
  assert.strictEqual(fs.readdirSync(path.join(root, 'runs', 'validate-story')).length, 1, 'no run started by the command');
});

rule('Review round 2 (4): a retry compares the whole original request first: an identical retry after it was carried out says already; another actor or reason under the key is refused', async () => {
  const { root, kid } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs4.json');
  fs.writeFileSync(f, JSON.stringify(obs([101, 102, 103])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'a');
  const T = ['--tool', 'release-helper@1.0', '--as', 'person-morgan'];
  assert.strictEqual(json('loop', 'start-all', root, 'release-readiness/r-41', 'each', '--key', 'go', '--json', ...T).data.status, 'requested');
  await kid(101); await kid(102); await kid(103);
  const again = json('loop', 'start-all', root, 'release-readiness/r-41', 'each', '--key', 'go', '--json', ...T);
  assert.deepStrictEqual([again.code, again.data && again.data.status], [0, 'already'], JSON.stringify(again.error || {}));
  const other = json('loop', 'start', root, 'release-readiness/r-41', 'each', '--item', 'ABC-101', '--key', 'go', '--json', ...T);
  assert.deepStrictEqual([other.code, other.error && other.error.kind], [1, 'key-taken']);
  fs.writeFileSync(f, JSON.stringify(obs([101, 102])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'b');
  const R0 = ['loop', 'review', root, 'release-readiness/r-41', 'each', '--accept', 'ABC-103', '--tool', 'release-helper@1.0', '--key', 'c', '--json'];
  assert.strictEqual(json(...R0, '--as', 'person-morgan').data.status, 'requested');
  assert.strictEqual(json(...R0, '--as', 'person-morgan').data.status, 'already');
  const who = json(...R0, '--as', 'person-avery');
  assert.deepStrictEqual([who.code, who.error && who.error.kind], [1, 'key-taken']);
  assert.ok(/as/.test(who.error.why), who.error.why);
  const why = json(...R0, '--as', 'person-morgan', '--reason', 'Moved to 4.2');
  assert.deepStrictEqual([why.code, why.error && why.error.kind], [1, 'key-taken']);
});

rule('Review round 3 (3): a key already used for another loop\'s request is refused, never already', async () => {
  const { root } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs5.json');
  fs.writeFileSync(f, JSON.stringify(obs([101, 102])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'a');
  const T = ['--tool', 'release-helper@1.0', '--as', 'person-morgan'];
  const go = json('loop', 'start-all', root, 'release-readiness/r-41', 'each', '--key', 'k', '--json', ...T);
  const file = path.join(root, go.data.request.file), q = JSON.parse(fs.readFileSync(file, 'utf8'));
  q.loop.run = 'r-99'; fs.writeFileSync(file, JSON.stringify(q, null, 2) + '\n');
  const again = json('loop', 'start-all', root, 'release-readiness/r-41', 'each', '--key', 'k', '--json', ...T);
  assert.deepStrictEqual([again.code, again.error && again.error.kind], [1, 'key-taken'], JSON.stringify(again.data || again.error));
  assert.ok(/loop/.test(again.error.why), again.error.why);
});

rule('Review round 3 (5): loop start asks for a new attempt of a story whose run returned needs-work; start-all leaves it out, saying why', async () => {
  const { root, kid } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs6.json');
  await kid(101, 'needs-work');
  fs.writeFileSync(f, JSON.stringify(obs([101])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'a');
  const T = ['--tool', 'release-helper@1.0', '--as', 'person-morgan'];
  const one = json('loop', 'start', root, 'release-readiness/r-41', 'each', '--item', 'ABC-101', '--dry-run', '--key', 'n1', '--json', ...T);
  assert.deepStrictEqual([one.code, one.data && one.data.start.map(k => k.key + ':' + k.attempt)], [0, ['ABC-101:2']], JSON.stringify(one.error || {}));
  const all = json('loop', 'start-all', root, 'release-readiness/r-41', 'each', '--dry-run', '--key', 'n2', '--json', ...T);
  assert.ok(all.error && /new attempt/.test(all.error.why), JSON.stringify(all.error || all.data));
});

rule('Review round 4 (1): run and next check a loop child against its pinned version as the screen does: with that version gone, the gate is held', async () => {
  const { root, d, kid } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs7.json');
  await kid(101, 'cleared');
  fs.writeFileSync(f, JSON.stringify(obs([101])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'p1');
  const all = await PF.repo.loadAll(d, {}), r = all.runs.find(x => x.id === 'r-41'), map = R.mapOf(r);
  const V = PF.loop.view(r, 'each', { records: all.scopes, runs: all.runs });
  R.done(r, map, 'each', 'person-morgan', AT, { _loop: { ok: true, snapshot: PF.loop.approval(V.ledger, V.rollup, { by: 'person-morgan', at: AT }) } });
  R.pass(r, map, 0, 'person-morgan', AT);
  fs.writeFileSync(path.join(root, 'runs/release-readiness/r-41/run.json'), JSON.stringify(JSON.parse(JSON.stringify(r, (k, v) => (k[0] === '_' ? undefined : v))), null, 2));
  const gate = () => json('run', root, 'release-readiness/r-41', '--contract', '2', '--json').data.run.gates[0].status;
  assert.strictEqual(gate(), 'passed', 'set-up');
  fs.rmSync(path.join(root, 'publications', 'validate-story'), { recursive: true, force: true });
  assert.strictEqual(gate(), 'review', 'held once the pinned version is gone');
});

rule('Review round 4 (4): loop choose names the run that counts for a story with competing runs; any other run is refused', async () => {
  const { root, kid } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs8.json');
  const a = await kid(101, 'cleared');
  const src = path.join(root, 'runs', 'validate-story'), first = fs.readdirSync(src)[0], twin = JSON.parse(fs.readFileSync(path.join(src, first, 'run.json'), 'utf8'));
  twin.id = 'twin0002'; fs.mkdirSync(path.join(src, 'twin0002')); fs.writeFileSync(path.join(src, 'twin0002', 'run.json'), JSON.stringify(twin));
  fs.writeFileSync(f, JSON.stringify(obs([101])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'a');
  const T = ['--tool', 'release-helper@1.0'];
  assert.strictEqual(json('loop', 'read', root, 'release-readiness/r-41', 'each', '--json').data.items[0].status, 'competing');
  const bad = json('loop', 'choose', root, 'release-readiness/r-41', 'each', '--item', 'ABC-101', '--run', 'nope0000', '--key', 'c0', '--json', ...T);
  assert.deepStrictEqual([bad.code, bad.error && bad.error.kind], [1, 'invalid']);
  const ok = json('loop', 'choose', root, 'release-readiness/r-41', 'each', '--item', 'ABC-101', '--run', 'twin0002', '--key', 'c1', '--json', ...T);
  assert.deepStrictEqual([ok.code, ok.data && ok.data.status], [0, 'requested'], JSON.stringify(ok.error || {}));
  const rd = json('loop', 'read', root, 'release-readiness/r-41', 'each', '--json').data.items[0];
  assert.deepStrictEqual([rd.status, rd.run], ['cleared', 'twin0002']);
  assert.ok(a === undefined || a);
});

rule('Review round 6 (5): loop start naming a story twice is refused before anything is filed, the first time and on a retry', async () => {
  const { root } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs6.json');
  fs.writeFileSync(f, JSON.stringify(obs([101, 102])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'a');
  const T = ['--tool', 'release-helper@1.0', '--as', 'person-morgan'];
  const before = fs.readdirSync(path.join(root, 'proposals')).length;
  for (let n = 0; n < 2; n++) {
    const dup = json('loop', 'start', root, 'release-readiness/r-41', 'each', '--item', 'ABC-101,ABC-101', '--key', 'dup', '--json', ...T);
    assert.deepStrictEqual([dup.code, dup.error && dup.error.kind], [1, 'usage'], JSON.stringify(dup.error || dup.data));
    assert.ok(/ABC-101/.test(dup.error.why) && /twice|more than once/.test(dup.error.why), dup.error.why);
  }
  assert.strictEqual(fs.readdirSync(path.join(root, 'proposals')).length, before, 'nothing filed');
});

const LP7 = PF.loop, LOOP7 = { process: 'release-readiness', run: 'r-41', step: 'each' };
const rec7 = (key, changes, seen, children) => { const c = LP7.cleanIntent({ loop: LOOP7, changes }, key, { name: 'release-helper', version: '1.0' }); assert.strictEqual(c.errors.length, 0, c.errors.join(' ')); return LP7.buildRequest(c.intent, { seen: seen || [], children: children || [], now: AT, app: '3.0.0' }); };
rule('Review round 7 (4): loop read shows two plans in conflict, and loop plan keeps one of them', async () => {
  const { root } = await folder();
  const ch = (v) => [{ item: { id: '', key: 'ABC-101' }, attempt: 1, inputs: { issue: 'ABC-101', fix_version: v }, owner: '' }];
  const a = rec7('pa', [{ op: 'add', item: { key: 'ABC-101' } }], [], ch('4.1')), b = rec7('pb', [{ op: 'add', item: { key: 'ABC-101' } }], [], ch('4.2'));
  fs.mkdirSync(path.join(root, 'proposals'), { recursive: true });
  [a, b].forEach(f => fs.writeFileSync(path.join(root, 'proposals', f.id + '.json'), LP7.text(f)));
  const rd = json('loop', 'read', root, 'release-readiness/r-41', 'each', '--json').data.items[0];
  assert.deepStrictEqual(rd.planConflict && rd.planConflict.options.map(o => o.record).sort(), [a.id, b.id].sort());
  const T = ['--tool', 'release-helper@1.0'];
  const bad = json('loop', 'plan', root, 'release-readiness/r-41', 'each', '--item', 'ABC-101', '--record', 'req-nope-0123456789abcdef01234567', '--key', 'k0', '--json', ...T);
  assert.deepStrictEqual([bad.code, bad.error && bad.error.kind], [1, 'invalid']);
  const ok = json('loop', 'plan', root, 'release-readiness/r-41', 'each', '--item', 'ABC-101', '--record', b.id, '--key', 'k1', '--json', ...T);
  assert.deepStrictEqual([ok.code, ok.data && ok.data.status], [0, 'requested'], JSON.stringify(ok.error || {}));
  const after = json('loop', 'read', root, 'release-readiness/r-41', 'each', '--json').data.items[0];
  assert.deepStrictEqual([after.planConflict, after.planned && after.planned.inputs.fix_version], [null, '4.2']);
});
rule('Review round 7 (5): loop resolve files a request to record an outcome recorded both ways; only such a request can be resolved', async () => {
  const { root } = await folder(), f = path.join(root, '..', path.basename(root) + '-obs7.json');
  fs.writeFileSync(f, JSON.stringify(obs([101])));
  json('loop', 'sync', root, 'release-readiness/r-41', 'each', '--from', f, '--json', '--tool', 'release-helper@1.0', '--key', 'a');
  const T = ['--tool', 'release-helper@1.0', '--as', 'person-morgan'];
  const st = json('loop', 'start', root, 'release-readiness/r-41', 'each', '--item', 'ABC-101', '--key', 's', '--json', ...T), id = st.data.request.id;
  const R7 = ['loop', 'resolve', root, 'release-readiness/r-41', 'each', '--record', id, '--outcome', 'refused', '--json', ...T];
  const early = json(...R7, '--key', 'r0');
  assert.deepStrictEqual([early.code, early.error && early.error.kind], [1, 'invalid'], 'a pending request isn\'t resolved');
  for (const [op, w] of [['applied', 'wa'], ['refused', 'wb']]) {
    const dd = LP7.buildDecision({ proposal: id, loop: LOOP7, op, items: [], seen: [id], reason: op, by: 'person-morgan', writer: w, rev: op === 'applied' ? '0000000a' : '0000000b', now: AT, app: '3.0.0' });
    fs.writeFileSync(path.join(root, 'proposals', dd.name), JSON.stringify(dd.file));
  }
  const rq = json('loop', 'read', root, 'release-readiness/r-41', 'each', '--json').data.requests.filter(q => q.id === id)[0];
  assert.strictEqual(rq.status, 'review');
  const bad = json('loop', 'resolve', root, 'release-readiness/r-41', 'each', '--record', id, '--outcome', 'maybe', '--key', 'r1', '--json', ...T);
  assert.deepStrictEqual([bad.code, bad.error && bad.error.kind], [1, 'usage']);
  const ok = json(...R7, '--key', 'r2');
  assert.deepStrictEqual([ok.code, ok.data && ok.data.status], [0, 'requested'], JSON.stringify(ok.error || {}));
  assert.strictEqual(json(...R7, '--key', 'r2').data.status, 'already');
  const other = json('loop', 'resolve', root, 'release-readiness/r-41', 'each', '--record', id, '--outcome', 'applied', '--key', 'r2', '--json', ...T);
  assert.deepStrictEqual([other.code, other.error && other.error.kind], [1, 'key-taken']);
});

/* Slice 3b: a loop over any list (items: item), kept by hand or fed by one declared tool. */
const GPARENT = PARENT.replace('title: Release 4.1', 'title: Deploy everywhere').replace('Validate every release story', 'Deploy to every environment')
  .replace('  items: jira.issue', '  items: item\n  source: deploy-targets\n  noun: environment / environments').replace('issue=item:key, fix_version=^fix_version', 'issue=item:key');
const gobs = (keys, o) => Object.assign({ source: { feed: 'deploy-targets', account: 'team-a' }, generation: 'g1', query: '', observedAt: '2026-11-08T09:42:00Z',
  items: keys.map(k => ({ key: k })), reported: keys.length, fetched: keys.length, complete: true, errors: [] }, o || {});
rule('3b: a generic loop: keys exactly as typed, a title and a safe link for one, its noun in every message, and only its own feed syncs', async () => {
  const { root } = await folder(GPARENT), at = (...a) => ['loop', ...a.slice(0, 1), root, 'release-readiness/r-41', 'each', ...a.slice(1)], T = (k) => ['--tool', 'deploy-helper@1.0', '--key', k];
  const f = path.join(root, '..', path.basename(root) + '-g.json');
  const pre = cli(...at('add', '--keys', 'staging,Prod', '--dry-run', ...T('a1')));
  assert.ok(/Would add 2 environments\./.test(pre.out) && !/stor(y|ies)|Jira/.test(pre.out), pre.out);
  const bad = json(...at('add', '--keys', 'qa', '--title', 'QA', '--link', 'javascript:alert(1)', '--json', ...T('a2')));
  assert.ok(bad.code !== 0 && /"link" is an http or https address/.test(bad.error.why), JSON.stringify(bad.error));
  for (const [k, re] of [['__proto__', /"key" is 1 to 40/], ['constructor', /keeps for itself/], ['toString', /keeps for itself/], ['-lead', /"key" is 1 to 40/]]) { const rk = json(...at('add', '--keys', k, '--json', ...T('r' + k.replace(/[^a-z]/gi, '').toLowerCase()))); assert.ok(rk.code !== 0 && re.test(rk.error.why), k + ' ' + JSON.stringify(rk.error)); }
  const two = json(...at('add', '--keys', 'qa,dev', '--title', 'QA', '--json', ...T('a3')));
  assert.ok(two.code !== 0 && /one environment/.test(two.error.why), JSON.stringify(two.error));
  assert.deepStrictEqual(ls(root), [], 'nothing refused was written');
  const a4 = json(...at('add', '--keys', 'staging,Prod', '--json', ...T('a4'))); assert.strictEqual(a4.code, 0, JSON.stringify(a4.problems || a4.error));
  const a5 = json(...at('add', '--keys', 'qa', '--title', 'QA', '--link', 'https://qa.example.com/', '--json', ...T('a5'))); assert.strictEqual(a5.code, 0, JSON.stringify(a5.problems || a5.error));
  fs.writeFileSync(f, JSON.stringify(gobs(['qa', 'dev'], { source: { feed: 'other-feed' } })));
  const other = json(...at('sync', '--from', f, '--json', ...T('s0')));
  assert.ok(other.code !== 0 && /other-feed, but this loop is fed by deploy-targets/.test(other.error.why), JSON.stringify(other.error));
  fs.writeFileSync(f, JSON.stringify(Object.assign(obs([101]))));
  assert.ok(json(...at('sync', '--from', f, '--json', ...T('s1'))).code !== 0, 'a Jira observation is not this feed');
  const n0 = ls(root).length;
  fs.writeFileSync(f, JSON.stringify(gobs(['qa', 'dev'])));
  const s2 = json(...at('sync', '--from', f, '--json', ...T('s2'))); assert.strictEqual(s2.code, 0, JSON.stringify(s2.problems || s2.error));
  fs.writeFileSync(f, JSON.stringify(gobs(['qa'], { source: { feed: 'deploy-targets', account: 'team-b' } })));
  const scope = json(...at('sync', '--from', f, '--json', ...T('s3')));
  assert.ok(scope.code !== 0 && /another scope of the feed deploy-targets \(its account differ/.test(scope.error.why), JSON.stringify(scope.error));
  fs.writeFileSync(f, JSON.stringify(gobs(['qa'])));
  const sy = json(...at('sync', '--from', f, '--json', ...T('s4')));
  assert.ok(/request review of 1 removal/.test(sy.data.preview) && /Observation from deploy-targets/.test(sy.data.preview), sy.data.preview);
  assert.strictEqual(ls(root).length, n0 + 2, 'only the two good syncs were filed');
  const rd = json(...at('read', '--json'));
  assert.deepStrictEqual([rd.data.kind, rd.data.noun, rd.data.source], ['item', { one: 'environment', many: 'environments' }, 'deploy-targets']);
  assert.deepStrictEqual(rd.data.items.map(i => [i.key, i.state, i.link]), [['staging', 'in', null], ['Prod', 'in', null], ['qa', 'in', 'https://qa.example.com/'], ['dev', 'proposed', null]], 'case kept; only dev, which the feed enrolled, is proposed');
  assert.deepStrictEqual(rd.data.pending.map(p => p.key), ['dev']);
  assert.ok(/^Deploy everywhere · .*\n4 environments listed, fed by deploy-targets/.test(cli(...at('read')).out));
  const st = json(...at('start', '--item', 'staging,staging', '--as', 'person-morgan', '--json', ...T('t1')));
  assert.ok(/Name each environment once/.test(st.error.why), st.error.why);
});
rule('3b: --title and --link are for a list of items; a Jira loop refuses them and keeps its Jira wording', async () => {
  const { root } = await folder(), u = json('loop', 'add', root, 'release-readiness/r-41', 'each', '--keys', 'ABC-101', '--title', 'x', '--json', '--tool', 'h@1.0', '--key', 'j1');
  assert.ok(u.code !== 0 && /--title and --link go with adding one item of a list/.test(u.error.why), JSON.stringify(u.error));
  const e = json('loop', 'add', root, 'release-readiness/r-41', 'each', '--json', '--tool', 'h@1.0', '--key', 'j2');
  assert.ok(/say which stories with --keys ABC-101,ABC-102 \(keys or links\)\./.test(e.error.why), e.error.why);
  assert.deepStrictEqual(ls(root), []);
});
rule('3b: a run whose loop takes a kind this copy doesn\'t know is read-only, naming the kind, and nothing is written', async () => {
  const { root } = await folder(GPARENT), rf = path.join(root, 'runs/release-readiness/r-41/run.json');
  fs.writeFileSync(rf, fs.readFileSync(rf, 'utf8').split('items: item').join('items: widget'));
  const before = fs.readFileSync(rf, 'utf8');
  const a = json('loop', 'add', root, 'release-readiness/r-41', 'each', '--keys', 'qa', '--json', '--tool', 'h@1.0', '--key', 'w1');
  assert.ok(a.code !== 0 && /widget/.test(a.error.why) && /doesn't know/.test(a.error.why) && /Nothing was written/.test(a.error.why), JSON.stringify(a.error));
  assert.deepStrictEqual([ls(root), fs.readFileSync(rf, 'utf8') === before], [[], true]);
});

run();
