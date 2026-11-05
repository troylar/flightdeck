/* The team's Jira workflows, from jira/workflows.json in the team folder (written by an AI assistant from an export, or by hand).
   Flightdeck never calls Jira; it uses these to check that a map's transitions exist, and to ask for each transition's
   required fields, with a hint about the value and, where the file says so, the value itself from the run.

   {
     "Story": {
       "statuses": ["To Do", "In Progress", "In Review", "Done"],
       "transitions": [
         { "from": "In Progress", "to": "In Review", "fields": [ { "name": "Reviewer", "hint": "Who reviews the PR", "source": "role:reviewer" } ] },
         { "from": "*", "to": "Done", "fields": [ { "name": "Resolution", "hint": "Usually Done", "options": ["Done", "Won't Do"] } ] }
       ]
     }
   }

   A field's "source" fills it in: "detail:<run detail>", "role:<role>" (the person's name), or "value:<fixed text>". */
PF.jira = (function () {
  'use strict';
  var U = PF.util;

  function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

  /* Check the file. Returns { workflows, errors, over }: workflows holds only what passed, so one bad type doesn't hide the rest. */
  function check(o) {
    /* Issue types are names in a file: a workflow called __proto__ is kept as any other, so nothing it requires is lost. */
    var out = Object.create(null), errors = [];
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { workflows: broken('jira/workflows.json must be an object of issue types'), errors: ['jira/workflows.json must be an object of issue types'] };
    /* Over a limit is an error, never a silent cut: a dropped required field would let a transition be checked without it. */
    if (Object.keys(o).length > 50) errors.push('jira/workflows.json lists ' + Object.keys(o).length + ' issue types; the most Flightdeck reads is 50');
    /* Any error in an issue type rejects the whole type, kept as { invalid } rather than dropped: a dropped type or field
       would read as "no required fields", so its transitions must be refused instead. */
    /* Issue types are matched without regard to case, so two that differ only in case can't be told apart: both are refused. */
    var lower = Object.create(null);
    Object.keys(o).forEach(function (type) { var k = type.toLowerCase(); lower[k] = (lower[k] || 0) + 1; });
    Object.keys(o).slice(0, 50).forEach(function (type) {
      if (type !== FILE && lower[type.toLowerCase()] > 1) { var why = 'Jira workflow "' + type + '": another issue type differs only in capitals'; errors.push(why); out[type] = { invalid: why, statuses: [], transitions: [] }; return; }
      /* A run's own copy keeps an unreadable-file marker exactly as it was. */
      if (type === FILE) { var why = o[type] && typeof o[type].invalid === 'string' ? o[type].invalid.slice(0, 300) : 'jira/workflows.json couldn\'t be read'; errors.push(why); out[FILE] = broken(why)[FILE]; return; }
      var e0 = errors.length;
      checkType(type);
      if (errors.length > e0) out[type] = { invalid: errors.slice(e0).join('; '), statuses: [], transitions: [] };
    });
    /* over: the issue types past the limit, which nothing here reads, so a caller can name them. */
    return { workflows: out, errors: errors, over: Object.keys(o).slice(50) };

    function checkType(type) {
      var w = o[type], where = 'Jira workflow "' + type + '"';
      if (!w || typeof w !== 'object') { errors.push(where + ': must be an object'); return; }
      if (Array.isArray(w.statuses) && w.statuses.some(function (x) { return typeof x !== 'string' || x.trim().length > 60; })) { errors.push(where + ': each status must be a name of at most 60 characters'); return; }
      var statuses = Array.isArray(w.statuses) ? w.statuses.map(function (x) { return str(x, 60); }).filter(Boolean) : [];
      if (statuses.some(function (x, i) { return statuses.indexOf(x) !== i; })) { errors.push(where + ': a status is listed twice'); return; }
      if (!statuses.length) { errors.push(where + ': needs "statuses", a list of status names'); return; }
      var trans = [];
      var raw = w.transitions;
      if (raw && !Array.isArray(raw) && typeof raw === 'object') {
        /* Short form: { "To Do": ["In Progress"] } */
        Object.keys(raw).forEach(function (from) { (Array.isArray(raw[from]) ? raw[from] : []).forEach(function (to) { trans.push({ from: from, to: to, fields: [] }); }); });
      } else if (Array.isArray(raw)) trans = raw;
      else { errors.push(where + ': needs "transitions"'); return; }
      var clean = [];
      if (trans.length > 300) { errors.push(where + ': has ' + trans.length + ' transitions; the most Flightdeck reads is 300'); return; }
      var tooMany = false;
      trans.forEach(function (t, i) {
        var tw = where + ', transition ' + (i + 1);
        if (!t || typeof t !== 'object') { errors.push(tw + ': must be an object'); return; }
        var from = str(t.from, 60) || '*', to = str(t.to, 60);
        if (statuses.indexOf(to) < 0) { errors.push(tw + ': "to" must be one of the statuses'); return; }
        if (from !== '*' && statuses.indexOf(from) < 0) { errors.push(tw + ': "from" must be one of the statuses, or "*" for any'); return; }
        var fields = [];
        if (t.fields != null && !Array.isArray(t.fields)) { errors.push(tw + ': "fields" must be a list'); return; }
        if (Array.isArray(t.fields) && t.fields.length > 20) { errors.push(tw + ': requires ' + t.fields.length + ' fields; the most one transition can require is 20'); tooMany = true; return; }
        (Array.isArray(t.fields) ? t.fields : []).forEach(function (f, j) {
          var name = f && str(f.name, 200);
          if (!name) { errors.push(tw + ', field ' + (j + 1) + ': needs a "name"'); return; }
          if (name.length > 60) { errors.push(tw + ', field "' + name.slice(0, 40) + '…": names can be at most 60 characters'); return; }
          if (f.options != null && (!Array.isArray(f.options) || !f.options.length || f.options.length > 30 || f.options.some(function (x) { return typeof x !== 'string' || !x.trim() || x.trim().length > 40; }))) { errors.push(tw + ', field "' + name + '": "options" must be a list of 1 to 30 names, each at most 40 characters'); return; }
          var src = f.source == null ? '' : str(f.source, 80);
          if (src && !/^(detail|role):[\w-]{1,40}$|^value:.{1,80}$/.test(src)) { errors.push(tw + ', field "' + name + '": "source" must be detail:<name>, role:<name> or value:<text>'); return; }
          var opts = Array.isArray(f.options) ? f.options.map(function (x) { return str(x, 40); }).filter(Boolean).slice(0, 30) : null;
          fields.push({ name: name, hint: str(f.hint, 200), source: src, options: opts && opts.length ? opts : null });
        });
        clean.push({ from: from, to: to, fields: fields });
      });
      /* Per target status: at most 40 distinct required fields, and no two names that would be stored under one key. */
      var bad = tooMany;
      statuses.forEach(function (st) {
        var names = Object.create(null), keys = Object.create(null), n = 0;
        clean.filter(function (t) { return t.to === st; }).forEach(function (t) { t.fields.forEach(function (f) {
          /* The same field on two transitions into one status must be defined the same way: Flightdeck asks for it once. */
          var low = f.name.toLowerCase(), sig = JSON.stringify([f.options ? f.options.slice().sort() : null, f.source || '']);
          if (names[low]) { if (names[low] !== sig) { errors.push(where + ': "' + f.name + '" is defined differently on two transitions into "' + st + '" (choices or source); make them the same'); bad = true; } return; }
          names[low] = sig; n++;
          var k = key(f.name);
          if (keys[k]) { errors.push(where + ': fields "' + keys[k] + '" and "' + f.name + '" are too alike to tell apart; rename one'); bad = true; }
          keys[k] = f.name;
        }); });
        if (n > 40) { errors.push(where + ': moving to "' + st + '" requires ' + n + ' fields; the most Flightdeck asks for is 40'); bad = true; }
      });
      if (bad) return;
      out[type] = { statuses: statuses, transitions: clean };
    }
  }

  /* A workflow file that can't be read at all is kept as this marker, never as "no file": every transition is refused until it's fixed. */
  var FILE = '#file';
  function broken(why) { var o = {}; o[FILE] = { invalid: why, statuses: [], transitions: [] }; return o; }
  function fileProblem(workflows) { var f = workflows && workflows[FILE]; return f && f.invalid ? f.invalid : null; }
  /* The workflow for an issue type (any capitalization). Without a type, the only workflow there is, if there's just one. */
  function forType(workflows, issueType) {
    var keys = Object.keys(workflows || {}).filter(function (k) { return k !== FILE; });
    if (issueType) { var k = keys.filter(function (x) { return x.toLowerCase() === String(issueType).trim().toLowerCase(); })[0]; return k ? { type: k, workflow: workflows[k] } : null; }
    return keys.length === 1 ? { type: keys[0], workflow: workflows[keys[0]] } : null;
  }
  function into(workflow, status) { return workflow.transitions.filter(function (t) { return t.to === status; }); }

  /* The required fields for moving into a status, merged across the transitions that lead there (any starting status). */
  function requiredFields(workflow, status) {
    var seen = Object.create(null), out = [];
    into(workflow, status).forEach(function (t) {
      t.fields.forEach(function (f) {
        var k = f.name.toLowerCase();
        if (!seen[k]) { seen[k] = { name: f.name, hint: f.hint, source: f.source, options: f.options, from: [] }; out.push(seen[k]); }
        if (seen[k].from.indexOf(t.from) < 0) seen[k].from.push(t.from);
      });
    });
    return out;
  }
  /* A field's value from the run, where its source says. */
  function resolve(source, details, roleName) {
    var m = /^(detail|role|value):(.+)$/.exec(source || '');
    if (!m) return '';
    if (m[1] === 'value') return m[2];
    if (m[1] === 'detail') return details && Object.prototype.hasOwnProperty.call(details, m[2]) ? details[m[2]] || '' : '';
    return roleName ? roleName(m[2]) : '';
  }
  /* The record key a Jira field is stored under: short, and safe as a run-file key. */
  function key(name) { return 'jf-' + U.slug(name, 20) + '-' + U.hash(String(name).trim().toLowerCase()); }

  return { check: check, broken: broken, fileProblem: fileProblem, FILE: FILE, forType: forType, into: into, requiredFields: requiredFields, resolve: resolve, key: key };
})();

/* The Jira search step ({jira.search}, 2.16). Flightdeck never calls Jira: a step holds a query (JQL) or a saved filter's
   number, a rule for what the search should find, and the Open in Jira link built from them. A person or an assistant runs
   the search with their own access and records what Jira showed (count, keys, link). Everything here is pure text work.

   Run details go only where one value goes (after = != < > <= >=, or as a member of IN (...)), found with a real lexer and
   filled in by token position, each as one quoted JQL string; the output is lexed again to prove every value sits exactly
   where it should (contained). Recorded results belong to one search: searchId is the SHA-256 of the copied Jira address,
   the resolved JQL or filter, every consumed detail with its value and generation, and the step's recovery generation. */
PF.jsearch = (function () {
  'use strict';
  var QUERY_MAX = 2000, LINK_MAX = 8000, KEYS_MAX = 300, VALUE_MAX = 300, COUNT_MAX = 1000000, WHAT_MAX = 200, LINK_FIELD_MAX = 300;
  var FIELDS = ['query', 'filter', 'site', 'results', 'what'];
  var SEARCH_FIELDS = ['searchId', 'count', 'keys', 'resultsLink', 'ranAt'];
  var FORMULA = 'flightdeck-search/3', SITE_DEFAULT = 'jira-base-url';
  var CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
  var BIDI = /[‎‏‪-‮⁦-⁩]/;
  var LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;
  var GEN = /^[1-9]\d{0,8}-[0-9a-f]{8}$/;
  var ID = /^sha256:[0-9a-f]{64}$/;
  var KEY = /^[A-Z][A-Z0-9_]{0,19}-[1-9]\d{0,9}$/;
  var SCALAR_OPS = ['=', '!=', '<', '>', '<=', '>='];

  function own(o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
  function cpLen(v) { return Array.from(String(v)).length; }
  /* The forbidden characters (one set, the same as the Python checker's bad_text): C0 and C1 controls, line and paragraph
     separators, direction characters and lone surrogates. */
  function badText(v) { v = String(v); return CONTROL.test(v) ? 'a line break or control character' : BIDI.test(v) ? 'a direction character' : LONE.test(v) ? 'broken Unicode (a lone surrogate)' : ''; }
  function kw(w) { return String(w).toUpperCase(); }

  /* ---- 1. The lexer: str (either quote, backslash escapes), op, lp, rp, comma, ph (^name), word; each with offsets. ---- */
  function lex(q) {
    q = String(q); var out = [], i = 0;
    while (i < q.length) {
      var c = q.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"' || c === '\'') {
        var j = i + 1, v = '';
        while (j < q.length && q.charAt(j) !== c) {
          if (q.charAt(j) === '\\') { if (j + 1 >= q.length) return { ok: false, why: 'a quoted string ends in a lone backslash' }; v += q.charAt(j + 1); j += 2; } else v += q.charAt(j++);
        }
        if (j >= q.length) return { ok: false, why: 'a ' + (c === '"' ? 'double' : 'single') + ' quote is never closed' };
        out.push({ t: 'str', v: v, s: i, e: j + 1, q: c }); i = j + 1; continue;
      }
      var two = q.slice(i, i + 2);
      if (two === '!=' || two === '!~' || two === '<=' || two === '>=') { out.push({ t: 'op', v: two, s: i, e: i + 2 }); i += 2; continue; }
      if ('=~<>'.indexOf(c) >= 0) { out.push({ t: 'op', v: c, s: i, e: i + 1 }); i++; continue; }
      if (c === '(') { out.push({ t: 'lp', s: i, e: i + 1 }); i++; continue; }
      if (c === ')') { out.push({ t: 'rp', s: i, e: i + 1 }); i++; continue; }
      if (c === ',') { out.push({ t: 'comma', s: i, e: i + 1 }); i++; continue; }
      if (c === '!') return { ok: false, why: '"!" is only part of != or !~' };
      var k = i; while (k < q.length && !/[\s"'()=,~<>!]/.test(q.charAt(k))) k++;
      var w = q.slice(i, k), m = /^\^([\w-]+)$/.exec(w);
      out.push(m ? { t: 'ph', v: m[1], s: i, e: k } : { t: 'word', v: w, s: i, e: k }); i = k;
    }
    return { ok: true, tokens: out };
  }

  /* ---- 2. Where each run detail sits (section 3.1). ---- */
  function placeholders(q, context) {
    context = context || [];
    var L = lex(q); if (!L.ok) return { errors: ['"query": ' + L.why + '.'], tokens: [], uses: [] };
    var T = L.tokens, errors = [], uses = [], stack = [];
    function at(k) { return T[k] || null; }
    T.forEach(function (tk, k) {
      if (tk.t === 'lp') {
        var p = at(k - 1), kind = 'group';
        if (p && p.t === 'word' && !(kw(p.v) === 'IN' || kw(p.v) === 'AND' || kw(p.v) === 'OR' || kw(p.v) === 'NOT')) kind = 'function';
        else if (p && p.t === 'word' && kw(p.v) === 'IN') kind = 'list';
        stack.push(kind); tk.ctx = kind; return;
      }
      if (tk.t === 'rp') { stack.pop(); return; }
      var re = /\^([\w-]+)/g, m;
      if (tk.t === 'str') {
        while ((m = re.exec(tk.v))) if (context.indexOf(m[1]) >= 0) errors.push('"query" has ^' + m[1] + ' inside quotes. Write it on its own after =, !=, <, >, <=, >= or inside IN (...): Flightdeck quotes it for you.');
        return;
      }
      if (tk.t === 'word' && /\^[\w-]/.test(tk.v)) {
        while ((m = re.exec(tk.v))) errors.push(context.indexOf(m[1]) >= 0 ? '"query" has ^' + m[1] + ' joined to other text ("' + tk.v + '"); a run detail stands alone.' : '"query" has ^' + m[1] + ', which isn\'t a run detail.');
        return;
      }
      if (tk.t !== 'ph') return;
      if (context.indexOf(tk.v) < 0) { errors.push('"query" has ^' + tk.v + ', which isn\'t a run detail of this checklist.'); return; }
      var inFn = stack.indexOf('function') >= 0, top = stack.length ? stack[stack.length - 1] : 'top';
      var p1 = at(k - 1), p2 = at(k - 2), n = at(k + 1), ok = false, why = '';
      if (inFn) why = 'is inside a function\'s arguments';
      else if (p1 && p1.t === 'op' && (p1.v === '~' || p1.v === '!~')) why = 'is a text search (~ or !~), which reads its own syntax inside the string';
      else if (p1 && p1.t === 'op' && SCALAR_OPS.indexOf(p1.v) >= 0) ok = true;
      else if (p1 && p1.t === 'word' && (kw(p1.v) === 'IS' || (kw(p1.v) === 'NOT' && p2 && p2.t === 'word' && kw(p2.v) === 'IS'))) why = 'follows IS or IS NOT, which take only EMPTY or NULL (write IS EMPTY as fixed text)';
      else if (top === 'list' && p1 && (p1.t === 'lp' || p1.t === 'comma')) ok = true;
      else why = 'isn\'t where a value goes (after =, !=, <, >, <=, >=, or inside IN (...))';
      if (ok) {
        var endOk = !n || n.t === 'rp' || (n.t === 'comma' && top === 'list') || (n.t === 'word' && ['AND', 'OR', 'ORDER'].indexOf(kw(n.v)) >= 0);
        if (!endOk) { ok = false; why = 'is followed by "' + (n.v || n.t) + '", where the value should end'; }
      }
      if (ok) { tk.slot = true; uses.push(tk.v); } else errors.push('"query" has ^' + tk.v + ' that ' + why + '.');
    });
    return { errors: errors, tokens: T, uses: uses.filter(function (x, i) { return uses.indexOf(x) === i; }) };
  }

  /* ---- 3. The rule (results:). ---- */
  function parseResults(text) {
    var t = String(text == null ? 'any' : text).trim().toLowerCase().replace(/\s+/g, ' ');
    if (t === 'none') return { ok: true, op: 'eq', n: 0, text: 'none' };
    if (t === 'any') return { ok: true, op: 'any', n: null, text: 'any' };
    var m = /^(exactly|at least|at most) (0|[1-9]\d{0,5})$/.exec(t);
    if (!m) return { ok: false, why: '"results" should be none, any, exactly N, at least N or at most N (N a whole number up to 999999).' };
    var op = { exactly: 'eq', 'at least': 'ge', 'at most': 'le' }[m[1]], n = +m[2];
    if (op === 'eq' && n === 0) return { ok: true, op: 'eq', n: 0, text: 'none' };
    if (op === 'ge' && n === 0) return { ok: true, op: 'any', n: null, text: 'any' };
    return { ok: true, op: op, n: n, text: m[1] + ' ' + n };
  }
  function ruleLabel(r) { return !r ? '' : r.text === 'none' ? 'None' : r.text === 'any' ? 'Any number, including zero' : r.text.charAt(0).toUpperCase() + r.text.slice(1); }
  function meets(rule, count) { return rule.op === 'any' ? true : rule.op === 'eq' ? count === rule.n : rule.op === 'ge' ? count >= rule.n : count <= rule.n; }
  function ruleWords(rule) { return rule.text === 'none' ? 'no results' : rule.text === 'any' ? 'any number of results' : rule.text + ' result' + (rule.n === 1 ? '' : 's'); }
  /* A rule that passes only with no results, where issue keys can never be given. */
  function zeroOnly(rule) { return !!rule && rule.n === 0 && (rule.op === 'eq' || rule.op === 'le'); }

  /* ---- 4. The Jira address: exactly https://host[:port][/path] (section 4). ---- */
  function checkBase(v) {
    if (typeof v !== 'string') return { ok: false, why: 'isn\'t text.' };
    if (v !== v.trim() || badText(v) || /\s/.test(v)) return { ok: false, why: 'has spaces, control or direction characters.' };
    if (!/^https:\/\//i.test(v)) return { ok: false, why: 'must start with https://.' };
    if (/[\\@?#%"'<>`{}|^]/.test(v.slice(8))) return { ok: false, why: 'can only be https://host[:port][/path], without a user, query, fragment, escapes or quotes.' };
    var m = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::([1-9]\d{0,4}))?((?:\/[A-Za-z0-9._~-]+)*)\/?$/i.exec(v);
    if (!m || (m[2] && +m[2] > 65535)) return { ok: false, why: 'isn\'t https://host[:port][/path] (host in letters, digits, dots and dashes; an international name in its xn-- form).' };
    if ((m[3] || '').split('/').some(function (s) { return s === '.' || s === '..'; })) return { ok: false, why: 'has a "." or ".." path segment.' };
    var base = 'https://' + m[1].toLowerCase() + (m[2] ? ':' + m[2] : '') + (m[3] || ''), u;
    if (typeof URL !== 'function') return { ok: false, why: 'can\'t be checked here (no URL parser).' };
    try { u = new URL(base); } catch (e) { return { ok: false, why: 'isn\'t a web address.' }; }
    var canon = u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
    if (u.username || u.password || u.search || u.hash || canon !== base) return { ok: false, why: 'reads differently as a web address (' + canon + ') than as written.' };
    return { ok: true, base: base };
  }
  /* The team value a step names (site: team:<name>), or the default. */
  function siteName(f) { var m = /^team:([a-z0-9][a-z0-9-]{0,39})$/.exec(String(f && f.site != null ? f.site : 'team:' + SITE_DEFAULT).trim()); return m ? m[1] : null; }

  /* ---- 5. The step's own fields (section 2): one rule for publish, staging, reading a version and done(). ----
     f: the step's fields; ctx: { context (the checklist's detail names), teamValues (team-values.json as parsed, to check
     the address exists; left out when the caller doesn't have it) }. Returns { errors, tips, rule, site, uses, tokens }. */
  function checkFields(f, ctx) {
    ctx = ctx || {}; f = f || {};
    var context = ctx.context || [], errors = [], tips = [];
    var hasQ = f.query != null && String(f.query).trim() !== '', hasF = f.filter != null && String(f.filter).trim() !== '';
    if (hasQ && hasF) errors.push('give "query:" or "filter:", not both.');
    if (!hasQ && !hasF) errors.push('needs "query:" (JQL) or "filter:" (a saved filter\'s number). It can\'t be filled in during a run.');
    var ph = { uses: [], tokens: [] };
    if (hasQ) {
      var q = String(f.query);
      if (cpLen(q) > QUERY_MAX) errors.push('"query" is ' + cpLen(q) + ' characters; the most is ' + QUERY_MAX + '. Save it as a Jira filter and use "filter:".');
      var bt = badText(q); if (bt) errors.push('"query" has ' + bt + '.');
      ph = placeholders(q, context); ph.errors.forEach(function (e) { errors.push(e); });
    }
    if (hasF && !/^[1-9]\d{0,9}$/.test(String(f.filter).trim())) errors.push('"filter" should be a saved filter\'s number, like 12345.');
    if (hasF && f.what == null) tips.push('a saved filter can change in Jira without the checklist changing; say what it finds with "what:".');
    var site = siteName(f);
    if (!site) errors.push('"site" should be team:<name>, a team value holding the Jira address (Settings > Team values).');
    else if (ctx.teamValues) {
      var lk = PF.teamValues.lookup(ctx.teamValues, site);
      if (lk.missing) errors.push('the team value "' + site + '" isn\'t in team-values.json; add the Jira address there (Settings > Team values).');
      else if (!own(lk, 'value')) errors.push(String(lk.why || 'team-values.json can\'t be read.').replace(/\.?$/, '.') + ' So the Jira address "' + site + '" can\'t be checked.');
      else { var b = checkBase(lk.value); if (!b.ok) errors.push('the team value "' + site + '" ' + b.why.replace(/\.$/, '') + ', so it isn\'t a Jira address Flightdeck can link to.'); }
    }
    var loop = list(f.sets).filter(function (n) { return ph.uses.indexOf(n) >= 0; });
    if (loop.length) errors.push(setsWhy(loop));
    var r = parseResults(f.results); if (!r.ok) errors.push(r.why);
    var req = String(f.require || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
    if (r.ok && req.indexOf('keys') >= 0 && zeroOnly(r)) errors.push('requires keys, but results: ' + r.text + ' passes only with no results, and no results have no issue keys. Take keys out of require: (require: all already leaves them out when there are none).');
    if (f.results == null) tips.push('usually says "results:". Without it: Any number, including zero.');
    if (f.what != null && String(f.what).length > WHAT_MAX) errors.push('"what" can be at most ' + WHAT_MAX + ' characters.');
    return { errors: errors, tips: tips, rule: r.ok ? r : null, site: site, uses: ph.uses, tokens: ph.tokens, form: hasF && !hasQ ? 'filter' : 'jql' };
  }
  function list(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function setsWhy(names) { return 'sets ' + names.map(function (n) { return '^' + n; }).join(', ') + ', which its own query uses. A search can\'t change the detail it searches with; set it in an earlier step.'; }
  /* The run details a step's query uses ([] for a filter or a query that doesn't lex). */
  function uses(f, context) { return f && f.query != null && String(f.query).trim() ? placeholders(String(f.query), context).uses : []; }

  /* ---- 6. Filling in, by position (section 3.2). ---- */
  function quoteJql(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function substitute(query, details, context) {
    var P = placeholders(query, context);
    if (P.errors.length) return { ok: false, why: P.errors.join(' ') };
    var missing = [], refused = [], occ = [], out = '', at = 0;
    P.tokens.forEach(function (tk) {
      if (tk.t !== 'ph' || !tk.slot) return;
      var v = own(details, tk.v) ? String(details[tk.v] == null ? '' : details[tk.v]) : '';
      if (!v) { missing.push(tk.v); return; }
      var bt = badText(v); if (bt || cpLen(v) > VALUE_MAX) { refused.push('^' + tk.v + ' has ' + (bt || 'more than ' + VALUE_MAX + ' characters')); return; }
      out += query.slice(at, tk.s); var lit = quoteJql(v);
      occ.push({ name: tk.v, value: v, s: out.length, e: out.length + lit.length });
      out += lit; at = tk.e;
    });
    if (missing.length || refused.length) return { ok: false, missing: missing.filter(function (x, i) { return missing.indexOf(x) === i; }), why: (missing.length ? 'Waiting for ' + missing.filter(function (x, i) { return missing.indexOf(x) === i; }).map(function (n) { return '^' + n; }).join(', ') + '.' : '') + (missing.length && refused.length ? ' ' : '') + (refused.length ? refused.join('; ') + ', so it can\'t go in a search.' : '') };
    out += query.slice(at);
    var used = {}; occ.forEach(function (o) { used[o.name] = o.value; });
    return { ok: true, jql: out, occ: occ, used: used, template: P.tokens };
  }
  /* ---- 7. The positional check (section 3.3): the output lexes to the template's tokens, each value one string at its place. ---- */
  function contained(template, sub) {
    var L = lex(sub.jql); if (!L.ok) return { ok: false, why: 'the output doesn\'t lex: ' + L.why };
    var out = L.tokens, want = template.map(function (t) { return t.t === 'ph' && t.slot ? 'str' : t.t; });
    if (out.length !== want.length) return { ok: false, why: 'the output has ' + out.length + ' tokens, the template ' + want.length };
    for (var k = 0; k < out.length; k++) if (out[k].t !== want[k]) return { ok: false, why: 'token ' + (k + 1) + ' is ' + out[k].t + ' where the template has ' + want[k] };
    for (var i = 0; i < sub.occ.length; i++) {
      var o = sub.occ[i], tk = out.filter(function (t) { return t.s === o.s; })[0];
      if (!tk || tk.t !== 'str' || tk.e !== o.e || tk.v !== o.value) return { ok: false, why: '^' + o.name + ' isn\'t exactly one string at its own place' };
    }
    return { ok: true, tokens: out.length, values: sub.occ.length };
  }

  /* ---- 8. The link (section 4): encodeURIComponent plus ! ' ( ) *, so U.safeUrl accepts it. ---- */
  function strictEncode(s) { return encodeURIComponent(s).replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }); }
  function buildLink(base, o) {
    var b = checkBase(base); if (!b.ok) return { ok: false, why: 'The Jira address ' + b.why };
    if (o.jql != null && badText(o.jql)) return { ok: false, why: 'The query has ' + badText(o.jql) + '.' };
    var href = o.filter ? b.base + '/issues/?filter=' + String(o.filter).trim() : b.base + '/issues/?jql=' + strictEncode(o.jql);
    if (href.length > LINK_MAX) return { ok: false, why: 'The link would be ' + href.length + ' characters, over ' + LINK_MAX + '; copy the query instead, or save it as a Jira filter.' };
    if (!PF.util.safeUrl(href)) return { ok: false, why: 'The link failed Flightdeck\'s link check.' };
    return { ok: true, href: href, base: b.base };
  }

  /* ---- 9. Generations and the identity (section 5.1). ---- */
  function randomHex(n) {
    var out = '', c = typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function' ? crypto : null;
    if (c) { var a = new Uint8Array(Math.ceil(n / 2)); c.getRandomValues(a); for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2); return out.slice(0, n); }
    // SECURITY-REVIEW: without crypto.getRandomValues (never in a supported browser or Node), generations fall back to Math.random; they are identity tokens against stale reports, not secrets
    for (var j = 0; j < n; j++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }
  /* A new generation for a detail or a search: <n>-<8 hex>, n one more than the one it replaces (1 when none valid). */
  function token(prev) { var m = typeof prev === 'string' && GEN.test(prev) ? /^(\d+)-/.exec(prev) : null, n = m ? Math.min(+m[1] + 1, 999999999) : 1; return n + '-' + randomHex(8); }
  function genOk(v) { return typeof v === 'string' && GEN.test(v); }
  function identity(site, f, sub, gens, rec) {
    if (!genOk(rec)) return null;
    if (f.filter != null && String(f.filter).trim() && !(f.query != null && String(f.query).trim())) return [FORMULA, site || '', 'filter', String(f.filter).trim(), [], rec];
    var names = Object.keys(sub.used).sort();
    if (names.some(function (n) { return !own(gens, n) || !genOk(gens[n]); })) return null;
    return [FORMULA, site || '', 'jql', sub.jql, names.map(function (n) { return [n, sub.used[n], gens[n]]; }), rec];
  }
  function fingerprint(id) { return id ? 'sha256:' + PF.sha256.create().update(JSON.stringify(id)).digest() : null; }

  /* ---- 10. The search fields of the evidence (section 2): canonical form, or why not. ----
     values: what was typed or reported; curId: the current searchId (null when the search has none); now: ms for ranAt.
     opts.practice: no searchId asked or stored. Returns { values (canonical, search fields only), meets, why } or { error, field }. */
  function realTime(t, now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(t);
    if (!m) return 'When it ran should be a time with its zone, like 2026-11-04T14:05Z.';
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +(m[6] || 0), day = new Date(Date.UTC(y, mo - 1, d));
    if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d || h > 23 || mi > 59 || s > 59 || (m[8] && (+m[8] > 14 || +m[9] > 59))) return 'When it ran isn\'t a real date and time (' + t + ').';
    if (Date.parse(t) > now + 5 * 60 * 1000) return 'When it ran is in the future (' + t + '). Check the clock of whatever ran it.';
    return '';
  }
  function checkEvidence(rule, v, curId, now, opts) {
    v = v || {};
    var out = {}, practice = !!(opts && opts.practice);
    function str(k) { return own(v, k) && v[k] != null ? String(v[k]).trim() : ''; }
    if (!practice) {
      if (!curId) return { error: 'This search has no current search, so results can\'t be recorded for it. Refresh the search, then search again.', field: 'searchId' };
      if (str('searchId') !== curId) return { error: str('searchId') ? 'These results are for an earlier search (a run detail it used has changed). Search again.' : 'These results don\'t say which search they are for.', field: 'searchId' };
      out.searchId = curId;
    }
    var c = str('count');
    if (!c) return { error: 'The number of results is needed to check this step.', field: 'count' };
    if (!/^\+?\d{1,7}$/.test(c) || +c > COUNT_MAX) return { error: 'The number of results should be a whole number, like 0 or 12.', field: 'count' };
    out.count = String(+c);
    var k = str('keys');
    if (k && out.count === '0') return { error: 'Issue keys doesn\'t apply when there are no results.', field: 'keys' };
    if (k) {
      var m = /^(.*?)(?:\s*\+\s*(\d{1,7}) more)?$/i.exec(k), parts = m[1].split(/[\s,]+/).filter(Boolean).map(function (x) { return x.toUpperCase(); });
      var bad = parts.filter(function (x) { return !KEY.test(x); });
      if (bad.length) return { error: 'Issue keys should look like PAY-123; these don\'t: ' + bad.slice(0, 3).join(', ') + '.', field: 'keys' };
      var uniq = parts.filter(function (x, i) { return parts.indexOf(x) === i; }), more = m[2] ? +m[2] : 0;
      if (!uniq.length) return { error: 'Name at least one issue key before "+N more".', field: 'keys' };
      var text = uniq.join(', ') + (more ? ' +' + more + ' more' : '');
      if (text.length > KEYS_MAX) return { error: 'The keys are ' + text.length + ' characters; list up to ' + KEYS_MAX + ' and end with "+N more".', field: 'keys' };
      if (uniq.length + more > +out.count) return { error: 'The keys name ' + (uniq.length + more) + ' issues, more than the ' + out.count + ' results.', field: 'keys' };
      if (uniq.length + more < +out.count) return { error: 'The keys name ' + (uniq.length + more) + ' of ' + out.count + ' results; list the rest or end with "+' + (+out.count - uniq.length) + ' more".', field: 'keys' };
      out.keys = text;
    }
    var l = str('resultsLink');
    if (l) { if (l.length > LINK_FIELD_MAX || !/^https?:\/\/\S+$/i.test(l) || !PF.util.safeUrl(l)) return { error: 'The results link should be a web link of at most 300 characters (leave it out if Jira\'s is longer; Flightdeck builds its own).', field: 'resultsLink' }; out.resultsLink = l; }
    var t = str('ranAt');
    if (t) { var why = realTime(t, now); if (why) return { error: why, field: 'ranAt' }; out.ranAt = t; }
    var ok = meets(rule, +out.count);
    if (!ok && +out.count > 0 && !out.keys) return { error: 'This search should find ' + ruleWords(rule) + ' and found ' + out.count + '. Record at least one key it found, then block the step.', field: 'keys', meets: false };
    return { values: out, meets: ok, why: ok ? '' : 'This search should find ' + ruleWords(rule) + ' and found ' + out.count + (out.keys ? ' (' + out.keys + ')' : '') + '. Fix Jira and search again, or block the step.' };
  }
  /* "Found 3: PAY-101, PAY-102, PAY-103", the reason Block with these gives, cut to 120 characters. */
  function foundWords(values) { return ('Found ' + values.count + (values.keys ? ': ' + values.keys : '')).slice(0, 120); }

  return { QUERY_MAX: QUERY_MAX, LINK_MAX: LINK_MAX, VALUE_MAX: VALUE_MAX, FIELDS: FIELDS, SEARCH_FIELDS: SEARCH_FIELDS, FORMULA: FORMULA, SITE_DEFAULT: SITE_DEFAULT, GEN: GEN, ID: ID,
    badText: badText, cpLen: cpLen, lex: lex, placeholders: placeholders, parseResults: parseResults, ruleLabel: ruleLabel, ruleWords: ruleWords, meets: meets, zeroOnly: zeroOnly,
    checkBase: checkBase, siteName: siteName, checkFields: checkFields, uses: uses, setsWhy: setsWhy, quoteJql: quoteJql, substitute: substitute, contained: contained, strictEncode: strictEncode,
    buildLink: buildLink, token: token, genOk: genOk, identity: identity, fingerprint: fingerprint, realTime: realTime, checkEvidence: checkEvidence, foundWords: foundWords };
})();
