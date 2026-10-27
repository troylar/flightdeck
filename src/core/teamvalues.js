/* Team values (2.9): shared settings of the team folder, like a Bitbucket base URL, kept in team-values.json and edited in
   Settings by the folder owner and backup. A linked step passes one to its child with pass: name=team:<value name>; it's
   read when the child starts (docs/design.md 41). Pure, ES5.
     { "format": "flightdeck-team-values/1", "values": { "<name>": { "value": "…", "about": "…" } } }
   One reader (parse) gives every caller the same state: missing (no file, so no team values), unreadable (a read that
   failed, never taken as missing; repo.readTeamValues gives it), malformed, newer, or ok. */
PF.teamValues = (function () {
  'use strict';
  var FILE = 'team-values.json', FAMILY = 'flightdeck-team-values', FORMAT = FAMILY + '/1';
  var NAME = /^[a-z0-9][a-z0-9-]{0,39}$/, MAX = 100, VALUE_MAX = 120, ABOUT_MAX = 80, MAX_BYTES = 262144;
  var TOP = ['format', 'features', 'app', 'values'], ENTRY = ['value', 'about'];

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function reserved(n) { return n === '__proto__' || n in Object.prototype; }

  /* What's wrong with one value's text, or ''. */
  function valueProblem(v, what) {
    what = what || 'The value';
    if (typeof v !== 'string') return what + ' isn\'t text.';
    if (!v) return what + ' is empty.';
    if (/[\u0000-\u001f\u007f]/.test(v)) return what + ' has a control character.';
    if (v !== v.trim()) return what + ' has spaces at the start or end.';
    if (v.length > VALUE_MAX) return what + ' can be at most ' + VALUE_MAX + ' characters.';
    return '';
  }
  /* What's wrong with a document's values ({ values }), or '': the rules parse applies, for Settings before it saves. */
  function check(doc) {
    var values = doc && doc.values;
    if (!obj(values)) return 'Its "values" isn\'t a list of named values.';
    var names = Object.keys(values);
    if (names.length > MAX) return 'It can hold at most ' + MAX + ' team values.';
    for (var i = 0; i < names.length; i++) {
      var n = names[i], e = values[n];
      if (reserved(n)) return '"' + n + '" is a name Flightdeck keeps for itself.';
      if (!NAME.test(n)) return '"' + n + '" isn\'t a team value name (lowercase letters, digits and -, at most 40).';
      if (!obj(e)) return '"' + n + '" isn\'t a value with its text.';
      var extra = Object.keys(e).filter(function (k) { return ENTRY.indexOf(k) < 0; });
      if (extra.length) return '"' + n + '" has "' + extra[0] + '", which this copy doesn\'t know.';
      var p = valueProblem(e.value, '"' + n + '"');
      if (p) return p;
      if (e.about != null && (typeof e.about !== 'string' || /[\u0000-\u001f\u007f]/.test(e.about))) return 'What "' + n + '" is for isn\'t plain text.';
      if (e.about != null && e.about.length > ABOUT_MAX) return 'What "' + n + '" is for can be at most ' + ABOUT_MAX + ' characters.';
    }
    return '';
  }

  /* The file's text (null: there's no file) as { state, doc, why, readOnly }. readOnly: why Settings can't change it (a key
     this copy doesn't know) though its values can be used. */
  function parse(text) {
    if (text == null) return { state: 'missing', doc: { values: {} }, why: '' };
    var o;
    try { o = JSON.parse(String(text)); } catch (e) { return { state: 'malformed', doc: null, why: FILE + ' isn\'t valid JSON.' }; }
    var j = PF.envelope.judge(FAMILY, o);
    if (!j.ok) return j.kind === 'newer' ? { state: 'newer', doc: null, why: FILE + ' ' + j.why.replace(/\.?$/, '.'), needs: j.needs || '' } : { state: 'malformed', doc: null, why: FILE + ' ' + j.why.replace(/\.?$/, '.') };
    var why = check(o);
    if (why) return { state: 'malformed', doc: null, why: FILE + ': ' + why };
    var values = Object.create(null);
    Object.keys(o.values).forEach(function (n) { var e = o.values[n]; values[n] = e.about != null ? { value: e.value, about: e.about } : { value: e.value }; });
    var extra = Object.keys(o).filter(function (k) { return TOP.indexOf(k) < 0; });
    var out = { state: 'ok', doc: { values: values }, why: '' };
    if (extra.length) out.readOnly = FILE + ' has "' + extra[0] + '", which this copy doesn\'t know, so it can\'t be changed here.';
    return out;
  }

  /* One name in what parse (or repo.readTeamValues) gave: { value } | { missing } | { unreadable, why } | { malformed, why } |
     { newer, why }. Every caller (checks, the builder, the start form, the start itself) asks this. */
  function lookup(data, name) {
    var st = data && data.state;
    if (st === 'unreadable') return { unreadable: true, why: String(data.why || FILE + ' couldn\'t be read.') };
    if (st === 'malformed') return { malformed: true, why: String(data.why || '') };
    if (st === 'newer') return { newer: true, why: String(data.why || '') };
    var v = st === 'ok' && data.doc && data.doc.values;
    if (!v || !own(v, name) || reserved(name)) return { missing: true };
    return { value: v[name].value };
  }

  /* The file's text for { values }, in a stable shape: names in order, each value then what it's for. */
  function text(doc) {
    var values = {}, src = (doc && doc.values) || {};
    Object.keys(src).sort().forEach(function (n) { var e = src[n]; values[n] = e.about ? { value: e.value, about: e.about } : { value: e.value }; });
    return JSON.stringify({ format: FORMAT, values: values }, null, 2) + '\n';
  }

  return { FILE: FILE, FAMILY: FAMILY, FORMAT: FORMAT, NAME: NAME, MAX: MAX, VALUE_MAX: VALUE_MAX, ABOUT_MAX: ABOUT_MAX, MAX_BYTES: MAX_BYTES,
    parse: parse, check: check, lookup: lookup, text: text, valueProblem: valueProblem };
})();
