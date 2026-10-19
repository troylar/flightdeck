// The session timeline behind Undo, Redo and History in the draft editor and the step-type form.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), TL = PF.timeline;
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

/* Type text one keystroke at a time into a timeline, the way the Markdown editor records it. */
function typeInto(tl, text, at, chars, t0, step) {
  let cur = text;
  [...chars].forEach((c, i) => { const next = cur.slice(0, at + i) + c + cur.slice(at + i); TL.record(tl, cur, next, { kind: 'typing', at: t0 + i * (step || 100) }); cur = next; });
  return cur;
}

rule('Timeline: Undo puts back exactly the text before the change, and Redo puts the change back', () => {
  const tl = TL.create(), a = '## Prep · READ-DO\n- [ ] {confirm} Smoke tests {#smoke}\n', b = a.replace('Smoke tests', 'Smoke tests pass');
  TL.record(tl, a, b, { kind: 'op', label: 'wording change', subject: 'Smoke tests', items: ['step:smoke'] });
  const u = TL.undo(tl, b);
  assert.strictEqual(u.text, a);
  assert.strictEqual(TL.describe(u.entry), 'the wording change of "Smoke tests"');
  const at = a.indexOf('Smoke tests ') + 12;
  same(u.caret, { start: at, end: at }, 'the caret goes where the change was');
  assert.strictEqual(TL.redo(tl, a).text, b);
  assert.ok(TL.redo(tl, b).none, 'nothing more to redo');
});

rule('Timeline: Undo refuses when the text at that place changed since, and leaves the text alone', () => {
  const tl = TL.create(), a = 'one two three', b = 'one 2 three';
  TL.record(tl, a, b, { kind: 'op' });
  const later = 'one 3 three', u = TL.undo(tl, later);
  assert.strictEqual(u.error, 'It changed since; nothing undone.');
  assert.ok(!u.text);
  assert.strictEqual(TL.peek(tl).undo.ins, '2', 'still there to undo once the text is back');
  assert.strictEqual(TL.undo(tl, b).text, a, 'a change elsewhere is fine');
});

rule('Timeline: typing is grouped into units: a pause, a new line, a caret jump or a paste starts a new one', () => {
  const tl = TL.create();
  let t = typeInto(tl, '', 0, 'abc', 0);
  assert.strictEqual(tl.entries.length, 1, 'one unit for abc');
  t = typeInto(tl, t, 3, 'de', 300 + TL.PAUSE);
  assert.strictEqual(tl.entries.length, 2, 'a pause over a second starts a new unit');
  t = typeInto(tl, t, 5, '\nfg', 3000);
  assert.strictEqual(tl.entries.length, 3, 'a new line starts a new unit, and what follows it joins it');
  t = typeInto(tl, t, 0, 'X', 3400);
  assert.strictEqual(tl.entries.length, 4, 'typing somewhere else starts a new unit');
  const pasted = t + 'PASTED';
  TL.record(tl, t, pasted, { kind: 'paste', at: 3500 });
  t = typeInto(tl, pasted, pasted.length, 'h', 3550);
  assert.strictEqual(tl.entries.length, 6, 'paste is its own unit, and typing after it is another');
  // Backspacing is its own direction.
  TL.record(tl, t, t.slice(0, -1), { kind: 'typing', at: 3600 });
  TL.record(tl, t.slice(0, -1), t.slice(0, -2), { kind: 'typing', at: 3700 });
  assert.strictEqual(tl.entries.length, 7, 'two backspaces are one unit');
  // Undo goes back unit by unit.
  let cur = t.slice(0, -2);
  const want = [t, pasted, 'Xabcde\nfg', 'abcde\nfg', 'abcde', 'abc', ''];
  want.forEach(w => { const u = TL.undo(tl, cur); assert.ok(!u.error, u.error); cur = u.text; assert.strictEqual(cur, w); });
});

rule('Timeline: typing in another control of the step-type form starts a new unit', () => {
  const tl = TL.create();
  TL.record(tl, '{"a":"","b":""}', '{"a":"x","b":""}', { kind: 'typing', group: 'tf-a', at: 0 });
  TL.record(tl, '{"a":"x","b":""}', '{"a":"x","b":"y"}', { kind: 'typing', group: 'tf-b', at: 50 });
  assert.strictEqual(tl.entries.length, 2);
});

rule('Timeline: a closed unit takes no more typing (save, a builder change, switching views, leaving the editor)', () => {
  const tl = TL.create();
  let t = typeInto(tl, '', 0, 'ab', 0);
  TL.close(tl);
  t = typeInto(tl, t, 2, 'c', 150);
  assert.strictEqual(tl.entries.length, 2);
});

rule('Timeline: a new change after Undo drops what could be redone', () => {
  const tl = TL.create();
  TL.record(tl, 'a', 'ab', { kind: 'op' }); TL.record(tl, 'ab', 'abc', { kind: 'op' });
  TL.undo(tl, 'abc');
  assert.ok(TL.peek(tl).redo);
  TL.record(tl, 'ab', 'abX', { kind: 'op' });
  assert.ok(!TL.peek(tl).redo && tl.entries.length === 2 && tl.chars === 2);
});

rule('Timeline: past 200 changes, or 1 MB of changed text, the oldest are dropped', () => {
  const tl = TL.create();
  let t = '';
  for (let i = 0; i < 205; i++) { TL.record(tl, t, t + 'x', { kind: 'op', label: 'n' + i }); t += 'x'; }
  assert.strictEqual(tl.entries.length, TL.MAX);
  assert.strictEqual(tl.entries[0].label, 'n5', 'the five oldest went');
  assert.strictEqual(tl.pos, TL.MAX);
  const big = TL.create(), half = 'y'.repeat(600 * 1024);
  TL.record(big, '', half, { kind: 'op', label: 'first' });
  TL.record(big, half, half + half, { kind: 'op', label: 'second' });
  same(big.entries.map(e => e.label), ['second'], 'over 1 MB: the oldest went');
  assert.strictEqual(big.chars, half.length);
});

rule('Timeline: nothing before a barrier can be undone, and what was undone can\'t be redone after it', () => {
  const tl = TL.create();
  TL.record(tl, 'a', 'ab', { kind: 'op' }); TL.record(tl, 'ab', 'abc', { kind: 'op' });
  TL.undo(tl, 'abc');
  TL.barrier(tl, 'The draft changed in the folder here.');
  assert.ok(!TL.peek(tl).redo, 'redo dropped');
  const u = TL.undo(tl, 'theirs');
  assert.ok(u.none && /can't be undone/.test(u.error), u.error);
  same(tl.marks, [{ at: 1, why: 'The draft changed in the folder here.' }], 'History shows where');
  TL.record(tl, 'theirs', 'theirs!', { kind: 'op' });
  assert.strictEqual(TL.undo(tl, 'theirs!').text, 'theirs');
  assert.ok(TL.undo(tl, 'theirs').none, 'and stops at the barrier');
});

rule('Timeline: removing a field from a step type and undoing restores its whole definition in place', () => {
  const tl = TL.create();
  const def = { id: 'risk.level', label: 'Risk', fields: [{ k: 'k1', name: 'level', label: 'Level', kind: 'choice', options: 'Low\nHigh', required: true }, { k: 'k2', name: 'owner', label: 'Owner', kind: 'text' }, { k: 'k3', name: 'why', label: 'Why', kind: 'text' }], record: [] };
  const before = JSON.stringify(def), after = JSON.parse(before);
  after.fields.splice(1, 1);
  TL.record(tl, before, JSON.stringify(after), { kind: 'form', label: 'field removal', subject: 'owner' });
  const u = TL.undo(tl, JSON.stringify(after));
  same(JSON.parse(u.text), def);
  assert.strictEqual(TL.describe(u.entry), 'the field removal of "owner"');
});

rule('Timeline: builder operations are named in words', () => {
  const L = op => TL.labelOf(op).label;
  assert.strictEqual(L({ op: 'moveTo', step: 'a', to: {} }), 'move');
  assert.strictEqual(L({ op: 'edit', step: 'a', set: { text: 'x' } }), 'wording change');
  assert.strictEqual(L({ op: 'edit', step: 'a', set: { mark: '!' } }), 'must-do change');
  assert.strictEqual(L({ op: 'edit', step: 'a', set: { role: 'qa', on: true } }), 'role change');
  assert.strictEqual(L({ op: 'edit', step: 'a', set: { bind: 'commit', on: true } }), 'run detail change');
  assert.strictEqual(L({ op: 'edit', step: 'a', set: { field: 'where', value: 'x' } }), 'field change');
  assert.strictEqual(L({ op: 'delete', step: 'a' }), 'step deletion');
  assert.strictEqual(L({ op: 'gate', phase: 'a', set: { owner: 'qa' } }), 'gate owner change');
  assert.strictEqual(TL.past(TL.labelOf({ op: 'move', step: 'a' }).past, 'Smoke tests'), 'Moved "Smoke tests"');
  assert.strictEqual(TL.describe({ label: 'new step', kind: 'op', subject: 'Check the dashboards' }), 'the new step "Check the dashboards"');
});

rule('Timeline: typing in the Markdown is named by the step it\'s in', () => {
  const md = '## Prep · READ-DO {#prep}\n- [ ] {confirm} Smoke tests {#smoke}\n  where: staging\n';
  same(TL.itemAt(md, md.indexOf('staging')), { item: 'step:smoke', subject: 'Smoke tests' });
  same(TL.itemAt(md, 3), { item: 'phase:prep', subject: 'Prep' });
});

rule('Timeline: text moved by dragging is one change, so one Undo puts it back where it was', () => {
  const tl = TL.create(), a = 'one two three', b = 'one three', c = 'one three two';
  TL.record(tl, a, b, { kind: 'drop', label: 'drag and drop', wait: 'drag', at: 0 });
  TL.record(tl, b, c, { kind: 'drop', label: 'drag and drop', join: 'drag', at: 20 });
  assert.strictEqual(tl.entries.length, 1);
  assert.strictEqual(TL.undo(tl, c).text, a);
  assert.strictEqual(TL.redo(tl, a).text, c);
  // A drop from somewhere else, long after, is its own change.
  TL.record(tl, c, c + '!', { kind: 'drop', label: 'drag and drop', join: 'drag', at: 5000 });
  assert.strictEqual(tl.entries.length, 2);
});

run();
