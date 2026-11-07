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
    var by = Object.create(null), order = [], held = [], anc = Object.create(null);
    records.forEach(function (r) { if (r && typeof r.id === 'string' && !by[r.id]) by[r.id] = r; });
    var ids = Object.keys(by).sort(cmpStr), state = Object.create(null);
    function visit(id) {
      if (state[id] === 2) return anc[id] !== null;
      if (state[id] === 1) return false;
      state[id] = 1;
      var r = by[id], a = Object.create(null), ok = true, missing = [];
      (r.seen || []).forEach(function (s) {
        if (!by[s]) { ok = false; missing.push(s); return; }
        if (!visit(s)) { ok = false; return; }
        a[s] = true; Object.keys(anc[s]).forEach(function (x) { a[x] = true; });
      });
      state[id] = 2;
      if (!ok) { anc[id] = null; held.push({ record: id, missing: missing }); return false; }
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

  return { KINDS: KINDS, MAX_ITEMS: MAX_ITEMS, DEFAULT_MAX: DEFAULT_MAX, maxOf: maxOf, limitOf: limitOf, uidOf: uidOf, causal: causal, reduce: reduce };
})();
