/* The flight plan: a read-only picture of a process's checklist. A vertical route from Start to Landed: each phase a row,
   its gate a checkpoint bar beneath it, tracks as parallel lanes, linked processes as connecting flights, skills built
   from this version as autopilot, and the step its runs most often leave as turbulence. Numbers come only from runs of the
   exact version shown, so another version's history never reads as evidence for this one. */
(function () {
  'use strict';
  var V = PF.views, U = PF.util, R = PF.run, T = PF.types, I = PF.icons.icon, esc = U.esc;
  var MODE = { 'READ-DO': 'Read-Do', 'DO-CONFIRM': 'Do-Confirm' };
  /* Up to this many steps in the whole checklist, every phase's steps start open; a longer one starts as an overview. */
  var OPEN_MAX = 40;

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  /* "41 min", "2 h 5 min": a typical time is approximate, so seconds would be false precision. */
  function about(ms) {
    var m = Math.round(ms / 60000), h = Math.floor(m / 60);
    if (m < 1) return 'under a minute';
    return h ? h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';
  }
  function titleOf(ctx, id) {
    var p = (ctx.processes ? ctx.processes() : []).filter(function (x) { return x.id === id; })[0];
    return p && p.title ? p.title : id;
  }
  /* What each skill says about the version shown. Autopilot only for a valid registration built from exactly this version;
     a skill built from an earlier version, shown against the current one, says so in the skill page's own words; anything
     else (a draft, a broken registration, an unrelated version) claims nothing. */
  function skillNotes(skills, pub, latest) {
    var notes = [];
    if (!pub) return notes;
    (skills || []).forEach(function (x) {
      var s = x.skill, st = (x.status || {}).s;
      if (!s || (x.errors || []).length || st === 'missing') return;
      if (s.implements === pub.info.version) notes.push({ kind: 'auto', skill: s });
      else if (pub === latest && st === 'update') notes.push({ kind: 'update', skill: s });
      else if (pub === latest && st === 'unaffected') notes.push({ kind: 'follows', skill: s });
    });
    return notes;
  }
  function noteLine(n, count) {
    var name = esc(n.skill.name);
    if (n.kind === 'auto') return '<div class="fp-line fp-auto">' + I('spark') + '<span><b>Autopilot</b> ' + name + ' covers ' + (count == null ? 'the whole process' : plural(count, 'step')) + '</span></div>';
    if (n.kind === 'update') return '<div class="fp-line fp-stale">' + I('spark') + '<span>' + name + ' needs an update</span></div>';
    return '<div class="fp-line fp-follows">' + I('spark') + '<span>' + name + ' follows v' + n.skill.implements + '</span></div>';
  }
  function gateLabel(g) { return g.implicit ? 'then a check that the phase is done' : 'then gate ' + g.title; }

  /* Whether phase i's steps are open: a phase opened or closed by hand, then Show all or Hide all, then the default.
     The choice is this browser's, per process (app.js keeps it in state.fpSteps). */
  function stepsOpen(kept, i, def) {
    if (kept && kept.p && typeof kept.p[i] === 'boolean') return kept.p[i];
    if (kept && typeof kept.d === 'boolean') return kept.d;
    return def;
  }
  /* A step's line: its type, its text (a button that opens it in the checklist, in the version shown), must-do, the skill
     built from this version that covers it, and its roles. */
  function stepLine(s, go, types, auto) {
    var t = T.get(s.type, types), by = auto.filter(function (x) { return x.skill.steps.indexOf(s.id) >= 0; }).map(function (x) { return x.skill.name; });
    var meta = (s.must ? '<span class="badge b-must">Must do</span>' : '') + (by.length ? '<span class="badge b-skill">' + I('spark') + esc(by.join(', ')) + '</span>' : '') +
      (s.roles.length ? '<span class="pv-role">@' + esc(s.roles.join(' @')) + '</span>' : '');
    return '<li>' + (t ? I(t.icon, t.label) : '<span class="ic"></span>') + '<div class="pv-body"><button type="button" class="fp-step" data-act="go" ' + go + ' data-step="' + esc(s.id) + '">' + esc(s.text) +
      '<span class="sr">. Show it in the checklist</span></button>' + (meta ? '<span class="pv-meta">' + meta + '</span>' : '') + '</div></li>';
  }
  function stepList(steps, name, line) { return '<ol class="fp-sl" aria-label="Steps in ' + esc(name) + '">' + steps.map(line).join('') + '</ol>'; }
  /* The phase's steps behind a native disclosure, lanes side by side as in the card, and the gate as the last line. */
  function stepsBlock(p, i, open, go, types, auto) {
    var musts = p.steps.filter(function (s) { return s.must; }).length;
    var line = function (s) { return stepLine(s, go, types, auto); };
    var lead = p.steps.filter(function (s) { return !s.track; }), body = '';
    if (lead.length || !p.tracks.length) body += stepList(lead, p.title, line);
    if (p.tracks.length) body += '<div class="fp-slanes">' + p.tracks.map(function (t) {
      var name = t.title || 'Track';
      return '<div class="fp-slane"><p class="fp-slane-h"><b>' + esc(name) + '</b>' + (t.roles.length ? ' <span class="pv-role">@' + esc(t.roles.join(' @')) + '</span>' : '') + '</p>' +
        stepList(p.steps.filter(function (s) { return s.track === t.id && t.id; }), name, line) + '</div>';
    }).join('') + '</div>';
    body += p.gate.implicit ? '<p class="fp-sgate">' + I('check') + '<span>Phase checked, no named gate</span></p>' : '<p class="fp-sgate">' + I('gate') + '<span>Gate: ' + esc(p.gate.title) + '</span></p>';
    return '<details class="fp-steps" data-fps="' + i + '" data-fps-open="' + (open ? 1 : 0) + '"' + (open ? ' open' : '') + '><summary id="fps-' + i + '">' + plural(p.steps.length, 'step') + (musts ? ' · ' + musts + ' must-do' : '') +
      '<span class="sr"> in ' + esc(p.title) + '</span></summary><div class="fp-sbody">' + body + '</div></details>';
  }

  function leg(ctx, map, p, i, an, notes, steps) {
    var n = map.phases.length, mode = MODE[p.mode] || '';
    var label = 'Phase ' + (i + 1) + ' of ' + n + ', ' + p.title + (mode ? ', ' + mode : '') + ', ' + plural(p.steps.length, 'step') + ', ' + gateLabel(p.gate) + '. Show it in the checklist';
    var head = '<div class="fp-head"><div class="fp-eye" aria-hidden="true">Phase ' + (i + 1) + (mode ? ' · ' + mode : '') + '</div>' +
      '<h3 class="fp-name"><button class="fp-go" data-act="flight-phase" data-id="' + i + '" aria-label="' + esc(label) + '">' + esc(p.title) + '</button></h3>';
    var time = an && p.id && an.phasesById.filter(function (x) { return x.id === p.id; })[0];
    if (time && time.medianMs != null) head += '<div class="fp-line">' + I('clock') + '<span>Typically ' + about(time.medianMs) + ' <span class="small">(' + time.n + ' of ' + plural(time.of, 'run') + ')</span>' + V.insightsQual(time.q, null, 'span') + '</span></div>';
    else if (time && time.q && time.q.cohort) head += '<div class="fp-line">' + I('clock') + '<span>No typical time yet' + V.insightsQual(time.q, null, 'span') + '</span></div>';
    /* Tracks are worked at the same time, so they sit side by side as lanes. */
    if (p.tracks.length) head += '<ul class="fp-lanes" aria-label="Parallel tracks">' + p.tracks.map(function (t) {
      var count = p.steps.filter(function (s) { return s.track === t.id; }).length;
      return '<li class="fp-lane"><b>' + esc(t.title || 'Track') + '</b>' + (t.roles.length ? '<span class="small">@' + esc(t.roles.join(' @')) + '</span>' : '') + '<span class="small">' + plural(count, 'step') + '</span></li>';
    }).join('') + '</ul>';
    head += '</div>';
    var ids = p.steps.map(function (s) { return s.id; }), lines = '';
    notes.forEach(function (x) {
      if (!x.skill.steps) return;
      var count = x.skill.steps.filter(function (id) { return ids.indexOf(id) >= 0; }).length;
      if (count) lines += noteLine(x, count);
    });
    var rough = an && an.deviated.filter(function (c) { return ids.indexOf(c.id) >= 0; })[0];
    if (rough) lines += '<div class="fp-line fp-turb">' + I('flag') + '<span><b>Turbulence</b> "' + esc(rough.text) + '" went off-script in ' + esc(PF.insights.count(rough.offScript, rough.n)) + V.insightsQual(rough.q, ['unreached'], 'span') + '</span></div>';
    p.steps.filter(function (s) { return s.type === 'run.process' && s.fields.process; }).forEach(function (s) {
      lines += '<div class="fp-line fp-conn">' + I('fork') + '<span><b>Connecting</b> ' + esc(titleOf(ctx, s.fields.process)) + '</span></div>';
    });
    return '<div class="fp-card">' + head + (lines ? '<div class="fp-lines">' + lines + '</div>' : '') +
      stepsBlock(p, i, steps.open(i), steps.go, steps.types, notes.filter(function (x) { return x.kind === 'auto' && x.skill.steps; })) + '</div>' + gate(p.gate);
  }
  /* A gate the checklist names is a checkpoint with the hazard stripe; a phase without one just ends with a check. */
  function gate(g) {
    if (g.implicit) return '<div class="fp-gate implicit"><span class="fp-gate-t">' + I('check') + 'Phase checked</span><span class="small">No named gate</span></div>';
    return '<div class="fp-gate"><span class="fp-gate-t">' + I('gate') + '<span><span class="sr">Gate: </span>' + esc(g.title) + '</span></span>' +
      (g.owner ? '<span class="small">Owner @' + esc(g.owner) + '</span>' : '') + (g.approves ? '<span class="small">Approves ' + U.mdInline(g.approves) + '</span>' : '') + '</div>';
  }

  /* shown is the checklist panel's version (V.shownOf): a publication, or the draft. */
  function flightPlan(ctx, p, map, shown) {
    if (!map.phases.length) return '<p class="small">Add a phase to see the flight plan.</p>';
    var pub = shown && shown.pub ? shown.pub : null;
    var an = pub ? R.analytics(V.insightsInput(ctx, p.id), p.id, pub.info.folder, ctx.now()) : null;
    /* Runs it couldn't count, or a load still under way, are said even when nothing could be counted. */
    var said = an ? an.notes.concat(an.excluded) : [];
    if (an && !an.runs) an = null;
    var notes = skillNotes(p.skills, pub, p.latest), meta = map.meta;
    var total = map.phases.reduce(function (n, ph) { return n + ph.steps.length; }, 0), kept = ((ctx.state || {}).fpSteps || {})[p.id];
    var steps = {
      open: function (i) { return stepsOpen(kept, i, total <= OPEN_MAX); },
      /* A step opens in the checklist through go(), in the version shown; the draft is shown when no version is named. */
      go: 'data-view="process" data-process="' + esc(p.id) + '"' + (pub ? ' data-map-ver="' + esc(pub.folder || pub.info.folder) + '"' : ''),
      types: pub ? pub.types : (ctx.data.stepTypes || {}).types
    };
    var all = map.phases.every(function (ph, i) { return steps.open(i); });
    var h = '<div class="fp-tools"><button type="button" class="mini fp-all" data-act="fp-steps" data-id="' + (all ? 'hide">Hide all steps' : 'show">Show all steps') + '</button></div><ol class="fp" aria-label="Flight plan">';
    h += '<li class="fp-end"><span class="fp-tag">Start</span>' + (meta.context.length ? '<span class="small">Asks for ' + esc(meta.context.join(', ')) + '</span>' : '') +
      notes.filter(function (x) { return !x.skill.steps; }).map(function (x) { return noteLine(x, null); }).join('') + '</li>';
    map.phases.forEach(function (ph, i) { h += '<li class="fp-leg">' + leg(ctx, map, ph, i, an, notes, steps) + '</li>'; });
    h += '<li class="fp-end"><span class="fp-tag">Landed</span>' + (an && an.medianMs != null ? '<span class="small">A completed run typically takes ' + about(an.medianMs) + ' (from ' + plural(an.completed, 'completed run') + ')</span>' : '') + (an ? V.insightsQual(an.durationQ, null, 'span') : '') + '</li>';
    /* The footer counts finished runs only; a run still going adds only what it has done so far. */
    var foot = !an ? (said.length ? 'No runs of this version could be counted.' : 'No runs of this version yet.')
      : (an.ended ? 'From ' + plural(an.ended, 'finished run') + ' of v' + pub.info.version + '.' : 'No finished runs of v' + pub.info.version + ' yet.') +
        (an.running ? ' ' + (an.running === 1 ? '1 run still going counts' : an.running + ' runs still going count') + ' only for what ' + (an.running === 1 ? 'it has' : 'they have') + ' done so far.' : '') + ' Paused time isn\'t counted.';
    return h + '</ol><p class="small">' + foot + '</p>' +
      (said.length ? '<ul class="small fp-said">' + said.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '');
  }

  V.flightPlan = flightPlan;
})();
