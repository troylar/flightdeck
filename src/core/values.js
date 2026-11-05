/* Typed values (2.0): numbers, yes/no, dates, choices and links, checked as people type them and stored as canonical text
   (docs/design.md section 38). Pure, ES5. A number is an exact decimal string, never a JavaScript number, so nothing is ever
   rounded; a date is a calendar date, never read through Date, so no time zone can move it. Stored values are never coerced:
   one that isn't exactly canonical is invalid, shown as written and flagged. */
PF.values = (function () {
  'use strict';
  /* The kinds a typed value can have. A link is "url" in step-type files and "link" in checklist syntax (decision D7). */
  var KINDS = { text: 1, number: 1, 'yes-no': 1, choice: 1, date: 1, url: 1, link: 1, pattern: 1 };
  /* What people see for each kind. */
  var LABELS = { text: 'text', number: 'number', 'yes-no': 'yes/no', choice: 'choice', date: 'date', url: 'link', link: 'link', pattern: 'pattern' };
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
  /* Canonical: every zero is 0, never -0. */
  function isNumber(s) { return typeof s === 'string' && s.length <= NUMBER_MAX && NUMBER.test(s) && s !== '-0'; }

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
    /* 2.16 (detail-patterns): the whole value must match, by Flightdeck's own linear matcher, never RegExp; counted in code
       points. A value that doesn't parse is refused with the pattern shown. */
    if (k === 'pattern') {
      var pc = compilePattern(def.pattern);
      if (!pc.ok) return no(cap(name(def)) + '\'s pattern can\'t be read (' + pc.why.replace(/\.$/, '') + ').');
      var bt = badText(t); if (bt) return no(cap(name(def)) + ' has ' + bt + '.');
      if (max && Array.from(t).length > max) return no(cap(name(def)) + ' can be at most ' + max + ' characters.');
      return matchPattern(pc, t).ok ? { ok: true, canonical: t } : no(cap(name(def)) + ' should match ' + String(def.pattern).slice(0, 80) + '.');
    }
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
    var what = { number: 'Not a number', 'yes-no': 'Not yes or no', date: 'Not a date', choice: 'Not one of the choices', url: 'Not a web link', pattern: 'Doesn\'t match its pattern' }[kindOf(def)] || 'Not valid';
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
    if (k === 'pattern') return parse(def, t, { max: DETAIL_MAX }).ok ? v('converted', t) : v('invalid');
    return v('invalid');
  }
  /* What a person is asked about an old value that didn't convert. */
  function ask(def, from) {
    var want = { number: 'Type the number it means.', 'yes-no': 'Choose what it means.', date: 'Pick the date it means.', choice: 'Pick the choice it means.', url: 'Type the link it means.', pattern: 'Type a value that matches ' + String(def && def.pattern || '').slice(0, 60) + '.' }[kindOf(def)] || 'Type what it means.';
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

  /* ---- 2.16: patterns (docs/map-format.md, Run details that must match a pattern) ----
     A pattern is a sequence of parts: a literal, \ before one of ESC, \d, or a class [a-z0-9_.-]; each may be followed by
     ? * + {n} {n,} {n,m} (n <= m <= 100). No groups, |, ., negated classes, backreferences or lookaround. ( ) and , are
     escaped everywhere inside pattern(...), classes included, so the first unescaped ) always ends it. A leading ^ and a
     trailing $ (after an even number of backslashes) are allowed and change nothing. Code points throughout. Matched by a
     simulation whose work is the value's length times the number of states, so it stays linear: never handed to RegExp. */
  var PAT_MAX = 200, ATOMS_MAX = 40, REP_MAX = 100, DETAIL_MAX = 120, ESC = '\\.-()[]{}+*?^$/|,:';
  var HINT = 'inside pattern(...), write ( ) and , as \\( \\) \\, everywhere, even inside [...].';
  var CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/, BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
  var LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;
  /* The forbidden characters, one set for both checkers (Python: bad_text). */
  function badText(v) { v = String(v); return CONTROL.test(v) ? 'a line break or control character' : BIDI.test(v) ? 'a direction character' : LONE.test(v) ? 'broken Unicode (a lone surrogate)' : ''; }
  function cpOf(c) { return c.codePointAt(0); }
  function stripAnchors(cps) {
    if (cps[0] === '^') cps = cps.slice(1);
    if (cps[cps.length - 1] === '$') { var n = 0, i = cps.length - 2; while (i >= 0 && cps[i] === '\\') { n++; i--; } if (n % 2 === 0) cps = cps.slice(0, -1); }
    return cps;
  }
  var memo = Object.create(null), memoN = 0;
  function compilePattern(src) {
    if (typeof src === 'string' && memo[src]) return memo[src];
    var r = compile(src);
    if (typeof src === 'string') { if (memoN > 500) { memo = Object.create(null); memoN = 0; } memo[src] = r; memoN++; }
    return r;
  }
  function compile(src) {
    if (typeof src !== 'string' || !src || Array.from(src).length > PAT_MAX) return { ok: false, why: 'a pattern is 1 to ' + PAT_MAX + ' characters.' };
    if (badText(src)) return { ok: false, why: 'the pattern has ' + badText(src) + '.' };
    var s = stripAnchors(Array.from(src)), atoms = [], i = 0;
    function endpoint(j) {
      var c = s[j]; if (c !== '\\') return { v: c, j: j + 1 };
      var n = s[j + 1]; if (n === 'd') return { v: '\\d', j: j + 2 };
      if (n !== undefined && ESC.indexOf(n) >= 0) return { v: n, j: j + 2 };
      return { why: '"\\' + (n || '') + '" isn\'t an escape the pattern knows (\\d, or \\ before one of ' + ESC + ').' };
    }
    while (i < s.length) {
      var set = null, c = s[i];
      if (c === '\\') { var e = endpoint(i); if (e.why) return { ok: false, why: e.why }; set = e.v === '\\d' ? { ranges: [[48, 57]], chars: [] } : { ranges: [], chars: [cpOf(e.v)] }; i = e.j; }
      else if (c === '[') {
        var j = i + 1, chars = [], ranges = [];
        if (s[j] === '^') return { ok: false, why: 'a negated class [^...] isn\'t supported; list what is allowed.' };
        while (j < s.length && s[j] !== ']') {
          if ('(),'.indexOf(s[j]) >= 0) return { ok: false, why: '"' + s[j] + '" inside [...] needs a \\ before it: ' + HINT };
          var a = endpoint(j); if (a.why) return { ok: false, why: a.why }; j = a.j;
          if (a.v === '\\d') { ranges.push([48, 57]); continue; }
          if (s[j] === '-' && j + 1 < s.length && s[j + 1] !== ']') {
            if ('(),'.indexOf(s[j + 1]) >= 0) return { ok: false, why: '"' + s[j + 1] + '" inside [...] needs a \\ before it: ' + HINT };
            var b = endpoint(j + 1); if (b.why || b.v === '\\d') return { ok: false, why: 'a range ends in \\d or a bad escape.' };
            if (cpOf(b.v) < cpOf(a.v)) return { ok: false, why: 'the range ' + a.v + '-' + b.v + ' is backwards.' };
            ranges.push([cpOf(a.v), cpOf(b.v)]); j = b.j;
          } else chars.push(cpOf(a.v));
        }
        if (j >= s.length) return { ok: false, why: 'a [ is never closed.' };
        set = { ranges: ranges, chars: chars }; i = j + 1;
      }
      else if ('()|'.indexOf(c) >= 0) return { ok: false, why: '"' + c + '" (groups and alternatives) isn\'t supported; write one sequence. For the character itself, ' + HINT };
      else if (c === ',') return { ok: false, why: '"," needs a \\ before it: ' + HINT };
      else if (c === '.') return { ok: false, why: '"." (any character) isn\'t supported; say which characters are allowed, like [a-z0-9].' };
      else if ('?*+{'.indexOf(c) >= 0) return { ok: false, why: '"' + c + '" has nothing before it to repeat.' };
      else if (']}^$'.indexOf(c) >= 0) return { ok: false, why: '"' + c + '" needs a \\ before it.' };
      else { set = { ranges: [], chars: [cpOf(c)] }; i++; }
      var min = 1, max = 1, q = s[i];
      if (q === '?') { min = 0; i++; } else if (q === '*') { min = 0; max = Infinity; i++; } else if (q === '+') { max = Infinity; i++; }
      else if (q === '{') {
        var m = /^\{(\d{1,3})(,(\d{0,3}))?\}/.exec(s.slice(i, i + 9).join(''));
        if (!m) return { ok: false, why: 'a repeat is {n}, {n,} or {n,m}.' };
        min = +m[1]; max = m[2] ? (m[3] === '' ? Infinity : +m[3]) : min;
        if (min > REP_MAX || (max !== Infinity && (max > REP_MAX || max < min))) return { ok: false, why: 'a repeat goes up to ' + REP_MAX + ', with n no more than m.' };
        i += m[0].length;
      }
      if (s[i] !== undefined && '?*+{'.indexOf(s[i]) >= 0) return { ok: false, why: 'two repeats in a row aren\'t supported.' };
      atoms.push({ set: set, min: min, max: max });
      if (atoms.length > ATOMS_MAX) return { ok: false, why: 'a pattern has at most ' + ATOMS_MAX + ' parts.' };
    }
    return { ok: true, atoms: atoms };
  }
  function inSet(set, cp) { if (set.chars.indexOf(cp) >= 0) return true; for (var i = 0; i < set.ranges.length; i++) if (cp >= set.ranges[i][0] && cp <= set.ranges[i][1]) return true; return false; }
  /* A state is (part, times used), capped at the part's minimum for an open-ended repeat. steps: states visited (for tests). */
  function matchPattern(p, value) {
    if (!p || !p.ok) return { ok: false, steps: 0 };
    if (badText(value)) return { ok: false, steps: 0, refused: 'has ' + badText(value) };
    var cps = Array.from(String(value)); if (cps.length > DETAIL_MAX) return { ok: false, steps: 0, refused: 'is over ' + DETAIL_MAX + ' characters' };
    var A = p.atoms, steps = 0;
    function close(list) {
      var seen = Object.create(null), out = [], st = list.slice();
      while (st.length) { var x = st.pop(), k = x[0] + ':' + x[1]; if (seen[k]) continue; seen[k] = 1; out.push(x); if (x[0] < A.length && x[1] >= A[x[0]].min) st.push([x[0] + 1, 0]); }
      return out;
    }
    var cur = close([[0, 0]]);
    for (var c = 0; c < cps.length; c++) {
      var cp = cpOf(cps[c]), next = [], had = Object.create(null);
      for (var i = 0; i < cur.length; i++) {
        steps++; var a = cur[i][0], n = cur[i][1]; if (a >= A.length) continue;
        var at = A[a]; if (n < at.max && inSet(at.set, cp)) { var m2 = at.max === Infinity ? Math.min(n + 1, at.min) : n + 1, k2 = a + ':' + m2; if (!had[k2]) { had[k2] = 1; next.push([a, m2]); } }
      }
      cur = close(next); if (!cur.length) return { ok: false, steps: steps };
    }
    return { ok: cur.some(function (x) { return x[0] === A.length; }), steps: steps };
  }
  /* ---- 2.16: one unit and one cut for every copy of a run detail, a sample or a gate approval (section A.5) ----
     unitOf decides the mode once: code points with detail-patterns, UTF-16 units otherwise (exactly today's). */
  function unitOf(features) { return Array.isArray(features) && features.indexOf('detail-patterns') >= 0 ? 'cp' : 'utf16'; }
  function len(v, unit) { if (unit !== 'cp' && unit !== 'utf16') throw new Error('PF.values.len needs a unit.'); v = String(v == null ? '' : v); return unit === 'cp' ? Array.from(v).length : v.length; }
  /* { value, cut, why }: at most max units, never splitting a pair in cp mode; utf16 is exactly slice(0, max). With def, the
     result is parsed too, and why says when it doesn't (a write refuses it; a read names it). */
  function cut(def, v, max, unit) {
    if (unit !== 'cp' && unit !== 'utf16') throw new Error('PF.values.cut needs a unit.');
    v = String(v == null ? '' : v);
    var out = unit === 'utf16' ? v.slice(0, max) : (Array.from(v).length > max ? Array.from(v).slice(0, max).join('') : v);
    var p = def ? parse(def, out, { max: max }) : null;
    return { value: out, cut: out !== v, why: p && !p.ok ? p.why : '' };
  }

  return { KINDS: KINDS, DETAIL_MAX: DETAIL_MAX, PAT_MAX: PAT_MAX, compilePattern: compilePattern, matchPattern: matchPattern, badText: badText, unitOf: unitOf, len: len, cut: cut, LABELS: LABELS, NEW: NEW, NUMBER_MAX: NUMBER_MAX, kindOf: kindOf, label: label, isNew: isNew, trim: trim, parse: parse, valid: valid, invalidWhy: invalidWhy,
    compare: compare, isNumber: isNumber, isDate: isDate, foldClash: foldClash, migrate: migrate, ask: ask, show: show, both: both, json: json, numberDefProblems: numberDefProblems };
})();
