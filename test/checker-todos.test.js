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
  /* Facts (4.0 slice 4): one per domain, complete, partial with an error, and a done on evidence with its application. */
  const FA = PF.facts, src = { feed: 'bitbucket', site: 'git.example.com', account: 'team-a' }, at1 = { run: RUN, producer: bot, seen: [], at: AT, loopStep: 'each', uid: 'jira:10101', attempt: 1, observedAt: AT, maxAgeSeconds: 86400 };
  const fct = FA.build(Object.assign({}, at1, { key: 'f-1', source: src, domain: 'prs', complete: true, reported: 2, fetched: 2, errors: [], entries: [{ id: '42', text: 'Fix the login', state: 'merged', link: 'https://git.example.com/pr/42' }, { id: '43', text: 'Docs', state: 'open' }] }));
  const fbk = FA.build(Object.assign({}, at1, { key: 'f-2', seen: [fct.id], source: { feed: 'jira' }, domain: 'blockers', complete: false, reported: null, fetched: 1, errors: ['The search timed out'], entries: [{ id: 'B-1', text: 'Waiting on QA', state: 'open' }] }));
  const fst = FA.build(Object.assign({}, at1, { key: 'f-3', source: { feed: 'jira' }, domain: 'status', complete: true, reported: 1, fetched: 1, errors: [], entries: [{ id: 'ABC-1', text: 'Done', category: 'done' }] }));
  const fcm = FA.build(Object.assign({}, at1, { key: 'f-4', source: src, domain: 'commits', maxAgeSeconds: 604800, complete: false, reported: 9, fetched: 1, errors: [], entries: [{ id: 'a1b2c3d', text: 'Fix the login' }] }));
  const sup = { fact: fct.id, content: '0123456789abcdef', incarnation: app.name.replace(/\.json$/, ''), source: { feed: 'bitbucket', site: 'git.example.com' }, domain: 'prs' };
  const sug = T.buildProposal({ run: RUN, producer: bot, seen: [], at: AT, body: { op: 'done', todo: T.todoIdFor(tool.id), support: sup } });
  const sge = T.effectOf(T.cleanFile(JSON.parse(T.text(sug)), sug.id + '.json').record);
  const sga = T.buildStatus({ kind: 'application', proposal: sug.id, run: RUN, seen: [sug.id], by: 'person-avery', at: AT, authority: { grant: g.id }, previous: app.name.replace(/\.json$/, ''), effect: sge, writer: 'w1', rev: '0a1b2c41' });
  /* Keeps (4.0 slice 5): placed after a step by a person, at a phase's end by a tool, and two that need placement. */
  const L = PF.learn, tpl = { process: 'validate-story', folder: 'v2-k3m9p2q8', version: 2, mapHash: '0123abcd', typesHash: '4567ef01' };
  const kpa = L.build({ run: RUN, by: 'person-blake', at: AT, source: { todo: T.todoIdFor(tool.id) }, template: tpl, anchor: { phase: 'assess', after: 'check' }, base: '89abcdef', change: { text: 'Check the links', where: 'after' }, reason: 'We missed it twice' });
  const kpe = L.build({ run: RUN, producer: bot, at: AT, source: { spread: sp.spread }, template: tpl, anchor: { phase: 'wrap' }, base: '89abcdef', change: { text: 'Security sign-off', where: 'end' } });
  const kna = L.build({ run: RUN, by: 'person-blake', at: AT, source: { todo: T.todoIdFor(cid) }, template: tpl, change: { text: 'Check the links', where: 'end' }, needs: 'The to-do says nothing about where in validate-story it goes.' });
  const knb = L.build({ run: RUN, producer: bot, at: AT, source: { todo: T.todoIdFor(tool.id) }, change: { text: 'Check the links', where: 'end' }, needs: 'The checklist its items run can\'t be read here.' });
  /* Checklist-linked to-dos (4.0 slice 5): an addition that pins a checklist, a tool's done on a run of it with its
     application, and a person's done on one in a single gesture. */
  const D = PF.detours, ck = { process: 'smoke-test', folder: 'v2-k3m9p2q8', version: 2, mapHash: '0123abcd', typesHash: '4567ef01', accepts: ['pass', 'pass with notes'] };
  const lnk = T.buildProposal({ run: RUN, producer: bot, key: 'k-3', seen: [], at: AT, body: Object.assign({ checklist: ck }, body) }), ltd = T.todoIdFor(lnk.id);
  const evd = { plan: D.planId(RUN, ltd, app.name.replace(/\.json$/, '')), run: { process: 'smoke-test', id: 'k1' }, answer: '2026-11-09T09:00:00.000Z 2026-11-09T09:10:00.000Z', result: 'pass' };
  const evt = T.buildProposal({ run: RUN, producer: bot, seen: [], at: AT, body: { op: 'done', todo: ltd, evidence: evd } });
  const eve = T.effectOf(T.cleanFile(JSON.parse(T.text(evt)), evt.id + '.json').record);
  const eva = T.buildStatus({ kind: 'application', proposal: evt.id, run: RUN, seen: [evt.id], by: 'person-avery', at: AT, authority: { decision: dec.name.replace(/\.json$/, '') }, previous: '', effect: eve, writer: 'w1', rev: '0a1b2c42' });
  const evp = Object.assign({}, evd, { result: '', run: { process: 'smoke-test', id: 'k2' } }), epb = { op: 'done', todo: T.todoIdFor(cid), evidence: evp, reason: 'Ran it' }, epe = T.effectOf(epb);
  const evc = T.buildProposal({ kind: 'compound', run: RUN, id: D.requestId(epb.todo, evp), by: 'person-avery', seen: [], at: AT, body: epb, decision: { by: 'person-avery', consequence: '0123456789abcdef' }, application: { previous: '', effect: epe, fingerprint: T.fingerprint(epe) } });
  return [[tool.id + '.json', tool], [asked.id + '.json', asked], [person.id + '.json', person], [mv.id + '.json', mv], [cid + '.json', comp], [g.id + '.json', g], [rv.id + '.json', rv], [dec.name, dec.file], [app.name, app.file],
    [sp.id + '.json', sp], [inc.id + '.json', inc], [bnd.id + '.json', bnd], [stp.id + '.json', stp], [fil.id + '.json', fil], [sap.name, sap.file], [fap.name, fap.file],
    [fct.id + '.json', fct], [fbk.id + '.json', fbk], [fst.id + '.json', fst], [fcm.id + '.json', fcm], [sug.id + '.json', sug], [sga.name, sga.file],
    [kpa.id + '.json', kpa], [kpe.id + '.json', kpe], [kna.id + '.json', kna], [knb.id + '.json', knb],
    [lnk.id + '.json', lnk], [evt.id + '.json', evt], [eva.name, eva.file], [evc.id + '.json', evc]];
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
    if (o.kind === 'fact' && o.domain === 'prs') LINKS.concat(IDN).forEach((v) => put(name, Object.assign({}, o, { entries: [Object.assign({}, o.entries[0], { link: v })].concat(o.entries.slice(1)) }), 'entry link ' + v));
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
  ['prs', 'commits', 'status', 'blockers'].forEach((d) => assert.ok(cs.some((c) => c.label === 'valid' && JSON.parse(c.text).domain === d), 'the corpus has a fact on ' + d));
  assert.ok(cs.some((c) => c.label === 'valid' && JSON.parse(c.text).support), 'the corpus has a done on evidence');
  assert.ok(cs.filter((c) => c.label === 'valid' && JSON.parse(c.text).kind === 'keep').length === 4, 'the corpus has four keeps');
  assert.ok(cs.some((c) => c.label === 'valid' && JSON.parse(c.text).checklist), 'the corpus has a checklist-linked addition');
  assert.strictEqual(cs.filter((c) => c.label === 'valid' && (JSON.parse(c.text).evidence || ((JSON.parse(c.text).effect || {}).evidence))).length, 3, 'the corpus has a tool\'s and a person\'s done on a run, and an application of one');
  const pyOut = JSON.parse(cp.execFileSync(py, ['-I', '-B', '-c', DRIVER, DIR], { input: JSON.stringify(cs), encoding: 'utf8', maxBuffer: 256 * 1048576 }));
  const off = [];
  const idn = (c) => IDN.some((v) => c.label === 'link ' + v || c.label === 'origin link ' + v || c.label === 'entry link ' + v), un = [];
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

rule('A done on evidence with more than one damaged field is refused by the checker for the same field first as the app', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const [name, sug] = valid().filter(([n, f]) => f.support && f.kind === 'proposal')[0], o = JSON.parse(T.text(sug));
  const edit = (fn) => { const c = JSON.parse(JSON.stringify(o)); fn(c); return c; };
  const cases = [
    ['fact broken, reason empty', (c) => { c.support.fact = 'broken'; c.reason = ''; }],
    ['fact broken, requester bad', (c) => { c.support.fact = 'broken'; c.requester = 'a b'; }],
    ['domain bad, reason long', (c) => { c.support.domain = 'nope'; c.reason = 'r'.repeat(301); }],
    ['support extra, requester bad', (c) => { c.support.extra = 1; c.requester = 'a b'; }],
    ['support text, reason empty', (c) => { c.support = 'x'; c.reason = ''; }],
    ['support source bad, reason control', (c) => { c.support.source = { feed: 'Bad Feed' }; c.reason = 'a\u0001b'; }],
    ['todo bad, support broken', (c) => { c.todo = 'x'; c.support.fact = 'broken'; }],
    ['reason empty alone', (c) => { c.reason = ''; }]
  ].map(([label, fn]) => ({ name, text: JSON.stringify(edit(fn)), label }));
  const pyOut = JSON.parse(cp.execFileSync(py, ['-I', '-B', '-c', DRIVER, DIR], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 64 * 1048576 }));
  const field = (w) => /support/.test(w) ? 'support' : /requester/.test(w) ? 'requester' : /reason/.test(w) ? 'reason' : /todo/.test(w) ? 'todo' : w.replace(/\.$/, '');
  const off = [];
  cases.forEach((c, i) => {
    const j = jsRefuses(c), x = pyOut[i], p = Array.isArray(x) ? x[0] : x;
    assert.ok(j && p, c.label + ': both refuse it (app: ' + j + ' · checker: ' + p + ')');
    if (field(j) !== field(p)) off.push(c.label + ' · app: ' + j + ' · checker: ' + p);
  });
  assert.deepStrictEqual(off, [], off.length + ' first reasons differ');
});

rule('A checklist-linked addition or a done on a run with more than one damaged field is refused by the checker for the same field first as the app', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const all = valid(), pick = (fn) => { const e = all.filter(([n, f]) => fn(f))[0]; return [e[0], JSON.parse(T.text(e[1]))]; };
  const [ln, lo] = pick((f) => f.checklist), [en, eo] = pick((f) => f.evidence && f.kind === 'proposal'), [cn, co] = pick((f) => f.evidence && f.kind === 'compound');
  const cases = [];
  const edit = (label, [name, o], fn) => { const c = JSON.parse(JSON.stringify(o)); fn(c); cases.push({ name, label, text: JSON.stringify(c) }); };
  edit('checklist folder, owner bad', [ln, lo], (c) => { c.checklist.folder = 'v0-x'; c.owner = 'a b'; });
  edit('checklist version, reason long', [ln, lo], (c) => { c.checklist.version = 3; c.reason = 'r'.repeat(301); });
  edit('checklist accepts too many, requester bad', [ln, lo], (c) => { c.checklist.accepts = Array.from({ length: 21 }, (_, i) => 'r' + i); c.requester = 'a b'; });
  edit('checklist accepts twice, owner bad', [ln, lo], (c) => { c.checklist.accepts = ['pass', 'pass']; c.owner = 'a b'; });
  edit('checklist accepts padded', [ln, lo], (c) => { c.checklist.accepts = [' pass']; });
  edit('checklist hash, text empty', [ln, lo], (c) => { c.checklist.mapHash = 'XYZ'; c.text = ''; });
  edit('checklist on a done', [en, eo], (c) => { c.checklist = lo.checklist; });
  edit('evidence on an add', [ln, lo], (c) => { c.evidence = eo.evidence; });
  edit('evidence plan, reason empty', [en, eo], (c) => { c.evidence.plan = 'plan-x'; c.reason = ''; });
  edit('evidence run extra, requester bad', [en, eo], (c) => { c.evidence.run.step = 'x'; c.requester = 'a b'; });
  edit('evidence answer control', [en, eo], (c) => { c.evidence.answer = 'a\u2028b'; });
  edit('evidence result long', [en, eo], (c) => { c.evidence.result = 'r'.repeat(61); });
  edit('evidence and support', [en, eo], (c) => { c.support = { fact: 'x' }; });
  edit('evidence moved under its id', [en, eo], (c) => { c.evidence.result = 'fail'; });
  edit('evidence key moved', [en, eo], (c) => { c.key = 'ev-' + '0'.repeat(24); });
  edit('compound evidence, effect differs', [cn, co], (c) => { c.application.effect.evidence = Object.assign({}, c.application.effect.evidence, { result: 'x' }); });
  edit('compound evidence answer long', [cn, co], (c) => { c.evidence.answer = 'a'.repeat(81); });
  const pyOut = JSON.parse(cp.execFileSync(py, ['-I', '-B', '-c', DRIVER, DIR], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 64 * 1048576 }));
  const field = (w) => /checklist/.test(w) ? 'checklist' : /support/.test(w) ? 'support' : /evidence/.test(w) ? 'evidence' : /fingerprint/.test(w) ? 'fingerprint' : /effect/.test(w) ? 'effect' : /requester/.test(w) ? 'requester' : /owner/.test(w) ? 'owner' : /reason/.test(w) ? 'reason' : /text/.test(w) ? 'text' : /key/.test(w) ? 'key' : w.replace(/\.$/, '');
  const off = [];
  cases.forEach((c, i) => {
    const j = jsRefuses(c), x = pyOut[i], p = Array.isArray(x) ? x[0] : x;
    assert.ok(j && p, c.label + ': both refuse it (app: ' + j + ' · checker: ' + p + ')');
    if (field(j) !== field(p)) off.push(c.label + ' · app: ' + j + ' · checker: ' + p);
  });
  assert.deepStrictEqual(off, [], off.length + ' first reasons differ');
});

rule('A keep with more than one damaged field is refused by the checker for the same field first as the app', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const all = valid().filter(([n, f]) => f.kind === 'keep');
  const cases = [];
  all.forEach(([name, f]) => {
    const o = JSON.parse(T.text(f));
    const edit = (label, fn) => { const c = JSON.parse(JSON.stringify(o)); fn(c); cases.push({ name, label: label + ' (' + name + ')', text: JSON.stringify(c) }); };
    edit('run bad, at bad', (c) => { c.run = 'x'; c.at = 'now'; });
    edit('source bad, change bad', (c) => { c.source = { todo: 'x' }; c.change = 'x'; });
    edit('template version, anchor bad', (c) => { c.template = Object.assign({}, c.template || {}, { version: 9 }); c.anchor = { phase: 'a b' }; });
    edit('change where, needs extra', (c) => { c.change.where = 'after'; c.needs = 'x'; });
    edit('text roles, reason long', (c) => { c.change.text = 'Ask @qa'; c.reason = 'r'.repeat(301); });
    edit('text control, base bad', (c) => { c.change.text = 'a\u2028b'; c.base = 'zz'; });
    edit('text long', (c) => { c.change.text = 'w '.repeat(1001); });
    edit('by and producer', (c) => { c.by = 'person-blake'; c.producer = { name: 'notes-bot', version: '1.2' }; });
    edit('key on a person', (c) => { if (c.by) c.key = 'kp-x'; else c.key = 'kp-0'; });
    edit('id moved', (c) => { c.source = { todo: T.todoIdFor(T.idFor('flightdeck', 'other')) }; });
    edit('folder version mismatch', (c) => { c.template = { process: 'validate-story', folder: 'v3-k3m9p2q8', version: 2, mapHash: '0123abcd', typesHash: '4567ef01' }; });
  });
  const pyOut = JSON.parse(cp.execFileSync(py, ['-I', '-B', '-c', DRIVER, DIR], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 64 * 1048576 }));
  const off = [];
  cases.forEach((c, i) => {
    const j = jsRefuses(c), x = pyOut[i], p = Array.isArray(x) ? x[0] : x;
    if (j !== p) off.push(c.label + ' · app: ' + (j || 'reads it') + ' · checker: ' + (p || 'reads it'));
  });
  assert.deepStrictEqual(off, [], off.length + ' first reasons differ');
});
rule('An unknown field is named first in the app\'s key order, numeric-like keys first, in every 4.0 record and part of one', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const all = valid(), pick = (fn) => { const e = all.filter(([n, f]) => fn(f))[0]; return [e[0], JSON.parse(T.text(e[1]))]; };
  /* "2" written before "1": JSON.stringify would put them in index order, so a marker key is swapped for them in the text. */
  const two = (o) => Object.assign({ zzMARK: true }, o);
  const cases = [];
  const add = (label, [name, o], fn) => { const c = JSON.parse(JSON.stringify(o)); fn(c); cases.push({ name, label, text: JSON.stringify(c).replace('"zzMARK":true', '"2":true,"1":true') }); };
  const fact = pick((f) => f.kind === 'fact' && f.domain === 'prs'), sug = pick((f) => f.support && f.kind === 'proposal'), prop = pick((f) => f.kind === 'proposal' && f.op === 'add' && !f.fulfills);
  const grant = pick((f) => f.kind === 'grant'), spread = pick((f) => f.op === 'spread-add');
  const top = (c) => { const o = two(c); Object.keys(c).forEach((k) => delete c[k]); Object.assign(c, o); };
  add('fact', fact, top);
  add('fact source', fact, (c) => { c.source = two(c.source); });
  add('fact entry', fact, (c) => { c.entries[0] = two(c.entries[0]); });
  add('support', sug, (c) => { c.support = two(c.support); });
  add('support source', sug, (c) => { c.support.source = two(c.support.source); });
  add('proposal', prop, top);
  add('proposal placement', prop, (c) => { c.placement = two(c.placement); });
  add('grant', grant, top);
  add('spread scope', spread, (c) => { c.scope = two(c.scope); });
  const keep = pick((f) => f.kind === 'keep' && f.anchor && f.by);
  add('keep', keep, top);
  add('keep template', keep, (c) => { c.template = two(c.template); });
  add('keep anchor', keep, (c) => { c.anchor = two(c.anchor); });
  add('keep change', keep, (c) => { c.change = two(c.change); });
  const lnk = pick((f) => f.checklist), evd = pick((f) => f.evidence && f.kind === 'proposal');
  add('checklist', lnk, (c) => { c.checklist = two(c.checklist); });
  add('evidence', evd, (c) => { c.evidence = two(c.evidence); });
  const pyOut = JSON.parse(cp.execFileSync(py, ['-I', '-B', '-c', DRIVER, DIR], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 64 * 1048576 }));
  const key = (w) => { const m = /has "?([^".\s]+)"?/.exec(w || ''); return m ? m[1] : 'no field named: ' + w; };
  const off = [];
  cases.forEach((c, i) => {
    const j = jsRefuses(c), x = pyOut[i], p = Array.isArray(x) ? x[0] : x;
    assert.ok(j && p, c.label + ': both refuse it (app: ' + j + ' · checker: ' + p + ')');
    if (key(j) !== '1') off.push(c.label + ' · app: ' + j);
    if (key(j) !== key(p)) off.push(c.label + ' · app: ' + j + ' · checker: ' + p);
  });
  assert.deepStrictEqual(off, [], off.length + ' first unknown fields differ');
});

rule('A record nested past the bound is refused by the checker as by the app, by name and why, and never crashes it', () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-todo-deep-')), [[name, f]] = valid();
  fs.mkdirSync(path.join(root, 'proposals'));
  fs.writeFileSync(path.join(root, 'proposals', name), T.text(f));
  const deep = 'req-notes-bot-' + 'e'.repeat(24) + '.json', shallow = 'req-notes-bot-' + 'd'.repeat(24) + '.json';
  fs.writeFileSync(path.join(root, 'proposals', deep), '{"format":"flightdeck-plan/4","x":' + '['.repeat(12000) + ']'.repeat(12000) + '}');
  fs.writeFileSync(path.join(root, 'proposals', shallow), '{"format":"flightdeck-plan/4","x":' + '['.repeat(65) + ']'.repeat(65) + '}');
  const res = JSON.parse(cp.execFileSync(py, ['-I', path.join(DIR, 'check_folder.py'), root], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  for (const n of [deep, shallow]) {
    const r = res.refused.find((x) => x.file === 'proposals/' + n);
    assert.ok(r && r.why.indexOf(PF.util.DEEP_WHY) >= 0, n + ': ' + JSON.stringify(res.refused).slice(0, 600));
  }
  assert.ok(PF.util.jsonTooDeep('['.repeat(65) + ']'.repeat(65)) && !PF.util.jsonTooDeep('['.repeat(64) + ']'.repeat(64)) && !PF.util.jsonTooDeep('"' + '['.repeat(100) + '"'), 'the app\'s bound: 64, strings skipped');
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
/* JC (4.0 slice 4): a fact in a later format with its features gone is still a fact by its kind: the app's to-do reader and the
   checker refuse it alike, as a newer fact record, never as a plan. */
rule('JC, PB: a fact in a later format, with its features gone or in a loop\'s envelope, is refused by the app and the checker as a fact, the same way, never as a plan or a scope record', async () => {
  const py = python();
  if (!py) { console.log('  (skipped: no Python on this computer)'); return; }
  const [name, f] = valid().filter(([n, x]) => x.kind === 'fact')[0], o = JSON.parse(T.text(f));
  for (const env of [{ format: 'flightdeck-plan/5' }, { format: 'flightdeck-plan/3', features: ['loops'] }, { format: 'flightdeck-plan/4', features: ['loops'] }, { format: 'flightdeck-plan/5', features: ['loops'] }]) {
  /* PB: a loop's envelope too: the kind comes before any loop or scope dispatch, in the app and the checker. */
  delete o.features; Object.assign(o, env); if (env.format !== 'flightdeck-plan/4') o.app = '9.0.0'; else o.app = '4.0.0';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-todo-jc-'));
  fs.mkdirSync(path.join(root, 'proposals')); fs.writeFileSync(path.join(root, 'proposals', name), JSON.stringify(o, null, 2));
  const files = { ['proposals/' + name]: JSON.stringify(o, null, 2) };
  const mem = { list: (p) => Promise.resolve(p === 'proposals' ? [{ name, kind: 'file' }] : []), read: (p) => Promise.resolve(files[p] ? { text: files[p], mtime: 1 } : null), stat: (p) => Promise.resolve(files[p] ? { size: files[p].length, mtime: 1 } : null) };
  const bad = [], got = await PF.repo.readPlans(mem, bad, null, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(got.todosUnread.map((u) => [u.file, u.kind, u.run && u.run.process + '/' + u.run.id]))), [[name, env.format === 'flightdeck-plan/5' ? 'newer' : 'malformed', RUN.process + '/' + RUN.id]], JSON.stringify(env) + ': the app holds its run: ' + JSON.stringify(got.todosUnread) + ' ' + JSON.stringify(bad));
  assert.ok(bad.length === 1 && !/\bplan\b/.test(bad[0].why), 'never named as a plan: ' + JSON.stringify(bad));
  const res = JSON.parse(cp.execFileSync(py, ['-I', path.join(DIR, 'check_folder.py'), root], { encoding: 'utf8' }));
  const mine = res.refused.filter((x) => x.file === 'proposals/' + name);
  assert.strictEqual(mine.length, 1, JSON.stringify(res.refused));
  assert.ok(!/\bplan\b/.test(mine[0].why) && mine[0].why === bad[0].why, 'the checker says what the app says: ' + mine[0].why + ' / ' + bad[0].why);
  assert.ok(!got.scopesUnread.length && !(res.scopes || []).length, JSON.stringify(env) + ': never a scope record');
  }
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
