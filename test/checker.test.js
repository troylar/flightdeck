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
  assert.deepStrictEqual(app.plans.map(p => p.id + ':' + !!p._status).sort(), ['plan-a:true', 'plan-b:false']);
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

run();
