/* Facts (4.0 slice 4, docs/design.md 45.2): what a tool observed about a loop item, from one source, in one domain (its PRs,
   commits, status or blockers). A fact is an immutable record in proposals/ (kind "fact", flightdeck-plan/4), written once by
   a tool and never applied: it changes no work, settles no step, clears no to-do, passes no approval and reopens nothing.
   Pure: no files, no clocks (the time to judge freshness by is always passed in).

   One record covers one item (loop step, uid, attempt), one source ({feed, site?, account?}) and one domain. A later record
   that saw an earlier one of the same item, source and domain replaces it; two made at once that say different things are
   disputed until one that saw both (PF.loop.settleIn, a page of 50 at a time). Completeness is per source and domain:
   complete PRs say nothing about blockers, and missing or partial data never reads as "no blockers". A resolve suggestion
   is an ordinary done request carrying checked support ({fact, content, incarnation, source, domain}); applying it asks
   again that its evidence is current, fresh, complete where its domain needs that, and shows the work done. */
PF.facts = (function () {
  'use strict';
  /* One limit table for writers and readers; anything over a limit is refused whole, never cut. */
  var LIMITS = { entries: 100, errors: 20, error: 300, source: 60, entry: 120, text: 200, ageMin: 1, ageMax: 604800, age: 86400, records: 10000, skew: 300, reported: 1000000000, batch: 500 };
  /* Each domain's entry: its own field and values, at most how many entries a record holds, whether resolving a to-do from it
     needs the whole list (complete), and what in it shows the work done. */
  var DOMAINS = {
    prs: { one: 'PR', many: 'PRs', field: 'state', values: ['open', 'draft', 'merged', 'closed'], max: 100, needsComplete: true },
    commits: { one: 'commit', many: 'commits', field: '', values: null, max: 100, needsComplete: false },
    status: { one: 'status', many: 'statuses', field: 'category', values: ['todo', 'doing', 'done'], max: 1, needsComplete: true },
    blockers: { one: 'blocker', many: 'blockers', field: 'state', values: ['open', 'resolved'], max: 100, needsComplete: true }
  };
  var NAMES = ['prs', 'commits', 'status', 'blockers'], TITLE = { prs: 'PRs', commits: 'Commits', status: 'Status', blockers: 'Blockers' };
  var REQ = /^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}$/, DNAME = /^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}\.status-[a-z0-9][a-z0-9-]{0,39}-[0-9a-f]{8}$/;
  var STEP = /^[a-z0-9][a-z0-9-]{0,59}$/i, UID = /^[a-z][a-z0-9.-]{0,19}:(key:)?[A-Za-z0-9_-]{1,40}$/, FP = /^[0-9a-f]{16}$/;
  var SRC = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,59}$/, ENTRY = /^[A-Za-z0-9][A-Za-z0-9._:#\/-]{0,119}$/;
  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/, CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
  var FIELDS = ['loopStep', 'uid', 'attempt', 'source', 'domain', 'observedAt', 'maxAgeSeconds', 'complete', 'reported', 'fetched', 'errors', 'entries'];
  var COMMON = ['format', 'features', 'app', 'kind', 'id', 'run', 'seen', 'producer', 'key', 'at'];

  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (isMap(v)) { var o = Object.create(null); Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); }); return o; }
    return v;
  }
  function hex(v) { return PF.sha256.hex(JSON.stringify(v)); }
  function whole(v, lo, hi) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi; }
  function line(v, max, what, errors) {
    if (typeof v !== 'string' || !v.trim()) { errors.push(what + ' is text.'); return null; }
    if (v.length > max) { errors.push(what + ' is ' + v.length + ' characters; the most is ' + max + '.'); return null; }
    if (CONTROL.test(v)) { errors.push(what + ' has a line break or another control character.'); return null; }
    return v;
  }
  /* A real moment: the date and time format, with every part in range (month 1-12, day 1-31, hour 0-23, minute and second
     0-59, offset to 23:59), so every reader, in every browser and in the checker, reads the same instant or refuses it. */
  function momentOk(v) {
    var m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(v) : null;
    if (!m) return false;
    var n = function (i, lo, hi) { return m[i] === undefined || (+m[i] >= lo && +m[i] <= hi); };
    return n(2, 1, 12) && n(3, 1, 31) && n(4, 0, 23) && n(5, 0, 59) && n(6, 0, 59) && n(7, 0, 23) && n(8, 0, 59) && isFinite(Date.parse(v));
  }
  function only(o, keys, what, errors) { Object.keys(o).forEach(function (k) { if (keys.indexOf(k) < 0) errors.push(what + ' has "' + String(k).slice(0, 70) + '".'); }); }

  /* ---- Names. A fact's id is a tool's request id over ["fact", tool, key]: the same key always names the same observation,
     and never collides with a to-do request. A suggestion's id hashes what it rests on, never when it was made: the to-do,
     the opening of it (its incarnation: the application that added or last reopened it), the source, the domain and the
     content; the same suggestion from any tool, at any time, is one file. ---- */
  function idFor(tool, key) { return 'req-' + tool + '-' + hex(['fact', tool, key]).slice(0, 24); }
  function sourceOf(s) { return [s.feed, s.site || '', s.account || '']; }
  function sourceKey(s) { return JSON.stringify(sourceOf(s)); }
  function suggestionHash(todo, incarnation, source, domain, content) { return hex(['suggest', todo, incarnation, sourceOf(source), domain, content]).slice(0, 24); }
  function suggestionId(todo, incarnation, source, domain, content) { return 'req-suggest-' + suggestionHash(todo, incarnation, source, domain, content); }
  function suggestionKey(todo, incarnation, source, domain, content) { return 'sg-' + suggestionHash(todo, incarnation, source, domain, content); }
  function itemKey(loopStep, uid, attempt) { return loopStep + '/' + uid + '#' + attempt; }
  function slotKey(f) { return itemKey(f.loopStep, f.uid, f.attempt) + '\n' + sourceKey(f.source) + '\n' + f.domain; }
  /* What an observation says, apart from when and by whom: two that say the same thing are the same content. */
  function contentOf(f) {
    var es = (f.entries || []).slice().sort(function (a, b) { return cmpStr(a.id, b.id); });
    return hex(canon(['fact', f.domain, !!f.complete, f.reported == null ? null : f.reported, (f.errors || []).length > 0, es])).slice(0, 16);
  }

  /* ---- Reading. ---- */
  function cleanSource(v, errors, what) {
    what = what || '"source"';
    if (!isMap(v)) { errors.push(what + ' is {"feed", "site"?, "account"?}.'); return null; }
    var n0 = errors.length;
    only(v, ['feed', 'site', 'account'], what, errors);
    var out = {};
    if (typeof v.feed !== 'string' || !SRC.test(v.feed)) errors.push(what + ' "feed" is a name of at most ' + LIMITS.source + ' letters, digits, . _ : @ -.'); else out.feed = v.feed;
    var name = function (x, k) { if (x == null) return undefined; if (typeof x !== 'string' || !SRC.test(x)) { errors.push(what + ' "' + k + '" is a name of at most ' + LIMITS.source + ' letters, digits, . _ : @ -.'); return undefined; } return x; };
    var site = name(v.site, 'site'), account = name(v.account, 'account');
    if (site !== undefined) out.site = site;
    if (account !== undefined) out.account = account;
    return errors.length > n0 ? null : out;
  }
  function cleanEntry(domain, e, errors, what) {
    var D = DOMAINS[domain];
    if (!isMap(e)) { errors.push(what + ' is an entry.'); return null; }
    var n0 = errors.length, keys = ['id', 'text', 'link'].concat(D.field ? [D.field] : []);
    only(e, keys, what, errors);
    var out = {};
    if (typeof e.id !== 'string' || !ENTRY.test(e.id)) errors.push(what + ' "id" is the source\'s id for it, at most ' + LIMITS.entry + ' characters.'); else out.id = e.id;
    var t = line(e.text, LIMITS.text, what + ' "text"', errors); if (t) out.text = t;
    /* A domain's own field is "state" or "category", each read by name. */
    var fv = D.field === 'state' ? e.state : D.field === 'category' ? e.category : undefined;
    if (D.field) { if (typeof fv !== 'string' || D.values.indexOf(fv) < 0) errors.push(what + ' "' + D.field + '" is one of ' + D.values.join(', ') + '.'); else if (D.field === 'state') out.state = fv; else out.category = fv; }
    if (e.link != null) { if (!PF.loop.httpLink(e.link)) errors.push(what + ' "link" is an http or https address of at most 2048 characters.'); else out.link = e.link; }
    return errors.length > n0 ? null : out;
  }
  /* The observation itself: every field checked whole, before any is used. Returns the clean fields or null (errors say why). */
  function cleanObservation(o, errors) {
    var n0 = errors.length, out = {};
    if (typeof o.loopStep !== 'string' || !STEP.test(o.loopStep)) errors.push('"loopStep" is the loop step\'s id.'); else out.loopStep = o.loopStep;
    if (typeof o.uid !== 'string' || !UID.test(o.uid)) errors.push('"uid" is the loop item\'s uid.'); else out.uid = o.uid;
    if (!whole(o.attempt, 1, 999)) errors.push('"attempt" is the item\'s attempt, a whole number from 1 to 999.'); else out.attempt = o.attempt;
    out.source = cleanSource(o.source, errors);
    if (typeof o.domain !== 'string' || NAMES.indexOf(o.domain) < 0) { errors.push('"domain" is one of ' + NAMES.join(', ') + '.'); return null; }
    out.domain = o.domain;
    if (!momentOk(o.observedAt)) errors.push('"observedAt" is the date and time it was observed.'); else out.observedAt = o.observedAt;
    if (!whole(o.maxAgeSeconds, LIMITS.ageMin, LIMITS.ageMax)) errors.push('"maxAgeSeconds" is how long it stays fresh: ' + LIMITS.ageMin + ' to ' + LIMITS.ageMax + ' seconds.'); else out.maxAgeSeconds = o.maxAgeSeconds;
    if (typeof o.complete !== 'boolean') errors.push('"complete" is true or false.'); else out.complete = o.complete;
    if (o.reported !== null && !whole(o.reported, 0, LIMITS.reported)) errors.push('"reported" is how many the source says there are, or null when it doesn\'t say.'); else out.reported = o.reported;
    var D = DOMAINS[o.domain];
    if (!Array.isArray(o.entries) || o.entries.length > D.max) errors.push('"entries" is a list of at most ' + D.max + ' ' + (D.max === 1 ? D.one : D.many) + '. Nothing was cut.');
    else {
      var es = [], have = Object.create(null);
      for (var i = 0; i < o.entries.length; i++) {
        var e = cleanEntry(o.domain, o.entries[i], errors, '"entries" ' + (i + 1));
        if (!e) break;
        if (have[e.id]) { errors.push('"entries" names ' + e.id + ' twice.'); break; }
        have[e.id] = true; es.push(e);
      }
      out.entries = es;
    }
    if (!whole(o.fetched, 0, LIMITS.entries) || (Array.isArray(o.entries) && o.fetched !== o.entries.length)) errors.push('"fetched" is how many entries it holds.'); else out.fetched = o.fetched;
    if (!Array.isArray(o.errors) || o.errors.length > LIMITS.errors) errors.push('"errors" is a list of at most ' + LIMITS.errors + ' messages. Nothing was cut.');
    else { var er = []; o.errors.forEach(function (x, j) { var t = line(x, LIMITS.error, '"errors" ' + (j + 1), errors); if (t) er.push(t); }); out.errors = er; }
    if (errors.length > n0) return null;
    /* Complete means the whole list, read without an error: the count the source reported, every one of them fetched. */
    if (out.complete && (out.reported !== out.fetched || out.errors.length)) { errors.push('"complete" is true only when "reported" equals "fetched" and there are no errors.'); return null; }
    return out;
  }
  /* A fact record read back (PF.todos.cleanFile hands it over once the format and feature are checked): { ok, record } or a
     refusal. name: its file name. */
  function cleanFile(o, name, mal) {
    var errors = [];
    if (typeof o.id !== 'string' || !REQ.test(o.id)) return mal('is a fact without a request id');
    if (typeof name === 'string' && !PF.todos.requestFile(name, o.id)) return mal('is a fact whose name isn\'t its id');
    only(o, COMMON.concat(FIELDS), 'It', errors);
    var r = { id: o.id, kind: 'fact', run: null, seen: null, by: null, at: '' };
    var run = o.run;
    if (!isMap(run) || Object.keys(run).length !== 2 || typeof run.process !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(run.process) || typeof run.id !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(run.id)) errors.push('"run" is {"process": <checklist>, "id": <run id>}.');
    else r.run = { process: run.process, id: run.id };
    if (!Array.isArray(o.seen) || o.seen.length > 50 || !o.seen.every(function (x) { return typeof x === 'string' && REQ.test(x); })) errors.push('"seen" is a list of at most 50 fact ids.');
    else if (o.seen.some(function (x, i) { return o.seen.indexOf(x) !== i; })) errors.push('"seen" names a fact twice.');
    else r.seen = o.seen.slice();
    var p = o.producer;
    if (!isMap(p) || Object.keys(p).length !== 2 || typeof p.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,29}$/.test(p.name) || typeof p.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/.test(p.version)) errors.push('"producer" is the tool that observed it: {"name", "version"}.');
    else if (typeof o.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(o.key)) errors.push('A fact has its tool\'s "key".');
    else if (o.id !== idFor(p.name, o.key)) errors.push('Its id isn\'t the one its tool and key give.');
    else r.by = { tool: p.name, version: p.version };
    if (typeof o.at !== 'string' || !ISO.test(o.at)) errors.push('"at" is a date and time.'); else r.at = o.at;
    var ob = cleanObservation(o, errors);
    if (errors.length) return mal('is a fact that isn\'t in its format: ' + errors[0]);
    Object.keys(ob).forEach(function (k) { r[k] = ob[k]; });
    r.content = contentOf(ob);
    return { ok: true, record: r };
  }
  /* A fact as a tool files it. o: { run, producer, key, seen, at, app, observation fields }. */
  function build(o) {
    var f = { format: PF.todos.FORMAT, features: [PF.todos.FEATURE] };
    if (PF.envelope.semver(o.app)) f.app = o.app;
    f.kind = 'fact'; f.id = idFor(o.producer.name, o.key); f.run = { process: o.run.process, id: o.run.id }; f.seen = (o.seen || []).slice().sort(cmpStr);
    f.producer = { name: o.producer.name, version: o.producer.version }; f.key = o.key; f.at = o.at;
    FIELDS.forEach(function (k) { if (o[k] !== undefined) f[k] = o[k]; });
    return f;
  }

  /* ---- Reduction: a run's facts, by item, source and domain. Order is causal among a run's facts (PF.loop.causal); a fact
     that saw one this computer can't read, or whose copies differ, is held, and so is its slot. ---- */
  function factsOf(records, r) { return (records || []).filter(function (x) { return x && x.kind === 'fact' && x.run && x.run.process === r.process && x.run.id === r.id; }); }
  /* o: { records (every to-do and fact record read), unread ({ file, run } that couldn't be read) }. */
  function view(r, o) {
    o = o || {};
    var mine = factsOf(o.records, r), c = PF.loop.causal(mine), held = Object.create(null), slots = Object.create(null), list = [];
    c.held.forEach(function (h) { held[h.record] = h; });
    var unread = (o.unread || []).filter(function (u) { return u && u.file !== 'people.json' && (!u.run || (u.run.process === r.process && u.run.id === r.id)); });
    var slotOf = function (f) {
      var k = slotKey(f);
      if (!slots[k]) { slots[k] = { key: k, item: itemKey(f.loopStep, f.uid, f.attempt), loopStep: f.loopStep, uid: f.uid, attempt: f.attempt, source: f.source, domain: f.domain, records: [], held: [], obs: null, obsReview: [], obsFront: [] }; list.push(slots[k]); }
      return slots[k];
    };
    var byId = Object.create(null); mine.forEach(function (f) { byId[f.id] = f; });
    c.order.forEach(function (f) {
      var S = slotOf(f); S.records.push(f.id);
      PF.loop.settleIn(c, S, 'obs', 'obsReview', f, { op: 'observe', content: f.content }, function (a, b) { return a.content === b.content; },
        { both: function () { return 'Two observations made at once say different things.'; }, again: 'Observed again without seeing every earlier observation made at once.' });
    });
    Object.keys(held).forEach(function (id) { var f = byId[id]; if (f) slotOf(f).held.push(id); });
    list.forEach(function (S) { finish(S, byId); });
    var byItem = Object.create(null);
    list.sort(function (a, b) { return cmpStr(a.key, b.key); }).forEach(function (S) { (byItem[S.item] = byItem[S.item] || []).push(S); });
    return { run: { process: r.process, id: r.id }, slots: list, bySlot: slots, byItem: byItem, byId: byId, held: c.held.slice(), unread: unread, count: mine.length };
  }
  function finish(S, byId) {
    var out = S.obsOut || [];
    S.disputed = out.length > 0;
    S.why = S.disputed ? (out.length > 50 ? out.length + ' observations made at once disagree, more than one record can settle (50); each sync settles 50 more.' : (S.obsReview[0] || { why: 'Two observations made at once say different things.' }).why) : '';
    S.participants = out.slice();
    S.front = (S.obsFront || []).slice().sort(cmpStr);
    var cur = !S.disputed && S.obs ? byId[S.obs.record] : null;
    S.current = cur || null;
    if (cur) {
      /* Records at the front that say the same thing count as one observation, as fresh as the newest of them. */
      var same = S.front.map(function (id) { return byId[id]; }).filter(function (f) { return f && f.content === cur.content; });
      var newest = same.reduce(function (a, f) { return !a || Date.parse(f.observedAt) > Date.parse(a.observedAt) ? f : a; }, null) || cur;
      S.content = cur.content; S.observedAt = newest.observedAt; S.maxAge = newest.maxAgeSeconds; S.complete = cur.complete; S.reported = cur.reported; S.fetched = cur.fetched; S.errors = cur.errors; S.entries = cur.entries;
    }
  }
  /* How one slot stands at now (ms): unknown (nothing), held (a record can't be read in order, or one can't be read at all),
     disputed, failed (errors), future (dated after now), stale (older than its max age), partial (not the whole list) or
     complete. Each is said in words; none of them but complete-and-fresh reads as the whole truth. */
  function stateOf(S, now, FV) {
    if (!S) return { state: 'unknown', fresh: false };
    if (S.held.length || (FV && FV.unread.length)) return { state: 'held', fresh: false };
    if (S.disputed) return { state: 'disputed', fresh: false };
    if (!S.current) return { state: 'unknown', fresh: false };
    var at = Date.parse(S.observedAt);
    if (S.errors.length) return { state: 'failed', fresh: false };
    if (typeof now !== 'number' || !isFinite(now)) return { state: 'held', fresh: false, clock: true };
    if (at > now + LIMITS.skew * 1000) return { state: 'future', fresh: false };
    if (now - at > S.maxAge * 1000) return { state: 'stale', fresh: false };
    return { state: S.complete ? 'complete' : 'partial', fresh: true };
  }
  function agoWords(ms) {
    if (ms < 60000) return 'just now';
    var m = Math.floor(ms / 60000); if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.floor(m / 60); if (h < 48) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.floor(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function spanWords(s) { return s % 86400 === 0 ? (s / 86400) + (s === 86400 ? ' day' : ' days') : s % 3600 === 0 ? (s / 3600) + (s === 3600 ? ' hour' : ' hours') : s % 60 === 0 ? (s / 60) + (s === 60 ? ' minute' : ' minutes') : s + (s === 1 ? ' second' : ' seconds'); }
  function sourceWords(src) { return [src.feed, src.site, src.account].filter(Boolean).join(' · '); }
  /* What a done rests on, in a few words: "PRs from bitbucket · git.example.com". */
  function supportWords(s) { return TITLE[s.domain] + ' from ' + sourceWords(s.source); }
  /* What the entries say, by domain. */
  function contentWords(S) {
    var D = DOMAINS[S.domain], es = S.entries || [], n = es.length, partial = !S.complete;
    var of = partial ? ' of ' + n + ' read' + (S.reported != null ? ', ' + S.reported + ' reported' : '') : '';
    if (S.domain === 'prs') { var mg = es.filter(function (e) { return e.state === 'merged'; }).length; return n ? mg + (partial ? '' : ' of ' + n) + ' merged' + of : partial ? 'none read' + (S.reported != null ? ', ' + S.reported + ' reported' : '') : 'none'; }
    if (S.domain === 'commits') return partial ? n + ' read' + (S.reported != null ? ' of ' + S.reported + ' reported' : '') : String(n);
    if (S.domain === 'status') return n ? es[0].text + ' (' + es[0].category + ')' : 'none read';
    var op = es.filter(function (e) { return e.state === 'open'; }).length;
    if (!partial) return op ? op + ' open' : 'none open';
    return op + ' open' + of + ' (the list is incomplete: this is no sign there are none)';
  }
  /* One line per slot, as the loop shows it: "PRs (bitbucket): 2 of 2 merged · complete · checked 3 hours ago". */
  function words(S, now, FV) {
    var st = stateOf(S, now, FV), head = TITLE[S.domain] + ' (' + sourceWords(S.source) + ')';
    if (st.state === 'held') return { state: st.state, words: head + ': can\'t be read in order yet' + (FV && FV.unread.length ? ' (a fact record can\'t be read)' : '') + ', so it isn\'t known.' };
    if (st.state === 'disputed') return { state: st.state, words: head + ': disputed. ' + S.why + ' The next sync that sees them all settles it.' };
    if (st.state === 'unknown') return { state: st.state, words: head + ': not checked.' };
    var ago = typeof now === 'number' ? agoWords(Math.max(0, now - Date.parse(S.observedAt))) : '';
    if (st.state === 'failed') return { state: st.state, words: head + ': couldn\'t be read (' + S.errors[0] + (S.errors.length > 1 ? '; and ' + (S.errors.length - 1) + ' more' : '') + ')' + (S.entries.length ? '; ' + contentWords(S) : '') + ' · checked ' + ago + '.' };
    if (st.state === 'future') return { state: st.state, words: head + ': dated in the future (' + S.observedAt + '), so it isn\'t trusted.' };
    var w = head + ': ' + contentWords(S) + ' · ' + (S.complete ? 'complete' : 'incomplete') + ' · checked ' + ago;
    if (st.state === 'stale') w += ' · stale (good for ' + spanWords(S.maxAge) + ')';
    return { state: st.state, words: w + '.' };
  }
  /* What one loop item's facts say, every source and domain observed, and the domains not checked at all once any is (so
     missing blockers read as "not checked", never as none). [] when nothing about it was ever observed. */
  function itemFacts(FV, loopStep, uid, attempt, now) {
    var list = (FV && FV.byItem[itemKey(loopStep, uid, attempt)]) || [];
    if (!list.length) return FV && FV.unread.length ? [{ domain: '', state: 'held', words: 'A fact record can\'t be read, so what is known about it may be missing.' }] : [];
    var out = list.map(function (S) { var w = words(S, now, FV); return { domain: S.domain, source: S.source, state: w.state, words: w.words, slot: S.key }; });
    NAMES.forEach(function (d) { if (!list.some(function (S) { return S.domain === d; })) out.push({ domain: d, source: null, state: 'unknown', words: TITLE[d] + ': not checked.' }); });
    return out;
  }

  /* ---- Support for a resolve suggestion. ---- */
  /* The to-do's current opening: the application that added it or last reopened it. */
  function incarnationOf(x) { var h = (x && x.history || []).filter(function (y) { return y.op === 'add' || y.op === 'reopen'; }); return h.length ? h[h.length - 1].application : ''; }
  /* Which loop item a to-do is about: its own item target on the run that has the loop, or, on an item's own run (a child of
     the loop), that item. null when it is about no item. */
  function itemOfTodo(r, x) {
    var t = x && x.target;
    if (t && t.item) return { run: { process: r.process, id: r.id }, loopStep: t.item.loopStep, uid: t.item.uid, attempt: t.item.attempt };
    var p = r && r.parent;
    if (p && p.item && typeof p.process === 'string' && typeof p.id === 'string' && typeof p.step === 'string') return { run: { process: p.process, id: p.id }, loopStep: p.step, uid: p.item.uid, attempt: +p.item.attempt || 1 };
    return null;
  }
  /* What in a domain's entries shows the work done ('' when it does, else why not). */
  function doneWhy(S) {
    var es = S.entries || [];
    if (S.domain === 'prs') return !es.length ? 'it lists no PRs' : es.every(function (e) { return e.state === 'merged'; }) ? '' : es.filter(function (e) { return e.state !== 'merged'; }).length + ' of its PRs aren\'t merged';
    if (S.domain === 'commits') return es.length ? '' : 'it lists no commits';
    if (S.domain === 'status') return es.length && es[0].category === 'done' ? '' : 'its status isn\'t done';
    var op = es.filter(function (e) { return e.state === 'open'; }).length;
    return op ? op + ' blocker' + (op === 1 ? ' is' : 's are') + ' open' : '';
  }
  /* Whether a slot's evidence, as it stands now, supports resolving: current (not held, disputed or failed), fresh, complete
     where its domain needs that, and showing the work done. '' or why not. */
  function slotWhy(S, now, FV) {
    var st = stateOf(S, now, FV), head = TITLE[S.domain] + ' (' + sourceWords(S.source) + ')';
    if (st.state === 'held') return st.clock ? 'Its evidence\'s freshness can\'t be checked here.' : 'Its evidence (' + head + ') can\'t all be read in order yet.';
    if (st.state === 'disputed') return 'Its evidence (' + head + ') is disputed: ' + S.why;
    if (st.state === 'unknown') return 'Its evidence (' + head + ') isn\'t known.';
    if (st.state === 'failed') return 'Its evidence (' + head + ') couldn\'t be read: ' + S.errors[0];
    if (st.state === 'future') return 'Its evidence (' + head + ') is dated in the future, so it isn\'t trusted.';
    if (st.state === 'stale') return 'Its evidence (' + head + ') is stale: checked ' + agoWords(now - Date.parse(S.observedAt)) + ', good for ' + spanWords(S.maxAge) + '. Sync it again.';
    if (DOMAINS[S.domain].needsComplete && !S.complete) return 'Its evidence (' + head + ') is incomplete, and ' + DOMAINS[S.domain].many + ' must be read whole to show it done.';
    var dw = doneWhy(S);
    return dw ? 'Its evidence (' + head + ') doesn\'t show it done: ' + dw + '.' : '';
  }
  /* A done request's support, checked against the folder now (statusOf asks this before anything is applied, and again in
     every write guard): r the to-do's run, q the request, x the to-do, deps { records, unread } (every record read), now. */
  function supportWhy(r, q, x, deps, now) {
    var s = q.support;
    if (!x) return 'Its to-do isn\'t here.';
    if (s.incarnation !== incarnationOf(x)) return 'It was suggested for an earlier opening of this to-do, so it no longer applies.';
    var it = itemOfTodo(r, x);
    if (!it) return 'Its to-do isn\'t about a loop item, so a fact can\'t support it.';
    var runOf = { process: it.run.process, id: it.run.id }, FV = view(runOf, { records: deps.records || [], unread: deps.unread || [] }), F = FV.byId[s.fact];
    if (!F) return FV.unread.length ? 'Its evidence can\'t be read here.' : 'Its evidence (fact ' + s.fact + ') isn\'t in the folder.';
    if (F.loopStep !== it.loopStep || F.uid !== it.uid || F.attempt !== it.attempt) return 'Its evidence is about another item or attempt.';
    if (F.domain !== s.domain || sourceKey(F.source) !== sourceKey(s.source) || F.content !== s.content) return 'Its evidence isn\'t what it names.';
    var S = FV.bySlot[slotKey(F)];
    if (S && !S.held.length && !FV.unread.length && !S.disputed && S.current && S.content !== s.content) return 'Its evidence changed since it was suggested: ' + words(S, now, FV).words;
    return slotWhy(S, now, FV);
  }
  /* What `todo suggest-done` asks: the support for one to-do from one fact, or why it can't be suggested. Over supportWhy, a
     suggestion is refused while any of the item's current facts contradicts it (an open blocker, a disputed slot). Returns
     { support, words } or { why }. o: { records, unread, now }. */
  function supportFor(r, x, factId, o) {
    o = o || {};
    if (!x) return { why: 'That to-do isn\'t in this run.' };
    if (x.state !== 'open') return { why: 'It is already ' + PF.todos.STATE_WORDS[x.state].toLowerCase() + '.' };
    var it = itemOfTodo(r, x);
    if (!it) return { why: 'That to-do isn\'t about a loop item, so a fact can\'t support it.' };
    var FV = view({ process: it.run.process, id: it.run.id }, { records: o.records, unread: o.unread }), F = FV.byId[factId];
    if (FV.unread.length) return { why: 'A fact record can\'t be read, so the evidence can\'t be checked.', held: true };
    if (!F) return { why: 'There\'s no fact ' + factId + ' on ' + it.run.process + '/' + it.run.id + '.' };
    if (F.loopStep !== it.loopStep || F.uid !== it.uid || F.attempt !== it.attempt) return { why: 'That fact is about ' + F.uid + ' (attempt ' + F.attempt + '), not this to-do\'s item.' };
    var S = FV.bySlot[slotKey(F)];
    if (S.current && S.content !== F.content) return { why: 'That fact was replaced by a later observation that says something else: ' + words(S, o.now, FV).words };
    var sw = slotWhy(S, o.now, FV);
    if (sw) return { why: sw };
    /* Contrary facts suppress a suggestion: another source or domain about the item that is disputed, or open blockers. */
    var against = (FV.byItem[S.item] || []).filter(function (T2) { return T2 !== S && (T2.disputed || T2.held.length || (T2.domain === 'blockers' && T2.current && (T2.entries || []).some(function (e) { return e.state === 'open'; }))); });
    if (against.length) return { why: 'Other facts about it disagree: ' + words(against[0], o.now, FV).words + ' Nothing is suggested while they do.' };
    var support = { fact: F.id, content: F.content, incarnation: incarnationOf(x), source: F.source, domain: F.domain };
    return { support: support, words: words(S, o.now, FV).words };
  }
  function cleanSupport(v, errors) {
    if (!isMap(v)) { errors.push('"support" is {"fact", "content", "incarnation", "source", "domain"}.'); return null; }
    var n0 = errors.length;
    only(v, ['fact', 'content', 'incarnation', 'source', 'domain'], '"support"', errors);
    if (typeof v.fact !== 'string' || !REQ.test(v.fact)) errors.push('"support" "fact" is a fact\'s id.');
    if (typeof v.content !== 'string' || !FP.test(v.content)) errors.push('"support" "content" is the fingerprint of what the fact says.');
    if (typeof v.incarnation !== 'string' || !(REQ.test(v.incarnation) || DNAME.test(v.incarnation))) errors.push('"support" "incarnation" is the application that opened the to-do.');
    var src = cleanSource(v.source, errors, '"support" "source"');
    if (typeof v.domain !== 'string' || NAMES.indexOf(v.domain) < 0) errors.push('"support" "domain" is one of ' + NAMES.join(', ') + '.');
    if (errors.length > n0) return null;
    return { fact: v.fact, content: v.content, incarnation: v.incarnation, source: src, domain: v.domain };
  }

  /* ---- Filing a fact (flightdeck fact sync). ---- */
  /* One observation as a tool gives it, made into the record it would file: { why } or { id, name, file, record, status:
     'new' | 'already', words }. o: { obs, by: { tool, version }, records (every to-do and fact record read), unread, items
     (the loop's items: PF.loop.view's rollup.items), at, app }. A retry under the same key with the same observation is
     already; the key with any other observation is refused (taken). Nothing is written here. */
  function prepare(r, o) {
    o = o || {};
    var b = o.obs, by = o.by || {};
    if (!isMap(b)) return { why: 'Each fact is an object.' };
    if (r.ended) return { why: 'The run has ended, so it takes no new facts.' };
    if (r._unrunnable) return { why: 'This run can only be read here.' };
    var map = null; try { map = PF.run.mapOf(r); } catch (e) { map = null; }
    if (!map) return { why: 'This run\'s checklist can\'t be read.' };
    if (typeof b.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(b.key)) return { why: 'Each fact needs its own "key": letters, digits, . _ : -, at most 120. The same key always means the same observation.' };
    var lw = PF.todos.loopWhy(map, b.loopStep);
    if (lw) return { why: 'It can\'t be placed: ' + lw + '.' };
    var items = o.items || [], want = typeof b.item === 'string' ? b.item : '', row = items.filter(function (i) { return i.uid === want || (i.key && i.key === want); })[0];
    if (!row) return { why: (want || 'Its item') + ' isn\'t an item of loop ' + b.loopStep + ' here.' };
    var attempt = b.attempt == null ? row.attempt || 1 : b.attempt;
    if (!whole(attempt, 1, row.attempt || 1)) return { why: 'Attempt ' + attempt + ' isn\'t one of ' + (row.key || row.uid) + '\'s attempts (it is on ' + (row.attempt || 1) + ').' };
    var entries = Array.isArray(b.entries) ? b.entries : b.entries;
    var obs = { loopStep: b.loopStep, uid: row.uid, attempt: attempt, source: b.source, domain: b.domain, observedAt: b.observedAt, maxAgeSeconds: b.maxAgeSeconds == null ? LIMITS.age : b.maxAgeSeconds, complete: b.complete,
      reported: b.reported === undefined ? null : b.reported, fetched: b.fetched == null && Array.isArray(entries) ? entries.length : b.fetched, errors: b.errors == null ? [] : b.errors, entries: entries };
    var oe = [], clean = cleanObservation(obs, oe);
    if (!clean) return { why: oe[0] };
    var extra = Object.keys(b).filter(function (k) { return ['key', 'loopStep', 'item', 'attempt', 'source', 'domain', 'observedAt', 'maxAgeSeconds', 'complete', 'reported', 'fetched', 'errors', 'entries'].indexOf(k) < 0; });
    if (extra.length) return { why: 'A fact has no "' + String(extra[0]).slice(0, 40) + '".' };
    if (!isMap(by) || typeof by.tool !== 'string') return { why: 'Say which tool observed it.' };
    var id = idFor(by.tool, b.key), FV = view(r, { records: o.records, unread: o.unread });
    var prior = FV.byId[id] || (o.records || []).filter(function (x) { return x && x.id === id; })[0];
    if (prior) {
      if (prior.kind !== 'fact') return { why: 'This key already names another record (' + id + ').', taken: true };
      var a = JSON.stringify(canon(observationOf(prior))), c = JSON.stringify(canon(observationOf(clean)));
      return a === c ? { id: id, name: id + '.json', status: 'already', record: prior, words: 'Already filed.' } : { why: 'This key already names a different observation (proposals/' + id + '.json). Use a new key for a new observation.', taken: true };
    }
    if ((o.unread || []).some(function (u) { return u && u.file === id + '.json'; })) return { why: 'A record under this key is in the folder but can\'t be read yet.', held: true };
    if (FV.count >= LIMITS.records) return { why: 'This run already has ' + FV.count + ' fact records, the most it takes (' + LIMITS.records + '). Nothing was imported and nothing was removed; keep fewer observations (a longer max age, fewer syncs) or record new ones on a new run.', full: true };
    var S = FV.bySlot[slotKey(clean)], front = S ? S.front.slice() : [];
    /* It sees what its item, source and domain stand on now, a page of 50 at a time. */
    var seen = PF.loop.page([], front, []).seen;
    var f = build(Object.assign({ run: r, producer: { name: by.tool, version: by.version || '0' }, key: b.key, seen: seen, at: o.at, app: o.app }, clean));
    var fd = PF.todos.filed(id + '.json', f);
    if (fd.why) return { why: fd.why };
    var after = view(r, { records: (o.records || []).concat([fd.record]), unread: o.unread });
    return { id: id, name: id + '.json', file: f, record: fd.record, status: 'new', words: words(after.bySlot[slotKey(fd.record)], typeof o.now === 'number' ? o.now : Date.parse(o.at), after).words };
  }
  function observationOf(f) { var o = Object.create(null); FIELDS.forEach(function (k) { o[k] = f[k]; }); o.entries = (f.entries || []).slice().sort(function (a, b) { return cmpStr(a.id, b.id); }); return o; }

  return { LIMITS: LIMITS, DOMAINS: DOMAINS, NAMES: NAMES, TITLE: TITLE, idFor: idFor, sourceKey: sourceKey, slotKey: slotKey, itemKey: itemKey, contentOf: contentOf, suggestionId: suggestionId, suggestionKey: suggestionKey,
    cleanFile: cleanFile, cleanObservation: cleanObservation, cleanSupport: cleanSupport, build: build, factsOf: factsOf, view: view, stateOf: stateOf, words: words, itemFacts: itemFacts, agoWords: agoWords,
    incarnationOf: incarnationOf, itemOfTodo: itemOfTodo, supportWords: supportWords, supportWhy: supportWhy, supportFor: supportFor, prepare: prepare };
})();
