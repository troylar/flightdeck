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
      if (V.ledger.held.length) {
        /* Each record a held one saw and that isn't here is named, before coverage stops. */
        V.ledger.held.forEach(function (h) { (h.missing || []).forEach(function (id) { if (!unreadAt(o, id)) C.missing.push({ path: 'proposals/' + id + '.json', kind: 'nofile', why: 'The scope record ' + h.record + ' of spread "' + s.text + '"\'s loop saw this one, and it isn\'t in the folder.' }); }); });
        hold('Spread "' + s.text + '": a scope record of its loop can\'t be read yet, so who owes it isn\'t known.'); return finish(C);
      }
      /* What it depends on, expected from what it recorded and what refers to it, each present and checked here: the scope
         records its scope was reviewed against, every item it names in its loop's scope, the runs its items' requests were
         filed on, and no run of its loop whose last read failed. Anything expected and absent leaves coverage incomplete. */
      var gap = expected(r, s, V, o, deps, C);
      if (gap) { hold(gap); return finish(C); }
      /* Who owes it is known only from here on: before this, coverage is incomplete, never empty. */
      C.complete = true; C.noun = V.noun;
      var rows = Object.create(null); V.rollup.items.forEach(function (i) { rows[i.uid] = i; });
      /* Who owes it: while it stands, every item in scope on its current attempt, apart from those cleared when it was added
         (unless included one by one). A stop ends future inheritance only; existing obligations remain (round 7): once
         stopped, each obligation it listed that is still required on that attempt (a removed item or an earlier attempt owes
         nothing, a later attempt inherits nothing), and every other required item on its current attempt that the stop
         couldn't see, unless it truly arrived after the stop (stoppedOwes). */
      var mine = Object.create(null), owe = function (p) { C.items.push(itemOf(r, s, V, rows[p.uid], p, o, deps, childView, mine, C)); };
      var exempt = function (i, a) { return hasPair(s.scope.cleared, i.uid, a) && !hasPair(s.included, i.uid, a); };
      if (s.state === 'stopped') {
        /* Keyed by the pair, never the uid alone: a listed attempt says nothing of another. */
        var listed = Object.create(null); (s.stop.owed || []).forEach(function (p) { listed[pairKey(p.uid, p.attempt)] = true; });
        (s.stop.owed || []).forEach(function (p) { var w = rows[p.uid]; if (w && w.required && (w.attempt || 1) === p.attempt) owe({ uid: p.uid, attempt: p.attempt }); });
        var owes = stoppedOwes(s, V, T, o);
        V.rollup.items.forEach(function (i) { var a = i.attempt || 1; if (i.required && !listed[pairKey(i.uid, a)] && !exempt(i, a) && owes(i.uid, a)) owe({ uid: i.uid, attempt: a }); });
      } else V.rollup.items.forEach(function (i) {
        if (!i.required) return;
        var a = i.attempt || 1;
        if (exempt(i, a)) { C.items.push({ uid: i.uid, key: i.key, attempt: a, state: 'exempt', words: STATE.exempt, resolved: true, owed: false }); return; }
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
  /* Whether a stopped spread owes a pair {uid, attempt} it didn't list (rounds 10 and 11, docs/design.md 45.1): monotone and
     order-free. Its witnesses are every record of its loop that refers to any alias the item ever had (PF.loop.witnessRefs):
     with no attempt, for every attempt (x.witness), or naming this attempt (x.witnessAt); and the spread's own snapshot when
     it names the pair. A record the schema can't fully read (x.witnessDoubt) owes. It is
     exempt only when there is at least one and every one is a 4.0 scope record whose parent head is the stop's application
     or later on this run's chain; anything else (before the stop, concurrent with it, missing when it was made, no head, any
     doubt) owes. */
  function stoppedOwes(s, V, T, o) {
    /* Only this loop's records (round 11, EA): another loop's record sharing an id never stands in for one of these. Two
       copies of one that differ hold the loop (PF.loop.causal), so nothing reaches here then; any copy left owes. */
    var chain = T.chain || [], at = chain.indexOf(s.stop.application), by = Object.create(null), twice = Object.create(null);
    (V.records || []).forEach(function (x) { if (!x || !x.id) return; if (by[x.id] && by[x.id] !== x) twice[x.id] = true; by[x.id] = x; });
    var items = Object.create(null); (V.ledger.items || []).forEach(function (x) { items[x.uid] = x; });
    var after = function (rec) {
      if (twice[rec]) return false;
      var R0 = by[rec], h = R0 && typeof R0.head === 'string' ? R0.head : null;
      if (h === null || h === '' || at < 0) return false;
      var hi = chain.indexOf(h);
      return hi >= 0 && hi >= at;
    };
    return function (uid, attempt) {
      var x = items[uid]; if (!x) return true;
      if (hasPair(s.scope.open, uid, attempt) || hasPair(s.scope.cleared, uid, attempt)) return true;
      if (x.witnessDoubt && x.witnessDoubt.length) return true;
      var W = (x.witness || []).concat((x.witnessAt && x.witnessAt[attempt]) || []);
      return !(W.length && W.every(after));
    };
  }
  function unreadAt(o, id) { return ((o.loops && o.loops.unread) || []).some(function (u) { return String(u.file || '').indexOf(id) === 0; }); }
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
    /* XB: a scope record of the loop explains every item anything names: the scope it was reviewed against, includes, its
       stop, bindings, the runs of its loop, the requests that fulfil it and the loop's approvals (each with the items it
       recorded). An item named and not explained is a scope record that isn't here, so coverage is incomplete; a recorded
       removal still explains it. */
    var child = String(V.fields && V.fields.process || ''), have = Object.create(null);
    var mine0 = function (c) { return !!c && !!c.parent && c.parent.process === r.process && c.parent.id === r.id && c.parent.step === s.loopStep; };
    var known = Object.create(null); (V.ledger.items || []).forEach(function (i) { known[i.uid] = true; });
    var refs = [], ref = function (uid, by) { if (typeof uid === 'string' && uid) refs.push({ uid: uid, by: by }); };
    (s.scope.open || []).concat(s.scope.cleared || []).forEach(function (p) { ref(p.uid, 'the scope it was reviewed against'); });
    (s.included || []).forEach(function (p) { ref(p.uid, 'an include'); });
    if (s.state === 'stopped' && s.stop) (s.stop.owed || []).forEach(function (p) { ref(p.uid, 'its stop'); });
    Object.keys(s.binds || {}).forEach(function (k) { ref(k.slice(0, k.lastIndexOf('#')), 'a binding'); });
    (o.runs || []).forEach(function (c) { if (mine0(c) && c.parent.item) ref(c.parent.item.uid, 'runs/' + c.process + '/' + c.id + '/run.json'); });
    deps.records.forEach(function (x) { if (x.fulfills && x.fulfills.spread === s.id) ref(x.fulfills.uid, 'proposals/' + (x._file || x.id + '.json')); });
    var la = r.steps && r.steps[s.loopStep];
    [la && la.loop].concat(((la && la.history) || []).map(function (h) { return h && h.loop; })).forEach(function (ap) { ((ap && ap.items) || []).forEach(function (i) { ref(i && i.uid, 'an approval of its loop'); }); });
    var lost = refs.filter(function (x) { return !known[x.uid]; });
    if (lost.length) {
      if (!C.missing.some(function (m) { return m.path === 'proposals'; })) C.missing.push({ path: 'proposals', kind: 'nofile', why: 'No scope record of spread "' + s.text + '"\'s loop here puts ' + lost[0].uid + ' in it, and ' + lost[0].by + ' names it.' });
      return nm + ': ' + lost[0].uid + ' is named by ' + lost[0].by + ', but no scope record here puts it in the loop, so who owes it isn\'t known.';
    }
    (o.runs || []).forEach(function (c) { if (c) have[c.process + '/' + c.id] = true; });
    deps.records.forEach(function (x) {
      if (!x.fulfills || x.fulfills.spread !== s.id || !x.run || x.run.process !== child) return;
      var k = x.run.process + '/' + x.run.id, pth = 'runs/' + k + '/run.json';
      if (have[k] || C.missing.some(function (m) { return m.path === pth; })) return;
      C.missing.push({ path: pth, kind: 'nofile', why: 'A request for spread "' + s.text + '" was filed on this run, and it isn\'t in the folder.' });
      why = why || nm + ': ' + k + ', a run its requests were filed on, isn\'t here, so how it stands isn\'t known.';
    });
    /* YB: a binding names the run that counts, so that run is expected whether or not a request was filed on it. */
    Object.keys(s.binds || {}).sort().forEach(function (k) {
      var b = s.binds[k]; if (!b || b.disputed || typeof b.run !== 'string' || !b.run || have[b.run]) return;
      var pth = 'runs/' + b.run + '/run.json';
      if (!C.missing.some(function (m) { return m.path === pth; })) C.missing.push({ path: pth, kind: 'nofile', why: 'Spread "' + s.text + '" binds a story to this run, and it isn\'t in the folder.' });
      why = why || nm + ': ' + b.run + ', a run a story is bound to, isn\'t here, so how it stands isn\'t known.';
    });
    if (why) return why;
    /* The run itself and every run of its loop read fresh, with their versions (o.loops.unreadRun, from PF.spreads.inputs). */
    var mineRun = function (c) { return !!c && !!c.parent && c.parent.process === r.process && c.parent.id === r.id && c.parent.step === s.loopStep; };
    var un = o.loops.unreadRun || function () { return null; };
    [r].concat((o.runs || []).filter(mineRun)).forEach(function (c) {
      var u = un(c); if (!u) return;
      if (!C.missing.some(function (m) { return m.path === u.path; })) C.missing.push({ path: u.path, kind: u.kind || 'unreadable', why: u.why });
      why = why || nm + ': ' + c.process + '/' + c.id + (c === r ? ' (this run)' : '') + ' can\'t be read fresh here (' + u.why + '), so how it stands isn\'t known until it is.';
    });
    if (why) return why;
    var gone = (o.loops.failed || []).filter(function (p) { return child && String(p).indexOf('runs/' + child + '/') === 0; });
    if (gone.length) { if (!C.missing.some(function (m) { return m.path === gone[0]; })) C.missing.push({ path: gone[0], kind: 'unreadable', why: 'A run of spread "' + s.text + '"\'s loop can\'t be read here.' }); return nm + ': a run of its loop (' + gone[0] + ') can\'t be read here, so who owes it isn\'t known.'; }
    return '';
  }
  /* The coverage inputs, built one way for the app's loaded folder and the CLI's shared reader alike (XA): o: { runs, records,
     unread, scopes, scopesUnread, people, procOf, processes (the versions read, by process), procsRead(process) (whether that
     process's versions were read, so an absent one is known absent), failed (every path a read failed on, or found missing or
     refused: runs, versions, records), partsFailed ({ publications, runs }: whole parts not read this time), runFailed(run)
     (why a run's last read failed, or '') }. A run is read fresh only when its file and its version were; anything else is
     unknown, with the path that says why. */
  function inputs(o) {
    o = o || {};
    var failed = (o.failed || []).map(function (p) { return String(p && p.path != null ? p.path : p); }), parts = o.partsFailed || {};
    var under = function (dir) { dir = dir.replace(/\/$/, ''); return failed.filter(function (p) { var q = p.replace(/\/$/, ''); return q === dir || q.indexOf(dir + '/') === 0; })[0] || ''; };
    var unreadRun = function (c) {
      if (!c || typeof c.process !== 'string' || typeof c.id !== 'string') return null;
      var rd = 'runs/' + c.process + '/' + c.id, rf = 'runs/' + c.process + '/' + c.id + '/run.json';
      var w = o.runFailed ? o.runFailed(c) : '';
      if (w) return { path: rf, kind: 'unreadable', why: w };
      if (parts.runs) return { path: 'runs', kind: 'unreadable', why: 'The runs couldn\'t be read on the last check.' };
      var hit = under(rd); if (hit) return { path: hit, kind: 'unreadable', why: 'This run couldn\'t be read here.' };
      if (PF.run.isTest(c) || typeof c.folder !== 'string') return null;
      var pd = 'publications/' + c.process + '/' + c.folder + '/';
      if (parts.publications) return { path: 'publications', kind: 'unreadable', why: 'The versions couldn\'t be read on the last check, so ' + c.process + '/' + c.id + '\'s version ' + c.folder + ' wasn\'t checked.' };
      hit = under(pd); if (hit) return { path: hit, kind: 'unreadable', why: 'The version ' + c.process + '/' + c.id + ' runs on couldn\'t be read here.' };
      if (o.processes && (!o.procsRead || o.procsRead(c.process))) {
        var e = o.processes.filter(function (p) { return p && p.process === c.process; })[0], pub = e ? (e.pubs || []).filter(function (p) { return p && p.folder === c.folder; })[0] : null;
        if (!pub) return { path: pd, kind: 'nofile', why: 'Run ' + c.process + '/' + c.id + ' runs on this version, and it isn\'t in the folder.' };
        if (!pub.ok) return { path: pd, kind: pub.kind === 'newer' ? 'newer' : 'unreadable', why: 'The version ' + c.process + '/' + c.id + ' runs on can\'t be read here' + (pub.why ? ': ' + pub.why : '') + '.' };
      }
      return null;
    };
    return { runs: o.runs || [], records: o.records || [], unread: o.unread || [], people: o.people,
      loops: { records: o.scopes || [], unread: o.scopesUnread || [], procOf: o.procOf, unreadRun: unreadRun, failed: failed } };
  }
  /* One obligation's state: where it is fulfilled (a binding, else the one run the loop counts for that attempt) and how its
     request and to-do stand there. */
  function itemOf(r, s, V, row, p, o, deps, childView, scope, C) {
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
    var at = function (path, kind, why) { if (C && !C.missing.some(function (m) { return m.path === path; })) C.missing.push({ path: path, kind: kind, why: why }); };
    if (dest._unrunnable) { at('runs/' + it.run + '/run.json', 'unusable', dest._unrunnable); return set('unread', it.run + ' can only be read here.'); }
    var cm = null; try { cm = PF.run.mapOf(dest); } catch (e) { cm = null; }
    if (!cm) { at('runs/' + it.run + '/run.json', 'unusable', 'Its checklist can\'t be read here.'); return set('unread', it.run + '\'s checklist can\'t be read here.'); }
    if (!phaseOfGate(cm, s.child.beforeGate)) return set('placement', it.run + '\'s checklist has no gate ' + s.child.beforeGate + ' to put it before.');
    var CT = childView(dest);
    if (!CT || CT.broken || CT.unread.length || CT.held.length) {
      /* What the story's own records are missing (its addition, its application, a decision) is named here, and so is each one
         that can't be read. */
      if (CT) { PF.todos.missingOf(CT, null).forEach(function (m) { at(m.path, m.kind, m.why); }); CT.unread.forEach(function (u) { at('proposals/' + String(u.file || ''), u.kind === 'newer' ? 'newer' : 'unreadable', 'A to-do record of ' + it.run + ' can\'t be read here.'); }); }
      if (!C || !C.missing.length) at('runs/' + it.run, 'unreadable', 'The to-dos of ' + it.run + ' can\'t all be read yet.');
      return set('unread', 'The to-dos of ' + it.run + ' can\'t all be read yet.');
    }
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
    if (!x) { at('runs/' + it.run, 'unreadable', 'Its to-do on ' + it.run + ' can\'t be read.'); return set('unread', 'Its to-do on ' + it.run + ' can\'t be read.'); }
    x.history.forEach(function (h) { if (h.op === 'add' || h.op === 'reopen') scope[h.application] = true; });
    /* Every request on the covered to-do (Done, Won't do, Move, Reopen, not only its Add) that was decided or applied two ways
       keeps its participants in the parent's approval scope, so settling it never restores an approval made before it. */
    (x.requests || []).forEach(function (id) { var q1 = CT.requests[id]; (q1 && q1.disputedIds || []).forEach(function (d) { scope[d] = true; }); });
    if (x.disputed) return set('disputed', 'Its to-do on ' + it.run + ' was decided two ways at once.');
    return set(x.state === 'open' ? 'open' : x.state, x.why || '');
  }
  function finish(C) {
    /* Incomplete always names where: never a hold without a path. */
    if (!C.complete && !C.missing.length) C.missing.push({ path: 'proposals', kind: 'unreadable', why: C.unresolved[0] || 'Spread "' + C.text + '": what it is owed on can\'t all be read yet.' });
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
  return { LIMITS: LIMITS, STATE: STATE, RESOLVED: RESOLVED, idFor: idFor, obligationId: obligationId, childRequestId: childRequestId, pairKey: pairKey, hasPair: hasPair, snapshot: snapshot, phaseOfGate: phaseOfGate, coverage: coverage, manifest: manifest, inputs: inputs };
})();
