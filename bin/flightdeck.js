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
function norm(text) { return String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n'); }
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
/* Write a file inside the folder, and only there, never through a link. The file is written whole to a temporary sibling
   first, then moved into place, so an interrupted write never leaves half a file behind. */
function safeWrite(dir, parts, text) {
  let cur = dir;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    if (!parts[i] || parts[i] === '.' || parts[i] === '..' || !cur.startsWith(dir + path.sep)) fail('refusing to write outside the folder: ' + parts.join('/'));
    let st = null;
    try { st = fs.lstatSync(cur); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (st && st.isSymbolicLink()) fail('refusing to write through a link: ' + cur);
    if (i < parts.length - 1) { if (!st) fs.mkdirSync(cur); else if (!st.isDirectory()) fail(cur + ' isn\'t a folder.'); }
  }
  const tmp = path.join(path.dirname(cur), '.' + path.basename(cur) + '.' + process.pid + '.' + Date.now() + '.tmp');
  try { fs.writeFileSync(tmp, text, { flag: 'wx' }); fs.renameSync(tmp, cur); }
  catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to clean up */ } fail('couldn\'t write ' + cur + ': ' + e.message); }
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
  if (text === null) return 'new';
  if (text === html) return 'current';
  const theirs = versionOf(text);
  if (force) return 'update';
  if (!theirs) fail(path.join(dir, file) + ' isn\'t a Flightdeck app this version recognizes. Use --force to replace it anyway.');
  if (theirs !== 'dev' && mine !== 'dev' && cmp(theirs, mine) > 0) fail(path.join(dir, file) + ' is a newer version (' + theirs + ') than this one (' + mine + '). Update the package, or use --force to replace it anyway.');
  return 'update';
}

/* Sort each contract file into what install does with it:
     current     same as this version's default
     update      an earlier default (or unchanged since it was installed): replaced with this version's
     kept        the team changed it, and this version's default is the one it was based on: left alone
     merge       the team changed it and the default changed too: the new default goes to the updates folder
     new         not there yet: written
     missing     installed before, since deleted: written again
   With --force, kept and merge files are replaced too, after a copy is saved. */
function classify(t, files, base, force) {
  return files.map((f) => {
    const parts = f.rel.split('/'), now = readInside(t.dir, parts), want = hash(managed(f.key, f.text));
    const item = { key: f.key, rel: f.rel, parts, text: f.text, now, want };
    if (now === null) return Object.assign(item, { status: t.record.files && t.record.files[f.key] ? 'missing' : 'new' });
    const have = hash(managed(f.key, now));
    if (have === want) return Object.assign(item, { status: 'current' });
    const known = base[f.baseKey || baselineKey(f.key)] || {};
    if (known[have] || (t.record.files && t.record.files[f.key] === have)) return Object.assign(item, { status: 'update' });
    if (force) return Object.assign(item, { status: 'forced' });
    if (readInside(t.dir, t.updates.concat(t.version, f.rel.split('/'))) !== null) return Object.assign(item, { status: 'merge', waiting: true });
    if (t.record.files && t.record.files[f.key] === want) return Object.assign(item, { status: 'kept' });
    return Object.assign(item, { status: 'merge' });
  });
}
/* The text written for a contract file: AGENTS.md keeps everything outside its markers (the team's notes); a file from
   before the markers is replaced whole. */
function merged(item) {
  if (item.key !== AGENTS || item.now === null) return item.text;
  const old = region(item.now), fresh = region(item.text);
  return old.marked ? norm(item.now).slice(0, old.start) + fresh.text + norm(item.now).slice(old.end) : item.text;
}
function readRecord(dir, parts) {
  const text = readInside(dir, parts);
  if (text === null) return {};
  try { const r = JSON.parse(text); return r && typeof r === 'object' && r.files && typeof r.files === 'object' ? r : {}; }
  catch (e) { return {}; }
}
function stamp(d) { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + p(d.getMinutes()); }

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
  t.record = readRecord(t.dir, t.recordAt);
  const items = classify(t, files, base, opts.force);
  if (opts.check) return items;
  for (const i of items) {
    const out = merged(i);
    if (['current', 'kept'].includes(i.status) || (i.status === 'merge' && i.waiting)) continue;
    if (i.status === 'merge') { safeWrite(t.dir, t.updates.concat(t.version, i.rel.split('/')), i.text); continue; }
    if (opts.force && i.now !== null && i.now !== out) keepCopy(t, i.parts, i.now);
    safeWrite(t.dir, i.parts, out);
  }
  const merges = items.filter((i) => i.status === 'merge');
  if (merges.length) safeWrite(t.dir, t.updates.concat(t.version, 'README.md'), mergeReadme(t.version, merges, t));
  const rec = Object.assign({}, t.record.files || {});
  items.forEach((i) => { rec[i.key] = i.want; });
  if (t.record.version === t.version && JSON.stringify(rec) === JSON.stringify(t.record.files)) return items;
  safeWrite(t.dir, t.recordAt, JSON.stringify({ format: 'flightdeck-installed/1', version: t.version, at: now.toISOString(), by: 'cli', files: rec }, null, 2) + '\n');
  return items;
}
/* --force saves each file it replaces under .flightdeck/updates/<version>/replaced/<date-time>/ first. */
function keepCopy(t, parts, text) {
  if (!t.replacedAt) t.replacedAt = t.updates.concat(t.version, 'replaced', stamp(new Date()).replace(' ', '-'));
  safeWrite(t.dir, t.replacedAt.concat(parts), text);
}

const LABEL = { current: 'up to date', update: 'updated', new: 'added', missing: 'added again', kept: 'kept (your team changed it)', merge: 'needs merge', forced: 'replaced (--force)' };
const CHECK_LABEL = { update: 'update available', new: 'will be added', missing: 'will be added again', merge: 'needs merge', forced: 'will be replaced (--force)', kept: 'kept (your team changed it)' };
function report(items, check, out) {
  items.filter((i) => i.status !== 'current').forEach((i) => out.push('  ' + (check ? CHECK_LABEL : LABEL)[i.status].padEnd(28) + i.rel + (i.waiting ? ' (still waiting)' : '')));
}
function exitFor(statuses) {
  if (statuses.includes('merge')) return EXIT.merge;
  return statuses.some((s) => ['update', 'new', 'missing', 'forced'].includes(s)) ? EXIT.updates : EXIT.none;
}

/* Copy a team folder to <dest>/<name> backup <date time>/. Links are skipped, never followed, and so are temporary files. */
function backup(src, toArg) {
  const parent = expand(toArg || path.join(require('os').homedir(), 'Flightdeck backups'));
  const inSrc = (p) => p === src || p.startsWith(src + path.sep);
  /* Checked before anything is created: the place as named, and where it really is once links are followed. */
  let have = parent;
  while (!fs.existsSync(have) && path.dirname(have) !== have) have = path.dirname(have);
  if (inSrc(parent) || inSrc(path.join(fs.realpathSync(have), path.relative(have, parent)))) fail('the backup can\'t go inside the folder it backs up. Choose another place with --to.');
  try { fs.mkdirSync(parent, { recursive: true }); } catch (e) { fail('couldn\'t create "' + parent + '": ' + e.message); }
  const real = fs.realpathSync(parent);
  if (inSrc(real)) fail('the backup can\'t go inside the folder it backs up. Choose another place with --to.');
  let dest = path.join(real, path.basename(src) + ' backup ' + stamp(new Date()));
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(real, path.basename(src) + ' backup ' + stamp(new Date()) + ' (' + n + ')');
  fs.mkdirSync(dest);
  const tally = { files: 0, bytes: 0, links: 0, tmp: 0 };
  (function copy(from, to) {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, e.name), b = path.join(to, e.name), st = fs.lstatSync(a);
      if (st.isSymbolicLink()) { tally.links++; continue; }
      if (st.isDirectory()) { fs.mkdirSync(b); copy(a, b); continue; }
      if (!st.isFile()) continue;
      if (/\.tmp$/i.test(e.name)) { tally.tmp++; continue; }
      fs.copyFileSync(a, b, fs.constants.COPYFILE_EXCL);
      tally.files++; tally.bytes += st.size;
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
    const appSt = appStatus(dir, NAME, html, mine, force), oldSt = keepOld ? appStatus(dir, OLD, html, mine, force) : 'current';
    const all = examples(html), t = { dir, updates: ['.flightdeck', 'updates'], recordAt: ['.flightdeck', 'installed.json'], version: mine, home: 'the team folder' };
    const files = appOnly ? [] : [AGENTS].concat(Object.keys(all).filter((p) => p.startsWith(SKILLS + '/'))).filter((k) => all[k] != null).map((k) => ({ key: k, rel: k, text: all[k] }));
    if (check) {
      const items = appOnly ? [] : contract(t, files, { html, force, check });
      out.push('Flightdeck ' + mine + ' in ' + dir + ':');
      if (appSt !== 'current') out.push('  ' + (appSt === 'new' ? 'will be added' : 'update available').padEnd(28) + NAME);
      if (oldSt !== 'current') out.push('  ' + 'update available'.padEnd(28) + OLD);
      report(items, true, out);
      const code = exitFor([appSt === 'current' ? 'current' : 'update', oldSt === 'current' ? 'current' : 'update'].concat(items.map((i) => i.status)));
      if (code === EXIT.none) out.push('  Nothing to do.');
      if (code === EXIT.merge) out.push('Files marked "needs merge" go to .flightdeck/updates/' + mine + '/ when you install.');
      return { out: out.join('\n'), code };
    }
    /* Everything is checked before anything is written, so a refusal (a link, say) leaves the folder as it was. */
    if (!appOnly) contract(t, files, { html, force, check: true });
    [[NAME, appSt], [OLD, oldSt]].forEach(([file, st]) => {
      if (st === 'current' || (file === OLD && !keepOld)) return;
      const was = readInside(dir, [file]);
      if (force && was !== null) keepCopy(t, [file], was);
      safeWrite(dir, [file], html);
    });
    const items = appOnly ? [] : contract(t, files, { html, force });
    out.push('Installed Flightdeck ' + mine + ' at ' + path.join(dir, NAME) + (keepOld ? '\nAlso updated ' + path.join(dir, OLD) + ' (the same app under its old name)' : ''));
    if (!appOnly) {
      out.push(items.every((i) => i.status === 'current') ? 'AGENTS.md and the skills are up to date.' : 'AGENTS.md and the skills:');
      report(items, false, out);
      if (items.some((i) => i.status === 'merge')) out.push('Your team changed files this version changes too. The new defaults are in ' + path.join(dir, '.flightdeck', 'updates', mine) + '; its README.md has a prompt for your AI assistant to merge them.');
    }
    if (t.replacedAt) out.push('Copies of the files --force replaced are in ' + path.join(dir, ...t.replacedAt));
    out.push('Open ' + NAME + ' in Edge or Chrome, choose Open team folder, and pick ' + dir);
    return { out: out.join('\n'), code: 0 };
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
      const code = exitFor(items.map((i) => i.status));
      if (code === EXIT.none) out.push('  Nothing to do.');
      return { out: out.join('\n'), code };
    }
    const written = items.filter((i) => ['update', 'new', 'missing', 'forced'].includes(i.status)).length;
    out.push(written + ' skill file' + (written === 1 ? '' : 's') + ' written to ' + where);
    report(items.filter((i) => i.status !== 'update' && i.status !== 'new'), false, out);
    if (t.replacedAt) out.push('Copies of the files --force replaced are in ' + path.join(t.dir, ...t.replacedAt));
    if (items.some((i) => i.status === 'merge')) out.push('Some files you changed were also changed in this version. The new defaults are in ' + path.join(t.dir, ...t.updates, mine) + ', with a README.md for your AI assistant. Use --force to replace your versions instead.');
    return { out: out.join('\n'), code: 0 };
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
module.exports = { main, versionOf, cmp, skillFiles, norm, region, managed, hash, baselineKey, examples };
