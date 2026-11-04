'use strict';
/* The reviewed-text snapshot: the guarantee that nothing Flightdeck ships, or anything that generates what it ships, changes
   unreviewed. Every file in the inventory is pinned whole, by the SHA-256 of its bytes, with a reviewed note: all of src/**
   and bin/**, build.py and every tool in tools/, package.json and what npm includes with it (README.md, LICENSE,
   CHANGELOG.md), the example folder build.py embeds (the folder pack: AGENTS.md and .flightdeck/skills/**), and docs/*.md.
   The inventory is read at test time from the sources of truth (build.py's lists, package.json "files",
   src/baselines.json), so a file that ships is in it by construction. Any byte change, whitespace included, fails until its
   entry is updated: no reading of the text decides what counts. dist/flightdeck.html and dist/FONT-LICENSE.txt are
   generated: the parity check rebuilds them from the pinned inputs and compares, so they hold nothing unpinned. The rendered
   merge README and prompt are kept as samples. Check g and the delete guard stay as aids for the review, and so does the
   list of a JavaScript file's changed literals that the command prints.

   To update entries after reviewing the change:
     node test/reviewed-text.js --update "<what changed; checked for direct writes and unconditional deletes>"
   It rewrites only the changed, new and removed entries. Run it with no arguments to list what is out of date. */
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { load } = require('./harness');

const ROOT = path.join(__dirname, '..'), SNAP = path.join(__dirname, 'reviewed-text.json');
const C = load().contract;
const SKIP = (name) => name === '__pycache__' || /\.pyc$/.test(name) || name === '.DS_Store';

/* Files, with overrides for the self-tests: over[path] is a file's text (a new file, or a changed one), null removes one. */
function reader(over) {
  const o = over || {};
  const has = (p) => (p in o ? o[p] != null : fs.existsSync(path.join(ROOT, p)));
  const read = (p) => (p in o ? o[p] : fs.readFileSync(path.join(ROOT, p), 'utf8'));
  const bytes = (p) => (p in o ? Buffer.from(o[p], 'utf8') : fs.readFileSync(path.join(ROOT, p)));
  const walk = (dir) => {
    const out = [];
    const go = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => {
      if (SKIP(e.name)) return;
      const p = d + '/' + e.name; if (e.isDirectory()) go(p); else out.push(p);
    });
    if (fs.existsSync(path.join(ROOT, dir))) go(dir);
    Object.keys(o).forEach((p) => { if (p.startsWith(dir + '/') && o[p] != null && out.indexOf(p) < 0) out.push(p); });
    return out.filter(has).sort();
  };
  return { has, read, bytes, walk };
}

/* The example folder as build.py embeds it: .md and .json, .py under .flightdeck, AGENTS.md only at the top. */
const exampleFiles = (r) => r.walk('example-folder').filter((p) => {
  const rel = p.slice('example-folder/'.length), parts = rel.split('/'), name = parts[parts.length - 1];
  return (/\.(?:md|json)$/.test(name) || (/\.py$/.test(name) && parts.indexOf('.flightdeck') >= 0)) && (name !== 'AGENTS.md' || parts.length === 1);
});
/* What build.py reads: all of src (its CORE, STORAGE and APP lists, page.html, releases, baselines, fonts), docs/recovery.md
   and the example folder. The lists are read out of build.py too, so a file it names is never missed. */
function buildInputs(over) {
  const r = reader(over), py = r.read('build.py'), named = [];
  ['CORE', 'STORAGE', 'APP'].forEach((k) => { const m = new RegExp('^' + k + '\\s*=\\s*\\[([^\\]]*)\\]', 'm').exec(py); if (!m) throw new Error('build.py has no ' + k + ' list'); (m[1].match(/"[^"]+"/g) || []).forEach((x) => named.push('src/' + x.slice(1, -1))); });
  return Array.from(new Set(r.walk('src').concat(named, ['docs/recovery.md'], exampleFiles(r)))).sort();
}
/* What npm packs, from npm itself: the files list plus what it adds on its own (README*, LICENSE*, LICENCE*, COPYING*,
   CHANGELOG*, package.json, the bin). Run on a mirror of the tree (empty files; package.json and ignore files with their
   text) with the overrides applied, so a file that only exists in a test still counts. Cached by the file set. */
const NOT_TREE = (name) => name === '.git' || name === 'node_modules';
const IGNORE_FILE = (p) => p === 'package.json' || /(?:^|\/)\.(?:npm|git)ignore$/.test(p);
const packCache = {};
function packed(over) {
  const o = over || {}, all = [];
  const go = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => {
    if (NOT_TREE(e.name)) return;
    const p = d ? d + '/' + e.name : e.name; if (e.isDirectory()) go(p); else all.push(p);
  });
  go('');
  Object.keys(o).forEach((p) => { if (all.indexOf(p) < 0) all.push(p); });
  const r = reader(over), files = all.filter((p) => !(p in o) || o[p] != null).sort();
  const key = JSON.stringify(files.concat(files.filter(IGNORE_FILE).map((p) => r.read(p))));
  if (packCache[key]) return packCache[key];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-reviewed-'));
  try {
    files.forEach((p) => { fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), IGNORE_FILE(p) ? r.read(p) : ''); });
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'], { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    packCache[key] = JSON.parse(out)[0].files.map((f) => f.path).sort();
    return packCache[key];
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const GENERATED = ['dist/flightdeck.html', 'dist/FONT-LICENSE.txt'];
/* { path: kind }: whole, or generated (checked by parity). */
function inventory(over) {
  const r = reader(over), base = JSON.parse(r.read('src/baselines.json')).files;
  const files = buildInputs(over).concat(r.walk('bin'), r.walk('tools'), ['build.py', 'package.json'], packed(over),
    Object.keys(base).map((f) => 'example-folder/' + f.split('#')[0]), r.walk('docs').filter((p) => /^docs\/[^/]+\.md$/.test(p)));
  const out = {};
  files.forEach((f) => { out[f] = GENERATED.indexOf(f) >= 0 ? 'generated' : 'whole'; });
  return out;
}

/* A reviewer's aid only, never the pass/fail rule: a JavaScript file's string and template literals, in order, raw, so the
   command can show which literals a change touched. It can misread (a regular expression after n++, say); the whole-file
   hash doesn't depend on it. */
function stringsOf(code) {
  const strings = [], spans = [], n = code.length;
  let i = code.startsWith('#!') ? code.indexOf('\n') : 0, last = null;
  const KW = /^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
  const regexHere = () => !last || (last.t === 'id' ? KW.test(last.v) : last.t === 'punc');
  const lit = (s, e) => { strings.push(code.slice(s, e)); spans.push([s, e]); };
  function template() {
    let s = i;
    while (i < n) {
      const d = code[i];
      if (d === '\\') { i += 2; continue; }
      if (d === '`') { lit(s, i); i++; return; }
      if (d === '$' && code[i + 1] === '{') { lit(s, i); i += 2; last = null; scan(true); s = i; continue; }
      i++;
    }
    throw new Error('an unterminated template literal');
  }
  function scan(inner) {
    let depth = 0;
    while (i < n) {
      const c = code[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && code[i + 1] === '/') { const e = code.indexOf('\n', i); i = e < 0 ? n : e; continue; }
      if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); if (e < 0) throw new Error('an unterminated comment'); i = e + 2; continue; }
      if (c === '\'' || c === '"') {
        const s = ++i;
        while (i < n && code[i] !== c) { if (code[i] === '\n') throw new Error('an unterminated string at ' + s); i += code[i] === '\\' ? 2 : 1; }
        if (i >= n) throw new Error('an unterminated string at ' + s);
        lit(s, i); i++; last = { t: 'str' }; continue;
      }
      if (c === '`') { i++; template(); last = { t: 'str' }; continue; }
      if (c === '/') {
        if (!regexHere()) { i++; last = { t: 'punc' }; continue; }
        i++; let cls = false;
        while (i < n) { const d = code[i]; if (d === '\\') { i += 2; continue; } if (d === '\n') throw new Error('an unterminated regular expression at ' + i); if (cls) { if (d === ']') cls = false; } else if (d === '[') cls = true; else if (d === '/') break; i++; }
        i++; while (i < n && /[a-z]/i.test(code[i])) i++; last = { t: 're' }; continue;
      }
      if (/[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 127) { const s = i; while (i < n && (/[\w$]/.test(code[i]) || code.charCodeAt(i) > 127)) i++; last = { t: 'id', v: code.slice(s, i) }; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1]))) { while (i < n && /[\w.]/.test(code[i])) i++; last = { t: 'num' }; continue; }
      if (c === '{') { depth++; i++; last = { t: 'punc' }; continue; }
      if (c === '}') { if (inner && depth === 0) { i++; return; } depth--; i++; last = { t: 'close' }; continue; }
      if (c === ')' || c === ']') { i++; last = { t: 'close' }; continue; }
      i++; last = { t: 'punc' };
    }
    if (inner) throw new Error('an unterminated template expression');
  }
  scan(false);
  return { strings, spans };
}
/* The rendered merge README and prompt, as samples beside the pinned source. */
function rendered() {
  const out = {}, G = C.REFS + 'command-guide.md', ups = ['.flightdeck', 'updates'];
  const held = { key: 'AGENTS.md', rel: 'AGENTS.md', status: 'merge', heldFrom: 'update', held: [{ path: G, lacks: ['Reading runs'] }] };
  const only = { key: 'AGENTS.md', rel: 'AGENTS.md', status: 'merge', waiting: '2.15.0', onlyCopy: true, waitsFor: [] };
  const wait = { key: 'AGENTS.md', rel: 'AGENTS.md', status: 'merge', waiting: '2.15.0', onlyCopy: true, waitsFor: [{ path: G, lacks: ['Reading runs'] }] };
  out['rendered: the merge README, AGENTS.md held'] = C.mergeReadme('2.15.0', [held], ups, 'the team folder', {});
  out['rendered: the merge README, AGENTS.md the only copy'] = C.mergeReadme('2.15.0', [only], ups, 'the team folder', {});
  out['rendered: the merge README, the only copy waiting on a reference'] = C.mergeReadme('2.15.0', [wait], ups, 'the team folder', {});
  out['rendered: the merge prompt'] = C.mergePrompt('2.15.0', '.flightdeck/updates/2.15.0');
  return out;
}

/* { name: text } for every reviewed text; a binary file as base64. */
function texts(over) {
  const r = reader(over), inv = inventory(over), out = {};
  Object.keys(inv).sort().forEach((f) => { if (inv[f] === 'whole') out[f] = /\.(?:woff2|png|jpe?g|gif|ico)$/i.test(f) ? 'base64:' + r.bytes(f).toString('base64') : r.read(f); });
  /* The packed file list itself, so a file npm stops packing fails too. */
  out['npm pack (the file list)'] = packed(over).join('\n') + '\n';
  return Object.assign(out, rendered());
}

/* The parity check: build.py run on a copy of the inputs reproduces the shipped generated files byte for byte. */
function parity() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-reviewed-'));
  try {
    ['build.py', 'package.json', 'src', 'example-folder', 'docs/recovery.md'].forEach((p) => fs.cpSync(path.join(ROOT, p), path.join(tmp, p), { recursive: true }));
    execFileSync('python3', [path.join(tmp, 'build.py')], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
    return GENERATED.concat('CHANGELOG.md').filter((f) => !fs.readFileSync(path.join(tmp, f)).equals(fs.readFileSync(path.join(ROOT, f))));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/* Every byte counts, whitespace and line endings included. */
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const HOW = 'review it, then run: node test/reviewed-text.js --update "<what changed; checked for direct writes and unconditional deletes>"';
const snapshot = () => JSON.parse(fs.readFileSync(SNAP, 'utf8'));

/* What is out of date: each problem names its text. */
function problems(now, snap) {
  const out = [], have = (snap && snap.texts) || {};
  Object.keys(now).sort().forEach((name) => {
    const e = have[name];
    if (!e) out.push('new, not reviewed: ' + name + '; ' + HOW);
    else if (e.sha256 !== sha(now[name])) out.push('changed since its review: ' + name + '; ' + HOW);
    if (e && !(typeof e.reviewed === 'string' && e.reviewed.trim())) out.push('an entry with no reviewed note: ' + name);
  });
  Object.keys(have).sort().forEach((name) => { if (!(name in now)) out.push('removed, still listed: ' + name + '; ' + HOW); });
  return out;
}

function update(note) {
  const now = texts(), snap = fs.existsSync(SNAP) ? snapshot() : { texts: {} }, next = {};
  Object.keys(now).sort().forEach((name) => {
    const e = snap.texts[name], h = sha(now[name]);
    next[name] = e && e.sha256 === h && e.reviewed ? e : { sha256: h, reviewed: note };
  });
  const changed = Object.keys(next).filter((n) => next[n] !== snap.texts[n]), gone = Object.keys(snap.texts).filter((n) => !(n in next));
  fs.writeFileSync(SNAP, JSON.stringify({ texts: next }, null, 2) + '\n');
  return { changed, gone };
}

if (require.main === module) {
  const i = process.argv.indexOf('--update');
  if (i >= 0) {
    const note = (process.argv[i + 1] || '').trim();
    if (!note) { console.error('--update needs a note: what changed, and that it was checked for direct writes and unconditional deletes'); process.exit(2); }
    const { changed, gone } = update(note);
    changed.forEach((n) => console.log('reviewed: ' + n));
    gone.forEach((n) => console.log('dropped: ' + n));
    if (!changed.length && !gone.length) console.log('nothing to update');
  } else {
    const p = problems(texts(), snapshot());
    p.forEach((x) => {
      console.log(x);
      /* The aid: for a changed JavaScript file, the literals added and dropped since the last commit. */
      const m = /^changed since its review: (\S+\.js);/.exec(x);
      if (!m) return;
      try {
        const was = stringsOf(execFileSync('git', ['show', 'HEAD:' + m[1]], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).strings;
        const now = stringsOf(fs.readFileSync(path.join(ROOT, m[1]), 'utf8')).strings;
        now.filter((s) => was.indexOf(s) < 0).slice(0, 20).forEach((s) => console.log('    + ' + s.slice(0, 160)));
        was.filter((s) => now.indexOf(s) < 0).slice(0, 20).forEach((s) => console.log('    - ' + s.slice(0, 160)));
      } catch (e) { console.log('    (no literal list: ' + e.message.split('\n')[0] + ')'); }
    });
    process.exit(p.length ? 1 : 0);
  }
}

module.exports = { texts, inventory, packed, buildInputs, stringsOf, parity, sha, snapshot, problems, update };
