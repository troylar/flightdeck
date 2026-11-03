// PF.save (2.14, slice A2): the one verdict before a checked write (judge), what a write's facts settle to (settle), the words
// for each outcome, and the helpers flightdeck type save leans on: copies of a target, duplicate and odd keys in a text, who
// asked. Pure functions, run here without any folder (docs/apps.md, Writing step types).
'use strict';
const assert = require('assert');
const { rule, run, load } = require('./harness');

const PF = load(), S = PF.save, T = PF.types, TL = PF.timeline;
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ---------- judge: one verdict, in one fixed order ---------- */
const ORDER = ['held', 'edits-off', 'not-allowed', 'copies', 'newer', 'changed', 'same', 'checked'];
function base(mode) {
  return mode === 'edits'
    ? { mode, expect: 'r0', seen: { state: 'bytes', rev: 'r0' }, listing: ['x.json'], name: 'x.json', existing: { verdict: 'ok' }, asked: { required: false, verdict: '' }, newRev: 'r1', dryRun: false }
    : { mode, expect: 'none', seen: { state: 'missing', rev: null }, listing: [], name: 'x.json', existing: null, asked: { required: false, verdict: '' }, newRev: 'r1', dryRun: false };
}
/* Each reason, as a change to an input that would otherwise go. */
const REASON = {
  held: (o) => { o.asked.held = 'people.json couldn\'t be read'; },
  'edits-off': (o) => { o.expect = 'r0'; },
  'not-allowed': (o) => { o.asked.verdict = '--asked-by person-x isn\'t in people.json.'; },
  copies: (o) => { o.listing = o.listing.concat(['x-LAPTOP.json']); },
  newer: (o) => { o.seen = { state: 'bytes', rev: 'r0' }; o.existing = { verdict: 'newer', needs: '9.0' }; },
  changed: (o) => { if (o.mode === 'edits') o.expect = 'r9'; else { o.seen = { state: 'bytes', rev: 'r0' }; o.existing = o.existing && o.existing.verdict === 'newer' ? o.existing : { verdict: 'ok' }; } },
  same: (o) => { o.newRev = 'r0'; },
  checked: (o) => { o.dryRun = true; }
};
const KIND = { held: ['held', 'held'], 'edits-off': ['refused', 'edits-off'], 'not-allowed': ['refused', 'not-allowed'], copies: ['refused', 'copies'], newer: ['refused', 'newer'], changed: ['refused', 'changed'], same: ['same', null], checked: ['checked', null] };
function verdictOf(o) { const v = plain(S.judge(o)); return v.go ? 'go' : v.outcome + '/' + v.kind; }

rule('judge: with nothing in the way, a save goes, in both modes', () => {
  assert.strictEqual(verdictOf(base('edits')), 'go');
  assert.strictEqual(verdictOf(base('create-only')), 'go');
  assert.strictEqual(S.MODE, 'edits', 'the owner chose edits (design section 0.5, Option 2)');
});
rule('judge: each reason alone gives its own verdict', () => {
  for (const mode of ['edits', 'create-only']) for (const r of ORDER) {
    if (mode === 'edits' && r === 'edits-off') continue;
    if (mode === 'create-only' && r === 'same') continue;
    const o = base(mode); REASON[r](o);
    const [out, kind] = KIND[r];
    assert.strictEqual(verdictOf(o), out + '/' + kind, mode + ': ' + r);
  }
});
rule('judge order table: every pair of simultaneous reasons gives the documented winner, in both modes', () => {
  let n = 0;
  for (const mode of ['edits', 'create-only']) {
    const reasons = ORDER.filter((r) => !(mode === 'edits' && r === 'edits-off') && !(mode === 'create-only' && r === 'same'));
    for (let i = 0; i < reasons.length; i++) for (let j = i + 1; j < reasons.length; j++) {
      for (const pair of [[reasons[i], reasons[j]], [reasons[j], reasons[i]]]) {
        const o = base(mode); pair.forEach((r) => REASON[r](o));
        const [out, kind] = KIND[reasons[i]];
        assert.strictEqual(verdictOf(o), out + '/' + kind, mode + ': ' + pair.join(' + ') + ' (applied in this order)');
        n++;
      }
    }
  }
  assert.ok(n >= 80, 'pairs checked: ' + n);
});
rule('judge order table can fail: a judge that checks changed before copies is caught', () => {
  const swapped = (o) => (o.mode === 'edits' && o.expect !== o.seen.rev ? { outcome: 'refused', kind: 'changed' } : S.judge(o));
  const o = base('edits'); REASON.copies(o); REASON.changed(o);
  assert.notStrictEqual(swapped(o).kind, plain(S.judge(o)).kind, 'the table tells the two orders apart');
});
rule('judge: an unreadable target or a listing that failed is held, never missing', () => {
  const o = base('edits'); o.seen = { state: 'unreadable', rev: null, why: 'EACCES' };
  assert.strictEqual(verdictOf(o), 'held/held');
  const p = base('edits'); p.listing = { unlisted: true, why: 'EIO' };
  assert.strictEqual(verdictOf(p), 'held/held');
  const q = base('create-only'); q.seen = { state: 'unreadable', rev: null };
  assert.strictEqual(verdictOf(q), 'held/held', '--expect none is held too, never taken as absent');
});
rule('judge: --expect none over any file is changed, even an empty one; --expect <rev> over nothing is changed', () => {
  const o = base('edits'); o.expect = 'none'; o.seen = { state: 'bytes', rev: PF.sha256.hex('') };
  assert.strictEqual(verdictOf(o), 'refused/changed');
  const p = base('edits'); p.seen = { state: 'missing', rev: null }; p.existing = null;
  assert.strictEqual(verdictOf(p), 'refused/changed');
  const q = base('edits'); q.expect = 'none'; q.seen = { state: 'missing', rev: null }; q.existing = null;
  assert.strictEqual(verdictOf(q), 'go');
});
rule('judge: newer wins over whatever --expect says', () => {
  for (const exp of ['none', 'r0', 'r9']) {
    const o = base('edits'); o.expect = exp; o.existing = { verdict: 'newer', needs: '9.0' };
    assert.strictEqual(verdictOf(o), 'refused/newer', exp);
  }
});

/* ---------- copiesOf ---------- */
const copies = (name, names) => plain(S.copiesOf(name, names)).sort();
rule('copiesOf: numbered and host-suffix copies count; a lowercase suffix doesn\'t', () => {
  assert.deepStrictEqual(copies('x.json', ['x.json', 'x (1).json', 'x-LAPTOP.json', 'x-prod.json']), ['x (1).json', 'x-LAPTOP.json']);
});
rule('copiesOf: orphans count, with no x.json in the listing', () => {
  assert.deepStrictEqual(copies('x.json', ['x (1).json']), ['x (1).json']);
  assert.deepStrictEqual(copies('x.json', ['x-LAPTOP.json']), ['x-LAPTOP.json']);
});
rule('copiesOf: case: X-LAPTOP.json, x-LAPTOP.JSON and X (1).JSON are copies of x.json; x-laptop.json isn\'t', () => {
  assert.deepStrictEqual(copies('x.json', ['X-LAPTOP.json', 'x-LAPTOP.JSON', 'X (1).JSON', 'x-laptop.json']), ['X (1).JSON', 'X-LAPTOP.json', 'x-LAPTOP.JSON']);
});
rule('copiesOf: X.json clashes in capitals with x.json', () => {
  assert.deepStrictEqual(copies('x.json', ['x.json', 'X.json']), ['X.json']);
  assert.deepStrictEqual(copies('deploy.check.json', ['Deploy.check.json']), ['Deploy.check.json']);
});
rule('copiesOf: siblings named constructor.json, __proto__.json and toString.json are nobody\'s copies, and are found as targets', () => {
  const odd = ['constructor.json', '__proto__.json', 'toString.json', 'hasOwnProperty.json'];
  assert.deepStrictEqual(copies('x.json', odd), []);
  assert.deepStrictEqual(copies('constructor.json', odd.concat(['constructor-LAPTOP.json'])), ['constructor-LAPTOP.json']);
  assert.deepStrictEqual(copies('tostring.json', odd), ['toString.json']);
});
rule('copiesOf: competing bases: release-prod-LAPTOP.json is a copy of release-prod.json and of release.json (ambiguous names refuse for both)', () => {
  const names = ['release.json', 'release-prod-LAPTOP.json'];
  assert.deepStrictEqual(copies('release-prod.json', names), ['release-prod-LAPTOP.json']);
  assert.deepStrictEqual(copies('release.json', names), ['release-prod-LAPTOP.json']);
  /* The full-listing lookup copyOf does would have named release.json only. */
  const sib = {}; names.forEach((n) => { sib[n] = true; });
  assert.strictEqual(PF.health.copyOf('release-prod-LAPTOP.json', sib), 'release.json');
});
rule('copiesOf: release-LAPTOP.json beside target release-prod isn\'t a copy', () => {
  assert.deepStrictEqual(copies('release-prod.json', ['release-LAPTOP.json']), []);
});
rule('copiesOf agrees with health.copyOf whenever the name\'s base and extension already match the target\'s case', () => {
  const names = ['x (1).json', 'x (22).json', 'x-LAPTOP.json', 'x-My_PC-2.json', 'x-prod.json', 'x-.json', 'y-LAPTOP.json', 'x.y-LAPTOP.json', 'x (1)', 'x-L.json'];
  for (const n of names) {
    const ours = S.copiesOf('x.json', [n]).length > 0, theirs = PF.health.copyOf(n, { 'x.json': true }) === 'x.json';
    assert.strictEqual(ours, theirs, n);
  }
});
rule('copyBase: the type file a name is a copy of, for type list', () => {
  assert.strictEqual(S.copyBase('deploy.check-LAPTOP.json'), 'deploy.check.json');
  assert.strictEqual(S.copyBase('x (1).json'), 'x.json');
  assert.strictEqual(S.copyBase('Deploy.check.json'), 'deploy.check.json');
  assert.strictEqual(S.copyBase('release-prod-LAPTOP.json'), 'release.json');
  assert.strictEqual(S.copyBase('deploy.check.json'), null);
  assert.strictEqual(S.copyBase('x-prod.json'), null);
});

/* ---------- duplicateKeys and oddKeys ---------- */
rule('duplicateKeys: keys inside strings, escaped quotes, nesting', () => {
  assert.strictEqual(S.duplicateKeys('{"id":"a","label":"b","label":"c"}'), 'label');
  assert.strictEqual(S.duplicateKeys('{"id":"a","label":"\\"label\\": 1, \\"id\\""}'), null, 'keys written inside a string');
  assert.strictEqual(S.duplicateKeys('{"a":{"k":1},"b":{"k":2}}'), null, 'the same key in two objects');
  assert.strictEqual(S.duplicateKeys('{"a":{"k":1,"k":2}}'), 'k', 'nested');
  assert.strictEqual(S.duplicateKeys('{"a":[{"k":1},{"k":1,"j":2,"k":3}]}'), 'k', 'in a list');
  assert.strictEqual(S.duplicateKeys('{"l\\u0061bel":1,"label":2}'), 'label', 'an escape that spells the same key');
  assert.strictEqual(S.duplicateKeys('{"a\\\\":1,"a":2}'), null, 'a backslash at the end of a key');
  assert.strictEqual(S.duplicateKeys('[1,2,"x"]'), null);
});
rule('oddKeys: __proto__, constructor or prototype as a key at any depth', () => {
  assert.strictEqual(S.oddKeys(JSON.parse('{"id":"a"}')), null);
  assert.strictEqual(S.oddKeys(JSON.parse('{"__proto__":{}}')), '__proto__');
  assert.strictEqual(S.oddKeys(JSON.parse('{"fields":{"x":{"constructor":1}}}')), 'constructor');
  assert.strictEqual(S.oddKeys(JSON.parse('{"record":[{"name":"a","prototype":1}]}')), 'prototype');
  assert.strictEqual(S.oddKeys(JSON.parse('{"label":"constructor"}')), null, 'a value, not a key');
  let deep = '1'; for (let i = 0; i < 5000; i++) deep = '[' + deep + ']';
  assert.strictEqual(S.oddKeys(JSON.parse('{"a":' + deep + '}')), null, 'deep nesting never overflows');
});

/* ---------- PF.types additions ---------- */
const DEF = { id: 'sample.check', label: 'Sample check', fields: { system: { label: 'System', kind: 'text' } }, record: [{ name: 'approval', label: 'Approval', kind: 'text' }] };
rule('fileText is what repo.saveStepType writes on a MemoryFS', async () => {
  const m = new PF.fs.MemoryFS('save-test:' + Math.random(), null);
  for (const d of [DEF, { id: 'b.c', label: 'Überprüfung ✓' }, { format: 'flightdeck-step-type/2', features: ['typed-evidence'], id: 'n.c', label: 'N', record: [{ name: 'count', label: 'Count', kind: 'number', min: '0' }] }]) {
    const r = await PF.repo.saveStepType(m, d, null, { expectText: null });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(m.files['step-types/' + d.id + '.json'].t, T.fileText(d));
  }
  assert.strictEqual(T.fileText(DEF), JSON.stringify(DEF, null, 2) + '\n');
});
rule('formatWhy: an envelope nothing needs is refused; one 2.0 evidence needs is kept', () => {
  assert.ok(/doesn't use 2\.0 evidence/.test(T.formatWhy({ format: 'flightdeck-step-type/2', features: ['typed-evidence'], id: 'a.b', label: 'A' })));
  assert.ok(/doesn't use 2\.0 evidence/.test(T.formatWhy({ format: 'flightdeck-step-type/1', id: 'a.b', label: 'A' })));
  assert.strictEqual(T.formatWhy({ format: 'flightdeck-step-type/2', features: ['typed-evidence'], id: 'a.b', label: 'A', record: [{ name: 'n', label: 'N', kind: 'yes-no' }] }), '');
  assert.strictEqual(T.formatWhy(DEF), '');
});
rule('unusedKeys: nested keys the app\'s reader drops, so its editor would drop them on its next save', () => {
  assert.deepStrictEqual(plain(T.unusedKeys(DEF)), []);
  const d = JSON.parse(JSON.stringify(DEF)); d.fields.system.note = 'x'; d.record[0].extra = { a: 1 };
  assert.deepStrictEqual(plain(T.unusedKeys(d)), ['fields.system.note', 'record.approval.extra']);
});

/* ---------- inUse: what a removal does to drafts ---------- */
const draft = (proc, steps) => ({ process: proc, text: ['---', 'process: ' + proc, 'title: ' + proc, 'owner: person-avery', 'roles: lead', '---', '', '## Do · READ-DO {#do}'].concat(steps).concat(['']).join('\n') });
const STEP_SETS = ['- [ ] {sample.check} Check the system @lead {#chk}', '  system: Change board', '  require: approval'];
rule('inUse: a field removed while a draft step of that type sets it: one warning naming the draft and the step', () => {
  const after = JSON.parse(JSON.stringify(DEF)); delete after.fields.system;
  const w = plain(T.inUse(DEF, after, [draft('rel', STEP_SETS)]));
  assert.strictEqual(w.length, 1, JSON.stringify(w));
  assert.ok(/rel/.test(w[0]) && /chk/.test(w[0]) && /system/.test(w[0]), w[0]);
});
rule('inUse: evidence removed while a draft step requires it by name: one warning naming the draft and the step', () => {
  const after = JSON.parse(JSON.stringify(DEF)); after.record = [];
  const w = plain(T.inUse(DEF, after, [draft('rel', STEP_SETS)]));
  assert.strictEqual(w.length, 1, JSON.stringify(w));
  assert.ok(/rel/.test(w[0]) && /chk/.test(w[0]) && /approval/.test(w[0]), w[0]);
});
rule('inUse: evidence removed while a draft step has require: all: one warning saying the step will now require less', () => {
  const after = JSON.parse(JSON.stringify(DEF)); after.record = [];
  const w = plain(T.inUse(DEF, after, [draft('rel', ['- [ ] {sample.check} Check @lead {#chk}', '  require: all'])]));
  assert.strictEqual(w.length, 1, JSON.stringify(w));
  assert.ok(/rel/.test(w[0]) && /chk/.test(w[0]) && /less/.test(w[0]), w[0]);
});
rule('inUse: the same names on a step of a different type, a published-only use, or nothing removed: no warning', () => {
  const after = JSON.parse(JSON.stringify(DEF)); delete after.fields.system; after.record = [];
  assert.deepStrictEqual(plain(T.inUse(DEF, after, [draft('rel', ['- [ ] {other.check} Check @lead {#chk}', '  system: x', '  require: approval'])])), []);
  assert.deepStrictEqual(plain(T.inUse(DEF, after, [])), [], 'no draft uses it (published versions froze their types)');
  assert.deepStrictEqual(plain(T.inUse(DEF, DEF, [draft('rel', STEP_SETS)])), []);
});
rule('inUse: a renamed field counts as removed', () => {
  const after = JSON.parse(JSON.stringify(DEF)); after.fields = { platform: DEF.fields.system };
  const w = plain(T.inUse(DEF, after, [draft('rel', STEP_SETS)]));
  assert.strictEqual(w.length, 1, JSON.stringify(w));
});
rule('inUse can fail: an inUse that ignores require: all misses that warning', () => {
  const after = JSON.parse(JSON.stringify(DEF)); after.record = [];
  const drafts = [draft('rel', ['- [ ] {sample.check} Check @lead {#chk}', '  require: all'])];
  const broken = (a, b, d) => T.inUse(a, b, d.map((x) => ({ process: x.process, text: x.text.replace('require: all', 'require: ') })));
  assert.notStrictEqual(broken(DEF, after, drafts).length, T.inUse(DEF, after, drafts).length);
});

/* ---------- asked ---------- */
const PEOPLE = PF.people.clean([
  { id: 'person-avery', name: 'Avery Lee', folderRole: 'owner' }, { id: 'person-blake', name: 'Blake Kim', inactive: true },
  { id: 'person-casey', name: 'Casey Ng' }, { id: 'person-casey', name: 'Casey Two', inactive: true }]);
rule('asked: person rule: in people.json, first row for the ID, active', () => {
  assert.strictEqual(S.asked(PEOPLE, 'person-avery', 'person'), '');
  assert.strictEqual(S.asked(PEOPLE, 'person-casey', 'person'), '', 'the first row counts');
  assert.ok(/isn't in people\.json/.test(S.asked(PEOPLE, 'person-x', 'person')));
  assert.ok(/Blake Kim is marked inactive/.test(S.asked(PEOPLE, 'person-blake', 'person')));
  for (const odd of ['constructor', '__proto__', 'hasOwnProperty', 'toString']) assert.ok(/isn't in people\.json/.test(S.asked(PEOPLE, odd, 'person')), odd);
});
rule('asked: the manage rule uses PF.people.allowed\'s own words (prepares A4 and A5)', () => {
  assert.strictEqual(S.asked(PEOPLE, 'person-avery', 'manage', 'add'), '');
  assert.ok(S.asked(PEOPLE, 'person-casey', 'manage', 'add').indexOf(PF.people.allowed(PEOPLE, 'person-casey', 'add')) >= 0);
  assert.ok(/Only the folder owner and backup owner change the people list/.test(S.asked(PEOPLE, 'person-casey', 'manage', 'add')));
  assert.ok(S.asked(PEOPLE, 'person-avery', 'manage', 'inactive', 'person-avery').indexOf(PF.people.allowed(PEOPLE, 'person-avery', 'inactive', 'person-avery')) >= 0);
});

/* ---------- settle: the full cross-product ---------- */
const BACKS = ['same', 'other', 'missing', 'unreadable', 'unstable', null];
const HIST = { yes: { commit: 'yes', why: null }, no: { commit: 'no', why: 'EACCES' }, unknown: { commit: 'unknown', why: 'EIO' }, none: null };
const LEFT = { none: null, leftover: { leftover: ['step-types/.x.json.1.tmp'], why: 'EBUSY' } };
/* The table in design section 3.4, written out on its own. */
function expected(commit, back, hist, left) {
  const adds = [];
  const histAdd = hist === 'no' ? 'history-false' : hist === 'unknown' ? 'history-null' : null;
  if (commit === 'no') {
    if (back !== null || hist !== 'none') return 'throws';
    if (left === 'leftover') adds.push('leftover');
    return { outcome: 'refused', kind: 'changed', exit: 1, written: false, history: null, adds };
  }
  if (commit === 'unknown') {
    if (hist !== 'none') return 'throws';
    if (left === 'leftover') adds.push('leftover');
    return { outcome: 'unsure', kind: 'unsure', exit: 4, written: null, history: null, adds };
  }
  if (back === null || hist === 'none') return 'throws';
  const history = { written: hist === 'yes' ? true : hist === 'no' ? false : null };
  if (back === 'unreadable' || back === 'unstable' || back === 'other' || back === 'missing') {
    if (histAdd) adds.push(histAdd);
    if (left === 'leftover') adds.push('leftover');
    return { outcome: back === 'other' || back === 'missing' ? 'replaced' : 'unverified', kind: back === 'other' || back === 'missing' ? 'replaced' : 'unverified', exit: 4, written: true, history, adds };
  }
  if (hist !== 'yes') { if (left === 'leftover') adds.push('leftover'); return { outcome: 'partial', kind: 'history', exit: 4, written: true, history, adds }; }
  if (left === 'leftover') return { outcome: 'partial', kind: 'cleanup', exit: 4, written: true, history, adds };
  return { outcome: 'done', kind: null, exit: 0, written: true, history, adds };
}
rule('settle: the full cross-product of commit × back × history × cleanup, each row as section 3.4 says; impossible rows throw', () => {
  let n = 0, thrown = 0;
  for (const commit of ['no', 'yes', 'unknown']) for (const back of BACKS) for (const h of Object.keys(HIST)) for (const l of Object.keys(LEFT)) {
    const facts = { refused: commit === 'no' ? { outcome: 'refused', kind: 'changed', why: 'changed' } : null, commit, back, history: HIST[h], cleanup: LEFT[l], load: null };
    const want = expected(commit, back, h, l), label = [commit, back, h, l].join(' / ');
    n++;
    if (want === 'throws') { assert.throws(() => S.settle(facts), /settle:/, label); thrown++; continue; }
    const got = plain(S.settle(facts));
    assert.strictEqual(got.outcome, want.outcome, label + ': outcome');
    assert.strictEqual(got.kind, want.kind, label + ': kind');
    assert.strictEqual(got.exit, want.exit, label + ': exit');
    assert.strictEqual(got.written, want.written, label + ': written');
    assert.deepStrictEqual(got.history === null ? null : { written: got.history.written }, want.history, label + ': history');
    assert.strictEqual(got.back, commit === 'no' ? null : back, label + ': back');
    assert.deepStrictEqual(got.cleanup, LEFT[l], label + ': cleanup');
    assert.deepStrictEqual(got.adds, want.adds, label + ': added sentences');
    assert.strictEqual(got.exit, S.EXIT[got.outcome], label + ': EXIT');
  }
  assert.strictEqual(n, 144);
  assert.ok(thrown > 0 && thrown < n);
});
rule('settle can fail: a settle that lets history decide before the read-back is caught', () => {
  const facts = { refused: null, commit: 'yes', back: 'other', history: HIST.no, cleanup: null, load: null };
  const broken = (f) => (f.history && f.history.commit !== 'yes' ? { outcome: 'partial' } : S.settle(f));
  assert.notStrictEqual(broken(facts).outcome, expected('yes', 'other', 'no', 'none').outcome);
  assert.strictEqual(S.settle(facts).outcome, expected('yes', 'other', 'no', 'none').outcome);
});
rule('settle: a pre-commit failure is failed, exit 1, written false; held is exit 4', () => {
  const f = plain(S.settle({ refused: { outcome: 'failed', kind: 'link-check', why: 'EIO' }, commit: 'no', back: null, history: null, cleanup: null }));
  assert.deepStrictEqual([f.outcome, f.kind, f.exit, f.written], ['failed', 'link-check', 1, false]);
  const h = plain(S.settle({ refused: { outcome: 'held', kind: 'held', why: 'x' }, commit: 'no', back: null, history: null, cleanup: null }));
  assert.deepStrictEqual([h.outcome, h.kind, h.exit, h.written], ['held', 'held', 4, false]);
  for (const o of ['same', 'checked']) {
    const s = plain(S.settle({ refused: { outcome: o, kind: null }, commit: 'no', back: null, history: null, cleanup: null }));
    assert.deepStrictEqual([s.outcome, s.kind, s.exit, s.written], [o, null, 0, false]);
  }
});

/* ---------- the outcome table's rules (section 3.5) ---------- */
const SAMPLE = { path: 'step-types/x.json', why: 'EIO', copies: ['step-types/x-LAPTOP.json'], needs: '9.0', load: { position: 3, limit: 100, from: 'C' }, history: { written: false, why: 'EACCES' }, cleanup: { leftover: ['step-types/.x.json.1.tmp'], why: 'EBUSY' } };
const CASES = [['done'], ['same'], ['checked', null, { dryRun: true, load: { position: 3, limit: 100, from: 'R1' } }], ['refused', 'changed'], ['refused', 'copies'], ['refused', 'newer'], ['refused', 'invalid'], ['refused', 'not-allowed'], ['refused', 'no-links'], ['refused', 'edits-off'], ['refused', 'usage'],
  ['failed', 'failed'], ['failed', 'link-check'], ['held', 'held'], ['partial', 'history'], ['partial', 'history', { history: { written: null, why: 'EIO' } }], ['partial', 'cleanup'], ['replaced', 'replaced', { back: 'other' }], ['replaced', 'replaced', { back: 'missing' }],
  ['unverified', 'unverified', { back: 'unreadable' }], ['unverified', 'unverified', { back: 'unstable' }], ['unsure', 'unsure']];
const wordsOf = (c) => S.words(c[0], Object.assign({ kind: c[1] || null }, SAMPLE, c[2] || {}));
rule('Outcome table: every outcome has words and an exit code; an outcome with no words throws', () => {
  CASES.forEach((c) => { const w = wordsOf(c); assert.ok(typeof w === 'string' && w.length > 10, c.join('/')); assert.ok(c[0] in S.EXIT, c[0]); });
  assert.throws(() => S.words('nonsense', SAMPLE));
  assert.deepStrictEqual(Object.keys(S.EXIT).sort(), ['checked', 'done', 'failed', 'held', 'partial', 'refused', 'replaced', 'same', 'unsure', 'unverified']);
  Object.keys(S.EXIT).forEach((o) => assert.ok(CASES.some((c) => c[0] === o), 'a case for ' + o));
});
rule('Outcome table: exit 1 means written false; written false words start "Nothing was changed." or "Nothing to change", or say Checked; written true words start "Saved" or "Your save was written"', () => {
  CASES.forEach((c) => {
    const o = S.OUTCOMES[c[0]], w = wordsOf(c);
    if (S.EXIT[c[0]] === 1) assert.strictEqual(o.written, false, c.join('/'));
    if (o.written === false) assert.ok(/^Nothing was changed\.|^Nothing to change|^Checked\./.test(w), c.join('/') + ': ' + w);
    if (o.written === true) assert.ok(/^Saved|^Your save was written/.test(w), c.join('/') + ': ' + w);
  });
  assert.deepStrictEqual(Object.keys(S.OUTCOMES).filter((o) => S.OUTCOMES[o].written === null), ['unsure'], 'unsure is the only outcome with written: null');
});
rule('Outcome table: no words promise recovery, Reverse, loading, or that an overwrite can\'t happen; no refusal says "change it in Flightdeck"', () => {
  const bad = /recover|reverse|undo|restor|will load|loads it|uses it|next refresh|can't overwrite|cannot overwrite|never overwrit|closed by construction|change it in Flightdeck/i;
  CASES.forEach((c) => { const w = wordsOf(c); assert.ok(!bad.test(w), c.join('/') + ': ' + w); });
  const all = CASES.map(wordsOf).join('\n');
  assert.ok(!/write the file|edit step-types\/|overwrite|replace the file/i.test(all), 'no refusal sends an assistant around the command');
});
rule('Outcome words: the load sentence after a save, past the limit, and on a dry run', () => {
  const w = (o, load) => S.words(o, Object.assign({}, SAMPLE, { load, dryRun: o === 'checked' }));
  assert.ok(/As of this save it's number 100 of the step-type files Flightdeck reads; it reads the first 100 by name\./.test(w('done', { position: 100, limit: 100, from: 'C' })));
  assert.ok(/Flightdeck won't load it: it reads only the first 100 step-type files by name, and this is number 101\. Removing others is a person's call\./.test(w('done', { position: 101, limit: 100, from: 'C' })));
  assert.ok(/If saved with these files present, it would be number 100 of the step-type files/.test(w('checked', { position: 100, limit: 100, from: 'R1' })));
  assert.ok(/If saved with these files present, it would be number 101, and Flightdeck wouldn't load it/.test(w('checked', { position: 101, limit: 100, from: 'R1' })));
  assert.ok(!/As of this save/.test(w('checked', { position: 5, limit: 100, from: 'R1' })), 'a dry run never says As of this save');
  assert.ok(!/number/.test(S.words('same', SAMPLE)), 'same carries no load sentence');
  assert.strictEqual(S.LIMIT, 100);
});
rule('Outcome words: the sentences added to replaced, unverified and refusals', () => {
  const add = (o, k, extra) => S.words(o, Object.assign({ kind: k }, SAMPLE, extra));
  assert.ok(/Its history line couldn't be written either: EACCES/.test(add('replaced', 'replaced', { back: 'other' })));
  assert.ok(/Flightdeck couldn't confirm its history line either: EIO/.test(add('unverified', 'unverified', { back: 'unreadable', history: { written: null, why: 'EIO' } })));
  assert.ok(/A temporary file was left at step-types\/\.x\.json\.1\.tmp; it's safe to delete\./.test(add('refused', 'changed', { history: null })));
  assert.ok(/then removed by another change/.test(add('replaced', 'replaced', { back: 'missing', history: null, cleanup: null })));
  assert.ok(/couldn't confirm it: it changed while Flightdeck was reading it back/.test(add('unverified', 'unverified', { back: 'unstable', history: null, cleanup: null })));
});
rule('History warnings come from the omitted reasons: "wasn\'t a valid step type" only for invalid', () => {
  assert.deepStrictEqual(plain(S.historyWarnings({ before: null, after: null })), []);
  assert.deepStrictEqual(plain(S.historyWarnings({ before: 'invalid', after: null })), ['History records this save without the previous version (it wasn\'t a valid step type).']);
  for (const r of ['cap', 'cleaned', 'fallback']) {
    const w = plain(S.historyWarnings({ before: r, after: r }));
    assert.deepStrictEqual(w, ['History records this save without its contents.'], r);
  }
  assert.deepStrictEqual(plain(S.historyWarnings({ before: 'invalid', after: 'fallback' })).length, 2);
});

/* ---------- the reader's facts the design leans on ---------- */
rule('The guard vs the reader (D8): checkCustom says "must be a JSON object" for null, booleans, numbers and strings, and the ID and label errors for arrays', () => {
  for (const v of [null, true, false, 42, 'broken']) assert.deepStrictEqual(plain(T.checkCustom(v)), ['must be a JSON object'], JSON.stringify(v));
  const a = plain(T.checkCustom([])), b = plain(T.checkCustom([{}]));
  assert.ok(a.length >= 2 && /"id"/.test(a[0]) && /"label"/.test(a[1]), JSON.stringify(a));
  assert.ok(b.some((x) => /unknown field\(s\): 0/.test(x)), JSON.stringify(b));
});
rule('History is a record, not recovery: a step-type line is never reversible; a pair over 64 KB keeps neither definition', () => {
  const line = TL.histLine({ kind: 'type-edit', id: 'p-1-abcdefghij', type: 'sample.check', writer: 'p-1-abcdefghij', seq: 1, by: '', at: '2026-11-03T00:00:00Z', from: null, to: PF.util.hash(T.fileText(DEF)), seen: null, before: null, after: DEF, source: 'agent', units: ['x'] });
  const e = TL.cleanEntry(plain(line), 'agent-p-1-abcdefghij.jsonl');
  assert.ok(e && e.after && e.source === 'agent');
  assert.strictEqual(TL.reversible(e), false);
  const big = JSON.parse(JSON.stringify(DEF)); big.hint = 'x'.repeat(100); big.fields = {};
  for (let i = 0; i < 30; i++) big.fields['f' + i] = { label: 'F', kind: 'choice', options: Array.from({ length: 60 }, (x, j) => 'option-' + i + '-' + j + '-' + 'y'.repeat(20)) };
  const l2 = TL.histLine({ kind: 'type-edit', id: 'p-1-abcdefghij', type: 'sample.check', writer: 'p-1-abcdefghij', seq: 1, to: 'abcdef12', before: null, after: big, source: 'agent' });
  assert.strictEqual(l2.big, true);
  assert.ok(!('after' in l2));
});

run();
