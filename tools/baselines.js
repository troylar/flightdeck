// Keeps src/baselines.json: every AGENTS.md (its Flightdeck part) and skill file Flightdeck has shipped, by content hash.
// flightdeck install uses it to tell an old default, which it updates, from a team's own change, which it keeps.
//   node tools/baselines.js              list current files whose hash isn't recorded for this version
//   node tools/baselines.js --write      record the example folder's files under the version in src/releases.json
//   node tools/baselines.js --backfill   also record the files of every release tag from v1.10.0 on (needs git)
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { managed, hash, baselineKey, cmp } = require('../bin/flightdeck.js');
const ROOT = path.join(__dirname, '..'), FILE = path.join(ROOT, 'src', 'baselines.json');
const EMPTY = { format: 'flightdeck-baselines/1', hash: 'sha256 of the text as UTF-8, after removing a byte-order mark and turning CRLF into LF; for AGENTS.md, only the part from <!-- flightdeck:begin --> through <!-- flightdeck:end --> (the whole file before 1.15)', files: {} };

// The same files build.py puts in the app: AGENTS.md at the top, and .md, .json and .py files under .flightdeck/skills.
const wanted = (rel) => rel === 'AGENTS.md' || (/^\.flightdeck\/skills\//.test(rel) && /\.(md|json|py)$/.test(rel));
function key(rel) { return rel === 'AGENTS.md' ? baselineKey('AGENTS.md') : rel; }
function hashes(files) { const out = {}; Object.keys(files).forEach((rel) => { out[key(rel)] = hash(managed(rel, files[rel])); }); return out; }

function current() {
  const ex = path.join(ROOT, 'example-folder'), files = {};
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name), rel = path.relative(ex, p).split(path.sep).join('/');
      if (e.isDirectory()) walk(p); else if (e.isFile() && wanted(rel)) files[rel] = fs.readFileSync(p, 'utf8');
    }
  })(ex);
  return files;
}
function atTag(tag) {
  const git = (...a) => cp.execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = {};
  git('ls-tree', '-r', '--name-only', tag, '--', 'example-folder/AGENTS.md', 'example-folder/.flightdeck/skills').split('\n').filter(Boolean).forEach((p) => {
    const rel = p.slice('example-folder/'.length);
    if (wanted(rel)) files[rel] = git('show', tag + ':' + p);
  });
  return files;
}
function version() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'releases.json'), 'utf8'))[0].version; }
function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return JSON.parse(JSON.stringify(EMPTY)); } }
function add(b, files, v) {
  const h = hashes(files);
  Object.keys(h).forEach((k) => { const by = (b.files[k] = b.files[k] || {}); by[h[k]] = Array.from(new Set((by[h[k]] || []).concat(v))).sort(cmp); });
}
// What's wrong with the record for this version: a current file not listed under it, or a listing no current file has.
function problems(b, v) {
  const h = hashes(current()), out = [];
  Object.keys(h).forEach((k) => { if (!((b.files[k] || {})[h[k]] || []).includes(v)) out.push(k + ' changed: run node tools/baselines.js --write'); });
  Object.keys(b.files).forEach((k) => Object.keys(b.files[k]).forEach((x) => { if (b.files[k][x].includes(v) && h[k] !== x) out.push(k + ' lists ' + v + ' for an older text: run node tools/baselines.js --write'); }));
  return out;
}

if (require.main === module) {
  const v = version(), b = load();
  if (process.argv.includes('--backfill')) {
    const tags = cp.execFileSync('git', ['tag', '-l', 'v*'], { cwd: ROOT, encoding: 'utf8' }).split('\n').map((t) => t.trim())
      .filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && cmp(t.slice(1), '1.10.0') >= 0 && cmp(t.slice(1), v) < 0).sort((x, y) => cmp(x.slice(1), y.slice(1)));
    tags.forEach((t) => add(b, atTag(t), t.slice(1)));
    console.log('Recorded ' + tags.join(', '));
  }
  if (process.argv.includes('--write') || process.argv.includes('--backfill')) {
    // This version's entries are always exactly the files as they are now: a text changed during the release never shipped.
    Object.keys(b.files).forEach((k) => Object.keys(b.files[k]).forEach((x) => {
      b.files[k][x] = b.files[k][x].filter((y) => y !== v);
      if (!b.files[k][x].length) delete b.files[k][x];
    }));
    Object.keys(b.files).forEach((k) => { if (!Object.keys(b.files[k]).length) delete b.files[k]; });
    add(b, current(), v);
    const sorted = {};
    Object.keys(b.files).sort().forEach((k) => { sorted[k] = b.files[k]; });
    fs.writeFileSync(FILE, JSON.stringify(Object.assign({}, EMPTY, { files: sorted }), null, 2) + '\n');
    console.log('Wrote src/baselines.json for ' + v);
  } else {
    const p = problems(b, v);
    console.log(p.length ? p.join('\n') : 'src/baselines.json is up to date for ' + v);
    process.exitCode = p.length ? 1 : 0;
  }
}
module.exports = { problems, version, load, current };
