// Run details that must match a pattern (2.16, Appendix A): the grammar and its refusals, the one context splitter, the
// linear matcher, code points as the unit, the descriptor carried by every reader and writer, and the 61-emoji round trip.
'use strict';
const assert = require('assert');
const { load, rule, run, exactOf } = require('./harness');
const PF = load(), V = PF.values, M = PF.map, P = PF.publish, R = PF.run;
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const NOW = '2026-11-04T15:00:00.000Z';
const TAG = '\\d{4}\\.\\d{1,3}\\.\\d{1,3}-rc\\d{1,3}-[0-9a-f]{7}';
const ok = (p, v) => V.matchPattern(V.compilePattern(p), v).ok;
const why = p => V.compilePattern(p).why || '';

rule('grammar: the release-tag example matches whole values only, anchors change nothing', () => {
  assert.ok(ok(TAG, '2026.11.0-rc3-7f3a9c1'));
  ['oops not a tag!!', '2026.11.0-rc3-7f3a9c', '2026.11.0-rc3-7f3a9c1x', 'x2026.11.0-rc3-7f3a9c1'].forEach(v => assert.ok(!ok(TAG, v), v));
  assert.ok(ok('^' + TAG + '$', '2026.11.0-rc3-7f3a9c1'));
  assert.ok(ok('a\\$', 'a$') && !ok('a\\$', 'a'), 'an escaped $ is a literal');
  assert.ok(ok('a\\\\$', 'a\\') && !ok('a\\\\$', 'a\\$'), 'after two backslashes, $ is the anchor');
  assert.ok(ok('[A-\\]]+', 'A]Z') && !ok('[A-\\]]+', 'a'), 'an escaped class endpoint');
  assert.ok(ok('x?y*z+w{2}v{1,}u{0,2}', 'zww v'.replace(' ', 'v')), 'every repeat form');
});
rule('grammar: each refused form says why', () => {
  const bad = {
    '(ab)': /groups and alternatives/, 'a|b': /groups and alternatives/, 'a.b': /any character/, '[^a]': /negated class/,
    '\\w+': /isn't an escape/, '\\1': /isn't an escape/, 'a**': /two repeats/, '[z-a]': /backwards/, 'a,b': /needs a \\/,
    '*a': /nothing before it/, 'a{101}': /goes up to 100/, 'a{3,2}': /goes up to 100/, '[abc': /never closed/, 'a]': /needs a \\/,
    '': /1 to 200/, ['a'.repeat(201)]: /1 to 200/, ['a'.repeat(41)]: /at most 40 parts/
  };
  Object.keys(bad).forEach(p => assert.ok(bad[p].test(why(p)), p + ' -> ' + why(p)));
  assert.ok(/direction character/.test(why('a‮b')) && /line break or control/.test(why('a' + String.fromCharCode(0x2028) + 'b')));
});
rule('grammar: an unescaped ( ) or , inside a class is refused with the hint; escaped, it round-trips through contextEntries', () => {
  assert.ok(why('[),]{1,3}').indexOf('inside pattern(...), write ( ) and , as \\( \\) \\, everywhere, even inside [...].') >= 0, why('[),]{1,3}'));
  const line = 'version, tag:pattern([\\)\\,]{1,3}), env:choice(dev|prod)';
  same(M.contextEntries(line), ['version', 'tag:pattern([\\)\\,]{1,3})', 'env:choice(dev|prod)']);
  assert.strictEqual(M.contextEntries(M.contextEntries(line).join(', ')).join(', '), line);
  assert.ok(ok('[\\)\\,]{1,3}', '),)') && !ok('[\\)\\,]{1,3}', '),),'));
  const wrong = M.parse('---\nprocess: r\ntitle: R\ncontext: tag:pattern([),]{1,3}), b\n---\n');
  assert.ok(wrong.errors.some(e => /a \[ is never closed/.test(e.msg)), JSON.stringify(wrong.errors));
});
rule('splitter: every valid older context line splits exactly as before', () => {
  ['a, b, c', 'ticket, rows:number, due:date, approved:yes-no, env:choice(dev|test|prod), runbook:link', ' a ,b,, c ', ''].forEach(l =>
    same(M.contextEntries(l), l.split(',').map(x => x.trim()).filter(Boolean), l));
});
rule('matcher: linear, never RegExp: a*a*a*a*a*a*a*a*a*a*b on 120 a\'s takes 1,320 state steps', () => {
  const t = Date.now(), m = V.matchPattern(V.compilePattern('a*a*a*a*a*a*a*a*a*a*b'), 'a'.repeat(120));
  assert.strictEqual(m.ok, false); assert.strictEqual(m.steps, 1320); assert.ok(Date.now() - t < 200);
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/core/values.js'), 'utf8');
  assert.ok(!/new RegExp\(/.test(src.slice(src.indexOf('2.16: patterns'))), 'the pattern code never builds a RegExp');
});
rule('code points: 61 emoji under [😀]{61} parse, 62 don\'t, and the length limit counts code points', () => {
  const def = { kind: 'pattern', pattern: '[😀]{61}', label: 'tag' };
  assert.ok(V.parse(def, '😀'.repeat(61), { max: V.DETAIL_MAX }).ok);
  assert.ok(!V.parse(def, '😀'.repeat(62), { max: V.DETAIL_MAX }).ok);
  assert.ok(ok('😀+', '😀😀') && ok('[😀]', '😀'));
  assert.ok(/at most 120 characters/.test(V.parse({ kind: 'pattern', pattern: '😀*', label: 'tag' }, '😀'.repeat(121), { max: 120 }).why));
  assert.ok(/should match \[😀\]\{61\}/.test(V.parse(def, 'x', {}).why));
});
rule('unitOf, len and cut: one mode, cp never splits a pair, utf16 is exactly slice', () => {
  assert.strictEqual(V.unitOf(['typed-details', 'detail-patterns']), 'cp'); assert.strictEqual(V.unitOf(['typed-details']), 'utf16'); assert.strictEqual(V.unitOf(null), 'utf16');
  const v = 'v' + '😀'.repeat(60);
  assert.strictEqual(V.len(v, 'cp'), 61); assert.strictEqual(V.len(v, 'utf16'), 121);
  assert.strictEqual(V.cut(null, v, 120, 'utf16').value, v.slice(0, 120));
  same(V.cut(null, '😀'.repeat(121), 120, 'cp'), { value: '😀'.repeat(120), cut: true, why: '' });
  assert.ok(!V.cut(null, '😀'.repeat(61), 120, 'cp').cut);
  assert.throws(() => V.cut(null, 'x', 1), /needs a unit/); assert.throws(() => V.len('x'), /needs a unit/);
  assert.ok(/should match/.test(V.cut({ kind: 'pattern', pattern: 'a{3}', label: 't' }, 'aaaa', 3, 'cp').why === '' ? 'should match' : 'x'));
});
rule('badText: the one forbidden set (controls, U+2028/9, direction characters, lone surrogates)', () => {
  [0, 0x1f, 0x7f, 0x9f, 0x2028, 0x2029, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069].forEach(c => assert.ok(V.badText('a' + String.fromCharCode(c)), c.toString(16)));
  assert.ok(V.badText('\ud800') && V.badText('x\udc00') && !V.badText('😀') && !V.badText('plain'));
});

const MD = ['---', 'process: rel', 'title: Release', 'context: version, tag:pattern(' + TAG + '), mood:pattern([😀]{61})', 'roles: lead', '---', '',
  '## Prepare · READ-DO {#prep}', '- [ ] {confirm} Note the tag {#note}', '  sets: tag', '- [ ] {confirm} Set the mood {#mood}', '  sets: mood', '',
  '## Gate: Tagged {#tagged}', '  approves: ^tag ^mood', '',
  '## Ship · DO-CONFIRM {#ship}', '- [ ] {confirm} Ship ^tag {#ship-it}', '  only when ^tag is set', ''].join('\n');
function publish(md) {
  const b = P.build(md, { people: [], customTypes: {}, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'abcd1234', app: '2.16.0' });
  assert.ok(!b.blockers, (b.blockers || []).join(' | '));
  const v = P.verify(b.folder, b.files, exactOf(PF, b.files));
  assert.ok(v.ok, v.why);
  return { b, v };
}
rule('descriptor: details() builds { kind: pattern, pattern } exactly as written; features and publish name detail-patterns', () => {
  const m = M.parse(MD);
  same(m.errors, []);
  same(m.meta.detailTypes.tag, { kind: 'pattern', pattern: TAG });
  same(M.features(m), ['detail-patterns', 'typed-details', 'conditions'].filter(f => PF.envelope.FROZEN.indexOf(f) >= 0).sort((a, b) => PF.envelope.FROZEN.indexOf(a) - PF.envelope.FROZEN.indexOf(b)));
  const info = JSON.parse(publish(MD).b.files['publication.json']);
  assert.ok(info.features.indexOf('detail-patterns') >= 0, JSON.stringify(info.features));
  assert.ok(P.needs(m, {}).names.some(n => /a run detail with a pattern/.test(n)), JSON.stringify(P.needs(m, {}).names));
  assert.ok(M.sameDetail({ kind: 'pattern', pattern: 'a' }, { kind: 'pattern', pattern: 'a' }) && !M.sameDetail({ kind: 'pattern', pattern: 'a' }, { kind: 'pattern', pattern: 'b' }));
});
rule('carriers: conditions allow only is set / is not set; skills and the read schema keep the source', () => {
  const m = M.parse(MD);
  assert.ok(/can only be tested with is set or is not set/.test(PF.conditions.parse('^tag is 2026', m.meta.context, m.meta.detailTypes).why || ''));
  assert.ok(PF.conditions.parse('^tag is set', m.meta.context, m.meta.detailTypes).test);
  const m2 = M.parse(MD.replace('-[0-9a-f]{7}', '-[0-9a-f]{8}'));
  const ch = PF.skills.changes(m, m2).filter(c => c.change === 'context')[0];
  assert.ok(ch && ch.from.indexOf('tag:pattern(' + TAG + ')') >= 0 && ch.to.indexOf('tag:pattern(' + TAG.replace('{7}', '{8}') + ')') >= 0, 'a pattern-only change is a change: ' + JSON.stringify(ch));
  same(PF.skills.changes(m, M.parse(MD)).filter(c => c.change === 'context'), []);
});
rule('outline: adding and renaming a run detail keep a pattern\'s commas inside it', () => {
  const O = PF.outline, line = l => l.split('\n').filter(x => /^context:/.test(x))[0];
  const added = O.apply(MD, { op: 'meta', key: 'context', set: { add: 'ticket' } });
  assert.ok(!added.error, added.error);
  assert.strictEqual(line(added.text), 'context: version, tag:pattern(' + TAG + '), mood:pattern([😀]{61}), ticket');
  same(M.parse(added.text).meta.detailTypes.tag, { kind: 'pattern', pattern: TAG });
  const removed = O.apply(added.text, { op: 'meta', key: 'context', set: { remove: 'ticket' } });
  assert.strictEqual(line(removed.text), line(MD));
});
rule('runs: a pattern detail is enforced at start and setDetail, and 61 emoji survive set, gate, save and reload with no repairs', () => {
  const pub = publish(MD).v, start = o => R.create(pub, Object.assign({ title: 'R', details: {}, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-p1', app: '2.16.0' }, o || {}));
  assert.throws(() => start({ details: { tag: 'oops not a tag!!' } }), /should match/);
  const r = start({ details: { tag: '2026.11.0-rc3-7f3a9c1' } }), map = R.mapOf(r);
  assert.strictEqual(R.detailUnit(r), 'cp');
  assert.ok(r.features.indexOf('detail-patterns') >= 0, JSON.stringify(r.features));
  assert.throws(() => R.setDetail(r, map, 'tag', 'nope', 'person-avery', NOW), /should match/);
  const ev = R.evidenceFor(r, M.findStep(map, 'mood').step, null, map).list.filter(e => e.detail === 'mood')[0];
  same([ev.kind, ev.pattern, ev.cap], ['pattern', '[😀]{61}', 120]);
  const emoji = '😀'.repeat(61);
  R.setDetail(r, map, 'mood', emoji, 'person-avery', NOW);
  assert.strictEqual(r.details.mood, emoji);
  const saved = JSON.parse(JSON.stringify(Object.assign({}, r, { gates: { tagged: { s: 'passed', by: 'person-avery', at: NOW, approved: { tag: r.details.tag, mood: emoji } } } })));
  const back = R.sanitize(saved);
  assert.ok(back && !back._unrunnable, back && back._unrunnable);
  assert.strictEqual(back.details.mood, emoji); assert.strictEqual(back.gates.tagged.approved.mood, emoji);
  same(R.repairs(saved), []);
  const legacy = JSON.parse(JSON.stringify(saved)); legacy.features = legacy.features.filter(f => f !== 'detail-patterns');
  assert.ok(/leave out detail-patterns/.test(R.sanitize(legacy)._unrunnable || ''), 'a damaged features list can\'t change the unit');
});
rule('R4-2: a pattern value is checked as entered, before any trimming, on every path: "v\\n" and U+0085 are refused, never cleaned', () => {
  const TAGV = '2026.11.0-rc3-7f3a9c1', bad = [TAGV + '\n', '\u0085' + TAGV, ' ' + TAGV, TAGV + ' '];
  const def = { kind: 'pattern', label: 'tag', pattern: TAG };
  bad.forEach(v => assert.ok(!V.parse(def, v).ok, 'parse refuses ' + JSON.stringify(v)));
  assert.ok(V.parse(def, TAGV).ok && V.parse(def, '').ok, 'a matching value and empty are fine');
  const pub = publish(MD).v, start = o => R.create(pub, Object.assign({ title: 'R', details: {}, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-p2', app: '2.16.0' }, o || {}));
  bad.forEach(v => assert.throws(() => start({ details: { tag: v } }), /tag/i, 'start refuses ' + JSON.stringify(v)));
  const r = start(), map = R.mapOf(r), key = R.evidenceFor(r, M.findStep(map, 'note').step, null, map).list.filter(e => e.detail === 'tag')[0].name;
  bad.forEach(v => {
    assert.throws(() => R.setDetail(r, map, 'tag', v, 'person-avery', NOW), /tag/i, 'setDetail refuses ' + JSON.stringify(v));
    assert.throws(() => R.done(r, map, 'note', 'person-avery', NOW, { [key]: v }), /tag/i, 'a setter\'s Done refuses ' + JSON.stringify(v));
  });
  assert.ok(!r.details.tag && !(r.steps.note && r.steps.note.s === 'done'), 'nothing was written');
  const PR = PF.practice, st = PR.fresh('rel');
  bad.forEach(v => assert.ok(PR.setSample(st, M.parse(MD), 'tag', v, {}).error, 'practice refuses ' + JSON.stringify(v)));
  const proc = { pubs: [{ ok: true }], index: { latest: { map: M.parse(MD), info: { version: 1 } }, all: [] } };
  bad.forEach(v => { const ck = PF.requests.check({ process: 'rel', supplied: { details: { tag: v } } }, proc); assert.ok(ck.errors && ck.errors.some(e => /tag/.test(e)), 'a request (CLI) refuses ' + JSON.stringify(v) + ': ' + JSON.stringify(ck)); });
  assert.ok(!PF.requests.check({ process: 'rel', supplied: { details: { tag: TAGV } } }, proc).errors, 'and takes a matching one');
});
rule('runs without detail-patterns keep today\'s UTF-16 cut exactly', () => {
  const o = { format: 'preflight-run/3', snapshot: '---\nprocess: x\n---\n' };
  assert.strictEqual(R.detailUnit(o), 'utf16');
  assert.strictEqual(V.cut(null, 'v' + '😀'.repeat(60), 120, R.detailUnit(o)).value, ('v' + '😀'.repeat(60)).slice(0, 120));
});
rule('practice: a 61-emoji sample is kept whole and comes back whole on reload with the draft', () => {
  const PR = PF.practice, map = M.parse(MD);
  let st = PR.fresh ? PR.fresh('rel') : null;
  if (!st) return;
  const s1 = PR.setSample(st, map, 'mood', '😀'.repeat(61), {});
  assert.ok(!s1.error, s1.error);
  assert.strictEqual(s1.state.sample.mood, '😀'.repeat(61));
  const back = PR.check(JSON.parse(JSON.stringify(s1.state)), 'rel', map);
  assert.strictEqual(back.sample.mood, '😀'.repeat(61));
  assert.throws(() => PR.check(JSON.parse(JSON.stringify(s1.state)), 'rel'), /needs the draft/, 'R14-1: the admitted draft is required');
  const src = ['src/ui/app.js', 'src/core/practice.js'].map(f => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8')).join('\n');
  (src.match(/PR\.check\([^;]*/g) || []).forEach(c => assert.ok(/PR\.check\([^,]+,[^,]+,[^,]+,\s*prEnv\(\)\)/.test(c), 'every PR.check( passes the admitted draft and the step types: ' + c));
});

rule('round 3: an empty class [] is refused, with or without a repeat, and says why', () => {
  for (const p of ['[]', '[]+', '[]?', '[]*', '[]{3}', 'v[]1']) assert.ok(/empty class \[\] matches nothing/.test(why(p)), p + ' -> ' + why(p));
  assert.ok(ok('[a]', 'a') && ok('[\\]]', ']'), 'a class with one character still works');
  same(M.parse('---\nprocess: p\ntitle: P\ncontext: tag:pattern([]+)\n---\n\n## A {#a}\n- [ ] x {#x}\n').errors.map(e => e.msg), ['Run detail "tag": its pattern can\'t be read: an empty class [] matches nothing; list what is allowed.']);
});

/* Round 5: one entry point for a patterned detail's value. PF.values.patternIn is the only way one enters or is compared:
   never trimmed, on every path (start, setDetail, Done, practice, plans, carried values, migrations, reports, requests). */
const TAGV = '2026.11.0-rc3-7f3a9c1', R5BAD = [TAGV + '\n', '\u0085' + TAGV, ' ' + TAGV, TAGV + ' '];
const TDEF = { kind: 'pattern', label: 'tag', pattern: TAG };
const MD5 = ['---', 'process: rel', 'title: Release', 'context: version, tag:pattern(' + TAG + ')', 'roles: lead', '---', '',
  '## Prepare · READ-DO {#prep}', '- [ ] {confirm} Ship ^tag {#ship-it}', ''].join('\n');
rule('R5: patternIn never trims; migrate validates the source text as it is, and a bad one is invalid, never cleaned', () => {
  assert.strictEqual(typeof V.patternIn, 'function');
  same(V.patternIn(TDEF, TAGV), { ok: true, canonical: TAGV });
  same(V.patternIn(TDEF, ''), { ok: true, canonical: '' });
  R5BAD.forEach(v => {
    assert.ok(!V.patternIn(TDEF, v).ok, 'patternIn refuses ' + JSON.stringify(v));
    same(V.migrate(TDEF, v), { verdict: 'invalid', result: null }, 'migrate leaves ' + JSON.stringify(v) + ' open');
  });
  same(V.migrate(TDEF, TAGV), { verdict: 'exact', result: TAGV });
});
rule('R5: a plan or a parent run carrying a bad value leaves the detail empty with its migration open', () => {
  const pub = publish(MD).v;
  ['plan', 'carry'].forEach(source => R5BAD.forEach(v => {
    const r = R.create(pub, { title: 'R', details: { tag: v }, from: { source, details: { tag: v } }, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-p5', app: '2.16.0' });
    assert.strictEqual(r.details.tag, '', source + ': ' + JSON.stringify(v) + ' is not stored');
    const m = (r.migrations || []).filter(x => x.path === 'details.tag');
    same(m.map(x => [x.source, x.verdict, x.from, x.result, x.resolved]), [[source, 'invalid', v, null, null]], source + ' ' + JSON.stringify(v));
    assert.strictEqual(R.openMigrations(r).length, 1, 'the migration is open');
  }));
  const r = R.create(pub, { title: 'R', details: { tag: TAGV }, from: { source: 'carry', details: { tag: TAGV } }, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-p6', app: '2.16.0' });
  assert.ok(r.details.tag === TAGV && !(r.migrations || []).length, 'a matching carried value is kept exactly');
});
function r5Group(r, inputs) {
  const rep = { format: 'flightdeck-report/1', process: 'rel', run: r.id, publication: { folder: r.folder }, step: 'ship-it', verdict: 'pass', blockers: [], evidence: {}, links: [], inputs,
    producer: { name: 'release-check', version: '1.0.0' }, created: NOW, id: 'abcd1234' };
  return { key: 'rel/' + r.id + '/ship-it/release-check/abcd1234', process: 'rel', run: r.id, step: 'ship-it', producer: 'release-check', id: 'abcd1234', copies: [{ ok: true, sha256: 'a'.repeat(64) }], report: rep, sha256: 'a'.repeat(64), differ: false, unreadable: [] };
}
rule('R5: a report claiming a bad pattern value is a mismatch, never matched by trimming; neither side is trimmed', () => {
  const pub = publish(MD5).v, X = PF.reports;
  const r = R.create(pub, { title: 'R', details: { tag: TAGV }, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-p7', app: '2.16.0' }), map = R.mapOf(r);
  const elig = g => X.eligible(g, r, map, { recording: true, now: NOW });
  const good = r5Group(r, [{ name: 'Tag', value: TAGV, source: 'detail:tag' }]);
  assert.strictEqual(X.applies(good.report, r, map, M.findStep(map, 'ship-it').step).result, 'match');
  assert.ok(elig(good).ok, elig(good).why);
  R5BAD.forEach(v => {
    const g = r5Group(r, [{ name: 'Tag', value: v, source: 'detail:tag' }]);
    assert.strictEqual(X.applies(g.report, r, map, M.findStep(map, 'ship-it').step).result, 'mismatch', JSON.stringify(v));
    assert.ok(!elig(g).ok && /Doesn't match/.test(elig(g).why), JSON.stringify(v) + ': ' + elig(g).why);
    assert.strictEqual(X.target(g.report, r, map).applies, 'no', 'target: ' + JSON.stringify(v));
  });
  const stored = JSON.parse(JSON.stringify(r)); stored.details.tag = ' ' + TAGV;
  assert.strictEqual(X.applies(good.report, stored, map, M.findStep(map, 'ship-it').step).result, 'mismatch', 'a stored value is not trimmed either');
});
rule('R5: the CLI report check --folder and report write --strict say applies no for a bad pattern value', () => {
  const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
  const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-pat-'));
  const put = (rel, text) => { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  const { b, v } = publish(MD5);
  Object.keys(b.files).forEach(n => put('publications/rel/' + b.folder + '/' + n, b.files[n]));
  put('people.json', JSON.stringify({ format: 'flightdeck-people/1', people: [{ id: 'person-avery', name: 'Avery' }] }));
  const r = R.create(v, { title: 'R', details: { tag: TAGV }, roles: { lead: 'person-avery' }, by: 'person-avery', session: 'w-a', now: NOW, id: 'run-p8', app: '2.16.0' });
  put('runs/rel/run-p8/run.json', JSON.stringify(r, null, 2));
  const cli = (args) => { const o = cp.spawnSync(process.execPath, [BIN, 'report'].concat(args, ['--json']), { encoding: 'utf8' }); let j = null; try { j = JSON.parse(o.stdout); } catch (e) { /* named below */ } return { code: o.status, j, out: o.stdout + o.stderr }; };
  const fileOf = (val, i) => put('in/r' + i + '.json', JSON.stringify({ format: 'flightdeck-report/1', run: 'rel/run-p8', publication: { folder: r.folder }, step: 'ship-it', verdict: 'pass', evidence: {},
    inputs: [{ name: 'Tag', value: val, source: 'detail:tag' }], producer: { name: 'ci-check', version: '1.0.0' }, created: '2026-11-04T15:00:00Z', id: 'k3m9p2q8x' + i }));
  const ok1 = cli(['check', fileOf(TAGV, 0), '--folder', dir]);
  assert.ok(ok1.j && ok1.j.data && ok1.j.data.report.applies === 'yes', ok1.out);
  R5BAD.forEach((val, i) => {
    const f = fileOf(val, i + 1);
    const c = cli(['check', f, '--folder', dir]);
    assert.ok(c.j && c.j.data && c.j.data.report.applies === 'no', JSON.stringify(val) + ' check: ' + c.out);
    const w = cli(['write', dir, f, '--dry-run', '--strict']);
    assert.ok(w.j && (w.j.error || w.j.data.report.applies === 'no'), JSON.stringify(val) + ' write --strict: ' + w.out);
  });
});
rule('R5 source: no code trims, cleans or compares a patterned value except through PF.values.patternIn', () => {
  const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  const vs = fs.readFileSync(path.join(root, 'src/core/values.js'), 'utf8');
  const body = vs.slice(vs.indexOf('function patternIn('), vs.indexOf('\n  }\n', vs.indexOf('function patternIn(')));
  assert.ok(body.length > 30 && !/\btrim\b|strip|\b(?:t|raw)\.replace\(/.test(body), 'patternIn never trims:\n' + body);
  assert.ok(/if \(k === 'pattern'\) return patternIn\(def, raw, opts\);/.test(vs), 'parse delegates its pattern branch');
  assert.ok(/if \(k === 'pattern'\) return patternIn\(def, oldText[,)]/.test(vs), 'migrate checks the source text as it is');
  assert.ok((vs.match(/\bmatchPattern\(/g) || []).length === 2 && /\bmatchPattern\(/.test(body), 'values.js: matchPattern is defined and called once, by patternIn');
  const files = [];
  const walk = d => fs.readdirSync(d).forEach(n => { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) { if (n !== 'vendor') walk(f); } else if (/\.js$/.test(n)) files.push(f); });
  walk(path.join(root, 'src')); files.push(path.join(root, 'bin', 'flightdeck.js'));
  const bad = [];
  files.filter(f => !/core[\\/]values\.js$/.test(f)).forEach(f => fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const at = path.relative(root, f) + ':' + (i + 1);
    if (/\bmatchPattern\(/.test(line)) bad.push(at + ' calls matchPattern');
    if (/['"]pattern['"]/.test(line) && /\.trim\(|\btrim\(|\.parse\(|\bmigrate\(|\.replace\(/.test(line) && !/\bpatternIn\(/.test(line)) bad.push(at + ' handles a pattern value without patternIn');
    if (/\b(?:V|values|PF\.values)\.(?:parse|migrate|valid)\([^,()]+,[^;]*?\.trim\(\)/.test(line)) bad.push(at + ' trims a typed value before parsing it');
  }));
  same(bad, [], bad.join('\n'));
});

rule('R6-2: a request (CLI) takes 61 emoji for [😀]{61}: a patterned detail\'s limit is its code points; other details keep 120 UTF-16 units', () => {
  const RQ = PF.requests, proc = { pubs: [{ ok: true }], index: { latest: { map: M.parse(MD), info: { version: 1 } }, all: [] } };
  const ask = details => { const c = RQ.clean({ process: 'rel', producer: { name: 'ci-check', version: '1.0.0' }, details }, '2026-11'); return { c, ck: c.errors.length ? null : RQ.check(c.intent, proc) }; };
  const e61 = '😀'.repeat(61), ok = ask({ mood: e61 });
  assert.strictEqual(ok.c.errors.length, 0, JSON.stringify(ok.c.errors));
  assert.ok(ok.ck && !ok.ck.errors, JSON.stringify(ok.ck));
  assert.strictEqual(ok.c.intent.supplied.details.mood, e61, 'kept whole');
  const over = ask({ mood: '😀'.repeat(62) });
  assert.ok((over.c.errors.concat(over.ck && over.ck.errors || [])).some(e => /mood/.test(e)), '62 emoji are refused: ' + JSON.stringify(over));
  const text = ask({ version: 'x'.repeat(121) });
  assert.ok((text.c.errors.concat(text.ck && text.ck.errors || [])).some(e => /"version" is 121 characters; the most is 120\./.test(e)), 'a text detail keeps its legacy limit: ' + JSON.stringify(text));
  const wide = ask({ version: '😀'.repeat(61) });
  assert.ok((wide.c.errors.concat(wide.ck && wide.ck.errors || [])).some(e => /"version" is 122 characters; the most is 120\./.test(e)), 'counted in UTF-16 units there: ' + JSON.stringify(wide));
});

run();
