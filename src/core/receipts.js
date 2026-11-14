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
     not landed by status; applied/pending/refused: every request (refused: declined); owed/covered: spreads' obligations. */
  var COUNTS = ['steps', 'answered', 'items', 'cleared', 'abandoned', 'todos', 'resolved', 'done', 'wont', 'moved', 'ticket', 'toRun', 'link',
    'asked', 'added', 'queued', 'waiting', 'held', 'disputed', 'declined', 'applied', 'pending', 'refused', 'owed', 'covered'];
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
      if (st === 'applied') n.applied++; else if (st === 'declined') n.refused++; else n.pending++;
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
    if (n.applied || n.pending || n.refused) chips.push({ id: 'changes', words: 'Changes: ' + n.applied + ' of ' + plural(n.applied + n.pending + n.refused, 'request') + ' applied' + (n.refused ? ' · ' + n.refused + ' declined' : '') + (n.pending ? ' · ' + n.pending + ' not applied yet' : '') });
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
  /* A receipt is named by its run, who ended it and what it says, never when: the same person preparing it again on the run
     as it stands is the same file, and another person, or anything that changed since, is another. */
  function idFor(run, b, by) { return 'req-receipt-' + PF.sha256.hex(JSON.stringify(['receipt', run.process, run.id, String(by || ''), PF.todos.fingerprint(bodyOf(b))])).slice(0, 24); }
  function build(o) {
    var f = { format: PF.todos.FORMAT, features: [PF.todos.FEATURE] };
    if (PF.envelope.semver(o.app)) f.app = o.app;
    var b = bodyOf(o);
    f.kind = 'receipt'; f.id = idFor(o.run, b, o.by); f.run = { process: o.run.process, id: o.run.id }; f.seen = b.seen.slice(); f.by = o.by; f.at = o.at;
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
    /* '' is a living run that ended with nothing landed yet, as every reader of living reads it. */
    if (typeof o.head !== 'string' || (o.head !== '' && !PF.todos.cleanLiving({ head: o.head }))) errors.push('"head" is the run\'s last application.'); else rec.head = o.head;
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
    if (!errors.length && o.id !== idFor(rec.run, rec, o.by)) errors.push('Its id isn\'t the one its run, who ended it and what it says give.');
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
    var path = 'proposals/' + id + '.json', own = id + '.json';
    /* Everything under the receipt's id, before its kind or its run is looked at: every unread entry and every checked record,
       whatever run it names. The one named first is the receipt's own file, else the first by name. */
    var first = function (xs, nameOf) { return xs.map(function (x, i) { return [x, String(nameOf(x)), i]; }).sort(function (a, b) { return (a[1] === own ? 0 : 1) - (b[1] === own ? 0 : 1) || cmpStr(a[1], b[1]) || a[2] - b[2]; })[0][0]; };
    var uns = (unread || []).filter(function (u) { return u && PF.todos.requestFile(u.file, id); });
    if (uns.length) {
      var un = first(uns, function (u) { return u.file; }), uw = String(un.why || 'unreadable');
      return { state: 'unread', why: un.file === own ? 'Its receipt (' + id + ') can\'t be read: ' + uw : 'Its receipt (' + id + ') has a copy that can\'t be read (proposals/' + un.file + '): ' + uw, path: path, kind: un.kind === 'newer' ? 'newer' : un.kind === 'unreadable' ? 'unreadable' : 'malformed', record: null };
    }
    var all = (records || []).filter(function (x) { return x && x.id === id; }), odd = all.filter(function (x) { return x.kind !== 'receipt'; });
    if (odd.length) { var o1 = first(odd, function (x) { return x._file || own; }); return { state: 'mismatch', why: 'Its receipt (' + id + ') has a copy that is another kind of record (proposals/' + String(o1._file || own) + ', a ' + String(o1.kind) + '), so which is meant isn\'t known.', path: path, kind: 'malformed', record: null }; }
    var mine = all;
    if (!mine.length) return { state: 'missing', why: 'Its receipt (' + id + ') isn\'t in the folder, so what it ended with can\'t be confirmed.', path: path, kind: 'nofile', record: null };
    var rec = mine[0];
    if (mine.some(function (x) { return JSON.stringify(PF.todos.fingerprint(bodyOf(x))) !== JSON.stringify(PF.todos.fingerprint(bodyOf(rec))); })) return { state: 'mismatch', why: 'Its receipt (' + id + ') has two different copies in the folder.', path: path, kind: 'malformed', record: null };
    if (!rec.run || rec.run.process !== r.process || rec.run.id !== r.id) return { state: 'mismatch', why: 'Its receipt (' + id + ') is another run\'s.', path: path, kind: 'malformed', record: null };
    if (rec.head !== r.living.head || rec.outcome !== r.ended.outcome) return { state: 'mismatch', why: 'Its receipt (' + id + ') doesn\'t say what the run ended with (its work head or outcome differs).', path: path, kind: 'malformed', record: null };
    if (!rec.by || rec.by.person !== r.ended.by) return { state: 'mismatch', why: 'Its receipt (' + id + ') was written by another person than the one who ended the run.', path: path, kind: 'malformed', record: null };
    return { state: 'confirmed', why: '', path: path, kind: '', record: rec };
  }

  /* The one receipt verdict every reader, view, copied text and the checker share: stateOf's { state, why, path, kind, record }
     with problem, { path, kind, why } for a receipt that is missing, can't be read (newer, unreadable or malformed: another
     run's or a damaged one is malformed) or says something else, else null. null for a run that isn't an ended living run. */
  function verdict(r, records, unread) {
    var s = stateOf(r, records, unread);
    if (!s) return null;
    s.problem = s.state === 'missing' || s.state === 'unread' || s.state === 'mismatch' ? { path: s.path, kind: s.kind, why: s.why } : null;
    return s;
  }
  /* What arrived after a receipt, shown apart and never counted in its outcome: the run's to-do records it didn't see (requests
     filed after the end, decisions on them; they stay notices), and each spread's coverage now. A spread's obligations owed
     and resolved are both compared with the ended numbers: what arrived (more owed, or a spread asked after the end) is said
     on its own, and coverage now is out of the current denominator; the receipt keeps the ended one. rec: the receipt record
     (stateOf's). cov: the coverage now, or null. */
  function since(r, rec, records, cov) {
    var mine = PF.todos.recordsFor(records, r).filter(function (x) { return PF.todos.notFact(x) && x.kind !== 'receipt'; });
    var c = PF.loop.causal(mine.concat([{ id: rec.id, seen: rec.seen }]));
    var lost = c.held.some(function (h) { return h.record === rec.id; });
    var after = lost ? [] : mine.filter(function (x) { return x.id !== rec.id && !c.saw(rec.id, x.id); });
    var asks = after.filter(function (x) { return x.kind === 'proposal' || x.kind === 'compound'; });
    var then = rec.coverage || [], drift = coverageOf(cov).map(function (y) {
      var x = then.filter(function (z) { return z.spread === y.spread; })[0];
      if (x && x.owed === y.owed && x.resolved === y.resolved) return null;
      return { spread: y.spread, then: x ? { owed: x.owed, resolved: x.resolved } : null, now: { owed: y.owed, resolved: y.resolved }, arrived: Math.max(0, y.owed - (x ? x.owed : 0)) };
    }).filter(Boolean);
    var lines = [];
    if (lost) lines.push('What arrived after the run ended can\'t be told here: a record its receipt saw isn\'t in the folder.');
    if (asks.length) lines.push(plural(asks.length, 'request') + ' arrived after the run ended. ' + (asks.length === 1 ? 'It stays a notice' : 'They stay notices') + '; the ended outcome is unchanged.');
    else if (after.length) lines.push(plural(after.length, 'to-do record') + ' arrived after the run ended; the ended outcome is unchanged.');
    drift.forEach(function (d) {
      if (!d.then) { lines.push('Spread ' + d.spread + ' arrived after the run ended: ' + d.now.resolved + ' of ' + d.now.owed + ' resolved now.'); return; }
      if (d.arrived) lines.push(plural(d.arrived, 'obligation') + ' of ' + d.spread + ' arrived after the run ended.');
      lines.push('Coverage of ' + d.spread + ' now: ' + d.now.resolved + ' of ' + d.now.owed + ' resolved (' + d.then.resolved + ' of ' + d.then.owed + ' when the run ended).');
    });
    return { unknown: lost, records: after.map(function (x) { return x.id; }), requests: asks.map(function (x) { return { id: x.id, op: x.op || '', text: x.text || '' }; }), coverage: drift, lines: lines };
  }

  /* ---- What an evidence pack needs for a living run (repo.collectEvidence) ----
     One bounded closure over the run and every run its work depends on (loop children, evidence runs, the parents whose
     spread one of its requests fulfills), each walked alike: its records, its living chain with a unique witness for every
     link, each application's request, authority and what it saw, and its receipt. r: the run (sanitized). o: { records,
     unread (the one checked read of proposals/), scopes, scopesUnread, runs (key -> each dependency run read, sanitized),
     kids (key -> that run's loop children), runBad ([{ key, path, kind, why }]: a run that couldn't be listed, found or read,
     or whose own verdict refuses it; without key, a listing), cap }. Returns { files: [{ file, kind, label }] (names in
     proposals/, each once), runs: [{ process, id, role, chain, head, receipt, problem }], toRead (runs found that o.runs
     doesn't hold yet: the caller reads them and asks again), plans, chain (the run's, head last), receipt: stateOf's,
     missing: [why] }. Anything that can't be found, read, told apart or bounded is named in missing: the pack is then
     partial and no claim on it is confirmed. */
  var DEP_CAP = 5000;
  function deps(r, o) {
    o = o || {};
    var records = o.records || [], files = [], seenF = Object.create(null), runs = [], seenR = Object.create(null), plans = [], missing = [], byId = Object.create(null);
    var known = o.runs || Object.create(null), bad = Object.create(null), kids = o.kids || Object.create(null), cap = o.cap || DEP_CAP;
    (o.runBad || []).forEach(function (b) { if (b && b.key && !bad[b.key]) bad[b.key] = b; });
    /* The witness index: every checked to-do record and every checked scope record (a scope record's seen names another). */
    records.concat(o.scopes || []).forEach(function (x) { if (x && typeof x.id === 'string') (byId[x.id] = byId[x.id] || []).push(x); });
    var LABEL = { proposal: 'A to-do request', compound: 'A to-do request with its decision and application', decision: 'A decision on a to-do request', application: 'An application: the run\'s work as it landed', fact: 'A fact a tool observed', keep: 'A to-do kept for next time', receipt: 'The receipt the run ended with' };
    var file = function (x, label) { var f = String(x._file || ''); if (!f || seenF[f]) return; seenF[f] = true; files.push({ file: f, kind: x.kind, label: label || LABEL[x.kind] || 'A to-do record' }); };
    var keyOf = function (x) { return x.process + '/' + x.id; }, rootKey = keyOf(r);
    /* Every run the work depends on (loop children, evidence runs, the parents a request fulfills a spread of), each walked
       the same way below: once, in the order found, bounded. */
    var queue = [r], run = function (p, id, role) { var k = p + '/' + id; if (seenR[k] || k === rootKey) return; seenR[k] = true; runs.push({ process: p, id: id, role: role }); if (known[k]) queue.push(known[k]); };
    /* Copies are compared as the app compares them everywhere (PF.loop.copyBody): the checked record, keys in any order. A
       receipt's copies by its own body, as its verdict compares them (stateOf: what it froze, never when it was written). */
    var canon = function (x) { return x && x.kind === 'receipt' ? 'receipt ' + JSON.stringify(PF.todos.fingerprint(bodyOf(x))) : PF.loop.copyBody(x); };
    /* A witness: the one record under an id, the same in every copy. Not in the folder as read, there as another kind, or there
       twice with different contents (a synced copy, a compound included), it is named and the pack is partial; every copy of
       an ambiguous one goes in, so a reader sees both. */
    var unique = function (xs, path, what) {
      if (!xs.length) { missing.push(path + ': ' + what + ', but it isn\'t in the folder as read.'); return null; }
      if (xs.some(function (x) { return canon(x) !== canon(xs[0]); })) { xs.forEach(function (x) { file(x); }); missing.push(path + ': ' + what + ', but the folder has two different copies of it.'); return null; }
      return xs[0];
    };
    /* Every record packed is held to its copies the same way, whatever reaches it (one on the run, a loop's scope record, a
       request fulfilling a spread): copies that differ are each packed and named, and the pack is partial. */
    var told = Object.create(null);
    var held = function (x, on, label) {
      file(x, label);
      var xs = typeof x.id === 'string' ? byId[x.id] || [] : [];
      if (xs.length < 2 || told[x.id] || xs.every(function (y) { return canon(y) === canon(xs[0]); })) return;
      told[x.id] = true; xs.forEach(function (y) { file(y, label); });
      missing.push(on + 'proposals/' + x.id + '.json: the run\'s work rests on it, but the folder has two different copies of it.');
    };
    var witness = function (id, what, ok) {
      var path = 'proposals/' + id + '.json', x = unique(byId[id] || [], path, what);
      if (!x) return null;
      if (ok && !ok(x)) { missing.push(path + ': ' + what + ', but it isn\'t that record.'); return null; }
      file(x); return x;
    };
    var sawQ = [], sawSeen = Object.create(null);
    var saw = function (x) { (Array.isArray(x && x.seen) ? x.seen : []).forEach(function (id) { if (typeof id === 'string' && !sawSeen[id]) { sawSeen[id] = true; sawQ.push(id); } }); };
    /* A fact's predecessors, depth first (4.0, OA): each one a single fact of the same run, every one counted against the
       cap; one met again while it is still being followed is a circle, named at the fact that saw it. */
    var fState = Object.create(null), fWit = Object.create(null), fCount = 0, fOver = false;
    var sameRun = function (a, b) { return !!a.run && !!b.run && a.run.process === b.run.process && a.run.id === b.run.id; };
    var factWalk = function (root) {
      if (fState[root.id]) return;
      fState[root.id] = 1;
      var stack = [{ x: root, i: 0 }];
      while (stack.length) {
        var top = stack[stack.length - 1], ss = Array.isArray(top.x.seen) ? top.x.seen : [];
        if (top.i >= ss.length) { fState[top.x.id] = 2; stack.pop(); continue; }
        var id = ss[top.i++];
        if (typeof id !== 'string') continue;
        var path = 'proposals/' + id + '.json';
        /* Every edge is checked before a node already walked is skipped (QA): its witness once, then the kind and run against
           the fact that saw it, whichever fact was walked first. */
        if (!(id in fWit)) {
          if (++fCount > cap) { if (!fOver) missing.push('The facts a to-do rests on go past ' + cap + ', so they weren\'t all checked.'); fOver = true; return; }
          fWit[id] = unique(byId[id] || [], path, 'fact ' + top.x.id + ' saw it');
        }
        var y = fWit[id];
        if (!y) continue;
        if (y.kind !== 'fact' || !sameRun(y, top.x)) { file(y); missing.push(path + ': fact ' + top.x.id + ' saw it, but it isn\'t a fact of the same run.'); continue; }
        if (fState[id] === 1) { missing.push(path + ': fact ' + top.x.id + ' saw it, but it saw that fact in turn: the facts a to-do rests on go round in a circle at ' + id + '.'); continue; }
        if (fState[id]) continue;
        file(y, 'A fact used as evidence');
        fState[id] = 1; stack.push({ x: y, i: 0 });
      }
    };
    /* The one fact under an id, every copy the same; null otherwise (look names a fact that isn't, through unique). */
    var soleFact = function (id) { var xs = byId[id] || []; return xs.length && xs[0].kind === 'fact' && xs.every(function (y) { return canon(y) === canon(xs[0]); }) ? xs[0] : null; };
    var factProof = function (X, x, s, on, what) {
      var F = PF.facts, fx = soleFact(s.fact), it = x ? F.itemOfTodo(X, x) : null;
      if (!fx) return;
      var why = !x ? 'its to-do was never added' : s.incarnation !== F.incarnationOf(x) ? 'it names another opening of its to-do' : !it ? 'its to-do isn\'t about a loop item' :
        !fx.run || fx.run.process !== it.run.process || fx.run.id !== it.run.id || fx.loopStep !== it.loopStep || fx.uid !== it.uid || fx.attempt !== it.attempt ? 'the fact is about another run, item or attempt' :
        fx.domain !== s.domain || F.sourceKey(fx.source) !== F.sourceKey(s.source) ? 'the fact is from another source or domain' : fx.content !== s.content ? 'the fact doesn\'t say what it said when the done landed' : '';
      if (why) missing.push(on + 'proposals/' + s.fact + '.json: ' + what + ', but ' + why + '.');
    };
    /* A done on a run's evidence (WA), as provenance judges it: this opening's plan, a run of the to-do's checklist, and that
       run, as read, still giving the answer and result the done froze. A run not read yet is asked for and judged then. */
    var runProof = function (X, x, e, on, what) {
      var k = e.run.process + '/' + e.run.id, dr = known[k], path = 'runs/' + k + '/run.json';
      var why = !x || !x.checklist ? 'its to-do isn\'t linked to a checklist' : e.plan !== PF.detours.planOf(X, x) ? 'it names another opening of its to-do' : e.run.process !== x.checklist.process ? 'it names a run of another checklist' : '';
      if (!why && dr && !bad[k]) {
        var res = dr.ended ? PF.run.resultOf(dr) : null, value = res && !res.conflict ? res.value : '';
        if (!dr.ended) why = 'that run was reopened since';
        else if (PF.run.answerOf(dr) !== e.answer || value !== e.result) why = 'that run doesn\'t give the answer and result it gave then';
      }
      if (why) missing.push(on + path + ': ' + what + ', but ' + why + '.');
    };
    var chain = [], rs = null, spreads = Object.create(null), allKids = Object.create(null);
    var look = function (b) {
      if (!b) return;
      /* A fact used as evidence is a witness too: one record under its id, the same in every copy, and a fact; the facts it
         saw are followed in turn (factWalk). */
      if (b.support && b.support.fact) { var fp = 'proposals/' + b.support.fact + '.json', fx = unique(byId[b.support.fact] || [], fp, 'a to-do rests on this fact'); if (fx && fx.kind !== 'fact') missing.push(fp + ': a to-do rests on this fact, but it isn\'t that record.'); else if (fx) { file(fx, 'A fact used as evidence'); factWalk(fx); } }
      if (b.evidence && b.evidence.run) { run(b.evidence.run.process, b.evidence.run.id, 'evidence'); if (plans.indexOf(b.evidence.plan) < 0) plans.push(b.evidence.plan); }
    };
    /* One run's own closure: its records, its living chain (every link a witness), each application's request, authority and
       what it saw, its receipt, and the runs it depends on. Another run's problems name it. */
    var walk = function (X) {
      var k = keyOf(X), on = k === rootKey ? '' : 'On ' + k + ': ', mine = PF.todos.recordsFor(records, X);
      var mineRun = function (x) { return !!x.run && x.run.process === X.process && x.run.id === X.id; };
      mine.forEach(function (x) { held(x, on, k === rootKey ? null : 'A to-do record on a run its work depends on'); });
      var ch = [], at = X.living && X.living.head || '', visited = Object.create(null);
      while (at) {
        if (visited[at]) { missing.push(on + 'The run\'s applications go round in a circle at ' + at + '.'); break; }
        visited[at] = true;
        var a = unique((byId[at] || []).filter(mineRun), (on ? on : '') + 'proposals/' + at + '.json', 'the run\'s work names this application');
        if (!a) break;
        var ap = a.kind === 'application' ? a : a.kind === 'compound' ? a.application : null;
        if (!ap) { missing.push(on + 'proposals/' + at + '.json: the run\'s work names it, but it isn\'t an application.'); break; }
        ch.unshift(at); at = ap.previous;
      }
      if (k === rootKey) chain = ch;
      else for (var ri = 0; ri < runs.length; ri++) if (keyOf(runs[ri]) === k) { runs[ri].chain = ch.slice(); runs[ri].head = X.living ? X.living.head : ''; if (X.living && X.living.receipt) runs[ri].receipt = X.living.receipt; }
      /* A done that landed on a fact's evidence is held to that fact as packed (VB): the content, source and domain the done
         named, and the run, item and attempt of the to-do it checks off, in the opening it was suggested for. */
      /* The chain as the app replays it (XB, PF.todos.view: each application's effect what its request asks for, seen in order,
         and every step one the to-do's state allows): work the app can't replay is named, and the pack is partial. */
      var TV = X.living ? PF.todos.view(X, { records: mine, unread: (o.unread || []).filter(function (u) { return u && (!u.run || (u.run.process === X.process && u.run.id === X.id)); }) }) : null;
      if (TV && TV.broken) missing.push(on + 'proposals/' + TV.broken.record + '.json: ' + TV.broken.why);
      /* Each to-do as the chain leaves it (WA): its opening, state and the evidence it was checked off on. */
      var opened = Object.create(null);
      ch.forEach(function (id) {
        var a = (byId[id] || [])[0], ap = a && (a.kind === 'compound' ? a.application : a.kind === 'application' ? a : null), e = ap && ap.effect, x;
        if (!e || typeof e.todo !== 'string') return;
        if (e.op === 'add') { opened[e.todo] = { id: e.todo, target: e.target, checklist: e.checklist || null, history: [{ op: 'add', application: id }], state: 'open', support: null, evidence: null }; return; }
        if (!(x = opened[e.todo])) { if (e.op === 'done' && e.support) factProof(X, null, e.support, on, 'application ' + id + ' checks off ' + e.todo + ' on this fact'); if (e.op === 'done' && e.evidence) runProof(X, null, e.evidence, on, 'application ' + id + ' checks off ' + e.todo + ' on this run'); return; }
        if (e.op === 'reopen') { x.history.push({ op: 'reopen', application: id }); x.state = 'open'; x.support = null; x.evidence = null; return; }
        x.state = e.op === 'done' ? 'done' : e.op;
        if (e.op !== 'done') return;
        x.support = e.support || null; x.evidence = e.evidence || null;
        if (e.support) factProof(X, x, e.support, on, 'application ' + id + ' checks off ' + e.todo + ' on this fact');
        if (e.evidence) runProof(X, x, e.evidence, on, 'application ' + id + ' checks off ' + e.todo + ' on this run');
      });
      ch.forEach(function (id) {
        var a = (byId[id] || [])[0];
        if (!a) return;
        saw(a);
        if (a.kind !== 'application') return;
        var q = witness(a.proposal, on + 'application ' + id + ' applies this request', function (x) { return (x.kind === 'proposal' || x.kind === 'compound') && mineRun(x); });
        if (q) saw(q);
        var au = a.authority || {}, w = null;
        if (au.decision) w = witness(au.decision, on + 'application ' + id + ' rests on this decision', function (x) { return x.kind === 'decision' && x.proposal === a.proposal && mineRun(x); });
        else if (au.grant) w = witness(au.grant, on + 'application ' + id + ' rests on this grant', function (x) { return x.kind === 'grant'; });
        else if (au.compound) w = witness(au.compound, on + 'application ' + id + ' rests on this compound', function (x) { return x.kind === 'compound'; });
        else missing.push(on + 'proposals/' + id + '.json: an application that names no authority.');
        if (w) saw(w);
      });
      var v = X.ended ? stateOf(X, records, o.unread) : null;
      if (v && v.state !== 'confirmed' && v.state !== 'none') missing.push(on + v.why + ' (' + v.path + ')');
      if (k === rootKey) rs = v;
      /* Every request the receipt names as seen (pending ones included) is part of what it froze. */
      if (v && v.record) (v.record.seen || []).forEach(function (id) { var sx = witness(id, on + 'the receipt names this record as seen'); if (sx) saw(sx); });
      /* Every fact it names as evidence says what it said when the run ended (VB). */
      /* Each evidence entry it names is exactly the evidence its to-do was checked off on, as the chain leaves it (WA): a to-do
         the work added and checked off on evidence, named once; a fact entry the done's fact and content, and that fact one
         packed fact still with that content; a run entry the done's plan, run, answer and result. */
      if (v && v.record) {
        var named = Object.create(null);
        (v.record.evidence || []).forEach(function (ev) {
          var x = opened[ev.todo], at = on + v.path + ': the receipt names evidence for ' + ev.todo, want;
          if (named[ev.todo]) { missing.push(at + ' twice.'); return; }
          named[ev.todo] = true;
          if (!x) { missing.push(at + ', but the run\'s work never added that to-do.'); return; }
          if (x.state !== 'done' || !(x.support || x.evidence)) { missing.push(at + ', but that to-do wasn\'t checked off on evidence.'); return; }
          want = x.support ? { todo: x.id, fact: x.support.fact, content: x.support.content } : { todo: x.id, plan: x.evidence.plan, run: { process: x.evidence.run.process, id: x.evidence.run.id }, answer: x.evidence.answer, result: x.evidence.result };
          if (PF.todos.fingerprint(want) !== PF.todos.fingerprint(ev)) { missing.push(at + ', but it isn\'t the evidence that to-do was checked off on.'); return; }
          var fx = ev.fact ? soleFact(ev.fact) : null;
          if (ev.fact && fx && fx.content !== ev.content) missing.push(on + 'proposals/' + ev.fact + '.json: the receipt names it as the evidence ' + ev.todo + ' was checked off on, but it doesn\'t say what it said then.');
        });
        /* And the other way (WC): every to-do the work left checked off on evidence is named, as an honest receipt froze it. */
        Object.keys(opened).forEach(function (id) { var x = opened[id]; if (x.state === 'done' && (x.support || x.evidence) && !named[id]) missing.push(on + v.path + ': ' + id + ' was checked off on evidence, but the receipt doesn\'t name that evidence.'); });
      }
      /* Every keep it names (what was kept for next time) is a checked keep on this run, one witness under its id. */
      if (v && v.record) (v.record.keeps || []).forEach(function (id) { var kx = witness(id, on + 'the receipt names this keep', function (x) { return x.kind === 'keep' && mineRun(x); }); if (kx) saw(kx); });
      /* Facts used as evidence, evidence runs and their plans, the spreads this run's work holds and the parents whose spread
         one of its requests fulfills. */
      var sp = Object.create(null);
      mine.forEach(function (x) { look(x); look(x.effect); look(x.application && x.application.effect); [x, x.effect, x.application && x.application.effect].forEach(function (b) { if (b && b.spread) sp[b.spread] = spreads[b.spread] = true; }); if (x.fulfills && x.fulfills.run) run(x.fulfills.run.process, x.fulfills.run.id, 'fulfills'); });
      (kids[k] || []).forEach(function (c) { allKids[keyOf(c)] = true; run(c.process, c.id, 'child'); });
      records.forEach(function (x) { if (x && x.fulfills && sp[x.fulfills.spread]) { held(x, on, 'A to-do request fulfilling a spread'); if (x.run) run(x.run.process, x.run.id, 'child'); } });
      /* The loops' scope records, and the run a loop item's choice names (a child of that loop step's process). */
      var xmap = mapOf(X), procOfStep = function (stepId) { var f = null; (xmap ? xmap.phases : []).forEach(function (ph) { ph.steps.forEach(function (st) { if (st.id === stepId && st.type === 'for.each') { try { f = PF.run.fieldsOf(X, st); } catch (e) { f = null; } } }); }); return f && typeof f.process === 'string' ? f.process : ''; };
      (o.scopes || []).forEach(function (x) {
        var l = PF.loop.loopOf(x);
        if (!l || l.process !== X.process || l.run !== X.id) return;
        held(x, on, 'A loop scope record');
        saw(x);
        (Array.isArray(x.changes) ? x.changes : []).forEach(function (chg) { if (chg && chg.op === 'choose' && typeof chg.run === 'string' && chg.run) { var cp = procOfStep(l.step); if (cp) run(cp, chg.run, 'child'); else missing.push(on + 'proposals/' + String(x._file || x.id + '.json') + ': it chooses ' + chg.run + ' for a loop item, but the loop\'s checklist can\'t be told.'); } });
      });
      /* A spread's binding names the run that covers an item: that run is part of the work too. */
      mine.forEach(function (x) { [x.dest, x.effect && x.effect.dest, x.application && x.application.effect && x.application.effect.dest].forEach(function (dv) { if (dv && typeof dv.process === 'string' && typeof dv.id === 'string') run(dv.process, dv.id, 'child'); }); });
      (o.scopesUnread || []).forEach(function (u) { if (u.loop && u.loop.process === X.process && u.loop.run === X.id) missing.push('proposals/' + u.file + ': a scope record that can\'t be read (' + String(u.why || 'unreadable') + ').'); });
    };
    for (var qi = 0; qi < queue.length; qi++) {
      if (qi > cap) { missing.push('The runs the work depends on go past ' + cap + ', so they weren\'t all checked.'); break; }
      walk(queue[qi]);
    }
    (o.scopesUnread || []).forEach(function (u) { if (!u.loop) missing.push('proposals/' + u.file + ': a scope record that can\'t be read (' + String(u.why || 'unreadable') + ').'); });
    for (var si = 0; si < sawQ.length; si++) {
      if (si >= cap) { missing.push('The records the run\'s applications saw go past ' + cap + ', so they weren\'t all checked.'); break; }
      var sx = witness(sawQ[si], 'a record the run\'s work saw');
      if (sx) saw(sx);
    }
    /* A run the work depends on that couldn't be listed, found or read, or whose own verdict refuses it: named by path and
       kind. One neither read nor refused is a caller's to read next (toRead). */
    var toRead = [];
    runs.forEach(function (x) { var k = keyOf(x), b = bad[k]; if (b) { x.problem = b; missing.push(b.path + ' (' + b.kind + '): ' + (x.role === 'evidence' ? 'a to-do was done on this run\'s result' : x.role === 'fulfills' ? 'a request on the run fulfills a spread of this run' : 'a child run of its loops') + ', but ' + String(b.why) + '.'); } else if (!known[k]) toRead.push(x); });
    (o.runBad || []).forEach(function (b) { if (b && !b.key) missing.push(b.path + ' (' + b.kind + '): ' + String(b.why) + ', so a child run of its loops may be missing.'); });
    /* Records that can't be read: on this run, a run it depends on, or a run that can't be told, they may be part of its work. */
    (o.unread || []).forEach(function (u) { var k = u.run ? u.run.process + '/' + u.run.id : ''; if (!u.run || k === rootKey || seenR[k]) missing.push('proposals/' + u.file + ' (' + (u.kind === 'newer' || u.kind === 'unreadable' ? u.kind : 'malformed') + ') can\'t be read (' + String(u.why || 'unreadable') + '), so what the run\'s work rests on may be missing.'); });
    /* Past the cap nothing is cut: the export is refused (over), naming why. */
    var over = files.length + runs.length > cap ? 'The work of ' + r.process + '/' + r.id + ' rests on ' + (files.length + runs.length) + ' records and runs; a pack made here holds at most ' + cap + '. Nothing was packed.' : '';
    return { files: files, runs: runs, toRead: toRead, plans: plans, chain: chain, receipt: rs, missing: missing, over: over };
  }


  return { LIMITS: LIMITS, COUNTS: COUNTS, deps: deps, DEP_CAP: DEP_CAP, OUTCOMES: OUTCOMES, loopsOf: loopsOf, tally: tally, words: words, compare: compare, coverageOf: coverageOf, evidenceOf: evidenceOf, keepsOf: keepsOf,
    idFor: idFor, build: build, cleanFile: cleanFile, prepare: prepare, stateOf: stateOf, verdict: verdict, since: since };
})();
