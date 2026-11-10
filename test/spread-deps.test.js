// Review round 5 (WA, docs/design.md 45.1): what a spread depends on is expected, present and checked, never "nothing there".
// One table: every kind of dependency (a scope record, the spread-add proposal, the application living.head names, the
// decision it saw, an item's run, an item's version, the run's own version) broken every way a reader meets (absent,
// unreadable, malformed, newer, a link), read by every command that depends on it (run, next, todo list, spread list, and
// sync, include and stop, previewed and asked). Every cell: exit 4, the path named, nothing written.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { rule, run } = require('./harness');
const { PF, json, PR, TOOL, spread } = require('./spread-fixture');
const T = PF.todos;

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');
/* Every file and link under root, by name, size and time, read with lstat only (an unreadable file is still listed). */
const state = (root) => { const out = {}; const walk = (x) => fs.readdirSync(x, { withFileTypes: true }).forEach(e => { const p = path.join(x, e.name), st = fs.lstatSync(p); if (e.isDirectory()) walk(p); else out[rel(root, p)] = st.size + ':' + st.mtimeMs; }); walk(root); return out; };
const files = (root) => Object.keys(state(root));
const jsonOf = (root, f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const findRec = (root, test) => files(root).filter(f => /^proposals\/req-[^/]+\.json$/.test(f)).find(f => { try { return test(jsonOf(root, f), f); } catch (e) { return false; } });

/* Where each kind of dependency is, once the spread is applied and synced. */
const KINDS = {
  'a scope record': (root) => findRec(root, (j) => j.observation !== undefined),
  'the spread-add proposal': () => 'proposals/' + T.idFor('release-helper', 'sec-1') + '.json',
  'the application living.head names': (root) => 'proposals/' + jsonOf(root, 'runs/' + PR + '/run.json').living.head + '.json',
  'the decision its application saw': (root) => findRec(root, (j, f) => f.indexOf(T.idFor('release-helper', 'sec-1') + '.status-w') === 'proposals/'.length),
  'an item\'s run': () => 'runs/validate-story/k102/run.json',
  'an item\'s version': (root) => files(root).find(f => /^publications\/validate-story\/[^/]+\/publication\.json$/.test(f)),
  'the run\'s own version': (root) => files(root).find(f => /^publications\/release-readiness\/[^/]+\/publication\.json$/.test(f))
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
  absent: (root, f, kind) => { const dirKind = /run\.json$|publication\.json$/.test(f); if (dirKind) fs.rmSync(path.dirname(path.join(root, f)), { recursive: true }); else fs.unlinkSync(path.join(root, f)); },
  unreadable: (root, f) => { fs.chmodSync(path.join(root, f), 0); return () => fs.chmodSync(path.join(root, f), 0o644); },
  malformed: (root, f) => { fs.writeFileSync(path.join(root, f), '{"truncated":'); },
  newer,
  link: (root, f) => { const away = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-link-')), to = path.join(away, path.basename(f)); fs.copyFileSync(path.join(root, f), to); fs.unlinkSync(path.join(root, f)); fs.symlinkSync(to, path.join(root, f)); }
};
/* Every command that reads them; the asks use keys of their own, so a write would be a new file. */
const READERS = (root, sp) => ({
  run: ['run', root, PR, '--contract', '2', '--json'],
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
/* A problem names it: the file, its folder, or a folder above it. */
const names = (p, f) => { const q = String(p.path || '').replace(/\/$/, ''); return q === f || q === path.posix.dirname(f) || (q && f.indexOf(q + '/') === 0); };
const CELLS = [];
Object.keys(KINDS).forEach(kind => Object.keys(MODES).forEach(mode => CELLS.push([kind, mode])));
for (const [kind, mode] of CELLS) {
  rule('WA: ' + kind + ', ' + mode + ': every reader exits 4 naming it, and nothing is written', async () => {
    if (mode === 'unreadable' && process.getuid && process.getuid() === 0) return;
    const { root, sp } = await spread();
    const s = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL);
    assert.strictEqual(s.code, 0, 'set-up: synced ' + JSON.stringify(s).slice(0, 300));
    const f = KINDS[kind](root);
    assert.ok(f && fs.existsSync(path.join(root, f)), kind + ': set-up, its file (' + f + ')');
    const undo = MODES[mode](root, f, kind);
    const off = [], R0 = READERS(root, sp);
    for (const rd of Object.keys(R0)) {
      const before = state(root), r = json(...R0[rd]), after = state(root);
      const named = (r.problems || []).some(p => names(p, f));
      if (r.code !== 4 || !named) off.push(rd + ' · exit ' + r.code + (named ? '' : ' · not named: ' + JSON.stringify((r.problems || []).map(p => p.path))) + (r.error ? ' · ' + r.error.kind + ': ' + String(r.error.why).slice(0, 100) : ''));
      if (JSON.stringify(before) !== JSON.stringify(after)) off.push(rd + ' · wrote ' + Object.keys(after).filter(k => before[k] !== after[k]).join(', '));
    }
    if (undo) undo();
    assert.deepStrictEqual(off, [], kind + ', ' + mode);
  });
}
run();
