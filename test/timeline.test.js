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

/* ---------- Saved history (slice 2) ---------- */
const H = PF.util.hash;
/* A saved-history entry as a window writes it, read back as the folder gives it. */
function entry(o, file) { return TL.cleanEntry(JSON.parse(JSON.stringify(TL.histLine(Object.assign({ kind: 'draft-edit', process: 'release', by: 'person-avery', at: '2026-10-19T09:00:00.000Z', source: 'editor', units: [], items: [] }, o)))), file || o.writer + '.jsonl'); }
const v = n => 'line ' + n + '\n';

rule('Saved history: entries are ordered by the fingerprints they link, never by their clocks', () => {
  const t0 = 'start\n', t1 = t0 + v(1), t2 = t1 + v(2), t3 = t2 + v(3);
  // Clocks disagree: the newest save says it happened first.
  const e1 = entry({ id: 'e1', writer: 'wina', seq: 1, from: H(t0), to: H(t1), before: t0, after: t1, at: '2026-10-19T12:00:00.000Z' });
  const e2 = entry({ id: 'e2', writer: 'winb', seq: 1, from: H(t1), to: H(t2), before: t1, after: t2, seen: 'e1', at: '2026-10-19T08:00:00.000Z' });
  const e3 = entry({ id: 'e3', writer: 'wina', seq: 2, from: H(t2), to: H(t3), before: t2, after: t3, seen: 'e2', at: '2020-01-01T00:00:00.000Z' });
  const ids = TL.order([e1, e3, e2], H(t3)).map(x => x.gap ? 'gap' : x.entry.id);
  same(ids, ['e3', 'e2', 'e1'], 'newest first along the chain');
});

rule('Saved history: where nothing leads to the file as it is, it says it was changed outside Flightdeck', () => {
  const t0 = 'a\n', t1 = 'a\nb\n', t2 = 'a\nb\nc\n', hand = 'a\nB\nc\n';
  const e1 = entry({ id: 'e1', writer: 'wina', seq: 1, from: H(t0), to: H(t1), before: t0, after: t1 });
  const e2 = entry({ id: 'e2', writer: 'wina', seq: 2, from: H(t1), to: H(t2), before: t1, after: t2, seen: 'e1' });
  same(TL.order([e1, e2], H(hand)).map(x => x.gap ? 'gap' : x.entry.id), ['gap', 'e2', 'e1'], 'an AI assistant or a hand edit after the last save');
  // A gap in the middle: the file was changed outside between two saves.
  const e3 = entry({ id: 'e3', writer: 'winb', seq: 1, from: H(hand), to: H(hand + 'd\n'), before: hand, after: hand + 'd\n', seen: 'e2' });
  same(TL.order([e3, e1, e2], H(hand + 'd\n')).map(x => x.gap ? 'gap' : x.entry.id), ['e3', 'gap', 'e2', 'e1']);
});

rule('Saved history: saves that reach the same text are ordered the same way on every computer, whatever order the files are read in', () => {
  const t0 = 'x\n', t1 = 'x\ny\n';
  // Two computers make the same change from the same draft; a third save follows one of them.
  const a = entry({ id: 'aaa', writer: 'wina', seq: 1, from: H(t0), to: H(t1), before: t0, after: t1 });
  const b = entry({ id: 'bbb', writer: 'winb', seq: 1, from: H(t0), to: H(t1), before: t0, after: t1 });
  const c = entry({ id: 'ccc', writer: 'winc', seq: 1, from: H(t1), to: H(t0), before: t1, after: t0, seen: 'bbb' });
  const want = JSON.stringify(TL.order([a, b, c], H(t0)));
  [[b, a, c], [c, b, a], [c, a, b], [b, c, a]].forEach(l => assert.strictEqual(JSON.stringify(TL.order(l, H(t0))), want, 'same order'));
  assert.strictEqual(TL.order([a, b, c], H(t0))[0].entry.id, 'ccc');
  // The same line read twice (OneDrive delivered a copy) counts once.
  assert.strictEqual(TL.order([a, a, b], H(t1)).filter(x => x.entry).length, 2);
});

rule('Saved history: a big change keeps only its fingerprints, and no line passes 80 KB', () => {
  const t0 = 'x\n', big = Array.from({ length: 3000 }, (_, i) => '- [ ] {confirm} Step number ' + i + ' with some words {#s' + i + '}').join('\n');
  const e = TL.histLine({ kind: 'draft-edit', id: 'big1', process: 'release', writer: 'wina', seq: 1, from: H(t0), to: H(big), before: t0, after: big, source: 'editor', units: [], items: [] });
  assert.ok(e.big && !e.hunks && e.from === H(t0) && e.to === H(big), 'hashes kept, lines dropped');
  assert.ok(TL.bytes(JSON.stringify(e)) <= TL.HIST.LINE);
  const small = TL.histLine({ kind: 'draft-edit', id: 's1', process: 'release', writer: 'wina', seq: 2, from: H(t0), to: H(t0 + 'y\n'), before: t0, after: t0 + 'y\n', units: [], items: [] });
  assert.ok(!small.big && small.hunks.length === 1);
  const tbig = TL.histLine({ kind: 'type-edit', id: 't1', type: 'risk.call', writer: 'wina', seq: 3, from: null, to: H('z'), before: null, after: { label: 'R', hint: 'x'.repeat(70000) } });
  assert.ok(tbig.big && !tbig.after && TL.bytes(JSON.stringify(tbig)) <= TL.HIST.LINE, 'a type definition too');
});

rule('Saved history: Reverse applies only when the lines a change inserted are still there, exactly once', () => {
  const a = '## Deploy {#deploy}\n- [ ] {confirm} One {#one}\n\n- [ ] {confirm} Two {#two}\n', b = a.replace('Two {#two}', 'Two, then check {#two}');
  const hs = TL.hunks(a, b);
  assert.strictEqual(TL.reverse(b, hs), a, 'reversed exactly');
  const later = b.replace('One {#one}', 'One, first {#one}');
  assert.strictEqual(TL.reverse(later, hs), a.replace('One {#one}', 'One, first {#one}'), 'a change elsewhere is kept');
  assert.strictEqual(TL.reverse(b.replace('then check', 'then look'), hs), null, 'the inserted line changed since');
  assert.strictEqual(TL.reverse(b + b, hs), null, 'found twice: refused, never guessed');
  // A deleted step comes back where it was, found by the lines around it.
  const c = a.replace('- [ ] {confirm} One {#one}\n\n', ''), hd = TL.hunks(a, c);
  assert.ok(hd.every(h => h.ins.length), 'a deletion carries the lines around it');
  assert.strictEqual(TL.reverse(c, hd), a);
});

rule('Saved history: lines from the folder are checked, and anything odd is dropped or capped, never trusted', () => {
  assert.strictEqual(TL.cleanEntry({ v: 2, kind: 'draft-edit' }), null, 'another format');
  assert.strictEqual(TL.cleanEntry({ v: 1, kind: 'draft-edit', id: 'x', writer: 'w', to: 'nothex!!', process: 'release' }), null, 'a bad fingerprint');
  assert.strictEqual(TL.cleanEntry({ v: 1, kind: 'draft-edit', id: 'x', writer: 'w', to: 'abcdef01', process: '../etc' }), null, 'a bad process');
  const raw = JSON.parse('{"v":1,"kind":"type-edit","id":"x1","type":"risk.call","writer":"w1","seq":"7","to":"abcdef01","from":null,"units":["<b>u</b>",5],"items":["field:a"],"before":{"__proto__":{"polluted":true},"label":"A","constructor":"c"},"after":{"label":"B"},"source":"made-up"}');
  const e = TL.cleanEntry(raw, 'w1.jsonl');
  assert.ok(e && e.seq === 0 && e.source === '' && e.units.length === 1 && e.file === 'w1.jsonl');
  assert.ok(Object.getPrototypeOf(e.before) === null && !('polluted' in e.before) && e.before.constructor === undefined && e.before.label === 'A', 'no prototype, no __proto__ or constructor');
  assert.strictEqual(({}).polluted, undefined);
});

rule('Saved history: a writer rolls over to a new file at 512 KB', () => {
  assert.strictEqual(TL.histFile('abc', 1), 'abc.jsonl');
  assert.strictEqual(TL.histFile('abc', 3), 'abc-3.jsonl');
  assert.ok(!TL.rolls(0, 600000), 'an empty file takes any line');
  assert.ok(TL.rolls(TL.HIST.ROLL - 10, 20) && !TL.rolls(TL.HIST.ROLL - 30, 20));
});

rule('Saved history: publications sit where the draft had the text they published', () => {
  const t0 = 'a\n', t1 = 'a\nb\n', t2 = 'a\nb\nc\n';
  const e1 = entry({ id: 'e1', writer: 'wina', seq: 1, from: H(t0), to: H(t1), before: t0, after: t1 });
  const e2 = entry({ id: 'e2', writer: 'wina', seq: 2, from: H(t1), to: H(t2), before: t1, after: t2 });
  const out = TL.placePublications(TL.order([e1, e2], H(t2)), [{ version: 1, hash: H(t1), by: 'person-avery' }, { version: 9, hash: 'ffffffff' }]);
  same(out.map(x => x.pub ? 'v' + x.pub.version : x.entry.id), ['e2', 'v1', 'e1'], 'v1 above the save it published; an unknown one isn\'t placed');
});

run();
