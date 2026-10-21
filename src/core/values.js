/* Typed values (2.0): numbers, yes/no, dates, choices and links, checked as people type them and stored as canonical text
   (docs/design.md section 5). Pure, ES5. A number is an exact decimal string, never a JavaScript number, so nothing is ever
   rounded; a date is a calendar date, never read through Date, so no time zone can move it. Stored values are never coerced:
   one that isn't exactly canonical is invalid, shown as written and flagged. */
PF.values = (function () {
  'use strict';
  /* The kinds a typed value can have. A link is "url" in step-type files and "link" in checklist syntax (decision D7). */
  var KINDS = { text: 1, number: 1, 'yes-no': 1, choice: 1, date: 1, url: 1, link: 1 };
  /* What people see for each kind. */
  var LABELS = { text: 'text', number: 'number', 'yes-no': 'yes/no', choice: 'choice', date: 'date', url: 'link', link: 'link' };
  /* The kinds only 2.0 knows (a definition using one is typed-evidence or typed-details). */
  var NEW = { number: 1, 'yes-no': 1, date: 1 };
  var NUMBER = /^-?(0|[1-9]\d*)(\.\d*[1-9])?$/, NUMBER_MAX = 30;
  /* Unicode White_Space, trimmed at both ends only. */
  var WS = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
  var TRIM = new RegExp('^[' + WS + ']+|[' + WS + ']+$', 'g'), INNER_WS = new RegExp('[' + WS + ']');
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function kindOf(def) { var k = def && typeof def.kind === 'string' && Object.prototype.hasOwnProperty.call(KINDS, def.kind) ? def.kind : 'text'; return k === 'link' ? 'url' : k; }
  function label(def) { return LABELS[kindOf(def)]; }
  function isNew(kind) { return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(NEW, kind); }
  function trim(s) { return (typeof s === 'string' ? s : typeof s === 'number' || typeof s === 'boolean' ? String(s) : '').replace(TRIM, ''); }
  function name(def) { return def && typeof def.label === 'string' && def.label ? def.label : 'This value'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---- numbers: exact decimals ---- */
  /* A number as people may type it (a sign, leading zeros, trailing zeros after the point) in canonical form, or null. */
  function toNumber(t) {
    var m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(t);
    if (!m) return null;
    var int = m[2].replace(/^0+(?=\d)/, ''), frac = (m[3] || '').replace(/0+$/, '');
    var out = int + (frac ? '.' + frac : '');
    if (out === '0') return '0';
    return (m[1] === '-' ? '-' : '') + out;
  }
  /* Compares two canonical decimals exactly: sign, length of the whole part, its digits, then the fraction. */
  function compare(a, b) {
    var na = a.charAt(0) === '-', nb = b.charAt(0) === '-';
    if (na !== nb) return na ? -1 : 1;
    var c = cmpAbs(na ? a.slice(1) : a, nb ? b.slice(1) : b);
    return na ? -c : c;
  }
  function cmpAbs(a, b) {
    var pa = a.split('.'), pb = b.split('.');
    if (pa[0].length !== pb[0].length) return pa[0].length < pb[0].length ? -1 : 1;
    if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1;
    var fa = pa[1] || '', fb = pb[1] || '', n = Math.max(fa.length, fb.length);
    while (fa.length < n) fa += '0';
    while (fb.length < n) fb += '0';
    return fa === fb ? 0 : fa < fb ? -1 : 1;
  }
  function isNumber(s) { return typeof s === 'string' && s.length <= NUMBER_MAX && NUMBER.test(s); }

  /* ---- dates: calendar dates ---- */
  function leap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function isDate(s) {
    var m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3], days = [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1];
  }

  /* ---- choices ---- */
  function optionsOf(def) { return def && Array.isArray(def.options) ? def.options.filter(function (o) { return typeof o === 'string'; }) : []; }
  function matches(def, t) { var want = t.toLowerCase(); return optionsOf(def).filter(function (o) { return o.toLowerCase() === want; }); }
  /* Two options of a new choice that differ only in capitals ("dev" and "DEV"), or null. */
  function foldClash(options) {
    var seen = Object.create(null);
    for (var i = 0; i < (options || []).length; i++) {
      var k = String(options[i]).toLowerCase();
      if (seen[k] != null) return [seen[k], String(options[i])];
      seen[k] = String(options[i]);
    }
    return null;
  }

  function linkOk(t) { return /^https?:\/\/\S+$/i.test(t) && !!PF.util.safeUrl(t); }

  /* A value as a person typed it, for a definition { kind, label, options, min, max }: { ok, canonical, why }. Empty is ok
     (canonical ''); whether a value is required is the caller's rule. max: the most characters the record keeps. */
  function parse(def, raw, opts) {
    var t = trim(raw), k = kindOf(def), max = opts && opts.max;
    function no(why) { return { ok: false, canonical: '', why: why }; }
    if (!t) return { ok: true, canonical: '' };
    var out = t;
    if (k === 'number') {
      out = INNER_WS.test(t) ? null : toNumber(t);
      if (out == null) return no('Type a number, like 12 or 3.5.');
      if (out.length > NUMBER_MAX) return no(cap(name(def)) + ' can be at most ' + NUMBER_MAX + ' characters.');
      if (def.min != null && isNumber(def.min) && compare(out, def.min) < 0) return no(cap(name(def)) + ' can\'t be less than ' + def.min + '.');
      if (def.max != null && isNumber(def.max) && compare(out, def.max) > 0) return no(cap(name(def)) + ' can\'t be more than ' + def.max + '.');
    } else if (k === 'yes-no') {
      var yn = t.toLowerCase();
      if (yn !== 'yes' && yn !== 'no') return no('Choose Yes or No.');
      out = yn;
    } else if (k === 'date') {
      if (!isDate(t)) return no('Pick a date.');
    } else if (k === 'choice') {
      var hit = matches(def, t);
      if (hit.length !== 1) return no((hit.length ? cap(name(def)) + ' matches more than one choice. ' : '') + 'Pick one of: ' + optionsOf(def).join(', ') + '.');
      out = hit[0];
    } else if (k === 'url') {
      if (!linkOk(t)) return no('Type a web link that starts with https://.');
    }
    if (max && out.length > max) return no(cap(name(def)) + ' can be at most ' + max + ' characters.');
    return { ok: true, canonical: out };
  }
  /* Whether a stored value is exactly canonical for its definition. Empty is valid (not answered). */
  function valid(def, stored) {
    if (typeof stored !== 'string') return false;
    if (stored === '') return true;
    var p = parse(def, stored);
    return p.ok && p.canonical === stored;
  }
  /* Why a stored value isn't valid, in words for the screen ("Not a number: "12a". Fill in to correct it."). */
  function invalidWhy(def, stored) {
    var what = { number: 'Not a number', 'yes-no': 'Not yes or no', date: 'Not a date', choice: 'Not one of the choices', url: 'Not a web link' }[kindOf(def)] || 'Not valid';
    return what + ': "' + String(stored).slice(0, 60) + '". Fill in to correct it.';
  }

  /* An untyped text meeting a typed definition (a plan's details, a parent's carried text): exact (already canonical),
     converted (an unambiguous spelling), ambiguous (could mean more than one thing) or invalid (can't be one). Never guessed. */
  function migrate(def, oldText) {
    var t = trim(oldText), k = kindOf(def);
    function v(verdict, result) { return { verdict: verdict, result: result == null ? null : result }; }
    if (typeof oldText === 'string' && oldText === '') return v('exact', '');
    if (k === 'text') return v(t === oldText ? 'exact' : 'converted', t);
    if (valid(def, oldText)) return v('exact', oldText);
    if (k === 'number') {
      var n = INNER_WS.test(t) ? null : toNumber(t);
      if (n != null && n.length <= NUMBER_MAX && parse(def, n).ok) return v('converted', n);
      return /\d/.test(t) ? v('ambiguous') : v('invalid');
    }
    if (k === 'yes-no') {
      var w = t.toLowerCase();
      if (w === 'yes' || w === 'y' || w === 'true') return v('converted', 'yes');
      if (w === 'no' || w === 'n' || w === 'false') return v('converted', 'no');
      return v('invalid');
    }
    if (k === 'date') return isDate(t) ? v('converted', t) : v('ambiguous');
    if (k === 'choice') {
      var hit = matches(def, t);
      return hit.length === 1 ? v('converted', hit[0]) : hit.length ? v('ambiguous') : v('invalid');
    }
    if (k === 'url') return linkOk(t) ? v('converted', t) : v('invalid');
    return v('invalid');
  }
  /* What a person is asked about an old value that didn't convert. */
  function ask(def, from) {
    var want = { number: 'Type the number it means.', 'yes-no': 'Choose what it means.', date: 'Pick the date it means.', choice: 'Pick the choice it means.', url: 'Type the link it means.' }[kindOf(def)] || 'Type what it means.';
    return 'Before: "' + String(from).slice(0, 80) + '" (text). ' + want;
  }

  /* ---- display ---- */
  function group(int) { return int.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  /* A canonical value as people read it: numbers grouped (en-US), Yes/No, a calendar date; anything else as it is. Never
     rounds: a number with more than 15 significant digits is grouped by hand. */
  function show(def, v) {
    if (typeof v !== 'string' || !v || !valid(def, v)) return typeof v === 'string' ? v : '';
    var k = kindOf(def);
    if (k === 'number') {
      var neg = v.charAt(0) === '-', parts = (neg ? v.slice(1) : v).split('.');
      return (neg ? '-' : '') + group(parts[0]) + (parts[1] ? '.' + parts[1] : '');
    }
    if (k === 'yes-no') return v === 'yes' ? 'Yes' : 'No';
    if (k === 'date') return MONTHS[+v.slice(5, 7) - 1] + ' ' + (+v.slice(8, 10)) + ', ' + (+v.slice(0, 4));
    return v;
  }
  /* For a receipt or a pack: the shown value, with the stored text in brackets where they differ ("1,234.5 (1234.5)"). */
  function both(def, v) { var s = show(def, v); return s && s !== v ? s + ' (' + v + ')' : s; }
  /* A value for other apps (READ/2): a string for numbers (exact), a boolean for yes/no, the text for the rest; null when empty
     or not valid. */
  function json(def, v) {
    if (typeof v !== 'string' || !v || !valid(def, v)) return null;
    var k = kindOf(def);
    return k === 'yes-no' ? v === 'yes' : v;
  }

  /* ---- definitions ---- */
  /* Problems with a number definition's min, max and unit: a list of messages. */
  function numberDefProblems(d, where) {
    var out = [];
    ['min', 'max'].forEach(function (k) { if (d[k] != null && !isNumber(d[k])) out.push(where + ': "' + k + '" must be a number written as text, like "0" or "12.5"'); });
    if (isNumber(d.min) && isNumber(d.max) && compare(d.min, d.max) > 0) out.push(where + ': "min" is more than "max"');
    if (d.unit != null && (typeof d.unit !== 'string' || !trim(d.unit) || d.unit.length > 20)) out.push(where + ': "unit" must be 1-20 characters');
    return out;
  }

  return { KINDS: KINDS, LABELS: LABELS, NEW: NEW, NUMBER_MAX: NUMBER_MAX, kindOf: kindOf, label: label, isNew: isNew, trim: trim, parse: parse, valid: valid, invalidWhy: invalidWhy,
    compare: compare, isNumber: isNumber, isDate: isDate, foldClash: foldClash, migrate: migrate, ask: ask, show: show, both: both, json: json, numberDefProblems: numberDefProblems };
})();
