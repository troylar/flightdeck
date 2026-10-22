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
   A copy still waiting in .flightdeck/updates/<any version>/ keeps a file at merge until someone deletes the copy.
   With --force, kept and merge files are replaced too, after a copy is saved. */
function classify(t, files, base, force) {
  return files.map((f) => {
    const parts = f.rel.split('/'), now = readInside(t.dir, parts), want = hash(managed(f.key, f.text));
    const item = { key: f.key, rel: f.rel, parts, text: f.text, now, want, staged: staged(t, f.rel) };
    if (now === null) return Object.assign(item, { status: t.record.files[f.key] ? 'missing' : 'new' });
    const have = hash(managed(f.key, now));
    /* Still waiting on a merge. When this version's default is new to the person (not already staged, not what the file
       already says), it's staged too, so an older pending merge never hides newer instructions. */
    if (item.staged.length && !force) return Object.assign(item, { status: 'merge', waiting: item.staged.map((x) => x.version).join(', '),
      stage: have !== want && !item.staged.some((x) => x.version === t.version || hash(managed(f.key, x.text)) === want) });
    if (have === want) return Object.assign(item, { status: 'current' });
    if ((base[f.baseKey || baselineKey(f.key)] || {})[have]) return Object.assign(item, { status: 'update' });
    if (force) return Object.assign(item, { status: 'forced' });
    if (t.record.files[f.key] === want) return Object.assign(item, { status: 'kept' });
    return Object.assign(item, { status: 'merge' });
  });
}
/* The versions under the updates folder, and which of them hold a copy of rel still waiting to be merged. */
function versionsStaged(t) {
  if (t.versions) return t.versions;
  const home = folders(t.dir, t.updates, false);
  t.versions = home ? fs.readdirSync(home).filter((v) => /^(\d+\.\d+\.\d+|dev)$/.test(v) && folders(t.dir, t.updates.concat(v), false)) : [];
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
function installedNewer(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return '';
  const m = typeof r.format === 'string' ? /^([a-z][a-z0-9-]{1,59})\/([1-9]\d{0,3})$/.exec(r.format) : null;
  if ((m && m[1] === 'flightdeck-installed' && m[2] !== '1') || (m && m[1] === 'flightdeck-installed' && (Array.isArray(r.features) ? r.features.length > 0 : r.features != null))) return 'was written by a newer Flightdeck' + (typeof r.version === 'string' && /^\d+\.\d+\.\d+$/.test(r.version) ? ' (' + r.version + ')' : '') + '.';
  return '';
}
/* The folder's record, checked field by field. Anyone can edit it, so a record that isn't exactly what this command writes is
   ignored (and said so), and only entries for files this version installs, with a well-formed hash, are read. */
function readRecord(t, keys) {
  const text = readInside(t.dir, t.recordAt), none = { files: {} };
  if (text === null) return none;
  let r = null;
  try { r = JSON.parse(text); } catch (e) { /* reported below */ }
  const newer = installedNewer(r);
  if (newer) fail(path.join(t.dir, ...t.recordAt) + ' ' + newer + ' Nothing was changed. Use the newer Flightdeck package.');
  const ok = r && typeof r === 'object' && !Array.isArray(r) && r.format === 'flightdeck-installed/1' && typeof r.version === 'string' && /^(\d+\.\d+\.\d+|dev)$/.test(r.version)
    && typeof r.at === 'string' && (r.by === 'cli' || r.by === 'app') && r.files && typeof r.files === 'object' && !Array.isArray(r.files)
    && Object.keys(r.files).every((k) => typeof r.files[k] === 'string' && /^[0-9a-f]{64}$/.test(r.files[k]));
  if (!ok) return Object.assign(none, { ignored: true });
  /* files: what this command may consult; all: every entry, kept as it is for files this command doesn't handle. */
  const files = {};
  keys.forEach((k) => { if (Object.prototype.hasOwnProperty.call(r.files, k)) files[k] = r.files[k]; });
  return { version: r.version, files, all: Object.assign({}, r.files) };
}
function stamp(d) { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + p(d.getMinutes()); }
function fineStamp(d) { const p = (n, w) => String(n).padStart(w || 2, '0'); return stamp(d).replace(' ', '-') + p(d.getSeconds()) + '-' + p(d.getMilliseconds(), 3); }

function mergeReadme(version, items, t) {
  const here = t.updates.concat(version).join('/');
  return `# Flightdeck ${version}: files to merge

Flightdeck ${version} changed these files, and your team changed them too, so the update left your versions in place:

${items.map((i) => '- `' + i.rel + '`' + (i.key === AGENTS ? ' (only the part between the flightdeck markers)' : '')).join('\n')}

The new default of each file is in this folder (\`${here}/\`), at the same path it has in ${t.home}.

## Ask your AI assistant to merge them

Open your AI assistant in ${t.home}, and give it this:

> Flightdeck ${version} put new default versions of some files in \`${here}/\`; its README.md lists them. For each one, compare the new default with our file at the same path. Keep our own changes, and bring in what the new default adds or changes. In AGENTS.md, change only the part between \`<!-- flightdeck:begin -->\` and \`<!-- flightdeck:end -->\`; anything that is ours belongs under Team notes, below the end marker. Show me each change before you save it. When a file is merged, delete its copy here. When only README.md is left, delete this folder.

Then run the same flightdeck command with \`--check\`: exit code 0 means nothing is left to merge.
`;
}

/* install and skills: one routine for the team folder, and for skills --to <dir>. */
function contract(t, files, opts) {
  const base = baselines(opts.html), now = new Date();
  inside(t.dir, t.updates.concat(t.version, 'replaced'));
  t.record = readRecord(t, files.map((f) => f.key));
  t.changed = [];
  const items = classify(t, files, base, opts.force);
  if (opts.check) return items;
  for (const i of items) {
    if (['current', 'kept'].includes(i.status) || (i.status === 'merge' && i.waiting && !i.stage)) {
      if (opts.force) i.staged.forEach((x) => fileAway(t, x));
      continue;
    }
    try {
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
  if (merges.some((i) => !i.waiting || i.stage)) safeWrite(t.dir, t.updates.concat(t.version, 'README.md'), mergeReadme(t.version, merges.filter((i) => !i.waiting || i.stage || i.staged.some((x) => x.version === t.version)), t));
  const rec = Object.assign({}, t.record.all || {});
  items.forEach((i) => { if (!i.changed) rec[i.key] = i.want; });
  if (!t.record.ignored && t.record.version === t.version && JSON.stringify(rec) === JSON.stringify(t.record.all)) return items;
  safeWrite(t.dir, t.recordAt, JSON.stringify({ format: 'flightdeck-installed/1', version: t.version, at: now.toISOString(), by: 'cli', files: rec }, null, 2) + '\n');
  return items;
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
}
/* What install says after the file list: an ignored record, and files left alone because they changed while it ran. */
function notes(t, out) {
  if (t.record && t.record.ignored) out.push('Ignored ' + t.recordAt.join('/') + ': it isn\'t a record this version of Flightdeck wrote, so it wasn\'t trusted. A new one was written.');
  if (t.changed && t.changed.length) out.push('Left as they are, because they changed while install was running: ' + t.changed.join(', ') + '. Run the command again.');
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
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Blob, TextEncoder, TextDecoder, performance: { now: () => performance.now() } });
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
    try { fd = fs.openSync(f.full, fs.constants.O_RDONLY | NOFOLLOW); } catch (e) { if (e.code === 'ELOOP') throw linkErr(p); if (e.code === 'ENOENT') return null; throw e; }
    try {
      const st = fs.fstatSync(fd), now = lstatOrNull(path.join(sameWalk(f.a, f.ids, p), f.name));
      if (!st.isFile() || st.ino !== f.st.ino || st.dev !== f.st.dev || !now || now.isSymbolicLink() || now.ino !== st.ino || now.dev !== st.dev) throw linkErr(p);
      return { fd, st };
    } catch (e) { fs.closeSync(fd); throw e; }
  }
  return {
    links, skipped,
    list: (p) => new Promise((res) => {
      const a = partsOf(p), dir = dirAt(a);
      /* No such folder: empty, and marked missing, so a reader that saw it listed can tell gone from empty. */
      if (!dir) { const none = []; none.missing = true; return res(none); }
      let entries;
      try { entries = fs.readdirSync(dir.cur, { withFileTypes: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; const none = []; none.missing = true; return res(none); }
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
  return out;
}
function adapterProblems(adapter) {
  return (adapter.links || []).map((p) => ({ path: p, kind: 'link', why: 'A link. Flightdeck never reads through links.' }))
    .concat((adapter.skipped || []).map((x) => ({ path: x.path, kind: 'skipped', why: 'Too large to read here (' + (x.more ? 'more than ' : '') + size(x.size) + '; the limit is ' + size(x.cap) + ').' })));
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
      if (req.cmd === 'run') return done(keep, usable ? (two ? A.run2 : A.run)(r, F.list([r], one.fuDecisions), nameOf) : { run: null });
      return done(keep, usable ? A.next(r, nameOf, req.person || null) : { run: key, person: req.person ? nameOf(req.person) : null, next: null, mine: null });
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
      return done(all, two ? A.runs2(list, plans, nameOf, d.processes, unsure, leftOut) : A.runs(list, plans, nameOf, d.processes, unsure), d.readAt);
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
async function draftMain(argv) {
  const VAL = ['--session', '--expect', '--from', '--base', '--label', '--by', '--note'], val = {};
  const args = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VAL.indexOf(argv[i - 1]) >= 0));
  const sub = args[1], usage = (why) => draftFail(null, 'usage', why);
  for (const f of VAL) {
    const i = argv.indexOf(f);
    if (i < 0) continue;
    if (argv[i + 1] == null || (argv[i + 1].startsWith('--') && argv[i + 1] !== '-')) return usage('say what goes after ' + f + '.');
    val[f] = argv[i + 1];
  }
  if (['read', 'save', 'propose'].indexOf(sub) < 0) return usage('say read, save or propose, for example: flightdeck draft read <team folder> <process> --json');
  if (!argv.includes('--json')) return usage('flightdeck draft prints JSON. Add --json.');
  const proc = args[3];
  if (!proc || !PROC_ID.test(proc)) return usage('a process ID is lowercase letters, numbers and dashes, for example: flightdeck draft ' + sub + ' <team folder> release --json');
  if (val['--session'] != null && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(val['--session'])) return usage('--session is lowercase letters, numbers and dashes, like the one draft read gave.');
  let eng, dir;
  try { eng = loadEngine(); dir = folderArg(args[2], 'draft ' + sub); } catch (e) { return draftFail(eng, 'failed', e.message); }
  const PF = eng.PF, PP = PF.proposals, U = PF.util, M = PF.map, now = Date.now();
  const session = val['--session'] || 's-' + U.randomId(12);
  const checksOf = (t) => { const c = M.check(M.parse(t), { people: [], types: {}, workflows: {}, processes: [] }); return { blockers: c.blockers, suggestions: c.suggestions }; };
  try {
    if (sub === 'read') {
      const s = await draftState(eng, dir, proc, session);
      if (!s.draft.exists && !s.versions.length && !s.judged.length) return draftFail(eng, 'not-found', 'There\'s no draft, published version or proposal for "' + proc + '" in this folder.', EXIT.notFound, s.problems);
      const pending = s.mine.filter((m) => m.pending).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
      const latest = argv.includes('--or-latest') && !s.draft.exists ? s.versions[0] : null;
      const cf = pending ? { rev: pending.rev, kind: 'proposal', ref: pending.id, text: pending.text }
        : s.draft.exists && s.draft.text != null ? { rev: s.draft.rev, kind: 'draft', ref: s.draft.path, text: s.draft.text }
          : latest ? { rev: latest.rev, kind: 'version', ref: latest.folder, text: latest.text } : { rev: PP.sha(''), kind: 'none', ref: null, text: '' };
      const out = draftJson(eng, { process: proc, session, draft: s.draft, openIn: s.presence.openIn, mine: s.mine.map((m) => ({ id: m.id, rev: m.rev, status: m.status, text: m.text })),
        continueFrom: cf, checks: checksOf(cf.text), copies: s.copies, readAt: new Date(now).toISOString(), complete: s.problems.length === 0, problems: s.problems });
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
    const result = { process: proc, session, operation, outcome: null, why: null, link: base.link, rev: PP.sha(text), file: null, ids: PP.ids(base.text, text), checks: checksOf(text), warnings: [], history: null };
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
    return draftFail(eng, 'failed', e instanceof Refused ? e.message : 'The team folder couldn\'t be changed: ' + (e && e.message || String(e)));
  }
}

const HELP = `flightdeck: team process checklists, in one HTML file

  flightdeck open                     open the app (it starts on built-in examples)
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
                                      for other apps: every process and its versions, as JSON
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
  flightdeck skill register <team folder> --from <file|-> [--json]
                                      for AI assistants: register a skill against the exact version it was built
                                      from (Flightdeck 2.0). The only writer of skill-registrations/
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

export never changes the team folder and never writes a pack into it. It prints the pack's SHA-256: keep it somewhere
separate. Exit code 0: a complete pack; 4: a partial pack (made, with what changed or is missing listed); 1: no pack.

Every file install replaces is first copied to .flightdeck/updates/<version>/replaced/ and read back.

Files your team changed are never replaced without --force. When this version also changed them, the new
default goes to .flightdeck/updates/<version>/, with a README.md to hand to your AI assistant.`;

function main(argv) {
  const out = [];
  /* Reading for other apps has flags of its own (--version takes a number there), so it's parsed apart. */
  const first = argv.filter((a) => !a.startsWith('--'))[0];
  if (READS.indexOf(first) >= 0 && !argv.includes('--help')) return readMain(argv);
  if (first === 'draft' && !argv.includes('--help')) return draftMain(argv);
  if (first === 'plan' && !argv.includes('--help')) return requestMain(argv);
  if (first === 'skill' && !argv.includes('--help')) return skillMain(argv);
  if (first === 'report' && !argv.includes('--help')) return reportMain(argv);
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
      notes(t, out);
      const code = exitFor([appSt === 'current' ? 'current' : 'update', oldSt === 'current' ? 'current' : 'update'].concat(items.map((i) => i.status)));
      if (code === EXIT.none) out.push('  Nothing to do.');
      if (code === EXIT.merge) out.push('Files marked "needs merge" go to .flightdeck/updates/' + mine + '/ when you install.');
      return { out: out.join('\n'), code };
    }
    /* Everything is checked before anything is written, so a refusal (a link, say) leaves the folder as it was. */
    if (!appOnly) contract(t, files, { html, force, check: true });
    t.changed = [];
    [[NAME, appS], [OLD, oldS]].forEach(([file, st]) => {
      if (st.status === 'current' || (file === OLD && !keepOld)) return;
      if (st.text !== null) keepCopy(t, [file], st.text);
      try { safeWrite(dir, [file], html, st.text); } catch (e) { if (!(e instanceof Changed)) throw e; t.changed.push(file); }
    });
    const appChanged = t.changed.slice();
    const items = appOnly ? [] : contract(t, files, { html, force });
    t.changed = appChanged.concat(t.changed || []);
    out.push('Installed Flightdeck ' + mine + ' at ' + path.join(dir, NAME) + (keepOld ? '\nAlso updated ' + path.join(dir, OLD) + ' (the same app under its old name)' : ''));
    if (!appOnly) {
      out.push(items.every((i) => i.status === 'current') ? 'AGENTS.md and the skills are up to date.' : 'AGENTS.md and the skills:');
      report(items, false, out);
      if (items.some((i) => i.status === 'merge')) out.push('Your team changed files this version changes too. The new defaults are in ' + path.join(dir, '.flightdeck', 'updates', mine) + '; its README.md has a prompt for your AI assistant to merge them.');
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
    const items = contract(t, files, { html, force, check });
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
module.exports = { _hooks, main, installedNewer, versionOf, cmp, skillFiles, norm, region, managed, merged, hash, baselineKey, examples, readAdapter, loadEngine, readData, requestData, writeRequest, reportData, writeOnce, EXIT };
