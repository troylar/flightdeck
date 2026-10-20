/* Proposals: an AI assistant's change to a draft, written once as a file, that a person applies in Flightdeck. Their attempts
   and decisions, how each proposal stands against the draft, and who has a draft open (presence, the soft lock). Pure: no
   files, no DOM. docs/design.md section 27. */
PF.proposals = (function () {
  'use strict';
  var U = PF.util, M = PF.map;
  var DIR = 'proposed', PRESENCE = 'presence', FILE_MAX = 4 * 1048576, TEXT_MAX = U.DRAFT_BYTES, LIST_MAX = 200;
  /* Presence: a beat every 10 s; fresh for 60 s of elapsed time; the command line allows another computer's clock to be up to
     10 minutes ahead; files older than 24 hours may be cleaned up, 20 a pass. A window applies live (slice 2) only if it
     listed presence/ in the last 20 s. */
  var BEAT_MS = 10000, FRESH_MS = 60000, AHEAD_MS = 600000, CLEAN_MS = 86400000, CLEAN_MAX = 20, LISTED_MS = 20000;
  var ID = /^p-[a-z0-9]{1,12}-[a-z0-9]{10}$/, PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, WRITER = /^[a-z0-9][a-z0-9-]{0,59}$/, SESSION = /^[a-z0-9][a-z0-9-]{0,59}$/, SHA = /^[0-9a-f]{64}$/;
  var BASES = ['draft', 'proposal', 'version', 'none'], HOW = ['live', 'apply'];
  /* What a decision can say: a person's (applied, declined, reopened) and an attempt's outcome (withdrawn, not-saved, cancelled,
     overwritten: its save was written, then replaced by another change before the read-back). */
  var STATUSES = ['applied', 'declined', 'reopened', 'withdrawn', 'not-saved', 'cancelled', 'replaced', 'overwritten'];
  /* A person's decisions (and the command line's replaced): the latest of these decides; an attempt's outcome never overrides them. */
  var DECIDING = { applied: 1, declined: 1, reopened: 1, replaced: 1 };
  /* The command line's contract, flightdeck-draft/1: every field and word docs/apps.md must document (test/build.test.js). */
  var CLI = {
    read: ['contract', 'app', 'process', 'session', 'draft', 'exists', 'path', 'rev', 'text', 'openIn', 'by', 'device', 'seenAgo', 'mine', 'id', 'status', 'continueFrom', 'kind', 'ref', 'checks', 'blockers', 'suggestions', 'copies', 'readAt', 'complete', 'problems'],
    save: ['operation', 'outcome', 'why', 'link', 'file', 'ids', 'added', 'removed', 'renamed', 'warnings', 'history', 'written'],
    errors: ['usage', 'missing-base', 'too-big', 'not-found', 'failed'],
    outcomes: ['written', 'proposed'], why: ['open', 'changed', 'asked'], links: ['replaces', 'after']
  };

  function sha(text) { return PF.sha256.hex(String(text)); }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
  function newId(nowMs, rand) { return 'p-' + Math.max(0, Math.floor(nowMs)).toString(36) + '-' + rand; }
  /* The process a checklist's front matter names, or ''. */
  function textProcess(text) { try { return M.parse(String(text)).meta.process || ''; } catch (e) { return ''; } }

  /* ---------- proposals: proposed/<process>/<id>.json, written once by the command line ---------- */
  function make(o) {
    var b = o.base || { kind: 'none' }, bt = b.text == null ? '' : String(b.text);
    return { kind: 'draft-proposal', pv: 1, id: o.id, process: o.process, session: o.session, label: o.label || '', by: o.by || '', at: o.at || '', app: o.app || '',
      base: { kind: b.kind, rev: sha(bt), ref: b.ref == null ? null : b.ref, text: bt },
      rev: sha(o.text), text: String(o.text), replaces: o.replaces || null, after: o.after || null, note: o.note || '' };
  }
  /* Whether a proposal read from proposed/<folderProcess>/<name> can be used: { ok, meta } or { ok: false, why }. bytes: the
     size actually read. meta holds no text: the texts are read again when Review or Apply needs them. */
  function check(o, name, folderProcess, bytes) {
    function no(why) { return { ok: false, why: why }; }
    if (bytes > FILE_MAX) return no('is over 4 MB, more than a proposal can be');
    if (!o || typeof o !== 'object' || Array.isArray(o)) return no('can\'t be read as a proposal (it isn\'t JSON yet; it may still be arriving)');
    if (o.kind !== 'draft-proposal') return no('isn\'t in the proposal format');
    if (o.pv !== 1) return no(typeof o.pv === 'number' && o.pv > 1 ? 'was written by a newer Flightdeck' : 'isn\'t in the proposal format');
    if (typeof o.id !== 'string' || !ID.test(o.id) || name !== o.id + '.json') return no('has a file name that doesn\'t match its ID');
    if (typeof o.process !== 'string' || o.process !== folderProcess) return no('says process ' + str(o.process, 60) + ', but it\'s in proposed/' + folderProcess);
    if (typeof o.session !== 'string' || !SESSION.test(o.session)) return no('has no session in the format');
    var b = o.base;
    if (!b || typeof b !== 'object' || BASES.indexOf(b.kind) < 0 || typeof b.text !== 'string' || typeof o.text !== 'string') return no('isn\'t in the proposal format');
    if (typeof o.rev !== 'string' || !SHA.test(o.rev) || typeof b.rev !== 'string' || !SHA.test(b.rev)) return no('isn\'t in the proposal format');
    if (U.utf8Bytes(o.text) > TEXT_MAX || U.utf8Bytes(b.text) > TEXT_MAX) return no('has a text over 1 MB, more than a draft can be');
    if (b.kind === 'none' && b.text !== '') return no('isn\'t in the proposal format');
    if (sha(o.text) !== o.rev || sha(b.text) !== b.rev) return no('doesn\'t match its hash yet (it may still be arriving)');
    if (textProcess(o.text) !== o.process) return no('has a process: line that doesn\'t say ' + o.process);
    if ((o.replaces != null && (typeof o.replaces !== 'string' || !ID.test(o.replaces))) || (o.after != null && (typeof o.after !== 'string' || !ID.test(o.after)))) return no('links to a proposal that isn\'t in the format');
    if (o.replaces && o.after) return no('both replaces and follows another proposal');
    if (o.replaces === o.id || o.after === o.id) return no('links to itself');
    return { ok: true, meta: { id: o.id, process: o.process, session: o.session, label: str(o.label, 40), by: str(o.by, 80), at: str(o.at, 40), app: str(o.app, 20),
      base: { kind: b.kind, rev: b.rev, ref: typeof b.ref === 'string' ? b.ref.slice(0, 200) : null }, rev: o.rev, replaces: o.replaces || null, after: o.after || null, note: str(o.note, 200), size: bytes || 0 } };
  }

  /* ---------- attempts and decisions: written once by the window that makes them ---------- */
  /* <id>.json, <id>.<writer>.<decisionRev>.json and <id>.attempt.<writer>.<n>.json; anything else is null. */
  function parseName(name) {
    var m = /^(p-[a-z0-9]{1,12}-[a-z0-9]{10})((?:\.[a-z0-9-]+)*)\.json$/.exec(String(name || ''));
    if (!m) return null;
    var rest = m[2] ? m[2].slice(1).split('.') : [];
    if (!rest.length) return { kind: 'proposal', id: m[1] };
    if (rest.length === 2 && WRITER.test(rest[0]) && /^[1-9]\d{0,8}$/.test(rest[1])) return { kind: 'decision', proposal: m[1], writer: rest[0], rev: +rest[1] };
    if (rest.length === 3 && rest[0] === 'attempt' && WRITER.test(rest[1]) && /^[1-9]\d{0,8}$/.test(rest[2])) return { kind: 'attempt', proposal: m[1], writer: rest[1], n: +rest[2] };
    return null;
  }
  function attempt(o) {
    var rec = { kind: 'proposal-attempt', av: 1, proposal: o.proposal, proposalRev: o.proposalRev, attempt: o.writer + '.' + o.n, how: o.how, from: o.from || null, by: o.by || '', at: o.at || '' };
    return { name: o.proposal + '.attempt.' + o.writer + '.' + o.n + '.json', rec: rec };
  }
  function decision(o) {
    var rec = { kind: 'proposal-decision', dv: 1, proposal: o.proposal, proposalRev: o.proposalRev, decisionRev: o.decisionRev, seen: o.seen || null, status: o.status, by: o.by || '', at: o.at || '' };
    if (o.attempt) rec.attempt = o.attempt;
    if (o.settles && o.settles.length) rec.settles = o.settles.slice(0, 50);
    if (o.result) rec.result = { rev: o.result.rev };
    return { name: o.proposal + '.' + o.writer + '.' + o.decisionRev + '.json', rec: rec };
  }
  /* A record read from the folder, checked against its file name: { kind: 'attempt' | 'decision', ... } or null. */
  function cleanRecord(o, name) {
    var x = parseName(name);
    if (!x || x.kind === 'proposal' || !o || typeof o !== 'object' || Array.isArray(o) || o.proposal !== x.proposal) return null;
    if (o.proposalRev != null && (typeof o.proposalRev !== 'string' || !SHA.test(o.proposalRev))) return null;
    var base = { proposal: x.proposal, writer: x.writer, proposalRev: o.proposalRev || null, by: str(o.by, 80), at: str(o.at, 40) };
    if (x.kind === 'attempt') {
      if (o.kind !== 'proposal-attempt' || o.av !== 1 || o.attempt !== x.writer + '.' + x.n || HOW.indexOf(o.how) < 0) return null;
      if (o.from != null && (typeof o.from !== 'string' || !SHA.test(o.from))) return null;
      return Object.assign(base, { kind: 'attempt', n: x.n, attempt: o.attempt, how: o.how, from: o.from || null });
    }
    if (o.kind !== 'proposal-decision' || o.dv !== 1 || o.decisionRev !== x.rev || STATUSES.indexOf(o.status) < 0) return null;
    if (o.seen != null && (typeof o.seen !== 'string' || !parseName(o.seen))) return null;
    if (o.attempt != null && (typeof o.attempt !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}\.[1-9]\d{0,8}$/.test(o.attempt))) return null;
    if (o.result != null && (typeof o.result !== 'object' || typeof o.result.rev !== 'string' || !SHA.test(o.result.rev))) return null;
    if (o.settles != null && (!Array.isArray(o.settles) || o.settles.length > 50 || !o.settles.every(function (a) { return typeof a === 'string' && /^[a-z0-9][a-z0-9-]{0,59}\.[1-9]\d{0,8}$/.test(a); }))) return null;
    var settles = (o.settles || []).slice(); if (o.attempt && settles.indexOf(o.attempt) < 0) settles.push(o.attempt);
    return Object.assign(base, { kind: 'decision', decisionRev: o.decisionRev, seen: o.seen || null, status: o.status, attempt: o.attempt || null, settles: settles, result: o.result ? { rev: o.result.rev } : null });
  }
  /* Where a proposal stands from all its records [{ name, sha, rec (null: couldn't be read) }], by decisionRev, never by
     clocks. Each decision names the attempts it settles (an outcome its own; a person's decision, Apply again and Mark as
     applied every attempt still open when it was made). In order: unknown (a record can't be read), applied-twice (two
     applications neither of which settled the other's attempt), decided-twice (two of the deciding decisions share the top
     decisionRev), maybe (an attempt nothing settled: may already be applied), then the latest deciding decision (applied,
     declined, reopened, replaced), else tried (only outcomes: withdrawn, not saved, cancelled), else pending. An attempt's
     outcome never overrides an application: a cancellation of another window's attempt doesn't hide a successful one.
     auto: only a proposal with no record at all may ever be applied without a person. nextRev and seen: what the next
     decision carries; open: the attempts it should settle. */
  function recState(records) {
    records = records || [];
    var atts = [], decs = [], bad = [];
    records.forEach(function (r) { if (!r || !r.rec) { bad.push(r && r.name || '?'); return; } (r.rec.kind === 'attempt' ? atts : decs).push(r); });
    var top = 0; decs.forEach(function (d) { if (d.rec.decisionRev > top) top = d.rec.decisionRev; });
    var last = decs.filter(function (d) { return d.rec.decisionRev === top; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    var settled = {}; decs.forEach(function (d) { (d.rec.settles || []).forEach(function (a) { settled[a] = true; }); if (d.rec.attempt) settled[d.rec.attempt] = true; });
    var open = atts.filter(function (a) { return !settled[a.rec.attempt]; }).map(function (a) { return a.rec.attempt; });
    var applied = decs.filter(function (d) { return d.rec.status === 'applied'; }).sort(function (a, b) { return a.rec.decisionRev - b.rec.decisionRev; }), twice = false;
    for (var i = 0; i < applied.length; i++) for (var j = i + 1; j < applied.length; j++) {
      var a = applied[i].rec, b = applied[j].rec;
      /* The same application when either settled the other's attempt (Apply again, Mark as applied); otherwise two. */
      if (!((a.attempt && (b.settles || []).indexOf(a.attempt) >= 0) || (b.attempt && (a.settles || []).indexOf(b.attempt) >= 0))) twice = true;
    }
    var deciding = decs.filter(function (d) { return DECIDING[d.rec.status]; }), dtop = 0;
    deciding.forEach(function (d) { if (d.rec.decisionRev > dtop) dtop = d.rec.decisionRev; });
    var dtops = deciding.filter(function (d) { return d.rec.decisionRev === dtop; });
    var state = bad.length ? 'unknown' : twice ? 'applied-twice' : dtops.length > 1 ? 'decided-twice' : open.length ? 'maybe'
      : dtops.length ? dtops[0].rec.status : decs.length ? 'tried' : 'pending';
    return { state: state, auto: records.length === 0, bad: bad, open: open, attempts: atts.map(function (a) { return a.rec.attempt; }), applied: applied.length, nextRev: top + 1, seen: last.length ? last[0].name : null,
      top: dtops.length === 1 ? dtops[0].rec : null };
  }
  /* The records a person saw in Review, by name and SHA-256 of their bytes; null when one can't be read (it can't be reviewed). */
  function reviewed(records) {
    if ((records || []).some(function (r) { return !r || !r.rec; })) return null;
    return (records || []).map(function (r) { return { name: r.name, sha: r.sha }; }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  }
  function sameSet(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var x = a.slice().sort(function (p, q) { return p.name < q.name ? -1 : 1; }), y = b.slice().sort(function (p, q) { return p.name < q.name ? -1 : 1; });
    return x.every(function (r, i) { return r.name === y[i].name && r.sha === y[i].sha; });
  }

  /* ---------- how each proposal of a process stands against the draft ----------
     metas: checked proposals of one process; recs: { <id>: records }; draft: { exists, rev } as last read. Returns, newest
     first, [{ id, meta, rec, fit }] where fit is invalid (a link to another session, or a cycle), applied, applied-twice,
     declined or unknown (from the records), replaced (a valid replacement is known), waiting (for the proposal it follows),
     review (the one it follows was declined or replaced), already (its text is the draft), ready (a fast-forward: it starts
     from the draft as it is), or older. Slices 1 and 2 never merge, so anything but ready waits for a person. */
  function judge(metas, recs, draft) {
    var by = {}; (metas || []).forEach(function (m) { by[m.id] = m; });
    var bad = {};
    (metas || []).forEach(function (m) {
      var t = m.replaces || m.after; if (t && by[t] && by[t].session !== m.session) bad[m.id] = true;
      /* A cycle: following the links comes back to where it started. */
      var seen = {}, cur = m;
      while (cur && (cur.replaces || cur.after)) { var nx = cur.replaces || cur.after; if (nx === m.id) { bad[m.id] = true; break; } if (seen[nx]) break; seen[nx] = true; cur = by[nx]; }
    });
    var replaced = {};
    (metas || []).forEach(function (m) { if (m.replaces && !bad[m.id] && by[m.replaces]) replaced[m.replaces] = true; });
    var states = {};
    (metas || []).forEach(function (m) { states[m.id] = recState((recs || {})[m.id]); });
    function fitOf(m) {
      if (bad[m.id]) return 'invalid';
      var st = states[m.id].state;
      if (st === 'applied' || st === 'applied-twice' || st === 'declined' || st === 'unknown') return st;
      if (replaced[m.id] || st === 'replaced') return 'replaced';
      if (m.after) {
        var t = by[m.after];
        if (!t) return 'waiting';
        var ts = states[t.id].state;
        /* The draft is already the text it starts from: a fast-forward, whatever the earlier one's records say. */
        if (!(draft && draft.exists && m.base.rev === draft.rev)) {
          if (replaced[t.id] || ts === 'declined' || ts === 'replaced' || bad[t.id]) return 'review';
          if (ts !== 'applied' && ts !== 'applied-twice') return 'waiting';
        }
      }
      if (draft && draft.exists) return m.rev === draft.rev ? 'already' : m.base.rev === draft.rev ? 'ready' : 'older';
      return m.base.kind === 'none' || m.base.kind === 'version' ? 'ready' : 'older';
    }
    return (metas || []).map(function (m) { return { id: m.id, meta: m, rec: states[m.id], fit: fitOf(m) }; })
      .sort(function (a, b) { return a.meta.at < b.meta.at ? 1 : a.meta.at > b.meta.at ? -1 : a.id < b.id ? 1 : -1; });
  }

  /* ---------- the command line: which text a save starts from (docs/apps.md, flightdeck-draft/1) ----------
     o: { expect (a SHA-256 or 'none'), draft { exists, path, rev, text }, mine (this session's proposals: { id, rev, text,
     base { kind, ref, text }, pending }), versions ([{ folder, rev, text }]), baseText (--base, or null), afterEarlier }.
     Returns { kind, ref, text, link, replaces, after } or { missing: true }. */
  function baseFor(o) {
    var plain = function (kind, ref, text) { return { kind: kind, ref: ref, text: text, link: null, replaces: null, after: null }; };
    if (o.expect === 'none') return plain('none', null, '');
    var own = (o.mine || []).filter(function (m) { return m.pending && m.rev === o.expect; })[0];
    if (own) return o.afterEarlier ? { kind: 'proposal', ref: own.id, text: own.text, link: 'after', replaces: null, after: own.id }
      : { kind: own.base.kind, ref: own.base.ref, text: own.base.text, link: 'replaces', replaces: own.id, after: null };
    if (o.draft && o.draft.exists && o.draft.rev === o.expect) return plain('draft', o.draft.path, o.draft.text);
    var any = (o.mine || []).filter(function (m) { return m.rev === o.expect; })[0];
    if (any) return plain('proposal', any.id, any.text);
    var v = (o.versions || []).filter(function (x) { return x.rev === o.expect; })[0];
    if (v) return plain('version', v.folder, v.text);
    if (o.baseText != null && sha(o.baseText) === o.expect) return plain('draft', o.draft && o.draft.path || null, o.baseText);
    return { missing: true };
  }
  /* Step and phase IDs a change adds, removes, or renames (the same text under a new ID). */
  function ids(before, after) {
    function all(t) { var out = {}; try { M.parse(t).phases.forEach(function (p) { out[p.id] = p.title; p.steps.forEach(function (s) { out[s.id] = s.text; }); }); } catch (e) { /* nothing to list */ } return out; }
    var a = all(before), b = all(after), added = Object.keys(b).filter(function (k) { return !(k in a); }), removed = Object.keys(a).filter(function (k) { return !(k in b); }), renamed = [];
    removed.slice().forEach(function (r) { var to = added.filter(function (x) { return b[x] === a[r]; })[0]; if (to) { renamed.push({ from: r, to: to }); added.splice(added.indexOf(to), 1); removed.splice(removed.indexOf(r), 1); } });
    return { added: added, removed: removed, renamed: renamed };
  }

  /* What a change did to the steps and phases, by their outline keys (the ID, or the position for one without): changed (its
     lines differ), moved (the same lines in another phase or lane, or out of order with the rest), added, removed. keys:
     what the editor highlights afterwards ('step:<key>', 'phase:<key>'). */
  function changes(before, after) {
    var A = PF.outline.parse(String(before)), B = PF.outline.parse(String(after));
    function steps(o) { return o.steps.map(function (s) { return { key: s.key, id: s.key.charAt(0) !== '#', src: o.lines.slice(s.line, s.end).join('\n'), at: (s.phase ? s.phase.key : '') + '|' + s.track }; }); }
    function phases(o) { return o.phases.map(function (p) { return { key: p.key, id: p.key.charAt(0) !== '#', src: [o.lines[p.line], p.gate ? o.lines.slice(p.gate.line, p.gate.end).join('\n') : ''].join('\n'), at: '' }; }); }
    /* Parts with an ID are matched by it; a part without one (its key is only its position) by its exact lines and where it
       is, so a step added above it doesn't make it look changed. Order: the parts matched in both, kept in the longest
       common order; the rest of them moved. */
    function diffOf(a, b) {
      var byId = {}, free = {}, out = { changed: [], moved: [], added: [], removed: [] }, pairs = [];
      a.forEach(function (x, i) { x.i = i; if (x.id) byId[x.key] = x; else (free[x.at + '\n' + x.src] = free[x.at + '\n' + x.src] || []).push(x); });
      b.forEach(function (y) {
        if (y.id) {
          var x = byId[y.key]; if (!x) { out.added.push(y.key); return; }
          delete byId[y.key]; pairs.push([x, y]);
          if (x.src !== y.src) out.changed.push(y.key); else if (x.at !== y.at) out.moved.push(y.key);
          return;
        }
        var f = free[y.at + '\n' + y.src];
        if (f && f.length) pairs.push([f.shift(), y]); else out.added.push(y.key);
      });
      Object.keys(byId).forEach(function (k) { out.removed.push(k); });
      Object.keys(free).forEach(function (k) { free[k].forEach(function (x) { out.removed.push(x.key); }); });
      /* Out of order within its own phase and lane (moving a whole phase doesn't move its steps): not in the longest
         increasing run of old positions there (patience sorting, n log n). */
      var groups = {};
      pairs.forEach(function (q) { if (q[0].at === q[1].at) (groups[q[1].at] = groups[q[1].at] || []).push(q); });
      Object.keys(groups).forEach(function (g) {
        var list = groups[g], seq = list.map(function (q) { return q[0].i; }), tails = [], prev = [];
        seq.forEach(function (v, i) {
          var lo = 0, hi = tails.length; while (lo < hi) { var m = (lo + hi) >> 1; if (seq[tails[m]] < v) lo = m + 1; else hi = m; }
          prev[i] = lo ? tails[lo - 1] : -1; tails[lo] = i;
        });
        var keep = {}, k = tails.length ? tails[tails.length - 1] : -1; while (k >= 0) { keep[k] = true; k = prev[k]; }
        list.forEach(function (q, i) { var key = q[1].key; if (!keep[i] && out.changed.indexOf(key) < 0 && out.moved.indexOf(key) < 0) out.moved.push(key); });
      });
      return out;
    }
    var s = diffOf(steps(A), steps(B)), p = diffOf(phases(A), phases(B));
    function keys(d, kind) { return d.changed.concat(d.moved, d.added).map(function (k) { return kind + ':' + k; }); }
    return { steps: s, phases: p, keys: keys(s, 'step').concat(keys(p, 'phase')) };
  }
  /* "2 steps changed, 1 moved, 1 added, 1 phase moved"; with no step or phase touched, "the details at the top changed". */
  function changeWords(c) {
    var out = [];
    [['step', c.steps], ['phase', c.phases]].forEach(function (x) {
      var d = x[1], first = true;
      [['changed', d.changed.length], ['moved', (d.moved || []).length], ['added', d.added.length], ['removed', d.removed.length]].forEach(function (y) {
        if (!y[1]) return;
        out.push(first ? y[1] + ' ' + x[0] + (y[1] === 1 ? '' : 's') + ' ' + y[0] : y[1] + ' ' + y[0]); first = false;
      });
    });
    return out.length ? out.join(', ') : 'the details at the top changed';
  }

  /* ---------- the comparison Review shows: Myers, line by line, capped at 2,000 differences ---------- */
  var DIFF_MAX = 2000, CONTEXT = 3;
  function diff(a, b, cap) {
    cap = cap || DIFF_MAX;
    var x = String(a).split('\n'), y = String(b).split('\n'), pre = 0, suf = 0;
    while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
    while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
    var A = x.slice(pre, x.length - suf), B = y.slice(pre, y.length - suf), n = A.length, m = B.length, max = n + m;
    var mid = [];
    if (n || m) {
      var v = new Int32Array(2 * max + 3), trace = [], off = max + 1, found = -1;
      for (var d = 0; d <= max; d++) {
        if (d > cap) return { tooMany: true, rows: [] };
        var snap = new Int32Array(2 * d + 1);
        for (var k = -d; k <= d; k += 2) {
          var i = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1, j = i - k;
          while (i < n && j < m && A[i] === B[j]) { i++; j++; }
          v[off + k] = i;
        }
        for (var q = -d; q <= d; q++) snap[q + d] = v[off + q];
        trace.push(snap);
        if (v[off + n - m] >= n && Math.abs(n - m) <= d && ((n - m + d) % 2 === 0)) { found = d; break; }
      }
      var ci = n, cj = m;
      for (var dd = found; dd > 0; dd--) {
        var prev = trace[dd - 1], kk = ci - cj, at = function (kx) { return kx < -(dd - 1) || kx > dd - 1 ? -1 : prev[kx + dd - 1]; };
        var down = kk === -dd || (kk !== dd && at(kk - 1) < at(kk + 1)), pk = down ? kk + 1 : kk - 1, pi = at(pk), pj = pi - pk;
        while (ci > (down ? pi : pi + 1) && cj > (down ? pj + 1 : pj)) { mid.push({ op: ' ', text: A[--ci] }); cj--; }
        if (down) mid.push({ op: '+', text: B[--cj] }); else mid.push({ op: '-', text: A[--ci] });
      }
      while (ci > 0 && cj > 0) { mid.push({ op: ' ', text: A[--ci] }); cj--; }
      mid.reverse();
    }
    var rows = x.slice(0, pre).map(function (t) { return { op: ' ', text: t }; }).concat(mid, x.slice(x.length - suf).map(function (t) { return { op: ' ', text: t }; }));
    /* Long runs of unchanged lines fold to one row, keeping 3 lines around each change. */
    var out = [], run = [];
    function flush(last) {
      if (run.length > 2 * CONTEXT + 1 || (last && run.length > CONTEXT) || (!out.length && run.length > CONTEXT)) {
        var head = out.length ? run.slice(0, CONTEXT) : [], tail = last ? [] : run.slice(run.length - CONTEXT), hid = run.length - head.length - tail.length;
        out = out.concat(head); if (hid > 0) out.push({ op: '…', text: hid + ' unchanged line' + (hid === 1 ? '' : 's') }); out = out.concat(tail);
      } else out = out.concat(run);
      run = [];
    }
    rows.forEach(function (r) { if (r.op === ' ') run.push(r); else { flush(false); out.push(r); } });
    flush(true);
    return { tooMany: false, rows: out };
  }

  /* ---------- presence: presence/<writer>.json, each window its own, while it holds a draft editor ---------- */
  function presence(o) {
    return { kind: 'presence', pv: 1, writer: o.writer, by: o.by || '', device: o.device || '', since: o.since || '', at: o.at || '', beat: +o.beat || 0,
      drafts: (o.drafts || []).slice(0, 50), main: (o.main || []).slice(0, 50).map(function (c) { return { process: c.process, claimRev: c.claimRev, seen: c.seen || null }; }) };
  }
  function presenceName(writer) { return writer + '.json'; }
  /* A presence record checked against its file name, or null (malformed: counted as fresh where that's the safe outcome). */
  function cleanPresence(o, name) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.kind !== 'presence' || o.pv !== 1 || typeof o.writer !== 'string' || !WRITER.test(o.writer) || name !== o.writer + '.json') return null;
    if (typeof o.at !== 'string' || isNaN(Date.parse(o.at)) || typeof o.beat !== 'number' || !isFinite(o.beat) || !Array.isArray(o.drafts) || (o.main != null && !Array.isArray(o.main))) return null;
    var main = [];
    (o.main || []).slice(0, 50).forEach(function (c) {
      if (!c || typeof c !== 'object' || typeof c.process !== 'string' || !PROC.test(c.process) || typeof c.claimRev !== 'number' || !(c.claimRev >= 1) || c.claimRev % 1) return;
      var seen = c.seen && typeof c.seen === 'object' && typeof c.seen.writer === 'string' && WRITER.test(c.seen.writer) && typeof c.seen.claimRev === 'number' ? { writer: c.seen.writer, claimRev: c.seen.claimRev } : null;
      main.push({ process: c.process, claimRev: c.claimRev, seen: seen });
    });
    return { kind: 'presence', writer: o.writer, by: str(o.by, 80), device: str(o.device, 80), since: str(o.since, 40), at: o.at, beat: o.beat,
      drafts: o.drafts.filter(function (d) { return typeof d === 'string' && PROC.test(d); }).slice(0, 50), main: main };
  }
  /* The command line looks once: fresh if its time is within 60 s, or ahead of this clock by up to 10 minutes. A malformed
     record is fresh: the safe outcome is a proposal. */
  function freshCli(rec, now) {
    if (!rec) return true;
    var t = Date.parse(rec.at);
    if (isNaN(t)) return true;
    return now - t <= FRESH_MS && t - now <= AHEAD_MS;
  }
  /* In the app, by elapsed time: fresh while its beat changed within the last 60 s of this window's elapsed time (mono), or,
     on first sight, if its time is within 60 s of this computer's clock (wall). memo: what was seen last ({ beat, at }).
     Returns { fresh, memo }. Changing the clock never extends a presence once it's been seen. */
  function freshApp(rec, memo, mono, wall) {
    if (!rec) return { fresh: true, memo: memo || null };
    if (!memo) { var ok = Math.abs(wall - Date.parse(rec.at)) <= FRESH_MS; return { fresh: ok, memo: { beat: rec.beat, at: ok ? mono : -Infinity } }; }
    if (memo.beat !== rec.beat) return { fresh: true, memo: { beat: rec.beat, at: mono } };
    return { fresh: mono - memo.at <= FRESH_MS, memo: memo };
  }
  /* Which window applies proposals live for a process (slice 2), among fresh presences holding its editor: the highest
     claimRev; two at the same claimRev are ambiguous; with no claim, the only editor, or ambiguous when there are more. */
  function mainOf(process, list) {
    var eds = (list || []).filter(function (r) { return r && r.drafts && r.drafts.indexOf(process) >= 0; }), best = 0, who = [];
    eds.forEach(function (r) { (r.main || []).forEach(function (c) { if (c.process !== process) return; if (c.claimRev > best) { best = c.claimRev; who = [r.writer]; } else if (c.claimRev === best && who.indexOf(r.writer) < 0) who.push(r.writer); }); });
    if (best) return who.length === 1 ? { writer: who[0], ambiguous: false, claimRev: best } : { writer: null, ambiguous: true, claimRev: best };
    return eds.length === 1 ? { writer: eds[0].writer, ambiguous: false, claimRev: 0 } : { writer: null, ambiguous: eds.length > 1, claimRev: 0 };
  }
  /* Make this the main editor: one more than the highest claim this window has seen for the process, naming that claim. */
  function claim(process, list) {
    var best = null;
    (list || []).forEach(function (r) { (r && r.main || []).forEach(function (c) { if (c.process === process && (!best || c.claimRev > best.claimRev || (c.claimRev === best.claimRev && r.writer < best.writer))) best = { writer: r.writer, claimRev: c.claimRev }; }); });
    return { process: process, claimRev: best ? best.claimRev + 1 : 1, seen: best };
  }

  return { DIR: DIR, PRESENCE: PRESENCE, FILE_MAX: FILE_MAX, TEXT_MAX: TEXT_MAX, LIST_MAX: LIST_MAX, BEAT_MS: BEAT_MS, FRESH_MS: FRESH_MS, AHEAD_MS: AHEAD_MS, CLEAN_MS: CLEAN_MS, CLEAN_MAX: CLEAN_MAX, LISTED_MS: LISTED_MS,
    ID: ID, PROC: PROC, WRITER: WRITER, SESSION: SESSION, SHA: SHA, STATUSES: STATUSES, CLI: CLI, DIFF_MAX: DIFF_MAX,
    sha: sha, newId: newId, textProcess: textProcess, make: make, check: check, parseName: parseName, attempt: attempt, decision: decision, cleanRecord: cleanRecord,
    recState: recState, reviewed: reviewed, sameSet: sameSet, judge: judge, baseFor: baseFor, ids: ids, diff: diff, changes: changes, changeWords: changeWords,
    presence: presence, presenceName: presenceName, cleanPresence: cleanPresence, freshCli: freshCli, freshApp: freshApp, mainOf: mainOf, claim: claim };
})();
