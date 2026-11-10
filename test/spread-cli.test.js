// flightdeck spread (4.0, docs/apps.md, docs/design.md 45.1): a standing requirement on a loop. add, include and stop each ask
// the parent run with exactly one request, once; sync asks each story's own run for it, one request per obligation, named by
// the obligation, so an interruption between any two leaves the rest standing and the next sync asks only what is missing.
// --dry-run and list write nothing; the CLI never decides and never writes run.json.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { rule, run } = require('./harness');
const { PF, BIN, cli, json, AT, DiskFS, CHILD, PARENT, people, PEOPLE, obs, PR, hex, folder, ls, snap, runFile, read, decideAll, land, TOOL, ADD, spread } = require('./spread-fixture');
const R = PF.run, T = PF.todos, LP = PF.loop;
rule('list and add --dry-run write nothing; add writes exactly one request, once; the same key with other content is refused', async () => {
  const { root, kid, scope } = await folder();
  await kid(101, true); await kid(102); await kid(103); await scope('s1', [101, 102, 103]);
  const before = snap(root);
  const l0 = json('spread', 'list', root, PR, '--json');
  assert.deepStrictEqual([l0.code, l0.data.spreads, l0.data.requests], [0, [], []]);
  const p = json('spread', 'add', root, PR, ...ADD, '--key', 'sec-1', '--dry-run', '--json', ...TOOL);
  assert.strictEqual(p.code, 0, JSON.stringify(p));
  const id = T.idFor('release-helper', 'sec-1');
  assert.deepStrictEqual([p.data.status, p.data.request.id, p.data.op, p.data.authority.needs, p.data.consequence.releases, p.data.queue, p.data.scope], ['would-request', id, 'spread-add', 'person', false, 'Waiting for approval', { open: 2, unchanged: 1 }]);
  assert.ok(/preview only; no files written\.\n\nRequire "Security sign-off" on 2 open stories, and on every story that joins later; 1 cleared story stays unchanged\./.test(p.data.preview), p.data.preview);
  const text = cli('spread', 'add', root, PR, ...ADD, '--key', 'sec-1', '--dry-run', ...TOOL);
  assert.strictEqual(text.code, 0, text.out); assert.ok(/Require "Security sign-off" on 2 open stories/.test(text.out), text.out);
  assert.deepStrictEqual(snap(root), before, 'nothing written');
  const a = json('spread', 'add', root, PR, ...ADD, '--key', 'sec-1', '--json', ...TOOL);
  assert.deepStrictEqual([a.code, a.data.status, ls(root).filter(n => n.indexOf(id) === 0)], [0, 'requested', [id + '.json']]);
  const f = JSON.parse(fs.readFileSync(path.join(root, 'proposals', id + '.json'), 'utf8'));
  assert.deepStrictEqual([f.kind, f.op, f.loopStep, f.text, f.child, f.decision], ['proposal', 'spread-add', 'each', 'Security sign-off', { beforeGate: 'assess-confirm' }, undefined]);
  const n = ls(root).length;
  const again = json('spread', 'add', root, PR, ...ADD, '--key', 'sec-1', '--json', '--tool', 'release-helper@1.5.0');
  assert.deepStrictEqual([again.code, again.data.status, ls(root).length], [0, 'already', n]);
  const other = json('spread', 'add', root, PR, '--loop', 'each', '--text', 'Legal sign-off', '--before', 'assess-confirm', '--key', 'sec-1', '--json', ...TOOL);
  assert.deepStrictEqual([other.code, other.error.kind, ls(root).length], [1, 'key-taken', n]);
  assert.ok(/text/.test(other.error.why), other.error.why);
  assert.strictEqual(fs.readFileSync(runFile(root, PR), 'utf8'), before['runs/release-readiness/r-41/run.json'], 'the CLI never writes run.json');
});

rule('Once landed, list shows one spread row: open stories owed, cleared ones unchanged, each story\'s state', async () => {
  const { root, sp } = await spread();
  assert.deepStrictEqual([sp.text, sp.loop, sp.beforeGate, sp.row, sp.preview], ['Security sign-off', 'each', 'assess-confirm', 'Security sign-off · on 2 stories · 0 done', '2 open stories; 1 cleared story unchanged']);
  assert.deepStrictEqual(sp.items.map(i => [i.key, i.owed, i.state]), [['ABC-101', false, 'exempt'], ['ABC-102', true, 'owed'], ['ABC-103', true, 'owed']]);
  assert.ok(sp.holds.length === 2, JSON.stringify(sp.holds));
  const text = cli('spread', 'list', root, PR);
  assert.strictEqual(text.code, 0, text.out);
  assert.ok(/Security sign-off · on 2 stories · 0 done/.test(text.out) && /2 open stories; 1 cleared story unchanged/.test(text.out), text.out);
});

rule('sync --dry-run writes nothing; sync asks each owed story\'s own run once; a retry asks nothing new', async () => {
  const { root, sp } = await spread(), before = snap(root);
  const p = json('spread', 'sync', root, PR, '--spread', sp.id, '--dry-run', '--json', ...TOOL);
  assert.strictEqual(p.code, 0, JSON.stringify(p));
  assert.deepStrictEqual(p.data.items.map(i => [i.key, i.run, i.status, i.needs]), [['ABC-102', 'validate-story/k102', 'would-request', 'person'], ['ABC-103', 'validate-story/k103', 'would-request', 'person']]);
  assert.deepStrictEqual(p.data.skipped, [], 'a story cleared when it was added owes nothing, so nothing is skipped');
  assert.deepStrictEqual(snap(root), before, 'nothing written');
  const s = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL);
  assert.deepStrictEqual([s.code, s.data.status, s.data.items.map(i => i.status)], [0, 'synced', ['requested', 'requested']]);
  const files = s.data.items.map(i => i.file.slice('proposals/'.length));
  files.forEach(n => { const f = JSON.parse(fs.readFileSync(path.join(root, 'proposals', n), 'utf8')); assert.deepStrictEqual([f.op, f.text, f.fulfills.spread, f.target], ['add', 'Security sign-off', sp.id, { phase: 'assess' }]); });
  const n = ls(root).length;
  /* Another tool, the same obligations: the same requests. */
  const again = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', '--tool', 'other-bot@2.0');
  assert.deepStrictEqual([again.code, again.data.items.length, ls(root).length], [0, 0, n], JSON.stringify(again.data));
  const l = json('spread', 'list', root, PR, '--json');
  assert.deepStrictEqual(l.data.spreads[0].items.map(i => [i.key, i.state]), [['ABC-101', 'exempt'], ['ABC-102', 'waiting'], ['ABC-103', 'waiting']]);
  assert.strictEqual(fs.readFileSync(runFile(root, 'validate-story/k102'), 'utf8'), before['runs/validate-story/k102/run.json'], 'no child run.json written');
});

rule('An interruption between any two child requests leaves the others standing; the next sync asks only what is missing, once', async () => {
  for (let at = 0; at < 3; at++) {
    const F = await folder();
    await F.kid(101); await F.kid(102); await F.kid(103); await F.scope('s1', [101, 102, 103]);
    json('spread', 'add', F.root, PR, ...ADD, '--key', 'sec-1', '--json', ...TOOL);
    await decideAll(F.d, PR, 'person-morgan'); await land(F.d, PR);
    const sp = json('spread', 'list', F.root, PR, '--json').data.spreads[0];
    const p = json('spread', 'sync', F.root, PR, '--spread', sp.id, '--dry-run', '--json', ...TOOL), names = p.data.items.map(i => i.file.slice('proposals/'.length));
    assert.strictEqual(names.length, 3);
    /* The write of the at-th request can't happen (something stands where it goes). */
    const block = path.join(F.root, 'proposals', names[at]);
    fs.mkdirSync(block, { recursive: true });
    const s = json('spread', 'sync', F.root, PR, '--spread', sp.id, '--json', ...TOOL);
    assert.deepStrictEqual([s.code, s.data.status, s.data.partial], [4, 'partial', true], 'interrupted at ' + at);
    assert.deepStrictEqual(s.data.items.map(i => i.status), names.map((n, i) => i === at ? 'failed' : 'requested'));
    names.forEach((n, i) => { if (i !== at) assert.ok(fs.statSync(path.join(F.root, 'proposals', n)).isFile(), n); });
    fs.rmdirSync(block);
    const n0 = ls(F.root).length;
    const s2 = json('spread', 'sync', F.root, PR, '--spread', sp.id, '--json', ...TOOL);
    assert.deepStrictEqual([s2.code, s2.data.items.map(i => [i.file.slice('proposals/'.length), i.status])], [0, [[names[at], 'requested']]], 'only the missing one: ' + JSON.stringify(s2.data.items));
    assert.strictEqual(ls(F.root).length, n0 + 1);
    const s3 = json('spread', 'sync', F.root, PR, '--spread', sp.id, '--json', ...TOOL);
    assert.deepStrictEqual([s3.code, s3.data.items.length, ls(F.root).length], [0, 0, n0 + 1]);
  }
});

rule('A story that joins later is owed at once: list says it joined, and sync asks its run', async () => {
  const F = await spread();
  await F.kid(104); await F.scope('s2', [101, 102, 103, 104]);
  const l = json('spread', 'list', F.root, PR, '--json'), sp = l.data.spreads[0];
  const it = sp.items.filter(i => i.key === 'ABC-104')[0];
  assert.deepStrictEqual([it.owed, it.arrival, it.state], [true, true, 'owed']);
  assert.ok(sp.notices.some(n => /^ABC-104 joined\. Security sign-off is owed; not requested yet\./.test(n)), JSON.stringify(sp.notices));
  const s = json('spread', 'sync', F.root, PR, '--spread', sp.id, '--json', ...TOOL);
  assert.deepStrictEqual(s.data.items.map(i => i.key), ['ABC-102', 'ABC-103', 'ABC-104']);
});

rule('include asks to cover a cleared story, --run binds it to one run; stop needs a reason and keeps what is owed; all need a person', async () => {
  const { root, sp } = await spread();
  const inc = json('spread', 'include', root, PR, '--spread', sp.id, '--item', 'ABC-101', '--key', 'inc-1', '--dry-run', '--json', ...TOOL);
  assert.deepStrictEqual([inc.code, inc.data.op, inc.data.authority.needs], [0, 'spread-include', 'person'], JSON.stringify(inc));
  const bind = json('spread', 'include', root, PR, '--spread', sp.id, '--item', 'ABC-102', '--run', 'validate-story/k102', '--key', 'bind-1', '--dry-run', '--json', ...TOOL);
  assert.deepStrictEqual([bind.code, bind.data.op], [0, 'spread-bind'], JSON.stringify(bind));
  const s0 = json('spread', 'stop', root, PR, '--spread', sp.id, '--key', 'stop-1', '--json', ...TOOL);
  assert.deepStrictEqual([s0.code, s0.error.kind], [1, 'usage']); assert.ok(/--reason/.test(s0.error.why));
  const st = json('spread', 'stop', root, PR, '--spread', sp.id, '--reason', 'Not needed for 4.1', '--key', 'stop-1', '--json', ...TOOL);
  assert.deepStrictEqual([st.code, st.data.status, st.data.op, st.data.consequence.releases, st.data.authority.needs], [0, 'requested', 'spread-stop', true, 'person'], JSON.stringify(st));
  const f = JSON.parse(fs.readFileSync(path.join(root, 'proposals', st.data.request.id + '.json'), 'utf8'));
  assert.deepStrictEqual(f.owed, [{ uid: 'jira:10102', attempt: 1 }, { uid: 'jira:10103', attempt: 1 }]);
  const nope = json('spread', 'include', root, PR, '--spread', 'sp-nope', '--item', 'ABC-101', '--key', 'inc-2', '--json', ...TOOL);
  assert.deepStrictEqual([nope.code, nope.error.kind], [1, 'invalid']);
});

rule('Usage: a missing tool, key, spread or reason, an unknown flag, --dry-run on list: each named, nothing written', async () => {
  const { root, kid, scope } = await folder();
  await kid(101); await scope('s1', [101]);
  const before = snap(root);
  const bad = [
    ['spread', 'add', root, PR, ...ADD, '--key', 'k', '--json'],
    ['spread', 'add', root, PR, ...ADD, '--json', ...TOOL],
    ['spread', 'add', root, PR, '--loop', 'each', '--key', 'k', '--json', ...TOOL],
    ['spread', 'sync', root, PR, '--json', ...TOOL],
    ['spread', 'list', root, PR, '--dry-run', '--json'],
    ['spread', 'list', root, PR, '--wat', '--json'],
    ['spread', 'frob', root, PR, '--json'],
    ['spread', 'include', root, PR, '--spread', 'x', '--item', 'ABC-101', '--attempt', '0', '--key', 'k', '--json', ...TOOL],
  ];
  bad.forEach(a => { const r = json(...a); assert.deepStrictEqual([r.code, r.error.kind], [1, 'usage'], a.join(' ') + ': ' + JSON.stringify(r)); });
  assert.strictEqual(json('spread', 'list', root, 'release-readiness/nope', '--json').code, 5);
  const notLoop = json('spread', 'add', root, PR, '--loop', 'ship1', '--text', 'x', '--before', 'assess-confirm', '--key', 'k', '--json', ...TOOL);
  assert.deepStrictEqual([notLoop.code, notLoop.error.kind], [1, 'invalid']); assert.ok(/isn't a loop/.test(notLoop.error.why));
  assert.deepStrictEqual(snap(root), before, 'nothing written');
});

rule('A record this depends on that can\'t be read holds sync (exit 4) and writes nothing', async () => {
  const { root, sp } = await spread();
  fs.writeFileSync(path.join(root, 'proposals', 'req-zzzzzzzzzzzzzzzzzzzzzzzz.json'), '{"format":"flightdeck-plan/4",');
  const before = snap(root);
  const s = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL);
  assert.strictEqual(s.code, 4, JSON.stringify(s));
  assert.deepStrictEqual(snap(root), before, 'nothing written');
});

rule('SA: stop is refused (exit 4, nothing written) while a scope record of the loop is missing; list says coverage is incomplete', async () => {
  const { root, d, sp } = await spread();
  /* A scope record whose predecessor hasn't arrived. */
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: 'r-41', step: 'each' }, observation: obs([101, 102, 103, 104]), changes: [] }, 's9', { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: ['req-release-helper-' + 'e'.repeat(24)], children: [], now: AT, app: '4.0.0' });
  await d.write('proposals/' + f.id + '.json', LP.text(f));
  const l = json('spread', 'list', root, PR, '--json');
  assert.deepStrictEqual([l.data.spreads[0].complete, l.data.spreads[0].items], [false, []]);
  const before = snap(root);
  const st = json('spread', 'stop', root, PR, '--spread', sp.id, '--reason', 'Not needed', '--key', 'stop-h', '--json', ...TOOL);
  assert.deepStrictEqual([st.code, st.data && st.data.status], [4, 'held'], JSON.stringify(st));
  assert.ok(/can't all be read/.test(st.data.preview), st.data.preview);
  assert.deepStrictEqual(snap(root), before, 'nothing written');
});

/* Review round 2 (TE): incomplete coverage is never read as empty coverage: every spread subcommand holds (exit 4) with the
   reason, and list exits 4 with it too. */
rule('TE: sync, its dry run, include and list all hold (exit 4) with the reason while a scope record of the loop is missing', async () => {
  const { root, d, sp } = await spread();
  const c = LP.cleanIntent({ loop: { process: 'release-readiness', run: 'r-41', step: 'each' }, observation: obs([101, 102, 103, 104]), changes: [] }, 's9', { name: 'release-helper', version: '1.0' });
  const f = LP.buildRequest(c.intent, { seen: ['req-release-helper-' + 'e'.repeat(24)], children: [], now: AT, app: '4.0.0' });
  await d.write('proposals/' + f.id + '.json', LP.text(f));
  const before = snap(root);
  for (const args of [['sync'], ['sync', '--dry-run'], ['include', '--item', 'ABC-101', '--key', 'inc-h', '--reason', 'x']]) {
    const x = json('spread', args[0], root, PR, '--spread', sp.id, ...args.slice(1), '--json', ...TOOL);
    assert.deepStrictEqual([x.code, x.data && x.data.status, x.data && x.data.partial], [4, 'held', undefined], args.join(' ') + ': ' + JSON.stringify(x));
    assert.ok(/scope record/.test(x.data.why || ''), args.join(' ') + ': ' + JSON.stringify(x.data));
  }
  assert.deepStrictEqual(snap(root), before, 'nothing written');
  const l = json('spread', 'list', root, PR, '--json');
  assert.deepStrictEqual([l.code, l.data.spreads[0].complete], [4, false], JSON.stringify(l));
  assert.ok(l.data.held.some((h) => /scope record/.test(h)), JSON.stringify(l.data.held));
  const tx = cli('spread', 'sync', root, PR, '--spread', sp.id, ...TOOL);
  assert.ok(tx.code === 4 && !/synced|Asked 0/.test(tx.out) && /scope record/.test(tx.out), tx.out);
});

/* A story's run made living: its recorder adds and lands a plain to-do of its own. */
async function living(d, key) {
  const W = await read(d), x = W.runs.find(y => y.process + '/' + y.id === key);
  const P = T.prepare(x, { body: { op: 'add', text: 'Own work', target: { phase: 'assess' } }, by: { person: 'person-avery' }, key: 'own-' + hex(), records: W.records, unread: W.unread, people: PEOPLE, at: AT, app: '4.0.0' });
  assert.ok(!P.why, P.why);
  await d.write('proposals/' + P.name, T.text(P.file));
  await land(d, key);
}
rule('SG: run on a living story reads its spread request as every window does: waiting, never held for a dependency it can read', async () => {
  const { root, d, sp } = await spread();
  await living(d, 'validate-story/k102');
  const s = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL);
  const q = s.data.items.filter(i => i.key === 'ABC-102')[0];
  const r = json('run', root, 'validate-story/k102', '--contract', '2', '--json');
  assert.strictEqual(r.code, 0, JSON.stringify(r).slice(0, 400));
  const got = r.data.run.todoRequests.filter(x => x.id === q.request)[0];
  assert.deepStrictEqual([got && got.status, got && got.why], ['waiting', got && got.why], JSON.stringify(r.data.run.todoRequests));
});
rule('SH: a story\'s spread request that can\'t be read makes the parent\'s run and next exit 4, naming the file', async () => {
  const { root, sp } = await spread();
  const s = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL);
  const file = s.data.items[0].file, full = path.join(root, file), j = JSON.parse(fs.readFileSync(full, 'utf8'));
  j.text = 123; fs.writeFileSync(full, JSON.stringify(j, null, 2));
  for (const cmd of ['run', 'next']) {
    const r = json(cmd, root, PR, '--contract', '2', '--json');
    assert.strictEqual(r.code, 4, cmd + ': ' + JSON.stringify(r).slice(0, 300));
    assert.ok(r.problems.some(p => p.path === file), cmd + ': ' + JSON.stringify(r.problems));
  }
});
/* Review round 2 (TG): the other direction. A story's request depends on its parent's records (fulfills.run): one of those that
   can't be read, or is newer, makes the story's run and next exit 4, naming it, living or not. */
rule('TG: a parent record a story\'s spread request depends on that can\'t be read makes the story\'s run and next exit 4, naming it', async () => {
  for (const how of ['malformed', 'newer']) {
    const { root, d, sp } = await spread();
    await living(d, 'validate-story/k102');
    json('spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL);
    const file = 'proposals/' + T.idFor('release-helper', 'sec-1') + '.json', full = path.join(root, file), j = JSON.parse(fs.readFileSync(full, 'utf8'));
    assert.strictEqual(j.op, 'spread-add', 'set-up: the parent\'s spread-add');
    if (how === 'malformed') j.text = 123; else j.format = 'flightdeck-plan/5';
    fs.writeFileSync(full, JSON.stringify(j, null, 2));
    for (const key of ['validate-story/k102', 'validate-story/k103']) for (const cmd of ['run', 'next']) {
      const r = json(cmd, root, key, '--contract', '2', '--json');
      assert.strictEqual(r.code, 4, how + ' ' + key + ' ' + cmd + ': ' + JSON.stringify(r).slice(0, 300));
      assert.ok(r.problems.some(p => p.path === file), how + ' ' + key + ' ' + cmd + ': ' + JSON.stringify(r.problems));
    }
  }
});
/* Review round 3 (UC): every dependency a spread's coverage reads, not only to-do records: an item's run.json that can't be
   read, is malformed or newer, and a scope record of the loop that is damaged or newer, makes the parent's run, next and
   spread list exit 4 naming the file. */
rule('UC: an item\'s run file or a loop scope record that can\'t be read makes the parent\'s run, next and spread list exit 4, naming it', async () => {
  const cases = [
    ['malformed run', (root) => { const f = 'runs/validate-story/k102/run.json'; fs.writeFileSync(path.join(root, f), '{"format": "preflight-run/3", "id":'); return f; }],
    ['newer run', (root) => { const f = 'runs/validate-story/k102/run.json', j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); j.format = 'preflight-run/9'; fs.writeFileSync(path.join(root, f), JSON.stringify(j, null, 2)); return f; }],
    ['unreadable run', (root) => { const f = 'runs/validate-story/k102/run.json'; fs.chmodSync(path.join(root, f), 0); return f; }],
    ['damaged scope', (root) => { const n = ls(root).find(x => { try { return JSON.parse(fs.readFileSync(path.join(root, 'proposals', x), 'utf8')).observation; } catch (e) { return false; } }); const f = 'proposals/' + n, j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); j.observation.reported = 'many'; fs.writeFileSync(path.join(root, f), JSON.stringify(j, null, 2)); return f; }],
    ['newer scope', (root) => { const n = ls(root).find(x => { try { return JSON.parse(fs.readFileSync(path.join(root, 'proposals', x), 'utf8')).observation; } catch (e) { return false; } }); const f = 'proposals/' + n, j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); j.features = (j.features || []).concat(['teleport']); fs.writeFileSync(path.join(root, f), JSON.stringify(j, null, 2)); return f; }]
  ];
  for (const [how, damage] of cases) {
    if (how === 'unreadable run' && process.getuid && process.getuid() === 0) continue;
    const { root } = await spread();
    const file = damage(root);
    for (const args of [['run', root, PR, '--contract', '2', '--json'], ['next', root, PR, '--contract', '2', '--json'], ['spread', 'list', root, PR, '--json']]) {
      const r = json(...args);
      assert.strictEqual(r.code, 4, how + ' ' + args[0] + ': ' + JSON.stringify(r).slice(0, 300));
      assert.ok((r.problems || []).some(p => p.path === file), how + ' ' + args[0] + ': ' + JSON.stringify(r.problems));
    }
    if (how === 'unreadable run') fs.chmodSync(path.join(root, file), 0o644);
  }
});
/* Review round 4 (VA): one dependency reader for every command. Table-driven: every kind of dependency a run's to-dos and
   spreads read, broken every way it can be, read by every command that reads it: exit 4, naming the file. */
const BROKEN = {
  malformed: (root, f) => { fs.writeFileSync(path.join(root, f), '{"truncated":'); },
  unreadable: (root, f) => { fs.chmodSync(path.join(root, f), 0); },
  newer: (root, f) => {
    const full = path.join(root, f), j = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (/run\.json$/.test(f)) j.format = 'preflight-run/9';
    else if (j.observation !== undefined) j.features = (j.features || []).concat(['teleport']);
    else j.format = String(j.format).replace(/\/4$/, '/5');
    fs.writeFileSync(full, JSON.stringify(j, null, 2));
  },
  nofile: (root, f) => { const dir = path.dirname(path.join(root, f)); fs.unlinkSync(path.join(root, f)); fs.writeFileSync(path.join(dir, 'notes-w1.jsonl'), ''); }
};
const walkFiles = (root) => { const out = []; const walk = (x) => fs.readdirSync(x, { withFileTypes: true }).forEach(e => { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(root, p).split(path.sep).join('/')); }); walk(root); return out; };
const PARENT_READERS = (root, sp) => ({
  run: ['run', root, PR, '--contract', '2', '--json'],
  next: ['next', root, PR, '--contract', '2', '--json'],
  'spread list': ['spread', 'list', root, PR, '--json'],
  'spread sync': ['spread', 'sync', root, PR, '--spread', sp.id, '--dry-run', '--json', ...TOOL],
  'spread stop': ['spread', 'stop', root, PR, '--spread', sp.id, '--reason', 'Not needed', '--key', 'va-stop', '--dry-run', '--json', ...TOOL],
  'todo list': ['todo', 'list', root, PR, '--json']
});
const KID = 'validate-story/k102';
const CHILD_READERS = (root) => ({ run: ['run', root, KID, '--contract', '2', '--json'], next: ['next', root, KID, '--contract', '2', '--json'], 'todo list': ['todo', 'list', root, KID, '--json'] });
/* [kind, how its file is found, failure modes, readers, whose readers] */
const DEPS = [
  ['an item\'s run file', (root) => 'runs/' + KID + '/run.json', ['malformed', 'unreadable', 'newer', 'nofile'], ['run', 'next', 'spread list', 'spread sync', 'spread stop'], 'parent'],
  ['an item\'s publication', (root) => walkFiles(root).find(f => /^publications\/validate-story\/.*\/publication\.json$/.test(f)), ['malformed', 'unreadable'], ['run', 'next', 'spread list', 'spread sync', 'spread stop'], 'parent'],
  ['an item\'s to-do record', (root, s) => s.data.items[0].file, ['malformed', 'unreadable', 'newer'], ['run', 'next', 'spread list', 'spread sync', 'spread stop'], 'parent'],
  ['a loop scope record', (root) => walkFiles(root).find(f => { if (!/^proposals\/req-/.test(f)) return false; try { return JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')).observation !== undefined; } catch (e) { return false; } }), ['malformed', 'unreadable', 'newer'], ['run', 'next', 'spread list', 'spread sync', 'spread stop'], 'parent'],
  ['the run\'s own to-do record', () => 'proposals/' + T.idFor('release-helper', 'sec-1') + '.json', ['malformed', 'unreadable', 'newer'], ['run', 'next', 'spread list', 'todo list'], 'parent'],
  ['its parent\'s record a story\'s request depends on', () => 'proposals/' + T.idFor('release-helper', 'sec-1') + '.json', ['malformed', 'unreadable', 'newer'], ['run', 'next', 'todo list'], 'child']
];
for (const [kind, fileOf, modes, readers, whose] of DEPS) {
  rule('VA: ' + kind + ' that is ' + modes.join(', ') + ' makes ' + readers.join(', ') + ' exit 4, naming it', async () => {
    const off = [];
    for (const mode of modes) {
      if (mode === 'unreadable' && process.getuid && process.getuid() === 0) continue;
      const { root, sp } = await spread();
      const s = json('spread', 'sync', root, PR, '--spread', sp.id, '--json', ...TOOL);
      const file = fileOf(root, s);
      assert.ok(file && fs.existsSync(path.join(root, file)), kind + ': set-up, its file');
      BROKEN[mode](root, file);
      const R0 = whose === 'child' ? CHILD_READERS(root) : PARENT_READERS(root, sp);
      for (const rd of readers) {
        const r = json(...R0[rd]);
        if (r.code !== 4 || !(r.problems || []).some(p => p.path === file || p.path === file.replace(/[^/]+$/, ''))) off.push(mode + ' · ' + rd + ' · exit ' + r.code + ' · ' + JSON.stringify((r.problems || []).map(p => p.path)) + (r.error ? ' · ' + r.error.why : ''));
      }
      if (mode === 'unreadable') fs.chmodSync(path.join(root, file), 0o644);
    }
    assert.deepStrictEqual(off, [], kind);
  });
}
/* Review round 4 (VD): sync says, item by item, which approvals its additions would send back, so consent can be asked. */
rule('VD: sync names each addition that would send an approval back, in JSON and in text, and the skill asks first', async () => {
  const { root, sp } = await spread();
  const f = runFile(root, 'validate-story/k102'), c = R.sanitize(JSON.parse(fs.readFileSync(f, 'utf8'))), m = R.mapOf(c);
  R.done(c, m, 'verdict', 'person-avery', AT, { decision: 'needs-work' }); R.pass(c, m, 0, 'person-avery', AT);
  const raw = JSON.parse(JSON.stringify(c, (k, v) => k.charAt(0) === '_' ? undefined : v)); fs.writeFileSync(f, JSON.stringify(raw, null, 2));
  const j = json('spread', 'sync', root, PR, '--spread', sp.id, '--dry-run', '--json', ...TOOL);
  const it = j.data.items.filter(i => i.key === 'ABC-102')[0], other = j.data.items.filter(i => i.key === 'ABC-103')[0];
  assert.deepStrictEqual([it && it.consequence && it.consequence.reopens, other && other.consequence && other.consequence.reopens], [['gate:assess-confirm'], []], JSON.stringify(j.data.items));
  const tx = cli('spread', 'sync', root, PR, '--spread', sp.id, '--dry-run', ...TOOL).out;
  assert.ok(/ABC-102/.test(tx) && /sends? .*back for review|reopen/i.test(tx), tx);
  const skill = fs.readFileSync(path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', 'flightdeck-living-run', 'SKILL.md'), 'utf8');
  assert.ok(/sync[^\n]*consequence\.reopens[^\n]*ask the person first|ask the person first[^\n]*sync[^\n]*consequence\.reopens/i.test(skill), 'the skill asks before a sync that sends an approval back');
});
/* Review round 4 (VE): a retry under the same key means what it first meant: an omitted --attempt is the attempt it resolved
   to then, even after a new attempt started; an attempt said differently is still another request. */
rule('VE: an identical binding retry without --attempt says already after a new attempt starts; a changed --attempt is key-taken', async () => {
  const { root, kid, sp } = await spread();
  const args = ['spread', 'include', root, PR, '--spread', sp.id, '--item', 'ABC-101', '--run', 'validate-story/k101', '--key', 'bind-1', '--json', ...TOOL];
  const inc = ['spread', 'include', root, PR, '--spread', sp.id, '--item', 'ABC-101', '--key', 'inc-1', '--json', ...TOOL];
  const a = json(...args), i1 = json(...inc);
  assert.deepStrictEqual([a.code, a.data && a.data.status, i1.code, i1.data && i1.data.status], [0, 'requested', 0, 'requested'], JSON.stringify([a, i1]).slice(0, 400));
  await kid(101, false, 2);
  const i2 = json(...inc);
  assert.deepStrictEqual([i2.code, i2.data && i2.data.status], [0, 'already'], JSON.stringify(i2).slice(0, 400));
  const b = json(...args);
  assert.deepStrictEqual([b.code, b.data && b.data.status], [0, 'already'], JSON.stringify(b).slice(0, 400));
  const c = json(...args.slice(0, -3), '--attempt', '2', '--json', ...TOOL);
  assert.deepStrictEqual([c.code, c.error && c.error.kind], [1, 'key-taken'], JSON.stringify(c).slice(0, 400));
});
rule('SI: text-mode sync says partial and names each item not asked, with why', async () => {
  const { root, sp } = await spread();
  const p = json('spread', 'sync', root, PR, '--spread', sp.id, '--dry-run', '--json', ...TOOL), names = p.data.items.map(i => i.file.slice('proposals/'.length));
  fs.mkdirSync(path.join(root, 'proposals', names[1]));
  const t = cli('spread', 'sync', root, PR, '--spread', sp.id, ...TOOL);
  assert.strictEqual(t.code, 4, t.out);
  assert.ok(/partly synced/i.test(t.out), t.out);
  assert.ok(new RegExp(p.data.items[1].key + '[^\\n]*not asked[^\\n]*: ').test(t.out), 'the item and why: ' + t.out);
  assert.ok(!new RegExp(p.data.items[0].key + '[^\\n]*not asked').test(t.out), t.out);
});
rule('SJ: the living-run skill lets the assistant add work and facts within its task without asking; consent only to drop, move, stop or reopen', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', 'flightdeck-living-run', 'SKILL.md'), 'utf8');
  assert.ok(!/(person said in their|person's) own words/.test(t) && !/the person asked for may go on/.test(t), 'no consent asked for an assistant\'s own addition');
  assert.ok(/you found while doing the task/.test(t), 'an addition the assistant found within its task proceeds');
  assert.ok(/Ask the person first[^\n]*drop[^\n]*move[^\n]*stop[^\n]*approval/.test(t), 'consent kept for dropping, moving, stopping and reopening');
});
/* Review round 5 (R1–R3): the release text says what this branch ships: spreads in 4.0.0's notes, no facts in the living-run
   skill (slice 4 adds them), and design section 45 describing slices 1 to 3 as built. */
rule('R1–R3: 4.0.0\'s notes name spreads, the living-run skill names no facts, and section 45 says slices 1 to 3 are built', () => {
  const root = path.join(__dirname, '..');
  const rel = JSON.parse(fs.readFileSync(path.join(root, 'src', 'releases.json'), 'utf8')).filter(x => x.version === '4.0.0')[0];
  assert.ok(rel && rel.changes.some(c => /spread/i.test(c.title + ' ' + c.now)), 'R1: 4.0.0 names spreads');
  assert.ok(/spread/i.test(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split('## 3.0.1')[0]), 'R1: and so does CHANGELOG.md');
  const skill = fs.readFileSync(path.join(root, 'example-folder', '.flightdeck', 'skills', 'flightdeck-living-run', 'SKILL.md'), 'utf8');
  assert.ok(!/\bfacts?\b/i.test(skill), 'R2: ' + (skill.match(/[^\n]*\bfacts?\b[^\n]*/i) || [])[0]);
  const d = fs.readFileSync(path.join(root, 'docs', 'design.md'), 'utf8'), s45 = d.slice(d.indexOf('## 45. Living runs'), d.indexOf('### 45.1'));
  const status = (s45.match(/Status: [^\n]*/) || [''])[0];
  assert.ok(!/Partly built|Slice 2 adds/.test(status) && /slices? 1[^\n]*3/i.test(status), 'R3: ' + status);
});
run();
