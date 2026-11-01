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
  /* Exactly what flightdeck install and this app write; anything else is ignored, and the next update writes a new one. */
  function wellFormed(r) {
    return !!(r && typeof r === 'object' && !Array.isArray(r) && r.format === 'flightdeck-installed/1' && typeof r.version === 'string' && VERSION_DIR.test(r.version)
      && typeof r.at === 'string' && (r.by === 'cli' || r.by === 'app') && r.files && typeof r.files === 'object' && !Array.isArray(r.files)
      && Object.keys(r.files).every(function (k) { return typeof r.files[k] === 'string' && HASH.test(r.files[k]); }));
  }
  /* The record's text (null when there's none) as the installer reads it: { newer: why } (refuse everything), { files: {},
     ignored: true }, { files: {} } when there's none, or { version, files: the entries for keys, all: every entry }. */
  function readRecord(text, keys) {
    if (text == null) return { files: {} };
    var r = null;
    try { r = JSON.parse(text); } catch (e) { r = null; }
    var nw = newerWhy(r);
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
    return items.map(function (it) {
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
    items.forEach(function (i) { if (!i.changed) rec[i.key] = i.want; });
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
  /* The README beside staged defaults: which files, and a prompt for an AI assistant. updates: the updates folder's parts. */
  function mergeReadme(version, items, updates, home) {
    var here = updates.concat(version).join('/');
    return '# Flightdeck ' + version + ': files to merge\n\nFlightdeck ' + version + ' changed these files, and your team changed them too, so the update left your versions in place:\n\n' +
      items.map(function (i) { return '- `' + i.rel + '`' + (i.key === AGENTS ? ' (only the part between the flightdeck markers)' : ''); }).join('\n') +
      '\n\nThe new default of each file is in this folder (`' + here + '/`), at the same path it has in ' + home + '.\n\n## Ask your AI assistant to merge them\n\nOpen your AI assistant in ' + home + ', and give it this:\n\n' +
      mergePrompt(version, here) + '\n\nThen run the same flightdeck command with `--check`: exit code 0 means nothing is left to merge.\n';
  }
  /* The request a person hands their AI assistant, quoted in the README and copied by the app's Copy merge request. */
  function mergePrompt(version, here) {
    return '> Flightdeck ' + version + ' put new default versions of some files in `' + here + '/`; its README.md lists them. For each one, compare the new default with our file at the same path. Keep our own changes, and bring in what the new default adds or changes. In AGENTS.md, change only the part between `<!-- flightdeck:begin -->` and `<!-- flightdeck:end -->`; anything that is ours belongs under Team notes, below the end marker. Show me each change before you save it. When a file is merged, delete its copy here. When only README.md is left, delete this folder.';
  }
  /* The first thing to paste into an AI assistant opened on the team folder: plain text, naming no tool. Not every tool reads
     .flightdeck/skills on its own, and one stops reading AGENTS.md partway, so it says both out loud. */
  var START_PROMPT = 'Read AGENTS.md in this folder, to the end, and follow it. If this folder has no AGENTS.md, stop and tell me to open the team folder itself.\n\n' +
    'The Flightdeck skills are in .flightdeck/skills/, one folder per skill, each with a SKILL.md. Your tool may not load them on its own, so list that folder yourself. When one fits the job, read its SKILL.md and follow it. A name like /flightdeck-status or $flightdeck-status means .flightdeck/skills/flightdeck-status/SKILL.md.\n\n' +
    'Don\'t change anything yet. Tell me in a few lines what you can help with here, then ask me what I want done.';
  return { START_PROMPT: START_PROMPT, MAX_BYTES: MAX_BYTES, cleanInstalled: cleanInstalled, readRecord: readRecord, newerWhy: newerWhy, classify: classify, merged: merged, nextRecord: nextRecord, mergeReadme: mergeReadme, mergePrompt: mergePrompt, byVersion: byVersion, VERSION_DIR: VERSION_DIR,
    BEGIN: BEGIN, END: END, AGENTS: AGENTS, BASELINES: BASELINES, norm: norm, region: region, managed: managed, baselineKey: baselineKey, hex: hex, installed: installed };
})();
