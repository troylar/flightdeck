// Review rounds 5 and 6 (WA, XB, XC, docs/design.md 45.1): what a spread depends on is expected, present and checked, never
// "nothing there". One table: every kind of dependency (a scope record, a later scope record that brought an item in, the
// spread-add proposal, the application living.head names, the decision it saw, an item's run, its version, its own addition,
// decision and application, the run's own version) broken every way a reader meets (absent, unreadable, malformed, newer, a
// link), read by every command that depends on it (run, next, todo list, spread list, and sync, include and stop, previewed and
// asked; a story's own readers for what it fulfils). Every cell: exit 4, the path named, nothing written, and exit 4, an
// incomplete envelope and a named path always together (the app's cells: test/app-spread-deps.test.js).
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { rule, run } = require('./harness');
const { PF, json, PR, TOOL, spread, decideAll, land } = require('./spread-fixture');
const T = PF.todos;

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');
/* Every file and link under root, by name, size and time, read with lstat only (an unreadable file is still listed). */
const state = (root) => { const out = {}; const walk = (x) => fs.readdirSync(x, { withFileTypes: true }).forEach(e => { const p = path.join(x, e.name), st = fs.lstatSync(p); if (e.isDirectory()) walk(p); else out[rel(root, p)] = st.size + ':' + st.mtimeMs; }); walk(root); return out; };
const files = (root) => Object.keys(state(root));
const jsonOf = (root, f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const findRec = (root, test) => files(root).filter(f => /^proposals\/req-[^/]+\.json$/.test(f)).find(f => { try { return test(jsonOf(root, f), f); } catch (e) { return false; } });
const KID = 'validate-story/k102', SEC = T.idFor('release-helper', 'sec-1');
const kidRec = (root, test) => findRec(root, (j, f) => j.run && j.run.process === 'validate-story' && j.run.id === 'k102' && test(j, f));

/* Where each kind of dependency is, once the spread is applied and synced, ABC-102's addition applied on its own run, and
   ABC-104 brought in by a later scope record with its run and request. [where, whose readers] */
const KINDS = {
  'a scope record': [(root) => findRec(root, (j) => j.observation !== undefined && j.observation.items.length === 3), 'parent'],
  'a later scope record that brought an item in': [(root) => findRec(root, (j) => j.observation !== undefined && j.observation.items.length === 4), 'parent'],
  'the spread-add proposal': [() => 'proposals/' + SEC + '.json', 'parent'],
  'the application living.head names': [(root) => 'proposals/' + jsonOf(root, 'runs/' + PR + '/run.json').living.head + '.json', 'both'],
  'the decision its application saw': [(root) => findRec(root, (j, f) => f.indexOf(SEC + '.status-w') === 'proposals/'.length), 'parent'],
  'an item\'s run': [() => 'runs/' + KID + '/run.json', 'parent'],
  'an item\'s version': [(root) => files(root).find(f => /^publications\/validate-story\/[^/]+\/publication\.json$/.test(f)), 'parent'],
  'an item\'s own addition': [(root) => kidRec(root, (j) => j.kind === 'proposal' && j.fulfills), 'parent'],
  'an item\'s own decision': [(root) => kidRec(root, (j) => j.kind === 'decision'), 'parent'],
  'an item\'s own application': [(root) => 'proposals/' + jsonOf(root, 'runs/' + KID + '/run.json').living.head + '.json', 'parent'],
  'the run\'s own version': [(root) => files(root).find(f => /^publications\/release-readiness\/[^/]+\/publication\.json$/.test(f)), 'both'],
  /* YC: a story's readers judge its parent as the parent's own reader does (its file, its format, its pinned version). */
  'the parent run': [() => 'runs/' + PR + '/run.json', 'child']
};
/* How each is broken. A function returns what to undo (permissions), or nothing. */
const newer = (root, f) => {
  const j = jsonOf(root, f);
  if (/run\.json$/.test(f)) j.format = 'preflight-run/9';
  else if (/publication\.json$/.test(f)) j.format = 'preflight-publication/9';
  else j.format = String(j.format).replace(/\/[0-9]+$/, '/5');
  fs.writeFileSync(path.join(root, f), JSON.stringify(j, null, 2));
};
const MODES = {
  absent: (root, f) => { const dirKind = /run\.json$|publication\.json$/.test(f); if (dirKind) fs.rmSync(path.dirname(path.join(root, f)), { recursive: true }); else fs.unlinkSync(path.join(root, f)); },
  unreadable: (root, f) => { fs.chmodSync(path.join(root, f), 0); return () => fs.chmodSync(path.join(root, f), 0o644); },
  malformed: (root, f) => { fs.writeFileSync(path.join(root, f), '{"truncated":'); },
  newer,
  link: (root, f) => { const away = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-link-')), to = path.join(away, path.basename(f)); fs.copyFileSync(path.join(root, f), to); fs.unlinkSync(path.join(root, f)); fs.symlinkSync(to, path.join(root, f)); }
};
/* Every command that reads them; the asks use keys of their own, so a write would be a new file. */
const PARENT_READERS = (root, sp) => ({
  run: ['run', root, PR, '--contract', '2', '--json'],
  /* YD: the list of runs reads every listed run's spread dependencies too. */
  runs: ['runs', root, '--contract', '2', '--json'],
  next: ['next', root, PR, '--contract', '2', '--json'],
  'todo list': ['todo', 'list', root, PR, '--json'],
  'spread list': ['spread', 'list', root, PR, '--json'],
  'spread sync --dry-run': ['spread', 'sync', root, PR, '--spread', sp.id, '--dry-run', '--json', ...TOOL],
  'spread include --dry-run': ['spread', 'include', root, PR, '--spread', sp.id, '--item', 'ABC-101', '--key', 'wa-inc', '--dry-run', '--json', ...TOOL],
  'spread stop --dry-run': ['spread', 'stop', root, PR, '--spread', sp.id, '--reason', 'Not needed', '--key', 'wa-stop', '--dry-run', '--json', ...TOOL],
  'spread sync': ['spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL],
  'spread include': ['spread', 'include', root, PR, '--spread', sp.id, '--item', 'ABC-101', '--key', 'wa-inc', '--json', ...TOOL],
  'spread stop': ['spread', 'stop', root, PR, '--spread', sp.id, '--reason', 'Not needed', '--key', 'wa-stop', '--json', ...TOOL]
});
/* ZD: the list of runs reads a listed story's parents too, as the story's own reader does. */
const CHILD_READERS = (root) => ({ 'story run': ['run', root, KID, '--contract', '2', '--json'], 'story next': ['next', root, KID, '--contract', '2', '--json'], 'story todo list': ['todo', 'list', root, KID, '--json'], 'story runs': ['runs', root, '--contract', '2', '--json'],
  /* AC: filtered lists read the story's parents whatever they list. */
  'story runs --process': ['runs', root, '--process', 'validate-story', '--contract', '2', '--json'], 'story runs --status': ['runs', root, '--status', 'running', '--contract', '2', '--json'] });
/* A problem names it: the file, its folder, or a folder above it. */
const names = (p, f) => { const q = String(p.path || '').replace(/\/$/, ''); return q === f || q === path.posix.dirname(f) || (q && f.indexOf(q + '/') === 0); };
/* The set-up every cell starts from. */
async function world() {
  const F = await spread();
  const s = json('spread', 'sync', F.root, PR, '--spread', F.sp.id, '--json', ...TOOL);
  assert.strictEqual(s.code, 0, 'set-up: synced ' + JSON.stringify(s).slice(0, 300));
  assert.ok(await decideAll(F.d, KID, 'person-avery') >= 1, 'set-up: ABC-102\'s addition decided');
  await land(F.d, KID);
  await F.scope('s2', [101, 102, 103, 104]); await F.kid(104);
  const s2 = json('spread', 'sync', F.root, PR, '--spread', F.sp.id, '--json', ...TOOL);
  assert.strictEqual(s2.code, 0, 'set-up: ABC-104 asked ' + JSON.stringify(s2).slice(0, 300));
  return F;
}
const CELLS = [];
Object.keys(KINDS).forEach(kind => Object.keys(MODES).forEach(mode => CELLS.push([kind, mode])));
for (const [kind, mode] of CELLS) {
  rule('WA: ' + kind + ', ' + mode + ': every reader exits 4 naming it, with an incomplete envelope, and nothing is written', async () => {
    if (mode === 'unreadable' && process.getuid && process.getuid() === 0) return;
    const { root, sp } = await world();
    const [where, whose] = KINDS[kind], f = where(root);
    assert.ok(f && fs.existsSync(path.join(root, f)), kind + ': set-up, its file (' + f + ')');
    const ok = (JSON.stringify(json(...PARENT_READERS(root, sp)['spread list']).code));
    assert.strictEqual(ok, '0', 'set-up: everything reads before it is broken');
    const undo = MODES[mode](root, f);
    const off = [], R0 = Object.assign({}, whose !== 'child' ? PARENT_READERS(root, sp) : {}, whose !== 'parent' ? CHILD_READERS(root) : {});
    for (const rd of Object.keys(R0)) {
      const before = state(root), r = json(...R0[rd]), after = state(root);
      const named = (r.problems || []).some(p => names(p, f));
      if (r.code !== 4 || !named) off.push(rd + ' · exit ' + r.code + (named ? '' : ' · not named: ' + JSON.stringify((r.problems || []).map(p => p.path))) + (r.error ? ' · ' + r.error.kind + ': ' + String(r.error.why).slice(0, 100) : ''));
      /* XC: exit 4, an incomplete envelope and a named path, always together. */
      const four = r.code === 4, incomplete = r.complete === false, paths = (r.problems || []).length > 0 && (r.problems || []).every(p => p.path);
      if (four !== incomplete || incomplete !== paths) off.push(rd + ' · exit ' + r.code + ', complete ' + r.complete + ', ' + (r.problems || []).length + ' problems');
      /* YD: the list of runs counts the parent's to-dos as held while what its spread depends on can't be read (a parent it
         can only show by name, its own version newer, carries no counts). */
      if (/^story runs/.test(rd) && r.data) { const kr = (r.data.runs || []).filter(x => x.process + '/' + x.id === KID)[0]; if (kr && kr.todoCounts && kr.todoCounts.held !== true) off.push('story runs · todoCounts ' + JSON.stringify(kr.todoCounts)); }
      if (rd === 'runs' && r.data) { const pr = (r.data.runs || []).filter(x => x.process + '/' + x.id === PR)[0]; if (pr && pr.todoCounts && pr.todoCounts.held !== true) off.push('runs · todoCounts ' + JSON.stringify(pr.todoCounts)); }
      if (JSON.stringify(before) !== JSON.stringify(after)) off.push(rd + ' · wrote ' + Object.keys(after).filter(k => before[k] !== after[k]).join(', '));
    }
    if (undo) undo();
    assert.deepStrictEqual(off, [], kind + ', ' + mode);
  });
}
/* AC: with every dependency present, the filtered lists read as the full one does: complete, and the story's to-dos held only
   as they are there. */
rule('AC: filtered runs, with the parent present, are complete and count the story\'s to-dos as the full list does', async () => {
  const { root } = await world();
  const kidOf = (r) => (r.data.runs || []).filter(x => x.process + '/' + x.id === KID)[0];
  const full = json('runs', root, '--contract', '2', '--json');
  assert.strictEqual(full.code, 0, 'set-up: ' + JSON.stringify(full.problems));
  for (const args of [['--process', 'validate-story'], ['--status', 'running']]) {
    const r = json('runs', root, ...args, '--contract', '2', '--json');
    assert.deepStrictEqual([r.code, r.complete, r.problems, kidOf(r).todoCounts], [0, true, [], kidOf(full).todoCounts], args.join(' '));
  }
});
/* Review round 10 (BC): every filter runs accepts judges each listed story's parent dependencies before the problems are
   collected, then filters: the parent absent, unreadable (EIO), malformed, newer, or its applied work (the application its
   living.head names) missing. A filter that lists the story exits 4 naming the parent's path, incomplete, with the story's
   to-dos held; one that lists no story depending on it (planned) still keeps exit 4, an incomplete envelope and a path
   together. [args, whether the story is ended first] */
const BC_FILTERS = {
  'no filter': [[], false],
  '--process validate-story': [['--process', 'validate-story'], false],
  '--status running': [['--status', 'running'], false],
  '--status ended': [['--status', 'ended'], true],
  '--status all': [['--status', 'all'], false],
  '--status planned': [['--status', 'planned'], false],
  '--process validate-story --status ended': [['--process', 'validate-story', '--status', 'ended'], true]
};
const BC_PARENT = {
  absent: (root) => ['runs/' + PR + '/run.json', MODES.absent],
  EIO: (root) => ['runs/' + PR + '/run.json', MODES.unreadable],
  malformed: (root) => ['runs/' + PR + '/run.json', MODES.malformed],
  newer: (root) => ['runs/' + PR + '/run.json', newer],
  'missing application': (root) => ['proposals/' + jsonOf(root, 'runs/' + PR + '/run.json').living.head + '.json', MODES.absent]
};
for (const filter of Object.keys(BC_FILTERS)) {
  rule('BC: runs ' + filter + ' judges a listed story\'s parent first: absent, EIO, malformed, newer, missing application', async () => {
    const [args, end] = BC_FILTERS[filter], off = [];
    for (const how of Object.keys(BC_PARENT)) {
      if (how === 'EIO' && process.getuid && process.getuid() === 0) continue;
      const { root } = await world();
      if (end) { const kf = 'runs/' + KID + '/run.json', k = jsonOf(root, kf), at = new Date().toISOString(); k.ended = { outcome: 'Completed', by: 'person-avery', at }; k.state = 'completed'; fs.writeFileSync(path.join(root, kf), JSON.stringify(k, null, 2)); }
      const base = json('runs', root, ...args, '--contract', '2', '--json');
      const listed = (r) => (r.data && r.data.runs || []).filter(x => x.process + '/' + x.id === KID)[0];
      if (base.code !== 0) { off.push(how + ' · set-up: exit ' + base.code + ' ' + JSON.stringify(base.problems)); continue; }
      const [f, brk] = BC_PARENT[how](root), undo = brk(root, f);
      const before = state(root), r = json('runs', root, ...args, '--contract', '2', '--json');
      const four = r.code === 4, incomplete = r.complete === false, paths = (r.problems || []).length > 0 && (r.problems || []).every(p => p.path);
      if (four !== incomplete || incomplete !== paths) off.push(how + ' · exit ' + r.code + ', complete ' + r.complete + ', ' + (r.problems || []).length + ' problems');
      if (listed(base)) {
        const named = (r.problems || []).some(p => names(p, f));
        if (r.code !== 4 || !named) off.push(how + ' · exit ' + r.code + (named ? '' : ' · not named: ' + JSON.stringify((r.problems || []).map(p => p.path))));
        const kr = listed(r);
        if (kr && kr.todoCounts && kr.todoCounts.held !== true) off.push(how + ' · todoCounts ' + JSON.stringify(kr.todoCounts));
      } else if (filter !== '--status planned') off.push(how + ' · set-up: the story isn\'t listed');
      if (JSON.stringify(before) !== JSON.stringify(state(root))) off.push(how + ' · wrote');
      if (undo) undo();
    }
    assert.deepStrictEqual(off, [], filter);
  });
}
/* Review round 11 (EC): runs --process <the parent's process> loads the listed parent's spread dependencies (its stories'
   runs and their versions) before coverage, whatever the filter leaves out: a story's run absent or EIO, or its version
   missing or EIO, exits 4 naming it with the parent's to-dos held; healthy, the parent reads exactly as in the full list. */
const EC_BREAK = {
  'a story\'s run absent': [() => 'runs/' + KID + '/run.json', MODES.absent],
  'a story\'s run EIO': [() => 'runs/' + KID + '/run.json', MODES.unreadable],
  'its version missing': [(root) => files(root).find(f => /^publications\/validate-story\/[^/]+\/publication\.json$/.test(f)), MODES.absent],
  'its version EIO': [(root) => files(root).find(f => /^publications\/validate-story\/[^/]+\/publication\.json$/.test(f)), MODES.unreadable]
};
rule('EC: runs --process <parent> loads its stories\' runs and versions first: absent, EIO, version missing or EIO; healthy reads as the full list', async () => {
  const off = [], args = ['--process', PR.split('/')[0]], prOf = (r) => (r.data && r.data.runs || []).filter(x => x.process + '/' + x.id === PR)[0];
  {
    const { root } = await world();
    const full = json('runs', root, '--contract', '2', '--json'), one = json('runs', root, ...args, '--contract', '2', '--json');
    if (full.code !== 0 || one.code !== 0) off.push('healthy · exit ' + full.code + '/' + one.code + ' ' + JSON.stringify(one.problems));
    else if (JSON.stringify(prOf(full)) !== JSON.stringify(prOf(one))) off.push('healthy · differs: ' + JSON.stringify(prOf(one)).slice(0, 300) + ' vs ' + JSON.stringify(prOf(full)).slice(0, 300));
  }
  for (const how of Object.keys(EC_BREAK)) {
    if (/EIO/.test(how) && process.getuid && process.getuid() === 0) continue;
    const { root } = await world();
    const [where, brk] = EC_BREAK[how], f = where(root), undo = brk(root, f);
    const before = state(root), r = json('runs', root, ...args, '--contract', '2', '--json');
    const named = (r.problems || []).some(p => names(p, f));
    if (r.code !== 4 || !named) off.push(how + ' · exit ' + r.code + (named ? '' : ' · not named: ' + JSON.stringify((r.problems || []).map(p => p.path))));
    const four = r.code === 4, incomplete = r.complete === false, paths = (r.problems || []).length > 0 && (r.problems || []).every(p => p.path);
    if (four !== incomplete || incomplete !== paths) off.push(how + ' · exit ' + r.code + ', complete ' + r.complete + ', ' + (r.problems || []).length + ' problems');
    const pr = prOf(r);
    if (pr && pr.todoCounts && pr.todoCounts.held !== true) off.push(how + ' · todoCounts ' + JSON.stringify(pr.todoCounts));
    if (JSON.stringify(before) !== JSON.stringify(state(root))) off.push(how + ' · wrote');
    if (undo) undo();
  }
  assert.deepStrictEqual(off, []);
});
run();
