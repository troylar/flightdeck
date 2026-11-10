/* Plan versus now, and a living run's receipt (4.0 slice 6, docs/design.md 45.5). Pure: no files, no clocks.

   Plan versus now compares the frozen checklist (the steps its version published) with the work the run has now: the to-dos
   its chain of applications landed, the requests not landed yet (asked, queued for the recorder, waiting, held, disputed or
   declined, never counted as applied) and a loop's items and spreads. Nothing here is a second plan anyone edits. Every
   number names its denominator, and the checklist's steps, a loop's items and the run's to-dos are three lines, never one.

   A receipt is the record a living run ends with: a kind "receipt" record in proposals/ (flightdeck-plan/4), written once by
   the recorder's window before the run is saved, which names it (run.json living.receipt) in the same checked save that sets
   ended. It holds the work head, plan versus now's numbers, each spread's coverage, the evidence each done rested on (facts
   and runs, by identity) and the keeps (corrections) the run filed: bounded lists, refused whole when over a limit, never
   cut. It never enters the to-do order or the chain. What arrives after (a request, a story resolving its obligation) is
   shown apart and never rewrites the ended outcome. */
PF.receipts = (function () {
  'use strict';
  var LIMITS = { refs: 500, spreads: 50, count: 1000000, answer: 80, result: 60, seen: 50 };
  /* Plan versus now's numbers, in this order. steps/answered: the checklist; items/cleared/abandoned: a loop's items (every loop
     of the run); todos/resolved/done/wont/moved and where moved work went (ticket, toRun, link); asked/added and the additions
     not landed by status; applied/pending: every request; owed/covered: spreads' obligations. */
  var COUNTS = ['steps', 'answered', 'items', 'cleared', 'abandoned', 'todos', 'resolved', 'done', 'wont', 'moved', 'ticket', 'toRun', 'link',
    'asked', 'added', 'queued', 'waiting', 'held', 'disputed', 'declined', 'applied', 'pending', 'owed', 'covered'];
  var KEYS = ['format', 'features', 'app', 'kind', 'id', 'run', 'seen', 'by', 'at', 'outcome', 'head', 'counts', 'coverage', 'evidence', 'keeps'];
  var OUTCOMES = ['Completed', 'Stopped early', 'Cancelled'];
  var REQ = /^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}$/, STATUS = /^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}\.status-[a-z0-9][a-z0-9-]{0,39}-[0-9a-f]{8}$/;
  var TD = /^td-[0-9a-f]{24}$/, SP = /^sp-[0-9a-f]{24}$/, FP = /^[0-9a-f]{16}$/, PLAN = /^plan-ev-[0-9a-f]{24}$/;
  var PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, RUN = /^[a-z0-9-]{1,40}$/i, PERSON = /^[A-Za-z0-9_.-]{1,80}$/;
  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/, CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
  var REQ_WORDS = { queued: 'queued for the recorder', waiting: 'waiting for approval', held: 'held', disputed: 'disputed', declined: 'declined' };

  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function q(k) { return '"' + String(k).slice(0, 70) + '"'; }
  function only(o, keys, what, errors) { Object.keys(o).forEach(function (k) { if (keys.indexOf(k) < 0) errors.push(what + ' has ' + q(k) + '.'); }); }
  function count(v) { return typeof v === 'number' && v % 1 === 0 && v >= 0 && v <= LIMITS.count; }
  function recId(x) { return typeof x === 'string' && (REQ.test(x) || STATUS.test(x)); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function mapOf(r) { try { return PF.run.mapOf(r); } catch (e) { return null; } }

  /* ---- Plan versus now ---- */
  /* Every loop of the run, as PF.loop.view reads it; null for one that can't be read here. o: { loops: { records, unread,
     procOf }, runs }. */
  function loopsOf(r, map, o) {
    var out = [];
    (map ? map.phases : []).forEach(function (p) { p.steps.forEach(function (s) {
      if (s.type !== 'for.each') return;
      var V = null;
      if (o && o.loops) { try { V = PF.loop.view(r, s.id, { records: o.loops.records || [], unread: o.loops.unread || [], runs: o.runs || [], procOf: o.loops.procOf }); } catch (e) { V = null; } }
      out.push({ step: s.id, view: V && !V.ledger.held.length ? V : null });
    }); });
    return out;
  }
  /* The numbers, from the run, its to-do view (PF.todos.view), its spreads' coverage (PF.spreads.coverage, or null) and its
     loops (loopsOf). Requests not landed are counted by their status, never as applied. */
  function tally(r, map, T, cov, loops) {
    var n = Object.create(null); COUNTS.forEach(function (k) { n[k] = 0; });
    var t = PF.run.totals(r, map); n.steps = t.total; n.answered = t.done;
    (loops || []).forEach(function (L) {
      if (!L.view) return;
      L.view.rollup.items.forEach(function (i) {
        if (!i.required) return;
        n.items++;
        if (i.status === 'cleared' || i.status === 'exception') n.cleared++;
        else if (i.status === 'stopped') n.abandoned++;
      });
    });
    (T ? T.todos : []).forEach(function (x) {
      n.todos++;
      if (x.state === 'open') return;
      n.resolved++; n[x.state]++;
      if (x.state === 'moved' && x.to) { if (x.to.ticket) n.ticket++; else if (x.to.run) n.toRun++; else if (x.to.link) n.link++; }
    });
    (T ? PF.todos.requestsOf(T) : []).forEach(function (q1) {
      var st = q1.status;
      if (st === 'applied') n.applied++; else if (st !== 'declined') n.pending++;
      if (q1.op !== 'add') return;
      n.asked++;
      if (st === 'applied') n.added++; else if (own(REQ_WORDS, st)) n[st]++;
    });
    ((cov && cov.spreads) || []).forEach(function (C) { if (!C.counts) return; n.owed += C.counts.owed; n.covered += C.counts.resolved; });
    var out = {}; COUNTS.forEach(function (k) { out[k] = n[k]; });
    return out;
  }
  /* The lines and chips plan versus now shows, from its numbers alone (so a receipt's frozen numbers read the same way). */
  function words(n, coverage) {
    var lines = ['This checklist: ' + n.answered + ' of ' + n.steps + ' current steps answered'];
    if (n.items) lines.push('Items: ' + n.cleared + ' of ' + n.items + ' cleared' + (n.abandoned ? ' · ' + n.abandoned + ' abandoned' : ''));
    if (n.todos) lines.push('To-dos: ' + n.resolved + ' of ' + n.todos + ' resolved');
    var chips = [], rest = function (keys) { return keys.filter(function (k) { return n[k]; }).map(function (k) { return n[k] + ' ' + REQ_WORDS[k]; }); };
    if (n.asked) chips.push({ id: 'additions', words: 'Additions: ' + n.added + ' of ' + plural(n.asked, 'asked', 'asked') + ' applied' + rest(['queued', 'waiting', 'held', 'disputed', 'declined']).map(function (x) { return ' · ' + x; }).join('') });
    if (n.todos) {
      var to = [n.ticket ? plural(n.ticket, 'to a ticket', 'to tickets') : '', n.toRun ? plural(n.toRun, 'to another run', 'to other runs') : '', n.link ? plural(n.link, 'to a link', 'to links') : ''].filter(Boolean);
      chips.push({ id: 'resolutions', words: 'Resolved: ' + n.resolved + ' of ' + plural(n.todos, 'to-do') + (n.done ? ' · ' + n.done + ' done' : '') + (n.wont ? ' · ' + n.wont + ' won\'t do' : '') + (n.moved ? ' · ' + n.moved + ' moved' + (to.length ? ' (' + to.join(', ') + ')' : '') : '') });
    }
    if (n.owed) chips.push({ id: 'coverage', words: 'Coverage: ' + n.covered + ' of ' + plural(n.owed, 'owed item') + ' resolved' + (coverage && coverage.length > 1 ? ' across ' + coverage.length + ' spreads' : '') });
    if (n.applied || n.pending) chips.push({ id: 'changes', words: 'Changes: ' + n.applied + ' of ' + plural(n.applied + n.pending, 'request') + ' applied' + (n.pending ? ' · ' + n.pending + ' not applied yet' : '') });
    return { lines: lines, chips: chips };
  }
  /* Plan versus now for a run as it is. o: { loops, runs } for its items. Returns { counts, lines, chips, phases, coverage }:
     phases, the frozen checklist's phases each with its planned steps and the to-dos landed on it. */
  function compare(r, map, T, cov, o) {
    var loops = loopsOf(r, map, o), n = tally(r, map, T, cov, loops), w = words(n, coverageOf(cov));
    var phases = (map ? map.phases : []).map(function (p) {
      var mine = (T ? T.todos : []).filter(function (x) { var P = PF.todos.placeOf(map, x.target); return !P.why && P.phaseId === p.id; });
      return { id: p.id, title: p.title, steps: p.steps.length, todos: mine.length, open: mine.filter(function (x) { return x.state === 'open'; }).length };
    });
    return { counts: n, lines: w.lines, chips: w.chips, phases: phases, coverage: coverageOf(cov), unread: loops.filter(function (L) { return !L.view; }).map(function (L) { return L.step; }) };
  }
  function coverageOf(cov) { return ((cov && cov.spreads) || []).filter(function (C) { return C.counts; }).map(function (C) { return { spread: C.id, owed: C.counts.owed, resolved: C.counts.resolved }; }); }
  /* What a spread's coverage can't be worked out from: fail closed (a loop or a child that can't be read). */
  function coverageWhy(cov) {
    var bad = ((cov && cov.spreads) || []).filter(function (C) { return !C.counts || (!C.items.length && C.unresolved.length) || C.items.some(function (i) { return i.state === 'unread'; }); })[0];
    return bad ? 'Spread "' + bad.text + '": its coverage can\'t be worked out here' + (bad.unresolved[0] ? ' (' + bad.unresolved[0] + ')' : '') + '.' : '';
  }

  /* ---- The receipt record ---- */
  /* The evidence each done to-do rested on, by identity: a fact (its id and content fingerprint) or a run's result. */
  function evidenceOf(T) {
    var out = [];
    (T ? T.todos : []).forEach(function (x) {
      if (x.state !== 'done') return;
      if (x.support) out.push({ todo: x.id, fact: x.support.fact, content: x.support.content });
      else if (x.evidence) out.push({ todo: x.id, plan: x.evidence.plan, run: { process: x.evidence.run.process, id: x.evidence.run.id }, answer: x.evidence.answer, result: x.evidence.result });
    });
    return out;
  }
  /* The keeps (corrections kept for next time) filed on the run: their ids. */
  function keepsOf(records, r) { return (records || []).filter(function (x) { return x && x.kind === 'keep' && x.run && x.run.process === r.process && x.run.id === r.id; }).map(function (x) { return x.id; }).filter(function (id, i, a) { return a.indexOf(id) === i; }).sort(cmpStr); }
  function bodyOf(b) { return { head: b.head, outcome: b.outcome, seen: b.seen, counts: b.counts, coverage: b.coverage, evidence: b.evidence, keeps: b.keeps }; }
  /* A receipt is named by its run and what it says, never who or when: preparing it again on the run as it stands is the same
     file, and anything that changed since is another. */
  function idFor(run, b) { return 'req-receipt-' + PF.sha256.hex(JSON.stringify(['receipt', run.process, run.id, PF.todos.fingerprint(bodyOf(b))])).slice(0, 24); }
  function build(o) {
    var f = { format: PF.todos.FORMAT, features: [PF.todos.FEATURE] };
    if (PF.envelope.semver(o.app)) f.app = o.app;
    var b = bodyOf(o);
    f.kind = 'receipt'; f.id = idFor(o.run, b); f.run = { process: o.run.process, id: o.run.id }; f.seen = b.seen.slice(); f.by = o.by; f.at = o.at;
    f.outcome = b.outcome; f.head = b.head; f.counts = b.counts; f.coverage = b.coverage; f.evidence = b.evidence; f.keeps = b.keeps;
    return f;
  }
  function cleanEvidence(v, i, errors) {
    var w = '"evidence" ' + (i + 1);
    if (!isMap(v)) { errors.push(w + ' is {"todo", "fact", "content"} or {"todo", "plan", "run", "answer", "result"}.'); return null; }
    var n0 = errors.length;
    if (own(v, 'fact')) {
      only(v, ['todo', 'fact', 'content'], w, errors);
      if (typeof v.todo !== 'string' || !TD.test(v.todo)) errors.push(w + ' "todo" is a to-do id.');
      if (typeof v.fact !== 'string' || !REQ.test(v.fact)) errors.push(w + ' "fact" is a fact\'s id.');
      if (typeof v.content !== 'string' || !FP.test(v.content)) errors.push(w + ' "content" is the fact\'s content fingerprint.');
      return errors.length > n0 ? null : { todo: v.todo, fact: v.fact, content: v.content };
    }
    only(v, ['todo', 'plan', 'run', 'answer', 'result'], w, errors);
    if (typeof v.todo !== 'string' || !TD.test(v.todo)) errors.push(w + ' "todo" is a to-do id.');
    if (typeof v.plan !== 'string' || !PLAN.test(v.plan)) errors.push(w + ' "plan" is the to-do\'s evidence plan (plan-ev-...).');
    var r = v.run;
    if (!isMap(r) || Object.keys(r).length !== 2 || typeof r.process !== 'string' || !PROC.test(r.process) || typeof r.id !== 'string' || !RUN.test(r.id)) errors.push(w + ' "run" is {"process", "id"}.');
    if (typeof v.answer !== 'string' || !v.answer.trim() || v.answer.length > LIMITS.answer || CONTROL.test(v.answer)) errors.push(w + ' "answer" is the run\'s answer, as Flightdeck records it.');
    if (typeof v.result !== 'string' || v.result.length > LIMITS.result || CONTROL.test(v.result)) errors.push(w + ' "result" is the run\'s result, at most ' + LIMITS.result + ' characters.');
    return errors.length > n0 ? null : { todo: v.todo, plan: v.plan, run: { process: r.process, id: r.id }, answer: v.answer, result: v.result };
  }
  /* A receipt record read back (PF.todos.cleanFile hands it over once the format and feature are checked): { ok, record } or a
     refusal. Every field is checked whole; a list over its limit is refused, never cut. */
  function cleanFile(o, name, mal) {
    if (typeof o.id !== 'string' || !REQ.test(o.id)) return mal('is a receipt without a request id');
    if (typeof name === 'string' && !PF.todos.requestFile(name, o.id)) return mal('is a receipt whose name isn\'t its id');
    var errors = [];
    only(o, KEYS, 'It', errors);
    var rec = { id: o.id, kind: 'receipt', run: null, seen: null, by: null, at: '', outcome: '', head: '', counts: null, coverage: null, evidence: null, keeps: null };
    var run = o.run;
    if (!isMap(run) || Object.keys(run).length !== 2 || typeof run.process !== 'string' || !PROC.test(run.process) || typeof run.id !== 'string' || !RUN.test(run.id)) errors.push('"run" is {"process": <checklist>, "id": <run id>}.');
    else rec.run = { process: run.process, id: run.id };
    if (!Array.isArray(o.seen) || o.seen.length > LIMITS.seen || !o.seen.every(recId)) errors.push('"seen" is a list of at most ' + LIMITS.seen + ' to-do record ids.');
    else if (o.seen.some(function (x, i) { return o.seen.indexOf(x) !== i; })) errors.push('"seen" names a record twice.');
    else rec.seen = o.seen.slice();
    if (typeof o.by !== 'string' || !PERSON.test(o.by)) errors.push('"by" is the ID from people.json of the person who ended the run.'); else rec.by = { person: o.by };
    if (typeof o.at !== 'string' || !ISO.test(o.at)) errors.push('"at" is a date and time.'); else rec.at = o.at;
    if (OUTCOMES.indexOf(o.outcome) < 0) errors.push('"outcome" is Completed, Stopped early or Cancelled.'); else rec.outcome = o.outcome;
    if (typeof o.head !== 'string' || !PF.todos.cleanLiving({ head: o.head })) errors.push('"head" is the run\'s last application.'); else rec.head = o.head;
    var c = o.counts;
    if (!isMap(c)) errors.push('"counts" is {' + COUNTS.map(function (k) { return '"' + k + '"'; }).join(', ') + '}.');
    else {
      var n0 = errors.length;
      only(c, COUNTS, '"counts"', errors);
      COUNTS.forEach(function (k) { if (!count(c[k])) errors.push('"counts" "' + k + '" is a whole number from 0 to ' + LIMITS.count + '.'); });
      if (errors.length === n0) { rec.counts = {}; COUNTS.forEach(function (k) { rec.counts[k] = c[k]; }); }
    }
    if (!Array.isArray(o.coverage) || o.coverage.length > LIMITS.spreads) errors.push('"coverage" is a list of at most ' + LIMITS.spreads + ' spreads.');
    else {
      var cv = [];
      o.coverage.forEach(function (x, i) {
        var w = '"coverage" ' + (i + 1);
        if (!isMap(x)) { errors.push(w + ' is {"spread", "owed", "resolved"}.'); return; }
        var n1 = errors.length;
        only(x, ['spread', 'owed', 'resolved'], w, errors);
        if (typeof x.spread !== 'string' || !SP.test(x.spread)) errors.push(w + ' "spread" is a spread id.');
        else if (cv.some(function (y) { return y.spread === x.spread; })) errors.push(w + ' names ' + x.spread + ' again.');
        if (!count(x.owed) || !count(x.resolved)) errors.push(w + ' "owed" and "resolved" are whole numbers.');
        if (errors.length === n1) cv.push({ spread: x.spread, owed: x.owed, resolved: x.resolved });
      });
      rec.coverage = cv;
    }
    if (!Array.isArray(o.evidence) || o.evidence.length > LIMITS.refs) errors.push('"evidence" is a list of at most ' + LIMITS.refs + ' to-dos\' evidence.');
    else {
      var ev = [];
      o.evidence.forEach(function (x, i) { var e = cleanEvidence(x, i, errors); if (e) { if (ev.some(function (y) { return y.todo === e.todo; })) errors.push('"evidence" ' + (i + 1) + ' names ' + e.todo + ' again.'); else ev.push(e); } });
      rec.evidence = ev;
    }
    if (!Array.isArray(o.keeps) || o.keeps.length > LIMITS.refs || !o.keeps.every(function (x) { return typeof x === 'string' && REQ.test(x); })) errors.push('"keeps" is a list of at most ' + LIMITS.refs + ' keep ids.');
    else if (o.keeps.some(function (x, i) { return o.keeps.indexOf(x) !== i; })) errors.push('"keeps" names a keep twice.');
    else rec.keeps = o.keeps.slice();
    if (!errors.length && o.id !== idFor(rec.run, rec)) errors.push('Its id isn\'t the one its run and what it says give.');
    if (errors.length) return mal('is a receipt that isn\'t in its format: ' + errors[0]);
    return { ok: true, record: rec };
  }

  /* The receipt a living run ends with, prepared on the run as it stands (not ended yet): { none } for a run that isn't living
     (it ends exactly as in 3.0), { why } when it can't be (nothing is ended), else { id, name, file, record, counts, words }.
     Fail closed: a to-do record, the loop or a spread's coverage that can't be read, a chain that can't be walked, or a list
     over its limit refuses it, before anything is written. o: { outcome, by, at, app, records, unread, people, evidence, now,
     loops, runs }. */
  function prepare(r, o) {
    o = o || {};
    if (!r || !r.living) return { none: true };
    if (r._unrunnable) return { why: r._unrunnable };
    if (r.ended) return { why: 'The run has ended already.' };
    if (OUTCOMES.indexOf(o.outcome) < 0) return { why: 'Unknown outcome.' };
    var map = mapOf(r), tail = ' The receipt couldn\'t say what was done, so the run wasn\'t ended.';
    if (!map) return { why: 'This run\'s checklist can\'t be read.' + tail };
    var records = o.records || [], unread = (o.unread || []).filter(function (u) { return u && (!u.run || (u.run.process === r.process && u.run.id === r.id)); });
    var T = PF.todos.view(r, { records: PF.todos.recordsFor(records, r), unread: unread, people: o.people, now: o.now, deps: { records: records, unread: o.unread || [], evidence: o.evidence || null } });
    if (T.broken) return { why: T.broken.why + tail };
    if (T.unread.length) return { why: 'A to-do record (' + String(T.unread[0].file || '').slice(0, 120) + ') can\'t be read yet.' + tail };
    if (T.held.length) return { why: 'A to-do record (' + T.held[0].record + ') can\'t be read in order yet.' + tail };
    var loops = loopsOf(r, map, o), lost = loops.filter(function (L) { return !L.view; })[0];
    if (lost) return { why: 'The loop ' + lost.step + ' or its scope records can\'t be read here.' + tail };
    var cov = T.spreads.length ? PF.spreads.coverage(r, T, { runs: o.runs || [], records: records, unread: o.unread || [], people: o.people, loops: o.loops, now: o.now, evidence: o.evidence || null }) : null;
    var cw = coverageWhy(cov);
    if (cw) return { why: cw + tail };
    if (T.heads.length > LIMITS.seen) return { why: T.heads.length + ' to-do records are unsettled at once; a receipt sees at most ' + LIMITS.seen + '. Settle some open decisions first. Nothing was ended.' };
    var b = { head: r.living.head, outcome: o.outcome, seen: T.heads.slice().sort(cmpStr), counts: tally(r, map, T, cov, loops), coverage: coverageOf(cov), evidence: evidenceOf(T), keeps: keepsOf(records, r) };
    if (b.evidence.length > LIMITS.refs) return { why: 'The receipt would name the evidence of ' + b.evidence.length + ' to-dos; a receipt names at most ' + LIMITS.refs + '. Nothing was cut and nothing was ended.' };
    if (b.keeps.length > LIMITS.refs) return { why: 'The receipt would name ' + b.keeps.length + ' keeps; a receipt names at most ' + LIMITS.refs + '. Nothing was cut and nothing was ended.' };
    var f = build(Object.assign({ run: { process: r.process, id: r.id }, by: o.by, at: o.at, app: o.app }, b)), fd = PF.todos.filed(f.id + '.json', f);
    if (fd.why) return { why: 'The receipt can\'t be written: ' + fd.why.charAt(0).toLowerCase() + fd.why.slice(1) + ' Nothing was ended.' };
    var w = words(b.counts, b.coverage);
    return { id: f.id, name: f.id + '.json', file: f, record: fd.record, counts: b.counts, lines: w.lines, chips: w.chips };
  }

  /* How an ended living run's receipt stands: null for a run that isn't an ended living run; else { state, why, path, kind,
     record }. confirmed: the record named is in the folder, read, and says this run's head and outcome. none: it ended
     without one (a run ended before receipts). missing, unread or mismatch: a problem, named by its path. */
  function stateOf(r, records, unread) {
    if (!r || !r.living || !r.ended) return null;
    var id = r.living.receipt;
    if (!id) return { state: 'none', why: 'It ended without a receipt record.', path: '', kind: '', record: null };
    var path = 'proposals/' + id + '.json';
    var un = (unread || []).filter(function (u) { return u && PF.todos.requestFile(u.file, id); })[0];
    if (un) return { state: 'unread', why: 'Its receipt (' + id + ') can\'t be read: ' + String(un.why || 'unreadable'), path: path, kind: un.kind === 'newer' ? 'newer' : un.kind === 'unreadable' ? 'unreadable' : 'malformed', record: null };
    var mine = (records || []).filter(function (x) { return x && x.kind === 'receipt' && x.id === id; });
    if (!mine.length) return { state: 'missing', why: 'Its receipt (' + id + ') isn\'t in the folder, so what it ended with can\'t be confirmed.', path: path, kind: 'nofile', record: null };
    var rec = mine[0];
    if (mine.some(function (x) { return JSON.stringify(PF.todos.fingerprint(bodyOf(x))) !== JSON.stringify(PF.todos.fingerprint(bodyOf(rec))); })) return { state: 'mismatch', why: 'Its receipt (' + id + ') has two different copies in the folder.', path: path, kind: 'malformed', record: null };
    if (!rec.run || rec.run.process !== r.process || rec.run.id !== r.id) return { state: 'mismatch', why: 'Its receipt (' + id + ') is another run\'s.', path: path, kind: 'malformed', record: null };
    if (rec.head !== r.living.head || rec.outcome !== r.ended.outcome) return { state: 'mismatch', why: 'Its receipt (' + id + ') doesn\'t say what the run ended with (its work head or outcome differs).', path: path, kind: 'malformed', record: null };
    return { state: 'confirmed', why: '', path: path, kind: '', record: rec };
  }

  /* What arrived after a receipt, shown apart and never counted in its outcome: the run's to-do records it didn't see (requests
     filed after the end, decisions on them; they stay notices), and each spread's obligations resolved since. rec: the
     receipt record (stateOf's). cov: the coverage now, or null. */
  function since(r, rec, records, cov) {
    var mine = PF.todos.recordsFor(records, r).filter(function (x) { return PF.todos.notFact(x) && x.kind !== 'receipt'; });
    var c = PF.loop.causal(mine.concat([{ id: rec.id, seen: rec.seen }]));
    var lost = c.held.some(function (h) { return h.record === rec.id; });
    var after = lost ? [] : mine.filter(function (x) { return x.id !== rec.id && !c.saw(rec.id, x.id); });
    var asks = after.filter(function (x) { return x.kind === 'proposal' || x.kind === 'compound'; });
    var now = coverageOf(cov), drift = (rec.coverage || []).map(function (x) {
      var y = now.filter(function (z) { return z.spread === x.spread; })[0];
      return y ? { spread: x.spread, then: x.resolved, now: y.resolved, owed: x.owed } : null;
    }).filter(function (x) { return x && x.now !== x.then; });
    var lines = [];
    if (lost) lines.push('What arrived after the run ended can\'t be told here: a record its receipt saw isn\'t in the folder.');
    if (asks.length) lines.push(plural(asks.length, 'request') + ' arrived after the run ended. ' + (asks.length === 1 ? 'It stays a notice' : 'They stay notices') + '; the ended outcome is unchanged.');
    else if (after.length) lines.push(plural(after.length, 'to-do record') + ' arrived after the run ended; the ended outcome is unchanged.');
    drift.forEach(function (d) { lines.push('Coverage of ' + d.spread + ': ' + d.now + ' of ' + d.owed + ' resolved now (' + d.then + ' when the run ended).'); });
    return { unknown: lost, records: after.map(function (x) { return x.id; }), requests: asks.map(function (x) { return { id: x.id, op: x.op || '', text: x.text || '' }; }), coverage: drift, lines: lines };
  }

  /* ---- What an evidence pack needs for a living run (repo.collectEvidence) ----
     r: the run (sanitized). o: { records, unread (the one checked read of proposals/), scopes, scopesUnread, children (the
     loops' child runs, sanitized), childUnread (child run keys that couldn't be read), cap }. Returns { files: [{ file, kind,
     label }] (names in proposals/, each once), runs: [{ process, id, role }], plans: [plan ids], chain: [application ids, head
     last], receipt: stateOf's, missing: [why] }. Anything that can't be found, read or bounded is named in missing: the pack is
     then partial and no claim on it is confirmed. */
  var DEP_CAP = 5000;
  function deps(r, o) {
    o = o || {};
    var records = o.records || [], files = [], seenF = Object.create(null), runs = [], seenR = Object.create(null), plans = [], missing = [], byId = Object.create(null);
    records.forEach(function (x) { if (x && typeof x.id === 'string') (byId[x.id] = byId[x.id] || []).push(x); });
    var LABEL = { proposal: 'A to-do request', compound: 'A to-do request with its decision and application', decision: 'A decision on a to-do request', application: 'An application: the run\'s work as it landed', fact: 'A fact a tool observed', keep: 'A to-do kept for next time', receipt: 'The receipt the run ended with' };
    var file = function (x, label) { var f = String(x._file || ''); if (!f || seenF[f]) return; seenF[f] = true; files.push({ file: f, kind: x.kind, label: label || LABEL[x.kind] || 'A to-do record' }); };
    var run = function (p, id, role) { var k = p + '/' + id; if (seenR[k] || (p === r.process && id === r.id)) return; seenR[k] = true; runs.push({ process: p, id: id, role: role }); };
    var mine = PF.todos.recordsFor(records, r);
    mine.forEach(function (x) { file(x); });
    /* The chain the run's work rests on: from living.head back through previous, every link in the folder. */
    var chain = [], at = r.living && r.living.head || '', visited = Object.create(null);
    while (at) {
      if (visited[at]) { missing.push('The run\'s applications go round in a circle at ' + at + '.'); break; }
      visited[at] = true;
      var a = (byId[at] || []).filter(function (x) { return x.run && x.run.process === r.process && x.run.id === r.id; })[0];
      if (!a) { missing.push('proposals/' + at + '.json: the run\'s work names this application, but it isn\'t in the folder as read.'); break; }
      var ap = a.kind === 'application' ? a : a.kind === 'compound' ? a.application : null;
      if (!ap) { missing.push('proposals/' + at + '.json: the run\'s work names it, but it isn\'t an application.'); break; }
      chain.unshift(at); at = ap.previous;
    }
    var rs = r.ended ? stateOf(r, records, o.unread) : null;
    if (rs && rs.state !== 'confirmed' && rs.state !== 'none') missing.push(rs.why + ' (' + rs.path + ')');
    /* Facts used as evidence, evidence runs and their plans, and the spreads this run's work holds. */
    var spreads = Object.create(null);
    var look = function (b) {
      if (!b) return;
      if (b.support && b.support.fact) { var fx = byId[b.support.fact]; if (fx && fx.length) fx.forEach(function (f) { file(f, 'A fact used as evidence'); }); else missing.push('proposals/' + b.support.fact + '.json: a to-do rests on this fact, but it isn\'t in the folder as read.'); }
      if (b.evidence && b.evidence.run) { run(b.evidence.run.process, b.evidence.run.id, 'evidence'); if (plans.indexOf(b.evidence.plan) < 0) plans.push(b.evidence.plan); }
      if (b.spread) spreads[b.spread] = true;
    };
    mine.forEach(function (x) { look(x); look(x.effect); look(x.application && x.application.effect); });
    /* Each child run's records, and every record fulfilling one of this run's spreads (on any run). */
    (o.children || []).forEach(function (c) { run(c.process, c.id, 'child'); PF.todos.recordsFor(records, c).forEach(function (x) { file(x, 'A to-do record on a child run'); look(x); look(x.effect); look(x.application && x.application.effect); }); });
    records.forEach(function (x) { if (x && x.fulfills && spreads[x.fulfills.spread]) { file(x, 'A to-do request fulfilling a spread'); if (x.run) run(x.run.process, x.run.id, 'child'); } });
    (o.childUnread || []).forEach(function (k) { missing.push('runs/' + k + '/run.json: a child run of this run\'s loops can\'t be read.'); });
    /* The loops' scope records. */
    (o.scopes || []).forEach(function (x) { var l = PF.loop.loopOf(x); if (l && l.process === r.process && l.run === r.id) file(x, 'A loop scope record'); });
    (o.scopesUnread || []).forEach(function (u) { if (!u.loop || (u.loop.process === r.process && u.loop.run === r.id)) missing.push('proposals/' + u.file + ': a scope record that can\'t be read (' + String(u.why || 'unreadable') + ').'); });
    /* Records that can't be read: on this run, a child, or a run that can't be told, they may be part of its work. */
    var kids = Object.create(null); (o.children || []).forEach(function (c) { kids[c.process + '/' + c.id] = true; });
    (o.unread || []).forEach(function (u) { var k = u.run ? u.run.process + '/' + u.run.id : ''; if (!u.run || k === r.process + '/' + r.id || kids[k]) missing.push('proposals/' + u.file + ' can\'t be read (' + String(u.why || 'unreadable') + '), so what the run\'s work rests on may be missing.'); });
    /* Past the cap nothing is cut: the export is refused (over), naming why. */
    var over = files.length + runs.length > (o.cap || DEP_CAP) ? 'The work of ' + r.process + '/' + r.id + ' rests on ' + (files.length + runs.length) + ' records and runs; a pack made here holds at most ' + (o.cap || DEP_CAP) + '. Nothing was packed.' : '';
    return { files: files, runs: runs, plans: plans, chain: chain, receipt: rs, missing: missing, over: over };
  }

  return { LIMITS: LIMITS, COUNTS: COUNTS, deps: deps, OUTCOMES: OUTCOMES, loopsOf: loopsOf, tally: tally, words: words, compare: compare, coverageOf: coverageOf, evidenceOf: evidenceOf, keepsOf: keepsOf,
    idFor: idFor, build: build, cleanFile: cleanFile, prepare: prepare, stateOf: stateOf, since: since };
})();
