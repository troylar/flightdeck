// The folder a spread is tested in, shared by the spread command's tests (test/spread-cli.test.js) and its dependency
// matrix (test/spread-deps.test.js): a parent run with a loop over stories, its children's runs, the loop's scope as
// `loop sync` files it, and the spread asked, decided and landed as every window does it.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { load } = require('./harness');
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
async function read(d) {
  const all = await PF.repo.loadAll(d, {}), procOf = (id) => { const e = (all.processes || []).filter(p => p.process === id)[0], i = e && e.index; return i ? { latest: i.latest, all: i.all || [], clashes: i.clashes || [], broken: i.broken || [] } : null; };
  /* loops and runs: what a stop is checked against when it is decided and applied. */
  return { runs: all.runs, records: all.todos || [], unread: all.todosUnread || [], loops: { records: all.scopes || [], unread: all.scopesUnread || [], procOf } };
}
/* A person decides every request on a run that waits for them, each a decision of its own. */
async function decideAll(d, key, by, op) {
  const W = await read(d), x = W.runs.find(y => y.process + '/' + y.id === key), its = T.inbox([x], { records: W.records, unread: W.unread, people: PEOPLE, me: by });
  for (const it of its) {
    const dd = T.decide(x, { request: it.id, op: op || 'accept', by, shown: it.consequence.fingerprint, records: W.records, unread: W.unread, people: PEOPLE, at: AT, writer: 'w' + hex(), rev: hex(), app: '4.0.0', loops: W.loops, runs: W.runs });
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
    const plan = T.applyPlan(x, V, q, { records: W.records, unread: W.unread, people: PEOPLE, loops: W.loops, runs: W.runs });
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

module.exports = { PF, BIN, cli, json, AT, DiskFS, CHILD, PARENT, people, PEOPLE, obs, PR, hex, folder, ls, snap, runFile, read, decideAll, land, TOOL, ADD, spread };
