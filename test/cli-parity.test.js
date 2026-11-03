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

run();
