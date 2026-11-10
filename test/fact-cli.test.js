// flightdeck fact (4.0, docs/apps.md, docs/design.md 45.2): what a tool observed about a loop's items, filed as fact records,
// one per observation. sync checks the whole batch first and files nothing when any of it is refused; each record is written
// once, so an interruption leaves the rest standing and a retry files only what is missing. list says each item's facts with
// their source, completeness and freshness. todo suggest-done asks for one done on a fact's evidence, named by that evidence.
// Facts never write run.json and never change a run's work; importing them alone changes no run bytes.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { load, rule, run } = require('./harness');
const PF = load(), R = PF.run, T = PF.todos, F = PF.facts, LP = PF.loop;
const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js');
const cli = (...a) => { try { return { out: execFileSync(process.execPath, [BIN, ...a], { encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (e) { return { out: String(e.stdout) + String(e.stderr), code: e.status }; } };
const json = (...a) => { const r = cli(...a); try { return Object.assign(JSON.parse(r.out), { code: r.code }); } catch (e) { throw new Error('not JSON (' + r.code + '): ' + r.out); } };
const AT = '2026-11-09T09:00:00.000Z', HOUR = 3600000;
const ago = (ms) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
class DiskFS {
  constructor(root) { this.root = root; this.kind = 'folder'; this.name = path.basename(root); }
  p(rel) { return path.join(this.root, ...rel.split('/')); }
  list(rel) { const d = rel ? this.p(rel) : this.root; return Promise.resolve(fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).map(e => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' })) : []); }
  read(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) && fs.statSync(f).isFile() ? { text: fs.readFileSync(f, 'utf8'), mtime: fs.statSync(f).mtimeMs } : null); }
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
const PEOPLE = { people };
const obs = (ns) => ({ source: { system: 'jira' }, generation: 'g1', query: 'fixVersion = 4.1', observedAt: '2026-11-07T09:42:00Z',
  items: ns.map(n => ({ id: String(10000 + n), key: 'ABC-' + n, title: 'Story ' + n })), reported: ns.length, fetched: ns.length, complete: false, errors: [] });
const PR = 'release-readiness/r-41';
const TOOL = ['--tool', 'git-bot@1.0.0'];
const BB = { feed: 'bitbucket', site: 'git.example.com' }, JIRA = { feed: 'jira' };
let seq = 0; const hex = () => (++seq).toString(16).padStart(8, '0');

async function folder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-fact-')), d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  await PF.repo.publish(d, CHILD, { people, by: 'person-morgan', changes: 'First', existing: [], now: AT, app: '4.0.0' });
  let all = await PF.repo.loadAll(d, {});
  const pr = await PF.repo.publish(d, PARENT, { people, by: 'person-morgan', changes: 'First', existing: [], now: AT, app: '4.0.0', processes: all.processes }); if (pr.blockers) throw new Error(JSON.stringify(pr.blockers));
  all = await PF.repo.loadAll(d, {});
  const procOf = (id) => { const x = all.processes.filter(p => p.process === id)[0]; return x ? { latest: x.index.latest, all: x.index.all, clashes: x.index.clashes, broken: [] } : null; }, pp = procOf('release-readiness').latest;
  const r = R.create(pp, { id: 'r-41', by: 'person-morgan', session: 'w', now: AT, app: '4.0.0', details: { fix_version: '4.1' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
  await d.write('runs/release-readiness/r-41/run.json', JSON.stringify(r, null, 2));
  for (const n of [101, 102, 103]) {
    const c = R.create(procOf('validate-story').latest, { id: 'k' + n, by: 'person-avery', session: 'w2', now: AT, app: '4.0.0', details: { issue: 'ABC-' + n, fix_version: '4.1' }, parent: { process: 'release-readiness', id: 'r-41', step: 'each', item: { uid: 'jira:' + (10000 + n), key: 'ABC-' + n, attempt: 1 } } });
    await d.write('runs/validate-story/k' + n + '/run.json', JSON.stringify(c, null, 2));
  }
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: 'r-41', step: 'each' }, observation: obs([101, 102, 103]), changes: [] }, 's1', { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: [], children: [], now: AT, app: '4.0.0' });
  await d.write('proposals/' + f.id + '.json', LP.text(f));
  /* Another release's run of the same checklist, with the same stories in its loop. */
  const other = async () => {
    const r2 = R.create(pp, { id: 'r-42', by: 'person-morgan', session: 'w', now: AT, app: '4.0.0', details: { fix_version: '4.2' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
    await d.write('runs/release-readiness/r-42/run.json', JSON.stringify(r2, null, 2));
    const c2 = LP.cleanIntent({ loop: { process: 'release-readiness', run: 'r-42', step: 'each' }, observation: obs([101, 102, 103]), changes: [] }, 's1-42', { name: 'release-helper', version: '1.0' });
    const f2 = LP.buildRequest(c2.intent, { seen: [], children: [], now: AT, app: '4.0.0' });
    await d.write('proposals/' + f2.id + '.json', LP.text(f2));
  };
  return { root, d, other };
}
const ls = (root) => fs.existsSync(path.join(root, 'proposals')) ? fs.readdirSync(path.join(root, 'proposals')).filter(n => n[0] !== '.').sort() : [];
const snap = (root) => { const out = {}; const walk = (x) => fs.readdirSync(x, { withFileTypes: true }).forEach(e => { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else out[path.relative(root, p)] = fs.readFileSync(p, 'utf8'); }); walk(root); return out; };
const runsOf = (root) => { const s = snap(root), o = {}; Object.keys(s).filter(k => /^runs\//.test(k)).forEach(k => { o[k] = s[k]; }); return o; };
const runFile = (root, key) => path.join(root, 'runs', key, 'run.json');
let inputs = 0;
const input = (o) => { const p = path.join(os.tmpdir(), 'flightdeck-fact-in-' + process.pid + '-' + (++inputs) + '.json'); fs.writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o)); return p; };
const prs = (o) => Object.assign({ key: 'prs-102-a', loopStep: 'each', item: 'ABC-102', source: BB, domain: 'prs', observedAt: ago(3 * HOUR), complete: true, reported: 1, entries: [{ id: '17', text: 'Fix the login', state: 'merged' }] }, o || {});
const blockers = (o) => Object.assign({ key: 'blk-102-a', loopStep: 'each', item: 'ABC-102', source: JIRA, domain: 'blockers', observedAt: ago(3 * HOUR), complete: false, reported: null, entries: [], errors: ['The links API answered 503.'] }, o || {});

async function read(d) { const all = await PF.repo.loadAll(d, {}); return { runs: all.runs, records: all.todos || [], unread: all.todosUnread || [] }; }
async function decideAll(d, key, by) {
  const W = await read(d), x = W.runs.find(y => y.process + '/' + y.id === key), its = T.inbox([x], { records: W.records, unread: W.unread, people: PEOPLE, me: by, now: Date.now() });
  for (const it of its) {
    const dd = T.decide(x, { request: it.id, op: 'accept', by, shown: it.consequence.fingerprint, records: W.records, unread: W.unread, people: PEOPLE, at: AT, writer: 'w' + hex(), rev: hex(), app: '4.0.0', now: Date.now() });
    assert.ok(!dd.why, dd.why);
    await d.write('proposals/' + dd.name, T.text(dd.file)); W.records.push(Object.assign(dd.record, { _file: dd.name }));
  }
  return its.length;
}
async function land(d, key) {
  const raw = JSON.parse(fs.readFileSync(runFile(d.root, key), 'utf8')), rec = raw.recorder && raw.recorder.person;
  for (let i = 0; i < 100; i++) {
    const W = await read(d), x = W.runs.find(y => y.process + '/' + y.id === key), V = T.view(x, { records: W.records, unread: W.unread, people: PEOPLE, now: Date.now() }), q = T.nextQueued(V);
    if (!q) break;
    const plan = T.applyPlan(x, V, q);
    if (plan.adopt) raw.living = { head: plan.adopt.id };
    else {
      assert.ok(plan.write, JSON.stringify(plan));
      const s = T.buildStatus(Object.assign({}, plan.write, { by: rec, at: AT, writer: 'rec', rev: hex(), app: '4.0.0' }));
      await d.write('proposals/' + s.name, T.text(s.file));
      raw.living = { head: s.file.id || T.filed(s.name, s.file).record.id };
    }
    if (raw.features.indexOf('living-runs') < 0) raw.features = PF.envelope.FROZEN.filter(f => raw.features.concat(['living-runs']).indexOf(f) >= 0);
    fs.writeFileSync(runFile(d.root, key), JSON.stringify(raw, null, 2));
  }
}
/* An open to-do on ABC-102 (asked by a tool, accepted by Morgan, landed), and its id. */
async function todo(F0) {
  const a = json('todo', 'add', F0.root, PR, '--item', 'each/jira:10102', '--text', 'Merge the fix', '--key', 'td-1', '--json', ...TOOL);
  assert.strictEqual(a.code, 0, JSON.stringify(a));
  assert.strictEqual(await decideAll(F0.d, PR, 'person-morgan'), 1);
  await land(F0.d, PR);
  const l = json('todo', 'list', F0.root, PR, '--json');
  assert.strictEqual(l.data.todos.length, 1, JSON.stringify(l));
  return l.data.todos[0].id;
}

rule('sync --dry-run and list write nothing; sync files one record per observation, once; a retry is already; a key reused for another observation refuses the whole batch', async () => {
  const { root } = await folder(), before = snap(root);
  const l0 = json('fact', 'list', root, PR, '--json');
  assert.deepStrictEqual([l0.code, l0.data.count, l0.data.items], [0, 0, []], JSON.stringify(l0));
  const file = input({ facts: [prs(), blockers()] });
  const p = json('fact', 'sync', root, PR, '--from', file, '--dry-run', '--json', ...TOOL);
  assert.strictEqual(p.code, 0, JSON.stringify(p));
  assert.deepStrictEqual([p.data.status, p.data.facts.map(f => [f.key, f.status, f.id])], ['would-sync', [['prs-102-a', 'would-file', F.idFor('git-bot', 'prs-102-a')], ['blk-102-a', 'would-file', F.idFor('git-bot', 'blk-102-a')]]]);
  assert.ok(/preview only; no files written/.test(p.data.preview), p.data.preview);
  assert.deepStrictEqual(snap(root), before, 'nothing written');
  const s = json('fact', 'sync', root, PR, '--from', file, '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data.status, s.data.facts.map(f => f.status)], [0, 'synced', ['filed', 'filed']], JSON.stringify(s));
  const rec = JSON.parse(fs.readFileSync(path.join(root, 'proposals', F.idFor('git-bot', 'prs-102-a') + '.json'), 'utf8'));
  assert.deepStrictEqual([rec.kind, rec.domain, rec.uid, rec.attempt, rec.producer.name, rec.maxAgeSeconds, rec.run], ['fact', 'prs', 'jira:10102', 1, 'git-bot', 86400, { process: 'release-readiness', id: 'r-41' }]);
  const n = ls(root).length;
  const again = json('fact', 'sync', root, PR, '--from', file, '--json', '--tool', 'git-bot@1.1.0');
  assert.deepStrictEqual([again.code, again.data.facts.map(f => f.status), ls(root).length], [0, ['already', 'already'], n]);
  const other = json('fact', 'sync', root, PR, '--from', input({ facts: [prs({ key: 'prs-103', item: 'ABC-103' }), prs({ entries: [{ id: '17', text: 'Fix the login', state: 'open' }] })] }), '--json', ...TOOL);
  assert.deepStrictEqual([other.code, other.error.kind, ls(root).length], [1, 'key-taken', n], JSON.stringify(other));
  assert.ok(/fact 2 \(prs-102-a\)/.test(other.error.why) && /Nothing was written/.test(other.error.why), other.error.why);
  assert.strictEqual(fs.readFileSync(runFile(root, PR), 'utf8'), before['runs/release-readiness/r-41/run.json'], 'the CLI never writes run.json');
});

rule('A key that names an observation on another run is taken there: the same observation on another run is refused, never already, and nothing is written', async () => {
  const { root, other } = await folder();
  await other();
  assert.strictEqual(json('fact', 'sync', root, PR, '--from', input({ facts: [prs()] }), '--json', ...TOOL).code, 0);
  const before = snap(root);
  const r = json('fact', 'sync', root, 'release-readiness/r-42', '--from', input({ facts: [prs()] }), '--json', ...TOOL);
  assert.deepStrictEqual([r.code, r.error && r.error.kind], [1, 'key-taken'], JSON.stringify(r));
  assert.ok(/another run \(release-readiness\/r-41, /.test(r.error.why), r.error.why);
  assert.deepStrictEqual(snap(root), before, 'nothing written');
  assert.deepStrictEqual(json('fact', 'list', root, 'release-readiness/r-42', '--json').data.items, [], 'r-42 has no fact');
  const n = json('fact', 'sync', root, 'release-readiness/r-42', '--from', input({ facts: [prs({ key: 'prs-102-r42' })] }), '--json', ...TOOL);
  assert.deepStrictEqual([n.code, n.data.facts.map(f => f.status)], [0, ['filed']], 'a key of its own files on r-42');
});

rule('list says each item\'s facts by source, with completeness and freshness; a domain not checked reads as not checked, never as none', async () => {
  const { root } = await folder();
  assert.strictEqual(json('fact', 'sync', root, PR, '--from', input({ facts: [prs(), blockers()] }), '--json', ...TOOL).code, 0);
  const l = json('fact', 'list', root, PR, '--json');
  assert.strictEqual(l.code, 0, JSON.stringify(l));
  assert.deepStrictEqual(l.data.items.map(i => [i.loop, i.key, i.uid, i.attempt]), [['each', 'ABC-102', 'jira:10102', 1]]);
  const w = l.data.items[0].facts.map(f => [f.domain, f.state, f.words]);
  assert.deepStrictEqual(w, [
    ['prs', 'complete', 'PRs (bitbucket · git.example.com): 1 of 1 merged · complete · checked 3 hours ago.'],
    ['blockers', 'failed', 'Blockers (jira): couldn\'t be read (The links API answered 503.) · checked 3 hours ago.'],
    ['commits', 'unknown', 'Commits: not checked.'],
    ['status', 'unknown', 'Status: not checked.']]);
  assert.ok(!w.some(x => /no blockers|none open/.test(x[2])), 'missing data never reads as no blockers');
  assert.strictEqual(l.data.items[0].facts[0].fact, F.idFor('git-bot', 'prs-102-a'));
  const text = cli('fact', 'list', root, PR);
  assert.strictEqual(text.code, 0, text.out);
  assert.ok(/ABC-102/.test(text.out) && /checked 3 hours ago/.test(text.out) && /Commits: not checked\./.test(text.out), text.out);
  assert.deepStrictEqual(json('fact', 'list', root, PR, '--item', 'ABC-101', '--json').data.items, []);
  assert.strictEqual(json('fact', 'list', root, PR, '--loop', 'each', '--item', 'ABC-102', '--json').data.items.length, 1);
});

rule('Refused whole, nothing written: an observation out of its format, an unknown item, a batch over the limit, an input that isn\'t JSON', async () => {
  const { root } = await folder(), before = snap(root);
  const bad = [
    [{ facts: [prs(), prs({ key: 'p2', complete: true, reported: 3 })] }, /fact 2 \(p2\): "complete" is true only when "reported" equals "fetched"/],
    [{ facts: [prs({ key: 'p3', item: 'ABC-999' })] }, /fact 1 \(p3\): ABC-999 isn't an item of loop each/],
    [{ facts: [prs({ key: 'p4', entries: Array.from({ length: 101 }, (_, i) => ({ id: String(i), text: 'x', state: 'open' })) })] }, /at most 100/],
    [{ facts: Array.from({ length: 501 }, (_, i) => prs({ key: 'k' + i })) }, /at most 500 facts/],
    [{ facts: [prs({ key: 'p5', note: 'x' })] }, /has no "note"/],
    ['{"facts": [', /isn't JSON/],
    [{ items: [] }, /"facts"/],
  ];
  bad.forEach(([o, re]) => { const r = json('fact', 'sync', root, PR, '--from', input(o), '--json', ...TOOL); assert.deepStrictEqual([r.code, r.error && r.error.kind], [1, 'invalid'], JSON.stringify(r)); assert.ok(re.test(r.error.why), r.error.why); });
  assert.deepStrictEqual(snap(root), before, 'nothing written');
});

rule('Usage: a missing tool or --from, an unknown flag, --dry-run on list, a missing run: each named, nothing written', async () => {
  const { root } = await folder(), before = snap(root), file = input({ facts: [prs()] });
  const bad = [
    ['fact', 'sync', root, PR, '--from', file, '--json'],
    ['fact', 'sync', root, PR, '--json', ...TOOL],
    ['fact', 'list', root, PR, '--dry-run', '--json'],
    ['fact', 'list', root, PR, '--wat', '--json'],
    ['fact', 'frob', root, PR, '--json'],
    ['fact', 'sync', root, PR, '--from', file, '--key', 'k', '--json', ...TOOL],
    ['todo', 'suggest-done', root, PR, '--todo', 'td-x', '--json', ...TOOL],
    ['todo', 'suggest-done', root, PR, '--fact', 'req-x', '--json', ...TOOL],
    ['todo', 'suggest-done', root, PR, '--todo', 'td-x', '--fact', 'req-x', '--json'],
  ];
  bad.forEach(a => { const r = json(...a); assert.deepStrictEqual([r.code, r.error.kind], [1, 'usage'], a.join(' ') + ': ' + JSON.stringify(r)); });
  assert.strictEqual(json('fact', 'list', root, 'release-readiness/nope', '--json').code, 5);
  assert.deepStrictEqual(snap(root), before, 'nothing written');
});

rule('A key twice in one sync is refused whole before anything is written, so no receipt ever says already for a record not filed', async () => {
  const { root } = await folder();
  const n = ls(root).length;
  for (const facts of [[prs(), prs()], [prs(), blockers(), prs({ entries: [{ id: '18', text: 'Other', state: 'open' }] })]]) {
    const s = json('fact', 'sync', root, PR, '--from', input({ facts }), '--json', ...TOOL);
    assert.deepStrictEqual([s.code, s.error && s.error.kind, ls(root).length], [1, 'invalid', n], JSON.stringify(s).slice(0, 600));
    assert.ok(/prs-102-a\): This key is in this sync twice/.test(s.error.why), s.error.why);
  }
  /* Its first write failing can't leave a false already behind it. */
  const block = path.join(root, 'proposals', F.idFor('git-bot', 'prs-102-a') + '.json');
  fs.mkdirSync(block, { recursive: true });
  const s = json('fact', 'sync', root, PR, '--from', input({ facts: [prs(), prs()] }), '--json', ...TOOL);
  assert.ok(!(s.data && s.data.facts && s.data.facts.some(f => f.status === 'already')), JSON.stringify(s).slice(0, 600));
  fs.rmdirSync(block);
});

rule('An interruption between two records leaves the first standing; the next sync files only what is missing, once', async () => {
  const { root } = await folder(), file = input({ facts: [prs(), blockers()] });
  const block = path.join(root, 'proposals', F.idFor('git-bot', 'blk-102-a') + '.json');
  fs.mkdirSync(block, { recursive: true });
  const s = json('fact', 'sync', root, PR, '--from', file, '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data.status, s.data.partial, s.data.facts.map(f => f.status)], [4, 'partial', true, ['filed', 'failed']], JSON.stringify(s));
  fs.rmdirSync(block);
  const n0 = ls(root).length;
  const s2 = json('fact', 'sync', root, PR, '--from', file, '--json', ...TOOL);
  assert.deepStrictEqual([s2.code, s2.data.facts.map(f => f.status), ls(root).length], [0, ['already', 'filed'], n0 + 1]);
});

rule('A record that can\'t be read holds sync and suggest-done (exit 4) and writes nothing', async () => {
  const F0 = await folder(), x = await todo(F0);
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs()] }), '--json', ...TOOL).code, 0);
  fs.writeFileSync(path.join(F0.root, 'proposals', 'req-zzzzzzzzzzzzzzzzzzzzzzzz.json'), '{"format":"flightdeck-plan/4",');
  const before = snap(F0.root);
  const s = json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs({ key: 'prs-102-b' })] }), '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data && s.data.status], [4, 'held'], JSON.stringify(s));
  const g = json('todo', 'suggest-done', F0.root, PR, '--todo', x, '--fact', F.idFor('git-bot', 'prs-102-a'), '--json', ...TOOL);
  assert.deepStrictEqual([g.code, g.data && g.data.status], [4, 'held'], JSON.stringify(g));
  assert.deepStrictEqual(snap(F0.root), before, 'nothing written');
});

rule('A story\'s suggestion resting on its parent\'s fact: that fact unreadable is every reader\'s problem, named, incomplete, exit 4', async () => {
  const F0 = await folder(), KID = 'validate-story/k102';
  const a = json('todo', 'add', F0.root, KID, '--phase', 'assess', '--text', 'Merge the fix', '--key', 'kid-td', '--json', ...TOOL);
  assert.strictEqual(a.code, 0, JSON.stringify(a));
  assert.strictEqual(await decideAll(F0.d, KID, 'person-avery'), 1);
  await land(F0.d, KID);
  const x = json('todo', 'list', F0.root, KID, '--json').data.todos[0].id;
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs()] }), '--json', ...TOOL).code, 0);
  const fid = F.idFor('git-bot', 'prs-102-a'), s = json('todo', 'suggest-done', F0.root, KID, '--todo', x, '--fact', fid, '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data.status], [0, 'requested'], JSON.stringify(s));
  const ok = json('todo', 'list', F0.root, KID, '--json');
  assert.deepStrictEqual([ok.code, ok.complete], [0, true], 'set-up: readable');
  /* The parent's fact is damaged. */
  const file = path.join(F0.root, 'proposals', fid + '.json'), o = JSON.parse(fs.readFileSync(file, 'utf8'));
  o.entries = 'broken'; fs.writeFileSync(file, JSON.stringify(o, null, 2));
  const named = (r, what) => {
    assert.deepStrictEqual([r.code, r.complete], [4, false], what + ': ' + JSON.stringify(r).slice(0, 600));
    assert.ok(r.problems.some(p => p.path === 'proposals/' + fid + '.json'), what + ' names the file: ' + JSON.stringify(r.problems));
  };
  const l = json('todo', 'list', F0.root, KID, '--json');
  named(l, 'todo list');
  assert.strictEqual(l.data.requests.filter(q => q.op === 'done')[0].status, 'held');
  named(json('run', F0.root, KID, '--contract', '2', '--json'), 'run');
  named(json('next', F0.root, KID, '--contract', '2', '--json'), 'next');
  named(json('todo', 'suggest-done', F0.root, KID, '--todo', x, '--fact', fid, '--json', ...TOOL), 'suggest-done');
  named(json('fact', 'list', F0.root, PR, '--json'), 'fact list');
  named(json('runs', F0.root, '--contract', '2', '--json'), 'runs');
});

rule('A fact record that is a link is unread, never absent: it holds what rests on it, and every reader names it, incomplete, exit 4', async () => {
  const linkIt = (root, name) => { const p = path.join(root, 'proposals', name), away = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-fact-away-')), name); fs.renameSync(p, away); fs.symlinkSync(away, p); };
  const F0 = await folder(), KID = 'validate-story/k102';
  assert.strictEqual(json('todo', 'add', F0.root, KID, '--phase', 'assess', '--text', 'Merge the fix', '--key', 'kid-td', '--json', ...TOOL).code, 0);
  assert.strictEqual(await decideAll(F0.d, KID, 'person-avery'), 1);
  await land(F0.d, KID);
  const x = json('todo', 'list', F0.root, KID, '--json').data.todos[0].id;
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs()] }), '--json', ...TOOL).code, 0);
  const fid = F.idFor('git-bot', 'prs-102-a');
  assert.deepStrictEqual(json('todo', 'suggest-done', F0.root, KID, '--todo', x, '--fact', fid, '--json', ...TOOL).data.status, 'requested');
  linkIt(F0.root, fid + '.json');
  const named = (r, what) => {
    assert.deepStrictEqual([r.code, r.complete], [4, false], what + ': ' + JSON.stringify(r).slice(0, 600));
    assert.ok(r.problems.some(p => p.path === 'proposals/' + fid + '.json'), what + ' names the link: ' + JSON.stringify(r.problems));
  };
  const l = json('todo', 'list', F0.root, KID, '--json');
  named(l, 'todo list');
  assert.strictEqual(l.data.requests.filter(q => q.op === 'done')[0].status, 'held');
  named(json('run', F0.root, KID, '--contract', '2', '--json'), 'run');
  named(json('next', F0.root, KID, '--contract', '2', '--json'), 'next');
  named(json('todo', 'suggest-done', F0.root, KID, '--todo', x, '--fact', fid, '--json', ...TOOL), 'suggest-done');
  named(json('fact', 'list', F0.root, PR, '--json'), 'fact list');
  named(json('runs', F0.root, '--contract', '2', '--json'), 'runs');
  /* An open blocker that becomes a link no longer reads as no blocker: the suggestion it stopped is held, nothing written. */
  const F1 = await folder(), x1 = await todo(F1);
  assert.strictEqual(json('fact', 'sync', F1.root, PR, '--from', input({ facts: [prs(), blockers({ complete: true, reported: 1, errors: [], entries: [{ id: 'B-1', text: 'Waiting on legal', state: 'open' }] })] }), '--json', ...TOOL).code, 0);
  const pid = F.idFor('git-bot', 'prs-102-a');
  assert.deepStrictEqual(json('todo', 'suggest-done', F1.root, PR, '--todo', x1, '--fact', pid, '--json', ...TOOL).error.kind, 'invalid', 'set-up: the open blocker refuses it');
  linkIt(F1.root, F.idFor('git-bot', 'blk-102-a') + '.json');
  const n = ls(F1.root).length, g = json('todo', 'suggest-done', F1.root, PR, '--todo', x1, '--fact', pid, '--json', ...TOOL);
  assert.deepStrictEqual([g.code, g.data && g.data.status, ls(F1.root).length], [4, 'held', n], JSON.stringify(g).slice(0, 600));
  const s = json('fact', 'sync', F1.root, PR, '--from', input({ facts: [prs({ key: 'prs-102-c' })] }), '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data && s.data.status, ls(F1.root).length], [4, 'held', n], 'sync holds too');
});

rule('A link is a hold whatever case its name is in: REQ-*.json or req-*.JSON is one reader\'s and every reader\'s unread record', async () => {
  for (const nameOf of [(n) => n.replace(/^req-/, 'REQ-'), (n) => n.replace(/\.json$/, '.JSON'), (n) => n.replace(/^req-/, 'Req-')]) {
    const F1 = await folder(), x1 = await todo(F1);
    assert.strictEqual(json('fact', 'sync', F1.root, PR, '--from', input({ facts: [prs(), blockers({ complete: true, reported: 1, errors: [], entries: [{ id: 'B-1', text: 'Waiting on legal', state: 'open' }] })] }), '--json', ...TOOL).code, 0);
    const pid = F.idFor('git-bot', 'prs-102-a'), bname = F.idFor('git-bot', 'blk-102-a') + '.json', link = nameOf(bname);
    const p = path.join(F1.root, 'proposals', bname), away = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-fact-away-')), bname);
    fs.renameSync(p, away); fs.symlinkSync(away, path.join(F1.root, 'proposals', link));
    const n = ls(F1.root).length, g = json('todo', 'suggest-done', F1.root, PR, '--todo', x1, '--fact', pid, '--json', ...TOOL);
    assert.deepStrictEqual([g.code, g.data && g.data.status, ls(F1.root).length], [4, 'held', n], link + ': ' + JSON.stringify(g).slice(0, 600));
    for (const [what, r] of [['todo list', json('todo', 'list', F1.root, PR, '--json')], ['run', json('run', F1.root, PR, '--contract', '2', '--json')], ['next', json('next', F1.root, PR, '--contract', '2', '--json')]]) {
      assert.deepStrictEqual([r.code, r.complete], [4, false], link + ' · ' + what + ': ' + JSON.stringify(r).slice(0, 400));
      assert.ok(r.problems.some((q) => q.path === 'proposals/' + link), link + ' · ' + what + ' names it: ' + JSON.stringify(r.problems));
    }
  }
});

rule('Importing facts alone changes no run bytes: every run.json and `run --contract 2` read the same before and after', async () => {
  const { root } = await folder();
  const runs0 = runsOf(root), read0 = json('run', root, PR, '--contract', '2', '--json'), kid0 = json('run', root, 'validate-story/k102', '--contract', '2', '--json');
  assert.strictEqual(read0.code, 0, JSON.stringify(read0));
  const many = [prs(), blockers(), prs({ key: 'st', domain: 'status', source: JIRA, entries: [{ id: 'ABC-102', text: 'In Review', category: 'doing' }] }), prs({ key: 'c', domain: 'commits', complete: false, reported: null, entries: [{ id: 'abc1234', text: 'Fix' }] }), prs({ key: 'p101', item: 'ABC-101', entries: [{ id: '9', text: 'x', state: 'open' }] })];
  assert.strictEqual(json('fact', 'sync', root, PR, '--from', input({ facts: many }), '--json', ...TOOL).code, 0);
  const strip = (j) => { const o = JSON.parse(JSON.stringify(j)); delete o.readAt; delete o.code; return o; };
  assert.deepStrictEqual(runsOf(root), runs0, 'no run file changed');
  assert.deepStrictEqual(strip(json('run', root, PR, '--contract', '2', '--json')), strip(read0), 'the parent reads the same');
  assert.deepStrictEqual(strip(json('run', root, 'validate-story/k102', '--contract', '2', '--json')), strip(kid0), 'a story\'s run reads the same');
  assert.deepStrictEqual(json('todo', 'list', root, PR, '--json').data.todos, [], 'no to-do came of it');
});

rule('suggest-done: --dry-run writes nothing; it files one done request named by its evidence, once from any tool; landing records the evidence; a retry is already', async () => {
  const F0 = await folder(), x = await todo(F0);
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs()] }), '--json', ...TOOL).code, 0);
  const fid = F.idFor('git-bot', 'prs-102-a'), before = snap(F0.root);
  const p = json('todo', 'suggest-done', F0.root, PR, '--todo', x, '--fact', fid, '--dry-run', '--json', ...TOOL);
  assert.strictEqual(p.code, 0, JSON.stringify(p));
  const W = await read(F0.d), r = W.runs.find(y => y.process + '/' + y.id === PR), xt = T.view(r, { records: W.records, people: PEOPLE, now: Date.now() }).byTodo[x];
  const fr = W.records.filter(y => y.id === fid)[0], id = F.suggestionId(x, F.incarnationOf(xt), BB, 'prs', fr.content);
  assert.deepStrictEqual([p.data.status, p.data.request.id, p.data.op, p.data.authority.needs, p.data.evidence.fact], ['would-request', id, 'done', 'person', fid]);
  assert.ok(/preview only; no files written\./.test(p.data.preview) && /on evidence: PRs from bitbucket/.test(p.data.preview) && /1 of 1 merged · complete · checked 3 hours ago/.test(p.data.preview), p.data.preview);
  assert.deepStrictEqual(snap(F0.root), before, 'nothing written');
  const s = json('todo', 'suggest-done', F0.root, PR, '--todo', x, '--fact', fid, '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data.status, ls(F0.root).filter(n => n === id + '.json')], [0, 'requested', [id + '.json']], JSON.stringify(s));
  const filed = JSON.parse(fs.readFileSync(path.join(F0.root, 'proposals', id + '.json'), 'utf8'));
  assert.deepStrictEqual([filed.kind, filed.op, filed.todo, filed.support.fact, filed.key], ['proposal', 'done', x, fid, F.suggestionKey(x, F.incarnationOf(xt), BB, 'prs', fr.content)]);
  const n = ls(F0.root).length;
  const again = json('todo', 'suggest-done', F0.root, PR, '--todo', x, '--fact', fid, '--json', '--tool', 'other-bot@2.0');
  assert.deepStrictEqual([again.code, again.data.status, ls(F0.root).length], [0, 'already', n], 'another tool, the same suggestion');
  /* A re-sync that only moves the time is the same suggestion. */
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs({ key: 'prs-102-b', observedAt: ago(HOUR) })] }), '--json', ...TOOL).code, 0);
  const moved = json('todo', 'suggest-done', F0.root, PR, '--todo', x, '--fact', F.idFor('git-bot', 'prs-102-b'), '--json', ...TOOL);
  assert.deepStrictEqual([moved.code, moved.data.status, moved.data.request.id], [0, 'already', id], JSON.stringify(moved));
  assert.strictEqual(await decideAll(F0.d, PR, 'person-morgan'), 1);
  await land(F0.d, PR);
  const l = json('todo', 'list', F0.root, PR, '--json'), t = l.data.todos[0];
  assert.deepStrictEqual([t.state, t.evidence && t.evidence.fact, t.evidence && t.evidence.domain], ['done', fid, 'prs'], JSON.stringify(t));
  const done = json('todo', 'suggest-done', F0.root, PR, '--todo', x, '--fact', fid, '--json', ...TOOL);
  assert.deepStrictEqual([done.code, done.data.status], [0, 'already'], 'applied: still already');
});

rule('A suggestion filed meanwhile under its name is already only for the same run, to-do and evidence; another run\'s is taken', async () => {
  const FD = require('../bin/flightdeck.js');
  const F0 = await folder(), x = await todo(F0), fid = F.idFor('git-bot', 'prs-102-a');
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs()] }), '--json', ...TOOL).code, 0);
  /* Between preparing and creating, another window files a checked suggestion under the same name, for r-42. */
  const race = async (edit) => {
    const orig = fs.linkSync;
    let raced = false;
    fs.linkSync = function (from, to) {
      if (!raced && /proposals[\\/]req-suggest-[0-9a-f]+\.json$/.test(String(to))) { raced = true; const o = JSON.parse(fs.readFileSync(from, 'utf8')); edit(o); fs.writeFileSync(to, JSON.stringify(o, null, 2) + '\n'); }
      return orig.apply(fs, arguments);
    };
    try { const r = await FD.main(['todo', 'suggest-done', F0.root, PR, '--todo', x, '--fact', fid, '--json', ...TOOL]); return Object.assign(JSON.parse(r.out), { code: r.code, raced }); } finally { fs.linkSync = orig; }
  };
  const sname = () => ls(F0.root).filter(n => /^req-suggest-/.test(n));
  const other = await race((o) => { o.run = { process: 'release-readiness', id: 'r-42' }; });
  assert.ok(other.raced, 'the race ran');
  assert.deepStrictEqual([other.code, other.error && other.error.kind], [1, 'key-taken'], JSON.stringify(other).slice(0, 600));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(F0.root, 'proposals', sname()[0]), 'utf8')).run.id, 'r-42', 'theirs is left as it is');
  fs.unlinkSync(path.join(F0.root, 'proposals', sname()[0]));
  /* The same suggestion for this run filed meanwhile is already. */
  const mine = await race(() => {});
  assert.deepStrictEqual([mine.code, mine.data && mine.data.status], [0, 'already'], JSON.stringify(mine).slice(0, 600));
});

rule('A name found taken is read back through the folder reader: a link raced in or a file over the size limit is a problem (exit 4, its path), never already', async () => {
  const FD = require('../bin/flightdeck.js');
  /* Between preparing and creating, the destination becomes a link to a matching record outside, or an oversized file. */
  const race = async (re, how, argv) => {
    const orig = fs.linkSync;
    let raced = '';
    fs.linkSync = function (from, to) {
      if (!raced && re.test(path.basename(String(to)))) {
        raced = path.basename(String(to));
        if (how === 'link') { const away = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-fact-away-')), raced); fs.copyFileSync(from, away); fs.symlinkSync(away, to); }
        else fs.writeFileSync(to, fs.readFileSync(from, 'utf8').replace(/\n$/, '') + ' '.repeat(T.LIMITS.bytes + 10) + '\n');
      }
      return orig.apply(fs, arguments);
    };
    try { const r = await FD.main(argv); return Object.assign(JSON.parse(r.out), { code: r.code, raced, root: argv[2] }); } finally { fs.linkSync = orig; }
  };
  const check = (r, what) => {
    assert.ok(r.raced, what + ': the race ran: ' + JSON.stringify(r).slice(0, 700));
    const st = r.data && (r.data.status === 'already' || (r.data.facts || []).some((f) => f.status === 'already'));
    assert.ok(!st, what + ': never already: ' + JSON.stringify(r).slice(0, 500));
    assert.deepStrictEqual([r.code, r.complete], [4, false], what + ': ' + JSON.stringify(r).slice(0, 500));
    assert.ok(r.problems.some((p) => p.path === 'proposals/' + r.raced), what + ' names it: ' + JSON.stringify(r.problems));
    fs.rmSync(path.join(r.root, 'proposals', r.raced));
  };
  for (const how of ['link', 'big']) {
    const F0 = await folder(), x = await todo(F0);
    check(await race(/^req-git-bot-/, how, ['fact', 'sync', F0.root, PR, '--from', input({ facts: [prs()] }), '--json', ...TOOL]), how + ' · fact sync');
    assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs()] }), '--json', ...TOOL).code, 0);
    check(await race(/^req-suggest-/, how, ['todo', 'suggest-done', F0.root, PR, '--todo', x, '--fact', F.idFor('git-bot', 'prs-102-a'), '--json', ...TOOL]), how + ' · suggest-done');
    check(await race(/^req-git-bot-/, how, ['todo', 'add', F0.root, PR, '--item', 'each/jira:10103', '--text', 'Tag the release', '--key', 'add-' + how, '--json', ...TOOL]), how + ' · todo add');
  }
});

rule('suggest-done refuses stale, replaced, incomplete or contrary evidence, and a fact about another item; nothing written', async () => {
  const F0 = await folder(), x = await todo(F0);
  const facts = [prs({ key: 'old', observedAt: ago(30 * HOUR) }), prs({ key: 'p103', item: 'ABC-103' }), prs({ key: 'part', source: { feed: 'github' }, complete: false, reported: 2 })];
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts }), '--json', ...TOOL).code, 0);
  const why = (fid) => { const r = json('todo', 'suggest-done', F0.root, PR, '--todo', x, '--fact', fid, '--json', ...TOOL); assert.deepStrictEqual([r.code, r.error && r.error.kind], [1, 'invalid'], JSON.stringify(r)); return r.error.why; };
  const before = snap(F0.root);
  assert.ok(/replaced by a later observation|stale/.test(why(F.idFor('git-bot', 'old'))));
  assert.ok(/not this to-do's item/.test(why(F.idFor('git-bot', 'p103'))));
  assert.ok(/incomplete/.test(why(F.idFor('git-bot', 'part'))));
  assert.ok(/There's no fact/.test(why('req-git-bot-000000000000000000000000')));
  /* A newer observation that says the PR was reverted: the older one no longer supports it. */
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs({ key: 'fresh' }), prs({ key: 'reverted', entries: [{ id: '17', text: 'Fix the login', state: 'open' }] })] }), '--json', ...TOOL).code, 0);
  const b2 = snap(F0.root);
  assert.ok(/replaced by a later observation that says something else/.test(why(F.idFor('git-bot', 'fresh'))));
  /* Open blockers on the item suppress it. */
  const F1 = await folder(), x1 = await todo(F1);
  assert.strictEqual(json('fact', 'sync', F1.root, PR, '--from', input({ facts: [prs(), blockers({ complete: true, reported: 1, errors: [], entries: [{ id: 'B-1', text: 'Waiting on legal', state: 'open' }] })] }), '--json', ...TOOL).code, 0);
  const r1 = json('todo', 'suggest-done', F1.root, PR, '--todo', x1, '--fact', F.idFor('git-bot', 'prs-102-a'), '--json', ...TOOL);
  assert.deepStrictEqual([r1.code, r1.error && r1.error.kind], [1, 'invalid']);
  assert.ok(/Other facts about it disagree: Blockers \(jira\): 1 open/.test(r1.error.why), r1.error.why);
  assert.deepStrictEqual(Object.keys(snap(F0.root)).filter(k => Object.keys(b2).indexOf(k) < 0), [], 'nothing written');
  assert.ok(before);
});

rule('Stale or replaced evidence between suggesting and applying lands nothing; fresh and the same again, it lands', async () => {
  const F0 = await folder(), x = await todo(F0);
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs({ maxAgeSeconds: 4 * 3600 })] }), '--json', ...TOOL).code, 0);
  const fid = F.idFor('git-bot', 'prs-102-a');
  assert.strictEqual(json('todo', 'suggest-done', F0.root, PR, '--todo', x, '--fact', fid, '--json', ...TOOL).code, 0);
  assert.strictEqual(await decideAll(F0.d, PR, 'person-morgan'), 1);
  /* Replaced before it is applied: held, nothing lands. */
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs({ key: 'reverted', entries: [{ id: '17', text: 'Fix the login', state: 'open' }] })] }), '--json', ...TOOL).code, 0);
  let l = json('todo', 'list', F0.root, PR, '--json');
  const q = l.data.requests.filter(y => y.op === 'done')[0];
  assert.deepStrictEqual([q.status, /changed since it was suggested/.test(q.why)], ['held', true], JSON.stringify(q));
  await land(F0.d, PR);
  assert.strictEqual(json('todo', 'list', F0.root, PR, '--json').data.todos[0].state, 'open', 'nothing landed');
  /* Observed the same again, but already stale by its own max age: still held. */
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs({ key: 'again-old', observedAt: ago(5 * HOUR), maxAgeSeconds: 4 * 3600 })] }), '--json', ...TOOL).code, 0);
  l = json('todo', 'list', F0.root, PR, '--json');
  assert.ok(/stale/.test(l.data.requests.filter(y => y.op === 'done')[0].why), JSON.stringify(l.data.requests));
  await land(F0.d, PR);
  assert.strictEqual(json('todo', 'list', F0.root, PR, '--json').data.todos[0].state, 'open', 'nothing landed on stale evidence');
  /* Fresh and the same again: it lands. */
  assert.strictEqual(json('fact', 'sync', F0.root, PR, '--from', input({ facts: [prs({ key: 'again-new', observedAt: ago(HOUR), maxAgeSeconds: 4 * 3600 })] }), '--json', ...TOOL).code, 0);
  await land(F0.d, PR);
  assert.strictEqual(json('todo', 'list', F0.root, PR, '--json').data.todos[0].state, 'done');
});

run();
