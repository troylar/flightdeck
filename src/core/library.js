/* The library view (3.0): every checklist the folder holds, read into one normalized shape, with what links to what and which
   parts look alike across checklists. Shared by flightdeck library inspect (docs/apps.md) and a checklist's page (Used by,
   Similar in other checklists). Also the design tips: advice on a draft's shape that never blocks publishing, shared by the
   draft editor, flightdeck draft check and (for the tips that need no library) check_folder.py --draft. Pure, ES5.
   A similarity is a candidate with its reason, never a verdict: two searches can match and still differ in scope, owner or
   authority. What couldn't be read is said, and never reads as "nothing similar". */
PF.library = (function () {
  'use strict';
  var M = PF.map, T = PF.types, S = PF.jsearch, U = PF.util;
  var NAME = '[A-Za-z0-9_-]';
  /* Fields that say when or how strictly, not what the step does: two steps differing only in these are the same work. */
  var TIMING = { at: 1, due: 1, after: 1, expect: 1, deadline: 1, require: 1, evidence: 1, sets: 1 };

  /* A query as Jira reads it, so two spellings of one search compare equal: words lower-cased, quoted values kept as written
     (in double quotes), every run detail one placeholder (^version and ^fix_version are both ^?), ORDER BY left out (it
     changes the order, not what's found). null when it doesn't lex. */
  function normQuery(q) {
    if (q == null || !String(q).trim()) return null;
    var L = S.lex(String(q)); if (!L.ok) return null;
    var out = [], toks = L.tokens;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.t === 'word' && t.v.toUpperCase() === 'ORDER' && toks[i + 1] && toks[i + 1].t === 'word' && toks[i + 1].v.toUpperCase() === 'BY') break;
      out.push(t.t === 'word' ? t.v.toLowerCase() : t.t === 'str' ? '"' + t.v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : t.t === 'ph' ? '^?' : t.t === 'op' ? t.v : t.t === 'lp' ? '(' : t.t === 'rp' ? ')' : ',');
    }
    return out.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ,/g, ',');
  }
  /* What a gate approves, compared the same way: case and spacing don't count, and every run detail is one placeholder. */
  function normApproves(a) {
    var t = String(a || '').replace(new RegExp('\\^' + NAME + '+', 'g'), '^?').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return t || null;
  }
  function list(s) { return String(s || '').split(/[,\s]+/).filter(Boolean); }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  /* One checklist, normalized: a publication ({ info, map, types }) or a draft's text. */
  function describe(id, source, map, info, types, skills) {
    var meta = map.meta, out = { process: id, title: meta.title || id, source: source, version: info ? +info.version || null : null, folder: info ? info.folder || null : null,
      owner: meta.owner || null, runs: meta.runs === 'solo' ? 'solo' : 'team', context: meta.context.map(function (n) { var t = own(meta.detailTypes, n) ? meta.detailTypes[n] : null; return { name: n, type: t && t.kind ? t.kind : 'text' }; }),
      roles: meta.roles.slice(), steps: [], searches: [], gates: [], sets: [], children: [], types: [], teamTypes: [], skills: [] };
    var seen = Object.create(null);
    map.phases.forEach(function (p) {
      p.steps.forEach(function (s) {
        var f = Object.create(null); Object.keys(s.fields).forEach(function (k) { f[k] = String(s.fields[k]); });
        out.steps.push({ id: s.id, phase: p.id, type: s.type, text: s.text, must: !!s.must, roles: s.roles.slice(), fields: f });
        if (s.type && !seen[s.type]) {
          seen[s.type] = true;
          var def = T.get(s.type, types);
          (def && def.custom ? out.teamTypes : out.types).push(s.type);
        }
        if (s.type === 'jira.search') {
          var r = S.parseResults(s.fields.results);
          out.searches.push({ step: s.id, query: own(s.fields, 'query') ? String(s.fields.query) : null, filter: own(s.fields, 'filter') ? String(s.fields.filter).trim() : null,
            normalized: normQuery(s.fields.query), results: r.ok ? r.text : null, site: S.siteName(s.fields) || null });
        }
        var sets = list(s.fields.sets);
        if (sets.length) out.sets.push({ step: s.id, names: sets });
        if (s.type === 'run.process' && s.fields.process) {
          var pass = own(s.fields, 'pass') ? PF.links.parse(s.fields.pass).entries || [] : [];
          out.children.push({ step: s.id, process: String(s.fields.process).trim(), version: own(s.fields, 'version') ? +s.fields.version || null : null,
            pass: pass.map(function (e) { return PF.links.entryText(e); }), carry: PF.links.carryList(s) });
        }
      });
      var g = p.gate;
      out.gates.push({ id: g.id, phase: p.id, title: g.title, implicit: !!g.implicit, owner: g.owner || null, approves: g.approves || '', pattern: normApproves(g.approves) });
    });
    (skills || []).forEach(function (x) {
      var k = x.skill; if (!k) return;
      out.skills.push({ name: String(k.name || ''), implements: typeof k.implements === 'number' ? k.implements : null, steps: Array.isArray(k.steps) ? k.steps.slice() : null, status: String((x.status || {}).s || '') });
    });
    return out;
  }

  /* What a step does, for comparing across checklists: its type and the fields that say what (not when), with run details as
     one placeholder. null when there's nothing to compare beyond the type (a bare confirm matches every bare confirm). */
  function stepKey(s) {
    var keys = Object.keys(s.fields).filter(function (k) { return !TIMING[k] && String(s.fields[k]).trim(); }).sort();
    if (!s.type || !keys.length || s.type === 'jira.search' || s.type === 'run.process') return null;
    return s.type + '|' + keys.map(function (k) { return k + '=' + String(s.fields[k]).replace(new RegExp('\\^' + NAME + '+', 'g'), '^?').replace(/\s+/g, ' ').trim().toLowerCase(); }).join('|');
  }

  /* procs: the processes as the app lists them ({ id, latest, draft, draftChanged, skills }); unread: [{ process, path, why }],
     the parts that couldn't be read. The latest usable version is what new runs use; a draft that differs from it is listed too. */
  function inspect(procs, unread, opts) {
    opts = opts || {};
    /* Keyed by names from files, so no inherited key (constructor, __proto__) can be one. */
    var lists = [], usedBy = [], typeUse = Object.create(null);
    (procs || []).forEach(function (p) {
      if (p.latest && p.latest.map) lists.push(describe(p.id, 'publication', p.latest.map, p.latest.info, p.latest.types, p.skills));
      if (p.draft && p.draft.md != null && (p.draftChanged || !p.latest)) {
        var dm = M.parse(p.draft.md);
        if (!dm.errors.length) lists.push(describe(p.id, 'draft', dm, null, opts.types || {}, null));
      }
    });
    lists.forEach(function (c) {
      c.children.forEach(function (k) { usedBy.push({ process: k.process, by: { process: c.process, source: c.source, step: k.step, version: k.version } }); });
      c.steps.forEach(function (s) {
        if (!s.type) return;
        var u = typeUse[s.type] = typeUse[s.type] || { id: s.type, team: c.teamTypes.indexOf(s.type) >= 0, usedBy: [] };
        var row = u.usedBy.filter(function (x) { return x.process === c.process && x.source === c.source; })[0];
        if (!row) u.usedBy.push(row = { process: c.process, source: c.source, steps: [] });
        row.steps.push(s.id);
      });
    });
    var overlaps = [];
    function group(kind, reason, keyOf) {
      var by = Object.create(null);
      lists.forEach(function (c) { keyOf(c).forEach(function (x) { if (!x.key) return; (by[x.key] = by[x.key] || []).push({ process: c.process, source: c.source, id: x.id }); }); });
      Object.keys(by).sort().forEach(function (k) {
        var items = by[k], procsIn = items.map(function (x) { return x.process; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
        if (procsIn.length > 1) overlaps.push({ kind: kind, reason: reason(k), key: k, items: items });
      });
    }
    group('search', function (k) { return k.charAt(0) === 'f' ? 'same saved filter' : 'same normalized JQL'; }, function (c) {
      return c.searches.map(function (s) { return { id: s.step, key: s.normalized ? 'q:' + s.normalized : s.filter ? 'f:' + s.filter : null }; });
    });
    group('step', function () { return 'same type and fields'; }, function (c) {
      return c.steps.map(function (s) { return { id: s.id, key: stepKey(s) }; });
    });
    group('gate', function () { return 'same gate approves pattern'; }, function (c) {
      return c.gates.map(function (g) { return { id: g.id, key: g.pattern }; });
    });
    var bad = (unread || []).map(function (u) { return { process: u.process || null, path: String(u.path || ''), why: String(u.why || '') }; });
    return {
      checklists: lists, usedBy: usedBy, overlaps: overlaps,
      stepTypes: Object.keys(typeUse).sort().map(function (k) { return typeUse[k]; }),
      completeness: { complete: !bad.length, unread: bad,
        note: bad.length ? 'Some checklists couldn\'t be read, so a link to them or an overlap with them can\'t be ruled out.' : 'Every checklist in the folder was read.' }
    };
  }

  /* The processes as the app lists them, from what the loader read (repo.loadAll: processes, drafts, skills), for a reader
     without the app's state (flightdeck library inspect, draft check). A draft is the one named for its process, else the
     first by name, as the app shows it. */
  function entriesOf(d) {
    var by = Object.create(null), order = [];
    var entry = function (id) { if (!by[id]) { by[id] = { id: id, latest: null, all: [], draft: null, draftChanged: false, skills: [] }; order.push(id); } return by[id]; };
    (d.processes || []).forEach(function (p) { var e = entry(p.process); e.latest = p.index.latest; e.all = p.index.all; });
    (d.drafts || []).slice().sort(function (a, b) { return a.file < b.file ? -1 : a.file > b.file ? 1 : 0; }).forEach(function (x) {
      var m = M.parse(x.md), id = m.meta.process || x.file.replace(/\.md$/i, ''), e = entry(id);
      if (e.draft && e.draft.file === id + '.md') return;
      if (e.draft && x.file !== id + '.md') return;
      e.draft = x; e.draftChanged = !e.latest || U.hash(x.md) !== e.latest.info.mapHash;
    });
    (d.skills || []).forEach(function (x) {
      var e = x.skill && by[x.skill.process]; if (!e) return;
      e.skills.push({ skill: x.skill, status: x.unmatched ? { s: 'unmatched' } : (x.errors || []).length ? { s: 'missing' } : PF.skills.status(x.skill, e.all, e.latest, e) });
    });
    return order.map(function (k) { return by[k]; });
  }

  /* One process's part of the library: who links to it, and what in other checklists looks like its steps, searches and
     gates (each with this checklist's own step or gate it matches). */
  function forProcess(lib, id) {
    var usedBy = lib.usedBy.filter(function (e) { return e.process === id && e.by.process !== id; });
    var similar = [];
    lib.overlaps.forEach(function (o) {
      var mine = o.items.filter(function (x) { return x.process === id; });
      if (!mine.length) return;
      o.items.filter(function (x) { return x.process !== id; }).forEach(function (x) {
        if (!similar.some(function (y) { return y.kind === o.kind && y.process === x.process && y.id === x.id && y.mine === mine[0].id; }))
          similar.push({ kind: o.kind, reason: o.reason, mine: mine[0].id, process: x.process, source: x.source, id: x.id });
      });
    });
    return { usedBy: usedBy, similar: similar, complete: lib.completeness.complete, note: lib.completeness.note };
  }

  /* ---- Design tips: advice only, never a blocker. Each { id, at: 'step' | 'gate' | 'checklist', ref, text }. ---- */
  var READINESS = /\b(ready|readiness|no (?:open )?\w+|none|blockers?|blocking|clear|all\b.*\b(?:done|closed|merged|resolved)|green|passes|safe)\b/i;
  var WHOLE_SET = /\b(?:each|every)\s+[a-z]|\ball\s+(?:of\s+)?(?:the\s+)?(?:[a-z-]+\s+){0,2}[a-z-]+s\b/i;
  var VERDICT = /\bNOT READY\b|\bREADY\b|\bgo\s*\/\s*no[- ]go\b|\bgo or no[- ]go\b/;
  var APPROVAL = /\b(?:approve|approves|approved|approval|verdict|sign[- ]?off|signs? off)\b/i;
  /* Types where approving or signing off is the work itself, so the wording is no sign of a misplaced verdict. */
  var APPROVES_BY_TYPE = { review: 1, decide: 1, 'github.pr': 1, 'bitbucket.pr': 1 };
  function quoted(re, text) { var m = re.exec(text); return m ? m[0] : ''; }
  /* The text after the front matter, where ^details and @roles are used. */
  function body(md) {
    var t = String(md || '').replace(/\r\n?/g, '\n'), m = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(t);
    return m ? t.slice(m[0].length) : t;
  }
  /* md: the draft's text; opts.library (inspect's output, or null when it wasn't read) and opts.process, for the tip about a
     search or gate another checklist already has. */
  function lints(md, opts) {
    opts = opts || {};
    var map = M.parse(md), meta = map.meta, out = [], text = body(md);
    var add = function (id, at, ref, t) { out.push({ id: id, at: at, ref: ref, text: t }); };
    var label = function (s) { return U.stepLabel(s); };
    M.steps(map).forEach(function (x) {
      var s = x.step;
      if (s.type === 'jira.search' && own(s.fields, 'results')) {
        var r = S.parseResults(s.fields.results), what = s.text + ' ' + String(s.fields.what || '');
        if (r.ok && r.op === 'any' && READINESS.test(what)) add('results-any', 'step', s.id, label(s) + ' has results: any, so it passes whatever the search finds, yet it reads like a readiness check ("' + quoted(READINESS, what) + '"). Say what must be true, like results: none or results: at least 1, or word it as collecting facts.');
      }
      if ((s.type === 'confirm' || !s.type) && WHOLE_SET.test(s.text)) add('whole-set', 'step', s.id, label(s) + ' confirms a whole set at once ("' + quoted(WHOLE_SET, s.text) + '…"). One check can\'t show which items were looked at. Give each item its own result: one step per item, or a list with one line per item in a note or report. Flightdeck can\'t repeat a step for each item yet.');
      if (s.type !== 'decide') {
        var v = quoted(VERDICT, s.text) || (!APPROVES_BY_TYPE[s.type] ? quoted(APPROVAL, s.text) : '');
        if (v) add('verdict', 'step', s.id, label(s) + ' reads like a verdict ("' + v + '"), but as a {' + (s.type || 'step') + '} step a run records only that it was checked, not which way it went. Make it a {decide} step with the choices, or a named gate when a person approves it.');
      }
    });
    var used = Object.create(null);
    var addRole = function (r) { if (r) used[r] = true; };
    map.phases.forEach(function (p) {
      p.steps.forEach(function (s) { s.roles.forEach(addRole); });
      p.tracks.forEach(function (t) { t.roles.forEach(addRole); });
      addRole(p.gate.owner);
    });
    var roles = Object.keys(used);
    if (meta.runs === 'solo' && roles.length > 1) add('solo-roles', 'checklist', null, 'This checklist says runs: solo, but its steps and gates use ' + roles.length + ' roles (' + roles.map(function (r) { return '@' + r; }).join(', ') + '). If more than one person does the work, take out runs: solo. A solo run that hands a report to someone is fine.');
    meta.roles.forEach(function (r) {
      if (!used[r] && !new RegExp('@' + r.replace(/[-]/g, '\\-') + '(?!' + NAME + ')').test(text)) add('unused-role', 'checklist', null, 'The role @' + r + ' is declared but no step or gate uses it. Use it or take it out of roles.');
    });
    var carried = Object.create(null), asksAll = false;
    M.steps(map).forEach(function (x) {
      var s = x.step;
      list(s.fields.sets).forEach(function (n) { carried[n] = true; });
      if (s.type === 'run.process') { var c = PF.links.carryList(s); if (!c.length) asksAll = true; c.forEach(function (n) { carried[n] = true; }); }
    });
    /* A linked step without carry: passes every detail its child also has, so none of them can be called unused. */
    if (!asksAll) meta.context.forEach(function (n) {
      if (!carried[n] && !new RegExp('\\^' + n.replace(/[-]/g, '\\-') + '(?!' + NAME + ')').test(text)) add('unused-detail', 'checklist', null, 'The run detail ^' + n + ' is asked for at the start but no step, gate or condition uses it. Use it or take it out of context.');
    });
    var lib = opts.library;
    if (lib) {
      /* Published checklists only: they're what teams run, and what flightdeck draft check reads too. */
      var self = opts.process || meta.process, others = lib.checklists.filter(function (c) { return c.process !== self && c.source === 'publication'; });
      var titled = function (c) { return c.title + (c.source === 'draft' ? ' (draft)' : ''); };
      M.steps(map).forEach(function (x) {
        var s = x.step; if (s.type !== 'jira.search') return;
        var n = normQuery(s.fields.query), fl = own(s.fields, 'filter') ? String(s.fields.filter).trim() : null, hits = [];
        others.forEach(function (c) { c.searches.forEach(function (o) { if ((n && o.normalized === n) || (fl && o.filter === fl)) hits.push(titled(c) + ' {#' + o.step + '}'); }); });
        if (hits.length) add('duplicate', 'step', s.id, label(s) + ' runs the same search as ' + hits.slice(0, 3).join(', ') + (hits.length > 3 ? ', and ' + (hits.length - 3) + ' more' : '') + '. If both need it, consider one shared checklist both link to; otherwise say in a note how they differ.');
      });
      map.phases.forEach(function (p) {
        var g = p.gate, pat = normApproves(g.approves); if (!pat) return;
        var hits = [];
        others.forEach(function (c) { c.gates.forEach(function (o) { if (o.pattern === pat) hits.push(titled(c) + ' {#' + o.id + '}'); }); });
        if (hits.length) add('duplicate', 'gate', g.id, 'Gate "' + g.title + '" approves the same thing as ' + hits.slice(0, 3).join(', ') + (hits.length > 3 ? ', and ' + (hits.length - 3) + ' more' : '') + '. Check whether one approval should serve both.');
      });
      if (lib.completeness.unread.some(function (u) { return /^publications(\/|$)/.test(u.path); })) add('library-unread', 'checklist', null, 'Some checklists couldn\'t be read, so searches and gates they share with this one weren\'t compared.');
    }
    return out;
  }

  return { normQuery: normQuery, normApproves: normApproves, describe: describe, entriesOf: entriesOf, inspect: inspect, forProcess: forProcess, lints: lints };
})();
