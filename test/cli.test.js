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

rule('Every file install replaces, an earlier default too, first gets a copy that reads back the same', () => {
  let v113 = null;
  try { v113 = execFileSync('git', ['show', 'v1.13.0:example-folder/AGENTS.md'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return console.log('  (skipped: no git tags here)'); }
  const dir = tmp();
  write(dir, 'AGENTS.md', v113);
  const r = cli('install', dir);
  assert.ok(r.code === 0 && /Copies of the files it replaced are in/.test(r.out), r.out);
  const rep = at(dir, '.flightdeck/updates/' + VER + '/replaced');
  assert.strictEqual(fs.readFileSync(path.join(rep, fs.readdirSync(rep)[0], 'AGENTS.md'), 'utf8'), v113);
  assert.strictEqual(read(dir, 'AGENTS.md'), EX['AGENTS.md']);
});

rule('A disk error at any step of a write leaves the file as it was, never missing, and leaves no temporary file', () => {
  const isTarget = (p) => typeof p === 'string' && p.includes(path.join('flightdeck-status', '.SKILL.md.')) && !p.includes('replaced');
  ['openSync', 'writeSync', 'fsyncSync', 'readFileSync', 'renameSync'].forEach((name) => {
    const dir = tmp();
    cli('install', dir);
    write(dir, STATUS, 'Ours');
    let fd = null, hit = false;
    const eio = () => { hit = true; throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }); };
    const r = patched('openSync', (orig, p, flags) => { if (isTarget(p) && name === 'openSync' && !hit) eio(); const f = orig(p, flags); if (isTarget(p)) fd = f; return f; },
      () => patched(name === 'openSync' ? 'closeSync' : name, (orig, ...a) => {
        if (!hit && name !== 'openSync' && (a[0] === fd && fd !== null || isTarget(a[0]))) eio();
        return orig.apply(fs, a);
      }, () => inProcess(['install', dir, '--force'], () => {})));
    assert.ok(hit, name + ': the error was injected');
    assert.strictEqual(r.code, 1, name + ': ' + r.out);
    assert.strictEqual(read(dir, STATUS), 'Ours', name + ': the file is still there, as it was');
    assert.deepStrictEqual(fs.readdirSync(at(dir, '.flightdeck/skills/flightdeck-status')).filter(n => n.endsWith('.tmp')), [], name + ': no temporary file left');
  });
});

rule('A file still waiting on an older merge also gets this version\'s new default, and counts until every copy is merged', () => {
  const dir = tmp();
  cli('install', dir);
  write(dir, STATUS, 'Ours');
  write(dir, '.flightdeck/updates/1.14.9/' + STATUS, 'an older default, not merged yet');
  let r = cli('install', dir);
  assert.strictEqual(r.code, 0, r.out);
  const mine = '.flightdeck/updates/' + VER + '/';
  assert.strictEqual(read(dir, mine + STATUS), EX[STATUS], 'this version\'s default is staged too');
  assert.ok(read(dir, mine + 'README.md').includes(STATUS));
  assert.strictEqual(read(dir, STATUS), 'Ours');
  fs.unlinkSync(at(dir, '.flightdeck/updates/1.14.9/' + STATUS));
  assert.strictEqual(cli('install', dir, '--check').code, 3, 'this version\'s copy still waits');
  fs.unlinkSync(at(dir, mine + STATUS));
  assert.strictEqual(cli('install', dir, '--check').code, 0, 'both merged: kept');
});

rule('An app update keeps a checked copy of the app it replaces, the old preflight.html too', () => {
  const dir = tmp(), old = '<meta name="flightdeck-version" content="1.0.0">older app', legacy = '<meta name="preflight-version" content="1.7.0">legacy app';
  fs.writeFileSync(path.join(dir, 'flightdeck.html'), old);
  fs.writeFileSync(path.join(dir, 'preflight.html'), legacy);
  const r = cli('install', dir, '--app-only');
  assert.ok(r.code === 0 && /Copies of the files it replaced are in/.test(r.out), r.out);
  const rep = at(dir, '.flightdeck/updates/' + VER + '/replaced'), run = path.join(rep, fs.readdirSync(rep)[0]);
  assert.strictEqual(fs.readFileSync(path.join(run, 'flightdeck.html'), 'utf8'), old);
  assert.strictEqual(fs.readFileSync(path.join(run, 'preflight.html'), 'utf8'), legacy);
});

/* ---------- flightdeck export ---------- */
const EV = require('./evidence-fixture');
let evFiles = null;
async function teamFolder(edit) {
  evFiles = evFiles || (await EV.build(require('./harness').load())).files;
  const files = Object.assign({}, evFiles);
  if (edit) edit(files);
  return EV.toDisk(files, tmp());
}
const zipsIn = (d) => fs.existsSync(d) ? fs.readdirSync(d) : [];
function pyCheck(file) {
  for (const c of ['python3', 'python']) {
    try { return cp().execFileSync(c, ['-I', path.join(__dirname, 'check_pack.py'), file], { encoding: 'utf8' }); } catch (e) { if (e.code !== 'ENOENT') throw new Error(String(e.stdout) + String(e.stderr)); }
  }
  return 'skipped';
}
function cp() { return require('child_process'); }

rule('export --run makes a pack outside the team folder, prints its SHA-256 to keep separately, and changes nothing in the folder', async () => {
  const dir = await teamFolder(), out = tmp(), before = EV.tree(dir);
  const r = cli('export', dir, '--run', 'release/run1', '--out', out, '--tz', 'UTC');
  assert.strictEqual(r.code, 0, r.out);
  const zips = zipsIn(out);
  assert.strictEqual(zips.length, 1, zips.join(', '));
  assert.ok(/\.zip$/.test(zips[0]) && !/partial/.test(zips[0]));
  const digest = /SHA-256 of this pack: ([0-9a-f]{64})/.exec(r.out);
  assert.ok(digest, r.out);
  assert.strictEqual(digest[1], require('crypto').createHash('sha256').update(fs.readFileSync(path.join(out, zips[0]))).digest('hex'));
  assert.ok(/Keep it somewhere separate/.test(r.out) && /people directory and its email fields are left out/.test(r.out), r.out);
  assert.ok(/^ok|skipped/.test(pyCheck(path.join(out, zips[0]))));
  assert.deepStrictEqual(EV.tree(dir), before, 'the team folder tree is identical');
});

rule('export exit codes: 4 for a partial pack (run.json missing), 1 with no file left for a run that isn\'t there', async () => {
  const dir = await teamFolder((f) => { delete f['runs/release/run1/run.json']; }), out = tmp();
  let r = cli('export', dir, '--run', 'release/run1', '--out', out);
  assert.strictEqual(r.code, 4, r.out);
  assert.ok(/partial/i.test(r.out) && /run\.json is missing/.test(r.out), r.out);
  assert.strictEqual(zipsIn(out).filter(n => /\.zip$/.test(n)).length, 1);
  const out2 = tmp();
  r = cli('export', dir, '--run', 'release/nope', '--out', out2);
  assert.strictEqual(r.code, 1, r.out);
  assert.deepStrictEqual(zipsIn(out2), [], 'nothing left behind');
  r = cli('export', dir, '--out', out2);
  assert.ok(r.code === 1 && /--run|--process/.test(r.out), r.out);
});

rule('export refuses an --out inside the team folder', async () => {
  const dir = await teamFolder();
  const r = cli('export', dir, '--run', 'release/run1', '--out', path.join(dir, 'packs'));
  assert.ok(r.code === 1 && /inside the team folder/.test(r.out), r.out);
  assert.ok(!fs.existsSync(path.join(dir, 'packs')));
});

rule('export --from and --through are inclusive days in --tz, compared with when each run started', async () => {
  const dir = await teamFolder((f) => {
    const t = f['runs/release/run1/run.json'].toString('utf8');
    f['runs/release/run2/run.json'] = Buffer.from(t.replace(/"id": "run1"/, '"id": "run2"').replace(/"created": "[^"]+"/, '"created": "2026-10-18T00:00:00.000Z"'));
  });
  const runsIn = (...a) => {
    const out = tmp(), r = cli('export', dir, '--process', 'release', '--out', out, ...a);
    if (r.code === 1) return { code: 1, runs: [], out: r.out };
    const zip = fs.readFileSync(path.join(out, zipsIn(out)[0])), man = JSON.parse(zipEntry(zip, 'manifest.json'));
    return { code: r.code, runs: man.runs.map(x => x.key).sort(), tz: man.scope.tz, out: r.out };
  };
  let x = runsIn('--from', '2026-10-17', '--through', '2026-10-17', '--tz', 'UTC');
  assert.deepStrictEqual(x.runs, ['release/run1'], x.out);
  assert.strictEqual(x.tz, 'UTC');
  x = runsIn('--from', '2026-10-18', '--through', '2026-10-18', '--tz', 'UTC');
  assert.deepStrictEqual(x.runs, ['release/run2'], 'midnight belongs to the day it starts');
  x = runsIn('--from', '2026-10-18', '--through', '2026-10-18', '--tz', 'Asia/Tokyo');
  assert.deepStrictEqual(x.runs, ['release/run1', 'release/run2'], 'both are the 18th in Tokyo');
  x = runsIn('--from', '2026-10-17', '--through', '2026-10-17', '--tz', 'America/New_York');
  assert.deepStrictEqual(x.runs, ['release/run1', 'release/run2'], 'both are the 17th in New York');
  x = runsIn('--from', '2026-10-19', '--through', '2026-10-20', '--tz', 'UTC');
  assert.ok(x.code === 1 && /No runs/.test(x.out), x.out);
  assert.ok(/--from/.test(cli('export', dir, '--process', 'release', '--through', '2026-10-17').out));
  assert.ok(cli('export', dir, '--process', 'release', '--from', '2026-10-17', '--through', '2026-10-17', '--tz', 'Nowhere/Here').code === 1);
});

rule('export reads through no link: a linked parent folder is refused, and a file that is a link is skipped and named', async () => {
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside the team folder');
  const dir = await teamFolder();
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'runs/release/run1/files/linked.log'));
  const out = tmp(), r = cli('export', dir, '--run', 'release/run1', '--out', out);
  assert.strictEqual(r.code, 0, r.out);
  const zip = fs.readFileSync(path.join(out, zipsIn(out)[0]));
  assert.ok(!zip.includes(Buffer.from('outside the team folder')), 'never followed');
  assert.ok(JSON.parse(zipEntry(zip, 'manifest.json')).exclusions.some(x => /linked\.log$/.test(x.path) && /link/.test(x.reason)));
  const dir2 = await teamFolder(), real = path.join(tmp(), 'release');
  fs.renameSync(path.join(dir2, 'runs', 'release'), real);
  fs.symlinkSync(real, path.join(dir2, 'runs', 'release'));
  const out2 = tmp(), r2 = cli('export', dir2, '--run', 'release/run1', '--out', out2);
  assert.ok(r2.code === 1 && /link/.test(r2.out), r2.out);
  assert.deepStrictEqual(zipsIn(out2), []);
});

rule('The export read adapter skips a file swapped for a link after the folder was listed', async () => {
  const dir = await teamFolder(), outside = tmp(), A = require('../bin/flightdeck.js').readAdapter(fs.realpathSync(dir));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  const names = (await A.list('runs/release/run1/files')).map(i => i.name);
  const victim = 'runs/release/run1/files/' + names[0];
  fs.unlinkSync(path.join(dir, victim)); fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, victim));
  await assert.rejects(A.blob(victim), /link/);
  assert.ok(A.links.some(p => p === victim));
});

rule('An interrupted export leaves no partial file, and exits 1', async () => {
  const dir = await teamFolder((f) => { f['runs/release/run1/files/20261017-dddddd-w2-big.bin'] = require('crypto').randomBytes(48 * 1048576); });
  const out = tmp(), child = cp().spawn(process.execPath, [BIN, 'export', dir, '--run', 'release/run1', '--out', out], { stdio: 'pipe' });
  const code = await new Promise((res) => {
    let sent = false;
    const look = setInterval(() => { if (!sent && zipsIn(out).some(n => /\.partial$/.test(n))) { sent = true; child.kill('SIGINT'); } }, 2);
    child.on('exit', (c) => { clearInterval(look); res(sent ? c : 'finished before it could be interrupted'); });
  });
  assert.strictEqual(code, 1);
  assert.deepStrictEqual(zipsIn(out), [], 'no .partial, no .zip');
});

function zipEntry(buf, name) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    if (buf.slice(p + 46, p + 46 + nl).toString('utf8') === name) { const l = buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28); return buf.slice(off + 30 + l, off + 30 + l + size).toString('utf8'); }
    p += 46 + nl + xl + cl;
  }
  return null;
}

/* ---------- Review fixes (78edf20) ---------- */
rule('export --out through a link into the team folder is refused before anything is created', async () => {
  const dir = await teamFolder(), side = tmp();
  fs.mkdirSync(path.join(dir, 'reports'));
  fs.symlinkSync(path.join(dir, 'reports'), path.join(side, 'out-link'));
  const before = EV.tree(dir), r = cli('export', dir, '--run', 'release/run1', '--out', path.join(side, 'out-link', 'new-dir', 'deeper'));
  assert.ok(r.code === 1 && /inside the team folder/.test(r.out), r.out);
  assert.ok(!fs.existsSync(path.join(dir, 'reports', 'new-dir')), 'nothing created in the team folder');
  assert.deepStrictEqual(EV.tree(dir), before);
});

rule('export never removes a .partial file it didn\'t create, and two exports in the same second get different names', async () => {
  const dir = await teamFolder(), out = tmp(), C = require('../bin/flightdeck.js');
  let theirs = null;
  const orig = fs.openSync;
  fs.openSync = function (p, flags) { if (flags === 'wx' && /\.partial$/.test(String(p))) { theirs = String(p); fs.writeFileSync(theirs, 'another export'); } return orig.apply(fs, arguments); };
  let r;
  try { r = await C.main(['export', dir, '--run', 'release/run1', '--out', out]); } catch (e) { r = { code: 1, out: e.message }; } finally { fs.openSync = orig; }
  assert.ok(theirs && r.code === 1, r.out);
  assert.strictEqual(fs.readFileSync(theirs, 'utf8'), 'another export', 'left as it was');
  const out2 = tmp();
  cli('export', dir, '--run', 'release/run1', '--out', out2); cli('export', dir, '--run', 'release/run1', '--out', out2);
  const names = zipsIn(out2);
  assert.strictEqual(names.length, 2);
  assert.ok(names.every(n => /-[a-z0-9]{6}\.zip$/.test(n) && !/\(2\)/.test(n)), names.join(', '));
});

rule('The export read adapter refuses a file reached through a parent folder swapped for a link while it was opened, even if the folder is put back', async () => {
  const dir = fs.realpathSync(await teamFolder()), outside = tmp(), A = require('../bin/flightdeck.js').readAdapter(dir);
  const files = path.join(dir, 'runs/release/run1/files'), name = (await A.list('runs/release/run1/files')).map(i => i.name).filter(n => /\.log$/.test(n))[0];
  fs.writeFileSync(path.join(outside, name), 'outside the team folder');
  /* The swap lands after the folders were checked and before the file's own lstat; it's put back once the file is open. */
  const target = path.join(files, name), origL = fs.lstatSync, origO = fs.openSync;
  let swapped = false, swaps = 0, armed = false;
  fs.lstatSync = function (p) { if (String(p) === target && armed) { armed = false; swapped = true; swaps++; fs.renameSync(files, files + '.real'); fs.symlinkSync(outside, files); } return origL.apply(fs, arguments); };
  fs.openSync = function (p) { try { return origO.apply(fs, arguments); } finally { if (String(p) === target && swapped) { fs.unlinkSync(files); fs.renameSync(files + '.real', files); swapped = false; } } };
  try {
    armed = true; await assert.rejects(A.blob('runs/release/run1/files/' + name), /link/);
    armed = true; await assert.rejects(A.read('runs/release/run1/files/' + name), /link/);
  } finally { fs.lstatSync = origL; fs.openSync = origO; if (swapped) { fs.unlinkSync(files); fs.renameSync(files + '.real', files); } }
  assert.strictEqual(swaps, 2, 'the swap happened both times');
  const ok = await A.read('runs/release/run1/files/' + name);
  assert.ok(ok && !/outside/.test(ok.text), 'the real file reads normally afterwards');
});

/* ---------- Second review (48f49d7) ---------- */
rule('The export read adapter checks the team folder itself: replaced by a link, nothing is read through it', async () => {
  const dir = fs.realpathSync(await teamFolder()), A = require('../bin/flightdeck.js').readAdapter(dir), outside = fs.realpathSync(await teamFolder());
  fs.writeFileSync(path.join(outside, 'runs/release/run1/run.json'), '{"outside": true}');
  fs.renameSync(dir, dir + '.real'); fs.symlinkSync(outside, dir);
  try {
    await assert.rejects(A.read('runs/release/run1/run.json'), /link/);
    await assert.rejects(A.list('runs/release'), /link/);
  } finally { fs.unlinkSync(dir); fs.renameSync(dir + '.real', dir); }
});

rule('export reads a run.json with a UTF-8 byte-order mark like any other: a complete pack', async () => {
  const dir = await teamFolder((f) => { f['runs/release/run1/run.json'] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f['runs/release/run1/run.json']]); });
  const out = tmp(), r = cli('export', dir, '--run', 'release/run1', '--out', out);
  assert.strictEqual(r.code, 0, r.out);
});


/* ---------- READ: flightdeck processes | process | runs | run | next | followups --json (1.18) ---------- */
const RF = require('./read-fixture');
const FD = require('../bin/flightdeck.js');
const SRC = require('./harness').load(), AJ = SRC.appjson;
/* What's wrong with a value against a schema entry, as a plain list (the sandbox's arrays have their own prototype). */
const wrong = (v, d) => JSON.parse(JSON.stringify(AJ.conforms(v, d)));
let rfBuilt = null;
async function readFolder(edit, after) {
  rfBuilt = rfBuilt || await RF.build(SRC);
  const files = Object.assign({}, rfBuilt.files);
  if (edit) edit(files, rfBuilt);
  const dir = RF.toDisk(files, tmp());
  if (after) after(dir);
  return dir;
}
function readCli(...a) {
  const r = cp().spawnSync(process.execPath, [BIN, ...a], { encoding: 'utf8', maxBuffer: 64 * 1048576 });
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* the caller says what it expected */ }
  return { code: r.status, json, out: r.stdout, err: r.stderr };
}
/* The contract's promise, checked on every READ call in these tests: complete, a non-empty problems list and exit 4 agree,
   and an error object (no data) exits 1 or 5. */
function agree(r) {
  assert.ok(r.json, 'JSON on stdout: ' + r.out + r.err);
  if (r.json.error) {
    assert.deepStrictEqual(wrong(r.json, AJ.SCHEMA.error), [], 'error object');
    assert.ok(r.code === 1 || r.code === 5, 'an error object exits 1 or 5, not ' + r.code);
    return r;
  }
  assert.deepStrictEqual(wrong(r.json, AJ.SCHEMA.envelope), [], 'envelope');
  assert.strictEqual(r.json.contract, 'flightdeck-read/1');
  assert.strictEqual(r.json.complete, r.json.problems.length === 0, 'complete is true exactly when problems is empty');
  assert.strictEqual(r.code === 4, !r.json.complete, 'exit 4 exactly when not complete (exit ' + r.code + ')');
  if (r.json.complete) assert.strictEqual(r.code, 0);
  return r;
}
const shape = (r, name) => assert.deepStrictEqual(wrong(r.json.data, AJ.SCHEMA[name]), [], name + ' data');

rule('READ: processes --json lists each process with its versions, in the documented shape', async () => {
  const dir = await readFolder(), r = agree(readCli('processes', dir, '--json'));
  assert.strictEqual(r.code, 0, r.out + r.err); shape(r, 'processes');
  assert.strictEqual(r.json.app, cli('version').out.trim());
  const p = r.json.data.processes[0];
  assert.strictEqual(p.id, 'release'); assert.strictEqual(p.title, 'Production release'); assert.strictEqual(p.category, 'Releases');
  assert.deepStrictEqual(p.group, ['Engineering', 'Releases']); assert.deepStrictEqual(p.tags, ['production', 'deploy']); assert.strictEqual(p.owner, 'person-casey');
  assert.deepStrictEqual(p.latest, { version: 1, folder: rfBuilt.folder });
  assert.deepStrictEqual(p.versions.map(v => [v.folder, v.version, v.usable, v.why, v.clash, v.publishedBy]), [[rfBuilt.folder, 1, true, null, false, 'person-avery']]);
});

rule('READ: process --json gives phases, steps, gates and the publication\'s evidence; a version that isn\'t there exits 5', async () => {
  const dir = await readFolder(), r = agree(readCli('process', dir, 'release', '--json'));
  assert.strictEqual(r.code, 0, r.out + r.err); shape(r, 'process');
  const d = r.json.data, steps = [].concat(...d.phases.map(p => p.steps)), by = id => steps.filter(s => s.id === id)[0];
  assert.strictEqual(d.evidenceFrom, 'publication'); assert.strictEqual(d.usable, true); assert.strictEqual(d.version.folder, rfBuilt.folder);
  assert.ok(d.context.includes('commit') && d.roles.includes('release-lead'));
  assert.ok(by('approved').evidence.some(e => e.name === 'number' && e.required === true), JSON.stringify(by('approved').evidence));
  assert.deepStrictEqual(by('tests').binds, ['commit']); assert.strictEqual(by('approved').must, true); assert.deepStrictEqual(by('approved').roles, ['release-lead']);
  assert.strictEqual(by('notes').type, 'run.process');
  assert.strictEqual(d.phases[0].gate.id, 'ready'); assert.deepStrictEqual(d.phases[0].gate.binds, ['commit', 'environment']);
  for (const a of [['--version', '1'], ['--folder', rfBuilt.folder]]) assert.deepStrictEqual(agree(readCli('process', dir, 'release', ...a, '--json')).json.data, d, a.join(' '));
  for (const a of [['release', '--version', '9'], ['release', '--folder', 'v9-zzzz9999'], ['nope']]) {
    const x = agree(readCli('process', dir, ...a, '--json'));
    assert.ok(x.code === 5 && x.json.error.kind === 'not-found', a.join(' ') + ': ' + x.out);
  }
});

rule('READ: runs --json lists runs and planned runs, filtered by --process and --status', async () => {
  const dir = await readFolder(), r = agree(readCli('runs', dir, '--json'));
  assert.strictEqual(r.code, 0, r.out + r.err); shape(r, 'runs');
  const d = r.json.data, run1 = d.runs.filter(x => x.key === 'release/run1')[0], run2 = d.runs.filter(x => x.key === 'release/run2')[0];
  assert.strictEqual(run1.state, 'running'); assert.deepStrictEqual(run1.recorder, { id: 'person-casey', name: 'Casey Nguyen' });
  assert.strictEqual(run1.progress.done, 1); assert.ok(run1.progress.total > 5); assert.strictEqual(run1.details.commit, 'aaa111'); assert.strictEqual(run1.ended, null);
  assert.strictEqual(run2.state, 'completed'); assert.strictEqual(run2.ended.outcome, 'Completed');
  assert.deepStrictEqual(d.planned.map(p => [p.id, p.status, p.run]), [['plan-release-2026-10-24', 'pending', null]]);
  const keys = (...a) => { const x = agree(readCli('runs', dir, ...a, '--json')); return [x.json.data.runs.map(y => y.key).sort(), x.json.data.planned.length]; };
  assert.deepStrictEqual(keys('--status', 'running'), [['release/run1'], 0]);
  assert.deepStrictEqual(keys('--status', 'ended'), [['release/run2'], 0]);
  assert.deepStrictEqual(keys('--status', 'planned'), [[], 1]);
  assert.deepStrictEqual(keys('--process', 'release'), [['release/run1', 'release/run2'], 1]);
  assert.strictEqual(agree(readCli('runs', dir, '--process', 'nope', '--json')).code, 5);
  assert.strictEqual(readCli('runs', dir, '--status', 'sometimes', '--json').code, 1);
});

rule('READ: run --json gives each step\'s state, who and when, its values and the run\'s own evidence, gates and follow-ups', async () => {
  const dir = await readFolder(), r = agree(readCli('run', dir, 'release/run1', '--json'));
  assert.strictEqual(r.code, 0, r.out + r.err); shape(r, 'run');
  const run = r.json.data.run, step = run.steps.filter(s => s.id === 'approved')[0];
  assert.strictEqual(run.key, 'release/run1'); assert.strictEqual(step.state, 'done'); assert.deepStrictEqual(step.by, { id: 'person-casey', name: 'Casey Nguyen' });
  assert.strictEqual(step.values.number, 'sample number');
  const local = SRC.run.sanitize(JSON.parse(rfBuilt.files['runs/release/run1/run.json']));
  const want = SRC.run.evidenceFor(local, SRC.map.findStep(SRC.run.mapOf(local), 'approved').step).list.map(e => e.name);
  assert.deepStrictEqual(step.evidence.map(e => e.name), want);
  assert.ok(run.gates.some(g => g.id === 'ready' && g.status === 'open'));
  assert.deepStrictEqual(run.roles.filter(x => x.role === 'qa')[0].person, { id: 'person-morgan', name: 'Morgan Diaz' });
  const r2 = agree(readCli('run', dir, 'release/run2', '--json')).json.data.run;
  assert.deepStrictEqual(r2.followUps.map(f => [f.id, f.status]), [['fu1', 'ticket'], ['fu2', 'open']]);
  assert.strictEqual(r2.followUps[0].decision.ticket, 'ABC-124');
  assert.strictEqual(agree(readCli('run', dir, 'release/run9', '--json')).code, 5);
  assert.strictEqual(agree(readCli('run', dir, 'nope/run1', '--json')).code, 5);
  assert.strictEqual(readCli('run', dir, 'release', '--json').code, 1);
});

rule('READ: next --json says what\'s waiting and on whom, as the run screen does; --person adds that person\'s next step', async () => {
  const dir = await readFolder(), r = agree(readCli('next', dir, 'release/run1', '--json'));
  assert.strictEqual(r.code, 0, r.out + r.err); shape(r, 'next');
  const local = SRC.run.sanitize(JSON.parse(rfBuilt.files['runs/release/run1/run.json'])), map = SRC.run.mapOf(local), nu = SRC.run.nextUp(local, map);
  const n = r.json.data.next;
  assert.strictEqual(n.kind, nu.kind); assert.strictEqual(n.step.id, nu.step.id);
  assert.deepStrictEqual(n.step.roles, [...nu.step.roles].map(ro => ({ role: ro, person: { id: local.roles[ro], name: rfBuilt.people.filter(p => p.id === local.roles[ro])[0].name } })));
  assert.strictEqual(r.json.data.person, null); assert.strictEqual(r.json.data.mine, null);
  const m = agree(readCli('next', dir, 'release/run1', '--person', 'person-blake', '--json')).json.data, mine = SRC.run.myNext(local, map, 'person-blake');
  assert.deepStrictEqual(m.person, { id: 'person-blake', name: 'Blake Ortiz' });
  assert.strictEqual(m.mine.step.id, mine.step.id);
});

rule('READ: followups --json lists every follow-up with its current decision; --status open leaves out the decided ones', async () => {
  const dir = await readFolder(), r = agree(readCli('followups', dir, '--json'));
  assert.strictEqual(r.code, 0, r.out + r.err); shape(r, 'followups');
  const f = r.json.data.followUps;
  assert.deepStrictEqual(f.map(x => [x.key, x.status, x.label]), [['release/run2/fu1', 'ticket', 'Moved to a ticket'], ['release/run2/fu2', 'open', 'Open']]);
  assert.deepStrictEqual(f[0].owner, { id: 'person-blake', name: 'Blake Ortiz' }); assert.strictEqual(f[0].decision.ticket, 'ABC-124');
  assert.deepStrictEqual(agree(readCli('followups', dir, '--status', 'open', '--json')).json.data.followUps.map(x => x.id), ['fu2']);
});

/* Each case: what to break, the commands that must report it, and the problem's path and kind. */
const PROBLEMS = [
  ['a run folder without run.json', f => { f['runs/release/run3/notes-w9.jsonl'] = '{"id":"n1","text":"hello"}\n'; }, null, [['runs'], ['followups']], 'runs/release/run3/run.json', 'nofile'],
  ['a malformed proposal', f => { f['proposals/plan-broken.json'] = '{"kind": "plan", '; }, null, [['runs']], 'proposals/plan-broken.json', 'malformed'],
  ['a proposal that isn\'t a plan', f => { f['proposals/plan-odd.json'] = '{"kind": "plan", "id": 7}'; }, null, [['runs']], 'proposals/plan-odd.json', 'malformed'],
  ['a malformed follow-up decision', f => { f['followups/release/run2.fu2.w3.1.json'] = '{"kind": "followup-dec'; }, null, [['followups'], ['run', 'release/run2']], 'followups/release/run2.fu2.w3.1.json', 'malformed'],
  ['a malformed run.json', f => { f['runs/release/run5/run.json'] = '{"format": "preflight-run/2", "id": "run5"'; }, null, [['runs']], 'runs/release/run5/run.json', 'malformed'],
  ['a run from a newer Flightdeck', f => { f['runs/release/run4/run.json'] = JSON.stringify({ format: 'preflight-run/3', id: 'run4', process: 'release', title: 'From the future' }); }, null, [['runs'], ['run', 'release/run4']], 'runs/release/run4/run.json', 'newer'],
  ['an unusable version', (f, b) => addVersion(f, b, 2, 'bbbb2222', md => md.replace('{confirm} Feature flags', '{no.such} Feature flags')), null, [['processes'], ['process', 'release']], 'publications/release/v2-bbbb2222/', 'unusable'],
  ['a version from a newer Flightdeck', (f, b) => addVersion(f, b, 3, 'cccc3333', null, 'preflight-publication/2'), null, [['processes'], ['process', 'release']], 'publications/release/v3-cccc3333/', 'newer'],
  ['a version still syncing', (f, b) => { addVersion(f, b, 4, 'dddd4444'); delete f['publications/release/v4-dddd4444/map.md']; }, null, [['processes']], 'publications/release/v4-dddd4444/', 'still-syncing'],
  ['conflict copies beside a run', f => { f['runs/release/run1/run-LAPTOP.json'] = f['runs/release/run1/run.json'].replace('Release 2026.10.20', 'Release 2026.10.20 (copy)'); }, null, [['runs'], ['run', 'release/run1'], ['next', 'release/run1']], 'runs/release/run1/', 'conflict'],
  ['a link the CLI won\'t follow', null, dir => { const o = tmp(); fs.writeFileSync(path.join(o, 'x.json'), '{"kind": "plan", "id": "plan-x", "process": "release"}'); fs.symlinkSync(path.join(o, 'x.json'), path.join(dir, 'proposals', 'plan-x.json')); }, [['runs']], 'proposals/plan-x.json', 'link'],
  ['a file too large to read', null, dir => { fs.writeFileSync(path.join(dir, 'runs', 'release', 'run1', 'notes-big.jsonl'), Buffer.alloc(17 * 1048576, 32)); }, [['runs'], ['run', 'release/run1']], 'runs/release/run1/notes-big.jsonl', 'skipped']
];
function addVersion(f, b, n, rand, edit, format) {
  const src = 'publications/release/' + b.folder + '/', dst = 'publications/release/v' + n + '-' + rand + '/';
  const md = edit ? edit(f[src + 'map.md']) : f[src + 'map.md'], info = JSON.parse(f[src + 'publication.json']);
  Object.assign(info, { version: n, folder: 'v' + n + '-' + rand, mapHash: SRC.util.hash(md) }, format ? { format } : {});
  f[dst + 'map.md'] = md; f[dst + 'types.json'] = f[src + 'types.json']; f[dst + 'publication.json'] = JSON.stringify(info, null, 2);
}
const ALL = [['processes'], ['process', 'release'], ['runs'], ['run', 'release/run1'], ['next', 'release/run1'], ['followups']];

rule('READ: a clean folder reads complete, exit 0, with no problems, from every command', async () => {
  const dir = await readFolder();
  ALL.forEach(([c, ...a]) => { const r = agree(readCli(c, dir, ...a, '--json')); assert.ok(r.json.complete && r.code === 0, c + ': ' + JSON.stringify(r.json.problems)); });
});

PROBLEMS.forEach(([name, edit, after, cmds, at, kind]) => {
  rule('READ: ' + name + ' is reported per file (' + kind + '), the result is partial with exit 4, and the data is still printed', async () => {
    const dir = await readFolder(edit, after);
    cmds.forEach(([c, ...a]) => {
      const r = agree(readCli(c, dir, ...a, '--json'));
      assert.strictEqual(r.code, 4, c + ' ' + a.join(' ') + ': exit ' + r.code + ' ' + r.err);
      assert.ok(r.json.problems.some(p => p.path === at && p.kind === kind), c + ': ' + JSON.stringify(r.json.problems));
      assert.ok(r.json.data && typeof r.json.data === 'object', 'data still printed');
    });
  });
});

rule('READ: each command reports only problems in its own scope', async () => {
  const dir = await readFolder(f => { f['proposals/plan-broken.json'] = '{'; f['runs/release/run3/notes-w9.jsonl'] = '{}\n'; });
  assert.ok(agree(readCli('processes', dir, '--json')).json.complete, 'processes: runs and proposals are out of scope');
  assert.ok(agree(readCli('run', dir, 'release/run1', '--json')).json.complete, 'run: only that run, its version and its decisions');
  assert.strictEqual(agree(readCli('runs', dir, '--json')).json.problems.length, 2);
});

rule('READ: people-directory email fields never appear in any command\'s output', async () => {
  const dir = await readFolder(), emails = rfBuilt.people.map(p => p.email).filter(Boolean);
  assert.ok(emails.length >= 3);
  ALL.concat([['next', 'release/run1', '--person', 'person-blake']]).forEach(([c, ...a]) => {
    const r = agree(readCli(c, dir, ...a, '--json'));
    emails.forEach(e => assert.ok(!r.out.includes(e), c + ' shows ' + e));
    assert.ok(!/"email"/.test(r.out), c + ' has an email field');
  });
});

rule('READ never changes the folder: the tree is identical after every command, with an old save receipt that loading would remove', async () => {
  const dir = await readFolder(f => { f['runs/release/run1/candidate-other-zzzz9999.json'] = f['runs/release/run1/run.json'].replace(/"rev": \d+/, '"rev": 77'); });
  const before = EV.tree(dir);
  assert.ok(Object.keys(before).includes('runs/release/run1/candidate-other-zzzz9999.json'));
  ALL.forEach(([c, ...a]) => { const r = agree(readCli(c, dir, ...a, '--json')); assert.ok(r.json.complete, c + ': ' + JSON.stringify(r.json.problems)); });
  assert.deepStrictEqual(EV.tree(dir), before, 'the team folder tree is identical, the save receipt included');
});

/* A folder in memory whose write, append and remove throw and are counted, for the in-process READ engine. */
function strictFolder(files, seen) {
  const B = new EV.BytesFS(files, { strict: true, hooks: seen ? { list: p => seen.push('list ' + p), read: p => seen.push('read ' + p), stat: p => seen.push('stat ' + p), blob: p => seen.push('blob ' + p) } : {} });
  B.mtimes.forEach((v, k) => B.mtimes.set(k, RF.OLD.getTime()));
  return B;
}
const REQ = { processes: { cmd: 'processes' }, process: { cmd: 'process', proc: 'release' }, runs: { cmd: 'runs' }, run: { cmd: 'run', key: 'release/run1' }, next: { cmd: 'next', key: 'release/run1', person: 'person-casey' }, followups: { cmd: 'followups' } };

rule('READ: every mutating method of the folder throws, and no command calls one', async () => {
  await readFolder();
  const files = Object.assign({}, rfBuilt.files, { 'runs/release/run1/candidate-other-zzzz9999.json': rfBuilt.files['runs/release/run1/run.json'].replace(/"rev": \d+/, '"rev": 77') });
  const eng = { PF: SRC, version: 'test' };
  for (const k of Object.keys(REQ)) {
    const B = strictFolder(files), r = await FD.readData(eng, B, REQ[k]);
    assert.strictEqual(r.code, 0, k + ': ' + JSON.stringify(r.json.problems || r.json.error));
    assert.deepStrictEqual(B.mutations, [], k);
  }
  const ro = SRC.repo.readOnly(strictFolder(files));
  ['write', 'append', 'remove'].forEach(m => assert.throws(() => ro[m]('runs/release/run1/run.json', 'x'), /read-only/));
});

rule('READ: run and next read only their own run, its version, its follow-up decisions and the people list', async () => {
  await readFolder();
  const files = Object.assign({}, rfBuilt.files), eng = { PF: SRC, version: 'test' };
  const ok = ['list followups', 'list runs/release', 'runs/release/run1/', 'runs/release/run1', 'publications/release/' + rfBuilt.folder + '/', 'list followups/release', 'followups/release/run1.', 'read people.json'];
  for (const k of ['run', 'next']) {
    const seen = [], r = await FD.readData(eng, strictFolder(files, seen), REQ[k]);
    assert.strictEqual(r.code, 0, k);
    const stray = seen.filter(s => { const p = s.replace(/^\w+ /, ''); return !ok.some(o => s === o || p.startsWith(o)); });
    assert.deepStrictEqual(stray, [], k + ' read outside its run');
    assert.ok(seen.some(s => s === 'read runs/release/run1/run.json'));
  }
});

rule('READ: next equals the run screen\'s Next up at every point of a run, from first step to the end', async () => {
  await readFolder();
  const R = SRC.run, mem = new SRC.fs.MemoryFS('read-next:' + Math.random(), null), eng = { PF: SRC, version: 'test' };
  mem.reset(rfBuilt.files);
  const r = R.sanitize(JSON.parse(rfBuilt.files['runs/release/run1/run.json'])), map = R.mapOf(r), done = require('./harness').sampleDone(SRC);
  let checks = 0;
  for (let pi = 0; pi < map.phases.length; pi++) {
    for (const s of map.phases[pi].steps.concat([null])) {
      await mem.write('runs/release/run1/run.json', JSON.stringify(r, null, 2));
      const got = (await FD.readData(eng, mem, { cmd: 'next', key: 'release/run1' })).json.data.next, nu = R.nextUp(r, map);
      assert.strictEqual(got.kind, nu.kind);
      assert.strictEqual(got.step ? got.step.id : null, nu.step ? nu.step.id : null);
      assert.strictEqual(got.gate ? got.gate.id : null, nu.gate ? nu.gate.id : null);
      checks++;
      if (s && !R.answered(r, s)) done(r, map, s.id, 'person-casey', RF.NOW);
    }
    R.pass(r, map, pi, 'person-casey', RF.NOW);
  }
  R.end(r, map, 'Completed', 'person-casey', 'Casey Nguyen', RF.NOW);
  await mem.write('runs/release/run1/run.json', JSON.stringify(r, null, 2));
  assert.strictEqual((await FD.readData(eng, mem, { cmd: 'next', key: 'release/run1' })).json.data.next.kind, 'ended');
  assert.ok(checks > 10, 'checked ' + checks + ' points');
});

rule('READ: --contract 1 is this contract; one this copy doesn\'t have exits 1 naming those it has', async () => {
  const dir = await readFolder();
  assert.strictEqual(agree(readCli('runs', dir, '--contract', '1', '--json')).code, 0);
  const r = agree(readCli('runs', dir, '--contract', '2', '--json'));
  assert.ok(r.code === 1 && r.json.error.kind === 'contract' && /flightdeck-read\/1/.test(r.json.error.why), r.out);
});

rule('READ: without --json, or on a folder that can\'t be read, nothing is printed as data and the exit code is 1', async () => {
  const dir = await readFolder();
  let r = readCli('runs', dir);
  assert.ok(r.code === 1 && /--json/.test(r.err), r.out + r.err);
  r = agree(readCli('runs', path.join(dir, 'nope'), '--json'));
  assert.ok(r.code === 1 && r.json.error.kind === 'failed', r.out);
});


rule('READ: the size cap reaches the folder through the wrappers, and a file over it is refused before any byte is read', async () => {
  const dir = await readFolder();
  fs.writeFileSync(path.join(dir, 'proposals', 'big.json'), Buffer.alloc(4096, 32));
  const A = FD.readAdapter(fs.realpathSync(dir)), view = SRC.repo.lane(SRC.repo.readOnly(A, 'Reading for other apps'), 'load');
  const orig = fs.readFileSync, reads = [];
  fs.readFileSync = function (f) { if (typeof f === 'number') reads.push(f); return orig.apply(fs, arguments); };
  const origSync = fs.readSync;
  fs.readSync = function (f) { reads.push(f); return origSync.apply(fs, arguments); };
  try {
    await assert.rejects(view.read('proposals/big.json', { maxBytes: 1024 }), e => e.skipped === true && /over the 1\.0 KB/.test(e.message));
    await assert.rejects(view.blob('proposals/big.json', { maxBytes: 1024 }), e => e.skipped === true);
  } finally { fs.readFileSync = orig; fs.readSync = origSync; }
  assert.deepStrictEqual(reads, [], 'no bytes read');
  assert.deepStrictEqual(A.skipped.map(x => x.path), ['proposals/big.json']);
  assert.strictEqual((await view.read('proposals/big.json', { maxBytes: 8192 })).text.length, 4096, 'under the cap it reads');
});


rule('READ: a problem at a folder above the scope counts too: a linked process folder is named by runs --process', async () => {
  const dir = await readFolder(null, d => { const real = path.join(tmp(), 'release'); fs.renameSync(path.join(d, 'runs', 'release'), real); fs.symlinkSync(real, path.join(d, 'runs', 'release')); });
  for (const a of [['runs', '--process', 'release'], ['followups', '--process', 'release']]) {
    const r = agree(readCli(a[0], dir, ...a.slice(1), '--json'));
    assert.ok(r.code === 4 && r.json.problems.some(p => p.path === 'runs/release' && p.kind === 'link'), a.join(' ') + ': ' + JSON.stringify(r.json.problems));
  }
});


/* ---------- READ review: the problem ledger (every failed list, read, parse, size, link or vanished file, per path) ---------- */
const H = require('./harness');
/* The fixture's files as bytes in memory, through the in-process READ engine, with hooks that can fail or remove a file. */
async function readMem(req, edit, hooks) {
  await readFolder();
  const files = Object.assign({}, rfBuilt.files);
  if (edit) edit(files, rfBuilt);
  const B = new EV.BytesFS(files, { strict: true, hooks: hooks || {} });
  B.mtimes.forEach((v, k) => B.mtimes.set(k, RF.OLD.getTime()));
  const r = await FD.readData({ PF: SRC, version: 'test' }, B, req);
  return { code: r.code, json: JSON.parse(JSON.stringify(r.json)), out: JSON.stringify(r.json), err: '', B };
}
const has = (r, at, kind) => r.json.problems.some(p => p.path === at && p.kind === kind);
const eacces = p => Object.assign(new Error('EACCES: permission denied, open \'' + p + '\''), { code: 'EACCES' });

rule('READ: a checklist with screenshots reads like any other: processes and process list it, usable and complete', async () => {
  const mem = new SRC.fs.MemoryFS('shots:' + Math.random(), null), people = H.example('people.json');
  mem.reset({ 'people.json': people });
  await mem.write('images/x/job.png', new Blob(['picture one'], { type: 'image/png' }));
  const md = '---\nprocess: shots\ntitle: Shots\n---\n## P · READ-DO {#p}\n- [ ] {confirm} Look {#a}\n  ![The job page](images/x/job.png)';
  const pub = await SRC.repo.publish(mem, md, { people: JSON.parse(people), ...H.exampleSetup(SRC), by: 'person-avery', changes: 'x', existing: [], now: RF.NOW });
  assert.ok(!pub.blockers, String(pub.blockers));
  const dir = EV.toDisk(EV.bytesOf(mem), tmp());
  const r = agree(readCli('processes', dir, '--json'));
  assert.strictEqual(r.code, 0, JSON.stringify(r.json.problems || r.json.error));
  assert.deepStrictEqual(r.json.data.processes.map(p => [p.id, p.versions.map(v => v.usable)]), [['shots', [true]]]);
  const x = agree(readCli('process', dir, 'shots', '--json'));
  assert.ok(x.code === 0 && x.json.data.usable === true, x.out);
});

rule('READ: a run whose frozen step types are newer than this copy is listed as newer, never shown parsed', async () => {
  const edit = f => { const o = JSON.parse(f['runs/release/run1/run.json']), t = Object.keys(o.types)[0]; o.types[t].fromTheFuture = true; f['runs/release/run1/run.json'] = JSON.stringify(o, null, 2); };
  const r = agree(await readMem(REQ.run, edit));
  assert.ok(r.code === 4 && has(r, 'runs/release/run1/run.json', 'newer'), JSON.stringify(r.json.problems));
  assert.strictEqual(r.json.data.run, null, 'no parsed steps');
  const all = agree(await readMem(REQ.runs, edit));
  assert.ok(all.code === 4 && has(all, 'runs/release/run1/run.json', 'newer') && !all.json.data.runs.some(x => x.key === 'release/run1'), JSON.stringify(all.json.problems));
});

rule('READ: run and next name a version they couldn\'t check: publication.json unreadable or malformed, map.md missing', async () => {
  const at = f => 'publications/release/' + rfBuilt.folder + '/' + f;
  const cases = [
    [null, { read: p => { if (p === at('publication.json')) throw eacces(p); } }, at('publication.json'), 'unreadable'],
    [f => { f[at('publication.json')] = '{'; }, null, 'publications/release/' + rfBuilt.folder + '/', 'malformed'],
    [f => { delete f[at('map.md')]; }, null, 'publications/release/' + rfBuilt.folder + '/', 'still-syncing']
  ];
  for (const [edit, hooks, path0, kind] of cases) for (const k of ['run', 'next']) {
    const r = agree(await readMem(REQ[k], edit, hooks));
    assert.ok(r.code === 4 && has(r, path0, kind), k + ' ' + kind + ': ' + JSON.stringify(r.json.problems));
  }
});

rule('READ: one version that can\'t be read is named by file, and the healthy versions are still listed', async () => {
  const bad = 'publications/release/v2-bbbb2222/map.md';
  const r = agree(await readMem(REQ.processes, (f, b) => addVersion(f, b, 2, 'bbbb2222'), { read: p => { if (p === bad) throw eacces(p); } }));
  assert.ok(r.code === 4 && has(r, bad, 'unreadable'), JSON.stringify(r.json.problems));
  const rel = r.json.data.processes.filter(p => p.id === 'release')[0];
  assert.ok(rel && rel.versions.some(v => v.folder === rfBuilt.folder && v.usable), JSON.stringify(r.json.data));
  assert.ok(!r.json.problems.some(p => p.path === 'publications/'), 'not the whole part');
  const one = agree(await readMem(REQ.process, (f, b) => addVersion(f, b, 2, 'bbbb2222'), { read: p => { if (p === bad) throw eacces(p); } }));
  assert.ok(one.code === 4 && one.json.data.version.folder === rfBuilt.folder && has(one, bad, 'unreadable'), one.out);
});

rule('READ: a run.json gone between the listing and the read is named (vanished), never silently left out', async () => {
  const gone = 'runs/release/run1/run.json', hooks = { read: (p, B) => { if (p === gone) B.files.delete(p); } };
  for (const k of ['run', 'runs', 'next']) {
    const r = agree(await readMem(REQ[k], null, hooks));
    assert.ok(r.code === 4 && has(r, gone, 'vanished'), k + ': ' + JSON.stringify(r.json.problems));
  }
});

rule('READ: not found keeps every problem it met: a linked run folder exits 5 and names the link', async () => {
  const dir = await readFolder(null, d => { const real = path.join(tmp(), 'run1'); fs.renameSync(path.join(d, 'runs', 'release', 'run1'), real); fs.symlinkSync(real, path.join(d, 'runs', 'release', 'run1')); });
  for (const c of ['run', 'next']) {
    const r = agree(readCli(c, dir, 'release/run1', '--json'));
    assert.ok(r.code === 5 && r.json.error.kind === 'not-found', r.out);
    assert.ok(r.json.problems.some(p => p.path === 'runs/release/run1' && p.kind === 'link'), c + ': ' + r.out);
  }
  const u = agree(readCli('run', dir, 'release', '--json'));
  assert.ok(u.code === 1 && Array.isArray(u.json.problems), 'a usage error carries the (empty) ledger too');
});

rule('READ: a proposal or decision with a value outside the format is malformed and left out; it never throws or shows', async () => {
  const st = f => { f['proposals/plan-release-2026-10-24.status-w9.json'] = JSON.stringify({ kind: 'status', proposal: 'plan-release-2026-10-24', proposalHash: 'x', status: 'pizza', run: null, by: 'person-casey', at: RF.NOW }); };
  let r = agree(await readMem(REQ.runs, st));
  assert.ok(r.code === 4 && has(r, 'proposals/plan-release-2026-10-24.status-w9.json', 'malformed'), JSON.stringify(r.json.problems));
  assert.ok(!/pizza/.test(r.out));
  const bad = [{ details: { toString: {} } }, { title: 7 }, { roles: { qa: ['x'] } }, { version: {} }, { when: {} }, { note: [] }];
  for (const b of bad) {
    r = agree(await readMem(REQ.runs, f => { f['proposals/plan-odd.json'] = JSON.stringify(Object.assign({ kind: 'plan', id: 'plan-odd', process: 'release', title: 'Odd' }, b)); }));
    assert.ok(r.code === 4 && has(r, 'proposals/plan-odd.json', 'malformed'), JSON.stringify(b) + ': ' + JSON.stringify(r.json.problems));
    assert.ok(!r.json.data.planned.some(p => p.id === 'plan-odd') && r.json.data.runs.length === 2, JSON.stringify(b));
  }
});

rule('READ: the size cap counts the bytes read, so a file that grew after it was sized is still refused', async () => {
  const dir = await readFolder();
  fs.writeFileSync(path.join(dir, 'proposals', 'grew.json'), Buffer.alloc(4096, 32));
  const A = FD.readAdapter(fs.realpathSync(dir)), orig = fs.fstatSync;
  fs.fstatSync = function () { const st = orig.apply(fs, arguments); return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: 10 }); };
  try {
    await assert.rejects(A.read('proposals/grew.json', { maxBytes: 1024 }), e => e.skipped === true);
    const b = await A.blob('proposals/grew.json', { maxBytes: 1024 });
    await assert.rejects(b.arrayBuffer(), e => e.skipped === true);
  } finally { fs.fstatSync = orig; }
  assert.ok(A.skipped.some(x => x.path === 'proposals/grew.json'));
});

rule('READ: a people.json that can\'t be read as a people list is a problem, and names are left null', async () => {
  for (const text of ['{', '{"people": 5}', '[{"id": 7}]']) for (const k of ['runs', 'run', 'next', 'followups']) {
    const r = agree(await readMem(REQ[k], f => { f['people.json'] = text; }));
    assert.ok(r.code === 4 && has(r, 'people.json', 'malformed'), k + ' ' + text + ': ' + JSON.stringify(r.json.problems));
    if (k === 'runs') assert.strictEqual(r.json.data.runs.filter(x => x.key === 'release/run1')[0].recorder.name, null);
  }
});

rule('READ: a flag without its value is a JSON usage error when --json is given', async () => {
  const dir = await readFolder();
  for (const a of [['runs', dir, '--status', '--json'], ['runs', dir, '--json', '--process'], ['next', dir, 'release/run1', '--person', '--json']]) {
    const r = agree(readCli(...a));
    assert.ok(r.code === 1 && r.json.error.kind === 'usage', a.join(' ') + ': ' + r.out + r.err);
  }
});


/* ---------- READ second review: deferred blob failures and folders gone after their parent listed them ---------- */
/* The fixture plus a checklist with a screenshot and a run on it, so every command meets blobs too. */
let shotFiles = null;
async function withShots() {
  if (shotFiles) return shotFiles;
  await readFolder();
  const R = SRC.run, repo = SRC.repo, people = H.example('people.json');
  const mem = new SRC.fs.MemoryFS('shots2:' + Math.random(), null);
  mem.reset(rfBuilt.files);
  await mem.write('images/x/job.png', new Blob(['picture one'], { type: 'image/png' }));
  const md = '---\nprocess: shots\ntitle: Shots\n---\n## P · READ-DO {#p}\n- [ ] {confirm} Look {#a}\n  ![The job page](images/x/job.png)';
  const pub = await repo.publish(mem, md, { people: JSON.parse(people), ...H.exampleSetup(SRC), by: 'person-avery', changes: 'x', existing: [], now: RF.NOW });
  assert.ok(!pub.blockers, String(pub.blockers));
  const v = (await repo.loadAll(mem, { deep: true })).processes.filter(p => p.process === 'shots')[0].index.latest;
  const r = R.create(v, { title: 'Shots run', details: {}, roles: {}, by: 'person-casey', session: 'w1', now: RF.NOW, id: 's1' });
  await repo.saveRun(mem, r, 'w1');
  shotFiles = EV.bytesOf(mem);
  return shotFiles;
}
/* A folder in memory that fails one call (method at path) with EIO; blob's deferred arrayBuffer and text can fail too.
   seen collects every [method, path] made, deferred ones included. */
function failingFolder(files, method, at, seen) {
  const B = new EV.BytesFS(files, { strict: true });
  B.mtimes.forEach((v, k) => B.mtimes.set(k, RF.OLD.getTime()));
  const eio = () => Object.assign(new Error('EIO: i/o error, ' + method + ' \'' + at + '\''), { code: 'EIO' });
  const hit = (m, p) => { if (seen) seen.push([m, p]); return m === method && p === at; };
  const w = { calls: B.calls, mutations: B.mutations };
  ['list', 'read', 'stat'].forEach(m => { w[m] = (p, o) => hit(m, p) ? Promise.reject(eio()) : B[m](p, o); });
  w.blob = (p, o) => hit('blob', p) ? Promise.reject(eio()) : B.blob(p, o).then(b => b && {
    size: b.size, slice: (x, y) => b.slice(x, y),
    arrayBuffer: () => hit('arrayBuffer', p) ? Promise.reject(eio()) : b.arrayBuffer(),
    text: () => hit('text', p) ? Promise.reject(eio()) : b.text()
  });
  ['write', 'append', 'remove'].forEach(m => { w[m] = (...a) => B[m](...a); });
  return w;
}
const SHOT_REQ = [
  [{ cmd: 'processes' }, ['publications']],
  [{ cmd: 'process', proc: 'shots' }, ['publications/shots']],
  [{ cmd: 'process', proc: 'release' }, ['publications/release']],
  [{ cmd: 'runs' }, ['runs', 'proposals', 'people.json']],
  [{ cmd: 'run', key: 'shots/s1' }, null],
  [{ cmd: 'next', key: 'shots/s1' }, null],
  [{ cmd: 'run', key: 'release/run2' }, null],
  [{ cmd: 'followups' }, ['followups', 'runs', 'people.json']]
];

rule('READ: a failure injected at any call a command makes in its scope, deferred blob reads included, is named and the result isn\'t complete', async () => {
  const files = await withShots(), eng = { PF: SRC, version: 'test' }, covered = new Set();
  for (const [req, scope] of SHOT_REQ) {
    const seen = [], clean = await FD.readData(eng, failingFolder(files, null, null, seen), req);
    assert.strictEqual(clean.code, 0, req.cmd + ' clean: ' + JSON.stringify(clean.json.problems || clean.json.error));
    const inScope = p => !scope || scope.some(x => p === x || p.startsWith(x + '/'));
    const calls = [...new Set(seen.filter(([m, p]) => p && inScope(p)).map(x => x.join('\u0000')))].map(x => x.split('\u0000'));
    for (const [m, at] of calls) {
      const r = await FD.readData(eng, failingFolder(files, m, at), req), j = JSON.parse(JSON.stringify(r.json));
      const where = req.cmd + ' ' + (req.key || req.proc || '') + ': ' + m + ' ' + at + ' -> exit ' + r.code + ' ' + JSON.stringify(j.problems);
      assert.ok(j.error ? r.code === 1 || r.code === 5 : !j.complete && r.code === 4, where);
      assert.ok(j.problems.some(p => p.path === at), where);
      covered.add(m);
    }
  }
  ['list', 'read', 'stat', 'blob', 'arrayBuffer'].forEach(m => assert.ok(covered.has(m), 'covered ' + m + ': ' + [...covered]));
});

rule('READ: a folder listed by its parent and gone when listed itself is vanished, never empty: a decided follow-up never looks open', async () => {
  const dir = await readFolder(), eng = { PF: SRC, version: 'test' };
  for (const [gone, req] of [['followups/release', { cmd: 'followups' }], ['followups/release', { cmd: 'run', key: 'release/run2' }], ['runs/release/run2', { cmd: 'runs' }]]) {
    const copy = tmp(); fs.cpSync(dir, copy, { recursive: true });
    const A = FD.readAdapter(fs.realpathSync(copy)), list = A.list;
    let parentListed = false;
    A.list = p => { const up = gone.split('/').slice(0, -1).join('/'); if (p === up) parentListed = true; if (p === gone && parentListed) fs.rmSync(path.join(copy, ...gone.split('/')), { recursive: true }); return list(p); };
    const r = await FD.readData(eng, A, req), j = JSON.parse(JSON.stringify(r.json));
    assert.ok(r.code === 4 && j.problems.some(p => p.path === gone && p.kind === 'vanished'), gone + ' ' + req.cmd + ': ' + JSON.stringify(j.problems));
  }
});


rule('READ: a run.json with times that can\'t be read is partial and names them, while its data is shown as the app shows it', async () => {
  const at = 'runs/release/run1/run.json';
  const edit = (change) => f => { const o = JSON.parse(f[at]); change(o); f[at] = JSON.stringify(o, null, 2); };
  const cases = [
    ['the pause under way', o => { o.paused = { by: 'person-casey', at: 'not-a-time', reason: 'Lunch' }; }],
    ['the start', o => { o.created = 'yesterday'; }],
    ['an earlier pause', o => { o.pauses = [{ from: 'soon', to: RF.NOW, by: 'person-casey' }]; }],
    ['a log entry', o => { o.log.push({ at: 'whenever', by: 'person-casey', what: 'Something' }); }]
  ];
  for (const [what, change] of cases) for (const k of ['run', 'next', 'runs']) {
    const r = agree(await readMem(REQ[k], edit(change)));
    const p = r.json.problems.filter(x => x.path === at && x.kind === 'malformed')[0];
    assert.ok(r.code === 4 && p && p.why.includes(what), what + ' / ' + k + ': ' + JSON.stringify(r.json.problems));
    if (k === 'run') assert.strictEqual(r.json.data.run.key, 'release/run1', 'the run is still shown');
    if (k === 'runs') assert.ok(r.json.data.runs.some(x => x.key === 'release/run1'));
  }
  const p = agree(await readMem(REQ.run, edit(cases[0][1])));
  assert.strictEqual(p.json.data.run.paused, false, 'shown as the app shows it: the pause it couldn\'t read is dropped');
});


/* Each: the run (1 running, 2 ended), a change to its run.json as parsed, and the location READ must name. */
const DROPS = [
  [2, o => { delete o.gates.ready.s; }, 'gates.ready'],
  [2, o => { o.gates.ready.approved = { commit: 7 }; }, 'gates.ready.approved.commit'],
  [2, o => { o.gates.ready.at = 'later'; }, 'gates.ready.at'],
  [2, o => { o.followUps[0].text = 7; }, 'followUps[0]'],
  [2, o => { o.followUps[1].owner = { id: 'x' }; }, 'followUps[1].owner'],
  [1, o => { o.steps = 'bad'; }, 'steps'],
  [1, o => { o.gates = 'bad'; }, 'gates'],
  [1, o => { o.steps = ['x']; }, 'steps'],
  [2, o => { o.ended.by = 5; }, 'ended.by'],
  [1, o => { o.details.commit = 42; }, 'details.commit'],
  [1, o => { o.details = 'oops'; }, 'details'],
  [1, o => { o.roles.qa = ['person-morgan']; }, 'roles.qa'],
  [1, o => { o.recorder.person = 9; }, 'recorder.person'],
  [1, o => { o.pauses = [7]; }, 'pauses[0]'],
  [1, o => { o.lineage = (o.lineage || []).concat(['not a receipt']); }, 'lineage['],
  [1, o => { o.marks = { approved: 'blocked' }; }, 'marks.approved'],
  [1, o => { o.parent = { process: 'Bad Name', id: 'x' }; }, 'parent'],
  [1, o => { o.fields = { 'bad id!': { a: 'b' } }; }, 'fields.bad id!'],
  [1, o => { const k = Object.keys(o.steps)[0]; o.steps[k].values = { 'no spaces allowed': 'x' }; }, '.values.no spaces allowed'],
  [1, o => { const k = Object.keys(o.steps)[0]; delete o.steps[k].s; }, 'steps.'],
  [1, o => { const k = Object.keys(o.steps)[0]; o.steps[k].by = 3; }, '.by'],
  [1, o => { const k = Object.keys(o.steps)[0]; o.steps[k].history = [{ by: 'x' }]; }, '.history[0]'],
  [1, o => { const k = Object.keys(o.steps)[0]; o.steps[k].deadline = { at: 'soon' }; }, '.deadline'],
  [1, o => { o.log.push(7); }, 'log['],
  [1, o => { o.log.push({ at: RF.NOW, by: 'person-casey', what: 'x'.repeat(400) }); }, '.what'],
  [1, o => { o.title = 'T'.repeat(150); }, 'title'],
  [1, o => { o.version = 'one'; }, 'version'],
  [1, o => { o.types = 'none'; }, 'types'],
  [1, o => { o.shotsFrozen = 'yes'; }, 'shotsFrozen']
];
const NEWER_CAUGHT = ['gates.ready.approved.commit', 'details.commit', 'roles.qa'];
rule('READ: every record sanitize drops, cuts or replaces in any part of a run.json is named, and the result is partial', async () => {
  for (const [n, change, where] of DROPS) {
    const at = 'runs/release/run' + n + '/run.json';
    const edit = f => { const o = JSON.parse(f[at]); change(o); f[at] = JSON.stringify(o, null, 2); };
    for (const k of ['run', 'runs']) {
      const req = k === 'run' ? { cmd: 'run', key: 'release/run' + n } : REQ.runs;
      const r = agree(await readMem(req, edit)), p = r.json.problems.filter(x => x.path === at && (x.kind === 'malformed' || x.kind === 'newer'))[0];
      /* Text where text belongs and states this copy knows are newer()'s (the run is listed by name only); the rest is malformed. */
      assert.ok(r.code === 4 && p && (p.kind === 'newer' ? NEWER_CAUGHT.includes(where) : p.why.includes(where)), where + ' / ' + k + ': ' + JSON.stringify(r.json.problems));
    }
  }
});

rule('READ: a clean run.json written by this copy has nothing dropped or changed, through every step of a run', async () => {
  await readFolder();
  const R = SRC.run, r = R.sanitize(JSON.parse(rfBuilt.files['runs/release/run1/run.json'])), map = R.mapOf(r), done = H.sampleDone(SRC);
  for (let pi = 0; pi < map.phases.length; pi++) { map.phases[pi].steps.forEach(s => { if (!R.answered(r, s)) done(r, map, s.id, 'person-casey', RF.NOW); }); R.pass(r, map, pi, 'person-casey', RF.NOW); }
  R.end(r, map, 'Completed', 'person-casey', 'Casey Nguyen', RF.NOW);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(R.repairs(JSON.parse(JSON.stringify(r))))), []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(R.repairs(JSON.parse(rfBuilt.files['runs/release/run2/run.json'])))), []);
});

rule('READ: a run.json copied into another run\'s folder is named as belonging elsewhere, and never joined with that folder\'s decisions', async () => {
  const edit = f => { f['runs/release/run1/run.json'] = f['runs/release/run2/run.json']; f['followups/release/run1.fu1.w2.1.json'] = f['followups/release/run2.fu1.w2.1.json'].replace('"run": "run2"', '"run": "run1"'); };
  const at = 'runs/release/run1/run.json';
  for (const k of ['run', 'next']) {
    const r = agree(await readMem(REQ[k], edit));
    assert.ok(r.code === 4 && r.json.problems.some(p => p.path === at && p.kind === 'malformed' && /belongs to release\/run2/.test(p.why)), k + ': ' + JSON.stringify(r.json.problems));
    assert.ok(!/"key": "release\/run2"|release\/run2\/fu1/.test(JSON.stringify(r.json.data)) && !r.json.data.run || k === 'next', k + ': ' + JSON.stringify(r.json.data).slice(0, 200));
    if (k === 'next') assert.strictEqual(r.json.data.next, null);
  }
  const all = agree(await readMem(REQ.runs, edit));
  assert.ok(all.code === 4 && all.json.problems.some(p => p.path === at && /belongs to release\/run2/.test(p.why)));
  assert.deepStrictEqual(all.json.data.runs.map(x => x.key).sort(), ['release/run2']);
});


rule('READ: a pause left on a run that has ended is history, not a problem (sanitize drops it by design, and DRIFT_ALLOW says so)', async () => {
  const at = 'runs/release/run2/run.json';
  const r = agree(await readMem({ cmd: 'run', key: 'release/run2' }, f => { const o = JSON.parse(f[at]); o.paused = { by: 'person-casey', at: RF.NOW, reason: 'Lunch' }; f[at] = JSON.stringify(o, null, 2); }));
  assert.ok(r.code === 0 && r.json.complete, JSON.stringify(r.json.problems));
});

/* The fuzz oracle, written apart from U.drift: every value the file states must come back from sanitize the same, and
   anything sanitize states where the file is silent must be a documented default (R.DRIFT_ALLOW). */
/* sanitize's documented defaults and deliberate drops, as this test knows them; a rule below checks R.DRIFT_ALLOW says the same. */
const DOCUMENTED_DEFAULTS = {
  added: ['title', 'state', 'version', 'rev', 'shotsFrozen', 'paused.reason', 'recorder.handoff.rev'],
  dropped: ['steps.*.history[*].differently.by', 'steps.*.history[*].differently.at', 'paused']
};
function oracleChanged(raw) {
  const r = SRC.run.sanitize(raw);
  if (!r) return true;
  const c = JSON.parse(JSON.stringify(r)), allow = DOCUMENTED_DEFAULTS;
  const pat = l => l.map(x => new RegExp('^' + x.replace(/[.[\]]/g, m => '\\' + m).replace(/\\\[\*\\\]/g, '\\[\\d+\\]').replace(/\*/g, '[^.\\[]+') + '$'));
  const add = pat(allow.added), drop = pat(allow.dropped), empty = v => v === undefined || v === null || v === '';
  const hollow = v => empty(v) || (typeof v === 'object' && Object.keys(v).filter(k => k[0] !== '_').length === 0);
  let changed = false;
  (function walk(a, b, p) {
    if (changed) return;
    if (empty(a)) { if (!hollow(b) && !add.some(x => x.test(p))) changed = true; return; }
    if (b === undefined || b === null) { if (!drop.some(x => x.test(p))) changed = true; return; }
    if (typeof a !== 'object' || a === null) { if (a !== b) changed = true; return; }
    if (Array.isArray(a) !== Array.isArray(b) || typeof b !== 'object') { changed = true; return; }
    const keys = new Set(Object.keys(a).concat(Object.keys(b).filter(k => k[0] !== '_')));
    for (const k of keys) walk(a[k], b[k], Array.isArray(a) ? p + '[' + k + ']' : p ? p + '.' + k : k);
  })(raw, c, '');
  return changed;
}
rule('READ: sanitize\'s allowlist of defaults and drops is the documented one', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(SRC.run.DRIFT_ALLOW || null)), DOCUMENTED_DEFAULTS);
});
rule('READ fuzz: a random change to any field of a valid run.json that sanitize doesn\'t keep as written is always reported', async () => {
  await readFolder();
  let seed = 1817;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const VALS = [undefined, null, '', 7, -1, 1.5, true, 'x'.repeat(400), {}, [], 'not-a-time', { toString: {} }, ['a'], { a: 1 }];
  let reported = 0, tried = 0;
  for (const n of [1, 2]) {
    const at = 'runs/release/run' + n + '/run.json', base = JSON.parse(rfBuilt.files[at]), paths = [];
    (function collect(v, p, depth) {
      if (p) paths.push(p);
      if (v && typeof v === 'object' && depth < (p[0] === 'types' ? 2 : 6)) for (const k of Object.keys(v)) collect(v[k], p.concat([k]), depth + 1);
    })(base, [], 0);
    for (const p of paths) for (let t = 0; t < 2; t++) {
      if (p[0] === 'snapshot') continue;
      const raw = JSON.parse(JSON.stringify(base)), val = VALS[rnd(VALS.length)];
      let o = raw; for (const k of p.slice(0, -1)) o = o[k];
      if (val === undefined) delete o[p[p.length - 1]]; else o[p[p.length - 1]] = JSON.parse(JSON.stringify(val));
      if (!oracleChanged(raw)) continue;
      tried++;
      const r = await readMem({ cmd: 'run', key: 'release/run' + n }, f => { f[at] = JSON.stringify(raw, null, 2); });
      const ok = r.code === 4 && r.json.problems.some(x => x.path === at && (x.kind === 'malformed' || x.kind === 'newer'));
      assert.ok(ok, p.join('.') + ' = ' + JSON.stringify(val) + ': exit ' + r.code + ' ' + JSON.stringify(r.json.problems));
      reported++;
    }
  }
  assert.ok(tried > 100, 'mutations that sanitize changed: ' + tried);
});

rule('READ: a follow-up decision that isn\'t read as written (a note cut short, a link dropped) is named by file and field', async () => {
  const at = 'followups/release/run2.fu1.w2.1.json';
  const cases = [[o => { o.note = 'n'.repeat(316); }, 'note'], [o => { o.link = 'javascript:alert(1)'; }, 'link'], [o => { o.seen = 'not a file'; }, 'seen']];
  for (const [change, field] of cases) for (const req of [{ cmd: 'run', key: 'release/run2' }, REQ.followups]) {
    const r = agree(await readMem(req, f => { const o = JSON.parse(f[at]); change(o); f[at] = JSON.stringify(o, null, 2); }));
    assert.ok(r.code === 4 && r.json.problems.some(p => p.path === at && p.kind === 'malformed' && p.why.includes(field)), field + ' ' + req.cmd + ': ' + JSON.stringify(r.json.problems));
  }
});


rule('READ: a plan\'s version must be a version number; one the folder doesn\'t have is flagged, as the app falls back to the latest', async () => {
  const at = 'proposals/plan-release-2026-10-24.json', edit = v => f => { const o = JSON.parse(f[at]); o.version = v; f[at] = JSON.stringify(o, null, 2); };
  for (const v of ['v3', 1.5, -1, '1.0', true]) {
    const r = agree(await readMem(REQ.runs, edit(v)));
    assert.ok(r.code === 4 && has(r, at, 'malformed') && !r.json.data.planned.length, JSON.stringify(v) + ': ' + JSON.stringify(r.json.problems));
  }
  for (const [v, missing] of [[1, false], ['1', false], [null, false], [9, true]]) {
    const r = agree(await readMem(REQ.runs, edit(v)));
    const p = r.json.data.planned[0];
    assert.ok(r.code === 0 && p, JSON.stringify(v) + ': ' + JSON.stringify(r.json.problems));
    assert.strictEqual(p.versionMissing, missing, JSON.stringify(v));
    assert.deepStrictEqual(p.startsOn, { version: 1, folder: rfBuilt.folder }, 'the version a person starting it gets, as the app picks it');
  }
});

rule('READ: a step\'s marks come from its durable marks and the answers it still holds, and the run says whether that record is complete', async () => {
  const at = 'runs/release/run1/run.json';
  const old = f => { const o = JSON.parse(f[at]); delete o.marks; delete o.marksFrom; o.steps.approved.history = [{ s: 'blocked', by: 'person-casey', at: RF.NOW, reason: 'Waiting' }]; f[at] = JSON.stringify(o, null, 2); };
  const r = agree(await readMem(REQ.run, old));
  assert.strictEqual(r.code, 0, JSON.stringify(r.json.problems));
  const run = r.json.data.run, step = run.steps.filter(s => s.id === 'approved')[0];
  assert.deepStrictEqual(step.marks, ['blocked'], 'the block Insights counts');
  assert.strictEqual(run.marksComplete, false, 'an older run: "no marks" means unknown, not none');
  const now = agree(await readMem(REQ.run)).json.data.run;
  assert.strictEqual(now.marksComplete, true, 'a run that kept marks from its start');
  assert.strictEqual(agree(await readMem(REQ.runs, old)).json.data.runs.filter(x => x.key === 'release/run1')[0].marksComplete, false);
});


/* The guard: a command's output depends on everything it reads, so a failure at ANY call it makes (every path the
   folder saw, root listing and deferred blob reads included) must make it partial or an error naming that path. */
const GUARD_REQ = [
  { cmd: 'processes' }, { cmd: 'process', proc: 'shots' }, { cmd: 'process', proc: 'release' }, { cmd: 'runs' }, { cmd: 'runs', proc: 'release' },
  { cmd: 'runs', status: 'planned' }, { cmd: 'run', key: 'shots/s1' }, { cmd: 'next', key: 'release/run1', person: 'person-blake' }, { cmd: 'run', key: 'release/run2' },
  { cmd: 'followups' }, { cmd: 'followups', proc: 'release' }
];
rule('READ guard: a failure at any call a command makes, wherever it is, is named and the result isn\'t complete', async () => {
  const files = await withShots(), eng = { PF: SRC, version: 'test' }, covered = new Set();
  for (const req of GUARD_REQ) {
    const seen = [], clean = await FD.readData(eng, failingFolder(files, null, null, seen), req);
    assert.strictEqual(clean.code, 0, req.cmd + ' clean: ' + JSON.stringify(clean.json.problems || clean.json.error));
    const calls = [...new Set(seen.map(x => x.join('\u0000')))].map(x => x.split('\u0000'));
    for (const [m, at] of calls) {
      const r = await FD.readData(eng, failingFolder(files, m, at), req), j = JSON.parse(JSON.stringify(r.json));
      const where = JSON.stringify(req) + ': ' + m + ' "' + at + '" -> exit ' + r.code + ' ' + JSON.stringify(j.problems);
      assert.ok(j.error ? r.code === 1 || r.code === 5 : !j.complete && r.code === 4, where);
      assert.ok(j.problems.some(p => p.path === at), where);
      covered.add(m);
    }
  }
  ['list', 'read', 'stat', 'blob', 'arrayBuffer'].forEach(m => assert.ok(covered.has(m), 'covered ' + m + ': ' + [...covered]));
});

rule('READ: a plan whose version couldn\'t be checked says unknown (null), never missing', async () => {
  const pubRec = 'publications/release/' + rfBuilt.folder + '/publication.json';
  for (const hooks of [{ read: p => { if (p === pubRec) throw eacces(p); } }, { list: p => { if (p === 'publications/release') throw eacces(p); } }]) {
    const r = agree(await readMem(REQ.runs, null, hooks)), p = r.json.data.planned[0];
    assert.ok(r.code === 4 && r.json.problems.length, JSON.stringify(r.json.problems));
    assert.ok(p && p.startsOn === null && p.versionMissing === null, JSON.stringify(p));
  }
});


/* One run's view in each command: the problems at its own files and its version's folder, and its read-only reason. */
function oneRunView(r, key, folder) {
  const proc = key.split('/')[0], mine = p => p.path.startsWith('runs/' + key + '/') || p.path.startsWith('publications/' + proc + '/' + folder + '/');
  const probs = r.json.problems.filter(mine).map(p => p.path + ' ' + p.kind).sort();
  const data = r.json.data.run !== undefined ? r.json.data.run : (r.json.data.runs || []).filter(x => x.key === key)[0] || null;
  return { probs, shown: !!data, readOnly: data ? data.readOnly : null };
}
rule('READ: runs and run say the same about every run: its problems, whether it shows and why it\'s read-only', async () => {
  await readFolder();
  const pubInfo = 'publications/release/' + rfBuilt.folder + '/publication.json';
  const runEdit = (n, change) => f => { const at = 'runs/release/run' + n + '/run.json', o = JSON.parse(f[at]); change(o); f[at] = JSON.stringify(o, null, 2); };
  const cases = [
    ['as written', 1, null],
    ['another checklist hash', 1, runEdit(1, o => { o.mapHash = 'deadbeef'; })],
    ['another version number', 2, runEdit(2, o => { o.version = 5; })],
    ['a version folder that isn\'t there', 1, runEdit(1, o => { o.folder = 'v7-zzzz7777'; })],
    ['its version from a newer Flightdeck', 1, f => { const o = JSON.parse(f[pubInfo]); o.format = 'preflight-publication/9'; f[pubInfo] = JSON.stringify(o); }],
    ['its version unusable here', 1, f => { const at = 'publications/release/' + rfBuilt.folder + '/map.md'; f[at] = f[at].replace('{confirm} Feature flags', '{no.such} Feature flags'); const o = JSON.parse(f[pubInfo]); o.mapHash = SRC.util.hash(f[at]); f[pubInfo] = JSON.stringify(o); }],
    ['newer frozen types', 1, runEdit(1, o => { const t = Object.keys(o.types)[0]; o.types[t].fromTheFuture = true; })],
    ['a conflict copy', 1, f => { f['runs/release/run1/run-LAPTOP.json'] = f['runs/release/run1/run.json'].replace('Release 2026.10.20', 'Copy'); }],
    ['a bad pause', 1, runEdit(1, o => { o.paused = { at: 'not-a-time' }; })]
  ].concat(DROPS.map(([n, change, where]) => ['drop ' + where, n, runEdit(n, change)]));
  for (const [name, n, edit] of cases) {
    const key = 'release/run' + n;
    const one = await readMem({ cmd: 'run', key }, edit), all = await readMem(REQ.runs, edit);
    const folder = (() => { const f = Object.assign({}, rfBuilt.files); if (edit) edit(f, rfBuilt); try { return JSON.parse(f['runs/' + key + '/run.json']).folder; } catch (e) { return rfBuilt.folder; } })();
    assert.deepStrictEqual(oneRunView(all, key, folder), oneRunView(one, key, folder), name);
  }
});


rule('READ: a run that doesn\'t match its version is named at its own run.json, and never makes a plan\'s version unknown', async () => {
  const at = 'runs/release/run1/run.json', edit = f => { const o = JSON.parse(f[at]); o.mapHash = 'deadbeef'; f[at] = JSON.stringify(o, null, 2); };
  for (const req of [REQ.runs, REQ.run]) {
    const r = agree(await readMem(req, edit));
    assert.ok(r.code === 4 && r.json.problems.some(p => p.path === at && p.kind === 'unusable' && p.why.includes(rfBuilt.folder)), JSON.stringify(r.json.problems));
    assert.ok(!r.json.problems.some(p => p.path.startsWith('publications/')), 'the version itself is fine: ' + JSON.stringify(r.json.problems));
  }
  const p = agree(await readMem(REQ.runs, edit)).json.data.planned[0];
  assert.deepStrictEqual([p.startsOn, p.versionMissing], [{ version: 1, folder: rfBuilt.folder }, false]);
  const bad = agree(await readMem(REQ.runs, edit, { read: x => { if (x === 'publications/release/' + rfBuilt.folder + '/publication.json') throw eacces(x); } })).json.data.planned[0];
  assert.deepStrictEqual([bad.startsOn, bad.versionMissing], [null, null], 'a real failure of the version does');
});


/* The inverse guard: what a command doesn't depend on never makes it partial, whether it's a link found while listing
   or a broken file. Each: the request, then paths it doesn't depend on. */
const UNRELATED = [
  [{ cmd: 'processes' }, ['runs/release', 'proposals/plan-x.json', 'followups/release', 'people.json']],
  [{ cmd: 'process', proc: 'release' }, ['publications/shots', 'publications/other-process', 'runs/release', 'people.json']],
  [{ cmd: 'runs' }, ['followups/release', 'step-types/x.json']],
  [{ cmd: 'runs', proc: 'release' }, ['runs/shots', 'publications/shots', 'followups/release']],
  [{ cmd: 'run', key: 'shots/s1' }, ['runs/release', 'runs/shots/s9', 'publications/release', 'followups/release/run2.fu9.w1.1.json', 'proposals/plan-x.json']],
  [{ cmd: 'next', key: 'release/run1' }, ['runs/release/run2', 'publications/shots', 'followups/shots', 'followups/release/run2.fu9.w1.1.json']],
  [{ cmd: 'followups' }, ['publications/release', 'proposals/plan-x.json']],
  [{ cmd: 'followups', proc: 'release' }, ['runs/shots', 'followups/shots']]
];
rule('READ inverse guard: a link or a broken file on a path a command doesn\'t depend on never makes it partial', async () => {
  const files = await withShots(), eng = { PF: SRC, version: 'test' };
  for (const [req, paths] of UNRELATED) for (const at of paths) {
    const linked = failingFolder(files, null, null); linked.links = [at];
    let r = await FD.readData(eng, linked, req);
    assert.ok(r.code === 0 && r.json.complete, JSON.stringify(req) + ' link ' + at + ': ' + JSON.stringify(r.json.problems || r.json.error));
    if (/\.json$/.test(at) || at.split('/').length >= 2) {
      const f = Object.assign({}, files, { [/\.json$/.test(at) ? at : at + '/zz/run.json']: '{' });
      r = await FD.readData(eng, failingFolder(f, null, null), req);
      assert.ok(r.code === 0 && r.json.complete, JSON.stringify(req) + ' broken file under ' + at + ': ' + JSON.stringify(r.json.problems || r.json.error));
    }
  }
});

rule('READ: a link beside the process a command reads, on disk, isn\'t its problem; a link it reads through is', async () => {
  const dir = await readFolder(null, d => { const o = tmp(); fs.mkdirSync(path.join(o, 'v1-bbbb2222')); fs.symlinkSync(o, path.join(d, 'publications', 'other-process')); });
  let r = agree(readCli('process', dir, 'release', '--json'));
  assert.ok(r.code === 0 && r.json.complete, r.out);
  r = agree(readCli('processes', dir, '--json'));
  assert.ok(r.code === 4 && r.json.problems.some(p => p.path === 'publications/other-process' && p.kind === 'link'), r.out);
});

/* ---------- 1.19 slice 1: flightdeck draft read | save | propose (contract flightdeck-draft/1) ---------- */
const DPP = SRC.proposals, dsha = t => require('crypto').createHash('sha256').update(t, 'utf8').digest('hex');
const DRAFT_MD = fs.readFileSync(path.join(__dirname, '..', 'example-folder', 'maps', 'drafts', 'release.md'), 'utf8');
const DPEOPLE = fs.readFileSync(path.join(__dirname, '..', 'example-folder', 'people.json'), 'utf8');
function draftFolder(withDraft) {
  const dir = fs.realpathSync(tmp());
  fs.writeFileSync(path.join(dir, 'people.json'), DPEOPLE);
  if (withDraft !== false) { fs.mkdirSync(path.join(dir, 'maps', 'drafts'), { recursive: true }); fs.writeFileSync(path.join(dir, 'maps', 'drafts', 'release.md'), DRAFT_MD); }
  return dir;
}
function draftCli(...a) {
  const r = cp().spawnSync(process.execPath, [BIN, 'draft', ...a], { encoding: 'utf8', maxBuffer: 64 * 1048576 });
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* the caller says what it expected */ }
  return { code: r.status, json, out: r.stdout + r.stderr };
}
const inFile = (dir, text, name) => { const f = path.join(tmp(), name || 'in.md'); fs.writeFileSync(f, text); return f; };
const edited = (t, title) => t.replace('title: Production release', 'title: ' + title);
const presence = (dir, rec, name) => { fs.mkdirSync(path.join(dir, 'presence'), { recursive: true }); fs.writeFileSync(path.join(dir, 'presence', name || rec.writer + '.json'), typeof rec === 'string' ? rec : JSON.stringify(rec)); };
const live = (at, drafts) => DPP.presence({ writer: 'w8d2k4', by: 'person-casey', device: 'Windows · Edge', since: at, at, beat: 3, drafts: drafts || ['release'], main: [] });
const proposedFiles = dir => { try { return fs.readdirSync(path.join(dir, 'proposed', 'release')).sort(); } catch (e) { return []; } };
const failsWith = (r, kind) => { assert.ok(r.json && r.json.error && r.json.error.kind === kind && r.json.contract === 'flightdeck-draft/1' && typeof r.json.app === 'string', r.out); assert.strictEqual(r.code, 1, r.out); };

rule('draft read --json: the draft, its exact rev and text, who has it open, and the text to continue from', () => {
  const dir = draftFolder();
  const r = draftCli('read', dir, 'release', '--json');
  assert.strictEqual(r.code, 0, r.out);
  const j = r.json;
  assert.strictEqual(j.contract, 'flightdeck-draft/1');
  assert.ok(/^s-[a-z0-9]{12}$/.test(j.session), 'a new session when none is given: ' + j.session);
  assert.deepStrictEqual([j.draft.exists, j.draft.path, j.draft.rev, j.draft.text], [true, 'maps/drafts/release.md', dsha(DRAFT_MD), DRAFT_MD]);
  assert.deepStrictEqual(j.openIn, []); assert.deepStrictEqual(j.mine, []);
  assert.deepStrictEqual([j.continueFrom.kind, j.continueFrom.rev, j.continueFrom.text], ['draft', dsha(DRAFT_MD), DRAFT_MD]);
  assert.ok(Array.isArray(j.checks.blockers) && Array.isArray(j.copies) && j.readAt && j.complete === true && Array.isArray(j.problems));
  presence(dir, live(new Date().toISOString()));
  const o = draftCli('read', dir, 'release', '--session', 's-k3m9p2q8x7w1', '--json').json;
  assert.strictEqual(o.session, 's-k3m9p2q8x7w1');
  assert.strictEqual(o.openIn.length, 1);
  assert.deepStrictEqual([o.openIn[0].by, o.openIn[0].device], ['person-casey', 'Windows · Edge']);
  assert.ok(o.openIn[0].seenAgo >= 0);
  // Nothing at all: exit 5.
  const none = draftCli('read', dir, 'nothing-here', '--json');
  assert.strictEqual(none.code, 5, none.out); assert.strictEqual(none.json.error.kind, 'not-found');
  // Usage problems exit 1 with the failure shape.
  failsWith(draftCli('read', dir, 'Bad Name', '--json'), 'usage');
});

rule('draft read --or-latest with no draft continues from the published version; a proposal-only process is found too', async () => {
  const dir = await readFolder(f => { delete f['maps/drafts/release.md']; });
  const j = draftCli('read', dir, 'release', '--or-latest', '--json').json;
  assert.strictEqual(j.draft.exists, false);
  assert.strictEqual(j.continueFrom.kind, 'version');
  assert.ok(/^v1-/.test(j.continueFrom.ref) && j.continueFrom.text.indexOf('process: release') >= 0);
  assert.strictEqual(draftCli('read', dir, 'release', '--json').json.continueFrom.kind, 'none', 'without --or-latest: start from nothing');
});

rule('draft save writes the draft directly when nobody has it open and it is exactly what was read, and adds its own history line', () => {
  const dir = draftFolder(), text = edited(DRAFT_MD, 'Direct');
  const r = draftCli('save', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, text), '--by', 'person-avery', '--note', 'Retitled', '--json');
  assert.strictEqual(r.code, 0, r.out);
  const j = r.json;
  assert.deepStrictEqual([j.outcome, j.why, j.link, j.rev, j.file], ['written', null, null, dsha(text), 'maps/drafts/release.md']);
  assert.ok(/^p-[a-z0-9]+-[a-z0-9]{10}$/.test(j.operation));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'maps', 'drafts', 'release.md'), 'utf8'), text);
  const hist = path.join(dir, 'history', 'drafts', 'release', 'agent-' + j.operation + '.jsonl'), lines = fs.readFileSync(hist, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const e = SRC.timeline.cleanEntry(JSON.parse(lines[0]), path.basename(hist));
  assert.ok(e, 'the line is one the app reads');
  assert.deepStrictEqual([e.source, e.seq, e.from, e.to, e.seen, e.writer], ['agent', 1, SRC.util.hash(DRAFT_MD), SRC.util.hash(text), null, j.operation]);
  assert.ok(j.history.written === true);
  assert.ok(!fs.existsSync(path.join(dir, 'presence')), 'an assistant never writes presence/');
  assert.deepStrictEqual(proposedFiles(dir), [], 'no proposal');
});

rule('draft save writes a proposal when the draft is open in an editor this computer can see: fresh, a clock ahead, malformed, or presence that can\'t be listed', () => {
  const now = Date.now(), cases = [
    ['fresh', d => presence(d, live(new Date(now - 5000).toISOString()))],
    ['ahead by 9 minutes', d => presence(d, live(new Date(now + 9 * 60000).toISOString()))],
    ['malformed', d => presence(d, '{"kind":"presence"', 'w1.json')],
    ['presence/ can\'t be listed', d => fs.writeFileSync(path.join(d, 'presence'), 'not a folder')]
  ];
  cases.forEach(([what, setUp]) => {
    const dir = draftFolder(); setUp(dir);
    const text = edited(DRAFT_MD, 'Proposed');
    const r = draftCli('save', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, text), '--json');
    assert.strictEqual(r.code, 0, what + ': ' + r.out);
    assert.deepStrictEqual([r.json.outcome, r.json.why], ['proposed', 'open'], what);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'maps', 'drafts', 'release.md'), 'utf8'), DRAFT_MD, what + ': the draft is untouched');
    const files = proposedFiles(dir);
    assert.deepStrictEqual(files, [r.json.operation + '.json'], what);
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'proposed', 'release', files[0]), 'utf8'));
    assert.ok(DPP.check(p, files[0], 'release', 100).ok, what + ': a valid proposal');
    assert.deepStrictEqual([p.base.kind, p.base.rev, p.base.text, p.rev], ['draft', dsha(DRAFT_MD), DRAFT_MD, dsha(text)]);
  });
  // Stale presence (over 60 s old) lets it write directly.
  const dir = draftFolder(); presence(dir, live(new Date(now - 120000).toISOString()));
  assert.strictEqual(draftCli('save', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, edited(DRAFT_MD, 'X')), '--json').json.outcome, 'written');
  // A presence for another process doesn't count.
  const d2 = draftFolder(); presence(d2, live(new Date(now).toISOString(), ['incident']));
  assert.strictEqual(draftCli('save', d2, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(d2, edited(DRAFT_MD, 'Y')), '--json').json.outcome, 'written');
  // propose always proposes.
  const d3 = draftFolder();
  const pr = draftCli('propose', d3, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(d3, edited(DRAFT_MD, 'Z')), '--json');
  assert.deepStrictEqual([pr.json.outcome, pr.json.why], ['proposed', 'asked']);
});

rule('draft save over a draft that changed since it was read: a proposal with the base it read (--base), or missing-base without one', () => {
  const dir = draftFolder(), mine = edited(DRAFT_MD, 'Mine'), theirs = edited(DRAFT_MD, 'Theirs');
  fs.writeFileSync(path.join(dir, 'maps', 'drafts', 'release.md'), theirs);
  const miss = draftCli('save', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, mine), '--json');
  failsWith(miss, 'missing-base');
  assert.ok(/--base/.test(miss.json.error.why));
  assert.deepStrictEqual(proposedFiles(dir), []);
  const wrongBase = draftCli('save', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, mine), '--base', inFile(dir, 'not it', 'b.md'), '--json');
  failsWith(wrongBase, 'missing-base');
  const r = draftCli('save', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, mine), '--base', inFile(dir, DRAFT_MD, 'base.md'), '--json');
  assert.deepStrictEqual([r.code, r.json.outcome, r.json.why], [0, 'proposed', 'changed']);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'maps', 'drafts', 'release.md'), 'utf8'), theirs, 'theirs is kept');
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'proposed', 'release', r.json.operation + '.json'), 'utf8'));
  assert.deepStrictEqual([p.base.rev, p.base.text], [dsha(DRAFT_MD), DRAFT_MD]);
  // --expect none: a new draft, from nothing.
  const fresh = draftFolder(false), md = DRAFT_MD.replace('process: release', 'process: onboard');
  const n = draftCli('save', fresh, 'onboard', '--expect', 'none', '--from', inFile(fresh, md), '--json');
  assert.deepStrictEqual([n.code, n.json.outcome], [0, 'written'], n.out);
  assert.strictEqual(fs.readFileSync(path.join(fresh, 'maps', 'drafts', 'onboard.md'), 'utf8'), md);
});

rule('Replace by default, depend with --after-earlier: continuing from this session\'s own pending proposal', () => {
  const dir = draftFolder(), S = 's-k3m9p2q8x7w1', B = edited(DRAFT_MD, 'B'), C = edited(DRAFT_MD, 'C'), D = edited(DRAFT_MD, 'D');
  presence(dir, live(new Date().toISOString()));
  const p1 = draftCli('save', dir, 'release', '--session', S, '--expect', dsha(DRAFT_MD), '--from', inFile(dir, B), '--json').json;
  assert.strictEqual(p1.link, null);
  const read = draftCli('read', dir, 'release', '--session', S, '--json').json;
  assert.deepStrictEqual(read.mine.map(m => [m.id, m.status]), [[p1.operation, 'pending']]);
  assert.deepStrictEqual([read.continueFrom.kind, read.continueFrom.ref, read.continueFrom.rev, read.continueFrom.text], ['proposal', p1.operation, dsha(B), B]);
  const p2 = draftCli('save', dir, 'release', '--session', S, '--expect', dsha(B), '--from', inFile(dir, C), '--json').json;
  assert.strictEqual(p2.link, 'replaces');
  const f2 = JSON.parse(fs.readFileSync(path.join(dir, 'proposed', 'release', p2.operation + '.json'), 'utf8'));
  assert.deepStrictEqual([f2.replaces, f2.after, f2.base.kind, f2.base.rev, f2.base.text], [p1.operation, null, 'draft', dsha(DRAFT_MD), DRAFT_MD], 'P1\'s own base: a fast-forward from the draft');
  const p3 = draftCli('save', dir, 'release', '--session', S, '--expect', dsha(C), '--from', inFile(dir, D), '--after-earlier', '--json').json;
  assert.strictEqual(p3.link, 'after');
  const f3 = JSON.parse(fs.readFileSync(path.join(dir, 'proposed', 'release', p3.operation + '.json'), 'utf8'));
  assert.deepStrictEqual([f3.after, f3.replaces, f3.base.kind, f3.base.ref, f3.base.text], [p2.operation, null, 'proposal', p2.operation, C]);
  // P1 is no longer pending (replaced): continuing from it links nothing.
  const p4 = draftCli('save', dir, 'release', '--session', S, '--expect', dsha(B), '--from', inFile(dir, D), '--json').json;
  assert.strictEqual(p4.link, null);
  // Another session's proposal is never continued.
  const other = draftCli('read', dir, 'release', '--session', 's-other0000000', '--json').json;
  assert.deepStrictEqual([other.mine, other.continueFrom.kind], [[], 'draft']);
});

rule('The input is checked before anything is written: size in UTF-8 bytes, valid UTF-8, its process: line, --by, --label and --note', () => {
  const dir = draftFolder(), head = '---\nprocess: release\ntitle: T\n---\n', pad = n => head + 'x'.repeat(n - Buffer.byteLength(head) - 3) + '€';
  const at = pad(1048576), over = pad(1048577);
  assert.strictEqual(Buffer.byteLength(at), 1048576);
  const okR = draftCli('propose', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, at), '--json');
  assert.strictEqual(okR.code, 0, okR.out.slice(0, 300));
  failsWith(draftCli('propose', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, over), '--json'), 'usage');
  const bad = path.join(tmp(), 'bad.md'); fs.writeFileSync(bad, Buffer.concat([Buffer.from(head), Buffer.from([0xff, 0xfe])]));
  failsWith(draftCli('propose', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', bad, '--json'), 'usage');
  failsWith(draftCli('propose', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, DRAFT_MD.replace('process: release', 'process: incident')), '--json'), 'usage');
  failsWith(draftCli('propose', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, DRAFT_MD), '--by', 'person-nobody', '--json'), 'usage');
  failsWith(draftCli('propose', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, DRAFT_MD), '--label', 'Not OK!', '--json'), 'usage');
  failsWith(draftCli('propose', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, DRAFT_MD), '--note', 'x'.repeat(201), '--json'), 'usage');
  failsWith(draftCli('propose', dir, 'release', '--expect', 'nothex', '--from', inFile(dir, DRAFT_MD), '--json'), 'usage');
  assert.deepStrictEqual(proposedFiles(dir).length, 1, 'only the one that passed');
});

rule('A proposal over 4 MB once serialized is refused before anything is written', () => {
  const dir = draftFolder(), head = '---\nprocess: release\ntitle: T\n---\n';
  // Control characters take six bytes each in JSON: under 1 MB as text, over 4 MB as a file with its base.
  const text = head + '\u0001'.repeat(700000);
  assert.ok(Buffer.byteLength(text) < 1048576);
  const r = draftCli('propose', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, text), '--json');
  failsWith(r, 'too-big');
  assert.deepStrictEqual(proposedFiles(dir), []);
});

rule('The command never writes through a link or outside the folder', () => {
  const dir = draftFolder(), outside = fs.realpathSync(tmp());
  fs.symlinkSync(outside, path.join(dir, 'proposed'));
  const r = draftCli('propose', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, edited(DRAFT_MD, 'L')), '--json');
  failsWith(r, 'failed');
  assert.ok(/link/.test(r.json.error.why));
  assert.deepStrictEqual(fs.readdirSync(outside), [], 'nothing outside');
  const d2 = draftFolder(), out2 = fs.realpathSync(tmp());
  fs.mkdirSync(path.join(d2, 'history'));
  fs.symlinkSync(out2, path.join(d2, 'history', 'drafts'));
  const w = draftCli('save', d2, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(d2, edited(DRAFT_MD, 'H')), '--json');
  assert.ok(w.code === 0 && w.json.outcome === 'written' && w.json.history.written === false && /link/.test(w.json.history.why), w.out);
  assert.deepStrictEqual(fs.readdirSync(out2), [], 'no history line outside');
});

rule('A write that lands before the command\'s final compare turns its save into a proposal; one that lands after it is replaced, the documented limit', async () => {
  const dir = draftFolder(), draftPath = path.join(dir, 'maps', 'drafts', 'release.md');
  FD._hooks.beforeCompare = () => { fs.writeFileSync(draftPath, edited(DRAFT_MD, 'Hand edit')); };
  let r;
  try { r = await FD.main(['draft', 'save', dir, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(dir, edited(DRAFT_MD, 'Mine')), '--base', inFile(dir, DRAFT_MD, 'b.md'), '--json']); }
  finally { delete FD._hooks.beforeCompare; }
  let j = JSON.parse(r.out);
  assert.deepStrictEqual([j.outcome, j.why], ['proposed', 'changed']);
  assert.ok(/Hand edit/.test(fs.readFileSync(draftPath, 'utf8')), 'the hand edit is kept');
  assert.ok(fs.existsSync(path.join(dir, 'proposed', 'release', j.operation + '.json')), 'the change is in a proposal, not lost');
  const d2 = draftFolder(), p2 = path.join(d2, 'maps', 'drafts', 'release.md');
  FD._hooks.afterCompare = () => { fs.writeFileSync(p2, edited(DRAFT_MD, 'Late hand edit')); };
  try { r = await FD.main(['draft', 'save', d2, 'release', '--expect', dsha(DRAFT_MD), '--from', inFile(d2, edited(DRAFT_MD, 'Mine')), '--json']); }
  finally { delete FD._hooks.afterCompare; }
  j = JSON.parse(r.out);
  assert.strictEqual(j.outcome, 'written');
  assert.ok(/title: Mine/.test(fs.readFileSync(p2, 'utf8')), 'the late hand edit was replaced: the known limit, unchanged from 1.18');
});

rule('Two overlapping invocations of one session write separate files and never share a history file; a session copied to two computers does too', async () => {
  const dir = draftFolder(), S = 's-k3m9p2q8x7w1';
  presence(dir, live(new Date().toISOString()));
  const run2 = (t) => FD.main(['draft', 'save', dir, 'release', '--session', S, '--expect', dsha(DRAFT_MD), '--from', inFile(dir, edited(DRAFT_MD, t)), '--json']);
  const [a, b] = await Promise.all([run2('One'), run2('Two')]);
  const ja = JSON.parse(a.out), jb = JSON.parse(b.out);
  assert.notStrictEqual(ja.operation, jb.operation);
  assert.deepStrictEqual(proposedFiles(dir), [ja.operation + '.json', jb.operation + '.json'].sort());
  // Two direct saves from the same base: the first writes, the second finds the draft changed and proposes.
  const d2 = draftFolder();
  const w1 = JSON.parse((await FD.main(['draft', 'save', d2, 'release', '--session', S, '--expect', dsha(DRAFT_MD), '--from', inFile(d2, edited(DRAFT_MD, 'One')), '--json'])).out);
  const w2 = JSON.parse((await FD.main(['draft', 'save', d2, 'release', '--session', S, '--expect', dsha(DRAFT_MD), '--from', inFile(d2, edited(DRAFT_MD, 'Two')), '--base', inFile(d2, DRAFT_MD, 'b.md'), '--json'])).out);
  assert.deepStrictEqual([w1.outcome, w2.outcome, w2.why], ['written', 'proposed', 'changed']);
  const hist = fs.readdirSync(path.join(d2, 'history', 'drafts', 'release'));
  assert.deepStrictEqual(hist, ['agent-' + w1.operation + '.jsonl'], 'one file per invocation that wrote');
  // The same session on two computers (two copies of the folder), each continuing from P1: two replacements, both kept.
  const c1 = draftFolder(); presence(c1, live(new Date().toISOString()));
  const p1 = JSON.parse((await FD.main(['draft', 'save', c1, 'release', '--session', S, '--expect', dsha(DRAFT_MD), '--from', inFile(c1, edited(DRAFT_MD, 'P1')), '--json'])).out);
  const c2 = fs.realpathSync(tmp()); fs.cpSync(c1, c2, { recursive: true });
  const ra = JSON.parse((await FD.main(['draft', 'save', c1, 'release', '--session', S, '--expect', dsha(edited(DRAFT_MD, 'P1')), '--from', inFile(c1, edited(DRAFT_MD, 'On one')), '--json'])).out);
  const rb = JSON.parse((await FD.main(['draft', 'save', c2, 'release', '--session', S, '--expect', dsha(edited(DRAFT_MD, 'P1')), '--from', inFile(c2, edited(DRAFT_MD, 'On two')), '--json'])).out);
  assert.notStrictEqual(ra.operation, rb.operation);
  fs.copyFileSync(path.join(c2, 'proposed', 'release', rb.operation + '.json'), path.join(c1, 'proposed', 'release', rb.operation + '.json'));
  const mine = JSON.parse((await FD.main(['draft', 'read', c1, 'release', '--session', S, '--json'])).out).mine;
  assert.deepStrictEqual(mine.map(m => m.id).sort(), [p1.operation, ra.operation, rb.operation].sort());
  assert.strictEqual(mine.filter(m => m.id === p1.operation)[0].status, 'replaced');
});

run();
