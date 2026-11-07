#!/usr/bin/env node
/* The flightdeck command: puts the one-file app where a team uses it. No dependencies, nothing runs on install, and it
   never touches the network. Every command works on plain files: copy the app and the AI assistant contract (AGENTS.md
   and the skills) into a team folder, add or update the skills anywhere else, back up a team folder, export a run's
   evidence, or open the app. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'dist', 'flightdeck.html');
const NAME = 'flightdeck.html', OLD = 'preflight.html', SKILLS = '.flightdeck/skills', AGENTS = 'AGENTS.md';
const BEGIN = '<!-- flightdeck:begin -->', END = '<!-- flightdeck:end -->';
/* --check exit codes, for scripts: nothing to do, updates to install, files that need a person (or an assistant) to merge.
   export: 0 a complete pack, 4 a partial pack (made, with what's unresolved listed), 1 no pack (any partial file removed).
   Reading for other apps (processes, process, runs, run, next, followups): 0 complete, 4 partial (data printed, every
   problem listed), 1 no data, 5 no such process, version or run. */
const EXIT = { none: 0, error: 1, updates: 2, merge: 3, partial: 4, notFound: 5 };

class Refused extends Error {}
/* A file that changed between the moment install read it and the moment it would replace it. */
class Changed extends Error {}
function fail(msg) { throw new Refused(msg); }
function versionOf(html) {
  const m = /<meta name="(?:flightdeck|preflight)-version" content="(\d+\.\d+\.\d+|dev)">/.exec(html.slice(0, 8192));
  return m ? m[1] : null;
}
function cmp(a, b) {
  const x = a.split('.').map(BigInt), y = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
function app() {
  if (!fs.existsSync(APP)) fail('the app file is missing from this install (' + APP + '). Reinstall the package.');
  return fs.readFileSync(APP, 'utf8');
}
function expand(arg) { return path.resolve(arg.replace(/^~(?=$|[\\/])/, require('os').homedir())); }
function folderArg(arg, example) {
  if (!arg) fail('say which team folder, for example: flightdeck ' + (example || 'install') + ' "~/OneDrive/Team/Flightdeck"');
  const dir = expand(arg);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail('"' + dir + '" isn\'t a folder.');
  return fs.realpathSync(dir);
}

/* The same hashing as PF.contract in the app: no byte-order mark, Unix line endings, and for AGENTS.md only the part
   between the markers (all of it in an AGENTS.md from before the markers). */
function norm(text) { return String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); }
function region(text) {
  const t = norm(text), i = t.indexOf(BEGIN), j = i < 0 ? -1 : t.indexOf(END, i);
  return i < 0 || j < 0 ? { text: t, start: 0, end: t.length, marked: false } : { text: t.slice(i, j + END.length), start: i, end: j + END.length, marked: true };
}
function managed(key, text) { return key === AGENTS ? region(text).text : norm(text); }
function hash(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
function baselineKey(key) { return key === AGENTS ? AGENTS + '#flightdeck' : key; }

/* Walk to a path inside a folder without following a link at any level (a symlink or a Windows junction could point
   anywhere). Returns the file's lstat, or null when it isn't there. */
function inside(dir, parts) {
  let cur = dir, st = null;
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i] || parts[i] === '.' || parts[i] === '..') fail('refusing an unexpected path: ' + parts.join('/'));
    cur = path.join(cur, parts[i]);
    if (!cur.startsWith(dir + path.sep)) fail('refusing to write outside the folder: ' + parts.join('/'));
    try { st = fs.lstatSync(cur); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; }
    if (st.isSymbolicLink()) fail('refusing to write through a link: ' + cur);
    if (i < parts.length - 1 && !st.isDirectory()) fail(cur + ' isn\'t a folder.');
  }
  return st;
}
function readInside(dir, parts) {
  const st = inside(dir, parts);
  if (!st) return null;
  if (!st.isFile()) fail(path.join(dir, ...parts) + ' isn\'t a file.');
  return fs.readFileSync(path.join(dir, ...parts), 'utf8');
}
function lstatOrNull(p) { try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
/* Every folder from dir down to dir/parts is a real folder, not a link, and is where its name says. dir itself is a real
   path (folderArg resolves it), so the folder's real path must be exactly the joined name. With create, missing folders
   are made one at a time. */
function folders(dir, parts, create) {
  let cur = dir;
  for (const p of parts) {
    if (!p || p === '.' || p === '..' || /[\\/]/.test(p)) fail('refusing to write outside the folder: ' + parts.join('/'));
    cur = path.join(cur, p);
    let st = lstatOrNull(cur);
    if (!st && create) { try { fs.mkdirSync(cur); } catch (e) { if (e.code !== 'EEXIST') throw e; } st = lstatOrNull(cur); }
    if (!st) return null;
    if (st.isSymbolicLink()) fail('refusing to write through a link: ' + cur);
    if (!st.isDirectory()) fail(cur + ' isn\'t a folder.');
  }
  if (fs.realpathSync(cur) !== cur) fail('refusing to write through a link: ' + cur);
  return cur;
}
/* Write a file inside the folder, and only there, never through a link:
   1. the text goes to a new temporary file beside the target (created exclusively, so never an existing file or a link),
      written in full, flushed to disk and read back;
   2. the folders are checked again, and the temporary file must still be the one this process made;
   3. with expect (the text install read, or null for "not there"), the target must still be exactly that;
   4. one rename puts the temporary file in place.
   A failure at any step leaves the target as it was and removes the temporary file. The only window is between steps 3
   and 4: a save landing there is replaced, which is why install keeps a checked copy of every file before it replaces it
   (keepCopy). Someone renaming folders inside your own team folder at that instant, on purpose, is out of scope. */
function safeWrite(dir, parts, text, expect) {
  const name = parts[parts.length - 1], sub = parts.slice(0, -1);
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) fail('refusing to write outside the folder: ' + parts.join('/'));
  const home = folders(dir, sub, true), target = path.join(home, name), data = Buffer.from(text, 'utf8');
  const was = lstatOrNull(target);
  if (was && (was.isSymbolicLink() || !was.isFile())) fail('refusing to write through a link: ' + target);
  const tmp = path.join(home, '.' + name + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
  let fd = null, mine = null, moved = false;
  try {
    fd = fs.openSync(tmp, 'wx');
    mine = fs.fstatSync(fd);
    for (let off = 0; off < data.length;) {
      const n = fs.writeSync(fd, data, off, data.length - off);
      if (!(n > 0)) throw new Error('the disk accepted no more bytes');
      off += n;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = null;
    folders(dir, sub, false);
    const now = lstatOrNull(tmp);
    if (!now || now.isSymbolicLink() || now.ino !== mine.ino || now.dev !== mine.dev) fail('refusing to write through a link: ' + home);
    if (!fs.readFileSync(tmp).equals(data)) throw new Error('the written file didn\'t read back the same');
    const hooks = safeWrite.hooks || {};
    if (hooks.beforeCompare) hooks.beforeCompare(target);
    if (expect !== undefined) {
      const st = lstatOrNull(target);
      if (st && (st.isSymbolicLink() || !st.isFile())) fail('refusing to write through a link: ' + target);
      if ((st ? fs.readFileSync(target, 'utf8') : null) !== expect) throw new Changed(parts.join('/'));
    }
    if (hooks.afterCompare) hooks.afterCompare(target);
    fs.renameSync(tmp, target);
    moved = true;
  } catch (e) {
    if (e instanceof Refused || e instanceof Changed) throw e;
    fail('couldn\'t write ' + target + ': ' + e.message);
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* already failing */ }
    /* Remove the temporary file only if it's still the one this process made, wherever a swapped folder now points. */
    if (!moved && mine) {
      try { const left = lstatOrNull(tmp); if (left && !left.isSymbolicLink() && left.ino === mine.ino && left.dev === mine.dev) fs.unlinkSync(tmp); }
      catch (e) { /* the original error says what went wrong */ }
    }
  }
}

/* The example folder and the baselines are built into the app, so the contract always matches this version. */
function examples(html) {
  const m = /var EXAMPLES = (\{[\s\S]*?\});\n/.exec(html);
  if (!m) fail('couldn\'t find the built-in skills in the app file.');
  return JSON.parse(m[1].replace(/<\\\//g, '</'));
}
function skillFiles(html) {
  const all = examples(html);
  return Object.keys(all).filter((p) => p.startsWith(SKILLS + '/')).map((p) => ({ path: p.slice(SKILLS.length + 1), text: all[p] }));
}
function baselines(html) {
  const m = /var BASELINES = (\{.*\});\n/.exec(html);
  if (!m) fail('couldn\'t find the built-in baselines in the app file.');
  return JSON.parse(m[1]).files || {};
}

/* What the app copy at dest is, compared with this one: missing, current, older (update), or a refusal. */
function appStatus(dir, file, html, mine, force) {
  const text = readInside(dir, [file]);
  if (text === null) return { status: 'new', text };
  if (text === html) return { status: 'current', text };
  const theirs = versionOf(text);
  if (force) return { status: 'update', text };
  if (!theirs) fail(path.join(dir, file) + ' isn\'t a Flightdeck app this version recognizes. Use --force to replace it anyway.');
  if (theirs !== 'dev' && mine !== 'dev' && cmp(theirs, mine) > 0) fail(path.join(dir, file) + ' is a newer version (' + theirs + ') than this one (' + mine + '). Update the package, or use --force to replace it anyway.');
  return { status: 'update', text };
}

/* Sort each contract file into what install does with it:
     current     same as this version's default
     update      a default some version shipped (only the built-in baselines prove that): replaced with this version's
     kept        the team changed it, and this version's default is the one it was based on: left alone
     merge       the team changed it and the default changed too: the new default goes to the updates folder
     new         not there yet: written
     missing     installed before, since deleted: written again
   The folder's record only ever makes install more careful (kept rather than merge), never lets it replace a file.
   A copy still waiting in .flightdeck/updates/<any version>/ keeps a file at merge until the copy is merged and gone.
   With --force, kept and merge files are replaced too, after a copy is saved. */
function classify(t, files, base, force) {
  const items = files.map((f) => {
    const parts = f.rel.split('/'), now = readInside(t.dir, parts), want = hash(managed(f.key, f.text));
    return { key: f.key, rel: f.rel, baseKey: f.baseKey, parts, text: f.text, now, want, have: now === null ? null : hash(managed(f.key, now)), staged: staged(t, f.rel) };
  });
  /* An old copy an older app left (PF.contract.classifyCopies, the app's own rule, from the texts as read: a byte-order mark
     kept): named, never merged, counted or removed. */
  const K = contractRules();
  items.forEach((i) => {
    const all = i.staged, said = JSON.parse(JSON.stringify(K.classifyCopies({ key: i.key, baseKey: i.baseKey, shipped: i.text, version: t.version, base, active: i.now, copies: all.map((x) => ({ version: x.version, text: x.text })) })));
    i.old = all.filter((x, n) => said[n] === 'old');
    i.staged = all.filter((x, n) => said[n] !== 'old');
  });
  const decided = decide(items.map((i) => ({ key: i.key, baseKey: i.baseKey, want: i.want, have: i.have, staged: i.staged.map((x) => ({ version: x.version, hash: hash(managed(i.key, x.text)) })) })), t.record, base, t.version, force);
  /* The content rule (PF.contract.hold, the app's own): AGENTS.md waits while a file it would cite lacks a cited section. Copied
     out of the engine's context, so it compares as plain objects here. */
  const why = JSON.parse(JSON.stringify(K.hold(decided, items.map((i) => ({ key: i.key, text: i.text, now: i.now, have: i.have, want: i.want, staged: i.staged.map((x) => K.copyPrint(i.key, x.text)) })), base)));
  return items.map((i, n) => Object.assign(i, why[n], { key: i.key }));
}
/* The decision alone, from hashes: the same as PF.contract.classify (test/assistant-files.test.js checks they agree), plus
   forced, which only --force gives. */
function decide(items, record, base, version, force) {
  const rf = (record && record.files) || {};
  return items.map((it) => {
    const out = { key: it.key, status: '' }, st = it.staged || [];
    if (it.have === null || it.have === undefined) { out.status = rf[it.key] ? 'missing' : 'new'; return out; }
    if (st.length && !force) {
      out.status = 'merge'; out.waiting = st.map((x) => x.version).join(', ');
      out.stage = it.have !== it.want && !st.some((x) => x.version === version || x.hash === it.want);
      return out;
    }
    if (it.have === it.want) out.status = 'current';
    else if ((base[it.baseKey || baselineKey(it.key)] || {})[it.have]) out.status = 'update';
    else if (force) out.status = 'forced';
    else if (rf[it.key] === it.want) out.status = 'kept';
    else out.status = 'merge';
    return out;
  });
}
/* The versions under the updates folder, and which of them hold a copy of rel still waiting to be merged. */
/* Oldest first, dev last: the order install and the app both list waiting versions in. */
function byVersion(a, b) { return a === b ? 0 : a === 'dev' ? 1 : b === 'dev' ? -1 : cmp(a, b); }
function versionsStaged(t) {
  if (t.versions) return t.versions;
  const home = folders(t.dir, t.updates, false);
  t.versions = home ? fs.readdirSync(home).filter((v) => /^(\d+\.\d+\.\d+|dev)$/.test(v) && folders(t.dir, t.updates.concat(v), false)).sort(byVersion) : [];
  return t.versions;
}
function staged(t, rel) {
  return versionsStaged(t).map((v) => ({ version: v, parts: t.updates.concat(v, rel.split('/')) })).filter((x) => { const text = readInside(t.dir, x.parts); return text !== null && (x.text = text, true); });
}
/* The text written for a contract file: AGENTS.md keeps everything outside its markers (the team's notes); a file from
   before the markers is replaced whole. */
function merged(item) {
  if (item.key !== AGENTS || item.now === null) return item.text;
  const old = region(item.now), fresh = region(item.text);
  return old.marked ? norm(item.now).slice(0, old.start) + fresh.text + norm(item.now).slice(old.end) : item.text;
}
/* A record written by a newer Flightdeck (flightdeck-installed/2 on, or a must-understand feature): never read for meaning and
   never rewritten. The same verdict as PF.contract.cleanInstalled (test/cli.test.js checks they agree). */
function installedNewer(r, mine) { return contractRules().recordNewer(r, mine); }
/* The app's own contract rules (PF.contract), from this package's app file, so a verdict the app, Folder health and this
   command all reach is one function, never a copy. */
let engineRules = null;
function contractRules() { return (engineRules = engineRules || loadEngine().PF.contract); }
/* The folder's record, checked field by field. Anyone can edit it, so a record that isn't exactly what this command writes is
   ignored (and said so), and only entries for files this version installs, with a well-formed hash, are read. */
function readRecord(t, keys) {
  t.recordText = readInside(t.dir, t.recordAt);
  const r = parseRecord(t.recordText, keys, t.version);
  if (r.newer) fail(contractRules().outcomeWords({ state: 'newer', newer: r.newer }, { home: t.home, updates: t.updates, recordAt: t.recordAt.join('/'), version: t.version }).text);
  return r;
}
/* The record's text as install reads it: the same as PF.contract.readRecord (test/assistant-files.test.js checks they agree). */
/* The record's text as install reads it: the app's own PF.contract.readRecord, so the app and this command parse it the same way
   (copied out of the engine's context, so it compares as a plain object here). */
function parseRecord(text, keys, mine) { return JSON.parse(JSON.stringify(contractRules().readRecord(text === undefined ? null : text, keys, mine))); }
function stamp(d) { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + p(d.getMinutes()); }
function fineStamp(d) { const p = (n, w) => String(n).padStart(w || 2, '0'); return stamp(d).replace(' ', '-') + p(d.getSeconds()) + '-' + p(d.getMilliseconds(), 3); }

function mergeReadme(version, items, t) { return mergeReadmeText(version, items, t.updates, t.home, t.words); }
/* The app's own PF.contract.mergeReadme, so the README's words (held, re-staged, waiting) are one function, never a copy.
   ctx: { base, record, agents (this version's default AGENTS.md) }, for the words only. */
function mergeReadmeText(version, items, updates, home, ctx) { return contractRules().mergeReadme(version, items, updates, home, ctx); }

/* What an install would write has to be something the app can read back (PF.contract.MAX_BYTES): over the limit, nothing is
   touched. The same check and words as Settings, AI assistant files (afRoom). */
const CONTRACT_MAX = 8 * 1048576;
function roomFor(t, items) {
  const why = (name, n, then) => name + ' would be too big for Flightdeck to read back (' + (Math.ceil(n / 1048576 * 100) / 100) + ' MB, over ' + (CONTRACT_MAX / 1048576) + ' MB). Nothing was changed. ' + then;
  for (const i of items) {
    if (['current', 'kept', 'merge'].includes(i.status)) continue;
    const n = Buffer.byteLength(merged(i), 'utf8');
    if (n > CONTRACT_MAX) fail(why(i.rel, n, 'Shorten what your team added to it, then try again.'));
  }
  const rec = nextRecord(t.record, items, t.version);
  if (!rec) return;
  const size = Buffer.byteLength(JSON.stringify({ format: 'flightdeck-installed/1', version: t.version, at: new Date().toISOString(), by: 'cli', files: rec }, null, 2) + '\n', 'utf8');
  if (size > CONTRACT_MAX) fail(why(t.recordAt.join('/'), size, 'Remove the entries for files Flightdeck no longer ships, then try again.'));
}
/* Something in the way of where a file goes: the same words as PF.contract.outcomeWords. Every destination is looked at before
   anything is written, so a predictable refusal never leaves an update half done. */
function blockedWhy(rel, want) { return rel + (want === 'file' ? ' is a folder, where Flightdeck needs a file.' : ' is a file, where Flightdeck needs a folder.') + ' Nothing was changed. Move it, then try again.'; }
function clearFor(dir, parts) {
  let cur = dir;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    const st = lstatOrNull(cur), rel = parts.slice(0, i + 1).join('/');
    if (!st) return;
    if (st.isSymbolicLink()) fail('refusing to write through a link: ' + cur);
    if (i === parts.length - 1 ? !st.isFile() : !st.isDirectory()) fail(blockedWhy(rel, i === parts.length - 1 ? 'file' : 'folder'));
  }
}
function destinationsClear(t, items, more) {
  const dests = (more || []).slice();
  for (const i of items) {
    if (['current', 'kept'].includes(i.status)) continue;
    if (i.status === 'merge') {
      /* A copy already waiting here: the README beside it may be rewritten, its old text kept. */
      if (i.waiting && !i.stage) { if (i.staged.some((x) => x.version === t.version)) dests.push(t.updates.concat(t.version, 'README.md'), t.updates.concat(t.version, 'replaced', 'x')); continue; }
      dests.push(t.updates.concat(t.version, i.rel.split('/')), t.updates.concat(t.version, 'README.md'), t.updates.concat(t.version, 'replaced', 'x'));
      continue;
    }
    dests.push(i.parts);
    if (i.now !== null && i.now !== merged(i)) dests.push(t.updates.concat(t.version, 'replaced', 'x'));
  }
  if (nextRecord(t.record, items, t.version)) dests.push(t.recordAt);
  dests.forEach((parts) => clearFor(t.dir, parts));
}
/* install and skills: one routine for the team folder, and for skills --to <dir>. */
function contract(t, files, opts) {
  const base = baselines(opts.html), now = new Date();
  if (!opts.check || opts.room) clearFor(t.dir, t.updates.concat(t.version, 'x'));
  inside(t.dir, t.updates.concat(t.version, 'replaced'));
  t.record = readRecord(t, files.map((f) => f.key));
  t.words = { base, record: t.record, agents: examples(opts.html)[AGENTS] };
  t.changed = [];
  const items = classify(t, files, base, opts.force);
  if (!opts.check || opts.room) { roomFor(t, items); destinationsClear(t, items, opts.more); }
  if (opts.check) return items;
  /* The merge list as it was before anything is written: the only text it may replace. */
  /* AGENTS.md from update goes last: it is written only if the files it cites have what it points to after their own writes, and
     otherwise staged, as a held one (PF.contract.holdAfter, round 11). */
  const agent = items.find((i) => i.key === AGENTS && i.status === 'update');
  const readmeAt = t.updates.concat(t.version, 'README.md'), readmeWas = agent || items.some((i) => i.status === 'merge') ? readInside(t.dir, readmeAt) : null;
  for (const i of agent ? items.filter((x) => x !== agent).concat(agent) : items) {
    if (i === agent && items.some((x) => x.changed)) {
      const nowOf = Object.create(null);
      items.forEach((x) => { if (x.changed) nowOf[x.key] = readInside(t.dir, x.parts); });
      const late = JSON.parse(JSON.stringify(contractRules().holdAfter(items, items, nowOf)));
      if (late) Object.assign(i, { status: 'merge', waiting: '', stage: true, heldFrom: 'update', held: late.held });
    }
    if (['current', 'kept'].includes(i.status) || (i.status === 'merge' && i.waiting && !i.stage)) {
      if (opts.force) i.staged.forEach((x) => fileAway(t, x));
      continue;
    }
    try {
      hook('contractWrite', t.dir, i.rel);
      if (i.status === 'merge') { safeWrite(t.dir, t.updates.concat(t.version, i.rel.split('/')), i.text, null); continue; }
      const out = merged(i);
      if (i.now !== null && i.now !== out) keepCopy(t, i.parts, i.now);
      safeWrite(t.dir, i.parts, out, i.now);
      if (opts.force) i.staged.forEach((x) => fileAway(t, x));
    } catch (e) {
      if (!(e instanceof Changed)) throw e;
      i.changed = true; t.changed.push(i.rel);
    }
  }
  const merges = items.filter((i) => i.status === 'merge' && !i.changed);
  const listed = merges.filter((i) => !i.waiting || i.stage || i.staged.some((x) => x.version === t.version));
  const next = listed.length ? mergeReadme(t.version, listed, t) : null;
  /* Who writes the README is the command's, not the folder's. A run that classifies every contract file in its folder
     (opts.restate: install, and skills --to, whose folder holds only skills) writes the README when something new is staged
     and rewrites one whose words are no longer true (they depend on the state: held, waiting, lacking). flightdeck skills into
     a team folder doesn't know AGENTS.md, so it never rewrites a README there; it writes one only when it stages something new
     and there is none, and the next install says the rest. */
  const fresh = merges.some((i) => !i.waiting || i.stage);
  if (opts.restate ? fresh || (readmeWas !== null && next !== null && next !== readmeWas) : fresh && readmeWas === null) {
    try {
      if (readmeWas !== null && readmeWas !== next) keepCopy(t, ['merge-README.md'], readmeWas);
      safeWrite(t.dir, readmeAt, next, readmeWas);
    } catch (e) {
      if (!(e instanceof Changed)) throw e;
      t.changed.push(readmeAt.join('/'));
    }
  }
  const rec = nextRecord(t.record, items, t.version);
  if (!rec) return items;
  try {
    safeWrite(t.dir, t.recordAt, JSON.stringify({ format: 'flightdeck-installed/1', version: t.version, at: now.toISOString(), by: 'cli', files: rec }, null, 2) + '\n', t.recordText);
    t.recordWritten = true;
  } catch (e) {
    if (!(e instanceof Changed)) throw e;
    t.changed.push(t.recordAt.join('/'));
  }
  return items;
}
/* The record's files after an update, or null when it would be written unchanged: the same as PF.contract.nextRecord. */
function nextRecord(record, items, version) {
  const rec = Object.assign({}, record.all || {});
  /* A held or onlyCopy AGENTS.md wasn't written, so it keeps its previous entry, as a changed file does. */
  items.forEach((i) => { if (!i.changed && !(i.key === AGENTS && (i.heldFrom || i.onlyCopy))) rec[i.key] = i.want; });
  if (!record.ignored && record.version === version && JSON.stringify(rec) === JSON.stringify(record.all)) return null;
  return rec;
}
/* Every file install replaces, the app included, is first copied to a folder of its own under
   .flightdeck/updates/<version>/replaced/, made new for this run (never one an earlier run used), and the copy is read back.
   No checked copy, no replacement. */
function keepCopy(t, parts, text) {
  if (!t.replacedAt) {
    const home = folders(t.dir, t.updates.concat(t.version, 'replaced'), true);
    for (let n = 0; !t.replacedAt; n++) {
      const name = fineStamp(new Date()) + '-' + crypto.randomBytes(3).toString('hex');
      try { fs.mkdirSync(path.join(home, name)); t.replacedAt = t.updates.concat(t.version, 'replaced', name); }
      catch (e) { if (e.code !== 'EEXIST' || n > 20) throw e; }
    }
  }
  safeWrite(t.dir, t.replacedAt.concat(parts), text, null);
  /* Nothing is replaced or removed on the strength of a copy that doesn't read back exactly. */
  if (readInside(t.dir, t.replacedAt.concat(parts)) !== text) fail('the copy of ' + parts.join('/') + ' didn\'t read back the same, so nothing was replaced. Check the disk and try again.');
}
/* A staged copy that --force made obsolete: moved beside the files it replaced (staged/<version>/...), never deleted. */
function fileAway(t, x) {
  keepCopy(t, ['staged', x.version].concat(x.parts.slice(t.updates.length + 1)), x.text);
  const p = path.join(folders(t.dir, x.parts.slice(0, -1), false), x.parts[x.parts.length - 1]), st = lstatOrNull(p);
  if (st && st.isFile() && !st.isSymbolicLink() && fs.readFileSync(p, 'utf8') === x.text) fs.unlinkSync(p);
}

const LABEL = { current: 'up to date', update: 'updated', new: 'added', missing: 'added again', kept: 'kept (your team changed it)', merge: 'needs merge', forced: 'replaced (--force)' };
const CHECK_LABEL = { update: 'update available', new: 'will be added', missing: 'will be added again', merge: 'needs merge', forced: 'will be replaced (--force)', kept: 'kept (your team changed it)' };
function report(items, check, out) {
  items.filter((i) => i.status !== 'current').forEach((i) => out.push('  ' + (i.changed ? 'changed during install' : (check ? CHECK_LABEL : LABEL)[i.status]).padEnd(28) + i.rel + (i.waiting ? ' (still waiting in updates/' + i.waiting + ')' : '')));
  items.filter((i) => i.old && i.old.length).forEach((i) => out.push('  ' + 'old copy, nothing to merge'.padEnd(28) + i.rel + ' (left in updates/' + i.old.map((x) => x.version).join(', ') + ' by an older Flightdeck; safe to delete by hand)'));
}
/* The line install prints after the list when something waits to be merged. Its first sentence says why when the content
   rule is at work (AGENTS.md held, or only its copy waiting, or files that lack what AGENTS.md points to); the rest names where
   the new defaults are: this version's folder, or, when nothing was staged there this run, the folders they wait in. When the
   first sentence already names the folder, the rest only points to its README.md; when only AGENTS.md's copy waits, the first
   sentence says it all. */
const DELETE_COPY = 'delete AGENTS.md from each version folder in `.flightdeck/updates/` (`.flightdeck/updates/<version>/AGENTS.md`, never anything under `replaced/`) only if nobody changed those copies (merge one someone did)';
const sectionWord = (xs) => (xs.length === 1 ? 'section' : 'sections');
/* The missing section names, as Folder health and the merge README give them. */
const italics = (xs) => xs.map((x) => '*' + x + '*').join(', ');
/* The first sentence, or null when the content rule isn't at work. future: install --check's words, before anything is written. */
function mergeWhy(items, mine, future) {
  const a = items.find((i) => i.key === AGENTS), merges = items.filter((i) => i.status === 'merge');
  const staged = (i) => !i.waiting || i.stage;
  const folders = (list) => list.reduce((acc, i) => acc.concat(staged(i) ? [mine] : i.waiting.split(', ')), []).filter((v, n, all) => all.indexOf(v) === n).sort(byVersion).map((v) => '.flightdeck/updates/' + v);
  const inline = (list) => folders(list).map((f) => '`' + f + '`').join(' and ');
  const waits = a && (a.heldFrom ? a.held : a.onlyCopy && a.waitsFor && a.waitsFor.length ? a.waitsFor : null), wait = future ? 'AGENTS.md will wait: ' : 'AGENTS.md waits: ';
  if (waits) return { text: waits.length === 1 ? wait + '`' + waits[0].path + '` doesn\'t have the ' + sectionWord(waits[0].lacks) + ' it points to: ' + italics(waits[0].lacks) + '.' : wait + 'these files don\'t have the sections it points to: ' + waits.map((x) => '`' + x.path + '` (' + italics(x.lacks) + ')').join(', ') + '.' };
  if (a && a.onlyCopy) return { all: merges.length === 1, text: future ? 'AGENTS.md only needs its copy deleted: your team didn\'t change AGENTS.md, so ' + DELETE_COPY + ' and run install.'
    : 'AGENTS.md\'s new default is waiting in ' + inline([a]) + '; your team didn\'t change AGENTS.md, so ' + DELETE_COPY + ' and run install again.' };
  if (merges.length && merges.every((i) => i.lacks)) {
    const at = future ? ' will wait in ' : ' is waiting in ', ats = future ? ' will wait in ' : ' are waiting in ';
    return { named: folders(merges).length, n: merges.length, text: merges.length === 1 ? '`' + merges[0].rel + '` doesn\'t have the ' + sectionWord(merges[0].lacks) + ' AGENTS.md points to: ' + italics(merges[0].lacks) + '; its new default' + at + inline(merges) + ' to be merged.'
      : 'These files don\'t have the sections AGENTS.md points to: ' + merges.map((i) => '`' + i.rel + '` (' + italics(i.lacks) + ')').join(', ') + '; their new defaults' + ats + inline(merges) + ' to be merged.' };
  }
  return null;
}
function mergeLine(items, dir, mine) {
  const merges = items.filter((i) => i.status === 'merge'), staged = (i) => !i.waiting || i.stage, why = mergeWhy(items, mine, false);
  if (why && why.all) return why.text;
  if (why && why.named) return why.text + (why.named === 1 ? ' Its README.md has' : ' Each folder\'s README.md has') + ' a prompt for your AI assistant to merge ' + (why.n === 1 ? 'it' : 'them') + '.';
  const folders = merges.reduce((acc, i) => acc.concat(staged(i) ? [mine] : i.waiting.split(', ')), []).filter((v, n, all) => all.indexOf(v) === n).sort(byVersion);
  const where = merges.some(staged) ? path.join(dir, '.flightdeck', 'updates', mine) : folders.map((v) => path.join(dir, '.flightdeck', 'updates', v)).join(' and ');
  return (why ? why.text : 'Your team changed files this version changes too.') + ' The new defaults are in ' + where + '; its README.md has a prompt for your AI assistant to merge them.';
}
/* The live AGENTS.md's pointers no merge can satisfy (PF.contract.pointers), in Folder health's words, from the files as this
   run leaves them. */
function pointerLines(items, out) {
  const written = (i) => ['update', 'new', 'missing', 'forced'].includes(i.status) && !i.changed;
  const live = items.map((i) => ({ key: i.key, text: i.text, now: written(i) ? merged(i) : i.now }));
  JSON.parse(JSON.stringify(contractRules().pointers(live))).forEach((p) => out.push(p.text));
}
/* What install says after the file list: an ignored record, and files left alone because they changed while it ran. */
function notes(t, out) {
  if (t.record && t.record.ignored) out.push('Ignored ' + t.recordAt.join('/') + ': it isn\'t a record this version of Flightdeck wrote, so it wasn\'t trusted.' + (t.recordWritten ? ' A new one was written.' : ''));
  if (t.changed && t.changed.length) out.push('Left as they are, because they changed while updating: ' + t.changed.join(', ') + '. Those weren\'t replaced; check them again.');
}
function exitFor(statuses) {
  if (statuses.includes('merge')) return EXIT.merge;
  return statuses.some((s) => ['update', 'new', 'missing', 'forced'].includes(s)) ? EXIT.updates : EXIT.none;
}

/* Whether p is the folder src or inside it, judged by what each folder above p is (device and inode), never by spelling:
   on a file system that ignores letter case, "Team" and "TEAM" are the same folder. Missing parts are skipped. */
function withinOf(src) {
  const me = fs.statSync(src);
  return (p) => {
    for (let cur = p; ; cur = path.dirname(cur)) {
      let st = null;
      try { st = fs.statSync(cur); } catch (e) { /* not there yet */ }
      if (st && st.dev === me.dev && st.ino === me.ino) return true;
      if (path.dirname(cur) === cur) return false;
    }
  };
}

/* Copy a team folder to <dest>/<name> backup <date time>/. Links are skipped, never followed, and so are temporary files. */
function backup(src, toArg) {
  const parent = expand(toArg || path.join(require('os').homedir(), 'Flightdeck backups'));
  const within = withinOf(src);
  const inside = 'the backup can\'t go inside the folder it backs up. Choose another place with --to.';
  if (within(parent)) fail(inside);
  try { fs.mkdirSync(parent, { recursive: true }); } catch (e) { fail('couldn\'t create "' + parent + '": ' + e.message); }
  const real = fs.realpathSync(parent);
  if (within(real)) fail(inside);
  let dest = path.join(real, path.basename(src) + ' backup ' + stamp(new Date()));
  for (let n = 2; ; n++) {
    try { fs.mkdirSync(dest); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    dest = path.join(real, path.basename(src) + ' backup ' + stamp(new Date()) + ' (' + n + ')');
  }
  if (within(dest)) fail(inside);
  const tally = { files: 0, bytes: 0, links: 0, tmp: 0 };
  const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
  (function copy(from, to) {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, e.name), b = path.join(to, e.name), st = fs.lstatSync(a);
      if (st.isSymbolicLink()) { tally.links++; continue; }
      if (st.isDirectory()) { fs.mkdirSync(b); copy(a, b); continue; }
      if (!st.isFile()) continue;
      if (/\.tmp$/i.test(e.name)) { tally.tmp++; continue; }
      /* Opened without following a link, and checked to be the file just looked at, so a file swapped for a link meanwhile
         is skipped rather than copied from wherever it points. */
      let fd;
      try { fd = fs.openSync(a, fs.constants.O_RDONLY | NOFOLLOW); } catch (err) { if (err.code === 'ELOOP') { tally.links++; continue; } throw err; }
      try {
        const f = fs.fstatSync(fd);
        if (!f.isFile() || f.ino !== st.ino || f.dev !== st.dev) { tally.links++; continue; }
        const data = fs.readFileSync(fd);
        fs.writeFileSync(b, data, { flag: 'wx' });
        tally.files++; tally.bytes += data.length;
      } finally { fs.closeSync(fd); }
    }
  })(src, dest);
  return Object.assign(tally, { dest });
}
function size(n) { return n < 1024 ? n + ' bytes' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }

/* ---------- The engine: export and reading for other apps run the app's own rules ---------- */
/* The app's own rules, from this installed package's dist/flightdeck.html and nowhere else (never a team folder's copy):
   its core and storage blocks, run in node:vm without the screens. */
function loadEngine() {
  const html = app(), block = (id) => {
    const m = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>').exec(html);
    if (!m) fail('the app file in this install has no ' + id + ' block (' + APP + '). Reinstall the package.');
    return m[1];
  };
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Blob, TextEncoder, TextDecoder, URL, crypto: require('crypto').webcrypto, performance: { now: () => performance.now() } });
  vm.runInContext(block('pf-core'), ctx, { filename: 'flightdeck.html#pf-core' });
  vm.runInContext(block('pf-storage'), ctx, { filename: 'flightdeck.html#pf-storage' });
  return { PF: ctx.PF, version: versionOf(html) };
}
/* The team folder for the collector: list, read, stat and blob, read-only, and never through a link. Every folder on the
   way to a path is checked with lstat (a linked folder is refused), a link in a listing is reported as a link and never
   opened, and a file is opened without following a link and must be the very file lstat saw (device and inode), so one
   swapped for a link after it was listed is refused too. links collects what was skipped. opts.maxBytes (or a read's own
   { maxBytes }) caps what read() takes in: a bigger file is sized from its open handle and refused before any byte is
   read, and named in skipped. */
function readAdapter(root, opts) {
  const NOFOLLOW = fs.constants.O_NOFOLLOW || 0, links = [], skipped = [], max = (opts && opts.maxBytes) || 0;
  /* vanished: a file or folder that was there when its path was walked and gone when it was opened (a sync or another program
     moved it in between). The read gives nothing, as for a file that isn't there, and the path is named. */
  const vanished = [], gone = (rel) => { if (vanished.indexOf(rel) < 0) vanished.push(rel); };
  function linkErr(rel) { const e = new Refused('refusing to read through a link: ' + rel); e.link = true; if (links.indexOf(rel) < 0) links.push(rel); return e; }
  function skipErr(rel, bytes, cap, more) {
    const e = new Refused(rel + ' is ' + (more ? 'more than ' : '') + size(bytes) + ', over the ' + size(cap) + ' this command reads');
    e.skipped = true; e.size = bytes;
    if (!skipped.some((x) => x.path === rel)) skipped.push({ path: rel, size: bytes, cap, more: !!more });
    return e;
  }
  /* The whole file from an open descriptor, counting the bytes as they come: the size the handle gave is only a first
     check, so a file that grows while it's read is refused (skipped) the moment it passes the cap. */
  function readAll(fd, rel, cap) {
    const chunks = [], buf = Buffer.alloc(65536);
    let total = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, total);
      if (!n) break;
      total += n;
      if (cap && total > cap) throw skipErr(rel, cap, cap, true);
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks, total);
  }
  function partsOf(p) {
    const a = p ? String(p).split('/') : [];
    a.forEach((x) => { if (!x || x === '.' || x === '..' || /[\\\u0000]/.test(x)) fail('refusing an unexpected path: ' + p); });
    return a;
  }
  /* The real folder at these parts, or null when it isn't there, with each folder's identity (device and inode) on the way. */
  function dirAt(a) {
    let cur = root;
    /* The team folder itself first: replaced by a link, nothing is read through it. */
    const top = lstatOrNull(root);
    if (!top || top.isSymbolicLink() || !top.isDirectory()) throw linkErr('the team folder');
    const ids = [top.dev + ':' + top.ino];
    for (let i = 0; i < a.length; i++) {
      cur = path.join(cur, a[i]);
      const st = lstatOrNull(cur);
      if (!st) return null;
      if (st.isSymbolicLink()) throw linkErr(a.slice(0, i + 1).join('/'));
      if (!st.isDirectory()) return null;
      ids.push(st.dev + ':' + st.ino);
    }
    return { cur, ids };
  }
  /* Node has no openat, so a folder swapped for a link (and maybe put back) is caught by walking again after the open:
     every folder must still be the same real folder, and the file at the path the one that was opened. */
  function sameWalk(a, ids, rel) {
    const again = dirAt(a);
    if (!again || again.ids.join('/') !== ids.join('/')) throw linkErr(rel);
    return again.cur;
  }
  function fileAt(p) {
    const a = partsOf(p), name = a.pop(), dir = dirAt(a);
    if (!dir) return null;
    const full = path.join(dir.cur, name), st = lstatOrNull(full);
    if (!st) return null;
    if (st.isSymbolicLink()) throw linkErr(p);
    return st.isFile() ? { full, st, a, ids: dir.ids, name } : null;
  }
  function open(p) {
    const f = fileAt(p);
    if (!f) return null;
    let fd;
    try { fd = fs.openSync(f.full, fs.constants.O_RDONLY | NOFOLLOW); } catch (e) { if (e.code === 'ELOOP') throw linkErr(p); if (e.code === 'ENOENT') { gone(p); return null; } throw e; }
    try {
      const st = fs.fstatSync(fd), now = lstatOrNull(path.join(sameWalk(f.a, f.ids, p), f.name));
      if (!st.isFile() || st.ino !== f.st.ino || st.dev !== f.st.dev || !now || now.isSymbolicLink() || now.ino !== st.ino || now.dev !== st.dev) throw linkErr(p);
      return { fd, st };
    } catch (e) { fs.closeSync(fd); throw e; }
  }
  return {
    links, skipped, vanished,
    list: (p) => new Promise((res) => {
      const a = partsOf(p), dir = dirAt(a);
      /* No such folder: empty, and marked missing, so a reader that saw it listed can tell gone from empty. */
      if (!dir) { const none = []; none.missing = true; return res(none); }
      let entries;
      try { entries = fs.readdirSync(dir.cur, { withFileTypes: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; gone(p || '.'); const none = []; none.missing = true; return res(none); }
      sameWalk(a, dir.ids, p || '.');
      res(entries.map((e) => {
        const rel = (p ? p + '/' : '') + e.name;
        if (e.isSymbolicLink()) { if (links.indexOf(rel) < 0) links.push(rel); return { name: e.name, kind: 'link' }; }
        return e.isDirectory() ? { name: e.name, kind: 'dir' } : e.isFile() ? { name: e.name, kind: 'file' } : null;
      }).filter(Boolean));
    }),
    stat: (p) => new Promise((res) => {
      let f = null;
      try { f = fileAt(p); } catch (e) { if (!e.link) throw e; }
      res(f ? { size: f.st.size, mtime: f.st.mtimeMs } : null);
    }),
    read: (p, ro) => new Promise((res) => {
      const o = open(p);
      if (!o) return res(null);
      const cap = (ro && ro.maxBytes) || max;
      if (cap && o.st.size > cap) { fs.closeSync(o.fd); throw skipErr(p, o.st.size, cap); }
      /* Decoded as a browser decodes a file (TextDecoder: UTF-8, a byte-order mark dropped), so every reader sees the same text. */
      try { const data = readAll(o.fd, p, cap); res({ text: new TextDecoder('utf-8').decode(data), size: data.length, mtime: o.st.mtimeMs }); } finally { fs.closeSync(o.fd); }
    }),
    /* A file to read a piece at a time, from the descriptor opened above; close() when done. */
    blob: (p, ro) => new Promise((res) => {
      const o = open(p);
      if (!o) return res(null);
      const cap = (ro && ro.maxBytes) || max;
      if (cap && o.st.size > cap) { fs.closeSync(o.fd); throw skipErr(p, o.st.size, cap); }
      let closed = false;
      const close = () => { if (!closed) { closed = true; fs.closeSync(o.fd); } };
      res({
        size: o.st.size,
        /* The whole file (screenshots are checked this way), counted against the cap as it's read; then closed. */
        arrayBuffer: () => new Promise((ok) => {
          if (closed) throw new Error(p + ' was already closed');
          try { const data = readAll(o.fd, p, cap); ok(data.buffer.slice(data.byteOffset, data.byteOffset + data.length)); } finally { close(); }
        }),
        slice: (a, b) => ({ arrayBuffer: () => new Promise((ok) => {
          const buf = Buffer.alloc(Math.max(0, b - a));
          let got = 0;
          while (got < buf.length) { const n = fs.readSync(o.fd, buf, got, buf.length - got, a + got); if (!n) break; got += n; }
          ok(buf.buffer.slice(buf.byteOffset, buf.byteOffset + got));
        }) }),
        close
      });
    })
  };
}
/* Where packs go: the nearest folder of --out that exists, resolved, must be outside the team folder before anything is
   created; then each missing folder is made one at a time, and each must be a real folder (not a link), still outside. */
function outFolder(want, within) {
  const inTeam = 'the pack can\'t go inside the team folder. Choose another place with --out.';
  const rest = [];
  let cur = want;
  while (!lstatOrNull(cur)) { rest.unshift(path.basename(cur)); const up = path.dirname(cur); if (up === cur) break; cur = up; }
  let at;
  try { at = fs.realpathSync(cur); } catch (e) { fail('"' + cur + '" can\'t be used for the pack: ' + e.message); }
  if (!fs.statSync(at).isDirectory()) fail('"' + cur + '" isn\'t a folder.');
  if (within(at)) fail(inTeam);
  for (const part of rest) {
    if (!part || part === '.' || part === '..') fail('"' + want + '" isn\'t a plain folder path.');
    at = path.join(at, part);
    try { fs.mkdirSync(at); } catch (e) { if (e.code !== 'EEXIST') fail('couldn\'t create "' + at + '": ' + e.message); }
    const st = lstatOrNull(at);
    if (!st || st.isSymbolicLink() || !st.isDirectory()) fail('refusing to write through a link: ' + at);
    if (within(at)) fail(inTeam);
  }
  const real = fs.realpathSync(at);
  if (within(real)) fail(inTeam);
  return real;
}
/* The pack goes to <out>/<name>.partial, created exclusively and written as it's made, then gets its final name without
   replacing anything (" (2)" and on when the name is taken). Canceled (Ctrl+C) or failed, the partial file is removed. */
async function exportPack(opt) {
  const dir = folderArg(opt.folder, 'export');
  if (!opt.run && !opt.process) fail('say which runs: --run <process>/<run id>, or --process <process> --from YYYY-MM-DD --through YYYY-MM-DD');
  if (opt.process && (!opt.from || !opt.through)) fail('give the days with --from YYYY-MM-DD and --through YYYY-MM-DD (both included)');
  const { PF, version } = loadEngine(), E = PF.evidence;
  const tz = opt.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (!E.zoneOk(tz)) fail('"' + tz + '" isn\'t a time zone this computer knows. Use a name like Europe/London or America/New_York.');
  const out = outFolder(expand(opt.out || path.join(require('os').homedir(), 'Flightdeck evidence')), withinOf(dir));
  const scope = opt.run ? { run: opt.run } : { process: opt.process, from: opt.from, through: opt.through, tz };
  let fd = null, partial = null, canceled = false;
  const onSig = () => { canceled = true; };
  process.on('SIGINT', onSig); process.on('SIGTERM', onSig);
  const cleanup = () => {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* already failing */ } fd = null; }
    if (partial) { try { fs.unlinkSync(partial); } catch (e) { /* gone already */ } partial = null; }
  };
  try {
    const res = await PF.repo.exportEvidence(readAdapter(dir), scope, {
      tz, app: version, madeWith: 'command line', attachments: !opt.noAttachments, keepBytes: false, pool: false,
      cancelled: () => canceled,
      /* Marked for cleanup only once this process created it: a file already there is never touched. */
      begin: (name) => { const p = path.join(out, name + '.partial'); fd = fs.openSync(p, 'wx'); partial = p; },
      sink: (u8) => {
        const b = Buffer.from(u8.buffer, u8.byteOffset, u8.length);
        for (let off = 0; off < b.length;) { const n = fs.writeSync(fd, b, off, b.length - off); if (!(n > 0)) throw new Error('the disk accepted no more bytes'); off += n; }
      }
    });
    fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    let final = path.join(out, res.name);
    for (let n = 2; ; n++) {
      try { fs.linkSync(partial, final); break; } catch (e) {
        if (e.code === 'EEXIST') { final = path.join(out, res.name.replace(/(\.\w+)$/, ' (' + n + ')$1')); continue; }
        /* A disk without hard links: rename, after checking the name is free. */
        if (fs.existsSync(final)) { final = path.join(out, res.name.replace(/(\.\w+)$/, ' (' + n + ')$1')); continue; }
        fs.renameSync(partial, final); partial = null; break;
      }
    }
    if (partial) { fs.unlinkSync(partial); partial = null; }
    const col = res.col, lines = [];
    lines.push((col.status === 'partial' ? 'Made a PARTIAL evidence pack' : 'Made an evidence pack') + ' of ' + col.runs.length + ' run' + (col.runs.length === 1 ? '' : 's') + ' (' + col.files.length + ' original files, ' + size(res.bytes) + '): ' + final);
    lines.push('SHA-256 of this pack: ' + res.digest);
    lines.push('Keep it somewhere separate. Anyone checking the pack later compares it with the one you kept; the pack can\'t prove by itself that it hasn\'t changed.');
    if (col.status === 'partial') { lines.push('Partial, because:'); col.unresolved.forEach((u) => lines.push('  ' + u)); }
    if (col.exclusions.length) lines.push('Left out: ' + col.exclusions.length + ' file' + (col.exclusions.length === 1 ? '' : 's') + ', each with its reason in manifest.json.');
    lines.push(E.PRIVACY);
    lines.push('Days and times are in ' + tz + '.');
    return { out: lines.join('\n'), code: col.status === 'partial' ? EXIT.partial : 0 };
  } catch (e) {
    cleanup();
    if (e && e.cancelled) fail('export canceled. No pack was made.');
    throw e instanceof Refused ? e : new Refused(e && e.message || String(e));
  } finally {
    cleanup();
    process.removeListener('SIGINT', onSig); process.removeListener('SIGTERM', onSig);
  }
}

/* ---------- Reading for other apps: processes, process, runs, run, next, followups --json (docs/apps.md) ---------- */
const READS = ['processes', 'process', 'runs', 'run', 'next', 'followups'];
/* What one read takes in at most: a record past this is named (skipped), never read. */
const READ_MAX = 16 * 1048576;
/* Where each part of loadAll lives, for naming a part that couldn't be read. */
const PART_PATH = { people: 'people.json', drafts: 'maps/drafts/', publications: 'publications/', runs: 'runs/', legacy: 'runs/', skills: 'skills/', proposals: 'proposals/',
  'step types': 'step-types/', 'Jira workflows': 'jira/workflows.json', 'sign-offs': 'validations/', corrections: 'corrections/', 'follow-ups': 'followups/' };
const PROC_ID = /^[a-z0-9][a-z0-9-]{0,59}$/, RUN_KEY = /^([a-z0-9][a-z0-9-]{0,59})\/([a-z0-9-]{1,40})$/i;

function fileWhy(w) { return 'This file ' + String(w || 'couldn\'t be read') + '.'; }
/* A run this copy can only list by name: saved by a newer Flightdeck (its format, fields this copy doesn't know, or its own
   frozen checklist and step types using features this copy can't read). A run on a version that's only unusable here
   still reads; its version is named instead. */
function newerRun(PF, r) {
  const why = r._unrunnable || '';
  if (!why) return false;
  if (r.snapshot === '' || why.indexOf(PF.run.NEWER) === 0) return true;
  return why.indexOf(PF.publish.NEWER) === 0 && !!PF.publish.unrunnable(r.snapshot, r.types);
}
function runProblems(PF, r) {
  const out = [], key = r.process + '/' + r.id, dir = 'runs/' + key + '/';
  if (newerRun(PF, r)) out.push({ path: dir + 'run.json', kind: 'newer', why: '"' + r.title + '" (' + key + '): ' + r._unrunnable });
  /* Times sanitize couldn't read, and every other record it dropped, cut or replaced: one problem for the file, naming each. */
  const isNewer = newerRun(PF, r), bt = isNewer ? '' : badTimesWhy(r._badTimes), fixed = isNewer ? [] : (r._repairs || []).map((x) => x.at + ' (' + x.what + ')'), parts = [];
  if (bt) parts.push('Some times in this file couldn\'t be read (' + bt + ').');
  if (fixed.length) parts.push('Records this copy dropped or changed: ' + fixed.slice(0, 20).join(', ') + (fixed.length > 20 ? ', and ' + (fixed.length - 20) + ' more' : '') + '.');
  /* The safety net: anywhere else sanitize's result differs from the file (R.unexplained), not already named above. */
  const named = (r._repairs || []).map((x) => x.at).concat(Object.keys(r._badTimes || {}));
  const other = isNewer ? [] : (r._drift || []).filter((p) => !explained(p, named));
  if (other.length) parts.push('Other places this copy reads differently from the file: ' + other.slice(0, 20).join(', ') + (other.length > 20 ? ', and ' + (other.length - 20) + ' more' : '') + '.');
  if (parts.length) out.push({ path: dir + 'run.json', kind: 'malformed', why: parts.join(' ') + ' The run is shown as the app shows it, without them.' });
  if (r._conflicts && r._conflicts.length) out.push({ path: dir, kind: 'conflict', why: 'Conflict copies or lost saves beside this run: ' + r._conflicts.join(', ') + '. A person resolves them in the app.' });
  return out;
}
/* Whether a place where the file and what the app reads differ is already named: the same place, one inside the other, or
   another entry of the same list (dropping one entry shifts the rest). */
function explained(p, named) {
  const base = (x) => x.replace(/\[\d+\].*$/, '');
  return named.some((e) => p === e || p.startsWith(e + '.') || p.startsWith(e + '[') || e.startsWith(p + '.') || e.startsWith(p + '[') || (/\[/.test(p) && /\[/.test(e) && base(p) === base(e)));
}
/* A follow-up decision whose file says something cleanDecision doesn't keep as written (_drift, reading for other apps). */
function decisionDrift(d) {
  return d && d._drift && d._drift.length ? { path: 'followups/' + d.process + '/' + d._file, kind: 'malformed', why: 'This decision isn\'t read as written: ' + d._drift.slice(0, 20).join(', ') + '.' } : null;
}
/* Which times R.sanitize couldn't read (r._badTimes), in words, or ''. */
function badTimesWhy(b) {
  if (!b) return '';
  const names = { created: 'the start', ended: 'the end', pauses: 'an earlier pause', paused: 'the pause under way', log: 'a log entry' };
  return Object.keys(b).map((k) => (k === 'log' && Array.isArray(b.log) && b.log.length > 1 ? b.log.length + ' log entries' : names[k] || k)).join(', ');
}
/* One run, judged the same way by runs, run and next, so a summary never says other than the run itself: its version
   (pub: what readVersion or the version list found; a version that isn't in the folder reads as missing files, as
   readVersion finds it; null when the command doesn't read versions) decides why it's read-only, as the app decides it
   (unusable here, or changed since the run started: R's own reason comes first), then every problem of the run file
   and of that version. Sets r._unrunnable; returns the problems. */
function judgeRun(PF, r, pub) {
  /* A test run's version is its stage (2.1): staged/<process>/<stage>/, whose proposed number is the run's version. */
  const test = PF.run.isTest(r) && typeof r.folder === 'string' && PF.publish.STAGE.test(r.folder);
  const A = PF.appjson, out = [], valid = typeof r.folder === 'string' && (test || !!PF.publish.versionOf(r.folder)) && /^[a-z0-9][a-z0-9-]{0,59}$/.test(r.process);
  const dir = PF.run.pubDir(r);
  if (pub && valid && !pub._readFailed) {
    const info = pub.ok && test ? { folder: pub.info.folder, mapHash: pub.info.mapHash, version: pub.info.stage.proposed } : pub.info;
    const why = pub.unusable ? pub.why : pub.ok ? PF.repo.runMismatch(r, info) : '';
    if (why && !r._unrunnable) r._unrunnable = why;
    if (!pub.ok) { const x = A.pubProblem(pub); out.push({ path: dir, kind: x.kind, why: x.why }); }
    /* The version is fine; the run doesn't match it. Named at the run, so the version is never taken as unreadable. */
    else if (why) out.push({ path: 'runs/' + r.process + '/' + r.id + '/run.json', kind: 'unusable', why: 'This run doesn\'t match its version ' + r.folder + ' (its checklist or version number differs from the version\'s record), so the app opens it read-only.' });
  }
  return out.concat(runProblems(PF, r));
}
/* A version folder that isn't in the folder, as readVersion would find it: none of its files there. */
function missingVersion(PF, r) { const v = PF.publish.verify(r.folder, { 'map.md': null, 'types.json': null, 'publication.json': null }, null, PF.run.isTest(r) ? { stage: true } : null); v.folder = r.folder; v.process = r.process; return v; }
/* What's wrong with people.json as a people list, or '' (no file is fine: names are then null). */
function peopleWhy(p) {
  if (!p || p.hash == null) return '';
  const doc = p.doc;
  if (doc == null) return 'This file isn\'t complete JSON, so no names could be read.';
  const list = Array.isArray(doc) ? doc : typeof doc === 'object' && Array.isArray(doc.people) ? doc.people : null;
  if (!list) return 'This file isn\'t a people list, so no names could be read.';
 const bad = list.filter((x) => !(x && typeof x === 'object' && typeof x.id === 'string' && typeof x.name === 'string')).length;
  const long = list.filter((x) => x && typeof x.name === 'string' && x.name.length > 60).length;
  if (!bad && long) return 'This file has ' + long + ' ' + (long === 1 ? 'name' : 'names') + ' over 60 characters; they are cut to 60, as the app shows them.';
  return bad ? 'This file has ' + bad + ' ' + (bad === 1 ? 'entry' : 'entries') + ' without a text ID and name; those names are left null.' : '';
}
/* What a whole-folder read found beyond failed reads (which the ledger already holds): parts that failed, runs and plans
   that won't parse, versions that can't be used, newer runs and conflict copies, one per file or folder. */
function folderProblems(PF, d) {
  const A = PF.appjson, out = [];
  Object.keys(d.failed || {}).forEach((part) => out.push({ path: PART_PATH[part] || part, kind: 'unreadable', why: 'This part of the folder couldn\'t be read: ' + d.failed[part] + '.' }));
  (d.unreadable || []).forEach((u) => out.push({ path: u.path, kind: u.kind || 'unreadable', why: fileWhy(u.why) }));
  (d.nofile || []).forEach((n) => out.push({ path: n.path, kind: 'nofile', why: 'The run folder has no run.json.' }));
  (d.malformed || []).forEach((m) => out.push({ path: m.path, kind: m.kind || 'malformed', why: fileWhy(m.why) }));
  (d.fuUnread || []).forEach((u) => out.push({ path: 'followups/' + u.process + '/' + u._file, kind: u.kind === 'newer' ? 'newer' : 'malformed', why: u.kind === 'newer' ? u.why : 'This file couldn\'t be read, or isn\'t a follow-up decision this copy can read.' }));
  (d.corrUnread || []).forEach((u) => out.push({ path: u.dir + '/' + u.process + '/' + u._file, kind: u.kind === 'newer' ? 'newer' : 'malformed', why: u.kind === 'newer' ? u.why : 'This file couldn\'t be read, or isn\'t a decision this copy can read.' }));
  (d.processes || []).forEach((proc) => (proc.pubs || []).forEach((p) => { if (!p.ok && !p._readFailed) { const x = A.pubProblem(p); out.push({ path: 'publications/' + proc.process + '/' + p.folder + '/', kind: x.kind, why: x.why }); } }));
  (d.fuDecisions || []).forEach((x) => { const p = decisionDrift(x); if (p) out.push(p); });
  const pw = peopleWhy(d.people);
  if (pw) out.push({ path: 'people.json', kind: 'malformed', why: pw });
  /* 2.16: a parent's linked step whose child says Completed but doesn't stand as read (section 5.7.4). */
  (d.childMarks || []).forEach((m) => out.push({ path: 'runs/' + m.process + '/' + m.run + '/run.json', kind: 'child-mark', why: 'Step "' + m.step + '" was ' + m.text + '.' }));
  return out;
}
function adapterProblems(adapter) {
  return (adapter.links || []).map((p) => ({ path: p, kind: 'link', why: 'A link. Flightdeck never reads through links.' }))
    .concat((adapter.skipped || []).map((x) => ({ path: x.path, kind: 'skipped', why: 'Too large to read here (' + (x.more ? 'more than ' : '') + size(x.size) + '; the limit is ' + size(x.cap) + ').' })))
    .concat((adapter.vanished || []).map((p) => ({ path: p, kind: 'vanished', why: 'It was there a moment ago and was gone when it was read. Try again.' })));
}

/* What a whole-folder command's output depends on, as folders and files: its data, the publications that say whether a
   run or plan can be used and which version a plan starts on, and people.json for names. With --process, that process's
   part only (the plans are all read, since a plan's process is inside the file). */
function needs(req) {
  const sub = (top) => top + (req.proc ? '/' + req.proc : '');
  if (req.cmd === 'processes' || req.cmd === 'process') return [req.cmd === 'process' ? 'publications/' + req.proc : 'publications'].concat(req.stage ? ['staged/' + req.proc + '/' + req.stage] : []);
  if (req.cmd === 'runs') return [sub('runs'), 'proposals', sub('publications'), 'people.json'].concat(req.tests ? [sub('staged')] : []);
  return [sub('followups'), sub('runs'), 'people.json'].concat(req.proc ? [sub('publications'), 'proposals'] : []);
}
/* A view of the folder that holds only those paths (and the folders above them, listed to reach them). Anything else
   looks absent: it's never read, so it's never a problem and never part of the output. It sits above the ledger, so
   what it hides never reaches it. */
/* Whether a path is one of these, inside one, or a folder above one (listed to reach it). */
function covers(prefixes) { return (p) => { p = p || ''; return p === '' || prefixes.some((x) => p === x || p.startsWith(x + '/') || x.startsWith(p + '/')); }; }
/* What run and next depend on: the run's folder, its version once it's known, people.json, and that run's own follow-up
   decisions (the files named <run id>.*, not the other runs' in the same folder). */
function runCovers(proc, id, r) {
  const base = covers(['runs/' + proc + '/' + id, 'people.json'].concat(r && typeof r.folder === 'string' ? [(r.test === true ? 'staged/' : 'publications/') + r.process + '/' + r.folder] : []));
  return (p) => base(p) || p === 'followups' || p === 'followups/' + proc || p === 'followups/' + proc + '/' || String(p).startsWith('followups/' + proc + '/' + id + '.');
}
function dependsOn(fs, prefixes) {
  const ok = covers(prefixes);
  const v = {};
  if (fs.list) v.list = (p, o) => (ok(p) ? fs.list(p, o) : Promise.resolve([]));
  ['read', 'stat', 'blob'].forEach((m) => { if (fs[m]) v[m] = (p, o) => (ok(p) ? fs[m](p, o) : Promise.resolve(null)); });
  ['write', 'append', 'remove'].forEach((m) => { v[m] = (...a) => fs[m](...a); });
  return v;
}

/* eng: { PF, version } (loadEngine()). adapter: a folder with list, read, stat and blob (and links and skipped, as the
   command line's has); it's only ever read through PF.repo.readOnly, inside a problem ledger (PF.repo.ledger) that names
   every failed list or read, every listed file gone when read, and everything the loaders found malformed. req: { cmd,
   proc, key, version, folder, status, person, contract }. Resolves to { code, json }: an envelope (exit 0 or 4), whose
   problems are the ledger's within the command's scope (complete exactly when there are none), or an error object (exit 1
   or 5) carrying every problem the ledger holds. */
async function readData(eng, adapter, req) {
  const PF = eng.PF, A = PF.appjson, repo = PF.repo, F = PF.followups, app = eng.version || '';
  const L = repo.ledger(repo.readOnly(adapter, 'Reading for other apps'));
  const take = (list) => list.forEach((p) => L.note(p.path, p.kind, p.why));
  /* What the command depends on (set once the command is known): problems anywhere else, a link met while listing a
     folder above what it reads included, are never its problems. */
  let relevant = () => true;
  const ledger = () => { take(adapterProblems(adapter)); return L.problems().filter((p) => relevant(p.path)); };
  const two = +req.contract === 2;
  const err = (code, kind, why) => ({ code, json: A.failure(app, kind, why, ledger(), two ? 2 : 1) });
  const notFound = (why) => err(EXIT.notFound, 'not-found', why);
  if (req.contract != null && A.VERSIONS.indexOf(+req.contract) < 0) return err(EXIT.error, 'contract', 'This copy of Flightdeck reads contract ' + A.VERSIONS.join(', ') + ' only (' + A.VERSIONS.map(A.CONTRACT_OF).join(', ') + '). Ask for one of those, or update Flightdeck.');
  const done = (keep, data, readAt) => { const e = A.envelope(app, readAt || new Date().toISOString(), keep(ledger()), data, two ? 2 : 1); return { code: e.complete ? 0 : EXIT.partial, json: e }; };
  try {
    if (req.cmd === 'run' || req.cmd === 'next') {
      const m = RUN_KEY.exec(req.key || '');
      relevant = runCovers(m[1], m[2], null);
      const one = await repo.readRunOnly(L.fs, m[1], m[2]);
      if (!one.found) return notFound('There\'s no run ' + req.key + ' in the team folder.');
      /* Contract 1 shows what Flightdeck 1.x reads: a run/3 and a 2.0 version are named as newer. Contract 2 reads them. */
      if (!two) { one.run = A.v1Run(one.run); one.pub = A.v1Pub(one.pub); }
      const r = one.run, key = m[1] + '/' + m[2];
      if (one.nofile) L.note('runs/' + key + '/run.json', 'nofile', 'The run folder has no run.json.');
      take(one.bad.map((b) => ({ path: b.path, kind: b.kind || 'unreadable', why: fileWhy(b.why) })));
      take(one.fuUnread.map((u) => ({ path: u.path, kind: u.kind || 'malformed', why: u.kind === 'newer' ? u.why : fileWhy(u.why) })));
      one.fuDecisions.forEach((x) => { const p = decisionDrift(x); if (p) take([p]); });
      if (one.peopleWhy) L.note('people.json', one.peopleKind || 'unreadable', fileWhy(one.peopleWhy));
      const pw = peopleWhy(one.people);
      if (pw) L.note('people.json', 'malformed', pw);
      if (r) { relevant = runCovers(m[1], m[2], r); take(judgeRun(PF, r, one.pub)); }
      const usable = !!r && !newerRun(PF, r);
      /* run and next read only what they depend on (readRunOnly), so every problem met counts. */
      const keep = (list) => list, nameOf = A.names(one.people);
      /* Contract 2 lists a run/3's migration records, current and archived (history-*.jsonl): a failed read is a problem. */
      if (two && usable && r.format === PF.run.FORMAT3) {
        const h = await repo.loadHistory(L.fs, r).catch((e) => { L.note('runs/' + key + '/', 'unreadable', fileWhy(e && e.message || String(e))); return []; });
        take((h.refused || []).map((x) => ({ path: x.path, kind: x.kind === 'newer' ? 'newer' : 'malformed', why: x.why })));
        [...new Set(h.malformed || [])].forEach((p) => L.note(p, 'malformed', 'This file has lines that aren\'t archived records, so some of the run\'s history may be missing.'));
        /* An archived record is read only in its exact frozen shape (kind, av, then a migration record); any other is named. */
        const rmap = PF.run.mapOf(r), MK = ['path', 'at', 'from', 'source', 'verdict', 'result', 'resolved'];
        r._archivedMigrations = [];
        h.filter((x) => x.kind === 'migration').forEach((x) => {
          const m = {}; Object.keys(x).filter((k) => k !== 'kind' && k !== 'av').forEach((k) => { m[k] = x[k]; });
          if (Object.keys(x).slice(0, 2).join() === 'kind,av' && Object.keys(m).join() === MK.join() && PF.run.migrationOk(m, rmap, r)) r._archivedMigrations.push(m);
          else L.note(x._file || 'runs/' + key + '/', 'malformed', 'An archived migration record isn\'t one Flightdeck can read, so some of the run\'s history may be missing.');
        });
      }
      /* Module results (3.0): the linked runs of steps that accept results, read (never written) so contract 2 can say a step
         awaits its recorder's settlement. One that can't be read is just not reported as awaited. */
      const kids = {};
      if (two && usable && r.format === PF.run.FORMAT3) {
        const rmap = PF.run.mapOf(r);
        for (const sid of Object.keys(r.steps || {})) {
          const a = r.steps[sid], x = PF.map.findStep(rmap, sid);
          if (!a || !a.child || !x || !PF.run.acceptsOf(r, x.step)) continue;
          const kk = a.child.process + '/' + a.child.id;
          if (Object.prototype.hasOwnProperty.call(kids, kk)) continue;
          /* The linked run is read like the run itself: its folder and its version are what this output depends on. */
          const was = relevant, mine = covers(['runs/' + kk]);
          relevant = (p) => was(p) || mine(p);
          const c = await repo.readRunOnly(L.fs, a.child.process, a.child.id).catch((e) => { L.note('runs/' + kk + '/run.json', 'unreadable', fileWhy(e && e.message || String(e))); return null; });
          if (c && !c.found) L.note('runs/' + kk + '/run.json', 'nofile', 'The run linked to step "' + sid + '" isn\'t in the team folder (it may still be arriving, or it was deleted), so what it returned can\'t be read.');
          if (!c || !c.found) continue;
          take(c.bad.map((b) => ({ path: b.path, kind: b.kind || 'unreadable', why: fileWhy(b.why) })));
          if (c.nofile) L.note('runs/' + kk + '/run.json', 'nofile', 'The run folder has no run.json.');
          if (c.run && typeof c.run.folder === 'string') { const pub = covers([(c.run.test === true ? 'staged/' : 'publications/') + c.run.process + '/' + c.run.folder]), w2 = relevant; relevant = (p) => w2(p) || pub(p); take(judgeRun(PF, c.run, c.pub)); }
          if (c.run && !c.run._unrunnable) kids[kk] = c.run;
        }
      }
      if (req.cmd === 'run') return done(keep, usable ? (two ? (rr, it, nm) => A.run2(rr, it, nm, { kids }) : A.run)(r, F.list([r], one.fuDecisions), nameOf) : { run: null });
      return done(keep, usable ? (two ? (rr, nm, pp) => A.next2(rr, nm, pp, { kids }) : A.next)(r, nameOf, req.person || null) : { run: key, person: req.person ? nameOf(req.person) : null, next: null, mine: null });
    }
    /* Each command reads only what its output depends on (needs()), so every problem the ledger holds is one that output
       depends on, and all of them are reported: there's no scope to fall behind what's read. */
    relevant = covers(needs(req));
    const d = await repo.loadAll(dependsOn(L.fs, needs(req)), { readOnly: true, explain: true, deep: true, contract2: two });
    if (!two) { d.processes = A.v1Processes(d.processes); d.runs = d.runs.map(A.v1Run).filter(Boolean); }
    take(folderProblems(PF, d));
    /* Every run judged as run judges it, against its own version (runs reads the versions; followups doesn't need them). */
    /* Test runs (2.1, flightdeck-read/2 only): left out of runs unless --tests asks for them (D3), and then judged against their
       stage, read here as the app reads it. */
    const stages = {};
    if (two && req.cmd === 'runs' && req.tests) {
      const want = {};
      d.runs.forEach((r) => { if (PF.run.isTest(r) && PF.publish.STAGE.test(String(r.folder)) && PROC_ID.test(r.process)) want[r.process + '/' + r.folder] = r; });
      for (const k of Object.keys(want).sort()) {
        const r = want[k];
        stages[k] = await repo.readStage(L.fs, r.process, r.folder).catch((e) => ({ ok: false, why: fileWhy(e && e.message || String(e)), folder: r.folder, process: r.process, _readFailed: true }));
      }
    }
    const pubOf = (r) => {
      if (PF.run.isTest(r)) return stages[r.process + '/' + r.folder] || null;
      const proc = d.processes.filter((x) => x.process === r.process)[0], p = proc && proc.pubs.filter((x) => x.folder === r.folder)[0]; return p || missingVersion(PF, r);
    };
    const tested = (r) => !two || !!req.tests || !PF.run.isTest(r);
    d.runs.forEach((r) => { if (req.cmd !== 'runs' || tested(r)) take(judgeRun(PF, r, req.cmd === 'runs' ? pubOf(r) : null)); });
    const nameOf = A.names(d.people), runs = d.runs.filter((r) => !newerRun(PF, r)), all = (list) => list;
    const known = (p) => d.processes.some((x) => x.process === p) || d.runs.some((r) => r.process === p) || d.plans.some((x) => x.process === p);
    if (req.proc && !known(req.proc) && !req.stage) return notFound('There\'s no process ' + req.proc + ' in the team folder.');
    if (req.cmd === 'processes') return done(all, A.processes(d.processes), d.readAt);
    if (req.cmd === 'process') {
      const proc = d.processes.filter((x) => x.process === req.proc)[0];
      /* A staged version (2.1, --stage): its checklist as a test run would run it, read by the stage rules. */
      if (req.stage) {
        const st = await repo.readStage(L.fs, req.proc, req.stage).catch((e) => ({ ok: false, why: fileWhy(e && e.message || String(e)), _readFailed: true }));
        if (!st.ok && !st.info) return notFound('There\'s no staged version ' + req.stage + ' of ' + req.proc + ' in the team folder' + (st.why ? ' (' + st.why + ')' : '') + '.');
        if (!st.ok) take([{ path: 'staged/' + req.proc + '/' + req.stage + '/', kind: A.pubProblem(st).kind, why: st.why }]);
        st.stage = true; st.folder = req.stage;
        return done(all, A.process2(proc || { process: req.proc, pubs: [], index: { latest: null, clashes: [] } }, st), d.readAt);
      }
      if (!proc || !proc.pubs.length) return notFound('There\'s no published checklist for ' + req.proc + ' in the team folder.');
      let pub = null;
      const vOf = (p) => (p.info && typeof p.info.version === 'number' ? p.info.version : PF.publish.versionOf(p.folder));
      if (req.folder) pub = proc.pubs.filter((p) => p.folder === req.folder)[0];
      else if (req.version != null) pub = proc.pubs.filter((p) => vOf(p) === +req.version).sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0) || (a.folder < b.folder ? -1 : 1))[0];
      else pub = proc.index.latest || proc.pubs.slice().sort((a, b) => (vOf(b) || 0) - (vOf(a) || 0))[0];
      if (!pub) return notFound('There\'s no version ' + (req.folder || req.version) + ' of ' + req.proc + ' in the team folder.');
      return done(all, (two ? A.process2 : A.process)(proc, pub), d.readAt);
    }
    if (req.cmd === 'runs') {
      const st = req.status || 'all', mine = (p) => !req.proc || p === req.proc;
      const matching = runs.filter((r) => mine(r.process) && (st === 'all' || (st === 'running' && !r.ended) || (st === 'ended' && !!r.ended)));
      const list = matching.filter(tested), leftOut = two ? matching.length - list.length : 0;
      const plans = st === 'all' || st === 'planned' ? d.plans.filter((p) => mine(p.process)) : [];
      /* Which version a plan starts on is unknown (null), not missing, when any of its process's versions couldn't be read or
         verified: only problems with the versions themselves count (a run that doesn't match its version is named at the run). */
      const probs = ledger(), unsure = (proc) => probs.some((x) => ['', 'publications', 'publications/'].indexOf(x.path) >= 0 || x.path === 'publications/' + proc || x.path.indexOf('publications/' + proc + '/') === 0);
      return done(all, two ? A.runs2(list, plans, nameOf, d.processes, unsure, leftOut, d) : A.runs(list, plans, nameOf, d.processes, unsure, d), d.readAt);
    }
    /* followups: every run's follow-ups come from its run.json, so any run that couldn't be read may hide some. */
    const items = F.list(runs.filter((r) => !req.proc || r.process === req.proc), d.fuDecisions).filter((x) => req.status !== 'open' || F.isOpen(x));
    return done(all, (two ? A.followUps2 : A.followUps)(items, nameOf), d.readAt);
  } catch (e) {
    return err(EXIT.error, 'failed', 'The team folder couldn\'t be read: ' + (e && e.message || String(e)));
  }
}

/* The command line around readData: flags, the folder, the engine, and JSON out. Usage problems before any reading exit 1. */
async function readMain(argv) {
  const VAL = ['--process', '--status', '--person', '--version', '--folder', '--contract', '--stage'], val = {};
  const usage = (why) => ({ out: JSON.stringify(failureJson(null, 'usage', why), null, 2), code: EXIT.error });
  const args = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VAL.indexOf(argv[i - 1]) >= 0));
  const cmd = args[0], asJson = argv.includes('--json');
  for (const f of VAL) {
    const i = argv.indexOf(f);
    if (i < 0) continue;
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) { if (asJson) return usage('say what goes after ' + f + '.'); fail('say what goes after ' + f); }
    val[f] = argv[i + 1];
  }
  if (!asJson) fail(cmd + ' prints JSON for other apps. Add --json, for example: flightdeck ' + cmd + ' <team folder> --json');
  const req = { cmd, proc: val['--process'] || null, status: val['--status'] || null, person: val['--person'] || null, version: val['--version'] || null, folder: val['--folder'] || null, contract: val['--contract'] || null, stage: val['--stage'] || null, tests: argv.includes('--tests') };
  if (cmd === 'process') { req.proc = args[2]; if (!req.proc || !PROC_ID.test(req.proc)) return usage('say which process, for example: flightdeck process <team folder> release --json'); }
  if (cmd === 'run' || cmd === 'next') { req.key = args[2]; if (!req.key || !RUN_KEY.test(req.key)) return usage('say which run as <process>/<run id>, for example: flightdeck ' + cmd + ' <team folder> release/k3m9p2q8 --json'); }
  if (req.proc && !PROC_ID.test(req.proc)) return usage('a process ID is lowercase letters, numbers and dashes.');
  if (req.version != null && !/^\d{1,6}$/.test(req.version)) return usage('--version is a version number, like 3.');
  if (req.folder != null && !/^v\d+-[a-z0-9]+$/.test(req.folder)) return usage('--folder is a version folder, like v3-k3m9p2q8.');
  if (req.contract != null && !/^\d{1,4}$/.test(req.contract)) return usage('--contract is a contract number, like 1.');
  /* Test runs and stages (2.1) are flightdeck-read/2 only: contract 1 names a test run as newer, as 1.x did. */
  if (req.tests && (cmd !== 'runs' || +req.contract !== 2)) return usage('--tests works with runs and --contract 2.');
  if (req.stage != null && (cmd !== 'process' || +req.contract !== 2)) return usage('--stage works with process and --contract 2.');
  if (req.stage != null && !/^stage-[a-z0-9]{8}$/.test(req.stage)) return usage('--stage is a staged version\'s folder, like stage-k3m9p2q8.');
  if (req.stage != null && (req.version != null || req.folder != null)) return usage('--stage shows a staged version; leave out --version and --folder.');
  const statuses = cmd === 'runs' ? ['running', 'planned', 'ended', 'all'] : cmd === 'followups' ? ['open', 'all'] : null;
  if (req.status != null && (!statuses || statuses.indexOf(req.status) < 0)) return usage(statuses ? '--status is one of: ' + statuses.join(', ') + '.' : '--status works with runs and followups.');
  let eng, dir;
  try { eng = loadEngine(); dir = folderArg(args[1], cmd); }
  catch (e) { return { out: JSON.stringify(failureJson(eng, 'failed', e.message), null, 2), code: EXIT.error }; }
  try {
    const r = await readData(eng, readAdapter(dir, { maxBytes: READ_MAX }), req);
    return { out: JSON.stringify(r.json, null, 2), code: r.code };
  } catch (e) {
    return { out: JSON.stringify(failureJson(eng, 'failed', 'The team folder couldn\'t be read: ' + (e && e.message || String(e))), null, 2), code: EXIT.error };
  }
}
function failureJson(eng, kind, why) { return eng ? eng.PF.appjson.failure(eng.version, kind, why, []) : { contract: 'flightdeck-read/1', app: versionOf(app()) || '', error: { kind, why }, problems: [] }; }

/* ---------- Asking for a run: flightdeck plan request (docs/apps.md, docs/design.md section 26) ----------
   An app asks for a run by writing a planned run to proposals/, which a person reviews and starts in the app. It never starts
   a run and never writes run.json. The file's name comes from the tool and the key (PF.requests.idFor), and any request
   already under that name (or a OneDrive copy of it) is read and compared before anything is resolved, so a retry writes
   nothing. It reads the way the --json commands read (a problem ledger over a read-only view, READ's envelope and exit codes)
   and writes one file, once, in proposals/ only. */

/* Write proposals/<name> once, never replacing anything and never through a link: the text goes to a temporary file beside it
   (created exclusively), flushed, then hard-linked to the final name, which fails if the name is taken, so the final name only
   ever holds the whole text. A disk without hard links gets the final name created exclusively instead. The result is read
   back byte for byte. Resolves to 'written', or 'exists' when the name was taken first (by another request on this computer,
   or one OneDrive delivered). hooks.beforeLink: tests only, to land another write in the gap. Exclusive creation prevents
   replacing a file here; it can't stop two computers that aren't syncing from both writing (OneDrive then keeps both). */
function writeRequest(dir, name, text, hooks) {
  if (!/^req-[a-z0-9-]{1,60}\.json$/.test(name)) fail('refusing an unexpected request name: ' + name);
  return writeOnce(dir, ['proposals'], name, text, hooks);
}
/* The same, for any one folder of the team folder (parts): a report in reports/<process>/ too. */
function writeOnce(dir, parts, name, text, hooks) {
  const rel = parts.join('/') + '/';
  const home = folders(dir, parts, true), target = path.join(home, name), data = Buffer.from(text, 'utf8');
  const tmp = path.join(home, '.' + name + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
  const put = (fd) => { for (let off = 0; off < data.length;) { const n = fs.writeSync(fd, data, off, data.length - off); if (!(n > 0)) throw new Error('the disk accepted no more bytes'); off += n; } fs.fsyncSync(fd); };
  const EXCL = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
  let fd = null, mine = null;
  try {
    fd = fs.openSync(tmp, EXCL);
    mine = fs.fstatSync(fd);
    put(fd);
    fs.closeSync(fd); fd = null;
    folders(dir, parts, false);
    const now = lstatOrNull(tmp);
    if (!now || now.isSymbolicLink() || now.ino !== mine.ino || now.dev !== mine.dev) fail('refusing to write through a link: ' + home);
    if (hooks && hooks.beforeLink) hooks.beforeLink();
    try { fs.linkSync(tmp, target); }
    catch (e) {
      if (e.code === 'EEXIST') return 'exists';
      if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].indexOf(e.code) < 0) throw e;
      /* The temporary file already holds the whole text. The final name is created exclusively and filled; if that fails
         part way (a full disk), the file this process created is removed, checked to be the very file it opened. */
      let f2, made = null;
      try { f2 = fs.openSync(target, EXCL); } catch (e2) { if (e2.code === 'EEXIST' || e2.code === 'ELOOP') return 'exists'; throw e2; }
      try { made = fs.fstatSync(f2); put(f2); }
      catch (e3) {
        try { const left = lstatOrNull(target); if (made && left && !left.isSymbolicLink() && left.ino === made.ino && left.dev === made.dev) fs.unlinkSync(target); } catch (e4) { /* the error below says what happened */ }
        throw e3;
      } finally { fs.closeSync(f2); }
    }
    folders(dir, parts, false);
    const st = lstatOrNull(target);
    if (!st || st.isSymbolicLink() || !st.isFile()) fail('refusing to write through a link: ' + target);
    if (!fs.readFileSync(target).equals(data)) fail(rel + name + ' didn\'t read back the same after it was written. Check the team folder before trying again.');
    return 'written';
  } catch (e) {
    if (e instanceof Refused) throw e;
    fail('couldn\'t write ' + rel + name + ': ' + e.message);
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* already failing */ }
    /* The temporary file goes, if it's still the one this process made (the final name, once linked, keeps the bytes). */
    if (mine) { try { const left = lstatOrNull(tmp); if (left && !left.isSymbolicLink() && left.ino === mine.ino && left.dev === mine.dev) fs.unlinkSync(tmp); } catch (e) { /* the result says what happened */ } }
  }
}

/* eng: { PF, version }. adapter: the team folder (list, read, stat, blob), only ever read through PF.repo.readOnly inside a
   problem ledger, as the --json commands read it. req: { key, text (the request's JSON), dryRun, now }. write(name, text):
   writes proposals/<name> once (writeRequest), resolving 'written' or 'exists'; without it nothing is ever written. Resolves
   Nothing here ever removes a file. Resolves to { code, json }: READ's envelope (exit 0, or 4 when something it depends on couldn't be read, and then nothing is
   written) with data { request }, or an error object (exit 1: usage, invalid, key-taken, failed; exit 5: not-found). */
const PARTIAL_WHY = 'This file isn\'t complete JSON: it may still be arriving, or another request may still be writing it, so Flightdeck can\'t tell whether it\'s this request and never removes it. Nothing was written. Try again in a minute; if it stays this way, delete <file> only if no other request is still being written (docs/recovery.md, A request file is incomplete).';
async function requestData(eng, adapter, req, write) {
  const PF = eng.PF, A = PF.appjson, RQ = PF.requests, repo = PF.repo, app = eng.version || '';
  const L = repo.ledger(repo.readOnly(adapter, 'Checking a request'));
  const take = (list) => list.forEach((p) => L.note(p.path, p.kind, p.why));
  /* What the outcome depends on, which grows as it's read: this request's files in proposals/, then the process's versions
     and people.json. A problem anywhere else (another plan, another process) is never this request's problem. */
  const scope = [];
  let id = '';
  const relevant = (p) => p === '' || p === 'proposals' || p === 'proposals/' || (!!id && p.indexOf('proposals/' + id) === 0) ||
    scope.some((x) => p === x || p === x + '/' || p.indexOf(x + '/') === 0 || x.indexOf(p.replace(/\/$/, '') + '/') === 0);
  const ledger = () => { take(adapterProblems(adapter)); return L.problems().filter((p) => relevant(p.path)); };
  const err = (code, kind, why) => ({ code, json: A.failure(app, kind, why, ledger()) });
  const done = (file, status, plan, leftEmpty, runKey) => {
    /* Held always names what couldn't be read; one it can't name is a failure, never a silent success. */
    if (status === 'held' && !ledger().length) return err(EXIT.error, 'failed', 'Part of the team folder couldn\'t be read, so nothing was written. Try again.');
    const e = A.envelope(app, new Date().toISOString(), ledger(), A.request(id, file, status, plan, leftEmpty, runKey)); return { code: e.complete ? 0 : EXIT.partial, json: e }; };
  try {
    if (typeof req.key !== 'string' || !RQ.KEY.test(req.key)) return err(EXIT.error, 'usage', 'say which key with --key: lowercase letters, numbers, dots, dashes or underscores, at most 64 characters, like 2026-11.');
    if (Buffer.byteLength(String(req.text), 'utf8') > RQ.LIMITS.bytes) return err(EXIT.error, 'invalid', 'A request is at most 16 KB; this one is more.');
    let value;
    try { value = JSON.parse(String(req.text).replace(/^﻿/, '')); } catch (e) { return err(EXIT.error, 'invalid', 'The request isn\'t complete JSON: ' + e.message); }
    const c = RQ.clean(value, req.key);
    if (c.errors.length) {
      /* Every reason at once: when its process can be read, the checklist's own (details, roles, version) too. */
      let more = [];
      if (c.intent && c.intent.process) {
        const d = await repo.loadAll(dependsOn(repo.readOnly(adapter, 'Checking a request'), ['publications/' + c.intent.process]), { readOnly: true, explain: true, deep: true }).catch(() => null);
        const ck = d ? RQ.check(c.intent, d.processes.filter((x) => x.process === c.intent.process)[0]) : null;
        more = ck && ck.errors ? ck.errors : [];
      }
      return err(EXIT.error, 'invalid', c.errors.concat(more).join(' '));
    }
    const intent = c.intent, proc = intent.process;
    id = RQ.idFor(intent.producer.name, req.key);
    const file = 'proposals/' + id + '.json';

    /* 1. Any request already under this name, or a OneDrive copy of it, before anything is resolved. */
    const found = async () => {
      /* The request's own files (its name, OneDrive copies of it, and decisions on it), read with exactly the code READ
         uses (repo.readPlans), so a file READ calls malformed is malformed here too, and named. */
      const mine = (n) => RQ.isCopyName(n, id) || (n.indexOf(id + '.status-') === 0 && /\.json$/.test(n));
      const bad = [];
      let got;
      try { got = await repo.readPlans(L.fs, bad, mine); } catch (e) { return null; }
      bad.forEach((b) => L.note(b.path, b.kind || 'malformed', b.kind === 'malformed' && /complete JSON/.test(b.why) && RQ.isCopyName(b.path.slice('proposals/'.length), id) ? PARTIAL_WHY.replace('<file>', b.path) : fileWhy(b.why)));
      const copies = [], own = (p) => (p._file === id + '.json' ? 0 : 1);
      got.plans.filter((p) => RQ.isCopyName(p._file, id)).forEach((p) => {
        /* A file that looks like a copy of this name but holds another plan isn't this request, unless it has this very name. */
        if (p.id === id) copies.push(p);
        else if (own(p) === 0) L.note('proposals/' + p._file, 'malformed', 'This file has this request\'s name but holds another plan (' + String(p.id).slice(0, 120) + '). Nothing was written.');
      });
      copies.sort((a, b) => own(a) - own(b) || (a._file < b._file ? -1 : 1));
      return { copies, statuses: got.statuses.filter((x) => x.proposal === id) };
    };
    /* The roles of a plan whose person isn't active in people.json, which a retry reports again. */
    const peopleNow = async () => {
      if (scope.indexOf('people.json') < 0) scope.push('people.json');
      const d = await repo.loadAll(dependsOn(L.fs, ['people.json']), { readOnly: true, explain: true, deep: true });
      take(folderProblems(PF, d));
      return d.people;
    };
    const compare = async (there) => {
      const diffs = there.copies.map((x) => ({ name: x._file, d: RQ.differs(intent, x) })).filter((x) => x.d.length);
      if (diffs.length) return err(EXIT.error, 'key-taken', 'A request with that key is already in the folder with other details: ' + diffs.map((x) => 'proposals/' + x.name + ' (' + x.d.join(', ') + ')').join('; ') + '. Use another key for another request. Nothing was written.');
      const shown = repo.groupPlans(there.copies.map((x) => Object.assign({}, x)), there.statuses), st = shown.length === 1 ? shown[0]._status : null;
      const first = there.copies[0], left = RQ.leftEmpty(first.roles, await peopleNow());
      return done('proposals/' + first._file, 'already', first, left, st && st.status === 'accepted' && typeof st.run === 'string' ? proc + '/' + st.run : null);
    };
    const there = await found();
    /* A file under the request's name (or a copy's) that couldn't be read or isn't in the format: whether this request is
       there, and what it says, isn't known. A bad decision only leaves which run it started unknown. */
    const nameProblem = () => ledger().some((p) => p.path.indexOf('proposals/' + id) === 0 && p.path.indexOf('proposals/' + id + '.status-') !== 0);
    if (!there || nameProblem()) return done(file, 'held', null, [], null);
    if (there.copies.length) return compare(there);
    /* No request there, but something under its name or a decision on it couldn't be read or isn't in the format (or a link
       has its name): whether it's there isn't known, so nothing is written. */
    if (ledger().length) return done(file, 'held', null, [], null);

    /* 2. Nothing there: resolve what it asks for against the process's versions, check it, then write. */
    scope.push('publications/' + proc, 'people.json');
    const d = await repo.loadAll(dependsOn(L.fs, ['publications/' + proc, 'people.json']), { readOnly: true, explain: true, deep: true });
    take(folderProblems(PF, d));
    if (ledger().length) return done(file, 'held', null, [], null);
    const ck = RQ.check(intent, d.processes.filter((x) => x.process === proc)[0]);
    if (ck.notFound) return err(EXIT.notFound, 'not-found', ck.notFound);
    if (ck.errors) return err(EXIT.error, 'invalid', ck.errors.join(' '));
    const plan = RQ.build(intent, ck.pub, req.now || new Date().toISOString()), left = RQ.leftEmpty(plan.roles, d.people);
    if (req.dryRun || !write) return done(file, 'would-request', plan, left, null);
    let res;
    try { res = await write(id + '.json', RQ.text(plan)); } catch (e) { return err(EXIT.error, 'failed', e && e.message || String(e)); }
    if (res === 'written') return done(file, 'requested', plan, left, null);
    /* The name was taken between the check and the write: what's there now decides, exactly as on a retry. */
    const again = await found();
    if (!again || nameProblem() || !again.copies.length) return done(file, 'held', null, [], null);
    return compare(again);
  } catch (e) {
    return err(EXIT.error, 'failed', 'The team folder couldn\'t be read: ' + (e && e.message || String(e)));
  }
}

/* The request's bytes: from a file, or standard input with "-". At most limit bytes are taken in; more is refused (tooBig). */
function readRequestInput(arg, limit) {
  if (arg === '-') {
    return new Promise((res, rej) => {
      const chunks = [];
      let n = 0, over = false;
      process.stdin.on('data', (c) => { if (over) return; n += c.length; if (n > limit) { over = true; process.stdin.pause(); process.stdin.destroy(); return res({ tooBig: true }); } chunks.push(c); });
      process.stdin.on('end', () => { if (!over) res({ buf: Buffer.concat(chunks) }); });
      process.stdin.on('error', (e) => { if (!over) rej(e); });
    });
  }
  return new Promise((res) => {
    const fd = fs.openSync(expand(arg), 'r');
    try {
      const st = fs.fstatSync(fd);
      if (st.isFile() && st.size > limit) return res({ tooBig: true });
      const buf = Buffer.alloc(limit + 1);
      let got = 0;
      for (;;) { const k = fs.readSync(fd, buf, got, buf.length - got, null); if (!k) break; got += k; if (got > limit) return res({ tooBig: true }); }
      res({ buf: buf.subarray(0, got) });
    } finally { fs.closeSync(fd); }
  });
}
/* The words for plan request without --json. */
function requestWords(json) {
  if (json.error) return 'flightdeck: ' + json.error.why + json.problems.map((x) => '\n  ' + x.path + ': ' + x.why).join('');
  const r = json.data.request, p = r.plan, lines = [];
  const what = p ? '"' + p.title + '" (' + p.process + ' v' + p.version + ')' : '';
  if (r.status === 'requested') lines.push('Requested ' + what + ' in ' + r.file + '. A person starts it in Flightdeck; nothing starts by itself.');
  if (r.status === 'would-request') lines.push('Would request ' + what + ' in ' + r.file + '. Nothing was written (--dry-run).');
  if (r.status === 'already') lines.push('Already requested: ' + what + ' in ' + r.file + ', requested ' + p.created + '. Nothing was written.' + (r.run ? ' It was started as ' + r.run + '.' : ''));
  if (r.status === 'held') lines.push('Nothing was written, because part of what this request depends on couldn\'t be read. Try again once it can be read:');
  if (r.leftEmpty.length) lines.push('Left for the person who starts it (not active in people.json): ' + r.leftEmpty.join(', ') + '.');
  json.problems.forEach((x) => lines.push('  ' + x.path + ': ' + x.why));
  return lines.join('\n');
}
async function requestMain(argv) {
  const asJson = argv.includes('--json'), dryRun = argv.includes('--dry-run');
  const ki = argv.indexOf('--key'), key = ki >= 0 ? argv[ki + 1] : null;
  const args = argv.filter((a, i) => (!a.startsWith('--') || a === '-') && !(i > 0 && argv[i - 1] === '--key'));
  let eng = null;
  const out = (json, code) => ({ out: asJson ? JSON.stringify(json, null, 2) : requestWords(json), code });
  const usage = (why) => out(failureJson(eng, 'usage', why), EXIT.error);
  try { eng = loadEngine(); } catch (e) { return out(failureJson(null, 'failed', e.message), EXIT.error); }
  const RQ = eng.PF.requests;
  if (args[1] !== 'request') return usage('say what to do: flightdeck plan request <team folder> <request.json | -> --key <key>');
  if (!args[2] || !args[3] || args[4]) return usage('say the team folder and the request file, or - for standard input: flightdeck plan request <team folder> <request.json | -> --key <key>');
  if (ki < 0 || !key || key.startsWith('--')) return usage('say which key with --key, for example --key 2026-11. The same key always means the same request.');
  if (!RQ.KEY.test(key)) return usage('the key is lowercase letters, numbers, dots, dashes or underscores, at most 64 characters, starting with a letter or number, like 2026-11.');
  const unknown = argv.filter((a) => a.startsWith('--') && ['--json', '--dry-run', '--key'].indexOf(a) < 0);
  if (unknown.length) return usage('plan request doesn\'t take ' + unknown.join(', ') + '.');
  let dir;
  try { dir = folderArg(args[2], 'plan request'); } catch (e) { return out(failureJson(eng, 'failed', e.message), EXIT.error); }
  let input;
  try { input = await readRequestInput(args[3], RQ.LIMITS.bytes); } catch (e) { return usage('couldn\'t read the request ' + (args[3] === '-' ? 'from standard input' : args[3]) + ': ' + e.message); }
  if (input.tooBig) return out(failureJson(eng, 'invalid', 'A request is at most 16 KB; this one is more.'), EXIT.error);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(input.buf); } catch (e) { return out(failureJson(eng, 'invalid', 'The request isn\'t UTF-8 text.'), EXIT.error); }
  const r = await requestData(eng, readAdapter(dir, { maxBytes: READ_MAX }), { key, text, dryRun }, (name, t) => writeRequest(dir, name, t));
  return out(r.json, r.code);
}

/* ---------- Reports from other apps: flightdeck report targets | check | write (docs/apps.md, contract flightdeck-read/2)
   A tool that did a step's work writes a report: a claim a person accepts or declines in Flightdeck. These commands never
   write run.json and never decide; write puts one new file in reports/<process>/, once, and reads it back. They read the
   way the --json commands read (a problem ledger over a read-only view) and print READ's envelope under flightdeck-read/2. */
function randomReportId() { const a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = crypto.randomBytes(12); let o = ''; for (let i = 0; i < 12; i++) o += a[b[i] % 36]; return o; }
/* req: { cmd: 'check' | 'write' | 'targets', buf (the report's bytes), folder (false: check alone, no team folder), dryRun,
   strict, unmatchedOk, now, proc, key }. adapter: the team folder, or null for check alone. write(parts, name, text): writes
   reports/<process>/<name> once (writeOnce), resolving 'written' or 'exists'. Resolves to { code, json }. */
async function reportData(eng, adapter, req, write) {
  const PF = eng.PF, A = PF.appjson, X = PF.reports, repo = PF.repo, app = eng.version || '', C2 = A.CONTRACT2;
  const L = adapter ? repo.ledger(repo.readOnly(adapter, 'Checking a report')) : null;
  const take = (list) => list.forEach((p) => L.note(p.path, p.kind, p.why));
  let relevant = () => true;
  const ledger = () => { if (!L) return []; take(adapterProblems(adapter)); return L.problems().filter((p) => relevant(p.path)); };
  const err = (code, kind, why) => ({ code, json: A.failure(app, kind, why, ledger(), C2) });
  const done = (data) => { const e = A.envelope(app, new Date().toISOString(), ledger(), data, C2); return { code: e.complete ? 0 : EXIT.partial, json: e }; };
  try {
    if (req.cmd === 'targets') {
      const scope = ['runs' + (req.proc ? '/' + req.proc : ''), 'publications' + (req.proc ? '/' + req.proc : ''), 'people.json'];
      relevant = covers(scope);
      const d = await repo.loadAll(dependsOn(L.fs, scope), { readOnly: true, explain: true, deep: true });
      take(folderProblems(PF, d));
      const pubOf = (r) => { const proc = d.processes.filter((x) => x.process === r.process)[0], p = proc && proc.pubs.filter((x) => x.folder === r.folder)[0]; return p || missingVersion(PF, r); };
      /* A test run (2.1) is never a target: reports go to real runs. */
      const real = d.runs.filter((r) => !PF.run.isTest(r));
      real.forEach((r) => take(judgeRun(PF, r, pubOf(r))));
      let runs = real.filter((r) => !r._unrunnable && !r.ended && r.state === 'running' && (!req.proc || r.process === req.proc));
      if (req.key) {
        runs = runs.filter((r) => r.process + '/' + r.id === req.key);
        if (!runs.length) return err(EXIT.notFound, 'not-found', 'There\'s no running run ' + req.key + ' in the team folder.');
      }
      return done(A.targets(runs, A.names(d.people)));
    }
    if (req.buf.length > X.LIMITS.bytes) return err(EXIT.error, 'invalid', 'A report is at most 64 KB; this one is more.');
    const snap = X.snapshot(new Uint8Array(req.buf));
    if (snap.text === null) return err(EXIT.error, 'invalid', 'The report isn\'t UTF-8 text.');
    if (X.holdsKey(snap.text)) return err(EXIT.error, 'invalid', 'The report holds a private key. A report never needs one; nothing was written.');
    let o;
    try { o = JSON.parse(snap.text); } catch (e) { return err(EXIT.error, 'invalid', 'The report isn\'t complete JSON: ' + e.message); }
    /* id and created are filled when they're left out (check says so; write writes them). */
    let text = snap.text, filled = [];
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      if (!Object.prototype.hasOwnProperty.call(o, 'id')) { o.id = randomReportId(); filled.push('id'); }
      if (!Object.prototype.hasOwnProperty.call(o, 'created')) { o.created = req.now || new Date().toISOString(); filled.push('created'); }
      if (filled.length) text = X.text(o);
    }
    const pre = req.cmd === 'check' && filled.length ? ['No ' + filled.map((k) => '"' + k + '"').join(' or ') + ': report write fills ' + (filled.length === 1 ? 'it' : 'them') + ' in, so the file name and SHA-256 here are examples.'] : [];
    const withPre = (t) => (t ? Object.assign({}, t, { warnings: pre.concat(t.warnings) }) : { applies: null, warnings: pre });
    const rm = o && typeof o.run === 'string' ? /^([a-z0-9][a-z0-9-]{0,59})\/([a-z0-9-]{1,40})$/.exec(o.run) : null;
    const prod = o && o.producer && typeof o.producer === 'object' ? o.producer.name : null;
    const name = rm && typeof o.step === 'string' && typeof prod === 'string' && typeof o.id === 'string' ? X.fileName({ run: rm[2], step: o.step, producer: prod, id: o.id }) : null;
    const c = X.clean(text, rm ? rm[1] : null, name && X.parseName(name) ? name : null);
    if (!c.ok) return err(EXIT.error, 'invalid', (c.kind === 'newer' ? 'This report ' + c.why : 'This isn\'t a report Flightdeck can use: ' + c.errors.join('; ') + '.') + (req.cmd === 'write' ? ' Nothing was written.' : ''));
    const rep = c.report, file = X.DIR + '/' + rep.process + '/' + X.fileName({ run: rep.run, step: rep.step, producer: rep.producer.name, id: rep.id });
    /* The hash is always of the bytes written (a byte-order mark in the input isn't), so it's the one the app logs. */
    const bytes = Buffer.from(text, 'utf8'), sha = PF.sha256.hex(new Uint8Array(bytes));
    if (bytes.length > X.LIMITS.bytes) return err(EXIT.error, 'invalid', 'With id and created filled in, the report is more than 64 KB, so it couldn\'t be read. Nothing was written.');
    if (!adapter) return done(A.reportOut(file, sha, 'valid', rep, withPre(null)));

    /* Against the folder: the run, read alone (its folder, its version, people.json), as run --json reads it. */
    relevant = runCovers(rep.process, rep.run, null);
    const one = await repo.readRunOnly(L.fs, rep.process, rep.run);
    let t = null;
    if (!one.found) {
      /* Not listed isn't proof it's absent: with a problem met on the way (a link, a folder that can't be read), --unmatched-ok
         holds and nothing is written. */
      if (req.cmd === 'write' && req.unmatchedOk && ledger().length) return done(A.reportOut(file, null, 'held', rep, { applies: 'unknown', warnings: [] }));
      if (!(req.cmd === 'write' && req.unmatchedOk)) return err(EXIT.notFound, 'not-found', 'There\'s no run ' + rep.process + '/' + rep.run + ' in the team folder.' + (req.cmd === 'write' ? ' Nothing was written. If it hasn\'t synced here yet, add --unmatched-ok.' : ''));
      t = { errors: [], warnings: ['Run ' + rep.process + '/' + rep.run + ' isn\'t in the team folder yet; nobody can accept this report until it is.'], applies: 'unknown' };
    } else {
      const r = one.run;
      if (one.nofile) L.note('runs/' + rep.process + '/' + rep.run + '/run.json', 'nofile', 'The run folder has no run.json.');
      take(one.bad.map((b) => ({ path: b.path, kind: b.kind || 'unreadable', why: fileWhy(b.why) })));
      if (r) { relevant = runCovers(rep.process, rep.run, r); take(judgeRun(PF, r, one.pub)); }
      if (!r || r._unrunnable || ledger().length) {
        if (!ledger().length) L.note('runs/' + rep.process + '/' + rep.run + '/run.json', 'unreadable', 'This run can\'t be read here' + (r && r._unrunnable ? ': ' + r._unrunnable : '.'));
        return done(A.reportOut(file, null, 'held', rep, { applies: 'unknown', warnings: [] }));
      }
      t = X.target(rep, r, PF.run.mapOf(r));
      if (t.errors.length) return err(EXIT.error, 'invalid', t.errors.join(' ') + (req.cmd === 'write' ? ' Nothing was written.' : ''));
    }
    if (req.strict && t.warnings.length) return err(EXIT.error, 'invalid', 'With --strict, warnings refuse the report: ' + t.warnings.join(' ') + ' Nothing was written.');
    if (req.cmd === 'check') return done(A.reportOut(file, sha, 'valid', rep, withPre(t)));

    /* write: a report is written once. The same bytes already there are this report (a retry); anything else under its name
       is another report, and nothing is written. */
    relevant = (p) => runCovers(rep.process, rep.run, one.run)(p) || p === X.DIR || p === X.DIR + '/' + rep.process || p === file;
    const there = async () => {
      let f;
      try { f = await L.fs.blob(file, { maxBytes: X.LIMITS.bytes }); } catch (e) { L.note(file, e && e.skipped ? 'skipped' : 'unreadable', fileWhy(e && e.message)); return 'held'; }
      if (!f) return null;
      const got = Buffer.from(await f.arrayBuffer());
      return got.equals(bytes) ? 'same' : 'other';
    };
    const before = await there();
    if (before === 'held') return done(A.reportOut(file, null, 'held', rep, t));
    if (before === 'same') return done(A.reportOut(file, sha, 'already', rep, t));
    if (before === 'other') return err(EXIT.error, 'id-taken', file + ' is already in the team folder with other contents. Reports are written once: give this one another id. Nothing was written.');
    if (req.dryRun || !write) return done(A.reportOut(file, sha, 'would-write', rep, t));
    let res;
    try { res = await write([X.DIR, rep.process], file.split('/').pop(), text); } catch (e) { return err(EXIT.error, 'failed', e && e.message || String(e)); }
    if (res === 'written') return done(A.reportOut(file, sha, 'written', rep, t));
    const after = await there();
    if (after === 'same') return done(A.reportOut(file, sha, 'already', rep, t));
    if (after === 'held') return done(A.reportOut(file, null, 'held', rep, t));
    return err(EXIT.error, 'id-taken', file + ' was written by someone else first, with other contents. Give this report another id. Nothing was written.');
  } catch (e) {
    return err(EXIT.error, 'failed', 'The team folder couldn\'t be read: ' + (e && e.message || String(e)));
  }
}
/* The words for report check, write and targets without --json. */
function reportWords(json) {
  if (json.error) return 'flightdeck: ' + json.error.why + json.problems.map((x) => '\n  ' + x.path + ': ' + x.why).join('');
  const lines = [];
  if (json.data.runs) {
    if (!json.data.runs.length) lines.push('No running runs.');
    json.data.runs.forEach((r) => { lines.push(r.key + '  ' + r.title + ' (' + r.folder + ')'); r.steps.forEach((st) => lines.push('  ' + st.id + '  ' + st.text + (st.evidence.length ? '  evidence: ' + st.evidence.map((e) => e.name + (e.required ? '*' : '')).join(', ') : '') + (st.accepts ? '' : '  (' + st.why + ')'))); });
  } else {
    const r = json.data.report, say = { valid: 'Valid', written: 'Wrote', already: 'Already in the folder, nothing written:', 'would-write': 'Would write (--dry-run), nothing written:', held: 'Nothing was written, because part of what this report depends on couldn\'t be read:' };
    lines.push(say[r.status] + ' ' + r.file + (r.sha256 ? ' (sha256 ' + r.sha256 + ')' : ''));
    if (r.applies) lines.push('Applies to the run now: ' + r.applies + '.');
    r.warnings.forEach((w) => lines.push('Warning: ' + w));
  }
  json.problems.forEach((x) => lines.push('  ' + x.path + ': ' + x.why));
  return lines.join('\n');
}
async function reportMain(argv) {
  const asJson = argv.includes('--json'), VAL = ['--folder', '--process', '--run'], val = {};
  const args = argv.filter((a, i) => (!a.startsWith('--') || a === '-') && !(i > 0 && VAL.indexOf(argv[i - 1]) >= 0));
  let eng = null;
  const out = (json, code) => ({ out: asJson ? JSON.stringify(json, null, 2) : reportWords(json), code });
  const fj = (kind, why) => (eng ? eng.PF.appjson.failure(eng.version, kind, why, [], eng.PF.appjson.CONTRACT2) : { contract: 'flightdeck-read/2', app: versionOf(app()) || '', error: { kind, why }, problems: [] });
  const usage = (why) => out(fj('usage', why), EXIT.error);
  for (const f of VAL) { const i = argv.indexOf(f); if (i >= 0) { if (!argv[i + 1] || argv[i + 1].startsWith('--')) return usage('say what goes after ' + f + '.'); val[f] = argv[i + 1]; } }
  try { eng = loadEngine(); } catch (e) { return out(fj('failed', e.message), EXIT.error); }
  const sub = args[1], X = eng.PF.reports;
  const allowed = { targets: ['--json', '--process', '--run'], check: ['--json', '--folder'], write: ['--json', '--dry-run', '--strict', '--unmatched-ok'] };
  if (!allowed[sub]) return usage('say what to do: flightdeck report targets <team folder>, report check <report.json | -> [--folder <team folder>], or report write <team folder> <report.json | ->');
  const unknown = argv.filter((a) => a.startsWith('--') && allowed[sub].indexOf(a) < 0);
  if (unknown.length) return usage('report ' + sub + ' doesn\'t take ' + unknown.join(', ') + '.');
  if (sub === 'targets') {
    if (!args[2] || args[3]) return usage('say the team folder: flightdeck report targets <team folder> [--process <process>] [--run <process>/<run id>]');
    if (val['--process'] && !PROC_ID.test(val['--process'])) return usage('a process ID is lowercase letters, numbers and dashes.');
    if (val['--run'] && !/^[a-z0-9][a-z0-9-]{0,59}\/[a-z0-9-]{1,40}$/.test(val['--run'])) return usage('--run is a run key, <process>/<run id>, like release/k3m9p2q8.');
    let dir;
    try { dir = folderArg(args[2], 'report targets'); } catch (e) { return out(fj('failed', e.message), EXIT.error); }
    const r = await reportData(eng, readAdapter(dir, { maxBytes: READ_MAX }), { cmd: 'targets', proc: val['--process'] || null, key: val['--run'] || null });
    return out(r.json, r.code);
  }
  const fileArg = sub === 'check' ? args[2] : args[3], folderIn = sub === 'check' ? val['--folder'] : args[2];
  if (!fileArg || (sub === 'check' ? args[3] : !args[2] || args[4])) return usage(sub === 'check' ? 'say the report file, or - for standard input: flightdeck report check <report.json | -> [--folder <team folder>]' : 'say the team folder and the report file, or - for standard input: flightdeck report write <team folder> <report.json | ->');
  let dir = null;
  if (folderIn) { try { dir = folderArg(folderIn, 'report ' + sub); } catch (e) { return out(fj('failed', e.message), EXIT.error); } }
  let input;
  try { input = await readRequestInput(fileArg, X.LIMITS.bytes); } catch (e) { return usage('couldn\'t read the report ' + (fileArg === '-' ? 'from standard input' : fileArg) + ': ' + e.message); }
  if (input.tooBig) return out(fj('invalid', 'A report is at most 64 KB; this one is more.'), EXIT.error);
  const r = await reportData(eng, dir ? readAdapter(dir, { maxBytes: READ_MAX }) : null, { cmd: sub, buf: input.buf, dryRun: argv.includes('--dry-run'), strict: argv.includes('--strict'), unmatchedOk: argv.includes('--unmatched-ok') },
    (parts, name, t) => writeOnce(dir, parts, name, t));
  return out(r.json, r.code);
}

/* ---------- Writing drafts for AI assistants: flightdeck draft read | save | propose (contract flightdeck-draft/1) ----------
   These commands change the team folder, and only ever write maps/drafts/<process>.md (a direct save), one new
   proposed/<process>/<operation>.json and one new history/drafts/<process>/agent-<operation>.jsonl, all through folders()
   (never through a link, never outside the folder). A draft open in an editor this computer can see is never written: the
   change becomes a proposal a person applies in Flightdeck. docs/apps.md, docs/design.md section 27. */
/* ---------- Registering a skill: flightdeck skill register <team folder> --from <file | -> [--json] (contract flightdeck-skill/1)
   The only writer of skill-registrations/ (2.0): a new revision file for the exact version a skill was built from, created
   once and read back; then the skill's legacy skills/<name>.json, if any, becomes a tombstone every older copy refuses to
   match. A version that can't be matched exactly (missing, another folder with the same number, a clash, damaged) is
   refused and nothing is written. docs/apps.md. */
const SKILL_CONTRACT = 'flightdeck-skill/1';
async function skillMain(argv) {
  const asJson = argv.includes('--json'), fi = argv.indexOf('--from'), from = fi >= 0 ? argv[fi + 1] : null;
  const args = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--from'));
  let eng = null;
  const out = (o, code) => {
    const json = Object.assign({ contract: SKILL_CONTRACT, app: eng ? eng.version : versionOf(app()) || '' }, o);
    return { out: asJson ? JSON.stringify(json, null, 2) : o.error ? 'flightdeck: ' + o.error.why : 'Registered ' + o.registered.name + ' ' + o.registered.version + ' (revision ' + o.registered.rev + ') at ' + o.registered.path + (o.tombstone ? '\nReplaced ' + o.tombstone + ' with a pointer to it.' : ''), code };
  };
  const refuse = (kind, why) => out({ error: { kind, why } }, EXIT.error);
  if (args[1] !== 'register') return refuse('usage', 'say what to do: flightdeck skill register <team folder> --from <registration.json | -> --json');
  if (!args[2] || args[3]) return refuse('usage', 'say the team folder: flightdeck skill register <team folder> --from <registration.json | -> --json');
  if (fi < 0 || !from || (from.startsWith('--') && from !== '-')) return refuse('usage', 'say which file with --from, or --from - for standard input.');
  const unknown = argv.filter((a) => a.startsWith('--') && ['--json', '--from'].indexOf(a) < 0);
  if (unknown.length) return refuse('usage', 'skill register doesn\'t take ' + unknown.join(', ') + '.');
  try { eng = loadEngine(); } catch (e) { return refuse('failed', e.message); }
  const PF = eng.PF;
  let dir;
  try { dir = folderArg(args[2], 'skill register'); } catch (e) { return refuse('failed', e.message); }
  let input;
  try { input = await readRequestInput(from, 65536); } catch (e) { return refuse('usage', 'couldn\'t read ' + (from === '-' ? 'standard input' : from) + ': ' + e.message); }
  if (input.tooBig) return refuse('invalid', 'A registration is at most 64 KB; this one is more.');
  let o;
  try { o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.buf)); } catch (e) { return refuse('invalid', 'The registration isn\'t JSON in UTF-8.'); }
  const rfs = readAdapter(dir, { maxBytes: READ_MAX }), name = o && typeof o.name === 'string' ? o.name : '';
  const proc = o && o.implements && typeof o.implements.process === 'string' ? await PF.repo.readProcess(rfs, o.implements.process) : null;
  const okName = /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(name), lfile = 'skills/' + name + '.json';
  const regs = okName ? await PF.repo.loadRegistrations(rfs) : [];
  /* The skill's legacy file, read as the app reads it: missing is absent; one that can't be read (an I/O error) is
     unreadable, never absent. */
  let legacyText = null, legacy = null;
  if (okName) {
    try { legacyText = readInside(dir, ['skills', name + '.json']); }
    catch (e) { legacy = { skill: null, errors: [lfile + ': couldn\'t be read (' + (e.code || e.message) + ')'], file: name + '.json', unreadable: true }; }
    if (legacyText != null) {
      let checked = null;
      try { checked = PF.skills.check(JSON.parse(legacyText), lfile); } catch (e) { checked = null; }
      legacy = checked ? Object.assign(checked, { file: name + '.json' }) : { skill: null, errors: [lfile + ': isn\'t valid JSON'], file: name + '.json' };
    }
  }
  /* The one verdict for the name (PF.skills.resolve), from that file and every revision filed under the name, readable or
     not: anything it can't read, or two revisions at one rev, is refused before anything is written. */
  /* What the listings couldn't show for the name holds it, as in the app (PF.skills.held): skills/ that can't be listed, or
     whose file for the name is past the files a copy reads, stands in for the file read here. */
  const listed = okName ? await PF.repo.loadLegacySkills(rfs).then(null, (e) => Object.assign([], { unlisted: 'skills/ couldn\'t be listed (' + (e && (e.code || e.message)) + ').' })) : [];
  const held = okName ? PF.skills.held(listed, regs, name) : { legacy: [], revs: [] };
  /* Every file that speaks for the name, as the app groups them (PF.skills.legacyFor, revisionsFor): its own file, and any
     that records it under another file name. The file read above is in that list, so one recording another name holds it. */
  const others = PF.skills.legacyFor(listed, name).filter((x) => (x.file || '').toLowerCase() !== (name + '.json').toLowerCase());
  const legacyIn = held.legacy.length ? held.legacy : others.concat(legacy ? [legacy] : []);
  const verdict = okName ? PF.skills.resolve(name, legacyIn, PF.skills.revisionsFor(regs, name).concat(held.revs)) : null;
  const said = verdict ? { name: verdict.name, status: verdict.status, source: verdict.source, rev: verdict.rev, kinds: verdict.kinds, blocks: verdict.blocks } : null;
  const no = (kind, why) => out({ verdict: said, error: { kind, why } }, EXIT.error);
  if (verdict && verdict.blocks) return no('invalid', 'Can\'t register ' + name + ': ' + verdict.reasons.join(' ') + ' Nothing was written.');
  const got = PF.skills.registration(o, proc, verdict && verdict.top ? { skill: verdict.top.skill } : null, { app: eng.version, now: new Date().toISOString(), by: 'flightdeck skill register', window: 'cli-' + crypto.randomBytes(4).toString('hex'), rand: crypto.randomBytes(8).toString('hex').replace(/[^a-z0-9]/g, '') });
  if (got.why) return no('invalid', got.why);
  const was = legacy;
  const text = JSON.stringify(got.rec, null, 2) + '\n';
  try { writeNew(dir, got.path.split('/'), text); } catch (e) { return no('failed', e.message); }
  /* Read it back through the same reader the app uses: what's there must be this registration, exactly. */
  const back = (await PF.repo.loadRegistrations(readAdapter(dir, { maxBytes: READ_MAX }), { name: got.rec.name })).filter((x) => x.file === got.path)[0];
  const sha = crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  if (!back || !back.skill || back.skill.sha !== sha) return no('failed', got.path + ' didn\'t read back as written' + (back && back.errors.length ? ': ' + back.errors.join('; ') : '') + '.');
  let tomb = null;
  if (legacyText != null) {
    if (!(was.tombstone && was.id === got.rec.id)) {
      try { safeWrite(dir, ['skills', name + '.json'], JSON.stringify(PF.skills.tombstone(got.rec), null, 2) + '\n', legacyText); tomb = 'skills/' + name + '.json'; }
      catch (e) { return out({ verdict: said, registered: { path: got.path, name: got.rec.name, version: got.rec.version, id: got.rec.id, rev: got.rec.rev, implements: got.rec.implements, sha }, tombstone: null, error: { kind: 'failed', why: 'Registered at ' + got.path + ', but skills/' + name + '.json changed or couldn\'t be replaced (' + e.message + '). Run the command again to replace it with a pointer.' } }, EXIT.error); }
    }
  }
  return out({ verdict: said, registered: { path: got.path, name: got.rec.name, version: got.rec.version, id: got.rec.id, rev: got.rec.rev, implements: got.rec.implements, sha }, tombstone: tomb }, 0);
}
const DRAFT_CONTRACT = 'flightdeck-draft/1';
/* Test hooks around the final compare of a direct save (test/cli.test.js injects a write there). */
const _hooks = {};
function draftJson(eng, o) { return Object.assign({ contract: DRAFT_CONTRACT, app: eng ? eng.version : versionOf(app()) || '' }, o); }
function draftFail(eng, kind, why, code, problems) { return { out: JSON.stringify(draftJson(eng, { error: { kind, why }, problems: problems || [] }), null, 2), code: code || EXIT.error }; }
/* A text an assistant hands over: at most the draft limit in UTF-8 bytes (the app's own constant), decoded strictly. */
function inputText(PF, file, what) {
  let buf;
  try { buf = file === '-' ? fs.readFileSync(0) : fs.readFileSync(expand(file)); } catch (e) { return { why: 'couldn\'t read ' + what + ' (' + e.message + ').' }; }
  if (buf.length > PF.util.DRAFT_BYTES) return { why: what + ' is ' + buf.length + ' bytes; a draft is at most ' + PF.util.DRAFT_BYTES + ' bytes (1 MB) of UTF-8.' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf) }; } catch (e) { return { why: what + ' isn\'t valid UTF-8 text.' }; }
}
/* Who has the draft open, as this computer's copy of the folder shows now. A record that can't be read, or a presence/ that
   can't be listed, counts as open: the safe outcome is a proposal. */
function presenceNow(PF, dir, proc, now) {
  const PP = PF.proposals, at = path.join(dir, PP.PRESENCE), out = { open: false, openIn: [] };
  let st;
  try { st = fs.lstatSync(at); } catch (e) { if (e.code === 'ENOENT') return out; out.open = true; return out; }
  if (st.isSymbolicLink() || !st.isDirectory()) { out.open = true; return out; }
  let names;
  try { names = fs.readdirSync(at, { withFileTypes: true }); } catch (e) { out.open = true; return out; }
  names.forEach((e) => {
    if (!/\.json$/i.test(e.name)) return;
    if (!e.isFile()) { out.open = true; return; }
    let rec = null;
    try { const t = fs.readFileSync(path.join(at, e.name)); if (t.length <= 65536) rec = PP.cleanPresence(JSON.parse(t.toString('utf8')), e.name); } catch (err) { rec = null; }
    if (!rec) { out.open = true; return; }
    if (rec.drafts.indexOf(proc) < 0 || !PP.freshCli(rec, now)) return;
    out.open = true;
    out.openIn.push({ by: rec.by, device: rec.device, seenAgo: Math.max(0, now - Date.parse(rec.at)) });
  });
  return out;
}
/* Everything a draft command looks at, read-only: the draft (and other drafts that say the same process), this process's
   proposals with their records (this session's read whole), its published versions, and people.json. */
async function draftState(eng, dir, proc, session) {
  const PF = eng.PF, PP = PF.proposals, ra = readAdapter(dir, { maxBytes: READ_MAX }), L = PF.repo.ledger(ra), rfs = L.fs, sha = PP.sha;
  const dpath = 'maps/drafts/' + proc + '.md', draft = { exists: false, path: dpath, rev: null, text: null };
  try {
    const f = await rfs.read(dpath, { maxBytes: PF.util.DRAFT_BYTES });
    if (f) Object.assign(draft, { exists: true, rev: sha(f.text), text: f.text });
    /* Gone between seeing it and opening it: there, but unread (named), so nothing takes it as absent. */
    else if ((ra.vanished || []).indexOf(dpath) >= 0) { draft.exists = true; L.note(dpath, 'vanished', 'It was there a moment ago and was gone when it was read. Try again.'); }
  } catch (e) { draft.exists = true; }
  const copies = [];
  try {
    for (const i of await rfs.list('maps/drafts')) {
      if (i.kind !== 'file' || !/\.md$/i.test(i.name) || i.name === proc + '.md') continue;
      let said = '';
      try { const f = await rfs.read('maps/drafts/' + i.name, { maxBytes: PF.util.DRAFT_BYTES }); said = f ? PP.textProcess(f.text) : ''; } catch (e) { said = ''; }
      if (said === proc) copies.push(i.name);
    }
  } catch (e) { /* named in the ledger */ }
  const got = await PF.repo.loadProposed(rfs, {}, true), pr = got.procs[proc] || { all: [], bad: [], records: [] };
  pr.bad.forEach((b) => L.note(b.path, 'malformed', b.why));
  const recs = {}; pr.all.forEach((m) => { recs[m.id] = []; });
  pr.records.forEach((r) => { const m = /^(p-[a-z0-9]{1,12}-[a-z0-9]{10})\./.exec(r.name); if (m && recs[m[1]]) recs[m[1]].push(r); });
  const judged = PP.judge(pr.all, recs, { exists: draft.exists && draft.text != null, rev: draft.rev });
  const mine = [];
  for (const x of judged.filter((y) => y.meta.session === session)) {
    const full = await PF.repo.readProposal(rfs, proc, x.id);
    if (!full.ok) continue;
    const status = x.fit === 'replaced' || x.fit === 'invalid' ? x.fit : x.rec.state;
    mine.push({ id: x.id, rev: x.meta.rev, status, text: full.proposal.text, at: x.meta.at, base: full.proposal.base, pending: status === 'pending' });
  }
  const versions = [];
  try {
    for (const v of await rfs.list('publications/' + proc)) {
      if (v.kind !== 'dir' || !PF.publish.versionOf(v.name)) continue;
      const f = await rfs.read('publications/' + proc + '/' + v.name + '/map.md');
      if (f) versions.push({ folder: v.name, version: PF.publish.versionOf(v.name), rev: sha(f.text), text: f.text });
    }
  } catch (e) { /* named in the ledger */ }
  versions.sort((a, b) => b.version - a.version);
  let people = null;
  try { const f = await rfs.read('people.json'); people = f ? PF.people.clean(JSON.parse(f.text)) : null; } catch (e) { people = null; }
  return { draft, copies, mine, versions, people, judged, problems: L.problems(), presence: presenceNow(PF, dir, proc, Date.now()) };
}
/* Write a new file once: created exclusively (never over a file that's there, never through a link), flushed, read back. */
function writeNew(dir, parts, text) {
  const home = folders(dir, parts.slice(0, -1), true), target = path.join(home, parts[parts.length - 1]), data = Buffer.from(text, 'utf8');
  let fd = null;
  try {
    fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0));
    for (let off = 0; off < data.length;) { const n = fs.writeSync(fd, data, off, data.length - off); if (!(n > 0)) throw new Error('the disk accepted no more bytes'); off += n; }
    fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
  } catch (e) {
    if (fd !== null) try { fs.closeSync(fd); } catch (err) { /* already failing */ }
    if (e instanceof Refused) throw e;
    fail('couldn\'t write ' + target + ': ' + e.message);
  }
  folders(dir, parts.slice(0, -1), false);
  if (!fs.readFileSync(target).equals(data)) fail(target + ' didn\'t read back as written');
  return parts.join('/');
}
/* Everything the Publish dialog checks a draft's text against, read now through one problem ledger over a read-only view of
   the folder, with the app's own readers: people.json, the team's step types, jira/workflows.json, every process's published
   versions (which are published, the children linked steps start, the parents that start this one), the team values a
   linked step names and the screenshots the text shows. Then PF.publish.checkContext and publishCheck, as the app's checks.
   What couldn't be read (or a newer Flightdeck wrote) is a problem, which makes the answer partial, and that part is left
   unchecked: it never becomes a blocker, a missing person or an unpublished process. Returns { verdict, problems }. */
async function draftInputs(eng, dir, text) {
  const PF = eng.PF, ra = readAdapter(dir, { maxBytes: READ_MAX }), L = PF.repo.ledger(PF.repo.readOnly(ra, 'Checking a draft'));
  /* The ledger's problems and the adapter's (links, files too big, files that vanished), each once. */
  const everything = () => { const out = L.problems(), seen = {}; out.forEach((x) => { seen[x.path + '\u0000' + x.kind] = true; }); adapterProblems(ra).forEach((x) => { if (!seen[x.path + '\u0000' + x.kind]) out.push(x); }); return out; };
  /* A failure that stops the read at any stage (the team folder can't be listed) still names every problem met before it. */
  try { return await readInputs(eng, text, ra, L, everything); } catch (e) { if (e && typeof e === 'object') e.problems = everything(); throw e; }
}
async function readInputs(eng, text, ra, L, everything) {
  const PF = eng.PF, repo = PF.repo, M = PF.map, rfs = L.fs;
  const map = M.parse(text), failedAt = (p) => L.problems().some((x) => x.path === p || x.path.indexOf(p + '/') === 0);
  /* The app's own loader, limited to these parts: what each part's reader gives, or the part named in failed. */
  const deps = [PF.people.FILE, 'step-types', 'jira/workflows.json', 'publications'];
  const d = await repo.loadAll(dependsOn(rfs, deps), { readOnly: true, explain: true, deep: true });
  const failed = d.failed || {};
  /* First every read, with what each loader refused noted in the ledger; then the adapter's own problems (links, files too
     big); then PF.publish.unknownOf decides what's unknown from that whole list, and nothing else does. */
  const PARTS = { people: PF.people.FILE, 'step types': 'step-types', 'Jira workflows': 'jira/workflows.json', publications: 'publications' };
  Object.keys(PARTS).forEach((k) => { if (k in failed && !failedAt(PARTS[k])) L.note(PARTS[k], /newer/.test(failed[k]) ? 'newer' : 'unreadable', failed[k]); });
  const people = 'people' in failed ? null : d.people;
  if (people && people.text != null && people.doc == null) L.note(PF.people.FILE, 'malformed', PF.people.FILE + ' isn\'t valid JSON.');
  const types = 'step types' in failed ? {} : d.stepTypes.types;
  if (!('step types' in failed)) {
    (d.stepTypes.refused || []).forEach((r) => L.note(r.path, 'newer', r.why));
  }
  /* What a loader left out over its limit, from its own read (PF.publish.excludedOf): each named, and unknown below. */
  PF.publish.excludedOf({ stepTypes: 'step types' in failed ? null : d.stepTypes, jira: 'Jira workflows' in failed ? null : d.jira }).forEach((x) => L.note(x.path, x.kind, x.why));
  const processes = 'publications' in failed ? [] : d.processes.map((p) => {
    /* A version that read but can't be used is named as READ names one; a failed read the ledger already has. */
    p.pubs.filter((x) => !x.ok && !x._readFailed).forEach((x) => { const k = PF.appjson.pubProblem(x); L.note('publications/' + p.process + '/' + x.folder + '/', k.kind, k.why); });
    return { id: p.process, latest: p.index.latest, all: p.index.all, clashes: p.index.clashes, broken: p.pubs.filter((x) => !x.ok) };
  });
  /* Team values (2.9), read only for a text that passes one or has a Jira search (its address), as publishing reads them. */
  let teamValues;
  if (PF.publish.teamValuesUsed(map)) {
    teamValues = await repo.readTeamValues(rfs);
    if (teamValues.state !== 'ok' && teamValues.state !== 'missing' && !failedAt(PF.teamValues.FILE)) L.note(PF.teamValues.FILE, teamValues.state, teamValues.why || PF.teamValues.FILE + ' couldn\'t be read.');
  }
  /* Screenshots, read to the last byte as publishing reads them: one that isn't there is a blocker. */
  const shots = M.shotSources(map), missingShots = [];
  for (const src of shots) {
    try { const b = await rfs.blob(src); if (!b) missingShots.push(src); else await b.arrayBuffer(); } catch (e) { if (!failedAt(src)) L.note(src, 'unreadable', src + ' couldn\'t be read: ' + (e && e.message || String(e))); }
  }
  /* Only what the text uses counts: a problem with an input it doesn't use (a team-values.json link and no team: value)
     leaves the answer complete. */
  const used = PF.publish.usesOf(map), problems = everything().filter((x) => PF.publish.uses(used, x, shots));
  const ctx = PF.publish.checkContext({ people, types, workflows: d.jira ? d.jira.workflows : null, processes, teamValues, missingShots, unknown: PF.publish.unknownOf(problems, shots) });
  /* Design tips (3.0): advice from the text, and the searches and gates published checklists already have. What couldn't be
     read under publications/ is said in the tips and in library.complete, never read as "no other checklist has it". */
  const unread = 'publications' in failed ? [{ process: null, path: 'publications/', why: failed.publications }]
    : problems.filter((x) => /^publications\//.test(x.path)).map((x) => ({ process: x.path.split('/')[1] || null, path: x.path, why: x.why }));
  const lib = PF.library.inspect(PF.library.entriesOf({ processes: 'publications' in failed ? [] : d.processes }), unread);
  const design = { tips: PF.library.lints(text, { library: lib, process: map.meta.process }), library: { complete: lib.completeness.complete, note: lib.completeness.note } };
  return { verdict: PF.publish.publishCheck(text, ctx), problems, design };
}
/* flightdeck draft check <team folder> <process> [--from <file | ->] --json (2.13): the verdict the Publish dialog gives the
   draft in maps/drafts/ (or the text given with --from), from the folder as it is now (draftInputs). Read-only; prints
   flightdeck-read/2 with SCHEMA2.draftCheck: exit 0, 4 when part of the folder couldn't be read, 5 when there's no draft,
   1 for a usage problem or a draft that can't be read. */
async function draftCheck(argv) {
  const VAL = ['--from'], args = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VAL.indexOf(argv[i - 1]) >= 0));
  let eng = null;
  const C2 = 2, appOf = () => (eng ? eng.version : versionOf(app()) || '');
  const failOut = (kind, why, problems, code) => { const F = eng ? eng.PF.appjson : null, json = F ? F.failure(appOf(), kind, why, problems || [], C2) : { contract: 'flightdeck-read/2', app: appOf(), error: { kind, why }, problems: [] }; return { out: JSON.stringify(json, null, 2), code: code || EXIT.error }; };
  const usage = (why) => failOut('usage', why);
  const fi = argv.indexOf('--from'), from = fi >= 0 ? argv[fi + 1] : null;
  if (fi >= 0 && (from == null || (from.startsWith('--') && from !== '-'))) return usage('say what goes after --from.');
  const unknown = argv.filter((a) => a.startsWith('--') && ['--json', '--from'].indexOf(a) < 0);
  if (unknown.length) return usage('draft check doesn\'t take ' + unknown.join(', ') + '.');
  if (!argv.includes('--json')) return usage('flightdeck draft prints JSON. Add --json.');
  const proc = args[3];
  if (!args[2] || !proc || args[4] || !PROC_ID.test(proc)) return usage('say the team folder and a process ID (lowercase letters, numbers and dashes), for example: flightdeck draft check <team folder> release --json');
  let dir;
  try { eng = loadEngine(); dir = folderArg(args[2], 'draft check'); } catch (e) { return failOut('failed', e.message); }
  const PF = eng.PF, A = PF.appjson;
  let text, said;
  if (from != null) {
    const input = inputText(PF, from, 'the text');
    if (input.why) return usage(input.why);
    if (PF.proposals.textProcess(input.text) !== proc) return usage('the text\'s process: line must say ' + proc + '.');
    text = input.text; said = { kind: 'file', ref: null };
  } else {
    const ra = readAdapter(dir, { maxBytes: READ_MAX }), L = PF.repo.ledger(PF.repo.readOnly(ra, 'Checking a draft')), dpath = 'maps/drafts/' + proc + '.md';
    let f = null;
    try { f = await L.fs.read(dpath, { maxBytes: PF.util.DRAFT_BYTES }); } catch (e) { return failOut('failed', dpath + ' couldn\'t be read, so nothing was checked. Try again.', L.problems().concat(adapterProblems(ra))); }
    /* A draft that was there a moment ago and gone when opened is unknown, never "no draft". */
    if (!f && (ra.vanished || []).indexOf(dpath) >= 0) return failOut('failed', dpath + ' was gone when it was read, so nothing was checked. Try again.', L.problems().concat(adapterProblems(ra)));
    if (!f) return failOut('not-found', 'There\'s no draft for "' + proc + '" in this folder (' + dpath + '). Pass the text to check with --from.', [], EXIT.notFound);
    text = f.text; said = { kind: 'draft', ref: dpath };
  }
  try {
    const got = await draftInputs(eng, dir, text);
    const data = { process: proc, from: { kind: said.kind, ref: said.ref, rev: PF.proposals.sha(text) }, checks: got.verdict.checks, publish: got.verdict.publish, design: got.design };
    const e = A.envelope(eng.version, new Date().toISOString(), got.problems, data, C2);
    return { out: JSON.stringify(e, null, 2), code: e.complete ? 0 : EXIT.partial };
  } catch (e) {
    return failOut('failed', e instanceof Refused ? e.message : 'The team folder couldn\'t be read: ' + (e && e.message || String(e)), e && e.problems);
  }
}
/* flightdeck library inspect <team folder> [--process <id>] --json (3.0): every checklist, normalized (PF.library.inspect):
   the latest usable version of each process and any draft that differs from it, what links to what, the team step types
   each uses, skill coverage, and candidates that look alike across checklists, each with its reason. Read-only; prints
   flightdeck-read/2 with SCHEMA2.library. What couldn't be read is a problem (exit 4) and in completeness.unread, never
   "nothing similar". With --process, only what concerns that process: its checklists, the links to and from it, the
   overlaps it's in and the step types it uses. */
async function libraryMain(argv) {
  const VAL = ['--process'], args = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VAL.indexOf(argv[i - 1]) >= 0));
  let eng = null;
  const C2 = 2, appOf = () => (eng ? eng.version : versionOf(app()) || '');
  const failOut = (kind, why, problems, code) => { const F = eng ? eng.PF.appjson : null, json = F ? F.failure(appOf(), kind, why, problems || [], C2) : { contract: 'flightdeck-read/2', app: appOf(), error: { kind, why }, problems: [] }; return { out: JSON.stringify(json, null, 2), code: code || EXIT.error }; };
  const usage = (why) => failOut('usage', why);
  const pi = argv.indexOf('--process'), proc = pi >= 0 ? argv[pi + 1] : null;
  if (pi >= 0 && (!proc || proc.startsWith('--') || !PROC_ID.test(proc))) return usage('say which process after --process (lowercase letters, numbers and dashes).');
  const unknown = argv.filter((a) => a.startsWith('--') && ['--json', '--process'].indexOf(a) < 0);
  if (unknown.length) return usage('library inspect doesn\'t take ' + unknown.join(', ') + '.');
  if (!argv.includes('--json')) return usage('flightdeck library prints JSON. Add --json.');
  if (args[1] !== 'inspect' || !args[2] || args[3]) return usage('say the team folder, for example: flightdeck library inspect <team folder> --json');
  let dir;
  try { eng = loadEngine(); dir = folderArg(args[2], 'library inspect'); } catch (e) { return failOut('failed', e.message); }
  const PF = eng.PF, A = PF.appjson, ra = readAdapter(dir, { maxBytes: READ_MAX }), L = PF.repo.ledger(PF.repo.readOnly(ra, 'Reading the library'));
  const everything = () => { const out = L.problems(), seen = {}; out.forEach((x) => { seen[x.path + '\u0000' + x.kind] = true; }); adapterProblems(ra).forEach((x) => { if (!seen[x.path + '\u0000' + x.kind]) out.push(x); }); return out; };
  try {
    const d = await PF.repo.loadAll(dependsOn(L.fs, ['publications', 'maps/drafts', 'step-types', 'skills', 'skill-registrations']), { readOnly: true, explain: true, deep: true, registrations: true });
    const failed = d.failed || {};
    const PARTS = { drafts: 'maps/drafts', publications: 'publications', 'step types': 'step-types', skills: 'skills' };
    Object.keys(PARTS).forEach((k) => { if (k in failed && !L.problems().some((x) => x.path === PARTS[k] || x.path.indexOf(PARTS[k] + '/') === 0)) L.note(PARTS[k], /newer/.test(failed[k]) ? 'newer' : 'unreadable', failed[k]); });
    (d.processes || []).forEach((p) => p.pubs.filter((x) => !x.ok && !x._readFailed).forEach((x) => { const k = A.pubProblem(x); L.note('publications/' + p.process + '/' + x.folder + '/', k.kind, k.why); }));
    /* A draft too big or that failed to read is named, never left out as if the process had no draft. */
    (d.unreadable || []).forEach((x) => { if (x && x.draft && !L.problems().some((y) => y.path === x.path)) L.note(x.path, 'unreadable', x.path + ' ' + x.why + '.'); });
    const entries = PF.library.entriesOf(d);
    /* Step types: a file that can't be used, one from a newer Flightdeck, and each past the 100 read, as draft check names them. */
    if (!('step types' in failed)) {
      ((d.stepTypes || {}).errors || []).forEach((x) => { const at = 'step-types/' + x.file; if (!L.problems().some((y) => y.path === at)) L.note(at, 'malformed', at + ': ' + x.errors.join('; ') + '.'); });
      ((d.stepTypes || {}).refused || []).forEach((r) => L.note(r.path, 'newer', r.why));
      PF.publish.excludedOf({ stepTypes: d.stepTypes }).forEach((x) => L.note(x.path, x.kind, x.why));
    }
    /* Versions that clash at the top leave a checklist out (PF.library.inspect says so too). */
    entries.forEach((e) => {
      const top = e.latest && e.latest.info ? +e.latest.info.version || 0 : 0, clash = (e.clashes || []).filter((n) => n >= top);
      if (clash.length) L.note('publications/' + e.id + '/', 'conflict', 'More than one version is numbered v' + clash[0] + ', so which one new runs use can\'t be told.');
    });
    /* A draft with a line it doesn't understand is read as far as it goes (PF.library.inspect) and named here. */
    entries.forEach((e) => {
      if (!e.draft || !(e.draftChanged || !e.latest)) return;
      const errs = PF.map.parse(e.draft.md).errors, at = 'maps/drafts/' + e.draft.file;
      if (errs.length && !L.problems().some((x) => x.path === at)) L.note(at, 'malformed', at + ' line ' + errs[0].line + ': ' + errs[0].msg + (errs.length > 1 ? ' (and ' + (errs.length - 1) + ' more)' : ''));
    });
    /* Skill registrations that couldn't be read: a file, or a skill with a revision that can't be (no revision is current). */
    (d.skills || []).forEach((x) => {
      if (!(x.errors || []).length || !x.file || (x.skill && !x.refused)) return;
      const at = x.refused && x.name ? 'skill-registrations/' + x.name + '/' : /^skill(s|-registrations)\//.test(x.file) ? x.file : 'skills/' + x.file;
      if (!L.problems().some((y) => y.path === at)) L.note(at, x.newer ? 'newer' : 'unreadable', x.errors[0]);
    });
    const problems = everything();
    const unread = problems.filter((x) => /^(publications|maps\/drafts|step-types|skills|skill-registrations)(\/|$)/.test(x.path))
      .map((x) => ({ process: /^publications\//.test(x.path) ? x.path.split('/')[1] || null : /^maps\/drafts\//.test(x.path) ? (entries.filter((e) => e.draft && 'maps/drafts/' + e.draft.file === x.path)[0] || {}).id || null : null, path: x.path, why: x.why }));
    if (proc && !entries.some((e) => e.id === proc) && !unread.length) return failOut('not-found', 'There\'s no checklist "' + proc + '" in the team folder, published or drafted.', problems, EXIT.notFound);
    let lib = PF.library.inspect(entries, unread, { types: (d.stepTypes || {}).types || {} });
    if (proc) {
      const linked = lib.checklists.filter((c) => c.process === proc);
      lib = { checklists: linked, usedBy: lib.usedBy.filter((e) => e.process === proc || e.by.process === proc),
        overlaps: lib.overlaps.filter((o) => o.items.some((x) => x.process === proc)),
        stepTypes: lib.stepTypes.filter((t) => t.usedBy.some((u) => u.process === proc)), completeness: lib.completeness };
    }
    const e = A.envelope(eng.version, new Date().toISOString(), problems, lib, C2);
    return { out: JSON.stringify(e, null, 2), code: e.complete ? 0 : EXIT.partial };
  } catch (e) {
    return failOut('failed', e instanceof Refused ? e.message : 'The team folder couldn\'t be read: ' + (e && e.message || String(e)), everything());
  }
}
async function draftMain(argv) {
  const VAL = ['--session', '--expect', '--from', '--base', '--label', '--by', '--note'], val = {};
  const args = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VAL.indexOf(argv[i - 1]) >= 0));
  const sub = args[1], usage = (why) => draftFail(null, 'usage', why);
  if (sub === 'check') return draftCheck(argv);
  for (const f of VAL) {
    const i = argv.indexOf(f);
    if (i < 0) continue;
    if (argv[i + 1] == null || (argv[i + 1].startsWith('--') && argv[i + 1] !== '-')) return usage('say what goes after ' + f + '.');
    val[f] = argv[i + 1];
  }
  if (['read', 'save', 'propose'].indexOf(sub) < 0) return usage('say read, save, propose or check, for example: flightdeck draft read <team folder> <process> --json');
  if (!argv.includes('--json')) return usage('flightdeck draft prints JSON. Add --json.');
  const proc = args[3];
  if (!proc || !PROC_ID.test(proc)) return usage('a process ID is lowercase letters, numbers and dashes, for example: flightdeck draft ' + sub + ' <team folder> release --json');
  if (val['--session'] != null && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(val['--session'])) return usage('--session is lowercase letters, numbers and dashes, like the one draft read gave.');
  let eng, dir;
  try { eng = loadEngine(); dir = folderArg(args[2], 'draft ' + sub); } catch (e) { return draftFail(eng, 'failed', e.message); }
  const PF = eng.PF, PP = PF.proposals, U = PF.util, M = PF.map, now = Date.now();
  const session = val['--session'] || 's-' + U.randomId(12);
  /* The same checks the app shows, on the folder as it is now (draftInputs), through the same functions. */
  const checksOf = async (t) => { const got = await draftInputs(eng, dir, t); return { checks: got.verdict.checks, publish: got.verdict.publish, problems: got.problems }; };
  /* Every problem once: the draft's reads, then the children's. */
  const merged = (a, b) => { const seen = {}, out = []; a.concat(b).forEach((p) => { const k = p.path + '\u0000' + p.kind; if (!seen[k]) { seen[k] = true; out.push(p); } }); return out; };
  try {
    if (sub === 'read') {
      const s = await draftState(eng, dir, proc, session);
      if (!s.draft.exists && !s.versions.length && !s.judged.length) return draftFail(eng, 'not-found', 'There\'s no draft, published version or proposal for "' + proc + '" in this folder.', EXIT.notFound, s.problems);
      const pending = s.mine.filter((m) => m.pending).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
      const latest = argv.includes('--or-latest') && !s.draft.exists ? s.versions[0] : null;
      const cf = pending ? { rev: pending.rev, kind: 'proposal', ref: pending.id, text: pending.text }
        : s.draft.exists && s.draft.text != null ? { rev: s.draft.rev, kind: 'draft', ref: s.draft.path, text: s.draft.text }
          : latest ? { rev: latest.rev, kind: 'version', ref: latest.folder, text: latest.text } : { rev: PP.sha(''), kind: 'none', ref: null, text: '' };
      /* The draft is there but couldn't be read, and nothing else continues it: its text is unknown, so nothing is checked. */
      const unread = !pending && s.draft.exists && s.draft.text == null;
      const ck = unread ? { checks: { blockers: [], suggestions: [], blockerSteps: [], suggestionSteps: [] }, problems: [] } : await checksOf(cf.text), problems = merged(s.problems, ck.problems);
      const out = draftJson(eng, { process: proc, session, draft: s.draft, openIn: s.presence.openIn, mine: s.mine.map((m) => ({ id: m.id, rev: m.rev, status: m.status, text: m.text })),
        continueFrom: cf, checks: ck.checks, copies: s.copies, readAt: new Date(now).toISOString(), complete: problems.length === 0, problems });
      return { out: JSON.stringify(out, null, 2), code: out.complete ? 0 : EXIT.partial };
    }
    /* save and propose: the input and every flag are checked before anything is read or written. */
    if (!val['--expect'] || !(val['--expect'] === 'none' || PP.SHA.test(val['--expect']))) return usage('--expect is the rev you read (a SHA-256 from draft read), or none for a new draft.');
    if (!val['--from']) return usage('say where the new text is: --from <file>, or --from - to read it from standard input.');
    if (val['--label'] != null && !/^[A-Za-z0-9-]{1,40}$/.test(val['--label'])) return usage('--label is letters, numbers and dashes, up to 40.');
    if (val['--note'] != null && val['--note'].length > 200) return usage('--note is at most 200 characters.');
    const input = inputText(PF, val['--from'], 'the new text');
    if (input.why) return usage(input.why);
    const text = input.text;
    if (PP.textProcess(text) !== proc) return usage('the new text\'s process: line must say ' + proc + '.');
    let baseText = null;
    if (val['--base'] != null) { const b = inputText(PF, val['--base'], 'the --base text'); if (b.why) return usage(b.why); baseText = b.text; }
    const s = await draftState(eng, dir, proc, session);
    if (val['--by'] != null && !(s.people || []).some((p) => p.id === val['--by'])) return usage('--by names a person in people.json, like person-avery.');
    const base = PP.baseFor({ expect: val['--expect'], draft: s.draft, mine: s.mine, versions: s.versions, baseText, afterEarlier: argv.includes('--after-earlier') });
    if (base.missing) return draftFail(eng, 'missing-base', 'The text you started from isn\'t the draft, one of this session\'s proposals or a published version any more. Pass the text you read with --base, or read the draft again.');
    const operation = PP.newId(now, U.randomId(10)), at = new Date(now).toISOString();
    const result = { process: proc, session, operation, outcome: null, why: null, link: base.link, rev: PP.sha(text), file: null, ids: PP.ids(base.text, text), checks: null, warnings: [], history: null, complete: true, problems: [] };
    const ck = await checksOf(text), problems = merged(s.problems, ck.problems);
    Object.assign(result, { checks: ck.checks, complete: problems.length === 0, problems });
    if (result.ids.removed.length) result.warnings.push('This removes step or phase IDs: ' + result.ids.removed.join(', ') + '. Runs and skills that name them will need a look.');
    let why = sub === 'propose' ? 'asked' : s.presence.open ? 'open' : null;
    const draftNow = s.draft.exists ? s.draft.text : null, expectText = base.kind === 'none' || base.kind === 'version' ? null : base.text;
    if (!why && draftNow !== expectText) why = 'changed';
    if (!why) {
      try {
        if (_hooks.beforeCompare || _hooks.afterCompare) safeWrite.hooks = _hooks;
        safeWrite(dir, ['maps', 'drafts', proc + '.md'], text, expectText);
        Object.assign(result, { outcome: 'written', file: 'maps/drafts/' + proc + '.md' });
      } catch (e) { if (!(e instanceof Changed)) throw e; why = 'changed'; }
      finally { delete safeWrite.hooks; }
      if (result.outcome === 'written') {
        try {
          const hdir = 'history/drafts/' + proc, before = expectText == null ? null : U.hash(expectText);
          let seen = null;
          if (before) { const h = await PF.repo.loadEditHistory(readAdapter(dir, { maxBytes: READ_MAX }), hdir, before); const e = h.items.filter((x) => x.entry && x.entry.to === before)[0]; seen = e ? e.entry.id : null; }
          const line = PF.timeline.histLine({ kind: 'draft-edit', id: operation, process: proc, writer: operation, seq: 1, by: val['--by'] || '', at, from: before, to: U.hash(text), seen,
            before: expectText == null ? '' : expectText, after: text, source: 'agent', units: [val['--note'] || 'Changed by your AI assistant'], items: [] });
          writeNew(dir, ['history', 'drafts', proc, 'agent-' + operation + '.jsonl'], JSON.stringify(line) + '\n');
          result.history = { written: true };
        } catch (e) { result.history = { written: false, why: e.message }; }
        /* It continued from this session's own pending proposal: that one is replaced by what was just written, so a
           decision says so (written once, named for this operation) and nothing offers it again. */
        if (base.replaces) {
          try {
            const set = await PF.repo.loadProposalSet(readAdapter(dir, { maxBytes: READ_MAX }), proc), st = PP.recState(set.records[base.replaces] || []);
            const old = s.mine.filter((m) => m.id === base.replaces)[0];
            const d = PP.decision({ proposal: base.replaces, proposalRev: old ? old.rev : null, writer: operation, decisionRev: st.nextRev, seen: st.seen, status: 'replaced', settles: st.open, result: { rev: PP.sha(text) }, by: val['--by'] || '', at });
            writeNew(dir, [PP.DIR, proc, d.name], JSON.stringify(d.rec, null, 2) + '\n');
          } catch (e) { result.warnings.push('Your earlier proposal ' + base.replaces + ' couldn\'t be marked as replaced (' + e.message + '). Decline it on the process page.'); }
        }
        return { out: JSON.stringify(draftJson(eng, result), null, 2), code: 0 };
      }
    }
    /* A proposal: write-once, holding its own base text, its SHA-256s and its link, measured before it's written. */
    const rec = PP.make({ id: operation, process: proc, session, label: val['--label'] || '', by: val['--by'] || '', at, app: eng.version || '', base: { kind: base.kind, ref: base.ref, text: base.text }, text, replaces: base.replaces, after: base.after, note: val['--note'] || '' });
    const json = JSON.stringify(rec, null, 2) + '\n';
    if (Buffer.byteLength(json) > PP.FILE_MAX) return draftFail(eng, 'too-big', 'This proposal would be ' + size(Buffer.byteLength(json)) + ' as a file, over the 4 MB a proposal can be. Nothing was written.');
    result.file = writeNew(dir, [PP.DIR, proc, operation + '.json'], json);
    Object.assign(result, { outcome: 'proposed', why });
    return { out: JSON.stringify(draftJson(eng, result), null, 2), code: 0 };
  } catch (e) {
    return draftFail(eng, 'failed', e instanceof Refused ? e.message : 'The team folder couldn\'t be changed: ' + (e && e.message || String(e)), EXIT.error, e && e.problems);
  }
}

/* ---------- flightdeck type list | read | save (2.14): step types through a checked write ----------
   type save compares the exact bytes it read (SHA-256), writes a complete temporary file beside the target, checks the
   folder allows hard links, compares again (bytes, then the path still names that file, then a final listing for copies),
   commits with one link (a new type) or one rename (a change), reads it back and records one history line. Like two
   Flightdeck windows in different browsers, two saves at the same instant can replace one another without either being
   told. It writes nothing but step-types/<id>.json, one history line and its own temporary files. */
const WRITE_CONTRACT = 'flightdeck-write/1';
const TYPE_INPUT_MAX = 262144, TYPE_READ_CAP = 1048576;
const NO_LINKS = ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'];
const BIG = { bigint: true };
/* A test hook (FD._hooks), when one is set; its promise is awaited only where the caller awaits it. */
function hook(name, ...a) { const h = _hooks[name]; return h ? h(...a) : undefined; }
const thenable = (p) => !!p && typeof p.then === 'function';
const errText = (e) => (e && e.code ? e.code + (e.message && e.message.indexOf(e.code) < 0 ? ': ' + e.message : '') : (e && e.message) || String(e));
function lstatBig(p) { try { return fs.lstatSync(p, BIG); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
const sameNode = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameMeta = (a, b) => sameNode(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const relOf = (dir, full) => path.relative(dir, full).split(path.sep).join('/');
/* One bounded read through a descriptor: opened without following a link or blocking (a FIFO swapped in can't hang it),
   checked at once to be the regular file lstat saw (st), read in a loop into at most limit bytes, then stat'ed again (the
   snapshot). opts.cap refuses a bigger file before reading. Every descriptor is closed; a close error is a failure too. */
function readThrough(full, phase, limit, st, opts) {
  hook('beforeOpen', full, phase);
  let fd;
  try { fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)); }
  catch (e) { return { fail: e.code === 'ENOENT' ? 'gone' : e.code === 'ELOOP' ? 'link' : 'error', why: errText(e), code: e.code || null }; }
  let res;
  try {
    const first = fs.fstatSync(fd, BIG);
    if (!first.isFile()) res = { fail: 'notfile', why: 'it isn\'t a regular file' };
    else if (!sameNode(first, st)) res = { fail: 'moved', why: 'it was replaced as it was opened' };
    else if (opts && opts.cap && first.size > BigInt(opts.cap)) res = { fail: 'oversized', size: Number(first.size) };
    else {
      const buf = Buffer.alloc(limit);
      let total = 0;
      while (total < limit) { const n = fs.readSync(fd, buf, total, limit - total, total); if (!n) break; total += n; hook('readChunk', full, phase, total); }
      res = { first, snap: fs.fstatSync(fd, BIG), bytes: buf.subarray(0, total), filled: total >= limit };
    }
  } catch (e) { res = { fail: 'error', why: errText(e), code: e.code || null }; }
  try { fs.closeSync(fd); } catch (e) { if (!res.fail) res = { fail: 'close', why: 'couldn\'t close ' + full + ' (' + errText(e) + ')' }; }
  return res;
}
/* A file read whole, up to the read cap, with the path checked again after the read: { state: 'bytes', bytes } or missing,
   link (a link or non-file at the path), unreadable, oversized or vanished, each with why. retry reads once more when the
   file was replaced in between. listed: the name was in the folder's listing, so a file gone before its first lstat
   vanished; it's missing only when nothing said it was there. unreadable carries the error's code. */
function readWhole(home, name, phase, retry, listed) {
  const full = path.join(home, name);
  for (let n = 0; n < (retry ? 2 : 1); n++) {
    let st;
    try { st = lstatBig(full); } catch (e) { return { state: 'unreadable', why: errText(e), code: e.code || null }; }
    if (!st) return n ? { state: 'vanished', why: 'it was removed while Flightdeck was reading it' } : listed ? { state: 'vanished', why: 'It was listed, then gone before it could be read. Try again.' } : { state: 'missing' };
    if (st.isSymbolicLink() || !st.isFile()) return { state: 'link', why: st.isSymbolicLink() ? 'it\'s a link; Flightdeck never reads through one' : 'it isn\'t a file', folder: st.isDirectory() };
    const r = readThrough(full, phase, TYPE_READ_CAP + 1, st, { cap: TYPE_READ_CAP });
    if (r.fail === 'gone') return { state: 'vanished', why: 'It was there a moment ago and was gone when it was read. Try again.' };
    if (r.fail === 'link') return { state: 'link', why: 'it\'s a link; Flightdeck never reads through one' };
    if (r.fail === 'oversized' || (!r.fail && r.filled)) return { state: 'oversized', bytes: r.fail ? r.size : r.bytes.length, why: 'it\'s over the ' + size(TYPE_READ_CAP) + ' Flightdeck reads' };
    if (r.fail === 'moved') continue;
    if (r.fail === 'close') return { state: 'unreadable', close: true, why: r.why, code: null };
    if (r.fail) return { state: 'unreadable', why: r.why, code: r.code || null };
    if (!sameMeta(r.first, r.snap)) continue;
    hook('afterSnapshot', full, phase);
    let now;
    try { now = lstatBig(full); } catch (e) { return { state: 'unreadable', why: errText(e), code: e.code || null }; }
    if (!now) return { state: 'vanished', why: 'it was removed while Flightdeck was reading it' };
    if (sameMeta(now, r.snap)) return { state: 'bytes', bytes: r.bytes };
  }
  return { state: 'vanished', why: 'it changed while Flightdeck was reading it, twice. Try again.' };
}
const IO_KIND = { unreadable: true, link: true, skipped: true, vanished: true };
const utf8ok = (b) => { try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch (e) { return false; } };
/* A text file read through the ledger as the app reads it (UTF-8, bad bytes replaced, a byte-order mark dropped), with
   the replacement named: { text, size } or null. */
async function readText(L, p, max) {
  const b = await L.fs.blob(p, { maxBytes: max });
  if (!b) return null;
  const bytes = Buffer.from(await b.arrayBuffer());
  if (!utf8ok(bytes)) L.note(p, 'malformed', 'isn\'t valid UTF-8 text; Flightdeck reads it with the bad bytes replaced');
  return { text: new TextDecoder('utf-8').decode(bytes), size: bytes.length };
}
/* How many lines of one history file PF.repo.loadEditHistory rejects, counted as it counts them (the newest TL.HIST.READ
   lines looked at; too long, not JSON, or not an entry cleanEntry keeps). */
function historyRejects(TL, text, name) {
  const H = TL.HIST, lines = String(text).split('\n');
  let n = 0, seen = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (++seen > H.READ) continue;
    if (line.length > H.LINE || TL.bytes(line) > H.LINE) { n++; continue; }
    let ok = false;
    try { ok = !!TL.cleanEntry(JSON.parse(line), name); } catch (e) { ok = false; }
    if (!ok) n++;
  }
  return n;
}
/* The type commands' problem ledger: PF.repo.ledger over a read-only view of the team folder (PF.repo.readOnly), as the
   --json commands read. A step type's exact bytes are read through descriptors (readWhole), and what fails there is noted
   in it by path; drafts and history are read through its fs, so every listing or read that fails lands in it too.
   problems(): the ledger's and the adapter's (links, files too big, files that vanished), each once. */
function typeLedger(PF, dir, what) {
  const ra = dir ? readAdapter(dir, { maxBytes: READ_MAX }) : null, L = PF.repo.ledger(ra ? PF.repo.readOnly(ra, what) : {});
  const problems = () => {
    const out = L.problems(), seen = {};
    out.forEach((x) => { seen[x.path + '\u0000' + x.kind] = true; });
    if (ra) adapterProblems(ra).forEach((x) => { const k = x.path + '\u0000' + x.kind; if (!seen[k]) { seen[k] = true; out.push(x); } });
    return out;
  };
  return { fs: L.fs, note: L.note, problems };
}
const denied = (code) => code === 'EACCES' || code === 'EPERM';
/* Why a save is held because something couldn't be read, with the next step that fits the failure: access for a denial, a
   person for a file too big to compare, a sync only for a file that changed or vanished as it was read. */
function heldWhy(rel, got) {
  if (denied(got.code)) return 'Access to ' + rel + ' was denied. Ask the folder owner to check your access, then try again.';
  if (got.state === 'oversized') return rel + ' is over the ' + size(TYPE_READ_CAP) + ' Flightdeck reads, so it\'s too big to check here. Ask a person to look at it in Flightdeck.';
  if (got.state === 'vanished') return rel + ' changed or vanished while Flightdeck read it, which usually means it\'s syncing. Try again once it has synced.';
  if (got.state === 'link') return rel + ' isn\'t a file Flightdeck reads: ' + bare(got.why) + '.';
  return rel + ' couldn\'t be read (' + bare(got.why) + '). Check the folder, then try again.';
}
const bare = (t) => String(t || '').trim().replace(/[.!?]+$/, '');
const UNLISTED = 'Flightdeck couldn\'t list step-types/. Whether this type exists is unknown. Check folder access before trying again.';
/* step-types/ as listed now: every entry, and the regular .json files in the order the app's loader reads them. */
function typeListing(home) {
  const entries = fs.readdirSync(home, { withFileTypes: true });
  const names = entries.map((e) => e.name), files = entries.filter((e) => e.isFile() && /\.json$/i.test(e.name)).map((e) => e.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { entries, names, files };
}
function loadPosition(files, name) {
  const all = files.indexOf(name) >= 0 ? files : files.concat([name]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return all.indexOf(name) + 1;
}
/* What a step-type file is to the command (state: ok, malformed or newer, on its exact bytes) and to the app (usable: the
   app's lenient decoding, then checkCustom and name = ID, as repo.loadStepTypes reads it). */
function typeFile(PF, bytes, file) {
  const T = PF.types, bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = new TextDecoder('utf-8').decode(bytes);
  let utf8 = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { utf8 = false; }
  const crlf = (text.match(/\r\n/g) || []).length, lf = (text.match(/\n/g) || []).length - crlf, cr = (text.match(/\r(?!\n)/g) || []).length;
  const lineEndings = !crlf && !lf && !cr ? 'none' : crlf && !lf && !cr ? 'crlf' : lf && !crlf && !cr ? 'lf' : 'mixed';
  const out = { bom, utf8, text, lineEndings, state: 'ok', def: null, appDef: null, errors: [], needs: null, usable: false, valid: false };
  let o, parsed = true;
  try { o = JSON.parse(text); } catch (e) { parsed = false; }
  const object = parsed && !!o && typeof o === 'object' && !Array.isArray(o);
  /* The app's view. */
  if (parsed) {
    let errs;
    try { errs = T.checkCustom(o); } catch (e) { errs = ['couldn\'t be read as a step type']; }
    if (!errs.length && file === o.id + '.json') { try { T.customType(o); out.usable = true; out.appDef = o; } catch (e) { out.usable = false; } }
  }
  /* The command's view. */
  if (!parsed) return Object.assign(out, { state: 'malformed', errors: [utf8 ? 'isn\'t valid JSON' : 'isn\'t valid UTF-8 text'] });
  if (!object) return Object.assign(out, { state: 'malformed', errors: ['must be a JSON object'] });
  if (o.format != null || o.features != null) {
    const env = PF.envelope.judge('flightdeck-step-type', o);
    if (!env.ok && env.kind === 'newer') { let e1; try { e1 = T.checkCustom(o)[0]; } catch (e) { e1 = ''; } return Object.assign(out, { state: 'newer', needs: env.needs || null, errors: [e1 || 'It needs a newer Flightdeck.'] }); }
  }
  out.def = o;
  let errs;
  try { errs = T.checkCustom(o).slice(); } catch (e) { errs = ['couldn\'t be read as a step type']; }
  if (!utf8) return Object.assign(out, { state: 'malformed', errors: ['isn\'t valid UTF-8 text'].concat(errs) });
  if (errs.length) return Object.assign(out, { state: 'malformed', errors: errs });
  if (file !== o.id + '.json') return Object.assign(out, { state: 'malformed', errors: ['the file name must be ' + o.id + '.json'] });
  out.valid = true;
  return out;
}
const STATE_KIND = { malformed: 'malformed', newer: 'newer', unreadable: 'unreadable', oversized: 'skipped', vanished: 'vanished', link: 'link' };
/* One file as type read and type list report it, its problem noted in the ledger. unknown: why step-types/ couldn't be
   listed (or reached), when it couldn't: the file is still read where it can be, but its position is unknown, and a file
   not found then is unreadable, never missing. Only absence nothing contradicts gives rev "none". */
function typeEntry(PF, L, home, file, files, phase, unknown) {
  const rel = 'step-types/' + file, listed = !unknown && files.indexOf(file) >= 0, pos = listed ? files.indexOf(file) + 1 : null;
  const got = home ? readWhole(home, file, phase, true, listed) : { state: 'missing' };
  const e = { state: got.state, rev: null, bytes: null, bom: null, lineEndings: null, utf8: null, text: null, def: null, errors: [], needs: null, position: pos, selected: pos == null ? null : pos <= PF.save.LIMIT, usable: pos == null ? null : false };
  if (got.state === 'missing' && unknown) { L.note(rel, 'unreadable', unknown); return Object.assign(e, { state: 'unreadable', errors: [unknown] }); }
  if (got.state === 'missing') return Object.assign(e, { rev: 'none', position: null, selected: null, usable: null });
  if (got.state !== 'bytes') {
    L.note(rel, STATE_KIND[got.state], got.why);
    return Object.assign(e, { bytes: got.state === 'oversized' ? got.bytes : null, errors: got.why ? [got.why] : [] });
  }
  const f = typeFile(PF, got.bytes, file);
  Object.assign(e, { state: f.state, rev: sha256(got.bytes), bytes: got.bytes.length, bom: f.bom, lineEndings: f.lineEndings, utf8: f.utf8, text: f.text, def: f.state === 'newer' ? null : f.def, errors: f.errors, needs: f.needs });
  if (pos != null) e.usable = e.selected && f.usable;
  if (f.state !== 'ok') L.note(rel, STATE_KIND[f.state], f.errors[0] || '');
  return e;
}
function typeFail(eng, kind, why) { return { out: JSON.stringify(eng.PF.appjson.failure(eng.version, kind, why, [], 2), null, 2), code: EXIT.error }; }
async function typeRead(eng, argv, args) {
  const PF = eng.PF, AJ = PF.appjson, T = PF.types, sub = args[1];
  const extra = argv.filter((a) => a.startsWith('--') && a !== '--json');
  if (extra.length) return typeFail(eng, 'usage', 'type ' + sub + ' doesn\'t take ' + extra[0] + '.');
  if (!argv.includes('--json')) return typeFail(eng, 'usage', 'flightdeck type ' + sub + ' prints JSON. Add --json.');
  const id = args[3];
  if (sub === 'read' && (!id || !T.ID.test(id) || id.length > T.ID_MAX)) return typeFail(eng, 'usage', 'a step type ID is lowercase letters, numbers, dashes and dots, like deploy.check: flightdeck type read <team folder> <id> --json');
  if (args.length > (sub === 'read' ? 4 : 3)) return typeFail(eng, 'usage', 'type ' + sub + ' takes ' + (sub === 'read' ? 'a team folder and an ID' : 'a team folder') + ', nothing else.');
  let dir;
  try { dir = folderArg(args[2], 'type ' + sub); } catch (e) { return typeFail(eng, 'failed', e.message); }
  const L = typeLedger(PF, dir, 'Reading step types'), readAt = new Date().toISOString();
  let home = null, unknown = null, listing = { names: [], files: [], entries: [] };
  try { home = folders(dir, ['step-types'], false); } catch (e) { L.note('step-types', 'link', e.message); unknown = bare(e.message) + '. Whether this type exists is unknown.'; }
  if (home) { try { listing = typeListing(home); } catch (e) { L.note('step-types', 'unreadable', 'couldn\'t be listed (' + errText(e) + ')'); unknown = UNLISTED; } }
  const done = (data) => { const env = AJ.envelope(eng.version, readAt, L.problems(), data, 2); return { out: JSON.stringify(env, null, 2), code: env.complete ? 0 : EXIT.partial }; };
  if (sub === 'read') {
    const file = id + '.json', e = typeEntry(PF, L, home, file, listing.files, 'read', unknown);
    return done({ type: Object.assign({ id, path: 'step-types/' + file }, e) });
  }
  const S = PF.save, rows = [], other = [];
  for (const file of listing.files) {
    const e = typeEntry(PF, L, home, file, listing.files, 'list', null);
    /* A listed type it's a copy of first, else the name it would be a copy of (the original may be gone). */
    const base = listing.names.filter((n) => n !== file && /\.json$/i.test(n) && S.copiesOf(n, [file]).length)[0] || S.copyBase(file);
    rows.push({ file, id: e.def && typeof e.def.id === 'string' ? e.def.id : null, state: e.state, rev: e.rev, kind: 'file', position: e.position, selected: e.selected, usable: e.usable,
      copyOf: base && /\.json$/i.test(base) && T.ID.test(base.slice(0, -5).toLowerCase()) ? base : null, errors: e.errors });
  }
  listing.entries.filter((x) => !x.isFile() && /\.json$/i.test(x.name)).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((x) => {
    const link = x.isSymbolicLink();
    L.note('step-types/' + x.name, link ? 'link' : 'unusable', link ? 'it\'s a link; Flightdeck never reads through one' : 'it isn\'t a file');
    other.push({ file: x.name, id: null, state: 'link', rev: null, kind: link ? 'link' : 'folder', position: null, selected: null, usable: null, copyOf: null, errors: [] });
  });
  return done({ types: rows.concat(other), limit: S.LIMIT, count: listing.files.length });
}
/* T: the new bytes in an exclusive temporary file beside the target, written in full, flushed, closed and read back. The
   name never ends in .json, so no loader, copy check or count sees it. */
function tempBeside(home, name, data) {
  const tmp = path.join(home, '.' + name + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
  let fd = null, ours = null;
  try {
    fd = fs.openSync(tmp, 'wx');
    ours = fs.fstatSync(fd, BIG);
    for (let off = 0; off < data.length;) { const n = fs.writeSync(fd, data, off, data.length - off); if (!(n > 0)) throw new Error('the disk accepted no more bytes'); off += n; }
    fs.fsyncSync(fd);
    const c = fd; fd = null;
    try { fs.closeSync(c); } catch (e) { throw new Error('couldn\'t close ' + tmp + ' (' + errText(e) + ')'); }
    const back = readThrough(tmp, 'T', data.length + 1, ours, null);
    if (back.fail) throw new Error('the temporary file couldn\'t be read back (' + back.why + ')');
    if (back.filled || !back.bytes.equals(data)) throw new Error('the temporary file didn\'t read back as written');
    return { tmp, ours };
  } catch (e) {
    if (fd !== null) try { fs.closeSync(fd); } catch (err) { /* the write already failed */ }
    const x = new Error('couldn\'t write the new file (' + errText(e) + ')');
    x.tmp = ours ? tmp : null; x.ours = ours;
    throw x;
  }
}
/* Remove a temporary file, only while it's still the one this process made. Returns the error, or null. */
function removeOurs(full, ours, atUnlink) {
  try {
    const st = lstatBig(full);
    if (!st || st.isSymbolicLink() || !sameNode(st, ours)) return null;
    if (atUnlink) hook('atUnlink', full);
    fs.unlinkSync(full);
    return null;
  } catch (e) { return errText(e); }
}
/* P: link the temporary file to a second name and remove it, before the target is touched. */
function probeLinks(tmp) {
  const probe = tmp.replace(/\.tmp$/, '.probe');
  try { fs.linkSync(tmp, probe); } catch (e) { return NO_LINKS.indexOf(e.code) >= 0 ? { refused: 'no-links', why: errText(e) } : { failed: true, why: errText(e) }; }
  try { fs.unlinkSync(probe); } catch (e) { return { failed: true, why: 'the check\'s second name couldn\'t be removed (' + errText(e) + ')', left: probe }; }
  return null;
}
/* A new file, created once (the history line): T, P, then one link that never replaces anything. */
function createOnce(dir, parts, data) {
  const res = { commit: 'no', why: null, left: [], leftWhy: [] };
  let home, t;
  try { home = folders(dir, parts.slice(0, -1), true); } catch (e) { res.why = e.message; return res; }
  const target = path.join(home, parts[parts.length - 1]);
  try { t = tempBeside(home, parts[parts.length - 1], data); } catch (e) { res.why = e.message; if (e.tmp) { const w = removeOurs(e.tmp, e.ours); if (w) { res.left.push(e.tmp); res.leftWhy.push(w); } } return res; }
  const p = probeLinks(t.tmp);
  if (p) { res.why = p.why; if (p.left) { res.left.push(p.left); res.leftWhy.push(p.why); } }
  else {
    try {
      if (lstatBig(target)) res.why = 'it\'s already there';
      else { fs.linkSync(t.tmp, target); res.commit = 'yes'; }
    } catch (e) { if (e.code === 'EEXIST') res.why = 'it\'s already there'; else { res.commit = 'unknown'; res.why = errText(e); } }
  }
  const w = removeOurs(t.tmp, t.ours);
  if (w) { res.left.push(t.tmp); res.leftWhy.push(w); }
  return res;
}
/* B: does the path still name our file, holding our bytes, unchanged while it was read? (design 1.4b) */
function observeOther(target) {
  try {
    const st = lstatBig(target);
    if (!st) return { now: null, kind: 'vanished', why: 'it was gone when Flightdeck looked at what replaced it' };
    if (st.isSymbolicLink() || !st.isFile()) return { now: null, kind: 'link', why: 'a folder or a link is there now' };
    const r = readThrough(target, 'observe', TYPE_READ_CAP + 1, st, { cap: TYPE_READ_CAP });
    if (r.fail === 'oversized' || (!r.fail && r.filled)) return { now: null, kind: 'skipped', why: 'what replaced it is over the ' + size(TYPE_READ_CAP) + ' Flightdeck reads' };
    if (r.fail === 'gone' || r.fail === 'moved') return { now: null, kind: 'vanished', why: 'what replaced it changed again as it was read' };
    if (r.fail) return { now: null, kind: r.fail === 'link' || r.fail === 'notfile' ? 'link' : 'unreadable', why: r.why };
    const fin = lstatBig(target);
    if (!sameMeta(r.first, r.snap) || !fin || !sameMeta(fin, r.snap)) return { now: null, kind: 'vanished', why: 'it changed while Flightdeck was reading it' };
    return { now: sha256(r.bytes), kind: null, why: null };
  } catch (e) { return { now: null, kind: 'unreadable', why: errText(e) }; }
}
function readBack(target, ours, data) {
  let st;
  try { st = lstatBig(target); } catch (e) { return { back: 'unreadable', now: null, kind: 'unreadable', why: errText(e) }; }
  if (!st) return { back: 'missing', now: null, why: null };
  if (st.isSymbolicLink() || !st.isFile()) return { back: 'unreadable', now: null, kind: 'link', why: 'a folder or a link is there now' };
  if (!sameNode(st, ours)) return Object.assign({ back: 'other' }, observeOther(target));
  const r = readThrough(target, 'B', data.length + 1, st, null);
  if (r.fail === 'gone') return { back: 'missing', now: null, why: null };
  if (r.fail === 'moved') return Object.assign({ back: 'other' }, observeOther(target));
  if (r.fail) return { back: 'unreadable', now: null, kind: 'unreadable', why: r.why };
  hook('afterSnapshot', target, 'B');
  let fin;
  try { fin = lstatBig(target); } catch (e) { return { back: 'unreadable', now: null, kind: 'unreadable', why: errText(e) }; }
  if (!fin) return { back: 'missing', now: null, why: null };
  if (!sameNode(fin, ours)) return Object.assign({ back: 'other' }, observeOther(target));
  const len = BigInt(data.length), stable = sameMeta(r.first, r.snap) && sameMeta(fin, r.snap);
  if (r.filled || !r.bytes.equals(data) || r.snap.size !== len || fin.size !== len) return stable ? Object.assign({ back: 'other' }, observeOther(target)) : { back: 'other', now: null, kind: 'vanished', why: 'it changed while Flightdeck was reading it back' };
  if (!stable) return { back: 'unstable', now: null, kind: 'vanished', why: 'it changed while Flightdeck was reading it back' };
  return { back: 'same', now: sha256(data), why: null };
}
/* --from's bytes, never more than limit + 1 read (design D5): standard input (-), or a regular file opened without
   blocking (a FIFO or a device is refused, never waited on or read without end). { bytes, over, size } or { usage }. */
function boundedInput(file, limit) {
  let fd = 0, own = false, size = null;
  try {
    if (file !== '-') {
      fd = fs.openSync(expand(file), fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0)); own = true;
      const st = fs.fstatSync(fd);
      if (!st.isFile()) return { usage: '--from is a file with the definition, or - for standard input; ' + file + ' isn\'t a regular file.' };
      if (st.size > limit) return { bytes: null, over: true, size: st.size };
    }
    const buf = Buffer.alloc(limit + 1);
    let total = 0, waits = 0;
    while (total < buf.length) {
      let n;
      try { n = fs.readSync(fd, buf, total, buf.length - total, own ? total : null); } catch (e) {
        if (e.code === 'EAGAIN' && !own && waits++ < 6000) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); continue; }
        if (e.code === 'EOF') break;
        throw e;
      }
      if (!n) break;
      total += n;
    }
    if (total > limit) return { bytes: null, over: true, size };
    return { bytes: buf.subarray(0, total), over: false, size: total };
  } catch (e) { return { usage: 'couldn\'t read --from (' + errText(e) + ').' }; }
  finally { if (own) try { fs.closeSync(fd); } catch (e) { /* only read */ } }
}
/* The new definition from --from: at most 256 KB of strict UTF-8 (a leading byte-order mark dropped), no key twice in one
   object, no __proto__, constructor or prototype key, one JSON object, the ID it's saved as, checkCustom, then formatWhy. */
function typeInput(PF, file, id) {
  const T = PF.types, S = PF.save;
  const bad = (why, errors) => ({ invalid: why, errors: errors || [why] });
  const got = boundedInput(file, TYPE_INPUT_MAX);
  if (got.usage) return { usage: got.usage };
  const buf = got.bytes;
  if (got.over) return bad('the definition is ' + (got.size != null ? got.size + ' bytes' : 'more than ' + TYPE_INPUT_MAX + ' bytes') + '; a step type is at most ' + TYPE_INPUT_MAX + ' bytes (256 KB) of UTF-8');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return bad('the definition isn\'t valid UTF-8 text'); }
  let def;
  try { def = JSON.parse(text); } catch (e) { return bad('the definition isn\'t valid JSON (' + e.message + ')'); }
  if (!def || typeof def !== 'object' || Array.isArray(def)) return bad('must be a JSON object');
  const dup = S.duplicateKeys(text);
  if (dup !== null) return bad('"' + dup + '" appears twice in one object; JSON keeps only the last, so say it once');
  if (def.id !== id) return { usage: 'the definition\'s "id" must be ' + id + ', the ID it\'s saved as.' };
  /* checkCustom first, so a reserved name gets the reader's own words (a shared rule); then the keys it doesn't look at. A
     value the checks can't even read (a name that's an object with no usable text, say) is invalid too, never a crash. */
  let data;
  try {
    const errs = T.checkCustom(def).slice();
    if (errs.length) return bad(errs[0], errs);
    const odd = S.oddKeys(def);
    if (odd !== null) return bad('"' + odd + '" can\'t be a key in a step type');
    const fw = T.formatWhy(def);
    if (fw) return bad(fw);
    data = Buffer.from(T.fileText(def), 'utf8');
  } catch (e) { return bad('it couldn\'t be read as a step type: a name, label or option isn\'t plain text or a list where one is expected'); }
  if (data.length > TYPE_INPUT_MAX) return bad('the saved file would be ' + data.length + ' bytes; a step type is at most ' + TYPE_INPUT_MAX + ' bytes (256 KB)');
  return { def, data };
}
/* A flightdeck-write/1 answer with nothing done yet: every field, written false. */
function writeShell(app, rel, outcome, error, words, now) {
  return { contract: WRITE_CONTRACT, app, command: 'type save', path: rel, operation: null, outcome, written: false,
    rev: { expected: null, before: null, after: null, now: null }, back: null, load: null, existing: null, appLoads: null,
    checks: { errors: [], warnings: [], omitted: { before: null, after: null } }, askedBy: null, history: null, cleanup: null, error, words, readAt: new Date(now || Date.now()).toISOString(), complete: true, problems: [] };
}
async function typeSave(eng, argv, args, val) {
  const PF = eng.PF, S = PF.save, T = PF.types, U = PF.util, TL = PF.timeline, now = Date.now();
  const id = args[3], name = id + '.json', rel = 'step-types/' + name, idOk = !!id && T.ID.test(id) && id.length <= T.ID_MAX;
  const out = writeShell(eng.version || '', idOk ? rel : null, '', null, '', now);
  const left = [], leftWhy = [];
  let dir = null, L = typeLedger(PF, null);
  /* Every answer goes through PF.save.settle and PF.save.words. */
  const finish = (f) => {
    if (dir && left.length) out.cleanup = { leftover: left.map((p) => relOf(dir, p)), why: leftWhy.join('; ') };
    const s = S.settle({ refused: f.refused || null, commit: f.commit || 'no', back: f.back || null, history: f.history || null, cleanup: out.cleanup, load: out.load });
    out.outcome = s.outcome; out.written = s.written; out.back = s.back;
    if (s.history) out.history = { path: f.historyPath, written: s.history.written, why: s.history.why };
    const why = f.refused ? f.refused.why || '' : f.why || '';
    out.words = S.words(s.outcome, { kind: s.kind, path: rel, why, copies: f.refused && f.refused.copies, needs: f.refused && f.refused.needs, load: out.load, history: s.history, cleanup: out.cleanup, back: s.back, dryRun: s.outcome === 'checked' });
    out.error = s.kind ? { kind: s.kind, why: why || out.words } : null;
    out.problems = L.problems(); out.complete = out.problems.length === 0;
    return { out: JSON.stringify(out, null, 2), code: s.exit };
  };
  const refuse = (outcome, kind, why, more) => finish({ refused: Object.assign({ outcome, kind, why }, more || {}) });
  const usage = (why) => refuse('refused', 'usage', why);
  /* Flags first: nothing is read before every one checks out. */
  const VAL = ['--expect', '--from', '--asked-by', '--note'], FLAGS = ['--json', '--dry-run'];
  for (let i = 0; i < argv.length; i++) {
    if (VAL.indexOf(argv[i]) >= 0) { i++; continue; }
    if (argv[i].startsWith('--') && FLAGS.indexOf(argv[i]) < 0) return usage('type save doesn\'t take ' + argv[i] + '.');
  }
  if (!argv.includes('--json')) return usage('flightdeck type save prints JSON. Add --json.');
  if (!idOk) return usage('a step type ID is lowercase letters, numbers, dashes and dots, like deploy.check: flightdeck type save <team folder> <id> --expect <rev|none> --from <file> --json');
  if (args.length > 4) return usage('type save takes a team folder and an ID, nothing else.');
  for (const f of VAL) if (argv.filter((a) => a === f).length > 1) return usage('say ' + f + ' once.');
  for (const f of VAL) if (argv.indexOf(f) >= 0 && val[f] == null) return usage('say what goes after ' + f + '.');
  const expect = val['--expect'];
  if (expect == null || !(expect === 'none' || /^[0-9a-f]{64}$/.test(expect))) return usage('--expect is the rev type read gave (a SHA-256), or exactly none when type read said missing.');
  out.rev.expected = expect;
  if (val['--from'] == null) return usage('say where the definition is: --from <file>, or --from - to read it from standard input.');
  const by = val['--asked-by'];
  if (by != null && (by.length < 1 || by.length > 80 || /[\u0000-\u001f\u007f]/.test(by))) return usage('--asked-by is a person ID from people.json, like person-avery: 1 to 80 characters, no control characters.');
  if (val['--note'] != null && val['--note'].length > 200) return usage('--note is at most 200 characters.');
  const input = typeInput(PF, val['--from'], id);
  if (input.usage) return usage(input.usage);
  if (input.invalid) { out.checks.errors = input.errors; return refuse('refused', 'invalid', input.invalid); }
  const def = input.def, data = input.data, dryRun = argv.includes('--dry-run');
  out.rev.after = sha256(data);
  try { dir = folderArg(args[2], 'type save'); } catch (e) { return refuse('failed', 'failed', e.message); }
  L = typeLedger(PF, dir, 'Saving a step type');
  out.operation = PF.proposals.newId(now, U.randomId(10));
  const historyPath = 'history/step-types/' + id + '/agent-' + out.operation + '.jsonl';
  try {
    /* R1: the listing, the target's exact bytes, and who asked. */
    let home;
    try { home = folders(dir, ['step-types'], false); } catch (e) { L.note('step-types', 'link', e.message); return refuse('failed', 'failed', e.message); }
    let listing = { names: [], files: [], entries: [] }, unlisted = null;
    if (home) {
      try { listing = typeListing(home); } catch (e) {
        unlisted = denied(e.code) ? heldWhy('step-types/', { code: e.code }) : 'Flightdeck couldn\'t list step-types/ (' + errText(e) + '), so whether this type exists is unknown. Check folder access before trying again.';
        L.note('step-types', 'unreadable', 'couldn\'t be listed (' + errText(e) + ')');
      }
    }
    const got = home ? readWhole(home, name, 'R1', false, !unlisted && listing.files.indexOf(name) >= 0) : { state: 'missing' };
    let seen, file = null, seenBytes = null;
    if (got.state === 'link') { L.note(rel, 'link', got.why); return refuse('failed', 'failed', rel + ' isn\'t a file Flightdeck can save over: ' + got.why + '.'); }
    /* A descriptor that won't close before the commit is a failure, never a hold (design 1.4). */
    if (got.close) { L.note(rel, 'unreadable', got.why); return refuse('failed', 'failed', got.why); }
    if (got.state === 'missing') { seen = { state: 'missing', rev: null }; out.existing = 'missing'; }
    else if (got.state === 'bytes') {
      seenBytes = got.bytes; file = typeFile(PF, got.bytes, name);
      seen = { state: 'bytes', rev: sha256(got.bytes) }; out.rev.before = seen.rev; out.existing = file.state;
      /* What's there is named whatever happens next: a malformed file this save repairs, or a newer one it refuses. */
      if (file.state !== 'ok') L.note(rel, STATE_KIND[file.state], file.errors[0] || '');
      const pos = listing.files.indexOf(name) >= 0 ? listing.files.indexOf(name) + 1 : null;
      out.appLoads = pos != null && pos <= S.LIMIT && file.usable;
    } else {
      L.note(rel, STATE_KIND[got.state], got.why);
      seen = { state: 'unreadable', rev: null, why: heldWhy(rel, got) };
    }
    const asked = { required: false, held: '', verdict: '' };
    if (by != null) {
      /* Listed at the top of the folder first, so a people.json gone as it's read is held, never taken as no people. */
      let top = null, topWhy = null;
      try { top = fs.readdirSync(dir); } catch (e) { topWhy = e; }
      const p = topWhy ? null : readWhole(dir, 'people.json', 'people', false, top.indexOf('people.json') >= 0);
      if (topWhy) {
        L.note('people.json', 'unreadable', 'the team folder couldn\'t be listed (' + errText(topWhy) + '), so whether people.json is there is unknown');
        asked.held = 'Who asked can\'t be checked. ' + (denied(topWhy.code) ? heldWhy('the team folder', { code: topWhy.code }) : 'Flightdeck couldn\'t list the team folder (' + errText(topWhy) + '). Check folder access before trying again.');
      } else if (p.close) { L.note('people.json', 'unreadable', p.why); return refuse('failed', 'failed', p.why); }
      else if (p.state === 'missing') asked.verdict = S.asked([], by, 'person');
      else if (p.state !== 'bytes') { L.note('people.json', STATE_KIND[p.state], p.why); asked.held = 'Who asked can\'t be checked. ' + heldWhy('people.json', p); }
      else {
        let doc;
        try { doc = JSON.parse(new TextDecoder('utf-8').decode(p.bytes)); } catch (e) { doc = undefined; }
        if (doc === undefined) { L.note('people.json', 'malformed', 'isn\'t valid JSON'); asked.held = 'people.json isn\'t valid JSON, so who asked can\'t be checked.'; }
        else if (!PF.people.verdict(doc).ok) { L.note('people.json', 'newer', PF.people.verdict(doc).why); asked.held = 'people.json was made with a newer Flightdeck, so who asked can\'t be checked.'; }
        else {
          /* What reading it drops or changes is named as the reading commands name it: bad bytes replaced, entries without
             a text ID and name, names cut to 60. */
          if (!utf8ok(p.bytes)) L.note('people.json', 'malformed', 'isn\'t valid UTF-8 text; Flightdeck reads it with the bad bytes replaced');
          const pw = peopleWhy({ hash: '', doc });
          if (pw) L.note('people.json', 'malformed', pw);
          const people = PF.people.clean(doc);
          asked.verdict = S.asked(people, by, 'person');
          if (!asked.verdict) { const me = people.filter((x) => x.id === by)[0]; out.askedBy = { id: by, name: me.name }; }
        }
      }
    }
    { const p = hook('afterRead', home ? path.join(home, name) : path.join(dir, 'step-types', name)); if (thenable(p)) await p; }
    /* Warnings, never refusals; the history line built before any file is made (design 1.6). */
    const W = out.checks.warnings, oldDef = file && file.state === 'ok' ? file.def : null;
    /* What the app loads now (a malformed file it still reads leniently included) is what drafts depend on; oldDef, only a
       valid file, is what history keeps. */
    const depDef = oldDef || (file && file.usable ? file.appDef : null);
    if (file && file.state === 'malformed') W.push(rel + ' is malformed (' + (file.errors[0] || 'it isn\'t a step type Flightdeck can use') + '); this save repairs it.');
    T.unusedKeys(def).forEach((k) => W.push(k + ' isn\'t part of a step type Flightdeck reads; its editor drops it on its next save.'));
    if (T.markerWhy(def)) W.push(T.markerWhy(def));
    /* Drafts are read only when the change removes a field or evidence, through the ledger: a listing or a draft that
       fails is a problem, and the warnings say the check is incomplete. */
    const gone = T.removed(depDef, def), under = (d) => L.problems().some((x) => x.path === d || x.path.indexOf(d + '/') === 0);
    if (depDef && (gone.fields.length || gone.evidence.length)) {
      const drafts = [], DD = 'maps/drafts';
      let items = [];
      try { items = await L.fs.list(DD); } catch (e) { items = []; /* named in the ledger */ }
      for (const i of items) {
        if (i.kind !== 'file' || !/\.md$/i.test(i.name)) continue;
        try { const f = await readText(L, DD + '/' + i.name, U.DRAFT_BYTES); if (f) drafts.push({ process: i.name.replace(/\.md$/i, ''), text: f.text }); } catch (e) { /* named in the ledger */ }
      }
      T.inUse(depDef, def, drafts).forEach((w) => W.push(w));
      if (L.problems().some((x) => IO_KIND[x.kind] && (x.path === DD || x.path.indexOf(DD + '/') === 0))) W.push('Couldn\'t check drafts in maps/drafts/. Check them for uses of the removed fields before calling this change complete.');
    }
    const omitted = out.checks.omitted, appText = seenBytes ? new TextDecoder('utf-8').decode(seenBytes) : null, from = appText == null ? null : U.hash(appText);
    if (file && file.state !== 'ok') omitted.before = 'invalid';
    let seenId = null;
    if (from) {
      const HD = 'history/step-types/' + id;
      /* Every file the reader reads is kept, so a line it rejects (not JSON, too long, a newer kind) is named by its file. */
      const texts = {}, hfs = Object.assign({}, L.fs, { read: (p2, o) => readText(L, p2, (o && o.maxBytes) || READ_MAX).then((f) => { if (f) texts[p2] = f.text; return f; }) });
      try {
        const h = await PF.repo.loadEditHistory(hfs, HD, from); const e = h.items.filter((x) => x.entry && x.entry.to === from)[0]; seenId = e ? e.entry.id : null;
        if (h.bad) Object.keys(texts).sort().forEach((p2) => { const n = historyRejects(TL, texts[p2], path.posix.basename(p2)); if (n) L.note(p2, 'malformed', n + ' line' + (n === 1 ? '' : 's') + ' Flightdeck couldn\'t read (not a history line, too long, or from a newer Flightdeck)'); });
        if (h.skipped) L.note(HD, 'skipped', 'over the newest ' + TL.HIST.READ + ' lines Flightdeck reads; ' + h.skipped + ' older line' + (h.skipped === 1 ? ' wasn\'t' : 's weren\'t') + ' read');
      } catch (e) { seenId = null; /* named in the ledger */ }
      if (under(HD)) W.push('Couldn\'t read ' + HD + '/, so this save\'s history line doesn\'t say which earlier save it follows.');
    }
    const lineOf = (b, a) => TL.histLine({ kind: 'type-edit', id: out.operation, type: id, writer: out.operation, seq: 1, by: by || '', at: new Date(now).toISOString(), from, to: U.hash(T.fileText(def)), seen: seenId,
      before: b, after: a, source: 'agent', units: [val['--note'] || 'Changed by your AI assistant'] });
    let line = null, lineWhy = null;
    try {
      line = lineOf(oldDef, def);
      if (line.big) { if (oldDef) omitted.before = 'cap'; omitted.after = 'cap'; }
      else {
        const c = TL.cleanEntry(JSON.parse(JSON.stringify(line)), 'agent-' + out.operation + '.jsonl');
        if (oldDef && (!c || c.before == null)) omitted.before = 'cleaned';
        if (!c || c.after == null) omitted.after = 'cleaned';
      }
    } catch (e) {
      try { line = lineOf(null, null); if (oldDef) omitted.before = 'fallback'; omitted.after = 'fallback'; } catch (e2) { line = null; lineWhy = 'its history line couldn\'t be built (' + errText(e2) + ')'; omitted.after = 'fallback'; }
    }
    S.historyWarnings(omitted).forEach((w) => W.push(w));
    /* J: one verdict. */
    const v = S.judge({ mode: S.MODE, expect, seen, listing: unlisted ? { unlisted: true, why: unlisted } : listing.names, name, existing: file ? { verdict: file.state, needs: file.needs } : null, asked: { required: false, held: asked.held, verdict: asked.verdict }, newRev: out.rev.after, dryRun });
    const loadIf = (files, from2) => { const position = loadPosition(files, name); out.load = { position, limit: S.LIMIT, selected: position <= S.LIMIT, from: from2 }; if (position > S.LIMIT) W.push(from2 === 'C' ? 'Flightdeck won\'t load it: it reads only the first ' + S.LIMIT + ' step-type files by name, and this is number ' + position + '.' : 'If saved with these files present, it would be number ' + position + ', and Flightdeck wouldn\'t load it: it reads only the first ' + S.LIMIT + ' by name.'); };
    if (!v.go && v.outcome !== 'checked') return finish({ refused: { outcome: v.outcome, kind: v.kind, why: v.why, copies: (v.copies || []).map((c) => 'step-types/' + c), needs: v.needs } });
    if (!line) return refuse('failed', 'failed', lineWhy);
    if (v.outcome === 'checked') { loadIf(listing.files, 'R1'); return finish({ refused: { outcome: 'checked', kind: null, why: '' } }); }
    /* T and P. */
    let where, t;
    /* step-types/ is made only for the save: a refusal or failure before the commit removes it again when this call made
       it and it's still empty, so nothing is left behind (a temporary file it couldn't remove keeps it, and is named). */
    const made = !lstatOrNull(path.join(dir, 'step-types'));
    try { where = folders(dir, ['step-types'], true); } catch (e) { L.note('step-types', 'link', e.message); return refuse('failed', 'failed', e.message); }
    const unmake = () => { if (!made) return; try { if (!fs.readdirSync(where).length) fs.rmdirSync(where); } catch (e) { /* not empty or gone: left as it is */ } };
    const target = path.join(where, name);
    try { t = tempBeside(where, name, data); } catch (e) { if (e.tmp) { const w = removeOurs(e.tmp, e.ours); if (w) { left.push(e.tmp); leftWhy.push(w); } } unmake(); return refuse('failed', 'failed', e.message); }
    const clean = () => { const w = removeOurs(t.tmp, t.ours); if (w) { left.push(t.tmp); leftWhy.push(w); } unmake(); };
    const stop = (outcome, kind, why, more) => { clean(); return refuse(outcome, kind, why, more); };
    /* A read in the final compare that fails: named in the ledger, then failed. */
    const cfail = (at, kind, why) => { L.note(at, kind, why); return stop('failed', 'failed', why); };
    const pr = probeLinks(t.tmp);
    if (pr) { if (pr.left) { left.push(pr.left); leftWhy.push(pr.why); } return pr.refused ? stop('refused', 'no-links', pr.why) : stop('failed', 'link-check', pr.why); }
    /* C: the final compare. */
    { const p = hook('beforeCompare', target); if (thenable(p)) await p; }
    let l1;
    try { l1 = typeListing(where); } catch (e) { return cfail('step-types', 'unreadable', 'step-types/ couldn\'t be listed (' + errText(e) + ')'); }
    let copies = S.copiesOf(name, l1.names);
    if (copies.length) return stop('refused', 'copies', '', { copies: copies.map((c) => 'step-types/' + c) });
    let snap = null;
    let st0;
    try { st0 = lstatBig(target); } catch (e) { return cfail(rel, 'unreadable', rel + ' couldn\'t be checked (' + errText(e) + ')'); }
    if (seenBytes === null) { if (st0) return stop('refused', 'changed', ''); }
    else {
      if (!st0) return stop('refused', 'changed', '');
      if (st0.isSymbolicLink() || !st0.isFile()) return cfail(rel, 'link', rel + ' is a folder or a link now; Flightdeck never saves through one.');
      const r = readThrough(target, 'C', seenBytes.length + 1, st0, null);
      if (r.fail === 'gone' || r.fail === 'moved') return stop('refused', 'changed', '');
      if (r.fail) return cfail(rel, r.fail === 'link' || r.fail === 'notfile' ? 'link' : 'unreadable', r.fail === 'close' ? r.why : rel + ' couldn\'t be compared (' + r.why + ')');
      if (r.filled || !r.bytes.equals(seenBytes) || !sameMeta(r.first, r.snap)) return stop('refused', 'changed', '');
      snap = r.snap;
      hook('afterSnapshot', target, 'C');
    }
    let l2;
    try { l2 = typeListing(where); } catch (e) { return cfail('step-types', 'unreadable', 'step-types/ couldn\'t be listed (' + errText(e) + ')'); }
    copies = S.copiesOf(name, l2.names);
    if (copies.length) return stop('refused', 'copies', '', { copies: copies.map((c) => 'step-types/' + c) });
    { const p = hook('afterFinalListing', target); if (thenable(p)) await p; }
    let fin;
    try { fin = lstatBig(target); } catch (e) { return cfail(rel, 'unreadable', rel + ' couldn\'t be checked (' + errText(e) + ')'); }
    if (seenBytes === null) { if (fin) return stop('refused', 'changed', ''); }
    else {
      if (!fin) return stop('refused', 'changed', '');
      if (fin.isSymbolicLink() || !fin.isFile()) return cfail(rel, 'link', rel + ' is a folder or a link now; Flightdeck never saves through one.');
      if (!sameMeta(fin, snap)) return stop('refused', 'changed', '');
    }
    { const p = hook('afterCompare', target); if (thenable(p)) await p; }
    /* W: the commit. Only the link or the rename returning says this command wrote. */
    let commit = 'yes', commitWhy = null;
    if (seenBytes === null) {
      try { fs.linkSync(t.tmp, target); } catch (e) { if (e.code === 'EEXIST') return stop('refused', 'changed', ''); commit = 'unknown'; commitWhy = errText(e); }
      if (commit === 'yes') try { hook('afterLink', target); } catch (e) { /* a test hook; the commit stands */ }
    } else {
      try { fs.renameSync(t.tmp, target); } catch (e) { commit = 'unknown'; commitWhy = errText(e); }
    }
    if (commit === 'yes') { try { const p = hook('afterCommit', target); if (thenable(p)) await p; } catch (e) { /* a test hook; the commit stands */ } }
    /* U: the temporary file after a link (a rename moved it; an uncertain rename may have left it). */
    if (seenBytes === null || commit === 'unknown') { const w = removeOurs(t.tmp, t.ours, commit === 'yes'); if (w) { left.push(t.tmp); leftWhy.push(w); } }
    /* B: read back, for information only when the commit is unknown. */
    const b = readBack(target, t.ours, data);
    /* What the read-back couldn't read, of this save or of what replaced it, is named; the outcome stays what it is. */
    if (b.kind) L.note(rel, b.kind, b.why || 'it couldn\'t be read back');
    out.rev.now = b.back === 'same' || b.back === 'other' ? b.now : null;
    if (commit === 'unknown') return finish({ commit: 'unknown', back: b.back, why: commitWhy });
    loadIf(l2.files, 'C');
    /* H: the history line, created once. */
    const h = createOnce(dir, historyPath.split('/'), Buffer.from(JSON.stringify(line) + '\n', 'utf8'));
    h.left.forEach((p, i) => { left.push(p); leftWhy.push(h.leftWhy[i]); });
    return finish({ commit: 'yes', back: b.back, why: b.why || '', history: { commit: h.commit, why: h.why }, historyPath });
  } catch (e) {
    return refuse('failed', 'failed', e instanceof Refused ? e.message : 'The team folder couldn\'t be changed: ' + errText(e));
  }
}
async function typeMain(argv) {
  const VAL = ['--expect', '--from', '--asked-by', '--note'], val = {};
  const args = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VAL.indexOf(argv[i - 1]) >= 0));
  argv.forEach((a, i) => { if (VAL.indexOf(a) >= 0 && i + 1 < argv.length && !(argv[i + 1].startsWith('--') && argv[i + 1] !== '-')) val[a] = argv[i + 1]; });
  let eng;
  const sub = args[1];
  try { eng = loadEngine(); if (_hooks.engine) _hooks.engine(eng); } catch (e) {
    /* type save answers in its own contract even without an engine: failed, nothing changed. */
    if (sub === 'save') return { out: JSON.stringify(writeShell('', null, 'failed', { kind: 'failed', why: errText(e) }, 'Nothing was changed. Flightdeck couldn\'t load: ' + bare(errText(e)) + '.'), null, 2), code: EXIT.error };
    return { out: JSON.stringify({ contract: 'flightdeck-read/2', app: '', error: { kind: 'failed', why: e.message }, problems: [] }, null, 2), code: EXIT.error };
  }
  if (sub === 'list' || sub === 'read') return typeRead(eng, argv, args);
  if (sub === 'save') return typeSave(eng, argv, args, val);
  return typeFail(eng, 'usage', 'say list, read or save, for example: flightdeck type read <team folder> <id> --json');
}

const HELP = `flightdeck: team process checklists, in one HTML file

  flightdeck open                     open the app in this package: the first time, the welcome (start your team, join
                                      one, or look around the examples); after that, the team folder you chose, when
                                      the browser kept it and its permission (otherwise it offers Reconnect)
  flightdeck install <team folder>    copy the app into the team folder as ${NAME}, and add or update the
                                      AI assistant contract there: AGENTS.md and .flightdeck/skills
  flightdeck skills <team folder>     add or update only the skills, in <team folder>/.flightdeck/skills
  flightdeck skills --to <folder>     add or update them in any other folder (an assistant's skills folder, a repo)
  flightdeck backup <team folder>     copy the whole folder to ~/Flightdeck backups (or --to <folder>)
  flightdeck export <team folder> --run <process>/<run id>
                                      make an evidence pack of one run in ~/Flightdeck evidence (or --out <folder>)
  flightdeck export <team folder> --process <process> --from YYYY-MM-DD --through YYYY-MM-DD [--tz Area/City]
                                      make one of the runs started on those days, both included, in --tz
                                      (this computer's time zone unless you say)
  flightdeck processes <team folder> --json
                                      for other apps: every checklist and its versions, as JSON
  flightdeck process <team folder> <process> [--version N | --folder v3-... | --stage stage-...] --json
                                      one version's phases, steps, gates and evidence (the latest usable one
                                      unless you say; --stage, with --contract 2: a staged version)
  flightdeck runs <team folder> [--process <id>] [--status running|planned|ended|all] [--tests] --json
                                      runs and planned runs (--tests, with --contract 2: test runs too)
  flightdeck run <team folder> <process>/<run id> --json
                                      one run: each step's state, who and when, its evidence, gates, follow-ups
  flightdeck next <team folder> <process>/<run id> [--person <id>] --json
                                      what's waiting in a run and on whom (with --person, that person's next step)
  flightdeck followups <team folder> [--process <id>] [--status open|all] --json
                                      every follow-up and what became of it
  flightdeck plan request <team folder> <request.json | -> --key <key> [--json] [--dry-run]
                                      for other apps: ask for a run. Writes a planned run to proposals/ once, for a
                                      person to start in Flightdeck; the same key and request again writes nothing
  flightdeck report targets <team folder> [--process <process>] [--run <process>/<run id>] [--json]
                                      for other apps: running runs and the steps a report can be written for
  flightdeck report check <report.json | -> [--folder <team folder>] [--json]
                                      check a report (with --folder, against its run too); writes nothing
  flightdeck report write <team folder> <report.json | -> [--json] [--dry-run] [--strict] [--unmatched-ok]
                                      say a step's work is done: writes the report to reports/ once, for a person
                                      to accept or decline in Flightdeck. It never checks a step by itself
  flightdeck draft read <team folder> <process> [--session <id>] [--or-latest] --json
                                      for AI assistants: the draft's exact text and rev, who has it open,
                                      this session's proposals and the text to continue from
  flightdeck draft save <team folder> <process> --expect <rev|none> --from <file|-> [--base <file>]
                    [--session <id>] [--label <name>] [--by <person id>] [--note "<text>"] [--after-earlier] --json
                                      write the draft, only when nobody has it open and it's exactly what you
                                      read; otherwise write a proposal a person applies in Flightdeck
  flightdeck draft propose <same as save>
                                      always write a proposal
  flightdeck draft check <team folder> <process> [--from <file|->] --json
                                      the verdict the Publish dialog gives the draft (or the text in the file): what
                                      stops publishing and the tips, from the folder as it is now. Only reads
  flightdeck library inspect <team folder> [--process <id>] --json
                                      for AI assistants: every checklist, normalized, what links to what, the step
                                      types each uses, and what looks alike across checklists, with why. Only reads
  flightdeck loop read <team folder> <process>/<run> <loop step> --json
                                      for AI assistants: one loop of a run: its stories, the exact counts, what
                                      holds its gate and the approval. Only reads
  flightdeck loop sync <team folder> <process>/<run> <loop step> --from <file|-> --tool <name>@<version> --key <key> [--dry-run] [--json]
                                      for AI assistants: ask for a change to a loop's list (also loop add, exclude,
                                      restore, exception, withdraw, owner, review). Writes one file in proposals/,
                                      once; --dry-run previews; never starts a run
  flightdeck skill register <team folder> --from <file|-> [--json]
                                      for AI assistants: register a skill against the exact version it was built
                                      from (Flightdeck 2.0). The only writer of skill-registrations/
  flightdeck type list <team folder> --json
                                      for AI assistants: the team's step types, in the order Flightdeck reads them
  flightdeck type read <team folder> <id> --json
                                      one step type: its state, its exact text and rev (none when it isn't there)
  flightdeck type save <team folder> <id> --expect <rev|none> --from <file|-> [--asked-by <person id>]
                    [--note "<text>"] [--dry-run] --json
                                      add or change a step type, only when it's exactly what you read
  flightdeck path                     print where the app file is
  flightdeck version                  print this version

  --check     say what install or skills would do, and change nothing. Exit code 0: nothing to do;
              2: updates to install; 3: files your team changed that need merging; 1: an error
  --app-only  install only ${NAME}, not AGENTS.md or the skills
  --force     replace a newer app, an unrecognized file, or contract files your team changed
  --no-attachments   export: list attachments with their sizes instead of packing them

The JSON commands only read: they never change a file in the team folder. Exit code 0: complete; 4: partial (the data
is printed, and "problems" names every file or folder that couldn't be read); 1: no data; 5: no such process, version or
run. People-directory email fields are omitted. See docs/apps.md in the Flightdeck repository.

plan request never starts a run and never writes run.json; it writes one new file in proposals/, once. Exit code 0:
requested, already requested, or (--dry-run) what it would write; 4: nothing written, because something it depends on
couldn't be read; 1: refused (usage, a request that isn't valid, or the same key with other details); 5: no such process
or version.

flightdeck draft changes the team folder (contract flightdeck-draft/1). Exit code 0: written or proposed (read: complete);
4: read, partial; 1: usage, missing-base, too-big or failed; 5: read, no such process.

flightdeck type save changes the team folder (contract flightdeck-write/1): it writes step-types/<id>.json and one
history line, never anything else. It compares the exact bytes type read gave and reads its save back. Like two Flightdeck
windows in different browsers, two saves at the same instant can replace one another without either being told. Exit
code 0: done, same or checked; 4: held, partial, replaced, unverified or unsure (read the type again); 1: refused or
failed (nothing was changed).

export never changes the team folder and never writes a pack into it. It prints the pack's SHA-256: keep it somewhere
separate. Exit code 0: a complete pack; 4: a partial pack (made, with what changed or is missing listed); 1: no pack.

Every file install replaces is first copied to .flightdeck/updates/<version>/replaced/ and read back.

Files your team changed are never replaced without --force. When this version also changed them, the new
default goes to .flightdeck/updates/<version>/, with a README.md to hand to your AI assistant.`;

/* ---------- Loops: flightdeck loop read | sync | add | exclude | restore | exception | withdraw | owner | review (3.0,
   docs/apps.md, docs/design.md 44) ----------
   read prints one loop of a parent run: its items, the roll-up, blockers, reviews waiting and the approval and every change
   since. The others ask for a scope change by writing one new file in proposals/, once: a scope request (sync from an
   observation, or add, exclude, restore, exception, withdraw, owner), or for review, a decision on proposed removals made by
   a person (--as) that a tool records on their behalf. They never start a run and never write run.json; the parent's
   recorder sees the change when Flightdeck reads the folder. --dry-run previews and writes nothing. The same --tool and --key
   always mean the same request: a retry writes nothing; the key with other content is refused. */
const LOOP_SUBS = ['read', 'sync', 'add', 'exclude', 'restore', 'exception', 'withdraw', 'owner', 'review'];
const LOOP_VAL = ['--from', '--key', '--tool', '--keys', '--item', '--reason', '--approver', '--owner', '--as', '--accept', '--keep'];
const UNCERTAIN = 'Could not confirm whether the request was saved. Retry with the same key; a new key could ask twice.';
function loopWords(json, sub) {
  if (json.error) return 'flightdeck: ' + json.error.why + json.problems.map((x) => '\n  ' + x.path + ': ' + x.why).join('');
  const d = json.data, lines = [];
  if (sub === 'read') {
    lines.push(d.title + ' · ' + d.summary);
    if (d.observation) lines.push('Last observed ' + d.observation.observedAt + (d.observation.complete ? '' : ' (not complete: ' + d.observation.why + ')'));
    if (d.approval) lines.push('Approved by ' + d.approval.by + ': ' + d.approval.summary);
    if (d.review.length || d.changes.length) lines.push('Approval needs review:', ...d.review.concat(d.changes).map((x) => '  ' + x));
    d.blockers.forEach((b) => lines.push('  ' + b.text));
    d.pending.forEach((p) => lines.push('  ' + p.key + ' · proposed removal'));
  } else lines.push(d.preview);
  json.problems.forEach((x) => lines.push('  ' + x.path + ': ' + x.why));
  return lines.join('\n');
}
async function loopMain(argv) {
  const val = {}, args = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && LOOP_VAL.indexOf(argv[i - 1]) >= 0));
  let eng = null;
  const C2 = 2, asJson = argv.includes('--json'), dryRun = argv.includes('--dry-run'), sub = args[1], appOf = () => (eng ? eng.version : versionOf(app()) || '');
  const out = (json, code) => ({ out: asJson ? JSON.stringify(json, null, 2) : loopWords(json, sub), code });
  const failOut = (kind, why, problems, code) => { const F = eng ? eng.PF.appjson : null; return out(F ? F.failure(appOf(), kind, why, problems || [], C2) : { contract: 'flightdeck-read/2', app: appOf(), error: { kind, why }, problems: problems || [] }, code || (kind === 'not-found' ? EXIT.notFound : EXIT.error)); };
  const usage = (why) => failOut('usage', why);
  for (const f of LOOP_VAL) { const i = argv.indexOf(f); if (i >= 0) { if (argv[i + 1] == null || (argv[i + 1].startsWith('--') && f !== '--reason')) return usage('say what goes after ' + f + '.'); val[f] = argv[i + 1]; } }
  const unknown = argv.filter((a, i) => a.startsWith('--') && ['--json', '--dry-run'].concat(LOOP_VAL).indexOf(a) < 0 && !(i > 0 && LOOP_VAL.indexOf(argv[i - 1]) >= 0));
  if (unknown.length) return usage('loop doesn\'t take ' + unknown.join(', ') + '.');
  if (LOOP_SUBS.indexOf(sub) < 0) return usage('say what to do: flightdeck loop ' + LOOP_SUBS.join(' | ') + ' <team folder> <process>/<run> <loop step> ...');
  const m = RUN_KEY.exec(args[3] || ''), stepId = args[4];
  if (!args[2] || !m || !stepId || args[5] || !/^[a-z0-9][a-z0-9-]{0,59}$/i.test(stepId)) return usage('say the team folder, the parent run and its loop step, for example: flightdeck loop ' + sub + ' <team folder> release-readiness/k3m9p2q8 stories --json');
  const writes = sub !== 'read';
  let tool = null;
  if (writes) {
    const tm = /^([a-z0-9][a-z0-9-]{0,29})@([A-Za-z0-9_.+-]{1,40})$/.exec(val['--tool'] || '');
    if (!tm) return usage('say which tool asks, with its version, for example --tool release-helper@1.4.0.');
    tool = { name: tm[1], version: tm[2] };
    if (!val['--key'] || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(val['--key'])) return usage('say which key with --key: lowercase letters, numbers, dots, dashes or underscores, like import-42. The same key always means the same request.');
  }
  let dir;
  try { eng = loadEngine(); dir = folderArg(args[2], 'loop ' + sub); } catch (e) { return failOut('failed', e.message); }
  const PF = eng.PF, A = PF.appjson, LP = PF.loop, R = PF.run, repo = PF.repo, proc = m[1], runId = m[2];
  const ra = readAdapter(dir, { maxBytes: READ_MAX }), L = repo.ledger(repo.readOnly(ra, 'Reading a loop'));
  let childProc = '';
  const relevant = (p) => p === '' || /^proposals(\/|$)/.test(p) || p === 'people.json' || p.indexOf('runs/' + proc + '/' + runId) === 0 || (!!childProc && p.indexOf('runs/' + childProc) === 0) || p === 'runs' || p === 'runs/' + proc;
  const problems = () => { const all = L.problems(), seen = {}; all.forEach((x) => { seen[x.path + '\u0000' + x.kind] = true; }); adapterProblems(ra).forEach((x) => { if (!seen[x.path + '\u0000' + x.kind]) all.push(x); }); return all.filter((x) => relevant(x.path)); };
  const done = (data) => { const e = A.envelope(eng.version, new Date().toISOString(), problems(), data, C2); return out(e, e.complete ? 0 : EXIT.partial); };
  try {
    const one = await repo.readRunOnly(L.fs, proc, runId);
    if (!one.found) return failOut('not-found', 'There\'s no run ' + proc + '/' + runId + ' in the team folder.' + (writes ? ' Nothing was written.' : ''), problems());
    const r = one.run;
    if (!r) return failOut('failed', 'The run ' + proc + '/' + runId + ' couldn\'t be read, so its loop can\'t be.' + (writes ? ' Nothing was written.' : ''), problems());
    if (newerRun(PF, r)) return failOut('failed', 'The run ' + proc + '/' + runId + ' was made with a newer Flightdeck: ' + r._unrunnable + (writes ? ' Nothing was written.' : ''), problems());
    let map; try { map = R.mapOf(r); } catch (e) { return failOut('failed', 'The run\'s checklist can\'t be read here.', problems()); }
    const x = PF.map.findStep(map, stepId);
    if (!x || x.step.type !== 'for.each') return failOut('not-found', 'Step ' + stepId + ' of ' + proc + '/' + runId + ' isn\'t a loop ({for.each}).' + (writes ? ' Nothing was written.' : ''), problems());
    childProc = String(R.fieldsOf(r, x.step).process || '');
    const bad = [], got = await repo.readPlans(L.fs, bad, null, true);
    bad.forEach((b) => L.note(b.path, b.kind || 'malformed', fileWhy(b.why)));
    const d = childProc ? await repo.loadAll(dependsOn(L.fs, ['runs/' + childProc]), { readOnly: true, explain: true, deep: true }) : { runs: [] };
    const nameOf = A.names(one.people), who = (p) => { const n = nameOf(p); return n ? n.name || n.id : ''; };
    const V = LP.view(r, stepId, { records: got.scopes, runs: d.runs || [], who }), title = String(r.title || r.process);
    if (sub === 'read') {
      const R0 = V.rollup;
      return done({ loop: V.loop, title, step: { id: stepId, text: x.step.text, state: (r.steps[stepId] || {}).s || 'open' }, process: childProc, pin: V.pin, accepts: V.accepts,
        summary: R0.summary, counts: R0.counts, ok: R0.ok, blockers: R0.blockers,
        items: R0.items.map((i) => ({ uid: i.uid, key: i.key, title: i.title, state: i.state, status: i.status, result: i.result || null, run: i.run || null, runs: i.runs, competing: i.competing,
          recorder: i.recorder ? nameOf(i.recorder) : null, owner: i.owner ? nameOf(i.owner) : null, exception: i.exception ? { reason: i.exception.reason, approver: nameOf(i.exception.approver), onBehalf: i.exception.onBehalf } : null,
          review: i.review, mismatch: i.mismatch, attempt: i.attempt, planned: i.planned ? { inputs: i.planned.inputs, attempt: i.planned.attempt } : null })),
        pending: V.ledger.pending, held: V.ledger.held, duplicates: V.ledger.duplicates, overLimit: V.ledger.overLimit,
        observation: V.ledger.observation ? Object.assign({ record: V.ledger.observation.record }, V.ledger.observation.observation, { items: undefined, count: V.ledger.observation.observation.items.length }) : null,
        approval: V.approved ? { by: V.approved.by, at: V.approved.at, onBehalf: V.approved.onBehalf || null, summary: V.approved.summary } : null,
        changes: V.changes, review: V.review, ended: V.ended, late: V.ended ? V.changes : [] });
    }
    /* Anything this depends on that couldn't be read, or a scope record this one would follow that can't be: nothing is written. */
    const held = (why) => done({ loop: V.loop, status: 'held', request: null, preview: why, why });
    if (sub === 'review') return loopReview(eng, { dir, val, V, tool, dryRun, held, done, usage, failOut, problems, title });
    let value;
    if (sub === 'sync') {
      if (!val['--from']) return usage('say where the observation is: --from observation.json (or - for standard input).');
      const input = await readRequestInput(val['--from'], LP.LIMITS.bytes).catch((e) => ({ err: e }));
      if (input.err) return usage('couldn\'t read the observation: ' + input.err.message);
      if (input.tooBig) return failOut('invalid', 'An observation is at most ' + (LP.LIMITS.bytes / 1024) + ' KB; this one is more. Nothing is cut: narrow the search. Nothing was written.');
      let obs; try { obs = JSON.parse(input.buf.toString('utf8').replace(/^﻿/, '')); } catch (e) { return failOut('invalid', 'The observation isn\'t complete JSON: ' + e.message + ' Nothing was written.'); }
      value = { loop: V.loop, observation: obs };
    } else {
      const items = (sub === 'add' ? String(val['--keys'] || '') : String(val['--item'] || '')).split(/[\s,]+/).filter(Boolean).map((k) => { const km = /([A-Z][A-Z0-9_]{0,29}-[1-9][0-9]{0,8})\/?$/.exec(k); return km ? km[1] : k; });
      if (!items.length) return usage(sub === 'add' ? 'say which stories with --keys ABC-101,ABC-102 (keys or links).' : 'say which story with --item ABC-101.');
      const find = (k) => V.ledger.items.filter((i) => i.key === k)[0];
      value = { loop: V.loop, changes: items.map((k) => {
        const it = sub === 'add' ? { key: k } : (find(k) ? { id: find(k).id || undefined, key: k } : { key: k }), c = { op: sub, item: it };
        if (val['--reason'] != null) c.reason = val['--reason'];
        if (sub === 'exception') { c.approver = val['--approver']; if (val['--as']) c.onBehalf = true; }
        if (sub === 'owner') c.owner = val['--owner'] || '';
        return c;
      }) };
      if (sub !== 'add') { const miss = items.filter((k) => !find(k)); if (miss.length) return failOut('invalid', miss.join(', ') + (miss.length === 1 ? ' isn\'t' : ' aren\'t') + ' in this loop. Nothing was written.', problems()); }
    }
    const c = LP.cleanIntent(value, val['--key'], tool);
    if (c.errors.length) return failOut('invalid', c.errors.join(' ') + ' Nothing was written.', problems());
    const id = LP.idFor(tool.name, val['--key']), file = 'proposals/' + id + '.json';
    const mine = got.scopes.filter((s) => s.id === id);
    if (mine.length) {
      const diffs = LP.differsRecord(c.intent, mine[0]);
      if (diffs.length) return failOut('key-taken', 'This key already names a different request (' + file + '). Changed fields: ' + diffs.join(', ') + '. Read that request (flightdeck loop read) before choosing a new key. Nothing was written.', problems());
      const P0 = LP.project(r, V, c.intent, { who });
      return done({ loop: V.loop, status: 'already', request: { id, file }, preview: 'Already requested. Nothing written. ' + V.rollup.summary + '.', summary: V.rollup.summary, added: [], proposed: [], excluded: [], restored: [], children: [], impact: P0.impact, runsStarted: 0 });
    }
    if (problems().length) return held('Part of the team folder this depends on couldn\'t be read, so nothing was written. Check folder availability, then retry with the same key.');
    if (V.ledger.held.length) return held('This loop has a scope record this computer can\'t read yet (' + V.ledger.held.map((h) => h.record).join(', ') + '). Nothing written. Check folder availability, then retry.');
    const P = LP.project(r, V, c.intent, { who });
    if (P.overLimit) return failOut('invalid', 'This would put ' + P.overLimit.count + ' stories in scope; the loop takes at most ' + P.overLimit.max + '. Nothing is cut and nothing was written.', problems());
    const f = LP.buildRequest(c.intent, { seen: P.seen, children: P.record.children, now: new Date().toISOString(), app: eng.version });
    const data = (status) => ({ loop: V.loop, status, request: { id, file }, preview: LP.previewText(P, { title, dryRun: status === 'would-request', problems: problems() }),
      added: P.added, proposed: P.proposed.map((p) => ({ uid: p.uid, key: p.key, title: p.title, run: p.run || null, recorder: p.recorder ? nameOf(p.recorder) : null, open: !!p.open, answered: p.answered || 0, total: p.total || 0 })),
      excluded: P.excluded, restored: P.restored, children: P.children, impact: P.impact, observation: P.observation, runsStarted: 0, membershipVisible: false });
    if (dryRun) return done(data('would-request'));
    let res;
    try { res = writeOnce(dir, ['proposals'], id + '.json', LP.text(f)); } catch (e) { return failOut('failed', UNCERTAIN + ' (' + (e && e.message || String(e)) + ')', problems()); }
    if (res !== 'written') return failOut('failed', UNCERTAIN, problems());
    return done(data('requested'));
  } catch (e) {
    return failOut('failed', e instanceof Refused ? e.message : 'The team folder couldn\'t be read: ' + (e && e.message || String(e)) + (writes ? ' Nothing was written.' : ''), problems());
  }
}
/* loop review: a person's decision (--as) on proposed removals, --accept to remove them or --keep to keep them, one immutable
   file per request that proposed them, named from the tool and key so a retry writes nothing. */
async function loopReview(eng, o) {
  const PF = eng.PF, LP = PF.loop, V = o.V, val = o.val;
  const acc = val['--accept'], keep = val['--keep'];
  if ((acc == null) === (keep == null)) return o.usage('say --accept ABC-103,ABC-107 to remove them, or --keep ... to keep them in scope.');
  if (!val['--as'] || !/^[A-Za-z0-9_.-]{1,80}$/.test(val['--as'])) return o.usage('say whose decision this is with --as <person id from people.json>. It is recorded as theirs, on their behalf.');
  const keys = String(acc != null ? acc : keep).split(/[\s,]+/).filter(Boolean), op = acc != null ? 'accept' : 'keep';
  const items = keys.map((k) => V.ledger.items.filter((i) => i.key === k)[0]);
  const notPending = keys.filter((k, i) => !items[i] || !(items[i].state === 'proposed' || items[i].review.length));
  if (notPending.length) return o.failOut('invalid', notPending.join(', ') + (notPending.length === 1 ? ' isn\'t' : ' aren\'t') + ' waiting for a removal decision. Read the loop again. Nothing was written.', o.problems());
  if (o.problems().length) return o.held('Part of the team folder this depends on couldn\'t be read, so nothing was written. Check folder availability, then retry with the same key.');
  const by = Object.create(null);
  items.forEach((x) => { const p = x.proposal || x.proposedBy || ''; (by[p] = by[p] || []).push(x.uid); });
  if (by['']) return o.failOut('invalid', 'Some of these items were decided two ways at once by exclusions or restorations, not proposed removals. Use flightdeck loop exclude or restore to decide them. Nothing was written.', o.problems());
  const files = Object.keys(by).sort().map((p) => LP.buildDecision({ proposal: p, loop: V.loop, op, items: by[p], seen: V.ledger.heads, reason: val['--reason'] || '', by: val['--as'], onBehalf: o.tool.name,
    writer: o.tool.name, rev: PF.sha256.hex(JSON.stringify([val['--key'], p])).slice(0, 8), now: new Date().toISOString(), app: eng.version }));
  const preview = (o.dryRun ? 'Would record' : 'Recorded') + ' ' + val['--as'] + '\'s decision to ' + (op === 'accept' ? 'remove ' : 'keep ') + keys.join(', ') + (op === 'accept' ? ' from scope. Their assessment runs remain available.' : ' in scope.') + (o.dryRun ? ' Nothing was written.' : '');
  const data = (status) => ({ loop: V.loop, status, decisions: files.map((f) => ({ file: 'proposals/' + f.name, items: f.file.items })), preview, runsStarted: 0 });
  if (o.dryRun) return o.done(data('would-request'));
  let all = 'written';
  for (const f of files) {
    let res;
    try { res = writeOnce(o.dir, ['proposals'], f.name, LP.text(f.file)); } catch (e) { return o.failOut('failed', UNCERTAIN, o.problems()); }
    if (res !== 'written') all = 'already';
  }
  return o.done(data(all === 'written' ? 'requested' : 'already'));
}

function main(argv) {
  const out = [];
  /* Reading for other apps has flags of its own (--version takes a number there), so it's parsed apart. */
  const first = argv.filter((a) => !a.startsWith('--'))[0];
  if (READS.indexOf(first) >= 0 && !argv.includes('--help')) return readMain(argv);
  if (first === 'draft' && !argv.includes('--help')) return draftMain(argv);
  if (first === 'plan' && !argv.includes('--help')) return requestMain(argv);
  if (first === 'skill' && !argv.includes('--help')) return skillMain(argv);
  if (first === 'report' && !argv.includes('--help')) return reportMain(argv);
  if (first === 'type' && !argv.includes('--help')) return typeMain(argv);
  if (first === 'library' && !argv.includes('--help')) return libraryMain(argv);
  if (first === 'loop' && !argv.includes('--help')) return loopMain(argv);
  const ti = argv.indexOf('--to'), to = ti >= 0 ? argv[ti + 1] : null;
  if (ti >= 0 && (!to || to.startsWith('--'))) fail('say which folder after --to, for example: flightdeck skills --to ~/skills');
  /* Flags that take a value: the value is never read as a command or a folder. */
  const VALUED = ['--to', '--run', '--process', '--from', '--through', '--tz', '--out'], val = {};
  VALUED.forEach((f) => { const i = argv.indexOf(f); if (i >= 0) { if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail('say what goes after ' + f); val[f] = argv[i + 1]; } });
  const args = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.indexOf(argv[i - 1]) >= 0));
  const force = argv.includes('--force'), check = argv.includes('--check'), appOnly = argv.includes('--app-only');
  const cmd = args[0];
  if (!cmd || cmd === 'help' || argv.includes('--help')) return { out: HELP, code: 0 };
  if (cmd === 'version' || argv.includes('--version')) return { out: versionOf(app()) || 'unknown', code: 0 };
  if (cmd === 'path') { app(); return { out: APP, code: 0 }; }
  if (cmd === 'install') {
    const dir = folderArg(args[1]), html = app(), mine = versionOf(html);
    /* Before 1.9.0 the app was preflight.html. If the folder still has it, update it too: people who open that file keep
       their browser-saved state (it's tied to the file's address), and older copies looking for it see the update. */
    const keepOld = inside(dir, [OLD]) !== null;
    const appS = appStatus(dir, NAME, html, mine, force), oldS = keepOld ? appStatus(dir, OLD, html, mine, force) : { status: 'current' };
    const appSt = appS.status, oldSt = oldS.status;
    const all = examples(html), t = { dir, updates: ['.flightdeck', 'updates'], recordAt: ['.flightdeck', 'installed.json'], version: mine, home: 'the team folder' };
    const files = appOnly ? [] : [AGENTS].concat(Object.keys(all).filter((p) => p.startsWith(SKILLS + '/'))).filter((k) => all[k] != null).map((k) => ({ key: k, rel: k, text: all[k] }));
    if (check) {
      const items = appOnly ? [] : contract(t, files, { html, force, check });
      out.push('Flightdeck ' + mine + ' in ' + dir + ':');
      if (appSt !== 'current') out.push('  ' + (appSt === 'new' ? 'will be added' : 'update available').padEnd(28) + NAME);
      if (oldSt !== 'current') out.push('  ' + 'update available'.padEnd(28) + OLD);
      report(items, true, out);
      pointerLines(items, out);
      notes(t, out);
      const code = exitFor([appSt === 'current' ? 'current' : 'update', oldSt === 'current' ? 'current' : 'update'].concat(items.map((i) => i.status)));
      if (code === EXIT.none) out.push('  Nothing to do.');
      const why = code === EXIT.merge ? mergeWhy(items, mine, true) : null;
      if (why) out.push(why.text);
      if (code === EXIT.merge) out.push('Files marked "needs merge" go to .flightdeck/updates/' + mine + '/ when you install.');
      return { out: out.join('\n'), code };
    }
    /* Everything is checked before anything is written, so a refusal (a link, say) leaves the folder as it was. */
    if (!appOnly) contract(t, files, { html, force, check: true, room: true, more: [[NAME, appS], [OLD, oldS]].filter(([file, st]) => st.status !== 'current' && (file !== OLD || keepOld)).map(([file]) => [file]) });
    t.changed = [];
    [[NAME, appS], [OLD, oldS]].forEach(([file, st]) => {
      if (st.status === 'current' || (file === OLD && !keepOld)) return;
      if (st.text !== null) keepCopy(t, [file], st.text);
      try { safeWrite(dir, [file], html, st.text); } catch (e) { if (!(e instanceof Changed)) throw e; t.changed.push(file); }
    });
    const appChanged = t.changed.slice();
    const items = appOnly ? [] : contract(t, files, { html, force, restate: true });
    t.changed = appChanged.concat(t.changed || []);
    out.push('Installed Flightdeck ' + mine + ' at ' + path.join(dir, NAME) + (keepOld ? '\nAlso updated ' + path.join(dir, OLD) + ' (the same app under its old name)' : ''));
    if (!appOnly) {
      out.push(items.every((i) => i.status === 'current') ? 'AGENTS.md and the skills are up to date.' : 'AGENTS.md and the skills:');
      report(items, false, out);
      if (items.some((i) => i.status === 'merge')) out.push(mergeLine(items, dir, mine));
      pointerLines(items, out);
    }
    if (t.replacedAt) out.push('Copies of the files it replaced are in ' + path.join(dir, ...t.replacedAt));
    notes(t, out);
    out.push('Open ' + NAME + ' in Edge or Chrome, choose Open team folder, and pick ' + dir);
    return { out: out.join('\n'), code: t.changed.length ? EXIT.error : 0 };
  }
  if (cmd === 'skills') {
    /* Without --to the skills go in <team folder>/.flightdeck/skills. With --to they go straight into that folder, which
       is created if it's missing; its record and updates sit beside the skills, in hidden names an assistant won't load. */
    const html = app(), mine = versionOf(html);
    let t;
    if (to) {
      const target = expand(to);
      if (check && !fs.existsSync(target)) {
        const n = skillFiles(html).length;
        return { out: n + ' skill files will be added to ' + target, code: EXIT.updates };
      }
      try { fs.mkdirSync(target, { recursive: true }); } catch (e) { fail('couldn\'t create "' + target + '": ' + e.message); }
      t = { dir: folderArg(target, 'skills --to'), updates: ['.flightdeck-updates'], recordAt: ['.flightdeck-installed.json'], version: mine, home: 'the skills folder' };
    } else {
      t = { dir: folderArg(args[1], 'skills'), updates: ['.flightdeck', 'updates'], recordAt: ['.flightdeck', 'installed.json'], version: mine, home: 'the team folder' };
    }
    /* Records and the updates folder name files relative to the folder they're in; the baselines always use the team folder's names. */
    const files = skillFiles(html).map((f) => ({ key: to ? f.path : SKILLS + '/' + f.path, rel: to ? f.path : SKILLS + '/' + f.path, baseKey: SKILLS + '/' + f.path, text: f.text }));
    const items = contract(t, files, { html, force, check, restate: !!to });
    const where = to ? t.dir : path.join(t.dir, ...SKILLS.split('/'));
    if (check) {
      out.push('Skills in ' + where + ':');
      report(items, true, out);
      notes(t, out);
      const code = exitFor(items.map((i) => i.status));
      if (code === EXIT.none) out.push('  Nothing to do.');
      return { out: out.join('\n'), code };
    }
    const written = items.filter((i) => ['update', 'new', 'missing', 'forced'].includes(i.status)).length;
    out.push(written + ' skill file' + (written === 1 ? '' : 's') + ' written to ' + where);
    report(items.filter((i) => i.status !== 'update' && i.status !== 'new'), false, out);
    if (t.replacedAt) out.push('Copies of the files it replaced are in ' + path.join(t.dir, ...t.replacedAt));
    if (items.some((i) => i.status === 'merge')) out.push('Some files you changed were also changed in this version. The new defaults are in ' + path.join(t.dir, ...t.updates, mine) + ', with a README.md for your AI assistant. Use --force to replace your versions instead.');
    notes(t, out);
    return { out: out.join('\n'), code: t.changed.length ? EXIT.error : 0 };
  }
  if (cmd === 'backup') {
    const dir = folderArg(args[1], 'backup'), r = backup(dir, to);
    out.push('Backed up ' + r.files + ' file' + (r.files === 1 ? '' : 's') + ' (' + size(r.bytes) + ') to ' + r.dest);
    if (r.links || r.tmp) out.push('Skipped ' + [r.links ? r.links + ' link' + (r.links === 1 ? '' : 's') : '', r.tmp ? r.tmp + ' temporary file' + (r.tmp === 1 ? '' : 's') : ''].filter(Boolean).join(' and ') + '.');
    return { out: out.join('\n'), code: 0 };
  }
  if (cmd === 'export') return exportPack({ folder: args[1], run: val['--run'], process: val['--process'], from: val['--from'], through: val['--through'], tz: val['--tz'], out: val['--out'], noAttachments: argv.includes('--no-attachments') });
  if (cmd === 'open') {
    app();
    /* The path is passed as data to a launcher, never through a shell (cmd would expand %VARIABLES% in it). */
    const [bin, ...rest] = process.platform === 'darwin' ? ['open', APP] : process.platform === 'win32' ? ['explorer.exe', APP] : ['xdg-open', APP];
    const child = spawn(bin, rest, { stdio: 'ignore', detached: true });
    child.on('error', () => { process.stderr.write('flightdeck: couldn\'t open a browser. Open this file in Edge or Chrome: ' + APP + '\n'); process.exitCode = 1; });
    child.unref();
    return { out: '', code: 0 };
  }
  fail('unknown command "' + cmd + '". Try: flightdeck help');
}

if (require.main === module) {
  const done = (r) => { if (r.out) process.stdout.write(r.out + '\n'); process.exitCode = r.code; };
  const failed = (e) => { process.stderr.write('flightdeck: ' + (e instanceof Refused ? e.message : (e && e.message) || String(e)) + '\n'); process.exitCode = EXIT.error; };
  try {
    const r = main(process.argv.slice(2));
    if (r && typeof r.then === 'function') r.then(done, failed); else done(r);
  } catch (e) { failed(e); }
}
module.exports = { _hooks, main, installedNewer, parseRecord, decide, mergeReadmeText, nextRecord, baselinesOf: baselines, versionOf, cmp, skillFiles, norm, region, managed, merged, hash, baselineKey, examples, readAdapter, loadEngine, readData, requestData, writeRequest, reportData, writeOnce, EXIT };
