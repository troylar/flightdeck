/* The team folder's contract with AI assistants: the Flightdeck part of AGENTS.md and the skills in .flightdeck/skills.
   flightdeck install compares them with every default Flightdeck has shipped, so it can tell an old default (safe to
   update) from a team's own change (kept). bin/flightdeck.js repeats norm() and managed() in Node; test/cli.test.js
   checks the two agree. */
PF.contract = (function () {
  'use strict';
  var BEGIN = '<!-- flightdeck:begin -->', END = '<!-- flightdeck:end -->', AGENTS = 'AGENTS.md';
  /* src/baselines.json, embedded by build.py: { files: { "<file>": { "<sha-256>": ["1.10.0", …] } } }. */
  var BASELINES = /*@BASELINES@*/{};

  /* Hashes ignore a byte-order mark and Windows line endings, which editors and OneDrive may add. */
  function norm(text) { return String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); }
  /* The part of AGENTS.md Flightdeck owns: from the begin marker through the end marker. A file without both markers (every
     AGENTS.md from before 1.15) is all Flightdeck's. */
  function region(text) {
    var t = norm(text), i = t.indexOf(BEGIN), j = i < 0 ? -1 : t.indexOf(END, i);
    return i < 0 || j < 0 ? { text: t, start: 0, end: t.length, marked: false } : { text: t.slice(i, j + END.length), start: i, end: j + END.length, marked: true };
  }
  /* The text a file's hash is taken of: AGENTS.md's managed part, any other file whole. */
  function managed(path, text) { return path === AGENTS ? region(text).text : norm(text); }
  /* The name a file goes by in the baselines. */
  function baselineKey(path) { return path === AGENTS ? AGENTS + '#flightdeck' : path; }
  function hex(buf) {
    var b = new Uint8Array(buf), out = '';
    for (var i = 0; i < b.length; i++) out += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return out;
  }
  /* .flightdeck/installed.json: which Flightdeck set up the contract, and the default each file is based on. */
  function installed(version, at, by, files) {
    return JSON.stringify({ format: 'flightdeck-installed/1', version: version, at: at, by: by, files: files }, null, 2) + '\n';
  }

  /* A record written by a newer Flightdeck (flightdeck-installed/2 on, or any features at all, well formed or not): never read
     for meaning and never rewritten. bin/flightdeck.js repeats it (installedNewer); test/assistant-files.test.js checks they agree. */
  var VERSION_DIR = /^(\d+\.\d+\.\d+|dev)$/, HASH = /^[0-9a-f]{64}$/, MAX_BYTES = 8 * 1048576;
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function newerWhy(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return '';
    var m = typeof r.format === 'string' ? /^([a-z][a-z0-9-]{1,59})\/([1-9]\d{0,3})$/.exec(r.format) : null;
    if ((m && m[1] === 'flightdeck-installed' && m[2] !== '1') || (m && m[1] === 'flightdeck-installed' && (Array.isArray(r.features) ? r.features.length > 0 : r.features != null))) return 'was written by a newer Flightdeck' + (typeof r.version === 'string' && /^\d+\.\d+\.\d+$/.test(r.version) ? ' (' + r.version + ')' : '') + '.';
    return '';
  }
  /* The one verdict the command, Settings and Folder health all use (2.12.1): a record from a newer Flightdeck, by its format or
     by its version against this copy's (mine), is left alone everywhere. A dev build compares no version. */
  function recordNewer(r, mine) {
    var nw = newerWhy(r);
    if (nw) return nw;
    /* Only a record that reads, with a release number in its one written form, can be newer; anything else is malformed, and
       ignored as on 2.12.0, so a stray or absurd record never blocks an update. */
    if (wellFormed(r) && RELEASE.test(r.version) && typeof mine === 'string' && RELEASE.test(mine) && byVersion(r.version, mine) > 0) return 'was written by a newer Flightdeck (' + r.version + ').';
    return '';
  }
  /* A release number as Flightdeck writes it: three parts, no leading zeros, at most six digits each, so two of them compare by
     length and then text (byVersion) the same as by number. */
  var RELEASE = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
  /* Exactly what flightdeck install and this app write; anything else is ignored, and the next update writes a new one. */
  function wellFormed(r) {
    return !!(r && typeof r === 'object' && !Array.isArray(r) && r.format === 'flightdeck-installed/1' && typeof r.version === 'string' && (r.version === 'dev' || RELEASE.test(r.version))
      && typeof r.at === 'string' && (r.by === 'cli' || r.by === 'app') && r.files && typeof r.files === 'object' && !Array.isArray(r.files)
      && Object.keys(r.files).every(function (k) { return typeof r.files[k] === 'string' && HASH.test(r.files[k]); }));
  }
  /* The record's text (null when there's none) as the installer reads it: { newer: why } (refuse everything), { files: {},
     ignored: true }, { files: {} } when there's none, or { version, files: the entries for keys, all: every entry }. */
  function readRecord(text, keys, mine) {
    if (text == null) return { files: {} };
    var r = null;
    try { r = JSON.parse(text); } catch (e) { r = null; }
    var nw = recordNewer(r, mine);
    if (nw) return { newer: nw };
    if (!wellFormed(r)) return { files: {}, ignored: true };
    var files = {}, all = {};
    (keys || []).forEach(function (k) { if (own(r.files, k)) files[k] = r.files[k]; });
    Object.keys(r.files).forEach(function (k) { all[k] = r.files[k]; });
    return { version: r.version, files: files, all: all };
  }
  /* .flightdeck/installed.json as the folder scan shows it: the record (an object), 'bad' when it isn't one, or, from a newer
     Flightdeck (the installer's own verdict, newerWhy), { newer: true, needs, why }, which neither the app nor flightdeck
     install ever rewrites. Folder health's decisions read the record's text with readRecord, as the installer does. */
  function cleanInstalled(o) {
    var nw = newerWhy(o);
    if (nw) {
      var v = PF.envelope.judge('flightdeck-installed', o), needs = v && !v.ok && v.kind === 'newer' ? v.needs || '' : '';
      return { newer: true, needs: needs, why: '.flightdeck/installed.json was written by a newer Flightdeck. ' + PF.envelope.needsText(needs) };
    }
    var j = PF.envelope.judge('flightdeck-installed', o);
    return j.ok ? o : 'bad';
  }

  /* ---------- What AGENTS.md points to, and the content rule (2.16.0) ----------
     The command guide, the checklist essentials and the file formats say how; AGENTS.md says what may be done and cites their
     sections. An update of AGENTS.md waits while a file it would cite lacks a cited section its own default has. */
  var REFS = '.flightdeck/skills/_flightdeck/';
  /* A team writes these files, so they are read by a hand-written scan, one character at a time and never back: a line costs its
     length. (Round 11: a regular expression with a quantified run, like the fence reader's before it, can cost a long line's
     square when it fails.) Both readers agree with the CommonMark subset stated below, and the regular expressions they replaced
     (test/assistant-start.test.js holds those as the reference and compares the two). */
  /* Where a line's text starts after up to 3 spaces, or -1 when it has 4 or more (indented code). */
  function indent(l) { var i = 0; while (i < 4 && i < l.length && l.charCodeAt(i) === 32) i++; return i > 3 ? -1 : i; }
  /* Whether a line holds U+2028 or U+2029 from index i on. Those end a line for a regular expression's `.`, and norm() has
     already made every carriage return a line break, so such a line is never a fence or a heading, as before. */
  function separated(l, i) { for (; i < l.length; i++) { var c = l.charCodeAt(i); if (c === 0x2028 || c === 0x2029) return true; } return false; }
  /* Only spaces or tabs from index i on. */
  function blank(l, i) { for (; i < l.length; i++) { var c = l.charAt(i); if (c !== ' ' && c !== '\t') return false; } return true; }
  /* A fence line: up to 3 spaces, then a run of 3 or more ` or ~. { ch, n (the run's length), end (the index after it) }, or null. */
  function fenceOf(l) {
    var i = indent(l), c = i < 0 ? '' : l.charAt(i), j = i;
    if (c !== '`' && c !== '~') return null;
    while (j < l.length && l.charAt(j) === c) j++;
    return j - i < 3 || separated(l, j) ? null : { ch: c, n: j - i, end: j };
  }
  /* The lines of a Markdown text outside fenced code, after norm() (no byte-order mark, no Windows line endings). A fence opens
     on a line of 3 or more ` or ~ (up to 3 spaces in; a ` fence's info string has no `), and closes only on a line of the same
     character, at least as long, with nothing after it but spaces or tabs. An unclosed fence runs to the end. */
  function prose(md) {
    var out = [], fence = null;
    norm(md).split('\n').forEach(function (l) {
      var f = fenceOf(l);
      if (fence) { if (f && f.ch === fence.ch && f.n >= fence.n && blank(l, f.end)) fence = null; return; }
      if (f && !(f.ch === '`' && l.indexOf('`', f.end) >= 0)) { fence = f; return; }
      out.push(l);
    });
    return out;
  }
  /* The ATX headings outside fenced code: up to 3 spaces, 1-6 #s, then a space, a tab or the line's end; the text is trimmed,
     and a closing run of #s after a space or tab is dropped. Not read: setext headings (a line underlined with = or -), and
     headings inside block quotes or list items. A heading inside an HTML comment (<!-- ... -->) is read like any other: the
     reader doesn't look for comments, so commenting a section out doesn't hide it. Letter case counts. */
  function headings(md) {
    var out = [], gap = function (c) { return c === ' ' || c === '\t'; };
    prose(md).forEach(function (l) {
      var s = indent(l), e = s, k;
      if (s < 0) return;
      while (e < l.length && e - s < 7 && l.charAt(e) === '#') e++;
      var depth = e - s;
      if (depth < 1 || depth > 6 || (e < l.length && !gap(l.charAt(e))) || separated(l, 0)) return;
      var i = e, j = l.length;
      while (i < j && gap(l.charAt(i))) i++;
      while (j > i && gap(l.charAt(j - 1))) j--;
      for (k = j; k > i && l.charAt(k - 1) === '#'; k--);
      if (k < j && (k === i || gap(l.charAt(k - 1)))) for (j = k; j > i && gap(l.charAt(j - 1)); j--);
      out.push({ depth: depth, text: l.slice(i, j).trim() });
    });
    return out;
  }
  function sections(md) { return headings(md).filter(function (h) { return h.depth === 2; }).map(function (h) { return h.text; }); }
  /* A list as a lookup, so checking thousands of names against thousands of sections costs their sum, not their product. */
  function setOf(xs) { var o = Object.create(null); xs.forEach(function (x) { o[x] = true; }); return o; }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /* What a text points to. names: { path: true } for every backticked path under REFS. alias: { name: path } for the italic name
     right after a path, "`<path>` (*the command guide*)", or "(*the file formats* below)" as before 2.16.0; more adds names a
     text uses without giving them. cites: { path: [section, ...] } for every "*X* in the <name>", the longest name first. Only
     prose() counts. */
  function cites(text, more) {
    var t = prose(text).join('\n'), names = Object.create(null), alias = Object.create(null), cited = Object.create(null), seen = Object.create(null);
    t.replace(/`(\.flightdeck\/skills\/_flightdeck\/[^`\s]+)`(?: \(\*the ([a-z]+(?: [a-z]+)*)\*(?: below)?\))?/g, function (m, p, n) { names[p] = true; if (n) alias[n] = p; return m; });
    Object.keys(more || {}).forEach(function (n) { if (!own(alias, n)) alias[n] = more[n]; });
    var ks = Object.keys(alias).sort(function (a, b) { return b.length - a.length || (a < b ? -1 : 1); });
    if (ks.length) t.replace(new RegExp('\\*([^*\\n]+)\\* in the (' + ks.map(esc).join('|') + ')(?![a-z])', 'g'), function (m, x, n) {
      var p = alias[n], k = p + '\u0000' + x; cited[p] = cited[p] || []; if (!seen[k]) { seen[k] = true; cited[p].push(x); } return m;
    });
    return { names: names, alias: alias, cites: cited };
  }
  function lacks(text, want) { if (text == null) return want.slice(); var have = setOf(sections(text)); return want.filter(function (x) { return !have[x]; }); }
  /* The citations of the AGENTS.md that is live after this run, Flightdeck's part only (never Team notes): the live file's when it
     stays (current, kept, merge), this version's default when it is written (update, new, missing, forced). */
  function liveCites(a, it) {
    var stays = a.status === 'current' || a.status === 'kept' || a.status === 'merge', src = stays ? it.now : it.text;
    return src == null ? {} : cites(region(src).text).cites;
  }
  /* st: classify's statuses, in the order of items: { key, text (this version's default), now (the live text, or null), have,
     want }. A file AGENTS.md cites that stays as it is (kept or merge) and lacks a cited section its own default has gets lacks
     (a section no default has can't come from a merge, so it never counts); a kept one is staged again (restaged). AGENTS.md
     is held only from update, while any cited file lacks: merge, staged, with heldFrom and held. New, missing and forced
     AGENTS.md are always written. base (the baselines), for words only: an AGENTS.md at merge only because its own new default
     waits (its live part is a shipped default, and every waiting copy an untouched shipped default: untouched) gets onlyCopy, and waitsFor lists what its new default would still wait for.
     No status changes for that. */
  function hold(st, items, base) {
    var n = -1;
    items.forEach(function (it, i) { if (it.key === AGENTS) n = i; });
    if (n < 0) return st;
    var a = st[n], need = liveCites(a, items[n]), waits = [];
    st.forEach(function (x, i) {
      var want = need[x.key];
      if (!want || (x.status !== 'kept' && x.status !== 'merge')) return;       /* any other status writes the default, or is it */
      var def = items[i].text == null ? null : setOf(sections(items[i].text));
      var miss = lacks(items[i].now, want).filter(function (s) { return def !== null && !!def[s]; });
      if (!miss.length) return;
      x.lacks = miss;
      if (x.status === 'kept') { x.status = 'merge'; x.waiting = ''; x.stage = true; x.restaged = true; }
      waits.push({ path: x.key, lacks: miss });
    });
    if (waits.length && a.status === 'update') { a.status = 'merge'; a.waiting = ''; a.stage = true; a.heldFrom = 'update'; a.held = waits; }
    if (base && a.status === 'merge' && a.waiting && items[n].have !== items[n].want && own(base[baselineKey(AGENTS)] || {}, items[n].have) && untouched(items[n], base)) {
      var next = cites(region(items[n].text).text).cites;
      a.onlyCopy = true; a.waitsFor = [];
      st.forEach(function (x, i) {
        var want = next[x.key], miss = want && (x.status === 'kept' || x.status === 'merge') ? lacks(items[i].now, want) : [];
        if (miss.length) a.waitsFor.push({ path: x.key, lacks: miss });
      });
    }
    return st;
  }
  /* AGENTS.md from update is written after the files it cites, and only if they have what it points to then (round 11). A cited
     file whose write was refused (changed: someone else wrote it after the folder was read) keeps the text there now, nowOf[key]
     (null when it isn't there or can't be read); when that lacks a cited section its own default has, AGENTS.md waits after all.
     Returns { held } to stage it with, as hold's, or null when it goes ahead. st and items as for hold; st carries changed. */
  function holdAfter(st, items, nowOf) {
    var n = -1, waits = [];
    items.forEach(function (it, i) { if (it.key === AGENTS) n = i; });
    if (n < 0 || st[n].status !== 'update') return null;
    var need = cites(region(items[n].text).text).cites;
    st.forEach(function (x, i) {
      var want = need[x.key];
      if (!want || !x.changed) return;
      var def = items[i].text == null ? {} : setOf(sections(items[i].text)), now = nowOf && own(nowOf, x.key) ? nowOf[x.key] : null;
      var miss = lacks(now, want).filter(function (s) { return !!def[s]; });
      if (miss.length) waits.push({ path: x.key, lacks: miss });
    });
    return waits.length ? { held: waits } : null;
  }
  /* Every copy of AGENTS.md waiting to be merged is a default Flightdeck shipped, untouched (round 11): its Flightdeck part's hash
     is in the baselines and its shape (shapeOf: everything outside the markers, Team notes included) is this version's default's.
     Only then may the words say to delete the copies instead of merging them. A team's edit in a copy, inside the markers or
     under Team notes, makes it a merge that keeps the edit; a copy with no print (not read, not UTF-8) proves nothing. it.staged:
     [{ hash, shape }], as copyPrint gives them. */
  function untouched(it, base) {
    var b = base[baselineKey(AGENTS)] || {}, shape = shapeOf(AGENTS, it.text), st = it.staged || [];
    return st.length > 0 && st.every(function (x) { return !!x && typeof x.hash === 'string' && own(b, x.hash) && typeof x.shape === 'string' && x.shape === shape; });
  }
  /* Pointers no merge can satisfy: the live AGENTS.md (Flightdeck's part) cites a section that the file and its own default both
     lack. items as for hold: { key, text (this version's default), now (the live text, or null) }. Folder health shows each as
     an info line, and flightdeck install prints the same words. */
  function pointers(items) {
    var a = null, out = [];
    items.forEach(function (it) { if (it.key === AGENTS) a = it; });
    if (!a || a.now == null) return out;
    var lc = cites(region(a.now).text).cites;
    items.forEach(function (it) {
      if (it.key === AGENTS || !lc[it.key] || it.now == null) return;
      var have = setOf(sections(it.now)), def = setOf(it.text == null ? [] : sections(it.text));
      var none = lc[it.key].filter(function (x) { return !have[x] && !def[x]; });
      if (none.length) out.push({ path: it.key, sections: none, text: 'AGENTS.md points AI assistants to ' + italics(none) + ' in `' + it.key + '`, but that file has no such section and Flightdeck\'s default doesn\'t either. Add it as a ## section there, or change the pointer.' });
    });
    return out;
  }
  function italics(xs) { return xs.map(function (x) { return '*' + x + '*'; }).join(', '); }
  /* What an update does with each contract file. items: { key, baseKey (the name in the baselines, when not the key's own),
     want (this version's default, hashed), have (the file's hash, null when it isn't there), staged: [{ version, hash }] (copies
     waiting in the updates folder) }. Statuses, in the order they're decided:
       new / missing   not there (missing: the record says it was installed)
       merge           a copy is still waiting to be merged, even if the file already matches; stage says this version's
                       default has to be staged too (it isn't already, and the file doesn't already say it)
       current         same as this version's default
       update          a default some version shipped
       kept            the team changed it, and the record says it's based on this version's default
       merge           the team changed it and the default changed too
   The record only ever makes an update more careful. bin/flightdeck.js repeats this (decide). */
  function classify(items, record, base, version) {
    var rf = (record && record.files) || {};
    var out = items.map(function (it) {
      var out = { key: it.key, status: '' }, staged = it.staged || [];
      if (it.have == null) { out.status = rf[it.key] ? 'missing' : 'new'; return out; }
      if (staged.length) {
        out.status = 'merge'; out.waiting = staged.map(function (x) { return x.version; }).join(', ');
        out.stage = it.have !== it.want && !staged.some(function (x) { return x.version === version || x.hash === it.want; });
        return out;
      }
      if (it.have === it.want) out.status = 'current';
      else if ((base[it.baseKey || baselineKey(it.key)] || {})[it.have]) out.status = 'update';
      else if (rf[it.key] === it.want) out.status = 'kept';
      else out.status = 'merge';
      return out;
    });
    return hold(out, items, base);
  }
  /* What a file is besides Flightdeck's part, exactly as written: '' for a skill (all of it is Flightdeck's), the text before and
     after the markers for AGENTS.md, or null when it can't be a shipped default byte for byte (a byte-order mark, Windows line
     endings, or AGENTS.md without both markers). A waiting copy is a shipped default exactly when its managed part's hash is in
     the baselines and its shape is the shape of the default this version ships, Team notes heading and all: Flightdeck has
     shipped one AGENTS.md shape since 1.15 (test/assistant-start.test.js checks every release since). */
  function shapeOf(key, text) {
    var t = String(text == null ? '' : text);
    if (norm(t) !== t) return null;
    if (key !== AGENTS) return '';
    var r = region(t);
    return r.marked ? t.slice(0, r.start) + '\u0000' + t.slice(r.end) : null;
  }
  /* A file's fingerprints for classifyCopies, from its raw text: the SHA-256 of its Flightdeck part (as the baselines hold it)
     and its shape (shapeOf). Raw: decoded from its bytes with a byte-order mark kept (repo.readRaw in the app, readFileSync in
     the command), never File.text(), which drops one. null text (unread, or not UTF-8) has neither. */
  function copyPrint(key, raw) {
    if (typeof raw !== 'string') return { hash: null, shape: null };
    return { hash: PF.sha256.hex(managed(key, raw)), shape: shapeOf(key, raw) };
  }
  /* The one rule for which copies waiting in the updates folder are old copies an older Flightdeck left, with nothing in them
     to merge (2.12.1). The app's scan, Settings, Folder health and the command all ask this, and nothing else decides. An old copy
     is named, with its path, as safe to delete by hand; nothing removes or archives it on its own, but I merged it, on a
     file with another copy to merge, files away every copy of that file, as 2.12.0 did. A copy is old when all three hold:
     (a) the whole copy is exactly the default its own version shipped: its shape is the one this version ships (Flightdeck has
         shipped one AGENTS.md shape since 1.15; test/assistant-start.test.js checks every release since) and its Flightdeck
         part's hash is in the baselines under that version. A byte-order mark, Windows line endings, a Team note or a merge
         note keep it a merge;
     (b) a newer default of that file has shipped, and it differs from the copy;
     (c) that newer default is in hand: the file's Flightdeck part is exactly it, or another copy waiting for it holds it.
     A newer record alone proves nothing. o: { key, baseKey, shipped (this version's default), version (this app's), base (the
     baselines), active, copies: [{ version, text }] }, where active and each text are raw (see copyPrint), or a print from
     copyPrint in place of the text ({ version, print }), or null. Returns 'old' or 'merge' for each copy, in order. */
  function classifyCopies(o) {
    var key = o.key, base = o.base || {}, b = base[o.baseKey || baselineKey(key)] || {}, list = o.copies || [];
    if (!list.length) return [];
    var printOf = function (x) { return x && x.print ? x.print : copyPrint(key, x && typeof x === 'object' ? x.text : x); };
    var shipped = copyPrint(key, o.shipped), active = o.active && typeof o.active === 'object' ? o.active : copyPrint(key, o.active);
    var prints = list.map(printOf);
    return list.map(function (x, n) {
      var p = prints[n];
      if (!x || !RELEASE.test(x.version) || !p.hash || p.shape === null || p.shape !== shipped.shape || !own(b, p.hash) || b[p.hash].indexOf(x.version) < 0) return 'merge';
      var later = function (v) { return typeof v === 'string' && RELEASE.test(v) && byVersion(v, x.version) > 0; };
      var newer = function (h) { return !!h && h !== p.hash && ((own(b, h) && b[h].some(later)) || (h === shipped.hash && later(o.version))); };
      return newer(active.hash) || prints.some(function (y, m) { return m !== n && newer(y.hash); }) ? 'old' : 'merge';
    });
  }
  /* The text written for a contract file: AGENTS.md keeps everything outside its markers (the team's notes). */
  function merged(key, now, text) {
    if (key !== AGENTS || now == null) return text;
    var old = region(now), fresh = region(text);
    return old.marked ? norm(now).slice(0, old.start) + fresh.text + norm(now).slice(old.end) : text;
  }
  /* The record's files after an update: every entry kept, each item not changed during the update set to this version's
     default. null when nothing would change (a valid record of this version with exactly these entries). */
  function nextRecord(record, items, version) {
    var rec = {}, all = (record && record.all) || {};
    Object.keys(all).forEach(function (k) { rec[k] = all[k]; });
    /* A held or onlyCopy AGENTS.md wasn't written, so it keeps its previous entry, as a file changed during the update does: the
       record still says what is live, and a later edit inside the markers reads as the team's change. */
    items.forEach(function (i) { if (!i.changed && !(i.key === AGENTS && (i.heldFrom || i.onlyCopy))) rec[i.key] = i.want; });
    if (record && !record.ignored && record.version === version && JSON.stringify(rec) === JSON.stringify(record.all)) return null;
    return rec;
  }
  /* Oldest first, dev last: the order install and the app both list waiting versions in. */
  function byVersion(a, b) {
    if (a === b) return 0; if (a === 'dev') return 1; if (b === 'dev') return -1;
    var x = a.split('.'), y = b.split('.');
    for (var i = 0; i < 3; i++) { if (x[i].length !== y[i].length) return x[i].length - y[i].length; if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; }
    return 0;
  }
  /* The README beside staged defaults: which files, and a prompt for an AI assistant. updates: the updates folder's parts.
     ctx (for the words only): { base (the baselines), record (as readRecord gave it), agents (this version's default
     AGENTS.md) }. Each item may carry hold's lacks, restaged, heldFrom and held, or onlyCopy and waitsFor. */
  /* Never an unconditional delete (round 12): someone may have added a rule to a waiting copy, and it may be its only copy.
     test/docs.test.js checks every such sentence Flightdeck ships says when. */
  var DELETE_AGENTS = 'press I merged it in Settings → AI assistant files, which keeps each copy under `replaced/`, or delete AGENTS.md from each version folder in `.flightdeck/updates/` (`.flightdeck/updates/<version>/AGENTS.md`, never anything under `replaced/`) only if nobody changed those copies. A copy someone changed is a merge: merge what it adds into AGENTS.md first. Then run install again; Flightdeck writes AGENTS.md itself.';
  function mergeReadme(version, items, updates, home, ctx) {
    var here = updates.concat(version).join('/'), c = ctx || {}, base = c.base || {}, rf = (c.record && c.record.files) || {};
    var alias = c.agents == null ? {} : cites(region(c.agents).text).alias, waitsOn = Object.create(null);
    var named = function (p) { var n = Object.keys(alias).filter(function (k) { return alias[k] === p; })[0]; return '`' + p + '`' + (n ? ' (the ' + n + ')' : ''); };
    var listN = function (ws) { return ws.map(function (w) { var n = named(w.path); return /\)$/.test(n) ? n.replace(/\)$/, ': ' + italics(w.lacks) + ')') : n + ' (' + italics(w.lacks) + ')'; }).join(', '); };
    /* A file with no shipped history: its live text is no default Flightdeck ever shipped, and the record has no entry for it. */
    var noHistory = function (i) { return i.key !== AGENTS && i.now != null && !own(base[i.baseKey || baselineKey(i.key)] || {}, i.have) && !own(rf, i.key); };
    items.forEach(function (i) { if (i.key === AGENTS) (i.held || i.waitsFor || []).forEach(function (x) { waitsOn[x.path] = true; }); });
    var special = items.some(function (i) { return i.heldFrom || i.restaged || i.onlyCopy || noHistory(i); });
    var head = special ? 'Flightdeck ' + version + ' put a new default of each file below in this folder, and left your versions in place. Unless its line says otherwise, Flightdeck changed the file and your team changed it too:'
      : 'Flightdeck ' + version + ' changed these files, and your team changed them too, so the update left your versions in place:';
    /* One section named, or more: "the section", "that section". */
    var those = function (xs) { return xs.length === 1 ? 'that section' : 'those sections'; };
    var line = function (i) {
      var s = '- `' + i.rel + '`', p = i.heldFrom && i.held.length === 1 ? '`' + i.held[0].path + '`' : '';
      /* AGENTS.md's own note follows its marker words as sentences, never a second pair of parentheses. */
      var mine = i.key === AGENTS ? ' — only the part between the flightdeck markers. ' : null;
      if (i.heldFrom) s += mine + (i.held.length === 1
        ? 'Held: ' + named(i.held[0].path) + ' doesn\'t have the ' + (i.held[0].lacks.length === 1 ? 'section' : 'sections') + ' the new AGENTS.md points to: ' + italics(i.held[0].lacks) + '. Your team didn\'t change AGENTS.md\'s Flightdeck part. If ' + p + ' is your team\'s own file, move it out of `_flightdeck/`; otherwise merge its new default from this folder into it. Then ' + DELETE_AGENTS + ' Until ' + p + ' has ' + those(i.held[0].lacks) + ', AGENTS.md waits and its new default is staged again.'
        : 'Held: these files don\'t have the sections the new AGENTS.md points to: ' + listN(i.held) + '. Your team didn\'t change AGENTS.md\'s Flightdeck part. If one is your team\'s own file, move it out of `_flightdeck/`; otherwise merge its new default from this folder into it. Then ' + DELETE_AGENTS + ' Until they have those sections, AGENTS.md waits and their new defaults are staged again.');
      else if (i.onlyCopy && i.waitsFor && i.waitsFor.length) s += mine + 'Your team didn\'t change AGENTS.md\'s Flightdeck part, so you don\'t need to merge it. It waits for ' + (i.waitsFor.length === 1 ? named(i.waitsFor[0].path) + ', which doesn\'t have ' + italics(i.waitsFor[0].lacks) + '. Merge that file first. ' : 'these files, which don\'t have the sections it points to: ' + listN(i.waitsFor) + '. Merge those files first. ') + 'Then ' + DELETE_AGENTS;
      else if (i.onlyCopy) s += mine + 'Your team didn\'t change AGENTS.md\'s Flightdeck part, so you don\'t need to merge it: ' + DELETE_AGENTS;
      else if (mine) s += ' (only the part between the flightdeck markers)';
      else if (noHistory(i)) s += ' (Flightdeck now ships a file at this path. ' + (waitsOn[i.key] ? 'AGENTS.md waits for this file: see its line above. Merge the new default into it' : i.lacks ? 'It doesn\'t have ' + italics(i.lacks) + ', which AGENTS.md points to: bring ' + those(i.lacks) + ' in from the new default' : 'Merge the new default into it') + ', or, if it is your team\'s own file, move it out of `_flightdeck/`.)';
      else if (waitsOn[i.key]) s += ' (AGENTS.md waits for this file: see its line above.' + (i.restaged ? ' Flightdeck didn\'t change this file.' : '') + ')';
      else if (i.restaged) s += ' (staged again: it doesn\'t have ' + italics(i.lacks) + ', which AGENTS.md points to. Flightdeck didn\'t change this file. Merge ' + those(i.lacks) + ' in from this folder\'s new default, or, if it is your team\'s own file, move it out of `_flightdeck/`.)';
      else if (i.lacks) s += ' (it doesn\'t have ' + italics(i.lacks) + ', which AGENTS.md points to: bring ' + those(i.lacks) + ' in from the new default when you merge.)';
      return s;
    };
    return '# Flightdeck ' + version + ': files to merge\n\n' + head + '\n\n' + items.map(line).join('\n') +
      '\n\nThe new default of each file is in this folder (`' + here + '/`), at the same path it has in ' + home + '.\n\n## Ask your AI assistant to merge them\n\nOpen your AI assistant in ' + home + ', and give it this:\n\n' +
      mergePrompt(version, here) + '\n\nThen run the same flightdeck command with `--check`: exit code 0 means nothing is left to merge; 2 means install still has files to write, so run install again.\n';
  }
  /* The request a person hands their AI assistant, quoted in the README and copied by the app's Copy merge request. */
  function mergePrompt(version, here) {
    return '> Flightdeck ' + version + ' put new default versions of some files in `' + here + '/`; its README.md lists them. For each one, compare the new default with our file at the same path. Keep our own changes, and bring in what the new default adds or changes. In AGENTS.md, change only the part between `<!-- flightdeck:begin -->` and `<!-- flightdeck:end -->`; anything that is ours belongs under Team notes, below the end marker. ' +
      'If our file has Flightdeck text the new default leaves out, look for it in `_flightdeck/` (`.flightdeck/skills/_flightdeck/` in a team folder), or in the new default here of any `_flightdeck/` file README.md lists. Text found there has moved, so don\'t copy it back. Where our version of it differs, that difference is ours: put it under Team notes and tell me. If it is in neither place, keep it under Team notes and tell me. Merge the `_flightdeck/` files before AGENTS.md, and check that each has every section the new AGENTS.md (the default here) points to. If README.md says Flightdeck writes a file itself, merge the other files first, then run the same flightdeck command with `--check`: only if it still says so, and that file\'s copies hold nothing of ours, delete it from each version folder in `.flightdeck/updates/` (`.flightdeck/updates/<version>/AGENTS.md`, never anything under `replaced/`). A copy that holds anything of ours is a merge like the others. ' +
      'Show me each change before you save it. When a file is merged, delete its copy here. When only README.md is left, delete this folder.';
  }
  /* The first thing to paste into an AI assistant opened on the team folder: plain text, naming no tool. Not every tool reads
     .flightdeck/skills on its own, and one stops reading AGENTS.md partway, so it says both out loud. */
  var START_PROMPT = 'Read AGENTS.md in this folder, to the end, and follow it. If this folder has no AGENTS.md, stop and tell me to open the team folder itself.\n\n' +
    'The Flightdeck skills are in .flightdeck/skills/, one folder per skill, each with a SKILL.md. Your tool may not load them on its own, so list that folder yourself. When one fits the job, read its SKILL.md and follow it. A name like /flightdeck-status or $flightdeck-status means .flightdeck/skills/flightdeck-status/SKILL.md.\n\n' +
    'Don\'t change anything yet. Tell me in a few lines what you can help with here, then ask me what I want done.';
  /* ---------- How a write ended: one outcome, one set of words ----------
     Update and I merged it collect facts as they go; settle says which outcome those facts are, and outcomeWords is the only
     thing that turns one into words, for the Settings screen, for an announcement and for the move to the team folder. An
     outcome with no words is an error, never a guess. */
  function shortList(a) { return a.slice(0, 5).join(', ') + (a.length > 5 ? ' and ' + (a.length - 5) + ' more' : ''); }
  function count(n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); }
  function done(o, w) {
    var parts = [];
    if (o.wrote) parts.push('Updated ' + count(o.wrote, 'file') + '.');
    if (o.kept) parts.push('Kept ' + o.kept + ' you changed.');
    if (o.staged) parts.push('Put ' + count(o.staged, 'new default') + ' to merge in ' + w.updates.join('/') + '/' + w.version + '/.');
    if (o.replaced) parts.push('Copies of what was replaced are in ' + o.replaced + '.');
    else if (o.copiesAt) parts.push('A folder for copies was started at ' + o.copiesAt + ', with no checked copy in it yet.');
    if (o.ignored) parts.push('The old record wasn\'t one Flightdeck wrote, so it wasn\'t trusted' + (o.record ? '; a new one was written.' : '.'));
    else if (o.record && !o.wrote && !o.staged) parts.push('The record of these files is saved.');
    return parts;
  }
  function troubles(o) {
    var parts = [];
    if (o.unverified && o.unverified.length) parts.push(shortList(o.unverified) + (o.unverified.length === 1 ? ' was written, but Flightdeck couldn\'t read it back to check it.' : ' were written, but Flightdeck couldn\'t read them back to check them.'));
    if (o.unsure && o.unsure.length) parts.push(shortList(o.unsure) + ' may or may not have been written: the write failed and Flightdeck can\'t tell how far it got.');
    if (o.moved && o.moved.length) parts.push(shortList(o.moved) + (o.moved.length === 1 ? ' was written, then changed by something else before Flightdeck could read it back. Look at it again.' : ' were written, then changed by something else before Flightdeck could read them back. Look at them again.'));
    if (o.skipped && o.skipped.length) parts.push('Left as they are, because they changed while updating: ' + shortList(o.skipped) + '. Those weren\'t replaced; check them again.');
    return parts;
  }
  function wroteWords(o, w) { return done(o, w).concat(troubles(o)).join(' '); }
  var OUTCOMES = {
    newer: { kind: 'warn', words: function (o, w) { return 'Nothing was changed. ' + w.recordAt + ' ' + o.newer + ' Use the newer Flightdeck.'; } },
    'too-big': { kind: 'warn', words: function (o) { return o.tooBig; } },
    blocked: { kind: 'warn', words: function (o) { return blockedWhy(o.blocked.path, o.blocked.want); } },
    refused: { kind: 'warn', words: function () { return 'Nothing was changed. This browser didn\'t allow writing to the folder.'; } },
    failed: { kind: 'warn', words: function (o) { return 'Nothing was changed. ' + o.error.why; } },
    partial: { kind: 'warn', reload: true, words: function (o, w) { return ['The update stopped partway: ' + o.error.why].concat(done(o, w), troubles(o), ['Look at the files, then try again.']).join(' '); } },
    unverified: { kind: 'warn', reload: true, words: function (o, w) { return ['The update stopped: ' + o.error.why].concat(done(o, w), troubles(o), ['Look at the files, then try again.']).join(' '); } },
    nothing: { kind: 'good', reload: true, words: function (o, w) { return ['Nothing needed changing.'].concat(done(o, w)).join(' '); } },
    written: { kind: 'good', reload: true, words: wroteWords },
    moved: { kind: 'warn', reload: true, words: wroteWords },
    skipped: { kind: 'warn', reload: true, words: wroteWords },
    'merge-done': { kind: 'good', reload: true, words: function () { return 'Put away. The copy is beside the replaced files, in case you need it.'; } },
    'merge-left': { kind: 'warn', reload: true, words: function (o) { return 'A copy waiting in ' + (o.left.length === 1 ? o.left[0] : o.left.length + ' versions') + ' changed since this screen read it, so it was left where it is. Look at it again.'; } },
    'merge-partial': { kind: 'warn', reload: true, words: function (o) { return count(o.putAway, 'copy').replace('copys', 'copies') + (o.putAway === 1 ? ' was' : ' were') + ' put away before this stopped: ' + o.error.why; } },
    'merge-unsure': { kind: 'warn', reload: true, words: function (o) { return (o.putAway ? count(o.putAway, 'copy').replace('copys', 'copies') + (o.putAway === 1 ? ' was' : ' were') + ' put away. ' : '') + 'The copy waiting in ' + shortList(o.unsure) + ' may or may not have been put away: removing it failed and Flightdeck couldn\'t check. ' + o.error.why + ' Look at it again.'; } },
    'merge-failed': { kind: 'warn', words: function (o) { return 'Nothing was put away. ' + o.error.why; } }
  };
  function settleState(f) {
    if (f.op === 'merge' && f.unsure && f.unsure.length) return 'merge-unsure';
    if (f.op === 'merge') return f.error ? (f.putAway ? 'merge-partial' : 'merge-failed') : f.left.length ? 'merge-left' : 'merge-done';
    if (f.newer) return 'newer';
    if (f.tooBig) return 'too-big';
    if (f.blocked) return 'blocked';
    if ((f.unverified && f.unverified.length) || (f.unsure && f.unsure.length)) return 'unverified';
    var any = f.wrote || f.staged || f.record || f.replaced || f.copiesAt || f.moved.length;
    if (f.error) return any ? 'partial' : f.error.denied ? 'refused' : 'failed';
    return f.moved.length ? 'moved' : f.skipped.length ? 'skipped' : any ? 'written' : 'nothing';
  }
  function settle(facts) { return Object.assign({}, facts, { state: settleState(facts) }); }
  function outcomeWords(o, w, opts) {
    var e = OUTCOMES[o.state];
    if (!e) throw new Error('An outcome with no words: ' + o.state);
    var text = e.words(o, w) + (o.recheck ? ' Checking the files again didn\'t work: ' + o.recheck : '');
    return { kind: o.recheck ? 'warn' : e.kind, text: text, said: 'AI assistant files in ' + w.home + ': ' + text + (opts && opts.then ? ' Showing the team folder.' : '') };
  }
  /* Something in the way of where a file goes. The same words as the command's. */
  function blockedWhy(path, want) { return path + (want === 'file' ? ' is a folder, where Flightdeck needs a file.' : ' is a file, where Flightdeck needs a folder.') + ' Nothing was changed. Move it, then try again.'; }

  return { START_PROMPT: START_PROMPT, OUTCOMES: OUTCOMES, settle: settle, outcomeWords: outcomeWords, MAX_BYTES: MAX_BYTES, cleanInstalled: cleanInstalled, readRecord: readRecord, newerWhy: newerWhy, recordNewer: recordNewer, RELEASE: RELEASE, shapeOf: shapeOf, copyPrint: copyPrint, classifyCopies: classifyCopies, classify: classify, REFS: REFS, prose: prose, headings: headings, sections: sections, cites: cites, lacks: lacks, liveCites: liveCites, hold: hold, holdAfter: holdAfter, pointers: pointers, merged: merged, nextRecord: nextRecord, mergeReadme: mergeReadme, mergePrompt: mergePrompt, byVersion: byVersion, VERSION_DIR: VERSION_DIR,
    BEGIN: BEGIN, END: END, AGENTS: AGENTS, BASELINES: BASELINES, norm: norm, region: region, managed: managed, baselineKey: baselineKey, hex: hex, installed: installed };
})();
