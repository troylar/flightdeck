// The assistants' folder checker (example-folder/.flightdeck/skills/_flightdeck/check_folder.py) must agree with the app.
// Builds a real folder on disk with the app's own code, then compares the checker's verdicts with loadAll's.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { load, example, exampleSetup, rule, run } = require('./harness');
const PF = load(), repo = PF.repo;
const EX = exampleSetup(PF);
const NOW = '2026-10-17T21:00:00.000Z';
const people = JSON.parse(example('people.json'));
const CHECKER = path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py');

class DiskFS {
  constructor(root) { this.root = root; this.kind = 'folder'; this.name = path.basename(root); }
  p(rel) { return path.join(this.root, ...rel.split('/')); }
  list(rel) { const d = rel ? this.p(rel) : this.root; return Promise.resolve(fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).map(e => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' })) : []); }
  read(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) ? { text: fs.readFileSync(f, 'utf8'), mtime: fs.statSync(f).mtimeMs } : null); }
  stat(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) ? { size: fs.statSync(f).size, mtime: fs.statSync(f).mtimeMs } : null); }
  blob(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) ? new Blob([fs.readFileSync(f)]) : null); }
  write(rel, data) {
    const f = this.p(rel); fs.mkdirSync(path.dirname(f), { recursive: true });
    if (typeof data === 'string') { fs.writeFileSync(f, data); return Promise.resolve(); }
    return data.arrayBuffer().then(b => fs.writeFileSync(f, Buffer.from(b)));
  }
  append(rel, text) { const f = this.p(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, text); return Promise.resolve(); }
  remove(rel) { fs.unlinkSync(this.p(rel)); return Promise.resolve(); }
}

function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* try next */ } } return null; }

rule('The assistants\' folder checker agrees with the app on complete, damaged and syncing versions, plans and conflicts', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-check-'));
  const d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  await d.write('images/release/job.png', new Blob([Buffer.from([0, 255, 128, 7, 1, 2, 3])], { type: 'image/png' }));
  const md = example('maps/drafts/release.md').replace('{#merge}', '{#merge}\n  ![Le travail — déployé ✓](images/release/job.png)');
  const v1 = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'Première version — ✓', existing: [], now: NOW });
  assert.ok(!v1.blockers, String(v1.blockers));
  const v2 = await repo.publish(d, md + '\n', { people, ...EX, by: 'person-avery', changes: 'Second', existing: [{ version: 1 }], now: NOW });
  fs.appendFileSync(path.join(root, 'publications', 'release', v2.folder, 'map.md'), 'edited by hand');
  await d.write('proposals/plan-a.json', JSON.stringify({ kind: 'plan', id: 'plan-a', process: 'release', version: 1, title: 'Release — ünïcode', details: { ticket: 'ABC-1' }, roles: {} }, null, 2));
  await d.write('proposals/plan-b.json', JSON.stringify({ kind: 'plan', id: 'plan-b', process: 'release', version: 1, title: 'Second plan', details: {}, roles: {} }));
  const loaded = await repo.loadAll(d);
  await repo.recordPlanStatus(d, loaded.plans.find(p => p.id === 'plan-a'), 'w1', 'accepted', null, 'person-casey');
  await d.write('runs/release/r1/run.json', '{}'); await d.write('runs/release/r1/run-PC (1).json', '{}');

  const app = await repo.loadAll(d, { deep: true });
  const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  const pubs = out.publications.release.versions;
  for (const pub of app.processes[0].pubs) {
    const mine = pubs.find(v => v.folder === pub.folder);
    assert.strictEqual(mine.status === 'complete', !!pub.ok, pub.folder + ': app says ' + pub.ok + ', checker says ' + mine.status + ' ' + mine.why);
  }
  assert.strictEqual(out.publications.release.current, v1.folder);
  assert.deepStrictEqual(out.plans.map(p => p.id + ':' + p.status), ['plan-a:decided', 'plan-b:pending']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(app.plans.map(p => p.id + ':' + !!p._status).sort())), ['plan-a:true', 'plan-b:false']);
  assert.deepStrictEqual(out.conflicts, [{ run: 'release/r1', copies: ['run-PC (1).json'] }]);

  // Change plan-a after the decision: both say it's no longer decided.
  const pa = JSON.parse(fs.readFileSync(path.join(root, 'proposals/plan-a.json'), 'utf8')); pa.title = 'Changed';
  fs.writeFileSync(path.join(root, 'proposals/plan-a.json'), JSON.stringify(pa));
  const out2 = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.strictEqual(out2.plans.find(p => p.id === 'plan-a').status, 'ambiguous');
  assert.ok(!(await repo.loadAll(d, { deep: true })).plans.find(p => p.id === 'plan-a')._status);
  // Same JSON rules as the app (1.0 is written 1), and the same choice of current version when the newest one clashes.
  await d.write('proposals/plan-c.json', '{"kind":"plan","id":"plan-c","process":"release","version":1.0,"title":"C","details":{},"roles":{}}');
  const lc = await repo.loadAll(d, { deep: true });
  await repo.recordPlanStatus(d, lc.plans.find(p => p.id === 'plan-c'), 'w1', 'accepted', null, 'person-casey');
  const v3a = await repo.publish(d, md + '\n\n', { people, ...EX, by: 'a', changes: 'Three', existing: [{ version: 2 }], now: NOW });
  const v3b = await repo.publish(d, md + '\n\n\n', { people, ...EX, by: 'b', changes: 'Three again', existing: [{ version: 2 }], now: NOW });
  assert.strictEqual(v3a.version, 3); assert.strictEqual(v3b.version, 3);
  const app3 = await repo.loadAll(d, { deep: true });
  const out3 = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.strictEqual(out3.plans.find(p => p.id === 'plan-c').status, 'decided', 'the checker writes numbers the way the app does');
  assert.strictEqual(out3.publications.release.current, app3.processes[0].index.latest.folder, 'same current version as the app when the newest clashes');
  assert.deepStrictEqual(out3.publications.release.clash.sort(), [v3a.folder, v3b.folder].sort());
  // Number and key edge cases written the way JavaScript writes them.
  await d.write('proposals/plan-d.json', '{"kind":"plan","id":"plan-d","process":"release","version":1,"title":"D","details":{"10":"x","2":"y","b":"z","a":"w"},"roles":{},"n":[0.000001,1e-7,1e21,123456789012345680000,9007199254740993,-0.5,0]}');
  const ld = await repo.loadAll(d, { deep: true });
  await repo.recordPlanStatus(d, ld.plans.find(p => p.id === 'plan-d'), 'w1', 'accepted', null, 'person-casey');
  const out4 = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.strictEqual(out4.plans.find(p => p.id === 'plan-d').status, 'decided', 'numbers and keys hash the same as in the app');
  await d.write('proposals/plan-e.json', '{"kind":"plan","id":"plan-e","process":"release","version":1,"title":"E \\ud800 lone","details":{"\u0662":"arabic two","\u00b2":"superscript","01":"leading zero","7":"seven"},"roles":{}}');
  const le = await repo.loadAll(d, { deep: true });
  await repo.recordPlanStatus(d, le.plans.find(p => p.id === 'plan-e'), 'w1', 'accepted', null, 'person-casey');
  const out5 = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.strictEqual(out5.plans.find(p => p.id === 'plan-e').status, 'decided', 'unicode digits and lone surrogates hash the same as in the app');
  // Two disagreeing decisions on the same plan: both the app and the checker call it undecided.
  const lf = await repo.loadAll(d, { deep: true }), pb = lf.plans.find(p => p.id === 'plan-b');
  await repo.recordPlanStatus(d, pb, 'w1', 'accepted', null, 'person-casey');
  await repo.recordPlanStatus(d, pb, 'w2', 'declined', null, 'person-blake');
  const lg = await repo.loadAll(d, { deep: true });
  assert.ok(!lg.plans.find(p => p.id === 'plan-b')._status && lg.plans.find(p => p.id === 'plan-b')._conflicting, 'the app doesn\'t pick one');
  const out6 = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.strictEqual(out6.plans.find(p => p.id === 'plan-b').status, 'ambiguous');
  fs.rmSync(root, { recursive: true, force: true });
});

rule('The checker reports the same versions as unusable as the app, with the same reasons, and knows the same step types', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  // Its copy of the built-in step types matches the app's, as far as the check reads them.
  const known = JSON.parse(cp.execFileSync(py, ['-I', '-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import check_folder as c; print(json.dumps({"builtin": c.BUILTIN, "common": c.COMMON, "newer": c.NEWER, "format": c.PUBLICATION_FORMAT, "version": c.TYPES_VERSION}))', path.dirname(CHECKER)], { encoding: 'utf8' }));
  const plain = o => JSON.parse(JSON.stringify(o)), shape = d => plain({ fields: Object.fromEntries(Object.entries(d.fields || {}).map(([k, f]) => [k, f.options ? { kind: f.kind, options: f.options } : { kind: f.kind }])), record: (d.record || []).map(r => ({ name: r.name })) });
  assert.deepStrictEqual(known.builtin, Object.fromEntries(PF.types.LIST.map(t => [t.id, shape(t)])), 'built-in step types');
  assert.deepStrictEqual(known.common, shape({ fields: PF.types.COMMON }).fields, 'fields every step takes');
  assert.strictEqual(known.newer, PF.publish.NEWER); assert.strictEqual(known.version, PF.types.VERSION, 'step type version'); assert.strictEqual(known.format, PF.publish.FORMAT);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-unusable-'));
  const d = new DiskFS(root), U = PF.util, md = example('maps/drafts/check-in.md'), first = /^(- \[!\] \{run\.command\} Branch rebased.*)$/m;
  await d.write('people.json', JSON.stringify(people));
  const v1 = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW });
  assert.ok(!v1.blockers, String(v1.blockers));
  /* Each as a newer copy, a person or an assistant would leave it: every file matches its record. */
  const forge = async (n, text, edit) => {
    const folder = 'v' + n + '-forged' + n, base = 'publications/check-in/' + folder + '/';
    const types = JSON.parse(v1.files['types.json']), info = JSON.parse(v1.files['publication.json']);
    if (edit) edit(types, info);
    const tj = JSON.stringify(types);
    Object.assign(info, { version: n, folder, mapHash: U.hash(text), typesHash: U.hash(tj) });
    await d.write(base + 'map.md', text); await d.write(base + 'types.json', tj); await d.write(base + 'publication.json', JSON.stringify(info));
    return folder;
  };
  const bad = [
    await forge(2, md.replace(first, '$1\n  when: ^branch is release')),
    await forge(3, md.replace(first, '### If the branch is a release\n$1')),
    await forge(4, md.replace(first, '$1\n  choices: rebase, merge')),
    await forge(5, md, (t, info) => { info.format = 'preflight-publication/2'; }),
    await forge(6, md.replace('{confirm} No secrets', '{approve.change} No secrets')),
    await forge(7, md.replace('{confirm} No secrets', '{constructor} No secrets')),
    await forge(8, md.replace(/^## Before the pull request/m, '## Questions\n- Which branch?\n\n## Before the pull request')),
    await forge(9, md, t => { t.confirm = { id: 'confirm', fields: { where: null } }; }),
    await forge(10, md.replace(first, '$1\n  where: Your repository\n  require: build')),
    await forge(12, md, t => { t.confirm.version = PF.types.VERSION + 1; }),
    await forge(13, md, t => { t.confirm.futureBehavior = 'conditional'; }),
    await forge(14, md, t => { t.confirm.fields.where.when = 'x'; }),
    await forge(15, md, t => { t.confirm.fields.where.kind = 'condition'; }),
    await forge(16, md, t => { t.confirm.record = [{ name: 'proof', label: 'Proof', kind: 'file' }]; }),
    await forge(17, md, t => { t.confirm.record = [{ name: 'proof', label: 'Proof', kind: 'url', skipWhen: 'x' }]; }),
    await forge(18, md, t => { t.confirm.fields = []; })
  ];
  const good = [await forge(20, md, t => { delete t.confirm; }), await forge(19, md, t => { t.confirm.version = PF.types.VERSION; }), await forge(11, md.replace('{confirm} No secrets', '{approve.change} No secrets'), t => { t['approve.change'] = { id: 'approve.change', label: 'Approve', fields: {}, record: [] }; })];

  const app = await repo.loadAll(d, { deep: true }), pubs = app.processes.find(p => p.process === 'check-in').pubs;
  const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' })).publications['check-in'];
  for (const folder of bad) {
    const mine = out.versions.find(v => v.folder === folder), theirs = pubs.find(p => p.folder === folder);
    assert.strictEqual(theirs.ok, false, folder + ': the app refuses it');
    assert.strictEqual(mine.status, 'unusable', folder + ': ' + mine.status + ' ' + mine.why);
    assert.strictEqual(mine.why, theirs.why, folder + ': same reason');
  }
  for (const folder of good.concat([v1.folder])) {
    assert.ok(pubs.find(p => p.folder === folder).ok, folder + ' runs in the app');
    assert.strictEqual(out.versions.find(v => v.folder === folder).status, 'complete', folder);
  }
  assert.strictEqual(out.current, app.processes.find(p => p.process === 'check-in').index.latest.folder, 'the same current version');
  assert.strictEqual(out.current, good[0], 'the newest runnable one');
  fs.rmSync(root, { recursive: true, force: true });
});


rule('A version that lists the corrections it includes (1.16) is complete for the checker and the app alike', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-check-'));
  const d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  const md = example('maps/drafts/release.md');
  const v1 = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, corrections: [{ id: 'g0123456789abcdef', result: { step: 'pods', sig: '0123abcd' } }, { id: 'gfedcba9876543210' }] });
  assert.ok(!v1.blockers, String(v1.blockers));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'publications', 'release', v1.folder, 'publication.json'), 'utf8')).corrections.length, 2);
  const app = await repo.loadAll(d, { deep: true });
  const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  assert.ok(app.processes[0].pubs[0].ok, 'the app runs it');
  assert.strictEqual(out.publications.release.versions.find(v => v.folder === v1.folder).status, 'complete', 'the checker ignores the field');
  assert.strictEqual(out.publications.release.current, v1.folder);
  fs.rmSync(root, { recursive: true, force: true });
});

/* Each older release's own checker (test/compat-harness.js; docs/design.md section 28), on the folder that release wrote and on
   this version's, each with a preflight-publication/2 version beside v1: from 1.11.1 it calls that version unusable and keeps
   v1 current; before 1.11.1 it takes it as the current version (why the supported floor is 1.11.1). */
rule('Each older release\'s checker reads its own folder and this version\'s, and from 1.11.1 calls a /2 version unusable', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const H = require('./compat-harness'), G = require('../tools/old-folders');
  const main = await G.main(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-old-check-'));
  const put = (dir, files) => H.writeTree(dir, files);
  const withV2 = (files) => {
    const f = Object.assign({}, files), v1 = Object.keys(f).find(p => /publication\.json$/.test(p)).replace('publication.json', ''), v2 = v1.replace(/v1-[a-z0-9]+\/$/, 'v2-zzzz2222/');
    f[v2 + 'map.md'] = f[v1 + 'map.md']; Object.keys(f).filter(p => p.indexOf(v1 + 'images/') === 0).forEach(p => { f[v2 + p.slice(v1.length)] = f[p]; }); f[v2 + 'types.json'] = f[v1 + 'types.json'];
    f[v2 + 'publication.json'] = JSON.stringify(Object.assign(JSON.parse(f[v1 + 'publication.json']), { format: 'preflight-publication/2', features: ['typed-details'], version: 2, folder: 'v2-zzzz2222' }));
    return f;
  };
  try {
    for (const t of H.bundles.tags()) {
      const b = H.bundles.get(t.tag);
      if (!b) continue;
      const ck = path.join(root, t.tag + '.py'); fs.writeFileSync(ck, b.files['check_folder.py']);
      for (const [name, files] of [['own', H.readTree(path.join(G.DIR, t.tag))], ['this version', main]]) {
        const dir = path.join(root, t.tag + '-' + name.replace(' ', '-')); put(dir, withV2(files));
        const p = JSON.parse(cp.execFileSync(py, ['-I', ck, dir], { encoding: 'utf8' })).publications.backup;
        const st = {}; p.versions.forEach(v => { st[v.folder] = v.status; });
        const want = t.supported ? ['v1-ab9ysnqh', 'complete', 'unusable'] : ['v2-zzzz2222', 'complete', 'complete'];
        assert.deepStrictEqual([p.current, st['v1-ab9ysnqh'], st['v2-zzzz2222']], want, t.tag + ' on ' + name);
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The assistants\' folder checker agrees with the app on OneDrive copies of a plan and on a plan started twice', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-check-'));
  const d = new DiskFS(root);
  await d.write('people.json', JSON.stringify(people));
  await repo.publish(d, example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW });
  const plan = (id, extra) => JSON.stringify(Object.assign({ kind: 'plan', id, process: 'release', version: 1, title: 'Requested', details: {}, roles: {}, note: 'Requested by ci-check.', by: 'ci-check 1.4.0 (a tool)', created: NOW }, extra || {}), null, 2) + '\n';
  const A = 'req-ci-check-' + 'a'.repeat(24), B = 'req-ci-check-' + 'b'.repeat(24), C = 'req-ci-check-' + 'c'.repeat(24);
  // The same request twice (another computer's own time), a request whose copies differ, and a plan started on two computers.
  await d.write('proposals/' + A + '.json', plan(A));
  await d.write('proposals/' + A + '-LAPTOP.json', plan(A, { created: '2026-10-18T08:00:00.000Z' }));
  await d.write('proposals/' + B + '.json', plan(B));
  await d.write('proposals/' + B + '-LAPTOP.json', plan(B, { title: 'Other' }));
  await d.write('proposals/' + C + '.json', plan(C));
  let app = await repo.loadAll(d, { deep: true });
  const c = app.plans.find(p => p.id === C);
  await repo.recordPlanStatus(d, c, 'w1', 'accepted', 'run1', 'person-casey');
  await repo.recordPlanStatus(d, c, 'w2', 'accepted', 'run2', 'person-blake');
  // The LAPTOP copy of A was started: the start counts for the request.
  await repo.recordPlanStatus(d, Object.assign({}, app.plans.find(p => p.id === A), { _hash: PF.util.hash(JSON.stringify(JSON.parse(plan(A, { created: '2026-10-18T08:00:00.000Z' })))) }), 'w3', 'accepted', 'run3', 'person-casey');
  app = await repo.loadAll(d, { deep: true });
  const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
  const py1 = (id) => out.plans.filter(p => p.id === id);
  const a = app.plans.filter(p => p.id === A);
  assert.strictEqual(a.length, 1); assert.ok(a[0]._status && a[0]._status.run === 'run3');
  assert.deepStrictEqual(py1(A).map(p => [p.file, p.status]), [[A + '.json', 'decided']]);
  assert.ok(app.plans.filter(p => p.id === B).every(p => p._copiesDiffer));
  assert.deepStrictEqual(py1(B).map(p => p.status), ['ambiguous']);
  assert.ok(/different copies/.test(py1(B)[0].why));
  assert.strictEqual(app.plans.find(p => p.id === C)._conflicting, true);
  assert.deepStrictEqual(py1(C).map(p => p.status), ['ambiguous']);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ---------- The format envelope, mirrored (2.0 plan, slice 1b) ---------- */
rule('The checker\'s envelope verdict agrees with PF.envelope.judge on every 2.0 sample and probe it reads, and names a newer version in the app\'s words', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const S = require('../tools/v2-samples'), H = require('./compat-harness'), G = require('../tools/old-folders');
  const objs = [];
  ['folder', 'probes/major', 'probes/feature'].forEach(w => Object.entries(S.tree(w)).forEach(([p, t]) => {
    const fam = PF.envelope.familyOfPath(p);
    if ((fam === 'preflight-publication' || fam === 'flightdeck-step-type') && !/types\.json$/.test(p)) objs.push([fam, JSON.parse(t)]);
  }));
  objs.push(['preflight-publication', { format: 'preflight-publication/1' }], ['flightdeck-step-type', { id: 'x' }], ['preflight-publication', { format: 'preflight-run/2' }], ['preflight-publication', { format: 'acme/1', app: '3.2.1' }], ['preflight-publication', null]);
  const out = JSON.parse(cp.execFileSync(py, ['-I', '-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import check_folder as c; print(json.dumps([c.judge(f, o) for f, o in json.loads(sys.stdin.read())]))', path.dirname(CHECKER)], { encoding: 'utf8', input: JSON.stringify(objs) }));
  objs.forEach(([f, o], i) => {
    const js = PF.envelope.judge(f, o);
    assert.deepStrictEqual([out[i].ok, out[i].ok ? '' : out[i].kind, out[i].ok ? '' : out[i].needs], [js.ok, js.ok ? '' : js.kind, js.ok ? '' : js.needs || ''], f + ' ' + JSON.stringify(o).slice(0, 100));
  });
  assert.deepStrictEqual(JSON.parse(cp.execFileSync(py, ['-I', '-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import check_folder as c; print(json.dumps([c.FROZEN, c.FAMILY_NAMES]))', path.dirname(CHECKER)], { encoding: 'utf8' })), JSON.parse(JSON.stringify([PF.envelope.FROZEN, Object.keys(PF.envelope.FAMILIES)])));
  // On a folder with every 2.0 sample: the /2 version and the 2.0 step type, in the app's words.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-env-'));
  try {
    const files = Object.assign(H.readTree(path.join(G.DIR, 'v1.18.0')), S.tree('folder')); H.writeTree(root, files);
    const res = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    const v2 = res.publications.backup.versions.find(v => v.folder === S.PUB2);
    const app = await repo.loadAll(new DiskFS(root));
    assert.strictEqual(v2.why, app.processes.find(p => p.process === 'backup').pubs.find(x => x.folder === S.PUB2).why);
    assert.strictEqual(res.publications.backup.current, 'v1-ab9ysnqh');
    const st = JSON.stringify(res).indexOf('This step type needs Flightdeck 2.0. This copy shows it but can\'t use or change it.') >= 0;
    assert.ok(st, 'the 2.0 step type is named: ' + JSON.stringify(res.team || res).slice(0, 400));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker agrees with the app on plans, plan decisions, versions and step types in folders with every 2.0 sample and every probe', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const S = require('../tools/v2-samples'), H = require('./compat-harness'), G = require('../tools/old-folders');
  for (const [label, extra] of [['samples', S.tree('folder')], ['major probes', S.tree('probes/major')], ['feature probes', S.tree('probes/feature')]]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-parity-'));
    try {
      const files = Object.assign(H.readTree(path.join(G.DIR, 'v1.18.0')), extra);
      // A declined decision with an unknown feature on the baseline plan: the app refuses it, so the plan stays pending.
      // A plan whose only decision has a feature this copy doesn't know: the app refuses the decision, so the plan is pending.
      const may = { kind: 'plan', id: 'plan-backup-may', process: 'backup', version: 1, title: 'Backup check May', by: 'person-avery', created: NOW };
      files['proposals/plan-backup-may.json'] = JSON.stringify(may);
      files['proposals/plan-backup-may.status-w-feat.json'] = JSON.stringify({ kind: 'status', proposal: 'plan-backup-may', proposalHash: PF.util.hash(JSON.stringify(may)), status: 'declined', run: null, by: 'person-avery', at: NOW, features: ['from-the-future'] });
      // And a plan with an unknown feature: refused by the app, never pending.
      files['proposals/plan-backup-june.json'] = JSON.stringify(Object.assign({}, may, { id: 'plan-backup-june', features: ['from-the-future'] }));
      H.writeTree(root, files);
      const res = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
      const d = await repo.loadAll(new DiskFS(root), { deep: true });
      const app = {}; d.plans.forEach(p => { app[p.id] = p._status ? 'decided' : (p._conflicting || p._changedAfterDecision || p._copiesDiffer) ? 'ambiguous' : 'pending'; });
      const mine = {}; res.plans.filter(p => p.status !== 'newer').forEach(p => { mine[p.id] = p.status; });
      assert.deepStrictEqual(mine, app, label + ': plans and their state');
      assert.strictEqual(app['plan-backup-may'], 'pending', 'set-up: the app refuses the decision');
      assert.ok(!('plan-backup-june' in app), 'set-up: the app refuses the plan');
      const refusedApp = JSON.parse(JSON.stringify(d.refused)).filter(r => /^proposals\//.test(r.path)).map(r => r.path).sort();
      const refusedMine = (res.refused || []).filter(r => /^proposals\//.test(r.file)).map(r => r.file).sort();
      assert.deepStrictEqual(refusedMine, refusedApp, label + ': plans and decisions from a newer Flightdeck');
      const pubs = {}; d.processes.forEach(p => (p.pubs || []).forEach(x => { pubs[p.process + '/' + x.folder] = x.ok ? 'complete' : x.unusable ? 'unusable' : 'other'; }));
      Object.keys(res.publications).forEach(proc => res.publications[proc].versions.forEach(v => {
        const a = pubs[proc + '/' + v.folder];
        if (a === 'complete' || a === 'unusable' || v.status === 'complete' || v.status === 'unusable') assert.strictEqual(v.status, a, label + ': ' + proc + '/' + v.folder + ' ' + v.why);
      }));
      const typeRefused = JSON.parse(JSON.stringify(d.refused)).filter(r => /^step-types\//.test(r.path)).map(r => r.path).sort();
      assert.deepStrictEqual(res.teamFiles.problems.filter(p => /needs (Flightdeck|a newer)/.test(p.problem)).map(p => p.file).sort(), typeRefused, label + ': step types');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

/* Slice 2 part 1: a real 2.0 version (phase notes, phase and gate screenshots: preflight-publication/2 with its payload) is
   complete for both; one whose payload doesn't match its files is damaged for both; one whose payload pins another version
   (a later slice) is unusable for both, in the same words. */
rule('The checker reads a 2.0 version with phase notes and phase and gate screenshots like the app: complete, checked by its payload', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-v2-'));
  try {
    const d = new DiskFS(root);
    await d.write('people.json', JSON.stringify(people));
    await d.write('images/x/scratch.png', new Blob([Buffer.from([1, 2, 3, 4])], { type: 'image/png' }));
    await d.write('images/x/counts.png', new Blob([Buffer.from([5, 6, 7, 8, 9])], { type: 'image/png' }));
    const md = '---\nprocess: x\ntitle: X\n---\n## P {#p}\n  > Use the scratch server.\n  ![The scratch server](images/x/scratch.png)\n- [ ] {confirm} Look {#a}\n\n## Gate: Ready {#ready}\n  > Counts match.\n  ![Counts](images/x/counts.png)\n';
    const v = await repo.publish(d, md, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.0.0' });
    assert.ok(!v.blockers, String(v.blockers));
    const base = 'publications/x/' + v.folder + '/', info = JSON.parse(fs.readFileSync(path.join(root, ...base.split('/'), 'publication.json'), 'utf8'));
    assert.strictEqual(info.format, 'preflight-publication/2', 'set-up');
    const copy = async (n, edit) => {
      const folder = 'v' + n + '-copy000' + n, dst = 'publications/x/' + folder + '/', i = JSON.parse(JSON.stringify(info));
      Object.assign(i, { version: n, folder }); edit(i);
      for (const f of ['map.md', 'types.json', 'images/x/scratch.png', 'images/x/counts.png']) { fs.mkdirSync(path.dirname(path.join(root, ...(dst + f).split('/'))), { recursive: true }); fs.copyFileSync(path.join(root, ...(base + f).split('/')), path.join(root, ...(dst + f).split('/'))); }
      await d.write(dst + 'publication.json', JSON.stringify(i, null, 2));
      return folder;
    };
    const mapOff = await copy(2, i => { i.payload.map = 'a'.repeat(64); });
    const shotOff = await copy(3, i => { i.payload.images['images/x/counts.png'] = 'b'.repeat(64); });
    const pinned = await copy(4, i => { i.payload.pins.children.verify = { process: 'verify', version: 4, folder: 'v4-cccc4444', mapHash: 'aaaa0001', typesHash: 'aaaa0002' }; });
    const later = await copy(5, i => { i.features = ['phase-notes', 'typed-details']; });
    const unlisted = await copy(6, i => { delete i.images['images/x/counts.png']; delete i.payload.images['images/x/counts.png']; });
    /* A byte-order mark the checker's text reading drops: the exact bytes no longer match the payload. */
    const bom = await copy(7, () => {});
    const bomPath = path.join(root, 'publications', 'x', bom, 'map.md');
    fs.writeFileSync(bomPath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), fs.readFileSync(bomPath)]));
    const app = await repo.loadAll(d, { deep: true }), pubs = app.processes.find(p => p.process === 'x').pubs;
    const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' })).publications.x;
    const mine = f => out.versions.find(x => x.folder === f), theirs = f => pubs.find(x => x.folder === f);
    assert.ok(theirs(v.folder).ok, theirs(v.folder).why);
    assert.strictEqual(mine(v.folder).status, 'complete', mine(v.folder).why);
    assert.strictEqual(mine(bom).status, 'damaged', 'a byte-order mark: ' + mine(bom).why);
    for (const f of [mapOff, shotOff]) { assert.ok(!theirs(f).ok && !theirs(f).unusable, f); assert.strictEqual(mine(f).status, 'damaged', f + ': ' + mine(f).why); }
    for (const f of [pinned, later, unlisted]) { assert.ok(!theirs(f).ok && theirs(f).unusable, f); assert.strictEqual(mine(f).status, 'unusable', f); assert.strictEqual(mine(f).why, theirs(f).why, f + ': same words'); }
    assert.strictEqual(out.current, v.folder);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

rule('The checker refuses a version whose step screenshot its record (and a /2 version\'s payload) doesn\'t list, like the app, /1 and /2', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-stepshot-'));
  try {
    const d = new DiskFS(root);
    await d.write('people.json', JSON.stringify(people));
    await d.write('images/x/job.png', new Blob([Buffer.from([1, 2, 3, 4])], { type: 'image/png' }));
    await d.write('images/x/scratch.png', new Blob([Buffer.from([5, 6, 7])], { type: 'image/png' }));
    const one = '---\nprocess: x\ntitle: X\n---\n## P {#p}\n- [ ] {confirm} Look {#a}\n  ![The job page](images/x/job.png)\n';
    const two = one.replace('## P {#p}\n', '## P {#p}\n  > Use the scratch server.\n  ![The scratch server](images/x/scratch.png)\n');
    const v1 = await repo.publish(d, one, { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW });
    const v2 = await repo.publish(d, two, { people, ...EX, by: 'person-avery', changes: 'x', existing: [{ version: 1 }], now: NOW, app: '2.0.0' });
    for (const v of [v1, v2]) {
      const p = path.join(root, 'publications', 'x', v.folder, 'publication.json'), i = JSON.parse(fs.readFileSync(p, 'utf8'));
      delete i.images['images/x/job.png']; if (i.payload) delete i.payload.images['images/x/job.png'];
      fs.writeFileSync(p, JSON.stringify(i, null, 2));
    }
    const app = await repo.loadAll(d, { deep: true }), pubs = app.processes.find(p => p.process === 'x').pubs;
    const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' })).publications.x;
    for (const v of [v1, v2]) {
      const theirs = pubs.find(x => x.folder === v.folder), mine = out.versions.find(x => x.folder === v.folder);
      assert.ok(!theirs.ok && theirs.unusable, v.folder + ': the app refuses it');
      assert.strictEqual(mine.status, 'unusable', v.folder + ': ' + mine.status + ' ' + mine.why);
      assert.strictEqual(mine.why, theirs.why, v.folder + ': same words');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run();
