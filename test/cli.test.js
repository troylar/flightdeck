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

run();
