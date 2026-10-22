/* Evidence packs (docs/evidence.md, docs/design.md section 24), the pure part: date ranges, size caps, what each original
   is, the checks and claims a page shows, and the generated files: evidence.html (a readable page that runs no script),
   manifest.json (SHA-256 of every payload file), SHA256SUMS (payload plus manifest) and README.txt. Collecting the files
   is repo.collectEvidence, read-only; writing the zip is PF.zip. Nothing from a file reaches the page unescaped. */
PF.evidence = (function () {
  'use strict';
  var U = PF.util, S = PF.sha256, Z = PF.zip, M = PF.map, R = PF.run, C = PF.corrections, F = PF.followups, esc = U.esc;
  var FORMAT = 'flightdeck-evidence/1', MB = 1048576;
  var CSP = 'default-src \'none\'; img-src data:; style-src \'unsafe-inline\'';
  var PRIVACY = 'The people directory and its email fields are left out. Original records and attachments may contain personal information.';
  var VERIFY = 'Checking these hashes shows whether the files still match. Compare the pack\'s own digest with one you kept separately. An unsigned pack can\'t prove by itself that it hasn\'t changed, or who made it.';
  var LIMITED = 'This page shows only what this copy understands; the original files are complete.';
  var CAPS = { desktop: 500 * MB, phone: 150 * MB, runs: 200, file: 100 * MB };

  function size(n) { return n < 1024 ? n + ' bytes' : n < MB ? (n / 1024).toFixed(1) + ' KB' : (n / MB % 1 === 0 ? n / MB : (n / MB).toFixed(1)) + ' MB'; }
  /* The browser's byte cap: lower on a phone-width screen or a device that says it has 4 GB of memory or less. */
  function capFor(o) { o = o || {}; return (o.width && o.width < 700) || (o.deviceMemory && o.deviceMemory <= 4) ? CAPS.phone : CAPS.desktop; }

  /* ---------- dates: inclusive days in a time zone ---------- */
  function zoneOk(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0); return true; } catch (e) { return false; } }
  var fmts = {};
  /* The date (YYYY-MM-DD) a clock in tz shows at instant t. */
  function localDay(t, tz) {
    var f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })), p = {};
    f.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  /* The first instant whose local date is d or later. Offsets are whole minutes, and a day starts within 16 hours of its UTC
     midnight, so walk in 15-minute steps to the first one past the start, then minute by minute back. No offset arithmetic:
     a midnight that a clock change skips (America/Santiago in September) or repeats still gives the instant the clock shows. */
  function firstInstant(d, tz) {
    var g = Date.parse(d + 'T00:00:00Z'), t = g - 16 * 3600000, end = g + 16 * 3600000;
    while (t <= end && localDay(t, tz) < d) t += 15 * 60000;
    for (var k = 0; k < 15 && localDay(t - 60000, tz) >= d; k++) t -= 60000;
    return t;
  }
  function day(s, what) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) throw new Error('Give ' + what + ' as YYYY-MM-DD, for example 2026-10-17.');
    var y = +m[1], mo = +m[2], d = +m[3], t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) throw new Error(s + ' isn\'t a real date.');
    return s;
  }
  /* Runs started on these days, both included, by the date a clock in tz showed when each started. start and end are the
     first and last instants of that span, for saying it; inRange decides by the local date itself, so an hour a clock
     change repeats belongs to the day the clock showed. */
  function dayRange(from, through, tz) {
    if (!tz || !zoneOk(tz)) throw new Error('"' + tz + '" isn\'t a time zone this computer knows. Use a name like Europe/London or America/New_York.');
    day(from, 'the first day'); day(through, 'the last day');
    if (from > through) throw new Error('The first day (' + from + ') is after the last day (' + through + ').');
    var next = new Date(Date.parse(through + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    return { start: firstInstant(from, tz), end: firstInstant(next, tz) - 1, from: from, through: through, tz: tz };
  }
  function inRange(created, range) { var t = Date.parse(created); if (isNaN(t)) return false; var d = localDay(t, range.tz); return d >= range.from && d <= range.through; }

  /* ---------- bytes ---------- */
  function join(parts) {
    if (!parts) return null;
    if (parts.length === 1) return parts[0];
    var n = 0; parts.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n), at = 0; parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  /* UTF-8 bytes to text, with U+FFFD for anything that isn't UTF-8, so a damaged file still shows. */
  function text(u8) {
    if (!u8) return null;
    var out = [], s = '', i = 0, n = u8.length;
    if (n >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) i = 3;
    while (i < n) {
      var c = u8[i], need = c < 0x80 ? 0 : c >= 0xc2 && c < 0xe0 ? 1 : c >= 0xe0 && c < 0xf0 ? 2 : c >= 0xf0 && c < 0xf5 ? 3 : -1, cp = need === 0 ? c : need === 1 ? c & 31 : need === 2 ? c & 15 : c & 7, ok = need >= 0;
      for (var k = 1; ok && k <= need; k++) { var b = u8[i + k]; if (b === undefined || (b & 0xc0) !== 0x80) ok = false; else cp = (cp << 6) | (b & 63); }
      if (ok && ((need === 2 && (cp < 0x800 || (cp >= 0xd800 && cp < 0xe000))) || (need === 3 && (cp < 0x10000 || cp > 0x10ffff)))) ok = false;
      if (!ok) { s += '�'; i++; }
      else { s += cp < 0x10000 ? String.fromCharCode(cp) : String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 1023)); i += need + 1; }
      if (s.length > 8192) { out.push(s); s = ''; }
    }
    out.push(s);
    return out.join('');
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(u8) {
    var out = [], s = '';
    for (var i = 0; i < u8.length; i += 3) {
      var a = u8[i], b = u8[i + 1], c = u8[i + 2], t = (a << 16) | ((b || 0) << 8) | (c || 0);
      s += B64[(t >> 18) & 63] + B64[(t >> 12) & 63] + (i + 1 < u8.length ? B64[(t >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[t & 63] : '=');
      if (s.length > 8192) { out.push(s); s = ''; }
    }
    out.push(s);
    return out.join('');
  }
  /* A picture the page may show inline: its bytes must really be PNG, JPEG, GIF or WebP, whatever the name says. */
  function imageType(name, u8) {
    if (!u8 || u8.length < 12 || !/\.(png|jpe?g|gif|webp)$/i.test(name)) return '';
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png';
    if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
    if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'image/gif';
    if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'image/webp';
    return '';
  }
  /* JSON with its keys in order, for comparing step types as data, never as text. */
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function json(t) { try { return JSON.parse(t); } catch (e) { return undefined; } }

  /* ---------- what each file in a run folder is ---------- */
  var CAND = /^candidate-(.+)-([a-z0-9]{8})\.json$/;
  function candidateTag(name) { var m = CAND.exec(name); return m ? m[1] + '.' + m[2] : null; }
  /* role and label for a file directly in a run folder (or under it, rel), and whether a lineage receipt or a temporary file. */
  function classify(rel, lineage) {
    var name = rel.split('/').pop();
    /* Everything under files/, at any depth, is an attachment (a note's file path may name a folder in it). */
    if (rel.indexOf('/') >= 0) return rel.indexOf('files/') === 0 ? { role: 'attachment', label: 'Attachment' } : { role: 'other', label: 'Another file in the run folder' };
    if (/\.tmp$/i.test(name)) return { exclude: 'temporary file left by a save' };
    if (name === 'run.json') return { role: 'run', label: 'The run' };
    if (/^notes-[\w-]+\.jsonl$/.test(name)) return { role: 'notes', label: 'Notes and corrections from one window' };
    if (/^history-[\w-]+\.jsonl$/.test(name)) return { role: 'history', label: 'Records archived from the run' };
    if (/^run\.conflict-.+\.json$/i.test(name)) return { role: 'conflict', label: 'Conflict copy: a save that was refused' };
    if (/^replaced-.+\.json$/i.test(name)) return { role: 'replaced', label: 'A version replaced when a copy was kept' };
    var tag = candidateTag(name);
    if (tag && lineage && lineage.indexOf(tag) >= 0) return { exclude: 'already included in run.json, which lists it in its lineage' };
    if (tag) return { role: 'candidate', label: 'Save receipt', flag: lineage ? 'a save that may not be in run.json' : 'a save that may not be in run.json (run.json couldn\'t be read to check)' };
    if (/^run.*\.json$/i.test(name)) return { role: 'copy', label: 'OneDrive\'s copy of run.json, or another copy of it' };
    return { role: 'other', label: 'Another file in the run folder' };
  }

  /* ---------- reading the records the page shows ---------- */
  /* Every line of a notes file, by line number: notes as written (duplicates included) and the lines that aren't notes. */
  function notesFile(t) {
    var lines = String(t).split('\n'), notes = [], malformed = [];
    lines.forEach(function (l, i) {
      if (!l.trim()) return;
      var n = json(l);
      if (n && typeof n === 'object' && typeof n.id === 'string' && typeof n.text === 'string') notes.push({ line: i + 1, note: n });
      else malformed.push(i + 1);
    });
    return { notes: notes, malformed: malformed, lines: lines.filter(function (l) { return l.trim(); }).length };
  }

  /* The checks a run's own copy of its checklist and step types must pass against the version it names. */
  /* A screenshot the version records, against the snapshot of its bytes ({ sha256, bytes } or null when it isn't in the
     folder): '' when it matches, else why. For a /2 version the SHA-256 in its payload decides; the fingerprint is checked
     whenever the bytes were kept. null: it can't be checked from what was kept. */
  function imageProblem(info, src, x) {
    if (!x) return 'Screenshot ' + src + ' isn\'t in the folder.';
    var strong = info.format === PF.publish.FORMAT2 && info.payload && info.payload.images ? info.payload.images[src] : null;
    if (strong && x.sha256 !== strong) return 'Screenshot ' + src + ' doesn\'t match the version\'s payload.';
    if (x.bytes) { var s = ''; for (var i = 0; i < x.bytes.length; i += 32768) s += String.fromCharCode.apply(null, x.bytes.subarray(i, i + 32768)); if (U.hash(s) !== info.images[src]) return 'Screenshot ' + src + ' doesn\'t match its publication record.'; }
    else if (!strong) return null;
    return '';
  }
  /* stage (2.1): the run is a test run, so its version is its stage, checked by the stage rules. */
  function checks(raw, pub, images, stage) {
    var out = [];
    function add(id, what, ok, detail) { out.push({ id: id, what: what, ok: ok, detail: detail || '' }); }
    var map = pub && pub['map.md'], types = pub && pub['types.json'], info = pub && pub['publication.json'];
    if (!raw || typeof raw !== 'object') { add('run', 'The run file', null, 'run.json couldn\'t be read, so nothing could be checked against its version.'); return out; }
    if (map == null) add('snapshot', 'The run\'s copy of the checklist matches the version\'s map.md', null, 'map.md isn\'t in the folder, so this can\'t be checked.');
    else add('snapshot', 'The run\'s copy of the checklist matches the version\'s map.md', raw.snapshot === map, raw.snapshot === map ? 'Byte for byte.' : 'They differ.');
    var tj = types == null ? undefined : json(types);
    if (types == null) add('types', 'The run\'s frozen step types match the version\'s types.json', null, 'types.json isn\'t in the folder, so this can\'t be checked.');
    else if (tj === undefined) add('types', 'The run\'s frozen step types match the version\'s types.json', null, 'types.json isn\'t valid JSON, so this can\'t be checked.');
    else { var same = canonical(raw.types || {}) === canonical(tj); add('types', 'The run\'s frozen step types match the version\'s types.json', same, same ? 'Compared as data.' : 'They differ.'); }
    if (map == null) add('mapHash', 'The checklist fingerprint the run recorded matches map.md', null, 'map.md isn\'t in the folder.');
    else add('mapHash', 'The checklist fingerprint the run recorded matches map.md', raw.mapHash === U.hash(map), 'Recorded ' + String(raw.mapHash || 'none') + ', map.md gives ' + U.hash(map) + '.');
    if (info == null || map == null || types == null) add('publication', 'The version is complete and checks out', null, 'Some of its files aren\'t in the folder.');
    else {
      /* A /2 version by the SHA-256 of the exact bytes of its checklist and step types, as snapshotted for the pack. */
      var exact = {};
      if (images) ['map.md', 'types.json'].forEach(function (n) { var x = images['\u0000' + n]; if (x && x.sha256) exact[n] = x.sha256; });
      var v = PF.publish.verify(raw.folder, pub, exact, stage ? { stage: true } : null), shot = '', unsure = '';
      /* Its screenshots too, by the bytes in the pack: the version is checked as the app checks it. */
      if (v.ok && images) Object.keys(v.info.images && typeof v.info.images === 'object' ? v.info.images : {}).forEach(function (src) {
        if (shot) return;
        var why = imageProblem(v.info, src, images[src] || null);
        if (why) shot = why; else if (why === null && !unsure) unsure = src;
      });
      if (shot) add('publication', 'The version is complete and checks out', false, shot);
      else add('publication', 'The version is complete and checks out', v.ok ? true : v.unusable || v.needsBytes ? null : false, v.ok ? 'publication.json, map.md and types.json agree' + (images && v.info.images && Object.keys(v.info.images).length ? ', and so do its screenshots' + (unsure ? ' (except ' + unsure + ', too big to check here)' : '') : '') + '.' : v.why);
    }
    /* A run/3 keeps its version's payload (pins included) and the pins it started with: both checked by the one canonical
       hash every reader uses (PF.publish.payloadHash), never by key order. */
    var vi = info == null ? undefined : json(info);
    if (raw.format === PF.run.FORMAT3 && raw.payload) {
      if (!vi || typeof vi !== 'object' || !vi.payload) add('payload', 'The run\'s copy of the version\'s payload matches it, pins included', null, 'The version\'s payload couldn\'t be read, so this can\'t be checked.');
      else { var sp = PF.publish.payloadHash(raw.payload) === PF.publish.payloadHash(vi.payload); add('payload', 'The run\'s copy of the version\'s payload matches it, pins included', sp, sp ? 'Compared as data.' : 'They differ.'); }
    }
    if (raw.format === PF.run.FORMAT3 && vi && vi.payload && vi.payload.pins && vi.payload.pins.children && Object.keys(vi.payload.pins.children).length) {
      var fixed = vi.payload.pins.children, mine = raw.pins && raw.pins.children && typeof raw.pins.children === 'object' ? raw.pins.children : {};
      var off = Object.keys(fixed).filter(function (k) { return !Object.prototype.hasOwnProperty.call(mine, k) || canonical(mine[k]) !== canonical(fixed[k]); });
      add('pins', 'The linked runs the version pins are the ones the run started with', !off.length, off.length ? 'Pinned differently: ' + off.join(', ') + '.' : 'Every pin the version sets is the run\'s.');
    }
    return out;
  }

  /* ---------- generated files ---------- */
  function nameOf(col, id) { if (!id) return ''; var n = col.people && col.people[id]; return n ? n + ' (' + id + ')' : id; }
  /* A time from a file, in UTC, or "time unknown" (as U.when says it) for anything that isn't a time: never a made-up one. */
  function when(iso) {
    var t = typeof iso === 'string' && iso ? Date.parse(iso) : NaN;
    return isNaN(t) ? 'time unknown' : new Date(t).toISOString().replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC');
  }
  /* rand: a few random characters, so two packs made in the same second never share a name. */
  function packName(col, at, rand) {
    var stamp = new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), sc = col.scope;
    var what = sc.run ? sc.run.replace('/', '-') : sc.process + '-' + sc.from + '-to-' + sc.through;
    return 'evidence-' + what.replace(/[^\w.-]+/g, '-') + '-' + stamp + (rand ? '-' + String(rand).replace(/[^a-z0-9]/gi, '').slice(0, 12) : '') + (col.options && col.options.format === 'report' ? '.html' : '.zip');
  }
  function title(col) {
    if (col.scope.run) { var r = col.runs[0]; return (r && r.title) || col.scope.run; }
    return col.scope.process + ', runs started ' + col.scope.from + ' through ' + col.scope.through;
  }
  /* Problems a reader must see before anything else: what changed while packing, checks that failed, limited readings. */
  function alerts(col) {
    var bad = [], warn = [];
    (col.unresolved || []).forEach(function (u) { bad.push(u); });
    col.runs.forEach(function (r) {
      (r.checks || []).forEach(function (c) { if (c.ok === false) bad.push(r.key + ': ' + c.what + '? No. ' + c.detail); });
      if (r.limited) warn.push(r.key + ': ' + r.limited + ' ' + LIMITED);
    });
    if (col.window && (col.window.unsaved || col.window.pending)) warn.push('This window had a change that wasn\'t in the team folder yet. The pack holds only what\'s saved in the folder.');
    return { bad: bad, warn: warn };
  }
  var STYLE = ':root{color-scheme:light dark;--bg:#fbfaf7;--ink:#1d2328;--soft:#5b6670;--line:#d9dde1;--card:#fff;--bad:#a4161a;--badbg:#fdecec;--warn:#7a4a00;--warnbg:#fff4dc;--ok:#1f6f3f}' +
    '@media (prefers-color-scheme:dark){:root{--bg:#14181c;--ink:#e8ecef;--soft:#9aa6b1;--line:#2f3840;--card:#1b2127;--bad:#ff8a8a;--badbg:#3a1416;--warn:#ffd28a;--warnbg:#33270f;--ok:#7ad69c}}' +
    'body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1000px;margin:0 auto;padding:16px}' +
    'h1{font-size:24px;margin:8px 0}h2{font-size:19px;margin:28px 0 8px;border-top:1px solid var(--line);padding-top:16px}h3{font-size:16px;margin:18px 0 6px}' +
    '.eyebrow,.soft{color:var(--soft);font-size:13px}.bad,.warn,.report{border-radius:8px;padding:10px 12px;margin:8px 0}.bad{background:var(--badbg);color:var(--bad);border:1px solid var(--bad)}' +
    '.warn,.report{background:var(--warnbg);color:var(--warn);border:1px solid var(--warn)}table{border-collapse:collapse;width:100%;margin:6px 0;font-size:14px}' +
    'th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:5px 6px;overflow-wrap:anywhere}th{color:var(--soft);font-weight:600;overflow-wrap:normal;word-break:normal;hyphens:none}' +
    '.mono,code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;overflow-wrap:anywhere}.no{color:var(--bad);font-weight:600}.yes{color:var(--ok);font-weight:600}' +
    '.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px}' +
    'ul{padding-left:20px}details{margin:6px 0}summary{cursor:pointer}@media (max-width:600px){main{padding:12px}table{font-size:13px}}';

  function stepRows(col, rc) {
    var run = rc.run, map = rc.map;
    if (!run || !map) return '';
    var h = '<h3>Steps</h3>';
    map.phases.forEach(function (p, pi) {
      var g = R.gateStatus(run, map, pi), gate = run.gates[p.gate.id], cond = !!p.when || p.steps.some(function (s) { return !!s.when; });
      h += '<div class="card"><b>' + esc(p.title) + '</b> <span class="soft">· gate ' + esc(p.gate.implicit ? 'confirm' : p.gate.title) + ': ' + esc(g === 'skipped' ? 'not needed (' + R.applies(run, map, pi).why + ')' : g) + (gate && gate.by ? ' by ' + esc(nameOf(col, gate.by)) + ' at ' + esc(when(gate.at)) : '') + (gate && gate.reason ? ' · ' + esc(gate.reason) : '') + '</span><table><tr><th>Step</th><th>Answer</th><th>Who and when</th></tr>';
      p.steps.forEach(function (s) {
        var a = run.steps[s.id], ap = cond ? R.applies(run, map, pi, s) : null, st = a && a.s !== 'open' ? a.s : ap && ap.applies === false ? 'Not needed: ' + ap.why : 'not checked', ev = [];
        /* Conditions (2.1): an answer kept from before the step stopped applying is still shown, after why it isn't needed. */
        if (a && a.s !== 'open' && ap && ap.applies === false) st = 'Not needed: ' + ap.why + '. Earlier answer: ' + a.s;
        if (a && a.values) R.evidenceFor(run, s).list.forEach(function (d) { if (a.values[d.name]) ev.push(d.label + ': ' + R.shown(run, map, 'steps.' + s.id + '.values.' + d.name, a.values[d.name])); });
        var marks = run.marks && run.marks[s.id] ? run.marks[s.id] : [];
        h += '<tr><td>' + esc(s.text) + ' <span class="soft mono">' + esc(s.id) + '</span></td><td>' + esc(st) + (a && a.reason ? ': ' + esc(a.reason) : '') + (a && a.differently ? '<br>Done differently: ' + esc(a.differently.note) : '') +
          (ev.length ? '<br>' + ev.map(esc).join('<br>') : '') + (a && a.history && a.history.length ? '<br><span class="soft">' + a.history.length + ' earlier answer' + (a.history.length === 1 ? '' : 's') + ' kept</span>' : '') + (marks.length ? '<br><span class="soft">Ever: ' + esc(marks.join(', ')) + '</span>' : '') +
          '</td><td>' + (a && a.by ? esc(nameOf(col, a.by)) + '<br><span class="soft">' + esc(when(a.at)) + '</span>' : '') + '</td></tr>';
      });
      h += '</table></div>';
    });
    if (run.log && run.log.length) h += '<details><summary>Log (' + run.log.length + ' entries in run.json)</summary><table>' + run.log.map(function (l) { return '<tr><td class="mono">' + esc(when(l.at)) + '</td><td>' + esc(nameOf(col, l.by)) + '</td><td>' + esc(l.what) + '</td></tr>'; }).join('') + '</table></details>';
    return h;
  }
  function notesHtml(col, rc) {
    var h = '<h3>Notes, by file and line</h3>';
    if (!rc.notes.length) return h + '<p class="soft">No notes files.</p>';
    rc.notes.forEach(function (nf) {
      h += '<div class="card"><b class="mono">' + esc(nf.file) + '</b>' + (nf.malformed.length ? ' <span class="no">' + nf.malformed.length + ' line' + (nf.malformed.length === 1 ? '' : 's') + ' couldn\'t be read: line ' + nf.malformed.join(', line ') + '.</span>' : '') +
        '<span class="soft"> · ' + nf.lines + ' line' + (nf.lines === 1 ? '' : 's') + '</span><table><tr><th>Line</th><th>Note</th><th>Who and when</th></tr>';
      nf.notes.forEach(function (x) {
        var n = x.note, files = Array.isArray(n.files) ? n.files.filter(function (f) { return typeof f === 'string'; }) : [];
        h += '<tr><td class="mono">' + x.line + '</td><td>' + (n.kind && typeof n.kind === 'string' ? '<span class="soft">' + esc(n.kind) + '</span> ' : '') + (typeof n.step === 'string' && n.step ? '<span class="soft mono">' + esc(n.step) + '</span> ' : '') + esc(n.text) +
          (files.length ? '<br><span class="soft">Files: ' + files.map(function (f) { return esc(f.split('/').pop()); }).join(', ') + '</span>' : '') + ' <span class="soft mono">id ' + esc(n.id) + '</span></td><td>' + esc(nameOf(col, typeof n.by === 'string' ? n.by : '')) + '<br><span class="soft">' + esc(when(typeof n.at === 'string' ? n.at : '')) + '</span></td></tr>';
      });
      h += '</table></div>';
    });
    return h;
  }
  function correctionsHtml(col, rc) {
    if (!rc.corrections || !rc.corrections.length) return '';
    var h = '<h3>Corrections</h3><table><tr><th>Step</th><th>Proposed</th><th>Where it stands</th></tr>';
    rc.corrections.forEach(function (c) {
      var cl = (rc.claims || []).filter(function (x) { return x.correction === c.id; })[0];
      h += '<tr><td>' + esc(c.stepText || c.step) + '</td><td>' + esc(c.proposed || '') + (c.why ? '<br><span class="soft">Why: ' + esc(c.why) + '</span>' : '') + '<br><span class="soft">' + esc(nameOf(col, c.by)) + ' · ' + esc(when(c.at)) + '</span></td><td>' +
        (cl ? '<b>' + esc(cl.text) + '</b>' + (cl.verified ? ' <span class="yes">proof in this pack</span><br><span class="soft">' + cl.proof.map(function (p) { return '<span class="mono">originals/' + esc(p) + '</span>'; }).join('<br>') + '</span>' : '<br><span class="no">' + esc(cl.status) + '</span>') : esc(c.status || 'Open')) + '</td></tr>';
    });
    return h + '</table>';
  }
  function followUpsHtml(col, rc) {
    if (!rc.run || !(rc.run.followUps || []).length) return '';
    var list = F.list([rc.run], rc.fuDecisions || []);
    return '<h3>Follow-ups</h3><table><tr><th>Follow-up</th><th>What became of it</th></tr>' + list.map(function (x) {
      var d = x.decision;
      return '<tr><td>' + esc(x.text) + (x.f.ticket ? ' <span class="mono">' + esc(x.f.ticket) + '</span>' : '') + (x.owner ? '<br><span class="soft">' + esc(nameOf(col, x.owner)) + '</span>' : '') + '</td><td>' + esc(x.label) + (d && !x.tie && x.status !== 'open' ? ': ' + esc(F.detail(x)) : '') + (d ? '<br><span class="soft">' + esc(nameOf(col, d.by)) + ' · ' + esc(when(d.at)) + ' · <span class="mono">' + esc(d._file || '') + '</span></span>' : '') + '</td></tr>';
    }).join('') + '</table>';
  }
  function filesHtml(col, rc, opts) {
    var mine = col.files.filter(function (f) { return f.runs.indexOf(rc.key) >= 0; }), h = '<h3>Files (' + mine.length + ')</h3><table><tr><th>File</th><th>What it is</th><th>Size</th><th>SHA-256</th></tr>';
    mine.forEach(function (f) {
      h += '<tr><td class="mono">' + esc(f.path) + (f.pack !== 'originals/' + f.path ? '<br><span class="soft">in the pack as ' + esc(f.pack) + '</span>' : '') + '</td><td>' + esc(f.label) + (f.flag ? '<br><span class="no">' + esc(f.flag) + '</span>' : '') + '</td><td>' + esc(size(f.size)) + '</td><td class="mono">' + esc(f.sha256) + '</td></tr>';
    });
    h += '</table>';
    /* Each picture is put in the page once, under the first run that has it; later runs point to it, so a screenshot shared by
       many runs costs its size once, as the estimate counts it. */
    var shown = opts.shown || (opts.shown = {}), pics = opts.images === false ? [] : mine.filter(function (f) { return f.image && f.bytes; });
    if (pics.length) h += '<h3>Pictures</h3>' + pics.map(function (f) {
      if (shown[f.path]) return '<p class="soft">' + esc(f.path) + ': <a href="#' + shown[f.path] + '">shown above</a></p>';
      shown[f.path] = 'pic-' + (Object.keys(shown).length + 1);
      return '<figure class="card" id="' + shown[f.path] + '"><img alt="' + esc(f.path) + '" src="data:' + f.image + ';base64,' + base64(join(f.bytes)) + '"><figcaption class="soft mono">' + esc(f.path) + '</figcaption></figure>';
    }).join('');
    return h;
  }
  function runHtml(col, rc, opts) {
    var r = rc.run, raw = rc.raw || {}, h = '<h2>Run: ' + esc(rc.title || rc.key) + '</h2>';
    h += (rc.test ? '<p><b>Test run</b> on a staged version. It isn\'t a run of a published version.</p>' : '') + '<p class="soft">' + esc(rc.key) + (raw.version != null ? (rc.test ? ' · staged version ' : ' · version ') + esc(raw.version) : '') + (raw.folder ? ' · <span class="mono">' + esc(raw.folder) + '</span>' : '') + ' · started ' + esc(when(raw.created)) +
      (r && r.ended ? ' · ended ' + esc(r.ended.outcome) + ' at ' + esc(when(r.ended.at)) : r ? ' · ' + esc(r.state) : '') + (raw.rev != null ? ' · revision ' + esc(raw.rev) : '') + '</p>';
    if (rc.limited) h += '<p class="warn">' + esc(rc.limited) + ' ' + esc(LIMITED) + '</p>';
    if (r) {
      var det = Object.keys(r.details || {}).filter(function (k) { return r.details[k]; }), roles = Object.keys(r.roles || {}).filter(function (k) { return r.roles[k]; });
      var tm = r.format === R.FORMAT3 ? R.mapOf(r) : null;
      if (det.length) h += '<p>' + det.map(function (k) { return esc(k) + ': <b>' + esc(tm ? R.shown(r, tm, 'details.' + k, r.details[k]) : r.details[k]) + '</b>'; }).join(' · ') + '</p>';
      h += '<p class="soft">Recorder: ' + esc(nameOf(col, r.recorder && r.recorder.person)) + (roles.length ? ' · ' + roles.map(function (k) { return esc(k) + ': ' + esc(nameOf(col, r.roles[k])); }).join(' · ') : '') + '</p>';
    }
    h += '<h3>Checks against the version it ran</h3><table>' + (rc.checks || []).map(function (c) { return '<tr><td>' + esc(c.what) + '</td><td class="' + (c.ok === true ? 'yes' : c.ok === false ? 'no' : 'soft') + '">' + (c.ok === true ? 'Yes' : c.ok === false ? 'No' : 'Can\'t tell') + '</td><td>' + esc(c.detail) + '</td></tr>'; }).join('') + '</table>';
    return h + stepRows(col, rc) + notesHtml(col, rc) + correctionsHtml(col, rc) + followUpsHtml(col, rc) + filesHtml(col, rc, opts);
  }
  /* The page. opts.report: the one-file readable report, which says plainly it isn't the pack and what it leaves out. */
  function page(col, opts) {
    opts = Object.assign({}, opts || {}, { shown: {} });
    var a = alerts(col), t = title(col), sc = col.scope;
    var h = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + CSP + '"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">' +
      '<title>Evidence: ' + esc(t) + '</title><style>' + STYLE + '</style></head><body><main>';
    if (opts.report) h += '<p class="report"><b>A readable report, not the evidence pack.</b> It leaves out the original files, the hashes of attachments that weren\'t read, and what conflict copies and other copies say. Export the evidence pack for the originals and their hashes.</p>';
    h += '<p class="eyebrow">Flightdeck evidence' + (col.app ? ' · made with Flightdeck ' + esc(col.app) : '') + ' · ' + esc(col.status === 'partial' ? 'Partial' : 'Complete') + '</p><h1>' + esc(t) + '</h1>';
    a.bad.forEach(function (x) { h += '<p class="bad">' + esc(x) + '</p>'; });
    a.warn.forEach(function (x) { h += '<p class="warn">' + esc(x) + '</p>'; });
    h += '<h2>About this pack</h2><table>' +
      '<tr><th>What</th><td>' + esc(sc.run ? 'One run: ' + sc.run : 'Runs of ' + sc.process + ' started ' + sc.from + ' through ' + sc.through + ', both days included, in ' + sc.tz) + '</td></tr>' +
      '<tr><th>Collected</th><td>From ' + esc(when(col.startedAt)) + ' to ' + esc(when(col.endedAt)) + (col.attempts > 1 ? ' (read ' + col.attempts + ' times, because files changed while they were read)' : '') + '</td></tr>' +
      '<tr><th>Time zone</th><td>' + esc(col.tz) + '</td></tr>' +
      '<tr><th>Runs</th><td>' + col.runs.length + '</td></tr><tr><th>Original files</th><td>' + col.files.length + ' (' + esc(size(col.files.reduce(function (s, f) { return s + f.size; }, 0))) + ')' + (col.options && col.options.attachments === false ? ' · attachments left out' : '') + '</td></tr>' +
      '<tr><th>Privacy</th><td>' + esc(PRIVACY) + '</td></tr></table>';
    col.runs.forEach(function (rc) { h += runHtml(col, rc, opts); });
    h += '<h2>Left out</h2>';
    h += col.exclusions.length ? '<table><tr><th>File</th><th>Why</th><th>Size</th></tr>' + col.exclusions.map(function (x) { return '<tr><td class="mono">' + esc(x.path) + '</td><td>' + esc(x.reason) + '</td><td>' + (x.size != null ? esc(size(x.size)) : '') + '</td></tr>'; }).join('') + '</table>' : '<p class="soft">Nothing.</p>';
    h += '<h2>Checking this pack</h2><p>' + esc(VERIFY) + '</p><p class="soft">manifest.json lists the SHA-256 of every original and of this page and README.txt. SHA256SUMS lists all of those and manifest.json. The pack\'s own SHA-256 was shown when it was made, outside the pack.</p>';
    return h + '</main></body></html>\n';
  }
  function readme(col) {
    return ['Flightdeck evidence pack', '========================', '', title(col), '', 'Made ' + when(col.endedAt) + (col.app ? ' with Flightdeck ' + col.app : '') + '. Status: ' + (col.status === 'partial' ? 'partial (see manifest.json "unresolved")' : 'complete') + '.', '',
      'What is in it', '-------------', '  evidence.html   a page to read in any browser; it runs no script and loads nothing', '  originals/      the files from the team folder, byte for byte, at their paths there', '  manifest.json   what was collected and when, what was left out and why, and the SHA-256 of', '                  every file in originals/, evidence.html and this README', '  SHA256SUMS      the SHA-256 of all of those and of manifest.json', '',
      'How to check it', '---------------', VERIFY, '', '  macOS:    shasum -a 256 -c SHA256SUMS', '  Linux:    sha256sum -c SHA256SUMS', '  Windows:  Get-FileHash -Algorithm SHA256 <file>   (compare with the line in SHA256SUMS)', '',
      'Privacy', '-------', PRIVACY, '', 'Never put a pack in the team folder.', ''].join('\n');
  }
  /* The generated files, in pack order, with the manifest and SHA256SUMS last. Returns { files: [{path, bytes}], manifest }. */
  function generate(col, opts) {
    opts = opts || {};
    var html = S.utf8(page(col, opts)), rd = S.utf8(readme(col));
    var gen = [{ path: 'evidence.html', bytes: html }, { path: 'README.txt', bytes: rd }].map(function (g) { return { path: g.path, bytes: g.bytes, size: g.bytes.length, sha256: S.hex(g.bytes) }; });
    var man = {
      format: FORMAT, app: col.app || '', madeWith: col.madeWith || '', status: col.status, createdAt: col.endedAt, scope: col.scope, tz: col.tz,
      collection: { startedAt: col.startedAt, endedAt: col.endedAt, attempts: col.attempts }, unresolved: col.unresolved, window: col.window || null,
      runs: col.runs.map(function (r) { return { key: r.key, title: r.title || '', runJson: r.source.runJson, listing: r.source.listing, checks: r.checks, claims: (r.claims || []).map(function (c) { return { correction: c.correction, group: c.group, text: c.text, verified: c.verified, status: c.status, proof: c.proof }; }), malformed: r.notes.filter(function (n) { return n.malformed.length; }).map(function (n) { return { file: n.file, lines: n.malformed }; }), limited: r.limited || '' }; }),
      files: col.files.map(function (f) { var o = { pack: f.pack, path: f.path, size: f.size, sha256: f.sha256, role: f.role, label: f.label }; if (f.flag) o.flag = f.flag; return o; }),
      generated: gen.map(function (g) { return { path: g.path, size: g.size, sha256: g.sha256 }; }),
      exclusions: col.exclusions, options: col.options, privacy: PRIVACY, integrity: VERIFY
    };
    var mb = S.utf8(JSON.stringify(man, null, 2) + '\n'), mh = S.hex(mb);
    var sums = col.files.map(function (f) { return { path: f.pack, sha256: f.sha256 }; }).concat(gen, [{ path: 'manifest.json', sha256: mh }])
      .sort(function (a, b) { return a.path < b.path ? -1 : 1; }).map(function (x) { return x.sha256 + '  ' + x.path; }).join('\n') + '\n';
    return { files: gen.concat([{ path: 'manifest.json', bytes: mb, size: mb.length, sha256: mh }, { path: 'SHA256SUMS', bytes: S.utf8(sums) }]), manifest: man };
  }
  /* An upper bound for the generated files, for the estimate made before anything is read: pictures as base64, every record
     escaped at its worst, and room for the tables. */
  function generatedUpper(files) {
    var pics = 0, recs = 0, n = files.length;
    files.forEach(function (f) { if (/\.(png|jpe?g|gif|webp)$/i.test(f.path)) pics += f.size; else if (f.role !== 'attachment' || /\.(jsonl?|md)$/i.test(f.path)) recs += f.size; });
    var html = Math.ceil(pics * 4 / 3) + recs * 6 + n * 1200 + 256 * 1024;
    return [{ name: 'evidence.html', size: html }, { name: 'README.txt', size: 8192 }, { name: 'manifest.json', size: n * 1500 + 64 * 1024 }, { name: 'SHA256SUMS', size: (n + 4) * 600 }];
  }
  function estimate(files, cap) { return Z.plan(files.map(function (f) { return { name: f.pack, size: f.size }; }).concat(generatedUpper(files)), { cap: cap }); }

  return { stepRows: stepRows, FORMAT: FORMAT, CSP: CSP, PRIVACY: PRIVACY, VERIFY: VERIFY, LIMITED: LIMITED, CAPS: CAPS, capFor: capFor, size: size, dayRange: dayRange, inRange: inRange, zoneOk: zoneOk,
    join: join, text: text, base64: base64, imageType: imageType, canonical: canonical, localDay: localDay, candidateTag: candidateTag, classify: classify, notesFile: notesFile, checks: checks,
    page: page, readme: readme, generate: generate, generatedUpper: generatedUpper, estimate: estimate, packName: packName, title: title };
})();
