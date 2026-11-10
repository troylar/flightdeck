// Review rounds 5 and 6 (WA, XB, XC, docs/design.md 45.1): what a spread depends on is expected, present and checked, never
// "nothing there". One table: every kind of dependency (a scope record, a later scope record that brought an item in, the
// spread-add proposal, the application living.head names, the decision it saw, an item's run, its version, its own addition,
// decision and application, the run's own version) broken every way a reader meets (absent, unreadable, malformed, newer, a
// link), read by every command that depends on it (run, next, todo list, spread list, and sync, include and stop, previewed and
// asked; a story's own readers for what it fulfils). Every cell: exit 4, the path named, nothing written, and exit 4, an
// incomplete envelope and a named path always together (the app's cells: test/app-spread-deps.test.js). Slice 4 adds what a
// done on evidence depends on to the same table (ID, JC, JD, below).
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { rule, run } = require('./harness');
const { PF, json, PR, TOOL, AT, PEOPLE, spread, decideAll, land } = require('./spread-fixture');
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
/* ---- 4.0 slice 4 (ID, JC, JD): what a done on evidence depends on, in the same table. A story's two to-dos rest on one
   fact its parent's run has about it (ABC-102's PRs, observed twice: the second saw the first): one suggestion accepted and
   not yet applied, one still waiting for a decision. Every kind of thing they depend on, broken every way, is every reader's
   problem (the story's run, next, todo list and suggest-done; the facts' run's fact list and sync), and the guards hold:
   the waiting one can't be decided and the accepted one isn't applied. ---- */
const FX = PF.facts, BB = { feed: 'bitbucket', site: 'git.example.com' };
const ago = (ms) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const factIn = (root, o) => { const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-fin-')), 'in.json'); fs.writeFileSync(p, JSON.stringify({ facts: [o] })); return p; };
const prsObs = (key, state, hours) => ({ key, loopStep: 'each', item: 'ABC-102', source: BB, domain: 'prs', observedAt: ago(hours * 3600000), complete: true, reported: 1, entries: [{ id: '17', text: 'Fix the login', state }] });
const FTOOL = ['--tool', 'git-bot@1.0.0'];
/* What a window reads, for the guards: every run, record and version, through the input builder the app uses. */
async function windowOf(d) {
  const all = await PF.repo.loadAll(d, { explain: true, deep: true }), procOf = (id) => { const e = (all.processes || []).filter(p => p.process === id)[0], i = e && e.index; return i ? { latest: i.latest, all: i.all || [], clashes: i.clashes || [], broken: i.broken || [] } : null; };
  /* Every path the read failed on, as the app's Folder health has them: unreadable, missing, malformed, refused, and each
     version that can't be used. */
  const failed = [].concat(all.unreadable || [], all.nofile || [], all.malformed || [], all.refused || []).map(u => u && u.path).filter(Boolean)
    .concat(...(all.processes || []).map(p => (p.pubs || []).filter(x => !x.ok).map(x => 'publications/' + p.process + '/' + x.folder + '/')));
  return PF.spreads.inputs({ runs: all.runs || [], records: all.todos || [], unread: all.todosUnread || [], scopes: all.scopes || [], scopesUnread: all.scopesUnread || [], people: PEOPLE, procOf, processes: all.processes || [], procsRead: () => true, failed });
}
async function factWorld() {
  const F = await world();
  const kidTodo = json('todo', 'list', F.root, KID, '--json').data.todos.filter(x => x.state === 'open')[0];
  assert.ok(kidTodo, 'set-up: the story has its open to-do');
  const a = json('todo', 'add', F.root, KID, '--phase', 'assess', '--text', 'Merge the fix', '--key', 'id-td', '--json', ...TOOL);
  assert.strictEqual(a.code, 0, 'set-up: a second to-do ' + JSON.stringify(a).slice(0, 300));
  await decideAll(F.d, KID, 'person-avery'); await land(F.d, KID);
  const todos = json('todo', 'list', F.root, KID, '--json').data.todos.filter(x => x.state === 'open').map(x => x.id);
  assert.strictEqual(todos.length, 2, 'set-up: two open to-dos');
  assert.strictEqual(json('fact', 'sync', F.root, PR, '--from', factIn(F.root, prsObs('id-prs-1', 'open', 5)), '--json', ...FTOOL).code, 0, 'set-up: the first observation');
  assert.strictEqual(json('fact', 'sync', F.root, PR, '--from', factIn(F.root, prsObs('id-prs-2', 'merged', 1)), '--json', ...FTOOL).code, 0, 'set-up: the second, which saw the first');
  const f1 = FX.idFor('git-bot', 'id-prs-1'), f2 = FX.idFor('git-bot', 'id-prs-2');
  assert.deepStrictEqual(jsonOf(F.root, 'proposals/' + f2 + '.json').seen, [f1], 'set-up: the second saw the first');
  for (const t of todos) { const s = json('todo', 'suggest-done', F.root, KID, '--todo', t, '--fact', f2, '--json', ...FTOOL); assert.deepStrictEqual([s.code, s.data && s.data.status], [0, 'requested'], 'set-up: suggested ' + JSON.stringify(s).slice(0, 400)); }
  /* The first suggestion is accepted, and not applied yet. */
  const W = await windowOf(F.d), kid = W.runs.find(y => y.process + '/' + y.id === KID), its = T.inbox([kid], Object.assign({}, W, { me: 'person-avery', now: Date.now() })).filter(it => it.op === 'done');
  assert.strictEqual(its.length, 2, 'set-up: both wait for a decision ' + JSON.stringify(its.map(i => i.id)));
  const first = its.find(it => it.todo === todos[0]), second = its.find(it => it.todo === todos[1]);
  const dd = T.decide(kid, Object.assign({}, W, { request: first.id, op: 'accept', by: 'person-avery', shown: first.consequence.fingerprint, at: AT, writer: 'w00000a01', rev: '00000a01', app: '4.0.0', now: Date.now() }));
  assert.ok(!dd.why, 'set-up: accepted: ' + dd.why);
  await F.d.write('proposals/' + dd.name, T.text(dd.file));
  return Object.assign(F, { todos, f1, f2, accepted: first.id, waiting: second.id, waitingFp: second.consequence.fingerprint });
}
/* The guards as a window asks them, on the folder as it is: the waiting one can't be decided, the accepted one isn't applied. */
async function guards(F) {
  const off = [], W = await windowOf(F.d), kid = W.runs.find(y => y.process + '/' + y.id === KID);
  if (!kid) return off;
  const o = Object.assign({}, W, { people: PEOPLE, now: Date.now() });
  const dd = T.decide(kid, Object.assign({}, o, { request: F.waiting, op: 'accept', by: 'person-avery', shown: F.waitingFp, at: AT, writer: 'w00000a02', rev: '00000a02', app: '4.0.0' }));
  if (!dd.why) off.push('decide · the waiting suggestion could be accepted');
  const V = T.view(kid, Object.assign({}, o, { records: T.recordsFor(o.records, kid), deps: { records: o.records, unread: o.unread } })), q = V.requests[F.accepted];
  const plan = q ? T.applyPlan(kid, V, q, o) : { skip: 'gone' };
  if (plan.write || plan.adopt) off.push('apply · the accepted suggestion would be applied');
  return off;
}
const FACT_KINDS = {
  'a suggestion\'s fact': [(F) => 'proposals/' + F.f2 + '.json', 'both'],
  'a fact it saw': [(F) => 'proposals/' + F.f1 + '.json', 'both'],
  'the story\'s application head': [(F) => 'proposals/' + jsonOf(F.root, 'runs/' + KID + '/run.json').living.head + '.json', 'story'],
  'the run its facts are on': [() => 'runs/' + PR + '/run.json', 'story'],
  'the version its facts\' run runs on': [(F) => files(F.root).find(f => /^publications\/release-readiness\/[^/]+\/publication\.json$/.test(f)), 'both']
};
const STORY_READERS = (root, F) => ({
  'story run': ['run', root, KID, '--contract', '2', '--json'],
  'story next': ['next', root, KID, '--contract', '2', '--json'],
  'story todo list': ['todo', 'list', root, KID, '--json'],
  'story suggest-done --dry-run': ['todo', 'suggest-done', root, KID, '--todo', F.todos[1], '--fact', F.f2, '--dry-run', '--json', ...FTOOL],
  'story suggest-done': ['todo', 'suggest-done', root, KID, '--todo', F.todos[1], '--fact', F.f2, '--json', ...FTOOL],
  runs: ['runs', root, '--contract', '2', '--json']
});
const FACT_READERS = (root) => ({
  'fact list': ['fact', 'list', root, PR, '--json'],
  'fact sync --dry-run': ['fact', 'sync', root, PR, '--from', factIn(root, prsObs('id-prs-3', 'merged', 1)), '--dry-run', '--json', ...FTOOL],
  'fact sync': ['fact', 'sync', root, PR, '--from', factIn(root, prsObs('id-prs-3', 'merged', 1)), '--json', ...FTOOL]
});
/* refused (JC): a fact in a later format with its features gone, still a fact by its kind. */
/* refused (JC): a fact in a later format with its features gone is still a fact by its kind, refused by the to-do reader as
   newer, never read as a plan. */
const FACT_MODES = Object.assign({}, MODES, {
  refused: (root, f) => { const j = jsonOf(root, f); if (j.kind !== 'fact') return 'n/a'; j.format = 'flightdeck-plan/5'; delete j.features; fs.writeFileSync(path.join(root, f), JSON.stringify(j, null, 2)); }
});
for (const kind of Object.keys(FACT_KINDS)) for (const mode of Object.keys(FACT_MODES)) {
  if (mode === 'refused' && !/fact/.test(kind.replace(/facts/g, ''))) continue;
  rule('ID: ' + kind + ', ' + mode + ': every reader of a done on evidence exits 4 naming it, suggest-done is held, nothing is written, and the guards hold', async () => {
    if (mode === 'unreadable' && process.getuid && process.getuid() === 0) return;
    const F = await factWorld(), root = F.root;
    const [where, whose] = FACT_KINDS[kind], f = where(F);
    assert.ok(f && fs.existsSync(path.join(root, f)), kind + ': set-up, its file (' + f + ')');
    const R0 = Object.assign({}, STORY_READERS(root, F), whose === 'both' ? FACT_READERS(root) : {});
    /* What reads alone, without writing, reads whole before anything is broken. */
    for (const rd of Object.keys(R0).filter(k => !/^(story suggest-done|fact sync)$/.test(k))) { const r = json(...R0[rd]); assert.ok(r.code === 0 && r.complete !== false, 'set-up: ' + rd + ' reads before it is broken: ' + JSON.stringify(r).slice(0, 400)); }
    const undo = FACT_MODES[mode](root, f);
    if (undo === 'n/a') return;
    const off = [];
    for (const rd of Object.keys(R0)) {
      const before = state(root), r = json(...R0[rd]), after = state(root);
      const named = (r.problems || []).some(p => names(p, f));
      if (r.code !== 4 || !named) off.push(rd + ' · exit ' + r.code + (named ? '' : ' · not named: ' + JSON.stringify((r.problems || []).map(p => p.path))) + (r.error ? ' · ' + r.error.kind + ': ' + String(r.error.why).slice(0, 100) : ''));
      const four = r.code === 4, incomplete = r.complete === false, paths = (r.problems || []).length > 0 && (r.problems || []).every(p => p.path);
      if (four !== incomplete || incomplete !== paths) off.push(rd + ' · exit ' + r.code + ', complete ' + r.complete + ', ' + (r.problems || []).length + ' problems');
      if (/suggest-done|fact sync/.test(rd) && r.code === 4 && !(r.data && r.data.status === 'held')) off.push(rd + ' · status ' + (r.data && r.data.status));
      if (rd === 'story todo list' && r.data) { const q = (r.data.requests || []).filter(x => x.op === 'done' && x.status !== 'held'); if (q.length) off.push('todo list · ' + q.map(x => x.status).join(', ')); }
      if (JSON.stringify(before) !== JSON.stringify(after)) off.push(rd + ' · wrote ' + Object.keys(after).filter(k => before[k] !== after[k]).join(', '));
    }
    /* A link has no meaning in a browser folder (test/app-spread-deps.test.js), so the guards are asked of the other modes. */
    if (mode !== 'link') off.push(...await guards(F));
    if (typeof undo === 'function') undo();
    assert.deepStrictEqual(off, [], kind + ', ' + mode);
  });
}
/* JC: a later observation of the same slot in a later format, its features gone: still a fact by its kind, so it holds its
   slot (an observation can't be read), never reads as a plan, and what rests on that slot holds. */
rule('JC: a newer fact with its features gone holds its slot and every suggestion on it, named as a fact, never as a plan', async () => {
  const F = await factWorld(), root = F.root, o = jsonOf(root, 'proposals/' + F.f2 + '.json');
  const id = FX.idFor('git-bot', 'id-prs-newer'), n = Object.assign({}, o, { id, key: 'id-prs-newer', seen: [F.f2], format: 'flightdeck-plan/5', app: '9.0.0' });
  delete n.features;
  fs.writeFileSync(path.join(root, 'proposals', id + '.json'), JSON.stringify(n, null, 2));
  const off = [], p = 'proposals/' + id + '.json';
  const l = json('fact', 'list', root, PR, '--json'), it = (l.data && l.data.items || []).find((i) => i.key === 'ABC-102'), prs = it && it.facts.find((x) => x.domain === 'prs');
  if (!prs || prs.state !== 'held') off.push('fact list · prs ' + (prs && prs.state));
  for (const [rd, r] of [['fact list', l], ['story todo list', json('todo', 'list', root, KID, '--json')]]) {
    const named = (r.problems || []).filter((x) => x.path === p);
    if (r.code !== 4 || !named.length) off.push(rd + ' · exit ' + r.code + ' · ' + JSON.stringify(r.problems));
    else if (named[0].kind !== 'newer' || /\bplan\b/.test(named[0].why)) off.push(rd + ' · named as ' + named[0].kind + ': ' + named[0].why);
    if (rd === 'story todo list' && r.data) { const q = (r.data.requests || []).filter(x => x.op === 'done' && x.status !== 'held'); if (q.length) off.push('todo list · ' + q.map(x => x.status).join(', ')); }
  }
  off.push(...await guards(F));
  assert.deepStrictEqual(off, []);
});
run();
