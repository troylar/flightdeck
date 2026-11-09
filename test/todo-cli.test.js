// flightdeck todo (4.0, docs/apps.md, docs/design.md 45): list a run's to-dos and requests, and ask for one change by
// writing exactly one request in proposals/, once. --dry-run and list write nothing; previews name the placement, the
// authority it needs, what it would send back for review and the recorder's queue; --as names who the tool asks for and
// never supplies a person's approval; the same --tool and --key is the same request.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { load, rule, run } = require('./harness');
const PF = load(), R = PF.run, T = PF.todos;
const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js');
const cli = (...a) => { try { return { out: execFileSync(process.execPath, [BIN, ...a], { encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (e) { return { out: String(e.stdout) + String(e.stderr), code: e.status }; } };
const json = (...a) => { const r = cli(...a); return Object.assign(JSON.parse(r.out), { code: r.code }); };
const AT = '2026-11-09T09:00:00.000Z';
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
const MD = ['---', 'process: release-notes', 'title: Release notes', 'roles: reviewer', 'context: kind:choice(minor|major)', '---', '',
  '## Draft · DO-CONFIRM {#draft}', '- [!] {confirm} Write the notes {#write}', '',
  '## Review · READ-DO {#review}', '- [!] {confirm} @reviewer Read them {#read}', ''].join('\n');
const people = [{ id: 'person-avery', name: 'Avery' }, { id: 'person-blake', name: 'Blake' }, { id: 'person-casey', name: 'Casey' }];
async function folder(md) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-todo-')), d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  const pr = await PF.repo.publish(d, md || MD, { people, by: 'person-avery', changes: 'First', existing: [], now: AT, app: '4.0.0' }); if (pr.blockers) throw new Error(JSON.stringify(pr.blockers));
  const all = await PF.repo.loadAll(d, {}), pub = all.processes.filter(p => p.process === 'release-notes')[0].index.latest;
  const r = R.create(pub, { id: 'r-1', by: 'person-avery', session: 'w', now: AT, app: '4.0.0', roles: { reviewer: 'person-blake' } });
  await d.write('runs/release-notes/r-1/run.json', JSON.stringify(r, null, 2));
  return { root, d };
}
/* A to-do the recorder (Avery) asked for and landed: a compound that is the run's living head. */
async function seed(d, r) {
  const RUN = { process: 'release-notes', id: 'r-1' }, id = T.idFor('flightdeck', 'seed'), map = R.mapOf(r);
  const body = { op: 'add', text: 'Seeded', target: { phase: 'draft' }, placement: T.placementFor(map, { phase: 'draft' }) }, b = Object.assign({ todo: T.todoIdFor(id) }, body), eff = T.effectOf(b);
  const C = T.consequenceOf(r, map, b, T.view(r, { records: [], people: { people } })).fingerprint;
  const c = T.buildProposal({ kind: 'compound', run: RUN, id, by: 'person-avery', seen: [], at: AT, body, decision: { by: 'person-avery', consequence: C }, application: { previous: '', effect: eff, fingerprint: T.fingerprint(eff) }, app: '4.0.0' });
  await d.write('proposals/' + id + '.json', T.text(c));
  r.living = { head: id }; r.features = PF.envelope.FROZEN.filter(f => r.features.concat(['living-runs']).indexOf(f) >= 0);
  await d.write('runs/release-notes/r-1/run.json', JSON.stringify(r, null, 2));
  return b.todo;
}
const ls = (root) => fs.existsSync(path.join(root, 'proposals')) ? fs.readdirSync(path.join(root, 'proposals')).sort() : [];
const snap = (root) => { const out = {}; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(root, p)] = fs.readFileSync(p, 'utf8'); }); walk(root); return out; };
const TOOL = ['--tool', 'notes-bot@1.2', '--key', 'k-1'];

rule('add --dry-run names the placement, the authority, what it sends back and the recorder; it and list write nothing', async () => {
  const { root } = await folder(), before = snap(root);
  const p = json('todo', 'add', root, 'release-notes/r-1', '--text', 'Check the screenshots', '--phase', 'draft', '--dry-run', '--json', ...TOOL);
  assert.strictEqual(p.code, 0, JSON.stringify(p));
  const d = p.data;
  assert.deepStrictEqual([d.status, d.request.id, d.request.file, d.placement, d.gate, d.authority.needs, d.consequence.reopens, d.consequence.releases, d.recorder, d.queue], ['would-request', T.idFor('notes-bot', 'k-1'), 'proposals/' + T.idFor('notes-bot', 'k-1') + '.json', { beforeGate: 'draft-confirm' }, d.gate, 'person', [], false, 'person-avery', 'Waiting for approval']);
  assert.ok(/\n\nAdd "Check the screenshots" before /.test(d.preview) && /preview only/.test(d.preview), d.preview);
  const text = cli('todo', 'add', root, 'release-notes/r-1', '--text', 'Check the screenshots', '--phase', 'draft', '--dry-run', ...TOOL);
  assert.strictEqual(text.code, 0); assert.ok(/Waiting for approval/.test(text.out), text.out);
  const l = json('todo', 'list', root, 'release-notes/r-1', '--json');
  assert.deepStrictEqual([l.code, l.data.todos, l.data.requests], [0, [], []]);
  assert.deepStrictEqual(snap(root), before, 'nothing written');
});
rule('A mutation writes exactly one request, once; the same key again is already; the key with other content is refused', async () => {
  const { root } = await folder();
  const a = json('todo', 'add', root, 'release-notes/r-1', '--text', 'One', '--phase', 'draft', '--json', ...TOOL);
  assert.deepStrictEqual([a.code, a.data.status, ls(root)], [0, 'requested', [T.idFor('notes-bot', 'k-1') + '.json']]);
  const f = JSON.parse(fs.readFileSync(path.join(root, 'proposals', ls(root)[0]), 'utf8'));
  assert.deepStrictEqual([f.format, f.kind, f.producer, f.key, f.text, f.target, f.by], ['flightdeck-plan/4', 'proposal', { name: 'notes-bot', version: '1.2' }, 'k-1', 'One', { phase: 'draft' }, undefined]);
  const again = json('todo', 'add', root, 'release-notes/r-1', '--text', 'One', '--phase', 'draft', '--json', '--tool', 'notes-bot@1.3', '--key', 'k-1');
  assert.deepStrictEqual([again.code, again.data.status, ls(root).length], [0, 'already', 1]);
  const other = json('todo', 'add', root, 'release-notes/r-1', '--text', 'Two', '--phase', 'draft', '--json', ...TOOL);
  assert.deepStrictEqual([other.code, other.error.kind, ls(root).length], [1, 'key-taken', 1]);
  assert.ok(/text/.test(other.error.why), other.error.why);
});
rule('--as names who the tool asks for, and never supplies a person\'s approval', async () => {
  const { root } = await folder();
  const a = json('todo', 'add', root, 'release-notes/r-1', '--text', 'For Avery', '--phase', 'draft', '--as', 'person-avery', '--json', ...TOOL);
  assert.strictEqual(a.code, 0, JSON.stringify(a));
  const f = JSON.parse(fs.readFileSync(path.join(root, 'proposals', ls(root)[0]), 'utf8'));
  assert.deepStrictEqual([f.kind, f.requester, f.decision, a.data.queue], ['proposal', 'person-avery', undefined, 'Waiting for approval']);
  assert.strictEqual(ls(root).length, 1, 'no decision written');
});
rule('done, wont, move and reopen ask for an existing to-do; wont needs a reason, move a destination; list shows them', async () => {
  const { root, d } = await folder();
  const r = JSON.parse(fs.readFileSync(path.join(root, 'runs/release-notes/r-1/run.json'), 'utf8'));
  const todo = await seed(d, r);
  const l = json('todo', 'list', root, 'release-notes/r-1', '--json');
  assert.strictEqual(l.code, 0, JSON.stringify(l));
  assert.deepStrictEqual(l.data.todos.map(x => [x.id, x.text, x.state, x.beforeGate]), [[todo, 'Seeded', 'open', 'draft-confirm']]);
  const w0 = json('todo', 'wont', root, 'release-notes/r-1', '--todo', todo, '--json', '--tool', 'notes-bot@1.2', '--key', 'w-0');
  assert.deepStrictEqual([w0.code, ls(root).length], [1, 1]); assert.ok(/why/.test(w0.error.why));
  const w = json('todo', 'wont', root, 'release-notes/r-1', '--todo', todo, '--reason', 'Covered', '--dry-run', '--json', '--tool', 'notes-bot@1.2', '--key', 'w-1');
  assert.deepStrictEqual([w.code, w.data.consequence.releases, w.data.authority.needs], [0, true, 'person']);
  const m0 = json('todo', 'move', root, 'release-notes/r-1', '--todo', todo, '--to', 'release-notes/r-1', '--json', '--tool', 'notes-bot@1.2', '--key', 'm-0');
  assert.strictEqual(m0.code, 1); assert.ok(/this run/.test(m0.error.why), m0.error.why);
  const m = json('todo', 'move', root, 'release-notes/r-1', '--todo', todo, '--to', 'ABC-12', '--json', '--tool', 'notes-bot@1.2', '--key', 'm-1');
  assert.deepStrictEqual([m.code, m.data.status], [0, 'requested']);
  const ro = json('todo', 'reopen', root, 'release-notes/r-1', '--todo', todo, '--dry-run', '--json', '--tool', 'notes-bot@1.2', '--key', 'r-1');
  assert.strictEqual(ro.code, 1); assert.ok(/already open/.test(ro.error.why));
  const dn = json('todo', 'done', root, 'release-notes/r-1', '--todo', todo, '--dry-run', '--json', '--tool', 'notes-bot@1.2', '--key', 'd-1');
  assert.deepStrictEqual([dn.code, dn.data.status], [0, 'would-request']);
  const l2 = json('todo', 'list', root, 'release-notes/r-1', '--json');
  assert.deepStrictEqual(l2.data.requests.map(x => [x.op, x.status]), [['add', 'applied'], ['move', 'waiting']]);
});
rule('list says when an applied request was decided two ways and that a person settles it in the app', async () => {
  const { root, d } = await folder();
  const r = JSON.parse(fs.readFileSync(path.join(root, 'runs/release-notes/r-1/run.json'), 'utf8'));
  const todo = await seed(d, r), RUN = { process: 'release-notes', id: 'r-1' }, head = r.living.head;
  const clean = (f, name) => T.cleanFile(JSON.parse(T.text(f)), name).record;
  const q = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'ah-1'), by: 'person-casey', seen: [head], at: AT, body: { op: 'done', todo }, app: '4.0.0' });
  await d.write('proposals/' + q.id + '.json', T.text(q));
  const all = await PF.repo.loadAll(d, {}), V = T.view(R.sanitize(r), { records: all.todos, people: { people } }), C = T.consequenceOf(R.sanitize(r), V.map, V.requests[q.id], V).fingerprint;
  const st = (o) => { const s = T.buildStatus(Object.assign({ run: RUN, at: AT, app: '4.0.0' }, o)); return d.write('proposals/' + s.name, T.text(s.file)).then(() => clean(s.file, s.name)); };
  const yes = await st({ kind: 'decision', proposal: q.id, seen: [q.id], by: 'person-avery', op: 'accept', consequence: C, writer: 'wa', rev: '00000001' });
  await st({ kind: 'decision', proposal: q.id, seen: [q.id], by: 'person-blake', op: 'decline', consequence: C, writer: 'wb', rev: '00000002' });
  const ql = clean(q, q.id + '.json'), a = await st({ kind: 'application', proposal: q.id, seen: [q.id, head, yes.id], by: 'person-avery', authority: { decision: yes.id }, previous: head, effect: T.effectOf(ql), writer: 'rec', rev: '00000003' });
  r.living = { head: a.id }; await d.write('runs/release-notes/r-1/run.json', JSON.stringify(r, null, 2));
  const l = json('todo', 'list', root, 'release-notes/r-1', '--json'), x = l.data.requests.filter(y => y.id === q.id)[0];
  assert.deepStrictEqual([l.code, x.status], [0, 'applied'], JSON.stringify(l.data.requests));
  assert.ok(/at once/.test(x.why) && /settles/.test(x.why), x.why);
  assert.ok(new RegExp(q.id + ' · done · Applied: .*settles').test(cli('todo', 'list', root, 'release-notes/r-1').out));
});
rule('run, next and runs (contract 2) list a living run\'s to-dos and say what holds its gate, as every window does', async () => {
  const { root, d } = await folder();
  const r = JSON.parse(fs.readFileSync(path.join(root, 'runs/release-notes/r-1/run.json'), 'utf8')), todo = await seed(d, r);
  const one = json('run', root, 'release-notes/r-1', '--contract', '2', '--json');
  assert.strictEqual(one.code, 0, JSON.stringify(one).slice(0, 600));
  const x = one.data.run;
  assert.deepStrictEqual(x.todos.map(t => [t.id, t.text, t.state, t.beforeGate, t.gate]), [[todo, 'Seeded', 'open', 'draft-confirm', x.gates[0].title]]);
  assert.deepStrictEqual([x.todoCounts.open, x.todoCounts.total, x.todoCounts.waiting, x.todoCounts.held], [1, 1, 0, false]);
  /* The app's own reading of the same folder: the same holds, word for word. */
  const all = await PF.repo.loadAll(d, {}), ar = all.runs.find(y => y.id === 'r-1');
  T.markHolds([ar], { records: all.todos, unread: all.todosUnread, people: all.people });
  assert.deepStrictEqual(x.todoHolds, JSON.parse(JSON.stringify(R.phaseHeld(ar, R.mapOf(ar), 0))));
  assert.ok(x.todoHolds.length >= 1, JSON.stringify(x.todoHolds));
  const n = json('next', root, 'release-notes/r-1', '--as', 'person-avery', '--contract', '2', '--json');
  assert.strictEqual(n.code, 0, JSON.stringify(n).slice(0, 600));
  assert.deepStrictEqual([n.data.todos.open, n.data.todos.holds], [1, x.todoHolds]);
  const rs = json('runs', root, '--contract', '2', '--json');
  assert.deepStrictEqual(rs.data.runs.find(y => y.id === 'r-1').todoCounts, x.todoCounts);
  /* A run with no to-dos prints none of these fields. */
  const { root: r2 } = await folder(), plain = json('run', r2, 'release-notes/r-1', '--contract', '2', '--json').data.run;
  assert.deepStrictEqual(['todos', 'todoCounts', 'todoHolds'].filter(k => k in plain), []);
});
rule('A run/2 with no to-dos yet is still held by a to-do record of it that can\'t be read, as every window holds it', async () => {
  const { root, d } = await folder(MD.replace('context: kind:choice(minor|major)\n', ''));
  const r = JSON.parse(fs.readFileSync(path.join(root, 'runs/release-notes/r-1/run.json'), 'utf8')), map = R.mapOf(R.sanitize(r));
  assert.strictEqual(r.format, R.FORMAT, 'set-up: a run/2');
  R.done(r, map, 'write', 'person-avery', AT); await d.write('runs/release-notes/r-1/run.json', JSON.stringify(r, null, 2));
  const bad = T.idFor('notes-bot', 'bad') + '.json';
  await d.write('proposals/' + bad, JSON.stringify({ format: T.FORMAT, features: ['living-runs'], kind: 'proposal', run: { process: 'release-notes', id: 'r-1' } }));
  const all = await PF.repo.loadAll(d, {}), ar = all.runs.find(y => y.id === 'r-1');
  T.markHolds([ar], { records: all.todos, unread: all.todosUnread, people: all.people });
  assert.strictEqual(R.canPass(ar, R.mapOf(ar), 0), false, 'set-up: the app holds the gate');
  const one = json('run', root, 'release-notes/r-1', '--contract', '2', '--json');
  assert.ok(one.problems.some(p => p.path === 'proposals/' + bad && p.kind === 'malformed'), 'named: ' + JSON.stringify(one.problems));
  assert.strictEqual(one.complete, false);
  assert.notStrictEqual(one.code, 0);
  assert.deepStrictEqual(['todos', 'todoCounts', 'todoHolds'].filter(k => k in one.data.run), [], 'not living: no to-do fields');
  const n = json('next', root, 'release-notes/r-1', '--as', 'person-avery', '--contract', '2', '--json');
  assert.ok(n.problems.some(p => p.path === 'proposals/' + bad), 'next names it too');
  assert.ok(!('todos' in n.data), 'and prints no to-do fields');
});
rule('Usage, an unknown run, a run that ended and a folder part that can\'t be read write nothing', async () => {
  const { root } = await folder();
  assert.strictEqual(json('todo', 'add', root, 'release-notes/r-1', '--text', 'x', '--phase', 'draft', '--json').code, 1, 'no --tool');
  assert.strictEqual(json('todo', 'add', root, 'release-notes/r-1', '--text', 'x', '--json', ...TOOL).code, 1, 'no target');
  assert.strictEqual(json('todo', 'add', root, 'release-notes/nope', '--text', 'x', '--phase', 'draft', '--json', ...TOOL).code, 5);
  assert.strictEqual(json('todo', 'explode', root, 'release-notes/r-1', '--json').code, 1);
  fs.writeFileSync(path.join(root, 'proposals-x'), '');
  fs.mkdirSync(path.join(root, 'proposals'), { recursive: true });
  fs.writeFileSync(path.join(root, 'proposals', T.idFor('notes-bot', 'zz') + '.json'), '{"format":"flightdeck-plan/4","features":["living-runs"],');
  const h = json('todo', 'add', root, 'release-notes/r-1', '--text', 'x', '--phase', 'draft', '--json', ...TOOL);
  assert.deepStrictEqual([h.code, h.data && h.data.status], [4, 'held']);
  assert.deepStrictEqual(ls(root), [T.idFor('notes-bot', 'zz') + '.json'], 'nothing written');
});
run();
