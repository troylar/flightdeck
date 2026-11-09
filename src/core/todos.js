/* Living runs (4.0, docs/design.md 45): to-dos added to a run while it runs. Pure: no files, no clocks.
   Every change is a record in proposals/, written once: a proposal asks, a decision authorizes, an application changes the
   work. Only the recorder writes applications, and an application counts only once run.json's living.head reaches it, so
   effective work is the chain of applications from that head. Order is causal (each record names what it saw), ties by id,
   with the one reducer and settlement loops use (PF.loop.causal, PF.loop.settleIn, PF.loop.page). */
PF.todos = (function () {
  'use strict';
  var FORMAT = 'flightdeck-plan/4', STATUS = 'flightdeck-plan-status/4', FEATURE = 'living-runs', FEATURES = [FEATURE];
  /* One limit table for writers and readers. Anything over a limit is refused whole, never cut. */
  var LIMITS = { todos: 500, text: 200, reason: 300, link: 2048, bytes: 262144, seen: 50, targets: 50, grantAdds: 500, cut: 5000 };
  var OPS = ['add', 'done', 'wont', 'move', 'reopen'], DOPS = ['accept', 'decline'];
  var PKINDS = ['proposal', 'compound', 'grant', 'revoke'], SKINDS = ['decision', 'application'];
  var PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, RUN = /^[a-z0-9-]{1,40}$/i, STEP = /^[a-z0-9][a-z0-9-]{0,59}$/i, PERSON = /^[A-Za-z0-9_.-]{1,80}$/;
  var TOOL = /^[a-z0-9][a-z0-9-]{0,29}$/, VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/, KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  var REQ = /^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}$/, TD = /^td-[0-9a-f]{24}$/, FP = /^[0-9a-f]{16}$/;
  var DNAME = /^(req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24})\.status-([a-z0-9][a-z0-9-]{0,39})-([0-9a-f]{8})\.json$/;
  /* A synced copy's name (OneDrive): the record's own name with " (n)" or a dash suffix that has a capital letter (a
     computer's name) before .json. A record's own names are lowercase, so a copy never reads as another record. */
  var DCOPY = /^(req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24})\.status-([a-z0-9][a-z0-9-]{0,39})-([0-9a-f]{8})( \([0-9]{1,3}\)|-[A-Za-z0-9-]{1,63})?\.json$/;
  function copyMark(m) { return m === undefined || m === '' || /^ \([0-9]{1,3}\)$/.test(m) || (/^-[A-Za-z0-9-]{1,63}$/.test(m) && /[A-Z]/.test(m)); }
  /* The name a status file stands for (its own, or the record a synced copy copies), or '' when it isn't one. */
  function statusFile(name) {
    var m = typeof name === 'string' && name.length <= 240 ? DCOPY.exec(name) : null;
    return m && copyMark(m[4]) ? m[1] + '.status-' + m[2] + '-' + m[3] + '.json' : '';
  }
  /* Whether a request's file name is its id's, or a synced copy of it. */
  function requestFile(name, id) { return typeof name === 'string' && name.length <= 240 && name.indexOf(id) === 0 && /\.json$/.test(name) && copyMark(name.slice(id.length, -5) || undefined); }
  var UID = /^[a-z][a-z0-9.-]{0,19}:(key:)?[A-Za-z0-9_-]{1,40}$/, TICKET = /^[A-Za-z][A-Za-z0-9_]{0,19}-[1-9][0-9]{0,8}$/;
  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/, CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
  var WORDS = { waiting: 'Waiting for approval', queued: 'Queued for the recorder', applied: 'Applied', declined: 'Declined', held: 'Held', disputed: 'Disputed' };
  var STATE_WORDS = { open: 'Open', done: 'Done', wont: 'Won\'t do', moved: 'Moved' };

  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function reserved(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype' || k in Object.prototype; }
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (isMap(v)) { var o = Object.create(null); Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); }); return o; }
    return v;
  }
  function fp(v) { return PF.sha256.hex(JSON.stringify(canon(v))).slice(0, 16); }
  function text(f) { return JSON.stringify(f, null, 2) + '\n'; }
  function q(k) { return '"' + String(k).slice(0, 70) + '"'; }
  /* One line of text: a string, within max, no control characters (never trimmed or cut). */
  function line(v, max, what, errors, opt) {
    if (v == null && opt) return '';
    if (typeof v !== 'string' || !v.trim()) { errors.push(what + ' is text.'); return null; }
    if (v.length > max) { errors.push(what + ' is ' + v.length + ' characters; the most is ' + max + '.'); return null; }
    if (CONTROL.test(v)) { errors.push(what + ' has a line break or another control character.'); return null; }
    return v;
  }
  function only(o, keys, what, errors) { Object.keys(o).forEach(function (k) { if (keys.indexOf(k) < 0) errors.push(what + ' has ' + q(k) + '.'); }); }

  /* ---- Names. A proposal's id is like a scope request's, over ['todo', tool, key], so a retry of the same key names the same
     file and never collides with a plan or scope request. A to-do's id comes from the request that added it, so it keeps its
     identity however it is resolved or reopened. ---- */
  function idFor(tool, key) { return 'req-' + tool + '-' + PF.sha256.hex(JSON.stringify(['todo', tool, key])).slice(0, 24); }
  function todoIdFor(proposal) { return 'td-' + PF.sha256.hex(JSON.stringify(['td', proposal])).slice(0, 24); }
  function statusName(proposal, writer, rev) { return proposal + '.status-' + writer + '-' + rev + '.json'; }
  function isTodo(o) { return isMap(o) && (o.format === FORMAT || o.format === STATUS); }
  /* Whether the to-do reader takes a file: one in its format, or any record naming the living-runs feature (a newer or
     malformed one included), so a record this copy can't read holds its run rather than reaching another reader. */
  function claims(o) { return isTodo(o) || (isMap(o) && Array.isArray(o.features) && o.features.indexOf(FEATURE) >= 0); }
  function familyOf(o) { return isMap(o) && typeof o.format === 'string' && /^flightdeck-plan-status\//.test(o.format) ? 'flightdeck-plan-status' : 'flightdeck-plan'; }

  /* ---- Where a to-do belongs: exactly one target, by immutable ids in the run's frozen checklist. ---- */
  function cleanTarget(t, errors, where) {
    if (!isMap(t) || Object.keys(t).length !== 1) { errors.push(where + ' is one of {"phase": id}, {"step": id} or {"item": {"loopStep", "uid", "attempt"}}.'); return null; }
    if (own(t, 'phase')) { if (typeof t.phase !== 'string' || !STEP.test(t.phase)) { errors.push(where + ': "phase" is a phase id.'); return null; } return { phase: t.phase }; }
    if (own(t, 'step')) { if (typeof t.step !== 'string' || !STEP.test(t.step)) { errors.push(where + ': "step" is a step id.'); return null; } return { step: t.step }; }
    if (own(t, 'item')) {
      var it = t.item;
      if (!isMap(it) || Object.keys(it).length !== 3 || typeof it.loopStep !== 'string' || !STEP.test(it.loopStep) || typeof it.uid !== 'string' || !UID.test(it.uid) || typeof it.attempt !== 'number' || Math.floor(it.attempt) !== it.attempt || it.attempt < 1 || it.attempt > 999) { errors.push(where + ': "item" is {"loopStep": <the loop step>, "uid": <the item\'s uid>, "attempt": <its attempt>}.'); return null; }
      return { item: { loopStep: it.loopStep, uid: it.uid, attempt: it.attempt } };
    }
    errors.push(where + ' is one of {"phase": id}, {"step": id} or {"item": {...}}.'); return null;
  }
  function targetKey(t) { return !t ? '' : t.phase ? 'phase:' + t.phase : t.step ? 'step:' + t.step : t.item ? 'item:' + t.item.loopStep + '/' + t.item.uid + '#' + t.item.attempt : ''; }
  function cleanPlacement(p, errors) {
    if (!isMap(p)) { errors.push('"placement" is {"beforeGate": <gate id>} (and "governingLoop" for an item\'s work).'); return null; }
    only(p, ['beforeGate', 'governingLoop'], '"placement"', errors);
    if (typeof p.beforeGate !== 'string' || !STEP.test(p.beforeGate)) { errors.push('"placement" "beforeGate" is a gate id.'); return null; }
    var out = { beforeGate: p.beforeGate };
    if (p.governingLoop != null) { if (typeof p.governingLoop !== 'string' || !STEP.test(p.governingLoop)) { errors.push('"placement" "governingLoop" is a loop step id.'); return null; } out.governingLoop = p.governingLoop; }
    return out;
  }
  /* Where a target sits in the run's own frozen checklist (map): { phase index, gate, loop step } or why it can't be placed.
     The placement a record names must be exactly this; nothing is moved to a nearby gate or another attempt. */
  function placeOf(map, t) {
    if (!map || !t) return { why: 'its checklist can\'t be read' };
    var pi = -1, loop = '';
    if (t.phase) map.phases.forEach(function (p, i) { if (p.id === t.phase) pi = i; });
    else {
      var x = PF.map.findStep(map, t.step || (t.item && t.item.loopStep));
      if (x) pi = x.phaseIndex;
      if (x && t.item) { if (x.step.type !== 'for.each') return { why: t.item.loopStep + ' isn\'t a loop step' }; loop = x.step.id; }
    }
    if (pi < 0) return { why: (t.phase ? 'phase ' + t.phase : 'step ' + (t.step || t.item.loopStep)) + ' isn\'t in this run\'s checklist' };
    var g = map.phases[pi].gate;
    return { phase: pi, phaseId: map.phases[pi].id, gate: g ? g.id : '', loop: loop };
  }
  function placementWhy(map, t, pl) {
    var P = placeOf(map, t);
    if (P.why) return P.why;
    if (!pl || pl.beforeGate !== P.gate) return 'it says it comes before ' + (pl ? pl.beforeGate : 'no gate') + ', but its target comes before ' + P.gate;
    if ((pl.governingLoop || '') !== P.loop) return P.loop ? 'it names no governing loop, but its item belongs to ' + P.loop : 'it names a governing loop, but its target isn\'t an item';
    return '';
  }
  function placementFor(map, t) { var P = placeOf(map, t); if (P.why) return null; var out = { beforeGate: P.gate }; if (P.loop) out.governingLoop = P.loop; return out; }
  /* Where Moved work went: a ticket (key or link) or another run. */
  function cleanTo(to, errors) {
    if (!isMap(to) || Object.keys(to).length !== 1) { errors.push('"to" is {"ticket": "ABC-123"}, {"link": "https://..."} or {"run": "<process>/<run id>"}.'); return null; }
    if (own(to, 'ticket')) { if (typeof to.ticket !== 'string' || !TICKET.test(to.ticket)) { errors.push('"to" "ticket" is a ticket key, like ABC-123.'); return null; } return { ticket: to.ticket }; }
    if (own(to, 'link')) { if (!PF.loop.httpLink(to.link)) { errors.push('"to" "link" is an http or https address of at most ' + LIMITS.link + ' characters.'); return null; } return { link: to.link }; }
    if (own(to, 'run')) { if (typeof to.run !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}\/[a-z0-9-]{1,40}$/i.test(to.run)) { errors.push('"to" "run" is <process>/<run id>.'); return null; } return { run: to.run }; }
    errors.push('"to" is a ticket, a link or a run.'); return null;
  }
  function cleanOrigin(o, errors) {
    if (!isMap(o)) { errors.push('"origin" is {"step": <step id>} or {"link": "https://..."}.'); return null; }
    only(o, ['step', 'link'], '"origin"', errors);
    var out = {};
    if (o.step != null) { if (typeof o.step !== 'string' || !STEP.test(o.step)) errors.push('"origin" "step" is a step id.'); else out.step = o.step; }
    if (o.link != null) { if (!PF.loop.httpLink(o.link)) errors.push('"origin" "link" is an http or https address of at most ' + LIMITS.link + ' characters.'); else out.link = o.link; }
    if (!Object.keys(out).length) { errors.push('"origin" names a step or a link.'); return null; }
    return out;
  }
  function cleanRun(v, errors) {
    if (!isMap(v) || Object.keys(v).length !== 2 || typeof v.process !== 'string' || !PROC.test(v.process) || typeof v.id !== 'string' || !RUN.test(v.id)) { errors.push('"run" is {"process": <checklist>, "id": <run id>}.'); return null; }
    return { process: v.process, id: v.id };
  }
  function cleanSeen(v, errors) {
    if (!Array.isArray(v) || v.length > LIMITS.seen || !v.every(function (x) { return typeof x === 'string' && (REQ.test(x) || DNAME.test(x + '.json')); })) { errors.push('"seen" is a list of at most ' + LIMITS.seen + ' record ids.'); return null; }
    var dup = v.filter(function (x, i) { return v.indexOf(x) !== i; });
    if (dup.length) { errors.push('"seen" names ' + dup[0] + ' twice.'); return null; }
    return v.slice();
  }

  /* The operation a request asks for, as a proposal or a compound carries it. op: one of OPS; add has text and a target. */
  var BODY = ['op', 'todo', 'target', 'placement', 'text', 'owner', 'reason', 'origin', 'to', 'requester'];
  function cleanBody(o, errors, id) {
    var b = { op: o.op };
    if (OPS.indexOf(o.op) < 0) { errors.push('"op" is one of ' + OPS.join(', ') + ' (one operation per request).'); return null; }
    if (o.op === 'add') {
      if (o.todo != null && o.todo !== todoIdFor(id)) errors.push('"todo" of an addition is the id its request gives it (' + todoIdFor(id) + ').');
      b.todo = todoIdFor(id);
      b.target = cleanTarget(o.target, errors, '"target"');
      b.placement = cleanPlacement(o.placement, errors);
      b.text = line(o.text, LIMITS.text, '"text"', errors);
      if (o.origin != null) b.origin = cleanOrigin(o.origin, errors);
      if (o.to != null) errors.push('An addition has no "to".');
    } else {
      if (typeof o.todo !== 'string' || !TD.test(o.todo)) errors.push('"todo" is the to-do\'s id (td-...).'); else b.todo = o.todo;
      ['target', 'placement', 'text', 'origin', 'owner'].forEach(function (k) { if (o[k] != null) errors.push('Only an addition has ' + q(k) + '.'); });
      if (o.op === 'move') b.to = cleanTo(o.to, errors); else if (o.to != null) errors.push('Only a move has "to".');
    }
    if (o.op === 'add' && o.owner != null) { if (typeof o.owner !== 'string' || !PERSON.test(o.owner)) errors.push('"owner" is a person\'s ID from people.json.'); else b.owner = o.owner; }
    if (o.op === 'wont') { b.reason = line(o.reason, LIMITS.reason, '"reason" (why it won\'t be done)', errors); }
    else if (o.reason != null) { var r = line(o.reason, LIMITS.reason, '"reason"', errors); if (r) b.reason = r; }
    if (o.requester != null) { if (typeof o.requester !== 'string' || !PERSON.test(o.requester)) errors.push('"requester" is the ID from people.json of the person who asks.'); else b.requester = o.requester; }
    return b;
  }
  /* The effect an application of a proposal records: exactly what changes, checked against the work as it stands. */
  function effectOf(p) {
    var e = { op: p.op, todo: p.todo };
    if (p.op === 'add') { e.text = p.text; e.target = p.target; e.placement = p.placement; if (p.owner) e.owner = p.owner; if (p.reason) e.reason = p.reason; if (p.origin) e.origin = p.origin; }
    if (p.op === 'wont' || ((p.op === 'reopen' || p.op === 'done' || p.op === 'move') && p.reason)) e.reason = p.reason;
    if (p.op === 'move') e.to = p.to;
    return e;
  }
  function cleanEffect(e, errors) {
    if (!isMap(e)) { errors.push('"effect" is the change it made.'); return null; }
    only(e, ['op', 'todo', 'text', 'target', 'placement', 'owner', 'reason', 'origin', 'to'], '"effect"', errors);
    var out = { op: e.op };
    if (OPS.indexOf(e.op) < 0) { errors.push('"effect" "op" is one of ' + OPS.join(', ') + '.'); return null; }
    if (typeof e.todo !== 'string' || !TD.test(e.todo)) { errors.push('"effect" "todo" is a to-do id.'); return null; }
    out.todo = e.todo;
    if (e.op === 'add') { out.text = line(e.text, LIMITS.text, '"effect" "text"', errors); out.target = cleanTarget(e.target, errors, '"effect" "target"'); out.placement = cleanPlacement(e.placement, errors); if (e.owner != null) { if (!PERSON.test(String(e.owner))) errors.push('"effect" "owner" is a person\'s ID.'); else out.owner = e.owner; } if (e.origin != null) out.origin = cleanOrigin(e.origin, errors); }
    if (e.reason != null) { var r = line(e.reason, LIMITS.reason, '"effect" "reason"', errors); if (r) out.reason = r; }
    if (e.op === 'wont' && !out.reason) errors.push('"effect" of a won\'t-do says why.');
    if (e.op === 'move') out.to = cleanTo(e.to, errors);
    return out;
  }
  function cleanBy(o, errors) {
    if (o.producer != null) {
      if (!isMap(o.producer) || Object.keys(o.producer).length !== 2 || typeof o.producer.name !== 'string' || !TOOL.test(o.producer.name) || typeof o.producer.version !== 'string' || !VERSION.test(o.producer.version)) { errors.push('"producer" is {"name": <tool>, "version": <its version>}.'); return null; }
      if (typeof o.key !== 'string' || !KEY.test(o.key)) { errors.push('A tool\'s request has its "key".'); return null; }
      return { tool: o.producer.name, version: o.producer.version };
    }
    if (o.key != null) errors.push('Only a tool\'s request has a "key".');
    if (typeof o.by !== 'string' || !PERSON.test(o.by)) { errors.push('"by" is the ID from people.json of the person who made it.'); return null; }
    return { person: o.by };
  }

  /* ---- Files ---- */
  function head(format, app) { var f = { format: format, features: FEATURES.slice() }; if (PF.envelope.semver(app)) f.app = app; return f; }
  /* A proposal or a compound. o: { kind ('proposal' | 'compound'), id, run, seen, producer, key, by, at, app, body: {op,...},
     decision: { by, reason, consequence } and application: { previous, effect, fingerprint } (compound) }. */
  function buildProposal(o) {
    var f = head(FORMAT, o.app), b = o.body || {};
    f.kind = o.kind || 'proposal';
    f.id = o.id || (o.producer ? idFor(o.producer.name, o.key) : '');
    f.run = { process: o.run.process, id: o.run.id };
    f.seen = (o.seen || []).slice().sort();
    if (o.producer) { f.producer = { name: o.producer.name, version: o.producer.version }; f.key = o.key; } else f.by = o.by;
    f.at = o.at;
    BODY.forEach(function (k) { if (b[k] != null) f[k] = b[k]; });
    if (b.op === 'add') f.todo = todoIdFor(f.id);
    if (f.kind === 'compound') { f.decision = { op: 'accept', by: o.decision.by, consequence: o.decision.consequence }; if (o.decision.reason) f.decision.reason = o.decision.reason; f.application = { previous: o.application.previous || '', effect: o.application.effect, fingerprint: o.application.fingerprint }; }
    return f;
  }
  /* A delegation: grant (issuer by, subject, ops, targets, limits) or revoke (grant). */
  function buildGrant(o) {
    var f = head(FORMAT, o.app);
    f.kind = o.kind; f.id = o.id; f.run = { process: o.run.process, id: o.run.id }; f.seen = (o.seen || []).slice().sort(); f.by = o.by; f.at = o.at;
    if (o.kind === 'grant') { f.subject = o.subject; f.ops = o.ops.slice(); f.targets = o.targets.slice(); f.limits = { adds: o.limits && o.limits.adds != null ? o.limits.adds : 0 }; }
    else { f.grant = o.grant; if (o.reason) f.reason = o.reason; }
    return f;
  }
  /* A decision (accept or decline, with the exact consequence it saw) or an application (with what authorized it, the
     application before it and its checked effect). Named <proposal>.status-<writer>-<rev>.json. */
  function buildStatus(o) {
    var f = head(STATUS, o.app);
    f.kind = o.kind; f.proposal = o.proposal; f.run = { process: o.run.process, id: o.run.id }; f.seen = (o.seen || []).slice().sort(); f.by = o.by; f.at = o.at;
    if (o.kind === 'decision') { f.op = o.op; f.consequence = o.consequence; if (o.reason) f.reason = o.reason; }
    else { f.authority = o.authority; f.previous = o.previous || ''; f.effect = o.effect; f.fingerprint = o.fingerprint || fp(o.effect); }
    return { name: statusName(o.proposal, o.writer, o.rev), file: f };
  }
  function verdictOf(o, family) {
    var v = PF.envelope.judge(family, o);
    if (!v.ok) return { ok: false, kind: v.kind, why: v.kind === 'newer' ? 'is a to-do record made with a newer Flightdeck. ' + PF.envelope.needsText(v.needs) : v.why, needs: v.needs || '' };
    if (v.major !== 4 || v.features.indexOf(FEATURE) < 0) return { ok: false, kind: 'malformed', why: 'isn\'t a to-do record (it doesn\'t name the living-runs feature)', needs: '' };
    return null;
  }
  function mal(why) { return { ok: false, kind: 'malformed', why: why, needs: '' }; }
  var COMMON = ['format', 'features', 'app', 'kind', 'id', 'run', 'seen', 'producer', 'key', 'by', 'at'];
  /* A record in proposals/, read back: { ok, record } or a refusal ({ ok: false, kind, why }). name: its file name. Every
     field is checked for its type and limit; a record over a limit is refused whole, never cut. */
  function cleanFile(o, name) {
    var st = isMap(o) && o.format === STATUS, bad = verdictOf(o, familyOf(o));
    if (bad) return bad;
    var errors = [];
    if (st) {
      var sname = statusFile(name), m = sname ? DNAME.exec(sname) : null;
      if (!m || m[1] !== o.proposal) return mal('is a to-do decision or application whose name doesn\'t say its request');
      if (SKINDS.indexOf(o.kind) < 0) return mal('is a to-do status that isn\'t a decision or an application');
      only(o, COMMON.concat(['proposal', 'op', 'consequence', 'reason', 'authority', 'previous', 'effect', 'fingerprint']).filter(function (k) { return k !== 'id' && k !== 'producer' && k !== 'key'; }), 'It', errors);
      var rec = { id: sname.slice(0, -5), kind: o.kind, proposal: o.proposal, run: cleanRun(o.run, errors), seen: cleanSeen(o.seen, errors), by: null, at: '' };
      if (typeof o.by !== 'string' || !PERSON.test(o.by)) errors.push('"by" is the ID from people.json of who made it.'); else rec.by = { person: o.by };
      if (typeof o.at !== 'string' || !ISO.test(o.at)) errors.push('"at" is a date and time.'); else rec.at = o.at;
      if (o.kind === 'decision') {
        if (DOPS.indexOf(o.op) < 0) errors.push('"op" is accept or decline.'); else rec.op = o.op;
        if (typeof o.consequence !== 'string' || !FP.test(o.consequence)) errors.push('"consequence" is the fingerprint of the consequence it accepted.'); else rec.consequence = o.consequence;
        if (o.reason != null) { var dr = line(o.reason, LIMITS.reason, '"reason"', errors); if (dr) rec.reason = dr; }
        ['authority', 'previous', 'effect', 'fingerprint'].forEach(function (k) { if (o[k] != null) errors.push('A decision has no ' + q(k) + '.'); });
      } else {
        rec.authority = cleanAuthority(o.authority, errors);
        if (typeof o.previous !== 'string' || (o.previous !== '' && !REQ.test(o.previous) && !DNAME.test(o.previous + '.json'))) errors.push('"previous" is the application before it, or "".'); else rec.previous = o.previous;
        rec.effect = cleanEffect(o.effect, errors);
        if (typeof o.fingerprint !== 'string' || !FP.test(o.fingerprint)) errors.push('"fingerprint" is its effect\'s fingerprint.');
        else if (rec.effect && o.fingerprint !== fp(rec.effect)) errors.push('"fingerprint" doesn\'t match its effect.');
        else rec.fingerprint = o.fingerprint;
        ['op', 'consequence', 'reason'].forEach(function (k) { if (o[k] != null) errors.push('An application has no ' + q(k) + '.'); });
      }
      if (errors.length) return mal('is a to-do ' + o.kind + ' that isn\'t in its format: ' + errors[0]);
      return { ok: true, record: rec };
    }
    if (PKINDS.indexOf(o.kind) < 0) return mal('is a to-do record that isn\'t a proposal, a compound, a grant or a revoke');
    if (typeof o.id !== 'string' || !REQ.test(o.id)) return mal('is a to-do record without a request id');
    if (typeof name === 'string' && !requestFile(name, o.id)) return mal('is a to-do record whose name isn\'t its id');
    var r = { id: o.id, kind: o.kind, run: cleanRun(o.run, errors), seen: cleanSeen(o.seen, errors), by: cleanBy(o, errors), at: '' };
    if (typeof o.at !== 'string' || !ISO.test(o.at)) errors.push('"at" is a date and time.'); else r.at = o.at;
    if (r.by && r.by.tool && o.id !== idFor(r.by.tool, o.key)) errors.push('Its id isn\'t the one its tool and key give.');
    if (o.kind === 'proposal' || o.kind === 'compound') {
      only(o, COMMON.concat(BODY, o.kind === 'compound' ? ['decision', 'application'] : []), 'It', errors);
      var b = cleanBody(o, errors, o.id);
      if (b) BODY.forEach(function (k) { if (b[k] != null) r[k] = b[k]; });
      if (o.kind === 'compound') {
        if (!r.by || !r.by.person) errors.push('A compound is one person\'s gesture: it has "by", no tool.');
        var d = o.decision, a = o.application;
        if (!isMap(d) || d.op !== 'accept' || d.by !== o.by || typeof d.consequence !== 'string' || !FP.test(d.consequence)) errors.push('"decision" is {"op": "accept", "by": <the same person>, "consequence": <fingerprint>}.');
        else { only(d, ['op', 'by', 'consequence', 'reason'], '"decision"', errors); r.decision = { op: 'accept', by: d.by, consequence: d.consequence }; if (d.reason != null) { var cr = line(d.reason, LIMITS.reason, '"decision" "reason"', errors); if (cr) r.decision.reason = cr; } }
        if (!isMap(a)) errors.push('"application" is {"previous", "effect", "fingerprint"}.');
        else {
          only(a, ['previous', 'effect', 'fingerprint'], '"application"', errors);
          var ap = { previous: '', effect: cleanEffect(a.effect, errors), fingerprint: '' };
          if (typeof a.previous !== 'string' || (a.previous !== '' && !REQ.test(a.previous) && !DNAME.test(a.previous + '.json'))) errors.push('"application" "previous" is the application before it, or "".'); else ap.previous = a.previous;
          if (typeof a.fingerprint !== 'string' || !FP.test(a.fingerprint) || (ap.effect && a.fingerprint !== fp(ap.effect))) errors.push('"application" "fingerprint" is its effect\'s fingerprint.'); else ap.fingerprint = a.fingerprint;
          if (b && ap.effect && fp(effectOf(b)) !== fp(ap.effect)) errors.push('"application" "effect" isn\'t what the compound asks for.');
          r.application = ap;
        }
      }
    } else if (o.kind === 'grant') {
      only(o, COMMON.concat(['subject', 'ops', 'targets', 'limits']), 'It', errors);
      if (!r.by || !r.by.person) errors.push('A grant is issued by a person: it has "by", no tool.');
      var s = o.subject;
      if (isMap(s) && Object.keys(s).length === 1 && typeof s.tool === 'string' && TOOL.test(s.tool)) r.subject = { tool: s.tool };
      else if (isMap(s) && Object.keys(s).length === 1 && typeof s.person === 'string' && PERSON.test(s.person)) r.subject = { person: s.person };
      else errors.push('"subject" is {"tool": <name>} or {"person": <ID>}.');
      if (!Array.isArray(o.ops) || !o.ops.length || o.ops.length > 3 || !o.ops.every(function (x, i) { return ['add', 'done', 'reopen'].indexOf(x) >= 0 && o.ops.indexOf(x) === i; })) errors.push('"ops" is a list of add, done and reopen: a grant never drops work.');
      else r.ops = o.ops.slice();
      if (!Array.isArray(o.targets) || !o.targets.length || o.targets.length > LIMITS.targets) errors.push('"targets" is a list of 1 to ' + LIMITS.targets + ' targets, each exactly as a to-do names it.');
      else { r.targets = []; o.targets.forEach(function (t, i) { var c = cleanTarget(t, errors, '"targets" ' + (i + 1)); if (c) { if (r.targets.some(function (y) { return targetKey(y) === targetKey(c); })) errors.push('"targets" names ' + targetKey(c) + ' twice.'); r.targets.push(c); } }); }
      var lim = o.limits;
      if (!isMap(lim) || Object.keys(lim).some(function (k) { return k !== 'adds'; }) || typeof lim.adds !== 'number' || Math.floor(lim.adds) !== lim.adds || lim.adds < 0 || lim.adds > LIMITS.grantAdds) errors.push('"limits" is {"adds": 0 to ' + LIMITS.grantAdds + '}.');
      else r.limits = { adds: lim.adds };
    } else {
      only(o, COMMON.concat(['grant', 'reason']), 'It', errors);
      if (!r.by || !r.by.person) errors.push('A revoke is a person\'s: it has "by", no tool.');
      if (typeof o.grant !== 'string' || !REQ.test(o.grant)) errors.push('"grant" is the id of the grant it revokes.'); else r.grant = o.grant;
      if (o.reason != null) { var rr = line(o.reason, LIMITS.reason, '"reason"', errors); if (rr) r.reason = rr; }
    }
    if (errors.length) return mal('is a to-do ' + o.kind + ' that isn\'t in its format: ' + errors[0]);
    return { ok: true, record: r };
  }
  function cleanAuthority(a, errors) {
    if (isMap(a) && Object.keys(a).length === 1) {
      var k = Object.keys(a)[0];
      if (k === 'decision' && typeof a.decision === 'string' && DNAME.test(a.decision + '.json')) return { decision: a.decision };
      if (k === 'grant' && typeof a.grant === 'string' && REQ.test(a.grant)) return { grant: a.grant };
      if (k === 'compound' && typeof a.compound === 'string' && REQ.test(a.compound)) return { compound: a.compound };
    }
    errors.push('"authority" is {"decision": <id>}, {"grant": <id>} or {"compound": <id>}.'); return null;
  }
  /* Why a record just built can't be filed ('' when it can): the reader's own check, on the bytes as they'd be written. */
  function fileWhy(name, f) { return filed(name, f).why; }
  /* A record this copy built, as every reader will read it once it is filed: { why: '' , record } or { why }. */
  function filed(name, f) {
    var t = text(f), n = PF.util.utf8Bytes(t);
    if (n > LIMITS.bytes) return { why: 'It would be ' + n + ' bytes; a to-do record is at most ' + LIMITS.bytes + '.' };
    if (Array.isArray(f.seen) && f.seen.length > LIMITS.seen) return { why: 'It would name ' + f.seen.length + ' records it saw; a to-do record names at most ' + LIMITS.seen + '. Settle some open decisions first.' };
    var v = cleanFile(JSON.parse(t), name);
    return v.ok ? { why: '', record: v.record } : { why: 'It wouldn\'t read back: it ' + v.why + '.' };
  }
  /* The run a record names, when it says one plainly, even when it isn't in its format; null otherwise. */
  function runOf(o) { var v = isMap(o) && isMap(o.run) ? o.run : null; return v && typeof v.process === 'string' && typeof v.id === 'string' ? { process: v.process, id: v.id } : null; }
  function recordsFor(records, r) { return (records || []).filter(function (x) { return x.run && x.run.process === r.process && x.run.id === r.id; }); }

  /* ---- Reduction: a run's to-do records, reduced to its work and each request's status. Pure; the same records in any
     order (any file names) give the same result. o: { map (the run's frozen checklist), may(record) -> '' or why a
     decision, grant or compound's person can't authorize (commit 2 supplies it), ended }. ---- */
  function reduce(records, r, o) {
    o = o || {};
    var mine = recordsFor(records, r), c = PF.loop.causal(mine), byId = Object.create(null), heldIds = Object.create(null), T;
    c.order.forEach(function (x) { byId[x.id] = x; });
    c.held.forEach(function (h) { heldIds[h.record] = h; });
    mine.forEach(function (x) { if (!byId[x.id] && !heldIds[x.id]) heldIds[x.id] = { record: x.id, missing: [], why: 'after' }; });
    T = { run: { process: r.process, id: r.id }, heads: c.heads, held: c.held.slice(), broken: null, chain: [], todos: [], byTodo: Object.create(null), requests: Object.create(null),
      order: c.order.map(function (x) { return x.id; }), grants: Object.create(null), unread: [], saw: c.saw, records: c.order, limit: null };
    var map = o.map || null;
    /* The chain of landed applications, from living.head back through previous. Any break holds every to-do (fail closed). */
    var headId = r.living && typeof r.living.head === 'string' ? r.living.head : '', chain = [], at = headId, visited = Object.create(null);
    while (at) {
      if (visited[at]) { T.broken = { why: 'Its applications go round in a circle at ' + at + '.', record: at }; break; }
      visited[at] = true;
      var a = byId[at];
      if (!a) { T.broken = { why: heldIds[at] ? 'The application ' + at + ' can\'t be read in order yet (' + (heldIds[at].why === 'copies' ? 'two different copies of it are in the folder' : 'it saw a record that isn\'t here') + ').' : 'The application ' + at + ' that the run names isn\'t in the folder.', record: at }; break; }
      var ap = a.kind === 'application' ? a : a.kind === 'compound' ? a.application : null;
      if (!ap) { T.broken = { why: at + ' isn\'t an application.', record: at }; break; }
      chain.unshift(a); at = ap.previous;
    }
    if (T.broken) chain = [];
    /* Replay: each landed effect, in chain order, checked against the work as it stood. One that doesn't fit breaks the chain. */
    var landed = Object.create(null), added = 0;
    chain.some(function (a) {
      var ap = a.kind === 'compound' ? a.application : a, e = ap.effect, pid = a.kind === 'compound' ? a.id : a.proposal, p = byId[pid], x = T.byTodo[e.todo];
      var why = !p || (p.kind !== 'proposal' && p.kind !== 'compound') ? 'its request ' + pid + ' isn\'t here' : fp(effectOf(p)) !== ap.fingerprint ? 'its effect isn\'t what ' + pid + ' asks for' :
        a.kind === 'application' && !c.saw(a.id, pid) ? 'it didn\'t see its request' : ap.previous && a.kind === 'application' && !c.saw(a.id, ap.previous) ? 'it didn\'t see the application before it' : landed[pid] ? pid + ' was applied twice' :
        e.op === 'add' ? (x ? 'it adds ' + e.todo + ' again' : added >= LIMITS.todos ? 'it would add more than ' + LIMITS.todos + ' to-dos' : '') :
        !x ? 'it changes ' + e.todo + ', which was never added' : e.op === 'reopen' ? (x.state === 'open' ? e.todo + ' is already open' : '') : x.state !== 'open' ? e.todo + ' is already ' + STATE_WORDS[x.state].toLowerCase() : '';
      if (why) { T.broken = { why: 'The application ' + a.id + ' can\'t be applied: ' + why + '.', record: a.id }; return true; }
      landed[pid] = a.id;
      if (e.op === 'add') {
        added++;
        x = { id: e.todo, text: e.text, target: e.target, placement: e.placement, owner: e.owner || '', reason: e.reason || '', origin: e.origin || null, state: 'open', to: null, why: '', added: a.id, request: pid, by: p.by, history: [], disputed: false, reopened: 0 };
        T.byTodo[x.id] = x; T.todos.push(x);
      } else if (e.op === 'done') { x.state = 'done'; x.why = e.reason || ''; }
      else if (e.op === 'wont') { x.state = 'wont'; x.why = e.reason; }
      else if (e.op === 'move') { x.state = 'moved'; x.to = e.to; x.why = e.reason || ''; }
      else { x.state = 'open'; x.to = null; x.why = e.reason || ''; x.reopened++; }
      x.history.push({ op: e.op, application: a.id, request: pid });
      return false;
    });
    if (T.broken) { T.todos = []; T.byTodo = Object.create(null); landed = Object.create(null); added = 0; }
    else T.chain = chain.map(function (a) { return a.id; });
    T.added = added;
    /* Decisions and applications per request, settled causally: contrary ones made at once are disputed until a record that
       saw every outstanding one settles them (PF.loop.settleIn, a page of LIMITS.seen at a time). */
    var reqs = T.requests, rv = function (x) { return x; };
    c.order.forEach(function (x) {
      if (x.kind === 'proposal' || x.kind === 'compound') {
        reqs[x.id] = { id: x.id, kind: x.kind, op: x.op, todo: x.todo, target: x.target || null, placement: x.placement || null, text: x.text || '', to: x.to || null, reason: x.reason || '', owner: x.owner || '', by: x.by, requester: x.requester || '', at: x.at,
          status: '', why: '', landed: landed[x.id] || '', candidates: [], decisions: [], dec: null, decReview: [], app: null, appReview: [], ignored: [], disputedIds: [] };
        /* A compound's decision counts only as a separate decision would (o.may); otherwise it is ignored, with why, and the
           request waits like any other. */
        if (x.kind === 'compound') {
          var noc = o.may ? o.may(x, T) : '';
          if (noc) reqs[x.id].ignored.push({ record: x.id, why: noc });
          else settleDecision(reqs[x.id], x, { op: 'accept', by: x.decision.by, consequence: x.decision.consequence, record: x.id });
          settleApp(reqs[x.id], x, x.application);
        }
        return;
      }
      if (x.kind === 'grant' || x.kind === 'revoke') { grant(x); return; }
      var q0 = reqs[x.proposal];
      if (!q0) return;
      if (!c.saw(x.id, x.proposal)) { q0.ignored.push({ record: x.id, why: 'it didn\'t see the request it answers' }); return; }
      if (x.kind === 'decision') {
        var no = o.may ? o.may(x, T) : '';
        if (no) { q0.ignored.push({ record: x.id, why: no }); return; }
        q0.decisions.push(x.id);
        settleDecision(q0, x, { op: x.op, by: x.by.person, consequence: x.consequence, record: x.id });
      } else { q0.candidates.push(x.id); if (!landed[x.proposal]) settleApp(q0, x, x); }
    });
    /* Every record that ever took part in a dispute on a request, kept after it settles: an approval made before it never
       counts it, so settling a dispute never quietly restores that approval. */
    function ever(q1, slot, res, rec) { var ids = res === 'contrary' ? q1[slot + 'Out'] : res === 'held' ? [rec.id] : []; ids.forEach(function (id) { if (q1.disputedIds.indexOf(id) < 0) q1.disputedIds.push(id); }); }
    function settleDecision(q1, rec, val) {
      ever(q1, 'dec', PF.loop.settleIn(c, q1, 'dec', 'decReview', rec, val, function (p, v) { return p.op === v.op; },
        { both: function (p, v) { return 'Two people decided this request at once: ' + p.op + ' and ' + v.op + '.'; }, again: 'Decided again without seeing both earlier decisions.' }), rec);
    }
    function settleApp(q1, rec, ap) {
      ever(q1, 'app', PF.loop.settleIn(c, q1, 'app', 'appReview', rec, { op: 'apply', previous: ap.previous, fingerprint: ap.fingerprint }, function (p, v) { return p.fingerprint === v.fingerprint && p.previous === v.previous; },
        { both: function (p, v) { return 'Two recorders applied this request at once.'; }, again: 'Applied again without seeing both earlier applications.' }), rec);
    }
    /* Grants: active once issued, by a person who may (o.may); a revoke ends one for good, whether or not it saw what used it. */
    function grant(x) {
      if (x.kind === 'grant') { var no = o.may ? o.may(x, T) : ''; T.grants[x.id] = { id: x.id, subject: x.subject, ops: x.ops, targets: x.targets, limits: x.limits, by: x.by, active: !no, why: no, revoked: [] }; return; }
      var g = T.grants[x.grant], no2 = o.may ? o.may(x, T) : '';
      if (!g) { T.held.push({ record: x.id, missing: [x.grant], why: 'missing' }); return; }
      if (no2) return;
      g.revoked.push(x.id); g.active = false; g.why = 'It was revoked.';
    }
    /* A request this copy can't read in order is still listed, held, with what it says. */
    mine.forEach(function (x) {
      if ((x.kind !== 'proposal' && x.kind !== 'compound') || reqs[x.id]) return;
      reqs[x.id] = { id: x.id, kind: x.kind, op: x.op, todo: x.todo, target: x.target || null, placement: x.placement || null, text: x.text || '', to: x.to || null, reason: x.reason || '', owner: x.owner || '', by: x.by, requester: x.requester || '', at: x.at,
        status: '', why: '', landed: '', candidates: [], decisions: [], dec: null, decReview: [], app: null, appReview: [], ignored: [], disputedIds: [], unordered: true };
    });
    Object.keys(reqs).forEach(function (id) { statusOf(T, reqs[id], o, map, heldIds); });
    /* Work is disputed while any request on it is, and while any decision on it is unsettled, whatever the request's status:
       a contrary decision made after an application landed holds the work until a record that saw both settles it. */
    T.todos.forEach(function (x) { x.requests = Object.keys(reqs).filter(function (id) { return reqs[id].todo === x.id; }); x.disputed = x.requests.some(function (id) { var q1 = reqs[id]; return q1.status === 'disputed' || (q1.decOut || []).length > 0; }); });
    return T;
  }
  /* A request's status, in this order: what landed first (an application the head reaches is Applied, whatever authority says
     now), then anything that holds it, then a dispute, a decline, authority (Queued), and otherwise Waiting. */
  function statusOf(T, q, o, map, heldIds) {
    var set = function (s, why) { q.status = s; q.why = why || ''; };
    if (q.landed) return set('applied');
    if (T.broken) return set('held', T.broken.why);
    if (heldIds[q.id]) return set('held', 'It refers to a record this computer can\'t read yet.');
    if (o.ended) return set('held', 'The run has ended; this is kept as a notice and changes nothing.');
    var x = q.todo ? T.byTodo[q.todo] : null;
    if (q.op === 'add') {
      var pw = map ? placementWhy(map, q.target, q.placement) : 'its checklist can\'t be read';
      if (pw) return set('held', 'It needs placement: ' + pw + '.');
      if (T.added >= LIMITS.todos) return set('held', 'This run has had ' + LIMITS.todos + ' to-dos added, the most it takes. Nothing was cut.');
    } else if (!x) return set('held', 'It names ' + q.todo + ', which hasn\'t been added to this run' + (q.todo && Object.keys(T.requests).some(function (id) { return T.requests[id].todo === q.todo && T.requests[id].op === 'add'; }) ? ' yet' : '') + '.');
    else if (q.op === 'reopen' ? x.state === 'open' : x.state !== 'open') return set('held', 'It no longer fits: ' + x.id + ' is ' + STATE_WORDS[x.state].toLowerCase() + ' now.');
    var wideDec = (q.decOut || []).length > LIMITS.seen, wideApp = (q.appOut || []).length > LIMITS.seen;
    if (wideDec) return set('disputed', q.decOut.length + ' decisions on this request were made at once, more than one record can settle (' + LIMITS.seen + '). Settle these ' + LIMITS.seen + ' first, then the rest.');
    if (q.decReview.length) return set('disputed', q.decReview[0].why);
    if (wideApp || q.appReview.length) {
      /* Only prepared applications disagree, and none landed: the request is still authorized or not as before, and the
         recorder settles them, a page of LIMITS.seen at a time, held until the last page is covered. */
      var au = o.authority ? o.authority(q, T) : { ok: false };
      if (au.ok) { q.via = au.via; q.appOnly = true; }
      return set('disputed', wideApp ? q.appOut.length + ' applications of this request were prepared at once, more than one record can settle (' + LIMITS.seen + '); the recorder settles them a page at a time.' : q.appReview[0].why);
    }
    if (q.dec && q.dec.op === 'decline') return set('declined', '');
    var auth = o.authority ? o.authority(q, T) : { ok: false, why: '' };
    if (auth.ok) { q.via = auth.via; return set('queued', auth.why); }
    return set('waiting', auth.why);
  }
  /* The records a new record names as seen: its required ones (the request, its decision, the application before it), then
     the outstanding participants of the slots it touches, then the other heads, at most LIMITS.seen (PF.loop.page). left: how
     many outstanding decisions a settlement leaves for the next page. */
  function seenFor(T, must, ids, slots) {
    if (T.heads.length <= LIMITS.seen) return { seen: T.heads.slice().sort(cmpStr), left: 0 };
    var first = [], have = Object.create(null), add = function (id) { if (id && !have[id]) { have[id] = true; first.push(id); } };
    (must || []).forEach(add);
    var n = first.length, more = [];
    (ids || []).forEach(function (id) { var q1 = T.requests[id]; if (q1) (slots || ['dec', 'app']).forEach(function (sl) { (q1[sl + 'Front'] || []).forEach(function (f) { if (!have[f]) { have[f] = true; more.push(f); } }); }); });
    return PF.loop.page(T.heads, first.slice(0, n).concat(more.sort(cmpStr)), []);
  }
  /* Every request, newest first by causal order, with its status in words. */
  function requestsOf(T) {
    var out = T.order.filter(function (id) { return T.requests[id]; }).map(function (id) { return T.requests[id]; });
    return out.concat(Object.keys(T.requests).filter(function (id) { return T.requests[id].unordered; }).sort(cmpStr).map(function (id) { return T.requests[id]; }));
  }

  /* ---- Authority (slice 1, commit 2). A decision, grant, revoke or compound counts only from a person in people.json, not
     inactive, who records the run or holds one of its roles. Attribution in a file is a claim under the folder's trust model. ---- */
  function personWhy(r, person, people) {
    var list = PF.people.listOf(people), p = null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === person) { p = list[i]; break; }
    if (!person || !p) return (person || 'Whoever made it') + ' isn\'t in people.json';
    if (p.inactive) return (p.name || person) + ' is marked inactive in people.json';
    if (r.recorder && r.recorder.person === person) return '';
    if (r.roles && Object.keys(r.roles).some(function (k) { return r.roles[k] === person; })) return '';
    return (p.name || person) + ' neither records this run nor holds one of its roles';
  }
  function mayFor(r, people) {
    return function (rec) { var person = rec.kind === 'compound' ? rec.decision && rec.decision.by : rec.by && rec.by.person; return personWhy(r, person, people); };
  }
  /* What applying a request would do beyond its own work: the approvals it reopens (a passed or waived gate, an approved
     loop) and whether it releases work (Won't do, Moved). Its fingerprint is what a decision accepts; a different one later
     needs consent again. */
  function consequenceOf(r, map, q, T) {
    var x = q.todo && T ? T.byTodo[q.todo] : null, t = q.op === 'add' ? q.target : x ? x.target : null, reopens = [], releases = q.op === 'wont' || q.op === 'move';
    if ((q.op === 'add' || q.op === 'reopen') && t && map) {
      var P = placeOf(map, t);
      if (!P.why) {
        var g = r.gates && own(r.gates, P.gate) ? r.gates[P.gate] : null, a = P.loop && r.steps && own(r.steps, P.loop) ? r.steps[P.loop] : null;
        if (g && (g.s === 'passed' || g.s === 'waived')) reopens.push('gate:' + P.gate);
        if (a && a.s === 'done' && a.loop) reopens.push('loop:' + P.loop);
      }
    }
    return { reopens: reopens, releases: releases, fingerprint: fp([q.op, q.todo || '', targetKey(t), reopens, releases]) };
  }
  /* Whether a request is authorized now: { ok, via: { decision | grant | compound }, why }. Releasing work or reopening an
     approval needs a person's decision on exactly that consequence; a grant covers only add, done and reopen on its exact
     targets, within its limit, never a release, a reopened approval or a gate. */
  function authorityFor(r, map, people) {
    var use = null;
    return function (q, T) {
      if (!use) {
        /* Additions a grant already landed count toward its limit, whoever applies next. */
        use = Object.create(null);
        var byId = Object.create(null); T.records.forEach(function (y) { byId[y.id] = y; });
        T.chain.forEach(function (id) { var a = byId[id], ap = a && (a.kind === 'compound' ? a.application : a); if (ap && ap.effect.op === 'add' && ap.authority && ap.authority.grant) use[ap.authority.grant] = (use[ap.authority.grant] || 0) + 1; });
      }
      var C = consequenceOf(r, map, q, T), human = C.releases || C.reopens.length > 0, d = q.dec;
      if (d && d.op === 'accept' && !d.contrary) {
        if (d.consequence === C.fingerprint) return { ok: true, via: q.kind === 'compound' && d.record === q.id ? { compound: q.id } : { decision: d.record }, why: '' };
        return { ok: false, why: 'What it would do changed after it was approved (' + (C.reopens.length ? 'it now reopens an approval' : 'its consequence is different') + '), so it needs approval again.' };
      }
      var wordsWhy = C.releases ? 'It releases work, so a person approves it.' : C.reopens.length ? 'It reopens an approval, so a person approves it.' : 'It waits for a person\'s approval or a delegation that covers it.';
      if (human) return { ok: false, why: wordsWhy };
      var x = q.todo ? T.byTodo[q.todo] : null, tk = targetKey(q.op === 'add' ? q.target : x ? x.target : null), sub = q.by || {};
      var gs = Object.keys(T.grants).map(function (id) { return T.grants[id]; }).filter(function (g) {
        return (g.subject.tool ? g.subject.tool === sub.tool : g.subject.person === sub.person) && g.ops.indexOf(q.op) >= 0 && g.targets.some(function (t) { return targetKey(t) === tk; });
      });
      var live = gs.filter(function (g) { return g.active && T.saw(q.id, g.id); });
      for (var i = 0; i < live.length; i++) {
        var g = live[i];
        if (q.op === 'add') { var n = use[g.id] || 0; if (n >= g.limits.adds) continue; use[g.id] = n + 1; }
        return { ok: true, via: { grant: g.id }, why: '' };
      }
      if (gs.length) return { ok: false, why: gs.some(function (g) { return g.revoked.length; }) ? 'The delegation that covered it was revoked, so it waits for a person\'s approval.' : gs.some(function (g) { return !g.active; }) ? 'The delegation that would cover it wasn\'t given by someone who may: ' + gs[0].why + '.' : gs.some(function (g) { return !T.saw(q.id, g.id); }) ? 'It was made without seeing the delegation that would cover it.' : 'Its delegation\'s limit of ' + gs[0].limits.adds + ' additions is used up.' };
      return { ok: false, why: wordsWhy };
    };
  }
  /* A run's to-dos as everyone reads them. o: { records, unread (records that couldn't be read: { file, run }), people }. */
  function view(r, o) {
    o = o || {};
    var map = null; try { map = PF.run.mapOf(r); } catch (e) { map = null; }
    var T = reduce(o.records || [], r, { map: map, ended: !!r.ended, may: mayFor(r, o.people), authority: authorityFor(r, map, o.people) });
    T.map = map;
    (o.unread || []).forEach(function (u) { if (!u.run || (u.run.process === r.process && u.run.id === r.id)) T.unread.push(u); });
    return T;
  }
  /* What holds approval, read-only on every read (never saved): r._todos { all, phases, loops, stale: { gate, loop },
     scope: { gate, loop } }. all holds every gate (a chain that can't be trusted, a record that can't be read); an open or
     disputed to-do holds its phase's gate, or its loop's approval for an item's work. stale: an approval made before work
     in its scope was added or reopened, or before a dispute on it, by identity (the records its snapshot didn't include). */
  function holds(T, r) {
    var H = { all: [], phases: Object.create(null), loops: Object.create(null), stale: { gate: Object.create(null), loop: Object.create(null) }, scope: { gate: Object.create(null), loop: Object.create(null) }, open: 0 };
    var map = T.map, push = function (o, k, why) { (o[k] = o[k] || []).push(why); };
    if (r.ended) return H;
    if (!map) { H.all.push('Its checklist can\'t be read, so its to-dos can\'t be placed.'); return H; }
    if (T.broken) H.all.push(T.broken.why);
    T.unread.forEach(function (u) { H.all.push('A to-do record (' + String(u.file || '').slice(0, 120) + ') can\'t be read yet, so approval waits until it is.'); });
    T.held.forEach(function (h) { H.all.push('A to-do record (' + h.record + ') ' + (h.why === 'copies' ? 'has two different copies in the folder.' : 'refers to one this computer can\'t read yet.')); });
    var place = function (t, why) {
      var P = placeOf(map, t);
      if (P.why) { H.all.push(why + ' ' + P.why + '.'); return; }
      if (t.item) push(H.loops, P.loop, why); else push(H.phases, P.phaseId, why);
    };
    T.todos.forEach(function (x) {
      if (x.state === 'open') { H.open++; place(x.target, 'To-do "' + x.text + '" is open.'); }
      else if (x.disputed) place(x.target, 'To-do "' + x.text + '" was decided two ways at once.');
    });
    requestsOf(T).forEach(function (q) {
      if (q.op === 'add' && q.status === 'disputed') place(q.target, 'An addition ("' + q.text + '") was decided two ways at once.');
      if (q.op === 'add' && q.status === 'held' && /^It needs placement/.test(q.why)) { var P = placeOf(map, q.target); if (P.why) H.all.push('An addition ("' + q.text + '") ' + q.why.charAt(0).toLowerCase() + q.why.slice(1)); else (q.target.item ? push(H.loops, P.loop, q.why) : push(H.phases, P.phaseId, q.why)); }
    });
    /* The records an approval in each scope must have counted: additions and reopenings that landed, and every participant
       of a dispute on work there. */
    var addScope = function (t, id) { var P = placeOf(map, t); if (P.why) return; var o = t.item ? H.scope.loop : H.scope.gate, k = t.item ? P.loop : P.gate; (o[k] = o[k] || []).indexOf(id) < 0 && o[k].push(id); };
    var recOf = Object.create(null); T.records.forEach(function (y) { recOf[y.id] = y; });
    T.chain.forEach(function (id) {
      var a = recOf[id], e = a && (a.kind === 'compound' ? a.application.effect : a.effect);
      if (!e || (e.op !== 'add' && e.op !== 'reopen')) return;
      var x = T.byTodo[e.todo]; if (x) addScope(x.target, id);
    });
    Object.keys(T.requests).forEach(function (id) {
      var q = T.requests[id], x = q.todo ? T.byTodo[q.todo] : null, t = q.target || (x && x.target);
      if (!t) return;
      (q.disputedIds || []).forEach(function (pid) { addScope(t, pid); });
    });
    if (!r.living) return H;
    var said = function (ids, cut) { var have = Object.create(null); (cut || []).forEach(function (c) { have[c] = true; }); return ids.filter(function (i) { return !have[i]; }); };
    map.phases.forEach(function (p) {
      var g = p.gate, rec = g && r.gates && own(r.gates, g.id) ? r.gates[g.id] : null;
      if (!rec || (rec.s !== 'passed' && rec.s !== 'waived')) return;
      var after = said(H.scope.gate[g.id] || [], rec.todos ? rec.todos.cut : []);
      if (after.length) H.stale.gate[g.id] = ['A to-do in this phase was added, reopened or decided two ways after it was ' + rec.s + ' (' + after.length + (after.length === 1 ? ' record' : ' records') + ' it didn\'t count).'];
    });
    Object.keys(H.scope.loop).forEach(function (sid) {
      var a = r.steps && own(r.steps, sid) ? r.steps[sid] : null;
      if (!a || a.s !== 'done' || !a.loop) return;
      var after = said(H.scope.loop[sid], a.todos ? a.todos.cut : []);
      if (after.length) H.stale.loop[sid] = ['An item\'s to-do was added, reopened or decided two ways after this approval.'];
    });
    return H;
  }
  /* Every run's holds, read-only, on every read (like PF.loop.markStale). A run with no to-do records and no living marker
     is left exactly as it was. o: { records, unread, people }. */
  function markHolds(runs, o) {
    o = o || {};
    (runs || []).forEach(function (r) {
      if (!r || !r.steps || r._unrunnable) return;
      var mine = recordsFor(o.records, r), un = (o.unread || []).filter(function (u) { return u.run ? u.run.process === r.process && u.run.id === r.id : !!r.living; });
      if (!mine.length && !r.living && !un.length) { delete r._todos; return; }
      r._todos = holds(view(r, { records: mine, unread: un, people: o.people }), r);
    });
  }
  /* What an approval records (a gate's or a loop's): the records in its scope it counted, so later ones are known by identity. */
  function cutFor(H, kind, id) {
    var ids = H && H.scope && H.scope[kind] && H.scope[kind][id] ? H.scope[kind][id].slice().sort() : [];
    if (ids.length > LIMITS.cut) throw new Error('This approval would count ' + ids.length + ' to-do records; one approval counts at most ' + LIMITS.cut + '. Nothing was approved.');
    return { cut: ids };
  }
  function cleanCut(v) {
    if (!isMap(v) || Object.keys(v).length !== 1 || !Array.isArray(v.cut) || v.cut.length > LIMITS.cut || !v.cut.every(function (x) { return typeof x === 'string' && (REQ.test(x) || DNAME.test(x + '.json')); })) return null;
    return { cut: v.cut.slice() };
  }
  var HEAD = /^(req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24})(\.status-[a-z0-9][a-z0-9-]{0,39}-[0-9a-f]{8})?$/;
  function cleanLiving(v) { return isMap(v) && Object.keys(v).length === 1 && typeof v.head === 'string' && HEAD.test(v.head) ? { head: v.head } : null; }

  /* ---- Application (slice 1, commit 3). The recorder's window carries out a queued request in two writes: the application
     record first (in proposals/, guarded), then the run, whose living.head moves to it. Recovery reads what is there before
     writing anything: a request the head already reaches is done (whatever authority says now); an application already
     written for the head as it stands, with the same effect and authority, is landed as it is; otherwise a new one is
     prepared. A request that isn't queued now (authority lost, held, disputed) is left alone. ---- */
  function sameVia(a, b) { return !!a && !!b && JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }
  function applyPlan(r, T, q) {
    if (!q) return { skip: 'There is no such request.' };
    if (q.landed) return { landed: q.landed };
    /* Nothing is prepared or landed while any of the run's records can't be read or read in order: what it says isn't known. */
    if (T.broken) return { skip: T.broken.why };
    if (T.unread.length) return { skip: 'A to-do record (' + String(T.unread[0].file || '').slice(0, 120) + ') can\'t be read yet, so nothing is applied until it is.' };
    if (T.held.length) return { skip: 'A to-do record (' + T.held[0].record + ') can\'t be read in order yet, so nothing is applied until it is.' };
    /* Two applications prepared at once (two windows, neither landed) block nothing: a new one that saw both settles them. */
    var appOnly = q.status === 'disputed' && q.appOnly && q.via;
    if (q.status !== 'queued' && !appOnly) return { skip: q.why || 'It is ' + q.status + '.' };
    var head = r.living && typeof r.living.head === 'string' ? r.living.head : '', byId = Object.create(null);
    T.records.forEach(function (y) { byId[y.id] = y; });
    var p = byId[q.id];
    if (!p) return { skip: 'Its request can\'t be read in order yet.' };
    var eff = effectOf(p), f = fp(eff);
    if (p.kind === 'compound' && q.via && q.via.compound === p.id && (p.application.previous || '') === head && p.application.fingerprint === f) return { adopt: p };
    /* The candidate that settled them, when there is one, else the first by id: the same one in every window. */
    var fit = q.candidates.map(function (id) { return byId[id]; }).filter(function (a) { return a && (a.previous || '') === head && a.fingerprint === f && sameVia(a.authority, q.via); }).sort(function (a, b) { return cmpStr(a.id, b.id); });
    var c = fit.filter(function (a) { return q.app && a.id === q.app.record; })[0] || fit[0];
    if (c && !appOnly) return { adopt: c };
    var must = [q.id]; if (head) must.push(head); if (q.via && q.via.decision) must.push(q.via.decision); if (q.via && q.via.grant) must.push(q.via.grant);
    return { write: { kind: 'application', proposal: q.id, run: { process: T.run.process, id: T.run.id }, seen: seenFor(T, must, [q.id], ['app']).seen, authority: q.via, previous: head, effect: eff } };
  }
  /* The first queued request of a run, in causal order: one lands at a time, so each is checked against the work as the one
     before it left it. */
  function nextQueued(T) { return requestsOf(T).filter(function (q) { return q.status === 'queued' && !q.landed; })[0] || null; }

  return { FORMAT: FORMAT, STATUS: STATUS, FEATURE: FEATURE, LIMITS: LIMITS, OPS: OPS, WORDS: WORDS, STATE_WORDS: STATE_WORDS, idFor: idFor, todoIdFor: todoIdFor, statusName: statusName, isTodo: isTodo, claims: claims, familyOf: familyOf,
    targetKey: targetKey, placeOf: placeOf, placementWhy: placementWhy, placementFor: placementFor, effectOf: effectOf, fingerprint: fp, text: text,
    buildProposal: buildProposal, buildGrant: buildGrant, buildStatus: buildStatus, cleanFile: cleanFile, fileWhy: fileWhy, filed: filed, runOf: runOf, recordsFor: recordsFor,
    reduce: reduce, seenFor: seenFor, requestsOf: requestsOf,
    personWhy: personWhy, mayFor: mayFor, consequenceOf: consequenceOf, authorityFor: authorityFor, view: view, holds: holds, markHolds: markHolds, cutFor: cutFor, cleanCut: cleanCut, cleanLiving: cleanLiving, applyPlan: applyPlan, nextQueued: nextQueued };
})();
