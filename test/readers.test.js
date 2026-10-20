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
/* A site: its line, and the lines after it. */
const check = (text, next) => L.verdict({ file: 'src/storage/repo.js', line: 1, text, raw: text, next: next || '' });
rule('A value whose field is read before any checked reader is caught, however it was parsed', () => {
  assert.strictEqual(check("var o = json(f.text); if (o.kind === 'plan') keep(o);").ok, false);
  assert.strictEqual(check('var raw = json(g.f.text), d = PF.followups.cleanDecision(raw, p);').ok, true);
  assert.strictEqual(check('var o = json(f.text);', 'if (o === undefined) return;\nvar d = o.status;').ok, false);
  assert.strictEqual(check('var o = json(f.text);', "if (!o || typeof o !== 'object') return null;\nreturn R.sanitize(o);").ok, true);
  assert.strictEqual(check('return fs.read(p).then(function (f) { use(JSON.parse(f.text).steps); });').ok, false);
});
rule('A field used before the cleaner on the same line, or a cleaner called on another value, is caught', () => {
  assert.strictEqual(check("var o = json(t); var k = o.kind; return R.sanitize(o);").ok, false, 'field first, cleaner later on the line');
  assert.strictEqual(check("var o = json(t), d = R.sanitize(other); use(o.steps);").ok, false, 'a cleaner of an unrelated value');
  assert.strictEqual(check("keep(json(t).kind, R.sanitize(x));").ok, false, 'an inline parse whose field is read');
  assert.strictEqual(check("return f ? R.sanitize(json(f.text)) : null;").ok, true, 'parsed straight into the cleaner');
  assert.strictEqual(check("var o = json(t); if (o === undefined || !o || typeof o !== 'object') return; return R.sanitize(o);").ok, true, 'shape checks, then the cleaner');
});
rule('The lint scans every source file in src/ and bin/, so a new reader is never outside it', () => {
  const fsN = require('fs'), path = require('path'), root = path.join(__dirname, '..'), all = [];
  (function walk(d) { fsN.readdirSync(path.join(root, d), { withFileTypes: true }).forEach(e => { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) all.push(p); }); })('src');
  all.push('bin/flightdeck.js');
  assert.deepStrictEqual(L.files().slice().sort(), all.sort());
});

run();
