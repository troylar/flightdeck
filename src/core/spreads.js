/* Spreads (4.0 slice 3, docs/design.md 45.1): a standing requirement on a loop, "every open item here", installed on the parent
   run as effective work by a spread-add request (PF.todos) and fulfilled through separately authorized to-dos on each item's
   own run. Pure: no files, no clocks. Coverage is derived on every read from the spread, the loop's ledger and roll-up, the
   attempts, the runs chosen and their to-do chains; nothing about it is stored. */
PF.spreads = (function () {
  'use strict';
  var LIMITS = { spreads: 50, items: 500 };
  /* What each state of an obligation is called, and whether it is resolved (the only states that release the hold). */
  var STATE = {
    exempt: 'Cleared, unchanged', excepted: 'Approved without a run', done: 'Done', wont: 'Won\'t do', moved: 'Moved', owed: 'Not requested yet', waiting: 'Waiting for approval',
    queued: 'Waiting for its recorder', open: 'Added', declined: 'Declined', held: 'Held', disputed: 'Disputed', 'no-run': 'Waiting for its run',
    competing: 'Needs a run chosen', rebind: 'Needs binding', placement: 'Needs placement', unread: 'Can\'t be read', ended: 'Its run ended first'
  };
  var RESOLVED = { done: true, wont: true, moved: true, excepted: true };
  function hex(v) { return PF.sha256.hex(JSON.stringify(v)); }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  /* A spread's id comes from the request that created it, so a retry of that request names the same spread. */
  function idFor(request) { return 'sp-' + hex(['sp', request]).slice(0, 24); }
  /* One obligation: the spread on one item's attempt. A new attempt is a new obligation. */
  function obligationId(spread, uid, attempt) { return 'ob-' + hex(['ob', spread, uid, attempt]).slice(0, 24); }
  /* The request that asks an item's run for the requirement: the same id from every tool and every retry, and a different one
     for another destination run. */
  function childRequestId(spread, uid, attempt, child) { return 'req-spread-' + hex(['spread', spread, uid, attempt, child.process, child.id]).slice(0, 24); }
  function pairKey(uid, attempt) { return uid + '#' + attempt; }
  function hasPair(list, uid, attempt) { return (list || []).some(function (p) { return p.uid === uid && p.attempt === attempt; }); }

  /* The scope a person reviewed when asking for a spread: every item in scope with its attempt, open or cleared (an accepted
     result or an approval without a run), and a fingerprint of what each looked like then (its status, result and run). */
  function snapshot(V) {
    var open = [], cleared = [], ids = [];
    ((V && V.rollup && V.rollup.items) || []).forEach(function (i) {
      if (!i.required) return;
      var p = { uid: i.uid, attempt: i.attempt || 1 };
      (i.status === 'cleared' || i.status === 'exception' ? cleared : open).push(p);
      ids.push([i.uid, p.attempt, i.status, i.result || '', i.run || '']);
    });
    var seen = ((V && V.ledger && V.ledger.heads) || []).slice().sort(cmpStr);
    return { open: open, cleared: cleared, fingerprint: hex(['scope', V && V.loop ? V.loop.step : '', ids]).slice(0, 16), seen: seen };
  }
  /* The phase of a checklist whose gate is gateId, or null. */
  function phaseOfGate(map, gateId) { var out = null; (map && map.phases || []).forEach(function (p) { if (p.gate && p.gate.id === gateId) out = p; }); return out; }
  function nameOf(row, uid) { return row ? row.key || row.uid : uid; }

  /* Coverage of every spread on a parent run, as every window reads it: r the parent, T its to-do view (PF.todos.view).
     o: { runs (every run read), records (every to-do record read), unread, people, loops: { records, unread, procOf } (the
     scope records, as PF.loop.view takes them) }. Fail closed: a loop, child run or to-do record that can't be read leaves the
     obligations it decides unresolved, never resolved. Returns { spreads: [...], scope: [record ids an approval must count] }. */
  function coverage(r, T, o) {
    o = o || {};
    var out = [], scope = Object.create(null), deps = { records: o.records || [], unread: o.unread || [] };
    var views = Object.create(null);
    var childView = function (c) {
      var k = c.process + '/' + c.id;
      if (!own(views, k)) { var v = null; try { v = PF.todos.view(c, { records: deps.records, unread: deps.unread, people: o.people, deps: deps }); } catch (e) { v = null; } views[k] = v; }
      return views[k];
    };
    (T.spreads || []).forEach(function (s) {
      var C = { complete: false, scope: [], missing: [], id: s.id, text: s.text, loopStep: s.loopStep, child: s.child, owner: s.owner || '', state: s.state, stop: s.stop, request: s.request, added: s.added, items: [], unresolved: [], notices: [], counts: null, summary: '', row: '' };
      out.push(C);
      var hold = function (why) { C.unresolved.push(why); };
      if (!o.loops) { hold('Spread "' + s.text + '": its loop can\'t be read here, so its coverage can\'t be checked.'); return finish(C); }
      var V = null; try { V = PF.loop.view(r, s.loopStep, { records: o.loops.records, unread: o.loops.unread, runs: o.runs, procOf: o.loops.procOf }); } catch (e) { V = null; }
      if (!V) { hold('Spread "' + s.text + '": its loop ' + s.loopStep + ' can\'t be read here.'); return finish(C); }
      if (V.ledger.held.length) { hold('Spread "' + s.text + '": a scope record of its loop can\'t be read yet, so who owes it isn\'t known.'); return finish(C); }
      /* What it depends on, expected from what it recorded and what refers to it, each present and checked here: the scope
         records its scope was reviewed against, every item it names in its loop's scope, the runs its items' requests were
         filed on, and no run of its loop whose last read failed. Anything expected and absent leaves coverage incomplete. */
      var gap = expected(r, s, V, o, deps, C);
      if (gap) { hold(gap); return finish(C); }
      /* Who owes it is known only from here on: before this, coverage is incomplete, never empty. */
      C.complete = true; C.noun = V.noun;
      var rows = Object.create(null); V.rollup.items.forEach(function (i) { rows[i.uid] = i; });
      /* Who owes it: while it stands, every item in scope on its current attempt, apart from those cleared when it was added
         (unless included one by one); once stopped, the obligations it had then that are still required on the item's current
         attempt (a removed item or an earlier attempt owes nothing, a later attempt inherits nothing; the stop is unchanged). */
      var mine = Object.create(null), owe = function (p) { C.items.push(itemOf(r, s, V, rows[p.uid], p, o, deps, childView, mine)); };
      if (s.state === 'stopped') (s.stop.owed || []).forEach(function (p) { var w = rows[p.uid]; if (w && w.required && (w.attempt || 1) === p.attempt) owe({ uid: p.uid, attempt: p.attempt }); });
      else V.rollup.items.forEach(function (i) {
        if (!i.required) return;
        var a = i.attempt || 1;
        if (hasPair(s.scope.cleared, i.uid, a) && !hasPair(s.included, i.uid, a)) { C.items.push({ uid: i.uid, key: i.key, attempt: a, state: 'exempt', words: STATE.exempt, resolved: true, owed: false }); return; }
        owe({ uid: i.uid, attempt: a });
      });
      C.scope = Object.keys(mine).sort(); C.scope.forEach(function (id) { scope[id] = true; });
      /* An obligation whose run or to-dos can't be read here is unknown, so coverage isn't complete either. */
      if (C.items.some(function (i) { return i.state === 'unread'; })) C.complete = false;
      return finish(C);
    });
    return { spreads: out, scope: Object.keys(scope).sort() };
  }
  /* What a spread's coverage expects to find (the expected-dependency manifest), checked against what was read: '' when all
     of it is here, else why not, with each missing file named in C.missing ({ path, kind: 'nofile', why }). */
  function expected(r, s, V, o, deps, C) {
    var nm = 'Spread "' + s.text + '"', why = '';
    var present = Object.create(null); (V.records || []).forEach(function (x) { present[x.id] = true; });
    var unreadAt = function (id) { return (o.loops.unread || []).some(function (u) { return String(u.file || '').indexOf(id) === 0; }); };
    (s.scope.seen || []).forEach(function (id) {
      if (present[id]) return;
      if (!unreadAt(id)) C.missing.push({ path: 'proposals/' + id + '.json', kind: 'nofile', why: 'Spread "' + s.text + '" was reviewed against this scope record of its loop, and it isn\'t in the folder.' });
      why = why || nm + ': a scope record it was reviewed against (' + id + ') can\'t be read here, so who owes it isn\'t known.';
    });
    if (why) return why;
    var known = Object.create(null); (V.ledger.items || []).forEach(function (i) { known[i.uid] = true; });
    var named = (s.scope.open || []).concat(s.scope.cleared || [], s.included || [], s.state === 'stopped' && s.stop ? s.stop.owed || [] : []);
    var lost = named.filter(function (p) { return !known[p.uid]; });
    if (lost.length) return nm + ': ' + lost.length + (lost.length === 1 ? ' item it names isn\'t' : ' items it names aren\'t') + ' in its loop\'s scope records here (' + lost[0].uid + '), so who owes it isn\'t known.';
    var child = String(V.fields && V.fields.process || ''), have = Object.create(null);
    (o.runs || []).forEach(function (c) { if (c) have[c.process + '/' + c.id] = true; });
    deps.records.forEach(function (x) {
      if (!x.fulfills || x.fulfills.spread !== s.id || !x.run || x.run.process !== child) return;
      var k = x.run.process + '/' + x.run.id, pth = 'runs/' + k + '/run.json';
      if (have[k] || C.missing.some(function (m) { return m.path === pth; })) return;
      C.missing.push({ path: pth, kind: 'nofile', why: 'A request for spread "' + s.text + '" was filed on this run, and it isn\'t in the folder.' });
      why = why || nm + ': ' + k + ', a run its requests were filed on, isn\'t here, so how it stands isn\'t known.';
    });
    if (why) return why;
    var mineRun = function (c) { return !!c && !!c.parent && c.parent.process === r.process && c.parent.id === r.id && c.parent.step === s.loopStep; };
    var stale = o.loops.unreadRun ? (o.runs || []).filter(function (c) { return mineRun(c) && o.loops.unreadRun(c); }) : [];
    if (stale.length) return nm + ': ' + stale[0].process + '/' + stale[0].id + ' couldn\'t be read on the last check, so how it stands isn\'t known until it is.';
    var gone = (o.loops.runsUnread || []).filter(function (p) { return child && String(p).indexOf('runs/' + child + '/') === 0; });
    if (gone.length) return nm + ': a run of its loop (' + gone[0] + ') can\'t be read here, so who owes it isn\'t known.';
    return '';
  }
  /* One obligation's state: where it is fulfilled (a binding, else the one run the loop counts for that attempt) and how its
     request and to-do stand there. */
  function itemOf(r, s, V, row, p, o, deps, childView, scope) {
    var it = { uid: p.uid, key: row ? row.key : '', attempt: p.attempt, owed: true, arrival: !hasPair(s.scope.open, p.uid, p.attempt) && !hasPair(s.scope.cleared, p.uid, p.attempt), run: '', request: '', requested: false, todo: '', state: '', words: '', why: '', resolved: false };
    var set = function (st, why) { it.state = st; it.words = STATE[st]; it.why = why || ''; it.resolved = !!RESOLVED[st]; return it; };
    var name = nameOf(row, p.uid);
    var mine = (V.runs || []).filter(function (c) { return c.parent.item.uid === p.uid && (+c.parent.item.attempt || 1) === p.attempt; });
    var bind = s.binds[pairKey(p.uid, p.attempt)] || null, dest = null;
    if (bind && bind.disputed) return set('disputed', bind.why);
    /* Approved without a run for this attempt, settled in the loop (never decided two ways): resolved, whether or not the item
       has a run and whatever that run shows. */
    if (row && row.required && row.exception && !row.excReview && row.attempt === p.attempt) return set('excepted', name + ' was approved without a run.');
    if (bind && bind.run) {
      dest = mine.filter(function (c) { return c.process + '/' + c.id === bind.run; })[0] || null;
      if (!dest) return set('rebind', name + ' is bound to ' + bind.run + ', which isn\'t a run of attempt ' + p.attempt + ' here.');
    } else if (!mine.length) return set('no-run', name + ' has no run for attempt ' + p.attempt + ' yet; it is requested when one starts.');
    else if (mine.length > 1) {
      var ch = row && row.chosen && row.attempt === p.attempt ? mine.filter(function (c) { return c.id === row.chosen; })[0] : null;
      if (!ch) return set('competing', name + ' has ' + mine.length + ' runs for attempt ' + p.attempt + '; choose which one counts.');
      dest = ch;
    } else dest = mine[0];
    it.run = dest.process + '/' + dest.id;
    /* A request for this obligation filed on another run of the same attempt (the run that counts changed since): it stays
       recorded there and is never dropped; which run covers it is bound explicitly. */
    var elsewhere = deps.records.filter(function (x) { return (x.kind === 'proposal' || x.kind === 'compound') && x.fulfills && x.fulfills.spread === s.id && x.fulfills.uid === p.uid && x.fulfills.attempt === p.attempt && x.run && (x.run.process + '/' + x.run.id) !== it.run; });
    if (!bind && elsewhere.length) return set('rebind', 'It was requested on ' + elsewhere[0].run.process + '/' + elsewhere[0].run.id + ', but the loop now counts ' + it.run + '; bind which run covers it.');
    if (dest._unrunnable) return set('unread', it.run + ' can only be read here.');
    var cm = null; try { cm = PF.run.mapOf(dest); } catch (e) { cm = null; }
    if (!cm) return set('unread', it.run + '\'s checklist can\'t be read here.');
    if (!phaseOfGate(cm, s.child.beforeGate)) return set('placement', it.run + '\'s checklist has no gate ' + s.child.beforeGate + ' to put it before.');
    var CT = childView(dest);
    if (!CT || CT.broken || CT.unread.length || CT.held.length) return set('unread', 'The to-dos of ' + it.run + ' can\'t all be read yet.');
    var rid = childRequestId(s.id, p.uid, p.attempt, { process: dest.process, id: dest.id }), q = CT.requests[rid];
    it.request = rid; it.todo = PF.todos.todoIdFor(rid);
    if (!q) return set(dest.ended ? 'ended' : 'owed', dest.ended ? it.run + ' ended before it was requested.' : '');
    /* request is the id it would have; requested says a request is there, as checked here. */
    it.requested = true;
    (q.disputedIds || []).forEach(function (id) { scope[id] = true; });
    if (!q.landed) {
      if (dest.ended) return set('ended', it.run + ' ended before it was applied.');
      return set(q.status === 'queued' ? 'queued' : q.status === 'declined' ? 'declined' : q.status === 'disputed' ? 'disputed' : q.status === 'held' ? 'held' : 'waiting', q.why || '');
    }
    var x = CT.byTodo[it.todo];
    if (!x) return set('unread', 'Its to-do on ' + it.run + ' can\'t be read.');
    x.history.forEach(function (h) { if (h.op === 'add' || h.op === 'reopen') scope[h.application] = true; });
    /* Every request on the covered to-do (Done, Won't do, Move, Reopen, not only its Add) that was decided or applied two ways
       keeps its participants in the parent's approval scope, so settling it never restores an approval made before it. */
    (x.requests || []).forEach(function (id) { var q1 = CT.requests[id]; (q1 && q1.disputedIds || []).forEach(function (d) { scope[d] = true; }); });
    if (x.disputed) return set('disputed', 'Its to-do on ' + it.run + ' was decided two ways at once.');
    return set(x.state === 'open' ? 'open' : x.state, x.why || '');
  }
  function finish(C) {
    var n = { owed: 0, resolved: 0, exempt: 0, arrivals: 0, by: Object.create(null) };
    C.items.forEach(function (i) {
      n.by[i.state] = (n.by[i.state] || 0) + 1;
      if (!i.owed) { n.exempt++; return; }
      n.owed++;
      if (i.resolved) n.resolved++;
      if (i.arrival) n.arrivals++;
      if (!i.resolved) C.unresolved.push('Spread "' + C.text + '" on ' + (i.key || i.uid) + ': ' + i.words.toLowerCase() + (i.why ? ' (' + i.why + ')' : '') + '.');
      if (i.arrival) C.notices.push((i.key || i.uid) + (i.attempt > 1 ? ' started attempt ' + i.attempt + '.' : ' joined.') + ' ' + C.text + (i.requested ? ' requested.' : ' is owed; not requested yet.'));
    });
    C.counts = n;
    var N = C.noun || { one: 'item', many: 'items' }, word = function (k) { return k === 1 ? N.one : N.many; };
    C.row = C.text + ' · on ' + n.owed + ' ' + word(n.owed) + ' · ' + n.resolved + ' done' + (C.state === 'stopped' ? ' · stopped' : '');
    var parts = [];
    /* Added: the items' own additions (open or resolved there); one approved without a run was never added. */
    var added = (n.by.open || 0) + (n.by.done || 0) + (n.by.wont || 0) + (n.by.moved || 0);
    if (added) parts.push(added + ' added');
    if (n.by.excepted) parts.push(n.by.excepted + ' ' + STATE.excepted.toLowerCase());
    if (n.by.waiting) parts.push(n.by.waiting + ' waiting for approval');
    if (n.by.queued) parts.push(n.by.queued + ' waiting for ' + (n.by.queued === 1 ? 'its recorder' : 'recorders'));
    if (n.by.owed) parts.push(n.by.owed + ' not requested yet');
    if (n.by['no-run']) parts.push(n.by['no-run'] + ' waiting for a run');
    if (n.by.placement) parts.push(n.by.placement + ' needs placement');
    ['declined', 'disputed', 'held', 'competing', 'rebind', 'unread', 'ended'].forEach(function (k) { if (n.by[k]) parts.push(n.by[k] + ' ' + STATE[k].toLowerCase()); });
    C.summary = parts.join(' · ');
    C.preview = n.owed + ' open ' + word(n.owed) + (n.exempt ? '; ' + n.exempt + ' cleared ' + word(n.exempt) + ' unchanged' : '');
    return C;
  }
  /* What `spread sync` would ask, per obligation: the ones not requested yet on a run that takes them (file), and every other
     one with why it isn't asked now. Nothing is written here. */
  function manifest(C) {
    var file = [], skip = [];
    (C.items || []).forEach(function (i) {
      if (!i.owed) return;
      if (i.state === 'owed') file.push({ uid: i.uid, key: i.key, attempt: i.attempt, run: i.run, request: i.request, todo: i.todo });
      else skip.push({ uid: i.uid, key: i.key, attempt: i.attempt, run: i.run || null, state: i.state, words: i.words, why: i.why || '' });
    });
    return { file: file, skip: skip };
  }
  return { LIMITS: LIMITS, STATE: STATE, RESOLVED: RESOLVED, idFor: idFor, obligationId: obligationId, childRequestId: childRequestId, pairKey: pairKey, hasPair: hasPair, snapshot: snapshot, phaseOfGate: phaseOfGate, coverage: coverage, manifest: manifest };
})();
