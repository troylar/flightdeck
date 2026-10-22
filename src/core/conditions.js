/* Conditions (2.1): "only when ^risk is high" on a phase or a step. Pure, ES5. A condition is read against the run's own
   details on every read, never stored as a verdict (docs/design.md section 30). Three values: true (it applies), false (Not
   needed) and null (unresolved: the detail is waiting for a person, or its stored value isn't valid), combined with
   three-valued AND. */
PF.conditions = (function () {
  'use strict';
  var V = PF.values;
  /* At most this many conditions on one phase or step. */
  var MAX = 4, OPTIONS_MIN = 2, OPTIONS_MAX = 20;
  var LINE = /^\^([\w-]{1,60})\s+is\s+(.+)$/;
  /* The tests each kind of run detail allows (text and links: presence only). */
  var ALLOWED = {
    set: { any: true }, notset: { any: true },
    is: { number: 1, 'yes-no': 1, date: 1, choice: 1 }, isnot: { number: 1, 'yes-no': 1, date: 1, choice: 1 },
    oneof: { choice: 1 },
    atleast: { number: 1, date: 1 }, atmost: { number: 1, date: 1 }
  };
  var WORDS = { set: 'is set', notset: 'is not set', is: 'is', isnot: 'is not', oneof: 'is one of', atleast: 'is at least', atmost: 'is at most' };
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  /* A run detail's value definition from a checklist's detailTypes ({ kind, options }), or text. */
  function defOf(detailTypes, name) {
    var d = own(detailTypes, name) ? detailTypes[name] : null;
    return d ? { kind: d.kind, label: name, options: d.options } : { kind: 'text', label: name };
  }
  function kindWord(def) { return V.label(def); }

  /* One "only when" line's text (after "only when"), against the checklist's run details: { test } or { why }. test:
     { name, op, values, text } with values canonical, and text the canonical spelling ("^risk is high"). */
  function parse(text, context, detailTypes) {
    var t = String(text == null ? '' : text).trim(), m = LINE.exec(t);
    if (!m) return { why: 'Write a condition as "only when ^detail is value" (or is set, is not set, is one of a|b, is at least, is at most).' };
    var name = m[1], rest = m[2].trim(), op, raw = [];
    if ((context || []).indexOf(name) < 0) return { why: 'Only when uses ^' + name + ', which isn\'t listed in context.' };
    var low = rest.toLowerCase(), mm;
    if (low === 'set') op = 'set';
    else if (low === 'not set') op = 'notset';
    else if ((mm = /^one of\s+(.+)$/i.exec(rest))) { op = 'oneof'; raw = mm[1].split('|').map(function (x) { return x.trim(); }); }
    else if ((mm = /^at least\s+(.+)$/i.exec(rest))) { op = 'atleast'; raw = [mm[1].trim()]; }
    else if ((mm = /^at most\s+(.+)$/i.exec(rest))) { op = 'atmost'; raw = [mm[1].trim()]; }
    else if ((mm = /^not\s+(.+)$/i.exec(rest))) { op = 'isnot'; raw = [mm[1].trim()]; }
    else { op = 'is'; raw = [rest]; }
    var def = defOf(detailTypes, name), kind = V.kindOf(def);
    if (!ALLOWED[op].any && !own(ALLOWED[op], kind)) return { why: '^' + name + ' is ' + (kind === 'text' ? 'text' : 'a ' + kindWord(def)) + ', so it can only be tested with ' + (kind === 'choice' ? 'is, is not, is one of, is set or is not set' : own(ALLOWED.atleast, kind) ? 'is, is not, is at least, is at most, is set or is not set' : own(ALLOWED.is, kind) ? 'is, is not, is set or is not set' : 'is set or is not set') + '.' };
    if (op === 'oneof' && (raw.length < OPTIONS_MIN || raw.length > OPTIONS_MAX)) return { why: 'Is one of needs ' + OPTIONS_MIN + ' to ' + OPTIONS_MAX + ' values, separated by |.' };
    var values = [];
    for (var i = 0; i < raw.length; i++) {
      if (!raw[i]) return { why: 'A value after "' + WORDS[op] + '" is empty.' };
      var p = V.parse(def, raw[i]);
      if (!p.ok || !p.canonical) return { why: '"' + raw[i].slice(0, 40) + '" isn\'t ' + (kind === 'choice' ? 'one of ^' + name + '\'s choices (' + (def.options || []).join(', ') + ')' : 'a ' + kindWord(def)) + '.' };
      if (values.indexOf(p.canonical) >= 0) return { why: '"' + p.canonical + '" is listed twice.' };
      values.push(p.canonical);
    }
    return { test: { name: name, op: op, values: values, text: '^' + name + ' ' + WORDS[op] + (values.length ? ' ' + values.join('|') : '') } };
  }

  /* One test against a stored value: true, false or null (unresolved). open: the detail has a migration waiting for a person. */
  function evaluate(test, stored, def, open) {
    if (open) return null;
    var v = typeof stored === 'string' ? stored : '', kind = V.kindOf(def);
    if (kind !== 'text' && v !== '' && !V.valid(def, v)) return null;
    if (test.op === 'set') return v !== '';
    if (test.op === 'notset') return v === '';
    if (v === '') return test.op === 'isnot';
    var same = function (x) { return kind === 'number' ? V.compare(v, x) === 0 : v === x; };
    var c = kind === 'number' ? V.compare(v, test.values[0]) : v < test.values[0] ? -1 : v > test.values[0] ? 1 : 0;
    if (test.op === 'is') return same(test.values[0]);
    if (test.op === 'isnot') return !same(test.values[0]);
    if (test.op === 'oneof') return test.values.some(same);
    if (test.op === 'atleast') return c >= 0;
    if (test.op === 'atmost') return c <= 0;
    return null;
  }
  /* Three-valued AND: false if any is false; else null if any is null; else true. */
  function combine(list) {
    var unknown = false;
    for (var i = 0; i < list.length; i++) { if (list[i] === false) return false; if (list[i] !== true) unknown = true; }
    return unknown ? null : true;
  }
  /* The run details a phase's and a step's conditions test. */
  function names(phase, step) {
    var out = [];
    ((phase && phase.when) || []).concat((step && step.when) || []).forEach(function (w) { if (out.indexOf(w.name) < 0) out.push(w.name); });
    return out;
  }
  /* Whether a checklist has any condition at all (a run of one without any reads exactly as before). */
  function any(map) { return (map.phases || []).some(function (p) { return !!p.when || p.steps.some(function (s) { return !!s.when; }); }); }
  /* A condition as people read it: "risk is high". */
  function words(test) { return test.text.slice(1); }

  return { MAX: MAX, WORDS: WORDS, parse: parse, evaluate: evaluate, combine: combine, names: names, any: any, words: words, defOf: defOf };
})();
