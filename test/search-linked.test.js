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
const KID = publish(['---', 'process: kid', 'title: Kid', 'context: version', '---', '', '## Check · DO-CONFIRM {#check}',
  '- [!] {jira.search} No open blockers in ^version {#blockers}', '  query: fixVersion = ^version AND priority = Blocker AND status != Done', '  results: none', '', '## Gate: Ready {#ready}', ''].join('\n'));
const PARENT = publish(['---', 'process: par', 'title: Parent', 'context: version, n:number', '---', '', '## Build · DO-CONFIRM {#build}',
  '- [!] {run.process} Run the kid checks {#kid}', '  process: kid', '', '## Gate: Built {#built}', ''].join('\n'));
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

run();
