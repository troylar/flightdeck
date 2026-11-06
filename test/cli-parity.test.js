// flightdeck draft check (2.13) against the app's own Review & publish, on the same folder: the Checks the process page draws
// and what Publish refuses with, in the same words and order (plan section 6, comparison 1). Then what a part of the folder
// that can't be read does to the answer: partial, named, and never a finding of its own.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { rule, run, load, example, exampleSetup } = require('./harness');
const { boot, folderHandle, memoryIDB } = require('./app-harness');
const RF = require('./read-fixture');

const BIN = path.join(__dirname, '..', 'bin', 'flightdeck.js');
const PF = load(), AJ = PF.appjson, EX = exampleSetup(PF), NOW = '2026-10-20T09:00:00.000Z';
const PEOPLE = example('people.json');
const wrong = (v, d) => JSON.parse(JSON.stringify(AJ.conforms(v, d)));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-parity-')));

/* A checklist: one phase, the given steps (each already indented as the format says). */
function md(o) {
  return ['---', 'process: ' + o.process, 'title: ' + (o.title || 'Checklist ' + o.process), 'owner: ' + (o.owner || 'person-avery')]
    .concat(o.backup ? ['backup: ' + o.backup] : []).concat(['context: ' + (o.context || 'commit, ticket'), 'roles: lead', '---', '', '## Do it · READ-DO {#do}'])
    .concat(o.steps || ['- [!] {confirm} Confirm the work is done @lead {#done}']).concat(['']).join('\n');
}
const STEP = {
  team: ['- [!] {change.request} Change request approved @lead {#cr}', '  system: Change board'],
  jiraOk: ['- [ ] {jira.issue} Close the ticket @lead {#close}', '  action: transition', '  issue: ^ticket', '  issueType: Release', '  status: Done'],
  link: (id, proc, more) => ['- [ ] {run.process} Run ' + proc + ' @lead {#' + id + '}', '  process: ' + proc].concat(more || [])
};

/* A team folder: people, the example's team step type and Jira workflows, the given checklists published in order (through
   repo.publish, as the app publishes), then the drafts and any other files. A null value leaves that file out. */
async function folder(spec) {
  const mem = new PF.fs.MemoryFS('parity:' + Math.random(), null);
  const base = { 'people.json': PEOPLE, 'step-types/change.request.json': example('step-types/change.request.json'), 'jira/workflows.json': example('jira/workflows.json') };
  Object.keys(spec.base || {}).forEach(k => { base[k] = spec.base[k]; });
  Object.keys(base).forEach(k => { if (base[k] == null) delete base[k]; });
  mem.reset(base);
  const taken = Object.create(null);
  let n = 0;
  for (const text of spec.publish || []) {
    const proc = PF.map.parse(text).meta.process, d = await PF.repo.loadStepTypes(mem);
    const r = await PF.repo.publish(mem, text, { people: JSON.parse(PEOPLE), customTypes: d.types, workflows: EX.workflows, by: 'person-avery', changes: 'Version', existing: (taken[proc] || []).slice(), now: NOW, rand: 'p' + String(++n).padStart(7, '0') });
    if (r.blockers) throw new Error('fixture: ' + proc + ' didn\'t publish: ' + r.blockers.join(' '));
    (taken[proc] = taken[proc] || []).push({ version: r.version });
  }
  const files = {};
  Object.keys(mem.files).forEach(p => { files[p] = mem.files[p].t; });
  Object.keys(spec.drafts || {}).forEach(p => { files['maps/drafts/' + p + '.md'] = spec.drafts[p]; });
  Object.keys(spec.files || {}).forEach(p => { if (spec.files[p] == null) delete files[p]; else files[p] = spec.files[p]; });
  return files;
}

function cli(dir, proc, more) {
  const r = cp.spawnSync(process.execPath, [BIN, 'draft', 'check', dir, proc].concat(more || []).concat(['--json']), { encoding: 'utf8', maxBuffer: 64 * 1048576 });
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* asserted below */ }
  assert.ok(json, 'JSON on stdout: ' + r.stdout + r.stderr);
  if (!json.error) {
    assert.deepStrictEqual(wrong(json, AJ.SCHEMA2.envelope), [], 'envelope');
    assert.deepStrictEqual(wrong(json.data, AJ.SCHEMA2.draftCheck), [], 'SCHEMA2.draftCheck');
    assert.strictEqual(json.contract, 'flightdeck-read/2');
    assert.strictEqual(r.status === 4, !json.complete, 'exit 4 exactly when partial (exit ' + r.status + ')');
    assert.strictEqual(json.complete, json.problems.length === 0);
  }
  return { code: r.status, json };
}

const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/* The app on the same files: the process page's Checks (Review & publish), then Publish with a change note, recording what
   repo.publish answered. */
async function appVerdict(files, proc) {
  const dir = folderHandle('Team', Object.assign({}, files));
  const app = boot({ picker: dir, indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.choose('person-avery'); await app.tick();
  app.click('open-process', proc); await app.tick();
  const html = app.html();
  assert.ok(/id="change-note"/.test(html), 'the process page shows Review & publish for ' + proc);
  const rows = [...html.matchAll(/<li id="checks-ov-[^"]*" tabindex="-1"><span class="lvl (bad|tip)">\w+<\/span><span>([\s\S]*?)<\/span><\/li>/g)];
  assert.ok(rows.length || /<span class="lvl ok">Good<\/span><span>Ready to publish\.<\/span>/.test(html), 'the checks are drawn');
  assert.ok(!/data-act="more"[^>]*data-id="checks-ov"/.test(html), 'every check is on the page');
  let res = null;
  const orig = app.PF.repo.publish;
  app.PF.repo.publish = function () { return orig.apply(this, arguments).then(r => { res = r; return r; }); };
  app.set('change-note', 'Parity'); app.click('publish', proc); await app.tick(300);
  assert.ok(res, 'Publish ran');
  return { checks: { blockers: rows.filter(m => m[1] === 'bad').map(m => unesc(m[2])), suggestions: rows.filter(m => m[1] === 'tip').map(m => unesc(m[2])) },
    publish: { ok: !res.blockers, blockers: JSON.parse(JSON.stringify(res.blockers || [])) } };
}

async function same(files, proc, expect) {
  const dir = RF.toDisk(files, tmp()), r = cli(dir, proc), a = await appVerdict(files, proc);
  assert.strictEqual(r.code, 0, JSON.stringify(r.json));
  assert.strictEqual(r.json.complete, true);
  assert.deepStrictEqual(r.json.data.checks, a.checks, 'the checks Review & publish shows');
  assert.deepStrictEqual(r.json.data.publish, a.publish, 'what Publish says: ' + JSON.stringify(a.publish));
  if (expect) expect(r.json.data);
  return r.json.data;
}
const has = (list, re) => list.some(x => re.test(x));

/* ---------- comparison 1: the same folder, the same verdict ---------- */

rule('Parity: team step type, Jira, people and a published child: no false finding, the same verdict as Review & publish', async () => {
  const files = await folder({ publish: [example('maps/drafts/check-in.md')],
    drafts: { deploy: md({ process: 'deploy', owner: 'person-casey', backup: 'person-avery', steps: STEP.team.concat(STEP.jiraOk, STEP.link('notes', 'check-in', ['  carry: commit'])) }) } });
  await same(files, 'deploy', d => {
    assert.deepStrictEqual(d.checks.blockers, [], 'a team type is known');
    assert.ok(!has(d.checks.suggestions, /people\.json|isn't published yet|Jira workflows don't describe/), JSON.stringify(d.checks));
    assert.strictEqual(d.publish.ok, true);
  });
});

rule('Parity: the example folder\'s release checklist, with check-in published: the same verdict', async () => {
  const files = await folder({ publish: [example('maps/drafts/check-in.md')], drafts: { release: example('maps/drafts/release.md') } });
  await same(files, 'release', d => assert.deepStrictEqual(d.checks.blockers, []));
});

rule('Parity: a linked child that isn\'t published, one that is, a good version: pin and a pin to no such version', async () => {
  const files = await folder({ publish: [example('maps/drafts/check-in.md')],
    drafts: { deploy: md({ process: 'deploy', steps: STEP.link('a', 'check-in', ['  carry: commit']).concat(STEP.link('b', 'incident', ['  pass: commit=commit']), STEP.link('c', 'check-in', ['  version: 1']), STEP.link('d', 'check-in', ['  version: 7'])) }) } });
  await same(files, 'deploy', d => {
    assert.ok(has(d.checks.suggestions, /"incident", which isn't published yet/) && !has(d.checks.suggestions, /"check-in", which isn't published yet/), JSON.stringify(d.checks));
    assert.ok(d.publish.blockers.length === 1 && /version: 7 can't be pinned/.test(d.publish.blockers[0]), JSON.stringify(d.publish));
  });
});

rule('Parity: a child\'s detail the step passes that the child lacks is a blocker, from the child as published', async () => {
  const files = await folder({ publish: [example('maps/drafts/check-in.md')], drafts: { deploy: md({ process: 'deploy', context: 'commit, ticket, nope', steps: STEP.link('a', 'check-in', ['  pass: nope=nope']) }) } });
  await same(files, 'deploy', d => assert.ok(has(d.checks.blockers, /has no run detail nope/), JSON.stringify(d.checks)));
});

rule('Parity: every Jira case: a status not in the workflow, one no transition reaches, an undescribed type, no type, a damaged file', async () => {
  const jira = (id, type, status) => ['- [ ] {jira.issue} Move it ' + id + ' @lead {#' + id + '}', '  action: transition', '  issue: ^ticket'].concat(type ? ['  issueType: ' + type] : [], ['  status: ' + status]);
  const steps = jira('j1', 'Release', 'Shipped').concat(jira('j2', 'Release', 'Open'), jira('j3', 'Bug', 'Done'), jira('j4', '', 'Done'), jira('j5', 'release', 'Done'));
  let files = await folder({ drafts: { deploy: md({ process: 'deploy', steps }) } });
  await same(files, 'deploy', d => {
    assert.ok(has(d.checks.blockers, /"Shipped" isn't a status/) && has(d.checks.blockers, /no transition in the Release workflow leads to "Open"/), JSON.stringify(d.checks));
    assert.ok(has(d.checks.suggestions, /don't describe "Bug" issues/) && has(d.checks.suggestions, /add "issueType:"/), JSON.stringify(d.checks));
  });
  files = await folder({ drafts: { deploy: md({ process: 'deploy', steps }) }, files: { 'jira/workflows.json': '{' } });
  await same(files, 'deploy', d => assert.ok(has(d.checks.blockers, /jira\/workflows\.json can't be read/), JSON.stringify(d.checks)));
  files = await folder({ drafts: { deploy: md({ process: 'deploy', steps }) }, files: { 'jira/workflows.json': null } });
  await same(files, 'deploy', d => assert.ok(!has(d.checks.blockers.concat(d.checks.suggestions), /Jira|workflow/), 'no file: transitions aren\'t checked'));
});

rule('Parity: an owner and a backup not in people.json, an inactive one, and no people.json at all', async () => {
  const people = JSON.parse(PEOPLE).concat([{ id: 'person-gone', name: 'Gone Person', inactive: true }]);
  let files = await folder({ base: { 'people.json': JSON.stringify(people) }, drafts: { deploy: md({ process: 'deploy', owner: 'person-zed', backup: 'person-gone' }) } });
  await same(files, 'deploy', d => assert.ok(has(d.checks.suggestions, /Owner "person-zed" isn't in people\.json/) && !has(d.checks.suggestions, /person-gone/), JSON.stringify(d.checks)));
  files = await folder({ base: { 'people.json': null }, drafts: { deploy: md({ process: 'deploy', owner: 'person-zed', backup: 'person-avery' }) } });
  await same(files, 'deploy');
});

rule('Parity: a published parent passes a detail this draft dropped: the suggestion, in the app\'s order with two parents', async () => {
  const parent = (p, t) => md({ process: p, title: t, steps: STEP.link('run-deploy', 'deploy', ['  carry: commit']) });
  const files = await folder({ publish: [md({ process: 'deploy' }), parent('ship', 'Ship it'), parent('archive', 'Archive it')],
    drafts: { deploy: md({ process: 'deploy', context: 'ticket' }) } });
  await same(files, 'deploy', d => {
    const s = d.checks.suggestions.filter(x => /\(published\) step/.test(x));
    assert.strictEqual(s.length, 2, JSON.stringify(d.checks));
    assert.ok(/^Archive it/.test(s[0]) && /^Ship it/.test(s[1]), 'by category, then title, as the app lists them');
  });
});

rule('Parity: unknown and team step types, reserved names, team values and screenshots', async () => {
  const tv = JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'main-commit': { value: 'abc123' } } });
  const steps = ['- [!] {nope.type} Do the unknown thing @lead {#u1}'].concat(STEP.team, STEP.link('k', 'check-in', ['  pass: commit=team:main-commit, branch=team:missing']));
  let files = await folder({ publish: [example('maps/drafts/check-in.md')], base: { 'team-values.json': tv }, drafts: { deploy: md({ process: 'deploy', context: 'commit, ticket, __proto__', steps }) } });
  await same(files, 'deploy', d => {
    assert.ok(has(d.checks.blockers, /unknown type \{nope\.type\}/) && !has(d.checks.blockers, /change\.request/), JSON.stringify(d.checks));
    assert.ok(has(d.checks.blockers, /"missing" isn't a team value/) && has(d.checks.blockers, /__proto__/), JSON.stringify(d.checks));
  });
  const shot = ['- [!] {confirm} Look at the screen @lead {#s1}', '  ![The screen](images/deploy/there.png)', '  ![Another](images/deploy/gone.png)'];
  files = await folder({ drafts: { deploy: md({ process: 'deploy', steps: shot }) }, files: { 'images/deploy/there.png': 'PNG' } });
  await same(files, 'deploy', d => assert.deepStrictEqual(d.publish, { ok: false, blockers: ['The screenshot images/deploy/gone.png isn\'t in the team folder. Add it, or remove it from the checklist.'] }));
});

rule('Parity: odd names: constructor and __proto__ as a process, a step type and a person', async () => {
  const people = JSON.parse(PEOPLE).concat([{ id: 'constructor', name: 'Con Structor' }]);
  const files = await folder({ base: { 'people.json': JSON.stringify(people) }, publish: [md({ process: 'constructor', title: 'Construct' })],
    drafts: {
      deploy: md({ process: 'deploy', owner: '__proto__', backup: 'constructor', steps: ['- [!] {constructor} Build it @lead {#b1}', '- [ ] {__proto__} Proto it @lead {#b2}', '- [ ] {toString} Say it @lead {#b3}'].concat(STEP.link('c', 'constructor', ['  carry: commit']), STEP.link('h', 'hasownproperty', ['  carry: commit'])) }),
      constructor: md({ process: 'constructor', title: 'Construct', context: 'ticket', owner: 'constructor' })
    } });
  await same(files, 'deploy', d => {
    assert.ok(has(d.checks.blockers, /unknown type \{constructor\}/) && has(d.checks.blockers, /unknown type \{toString\}/), JSON.stringify(d.checks));
    assert.ok(has(d.checks.suggestions, /Owner "__proto__" isn't in people\.json/) && !has(d.checks.suggestions, /Backup owner "constructor"/), JSON.stringify(d.checks));
    assert.ok(!has(d.checks.suggestions, /"constructor", which isn't published yet/) && has(d.checks.suggestions, /"hasownproperty", which isn't published yet/), JSON.stringify(d.checks));
  });
  await same(files, 'constructor', d => assert.ok(!has(d.checks.suggestions, /people\.json/), JSON.stringify(d.checks)));
});

rule('Parity: the views and draft check build their inputs with one function (PF.publish.checkOptions)', () => {
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  ['ui/views/manage.js', 'ui/views/process.js'].forEach(f => assert.ok(!/M\.check\([^;]*\{ people:/.test(src(f)), f + ' builds M.check\'s inputs itself'));
  assert.ok(/PF\.publish\.checkOptions\(/.test(src('ui/views/common.js')));
  assert.ok(/PF\.publish\.publishCheck\(/.test(fs.readFileSync(BIN, 'utf8')) && /PF\.publish\.checkContext\(/.test(fs.readFileSync(BIN, 'utf8')));
});

/* ---------- a part of the folder that can't be read: partial, named, never a finding ---------- */

async function baseline() {
  const files = await folder({ publish: [example('maps/drafts/check-in.md'), md({ process: 'deploy' }), md({ process: 'ship', title: 'Ship it', steps: STEP.link('run-deploy', 'deploy', ['  carry: commit']) }),
    md({ process: 'archive', title: 'Archive it', steps: STEP.link('run-deploy', 'deploy', ['  carry: commit']) }), md({ process: 'archive', title: 'Archive it' })],
    drafts: { deploy: md({ process: 'deploy', context: 'ticket', owner: 'person-casey', backup: 'person-avery', steps: STEP.team.concat(STEP.jiraOk, STEP.link('notes', 'check-in', ['  carry: ticket'])) }) } });
  const dir = RF.toDisk(files, tmp()), r = cli(dir, 'deploy');
  assert.strictEqual(r.code, 0, JSON.stringify(r.json));
  return { dir, ok: r.json.data };
}
/* Partial, the path named, and nothing found that the whole folder doesn't give: no blocker, no tip beyond the readable answer. */
function partial(dir, ok, where, kind) {
  const r = cli(dir, 'deploy');
  assert.strictEqual(r.code, 4, JSON.stringify(r.json));
  assert.ok(r.json.problems.some(p => where.test(p.path) && (!kind || p.kind === kind)), JSON.stringify(r.json.problems));
  r.json.data.checks.blockers.forEach(b => assert.ok(ok.checks.blockers.indexOf(b) >= 0, 'a blocker from what couldn\'t be read: ' + b));
  r.json.data.checks.suggestions.forEach(s => assert.ok(ok.checks.suggestions.indexOf(s) >= 0, 'a tip from what couldn\'t be read: ' + s));
  r.json.data.publish.blockers.forEach(b => assert.ok(ok.publish.blockers.indexOf(b) >= 0, 'a publish blocker from what couldn\'t be read: ' + b));
  return r.json.data;
}
function locked(p, fn) { fs.chmodSync(p, 0o000); try { return fn(); } finally { fs.chmodSync(p, fs.statSync(p).isDirectory() ? 0o755 : 0o644); } }

rule('Read failure: people.json unreadable or from a newer Flightdeck: partial, and no owner is called missing', async () => {
  const { dir, ok } = await baseline(), f = path.join(dir, 'people.json');
  assert.ok(has(ok.checks.suggestions, /published\) step/), 'the baseline has the parent tip');
  locked(f, () => partial(dir, ok, /^people\.json$/));
  fs.writeFileSync(f, JSON.stringify({ format: 'flightdeck-people/9', people: [] }));
  const d = partial(dir, ok, /^people\.json$/, 'newer');
  assert.ok(!has(d.checks.suggestions, /people\.json/));
});

rule('Read failure: a team step type unreadable or newer, or step-types/ unreadable: partial, and never an unknown type', async () => {
  const { dir, ok } = await baseline(), f = path.join(dir, 'step-types', 'change.request.json');
  locked(f, () => partial(dir, ok, /^step-types\/change\.request\.json$/));
  locked(path.join(dir, 'step-types'), () => partial(dir, ok, /^step-types/));
  const def = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.writeFileSync(f, JSON.stringify(Object.assign({ format: 'flightdeck-step-type/9' }, def)));
  const d = partial(dir, ok, /^step-types\/change\.request\.json$/, 'newer');
  assert.ok(!has(d.checks.blockers, /unknown type/));
});

rule('Read failure: jira/workflows.json unreadable: partial, and no transition is checked against nothing', async () => {
  const { dir, ok } = await baseline();
  locked(path.join(dir, 'jira', 'workflows.json'), () => partial(dir, ok, /^jira\/workflows\.json$/));
  locked(path.join(dir, 'jira'), () => partial(dir, ok, /^jira/));
});

rule('Read failure: publications/ unreadable, or one process (child or parent) unreadable or newer: partial, never "isn\'t published"', async () => {
  const { dir, ok } = await baseline();
  locked(path.join(dir, 'publications'), () => { const d = partial(dir, ok, /^publications/); assert.ok(!has(d.checks.suggestions, /published/), JSON.stringify(d.checks)); });
  locked(path.join(dir, 'publications', 'check-in'), () => partial(dir, ok, /^publications\/check-in/));
  locked(path.join(dir, 'publications', 'ship'), () => partial(dir, ok, /^publications\/ship/));
  const v = fs.readdirSync(path.join(dir, 'publications', 'ship'))[0], pj = path.join(dir, 'publications', 'ship', v, 'publication.json');
  locked(pj, () => partial(dir, ok, /^publications\/ship\//));
  const info = JSON.parse(fs.readFileSync(pj, 'utf8'));
  fs.writeFileSync(pj, JSON.stringify(Object.assign(info, { format: 'preflight-publication/9', features: [] })));
  partial(dir, ok, /^publications\/ship\//, 'newer');
  /* archive's v2 no longer starts deploy; with v2 unreadable, v1 (which does) must not stand in for its latest. */
  const v2 = fs.readdirSync(path.join(dir, 'publications', 'archive')).filter(n => /^v2-/.test(n))[0];
  assert.ok(v2 && !has(ok.checks.suggestions, /^Archive it/), 'the baseline: archive v2 doesn\'t start deploy');
  locked(path.join(dir, 'publications', 'archive', v2, 'publication.json'), () => partial(dir, ok, /^publications\/archive\//));
});

rule('Read failure: a screenshot that can\'t be read is never called missing from the folder', async () => {
  const files = await folder({ drafts: { deploy: md({ process: 'deploy', steps: ['- [!] {confirm} Look @lead {#s1}', '  ![The screen](images/deploy/there.png)'] }) }, files: { 'images/deploy/there.png': 'PNG' } });
  const dir = RF.toDisk(files, tmp()), ok = cli(dir, 'deploy').json.data;
  assert.strictEqual(ok.publish.ok, true);
  locked(path.join(dir, 'images', 'deploy', 'there.png'), () => { const d = partial(dir, ok, /^images\/deploy\/there\.png$/); assert.strictEqual(d.publish.ok, true); });
});

rule('Read failure: a child whose latest version can\'t be read isn\'t checked against an older one', async () => {
  const files = await folder({ publish: [md({ process: 'kid', title: 'Kid', context: 'commit' }), md({ process: 'kid', title: 'Kid' }), md({ process: 'deploy' })],
    drafts: { deploy: md({ process: 'deploy', steps: STEP.link('k', 'kid', ['  carry: ticket']) }) } });
  const dir = RF.toDisk(files, tmp()), r = cli(dir, 'deploy');
  assert.strictEqual(r.code, 0, JSON.stringify(r.json));
  const ok = r.json.data, v2 = fs.readdirSync(path.join(dir, 'publications', 'kid')).filter(n => /^v2-/.test(n))[0];
  assert.ok(v2 && !has(ok.checks.blockers, /run detail ticket/), 'the baseline: kid v2 has ticket');
  locked(path.join(dir, 'publications', 'kid', v2, 'publication.json'), () => partial(dir, ok, /^publications\/kid\//));
  const pj = path.join(dir, 'publications', 'kid', v2, 'publication.json'), info = JSON.parse(fs.readFileSync(pj, 'utf8'));
  fs.writeFileSync(pj, JSON.stringify(Object.assign(info, { format: 'preflight-publication/9', features: [] })));
  partial(dir, ok, /^publications\/kid\//, 'newer');
});

rule('Read failure: a version: pin to a process that can\'t be read is left unchecked, never "isn\'t published"', async () => {
  const files = await folder({ publish: [example('maps/drafts/check-in.md')], drafts: { deploy: md({ process: 'deploy', steps: STEP.link('c', 'check-in', ['  version: 1']) }) } });
  const dir = RF.toDisk(files, tmp()), r = cli(dir, 'deploy');
  assert.deepStrictEqual([r.code, r.json.data.publish.ok], [0, true], JSON.stringify(r.json));
  const ok = r.json.data;
  locked(path.join(dir, 'publications'), () => assert.strictEqual(partial(dir, ok, /^publications/).publish.ok, true));
  locked(path.join(dir, 'publications', 'check-in'), () => assert.strictEqual(partial(dir, ok, /^publications\/check-in/).publish.ok, true));
});

rule('Read failure: a screenshot that opens but whose bytes fail is never called missing, and is named', async () => {
  const FD = require(BIN);
  const files = await folder({ drafts: { deploy: md({ process: 'deploy', steps: ['- [!] {confirm} Look @lead {#s1}', '  ![The screen](images/deploy/there.png)'] }) }, files: { 'images/deploy/there.png': 'PNG' } });
  const dir = RF.toDisk(files, tmp()), ok = cli(dir, 'deploy').json.data;
  const open = fs.openSync, read = fs.readSync, bad = new Set();
  fs.openSync = function (p) { const fd = open.apply(fs, arguments); if (/there\.png$/.test(String(p))) bad.add(fd); return fd; };
  fs.readSync = function (fd) { if (bad.has(fd)) { const e = new Error('EIO: i/o error, read'); e.code = 'EIO'; throw e; } return read.apply(fs, arguments); };
  let r;
  try { r = await FD.main(['draft', 'check', dir, 'deploy', '--json']); } finally { fs.openSync = open; fs.readSync = read; }
  const j = JSON.parse(r.out);
  assert.ok(bad.size > 0, 'the screenshot was opened');
  assert.deepStrictEqual([r.code, j.complete, j.data.publish], [4, false, ok.publish], r.out);
  assert.ok(j.problems.some(p => p.path === 'images/deploy/there.png'), r.out);
});

rule('Read failure: team-values.json unreadable or newer is unknown, never "can\'t be checked"; people.json not valid JSON is unknown', async () => {
  const tv = JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'main-commit': { value: 'abc123' } } });
  const files = await folder({ publish: [example('maps/drafts/check-in.md')], base: { 'team-values.json': tv }, drafts: { deploy: md({ process: 'deploy', owner: 'person-zed', steps: STEP.link('k', 'check-in', ['  pass: commit=team:main-commit']) }) } });
  const dir = RF.toDisk(files, tmp()), r = cli(dir, 'deploy'), ok = r.json.data, f = path.join(dir, 'team-values.json');
  assert.deepStrictEqual([r.code, ok.checks.blockers], [0, []], JSON.stringify(r.json));
  assert.ok(has(ok.checks.suggestions, /Owner "person-zed" isn't in people\.json/), 'the baseline has the owner tip');
  locked(f, () => partial(dir, ok, /^team-values\.json$/));
  fs.writeFileSync(f, JSON.stringify({ format: 'flightdeck-team-values/9', values: {} }));
  partial(dir, ok, /^team-values\.json$/, 'newer');
  fs.writeFileSync(f, tv);
  fs.writeFileSync(path.join(dir, 'people.json'), '{"people": [');
  const d = partial(dir, ok, /^people\.json$/, 'malformed');
  assert.ok(!has(d.checks.suggestions, /people\.json/), JSON.stringify(d.checks));
});

/* Round 4 (item 3): a Jira search's address is a team value, checked wherever a draft is: draft check, publish and stage
   read team-values.json for it as they do for a passed team value, and an unreadable file leaves the check unknown. */
rule('R4-3: a draft with only a Jira search: an invalid, missing or unset address is a blocker in draft check, publish and stage; an unreadable team-values.json is unknown', async () => {
  const search = ['- [ ] {jira.search} Stories are done @lead {#s}', '  query: project = PAY', '  results: none'];
  const draft = md({ process: 'deploy', steps: search });
  const tvOf = v => JSON.stringify({ format: 'flightdeck-team-values/1', values: v });
  const cases = [
    ['valid', tvOf({ 'jira-base-url': { value: 'https://jira.example.com' } }), null],
    ['invalid', tvOf({ 'jira-base-url': { value: 'not a Jira address' } }), /isn't a Jira address Flightdeck can link to/],
    ['not set', tvOf({ other: { value: 'x' } }), /"jira-base-url" isn't in team-values\.json/],
    ['no file', null, /"jira-base-url" isn't in team-values\.json/]
  ];
  let okData = null;
  for (const [what, tv, re] of cases) {
    const files = await folder({ base: { 'team-values.json': tv }, drafts: { deploy: draft } });
    const dir = RF.toDisk(files, tmp()), r = cli(dir, 'deploy'), d = r.json.data;
    assert.strictEqual(r.code, 0, what + ': complete: ' + JSON.stringify(r.json.problems));
    const bl = d.checks.blockers.concat(d.publish.blockers);
    if (re) assert.ok(has(bl, re), what + ': draft check blocks: ' + JSON.stringify(bl));
    else { assert.deepStrictEqual(bl.filter(b => /Jira address|jira-base-url/.test(b)), [], what + ': no address blocker'); okData = d; }
    /* Publish and stage, fresh, as the app does them. */
    const mem = new PF.fs.MemoryFS('r4:' + what + Math.random(), null); const base = {}; Object.keys(files).forEach(k => { base[k] = files[k]; }); mem.reset(base);
    const d2 = await PF.repo.loadStepTypes(mem);
    const opts = { people: JSON.parse(PEOPLE), customTypes: d2.types, workflows: EX.workflows, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'r4' + what.replace(/\W/g, '') };
    const pub = await PF.repo.publish(mem, draft, opts);
    if (re) assert.ok(pub.blockers && has(pub.blockers, re), what + ': publish refuses: ' + JSON.stringify(pub.blockers));
    else assert.ok(!pub.blockers, what + ': publishes: ' + JSON.stringify(pub.blockers));
    if (PF.repo.stage) {
      const mem2 = new PF.fs.MemoryFS('r4s:' + what + Math.random(), null); mem2.reset(base);
      const st = await PF.repo.stage(mem2, draft, Object.assign({}, opts, { rand: opts.rand + 's' })).catch(e => ({ blockers: [String(e && e.message)] }));
      if (re) assert.ok(st.blockers && has(st.blockers, re), what + ': stage refuses: ' + JSON.stringify(st.blockers));
    }
  }
  const files = await folder({ base: { 'team-values.json': cases[0][1] }, drafts: { deploy: draft } });
  const dir = RF.toDisk(files, tmp());
  locked(path.join(dir, 'team-values.json'), () => {
    const d = partial(dir, okData, /^team-values\.json$/);
    assert.ok(!has(d.checks.blockers.concat(d.publish.blockers), /Jira address|jira-base-url/), 'unknown, never a finding');
  });
});

/* ---------- the guard: every input, failed every way the ledger knows, is unknown: never a finding, always named ---------- */

const PICK = JSON.stringify({ id: 'pick.one', label: 'Pick one', icon: 'doc', hint: 'One of two ways.', fields: { mode: { label: 'Mode', kind: 'choice', options: ['^literal', 'other'], required: true } } });
const TV = JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'main-commit': { value: 'abc123' } } });
async function guardFolder() {
  const steps = STEP.team.concat(STEP.jiraOk, ['- [ ] {pick.one} Pick the way @lead {#pick}', '  mode: ^literal'],
    STEP.link('k', 'kid', ['  version: 1', '  carry: ticket']), STEP.link('t', 'check-in', ['  pass: commit=team:main-commit']),
    ['- [!] {confirm} Look at the screen @lead {#s1}', '  ![The screen](images/deploy/there.png)']);
  const files = await folder({ base: { 'step-types/pick.one.json': PICK, 'team-values.json': TV },
    publish: [example('maps/drafts/check-in.md'), md({ process: 'kid', title: 'Kid' }), md({ process: 'ship', title: 'Ship it', steps: STEP.link('run-deploy', 'deploy', ['  carry: commit']) })],
    drafts: { deploy: md({ process: 'deploy', owner: 'person-casey', backup: 'person-avery', steps }) }, files: { 'images/deploy/there.png': 'PNG' } });
  return RF.toDisk(files, tmp());
}
const newer = (fam) => (t) => { const o = JSON.parse(t); return JSON.stringify(Array.isArray(o) ? { format: fam + '/9', people: o } : Object.assign(o, { format: fam + '/9', features: [] })); };
const pubOf = (dir, proc) => 'publications/' + proc + '/' + fs.readdirSync(path.join(dir, 'publications', proc))[0] + '/publication.json';
/* Each input: the paths that hold it, the ways it can fail, and what a finding about it would say. */
const GUARD = [
  { input: 'people', at: () => 'people.json', ways: { newer: newer('flightdeck-people') }, says: /people\.json|person-/ },
  { input: 'a team step type', at: () => 'step-types/pick.one.json', ways: { newer: newer('flightdeck-step-type') }, says: /pick\.one|\^literal|unknown type/ },
  { input: 'another team step type', at: () => 'step-types/change.request.json', ways: { newer: newer('flightdeck-step-type') }, says: /change\.request|unknown type|system/ },
  { input: 'step-types/', at: () => 'step-types', dir: true, says: /pick\.one|change\.request|\^literal|unknown type/ },
  { input: 'Jira workflows', at: () => 'jira/workflows.json', says: /Jira|workflow|transition|"Done"/ },
  { input: 'team values', at: () => 'team-values.json', ways: { newer: newer('flightdeck-team-values') }, says: /team value|team-values/ },
  { input: 'a child\'s version', at: (dir) => pubOf(dir, 'kid'), ways: { newer: newer('preflight-publication') }, says: /kid/i },
  { input: 'a child\'s folder', at: () => 'publications/kid', dir: true, says: /kid/i },
  { input: 'a parent\'s version', at: (dir) => pubOf(dir, 'ship'), ways: { newer: newer('preflight-publication') }, says: /ship/i },
  { input: 'publications/', at: () => 'publications', dir: true, says: /kid|check-in|ship|published/i },
  { input: 'a screenshot', at: () => 'images/deploy/there.png', says: /there\.png/ }
];
/* Fail one path one way, run draft check in this process, put it back. */
async function failed(dir, rel, way, change) {
  const FD = require(BIN), full = path.join(dir, rel), open = fs.openSync, readdir = fs.readdirSync, keep = path.join(tmp(), 'kept');
  if (way === 'unreadable') fs.chmodSync(full, 0o000);
  if (way === 'newer') { var before = fs.readFileSync(full, 'utf8'); fs.writeFileSync(full, change(before)); }
  if (way === 'link') { fs.renameSync(full, keep); fs.symlinkSync(keep, full); }
  if (way === 'vanished') {
    const gone = (p) => path.resolve(String(p)) === full;
    const no = () => { const e = new Error('ENOENT: no such file or directory'); e.code = 'ENOENT'; throw e; };
    fs.openSync = function (p) { if (gone(p)) no(); return open.apply(fs, arguments); };
    fs.readdirSync = function (p) { if (gone(p)) no(); return readdir.apply(fs, arguments); };
  }
  try { const r = await FD.main(['draft', 'check', dir, 'deploy', '--json']); return { code: r.code, json: JSON.parse(r.out) }; }
  finally {
    fs.openSync = open; fs.readdirSync = readdir;
    if (way === 'unreadable') fs.chmodSync(full, fs.statSync(full).isDirectory() ? 0o755 : 0o644);
    if (way === 'newer') fs.writeFileSync(full, before);
    if (way === 'link') { fs.unlinkSync(full); fs.renameSync(keep, full); }
  }
}

rule('Guard: every input the checks use, failed each way the ledger knows (unreadable, newer, link, vanished, over the limit), is never a finding and always named', async () => {
  const dir = await guardFolder(), base = cli(dir, 'deploy');
  assert.strictEqual(base.code, 0, JSON.stringify(base.json));
  const all = d => d.checks.blockers.concat(d.checks.suggestions, d.publish.blockers);
  GUARD.forEach(g => assert.ok(!has(all(base.json.data), g.says), 'the baseline has nothing about ' + g.input + ': ' + JSON.stringify(base.json.data)));
  const wrongs = [];
  for (const g of GUARD) {
    const rel = g.at(dir);
    for (const way of ['unreadable', 'link', 'vanished'].concat(g.ways && g.ways.newer ? ['newer'] : [])) {
      const r = await failed(dir, rel, way, g.ways && g.ways.newer);
      const f = all(r.json.data || { checks: { blockers: [], suggestions: [] }, publish: { blockers: [] } }).filter(x => g.says.test(x));
      if (r.code !== 4 || r.json.complete !== false) wrongs.push(g.input + ' ' + way + ': exit ' + r.code + ', complete ' + r.json.complete);
      else if (!r.json.problems.some(p => { const q = p.path.replace(/\/+$/, ''); return q === rel || q.indexOf(rel + '/') === 0 || rel.indexOf(q + '/') === 0; })) wrongs.push(g.input + ' ' + way + ': not named: ' + JSON.stringify(r.json.problems));
      if (f.length) wrongs.push(g.input + ' ' + way + ': a finding: ' + f.join(' | '));
    }
  }
  /* Over the limit: 101 team step types, and the draft's come after the first 100. */
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(dir, 'step-types', 'aa.t' + String(i).padStart(3, '0') + '.json'), JSON.stringify({ id: 'aa.t' + String(i).padStart(3, '0'), label: 'T' + i, icon: 'doc', hint: 'x', fields: {} }));
  const r = cli(dir, 'deploy'), f = all(r.json.data).filter(x => /pick\.one|change\.request|\^literal|unknown type/.test(x));
  if (r.code !== 4 || !r.json.problems.some(p => /^step-types/.test(p.path) && /102 files; Flightdeck loads the first 100/.test(p.why))) wrongs.push('step-types over the limit: exit ' + r.code + ', ' + JSON.stringify(r.json.problems));
  if (f.length) wrongs.push('step-types over the limit: a finding: ' + f.join(' | '));
  assert.deepStrictEqual(wrongs, []);
});

rule('Guard: PF.publish.unknownOf maps each ledger problem to the input it belongs to (the one place that decides unknown)', () => {
  const U = (problems, shots) => JSON.parse(JSON.stringify(PF.publish.unknownOf(problems, shots || [])));
  const none = { types: [], processes: [], versions: [], shots: [] };
  const TABLE = [
    [[], none],
    [[{ path: 'people.json', kind: 'unreadable' }], Object.assign({}, none, { people: true })],
    [[{ path: 'people.json', kind: 'vanished' }], Object.assign({}, none, { people: true })],
    [[{ path: 'people.json', kind: 'malformed' }], Object.assign({}, none, { people: true })],
    [[{ path: 'people.json', kind: 'link' }], Object.assign({}, none, { people: true })],
    [[{ path: 'step-types', kind: 'unreadable' }], Object.assign({}, none, { types: true })],
    [[{ path: 'step-types/', kind: 'unreadable' }], Object.assign({}, none, { types: true })],
    [[{ path: 'step-types/pick.one.json', kind: 'newer' }, { path: 'step-types/a.b.json', kind: 'skipped' }], Object.assign({}, none, { types: ['pick.one', 'a.b'] })],
    [[{ path: 'step-types/pick.one.json', kind: 'link' }, { path: 'step-types', kind: 'vanished' }], Object.assign({}, none, { types: true })],
    [[{ path: 'jira', kind: 'unreadable' }], Object.assign({}, none, { workflows: true })],
    [[{ path: 'jira/workflows.json', kind: 'vanished' }], Object.assign({}, none, { workflows: true })],
    [[{ path: 'team-values.json', kind: 'vanished' }], Object.assign({}, none, { teamValues: true })],
    [[{ path: 'team-values.json', kind: 'newer' }], Object.assign({}, none, { teamValues: true })],
    [[{ path: 'team-values.json', kind: 'malformed' }], none],
    [[{ path: 'publications', kind: 'unreadable' }], Object.assign({}, none, { publications: true })],
    [[{ path: 'publications/kid', kind: 'link' }, { path: 'publications/kid/v1-y/', kind: 'unreadable' }], Object.assign({}, none, { processes: ['kid'], versions: [['kid', 1]] })],
    [[{ path: 'publications/ship/v2-x/publication.json', kind: 'newer' }, { path: 'publications/ship/v1-y/', kind: 'unreadable' }], Object.assign({}, none, { versions: [['ship', 2], ['ship', 1]] })],
    [[{ path: 'publications/ship/notes.txt', kind: 'unreadable' }], Object.assign({}, none, { processes: ['ship'] })],
    [[{ path: 'images/deploy/there.png', kind: 'vanished' }, { path: 'images/other.png', kind: 'unreadable' }], Object.assign({}, none, { shots: ['images/deploy/there.png'] }), ['images/deploy/there.png']],
    [[{ path: 'images', kind: 'unreadable' }], Object.assign({}, none, { shots: ['images/deploy/there.png'] }), ['images/deploy/there.png']],
    [[{ path: '', kind: 'unreadable' }], { people: true, types: true, workflows: true, teamValues: true, publications: true, processes: [], versions: [], shots: ['images/a.png'] }, ['images/a.png']],
    [[{ path: 'runs/x/y/run.json', kind: 'unreadable' }, { path: 'maps/drafts/deploy.md', kind: 'unreadable' }], none]
  ];
  TABLE.forEach(([problems, want, shots]) => assert.deepStrictEqual(U(problems, shots), want, JSON.stringify(problems)));
});

/* Every place the checks read an input checkOptions gives: each is listed here with the input whose unknown state it honors,
   so a new read of an input is a test failure until it's listed (and the guard above covers it). */
rule('Guard: every read of a check input in the checks is listed with its unknown state', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'map.js'), 'utf8');
  const fnStart = src.indexOf('function check(map, opts)'), body = src.slice(fnStart, src.indexOf('\n  }\n', src.indexOf('return { blockers: blockers, suggestions: suggestions };', fnStart)));
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const reads = (code.match(/opts\.(people|types|workflows|processes|children|parents|teamValues|unknownType)\b/g) || []).reduce((o, k) => { o[k] = (o[k] || 0) + 1; return o; }, {});
  const LISTED = {
    'opts.people': 4, /* owner and backup: null when people.json is unknown, so neither is checked */
    'opts.types': 2, /* the step's type, and which of its fields references are scanned in */
    'opts.unknownType': 3, /* a type whose file is unknown: no unknown-type blocker, and none of that step's fields scanned for references */
    'opts.workflows': 3, /* jiraCheck and the Jira step: null when jira/workflows.json is unknown */
    'opts.processes': 2, /* "isn't published yet": an unread process is listed as there; null when publications/ is unknown */
    'opts.children': 2, /* child details and team value kinds: null for an unread process, so nothing is checked against an older version */
    'opts.parents': 2, /* parents passing a dropped detail: unread processes left out; null when publications/ is unknown */
    'opts.teamValues': 5 /* team value names and kinds, and a Jira search's address (site:): undefined when team-values.json is unknown, so none is checked (R4-3) */
  };
  assert.deepStrictEqual(reads, LISTED);
});

rule('Guard, per version: an unreadable older version leaves the latest checked; an unreadable latest is unknown (children, pins, parents)', async () => {
  const kidOld = md({ process: 'kid', title: 'Kid', context: 'commit, ticket' }), kidNew = md({ process: 'kid', title: 'Kid', context: 'commit' });
  const ship = c => md({ process: 'ship', title: 'Ship it', steps: STEP.link('run-deploy', 'deploy', ['  carry: ' + c]) });
  const files = await folder({ publish: [kidOld, kidNew, ship('commit'), ship('commit, ticket')],
    drafts: { deploy: md({ process: 'deploy', context: 'commit, ticket', steps: STEP.link('a', 'kid', ['  carry: ticket']).concat(STEP.link('b', 'kid', ['  version: 2', '  carry: ticket'])) }) } });
  const dir = RF.toDisk(files, tmp()), vf = (proc, n) => path.join(dir, 'publications', proc, fs.readdirSync(path.join(dir, 'publications', proc)).filter(x => x.indexOf('v' + n + '-') === 0)[0]);
  const pins = path.join(tmp(), 'pins.md'), dropped = path.join(tmp(), 'dropped.md');
  fs.writeFileSync(pins, md({ process: 'deploy', steps: STEP.link('c', 'kid', ['  version: 1']).concat(STEP.link('d', 'kid', ['  version: 2']), STEP.link('e', 'kid', ['  version: 3'])) }));
  fs.writeFileSync(dropped, md({ process: 'deploy', context: 'commit' }));
  const ticket = d => d.checks.blockers.filter(b => /no run detail ticket/.test(b)).length;
  const v3 = d => d.publish.blockers.filter(b => /version: 3 can't be pinned/.test(b)).length, pinBl = d => d.publish.blockers.filter(b => /can't be pinned/.test(b)).length;
  const parent = d => d.checks.suggestions.filter(x => /^Ship it/.test(x)).length;
  const base = { a: cli(dir, 'deploy'), p: cli(dir, 'deploy', ['--from', pins]), d: cli(dir, 'deploy', ['--from', dropped]) };
  assert.deepStrictEqual([base.a.code, ticket(base.a.json.data), base.p.code, pinBl(base.p.json.data), v3(base.p.json.data), parent(base.d.json.data)], [0, 2, 0, 1, 1, 1], JSON.stringify(base));
  const wrongs = [];
  const run = (label, want) => { const got = { a: cli(dir, 'deploy'), p: cli(dir, 'deploy', ['--from', pins]), d: cli(dir, 'deploy', ['--from', dropped]) };
    const seen = [got.a.code, ticket(got.a.json.data), got.p.code, pinBl(got.p.json.data), v3(got.p.json.data), got.d.code, parent(got.d.json.data)];
    if (JSON.stringify(seen) !== JSON.stringify(want)) wrongs.push(label + ': ' + JSON.stringify(seen) + ' wanted ' + JSON.stringify(want)); };
  /* [draft exit, ticket blockers, pins exit, pin blockers, v3 blocker, dropped exit, parent tips] */
  locked(vf('kid', 1), () => run('kid v1 unreadable: v2 still checked, the v1 pin unknown', [4, 2, 4, 1, 1, 4, 1]));
  locked(vf('kid', 2), () => run('kid v2 (latest) unreadable: latest and v2 unknown, v1 and v3 still checked', [4, 0, 4, 1, 1, 4, 1]));
  locked(vf('ship', 1), () => run('ship v1 unreadable: its latest still suggests', [4, 2, 4, 1, 1, 4, 1]));
  locked(vf('ship', 2), () => run('ship v2 (latest) unreadable: unknown, no tip', [4, 2, 4, 1, 1, 4, 0]));
  assert.deepStrictEqual(wrongs, []);
});

rule('Guard, unused inputs: a broken input the draft doesn\'t use leaves the answer complete', async () => {
  const dir = await guardFolder(), plain = path.join(tmp(), 'plain.md');
  fs.writeFileSync(plain, ['---', 'process: deploy', 'title: Deploy', 'context: commit', 'roles: lead', '---', '', '## Do it · READ-DO {#do}', '- [!] {confirm} Confirm the work is done @lead {#done}', ''].join('\n'));
  const FD = require(BIN), wrongs = [];
  const check = async (label, rel, way) => {
    const full = path.join(dir, rel), keep = path.join(tmp(), 'kept');
    if (way === 'unreadable') fs.chmodSync(full, 0o000); else { fs.renameSync(full, keep); fs.symlinkSync(keep, full); }
    try { const r = await FD.main(['draft', 'check', dir, 'deploy', '--from', plain, '--json']), j = JSON.parse(r.out); if (r.code !== 0 || !j.complete) wrongs.push(label + ' ' + way + ': exit ' + r.code + ' ' + JSON.stringify(j.problems)); }
    finally { if (way === 'unreadable') fs.chmodSync(full, fs.statSync(full).isDirectory() ? 0o755 : 0o644); else { fs.unlinkSync(full); fs.renameSync(keep, full); } }
  };
  for (const way of ['unreadable', 'link']) {
    await check('people.json, no owner or backup', 'people.json', way);
    await check('team-values.json, no team: value', 'team-values.json', way);
    await check('jira/workflows.json, no Jira step', 'jira/workflows.json', way);
    await check('a team step type no step uses', 'step-types/pick.one.json', way);
    await check('step-types/, only built-in types', 'step-types', way);
  }
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(dir, 'step-types', 'aa.t' + String(i).padStart(3, '0') + '.json'), JSON.stringify({ id: 'aa.t' + String(i).padStart(3, '0'), label: 'T' + i, icon: 'doc', hint: 'x', fields: {} }));
  const r = cli(dir, 'deploy', ['--from', plain]);
  if (r.code !== 0) wrongs.push('step-types over the limit, only built-in types: exit ' + r.code + ' ' + JSON.stringify(r.json.problems));
  assert.deepStrictEqual(wrongs, []);
});

rule('Guard, the draft itself: unreadable or vanished is never checked as empty text and never "not found"; a failure that stops the read keeps its problems', async () => {
  const draft = md({ process: 'deploy' }), dir = RF.toDisk(await folder({ drafts: { deploy: draft } }), tmp()), dp = path.join(dir, 'maps', 'drafts', 'deploy.md');
  const FD = require(BIN), open = fs.openSync, wrongs = [];
  const readCmd = () => JSON.parse(cp.spawnSync(process.execPath, [BIN, 'draft', 'read', dir, 'deploy', '--json'], { encoding: 'utf8' }).stdout);
  locked(dp, () => {
    const r = readCmd();
    if (r.complete !== false || !r.problems.some(p => p.path === 'maps/drafts/deploy.md')) wrongs.push('draft read, unreadable: ' + JSON.stringify(r.problems));
    if (r.checks.blockers.length || r.checks.suggestions.length) wrongs.push('draft read, unreadable: checked as empty text: ' + JSON.stringify(r.checks));
  });
  fs.openSync = function (p) { if (path.resolve(String(p)) === dp) { const e = new Error('ENOENT: no such file or directory'); e.code = 'ENOENT'; throw e; } return open.apply(fs, arguments); };
  let v;
  try { v = await FD.main(['draft', 'check', dir, 'deploy', '--json']); } finally { fs.openSync = open; }
  const vj = JSON.parse(v.out);
  if (v.code === 5 || (vj.error && vj.error.kind === 'not-found') || !(vj.problems || []).some(p => p.path === 'maps/drafts/deploy.md')) wrongs.push('draft check, vanished: exit ' + v.code + ' ' + v.out.slice(0, 300));
  const f = path.join(tmp(), 'in.md'); fs.writeFileSync(f, draft);
  const top = locked(dir, () => cp.spawnSync(process.execPath, [BIN, 'draft', 'check', dir, 'deploy', '--from', f, '--json'], { encoding: 'utf8' }));
  const tj = JSON.parse(top.stdout);
  if (top.status !== 1 || !(tj.problems || []).length) wrongs.push('draft check --from, team folder unlistable: exit ' + top.status + ' ' + top.stdout.slice(0, 300));
  assert.deepStrictEqual(wrongs, []);
});

/* ---------- loader limits: what a loader leaves out is named from its own read, and is unknown ---------- */

rule('Limits: step-types/ is listed once; a failure after that listing still names every problem; what\'s past 100 is named from that one listing', async () => {
  const dir = await guardFolder(), FD = require(BIN), readdir = fs.readdirSync, st = path.join(dir, 'step-types');
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(st, 'aa.t' + String(i).padStart(3, '0') + '.json'), JSON.stringify({ id: 'aa.t' + String(i).padStart(3, '0'), label: 'T' + i, icon: 'doc', hint: 'x', fields: {} }));
  fs.chmodSync(path.join(dir, 'people.json'), 0o000);
  let lists = 0, r;
  fs.readdirSync = function (p) { if (path.resolve(String(p)) === st && ++lists > 1) { const e = new Error('EIO: i/o error, scandir'); e.code = 'EIO'; throw e; } return readdir.apply(fs, arguments); };
  try { r = await FD.main(['draft', 'check', dir, 'deploy', '--json']); } finally { fs.readdirSync = readdir; fs.chmodSync(path.join(dir, 'people.json'), 0o644); }
  const j = JSON.parse(r.out), all = j.data ? j.data.checks.blockers.concat(j.data.checks.suggestions, j.data.publish.blockers) : [];
  assert.strictEqual(lists, 1, 'step-types/ listed ' + lists + ' times');
  assert.deepStrictEqual([r.code, j.complete], [4, false], r.out.slice(0, 600));
  assert.ok(j.problems.some(p => p.path === 'people.json') && j.problems.some(p => p.path === 'step-types/pick.one.json' && p.kind === 'skipped'), JSON.stringify(j.problems));
  assert.ok(!all.some(x => /pick\.one|change\.request|\^literal|unknown type/.test(x)), JSON.stringify(all));
});

rule('Limits: an issue type past Jira\'s 50 is named, and its Jira checks are unknown, never "don\'t describe"', async () => {
  const wf = JSON.parse(example('jira/workflows.json')), big = {};
  for (let i = 0; i < 50; i++) big['Type ' + String(i).padStart(2, '0')] = { statuses: ['Open', 'Done'], transitions: [{ from: 'Open', to: 'Done' }] };
  big.Release = wf.Release;
  const steps = ['- [ ] {jira.issue} Move it @lead {#j1}', '  action: transition', '  issue: ^ticket', '  issueType: Release', '  status: Nowhere'];
  const files = await folder({ base: { 'jira/workflows.json': JSON.stringify(big) }, drafts: { deploy: md({ process: 'deploy', steps }) } });
  const r = cli(RF.toDisk(files, tmp()), 'deploy'), d = r.json.data, all = d.checks.blockers.concat(d.checks.suggestions, d.publish.blockers);
  assert.deepStrictEqual([r.code, r.json.complete], [4, false], JSON.stringify(r.json));
  assert.ok(r.json.problems.some(p => p.path === 'jira/workflows.json' && p.kind === 'skipped' && /Release/.test(p.why)), JSON.stringify(r.json.problems));
  assert.ok(!all.some(x => /Jira|workflow|Release|Nowhere/.test(x)), JSON.stringify(all));
});

/* Every limit a loader the draft check uses applies, each with how draft check names what it leaves out. A new slice(0, N)
   or "> N" limit in one of these readers fails here until it's listed, with its reporting. */
rule('Limits: every cap in the readers draft check uses is listed with how it\'s reported', () => {
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const fn = (text, name) => { const i = text.indexOf('function ' + name + '('); assert.ok(i >= 0, name); let depth = 0, j = text.indexOf('{', i); for (let k = j; k < text.length; k++) { if (text[k] === '{') depth++; else if (text[k] === '}' && --depth === 0) return text.slice(i, k + 1); } return ''; };
  const READERS = [['storage/repo.js', 'loadPeople'], ['storage/repo.js', 'loadStepTypes'], ['storage/repo.js', 'loadWorkflows'], ['storage/repo.js', 'loadPublications'], ['storage/repo.js', 'readTeamValues'],
    ['storage/repo.js', 'readVersion'], ['storage/repo.js', 'checkImages'], ['storage/repo.js', 'verifyExact'], ['core/teamvalues.js', 'valueProblem'],
    ['core/jira.js', 'check'], ['core/teamvalues.js', 'parse'], ['core/teamvalues.js', 'check'], ['core/people.js', 'clean'], ['core/people.js', 'verdict']];
  const found = [];
  READERS.forEach(([f, n]) => { const body = fn(src(f), n).replace(/\/\*[\s\S]*?\*\//g, ''); (body.match(/\.slice\(0, [A-Za-z_.0-9]+\)|\.length > [A-Za-z_.0-9]+|maxBytes: [A-Za-z_.0-9]+/g) || []).forEach(m => found.push(f + ' ' + n + ': ' + m)); });
  const CAPS = {
    'storage/repo.js loadStepTypes: .slice(0, MAX_TYPES)': 'files past the first 100: the loader returns them (over) from its one listing; each is a skipped problem, its type unknown',
    'storage/repo.js readTeamValues: maxBytes: T.MAX_BYTES': 'a bigger file fails its read: the ledger names it, team values unknown',
    'core/jira.js check: .slice(0, 50)': 'issue types past 50: check returns them (over); jira/workflows.json is a skipped problem naming them, workflows unknown',
    'core/jira.js check: .length > 50': 'the same limit, as the app\'s error',
    'core/jira.js check: .length > 300': 'too many transitions: that issue type is kept as invalid, a finding the app shows too',
    'core/jira.js check: .length > 20': 'too many required fields: kept as invalid, a finding the app shows too',
    'core/jira.js check: .length > 60': 'a status or field name too long: kept as invalid, a finding the app shows too',
    'core/jira.js check: .length > 40': 'an option name too long: kept as invalid, a finding the app shows too',
    'core/jira.js check: .length > 30': 'too many field options: kept as invalid, a finding the app shows too',
    'core/jira.js check: .length > e0': 'not a limit: this issue type added errors',
    'core/jira.js check: .slice(0, 300)': 'a message cut to length: nothing is left out',
    'core/jira.js check: .slice(0, 40)': 'a name cut inside a message: nothing is left out',
    'core/jira.js check: .slice(0, 30)': 'options already checked to be at most 30 above: nothing is left out',
    'core/teamvalues.js check: .length > MAX': 'too many values: the whole file is malformed, a finding the app shows too',
    'core/teamvalues.js check: .length > ABOUT_MAX': 'an about too long: malformed, a finding the app shows too',
    'core/teamvalues.js valueProblem: .length > VALUE_MAX': 'a value too long: malformed, a finding the app shows too',
    'core/people.js clean: .slice(0, 60)': 'a name cut for display: no person is left out',
    'core/people.js clean: .slice(0, 3)': 'initials cut for display: no person is left out'
  };
  const counted = found.reduce((o, k) => { o[k] = true; return o; }, {});
  assert.deepStrictEqual(Object.keys(counted).sort(), Object.keys(CAPS).sort(), 'every cap listed, and only those');
  /* And the readers outside src: the command's own byte limits, each a read failure the ledger names. */
  const bin = fs.readFileSync(BIN, 'utf8');
  assert.ok(/readAdapter\(dir, \{ maxBytes: READ_MAX \}\)/.test(fn(bin, 'draftInputs')), 'draftInputs reads under READ_MAX: a bigger file is skipped, named');
});

/* draft save and propose: what couldn't be read is carried into the result; the skills check the text they wrote. */
function draftCmd(args) {
  const r = cp.spawnSync(process.execPath, [BIN, 'draft'].concat(args, ['--json']), { encoding: 'utf8' });
  return { code: r.status, json: JSON.parse(r.stdout) };
}
const sha = t => require('crypto').createHash('sha256').update(t, 'utf8').digest('hex');

rule('draft save and propose carry complete and problems: a part that couldn\'t be read is named, never a finding', async () => {
  const draft = md({ process: 'deploy', steps: STEP.team }), next = md({ process: 'deploy', title: 'Deploy now', steps: STEP.team });
  const dir = RF.toDisk(await folder({ drafts: { deploy: draft } }), tmp()), f = path.join(tmp(), 'next.md');
  fs.writeFileSync(f, next);
  const p = draftCmd(['propose', dir, 'deploy', '--expect', sha(draft), '--from', f]);
  assert.deepStrictEqual([p.code, p.json.outcome, p.json.complete, p.json.problems, p.json.checks.blockers], [0, 'proposed', true, [], []], JSON.stringify(p.json));
  const s = locked(path.join(dir, 'step-types', 'change.request.json'), () => draftCmd(['save', dir, 'deploy', '--expect', sha(draft), '--from', f]));
  assert.deepStrictEqual([s.code, s.json.outcome, s.json.complete], [0, 'written', false], JSON.stringify(s.json));
  assert.ok(s.json.problems.some(x => x.path === 'step-types/change.request.json'), JSON.stringify(s.json.problems));
  assert.ok(!has(s.json.checks.blockers, /unknown type/), JSON.stringify(s.json.checks));
});

rule('The new and edit skills check the text they wrote (draft check --from): a proposal\'s blocker shows, the draft\'s clean check doesn\'t hide it', async () => {
  const skill = n => fs.readFileSync(path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', n, 'SKILL.md'), 'utf8');
  assert.ok(/flightdeck draft check <team folder> <process> --from <your new text> --json/.test(skill('flightdeck-edit-checklist')));
  assert.ok(/flightdeck draft check <team folder> <process> --from <your file> --json/.test(skill('flightdeck-new-checklist')));
  const draft = md({ process: 'deploy' }), dir = RF.toDisk(await folder({ drafts: { deploy: draft } }), tmp()), f = path.join(tmp(), 'mine.md');
  fs.writeFileSync(f, md({ process: 'deploy', steps: ['- [!] {nope.x} Do it @lead {#x}'] }));
  const p = draftCmd(['propose', dir, 'deploy', '--expect', sha(draft), '--from', f]);
  assert.strictEqual(p.json.outcome, 'proposed', JSON.stringify(p.json));
  assert.deepStrictEqual(cli(dir, 'deploy').json.data.checks.blockers, [], 'the draft itself is clean');
  assert.ok(has(cli(dir, 'deploy', ['--from', f]).json.data.checks.blockers, /unknown type \{nope\.x\}/), 'the proposed text has the blocker');
});

rule('draft check: --from checks a file\'s text; usage, no draft and an unreadable draft get the read/2 error shapes', async () => {
  const files = await folder({ drafts: { deploy: md({ process: 'deploy' }) } }), dir = RF.toDisk(files, tmp());
  const f = path.join(tmp(), 'in.md'); fs.writeFileSync(f, md({ process: 'deploy', steps: ['- [!] {nope.x} Do it @lead {#x}'] }));
  const r = cli(dir, 'deploy', ['--from', f]);
  assert.deepStrictEqual([r.code, r.json.data.from.kind, r.json.data.from.ref], [0, 'file', null]);
  assert.ok(has(r.json.data.checks.blockers, /unknown type \{nope\.x\}/) && r.json.data.publish.ok === false);
  const err = (rr, kind, code) => { assert.deepStrictEqual(wrong(rr.json, AJ.SCHEMA2.error), [], 'error shape'); assert.deepStrictEqual([rr.json.error.kind, rr.code, rr.json.contract], [kind, code, 'flightdeck-read/2']); };
  err(cli(dir, 'other'), 'not-found', 5);
  err(cli(dir, 'Bad'), 'usage', 1);
  err(cli(dir, 'other', ['--from', f]), 'usage', 1);
  err(cli(dir, 'deploy', ['--session', 's-x']), 'usage', 1);
  const d = cli(dir, 'deploy').json.data;
  assert.deepStrictEqual([d.from.kind, d.from.ref], ['draft', 'maps/drafts/deploy.md']);
  assert.strictEqual(d.from.rev, require('crypto').createHash('sha256').update(files['maps/drafts/deploy.md'], 'utf8').digest('hex'));
  locked(path.join(dir, 'maps', 'drafts', 'deploy.md'), () => { const rr = cli(dir, 'deploy'); err(rr, 'failed', 1); assert.ok(rr.json.problems.some(p => p.path === 'maps/drafts/deploy.md'), JSON.stringify(rr.json)); });
  const before = JSON.stringify(fs.readdirSync(dir).sort());
  cli(dir, 'deploy');
  assert.strictEqual(JSON.stringify(fs.readdirSync(dir).sort()), before, 'nothing written');
});

rule('draft read gets the same complete checks as draft check, and stays flightdeck-draft/1', async () => {
  const files = await folder({ publish: [example('maps/drafts/check-in.md')], drafts: { deploy: md({ process: 'deploy', owner: 'person-casey', steps: STEP.team.concat(STEP.jiraOk, STEP.link('n', 'check-in', ['  carry: commit'])) }) } });
  const dir = RF.toDisk(files, tmp()), c = cli(dir, 'deploy').json.data;
  const r = JSON.parse(cp.spawnSync(process.execPath, [BIN, 'draft', 'read', dir, 'deploy', '--json'], { encoding: 'utf8' }).stdout);
  assert.strictEqual(r.contract, 'flightdeck-draft/1');
  assert.deepStrictEqual(r.checks, c.checks);
  assert.strictEqual(r.complete, true);
});

/* ======================= flightdeck type save (2.14, slice A2) against repo.saveStepType ======================= */
/* Shared rules: the same verdict, the same first error word for word, and the same bytes. Deliberate differences D1 to D8
   (design section 2.3): each asserts the app's behavior and the command's refusal, by name. */
const FDB = require(BIN);
const T2 = PF.types, U2 = PF.util;
const tdir = (files) => { const d = tmp(); Object.keys(files || {}).forEach((p) => { const f = path.join(d, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, files[p]); }); return d; };
async function tsave(dir, id, body, expect, extra) {
  const inF = path.join(tmp(), 'in.json'); fs.writeFileSync(inF, typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2));
  const r = await FDB.main(['type', 'save', dir, id, '--expect', expect, '--from', inF, '--json'].concat(extra || []));
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(wrong(j, AJ.WRITE1), [], 'flightdeck-write/1');
  return j;
}
async function appSave(files, d) {
  const mem = new PF.fs.MemoryFS('tparity:' + Math.random(), null); mem.reset(Object.assign({}, files || {}));
  try { const r = await PF.repo.saveStepType(mem, JSON.parse(JSON.stringify(d)), null, { expectText: null }); return { ok: !!r.ok, error: null, text: mem.files['step-types/' + d.id + '.json'] ? mem.files['step-types/' + d.id + '.json'].t : null }; }
  catch (e) { return { ok: false, error: e.message, text: null }; }
}
const SHARED = {
  'valid 1.x type': { id: 'sample.check', label: 'Sample', hint: 'A hint', icon: 'doc', group: 'Releases / Checks', tags: ['cab'], fields: { system: { label: 'System', kind: 'text', required: true }, level: { label: 'Level', kind: 'choice', options: ['Low', 'High'] } }, record: [{ name: 'approval', label: 'Approval', kind: 'text', long: true }] },
  'valid 2.0 type': { format: 'flightdeck-step-type/2', features: ['typed-evidence'], id: 'sample.count', label: 'Count', record: [{ name: 'rows', label: 'Rows', kind: 'number', min: '0', unit: 'rows' }, { name: 'ok', label: 'OK', kind: 'yes-no' }] },
  'an unknown top-level key': { id: 'sample.check', label: 'Sample', colour: 'red' },
  'a bad id': { id: 'Sample', label: 'Sample' },
  'a built-in id': { id: 'confirm', label: 'Confirm' },
  'a reserved field name': { id: 'sample.check', label: 'S', fields: { constructor: { label: 'C', kind: 'text' } } },
  'over 30 fields': (() => { const f = {}; for (let i = 0; i < 31; i++) f['f' + i] = { label: 'F', kind: 'text' }; return { id: 'sample.check', label: 'S', fields: f }; })(),
  'over 20 evidence': { id: 'sample.check', label: 'S', record: Array.from({ length: 21 }, (x, i) => ({ name: 'r' + i, label: 'R', kind: 'text' })) },
  'a 2.0 choice whose options clash in capitals': { format: 'flightdeck-step-type/2', features: ['typed-evidence'], id: 'sample.check', label: 'S', record: [{ name: 'n', label: 'N', kind: 'number' }, { name: 'c', label: 'C', kind: 'choice', options: ['Low', 'low'] }] }
};
rule('Type parity, shared rules: the command\'s verdict and first error equal repo.saveStepType\'s; saved bytes are equal; a dry run writes nothing', async () => {
  for (const k of Object.keys(SHARED)) {
    const d = SHARED[k], dir = tdir({}), app = await appSave({}, d);
    const id = typeof d.id === 'string' && T2.ID.test(d.id) ? d.id : 'sample.check';
    const body = Object.assign({}, d); if (id !== d.id) body.id = d.id;
    const dry = await tsave(dir, id, body, 'none', ['--dry-run']);
    assert.deepStrictEqual(fs.readdirSync(dir), [], k + ': a dry run writes nothing');
    const j = await tsave(dir, id, body, 'none');
    if (!T2.ID.test(String(d.id))) { assert.deepStrictEqual([j.outcome, j.error.kind, app.ok], ['refused', 'usage', false], k); continue; }
    assert.strictEqual(j.outcome === 'done', app.ok, k + ': same verdict (' + j.words + ' / ' + app.error + ')');
    assert.strictEqual(dry.outcome === 'checked', app.ok, k + ': dry run verdict');
    if (app.ok) assert.strictEqual(fs.readFileSync(path.join(dir, 'step-types', d.id + '.json'), 'utf8'), app.text, k + ': same bytes');
    else assert.strictEqual(j.words, 'Nothing was changed. This isn\'t a step type Flightdeck can use: ' + app.error, k + ': the first error, word for word');
  }
});
rule('Type parity, D1: a /2 envelope with typed-evidence and no typed evidence: the app saves it, the command refuses invalid (formatWhy)', async () => {
  const d = { format: 'flightdeck-step-type/2', features: ['typed-evidence'], id: 'sample.check', label: 'S' };
  assert.strictEqual((await appSave({}, d)).ok, true, 'the app saves it');
  const j = await tsave(tdir({}), 'sample.check', d, 'none');
  assert.deepStrictEqual([j.outcome, j.error.kind], ['refused', 'invalid']);
  assert.ok(/doesn't use 2\.0 evidence/.test(j.words), j.words);
});
rule('Type parity, D2: a copy beside the target, with or without the target: the app saves anyway and lists the copy as an error; the command refuses copies', async () => {
  const d = { id: 'sample.check', label: 'S' };
  for (const files of [{ 'step-types/sample.check-LAPTOP.json': T2.fileText(d) }, { 'step-types/sample.check (1).json': T2.fileText(d), 'step-types/sample.check.json': T2.fileText(d) }]) {
    const mem = new PF.fs.MemoryFS('d2:' + Math.random(), null); mem.reset(Object.assign({}, files));
    const was = mem.files['step-types/sample.check.json'];
    const r = await PF.repo.saveStepType(mem, { id: 'sample.check', label: 'S2' }, was ? U2.hash(was.t) : null, { expectText: was ? was.t : null });
    assert.ok(r.ok, 'the app saves it');
    const loaded = await PF.repo.loadStepTypes(mem);
    assert.ok(loaded.errors.length >= 1, 'and lists the copy as an error');
    const dir = tdir(files), j = await tsave(dir, 'sample.check', { id: 'sample.check', label: 'S2' }, was ? PF.sha256.hex(was.t) : 'none');
    assert.deepStrictEqual([j.outcome, j.error.kind], ['refused', 'copies']);
  }
});
rule('Type parity, D3: only a BOM changed since the read: the app sees no conflict (decoded text), the command refuses changed', async () => {
  const d = { id: 'sample.check', label: 'S' }, t = T2.fileText(d), dir = tdir({ 'step-types/sample.check.json': t });
  const rev = PF.sha256.hex(t);
  fs.writeFileSync(path.join(dir, 'step-types', 'sample.check.json'), '﻿' + t);
  const mem = new PF.fs.MemoryFS('d3:' + Math.random(), null); mem.reset({ 'step-types/sample.check.json': t });
  const appRead = new TextDecoder('utf-8').decode(fs.readFileSync(path.join(dir, 'step-types', 'sample.check.json')));
  assert.strictEqual(appRead, t, 'the app reads the same text (File.text() drops the BOM)');
  assert.ok((await PF.repo.saveStepType(mem, { id: 'sample.check', label: 'S2' }, U2.hash(t), { expectText: appRead })).ok, 'so its save goes ahead');
  const j = await tsave(dir, 'sample.check', { id: 'sample.check', label: 'S2' }, rev);
  assert.deepStrictEqual([j.outcome, j.error.kind], ['refused', 'changed']);
});
rule('Type parity, D4 and D5: duplicate or odd keys, over 256 KB, or not UTF-8: n/a in the app (the editor builds an object), refused invalid by the command', async () => {
  const dir = tdir({});
  for (const body of ['{"id":"sample.check","label":"A","label":"B"}', '{"id":"sample.check","label":"A","__proto__":{"x":1}}', Buffer.from([0x7b, 0xff, 0x7d]), '{"id":"sample.check","label":"' + 'x'.repeat(262200) + '"}']) {
    const j = await tsave(dir, 'sample.check', body, 'none');
    assert.deepStrictEqual([j.outcome, j.error.kind], ['refused', 'invalid']);
  }
  assert.strictEqual((await appSave({}, JSON.parse('{"id":"sample.check","label":"B"}'))).ok, true, 'the object JSON.parse keeps, the app saves');
});
rule('Type parity, D6: links don\'t work in the folder: the app saves, the command refuses no-links', async () => {
  const d = { id: 'sample.check', label: 'S' };
  assert.strictEqual((await appSave({}, d)).ok, true);
  const link = fs.linkSync;
  fs.linkSync = (a, b) => { if (/\.probe$/.test(b)) { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; } return link(a, b); };
  try { const j = await tsave(tdir({}), 'sample.check', d, 'none'); assert.deepStrictEqual([j.outcome, j.error.kind], ['refused', 'no-links']); } finally { fs.linkSync = link; }
});
rule('Type parity, D8: a JSON array as the definition: checkCustom gives the id and label errors and the app refuses; the command refuses with "must be a JSON object"', async () => {
  for (const body of ['[]', '[{}]']) {
    const errs = JSON.parse(JSON.stringify(T2.checkCustom(JSON.parse(body))));
    assert.ok(/"id"/.test(errs[0]), body);
    const mem = new PF.fs.MemoryFS('d8:' + Math.random(), null);
    await assert.rejects(PF.repo.saveStepType(mem, JSON.parse(body), null, { expectText: null }));
    const j = await tsave(tdir({}), 'sample.check', body, 'none');
    assert.deepStrictEqual([j.outcome, j.error.kind], ['refused', 'invalid']);
    assert.ok(/must be a JSON object/.test(j.words), j.words);
  }
});
rule('Type parity, D7 is Option 1 only: with edits allowed (the owner\'s choice) an existing type is replaced, never refused edits-off', async () => {
  assert.strictEqual(PF.save.MODE, 'edits');
  const d = { id: 'sample.check', label: 'S' }, dir = tdir({ 'step-types/sample.check.json': T2.fileText(d) });
  const j = await tsave(dir, 'sample.check', { id: 'sample.check', label: 'S2' }, PF.sha256.hex(T2.fileText(d)));
  assert.strictEqual(j.outcome, 'done');
});
rule('Type parity, typed-evidence marker: a /2 file with number evidence and "features": [] is saved by both (shared rule) with the command\'s warning; without an envelope both refuse with checkCustom\'s words', async () => {
  const d = { format: 'flightdeck-step-type/2', features: [], id: 'sample.count', label: 'C', record: [{ name: 'n', label: 'N', kind: 'number' }] };
  const app = await appSave({}, d);
  assert.strictEqual(app.ok, true);
  const dir = tdir({}), j = await tsave(dir, 'sample.count', d, 'none');
  assert.strictEqual(j.outcome, 'done');
  assert.ok(j.checks.warnings.some((w) => /typed-evidence/.test(w) && /works without it/.test(w)), JSON.stringify(j.checks.warnings));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'step-types', 'sample.count.json'), 'utf8'), app.text);
  const bare = { id: 'sample.count', label: 'C', record: [{ name: 'n', label: 'N', kind: 'number' }] };
  const a2 = await appSave({}, bare), j2 = await tsave(tdir({}), 'sample.count', bare, 'none');
  assert.ok(!a2.ok && /number evidence needs Flightdeck 2\.0/.test(a2.error));
  assert.strictEqual(j2.words, 'Nothing was changed. This isn\'t a step type Flightdeck can use: ' + a2.error);
});

/* ---------- round trips through the app's own screens (the app harness) ---------- */
async function typesApp(files) {
  const app = boot(); await app.tick(60); app.choose('person-casey'); await app.tick();
  for (const p of Object.keys(files)) await app.fs.write(p, files[p]);
  app.click('refresh'); await app.tick(80);
  app.click('nav', 'types'); await app.tick();
  return app;
}
const diskText = (dir, id) => fs.readFileSync(path.join(dir, 'step-types', id + '.json'), 'utf8');
rule('Type round trip: loadStepTypes loads the command\'s file; the app opens it with Edit and saves over it; the command saves over the app\'s; type read gives the app\'s definition', async () => {
  const d = { id: 'sample.check', label: 'Sample', fields: { system: { label: 'System', kind: 'text' } } }, dir = tdir({});
  assert.strictEqual((await tsave(dir, 'sample.check', d, 'none')).outcome, 'done');
  const mem = new PF.fs.MemoryFS('rt:' + Math.random(), null); mem.reset({ 'step-types/sample.check.json': diskText(dir, 'sample.check') });
  const loaded = await PF.repo.loadStepTypes(mem);
  assert.deepStrictEqual([Object.keys(loaded.types), loaded.errors.length], [['sample.check'], 0]);
  const app = await typesApp({ 'step-types/sample.check.json': diskText(dir, 'sample.check') });
  app.click('edit-type', 'sample.check'); await app.tick(40);
  assert.ok(/<input id="tf-label"[^>]*value="Sample"/.test(app.html()), 'Edit opens it');
  app.input('tf-label', 'Sample, from the app'); await app.tick(20);
  app.submit('type-form'); await app.tick(80);
  const appText = app.fs.files['step-types/sample.check.json'].t;
  assert.ok(/from the app/.test(appText), 'the app saved over it');
  fs.writeFileSync(path.join(dir, 'step-types', 'sample.check.json'), appText);
  const rd = JSON.parse((await FDB.main(['type', 'read', dir, 'sample.check', '--json'])).out);
  assert.deepStrictEqual(rd.data.type.def, JSON.parse(appText));
  const j = await tsave(dir, 'sample.check', Object.assign({}, rd.data.type.def, { label: 'Sample, from the command' }), rd.data.type.rev);
  assert.strictEqual(j.outcome, 'done', 'the command saves over the app\'s');
});
rule('Type round trip: the app\'s editor open during a command save, compare after the commit: its Save shows the conflict, and the person\'s text stays', async () => {
  const d = { id: 'sample.check', label: 'Sample' }, app = await typesApp({ 'step-types/sample.check.json': T2.fileText(d) });
  app.click('edit-type', 'sample.check'); await app.tick(40);
  app.input('tf-label', 'The person\'s text'); await app.tick(20);
  await app.fs.write('step-types/sample.check.json', T2.fileText({ id: 'sample.check', label: 'From the command' }));
  app.submit('type-form'); await app.tick(80);
  assert.ok(/From the command/.test(app.fs.files['step-types/sample.check.json'].t), 'nothing written by the app');
  assert.ok(/type-keep-mine/.test(app.html()), 'the conflict is shown');
  assert.ok(/<input id="tf-label"[^>]*value="The person&#39;s text"|<input id="tf-label"[^>]*value="The person's text"/.test(app.html()), 'the person\'s text stays');
});
rule('Type round trip: a type the app rejects: Edit refuses with "Fix the file, or ask your AI assistant to."; the command\'s repair then makes it open', async () => {
  const bad = '{"id":"sample.check","label":""}', app = await typesApp({ 'step-types/sample.check.json': bad });
  app.click('edit-type', 'sample.check'); await app.tick(40);
  assert.ok(/Fix the file, or ask your AI assistant to\./.test(app.live()), app.live());
  const dir = tdir({ 'step-types/sample.check.json': bad });
  const j = await tsave(dir, 'sample.check', { id: 'sample.check', label: 'Fixed' }, PF.sha256.hex(bad));
  assert.deepStrictEqual([j.outcome, j.existing, j.appLoads], ['done', 'malformed', false]);
  await app.fs.write('step-types/sample.check.json', diskText(dir, 'sample.check'));
  app.click('refresh'); await app.tick(80); app.click('nav', 'types'); await app.tick();
  app.click('edit-type', 'sample.check'); await app.tick(40);
  assert.ok(/<input id="tf-label"[^>]*value="Fixed"/.test(app.html()), 'it opens now');
});

/* ---------- the skill's fallback routes, after a real no-links refusal ---------- */
async function noLinks(dir, id, body, expect) {
  const link = fs.linkSync;
  fs.linkSync = (a, b) => { if (/\.probe$/.test(b)) { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; } return link(a, b); };
  try { return await tsave(dir, id, body, expect); } finally { fs.linkSync = link; }
}
const NEWDEF = { id: 'sample.check', label: 'Fixed by a person' };
rule('Fallback routes: missing: New type, Save creates it', async () => {
  const j = await noLinks(tdir({}), 'sample.check', NEWDEF, 'none');
  assert.deepStrictEqual([j.error.kind, j.existing, j.appLoads], ['no-links', 'missing', null]);
  const app = await typesApp({});
  app.click('new-type'); await app.tick();
  app.input('tf-id', 'sample.check'); app.input('tf-label', 'Fixed by a person'); await app.tick(20);
  app.submit('type-form'); await app.tick(80);
  assert.ok(app.fs.files['step-types/sample.check.json'], 'created');
});
rule('Fallback routes: valid (appLoads true): Edit, Save changes it', async () => {
  const t = T2.fileText({ id: 'sample.check', label: 'Sample' }), j = await noLinks(tdir({ 'step-types/sample.check.json': t }), 'sample.check', NEWDEF, PF.sha256.hex(t));
  assert.deepStrictEqual([j.error.kind, j.existing, j.appLoads], ['no-links', 'ok', true]);
  const app = await typesApp({ 'step-types/sample.check.json': t });
  app.click('edit-type', 'sample.check'); await app.tick(40);
  app.input('tf-label', 'Fixed by a person'); await app.tick(20);
  app.submit('type-form'); await app.tick(80);
  assert.ok(/Fixed by a person/.test(app.fs.files['step-types/sample.check.json'].t));
});
rule('Fallback routes: the 0xFF-label file (existing malformed, appLoads true): the route is Edit, and Edit, Save succeeds; New type with that ID stops at "There\'s already a step type"', async () => {
  const ff = Buffer.concat([Buffer.from('{"id":"sample.check","label":"Bad '), Buffer.from([0xff]), Buffer.from('"}\n')]);
  const j = await noLinks(tdir({ 'step-types/sample.check.json': ff }), 'sample.check', NEWDEF, PF.sha256.hex(ff));
  assert.deepStrictEqual([j.error.kind, j.existing, j.appLoads], ['no-links', 'malformed', true]);
  const rd = JSON.parse((await FDB.main(['type', 'read', tdir({ 'step-types/sample.check.json': ff }), 'sample.check', '--json'])).out).data.type;
  assert.deepStrictEqual([rd.state, rd.usable], ['malformed', true]);
  const asApp = new TextDecoder('utf-8').decode(ff);
  const app = await typesApp({ 'step-types/sample.check.json': asApp });
  app.click('new-type'); await app.tick();
  app.input('tf-id', 'sample.check'); app.input('tf-label', 'Another'); await app.tick(20);
  app.submit('type-form'); await app.tick(80);
  assert.ok(/There's already a step type \{sample\.check\}/.test(app.live()), app.live());
  app.click('type-cancel'); await app.tick();
  app.click('edit-type', 'sample.check'); await app.tick(40);
  app.input('tf-label', 'Fixed by a person'); await app.tick(20);
  app.submit('type-form'); await app.tick(80);
  assert.ok(/Fixed by a person/.test(app.fs.files['step-types/sample.check.json'].t), 'Edit, Save succeeded');
});
rule('Fallback routes: invalid JSON (appLoads false): New type with the same ID, Save, conflict, Keep mine replaces it, with a keep-mine history line', async () => {
  const bad = '{"id": "sample.check", ', j = await noLinks(tdir({ 'step-types/sample.check.json': bad }), 'sample.check', NEWDEF, PF.sha256.hex(bad));
  assert.deepStrictEqual([j.error.kind, j.existing, j.appLoads], ['no-links', 'malformed', false]);
  const app = await typesApp({ 'step-types/sample.check.json': bad });
  app.click('new-type'); await app.tick();
  app.input('tf-id', 'sample.check'); app.input('tf-label', 'Fixed by a person'); await app.tick(20);
  app.submit('type-form'); await app.tick(80);
  assert.ok(/type-keep-mine/.test(app.html()), 'the new-type save conflicts with the file');
  app.click('type-keep-mine'); await app.tick(120);
  const now = JSON.parse(app.fs.files['step-types/sample.check.json'].t);
  assert.strictEqual(now.label, 'Fixed by a person');
  for (let i = 0; i < 40 && !Object.keys(app.fs.files).some((p) => /^history\/step-types\/sample\.check\//.test(p)); i++) await app.tick(50);
  const lines = Object.keys(app.fs.files).filter((p) => /^history\/step-types\/sample\.check\//.test(p)).map((p) => app.fs.files[p].t).join('').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.source === 'keep-mine'), JSON.stringify(lines));
});
rule('Fallback routes: past the 100-file limit (appLoads false, not selected), and newer: the output says so and the skill says stop', async () => {
  const files = {}; for (let i = 0; i < 100; i++) files['step-types/a' + String(i).padStart(3, '0') + '.json'] = T2.fileText({ id: 'a' + String(i).padStart(3, '0'), label: 'A' });
  const t = T2.fileText({ id: 'zz.check', label: 'Z' }); files['step-types/zz.check.json'] = t;
  const j = await noLinks(tdir(files), 'zz.check', { id: 'zz.check', label: 'Z2' }, PF.sha256.hex(t));
  assert.deepStrictEqual([j.error.kind, j.existing, j.appLoads], ['no-links', 'ok', false]);
  const n = '{"format":"flightdeck-step-type/9","id":"sample.check","label":"X"}', k = await noLinks(tdir({ 'step-types/sample.check.json': n }), 'sample.check', NEWDEF, PF.sha256.hex(n));
  assert.deepStrictEqual([k.error.kind, k.existing], ['newer', 'newer'], 'newer is refused before any write is tried');
  const skill = fs.readFileSync(path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', 'flightdeck-new-step-type', 'SKILL.md'), 'utf8');
  assert.ok(/past the 100-file limit[^\n]*Stop/i.test(skill) && /`existing: newer`[^\n]*Stop[^\n]*Never offer New type/i.test(skill), 'the skill says stop for both');
});

/* ---------- Python: the folder checker agrees on what the command writes (design 6.3) ---------- */
rule('Type parity, Python team_files: agrees on every command-written file; a BOM and checkCustom-only rejections are the asserted differences', async () => {
  let py = null; for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); py = c; break; } catch (e) { /* next */ } }
  if (!py) return;
  const checker = path.join(__dirname, '..', 'example-folder', '.flightdeck', 'skills', '_flightdeck');
  const team = (dir) => JSON.parse(cp.execFileSync(py, ['-I', '-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import check_folder as c; print(json.dumps(c.team_files(sys.argv[2])))', checker, dir], { encoding: 'utf8' }));
  const dir = tdir({});
  for (const k of ['valid 1.x type', 'valid 2.0 type']) assert.strictEqual((await tsave(dir, SHARED[k].id, SHARED[k], 'none')).outcome, 'done', k);
  const out = team(dir);
  assert.deepStrictEqual([out.stepTypes.sort(), out.problems], [['sample.check', 'sample.count'], []], 'agreement on the command\'s files');
  const bom = tdir({ 'step-types/a.b.json': '﻿' + T2.fileText({ id: 'a.b', label: 'A' }) });
  assert.strictEqual(JSON.parse((await FDB.main(['type', 'read', bom, 'a.b', '--json'])).out).data.type.state, 'ok', 'the command accepts a BOM');
  assert.deepStrictEqual(team(bom).problems.map((p) => p.problem), ['isn\'t valid JSON'], 'Python says it isn\'t valid JSON');
  const only = tdir({ 'step-types/a.b.json': '{"id":"a.b","label":""}' });
  assert.deepStrictEqual(team(only).stepTypes, ['a.b'], 'Python lists a type only checkCustom rejects');
  assert.strictEqual(JSON.parse((await FDB.main(['type', 'read', only, 'a.b', '--json'])).out).data.type.state, 'malformed', 'the command calls it malformed');
});

/* ---------- 3.0: the library and design tips, the same in the app and through the command ---------- */

const RELEASE_PUB = ['---', 'process: release', 'title: Release', 'owner: person-avery', 'context: version, commit, ticket', 'roles: lead', '---', '', '## Scope · DO-CONFIRM {#scope}',
  '- [ ] {jira.search} The release has stories @lead {#stories}', '  query: project = PAY AND fixVersion = ^version', '  results: at least 1',
  '- [ ] {run.process} Check in the code @lead {#notes}', '  process: check-in', '  carry: commit', '',
  '## Gate: Release approved · owner @lead {#approved}', '  approves: release of ^version', ''].join('\n');
const DEPLOY_DRAFT = md({ process: 'deploy', context: 'fix_version', steps: ['- [!] {confirm} All stories are done @lead {#all}', '- [ ] {jira.search} Stories in the version @lead {#in}', '  query: PROJECT = PAY and FIXVERSION = ^fix_version', '  results: at least 1'] });
const JIRA_TV = JSON.stringify({ format: 'flightdeck-team-values/1', values: { 'jira-base-url': { value: 'https://jira.example.com' } } });
function libCli(dir, more) {
  const r = cp.spawnSync(process.execPath, [BIN, 'library', 'inspect', dir].concat(more || []), { encoding: 'utf8', maxBuffer: 64 * 1048576 });
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* asserted below */ }
  assert.ok(json, 'JSON on stdout: ' + r.stdout + r.stderr);
  if (!json.error) {
    assert.deepStrictEqual(wrong(json, AJ.SCHEMA2.envelope), [], 'envelope');
    assert.deepStrictEqual(wrong(json.data, AJ.SCHEMA2.library), [], 'SCHEMA2.library');
    assert.strictEqual(json.contract, 'flightdeck-read/2');
    assert.strictEqual(r.status === 4, !json.complete, 'exit 4 exactly when partial (exit ' + r.status + ')');
  }
  return { code: r.status, json };
}
function treeOf(dir) {
  const out = {};
  (function walk(d) { fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8'); }); })(dir);
  return out;
}

rule('Library: flightdeck library inspect reads every checklist read-only: links, step types, skills and overlaps with their reasons', async () => {
  const files = await folder({ base: { 'team-values.json': JIRA_TV }, publish: [example('maps/drafts/check-in.md'), RELEASE_PUB], drafts: { deploy: DEPLOY_DRAFT } });
  const dir = RF.toDisk(files, tmp()), before = treeOf(dir);
  const r = libCli(dir, ['--json']);
  assert.strictEqual(r.code, 0, JSON.stringify(r.json.problems));
  const d = r.json.data;
  assert.deepStrictEqual(d.checklists.map(c => c.process + ':' + c.source).sort(), ['check-in:publication', 'deploy:draft', 'release:publication']);
  assert.deepStrictEqual(d.usedBy, [{ process: 'check-in', by: { process: 'release', source: 'publication', step: 'notes', version: null } }]);
  assert.deepStrictEqual(d.overlaps.filter(o => o.kind === 'search').map(o => o.reason + ': ' + o.items.map(x => x.process + '#' + x.id).join(' ')), ['same normalized JQL: release#stories deploy#in']);
  assert.ok(d.stepTypes.some(t => t.id === 'change.request' ? false : t.id === 'run.process' && t.usedBy[0].process === 'release'));
  assert.strictEqual(d.completeness.complete, true);
  assert.deepStrictEqual(treeOf(dir), before, 'nothing in the folder changed');
  const one = libCli(dir, ['--process', 'check-in', '--json']).json.data;
  assert.deepStrictEqual(one.checklists.map(c => c.process), ['check-in']);
  assert.strictEqual(one.usedBy.length, 1, 'the link to it stays');
  assert.strictEqual(libCli(dir, ['--process', 'nope', '--json']).code, 5);
  const noJson = libCli(dir, []);
  assert.strictEqual(noJson.code, 1); assert.strictEqual(noJson.json.error.kind, 'usage');
});

rule('Library: a version that can\'t be read makes the answer partial and is named; it never reads as "nothing similar"', async () => {
  const files = await folder({ base: { 'team-values.json': JIRA_TV }, publish: [example('maps/drafts/check-in.md'), RELEASE_PUB], drafts: { deploy: DEPLOY_DRAFT } });
  const dir = RF.toDisk(files, tmp()), pubDir = path.join(dir, 'publications', 'release'), v = fs.readdirSync(pubDir)[0];
  locked(path.join(pubDir, v, 'map.md'), () => {
    const r = libCli(dir, ['--json']);
    assert.strictEqual(r.code, 4, JSON.stringify(r.json.problems));
    assert.strictEqual(r.json.data.completeness.complete, false);
    assert.ok(r.json.data.completeness.unread.some(u => /^publications\/release\//.test(u.path)), JSON.stringify(r.json.data.completeness));
    assert.ok(/can't be ruled out/.test(r.json.data.completeness.note));
    const c = cli(dir, 'deploy');
    assert.strictEqual(c.json.data.design.library.complete, false);
    assert.ok(c.json.data.design.tips.some(t => t.id === 'library-unread'), JSON.stringify(c.json.data.design));
  });
});

rule('Parity: design tips in draft check are the ones the checklist page shows; Used by and Similar match library inspect', async () => {
  const files = await folder({ base: { 'team-values.json': JIRA_TV }, publish: [example('maps/drafts/check-in.md'), RELEASE_PUB], drafts: { deploy: DEPLOY_DRAFT } });
  const dir = RF.toDisk(files, tmp()), c = cli(dir, 'deploy');
  const tips = c.json.data.design.tips.map(t => t.text);
  assert.ok(tips.some(t => /confirms a whole set at once/.test(t)) && tips.some(t => /runs the same search as Release \{#stories\}/.test(t)), JSON.stringify(tips));
  assert.strictEqual(c.json.data.design.library.complete, true);
  const app = boot({ picker: folderHandle('Team', Object.assign({}, files)), indexedDB: memoryIDB() }); await app.tick(60);
  app.click('connect'); await app.tick(200);
  app.choose('person-avery'); await app.tick();
  app.click('open-process', 'deploy'); await app.tick();
  let html = app.html();
  const block = /<ul class="checks" aria-labelledby="tips-ov-h">([\s\S]*?)<\/ul>/.exec(html);
  assert.ok(block, 'the page draws the design tips');
  assert.deepStrictEqual([...block[1].matchAll(/<span class="lvl tip">Tip<\/span><span>([\s\S]*?)<\/span><\/li>/g)].map(m => unesc(m[1])), tips, 'the same tips, in the same order');
  assert.ok(/Same Jira search<\/b>: \{#in\} here and <\/span><button type="button" class="link" data-act="go" data-view="process" data-process="release" data-step="stories">Release \{#stories\}/.test(html), 'Similar in other checklists');
  app.click('open-process', 'check-in'); await app.tick();
  html = app.html();
  assert.ok(/data-process="release" data-step="notes">Release<\/button> <span>step \{#notes\}, follows the latest version/.test(html), 'Used by, as library inspect says it');
  /* Step types name the checklists that use each type, as library inspect's stepTypes does for published ones. */
  const lib = libCli(dir, ['--json']).json.data;
  app.click('open-types'); await app.tick();
  html = app.html();
  ['jira.search', 'run.process', 'confirm'].forEach((id) => {
    const want = (lib.stepTypes.find(t => t.id === id) || { usedBy: [] }).usedBy.filter(u => u.source === 'publication').map(u => u.process).sort();
    const m = new RegExp('data-disc="type-in:' + id.replace('.', '\\.') + '"[^>]*><summary class="small">Which checklists</summary><ul class="small">([\\s\\S]*?)</ul>').exec(html);
    assert.ok(m, id + ': the card lists its checklists');
    assert.deepStrictEqual([...m[1].matchAll(/data-process="([^"]+)"/g)].map(x => x[1]).sort(), want, id);
  });
});

run();
