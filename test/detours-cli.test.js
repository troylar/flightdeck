// flightdeck todo add --checklist and todo suggest-done --evidence-run (4.0, docs/apps.md, docs/design.md 45.4): a to-do
// that a run of another checklist settles. add pins that checklist's exact version and the results it accepts, or refuses
// (a pin that can't be read holds, exit 4, named). suggest-done --evidence-run asks for the to-do done on one run its plan
// started: named by that evidence (no --key), so asking again is already; it waits for a person like any done, and a run
// that can't be read holds it (exit 4) with the path named. --dry-run writes nothing; run.json is never written.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { load, rule, run } = require('./harness');
const PF = load(), R = PF.run, T = PF.todos, D = PF.detours;
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
const SMOKE = ['---', 'process: smoke-test', 'title: Smoke test', 'owner: person-avery', 'context: verdict:choice(pass|fail)', 'result: verdict', '---', '',
  '## Test · DO-CONFIRM {#test}', '- [!] {confirm} Run the smoke suite {#suite}', '- [!] {decide} Record the result {#call}', '  options: pass, fail', '  sets: verdict=decision', ''].join('\n');
const PARENT = ['---', 'process: release-readiness', 'title: Release 4.1', 'owner: person-morgan', '---', '', '## Ship · READ-DO {#ship}', '- [!] {confirm} Ship it {#ship1}', ''].join('\n');
const people = [{ id: 'person-morgan', name: 'Morgan' }, { id: 'person-avery', name: 'Avery' }];
const PEOPLE = { people };
const PR = 'release-readiness/r-41', TOOL = ['--tool', 'release-helper@1.4.0'];
let seq = 0; const hex = () => (++seq).toString(16).padStart(8, '0');
const ls = (root) => fs.existsSync(path.join(root, 'proposals')) ? fs.readdirSync(path.join(root, 'proposals')).filter(n => n[0] !== '.').sort() : [];
const snap = (root) => { const out = {}; const walk = (x) => fs.readdirSync(x, { withFileTypes: true }).forEach(e => { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else out[path.relative(root, p)] = fs.readFileSync(p, 'utf8'); }); walk(root); return out; };
const runFile = (root, key) => path.join(root, 'runs', key, 'run.json');
async function read(d) { const all = await PF.repo.loadAll(d, {}); return { runs: all.runs, records: all.todos || [], unread: all.todosUnread || [], ev: { runs: all.runs, plans: all.plans } }; }
async function decideAll(d, key, by) {
  const W = await read(d), x = W.runs.find(y => y.process + '/' + y.id === key), its = T.inbox([x], { records: W.records, unread: W.unread, people: PEOPLE, me: by, evidence: W.ev });
  for (const it of its) {
    const dd = T.decide(x, { request: it.id, op: 'accept', by, shown: it.consequence.fingerprint, records: W.records, unread: W.unread, people: PEOPLE, at: AT, writer: 'w' + hex(), rev: hex(), app: '4.0.0', evidence: W.ev });
    assert.ok(!dd.why, dd.why);
    await d.write('proposals/' + dd.name, T.text(dd.file)); W.records.push(Object.assign(dd.record, { _file: dd.name }));
  }
}
async function land(d, key) {
  const raw = JSON.parse(fs.readFileSync(runFile(d.root, key), 'utf8')), rec = raw.recorder && raw.recorder.person;
  for (let i = 0; i < 100; i++) {
    const W = await read(d), x = W.runs.find(y => y.process + '/' + y.id === key), V = T.view(x, { records: W.records, unread: W.unread, people: PEOPLE, evidence: W.ev }), q = T.nextQueued(V);
    if (!q) break;
    const plan = T.applyPlan(x, V, q);
    if (plan.adopt) raw.living = { head: plan.adopt.id };
    else {
      assert.ok(plan.write, JSON.stringify(plan));
      const s = T.buildStatus(Object.assign({}, plan.write, { by: rec, at: AT, writer: 'rec', rev: hex(), app: '4.0.0' }));
      await d.write('proposals/' + s.name, T.text(s.file));
      raw.living = { head: s.file.id || T.filed(s.name, s.file).record.id };
    }
    if ((raw.features || []).indexOf('living-runs') < 0) raw.features = PF.envelope.FROZEN.filter(f => (raw.features || []).concat(['living-runs']).indexOf(f) >= 0);
    fs.writeFileSync(runFile(d.root, key), JSON.stringify(raw, null, 2));
  }
}
/* A release run and a smoke-test checklist, published. */
async function folder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-detour-')), d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  await PF.repo.publish(d, SMOKE, { people, by: 'person-avery', changes: 'First', existing: [], now: AT, app: '4.0.0' });
  let all = await PF.repo.loadAll(d, {});
  await PF.repo.publish(d, PARENT, { people, by: 'person-morgan', changes: 'First', existing: [], now: AT, app: '4.0.0', processes: all.processes });
  all = await PF.repo.loadAll(d, {});
  const pubOf = (id) => all.processes.filter(p => p.process === id)[0].index.latest, pp = pubOf('release-readiness'), kp = pubOf('smoke-test');
  const r = R.create(pp, { id: 'r-41', by: 'person-morgan', session: 'w', now: AT, app: '4.0.0', explicit: true });
  r.recorder = { person: 'person-morgan' };
  await d.write('runs/release-readiness/r-41/run.json', JSON.stringify(r, null, 2));
  return { root, d, kp, pp, pin: 'smoke-test@' + kp.info.folder };
}
/* A linked to-do, landed; its plan; a run started on it (the plan's started decision names it); completed with verdict. */
async function linked(F, accepts) {
  const a = json('todo', 'add', F.root, PR, '--key', 't-1', '--text', 'Smoke test the build', '--phase', 'ship', '--checklist', F.pin, ...(accepts ? ['--accepts', accepts] : []), '--json', ...TOOL);
  assert.strictEqual(a.code, 0, JSON.stringify(a));
  await decideAll(F.d, PR, 'person-morgan'); await land(F.d, PR);
  const W = await read(F.d), r = W.runs.find(y => y.id === 'r-41'), x = T.view(r, { records: W.records, unread: W.unread, people: PEOPLE }).byTodo[a.data.todo];
  return { todo: x.id, x, r };
}
async function started(F, L, id, verdict) {
  const P = D.planFor(L.r, L.x, F.kp, { by: 'person-avery', at: AT, app: '4.0.0' }).plan, f = 'proposals/' + P.id + '.json';
  if (!fs.existsSync(path.join(F.root, f))) await F.d.write(f, JSON.stringify(P, null, 2) + '\n');
  const g = PF.repo.groupPlans([Object.assign({}, P, { _file: P.id + '.json' })], [], [])[0];
  await F.d.write('proposals/' + P.id + '.status-s' + id + '-d.json', JSON.stringify(PF.plans.decision(g, 'accepted', id, 'person-avery', AT, null, '4.0.0'), null, 2));
  const c = R.create(F.kp, { id, by: 'person-avery', session: 'w2', now: AT, app: '4.0.0' });
  if (verdict) { const m = R.mapOf(c); R.done(c, m, 'suite', 'person-avery', AT); R.done(c, m, 'call', 'person-avery', AT, { decision: verdict }); R.pass(c, m, 0, 'person-avery', AT); R.end(c, m, 'Completed', 'person-avery', 'Avery', AT); }
  await F.d.write('runs/smoke-test/' + id + '/run.json', JSON.stringify(c, null, 2));
  return { plan: P, run: c };
}

rule('todo add --checklist pins the exact version and the results it accepts; a pin that can\'t be made is refused, and one that can\'t be read holds', async () => {
  const F = await folder();
  const p = json('todo', 'add', F.root, PR, '--key', 't-1', '--text', 'Smoke test the build', '--phase', 'ship', '--checklist', F.pin, '--accepts', 'pass', '--dry-run', '--json', ...TOOL);
  assert.strictEqual(p.code, 0, JSON.stringify(p));
  assert.deepStrictEqual([p.data.status, p.data.checklist], ['would-request', { process: 'smoke-test', folder: F.kp.info.folder, version: 1, mapHash: F.kp.info.mapHash, typesHash: F.kp.info.typesHash, accepts: ['pass'] }]);
  assert.ok(/settled by a run of smoke-test v1 that returns pass/.test(p.data.preview), p.data.preview);
  assert.deepStrictEqual(ls(F.root), [], 'a preview writes nothing');
  const a = json('todo', 'add', F.root, PR, '--key', 't-1', '--text', 'Smoke test the build', '--phase', 'ship', '--checklist', F.pin, '--accepts', 'pass', '--json', ...TOOL);
  assert.deepStrictEqual([a.code, a.data.status], [0, 'requested']);
  const f = JSON.parse(fs.readFileSync(path.join(F.root, a.data.request.file), 'utf8'));
  assert.deepStrictEqual(f.checklist, p.data.checklist);
  assert.strictEqual(json('todo', 'add', F.root, PR, '--key', 't-1', '--text', 'Smoke test the build', '--phase', 'ship', '--checklist', F.pin, '--accepts', 'pass', '--json', ...TOOL).data.status, 'already');
  const moved = json('todo', 'add', F.root, PR, '--key', 't-1', '--text', 'Smoke test the build', '--phase', 'ship', '--checklist', F.pin, '--json', ...TOOL);
  assert.deepStrictEqual([moved.code, moved.error.kind, /checklist/.test(moved.error.why)], [1, 'key-taken', true], moved.error && moved.error.why);
  const bad = (args, kind, re) => { const x = json('todo', 'add', F.root, PR, '--key', 'k-' + hex(), '--text', 'x', '--phase', 'ship', ...args, '--json', ...TOOL); assert.deepStrictEqual([x.code, x.error && x.error.kind], [1, kind], JSON.stringify(x)); assert.ok(re.test(x.error.why), x.error.why); };
  bad(['--checklist', 'nope@' + F.kp.info.folder], 'invalid', /no checklist nope/);
  bad(['--checklist', 'smoke-test@v9-zzzzzzzz'], 'invalid', /no version v9-zzzzzzzz/);
  bad(['--checklist', F.pin, '--accepts', 'pass,maybe'], 'invalid', /never returns maybe/);
  bad(['--checklist', 'smoke-test'], 'usage', /<process>@<version folder>/);
  bad(['--accepts', 'pass'], 'usage', /--accepts goes with --checklist/);
  const dn = json('todo', 'done', F.root, PR, '--key', 'k-x', '--todo', 'td-' + '0'.repeat(24), '--checklist', F.pin, '--json', ...TOOL);
  assert.deepStrictEqual([dn.code, dn.error.kind], [1, 'usage']);
  fs.writeFileSync(path.join(F.root, 'publications', 'smoke-test', F.kp.info.folder, 'map.md'), 'damaged');
  const held = json('todo', 'add', F.root, PR, '--key', 'k-held', '--text', 'x', '--phase', 'ship', '--checklist', F.pin, '--json', ...TOOL);
  assert.deepStrictEqual([held.code, held.data.status], [4, 'held'], JSON.stringify(held));
  assert.ok(held.problems.some(q => q.path.indexOf('publications/smoke-test/' + F.kp.info.folder) === 0), JSON.stringify(held.problems));
  assert.ok(!ls(F.root).some(n => n.indexOf(PF.todos.idFor('release-helper', 'k-held')) === 0), 'nothing written');
});

rule('suggest-done --evidence-run asks for the to-do done on one started run, named by its evidence; it waits for a person, and again is already', async () => {
  const F = await folder(), L = await linked(F, 'pass');
  const none = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k1', '--json', ...TOOL);
  assert.deepStrictEqual([none.code, none.error && none.error.kind], [1, 'invalid'], JSON.stringify(none));
  assert.ok(/No run of smoke-test was started/.test(none.error.why), none.error.why);
  await started(F, L, 'k1', 'pass');
  const runBefore = fs.readFileSync(runFile(F.root, PR), 'utf8');
  const p = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k1', '--dry-run', '--json', ...TOOL);
  assert.deepStrictEqual([p.code, p.data.status, p.data.evidence.run, p.data.evidence.result], [0, 'would-request', { process: 'smoke-test', id: 'k1' }, 'pass'], JSON.stringify(p));
  const s = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k1', '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data.status, s.data.authority.needs, /^req-evidence-[0-9a-f]{24}$/.test(s.data.request.id)], [0, 'requested', 'person', true], JSON.stringify(s));
  const n = ls(F.root).length;
  const again = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k1', '--json', '--tool', 'other-bot@2.0');
  assert.deepStrictEqual([again.code, again.data.status, ls(F.root).length], [0, 'already', n]);
  const l = json('todo', 'list', F.root, PR, '--json');
  assert.deepStrictEqual([l.code, l.data.todos[0].state, l.data.requests.filter(q => q.id === s.data.request.id)[0].status], [0, 'open', 'waiting'], 'never checked off on its own');
  assert.strictEqual(fs.readFileSync(runFile(F.root, PR), 'utf8'), runBefore, 'run.json never written');
  const both = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k1', '--fact', 'req-x-' + '0'.repeat(24), '--json', ...TOOL);
  assert.deepStrictEqual([both.code, both.error.kind], [1, 'usage']);
  const keyed = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k1', '--key', 'k1', '--json', ...TOOL);
  assert.deepStrictEqual([keyed.code, keyed.error.kind], [1, 'usage']);
});

rule('suggest-done --evidence-run refuses a result the to-do doesn\'t accept and a run that wasn\'t started for it; competing starts are chosen by naming one', async () => {
  const F = await folder(), L = await linked(F, 'pass');
  await started(F, L, 'k1', 'fail');
  const f = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k1', '--json', ...TOOL);
  assert.deepStrictEqual([f.code, f.error && f.error.kind], [1, 'invalid']);
  assert.ok(/returned fail; this to-do accepts pass/.test(f.error.why), f.error.why);
  await started(F, L, 'k2', 'pass');
  const s = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k2', '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data.status, s.data.evidence.run.id], [0, 'requested', 'k2'], JSON.stringify(s));
  const c = R.create(F.kp, { id: 'k9', by: 'person-avery', session: 'w3', now: AT, app: '4.0.0' });
  await F.d.write('runs/smoke-test/k9/run.json', JSON.stringify(c, null, 2));
  const o = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k9', '--json', ...TOOL);
  assert.ok(o.code === 1 && /wasn't started for this to-do/.test(o.error.why), JSON.stringify(o));
});

rule('A run it rests on that can\'t be read holds the ask and the request (exit 4), named by its path; a change to it after landing is said', async () => {
  const F = await folder(), L = await linked(F);
  const S = await started(F, L, 'k1', 'pass');
  const s = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k1', '--json', ...TOOL);
  assert.strictEqual(s.code, 0, JSON.stringify(s));
  await decideAll(F.d, PR, 'person-morgan'); await land(F.d, PR);
  let l = json('todo', 'list', F.root, PR, '--json');
  const t = l.data.todos[0];
  assert.deepStrictEqual([l.code, t.state, t.checklist && t.checklist.process, t.provenance], [0, 'done', 'smoke-test', null], JSON.stringify(t));
  const c = S.run; c.steps.call.at = '2026-11-10T12:00:00.000Z'; c.steps.call.values.decision = 'fail'; c.details.verdict = 'fail'; c.ended.at = '2026-11-10T12:00:00.000Z';
  fs.writeFileSync(runFile(F.root, 'smoke-test/k1'), JSON.stringify(c, null, 2));
  l = json('todo', 'list', F.root, PR, '--json');
  assert.ok(/changed since: it returned fail \(was pass\)/.test(l.data.todos[0].provenance), JSON.stringify(l.data.todos[0]));
  assert.strictEqual(l.data.todos[0].state, 'done', 'never reopened by itself');
  const F2 = await folder(), L2 = await linked(F2);
  await started(F2, L2, 'k1', 'pass');
  fs.writeFileSync(runFile(F2.root, 'smoke-test/k1'), '{ torn');
  const h = json('todo', 'suggest-done', F2.root, PR, '--todo', L2.todo, '--evidence-run', 'smoke-test/k1', '--json', ...TOOL);
  assert.deepStrictEqual([h.code, h.data && h.data.status], [4, 'held'], JSON.stringify(h));
  assert.ok(h.problems.some(q => q.path === 'runs/smoke-test/k1/run.json'), JSON.stringify(h.problems));
});

rule('Evidence a pending request rests on, missing or unreadable, is every reader\'s problem: named by path and kind, incomplete, exit 4', async () => {
  for (const how of ['missing', 'malformed']) {
    const F = await folder(), L = await linked(F, 'pass');
    await started(F, L, 'k1', 'pass');
    const s = json('todo', 'suggest-done', F.root, PR, '--todo', L.todo, '--evidence-run', 'smoke-test/k1', '--json', ...TOOL);
    assert.strictEqual(s.code, 0, JSON.stringify(s));
    const ok = json('run', F.root, PR, '--contract', '2', '--json');
    assert.deepStrictEqual([ok.code, ok.complete], [0, true], 'set-up: readable evidence is no problem: ' + JSON.stringify(ok.problems));
    if (how === 'missing') fs.rmSync(path.join(F.root, 'runs', 'smoke-test', 'k1'), { recursive: true });
    else fs.writeFileSync(runFile(F.root, 'smoke-test/k1'), '{ torn');
    const readers = { run: json('run', F.root, PR, '--contract', '2', '--json'), next: json('next', F.root, PR, '--contract', '2', '--json'), 'todo list': json('todo', 'list', F.root, PR, '--json') };
    if (how === 'missing') readers.runs = json('runs', F.root, '--contract', '2', '--json');
    Object.keys(readers).forEach((k) => {
      const x = readers[k], hit = (x.problems || []).filter(q => q.path === 'runs/smoke-test/k1/run.json');
      assert.deepStrictEqual([k, how, x.code, x.complete, hit.length === 1 && hit[0].kind === how], [k, how, 4, false, true], k + ' (' + how + '): ' + JSON.stringify(x.problems));
    });
  }
});

run();
