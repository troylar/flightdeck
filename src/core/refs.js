/* Run-detail references (2.7): every ^name a checklist's boxes use, and whether a run has a value for it there. Pure, ES5.
   The token rule is run.js fill()'s, so the editor marks exactly what a run fills in. A run answers the steps of an open
   phase in any order and its tracks side by side, so only a step in an earlier phase guarantees a value; a step earlier in
   the same phase is quiet (fine when the steps are done in order), anything else may not be set yet (docs/design.md 39). */
PF.refs = (function () {
  'use strict';
  var M = PF.map, T = PF.types;
  var TOKEN = /\^([\w-]+)/g;
  /* Fields a run never fills in: they shape the step or name other things (sets: and carry: list bare names). Pins have
     their own kind, so they're never filled either. */
  var SKIP = { sets: 1, carry: 1, pass: 1, process: 1, expect: 1, deadline: 1, evidence: 1, require: 1, at: 1, due: 1, after: 1 };
  /* Field kinds whose text a run shows with its details filled in. */
  var KINDS = { text: 1, code: 1, message: 1, url: 1, list: 1 };

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function tokens(text) {
    var out = [], re = new RegExp(TOKEN.source, 'g'), s = String(text == null ? '' : text), m;
    while ((m = re.exec(s))) out.push({ name: m[1], start: m.index, end: re.lastIndex });
    return out;
  }
  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /* The one listed name a typo most likely meant: the single closest within two edits (one for a name of three letters or fewer), or else the only name it is a prefix
     of (or that is a prefix of it). A tie says nothing rather than guess. */
  function suggest(name, names) {
    var low = String(name).toLowerCase(), best = 3, near = [];
    names.forEach(function (n) { if (n === name) return; var d = distance(n.toLowerCase(), low); if (d < best) { best = d; near = [n]; } else if (d === best) near.push(n); });
    if (best <= (low.length <= 3 ? 1 : 2)) return near.length === 1 ? near[0] : '';
    if (low.length < 2) return '';
    var pre = names.filter(function (n) { var l = n.toLowerCase(); return l.indexOf(low) === 0 || low.indexOf(l) === 0; });
    return pre.length === 1 ? pre[0] : '';
  }
  /* Whether a field's value is filled in by a run. */
  function fillable(type, name, types) {
    if (own(SKIP, name)) return false;
    var def = T.fieldDef(T.get(type, types), name);
    return !def || own(KINDS, def.kind);
  }
  /* Where each run detail's value comes from: asked when the run starts, or set by these steps (in checklist order). */
  function sources(map) {
    var out = Object.create(null), all = M.steps(map);
    map.meta.context.forEach(function (n) { out[n] = { setters: [] }; });
    all.forEach(function (x, order) {
      String(x.step.fields.sets || '').split(',').map(function (f) { return f.trim(); }).filter(Boolean).forEach(function (f) {
        if (out[f]) out[f].setters.push({ id: x.step.id, text: x.step.text, phase: x.phaseIndex, order: order, track: x.step.track || '', when: (x.step.when || []).map(function (w) { return w.text; }) });
      });
    });
    return out;
  }
  /* A place in the checklist: a step (by its order) or a phase's gate (the end of its phase: the gate waits for every step). */
  function atStep(map, step) {
    var all = M.steps(map);
    for (var i = 0; i < all.length; i++) if (all[i].step === step) return { phase: all[i].phaseIndex, order: i, track: step.track || '', step: step };
    return null;
  }
  function atGate(map, phaseIndex) { return { phase: phaseIndex, order: Infinity, track: '', gate: true }; }
  /* One name at one place: { v: ok | unknown | maybe-unset, suggest, setters, earlier }. */
  function verdict(map, src, name, at) {
    if (!own(src, name)) return { v: 'unknown', suggest: suggest(name, map.meta.context) };
    var setters = src[name].setters;
    if (!setters.length) return { v: 'ok', start: true };
    if (setters.some(function (s) { return s.phase < at.phase || (at.gate && s.phase === at.phase); })) return { v: 'ok', setters: setters };
    if (setters.some(function (s) { return s.phase === at.phase && s.order < at.order && s.track === at.track; })) return { v: 'ok', setters: setters, earlier: true };
    return { v: 'maybe-unset', setters: setters };
  }
  function each(map, opts, fn) {
    var types = opts && opts.types;
    M.steps(map).forEach(function (x, order) {
      var at = { phase: x.phaseIndex, order: order, track: x.step.track || '', step: x.step };
      fn({ kind: 'step', step: x.step, phaseIndex: x.phaseIndex, box: 'text', value: (x.step.textParts || []).map(function (p) { return p.t === 'ref' ? '^' + p.k : p.v; }).join('') }, at);
      Object.keys(x.step.fields).forEach(function (f) { if (fillable(x.step.type, f, types)) fn({ kind: 'step', step: x.step, phaseIndex: x.phaseIndex, box: 'field:' + f, value: x.step.fields[f] }, at); });
      /* What a linked step passes (2.8): its ^ sources are read when the child starts, so they're references at this step. */
      if (PF.links && PF.links.has(x.step)) { var src = PF.links.parse(x.step.fields.pass).entries.filter(function (e) { return e.source === 'detail'; }).map(function (e) { return '^' + e.from; }).join(' '); if (src) fn({ kind: 'step', step: x.step, phaseIndex: x.phaseIndex, box: 'pass', value: src }, at); }
    });
    map.phases.forEach(function (p, pi) { if (p.gate && p.gate.approves) fn({ kind: 'gate', phase: p, phaseIndex: pi, gate: p.gate, box: 'approves', value: p.gate.approves }, atGate(map, pi)); });
  }
  /* Every reference in a parsed checklist, each with where it is, its offsets in that box's value, and its verdict. */
  function scan(map, opts) {
    var src = sources(map), out = [];
    each(map, opts, function (where, at) {
      tokens(where.value).forEach(function (t) { out.push({ where: where, name: t.name, start: t.start, end: t.end, verdict: verdict(map, src, t.name, at) }); });
    });
    return out;
  }
  /* One box's live text at one place: each token's verdict, the one under the caret (if any) is 'typing' and never marked. */
  function judge(map, value, at, caret) {
    var src = sources(map);
    return tokens(value).map(function (t) {
      var typing = typeof caret === 'number' && caret > t.start && caret <= t.end;
      return { name: t.name, start: t.start, end: t.end, verdict: typing ? { v: 'typing' } : verdict(map, src, t.name, at) };
    });
  }
  /* How a checklist's details read where they're offered: kind words and source. */
  function where(src, name) {
    var s = src[name];
    if (!s || !s.setters.length) return 'asked when a run starts';
    return 'set by “' + s.setters[0].text + '”' + (s.setters.length > 1 ? ' and ' + (s.setters.length - 1) + ' more' : '');
  }
  /* What other files say about renaming a run detail (2.7). A child gets its parent's details by name: the ones carry: lists,
     or with no carry: every detail both have, plus the ones the step itself is tied to (run.js childInputs). Since 2.8 a
     parent that runs this checklist at Latest and passes the name is a warning with the fix, and this checklist's own
     linked steps are rewritten by the rename (outline.renameDetail). A parent pinned to a published version keeps that version, so it's only mentioned. A Jira
     workflow that fills a field from the detail is mentioned too (the shared file is never changed here).
     folder: { others: [{ label, map }] (other checklists: latest versions and drafts), child(process, pin): its map, or for Latest its published map and its saved draft's (a list), or null,
     workflows }. Each entry: { refuse, text }. */
  function dependents(map, name, folder) {
    var out = [], me = map.meta.process, said = Object.create(null);
    var add = function (refuse, text) { if (!said[text]) { said[text] = true; out.push({ refuse: refuse, text: text }); } };
    var carried = function (st) { return String(st.fields.carry || '').split(/[,\s]+/).filter(Boolean); };
    var passes = function (st, parentNames, childNames) {
      if (childNames.indexOf(name) < 0) return false;
      if (st.binds.indexOf(name) >= 0) return true;
      /* 2.8: a pass: entry that targets the name passes it, whatever its source; a name=? asks it instead. */
      if (PF.links && PF.links.has(st)) { var e = PF.links.parse(st.fields.pass).entries.filter(function (y) { return y.name === name; })[0]; if (e) return e.source !== 'ask'; }
      return st.fields.carry != null && carried(st).length ? carried(st).indexOf(name) >= 0 : parentNames.indexOf(name) >= 0;
    };
    ((folder && folder.others) || []).forEach(function (o) {
      M.steps(o.map).forEach(function (x) {
        var st = x.step;
        if (st.type !== 'run.process' || st.fields.process !== me || !passes(st, o.map.meta.context, map.meta.context)) return;
        if (st.fields.version) add(false, o.label + ': the step “' + st.text + '” is pinned to version ' + st.fields.version + ', which keeps using ^' + name + '. It isn\'t affected.');
        /* 2.8 (Q3): a warning with the fix, never a refusal; Folder health flags it once this is published. */
        else add(false, o.label + ': the step “' + st.text + '” passes ^' + name + ' to this checklist. After you publish the rename, change that step to pass it under the new name (in its pass: line), or new runs there can\'t start this checklist.');
      });
    });
    M.steps(map).forEach(function (x) {
      var st = x.step;
      /* 2.8: this checklist's own linked steps are rewritten by the rename so each child keeps what it got (O.renameDetail). */
      if (st.type === 'jira.issue' && String(st.fields.action || '').toLowerCase() === 'transition' && folder && folder.workflows) {
        var wf = PF.jira.forType(folder.workflows, st.fields.issueType);
        if (wf && !wf.workflow.invalid) PF.jira.requiredFields(wf.workflow, st.fields.status).forEach(function (f) {
          if (f.source === 'detail:' + name) add(false, 'The Jira workflow for ' + wf.type + ' fills “' + f.name + '” from ^' + name + '. After renaming, change its source in jira/workflows.json.');
        });
      }
    });
    return out;
  }
  return { TOKEN: TOKEN, dependents: dependents, tokens: tokens, distance: distance, suggest: suggest, fillable: fillable, sources: sources, atStep: atStep, atGate: atGate, verdict: verdict, scan: scan, judge: judge, where: where };
})();
