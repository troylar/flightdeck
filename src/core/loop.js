/* Loops (3.0, docs/design.md 44): a {for.each} step starts one linked run of a child checklist per item of a living scope.
   Pure: no files. The kinds of item a loop takes, its limit, the scope ledger, scope requests and the gate's roll-up. */
PF.loop = (function () {
  'use strict';
  /* The kinds of item (items:), each with how its stable id and key look. jira.issue first; environments, services and pull
     requests can follow with their own entry (and the type's items: options, PF.types, the same list). */
  var KINDS = {
    'jira.issue': { label: 'Jira issue', plural: 'Jira issues', source: 'jira', id: /^[0-9]{1,18}$/, key: /^[A-Z][A-Z0-9_]{0,29}-[1-9][0-9]{0,8}$/ }
  };
  /* max: (default 200, at most 500): more items than that are refused as a whole, never cut. */
  var MAX_ITEMS = 500, DEFAULT_MAX = 200;
  function maxOf(v) { var t = String(v == null ? '' : v).trim(); if (!/^[1-9]\d{0,2}$/.test(t) || +t > MAX_ITEMS) return null; return +t; }
  function limitOf(step) { var m = step && step.fields && step.fields.max != null ? maxOf(step.fields.max) : null; return m == null ? DEFAULT_MAX : m; }

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  /* ---- The scope ledger: the records about one loop (requests from tools or people, and decisions on them), reduced to
     its items. Pure; no clocks: order is causal (each record names the records it had seen), ties by record id. ----
     A record, as the readers clean it:
       { id, type: 'request' | 'decision', seen: [record ids], by: { person } | { tool, version },
         request: observation (or null) and changes [{ op: add | exclude | restore | owner | exception | withdraw, item, reason,
           owner, approver, onBehalf }], children [{ item, attempt, inputs, owner }]
         decision: proposal (a request id), op: accept | keep, items [item uids], reason }
     An item: { id (the source's stable id, or ''), key, title }. Its uid is source:id, or source:key:<key> until an id is known. */
  var VERDICT = { exclude: 'removed', accept: 'removed', restore: 'in', keep: 'in' };
  function uidOf(source, it) { return it && it.id ? source + ':' + it.id : source + ':key:' + String((it && it.key) || ''); }
  /* Each record's ancestors (every record it saw, transitively), and the causal order. A record that names one this copy
     can't read is held, with everything after it that saw it: nothing of theirs is applied. */
  function causal(records) {
    var by = Object.create(null), order = [], held = [], anc = Object.create(null), split = Object.create(null);
    /* OneDrive copies of one record (the same id): counted once when they say the same thing; when they differ, which is
       meant isn't known, so the record is held, with everything after it. */
    function body(r) { var o = {}; Object.keys(r).forEach(function (k) { if (k[0] !== '_' && k !== 'created') o[k] = r[k]; }); return JSON.stringify(canon(o)); }
    records.forEach(function (r) {
      if (!r || typeof r.id !== 'string') return;
      if (!by[r.id]) by[r.id] = r; else if (body(by[r.id]) !== body(r)) split[r.id] = true;
    });
    var ids = Object.keys(by).sort(cmpStr), state = Object.create(null);
    function visit(id) {
      if (state[id] === 2) return anc[id] !== null;
      if (state[id] === 1) return false;
      state[id] = 1;
      var r = by[id], a = Object.create(null), ok = true, missing = [];
      if (split[id]) { state[id] = 2; anc[id] = null; held.push({ record: id, missing: [], why: 'copies' }); return false; }
      (r.seen || []).forEach(function (s) {
        if (!by[s]) { ok = false; missing.push(s); return; }
        if (!visit(s)) { ok = false; return; }
        a[s] = true; Object.keys(anc[s]).forEach(function (x) { a[x] = true; });
      });
      state[id] = 2;
      if (!ok) { anc[id] = null; held.push({ record: id, missing: missing, why: missing.length ? 'missing' : 'after' }); return false; }
      anc[id] = a; return true;
    }
    ids.forEach(visit);
    /* Topological, ties by id: a record comes after everything it saw. */
    var placed = Object.create(null), live = ids.filter(function (id) { return anc[id] !== null; });
    while (order.length < live.length) {
      var next = live.filter(function (id) { return !placed[id] && Object.keys(anc[id]).every(function (x) { return placed[x]; }); })[0];
      placed[next] = true; order.push(by[next]);
    }
    return { order: order, anc: anc, held: held };
  }
  /* The items of a loop from its records. o: { source ('jira'), max }. Returns { items, pending, held, duplicates, overLimit,
     heads, observation }. items keep every one ever in scope, in the order they first arrived. */
  function reduce(records, o) {
    o = o || {};
    var source = o.source || 'jira', max = o.max || DEFAULT_MAX, c = causal(records || []), items = [], byUid = Object.create(null), byKey = Object.create(null);
    var duplicates = [], lastObs = null, intents = Object.create(null);
    function find(it) {
      var x = it.id ? byUid[uidOf(source, it)] : null;
      if (!x && it.key && byKey[it.key]) x = byKey[it.key];
      return x || null;
    }
    function ensure(it, rec, how) {
      var x = find(it);
      if (x) {
        /* A key first, then its id: the same item. */
        if (!x.id && it.id) { delete byUid[x.uid]; x.id = it.id; x.uid = uidOf(source, x); byUid[x.uid] = x; }
        if (it.title && it.title !== x.title) x.title = String(it.title);
        if (it.key && it.key !== x.key) { if (byKey[x.key] === x) delete byKey[x.key]; x.key = it.key; byKey[x.key] = x; }
        return x;
      }
      x = { uid: uidOf(source, it), id: it.id || '', key: it.key || '', title: String(it.title || ''), state: 'in', since: rec.id, provenance: [], verdict: null,
        review: [], mismatch: false, kept: false, owner: '', exception: null, attempt: 0, planned: null, proposal: null, inSource: true };
      items.push(x); byUid[x.uid] = x; if (x.key) byKey[x.key] = x;
      return x;
    }
    function note(x, rec, op, extra) { var p = { record: rec.id, op: op, by: rec.by || null }; if (extra) Object.keys(extra).forEach(function (k) { p[k] = extra[k]; }); x.provenance.push(p); }
    /* A verdict (in or removed) on an item: contrary to a concurrent one, the item needs review and stays required, until a
       record that saw both decides it. */
    function verdict(x, rec, op, reason) {
      var to = VERDICT[op], prev = x.verdict;
      if (prev && prev.to !== to && !c.anc[rec.id][prev.record]) {
        x.review.push({ records: [prev.record, rec.id], ops: [prev.op, op], why: 'Two people decided this item at once: ' + prev.op + ' and ' + op + '.' });
        x.state = 'in'; x.verdict = { to: to, op: op, record: rec.id, contrary: prev.record };
        return;
      }
      if (prev && prev.contrary && !(c.anc[rec.id][prev.record] && c.anc[rec.id][prev.contrary])) {
        /* Still contrary: this record hasn't seen both. */
        x.review.push({ records: [prev.contrary, prev.record, rec.id], ops: [op], why: 'Decided again without seeing the earlier contrary decisions.' });
        return;
      }
      x.review = x.review.filter(function (r) { return !r.records.every(function (id) { return c.anc[rec.id][id]; }); });
      x.verdict = { to: to, op: op, record: rec.id };
      x.state = to; x.proposal = null;
      if (to === 'removed') x.removed = { record: rec.id, reason: String(reason || ''), by: rec.by || null };
      else { delete x.removed; if (op === 'keep') x.kept = true; }
    }
    c.order.forEach(function (rec) {
      if (rec.type === 'request') {
        var obs = rec.observation, seenUids = Object.create(null);
        if (obs) {
          lastObs = { record: rec.id, observation: obs };
          (obs.items || []).forEach(function (it) {
            var x = find(it), was = !!x;
            x = ensure(it, rec, 'observed');
            seenUids[x.uid] = true; x.inSource = true; x.kept = false; x.manual = false;
            if (!was) note(x, rec, 'add', { observed: true });
            else if (x.state === 'removed') x.mismatch = true;
            else if (x.state === 'proposed') { x.state = 'in'; x.proposal = null; note(x, rec, 'seen-again'); }
          });
          /* Absence proposes a removal only from a complete observation, and only for items this source holds. */
          if (obs.complete) items.forEach(function (x) {
            if (seenUids[x.uid]) return;
            x.inSource = false;
            if (x.state === 'removed') { x.mismatch = false; return; }
            if (x.state !== 'in' || x.kept || x.manual) return;
            x.state = 'proposed'; x.proposal = rec.id; note(x, rec, 'propose-removal');
          });
        }
        (rec.changes || []).forEach(function (ch) {
          var it = ch.item || {}, x = find(it);
          if (ch.op === 'add') { var nw = !x; x = ensure(it, rec, 'add'); if (nw) { x.manual = !obs; note(x, rec, 'add'); } else if (x.state === 'removed') note(x, rec, 'add-ignored'); return; }
          if (!x) { duplicates.push({ record: rec.id, op: ch.op, item: it.key || it.id, why: 'names an item that isn\'t in this loop' }); return; }
          if (ch.op === 'exclude' || ch.op === 'restore') { verdict(x, rec, ch.op, ch.reason); note(x, rec, ch.op, { reason: String(ch.reason || '') }); if (ch.op === 'exclude' && x.inSource && x.state === 'removed') x.mismatch = true; if (ch.op === 'restore') x.mismatch = false; }
          else if (ch.op === 'owner') { note(x, rec, 'owner', { from: x.owner, to: String(ch.owner || '') }); x.owner = String(ch.owner || ''); }
          else if (ch.op === 'exception') { x.exception = { record: rec.id, reason: String(ch.reason || ''), approver: String(ch.approver || ''), by: rec.by || null, onBehalf: !!ch.onBehalf }; note(x, rec, 'exception', { reason: String(ch.reason || '') }); }
          else if (ch.op === 'withdraw') { if (x.exception) note(x, rec, 'withdraw', { was: x.exception.record }); x.exception = null; }
        });
        /* Planned children: one per loop item and attempt, whoever asked first (in causal order) plans it. */
        (rec.children || []).forEach(function (k) {
          var x = find(k.item || {});
          if (!x) return;
          var key = x.uid + '#' + k.attempt;
          if (intents[key]) { if (intents[key] !== rec.id) duplicates.push({ record: rec.id, op: 'plan', item: x.key, why: 'attempt ' + k.attempt + ' is already planned by ' + intents[key] }); return; }
          intents[key] = rec.id;
          if (k.attempt > x.attempt) { x.attempt = k.attempt; x.planned = { record: rec.id, attempt: k.attempt, inputs: k.inputs || {}, owner: k.owner || '' }; if (k.owner && !x.owner) x.owner = String(k.owner); }
        });
      } else if (rec.type === 'decision') {
        (rec.items || []).forEach(function (uid) {
          var x = byUid[uid] || byKey[uid];
          if (!x) return;
          if (rec.op === 'accept' && !(x.state === 'proposed' && x.proposal === rec.proposal) && !(x.verdict && x.verdict.contrary)) { note(x, rec, 'accept-stale'); return; }
          verdict(x, rec, rec.op, rec.reason);
          note(x, rec, rec.op === 'accept' ? 'accept-removal' : 'keep', { reason: String(rec.reason || '') });
        });
      }
    });
    var inScope = items.filter(function (x) { return x.state !== 'removed'; }).length;
    var heads = c.order.filter(function (r) { return !c.order.some(function (q) { return c.anc[q.id] && c.anc[q.id][r.id]; }); }).map(function (r) { return r.id; });
    return { items: items, held: c.held, duplicates: duplicates, heads: heads, observation: lastObs,
      pending: items.filter(function (x) { return x.state === 'proposed'; }).map(function (x) { return { uid: x.uid, key: x.key, proposal: x.proposal }; }),
      overLimit: inScope > max ? { count: inScope, max: max } : null };
  }

  /* ---- Scope requests and decisions: files in proposals/, beside plans (docs/design.md 44). ----
     A scope request is flightdeck-plan/3 with the loops feature, so every copy before 3.0 calls it a plan made with a newer
     Flightdeck and never offers it; this copy dispatches it here before the plan reader. A decision is
     flightdeck-plan-status/3, named <request>.status-<writer>-<rev>.json, written once and never changed. */
  var FORMAT = 'flightdeck-plan/3', STATUS = 'flightdeck-plan-status/3', FEATURES = ['loops'];
  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  var PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, RUN = /^[a-z0-9-]{1,40}$/i, STEP = /^[a-z0-9][a-z0-9-]{0,59}$/i, PERSON = /^[A-Za-z0-9_.-]{1,80}$/;
  var REQ = /^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}$/, WRITER = /^[a-z0-9][a-z0-9-]{0,39}$/, REV = /^[0-9a-f]{8}$/, DNAME = /^(req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24})\.status-([a-z0-9][a-z0-9-]{0,39})-([0-9a-f]{8})\.json$/;
  var OPS = ['add', 'exclude', 'restore', 'owner', 'exception', 'withdraw'], DOPS = ['accept', 'keep'];
  var LIMITS = { bytes: 262144, title: 200, reason: 300, query: 500, generation: 80, errors: 20, error: 200, changes: 500, inputs: 40, input: 240, seen: 50 };
  var CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function reserved(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype' || k in Object.prototype; }
  function q(k) { return '"' + String(k).slice(0, 70) + '"'; }
  function sorted(m) { var o = {}; Object.keys(m).sort().forEach(function (k) { o[k] = m[k]; }); return o; }
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (isMap(v)) { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); }); return o; }
    return v;
  }
  /* The request's id and file stem: like a plan request's (PF.requests.idFor), from the tool's name and the key, but over
     ['scope', tool, key], so a scope request and a plan request with the same key never share a name. */
  function idFor(tool, key) { return 'req-' + tool + '-' + PF.sha256.hex(JSON.stringify(['scope', tool, key])).slice(0, 24); }
  function isScope(o) { return isMap(o) && typeof o.format === 'string' && (o.format === FORMAT || o.format === STATUS); }
  function line(v, max, what, errors, opt) {
    if (v == null && opt) return '';
    if (typeof v !== 'string' || (!opt && !v.trim())) { errors.push(what + ' is text.'); return null; }
    if (v.length > max) { errors.push(what + ' is ' + v.length + ' characters; the most is ' + max + '.'); return null; }
    if (CONTROL.test(v)) { errors.push(what + ' has a line break or another control character.'); return null; }
    return v;
  }
  function whole(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= 1e6; }
  /* One item as a source reports it: { id, key, title }, for a kind (jira.issue). id may be left out where it isn't known
     (a key pasted by hand); key never. */
  function cleanItem(it, errors, where, kind) {
    var K = KINDS[kind || 'jira.issue'], out = { id: '', key: '', title: '' };
    if (!isMap(it)) { errors.push(where + ' is {"id": "10042", "key": "ABC-101", "title": "..."}.'); return null; }
    Object.keys(it).forEach(function (k) { if (['id', 'key', 'title', 'status', 'assignee'].indexOf(k) < 0) errors.push(where + ' has ' + q(k) + '; an item has id, key, title, status and assignee.'); });
    if (it.id != null && it.id !== '') { if (typeof it.id !== 'string' || !K.id.test(it.id)) errors.push(where + ': "id" is the issue\'s id, digits only, like "10042".'); else out.id = it.id; }
    if (typeof it.key !== 'string' || !K.key.test(it.key)) errors.push(where + ': "key" is an issue key, like ABC-101.'); else out.key = it.key;
    var t = line(it.title, LIMITS.title, where + ' "title"', errors, true); if (t) out.title = t;
    ['status', 'assignee'].forEach(function (k) { var v = line(it[k], 80, where + ' ' + q(k), errors, true); if (v) out[k] = v; });
    return out;
  }
  /* An observation (docs/apps.md, flightdeck loop sync): what a tool read from the source, whole. complete is true only when
     it says so and its numbers add up; why says what's missing otherwise. */
  function cleanObservation(o, errors) {
    if (!isMap(o)) { errors.push('The observation is a JSON object with source, generation, query, observedAt, items, reported, fetched, complete and errors.'); return null; }
    var KEYS = ['source', 'generation', 'query', 'observedAt', 'items', 'reported', 'fetched', 'complete', 'errors'];
    Object.keys(o).forEach(function (k) { if (KEYS.indexOf(k) < 0) errors.push('The observation has ' + q(k) + ', which an observation doesn\'t have. It has: ' + KEYS.join(', ') + '.'); });
    var out = { source: { system: 'jira' }, generation: '', query: '', observedAt: '', items: [], reported: 0, fetched: 0, complete: false, errors: [] };
    if (!isMap(o.source) || o.source.system !== 'jira' || Object.keys(o.source).some(function (k) { return k !== 'system' && k !== 'site'; })) errors.push('"source" is {"system": "jira", "site": "<its address>"}.');
    else { out.source = { system: 'jira' }; if (o.source.site != null) { var st = line(o.source.site, 200, '"source" site', errors); if (st) out.source.site = st; } }
    var g = line(o.generation, LIMITS.generation, '"generation"', errors); if (g) out.generation = g;
    var qy = line(o.query, LIMITS.query, '"query"', errors); if (qy) out.query = qy;
    if (typeof o.observedAt !== 'string' || !ISO.test(o.observedAt) || isNaN(Date.parse(o.observedAt))) errors.push('"observedAt" is a date and time with its zone, like 2026-11-07T09:42:00Z.');
    else out.observedAt = new Date(Date.parse(o.observedAt)).toISOString();
    ['reported', 'fetched'].forEach(function (k) { if (!whole(o[k])) errors.push(q(k) + ' is a whole number.'); else out[k] = o[k]; });
    if (typeof o.complete !== 'boolean') errors.push('"complete" is true or false: whether every page of the search was read.');
    if (!Array.isArray(o.errors) || o.errors.length > LIMITS.errors) errors.push('"errors" is a list of at most ' + LIMITS.errors + ' messages ([] when none).');
    else o.errors.forEach(function (e, i) { var t = line(e, LIMITS.error, '"errors" ' + (i + 1), errors); if (t) out.errors.push(t); });
    if (!Array.isArray(o.items)) errors.push('"items" is a list of the items found.');
    else if (o.items.length > MAX_ITEMS) errors.push('An observation holds at most ' + MAX_ITEMS + ' items; this one has ' + o.items.length + '. Nothing is cut: narrow the search or raise max: within the limit.');
    else {
      var keys = Object.create(null), ids = Object.create(null);
      o.items.forEach(function (it, i) {
        var c = cleanItem(it, errors, 'Item ' + (i + 1));
        if (!c) return;
        if (!c.id) errors.push('Item ' + (i + 1) + ': an observation gives each issue\'s "id".');
        if (keys[c.key] || (c.id && ids[c.id])) { errors.push('Item ' + (i + 1) + ' (' + c.key + ') is listed twice.'); return; }
        keys[c.key] = true; if (c.id) ids[c.id] = true;
        out.items.push(c);
      });
    }
    out.complete = o.complete === true;
    if (out.complete) {
      var why = out.errors.length ? 'the search reported errors' : out.fetched < out.reported ? 'it read ' + out.fetched + ' of ' + out.reported + ' reported matches' :
        out.items.length !== out.fetched ? 'it lists ' + out.items.length + ' items but says it read ' + out.fetched : '';
      if (why) { out.complete = false; out.why = why; }
    } else out.why = 'the observation says it isn\'t complete';
    out.items.sort(function (a, b) { return cmpStr(a.id || a.key, b.id || b.key); });
    return out;
  }
  function cleanLoop(l, errors) {
    if (!isMap(l) || !PROC.test(String(l.process)) || !RUN.test(String(l.run)) || !STEP.test(String(l.step)) || Object.keys(l).length !== 3) { errors.push('"loop" is {"process": "<checklist>", "run": "<run id>", "step": "<the loop step\'s id>"}.'); return null; }
    return { process: l.process, run: l.run, step: l.step };
  }
  function cleanChanges(list, errors) {
    var out = [];
    if (list == null) return out;
    if (!Array.isArray(list) || list.length > LIMITS.changes) { errors.push('"changes" is a list of at most ' + LIMITS.changes + ' changes.'); return out; }
    list.forEach(function (ch, i) {
      var where = 'Change ' + (i + 1);
      if (!isMap(ch) || OPS.indexOf(ch.op) < 0) { errors.push(where + ' is {"op": ' + OPS.map(q).join(' | ') + ', "item": {...}}.'); return; }
      Object.keys(ch).forEach(function (k) { if (['op', 'item', 'reason', 'owner', 'approver', 'onBehalf'].indexOf(k) < 0) errors.push(where + ' has ' + q(k) + '.'); });
      var it = cleanItem(ch.item, errors, where + ' item'), c = { op: ch.op, item: it };
      if (!it) return;
      if (ch.op === 'exclude' || ch.op === 'exception') { var r = line(ch.reason, LIMITS.reason, where + ' "reason"', errors); if (r) c.reason = r; }
      else if (ch.reason != null) { var r2 = line(ch.reason, LIMITS.reason, where + ' "reason"', errors, true); if (r2) c.reason = r2; }
      if (ch.op === 'owner') { if (ch.owner !== '' && (typeof ch.owner !== 'string' || !PERSON.test(ch.owner))) errors.push(where + ': "owner" is a person\'s ID from people.json, or "" for none.'); else c.owner = ch.owner; }
      if (ch.op === 'exception') {
        if (typeof ch.approver !== 'string' || !PERSON.test(ch.approver)) errors.push(where + ': "approver" is the person\'s ID from people.json who approved it.'); else c.approver = ch.approver;
        if (ch.onBehalf != null && typeof ch.onBehalf !== 'boolean') errors.push(where + ': "onBehalf" is true or false.'); else c.onBehalf = ch.onBehalf === true;
      }
      out.push(c);
    });
    return out;
  }
  /* What a call asks for: { loop, observation, changes } from a tool (producer { name, version }) or a person. */
  function cleanIntent(v, key, producer) {
    var errors = [];
    if (!isMap(v)) return { intent: null, errors: ['A scope request is {"loop": {...}, "observation": {...}, "changes": [...]}.'] };
    Object.keys(v).forEach(function (k) { if (['loop', 'observation', 'changes'].indexOf(k) < 0) errors.push('The request has ' + q(k) + '. It can have: loop, observation, changes.'); });
    var intent = { key: key, producer: producer || null, loop: cleanLoop(v.loop, errors), observation: v.observation == null ? null : cleanObservation(v.observation, errors), changes: cleanChanges(v.changes, errors) };
    if (!intent.observation && !intent.changes.length) errors.push('The request has no observation and no changes, so it asks for nothing.');
    return { intent: intent, errors: errors };
  }
  /* The canonical intent: what's compared on a retry. The tool's version and Flightdeck's own additions (seen, children,
     the time it was written) are never part of it, so the original stands. */
  function canonical(intent) { return canon({ loop: intent.loop, producer: intent.producer ? intent.producer.name : null, observation: intent.observation, changes: intent.changes }); }
  function differs(intent, file) {
    if (!isMap(file) || file.format !== FORMAT) return ['kind'];
    var a = canonical(intent), b = canon({ loop: file.loop, producer: file.producer ? file.producer.name : null, observation: file.observation || null, changes: file.changes || [] }), out = [];
    ['producer', 'loop', 'observation', 'changes'].forEach(function (k) { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k === 'producer' ? 'tool' : k); });
    return out;
  }
  /* The file written. o: { seen (the records it saw), children (planned child intents), now, app, by (a person, when no tool), id }. */
  function buildRequest(intent, o) {
    var tool = intent.producer, f = { format: FORMAT, features: FEATURES.slice() };
    if (PF.envelope.semver(o.app)) f.app = o.app;
    f.id = o.id || idFor(tool.name, intent.key);
    f.loop = intent.loop;
    if (tool) { f.producer = { name: tool.name, version: tool.version }; f.key = intent.key; f.by = tool.name + ' ' + tool.version + ' (a tool)'; }
    else f.by = o.by;
    f.created = o.now;
    f.seen = (o.seen || []).slice().sort();
    f.observation = intent.observation;
    f.changes = intent.changes;
    f.children = (o.children || []).map(function (k) { return { item: { id: k.item.id || '', key: k.item.key }, attempt: k.attempt, inputs: sorted(k.inputs || {}), owner: k.owner || '' }; });
    return f;
  }
  function text(f) { return JSON.stringify(f, null, 2) + '\n'; }
  function verdictOf(o, family) {
    var v = PF.envelope.judge(family, o);
    if (!v.ok) return { ok: false, kind: v.kind, why: v.kind === 'newer' ? 'is a scope ' + (family === 'flightdeck-plan' ? 'request' : 'decision') + ' made with a newer Flightdeck. ' + PF.envelope.needsText(v.needs) : v.why, needs: v.needs || '' };
    if (v.major !== 3 || v.features.indexOf('loops') < 0) return { ok: false, kind: 'malformed', why: 'isn\'t a scope ' + (family === 'flightdeck-plan' ? 'request' : 'decision') + ' (it doesn\'t name the loops feature)', needs: '' };
    return null;
  }
  function byOf(f) {
    if (f.producer && isMap(f.producer)) return { tool: String(f.producer.name), version: String(f.producer.version) };
    return { person: String(f.by || '') };
  }
  /* A scope request in proposals/, read back: { ok, record } (for the ledger, with the file's own fields) or a refusal. */
  function cleanRequest(o, name) {
    var bad = verdictOf(o, 'flightdeck-plan');
    if (bad) return bad;
    var errors = [], mal = function (why) { return { ok: false, kind: 'malformed', why: why, needs: '' }; };
    if (typeof o.id !== 'string' || !REQ.test(o.id)) return mal('is a scope request without a request id');
    if (typeof name === 'string' && name.indexOf(o.id) !== 0) return mal('is a scope request whose name isn\'t its id');
    var loop = cleanLoop(o.loop, errors), obs = o.observation == null ? null : cleanObservation(o.observation, errors), changes = cleanChanges(o.changes, errors);
    if (!Array.isArray(o.seen) || o.seen.length > LIMITS.seen || !o.seen.every(function (x) { return typeof x === 'string' && (REQ.test(x) || DNAME.test(x + '.json')); })) errors.push('its seen isn\'t a list of scope records');
    var children = [];
    if (!Array.isArray(o.children)) errors.push('its children isn\'t a list');
    else o.children.forEach(function (k, i) {
      var it = isMap(k) ? cleanItem(k.item, errors, 'child ' + (i + 1)) : null;
      if (!it || !whole(k.attempt) || k.attempt < 1 || !isMap(k.inputs) || Object.keys(k.inputs).length > LIMITS.inputs || Object.keys(k.inputs).some(function (n) { return reserved(n) || typeof k.inputs[n] !== 'string' || k.inputs[n].length > LIMITS.input; }) || (k.owner !== '' && !PERSON.test(String(k.owner)))) { errors.push('child ' + (i + 1) + ' isn\'t a planned child'); return; }
      children.push({ item: it, attempt: k.attempt, inputs: k.inputs, owner: k.owner });
    });
    if (errors.length) return mal('is a scope request that isn\'t in its format: ' + errors[0]);
    return { ok: true, record: { id: o.id, type: 'request', loop: loop, seen: o.seen.slice(), by: byOf(o), observation: obs, changes: changes, children: children, created: typeof o.created === 'string' ? o.created : '', key: typeof o.key === 'string' ? o.key : '' } };
  }
  /* A decision on a scope request's proposed removals: accept (remove them) or keep. Its id is its file stem. */
  function buildDecision(d) {
    var name = d.proposal + '.status-' + d.writer + '-' + d.rev + '.json', f = { format: STATUS, features: FEATURES.slice() };
    if (PF.envelope.semver(d.app)) f.app = d.app;
    f.proposal = d.proposal; f.loop = d.loop; f.op = d.op; f.items = d.items.slice(); f.seen = d.seen.slice().sort(); if (d.reason) f.reason = d.reason;
    f.by = d.by; if (d.onBehalf) f.onBehalf = d.onBehalf; f.at = d.now;
    return { name: name, file: f };
  }
  function cleanDecision(o, name) {
    var bad = verdictOf(o, 'flightdeck-plan-status');
    if (bad) return bad;
    var m = DNAME.exec(String(name || '')), errors = [], mal = function (why) { return { ok: false, kind: 'malformed', why: why, needs: '' }; };
    if (!m || m[1] !== o.proposal) return mal('is a scope decision whose name doesn\'t say its request');
    var loop = cleanLoop(o.loop, errors);
    if (DOPS.indexOf(o.op) < 0) return mal('is a scope decision that isn\'t accept or keep');
    if (!Array.isArray(o.items) || !o.items.length || o.items.length > MAX_ITEMS || !o.items.every(function (x) { return typeof x === 'string' && x.length <= 80; })) return mal('is a scope decision without its items');
    if (!Array.isArray(o.seen) || !o.seen.every(function (x) { return typeof x === 'string'; })) return mal('is a scope decision without what it saw');
    if (typeof o.by !== 'string' || !PERSON.test(o.by)) return mal('is a scope decision without who made it');
    if (errors.length) return mal('is a scope decision that isn\'t in its format: ' + errors[0]);
    return { ok: true, record: { id: name.slice(0, -5), type: 'decision', loop: loop, proposal: o.proposal, op: o.op, items: o.items.slice(), seen: o.seen.slice(), reason: typeof o.reason === 'string' ? o.reason.slice(0, LIMITS.reason) : '', by: { person: o.by }, onBehalf: typeof o.onBehalf === 'string' ? o.onBehalf : '' } };
  }
  /* A file of either kind, as the folder reader dispatches it before the plan reader. */
  function cleanFile(o, name) { return o.format === STATUS ? cleanDecision(o, name) : cleanRequest(o, name); }
  /* The records about one loop instance. */
  function recordsFor(records, loop) { return (records || []).filter(function (r) { return r.loop && r.loop.process === loop.process && r.loop.run === loop.run && r.loop.step === loop.step; }); }

  return { KINDS: KINDS, MAX_ITEMS: MAX_ITEMS, DEFAULT_MAX: DEFAULT_MAX, LIMITS: LIMITS, FORMAT: FORMAT, STATUS: STATUS, OPS: OPS, maxOf: maxOf, limitOf: limitOf, uidOf: uidOf, causal: causal, reduce: reduce,
    idFor: idFor, isScope: isScope, cleanObservation: cleanObservation, cleanIntent: cleanIntent, canonical: canonical, differs: differs, buildRequest: buildRequest, text: text,
    cleanRequest: cleanRequest, buildDecision: buildDecision, cleanDecision: cleanDecision, cleanFile: cleanFile, recordsFor: recordsFor };
})();
