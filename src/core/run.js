/* Runs: one execution of one published map. Pure functions over a plain run object (saved as run.json). */
PF.run = (function () {
  'use strict';
  var U = PF.util, M = PF.map;
  var FORMAT = 'preflight-run/2', FORMAT3 = 'preflight-run/3';
  var LOG_MAX = 300;

  function create(pub, o) {
    /* Only a version this copy fully understands can start a run; P.verify already sets the others aside. */
    var two = !!pub.info && pub.info.format === PF.publish.FORMAT2;
    /* o.explicit: a person chose a Flightdeck 2.0 run on a /1 version (R2-4), the one case a /1 version gets a run/3: a run/2
       parent's linked child needs it (see continuation). */
    var explicit = !two && !!o.explicit;
    var bad = !pub.info ? PF.publish.NEWER : PF.publish.newerOf(pub.info) || (pub.info.format !== PF.publish.FORMAT && !two ? PF.publish.NEWER : PF.publish.unrunnable(pub.md, pub.types));
    if (bad) throw new Error(bad);
    var map = pub.map, details = {}, roles = {};
    map.meta.context.forEach(function (f) { details[f] = String((o.details || {})[f] || '').trim(); });
    map.meta.roles.forEach(function (r) { roles[r] = (o.roles || {})[r] || ''; });
    var id = o.id || U.randomId(8);
    var r = {
      format: FORMAT, id: id, process: map.meta.process, version: pub.info.version, folder: pub.info.folder, mapHash: pub.info.mapHash,
      title: String(o.title || map.meta.title).trim().slice(0, 100), category: map.meta.category || 'Other',
      snapshot: pub.md, types: pub.types, details: details, roles: roles,
      recorder: { person: o.by, session: o.session }, state: 'running', created: o.now, createdBy: o.by,
      steps: {}, gates: {}, fields: {}, followUps: [], log: [], ended: null, rev: 0, tz: o.tz || '',
      /* Publications that record their screenshots also hold copies of them; a run of one never shows images/ instead. */
      shotsFrozen: !!(pub.info && pub.info.images),
      /* The Jira workflows this map's steps use, copied when the run starts so a later edit to the file can't change it. */
      jira: jiraFor(map, o.workflows),
      /* Marks (every deviation per step) are kept from the start, so they're complete for this run. */
      marksFrom: 'start',
      pauses: [], paused: null
    };
    /* A run of a /2 version is run/3 (the lowest sufficient format follows the version): it names the version's features and
       keeps its types fingerprint and frozen payload, so a run says exactly what it ran. */
    if (two) {
      var env = PF.envelope.stamp('preflight-run', pub.info.features || [], o.app), head = { format: env.format || FORMAT3 };
      if (env.features) head.features = env.features;
      if (env.app) head.app = env.app;
      r = order3(Object.assign(head, r, { format: head.format, typesHash: pub.info.typesHash, payload: JSON.parse(JSON.stringify(pub.info.payload)) }));
    }
    if (explicit) r = order3(Object.assign({ format: FORMAT3, features: [] }, PF.envelope.semver(o.app) ? { app: o.app } : {}, r, { format: FORMAT3, typesHash: pub.info.typesHash }));
    /* Pins (2.0): a run/3 follows one fixed set of children, pinned now: the version's own (version: on the step), then the
       ones the caller resolved at the latest (PF.pins.atStart). A run/2 records none; its format is frozen. */
    if (two || explicit) {
      var kids = {}, own2 = two && pub.info.payload && pub.info.payload.pins ? pub.info.payload.pins.children || {} : {};
      Object.keys(o.pins || {}).forEach(function (k) { if (STEP_ID.test(k) && PF.pins.childOk(o.pins[k])) kids[k] = JSON.parse(JSON.stringify(o.pins[k])); });
      Object.keys(own2).forEach(function (k) { if (STEP_ID.test(k)) kids[k] = JSON.parse(JSON.stringify(own2[k])); });
      if (Object.keys(kids).length) { r.pins = { children: kids }; addFeature(r, 'pinned-children'); r = withPins(r); }
    }
    if (o.parent && o.parent.process && o.parent.id && o.parent.step) { r.parent = { process: String(o.parent.process), id: String(o.parent.id), step: String(o.parent.step) }; if (o.parent.inputs) r.parent.inputs = Object.assign({}, o.parent.inputs); if ((two || explicit) && typeof o.parent.folder === 'string' && o.parent.folder) r.parent.folder = o.parent.folder; }
    addLog(r, o.by, o.now, 'Started the run');
    return r;
  }

  /* A pin's step ID (never __proto__ or another key an object treats specially). */
  var STEP_ID = /^[a-z0-9][a-z0-9-]{0,59}$/i;
  /* A must-understand feature a run/3 now uses, kept in the frozen order. */
  function addFeature(r, f) { var list = (r.features || []).concat([f]); r.features = PF.envelope.FROZEN.filter(function (x) { return list.indexOf(x) >= 0; }); }
  /* run/3's pins and migrations sit right before its steps, as in the frozen samples. */
  function withPins(r) {
    var out = {};
    Object.keys(r).forEach(function (k) {
      if (k === 'pins' || k === 'migrations') return;
      if (k === 'steps') { if (r.pins) out.pins = r.pins; if (r.migrations) out.migrations = r.migrations; }
      out[k] = r[k];
    });
    return out;
  }

  /* A run's checklist, parsed once for every run that shares it: keyed by version folder and fingerprint, and used only
     when the stored text is exactly the run's. Entries stay while loaded runs use them (mapMemo.keep after each accepted
     load) and go with the folder (mapMemo.clear), so there's no fixed size for many interleaved versions to thrash. The
     map is shared, so nothing may change it; tests deep-freeze it (mapMemo.freeze) to prove that. */
  var memo = Object.create(null), memoStats = { parses: 0 };
  function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(function (k) { deepFreeze(o[k]); }); } return o; }
  function parsed(text) { memoStats.parses++; var m = M.parse(text); return mapMemo.freeze ? deepFreeze(m) : m; }
  function mapOf(r) {
    var k = r.folder + '|' + r.mapHash, e = memo[k];
    if (e && e.snapshot === r.snapshot) return e.map;
    if (e) return parsed(r.snapshot);
    e = memo[k] = { snapshot: r.snapshot, map: parsed(r.snapshot) };
    return e.map;
  }
  var mapMemo = {
    freeze: false, deepFreeze: deepFreeze,
    keep: function (runs) { var used = Object.create(null); (runs || []).forEach(function (r) { if (r) used[r.folder + '|' + r.mapHash] = true; }); Object.keys(memo).forEach(function (k) { if (!used[k]) delete memo[k]; }); },
    clear: function () { memo = Object.create(null); },
    stats: function () { return { parses: memoStats.parses, size: Object.keys(memo).length }; }
  };
  function jiraFor(map, workflows) {
    var out = {};
    if (!workflows) return out;
    /* Every workflow, not just the ones the map names: an issue type or status can be filled in during the run. */
    if (M.steps(map).some(function (x) { return x.step.type === 'jira.issue'; })) Object.keys(workflows).forEach(function (k) { out[k] = workflows[k]; });
    return out;
  }
  /* A step's evidence: what its type asks for, plus, for a Jira transition, the fields the team's workflow requires. */
  function evidenceFor(r, step, fields) {
    var t = PF.types.get(step.type, r.types), f = fields || fieldsOf(r, step), extra = [];
    if (step.type === 'jira.issue' && String(f.action || '').toLowerCase() === 'transition' && f.status && r.jira) {
      var w = PF.jira.forType(r.jira, f.issueType);
      if (w) PF.jira.requiredFields(w.workflow, f.status).forEach(function (j) {
        var d = { name: PF.jira.key(j.name), label: j.name, kind: j.options ? 'choice' : 'text', required: true, hint: j.hint, source: j.source, jira: true };
        if (j.options) d.options = j.options;
        extra.push(d);
      });
    }
    String(f.sets || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (d) {
      extra.push({ name: detailKey(d), label: d, kind: 'text', required: true, max: 120, hint: 'A run detail: later steps use it as ^' + d + '.', source: 'detail:' + d, detail: d });
    });
    return { type: t, fields: f, extra: extra, list: PF.types.recordFields(t, f, extra) };
  }
  /* The evidence key a step stores a run detail it sets under: short and safe as a run-file key. */
  function detailKey(d) { return 'rd-' + U.slug(String(d), 20) + '-' + U.hash(String(d)); }
  /* After a step that sets run details is checked or corrected, its values become the run's details, re-checking later
     steps tied to them, but never the step that set them. */
  function applySets(r, map, step, who, now, only) {
    var a = r.steps[step.id];
    if (!a || a.s !== 'done' || !a.values) return;
    evidenceFor(r, step).list.forEach(function (d) { if (d.detail && a.values[d.name] != null && (!only || only.indexOf(d.detail) >= 0)) setDetail(r, map, d.detail, a.values[d.name], who, now, step.id); });
  }
  /* A Jira transition the run's copy of the team workflow doesn't have. Without a workflow file, nothing is checked. */
  function jiraProblem(r, step, fields) {
    var f = fields || fieldsOf(r, step), keys = Object.keys(r.jira || {});
    if (step.type !== 'jira.issue' || String(f.action || '').toLowerCase() !== 'transition' || !keys.length) return null;
    var fp = PF.jira.fileProblem(r.jira);
    if (fp) return 'The team\'s jira/workflows.json couldn\'t be read when this run started (' + fp + '), so Jira transitions can\'t be checked in it. Fix the file, then start a new run.';
    var w = PF.jira.forType(r.jira, f.issueType);
    if (!w) return f.issueType ? 'The team\'s Jira workflows have no issue type "' + f.issueType + '". Use one of: ' + keys.join(', ') + '.' : 'Fill in the issue type (' + keys.join(', ') + ') so Flightdeck knows which workflow and required fields apply.';
    if (w.workflow.invalid) return 'The team\'s ' + w.type + ' workflow has errors (' + w.workflow.invalid + '), so this transition can\'t be checked until jira/workflows.json is fixed and a new run is started.';
    if (!f.status) return 'Fill in the status this step moves the issue to.';
    if (w.workflow.statuses.indexOf(f.status) < 0 || !PF.jira.into(w.workflow, f.status).length) return 'Jira\'s ' + w.type + ' workflow has no transition to "' + f.status + '". Statuses: ' + w.workflow.statuses.join(', ') + '.';
    return null;
  }
  function checkEvidence(r, step, fields, values, partial) { var e = evidenceFor(r, step, fields); return PF.types.checkRecord(e.type, e.fields, values, partial, e.extra); }
  /* run.json keeps the latest LOG_MAX log entries and HISTORY_MAX earlier answers per step, so it stays small to read and save.
     Older ones aren't dropped: they go to r._overflow, which the save appends to the run's history file (see repo.saveRun). */
  function archive(r, rec) { rec.id = rec.id || U.randomId(10); (r._overflow = r._overflow || []).push(rec); }
  function addLog(r, by, at, what) {
    r.log.push({ at: at, by: by, what: what });
    if (r.log.length > LOG_MAX) r.log.splice(0, r.log.length - LOG_MAX).forEach(function (l) { archive(r, { kind: 'log', at: l.at, by: l.by, what: l.what }); });
  }

  /* ---------- Reading state ---------- */
  function answered(r, s) {
    var a = r.steps[s.id];
    if (!a) return false;
    /* A step whose linked child run was for other details isn't answered, however it's marked. */
    if (a.s === 'done' && s.type === 'run.process' && a.child && !childCurrent(r, s, a)) return false;
    return a.s === 'done' || (a.s === 'na' && !s.must);
  }
  function phaseInfo(r, map, pi) {
    var p = map.phases[pi], info = { total: p.steps.length, done: 0, left: 0, mustLeft: 0, blocked: [], recheck: 0 };
    p.steps.forEach(function (s) {
      var a = r.steps[s.id];
      if (answered(r, s)) info.done++;
      else { info.left++; if (s.must) info.mustLeft++; }
      if (a && a.s === 'blocked') info.blocked.push(s);
      if (a && a.s === 'recheck') info.recheck++;
    });
    return info;
  }
  /* What a gate approves right now: the run details it depends on. */
  function gateInputs(r, map, gate) {
    var out = {};
    gate.binds.forEach(function (f) { out[f] = r.details[f] || ''; });
    return out;
  }
  function sameInputs(a, b) {
    var ka = Object.keys(a || {}), kb = Object.keys(b || {});
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return (a[k] || '') === (b[k] || ''); });
  }
  function gateOk(st) { return st === 'passed' || st === 'waived'; }

  /* passed | waived | failed | review | ready | open | locked */
  function gateStatus(r, map, pi) {
    if (pi > 0 && !gateOk(gateStatus(r, map, pi - 1))) return 'locked';
    var g = map.phases[pi].gate, rec = r.gates[g.id], info = phaseInfo(r, map, pi);
    if (rec && rec.s === 'failed') return 'failed';
    if (rec && rec.s === 'review') return 'review';
    if (rec && (rec.s === 'passed' || rec.s === 'waived')) {
      var stillValid = sameInputs(rec.approved, gateInputs(r, map, g)) && !info.blocked.length &&
        (rec.s === 'passed' ? info.left === 0 : info.mustLeft === 0);
      return stillValid ? rec.s : 'review';
    }
    if (info.left === 0 && !info.blocked.length) return 'ready';
    return 'open';
  }
  function phaseOpen(r, map, pi) {
    if (r.state !== 'running') return false;
    if (pi > 0 && !gateOk(gateStatus(r, map, pi - 1))) return false;
    var st = gateStatus(r, map, pi);
    return st !== 'passed' && st !== 'waived';
  }
  function blockedSteps(r, map) {
    var out = [];
    M.steps(map).forEach(function (x) { var a = r.steps[x.step.id]; if (a && a.s === 'blocked') out.push(x); });
    return out;
  }
  function canPass(r, map, pi) { var st = gateStatus(r, map, pi); return r.state === 'running' && (st === 'ready' || (st === 'review' && phaseInfo(r, map, pi).left === 0 && !phaseInfo(r, map, pi).blocked.length)); }
  function canWaive(r, map, pi) {
    var st = gateStatus(r, map, pi);
    var info = phaseInfo(r, map, pi);
    return r.state === 'running' && st !== 'locked' && st !== 'passed' && st !== 'waived' && info.mustLeft === 0 && !info.blocked.length;
  }
  function allGatesOk(r, map) { for (var i = 0; i < map.phases.length; i++) if (!gateOk(gateStatus(r, map, i))) return false; return true; }

  /* The one sentence that says where the run is. */
  function headline(r, map) {
    if (r.paused && !r.ended) return { s: 'paused', text: 'Paused: ' + r.paused.reason, sub: 'Paused since ' + U.hm(r.paused.at) + '. Resume to continue.' };
    if (r.ended) return { s: r.ended.outcome === 'Completed' ? 'complete' : 'stopped', text: 'Ended: ' + r.ended.outcome, sub: 'by ' + r.ended.byName };
    var blocked = blockedSteps(r, map);
    if (blocked.length) { var b = blocked[0], a = r.steps[b.step.id]; return { s: 'stopped', text: 'Stopped: ' + b.step.text, sub: 'Blocked (' + a.reason + '). Resolve it before anyone moves on.', step: b.step.id }; }
    for (var pi = 0; pi < map.phases.length; pi++) {
      var st = gateStatus(r, map, pi), g = map.phases[pi].gate, info = phaseInfo(r, map, pi);
      if (st === 'passed' || st === 'waived') continue;
      if (st === 'failed') return { s: 'stopped', text: 'Gate failed: ' + g.title, sub: 'Reopen it once the problem is fixed, or end the run.', gate: g.id };
      if (st === 'review') return { s: 'working', text: 'Needs review: ' + g.title, sub: 'Something it approved has changed. Check again, then pass it.', gate: g.id };
      if (st === 'ready') return { s: 'ready', text: 'Ready: ' + g.title, sub: g.implicit ? 'Every step is answered. Confirm ' + (solo(r) ? 'it' : 'together') + ', then move on.' : 'Every step is answered. ' + (g.approves ? 'It approves ' + fill(g.approves, r.details) + '.' : 'Confirm it to move on.'), gate: g.id };
      return { s: 'working', text: map.phases[pi].title + ': ' + info.left + ' step' + (info.left === 1 ? '' : 's') + ' to go', sub: (info.mustLeft ? info.mustLeft + ' must-do. ' : '') + 'Then ' + (g.implicit ? (solo(r) ? 'confirm the phase.' : 'confirm together.') : 'the "' + g.title + '" gate.'), phase: pi };
    }
    return { s: 'complete', text: 'Every gate passed', sub: 'End the run as Completed when you\'re done.' };
  }

  /* A run is solo when nobody but the recorder is assigned to it: a developer or product owner working through a checklist alone. */
  function solo(r) {
    var who = {}; if (r.recorder.person) who[r.recorder.person] = 1;
    Object.keys(r.roles).forEach(function (k) { if (r.roles[k]) who[r.roles[k]] = 1; });
    return Object.keys(who).length <= 1;
  }
  function fill(text, details) { return String(text || '').replace(/\^([\w-]+)/g, function (_, f) { return details[f] || ('(' + f + ' not set)'); }); }

  /* ---------- Changing state (the recorder's window only) ---------- */
  function guardStep(r, map, id) {
    var x = M.findStep(map, id);
    if (!x) throw new Error('Unknown step.');
    if (!phaseOpen(r, map, x.phaseIndex)) throw new Error('That phase isn\'t open.');
    if (r.paused) throw new Error('The run is paused. Resume it to change steps.');
    return x;
  }
  /* Every new answer keeps the earlier ones (who, when, how), so nothing done during a run is erased. */
  var HISTORY_MAX = 10;
  /* Every deviation a step ever had in this run (blocked, re-checked, N/A, done differently), kept even after older answers are
     archived, so "was this run clean?" never depends on how much history run.json still holds. */
  function mark(r, id, kind) { var m = (r.marks = r.marks || {}), k = Object.prototype.hasOwnProperty.call(m, id) ? m[id] : (m[id] = []); if (k.indexOf(kind) < 0) k.push(kind); }
  function answer(r, id, rec) {
    if (rec.s === 'blocked' || rec.s === 'recheck' || rec.s === 'na') mark(r, id, rec.s);
    var prev = r.steps[id] || {}, history = (prev.history || []).slice();
    /* A run/3 skill step's earlier answer keeps the registration it observed (skill), so a re-check never loses it. */
    if (prev.s && prev.s !== 'open') history.push(prev.skill ? { s: prev.s, by: prev.by, at: prev.at, reason: prev.reason, differently: prev.differently, values: prev.values, skill: prev.skill } : { s: prev.s, by: prev.by, at: prev.at, reason: prev.reason, differently: prev.differently, values: prev.values });
    /* Anything leaving run.json for the archive leaves its mark behind, so readiness never depends on how much history is kept. */
    if (prev.s === 'blocked' || prev.s === 'recheck' || prev.s === 'na') mark(r, id, prev.s);
    if (prev.differently) mark(r, id, 'differently');
    if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX).forEach(function (h) { if (h.s === 'blocked' || h.s === 'recheck' || h.s === 'na') mark(r, id, h.s); if (h.differently) mark(r, id, 'differently'); archive(r, Object.assign({ kind: 'answer', step: id }, h)); });
    rec.started = prev.started; rec.deadline = prev.deadline; if (prev.child) rec.child = prev.child;
    /* Values noted so far stay with the step, except when a changed detail makes them stale (a re-check). */
    if (!rec.values && prev.values && rec.s !== 'recheck') rec.values = prev.values;
    if (history.length) rec.history = history;
    r.steps[id] = rec;
  }
  /* A step's map fields, with any values filled in for this run. */
  function fieldsOf(r, step) { return Object.assign({}, step.fields, (r.fields || {})[step.id] || {}); }
  /* Evidence the map requires (require: build) is checked here, so a step can't be done without it. Values noted earlier count. */
  function done(r, map, id, who, now, values) {
    var x = guardStep(r, map, id), t = PF.types.get(x.step.type, r.types), rec = { s: 'done', by: who, at: now };
    var prev = r.steps[id] && r.steps[id].s !== 'recheck' ? r.steps[id].values : null;
    var jp = jiraProblem(r, x.step);
    if (jp) throw new Error(jp);
    var cur = r.steps[id];
    if (x.step.type === 'run.process' && !(cur && cur.child)) throw new Error('Start the ' + (fieldsOf(r, x.step).process || 'linked') + ' run for this step; the step is checked when it completes.');
    if (x.step.type === 'run.process' && cur && cur.child && !(values && values._child === cur.child.id)) {
      throw new Error(childCurrent(r, x.step, cur) ? 'This step is checked when its ' + cur.child.process + ' run completes.' : 'Its ' + cur.child.process + ' run was for different details. Start a new one; this step is checked when it completes.');
    }
    if (values && values._child) { values = Object.assign({}, values); delete values._child; }
    /* A skill step in a run/3 keeps the registration as observed when it was checked (PF.skills.observed). It doesn't prove
       which skill ran. A run/2 records nothing new: its format is frozen. */
    var seen = values && values._skill;
    if (values && '_skill' in values) { values = Object.assign({}, values); delete values._skill; }
    var chk = checkEvidence(r, x.step, null, Object.assign({}, prev || {}, values || {}));
    if (chk.error) throw new Error(chk.error);
    if (Object.keys(chk.values).length) rec.values = chk.values;
    if (seen && r.format === FORMAT3 && x.step.type === 'run.skill' && cleanSkill(seen)) { rec.skill = cleanSkill(seen); addFeature(r, 'pinned-skills'); }
    answer(r, id, rec);
    applySets(r, map, x.step, who, now);
    return x;
  }
  /* A step's registration snapshot: { id, rev, sha, snapshot } with a snapshot of at most 2 KB, or null. */
  function cleanSkill(s) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !/^sk-[a-z0-9]{8}$/.test(s.id) || typeof s.rev !== 'number' || s.rev < 1 || Math.floor(s.rev) !== s.rev || typeof s.sha !== 'string' || !/^[0-9a-f]{64}$/.test(s.sha)) return null;
    var snap = s.snapshot && typeof s.snapshot === 'object' && !Array.isArray(s.snapshot) ? s.snapshot : null, text = snap ? JSON.stringify(snap) : '';
    if (!snap || text.length > 2048) return null;
    return { id: s.id, rev: s.rev, sha: s.sha, snapshot: JSON.parse(text) };
  }
  /* What a {run.skill} step expects (skillVersion:) against the registration the team folder holds now, or '' (a warning,
     never a block). */
  function skillWarning(r, step, reg) {
    var want = String(fieldsOf(r, step).skillVersion || '').trim();
    if (!want || !reg) return '';
    return reg.version === want ? '' : 'This step expects ' + (reg.name || fieldsOf(r, step).skill) + ' ' + want + '. The team folder registers ' + (reg.version || 'no version') + '.';
  }
  /* Fill in or correct a step's values for this run as they become known: map fields (a Jenkins parameter, the issue)
     and evidence (a PR link) before or after the step is checked. Clarifying never sends anything back for a re-check, but it's logged. */
  function setFields(r, map, id, fields, values, who, now) {
    var x = M.findStep(map, id);
    if (!x) throw new Error('Unknown step.');
    if (r.state !== 'running') throw new Error('This run has ended.');
    notPaused(r);
    var t = PF.types.get(x.step.type, r.types), allowed = PF.types.editable(t), changed = [], checked = r.steps[id] && r.steps[id].s === 'done';
    var prior = { fields: Object.assign({}, fieldsOf(r, x.step)), values: Object.assign({}, (r.steps[id] && r.steps[id].values) || {}) };
    function fail(msg, field) { var e = new Error(msg); e.field = field; return e; }
    function shown(v) { return v ? '"' + String(v).slice(0, 60) + '"' : 'empty'; }
    var own = Object.assign({}, (r.fields || {})[id] || {});
    Object.keys(fields || {}).forEach(function (f) {
      if (allowed.indexOf(f) < 0) throw fail('"' + f + '" can\'t be changed during a run.', 'fld-' + f);
      var v = String(fields[f] == null ? '' : fields[f]).trim().slice(0, 300), before = fieldsOf(r, x.step)[f] || '';
      if (v === before) return;
      var def = PF.types.fieldDef(t, f);
      if (v && def.kind === 'choice' && PF.types.hasOption(def, fieldsOf(r, x.step), v)) v = PF.types.canonical(def, fieldsOf(r, x.step), v);
      if (v && def.kind === 'choice' && !PF.types.hasOption(def, fieldsOf(r, x.step), v)) throw fail(def.label + ' should be one of: ' + PF.types.options(def, fieldsOf(r, x.step)).join(', ') + '.', 'fld-' + f);
      if (v === (x.step.fields[f] || '')) delete own[f]; else own[f] = v;
      changed.push(def.label + ': ' + shown(before) + ' → ' + shown(v));
    });
    /* A refused correction must leave the run exactly as it was, so keep copies to put back. */
    var keepF = r.fields && r.fields[id] ? JSON.parse(JSON.stringify(r.fields[id])) : null, keepS = r.steps[id] ? JSON.parse(JSON.stringify(r.steps[id])) : null, keepG = JSON.parse(JSON.stringify(r.gates || {})), keepLog = r.log.length, keepO = (r._overflow || []).length;
    function undo() { if (r._overflow) r._overflow.length = Math.min(r._overflow.length, keepO); if (keepF) r.fields[id] = keepF; else delete r.fields[id]; if (keepS) r.steps[id] = keepS; else delete r.steps[id]; r.gates = keepG; r.log.length = Math.min(r.log.length, keepLog); }
    r.fields = r.fields || {};
    if (Object.keys(own).length) r.fields[id] = own; else delete r.fields[id];
    if (changed.length) { var jp = jiraProblem(r, x.step); if (jp) { undo(); throw fail(jp, ''); } }
    var ca = r.steps[id];
    if (changed.length && x.step.type === 'run.process' && ca && ca.child && ca.s === 'done' && !childCurrent(r, x.step, ca)) {
      answer(r, id, { s: 'recheck', reason: 'The step changed: its ' + ca.child.process + ' run no longer matches', by: who, at: now });
      var g = r.gates[map.phases[x.phaseIndex].gate.id];
      if (g && (g.s === 'passed' || g.s === 'waived')) r.gates[map.phases[x.phaseIndex].gate.id] = { s: 'review', was: g.s, by: g.by, at: g.at, reason: 'A child-run step changed', approved: g.approved };
    }
    if (values) {
      var chk = checkEvidence(r, x.step, null, values, true);
      if (chk.error) { undo(); throw fail(chk.error, chk.field ? 'rec-' + chk.field : ''); }
      var a = r.steps[id] = r.steps[id] || { s: 'open' }, old = a.values || {}, merged = {};
      evidenceFor(r, x.step).list.forEach(function (d) {
        var v = Object.prototype.hasOwnProperty.call(values, d.name) ? chk.values[d.name] || '' : old[d.name] || '';
        if (v) merged[d.name] = v;
        if ((old[d.name] || '') !== v) changed.push(d.label + ': ' + shown(old[d.name]) + ' → ' + shown(v));
      });
      if (Object.keys(merged).length) a.values = merged; else delete a.values;
      var producedChanged = evidenceFor(r, x.step).list.filter(function (d) { return d.detail && (old[d.name] || '') !== (merged[d.name] || ''); }).map(function (d) { return d.detail; });
    }
    /* A checked step keeps the evidence its map requires: a correction can change it, never remove it. */
    if (checked) {
      var missing = evidenceFor(r, x.step, Object.assign({}, x.step.fields, own)).list.filter(function (d) { return d.required && !((r.steps[id].values || {})[d.name]); })[0];
      if (missing) { undo(); throw fail(missing.label + ' is required for this step, so it can\'t be removed while the step is checked. Undo the check first if it really wasn\'t done.', 'rec-' + missing.name); }
    }
    /* Correcting a checked step keeps the full earlier record in its history, including evidence the new values no longer use. */
    if (changed.length && checked) {
      var a2 = r.steps[id], h = (a2.history || []).slice();
      h.push({ s: 'corrected', by: who, at: now, fields: prior.fields, values: prior.values });
      if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX).forEach(function (o) { archive(r, Object.assign({ kind: 'answer', step: id }, o)); });
      a2.history = h;
    }
    if (changed.length) addLog(r, who, now, 'Filled in ' + changed.join(', ') + ' on "' + x.step.text + '"' + (r.steps[id] && r.steps[id].s === 'done' ? ' (after it was checked)' : ''));
    if (typeof producedChanged !== 'undefined' && producedChanged.length) applySets(r, map, x.step, who, now, producedChanged);
    return changed;
  }
  function na(r, map, id, who, now) { var x = guardStep(r, map, id); if (x.step.must) throw new Error('Must-do steps can\'t be N/A.'); answer(r, id, { s: 'na', by: who, at: now }); return x; }
  function block(r, map, id, reason, who, now) { var x = guardStep(r, map, id); answer(r, id, { s: 'blocked', reason: String(reason || 'Blocked').slice(0, 120), by: who, at: now }); addLog(r, who, now, 'Blocked "' + x.step.text + '": ' + r.steps[id].reason); return x; }
  function clear(r, map, id, who, now) {
    var x = guardStep(r, map, id), prev = r.steps[id];
    if (!prev || prev.s === 'open') return x;
    /* A run/2 step continued in a 2.0 run stays blocked here: reopening it would start the child this run can't follow. */
    if (r.format !== FORMAT3 && prev.s === 'blocked' && /^Continued in run /.test(prev.reason || '')) throw new Error('This step ' + prev.reason.charAt(0).toLowerCase() + prev.reason.slice(1) + ', made with Flightdeck 2.0. Open that run, or start it as a Flightdeck 2.0 run again.');
    answer(r, id, { s: 'open' });
    if (prev.s === 'blocked') addLog(r, who, now, 'Unblocked "' + x.step.text + '"');
    return x;
  }
  function differently(r, map, id, note, who, now) {
    notPaused(r);
    var a = r.steps[id];
    if (!a || a.s !== 'done') throw new Error('Mark the step done first.');
    a.differently = { note: String(note || '').slice(0, 500), by: who, at: now };
    mark(r, id, 'differently');
  }
  /* Done differently answers the step: every rule of Done applies first (required evidence, a child run, a pause, must-do),
     so it's never a way around them. What happened is required. A step already done just gains the note. */
  function doneDifferently(r, map, id, happened, who, now, values) {
    var note = String(happened || '').replace(/\s+/g, ' ').trim();
    if (!note) { var e = new Error('Say what happened.'); e.field = 'corr-happened'; throw e; }
    var a = r.steps[id];
    if (!(a && a.s === 'done')) done(r, map, id, who, now, values);
    differently(r, map, id, note, who, now);
    addLog(r, who, now, 'Done differently "' + M.findStep(map, id).step.text + '": ' + note.slice(0, 120));
  }
  function start(r, map, id, who, now) { guardStep(r, map, id); var a = r.steps[id] = r.steps[id] || { s: 'open' }; a.started = { by: who, at: now }; }
  function setDeadline(r, map, id, iso, who, now) { var x = guardStep(r, map, id); var a = r.steps[id] = r.steps[id] || { s: 'open' }; a.deadline = { at: iso, by: who, set: now }; addLog(r, who, now, 'Set the deadline for "' + x.step.text + '" to ' + U.hm(iso) + ' (copied from the external system)'); }

  function pass(r, map, pi, who, now) {
    notPaused(r);
    if (!canPass(r, map, pi)) throw new Error('This gate isn\'t ready to pass.');
    var g = map.phases[pi].gate;
    r.gates[g.id] = { s: 'passed', by: who, at: now, approved: gateInputs(r, map, g) };
    addLog(r, who, now, 'Passed gate "' + g.title + '"' + (g.binds.length ? ' for ' + describe(r.gates[g.id].approved) : ''));
  }
  function waive(r, map, pi, reason, who, now) {
    notPaused(r);
    if (!canWaive(r, map, pi)) throw new Error('This gate can\'t be waived: every must-do step has to be done, and nothing can be blocked.');
    if (!String(reason || '').trim()) throw new Error('Say why the gate is waived.');
    var g = map.phases[pi].gate;
    r.gates[g.id] = { s: 'waived', reason: String(reason).slice(0, 200), by: who, at: now, approved: gateInputs(r, map, g) };
    addLog(r, who, now, 'Waived gate "' + g.title + '": ' + r.gates[g.id].reason);
  }
  function fail(r, map, pi, reason, who, now) {
    notPaused(r);
    var g = map.phases[pi].gate;
    if (gateStatus(r, map, pi) === 'locked') throw new Error('That gate isn\'t open yet.');
    r.gates[g.id] = { s: 'failed', reason: String(reason || 'Failed').slice(0, 200), by: who, at: now };
    addLog(r, who, now, 'Failed gate "' + g.title + '": ' + r.gates[g.id].reason);
  }
  /* Reopening never undoes work done outside Flightdeck; it only asks for the gate (and later ones) to be checked again. */
  function reopen(r, map, pi, who, now) {
    notPaused(r);
    for (var i = pi; i < map.phases.length; i++) delete r.gates[map.phases[i].gate.id];
    addLog(r, who, now, 'Reopened gate "' + map.phases[pi].gate.title + '"');
  }

  /* Changing a run detail sends tied steps back for a re-check; tied gates turn to "needs review" on their own. */
  function setDetail(r, map, field, value, who, now, except) {
    notPaused(r);
    if (map.meta.context.indexOf(field) < 0) throw new Error('Unknown run detail.');
    var old = String(r.details[field] || '').trim(), v = String(value || '').trim().slice(0, 120);
    if (old === v) return 0;
    r.details[field] = v;
    var n = 0, viaChildren = [];
    M.steps(map).forEach(function (x) {
      var a = r.steps[x.step.id];
      var viaChild = x.step.type === 'run.process' && a && a.child && Object.prototype.hasOwnProperty.call(childInputs(r, x.step, a.child.inputs), field);
      if (x.step.id !== except && (x.step.binds.indexOf(field) >= 0 || viaChild) && a && (a.s === 'done' || a.s === 'na')) { if (viaChild) viaChildren.push(x.step.id); answer(r, x.step.id, { s: 'recheck', reason: field + ' changed' + (viaChild ? ': its ' + a.child.process + ' run was for the old value' : ''), by: who, at: now }); n++; }
    });
    /* Gates that approved the old value, or whose phase now has a re-check, stay "needs review" until someone passes them again. */
    map.phases.forEach(function (p) {
      var g = r.gates[p.gate.id];
      if (!g || (g.s !== 'passed' && g.s !== 'waived')) return;
      var tied = p.gate.binds.indexOf(field) >= 0 || p.steps.some(function (st) { var a = r.steps[st.id]; return a && a.s === 'recheck' && (st.binds.indexOf(field) >= 0 || viaChildren.indexOf(st.id) >= 0); });
      if (tied) r.gates[p.gate.id] = { s: 'review', was: g.s, by: g.by, at: g.at, reason: field + ' changed', approved: g.approved };
    });
    addLog(r, who, now, 'Changed ' + field + (old ? ' from ' + old : '') + ' to ' + (v || '(empty)') + (n ? '; ' + n + ' step' + (n === 1 ? '' : 's') + ' need a re-check' : ''));
    return n;
  }
  function setRole(r, map, role, person, who, now) {
    notPaused(r);
    if (map.meta.roles.indexOf(role) < 0) throw new Error('Unknown role.');
    r.roles[role] = person || '';
    addLog(r, who, now, 'Assigned ' + role + ' to ' + (person || 'nobody'));
  }

  /* ---------- Recording ---------- */
  /* Handing off names the exact revision being passed on (the one this save writes). The new recorder can pick up only once
     that revision has reached their computer, so nobody records on top of a copy that's still syncing. */
  /* links: the child runs this run's steps link to (legacyLinks). A run/2 parent linked to a run/3 child can't change hands
     in 2.0: the next recorder could be an older copy, which would read the child by name only and settle the step from its
     outcome alone (review #1). */
  function refuseLegacy(links) {
    var bad = (links || []).filter(function (l) { return l && l.legacy; })[0];
    if (bad) throw new Error(LEGACY_LINK.replace('<step>', bad.text || bad.step));
  }
  function handOff(r, toPerson, who, now, links) {
    refuseLegacy(links);
    r.recorder = { person: toPerson, session: null, handoff: { from: who, rev: (r.rev || 0) + 1, at: now } };
    addLog(r, who, now, 'Handed recording to ' + toPerson);
  }
  function waitingForHandoff(r) { var h = r.recorder.handoff; return !!h && (r.rev || 0) < h.rev; }
  function pickUp(r, person, session, now, links) {
    refuseLegacy(links);
    if (waitingForHandoff(r)) throw new Error('The handed-over copy hasn\'t reached this computer yet. OneDrive is still syncing it; try again in a moment.');
    r.recorder = { person: person, session: session };
    addLog(r, person, now, 'Picked up recording at revision ' + (r.rev || 0));
  }
  /* For emergencies. The other computer may still have changes OneDrive hasn't delivered; if it does, they arrive as a conflict copy to review. */
  function takeOver(r, person, session, now, links) {
    refuseLegacy(links);
    var from = r.recorder.person;
    r.recorder = { person: person, session: session };
    addLog(r, person, now, 'Took over recording from ' + from + ' at revision ' + (r.rev || 0));
  }

  /* What differs between two copies of the same run, in plain sentences, for choosing which to keep.
     Covers everything a person could have recorded: answers and their evidence, filled-in values, gates, details, roles,
     who's recording, follow-ups and how the run ended. */
  function compare(cur, other, map, nameOf) {
    var out = [], T = PF.types;
    function word(a) { return !a || a.s === 'open' ? 'not checked' : { done: 'done', na: 'N/A', blocked: 'blocked', recheck: 'needs a re-check' }[a.s]; }
    function vals(o) { return Object.keys(o || {}).sort().map(function (k) { return k + '=' + o[k]; }).join(', '); }
    function pair(label, a, b) { if ((a || '') !== (b || '')) out.push(label + ': "' + (a || '') + '" here, "' + (b || '') + '" in the copy'); }
    if (other.id !== cur.id || other.mapHash !== cur.mapHash) out.push('The copy is for a different run or checklist version, so it can\'t be kept.');
    M.steps(map).forEach(function (x) {
      var a = cur.steps[x.step.id], b = other.steps[x.step.id], name = '"' + x.step.text + '"';
      if (word(a) !== word(b)) out.push(name + ': ' + word(a) + ' here, ' + word(b) + ' in the copy' + (b && b.by ? ' (' + nameOf(b.by) + ')' : ''));
      else if (a && b) { pair(name + ' answered by', a.by && nameOf(a.by), b.by && nameOf(b.by)); pair(name + ' answered at', a.at, b.at); pair(name + ' reason', a.reason, b.reason); }
      var t = T.get(x.step.type, cur.types), av = (a && a.values) || {}, bv = (b && b.values) || {};
      evidenceFor(cur, x.step, Object.assign({}, x.step.fields, (cur.fields || {})[x.step.id], (other.fields || {})[x.step.id])).list.forEach(function (d) { pair(name + ' ' + d.label, av[d.name], bv[d.name]); });
      if (vals(av) !== vals(bv) && !evidenceFor(cur, x.step, x.step.fields).list.length) pair(name + ' evidence', vals(av), vals(bv));
      pair(name + ' done differently', a && a.differently && a.differently.note, b && b.differently && b.differently.note);
      var ah = JSON.stringify((a && a.history) || []), bh = JSON.stringify((b && b.history) || []);
      if (ah !== bh) out.push(name + ': earlier answers differ (' + ((a && a.history) || []).length + ' here, ' + ((b && b.history) || []).length + ' in the copy)');
      pair(name + ' deadline', a && a.deadline && a.deadline.at, b && b.deadline && b.deadline.at);
      pair(name + ' started', a && a.started && a.started.at, b && b.started && b.started.at);
      var af = (cur.fields || {})[x.step.id] || {}, bf = (other.fields || {})[x.step.id] || {};
      Object.keys(Object.assign({}, af, bf)).forEach(function (f) { var d = T.fieldDef(t, f); pair(name + ' ' + (d ? d.label : f), af[f], bf[f]); });
    });
    map.phases.forEach(function (p) {
      var a = cur.gates[p.gate.id] || {}, b = other.gates[p.gate.id] || {};
      if ((a.s || 'open') !== (b.s || 'open')) out.push('Gate "' + p.gate.title + '": ' + (a.s || 'open') + ' here, ' + (b.s || 'open') + ' in the copy');
      else if (JSON.stringify([a.by, a.at, a.reason, a.approved]) !== JSON.stringify([b.by, b.at, b.reason, b.approved])) out.push('Gate "' + p.gate.title + '": passed for different details or by someone else (' + (a.approved ? JSON.stringify(a.approved) : '-') + ' here, ' + (b.approved ? JSON.stringify(b.approved) : '-') + ' in the copy)');
    });
    Object.keys(Object.assign({}, cur.details, other.details)).forEach(function (k) { pair(k, cur.details[k], other.details[k]); });
    Object.keys(Object.assign({}, cur.roles, other.roles)).forEach(function (k) { pair('Role ' + k, cur.roles[k] && nameOf(cur.roles[k]), other.roles[k] && nameOf(other.roles[k])); });
    pair('Recording', nameOf(cur.recorder.person), nameOf(other.recorder.person));
    function fu(list) { return (list || []).map(function (f) { return f.text + (f.owner ? ' (' + nameOf(f.owner) + ')' : '') + (f.ticket ? ' [' + f.ticket + ']' : ''); }).join('; '); }
    pair('Follow-ups', fu(cur.followUps), fu(other.followUps));
    pair('Ended', cur.ended ? cur.ended.outcome : 'still running', other.ended ? other.ended.outcome : 'still running');
    pair('Paused', cur.paused ? 'paused at ' + cur.paused.at + ' by ' + nameOf(cur.paused.by) + ': ' + cur.paused.reason : 'not paused', other.paused ? 'paused at ' + other.paused.at + ' by ' + nameOf(other.paused.by) + ': ' + other.paused.reason : 'not paused');
    if (JSON.stringify(cur.pauses || []) !== JSON.stringify(other.pauses || [])) out.push('Pause history: ' + (cur.pauses || []).length + ' pauses here, ' + (other.pauses || []).length + ' in the copy');
    if (JSON.stringify(cur.jira || {}) !== JSON.stringify(other.jira || {})) out.push('The copy has a different copy of the Jira workflows.');
    pair('Part of', cur.parent && JSON.stringify(cur.parent), other.parent && JSON.stringify(other.parent));
    M.steps(map).forEach(function (x) { var a = cur.steps[x.step.id], b = other.steps[x.step.id]; pair('"' + x.step.text + '" child run', a && a.child && JSON.stringify(a.child), b && b.child && JSON.stringify(b.child)); });
    if (!out.length) out.push('No differences in answers, evidence, values, gates, details, roles, follow-ups, pauses or outcome.');
    return out;
  }
  /* Make a conflict copy the current version. Everything a person recorded comes from the copy; both versions' activity stays
     in the log. Refuses a copy of another run or of another map version. The caller keeps the displaced version. */
  function adopt(cur, copy, who, now) {
    if (!copy || copy.id !== cur.id || copy.process !== cur.process) throw new Error('That copy belongs to a different run.');
    if (copy._unrunnable) throw new Error(copy._unrunnable + ' That copy can only be read here, so it wasn\'t kept.');
    if (copy.mapHash !== cur.mapHash || copy.folder !== cur.folder) throw new Error('That copy was made from a different version of the checklist, so it can\'t replace this one.');
    /* Every deviation either version shows (in its marks, its answers or their earlier answers), taken before the copy's
       answers replace this version's, so a run from before marks existed can't lose a block by being recovered. */
    var seenMarks = [cur, copy].map(function (v) { var m = {}; Object.keys(v.marks || {}).forEach(function (k) { m[k] = (v.marks[k] || []).slice(); }); Object.keys(v.steps || {}).forEach(function (k) { var a = v.steps[k] || {}; [a].concat(a.history || []).forEach(function (h) { var kind = h.s === 'blocked' || h.s === 'recheck' || h.s === 'na' ? h.s : null; [kind, h.differently ? 'differently' : null].forEach(function (x) { if (!x) return; var l = Object.prototype.hasOwnProperty.call(m, k) ? m[k] : (m[k] = []); if (l.indexOf(x) < 0) l.push(x); }); }); }); return m; });
    ['steps', 'gates', 'fields', 'details', 'roles', 'followUps', 'title', 'state', 'ended', 'tz', 'shotsFrozen', 'paused', 'pauses', 'jira', 'parent'].forEach(function (k) { cur[k] = JSON.parse(JSON.stringify(copy[k] == null ? (k === 'ended' || k === 'paused' || k === 'parent' ? null : cur[k]) : copy[k])); });
    /* Deviation marks record what happened in this run in either version, so keeping a copy keeps both versions' marks;
       they're complete only if both versions' were. */
    var marks = {};
    seenMarks.forEach(function (m) { Object.keys(m).forEach(function (k) { (Array.isArray(m[k]) ? m[k] : []).forEach(function (v) { var l = Object.prototype.hasOwnProperty.call(marks, k) ? marks[k] : (marks[k] = []); if (l.indexOf(v) < 0) l.push(v); }); }); });
    if (Object.keys(marks).length) cur.marks = marks; else delete cur.marks;
    if (cur.marksFrom !== 'start' || copy.marksFrom !== 'start') delete cur.marksFrom;
    var seen = {}, merged = cur.log.concat(copy.log).filter(function (l) { var k = l.at + '|' + l.by + '|' + l.what; if (seen[k]) return false; seen[k] = 1; return true; }).sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });
    cur.log = [];
    merged.forEach(function (l) { addLog(cur, l.by, l.at, l.what); });
    addLog(cur, who, now, 'Kept a conflict copy as the current version');
  }

  /* ---------- Follow-ups: work a run turns up that outlives it ---------- */
  function addFollowUp(r, f, who, now) {
    var text = String(f.text || '').trim().slice(0, 300);
    if (!text) throw new Error('Say what needs doing.');
    if ((r.followUps || []).length >= 100) throw new Error('This run already has 100 follow-ups. Track the rest in Jira.');
    var item = { id: f.id || U.randomId(8), text: text, owner: String(f.owner || '').slice(0, 80), ticket: String(f.ticket || '').trim().slice(0, 120), step: f.step || '', from: f.from || '', by: who, at: now };
    (r.followUps = r.followUps || []).push(item);
    addLog(r, who, now, 'Follow-up: ' + text);
    return item;
  }
  function removeFollowUp(r, id, who, now) {
    var list = r.followUps || [], i = list.map(function (x) { return x.id; }).indexOf(id);
    if (i < 0) return;
    addLog(r, who, now, 'Removed follow-up: ' + list[i].text);
    list.splice(i, 1);
  }
  /* What a step's record says about how it went differently: a run's corrections and "done differently" answers, in
     checklist order (PF.corrections.forRun). */
  function corrections(r, map, notes) { return PF.corrections.forRun(notes ? Object.assign({}, r, { _notes: notes }) : r, map); }
  /* ---------- Pause and resume ---------- */
  /* A paused run keeps its answers but can't change until it's resumed. Timers stop; deadlines copied from another tool
     keep counting, because that tool doesn't pause. */
  function notPaused(r) { if (r.paused) throw new Error('The run is paused. Resume it first.'); }
  function pause(r, reason, who, now) {
    if (r.state !== 'running') throw new Error('Only a running run can be paused.');
    if (r.paused) return;
    if ((r.pauses || []).length >= 500) throw new Error('This run has been paused 500 times. End it and start a new one.');
    var why = String(reason || '').trim().slice(0, 120);
    if (!why) throw new Error('Say why the run is paused, so others know what it\'s waiting for.');
    r.paused = { by: who, at: now, reason: why };
    addLog(r, who, now, 'Paused the run: ' + why);
  }
  function resume(r, who, now) {
    if (!r.paused) return;
    (r.pauses = r.pauses || []).push({ from: r.paused.at, to: now, by: r.paused.by, reason: r.paused.reason });
    r.paused = null;
    addLog(r, who, now, 'Resumed the run');
  }
  /* Milliseconds between two moments, not counting time the run was paused. */
  function activeMs(r, fromIso, toMs) {
    var a = new Date(fromIso).getTime(), b = toMs, ms = Math.max(0, b - a);
    (r.pauses || []).concat(r.paused ? [{ from: r.paused.at, to: new Date(b).toISOString() }] : []).forEach(function (p) {
      var s1 = Math.max(a, new Date(p.from).getTime()), e1 = Math.min(b, new Date(p.to).getTime());
      if (e1 > s1) ms -= e1 - s1;
    });
    return Math.max(0, ms);
  }

  /* ---------- Schedule: at / due clock times on the run's day, or after a duration from the start ---------- */
  function schedule(r, map, nowMs) {
    var items = [], day = r.created;
    function when(fields) {
      if (fields.at) return { kind: 'at', ms: new Date(U.timeOnDayIn(fields.at, day, r.tz)).getTime() };
      if (fields.due) return { kind: 'due', ms: new Date(U.timeOnDayIn(fields.due, day, r.tz)).getTime() };
      if (fields.after && U.duration(fields.after) != null) return { kind: 'due', ms: new Date(r.created).getTime() + U.duration(fields.after) };
      return null;
    }
    map.phases.forEach(function (p, pi) {
      p.steps.forEach(function (st) {
        var w = when(fieldsOf(r, st)); if (!w || isNaN(w.ms)) return;
        var a = r.steps[st.id], doneAt = a && (a.s === 'done' || a.s === 'na') ? new Date(a.at).getTime() : null;
        items.push({ what: 'step', id: st.id, title: st.text, phase: p.title, kind: w.kind, ms: w.ms, doneAt: doneAt, status: status(w, doneAt) });
      });
      var g = p.gate, gw = g.fields && when(g.fields);
      if (gw && !isNaN(gw.ms)) { var gr = r.gates[g.id], gs = gateStatus(r, map, pi), gDone = (gs === 'passed' || gs === 'waived') && gr ? new Date(gr.at).getTime() : null;
        items.push({ what: 'gate', id: g.id, title: g.implicit ? 'Confirm ' + p.title : g.title, phase: p.title, kind: gw.kind, ms: gw.ms, doneAt: gDone, status: status(gw, gDone) }); }
    });
    function status(w, doneAt) {
      if (doneAt != null) return doneAt > w.ms && w.kind === 'due' ? 'done late' : 'done';
      if (nowMs > w.ms) return w.kind === 'due' ? 'late' : 'started?';
      if (w.ms - nowMs <= 15 * 60000) return 'soon';
      return 'upcoming';
    }
    return items.sort(function (x, y) { return x.ms - y.ms; });
  }

  /* ---------- Nested processes: a run.process step starts a linked child run ---------- */
  /* opts (run/3): { run: the child run itself, procOf, findRun }, so the pin is judged by PF.pins.childMatch. */
  function linkChild(r, map, stepId, child, who, now, opts) {
    /* Linking records a run that already exists, so it's allowed while paused; starting one (in the app) isn't. */
    var x = M.findStep(map, stepId);
    if (!x) throw new Error('Unknown step.');
    if (r.state !== 'running') throw new Error('This run has ended.');
    if (x.step.type !== 'run.process') throw new Error('Only a "run another process" step starts a child run.');
    var a = r.steps[stepId] = r.steps[stepId] || { s: 'open' };
    var o = opts || {}, pinNow = childPin(r, stepId);
    /* A link whose run is here and fails the pin doesn't hold the step: a new run on the pin replaces it. One not visible yet
       (still syncing) still holds it. */
    var had = pinNow && a.child && typeof o.findRun === 'function' ? o.findRun(a.child.process + '/' + a.child.id) : null, offPin = !!had && !!PF.pins.childMatch(pinNow, had, o.procOf);
    if (a.child && childCurrent(r, x.step, a) && !a.child.failed && !offPin) throw new Error('This step already started a run.');
    /* A run/2 parent never adopts a child made with Flightdeck 2.0 (review #1): offer a 2.0 run instead. */
    if (r.format !== FORMAT3 && isTwo(child)) throw new Error(LEGACY_CHILD);
    /* A run/3 adopts only a run of the exact version its step is pinned to (folder and fingerprints), however it was found. */
    /* With no pin yet (the child process wasn't published when the run started), the step is pinned to the adopted run's
       verified version (PF.pins.pinOfRun); one that can't be verified is refused. */
    if (r.format === FORMAT3) {
      var use = pinNow || (child.pin && PF.pins.childOk(child.pin) ? child.pin : null);
      if (!use) { var po = PF.pins.pinOfRun(o.run, o.procOf); if (!po.pin) throw new Error(po.why); use = po.pin; child = Object.assign({}, child, { pin: use }); }
      var pm = PF.pins.childMatch(use, o.run, o.procOf); if (pm) throw new Error(pm);
    }
    if (a.child) {
      addLog(r, who, now, 'Replaced the ' + a.child.process + ' run for "' + x.step.text + '": ' + (a.child.failed ? 'it didn\'t complete' : 'its details changed'));
      /* The old child's answer goes to history; the new child settles the step from scratch. */
      if (a.s !== 'open') { answer(r, stepId, { s: 'open' }); a = r.steps[stepId]; }
    }
    a.child = { process: child.process, id: child.id, inputs: child.inputs && typeof child.inputs === 'object' ? Object.assign({}, child.inputs) : childInputs(r, x.step) };
    /* run/3: the exact version the child runs, and the pin it follows (taken now when the child process wasn't published
       when this run started). */
    if (r.format === FORMAT3) {
      if (typeof child.folder === 'string' && child.folder) a.child.folder = child.folder;
      if (child.pin && PF.pins.childOk(child.pin) && !(r.pins && r.pins.children && Object.prototype.hasOwnProperty.call(r.pins.children, stepId))) {
        r.pins = r.pins || { children: {} }; r.pins.children = r.pins.children || {};
        r.pins.children[stepId] = JSON.parse(JSON.stringify(child.pin)); addFeature(r, 'pinned-children');
        var re = withPins(r); Object.keys(r).forEach(function (k) { delete r[k]; }); Object.keys(re).forEach(function (k) { r[k] = re[k]; });
      }
    }
    addLog(r, who, now, 'Started a ' + child.process + ' run for "' + x.step.text + '"');
  }
  /* The run details a child run was started for: the step's ^details and what it carries. If any change, the child no longer counts. */
  /* The details a child run is started with: those named in carry:, or, without carry:, every parent detail the child's map
     also has (childContext). They and the step's own ^details are the child's inputs; `keys` limits them to a snapshot's. */
  /* Why a child of this process can't be started for the step: carry: names a detail the child's map doesn't have. */
  function childProblem(r, step, childContext) {
    var miss = String(fieldsOf(r, step).carry || '').split(/[,\s]+/).filter(Boolean).filter(function (k) { return (childContext || []).indexOf(k) < 0; });
    return miss.length ? 'The ' + fieldsOf(r, step).process + ' checklist has no run detail ' + miss.join(', ') + ', so this step can\'t pass ' + (miss.length > 1 ? 'them' : 'it') + ' on. Change carry: or that checklist.' : null;
  }
  function childDetails(r, step, childContext) {
    var want = String(fieldsOf(r, step).carry || '').split(/[,\s]+/).filter(Boolean), out = {};
    if (!want.length) want = (childContext || []).filter(function (k) { return Object.prototype.hasOwnProperty.call(r.details, k); });
    want.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(r.details, k)) out[k] = r.details[k] || ''; });
    return out;
  }
  function childInputs(r, step, snapshot) {
    var f = fieldsOf(r, step), want = snapshot ? Object.keys(snapshot) : String(f.carry || '').split(/[,\s]+/).filter(Boolean), out = {};
    if (!snapshot && !want.length) want = Object.keys(r.details);
    /* What the step itself produces (sets:) is its output, not something its child was started for. */
    var own = String(f.sets || '').split(',').map(function (x) { return x.trim(); });
    (step.binds || []).concat(want).filter(function (k) { return own.indexOf(k) < 0; }).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(r.details, k)) out[k] = r.details[k] || ''; });
    return out;
  }
  function childCurrent(r, step, a) {
    if (!a || !a.child) return false;
    var f = fieldsOf(r, step), own = String(f.sets || '').split(',').map(function (k) { return k.trim(); }), was = {}, now = childInputs(r, step, a.child.inputs);
    Object.keys(a.child.inputs || {}).forEach(function (k) { if (own.indexOf(k) < 0) was[k] = a.child.inputs[k]; });
    /* A different process, or carry: naming a detail the child wasn't started with, means it's not the run this step asks for. */
    if ((f.process || '') !== a.child.process) return false;
    if (String(f.carry || '').split(/[,\s]+/).filter(Boolean).some(function (k) { return !Object.prototype.hasOwnProperty.call(was, k); })) return false;
    return Object.keys(now).concat(Object.keys(was)).every(function (k) { return (was[k] || '') === (now[k] || ''); });
  }
  /* The only way a step with a linked child is checked or blocked: by that exact child, current, once it has ended. */
  /* What the linked child means for its step: done only if it completed with the same values it was started with; blocked
     (and marked failed, so a new child can replace it) if it ended any other way or its carried values were changed. */
  /* The one verdict on whether this child run can stand for the step at all, whatever its details: '' or why not. A run/2
     parent never takes a child made with Flightdeck 2.0 (it offers a 2.0 run instead); a run/3 takes only a run on its pin
     (PF.pins.childMatch). Settlement (childVerdict, settleChild) and the step on screen both ask this, so they can't disagree. */
  function childHeld(r, stepId, child, procOf) {
    if (!child) return '';
    if (r.format !== FORMAT3) return isTwo(child) ? LEGACY_CHILD : '';
    return PF.pins.childMatch(childPin(r, stepId), child, procOf);
  }
  function childVerdict(r, step, a, child, procOf) {
    if (!a || !a.child || !child || child.process !== a.child.process || child.id !== a.child.id || !child.ended) return null;
    if (childHeld(r, step.id, child, procOf)) return null;
    var carried = String(fieldsOf(r, step).carry || '').split(/[,\s]+/).filter(Boolean), missing = carried.filter(function (k) { return !Object.prototype.hasOwnProperty.call(child.details || {}, k); });
    if (missing.length) return { s: 'blocked', reason: 'The ' + child.process + ' run has no ' + missing.join(', ') + ' to carry, so it can\'t stand for this step' };
    var changed = Object.keys(a.child.inputs || {}).filter(function (k) { return Object.prototype.hasOwnProperty.call(child.details || {}, k) && (child.details[k] || '') !== (a.child.inputs[k] || ''); });
    if (changed.length) return { s: 'blocked', reason: 'The ' + child.process + ' run ended with ' + changed.map(function (k) { return k + ' "' + child.details[k] + '"'; }).join(', ') + ', not the ' + changed.join(', ') + ' it was started for' };
    if (child.ended.outcome !== 'Completed') return { s: 'blocked', reason: 'The ' + child.process + ' run ended: ' + child.ended.outcome };
    return { s: 'done' };
  }
  /* The only way a step with a linked child is checked or blocked: by that exact child, current, once it has ended. */
  function settleChild(r, map, id, child, who, now, procOf) {
    var x = M.findStep(map, id), a = r.steps[id];
    if (!x || !a || !a.child || !child || child.process !== a.child.process || child.id !== a.child.id) throw new Error('That isn\'t the run linked to this step.');
    var held = childHeld(r, id, child, procOf); if (held) throw new Error(held);
    if (!childCurrent(r, x.step, a)) throw new Error('The linked run was for different details.');
    var v = childVerdict(r, x.step, a, child, procOf);
    if (!v) throw new Error('The linked run hasn\'t ended yet.');
    if (v.s === 'done') done(r, map, id, who, now, { _child: child.id });
    else if (a.s === 'blocked') { a.child.failed = true; addLog(r, who, now, v.reason + '; a new run can replace it'); }
    else { block(r, map, id, v.reason, who, now); r.steps[id].child.failed = true; }
    return v.s;
  }
  /* What a parent's step should become, given its child run: done when the child completed, blocked if it ended otherwise. */
  function childOutcome(child) {
    if (!child || !child.ended) return null;
    return child.ended.outcome === 'Completed' ? 'done' : 'blocked';
  }

  /* The pin a run/3's {run.process} step follows, or null. */
  function childPin(r, stepId) { return r && r.format === FORMAT3 && r.pins && r.pins.children && Object.prototype.hasOwnProperty.call(r.pins.children, stepId) ? r.pins.children[stepId] : null; }
  /* The one child-pin verdict (PF.pins.childMatch) for a run/3's step: '' or why the child can't stand for it. */
  function childPinProblem(r, stepId, c, procOf) { return r && r.format === FORMAT3 ? PF.pins.childMatch(childPin(r, stepId), c, procOf) : ''; }
  /* A child run made with Flightdeck 2.0 (run/3), or one this copy reads by name only: a run/2 parent never follows it. */
  function isTwo(child) { return !!child && (child.format === FORMAT3 || (!!child._unrunnable && child._needs != null)); }
  var LEGACY_CHILD = 'That run was made with Flightdeck 2.0, which an older Flightdeck recording this run would read by name only. Start it as a Flightdeck 2.0 run instead.';
  var LEGACY_LINK = '"<step>" is linked to a run made with Flightdeck 2.0, which an older Flightdeck would read by name only. Start it as a Flightdeck 2.0 run first.';
  /* The steps of a run/2 parent linked to a run/3 child (never written by 2.0; a hand-made link): [{ step, text, child, legacy }].
     findRun(key): a loaded run by process/id. */
  function legacyLinks(r, findRun) {
    if (!r || r.format === FORMAT3) return [];
    var map = mapOf(r), out = [];
    Object.keys(r.steps || {}).forEach(function (sid) {
      var a = r.steps[sid], c = a && a.child && findRun(a.child.process + '/' + a.child.id), x = map && M.findStep(map, sid);
      if (c && isTwo(c) && a.s !== 'done' && a.s !== 'na') out.push({ step: sid, text: x ? x.step.text : sid, child: c, legacy: true });
    });
    return out;
  }
  /* "Start it as a Flightdeck 2.0 run" (review #1, R2-4): a run/3 on the same /1 version as a run/2 parent whose linked child
     needs Flightdeck 2.0, chosen by a person. Its details and roles are copied (like Plan another like this), its answers
     aren't; its children are pinned now (o.pins, from PF.pins.atStart). pub: the old run's own version. */
  function continuation(old, pub, o) {
    if (old.format === FORMAT3) throw new Error('This run was already made with Flightdeck 2.0.');
    if (!pub || !pub.info || pub.info.folder !== old.folder) throw new Error('The new run must use the same version as this one (v' + old.version + ').');
    var details = {}, roles = {};
    Object.keys(old.details || {}).forEach(function (k) { details[k] = old.details[k]; });
    Object.keys(old.roles || {}).forEach(function (k) { roles[k] = old.roles[k]; });
    var title = String(old.title || pub.map.meta.title).replace(/ \(continued\)$/, '').slice(0, 88) + ' (continued)';
    var n = create(pub, { id: o.id, title: title, details: details, roles: roles, by: o.by, session: o.session, now: o.now, tz: o.tz, workflows: o.workflows, app: o.app, explicit: true, pins: o.pins });
    addLog(n, o.by, o.now, 'Continued from run ' + old.process + '/' + old.id + ', made with an older Flightdeck');
    return n;
  }
  /* The old parent's step, once its continuation is saved: Blocked, "Continued in run <key>", an answer every copy reads. */
  function continued(old, map, stepId, n, who, now) { return block(old, map, stepId, 'Continued in run ' + n.process + '/' + n.id, who, now); }

  /* ---------- Across runs: rotation history, and the Flight plan's analytics (an adapter over PF.insights) ---------- */
  function rotation(runs, processId) {
    var grid = Object.create(null), roles = [];
    runs.filter(function (r) { return r.process === processId && r.state !== 'cancelled'; }).forEach(function (r) {
      Object.keys(r.roles || {}).forEach(function (ro) {
        var p = r.roles[ro]; if (!p) return;
        if (roles.indexOf(ro) < 0) roles.push(ro);
        var c = (grid[p] = grid[p] || Object.create(null))[ro] = grid[p][ro] || { count: 0, last: '' };
        c.count++; if (r.created > c.last) c.last = r.created;
      });
    });
    return { roles: roles.sort(), grid: grid };
  }
  /* The Flight plan's numbers for one publication folder, from PF.insights (docs/design.md section 23): typical phase times,
     the typical completed run and the steps that most often go off-script, each counted once per run against its own
     denominator. A folder is required: versions are never pooled. Runs still going count, since the flight plan shows a
     version as it's being flown. input: the runs, or PF.insights' input. */
  function analytics(input, processId, folder, now) {
    if (!folder) throw new Error('Analytics are for one publication folder; versions are never pooled.');
    var res = PF.insights.forProcess(Array.isArray(input) ? { runs: input } : input, processId, { folder: folder, now: now, includeRunning: true });
    var deviated = res.steps.filter(function (s) { return s.offScript.hits > 0; }).map(function (s, i) {
      return { id: s.id, text: s.text, phase: s.phase, offScript: s.offScript.hits, n: s.offScript.n, q: s.offScript.q, blocked: s.blocked.hits, redone: s.redone.hits, na: s.na.hits, differently: s.differently.hits, at: i };
    }).sort(function (a, b) { return b.offScript - a.offScript || a.at - b.at; });
    /* Every number keeps its qualifications (q: what it counted and what it left out, and why), and the runs left out of
       everything and a load still under way are passed on, so the flight plan says what the numbers don't include. */
    return { runs: res.runs.n, ended: res.runs.n - res.runs.running, running: res.runs.running, medianMs: res.duration.median, completed: res.duration.n, durationQ: res.duration.q,
      phasesById: res.phases.map(function (p) { return { id: p.id, medianMs: p.median, n: p.n, of: p.of, q: p.q }; }),
      deviated: deviated, steps: deviated.slice(0, 10), notes: res.notes, excluded: res.excluded.map(function (e) { return e.text; }), final: res.final };
  }

  function end(r, map, outcome, who, whoName, now) {
    if (outcome === 'Completed' && !allGatesOk(r, map)) throw new Error('Pass or waive every gate before ending as Completed.');
    if (['Completed', 'Stopped early', 'Cancelled'].indexOf(outcome) < 0) throw new Error('Unknown outcome.');
    if (r.paused) resume(r, who, now);
    r.ended = { outcome: outcome, by: who, byName: whoName, at: now };
    r.state = outcome === 'Completed' ? 'completed' : outcome === 'Cancelled' ? 'cancelled' : 'stopped';
    addLog(r, who, now, 'Ended the run: ' + outcome);
  }

  /* ---------- Reading for people ---------- */
  function myNext(r, map, personId) {
    if (!personId || r.state !== 'running') return null;
    var mine = Object.keys(r.roles).filter(function (k) { return r.roles[k] === personId; });
    var rec = r.recorder.person === personId, out = null;
    M.steps(map).some(function (x) {
      if (!phaseOpen(r, map, x.phaseIndex) || answered(r, x.step)) return false;
      var assigned = x.step.roles.some(function (ro) { return mine.indexOf(ro) >= 0; });
      if (assigned || (rec && !x.step.roles.length)) { out = x; return true; }
      return false;
    });
    return out;
  }
  /* What the run screen points at next, from the same rules as the headline: a blocked step, a gate to review, failed or
     ready, else the next unanswered step of the open phase (one assigned to this person first; a step everyone can do counts
     for the recorder). Parallel tracks each say what's next in them. It depends on the run, never on what someone is looking at. */
  function nextUp(r, map, personId) {
    var hl = headline(r, map);
    if (r.ended) return { kind: 'ended', hl: hl };
    if (r.paused) return { kind: 'paused', hl: hl };
    if (hl.step) { var bx = M.findStep(map, hl.step); return { kind: 'blocked', hl: hl, step: bx ? bx.step : null, phaseIndex: bx ? bx.phaseIndex : 0 }; }
    if (hl.gate) {
      var gi = -1; map.phases.forEach(function (p, i) { if (p.gate.id === hl.gate) gi = i; });
      return { kind: 'gate', hl: hl, gate: map.phases[gi].gate, phaseIndex: gi, status: gateStatus(r, map, gi) };
    }
    if (hl.phase == null) return { kind: 'complete', hl: hl };
    var p = map.phases[hl.phase], mine = Object.keys(r.roles).filter(function (k) { return r.roles[k] === personId; }), rec = !!personId && r.recorder.person === personId;
    var waiting = p.steps.filter(function (s) { var a = r.steps[s.id]; return !answered(r, s) && !(a && a.s === 'blocked'); });
    var forMe = waiting.filter(function (s) { return s.roles.some(function (ro) { return mine.indexOf(ro) >= 0; }) || (rec && !s.roles.length); })[0];
    /* The recorder reads the list in order; anyone else is pointed at their own work first. */
    var step = (rec ? waiting[0] : forMe || waiting[0]) || null;
    var tracks = (p.tracks || []).map(function (t) {
      var ts = waiting.filter(function (s) { return s.track === t.id; });
      return { track: t, left: ts.length, step: ts[0] || null, people: t.roles.map(function (ro) { return r.roles[ro] || ''; }).filter(Boolean) };
    });
    var track = step && step.track ? (p.tracks || []).filter(function (t) { return t.id === step.track; })[0] || null : null;
    return { kind: 'step', hl: hl, step: step, phaseIndex: hl.phase, left: phaseInfo(r, map, hl.phase).left, mine: !!forMe, track: track, tracks: tracks };
  }
  /* After a step is answered, the next one to work on in the same phase: the first unanswered, unblocked step after it,
     then any earlier one still open. Null when the phase has nothing left but its gate. */
  function nextInPhase(r, map, id) {
    var x = M.findStep(map, id); if (!x) return null;
    var steps = map.phases[x.phaseIndex].steps, i = steps.map(function (s) { return s.id; }).indexOf(id);
    var open = function (s) { var a = r.steps[s.id]; return !answered(r, s) && !(a && a.s === 'blocked'); };
    return steps.slice(i + 1).filter(open)[0] || steps.slice(0, i).filter(open)[0] || null;
  }
  function totals(r, map) { var d = 0, n = 0; map.phases.forEach(function (p, pi) { var i = phaseInfo(r, map, pi); d += i.done; n += i.total; }); return { done: d, total: n }; }
  function describe(o) { return Object.keys(o || {}).map(function (k) { return k + ' ' + (o[k] || '(not set)'); }).join(', '); }

  /* Plain text for a Jira comment. Leaves out notes' attachments and file paths. */
  function receipt(r, map, nameOf, now, notes, statusOf, fuStatusOf) {
    var h = headline(r, map), lines = [];
    lines.push('Flightdeck receipt: ' + r.title);
    lines.push('Process: ' + map.meta.title + ' (v' + r.version + ')');
    var det = map.meta.context.filter(function (f) { return r.details[f]; }).map(function (f) { return f + ': ' + r.details[f]; }).join(' · ');
    if (det) lines.push(det);
    lines.push('Status: ' + (r.ended ? h.text : 'In progress. ' + h.text));
    var roles = map.meta.roles.filter(function (ro) { return r.roles[ro]; }).map(function (ro) { return ro + ': ' + nameOf(r.roles[ro]); }).join(' · ');
    if (roles) lines.push('Roles: ' + roles);
    lines.push('Started ' + U.when(r.created) + ' · captured ' + U.when(now) + ' · run ' + r.id, '');
    map.phases.forEach(function (p, pi) {
      var g = p.gate, gr = r.gates[g.id], st = gateStatus(r, map, pi);
      lines.push(p.title);
      p.steps.forEach(function (s) {
        var a = r.steps[s.id], word = !a ? 'NOT CHECKED' : a.s === 'done' ? 'DONE' : a.s === 'na' ? 'N/A' : a.s === 'blocked' ? 'BLOCKED - ' + a.reason : a.s === 'recheck' ? 'RE-CHECK - ' + a.reason : 'NOT CHECKED';
        lines.push('  [' + word + '] ' + s.text + (a && a.differently ? ' (done differently: ' + a.differently.note + ')' : ''));
        if (a && a.s === 'done' && a.values) { evidenceFor(r, s).list.forEach(function (d) { if (a.values[d.name]) lines.push('      ' + d.label + ': ' + a.values[d.name]); }); }
      });
      var gw = st === 'passed' ? 'PASSED' : st === 'waived' ? 'WAIVED - ' + gr.reason : st === 'failed' ? 'FAILED - ' + gr.reason : st === 'review' ? 'NEEDS REVIEW' : 'NOT PASSED';
      lines.push('  Gate: ' + g.title + ' [' + gw + ']' + (gr && gr.by && (st === 'passed' || st === 'waived') ? ' by ' + nameOf(gr.by) + ' ' + U.hm(gr.at) : ''), '');
    });
    if ((r.pauses || []).length) { lines.push('Pauses'); r.pauses.forEach(function (p) { lines.push('  ' + U.hm(p.from) + '-' + U.hm(p.to) + ' ' + nameOf(p.by) + ': ' + p.reason); }); lines.push(''); }
    /* Follow-ups, with what became of each when the caller knows the decisions (fuStatusOf). */
    var fus = r.followUps || [];
    if (fus.length) { lines.push('Follow-ups'); fus.forEach(function (f) { lines.push('  - ' + f.text + (f.owner ? ' (' + nameOf(f.owner) + ')' : '') + (f.ticket ? ' [' + f.ticket + ']' : '') + (fuStatusOf ? ' · ' + fuStatusOf(f) : '')); }); lines.push(''); }
    /* Corrections, with where each stands (the caller knows the decisions; a run on its own says Open or One-off). */
    var cor = corrections(r, map, notes);
    if (cor.length) {
      lines.push('Corrections · ' + cor.length);
      cor.forEach(function (c) {
        lines.push('  - ' + (c.stepText || 'Step ' + c.step) + ' [' + (statusOf ? statusOf(c) : c.oneOff ? 'One-off' : 'Open') + '] ' + nameOf(c.by) + ' ' + U.hm(c.at));
        if (c.change && c.change.op !== 'describe' && c.from) lines.push('      Checklist said: ' + c.from);
        if (c.proposed) lines.push('      Suggested: ' + c.proposed);
        if (c.why) lines.push('      ' + (c.change && c.change.op === 'describe' ? 'Problem' : 'Why') + ': ' + c.why);
        if (c.happened) lines.push('      What happened: ' + c.happened);
      });
      lines.push('');
    }
    var exceptions = r.log.filter(function (l) { return /^(Blocked|Waived|Failed|Took over|Changed)/.test(l.what); });
    if (exceptions.length) { lines.push('Exceptions'); exceptions.forEach(function (l) { lines.push('  ' + U.hm(l.at) + ' ' + nameOf(l.by) + ': ' + l.what); }); lines.push(''); }
    var noteCount = (notes || []).length;
    if (noteCount) lines.push(noteCount + ' note' + (noteCount === 1 ? '' : 's') + ' in Flightdeck.');
    return lines.join('\n').replace(/\n+$/, '');
  }

  /* run/3's fields in the frozen order (test/fixtures/v2): the envelope, then the version's fingerprints, then the rest as run/2. */
  var ORDER3 = ['format', 'features', 'app', 'id', 'process', 'version', 'folder', 'mapHash', 'typesHash', 'title', 'category', 'snapshot', 'types', 'payload'];
  function order3(r) {
    var out = {};
    ORDER3.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(r, k)) out[k] = r[k]; });
    Object.keys(r).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = r[k]; });
    return out;
  }
  function valid(o) { return !!o && (o.format === FORMAT || o.format === FORMAT3) && typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/i.test(o.id) && typeof o.snapshot === 'string' && !!o.steps && !!o.gates && !!o.recorder; }

  /* Runs come from a shared folder anyone can edit, so keep only values the app understands. */
  /* Without a prototype, so a state named like an inherited property (constructor, toString) is never a state. */
  var STEP_STATES = Object.assign(Object.create(null), { done: 1, na: 1, blocked: 1, recheck: 1, open: 1 }), GATE_STATES = Object.assign(Object.create(null), { passed: 1, waived: 1, failed: 1, review: 1 });
  var RUN_STATES = { running: 1, completed: 1, stopped: 1, cancelled: 1 }, OUTCOMES = { Completed: 1, 'Stopped early': 1, Cancelled: 1 };
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 200) : ''; }
  function isoOrNull(v) { return typeof v === 'string' && !isNaN(new Date(v)) ? v : null; }
  /* A child's input snapshot keeps every run-detail name a map can declare, so nothing it was started for is lost on reload. */
  function inputsOf(o) { var c = {}; if (o && typeof o === 'object') Object.keys(o).slice(0, 60).forEach(function (k) { if (/^[\w-]{1,120}$/.test(k)) c[k] = str(o[k], 300); }); return c; }
  function values(o) { var c = {}; if (o && typeof o === 'object') Object.keys(o).slice(0, 120).forEach(function (k) { if (/^[\w-]{1,40}$/.test(k)) c[k] = str(o[k], 300); }); return c; }
  function stamp(o) { return o && typeof o === 'object' && isoOrNull(o.at) ? { by: str(o.by, 80), at: o.at } : undefined; }
  /* Every field a run file holds as this copy writes it. Anything else, or a state this copy doesn't know, came from a newer
     Flightdeck: sanitize would drop it, so a save from here would erase it. */
  var NEWER = 'This run uses checklist features this copy of Flightdeck doesn\'t understand. Update Flightdeck to run it.';
  var KNOWN = {
    run: 'format id process version folder mapHash title category snapshot types details roles recorder followUps shotsFrozen jira pauses paused lineage state created createdBy tz steps gates fields log ended rev savedAt savedBy marksFrom marks parent',
    recorder: 'person session handoff', handoff: 'from rev at', step: 's by at reason started deadline differently values child history', history: 's by at reason differently values fields',
    gate: 's by at reason was approved', ended: 'outcome by byName at', paused: 'by at reason', pause: 'from to by reason', child: 'process id inputs failed', parent: 'process id step inputs',
    followUp: 'id text owner ticket step from by at', log: 'at by what', deadline: 'at by set', differently: 'note by at', started: 'by at',
    workflow: 'statuses transitions invalid', transition: 'from to fields', jiraField: 'name hint source options'
  };
  KNOWN.run3 = KNOWN.run + ' features app typesHash payload pins migrations';
  KNOWN.step3 = KNOWN.step + ' skill'; KNOWN.history3 = KNOWN.history + ' skill'; KNOWN.child3 = KNOWN.child + ' folder'; KNOWN.parent3 = KNOWN.parent + ' folder';
  KNOWN.pins = 'children'; KNOWN.skillSeen = 'id rev sha snapshot';
  Object.keys(KNOWN).forEach(function (k) { var o = {}; KNOWN[k].split(' ').forEach(function (f) { o[f] = 1; }); KNOWN[k] = o; });
  var HEX64 = /^[0-9a-f]{64}$/;
  /* Why a run/3 can't be read in full here, or '': a top-level field this copy doesn't know, or a payload it can't check (a pin
     or extension it doesn't have). Such a run is listed by name only, like a newer major, never sanitized and saved. */
  function unknown3(o) {
    var extra = Object.keys(o).filter(function (f) { return !Object.prototype.hasOwnProperty.call(KNOWN.run3, f) && f[0] !== '_'; })[0];
    if (extra != null) return 'The run has "' + String(extra).slice(0, 40) + '".';
    var p = o.payload, obj = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
    /* Every run/3 says its features and its types fingerprint; one without is no run/3 this copy wrote. */
    if (!Array.isArray(o.features) || !(typeof o.typesHash === 'string' && /^[0-9a-f]{8}$/.test(o.typesHash))) return 'It doesn\'t say its features and step types as a 2.0 run does.';
    /* A run/3 on a /1 version (an explicit 2.0 run) has no payload: its version's is implied. */
    if (p != null) {
      if (!obj(p) || !(typeof p.map === 'string' && HEX64.test(p.map)) || !(typeof p.types === 'string' && HEX64.test(p.types)) || !obj(p.images) || !obj(p.extensions) || !obj(p.pins)) return 'Its payload isn\'t one this copy reads.';
      if (Object.keys(p).some(function (k) { return ['map', 'types', 'images', 'extensions', 'pins'].indexOf(k) < 0; })) return 'Its payload isn\'t one this copy reads.';
      if (Object.keys(p.images).some(function (k) { return !(typeof p.images[k] === 'string' && HEX64.test(p.images[k])); })) return 'Its payload isn\'t one this copy reads.';
      if (Object.keys(p.extensions).length) return 'It holds extensions.';
      if (!PF.pins.shapeOk(p.pins)) return 'It pins versions in a way this copy doesn\'t read.';
    }
    /* Its own pins: children only, each a pin this copy reads. */
    if (o.pins != null && (!obj(o.pins) || Object.keys(o.pins).some(function (k) { return k !== 'children'; }) || !PF.pins.shapeOk({ children: o.pins.children || {} }))) return 'It pins versions in a way this copy doesn\'t read.';
    /* Migration records belong to typed data (a later slice): an empty list says there are none. */
    if (o.migrations != null && !(Array.isArray(o.migrations) && !o.migrations.length)) return 'It has migration records.';
    return '';
  }
  /* The Flightdeck a run/3 this copy can't fully read needs: its writer's own version when that's 2.0 or later, else 2.0. */
  function needs3(o) { var m = /^(\d+)\.(\d+)\.\d+/.exec(typeof o.app === 'string' ? o.app : ''); return m && +m[1] >= 2 ? m[1] + '.' + m[2] : '2.0'; }
  var MARKS = { blocked: 1, recheck: 1, na: 1, differently: 1 };
  function newer(o) {
    var why = '';
    function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    /* Names starting with "_" are this window's own bookkeeping, never saved, so they're no sign of a newer copy. */
    function look(v, kind, where) {
      if (why || !obj(v)) return;
      var extra = Object.keys(v).filter(function (f) { return !Object.prototype.hasOwnProperty.call(KNOWN[kind], f) && !(kind === 'run' && f[0] === '_'); })[0];
      if (extra != null) why = where + ' has "' + String(extra).slice(0, 40) + '".';
    }
    function each(list, kind, where) { if (Array.isArray(list)) list.forEach(function (v) { look(v, kind, where); }); }
    function text(v, where) { if (!why && obj(v)) { var k = Object.keys(v).filter(function (f) { return v[f] != null && typeof v[f] !== 'string'; })[0]; if (k != null) why = where + ' "' + k.slice(0, 40) + '" isn\'t text.'; } }
    function state(ok, v, where) { if (!why && v != null && !Object.prototype.hasOwnProperty.call(ok, v)) why = where + ' is "' + String(v).slice(0, 40) + '".'; }
    var three = o.format === FORMAT3;
    look(o, three ? 'run3' : 'run', 'The run');
    state(RUN_STATES, o.state, 'Its state');
    look(o.recorder, 'recorder', 'Its recorder'); look(o.recorder && o.recorder.handoff, 'handoff', 'Its hand-off');
    look(o.ended, 'ended', 'How it ended'); if (obj(o.ended)) state(OUTCOMES, o.ended.outcome, 'How it ended');
    look(o.paused, 'paused', 'Its pause'); each(o.pauses, 'pause', 'A pause'); each(o.followUps, 'followUp', 'A follow-up'); each(o.log, 'log', 'A log entry');
    look(o.parent, three ? 'parent3' : 'parent', 'Its parent run');
    if (three && obj(o.pins)) look(o.pins, 'pins', 'Its pins'); if (obj(o.parent)) text(o.parent.inputs, 'Its parent run\'s details');
    /* Maps of text (details, roles, answers, approvals): anything else in them is dropped on load. */
    text(o.details, 'A run detail'); text(o.roles, 'A role');
    if (obj(o.fields)) Object.keys(o.fields).forEach(function (k) { text(o.fields[k], 'A filled-in value on step "' + k.slice(0, 60) + '"'); });
    if (Array.isArray(o.lineage) && o.lineage.some(function (t) { return typeof t !== 'string'; })) why = why || 'A save receipt in it isn\'t a name.';
    /* The run's copy of the Jira workflows, as PF.jira.check writes it (an issue type, its transitions, their required fields). */
    if (obj(o.jira)) Object.keys(o.jira).forEach(function (k) {
      var w = o.jira[k], where = 'The Jira workflow "' + k.slice(0, 40) + '"';
      look(w, 'workflow', where);
      if (obj(w) && Array.isArray(w.transitions)) w.transitions.forEach(function (t) { look(t, 'transition', where); if (obj(t)) each(t.fields, 'jiraField', where); });
    });
    if (o.marksFrom != null && o.marksFrom !== 'start') why = why || 'Its "marksFrom" is "' + String(o.marksFrom).slice(0, 40) + '".';
    if (obj(o.marks)) Object.keys(o.marks).forEach(function (k) { if (Array.isArray(o.marks[k])) o.marks[k].forEach(function (m) { state(MARKS, m, 'A mark on step "' + k.slice(0, 60) + '"'); }); });
    if (obj(o.steps)) Object.keys(o.steps).forEach(function (k) {
      var a = o.steps[k], w = 'Step "' + k.slice(0, 60) + '"';
      if (!obj(a)) return;
      look(a, three ? 'step3' : 'step', w); state(STEP_STATES, a.s, w + '\'s state');
      look(a.started, 'started', w); look(a.deadline, 'deadline', w); look(a.differently, 'differently', w); look(a.child, three ? 'child3' : 'child', w);
      if (three) { look(a.skill, 'skillSeen', w + '\'s skill'); if (!why && a.skill != null && !cleanSkill(a.skill)) why = w + '\'s skill registration isn\'t one this copy reads.'; }
      text(a.values, w + '\'s evidence'); if (obj(a.child)) text(a.child.inputs, w + '\'s child run detail');
      if (Array.isArray(a.history)) a.history.forEach(function (h) { look(h, three ? 'history3' : 'history', w + '\'s history'); if (three && obj(h)) { look(h.skill, 'skillSeen', w + '\'s earlier skill'); if (!why && h.skill != null && !cleanSkill(h.skill)) why = w + '\'s earlier skill registration isn\'t one this copy reads.'; } if (obj(h) && h.s !== 'corrected') state(STEP_STATES, h.s, w + '\'s history'); if (obj(h)) { look(h.differently, 'differently', w + '\'s history'); text(h.values, w + '\'s earlier evidence'); text(h.fields, w + '\'s earlier value'); } });
    });
    if (obj(o.gates)) Object.keys(o.gates).forEach(function (k) {
      var g = o.gates[k], w = 'Gate "' + k.slice(0, 60) + '"';
      if (!obj(g)) return;
      look(g, 'gate', w); state(GATE_STATES, g.s, w + '\'s state'); state(GATE_STATES, g.was, w + '\'s earlier state'); text(g.approved, w + '\'s approval of');
    });
    return why ? NEWER + ' ' + why : '';
  }
  /* A run file in a run format this copy doesn't know (a newer Flightdeck's) is listed by name, read-only, with no steps:
     this copy can't tell what any of it means, so it shows nothing it might misread and never writes the file. */
  function newerFormat(o) {
    if (!o || typeof o !== 'object' || typeof o.format !== 'string' || !/^preflight-run\//.test(o.format)) return null;
    var env = PF.envelope.judge('preflight-run', o);
    /* A run/3 this copy can't read as a run (missing what every run has) is still a 2.0 file: listed by name, as the bridge did. */
    if (env.ok && o.format === FORMAT3) return nameOnly(o, needs3(o));
    if (env.ok || env.kind !== 'newer') return null;
    return nameOnly(o, env.needs || '');
  }
  /* What this copy says about a run it can only list by name: the Flightdeck it needs (from the file's own app and features, or
     the contract), and whether it's a 2.0 test run. */
  function nameOnly(o, needs) {
    if (typeof o.id !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(o.id)) return null;
    var r = sanitize({ format: FORMAT, id: o.id, process: o.process, title: o.title, created: o.created, createdBy: o.createdBy, version: o.version, folder: o.folder, state: o.state, ended: o.ended, snapshot: '', steps: {}, gates: {}, recorder: { person: o.recorder && o.recorder.person } });
    var test = o.test === true;
    r._unrunnable = (test ? 'Test run · needs ' + (needs ? 'Flightdeck ' + needs : 'a newer Flightdeck') + '. ' : 'Made with ' + (needs ? 'Flightdeck ' + needs : 'a newer Flightdeck') + '. ') + 'This copy shows its name only and won\'t change it.';
    r._needs = needs; if (test) r._test = true;
    return r;
  }
  /* A copy beside a run (run.conflict-*, run-<COMPUTER>, candidate-*, replaced-*), read as a run, except the placeholder an older
     copy's Restore leaves next to a run it could only list by name (docs/design.md section 28, H10): preflight-run/2 with no
     steps, gates or checklist and the run's own id. It holds no answers, so it's named and never kept, compared or counted. */
  var PLACEHOLDER = 'An older Flightdeck left this placeholder. It holds no answers.';
  function isPlaceholder(o, current) {
    if (!o || typeof o !== 'object' || o.format !== FORMAT || o.snapshot !== '' || !o.steps || typeof o.steps !== 'object' || Object.keys(o.steps).length || !o.gates || typeof o.gates !== 'object' || Object.keys(o.gates).length) return false;
    /* Beside a run: only when that run.json is one this copy lists by name only (a newer format), with the same id. */
    return !current || (o.id === current.id && !!current._unrunnable && !Object.keys(current.steps || {}).length);
  }
  function cleanCopy(o, current) {
    if (isPlaceholder(o, current)) { var r = sanitize(o); if (r) { r._unrunnable = PLACEHOLDER; r._placeholder = true; } return r; }
    return sanitize(o);
  }
  /* Records archived from a run (history-*.jsonl): log and answer lines, unversioned, read as they always were; a 2.0 migration
     record (kind migration, av 1) is kept for 2.0 and never shown here; anything else, or a newer av, is refused with a reason.
     Returns { ok: true, rec } or a refusal. */
  var ARCHIVE_SHOWN = { log: 1, answer: 1 };
  function cleanArchive(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, kind: 'malformed', why: 'isn\'t an archived record' };
    /* Kind and id are read as text before any lookup: one line holding an object there is refused alone, never read further. */
    if (typeof x.kind !== 'string' || (x.id != null && typeof x.id !== 'string')) return { ok: false, kind: 'malformed', why: 'isn\'t an archived record' };
    var shown = Object.prototype.hasOwnProperty.call(ARCHIVE_SHOWN, x.kind);
    if (!shown && x.kind !== 'migration') return { ok: false, kind: 'newer', why: 'is an archived record this copy doesn\'t know ("' + PF.envelope.txt(x.kind).slice(0, 40) + '"). ' + PF.envelope.needsText(''), needs: '' };
    var env = PF.envelope.judge('flightdeck-run-archive', x);
    if (!env.ok) return env;
    return { ok: true, rec: x, shown: shown };
  }
  /* The times in a run file that sanitize can't read, from the file as parsed (docs/design.md section 23). Sanitize keeps
     1.16's shapes, so every copy reads and writes the same file: it drops a pause, the pause under way, a log entry or an
     end whose time it can't read, and makes such a start 1970. Insights needs to know, so this says what was dropped, for
     this load only (_badTimes is never saved): once any copy saves the run, those records are gone, as they always were.
     null when every time could be read. */
  function badTimes(o, r) {
    var b = {}, n = 0, bad = function (v) { return v != null && !isoOrNull(v); };
    if (bad(o.created)) { b.created = true; n++; }
    if (o.ended && typeof o.ended === 'object' && OUTCOMES[o.ended.outcome] && !r.ended) { b.ended = o.ended.outcome; n++; }
    if (Array.isArray(o.pauses) && o.pauses.slice(0, 500).some(function (p) { return p && (!isoOrNull(p.from) || !isoOrNull(p.to)); })) { b.pauses = true; n++; }
    if (o.paused && typeof o.paused === 'object' && r.state === 'running' && !r.paused) { b.paused = true; n++; }
    var lost = (Array.isArray(o.log) ? o.log.slice(-LOG_MAX) : []).filter(function (l) { return l && typeof l === 'object' && !isoOrNull(l.at); });
    if (lost.length) { b.log = lost.map(function (l) { return { what: str(l.what, 300) }; }); n++; }
    return n ? b : null;
  }
  /* Reading for other apps: every record in a run file that sanitize drops, cuts short or replaces, by where it is
     (gates.ready, followUps[2], steps.tests.values.url, log[40]…), worked out from the file as parsed. Pure, never saved, and
     never called by the app, which reads runs exactly as before. Times sanitize can't read are badTimes' (not repeated
     here), and fields or states a newer Flightdeck wrote are newer()'s. [] when the file is clean. */
  function repairs(o) {
    var out = [];
    if (!valid(o)) return out;
    function add(at, what) { out.push({ at: at, what: what }); }
    function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function text(v, max, at) { if (v == null) return; if (typeof v !== 'string') add(at, 'dropped: not text'); else if (v.length > max) add(at, 'cut to ' + max + ' characters'); }
    function time(v, at) { if (v != null && !isoOrNull(v)) add(at, 'dropped: not a time'); }
    function textMap(v, max, at, keyOk, most) {
      if (v == null) return;
      if (!obj(v)) { add(at, 'dropped: not a list of names and values'); return; }
      var keys = Object.keys(v);
      if (most && keys.length > most) add(at, 'cut to ' + most + ' entries');
      keys.slice(0, most || keys.length).forEach(function (k) { if (keyOk && !keyOk.test(k)) add(at + '.' + k, 'dropped: not a name this copy reads'); else text(v[k], max, at + '.' + k); });
    }
    function list(v, at, most) {
      if (v == null) return [];
      if (!Array.isArray(v)) { add(at, 'dropped: not a list'); return []; }
      if (v.length > most) add(at, 'cut to ' + most + ' entries');
      return v;
    }
    function count(v, at) { if (v != null && !(typeof v === 'number' && v >= 0 && Math.floor(v) === v)) add(at, 'replaced: not a whole number'); }
    [['process', 60], ['folder', 60], ['mapHash', 16], ['title', 100], ['category', 60], ['createdBy', 80], ['tz', 60], ['savedBy', 40]].forEach(function (f) { text(o[f[0]], f[1], f[0]); });
    count(o.version, 'version'); count(o.rev, 'rev'); time(o.savedAt, 'savedAt');
    if (o.types != null && (typeof o.types !== 'object' || Array.isArray(o.types))) add('types', 'dropped: not step types');
    textMap(o.details, 120, 'details'); textMap(o.roles, 80, 'roles');
    var rec = o.recorder;
    if (!obj(rec)) add('recorder', 'replaced: not a recorder');
    else {
      text(rec.person, 80, 'recorder.person'); text(rec.session, 40, 'recorder.session');
      if (rec.handoff != null) {
        if (!obj(rec.handoff)) add('recorder.handoff', 'dropped: not a hand-off');
        else if (typeof rec.session === 'string' && rec.session) add('recorder.handoff', 'dropped: the run has a recorder window');
        else { text(rec.handoff.from, 80, 'recorder.handoff.from'); count(rec.handoff.rev, 'recorder.handoff.rev'); time(rec.handoff.at, 'recorder.handoff.at'); }
      }
    }
    list(o.followUps, 'followUps', 100).slice(0, 100).forEach(function (f, i) {
      var at = 'followUps[' + i + ']';
      if (!f || typeof f.text !== 'string' || !f.text.trim()) { add(at, 'dropped: no text'); return; }
      [['id', 20], ['text', 300], ['owner', 80], ['ticket', 120], ['step', 60], ['from', 20], ['by', 80]].forEach(function (x) { text(f[x[0]], x[1], at + '.' + x[0]); });
      time(f.at, at + '.at');
    });
    if (o.shotsFrozen != null && typeof o.shotsFrozen !== 'boolean') add('shotsFrozen', 'replaced: not true or false');
    if (o.jira != null && PF.jira.check(o.jira).errors.length) add('jira', 'replaced: ' + String(PF.jira.check(o.jira).errors[0]).slice(0, 120));
    list(o.pauses, 'pauses', 500).slice(0, 500).forEach(function (x, i) {
      var at = 'pauses[' + i + ']';
      if (!obj(x)) { add(at, 'dropped: not a pause'); return; }
      text(x.by, 80, at + '.by'); text(x.reason, 120, at + '.reason');
    });
    if (o.paused != null) {
      if (!obj(o.paused)) add('paused', 'dropped: not a pause');
      else if (!RUN_STATES[o.state] || o.state === 'running') { text(o.paused.by, 80, 'paused.by'); text(o.paused.reason, 120, 'paused.reason'); }
    }
    list(o.lineage, 'lineage', 200).forEach(function (t, i) { if (typeof t !== 'string' || !/^[\w-]{1,40}\.[a-z0-9]{8}$/.test(t)) add('lineage[' + i + ']', 'dropped: not a save receipt name'); });
    if (o.marks != null) {
      if (!obj(o.marks)) add('marks', 'dropped: not marks');
      else {
        var mk = Object.keys(o.marks);
        if (mk.length > 5000) add('marks', 'cut to 5000 steps');
        mk.slice(0, 5000).forEach(function (k) {
          var v = o.marks[k];
          if (!/^[\w-]{1,120}$/.test(k) || !Array.isArray(v)) add('marks.' + k, 'dropped: not marks on a step');
          else v.forEach(function (m, i) { if (!MARKS[m]) add('marks.' + k + '[' + i + ']', 'dropped: not a mark this copy knows'); });
        });
      }
    }
    if (o.parent != null) {
      if (!obj(o.parent) || !/^[a-z0-9][a-z0-9-]*$/.test(String(o.parent.process)) || !/^[a-z0-9-]{1,40}$/i.test(String(o.parent.id))) add('parent', 'dropped: not a parent run');
      else { text(o.parent.step, 60, 'parent.step'); if (o.parent.inputs != null) textMap(o.parent.inputs, 300, 'parent.inputs', /^[\w-]{1,120}$/, 60); }
    }
    if (o.fields != null) {
      if (!obj(o.fields)) add('fields', 'dropped: not filled-in values');
      else Object.keys(o.fields).forEach(function (k) { if (!/^[a-z0-9][a-z0-9-]{0,59}$/i.test(k)) add('fields.' + k, 'dropped: not a step ID'); else textMap(o.fields[k], 300, 'fields.' + k, /^[\w-]{1,40}$/, 120); });
    }
    if (!obj(o.steps)) add('steps', 'replaced: not a list of steps');
    if (!obj(o.gates)) add('gates', 'replaced: not a list of gates');
    if (obj(o.steps)) Object.keys(o.steps).forEach(function (k) {
      var a = o.steps[k], at = 'steps.' + k;
      if (!obj(a) || !STEP_STATES[a.s]) { add(at, 'dropped: no state this copy knows'); return; }
      text(a.by, 80, at + '.by'); time(a.at, at + '.at'); text(a.reason, 120, at + '.reason');
      if (a.started != null && !stamp(a.started)) add(at + '.started', 'dropped: not a time');
      else if (a.started != null) text(a.started.by, 80, at + '.started.by');
      if (a.deadline != null) { if (!obj(a.deadline) || !isoOrNull(a.deadline.at)) add(at + '.deadline', 'dropped: not a time'); else { text(a.deadline.by, 80, at + '.deadline.by'); time(a.deadline.set, at + '.deadline.set'); } }
      if (a.differently != null) { if (!obj(a.differently)) add(at + '.differently', 'dropped: not a note'); else { text(a.differently.note, 500, at + '.differently.note'); text(a.differently.by, 80, at + '.differently.by'); time(a.differently.at, at + '.differently.at'); } }
      if (a.values != null) textMap(a.values, 300, at + '.values', /^[\w-]{1,40}$/, 120);
      if (a.child != null) {
        if (!obj(a.child) || !/^[a-z0-9][a-z0-9-]*$/.test(String(a.child.process)) || !/^[a-z0-9-]{1,40}$/i.test(String(a.child.id))) add(at + '.child', 'dropped: not a child run');
        else if (a.child.inputs != null) textMap(a.child.inputs, 300, at + '.child.inputs', /^[\w-]{1,120}$/, 60);
      }
      if (a.history != null) {
        var hs = list(a.history, at + '.history', HISTORY_MAX), off = Math.max(0, hs.length - HISTORY_MAX);
        hs.slice(off).forEach(function (h, j) {
          var hat = at + '.history[' + (off + j) + ']';
          if (!obj(h) || !(STEP_STATES[h.s] || h.s === 'corrected')) { add(hat, 'dropped: no state this copy knows'); return; }
          text(h.by, 80, hat + '.by'); time(h.at, hat + '.at'); text(h.reason, 120, hat + '.reason');
          if (h.differently != null) { if (!obj(h.differently)) add(hat + '.differently', 'dropped: not a note'); else text(h.differently.note, 500, hat + '.differently.note'); }
          if (h.values != null) textMap(h.values, 300, hat + '.values', /^[\w-]{1,40}$/, 120);
          if (h.fields != null) textMap(h.fields, 300, hat + '.fields', /^[\w-]{1,40}$/, 120);
        });
      }
    });
    if (obj(o.gates)) Object.keys(o.gates).forEach(function (k) {
      var g = o.gates[k], at = 'gates.' + k;
      if (!obj(g) || !GATE_STATES[g.s]) { add(at, 'dropped: no state this copy knows'); return; }
      text(g.by, 80, at + '.by'); time(g.at, at + '.at'); text(g.reason, 200, at + '.reason');
      if (g.was != null && !GATE_STATES[g.was]) add(at + '.was', 'dropped: not a state this copy knows');
      textMap(g.approved, 120, at + '.approved');
    });
    var logs = list(o.log, 'log', LOG_MAX), from = Math.max(0, logs.length - LOG_MAX);
    logs.slice(from).forEach(function (l, i) {
      var at = 'log[' + (from + i) + ']';
      if (!obj(l)) { add(at, 'dropped: not a log entry'); return; }
      text(l.by, 80, at + '.by'); text(l.what, 300, at + '.what');
    });
    if (o.ended != null) {
      if (!obj(o.ended) || !OUTCOMES[o.ended.outcome]) add('ended', 'dropped: not an outcome this copy knows');
      else { text(o.ended.by, 80, 'ended.by'); text(o.ended.byName, 80, 'ended.byName'); }
    }
    return out;
  }
  /* What sanitize may add where a run file says nothing (older copies didn't write these, and a missing value gets this
     default), and what it leaves out by design. Everything else sanitize changes is a difference reading for other apps
     reports (unexplained(), through U.drift). Keep this next to sanitize: a change there that adds a default or drops a
     field belongs here, or reading for other apps calls every run with it malformed. */
  var DRIFT_ALLOW = {
    added: ['title', 'state', 'version', 'rev', 'shotsFrozen', 'paused.reason', 'recorder.handoff.rev'],
    /* An earlier answer keeps only the note of a "done differently" (1.11 wrote who and when too); a pause left on a run that
       has ended is history (the run isn't paused any more). A pause on a running run that can't be read is badTimes'. */
    dropped: ['steps.*.history[*].differently.by', 'steps.*.history[*].differently.at', 'paused']
  };
  /* Every place a run file says something sanitize doesn't keep as written (U.drift between the file and sanitize's
     result), for reading for other apps: the safety net under repairs(), which names the same places in words. */
  function unexplained(o) {
    var r = sanitize(o);
    if (!r) return null;
    return U.drift(o, JSON.parse(JSON.stringify(r)), DRIFT_ALLOW);
  }
  function sanitize(o) {
    if (!valid(o)) return newerFormat(o);
    /* A run/2 with a must-understand feature this copy doesn't know is listed by name only, never read for meaning. */
    if (o.features != null || o.format === FORMAT3) { var env = PF.envelope.judge('preflight-run', o); if (!env.ok) return env.kind === 'newer' ? nameOnly(o, env.needs || '') : null; }
    var three = o.format === FORMAT3;
    if (three && unknown3(o)) return nameOnly(o, needs3(o));
    var r = {
      format: FORMAT, id: o.id, process: str(o.process, 60), version: Math.max(0, parseInt(o.version, 10) || 0), folder: str(o.folder, 60), mapHash: str(o.mapHash, 16),
      title: str(o.title, 100) || 'Untitled run', category: str(o.category, 60), snapshot: o.snapshot, types: o.types && typeof o.types === 'object' ? o.types : {},
      details: {}, roles: {}, recorder: { person: str(o.recorder.person, 80), session: typeof o.recorder.session === 'string' ? o.recorder.session.slice(0, 40) : null },
      followUps: [], shotsFrozen: o.shotsFrozen === true, jira: o.jira ? PF.jira.check(o.jira).workflows : {}, pauses: [], paused: null,
      lineage: Array.isArray(o.lineage) ? o.lineage.filter(function (t) { return typeof t === 'string' && /^[\w-]{1,40}\.[a-z0-9]{8}$/.test(t); }).slice(-200) : [],
      state: RUN_STATES[o.state] ? o.state : 'running', created: isoOrNull(o.created) || new Date(0).toISOString(), createdBy: str(o.createdBy, 80), tz: str(o.tz, 60),
      steps: {}, gates: {}, fields: {}, log: [], ended: null, rev: Math.max(0, parseInt(o.rev, 10) || 0), savedAt: isoOrNull(o.savedAt), savedBy: str(o.savedBy, 40)
    };
    (Array.isArray(o.pauses) ? o.pauses.slice(0, 500) : []).forEach(function (p) { if (p && isoOrNull(p.from) && isoOrNull(p.to)) r.pauses.push({ from: p.from, to: p.to, by: str(p.by, 80), reason: str(p.reason, 120) }); });
    /* Marks are kept for every step that has one; if a file ever holds more than can be kept, the run no longer claims its
       marks are complete, so readiness won't call it clean on partial information. */
    var markKeys = o.marks && typeof o.marks === 'object' ? Object.keys(o.marks) : [];
    if (o.marksFrom === 'start' && markKeys.length <= 5000) r.marksFrom = 'start';
    if (o.marks && typeof o.marks === 'object') markKeys.slice(0, 5000).forEach(function (k) { if (/^[\w-]{1,120}$/.test(k) && Array.isArray(o.marks[k])) { var v = o.marks[k].filter(function (x) { return x === 'blocked' || x === 'recheck' || x === 'na' || x === 'differently'; }); if (v.length) (r.marks = r.marks || {})[k] = v; } });
    if (o.paused && isoOrNull(o.paused.at) && r.state === 'running') r.paused = { by: str(o.paused.by, 80), at: o.paused.at, reason: str(o.paused.reason, 120) || 'Paused' };
    if (o.parent && typeof o.parent === 'object' && /^[a-z0-9][a-z0-9-]*$/.test(String(o.parent.process)) && /^[a-z0-9-]{1,40}$/i.test(String(o.parent.id))) { r.parent = { process: o.parent.process, id: o.parent.id, step: str(o.parent.step, 60) }; if (o.parent.inputs && typeof o.parent.inputs === 'object') r.parent.inputs = inputsOf(o.parent.inputs); if (three && typeof o.parent.folder === 'string' && PF.publish.versionOf(o.parent.folder)) r.parent.folder = o.parent.folder; }
    var ho = o.recorder.handoff;
    if (ho && typeof ho === 'object' && !r.recorder.session) r.recorder.handoff = { from: str(ho.from, 80), rev: Math.max(0, parseInt(ho.rev, 10) || 0), at: isoOrNull(ho.at) };
    (Array.isArray(o.followUps) ? o.followUps.slice(0, 100) : []).forEach(function (f) {
      if (f && typeof f.text === 'string' && f.text.trim()) r.followUps.push({ id: str(f.id, 20), text: str(f.text, 300), owner: str(f.owner, 80), ticket: str(f.ticket, 120), step: str(f.step, 60), from: str(f.from, 20), by: str(f.by, 80), at: isoOrNull(f.at) });
    });
    /* Step IDs are what a map accepts (letters, numbers and dashes, up to 60), so every correction survives a reload. */
    Object.keys(o.fields || {}).forEach(function (k) { if (/^[a-z0-9][a-z0-9-]{0,59}$/i.test(k)) { var v = values(o.fields[k]); if (Object.keys(v).length) r.fields[k] = v; } });
    Object.keys(o.details || {}).forEach(function (k) { r.details[k] = str(o.details[k], 120); });
    Object.keys(o.roles || {}).forEach(function (k) { r.roles[k] = str(o.roles[k], 80); });
    Object.keys(o.steps).forEach(function (k) {
      var a = o.steps[k];
      if (!a || !STEP_STATES[a.s]) return;
      var c = { s: a.s, by: str(a.by, 80), at: isoOrNull(a.at), reason: str(a.reason, 120) || undefined, started: stamp(a.started) };
      if (a.deadline && isoOrNull(a.deadline.at)) c.deadline = { at: a.deadline.at, by: str(a.deadline.by, 80), set: isoOrNull(a.deadline.set) };
      if (a.differently && typeof a.differently === 'object') c.differently = { note: str(a.differently.note, 500), by: str(a.differently.by, 80), at: isoOrNull(a.differently.at) };
      if (a.values) c.values = values(a.values);
      if (a.child && /^[a-z0-9][a-z0-9-]*$/.test(String(a.child.process)) && /^[a-z0-9-]{1,40}$/i.test(String(a.child.id))) { c.child = { process: a.child.process, id: a.child.id }; if (a.child.inputs && typeof a.child.inputs === 'object') c.child.inputs = inputsOf(a.child.inputs); if (a.child.failed === true) c.child.failed = true; if (three && typeof a.child.folder === 'string' && PF.publish.versionOf(a.child.folder)) c.child.folder = a.child.folder; }
      if (three && a.skill) { var sk = cleanSkill(a.skill); if (sk) c.skill = sk; }
      if (Array.isArray(a.history)) c.history = a.history.slice(-HISTORY_MAX).filter(function (h) { return h && (STEP_STATES[h.s] || h.s === 'corrected'); }).map(function (h) { return { s: h.s, by: str(h.by, 80), at: isoOrNull(h.at), reason: str(h.reason, 120) || undefined, differently: h.differently ? { note: str(h.differently.note, 500) } : undefined, values: h.values ? values(h.values) : undefined, fields: h.fields ? values(h.fields) : undefined, skill: three && h.skill ? cleanSkill(h.skill) || undefined : undefined }; });
      r.steps[k] = c;
    });
    Object.keys(o.gates).forEach(function (k) {
      var g = o.gates[k];
      if (!g || !GATE_STATES[g.s]) return;
      var c = { s: g.s, by: str(g.by, 80), at: isoOrNull(g.at), reason: str(g.reason, 200) || undefined, was: GATE_STATES[g.was] ? g.was : undefined, approved: {} };
      Object.keys(g.approved || {}).forEach(function (f) { c.approved[f] = str(g.approved[f], 120); });
      r.gates[k] = c;
    });
    (Array.isArray(o.log) ? o.log.slice(-LOG_MAX) : []).forEach(function (l) { if (l && isoOrNull(l.at)) r.log.push({ at: l.at, by: str(l.by, 80), what: str(l.what, 300) }); });
    if (o.ended && OUTCOMES[o.ended.outcome] && isoOrNull(o.ended.at)) r.ended = { outcome: o.ended.outcome, by: str(o.ended.by, 80), byName: str(o.ended.byName, 80), at: o.ended.at };
    var bt = badTimes(o, r); if (bt) r._badTimes = bt;
    /* A run on a version this copy can't fully read, or with fields or states it doesn't know (a newer Flightdeck saved it), is
       shown but never recorded or saved here: sanitizing just dropped what this copy doesn't know, so saving would erase it.
       Not saved itself ("_"). */
    var bad = PF.publish.unrunnable(r.snapshot, r.types) || newer(o);
    if (bad) r._unrunnable = bad;
    if (three) {
      r.format = FORMAT3;
      if (Array.isArray(o.features)) r.features = PF.envelope.FROZEN.filter(function (f) { return o.features.indexOf(f) >= 0; });
      if (typeof o.app === 'string' && /^\d+\.\d+\.\d+/.test(o.app)) r.app = o.app.slice(0, 40);
      r.typesHash = str(o.typesHash, 16);
      if (o.payload != null) r.payload = JSON.parse(JSON.stringify(o.payload));
      if (o.pins && o.pins.children && Object.keys(o.pins.children).length) r.pins = { children: JSON.parse(JSON.stringify(o.pins.children)) };
      if (Array.isArray(o.migrations)) r.migrations = [];
      r = withPins(order3(r));
    }
    return r;
  }

  return {
    FORMAT: FORMAT, FORMAT3: FORMAT3, NEWER: NEWER, PLACEHOLDER: PLACEHOLDER, cleanCopy: cleanCopy, isPlaceholder: isPlaceholder, cleanArchive: cleanArchive, nameOnly: nameOnly, create: create, mapOf: mapOf, mapMemo: mapMemo, valid: valid, sanitize: sanitize, repairs: repairs, unexplained: unexplained, DRIFT_ALLOW: DRIFT_ALLOW, answered: answered, phaseInfo: phaseInfo, gateStatus: gateStatus, gateOk: gateOk,
    phaseOpen: phaseOpen, canPass: canPass, canWaive: canWaive, allGatesOk: allGatesOk, headline: headline, fill: fill, solo: solo, log: addLog, evidenceFor: evidenceFor, checkEvidence: checkEvidence,
    pause: pause, resume: resume, activeMs: activeMs, schedule: schedule, linkChild: linkChild, settleChild: settleChild, childPinProblem: childPinProblem, childVerdict: childVerdict, childHeld: childHeld, childCurrent: childCurrent, childDetails: childDetails, detailKey: detailKey, childProblem: childProblem, jiraProblem: jiraProblem, childOutcome: childOutcome, rotation: rotation, analytics: analytics, fieldsOf: fieldsOf, setFields: setFields,
    done: done, na: na, block: block, clear: clear, differently: differently, doneDifferently: doneDifferently, start: start, setDeadline: setDeadline,
    pass: pass, waive: waive, fail: fail, reopen: reopen, setDetail: setDetail, setRole: setRole,
    handOff: handOff, pickUp: pickUp, takeOver: takeOver, legacyLinks: legacyLinks, continuation: continuation, continued: continued, skillWarning: skillWarning, cleanSkill: cleanSkill, LEGACY_CHILD: LEGACY_CHILD, waitingForHandoff: waitingForHandoff, compare: compare, adopt: adopt, addFollowUp: addFollowUp, removeFollowUp: removeFollowUp, corrections: corrections, end: end, myNext: myNext, nextUp: nextUp, nextInPhase: nextInPhase, totals: totals, receipt: receipt, blockedSteps: blockedSteps
  };
})();
