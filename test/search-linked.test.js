// Linked runs with Jira searches (2.16, sections 5.7.4 and 5.9 R14-3/R14-5): a child whose search was reopened when read
// doesn't settle its parent, the folder pass marks a settled parent without changing it, Folder health names both, and
// linking walks each upward edge only while it holds, refusing loops and chains over 16.
'use strict';
const assert = require('assert');
const { load, rule, run, exactOf } = require('./harness');
const PF = load(), R = PF.run, M = PF.map, P = PF.publish;
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const NOW = '2026-11-04T15:00:00.000Z', LATER = '2026-11-04T15:10:00.000Z';
const TV = PF.teamValues.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'jira-base-url': { value: 'https://jira.example.com' } } }));
function publish(md) {
  const b = P.build(md, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.16.0', teamValues: TV });
  assert.ok(!b.blockers, (b.blockers || []).join(' | '));
  const v = P.verify(b.folder, b.files, exactOf(PF, b.files)); assert.ok(v.ok, v.why); return v;
}
const KID_MD = ['---', 'process: kid', 'title: Kid', 'context: version', '---', '', '## Check · DO-CONFIRM {#check}',
  '- [!] {jira.search} No open blockers in ^version {#blockers}', '  query: fixVersion = ^version AND priority = Blocker AND status != Done', '  results: none', '', '## Gate: Ready {#ready}', ''].join('\n');
const KID = publish(KID_MD);
const PARENT_MD = ['---', 'process: par', 'title: Parent', 'context: version, n:number', '---', '', '## Build · DO-CONFIRM {#build}',
  '- [!] {run.process} Run the kid checks {#kid}', '  process: kid', '', '## Gate: Built {#built}', ''].join('\n');
const PARENT = publish(PARENT_MD);
const mk = (pub, id, o) => R.create(pub, Object.assign({ title: pub.map.meta.title, details: { version: '2026.11.0' }, roles: {}, by: 'person-avery', session: 'w-a', now: NOW, id, app: '2.16.0', teamValues: TV }, o || {}));
function completedKid(id) {
  const k = mk(KID, id || 'run-k12', { parent: { process: 'par', id: 'run-p1', step: 'kid' } }), map = R.mapOf(k), s = M.findStep(map, 'blockers').step;
  R.done(k, map, 'blockers', 'person-avery', LATER, { searchId: R.searchId(k, map, s), count: '0' }); R.pass(k, map, 0, 'person-avery', LATER);
  k.state = 'completed'; k.ended = { outcome: 'Completed', by: 'person-avery', byName: 'Avery', at: LATER };
  return k;
}
const reread = r => R.sanitize(JSON.parse(JSON.stringify(r)));
function edited(k) { const o = JSON.parse(JSON.stringify(k)); o.steps.blockers.values.count = '2'; return R.sanitize(o); }

rule('a child whose search was reopened when read doesn\'t settle its parent; as read it stands again after Done', () => {
  const k = completedKid(), ok = reread(k);
  assert.strictEqual(R.childCheck(ok), '');
  const bad = edited(k);
  assert.match(R.childCheck(bad), /its step "No open blockers in 2026\.11\.0" was reopened when read, so its completion doesn't stand/);
  assert.strictEqual(R.childOutcome(bad), 'review'); assert.strictEqual(R.childOutcome(ok), 'done');
  const p = mk(PARENT, 'run-p1'), pm = R.mapOf(p);
  p.steps.kid = { s: 'open', child: { process: 'kid', id: 'run-k12', inputs: { version: '2026.11.0' } } };
  const before = JSON.stringify(p);
  assert.throws(() => R.settleChild(p, pm, 'kid', bad, 'person-avery', LATER), /completed, but .*This step wasn't settled/);
  assert.strictEqual(JSON.stringify(p), before, 'a refusal changes nothing');
  R.done(bad, R.mapOf(bad), 'blockers', 'person-avery', LATER, { searchId: R.searchId(bad, R.mapOf(bad), M.findStep(R.mapOf(bad), 'blockers').step), count: '0' });
  assert.strictEqual(R.childCheck(reread(bad)), '');
});
rule('the folder pass marks a settled parent, names the child\'s reopened step, never changes a run; Folder health lists both', () => {
  const k = completedKid(), p = mk(PARENT, 'run-p1');
  p.steps.kid = { s: 'done', by: 'person-avery', at: LATER, child: { process: 'kid', id: 'run-k12', inputs: { version: '2026.11.0' } } };
  const runs = [reread(p), edited(k)], snap = JSON.stringify(runs), marks = R.childMarks(runs);
  assert.strictEqual(JSON.stringify(runs), snap);
  same(marks.map(m => [m.process, m.run, m.step, m.child, m.childStep]), [['par', 'run-p1', 'kid', 'kid/run-k12', 'blockers']]);
  assert.match(marks[0].text, /^settled by the Kid run \(run-k12\), which says Completed, but its step "No open blockers in 2026\.11\.0" was reopened when read, so its completion doesn't stand\. Open that run and answer its step "No open blockers in 2026\.11\.0" again with Done; this run then stands as recorded$/);
  same(R.childMarks([reread(p), reread(k)]), []);
  const h = PF.health.check({ data: { runs, people: [{ id: 'person-avery', name: 'Avery' }], processes: [] } }, Date.parse(LATER));
  const ids = h.issues.map(i => i.id);
  assert.ok(ids.indexOf('reopened:kid/run-k12/blockers') >= 0 && ids.indexOf('child-mark:par/run-p1/kid') >= 0, JSON.stringify(ids));
  assert.strictEqual(h.issues.filter(i => i.id === 'child-mark:par/run-p1/kid')[0].action.label, 'Open the linked run');
});
rule('R14-5: linking walks each upward edge only while it holds; over 16 in a chain is refused, and loops are', () => {
  const chain = [];
  for (let i = 0; i < 17; i++) chain.push(mk(PARENT, 'run-a' + i));
  for (let i = 0; i < 16; i++) { chain[i].steps.kid = { s: 'open', child: { process: 'par', id: 'run-a' + (i + 1) } }; chain[i + 1].parent = { process: 'par', id: 'run-a' + i, step: 'kid' }; }
  const find = k => chain.concat(extra).filter(r => r.process + '/' + r.id === k)[0];
  let extra = [];
  const T = chain[16], fresh = { process: 'kid', id: 'run-new', steps: {} };
  assert.match(R.linkShape(T, fresh, find), /more than 16 linked runs in one chain/);
  const save = JSON.stringify(chain[15].steps.kid);
  chain[15].steps.kid.child.retired = true; assert.strictEqual(R.linkShape(T, fresh, find), '', 'the nearest edge retired: linked');
  chain[15].steps.kid = { s: 'open', child: { process: 'par', id: 'run-other' } }; assert.strictEqual(R.linkShape(T, fresh, find), '', 'linking another run: linked');
  chain[15].steps.kid = JSON.parse(save);
  chain[0].steps.kid.child.retired = true; assert.match(R.linkShape(T, fresh, find), /more than 16/, 'the top ancestor\'s link retired: 17 in the chain, refused');
  chain[0].steps.kid.child.retired = false; chain[8].steps.kid.child.retired = true; assert.strictEqual(R.linkShape(T, fresh, find), '', 'an edge 8 levels up gone: linked');
  chain[8].steps.kid.child.retired = false;
  chain[0].steps.kid = { s: 'open', child: { process: 'par', id: 'run-a1' } };
  assert.match(R.linkShape(chain[5], { process: 'par', id: 'run-a2', steps: {} }, find), /would make a loop: the Parent run \(run-a2\) is already above this one/);
  const unbacked = mk(PARENT, 'run-u'); unbacked.parent = { process: 'par', id: 'run-x', step: 'kid' }; extra = [unbacked, mk(PARENT, 'run-x')];
  assert.strictEqual(R.linkShape(unbacked, { process: 'par', id: 'run-x', steps: {} }, find), '', 'a parent record its parent\'s step doesn\'t back isn\'t a loop');
  find('par/run-x').steps.kid = { s: 'open', child: { process: 'par', id: 'run-u' } };
  assert.match(R.linkShape(unbacked, { process: 'par', id: 'run-x', steps: {} }, find), /loop/);
  const down = mk(PARENT, 'run-d'); down.steps.kid = { s: 'open', child: { process: 'par', id: 'run-a3' } }; extra = [down];
  assert.match(R.linkShape(chain[3], down, find), /its linked runs lead back/);
});

rule('conditional child: a reopened search on a step the child doesn\'t need leaves its completion standing; on one it needs, it doesn\'t', () => {
  const CK = publish(['---', 'process: ck', 'title: Ck', 'context: version, risk:choice(low|high)', '---', '', '## Check · DO-CONFIRM {#check}',
    '- [ ] {confirm} Look {#look}', '- [!] {jira.search} No open blockers in ^version {#blockers}', '  only when ^risk is high', '  query: fixVersion = ^version AND priority = Blocker', '  results: none', '', '## Gate: Ready {#ready}', ''].join('\n'));
  const kid = (risk) => {
    const k = mk(CK, 'run-c' + risk, { details: { version: '2026.11.0', risk } }), map = R.mapOf(k);
    R.done(k, map, 'look', 'person-avery', LATER);
    if (risk === 'high') R.done(k, map, 'blockers', 'person-avery', LATER, { searchId: R.searchId(k, map, M.findStep(map, 'blockers').step), count: '0' });
    R.pass(k, map, 0, 'person-avery', LATER);
    k.state = 'completed'; k.ended = { outcome: 'Completed', by: 'person-avery', byName: 'Avery', at: LATER };
    const o = JSON.parse(JSON.stringify(k));
    o.steps.blockers = { s: 'done', by: 'person-avery', at: LATER, values: { searchId: 'sha256:' + '0'.repeat(64), count: '2' } };
    return R.sanitize(o);
  };
  const low = kid('low'), high = kid('high');
  assert.strictEqual(R.childCheck(low), '', 'not needed: its record doesn\'t decide the completion');
  assert.strictEqual(R.childOutcome(low), 'done');
  assert.match(R.childCheck(high), /was reopened when read, so its completion doesn't stand/);
  assert.strictEqual(R.childOutcome(high), 'review');
});
const TWO = publish(['---', 'process: two', 'title: Two', 'context: version', '---', '', '## Build · DO-CONFIRM {#build}',
  '- [ ] {run.process} Left {#l}', '  process: kid', '- [ ] {run.process} Right {#r}', '  process: kid', '', '## Gate: Built {#built}', ''].join('\n'));
const linkTo = (r, k) => { r.steps.kid = { s: 'open', child: { process: 'par', id: k } }; };
rule('linking walks the loaded child, not the link\'s descriptor: a loop below it and too many links below it are refused', () => {
  const T = mk(PARENT, 'run-t'), c = [0, 1, 2, 3].map(i => mk(PARENT, 'run-c' + i));
  for (let i = 0; i < 4; i++) linkTo(c[i], 'run-c' + ((i + 1) % 4));
  T.steps.kid = { s: 'open' };
  const all = [T].concat(c), find = k => all.filter(r => r.process + '/' + r.id === k)[0], before = JSON.stringify(T);
  assert.throws(() => R.linkChild(T, R.mapOf(T), 'kid', { process: 'par', id: 'run-c0', inputs: {} }, 'person-avery', LATER, { run: c[0], findRun: find }), /would make a loop/);
  assert.strictEqual(JSON.stringify(T), before, 'a refusal changes nothing');
  const tree = [];
  (function grow(id, d) {
    const n = mk(TWO, id); tree.push(n);
    if (d === 12) return;
    n.steps.l = { s: 'open', child: { process: 'two', id: id + 'l' } }; n.steps.r = { s: 'open', child: { process: 'two', id: id + 'r' } };
    grow(id + 'l', d + 1); grow(id + 'r', d + 1);
  })('run-w', 0);
  const findW = k => k === 'par/run-t' ? T : tree.filter(r => r.process + '/' + r.id === k)[0];
  assert.throws(() => R.linkChild(T, R.mapOf(T), 'kid', { process: 'two', id: 'run-w', inputs: {} }, 'person-avery', LATER, { run: tree[0], findRun: findW }), /more than 5,000 links below it/);
});
rule('the walk below the child finds a loop wholly below it, and measures the longest chain, not the shortest way to a run', () => {
  const T = mk(PARENT, 'run-t'), d = [0, 1, 2].map(i => mk(PARENT, 'run-d' + i));
  linkTo(d[0], 'run-d1'); linkTo(d[1], 'run-d2'); linkTo(d[2], 'run-d1');
  let all = [T].concat(d);
  const find = k => all.filter(r => r.process + '/' + r.id === k)[0];
  assert.match(R.linkShape(T, d[0], find), /would make a loop: its linked runs lead back to each other below it/);
  const e = []; for (let i = 0; i < 16; i++) e.push(mk(PARENT, 'run-e' + i));
  for (let i = 0; i < 15; i++) linkTo(e[i], 'run-e' + (i + 1));
  all = [T].concat(e);
  assert.match(R.linkShape(T, e[0], find), /more than 16 linked runs in one chain/, '17 in the chain: refused');
  const SC = PF.run.create(TWO, { title: 'Two', details: { version: '2026.11.0' }, roles: {}, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-e0', app: '2.16.0', teamValues: TV });
  SC.process = 'par'; SC.steps.l = { s: 'open', child: { process: 'par', id: 'run-e15' } }; SC.steps.r = { s: 'open', child: { process: 'par', id: 'run-e1' } };
  all = [T, SC].concat(e.slice(1));
  assert.match(R.linkShape(T, SC, find), /more than 16 linked runs in one chain/, 'a shortcut to the shared leaf doesn\'t shorten the longest chain');
  for (let i = 0; i < 14; i++) linkTo(e[i], 'run-e' + (i + 1)); e[14].steps.kid = { s: 'open' };
  all = [T].concat(e.slice(0, 15));
  assert.strictEqual(R.linkShape(T, e[0], find), '', '16 in the chain: linked');
});
const PLAIN = publish(['---', 'process: plain', 'title: Plain', 'context: version', '---', '', '## Check · DO-CONFIRM {#check}',
  '- [ ] {confirm} Look {#look}', '', '## Gate: Ready {#ready}', ''].join('\n'));
const PPAR = publish(['---', 'process: ppar', 'title: PParent', 'context: version', '---', '', '## Build · DO-CONFIRM {#build}',
  '- [!] {run.process} Run the plain checks {#kid}', '  process: plain', '', '## Gate: Built {#built}', ''].join('\n'));
rule('a new settlement asks every gate of a child without searches: Completed with a gate still open doesn\'t settle the step', () => {
  const k = mk(PLAIN, 'run-pl', { parent: { process: 'ppar', id: 'run-pp', step: 'kid' } });
  k.state = 'completed'; k.ended = { outcome: 'Completed', by: 'person-avery', byName: 'Avery', at: LATER };
  assert.match(R.childCheck(k), /its gate "Ready" reads open there, so its completion doesn't stand/);
  const p = mk(PPAR, 'run-pp'), pm = R.mapOf(p);
  p.steps.kid = { s: 'open', child: { process: 'plain', id: 'run-pl', inputs: { version: '2026.11.0' } } };
  const before = JSON.stringify(p);
  assert.throws(() => R.settleChild(p, pm, 'kid', k, 'person-avery', LATER), /This step wasn't settled/);
  assert.strictEqual(JSON.stringify(p), before);
  const ok = mk(PLAIN, 'run-pl', { parent: { process: 'ppar', id: 'run-pp', step: 'kid' } }), om = R.mapOf(ok);
  R.done(ok, om, 'look', 'person-avery', LATER); R.pass(ok, om, 0, 'person-avery', LATER);
  ok.state = 'completed'; ok.ended = { outcome: 'Completed', by: 'person-avery', byName: 'Avery', at: LATER };
  assert.strictEqual(R.childCheck(ok), '');
  p.steps.kid.s = 'done'; p.steps.kid.by = 'person-avery'; p.steps.kid.at = LATER;
  same(R.childMarks([R.sanitize(JSON.parse(JSON.stringify(p))), R.sanitize(JSON.parse(JSON.stringify(k)))]), [], 'a recorded parent answer isn\'t marked for a child without searches');
});
rule('the CLI names a linked-run mark as child-mark: runs and followups read partial, exit 4, with the data still printed', () => {
  const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
  const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-mark-'));
  const put = (rel, text) => { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  [['kid', KID_MD], ['par', PARENT_MD]].forEach(([proc, md]) => {
    const b = P.build(md, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.16.0', teamValues: TV });
    Object.keys(b.files).forEach(n => put('publications/' + proc + '/' + b.folder + '/' + n, b.files[n]));
  });
  put('people.json', JSON.stringify({ format: 'flightdeck-people/1', people: [{ id: 'person-avery', name: 'Avery' }] }));
  const k = completedKid(), p = mk(PARENT, 'run-p1');
  p.steps.kid = { s: 'done', by: 'person-avery', at: LATER, child: { process: 'kid', id: 'run-k12', inputs: { version: '2026.11.0' } } };
  const ko = JSON.parse(JSON.stringify(k)); ko.steps.blockers.values.count = '2';
  put('runs/kid/run-k12/run.json', JSON.stringify(ko, null, 2)); put('runs/par/run-p1/run.json', JSON.stringify(p, null, 2));
  ['runs', 'followups'].forEach(c => {
    const r = cp.spawnSync(process.execPath, [BIN, c, dir, '--contract', '2', '--json'], { encoding: 'utf8' });
    let j = null; try { j = JSON.parse(r.stdout); } catch (e) { /* named below */ }
    assert.ok(j && !j.error, c + ': ' + r.stdout + r.stderr);
    assert.strictEqual(r.status, 4, c + ': exit ' + r.status + ' ' + r.stderr);
    assert.strictEqual(j.complete, false);
    const m = j.problems.filter(x => x.kind === 'child-mark');
    same(m.map(x => x.path), ['runs/par/run-p1/run.json'], c + ': ' + JSON.stringify(j.problems));
    assert.match(m[0].why, /^Step "kid" was settled by the Kid run \(run-k12\), which says Completed, but its step "No open blockers in 2026\.11\.0" was reopened when read/);
    assert.ok(j.data && typeof j.data === 'object', 'data still printed');
  });
});
run();
