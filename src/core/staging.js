/* Staging (2.1, docs/design.md section 31): a stage is a version only test runs use until someone makes it the default. Pure,
   ES5. A stage's status is worked out from saved files on every read, never stored: promoted when a verified publication's
   stagedFrom names it; otherwise its latest decision (retired or reopened, by rev); otherwise staged. Nothing under staged/
   is ever rewritten. */
PF.staging = (function () {
  'use strict';
  var E = PF.envelope, FAMILY = 'flightdeck-stage-decision', FORMAT = FAMILY + '/1';
  var STATUSES = ['retired', 'reopened'], WINDOW = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, PROC = /^[a-z0-9][a-z0-9-]{0,59}$/;
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n || 200) : ''; }

  /* One decision file through its envelope: { ok, rec } or { ok: false, kind: 'newer' | 'malformed', why, needs }. A record
     for another process or a stage name that isn't one is malformed; nothing in it is read for meaning before the envelope. */
  function cleanDecision(o, proc, file) {
    var v = E.judge(FAMILY, o);
    if (!v.ok) return { ok: false, kind: v.kind, why: v.why, needs: v.needs || '' };
    var bad = function (why) { return { ok: false, kind: 'malformed', why: why }; };
    if (o.process !== proc) return bad('is for another process');
    if (typeof o.stage !== 'string' || !PF.publish.STAGE.test(o.stage)) return bad('doesn\'t name a stage');
    if (STATUSES.indexOf(o.status) < 0) return bad('has a status this copy doesn\'t know');
    if (typeof o.rev !== 'number' || !(o.rev >= 1) || Math.floor(o.rev) !== o.rev || o.rev > 99999) return bad('has no rev');
    if (o.seen !== null && (typeof o.seen !== 'number' || !(o.seen >= 1) || Math.floor(o.seen) !== o.seen)) return bad('has a "seen" that isn\'t a rev');
    if (typeof o.by !== 'string' || !o.by || typeof o.at !== 'string' || !o.at) return bad('doesn\'t say who decided, or when');
    return { ok: true, rec: { process: proc, stage: o.stage, status: o.status, reason: str(o.reason, 300), by: str(o.by, 120), at: str(o.at, 40), rev: o.rev, seen: o.seen, _file: str(file, 200) } };
  }
  /* A new decision on a stage: retired or reopened, with the rev after the latest this window has read (seen). */
  function decision(proc, stage, status, o) {
    if (!PROC.test(proc) || !PF.publish.STAGE.test(stage)) throw new Error('No such stage.');
    if (STATUSES.indexOf(status) < 0) throw new Error('A stage can be retired or reopened.');
    if (!WINDOW.test(String(o.window || ''))) throw new Error('This window has no name to write under.');
    var seen = o.seen == null ? null : o.seen;
    var rec = { format: FORMAT, process: proc, stage: stage, status: status, reason: String(o.reason || '').slice(0, 300), by: String(o.by || ''), at: String(o.now || ''), rev: (seen || 0) + 1, seen: seen };
    if (E.semver(o.app)) rec.app = o.app;
    return { path: 'staged/' + proc + '/decisions/' + stage + '.' + o.window + '.' + rec.rev + '.json', rec: rec };
  }
  /* The latest decisions on one stage: those with the highest rev. */
  function latest(stageFolder, decisions) {
    var mine = (decisions || []).filter(function (d) { return d && d.stage === stageFolder; }), top = 0;
    mine.forEach(function (d) { if (d.rev > top) top = d.rev; });
    return { rev: top, list: mine.filter(function (d) { return d.rev === top; }) };
  }
  /* { status: 'promoted' | 'retired' | 'staged' | 'tie', pub, decision, rev }. pubs: the process's versions as read (only a
     verified one counts as a promotion). A tie (the latest rev says both) waits for a newer decision. */
  function status(stage, decisions, pubs) {
    var folder = stage && (stage.folder || (stage.info && stage.info.folder));
    var pub = (pubs || []).filter(function (p) { return p && p.ok && p.info && own(p.info, 'stagedFrom') && p.info.stagedFrom && p.info.stagedFrom.folder === folder; })
      .sort(function (a, b) { return a.info.version - b.info.version; })[0] || null;
    var l = latest(folder, decisions), last = l.list[0] || null;
    if (pub) return { status: 'promoted', pub: pub, decision: last, rev: l.rev };
    if (!last) return { status: 'staged', pub: null, decision: null, rev: 0 };
    if (l.list.some(function (d) { return d.status !== last.status; })) return { status: 'tie', pub: null, decision: last, rev: l.rev };
    return { status: last.status === 'retired' ? 'retired' : 'staged', pub: null, decision: last, rev: l.rev };
  }
  /* Why a stage can't be made the default now, or ''. */
  function promoteWhy(st) {
    if (st.status === 'promoted') return 'It\'s already the default: it was published as v' + st.pub.info.version + '.';
    if (st.status === 'retired') return 'It\'s retired. Reopen it first.';
    if (st.status === 'tie') return 'Two decisions on it disagree. Retire or reopen it again to settle it.';
    return '';
  }

  return { FORMAT: FORMAT, STATUSES: STATUSES, WINDOW: WINDOW, cleanDecision: cleanDecision, decision: decision, latest: latest, status: status, promoteWhy: promoteWhy };
})();
