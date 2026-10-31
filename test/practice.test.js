// Practice a draft (2.2, docs/design.md section 34): edit-and-continue. Answers are kept by part ID with two fingerprints, an
// edit asks for another try where something changed, gates need a pass again when what they approved changed, and every
// rule about steps, gates and Next up is the run's own, read through a stand-in that is never a run.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { load, loadViews, rule, run, budget } = require('./harness');
const PF = load(), P = PF.practice, R = PF.run, O = PF.outline;
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const NOW = '2026-10-24T09:00:00.000Z';

const MD = ['---', 'process: rel', 'title: Release', 'context: env:choice(dev|prod), ticket', 'roles: lead', '---', '',
  '## Prepare · READ-DO {#prep}', '- [ ] {confirm} Write the notes {#notes}', '- [!] {confirm} Tag the build ^ticket {#tag}', '- [ ] {confirm} Tell the team {#tell}', '',
  '## Gate: Ready · owner @lead {#ready}', '  approves: release of ^ticket', '',
  '## Ship · DO-CONFIRM {#ship}', '- [ ] {confirm} Page on-call {#page}', '  only when ^env is prod', '- [!] {confirm} Deploy {#deploy}', ''].join('\n');

const admit = (md) => { const a = P.admit(md, {}); assert.ok(a.ok, a.why); return a.map; };
const step = (v, id) => { for (const p of v.phases) for (const s of p.steps) if (s.id === id) return s; return null; };
const phase = (v, id) => v.phases.find(p => p.id === id);
function act(st, map, id, how) { const r = P.answer(st, map, id, how || 'done', {}, NOW); assert.ok(r.state, r.error); return r.state; }
function gate(st, map, pi, how, reason) { const r = P.gateAct(st, map, pi, how || 'pass', reason, {}, NOW); assert.ok(r.state, r.error); return r.state; }
function prep(map) { let st = P.fresh('rel'); for (const id of ['notes', 'tag', 'tell']) st = act(st, map, id); return st; }

rule('a fresh practice: every step open, Next up is the first step, nothing complete', () => {
  const map = admit(MD), v = P.follow(P.fresh('rel'), map, {});
  same(v.phases[0].steps.map(s => s.status), ['open', 'open', 'open']);
  assert.strictEqual(v.nextUp.step, 'notes');
  assert.strictEqual(v.complete, false);
  assert.strictEqual(step(v, 'page').status, 'hidden', 'env not set: hidden, as in a run with env empty');
});

rule('checking keeps the answer through an unrelated edit, and a reworded step needs another try with its old answer', () => {
  let map = admit(MD), st = act(P.fresh('rel'), map, 'notes');
  st = act(st, map, 'tell');
  const md2 = MD.replace('Tell the team {#tell}', 'Tell the whole team {#tell}');
  const v = P.follow(st, admit(md2), {});
  assert.strictEqual(step(v, 'notes').status, 'done');
  assert.strictEqual(step(v, 'tell').status, 'again');
  assert.strictEqual(step(v, 'tell').old, 'done');
  // Undo of the edit: the same text again, the answer is back.
  assert.strictEqual(step(P.follow(st, admit(MD), {}), 'tell').status, 'done');
});

rule('a note, a screenshot caption, a must-do mark, the phase note or title, and order before it all count as changes', () => {
  const map = admit(MD), st = prep(map);
  const cases = {
    note: MD.replace('Tell the team {#tell}', 'Tell the team {#tell}\n  > in the channel'),
    shot: MD.replace('Tell the team {#tell}', 'Tell the team {#tell}\n  ![The channel](images/chan.png)'),
    must: MD.replace('- [ ] {confirm} Tell the team', '- [!] {confirm} Tell the team'),
    phaseNote: MD.replace('## Prepare · READ-DO {#prep}', '## Prepare · READ-DO {#prep}\n  > Before noon'),
    phaseTitle: MD.replace('## Prepare · READ-DO', '## Get ready · READ-DO'),
    order: MD.replace('- [ ] {confirm} Write the notes {#notes}\n- [!] {confirm} Tag the build ^ticket {#tag}', '- [!] {confirm} Tag the build ^ticket {#tag}\n- [ ] {confirm} Write the notes {#notes}')
  };
  for (const k of Object.keys(cases)) {
    const v = P.follow(st, admit(cases[k]), {});
    assert.strictEqual(step(v, 'tell').status, 'again', k);
  }
  // Reordering two steps: the one now earlier keeps nothing before it changed... the one after the swap point needs another try.
  const v = P.follow(st, admit(cases.order), {});
  assert.strictEqual(step(v, 'tag').status, 'again', 'what came before Tag changed');
});

rule('swapping two whole phases asks again for their steps', () => {
  const md = MD + '\n## Close · READ-DO {#close}\n- [ ] {confirm} Write it up {#writeup}\n';
  let map = admit(md), st = prep(map);
  st = gate(st, map, 0);
  st = act(st, map, 'deploy');
  const swapped = O.movePhase(md, 'ship', 1);
  assert.ok(swapped.text, swapped.error);
  const v = P.follow(st, admit(swapped.text), {});
  assert.strictEqual(step(v, 'deploy').status, 'again');
});

rule('a deleted step\'s answer is kept aside and comes back when the step does (delete, then Undo)', () => {
  const map = admit(MD), st0 = prep(map), del = O.deleteStep(MD, 'tell');
  const map2 = admit(del.text), st = P.settle(st0, map2, {});
  const v = P.follow(st, map2, {});
  same(v.gone, ['tell']);
  assert.strictEqual(step(P.follow(st, admit(MD), {}), 'tell').status, 'done');
});

rule('answers for parts no longer in the draft are capped at 50, oldest first', () => {
  let st = P.fresh('rel');
  for (let i = 0; i < 60; i++) st.answers['gone-' + i] = { s: 'done', at: '2026-10-24T09:' + String(i).padStart(2, '0') + ':00Z', own: '1', ctx: '1' };
  const out = P.settle(st, admit(MD), {});
  const left = Object.keys(out.answers);
  assert.strictEqual(left.length, 50);
  assert.ok(left.indexOf('gone-59') >= 0 && left.indexOf('gone-0') < 0);
});

rule('a builder re-ID copies the answer to the new ID as another try and keeps it under the old one (rename, Undo, Redo)', () => {
  const map = admit(MD), st0 = prep(map);
  const renamed = MD.replace('Tell the team {#tell}', 'Tell everyone {#tell-everyone}');
  const map2 = admit(renamed), st = P.settle(st0, map2, { tell: 'tell-everyone' });
  assert.strictEqual(step(P.follow(st, map2, {}), 'tell-everyone').status, 'again');
  assert.strictEqual(step(P.follow(st, admit(MD), {}), 'tell').status, 'done', 'Undo');
  let st2 = act(st, map2, 'tell-everyone');
  assert.strictEqual(step(P.follow(st2, admit(MD), {}), 'tell').status, 'done', 'Undo after a new answer');
  assert.strictEqual(step(P.follow(st2, map2, {}), 'tell-everyone').status, 'done', 'Redo keeps the new answer');
});

rule('parts without IDs get temporary ones, distinct when repeated, kept while unchanged', () => {
  const md = ['---', 'process: x', 'title: X', '---', '', '## One', '- [ ] {confirm} Same', '- [ ] {confirm} Same', '- [ ] {confirm} Other', ''].join('\n');
  const map = admit(md), ids = map.phases[0].steps.map(s => s.id);
  assert.strictEqual(new Set(ids).size, 3);
  assert.ok(ids.every(P.isTemp));
  assert.ok(map.phases[0].id && map.phases[0].gate.id, 'the phase and its automatic gate have IDs too');
  let st = act(P.fresh('x'), map, ids[2]);
  assert.strictEqual(P.follow(st, admit(md), {}).phases[0].steps[2].status, 'done');
  assert.strictEqual(P.follow(st, admit(md.replace('Other', 'Another')), {}).phases[0].steps[2].status, 'open', 'its identity is its text');
});

rule('gates: pass follows the run\'s rules, and a change to what it approved needs another pass', () => {
  const map = admit(MD);
  let st = P.fresh('rel');
  assert.ok(P.gateAct(st, map, 0, 'pass', '', {}, NOW).error, 'not ready yet');
  st = prep(map);
  st = gate(st, map, 0);
  let v = P.follow(st, map, {});
  assert.strictEqual(phase(v, 'prep').gate.status, 'passed');
  assert.strictEqual(v.nextUp.step, 'deploy');
  assert.ok(P.answer(st, map, 'notes', 'open', {}, NOW).error, 'a passed phase is closed');
  // The gate's own text changed: review, and later phases are locked.
  v = P.follow(st, admit(MD.replace('approves: release of ^ticket', 'approves: the release of ^ticket')), {});
  assert.strictEqual(phase(v, 'prep').gate.status, 'review');
  assert.strictEqual(phase(v, 'ship').gate.status, 'locked');
  // A step added to its phase: review; answering the new step doesn't restore the approval.
  const added = MD.replace('- [ ] {confirm} Tell the team {#tell}', '- [ ] {confirm} Tell the team {#tell}\n- [ ] {confirm} Check the date {#date}');
  const m2 = admit(added);
  assert.strictEqual(phase(P.follow(st, m2, {}), 'prep').gate.status, 'review');
  let st2 = gate(P.answer(st, m2, 'date', 'done', {}, NOW).state || st, m2, 0, 'reopen');
  st2 = act(st2, m2, 'date');
  assert.strictEqual(phase(P.follow(st2, m2, {}), 'prep').gate.status, 'ready', 'reopened, answered: ready to pass again, not passed');
});

rule('reopen clears this gate and every later one, as a run\'s reopen does', () => {
  const map = admit(MD);
  let st = gate(prep(map), map, 0);
  st = act(st, map, 'deploy');
  st = gate(st, map, 1);
  same(Object.keys(st.gates).sort(), ['ready', 'ship-confirm']);
  st = gate(st, map, 0, 'reopen');
  same(Object.keys(st.gates), []);
  same(R.reopenIds(map, 0), ['ready', 'ship-confirm']);
});

rule('waive needs a reason and every must-do step', () => {
  const map = admit(MD);
  let st = act(P.fresh('rel'), map, 'tag');
  assert.ok(P.gateAct(st, map, 0, 'waive', '', {}, NOW).error);
  st = gate(st, map, 0, 'waive', 'notes later');
  assert.strictEqual(phase(P.follow(st, map, {}), 'prep').gate.status, 'waived');
  assert.ok(P.gateAct(P.fresh('rel'), map, 0, 'waive', 'x', {}, NOW).error, 'Tag is a must-do');
});

rule('Not needed is refused on a must-do step, through the run\'s own rule', () => {
  const map = admit(MD), r = P.answer(P.fresh('rel'), map, 'tag', 'na', {}, NOW);
  assert.strictEqual(r.error, 'Must-do steps can\'t be N/A.');
  assert.strictEqual(P.follow(act(P.fresh('rel'), map, 'notes', 'na'), map, {}).phases[0].steps[0].status, 'skipped');
});

rule('samples: an empty one behaves as an empty run detail; a set one shows the step; changing it asks again', () => {
  const map = admit(MD);
  let st = P.setSample(P.fresh('rel'), map, 'env', 'prod').state;
  assert.strictEqual(step(P.follow(st, map, {}), 'page').status, 'open');
  assert.ok(P.setSample(st, map, 'env', 'staging').error, 'not one of the choices');
  st = gate(act(act(act(st, map, 'notes'), map, 'tag'), map, 'tell'), map, 0);
  st = act(st, map, 'page');
  const st2 = P.setSample(st, map, 'env', 'dev').state;
  assert.strictEqual(step(P.follow(st2, map, {}), 'page').status, 'hidden');
  const st3 = P.setSample(st2, map, 'env', 'prod').state;
  assert.strictEqual(step(P.follow(st3, map, {}), 'page').status, 'done', 'back to the value it was checked with');
  // A bound detail: the gate approves ^ticket; changing the sample puts it in review.
  const st4 = P.setSample(st, map, 'ticket', 'ABC-123').state;
  assert.strictEqual(phase(P.follow(st4, map, {}), 'prep').gate.status, 'review');
  assert.strictEqual(step(P.follow(st4, map, {}), 'tag').status, 'again', 'Tag binds ^ticket');
  assert.ok(P.setSample(st, map, 'nope', 'x').error);
});

rule('admission: authoring omissions are fine; errors, duplicates, unknown types and newer formats keep the last version', () => {
  assert.ok(P.admit(MD.replace(' {#notes}', ''), {}).ok, 'a missing ID is fine');
  assert.ok(P.admit(MD.replace('process: rel\n', ''), {}).ok, 'missing front-matter process is a publishing check');
  assert.ok(!P.admit(MD.replace('{#tell}', '{#notes}'), {}).ok, 'duplicate ID');
  assert.ok(/doesn't know/.test(P.admit(MD.replace('{confirm} Tell', '{made.up} Tell'), {}).why));
  assert.ok(!P.admit(MD.replace('title: Release', 'title: Release\nformat: flightdeck-checklist/99'), {}).ok, 'a newer format is refused');

});

rule('the stand-in reads as a solo run and is never a run: no id, snapshot or rev, and sanitize refuses it', () => {
  const map = admit(MD), r = P.asRun({ sample: {}, steps: {}, gates: {} }, map, 'person-avery');
  assert.strictEqual(r.practice, true);
  assert.ok(!('id' in r) && !('snapshot' in r) && !('rev' in r));
  assert.strictEqual(R.sanitize(JSON.parse(JSON.stringify(r))), null);
});

rule('every run reader practice uses reads only the stand-in\'s fields (true, false and unresolved conditions; passed, waived and review gates)', () => {
  const FIELDS = ['format', 'practice', 'state', 'paused', 'ended', 'recorder', 'roles', 'details', 'steps', 'gates', 'fields', 'migrations', 'followUps', 'log', 'marksFrom', 'memo', 'types', 'jira'];
  const md = MD + '\n## Close · READ-DO {#close}\n  only when ^env is dev\n- [ ] {confirm} Write it up {#writeup}\n';
  const map = admit(md);
  const states = [];
  let st = P.setSample(P.fresh('rel'), map, 'env', 'prod').state;
  states.push(st);
  st = gate(prep(map), map, 0); states.push(st);
  states.push(gate(act(P.fresh('rel'), map, 'tag'), map, 0, 'waive', 'later'));
  states.push(P.setSample(st, map, 'ticket', 'ABC-1').state);
  const bad = Object.assign(P.fresh('rel'), { sample: { env: 'staging' } }); states.push(bad);
  for (const s of states) {
    const d = P.derive(s, map, {}), stand = P.asRun(d.view, map, 'person-avery'), reads = new Set();
    const proxy = new Proxy(stand, { get(t, k) { if (typeof k === 'string') reads.add(k); return t[k]; }, has(t, k) { if (typeof k === 'string') reads.add(k); return k in t; } });
    map.phases.forEach((p, pi) => {
      R.applies(proxy, map, pi); p.steps.forEach(x => R.applies(proxy, map, pi, x));
      R.phaseInfo(proxy, map, pi); R.phaseOpen(proxy, map, pi); R.gateStatus(proxy, map, pi); R.canPass(proxy, map, pi); R.canWaive(proxy, map, pi); R.gateInputs(proxy, map, p.gate);
      p.steps.forEach(x => { R.answerable(proxy, map, x.id, 'done'); R.evidenceFor(proxy, x, null, map); R.checkEvidence(proxy, x, null, {}, false, map); R.jiraProblem(proxy, x); R.checkFill(proxy, x, {}, null); });
    });
    R.headline(proxy, map); R.nextUp(proxy, map, 'person-avery');
    const extra = [...reads].filter(k => FIELDS.indexOf(k) < 0);
    same(extra, [], 'read outside the stand-in: ' + extra.join(', '));
  }
});

rule('R.answerable: the general refusals only; done and na behave as before', () => {
  const map = admit(MD), r = P.asRun({ sample: {}, steps: {}, gates: {} }, map, null);
  assert.strictEqual(R.answerable(r, map, 'nope', 'done'), 'Unknown step.');
  assert.strictEqual(R.answerable(r, map, 'deploy', 'done'), 'That phase isn\'t open.');
  assert.strictEqual(R.answerable(r, map, 'tag', 'na'), 'Must-do steps can\'t be N/A.');
  assert.strictEqual(R.answerable(r, map, 'tag', 'done'), '');
  assert.ok(/isn't needed/.test(R.answerable(Object.assign({}, r, { gates: { ready: { s: 'passed', approved: { ticket: '' } } } }), map, 'page', 'done')));
});

rule('linked-run and evidence steps are marked simulated', () => {
  const md = MD.replace('- [ ] {confirm} Write the notes {#notes}', '- [ ] {confirm} Write the notes {#notes}\n  evidence: link\n- [ ] {run.process} Run the smoke checks {#smoke}\n  process: smoke');
  const v = P.follow(P.fresh('rel'), admit(md), {});
  assert.strictEqual(step(v, 'notes').simulated, 'evidence');
  assert.strictEqual(step(v, 'smoke').simulated, 'linked');
  assert.strictEqual(step(v, 'tell').simulated, false);
});

rule('complete only when everything that applies is through, never for a draft with nothing to do', () => {
  const empty = admit(['---', 'process: x', 'title: X', '---', ''].join('\n'));
  assert.strictEqual(P.follow(P.fresh('x'), empty, {}).complete, false);
  const map = admit(MD);
  let st = gate(prep(map), map, 0);
  st = gate(act(st, map, 'deploy'), map, 1);
  assert.strictEqual(P.follow(st, map, {}).complete, true);
});

rule('Reset keeps samples and findings; Undo puts back exactly what an action changed, and Redo again', () => {
  const map = admit(MD);
  let st = P.setFound(P.setSample(P.fresh('rel'), map, 'ticket', 'ABC-1').state, 'Notes step is vague').state;
  const before = st;
  st = act(st, map, 'notes');
  const e = P.undoEntry(before, st, 'Check');
  const u = P.applyEntry(st, e);
  same(u.state.answers, {});
  const re = P.applyEntry(u.state, u.back);
  assert.strictEqual(re.state.answers.notes.s, 'done');
  const rs = P.reset(re.state).state;
  same(rs.answers, {});
  assert.strictEqual(rs.sample.ticket, 'ABC-1');
  assert.strictEqual(rs.found, 'Notes step is vague');
  assert.ok(!('found' in e), 'findings are not in practice Undo');
});

rule('kept state: checked when read back, foreign or broken state starts fresh, within 64 KB', () => {
  const map = admit(MD), st = prep(map), back = P.check(JSON.parse(P.keep(st)), 'rel');
  same(back.answers, st.answers);
  assert.strictEqual(P.check(JSON.parse(P.keep(st)), 'other'), null);
  assert.strictEqual(P.check({ v: 2, process: 'rel', answers: {}, gates: {}, sample: {} }, 'rel'), null);
  const junk = Object.assign(P.fresh('rel'), { answers: { x: { s: 'evil', own: '1', ctx: '1' }, y: { s: 'done', own: 'zz', ctx: '1' } } });
  same(P.check(junk, 'rel').answers, {});
  // 300 answered steps fit; a huge practice drops answers, oldest first.
  const big = P.fresh('rel');
  for (let i = 0; i < 300; i++) big.answers['step-number-' + i] = { s: 'done', at: NOW, own: 'abcdef12', ctx: '12345678' };
  assert.ok(P.keep(big).length < P.CAP);
  for (let i = 300; i < 2000; i++) big.answers['step-number-' + i] = { s: 'done', at: '2026-10-24T09:00:' + String(i % 60).padStart(2, '0') + 'Z', own: 'abcdef12', ctx: '12345678' };
  const kept = P.keep(big);
  assert.ok(kept && kept.length <= P.CAP);
});

rule('no run, storage or answer-path code is called from practice, and no rule of its own', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'practice.js'), 'utf8');
  for (const bad of ['repo.', 'saveRun', 'queued(', 'mutateRun', 'R.done(', 'R.na(', 'R.pass(', 'R.waive(', 'localStorage.', 'sessionStorage.']) assert.ok(src.indexOf(bad) < 0, bad);
});

rule('renames in a row are followed to the end (a → b → c), as are Run from here and Set by; a rename back is no rename', () => {
  same(P.compose({ a: 'b', b: 'c' }), { a: 'c', b: 'c' });
  same(P.compose({ a: 'b', b: 'a' }), {}, 'a cycle ends where it started');
  const map = admit(MD), st0 = P.setFrom(prep(map), map, 'tell').state;
  const two = MD.replace('Tell the team {#tell}', 'Tell everyone {#tell3}'), map2 = admit(two);
  const st = P.settle(st0, map2, { tell: 'tell2', tell2: 'tell3' }, map);
  assert.strictEqual(st.from, 'tell3', 'Run from here follows the chain');
  assert.strictEqual(step(P.follow(st, map2, {}), 'tell3').status, 'again', 'the answer follows the chain');
});

rule('practice Undo after a rename undoes the step as it is named now; Redo brings it back; the old ID keeps its answer for a draft Undo', () => {
  const map = admit(MD), st0 = P.fresh('rel'), r = P.answer(st0, map, 'notes', 'done', {}, NOW);
  assert.ok(r.state, r.error);
  const e = P.undoEntry(st0, r.state, 'Check');
  const renamed = MD.replace('{#notes}', '{#notes2}'), map2 = admit(renamed);
  assert.notStrictEqual(renamed, MD, 'the fixture names notes');
  const st = P.settle(r.state, map2, { notes: 'notes2' }, map), moved = P.compose({ notes: 'notes2' });
  assert.strictEqual(step(P.follow(st, map2, {}), 'notes2').status, 'done', 'only the ID changed, so the answer holds');
  const u = P.applyEntry(st, e, moved);
  assert.strictEqual(step(P.follow(u.state, map2, {}), 'notes2').status, 'open', 'Undo leaves notes2 open');
  assert.ok(!('notes' in u.state.answers) && !('notes2' in u.state.answers), 'no answer under either ID');
  const re = P.applyEntry(u.state, u.back, moved);
  assert.strictEqual(step(P.follow(re.state, map2, {}), 'notes2').status, 'done', 'Redo: as it was after the rename');
  assert.strictEqual(step(P.follow(re.state, map, {}), 'notes').status, 'done', 'a draft Undo back to notes finds its answer as recorded');
});

rule('renames are chained in the order they happen: renamed and renamed back, an Undo recorded in between still finds its step', () => {
  assert.strictEqual(JSON.stringify(P.chain({ a: 'b' }, { b: 'a' })), JSON.stringify({ b: 'a' }), 'b is a again; a is itself');
  assert.strictEqual(JSON.stringify(P.chain({ a: 'b' }, { b: 'c' })), JSON.stringify({ a: 'c', b: 'c' }));
  assert.strictEqual(JSON.stringify(P.chain({}, { a: 'b' })), JSON.stringify({ a: 'b' }));
  assert.strictEqual(JSON.stringify(P.chain({ x: 'y' }, { a: 'b' })), JSON.stringify({ x: 'y', a: 'b' }));
});

rule('the signature of steps is unchanged by the new gate and phase parts', () => {
  const map = admit(MD), sig = PF.signature.steps(map, null, null, null);
  assert.ok(sig.tell.sig.indexOf('Tell the team') >= 0);
  assert.strictEqual(typeof PF.signature.gateParts(map.phases[0].gate), 'string');
  assert.strictEqual(typeof PF.signature.phaseParts(map.phases[0]), 'string');
});

budget('a 300-step draft: admission, fingerprints and follow well under budget', () => {
  const lines = ['---', 'process: big', 'title: Big', '---', ''];
  for (let p = 0; p < 10; p++) { lines.push('## Phase ' + p + ' {#ph' + p + '}'); for (let s = 0; s < 30; s++) lines.push('- [ ] {confirm} Step ' + p + '-' + s + ' does a thing {#s' + p + '-' + s + '}'); lines.push(''); }
  const md = lines.join('\n');
  let map = admit(md), st = P.fresh('big');
  for (let s = 0; s < 30; s++) st = act(st, map, 's0-' + s);
  P.asRun(P.follow(st, map, {}), map, 'casey', true);
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 5; k++) { map = admit(md); P.asRun(P.follow(st, map, {}), map, 'casey', true); }
  const ms = Number(process.hrtime.bigint() - t0) / 5e6;
  assert.ok(ms < 40, 'full edit path (admission, fingerprints, follow, the stand-in run) took ' + ms.toFixed(1) + ' ms');
  const t1 = process.hrtime.bigint();
  for (let k = 0; k < 10; k++) { const r = P.answer(st, map, 's0-' + k, 'open', {}, NOW); assert.ok(r.state, r.error); st = r.state; P.asRun(P.follow(st, map, {}), map, 'casey', true); }
  const ms1 = Number(process.hrtime.bigint() - t1) / 1e7;
  assert.ok(ms1 < 25, 'a practice action took ' + ms1.toFixed(1) + ' ms');
});

rule('a team step type changing under an unchanged draft asks again, and its gate needs review', () => {
  const md = MD.replace('{confirm} Tell the team', '{team.notify} Tell the team');
  const T1 = { 'team.notify': PF.types.customType({ id: 'team.notify', label: 'Notify', fields: { channel: { kind: 'text' } } }) };
  const T2 = { 'team.notify': PF.types.customType({ id: 'team.notify', label: 'Notify the team', fields: { channel: { kind: 'text' } } }) };
  const a = P.admit(md, T1); assert.ok(a.ok, a.why);
  let st = P.fresh('rel');
  for (const id of ['notes', 'tag', 'tell']) { const r = P.answer(st, a.map, id, 'done', T1, NOW); assert.ok(r.state, r.error); st = r.state; }
  const g = P.gateAct(st, a.map, 0, 'pass', '', T1, NOW); assert.ok(g.state, g.error); st = g.state;
  assert.strictEqual(step(P.follow(st, a.map, T1), 'tell').status, 'done');
  const v = P.follow(st, P.admit(md, T2).map, T2);
  assert.strictEqual(step(v, 'tell').status, 'again');
  assert.strictEqual(phase(v, 'prep').gate.status, 'review');
});

rule('an approved detail whose kind or options change needs the gate passed again, even with the same sample', () => {
  const md = MD.replace('context: env:choice(dev|prod), ticket', 'context: env:choice(dev|prod), ticket, amount:number').replace('approves: release of ^ticket', 'approves: release of ^amount');
  let map = admit(md), st = P.setSample(P.fresh('rel'), map, 'amount', '12').state;
  st = gate(act(act(act(st, map, 'notes'), map, 'tag'), map, 'tell'), map, 0);
  assert.strictEqual(phase(P.follow(st, map, {}), 'prep').gate.status, 'passed');
  const asText = admit(md.replace('amount:number', 'amount'));
  assert.strictEqual(phase(P.follow(st, asText, {}), 'prep').gate.status, 'review');
  const choice = md.replace('context: env:choice(dev|prod), ticket, amount:number', 'context: env:choice(dev|prod|test), ticket, amount:number').replace('approves: release of ^amount', 'approves: release of ^amount in ^env');
  assert.strictEqual(phase(P.follow(st, admit(choice), {}), 'prep').gate.status, 'review', 'what it approves changed');
});

rule('a kept practice with values that aren\'t text is read without throwing, keeping what is readable', () => {
  const o = { v: 1, process: 'rel', answers: { a: { s: 'done', own: 'abcdef12', ctx: '12345678', at: { toString: null } }, b: { s: { toString: null }, own: 'abcdef12', ctx: '12345678' } }, gates: { g: { s: 'passed', base: 'abcdef12', reason: { toString: null }, at: 5 } }, sample: { x: { toString: null } }, found: 1 };
  const st = P.check(o, 'rel');
  assert.ok(st);
  same(Object.keys(st.answers), ['a']);
  assert.strictEqual(st.answers.a.at, '');
  assert.strictEqual(st.gates.g.reason, '');
  same(st.sample, {});
});

budget('one long phase: fingerprints cost one hash per step (3,000 steps well under budget)', () => {
  const lines = ['---', 'process: long', 'title: Long', '---', '', '## One {#one}'];
  for (let s = 0; s < 3000; s++) lines.push('- [ ] {confirm} Step ' + s + ' {#s' + s + '}');
  const map = admit(lines.join('\n'));
  const t0 = process.hrtime.bigint();
  P.prints(map, {}, {});
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 150, '3,000 steps in one phase took ' + ms.toFixed(1) + ' ms');
});

budget('one long conditional phase: still one hash per step', () => {
  const lines = ['---', 'process: long', 'title: Long', 'context: risk', '---', '', '## One {#one}', '- [ ] {confirm} Only sometimes {#c0}', '  only when ^risk is set'];
  for (let s = 0; s < 3000; s++) lines.push('- [ ] {confirm} Step ' + s + ' {#s' + s + '}');
  const map = admit(lines.join('\n'));
  const t0 = process.hrtime.bigint();
  P.prints(map, { risk: 'high' }, {});
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 200, '3,000 steps in one conditional phase took ' + ms.toFixed(1) + ' ms');
});

rule('the compact signature changes nothing for skills: without it, signatures are exactly as before', () => {
  const md = MD.replace('{#tell}', '{#tell}\n  only when ^env is prod');
  const map = admit(md), full = PF.signature.steps(map, null, null, null), compact = PF.signature.steps(map, null, null, null, true);
  assert.ok(full.tell.sig.indexOf('only when') < 0 && full.tell.sig.indexOf('"when"') >= 0 && full.tell.sig.length > compact.tell.sig.length, 'the full signature carries the condition lists');
  assert.notStrictEqual(full.tell.sig, compact.tell.sig);
});

budget('over the cap, keeping costs about one pass however many answers there are', () => {
  const st = P.fresh('big');
  for (let i = 0; i < 3000; i++) st.answers['step-number-' + i] = { s: 'done', at: '2026-10-24T09:00:' + String(i % 60).padStart(2, '0') + 'Z', own: 'abcdef12', ctx: '12345678' };
  const t0 = process.hrtime.bigint();
  let text = null;
  for (let k = 0; k < 5; k++) text = P.keep(st, {});
  const ms = Number(process.hrtime.bigint() - t0) / 5e6;
  assert.ok(text && text.length <= P.CAP, 'it fits');
  assert.ok(ms < 40, 'keeping 3,000 answers took ' + ms.toFixed(1) + ' ms');
});

budget('many short phases: reopening the last one and following stays within the action budget', () => {
  const lines = ['---', 'process: many', 'title: Many', '---', ''];
  for (let p = 0; p < 300; p++) lines.push('## Phase ' + p + ' {#ph' + p + '}', '- [ ] {confirm} Step ' + p + ' {#s' + p + '}', '');
  const map = admit(lines.join('\n'));
  let st = P.fresh('many');
  for (let p = 0; p < 300; p++) { st = act(st, map, 's' + p); const g = P.gateAct(st, map, p, 'pass', '', {}, NOW); assert.ok(g.state, g.error); st = g.state; }
  P.follow(st, map, {});
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 3; k++) { const r = P.gateAct(st, map, 299, 'reopen', '', {}, NOW); assert.ok(r.state, r.error); P.follow(r.state, map, {}); }
  const ms = Number(process.hrtime.bigint() - t0) / 3e6;
  assert.ok(ms < 30, 'reopen and follow took ' + ms.toFixed(1) + ' ms');
});

rule('a copy of a stand-in never shares its memo, and a real run has none', () => {
  const map = admit(MD), r = P.asRun({ sample: {}, steps: {}, gates: {} }, map, null, true);
  assert.ok(r.memo && !Object.keys(r).includes('memo'));
  assert.ok(!('memo' in Object.assign({}, r)));
  assert.ok(!/memo/.test(JSON.stringify(r)));
});

rule('evidenceFor and checkEvidence with an explicit map are exactly the run\'s own, for every step of every example checklist', () => {
  const H = require('./harness'), EX = H.exampleSetup(PF), people = JSON.parse(H.example('people.json'));
  const ids = fs.readdirSync(path.join(__dirname, '..', 'example-folder', 'maps', 'drafts')).filter(f => /\.md$/.test(f)).map(f => f.replace(/\.md$/, ''));
  let n = 0;
  ids.forEach(id => {
    const b = PF.publish.build(H.example('maps/drafts/' + id + '.md'), { people, ...EX, by: 'person-avery', changes: 'First version', existing: [], now: NOW, rand: 'abcd1234' });
    const v = PF.publish.verify(b.folder, b.files), meta = v.map.meta, roles = {}, details = {};
    meta.context.forEach(k => { details[k] = 'sample-' + k; }); meta.roles.forEach(ro => { roles[ro] = 'person-casey'; });
    const r = R.create(v, { title: meta.title, details, roles, by: 'person-casey', session: 's1', now: NOW, workflows: EX.workflows }), map = R.mapOf(r);
    map.phases.forEach(ph => ph.steps.forEach(s => {
      same(R.evidenceFor(r, s, null, map), R.evidenceFor(r, s), id + ' › ' + s.id);
      same(R.checkEvidence(r, s, null, {}, false, map), R.checkEvidence(r, s, null, {}, false), id + ' › ' + s.id + ' (empty)');
      n++;
    }));
  });
  assert.ok(n > 40, 'steps compared: ' + n);
});

rule('checkFill answers exactly what setFields does, without changing the run', () => {
  const H = require('./harness'), EX = H.exampleSetup(PF), people = JSON.parse(H.example('people.json'));
  const ids = fs.readdirSync(path.join(__dirname, '..', 'example-folder', 'maps', 'drafts')).filter(f => /\.md$/.test(f)).map(f => f.replace(/\.md$/, ''));
  let n = 0, refused = 0;
  ids.forEach(id => {
    const b = PF.publish.build(H.example('maps/drafts/' + id + '.md'), { people, ...EX, by: 'person-avery', changes: 'First version', existing: [], now: NOW, rand: 'abcd1234' });
    const v = PF.publish.verify(b.folder, b.files), meta = v.map.meta, roles = {}, details = {};
    meta.context.forEach(k => { details[k] = 'sample-' + k; }); meta.roles.forEach(ro => { roles[ro] = 'person-casey'; });
    const base = R.create(v, { title: meta.title, details, roles, by: 'person-casey', session: 's1', now: NOW, workflows: EX.workflows });
    R.mapOf(base).phases.forEach(ph => ph.steps.forEach(s => {
      const allowed = PF.types.editable(PF.types.get(s.type, base.types));
      const tries = allowed.map(f => ({ [f]: '  Filled ' + f + '  ' })).concat([{ notAField: 'x' }]);
      tries.forEach(fields => {
        const r = JSON.parse(JSON.stringify(base)), before = JSON.stringify(r), cf = R.checkFill(r, s, fields);
        assert.strictEqual(JSON.stringify(r), before, 'checkFill changed the run');
        let err = null;
        try { R.setFields(r, R.mapOf(r), s.id, fields, null, 'person-casey', NOW); } catch (e) { err = e; }
        if (cf.error) {
          refused++;
          assert.ok(err, id + ' › ' + s.id + ': setFields took what checkFill refused');
          assert.strictEqual(err.message, cf.error); assert.strictEqual(err.field, cf.field);
          return;
        }
        if (err) return;
        same((r.fields || {})[s.id] || {}, cf.own, id + ' › ' + s.id);
        n++;
      });
    }));
  });
  assert.ok(n > 10 && refused > 40, 'filled ' + n + ', refused ' + refused);
});

rule('slice 2 state round-trips through check: evidence values, skipped, Fill in, setBy and from', () => {
  const st = Object.assign(P.fresh('rel'), {
    sample: { commit: 'abc123' },
    answers: { tag: { s: 'done', at: 't1', own: 'a1', ctx: 'b2', values: { link: 'https://x.example/1' } }, notes: { s: 'done', at: 't2', own: 'a2', ctx: 'b3', skipped: true } },
    fields: { tag: { status: 'Done' } }, setBy: { commit: 'tag' }, from: 'deploy' });
  same(P.check(JSON.parse(JSON.stringify(st)), 'rel'), st);
});

rule('a slice 1 practice loads with the new fields empty', () => {
  const old = { v: 1, process: 'rel', sample: { env: 'prod' }, answers: { tag: { s: 'done', at: 't', own: 'a1', ctx: 'b2' } }, gates: {}, found: '', rev: 3 };
  const st = P.check(old, 'rel');
  same(st.fields, {}); same(st.setBy, {}); assert.strictEqual(st.from, '');
  same(st.answers.tag, { s: 'done', at: 't', own: 'a1', ctx: 'b2' });
});

rule('malformed slice 2 fields are dropped, never thrown or converted', () => {
  const bad = { v: 1, process: 'rel', sample: { commit: 'x' }, gates: {},
    answers: { tag: { s: 'done', at: 't', own: 'a1', ctx: 'b2', skipped: 'yes', values: { link: 5, ok: 'fine', ['__proto__']: 'x' } }, other: { s: 'done', at: 't', own: 'a1', ctx: 'b2', values: 'nope' } },
    fields: { tag: { status: 7, issue: 'ABC-1' }, constructor: { a: 'b' }, bad: 'string', ['x'.repeat(90)]: { a: 'b' } },
    setBy: { commit: 'missing-step', nosample: 'tag', env: 5 }, from: { toString: 1 } };
  let st;
  assert.doesNotThrow(() => { st = P.check(bad, 'rel'); });
  assert.ok(!st.answers.tag, 'evidence that can\'t come back whole drops its answer');
  assert.ok(!st.answers.other, 'evidence that isn\'t a record drops its answer too');
  same(st.fields, { tag: { issue: 'ABC-1' } });
  same(st.setBy, {}); assert.strictEqual(st.from, '');
  const good = Object.assign({}, bad, { setBy: { commit: 'tag' } });
  good.answers = Object.assign({}, bad.answers, { tag: { s: 'done', at: 't', own: 'a1', ctx: 'b2', skipped: 'yes' } });
  const g = P.check(good, 'rel');
  same(g.setBy, { commit: 'tag' }); assert.ok(!('skipped' in g.answers.tag));
});

rule('keep: over the cap an answer goes with its evidence and Fill in, and takes its gate and every later one', () => {
  const md = MD.replace('- [ ] {confirm} Write the notes {#notes}', ['- [ ] {confirm} Write the notes {#notes}'].concat(Array.from({ length: 120 }, (_, i) => '- [ ] {confirm} Extra ' + i + ' {#x' + i + '}')).join('\n'));
  const map = admit(md), present = {}, fat = 'v'.repeat(P.VALUE_MAX);
  map.phases.forEach(p => { present[p.id] = present[p.gate.id] = true; p.steps.forEach(s => { present[s.id] = true; }); });
  const st = P.fresh('rel');
  map.phases[0].steps.forEach((s, i) => { st.answers[s.id] = { s: 'done', at: 't' + String(i).padStart(4, '0'), own: 'a1', ctx: 'b2', values: { a: fat } }; st.fields[s.id] = { x: 'f' }; });
  st.answers.page = { s: 'done', at: 'z1', own: 'a1', ctx: 'b2', values: { a: fat } };
  st.gates.ready = { s: 'passed', reason: '', at: 'z', approved: {}, base: 'ab' }; st.gates[map.phases[1].gate.id] = { s: 'passed', reason: '', at: 'z', approved: {}, base: 'ab' };
  st.sample.ticket = 'ABC-1'; st.setBy.ticket = 'notes';
  const k = JSON.parse(P.keep(st, present, map));
  assert.ok(JSON.stringify(k).length <= P.CAP);
  assert.ok(Object.keys(k.answers).length < Object.keys(st.answers).length, 'some answers went');
  Object.keys(k.answers).forEach(id => same(k.answers[id].values, { a: fat }, 'a kept answer keeps its evidence'));
  Object.keys(k.fields).forEach(id => assert.ok(k.answers[id], 'Fill in only beside a kept answer'));
  same(k.gates, {}, 'an evicted phase 1 answer drops its gate and the later one');
  Object.keys(k.setBy).forEach(n => assert.ok(k.answers[k.setBy[n]]));
  if (!k.answers.notes) same(k.setBy, {});
  const round = P.check(k, 'rel'), v = P.follow(round, map, {});
  assert.strictEqual(v.complete, false);
});

rule('Undo and Redo cover Fill in, setBy and from; an entry from slice 1 still applies', () => {
  const a = P.fresh('rel'), b = Object.assign(P.fresh('rel'), { sample: { commit: 'abc' }, fields: { tag: { status: 'Done' } }, setBy: { commit: 'tag' }, from: 'deploy' });
  const e = P.undoEntry(a, b, 'x');
  const u = P.applyEntry(b, e);
  same([u.state.sample, u.state.fields, u.state.setBy, u.state.from], [{}, {}, {}, '']);
  const r = P.applyEntry(u.state, u.back);
  same([r.state.sample, r.state.fields, r.state.setBy, r.state.from], [b.sample, b.fields, b.setBy, 'deploy']);
  const old = { label: 'old', answers: { tag: null }, gates: {}, sample: {} };
  const s1 = Object.assign(P.fresh('rel'), { answers: { tag: { s: 'done', at: '', own: 'a', ctx: 'b' } } });
  same(P.applyEntry(s1, old).state.answers, {});
});

rule('Reset clears answers, gates, Fill in, setBy and from, and keeps the sample', () => {
  const st = Object.assign(P.fresh('rel'), { sample: { commit: 'abc' }, answers: { tag: { s: 'done', at: '', own: 'a', ctx: 'b' } }, fields: { tag: { status: 'Done' } }, setBy: { commit: 'tag' }, from: 'deploy' });
  const r = P.reset(st).state;
  same([r.answers, r.gates, r.fields, r.setBy, r.from, r.sample], [{}, {}, {}, {}, '', { commit: 'abc' }]);
});

rule('a step goes back when the evidence it asks for changes, even where its own text and signature don\'t', () => {
  const md = k => ['---', 'process: cap', 'title: Cap', 'context: capacity' + k, '---', '## P · READ-DO {#p}', '- [!] {confirm} Choose capacity {#choose}', '  sets: capacity', '- [ ] {confirm} Tell the team {#tell}', ''].join('\n');
  const a = admit(md(''));
  const r0 = P.answer(P.fresh('cap'), a, 'choose', 'done', {}, NOW, { values: { [R.detailKey('capacity')]: '12' } }); assert.ok(r0.state, r0.error);
  const st = r0.state;
  assert.strictEqual(step(P.follow(st, a, {}), 'choose').status, 'done');
  assert.strictEqual(step(P.follow(st, admit(md(':number')), {}), 'choose').status, 'again', 'the detail it sets is now a number');
  assert.strictEqual(step(P.follow(st, admit(md(':number')), {}), 'tell').status, 'open');
});

rule('a Jira step goes back when the team workflow requires more, for the draft\'s status or a filled-in one', () => {
  const W1 = PF.jira.check({ Story: { statuses: ['To Do', 'Done'], transitions: [{ from: '*', to: 'Done' }] } }).workflows;
  const W2 = PF.jira.check({ Story: { statuses: ['To Do', 'Done'], transitions: [{ from: '*', to: 'Done', fields: [{ name: 'Resolution', options: ['Done'] }] }] } }).workflows;
  const md = ['---', 'process: j', 'title: J', '---', '## P · READ-DO {#p}', '- [!] {jira.issue} Close it {#close}', '  action: transition', '  issue: ABC-1', '  issueType: Story', '  status: Done', ''].join('\n');
  const types = PF.types.builtIn ? PF.types.builtIn() : {};
  const a = P.admit(md, types); assert.ok(a.ok, a.why);
  const e1 = P.env(types, W1), e2 = P.env(types, W2);
  const r = P.answer(P.fresh('j'), a.map, 'close', 'done', e1, NOW); assert.ok(r.state, r.error);
  assert.strictEqual(step(P.follow(r.state, a.map, e1), 'close').status, 'done');
  assert.strictEqual(step(P.follow(r.state, a.map, e2), 'close').status, 'again');
  const filled = Object.assign({}, r.state, { fields: { close: { status: 'To Do' } } });
  const md2 = md.replace('status: Done', 'status: To Do'), a2 = P.admit(md2, types).map;
  const st2 = Object.assign(P.fresh('j'), { fields: { close: { status: 'Done' } } });
  const r2 = P.answer(st2, a2, 'close', 'done', e1, NOW); assert.ok(r2.state, r2.error);
  assert.strictEqual(step(P.follow(r2.state, a2, e1), 'close').status, 'done');
  assert.strictEqual(step(P.follow(r2.state, a2, e2), 'close').status, 'again', 'the filled-in status now needs Resolution');
});

const SETS = ['---', 'process: s', 'title: S', 'context: commit, size:number', '---', '## Build · READ-DO {#build}',
  '- [!] {confirm} Make the commit {#make}', '  sets: commit', '- [ ] {confirm} Note the size {#size}', '  sets: size', '- [ ] {confirm} Review ^commit {#review}', '',
  '## Gate: Built {#built}', '  approves: build of ^commit', '',
  '## Ship · DO-CONFIRM {#ship}', '- [!] {confirm} Deploy ^commit {#deploy}', ''].join('\n');
const CK = R.detailKey('commit'), SK = R.detailKey('size');
function ans(st, map, id, o, how) { const r = P.answer(st, map, id, how || 'done', {}, NOW, o); assert.ok(r.state, r.error); return r.state; }

rule('evidence: required values are checked as a run checks them, beside their box', () => {
  const map = admit(SETS);
  const e1 = P.answer(P.fresh('s'), map, 'make', 'done', {}, NOW, {});
  assert.ok(/commit is needed/.test(e1.error)); assert.strictEqual(e1.field, CK);
  const e2 = P.answer(P.fresh('s'), map, 'size', 'done', {}, NOW, { values: { [SK]: 'lots' } });
  assert.ok(e2.error && e2.field === SK, 'a number is checked as a number');
  const st = ans(P.fresh('s'), map, 'size', { values: { [SK]: '1200' } });
  assert.strictEqual(st.sample.size, PF.values.parse({ kind: 'number' }, '1200').canonical, 'kept canonical');
  same(st.setBy, { size: 'size' });
});

rule('Check without it: done, marked skipped, and it never sets a detail', () => {
  const map = admit(SETS), st = ans(P.fresh('s'), map, 'make', { skipped: true });
  assert.strictEqual(st.answers.make.skipped, true);
  same(st.sample, {}); same(st.setBy, {});
  assert.strictEqual(step(P.follow(st, map, {}), 'make').status, 'done');
  const plain = ans(st, map, 'review', { skipped: true });
  assert.ok(!plain.answers.review.skipped, 'a step with no evidence is simply done');
});

rule('a setter sets the sample and stays done even when it reads what it sets', () => {
  const md = SETS.replace('- [!] {confirm} Make the commit {#make}', '- [!] {confirm} Make the commit ^commit {#make}');
  const map = admit(md), st = ans(P.fresh('s'), map, 'make', { values: { [CK]: 'abc123' } });
  same(st.sample, { commit: 'abc123' });
  assert.strictEqual(step(P.follow(st, map, {}), 'make').status, 'done');
  const e = P.undoEntry(P.fresh('s'), st, 'Check');
  const back = P.applyEntry(st, e).state;
  same([back.sample, back.setBy, back.answers], [{}, {}, {}], 'one Undo takes back the answer and what it set');
});

rule('a setter in Try it again takes its consumers and gates with it; the same value brings them back', () => {
  const map = admit(SETS);
  let st = ans(P.fresh('s'), map, 'make', { values: { [CK]: 'abc' } });
  st = ans(ans(st, map, 'size', { skipped: true }), map, 'review');
  st = gate(st, map, 0);
  const edited = admit(SETS.replace('Make the commit {#make}', 'Make the release commit {#make}'));
  const v = P.follow(st, edited, {});
  same([step(v, 'make').status, step(v, 'size').status, step(v, 'review').status, phase(v, 'build').gate.status.state || phase(v, 'build').gate.rec.s], ['again', 'done', 'again', phase(v, 'build').gate.rec.s]);
  assert.strictEqual(phase(v, 'build').gate.rec.s, 'review');
  assert.strictEqual(phase(v, 'build').gate.rec.reason, 'setter');
  let st2 = ans(st, edited, 'make', { values: { [CK]: 'abc' } });
  const v2 = P.follow(st2, edited, {});
  same([step(v2, 'make').status, step(v2, 'review').status], ['done', 'done'], 'same value: consumers return');
  assert.strictEqual(phase(v2, 'build').gate.rec.reason, 'changed', 'the gate still asks again: the setter\'s own text is in its baseline');
  const st3 = ans(st, edited, 'make', { values: { [CK]: 'def' } });
  assert.strictEqual(step(P.follow(st3, edited, {}), 'review').status, 'again', 'new value: the fingerprint rule');
  const both = admit(SETS.replace('Make the commit {#make}', 'Make the release commit {#make}').replace('Review ^commit {#review}', 'Review ^commit closely {#review}'));
  const st4 = ans(st, both, 'make', { values: { [CK]: 'abc' } });
  assert.strictEqual(step(P.follow(st4, both, {}), 'review').status, 'again', 'a consumer edited meanwhile stays');
});

rule('Fill in: checked as a run checks it, rebases a current answer, never rescues one already to try again', () => {
  const md = ['---', 'process: c', 'title: C', '---', '## P · READ-DO {#p}', '- [!] {run.command} Deploy {#dep}', '  command: deploy', ''].join('\n');
  const map = admit(md), editable = PF.types.editable(PF.types.get('run.command', {}));
  assert.ok(editable.length, 'run.command has fields a run may fill in');
  const f = editable[0];
  assert.ok(/can't be changed during a run/.test(P.fillIn(P.fresh('c'), map, 'dep', { nope: 'x' }, {}).error));
  let st = ans(P.fresh('c'), map, 'dep', { skipped: true });
  const r = P.fillIn(st, map, 'dep', { [f]: 'filled' }, {});
  assert.ok(r.state, r.error);
  assert.strictEqual(r.state.fields.dep[f], 'filled');
  assert.strictEqual(step(P.follow(r.state, map, {}), 'dep').status, 'done', 'a Fill in never sends a step back by itself');
  same(P.fillIn(r.state, map, 'dep', { [f]: 'filled' }, {}).state, r.state, 'no change, same state');
});

rule('a later phase\'s gate that approves a detail goes to review only while its setter is to try again', () => {
  const md = SETS + '\n## Gate: Shipped {#shipped}\n  approves: ship of ^commit\n';
  const map = admit(md);
  let st = ans(P.fresh('s'), map, 'make', { values: { [CK]: 'abc' } });
  st = ans(ans(st, map, 'size', { skipped: true }), map, 'review');
  st = gate(st, map, 0); st = ans(st, map, 'deploy'); st = gate(st, map, 1);
  const edited = admit(md.replace('Make the commit {#make}', 'Make the release commit {#make}'));
  const g = v => phase(v, 'ship').gate.rec;
  same([g(P.follow(st, edited, {})).s, g(P.follow(st, edited, {})).reason], ['review', 'setter']);
  const back = ans(st, edited, 'make', { values: { [CK]: 'abc' } });
  assert.strictEqual(g(P.follow(back, edited, {})).s, 'passed', 'same value: the later gate is passed again as it was');
});

rule('Fill in keeps a current gate as it was (passed or waived), leaves a stale one in review, and undoes as one', () => {
  const md = ['---', 'process: c', 'title: C', '---', '## P · READ-DO {#p}', '- [!] {decide} Pick a path {#dec}', '  options: A, B', '  require: decision', '- [ ] {confirm} Tell {#tell}', '',
    '## Gate: Out {#out}', '', '## Q · READ-DO {#q}', '- [ ] {confirm} After {#after}', ''].join('\n');
  const map = admit(md);
  let st = ans(P.fresh('c'), map, 'dec', { values: { decision: 'A' } }); st = ans(st, map, 'tell');
  const own0 = P.prints(map, st.sample, {}, st.fields).dec.own, own1 = P.prints(map, st.sample, {}, { dec: { options: 'A, B, C' } }).dec.own;
  assert.notStrictEqual(own0, own1, 'the Fill in changes what the evidence asks for (so this test means something)');
  for (const how of ['pass', 'waive']) {
    const g = gate(st, map, 0, how, 'later');
    const r = P.fillIn(g, map, 'dec', { options: 'A, B, C' }, {}); assert.ok(r.state, r.error);
    const v = P.follow(r.state, map, {});
    assert.strictEqual(step(v, 'dec').status, 'done');
    assert.strictEqual(phase(v, 'p').gate.rec.s, how === 'pass' ? 'passed' : 'waived', how);
    assert.ok(phase(v, 'q').open, 'the next phase stays open');
    const e = P.undoEntry(g, r.state, 'Fill in'), u = P.applyEntry(r.state, e);
    same([u.state.fields, u.state.answers, u.state.gates], [g.fields, g.answers, g.gates], 'one Undo puts back the answer and the gate');
    same(P.applyEntry(u.state, u.back).state.gates, r.state.gates, 'Redo too');
  }
  const passed = gate(st, map, 0), stale = admit(md.replace('Tell {#tell}', 'Tell everyone {#tell}'));
  const r2 = P.fillIn(passed, stale, 'dec', { options: 'A, B, C' }, {}); assert.ok(r2.state, r2.error);
  assert.strictEqual(phase(P.follow(r2.state, stale, {}), 'p').gate.rec.s, 'review', 'a gate stale for another reason stays in review');
  const opt = admit(md.replace('- [!] {decide}', '- [ ] {decide}'));
  const open = gate(ans(P.fresh('c'), opt, 'tell'), opt, 0, 'waive', 'later');
  assert.ok(!open.answers.dec, 'the optional decision is unanswered');
  const r3 = P.fillIn(open, opt, 'dec', { options: 'A, B, C' }, {}); assert.ok(r3.state, r3.error);
  const v3 = P.follow(r3.state, opt, {});
  assert.strictEqual(phase(v3, 'p').gate.rec.s, 'waived', 'an unanswered step\'s Fill in keeps the waiver');
  assert.ok(phase(v3, 'q').open);
  const e3 = P.undoEntry(open, r3.state, 'Fill in'), u3 = P.applyEntry(r3.state, e3);
  same([u3.state.fields, u3.state.gates], [open.fields, open.gates]);
  same(P.applyEntry(u3.state, u3.back).state.gates, r3.state.gates);
});

const FROM = ['---', 'process: f', 'title: F', 'context: env:choice(dev|prod), size:number, tag', '---',
  '## One · READ-DO {#one}', '- [!] {confirm} First {#a1}', '- [ ] {confirm} Only in prod {#a2}', '  only when ^env is prod', '',
  '## Gate: One done {#g1}', '  approves: env ^env', '',
  '## Two · READ-DO {#two}', '- [ ] {confirm} Early {#b1}', '- [!] {confirm} Start here {#b2}', '- [ ] {confirm} Ship ^tag {#b3}', '- [ ] {confirm} Make tag {#b4}', '  sets: tag', '- [ ] {confirm} Size it ^size {#b5}', '',
  '## Three · READ-DO {#three}', '  only when ^env is prod', '- [ ] {confirm} Last {#c1}', ''].join('\n');

rule('Run from here: earlier steps and gates are assumed, never answers, and the walk starts at the step', () => {
  const map = admit(FROM), st = P.setFrom(P.setSample(P.fresh('f'), map, 'env', 'prod').state, map, 'b2').state;
  const v = P.follow(st, map, {});
  same(['a1', 'a2', 'b1', 'b2'].map(id => step(v, id).status), ['assumed', 'assumed', 'assumed', 'open']);
  assert.strictEqual(phase(v, 'one').gate.rec.by, 'assumed'); assert.ok(phase(v, 'one').gate.assumed);
  assert.ok(phase(v, 'two').open);
  same(v.from.id, 'b2'); assert.strictEqual(v.from.assumed, 3);
  same(st.answers, {}); same(st.gates, {});
  assert.strictEqual(v.nextUp.step, 'b2');
  assert.ok(/assumed/.test(P.answer(st, map, 'a1', 'done', {}, NOW).error));
  assert.ok(/assumed/.test(P.gateAct(st, map, 0, 'pass', '', {}, NOW).error));
});

rule('Run from here: an unresolved or invalid earlier condition never locks the way; the live part keeps its conditions', () => {
  const md = FROM.replace('## One · READ-DO {#one}', '## One · READ-DO {#one}\n  only when ^size is 3');
  const map = admit(md);
  for (const sample of [{}, { env: 'staging' }]) {
    const st = P.setFrom(Object.assign(P.fresh('f'), { sample }), map, 'b2').state, v = P.follow(st, map, {});
    assert.ok(phase(v, 'two').open, JSON.stringify(sample) + ': the destination phase is open');
    assert.strictEqual(step(v, 'b2').status, 'open');
    assert.strictEqual(v.nextUp.step, 'b2');
    assert.notStrictEqual(phase(v, 'three').info && step(v, 'c1').status, 'assumed', 'live conditions stay');
  }
  const partial = P.setFrom(Object.assign(P.fresh('f'), { sample: { env: 'staging' } }), admit(FROM), 'a2').state, v2 = P.follow(partial, admit(FROM), {});
  same([step(v2, 'a1').status, step(v2, 'a2').status], ['assumed', 'waiting'], 'the from step\'s own condition is live: it waits for a valid env');
});

rule('Run from here: needed samples in walk order, set by a producer only when it comes first, applies and has its evidence', () => {
  const map = admit(FROM);
  let st = P.setFrom(P.setSample(P.fresh('f'), map, 'env', 'dev').state, map, 'b2').state;
  same(P.follow(st, map, {}).from.needed, ['tag', 'size'], 'tag is read before Make tag sets it; size is never set');
  const after = admit(FROM.replace('- [ ] {confirm} Ship ^tag {#b3}\n', '').replace('  sets: tag\n', '  sets: tag\n- [ ] {confirm} Ship ^tag {#b3}\n'));
  st = P.setFrom(P.setSample(P.fresh('f'), after, 'env', 'dev').state, after, 'b2').state;
  same(P.follow(st, after, {}).from.needed, ['size'], 'a producer before the use supplies it');
  const skipped = ans(st, after, 'b4', { skipped: true });
  same(P.follow(skipped, after, {}).from.needed, ['tag', 'size'], 'checked without evidence: it supplies nothing');
  const hidden = admit(FROM.replace('- [ ] {confirm} Ship ^tag {#b3}\n', '').replace('  sets: tag\n', '  sets: tag\n  only when ^env is prod\n- [ ] {confirm} Ship ^tag {#b3}\n'));
  st = P.setFrom(P.setSample(P.fresh('f'), hidden, 'env', 'dev').state, hidden, 'b2').state;
  same(P.follow(st, hidden, {}).from.needed, ['tag', 'size'], 'a hidden producer supplies nothing');
  const fromStart = P.setFrom(P.fresh('f'), map, 'a1').state;
  assert.ok(P.follow(fromStart, map, {}).from.needed.indexOf('env') >= 0, 'a gate approval counts');
});

rule('Run from here: no success moment; through says so; Undo and Reset clear it; removal moves it', () => {
  const map = admit(FROM);
  let st = P.setFrom(P.setSample(P.fresh('f'), map, 'env', 'dev').state, map, 'b5').state;
  st = ans(st, map, 'b5');
  st = gate(st, map, 1);
  const v = P.follow(st, map, {});
  assert.strictEqual(v.complete, false); assert.strictEqual(v.from.through, true);
  const e = P.undoEntry(P.fresh('f'), P.setFrom(P.fresh('f'), map, 'b5').state, 'Run from here');
  assert.strictEqual(P.applyEntry(P.setFrom(P.fresh('f'), map, 'b5').state, e).state.from, '');
  assert.strictEqual(P.reset(st).state.from, '');
  const s2 = P.setFrom(P.fresh('f'), map, 'b3').state;
  const gone = admit(FROM.replace('- [ ] {confirm} Ship ^tag {#b3}\n', ''));
  assert.strictEqual(P.settle(s2, gone, {}, map).from, 'b4', 'the next step after it in its phase');
  const lastGone = admit(FROM.replace('- [ ] {confirm} Last {#c1}', '- [ ] {confirm} Other {#c2}'));
  assert.strictEqual(P.settle(P.setFrom(P.fresh('f'), map, 'c1').state, lastGone, {}, map).from, 'c2', 'else the phase\'s first');
  assert.strictEqual(P.settle(P.setFrom(P.fresh('f'), map, 'c1').state, admit(FROM.split('## Three')[0]), {}, map).from, '', 'else the beginning');
  assert.strictEqual(P.settle(s2, admit(FROM.replace('{#b3}', '{#b3x}')), { b3: 'b3x' }, map).from, 'b3x', 'a rename follows');
  const hid = P.setFrom(P.setSample(P.fresh('f'), map, 'env', 'dev').state, map, 'a2').state;
  assert.strictEqual(P.follow(hid, map, {}).from.id, 'a1', 'a hidden from step hands over (here to the phase\'s first)');
});

rule('a Jira transition the workflow stops allowing goes back, its gate to review; checking it is refused, Check without it isn\'t', () => {
  const ok = PF.jira.check({ Story: { statuses: ['To Do', 'Done'], transitions: [{ from: '*', to: 'Done' }] } }).workflows;
  const none = PF.jira.check({ Story: { statuses: ['To Do', 'Review'], transitions: [{ from: '*', to: 'Review' }] } }).workflows;
  const md = ['---', 'process: j', 'title: J', '---', '## P · READ-DO {#p}', '- [!] {jira.issue} Close it {#close}', '  action: transition', '  issue: ABC-1', '  issueType: Story', '  status: Done', '',
    '## Gate: Closed {#closed}', ''].join('\n');
  const map = P.admit(md, {}).map, e1 = P.env({}, ok), e2 = P.env({}, none);
  let st = P.answer(P.fresh('j'), map, 'close', 'done', e1, NOW).state;
  st = P.gateAct(st, map, 0, 'pass', '', e1, NOW).state;
  const v = P.follow(st, map, e2);
  same([step(v, 'close').status, phase(v, 'p').gate.rec.s, v.complete], ['again', 'review', false]);
  assert.ok(/no transition to "Done"/.test(P.answer(P.fresh('j'), map, 'close', 'done', e2, NOW).error), 'a plain check is refused');
  const sk = P.answer(P.fresh('j'), map, 'close', 'done', e2, NOW, { skipped: true });
  assert.ok(sk.state && sk.state.answers.close.skipped, 'Check without it still works');
  assert.ok(step(P.follow(P.fresh('j'), map, e2), 'close').ask, 'the row asks first (the form says why)');
});

rule('evidence comes back whole: 41 values survive a reload; a record past the limit drops its answer and every gate', () => {
  const vals = {}; for (let i = 0; i < 41; i++) vals['v' + i] = 'x' + i;
  const st = Object.assign(P.fresh('rel'), { answers: { tag: { s: 'done', at: 't', own: 'a1', ctx: 'b2', values: vals } }, gates: { ready: { s: 'passed', reason: '', at: 't', approved: {}, base: 'ab' } } });
  const back = P.check(JSON.parse(JSON.stringify(st)), 'rel');
  same(Object.keys(back.answers.tag.values).length, 41); assert.ok(back.gates.ready);
  const many = {}; for (let i = 0; i <= P.VALUES_MAX; i++) many['v' + i] = 'x';
  const over = P.check(Object.assign(JSON.parse(JSON.stringify(st)), { answers: { tag: { s: 'done', at: 't', own: 'a1', ctx: 'b2', values: many }, other: { s: 'done', at: 't', own: 'a1', ctx: 'b2' } } }), 'rel');
  assert.ok(!over.answers.tag && over.answers.other); same(over.gates, {});
  const long = P.check(Object.assign(JSON.parse(JSON.stringify(st)), { answers: { tag: { s: 'done', at: 't', own: 'a1', ctx: 'b2', values: { a: 'y'.repeat(P.VALUE_MAX + 1) } } } }), 'rel');
  assert.ok(!long.answers.tag); same(long.gates, {});
});

rule('Needed from here: a setter marked Not needed, or a linked run that would set it, supplies nothing', () => {
  const md = FROM.replace('- [ ] {confirm} Ship ^tag {#b3}\n', '').replace('  sets: tag\n', '  sets: tag\n- [ ] {confirm} Ship ^tag {#b3}\n');
  const map = admit(md);
  let st = P.setFrom(P.setSample(P.fresh('f'), map, 'env', 'dev').state, map, 'b2').state;
  same(P.follow(st, map, {}).from.needed, ['size']);
  same(P.follow(ans(st, map, 'b4', null, 'na'), map, {}).from.needed, ['tag', 'size'], 'Not needed');
  const linked = admit(md.replace('- [ ] {confirm} Make tag {#b4}', '- [ ] {run.process} Make tag {#b4}\n  process: tagger'));
  st = P.setFrom(P.setSample(P.fresh('f'), linked, 'env', 'dev').state, linked, 'b2').state;
  same(P.follow(st, linked, {}).from.needed, ['tag', 'size'], 'a linked run sets nothing in practice');
});

rule('Needed from here: a skipped phase\'s gate asks for nothing', () => {
  const md = ['---', 'process: k', 'title: K', 'context: env:choice(dev|prod), sig', '---', '## One · READ-DO {#one}', '- [ ] {confirm} Start {#s1}', '',
    '## Two · READ-DO {#two}', '  only when ^env is prod', '- [ ] {confirm} Prod only {#s2}', '', '## Gate: Signed {#signed}', '  approves: sign-off ^sig', ''].join('\n');
  const map = admit(md);
  const dev = P.setFrom(P.setSample(P.fresh('k'), map, 'env', 'dev').state, map, 's1').state;
  same(P.follow(dev, map, {}).from.needed, []);
  const prod = P.setFrom(P.setSample(P.fresh('k'), map, 'env', 'prod').state, map, 's1').state;
  same(P.follow(prod, map, {}).from.needed, ['sig'], 'the same gate asks once its phase applies');
});

rule('a setter given a new ID by the builder still takes its consumers and later gates with it, and back on the same value', () => {
  const md = SETS + '\n## Gate: Shipped {#shipped}\n  approves: ship of ^commit\n';
  const map = admit(md);
  let st = ans(P.fresh('s'), map, 'make', { values: { [CK]: 'abc' } });
  st = ans(ans(st, map, 'size', { skipped: true }), map, 'review');
  st = gate(st, map, 0); st = ans(st, map, 'deploy'); st = gate(st, map, 1);
  const moved = admit(md.replace('Make the commit {#make}', 'Make the release commit {#make2}'));
  const settled = P.settle(st, moved, { make: 'make2' }, map);
  same(settled.setBy, { commit: 'make2' }, 'Set by follows the new ID');
  const v = P.follow(settled, moved, {});
  same([step(v, 'make2').status, step(v, 'deploy').status, phase(v, 'ship').gate.rec.s], ['again', 'again', 'review']);
  const re = ans(settled, moved, 'make2', { values: { [CK]: 'abc' } }), v2 = P.follow(re, moved, {});
  same([step(v2, 'make2').status, step(v2, 'deploy').status, phase(v2, 'ship').gate.rec.s], ['done', 'done', 'passed'], 'same value: back as they were');
  const e = P.undoEntry(settled, re, 'Check'), u = P.applyEntry(re, e);
  same(step(P.follow(u.state, moved, {}), 'deploy').status, 'again', 'Undo of the re-check sends the consumer back again');
  same(step(P.follow(P.applyEntry(u.state, u.back).state, moved, {}), 'deploy').status, 'done', 'and Redo returns it');
  const skipped = P.settle(ans(P.fresh('s'), map, 'make', { skipped: true }), moved, { make: 'make2' }, map);
  same(P.follow(skipped, moved, {}).phases[0].steps.map(x => x.status).slice(0, 1), ['again']);
});

rule('a setter whose sets: changed or went away still takes what it had set with it (replace, remove, partial), with Undo/Redo', () => {
  const md = SETS.replace('  sets: commit\n', '  sets: commit, size\n').replace('- [ ] {confirm} Note the size {#size}\n  sets: size\n', '- [ ] {confirm} Note the size {#size}\n') + '\n## Gate: Shipped {#shipped}\n  approves: ship of ^commit\n';
  const map = admit(md);
  let st = ans(P.fresh('s'), map, 'make', { values: { [CK]: 'abc', [SK]: '3' } });
  st = ans(ans(st, map, 'size'), map, 'review'); st = gate(st, map, 0); st = ans(st, map, 'deploy'); st = gate(st, map, 1);
  for (const [why, to] of [['replaced', '  sets: size\n'], ['removed', ''], ['partly removed', '  sets: size\n']]) {
    const m2 = admit(md.replace('  sets: commit, size\n', to)), v = P.follow(st, m2, {});
    same([step(v, 'make').status, step(v, 'deploy').status, phase(v, 'ship').gate.rec.s, v.complete], ['again', 'again', 'review', false], why);
  }
  const m3 = admit(md.replace('  sets: commit, size\n', ''));
  const re = ans(st, m3, 'make'), e = P.undoEntry(st, re, 'Check');
  assert.strictEqual(step(P.follow(re, m3, {}), 'make').status, 'done');
  const u = P.applyEntry(re, e);
  assert.strictEqual(step(P.follow(u.state, m3, {}), 'deploy').status, 'again', 'Undo brings back the old answer and its pull');
  assert.strictEqual(step(P.follow(P.applyEntry(u.state, u.back).state, m3, {}), 'make').status, 'done');
});

rule('a setter that stops applying sets nothing: what read it stays done', () => {
  const md = ['---', 'process: h', 'title: H', 'context: env:choice(dev|prod), commit', '---', '## Build · READ-DO {#build}',
    '- [ ] {confirm} Make the commit {#make}', '  only when ^env is prod', '  sets: commit', '- [ ] {confirm} Review ^commit {#review}', ''].join('\n');
  const map = admit(md), key = R.detailKey('commit');
  let st = P.setSample(P.fresh('h'), map, 'env', 'prod').state;
  st = ans(st, map, 'make', { values: { [key]: 'abc' } }); st = ans(st, map, 'review');
  st = P.setSample(st, map, 'env', 'dev').state;
  const v = P.follow(st, map, {});
  assert.strictEqual(step(v, 'review').status, 'done', 'the hidden setter pulls nothing back');
});

rule('a renamed step keeps what was filled in (and the old ID keeps it too, for the draft Undo)', () => {
  const map = admit(SETS), st0 = Object.assign(P.fresh('s'), { fields: { old: { command: 'npm test' } } });
  const st = P.settle(st0, map, { old: 'review' });
  same(st.fields.review, { command: 'npm test' }); same(st.fields.old, { command: 'npm test' });
});

rule('Run from here: a from step that stops applying hands over for good, said, and Undo brings it back', () => {
  const map = admit(FROM);
  const st0 = P.setFrom(P.setSample(P.fresh('f'), map, 'env', 'prod').state, map, 'a2').state;
  const r = P.setSample(st0, map, 'env', 'dev', {});
  assert.strictEqual(r.moved, 'next'); assert.strictEqual(r.state.from, 'a1');
  const back = P.setSample(r.state, map, 'env', 'prod', {});
  assert.ok(!back.moved); assert.strictEqual(back.state.from, 'a1', 'it never moves back on its own');
  const u = P.applyEntry(r.state, P.undoEntry(st0, r.state, 'Sample env'));
  assert.strictEqual(u.state.from, 'a2', 'Undo brings the old from step back');
  assert.strictEqual(P.check(JSON.parse(P.keep(r.state)), 'f').from, 'a1', 'kept');
  const e = P.repin(Object.assign({}, st0, { sample: { env: 'dev' } }), map, {});
  assert.strictEqual(e.moved, 'next', 'a draft edit or reload hands over the same way');
});

rule('kept evidence that is not a record drops its answer and every gate', () => {
  const map = admit(MD), st = gate(prep(map), map, 0);
  for (const bad of [null, 3, 'x', ['a']]) {
    const o = JSON.parse(JSON.stringify(st)); o.answers.notes.values = bad;
    const back = P.check(o, 'rel');
    assert.ok(!back.answers.notes, JSON.stringify(bad) + ': answer dropped'); same(back.gates, {});
  }
});

rule('Run from here: a removed from step falls back within its own phase, never to a step that moved to another', () => {
  const map = admit(FROM), st0 = P.setFrom(P.fresh('f'), map, 'b2').state;
  const moved = ['- [ ] {confirm} Ship ^tag {#b3}', '- [ ] {confirm} Make tag {#b4}', '  sets: tag', '- [ ] {confirm} Size it ^size {#b5}'];
  const md = FROM.replace('- [!] {confirm} Start here {#b2}\n' + moved.join('\n') + '\n', '')
    .replace('  only when ^env is prod\n- [ ] {confirm} Last {#c1}', '  only when ^env is prod\n' + moved.join('\n') + '\n- [ ] {confirm} Last {#c1}');
  const map2 = admit(md);
  assert.ok(step(P.follow(P.fresh('f'), map2, {}), 'b3'), 'b3 moved to Three');
  assert.strictEqual(P.settle(st0, map2, {}, map).from, 'b1', 'its phase\'s first, not b3 in Three');
});

run();
