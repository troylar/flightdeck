/* Insights: how runs of one publication folder went (docs/design.md section 23). Pure, with an explicit now. Every number says
   what it counts and out of how many runs, and lists the runs it couldn't count and why. Runs are grouped by their exact
   publication folder, never by version number, so two clashing v5 folders never merge and versions are never pooled. "Ever"
   numbers read the run's durable marks as well as the answers it still holds, so a block archived out of run.json still
   counts; a run that didn't keep marks from its start and shows nothing is "history incomplete", never clean. */
PF.insights = (function () {
  'use strict';
  var R = PF.run;
  var MIN_RATE = 5, DAY = 86400000;
  var FEW = 'Too few runs for a rate yet.';
  var SAME = 'The same as Ever blocked';
  /* The definitions people read under "How these are counted"; docs/design.md section 23 holds the same table (a test checks). */
  var DEFS = [
    { id: 'runs', name: 'Runs', counts: 'Readable runs of this publication folder, by state and outcome', denominator: '—' },
    { id: 'duration', name: 'Completed duration', counts: 'Active time from start to end of Completed runs, paused time left out; the median, and the middle half from 5 runs', denominator: 'Completed runs whose times can be read and don\'t go backward' },
    { id: 'phase', name: 'Phase time', counts: 'From the previous gate\'s settle time (the start, for the first phase) to this gate\'s, paused time left out', denominator: 'Runs whose gates up to this one are all passed or waived and never reopened, with times that can be read and don\'t go backward' },
    { id: 'skipped', name: 'Skipped (N/A)', counts: 'Runs whose current answer is N/A', denominator: 'Runs where the step has a current answer: done, N/A or blocked' },
    { id: 'blocked', name: 'Ever blocked', counts: 'Runs where the step was blocked at least once: its marks, its current answer or an earlier one still in the run', denominator: 'Runs that reached the step (an answer or a mark); a run without a full record (history incomplete) that shows nothing is counted apart, never as clean' },
    { id: 'redone', name: 'Ever redone', counts: 'Runs where the step was sent back for a re-check at least once, from its marks and answers', denominator: SAME },
    { id: 'na', name: 'Ever N/A', counts: 'Runs where the step was N/A at least once, from its marks and answers', denominator: SAME },
    { id: 'differently', name: 'Done differently', counts: 'Runs where the step was done differently at least once, from its marks and answers', denominator: SAME },
    { id: 'offScript', name: 'Any off-script', counts: 'Runs with at least one of blocked, redone, N/A or done differently on the step, each run counted once', denominator: SAME },
    { id: 'corrections', name: 'Corrections', counts: 'Runs with a correction on the step, by where its group stands', denominator: 'Readable runs of this publication folder' },
    { id: 'fuAge', name: 'Follow-up age', counts: 'Open follow-ups by how long since they were added: under 7 days, 7 to 30, over 30, by the recorder\'s clock', denominator: 'Open follow-ups whose time can be read' },
    { id: 'fuDecide', name: 'Time to a decision', counts: 'From when a follow-up was added to its current decision (the highest rev), by the deciders\' clocks', denominator: 'Decided follow-ups whose times can be read and don\'t go backward' }
  ];
  /* The "ever" metrics and the mark each reads. */
  var EVER = { blocked: 'blocked', redone: 'recheck', na: 'na', differently: 'differently' };
  var EVER_WORDS = { blocked: 'blocked at least once', redone: 'redone at least once', na: 'N/A at least once', differently: 'done differently at least once', offScript: 'off-script at least once' };
  var PHASE_WHY = {
    unsettled: 'the gate wasn\'t passed or waived',
    reopened: 'the gate was reopened',
    earlier: 'an earlier gate isn\'t settled, was reopened or has a time that can\'t be used',
    time: 'a time couldn\'t be read',
    backward: 'the times go backward'
  };
  var BUCKETS = [{ id: 'lt7', label: 'Under 7 days' }, { id: 'd7to30', label: '7 to 30 days' }, { id: 'gt30', label: 'Over 30 days' }];

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function keyOf(r) { return r.process + '/' + r.id; }
  function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function runs(n) { return n === 1 ? '1 run' : num(n) + ' runs'; }
  function timeOf(iso) { return typeof iso === 'string' ? Date.parse(iso) : NaN; }
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
  /* Excluded runs, grouped by reason, in the order the reasons are listed. */
  function grouped(list, texts) {
    var by = Object.create(null), out = [];
    list.forEach(function (x) { if (!by[x.why]) out.push(by[x.why] = { why: x.why, keys: [] }); by[x.why].keys.push(x.key); });
    out.forEach(function (g) { g.text = texts(g.why, g.keys.length); });
    return out;
  }
  function notCounted(why, n) { return runs(n) + ' not counted: ' + why + '.'; }

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
  /* hit, clean, or '' when the step has no current answer. */
  function skipped(ev) {
    if (ev.current !== 'done' && ev.current !== 'na' && ev.current !== 'blocked') return '';
    return ev.current === 'na' ? 'hit' : 'clean';
  }
  /* A Completed run's active time, { ms } or { why }; null for any other run. */
  function durationOf(r) {
    if (!r.ended || r.ended.outcome !== 'Completed') return null;
    var a = timeOf(r.created), b = timeOf(r.ended.at);
    if (isNaN(a) || isNaN(b)) return { why: 'time' };
    if (b < a) return { why: 'backward' };
    return { ms: R.activeMs(r, r.created, b) };
  }
  /* Each phase's time by phase ID, { ms } or { why }. A phase runs from the previous gate's settle time (the start, for the
     first) to its own gate's; the chain must hold up to that gate, so anything wrong earlier leaves the later phases out. */
  function phaseTimes(r, map) {
    var out = Object.create(null), prevIso = r.created, prev = timeOf(r.created), broken = isNaN(prev) ? 'time' : '';
    map.phases.forEach(function (p, pi) {
      if (broken) { out[p.id] = { why: pi === 0 ? broken : 'earlier' }; broken = 'earlier'; return; }
      var rec = own(r.gates, p.gate.id) ? r.gates[p.gate.id] : null, st = '';
      try { st = R.gateStatus(r, map, pi); } catch (e) { st = ''; }
      var why = '';
      if (rec && (rec.was || rec.s === 'review' || st === 'review')) why = 'reopened';
      else if (!rec || (rec.s !== 'passed' && rec.s !== 'waived')) why = 'unsettled';
      else {
        var t = timeOf(rec.at);
        if (isNaN(t)) why = 'time'; else if (t < prev) why = 'backward';
        else { out[p.id] = { ms: R.activeMs(r, prevIso, t) }; prevIso = rec.at; prev = t; return; }
      }
      out[p.id] = { why: why }; broken = 'earlier';
    });
    return out;
  }
  function mapOf(r) { try { return R.mapOf(r); } catch (e) { return null; } }
  function counted(r, includeRunning) { return !!r.ended || !!includeRunning; }
  function stateOf(r) { return r.ended ? r.ended.outcome || 'Ended' : 'running'; }

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
    var ex = { unread: [], missing: [], newer: [] }, base = [], baseSet = Object.create(null);
    (input.runs || []).forEach(function (r) {
      if (!r || r.process !== process || r.folder !== folder) return;
      var k = keyOf(r), st = own(status, k) ? status[k] : '';
      if (st === 'unread') ex.unread.push(k);
      else if (st === 'missing') ex.missing.push(k);
      else if (r._unrunnable) ex.newer.push(k);
      else { base.push(r); baseSet[k] = r; }
    });
    var res = { process: process, folder: folder, version: base.length ? base[0].version : null, now: now, includeRunning: inc,
      final: !input.loading, loading: input.loading || null, notes: [], excluded: [] };
    if (input.loading) res.notes.push('Still reading runs' + (input.loading.total != null ? ' (' + num(input.loading.done || 0) + ' of ' + num(input.loading.total) + ')' : '') + '. These numbers aren\'t final.');
    if (failed.runs) res.notes.push('The runs folder couldn\'t be read on the last check; these numbers come from the last read.');
    if (ex.unread.length) res.excluded.push({ why: 'unread', keys: ex.unread, text: ex.unread.length === 1 ? '1 run couldn\'t be read; its last copy isn\'t counted.' : runs(ex.unread.length) + ' couldn\'t be read; their last copies aren\'t counted.' });
    if (ex.missing.length) res.excluded.push({ why: 'missing', keys: ex.missing, text: ex.missing.length === 1 ? '1 run\'s file is gone from the team folder; its last copy isn\'t counted.' : runs(ex.missing.length) + '\' files are gone from the team folder; their last copies aren\'t counted.' });
    if (ex.newer.length) res.excluded.push({ why: 'newer', keys: ex.newer, text: ex.newer.length === 1 ? '1 run is from a newer Flightdeck (or uses a checklist this copy can\'t read); it isn\'t counted.' : runs(ex.newer.length) + ' are from a newer Flightdeck (or use a checklist this copy can\'t read); they aren\'t counted.' });

    /* Runs, by state and outcome. */
    var outcomes = {}, runningKeys = [];
    base.forEach(function (r) { var s = stateOf(r); if (s === 'running') runningKeys.push(keyOf(r)); else (outcomes[s] = outcomes[s] || []).push(keyOf(r)); });
    res.runs = { n: base.length, keys: base.map(keyOf), running: runningKeys.length, runningKeys: runningKeys, outcomes: outcomes };
    var pool = base.filter(function (r) { return counted(r, inc); });
    res.pool = { n: pool.length, keys: pool.map(keyOf), note: !inc && runningKeys.length ? runs(runningKeys.length) + ' still going ' + (runningKeys.length === 1 ? 'isn\'t' : 'aren\'t') + ' in the step and phase numbers yet.' : '' };
    res.history = { incomplete: pool.filter(function (r) { return r.marksFrom !== 'start'; }).map(keyOf) };

    /* Completed duration. */
    var dVals = [], dEx = [], completed = 0;
    base.forEach(function (r) {
      var d = durationOf(r); if (!d) return;
      completed++;
      if (d.why) dEx.push({ why: d.why, key: keyOf(r) }); else dVals.push({ key: keyOf(r), ms: d.ms });
    });
    res.duration = Object.assign({ n: dVals.length, of: completed, keys: dVals.map(function (v) { return v.key; }), values: dVals,
      excluded: grouped(dEx, function (why, n) { return notCounted(why === 'time' ? 'a time couldn\'t be read' : 'it ends before it starts', n); }) }, spread(dVals));

    /* The checklist: every run of a folder shares it; each run is still read against its own copy. */
    var map = null;
    for (var i = 0; i < base.length && !map; i++) map = mapOf(base[i]);
    var phaseAcc = Object.create(null), stepAcc = Object.create(null);
    var phases = map ? map.phases : [];
    phases.forEach(function (p) { phaseAcc[p.id] = { values: [], ex: [] }; p.steps.forEach(function (s) { stepAcc[s.id] = newStep(); }); });
    pool.forEach(function (r) {
      var m = mapOf(r), k = keyOf(r);
      if (!m) return;
      var pt = phaseTimes(r, m);
      Object.keys(pt).forEach(function (pid) { var acc = phaseAcc[pid]; if (!acc) return; if (pt[pid].why) acc.ex.push({ why: pt[pid].why, key: k }); else acc.values.push({ key: k, ms: pt[pid].ms }); });
      Object.keys(stepAcc).forEach(function (sid) {
        var acc = stepAcc[sid], ev = evidence(r, sid), sk = skipped(ev);
        if (sk) { acc.skipped.n++; if (sk === 'hit') acc.skipped.keys.push(k); }
        if (!ev.reached) return;
        ['blocked', 'redone', 'na', 'differently', 'offScript'].forEach(function (metric) {
          var v = ever(r, ev, metric), x = acc[metric];
          if (v === 'incomplete') x.incompleteKeys.push(k);
          else { x.n++; if (v === 'hit') x.keys.push(k); }
        });
      });
    });
    res.phases = phases.map(function (p) {
      var acc = phaseAcc[p.id];
      return Object.assign({ id: p.id, title: p.title, n: acc.values.length, of: pool.length, keys: acc.values.map(function (v) { return v.key; }), values: acc.values,
        excluded: grouped(acc.ex, function (why, n) { return notCounted(PHASE_WHY[why], n); }) }, spread(acc.values));
    });

    /* Corrections: distinct runs of this folder with a correction on the step, by where its group stands. */
    var corr = Object.create(null);
    (input.corrections || []).forEach(function (g) {
      var sid = g && g.target && g.target.step; if (!sid || !stepAcc[sid]) return;
      var st = g.tie ? 'tie' : String(g.status || 'open'), c = corr[sid] = corr[sid] || { runs: Object.create(null), by: {} };
      (g.members || []).forEach(function (mb) {
        if (mb.folder !== folder) return;
        var k = process + '/' + mb.run; if (!baseSet[k]) return;
        c.runs[k] = true; (c.by[st] = c.by[st] || Object.create(null))[k] = true;
      });
    });
    var du = input.decisionsUnread || {};
    res.corrections = { note: du.corrections ? (du.corrections === 1 ? '1 decision on corrections couldn\'t be read; those corrections may show the wrong status.' : num(du.corrections) + ' decisions on corrections couldn\'t be read; those corrections may show the wrong status.')
      : failed.corrections ? 'Decisions on corrections couldn\'t be read on the last check; those corrections may show the wrong status.' : '' };

    res.steps = [];
    phases.forEach(function (p) {
      p.steps.forEach(function (s) {
        var acc = stepAcc[s.id], c = corr[s.id], by = {};
        if (c) Object.keys(c.by).forEach(function (st) { by[st] = Object.keys(c.by[st]).length; });
        var out = { id: s.id, text: s.text, phase: p.id, skipped: { hits: acc.skipped.keys.length, n: acc.skipped.n, keys: acc.skipped.keys } };
        ['blocked', 'redone', 'na', 'differently', 'offScript'].forEach(function (metric) {
          var x = acc[metric]; out[metric] = { hits: x.keys.length, n: x.n, keys: x.keys, incomplete: x.incompleteKeys.length, incompleteKeys: x.incompleteKeys };
        });
        out.corrections = { hits: c ? Object.keys(c.runs).length : 0, n: base.length, keys: c ? Object.keys(c.runs) : [], byStatus: by };
        res.steps.push(out);
      });
    });

    res.followUps = followUps(input, process, baseSet, now, du, failed);
    res.roles = R.rotation(base, process);
    return res;
  }
  function newStep() {
    var e = function () { return { n: 0, keys: [], incompleteKeys: [] }; };
    return { skipped: { n: 0, keys: [] }, blocked: e(), redone: e(), na: e(), differently: e(), offScript: e() };
  }
  /* Open follow-ups by age (the recorder's clock), and time to the current decision (the deciders' clocks). */
  function followUps(input, process, baseSet, now, du, failed) {
    var mine = (input.followUps || []).filter(function (x) { return x && x.process === process && baseSet[x.runKey]; });
    var buckets = BUCKETS.map(function (b) { return { id: b.id, label: b.label, items: [], keys: [] }; }), openEx = [], openN = 0;
    var dVals = [], dEx = [];
    function addKey(list, k) { if (list.indexOf(k) < 0) list.push(k); }
    mine.forEach(function (x) {
      var added = timeOf(x.at);
      if (x.status === 'open') {
        if (isNaN(added)) { openEx.push({ why: 'time', key: x.runKey }); return; }
        var age = now - added;
        if (age < 0) { openEx.push({ why: 'future', key: x.runKey }); return; }
        openN++;
        var b = buckets[age < 7 * DAY ? 0 : age <= 30 * DAY ? 1 : 2];
        b.items.push(x.key); addKey(b.keys, x.runKey);
        return;
      }
      if (!x.decision || x.tie) return;
      var decided = timeOf(x.decision.at);
      if (isNaN(added) || isNaN(decided)) { dEx.push({ why: 'time', key: x.runKey }); return; }
      if (decided < added) { dEx.push({ why: 'backward', key: x.runKey }); return; }
      dVals.push({ key: x.runKey, item: x.key, ms: decided - added });
    });
    var fuWhy = { time: 'a time couldn\'t be read', future: 'it was added later than now, by the recorder\'s clock', backward: 'it was decided before it was added, by these clocks' };
    var fuText = function (why, n) { return (n === 1 ? '1 follow-up' : num(n) + ' follow-ups') + ' not counted: ' + fuWhy[why] + '.'; };
    var dKeys = []; dVals.forEach(function (v) { addKey(dKeys, v.key); });
    return {
      note: du.followups ? (du.followups === 1 ? '1 decision couldn\'t be read; that follow-up may show the wrong status.' : num(du.followups) + ' decisions couldn\'t be read; those follow-ups may show the wrong status.')
        : failed['follow-ups'] ? 'Decisions on follow-ups couldn\'t be read on the last check; those follow-ups may show the wrong status.' : '',
      open: { n: openN, clock: 'by the recorder\'s clock', buckets: buckets, excluded: grouped(openEx, fuText) },
      decided: Object.assign({ n: dVals.length, clock: 'by the deciders\' clocks', keys: dKeys, values: dVals, excluded: grouped(dEx, fuText) }, spread(dVals))
    };
  }

  /* ---------- Drill-downs: the runs behind one number ---------- */
  /* path: runs:all · runs:running · runs:o:<outcome> · ex:<why> · dur · phase:<id> · step:<id>:<metric>[:incomplete] · fu:<bucket> · fu:decided */
  function stepOf(res, id) { for (var i = 0; i < res.steps.length; i++) if (res.steps[i].id === id) return res.steps[i]; return null; }
  function phaseOf(res, id) { for (var i = 0; i < res.phases.length; i++) if (res.phases[i].id === id) return res.phases[i]; return null; }
  var METRIC_WORDS = { skipped: 'N/A now', corrections: 'has a correction' };
  function select(res, path) {
    var p = String(path || '').split(':'), x;
    if (p[0] === 'runs' && p[1] === 'all') return { keys: res.runs.keys, label: 'Every run' };
    if (p[0] === 'runs' && p[1] === 'running') return { keys: res.runs.runningKeys, label: 'Still going' };
    if (p[0] === 'runs' && p[1] === 'o' && own(res.runs.outcomes, p.slice(2).join(':'))) return { keys: res.runs.outcomes[p.slice(2).join(':')], label: 'Ended ' + p.slice(2).join(':') };
    if (p[0] === 'ex') { x = res.excluded.filter(function (e) { return e.why === p[1]; })[0]; return x ? { keys: x.keys, label: 'Not counted: ' + x.text } : null; }
    if (p[0] === 'dur' && p.length === 1) return { keys: res.duration.keys, label: 'Completed runs with readable times' };
    if (p[0] === 'phase' && (x = phaseOf(res, p[1]))) return { keys: x.keys, label: 'Phase "' + x.title + '" timed' };
    if (p[0] === 'step' && (x = stepOf(res, p[1])) && x[p[2]]) {
      var words = '"' + x.text + '": ' + (EVER_WORDS[p[2]] || METRIC_WORDS[p[2]]);
      if (p[3] === 'incomplete') return x[p[2]].incompleteKeys ? { keys: x[p[2]].incompleteKeys, label: '"' + x.text + '": history incomplete' } : null;
      return p.length === 3 ? { keys: x[p[2]].keys, label: words } : null;
    }
    if (p[0] === 'fu' && p[1] === 'decided') return { keys: res.followUps.decided.keys, label: 'Follow-ups decided' };
    if (p[0] === 'fu') { x = res.followUps.open.buckets.filter(function (b) { return b.id === p[1]; })[0]; return x ? { keys: x.keys, label: 'Follow-ups open ' + x.label.toLowerCase() } : null; }
    return null;
  }
  function runSig(r) { return (r._fileHash || '') + ':' + (r.rev || 0) + ':' + ((r._notes || []).length); }
  /* What a drill-down keeps: the runs behind the number, as of when it was clicked. */
  function spec(res, path, all) {
    var sel = select(res, path); if (!sel) return null;
    var by = Object.create(null); (all || []).forEach(function (r) { if (r) by[keyOf(r)] = r; });
    var sigs = {}; sel.keys.forEach(function (k) { sigs[k] = by[k] ? runSig(by[k]) : ''; });
    return { process: res.process, folder: res.folder, version: res.version, path: String(path), label: sel.label, keys: sel.keys.slice(), asOf: res.now, includeRunning: res.includeRunning, sigs: sigs };
  }
  /* How many of a drill-down's runs changed or went since it was clicked. */
  function changed(sp, all) {
    var by = Object.create(null); (all || []).forEach(function (r) { if (r) by[keyOf(r)] = r; });
    return (sp.keys || []).filter(function (k) { return !by[k] || runSig(by[k]) !== sp.sigs[k]; }).length;
  }
  /* Whether one run belongs to a number, by the same rules the number uses (its cohort exclusions aside: unreadable, gone).
     ctx: { now, followUps } for follow-up numbers. */
  function matches(r, sp, ctx) {
    if (!r || r.process !== sp.process || r.folder !== sp.folder || r._unrunnable) return false;
    var p = String(sp.path || '').split(':'), k = keyOf(r), m, x;
    if (p[0] === 'runs') return p[1] === 'all' || (p[1] === 'running' ? !r.ended : p[1] === 'o' && !!r.ended && stateOf(r) === p.slice(2).join(':'));
    if (p[0] === 'dur') { x = durationOf(r); return !!x && !x.why; }
    if (!counted(r, sp.includeRunning) && (p[0] === 'phase' || p[0] === 'step')) return false;
    if (p[0] === 'phase') { m = mapOf(r); x = m && phaseTimes(r, m)[p[1]]; return !!x && !x.why; }
    if (p[0] === 'step') {
      var ev = evidence(r, p[1]);
      if (p[2] === 'skipped') return skipped(ev) === 'hit';
      if (p[2] === 'corrections') return false;
      if (!own(EVER_WORDS, p[2])) return false;
      return ever(r, ev, p[2]) === (p[3] === 'incomplete' ? 'incomplete' : 'hit');
    }
    if (p[0] === 'fu' && ctx) {
      var res = followUps({ followUps: ctx.followUps }, r.process, (function () { var o = Object.create(null); o[k] = r; return o; })(), ctx.now, {}, {});
      x = p[1] === 'decided' ? res.decided.keys : (res.open.buckets.filter(function (b) { return b.id === p[1]; })[0] || { keys: [] }).keys;
      return x.indexOf(k) >= 0;
    }
    return false;
  }

  /* ---------- Choosing a folder, and filtering the Runs page ---------- */
  /* Every publication folder of a process that has runs or is published, newest version first; same-number folders are a clash. */
  function folders(all, process, pubs, clashes) {
    var by = Object.create(null), out = [];
    function add(folder, version) { if (!folder) return null; if (!by[folder]) out.push(by[folder] = { folder: folder, version: +version || 0, clash: false, runs: 0 }); return by[folder]; }
    (pubs || []).forEach(function (p) { if (p && p.info) add(p.info.folder, p.info.version); });
    (all || []).forEach(function (r) { if (r && r.process === process) { var f = add(r.folder, r.version); if (f) f.runs++; } });
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
      if (f.outcome && (f.outcome === 'running' ? !!r.ended : !r.ended || r.ended.outcome !== f.outcome)) return false;
      if (from != null || through != null) {
        var t = timeOf(r.created);
        if (isNaN(t) || (from != null && t < from) || (through != null && t > through)) return false;
      }
      return true;
    });
  }

  return { DEFS: DEFS, FEW: FEW, MIN_RATE: MIN_RATE, BUCKETS: BUCKETS, forProcess: forProcess, count: count, rated: rated, num: num, select: select, spec: spec, changed: changed,
    matches: matches, runSig: runSig, folders: folders, filterRuns: filterRuns, evidence: evidence, durationOf: durationOf, phaseTimes: phaseTimes };
})();
