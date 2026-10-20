// One skill verdict (PF.skills.resolve), every consumer: the app (repo.loadAll), flightdeck skill register and the
// assistants' folder checker (check_folder.py) must give the same verdict for a skill name, for every combination of its
// legacy file (absent, valid, tombstone, newer, malformed, unreadable) and its exact revisions (none, valid, two at one
// revision, newer, malformed, seen not below rev, an empty steps list). The matrix is generated here; the rules live once in
// PF.skills.resolve and its Python port.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { load, example, exampleSetup, rule, run } = require('./harness');
const PF = load(), repo = PF.repo;
const EX = exampleSetup(PF);
const NOW = '2026-10-20T09:00:00.000Z';
const people = JSON.parse(example('people.json'));
const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js');
const CHECKER = path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck', 'check_folder.py');

class DiskFS {
  constructor(root) { this.root = root; this.kind = 'folder'; this.name = path.basename(root); }
  p(rel) { return path.join(this.root, ...rel.split('/')); }
  list(rel) { const d = rel ? this.p(rel) : this.root; return Promise.resolve(fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).map(e => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' })) : []); }
  read(rel) { const f = this.p(rel); if (!fs.existsSync(f)) return Promise.resolve(null); return new Promise((res, rej) => { try { res({ text: fs.readFileSync(f, 'utf8'), mtime: fs.statSync(f).mtimeMs }); } catch (e) { rej(e); } }); }
  stat(rel) { const f = this.p(rel); return Promise.resolve(fs.existsSync(f) ? { size: fs.statSync(f).size, mtime: fs.statSync(f).mtimeMs } : null); }
  blob(rel) { const f = this.p(rel); if (!fs.existsSync(f)) return Promise.resolve(null); return new Promise((res, rej) => { try { res(new Blob([fs.readFileSync(f)])); } catch (e) { rej(e); } }); }
  write(rel, data) { const f = this.p(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return Promise.resolve(); }
  append(rel, text) { const f = this.p(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, text); return Promise.resolve(); }
  remove(rel) { fs.unlinkSync(this.p(rel)); return Promise.resolve(); }
}
function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* try next */ } } return null; }
function tree(dir) { const out = {}; (function walk(d, rel) { let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (err) { out[rel + '/'] = '(unlisted)'; return; } ents.forEach(e => { const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(p, r); else { try { out[r] = fs.readFileSync(p).toString('base64'); } catch (err) { out[r] = '(unreadable)'; } } }); })(dir, ''); return out; }

const LEGACY = ['absent', 'valid', 'tombstone', 'newer', 'malformed', 'unreadable'];
const REVS = ['none', 'valid', 'two', 'newer', 'malformed', 'seen', 'steps'];
/* Revision numbers JavaScript refuses, written into the file as raw JSON: Python must refuse each the same way, never crash. */
const BADNUM = { 'rev-huge': ['rev', '1e999'], 'rev-neg': ['rev', '-1'], 'rev-frac': ['rev', '1.5'], 'rev-str': ['rev', '"1"'], 'rev-bool': ['rev', 'true'], 'seen-huge': ['seen', '1e999'] };
REVS.push(...Object.keys(BADNUM));
/* A name's folder that can't be listed (chmod 000 on skill-registrations/<name>/). */
REVS.push('unlisted');
const ROOT_USER = typeof process.getuid === 'function' && process.getuid() === 0;

rule('Every consumer gives the same skill verdict for every legacy file × revisions cell, and flightdeck skill register refuses (writing nothing) exactly when the verdict blocks it', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-skparity-'));
  const locked = [];
  try {
    const d = new DiskFS(root);
    await d.write('people.json', JSON.stringify(people));
    const v = await repo.publish(d, '---\nprocess: verify\ntitle: Verify\n---\n## P {#p}\n- [ ] {confirm} Look {#a}\n', { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.0.0' });
    assert.ok(!v.blockers, String(v.blockers));
    const loaded = await repo.loadAll(d, { deep: true }), pr = loaded.processes.find(p => p.process === 'verify');
    const proc = { latest: pr.index.latest, all: pr.index.all, clashes: pr.index.clashes, broken: [] };
    const cells = [];
    let k = 0;
    for (const l of LEGACY) for (const r of REVS) {
      if ((l === 'unreadable' || r === 'unlisted') && ROOT_USER) continue;
      const name = 's-' + l + '-' + r, rand = ('0000000' + (++k).toString(36)).slice(-8);
      cells.push({ name, l, r });
      let rec = null;
      if (r !== 'none') {
        const g = PF.skills.registration({ name, version: '1.0.0', location: 'here', implements: { process: 'verify', folder: v.folder } }, proc, null, { app: '2.0.0', now: NOW, by: 'person-avery', window: 'w-one', rand });
        assert.ok(g.rec, g.why); rec = g.rec;
        await d.write(g.path, JSON.stringify(g.rec, null, 2) + '\n');
        const two = (o) => d.write(g.path.replace('.1.w-one.json', '.2.w-two.json'), JSON.stringify(o, null, 2) + '\n');
        if (r === 'two') await d.write(g.path.replace('.w-one.json', '.w-two.json'), JSON.stringify(Object.assign({}, g.rec, { version: '1.0.1' }), null, 2) + '\n');
        if (r === 'newer') await two(Object.assign({}, g.rec, { format: 'flightdeck-skill/3', rev: 2, seen: 1 }));
        if (r === 'malformed') await two(Object.assign({}, g.rec, { rev: 2, seen: 1, implements: 'verify@1' }));
        if (r === 'seen') await two(Object.assign({}, g.rec, { rev: 2, seen: 2 }));
        if (r === 'steps') await two(Object.assign({}, g.rec, { rev: 2, seen: 1, steps: [] }));
        if (BADNUM[r]) { const [f, raw] = BADNUM[r], o = Object.assign({}, g.rec, { rev: 2, seen: 1 }); o[f] = '@@'; await d.write(g.path.replace('.1.w-one.json', '.2.w-two.json'), JSON.stringify(o, null, 2).replace('"@@"', raw) + '\n'); }
      }
      const lf = 'skills/' + name + '.json';
      if (l === 'valid' || l === 'unreadable') await d.write(lf, JSON.stringify({ name, version: '0.9.0', location: 'there', implements: 'verify@1' }));
      if (l === 'tombstone') await d.write(lf, JSON.stringify({ name, implements: 'moved', movedTo: 'skill-registrations/' + name + '/', id: rec ? rec.id : 'sk-zzzzzzzz' }));
      if (l === 'newer') await d.write(lf, JSON.stringify({ format: 'flightdeck-skill/3', name, version: '9.0.0', location: 'x', implements: { process: 'verify' } }));
      if (l === 'malformed') await d.write(lf, JSON.stringify({ name, version: '0.9.0' }));
      if (l === 'unreadable') { fs.chmodSync(d.p(lf), 0o000); locked.push(d.p(lf)); }
    }
    /* Truncation: a copy reads the first 500 registration files by path and no more. z-a-part's revision 1 is the 500th and
       its revision 2 is past it; all of z-b-all's are past it. Filler under t-filler/ sorts between the cells and them. */
    const zs = [];
    for (const name of ['z-a-part', 'z-b-all']) {
      const rand = ('0000000' + (++k).toString(36)).slice(-8);
      const g = PF.skills.registration({ name, version: '1.0.0', location: 'here', implements: { process: 'verify', folder: v.folder } }, proc, null, { app: '2.0.0', now: NOW, by: 'person-avery', window: 'w-one', rand });
      await d.write(g.path, JSON.stringify(g.rec, null, 2) + '\n');
      await d.write(g.path.replace('.1.w-one.json', '.2.w-two.json'), JSON.stringify(Object.assign({}, g.rec, { rev: 2, seen: 1, version: '1.1.0' }), null, 2) + '\n');
      await d.write('skills/' + name + '.json', JSON.stringify({ name, version: '0.9.0', location: 'there', implements: 'verify@1' }));
      zs.push({ name, l: 'valid', r: 'truncated' });
    }
    const listed = [];
    (function walk(rel) { fs.readdirSync(d.p(rel), { withFileTypes: true }).forEach(e => { const r = rel + '/' + e.name; if (e.isDirectory()) walk(r); else if (/\.json$/i.test(e.name)) listed.push(r); }); })('skill-registrations');
    const unlistedDirs = cells.filter(c => c.r === 'unlisted').map(c => 'skill-registrations/' + c.name + '/');
    const before = listed.filter(p => !/^skill-registrations\/z-/.test(p) && !unlistedDirs.some(u => p.indexOf(u) === 0)).length;
    for (let i = 0; i < 500 - before - 1; i++) await d.write('skill-registrations/t-filler/f' + String(i).padStart(4, '0') + '.json', '{}\n');
    cells.unshift(...zs);
    for (const c of cells.filter(c => c.r === 'unlisted')) { const dir = d.p('skill-registrations/' + c.name); fs.chmodSync(dir, 0o000); locked.push(dir); }
    const pick = (x) => x ? { status: x.status, source: x.source || null, rev: x.rev == null ? null : x.rev, blocks: !!x.blocks, kinds: Array.from(x.kinds || []).sort() } : { status: 'absent', source: null, rev: null, blocks: false, kinds: [] };
    // The app.
    const app = await repo.loadAll(d, { deep: true });
    const appSays = (n) => { const e = app.skills.filter(x => x.verdict && x.verdict.name === n); return pick(e.length ? e[0].verdict : null); };
    // The checker.
    const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
    const pySays = (n) => pick((out.skills || []).find(s => s.name === n));
    const input = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-skin-')), 'skill.json');
    const seen = {};
    for (const c of cells) {
      const a = appSays(c.name), p = pySays(c.name);
      assert.deepStrictEqual(p, a, c.name + ': the checker agrees with the app');
      // The command: its verdict before writing, and a refusal (nothing written) exactly when that verdict blocks.
      fs.writeFileSync(input, JSON.stringify({ name: c.name, version: '2.0.0', location: 'here', implements: { process: 'verify', folder: v.folder } }));
      const before = tree(root), res = cp.spawnSync(process.execPath, [BIN, 'skill', 'register', root, '--from', input, '--json'], { encoding: 'utf8' });
      let j = null; try { j = JSON.parse(res.stdout); } catch (e) { /* below */ }
      assert.ok(j && j.verdict, c.name + ': the command says its verdict: ' + res.stdout + res.stderr);
      assert.deepStrictEqual(pick(j.verdict), a, c.name + ': the command agrees with the app');
      if (a.blocks) { assert.ok(res.status !== 0 && j.error, c.name + ': refused'); assert.deepStrictEqual(tree(root), before, c.name + ': nothing written'); }
      else assert.strictEqual(res.status, 0, c.name + ': registered: ' + res.stdout);
      seen[c.name] = a;
    }
    // The rules, spot-checked: a refused revision or an unreadable, newer or malformed legacy file holds the whole name.
    const st = (n) => seen[n] && seen[n].status;
    ['newer', 'malformed', 'seen', 'steps'].concat(Object.keys(BADNUM)).forEach(r => LEGACY.forEach(l => { if (seen['s-' + l + '-' + r]) assert.strictEqual(st('s-' + l + '-' + r), 'unmatched', l + '/' + r); }));
    ['newer', 'malformed'].concat(ROOT_USER ? [] : ['unreadable']).forEach(l => REVS.forEach(r => assert.strictEqual(st('s-' + l + '-' + r), 'unmatched', l + '/' + r)));
    assert.deepStrictEqual(seen['s-absent-valid'], { status: 'current', source: 'registration', rev: 1, blocks: false, kinds: [] });
    assert.deepStrictEqual(seen['s-tombstone-valid'], { status: 'current', source: 'registration', rev: 1, blocks: false, kinds: [] });
    assert.deepStrictEqual(seen['s-valid-none'], { status: 'current', source: 'legacy', rev: null, blocks: false, kinds: [] });
    assert.deepStrictEqual(seen['s-valid-valid'], { status: 'unmatched', source: null, rev: null, blocks: false, kinds: ['two'] }, 'two registrations; register turns the legacy one into a pointer');
    assert.strictEqual(st('s-tombstone-none'), 'unmatched');
    assert.strictEqual(st('s-absent-two'), 'unmatched'); assert.ok(seen['s-absent-two'].blocks);
    assert.ok(!ROOT_USER ? seen['s-unreadable-none'].blocks : true, 'an unreadable legacy file blocks registering');
    // A name whose folder can't be listed, or whose revisions were cut by the 500-file limit, is never current, and blocks.
    LEGACY.forEach(l => { const x = seen['s-' + l + '-unlisted']; if (x) assert.ok(x.status === 'unmatched' && x.blocks && x.kinds.indexOf('revisions-unlisted') >= 0, l + '/unlisted: ' + JSON.stringify(x)); });
    ['z-a-part', 'z-b-all'].forEach(n => assert.ok(seen[n].status === 'unmatched' && seen[n].blocks && seen[n].kinds.indexOf('revisions-unlisted') >= 0, n + ': ' + JSON.stringify(seen[n])));
    assert.ok(cells.length >= 80, cells.length + ' cells');
  } finally {
    locked.forEach(f => { try { fs.chmodSync(f, 0o755); } catch (e) { /* gone */ } });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

rule('A skills/ or skill-registrations/ folder that can\'t be listed holds every name: the app, flightdeck skill register and the checker agree, and the command writes nothing', async () => {
  const py = python();
  if (!py || ROOT_USER) { console.log('  (skipped: needs Python and a user chmod applies to)'); return; }
  for (const which of ['skill-registrations', 'skills']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-skdir-'));
    try {
      const d = new DiskFS(root);
      await d.write('people.json', JSON.stringify(people));
      const v = await repo.publish(d, '---\nprocess: verify\ntitle: Verify\n---\n## P {#p}\n- [ ] {confirm} Look {#a}\n', { people, ...EX, by: 'person-avery', changes: 'x', existing: [], now: NOW, app: '2.0.0' });
      const loaded = await repo.loadAll(d, { deep: true }), pr = loaded.processes.find(p => p.process === 'verify');
      const proc = { latest: pr.index.latest, all: pr.index.all, clashes: pr.index.clashes, broken: [] };
      // legacy-only has just a legacy file; both has a legacy file and a revision; reg-only has just a revision.
      for (const [name, leg, reg] of [['legacy-only', true, false], ['both', true, true], ['reg-only', false, true]]) {
        if (leg) await d.write('skills/' + name + '.json', JSON.stringify({ name, version: '0.9.0', location: 'there', implements: 'verify@1' }));
        if (reg) { const g = PF.skills.registration({ name, version: '1.0.0', location: 'here', implements: { process: 'verify', folder: v.folder } }, proc, null, { app: '2.0.0', now: NOW, by: 'a', window: 'w-one', rand: 'aaaa' + name.length + 'bbb' }); await d.write(g.path, JSON.stringify(g.rec, null, 2) + '\n'); }
      }
      await d.write('skill-registrations/.keep', '');
      fs.chmodSync(d.p(which), 0o000);
      const pick = (x) => x ? { status: x.status, blocks: !!x.blocks } : { status: 'absent', blocks: false };
      const app = await repo.loadAll(d, { deep: true });
      const out = JSON.parse(cp.execFileSync(py, ['-I', CHECKER, root], { encoding: 'utf8' }));
      const input = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-skin-')), 'skill.json');
      // Names this copy can still see: from the folder that does list.
      const visible = which === 'skills' ? ['both', 'reg-only'] : ['legacy-only', 'both'];
      for (const name of visible) {
        const a = pick((app.skills.filter(x => x.verdict && x.verdict.name === name)[0] || {}).verdict);
        assert.ok(a.status === 'unmatched' && a.blocks, which + ' unlisted, ' + name + ': the app holds it: ' + JSON.stringify(a));
        assert.deepStrictEqual(pick((out.skills || []).find(x => x.name === name)), a, which + ', ' + name + ': the checker agrees');
        fs.writeFileSync(input, JSON.stringify({ name, version: '2.0.0', location: 'here', implements: { process: 'verify', folder: v.folder } }));
        fs.chmodSync(d.p(which), 0o755); const before = tree(root); fs.chmodSync(d.p(which), 0o000);
        const res = cp.spawnSync(process.execPath, [BIN, 'skill', 'register', root, '--from', input, '--json'], { encoding: 'utf8' });
        let j = null; try { j = JSON.parse(res.stdout); } catch (e) { /* below */ }
        assert.ok(j && j.verdict, which + ', ' + name + ': the command says its verdict: ' + res.stdout + res.stderr);
        assert.deepStrictEqual(pick(j.verdict), a, which + ', ' + name + ': the command agrees');
        fs.chmodSync(d.p(which), 0o755);
        assert.ok(res.status !== 0, which + ', ' + name + ': refused'); assert.deepStrictEqual(tree(root), before, which + ', ' + name + ': nothing written');
        fs.chmodSync(d.p(which), 0o000);
      }
    } finally {
      try { fs.chmodSync(path.join(root, which), 0o755); } catch (e) { /* gone */ }
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

rule('PF.skills.resolve: the one verdict for a skill name, from its legacy file and its revisions', () => {
  const R = PF.skills.resolve;
  assert.strictEqual(typeof R, 'function');
  const legacy = Object.assign(PF.skills.check({ name: 'x', version: '1', implements: 'verify@1' }, 'x.json'), { file: 'x.json' });
  assert.deepStrictEqual([R('x', [legacy], []).status, R('x', [legacy], []).source], ['current', 'legacy']);
  const unreadable = { skill: null, errors: ['skills/x.json: couldn\'t be read'], file: 'x.json', unreadable: true };
  const u = R('x', [unreadable], []);
  assert.ok(u.status === 'unmatched' && u.blocks && u.kinds.indexOf('legacy-unreadable') >= 0, JSON.stringify(u));
  const refused = { skill: null, errors: ['skill-registrations/x/sk-aaaa1111.2.w.json: made with a newer Flightdeck. Needs Flightdeck 2.0.'], file: 'skill-registrations/x/sk-aaaa1111.2.w.json', newer: true };
  const v = R('x', [legacy], [refused]);
  assert.ok(v.status === 'unmatched' && v.blocks && v.source === null, 'a refused revision holds the legacy skill too: ' + JSON.stringify(v));
});

run();
