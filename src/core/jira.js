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

  /* Check the file. Returns { workflows, errors }: workflows holds only what passed, so one bad type doesn't hide the rest. */
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
    return { workflows: out, errors: errors };

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
