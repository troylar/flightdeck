/* Reports from other apps (docs/apps.md, docs/design.md section 26): a tool that did a step's work says so in a report, a file
   it writes once in reports/<process>/<run>.<step>.<tool>.<id>.json (flightdeck-report/1). A report is a claim: it never
   checks a step. The run's recorder accepts it (the step is checked with exactly the report's evidence, through the one
   answer path) or declines it with a reason; what a person decided is a file written once by their window in
   report-decisions/<process>/<run>.<hash>.<window>.<rev>.json (flightdeck-report-decision/1). run.json gains no field: an
   accepted report is an ordinary answer plus a log line naming the report's SHA-256, which every copy reads.
   Three facts stay apart: what a report says, what a person decided, and whether its inputs still match the run.
   Pure: no files. Every value from a file is checked for its type before it's tested, keys are looked up only as their own,
   and nothing unknown is kept: a report with a property this copy doesn't know can't be read. */
PF.reports = (function () {
  'use strict';
  var U = PF.util, R = PF.run, M = PF.map, E = PF.envelope;
  var FORMAT = 'flightdeck-report/1', DFORMAT = 'flightdeck-report-decision/1', DIR = 'reports', DDIR = 'report-decisions';
  var LIMITS = { bytes: 65536, decisionBytes: 16384, blockers: 20, text: 300, evidence: 40, links: 20, label: 80, url: 2000, inputs: 40, inputName: 60, summary: 500, by: 80, at: 40, reports: 20000 };
  var PROC = /^[a-z0-9][a-z0-9-]{0,59}$/, RUN = /^[a-z0-9-]{1,40}$/, STEP = /^[a-z0-9][a-z0-9-]{0,59}$/, TOOL = /^[a-z0-9][a-z0-9-]{0,29}$/, ID = /^[a-z0-9]{8,16}$/;
  var EVKEY = /^[\w-]{1,40}$/, DETAIL = /^[\w-]{1,60}$/, TOOL_VERSION = /^[\w.+-]{1,40}$/, WINDOW = /^[\w-]{1,40}$/, HEX64 = /^[0-9a-f]{64}$/, HEX8 = /^[0-9a-f]{8}$/;
  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  /* A copy OneDrive kept beside a file ("-LAPTOP", " (1)"): the canonical name, then a marker that can't continue the last
     part (never a lowercase letter, a digit or a dot), so a copy never changes a part or adds one. */
  var MARK = '(?:([^a-z0-9.\\/\\\\][^\\/\\\\]{0,99}))?';
  var FILE = new RegExp('^([a-z0-9-]{1,40})\\.([a-z0-9][a-z0-9-]{0,59})\\.([a-z0-9][a-z0-9-]{0,29})\\.([a-z0-9]{8,16})' + MARK + '\\.json$');
  var DFILE = new RegExp('^([a-z0-9-]{1,40})\\.([0-9a-f]{8})\\.([\\w-]{1,40})\\.(\\d{1,7})' + MARK + '\\.json$');
  var KEYS = ['format', 'features', 'app', 'run', 'publication', 'step', 'verdict', 'blockers', 'evidence', 'links', 'inputs', 'producer', 'created', 'id', 'supersedes', 'summary'];
  var DKEYS = ['format', 'features', 'app', 'process', 'run', 'step', 'producer', 'report', 'sha256', 'status', 'reason', 'inputs', 'answer', 'by', 'at', 'rev', 'seen'];
  var VERDICTS = ['pass', 'fail', 'blocked'], STATUS = ['accepted', 'declined', 'open'], MAX_REV = 1000000;
  var CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  var LOG = /^Accepted report ([a-z0-9][a-z0-9-]{0,29})\/([a-z0-9]{8,16}) sha256:([0-9a-f]{64}) \(says pass\) for "/;

  function own(o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
  function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function reserved(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype' || k in Object.prototype; }
  function q(k) { return '"' + String(k).slice(0, 60).replace(/[\u0000-\u001f]/g, '') + '"'; }
  function is(re, v) { return typeof v === 'string' && re.test(v); }
  function revOk(v) { return typeof v === 'number' && Math.floor(v) === v && v >= 1 && v <= MAX_REV; }
  function dict() { return Object.create(null); }

  /* ---------- bytes ---------- */
  /* UTF-8 as a strict decoder reads it (TextDecoder with fatal: true): overlong forms, surrogates, code points past U+10FFFF
     and cut sequences are refused (null). Pure, so it works where TextDecoder doesn't. */
  function utf8(u8) {
    var out = [], i = 0, n = u8.length, chunk = '';
    while (i < n) {
      var b = u8[i], cp, need, min;
      if (b < 0x80) { cp = b; need = 0; min = 0; }
      else if (b >= 0xc2 && b <= 0xdf) { cp = b & 0x1f; need = 1; min = 0x80; }
      else if (b >= 0xe0 && b <= 0xef) { cp = b & 0x0f; need = 2; min = 0x800; }
      else if (b >= 0xf0 && b <= 0xf4) { cp = b & 0x07; need = 3; min = 0x10000; }
      else return null;
      for (var k = 1; k <= need; k++) { var c = u8[i + k]; if (c === undefined || (c & 0xc0) !== 0x80) return null; cp = (cp << 6) | (c & 0x3f); }
      if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      i += need + 1;
      if (cp > 0xffff) { cp -= 0x10000; chunk += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); }
      else chunk += String.fromCharCode(cp);
      if (chunk.length >= 8192) { out.push(chunk); chunk = ''; }
    }
    out.push(chunk);
    return out.join('');
  }
  /* A file's bytes as Flightdeck reads a report: the SHA-256 of exactly these bytes (the report's identity), then strict
     UTF-8, then a byte-order mark dropped (after hashing, so the hash is of what's on disk). */
  function snapshot(u8) {
    var sha = PF.sha256.hex(u8), text = utf8(u8);
    if (text === null) return { sha256: sha, text: null, why: 'isn\'t UTF-8 text' };
    return { sha256: sha, text: text.replace(/^﻿/, ''), why: '' };
  }

  /* ---------- names ---------- */
  /* reports/<process>/<run>.<step>.<tool>.<id>.json, or a OneDrive copy of it: { run, step, producer, id, copy, canonical },
     or null. */
  function parseName(name) {
    var m = typeof name === 'string' ? FILE.exec(name) : null;
    if (!m) return null;
    return { run: m[1], step: m[2], producer: m[3], id: m[4], copy: m[5] || '', canonical: m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4] + '.json' };
  }
  function fileName(o) { return o.run + '.' + o.step + '.' + o.producer + '.' + o.id + '.json'; }
  /* The logical identity of a report, apart from the files that hold it: (process, run, step, producer, id). */
  function identity(o) { return [o.process, o.run, o.step, o.producer, o.id].join('/'); }
  function decisionHash(o) { return U.hash(identity(o)); }
  function decisionName(rec, writer) { return rec.run + '.' + decisionHash({ process: rec.process, run: rec.run, step: rec.step, producer: rec.producer, id: rec.report }) + '.' + writer + '.' + Math.floor(rec.rev) + '.json'; }
  function parseDecisionName(name) {
    var m = typeof name === 'string' ? DFILE.exec(name) : null;
    return m ? { run: m[1], hash: m[2], window: m[3], rev: +m[4], copy: m[5] || '' } : null;
  }

  /* ---------- reading a report ---------- */
  /* A report's text, its folder's process and its file name, as Flightdeck reads it: { ok: true, report } or { ok: false, kind:
     'newer' | 'malformed', why, errors: [every reason], needs }. Never throws, whatever the text holds. */
  function clean(text, process, name) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return bad(['isn\'t complete JSON (it may still be arriving)']); }
    return cleanValue(o, process, name);
  }
  function bad(errors, kind, needs) { return { ok: false, kind: kind || 'malformed', why: errors[0], errors: errors, needs: needs || '' }; }
  function cleanValue(o, process, name) {
    if (!isMap(o)) return bad(['isn\'t a report: a report is a JSON object']);
    var v = E.judge('flightdeck-report', o);
    if (!v.ok) return bad([v.why], v.kind, v.needs);
    var errors = [], out = { format: FORMAT };
    Object.keys(o).forEach(function (k) { if (KEYS.indexOf(k) < 0) errors.push('has ' + q(k) + ', which a report doesn\'t have'); });
    if (o.app != null && !(typeof o.app === 'string' && E.semver(o.app))) errors.push('has an "app" that isn\'t a version like 2.0.0');
    var nm = name == null ? null : parseName(name);
    if (name != null && !nm) errors.push('has a file name that isn\'t <run>.<step>.<tool>.<id>.json');
    /* run: "<process>/<run>", the folder's process and the name's run. */
    var rm = typeof o.run === 'string' ? /^([a-z0-9][a-z0-9-]{0,59})\/([a-z0-9-]{1,40})$/.exec(o.run) : null;
    if (!rm) errors.push('"run" is the run\'s key, <process>/<run id>, like backup-check/k3m9p2q8');
    else {
      if (process != null && rm[1] !== process) errors.push('"run" names process ' + rm[1] + ', but the file is in reports/' + String(process).slice(0, 60) + '/');
      if (nm && rm[2] !== nm.run) errors.push('"run" names run ' + rm[2] + ', but the file name says ' + nm.run);
      out.process = rm[1]; out.run = rm[2];
    }
    var pub = o.publication;
    if (!isMap(pub)) errors.push('"publication" is {"folder": "<the run\'s version folder>"}');
    else {
      Object.keys(pub).forEach(function (k) { if (k !== 'folder' && k !== 'version') errors.push('"publication" has ' + q(k) + '; it has only folder and version'); });
      if (!(typeof pub.folder === 'string' && /^v\d{1,6}-[a-z0-9]{1,40}$/.test(pub.folder))) errors.push('"publication" folder is a version folder, like v3-k3m9p2q8');
      if (pub.version != null && !(typeof pub.version === 'number' && Math.floor(pub.version) === pub.version && pub.version >= 1 && pub.version <= 999999)) errors.push('"publication" version is a version number, like 3');
      out.publication = { folder: typeof pub.folder === 'string' ? pub.folder : '' };
      if (typeof pub.version === 'number') out.publication.version = pub.version;
    }
    if (!is(STEP, o.step)) errors.push('"step" is a step ID: lowercase letters, numbers and dashes');
    else if (nm && o.step !== nm.step) errors.push('"step" is ' + o.step + ', but the file name says ' + nm.step);
    out.step = typeof o.step === 'string' ? o.step : '';
    if (VERDICTS.indexOf(o.verdict) < 0) errors.push('"verdict" is pass, fail or blocked');
    out.verdict = VERDICTS.indexOf(o.verdict) >= 0 ? o.verdict : '';
    var blockers = [];
    if (o.blockers != null) {
      if (!Array.isArray(o.blockers) || o.blockers.length > LIMITS.blockers) errors.push('"blockers" is a list of at most ' + LIMITS.blockers + ' texts');
      else o.blockers.forEach(function (b, i) { if (typeof b !== 'string' || !b.trim() || b.length > LIMITS.text || CONTROL.test(b)) errors.push('blocker ' + (i + 1) + ' is text of 1 to ' + LIMITS.text + ' characters'); else blockers.push(b); });
    }
    if (o.verdict === 'pass' && Array.isArray(o.blockers) && o.blockers.length) errors.push('says pass but lists blockers; a pass has none');
    if ((o.verdict === 'fail' || o.verdict === 'blocked') && !(Array.isArray(o.blockers) && o.blockers.length)) errors.push('says ' + o.verdict + ' without a blocker; say what\'s wrong in "blockers"');
    out.blockers = blockers;
    var ev = dict(), evn = 0;
    if (o.evidence != null) {
      if (!isMap(o.evidence)) errors.push('"evidence" is an object of evidence names and text');
      else Object.keys(o.evidence).forEach(function (k) {
        if (++evn > LIMITS.evidence) { if (evn === LIMITS.evidence + 1) errors.push('"evidence" has more than ' + LIMITS.evidence + ' names'); return; }
        if (!EVKEY.test(k) || reserved(k)) { errors.push('evidence name ' + q(k) + ' isn\'t one a step records (letters, numbers, dashes or underscores)'); return; }
        var x = o.evidence[k];
        if (typeof x !== 'string' || x.length > LIMITS.text || CONTROL.test(x)) { errors.push('evidence ' + q(k) + ' is text of at most ' + LIMITS.text + ' characters'); return; }
        ev[k] = x;
      });
    }
    out.evidence = ev;
    var links = [];
    if (o.links != null) {
      if (!Array.isArray(o.links) || o.links.length > LIMITS.links) errors.push('"links" is a list of at most ' + LIMITS.links + ' {label, url}');
      else o.links.forEach(function (l, i) {
        var at = 'link ' + (i + 1);
        if (!isMap(l)) { errors.push(at + ' is {"label": "…", "url": "https://…"}'); return; }
        Object.keys(l).forEach(function (k) { if (k !== 'label' && k !== 'url') errors.push(at + ' has ' + q(k) + '; a link has only label and url'); });
        if (typeof l.label !== 'string' || !l.label.trim() || l.label.length > LIMITS.label || CONTROL.test(l.label)) errors.push(at + '\'s label is text of 1 to ' + LIMITS.label + ' characters');
        if (!(typeof l.url === 'string' && l.url.length <= LIMITS.url && /^https?:\/\//i.test(l.url) && U.safeUrl(l.url))) errors.push(at + '\'s url is a web link that starts with https://, at most ' + LIMITS.url + ' characters');
        else if (typeof l.label === 'string') links.push({ label: l.label, url: l.url });
      });
    }
    out.links = links;
    var inputs = [];
    if (o.inputs != null) {
      if (!Array.isArray(o.inputs) || o.inputs.length > LIMITS.inputs) errors.push('"inputs" is a list of at most ' + LIMITS.inputs + ' {name, value, source}');
      else o.inputs.forEach(function (x, i) {
        var at = 'input ' + (i + 1);
        if (!isMap(x)) { errors.push(at + ' is {"name": "…", "value": "…", "source": "external"}'); return; }
        Object.keys(x).forEach(function (k) { if (['name', 'value', 'source', 'secret'].indexOf(k) < 0) errors.push(at + ' has ' + q(k) + '; an input has only name, value, source and secret'); });
        var okName = typeof x.name === 'string' && !!x.name.trim() && x.name.length <= LIMITS.inputName && !CONTROL.test(x.name);
        if (!okName) errors.push(at + '\'s name is text of 1 to ' + LIMITS.inputName + ' characters');
        var src = typeof x.source === 'string' ? x.source : null, dm = src ? /^detail:([\w-]{1,60})$/.exec(src) : null;
        if (!(src === 'external' || dm)) errors.push(at + '\'s source is "external" or "detail:<run detail>"');
        if (own(x, 'secret') && x.secret !== true) errors.push(at + '\'s secret is true or left out');
        if (x.secret === true) {
          /* A secret is named, never shown: one with a value refuses the report, and the value is never kept. */
          if (own(x, 'value')) errors.push(at + ' is a secret with a value; a report names a secret, never its value');
          else if (okName && (src === 'external' || dm)) inputs.push({ name: x.name, source: src, secret: true });
          return;
        }
        if (typeof x.value !== 'string' || x.value.length > LIMITS.text || CONTROL.test(x.value)) errors.push(at + '\'s value is text of at most ' + LIMITS.text + ' characters');
        else if (okName && (src === 'external' || dm)) inputs.push({ name: x.name, value: x.value, source: src });
      });
    }
    out.inputs = inputs;
    var p = o.producer;
    if (!isMap(p)) errors.push('"producer" is {"name": "<your tool>", "version": "<its version>"}');
    else {
      Object.keys(p).forEach(function (k) { if (k !== 'name' && k !== 'version') errors.push('"producer" has ' + q(k) + '; it has only name and version'); });
      if (!is(TOOL, p.name)) errors.push('"producer" name is lowercase letters, numbers and dashes, at most 30 characters, like ci-check');
      else if (nm && p.name !== nm.producer) errors.push('"producer" name is ' + p.name + ', but the file name says ' + nm.producer);
      if (!is(TOOL_VERSION, p.version)) errors.push('"producer" version is letters, numbers, dots, dashes, underscores or pluses, at most 40 characters, like 1.4.0');
      out.producer = { name: typeof p.name === 'string' ? p.name : '', version: typeof p.version === 'string' ? p.version : '' };
    }
    if (!(typeof o.created === 'string' && ISO.test(o.created) && !isNaN(Date.parse(o.created)))) errors.push('"created" is a date and time with its zone, like 2026-11-01T06:10:00Z');
    out.created = typeof o.created === 'string' ? o.created : '';
    if (!is(ID, o.id)) errors.push('"id" is 8 to 16 lowercase letters and numbers');
    else if (nm && o.id !== nm.id) errors.push('"id" is ' + o.id + ', but the file name says ' + nm.id);
    out.id = typeof o.id === 'string' ? o.id : '';
    if (o.supersedes != null) {
      if (!is(ID, o.supersedes)) errors.push('"supersedes" is the id of an earlier report from the same tool on the same step');
      else if (o.supersedes === o.id) errors.push('"supersedes" names the report itself');
      else out.supersedes = o.supersedes;
    }
    if (o.summary != null) {
      if (typeof o.summary !== 'string' || o.summary.length > LIMITS.summary || CONTROL.test(o.summary)) errors.push('"summary" is text of at most ' + LIMITS.summary + ' characters');
      else if (o.summary.trim()) out.summary = o.summary;
    }
    if (errors.length) return bad(errors);
    out.key = identity({ process: out.process, run: out.run, step: out.step, producer: out.producer.name, id: out.id });
    return { ok: true, report: out };
  }

  /* ---------- the files of one run: identities, copies, order ---------- */
  /* entries: [{ name, path, sha256, report (clean's) or null, why, kind }] for one process folder. Each logical identity once,
     with every physical copy and its hash. Copies with identical bytes are one report; copies that differ (or a copy that
     can't be read) can't be accepted. Names that aren't report names stay apart (badNames). */
  function group(process, entries) {
    var by = dict(), list = [], badNames = [];
    (entries || []).forEach(function (e) {
      var nm = parseName(e.name);
      if (!nm) { badNames.push(e); return; }
      var k = identity({ process: process, run: nm.run, step: nm.step, producer: nm.producer, id: nm.id });
      var g = by[k];
      if (!g) { g = by[k] = { key: k, process: process, run: nm.run, step: nm.step, producer: nm.producer, id: nm.id, copies: [], report: null, sha256: '', differ: false, unreadable: [], reason: '' }; list.push(g); }
      g.copies.push({ name: e.name, path: e.path, sha256: e.sha256 || '', ok: !!e.report, why: e.why || '', kind: e.kind || '', copy: nm.copy });
      if (!e.report) g.unreadable.push({ path: e.path, why: e.why || 'couldn\'t be read', kind: e.kind || 'malformed' });
      /* The canonical name first, then copies by name, so the report shown never depends on listing order. */
      if (e.report && (!g.report || (!nm.copy && g._copy) || (!!nm.copy === !!g._copy && e.name < g._name))) { g.report = e.report; g.sha256 = e.sha256; g._copy = nm.copy; g._name = e.name; }
    });
    list.forEach(function (g) {
      var shas = g.copies.filter(function (c) { return c.ok; }).map(function (c) { return c.sha256; }).filter(function (s, i, a) { return a.indexOf(s) === i; });
      g.differ = shas.length > 1;
      if (g.differ) g.reason = 'Two copies of this report differ (' + g.copies.map(function (c) { return c.name; }).join(', ') + '), so neither can be accepted. Delete the wrong one.';
      else if (g.unreadable.length && g.report) g.reason = 'A copy of this report can\'t be read (' + g.unreadable[0].path.split('/').pop() + '), so it can\'t be accepted until it can.';
      else if (!g.report) g.reason = 'This report can\'t be read: ' + (g.unreadable[0] ? g.unreadable[0].why : 'it isn\'t a report') + '.';
      delete g._copy; delete g._name;
    });
    return { list: order(list), badNames: badNames };
  }
  /* Deterministic, never "newest": supersession chains first (a report above the one it replaces), then by producer and id. A
     report two others replace, or reports that replace each other in a loop, are shown flat with a note. */
  function order(list) {
    var byStep = dict();
    list.forEach(function (g) { (byStep[g.run + '/' + g.step] = byStep[g.run + '/' + g.step] || []).push(g); });
    var out = [];
    Object.keys(byStep).sort().forEach(function (k) {
      var gs = byStep[k].slice().sort(function (a, b) { return a.producer < b.producer ? -1 : a.producer > b.producer ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      var at = dict(), into = dict(), note = dict(), flat = dict();
      gs.forEach(function (g) { at[g.producer + '/' + g.id] = g; });
      var sup = function (g) { return g.report && g.report.supersedes ? at[g.producer + '/' + g.report.supersedes] || null : null; };
      gs.forEach(function (g) { var t = sup(g); if (t) (into[t.key] = into[t.key] || []).push(g); });
      gs.forEach(function (g) {
        if ((into[g.key] || []).length > 1) { flat[g.key] = true; note[g.key] = 'Two reports say they replace this one.'; into[g.key].forEach(function (x) { flat[x.key] = true; }); }
        var seen = dict(), cur = g;
        while (cur && !seen[cur.key]) { seen[cur.key] = true; cur = sup(cur); }
        if (cur && cur === g) { var c = g; do { flat[c.key] = true; note[c.key] = 'These reports replace each other in a loop.'; c = sup(c); } while (c && c !== g); }
      });
      var done = dict(), add = function (g, depth, superseded) { done[g.key] = true; out.push({ g: g, depth: depth, superseded: superseded, note: note[g.key] || '' }); };
      gs.forEach(function (g) {
        if (done[g.key] || flat[g.key] || (into[g.key] || []).some(function (x) { return !flat[x.key]; })) return;
        add(g, 0, false);
        for (var t = sup(g), d = 1; t && !done[t.key] && !flat[t.key]; t = sup(t), d++) add(t, d, true);
      });
      gs.forEach(function (g) { if (!done[g.key]) add(g, 0, !!(into[g.key] || []).length); });
    });
    return out.map(function (x) { x.g.order = { depth: x.depth, superseded: x.superseded, note: x.note }; return x.g; });
  }

  /* ---------- whether its inputs still match the run ---------- */
  /* Per detail: input, against the run's details now: { result: 'match' | 'mismatch' | 'unknown', rows, untied }. A detail the
     step binds (^detail) is tied: changing it later sends the step back for a re-check in every copy. External inputs and
     secrets can't be compared. */
  function applies(rep, r, map, step) {
    var rows = [], ctxNames = map && map.meta && Array.isArray(map.meta.context) ? map.meta.context : [], binds = step && Array.isArray(step.binds) ? step.binds : [];
    (rep.inputs || []).forEach(function (x) {
      var dm = /^detail:([\w-]{1,60})$/.exec(x.source);
      if (!dm || x.secret) { rows.push({ name: x.name, source: x.source, result: 'unknown' }); return; }
      var d = dm[1], known = ctxNames.indexOf(d) >= 0, have = known && r && r.details && own(r.details, d) && typeof r.details[d] === 'string' ? r.details[d].trim() : '';
      var row = { name: x.name, source: x.source, detail: d, want: x.value, have: have, tied: binds.indexOf(d) >= 0 };
      row.result = !known ? 'mismatch' : !have ? 'mismatch' : have === String(x.value).trim() ? 'match' : 'mismatch';
      row.why = !known ? d + ' isn\'t a run detail of this checklist' : !have ? 'the run has no ' + d + ' yet' : '';
      rows.push(row);
    });
    var mis = rows.filter(function (x) { return x.result === 'mismatch'; }), hit = rows.filter(function (x) { return x.result === 'match'; });
    return { result: mis.length ? 'mismatch' : hit.length ? 'match' : 'unknown', rows: rows, untied: hit.filter(function (x) { return !x.tied; }).map(function (x) { return x.detail; }) };
  }
  /* The words for the third fact. */
  function appliesText(a) {
    if (a.result === 'mismatch') { var m = a.rows.filter(function (x) { return x.result === 'mismatch'; })[0]; return 'Doesn\'t match: ' + (m.why ? m.why : 'it examined ' + m.detail + ' ' + m.want + '; the run\'s ' + m.detail + ' is ' + m.have) + '.'; }
    if (a.result === 'unknown') return 'Flightdeck can\'t compare these inputs.';
    var hit = a.rows.filter(function (x) { return x.result === 'match'; }).map(function (x) { return x.detail + ' ' + x.want; }).join(', ');
    return a.untied.length ? 'Matches now, but this step isn\'t tied to ' + a.untied.join(', ') + ', so a later change won\'t send it back.' : 'Matches the run: ' + hit + '.';
  }

  /* ---------- what a person decided ---------- */
  /* The evidence a step records, as the fingerprint compares it: [name, kind, required]. */
  function schemaOf(r, step) { return R.evidenceFor(r, step).list.map(function (d) { return [String(d.name), String(d.kind || 'text'), !!d.required]; }); }
  /* SHA-256 of the answer's values and the step's evidence schema, as canonical JSON: a Fill in (in any copy) changes it. */
  function fingerprint(values, schema) {
    var v = dict(); Object.keys(values || {}).sort().forEach(function (k) { if (typeof values[k] === 'string') v[k] = values[k]; });
    var c = '{"schema":' + JSON.stringify(schema || []) + ',"values":{' + Object.keys(v).map(function (k) { return JSON.stringify(k) + ':' + JSON.stringify(v[k]); }).join(',') + '}}';
    return PF.sha256.hex(c);
  }
  /* A new decision on a report (g, from group), by a person: status accepted, declined (with a reason) or open. rev is one more
     than the decision this window shows (current). Throws, naming the field. */
  function decision(g, sha, status, by, at, current, more) {
    more = more || {};
    if (STATUS.indexOf(status) < 0) throw new Error('Unknown decision.');
    if (!by) throw new Error('Choose who you are first.');
    if (!g || !is(PROC, g.process) || !is(RUN, g.run) || !is(STEP, g.step) || !is(TOOL, g.producer) || !is(ID, g.id) || !is(HEX64, sha)) throw new Error('This report can\'t be decided here.');
    var rev = (current && revOk(current.rev) ? current.rev : 0) + 1;
    if (rev > MAX_REV) throw new Error('This report has had too many decisions to record another.');
    var d = { format: DFORMAT, process: g.process, run: g.run, step: g.step, producer: g.producer, report: g.id, sha256: sha, status: status };
    if (status === 'declined') {
      var why = String(more.reason == null ? '' : more.reason).replace(/\s+/g, ' ').trim();
      if (!why) { var e = new Error('Say why it\'s declined. The run will show this.'); e.field = 'rep-reason'; throw e; }
      if (why.length > LIMITS.text) { var e2 = new Error('Up to ' + LIMITS.text + ' characters; this is ' + why.length + '.'); e2.field = 'rep-reason'; throw e2; }
      d.reason = why;
    }
    if (status === 'accepted') {
      if (!more.answer || !is(ISO, more.answer.at) || typeof more.answer.by !== 'string' || !is(HEX64, more.answer.fp)) throw new Error('An acceptance names the answer it checked.');
      d.inputs = more.inputs === 'match' ? 'match' : 'unknown';
      d.answer = { at: more.answer.at, by: more.answer.by.slice(0, LIMITS.by), fp: more.answer.fp };
    }
    d.by = String(by).slice(0, LIMITS.by); d.at = at; d.rev = rev; d.seen = current && typeof current._file === 'string' ? current._file : null;
    return d;
  }
  /* A decision file read from disk: { ok: true, d } or { ok: false, kind, why, needs }. Never throws. The process, run, hash and
     rev in the file name must be what's inside. */
  function cleanDecision(o, process, file) {
    if (!isMap(o)) return bad(['isn\'t a decision on a report']);
    var v = E.judge('flightdeck-report-decision', o);
    if (!v.ok) return bad([v.why], v.kind, v.needs);
    var errors = [];
    Object.keys(o).forEach(function (k) { if (DKEYS.indexOf(k) < 0) errors.push('has ' + q(k) + ', which a decision on a report doesn\'t have'); });
    if (o.app != null && !(typeof o.app === 'string' && E.semver(o.app))) errors.push('has an "app" that isn\'t a version');
    if (!is(PROC, o.process) || (process != null && o.process !== process)) errors.push('names another process');
    if (!is(RUN, o.run) || !is(STEP, o.step) || !is(TOOL, o.producer) || !is(ID, o.report)) errors.push('doesn\'t name a report');
    if (!is(HEX64, o.sha256)) errors.push('has no SHA-256 of the report');
    if (STATUS.indexOf(o.status) < 0) errors.push('has no decision');
    if (o.status === 'declined' && !(typeof o.reason === 'string' && o.reason.trim() && o.reason.length <= LIMITS.text)) errors.push('declines without a reason');
    if (o.reason != null && o.status !== 'declined') errors.push('has a reason but doesn\'t decline');
    var a = o.answer;
    if (o.status === 'accepted') {
      if (!(isMap(a) && Object.keys(a).every(function (k) { return ['at', 'by', 'fp'].indexOf(k) >= 0; }) && is(ISO, a.at) && typeof a.by === 'string' && a.by.length <= LIMITS.by && is(HEX64, a.fp))) errors.push('accepts without the answer it checked');
      if (o.inputs !== 'match' && o.inputs !== 'unknown') errors.push('accepts without saying how its inputs compared');
    } else if (a != null || o.inputs != null) errors.push('names an answer but doesn\'t accept');
    if (!(typeof o.by === 'string' && o.by && o.by.length <= LIMITS.by) || !(typeof o.at === 'string' && o.at && o.at.length <= LIMITS.at) || !revOk(o.rev)) errors.push('has no who, when or rev');
    if (o.seen != null && !is(DFILE, o.seen)) errors.push('has a "seen" that isn\'t a decision\'s file name');
    if (!errors.length && file != null) {
      var nm = parseDecisionName(file);
      if (!nm || nm.run !== o.run || nm.hash !== decisionHash({ process: o.process, run: o.run, step: o.step, producer: o.producer, id: o.report }) || nm.rev !== o.rev) errors.push('has a file name that doesn\'t match what it says');
    }
    if (errors.length) return bad(errors);
    var d = { format: DFORMAT, process: o.process, run: o.run, step: o.step, producer: o.producer, report: o.report, sha256: o.sha256, status: o.status };
    if (o.status === 'declined') d.reason = o.reason;
    if (o.status === 'accepted') { d.inputs = o.inputs; d.answer = { at: a.at, by: a.by, fp: a.fp }; }
    d.by = o.by; d.at = o.at; d.rev = o.rev; d.seen = o.seen == null ? null : o.seen;
    if (file != null) d._file = file;
    d.key = identity({ process: d.process, run: d.run, step: d.step, producer: d.producer, id: d.report });
    return { ok: true, d: d };
  }
  /* The current decision per report identity: the highest rev; two at the same rev were made at once, so one is picked by file
     name (the same way everywhere) and the report shows Needs review until someone decides again. */
  function current(decisions) {
    var cur = dict();
    (decisions || []).forEach(function (d) {
      if (!d || typeof d.key !== 'string') return;
      var c = cur[d.key];
      if (!c || d.rev > c.d.rev) cur[d.key] = { d: d, tie: false };
      else if (d.rev === c.d.rev) cur[d.key] = { d: (d._file || '') > (c.d._file || '') ? d : c.d, tie: true };
    });
    return cur;
  }
  /* Where a report stands with the run: { state, text }. state: 'none' (not decided), 'tie', 'declined', 'open' (reopened),
     'accepted', 'changed' (evidence changed since acceptance), 'again' (the step was answered again since), 'gone' (no copy
     has the bytes that were accepted). */
  function decided(g, cur, r, step, nameOf) {
    nameOf = nameOf || function (x) { return x; };
    var hit = cur ? cur[g.key] : null, d = hit ? hit.d : null;
    if (!d) return { state: 'none', text: 'Not accepted yet.' };
    if (hit.tie) return { state: 'tie', text: 'Needs review: two decisions at once. Decide again.', d: d };
    if (d.status === 'declined') return { state: 'declined', text: 'Declined by ' + nameOf(d.by) + ': ' + d.reason, d: d };
    if (d.status === 'open') return { state: 'open', text: 'Reopened by ' + nameOf(d.by) + '. Not accepted.', d: d };
    if (!g.copies.some(function (c) { return c.ok && c.sha256 === d.sha256; })) return { state: 'gone', text: 'Accepted, but the report it accepted is gone or changed.', d: d };
    var a = r && r.steps && own(r.steps, g.step) ? r.steps[g.step] : null;
    if (!a || a.s !== 'done' || a.at !== d.answer.at || a.by !== d.answer.by) return { state: 'again', text: 'Accepted, but the step was answered again since.', d: d };
    if (step && fingerprint(a.values || {}, schemaOf(r, step)) !== d.answer.fp) {
      var c = (r.log || []).filter(function (l) { return l && typeof l.what === 'string' && /^Filled in /.test(l.what) && l.at > d.answer.at; }).slice(-1)[0];
      return { state: 'changed', text: 'Evidence changed since acceptance' + (c ? ' (Fill in by ' + nameOf(c.by) + ', ' + U.hm(c.at) + ').' : '.'), d: d };
    }
    return { state: 'accepted', text: 'Accepted by ' + nameOf(d.by) + ' at ' + U.hm(d.answer.at) + '. The step was checked with this report\'s evidence.', d: d };
  }

  /* ---------- accepting ---------- */
  /* The report's evidence the step records, and the names it doesn't (never copied): { values, unused }. */
  function valuesFor(rep, r, step) {
    var list = R.evidenceFor(r, step).list, names = list.map(function (d) { return d.name; }), values = {}, unused = [];
    Object.keys(rep.evidence || {}).forEach(function (k) { if (names.indexOf(k) >= 0) values[k] = rep.evidence[k]; else unused.push(k); });
    return { values: values, unused: unused };
  }
  /* Whether a person may accept a report now, and what it would check the step with: { ok, why, values, unused, applies,
     replaces }. o: { recording, readOnly (why), fillOpen }. The run's own guards (phase open, not paused, not ended) come from
     the same rules as every answer. */
  function eligible(g, r, map, o) {
    o = o || {};
    var no = function (why) { return { ok: false, why: why }; };
    if (!g.report) return no(g.reason || 'This report can\'t be read.');
    if (g.differ || g.unreadable.length) return no(g.reason);
    var rep = g.report, x = map ? M.findStep(map, g.step) : null;
    if (o.readOnly) return no(o.readOnly);
    if (!o.recording) return no('Only the recorder can accept a report.');
    if (rep.verdict !== 'pass') return no('This report says ' + rep.verdict + '. Accepting checks the step, so only a pass can be accepted.');
    if (!r || r.folder !== rep.publication.folder) return no('This report is for ' + rep.publication.folder + ', but the run is on ' + (r ? r.folder : 'another version') + '.');
    if (!x) return no('This step isn\'t in the run\'s version.');
    if (x.step.type === 'run.process') return no('This step is checked by its linked run, never by a report.');
    if (String(R.fieldsOf(r, x.step).sets || '').trim()) return no('This step sets run details. Check it yourself; reports can\'t set details yet.');
    if (r.ended || r.state !== 'running') return no('The run has ended.');
    if (r.paused) return no('The run is paused. Resume it first.');
    if (!R.phaseOpen(r, map, x.phaseIndex)) return no('That phase isn\'t open yet.');
    if (o.fillOpen) return no('Save or cancel Fill in first.');
    var ap = applies(rep, r, map, x.step);
    if (ap.result === 'mismatch') return no(appliesText(ap));
    var vu = valuesFor(rep, r, x.step), chk = R.checkEvidence(r, x.step, null, vu.values);
    if (chk.error) {
      var d = R.evidenceFor(r, x.step).list.filter(function (y) { return y.name === chk.field; })[0];
      return no(d && !vu.values[d.name] ? 'This report doesn\'t have ' + d.label + ', which this step requires.' : chk.error);
    }
    var a = own(r.steps, g.step) ? r.steps[g.step] : null, replaces = [];
    if (a && a.values) R.evidenceFor(r, x.step).list.forEach(function (y) { if (a.values[y.name] && a.values[y.name] !== chk.values[y.name]) replaces.push({ name: y.name, label: y.label, was: a.values[y.name] }); });
    return { ok: true, why: '', values: chk.values, unused: vu.unused, applies: ap, replaces: replaces, step: x.step, schema: schemaOf(r, x.step) };
  }
  /* The run's log line for an acceptance: names the report and the SHA-256 of the bytes accepted, so the run alone says what
     was accepted, in every copy. */
  function logLine(g, sha, stepText) {
    var head = 'Accepted report ' + g.producer + '/' + g.id + ' sha256:' + sha + ' (says pass) for "', t = String(stepText || '');
    var room = 300 - head.length - 1;
    return head + (t.length > room ? t.slice(0, room - 1) + '…' : t) + '"';
  }
  function parseLog(what) { var m = typeof what === 'string' ? LOG.exec(what) : null; return m ? { producer: m[1], id: m[2], sha256: m[3] } : null; }
  /* Acceptances in the run whose decision isn't in the folder (the window closed before it was written): the log names the
     report and its hash, and the step's answer is still the one accepted. recordable when a copy with exactly those bytes is
     there now; a decision is never written from other bytes. */
  function unrecorded(r, groups, cur) {
    var out = [], seen = dict();
    (r && r.log || []).forEach(function (l) {
      var p = l && parseLog(l.what);
      if (!p) return;
      var g = (groups || []).filter(function (x) { return x.producer === p.producer && x.id === p.id; })[0];
      if (!g || seen[g.key + p.sha256]) return;
      var a = own(r.steps, g.step) ? r.steps[g.step] : null;
      if (!a || a.s !== 'done' || a.at !== l.at || a.by !== l.by) return;
      var hit = cur ? cur[g.key] : null;
      if (hit && hit.d.status === 'accepted' && hit.d.sha256 === p.sha256 && hit.d.answer.at === l.at) return;
      if (hit && hit.d.rev && hit.d.at > l.at) return;
      seen[g.key + p.sha256] = true;
      out.push({ g: g, sha256: p.sha256, at: l.at, by: l.by, recordable: g.copies.some(function (c) { return c.ok && c.sha256 === p.sha256; }) && !g.differ });
    });
    return out;
  }
  /* Whether the saved run holds exactly the answer an acceptance made (intent: { step, at, by, fp, schema }). */
  function landed(r, intent) {
    var a = r && r.steps && own(r.steps, intent.step) ? r.steps[intent.step] : null;
    return !!a && a.s === 'done' && a.at === intent.at && a.by === intent.by && fingerprint(a.values || {}, intent.schema) === intent.fp;
  }

  /* ---------- the command line: check a report against the folder ---------- */
  /* A valid report against its run: { errors (it can't be for this run), warnings, applies: 'yes' | 'no' | 'unknown' }. */
  function target(rep, r, map) {
    var errors = [], warnings = [], x = map ? M.findStep(map, rep.step) : null;
    if (r.folder !== rep.publication.folder) errors.push('The report is for ' + rep.publication.folder + ', but run ' + rep.process + '/' + rep.run + ' is on ' + r.folder + '.');
    if (!x) errors.push('Step ' + rep.step + ' isn\'t in the run\'s version (' + r.folder + ').');
    if (errors.length) return { errors: errors, warnings: warnings, applies: 'no' };
    if (x.step.type === 'run.process') warnings.push('Step ' + rep.step + ' is checked by its linked run; a person can\'t accept a report on it.');
    if (String(R.fieldsOf(r, x.step).sets || '').trim()) warnings.push('Step ' + rep.step + ' sets run details; a person checks it, and can\'t accept a report on it yet.');
    var vu = valuesFor(rep, r, x.step);
    vu.unused.forEach(function (k) { warnings.push('Evidence ' + k + ' isn\'t something step ' + rep.step + ' records; it won\'t be used.'); });
    var ap = applies(rep, r, map, x.step);
    ap.rows.forEach(function (row) { if (row.detail && !row.tied && map.meta.context.indexOf(row.detail) >= 0) warnings.push('Step ' + rep.step + ' isn\'t tied to ' + row.detail + ' (^' + row.detail + '), so a later change to it won\'t send the step back.'); });
    if (r.ended) warnings.push('Run ' + rep.process + '/' + rep.run + ' has ended; a person can\'t accept a report on it.');
    if (rep.verdict !== 'pass') warnings.push('The report says ' + rep.verdict + '; only a pass can be accepted.');
    return { errors: [], warnings: warnings, applies: ap.result === 'match' ? 'yes' : ap.result === 'mismatch' ? 'no' : 'unknown', unused: vu.unused };
  }
  /* The text a report is written as: its fields in order, id and created filled when the caller left them out. */
  function text(o) {
    var out = {};
    KEYS.forEach(function (k) { if (own(o, k) && o[k] !== undefined) out[k] = o[k]; });
    return JSON.stringify(out, null, 2) + '\n';
  }
  /* Refuses text that holds a private key, which a report never needs (only PEM blocks are looked for). */
  function holdsKey(t) { return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(String(t)); }

  /* Home: reports nobody has decided on, on runs this person records, by name alone (no contents needed). files: [{ process,
     run, step, producer, id }]. */
  function undecided(files, cur, runKeys) {
    var n = dict(), seen = dict();
    (files || []).forEach(function (f) {
      var k = identity(f), rk = f.process + '/' + f.run;
      if (seen[k] || !own(runKeys, rk)) return;
      seen[k] = true;
      var hit = cur ? cur[k] : null;
      if (!hit || hit.d.status === 'open') n[rk] = (n[rk] || 0) + 1;
    });
    return n;
  }

  return { FORMAT: FORMAT, DFORMAT: DFORMAT, DIR: DIR, DDIR: DDIR, LIMITS: LIMITS, KEYS: KEYS, DKEYS: DKEYS, VERDICTS: VERDICTS, STATUS: STATUS, MAX_REV: MAX_REV, FILE: FILE, DFILE: DFILE,
    utf8: utf8, snapshot: snapshot, parseName: parseName, fileName: fileName, identity: identity, decisionHash: decisionHash, decisionName: decisionName, parseDecisionName: parseDecisionName,
    clean: clean, cleanValue: cleanValue, group: group, order: order, applies: applies, appliesText: appliesText, schemaOf: schemaOf, fingerprint: fingerprint,
    decision: decision, cleanDecision: cleanDecision, current: current, decided: decided, valuesFor: valuesFor, eligible: eligible, logLine: logLine, parseLog: parseLog,
    unrecorded: unrecorded, landed: landed, target: target, text: text, holdsKey: holdsKey, undecided: undecided, revOk: revOk };
})();
