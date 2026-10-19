/* The connection check: one window writes a small "check" file into connection/, another computer's Flightdeck answers it
   with a file of its own, and the first window measures how long each leg took. It proves files travel both ways through the
   shared folder right now; it never proves more than that, so the wording never claims it. Pure: names, records, what's
   waiting for an answer, and the results in words. Files: docs/design.md section 21. */
PF.connection = (function () {
  'use strict';
  var U = PF.util;
  var DIR = 'connection', CV = 1, FRESH_MS = 15 * 60000, KEEP_MS = 7 * 86400000, WAIT_MS = 3 * 60000, EVERY_MS = 5000, SLACK_MS = 2000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* 2026-10-18T09:51:10Z as 20261018T095110Z: sortable, and safe in a file name on every system. */
  function stamp(ms) { var d = new Date(ms); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'; }
  function unstamp(s) { var m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; }
  function probeName(atMs, id, writer) { return 'probe-' + stamp(atMs) + '-' + id + '.' + writer + '.json'; }
  function ackName(probeId, writer) { return 'ack-' + probeId + '.' + writer + '.json'; }
  function parseName(n) {
    var m = /^probe-(\d{8}T\d{6}Z)-([a-z0-9]{4,16})\.([\w-]{1,40})\.json$/.exec(String(n));
    if (m) { var t = unstamp(m[1]); return t == null ? null : { kind: 'probe', at: t, id: m[2], writer: m[3] }; }
    m = /^ack-([a-z0-9]{4,16})\.([\w-]{1,40})\.json$/.exec(String(n));
    return m ? { kind: 'ack', probe: m[1], writer: m[2] } : null;
  }
  /* Only checks from the last 15 minutes (by the time in their name) are read, so the folder can hold a week of them and a
     listing still reads only a handful. A clock up to 15 minutes ahead still counts. */
  function fresh(name, now) { var x = parseName(name); return !!x && x.kind === 'probe' && Math.abs(now - x.at) <= FRESH_MS; }
  /* Any window may delete a check or an answer older than 7 days (the documented exception to one writer per file): by
     then nobody is waiting on it. Only files named like Flightdeck's own. */
  function old(name, mtime, now) { var x = parseName(name); if (!x) return false; var t = x.kind === 'probe' ? x.at : mtime; return t != null && now - t > KEEP_MS; }

  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
  function iso(v) { return typeof v === 'string' && !isNaN(Date.parse(v)) ? v.slice(0, 40) : null; }
  function runRef(v, withSaved) {
    if (!v || typeof v !== 'object' || typeof v.key !== 'string' || !/^[a-z0-9][a-z0-9-]*\/[a-z0-9-]{1,40}$/i.test(v.key)) return null;
    var r = { key: v.key, rev: Math.max(0, parseInt(v.rev, 10) || 0) };
    if (withSaved) { r.savedAt = iso(v.savedAt); if (v.unknown === true) r.unknown = true; }
    return r;
  }
  function probe(o) { return { kind: 'connection-probe', cv: CV, id: o.id, n: o.n, by: o.by, writer: o.writer, device: o.device, at: o.at, app: o.app, run: o.run || null, seen: (o.seen || []).slice(-20) }; }
  function ack(o) { return { kind: 'connection-ack', cv: CV, probe: o.probe, probeFile: o.probeFile, by: o.by, writer: o.writer, device: o.device, at: o.at, firstSeenAt: o.firstSeenAt, app: o.app, run: o.run || null, folderReadAt: o.folderReadAt || null }; }
  /* Records come from a shared folder: only the shape this copy knows, and only when they agree with their own file name.
     A record with a newer cv is left alone (null), as a newer copy's format always is. */
  function clean(o, name) {
    var x = parseName(name);
    if (!x || !o || typeof o !== 'object' || Array.isArray(o) || o.cv !== CV) return null;
    if (x.kind === 'probe') {
      if (o.kind !== 'connection-probe' || o.id !== x.id || o.writer !== x.writer || !iso(o.at)) return null;
      return { kind: 'probe', _file: name, id: x.id, n: Math.max(0, parseInt(o.n, 10) || 0), by: str(o.by, 80), writer: x.writer, device: str(o.device, 80), at: iso(o.at), app: str(o.app, 20), run: runRef(o.run), seen: Array.isArray(o.seen) ? o.seen.filter(function (s) { return typeof s === 'string' && !!parseName(s); }).slice(-20) : [] };
    }
    if (o.kind !== 'connection-ack' || o.probe !== x.probe || o.writer !== x.writer || !iso(o.at)) return null;
    return { kind: 'ack', _file: name, probe: x.probe, probeFile: str(o.probeFile, 120), by: str(o.by, 80), writer: x.writer, device: str(o.device, 80), at: iso(o.at), firstSeenAt: iso(o.firstSeenAt), app: str(o.app, 20), run: runRef(o.run, true), folderReadAt: iso(o.folderReadAt) };
  }

  /* "Windows · Edge", with the name a person gave this browser in front when there is one. */
  function device(ua, name) {
    ua = String(ua || '');
    var os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
    var br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    var nm = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    return [nm, os, br].filter(Boolean).join(' · ') || 'A computer';
  }

  /* Checks from other windows that this window hasn't answered, newest first. */
  function pending(list, writer, dismissed) {
    var probes = (list && list.probes) || [], acks = (list && list.acks) || [];
    return probes.filter(function (p) { return p.writer !== writer && !(dismissed && dismissed[p._file]) && !acks.some(function (a) { return a.probe === p.id && a.writer === writer; }); })
      .sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  }

  /* What came back for each check this window sent. sent: [{ file, id, n, at (this computer's ms), run }]; seen: when this
     window first listed each answer file (this computer's ms). Times written by the other computer are on its own clock, so
     a gap between the two clocks is measured only as far as the facts allow: an answer that says it saw the check before it
     was sent, or wrote its answer after it arrived here, proves the clocks differ by at least that much. */
  function results(sent, list, seen, now) {
    var acks = (list && list.acks) || [];
    return (sent || []).slice().sort(function (a, b) { return b.at - a.at; }).map(function (s) {
      var answers = acks.filter(function (a) { return a.probe === s.id; }).map(function (a) {
        var here = seen && seen[a._file] != null ? seen[a._file] : null, theirSeen = Date.parse(a.firstSeenAt || a.at), theirAt = Date.parse(a.at);
        var behind = s.at - theirSeen, ahead = here != null ? theirAt - here : 0, skew = null;
        if (behind > SLACK_MS) skew = { dir: 'behind', ms: behind }; else if (ahead > SLACK_MS) skew = { dir: 'ahead', ms: ahead };
        var run = null;
        if (s.run) run = !a.run || a.run.key !== s.run.key ? { state: 'missing', key: s.run.key, mine: s.run.rev } : a.run.unknown ? { state: 'unknown', key: s.run.key, mine: s.run.rev } : { state: a.run.rev === s.run.rev ? 'same' : a.run.rev < s.run.rev ? 'behind' : 'ahead', key: s.run.key, mine: s.run.rev, theirs: a.run.rev };
        return { ack: a, theirSeen: theirSeen, oneWay: skew ? null : Math.max(0, theirSeen - s.at), roundTrip: here != null ? Math.max(0, here - s.at) : null, skew: skew, run: run };
      });
      var wait = now - s.at;
      return { file: s.file, id: s.id, n: s.n, at: s.at, answers: answers, waiting: wait, hint: !answers.length && wait >= WAIT_MS };
    });
  }

  /* Whether the computer that sent a check has seen this window's answer: its later checks list the answers it saw. */
  function confirmed(list, ackFile) { return ((list && list.probes) || []).some(function (p) { return p.seen.indexOf(ackFile) >= 0; }); }

  function dur(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60); s = s % 60;
    if (m < 60) return m + ' min' + (s ? ' ' + s + ' s' : '');
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function hms(ms) { if (ms == null || ms === '') return 'time unknown'; var d = new Date(ms); return isNaN(d) ? 'time unknown' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }

  /* One answer in plain words. who: the person's name; title(key): a run's name. Never claims more than the files show. */
  function sentences(row, ans, who, title) {
    var a = ans.ack, out = [];
    var lead = who + ' · ' + (a.device || 'a computer') + ' saw check ' + row.n + ' at ' + hms(ans.theirSeen) + ' on their clock';
    out.push(lead + (ans.oneWay != null ? ', ' + dur(ans.oneWay) + ' after you sent it.' : '.'));
    out.push(ans.roundTrip != null ? 'Their answer reached this computer ' + dur(ans.roundTrip) + ' after you sent the check.' : 'Their answer is here.');
    if (ans.run) {
      var name = '"' + title(ans.run.key) + '"';
      out.push(ans.run.state === 'missing' ? 'They don\'t have ' + name + ' yet. Yours is at revision ' + ans.run.mine + '.'
        : ans.run.state === 'unknown' ? 'Their Flightdeck couldn\'t read ' + name + ' just now, so which revision they have is unknown. Yours is at revision ' + ans.run.mine + '.'
        : ans.run.state === 'same' ? 'They have ' + name + ' at revision ' + ans.run.theirs + ', the same as you.'
        : ans.run.state === 'behind' ? 'They have ' + name + ' at revision ' + ans.run.theirs + '; you have ' + ans.run.mine + '. Their copy is behind.'
        : 'They have ' + name + ' at revision ' + ans.run.theirs + ', newer than your ' + ans.run.mine + '. Yours is behind.');
    }
    if (a.folderReadAt) out.push('Their Flightdeck last read the folder at ' + hms(Date.parse(a.folderReadAt)) + ' on their clock.');
    if (ans.skew) out.push('Their clock looks at least ' + dur(ans.skew.ms) + ' ' + ans.skew.dir + ' yours, so times from their computer don\'t line up with this one.');
    return out;
  }
  var HINTS = [
    'Is Flightdeck open on the other computer, with this same team folder? Opening Connection check there answers by itself.',
    'Is OneDrive running there, and not paused? Look at its menu on both computers.',
    'Is the team folder set to Always keep on this device on both computers?',
    'Is the other computer signed in to the OneDrive that has this shared folder?'
  ];

  return { DIR: DIR, CV: CV, FRESH_MS: FRESH_MS, KEEP_MS: KEEP_MS, WAIT_MS: WAIT_MS, EVERY_MS: EVERY_MS, HINTS: HINTS, stamp: stamp, probeName: probeName, ackName: ackName, parseName: parseName, fresh: fresh, old: old,
    probe: probe, ack: ack, clean: clean, device: device, pending: pending, results: results, confirmed: confirmed, sentences: sentences, dur: dur, hms: hms, randomId: function () { return U.randomId(8); } };
})();
