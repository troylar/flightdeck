/* Shared helpers: escaping, safe Markdown, time and IDs. No DOM. */
PF.util = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* The only links Flightdeck ever renders, whether typed by a person or read from a file: http, https and mailto. Anything else becomes ''. */
  function safeUrl(u) {
    return typeof u === 'string' && /^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(u) ? u : '';
  }

  /* Markdown subset, escape-first: raw HTML in maps and notes is shown as text, never run. */
  function mdInline(s) {
    var codes = [];
    var t = esc(s).replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
        var ok = safeUrl(url.replace(/&amp;/g, '&'));
        return ok ? '<a href="' + esc(ok) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label;
      });
    return t.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
  }

  function mdBlock(s) {
    var out = [], list = null, para = [];
    function flushP() { if (para.length) { out.push('<p>' + mdInline(para.join(' ')) + '</p>'); para = []; } }
    function flushL() { if (list) { out.push('<ul>' + list.map(function (x) { return '<li>' + mdInline(x) + '</li>'; }).join('') + '</ul>'); list = null; } }
    String(s || '').split('\n').forEach(function (line) {
      var m = /^\s*[-*]\s+(.*)$/.exec(line);
      if (m) { flushP(); (list = list || []).push(m[1]); }
      else if (!line.trim()) { flushP(); flushL(); }
      else { flushL(); para.push(line.trim()); }
    });
    flushP(); flushL();
    return out.join('');
  }

  function slug(s, max) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max || 40) || 'x';
  }

  function randomId(n) {
    var a = 'abcdefghijkmnpqrstuvwxyz23456789', s = '';
    for (var i = 0; i < (n || 8); i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  /* FNV-1a, 32-bit, as 8 hex characters. Identifies content; not for security. */
  function hash(str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  /* A time to show, or null: null, '' and anything that isn't a time are never formatted (new Date(null) is 1970, which
     would print a made-up time). The formatters say "time unknown" instead. */
  var UNKNOWN = 'time unknown';
  function dateOf(v) {
    if (!(typeof v === 'string' && v) && typeof v !== 'number' && !(v instanceof Date)) return null;
    var d = new Date(v); return isNaN(d) ? null : d;
  }
  function hm(iso) {
    var d = dateOf(iso);
    return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : UNKNOWN;
  }
  function when(iso) {
    var d = dateOf(iso);
    return d ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : UNKNOWN;
  }
  function day(iso) {
    var d = dateOf(iso);
    return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : UNKNOWN;
  }
  /* When a planned run is, in plain words: "Tue, Oct 24, 9:00 AM · in 3 days", "… · starts now", "… · was due yesterday". */
  function dueWords(iso, now) {
    var d = dateOf(iso);
    if (!d) return '';
    var at = d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    var ms = d.getTime() - now, min = Math.round(Math.abs(ms) / 60000), h = Math.round(min / 60);
    var days = Math.round((new Date(d.getTime()).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
    var n = function (k, w) { return k + ' ' + w + (k === 1 ? '' : 's'); }, rel;
    if (min < 15) rel = 'starts now';
    else if (ms > 0) rel = min < 60 ? 'in ' + n(min, 'minute') : days === 0 || h < 6 ? 'in ' + n(h, 'hour') : days === 1 ? 'tomorrow' : 'in ' + n(days, 'day');
    else rel = 'was due ' + (min < 60 ? n(min, 'minute') + ' ago' : days === 0 || h < 6 ? n(h, 'hour') + ' ago' : days === -1 ? 'yesterday' : n(-days, 'day') + ' ago');
    return at + ' · ' + rel;
  }
  /* A date and time typed as local time ("2026-11-06T09:00", as a datetime-local field gives it). A time the clocks skip on
     that day (the spring change) would silently move an hour, so it's refused: { error: 'gap' }; unreadable text: { error: 'bad' }. */
  function localDateTime(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(text || '').trim());
    if (!m) return { error: 'bad' };
    var f = m.slice(1, 7).map(function (x) { return +(x || 0); }), d = new Date(f[0], f[1] - 1, f[2], f[3], f[4], f[5]);
    if (isNaN(d) || f[1] < 1 || f[1] > 12 || f[2] < 1 || f[2] > 31 || f[3] > 23 || f[4] > 59 || f[5] > 59) return { error: 'bad' };
    if (d.getFullYear() !== f[0] || d.getMonth() !== f[1] - 1 || d.getDate() !== f[2]) return { error: 'bad' };
    if (d.getHours() !== f[3] || d.getMinutes() !== f[4]) return { error: 'gap' };
    return { date: d };
  }
  /* "12:04" or "1:02:09" for elapsed or remaining milliseconds. */
  function clock(ms) {
    var neg = ms < 0, s = Math.floor(Math.abs(ms) / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    var txt = (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    return (neg ? '-' : '') + txt;
  }
  /* "20m", "1h30m", "45s" → milliseconds, or null. */
  function duration(s) {
    var m = /^\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?\s*$/i.exec(String(s || ''));
    if (!m || !(m[1] || m[2] || m[3])) return null;
    return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
  }
  /* Today's (or a given day's) local time "21:30" or "9:30 PM" → ISO string, or null. */
  function timeToday(text, base) {
    var m = /^\s*(\d{1,2}):(\d{2})\s*(am|pm)?\s*$/i.exec(String(text || ''));
    if (!m) return null;
    var h = +m[1], min = +m[2], ap = (m[3] || '').toLowerCase();
    if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    var d = base ? new Date(base) : new Date();
    d.setHours(h, min, 0, 0);
    return d.toISOString();
  }

  /* A clock time on the day an ISO instant falls in, both read in an IANA time zone (the run's), as an ISO instant.
     Everyone then sees the same moment, shown in their own time. Without a usable zone, the viewer's own is used. */
  function timeOnDayIn(text, baseIso, tz) {
    var local = timeToday(text, baseIso);
    if (!local || !tz) return local;
    try {
      var fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      var parts = function (ms) { var o = {}; fmt.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = +p.value; }); return o; };
      var b = parts(new Date(baseIso).getTime()), m = /^\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(text), h = +m[1], min = +m[2], ap = (m[3] || '').toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      var want = Date.UTC(b.year, b.month - 1, b.day, h, min), guess = want;
      for (var i = 0; i < 2; i++) { var p = parts(guess), seen = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second); guess += want - seen; }
      return new Date(guess).toISOString();
    } catch (e) { return local; }
  }

  /* Where a cleaned record says something other than the file it came from (reading for other apps): every path whose value
     in raw isn't the same in clean. Pure. raw and clean are plain parsed JSON (clean already through a JSON round trip, so
     nothing undefined is left). An empty value in raw (absent, null or '') may stay empty or become an empty list or object;
     anything else it becomes must be listed in allow.added. A value present in raw may go missing from clean only where
     allow.dropped lists it. Patterns are dotted paths with * for any key or index ("steps.*.reason", "log[*].at"). Keys of
     clean starting with "_" are bookkeeping, never compared. */
  function drift(raw, clean, allow) {
    allow = allow || {};
    var out = [], added = (allow.added || []).map(segs), dropped = (allow.dropped || []).map(segs);
    function segs(p) { return String(p).replace(/\[(\d+|\*)\]/g, '.$1').split('.'); }
    function matches(list, path) { var s = segs(path); return list.some(function (q) { return q.length === s.length && q.every(function (x, i) { return x === '*' || x === s[i]; }); }); }
    function empty(v) { return v === undefined || v === null || v === ''; }
    function hollow(v) { return empty(v) || (Array.isArray(v) && !v.length) || (!!v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).filter(function (k) { return k[0] !== '_'; }).length); }
    function kind(v) { return Array.isArray(v) ? 'list' : v === null ? 'null' : typeof v; }
    function walk(r, c, path) {
      if (empty(r)) { if (!hollow(c) && !matches(added, path)) out.push(path); return; }
      if (c === undefined || c === null) { if (!matches(dropped, path)) out.push(path); return; }
      if (kind(r) !== kind(c)) { out.push(path); return; }
      if (Array.isArray(r)) { for (var i = 0; i < Math.max(r.length, c.length); i++) walk(r[i], c[i], path + '[' + i + ']'); return; }
      if (typeof r === 'object') {
        var keys = Object.keys(r).concat(Object.keys(c).filter(function (k) { return k[0] !== '_' && !Object.prototype.hasOwnProperty.call(r, k); }));
        keys.forEach(function (k) { walk(r[k], c[k], path ? path + '.' + k : k); });
        return;
      }
      if (r !== c) out.push(path);
    }
    walk(raw, clean, '');
    return out;
  }

  /* ---------- The draft size limit (docs/design.md section 27) ----------
     One limit for every draft read and write, in UTF-8 bytes, so Flightdeck never saves a draft it would refuse to read. */
  var DRAFT_BYTES = 1048576;
  function utf8Bytes(s) {
    var n = 0; s = String(s);
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) < 0xe000 ? (i++, 4) : 3; }
    return n;
  }
  /* Megabytes for people: up (1.01, never "1.0" for a draft just over), or to the nearest when rounding down is fine. */
  function mbUp(bytes, places) { var f = Math.pow(10, places); return String(Math.ceil(bytes / 1048576 * f) / f); }
  /* null when text fits, else { bytes, limit, why }: what a refused save says, word for word. */
  function draftTooBig(text) {
    var b = utf8Bytes(text);
    if (b <= DRAFT_BYTES) return null;
    return { bytes: b, limit: DRAFT_BYTES, why: 'Not saved: this draft is ' + mbUp(b, 1) + ' MB, and Flightdeck saves drafts up to 1 MB. Shorten it by about ' + mbUp(b - DRAFT_BYTES, 1) + ' MB (long notes or pasted logs are the usual cause), then save. Your text is still here.' };
  }
  /* The size the editor's header shows from 90% of the limit ("0.95 of 1 MB"), else ''. */
  function draftSize(text) {
    var b = utf8Bytes(text);
    return b >= 0.9 * DRAFT_BYTES ? String(Math.round(b / 1048576 * 100) / 100) + ' of 1 MB' : '';
  }

  return { DRAFT_BYTES: DRAFT_BYTES, utf8Bytes: utf8Bytes, draftTooBig: draftTooBig, draftSize: draftSize, drift: drift, esc: esc, timeOnDayIn: timeOnDayIn, safeUrl: safeUrl, mdInline: mdInline, mdBlock: mdBlock, slug: slug, randomId: randomId, hash: hash,
    hm: hm, when: when, day: day, dueWords: dueWords, localDateTime: localDateTime, clock: clock, duration: duration, timeToday: timeToday };
})();
