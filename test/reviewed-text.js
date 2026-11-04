'use strict';
/* The reviewed-text snapshot: the guarantee that no shipped instruction text changes unreviewed. Every text an assistant or
   a person follows (the installed AGENTS.md, every file of the skills pack, docs/*.md, the merge README and prompt as
   Flightdeck renders them, and each release's notes in src/releases.json) has the SHA-256 of its normalized content in
   test/reviewed-text.json, with a note on what changed and that it was checked for direct writes and unconditional
   deletes. A changed, new or removed text fails until its entry is updated, so every wording change is a deliberate review.
   Check g and the delete guard stay as aids for that review; they can't be complete, this can.

   To update entries after reviewing the change:
     node test/reviewed-text.js --update "<what changed; checked for direct writes and unconditional deletes>"
   It rewrites only the changed, new and removed entries. Run it with no arguments to list what is out of date. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { load } = require('./harness');

const ROOT = path.join(__dirname, '..'), SNAP = path.join(__dirname, 'reviewed-text.json');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const C = load().contract;

function walk(dir) {
  const out = [];
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((e) => {
    const p = dir + '/' + e.name;
    if (e.name === '__pycache__' || /\.pyc$/.test(e.name) || e.name === '.DS_Store') return;
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  });
  return out;
}

/* { name: text } for every reviewed text. */
function texts() {
  const out = {};
  out['example-folder/AGENTS.md'] = read('example-folder/AGENTS.md');
  walk('example-folder/.flightdeck/skills').forEach((p) => { out[p] = read(p); });
  fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => /\.md$/.test(f)).sort().forEach((f) => { out['docs/' + f] = read('docs/' + f); });
  const G = C.REFS + 'command-guide.md', ups = ['.flightdeck', 'updates'];
  const held = { key: 'AGENTS.md', rel: 'AGENTS.md', status: 'merge', heldFrom: 'update', held: [{ path: G, lacks: ['Reading runs'] }] };
  const only = { key: 'AGENTS.md', rel: 'AGENTS.md', status: 'merge', waiting: '2.15.0', onlyCopy: true, waitsFor: [] };
  const wait = { key: 'AGENTS.md', rel: 'AGENTS.md', status: 'merge', waiting: '2.15.0', onlyCopy: true, waitsFor: [{ path: G, lacks: ['Reading runs'] }] };
  out['rendered: the merge README, AGENTS.md held'] = C.mergeReadme('2.15.0', [held], ups, 'the team folder', {});
  out['rendered: the merge README, AGENTS.md the only copy'] = C.mergeReadme('2.15.0', [only], ups, 'the team folder', {});
  out['rendered: the merge README, the only copy waiting on a reference'] = C.mergeReadme('2.15.0', [wait], ups, 'the team folder', {});
  out['rendered: the merge prompt'] = C.mergePrompt('2.15.0', '.flightdeck/updates/2.15.0');
  JSON.parse(read('src/releases.json')).forEach((r) => {
    const { version, date, ...words } = r;
    out['src/releases.json#' + version] = JSON.stringify(words, null, 1);
  });
  return out;
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

module.exports = { texts, normalize, sha, snapshot, problems, update };
