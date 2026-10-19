#!/usr/bin/env node
/* The flightdeck command: puts the one-file app where a team uses it. No dependencies, nothing runs on install, and it
   never touches the network. Every command works on plain files: copy the app and the AI assistant contract (AGENTS.md
   and the skills) into a team folder, add or update the skills anywhere else, back up a team folder, or open the app. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..', 'dist', 'flightdeck.html');
const NAME = 'flightdeck.html', OLD = 'preflight.html', SKILLS = '.flightdeck/skills', AGENTS = 'AGENTS.md';
const BEGIN = '<!-- flightdeck:begin -->', END = '<!-- flightdeck:end -->';
/* --check exit codes, for scripts: nothing to do, updates to install, files that need a person (or an assistant) to merge. */
const EXIT = { none: 0, error: 1, updates: 2, merge: 3 };

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
/* Write a file inside the folder, and only there, never through a link. The text goes to a new temporary file first
   (created exclusively, so it can't be an existing file or a link), then is moved into place, so an interrupted write never
   leaves half a file. Just before the move, the folders are checked again, the temporary file must still be the one this
   process created, and with expect (the text install read, or null for "not there") the file must not have changed since.
   Limit: these checks narrow the window, they can't close it. Someone who can rename folders inside your own team folder
   during the instant between the last check and the move can still redirect it; that's out of scope. Ordinary accidents
   (a link already in the folder, an assistant editing a file mid-install) are caught. */
function safeWrite(dir, parts, text, expect) {
  const name = parts[parts.length - 1], sub = parts.slice(0, -1);
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) fail('refusing to write outside the folder: ' + parts.join('/'));
  const home = folders(dir, sub, true), target = path.join(home, name);
  const was = lstatOrNull(target);
  if (was && (was.isSymbolicLink() || !was.isFile())) fail('refusing to write through a link: ' + target);
  const tmp = path.join(home, '.' + name + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
  let fd = null, mine = null, moved = false;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeSync(fd, text);
    mine = fs.fstatSync(fd);
    fs.closeSync(fd); fd = null;
    folders(dir, sub, false);
    const now = lstatOrNull(tmp);
    if (!now || now.isSymbolicLink() || now.ino !== mine.ino || now.dev !== mine.dev) fail('refusing to write through a link: ' + home);
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
    if (fd !== null) fs.closeSync(fd);
    /* Remove the temporary file only if it's still the one this process made, wherever a swapped folder now points. */
    if (!moved && mine) { const left = lstatOrNull(tmp); if (left && !left.isSymbolicLink() && left.ino === mine.ino && left.dev === mine.dev) fs.unlinkSync(tmp); }
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
    if (have === want) return Object.assign(item, { status: 'current' });
    if ((base[f.baseKey || baselineKey(f.key)] || {})[have]) return Object.assign(item, { status: 'update' });
    if (force) return Object.assign(item, { status: 'forced' });
    if (item.staged.length) return Object.assign(item, { status: 'merge', waiting: item.staged.map((x) => x.version).join(', ') });
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
  const files = {};
  keys.forEach((k) => { if (Object.prototype.hasOwnProperty.call(r.files, k)) files[k] = r.files[k]; });
  return { version: r.version, files };
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
    if (['current', 'kept'].includes(i.status) || (i.status === 'merge' && i.waiting)) continue;
    try {
      if (i.status === 'merge') { safeWrite(t.dir, t.updates.concat(t.version, i.rel.split('/')), i.text, null); continue; }
      const out = merged(i);
      if (opts.force && i.now !== null && i.now !== out) keepCopy(t, i.parts, i.now);
      safeWrite(t.dir, i.parts, out, i.now);
      if (opts.force) i.staged.forEach((x) => fileAway(t, x));
    } catch (e) {
      if (!(e instanceof Changed)) throw e;
      i.changed = true; t.changed.push(i.rel);
    }
  }
  const merges = items.filter((i) => i.status === 'merge' && !i.changed);
  if (merges.some((i) => !i.waiting)) safeWrite(t.dir, t.updates.concat(t.version, 'README.md'), mergeReadme(t.version, merges.filter((i) => !i.waiting || i.staged.some((x) => x.version === t.version)), t));
  const rec = Object.assign({}, t.record.files);
  items.forEach((i) => { if (!i.changed) rec[i.key] = i.want; });
  if (!t.record.ignored && t.record.version === t.version && JSON.stringify(rec) === JSON.stringify(t.record.files)) return items;
  safeWrite(t.dir, t.recordAt, JSON.stringify({ format: 'flightdeck-installed/1', version: t.version, at: now.toISOString(), by: 'cli', files: rec }, null, 2) + '\n');
  return items;
}
/* --force saves each file it replaces in a folder of its own under .flightdeck/updates/<version>/replaced/, made new for
   this run (never one an earlier run used), before replacing anything. */
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

/* Copy a team folder to <dest>/<name> backup <date time>/. Links are skipped, never followed, and so are temporary files. */
function backup(src, toArg) {
  const parent = expand(toArg || path.join(require('os').homedir(), 'Flightdeck backups'));
  const me = fs.statSync(src);
  /* Whether p is the folder or inside it, judged by what each folder above p is (device and inode), never by spelling:
     on a file system that ignores letter case, "Team" and "TEAM" are the same folder. Missing parts are skipped. */
  const within = (p) => {
    for (let cur = p; ; cur = path.dirname(cur)) {
      let st = null;
      try { st = fs.statSync(cur); } catch (e) { /* not there yet */ }
      if (st && st.dev === me.dev && st.ino === me.ino) return true;
      if (path.dirname(cur) === cur) return false;
    }
  };
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

const HELP = `flightdeck: team process checklists, in one HTML file

  flightdeck open                     open the app (it starts on built-in examples)
  flightdeck install <team folder>    copy the app into the team folder as ${NAME}, and add or update the
                                      AI assistant contract there: AGENTS.md and .flightdeck/skills
  flightdeck skills <team folder>     add or update only the skills, in <team folder>/.flightdeck/skills
  flightdeck skills --to <folder>     add or update them in any other folder (an assistant's skills folder, a repo)
  flightdeck backup <team folder>     copy the whole folder to ~/Flightdeck backups (or --to <folder>)
  flightdeck path                     print where the app file is
  flightdeck version                  print this version

  --check     say what install or skills would do, and change nothing. Exit code 0: nothing to do;
              2: updates to install; 3: files your team changed that need merging; 1: an error
  --app-only  install only ${NAME}, not AGENTS.md or the skills
  --force     replace a newer app, an unrecognized file, or contract files your team changed. A copy of
              each replaced file is kept in .flightdeck/updates/<version>/replaced/ first

Files your team changed are never replaced without --force. When this version also changed them, the new
default goes to .flightdeck/updates/<version>/, with a README.md to hand to your AI assistant.`;

function main(argv) {
  const out = [];
  const ti = argv.indexOf('--to'), to = ti >= 0 ? argv[ti + 1] : null;
  if (ti >= 0 && (!to || to.startsWith('--'))) fail('say which folder after --to, for example: flightdeck skills --to ~/skills');
  const args = argv.filter((a, i) => !a.startsWith('--') && !(ti >= 0 && i === ti + 1));
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
      if (force && st.text !== null) keepCopy(t, [file], st.text);
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
    if (t.replacedAt) out.push('Copies of the files --force replaced are in ' + path.join(dir, ...t.replacedAt));
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
    if (t.replacedAt) out.push('Copies of the files --force replaced are in ' + path.join(t.dir, ...t.replacedAt));
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
  try {
    const r = main(process.argv.slice(2));
    if (r.out) process.stdout.write(r.out + '\n');
    process.exitCode = r.code;
  } catch (e) {
    process.stderr.write('flightdeck: ' + (e instanceof Refused ? e.message : (e && e.message) || String(e)) + '\n');
    process.exitCode = EXIT.error;
  }
}
module.exports = { main, versionOf, cmp, skillFiles, norm, region, managed, merged, hash, baselineKey, examples };
