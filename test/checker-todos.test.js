// The assistants' folder checker reads to-do records (4.0, docs/design.md 45) exactly as the app does: every record in a corpus
// of valid ones and of each one damaged in every field is read by PF.todos.cleanFile and by check_folder.py, and the two
// refuse exactly the same files. A folder with a refused record lists it under refused, and a readable one is never refused.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { load, rule, run } = require('./harness');
const PF = load(), T = PF.todos;
const DIR = path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck');
const AT = '2026-11-09T09:00:00.000Z', RUN = { process: 'release-notes', id: 'r-1' };
function python() { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* try next */ } } return null; }

/* One of each kind of record, as the app writes them. */
function valid() {
  const body = { op: 'add', text: 'Check the links', target: { phase: 'draft' }, placement: { beforeGate: 'draft-confirm' } };
  const tool = T.buildProposal({ run: RUN, producer: { name: 'notes-bot', version: '1.2' }, key: 'k-1', seen: [], at: AT, body });
  const asked = T.buildProposal({ run: RUN, producer: { name: 'notes-bot', version: '1.2' }, key: 'k-2', seen: [], at: AT, body: Object.assign({ requester: 'person-blake' }, body) });
  const person = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'p-1'), by: 'person-blake', seen: [], at: AT, body: { op: 'wont', todo: T.todoIdFor(tool.id), reason: 'Covered elsewhere' } });
  const mv = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 'p-2'), by: 'person-blake', seen: [], at: AT, body: { op: 'move', todo: T.todoIdFor(tool.id), to: { ticket: 'ABC-12' } } });
  const cid = T.idFor('flightdeck', 'c-1'), cb = Object.assign({ todo: T.todoIdFor(cid) }, body), eff = T.effectOf(cb);
  const comp = T.buildProposal({ kind: 'compound', run: RUN, id: cid, by: 'person-avery', seen: [], at: AT, body, decision: { by: 'person-avery', consequence: '0123456789abcdef' }, application: { previous: '', effect: eff, fingerprint: T.fingerprint(eff) } });
  const g = T.buildGrant({ kind: 'grant', id: T.idFor('flightdeck', 'g-1'), run: RUN, seen: [], by: 'person-avery', at: AT, subject: { tool: 'notes-bot' }, ops: ['add', 'done'], targets: [{ phase: 'draft' }], limits: { adds: 10 } });
  const rv = T.buildGrant({ kind: 'revoke', id: T.idFor('flightdeck', 'r-1'), run: RUN, seen: [g.id], by: 'person-avery', at: AT, grant: g.id });
  const dec = T.buildStatus({ kind: 'decision', proposal: tool.id, run: RUN, seen: [tool.id], by: 'person-avery', at: AT, op: 'accept', consequence: '0123456789abcdef', writer: 'w1', rev: '0a1b2c3d' });
  const tb = Object.assign({ todo: T.todoIdFor(tool.id) }, body), te = T.effectOf(tb);
  const app = T.buildStatus({ kind: 'application', proposal: tool.id, run: RUN, seen: [tool.id], by: 'person-avery', at: AT, authority: { decision: dec.name.replace(/\.json$/, '') }, previous: '', effect: te, writer: 'w1', rev: '0a1b2c3e' });
  return [[tool.id + '.json', tool], [asked.id + '.json', asked], [person.id + '.json', person], [mv.id + '.json', mv], [cid + '.json', comp], [g.id + '.json', g], [rv.id + '.json', rv], [dec.name, dec.file], [app.name, app.file]];
}
/* Each record damaged one way at a time: every field dropped, retyped and nulled, an extra field, a newer or unmarked format,
   over-long text, a prototype key, another file name. */
function corpus() {
  const out = [], seen = Object.create(null);
  const put = (name, o, label) => { const text = typeof o === 'string' ? o : JSON.stringify(o); const k = name + '\n' + text; if (seen[k]) return; seen[k] = 1; out.push({ name, text, label }); };
  const walk = (o, at, fn) => { if (o && typeof o === 'object') Object.keys(o).forEach((k) => { fn(at.concat([k])); walk(o[k], at.concat([k]), fn); }); };
  const set = (o, at, v) => { const c = JSON.parse(JSON.stringify(o)); let x = c; at.slice(0, -1).forEach((k) => { x = x[k]; }); if (v === undefined) { if (Array.isArray(x)) x.splice(+at[at.length - 1], 1); else delete x[at[at.length - 1]]; } else x[at[at.length - 1]] = v; return c; };
  valid().forEach(([name, f]) => {
    const o = JSON.parse(T.text(f));
    put(name, o, 'valid');
    walk(o, [], (at) => {
      const l = at.join('.');
      put(name, set(o, at, undefined), 'drop ' + l);
      put(name, set(o, at, 7), 'number ' + l);
      put(name, set(o, at, null), 'null ' + l);
      put(name, set(o, at, ''), 'empty ' + l);
      put(name, set(o, at, 'x'.repeat(301)), 'long ' + l);
      put(name, set(o, at, 'a\u0001b'), 'control ' + l);
      put(name, set(o, at, true), 'boolean ' + l);
      put(name, set(o, at, []), 'list ' + l);
      put(name, set(o, at, {}), 'object ' + l);
    });
    put(name, Object.assign({}, o, { extra: 1 }), 'extra field');
    put(name, Object.assign({}, o, { format: o.format.replace(/4$/, '5') }), 'newer format');
    put(name, Object.assign({}, o, { features: ['living-runs', 'time-travel'] }), 'unknown feature');
    put(name, Object.assign({}, o, { features: [] }), 'no feature');
    put(name, JSON.stringify(o).replace(/^\{/, '{"__proto__":{"x":1},'), 'prototype key');
    put(name.replace(/^req-/, 'req-x'), o, 'another name');
    put(name.replace(/\.json$/, ' (1).json'), o, 'a copy\'s name');
    put(name.replace(/\.json$/, '-LAPTOP.json'), o, 'a laptop copy\'s name');
    put(name, '﻿' + JSON.stringify(o), 'byte-order mark');
    put(name, JSON.stringify(o, null, 2) + ' '.repeat(T.LIMITS.bytes), 'over the size limit');
  });
  return out;
}
function jsRefuses(c) {
  const t = c.text.replace(/^﻿/, '');
  let o; try { o = JSON.parse(t); } catch (e) { return 'not JSON'; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || !T.claims(o)) return 'not a to-do record';
  const raw = Object.create(null); Object.keys(o).forEach((k) => { raw[k] = o[k]; });
  let v; try { v = T.cleanFile(raw, c.name, Buffer.byteLength(c.text, 'utf8')); } catch (e) { v = { ok: false, why: 'threw' }; }
  return v.ok ? '' : v.why || 'refused';
}
const DRIVER = [
  'import sys, json',
  'sys.path.insert(0, sys.argv[1])',
  'import check_folder as C',
  'out = []',
  'for c in json.load(sys.stdin):',
  '    t = c["text"][1:] if c["text"].startswith("\\ufeff") else c["text"]',
  '    try:',
  '        o = json.loads(t, parse_int=float, parse_constant=C._no_constant)',
  '    except ValueError:',
  '        out.append("not JSON"); continue',
  '    if not isinstance(o, dict) or not C.todo_claims(o):',
  '        out.append("not a to-do record"); continue',
  '    out.append(C.todo_why(o, c["name"], len(c["text"].encode("utf-8"))) or "")',
  'print(json.dumps(out))'].join('\n');

rule('The checker refuses exactly the to-do records the app refuses, over every kind of record and every damaged field', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const cs = corpus();
  assert.ok(cs.length > 400, 'a corpus of ' + cs.length);
  const pyOut = JSON.parse(cp.execFileSync(py, ['-I', '-B', '-c', DRIVER, DIR], { input: JSON.stringify(cs), encoding: 'utf8', maxBuffer: 256 * 1048576 }));
  const off = [];
  cs.forEach((c, i) => { const j = jsRefuses(c), p = pyOut[i]; if (!!j !== !!p || (j === 'not a to-do record') !== (p === 'not a to-do record')) off.push(c.name + ' · ' + c.label + ' · app: ' + (j || 'reads it') + ' · checker: ' + (p || 'reads it')); });
  assert.deepStrictEqual(off, [], off.length + ' disagreements');
  assert.ok(cs.filter((c, i) => c.label === 'valid').every((c) => !jsRefuses(c)), 'every valid record reads');
  assert.ok(cs.filter((c) => c.label !== 'valid').some((c) => jsRefuses(c)), 'damage is refused');
});
rule('In a folder, a refused to-do record is listed under refused as the app names it, and a readable one never is', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-todo-check-')), [[name, f]] = valid(), o = JSON.parse(T.text(f));
  fs.mkdirSync(path.join(root, 'proposals'));
  fs.writeFileSync(path.join(root, 'proposals', name), T.text(f));
  const bad = T.idFor('notes-bot', 'k-9') + '.json';
  fs.writeFileSync(path.join(root, 'proposals', bad), JSON.stringify(Object.assign({}, o, { id: bad.slice(0, -5), key: 'k-9', todo: T.todoIdFor(bad.slice(0, -5)), text: 'x'.repeat(201) })));
  const res = JSON.parse(cp.execFileSync(py, ['-I', path.join(DIR, 'check_folder.py'), root], { encoding: 'utf8' }));
  const refused = res.refused.map((x) => x.file);
  assert.deepStrictEqual(refused, ['proposals/' + bad], JSON.stringify(res.refused));
  assert.ok(/at most 200/.test(res.refused[0].why) || /too long/.test(res.refused[0].why), res.refused[0].why);
});
run();
