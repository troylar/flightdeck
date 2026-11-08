/* Loops (3.0, docs/design.md 44): a {for.each} step starts one linked run of a child checklist per item of a living scope.
   Pure: no files. The kinds of item a loop takes, its limit, the scope ledger, scope requests and the gate's roll-up. */
PF.loop = (function () {
  'use strict';
  /* The kinds of item (items:), each with how its stable id and key look, and the noun its rows are counted in (noun: on the
     step overrides it). jira.issue comes from a {jira.search} step (from:); item is any list, kept by hand or fed by one
     declared tool (source:). The type's items: options (PF.types) are the same list; a kind not here is refused, never
     read as another. */
  var KINDS = {
    'jira.issue': { label: 'Jira issue', plural: 'Jira issues', source: 'jira', id: /^[0-9]{1,18}$/, key: /^[A-Z][A-Z0-9_]{0,29}-[1-9][0-9]{0,8}$/, noun: { one: 'story', many: 'stories' } },
    item: { label: 'Item', plural: 'Items', source: 'item', id: null, key: /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/, link: true, noun: { one: 'item', many: 'items' } }
  };
  function kindOf(k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(KINDS, k) ? KINDS[k] : null; }
  /* noun: one / many, said in full (no plural is guessed): letters, digits, spaces, hyphens and apostrophes, at most 40 each. */
  var NOUN = /^[A-Za-z0-9](?:[A-Za-z0-9 '-]{0,38}[A-Za-z0-9'])?$/;
  function nounOf(f) {
    var K = kindOf(f && f.items), d = K ? K.noun : KINDS.item.noun;
    if (!f || f.noun == null || String(f.noun).trim() === '') return { one: d.one, many: d.many };
    var parts = String(f.noun).split('/').map(function (v) { return v.trim(); });
    if (parts.length !== 2 || !NOUN.test(parts[0]) || !NOUN.test(parts[1])) return null;
    return { one: parts[0], many: parts[1] };
  }
  /* The one formatter every surface counts rows with: 1 environment, 3 environments. */
  function count(n, N) { N = N || KINDS['jira.issue'].noun; return n + ' ' + (n === 1 ? N.one : N.many); }
  /* A stable id for the feed (source:), like deploy-targets. */
  var FEED = /^[a-z0-9][a-z0-9_.-]{0,59}$/;
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
    function body(r) { var o = Object.create(null); Object.keys(r).forEach(function (k) { if (k[0] !== '_' && k !== 'created') o[k] = r[k]; }); return JSON.stringify(canon(o)); }
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
    var kind = kindOf(o.kind) ? o.kind : 'jira.issue', source = KINDS[kind].source, max = o.max || DEFAULT_MAX, c = causal(records || []), items = [], byUid = Object.create(null), byKey = Object.create(null);
    var duplicates = [], lastObs = null, intents = Object.create(null), asks = Object.create(null), plans = Object.create(null);
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
        if (it.link && it.link !== x.link) x.link = String(it.link);
        if (it.key && it.key !== x.key) { if (byKey[x.key] === x) delete byKey[x.key]; x.key = it.key; byKey[x.key] = x; }
        return x;
      }
      x = { uid: uidOf(source, it), id: it.id || '', key: it.key || '', title: String(it.title || ''), link: String(it.link || ''), state: 'in', since: rec.id, provenance: [], verdict: null,
        review: [], mismatch: false, kept: false, owner: '', exception: null, attempt: 0, planned: null, proposal: null, inSource: true, choice: null, choiceReview: [], exc: null, excReview: [], own: null, ownReview: [], plan: null, planReview: [], planOpts: Object.create(null) };
      items.push(x); byUid[x.uid] = x; if (x.key) byKey[x.key] = x;
      return x;
    }
    function note(x, rec, op, extra) { var p = { record: rec.id, op: op, by: rec.by || null }; if (extra) Object.keys(extra).forEach(function (k) { p[k] = extra[k]; }); x.provenance.push(p); }
    /* A verdict (in or removed) on an item: contrary to a concurrent one, the item needs review and stays required, until a
       record that saw both decides it. */
    /* The one causal rule for a decision kept in slot (the scope verdict, a run choice): a record that didn't see the
       decision before it and disagrees makes them contrary (held, in rv); a later one settles it only once it has seen
       both. Returns 'contrary', 'held' or 'settled'. same(prev, val): whether they agree. why: { both(prev, val), again }. */
    function settle(x, slot, rv, rec, val, same, why) {
      /* Every decision made in this slot, and the participants of its unresolved conflicts (x[rv]): a record settles them only
         when it has seen every participant still outstanding, however many there are (S1, docs/design.md 44). */
      var all = x[slot + 'All'] || (x[slot + 'All'] = []), saw = function (id) { return !!c.anc[rec.id][id]; }, out = [];
      x[rv].forEach(function (r) { r.records.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); }); });
      var against = all.filter(function (e) { return !saw(e.record) && !same(e.val, val); });
      all.push({ record: rec.id, val: val });
      if (out.length && !out.every(saw)) {
        x[rv].push({ records: out.concat([rec.id]), ops: [val.op], why: why.again });
        return 'held';
      }
      if (against.length) {
        against.forEach(function (e) { x[rv].push({ records: [e.record, rec.id], ops: [e.val.op, val.op], why: why.both(Object.assign({}, e.val, { record: e.record }), val) }); });
        x[slot] = Object.assign({}, val, { record: rec.id, contrary: against[0].record });
        return 'contrary';
      }
      x[rv] = [];
      x[slot] = Object.assign({}, val, { record: rec.id });
      return 'settled';
    }
    function verdict(x, rec, op, reason) {
      var to = VERDICT[op];
      var s = settle(x, 'verdict', 'review', rec, { to: to, op: op }, function (p, v) { return p.to === v.to; },
        { both: function (p, v) { return 'Two people decided this item at once: ' + p.op + ' and ' + v.op + '.'; }, again: 'Decided again without seeing the earlier contrary decisions.' });
      if (s === 'contrary') { x.state = 'in'; return; }
      if (s === 'held') return;
      x.state = to; x.proposal = null;
      if (to === 'removed') x.removed = { record: rec.id, reason: String(reason || ''), by: rec.by || null };
      else { delete x.removed; if (op === 'keep') x.kept = true; }
    }
    /* A plan for an attempt (a planned child, or the choice of one): settled causally. Its suggested owner is only a default,
       used when no one has decided the story's owner: an owner decision, or a conflict between two, always stands. */
    function settlePlan(x, rec, attempt, inputs, owner, from) {
      var sp = settle(x, 'plan', 'planReview', rec, { op: 'plan', attempt: attempt, inputs: JSON.stringify(inputs), owner: owner }, function (p, v) { return p.attempt === v.attempt && p.inputs === v.inputs && p.owner === v.owner; },
        { both: function (p) { return 'Two plans for attempt ' + attempt + ' were made at once: ' + p.record + ' and ' + rec.id + '.'; }, again: 'Planned again without seeing both earlier plans.' });
      x.attempt = Math.max(x.attempt, attempt);
      x.planned = sp === 'settled' ? { record: from, attempt: attempt, inputs: inputs, owner: owner } : null;
    }
    c.order.forEach(function (rec) {
      if (rec.type === 'request') {
        /* A record for another kind of item is never read as this loop's (no fallback). */
        if ((rec.kind || 'jira.issue') !== kind) { duplicates.push({ record: rec.id, op: 'kind', item: '', why: 'is for items of kind ' + rec.kind + ', but this loop takes ' + kind }); return; }
        var obs = rec.observation, seenUids = Object.create(null);
        /* An observation from another feed, or another scope of this one, is refused before it is reduced. */
        var fw = obs ? feedWhy(obs, { items: kind, source: o.feed }, lastObs) : '';
        if (fw) { duplicates.push({ record: rec.id, op: 'observe', item: '', why: fw }); obs = null; }
        if (obs) {
          lastObs = { record: rec.id, observation: obs };
          (obs.items || []).forEach(function (it) {
            var x = find(it), was = !!x;
            x = ensure(it, rec, 'observed');
            seenUids[x.uid] = true; x.inSource = true; x.kept = false;
            if (!was) { x.fed = true; note(x, rec, 'add', { observed: true }); }
            else if (x.state === 'removed') x.mismatch = true;
            else if (x.state === 'proposed') { x.state = 'in'; x.proposal = null; note(x, rec, 'seen-again'); }
          });
          /* Absence proposes a removal only from a complete observation, and only for items the feed enrolled: one added by
             hand is never proposed, even after the feed listed it too. */
          if (obs.complete) items.forEach(function (x) {
            if (seenUids[x.uid]) return;
            x.inSource = false;
            if (x.state === 'removed') { x.mismatch = false; return; }
            if (x.state !== 'in' || x.kept || x.manual || !x.fed) return;
            x.state = 'proposed'; x.proposal = rec.id; x.proposedBy = rec.id; note(x, rec, 'propose-removal');
          });
        }
        (rec.changes || []).forEach(function (ch) {
          if (ACTIONS.indexOf(ch.op) >= 0) return;
          var it = ch.item || {}, x = find(it);
          if (ch.op === 'add') { var nw = !x; x = ensure(it, rec, 'add'); if (nw) { x.manual = !obs; note(x, rec, 'add'); } else if (x.state === 'removed') note(x, rec, 'add-ignored'); return; }
          if (!x) { duplicates.push({ record: rec.id, op: ch.op, item: it.key || it.id, why: 'names an item that isn\'t in this loop' }); return; }
          if (ch.op === 'exclude' || ch.op === 'restore') { verdict(x, rec, ch.op, ch.reason); note(x, rec, ch.op, { reason: String(ch.reason || '') }); if (ch.op === 'exclude' && x.inSource && x.state === 'removed') x.mismatch = true; if (ch.op === 'restore') x.mismatch = false; }
          else if (ch.op === 'owner') {
            var to = String(ch.owner || '');
            note(x, rec, 'owner', { from: x.owner, to: to });
            var so = settle(x, 'own', 'ownReview', rec, { op: 'owner', owner: to }, function (p, v) { return p.owner === v.owner; },
              { both: function (p, v) { return 'Two people assigned it at once: ' + (p.owner || 'no one') + ' and ' + (v.owner || 'no one') + '.'; }, again: 'Assigned again without seeing both earlier assignments.' });
            x.owner = so === 'settled' ? to : '';
          }
          else if (ch.op === 'choose') {
            note(x, rec, 'choose', { from: x.choice ? x.choice.run : '', to: String(ch.run || '') });
            settle(x, 'choice', 'choiceReview', rec, { op: 'choose', run: String(ch.run || ''), attempt: +ch.attempt || 1, candidates: (ch.candidates || []).slice().sort() }, function (p, v) { return p.run === v.run; },
              { both: function (p, v) { return 'Two people chose different runs at once: ' + p.run + ' and ' + v.run + '.'; }, again: 'Chosen again without seeing both earlier choices.' });
          }
          else if (ch.op === 'plan') {
            /* Choosing one of the plans for an attempt: settles like a third plan with that one's inputs. */
            var po = x.planOpts[(+ch.attempt || 1) + '#' + ch.record];
            if (!po) { duplicates.push({ record: rec.id, op: 'plan', item: x.key, why: 'names ' + ch.record + ', which isn\'t a plan for attempt ' + ch.attempt }); return; }
            settlePlan(x, rec, +ch.attempt || 1, po.inputs, po.owner, ch.record);
          }
          else if (ch.op === 'exception' || ch.op === 'withdraw') {
            if (ch.op === 'exception') note(x, rec, 'exception', { reason: String(ch.reason || '') }); else if (x.exception) note(x, rec, 'withdraw', { was: x.exception.record });
            /* Approving without a run and withdrawing it are decisions like any other: made at once, they hold the story. */
            var se = settle(x, 'exc', 'excReview', rec, { op: ch.op }, function (p, v) { return p.op === v.op; },
              { both: function (p, v) { return 'Two people decided its approval without a run at once: ' + p.op + ' and ' + v.op + '.'; }, again: 'Decided again without seeing both earlier decisions.' });
            x.exception = se === 'settled' && ch.op === 'exception' ? { record: rec.id, reason: String(ch.reason || ''), approver: String(ch.approver || ''), by: rec.by || null, onBehalf: !!ch.onBehalf } : null;
          }
        });
        /* Planned children: one per loop item and attempt. A plan that saw the first one for its attempt is a duplicate; two made
           at once settle like any decision: if they differ, nothing is planned for that attempt until one that saw both. */
        (rec.children || []).forEach(function (k) {
          var x = find(k.item || {});
          if (!x) return;
          var key = x.uid + '#' + k.attempt;
          x.planOpts[k.attempt + '#' + rec.id] = { inputs: k.inputs || {}, owner: k.owner || '' };
          /* A plan that saw the first one for its attempt is a duplicate, unless the attempt's plans are in conflict: then it
             is a resolution, settled like any decision. */
          var resolving = (x.planReview || []).length && x.plan && x.plan.attempt === k.attempt;
          if (intents[key] && intents[key] !== rec.id) { duplicates.push({ record: rec.id, op: 'plan', item: x.key, why: 'attempt ' + k.attempt + ' is already planned by ' + intents[key] }); if (c.anc[rec.id][intents[key]] && !resolving) return; }
          else if (intents[key]) return;
          else intents[key] = rec.id;
          if (k.attempt < x.attempt) return;
          settlePlan(x, rec, k.attempt, k.inputs || {}, k.owner || '', rec.id);
        });
        /* A request for the recorder (start, approve, send-back) admitted in causal order; its outcome settles below. */
        if ((rec.changes || []).some(function (ch) { return ACTIONS.indexOf(ch.op) >= 0; })) asks[rec.id] = { status: null, statusReview: [] };
      } else if (rec.type === 'decision') {
        if (rec.op === 'applied' || rec.op === 'refused') {
          /* A request's outcome: recorded two ways at once, it is neither, and it is never carried out again. */
          var q = asks[rec.proposal];
          if (q) settle(q, 'status', 'statusReview', rec, { op: rec.op, why: String(rec.reason || '') }, function (p, v) { return p.op === v.op; },
            { both: function (p, v) { return 'Recorded as ' + p.op + ' and as ' + v.op + ' at once.'; }, again: 'Recorded again without seeing both earlier outcomes.' });
          return;
        }
        if (rec.op !== 'accept' && rec.op !== 'keep') return;
        (rec.items || []).forEach(function (uid) {
          var x = byUid[uid] || byKey[uid];
          if (!x) return;
          if (rec.op === 'accept' && !(x.state === 'proposed' && x.proposal === rec.proposal) && !(x.verdict && (x.verdict.contrary || !c.anc[rec.id][x.verdict.record]))) { note(x, rec, 'accept-stale'); return; }
          verdict(x, rec, rec.op, rec.reason);
          note(x, rec, rec.op === 'accept' ? 'accept-removal' : 'keep', { reason: String(rec.reason || '') });
        });
      }
    });
    /* The owner comes only from settled decisions: an owner decision when there is one (none while two conflict), else the
       settled plan's suggestion (none while plans conflict). Never from whichever record sorted first. */
    items.forEach(function (x) {
      x.owner = x.ownReview.length ? '' : x.own ? (x.own.contrary ? '' : x.own.owner) : x.planReview.length || !x.planned ? '' : String(x.planned.owner || '');
    });
    var inScope = items.filter(function (x) { return x.state !== 'removed'; }).length;
    var heads = c.order.filter(function (r) { return !c.order.some(function (q) { return c.anc[q.id] && c.anc[q.id][r.id]; }); }).map(function (r) { return r.id; });
    return { items: items, held: c.held, duplicates: duplicates, heads: heads, requests: asks, observation: lastObs, applied: c.order.map(function (r) { return r.id; }),
      pending: items.filter(function (x) { return x.state === 'proposed'; }).map(function (x) { return { uid: x.uid, key: x.key, proposal: x.proposal }; }),
      overLimit: inScope > max ? { count: inScope, max: max } : null };
  }

  /* ---- The gate's roll-up: every item in scope has an accepted result or an approved exception. Pure. ----
     L: reduce()'s ledger. runs: the loop's child runs (each names parent.item { uid, key, attempt }). o: { accepts, result(run)
     -> { value, conflict } (PF.run.resultOf), stands(run) -> '' or why its completion doesn't stand (PF.run.childCheck),
     who(person id) -> a name }. Scope, outcome and exception stay apart: an exception never makes a result "cleared". */
  function words(v) { return String(v || '').replace(/-/g, ' '); }
  /* The plans for an attempt that are in conflict, to choose one: each record with the inputs it planned. */
  function planConflict(x) {
    var ids = []; x.planReview.forEach(function (rv) { rv.records.forEach(function (id) { if (ids.indexOf(id) < 0 && x.planOpts[x.plan.attempt + '#' + id]) ids.push(id); }); });
    /* Every plan in conflict, in record order: none is left out, so each can be chosen, whatever the files are named. */
    ids.sort(cmpStr);
    return { attempt: x.plan.attempt, options: ids.map(function (id) { return { record: id, inputs: x.planOpts[x.plan.attempt + '#' + id].inputs }; }) };
  }
  function rollup(L, runs, o) {
    o = o || {};
    var acc = o.accepts || [], who = o.who || function (p) { return p || ''; }, byItem = Object.create(null), keyed = Object.create(null);
    (runs || []).forEach(function (c) {
      var it = c && c.parent && c.parent.item;
      if (!it) return;
      var k = typeof it.uid === 'string' ? it.uid : '';
      (byItem[k] = byItem[k] || []).push(c);
      if (it.key) (keyed[it.key] = keyed[it.key] || []).push(c);
    });
    var rows = [], counts = { inScope: 0, cleared: 0, exception: 0, results: Object.create(null), running: 0, notStarted: 0, removed: 0, review: 0, proposed: 0 }, blockers = [];
    (L.held || []).forEach(function (h) { blockers.push({ key: '', kind: 'held', record: h.record, text: h.why === 'copies' ? 'Two different copies of scope record ' + h.record + ' are in the folder.' : h.why === 'unreadable' ? 'A scope record (' + h.record + ') can\'t be read yet, so this loop can\'t be approved until it is.' : 'A scope record (' + h.record + ') refers to one this computer can\'t read yet.' }); });
    if (L.overLimit) blockers.push({ key: '', kind: 'limit', text: L.overLimit.count + ' items are in scope; this loop takes at most ' + L.overLimit.max + '. Nothing was cut: remove items or raise max:.' });
    L.items.forEach(function (x) {
      var mine = (byItem[x.uid] || (x.key ? keyed[x.key] : null) || []).slice(), top = 0;
      mine.forEach(function (c) { var a = +c.parent.item.attempt || 1; if (a > top) top = a; });
      var latest = mine.filter(function (c) { return (+c.parent.item.attempt || 1) === top; }), candidates = latest.length > 1 ? latest.map(function (c) { return c.id; }) : [];
      /* Runs that compete for one attempt: the one a settled choose record names counts, only for that attempt and the very
         runs it saw (docs/design.md 44); another run arriving, or two choices made at once, make them compete again. */
      var cho = x.choice && !x.choice.contrary && !(x.choiceReview || []).length ? x.choice : null, seenAll = cho && cho.attempt === top && JSON.stringify(cho.candidates) === JSON.stringify(candidates.slice().sort());
      if (latest.length > 1 && cho && seenAll) { var pick = latest.filter(function (c) { return c.id === cho.run; }); if (pick.length === 1) latest = pick; }
      var choWhy = latest.length > 1 && (x.choiceReview || []).length ? 'two people chose different runs at once; choose again, having seen both' : latest.length > 1 && cho && cho.attempt === top && !seenAll ? 'has another run since ' + cho.run + ' was chosen; choose again' : '';
      var row = { uid: x.uid, key: x.key, title: x.title, state: x.state, required: x.state !== 'removed', owner: x.owner, exception: x.exception, review: x.review.length > 0, mismatch: x.mismatch,
        ownerWhy: (x.ownReview || []).length ? 'two people assigned it at once; assign it again' : '', excReview: (x.excReview || []).length > 0,
        planConflict: (x.planReview || []).length && x.plan ? planConflict(x) : null,
        runs: mine.map(function (c) { return c.id; }), run: latest.length === 1 ? latest[0].id : '', competing: latest.length > 1, candidates: candidates, chosen: cho && seenAll ? cho.run : '', recorder: latest.length === 1 && latest[0].recorder ? latest[0].recorder.person || '' : '',
        result: '', accepted: false, status: '', fp: '', planned: x.planned, attempt: Math.max(top, x.attempt) };
      /* S1, fail closed: any decision on this story still in conflict holds approval, whether or not it is in scope now. */
      var cname = x.key || x.uid, cflag = function (text) { counts.review++; blockers.push({ key: x.key, uid: x.uid, kind: 'review', run: row.run, text: cname + text }); };
      if (row.review) cflag(' needs a scope decision: two were made at once.');
      if (row.excReview) cflag('\'s approval without a run was decided two ways at once; approve it without a run or withdraw it again, having seen both.');
      if (row.ownerWhy) cflag(': two people assigned it at once; assign it again.');
      if ((x.planReview || []).length) cflag(': two plans for attempt ' + (x.plan ? x.plan.attempt : 1) + ' were made at once; keep one.');
      if ((x.choiceReview || []).length && !(latest.length > 1)) cflag(': two people chose different runs at once; choose again, having seen both.');
      if (!row.required) { row.status = 'removed'; counts.removed++; rows.push(row); return; }
      counts.inScope++;
      if (x.state === 'proposed') counts.proposed++;
      var c = latest.length === 1 ? latest[0] : null, why = '';
      if (c && o.fp) row.fp = o.fp(c);
      if (c && c.ended) {
        if (c.ended.outcome !== 'Completed') why = 'stopped';
        else {
          var st = o.stands ? o.stands(c) : '', res = o.result ? o.result(c) : null, ql = o.qualify ? o.qualify(c, x) : '';
          if (ql) { why = 'unread'; row.unqualified = ql; }
          else if (st || !res || res.conflict) why = 'unread';
          else { row.result = res.value || ''; row.accepted = acc.indexOf(row.result) >= 0; }
        }
      }
      var b = null, name = x.key || x.uid;
      if (row.accepted) { row.status = 'cleared'; counts.cleared++; }
      else if (x.exception) { row.status = 'exception'; counts.exception++; }
      else if (row.competing) { row.status = 'competing'; b = { kind: 'competing', text: choWhy ? name + ': ' + choWhy + '.' : name + ' has ' + latest.length + ' runs started for it. Choose which one counts.' }; }
      else if (!c) { row.status = 'not-started'; counts.notStarted++; b = { kind: 'not-started', text: name + ' hasn\'t started' + (x.owner ? ' · ' + who(x.owner) : '') }; }
      else if (!c.ended) { row.status = 'running'; counts.running++; b = { kind: 'running', text: name + ' is in progress · ' + who(row.recorder) }; }
      else if (why === 'stopped') { row.status = 'stopped'; b = { kind: 'stopped', text: name + '\'s run ended ' + String(c.ended.outcome).toLowerCase() + ' · ' + who(row.recorder) }; }
      else if (why === 'unread') { row.status = 'unread'; b = { kind: 'unread', text: row.unqualified ? name + '\'s run ' + row.unqualified + '. Start a new run for it.' : name + '\'s result can\'t be counted as read. Open its run.' }; }
      else { row.status = 'result'; counts.results[row.result || 'none'] = (counts.results[row.result || 'none'] || 0) + 1; b = { kind: 'result', text: name + ' ' + (row.result ? (row.result === 'needs-work' ? 'needs work' : 'returned ' + words(row.result)) : 'returned no result') + ' · ' + who(row.recorder) }; }
      if (b) { b.key = x.key; b.uid = x.uid; b.run = row.run || (row.runs[0] || ''); blockers.push(b); }
      rows.push(row);
    });
    /* A request's outcome recorded both ways holds approval too, until it is resolved. */
    Object.keys(L.requests || {}).forEach(function (id) { if (L.requests[id].statusReview.length) { counts.review++; blockers.push({ key: '', kind: 'review', record: id, text: 'Request ' + id + ' was recorded both applied and refused at once; resolve it.' }); } });
    var parts = [counts.inScope + ' in scope', counts.cleared + ' cleared by validation'];
    if (counts.exception) parts.push(counts.exception + ' approved without a run');
    Object.keys(counts.results).sort().forEach(function (v) { parts.push(counts.results[v] + ' ' + (v === 'none' ? 'returned no result' : words(v))); });
    if (counts.running) parts.push(counts.running + ' in progress');
    if (counts.notStarted) parts.push(counts.notStarted + ' not started');
    return { items: rows, counts: counts, blockers: blockers, ok: !blockers.length && counts.inScope > 0, empty: counts.inScope === 0 && !blockers.length, summary: parts.join(' · ') };
  }
  /* What an approval of the loop step records (the step's answer): the records it saw, every item with its scope state,
     outcome, result and run, and the counts. o: { by, at, onBehalf }. */
  function approval(L, R, o) {
    return { by: o.by, at: o.at, onBehalf: o.onBehalf || '', request: o.request || undefined, records: (L.applied || []).slice(), summary: R.summary, counts: JSON.parse(JSON.stringify(R.counts)),
      items: R.items.map(function (i) { return { uid: i.uid, key: i.key, state: i.state, status: i.status, result: i.result, run: i.run, fp: i.fp || '', exception: i.exception ? i.exception.record : '' }; }) };
  }
  /* Every relevant change since an approval, in words, all of them (never only the latest): items added, removed or restored
     by records it didn't see, exceptions given or withdrawn, and results that differ. A repeat observation that changes
     nothing stays quiet; an item added and then removed is two changes, so approval never quietly returns. */
  var SAID = { add: ' was added after this approval.', 'accept-removal': ' was removed from scope after this approval.', exclude: ' was removed from scope after this approval.',
    restore: ' was restored to scope after this approval.', exception: ' was approved without a run after this approval.', withdraw: '\'s exception was withdrawn after this approval.' };
  function changes(snap, L, R) {
    var known = Object.create(null), was = Object.create(null), now = Object.create(null), out = [];
    (snap.records || []).forEach(function (id) { known[id] = true; });
    (snap.items || []).forEach(function (i) { was[i.uid] = i; });
    (R.items || []).forEach(function (i) { now[i.uid] = i; });
    L.items.forEach(function (x) {
      var name = x.key || x.uid, a = was[x.uid], b = now[x.uid], said = Object.create(null);
      if (a && b && a.state !== 'removed' && b.required) {
        if (a.result !== b.result) out.push(name + ' now returns ' + (b.result || 'no result') + ' (it was ' + (a.result || 'no result') + ').');
        else if (a.fp && b.fp && a.fp !== b.fp && a.run === b.run) out.push(name + '\'s result was recorded again after this approval.');
        else if (a.run && b.run !== a.run) out.push(name + '\'s result now comes from ' + (b.run ? 'another run (' + b.run + ')' : 'no single run') + '.');
        else if ((a.status === 'cleared' || a.status === 'exception') && b.status !== 'cleared' && b.status !== 'exception' && !a.exception) out.push(name + ' no longer counts as cleared.');
      }
      x.provenance.forEach(function (p) {
        if (known[p.record] || !own(SAID, p.op)) return;
        var t = name + SAID[p.op];
        if (!said[t + p.record]) { said[t + p.record] = true; out.push(t); }
      });
    });
    return out;
  }

  /* One loop of a parent run, as everyone reads it (the app's table, flightdeck loop read, the gate): its records, ledger,
     roll-up, the approval recorded on its step and every change since. o: { records (every scope record read),
     runs (every run read), who }. Never writes. */
  /* Which loop approvals the folder no longer matches, worked out read-only on every read (3.0, review round 2): r._loopStale
     { stepId: [reasons] }, never saved (the run writer leaves _ fields out). PF.run.answered reads it, so the gate and what
     comes next hold in every window and the command line before the recorder's send-back is saved. Ended runs are left as they ended. */
  /* The stories a start-all would start now, and the ones it skips with why: in scope, not started, not approved without a
     run, not waiting on a removal decision, every input filled. The UI's preview and loop start-all show the same list. */
  /* startable() with everything a start needs before it can write: the checklist the loop starts, on its pinned version,
     available here (procOf, as PF.pins.childTarget reads it). The preview, Start all, a start request and the CLI share it. */
  function launchable(r, V, keys, procOf) {
    var S = startable(r, V, keys);
    if (!procOf || !S.start.length) return S;
    var t = PF.pins.childTarget(r, V.step, procOf);
    if (t.pub && !t.legacy) return S;
    var why = String(t.why || 'the checklist this loop starts isn\'t in the folder').replace(/\.$/, '');
    return { start: [], skip: S.skip.concat(S.start.map(function (k) { return { key: k.key, uid: k.uid, why: why }; })) };
  }
  /* Who may have the recorder carry out a request (q: actionsOf()): one kind of action per request; a person in people.json,
     not inactive; and the run's recorder, someone holding one of the loop step's roles, or, to start a story, its owner.
     '' when it may, else why, in words. people: people.json as read. */
  /* A send-back with nothing changed since the approval needs a reason; the button, a request and the CLI ask the same. */
  /* Whether run may be chosen as the one that counts for story key: '' or why. The button and loop choose ask the same. */
  /* Whether record may be chosen as the plan for key's attempt: '' or why. The row and loop plan ask the same. */
  function planWhy(V, key, record) {
    var i = V.rollup.items.filter(function (y) { return y.key === key; })[0];
    if (!i) return key + ' isn\'t in this loop.';
    if (!i.planConflict) return key + '\'s plans aren\'t in conflict, so there is nothing to choose.';
    if (!i.planConflict.options.some(function (o) { return o.record === record; })) return record + ' isn\'t one of ' + key + '\'s ' + i.planConflict.options.length + ' plans in conflict: ' + i.planConflict.options.slice(0, 10).map(function (o) { return o.record; }).join(', ') + (i.planConflict.options.length > 10 ? ' and ' + (i.planConflict.options.length - 10) + ' more (flightdeck loop read lists them all)' : '') + '.';
    return '';
  }
  function choiceWhy(V, key, run) {
    var i = V.rollup.items.filter(function (y) { return y.key === key; })[0];
    if (!i) return key + ' isn\'t in this loop.';
    if (!i.competing) return key + ' isn\'t competing: it has ' + (i.run ? 'one run that counts' : 'no run to choose') + '.';
    if (i.candidates.indexOf(run) < 0) return run + ' isn\'t one of ' + key + '\'s competing runs (' + i.candidates.slice(0, 5).join(', ') + ').';
    return '';
  }
  function sendBackWhy(V, reason, op) {
    if (op !== undefined && op !== 'send-back') return '';
    return V.changes.length || String(reason || '').trim() ? '' : 'Say why it goes back for review: nothing changed since the approval.';
  }
  function requestCheck(r, V, q, people) {
    var kinds = []; q.ops.forEach(function (op) { if (kinds.indexOf(op) < 0) kinds.push(op); });
    if (kinds.length !== 1) return 'This request mixes ' + kinds.slice(0, 4).join(' and ') + '; a request asks for one kind of action.';
    if ((q.actors || []).length > 1) return 'This request names more than one person (' + q.actors.slice(0, 4).join(', ') + '); a request asks for one person.';
    var twice = q.items.filter(function (k, i) { return q.items.indexOf(k) !== i; });
    if (twice.length) return 'This request names ' + twice.slice(0, 5).join(', ') + ' twice; each story is started once per request.';
    var sb = sendBackWhy(V, q.reason, kinds[0]);
    if (sb) return sb;
    var list = PF.people.listOf(people), p = null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === q.as) { p = list[i]; break; }
    if (!q.as || !p) return (q.as || 'The person asking') + ' isn\'t in people.json, so the request can\'t be carried out.';
    if (p.inactive) return (p.name || q.as) + ' is marked inactive in people.json, so the request can\'t be carried out.';
    if (r.recorder && r.recorder.person === q.as) return '';
    var roles = (V.step && V.step.roles) || [];
    if (roles.some(function (ro) { return r.roles && own(r.roles, ro) && r.roles[ro] === q.as; })) return '';
    if (kinds[0] === 'start' && q.items.length && q.items.every(function (k) { var x = V.ledger.items.filter(function (y) { return y.key === k; })[0]; return x && x.owner === q.as; })) return '';
    return (p.name || q.as) + ' can\'t ask for this: only the run\'s recorder' + (roles.length ? ', someone in the step\'s role (' + roles.slice(0, 5).join(', ') + ')' : '') + (kinds[0] === 'start' ? ' or the story\'s owner' : '') + ' can.';
  }
  /* The id of a story's row in a loop's table, so a return from its run lands on it. */
  function rowId(step, key) { var c = function (v) { return String(v || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80); }; return 'loop-row-' + c(step) + '-' + c(key); }
  /* Whether a story that has a run may start a new attempt (the earlier attempts are kept): its run returned a result this
     loop doesn't accept, ended early, or can't stand for it (another version or other inputs: "Start a new run"). */
  function again(i) { return !!i && i.required && !i.exception && i.state !== 'proposed' && (i.status === 'result' || i.status === 'stopped' || (i.status === 'unread' && !!i.unqualified)); }
  function startable(r, V, keys) {
    var start = [], skip = [];
    /* The loop step itself must be open to start runs (its phase open, the run running, not paused): the preview, the
       buttons, a request and each launch ask this same question. */
    var shut = ''; try { shut = PF.run.canStartChild(r, PF.run.mapOf(r), V.step.id); } catch (e) { shut = 'The run\'s checklist can\'t be read.'; }
    V.rollup.items.forEach(function (i) {
      if (keys && keys.indexOf(i.key) < 0) return;
      var x = V.ledger.items.filter(function (y) { return y.uid === i.uid; })[0], name = i.key || i.uid, why = '';
      if (!i.required) why = 'removed from scope';
      else if (i.exception) why = 'approved without a run';
      else if (i.state === 'proposed') why = 'waiting on a removal decision';
      else if (i.runs.length && !again(i)) why = 'already started';
      else if (i.runs.length && !keys) why = 'needs a new attempt; start it on its own';
      else { var g = inputsFor(r, V.fields, x); if (g.missing.length) why = 'needs ' + g.missing.join(', ') + ' first'; }
      if (!why && shut) why = shut.replace(/\.$/, '');
      if (why) skip.push({ key: name, uid: i.uid, why: why }); else start.push({ key: name, uid: i.uid, title: i.title || '', attempt: i.runs.length ? (i.attempt || 1) + 1 : Math.max(1, i.attempt || 1), again: !!i.runs.length });
    });
    return { start: start, skip: skip };
  }
  /* Requests for the recorder (start, approve, send-back) on this loop, each pending, applied or refused, by the decisions on them. */
  function actionsOf(V) {
    var recs = V.records || [];
    return recs.filter(function (q) { return q.type === 'request' && (q.changes || []).some(function (c) { return ACTIONS.indexOf(c.op) >= 0; }); }).map(function (q) {
      /* Only what the causal reducer admitted: a request it holds (it saw a record not readable here) stays held, never carried out;
         its outcome is the settled one, and two recorded at once are neither (review). */
      var A = V.ledger && V.ledger.requests ? V.ledger.requests[q.id] : null, st = !A ? 'held' : A.statusReview.length ? 'review' : A.status ? A.status.op : 'pending';
      var d = A && A.status && st !== 'review' ? recs.filter(function (x) { return x.id === A.status.record; })[0] : null;
      var ch = q.changes.filter(function (c) { return ACTIONS.indexOf(c.op) >= 0; });
      var actors = []; ch.forEach(function (c) { var a = c.as || ''; if (actors.indexOf(a) < 0) actors.push(a); });
      return { id: q.id, actors: actors, record: ch[0].record || '', outcome: ch[0].outcome || '', all: ch.some(function (c) { return c.all === true; }), ops: ch.map(function (c) { return c.op; }), items: ch.filter(function (c) { return c.item; }).map(function (c) { return c.item.key || c.item.id; }), as: ch[0].as || '', reason: ch[0].reason || '',
        by: q.by, status: st, why: d ? d.reason || '' : st === 'held' ? 'It refers to a scope record this computer can\'t read yet.' : st === 'review' ? A.statusReview[0].why : '', decision: d ? d.id : '' };
    });
  }
  function markStale(runs, o) {
    o = o || {};
    (runs || []).forEach(function (r) {
      if (!r || !isMap(r.steps) || r._unrunnable) return;
      var out = null;
      if (!r.ended) Object.keys(r.steps).forEach(function (id) {
        var a = r.steps[id];
        if (!a || a.s !== 'done' || !a.loop) return;
        var V; try { V = view(r, id, { records: o.records, unread: o.unread, runs: runs, procOf: o.procOf }); } catch (e) { V = null; }
        if (!V) return;
        /* Every scope record the approval counted must still be here: one gone (deleted, or not read) holds it too. */
        var have = Object.create(null); (V.records || []).forEach(function (x) { have[x.id] = true; });
        var gone = (a.loop.records || []).filter(function (id) { return !have[id]; });
        var why = V.changes.length ? V.changes.slice() : V.ledger.held.length ? ['A scope record of this loop can\'t be read yet.'] :
          gone.length ? ['A scope record this approval counted is gone from the folder: ' + gone.slice(0, 5).join(', ') + (gone.length > 5 ? ' and ' + (gone.length - 5) + ' more' : '') + '.'] : null;
        if (why) { out = out || Object.create(null); out[id] = why; }
      });
      if (out) r._loopStale = out; else delete r._loopStale;
    });
  }
  /* The loop a scope file names, when it says one plainly; null otherwise. */
  function loopOf(o) { var l = isMap(o) && isMap(o.loop) ? o.loop : null; return l && typeof l.process === 'string' && typeof l.run === 'string' && typeof l.step === 'string' ? { process: l.process, run: l.run, step: l.step } : null; }
  function view(r, stepId, o) {
    o = o || {};
    var map = PF.run.mapOf(r), x = PF.map.findStep(map, stepId);
    if (!x || x.step.type !== 'for.each') return null;
    /* A kind this copy doesn't know has no view: never read as another kind (its run is read-only, PF.publish.unrunnable). */
    if (!kindOf(String(PF.run.fieldsOf(r, x.step).items || '').trim())) return null;
    var f = PF.run.fieldsOf(r, x.step), loop = { process: r.process, run: r.id, step: stepId };
    var L = reduce(recordsFor(o.records, loop), { max: limitOf({ fields: f }), kind: f.items, feed: f.source });
    (o.unread || []).forEach(function (u) {
      if (u.loop && !(u.loop.process === loop.process && u.loop.run === loop.run && u.loop.step === loop.step)) return;
      L.held.push({ record: String(u.file || ''), why: 'unreadable' });
    });
    var kids = (o.runs || []).filter(function (c) { return c && c.parent && c.parent.item && c.parent.process === r.process && c.parent.id === r.id && c.parent.step === stepId; });
    var acc = String(f.accepts || '').split(',').map(function (v) { return v.trim(); }).filter(Boolean);
    var pin0 = r.pins && r.pins.children && own(r.pins.children, stepId) ? r.pins.children[stepId] : null;
    /* A run counts for its item only on the version the loop pinned and with the inputs the loop gives that item now. */
    var qualify = function (c, it) {
      if (pin0) { var pw = o.procOf ? PF.pins.childMatch(pin0, c, o.procOf) : c.folder !== pin0.folder ? 'is on ' + c.folder + ', but this loop is pinned to ' + pin0.folder : ''; if (pw) return pw.replace(/^That \S+ run /, '').replace(/\.$/, ''); }
      var g = inputsFor(r, f, it), want = g.inputs, d = c.details || {}, bad = '';
      /* A detail the loop passes on that this run no longer has: no child can show it was started for the value it needs. */
      if (g.missing.length) return 'was started with ' + g.missing.map(function (m) { return m + ' ' + (own(d, m) && String(d[m]) ? String(d[m]).slice(0, 80) : '(empty)'); }).slice(0, 5).join(', ') + ', but this run\'s ' + g.missing.slice(0, 5).join(', ') + ' is now empty';
      Object.keys(want).some(function (n) { var got = own(d, n) ? String(d[n]) : ''; if (got !== want[n]) { bad = 'was started with ' + n + ' ' + (got || '(empty)') + ', not ' + want[n]; return true; } return false; });
      return bad;
    };
    var fp = function (c) {
      var m; try { m = PF.run.mapOf(c); } catch (e) { return ''; }
      var d = PF.map.resultDef(m), a = d && d.step && c.steps ? c.steps[d.step.id] : null;
      return PF.sha256.hex(JSON.stringify([c.id, c.folder || '', a ? [a.s, a.at || '', a.by || '', a.values && a.values.decision != null ? String(a.values.decision) : ''] : null])).slice(0, 16);
    };
    var ropts = { accepts: acc, result: PF.run.resultOf, stands: PF.run.childCheck, qualify: qualify, fp: fp, who: o.who }, R = rollup(L, kids, ropts);
    var a = r.steps && r.steps[stepId], pin = r.pins && r.pins.children && own(r.pins.children, stepId) ? r.pins.children[stepId] : null;
    var approved = a && a.s === 'done' && a.loop ? a.loop : null;
    var review = a && a.s === 'recheck' && a.values && typeof a.values.changes === 'string' ? a.values.changes.split('\n').filter(Boolean) : [];
    return { loop: loop, kind: kindOf(f.items) ? f.items : 'jira.issue', noun: nounOf(f) || nounOf({ items: f.items }), step: x.step, fields: f, accepts: acc, pin: pin, records: recordsFor(o.records, loop), ropts: ropts, ledger: L, rollup: R, runs: kids, approved: approved,
      /* S1 for an approval already in effect: every unresolved conflict (scope, owner, plan, approval without a run, choice,
         a request's outcome) is a reason it no longer stands, so the run screen, flightdeck run and next (markStale) and the
         recorder's automatic send-back all hold it the same way. */
      changes: approved ? (function () { var out = changes(approved, L, R); R.blockers.forEach(function (b) { if (b.kind === 'review' && out.indexOf(b.text) < 0) out.push(b.text); }); return out; })() : [], review: review, ended: !!r.ended,
      previous: a && a.history ? a.history.filter(function (h) { return h.loop; }).map(function (h) { return h.loop; }) : [] };
  }
  /* The inputs a new item's child starts with, from the loop's pass: line (item:key, item:title, ^detail, a fixed value), and
     the ones it can't fill (a detail that's empty, ? to ask, a team value read only when the child starts). */
  function inputsFor(r, f, it) {
    var inputs = Object.create(null), missing = [];
    PF.links.parse(f.pass, { items: true }).entries.forEach(function (e) {
      var v = e.source === 'item' ? (e.item === 'key' ? it.key : it.title || '') : e.source === 'detail' ? String(r.details && own(r.details, e.from) ? r.details[e.from] || '' : '') : e.source === 'value' ? e.value : '';
      if (String(v).trim()) inputs[e.name] = String(v).slice(0, LIMITS.input); else missing.push(e.name);
    });
    return { inputs: inputs, missing: missing };
  }
  /* What a request would do to a loop as read now (V: view()), without writing: the items it adds, the removals it proposes
     (each with its assessment, if one is open), exclusions and restorations, the children it plans and whether an approval
     would need review. The record is the one that would be written (seen: the records it saw). */
  /* The change a person or a tool asks for, as an intent's value (cleanIntent reads it): op on keys, each found in the loop
     (V: view()) by key; o: { reason, approver, onBehalf, owner }. The app and flightdeck loop ask the same way. */
  function changeOf(V, op, keys, o) {
    o = o || {};
    var find = function (k) { return V.ledger.items.filter(function (i) { return i.key === k; })[0]; };
    return { loop: V.loop, changes: keys.map(function (k) {
      var x = op === 'add' ? null : find(k), c = { op: op, item: x && x.id ? { id: x.id, key: k } : { key: k } };
      /* One item added by hand may bring its title and link (items: item). */
      if (op === 'add' && keys.length === 1) { if (o.title) c.item.title = o.title; if (o.link) c.item.link = o.link; }
      if (o.reason != null && o.reason !== '') c.reason = o.reason;
      if (op === 'exception') { c.approver = o.approver; if (o.onBehalf) c.onBehalf = true; }
      if (op === 'owner') c.owner = o.owner || '';
      if (op === 'plan') { var rp = V.rollup.items.filter(function (i) { return i.key === k; })[0]; c.record = o.record || ''; c.attempt = rp && rp.planConflict ? rp.planConflict.attempt : 1; }
      if (op === 'choose') { var row = V.rollup.items.filter(function (i) { return i.key === k; })[0]; c.run = o.run || ''; c.attempt = row ? Math.max(1, row.attempt || 1) : 1; c.candidates = row ? row.candidates.slice(0, LIMITS.candidates).sort() : []; }
      return c;
    }) };
  }
  function project(r, V, intent, o) {
    o = o || {};
    var heads = V.ledger.heads.slice(), rec = { id: '~new', type: 'request', seen: heads, by: intent.producer ? { tool: intent.producer.name, version: intent.producer.version } : { person: o.by || '' },
      observation: intent.observation, changes: intent.changes, children: [], kind: V.kind };
    var max = limitOf({ fields: V.fields }), A = reduce(V.records.concat([rec]), { max: max, kind: V.kind, feed: V.fields.source }), was = Object.create(null), who = o.who || function (p) { return p || ''; };
    V.ledger.items.forEach(function (x) { was[x.uid] = x; });
    var rows = Object.create(null); V.rollup.items.forEach(function (i) { rows[i.uid] = i; });
    var runs = Object.create(null); V.runs.forEach(function (c) { runs[c.id] = c; });
    var added = [], proposed = [], excluded = [], restored = [], children = [];
    A.items.forEach(function (x) {
      var before = was[x.uid];
      if (!before && x.state !== 'removed') added.push({ uid: x.uid, key: x.key, title: x.title });
      if (x.state === 'proposed' && x.proposal === '~new') {
        var row = rows[x.uid], c = row && row.run ? runs[row.run] : null, p = { uid: x.uid, key: x.key, title: x.title, run: row ? row.run : '', recorder: row ? row.recorder : '', status: row ? row.status : '' };
        if (c && !c.ended) { var m = PF.run.mapOf(c), all = PF.map.steps(m).length, got = Object.keys(c.steps || {}).filter(function (k) { return c.steps[k] && c.steps[k].s !== 'open'; }).length; p.open = true; p.answered = got; p.total = all; p.recorderName = who(p.recorder); }
        proposed.push(p);
      }
      if (before && before.state !== 'removed' && x.state === 'removed') excluded.push({ uid: x.uid, key: x.key });
      if (before && before.state === 'removed' && x.state !== 'removed') restored.push({ uid: x.uid, key: x.key });
    });
    added.forEach(function (it) {
      var x = A.items.filter(function (y) { return y.uid === it.uid; })[0], io = inputsFor(r, V.fields, it);
      children.push({ item: KINDS[V.kind].id ? { id: x.id, key: x.key } : { key: x.key }, attempt: (x.attempt || 0) + 1, inputs: io.inputs, owner: '', missing: io.missing });
    });
    rec.children = children.map(function (k) { return { item: k.item, attempt: k.attempt, inputs: k.inputs, owner: k.owner }; });
    var AR = rollup(A, V.runs, V.ropts), impact = V.approved ? changes(V.approved, A, AR) : [];
    return { loop: V.loop, record: rec, seen: heads, added: added, proposed: proposed, excluded: excluded, restored: restored, children: children,
      impact: { review: impact.length > 0, reasons: impact }, observation: intent.observation, held: V.ledger.held, overLimit: A.overLimit, summary: AR.summary, kind: V.kind, noun: V.noun, feed: V.fields.source || '' };
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  /* The plain-text preview (docs/design.md 44): the summary first, then the source and the folder read, then each story. */
  function previewText(P, o) {
    o = o || {};
    var lines = [(o.title || P.loop.process) + ' — ' + (o.dryRun ? 'preview only; no files written.' : o.already ? 'already requested; nothing written.' : 'request written; no runs started.'), ''];
    var verb = o.dryRun ? 'Would ' : 'Asked to ', parts = [], N = P.noun || KINDS['jira.issue'].noun, jira = !P.kind || P.kind === 'jira.issue';
    if (P.added.length) parts.push('add ' + count(P.added.length, N));
    if (P.proposed.length) parts.push((parts.length ? 'request review of ' : 'request review of ') + plural(P.proposed.length, 'removal', 'removals'));
    if (P.excluded.length) parts.push('remove ' + count(P.excluded.length, N));
    if (P.restored.length) parts.push('restore ' + count(P.restored.length, N));
    lines.push(parts.length ? verb + parts.join(' and ') + '.' : 'No change to scope.');
    var open = P.proposed.filter(function (p) { return p.open; }).length;
    if (open) lines.push(open === 1 ? 'One proposed removal has an assessment in progress.' : open + ' proposed removals have assessments in progress.');
    var ready = P.children.filter(function (k) { return !k.missing.length; }).length, need = Object.create(null);
    P.children.forEach(function (k) { if (k.missing.length) { var w = k.missing.join(' and '); need[w] = (need[w] || 0) + 1; } });
    var needs = Object.keys(need).map(function (w) { return need[w] + (ready || Object.keys(need).length > 1 ? (need[w] === 1 ? ' needs ' : ' need ') : (need[w] === 1 ? ' new assessment needs ' : ' new assessments need ')) + w; });
    if (ready) lines.push(plural(ready, 'new assessment is', 'new assessments are') + ' ready to start' + (needs.length ? '; ' + needs.join('; ') : '') + '.');
    else if (needs.length) lines.push(needs.join('; ') + '.');
    lines.push(o.dryRun ? 'No runs would start.' : 'No runs started.');
    if (P.impact.review) lines.push(o.dryRun ? 'The scope change would require approval review.' : 'The scope change requires approval review.');
    if (P.overLimit) lines.push(count(P.overLimit.count, N) + ' would be in scope; this loop takes at most ' + P.overLimit.max + '. Nothing is cut.');
    lines.push('');
    var ob = P.observation;
    if (ob) lines.push((jira ? 'Jira observation: ' : 'Observation from ' + P.feed + ': ') + ob.fetched + ' of ' + ob.reported + ' reported matches read; ' + (ob.complete ? 'pagination complete.' : 'not complete (' + ob.why + '). Missing ' + N.many + ' can\'t be proposed for removal. Retry the ' + (jira ? 'search' : 'sync') + '.'));
    lines.push('Team-folder read: ' + (o.problems && o.problems.length ? 'partial (' + plural(o.problems.length, 'problem', 'problems') + ').' : 'complete.'));
    var seenAt = ob && ob.observedAt ? ob.observedAt : '';
    if (P.added.length || P.proposed.length || P.excluded.length || P.restored.length) lines.push('');
    P.added.forEach(function (x) { var k = P.children.filter(function (c) { return c.item.key === x.key; })[0]; lines.push(x.key + ' · add' + (x.title ? ' · ' + x.title : '') + (k && k.missing.length ? ' · needs ' + k.missing.join(', ') : '')); });
    P.proposed.forEach(function (x) { lines.push(x.key + ' · proposed removal: not in the complete ' + (jira ? 'search' : 'list from ' + P.feed) + ' observed ' + seenAt + (x.open ? ' · ' + (x.recorderName || x.recorder) + ' is recording · ' + x.answered + ' of ' + x.total + ' steps answered' : x.run ? ' · its assessment ' + x.status : '')); });
    P.excluded.forEach(function (x) { lines.push(x.key + ' · remove from scope'); });
    P.restored.forEach(function (x) { lines.push(x.key + ' · restore to scope'); });
    return lines.join('\n');
  }
  /* A child's item (run.parent.item): { uid, key, attempt }, or null. */
  function itemRef(v) {
    if (!isMap(v) || Object.keys(v).some(function (k) { return k !== 'uid' && k !== 'key' && k !== 'attempt' && k !== 'request'; })) return null;
    if (v.request !== undefined && !(typeof v.request === 'string' && REQ_ID.test(v.request))) return null;
    if (typeof v.uid !== 'string' || !/^[a-z][a-z0-9.-]{0,19}:(key:)?[A-Za-z0-9_-]{1,40}$/.test(v.uid) || typeof v.key !== 'string' || v.key.length > 40 || !whole(v.attempt) || v.attempt < 1 || v.attempt > 999) return null;
    var out = { uid: v.uid, key: v.key, attempt: v.attempt };
    if (v.request) out.request = v.request;
    return out;
  }
  /* An approval as a run file keeps it (a loop step's answer), checked and bounded, or null. */
  function cleanSnapshot(v) {
    if (!isMap(v) || typeof v.by !== 'string' || typeof v.at !== 'string' || typeof v.summary !== 'string' || !Array.isArray(v.records) || !Array.isArray(v.items) || !isMap(v.counts)) return null;
    if (v.records.length > 5000 || !v.records.every(function (x) { return typeof x === 'string' && x.length <= 120; }) || v.items.length > MAX_ITEMS) return null;
    var items = [];
    for (var i = 0; i < v.items.length; i++) {
      var it = v.items[i];
      if (!isMap(it) || ['uid', 'key', 'state', 'status', 'result', 'run', 'exception'].some(function (k) { return typeof it[k] !== 'string' || it[k].length > 120; })) return null;
      var item = { uid: it.uid, key: it.key, state: it.state, status: it.status, result: it.result, run: it.run, exception: it.exception };
      if (typeof it.fp === 'string' && /^[0-9a-f]{0,16}$/.test(it.fp)) item.fp = it.fp;
      items.push(item);
    }
    var counts = JSON.parse(JSON.stringify(v.counts));
    var out = { by: v.by.slice(0, 80), at: v.at.slice(0, 40), onBehalf: typeof v.onBehalf === 'string' ? v.onBehalf.slice(0, 80) : '', records: v.records.slice(), summary: v.summary.slice(0, 300), counts: counts, items: items };
    if (typeof v.request === 'string' && REQ_ID.test(v.request)) out.request = v.request;
    return out;
  }
  var REQ_ID = /^req-[A-Za-z0-9_.-]{1,120}$/;
  /* Whether the recorder already carried out request id on loop step stepId of run r: the approval or the send-back it made
     names it, now or in the step's history. An outcome that couldn't be written is recognized here, never carried out twice. */
  /* Whether a request whose outcome was recorded both ways (status review) may be recorded as outcome, by the effect it left:
     a run it started (runs: the folder's runs), or an approval or send-back that names it. '' or why. The action is never
     carried out again. */
  /* The outcome a resolve request wrote (it names the resolver): the resolution's own durable effect, or ''. */
  function resolvedBy(V, id) {
    var d = (V.records || []).filter(function (x) { return x.type === 'decision' && x.resolver === id; })[0];
    return d ? d.id : '';
  }
  function resolveWhy(r, stepId, q, outcome, runs, records) {
    if (!q || q.status !== 'review') return 'Only a request whose outcome was recorded both ways is resolved; this one is ' + (q ? q.status : 'not in this loop') + '.';
    if (outcome !== 'applied' && outcome !== 'refused') return 'Say whether it was applied or refused.';
    var did = q.ops[0] === 'resolve' ? !!resolvedBy({ records: records }, q.id) : q.ops[0] === 'start' ? (runs || []).some(function (c) { var it = c && c.parent && c.parent.item; return !!it && it.request === q.id && c.parent.process === r.process && c.parent.id === r.id && c.parent.step === stepId; }) : appliedIn(r, stepId, q.id);
    var what = q.ops[0] === 'resolve' ? 'the outcome it recorded' : q.ops[0] === 'start' ? 'a run it started' : q.ops[0] === 'approve' ? 'the approval it asked for' : 'the send-back it asked for';
    if (outcome === 'applied' && !did) return 'It wasn\'t carried out: there is no ' + what + ' here. Resolve it as refused.';
    if (outcome === 'refused' && did) return 'It was carried out: ' + what + ' is here. Resolve it as applied.';
    return '';
  }
  function appliedIn(r, stepId, id) {
    var a = r && isMap(r.steps) && own(r.steps, stepId) ? r.steps[stepId] : null;
    if (!a || !id) return false;
    var names = function (e) { return !!e && ((e.loop && e.loop.request === id) || (e.values && e.values.request === id)); };
    return names(a) || (Array.isArray(a.history) && a.history.some(names));
  }

  /* ---- Scope requests and decisions: files in proposals/, beside plans (docs/design.md 44). ----
     A scope request is flightdeck-plan/3 with the loops feature, so every copy before 3.0 calls it a plan made with a newer
     Flightdeck and never offers it; this copy dispatches it here before the plan reader. A decision is
     flightdeck-plan-status/3, named <request>.status-<writer>-<rev>.json, written once and never changed. */
  var FORMAT = 'flightdeck-plan/3', STATUS = 'flightdeck-plan-status/3', FEATURES = ['loops'];
  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  var PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, RUN = /^[a-z0-9-]{1,40}$/i, STEP = /^[a-z0-9][a-z0-9-]{0,59}$/i, PERSON = /^[A-Za-z0-9_.-]{1,80}$/;
  var REQ = /^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}$/, WRITER = /^[a-z0-9][a-z0-9-]{0,39}$/, REV = /^[0-9a-f]{8}$/, DNAME = /^(req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24})\.status-([a-z0-9][a-z0-9-]{0,39})-([0-9a-f]{8})\.json$/;
  var OPS = ['add', 'exclude', 'restore', 'owner', 'exception', 'withdraw', 'choose', 'plan', 'start', 'approve', 'send-back', 'resolve'], DOPS = ['accept', 'keep', 'applied', 'refused'];
  /* What a tool asks the recorder to do (the CLI asks; the recorder applies): never a change to the list. */
  var ACTIONS = ['start', 'approve', 'send-back', 'resolve'];
  var LIMITS = { bytes: 262144, title: 200, reason: 300, query: 500, generation: 80, errors: 20, error: 200, changes: 500, inputs: 40, input: 240, seen: 2000, candidates: 50 };
  var CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function reserved(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype' || k in Object.prototype; }
  function q(k) { return '"' + String(k).slice(0, 70) + '"'; }
  function sorted(m) { var o = Object.create(null); Object.keys(m).sort().forEach(function (k) { o[k] = m[k]; }); return o; }
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (isMap(v)) { var o = Object.create(null); Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); }); return o; }
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
  /* A link on an item: absolute http or https, at most 2,048 characters, with a host and no spaces, control characters or
     user name. Its own check: mailto:, javascript: and data: are never links here. */
  function httpLink(v) {
    if (typeof v !== 'string' || v.length > 2048 || CONTROL.test(v) || /\s/.test(v)) return false;
    var m = /^https?:\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#][\x21-\x7e]*)?$/.exec(v);
    if (!m || /[<>"'`\\]/.test(v)) return false;
    /* Then parsed: a port is 1 to 65535, and a host of digits and dots is a whole IPv4 address (four parts, 0 to 255, no
       leading zeros), never one a browser would read some other way. */
    if (m[2] != null && (+m[2] < 1 || +m[2] > 65535)) return false;
    if (/^[0-9.]+$/.test(m[1]) && !/^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/.test(m[1])) return false;
    if (typeof URL === 'function') { try { var u = new URL(v); if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return false; } catch (e) { return false; } }
    return true;
  }
  /* Why an observation can't be read into this loop ('' when it can). fields: the step's (items:, source:); last: the loop's
     last observation read ({ record, observation }), whose scope binds the feed's: its site, account and query, for Jira as
     for any feed, so a search of something else never proposes this list's removals. */
  function feedWhy(obs, fields, last) {
    var kind = kindOf(fields && fields.items) ? fields.items : 'jira.issue', src = (obs && obs.source) || {};
    if (kind === 'jira.issue') {
      if (src.system !== 'jira') return 'is an observation from ' + (src.feed ? 'the feed ' + src.feed : 'another source') + ', not from Jira';
    } else {
      if (!fields.source) return 'is an observation, but this loop declares no feed (source:), so its list is kept by hand';
      if (src.feed !== fields.source) return 'is an observation from the feed ' + (src.feed || src.system || 'with no name') + ', but this loop is fed by ' + fields.source;
    }
    var prev = last && last.observation ? last.observation : null, ps = prev && prev.source ? prev.source : null;
    if (!ps) return '';
    var diff = ['site', 'account'].filter(function (k) { return (src[k] || '') !== (ps[k] || ''); });
    if ((obs.query || '') !== (prev.query || '')) diff.push('query');
    return diff.length ? 'is an observation from another scope of ' + (kind === 'jira.issue' ? 'Jira' : 'the feed ' + fields.source) + ' (its ' + diff.join(' and ') + ' differ from ' + last.record + '\'s)' : '';
  }
  /* One item as a source reports it: { id, key, title }, for a kind (jira.issue), or { key, title, link } (item). A Jira id
     may be left out where it isn't known (a key pasted by hand); key never. An item's key is kept exactly as written. */
  function cleanItem(it, errors, where, kind) {
    var K = kindOf(kind || 'jira.issue'), out = { id: '', key: '', title: '' };
    if (!K) { errors.push(where + ' is an item of kind ' + String(kind).slice(0, 40) + ', which this copy of Flightdeck doesn\'t know.'); return null; }
    if (!K.id) {
      out = { key: '', title: '' };
      if (!isMap(it)) { errors.push(where + ' is {"key": "staging", "title": "...", "link": "https://..."}.'); return null; }
      Object.keys(it).forEach(function (k) { if (['key', 'title', 'link'].indexOf(k) < 0) errors.push(where + ' has ' + q(k) + '; an item has key, title and link.'); });
      if (typeof it.key !== 'string' || !K.key.test(it.key)) errors.push(where + ': "key" is 1 to 40 letters, digits, hyphens or underscores, starting with a letter or digit, like staging.');
      else if (reserved(it.key)) errors.push(where + ': "key" ' + q(it.key) + ' is a name Flightdeck keeps for itself; use another.');
      else out.key = it.key;
      var ti = line(it.title, LIMITS.title, where + ' "title"', errors, true); if (ti) out.title = ti;
      if (it.link != null && it.link !== '') { if (!httpLink(it.link)) errors.push(where + ': "link" is an http or https address of at most 2,048 characters, like https://example.com/.'); else out.link = it.link; }
      return out;
    }
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
  function cleanObservation(o, errors, kind) {
    var K = kindOf(kind || 'jira.issue');
    if (!K) { errors.push('The observation is for items of kind ' + String(kind).slice(0, 40) + ', which this copy of Flightdeck doesn\'t know.'); return null; }
    if (!isMap(o)) { errors.push('The observation is a JSON object with source, generation, query, observedAt, items, reported, fetched, complete and errors.'); return null; }
    var KEYS = ['source', 'generation', 'query', 'observedAt', 'items', 'reported', 'fetched', 'complete', 'errors'];
    Object.keys(o).forEach(function (k) { if (KEYS.indexOf(k) < 0) errors.push('The observation has ' + q(k) + ', which an observation doesn\'t have. It has: ' + KEYS.join(', ') + '.'); });
    var out = { source: { system: 'jira' }, generation: '', query: '', observedAt: '', items: [], reported: 0, fetched: 0, complete: false, errors: [] };
    if (!K.id) {
      if (!isMap(o.source) || typeof o.source.feed !== 'string' || !FEED.test(o.source.feed) || Object.keys(o.source).some(function (k) { return k !== 'feed' && k !== 'site' && k !== 'account'; })) errors.push('"source" is {"feed": "<the loop\'s source: id>", "site": "...", "account": "..."} (site and account when the feed has them).');
      else { out.source = { feed: o.source.feed }; ['site', 'account'].forEach(function (k) { if (o.source[k] != null) { var sv = line(o.source[k], 200, '"source" ' + k, errors); if (sv) out.source[k] = sv; } }); }
    } else if (!isMap(o.source) || o.source.system !== 'jira' || Object.keys(o.source).some(function (k) { return k !== 'system' && k !== 'site'; })) errors.push('"source" is {"system": "jira", "site": "<its address>"}.');
    else { out.source = { system: 'jira' }; if (o.source.site != null) { var st = line(o.source.site, 200, '"source" site', errors); if (st) out.source.site = st; } }
    var g = line(o.generation, LIMITS.generation, '"generation"', errors); if (g) out.generation = g;
    var qy = line(o.query, LIMITS.query, '"query"', errors, !K.id); if (qy) out.query = qy;
    if (typeof o.observedAt !== 'string' || !ISO.test(o.observedAt) || isNaN(Date.parse(o.observedAt))) errors.push('"observedAt" is a date and time with its zone, like 2026-11-07T09:42:00Z.');
    else out.observedAt = new Date(Date.parse(o.observedAt)).toISOString();
    if (!whole(o.reported)) errors.push(q('reported') + ' is a whole number.'); else out.reported = o.reported;
    if (!whole(o.fetched)) errors.push(q('fetched') + ' is a whole number.'); else out.fetched = o.fetched;
    if (typeof o.complete !== 'boolean') errors.push('"complete" is true or false: whether every page of the search was read.');
    if (!Array.isArray(o.errors) || o.errors.length > LIMITS.errors) errors.push('"errors" is a list of at most ' + LIMITS.errors + ' messages ([] when none).');
    else o.errors.forEach(function (e, i) { var t = line(e, LIMITS.error, '"errors" ' + (i + 1), errors); if (t) out.errors.push(t); });
    if (!Array.isArray(o.items)) errors.push('"items" is a list of the items found.');
    else if (o.items.length > MAX_ITEMS) errors.push('An observation holds at most ' + MAX_ITEMS + ' items; this one has ' + o.items.length + '. Nothing is cut: narrow the search or raise max: within the limit.');
    else {
      var keys = Object.create(null), ids = Object.create(null);
      o.items.forEach(function (it, i) {
        var c = cleanItem(it, errors, 'Item ' + (i + 1), kind);
        if (!c) return;
        if (K.id && !c.id) errors.push('Item ' + (i + 1) + ': an observation gives each issue\'s "id".');
        if (keys[c.key] || (c.id && ids[c.id])) { errors.push('Item ' + (i + 1) + ' (' + c.key + ') is listed twice.'); return; }
        keys[c.key] = true; if (c.id) ids[c.id] = true;
        out.items.push(c);
      });
    }
    out.complete = o.complete === true;
    if (out.complete) {
      /* Complete means every reported item was read and listed: items, fetched and reported all agree, with no errors. */
      var why = out.errors.length ? 'the search reported errors' : out.fetched < out.reported ? 'it read ' + out.fetched + ' of ' + out.reported + ' reported matches' :
        out.fetched > out.reported ? 'it says it read ' + out.fetched + ' but only ' + out.reported + ' were reported' :
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
  function cleanChanges(list, errors, kind) {
    var out = [], added = Object.create(null);
    if (list == null) return out;
    if (!Array.isArray(list) || list.length > LIMITS.changes) { errors.push('"changes" is a list of at most ' + LIMITS.changes + ' changes.'); return out; }
    list.forEach(function (ch, i) {
      var where = 'Change ' + (i + 1);
      if (!isMap(ch) || OPS.indexOf(ch.op) < 0) { errors.push(where + ' is {"op": ' + OPS.map(q).join(' | ') + ', "item": {...}}.'); return; }
      Object.keys(ch).forEach(function (k) { if (['op', 'item', 'reason', 'owner', 'approver', 'onBehalf', 'as', 'all', 'run', 'attempt', 'candidates', 'record', 'outcome'].indexOf(k) < 0 || (k === 'all' && !(ch.op === 'start' && ch.all === true)) || ((k === 'run' || k === 'candidates') && ch.op !== 'choose') || (k === 'attempt' && ch.op !== 'choose' && ch.op !== 'plan') || (k === 'record' && ch.op !== 'plan' && ch.op !== 'resolve') || (k === 'outcome' && ch.op !== 'resolve')) errors.push(where + ' has ' + q(k) + '.'); });
      if (ACTIONS.indexOf(ch.op) >= 0) {
        var ca = { op: ch.op };
        if (ch.op === 'start') { ca.item = cleanItem(ch.item, errors, where + ' item', kind); if (!ca.item) return; if (ch.all === true) ca.all = true; }
        else if (ch.item != null) errors.push(where + ': ' + q(ch.op) + ' names no item.');
        if (ch.op === 'resolve') {
          if (typeof ch.record !== 'string' || !REQ.test(ch.record)) errors.push(where + ': "record" is the id of the request whose outcome was recorded two ways.'); else ca.record = ch.record;
          if (ch.outcome !== 'applied' && ch.outcome !== 'refused') errors.push(where + ': "outcome" is "applied" or "refused": what happened.'); else ca.outcome = ch.outcome;
        }
        if (typeof ch.as !== 'string' || !PERSON.test(ch.as)) errors.push(where + ': "as" is the ID from people.json of the person who asks.'); else ca.as = ch.as;
        if (ch.reason != null) { var ra = line(ch.reason, LIMITS.reason, where + ' "reason"', errors, true); if (ra) ca.reason = ra; }
        out.push(ca); return;
      }
      var it = cleanItem(ch.item, errors, where + ' item', kind), c = { op: ch.op, item: it };
      if (!it) return;
      if (ch.op === 'add' && it.key) { if (added[it.key]) { errors.push(where + ' adds ' + it.key + ' again; each item is added once.'); return; } added[it.key] = true; }
      if (ch.op === 'exclude' || ch.op === 'exception') { var r = line(ch.reason, LIMITS.reason, where + ' "reason"', errors); if (r) c.reason = r; }
      else if (ch.reason != null) { var r2 = line(ch.reason, LIMITS.reason, where + ' "reason"', errors, true); if (r2) c.reason = r2; }
      if (ch.op === 'plan') {
        if (!whole(ch.attempt) || ch.attempt < 1 || ch.attempt > 999) errors.push(where + ': "attempt" is the attempt the plans are for.'); else c.attempt = ch.attempt;
        if (typeof ch.record !== 'string' || !REQ.test(ch.record)) errors.push(where + ': "record" is the id of the plan chosen.'); else c.record = ch.record;
      }
      if (ch.op === 'choose') {
        if (typeof ch.run !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(ch.run)) errors.push(where + ': "run" is the id of the story\'s run that counts.'); else c.run = ch.run;
        if (!whole(ch.attempt) || ch.attempt < 1 || ch.attempt > 999) errors.push(where + ': "attempt" is the attempt the runs were started for.'); else c.attempt = ch.attempt;
        if (!Array.isArray(ch.candidates) || ch.candidates.length < 2 || ch.candidates.length > LIMITS.candidates || !ch.candidates.every(function (v) { return typeof v === 'string' && /^[a-z0-9-]{1,40}$/i.test(v); })) errors.push(where + ': "candidates" are the ids of the competing runs it chose among (2 to ' + LIMITS.candidates + ').'); else c.candidates = ch.candidates.slice().sort();
      }
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
  function cleanIntent(v, key, producer, kind) {
    var errors = [];
    if (!isMap(v)) return { intent: null, errors: ['A scope request is {"loop": {...}, "observation": {...}, "changes": [...]}.'] };
    Object.keys(v).forEach(function (k) { if (['loop', 'observation', 'changes'].indexOf(k) < 0) errors.push('The request has ' + q(k) + '. It can have: loop, observation, changes.'); });
    var intent = { key: key, producer: producer || null, loop: cleanLoop(v.loop, errors), observation: v.observation == null ? null : cleanObservation(v.observation, errors, kind), changes: cleanChanges(v.changes, errors, kind) };
    if (kind && kind !== 'jira.issue') intent.kind = kind;
    if (!intent.observation && !intent.changes.length) errors.push('The request has no observation and no changes, so it asks for nothing.');
    return { intent: intent, errors: errors };
  }
  /* The canonical intent: what's compared on a retry. The tool's version and Flightdeck's own additions (seen, children,
     the time it was written) are never part of it, so the original stands. */
  /* An observation as written: why is derived again when it's read. */
  function wire(obs) { if (!obs) return null; var o = Object.create(null); Object.keys(obs).forEach(function (k) { if (k !== 'why') o[k] = obs[k]; }); return o; }
  function canonical(intent) { return canon({ loop: intent.loop, producer: intent.producer ? intent.producer.name : null, observation: wire(intent.observation), changes: intent.changes }); }
  function differs(intent, file) {
    if (!isMap(file) || file.format !== FORMAT) return ['kind'];
    var a = canonical(intent), b = canon({ loop: file.loop, producer: file.producer ? file.producer.name : null, observation: wire(file.observation || null), changes: file.changes || [] }), out = [];
    ['producer', 'loop', 'observation', 'changes'].forEach(function (k) { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k === 'producer' ? 'tool' : k); });
    return out;
  }
  /* The file written. o: { seen (the records it saw), children (planned child intents), now, app, by (a person, when no tool), id }. */
  function buildRequest(intent, o) {
    var tool = intent.producer, f = { format: FORMAT, features: FEATURES.slice() };
    if (PF.envelope.semver(o.app)) f.app = o.app;
    f.id = o.id || idFor(tool.name, intent.key);
    f.loop = intent.loop;
    if (intent.kind && intent.kind !== 'jira.issue') f.kind = intent.kind;
    if (tool) { f.producer = { name: tool.name, version: tool.version }; f.key = intent.key; f.by = tool.name + ' ' + tool.version + ' (a tool)'; }
    else f.by = o.by;
    f.created = o.now;
    f.seen = (o.seen || []).slice().sort();
    f.observation = wire(intent.observation);
    f.changes = intent.changes;
    f.children = (o.children || []).map(function (k) { return { item: intent.kind && intent.kind !== 'jira.issue' ? { key: k.item.key } : { id: k.item.id || '', key: k.item.key }, attempt: k.attempt, inputs: sorted(k.inputs || {}), owner: k.owner || '' }; });
    return f;
  }
  /* The same, against a request as the folder reader cleaned it. */
  function differsRecord(intent, rec) { return differs(intent, { format: FORMAT, loop: rec.loop, producer: rec.by && rec.by.tool ? { name: rec.by.tool } : null, observation: rec.observation, changes: rec.changes }); }
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
    /* The kind of item it's about (jira.issue when it doesn't say): one this copy doesn't know is refused, never read as another. */
    if (o.kind != null && !kindOf(o.kind)) return mal('is a scope request for items of kind ' + JSON.stringify(String(o.kind).slice(0, 40)) + ', which this copy of Flightdeck doesn\'t know');
    var kind = o.kind == null ? 'jira.issue' : o.kind;
    var loop = cleanLoop(o.loop, errors), obs = o.observation == null ? null : cleanObservation(o.observation, errors, kind), changes = cleanChanges(o.changes, errors, kind);
    if (!Array.isArray(o.seen) || o.seen.length > LIMITS.seen || !o.seen.every(function (x) { return typeof x === 'string' && (REQ.test(x) || DNAME.test(x + '.json')); })) errors.push('its seen isn\'t a list of scope records');
    var children = [];
    if (!Array.isArray(o.children)) errors.push('its children isn\'t a list');
    else o.children.forEach(function (k, i) {
      var it = isMap(k) ? cleanItem(k.item, errors, 'child ' + (i + 1), kind) : null;
      if (!it || !whole(k.attempt) || k.attempt < 1 || !isMap(k.inputs) || Object.keys(k.inputs).length > LIMITS.inputs || Object.keys(k.inputs).some(function (n) { return reserved(n) || typeof k.inputs[n] !== 'string' || k.inputs[n].length > LIMITS.input; }) || (k.owner !== '' && !PERSON.test(String(k.owner)))) { errors.push('child ' + (i + 1) + ' isn\'t a planned child'); return; }
      children.push({ item: it, attempt: k.attempt, inputs: k.inputs, owner: k.owner });
    });
    if (errors.length) return mal('is a scope request that isn\'t in its format: ' + errors[0]);
    return { ok: true, record: { id: o.id, type: 'request', kind: kind, loop: loop, seen: o.seen.slice(), by: byOf(o), observation: obs, changes: changes, children: children, created: typeof o.created === 'string' ? o.created : '', key: typeof o.key === 'string' ? o.key : '' } };
  }
  /* A decision on a scope request's proposed removals: accept (remove them) or keep. Its id is its file stem. */
  function buildDecision(d) {
    var name = d.proposal + '.status-' + d.writer + '-' + d.rev + '.json', f = { format: STATUS, features: FEATURES.slice() };
    if (PF.envelope.semver(d.app)) f.app = d.app;
    f.proposal = d.proposal; f.loop = d.loop; f.op = d.op; f.items = d.items.slice(); f.seen = d.seen.slice().sort(); if (d.reason) f.reason = d.reason;
    f.by = d.by; if (d.onBehalf) f.onBehalf = d.onBehalf; if (d.resolver) f.resolver = d.resolver; f.at = d.now;
    return { name: name, file: f };
  }
  function cleanDecision(o, name) {
    var bad = verdictOf(o, 'flightdeck-plan-status');
    if (bad) return bad;
    var m = DNAME.exec(String(name || '')), errors = [], mal = function (why) { return { ok: false, kind: 'malformed', why: why, needs: '' }; };
    if (!m || m[1] !== o.proposal) return mal('is a scope decision whose name doesn\'t say its request');
    var loop = cleanLoop(o.loop, errors);
    if (DOPS.indexOf(o.op) < 0) return mal('is a scope decision that isn\'t accept, keep, applied or refused');
    if (!Array.isArray(o.items) || (!o.items.length && (o.op === 'accept' || o.op === 'keep')) || o.items.length > MAX_ITEMS || !o.items.every(function (x) { return typeof x === 'string' && x.length <= 80; })) return mal('is a scope decision without its items');
    if (!Array.isArray(o.seen) || o.seen.length > LIMITS.seen || !o.seen.every(function (x) { return typeof x === 'string'; })) return mal('is a scope decision without what it saw (its seen is at most ' + LIMITS.seen + ' records)');
    if (typeof o.by !== 'string' || !PERSON.test(o.by)) return mal('is a scope decision without who made it');
    if (o.resolver != null && (typeof o.resolver !== 'string' || !REQ.test(o.resolver))) errors.push('its resolver isn\'t a request id');
    if (errors.length) return mal('is a scope decision that isn\'t in its format: ' + errors[0]);
    return { ok: true, record: { resolver: typeof o.resolver === 'string' ? o.resolver : '', id: name.slice(0, -5), type: 'decision', loop: loop, proposal: o.proposal, op: o.op, items: o.items.slice(), seen: o.seen.slice(), reason: typeof o.reason === 'string' ? o.reason.slice(0, LIMITS.reason) : '', by: { person: o.by }, onBehalf: typeof o.onBehalf === 'string' ? o.onBehalf : '' } };
  }
  /* Why a scope record just built can't be filed ('' when it can): the reader's own check, on the bytes as they'd be
     written, so no writer files what every reader would refuse (one frontier limit, LIMITS.seen, for both). */
  function fileWhy(name, f) {
    var t = text(f);
    if (t.length > LIMITS.bytes) return 'It would be ' + t.length + ' bytes; a scope record is at most ' + LIMITS.bytes + '.';
    if (Array.isArray(f.seen) && f.seen.length > LIMITS.seen) return 'It would name ' + f.seen.length + ' records it saw (seen); a scope record names at most ' + LIMITS.seen + '. Resolve some of the loop\'s open decisions first.';
    var v = cleanFile(JSON.parse(t), name);
    return v.ok ? '' : 'It wouldn\'t read back: it ' + v.why + '.';
  }
  /* A file of either kind, as the folder reader dispatches it before the plan reader. */
  function cleanFile(o, name) { return o.format === STATUS ? cleanDecision(o, name) : cleanRequest(o, name); }
  /* The records about one loop instance. */
  function recordsFor(records, loop) { return (records || []).filter(function (r) { return r.loop && r.loop.process === loop.process && r.loop.run === loop.run && r.loop.step === loop.step; }); }

  return { fileWhy: fileWhy, KINDS: KINDS, kindOf: kindOf, nounOf: nounOf, count: count, feedWhy: feedWhy, httpLink: httpLink, cleanItem: cleanItem, cleanChanges: cleanChanges, FEED: FEED, NOUN: NOUN, MAX_ITEMS: MAX_ITEMS, DEFAULT_MAX: DEFAULT_MAX, LIMITS: LIMITS, FORMAT: FORMAT, STATUS: STATUS, OPS: OPS, maxOf: maxOf, limitOf: limitOf, uidOf: uidOf, causal: causal, reduce: reduce,
    idFor: idFor, isScope: isScope, differsRecord: differsRecord, cleanObservation: cleanObservation, cleanIntent: cleanIntent, canonical: canonical, differs: differs, buildRequest: buildRequest, text: text,
    rollup: rollup, view: view, markStale: markStale, rowId: rowId, choiceWhy: choiceWhy, resolveWhy: resolveWhy, resolvedBy: resolvedBy, planWhy: planWhy, sendBackWhy: sendBackWhy, again: again, appliedIn: appliedIn, requestCheck: requestCheck, launchable: launchable, startable: startable, actionsOf: actionsOf, ACTIONS: ACTIONS, loopOf: loopOf, project: project, changeOf: changeOf, previewText: previewText, inputsFor: inputsFor, approval: approval, changes: changes, itemRef: itemRef, cleanSnapshot: cleanSnapshot, cleanRequest: cleanRequest, buildDecision: buildDecision, cleanDecision: cleanDecision, cleanFile: cleanFile, recordsFor: recordsFor };
})();
