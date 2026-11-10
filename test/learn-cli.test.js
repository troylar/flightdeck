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
});

run();
