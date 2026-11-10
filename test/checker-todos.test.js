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
  /* Spreads (4.0 slice 3): a spread-add, an include, a binding, a stop, a story's request that fulfils one, and an application. */
  const bot = { name: 'notes-bot', version: '1.2' }, pair = { uid: 'jira:10101', attempt: 1 };
  const sp = T.buildProposal({ run: RUN, producer: bot, key: 's-1', seen: [], at: AT, body: { op: 'spread-add', loopStep: 'each', text: 'Security sign-off', owner: 'person-blake', reason: 'Audit', child: { beforeGate: 'assess-confirm' },
    scope: { open: [pair], cleared: [{ uid: 'jira:key:ABC-2', attempt: 2 }], fingerprint: '0123456789abcdef', seen: [] } } });
  const inc = T.buildProposal({ run: RUN, producer: bot, key: 's-2', seen: [sp.id], at: AT, body: { op: 'spread-include', spread: sp.spread, item: { uid: 'jira:key:ABC-2', attempt: 2 } } });
  const bnd = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 's-3'), by: 'person-avery', seen: [], at: AT, body: { op: 'spread-bind', spread: sp.spread, item: pair, dest: { process: 'validate-story', id: 'k101' } } });
  const stp = T.buildProposal({ run: RUN, id: T.idFor('flightdeck', 's-4'), by: 'person-avery', seen: [], at: AT, body: { op: 'spread-stop', spread: sp.spread, reason: 'Covered elsewhere', owed: [pair], cut: [] } });
  const kidRun = { process: 'validate-story', id: 'k101' }, ful = { run: RUN, spread: sp.spread, uid: pair.uid, attempt: 1 };
  const fil = T.buildProposal({ run: kidRun, producer: bot, key: PF.spreads.obligationId(sp.spread, pair.uid, 1), seen: [], at: AT, body: { op: 'add', text: 'Security sign-off', target: { phase: 'assess' }, placement: { beforeGate: 'assess-confirm' }, fulfills: ful } });
  const spr = T.cleanFile(JSON.parse(T.text(sp)), sp.id + '.json').record, se = T.effectOf(spr);
  const sap = T.buildStatus({ kind: 'application', proposal: sp.id, run: RUN, seen: [sp.id], by: 'person-avery', at: AT, authority: { decision: dec.name.replace(/\.json$/, '') }, previous: '', effect: se, writer: 'w1', rev: '0a1b2c3f' });
  const fr = T.cleanFile(JSON.parse(T.text(fil)), fil.id + '.json').record, fe = T.effectOf(fr);
  const fap = T.buildStatus({ kind: 'application', proposal: fil.id, run: kidRun, seen: [fil.id], by: 'person-avery', at: AT, authority: { grant: g.id }, previous: '', effect: fe, writer: 'w1', rev: '0a1b2c40' });
  return [[tool.id + '.json', tool], [asked.id + '.json', asked], [person.id + '.json', person], [mv.id + '.json', mv], [cid + '.json', comp], [g.id + '.json', g], [rv.id + '.json', rv], [dec.name, dec.file], [app.name, app.file],
    [sp.id + '.json', sp], [inc.id + '.json', inc], [bnd.id + '.json', bnd], [stp.id + '.json', stp], [fil.id + '.json', fil], [sap.name, sap.file], [fap.name, fap.file]];
}
/* Each record damaged one way at a time: every field dropped, retyped and nulled, an extra field, a newer or unmarked format,
   over-long text, a prototype key, another file name. */
const LINKS = ['https://abc.123', 'https://abc.0x1f', 'https://0x7f.1', 'https://0x7f.0.0.1', 'https://abc.0x', 'https://a..b', 'https://a.b.c.d.e',
  'https://1.2.3', 'https://08.1.1.1', 'https://abc.08', 'https://abc.0', 'https://abc.1a', 'https://a-.b', 'https://-a.b', 'https://abc.09x', 'https://0x.0x.0x.0x',
  'https://0x100000000', 'https://4294967295', 'https://abc.4294967296', 'https://a.0X1', 'https://1.2.3.4.5', 'https://1.2.3.4', 'https://example.com:0',
  'https://example.com:65536', 'https://example.com:443/a?b#c', 'http://0377.0.0.1', 'http://0x7f.0x0.0.01', 'http://1.0x100.1', 'http://00x1.a'];
/* International domain names (an xn-- label): whether the URL parser takes one rests on Unicode's IDNA tables, which the
   checker doesn't have, so it never judges one: it says the link is unchecked and leaves the verdict to Flightdeck (3.0.1). */
const IDN = ['https://xn--a.com', 'https://xn--abc.com', 'https://example.xn--a', 'https://xn--ls8h.la', 'https://XN--A.com', 'https://a.xn--.b'];
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
      /* Numbers JSON can say that a double can't hold exactly or at all: written as text, since JSON.stringify can't. */
      ['1e999', '-1e999', '1.5', '-1', '1e300', '9007199254740993', '0'].forEach((n) => put(name, JSON.stringify(set(o, at, 123456789)).replace('123456789', n), 'number ' + n + ' ' + l));
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
    /* Links as a browser's URL parser reads them: a host ending in a number is an IPv4 address or nothing. */
    if (o.op === 'move') LINKS.concat(IDN).forEach((v) => put(name, Object.assign({}, o, { to: { link: v } }), 'link ' + v));
    if (o.op === 'add' && o.kind === 'proposal') LINKS.concat(IDN).forEach((v) => put(name, Object.assign({}, o, { origin: { link: v } }), 'origin link ' + v));
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
  '    un = []',
  '    why = C.todo_why(o, c["name"], len(c["text"].encode("utf-8")), un) or ""',
  '    out.append([why, un])',
  'print(json.dumps(out))'].join('\n');

rule('The checker refuses exactly the to-do records the app refuses, over every kind of record and every damaged field', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const cs = corpus();
  assert.ok(cs.length > 400, 'a corpus of ' + cs.length);
  ['spread-add', 'spread-include', 'spread-bind', 'spread-stop'].forEach((op) => assert.ok(cs.some((c) => c.label === 'valid' && JSON.parse(c.text).op === op), 'the corpus has a ' + op));
  const pyOut = JSON.parse(cp.execFileSync(py, ['-I', '-B', '-c', DRIVER, DIR], { input: JSON.stringify(cs), encoding: 'utf8', maxBuffer: 256 * 1048576 }));
  const off = [];
  const idn = (c) => IDN.some((v) => c.label === 'link ' + v || c.label === 'origin link ' + v), un = [];
  cs.forEach((c, i) => {
    const j = jsRefuses(c), x = pyOut[i], p = Array.isArray(x) ? x[0] : x, notes = Array.isArray(x) ? x[1] : [];
    if (idn(c)) { if (notes.length !== 1) un.push(c.label + ' · unchecked: ' + JSON.stringify(notes)); return; }
    if (notes.length) un.push(c.label + ' · unchecked: ' + JSON.stringify(notes));
    if (!!j !== !!p || (j === 'not a to-do record') !== (p === 'not a to-do record')) off.push(c.name + ' · ' + c.label + ' · app: ' + (j || 'reads it') + ' · checker: ' + (p || 'reads it'));
  });
  assert.deepStrictEqual(off, [], off.length + ' disagreements');
  assert.deepStrictEqual(un, [], 'an international domain name, and only one, is left unchecked, never judged');
  assert.ok(cs.filter((c, i) => c.label === 'valid').every((c) => !jsRefuses(c)), 'every valid record reads');
  assert.ok(cs.filter((c) => c.label !== 'valid').some((c) => jsRefuses(c)), 'damage is refused');
});
/* Review round 3 (UE): the first reason a story's request is refused is the app's, in the app's order: its ids are compared
   as given (so ids recomputed from a malformed attempt match), and the malformed field is what is named. */
rule('UE: a story\'s request with a malformed attempt and ids recomputed from it is refused for its fields first, as the app refuses it, never for its id', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const v = valid(), [, fil] = v.find(([, f]) => f.fulfills && f.op === 'add');
  const cases = ['1', 0, 1000, 1.5].map((a) => {
    const o = JSON.parse(T.text(fil)), kid = o.run;
    o.fulfills.attempt = a;
    o.id = PF.spreads.childRequestId(o.fulfills.spread, o.fulfills.uid, a, kid);
    o.key = PF.spreads.obligationId(o.fulfills.spread, o.fulfills.uid, a);
    o.todo = T.todoIdFor(o.id);
    return { name: o.id + '.json', text: JSON.stringify(o), label: 'attempt ' + JSON.stringify(a) };
  });
  const pyOut = JSON.parse(cp.execFileSync(py, ['-I', '-B', '-c', DRIVER, DIR], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 16 * 1048576 }));
  cases.forEach((c, i) => {
    const j = jsRefuses(c), p = Array.isArray(pyOut[i]) ? pyOut[i][0] : pyOut[i];
    assert.ok(j && !/Its id isn't|Its key isn't/.test(j), c.label + ': set-up, the app refuses it for its fields: ' + j);
    assert.ok(p && !/Its id isn't|Its key isn't/.test(p) && /fulfills/.test(p), c.label + ': the checker names the same field first, never the id: ' + p);
  });
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
rule('In a folder, a to-do destination or origin on an international domain name is reported as unchecked and never judged', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-todo-idn-'));
  fs.mkdirSync(path.join(root, 'proposals'));
  const mv = valid().filter(([n, f]) => f.op === 'move')[0], o = JSON.parse(T.text(mv[1]));
  fs.writeFileSync(path.join(root, 'proposals', mv[0]), JSON.stringify(Object.assign({}, o, { to: { link: 'https://xn--a.com/x' } })));
  const res = JSON.parse(cp.execFileSync(py, ['-I', path.join(DIR, 'check_folder.py'), root], { encoding: 'utf8' }));
  assert.deepStrictEqual(res.refused, [], 'never refused for it');
  assert.deepStrictEqual(res.uncheckedLinks, [{ file: 'proposals/' + mv[0], linkUnchecked: '"to" "link": an international domain name; Flightdeck decides whether it reads' }]);
});
rule('Read through the folder reader (readPlans), a record that supplies _file or _bytes is refused by the app as by the checker', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const files = {}, names = [];
  valid().forEach(([name, f], i) => { const o = JSON.parse(T.text(f)); o[i % 2 ? '_bytes' : '_file'] = i % 2 ? 5 : name; files['proposals/' + name] = JSON.stringify(o); names.push(name); });
  const m = new PF.fs.MemoryFS('ay-' + Math.random(), null); Object.keys(files).forEach(p => { m.files[p] = { t: files[p], m: 1 }; });
  const d = await PF.repo.readPlans(m);
  const appRefused = JSON.parse(JSON.stringify(d.todosUnread.map(u => u.file).sort()));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-todo-ay-'));
  fs.mkdirSync(path.join(root, 'proposals'));
  Object.keys(files).forEach(p => fs.writeFileSync(path.join(root, p), files[p]));
  const res = JSON.parse(cp.execFileSync(py, ['-I', path.join(DIR, 'check_folder.py'), root], { encoding: 'utf8' }));
  assert.deepStrictEqual(appRefused, names.slice().sort(), 'the app refuses every one: ' + JSON.stringify([appRefused.length, names.length, d.todos.map(x => x._file)]));
  assert.deepStrictEqual(res.refused.map(x => x.file.replace(/^proposals\//, '')).sort(), appRefused, 'and the checker the same ones');
});
run();
