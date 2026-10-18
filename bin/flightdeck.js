#!/usr/bin/env node
/* The flightdeck command: puts the one-file app where a team uses it. No dependencies, nothing runs on install, and it
   never touches the network. Every command works on plain files: copy the app into a team folder, add or update the
   skills for AI assistants (in the team folder or any other folder), or open the app. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..', 'dist', 'flightdeck.html');
const NAME = 'flightdeck.html', OLD = 'preflight.html', SKILLS = '.flightdeck/skills';

function fail(msg) { process.stderr.write('flightdeck: ' + msg + '\n'); process.exit(1); }
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
function folderArg(arg) {
  if (!arg) fail('say which team folder, for example: flightdeck install "~/OneDrive/Team/Flightdeck"');
  const dir = expand(arg);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail('"' + dir + '" isn\'t a folder.');
  return fs.realpathSync(dir);
}
/* Write a file inside the team folder, and only there: no part of the path below the folder may be a link (a symlink or a
   Windows junction could point anywhere), and the file is written whole to a temporary sibling first, then moved into
   place, so an interrupted write never leaves half a file behind. */
function safeWrite(dir, parts, text) {
  let cur = dir;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    if (!cur.startsWith(dir + path.sep)) fail('refusing to write outside the team folder: ' + parts.join('/'));
    let st = null;
    try { st = fs.lstatSync(cur); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (st && st.isSymbolicLink()) fail('refusing to write through a link: ' + cur);
    if (i < parts.length - 1) { if (!st) fs.mkdirSync(cur); else if (!st.isDirectory()) fail(cur + ' isn\'t a folder.'); }
  }
  const tmp = path.join(path.dirname(cur), '.' + path.basename(cur) + '.' + process.pid + '.' + Date.now() + '.tmp');
  try { fs.writeFileSync(tmp, text, { flag: 'wx' }); fs.renameSync(tmp, cur); }
  catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to clean up */ } fail('couldn\'t write ' + cur + ': ' + e.message); }
}
/* Whether the app may replace the file at dest: a newer version, or a file that isn't a Flightdeck app, needs --force. */
function mayReplace(dest, mine, force) {
  let st = null;
  try { st = fs.lstatSync(dest); } catch (e) { return true; }
  if (st.isSymbolicLink()) fail('refusing to write through a link: ' + dest);
  if (force) return true;
  const theirs = versionOf(fs.readFileSync(dest, 'utf8'));
  if (!theirs) fail(dest + ' isn\'t a Flightdeck app this version recognizes. Use --force to replace it anyway.');
  if (theirs !== 'dev' && mine !== 'dev' && cmp(theirs, mine) > 0) fail(dest + ' is a newer version (' + theirs + ') than this one (' + mine + '). Update the package, or use --force to replace it anyway.');
  return true;
}
/* The example folder is built into the app; the skills are taken from there, so they always match this version. */
function skillFiles(html) {
  const m = /var EXAMPLES = (\{[\s\S]*?\});\n/.exec(html);
  if (!m) fail('couldn\'t find the built-in skills in the app file.');
  const all = JSON.parse(m[1].replace(/<\\\//g, '</'));
  return Object.keys(all).filter((p) => p.startsWith(SKILLS + '/')).map((p) => ({ path: p.slice(SKILLS.length + 1), text: all[p] }));
}

const HELP = `flightdeck: team process checklists, in one HTML file

  flightdeck open                    open the app (it starts on built-in examples)
  flightdeck install <team folder>   copy the app into the team folder as ${NAME}
  flightdeck skills <team folder>    add or update the AI assistant skills in <team folder>/.flightdeck/skills
  flightdeck skills --to <folder>    add or update them in any other folder (an assistant's skills folder, a repo)
  flightdeck path                    print where the app file is
  flightdeck version                 print this version

  --force                            replace a newer app, or skill files someone changed`;

function main(argv) {
  const ti = argv.indexOf('--to'), to = ti >= 0 ? argv[ti + 1] : null;
  if (ti >= 0 && (!to || to.startsWith('--'))) fail('say which folder after --to, for example: flightdeck skills --to ~/skills');
  const args = argv.filter((a, i) => !a.startsWith('--') && !(ti >= 0 && i === ti + 1)), force = argv.includes('--force');
  const cmd = args[0];
  if (!cmd || cmd === 'help' || argv.includes('--help')) { process.stdout.write(HELP + '\n'); return; }
  if (cmd === 'version' || argv.includes('--version')) { process.stdout.write((versionOf(app()) || 'unknown') + '\n'); return; }
  if (cmd === 'path') { app(); process.stdout.write(APP + '\n'); return; }
  if (cmd === 'install') {
    const dir = folderArg(args[1]), html = app(), mine = versionOf(html), dest = path.join(dir, NAME), old = path.join(dir, OLD);
    mayReplace(dest, mine, force);
    /* Before 1.9.0 the app was preflight.html. If the folder still has it, update it too: people who open that file keep
       their browser-saved state (it's tied to the file's address), and older copies looking for it see the update. */
    const keepOld = fs.existsSync(old);
    if (keepOld) mayReplace(old, mine, force);
    safeWrite(dir, [NAME], html);
    if (keepOld) safeWrite(dir, [OLD], html);
    process.stdout.write('Installed Flightdeck ' + mine + ' at ' + dest + (keepOld ? '\nAlso updated ' + old + ' (the same app under its old name)' : '') + '\nOpen it in Edge or Chrome, choose Open team folder, and pick ' + dir + '\n');
    return;
  }
  if (cmd === 'skills') {
    /* Without --to the skills go in <team folder>/.flightdeck/skills. With --to they go straight into that folder, which
       is created if it's missing. Either way nothing is written through a link below it. */
    let dir, base;
    if (to) {
      const t = expand(to);
      try { fs.mkdirSync(t, { recursive: true }); } catch (e) { fail('couldn\'t create "' + t + '": ' + e.message); }
      dir = folderArg(t); base = [];
    } else {
      dir = folderArg(args[1]); base = SKILLS.split('/');
    }
    const files = skillFiles(app()), kept = [];
    let written = 0;
    for (const f of files) {
      const parts = base.concat(f.path.split('/'));
      if (parts.some((x) => !x || x === '.' || x === '..')) fail('refusing an unexpected skill path: ' + f.path);
      const dest = path.join(dir, ...parts);
      let st = null;
      try { st = fs.lstatSync(dest); } catch (e) { /* not there yet */ }
      if (st && st.isSymbolicLink()) fail('refusing to write through a link: ' + dest);
      if (st) {
        if (fs.readFileSync(dest, 'utf8') === f.text) continue;
        if (!force) { kept.push(f.path); continue; }
      }
      safeWrite(dir, parts, f.text);
      written++;
    }
    process.stdout.write(written + ' skill file' + (written === 1 ? '' : 's') + ' written to ' + path.join(dir, ...base) + '\n');
    if (kept.length) process.stdout.write('Left as they are (changed in the folder; use --force to replace):\n' + kept.map((p) => '  ' + p).join('\n') + '\n');
    return;
  }
  if (cmd === 'open') {
    app();
    /* The path is passed as data to a launcher, never through a shell (cmd would expand %VARIABLES% in it). */
    const [bin, ...rest] = process.platform === 'darwin' ? ['open', APP] : process.platform === 'win32' ? ['explorer.exe', APP] : ['xdg-open', APP];
    const child = spawn(bin, rest, { stdio: 'ignore', detached: true });
    child.on('error', () => fail('couldn\'t open a browser. Open this file in Edge or Chrome: ' + APP));
    child.unref();
    return;
  }
  fail('unknown command "' + cmd + '". Try: flightdeck help');
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { main, versionOf, cmp, skillFiles };
