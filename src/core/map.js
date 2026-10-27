/* Process maps: parse the Markdown format and check it. See docs/map-format.md. */
PF.map = (function () {
  'use strict';
  var U = PF.util, T = PF.types;

  var ID_RE = /\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i;
  /* A process ID as the checklist reader accepts it (also what PF.nav accepts in a link). */
  var PROCESS_ID = /^[a-z0-9][a-z0-9-]*$/;

  function takeId(s) {
    var m = ID_RE.exec(s);
    return m ? { id: m[1].toLowerCase(), rest: s.slice(0, m.index) } : { id: '', rest: s };
  }
  function tokens(s, ch) {
    var out = [];
    var rest = s.replace(new RegExp('\\s*\\' + ch + '([\\w-]+)', 'g'), function (_, n) { out.push(n); return ''; });
    return { list: out, rest: rest.trim() };
  }

  /* Step text with its run details kept in place (2.3.1): the words and ^name references, in order, for display only.
     step.text (without references) stays what signatures, corrections, search and saved files key on. */
  function refParts(s) {
    var out = [], re = /\^([\w-]+)/g, last = 0, m;
    while ((m = re.exec(s))) { if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) }); out.push({ t: 'ref', k: m[1] }); last = re.lastIndex; }
    if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
    return out;
  }
  /* A step's text with each reference as a private-use mark (U+E000 + n), marks removed from link addresses (a detail is
     never put into a link), and the names in order: what both the plain and the HTML readers start from. */
  var MARK = /[\uE000-\uF8FF]/g;
  function marked(step) {
    var parts = step && step.textParts, names = [];
    if (!parts) return { src: String((step && step.text) || '').replace(MARK, ''), names: names };
    var src = parts.map(function (p) { return p.t === 'ref' ? (names.push(p.k), String.fromCharCode(0xE000 + names.length - 1)) : String(p.v).replace(MARK, ''); }).join('');
    src = src.replace(/\]\(([^)]*)\)/g, function (_, a) { return '](' + a.replace(MARK, '') + ')'; }).replace(/\s+\]\(/g, '](');
    return { src: src, names: names };
  }
  /* A run's details as references read them: the stored value, '' when not set or no run. */
  function valuesOf(r) { return function (k) { var v = r && r.details && Object.prototype.hasOwnProperty.call(r.details, k) ? r.details[k] : ''; return v == null ? '' : String(v); }; }
  /* Plain text: a reference becomes its value (valueOf(name), '' when not set) or ‹name›. */
  function shownText(step, valueOf) {
    var m = marked(step);
    return m.src.replace(MARK, function (c) { var k = m.names[c.charCodeAt(0) - 0xE000], v = valueOf ? valueOf(k) : ''; return v != null && String(v).trim() !== '' ? String(v) : '\u2039' + k + '\u203a'; }).replace(/\s{2,}/g, ' ').trim();
  }

  function parse(md) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    var meta = {}, phases = [], errors = [], i = 0, phase = null, step = null, gate = null, track = null, questions = false, ctxLine = -1;
    function err(n, msg) { errors.push({ line: n + 1, msg: msg }); }

    if (lines[0] && lines[0].trim() === '---') {
      for (i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
        var kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
        if (kv) { meta[kv[1]] = kv[2].trim(); if (kv[1] === 'context') ctxLine = i; }
        else if (lines[i].trim()) err(i, 'Front matter line isn\'t "key: value".');
      }
      i++;
    }
    /* Run details: a bare name is text; name:kind types it (2.0, typed-details). meta.context stays the names. */
    var typed = details(list(meta.context));
    meta.context = typed.names;
    typed.errors.forEach(function (m) { err(ctxLine < 0 ? 0 : ctxLine, m); });
    meta.roles = list(meta.roles);
    /* Where the process sits in the team's hierarchy ("Engineering / Releases"), and its tags. Without a group, its category. */
    meta.group = String(meta.group || meta.category || '').split('/').map(function (x) { return x.trim().slice(0, 60); }).filter(Boolean).slice(0, 6);
    meta.tags = list(meta.tags).map(function (t) { return t.toLowerCase().slice(0, 40); }).filter(function (t, k, all) { return all.indexOf(t) === k; }).slice(0, 20);
    /* Last, so the keys every older parse gives keep their order (the builder compares parses as JSON). */
    meta.detailTypes = typed.types;

    for (; i < lines.length; i++) {
      var line = lines[i], m;
      if (!line.trim()) continue;
      /* A track: steps worked in parallel within a phase, all finished before its gate. */
      if ((m = /^###\s+Track:\s*(.+?)\s*$/i.exec(line))) {
        step = null;
        if (!phase || gate) { err(i, 'A track must be inside a phase, before its gate.'); continue; }
        var th = takeId(m[1]), tr = tokens(th.rest, '@');
        track = { id: th.id, title: tr.rest, roles: tr.list, line: i + 1 };
        phase.tracks.push(track);
        continue;
      }
      if ((m = /^##\s+(.+?)\s*$/.exec(line))) {
        step = null; gate = null; track = null;
        var head = takeId(m[1]);
        if (/^questions\b/i.test(head.rest)) { questions = true; phase = null; continue; }
        var g = /^Gate:\s*(.+)$/i.exec(head.rest);
        if (g) {
          if (!phase) { err(i, 'A gate must come after a phase.'); continue; }
          if (phase.gate && !phase.gate.implicit) { err(i, 'Phase "' + phase.title + '" already has a gate.'); continue; }
          var parts = g[1].split(/\s+·\s+/), owner = null;
          parts.slice(1).forEach(function (p) { var o = /^owner\s+@([\w-]+)$/i.exec(p.trim()); if (o) owner = o[1]; else err(i, 'Gate option not understood: "' + p + '".'); });
          gate = { id: head.id, title: parts[0].trim(), owner: owner, approves: '', binds: [], note: '', shots: [], implicit: false, fields: {} };
          phase.gate = gate;
          continue;
        }
        var pm = /^(.*?)\s+·\s+(READ-DO|DO-CONFIRM)$/.exec(head.rest);
        phase = { id: head.id, title: (pm ? pm[1] : head.rest).trim(), mode: pm ? pm[2] : '', note: '', shots: [], steps: [], tracks: [], gate: null, line: i + 1 };
        phases.push(phase);
        continue;
      }
      if (questions) continue;
      if ((m = /^- \[( |!|~)\]\s+(.+)$/.exec(line))) {
        if (!phase || gate) { err(i, 'A step must be inside a phase, before its gate.'); continue; }
        var body = takeId(m[2]), typ = '', t2 = body.rest;
        var tm = /^\{([a-z][\w.-]*)\}\s+(.*)$/i.exec(t2);
        if (tm) { typ = tm[1]; t2 = tm[2]; }
        var roles = tokens(t2, '@'), binds = tokens(roles.rest, '^');
        step = { id: body.id, type: typ, text: binds.rest, textParts: refParts(roles.rest.trim()), must: m[1] === '!', planned: m[1] === '~', roles: roles.list, binds: binds.list, fields: {}, note: '', shots: [], line: i + 1, track: track ? track.id : '' };
        /* A step in a track with no @role of its own belongs to the track's people. */
        if (track && !step.roles.length) step.roles = track.roles.slice();
        phase.steps.push(step);
        continue;
      }
      /* A condition (2.1): "only when ^risk is high" under a phase heading (before its first step or track) or a step. Older
         copies refuse the line as not understood. */
      if ((m = /^\s{2,}only when\b\s*(.*)$/i.exec(line))) {
        var target = step || (phase && !gate && !track ? phase : null);
        if (!target) { err(i, gate ? 'A gate can\'t have "only when"; put it on the phase or its steps.' : track ? 'A track can\'t have "only when"; put it on its steps or on the phase.' : '"only when" must come right under a phase heading or a step.'); continue; }
        var cond = PF.conditions.parse(m[1], meta.context, meta.detailTypes);
        if (cond.why) { err(i, cond.why); continue; }
        if ((target.when || []).length >= PF.conditions.MAX) { err(i, 'A ' + (target === step ? 'step' : 'phase') + ' can have at most ' + PF.conditions.MAX + ' "only when" lines.'); continue; }
        cond.test.line = i + 1;
        (target.when = target.when || []).push(cond.test);
        continue;
      }
      /* Notes and screenshots belong to the step or gate above, or to the phase when they come right under its heading, before
         its first step or track (2.0: phase notes, phase and gate screenshots; older copies refuse those lines). */
      var owner2 = step || gate || (phase && !track ? phase : null);
      if ((m = /^\s{2,}>\s?(.*)$/.exec(line))) {
        if (!owner2) { err(i, 'A note must follow a phase heading, a step or a gate.'); continue; }
        owner2.note += (owner2.note ? '\n' : '') + m[1];
        /* A phase's note line is 2.0 syntax even when it's empty: older copies refuse the line, not its text. */
        if (owner2 === phase && !step && !gate) phase.noted = true;
        continue;
      }
      if (owner2 && (m = /^\s{2,}!\[(.*?)\]\(([^)\s]+)\)\s*$/.exec(line))) {
        if (!/^images\/[\w./-]+$/.test(m[2]) || m[2].indexOf('..') >= 0) { err(i, 'Screenshots must be under images/: "' + m[2] + '".'); continue; }
        owner2.shots.push({ caption: m[1], src: m[2] });
        continue;
      }
      if ((m = /^\s{2,}([\w-]+):\s*(.*)$/.exec(line))) {
        if (gate && m[1] === 'approves') { var ab = tokens(m[2], '^'); gate.approves = m[2].trim(); gate.binds = ab.list; continue; }
        if (gate && (m[1] === 'at' || m[1] === 'due' || m[1] === 'after')) { gate.fields[m[1]] = m[2].trim(); continue; }
        if (step) { step.fields[m[1]] = m[2].trim(); continue; }
      }
      err(i, 'Not understood, so it was skipped: "' + line.trim().slice(0, 60) + '"');
    }

    /* Forward only (2.1): a condition may test a detail a step sets (sets:) only when that step is in an earlier phase, so
       whether something applies is known before anyone reaches it. */
    phases.forEach(function (p, pi) {
      var later = function (name) { return phases.slice(pi).some(function (q) { return q.steps.some(function (s) { return list(s.fields.sets).indexOf(name) >= 0; }); }); };
      [p].concat(p.steps).forEach(function (t) { (t.when || []).forEach(function (w) { if (later(w.name)) err(w.line - 1, '^' + w.name + ' is set in this phase or a later one (sets:), so it can\'t decide whether this applies. Only a step in an earlier phase can set it.'); }); });
    });
    errors.sort(function (a, b) { return a.line - b.line; });
    phases.forEach(function (p) {
      if (!p.gate) p.gate = { id: p.id ? p.id + '-confirm' : '', title: 'Confirm ' + p.title, owner: null, approves: '', binds: [], note: '', shots: [], implicit: true, fields: {} };
    });
    return { meta: meta, phases: phases, errors: errors, questions: questions };
  }

  function list(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  /* The kinds a run detail can have after its name (name:kind), as checklists spell them. */
  var DETAIL_KINDS = { number: 1, 'yes-no': 1, date: 1, link: 1 }, OPTIONS_MAX = 20, OPTION_MAX = 40;
  /* context: entries as names, the typed ones' kinds (prototype-free), and what's wrong with any declaration. Only the first
     ":" splits a name from its kind; a choice's options are between parentheses, separated by "|", and can't hold
     , | ( ) : or start or end with a space (there is no escaping, so nothing needs unescaping). */
  function details(entries) {
    var names = [], types = Object.create(null), errors = [];
    entries.forEach(function (e) {
      var at = e.indexOf(':');
      if (at < 0) { names.push(e); return; }
      var name = e.slice(0, at).trim(), spec = e.slice(at + 1).trim(), what = 'Run detail "' + name.slice(0, 60) + '"';
      names.push(name);
      if (spec === 'text') { errors.push(what + ' is text already; write just ' + name.slice(0, 60) + '.'); return; }
      if (Object.prototype.hasOwnProperty.call(DETAIL_KINDS, spec)) { types[name] = { kind: spec }; return; }
      var c = /^choice\((.*)\)$/.exec(spec);
      if (!c) { errors.push(what + ': "' + spec.slice(0, 60) + '" isn\'t a kind. Use number, yes-no, date, link or choice(a|b).'); return; }
      var opts = c[1].split('|'), bad = '';
      opts.forEach(function (o) {
        if (bad) return;
        if (!o) bad = what + ': an option is empty.';
        else if (/[,|():]/.test(o)) bad = what + ': the option "' + o.slice(0, 40) + '" has "' + /[,|():]/.exec(o)[0] + '", which an option can\'t hold.';
        else if (o !== o.trim()) bad = what + ': the option "' + o.slice(0, 40) + '" starts or ends with a space; remove it.';
        else if (o.length > OPTION_MAX) bad = what + ': the option "' + o.slice(0, 40) + '…" is longer than ' + OPTION_MAX + ' characters; an option can be at most 40 characters.';
      });
      if (!bad && opts.length < 2) bad = what + ': a choice needs at least two options, like choice(dev|prod).';
      if (!bad && opts.length > OPTIONS_MAX) bad = what + ': a choice can have at most 20 options.';
      var clash = !bad && PF.values.foldClash(opts);
      if (clash) bad = what + ': ' + clash[0] + ' and ' + clash[1] + ' differ only in capitals; keep one.';
      if (bad) { errors.push(bad); return; }
      types[name] = { kind: 'choice', options: opts };
    });
    /* A name listed twice can hold only one kind: when either entry has one, it's an error (bare duplicates stay allowed). */
    var count = Object.create(null), kinded = Object.create(null);
    entries.forEach(function (e) { var n = e.indexOf(':') < 0 ? e : e.slice(0, e.indexOf(':')).trim(); count[n] = (count[n] || 0) + 1; if (e.indexOf(':') >= 0) kinded[n] = true; });
    Object.keys(count).forEach(function (n) { if (count[n] > 1 && kinded[n]) { errors.push('Run detail "' + n.slice(0, 60) + '" is listed twice; list it once.'); delete types[n]; } });
    return { names: names, types: types, errors: errors };
  }

  function steps(map) {
    var out = [];
    map.phases.forEach(function (p, pi) { p.steps.forEach(function (s) { out.push({ phase: p, phaseIndex: pi, step: s }); }); });
    return out;
  }
  function findStep(map, id) { var all = steps(map); for (var i = 0; i < all.length; i++) if (all[i].step.id === id) return all[i]; return null; }

  var FLUFF = /^(make sure|ensure|don't forget|remember to|be sure)\b/i;

  /* blockers: the map can't be published or run. suggestions: advice only. */
  function check(map, opts) {
    opts = opts || {};
    var blockers = map.errors.map(function (e) { return 'Line ' + e.line + ': ' + e.msg; }), suggestions = [], ids = {};
    var meta = map.meta;
    if (!meta.process) blockers.push('Front matter needs "process" (the process ID, like release).');
    else if (!PROCESS_ID.test(meta.process)) blockers.push('"process" must be lowercase letters, numbers and dashes.');
    if (!meta.title) blockers.push('Front matter needs a title.');
    /* A format: or features: line is never a minimum by itself (every older copy publishes it as ordinary text). */
    var env = PF.envelope.markdown(meta, map);
    if (!env.ok) blockers.push(env.why);
    /* Within what a run file keeps (a child run's record of its details included), so nothing a map declares is lost on reload. */
    if (meta.context.length > 40) blockers.push('"context" lists ' + meta.context.length + ' run details; the most a checklist can have is 40.');
    /* Names JavaScript objects already use (like __proto__ or constructor) would be lost or mixed up when a run stores them. */
    var reserved = function (n) { return n === '__proto__' || n in Object.prototype; };
    meta.context.forEach(function (f) { if (reserved(f)) blockers.push('Run detail "' + f + '" is a name Flightdeck keeps for itself; choose another.'); });
    meta.roles.forEach(function (f) { if (reserved(f)) blockers.push('Role "' + f + '" is a name Flightdeck keeps for itself; choose another.'); });
    meta.context.forEach(function (f) { if (!/^[\w-]{1,60}$/.test(f)) blockers.push('Run detail "' + f.slice(0, 70) + '" must be letters, numbers, dashes or underscores, at most 60 characters.'); });
    if (meta.runs && meta.runs !== 'solo' && meta.runs !== 'team') blockers.push('"runs" should be solo or team.');
    if (map.questions) blockers.push('It still has a "Questions" section. Answer the questions and remove it first.');
    if (!map.phases.length) blockers.push('There are no phases. Start one with "## Name · READ-DO {#id}".');
    function useId(id, what) {
      if (!id) { blockers.push(what + ' needs an ID, like {#' + U.slug(what.replace(/^.*"(.*)".*$/, '$1'), 24) + '}.'); return; }
      if (id.length > 60) blockers.push('The ID "' + id.slice(0, 40) + '…" is longer than 60 characters; shorten it.');
      if (ids[id]) blockers.push('The ID "' + id + '" is used twice.');
      ids[id] = true;
    }
    function checkRoles(roles, what) { roles.forEach(function (r) { if (meta.roles.indexOf(r) < 0) blockers.push(what + ' uses @' + r + ', which isn\'t listed in roles.'); }); }
    var meant = function (f) { var g = PF.refs ? PF.refs.suggest(f, meta.context) : ''; return g ? ' Did you mean ^' + g + '?' : ''; };
    function checkBinds(binds, what) { binds.forEach(function (f) { if (meta.context.indexOf(f) < 0) blockers.push(what + ' is tied to ^' + f + ', which isn\'t listed in context.' + meant(f)); }); }
    var musts = 0;
    /* With the team's Jira workflows (jira/workflows.json), a transition must name a status that exists and that some transition reaches. */
    function jiraCheck(s, label) {
      if (String(s.fields.action || '').toLowerCase() !== 'transition' || !s.fields.status) return;
      var fp = PF.jira.fileProblem(opts.workflows);
      if (fp) { blockers.push(label + ': jira/workflows.json can\'t be read (' + fp + '), so this transition can\'t be checked. Fix the file first.'); return; }
      var wf = PF.jira.forType(opts.workflows, s.fields.issueType);
      if (wf && wf.workflow.invalid) { blockers.push(label + ': the ' + wf.type + ' workflow in jira/workflows.json has errors, so this transition can\'t be checked. Fix the file first.'); return; }
      if (!wf) { if (s.fields.issueType) suggestions.push(label + ': the Jira workflows don\'t describe "' + s.fields.issueType + '" issues.'); else suggestions.push(label + ': add "issueType:" so the move to "' + s.fields.status + '" can be checked against your Jira workflow.'); return; }
      if (wf.workflow.statuses.indexOf(s.fields.status) < 0) blockers.push(label + ': "' + s.fields.status + '" isn\'t a status in the ' + wf.type + ' workflow (' + wf.workflow.statuses.join(', ') + ').');
      else if (!PF.jira.into(wf.workflow, s.fields.status).length) blockers.push(label + ': no transition in the ' + wf.type + ' workflow leads to "' + s.fields.status + '".');
    }
    /* What a linked step passes to its child (2.8, docs/design.md 40). Its own sources always; against the child's details when
       opts.children(process, version) says what the child is: { map, title, version, latest } (latest: no version: line, so
       the child's latest), { unpublished: true }, or { unreadable: why }. While editing these come from memory (advice);
       publishing and staging pass the children just read from the folder. A step with neither pass: nor carry: names nothing,
       so it isn't checked; a carry-only step whose child can't be read publishes as in 2.7 (run time still refuses it). */
    function linkChecks(s, label) {
      var L = PF.links, pe = L.parse(s.fields.pass).entries, carry = L.carryList(s), own = list(s.fields.sets);
      pe.forEach(function (e) {
        if (carry.indexOf(e.name) >= 0) blockers.push(label + ' gives ^' + e.name + ' in both carry: and pass:. Keep one.');
        if (e.source !== 'detail') return;
        if (meta.context.indexOf(e.from) < 0) blockers.push(label + ' passes ^' + e.from + ', which isn\'t listed in context.' + meant(e.from));
        else if (own.indexOf(e.from) >= 0) blockers.push(label + ' passes ^' + e.from + ' and sets it; a step can\'t start its child with a value it produces.');
      });
      /* Team values (2.9): opts.teamValues is team-values.json as PF.teamValues.parse (or repo.readTeamValues) gave it. A
         caller that doesn't give it (older ones) gets no team check here. */
      if (opts.teamValues) L.teams(s).forEach(function (n) {
        var lk = PF.teamValues.lookup(opts.teamValues, n);
        if (lk.missing) blockers.push('"' + n + '" isn\'t a team value in this folder. Add it in Settings › Team values, or pass something else.');
        else if (!Object.prototype.hasOwnProperty.call(lk, 'value')) blockers.push(String(lk.why || 'team-values.json can\'t be read.').replace(/\.?$/, '.') + ' So the team value "' + n + '" can\'t be checked.');
      });
      var got = typeof opts.children === 'function' ? opts.children(s.fields.process, s.fields.version || '') : null;
      if (!got || (!L.has(s) && !carry.length)) return;
      if (got.unreadable) { if (L.has(s)) blockers.push(label + ': ' + got.unreadable + ' So what it passes to "' + s.fields.process + '" can\'t be checked.'); return; }
      if (got.unpublished || !got.map) { if (L.has(s)) suggestions.push(label + ': "' + s.fields.process + '" isn\'t published yet, so what it needs can\'t be checked.'); return; }
      var who = got.latest ? (got.title || s.fields.process) + '\'s latest version (v' + got.version + ')' : (got.title || s.fields.process) + ' v' + got.version;
      var A = { text: 'text', number: 'a number', 'yes-no': 'yes or no', choice: 'a choice', date: 'a date', url: 'a link' }, kw = function (d) { return A[PF.values.kindOf(d)] || 'text'; };
      var r = L.rows(s, meta.context, got.map), kinds = got.map.meta.detailTypes || {}, mine = meta.detailTypes || {};
      r.stale.forEach(function (x) { blockers.push(who + ' has no run detail ' + x.name + ', so ' + label.charAt(0).toLowerCase() + label.slice(1) + ' can\'t pass it. Choose one it has, or remove it from ' + x.where + ':.'); });
      r.rows.forEach(function (x) {
        var def = Object.prototype.hasOwnProperty.call(kinds, x.name) ? kinds[x.name] : null;
        if (x.source === 'value' && def) { var v = PF.values.parse(def, x.value, { max: 120 }); if (!v.ok) blockers.push(label + ': ' + who + '\'s ^' + x.name + ' is ' + kw(def) + '; "' + x.value + '" isn\'t one. ' + v.why); }
        if (x.source === 'detail' && def && PF.values.kindOf(def) !== 'text') {
          var from = Object.prototype.hasOwnProperty.call(mine, x.from) ? mine[x.from] : null;
          if (!from || PF.values.kindOf(from) !== PF.values.kindOf(def)) suggestions.push(label + ': ^' + x.from + ' goes into ' + who + '\'s ^' + x.name + ', which is ' + kw(def) + '. Converted when it starts; a value that doesn\'t fit is asked there.');
        }
        if (x.source === 'team' && def && PF.values.kindOf(def) !== 'text' && opts.teamValues) {
          var tl = PF.teamValues.lookup(opts.teamValues, x.team), tm = Object.prototype.hasOwnProperty.call(tl, 'value') ? PF.values.migrate(def, tl.value) : null;
          if (tm && tm.verdict !== 'exact' && tm.verdict !== 'converted') suggestions.push(label + ': the team value "' + x.team + '" goes into ' + who + '\'s ^' + x.name + ', which is ' + kw(def) + '. "' + tl.value + '" isn\'t one, so it\'s asked when the child starts.');
        }
        if (x.childSets && x.source !== 'ask' && L.has(s)) suggestions.push(label + ' passes ^' + x.name + ', which ' + (got.title || s.fields.process) + ' also sets itself later.');
      });
    }
    /* C3: published checklists that start this one at its latest and pass it a detail this draft no longer has (opts.parents:
       [{ id, latest }], the processes as the app lists them). Advice: they keep working until this is published. */
    if (opts.parents && meta.process) PF.links.parentsBroken(map, opts.parents).forEach(function (b) {
      suggestions.push(b.title + ' (published) step "' + b.step.text.slice(0, 40) + '" passes ^' + b.names.join(', ^') + ' to this checklist. After this version, new ' + b.title + ' runs can\'t start that child until ' + b.title + ' changes.');
    });
    map.phases.forEach(function (p) {
      useId(p.id, 'Phase "' + p.title + '"');
      if (!p.mode) suggestions.push('Give "' + p.title + '" a type: READ-DO (read each step, then do it) or DO-CONFIRM (do the work, then confirm together).');
      if (!p.steps.length) blockers.push('Phase "' + p.title + '" has no steps.');
      p.tracks.forEach(function (t) {
        useId(t.id, 'Track "' + t.title + '"');
        if (!t.title) blockers.push('A track in "' + p.title + '" needs a name.');
        checkRoles(t.roles, 'Track "' + t.title + '"');
        if (!p.steps.some(function (s) { return s.track === t.id; })) blockers.push('Track "' + t.title + '" has no steps.');
      });
      if (p.steps.length > 9) suggestions.push('"' + p.title + '" has ' + p.steps.length + ' steps. Keep a phase under 10, or split it at a natural stopping point.');
      p.steps.forEach(function (s) {
        var label = 'Step "' + s.text.slice(0, 40) + '"';
        useId(s.id, label);
        if (s.must) musts++;
        if (!s.type) blockers.push(label + ' has no type. Every step needs one, like {confirm} or {ui.action}.');
        else {
          var def = T.get(s.type, opts.types);
          if (!def) blockers.push(label + ' has an unknown type {' + s.type + '}.');
          else {
            if (['at', 'due', 'after'].filter(function (f) { return s.fields[f]; }).length > 1) blockers.push(label + ': give one time, "at:", "due:" or "after:", not more than one.');
            var fc = T.checkFields(def, s.fields);
            fc.errors.forEach(function (m) { blockers.push(label + ' ' + m); });
            fc.tips.forEach(function (m) { suggestions.push(label + ' ' + m); });
          }
        }
        if (s.fields.expect && PF.util.duration(s.fields.expect) == null) blockers.push(label + ': "expect" should look like 20m or 1h30m.');
        if (s.fields.deadline && s.fields.deadline !== 'external' && PF.util.duration(s.fields.deadline) == null) blockers.push(label + ': "deadline" should be "external" or a duration like 30m.');
        checkRoles(s.roles, label); checkBinds(s.binds, label);
        list(s.fields.sets).forEach(function (f) { if (meta.context.indexOf(f) < 0) blockers.push(label + ' sets ^' + f + ', which isn\'t listed in context.'); });
        if (s.type === 'run.process') list(s.fields.sets).forEach(function (f) { if (list(s.fields.carry).indexOf(f) >= 0) blockers.push(label + ' both passes on and sets ^' + f + '; a step can\'t start its child with a value it produces.'); });
        var sk = {}; list(s.fields.sets).forEach(function (f) { var k = U.slug(f, 20) + U.hash(f); if (sk[k]) blockers.push(label + ' sets ^' + sk[k] + ' and ^' + f + ', which are too alike to tell apart; rename one.'); sk[k] = f; });
        if (s.type === 'run.process' && s.fields.process) {
          if (s.fields.process === meta.process) blockers.push(label + ' can\'t start a run of its own process.');
          else if (opts.processes && opts.processes.indexOf(s.fields.process) < 0) suggestions.push(label + ' starts "' + s.fields.process + '", which isn\'t published yet.');
          list(s.fields.carry).forEach(function (f) { if (meta.context.indexOf(f) < 0) blockers.push(label + ' passes on ^' + f + ', which isn\'t listed in context.'); });
          if (PF.links) linkChecks(s, label);
        }
        if (s.type === 'jira.issue' && opts.workflows) jiraCheck(s, label);
        var words = s.text.split(/\s+/).length;
        if (words > 12) suggestions.push(label + ' is ' + words + ' words. Move the explanation into a note.');
        if (FLUFF.test(s.text)) suggestions.push(label + ' starts with filler. Name the action or the state to confirm.');
      });
      if (p.gate.fields && p.gate.fields.after && U.duration(p.gate.fields.after) == null) blockers.push('Gate "' + p.gate.title + '": "after" should be a duration like 2h or 30m.');
      if (p.gate.fields && ['at', 'due', 'after'].filter(function (f) { return p.gate.fields[f]; }).length > 1) blockers.push('Gate "' + p.gate.title + '": give one time, "at:", "due:" or "after:", not more than one.');
      ['at', 'due'].forEach(function (f) { var v = p.gate.fields && p.gate.fields[f]; if (v && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(v)) blockers.push('Gate "' + p.gate.title + '": "' + f + '" should be a time like 15:00.'); });
      if (p.gate.implicit) { if (p.gate.id && ids[p.gate.id]) blockers.push('The ID "' + p.gate.id + '" is used twice (it\'s the automatic gate ID for "' + p.title + '").'); else if (p.gate.id) ids[p.gate.id] = true; }
      else {
        useId(p.gate.id, 'Gate "' + p.gate.title + '"');
        if (p.gate.owner) checkRoles([p.gate.owner], 'Gate "' + p.gate.title + '"');
        checkBinds(p.gate.binds, 'Gate "' + p.gate.title + '"');
      }
    });
    /* References (2.7): a ^word in a field that isn't a run detail stays as written in a run; a detail used where it may not have
       a value yet shows "(name not set)". Advice only; step text and approves are already checked above. */
    if (PF.refs) {
      var said = Object.create(null);
      PF.refs.scan(map, { types: opts.types }).forEach(function (u) {
        var w = u.where, v = u.verdict, label = w.kind === 'gate' ? 'Gate "' + w.gate.title + '"' : 'Step "' + w.step.text.slice(0, 40) + '"';
        var inBox = w.box.indexOf('field:') === 0 ? ' in "' + w.box.slice(6) + '"' : '', key = label + '|' + w.box + '|' + u.name;
        if (said[key] || (v.v === 'unknown' && !inBox) || v.v === 'ok') return;
        said[key] = true;
        if (v.v === 'unknown') { suggestions.push(label + ': ^' + u.name + inBox + ' isn\'t a run detail, so a run shows it as written.' + meant(u.name)); return; }
        var s0 = v.setters[0], cond = s0.when.length ? ' (only when ' + s0.when.join(' and ') + ')' : '';
        suggestions.push(label + ': ^' + u.name + inBox + ' may not be set yet here: “' + s0.text.slice(0, 40) + '” sets it ' + (s0.phase === w.phaseIndex ? 'in this phase' : 'in a later phase') + cond + '.');
      });
    }
    if (map.phases.length && !musts) suggestions.push('No must-do steps. Mark the steps whose omission causes real harm with [!].');
    if (opts.people && meta.owner && !opts.people.some(function (p) { return p.id === meta.owner; })) suggestions.push('Owner "' + meta.owner + '" isn\'t in people.json.');
    /* The backup owner signs off only while the owner is away, so it must be someone else on the team. */
    if (meta.backup && meta.backup === meta.owner) suggestions.push('The backup owner is the owner. Name someone else as backup:, or leave it out.');
    else if (opts.people && meta.backup && !opts.people.some(function (p) { return p.id === meta.backup; })) suggestions.push('Backup owner "' + meta.backup + '" isn\'t in people.json.');
    return { blockers: blockers, suggestions: suggestions };
  }

  /* Which steps set each run detail (sets:), so the start form can leave those for the run. */
  function setBy(map) {
    var out = Object.create(null);
    steps(map).forEach(function (x) { list(x.step.fields.sets).forEach(function (f) { (out[f] = out[f] || []).push(x.step); }); });
    return out;
  }
  /* The 2.0 features a checklist's own lines use, in the frozen order: what makes its version preflight-publication/2. A gate
     note isn't one (every copy since 1.10 publishes it). A version: or skillVersion: line on another step type is an error,
     not a feature. */
  function features(map) {
    var has = { 'team-values': false, 'passed-details': false, conditions: false, 'typed-details': false, 'typed-evidence': false, 'phase-notes': false, 'phase-shots': false, 'gate-shots': false, 'pinned-children': false, 'pinned-skills': false };
    /* Typed data (2.0): a run detail with a kind, or a plain step asking for a number, yes/no or date as its evidence. */
    if (map.meta && map.meta.detailTypes && Object.keys(map.meta.detailTypes).length) has['typed-details'] = true;
    (map.phases || []).forEach(function (p) {
      p.steps.forEach(function (s) { if (PF.values.isNew(String(s.fields.evidence || '').trim().toLowerCase())) has['typed-evidence'] = true; });
      /* Pins (2.0): version: on a linked step, skillVersion: on a skill step. Older copies refuse both lines. */
      p.steps.forEach(function (s) {
        if (s.type === 'run.process' && Object.prototype.hasOwnProperty.call(s.fields, 'version')) has['pinned-children'] = true;
        /* What a linked step passes (2.8): a pass: line. Older copies refuse it as a field their type doesn't have. */
        if (s.type === 'run.process' && Object.prototype.hasOwnProperty.call(s.fields, 'pass')) has['passed-details'] = true;
        /* A team value passed to the child (2.9): pass: name=team:<value>. Older copies would read team: as an error. */
        if (s.type === 'run.process' && PF.links.teams(s).length) has['team-values'] = true;
        if (s.type === 'run.skill' && Object.prototype.hasOwnProperty.call(s.fields, 'skillVersion')) has['pinned-skills'] = true;
      });
      if (p.note || p.noted) has['phase-notes'] = true;
      /* Conditions (2.1): an "only when" line on the phase or a step. */
      if (p.when || p.steps.some(function (s) { return !!s.when; })) has.conditions = true;
      if (p.shots && p.shots.length) has['phase-shots'] = true;
      if (p.gate && p.gate.shots && p.gate.shots.length) has['gate-shots'] = true;
    });
    return PF.envelope.FROZEN.filter(function (f) { return has[f]; });
  }
  /* Every screenshot a checklist names, once each, in order: steps', phases' and gates'. */
  function shotSources(map) {
    var out = [], add = function (list) { (list || []).forEach(function (sh) { if (out.indexOf(sh.src) < 0) out.push(sh.src); }); };
    (map.phases || []).forEach(function (p) { add(p.shots); p.steps.forEach(function (s) { add(s.shots); }); add(p.gate && p.gate.shots); });
    return out;
  }
  function usedTypes(map) {
    var seen = {};
    steps(map).forEach(function (x) { if (x.step.type) seen[x.step.type] = true; });
    return Object.keys(seen).sort();
  }

  /* A draft with front-matter values set ({ owner: 'person-riley' }), changing only those lines. A key without a line is
     added at the end of the front matter; a draft without front matter gets one. The rest of the text, line endings
     included, stays exactly as it was. */
  function withMeta(md, set) {
    var text = String(md || ''), keys = Object.keys(set || {}).filter(function (k) { return /^[\w-]+$/.test(k) && set[k] != null; });
    function line(k) { return k + ': ' + String(set[k]).replace(/[\r\n]+/g, ' ').trim(); }
    if (!keys.length) return text;
    var m = /^---[ \t]*(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(text);
    if (!m || m.index !== 0) return '---\n' + keys.map(line).join('\n') + '\n---\n' + text;
    var nl = m[1], head = m[2], at = 3 + text.slice(3).indexOf(nl) + nl.length;
    keys.forEach(function (k) {
      var re = new RegExp('^' + k + ':.*$', 'm');
      head = re.test(head) ? head.replace(re, function () { return line(k); }) : head + line(k) + nl;
    });
    return text.slice(0, at) + head + text.slice(at + m[2].length);
  }

  return { PROCESS_ID: PROCESS_ID, MARK: MARK, marked: marked, shownText: shownText, valuesOf: valuesOf, parse: parse, check: check, features: features, shotSources: shotSources, steps: steps, setBy: setBy, findStep: findStep, usedTypes: usedTypes, withMeta: withMeta };
})();
