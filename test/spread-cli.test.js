// flightdeck spread (4.0, docs/apps.md, docs/design.md 45.1): a standing requirement on a loop. add, include and stop each ask
// the parent run with exactly one request, once; sync asks each story's own run for it, one request per obligation, named by
// the obligation, so an interruption between any two leaves the rest standing and the next sync asks only what is missing.
// --dry-run and list write nothing; the CLI never decides and never writes run.json.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { load, rule, run } = require('./harness');
const PF = load(), R = PF.run, T = PF.todos, LP = PF.loop;
const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js');
const cli = (...a) => { try { return { out: execFileSync(process.execPath, [BIN, ...a], { encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (e) { return { out: String(e.stdout) + String(e.stderr), code: e.status }; } };
const json = (...a) => { const r = cli(...a); try { return Object.assign(JSON.parse(r.out), { code: r.code }); } catch (e) { throw new Error('not JSON (' + r.code + '): ' + r.out); } };
const AT = '2026-11-09T09:00:00.000Z';
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
let seq = 0; const hex = () => (++seq).toString(16).padStart(8, '0');

async function folder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-spread-')), d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  await PF.repo.publish(d, CHILD, { people, by: 'person-morgan', changes: 'First', existing: [], now: AT, app: '4.0.0' });
  let all = await PF.repo.loadAll(d, {});
  const pr = await PF.repo.publish(d, PARENT, { people, by: 'person-morgan', changes: 'First', existing: [], now: AT, app: '4.0.0', processes: all.processes }); if (pr.blockers) throw new Error(JSON.stringify(pr.blockers));
  all = await PF.repo.loadAll(d, {});
  const procOf = (id) => { const x = all.processes.filter(p => p.process === id)[0]; return x ? { latest: x.index.latest, all: x.index.all, clashes: x.index.clashes, broken: [] } : null; }, pp = procOf('release-readiness').latest;
  const r = R.create(pp, { id: 'r-41', by: 'person-morgan', session: 'w', now: AT, app: '4.0.0', details: { fix_version: '4.1' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
  await d.write('runs/release-readiness/r-41/run.json', JSON.stringify(r, null, 2));
  /* A story's run: open, or ended cleared. */
  const kid = async (n, cleared, attempt) => {
    const id = 'k' + n + (attempt > 1 ? 'a' + attempt : '');
    const c = R.create(procOf('validate-story').latest, { id, by: 'person-avery', session: 'w2', now: AT, app: '4.0.0', details: { issue: 'ABC-' + n, fix_version: '4.1' }, parent: { process: 'release-readiness', id: 'r-41', step: 'each', item: { uid: 'jira:' + (10000 + n), key: 'ABC-' + n, attempt: attempt || 1 } } });
    const m = R.mapOf(c); R.done(c, m, 'read', 'person-avery', AT);
    if (cleared) { R.done(c, m, 'verdict', 'person-avery', AT, { decision: 'cleared' }); R.pass(c, m, 0, 'person-avery', AT); R.end(c, m, 'Completed', 'person-avery', 'Avery', AT); }
    await d.write('runs/validate-story/' + id + '/run.json', JSON.stringify(c, null, 2));
  };
  /* The loop's scope, as `loop sync` files it. */
  const scope = async (key, ns) => {
    const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: 'r-41', step: 'each' }, observation: obs(ns), changes: [] }, key, { name: 'release-helper', version: '1.0' });
    const all2 = await PF.repo.loadAll(d, {}), f = LP.buildRequest(c.intent, { seen: (all2.scopes || []).map(x => x.id), children: [], now: AT, app: '4.0.0' });
    await d.write('proposals/' + f.id + '.json', LP.text(f));
  };
  return { root, d, kid, scope };
}
const ls = (root) => fs.existsSync(path.join(root, 'proposals')) ? fs.readdirSync(path.join(root, 'proposals')).filter(n => n[0] !== '.').sort() : [];
const snap = (root) => { const out = {}; const walk = (x) => fs.readdirSync(x, { withFileTypes: true }).forEach(e => { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else out[path.relative(root, p)] = fs.readFileSync(p, 'utf8'); }); walk(root); return out; };
const runFile = (root, key) => path.join(root, 'runs', key, 'run.json');
/* What a window reads: every run (sanitized) and every record. */
async function read(d) { const all = await PF.repo.loadAll(d, {}); return { runs: all.runs, records: all.todos || [], unread: all.todosUnread || [] }; }
/* A person decides every request on a run that waits for them, each a decision of its own. */
async function decideAll(d, key, by, op) {
  const W = await read(d), x = W.runs.find(y => y.process + '/' + y.id === key), its = T.inbox([x], { records: W.records, unread: W.unread, people: PEOPLE, me: by });
  for (const it of its) {
    const dd = T.decide(x, { request: it.id, op: op || 'accept', by, shown: it.consequence.fingerprint, records: W.records, unread: W.unread, people: PEOPLE, at: AT, writer: 'w' + hex(), rev: hex(), app: '4.0.0' });
    assert.ok(!dd.why, dd.why);
    await d.write('proposals/' + dd.name, T.text(dd.file)); W.records.push(Object.assign(dd.record, { _file: dd.name }));
  }
  return its.length;
}
/* The run's recorder's window: land every queued request, one at a time. */
async function land(d, key) {
  const raw = JSON.parse(fs.readFileSync(runFile(d.root, key), 'utf8')), rec = raw.recorder && raw.recorder.person;
  for (let i = 0; i < 100; i++) {
    const W = await read(d), x = W.runs.find(y => y.process + '/' + y.id === key), V = T.view(x, { records: W.records, unread: W.unread, people: PEOPLE }), q = T.nextQueued(V);
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
const TOOL = ['--tool', 'release-helper@1.4.0'];
const ADD = ['--loop', 'each', '--text', 'Security sign-off', '--before', 'assess-confirm'];
/* Three stories, ABC-101 cleared, ABC-102 and ABC-103 open; the spread asked, accepted by Morgan and landed. */
async function spread() {
  const F = await folder();
  await F.kid(101, true); await F.kid(102); await F.kid(103); await F.scope('s1', [101, 102, 103]);
  const a = json('spread', 'add', F.root, PR, ...ADD, '--key', 'sec-1', '--json', ...TOOL);
  assert.strictEqual(a.code, 0, JSON.stringify(a));
  assert.strictEqual(await decideAll(F.d, PR, 'person-morgan'), 1);
  await land(F.d, PR);
  const l = json('spread', 'list', F.root, PR, '--json');
  assert.strictEqual(l.data.spreads.length, 1, JSON.stringify(l));
  return Object.assign(F, { sp: l.data.spreads[0] });
}

rule('list and add --dry-run write nothing; add writes exactly one request, once; the same key with other content is refused', async () => {
  const { root, kid, scope } = await folder();
  await kid(101, true); await kid(102); await kid(103); await scope('s1', [101, 102, 103]);
  const before = snap(root);
  const l0 = json('spread', 'list', root, PR, '--json');
  assert.deepStrictEqual([l0.code, l0.data.spreads, l0.data.requests], [0, [], []]);
  const p = json('spread', 'add', root, PR, ...ADD, '--key', 'sec-1', '--dry-run', '--json', ...TOOL);
  assert.strictEqual(p.code, 0, JSON.stringify(p));
  const id = T.idFor('release-helper', 'sec-1');
  assert.deepStrictEqual([p.data.status, p.data.request.id, p.data.op, p.data.authority.needs, p.data.consequence.releases, p.data.queue, p.data.scope], ['would-request', id, 'spread-add', 'person', false, 'Waiting for approval', { open: 2, unchanged: 1 }]);
  assert.ok(/preview only; no files written\.\n\nRequire "Security sign-off" on 2 open stories, and on every story that joins later; 1 cleared story stays unchanged\./.test(p.data.preview), p.data.preview);
  const text = cli('spread', 'add', root, PR, ...ADD, '--key', 'sec-1', '--dry-run', ...TOOL);
  assert.strictEqual(text.code, 0, text.out); assert.ok(/Require "Security sign-off" on 2 open stories/.test(text.out), text.out);
  assert.deepStrictEqual(snap(root), before, 'nothing written');
  const a = json('spread', 'add', root, PR, ...ADD, '--key', 'sec-1', '--json', ...TOOL);
  assert.deepStrictEqual([a.code, a.data.status, ls(root).filter(n => n.indexOf(id) === 0)], [0, 'requested', [id + '.json']]);
  const f = JSON.parse(fs.readFileSync(path.join(root, 'proposals', id + '.json'), 'utf8'));
  assert.deepStrictEqual([f.kind, f.op, f.loopStep, f.text, f.child, f.decision], ['proposal', 'spread-add', 'each', 'Security sign-off', { beforeGate: 'assess-confirm' }, undefined]);
  const n = ls(root).length;
  const again = json('spread', 'add', root, PR, ...ADD, '--key', 'sec-1', '--json', '--tool', 'release-helper@1.5.0');
  assert.deepStrictEqual([again.code, again.data.status, ls(root).length], [0, 'already', n]);
  const other = json('spread', 'add', root, PR, '--loop', 'each', '--text', 'Legal sign-off', '--before', 'assess-confirm', '--key', 'sec-1', '--json', ...TOOL);
  assert.deepStrictEqual([other.code, other.error.kind, ls(root).length], [1, 'key-taken', n]);
  assert.ok(/text/.test(other.error.why), other.error.why);
  assert.strictEqual(fs.readFileSync(runFile(root, PR), 'utf8'), before['runs/release-readiness/r-41/run.json'], 'the CLI never writes run.json');
});

rule('Once landed, list shows one spread row: open stories owed, cleared ones unchanged, each story\'s state', async () => {
  const { root, sp } = await spread();
  assert.deepStrictEqual([sp.text, sp.loop, sp.beforeGate, sp.row, sp.preview], ['Security sign-off', 'each', 'assess-confirm', 'Security sign-off · on 2 stories · 0 done', '2 open stories; 1 cleared story unchanged']);
  assert.deepStrictEqual(sp.items.map(i => [i.key, i.owed, i.state]), [['ABC-101', false, 'exempt'], ['ABC-102', true, 'owed'], ['ABC-103', true, 'owed']]);
  assert.ok(sp.holds.length === 2, JSON.stringify(sp.holds));
  const text = cli('spread', 'list', root, PR);
  assert.strictEqual(text.code, 0, text.out);
  assert.ok(/Security sign-off · on 2 stories · 0 done/.test(text.out) && /2 open stories; 1 cleared story unchanged/.test(text.out), text.out);
});

rule('sync --dry-run writes nothing; sync asks each owed story\'s own run once; a retry asks nothing new', async () => {
  const { root, sp } = await spread(), before = snap(root);
  const p = json('spread', 'sync', root, PR, '--spread', sp.id, '--dry-run', '--json', ...TOOL);
  assert.strictEqual(p.code, 0, JSON.stringify(p));
  assert.deepStrictEqual(p.data.items.map(i => [i.key, i.run, i.status, i.needs]), [['ABC-102', 'validate-story/k102', 'would-request', 'person'], ['ABC-103', 'validate-story/k103', 'would-request', 'person']]);
  assert.deepStrictEqual(p.data.skipped, [], 'a story cleared when it was added owes nothing, so nothing is skipped');
  assert.deepStrictEqual(snap(root), before, 'nothing written');
  const s = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data.status, s.data.items.map(i => i.status)], [0, 'synced', ['requested', 'requested']]);
  const files = s.data.items.map(i => i.file.slice('proposals/'.length));
  files.forEach(n => { const f = JSON.parse(fs.readFileSync(path.join(root, 'proposals', n), 'utf8')); assert.deepStrictEqual([f.op, f.text, f.fulfills.spread, f.target], ['add', 'Security sign-off', sp.id, { phase: 'assess' }]); });
  const n = ls(root).length;
  /* Another tool, the same obligations: the same requests. */
  const again = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', '--tool', 'other-bot@2.0');
  assert.deepStrictEqual([again.code, again.data.items.length, ls(root).length], [0, 0, n], JSON.stringify(again.data));
  const l = json('spread', 'list', root, PR, '--json');
  assert.deepStrictEqual(l.data.spreads[0].items.map(i => [i.key, i.state]), [['ABC-101', 'exempt'], ['ABC-102', 'waiting'], ['ABC-103', 'waiting']]);
  assert.strictEqual(fs.readFileSync(runFile(root, 'validate-story/k102'), 'utf8'), before['runs/validate-story/k102/run.json'], 'no child run.json written');
});

rule('An interruption between any two child requests leaves the others standing; the next sync asks only what is missing, once', async () => {
  for (let at = 0; at < 3; at++) {
    const F = await folder();
    await F.kid(101); await F.kid(102); await F.kid(103); await F.scope('s1', [101, 102, 103]);
    json('spread', 'add', F.root, PR, ...ADD, '--key', 'sec-1', '--json', ...TOOL);
    await decideAll(F.d, PR, 'person-morgan'); await land(F.d, PR);
    const sp = json('spread', 'list', F.root, PR, '--json').data.spreads[0];
    const p = json('spread', 'sync', F.root, PR, '--spread', sp.id, '--dry-run', '--json', ...TOOL), names = p.data.items.map(i => i.file.slice('proposals/'.length));
    assert.strictEqual(names.length, 3);
    /* The write of the at-th request can't happen (something stands where it goes). */
    const block = path.join(F.root, 'proposals', names[at]);
    fs.mkdirSync(block, { recursive: true });
    const s = json('spread', 'sync', F.root, PR, '--spread', sp.id, '--json', ...TOOL);
    assert.deepStrictEqual([s.code, s.data.status, s.data.partial], [4, 'partial', true], 'interrupted at ' + at);
    assert.deepStrictEqual(s.data.items.map(i => i.status), names.map((n, i) => i === at ? 'failed' : 'requested'));
    names.forEach((n, i) => { if (i !== at) assert.ok(fs.statSync(path.join(F.root, 'proposals', n)).isFile(), n); });
    fs.rmdirSync(block);
    const n0 = ls(F.root).length;
    const s2 = json('spread', 'sync', F.root, PR, '--spread', sp.id, '--json', ...TOOL);
    assert.deepStrictEqual([s2.code, s2.data.items.map(i => [i.file.slice('proposals/'.length), i.status])], [0, [[names[at], 'requested']]], 'only the missing one: ' + JSON.stringify(s2.data.items));
    assert.strictEqual(ls(F.root).length, n0 + 1);
    const s3 = json('spread', 'sync', F.root, PR, '--spread', sp.id, '--json', ...TOOL);
    assert.deepStrictEqual([s3.code, s3.data.items.length, ls(F.root).length], [0, 0, n0 + 1]);
  }
});

rule('A story that joins later is owed at once: list says it joined, and sync asks its run', async () => {
  const F = await spread();
  await F.kid(104); await F.scope('s2', [101, 102, 103, 104]);
  const l = json('spread', 'list', F.root, PR, '--json'), sp = l.data.spreads[0];
  const it = sp.items.filter(i => i.key === 'ABC-104')[0];
  assert.deepStrictEqual([it.owed, it.arrival, it.state], [true, true, 'owed']);
  assert.ok(sp.notices.some(n => /^ABC-104 joined\. Security sign-off is owed; not requested yet\./.test(n)), JSON.stringify(sp.notices));
  const s = json('spread', 'sync', F.root, PR, '--spread', sp.id, '--json', ...TOOL);
  assert.deepStrictEqual(s.data.items.map(i => i.key), ['ABC-102', 'ABC-103', 'ABC-104']);
});

rule('include asks to cover a cleared story, --run binds it to one run; stop needs a reason and keeps what is owed; all need a person', async () => {
  const { root, sp } = await spread();
  const inc = json('spread', 'include', root, PR, '--spread', sp.id, '--item', 'ABC-101', '--key', 'inc-1', '--dry-run', '--json', ...TOOL);
  assert.deepStrictEqual([inc.code, inc.data.op, inc.data.authority.needs], [0, 'spread-include', 'person'], JSON.stringify(inc));
  const bind = json('spread', 'include', root, PR, '--spread', sp.id, '--item', 'ABC-102', '--run', 'validate-story/k102', '--key', 'bind-1', '--dry-run', '--json', ...TOOL);
  assert.deepStrictEqual([bind.code, bind.data.op], [0, 'spread-bind'], JSON.stringify(bind));
  const s0 = json('spread', 'stop', root, PR, '--spread', sp.id, '--key', 'stop-1', '--json', ...TOOL);
  assert.deepStrictEqual([s0.code, s0.error.kind], [1, 'usage']); assert.ok(/--reason/.test(s0.error.why));
  const st = json('spread', 'stop', root, PR, '--spread', sp.id, '--reason', 'Not needed for 4.1', '--key', 'stop-1', '--json', ...TOOL);
  assert.deepStrictEqual([st.code, st.data.status, st.data.op, st.data.consequence.releases, st.data.authority.needs], [0, 'requested', 'spread-stop', true, 'person'], JSON.stringify(st));
  const f = JSON.parse(fs.readFileSync(path.join(root, 'proposals', st.data.request.id + '.json'), 'utf8'));
  assert.deepStrictEqual(f.owed, [{ uid: 'jira:10102', attempt: 1 }, { uid: 'jira:10103', attempt: 1 }]);
  const nope = json('spread', 'include', root, PR, '--spread', 'sp-nope', '--item', 'ABC-101', '--key', 'inc-2', '--json', ...TOOL);
  assert.deepStrictEqual([nope.code, nope.error.kind], [1, 'invalid']);
});

rule('Usage: a missing tool, key, spread or reason, an unknown flag, --dry-run on list: each named, nothing written', async () => {
  const { root, kid, scope } = await folder();
  await kid(101); await scope('s1', [101]);
  const before = snap(root);
  const bad = [
    ['spread', 'add', root, PR, ...ADD, '--key', 'k', '--json'],
    ['spread', 'add', root, PR, ...ADD, '--json', ...TOOL],
    ['spread', 'add', root, PR, '--loop', 'each', '--key', 'k', '--json', ...TOOL],
    ['spread', 'sync', root, PR, '--json', ...TOOL],
    ['spread', 'list', root, PR, '--dry-run', '--json'],
    ['spread', 'list', root, PR, '--wat', '--json'],
    ['spread', 'frob', root, PR, '--json'],
    ['spread', 'include', root, PR, '--spread', 'x', '--item', 'ABC-101', '--attempt', '0', '--key', 'k', '--json', ...TOOL],
  ];
  bad.forEach(a => { const r = json(...a); assert.deepStrictEqual([r.code, r.error.kind], [1, 'usage'], a.join(' ') + ': ' + JSON.stringify(r)); });
  assert.strictEqual(json('spread', 'list', root, 'release-readiness/nope', '--json').code, 5);
  const notLoop = json('spread', 'add', root, PR, '--loop', 'ship1', '--text', 'x', '--before', 'assess-confirm', '--key', 'k', '--json', ...TOOL);
  assert.deepStrictEqual([notLoop.code, notLoop.error.kind], [1, 'invalid']); assert.ok(/isn't a loop/.test(notLoop.error.why));
  assert.deepStrictEqual(snap(root), before, 'nothing written');
});

rule('A record this depends on that can\'t be read holds sync (exit 4) and writes nothing', async () => {
  const { root, sp } = await spread();
  fs.writeFileSync(path.join(root, 'proposals', 'req-zzzzzzzzzzzzzzzzzzzzzzzz.json'), '{"format":"flightdeck-plan/4",');
  const before = snap(root);
  const s = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL);
  assert.strictEqual(s.code, 4, JSON.stringify(s));
  assert.deepStrictEqual(snap(root), before, 'nothing written');
});

rule('SA: stop is refused (exit 4, nothing written) while a scope record of the loop is missing; list says coverage is incomplete', async () => {
  const { root, d, sp } = await spread();
  /* A scope record whose predecessor hasn't arrived. */
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: 'r-41', step: 'each' }, observation: obs([101, 102, 103, 104]), changes: [] }, 's9', { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: ['req-release-helper-' + 'e'.repeat(24)], children: [], now: AT, app: '4.0.0' });
  await d.write('proposals/' + f.id + '.json', LP.text(f));
  const l = json('spread', 'list', root, PR, '--json');
  assert.deepStrictEqual([l.data.spreads[0].complete, l.data.spreads[0].items], [false, []]);
  const before = snap(root);
  const st = json('spread', 'stop', root, PR, '--spread', sp.id, '--reason', 'Not needed', '--key', 'stop-h', '--json', ...TOOL);
  assert.deepStrictEqual([st.code, st.data && st.data.status], [4, 'held'], JSON.stringify(st));
  assert.ok(/can't all be read/.test(st.data.preview), st.data.preview);
  assert.deepStrictEqual(snap(root), before, 'nothing written');
});

/* A story's run made living: its recorder adds and lands a plain to-do of its own. */
async function living(d, key) {
  const W = await read(d), x = W.runs.find(y => y.process + '/' + y.id === key);
  const P = T.prepare(x, { body: { op: 'add', text: 'Own work', target: { phase: 'assess' } }, by: { person: 'person-avery' }, key: 'own-' + hex(), records: W.records, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0' });
  assert.ok(!P.why, P.why);
  await d.write('proposals/' + P.name, T.text(P.file));
  await land(d, key);
}
rule('SG: run on a living story reads its spread request as every window does: waiting, never held for a dependency it can read', async () => {
  const { root, d, sp } = await spread();
  await living(d, 'validate-story/k102');
  const s = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL);
  const q = s.data.items.filter(i => i.key === 'ABC-102')[0];
  const r = json('run', root, 'validate-story/k102', '--contract', '2', '--json');
  assert.strictEqual(r.code, 0, JSON.stringify(r).slice(0, 400));
  const got = r.data.run.todoRequests.filter(x => x.id === q.request)[0];
  assert.deepStrictEqual([got && got.status, got && got.why], ['waiting', got && got.why], JSON.stringify(r.data.run.todoRequests));
});

run();
