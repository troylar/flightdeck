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
    return { items: items, held: c.held, duplicates: duplicates, heads: heads, observation: lastObs, applied: c.order.map(function (r) { return r.id; }),
      pending: items.filter(function (x) { return x.state === 'proposed'; }).map(function (x) { return { uid: x.uid, key: x.key, proposal: x.proposal }; }),
      overLimit: inScope > max ? { count: inScope, max: max } : null };
  }

  /* ---- The gate's roll-up: every item in scope has an accepted result or an approved exception. Pure. ----
     L: reduce()'s ledger. runs: the loop's child runs (each names parent.item { uid, key, attempt }). o: { accepts, result(run)
     -> { value, conflict } (PF.run.resultOf), stands(run) -> '' or why its completion doesn't stand (PF.run.childCheck),
     who(person id) -> a name }. Scope, outcome and exception stay apart: an exception never makes a result "cleared". */
  function words(v) { return String(v || '').replace(/-/g, ' '); }
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
    var rows = [], counts = { inScope: 0, cleared: 0, exception: 0, results: {}, running: 0, notStarted: 0, removed: 0, review: 0, proposed: 0 }, blockers = [];
    (L.held || []).forEach(function (h) { blockers.push({ key: '', kind: 'held', record: h.record, text: h.why === 'copies' ? 'Two different copies of scope record ' + h.record + ' are in the folder.' : 'A scope record (' + h.record + ') refers to one this computer can\'t read yet.' }); });
    if (L.overLimit) blockers.push({ key: '', kind: 'limit', text: L.overLimit.count + ' items are in scope; this loop takes at most ' + L.overLimit.max + '. Nothing was cut: remove items or raise max:.' });
    L.items.forEach(function (x) {
      var mine = (byItem[x.uid] || (x.key ? keyed[x.key] : null) || []).slice(), top = 0;
      mine.forEach(function (c) { var a = +c.parent.item.attempt || 1; if (a > top) top = a; });
      var latest = mine.filter(function (c) { return (+c.parent.item.attempt || 1) === top; });
      var row = { uid: x.uid, key: x.key, title: x.title, state: x.state, required: x.state !== 'removed', owner: x.owner, exception: x.exception, review: x.review.length > 0, mismatch: x.mismatch,
        runs: mine.map(function (c) { return c.id; }), run: latest.length === 1 ? latest[0].id : '', competing: latest.length > 1, recorder: latest.length === 1 && latest[0].recorder ? latest[0].recorder.person || '' : '',
        result: '', accepted: false, status: '', planned: x.planned, attempt: Math.max(top, x.attempt) };
      if (!row.required) { row.status = 'removed'; counts.removed++; rows.push(row); return; }
      counts.inScope++;
      if (x.state === 'proposed') counts.proposed++;
      var c = latest.length === 1 ? latest[0] : null, why = '';
      if (c && c.ended) {
        if (c.ended.outcome !== 'Completed') why = 'stopped';
        else {
          var st = o.stands ? o.stands(c) : '', res = o.result ? o.result(c) : null;
          if (st || !res || res.conflict) why = 'unread';
          else { row.result = res.value || ''; row.accepted = acc.indexOf(row.result) >= 0; }
        }
      }
      var b = null, name = x.key || x.uid;
      if (row.accepted) { row.status = 'cleared'; counts.cleared++; }
      else if (x.exception) { row.status = 'exception'; counts.exception++; }
      else if (row.competing) { row.status = 'competing'; b = { kind: 'competing', text: name + ' has ' + latest.length + ' runs started for it. Choose which one counts.' }; }
      else if (!c) { row.status = 'not-started'; counts.notStarted++; b = { kind: 'not-started', text: name + ' hasn\'t started' + (x.owner ? ' · ' + who(x.owner) : '') }; }
      else if (!c.ended) { row.status = 'running'; counts.running++; b = { kind: 'running', text: name + ' is in progress · ' + who(row.recorder) }; }
      else if (why === 'stopped') { row.status = 'stopped'; b = { kind: 'stopped', text: name + '\'s run ended ' + String(c.ended.outcome).toLowerCase() + ' · ' + who(row.recorder) }; }
      else if (why === 'unread') { row.status = 'unread'; b = { kind: 'unread', text: name + '\'s result can\'t be counted as read. Open its run.' }; }
      else { row.status = 'result'; counts.results[row.result || 'none'] = (counts.results[row.result || 'none'] || 0) + 1; b = { kind: 'result', text: name + ' ' + (row.result ? (row.result === 'needs-work' ? 'needs work' : 'returned ' + words(row.result)) : 'returned no result') + ' · ' + who(row.recorder) }; }
      if (row.review) { counts.review++; blockers.push({ key: x.key, uid: x.uid, kind: 'review', run: row.run, text: name + ' needs a scope decision: two were made at once.' }); }
      if (b) { b.key = x.key; b.uid = x.uid; b.run = row.run || (row.runs[0] || ''); blockers.push(b); }
      rows.push(row);
    });
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
    return { by: o.by, at: o.at, onBehalf: o.onBehalf || '', records: (L.applied || []).slice(), summary: R.summary, counts: JSON.parse(JSON.stringify(R.counts)),
      items: R.items.map(function (i) { return { uid: i.uid, key: i.key, state: i.state, status: i.status, result: i.result, run: i.run, exception: i.exception ? i.exception.record : '' }; }) };
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
  function view(r, stepId, o) {
    o = o || {};
    var map = PF.run.mapOf(r), x = PF.map.findStep(map, stepId);
    if (!x || x.step.type !== 'for.each') return null;
    var f = PF.run.fieldsOf(r, x.step), loop = { process: r.process, run: r.id, step: stepId };
    var L = reduce(recordsFor(o.records, loop), { max: limitOf({ fields: f }) });
    var kids = (o.runs || []).filter(function (c) { return c && c.parent && c.parent.item && c.parent.process === r.process && c.parent.id === r.id && c.parent.step === stepId; });
    var acc = String(f.accepts || '').split(',').map(function (v) { return v.trim(); }).filter(Boolean);
    var ropts = { accepts: acc, result: PF.run.resultOf, stands: PF.run.childCheck, who: o.who }, R = rollup(L, kids, ropts);
    var a = r.steps && r.steps[stepId], pin = r.pins && r.pins.children && own(r.pins.children, stepId) ? r.pins.children[stepId] : null;
    var approved = a && a.s === 'done' && a.loop ? a.loop : null;
    var review = a && a.s === 'recheck' && a.values && typeof a.values.changes === 'string' ? a.values.changes.split('\n').filter(Boolean) : [];
    return { loop: loop, step: x.step, fields: f, accepts: acc, pin: pin, records: recordsFor(o.records, loop), ropts: ropts, ledger: L, rollup: R, runs: kids, approved: approved,
      changes: approved ? changes(approved, L, R) : [], review: review, ended: !!r.ended,
      previous: a && a.history ? a.history.filter(function (h) { return h.loop; }).map(function (h) { return h.loop; }) : [] };
  }
  /* The inputs a new item's child starts with, from the loop's pass: line (item:key, item:title, ^detail, a fixed value), and
     the ones it can't fill (a detail that's empty, ? to ask, a team value read only when the child starts). */
  function inputsFor(r, f, it) {
    var inputs = {}, missing = [];
    PF.links.parse(f.pass, { items: true }).entries.forEach(function (e) {
      var v = e.source === 'item' ? (e.item === 'key' ? it.key : it.title || '') : e.source === 'detail' ? String((r.details || {})[e.from] || '') : e.source === 'value' ? e.value : '';
      if (String(v).trim()) inputs[e.name] = String(v).slice(0, LIMITS.input); else missing.push(e.name);
    });
    return { inputs: inputs, missing: missing };
  }
  /* What a request would do to a loop as read now (V: view()), without writing: the items it adds, the removals it proposes
     (each with its assessment, if one is open), exclusions and restorations, the children it plans and whether an approval
     would need review. The record is the one that would be written (seen: the records it saw). */
  function project(r, V, intent, o) {
    o = o || {};
    var heads = V.ledger.heads.slice(), rec = { id: '~new', type: 'request', seen: heads, by: intent.producer ? { tool: intent.producer.name, version: intent.producer.version } : { person: o.by || '' },
      observation: intent.observation, changes: intent.changes, children: [] };
    var max = limitOf({ fields: V.fields }), A = reduce(V.records.concat([rec]), { max: max }), was = Object.create(null), who = o.who || function (p) { return p || ''; };
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
      children.push({ item: { id: x.id, key: x.key }, attempt: (x.attempt || 0) + 1, inputs: io.inputs, owner: '', missing: io.missing });
    });
    rec.children = children.map(function (k) { return { item: k.item, attempt: k.attempt, inputs: k.inputs, owner: k.owner }; });
    var AR = rollup(A, V.runs, V.ropts), impact = V.approved ? changes(V.approved, A, AR) : [];
    return { loop: V.loop, record: rec, seen: heads, added: added, proposed: proposed, excluded: excluded, restored: restored, children: children,
      impact: { review: impact.length > 0, reasons: impact }, observation: intent.observation, held: V.ledger.held, overLimit: A.overLimit, summary: AR.summary };
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  /* The plain-text preview (docs/design.md 44): the summary first, then the source and the folder read, then each story. */
  function previewText(P, o) {
    o = o || {};
    var lines = [(o.title || P.loop.process) + ' — ' + (o.dryRun ? 'preview only; no files written.' : o.already ? 'already requested; nothing written.' : 'request written; no runs started.'), ''];
    var verb = o.dryRun ? 'Would ' : 'Asked to ', parts = [];
    if (P.added.length) parts.push('add ' + plural(P.added.length, 'story', 'stories'));
    if (P.proposed.length) parts.push((parts.length ? 'request review of ' : 'request review of ') + plural(P.proposed.length, 'removal', 'removals'));
    if (P.excluded.length) parts.push('remove ' + plural(P.excluded.length, 'story', 'stories'));
    if (P.restored.length) parts.push('restore ' + plural(P.restored.length, 'story', 'stories'));
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
    if (P.overLimit) lines.push(P.overLimit.count + ' stories would be in scope; this loop takes at most ' + P.overLimit.max + '. Nothing is cut.');
    lines.push('');
    var ob = P.observation;
    if (ob) lines.push('Jira observation: ' + ob.fetched + ' of ' + ob.reported + ' reported matches read; ' + (ob.complete ? 'pagination complete.' : 'not complete (' + ob.why + '). Missing stories can\'t be proposed for removal. Retry the search.'));
    lines.push('Team-folder read: ' + (o.problems && o.problems.length ? 'partial (' + plural(o.problems.length, 'problem', 'problems') + ').' : 'complete.'));
    var seenAt = ob && ob.observedAt ? ob.observedAt : '';
    if (P.added.length || P.proposed.length || P.excluded.length || P.restored.length) lines.push('');
    P.added.forEach(function (x) { var k = P.children.filter(function (c) { return c.item.key === x.key; })[0]; lines.push(x.key + ' · add' + (x.title ? ' · ' + x.title : '') + (k && k.missing.length ? ' · needs ' + k.missing.join(', ') : '')); });
    P.proposed.forEach(function (x) { lines.push(x.key + ' · proposed removal: not in the complete search observed ' + seenAt + (x.open ? ' · ' + (x.recorderName || x.recorder) + ' is recording · ' + x.answered + ' of ' + x.total + ' steps answered' : x.run ? ' · its assessment ' + x.status : '')); });
    P.excluded.forEach(function (x) { lines.push(x.key + ' · remove from scope'); });
    P.restored.forEach(function (x) { lines.push(x.key + ' · restore to scope'); });
    return lines.join('\n');
  }
  /* A child's item (run.parent.item): { uid, key, attempt }, or null. */
  function itemRef(v) {
    if (!isMap(v) || Object.keys(v).some(function (k) { return k !== 'uid' && k !== 'key' && k !== 'attempt'; })) return null;
    if (typeof v.uid !== 'string' || !/^[a-z][a-z0-9.-]{0,19}:(key:)?[A-Za-z0-9_-]{1,40}$/.test(v.uid) || typeof v.key !== 'string' || v.key.length > 40 || !whole(v.attempt) || v.attempt < 1 || v.attempt > 999) return null;
    return { uid: v.uid, key: v.key, attempt: v.attempt };
  }
  /* An approval as a run file keeps it (a loop step's answer), checked and bounded, or null. */
  function cleanSnapshot(v) {
    if (!isMap(v) || typeof v.by !== 'string' || typeof v.at !== 'string' || typeof v.summary !== 'string' || !Array.isArray(v.records) || !Array.isArray(v.items) || !isMap(v.counts)) return null;
    if (v.records.length > 5000 || !v.records.every(function (x) { return typeof x === 'string' && x.length <= 120; }) || v.items.length > MAX_ITEMS) return null;
    var items = [];
    for (var i = 0; i < v.items.length; i++) {
      var it = v.items[i];
      if (!isMap(it) || ['uid', 'key', 'state', 'status', 'result', 'run', 'exception'].some(function (k) { return typeof it[k] !== 'string' || it[k].length > 120; })) return null;
      items.push({ uid: it.uid, key: it.key, state: it.state, status: it.status, result: it.result, run: it.run, exception: it.exception });
    }
    var counts = JSON.parse(JSON.stringify(v.counts));
    return { by: v.by.slice(0, 80), at: v.at.slice(0, 40), onBehalf: typeof v.onBehalf === 'string' ? v.onBehalf.slice(0, 80) : '', records: v.records.slice(), summary: v.summary.slice(0, 300), counts: counts, items: items };
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
  /* An observation as written: why is derived again when it's read. */
  function wire(obs) { if (!obs) return null; var o = {}; Object.keys(obs).forEach(function (k) { if (k !== 'why') o[k] = obs[k]; }); return o; }
  function canonical(intent) { return canon({ loop: intent.loop, producer: intent.producer ? intent.producer.name : null, observation: wire(intent.observation), changes: intent.changes }); }
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
    f.observation = wire(intent.observation);
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
    rollup: rollup, view: view, project: project, previewText: previewText, inputsFor: inputsFor, approval: approval, changes: changes, itemRef: itemRef, cleanSnapshot: cleanSnapshot, cleanRequest: cleanRequest, buildDecision: buildDecision, cleanDecision: cleanDecision, cleanFile: cleanFile, recordsFor: recordsFor };
})();
