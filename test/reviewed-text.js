'use strict';
/* The reviewed-text snapshot: the guarantee that nothing Flightdeck ships changes its wording unreviewed. Coverage comes from
   the build and package inventory, not from wording: every build input build.py reads (src/**, docs/recovery.md, the
   example folder it embeds), every file in package.json "files", every file the folder pack writes (src/baselines.json's
   files: AGENTS.md, its Flightdeck part keyed AGENTS.md#flightdeck, and the skills pack), docs/*.md and README.md. A file that ships is in the inventory by construction.
     - Markdown, text and data files are pinned whole.
     - JavaScript (all of src and bin) is pinned by the ordered list of its string and template literals, raw, per file: any
       wording change anywhere fails until reviewed; a code-only change (names, comments, spacing, logic) doesn't.
     - Generated files (dist/flightdeck.html, dist/FONT-LICENSE.txt, CHANGELOG.md) aren't pinned: the parity check rebuilds
       them from the pinned inputs and compares, so the HTML holds nothing unpinned.
   Each entry has the SHA-256 of its normalized content in test/reviewed-text.json and a note saying what changed and that it
   was checked for direct writes and unconditional deletes. A changed, new or removed text fails until its entry is updated.
   Check g and the delete guard stay as aids for that review.

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
const GENERATED = ['dist/flightdeck.html', 'dist/FONT-LICENSE.txt', 'CHANGELOG.md'];
/* { path: kind }: whole, strings (JavaScript), releases (src/releases.json, one entry per release) or generated. */
function inventory(over) {
  const r = reader(over), pkg = JSON.parse(r.read('package.json')), base = JSON.parse(r.read('src/baselines.json')).files;
  const files = buildInputs(over).concat(pkg.files, Object.keys(base).map((f) => 'example-folder/' + f.split('#')[0]),
    r.walk('docs').filter((p) => /^docs\/[^/]+\.md$/.test(p)), ['README.md']);
  const out = {};
  files.forEach((f) => { out[f] = GENERATED.indexOf(f) >= 0 ? 'generated' : f === 'src/releases.json' ? 'releases' : /\.js$/.test(f) ? 'strings' : 'whole'; });
  return out;
}

/* The string and template literals of a JavaScript file, in order, raw (as written, escapes and all), and where each sits.
   A template's text parts are literals; its ${...} parts are code. Regular expressions and comments are code. */
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
/* The tokenizer's own check: with every literal emptied, the file still compiles, so no literal's edges were misread. */
function checkStrings(code, file) {
  const { spans } = stringsOf(code);
  let out = '', at = 0;
  spans.forEach(([s, e]) => { out += code.slice(at, s); at = e; });
  out += code.slice(at);
  new vm.Script('(function(){' + out.replace(/^#!.*/, '') + '\n})', { filename: file });
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

/* { name: text } for every reviewed text. */
function texts(over) {
  const r = reader(over), inv = inventory(over), out = {};
  Object.keys(inv).sort().forEach((f) => {
    const k = inv[f];
    if (k === 'generated') return;
    if (k === 'releases') {
      JSON.parse(r.read(f)).forEach((x) => { const { version, date, ...words } = x; out[f + '#' + version] = JSON.stringify(words, null, 1); });
      return;
    }
    if (k === 'strings') { out[f] = JSON.stringify(stringsOf(r.read(f)).strings, null, 0); return; }
    out[f] = /\.(?:woff2|png|jpe?g|gif|ico)$/i.test(f) ? 'base64:' + r.bytes(f).toString('base64') : r.read(f);
  });
  return Object.assign(out, rendered());
}

/* The parity check: build.py run on a copy of the inputs reproduces the shipped generated files byte for byte. */
function parity() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-reviewed-'));
  try {
    ['build.py', 'package.json', 'src', 'example-folder', 'docs/recovery.md'].forEach((p) => fs.cpSync(path.join(ROOT, p), path.join(tmp, p), { recursive: true }));
    execFileSync('python3', [path.join(tmp, 'build.py')], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
    return GENERATED.filter((f) => !fs.readFileSync(path.join(tmp, f)).equals(fs.readFileSync(path.join(ROOT, f))));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/* Line endings, a byte-order mark, trailing spaces and trailing blank lines don't count; everything else does. */
const normalize = (t) => C.norm(t).replace(/[ \t]+$/gm, '').replace(/\n+$/, '') + '\n';
const sha = (t) => crypto.createHash('sha256').update(normalize(t), 'utf8').digest('hex');
const snapshot = () => JSON.parse(fs.readFileSync(SNAP, 'utf8'));

/* What is out of date: each problem names its text. */
function problems(now, snap) {
  const out = [], have = (snap && snap.texts) || {};
  Object.keys(now).sort().forEach((name) => {
    const e = have[name];
    if (!e) out.push('new text, not reviewed: ' + name);
    else if (e.sha256 !== sha(now[name])) out.push('changed since its review: ' + name);
    if (e && !(typeof e.reviewed === 'string' && e.reviewed.trim())) out.push('an entry with no reviewed note: ' + name);
  });
  Object.keys(have).sort().forEach((name) => { if (!(name in now)) out.push('removed, still listed: ' + name); });
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
    p.forEach((x) => console.log(x));
    process.exit(p.length ? 1 : 0);
  }
}

module.exports = { texts, inventory, buildInputs, stringsOf, checkStrings, parity, normalize, sha, snapshot, problems, update };
