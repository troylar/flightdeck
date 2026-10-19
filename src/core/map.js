/* Process maps: parse the Markdown format and check it. See docs/map-format.md. */
PF.map = (function () {
  'use strict';
  var U = PF.util, T = PF.types;

  var ID_RE = /\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i;

  function takeId(s) {
    var m = ID_RE.exec(s);
    return m ? { id: m[1].toLowerCase(), rest: s.slice(0, m.index) } : { id: '', rest: s };
  }
  function tokens(s, ch) {
    var out = [];
    var rest = s.replace(new RegExp('\\s*\\' + ch + '([\\w-]+)', 'g'), function (_, n) { out.push(n); return ''; });
    return { list: out, rest: rest.trim() };
  }

  function parse(md) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    var meta = {}, phases = [], errors = [], i = 0, phase = null, step = null, gate = null, track = null, questions = false;
    function err(n, msg) { errors.push({ line: n + 1, msg: msg }); }

    if (lines[0] && lines[0].trim() === '---') {
      for (i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
        var kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
        if (kv) meta[kv[1]] = kv[2].trim();
        else if (lines[i].trim()) err(i, 'Front matter line isn\'t "key: value".');
      }
      i++;
    }
    meta.context = list(meta.context);
    meta.roles = list(meta.roles);
    /* Where the process sits in the team's hierarchy ("Engineering / Releases"), and its tags. Without a group, its category. */
    meta.group = String(meta.group || meta.category || '').split('/').map(function (x) { return x.trim().slice(0, 60); }).filter(Boolean).slice(0, 6);
    meta.tags = list(meta.tags).map(function (t) { return t.toLowerCase().slice(0, 40); }).filter(function (t, k, all) { return all.indexOf(t) === k; }).slice(0, 20);

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
          gate = { id: head.id, title: parts[0].trim(), owner: owner, approves: '', binds: [], note: '', implicit: false, fields: {} };
          phase.gate = gate;
          continue;
        }
        var pm = /^(.*?)\s+·\s+(READ-DO|DO-CONFIRM)$/.exec(head.rest);
        phase = { id: head.id, title: (pm ? pm[1] : head.rest).trim(), mode: pm ? pm[2] : '', steps: [], tracks: [], gate: null, line: i + 1 };
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
        step = { id: body.id, type: typ, text: binds.rest, must: m[1] === '!', planned: m[1] === '~', roles: roles.list, binds: binds.list, fields: {}, note: '', shots: [], line: i + 1, track: track ? track.id : '' };
        /* A step in a track with no @role of its own belongs to the track's people. */
        if (track && !step.roles.length) step.roles = track.roles.slice();
        phase.steps.push(step);
        continue;
      }
      if ((m = /^\s{2,}>\s?(.*)$/.exec(line))) {
        var target = step || gate;
        if (!target) { err(i, 'A note must follow a step or a gate.'); continue; }
        target.note += (target.note ? '\n' : '') + m[1];
        continue;
      }
      if (step && (m = /^\s{2,}!\[(.*?)\]\(([^)\s]+)\)\s*$/.exec(line))) {
        if (!/^images\/[\w./-]+$/.test(m[2]) || m[2].indexOf('..') >= 0) { err(i, 'Screenshots must be under images/: "' + m[2] + '".'); continue; }
        step.shots.push({ caption: m[1], src: m[2] });
        continue;
      }
      if ((m = /^\s{2,}([\w-]+):\s*(.*)$/.exec(line))) {
        if (gate && m[1] === 'approves') { var ab = tokens(m[2], '^'); gate.approves = m[2].trim(); gate.binds = ab.list; continue; }
        if (gate && (m[1] === 'at' || m[1] === 'due' || m[1] === 'after')) { gate.fields[m[1]] = m[2].trim(); continue; }
        if (step) { step.fields[m[1]] = m[2].trim(); continue; }
      }
      err(i, 'Not understood, so it was skipped: "' + line.trim().slice(0, 60) + '"');
    }

    phases.forEach(function (p) {
      if (!p.gate) p.gate = { id: p.id ? p.id + '-confirm' : '', title: 'Confirm ' + p.title, owner: null, approves: '', binds: [], note: '', implicit: true, fields: {} };
    });
    return { meta: meta, phases: phases, errors: errors, questions: questions };
  }

  function list(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

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
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(meta.process)) blockers.push('"process" must be lowercase letters, numbers and dashes.');
    if (!meta.title) blockers.push('Front matter needs a title.');
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
    function checkBinds(binds, what) { binds.forEach(function (f) { if (meta.context.indexOf(f) < 0) blockers.push(what + ' is tied to ^' + f + ', which isn\'t listed in context.'); }); }
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

  return { parse: parse, check: check, steps: steps, setBy: setBy, findStep: findStep, usedTypes: usedTypes, withMeta: withMeta };
})();
