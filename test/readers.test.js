// The reader lint (tools/readers.js; docs/design.md section 28): every JSON parse in the storage code, the app and the command
// follows its value to a checked reader before a field is read, or is a raw consumer listed with why.
'use strict';
const assert = require('assert');
const { rule, run } = require('./harness');
const L = require('../tools/readers');

rule('Every parse site in the storage code, the app and the command reaches a checked reader or is a listed raw consumer', () => {
  const bad = L.lint().filter(s => !s.ok).map(s => s.file + ':' + s.line + ' ' + s.how);
  assert.deepStrictEqual(bad, []);
});
rule('Every listed raw consumer is still a real site (the list can\'t grow stale)', () => {
  const all = L.lint(), unused = L.RAW.filter(r => !all.some(s => s.raw === r)).map(r => r.file + ': ' + r.has);
  assert.deepStrictEqual(unused, []);
});
const check = (text, next) => L.verdict({ file: 'src/storage/repo.js', line: 1, text, next: next || text });
rule('A value whose field is read before any checked reader is caught, however it was parsed', () => {
  assert.strictEqual(check("var o = json(f.text); if (o.kind === 'plan') keep(o);").ok, false);
  assert.strictEqual(check('var raw = json(g.f.text), d = PF.followups.cleanDecision(raw, p);').ok, true);
  assert.strictEqual(check('var o = json(f.text);', 'var o = json(f.text);\nif (o === undefined) return;\nvar d = o.status;').ok, false);
  assert.strictEqual(check('var o = json(f.text);', "var o = json(f.text);\nif (!o || typeof o !== 'object') return null;\nreturn R.sanitize(o);").ok, true);
  assert.strictEqual(check('return fs.read(p).then(function (f) { use(JSON.parse(f.text).steps); });').ok, false);
});
run();
