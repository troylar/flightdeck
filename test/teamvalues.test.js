// Team values (2.9): team-values.json, read and checked by PF.teamValues, and looked up by a pass: line's team: source.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), T = PF.teamValues, E = PF.envelope;
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const doc = (values) => JSON.stringify({ format: 'flightdeck-team-values/1', values });
const BASE = { 'bitbucket-base-url': { value: 'https://bitbucket.example.com/projects/PAY', about: 'Bitbucket base URL' } };

rule('parse: a good file reads as ok with its values', () => {
  const r = T.parse(doc(BASE));
  assert.strictEqual(r.state, 'ok', r.why);
  same(r.doc.values, BASE);
});

rule('parse: no file is missing (no team values), never an error', () => {
  same(T.parse(null).state, 'missing');
  same(T.lookup(T.parse(null), 'bitbucket-base-url'), { missing: true });
});

rule('parse: bad JSON, the wrong shape, bad names, values and limits are malformed with a reason', () => {
  const bad = {
    '{': /isn't valid JSON/,
    '[]': /isn't a JSON object/,
    [JSON.stringify({ values: {} })]: /has no format/,
    [JSON.stringify({ format: 'flightdeck-team-values/1' })]: /values/,
    [JSON.stringify({ format: 'flightdeck-team-values/1', values: [] })]: /values/,
    [doc({ 'Bad Name': { value: 'x' } })]: /"Bad Name" isn't a team value name/,
    [doc({ ['a'.repeat(41)]: { value: 'x' } })]: /isn't a team value name/,
    [doc({ x: { value: 'a'.repeat(121) } })]: /at most 120 characters/,
    [doc({ x: { value: 'a\u0007b' } })]: /control character/,
    [doc({ x: { value: ' padded ' } })]: /spaces at the start or end/,
    [doc({ x: { value: '' } })]: /is empty/,
    [doc({ x: { value: 3 } })]: /isn't text/,
    [doc({ x: { value: 'v', about: 'a'.repeat(81) } })]: /at most 80 characters/,
    [doc({ x: { value: 'v', color: 'red' } })]: /"color"/,
    [doc({ __proto__: null, constructor: { value: 'v' } })]: /keeps for itself/
  };
  Object.keys(bad).forEach(t => { const r = T.parse(t); assert.strictEqual(r.state, 'malformed', t); assert.ok(bad[t].test(r.why), t + ': ' + r.why); });
  const many = {}; for (let i = 0; i < 101; i++) many['v' + i] = { value: 'x' };
  const r = T.parse(doc(many)); assert.strictEqual(r.state, 'malformed'); assert.ok(/at most 100/.test(r.why), r.why);
});

rule('parse: an unknown top-level key is read but read-only, with the reason', () => {
  const r = T.parse(JSON.stringify({ format: 'flightdeck-team-values/1', values: BASE, extra: 1 }));
  assert.strictEqual(r.state, 'ok');
  assert.ok(r.readOnly && /"extra"/.test(r.readOnly), r.readOnly);
  same(T.lookup(r, 'bitbucket-base-url'), { value: BASE['bitbucket-base-url'].value });
});

rule('parse: a newer format or feature is newer, naming what it needs', () => {
  const r = T.parse(JSON.stringify({ format: 'flightdeck-team-values/2', values: {} }));
  assert.strictEqual(r.state, 'newer'); assert.ok(/newer Flightdeck/.test(r.why), r.why);
  const f = T.parse(JSON.stringify({ format: 'flightdeck-team-values/1', features: ['secrets'], values: {} }));
  assert.strictEqual(f.state, 'newer');
});

rule('lookup: each result, by name', () => {
  const ok = T.parse(doc(BASE));
  same(T.lookup(ok, 'bitbucket-base-url'), { value: 'https://bitbucket.example.com/projects/PAY' });
  same(T.lookup(ok, 'nope'), { missing: true });
  same(T.lookup(ok, 'constructor'), { missing: true });
  same(T.lookup(T.parse('{'), 'x').malformed, true);
  same(T.lookup({ state: 'unreadable', why: 'locked' }, 'x'), { unreadable: true, why: 'locked' });
  same(T.lookup(T.parse(JSON.stringify({ format: 'flightdeck-team-values/9', values: {} })), 'x').newer, true);
});

rule('text: writes the file back in a stable shape that reads the same; check refuses what parse would', () => {
  const t = T.text({ values: BASE });
  assert.strictEqual(T.parse(t).state, 'ok');
  same(T.parse(t).doc.values, BASE);
  assert.strictEqual(t, T.text(T.parse(t).doc), 'stable');
  assert.ok(/^\{\n  "format": "flightdeck-team-values\/1",/.test(t), t);
  assert.ok(T.check({ values: { 'Bad': { value: 'x' } } }), 'check names the problem');
  assert.strictEqual(T.check({ values: BASE }), '');
});

rule('the largest file F1 allows (100 values at every limit, 4-byte characters) fits under TEAM_MAX', () => {
  const values = {};
  for (let i = 0; i < 100; i++) values[('v' + i + '-' + 'x'.repeat(40)).slice(0, 40)] = { value: '\u{1F600}'.repeat(60), about: '\u{1F600}'.repeat(40) };
  const t = T.text({ values });
  assert.strictEqual(T.parse(t).state, 'ok', T.parse(t).why);
  assert.ok(Buffer.byteLength(t, 'utf8') < T.MAX_BYTES, Buffer.byteLength(t, 'utf8') + ' bytes');
});

rule('the envelope knows the family and the file', () => {
  assert.strictEqual(E.familyOfPath('team-values.json'), 'flightdeck-team-values');
  assert.ok(E.judge('flightdeck-team-values', JSON.parse(doc(BASE))).ok);
  assert.strictEqual(E.FAMILIES['flightdeck-team-values'].rewrite, true);
});

run();
