/* Living runs (4.0, docs/design.md 45): to-dos added to a run while it runs. Pure: no files, no clocks.
   Every change is a record in proposals/, written once: a proposal asks, a decision authorizes, an application changes the
   work. Only the recorder writes applications, and an application counts only once run.json's living.head reaches it, so
   effective work is the chain of applications from that head. Order is causal (each record names what it saw), ties by id,
   with the one reducer and settlement loops use (PF.loop.causal, PF.loop.settleIn, PF.loop.page). */
PF.todos = (function () {
  'use strict';
  var FORMAT = 'flightdeck-plan/4', STATUS = 'flightdeck-plan-status/4', FEATURE = 'living-runs', FEATURES = [FEATURE];
  /* One limit table for writers and readers. Anything over a limit is refused whole, never cut. */
  var LIMITS = { todos: 500, text: 200, reason: 300, link: 2048, bytes: 262144, seen: 50, targets: 50, grantAdds: 500, cut: 5000, spreads: 50, items: 500 };
  var OPS = ['add', 'done', 'wont', 'move', 'reopen'], DOPS = ['accept', 'decline'];
  /* Spreads (4.0 slice 3, docs/design.md 45.1): a standing requirement on a loop is parent-run work, asked, decided and applied
     like a to-do, by its own operations. spread-add installs one; include opts in one item cleared when it was added; bind
     says which run of an item's attempt covers it; stop ends future inheritance (a release: a person decides). */
  var SOPS = ['spread-add', 'spread-include', 'spread-bind', 'spread-stop'], ALL_OPS = OPS.concat(SOPS);
  function isSpreadOp(op) { return SOPS.indexOf(op) >= 0; }
  var PKINDS = ['proposal', 'compound', 'grant', 'revoke'], SKINDS = ['decision', 'application'];
  var PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, RUN = /^[a-z0-9-]{1,40}$/i, STEP = /^[a-z0-9][a-z0-9-]{0,59}$/i, PERSON = /^[A-Za-z0-9_.-]{1,80}$/;
  var TOOL = /^[a-z0-9][a-z0-9-]{0,29}$/, VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/, KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  var REQ = /^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}$/, TD = /^td-[0-9a-f]{24}$/, FP = /^[0-9a-f]{16}$/, SP = /^sp-[0-9a-f]{24}$/;
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
  /* A destination as a person types it: a ticket key, an http(s) link, or <process>/<run id>; null when it is none of them. */
  function toOf(v) {
    if (isMap(v)) { var e = []; var t = cleanTo(v, e); return e.length ? null : t; }
    if (typeof v !== 'string') return null;
    var x = v.trim(); if (!x || x.length > LIMITS.link) return null;
    if (TICKET.test(x)) return { ticket: x.toUpperCase() };
    if (/^https?:\/\//i.test(x)) return PF.loop.httpLink(x) ? { link: x } : null;
    if (/^[a-z0-9][a-z0-9-]{0,59}\/[a-z0-9-]{1,40}$/i.test(x)) return { run: x };
    return null;
  }
  /* Moved work goes somewhere else: never to the run the record is for, which would release it while it went nowhere. */
  function selfMove(run, to, errors) { if (run && to && typeof to.run === 'string' && to.run.toLowerCase() === (run.process + '/' + run.id).toLowerCase()) errors.push('"to" names this run itself; moved work goes to another run, a ticket or a link.'); }
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
  /* ---- A spread's fields (4.0 slice 3): an item's attempt, a list of them, the reviewed scope, the child gate, a destination
     run and what a story's request fulfils. Each is checked whole; a list over its limit is refused, never cut. ---- */
  function cleanPair(v, errors, what) {
    if (!isMap(v) || Object.keys(v).length !== 2 || typeof v.uid !== 'string' || !UID.test(v.uid) || typeof v.attempt !== 'number' || Math.floor(v.attempt) !== v.attempt || v.attempt < 1 || v.attempt > 999) { errors.push(what + ' is {"uid": <the item\'s uid>, "attempt": <its attempt>}.'); return null; }
    return { uid: v.uid, attempt: v.attempt };
  }
  function cleanPairs(v, max, errors, what) {
    if (!Array.isArray(v) || v.length > max) { errors.push(what + ' is a list of at most ' + max + ' items.'); return null; }
    var out = [], have = Object.create(null);
    for (var i = 0; i < v.length; i++) {
      var p = cleanPair(v[i], errors, what + ' ' + (i + 1)); if (!p) return null;
      var k = p.uid + '#' + p.attempt; if (have[k]) { errors.push(what + ' names ' + k + ' twice.'); return null; }
      have[k] = true; out.push(p);
    }
    return out;
  }
  function hasPair(list, p) { return (list || []).some(function (y) { return y.uid === p.uid && y.attempt === p.attempt; }); }
  /* A stop's scope cut (round 7): the loop's scope records it saw (their heads), so what was invisible to it is known. */
  function cleanStopCut(v, errors, what) {
    if (!Array.isArray(v) || v.length > LIMITS.items || !v.every(function (x) { return typeof x === 'string' && (REQ.test(x) || DNAME.test(x + '.json')); })) { errors.push(what + ' is the list of the loop\'s scope records the stop saw (at most ' + LIMITS.items + ').'); return null; }
    return v.slice().sort(cmpStr);
  }
  function cleanScope(v, errors) {
    if (!isMap(v)) { errors.push('"scope" is {"open", "cleared", "fingerprint", "seen"}.'); return null; }
    var n0 = errors.length;
    only(v, ['open', 'cleared', 'fingerprint', 'seen'], '"scope"', errors);
    var o = cleanPairs(v.open, LIMITS.items, errors, '"scope" "open"'), c = cleanPairs(v.cleared, LIMITS.items, errors, '"scope" "cleared"');
    if (typeof v.fingerprint !== 'string' || !FP.test(v.fingerprint)) errors.push('"scope" "fingerprint" is the fingerprint of the scope reviewed.');
    /* seen: the loop's scope records it was reviewed against (their heads), so one that goes missing is known by identity. */
    if (!Array.isArray(v.seen) || v.seen.length > LIMITS.items || !v.seen.every(function (x) { return typeof x === 'string' && (REQ.test(x) || DNAME.test(x + '.json')); })) errors.push(Array.isArray(v.seen) && v.seen.length > LIMITS.items ? '"scope" "seen" names ' + v.seen.length + ' scope records; a spread names at most ' + LIMITS.items + '.' : '"scope" "seen" is the list of the loop\'s scope records it was reviewed against.');
    if (errors.length > n0 || !o || !c) return null;
    if (o.length + c.length > LIMITS.items) { errors.push('"scope" names ' + (o.length + c.length) + ' items; a spread covers at most ' + LIMITS.items + '.'); return null; }
    if (o.some(function (p) { return hasPair(c, p); })) { errors.push('"scope" names an item as both open and cleared.'); return null; }
    return { open: o, cleared: c, fingerprint: v.fingerprint, seen: v.seen.slice() };
  }
  function cleanChild(v, errors) {
    if (!isMap(v) || Object.keys(v).length !== 1 || typeof v.beforeGate !== 'string' || !STEP.test(v.beforeGate)) { errors.push('"child" is {"beforeGate": <a gate of the item\'s checklist>}.'); return null; }
    return { beforeGate: v.beforeGate };
  }
  function cleanDest(v, errors) {
    if (!isMap(v) || Object.keys(v).length !== 2 || typeof v.process !== 'string' || !PROC.test(v.process) || typeof v.id !== 'string' || !RUN.test(v.id)) { errors.push('"dest" is {"process": <checklist>, "id": <run id>}.'); return null; }
    return { process: v.process, id: v.id };
  }
  function cleanFulfills(v, errors) {
    if (!isMap(v) || Object.keys(v).length !== 4) { errors.push('"fulfills" is {"run", "spread", "uid", "attempt"}.'); return null; }
    var n0 = errors.length, run = cleanRun(v.run, errors), pair = cleanPair({ uid: v.uid, attempt: v.attempt }, errors, '"fulfills"');
    if (typeof v.spread !== 'string' || !SP.test(v.spread)) errors.push('"fulfills" "spread" is a spread id (sp-...).');
    if (errors.length > n0) return null;
    return { run: run, spread: v.spread, uid: pair.uid, attempt: pair.attempt };
  }
  var SFIELDS = ['spread', 'loopStep', 'child', 'scope', 'item', 'dest', 'owed', 'cut'];
  /* A spread operation's body: spread-add (its loop step, text, child gate and the scope reviewed; the spread's id comes from
     the request), include (one item's attempt cleared when it was added), bind (which run covers an item's attempt), stop
     (why, and the obligations it keeps). */
  function cleanSpreadBody(o, errors, id) {
    var b = { op: o.op };
    ['todo', 'target', 'placement', 'origin', 'to', 'fulfills', 'support'].forEach(function (k) { if (o[k] != null) errors.push('A spread request has no ' + q(k) + '.'); });
    if (o.op === 'spread-add') {
      var sid = PF.spreads.idFor(id);
      if (o.spread != null && o.spread !== sid) errors.push('"spread" of a spread-add is the id its request gives it (' + sid + ').');
      b.spread = sid;
      if (typeof o.loopStep !== 'string' || !STEP.test(o.loopStep)) errors.push('"loopStep" is the loop step\'s id.'); else b.loopStep = o.loopStep;
      b.text = line(o.text, LIMITS.text, '"text"', errors);
      b.child = cleanChild(o.child, errors);
      b.scope = cleanScope(o.scope, errors);
      if (o.owner != null) { if (typeof o.owner !== 'string' || !PERSON.test(o.owner)) errors.push('"owner" is a person\'s ID from people.json.'); else b.owner = o.owner; }
      ['item', 'dest', 'owed', 'cut'].forEach(function (k) { if (o[k] != null) errors.push('A spread-add has no ' + q(k) + '.'); });
    } else {
      if (typeof o.spread !== 'string' || !SP.test(o.spread)) errors.push('"spread" is the spread\'s id (sp-...).'); else b.spread = o.spread;
      ['loopStep', 'text', 'child', 'scope', 'owner'].forEach(function (k) { if (o[k] != null) errors.push('Only a spread-add has ' + q(k) + '.'); });
      if (o.op === 'spread-include' || o.op === 'spread-bind') b.item = cleanPair(o.item, errors, '"item"'); else if (o.item != null) errors.push('A stop has no "item".');
      if (o.op === 'spread-bind') b.dest = cleanDest(o.dest, errors); else if (o.dest != null) errors.push('Only a binding has "dest".');
      if (o.op === 'spread-stop') { b.owed = cleanPairs(o.owed, LIMITS.items, errors, '"owed"'); b.cut = cleanStopCut(o.cut, errors, '"cut"'); } else { if (o.owed != null) errors.push('Only a stop has "owed".'); if (o.cut != null) errors.push('Only a stop has "cut".'); }
    }
    if (o.op === 'spread-stop') b.reason = line(o.reason, LIMITS.reason, '"reason" (why it stops)', errors);
    else if (o.reason != null) { var r = line(o.reason, LIMITS.reason, '"reason"', errors); if (r) b.reason = r; }
    if (o.requester != null) { if (typeof o.requester !== 'string' || !PERSON.test(o.requester)) errors.push('"requester" is the ID from people.json of the person who asks.'); else b.requester = o.requester; }
    return b;
  }

  /* The operation a request asks for, as a proposal or a compound carries it. op: one of OPS; add has text and a target. */
  var BODY = ['op', 'todo', 'target', 'placement', 'text', 'owner', 'reason', 'origin', 'to', 'requester', 'spread', 'loopStep', 'child', 'scope', 'item', 'dest', 'owed', 'cut', 'fulfills', 'support'];
  function cleanBody(o, errors, id) {
    var b = { op: o.op };
    if (ALL_OPS.indexOf(o.op) < 0) { errors.push('"op" is one of ' + ALL_OPS.join(', ') + ' (one operation per request).'); return null; }
    if (isSpreadOp(o.op)) return cleanSpreadBody(o, errors, id);
    SFIELDS.forEach(function (k) { if (o[k] != null) errors.push('Only a spread request has ' + q(k) + '.'); });
    if (o.op !== 'add' && o.fulfills != null) errors.push('Only an addition has "fulfills".');
    if (o.op === 'add') {
      if (o.fulfills != null) b.fulfills = cleanFulfills(o.fulfills, errors);
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
    /* Facts (4.0 slice 4): a done request may carry the evidence a tool suggested it on (PF.facts); nothing else does. */
    if (o.support != null) { if (o.op !== 'done') errors.push('Only a done request has "support".'); else b.support = PF.facts.cleanSupport(o.support, errors); }
    if (o.op === 'add' && o.owner != null) { if (typeof o.owner !== 'string' || !PERSON.test(o.owner)) errors.push('"owner" is a person\'s ID from people.json.'); else b.owner = o.owner; }
    if (o.op === 'wont') { b.reason = line(o.reason, LIMITS.reason, '"reason" (why it won\'t be done)', errors); }
    else if (o.reason != null) { var r = line(o.reason, LIMITS.reason, '"reason"', errors); if (r) b.reason = r; }
    if (o.requester != null) { if (typeof o.requester !== 'string' || !PERSON.test(o.requester)) errors.push('"requester" is the ID from people.json of the person who asks.'); else b.requester = o.requester; }
    return b;
  }
  /* The effect an application of a proposal records: exactly what changes, checked against the work as it stands. */
  function effectOf(p) {
    if (isSpreadOp(p.op)) {
      var s = { op: p.op, spread: p.spread };
      if (p.op === 'spread-add') { s.loopStep = p.loopStep; s.text = p.text; s.child = p.child; s.scope = p.scope; if (p.owner) s.owner = p.owner; }
      if (p.item) s.item = p.item;
      if (p.dest) s.dest = p.dest;
      if (p.op === 'spread-stop') { s.owed = p.owed; s.cut = p.cut; }
      if (p.reason) s.reason = p.reason;
      return s;
    }
    var e = { op: p.op, todo: p.todo };
    if (p.op === 'add') { e.text = p.text; e.target = p.target; e.placement = p.placement; if (p.owner) e.owner = p.owner; if (p.reason) e.reason = p.reason; if (p.origin) e.origin = p.origin; if (p.fulfills) e.fulfills = p.fulfills; }
    if (p.op === 'wont' || ((p.op === 'reopen' || p.op === 'done' || p.op === 'move') && p.reason)) e.reason = p.reason;
    if (p.op === 'move') e.to = p.to;
    if (p.op === 'done' && p.support) e.support = p.support;
    return e;
  }
  /* The fields an effect of each op may have; any other is refused, never dropped (so a fingerprint is checked on exactly
     what the file says). Every field is type-checked before it is used. */
  var EFIELDS = { add: ['op', 'todo', 'text', 'target', 'placement', 'owner', 'reason', 'origin', 'fulfills'],
    'spread-add': ['op', 'spread', 'loopStep', 'text', 'child', 'scope', 'owner', 'reason'], 'spread-include': ['op', 'spread', 'item', 'reason'], 'spread-bind': ['op', 'spread', 'item', 'dest', 'reason'], 'spread-stop': ['op', 'spread', 'reason', 'owed', 'cut'], done: ['op', 'todo', 'reason', 'support'], reopen: ['op', 'todo', 'reason'], wont: ['op', 'todo', 'reason'], move: ['op', 'todo', 'to', 'reason'] };
  function cleanEffect(e, errors) {
    if (!isMap(e)) { errors.push('"effect" is the change it made.'); return null; }
    if (typeof e.op !== 'string' || ALL_OPS.indexOf(e.op) < 0) { errors.push('"effect" "op" is one of ' + ALL_OPS.join(', ') + '.'); return null; }
    var n0 = errors.length;
    only(e, EFIELDS[e.op], '"effect" of ' + e.op, errors);
    if (errors.length > n0) return null;
    var out = { op: e.op };
    if (isSpreadOp(e.op)) {
      if (typeof e.spread !== 'string' || !SP.test(e.spread)) { errors.push('"effect" "spread" is a spread id.'); return null; }
      out.spread = e.spread;
      if (e.op === 'spread-add') {
        if (typeof e.loopStep !== 'string' || !STEP.test(e.loopStep)) errors.push('"effect" "loopStep" is a loop step id.'); else out.loopStep = e.loopStep;
        out.text = line(e.text, LIMITS.text, '"effect" "text"', errors); out.child = cleanChild(e.child, errors); out.scope = cleanScope(e.scope, errors);
        if (e.owner != null) { if (typeof e.owner !== 'string' || !PERSON.test(e.owner)) errors.push('"effect" "owner" is a person\'s ID.'); else out.owner = e.owner; }
      }
      if (e.op === 'spread-include' || e.op === 'spread-bind') out.item = cleanPair(e.item, errors, '"effect" "item"');
      if (e.op === 'spread-bind') out.dest = cleanDest(e.dest, errors);
      if (e.op === 'spread-stop') { out.owed = cleanPairs(e.owed, LIMITS.items, errors, '"effect" "owed"'); out.cut = cleanStopCut(e.cut, errors, '"effect" "cut"'); out.reason = line(e.reason, LIMITS.reason, '"effect" "reason"', errors); }
      else if (e.reason != null) { var sr = line(e.reason, LIMITS.reason, '"effect" "reason"', errors); if (sr) out.reason = sr; }
      return out;
    }
    if (typeof e.todo !== 'string' || !TD.test(e.todo)) { errors.push('"effect" "todo" is a to-do id.'); return null; }
    out.todo = e.todo;
    if (e.op === 'add') { out.text = line(e.text, LIMITS.text, '"effect" "text"', errors); out.target = cleanTarget(e.target, errors, '"effect" "target"'); out.placement = cleanPlacement(e.placement, errors); if (e.owner != null) { if (typeof e.owner !== 'string' || !PERSON.test(e.owner)) errors.push('"effect" "owner" is a person\'s ID.'); else out.owner = e.owner; } if (e.origin != null) out.origin = cleanOrigin(e.origin, errors); if (e.fulfills != null) { out.fulfills = cleanFulfills(e.fulfills, errors); } }
    if (e.reason != null) { var r = line(e.reason, LIMITS.reason, '"effect" "reason"', errors); if (r) out.reason = r; }
    if (e.op === 'wont' && !out.reason) errors.push('"effect" of a won\'t-do says why.');
    if (e.op === 'move') out.to = cleanTo(e.to, errors);
    if (e.support != null) out.support = PF.facts.cleanSupport(e.support, errors);
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
    f.id = o.id || (b.fulfills ? PF.spreads.childRequestId(b.fulfills.spread, b.fulfills.uid, b.fulfills.attempt, o.run) : b.support && b.op === 'done' ? PF.facts.suggestionId(b.todo, b.support.incarnation, b.support.source, b.support.domain, b.support.content) : o.producer ? idFor(o.producer.name, o.key) : '');
    f.run = { process: o.run.process, id: o.run.id };
    f.seen = (o.seen || []).slice().sort();
    if (o.producer) { f.producer = { name: o.producer.name, version: o.producer.version }; f.key = o.key; } else f.by = o.by;
    f.at = o.at;
    BODY.forEach(function (k) { if (b[k] != null) f[k] = b[k]; });
    if (b.op === 'add') f.todo = todoIdFor(f.id);
    if (b.op === 'spread-add') f.spread = PF.spreads.idFor(f.id);
    if (o.producer && b.fulfills) f.key = PF.spreads.obligationId(b.fulfills.spread, b.fulfills.uid, b.fulfills.attempt);
    if (o.producer && b.support && b.op === 'done') f.key = PF.facts.suggestionKey(b.todo, b.support.incarnation, b.support.source, b.support.domain, b.support.content);
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
  function cleanFile(o, name, bytes) {
    /* bytes: the file's own size in UTF-8, when read from a folder; a to-do record over the limit is refused, never cut. */
    if (typeof bytes === 'number' && bytes > LIMITS.bytes) return mal('is ' + bytes + ' bytes; a to-do record is at most ' + LIMITS.bytes);
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
        if (rec.effect) selfMove(rec.run, rec.effect.to, errors);
        if (typeof o.fingerprint !== 'string' || !FP.test(o.fingerprint)) errors.push('"fingerprint" is its effect\'s fingerprint.');
        else if (rec.effect && o.fingerprint !== fp(rec.effect)) errors.push('"fingerprint" doesn\'t match its effect.');
        else rec.fingerprint = o.fingerprint;
        ['op', 'consequence', 'reason'].forEach(function (k) { if (o[k] != null) errors.push('An application has no ' + q(k) + '.'); });
      }
      if (errors.length) return mal('is a to-do ' + o.kind + ' that isn\'t in its format: ' + errors[0]);
      return { ok: true, record: rec };
    }
    /* A fact (4.0 slice 4) has its own reader (PF.facts): it is never a request, so it never enters the to-do chain. */
    if (o.kind === 'fact') return PF.facts.cleanFile(o, name, mal);
    if (PKINDS.indexOf(o.kind) < 0) return mal('is a to-do record that isn\'t a proposal, a compound, a grant, a revoke or a fact');
    if (typeof o.id !== 'string' || !REQ.test(o.id)) return mal('is a to-do record without a request id');
    if (typeof name === 'string' && !requestFile(name, o.id)) return mal('is a to-do record whose name isn\'t its id');
    var r = { id: o.id, kind: o.kind, run: cleanRun(o.run, errors), seen: cleanSeen(o.seen, errors), by: cleanBy(o, errors), at: '' };
    if (typeof o.at !== 'string' || !ISO.test(o.at)) errors.push('"at" is a date and time.'); else r.at = o.at;
    /* A story's request for a spread is named by its obligation and its exact run, whichever tool or person files it. */
    var ful = isMap(o.fulfills) && typeof o.fulfills.spread === 'string' && typeof o.fulfills.uid === 'string' && r.run ? o.fulfills : null;
    if (ful) {
      if (o.id !== PF.spreads.childRequestId(ful.spread, ful.uid, ful.attempt, r.run)) errors.push('Its id isn\'t the one its spread, item, attempt and run give.');
      if (r.by && r.by.tool && o.key !== PF.spreads.obligationId(ful.spread, ful.uid, ful.attempt)) errors.push('Its key isn\'t its obligation\'s.');
      if (isMap(ful.run) && ful.run.process === r.run.process && ful.run.id === r.run.id) errors.push('"fulfills" names this run itself; a spread is on its parent.');
    } else if (isMap(o.support) && o.op === 'done') {
      /* A resolve suggestion is named by what it rests on (PF.facts.suggestionId), the same from any tool at any time; it is a
         tool's request, never a person's or a compound. */
      var sp = o.support, ok = typeof o.todo === 'string' && typeof sp.incarnation === 'string' && isMap(sp.source) && typeof sp.domain === 'string' && typeof sp.content === 'string';
      if (!r.by || !r.by.tool || o.kind !== 'proposal') errors.push('A suggestion with support is a tool\'s request.');
      else if (!ok || o.id !== PF.facts.suggestionId(o.todo, sp.incarnation, sp.source, sp.domain, sp.content)) errors.push('Its id isn\'t the one its to-do and support give.');
      else if (o.key !== PF.facts.suggestionKey(o.todo, sp.incarnation, sp.source, sp.domain, sp.content)) errors.push('Its key isn\'t its suggestion\'s.');
    } else if (r.by && r.by.tool && o.id !== idFor(r.by.tool, o.key)) errors.push('Its id isn\'t the one its tool and key give.');
    if (o.kind === 'proposal' || o.kind === 'compound') {
      only(o, COMMON.concat(BODY, o.kind === 'compound' ? ['decision', 'application'] : []), 'It', errors);
      var b = cleanBody(o, errors, o.id);
      if (b) { BODY.forEach(function (k) { if (b[k] != null) r[k] = b[k]; }); selfMove(r.run, b.to, errors); }
      if (o.kind === 'compound') {
        if (!r.by || !r.by.person) errors.push('A compound is one person\'s gesture: it has "by", no tool.');
        var d = o.decision, a = o.application;
        if (!isMap(d) || d.op !== 'accept' || d.by !== o.by || typeof d.consequence !== 'string' || !FP.test(d.consequence)) errors.push('"decision" is {"op": "accept", "by": <the same person>, "consequence": <fingerprint>}.');
        else { only(d, ['op', 'by', 'consequence', 'reason'], '"decision"', errors); r.decision = { op: 'accept', by: d.by, consequence: d.consequence }; if (d.reason != null) { var cr = line(d.reason, LIMITS.reason, '"decision" "reason"', errors); if (cr) r.decision.reason = cr; } }
        if (!isMap(a)) errors.push('"application" is {"previous", "effect", "fingerprint"}.');
        else {
          only(a, ['previous', 'effect', 'fingerprint'], '"application"', errors);
          var ap = { previous: '', effect: cleanEffect(a.effect, errors), fingerprint: '' };
          if (ap.effect) selfMove(r.run, ap.effect.to, errors);
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
  function notFact(x) { return !x || x.kind !== 'fact'; }
  /* Whether a file in proposals/ may be a to-do or fact record (req-*.json, in any case): the one test for both noticing a
     file that can't be read (a link, one cut short) and holding on it, so no name is noticed and then dropped. */
  function recordName(name) { return /^req-[^/]*\.json$/i.test(String(name || '')); }

  /* ---- Reduction: a run's to-do records, reduced to its work and each request's status. Pure; the same records in any
     order (any file names) give the same result. o: { map (the run's frozen checklist), may(record) -> '' or why a
     decision, grant or compound's person can't authorize (commit 2 supplies it), ended }. ---- */
  function reduce(records, r, o) {
    o = o || {};
    /* Facts (4.0 slice 4) are informational: they never enter the to-do order or the chain of applications. */
    /* Copies of one id that differ are found over every record read (o.all: any kind, any run) before facts are left out, so a
       request with a fact's copy, or another run's, is held with everything after it (PF.loop.withCopies). */
    var mine = recordsFor(records, r).filter(notFact), c = PF.loop.causal(PF.loop.withCopies(mine, o.all || records)), byId = Object.create(null), heldIds = Object.create(null), T;
    c.order.forEach(function (x) { byId[x.id] = x; });
    c.held.forEach(function (h) { heldIds[h.record] = h; });
    mine.forEach(function (x) { if (!byId[x.id] && !heldIds[x.id]) heldIds[x.id] = { record: x.id, missing: [], why: 'after' }; });
    T = { run: { process: r.process, id: r.id }, heads: c.heads, held: c.held.slice(), broken: null, chain: [], todos: [], byTodo: Object.create(null), requests: Object.create(null),
      order: c.order.map(function (x) { return x.id; }), grants: Object.create(null), unread: [], saw: c.saw, records: c.order, limit: null, spreads: [], bySpread: Object.create(null), bindSlots: Object.create(null) };
    var map = o.map || null;
    /* The chain of landed applications, from living.head back through previous. Any break holds every to-do (fail closed). */
    var headId = r.living && typeof r.living.head === 'string' ? r.living.head : '', chain = [], at = headId, visited = Object.create(null);
    while (at) {
      if (visited[at]) { T.broken = { why: 'Its applications go round in a circle at ' + at + '.', record: at }; break; }
      visited[at] = true;
      var a = byId[at];
      if (!a) { T.broken = { why: heldIds[at] ? 'The application ' + at + ' can\'t be read in order yet (' + (heldIds[at].why === 'copies' ? 'two different copies of it are in the folder' : 'it saw a record that isn\'t here') + ').' : 'The application ' + at + ' that the run names isn\'t in the folder.', record: at, missing: heldIds[at] ? '' : at }; break; }
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
        isSpreadOp(e.op) ? spreadReplayWhy(T, e) :
        e.op === 'add' ? (x ? 'it adds ' + e.todo + ' again' : added >= LIMITS.todos ? 'it would add more than ' + LIMITS.todos + ' to-dos' : '') :
        !x ? 'it changes ' + e.todo + ', which was never added' : e.op === 'reopen' ? (x.state === 'open' ? e.todo + ' is already open' : '') : x.state !== 'open' ? e.todo + ' is already ' + STATE_WORDS[x.state].toLowerCase() : '';
      if (why) { T.broken = { why: 'The application ' + a.id + ' can\'t be applied: ' + why + '.', record: a.id, missing: !p && !heldIds[pid] ? pid : '' }; return true; }
      landed[pid] = a.id;
      if (isSpreadOp(e.op)) { spreadReplay(T, e, a.id, pid, p); return false; }
      if (e.op === 'add') {
        added++;
        x = { id: e.todo, text: e.text, target: e.target, placement: e.placement, owner: e.owner || '', reason: e.reason || '', origin: e.origin || null, state: 'open', to: null, why: '', added: a.id, request: pid, by: p.by, history: [], disputed: false, reopened: 0, support: null };
        T.byTodo[x.id] = x; T.todos.push(x);
      } else if (e.op === 'done') { x.state = 'done'; x.why = e.reason || ''; x.support = e.support || null; }
      else if (e.op === 'wont') { x.state = 'wont'; x.why = e.reason; }
      else if (e.op === 'move') { x.state = 'moved'; x.to = e.to; x.why = e.reason || ''; }
      else { x.state = 'open'; x.to = null; x.why = e.reason || ''; x.reopened++; x.support = null; }
      x.history.push({ op: e.op, application: a.id, request: pid });
      return false;
    });
    if (T.broken) { T.todos = []; T.byTodo = Object.create(null); T.spreads = []; T.bySpread = Object.create(null); landed = Object.create(null); added = 0; }
    else T.chain = chain.map(function (a) { return a.id; });
    T.added = added;
    /* Decisions and applications per request, settled causally: contrary ones made at once are disputed until a record that
       saw every outstanding one settles them (PF.loop.settleIn, a page of LIMITS.seen at a time). */
    var reqs = T.requests, rv = function (x) { return x; };
    c.order.forEach(function (x) {
      if (x.kind === 'proposal' || x.kind === 'compound') {
        reqs[x.id] = reqOf(x, landed[x.id] || '');
        if (x.op === 'spread-bind' && x.item && x.dest) bindSettle(c, T, reqs[x.id], x);
        /* A compound's decision counts only as a separate decision would (o.may); otherwise it is ignored, with why, and the
           request waits like any other. */
        if (x.kind === 'compound') {
          var noc = o.may ? o.may(x, T) : '';
          settleRaw(reqs[x.id], x, { op: 'accept' });
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
        settleRaw(q0, x, { op: x.op });
        var no = o.may ? o.may(x, T) : '';
        if (no) { q0.ignored.push({ record: x.id, why: no }); return; }
        q0.decisions.push(x.id);
        settleDecision(q0, x, { op: x.op, by: x.by.person, consequence: x.consequence, record: x.id });
      } else { q0.candidates.push(x.id); settleApp(q0, x, x); }
    });
    /* Every record that ever took part in a dispute on a request, kept after it settles: an approval made before it never
       counts it, so settling a dispute never quietly restores that approval. */
    function ever(q1, slot, res, rec) { var ids = res === 'contrary' ? q1[slot + 'Out'] : res === 'held' ? [rec.id] : []; ids.forEach(function (id) { if (q1.disputedIds.indexOf(id) < 0) q1.disputedIds.push(id); }); }
    function settleDecision(q1, rec, val) {
      ever(q1, 'dec', PF.loop.settleIn(c, q1, 'dec', 'decReview', rec, val, function (p, v) { return p.op === v.op; },
        { both: function (p, v) { return 'Two people decided this request at once: ' + p.op + ' and ' + v.op + '.'; }, again: 'Decided again without seeing both earlier decisions.' }), rec);
    }
    /* Every decision, whoever made it, settled on its own (the 'raw' slot): its disputes only mark the records an approval
       must have counted (disputedIds), so a dispute that once held an approval keeps it in review whatever later happens to
       the eligibility of who took part, until a person approves again. Status still counts only decisions that may. */
    function settleRaw(q1, rec, val) {
      ever(q1, 'raw', PF.loop.settleIn(c, q1, 'raw', 'rawReview', rec, val, function (p, v) { return p.op === v.op; },
        { both: function () { return 'Decided two ways at once.'; }, again: 'Decided again without seeing both earlier decisions.' }), rec);
    }
    function settleApp(q1, rec, ap) {
      ever(q1, 'app', PF.loop.settleIn(c, q1, 'app', 'appReview', rec, { op: 'apply', previous: ap.previous, fingerprint: ap.fingerprint }, function (p, v) { return p.fingerprint === v.fingerprint && p.previous === v.previous; },
        { both: function (p, v) { return 'Two recorders applied this request at once.'; }, again: 'Applied again without seeing both earlier applications.' }), rec);
    }
    /* Grants: active once issued, by a person who may (o.may); a revoke ends one for good, whether or not it saw what used it.
       A revoke only ever takes authority away, so it counts whoever made it (fail closed): a revoke never lapses because its
       maker later left or became inactive, which would quietly give the delegation back. */
    function grant(x) {
      if (x.kind === 'grant') { var no = o.may ? o.may(x, T) : ''; T.grants[x.id] = { id: x.id, subject: x.subject, ops: x.ops, targets: x.targets, limits: x.limits, by: x.by, active: !no, why: no, revoked: [] }; return; }
      var g = T.grants[x.grant];
      if (!g) { T.held.push({ record: x.id, missing: [x.grant], why: 'missing' }); return; }
      g.revoked.push(x.id); g.active = false; g.why = 'It was revoked.';
    }
    /* A request this copy can't read in order is still listed, held, with what it says. */
    mine.forEach(function (x) {
      if ((x.kind !== 'proposal' && x.kind !== 'compound') || reqs[x.id]) return;
      reqs[x.id] = reqOf(x, ''); reqs[x.id].unordered = true;
    });
    /* A binding decided two ways at once leaves the item's coverage disputed until a binding that saw them all. */
    Object.keys(T.bindSlots).forEach(function (bk) {
      var sl = T.bindSlots[bk], sp = T.bySpread[sl.spread], n = (sl.bindOut || []).length;
      if (!sp || !n) return;
      sp.binds[sl.pair] = Object.assign({}, sp.binds[sl.pair] || {}, { disputed: true, why: n > LIMITS.seen ? n + ' bindings of it were made at once, more than one record can settle (' + LIMITS.seen + '). Settle these ' + LIMITS.seen + ' first, then the rest.' : (sl.bindReview[0] || { why: 'Two bindings were made at once.' }).why });
    });
    Object.keys(reqs).forEach(function (id) { statusOf(T, reqs[id], o, map, heldIds); });
    /* Work is disputed while any request on it is, and while any decision or application on it is unsettled, whatever the
       request's status: a contrary decision, or another application prepared at once, holds the work after one landed until
       a record that saw them all settles it. */
    T.todos.forEach(function (x) { x.requests = Object.keys(reqs).filter(function (id) { return reqs[id].todo === x.id; }); x.disputed = x.requests.some(function (id) { var q1 = reqs[id]; return q1.status === 'disputed' || (q1.decOut || []).length > 0 || (q1.appOut || []).length > 0; }); });
    return T;
  }
  /* A request as the reducer keeps it: what it asks, and slots for its decisions and applications. */
  function reqOf(x, landedAs) {
    return { id: x.id, kind: x.kind, op: x.op, todo: x.todo, target: x.target || null, placement: x.placement || null, text: x.text || '', to: x.to || null, reason: x.reason || '', owner: x.owner || '', origin: x.origin || null, by: x.by, requester: x.requester || '', at: x.at,
      spread: x.spread || '', loopStep: x.loopStep || '', child: x.child || null, scope: x.scope || null, item: x.item || null, dest: x.dest || null, owed: x.owed || null, cut: x.cut || null, fulfills: x.fulfills || null, support: x.support || null,
      status: '', why: '', landed: landedAs, candidates: [], decisions: [], dec: null, decReview: [], rawReview: [], app: null, appReview: [], ignored: [], disputedIds: [] };
  }
  /* ---- Spreads in the chain (4.0 slice 3): each landed spread operation, checked against the spreads as they stood. ---- */
  function spreadReplayWhy(T, e) {
    var s = T.bySpread[e.spread];
    if (e.op === 'spread-add') return s ? 'it adds spread ' + e.spread + ' again' : T.spreads.length >= LIMITS.spreads ? 'it would add more than ' + LIMITS.spreads + ' spreads' : '';
    if (!s) return 'it changes spread ' + e.spread + ', which was never added';
    if (e.op === 'spread-stop') return s.state === 'stopped' ? 'spread ' + e.spread + ' is already stopped' : '';
    if (e.op === 'spread-include') return s.state === 'stopped' ? 'spread ' + e.spread + ' is stopped' : !hasPair(s.scope.cleared, e.item) ? 'it includes ' + e.item.uid + ', which wasn\'t cleared when the spread was added' : hasPair(s.included, e.item) ? e.item.uid + ' is already included' : '';
    return '';
  }
  function spreadReplay(T, e, appId, pid, p) {
    var s = T.bySpread[e.spread];
    if (e.op === 'spread-add') {
      s = { id: e.spread, text: e.text, loopStep: e.loopStep, child: e.child, scope: e.scope, owner: e.owner || '', reason: e.reason || '', state: 'active', stop: null, included: [], binds: Object.create(null), added: appId, request: pid, by: p.by, history: [] };
      T.bySpread[s.id] = s; T.spreads.push(s);
    } else if (e.op === 'spread-include') s.included.push({ uid: e.item.uid, attempt: e.item.attempt, application: appId });
    else if (e.op === 'spread-bind') s.binds[e.item.uid + '#' + e.item.attempt] = { run: e.dest.process + '/' + e.dest.id, application: appId };
    else { s.state = 'stopped'; s.stop = { reason: e.reason, owed: e.owed, cut: e.cut, application: appId }; }
    s.history.push({ op: e.op, application: appId, request: pid });
  }
  /* Bindings of one item's attempt settle causally, like every decision (PF.loop.settleIn): two made at once that disagree hold
     its coverage until one that saw them all, a page of LIMITS.seen at a time. */
  function bindSettle(c, T, q1, x) {
    var pk = x.item.uid + '#' + x.item.attempt, bk = x.spread + '\n' + pk, sl = T.bindSlots[bk] || (T.bindSlots[bk] = { spread: x.spread, pair: pk, reqs: [] });
    sl.reqs.push(x.id); q1.bindSlot = bk;
    PF.loop.settleIn(c, sl, 'bind', 'bindReview', x, { op: 'bind', dest: x.dest.process + '/' + x.dest.id }, function (a, b) { return a.dest === b.dest; },
      { both: function (a, b) { return 'Two bindings were made at once: ' + a.dest + ' and ' + b.dest + '.'; }, again: 'Bound again without seeing both earlier bindings.' });
  }
  /* Where a loop step is in a run's checklist, or why it can't take a spread. */
  function loopWhy(map, step) {
    var x = map && typeof step === 'string' ? PF.map.findStep(map, step) : null;
    if (!x) return 'step ' + step + ' isn\'t in this run\'s checklist';
    return x.step.type === 'for.each' ? '' : step + ' isn\'t a loop step';
  }
  /* A story's request names its spread on the parent run: an explicit, checked dependency. It holds while any of the parent's
     to-do records can't be read, when the spread isn't added there, or when it doesn't ask what the spread asks. */
  function fulfillsWhy(q, deps) {
    var f = q.fulfills, pr = f.run.process + '/' + f.run.id, mineRun = function (x) { return x && x.run && x.run.process === f.run.process && x.run.id === f.run.id; };
    if ((deps.unread || []).some(function (u) { return u && (!u.run || mineRun(u)); })) return 'It fulfils a spread on ' + pr + ', whose to-do records can\'t all be read here.';
    var e = null;
    (deps.records || []).forEach(function (x) {
      if (e || !mineRun(x)) return;
      var ef = x.kind === 'application' ? x.effect : x.kind === 'compound' && x.application ? x.application.effect : null;
      if (ef && ef.op === 'spread-add' && ef.spread === f.spread) e = ef;
    });
    if (!e) return 'It fulfils spread ' + f.spread + ' on ' + pr + ', which isn\'t added there.';
    if (e.text !== q.text || !q.placement || e.child.beforeGate !== q.placement.beforeGate) return 'It doesn\'t ask what spread ' + f.spread + ' on ' + pr + ' asks for.';
    return '';
  }
  /* A request's status, in this order: what landed first (an application the head reaches is Applied, whatever authority says
     now), then anything that holds it, then a dispute, a decline, authority (Queued), and otherwise Waiting. */
  function statusOf(T, q, o, map, heldIds) {
    var set = function (s, why) { q.status = s; q.why = why || ''; };
    /* Applied stays Applied whatever is decided after; decisions made two ways on it still hold the work until a person who
       may decide settles them, which records a decision and never applies it again. */
    if (q.landed) return set('applied', landedWhy(q));
    if (T.broken) return set('held', T.broken.why);
    if (heldIds[q.id]) return set('held', 'It refers to a record this computer can\'t read yet.');
    if (o.ended) return set('held', 'The run has ended; this is kept as a notice and changes nothing.');
    var x = q.todo ? T.byTodo[q.todo] : null;
    if (isSpreadOp(q.op)) {
      var sp = T.bySpread[q.spread];
      if (q.op === 'spread-add') {
        var lw = map ? loopWhy(map, q.loopStep) : 'its checklist can\'t be read';
        if (lw) return set('held', 'It needs placement: ' + lw + '.');
        if (T.spreads.length >= LIMITS.spreads) return set('held', 'This run has ' + LIMITS.spreads + ' spreads, the most it takes. Nothing was cut.');
      } else if (!sp) return set('held', 'It names spread ' + q.spread + ', which hasn\'t been added to this run' + (Object.keys(T.requests).some(function (id) { return T.requests[id].spread === q.spread && T.requests[id].op === 'spread-add'; }) ? ' yet' : '') + '.');
      else if (q.op === 'spread-stop' && sp.state === 'stopped') return set('held', 'It no longer fits: the spread is stopped already.');
      else if (q.op === 'spread-include') {
        if (sp.state === 'stopped') return set('held', 'It no longer fits: the spread is stopped.');
        if (!hasPair(sp.scope.cleared, q.item)) return set('held', 'It no longer fits: ' + q.item.uid + ' wasn\'t cleared when the spread was added, so it owes it already.');
        if (hasPair(sp.included, q.item)) return set('held', 'It no longer fits: ' + q.item.uid + ' is included already.');
      } else if (q.op === 'spread-bind') {
        var sl = T.bindSlots[q.bindSlot];
        if (sl && sl.reqs.some(function (id) { return id !== q.id && T.saw(id, q.id); })) return set('held', 'A later binding of this item replaced it.');
        if (sl && (sl.bindOut || []).indexOf(q.id) >= 0) return set('disputed', sp.binds[sl.pair] && sp.binds[sl.pair].why || 'Two bindings were made at once.');
      }
    } else if (q.op === 'add') {
      var pw = map ? placementWhy(map, q.target, q.placement) : 'its checklist can\'t be read';
      if (pw) return set('held', 'It needs placement: ' + pw + '.');
      if (q.fulfills) { var dw = o.depWhy ? o.depWhy(q) : 'It fulfils a spread this computer can\'t check here.'; if (dw) return set('held', dw); }
      if (T.added >= LIMITS.todos) return set('held', 'This run has had ' + LIMITS.todos + ' to-dos added, the most it takes. Nothing was cut.');
    } else if (!x) return set('held', 'It names ' + q.todo + ', which hasn\'t been added to this run' + (q.todo && Object.keys(T.requests).some(function (id) { return T.requests[id].todo === q.todo && T.requests[id].op === 'add'; }) ? ' yet' : '') + '.');
    else if (q.op === 'reopen' ? x.state === 'open' : x.state !== 'open') return set('held', 'It no longer fits: ' + x.id + ' is ' + STATE_WORDS[x.state].toLowerCase() + ' now.');
    /* A done on evidence holds until its evidence is current, fresh, complete where it must be, and shows the work done. */
    else if (q.support) { var fw = o.supportWhy ? o.supportWhy(q, x) : 'Its evidence can\'t be checked here.'; if (fw) return set('held', fw); }
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
  function landedWhy(q) {
    var n = (q.decOut || []).length;
    if (!n) return '';
    return (n > LIMITS.seen ? n + ' decisions on it were made at once, more than one record can settle (' + LIMITS.seen + ').' : q.decReview.length ? q.decReview[0].why : 'Decided two ways at once.') +
      ' It stays applied; a person who may decide settles this in Flightdeck, and it isn\'t applied again.';
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
  /* '' when a person is in people.json and active, else why not. */
  function activeWhy(person, people) {
    var list = PF.people.listOf(people), p = null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === person) { p = list[i]; break; }
    if (!p) return person + ' isn\'t in people.json';
    return p.inactive ? (p.name || person) + ' is marked inactive in people.json' : '';
  }
  function mayFor(r, people) {
    return function (rec) { var person = rec.kind === 'compound' ? rec.decision && rec.decision.by : rec.by && rec.by.person; return personWhy(r, person, people); };
  }
  /* What applying a request would do beyond its own work: the approvals it reopens (a passed or waived gate, an approved
     loop) and whether it releases work (Won't do, Moved). Its fingerprint is what a decision accepts; a different one later
     needs consent again. */
  function consequenceOf(r, map, q, T) {
    if (isSpreadOp(q.op)) {
      /* A spread's operations reopen the loop's approval and its phase's gate (adding, including or binding owes work there);
         stopping one releases work. The consent covers the whole request, its scope snapshot and child gate included. */
      var sp = T && T.bySpread ? T.bySpread[q.spread] : null, ls = q.op === 'spread-add' ? q.loopStep : sp ? sp.loopStep : '', st = ls ? { step: ls } : null, ro = [];
      if (q.op !== 'spread-stop' && st && map && !loopWhy(map, ls)) {
        var SP0 = placeOf(map, st), g0 = r.gates && own(r.gates, SP0.gate) ? r.gates[SP0.gate] : null, a0 = r.steps && own(r.steps, ls) ? r.steps[ls] : null;
        if (g0 && (g0.s === 'passed' || g0.s === 'waived')) ro.push('gate:' + SP0.gate);
        if (a0 && a0.s === 'done' && a0.loop) ro.push('loop:' + ls);
      }
      return { reopens: ro, releases: q.op === 'spread-stop', fingerprint: fp([q.op, q.spread || '', targetKey(st), ro, q.op === 'spread-stop', fp(effectOf(q))]) };
    }
    var x = q.todo && T ? T.byTodo[q.todo] : null, t = q.op === 'add' ? q.target : x ? x.target : null, reopens = [], releases = q.op === 'wont' || q.op === 'move';
    if ((q.op === 'add' || q.op === 'reopen') && t && map) {
      var P = placeOf(map, t);
      if (!P.why) {
        var g = r.gates && own(r.gates, P.gate) ? r.gates[P.gate] : null, a = P.loop && r.steps && own(r.steps, P.loop) ? r.steps[P.loop] : null;
        if (g && (g.s === 'passed' || g.s === 'waived')) reopens.push('gate:' + P.gate);
        if (a && a.s === 'done' && a.loop) reopens.push('loop:' + P.loop);
      }
    }
    /* The consent covers exactly what the request says (its operation's body: text, target, owner, reason, destination...) as
       well as what it would do, so a request replaced under the same id with other arguments needs approval again. */
    return { reopens: reopens, releases: releases, fingerprint: fp([q.op, q.todo || '', targetKey(t), reopens, releases, fp(effectOf(q))]) };
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
        T.chain.forEach(function (id) { var a = byId[id], ap = a && (a.kind === 'compound' ? a.application : a); if (ap && (ap.effect.op === 'add' || ap.effect.op === 'spread-add') && ap.authority && ap.authority.grant) use[ap.authority.grant] = (use[ap.authority.grant] || 0) + 1; });
      }
      var C = consequenceOf(r, map, q, T), human = C.releases || C.reopens.length > 0, d = q.dec;
      if (d && d.op === 'accept' && !d.contrary) {
        if (d.consequence === C.fingerprint) return { ok: true, via: q.kind === 'compound' && d.record === q.id ? { compound: q.id } : { decision: d.record }, why: '' };
        return { ok: false, why: 'What it would do changed after it was approved (' + (C.reopens.length ? 'it now reopens an approval' : 'its consequence is different') + '), so it needs approval again.' };
      }
      var wordsWhy = C.releases ? 'It releases work, so a person approves it.' : C.reopens.length ? 'It reopens an approval, so a person approves it.' : 'It waits for a person\'s approval or a delegation that covers it.';
      if (human) return { ok: false, why: wordsWhy };
      /* A delegation to add on a loop step covers asking for, including and binding a spread there (never stopping one). */
      var x = q.todo ? T.byTodo[q.todo] : null, sp = isSpreadOp(q.op) ? T.bySpread[q.spread] : null, gop = isSpreadOp(q.op) ? 'add' : q.op, adds = q.op === 'add' || q.op === 'spread-add';
      var tk = isSpreadOp(q.op) ? targetKey({ step: q.op === 'spread-add' ? q.loopStep : sp ? sp.loopStep : '' }) : targetKey(q.op === 'add' ? q.target : x ? x.target : null), sub = q.by || {};
      /* A delegate who is a person must be in people.json and active now for a delegation to cover what they ask. */
      var gone = sub.person ? activeWhy(sub.person, people) : '';
      if (gone) return { ok: false, why: gone + ', so no delegation covers what they ask; it waits for a person\'s approval.' };
      var gs = Object.keys(T.grants).map(function (id) { return T.grants[id]; }).filter(function (g) {
        return (g.subject.tool ? g.subject.tool === sub.tool : g.subject.person === sub.person) && g.ops.indexOf(gop) >= 0 && g.targets.some(function (t) { return targetKey(t) === tk; });
      });
      var live = gs.filter(function (g) { return g.active && T.saw(q.id, g.id); });
      for (var i = 0; i < live.length; i++) {
        var g = live[i];
        if (adds) { var n = use[g.id] || 0; if (n >= g.limits.adds) continue; use[g.id] = n + 1; }
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
    /* deps: every to-do record and unread file read, for what a story's request depends on (its spread, on the parent run). */
    var deps = o.deps || { records: o.records || [], unread: o.unread || [] };
    /* What evidence is checked against (facts): every record read, and, when the caller read them, the runs and how each read
       (o.runs, o.loops.unreadRun: PF.spreads.inputs), so the run a fact is on is expected, present and checked. */
    var ev = { records: deps.records || [], unread: deps.unread || [], runs: Array.isArray(o.runs) ? o.runs : null, unreadRun: o.loops && o.loops.unreadRun || null };
    var T = reduce(o.records || [], r, { all: deps.records || o.records || [], map: map, ended: !!r.ended, may: mayFor(r, o.people), authority: authorityFor(r, map, o.people), depWhy: function (q) { return fulfillsWhy(q, deps); },
      /* o.now: the time evidence is judged by (facts); without one, a done on evidence holds. */
      supportWhy: function (q, x) { return PF.facts.supportWhy(r, q, x, ev, o.now); } });
    T.map = map;
    /* The expected-dependency manifest's evidence rows (4.0 slice 4): what a done on evidence not yet applied or declined rests
       on and isn't present and checked (its fact, a fact that fact saw, the run the facts are on), named by missingOf. */
    T.evidenceMissing = [];
    Object.keys(T.requests).forEach(function (id) { var q = T.requests[id]; if (!q.support || q.status === 'applied' || q.status === 'declined') return; PF.facts.expected(r, q, T.byTodo[q.todo], ev).forEach(function (m) { T.evidenceMissing.push(m); }); });
    (o.unread || []).forEach(function (u) { if (!u.run || (u.run.process === r.process && u.run.id === r.id)) T.unread.push(u); });
    return T;
  }
  /* What holds approval, read-only on every read (never saved): r._todos { all, phases, loops, stale: { gate, loop },
     scope: { gate, loop } }. all holds every gate (a chain that can't be trusted, a record that can't be read); an open or
     disputed to-do holds its phase's gate, or its loop's approval for an item's work. stale: an approval made before work
     in its scope was added or reopened, or before a dispute on it, by identity (the records its snapshot didn't include). */
  var WORDS_OP = { 'spread-add': 'add', 'spread-include': 'include', 'spread-bind': 'binding', 'spread-stop': 'stop' };
  function holds(T, r, cov) {
    var H = { all: [], phases: Object.create(null), loops: Object.create(null), stale: { gate: Object.create(null), loop: Object.create(null) }, scope: { gate: Object.create(null), loop: Object.create(null) }, open: 0 };
    var map = T.map, push = function (o, k, why) { (o[k] = o[k] || []).push(why); };
    H.missing = missingOf(T, cov);
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
    /* An item's records count in both approvals that govern it: its loop's and its phase gate's. */
    var addScope = function (t, id) {
      var P = placeOf(map, t); if (P.why) return;
      var put = function (o, k) { if (k) (o[k] = o[k] || []).indexOf(id) < 0 && o[k].push(id); };
      if (t.item) put(H.scope.loop, P.loop);
      put(H.scope.gate, P.gate);
    };
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
    /* Spreads (4.0 slice 3): every unresolved obligation holds its loop's approval (and so its phase's gate); coverage that
       can't be worked out here holds too. Their records, and the stories' to-do records coverage counted, are in the scope an
       approval must have counted, so an approval made before them stays in review. */
    var putLoop = function (step, id) {
      if (loopWhy(map, step)) return;
      var P = placeOf(map, { step: step }), put = function (o, k) { (o[k] = o[k] || []).indexOf(id) < 0 && o[k].push(id); };
      put(H.scope.loop, step); put(H.scope.gate, P.gate);
    };
    if (T.spreads.length) {
      var covOf = Object.create(null); ((cov && cov.spreads) || []).forEach(function (C) { covOf[C.id] = C; });
      T.spreads.forEach(function (sp) {
        var lw = loopWhy(map, sp.loopStep), C = covOf[sp.id], whys = C ? C.unresolved : ['Spread "' + sp.text + '": its coverage can\'t be checked here, so approval waits.'];
        whys.forEach(function (why) { if (lw) H.all.push(why + ' (' + lw + ')'); else push(H.loops, sp.loopStep, why); });
        /* A stop releases work, so its application never sends an approval back; a stop decided or applied two ways still
           does, through its dispute's participants (below). */
        sp.history.forEach(function (h) { if (h.op !== 'spread-stop') putLoop(sp.loopStep, h.application); });
        (C && C.scope || []).forEach(function (id) { putLoop(sp.loopStep, id); });
      });
      /* Bindings of one item made at once, and the one that settled them, stay in what an approval counts: settling them never
         restores an approval made before them. */
      Object.keys(T.bindSlots).forEach(function (bk) {
        var sl = T.bindSlots[bk], sp = T.bySpread[sl.spread];
        if (sp && sl.reqs.length > 1) sl.reqs.forEach(function (id) { putLoop(sp.loopStep, id); });
      });
    }
    /* A spread's requests, whether or not any spread has landed: decided (or applied) two ways is held like any to-do's work,
       queued, landed or settling, until a record that saw them all; every participant of such a dispute stays in what the
       loop's and the gate's approvals count, so settling it never restores an approval made before it. */
    requestsOf(T).forEach(function (q) {
      var sp = isSpreadOp(q.op) && (T.bySpread[q.spread] || (q.op === 'spread-add' ? { loopStep: q.loopStep, text: q.text } : null));
      if (!sp) return;
      (q.disputedIds || []).forEach(function (pid) { putLoop(sp.loopStep, pid); });
      if (q.status === 'disputed' || (q.decOut || []).length || (q.appOut || []).length) {
        var why = 'Spread "' + (sp.text || q.spread) + '": its ' + (WORDS_OP[q.op] || q.op) + ' request ' + ((q.decOut || []).length || q.decReview.length ? 'was decided two ways at once; a person who may decide settles it.' : 'was applied two ways at once; the recorder settles it.'), lw = loopWhy(map, sp.loopStep);
        if (lw) H.all.push(why + ' (' + lw + ')'); else push(H.loops, sp.loopStep, why);
      }
    });
    /* Sticky from the start: an approval made before the run's first application counted nothing (it has no cut), so any
       record in its scope, a dispute's participants included, sends it to review; approving again records its cut. */
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
  /* Every record a run's to-dos and spreads expect and that isn't in the folder, by its path ({ path, kind: 'nofile', why }):
     an application or request the chain names, a record another one saw, and what a spread's coverage expects (cov). The
     readers name each one as a problem, whatever else they read. */
  function missingOf(T, cov) {
    var out = [], had = Object.create(null);
    var put = function (x) { if (x && x.path && !had[x.path]) { had[x.path] = true; out.push(x); } };
    var rec = function (id, why) { put({ path: 'proposals/' + id + '.json', kind: 'nofile', why: why }); };
    if (T && T.broken && T.broken.missing) rec(T.broken.missing, 'The run\'s applied work names this record (from ' + T.broken.record + '), and it isn\'t in the folder.');
    ((T && T.held) || []).forEach(function (h) { (h.missing || []).forEach(function (id) { rec(id, 'The record ' + h.record + ' saw this one, and it isn\'t in the folder.'); }); });
    ((cov && cov.spreads) || []).forEach(function (C) { (C.missing || []).forEach(put); });
    ((T && T.evidenceMissing) || []).forEach(put);
    return out;
  }
  /* Every run's holds, read-only, on every read (like PF.loop.markStale). A run with no to-do records and no living marker
     is left exactly as it was. o: { records, unread, people }. */
  /* o.also: runs read only for a spread's coverage (its items' runs), not marked themselves. */
  function markHolds(runs, o) {
    o = o || {};
    var seen = (runs || []).concat(o.also || []);
    (runs || []).forEach(function (r) {
      if (!r || !r.steps || r._unrunnable) return;
      var mine = recordsFor(o.records, r).filter(notFact), un = (o.unread || []).filter(function (u) { return u.run ? u.run.process === r.process && u.run.id === r.id : !!r.living; });
      if (!mine.length && !r.living && !un.length) { delete r._todos; return; }
      var T = view(r, { records: mine, unread: un, people: o.people, now: o.now, deps: { records: o.records || [], unread: o.unread || [] }, runs: o.runs, loops: o.loops });
      var cov = T.spreads.length ? PF.spreads.coverage(r, T, { runs: seen, records: o.records || [], unread: o.unread || [], people: o.people, loops: o.loops, now: o.now }) : null;
      r._todos = holds(T, r, cov);
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
  /* head '' is a living run with nothing landed yet: an approval made before its first application recorded a cut. */
  function cleanLiving(v) { return isMap(v) && Object.keys(v).length === 1 && typeof v.head === 'string' && (v.head === '' || HEAD.test(v.head)) ? { head: v.head } : null; }

  /* ---- Application (slice 1, commit 3). The recorder's window carries out a queued request in two writes: the application
     record first (in proposals/, guarded), then the run, whose living.head moves to it. Recovery reads what is there before
     writing anything: a request the head already reaches is done (whatever authority says now); an application already
     written for the head as it stands, with the same effect and authority, is landed as it is; otherwise a new one is
     prepared. A request that isn't queued now (authority lost, held, disputed) is left alone. ---- */
  /* A stop keeps exactly what its spread is owed on when it lands (docs/design.md 45.1). Asked, decided and applied only while
     that can be read in full, and only while it is still exactly the list the stop names: one asked before an item joined (or
     left) is refused, and a fresh stop is asked. Returns null, or { why, stale } (stale: it can't land as it is; else it waits). */
  function stopCheck(r, T, q, o) {
    var name = (T.bySpread[q.spread] || {}).text || q.spread;
    if (!o || !o.loops) return { why: 'What spread "' + name + '" is owed on can\'t be checked here (its loop and its items\' runs aren\'t read), so a stop waits.' };
    var cov = null; try { cov = PF.spreads.coverage(r, T, { runs: o.runs || [r], records: o.records || T.records, unread: o.unread || [], people: o.people, loops: o.loops }); } catch (e) { cov = null; }
    var C = cov ? cov.spreads.filter(function (c) { return c.id === q.spread; })[0] : null;
    if (!C || !C.complete) return { why: 'What spread "' + name + '" is owed on can\'t all be read yet, so a stop waits until it can.' };
    var key = function (p) { return p.uid + '#' + p.attempt; }, now = C.items.filter(function (i) { return i.owed; }).map(key).sort(), was = (q.owed || []).map(key).sort();
    if (now.join('\n') !== was.join('\n')) return { stale: true, why: 'What spread "' + name + '" is owed on changed since this stop was asked (' + now.length + ' now; it keeps ' + was.length + '). Ask for the stop again, so every obligation is kept.' };
    return null;
  }
  function sameVia(a, b) { return !!a && !!b && JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }
  function applyPlan(r, T, q, o) {
    if (!q) return { skip: 'There is no such request.' };
    var unsettled = (q.appOut || []).length > 0;
    if (q.landed && !unsettled) return { landed: q.landed };
    /* Nothing is prepared or landed while any of the run's records can't be read or read in order: what it says isn't known. */
    if (T.broken) return { skip: T.broken.why };
    if (T.unread.length) return { skip: 'A to-do record (' + String(T.unread[0].file || '').slice(0, 120) + ') can\'t be read yet, so nothing is applied until it is.' };
    if (T.held.length) return { skip: 'A to-do record (' + T.held[0].record + ') can\'t be read in order yet, so nothing is applied until it is.' };
    /* Landed, with other applications of it prepared at once still outstanding: a record that saw them settles them. It is an
       application like the landed one (the same head before it, effect and authority) that is never landed itself: the
       landed effect is never replayed. */
    if (q.landed) {
      var la = null; T.records.forEach(function (y) { if (y.id === q.landed) la = y; });
      var lap = la && (la.kind === 'compound' ? la.application : la), lpr = null; T.records.forEach(function (y) { if (y.id === q.id) lpr = y; });
      if (!lap || !lpr) return { skip: 'Its landed application can\'t be read.' };
      return { settle: { kind: 'application', proposal: q.id, run: { process: T.run.process, id: T.run.id }, seen: seenFor(T, [q.id, q.landed], [q.id], ['app']).seen, authority: la.kind === 'compound' ? { compound: la.id } : la.authority, previous: lap.previous || '', effect: effectOf(lpr) } };
    }
    /* Two applications prepared at once (two windows, neither landed) block nothing: a new one that saw both settles them. */
    var appOnly = q.status === 'disputed' && q.appOnly && q.via;
    if (q.status !== 'queued' && !appOnly) return { skip: q.why || 'It is ' + q.status + '.' };
    if (q.op === 'spread-stop') { var sc = stopCheck(r, T, q, o); if (sc) return { skip: sc.why, stale: !!sc.stale }; }
    var head = r.living && typeof r.living.head === 'string' ? r.living.head : '', byId = Object.create(null);
    T.records.forEach(function (y) { byId[y.id] = y; });
    var p = byId[q.id];
    if (!p) return { skip: 'Its request can\'t be read in order yet.' };
    var eff = effectOf(p), f = fp(eff);
    /* A compound lands as it is only as a separate application would: no other application of it outstanding (that is settled
       first, a page at a time, like any other), and none settling it that isn't the compound itself. */
    if (p.kind === 'compound' && !appOnly && (!q.app || q.app.record === p.id) && q.via && q.via.compound === p.id && (p.application.previous || '') === head && p.application.fingerprint === f) return { adopt: p };
    /* The candidate that settled them, when there is one, else the first by id: the same one in every window. Only one replay
       would read in order: it saw its request and the head it was prepared on; any other is seen by a fresh one. */
    var fit = q.candidates.map(function (id) { return byId[id]; }).filter(function (a) { return a && (a.previous || '') === head && a.fingerprint === f && sameVia(a.authority, q.via) && T.saw(a.id, q.id) && (!head || T.saw(a.id, head)); }).sort(function (a, b) { return cmpStr(a.id, b.id); });
    var c = fit.filter(function (a) { return q.app && a.id === q.app.record; })[0] || fit[0];
    if (c && !appOnly) return { adopt: c };
    var must = [q.id]; if (head) must.push(head); if (q.via && q.via.decision) must.push(q.via.decision); if (q.via && q.via.grant) must.push(q.via.grant);
    return { write: { kind: 'application', proposal: q.id, run: { process: T.run.process, id: T.run.id }, seen: seenFor(T, must, [q.id], ['app']).seen, authority: q.via, previous: head, effect: eff } };
  }
  /* Keeping a conflict copy (4.0): which head to keep. cur is this run, copy the copy, o: { records, unread, people }. The
     copy's head is kept only as far as each application on its chain past this run's head would be landed now (applyPlan on
     this run as it stood before it: authority, revokes, unread and held records asked again); the first that wouldn't is
     dropped with everything after it, and is prepared again. A copy whose chain doesn't pass through this run's head keeps
     this run's. Returns { head, dropped }. */
  function keepHead(cur, copy, o) {
    o = o || {};
    var mine = cur.living && typeof cur.living.head === 'string' ? cur.living.head : '', theirs = copy.living && typeof copy.living.head === 'string' ? copy.living.head : '';
    if (!theirs || theirs === mine) return { head: mine || theirs, dropped: '' };
    var byId = Object.create(null); (o.records || []).forEach(function (y) { byId[y.id] = y; });
    var extra = [], at = theirs, seen = Object.create(null);
    while (at && at !== mine) {
      if (seen[at] || !byId[at]) return { head: mine, dropped: theirs };
      seen[at] = true; extra.unshift(byId[at]);
      var ap = byId[at].kind === 'compound' ? byId[at].application : byId[at];
      if (!ap || ap.previous == null) return { head: mine, dropped: theirs };
      at = ap.previous;
    }
    if (at !== mine) return { head: mine, dropped: theirs };
    var good = mine;
    for (var i = 0; i < extra.length; i++) {
      var a = extra[i], t = JSON.parse(JSON.stringify(cur, function (k, v) { return this === cur && k.charAt(0) === '_' ? undefined : v; }));
      if (good) t.living = { head: good }; else delete t.living;
      var V = view(t, { records: o.records, unread: o.unread, people: o.people, now: o.now, runs: o.runs, loops: o.loops }), q = V.requests[a.kind === 'compound' ? a.id : a.proposal], plan = q ? applyPlan(t, V, q, o) : null;
      if (!(plan && plan.adopt && plan.adopt.id === a.id)) return { head: good, dropped: a.id };
      good = a.id;
    }
    return { head: good, dropped: '' };
  }
  /* ---- Asking (4.0 slice 2): the one rule the run screen and `flightdeck todo` share for making a request, and its preview.
     o: { body: { op, text?, target?, todo?, reason?, to?, owner? }, by: { person } | { tool, version, key }, key (a person's
     request: its own retry key), records, unread, people, at, app }. A person who may decide (PF.todos.personWhy) asks in one
     gesture (a compound: the request, their decision on exactly its consequence, and an application prepared on the head);
     anyone else makes a request that waits for authority. Returns { why } when nothing can be asked, else { id, name, file,
     kind, record, preview: { op, todo, placement, gate, consequence: { reopens, releases }, status, why, recorder, words } }.
     Nothing is written here. */
  /* The gate's own title, as the run screen and flightdeck run name it (an implicit gate is "Confirm <phase>"). */
  function gateTitle(map, id) { var t = ''; (map && map.phases || []).forEach(function (p) { if (p.gate && p.gate.id === id) t = p.gate.title; }); return t || id; }
  function prepare(r, o) {
    o = o || {};
    var map = null; try { map = PF.run.mapOf(r); } catch (e) { map = null; }
    if (!map) return { why: 'This run\'s checklist can\'t be read, so nothing can be asked.' };
    if (r.ended) return { why: 'The run has ended, so it takes no new work.' };
    if (r._unrunnable) return { why: 'This run can only be read here.' };
    /* Any authority input that couldn't be read vouches for no one: while people.json is unread, nobody asks as a decider. */
    var people = peopleOf(o);
    var b = o.body || {}, by = o.by || {}, T = view(r, { records: o.records, unread: o.unread, people: people, deps: depsOf(o), now: o.now, runs: o.runs, loops: o.loops });
    if (ALL_OPS.indexOf(b.op) < 0) return { why: 'Say what to do: add, done, wont, move or reopen (or, for a spread, spread-add, spread-include, spread-bind or spread-stop).' };
    var body = { op: b.op }, x = null, ful = null, slotFront = [], sug = null;
    if (isSpreadOp(b.op)) {
      var sp = prepSpread(r, map, T, b, o);
      if (sp.why) return sp;
      body = sp.body; slotFront = sp.front || [];
    } else if (b.op === 'add') {
      if (typeof b.text !== 'string' || !b.text.trim()) return { why: 'Say what needs doing.' };
      if (b.text.trim().length > LIMITS.text) return { why: 'A to-do is at most ' + LIMITS.text + ' characters (this is ' + b.text.trim().length + ').' };
      var tgt = b.target || null, P = tgt ? placeOf(map, tgt) : { why: 'Say where it goes: a phase, a step or a loop item.' };
      if (P.why) return { why: 'It can\'t be placed: ' + P.why + '.' };
      body.text = b.text.trim(); body.target = tgt; body.placement = placementFor(map, tgt);
      if (b.owner) body.owner = b.owner;
      if (b.reason) body.reason = String(b.reason).trim();
      if (T.todos.length >= LIMITS.todos) return { why: 'This run already has ' + LIMITS.todos + ' to-dos, the most a run takes.' };
      /* A story's request for a spread on its parent: named by its obligation and this run, whoever files it. */
      if (b.fulfills != null) {
        var fe = []; ful = cleanFulfills(b.fulfills, fe);
        if (!ful) return { why: 'What it fulfils is {"run", "spread", "uid", "attempt"}: ' + fe[0] };
        if (ful.run.process === r.process && ful.run.id === r.id) return { why: 'A spread is on the parent run, never on this one.' };
        if (!r.parent || !r.parent.item || r.parent.process !== ful.run.process || r.parent.id !== ful.run.id || r.parent.item.uid !== ful.uid || (+r.parent.item.attempt || 1) !== ful.attempt) return { why: 'This run isn\'t ' + ful.uid + '\'s attempt ' + ful.attempt + ' in ' + ful.run.process + '/' + ful.run.id + '.' };
        body.fulfills = ful;
      }
    } else {
      x = typeof b.todo === 'string' ? T.byTodo[b.todo] : null;
      if (!x) return { why: 'That to-do isn\'t in this run' + (T.broken || T.unread.length || T.held.length ? ' as this computer can read it now' : '') + '.' };
      body.todo = x.id;
      if (b.op === 'reopen' ? x.state === 'open' : x.state !== 'open') return { why: b.op === 'reopen' ? 'It is already open.' : 'It is already ' + STATE_WORDS[x.state].toLowerCase() + '.' };
      if (b.op === 'wont' && !(typeof b.reason === 'string' && b.reason.trim())) return { why: 'Say why it won\'t be done.' };
      if (b.op === 'move') {
        var to = toOf(b.to);
        if (!to) return { why: 'Say where it moved: a ticket key like ABC-123, an https link, or another run as <process>/<run id>.' };
        if (to.run && to.run.toLowerCase() === (r.process + '/' + r.id).toLowerCase()) return { why: 'That is this run; moved work goes to another run, a ticket or a link.' };
        body.to = to;
      }
      if (b.reason != null && String(b.reason).trim()) body.reason = String(b.reason).trim();
      /* A resolve suggestion (4.0 slice 4): a done carrying the evidence it rests on, as PF.facts.supportFor gave it. Its name
         comes from that evidence, so the same suggestion from any tool, at any time, is one request. */
      if (b.support != null) {
        if (b.op !== 'done') return { why: 'Only a done request carries evidence.' };
        var se = [], sup = PF.facts.cleanSupport(b.support, se);
        if (!sup) return { why: 'Its evidence isn\'t in its format: ' + se[0] };
        if (!by.tool) return { why: 'A suggestion on evidence is a tool\'s; a person checks the to-do off.' };
        body.support = sup; sug = sup;
      }
    }
    var tool = by.tool ? { name: by.tool, version: by.version || '0' } : null, person = by.person || '';
    if (!tool && !person) return { why: 'Say who asks: a person in people.json, or a tool.' };
    /* A tool may name the person it asks for (--as). It is who asked, never their approval: the request still waits for a
       decision, or for a delegation that covers it. */
    if (b.requester != null) {
      if (!tool) return { why: 'A person asks as themselves; only a tool names who it asks for.' };
      if (typeof b.requester !== 'string' || !PERSON.test(b.requester)) return { why: 'Who it asks for is the ID from people.json of that person.' };
      if (!people) return { why: 'people.json can\'t be read, so who it asks for can\'t be checked.' };
      var aw = activeWhy(b.requester, people);
      if (aw) return { why: aw + '.' };
      body.requester = b.requester;
    }
    if (!ful && !sug && tool && !KEY.test(String(by.key || ''))) return { why: 'A tool\'s request needs its retry key (--key): letters, digits, . _ : -, at most 120.' };
    if (!ful && !tool && !KEY.test(String(o.key || ''))) return { why: 'A request needs its retry key.' };
    var id = ful ? PF.spreads.childRequestId(ful.spread, ful.uid, ful.attempt, { process: r.process, id: r.id }) : sug ? PF.facts.suggestionId(x.id, sug.incarnation, sug.source, sug.domain, sug.content) : tool ? idFor(tool.name, by.key) : idFor('flightdeck', o.key), head = r.living && typeof r.living.head === 'string' ? r.living.head : '';
    var tkey = ful ? PF.spreads.obligationId(ful.spread, ful.uid, ful.attempt) : sug ? PF.facts.suggestionKey(x.id, sug.incarnation, sug.source, sug.domain, sug.content) : by.key;
    var must = []; if (head) must.push(head);
    Object.keys(T.grants).forEach(function (g) { if (T.grants[g].active) must.push(g); });
    /* A binding first names every outstanding binding of the same item it settles (a page of LIMITS.seen at a time). */
    var seen = seenFor(T, slotFront.length ? slotFront.concat(must) : must, [], []).seen, decider = !tool && !personWhy(r, person, people);
    var full = isSpreadOp(b.op) ? Object.assign(b.op === 'spread-add' ? { spread: PF.spreads.idFor(id) } : {}, body) : Object.assign({ todo: b.op === 'add' ? todoIdFor(id) : x.id }, body);
    var C = consequenceOf(r, map, full, T), f;
    if (decider) {
      var eff = effectOf(full);
      f = buildProposal({ kind: 'compound', run: { process: r.process, id: r.id }, id: id, by: person, seen: seen, at: o.at, app: o.app, body: body, decision: { by: person, consequence: C.fingerprint }, application: { previous: head, effect: eff, fingerprint: fp(eff) } });
    } else f = buildProposal(tool ? { run: { process: r.process, id: r.id }, producer: tool, key: tkey, seen: seen, at: o.at, app: o.app, body: body } : { run: { process: r.process, id: r.id }, id: id, by: person, seen: seen, at: o.at, app: o.app, body: body });
    var name = f.id + '.json', fd = filed(name, f);
    if (fd.why) return { why: fd.why };
    /* The request as every window would read it next, with this one in the folder: its status is the preview's. */
    var dp = depsOf(o), V2 = view(r, { records: (o.records || []).concat([fd.record]), unread: o.unread, people: people, now: o.now, runs: o.runs, loops: o.loops, deps: { records: (dp.records || []).concat([fd.record]), unread: dp.unread } }), q = V2.requests[f.id] || { status: 'held', why: 'It can\'t be read in order.' };
    var placement = b.op === 'add' ? body.placement : x ? x.placement : null, gate = placement ? gateTitle(map, placement.beforeGate) : '', rec = r.recorder && r.recorder.person || '';
    return { id: f.id, name: name, file: f, kind: f.kind, record: fd.record,
      preview: { op: b.op, todo: full.todo || null, spread: full.spread || null, placement: placement || null, gate: gate, consequence: { reopens: C.reopens.slice(), releases: C.releases }, status: q.status, why: q.why || '', recorder: rec, words: whatWords(map, full, x, C, T) + ' ' + thenWords(r, q) } };
  }
  /* A spread operation as asked (prepare): the body it files, or why it can't be asked. o.childMap: the checklist the loop's
     items run (spread-add checks its gate there); a stop names the obligations it keeps (o.body.owed, from coverage). */
  function prepSpread(r, map, T, b, o) {
    var body = { op: b.op }, sp = null;
    if (b.op === 'spread-add') {
      var lw = loopWhy(map, b.loopStep);
      if (lw) return { why: 'It can\'t be placed: ' + lw + '.' };
      if (typeof b.text !== 'string' || !b.text.trim()) return { why: 'Say what every item needs.' };
      if (b.text.trim().length > LIMITS.text) return { why: 'A requirement is at most ' + LIMITS.text + ' characters (this is ' + b.text.trim().length + ').' };
      if (T.spreads.length >= LIMITS.spreads) return { why: 'This run already has ' + LIMITS.spreads + ' spreads, the most a run takes. Nothing was cut.' };
      var gate = b.child && typeof b.child.beforeGate === 'string' ? b.child.beforeGate : '';
      if (!gate) return { why: 'Say which gate of the items\' checklist it comes before.' };
      if (!o.childMap) return { why: 'The checklist the loop\'s items run can\'t be read here, so where the requirement goes can\'t be checked.' };
      if (!PF.spreads.phaseOfGate(o.childMap, gate)) return { why: 'The items\' checklist has no gate ' + gate + '.' };
      var se = [], sc = cleanScope(b.scope, se);
      if (!sc) return { why: /most/.test(se[0] || '') ? se[0] + ' Nothing was cut.' : 'The scope it covers can\'t be read: ' + (se[0] || 'none given') };
      body.loopStep = b.loopStep; body.text = b.text.trim(); body.child = { beforeGate: gate }; body.scope = sc;
      if (b.owner) body.owner = b.owner;
      if (b.reason) body.reason = String(b.reason).trim();
      return { body: body };
    }
    sp = typeof b.spread === 'string' ? T.bySpread[b.spread] : null;
    if (!sp) return { why: 'That spread isn\'t on this run' + (T.broken || T.unread.length || T.held.length ? ' as this computer can read it now' : '') + '.' };
    body.spread = sp.id;
    var ie = [], it = b.op === 'spread-stop' ? null : cleanPair(b.item, ie, 'The item');
    if (b.op !== 'spread-stop' && !it) return { why: 'Say which item and attempt.' };
    if (b.op === 'spread-include') {
      if (sp.state === 'stopped') return { why: 'The spread is stopped, so it takes no more items.' };
      if (!hasPair(sp.scope.cleared, it)) return { why: it.uid + ' (attempt ' + it.attempt + ') wasn\'t cleared when the spread was added, so it owes it already.' };
      if (hasPair(sp.included, it)) return { why: it.uid + ' is included already.' };
      body.item = it;
    } else if (b.op === 'spread-bind') {
      var de = [], dest = cleanDest(b.dest, de);
      if (!dest) return { why: 'Say which run covers it, as <process>/<run id>.' };
      body.item = it; body.dest = dest;
      var sl = T.bindSlots[sp.id + '\n' + it.uid + '#' + it.attempt];
      if (b.reason) body.reason = String(b.reason).trim();
      return { body: body, front: sl ? (sl.bindFront || []).slice().sort(cmpStr) : [] };
    } else {
      if (sp.state === 'stopped') return { why: 'The spread is stopped already.' };
      if (!(typeof b.reason === 'string' && b.reason.trim())) return { why: 'Say why it stops.' };
      var oe = [], owed = cleanPairs(b.owed || [], LIMITS.items, oe, 'What it is owed on');
      if (!owed) return { why: oe[0] + ' Nothing was cut.' };
      var sc = stopCheck(r, T, { spread: sp.id, owed: owed }, o);
      if (sc) return { why: sc.why + ' Nothing was asked.' };
      body.owed = owed;
      /* The scope cut it saw: the loop's scope heads now (read whole, since stopCheck found its coverage complete). */
      var LV = null; try { LV = PF.loop.view(r, sp.loopStep, { records: o.loops.records, unread: o.loops.unread, runs: o.runs || [r], procOf: o.loops.procOf }); } catch (e) { LV = null; }
      if (!LV) return { why: 'The loop of spread "' + sp.text + '" can\'t be read here, so a stop waits. Nothing was asked.' };
      if (LV.ledger.heads.length > LIMITS.items) return { why: 'The loop of spread "' + sp.text + '" has ' + LV.ledger.heads.length + ' open scope records; a stop names at most ' + LIMITS.items + '. Resolve some first. Nothing was asked.' };
      body.cut = LV.ledger.heads.slice().sort(cmpStr);
    }
    if (b.reason != null && String(b.reason).trim()) body.reason = String(b.reason).trim();
    return { body: body };
  }
  /* A retry under the same key (4.0, flightdeck todo): which of what was asked differs from the request already filed under it,
     judged on the ask itself (never on the run's state now), so the same ask says already, even once it has been applied. */
  function askDiffers(rec, r, b) {
    var d = [], str = function (v) { return v == null ? '' : String(v).trim(); }, js = function (v) { return JSON.stringify(v == null ? null : v); };
    if (!rec || ['proposal', 'compound'].indexOf(rec.kind) < 0) return ['kind'];
    if (!rec.run || rec.run.process !== r.process || rec.run.id !== r.id) d.push('run');
    if (rec.op !== b.op) d.push('op');
    if (isSpreadOp(b.op)) {
      ['spread', 'loopStep', 'text', 'owner'].forEach(function (k) { if (str(rec[k]) !== str(b[k])) d.push(k); });
      ['child', 'scope', 'item', 'dest', 'owed'].forEach(function (k) { if (js(canon(rec[k])) !== js(canon(b[k]))) d.push(k); });
    } else if (b.op === 'add') {
      if (js(canon(rec.fulfills)) !== js(canon(b.fulfills))) d.push('fulfills');
      if (str(rec.text) !== str(b.text)) d.push('text');
      if (js(rec.target) !== js(b.target)) d.push('target');
      if (str(rec.owner) !== str(b.owner)) d.push('owner');
    } else {
      if (rec.todo !== b.todo) d.push('todo');
      if (js(canon(rec.support)) !== js(canon(b.support))) d.push('support');
      if (b.op === 'move' && js(rec.to) !== js(toOf(b.to))) d.push('to');
    }
    if (str(rec.reason) !== str(b.reason)) d.push('reason');
    if (str(rec.requester) !== str(b.requester)) d.push('as');
    return d;
  }
  /* What a request would do, in words: the operation, the gate it comes before, and what it releases or sends back for review. */
  function whatWords(map, q, x, C, T) {
    if (isSpreadOp(q.op)) return spreadWords(map, q, C, T) + (C.releases ? ' This releases work.' : '') + (C.reopens.length ? ' This sends ' + C.reopens.length + ' approval' + (C.reopens.length === 1 ? '' : 's') + ' back for review.' : '');
    var pl = q.op === 'add' ? q.placement : x && x.placement, gate = pl ? gateTitle(map, pl.beforeGate) : '';
    var what = q.op === 'add' ? 'Add "' + q.text + '"' + (gate ? ' before ' + gate : '') : (q.op === 'done' ? 'Check off' : q.op === 'wont' ? 'Mark won\'t do' : q.op === 'move' ? 'Move' : 'Reopen') + ' "' + (x ? x.text : q.todo) + '"' + (q.op === 'move' && q.to ? ' to ' + (q.to.ticket || q.to.run || q.to.link) : '') + (q.op === 'done' && q.support ? ', on evidence: ' + PF.facts.TITLE[q.support.domain] + ' from ' + q.support.source.feed : '');
    return what + '.' + (C.releases ? ' This releases work.' : '') + (C.reopens.length ? ' This sends ' + C.reopens.length + ' approval' + (C.reopens.length === 1 ? '' : 's') + ' back for review.' : '');
  }
  /* A spread's operation in plain words, as the assistant says it to the person: what it asks of whom, later additions included,
     and what stays unchanged (docs/design.md 45.1). */
  function spreadWords(map, q, C, T) {
    var sp = T && T.bySpread ? T.bySpread[q.spread] : null, ls = q.op === 'spread-add' ? q.loopStep : sp ? sp.loopStep : '', st = ls && map ? PF.map.findStep(map, ls) : null;
    var N = st ? PF.loop.nounOf(st.step.fields || {}) || PF.loop.nounOf({ items: (st.step.fields || {}).items }) : { one: 'item', many: 'items' }, n = function (k) { return PF.loop.count(k, N); };
    var text = q.op === 'spread-add' ? q.text : sp ? sp.text : q.spread;
    if (q.op === 'spread-add') return 'Require "' + text + '" on ' + q.scope.open.length + ' open ' + (q.scope.open.length === 1 ? N.one : N.many) + ', and on every ' + N.one + ' that joins later' + (q.scope.cleared.length ? '; ' + q.scope.cleared.length + ' cleared ' + (q.scope.cleared.length === 1 ? N.one + ' stays' : N.many + ' stay') + ' unchanged' : '') + '.';
    if (q.op === 'spread-include') return 'Include ' + q.item.uid + ' (attempt ' + q.item.attempt + ') in "' + text + '"; it was cleared when the spread was added.';
    if (q.op === 'spread-bind') return 'Cover "' + text + '" on ' + q.item.uid + ' (attempt ' + q.item.attempt + ') on ' + q.dest.process + '/' + q.dest.id + '.';
    return 'Stop "' + text + '" for ' + N.many + ' that join later; the ' + n(q.owed.length) + ' it is owed on stay owed.';
  }
  function thenWords(r, q) {
    var rec = r.recorder && r.recorder.person || '';
    return q.status === 'queued' ? 'Queued for the recorder' + (rec ? ' (' + rec + ')' : '') + ': it is applied when their window is open.' : q.status === 'waiting' ? 'Waiting for approval: ' + q.why : WORDS[q.status] + (q.why ? ': ' + q.why : '.');
  }
  /* people.json as asking and deciding may use it: none while it can't be read (an unread entry names it), so no one vouches. */
  function peopleOf(o) { return (o.unread || []).some(function (u) { return u && u.file === 'people.json'; }) ? null : o.people; }
  /* Every record and unread file read (for a story's request's dependency on its spread), whatever a caller filtered. */
  function depsOf(o) { return o.deps || { records: o.records || [], unread: o.unread || [] }; }
  function unreadFor(o, r) { return (o.unread || []).filter(function (u) { return u && (u.run ? u.run.process === r.process && u.run.id === r.id : true); }); }
  /* ---- The inbox (4.0 slice 2): what needs a person. Every request on a run they may decide (PF.todos.personWhy) that waits
     for a decision, or that two decisions disagree on (settled only by a decision that saw every party), once each, with what
     it would do now. A run with a to-do record that can't be read, is held or breaks the chain asks nothing, and nor does an
     ended run or any run while people.json can't be read: nothing there can be decided safely. The count shown and the list
     opened are both this list. o: { records, unread, people, me }. ---- */
  function inbox(runs, o) {
    o = o || {};
    var people = peopleOf(o), out = [], had = Object.create(null);
    if (!o.me || !people) return out;
    (runs || []).forEach(function (r) {
      if (!r || !r.steps || r._unrunnable || r.ended || r.practice) return;
      var mine = recordsFor(o.records, r);
      if (!mine.length || personWhy(r, o.me, people)) return;
      var T = view(r, { records: mine, unread: unreadFor(o, r), people: people, deps: depsOf(o), now: o.now, runs: o.runs, loops: o.loops });
      if (!T.map || T.unread.length || T.held.length || T.broken) return;
      requestsOf(T).forEach(function (q) {
        if (q.unordered) return;
        /* A decision dispute is listed whether or not the request landed: settling one that landed is a decision only. */
        var dispute = (q.status === 'disputed' || q.landed) && (q.decOut || []).length > 0;
        if (q.landed ? !dispute : q.status !== 'waiting' && !dispute) return;
        var k = r.process + '/' + r.id + '\n' + q.id;
        if (had[k]) return; had[k] = true;
        var x = q.todo ? T.byTodo[q.todo] : null, C = consequenceOf(r, T.map, q, T);
        out.push({ run: { process: r.process, id: r.id }, title: String(r.title || r.process), id: q.id, kind: q.kind, op: q.op, todo: q.todo || '', text: q.op === 'add' || q.op === 'spread-add' ? q.text : x ? x.text : q.spread && T.bySpread[q.spread] ? T.bySpread[q.spread].text : '', by: q.by, at: q.at, reason: q.reason || '', to: q.to || null, spread: q.spread || null, fulfills: q.fulfills || null, placement: q.placement || null,
          status: q.status, why: q.why || '', dispute: dispute, landed: !!q.landed, consequence: { reopens: C.reopens.slice(), releases: C.releases, fingerprint: C.fingerprint },
          words: q.landed ? whatWords(T.map, q, x, { reopens: [], releases: false }, T).replace(/\.$/, '') + ': already applied. Your decision settles the disagreement; nothing is applied again.' : whatWords(T.map, q, x, C, T) });
      });
    });
    return out;
  }
  /* The active delegations on runs a person may decide, which they may revoke: { run, title, id, subject, ops, targets, adds,
     by }. Same rules as the inbox: nothing while people.json can't be read, nothing on an ended run. */
  function delegations(runs, o) {
    o = o || {};
    var people = peopleOf(o), out = [];
    if (!o.me || !people) return out;
    (runs || []).forEach(function (r) {
      if (!r || !r.steps || r._unrunnable || r.ended || r.practice) return;
      var mine = recordsFor(o.records, r);
      if (!mine.length || personWhy(r, o.me, people)) return;
      var T = view(r, { records: mine, unread: unreadFor(o, r), people: people, deps: depsOf(o), now: o.now, runs: o.runs, loops: o.loops });
      Object.keys(T.grants).sort(cmpStr).forEach(function (id) {
        var g = T.grants[id];
        if (g.active) out.push({ run: { process: r.process, id: r.id }, title: String(r.title || r.process), id: id, subject: g.subject, ops: g.ops.slice(), targets: g.targets.slice(), adds: g.limits.adds, by: g.by });
      });
    });
    return out;
  }
  /* A person's decision on one request in their inbox: { name, file, record, words } or { why } (renewed: true when what it
     would do changed since they saw it, o.shown: the consequence fingerprint shown to them; an acceptance binds exactly that).
     A decision sees the request and every decision on it no later one saw, so one made on a dispute settles it. o: { request,
     op, by, shown, reason, records, unread, people, at, app, writer, rev }. Nothing is written here. */
  function decide(r, o) {
    o = o || {};
    var people = peopleOf(o);
    if (!people) return { why: 'people.json can\'t be read, so no one\'s authority can be checked. Nothing was decided.' };
    if (r.ended) return { why: 'The run has ended, so nothing on it is decided.' };
    var pw = personWhy(r, o.by, people);
    if (pw) return { why: pw + ', so they can\'t decide this.' };
    var it = inbox([r], { records: o.records, unread: o.unread, people: people, me: o.by, now: o.now, runs: o.runs, loops: o.loops }).filter(function (x) { return x.id === o.request; })[0];
    if (!it) return { why: 'That request isn\'t waiting for a decision on this run (it may be decided, applied or held already). Nothing was decided.' };
    if (DOPS.indexOf(o.op) < 0) return { why: 'Say accept or decline.' };
    if (o.op === 'accept' && o.shown !== it.consequence.fingerprint) return { renewed: true, item: it, why: 'What it would do changed since you saw it: ' + it.words + ' Look again, then decide.' };
    if (o.op === 'accept' && it.op === 'spread-stop' && !it.landed) { var T0 = view(r, { records: recordsFor(o.records, r), unread: unreadFor(o, r), people: people, deps: depsOf(o) }), sc0 = stopCheck(r, T0, T0.requests[o.request], o); if (sc0) return { why: sc0.why + ' Nothing was decided.' }; }
    var reason = o.reason == null ? '' : String(o.reason).trim();
    if (reason.length > LIMITS.reason) return { why: 'A reason is at most ' + LIMITS.reason + ' characters (this is ' + reason.length + ').' };
    var T = view(r, { records: recordsFor(o.records, r), unread: unreadFor(o, r), people: people, deps: depsOf(o), now: o.now, runs: o.runs, loops: o.loops }), q = T.requests[o.request];
    var s = buildStatus({ kind: 'decision', proposal: q.id, run: { process: r.process, id: r.id }, seen: seenFor(T, [q.id], [q.id], ['dec', 'raw']).seen, by: o.by, at: o.at, op: o.op, consequence: it.consequence.fingerprint, reason: reason, writer: o.writer, rev: o.rev, app: o.app });
    var fd = filed(s.name, s.file);
    if (fd.why) return { why: fd.why };
    var after = view(r, { records: recordsFor(o.records, r).concat([fd.record]), unread: unreadFor(o, r), people: people, deps: depsOf(o), now: o.now, runs: o.runs, loops: o.loops }).requests[q.id];
    return { name: s.name, file: s.file, record: fd.record, item: it, words: (o.op === 'accept' ? 'Accepted. ' : 'Declined. ') + it.words + ' ' + thenWords(r, after || q) };
  }
  /* The decision write guard (every window's, right before the write): deciding again with the folder and the clock as they
     are now must make the same decision on the same consequence, so a request whose evidence went stale, whose authority
     ended or whose consequence changed since it was shown is never decided. o: what decide was given, with now. made:
     decide's result. '' or why. */
  function decideStill(r, o, made) {
    if (!r || !made || !made.record) return 'The run or the decision isn\'t here any more.';
    var again = decide(r, o);
    if (again.why) return again.why;
    var a = again.record, b = made.record;
    var what = function (d) { return JSON.stringify([d.proposal, d.op, d.consequence, d.by]); };
    return what(a) === what(b) ? '' : 'What it would do changed since it was decided. Look again, then decide.';
  }
  /* Ending a delegation (a revoke): only a person who may decide, only an active grant; what it covered and hasn't landed waits
     for a person's approval again. o: { grant, by, key, reason, records, unread, people, at, app }. */
  function revokeOf(r, o) {
    o = o || {};
    var people = peopleOf(o);
    if (!people) return { why: 'people.json can\'t be read, so no one\'s authority can be checked. Nothing was revoked.' };
    var pw = personWhy(r, o.by, people);
    if (pw) return { why: pw + ', so they can\'t revoke a delegation here.' };
    if (!KEY.test(String(o.key || ''))) return { why: 'A revoke needs its retry key.' };
    var T = view(r, { records: recordsFor(o.records, r), unread: unreadFor(o, r), people: people, deps: depsOf(o), now: o.now, runs: o.runs, loops: o.loops }), g = T.grants[o.grant];
    if (!g || !g.active) return { why: 'That isn\'t an active delegation on this run.' };
    var f = buildGrant({ kind: 'revoke', id: idFor('flightdeck', o.key), run: { process: r.process, id: r.id }, seen: seenFor(T, [g.id], [], []).seen, by: o.by, at: o.at, grant: g.id, reason: o.reason ? String(o.reason).trim() : '', app: o.app });
    var fd = filed(f.id + '.json', f);
    return fd.why ? { why: fd.why } : { id: f.id, name: f.id + '.json', file: f, record: fd.record, words: 'Delegation ended. What it covered and hasn\'t been applied waits for a person\'s approval.' };
  }
  /* A delegation (a grant): a person who may decide lets a tool or a person add, check off or reopen to-dos on exact targets of
     this run, up to a number of additions; never Won't do, Moved or a gate. o: { subject: { tool } | { person }, ops, targets,
     adds, by, key, records, unread, people, at, app }. */
  function grantOf(r, o) {
    o = o || {};
    var people = peopleOf(o), map = null; try { map = PF.run.mapOf(r); } catch (e) { map = null; }
    if (!map) return { why: 'This run\'s checklist can\'t be read.' };
    if (r.ended) return { why: 'The run has ended, so nothing is delegated on it.' };
    if (!people) return { why: 'people.json can\'t be read, so no one\'s authority can be checked. Nothing was delegated.' };
    var pw = personWhy(r, o.by, people);
    if (pw) return { why: pw + ', so they can\'t delegate here.' };
    var ops = Array.isArray(o.ops) ? o.ops : [], targets = Array.isArray(o.targets) ? o.targets : [];
    if (!ops.length || ops.some(function (x) { return ['add', 'done', 'reopen'].indexOf(x) < 0; })) return { why: 'A delegation covers add, done or reopen only; dropping or moving work always needs a person.' };
    if (!targets.length || targets.length > LIMITS.targets) return { why: 'Name 1 to ' + LIMITS.targets + ' places it covers.' };
    for (var i = 0; i < targets.length; i++) { var P = placeOf(map, targets[i]); if (P.why) return { why: 'It can\'t cover that: ' + P.why + '.' }; }
    var adds = o.adds == null ? 0 : o.adds;
    if (typeof adds !== 'number' || adds % 1 || adds < 0 || adds > LIMITS.grantAdds) return { why: 'Additions are a whole number from 0 to ' + LIMITS.grantAdds + '.' };
    if (!KEY.test(String(o.key || ''))) return { why: 'A delegation needs its retry key.' };
    var T = view(r, { records: recordsFor(o.records, r), unread: unreadFor(o, r), people: people, deps: depsOf(o), now: o.now, runs: o.runs, loops: o.loops });
    var f = buildGrant({ kind: 'grant', id: idFor('flightdeck', o.key), run: { process: r.process, id: r.id }, seen: seenFor(T, [], [], []).seen, by: o.by, at: o.at, subject: o.subject, ops: ops, targets: targets, limits: { adds: adds }, app: o.app });
    var fd = filed(f.id + '.json', f);
    return fd.why ? { why: fd.why } : { id: f.id, name: f.id + '.json', file: f, record: fd.record, words: 'Delegated: ' + (o.subject && (o.subject.tool || o.subject.person)) + ' may ' + ops.join(', ') + ' on ' + targets.length + ' place' + (targets.length === 1 ? '' : 's') + (ops.indexOf('add') >= 0 ? ', up to ' + adds + ' addition' + (adds === 1 ? '' : 's') : '') + '. You can revoke it any time.' };
  }
  /* The first queued request of a run, in causal order: one lands at a time, so each is checked against the work as the one
     before it left it. */
  /* The one eligibility check every candidate the recorder picks from passes: a stop not landed yet that can't land as it is
     (what its spread is owed on changed since it was asked, or can't all be read) is passed over, never blocking the requests
     after it; applyPlan checks it again before any write. Without r, nothing is passed over. */
  function canCarry(r, T, q, o) { return !(r && q.op === 'spread-stop' && !q.landed && stopCheck(r, T, q, o)); }
  function nextQueued(T, r, o) {
    return requestsOf(T).filter(function (q) { return q.status === 'queued' && !q.landed && canCarry(r, T, q, o); })[0] || null;
  }
  /* What the recorder carries out next: the first queued request, else the first whose prepared applications are to be settled
     (none landed, or one landed with others outstanding), each through the same check. */
  function nextToCarry(T, r, o) {
    return nextQueued(T, r, o) || requestsOf(T).filter(function (q) { return ((q.status === 'disputed' && q.appOnly && q.via) || (q.landed && (q.appOut || []).length)) && canCarry(r, T, q, o); })[0] || null;
  }

  return { SOPS: SOPS, ALL_OPS: ALL_OPS, isSpreadOp: isSpreadOp, missingOf: missingOf, hasPair: hasPair, loopWhy: loopWhy, FORMAT: FORMAT, STATUS: STATUS, FEATURE: FEATURE, LIMITS: LIMITS, OPS: OPS, WORDS: WORDS, STATE_WORDS: STATE_WORDS, idFor: idFor, todoIdFor: todoIdFor, statusName: statusName, isTodo: isTodo, claims: claims, familyOf: familyOf,
    targetKey: targetKey, placeOf: placeOf, placementWhy: placementWhy, placementFor: placementFor, effectOf: effectOf, fingerprint: fp, text: text,
    buildProposal: buildProposal, buildGrant: buildGrant, buildStatus: buildStatus, cleanFile: cleanFile, fileWhy: fileWhy, filed: filed, runOf: runOf, recordsFor: recordsFor,
    requestFile: requestFile, recordName: recordName, decideStill: decideStill, notFact: notFact, reduce: reduce, seenFor: seenFor, requestsOf: requestsOf,
    personWhy: personWhy, mayFor: mayFor, consequenceOf: consequenceOf, authorityFor: authorityFor, view: view, holds: holds, markHolds: markHolds, cutFor: cutFor, cleanCut: cleanCut, cleanLiving: cleanLiving, applyPlan: applyPlan, nextQueued: nextQueued, nextToCarry: nextToCarry, keepHead: keepHead, prepare: prepare, gateTitle: gateTitle, toOf: toOf, inbox: inbox, delegations: delegations, decide: decide, revokeOf: revokeOf, grantOf: grantOf, whatWords: whatWords, askDiffers: askDiffers };
})();
