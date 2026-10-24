/* Practice a draft (2.2, docs/design.md section 34): edit-and-continue. A practice is never a run: it has no file, no
   recorder, no evidence and no receipt, and nothing outside this module and its pane ever sees it. Its answers are kept by
   part ID with two fingerprints (the step's own instructions, and what it depended on), so an edit to the draft keeps what
   still holds and asks for another try where something changed. Every rule about steps, gates and Next up is the run's
   own (PF.run), read through a run-shaped stand-in (asRun) that can't be saved. Pure: no I/O. */
PF.practice = (function () {
  'use strict';
  var U = PF.util, M = PF.map, R = PF.run, S = PF.signature, T = PF.types;
  var V = 1, CAP = 64000, GONE_MAX = 50, FOUND_MAX = 4000, UNDO_MAX = 50, VALUE_MAX = 2000, VALUES_MAX = 200;
  var own = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
  var fp = function (x) { return U.hash(JSON.stringify(x)); };

  /* fields: Fill in per step; setBy: the step that set each sample detail; from: Run from here's step ('' = the beginning). */
  /* The team's step types, or { stepTypes, workflows } when Jira workflows apply too: every function taking types takes
     either. */
  function envOf(x) { return x && own(x, 'stepTypes') ? { types: x.stepTypes, workflows: x.workflows || null } : { types: x, workflows: null }; }
  function env(stepTypes, workflows) { return { stepTypes: stepTypes || {}, workflows: workflows || null }; }

  function fresh(process) { return { v: V, process: process, sample: {}, answers: {}, gates: {}, fields: {}, setBy: {}, from: '', found: '', rev: 0 }; }

  /* ---------- admission: what can be practiced ----------
     Authoring omissions (missing IDs, owner, people: what only publishing needs) are fine; anything this copy refuses or
     can't run isn't, and the pane keeps the last version that was admitted. types: the team's step types. */
  function admit(text, types) {
    var map = M.parse(String(text == null ? '' : text));
    if (map.errors.length) return { ok: false, why: 'Line ' + map.errors[0].line + ': ' + map.errors[0].msg };
    var env = PF.envelope.markdown(map.meta, map);
    if (!env.ok) return { ok: false, why: env.why };
    var seen = {}, dup = '';
    var note = function (id) { if (!id) return; if (seen[id] && !dup) dup = id; seen[id] = true; };
    map.phases.forEach(function (p) { note(p.id); note(p.gate.id); p.tracks.forEach(function (t) { note(t.id); }); p.steps.forEach(function (s) { note(s.id); }); });
    if (dup) return { ok: false, why: 'The ID "' + dup + '" is used twice.' };
    for (var i = 0; i < map.phases.length; i++) {
      for (var j = 0; j < map.phases[i].steps.length; j++) {
        var s = map.phases[i].steps[j];
        if (s.type && !T.get(s.type, envOf(types).types || {})) return { ok: false, why: '"' + s.text + '" uses a step type this copy doesn\'t know ({' + s.type + '}).' };
      }
    }
    return { ok: true, map: normalize(map) };
  }
  /* Parts without an ID get a temporary one, private to practice (the draft's text never changes): its kind, phase position,
     text and how many identical ones come before it there. It holds only while those stay the same. */
  function normalize(map) {
    var count = {};
    var temp = function (kind, at, text) { var k = kind + '|' + at + '|' + text, n = count[k] = (count[k] || 0) + 1; return '~' + kind.charAt(0) + fp([k, n]); };
    map.phases.forEach(function (p, pi) {
      if (!p.id) p.id = temp('phase', pi, p.title);
      if (!p.gate.id) p.gate.id = p.gate.implicit ? p.id + '-confirm' : temp('gate', pi, p.gate.title);
      p.tracks.forEach(function (t, ti) { if (!t.id) t.id = temp('track', pi + '.' + ti, t.title); });
      /* A track without an ID gave its steps track ''; each step after a track heading belongs to the last one above it. */
      var ti = -1;
      p.steps.forEach(function (s) {
        while (ti + 1 < p.tracks.length && p.tracks[ti + 1].line < s.line) ti++;
        if (ti >= 0 && !s.track) s.track = p.tracks[ti].id;
        if (!s.id) s.id = temp('step', pi + '.' + s.track, s.text);
      });
    });
    return map;
  }
  function isTemp(id) { return String(id).charAt(0) === '~'; }

  /* ---------- fingerprints ---------- */
  /* What a step depended on besides its own instructions: its place (the phase and gate IDs before its phase, the step IDs
     before it in its phase), its track, and every run detail it binds or its conditions read, with that detail's kind and
     options and the sample value. */
  function readsOf(phase, step) { return PF.conditions.names(phase, step).concat(step ? step.binds : phase.gate.binds).filter(function (n, k, all) { return all.indexOf(n) === k; }).sort(); }
  function detailsPart(map, names, sample) { return names.map(function (n) { return [n, R.detailValueDef(map, n), own(sample, n) ? sample[n] : '']; }); }
  /* The phases and gates before phase pi, as one running fingerprint per phase (kept on the map, which never changes once
     admitted), so a long checklist hashes each ID once. */
  function before(map, pi) {
    if (!map._before) { var acc = '', list = []; map.phases.forEach(function (p) { list.push(acc); acc = fp([acc, p.id, p.gate.id]); }); Object.defineProperty(map, '_before', { value: list, enumerable: false }); }
    return map._before[pi];
  }
  /* The last fingerprints, kept while the map (cached per text by the app), the step types and the sample are the same: a
     redraw or an action that changes no sample costs nothing here. */
  var last = null;
  function prints(map, sample, types, fields) {
    var e = envOf(types), sk = JSON.stringify([sample || {}, fields || {}]), wk = e.workflows ? fp(e.workflows) : '';
    if (last && last.map === map && last.types === e.types && last.wk === wk && last.sk === sk) return last.out;
    var out = printsNow(map, sample, e, fields || {});
    last = { map: map, types: e.types, wk: wk, sk: sk, out: out };
    return out;
  }
  /* The evidence a step asks for with its effective fields (the draft's plus practice's Fill in), reduced to what checking
     it depends on: catches what the signature can't see, a sets: detail whose kind changed or a Jira workflow that now
     requires more. A Fill in rebases the answer (fillIn), so filling a field doesn't send the step back by itself. */
  function evidenceDef(r, map, s) {
    var list = R.evidenceFor(r, s, null, map).list;
    return list.length ? list.map(function (d) { return [d.name, d.kind, !!d.required, d.options || null, d.detail || '', d.source || '']; }) : null;
  }
  /* Whether checking the step asks for something first: required evidence, or a Jira problem to say beside it. */
  function asks(r, s, def) { return s.type !== 'run.process' && s.type !== 'run.skill' && ((def || []).some(function (d) { return d[2]; }) || !!R.jiraProblem(r, s)); }
  function printsNow(map, sample, e, fields) {
    var types = e.types, sig = S.steps(map, types || null, null, null, true), out = {}, r = asRun({ sample: sample || {}, steps: {}, gates: {}, fields: fields }, map, null, false, env(e.types, e.workflows));
    map.phases.forEach(function (p, pi) {
      var head = fp([before(map, pi), S.phaseParts(p)]), track = {}, prefix = '';
      p.tracks.forEach(function (t) { track[t.id] = [t.id, t.roles]; });
      /* The steps before this one, as a running fingerprint, so a long phase costs one hash per step. */
      p.steps.forEach(function (s) {
        var def = evidenceDef(r, map, s), jp = s.type === 'jira.issue' ? R.jiraProblem(r, s) || '' : '';
        out[s.id] = {
          ask: asks(r, s, def),
          /* A Jira transition the workflow no longer has (or can't check) changes what checking it means, too. */
          own: fp([sig[s.id] ? sig[s.id].sig : null, s.planned, def, jp]),
          ctx: fp([head, prefix, track[s.track] || null, detailsPart(map, readsOf(p, s), sample)])
        };
        prefix = fp([prefix, s.id]);
      });
    });
    return out;
  }

  /* ---------- the run-shaped stand-in ----------
     Exactly the fields PF.run's readers use (test/practice.test.js checks every read). No id, snapshot, rev or folder: it
     is never a run and never saved. Every role is the person's, so it reads as a solo run. */
  function asRun(view, map, me, memo, types) {
    var who = me || 'practice', roles = {}, e = envOf(types);
    (map.meta.roles || []).forEach(function (r) { roles[r] = who; });
    var r = { format: R.FORMAT3, practice: true, state: 'running', paused: null, ended: null, recorder: { person: who, session: 'practice' },
      roles: roles, details: Object.assign({}, view.sample), steps: view.steps, gates: view.gates, fields: view.fields || {}, migrations: [], followUps: [], log: [], marksFrom: 'start',
      types: e.types || {}, jira: R.jiraFor(map, e.workflows) };
    /* memo: for a stand-in that is complete and never changes while it's read (PF.run keeps phase info and gate status in it).
       Not enumerable, so a copy of the stand-in never shares it. */
    if (memo) Object.defineProperty(r, 'memo', { value: {}, enumerable: false });
    return r;
  }

  /* ---------- following the draft ----------
     The run-shaped answers for this text: an answer whose fingerprints still match is kept; one that differs needs another
     try (the run's own re-check state); a gate whose baseline changed needs review until it's passed again. */
  function gateBase(map, pi, now, applicable, sample) {
    var p = map.phases[pi];
    return fp([p.gate.id, S.gateParts(p.gate), S.phaseParts(p), before(map, pi), applicable.map(function (s) { return [s.id, now[s.id] ? [now[s.id].own, now[s.id].ctx] : null]; }), detailsPart(map, readsOf(p, null), sample)]);
  }
  /* A setter in Try it again (one whose answer holds a value it set) takes what it set with it: every later step and gate that reads one of those details goes to
     Try it again too, in document order (so it carries on through a consumer that sets something itself). Derived, never
     stored: checking the setter again with the same value brings them back as they were. */
  function derive(state, map, types) {
    var now = prints(map, state.sample, types, state.fields), steps = {}, again = {}, tainted = {}, taintAt = [], keyed = detailKeys(map);
    var fr = fromOf(state, map, types), assumed = fr ? fr.assumed : {}, pmap = fr ? project(map, fr, state.sample, types) : map;
    var reads = function (names) { for (var i = 0; i < names.length; i++) if (own(tainted, names[i])) return names[i]; return ''; };
    var r0 = asRun({ sample: state.sample, steps: {}, gates: {} }, map, null, false, types);
    map.phases.forEach(function (p, pi) {
      p.steps.forEach(function (s) {
        if (own(assumed, s.id)) { steps[s.id] = { s: 'done', by: 'assumed', at: '' }; return; }
        var a = own(state.answers, s.id) ? state.answers[s.id] : null;
        if (!a) return;
        var same = a.own === now[s.id].own && a.ctx === now[s.id].ctx, via = same ? reads(readsOf(p, s)) : '';
        if (same && !via) { steps[s.id] = { s: a.s, by: 'practice', at: a.at }; if (a.values && !a.skipped) steps[s.id].values = Object.assign({}, a.values); }
        else {
          steps[s.id] = { s: 'recheck', reason: via ? 'setter' : 'changed', detail: via, by: 'practice', at: a.at }; again[s.id] = a;
          /* What it was checked with is the starting point for trying it again, as a run's Change answer shows. */
          if (a.values && !a.skipped) steps[s.id].values = Object.assign({}, a.values);
          /* What it set comes from its own answer's values (which follow a new ID, and outlive a changed sets:), matched
             to the checklist's details by their keys; never from setBy. A setter that doesn't apply now sets nothing. */
          if (a.values && !a.skipped && R.applies(r0, map, pi, s).applies !== false) Object.keys(a.values).forEach(function (k) { if (own(keyed, k)) tainted[keyed[k]] = true; });
        }
      });
      taintAt.push(Object.assign({}, tainted));
    });
    var view = { sample: state.sample, steps: steps, gates: {}, fields: state.fields || {} }, r = asRun(view, pmap, null, false, types);
    /* Gates before the from step's phase are assumed passed, with what they'd approve now. */
    if (fr) pmap.phases.forEach(function (p, pi) { if (pi < fr.pi) view.gates[p.gate.id] = { s: 'passed', by: 'assumed', at: '', approved: R.gateInputs(r, pmap, p.gate) }; });
    map.phases.forEach(function (p, pi) {
      if (fr && pi < fr.pi) return;
      var g = own(state.gates, p.gate.id) ? state.gates[p.gate.id] : null;
      if (!g) return;
      var base = gateBase(map, pi, now, applicableSteps(r, pmap, pi), state.sample), via = readsOf(p, null).filter(function (n) { return own(taintAt[pi], n); })[0] || '';
      view.gates[p.gate.id] = base === g.base && !via ? { s: g.s, reason: g.reason, by: 'practice', at: g.at, approved: g.approved } : { s: 'review', was: g.s, reason: via ? 'setter' : 'changed', detail: via, by: 'practice', at: g.at, approved: g.approved };
    });
    return { view: view, now: now, again: again, map: pmap, from: fr };
  }

  /* Each run detail's evidence key (R.detailKey) → its name, kept on the map (it never changes once admitted). */
  function detailKeys(map) {
    if (!map._keys) { var k = {}; (map.meta.context || []).forEach(function (d) { k[R.detailKey(d)] = d; }); Object.defineProperty(map, '_keys', { value: k, enumerable: false }); }
    return map._keys;
  }

  /* ---------- Run from here ----------
     The from step, as it applies now: one that's hidden hands over to the next step after it in its phase that applies,
     else the phase's first that does; none clears it. Everything before it is assumed (never an answer). */
  function fromOf(state, map, types) {
    if (!state.from) return null;
    var x = M.findStep(map, state.from);
    if (!x) return null;
    var pi = x.phaseIndex, steps = map.phases[pi].steps, si = steps.indexOf(x.step), r0 = asRun({ sample: state.sample, steps: {}, gates: {} }, map, null, false, types);
    var ok = function (k) { return R.applies(r0, map, pi, steps[k]).applies !== false; }, at = -1;
    for (var k = si; k < steps.length && at < 0; k++) if (ok(k)) at = k;
    for (var j = 0; j < si && at < 0; j++) if (ok(j)) at = j;
    if (at < 0) return null;
    var assumed = {}, count = 0;
    map.phases.forEach(function (p, i) { p.steps.forEach(function (s, n) { if (i < pi || (i === pi && n < at)) { assumed[s.id] = true; if (R.applies(r0, map, i, s).applies !== false) count++; } }); });
    return { pi: pi, si: at, id: steps[at].id, text: steps[at].text, assumed: assumed, count: count };
  }
  /* The map the readers see while running from a step (never fingerprinted or kept): an assumed step whose own condition
     doesn't resolve, and an entirely assumed phase whose condition doesn't, are read without it, so nothing assumed can
     hold the way. Conditions that resolve stay, and the live part keeps every condition. */
  function project(map, fr, sample, types) {
    var r0 = asRun({ sample: sample, steps: {}, gates: {} }, map, null, false, types), any = false;
    var unresolved = function (p, s) { return R.applies(r0, { meta: map.meta, phases: [Object.assign({}, p, { when: null, steps: [s] })] }, 0, s).applies === null; };
    var phases = map.phases.map(function (p, pi) {
      if (pi > fr.pi) return p;
      var q = p, copyOf = function () { if (q === p) { q = Object.assign({}, p, { steps: p.steps.slice() }); any = true; } };
      if (pi < fr.pi && p.when && R.applies(r0, map, pi).applies === null) { copyOf(); q.when = null; }
      p.steps.forEach(function (s, n) {
        if (!fr.assumed[s.id] || !s.when || !unresolved(p, s)) return;
        copyOf(); q.steps[n] = Object.assign({}, s, { when: null });
      });
      return q;
    });
    return any ? Object.assign({}, map, { phases: phases }) : map;
  }
  /* Run details the walk from the from step needs before anything on it sets them: at its first use (a step's text,
     condition or evidence; a gate's approval), empty, and not set earlier on the walk by a step that applies and wasn't
     checked without its evidence. Assumed setters set nothing. */
  function needed(state, map, pmap, r, fr) {
    var out = [], supplied = {};
    var use = function (n) { if (!(state.sample[n]) && !supplied[n] && out.indexOf(n) < 0) out.push(n); };
    for (var pi = fr.pi; pi < pmap.phases.length; pi++) {
      var p = pmap.phases[pi];
      for (var n = pi === fr.pi ? fr.si : 0; n < p.steps.length; n++) {
        var s = p.steps[n];
        if (R.applies(r, pmap, pi, s).applies === false) continue;
        var ev = R.evidenceFor(r, s, null, map).list;
        readsOf(p, s).forEach(use);
        ev.forEach(function (e) { var m = /^detail:(.+)$/.exec(e.source || ''); if (m && !e.detail) use(m[1]); });
        /* Marked Not needed, checked without evidence, or simulated (a linked run sets nothing in practice): no value. */
        var a = own(state.answers, s.id) ? state.answers[s.id] : null;
        if (!(a && (a.skipped || a.s === 'na')) && simulated(s, envOf(r.types).types) !== 'linked') ev.forEach(function (e) { if (e.detail) supplied[e.detail] = true; });
      }
      /* A skipped phase's gate approves nothing. */
      if (R.applies(r, pmap, pi).applies !== false) readsOf(p, null).forEach(use);
    }
    return out;
  }
  /* The boxes a step's inline form shows. ev: its evidence (the run's own list, with what was kept as the starting point,
     and the Jira problem if there is one: then only Check without it). fill: its Fill in fields, prefilled. */
  function formFor(state, map, types, id, kind) {
    var d = derive(state, map, types), r = asRun(d.view, d.map, null, false, types), x = M.findStep(map, id);
    if (!x) return null;
    var a = own(state.answers, id) ? state.answers[id] : null, again = own(d.again, id) ? d.again[id] : null, kept = (a && a.values) || (again && again.values) || {};
    if (kind === 'ev') return { kind: 'ev', id: id, text: x.step.text, problem: R.jiraProblem(r, x.step) || '', list: R.evidenceFor(r, x.step, null, map).list.map(function (e) { return Object.assign({}, e, { value: own(kept, e.name) ? kept[e.name] : '' }); }) };
    var t = T.get(x.step.type || 'confirm', envOf(types).types || {}), eff = R.fieldsOf(r, x.step);
    return { kind: 'fill', id: id, text: x.step.text, list: t ? T.editable(t).map(function (f) { var def = T.fieldDef(t, f); return { name: f, def: def, value: eff[f] || '', draft: (x.step.fields || {})[f] || '' }; }) : [] };
  }
  /* A from step that doesn't apply now hands over for good (fromOf's choice is kept, so it never moves back on its own).
     moved: 'next' or 'start' when it did. */
  function pin(st, map, types) {
    if (!st.from || !M.findStep(map, st.from)) return '';
    var fr = fromOf(st, map, types), to = fr ? fr.id : '';
    if (to === st.from) return '';
    st.from = to;
    return to ? 'next' : 'start';
  }
  function repin(state, map, types) { var st = copy(state), moved = pin(st, map, types); return moved ? { state: bump(st), moved: moved } : { state: state }; }
  function setFrom(state, map, id) {
    if (id && !M.findStep(map, id)) return { error: 'That step isn\'t in the draft anymore.' };
    var st = copy(state); st.from = id || '';
    return { state: bump(st) };
  }
  function applicableSteps(r, map, pi) { return map.phases[pi].steps.filter(function (s) { return R.applies(r, map, pi, s).applies !== false; }); }

  /* The pane's model: every phase and step with its status and why, the gates, Next up, answers kept for parts no longer in
     the draft (gone), and whether everything is through (complete; never for a draft with nothing to do). */
  function follow(state, map, types, me) {
    var d = derive(state, map, types), pm = d.map, r = asRun(d.view, pm, me, true, types), present = {}, fr = d.from;
    var phases = pm.phases.map(function (p, pi) {
      var gst = R.gateStatus(r, pm, pi);
      return { id: p.id, title: p.title, mode: p.mode, gate: { id: p.gate.id, title: p.gate.title, implicit: p.gate.implicit, status: gst, canPass: R.canPass(r, pm, pi), canWaive: R.canWaive(r, pm, pi), rec: d.view.gates[p.gate.id] || null, assumed: !!(fr && pi < fr.pi) },
        info: R.phaseInfo(r, pm, pi), open: phaseOpenOf(r, pm, pi),
        steps: p.steps.map(function (s) {
          present[s.id] = true;
          var ap = R.applies(r, pm, pi, s), a = d.view.steps[s.id], rec = own(state.answers, s.id) ? state.answers[s.id] : null;
          var status = ap.applies === false ? 'hidden' : a && a.by === 'assumed' ? 'assumed' : ap.applies === null ? 'waiting' : !a ? 'open' : a.s === 'recheck' ? 'again' : a.s === 'na' ? 'skipped' : 'done';
          return { id: s.id, text: s.text, type: s.type, must: s.must, temp: isTemp(s.id), status: status, why: ap.why || '', old: d.again[s.id] ? d.again[s.id].s : null, simulated: simulated(s, envOf(types).types),
            ask: !!(d.now[s.id] && d.now[s.id].ask), fill: s.type && T.get(s.type, envOf(types).types || {}) ? T.editable(T.get(s.type, envOf(types).types || {})).length > 0 : false,
            again: a && a.s === 'recheck' ? { reason: a.reason, detail: a.detail || '' } : null, skipped: !!(rec && rec.skipped && status === 'done'), values: rec && rec.values && status !== 'assumed' ? rec.values : null };
        }) };
    });
    map.phases.forEach(function (p) { present[p.gate.id] = true; });
    var gone = Object.keys(state.answers).filter(function (id) { return !present[id]; });
    var nu = R.nextUp(r, pm, me || 'practice'), steps = 0;
    phases.forEach(function (p) { p.steps.forEach(function (s) { if (s.status !== 'hidden' && s.status !== 'assumed') steps++; }); });
    var through = nu.kind === 'complete' && steps > 0;
    return { phases: phases, nextUp: { kind: nu.kind, step: nu.step ? nu.step.id : null, gate: nu.gate ? nu.gate.id : null, phaseIndex: nu.phaseIndex, text: nu.hl ? nu.hl.text : '' },
      gone: gone, complete: through && !fr, setBy: Object.assign({}, state.setBy || {}),
      from: fr ? { id: fr.id, text: fr.text, moved: fr.id !== state.from, assumed: fr.count, needed: needed(state, map, pm, r, fr), through: through } : null };
  }
  function phaseOpenOf(r, map, pi) { return R.phaseOpen(r, map, pi); }
  /* A step that does something practice can't: a linked run or a skill (only "Mark done for practice"), or evidence it
     would record in a run (checked without it here). */
  function simulated(s, types) {
    if (s.type === 'run.process' || s.type === 'run.skill') return 'linked';
    var t = T.get(s.type || 'confirm', types || {});
    return t && T.needsRecord(t, s.fields || {}) ? 'evidence' : false;
  }

  /* ---------- changing a practice: each returns { state } or { error }, never changing the one it's given ---------- */
  var ASSUMED = 'This part is assumed while you practice from a later step. Choose Start from the beginning to practice it.';
  function copy(state) { return JSON.parse(JSON.stringify(state)); }
  function bump(st) { st.rev = (st.rev || 0) + 1; return st; }
  /* o (for done): { values } the evidence, checked as a run checks it, or { skipped: true } to check without it (practice
     only: never sets a detail). A setter is one transaction: its values become the sample (setBy remembers it), and only
     then is the answer fingerprinted, so a step that reads what it sets stays done (a run never re-checks the setter). */
  function answer(state, map, id, how, types, now, o) {
    var d = derive(state, map, types), r = asRun(d.view, d.map, null, true, types);
    if (d.from && d.from.assumed[id]) return { error: ASSUMED };
    var why = R.answerable(r, d.map, id, how);
    if (why) return { error: why };
    var st = copy(state);
    unsetBy(st, id);
    if (how === 'open') { delete st.answers[id]; return { state: bump(st) }; }
    var rec = { s: how === 'na' ? 'na' : 'done', at: now || '' }, x = M.findStep(map, id);
    if (how !== 'na' && x && simulated(x.step, envOf(types).types) !== 'linked') {
      var ev = R.evidenceFor(r, x.step, null, map), jp = R.jiraProblem(r, x.step);
      if (o && o.skipped) { if (ev.list.length || jp) rec.skipped = true; }
      else if (jp) return { error: jp, field: '' };
      else if (ev.list.length) {
        var chk = R.checkEvidence(r, x.step, null, (o && o.values) || {}, false, map);
        if (chk.error) return { error: chk.error, field: chk.field || '' };
        if (Object.keys(chk.values).length) rec.values = chk.values;
        ev.list.forEach(function (e) { if (e.detail && chk.values[e.name]) { st.sample[e.detail] = String(chk.values[e.name]).slice(0, 120); st.setBy[e.detail] = id; } });
      }
    }
    var p = prints(map, st.sample, types, st.fields)[id];
    rec.own = p.own; rec.ctx = p.ctx;
    st.answers[id] = rec;
    var moved = pin(st, map, types);
    return moved ? { state: bump(st), moved: moved } : { state: bump(st) };
  }
  /* The step no longer sets anything it set (its values stay in the sample, as a run's details do). */
  function unsetBy(st, id) { st.setBy = st.setBy || {}; Object.keys(st.setBy).forEach(function (n) { if (st.setBy[n] === id) delete st.setBy[n]; }); }
  /* Fill in, checked as a run checks it (R.checkFill): a checked answer keeps the evidence it needs, unless it was checked
     without it. An answer that was current is rebased onto the new fields, so filling a field never sends it back. */
  function fillIn(state, map, id, fields, types) {
    var d = derive(state, map, types), r = asRun(d.view, map, null, true, types), x = M.findStep(map, id);
    if (!x) return { error: 'That step isn\'t in the draft anymore.' };
    var a = own(state.answers, id) ? state.answers[id] : null, current = a && !own(d.again, id);
    var cf = R.checkFill(r, x.step, fields, a && a.s === 'done' && !a.skipped ? { keep: { values: a.values || {}, map: map } } : null);
    if (cf.error) return { error: cf.error, field: cf.field };
    if (!cf.changed.length) return { state: state };
    var st = copy(state);
    if (Object.keys(cf.own).length) st.fields[id] = cf.own; else delete st.fields[id];
    var after = prints(map, st.sample, types, st.fields), pi = x.phaseIndex, gid = map.phases[pi].gate.id, g = own(st.gates, gid) ? st.gates[gid] : null;
    if (current) st.answers[id].own = after[id].own;
    /* Its gate, if it was current, stays as it was too (a run's does), answered or not: only this step's own fingerprint
       moved. A gate already in review for another reason is left as it is. */
    if (g) {
      var app = applicableSteps(r, map, pi);
      if (g.base === gateBase(map, pi, d.now, app, state.sample)) g.base = gateBase(map, pi, after, app, st.sample);
    }
    return { state: bump(st), changed: cf.changed };
  }
  function gateAct(state, map, pi, how, reason, types, now) {
    var d = derive(state, map, types), r = asRun(d.view, d.map, null, true, types), p = map.phases[pi];
    if (!p) return { error: 'That phase isn\'t in the draft anymore.' };
    if (d.from && pi < d.from.pi) return { error: ASSUMED };
    map = d.map;
    var st = copy(state), gid = p.gate.id;
    if (how === 'reopen') { R.reopenIds(map, pi).forEach(function (id) { delete st.gates[id]; }); return { state: bump(st) }; }
    if (how === 'pass' && !R.canPass(r, map, pi)) return { error: 'This gate isn\'t ready to pass.' };
    if (how === 'waive') {
      if (!R.canWaive(r, map, pi)) return { error: 'This gate can\'t be waived: every must-do step has to be done.' };
      if (!String(reason || '').trim()) return { error: 'Say why the gate is waived.' };
    }
    st.gates[gid] = { s: how === 'waive' ? 'waived' : 'passed', reason: how === 'waive' ? String(reason).trim().slice(0, 200) : '', at: now || '', approved: R.gateInputs(r, map, p.gate), base: gateBase(map, pi, d.now, applicableSteps(r, map, pi), state.sample) };
    return { state: bump(st) };
  }
  /* A sample run detail, checked as a run checks it (empty clears it). */
  function setSample(state, map, name, value, types) {
    if ((map.meta.context || []).indexOf(name) < 0) return { error: 'That run detail isn\'t in the draft.' };
    var v = String(value == null ? '' : value).trim(), def = R.detailValueDef(map, name);
    if (v && def) { var p = PF.values.parse(def, v, { max: 120 }); if (!p.ok) return { error: p.why }; v = p.canonical; }
    var st = copy(state);
    if (v) st.sample[name] = v.slice(0, 120); else delete st.sample[name];
    var moved = pin(st, map, types);
    return moved ? { state: bump(st), moved: moved } : { state: bump(st) };
  }
  function setFound(state, text) { var st = copy(state); st.found = String(text || '').slice(0, FOUND_MAX); return { state: bump(st) }; }
  /* Reset keeps the sample details (no longer marked as set by a step) and what was found. */
  function reset(state) { var st = copy(state); st.answers = {}; st.gates = {}; st.fields = {}; st.setBy = {}; st.from = ''; return { state: bump(st) }; }

  /* A builder edit that gave parts new IDs (renames: old → new): each answer is copied to the new ID, where it needs another
     try (its wording changed), and stays under the old one, so an Undo of the edit brings it back. Answers for parts no
     longer in the draft are kept, newest 50, so deleting and undoing restores them. */
  function settle(state, map, renames, prev) {
    var st = copy(state), present = {}, changed = false;
    renames = compose(renames);
    st.from = st.from || '';
    if (st.from && own(renames || {}, st.from)) { st.from = renames[st.from]; changed = true; }
    /* "Set by" follows a new ID too (it only labels the sample box; what flows comes from the answers). */
    Object.keys(st.setBy || {}).forEach(function (n) { if (own(renames || {}, st.setBy[n])) { st.setBy[n] = renames[st.setBy[n]]; changed = true; } });
    Object.keys(renames || {}).forEach(function (o) {
      var n = renames[o];
      if (own(st.answers, o) && !own(st.answers, n)) { st.answers[n] = st.answers[o]; changed = true; }
      if (own(st.gates, o) && !own(st.gates, n)) { st.gates[n] = st.gates[o]; changed = true; }
      if (own(st.fields, o) && !own(st.fields, n)) { st.fields[n] = st.fields[o]; changed = true; }
    });
    map.phases.forEach(function (p) { present[p.id] = present[p.gate.id] = true; p.steps.forEach(function (s) { present[s.id] = true; }); });
    /* Run from here's step left the draft: the next step that was after it in its phase and is still there, else that
       phase's first, else the beginning (prev: the draft before this edit). */
    if (st.from && !present[st.from]) {
      var x = prev ? M.findStep(prev, st.from) : null, to = '';
      if (x) {
        var was = prev.phases[x.phaseIndex], k = was.steps.indexOf(x.step), now = map.phases.filter(function (p) { return p.id === was.id; })[0];
        /* Only steps still in that phase: one that moved to another phase would skip this one's gate. */
        var inNow = {}; if (now) now.steps.forEach(function (s) { inNow[s.id] = true; });
        for (var i = k + 1; i < was.steps.length && !to; i++) if (inNow[was.steps[i].id]) to = was.steps[i].id;
        if (!to && now && now.steps.length) to = now.steps[0].id;
      }
      st.from = to; changed = true;
    }
    var gone = Object.keys(st.answers).filter(function (id) { return !present[id]; }).sort(function (a, b) { return String(st.answers[b].at).localeCompare(String(st.answers[a].at)); });
    gone.slice(GONE_MAX).forEach(function (id) { delete st.answers[id]; changed = true; });
    var gg = Object.keys(st.gates).filter(function (id) { return !present[id]; });
    gg.slice(GONE_MAX).forEach(function (id) { delete st.gates[id]; changed = true; });
    return changed ? bump(st) : state;
  }

  /* Renames as they happened (a → b, then b → c) made into where each old ID is now (a → c, b → c). A cycle (a → b → a)
     ends where it started, so that ID maps to itself and is left out. */
  function compose(renames) {
    var out = {};
    Object.keys(renames || {}).forEach(function (o) {
      var n = renames[o], seen = {}; seen[o] = true;
      while (own(renames, n) && !seen[n]) { seen[n] = true; n = renames[n]; }
      if (n !== o) out[o] = n;
    });
    return out;
  }
  /* Renames over time: what came before (old → current), then a new set (current → newer). An ID renamed and renamed back
     is itself again; one that was renamed away and came back points where it is now. */
  function chain(before, add) {
    var out = {}, a = add || {};
    Object.keys(before || {}).forEach(function (o) { var n = own(a, before[o]) ? a[before[o]] : before[o]; if (n !== o) out[o] = n; });
    Object.keys(a).forEach(function (o) { if (!own(out, o) && !own(before || {}, o) && a[o] !== o) out[o] = a[o]; });
    return out;
  }

  /* ---------- keeping it: sessionStorage, checked when read back, within CAP ---------- */
  var REC = /^(done|na)$/, GREC = /^(passed|waived)$/, HEX = /^[0-9a-f]{1,8}$/;
  function check(o, process) {
    if (!o || typeof o !== 'object' || o.v !== V || o.process !== process || typeof o.answers !== 'object' || typeof o.gates !== 'object' || typeof o.sample !== 'object' || !o.answers || !o.gates || !o.sample) return null;
    var st = fresh(process), cut = false;
    Object.keys(o.answers).slice(0, 2000).forEach(function (id) {
      var a = o.answers[id];
      if (!(a && typeof a === 'object' && is(REC, a.s) && is(HEX, a.own) && is(HEX, a.ctx) && id.length <= 80)) return;
      var k = { s: a.s, at: str(a.at, 40), own: a.own, ctx: a.ctx };
      if (a.skipped === true) k.skipped = true;
      if (own(a, 'values')) {
        if (!a.values || typeof a.values !== 'object' || Array.isArray(a.values)) { cut = true; return; }
        /* Evidence comes back whole or not at all: a record cut short would keep a done answer without what made it done,
           so that answer is dropped, and with it every gate (which one relied on it isn't known here). */
        var vk = Object.keys(a.values), vs = clean(a.values, VALUE_MAX, VALUES_MAX);
        if (vk.length > VALUES_MAX || vk.some(function (n) { return typeof a.values[n] !== 'string' || a.values[n].length > VALUE_MAX; })) { cut = true; return; }
        if (Object.keys(vs).length) k.values = vs;
      }
      st.answers[id] = k;
    });
    if (cut) st.gates = {};
    Object.keys(o.gates).slice(0, 500).forEach(function (id) { var g = o.gates[id]; if (!cut && g && typeof g === 'object' && is(GREC, g.s) && is(HEX, g.base) && id.length <= 80) st.gates[id] = { s: g.s, reason: str(g.reason, 200), at: str(g.at, 40), approved: g.approved && typeof g.approved === 'object' ? clean(g.approved) : {}, base: g.base }; });
    st.sample = clean(o.sample);
    /* Slice 1 kept none of these; each is optional and anything malformed is dropped. */
    if (o.fields && typeof o.fields === 'object') Object.keys(o.fields).slice(0, 2000).forEach(function (id) { var f = o.fields[id]; if (id.length <= 80 && f && typeof f === 'object' && !(id in Object.prototype)) { var c = clean(f, 300); if (Object.keys(c).length) st.fields[id] = c; } });
    if (o.setBy && typeof o.setBy === 'object') Object.keys(o.setBy).slice(0, 40).forEach(function (n) { var id = o.setBy[n]; if (typeof id === 'string' && own(st.sample, n) && own(st.answers, id)) st.setBy[n] = id; });
    st.from = typeof o.from === 'string' && o.from.length <= 80 ? o.from : '';
    st.found = typeof o.found === 'string' ? o.found.slice(0, FOUND_MAX) : '';
    st.rev = typeof o.rev === 'number' && isFinite(o.rev) ? o.rev : 0;
    return st;
  }
  /* Only text is read from a kept record: anything else is dropped, never converted (it could throw). */
  function is(re, x) { return typeof x === 'string' && re.test(x); }
  function str(x, n) { return typeof x === 'string' ? x.slice(0, n) : ''; }
  function clean(o, max, keys) { var out = {}; Object.keys(o || {}).slice(0, keys || 40).forEach(function (k) { if (typeof o[k] === 'string' && k.length <= 60 && !(k in Object.prototype)) out[k] = o[k].slice(0, max || 120); }); return out; }
  /* The text to keep, within CAP: answers for parts no longer in the draft go first, then the oldest; null when even
     an empty practice with its findings doesn't fit (it stays in memory only). present: IDs in the draft now; map: the
     admitted draft. An answer goes as a unit with its evidence and Fill in, so a kept answer always keeps what made it
     done, and with it every gate from its phase on (R.reopenIds), so no passed gate outlives an answer it relied on. */
  function keep(state, present, map) {
    var st = copy(state), text = JSON.stringify(st);
    if (text.length <= CAP) return text;
    var phaseOf = {};
    if (map) map.phases.forEach(function (p, pi) { p.steps.forEach(function (s) { phaseOf[s.id] = pi; }); });
    var order = Object.keys(st.answers).sort(function (a, b) { var pa = present && present[a] ? 1 : 0, pb = present && present[b] ? 1 : 0; return pa - pb || String(st.answers[a].at).localeCompare(String(st.answers[b].at)); });
    function drop(id) {
      var n = JSON.stringify(id).length * 2 + JSON.stringify(st.answers[id]).length + (own(st.fields, id) ? JSON.stringify(st.fields[id]).length : 0) + 4;
      delete st.answers[id]; delete st.fields[id];
      if (map && own(phaseOf, id)) R.reopenIds(map, phaseOf[id]).forEach(function (g) { if (own(st.gates, g)) { n += JSON.stringify(st.gates[g]).length + g.length + 4; delete st.gates[g]; } });
      return n;
    }
    /* Over the cap: what to drop is chosen first by its own size, then the text is made once (and again only if that
       estimate was short, a few at a time). */
    var size = text.length;
    while (order.length && size > CAP) size -= drop(order.shift());
    unset(st);
    text = JSON.stringify(st);
    while (order.length && text.length > CAP) { for (var n = 0; n < 50 && order.length; n++) drop(order.shift()); unset(st); text = JSON.stringify(st); }
    return text.length <= CAP ? text : null;
  }
  /* setBy never names an answer that isn't kept. */
  function unset(st) { Object.keys(st.setBy).forEach(function (n) { if (!own(st.answers, st.setBy[n])) delete st.setBy[n]; }); }

  /* ---------- Undo for practice (separate from the draft's): what each action replaced, by key ---------- */
  var KEYED = ['answers', 'gates', 'sample', 'fields', 'setBy'];
  function undoEntry(before, after, label) {
    var e = { label: label };
    KEYED.forEach(function (k) {
      var b = before[k] || {}, a = after[k] || {};
      e[k] = {};
      Object.keys(b).concat(Object.keys(a)).filter(function (x, i, all) { return all.indexOf(x) === i; })
        .forEach(function (x) { if (JSON.stringify(b[x]) !== JSON.stringify(a[x])) e[k][x] = own(b, x) ? b[x] : null; });
    });
    if ((before.from || '') !== (after.from || '')) e.from = before.from || '';
    return e;
  }
  /* Puts back what an entry holds; returns the new state and the entry that undoes this (for Redo). moved: where IDs the
     entry recorded are now (compose()'s, from the draft's renames since): what it puts back goes under the old ID as
     recorded and under the current one, so Undo after a rename undoes the step as it's named now. */
  function applyEntry(state, e, moved) {
    var st = copy(state), back = { label: e.label }, to = moved || {};
    var cur = function (id) { return own(to, id) ? to[id] : id; };
    KEYED.forEach(function (k) {
      st[k] = st[k] || {}; back[k] = {};
      Object.keys(e[k] || {}).forEach(function (x) {
        var ids = [x].concat(k !== 'sample' && k !== 'setBy' && cur(x) !== x && !own(e[k], cur(x)) ? [cur(x)] : []);
        ids.forEach(function (y) {
          if (own(back[k], y)) return;
          back[k][y] = own(st[k], y) ? st[k][y] : null;
          var v = e[k][x];
          if (k === 'setBy' && typeof v === 'string') v = cur(v);
          if (v == null) delete st[k][y]; else st[k][y] = v;
        });
      });
    });
    if (typeof e.from === 'string') { back.from = st.from || ''; st.from = cur(e.from); }
    return { state: bump(st), back: back };
  }

  return { env: env, V: V, CAP: CAP, GONE_MAX: GONE_MAX, FOUND_MAX: FOUND_MAX, UNDO_MAX: UNDO_MAX, VALUE_MAX: VALUE_MAX, VALUES_MAX: VALUES_MAX, fresh: fresh, admit: admit, normalize: normalize, isTemp: isTemp, prints: prints, asRun: asRun,
    derive: derive, follow: follow, answer: answer, gateAct: gateAct, fillIn: fillIn, setFrom: setFrom, repin: repin, formFor: formFor, setSample: setSample, setFound: setFound, reset: reset, settle: settle, check: check, keep: keep,
    undoEntry: undoEntry, applyEntry: applyEntry, compose: compose, chain: chain };
})();
