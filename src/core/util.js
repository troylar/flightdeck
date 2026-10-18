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

  function hm(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function day(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  /* When a planned run is, in plain words: "Tue, Oct 24, 9:00 AM · in 3 days", "… · starts now", "… · was due yesterday". */
  function dueWords(iso, now) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
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

  return { esc: esc, timeOnDayIn: timeOnDayIn, safeUrl: safeUrl, mdInline: mdInline, mdBlock: mdBlock, slug: slug, randomId: randomId, hash: hash,
    hm: hm, when: when, day: day, dueWords: dueWords, localDateTime: localDateTime, clock: clock, duration: duration, timeToday: timeToday };
})();
