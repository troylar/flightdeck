/* Insights: how runs of one publication folder went (docs/design.md section 23). Pure, with an explicit now. Every number says
   what it counts and out of how many runs, and lists the runs it couldn't count and why. Runs are grouped by their exact
   publication folder, never by version number, so two clashing v5 folders never merge and versions are never pooled. "Ever"
   numbers read the run's durable marks as well as the answers it still holds, so a block archived out of run.json still
   counts; a run that didn't keep marks from its start and shows nothing is "history incomplete", never clean.
   Two rules hold it together. Every time comes through one layer (at, runStart, runEnd, gateTime, activeBetween) that gives
   a value or a reason naming whose clock; nothing else here reads a run's times. And every number carries one
   qualifications object, q = { unit, cohort, counted, excluded: [{ why, reason, n, keys }], incomplete }, where counted +
   every excluded n + incomplete is the cohort, so whatever draws a number can say exactly what it left out. */
PF.insights = (function () {
  'use strict';
  var R = PF.run;
  var MIN_RATE = 5, DAY = 86400000;
  var FEW = 'Too few runs for a rate yet.';
  var SAME = 'The same as Ever blocked';
  /* The definitions people read under "How these are counted"; docs/design.md section 23 holds the same table (a test checks). */
  var DEFS = [
    { id: 'runs', name: 'Runs', counts: 'Readable runs of this publication folder, by state and outcome', denominator: '—' },
    { id: 'duration', name: 'Completed duration', counts: 'Active time from start to end of Completed runs, paused time left out; the median, and the middle half from 5 runs', denominator: 'Completed runs whose start, end and pauses can be read, aren\'t later than now and don\'t go backward or overlap' },
    { id: 'phase', name: 'Phase time', counts: 'From the previous gate\'s settle time (the start, for the first phase) to this gate\'s, paused time left out', denominator: 'Runs whose gates up to this one are passed or waived, with times and pauses that can be read, aren\'t later than now and don\'t go backward or overlap, and weren\'t reopened: in review now, reopened or settled twice by the run\'s log (the latest 300 entries in run.json; the log names gates by title, so a title two gates share counts for both), or settled after the next gate' },
    { id: 'skipped', name: 'Skipped (N/A)', counts: 'Runs whose current answer is N/A', denominator: 'Runs where the step has a current answer: done, N/A or blocked' },
    { id: 'blocked', name: 'Ever blocked', counts: 'Runs where the step was blocked at least once: its marks, its current answer or an earlier one still in the run', denominator: 'Runs that reached the step (an answer or a mark); a run without a full record (history incomplete) that shows nothing is counted apart, never as clean' },
    { id: 'redone', name: 'Ever redone', counts: 'Runs where the step was sent back for a re-check at least once, from its marks and answers', denominator: SAME },
    { id: 'na', name: 'Ever N/A', counts: 'Runs where the step was N/A at least once, from its marks and answers', denominator: SAME },
    { id: 'differently', name: 'Done differently', counts: 'Runs where the step was done differently at least once, from its marks and answers', denominator: SAME },
    { id: 'offScript', name: 'Any off-script', counts: 'Runs with at least one of blocked, redone, N/A or done differently on the step, each run counted once', denominator: SAME },
    { id: 'corrections', name: 'Corrections', counts: 'Runs with a correction on the step, by where its group stands', denominator: 'Readable runs of this publication folder' },
    { id: 'fuAge', name: 'Follow-up age', counts: 'Open follow-ups by how long since they were added: under 7 days, 7 to 30, over 30, by the recorder\'s clock', denominator: 'Open follow-ups whose own time can be read and isn\'t later than now' },
    { id: 'fuDecide', name: 'Time to a decision', counts: 'From when a follow-up was added to its current decision (the highest rev), by the recorder\'s and the decider\'s clocks', denominator: 'Decided follow-ups whose times can be read, aren\'t later than now and don\'t go backward' },
    { id: 'gates', name: 'Gates waived or failed', counts: 'Runs whose gate is waived now, and runs whose gate failed at least once (now, or by the run\'s log when no other gate shares its title)', denominator: 'Runs with a record of the gate, now or in the run\'s log' },
    { id: 'notNeeded', name: 'Not needed', counts: 'A step whose "only when" doesn\'t hold in a run: that run is left out of every step number above for it (skipped, ever, off-script and corrections)', denominator: 'Runs of checklists with "only when" (2.1)' }
  ];
  /* The "ever" metrics and the mark each reads. */
  var EVER = { blocked: 'blocked', redone: 'recheck', na: 'na', differently: 'differently' };
  var EVER_KEYS = ['blocked', 'redone', 'na', 'differently', 'offScript'];
  var EVER_WORDS = { blocked: 'blocked at least once', redone: 'redone at least once', na: 'N/A at least once', differently: 'done differently at least once', offScript: 'off-script at least once' };
  var BUCKETS = [{ id: 'lt7', label: 'Under 7 days' }, { id: 'd7to30', label: '7 to 30 days' }, { id: 'gt30', label: 'Over 30 days' }];
  /* Why something wasn't counted, in words. Clock reasons say whose clock. */
  var WHOSE = { recorder: 'the recorder\'s clock', decider: 'the decider\'s clock' };
  var WHY = {
    unread: 'its file couldn\'t be read; its last copy isn\'t counted',
    missing: 'its file is gone from the team folder; its last copy isn\'t counted',
    newer: 'it\'s from a newer Flightdeck (or uses a checklist this copy can\'t read)',
    unknown: 'it couldn\'t be read, so which version it belongs to isn\'t known',
    test: 'it\'s a test run, on a staged version',
    time: 'a time couldn\'t be read',
    future: 'a time is later than now',
    backward: 'the times go backward',
    pauses: 'its pauses overlap or end before they start, so the clock went back',
    checklist: 'its checklist couldn\'t be read',
    unsettled: 'the gate wasn\'t passed or waived',
    reopened: 'the gate was reopened',
    reopenedShared: 'a gate with the same title was reopened or passed again, and which one isn\'t known',
    earlier: 'an earlier gate isn\'t settled, was reopened or has a time that can\'t be used',
    unreached: 'it didn\'t reach the step',
    unanswered: 'the step has no current answer',
    notneeded: 'the step wasn\'t needed in it',
    nogate: 'there\'s no record of the gate',
    shared: 'its log says a gate with this title failed, and another gate shares the title',
    undecided: 'its decisions disagree (two with the same rev)',
    decidedBefore: 'it was decided before it was added, by these clocks'
  };
  /* Whole runs left out of every number, said as sentences on their own. */
  var WHOLE = {
    unread: function (n) { return n === 1 ? '1 run couldn\'t be read; its last copy isn\'t counted.' : runs(n) + ' couldn\'t be read; their last copies aren\'t counted.'; },
    missing: function (n) { return n === 1 ? '1 run\'s file is gone from the team folder; its last copy isn\'t counted.' : runs(n) + '\' files are gone from the team folder; their last copies aren\'t counted.'; },
    unknown: function (n) { return n === 1 ? '1 run of this process couldn\'t be read, so which version it belongs to isn\'t known; it isn\'t counted.' : runs(n) + ' of this process couldn\'t be read, so which version they belong to isn\'t known; they aren\'t counted.'; },
    test: function (n) { return n === 1 ? '1 test run not counted.' : num(n) + ' test runs not counted.'; },
    newer: function (n) { return n === 1 ? '1 run is from a newer Flightdeck (or uses a checklist this copy can\'t read); it isn\'t counted.' : runs(n) + ' are from a newer Flightdeck (or use a checklist this copy can\'t read); they aren\'t counted.'; }
  };
  function reason(why, whose) { return WHY[why] + (whose ? ', by ' + WHOSE[whose] : ''); }

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function keyOf(r) { return r.process + '/' + r.id; }
  function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function runs(n) { return n === 1 ? '1 run' : num(n) + ' runs'; }
  function units(n, unit) { return unit === 'follow-up' ? (n === 1 ? '1 follow-up' : num(n) + ' follow-ups') : runs(n); }
  function sortNum(xs) { return xs.slice().sort(function (a, b) { return a - b; }); }
  /* Linear interpolation between ranks, so 0.5 is the usual median. */
  function quantile(s, p) {
    if (!s.length) return null;
    var h = (s.length - 1) * p, lo = Math.floor(h);
    return lo + 1 < s.length ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
  }
  function spread(values) {
    var s = sortNum(values.map(function (v) { return v.ms; }));
    return { median: quantile(s, 0.5), q1: s.length >= MIN_RATE ? quantile(s, 0.25) : null, q3: s.length >= MIN_RATE ? quantile(s, 0.75) : null, max: s.length ? s[s.length - 1] : null };
  }
  /* "3 of 4 runs" under 5, "21% · 3 of 14 runs" from 5. */
  function rated(n) { return n >= MIN_RATE; }
  function count(k, n) {
    if (!n) return 'No runs yet';
    return (rated(n) ? Math.round(100 * k / n) + '% · ' : '') + num(k) + ' of ' + runs(n);
  }

  /* ---------- Qualifications: what a number counted, and what it left out and why ---------- */
  /* ex: [{ why, whose, key }]; grouped by reason (and clock) in the order first seen. */
  function qual(unit, countedKeys, ex, incompleteKeys) {
    var by = Object.create(null), out = [];
    (ex || []).forEach(function (x) {
      var g = x.why + '|' + (x.whose || '');
      if (!by[g]) out.push(by[g] = { why: x.why, whose: x.whose || '', reason: reason(x.why, x.whose), keys: [] });
      by[g].keys.push(x.key);
    });
    out.forEach(function (g) { g.n = g.keys.length; g.text = WHOLE[g.why] ? WHOLE[g.why](g.n) : units(g.n, unit) + ' not counted: ' + g.reason + '.'; });
    var inc = incompleteKeys || [], counted = countedKeys.length;
    return { unit: unit, counted: counted, excluded: out, incomplete: inc.length, incompleteKeys: inc,
      cohort: counted + inc.length + out.reduce(function (a, g) { return a + g.n; }, 0) };
  }
  /* The words every view shows after a number: "Not counted: 1 run, a time is later than now, by the recorder's clock;
     2 runs, history incomplete." '' when nothing was left out. hide: reasons a view already says another way. */
  function notCounted(q, hide) {
    if (!q) return '';
    var parts = q.excluded.filter(function (g) { return !hide || hide.indexOf(g.why) < 0; }).map(function (g) { return units(g.n, q.unit) + ', ' + g.reason; });
    if (q.incomplete && !(hide && hide.indexOf('incomplete') >= 0)) parts.push(units(q.incomplete, q.unit) + ', history incomplete');
    return parts.length ? 'Not counted: ' + parts.join('; ') + '.' : '';
  }

  /* Reasons that only restate a number's denominator (a run that never reached the step or the gate): the rest are runs a
     number should have counted and couldn't. A number with any of those, or with history incomplete, always says so. */
  var DEFINITIONAL = { unreached: 1, unanswered: 1, nogate: 1, notneeded: 1, test: 1 };
  function hasProblems(q) { return !!q && (q.incomplete > 0 || q.excluded.some(function (g) { return !DEFINITIONAL[g.why]; })); }

  /* ---------- One time layer: every time Insights uses comes through here ---------- */
  /* Times come from the clock of the computer that wrote them: a run's start, end, gates and pauses from the recorder's; a
     follow-up from the recorder's, its decision from the decider's. A time that can't be read or is before 2000, or is
     later than now, isn't used, and nothing stands in for it. R.sanitize flags a start or end that was there but couldn't
     be read (_badTimes), since cleaning turns that start into 1970 and leaves that end without a time. */
  var EARLIEST = Date.UTC(2000, 0, 1);
  function at(iso, now, whose) {
    var t = typeof iso === 'string' ? Date.parse(iso) : NaN;
    if (isNaN(t) || t < EARLIEST) return { why: 'time' };
    if (t > now) return { why: 'future', whose: whose };
    return { t: t, iso: iso };
  }
  function bad(r, what) { return !!(r._badTimes && r._badTimes[what]); }
  function runStart(r, now) { return bad(r, 'created') ? { why: 'time' } : at(r.created, now, 'recorder'); }
  function runEnd(r, now) { return r.ended && !bad(r, 'ended') ? at(r.ended.at, now, 'recorder') : { why: 'time' }; }
  function gateTime(rec, now) { return rec ? at(rec.at, now, 'recorder') : { why: 'time' }; }
  /* A run's pauses, checked: each readable and not later than now, none ending before it starts, and none starting before
     the one before it ended, which only a clock set back can do (then the run's times can't be trusted and it's left out).
     The pause still under way runs on to whatever end is asked about. { list: [[from, to]] } or { why, whose }. */
  function pausesOf(r, now) {
    if (bad(r, 'pauses') || bad(r, 'paused')) return { why: 'time' };
    var list = [], last = -Infinity, ps = r.pauses || [], i, f, e;
    for (i = 0; i < ps.length; i++) {
      f = at(ps[i] && ps[i].from, now, 'recorder'); if (f.why) return f;
      e = at(ps[i].to, now, 'recorder'); if (e.why) return e;
      if (e.t < f.t || f.t < last) return { why: 'pauses' };
      list.push([f.t, e.t]); last = e.t;
    }
    if (r.paused) {
      f = at(r.paused.at, now, 'recorder'); if (f.why) return f;
      if (f.t < last) return { why: 'pauses' };
      list.push([f.t, Infinity]);
    }
    return { list: list };
  }
  /* Active time from a to b (both already checked), paused time left out: { ms } or { why, whose }. */
  function activeBetween(r, a, b, now) {
    var p = pausesOf(r, now); if (p.why) return p;
    var ms = b - a;
    p.list.forEach(function (x) { var s = Math.max(a, x[0]), e = Math.min(b, x[1]); if (e > s) ms -= e - s; });
    return { ms: Math.max(0, ms) };
  }

  /* ---------- One run, one question: shared by the numbers and by matches(), so a drill-down shows exactly its runs ---------- */
  /* What a run shows for one step: whether it reached it (an answer, an earlier answer or a mark), every kind it ever had
     (marks plus retained answers), and its current answer. */
  function evidence(r, id) {
    var a = own(r.steps, id) ? r.steps[id] : null, m = own(r.marks, id) && Array.isArray(r.marks[id]) ? r.marks[id] : [];
    var set = Object.create(null), reached = m.length > 0;
    m.forEach(function (k) { set[k] = true; });
    if (a) {
      if (a.s && a.s !== 'open') reached = true;
      if ((a.history || []).length) reached = true;
      [a].concat(a.history || []).forEach(function (h) {
        if (!h) return;
        if (h.s === 'blocked' || h.s === 'recheck' || h.s === 'na') set[h.s] = true;
        if (h.differently) set.differently = true;
      });
    }
    return { reached: reached, set: set, current: a && a.s ? a.s : '' };
  }
  /* hit, clean, incomplete, or '' when the run didn't reach the step. */
  function ever(r, ev, metric) {
    if (!ev.reached) return '';
    var s = ev.set, hit = metric === 'offScript' ? !!(s.blocked || s.recheck || s.na || s.differently) : !!s[EVER[metric]];
    if (hit) return 'hit';
    return r.marksFrom === 'start' ? 'clean' : 'incomplete';
  }
  /* The steps a run's own checklist says it didn't need (2.1 conditions), by ID; none without conditions. */
  function notNeededIds(r, m) {
    var out = Object.create(null);
    if (!m || !PF.conditions.any(m)) return out;
    m.phases.forEach(function (p, pi) {
      p.steps.forEach(function (s) {
        if (!(s.when || p.when)) return;
        try { if (R.applies(r, m, pi, s).applies === false) out[s.id] = true; } catch (e) { /* counted as before */ }
      });
    });
    return out;
  }
  /* hit, clean, or '' when the step has no current answer. */
  function skipped(ev) {
    if (ev.current !== 'done' && ev.current !== 'na' && ev.current !== 'blocked') return '';
    return ev.current === 'na' ? 'hit' : 'clean';
  }
  var STATE_OUTCOME = { completed: 'Completed', stopped: 'Stopped early', cancelled: 'Cancelled' };
  /* An end whose time couldn't be read was dropped on load, but the file said how the run ended (_badTimes.ended). */
  function isEnded(r) { return !!r.ended || own(STATE_OUTCOME, r.state) || bad(r, 'ended'); }
  function outcomeOf(r) { return r.ended ? r.ended.outcome || 'Ended' : STATE_OUTCOME[r.state] || (bad(r, 'ended') ? String(r._badTimes.ended) : ''); }
  /* A Completed run's active time, { ms, at } or { why, whose }; null for any other run. */
  function durationOf(r, now) {
    if (outcomeOf(r) !== 'Completed') return null;
    var a = runStart(r, now); if (a.why) return a;
    var b = runEnd(r, now); if (b.why) return b;
    if (b.t < a.t) return { why: 'backward' };
    var c = chronology(r, now, a.t, b.t); if (c) return { why: c.why, whose: c.whose };
    var d = activeBetween(r, a.t, b.t, now); if (d.why) return d;
    return { ms: d.ms, at: b.t };
  }
  /* The run's chronology, as one ordered set of events: the start, every settled gate, every pause (and the one under way)
     and the end must come in order. Each settled gate's time can be read and lies between the start and the end; each pause
     lies between them too; and no gate is settled inside a pause, since a paused run can't pass a gate. Anything else means
     a clock went back. a, b: the start and the end (b null while a run is going or its end can't be read). null when it
     holds, else { why, whose, all, phases: { index: true } }: all when no single phase can be blamed (a pause outside the
     run), else the phases on both sides of each gate out of place. */
  function chronology(r, now, a, b) {
    var m = mapOf(r), idx = Object.create(null), out = null;
    if (m) m.phases.forEach(function (p, pi) { idx[p.gate.id] = pi; });
    function hit(why, pis) {
      out = out || { why: why, all: false, phases: {} };
      if (pis === 'all') out.all = true; else pis.forEach(function (pi) { if (pi != null) out.phases[pi] = true; });
    }
    var ps = pausesOf(r, now);
    if (ps.why) return { why: ps.why, whose: ps.whose, all: true, phases: {} };
    ps.list.forEach(function (x) { if (x[0] < a || (b != null && (x[0] > b || (x[1] !== Infinity && x[1] > b)))) hit('backward', 'all'); });
    Object.keys(r.gates || {}).forEach(function (id) {
      var rec = r.gates[id]; if (!rec || (rec.s !== 'passed' && rec.s !== 'waived' && rec.s !== 'failed')) return;
      var g = gateTime(rec, now), pi = own(idx, id) ? idx[id] : null;
      if (g.why) { if (!out) out = { why: g.why, whose: g.whose, all: false, phases: {} }; if (pi != null) out.phases[pi] = true; else out.all = true; return; }
      if (g.t < a || (b != null && g.t > b)) hit('backward', pi != null ? [pi] : 'all');
      ps.list.forEach(function (x) { if (x[0] < g.t && g.t < x[1]) hit('backward', pi != null ? [pi, pi + 1] : 'all'); });
    });
    return out;
  }
  /* The gate a log line names, by title: [verb, title] for a gate of this checklist, else null. */
  function logGate(l, titles) {
    var w = l && typeof l.what === 'string' ? l.what : '', m = /^(Passed|Waived|Reopened|Failed) gate "/.exec(w);
    if (!m) return null;
    for (var i = 0; i < titles.length; i++) {
      var head = m[0] + titles[i] + '"';
      if (w.indexOf(head) === 0 && (w.length === head.length || /^( for |: )/.test(w.slice(head.length)))) return [m[1], titles[i]];
    }
    return null;
  }
  function titlesOf(map) {
    var by = Object.create(null), list = [];
    map.phases.forEach(function (p, pi) { if (!by[p.gate.title]) { by[p.gate.title] = []; list.push(p.gate.title); } by[p.gate.title].push(pi); });
    /* Longest first, so "Ready" never claims a line about "Ready to ship". */
    return { by: by, list: list.sort(function (a, b) { return b.length - a.length; }) };
  }
  /* Gates that were reopened, by phase index: 'reopened', or 'reopenedShared' when the log's title is shared by two gates
     and so can't say which. In review now; the run's log (run.json keeps its latest 300 entries) says "Reopened gate" or
     settles it more than once; or it settled after the next gate did. Reopening deletes a gate's record and passing it again
     writes a new one, so the record alone can't tell, and the log names gates only by title. */
  /* The run's log, with any entries dropped on load because their time couldn't be read: what they say still counts. */
  function logOf(r) { return bad(r, 'log') ? (r.log || []).concat(r._badTimes.log) : r.log || []; }
  function reopenedGates(r, map, now) {
    var out = {}, T = titlesOf(map), settled = Object.create(null), again = Object.create(null);
    logOf(r).forEach(function (l) {
      var g = logGate(l, T.list); if (!g) return;
      if (g[0] === 'Reopened') again[g[1]] = true; else if (g[0] !== 'Failed') settled[g[1]] = (settled[g[1]] || 0) + 1;
    });
    T.list.forEach(function (t) {
      if (!again[t] && (settled[t] || 0) <= T.by[t].length) return;
      T.by[t].forEach(function (pi) { out[pi] = T.by[t].length > 1 ? 'reopenedShared' : 'reopened'; });
    });
    map.phases.forEach(function (p, pi) {
      var next = map.phases[pi + 1], a = own(r.gates, p.gate.id) ? gateTime(r.gates[p.gate.id], now) : null, b = next && own(r.gates, next.gate.id) ? gateTime(r.gates[next.gate.id], now) : null;
      if (a && b && !a.why && !b.why && a.t > b.t) out[pi] = 'reopened';
    });
    return out;
  }
  /* Each phase's time by phase ID, { ms } or { why, whose }. A phase runs from the previous gate's settle time (the start,
     for the first) to its own gate's; the chain must hold up to that gate, so anything wrong earlier leaves the later phases
     out. A run whose checklist can't be read gets { why: 'checklist' } for every phase of the folder's checklist (ids). */
  function phaseTimes(r, now, ids) {
    var out = Object.create(null), m = mapOf(r);
    if (!m) { (ids || []).forEach(function (id) { out[id] = { why: 'checklist' }; }); return out; }
    var start = runStart(r, now), prev = start.t, broken = start.why ? start : null, again = reopenedGates(r, m, now);
    /* An ended run's end bounds every gate; one it can't read leaves the phases to their own checks. */
    var fin = r.ended ? runEnd(r, now) : null, end = fin && !fin.why ? fin.t : null;
    var chrono = broken ? null : chronology(r, now, start.t, end);
    if (chrono && chrono.all) broken = { why: chrono.why, whose: chrono.whose };
    m.phases.forEach(function (p, pi) {
      if (broken) { out[p.id] = pi === 0 ? broken : { why: 'earlier' }; broken = { why: 'earlier' }; return; }
      var rec = own(r.gates, p.gate.id) ? r.gates[p.gate.id] : null, st = '', why = null;
      try { st = R.gateStatus(r, m, pi); } catch (e) { st = ''; }
      if (chrono && chrono.phases[pi]) why = { why: chrono.why, whose: chrono.whose };
      else if (again[pi]) why = { why: again[pi] };
      else if (rec && (rec.was || rec.s === 'review' || st === 'review')) why = { why: 'reopened' };
      else if (!rec || (rec.s !== 'passed' && rec.s !== 'waived')) why = { why: 'unsettled' };
      else {
        var g = gateTime(rec, now);
        if (g.why) why = g;
        else if (g.t < prev || (end != null && g.t > end)) why = { why: 'backward' };
        else {
          var d = activeBetween(r, prev, g.t, now);
          if (d.why) why = d; else { out[p.id] = { ms: d.ms }; prev = g.t; return; }
        }
      }
      out[p.id] = why; broken = { why: 'earlier' };
    });
    return out;
  }
  /* A gate waived (now) or failed (now, or by the log), by the gate's ID: its record is by ID; the log names gates by title,
     so a failure there counts only when no other gate shares the title, else the run is left out of "failed" as 'shared'.
     { reached, waived, failed } with reached false when there's no record of the gate. */
  function gateKinds(r, map, pi) {
    var g = map.phases[pi].gate, rec = own(r.gates, g.id) ? r.gates[g.id] : null, T = titlesOf(map), shared = T.by[g.title].length > 1;
    var logFailed = false, logSeen = false;
    logOf(r).forEach(function (l) { var x = logGate(l, T.list); if (x && x[1] === g.title) { logSeen = true; if (x[0] === 'Failed') logFailed = true; } });
    var waived = !!rec && rec.s === 'waived', failedNow = !!rec && rec.s === 'failed';
    if (!rec && (!logSeen || shared)) return { reached: false, shared: shared && logSeen };
    return { reached: true, waived: waived, failed: failedNow || (logFailed && !shared), shared: !failedNow && logFailed && shared };
  }
  function mapOf(r) { try { return R.mapOf(r); } catch (e) { return null; } }
  function counted(r, includeRunning) { return isEnded(r) || !!includeRunning; }
  function stateOf(r) { return isEnded(r) ? outcomeOf(r) : 'running'; }

  /* ---------- The numbers for one process and one publication folder ---------- */
  /* input: { runs, runStatus: { key: 'unread' | 'missing' }, failedParts, decisionsUnread: { corrections, followups },
     loading: { done, total } | null, corrections (PF.corrections.forProcess), followUps (PF.followups.list) }
     opts: { now (required), folder (required), includeRunning } */
  function forProcess(input, process, opts) {
    input = input || {}; opts = opts || {};
    var now = opts.now;
    if (typeof now !== 'number' || !isFinite(now)) throw new Error('Insights need an explicit now, in milliseconds.');
    if (!opts.folder) throw new Error('Insights need a publication folder: versions are never pooled.');
    var folder = String(opts.folder), status = input.runStatus || {}, failed = input.failedParts || {}, inc = !!opts.includeRunning;
    var runEx = [], base = [], baseSet = Object.create(null), known = Object.create(null), version = opts.version != null ? opts.version : null;
    (input.runs || []).forEach(function (r) {
      if (r) known[keyOf(r)] = true;
      /* Test runs (2.1) are never counted: each of the process's is said once, on whichever version is shown. */
      if (r && r.process === process && R.isTest(r)) { runEx.push({ why: 'test', key: keyOf(r) }); return; }
      if (!r || r.process !== process || r.folder !== folder) return;
      if (version == null && r.version != null) version = r.version;
      var k = keyOf(r), why = whyOut(r, status);
      if (why) runEx.push({ why: why, key: k }); else { base.push(r); baseSet[k] = r; }
    });
    /* Unreadable on its first read, with no earlier copy: its version can't be known, so it's said on every version. */
    Object.keys(status).forEach(function (k) { if (status[k] === 'unread' && !known[k] && k.indexOf(process + '/') === 0) runEx.push({ why: 'unknown', key: k }); });
    var res = { process: process, folder: folder, version: base.length ? base[0].version : version, now: now, includeRunning: inc,
      final: !input.loading, loading: input.loading || null, notes: [] };
    if (input.loading) res.notes.push('Still reading runs' + (input.loading.total != null ? ' (' + num(input.loading.done || 0) + ' of ' + num(input.loading.total) + ')' : '') + '. These numbers aren\'t final.');
    if (failed.runs) res.notes.push('The runs folder couldn\'t be read on the last check; these numbers come from the last read.');

    /* Runs, by state and outcome. */
    var outcomes = {}, runningKeys = [];
    base.forEach(function (r) { var s = stateOf(r); if (s === 'running') runningKeys.push(keyOf(r)); else (outcomes[s] = outcomes[s] || []).push(keyOf(r)); });
    var rq = qual('run', base.map(keyOf), runEx);
    res.excluded = rq.excluded;
    res.runs = { n: base.length, keys: base.map(keyOf), running: runningKeys.length, runningKeys: runningKeys, outcomes: outcomes, q: rq };
    var pool = base.filter(function (r) { return counted(r, inc); });
    res.pool = { n: pool.length, keys: pool.map(keyOf), note: !inc && runningKeys.length ? runs(runningKeys.length) + ' still going ' + (runningKeys.length === 1 ? 'isn\'t' : 'aren\'t') + ' in the step and phase numbers yet.' : '' };
    res.history = { incomplete: pool.filter(function (r) { return r.marksFrom !== 'start'; }).map(keyOf) };

    /* Completed duration. */
    var dVals = [], dEx = [];
    base.forEach(function (r) {
      var d = durationOf(r, now); if (!d) return;
      if (d.why) dEx.push({ why: d.why, whose: d.whose, key: keyOf(r) }); else dVals.push({ key: keyOf(r), ms: d.ms, at: d.at });
    });
    var dq = qual('run', dVals.map(function (v) { return v.key; }), dEx);
    res.duration = Object.assign({ n: dVals.length, of: dq.cohort, keys: dVals.map(function (v) { return v.key; }), values: dVals, excluded: dq.excluded, q: dq }, spread(dVals));

    /* The checklist: every run of a folder shares it; each run is still read against its own copy. */
    var map = null;
    for (var i = 0; i < base.length && !map; i++) map = mapOf(base[i]);
    var phases = map ? map.phases : [], phaseIds = phases.map(function (p) { return p.id; });
    var phaseAcc = Object.create(null), stepAcc = Object.create(null);
    phases.forEach(function (p) {
      phaseAcc[p.id] = { values: [], ex: [], waived: { keys: [], counted: [], ex: [] }, failed: { keys: [], counted: [], ex: [] } };
      p.steps.forEach(function (s) { stepAcc[s.id] = newStep(); });
    });
    pool.forEach(function (r) {
      var m = mapOf(r), k = keyOf(r), pt = phaseTimes(r, now, phaseIds);
      phases.forEach(function (p) {
        var acc = phaseAcc[p.id], x = pt[p.id] || { why: 'checklist' };
        if (x.why) acc.ex.push({ why: x.why, whose: x.whose, key: k }); else acc.values.push({ key: k, ms: x.ms });
      });
      phases.forEach(function (p, pi) {
        var acc = phaseAcc[p.id], g = m && m.phases[pi] && m.phases[pi].id === p.id ? gateKinds(r, m, pi) : null;
        if (!g) { acc.waived.ex.push({ why: 'checklist', key: k }); acc.failed.ex.push({ why: 'checklist', key: k }); return; }
        if (!g.reached) { acc.waived.ex.push({ why: g.shared ? 'shared' : 'nogate', key: k }); acc.failed.ex.push({ why: g.shared ? 'shared' : 'nogate', key: k }); return; }
        acc.waived.counted.push(k); if (g.waived) acc.waived.keys.push(k);
        if (g.shared) acc.failed.ex.push({ why: 'shared', key: k }); else { acc.failed.counted.push(k); if (g.failed) acc.failed.keys.push(k); }
      });
      var nn = notNeededIds(r, m);
      Object.keys(stepAcc).forEach(function (sid) {
        var acc = stepAcc[sid];
        /* Conditions (2.1): a step this run didn't need isn't in its numbers at all. */
        if (nn[sid]) { ['skipped'].concat(EVER_KEYS).forEach(function (metric) { acc[metric].ex.push({ why: 'notneeded', key: k }); }); return; }
        var ev = evidence(r, sid), sk = skipped(ev);
        if (sk) { acc.skipped.counted.push(k); if (sk === 'hit') acc.skipped.keys.push(k); } else acc.skipped.ex.push({ why: 'unanswered', key: k });
        EVER_KEYS.forEach(function (metric) {
          var v = ever(r, ev, metric), x = acc[metric];
          if (!v) x.ex.push({ why: 'unreached', key: k });
          else if (v === 'incomplete') x.incompleteKeys.push(k);
          else { x.counted.push(k); if (v === 'hit') x.keys.push(k); }
        });
      });
    });
    res.phases = phases.map(function (p) {
      var acc = phaseAcc[p.id], q = qual('run', acc.values.map(function (v) { return v.key; }), acc.ex);
      var gq = function (x) { var gqq = qual('run', x.counted, x.ex); return { hits: x.keys.length, n: x.counted.length, keys: x.keys, q: gqq }; };
      return Object.assign({ id: p.id, title: p.title, n: acc.values.length, of: q.cohort, keys: acc.values.map(function (v) { return v.key; }), values: acc.values, excluded: q.excluded, q: q,
        gate: { title: p.gate.title, waived: gq(acc.waived), failed: gq(acc.failed) } }, spread(acc.values));
    });

    /* Corrections: distinct runs of this folder with a correction on the step; groups counted by where each stands. A run that
       didn't need the step (2.1 conditions) is left out of its numbers, as for the others. */
    var nnMemo = Object.create(null), nnOf = function (k) { return nnMemo[k] || (nnMemo[k] = notNeededIds(baseSet[k], mapOf(baseSet[k]))); };
    var corr = Object.create(null), decSig = Object.create(null);
    (input.corrections || []).forEach(function (g) {
      var sid = g && g.target && g.target.step; if (!sid || !stepAcc[sid]) return;
      var st = g.tie ? 'tie' : String(g.status || 'open'), c = corr[sid] = corr[sid] || { runs: Object.create(null), groups: {} }, mine = false;
      (g.members || []).forEach(function (mb) {
        if (mb.folder !== folder) return;
        var k = process + '/' + mb.run; if (!baseSet[k] || nnOf(k)[sid]) return;
        c.runs[k] = true; mine = true;
        decSig[k] = (decSig[k] || '') + 'c' + (g.id || sid) + '=' + st + (g.decision ? '@' + (g.decision.rev || 0) : '') + ';';
      });
      if (mine) c.groups[st] = (c.groups[st] || 0) + 1;
    });
    var du = input.decisionsUnread || {};
    res.corrections = { note: du.corrections ? (du.corrections === 1 ? '1 decision on corrections couldn\'t be read; those corrections may show the wrong status.' : num(du.corrections) + ' decisions on corrections couldn\'t be read; those corrections may show the wrong status.')
      : failed.corrections ? 'Decisions on corrections couldn\'t be read on the last check; those corrections may show the wrong status.' : '' };

    res.steps = [];
    phases.forEach(function (p) {
      p.steps.forEach(function (s) {
        var acc = stepAcc[s.id], c = corr[s.id];
        var out = { id: s.id, text: s.text, textParts: s.textParts, phase: p.id, skipped: { hits: acc.skipped.keys.length, n: acc.skipped.counted.length, keys: acc.skipped.keys, q: qual('run', acc.skipped.counted, acc.skipped.ex) } };
        EVER_KEYS.forEach(function (metric) {
          var x = acc[metric];
          out[metric] = { hits: x.keys.length, n: x.counted.length, keys: x.keys, incomplete: x.incompleteKeys.length, incompleteKeys: x.incompleteKeys, q: qual('run', x.counted, x.ex, x.incompleteKeys) };
        });
        var ck = c ? Object.keys(c.runs) : [];
        var cn = base.map(keyOf).filter(function (k) { return !nnOf(k)[s.id]; }), cx = base.map(keyOf).filter(function (k) { return nnOf(k)[s.id]; }).map(function (k) { return { why: 'notneeded', key: k }; });
        out.corrections = { hits: ck.length, n: cn.length, keys: ck, groups: c ? c.groups : {}, q: qual('run', cn, cx) };
        res.steps.push(out);
      });
    });

    res.followUps = followUps(input, process, baseSet, now, du, failed, decSig);
    res.roles = R.rotation(base, process);
    /* What a drill-down compares to say a run changed: its file, plus its decisions and whether it can be read. */
    res.sig = {};
    (input.runs || []).forEach(function (r) { if (r && r.process === process && (r.folder === folder || R.isTest(r))) { var k = keyOf(r); res.sig[k] = runSig(r) + '|' + whyOut(r, status) + '|' + (decSig[k] || ''); } });
    return res;
  }
  /* Why a whole run is left out of every number, or ''. */
  function whyOut(r, status) {
    var st = own(status, keyOf(r)) ? status[keyOf(r)] : '';
    return st === 'unread' || st === 'missing' ? st : r._unrunnable ? 'newer' : '';
  }
  function newStep() {
    var e = function () { return { keys: [], counted: [], ex: [], incompleteKeys: [] }; };
    return { skipped: e(), blocked: e(), redone: e(), na: e(), differently: e(), offScript: e() };
  }
  /* Open follow-ups by age, and time to the current decision. A follow-up's own time (f.at, by the recorder's clock) is used,
     never a stand-in such as the run's end; its decision's time is by the decider's clock. */
  function followUps(input, process, baseSet, now, du, failed, decSig) {
    decSig = decSig || {};
    var mine = (input.followUps || []).filter(function (x) { return x && x.process === process && baseSet[x.runKey]; });
    var buckets = BUCKETS.map(function (b) { return { id: b.id, label: b.label, items: [], keys: [] }; }), openItems = [], openEx = [];
    var dVals = [], dItems = [], dEx = [];
    function addKey(list, k) { if (list.indexOf(k) < 0) list.push(k); }
    mine.forEach(function (x) {
      var added = at(x.f ? x.f.at : null, now, 'recorder');
      decSig[x.runKey] = (decSig[x.runKey] || '') + 'f' + x.id + '=' + x.status + (x.decision ? '@' + (x.decision.rev || 0) + (x.decision._file || '') : '') + (x.tie ? 'tie' : '') + ';';
      if (x.status === 'open') {
        if (added.why) { openEx.push({ why: added.why, whose: added.whose, key: x.key }); return; }
        var age = now - added.t, b = buckets[age < 7 * DAY ? 0 : age <= 30 * DAY ? 1 : 2];
        openItems.push(x.key); b.items.push(x.key); addKey(b.keys, x.runKey);
        return;
      }
      if (!x.decision) { dEx.push({ why: 'undecided', key: x.key }); return; }
      var decided = at(x.decision.at, now, 'decider');
      var w = added.why ? added : decided.why ? decided : null;
      if (w) { dEx.push({ why: w.why, whose: w.whose, key: x.key }); return; }
      if (decided.t < added.t) { dEx.push({ why: 'decidedBefore', key: x.key }); return; }
      dItems.push(x.key); dVals.push({ key: x.runKey, item: x.key, ms: decided.t - added.t });
    });
    var dKeys = []; dVals.forEach(function (v) { addKey(dKeys, v.key); });
    var oq = qual('follow-up', openItems, openEx), dq = qual('follow-up', dItems, dEx);
    return {
      note: du.followups ? (du.followups === 1 ? '1 decision couldn\'t be read; that follow-up may show the wrong status.' : num(du.followups) + ' decisions couldn\'t be read; those follow-ups may show the wrong status.')
        : failed['follow-ups'] ? 'Decisions on follow-ups couldn\'t be read on the last check; those follow-ups may show the wrong status.' : '',
      open: { n: openItems.length, clock: 'by the recorder\'s clock', buckets: buckets, excluded: oq.excluded, q: oq },
      decided: Object.assign({ n: dVals.length, clock: 'by the recorder\'s and the decider\'s clocks', keys: dKeys, values: dVals, excluded: dq.excluded, q: dq }, spread(dVals))
    };
  }

  /* ---------- Drill-downs: the runs behind one number ---------- */
  /* path: runs:all · runs:running · runs:o:<outcome> · ex:<why> · dur · phase:<id> · gate:<phase id>:waived|failed ·
     step:<id>:<metric>[:incomplete] · fu:<bucket> · fu:decided. A path whose number has gone to zero still answers, with no
     runs, so Show current numbers can show that. */
  function stepOf(res, id) { for (var i = 0; i < res.steps.length; i++) if (res.steps[i].id === id) return res.steps[i]; return null; }
  function phaseOf(res, id) { for (var i = 0; i < res.phases.length; i++) if (res.phases[i].id === id) return res.phases[i]; return null; }
  var METRIC_WORDS = { skipped: 'N/A now', corrections: 'has a correction' };
  function select(res, path) {
    var p = String(path || '').split(':'), x;
    if (p[0] === 'runs' && p[1] === 'all') return { keys: res.runs.keys, label: 'Every run' };
    if (p[0] === 'runs' && p[1] === 'running') return { keys: res.runs.runningKeys, label: 'Still going' };
    if (p[0] === 'runs' && p[1] === 'o' && p.length > 2) { var o = p.slice(2).join(':'); return { keys: own(res.runs.outcomes, o) ? res.runs.outcomes[o] : [], label: 'Ended ' + o }; }
    if (p[0] === 'ex' && own(WHY, p[1])) { x = res.excluded.filter(function (e) { return e.why === p[1]; })[0]; return { keys: x ? x.keys : [], label: 'Not counted: ' + (x ? x.text : 'runs whose ' + WHY[p[1]]) }; }
    if (p[0] === 'dur' && p.length === 1) return { keys: res.duration.keys, label: 'Completed runs with readable times' };
    if (p[0] === 'phase' && (x = phaseOf(res, p[1]))) return { keys: x.keys, label: 'Phase "' + x.title + '" timed' };
    if (p[0] === 'gate' && (x = phaseOf(res, p[1])) && (p[2] === 'waived' || p[2] === 'failed')) return { keys: x.gate[p[2]].keys, label: 'Gate "' + x.gate.title + '" ' + (p[2] === 'waived' ? 'waived' : 'failed at least once') };
    if (p[0] === 'step' && (x = stepOf(res, p[1])) && x[p[2]]) {
      var words = '"' + x.text + '": ' + (EVER_WORDS[p[2]] || METRIC_WORDS[p[2]]);
      if (p[3] === 'incomplete') return x[p[2]].incompleteKeys ? { keys: x[p[2]].incompleteKeys, label: '"' + x.text + '": history incomplete' } : null;
      return p.length === 3 ? { keys: x[p[2]].keys, label: words } : null;
    }
    if (p[0] === 'fu' && p[1] === 'decided') return { keys: res.followUps.decided.keys, label: 'Follow-ups decided: ' + fuIn(res.followUps.decided.n, res.followUps.decided.keys.length) };
    if (p[0] === 'fu') { x = res.followUps.open.buckets.filter(function (b) { return b.id === p[1]; })[0]; return x ? { keys: x.keys, label: 'Follow-ups open ' + x.label.toLowerCase() + ': ' + fuIn(x.items.length, x.keys.length) } : null; }
    return null;
  }
  /* "3 follow-ups in 1 run": a drill-down shows runs, and a run can hold several follow-ups. */
  function fuIn(items, keys) { return (items === 1 ? '1 follow-up' : num(items) + ' follow-ups') + ' in ' + runs(keys); }
  function runSig(r) { return (r._fileHash || '') + ':' + (r.rev || 0) + ':' + ((r._notes || []).length); }
  /* A run's signature for "changed since": its file, and, from a result (res.sig), its decisions and readability. */
  function sigOf(k, by, res) { return res && res.sig && own(res.sig, k) ? res.sig[k] : by[k] ? runSig(by[k]) + '||' : ''; }
  /* What a drill-down keeps: the runs behind the number, as of when it was clicked. */
  function spec(res, path, all) {
    var sel = select(res, path); if (!sel) return null;
    var by = Object.create(null); (all || []).forEach(function (r) { if (r) by[keyOf(r)] = r; });
    var sigs = {}; sel.keys.forEach(function (k) { sigs[k] = sigOf(k, by, res); });
    return { process: res.process, folder: res.folder, version: res.version, path: String(path), label: sel.label, keys: sel.keys.slice(), asOf: res.now, includeRunning: res.includeRunning, sigs: sigs };
  }
  /* How many of a drill-down's runs changed or went since it was clicked. res: the same number worked out now, so a decision
     or a run that can no longer be read counts as a change too. */
  function changed(sp, all, res) {
    var by = Object.create(null); (all || []).forEach(function (r) { if (r) by[keyOf(r)] = r; });
    return (sp.keys || []).filter(function (k) { return !by[k] || sigOf(k, by, res) !== sp.sigs[k]; }).length;
  }
  /* Whether one run belongs to a number, by the same per-run rules forProcess uses, so the runs select() returns for a number
     are exactly the runs matches() picks (test/insights.test.js checks every path, with these same inputs). That is why Show
     current numbers works the number out again through forProcess and select(): it's this question asked of every run.
     ctx: { now (defaults to the spec's asOf), runStatus, followUps, corrections }, the same as forProcess's input. */
  function matches(r, sp, ctx) {
    ctx = ctx || {};
    if (!r || r.process !== sp.process || r.folder !== sp.folder) return false;
    var p = String(sp.path || '').split(':'), k = keyOf(r), m, x, now = ctx.now != null ? ctx.now : sp.asOf;
    var why = whyOut(r, ctx.runStatus || {});
    if (p[0] === 'ex') return !!why && why === p[1];
    if (why) return false;
    if (p[0] === 'runs') return p[1] === 'all' || (p[1] === 'running' ? !isEnded(r) : p[1] === 'o' && isEnded(r) && stateOf(r) === p.slice(2).join(':'));
    if (p[0] === 'dur') { x = durationOf(r, now); return !!x && !x.why; }
    if (p[0] === 'fu') {
      var one = Object.create(null); one[k] = r;
      var fu = followUps({ followUps: ctx.followUps }, r.process, one, now, {}, {});
      x = p[1] === 'decided' ? fu.decided.keys : (fu.open.buckets.filter(function (b) { return b.id === p[1]; })[0] || { keys: [] }).keys;
      return x.indexOf(k) >= 0;
    }
    if (p[0] === 'step' && p[2] === 'corrections') {
      if (notNeededIds(r, mapOf(r))[p[1]]) return false;
      return (ctx.corrections || []).some(function (g) {
        return g && g.target && g.target.step === p[1] && (g.members || []).some(function (mb) { return mb.folder === sp.folder && sp.process + '/' + mb.run === k; });
      });
    }
    if (!counted(r, sp.includeRunning)) return false;
    if (p[0] === 'phase') { x = phaseTimes(r, now)[p[1]]; return !!x && !x.why; }
    if (p[0] === 'gate') { m = mapOf(r); if (!m) return false; for (var i = 0; i < m.phases.length; i++) if (m.phases[i].id === p[1]) { x = gateKinds(r, m, i); return !!x.reached && !!x[p[2]]; } return false; }
    if (p[0] === 'step') {
      if (notNeededIds(r, mapOf(r))[p[1]]) return false;
      var ev = evidence(r, p[1]);
      if (p[2] === 'skipped') return skipped(ev) === 'hit';
      if (!own(EVER_WORDS, p[2])) return false;
      return ever(r, ev, p[2]) === (p[3] === 'incomplete' ? 'incomplete' : 'hit');
    }
    return false;
  }

  /* ---------- Choosing a folder, and filtering the Runs page ---------- */
  /* Every publication folder of a process that has runs or is published, newest version first; same-number folders are a clash. */
  function folders(all, process, pubs, clashes) {
    var by = Object.create(null), out = [];
    function add(folder, version) { if (!folder) return null; if (!by[folder]) out.push(by[folder] = { folder: folder, version: +version || 0, clash: false, runs: 0 }); return by[folder]; }
    (pubs || []).forEach(function (p) { if (p && p.info) add(p.info.folder, p.info.version); });
    /* A test run's stage is never a version to choose (2.1). */
    (all || []).forEach(function (r) { if (r && r.process === process && !R.isTest(r) && !PF.publish.STAGE.test(String(r.folder))) { var f = add(r.folder, r.version); if (f) f.runs++; } });
    var seen = {}; out.forEach(function (f) { seen[f.version] = (seen[f.version] || 0) + 1; });
    out.forEach(function (f) { f.clash = (clashes || []).indexOf(f.version) >= 0 || seen[f.version] > 1; });
    return out.sort(function (a, b) { return b.version - a.version || (a.folder < b.folder ? -1 : 1); });
  }
  /* f: { process, folder, outcome ('running' or an outcome), from, through ('YYYY-MM-DD', inclusive, in local time) }. */
  function localDay(ymd, end) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3] + (end ? 1 : 0)).getTime() - (end ? 1 : 0);
  }
  function filterRuns(all, f) {
    f = f || {};
    var from = localDay(f.from, false), through = localDay(f.through, true);
    return (all || []).filter(function (r) {
      if (f.process && r.process !== f.process) return false;
      if (f.folder && r.folder !== f.folder) return false;
      if (f.outcome && (f.outcome === 'running' ? isEnded(r) : outcomeOf(r) !== f.outcome)) return false;
      if (from != null || through != null) {
        var t = runStart(r, Infinity).t;
        if (t == null || (from != null && t < from) || (through != null && t > through)) return false;
      }
      return true;
    });
  }

  return { evidence: evidence, DEFS: DEFS, FEW: FEW, MIN_RATE: MIN_RATE, BUCKETS: BUCKETS, forProcess: forProcess, count: count, rated: rated, num: num, select: select, spec: spec, changed: changed,
    matches: matches, runSig: runSig, folders: folders, filterRuns: filterRuns, notCounted: notCounted, hasProblems: hasProblems };
})();
