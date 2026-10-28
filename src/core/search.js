/* Search (docs/design.md section 22). Pure: no DOM, no files. The app hands over what it accepted from the folder (runs as
   applied, with their notes; publications; drafts; decisions; follow-ups; step types; skills; people) and gets back sources,
   each with a namespaced id and a signature of exactly what it indexes. sync() reindexes only sources whose signature
   changed and drops the ones that are gone. People's names and step types' labels are not indexed into documents: documents
   keep person and type IDs, and two small side indexes turn the words of a query into IDs, so renaming a person touches
   nothing else. Text is folded (accents removed, lowercased) one code point at a time with a map back to the original
   offsets, so highlights always cover the original characters, combining marks included. Everything returned is plain text;
   the view escapes it. Words are matched exactly; only the last word of a query is a prefix. No fuzzy matching. */
PF.search = (function () {
  'use strict';
  var U = PF.util;
  /* Combining marks folded away: Latin and Greek accents, Hebrew points and cantillation, Arabic harakat, and the extended
     and supplementary blocks. A variation selector goes with them. */
  var MARK_RANGE = '\\u0300-\\u036f\\u0483-\\u0489\\u0591-\\u05bd\\u05bf\\u05c1\\u05c2\\u05c4\\u05c5\\u05c7\\u0610-\\u061a\\u064b-\\u065f\\u0670\\u06d6-\\u06dc\\u06df-\\u06e4\\u06e7\\u06e8\\u06ea-\\u06ed\\u1ab0-\\u1aff\\u1dc0-\\u1dff\\u20d0-\\u20ff\\ufe00-\\ufe0f\\ufe20-\\ufe2f';
  var MARKS = new RegExp('[' + MARK_RANGE + ']', 'g'), MARK1 = new RegExp('^[' + MARK_RANGE + ']$');
  /* Word separators: whitespace, ASCII punctuation and symbols (so "ABC-123" is two words, "__proto__" is "proto"), Latin-1
     symbols, general punctuation, arrows, technical and other symbols, dingbats, CJK punctuation. Emoji outside the basic
     plane are folded to a space (foldPiece), so they separate words too. Anything else is part of a word. */
  var SEPS = '\\s\\u0000-\\u002f\\u003a-\\u0040\\u005b-\\u0060\\u007b-\\u00bf\\u00d7\\u00f7\\u2000-\\u206f\\u2190-\\u2bff\\u2e00-\\u2e7f\\u3000-\\u303f\\uff01-\\uff0f';
  var SEP = new RegExp('[' + SEPS + ']+'), WORD = new RegExp('[^' + SEPS + ']+', 'g'), ENDS_SEP = new RegExp('[' + SEPS + ']$');
  var ASCII = /^[\u0000-\u007f]*$/, SHARP_S = /ß/g, FINAL_SIGMA = /ς/g;
  var KINDS = ['run', 'step', 'note', 'correction', 'followup', 'process', 'version', 'type', 'skill', 'page'];
  var LABEL = { run: 'Runs', step: 'Steps', note: 'Notes', correction: 'Corrections', followup: 'Follow-ups', process: 'Checklists', version: 'Versions', type: 'Step types', skill: 'Skills', page: 'Pages' };
  var MAX_TERMS = 12, MAX_QUERY = 200, RERANK = 400, PER_KIND = 20, PER_GROUP = 6;

  /* ---------- folding and words ---------- */
  /* One code point, folded: NFD, combining marks removed, lowercased, final sigma as sigma, ß as ss; an emoji or other
     pictograph outside the basic plane is a space. Remembered per code point, so indexing never normalizes twice. */
  var pieces = Object.create(null), pieceN = 0;
  function foldPiece(c) {
    var hit = pieces[c];
    if (hit !== undefined) return hit;
    var cp = c.length === 2 ? (c.charCodeAt(0) - 0xd800) * 0x400 + c.charCodeAt(1) - 0xdc00 + 0x10000 : c.charCodeAt(0), f;
    if (cp >= 0x1f000 && cp <= 0x1faff) f = ' ';
    else f = (c.normalize ? c.normalize('NFD') : c).replace(MARKS, '').toLowerCase().replace(FINAL_SIGMA, 'σ').replace(SHARP_S, 'ss');
    if (++pieceN > 20000) { pieces = Object.create(null); pieceN = 1; }
    return (pieces[c] = f);
  }
  function each(s, fn) {
    for (var i = 0; i < s.length;) {
      var code = s.charCodeAt(i), n = code >= 0xd800 && code < 0xdc00 && i + 1 < s.length ? 2 : 1;
      fn(code < 128 ? s.charAt(i).toLowerCase() : foldPiece(s.substr(i, n)), i, n);
      i += n;
    }
  }
  /* The whole text folded exactly as fold() folds it, without the offsets (for indexing). */
  function foldText(s) {
    s = String(s == null ? '' : s);
    if (ASCII.test(s)) return s.toLowerCase();
    var out = [];
    each(s, function (f) { out.push(f); });
    return out.join('');
  }
  /* Folded text with, for each folded character, the original offsets of the code point it came from: start[i] to end[i]. */
  function fold(s) {
    s = String(s == null ? '' : s);
    var out = [], start = [], end = [];
    each(s, function (f, i, n) { for (var k = 0; k < f.length; k++) { out.push(f.charAt(k)); start.push(i); end.push(i + n); } });
    return { text: out.join(''), start: start, end: end };
  }
  function words(folded) { return folded ? folded.split(SEP).filter(Boolean) : []; }
  /* A query: its folded words (the last a prefix unless the query ends with a space or punctuation) and its phrase. */
  function parse(q) {
    var f = foldText(String(q == null ? '' : q).slice(0, MAX_QUERY)), w = words(f).slice(0, MAX_TERMS), prefix = w.length > 0 && !ENDS_SEP.test(f);
    return { terms: w.map(function (t, i) { return { t: t, prefix: prefix && i === w.length - 1 }; }), phrase: w.join(' ') };
  }
  function hits(term, tok) { return term.prefix ? tok.indexOf(term.t) === 0 : tok === term.t; }

  /* ---------- highlighting: ranges in the original text ---------- */
  function ranges(text, q) {
    var p = typeof q === 'string' ? parse(q) : q, out = [];
    if (!p.terms.length || !text) return out;
    var f = fold(text), m;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(f.text))) {
      var tok = m[0], len = 0;
      for (var i = 0; i < p.terms.length; i++) if (hits(p.terms[i], tok)) len = Math.max(len, p.terms[i].prefix && tok !== p.terms[i].t ? p.terms[i].t.length : tok.length);
      if (!len) continue;
      var a = f.start[m.index], b = f.end[m.index + len - 1];
      /* A hit always covers its whole character: the combining marks after it come with it. */
      while (b < text.length && MARK1.test(text.charAt(b))) b++;
      if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(b, out[out.length - 1][1]); else out.push([a, b]);
    }
    return out;
  }
  function segments(text, rs, from, to) {
    var out = [], at = from;
    rs.forEach(function (r) {
      var a = Math.max(r[0], from), b = Math.min(r[1], to);
      if (b <= a) return;
      if (a > at) out.push({ t: text.slice(at, a), hit: false });
      out.push({ t: text.slice(a, b), hit: true }); at = b;
    });
    if (at < to) out.push({ t: text.slice(at, to), hit: false });
    return out;
  }
  function isLow(c) { return c >= 0xdc00 && c < 0xe000; }
  /* Whether offset i is inside a character: between a surrogate pair, or before a combining mark of the letter before it. */
  function inside(text, i) { return isLow(text.charCodeAt(i)) || MARK1.test(text.charAt(i)); }
  /* An end offset moved forward until it no longer cuts a character. */
  function safeEnd(text, to) { while (to < text.length && inside(text, to)) to++; return to; }
  /* The whole text as segments {t, hit}, in order: joined, they are the original text. */
  function mark(text, q) { text = String(text == null ? '' : text); return segments(text, ranges(text, q), 0, text.length); }
  /* A window of about max characters around the first hit, cut at spaces, with "…" where it was cut. */
  function snippet(text, q, max) {
    text = String(text == null ? '' : text).replace(/\s+/g, ' ');
    max = max || 140;
    var rs = ranges(text, q);
    if (text.length <= max) return segments(text, rs, 0, text.length);
    var first = rs.length ? rs[0] : [0, 0], from = Math.max(0, Math.min(first[0] - Math.floor((max - (first[1] - first[0])) / 3), text.length - max)), to = Math.min(text.length, from + max);
    if (from > 0) { var sp = text.indexOf(' ', from); if (sp >= 0 && sp < first[0]) from = sp + 1; }
    if (to < text.length) { var sb = text.lastIndexOf(' ', to); if (sb > Math.max(from, first[1])) to = sb; }
    /* Never cut inside a character: not between a surrogate pair, and not before a combining mark (it stays with its letter). */
    while (from > 0 && inside(text, from)) from--;
    to = safeEnd(text, to);
    var out = segments(text, rs, from, to);
    if (from > 0) out.unshift({ t: '…', hit: false });
    if (to < text.length) out.push({ t: '…', hit: false });
    return out;
  }

  /* ---------- sources: what the app accepted, as documents with an identity and a signature ---------- */
  function own(o, k) { return o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function uniq(list) { var seen = Object.create(null), out = []; list.forEach(function (x) { if (x && typeof x === 'string' && !seen[x]) { seen[x] = 1; out.push(x); } }); return out; }
  function target(o) { var t = {}; Object.keys(o).forEach(function (k) { if (o[k] != null && o[k] !== '') t[k] = o[k]; }); return t; }
  function field(list, t, w, step) { t = str(t); if (t) list.push(step ? { t: t, w: w, step: step } : { t: t, w: w }); }
  /* A long first line is cut at a space for the result's title; the whole text is still indexed. */
  function clip(t, n) {
    if (t.length <= n) return t;
    var c = t.lastIndexOf(' ', n), to = c > n / 2 ? c : safeEnd(t, n);
    return to >= t.length ? t : t.slice(0, to).replace(/[\s.,;:]+$/, '') + '…';
  }
  function fileNames(n) { return (n.files || []).map(function (f) { var i = own(n.fileInfo, f); return (i && i.name) || String(f).split('/').pop(); }); }

  function runDoc(r) {
    var key = r.process + '/' + r.id, f = [];
    field(f, r.title, 8); field(f, r.category, 3); field(f, r.version ? 'v' + r.version : '', 2); field(f, r.ended && r.ended.outcome, 2);
    /* A test run (2.1) is found by those words too, and says so in its line. */
    if (PF.run.isTest(r)) field(f, 'test run staged', 3);
    Object.keys(r.details || {}).forEach(function (k) { field(f, r.details[k], 6); });
    Object.keys(r.steps || {}).slice(0, 500).forEach(function (id) {
      var a = r.steps[id];
      Object.keys(a.values || {}).forEach(function (k) { field(f, a.values[k], 4, id); });
      field(f, a.reason, 3, id); field(f, a.differently && a.differently.note, 4, id);
    });
    var people = [r.recorder && r.recorder.person, r.createdBy, r.ended && r.ended.by];
    Object.keys(r.roles || {}).forEach(function (k) { people.push(r.roles[k]); });
    return { id: 'run:' + key, kind: 'run', title: r.title, sub: (PF.run.isTest(r) ? 'Test run · staged v' : 'v') + (r.version || '?') + ' · ' + (r.ended ? str(r.ended.outcome) || 'Ended' : 'Running'), fields: f,
      people: uniq(people), types: [], at: r.savedAt || (r.ended && r.ended.at) || r.created || '', process: r.process, run: key, target: target({ view: 'run', run: key }) };
  }
  /* Each note's own signature, worked out once per note object (notes are built new from every read and never changed in
     place), and only when it's first asked for, so the first build spreads the hashing over its slices. */
  var noteMemo = typeof WeakMap === 'function' ? new WeakMap() : null;
  function noteSig(n) {
    var hit = noteMemo && noteMemo.get(n);
    if (hit) return hit;
    var ch = n.change && typeof n.change.to === 'string' ? n.change.to : '';
    var info = (n.files || []).map(function (p) { var i = own(n.fileInfo, p) || {}; return [p, i.name || '', i.size || 0]; });
    var sig = U.hash(JSON.stringify([n.id, n.at, n.by, n.step, n.kind || '', n.text, n.why || '', n.happened || '', ch, info]));
    if (noteMemo) noteMemo.set(n, sig);
    return sig;
  }
  function noteSource(r, key, n, k, th) {
    var x = { n: n, k: k };
    return { id: 'note:' + key + ':' + n.id + '#' + k, kind: 'note', get sig() { return noteSig(n) + '|' + th; }, make: function () { return [noteDoc(r, x)]; } };
  }
  function noteDoc(r, x) {
    var n = x.n, key = r.process + '/' + r.id, f = [], corr = n.kind === 'correction' || n.kind === 'fix' || n.kind === 'map';
    field(f, n.text, 6); field(f, n.why, 4); field(f, n.happened, 4); field(f, n.change && typeof n.change.to === 'string' ? n.change.to : '', 4);
    fileNames(n).forEach(function (name) { field(f, name, 3); });
    return { id: 'note:' + key + ':' + n.id + '#' + x.k, kind: corr ? 'correction' : 'note', title: clip(str(n.text).split('\n')[0], 120) || 'Note', sub: (PF.run.isTest(r) ? 'Test run · ' : '') + r.title, fields: f, people: uniq([n.by]), types: [],
      at: n.at || '', process: r.process, run: key, target: target({ view: 'run', run: key, step: n.step, note: n.id }) };
  }
  function fuDoc(x) {
    var f = [], d = x.decision || {}, fu = x.f || {};
    field(f, x.text, 6); field(f, fu.ticket, 6); field(f, d.note, 4); field(f, d.reason, 4); field(f, d.ticket, 6); field(f, d.link, 2);
    return { id: 'fu:' + x.key, kind: 'followup', title: x.text, sub: x.label + ' · ' + (x.test ? 'Test run · ' : '') + x.runTitle, fields: f, people: uniq([x.owner, fu.by, d.by]), types: [],
      at: x.at || '', process: x.process, run: x.runKey, target: target({ view: 'run', run: x.runKey, step: fu.step }) };
  }
  var DECIDED = { declined: 'Declined', applied: 'Applied', included: 'Published', withdrawn: 'Withdrawn', legacy: 'Accepted', open: 'Reopened', accepted: 'Accepted' };
  function decisionDoc(d, id) {
    var f = [], word = DECIDED[d.status] || 'Decided';
    field(f, d.reason, 5); field(f, word, 2);
    return { id: id, kind: 'correction', title: 'Correction ' + word.toLowerCase() + (d.reason ? ': ' + d.reason : ''), sub: d.process, fields: f, people: uniq([d.by]), types: [],
      at: d.at || '', process: d.process, run: '', target: target({ view: 'process', process: d.process, decision: id, group: d.group }) };
  }
  function pubDocs(proc, x, latest) {
    var map = x.map, meta = map.meta || {}, title = meta.title || proc, ver = x.info.version, f = [];
    field(f, title, latest ? 8 : 4); field(f, proc, 5); field(f, 'v' + ver, 3); field(f, meta.category, 2); field(f, (meta.tags || []).join(' '), 2); field(f, x.info.changes, 2);
    var out = [{ id: 'pub:' + proc + '/' + x.folder, kind: latest ? 'process' : 'version', title: title, sub: 'v' + ver + (latest ? ' · latest' : ''), fields: f, people: [], types: [],
      at: x.info.publishedAt || '', process: proc, run: '', target: target({ view: 'process', process: proc, mapVer: latest ? null : x.folder }) }];
    if (!latest) return out;
    (map.phases || []).forEach(function (ph) {
      (ph.steps || []).forEach(function (s) {
        var sf = []; field(sf, s.text, 6); field(sf, s.note, 2); field(sf, s.id, 3);
        /* Its conditions and its phase's (2.1), as written after "only when". */
        field(sf, (ph.when || []).concat(s.when || []).map(function (w) { return w.text; }).join(' and '), 2);
        out.push({ id: 'step:' + proc + '/' + x.folder + '/' + s.id, kind: 'step', title: s.text, shown: PF.map.shownText(s, null), sub: (ph.title || '') + ' · ' + title, fields: sf, people: [], types: uniq([s.type]),
          at: x.info.publishedAt || '', process: proc, run: '', target: target({ view: 'process', process: proc, mapVer: x.folder, step: s.id }) });
      });
    });
    return out;
  }
  var draftMemo = Object.create(null), draftN = 0;
  function draftMeta(d) {
    var k = d.file + '\n' + U.hash(d.md), hit = draftMemo[k];
    if (hit) return hit;
    if (++draftN > 500) { draftMemo = Object.create(null); draftN = 1; }
    var m = PF.map.parse(d.md).meta || {};
    return (draftMemo[k] = { process: m.process || d.file.replace(/\.md$/i, ''), title: m.title || '' });
  }
  function typeList(custom) {
    var all = PF.types.LIST.map(function (t) { return t; });
    Object.keys(custom || {}).forEach(function (id) { if (!PF.types.LIST.some(function (t) { return t.id === id; })) all.push(custom[id]); });
    return all.filter(function (t) { return t && typeof t.id === 'string'; });
  }
  var PAGES = [['home', 'Home', 'start what needs me'], ['runs', 'Runs', 'running finished history'], ['followups', 'Follow-ups', 'after the run'], ['processes', 'Checklists', 'processes checklists'],
    ['skills', 'Skills', 'ai assistant'], ['types', 'Step types', 'kinds of steps'], ['settings', 'Settings', 'keyboard shortcuts appearance theme people'],
    ['health', 'Folder health', 'conflicts copies problems capacity'], ['connection', 'Connection check', 'sync onedrive computers'], ['recovery', 'When something goes wrong', 'help recovery guide']];

  /* Signatures of objects the app never changes in place (a follow-up as read, a decision, a publication record) are worked
     out once per object, and again only when what they're paired with or the extra key changes. */
  var sigMemo = typeof WeakMap === 'function' ? new WeakMap() : null, NONE = {};
  function sigOf(obj, with_, extra, make) {
    var hit = sigMemo && obj && typeof obj === 'object' ? sigMemo.get(obj) : null;
    if (hit && hit.w === with_ && hit.x === extra) return hit.sig;
    var sig = make();
    if (sigMemo && obj && typeof obj === 'object') sigMemo.set(obj, { w: with_, x: extra, sig: sig });
    return sig;
  }
  /* Every field a cleaned decision (on a correction or a follow-up) can hold, joined. */
  var DFIELDS = ['kind', 'process', 'group', 'suggestion', 'run', 'followUp', 'status', 'reason', 'note', 'ticket', 'link', 'by', 'at', 'rev', 'seen', 'act', 'addressed', 'dv', 'version', 'folder', 'legacy'];
  function decisionPrint(d) {
    var out = DFIELDS.map(function (k) { var v = d[k]; return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); });
    out.push((d.members || []).join(','), d.result ? JSON.stringify(d.result) : '', d.to ? JSON.stringify(d.to) : '');
    return out.join('\u0002');
  }
  /* Sources from the app's accepted state. input = { runs, pubs (data.processes), drafts, people, stepTypes (custom types),
     skills, corrDecisions, followUps (PF.followups.list) }. Runs come first, each followed by its notes, so a build that's
     part way through has whole runs. Each source: { id, kind, sig, make() → documents }. */
  /* A run and its notes are one group, with a cheap group signature: the run file's hash, rev, save time and title, the app's
     local version of the run (input.rev(r): it moves with every edit on screen, so an edit not saved yet, or whose save
     failed, is indexed as shown, since edits change the run object in place), and its notes' fingerprint (repo's _notesSig, a hash of the notes files' texts). A group whose signature the index already has is
     skipped whole, without looking at its notes; memo (kept by the caller for one folder) reuses a group's sources while its
     signature holds, so a refresh that changed nothing builds almost nothing. */
  function notesPrint(r) { return r._notesSig != null ? r._notesSig : (r._notes || []).length ? U.hash((r._notes || []).map(noteSig).join('|')) : ''; }
  function runGroup(r, memo, rev) {
    var key = r.process + '/' + r.id, g = 'run:' + key, sig = [r._fileHash || '', r.rev || 0, r.savedAt || '', r.title, rev ? rev(r) : ''].join('|'), gs = sig + '|' + notesPrint(r) + '|' + (r._notes || []).length;
    var hit = memo && memo[g];
    if (hit && hit.gs === gs) return hit.list;
    var list = [{ id: g, kind: 'run', g: g, gs: gs, sig: sig, make: function () { return [runDoc(r)]; } }];
    if (r._notes && r._notes.length) {
      var count = Object.create(null), th = U.hash(r.title || '');
      r._notes.forEach(function (n) { var x = noteSource(r, key, n, count[n.id] = (count[n.id] || 0) + 1, th); x.g = g; x.gs = gs; list.push(x); });
    }
    if (memo) memo[g] = { gs: gs, list: list };
    return list;
  }
  function docs(input, memo) {
    var out = [];
    (input.runs || []).forEach(function (r) { var list = runGroup(r, memo, input.rev); for (var i = 0; i < list.length; i++) out.push(list[i]); });
    /* Follow-ups and decisions are read again on every refresh, as new objects: their signatures are their fields joined,
       which costs no hashing and still changes with any change of content. */
    (input.followUps || []).forEach(function (x) {
      var fu = x.f || {}, d = x.decision;
      var sig = [x.status, x.label, x.runTitle, !!x.test, x.at, x.owner, x.text, fu.ticket, fu.step, fu.by, d ? decisionPrint(d) : ''].join('\u0001');
      out.push({ id: 'fu:' + x.key, kind: 'followup', sig: sig, make: function () { return [fuDoc(x)]; } });
    });
    (input.corrDecisions || []).forEach(function (d) {
      var dir = d._dir || (d.legacy ? 'suggestions' : 'corrections'), id = 'corr:' + dir + '/' + d.process + '/' + d._file;
      out.push({ id: id, kind: 'correction', sig: dir + '\u0001' + decisionPrint(d), make: function () { return [decisionDoc(d, id)]; } });
    });
    var published = Object.create(null);
    (input.pubs || []).forEach(function (p) {
      var latest = p.index && p.index.latest;
      if (latest) published[p.process] = true;
      ((p.index && p.index.all) || []).forEach(function (x) {
        if (!x.ok || !x.map || !x.info) return;
        var isLatest = x === latest;
        out.push({ id: 'pub:' + p.process + '/' + x.folder, kind: 'pub', sig: [x.info.mapHash, x.info.typesHash, sigOf(x.info, NONE, '', function () { return U.hash(JSON.stringify(x.info)); }), isLatest ? 'L' : ''].join('|'), make: function () { return pubDocs(p.process, x, isLatest); } });
      });
    });
    (input.drafts || []).forEach(function (d) {
      if (!d || typeof d.md !== 'string') return;
      var m = draftMeta(d), pub = !!published[m.process];
      out.push({ id: 'draft:' + d.file, kind: 'draft', sig: U.hash(d.md) + (pub ? '|P' : ''), make: function () {
        var f = []; field(f, m.title || m.process, pub ? 3 : 8); field(f, m.process, 4); field(f, 'draft', 1);
        return [{ id: 'draft:' + d.file, kind: pub ? 'version' : 'process', title: m.title || m.process, sub: 'Draft', fields: f, people: [], types: [], at: '', process: m.process, run: '', target: target({ view: 'process', process: m.process }) }];
      } });
    });
    typeList(input.stepTypes).forEach(function (t) {
      out.push({ id: 'type:' + t.id, kind: 'type', sig: U.hash(JSON.stringify([PF.types.nameOf(t), t.label, t.hint, t.tags || [], t.group || [], !!t.custom])), make: function () {
        var f = []; field(f, PF.types.nameOf(t), 8); field(f, PF.types.aliasOf(t), 6); field(f, t.id, 5); field(f, t.hint, 3); field(f, (t.tags || []).join(' '), 3); field(f, PF.types.groupOf(t).join(' '), 2);
        return [{ id: 'type:' + t.id, kind: 'type', title: PF.types.nameOf(t) || t.id, sub: t.hint || '', fields: f, people: [], types: [t.id], at: '', process: '', run: '', target: { view: 'types' } }];
      } });
    });
    (input.skills || []).forEach(function (x) {
      var s = x.skill || {}, file = x.file || s.name || '';
      if (!file) return;
      out.push({ id: 'skill:' + file, kind: 'skill', sig: U.hash(JSON.stringify([s, x.errors || []])), make: function () {
        var f = []; field(f, s.name, 8); field(f, s.description, 4); field(f, s.process, 3); field(f, file.replace(/\.json$/i, ''), 2);
        return [{ id: 'skill:' + file, kind: 'skill', title: s.name || file, sub: s.process ? 'For ' + s.process : '', fields: f, people: [], types: [], at: '', process: s.process || '', run: '', target: { view: 'skill', skill: file } }];
      } });
    });
    PAGES.forEach(function (p) {
      out.push({ id: 'page:' + p[0], kind: 'page', sig: 'v1', make: function () { var f = []; field(f, p[1], 8); field(f, p[2], 2); return [{ id: 'page:' + p[0], kind: 'page', title: p[1], sub: 'Page', fields: f, people: [], types: [], at: '', process: '', run: '', target: { view: p[0] } }]; } });
    });
    return out;
  }

  /* ---------- the index ---------- */
  /* Postings hold doc number × 16 + weight. A removed document leaves its number empty; postings skip it and are compacted
     once there are more removed than live documents. Every map is prototype-free, so "constructor" is just a word. */
  function create() {
    return { docs: [], byId: Object.create(null), src: Object.create(null), post: Object.create(null), pfx: Object.create(null), live: 0, dead: 0,
      people: { sig: null, tok: Object.create(null) }, types: { sig: null, tok: Object.create(null) }, byPerson: Object.create(null), byType: Object.create(null),
      token: 0, qseq: 0, stamp: null, score: null, termW: null, stats: { added: 0, removed: 0 }, groups: Object.create(null), nsrc: 0 };
  }
  function addDoc(ix, d) {
    var n = ix.docs.length, best = Object.create(null);
    d.n = n; ix.docs.push(d); ix.byId[d.id] = n; ix.live++; ix.stats.added++;
    d.fields.forEach(function (f) { words(foldText(f.t)).forEach(function (w) { if (!(best[w] >= f.w)) best[w] = f.w; }); });
    Object.keys(best).forEach(function (w) {
      var p = ix.post[w];
      if (!p) { p = ix.post[w] = []; var c = w.charAt(0); (ix.pfx[c] = ix.pfx[c] || []).push(w); }
      p.push(n * 16 + Math.min(15, best[w]));
    });
    d.people.forEach(function (id) { (ix.byPerson[id] = ix.byPerson[id] || []).push(n); });
    d.types.forEach(function (id) { (ix.byType[id] = ix.byType[id] || []).push(n); });
  }
  function dropSource(ix, id) {
    var s = ix.src[id];
    if (!s) return;
    s.docs.forEach(function (n) { var d = ix.docs[n]; if (d) { delete ix.byId[d.id]; ix.docs[n] = null; ix.live--; ix.dead++; ix.stats.removed++; } });
    delete ix.src[id]; ix.nsrc--;
  }
  function putSource(ix, s) {
    var list = s.make(), ns = [];
    list.forEach(function (d) { if (ix.byId[d.id] != null) return; d.src = s.id; addDoc(ix, d); ns.push(d.n); });
    if (!ix.src[s.id]) ix.nsrc++;
    ix.src[s.id] = { sig: s.sig, docs: ns };
  }
  function compact(ix) {
    if (ix.dead < 2000 || ix.dead < ix.live) return;
    var alive = function (n) { return !!ix.docs[n]; };
    Object.keys(ix.post).forEach(function (w) { ix.post[w] = ix.post[w].filter(function (v) { return alive(Math.floor(v / 16)); }); if (!ix.post[w].length) delete ix.post[w]; });
    Object.keys(ix.pfx).forEach(function (c) { ix.pfx[c] = ix.pfx[c].filter(function (w) { return !!ix.post[w]; }); });
    [ix.byPerson, ix.byType].forEach(function (m) { Object.keys(m).forEach(function (k) { m[k] = m[k].filter(alive); }); });
    ix.dead = 0;
  }
  /* The side indexes: words of a person's name (or a step type's label and ID) → their IDs. Rebuilt only when they change. */
  function side(s, list, textOf) {
    var sig = U.hash(JSON.stringify(list.map(function (x) { return [x.id, textOf(x)]; })));
    if (s.sig === sig) return false;
    s.sig = sig; s.tok = Object.create(null);
    list.forEach(function (x) { uniq(words(foldText(textOf(x)))).forEach(function (w) { (s.tok[w] = s.tok[w] || []).push(x.id); }); });
    return true;
  }
  function setSides(ix, input) {
    side(ix.people, (input.people || []).filter(function (p) { return p && typeof p.id === 'string'; }), function (p) { return str(p.name); });
    side(ix.types, typeList(input.stepTypes), function (t) { return str(PF.types.nameOf(t)) + ' ' + str(PF.types.aliasOf(t)) + ' ' + t.id; });
  }
  function update(ix, changed, removed) {
    (changed || []).concat(removed || []).forEach(function (x) { var g = typeof x === 'string' ? null : x.g; if (g) delete ix.groups[g]; });
    (removed || []).forEach(function (id) { dropSource(ix, id); });
    (changed || []).forEach(function (s) { dropSource(ix, s.id); putSource(ix, s); });
    compact(ix);
  }
  /* Walks sources in order, reindexing what changed. A group (a run and its notes) whose signature the index already has is
     skipped whole. A group's signature is recorded only once all its sources are done, so a walk stopped part way never
     marks a half-indexed group as current. finish() drops sources that weren't seen. */
  function walker(ix, sources) {
    var i = 0, seen = Object.create(null), seenN = 0, gseen = Object.create(null), cur = null, changed = 0, removed = 0;
    function mark(id) { if (!seen[id]) { seen[id] = 1; seenN++; } }
    function commit() { if (cur) { ix.groups[cur.g] = { gs: cur.gs, ids: cur.ids }; cur = null; } }
    return {
      done: function () { return i >= sources.length; },
      /* One source, or one whole unchanged group. Returns the source that started it. */
      next: function () {
        var s = sources[i++];
        if (s.g) {
          if (!cur || cur.g !== s.g) {
            commit(); gseen[s.g] = 1;
            var rec = ix.groups[s.g];
            if (rec && rec.gs === s.gs && rec.ids.every(function (id) { return !!ix.src[id]; })) {
              rec.ids.forEach(mark);
              while (i < sources.length && sources[i].g === s.g) i++;
              return s;
            }
            cur = { g: s.g, gs: s.gs, ids: [] };
          }
          cur.ids.push(s.id);
        } else commit();
        mark(s.id);
        var have = ix.src[s.id];
        if (!have || have.sig !== s.sig) { dropSource(ix, s.id); putSource(ix, s); changed++; }
        if (i >= sources.length) commit();
        return s;
      },
      finish: function () {
        commit();
        if (seenN !== ix.nsrc) Object.keys(ix.src).forEach(function (id) { if (!seen[id]) { dropSource(ix, id); removed++; } });
        Object.keys(ix.groups).forEach(function (g) { if (!gseen[g]) delete ix.groups[g]; });
        compact(ix);
        return { changed: changed, removed: removed };
      }
    };
  }
  /* Bring the index in line with these sources: reindex what changed, drop what's gone. Returns the counts. */
  function sync(ix, sources, input) {
    setSides(ix, input || {});
    ix.token++;
    var w = walker(ix, sources);
    while (!w.done()) w.next();
    return w.finish();
  }
  /* A build in slices: step(ms, clock) works through the sources until ms of clock() time have passed, and returns true once
     done. It also serves as a catch-up on an index that already holds most of them (unchanged runs are skipped whole). Each
     build carries a token: starting another build or a sync on the same index, or cancel(), stops this one where it is. */
  function start(ix, sources, input) {
    var token = ++ix.token, w = walker(ix, sources);
    setSides(ix, input || {});
    var job = { done: false, canceled: false, runs: { done: 0, total: sources.filter(function (s) { return s.kind === 'run'; }).length },
      cancel: function () { job.canceled = true; },
      step: function (ms, clock) {
        if (job.canceled || ix.token !== token) { job.canceled = true; return false; }
        if (job.done) return true;
        var t0 = clock(), k = 0;
        while (!w.done()) {
          if (w.next().kind === 'run') job.runs.done++;
          if (++k % 8 === 0 && clock() - t0 >= ms) break;
        }
        if (w.done()) { w.finish(); job.done = true; }
        return job.done;
      } };
    return job;
  }

  /* ---------- querying ---------- */
  function arrays(ix) {
    var n = ix.docs.length;
    if (!ix.stamp || ix.stamp.length < n) {
      var size = Math.max(1024, n * 2);
      ix.stamp = new Float64Array(size); ix.score = new Float64Array(size); ix.termW = new Float64Array(size);
    }
  }
  /* Every (doc, weight) a term reaches: its words in documents, the last one as a prefix, and people and step types by name.
     An exact word counts twice what a prefix does. */
  function reach(ix, term, visit) {
    function postings(w, k) { var p = ix.post[w]; if (p) for (var j = 0; j < p.length; j++) visit(Math.floor(p[j] / 16), (p[j] % 16) * k); }
    function viaSide(s, by, wt) {
      var ids = [];
      if (term.prefix) Object.keys(s.tok).forEach(function (w) { if (w.indexOf(term.t) === 0) s.tok[w].forEach(function (id) { ids.push([id, w === term.t ? 2 : 1]); }); });
      else (s.tok[term.t] || []).forEach(function (id) { ids.push([id, 2]); });
      ids.forEach(function (x) { var list = by[x[0]]; if (list) for (var j = 0; j < list.length; j++) visit(list[j], wt * x[1]); });
    }
    if (term.prefix) (ix.pfx[term.t.charAt(0)] || []).forEach(function (w) { if (w.indexOf(term.t) === 0) postings(w, w === term.t ? 2 : 1); });
    else postings(term.t, 2);
    viaSide(ix.people, ix.byPerson, 4);
    viaSide(ix.types, ix.byType, 3);
  }
  /* Bonuses on a document's own text: the whole phrase in one field, or every word in one field. Also picks the field to show. */
  function bonus(d, p) {
    var best = null, add = 0;
    d.fields.forEach(function (f) {
      var toks = words(foldText(f.t)), got = 0;
      p.terms.forEach(function (t) { if (toks.some(function (w) { return hits(t, w); })) got++; });
      if (!got) return;
      var b = 0;
      if (p.terms.length > 1 && got === p.terms.length) {
        b = 4;
        var joined = ' ' + toks.join(' ') + ' ', ph = ' ' + p.phrase + (p.terms[p.terms.length - 1].prefix ? '' : ' ');
        if (joined.indexOf(ph) >= 0) b += 8;
      }
      add = Math.max(add, b);
      var rank = got * 100 + b * 10 + f.w;
      if (!best || rank > best.rank) best = { rank: rank, f: f };
    });
    return { add: add, field: best ? best.f : null };
  }
  /* opts: { context: {process, run}, status: {runKey: 'unread'|'missing'}, per: items per group }. Returns
     { q, terms, total, groups: [{ kind, label, total, items: [{ id, kind, title, sub, text, step, target, status, at }] }] },
     groups in the order of their best result. */
  function query(ix, q, opts) {
    opts = opts || {};
    var p = parse(q), res = { q: String(q == null ? '' : q), terms: p, total: 0, groups: [] };
    if (!p.terms.length) return res;
    arrays(ix);
    if (ix.qseq > 1e12) { ix.stamp.fill(0); ix.qseq = 0; }
    var base = (ix.qseq += 32), stamp = ix.stamp, score = ix.score, tw = ix.termW, cand = [];
    var order = p.terms.map(function (t, i) { return i; });
    order.forEach(function (ti, i) {
      var term = p.terms[ti], last = i === order.length - 1, want = base + i, mine = base + i + 1;
      reach(ix, term, function (n, w) {
        if (!ix.docs[n]) return;
        var s = stamp[n];
        if (s === mine) { if (w > tw[n]) { score[n] += w - tw[n]; tw[n] = w; } return; }
        if (i > 0 && s !== want) return;
        stamp[n] = mine; tw[n] = w; score[n] = (i === 0 ? 0 : score[n]) + w;
        if (last) cand.push(n);
      });
    });
    res.total = cand.length;
    var ctx = opts.context || {}, status = opts.status || {}, totals = Object.create(null);
    cand.forEach(function (n) { var k = ix.docs[n].kind; totals[k] = (totals[k] || 0) + 1; });
    function ctxOf(d) { return (ctx.run && d.run === ctx.run ? 2 : 0) + (ctx.process && d.process === ctx.process ? 1 : 0); }
    /* Ties on the base score are broken here, before the cut, the same way as in the final order (context, then the most
       recent, then the ID), so 500 equal runs keep the open one and the newest rather than the first indexed. */
    var all = ix.docs;
    cand.sort(function (a, b) {
      var da = all[a], db = all[b];
      return score[b] - score[a] || ctxOf(db) - ctxOf(da) || (da.at < db.at ? 1 : da.at > db.at ? -1 : 0) || (da.id < db.id ? -1 : da.id > db.id ? 1 : 0);
    });
    /* Reranked (phrase, all words, context): the best RERANK overall, plus the best PER_KIND of every kind, so many results
       of one kind (500 runs named "Release") never push a process or a step that matches out of the list. */
    var kept = Object.create(null), pick = cand.filter(function (n, i) { var k = ix.docs[n].kind; kept[k] = (kept[k] || 0) + 1; return i < RERANK || kept[k] <= PER_KIND; });
    var top = pick.map(function (n) {
      var d = ix.docs[n], b = bonus(d, p);
      return { d: d, s: score[n] + b.add, c: ctxOf(d), field: b.field };
    });
    top.sort(function (a, b) { return b.s - a.s || b.c - a.c || (a.d.at < b.d.at ? 1 : a.d.at > b.d.at ? -1 : 0) || (a.d.id < b.d.id ? -1 : a.d.id > b.d.id ? 1 : 0); });
    var groups = Object.create(null), per = opts.per || PER_GROUP;
    top.forEach(function (x) {
      var d = x.d, g = groups[d.kind];
      if (!g) { g = groups[d.kind] = { kind: d.kind, label: LABEL[d.kind] || d.kind, total: totals[d.kind], items: [] }; res.groups.push(g); }
      if (g.items.length >= per) return;
      var f = x.field, t = d.target;
      if (f && f.step && t.view === 'run' && !t.step) t = Object.assign({}, t, { step: f.step });
      g.items.push({ id: d.id, kind: d.kind, title: d.title, shown: d.shown, sub: d.sub, text: f && f.t !== d.title ? f.t : '', target: t, status: (d.run && own(status, d.run)) || '', at: d.at });
    });
    return res;
  }
  function size(ix) { return { docs: ix.live, words: Object.keys(ix.post).length, sources: Object.keys(ix.src).length }; }

  return { KINDS: KINDS, LABEL: LABEL, fold: fold, foldText: foldText, words: words, parse: parse, mark: mark, snippet: snippet, docs: docs, create: create, sync: sync,
    update: update, start: start, query: query, size: size };
})();
