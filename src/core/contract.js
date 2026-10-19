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
  function norm(text) { return String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n'); }
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

  return { BEGIN: BEGIN, END: END, AGENTS: AGENTS, BASELINES: BASELINES, norm: norm, region: region, managed: managed, baselineKey: baselineKey, hex: hex, installed: installed };
})();
