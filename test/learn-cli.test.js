// flightdeck todo keep and spread keep (4.0, docs/apps.md, docs/design.md 45.3): keep a to-do or a spread for next time. One
// record in proposals/, named by the run, what it keeps and where, never by a key: the same keep again is already, the same
// place in other words is another alternative. It changes no work, holds no gate and never writes run.json. What it rests on that can't
// be read holds it (exit 4) with the path named, never guessed; --dry-run writes nothing.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { load, rule, run } = require('./harness');
const PF = load(), R = PF.run, T = PF.todos, LP = PF.loop, L = PF.learn;
const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js');
const cli = (...a) => { try { return { out: execFileSync(process.execPath, [BIN, ...a], { encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (e) { return { out: String(e.stdout) + String(e.stderr), code: e.status }; } };
const json = (...a) => { const r = cli(...a); try { return Object.assign(JSON.parse(r.out), { code: r.code }); } catch (e) { throw new Error('not JSON (' + r.code + '): ' + r.out); } };
const AT = '2026-11-10T09:00:00.000Z';
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
const CHILD = ['---', 'process: validate-story', 'title: Validate a story', 'owner: person-avery', 'context: issue, fix_version, disposition:choice(cleared|needs-work)', 'result: disposition', '---', '',
  '## Assess · DO-CONFIRM {#assess}', '- [!] {confirm} Read the story {#read}', '- [!] {decide} Record the validation result {#verdict}', '  options: cleared, needs-work', '  sets: disposition=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-morgan', 'context: fix_version', '---', '', '## Stories · DO-CONFIRM {#stories}',
  '- [!] {for.each} Validate every release story {#each}', '  process: validate-story', '  items: jira.issue', '  pass: issue=item:key, fix_version=^fix_version', '  accepts: cleared', '',
  '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
const people = [{ id: 'person-morgan', name: 'Morgan' }, { id: 'person-avery', name: 'Avery' }];
const PEOPLE = { people };
const obs = (ns) => ({ source: { system: 'jira' }, generation: 'g1', query: 'fixVersion = 4.1', observedAt: '2026-11-07T09:42:00Z',
  items: ns.map(n => ({ id: String(10000 + n), key: 'ABC-' + n, title: 'Story ' + n })), reported: ns.length, fetched: ns.length, complete: false, errors: [] });
const PR = 'release-readiness/r-41', TOOL = ['--tool', 'release-helper@1.4.0'];
let seq = 0; const hex = () => (++seq).toString(16).padStart(8, '0');
const ls = (root) => fs.existsSync(path.join(root, 'proposals')) ? fs.readdirSync(path.join(root, 'proposals')).filter(n => n[0] !== '.').sort() : [];
const snap = (root) => { const out = {}; const walk = (x) => fs.readdirSync(x, { withFileTypes: true }).forEach(e => { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else out[path.relative(root, p)] = fs.readFileSync(p, 'utf8'); }); walk(root); return out; };
const runFile = (root, key) => path.join(root, 'runs', key, 'run.json');
async function read(d) { const all = await PF.repo.loadAll(d, {}); return { runs: all.runs, records: all.todos || [], unread: all.todosUnread || [] }; }
async function decideAll(d, key, by) {
  const W = await read(d), x = W.runs.find(y => y.process + '/' + y.id === key), its = T.inbox([x], { records: W.records, unread: W.unread, people: PEOPLE, me: by });
  for (const it of its) {
    const dd = T.decide(x, { request: it.id, op: 'accept', by, shown: it.consequence.fingerprint, records: W.records, unread: W.unread, people: PEOPLE, at: AT, writer: 'w' + hex(), rev: hex(), app: '4.0.0' });
    assert.ok(!dd.why, dd.why);
    await d.write('proposals/' + dd.name, T.text(dd.file)); W.records.push(Object.assign(dd.record, { _file: dd.name }));
  }
}
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
/* A release run with a loop over three stories, a to-do on its Ship phase, one on story ABC-102 and a spread, all landed. */
async function folder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-keep-')), d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  await PF.repo.publish(d, CHILD, { people, by: 'person-avery', changes: 'First', existing: [], now: AT, app: '4.0.0' });
  let all = await PF.repo.loadAll(d, {});
  const pr = await PF.repo.publish(d, PARENT, { people, by: 'person-morgan', changes: 'First', existing: [], now: AT, app: '4.0.0', processes: all.processes }); if (pr.blockers) throw new Error(JSON.stringify(pr.blockers));
  all = await PF.repo.loadAll(d, {});
  const procOf = (id) => { const x = all.processes.filter(p => p.process === id)[0]; return x ? { latest: x.index.latest, all: x.index.all, clashes: x.index.clashes, broken: [] } : null; }, pp = procOf('release-readiness').latest;
  const r = R.create(pp, { id: 'r-41', by: 'person-morgan', session: 'w', now: AT, app: '4.0.0', details: { fix_version: '4.1' }, pins: PF.pins.atStart(pp.map, pp.info.payload ? pp.info.payload.pins : null, procOf) });
  await d.write('runs/release-readiness/r-41/run.json', JSON.stringify(r, null, 2));
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: 'r-41', step: 'each' }, observation: obs([101, 102, 103]), changes: [] }, 's1', { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: [], children: [], now: AT, app: '4.0.0' });
  await d.write('proposals/' + f.id + '.json', LP.text(f));
  const ask = (...a) => { const x = json(...a, '--json', ...TOOL); assert.strictEqual(x.code, 0, JSON.stringify(x)); return x; };
  ask('todo', 'add', root, PR, '--key', 't-1', '--text', 'Post the release notes', '--phase', 'ship');
  ask('todo', 'add', root, PR, '--key', 't-2', '--text', 'Check the test plan', '--item', 'each/jira:10102');
  ask('spread', 'add', root, PR, '--loop', 'each', '--text', 'Security sign-off', '--before', 'assess-confirm', '--key', 'sp-1');
  await decideAll(d, PR, 'person-morgan');
  await land(d, PR);
  const l = json('todo', 'list', root, PR, '--json'), sl = json('spread', 'list', root, PR, '--json');
  const td = (t) => l.data.todos.filter(x => x.text === t)[0].id;
  return { root, d, phaseTodo: td('Post the release notes'), itemTodo: td('Check the test plan'), spread: sl.data.spreads[0].id, child: procOf('validate-story').latest, parent: pp };
}

rule('todo keep on a phase to-do: --dry-run writes nothing; it files one keep for the run\'s own checklist, once; never a key', async () => {
  const F = await folder(), before = snap(F.root);
  const p = json('todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--dry-run', '--json', ...TOOL);
  assert.strictEqual(p.code, 0, JSON.stringify(p));
  assert.deepStrictEqual([p.data.status, p.data.placed, p.data.template.process, p.data.template.folder, p.data.anchor, p.data.where], ['would-keep', true, 'release-readiness', F.parent.folder, { phase: 'ship' }, 'end']);
  assert.ok(/\n\nSuggest for next time in release-readiness v1: add "Post the release notes" at the end of phase ship\. The checklist's owner reviews it; this run doesn't change\./.test(p.data.preview), p.data.preview);
  assert.deepStrictEqual(snap(F.root), before, 'nothing written');
  const k = json('todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--reason', 'We forget it every time', '--json', ...TOOL);
  const id = k.data.keep.id;
  assert.deepStrictEqual([k.code, k.data.status, ls(F.root).filter(n => n.indexOf(id) === 0)], [0, 'kept', [id + '.json']]);
  const f = JSON.parse(fs.readFileSync(path.join(F.root, 'proposals', id + '.json'), 'utf8'));
  assert.deepStrictEqual([f.kind, f.producer, f.source, f.change, f.reason, f.key], ['keep', { name: 'release-helper', version: '1.4.0' }, { todo: F.phaseTodo }, { op: 'add', text: 'Post the release notes', where: 'end' }, 'We forget it every time', 'kp-' + id.slice(9)]);
  assert.ok(T.cleanFile(f, id + '.json').ok, 'the app reads it');
  const n = ls(F.root).length;
  const again = json('todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--reason', 'We forget it every time', '--json', '--tool', 'other-helper@2.0');
  assert.deepStrictEqual([again.code, again.data.status, ls(F.root).length], [0, 'already', n]);
  const other = json('todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--text', 'Post the notes to the wiki', '--json', ...TOOL);
  assert.deepStrictEqual([other.code, other.data.status, ls(F.root).length], [0, 'kept', n + 1], 'another wording is another alternative');
  assert.notStrictEqual(other.data.keep.id, id);
  const otherAgain = json('todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--text', 'Post the notes to the wiki', '--json', ...TOOL);
  assert.deepStrictEqual([otherAgain.code, otherAgain.data.status, ls(F.root).length], [0, 'already', n + 1]);
  const reasoned = json('todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--reason', 'Another reason', '--json', ...TOOL);
  assert.deepStrictEqual([reasoned.code, reasoned.error.kind, ls(F.root).length], [1, 'key-taken', n + 1]);
  const keyed = json('todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--key', 'k-1', '--json', ...TOOL);
  assert.deepStrictEqual([keyed.code, keyed.error.kind], [1, 'usage']);
  assert.strictEqual(fs.readFileSync(runFile(F.root, PR), 'utf8'), before['runs/release-readiness/r-41/run.json'], 'the CLI never writes run.json');
  const l = json('todo', 'list', F.root, PR, '--json');
  assert.deepStrictEqual(l.data.todos.filter(x => x.id === F.phaseTodo)[0].state, 'open', 'the to-do is unchanged');
});

rule('todo keep on an item\'s to-do goes to the checklist the items run: needs placement until --phase or --after says where', async () => {
  const F = await folder();
  const n = json('todo', 'keep', F.root, PR, '--todo', F.itemTodo, '--json', ...TOOL);
  assert.deepStrictEqual([n.code, n.data.status, n.data.placed, n.data.template && n.data.template.process], [0, 'kept', false, 'validate-story']);
  assert.ok(/needs placement/.test(n.data.preview) && /--phase or --after/.test(n.data.needs), n.data.preview);
  const p = json('todo', 'keep', F.root, PR, '--todo', F.itemTodo, '--after', 'read', '--json', ...TOOL);
  assert.deepStrictEqual([p.code, p.data.status, p.data.template.process, p.data.template.folder, p.data.anchor, p.data.where], [0, 'kept', 'validate-story', F.child.folder, { phase: 'assess', after: 'read' }, 'after']);
  const bad = json('todo', 'keep', F.root, PR, '--todo', F.itemTodo, '--after', 'nowhere', '--json', ...TOOL);
  assert.deepStrictEqual([bad.code, bad.error.kind], [1, 'invalid']);
  assert.ok(/can't be placed in validate-story v1: step nowhere isn't in that checklist/.test(bad.error.why), bad.error.why);
  const both = json('todo', 'keep', F.root, PR, '--todo', F.itemTodo, '--after', 'read', '--phase', 'assess', '--json', ...TOOL);
  assert.deepStrictEqual([both.code, both.error.kind], [1, 'usage']);
});

rule('spread keep goes to the checklist the items run, at the end of the phase its gate is in', async () => {
  const F = await folder();
  const k = json('spread', 'keep', F.root, PR, '--spread', F.spread, '--json', ...TOOL);
  assert.deepStrictEqual([k.code, k.data.status, k.data.template.process, k.data.anchor, k.data.where], [0, 'kept', 'validate-story', { phase: 'assess' }, 'end'], JSON.stringify(k));
  const t = cli('spread', 'keep', F.root, PR, '--spread', F.spread, ...TOOL);
  assert.strictEqual(t.code, 0, t.out);
  assert.ok(/Already kept/.test(t.out), t.out);
  const none = json('spread', 'keep', F.root, PR, '--spread', 'sp-' + '0'.repeat(24), '--json', ...TOOL);
  assert.deepStrictEqual([none.code, none.error.kind], [1, 'invalid']);
});

rule('What a keep rests on that can\'t be read holds it (exit 4) with the path named, and nothing is written', async () => {
  const F = await folder();
  /* A damaged record of this run in proposals/. */
  const bad = T.idFor('release-helper', 'zz') + '.json';
  fs.writeFileSync(path.join(F.root, 'proposals', bad), JSON.stringify({ format: 'flightdeck-plan/4', features: ['living-runs'], kind: 'proposal', id: bad.slice(0, -5), run: { process: 'release-readiness', id: 'r-41' } }));
  const n = ls(F.root).length;
  const h = json('todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--json', ...TOOL);
  assert.deepStrictEqual([h.code, h.data.status, ls(F.root).length], [4, 'held', n], JSON.stringify(h));
  assert.ok(h.problems.some(x => x.path === 'proposals/' + bad), JSON.stringify(h.problems));
  fs.unlinkSync(path.join(F.root, 'proposals', bad));
  /* The items' checklist can't be read: the spread's keep is held, never filed as needing placement. */
  const pubDir = path.join(F.root, 'publications', 'validate-story', F.child.folder);
  fs.writeFileSync(path.join(pubDir, 'map.md'), 'damaged');
  const s = json('spread', 'keep', F.root, PR, '--spread', F.spread, '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data.status, ls(F.root).length], [4, 'held', n - 1], JSON.stringify(s));
  assert.ok(s.problems.some(x => x.path.indexOf('publications/validate-story') === 0), JSON.stringify(s.problems));
  /* The items' checklist isn't published at all: held, named nofile, the kind every reader uses for what isn't there. */
  fs.rmSync(path.join(F.root, 'publications', 'validate-story'), { recursive: true });
  const g = json('spread', 'keep', F.root, PR, '--spread', F.spread, '--json', ...TOOL);
  assert.deepStrictEqual([g.code, g.data.status, ls(F.root).length], [4, 'held', n - 1], JSON.stringify(g));
  assert.ok(g.problems.some(x => x.path === 'publications/validate-story' && x.kind === 'nofile'), JSON.stringify(g.problems));
});

rule('A keep\'s source run is judged as runs judges it: its version unreadable, or a malformed run, holds every keep command with the path named', async () => {
  for (const how of ['pubread', 'details']) {
    const F = await folder(), n = ls(F.root).length, rf = path.join(F.root, 'runs', 'release-readiness', 'r-41', 'run.json');
    if (how === 'pubread') fs.chmodSync(path.join(F.root, 'publications', 'release-readiness', F.parent.info.folder, 'publication.json'), 0);
    else { const o = JSON.parse(fs.readFileSync(rf, 'utf8')); o.details = []; fs.writeFileSync(rf, JSON.stringify(o, null, 2)); }
    const runs = json('runs', F.root, '--contract', '2', '--json');
    assert.strictEqual(runs.code, 4, how + ': set-up: runs names it: ' + JSON.stringify(runs.problems));
    const where = how === 'pubread' ? 'publications/release-readiness/' : 'runs/release-readiness/r-41/';
    for (const args of [['todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--dry-run'], ['todo', 'keep', F.root, PR, '--todo', F.phaseTodo], ['spread', 'keep', F.root, PR, '--spread', F.spread]]) {
      const x = json(...args, '--json', ...TOOL);
      assert.deepStrictEqual([how, args[1], x.code, x.complete, ls(F.root).length], [how, args[1], 4, false, n], JSON.stringify([x.data, x.problems]));
      assert.ok((x.problems || []).some(q => q.path.indexOf(where) === 0), how + ': named: ' + JSON.stringify(x.problems));
    }
    if (how === 'pubread') fs.chmodSync(path.join(F.root, 'publications', 'release-readiness', F.parent.info.folder, 'publication.json'), 0o644);
  }
});

/* OD: every way the source run fails its checked read is named (path and kind) with exit 4, in preview and write; and the
   source is read and judged again right before the write, so one broken while proposals/ is read writes nothing. */
rule('A keep names every problem of its source run with exit 4, and judges the source again right before writing', async () => {
  const runsKind = (F) => json('runs', F.root, '--contract', '2', '--json');
  for (const how of ['malformed', 'unknown', 'newer', 'norun', 'snapshot']) {
    const F = await folder(), n = ls(F.root).length, rf = path.join(F.root, 'runs', 'release-readiness', 'r-41', 'run.json');
    const o = JSON.parse(fs.readFileSync(rf, 'utf8'));
    if (how === 'malformed') fs.writeFileSync(rf, '{ "format": ');
    if (how === 'unknown') { o.zzzUnknown = 1; fs.writeFileSync(rf, JSON.stringify(o, null, 2)); }
    if (how === 'newer') { o.format = 'preflight-run/99'; fs.writeFileSync(rf, JSON.stringify(o, null, 2)); }
    if (how === 'norun') { fs.writeFileSync(path.join(path.dirname(rf), 'notes.txt'), 'x'); fs.unlinkSync(rf); }
    if (how === 'snapshot') { o.snapshot = 42; fs.writeFileSync(rf, JSON.stringify(o, null, 2)); }
    const runs = runsKind(F), want = (runs.problems || []).filter(q => q.path.indexOf('runs/release-readiness/r-41/') === 0).map(q => q.kind);
    assert.ok(runs.code === 4 && want.length, how + ': set-up: runs names it: ' + JSON.stringify([runs.code, runs.problems]));
    const after = ls(F.root).length;
    for (const args of [['todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--dry-run'], ['todo', 'keep', F.root, PR, '--todo', F.phaseTodo], ['spread', 'keep', F.root, PR, '--spread', F.spread]]) {
      const x = json(...args, '--json', ...TOOL);
      assert.deepStrictEqual([how, args[1], x.code, x.complete, ls(F.root).length], [how, args[1], 4, false, after], JSON.stringify([x.error, x.problems]));
      assert.ok((x.problems || []).some(q => q.path.indexOf('runs/release-readiness/r-41/') === 0 && want.indexOf(q.kind) >= 0), how + ': named as runs names it: ' + JSON.stringify([x.problems, want]));
    }
    void n;
  }
  /* Broken while proposals/ is being read (after the first judgment): judged again at the write, nothing is written. */
  for (const how of ['run', 'pub']) {
    const F = await folder(), rf = path.join(F.root, 'runs', 'release-readiness', 'r-41', 'run.json'), pf = path.join(F.root, 'publications', 'release-readiness', F.parent.info.folder, 'publication.json');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-keep-hook-')), hook = path.join(dir, 'hook.js');
    fs.writeFileSync(hook, "const fs = require('fs'), open = fs.openSync, rd = fs.readdirSync; let done = false; const hit = (p) => { if (done || String(p).indexOf('/proposals') < 0) return; done = true; if (process.env.KEEP_HOW === 'run') fs.writeFileSync(process.env.KEEP_RUN, '{ broken'); else fs.chmodSync(process.env.KEEP_PUB, 0); };" +
      " fs.openSync = function (p) { hit(p); return open.apply(this, arguments); }; fs.readdirSync = function (p) { hit(p); return rd.apply(this, arguments); }; const pr = fs.promises, prd = pr.readdir, pop = pr.open, prf = pr.readFile; pr.readdir = function (p) { hit(p); return prd.apply(this, arguments); }; pr.open = function (p) { hit(p); return pop.apply(this, arguments); }; pr.readFile = function (p) { hit(p); return prf.apply(this, arguments); };");
    const before = fs.readdirSync(path.join(F.root, 'proposals')).length;
    let code = 0, text = '';
    try { text = execFileSync(process.execPath, ['-r', hook, BIN, 'todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--json', ...TOOL], { encoding: 'utf8', stdio: 'pipe', env: Object.assign({}, process.env, { KEEP_HOW: how, KEEP_RUN: rf, KEEP_PUB: pf }) }); } catch (e) { code = e.status; text = String(e.stdout); }
    if (how === 'pub') fs.chmodSync(pf, 0o644);
    const x = JSON.parse(text);
    assert.deepStrictEqual([how, code, x.complete, fs.readdirSync(path.join(F.root, 'proposals')).length], [how, 4, false, before], 'judged again at the write: ' + JSON.stringify([x.data && x.data.status, x.problems]));
    assert.ok((x.problems || []).some(q => q.path.indexOf(how === 'run' ? 'runs/release-readiness/r-41/' : 'publications/release-readiness/') === 0), how + ': named: ' + JSON.stringify(x.problems));
  }
});

/* QC: a spread keep's final check reads the checklist its items run again: broken after the first check (when the source run
   is read the second time, at the final check), nothing is written, with the path named and exit 4. */
rule('A spread keep reads the items\' checklist again at its final check: one made unreadable or deleted meanwhile writes nothing', async () => {
  for (const how of ['eacces', 'gone']) {
    const F = await folder(), pubDir = path.join(F.root, 'publications', 'validate-story', F.child.info.folder), pf = path.join(pubDir, 'publication.json');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-keep-hook-')), hook = path.join(dir, 'hook.js');
    fs.writeFileSync(hook, "const fs = require('fs'); let n = 0, done = false; const hit = (p) => { if (done || String(p).indexOf('/runs/release-readiness/r-41/run.json') < 0) return; if (++n < 2) return; done = true; if (process.env.KEEP_HOW === 'eacces') fs.chmodSync(process.env.KEEP_PUB, 0); else fs.rmSync(process.env.KEEP_DIR, { recursive: true }); };" +
      " for (const k of ['openSync', 'readFileSync']) { const o = fs[k]; fs[k] = function (p) { hit(p); return o.apply(this, arguments); }; } const pr = fs.promises; for (const k of ['open', 'readFile']) { const o = pr[k]; pr[k] = function (p) { hit(p); return o.apply(this, arguments); }; }");
    const before = ls(F.root).length;
    let code = 0, text = '';
    try { text = execFileSync(process.execPath, ['-r', hook, BIN, 'spread', 'keep', F.root, PR, '--spread', F.spread, '--json', ...TOOL], { encoding: 'utf8', stdio: 'pipe', env: Object.assign({}, process.env, { KEEP_HOW: how, KEEP_PUB: pf, KEEP_DIR: pubDir }) }); } catch (e) { code = e.status; text = String(e.stdout); }
    if (how === 'eacces' && fs.existsSync(pf)) fs.chmodSync(pf, 0o644);
    const x = JSON.parse(text);
    assert.deepStrictEqual([how, code, x.complete, ls(F.root).length], [how, 4, false, before], how + ': judged again at the final check: ' + JSON.stringify([x.data && x.data.status, x.problems]));
    assert.ok((x.problems || []).some(q => q.path.indexOf('publications/validate-story') === 0), how + ': named: ' + JSON.stringify(x.problems));
  }
});

/* CD: the final check reads proposals/ again after the source run and its checklists, and makes the keep again from that
   read: a 500th keep filed meanwhile at a place holding 499 refuses this one (naming the limit), and a copy of this keep that
   differs, or one that can't be read, added meanwhile, files nothing. */
rule('A keep\'s final check reads proposals/ again: a 500th keep, or a differing or torn copy of this keep, added meanwhile files nothing', async () => {
  const hookOf = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-keep-hook-')), hook = path.join(dir, 'hook.js');
    fs.writeFileSync(hook, "const fs = require('fs'), path = require('path'); let n = 0, done = false; const hit = (p) => { if (done || String(p).indexOf('/runs/release-readiness/r-41/run.json') < 0) return; if (++n < 2) return; done = true; const f = JSON.parse(process.env.KEEP_FILES); Object.keys(f).forEach((k) => fs.writeFileSync(path.join(process.env.KEEP_ROOT, 'proposals', k), f[k])); };" +
      " for (const k of ['openSync', 'readFileSync']) { const o = fs[k]; fs[k] = function (p) { hit(p); return o.apply(this, arguments); }; } const pr = fs.promises; for (const k of ['open', 'readFile']) { const o = pr[k]; pr[k] = function (p) { hit(p); return o.apply(this, arguments); }; }");
    return hook;
  };
  const keepWith = (F, files) => {
    let code = 0, text = '';
    try { text = execFileSync(process.execPath, ['-r', hookOf(), BIN, 'todo', 'keep', F.root, PR, '--todo', F.phaseTodo, '--json', ...TOOL], { encoding: 'utf8', stdio: 'pipe', env: Object.assign({}, process.env, { KEEP_ROOT: F.root, KEEP_FILES: JSON.stringify(files) }) }); } catch (e) { code = e.status; text = String(e.stdout); }
    return Object.assign(JSON.parse(text), { code });
  };
  /* What this keep would file, from a copy of the folder. */
  const fileOf = async (F) => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-keep-copy-')); fs.cpSync(F.root, copy, { recursive: true });
    const x = json('todo', 'keep', copy, PR, '--todo', F.phaseTodo, '--json', ...TOOL);
    assert.strictEqual(x.data.status, 'kept', 'set-up: it would be kept');
    return { id: x.data.keep.id, text: fs.readFileSync(path.join(copy, x.data.keep.file), 'utf8') };
  };
  for (const how of ['differs', 'torn'].filter((h) => !process.env.CD_CASE || process.env.CD_CASE.split(',').indexOf(h) >= 0)) {
    const F = await folder(), K = await fileOf(F), o = JSON.parse(K.text); o.reason = 'Another reason';
    const before = ls(F.root);
    const x = keepWith(F, { [K.id + ' (1).json']: how === 'differs' ? JSON.stringify(o, null, 2) + '\n' : '{ "format": ' });
    assert.ok(!fs.existsSync(path.join(F.root, 'proposals', K.id + '.json')), how + ': not filed: ' + JSON.stringify([x.code, x.data && x.data.status, x.error, x.problems]));
    assert.ok(x.code !== 0 && !(x.data && x.data.status === 'kept'), how + ': said so: ' + JSON.stringify([x.code, x.error]));
    assert.strictEqual(ls(F.root).length, before.length + 1, how + ': only the copy added meanwhile');
  }
  /* 499 keeps at its place, a 500th filed meanwhile: this one would be the 501st. */
  const F = await folder(), K = await fileOf(F), base = JSON.parse(K.text);
  const other = (i) => { const f = JSON.parse(JSON.stringify(base)); f.change.text = 'Wording ' + i; f.id = L.idFor(f.run, f.source, f.template || null, f.anchor || null, f.change.text); if (f.key) f.key = L.keyFor(f.run, f.source, f.template || null, f.anchor || null, f.change.text); const fd = T.filed(f.id + '.json', f); assert.ok(!fd.why, fd.why); return f; };
  for (let i = 1; i < 500; i++) { const f = other(i); fs.writeFileSync(path.join(F.root, 'proposals', f.id + '.json'), T.text(f)); }
  const last = other(500);
  const x = keepWith(F, { [last.id + '.json']: T.text(last) });
  assert.ok(!fs.existsSync(path.join(F.root, 'proposals', K.id + '.json')), '501st: not filed: ' + JSON.stringify([x.code, x.data && x.data.status, x.error]));
  assert.ok(x.code !== 0 && x.error && /500/.test(x.error.why), '501st: refused, naming the limit: ' + JSON.stringify([x.code, x.error]));
});

run();
