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
    if (expect !== undefined) {
      const st = lstatOrNull(target);
      if (st && (st.isSymbolicLink() || !st.isFile())) fail('refusing to write through a link: ' + target);
      if ((st ? fs.readFileSync(target, 'utf8') : null) !== expect) throw new Changed(parts.join('/'));
    }
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
/* The folder's record, checked field by field. Anyone can edit it, so a record that isn't exactly what this command writes is
   ignored (and said so), and only entries for files this version installs, with a well-formed hash, are read. */
function readRecord(t, keys) {
  const text = readInside(t.dir, t.recordAt), none = { files: {} };
  if (text === null) return none;
  let r = null;
  try { r = JSON.parse(text); } catch (e) { /* reported below */ }
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
  function skipErr(rel, bytes, cap) {
    const e = new Refused(rel + ' is ' + size(bytes) + ', over the ' + size(cap) + ' this command reads');
    e.skipped = true; e.size = bytes;
    if (!skipped.some((x) => x.path === rel)) skipped.push({ path: rel, size: bytes, cap });
    return e;
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
      if (!dir) return res([]);
      const entries = fs.readdirSync(dir.cur, { withFileTypes: true });
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
      try { const data = fs.readFileSync(o.fd); res({ text: new TextDecoder('utf-8').decode(data), size: data.length, mtime: o.st.mtimeMs }); } finally { fs.closeSync(o.fd); }
    }),
    /* A file to read a piece at a time, from the descriptor opened above; close() when done. */
    blob: (p, ro) => new Promise((res) => {
      const o = open(p);
      if (!o) return res(null);
      const cap = (ro && ro.maxBytes) || max;
      if (cap && o.st.size > cap) { fs.closeSync(o.fd); throw skipErr(p, o.st.size, cap); }
      let closed = false;
      res({
        size: o.st.size,
        slice: (a, b) => ({ arrayBuffer: () => new Promise((ok) => {
          const buf = Buffer.alloc(Math.max(0, b - a));
          let got = 0;
          while (got < buf.length) { const n = fs.readSync(o.fd, buf, got, buf.length - got, a + got); if (!n) break; got += n; }
          ok(buf.buffer.slice(buf.byteOffset, buf.byteOffset + got));
        }) }),
        close: () => { if (!closed) { closed = true; fs.closeSync(o.fd); } }
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
/* A run this copy can only list by name: saved by a newer Flightdeck (its format, or fields this copy doesn't know). */
function newerRun(PF, r) { return !!r._unrunnable && (r.snapshot === '' || r._unrunnable.indexOf(PF.run.NEWER) === 0); }
function runProblems(PF, r) {
  const out = [], key = r.process + '/' + r.id, dir = 'runs/' + key + '/';
  if (newerRun(PF, r)) out.push({ path: dir + 'run.json', kind: 'newer', why: '"' + r.title + '" (' + key + '): ' + r._unrunnable });
  if (r._conflicts && r._conflicts.length) out.push({ path: dir, kind: 'conflict', why: 'Conflict copies or lost saves beside this run: ' + r._conflicts.join(', ') + '. A person resolves them in the app.' });
  return out;
}
/* Every problem a whole-folder read found, one per file or folder, before each command keeps those in its scope. */
function folderProblems(PF, d, adapter) {
  const A = PF.appjson, out = [];
  Object.keys(d.failed || {}).forEach((part) => out.push({ path: PART_PATH[part] || part, kind: 'unreadable', why: 'This part of the folder couldn\'t be read: ' + d.failed[part] + '.' }));
  (d.unreadable || []).forEach((u) => out.push({ path: u.path, kind: u.kind || 'unreadable', why: fileWhy(u.why) }));
  (d.nofile || []).forEach((n) => out.push({ path: n.path, kind: 'nofile', why: 'The run folder has no run.json.' }));
  (d.malformed || []).forEach((m) => out.push({ path: m.path, kind: m.kind || 'malformed', why: fileWhy(m.why) }));
  (d.fuUnread || []).forEach((u) => out.push({ path: 'followups/' + u.process + '/' + u._file, kind: 'malformed', why: 'This file couldn\'t be read, or isn\'t a follow-up decision this copy can read.' }));
  (d.corrUnread || []).forEach((u) => out.push({ path: u.dir + '/' + u.process + '/' + u._file, kind: 'malformed', why: 'This file couldn\'t be read, or isn\'t a decision this copy can read.' }));
  (d.processes || []).forEach((proc) => (proc.pubs || []).forEach((p) => { if (!p.ok) { const x = A.pubProblem(p); out.push({ path: 'publications/' + proc.process + '/' + p.folder + '/', kind: x.kind, why: x.why }); } }));
  (d.runs || []).forEach((r) => out.push(...runProblems(PF, r)));
  return out.concat(adapterProblems(adapter));
}
function adapterProblems(adapter) {
  return (adapter.links || []).map((p) => ({ path: p, kind: 'link', why: 'A link. Flightdeck never reads through links.' }))
    .concat((adapter.skipped || []).map((x) => ({ path: x.path, kind: 'skipped', why: 'Too large to read here (' + size(x.size) + '; the limit is ' + size(x.cap) + ').' })));
}
/* Only the problems under these paths (or exactly at one of exact), each once; a file named as a link or as too large isn't
   named again as unreadable. */
function scoped(list, prefixes, exact) {
  const keep = list.filter((p) => prefixes.some((x) => p.path.indexOf(x) === 0) || (exact || []).indexOf(p.path) >= 0);
  const special = {}; keep.forEach((p) => { if (p.kind === 'link' || p.kind === 'skipped') special[p.path] = true; });
  const seen = {};
  return keep.filter((p) => {
    if (special[p.path] && p.kind !== 'link' && p.kind !== 'skipped') return false;
    const k = p.path + '\u0000' + p.kind; if (seen[k]) return false; seen[k] = true; return true;
  });
}

/* eng: { PF, version } (loadEngine()). adapter: a folder with list, read, stat and blob (and links and skipped, as the
   command line's has); it's only ever read through PF.repo.readOnly. req: { cmd, proc, key, version, folder, status, person,
   contract }. Resolves to { code, json }: an envelope (exit 0 or 4) or an error object (exit 1 or 5). */
async function readData(eng, adapter, req) {
  const PF = eng.PF, A = PF.appjson, repo = PF.repo, F = PF.followups, app = eng.version || '';
  const err = (code, kind, why) => ({ code, json: A.failure(app, kind, why) });
  const notFound = (why) => err(EXIT.notFound, 'not-found', why);
  if (req.contract != null && A.VERSIONS.indexOf(+req.contract) < 0) return err(EXIT.error, 'contract', 'This copy of Flightdeck reads contract ' + A.VERSIONS.join(', ') + ' only (' + A.CONTRACT + '). Ask for one of those, or update Flightdeck.');
  const done = (problems, data, readAt) => { const e = A.envelope(app, readAt || new Date().toISOString(), problems, data); return { code: e.complete ? 0 : EXIT.partial, json: e }; };
  const ro = repo.readOnly(adapter, 'Reading for other apps');
  if (req.cmd === 'run' || req.cmd === 'next') {
    const m = RUN_KEY.exec(req.key || '');
    const one = await repo.readRunOnly(ro, m[1], m[2]);
    if (!one.found) return notFound('There\'s no run ' + req.key + ' in the team folder.');
    const r = one.run, key = m[1] + '/' + m[2], problems = [];
    if (one.nofile) problems.push({ path: 'runs/' + key + '/run.json', kind: 'nofile', why: 'The run folder has no run.json.' });
    one.bad.forEach((b) => problems.push({ path: b.path, kind: b.kind || 'unreadable', why: fileWhy(b.why) }));
    one.fuUnread.forEach((u) => problems.push({ path: u.path, kind: u.kind || 'malformed', why: fileWhy(u.why) }));
    if (one.peopleWhy) problems.push({ path: 'people.json', kind: one.peopleKind || 'unreadable', why: fileWhy(one.peopleWhy) });
    const prefixes = ['runs/' + key + '/', 'followups/' + m[1] + '/' + m[2] + '.'], exact = ['people.json', 'followups/', 'followups/' + m[1], 'followups/' + m[1] + '/', 'runs/', 'runs/' + m[1], 'runs/' + key];
    let usable = r && !newerRun(PF, r);
    if (r) {
      problems.push(...runProblems(PF, r));
      prefixes.push('publications/' + r.process + '/' + r.folder + '/'); exact.push('publications/' + r.process + '/' + r.folder);
      /* The version's own record says it can't be used here: named at the version, as processes does. */
      if (usable && r._unrunnable && !PF.publish.unrunnable(r.snapshot, r.types)) problems.push({ path: 'publications/' + r.process + '/' + r.folder + '/', kind: r._unrunnable === PF.publish.NEWER ? 'newer' : 'unusable', why: r._unrunnable });
    }
    const all = scoped(problems.concat(adapterProblems(adapter)), prefixes, exact);
    const nameOf = A.names(one.people);
    if (req.cmd === 'run') return done(all, usable ? A.run(r, F.list([r], one.fuDecisions), nameOf) : { run: null });
    return done(all, usable ? A.next(r, nameOf, req.person || null) : { run: key, person: req.person ? nameOf(req.person) : null, next: null, mine: null });
  }
  const d = await repo.loadAll(ro, { readOnly: true, explain: true, deep: true });
  const nameOf = A.names(d.people), every = folderProblems(PF, d, adapter);
  const runs = d.runs.filter((r) => !newerRun(PF, r));
  const known = (p) => d.processes.some((x) => x.process === p) || d.runs.some((r) => r.process === p) || d.plans.some((x) => x.process === p);
  if (req.proc && !known(req.proc)) return notFound('There\'s no process ' + req.proc + ' in the team folder.');
  /* A command's scope, as folders: a problem in one, or at the folder itself or any folder above it (a part that failed, a
     linked folder), counts. */
  const above = (x) => x.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'));
  const within = (dirs) => scoped(every, dirs.map((x) => x + '/'), [].concat(...dirs.map(above)).reduce((o, y) => o.concat([y, y + '/']), []));
  const sub = (top) => top + (req.proc ? '/' + req.proc : '');
  if (req.cmd === 'processes') return done(within(['publications']), A.processes(d.processes), d.readAt);
  if (req.cmd === 'process') {
    const proc = d.processes.filter((x) => x.process === req.proc)[0];
    if (!proc || !proc.pubs.length) return notFound('There\'s no published checklist for ' + req.proc + ' in the team folder.');
    let pub = null;
    const vOf = (p) => (p.info && typeof p.info.version === 'number' ? p.info.version : PF.publish.versionOf(p.folder));
    if (req.folder) pub = proc.pubs.filter((p) => p.folder === req.folder)[0];
    else if (req.version != null) pub = proc.pubs.filter((p) => vOf(p) === +req.version).sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0) || (a.folder < b.folder ? -1 : 1))[0];
    else pub = proc.index.latest || proc.pubs.slice().sort((a, b) => (vOf(b) || 0) - (vOf(a) || 0))[0];
    if (!pub) return notFound('There\'s no version ' + (req.folder || req.version) + ' of ' + req.proc + ' in the team folder.');
    return done(within(['publications/' + req.proc]), A.process(proc, pub), d.readAt);
  }
  if (req.cmd === 'runs') {
    const st = req.status || 'all', mine = (p) => !req.proc || p === req.proc;
    const list = runs.filter((r) => mine(r.process) && (st === 'all' || (st === 'running' && !r.ended) || (st === 'ended' && !!r.ended)));
    const plans = st === 'all' || st === 'planned' ? d.plans.filter((p) => mine(p.process)) : [];
    return done(scoped(within([sub('runs'), 'proposals']).concat(every.filter((p) => p.path === 'people.json')), [''], []), A.runs(list, plans, nameOf), d.readAt);
  }
  /* followups: every run's follow-ups come from its run.json, so any run that couldn't be read may hide some. */
  const items = F.list(runs.filter((r) => !req.proc || r.process === req.proc), d.fuDecisions).filter((x) => req.status !== 'open' || F.isOpen(x));
  return done(scoped(within([sub('followups'), sub('runs')]).concat(every.filter((p) => p.path === 'people.json')), [''], []), A.followUps(items, nameOf), d.readAt);
}

/* The command line around readData: flags, the folder, the engine, and JSON out. Usage problems before any reading exit 1. */
async function readMain(argv) {
  const VAL = ['--process', '--status', '--person', '--version', '--folder', '--contract'], val = {};
  for (const f of VAL) { const i = argv.indexOf(f); if (i >= 0) { if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail('say what goes after ' + f); val[f] = argv[i + 1]; } }
  const args = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VAL.indexOf(argv[i - 1]) >= 0));
  const cmd = args[0];
  if (!argv.includes('--json')) fail(cmd + ' prints JSON for other apps. Add --json, for example: flightdeck ' + cmd + ' <team folder> --json');
  const usage = (why) => ({ out: JSON.stringify(failureJson(null, 'usage', why), null, 2), code: EXIT.error });
  const req = { cmd, proc: val['--process'] || null, status: val['--status'] || null, person: val['--person'] || null, version: val['--version'] || null, folder: val['--folder'] || null, contract: val['--contract'] || null };
  if (cmd === 'process') { req.proc = args[2]; if (!req.proc || !PROC_ID.test(req.proc)) return usage('say which process, for example: flightdeck process <team folder> release --json'); }
  if (cmd === 'run' || cmd === 'next') { req.key = args[2]; if (!req.key || !RUN_KEY.test(req.key)) return usage('say which run as <process>/<run id>, for example: flightdeck ' + cmd + ' <team folder> release/k3m9p2q8 --json'); }
  if (req.proc && !PROC_ID.test(req.proc)) return usage('a process ID is lowercase letters, numbers and dashes.');
  if (req.version != null && !/^\d{1,6}$/.test(req.version)) return usage('--version is a version number, like 3.');
  if (req.folder != null && !/^v\d+-[a-z0-9]+$/.test(req.folder)) return usage('--folder is a version folder, like v3-k3m9p2q8.');
  if (req.contract != null && !/^\d{1,4}$/.test(req.contract)) return usage('--contract is a contract number, like 1.');
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
function failureJson(eng, kind, why) { return eng ? eng.PF.appjson.failure(eng.version, kind, why) : { contract: 'flightdeck-read/1', app: versionOf(app()) || '', error: { kind, why } }; }

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
  flightdeck process <team folder> <process> [--version N | --folder v3-...] --json
                                      one version's phases, steps, gates and evidence (the latest usable one
                                      unless you say)
  flightdeck runs <team folder> [--process <id>] [--status running|planned|ended|all] --json
                                      runs and planned runs
  flightdeck run <team folder> <process>/<run id> --json
                                      one run: each step's state, who and when, its evidence, gates, follow-ups
  flightdeck next <team folder> <process>/<run id> [--person <id>] --json
                                      what's waiting in a run and on whom (with --person, that person's next step)
  flightdeck followups <team folder> [--process <id>] [--status open|all] --json
                                      every follow-up and what became of it
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
module.exports = { main, versionOf, cmp, skillFiles, norm, region, managed, merged, hash, baselineKey, examples, readAdapter, loadEngine, readData, EXIT };
