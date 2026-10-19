// The flightdeck command, run against real temporary folders.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { rule, run } = require('./harness');
const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js');
const cli = (...a) => { try { return { out: execFileSync(process.execPath, [BIN, ...a], { encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (e) { return { out: String(e.stdout) + String(e.stderr), code: e.status }; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-cli-'));

rule('install copies the app into a team folder and never replaces a newer one without --force', () => {
  const dir = tmp(), v = cli('version').out.trim();
  assert.ok(/^\d+\.\d+\.\d+$/.test(v), 'version: ' + v);
  assert.strictEqual(cli('install', dir).code, 0);
  assert.ok(fs.readFileSync(path.join(dir, 'flightdeck.html'), 'utf8').includes('content="' + v + '"'));
  fs.writeFileSync(path.join(dir, 'flightdeck.html'), '<meta name="flightdeck-version" content="99.0.0">');
  const r = cli('install', dir);
  assert.ok(r.code !== 0 && /newer version \(99\.0\.0\)/.test(r.out), r.out);
  assert.strictEqual(cli('install', dir, '--force').code, 0);
  assert.ok(cli('install', path.join(dir, 'nope')).code !== 0, 'a missing folder is refused');
});

rule('skills adds the AI assistant skills and leaves files someone changed unless --force', () => {
  const dir = tmp();
  assert.ok(/skill files? written/.test(cli('skills', dir).out));
  const f = path.join(dir, '.flightdeck', 'skills', 'flightdeck-status', 'SKILL.md');
  assert.ok(fs.existsSync(f) && fs.existsSync(path.join(dir, '.flightdeck', 'skills', '_flightdeck', 'check_folder.py')));
  fs.writeFileSync(f, 'edited');
  const r = cli('skills', dir);
  assert.ok(/0 skill files written/.test(r.out) && /flightdeck-status\/SKILL\.md/.test(r.out), r.out);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'edited');
  cli('skills', dir, '--force');
  assert.notStrictEqual(fs.readFileSync(f, 'utf8'), 'edited');
});

rule('skills --to installs into any folder, relative or absolute, with the same safety rules', () => {
  const dir = tmp(), to = path.join(dir, 'my', 'skills');
  let r = cli('skills', '--to', to);
  assert.ok(r.code === 0 && r.out.includes('written to ' + fs.realpathSync(to)), r.out);
  const f = path.join(to, 'flightdeck-status', 'SKILL.md');
  assert.ok(fs.existsSync(f) && fs.existsSync(path.join(to, '_flightdeck', 'check_folder.py')));
  assert.ok(!fs.existsSync(path.join(to, '.flightdeck')), 'no .flightdeck/skills folder inside the target');
  fs.writeFileSync(f, 'edited');
  r = cli('skills', dir, '--to', to);
  assert.ok(/0 skill files written/.test(r.out) && /flightdeck-status\/SKILL\.md/.test(r.out), r.out);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'edited');
  assert.ok(!fs.existsSync(path.join(dir, '.flightdeck')), '--to wins over the team folder');
  cli('skills', '--to', to, '--force');
  assert.notStrictEqual(fs.readFileSync(f, 'utf8'), 'edited');
  const rel = execFileSync(process.execPath, [BIN, 'skills', '--to', 'rel-skills'], { cwd: dir, encoding: 'utf8' });
  assert.ok(/skill files? written/.test(rel) && fs.existsSync(path.join(dir, 'rel-skills', 'flightdeck-status', 'SKILL.md')), rel);
  const outside = tmp(), to2 = tmp();
  fs.symlinkSync(outside, path.join(to2, 'flightdeck-status'));
  r = cli('skills', '--to', to2);
  assert.ok(r.code !== 0 && /through a link/.test(r.out) && !fs.existsSync(path.join(outside, 'SKILL.md')), r.out);
  assert.ok(cli('skills', '--to').code !== 0, '--to needs a folder');
});

rule('skills ships the checklist skills with their names and generic frontmatter', () => {
  const dir = tmp();
  cli('skills', dir);
  const root = path.join(dir, '.flightdeck', 'skills');
  ['new', 'edit', 'review'].forEach((v) => {
    const t = fs.readFileSync(path.join(root, 'flightdeck-' + v + '-checklist', 'SKILL.md'), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(t);
    assert.ok(fm, v + ': has frontmatter');
    assert.ok(new RegExp('^name: flightdeck-' + v + '-checklist$', 'm').test(fm[1]), v + ': name');
    assert.deepStrictEqual(fm[1].split('\n').map((l) => l.split(':')[0]), ['name', 'description'], v + ': only name and description');
    assert.ok(/^Reference: .*`\.\.\/_flightdeck\/map-format\.md`/m.test(t), v + ': names its reference files');
  });
  assert.ok(/^Read-only: don't create, edit or delete files, and don't run commands\.$/m.test(fs.readFileSync(path.join(root, 'flightdeck-review-checklist', 'SKILL.md'), 'utf8')), 'the review skill says it is read-only');
  ['new', 'edit', 'review'].forEach((v) => assert.ok(!fs.existsSync(path.join(root, 'flightdeck-' + v + '-map')), 'no old ' + v + '-map alias'));
});

rule('the command never writes through links, refuses files it doesn\'t recognize, and keeps an old preflight.html updated', () => {
  const dir = tmp(), outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'keep');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'flightdeck.html'));
  let r = cli('install', dir, '--force');
  assert.ok(r.code !== 0 && /through a link/.test(r.out) && fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8') === 'keep', r.out);
  const dir2 = tmp();
  fs.symlinkSync(outside, path.join(dir2, '.flightdeck'));
  r = cli('skills', dir2);
  assert.ok(r.code !== 0 && /through a link/.test(r.out) && !fs.existsSync(path.join(outside, 'skills')), r.out);
  const dir3 = tmp();
  fs.writeFileSync(path.join(dir3, 'flightdeck.html'), 'my notes');
  assert.ok(/isn't a Flightdeck app/.test(cli('install', dir3).out), 'an unrecognized file needs --force');
  const dir4 = tmp();
  fs.writeFileSync(path.join(dir4, 'preflight.html'), '<meta name="preflight-version" content="1.7.0">');
  assert.ok(/Also updated/.test(cli('install', dir4).out));
  assert.strictEqual(fs.readFileSync(path.join(dir4, 'preflight.html'), 'utf8'), fs.readFileSync(path.join(dir4, 'flightdeck.html'), 'utf8'));
  assert.ok(!fs.readdirSync(dir4).some(n => n.endsWith('.tmp')), 'no temporary files left');
});

rule('version comparison handles any size of number', () => {
  const { cmp, versionOf } = require('../bin/flightdeck.js');
  assert.ok(cmp('10000.0.0', '9.9.9') > 0 && cmp('1.10.0', '1.9.0') > 0 && cmp('1.9.0', '1.9.0') === 0);
  assert.strictEqual(versionOf('<meta name="flightdeck-version" content="10000.0.0">'), '10000.0.0');
});

const C = require('../bin/flightdeck.js');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dist', 'flightdeck.html'), 'utf8'), VER = C.versionOf(HTML), EX = C.examples(HTML);
const STATUS = '.flightdeck/skills/flightdeck-status/SKILL.md', PLAN = '.flightdeck/skills/flightdeck-plan-run/SKILL.md';
const at = (dir, rel) => path.join(dir, ...rel.split('/'));
const read = (dir, rel) => fs.readFileSync(at(dir, rel), 'utf8');
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(at(dir, rel)), { recursive: true }); fs.writeFileSync(at(dir, rel), text); };
const record = (dir) => JSON.parse(read(dir, '.flightdeck/installed.json'));
const setRecord = (dir, files) => { const r = record(dir); Object.assign(r.files, files); write(dir, '.flightdeck/installed.json', JSON.stringify(r)); };
// Every file in a folder with its text, to show a command changed nothing.
const snapshot = (dir) => { const out = {}; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = e.isSymbolicLink() ? 'link' : fs.readFileSync(p, 'utf8'); } })(dir); return out; };

rule('install adds the app, AGENTS.md and the skills, and records the default each file is based on', () => {
  const dir = tmp(), r = cli('install', dir);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(read(dir, 'AGENTS.md'), EX['AGENTS.md']);
  assert.strictEqual(read(dir, STATUS), EX[STATUS]);
  const rec = record(dir), keys = Object.keys(EX).filter(k => k === 'AGENTS.md' || k.startsWith('.flightdeck/skills/')).sort();
  assert.strictEqual(rec.format, 'flightdeck-installed/1'); assert.strictEqual(rec.version, VER); assert.strictEqual(rec.by, 'cli'); assert.ok(!isNaN(Date.parse(rec.at)));
  assert.deepStrictEqual(Object.keys(rec.files).sort(), keys);
  keys.forEach(k => assert.strictEqual(rec.files[k], C.hash(C.managed(k, EX[k])), k));
  assert.ok(/up to date/.test(cli('install', dir).out), 'a second install has nothing to do');
  const app = tmp();
  assert.strictEqual(cli('install', app, '--app-only').code, 0);
  assert.deepStrictEqual(fs.readdirSync(app), ['flightdeck.html'], '--app-only writes only the app');
});

rule('install --check changes nothing and says by its exit code whether there are updates (2), merges (3), nothing (0) or a problem (1)', () => {
  const dir = tmp();
  let r = cli('install', dir, '--check');
  assert.strictEqual(r.code, 2, r.out);
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'nothing written');
  cli('install', dir);
  assert.strictEqual(cli('install', dir, '--check').code, 0);
  write(dir, STATUS, 'Ours');
  r = cli('install', dir, '--check');
  assert.ok(r.code === 0 && /kept \(your team changed it\)\s+\.flightdeck\/skills\/flightdeck-status\/SKILL\.md/.test(r.out), r.out);
  setRecord(dir, { [STATUS]: 'f'.repeat(64) });
  const before = snapshot(dir);
  r = cli('install', dir, '--check');
  assert.ok(r.code === 3 && /needs merge\s+\.flightdeck\/skills\/flightdeck-status\/SKILL\.md/.test(r.out), r.out);
  assert.deepStrictEqual(snapshot(dir), before, 'still nothing written');
  fs.writeFileSync(path.join(dir, 'flightdeck.html'), '<meta name="flightdeck-version" content="99.0.0">');
  r = cli('install', dir, '--check');
  assert.ok(r.code === 1 && /newer version/.test(r.out), r.out);
  assert.strictEqual(cli('install', dir, '--check', '--app-only', '--force').code, 2, '--force would replace it');
  assert.strictEqual(cli('install', tmp(), '--check', '--app-only').code, 2);
  assert.strictEqual(cli('install', path.join(dir, 'nope'), '--check').code, 1);
});

rule('install keeps a file the team changed, adds a missing one, and puts a new default the team also changed in the updates folder', () => {
  const dir = tmp();
  cli('install', dir);
  write(dir, STATUS, 'Ours, on top of an older default');
  setRecord(dir, { [STATUS]: 'f'.repeat(64) });
  fs.unlinkSync(at(dir, '.flightdeck/skills/flightdeck-skill-brief/SKILL.md'));
  let r = cli('install', dir);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(/added again\s+\.flightdeck\/skills\/flightdeck-skill-brief/.test(r.out), r.out);
  assert.strictEqual(read(dir, STATUS), 'Ours, on top of an older default', 'the team\'s file stays');
  const up = '.flightdeck/updates/' + VER + '/';
  assert.strictEqual(read(dir, up + STATUS), EX[STATUS], 'the new default waits beside it');
  const readme = read(dir, up + 'README.md');
  assert.ok(readme.includes('`' + STATUS + '`') && /your AI assistant/.test(readme) && /delete its copy here/.test(readme) && /--check/.test(readme), readme);
  assert.ok(!fs.existsSync(at(dir, '.flightdeck/skills/.flightdeck')) && !fs.readdirSync(at(dir, '.flightdeck/skills')).includes('updates'), 'nothing a skills loader would read twice');
  assert.strictEqual(record(dir).files[STATUS], C.hash(EX[STATUS]), 'the file is now based on this version');
  r = cli('install', dir, '--check');
  assert.ok(r.code === 3 && /still waiting/.test(r.out), 'still needs merging while its copy waits: ' + r.out);
  fs.writeFileSync(at(dir, up + STATUS), 'an assistant must not have this overwritten');
  cli('install', dir);
  assert.strictEqual(read(dir, up + STATUS), 'an assistant must not have this overwritten', 'a waiting copy is never rewritten');
  fs.unlinkSync(at(dir, up + STATUS));
  r = cli('install', dir, '--check');
  assert.ok(r.code === 0 && /kept/.test(r.out), 'merged and its copy deleted: kept from then on: ' + r.out);
  const fresh = tmp();
  write(fresh, STATUS, 'Ours, with no record of what it was based on');
  assert.strictEqual(cli('install', fresh, '--check').code, 3, 'without a record, a changed file needs a person');
});

rule('install updates only the Flightdeck part of AGENTS.md, keeps Team notes, and replaces a whole AGENTS.md from before the markers when it was a default', () => {
  const dir = tmp();
  cli('install', dir);
  const region = C.region(EX['AGENTS.md']).text, ours = 'Our preface\n' + region + '\n\n## Team notes\n\nDeploy only on Tuesdays.\n';
  write(dir, 'AGENTS.md', ours);
  assert.strictEqual(cli('install', dir, '--check').code, 0, 'Team notes and a preface never count as a change');
  cli('install', dir);
  const now = read(dir, 'AGENTS.md');
  assert.strictEqual(now, ours);
  const old = { key: 'AGENTS.md', now: 'Our preface\n<!-- flightdeck:begin -->\nOld rules\n<!-- flightdeck:end -->\n\n## Team notes\nOurs\n', text: EX['AGENTS.md'] };
  assert.strictEqual(C.merged(old), 'Our preface\n' + region + '\n\n## Team notes\nOurs\n', 'an update replaces only the part between the markers');
  write(dir, 'AGENTS.md', now.replace('## What you may write', '## What you may write (we added this)'));
  assert.strictEqual(cli('install', dir, '--check').code, 0, 'a change inside the markers is kept while the default is unchanged');
  let v113 = null;
  try { v113 = execFileSync('git', ['show', 'v1.13.0:example-folder/AGENTS.md'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { console.log('  (skipped the 1.13 AGENTS.md: no git tags here)'); }
  if (v113) {
    const d2 = tmp();
    write(d2, 'AGENTS.md', v113.replace(/\n/g, '\r\n'));
    const r = cli('install', d2);
    assert.ok(/updated\s+AGENTS\.md/.test(r.out), 'a shipped default, even with Windows line endings, is recognized: ' + r.out);
    assert.strictEqual(read(d2, 'AGENTS.md'), EX['AGENTS.md']);
  }
});

rule('--force replaces files the team changed, after saving a copy of each, and still keeps Team notes', () => {
  const dir = tmp();
  cli('install', dir);
  write(dir, STATUS, 'Ours');
  const agents = read(dir, 'AGENTS.md').replace('<!-- flightdeck:end -->', 'Our rule inside the markers\n<!-- flightdeck:end -->') + 'Our note\n';
  write(dir, 'AGENTS.md', agents);
  fs.writeFileSync(path.join(dir, 'flightdeck.html'), 'my notes');
  assert.ok(cli('install', dir).code !== 0, 'an unrecognized app needs --force');
  const r = cli('install', dir, '--force');
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(read(dir, STATUS), EX[STATUS]);
  assert.ok(read(dir, 'AGENTS.md').endsWith('Our note\n') && !read(dir, 'AGENTS.md').includes('Our rule inside'), 'Team notes kept, the managed part replaced');
  const rep = at(dir, '.flightdeck/updates/' + VER + '/replaced'), stamps = fs.readdirSync(rep);
  assert.strictEqual(stamps.length, 1);
  const saved = path.join(rep, stamps[0]);
  assert.strictEqual(fs.readFileSync(at(saved, STATUS), 'utf8'), 'Ours');
  assert.strictEqual(fs.readFileSync(path.join(saved, 'AGENTS.md'), 'utf8'), agents);
  assert.strictEqual(fs.readFileSync(path.join(saved, 'flightdeck.html'), 'utf8'), 'my notes');
  assert.ok(r.out.includes(saved), r.out);
  const to = path.join(tmp(), 'skills');
  cli('skills', '--to', to);
  fs.writeFileSync(path.join(to, 'flightdeck-status', 'SKILL.md'), 'Ours');
  cli('skills', '--to', to, '--force');
  const rs = path.join(to, '.flightdeck-updates', VER, 'replaced');
  assert.strictEqual(fs.readFileSync(path.join(rs, fs.readdirSync(rs)[0], 'flightdeck-status', 'SKILL.md'), 'utf8'), 'Ours', 'skills --to keeps copies too');
});

rule('skills --to keeps its own record and updates folder beside the skills, under names an assistant won\'t load', () => {
  const to = path.join(tmp(), 'skills');
  cli('skills', '--to', to);
  const rec = JSON.parse(fs.readFileSync(path.join(to, '.flightdeck-installed.json'), 'utf8'));
  assert.strictEqual(rec.files['flightdeck-status/SKILL.md'], C.hash(EX[STATUS]));
  fs.writeFileSync(path.join(to, 'flightdeck-status', 'SKILL.md'), 'Ours');
  rec.files['flightdeck-status/SKILL.md'] = 'f'.repeat(64);
  fs.writeFileSync(path.join(to, '.flightdeck-installed.json'), JSON.stringify(rec));
  assert.strictEqual(cli('skills', '--to', to, '--check').code, 3);
  cli('skills', '--to', to);
  assert.strictEqual(fs.readFileSync(path.join(to, '.flightdeck-updates', VER, 'flightdeck-status', 'SKILL.md'), 'utf8'), EX[STATUS]);
  assert.ok(fs.existsSync(path.join(to, '.flightdeck-updates', VER, 'README.md')));
  const missing = path.join(tmp(), 'not-yet');
  assert.strictEqual(cli('skills', '--to', missing, '--check').code, 2);
  assert.ok(!fs.existsSync(missing), '--check doesn\'t create the folder');
});

rule('install, skills and their records and updates never go through a link', () => {
  const outside = tmp();
  const a = tmp(); cli('install', a);
  fs.rmSync(at(a, '.flightdeck/installed.json')); fs.symlinkSync(path.join(outside, 'rec.json'), at(a, '.flightdeck/installed.json'));
  let r = cli('install', a);
  assert.ok(r.code === 1 && /through a link/.test(r.out) && !fs.existsSync(path.join(outside, 'rec.json')), r.out);
  const b = tmp(); cli('install', b);
  write(b, STATUS, 'Ours'); setRecord(b, { [STATUS]: 'f'.repeat(64) });
  fs.symlinkSync(outside, at(b, '.flightdeck/updates'));
  r = cli('install', b);
  assert.ok(r.code === 1 && /through a link/.test(r.out) && fs.readdirSync(outside).length === 0, r.out);
  const c = tmp();
  fs.writeFileSync(path.join(outside, 'theirs.md'), 'keep');
  fs.symlinkSync(path.join(outside, 'theirs.md'), path.join(c, 'AGENTS.md'));
  r = cli('install', c, '--force');
  assert.ok(r.code === 1 && /through a link/.test(r.out) && fs.readFileSync(path.join(outside, 'theirs.md'), 'utf8') === 'keep', r.out);
  assert.ok(cli('install', c, '--check').code === 1, '--check reports it too');
  const d = tmp(); cli('install', d);
  write(d, STATUS, 'Ours');
  fs.mkdirSync(at(d, '.flightdeck/updates/' + VER), { recursive: true });
  fs.symlinkSync(outside, at(d, '.flightdeck/updates/' + VER + '/replaced'));
  r = cli('install', d, '--force');
  assert.ok(r.code === 1 && /through a link/.test(r.out) && read(d, STATUS) === 'Ours' && fs.readdirSync(outside).length === 1, 'a backup is never written through a link, and nothing is replaced before its copy is safe: ' + r.out);
});

rule('backup copies the whole team folder, skips links and temporary files, and never goes inside the folder it backs up', () => {
  const src = tmp(), outside = tmp(), dest = tmp();
  write(src, 'people.json', '[]'); write(src, 'runs/release/r1/run.json', '{"a":1}'); write(src, 'runs/release/r1/.run.json.123.tmp', 'half');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'theirs');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(src, 'link.txt'));
  fs.symlinkSync(outside, path.join(src, 'linked-folder'));
  let r = cli('backup', src, '--to', dest);
  assert.strictEqual(r.code, 0, r.out);
  const made = fs.readdirSync(dest);
  assert.strictEqual(made.length, 1);
  assert.ok(new RegExp('^' + path.basename(src) + ' backup \\d{4}-\\d{2}-\\d{2} \\d{4}$').test(made[0]), made[0]);
  const copy = path.join(dest, made[0]);
  assert.deepStrictEqual(snapshot(copy), { 'people.json': '[]', [path.join('runs', 'release', 'r1', 'run.json')]: '{"a":1}' });
  assert.ok(/Backed up 2 files \(\d+ bytes\)/.test(r.out) && /Skipped 2 links and 1 temporary file/.test(r.out), r.out);
  r = cli('backup', src, '--to', dest);
  assert.strictEqual(fs.readdirSync(dest).length, 2, 'a second backup the same minute gets its own folder');
  const before = snapshot(src);
  r = cli('backup', src, '--to', path.join(src, 'backups'));
  assert.ok(r.code === 1 && /inside the folder it backs up/.test(r.out), r.out);
  const via = path.join(tmp(), 'into-src'); fs.symlinkSync(src, via);
  r = cli('backup', src, '--to', path.join(via, 'backups'));
  assert.ok(r.code === 1 && /inside the folder it backs up/.test(r.out), r.out);
  assert.deepStrictEqual(snapshot(src), before, 'nothing was created in the folder');
  assert.ok(cli('backup').code === 1 && cli('backup', path.join(src, 'nope')).code === 1);
});

rule('the command and the app agree on what a contract file\'s hash covers', () => {
  const PF = require('./harness').load();
  const t = '﻿Pre\r\n<!-- flightdeck:begin -->\r\nA\r\n<!-- flightdeck:end -->\r\nNotes\r\n';
  ['AGENTS.md', STATUS].forEach(k => assert.strictEqual(C.managed(k, t), PF.contract.managed(k, t), k));
  ['', 'x', '<!-- flightdeck:end -->x<!-- flightdeck:begin -->'].forEach(x => assert.deepStrictEqual(C.region(x), JSON.parse(JSON.stringify(PF.contract.region(x)))));
});

// Runs the command in this process, so a test can step in at an exact moment of a file operation.
function inProcess(argv, hook) {
  const orig = fs.openSync;
  fs.openSync = function (p, flags) { const fd = orig.apply(fs, arguments); if (flags === 'wx' && /\.tmp$/.test(String(p))) hook(String(p)); return fd; };
  try { return C.main(argv); } catch (e) { return { out: e.message, code: 1 }; } finally { fs.openSync = orig; }
}

rule('Every --force keeps its own copies: a second --force in the same minute never replaces the first one\'s', () => {
  const dir = tmp();
  cli('install', dir);
  write(dir, STATUS, 'First'); cli('install', dir, '--force');
  write(dir, STATUS, 'Second'); cli('install', dir, '--force');
  const rep = at(dir, '.flightdeck/updates/' + VER + '/replaced'), copies = fs.readdirSync(rep).map(d => fs.readFileSync(at(path.join(rep, d), STATUS), 'utf8')).sort();
  assert.deepStrictEqual(copies, ['First', 'Second']);
});

rule('A record that isn\'t valid, or names a hash Flightdeck never shipped, never lets install replace a file', () => {
  const dir = tmp();
  cli('install', dir);
  write(dir, STATUS, 'Ours');
  write(dir, '.flightdeck/installed.json', JSON.stringify({ format: 'garbage', files: { [STATUS]: C.hash('Ours') } }));
  let r = cli('install', dir);
  assert.strictEqual(read(dir, STATUS), 'Ours', r.out);
  assert.ok(/installed\.json/.test(r.out) && /ignored/i.test(r.out), 'says the record was ignored: ' + r.out);
  const d2 = tmp();
  cli('install', d2);
  write(d2, STATUS, 'Ours');
  setRecord(d2, { [STATUS]: C.hash('Ours') });
  r = cli('install', d2);
  assert.strictEqual(read(d2, STATUS), 'Ours', 'a hash in a valid record isn\'t proof of a default: ' + r.out);
  assert.strictEqual(read(d2, '.flightdeck/updates/' + VER + '/' + STATUS), EX[STATUS], 'it waits for a merge instead');
});

rule('A file that changes while install runs is left as it is, and install says so and exits with an error', () => {
  const dir = tmp();
  cli('install', dir);
  write(dir, STATUS, 'Ours');
  let edited = false;
  const r = inProcess(['install', dir, '--force'], (p) => { if (!edited && p.includes('flightdeck-status' + path.sep + '.SKILL.md')) { edited = true; fs.writeFileSync(at(dir, STATUS), 'An assistant\'s edit'); } });
  assert.ok(edited, 'the hook ran');
  assert.strictEqual(read(dir, STATUS), 'An assistant\'s edit');
  assert.ok(r.code === 1 && /changed during install/.test(r.out), r.out);
});

rule('A folder swapped for a link while install writes is caught before anything lands outside the team folder', () => {
  const dir = tmp(), outside = tmp();
  cli('install', dir);
  fs.unlinkSync(at(dir, STATUS));
  let swapped = false;
  const r = inProcess(['install', dir], (p) => {
    if (swapped || !p.includes('flightdeck-status' + path.sep)) return;
    swapped = true;
    fs.renameSync(at(dir, '.flightdeck/skills/flightdeck-status'), at(dir, '.flightdeck/skills/moved'));
    fs.symlinkSync(outside, at(dir, '.flightdeck/skills/flightdeck-status'));
  });
  assert.ok(swapped, 'the hook ran');
  assert.ok(r.code === 1 && /link/.test(r.out), r.out);
  assert.deepStrictEqual(fs.readdirSync(outside), [], 'nothing written outside');
});

rule('backup knows a folder by what it is, not how its name is spelled', () => {
  const src = tmp(), upper = path.join(path.dirname(src), path.basename(src).toUpperCase());
  if (!fs.existsSync(upper)) return console.log('  (skipped: this file system tells letter case apart)');
  write(src, 'people.json', '[]');
  const r = cli('backup', src, '--to', path.join(upper, 'backups'));
  assert.ok(r.code === 1 && /inside the folder it backs up/.test(r.out), r.out);
  assert.ok(!fs.existsSync(path.join(src, 'backups')));
});

rule('A merge left from an earlier version still counts until its copy is deleted, and --force files it away with the copies it keeps', () => {
  const dir = tmp();
  cli('install', dir);
  write(dir, STATUS, 'Ours');
  write(dir, '.flightdeck/updates/1.14.9/' + STATUS, 'an earlier version\'s default, not merged yet');
  let r = cli('install', dir, '--check');
  assert.ok(r.code === 3 && /still waiting/.test(r.out) && /1\.14\.9/.test(r.out), r.out);
  r = cli('install', dir, '--force');
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(!fs.existsSync(at(dir, '.flightdeck/updates/1.14.9/' + STATUS)), 'the staged copy is no longer waiting');
  const rep = at(dir, '.flightdeck/updates/' + VER + '/replaced'), stamp = fs.readdirSync(rep)[0];
  assert.strictEqual(fs.readFileSync(at(path.join(rep, stamp), 'staged/1.14.9/' + STATUS), 'utf8'), 'an earlier version\'s default, not merged yet', 'moved beside the replaced file, never deleted');
  write(dir, STATUS, 'Ours again');
  assert.strictEqual(cli('install', dir, '--check').code, 0, 'a later change is just kept');
});

// Replaces one fs function for the length of a call.
function patched(name, impl, fn) { const orig = fs[name]; fs[name] = function () { return impl.call(this, orig, ...arguments); }; try { return fn(); } finally { fs[name] = orig; } }

rule('A write that the system cuts short is finished, and a copy that doesn\'t read back right stops --force before it replaces anything', () => {
  const dir = tmp();
  cli('install', dir);
  write(dir, STATUS, 'Important customization');
  let r = patched('writeSync', (orig, fd, buf, ...rest) => orig(fd, Buffer.isBuffer(buf) || ArrayBuffer.isView(buf) ? Buffer.from(buf).subarray(rest[0] || 0, (rest[0] || 0) + 3) : String(buf).slice(0, 3)), () => inProcess(['install', dir, '--force'], () => {}));
  assert.strictEqual(r.code, 0, r.out);
  const rep = at(dir, '.flightdeck/updates/' + VER + '/replaced');
  assert.strictEqual(fs.readFileSync(at(path.join(rep, fs.readdirSync(rep)[0]), STATUS), 'utf8'), 'Important customization', 'the copy is whole');
  assert.strictEqual(read(dir, STATUS), EX[STATUS]);
  const d2 = tmp();
  cli('install', d2);
  write(d2, STATUS, 'Important customization');
  let target = null;
  r = patched('openSync', (orig, p, flags) => { const fd = orig(p, flags); if (flags === 'wx' && String(p).includes('replaced')) target = fd; return fd; },
    () => patched('writeSync', (orig, fd, buf, ...rest) => fd === target ? orig(fd, Buffer.from('garbled!')) && (Buffer.isBuffer(buf) ? buf.length : Buffer.byteLength(String(buf))) : orig(fd, buf, ...rest), () => inProcess(['install', d2, '--force'], () => {})));
  assert.ok(target !== null, 'the hook ran');
  assert.strictEqual(r.code, 1, r.out);
  assert.strictEqual(read(d2, STATUS), 'Important customization', 'not replaced without a good copy');
});

rule('skills keeps the record\'s entries for files it doesn\'t handle, such as AGENTS.md', () => {
  const dir = tmp();
  cli('install', dir);
  const rec = record(dir), before = rec.files['AGENTS.md'];
  write(dir, '.flightdeck/installed.json', JSON.stringify(Object.assign(rec, { version: '1.14.0' })));
  assert.strictEqual(cli('skills', dir).code, 0);
  assert.strictEqual(record(dir).files['AGENTS.md'], before);
});

rule('An edit that lands at the last moment before install replaces a file is never overwritten', () => {
  const dir = tmp();
  cli('install', dir);
  write(dir, STATUS, 'Ours');
  const target = at(fs.realpathSync(dir), STATUS);
  let hit = false;
  const late = (orig, from, to) => { if (!hit && to === target && /\.tmp$/.test(String(from))) { hit = true; fs.writeFileSync(target, 'A late edit'); } return orig(from, to); };
  const r = patched('renameSync', late, () => patched('linkSync', late, () => inProcess(['install', dir, '--force'], () => {})));
  assert.ok(hit, 'the hook ran');
  assert.strictEqual(read(dir, STATUS), 'A late edit');
  assert.ok(r.code === 1 && /changed during install/.test(r.out), r.out);
});

rule('A waiting copy counts even when the file already matches the default, and --force files it away then too', () => {
  const dir = tmp();
  cli('install', dir);
  write(dir, '.flightdeck/updates/1.14.9/' + STATUS, 'an earlier default');
  assert.strictEqual(cli('install', dir, '--check').code, 3);
  assert.strictEqual(cli('install', dir, '--force').code, 0);
  assert.ok(!fs.existsSync(at(dir, '.flightdeck/updates/1.14.9/' + STATUS)));
  write(dir, STATUS, 'Ours');
  assert.strictEqual(cli('install', dir, '--check').code, 0);
});

run();
