// Practice a draft (2.2, docs/design.md section 34): edit-and-continue. Answers are kept by part ID with two fingerprints, an
// edit asks for another try where something changed, gates need a pass again when what they approved changed, and every
// rule about steps, gates and Next up is the run's own, read through a stand-in that is never a run.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { load, loadViews, rule, run } = require('./harness');
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
  const FIELDS = ['format', 'practice', 'state', 'paused', 'ended', 'recorder', 'roles', 'details', 'steps', 'gates', 'fields', 'migrations', 'followUps', 'log', 'marksFrom', 'memo'];
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
      p.steps.forEach(x => R.answerable(proxy, map, x.id, 'done'));
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

rule('the signature of steps is unchanged by the new gate and phase parts', () => {
  const map = admit(MD), sig = PF.signature.steps(map, null, null, null);
  assert.ok(sig.tell.sig.indexOf('Tell the team') >= 0);
  assert.strictEqual(typeof PF.signature.gateParts(map.phases[0].gate), 'string');
  assert.strictEqual(typeof PF.signature.phaseParts(map.phases[0]), 'string');
});

rule('a 300-step draft: admission, fingerprints and follow well under budget', () => {
  const lines = ['---', 'process: big', 'title: Big', '---', ''];
  for (let p = 0; p < 10; p++) { lines.push('## Phase ' + p + ' {#ph' + p + '}'); for (let s = 0; s < 30; s++) lines.push('- [ ] {confirm} Step ' + p + '-' + s + ' does a thing {#s' + p + '-' + s + '}'); lines.push(''); }
  const md = lines.join('\n');
  let map = admit(md), st = P.fresh('big');
  for (let s = 0; s < 30; s++) st = act(st, map, 's0-' + s);
  // The pane drawn from the model, as the app draws it (a stand-in ctx: the view only reads ctx.practice and ctx.state).
  const VP = loadViews(), pane = (m) => VP.views.practicePane({ state: {}, practice: () => ({ model: m, problem: '', paused: '', details: [], sampleErr: null, gone: [], found: '', canUndo: true, canRedo: false, undoLabel: 'Check', hasAnswers: true, saveState: 'Saved' }) }, { id: 'big' }, md);
  const vmap = VP.practice.admit(md, {}).map; let vst = VP.practice.fresh('big');
  for (let s = 0; s < 30; s++) vst = VP.practice.answer(vst, vmap, 's0-' + s, 'done', {}, NOW).state;
  pane(VP.practice.follow(vst, vmap, {}));
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 5; k++) { map = admit(md); P.follow(st, map, {}); pane(VP.practice.follow(vst, VP.practice.admit(md, {}).map, {})); }
  const ms = Number(process.hrtime.bigint() - t0) / 5e6;
  assert.ok(ms < 80, 'full edit path (admission, fingerprints, follow, the pane) took ' + ms.toFixed(1) + ' ms');
  // A practice action with the parse cached: the answer, follow and the pane again.
  const t1 = process.hrtime.bigint();
  for (let k = 0; k < 10; k++) { const r = VP.practice.answer(vst, vmap, 's0-' + k, 'open', {}, NOW); assert.ok(r.state, r.error); vst = r.state; pane(VP.practice.follow(vst, vmap, {})); }
  const ms1 = Number(process.hrtime.bigint() - t1) / 1e7;
  assert.ok(ms1 < 30, 'a practice action took ' + ms1.toFixed(1) + ' ms');
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

rule('one long phase: fingerprints cost one hash per step (3,000 steps well under budget)', () => {
  const lines = ['---', 'process: long', 'title: Long', '---', '', '## One {#one}'];
  for (let s = 0; s < 3000; s++) lines.push('- [ ] {confirm} Step ' + s + ' {#s' + s + '}');
  const map = admit(lines.join('\n'));
  const t0 = process.hrtime.bigint();
  P.prints(map, {}, {});
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 150, '3,000 steps in one phase took ' + ms.toFixed(1) + ' ms');
});

rule('one long conditional phase: still one hash per step', () => {
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

rule('over the cap, keeping costs about one pass however many answers there are', () => {
  const st = P.fresh('big');
  for (let i = 0; i < 3000; i++) st.answers['step-number-' + i] = { s: 'done', at: '2026-10-24T09:00:' + String(i % 60).padStart(2, '0') + 'Z', own: 'abcdef12', ctx: '12345678' };
  const t0 = process.hrtime.bigint();
  let text = null;
  for (let k = 0; k < 5; k++) text = P.keep(st, {});
  const ms = Number(process.hrtime.bigint() - t0) / 5e6;
  assert.ok(text && text.length <= P.CAP, 'it fits');
  assert.ok(ms < 40, 'keeping 3,000 answers took ' + ms.toFixed(1) + ' ms');
});

rule('many short phases: reopening the last one and following stays within the action budget', () => {
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

run();
