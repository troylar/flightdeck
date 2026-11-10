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
const CHILD_READERS = (root) => ({ 'story run': ['run', root, KID, '--contract', '2', '--json'], 'story next': ['next', root, KID, '--contract', '2', '--json'], 'story todo list': ['todo', 'list', root, KID, '--json'] });
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
      if (rd === 'runs' && r.data) { const pr = (r.data.runs || []).filter(x => x.process + '/' + x.id === PR)[0]; if (pr && pr.todoCounts && pr.todoCounts.held !== true) off.push('runs · todoCounts ' + JSON.stringify(pr.todoCounts)); }
      if (JSON.stringify(before) !== JSON.stringify(after)) off.push(rd + ' · wrote ' + Object.keys(after).filter(k => before[k] !== after[k]).join(', '));
    }
    if (undo) undo();
    assert.deepStrictEqual(off, [], kind + ', ' + mode);
  });
}
run();
