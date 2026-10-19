/* What became of a run's follow-ups (docs/design.md, Follow-ups after the run). A follow-up stays in its run's run.json,
   which only the recorder writes, exactly as before. What became of it is a decision, a file written once by whoever
   decides: followups/<process>/<run>.<follow-up>.<window>.<rev>.json. Decisions are ordered by what the decider had seen
   (rev, seen), never by clocks, as corrections' decisions are; two at the same rev show as Needs review. Older copies
   never list followups/, so they keep showing follow-ups as they always did. */
PF.followups = (function () {
  'use strict';
  var U = PF.util;
  var STATUS = ['open', 'done', 'ticket', 'moved', 'wont'];
  var LABEL = { open: 'Open', done: 'Done', ticket: 'Moved to a ticket', moved: 'Moved to another run', wont: 'Won\'t do' };
  var LIMITS = { link: 500, note: 300, reason: 300, ticket: 120, by: 80, at: 40 };
  /* Open longer than this is worth a look in Folder health. */
  var STALE_MS = 30 * 86400000, FV = 1;
  var PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, ID = /^[\w-]{1,40}$/, PLAN = /^[\w-]{1,100}$/, TICKET = /^[A-Za-z][A-Za-z0-9_]{0,19}-\d{1,9}$/;
  /* <run>.<follow-up>.<window>.<rev>.json, and OneDrive's conflict copies of one ("…1-LAPTOP.json", "…1 (1).json"), which
     are decisions too: two saves of one name that OneDrive kept both of. */
  var FILE = /^([\w-]{1,40})\.([\w-]{1,40})\.([\w-]{1,40})\.(\d{1,7})(?:-[\w-]{1,60}| \(\d{1,4}\))?\.json$/;
  /* Revs are whole numbers from 1; past a million something is wrong, and a file name must hold the number exactly. */
  var MAX_REV = 1000000;

  function fail(msg, field) { var e = new Error(msg); e.field = field; return e; }
  function norm(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
  /* Only a string is ever tested or kept: a value from a file is never coerced (an object's toString can throw). */
  function is(re, v) { return typeof v === 'string' && re.test(v); }
  function revOk(v) { return typeof v === 'number' && Math.floor(v) === v && v >= 1 && v <= MAX_REV; }
  /* Element IDs for one follow-up's form: what's typed for one never lands in another's boxes. */
  function formId(k) { return 'fud-' + U.hash(String(k)) + U.hash(String(k) + '|2'); }
  function key(process, run, id) { return process + '/' + run + '/' + id; }
  /* Only follow-ups whose names make a safe file name can be decided on. */
  function decidable(process, run, id) { return is(PROC, process) && is(ID, run) && is(ID, id); }
  function fileName(rec, writer) { return rec.run + '.' + rec.followUp + '.' + writer + '.' + Math.floor(rec.rev) + '.json'; }
  function runRef(v) { return is(/^[a-z0-9][a-z0-9-]{0,59}\/[\w-]{1,40}$/, v) ? v : ''; }

  /* A new decision on a follow-up (x, from list), by a person. o: { link, note, ticket, to, reason } as typed; to is a run's
     key ("process/id") or "plan:<id>". rev is one more than the decision this window shows (current), and seen names its
     file. Throws, naming the field. */
  function decision(x, by, status, o, at, current) {
    o = o || {};
    if (STATUS.indexOf(status) < 0) throw fail('Unknown decision.');
    if (!by) throw fail('Choose who you are first.');
    if (!x || !decidable(x.process, x.run, x.id)) throw fail('This follow-up can\'t be decided here.');
    var rev = (current && revOk(current.rev) ? current.rev : 0) + 1;
    if (rev > MAX_REV) throw fail('This follow-up has had too many decisions to record another. Ask whoever keeps the team folder.');
    var d = { kind: 'followup-decision', fv: FV, process: x.process, run: x.run, followUp: x.id, status: status, by: String(by).slice(0, LIMITS.by), at: at,
      rev: rev, seen: current && typeof current._file === 'string' ? current._file : null };
    var link = norm(o.link), note = norm(o.note);
    if (link && !U.safeUrl(link)) throw fail('A link starts with https:// or http://.', 'fud-link');
    if (link.length > LIMITS.link) throw fail('Up to ' + LIMITS.link + ' characters; this is ' + link.length + '.', 'fud-link');
    if (note.length > LIMITS.note) throw fail('Up to ' + LIMITS.note + ' characters; this is ' + note.length + '.', 'fud-note');
    if (status === 'done') { if (link) d.link = link; if (note) d.note = note; }
    else if (status === 'ticket') {
      var t = norm(o.ticket);
      if (!t) throw fail('Type the ticket key, like ABC-123, or paste its link.', 'fud-ticket');
      if (U.safeUrl(t) && t.length <= LIMITS.link) d.link = t;
      else if (TICKET.test(t)) d.ticket = t.toUpperCase();
      else throw fail('Type a ticket key like ABC-123, or a link that starts with https://.', 'fud-ticket');
    } else if (status === 'moved') {
      var to = String(o.to || ''), plan = /^plan:(.+)$/.exec(to);
      if (plan && PLAN.test(plan[1])) d.to = { plan: plan[1] };
      else if (runRef(to)) { if (to === x.process + '/' + x.run) throw fail('Choose another run; this is the run it came from.', 'fud-to'); d.to = { run: to }; }
      else if (to) throw fail('Choose the run or plan it moved to.', 'fud-to');
      if (link) d.link = link;
      if (!d.to && !d.link) throw fail('Choose the run or plan it moved to, or paste a link to it.', 'fud-to');
    } else if (status === 'wont') {
      var why = norm(o.reason);
      if (!why) throw fail('Why won\'t it be done? Say why.', 'fud-reason');
      if (why.length > LIMITS.reason) throw fail('Up to ' + LIMITS.reason + ' characters; this is ' + why.length + '.', 'fud-reason');
      d.reason = why;
    }
    return d;
  }

  /* A decision file read from disk, or null if it isn't one. Never throws: every field is checked for its type before it's
     tested, strings are capped, links stay http(s), and the rev in the file name must be the rev inside. */
  function cleanDecision(o, process, file) {
    if (!o || typeof o !== 'object' || o.kind !== 'followup-decision' || typeof process !== 'string' || o.process !== process) return null;
    if (!is(/./, o.at) || !is(/./, o.by) || STATUS.indexOf(o.status) < 0 || !is(ID, o.run) || !is(ID, o.followUp) || !revOk(o.rev)) return null;
    var m = typeof file === 'string' ? FILE.exec(file) : null;
    if (file != null && !(m && m[1] === o.run && m[2] === o.followUp && +m[4] === o.rev)) return null;
    var d = { kind: 'followup-decision', fv: typeof o.fv === 'number' && o.fv >= 1 && o.fv < 1000 ? Math.floor(o.fv) : 1, process: process, run: o.run, followUp: o.followUp, status: o.status,
      by: o.by.slice(0, LIMITS.by), at: o.at.slice(0, LIMITS.at), rev: o.rev, seen: is(FILE, o.seen) ? o.seen : null };
    if (typeof o.link === 'string' && o.link.length <= LIMITS.link && U.safeUrl(o.link)) d.link = o.link;
    if (typeof o.note === 'string' && o.note) d.note = o.note.slice(0, LIMITS.note);
    if (typeof o.reason === 'string' && o.reason) d.reason = o.reason.slice(0, LIMITS.reason);
    if (is(TICKET, o.ticket)) d.ticket = o.ticket;
    var to = o.to && typeof o.to === 'object' ? o.to : null;
    if (to && is(PLAN, to.plan)) d.to = { plan: to.plan };
    else if (to && runRef(to.run)) d.to = { run: to.run };
    /* What a decision needs to mean anything: a ticket or its link, somewhere it moved, a reason. */
    if (d.status === 'ticket' && !d.ticket && !d.link) return null;
    if (d.status === 'moved' && !d.to && !d.link) return null;
    if (d.status === 'wont' && !d.reason) return null;
    if (file != null) d._file = file;
    return d;
  }

  /* The current decision per follow-up: the highest rev; two at the same rev were made at once, so one is picked by file name
     (the same way everywhere) and the follow-up stays open as Needs review until someone decides again. */
  function current(decisions) {
    var cur = Object.create(null);
    (decisions || []).forEach(function (d) {
      if (!d || d.kind !== 'followup-decision') return;
      var k = key(d.process, d.run, d.followUp), c = cur[k], rev = d.rev || 0;
      if (!c) { cur[k] = { d: d, tie: false }; return; }
      var crev = c.d.rev || 0;
      if (rev > crev) cur[k] = { d: d, tie: false };
      else if (rev === crev) cur[k] = { d: (d._file || '') > (c.d._file || '') ? d : c.d, tie: true };
    });
    return cur;
  }

  /* Every follow-up on every run, with where it stands, oldest first. run.json is the only source of follow-ups; decisions
     only say what became of them, so a decision whose follow-up was removed from its run shows nowhere. */
  function list(runs, decisions) {
    var cur = current(decisions), out = [];
    (runs || []).forEach(function (r) {
      (r.followUps || []).forEach(function (f) {
        var k = key(r.process, r.id, f.id), hit = cur[k], d = hit ? hit.d : null, tie = !!(hit && hit.tie), st = tie || !d ? 'open' : d.status;
        out.push({ key: k, id: f.id, process: r.process, run: r.id, runKey: r.process + '/' + r.id, runTitle: r.title, runEnded: !!r.ended, f: f, text: f.text, owner: f.owner || '', at: f.at || (r.ended && r.ended.at) || r.created || '',
          status: st, decision: d, tie: tie, label: tie ? 'Needs review' : LABEL[st], decidable: decidable(r.process, r.id, f.id) });
      });
    });
    return out.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : 1; });
  }
  function isOpen(x) { return x.status === 'open'; }
  /* Home: open follow-ups this person owns, however old. Resolved ones drop off. */
  function mine(xs, me) { return me ? (xs || []).filter(function (x) { return isOpen(x) && x.owner === me; }) : []; }
  /* Open for more than 30 days (since it was added), for Folder health. */
  function stale(xs, now) { return (xs || []).filter(function (x) { var t = Date.parse(x.at); return isOpen(x) && !isNaN(t) && now - t > STALE_MS; }); }
  function forRun(xs, r) { return (xs || []).filter(function (x) { return x.process === r.process && x.run === r.id; }); }
  /* Whole days since it was added. */
  function ageDays(x, now) { var t = Date.parse(x.at); return isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 86400000)); }
  /* What became of it, in a plain line (without who and when): "Moved to ABC-123", "Won't do: covered by …". runTitle names a
     run by its key, or a plan by "plan:<id>". */
  function detail(x, runTitle) {
    var d = x.decision;
    if (!d || x.tie) return x.tie ? 'Two people decided at once. Decide again.' : '';
    if (d.status === 'open') return 'Reopened';
    if (d.status === 'done') return 'Done' + (d.note ? ': ' + d.note : '') + (d.link ? ' (' + d.link + ')' : '');
    if (d.status === 'ticket') return 'Moved to ' + (d.ticket || d.link);
    if (d.status === 'moved') {
      var name = d.to && runTitle ? runTitle(d.to.plan ? 'plan:' + d.to.plan : d.to.run) : '';
      return 'Moved to ' + (d.to ? (name ? '"' + name + '"' + (d.to.plan ? ' (planned)' : '') : d.to.plan ? 'a planned run' : d.to.run) : d.link) + (d.to && d.link ? ' (' + d.link + ')' : '');
    }
    return 'Won\'t do: ' + d.reason;
  }

  return { STATUS: STATUS, LABEL: LABEL, LIMITS: LIMITS, STALE_MS: STALE_MS, MAX_REV: MAX_REV, key: key, formId: formId, revOk: revOk, decidable: decidable, fileName: fileName, decision: decision, cleanDecision: cleanDecision, current: current,
    list: list, isOpen: isOpen, mine: mine, stale: stale, forRun: forRun, ageDays: ageDays, detail: detail };
})();
