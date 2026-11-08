// The library view (3.0): every checklist read into one shape, what links to what, what looks alike across checklists, and
// the design tips a draft gets. Advice only: nothing here blocks publishing.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');
const PF = load(), L = PF.library, M = PF.map;
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

const md = (head, lines) => ['---'].concat(head, ['---', '']).concat(lines).join('\n') + '\n';
const pubOf = (text, version) => ({ info: { version: version || 1, folder: 'v' + (version || 1) + '-abcd' }, map: M.parse(text), types: {} });
const RELEASE = md(['process: release', 'title: Release', 'context: version, env', 'roles: lead, qa'], [
  '## Scope · DO-CONFIRM {#scope}',
  '- [ ] {jira.search} The release has stories @lead {#stories}', '  query: project = PAY AND fixVersion = ^version ORDER BY rank', '  results: at least 1',
  '- [ ] {run.process} Validate each story @qa {#validate}', '  process: story-check', '  version: 3', '  carry: version',
  '- [ ] {jenkins.job} Deploy ^version to ^env @lead {#deploy}', '  job: deploy-prod',
  '## Gate: Release approved · owner @lead {#approved}', '  approves: release of ^version to ^env', '']);
const CLEANUP = md(['process: cleanup', 'title: Sprint cleanup', 'context: fix_version'], [
  '## Look · DO-CONFIRM {#look}',
  '- [ ] {jira.search} Stories in the version {#in}', '  query: PROJECT  =  PAY and FIXVERSION = ^fix_version', '  results: any',
  '- [ ] {jenkins.job} Run the deploy job {#job}', '  job: Deploy-Prod',
  '## Gate: Done {#done}', '  approves: Release of ^fix_version to   ^target', '']);
const STORY = md(['process: story-check', 'title: Story check', 'context: version'], ['## Check · READ-DO {#check}', '- [ ] {confirm} Read the story ^version {#read}', '']);

function procs() {
  return [
    { id: 'release', latest: pubOf(RELEASE, 4), draft: null, draftChanged: false, skills: [{ skill: { name: 'release-runner', implements: 4, steps: ['stories'] }, status: { s: 'current' } }] },
    { id: 'cleanup', latest: null, draft: { file: 'cleanup.md', md: CLEANUP }, draftChanged: true, skills: [] },
    { id: 'story-check', latest: pubOf(STORY, 3), draft: null, draftChanged: false, skills: [] }
  ];
}

rule('A query is compared as Jira reads it: case, spacing, detail names and ORDER BY don\'t count; quoted values do', () => {
  assert.strictEqual(L.normQuery('project = PAY AND fixVersion = ^version ORDER BY rank'), 'project = pay and fixversion = ^?');
  assert.strictEqual(L.normQuery('PROJECT  =  PAY and FIXVERSION = ^fix_version'), 'project = pay and fixversion = ^?');
  assert.strictEqual(L.normQuery('status IN (Done,"In Review")'), 'status in (done, "In Review")');
  assert.notStrictEqual(L.normQuery('summary ~ "Login"'), L.normQuery('summary ~ "login"'), 'a quoted value is kept as written');
  assert.strictEqual(L.normQuery('project = "PAY'), null, 'a query that doesn\'t lex is never "the same"');
  assert.strictEqual(L.normApproves('Release of **^fix_version** to   ^target'), 'release of ^? to ^?');
});

rule('Inspect: each checklist normalized with its steps, searches, gates, children and pins, types and skills; a draft that differs is listed as a draft', () => {
  const lib = L.inspect(procs(), []);
  same(lib.checklists.map(c => c.process + ':' + c.source + ':' + c.version), ['release:publication:4', 'cleanup:draft:null', 'story-check:publication:3']);
  const rel = lib.checklists[0];
  same(rel.context, [{ name: 'version', type: 'text' }, { name: 'env', type: 'text' }]);
  same(rel.searches, [{ step: 'stories', query: 'project = PAY AND fixVersion = ^version ORDER BY rank', filter: null, normalized: 'project = pay and fixversion = ^?', results: 'at least 1', site: 'jira-base-url' }]);
  same(rel.children, [{ step: 'validate', process: 'story-check', version: 3, pass: [], carry: ['version'] }]);
  same(rel.gates, [{ id: 'approved', phase: 'scope', title: 'Release approved', implicit: false, owner: 'lead', approves: 'release of ^version to ^env', pattern: 'release of ^? to ^?' }]);
  same(rel.types, ['jira.search', 'run.process', 'jenkins.job']);
  same(rel.skills, [{ name: 'release-runner', implements: 4, steps: ['stories'], status: 'current' }]);
  same(lib.usedBy, [{ process: 'story-check', by: { process: 'release', source: 'publication', step: 'validate', version: 3 } }]);
  same(lib.stepTypes.find(t => t.id === 'jenkins.job').usedBy, [{ process: 'release', source: 'publication', steps: ['deploy'] }, { process: 'cleanup', source: 'draft', steps: ['job'] }]);
  assert.strictEqual(lib.completeness.complete, true);
});

rule('Overlaps are candidates with a reason: the same normalized JQL, the same type and fields, the same gate approves pattern; never within one checklist', () => {
  const lib = L.inspect(procs(), []);
  same(lib.overlaps.map(o => o.kind + ': ' + o.reason + ': ' + o.items.map(x => x.process + '#' + x.id).join(' ')), [
    'search: same normalized JQL: release#stories cleanup#in',
    'step: same type and fields: release#deploy cleanup#job',
    'gate: same gate approves pattern: release#approved cleanup#done']);
  const p = procs(); p[1].draft.md = p[1].draft.md.replace('{#done}', '{#done}').replace('cleanup', 'release').replace('Sprint cleanup', 'Release');
  p[1].id = 'release';
  assert.strictEqual(L.inspect([p[0], p[1]], []).overlaps.length, 0, 'a draft and its own publication are one checklist');
  const mine = L.forProcess(lib, 'cleanup');
  same(mine.similar.map(x => x.kind + ' ' + x.mine + ' ~ ' + x.process + '#' + x.id), ['search in ~ release#stories', 'step job ~ release#deploy', 'gate done ~ release#approved']);
  same(L.forProcess(lib, 'story-check').usedBy.map(e => e.by.process + '#' + e.by.step + ' v' + e.by.version), ['release#validate v3']);
});

rule('An incomplete read never reads as "nothing similar": the unread parts are named and the note says overlaps can\'t be ruled out', () => {
  const lib = L.inspect(procs(), [{ process: 'payments', path: 'publications/payments/v2-x/', why: 'couldn\'t be read' }]);
  assert.strictEqual(lib.completeness.complete, false);
  same(lib.completeness.unread, [{ process: 'payments', path: 'publications/payments/v2-x/', why: 'couldn\'t be read' }]);
  assert.ok(/can't be ruled out/.test(lib.completeness.note));
  const f = L.forProcess(lib, 'story-check');
  assert.ok(!f.complete && /can't be ruled out/.test(f.note));
  assert.ok(L.lints(STORY, { library: lib, process: 'story-check' }).some(t => t.id === 'library-unread'), 'the draft tips say it too');
});

const ids = (text, o) => L.lints(text, o).map(t => t.id + (t.ref ? '#' + t.ref : ''));
const tip = (text, id, o) => L.lints(text, o).filter(t => t.id === id).map(t => t.text);

rule('Tip: a search with an explicit results: any that reads like a readiness check', () => {
  const t = md(['process: x', 'title: X'], ['## S {#s}', '- [ ] {jira.search} No open blockers {#b}', '  query: priority = Blocker', '  results: any', '- [ ] {jira.search} List the stories {#l}', '  query: a = 1', '  results: any', '- [ ] {jira.search} No open bugs {#n}', '  query: a = 2', '  results: none', '- [ ] {jira.search} No open tasks {#u}', '  query: a = 3', '']);
  same(ids(t).filter(x => /^results-any/.test(x)), ['results-any#b'], 'collecting facts, a real rule and a left-out results: line get nothing');
  assert.strictEqual(tip(t, 'results-any')[0], 'Step "No open blockers" {#b} has results: any, so it passes whatever the search finds, yet it reads like a readiness check ("No open blockers"). Say what must be true, like results: none or results: at least 1, or word it as collecting facts.');
});

rule('Tip: one confirm over a whole collection suggests one result per item, and points to {for.each}', () => {
  const t = md(['process: x', 'title: X'], ['## S {#s}', '- [ ] {confirm} Each blocker is grouped by owner {#g}', '- [ ] {confirm} All stories are done {#a}', '- [ ] {confirm} Tag the release {#t}', '- [ ] {jira.issue} Every ticket linked {#j}', '']);
  same(ids(t).filter(x => /^whole-set/.test(x)), ['whole-set#g', 'whole-set#a']);
  assert.ok(/^Step "All stories are done" \{#a\} confirms a whole set at once \("All stories…"\)\. One check can't show which items were looked at\. Give each item its own result: a \{for\.each\} step that starts one run per item, or one step per item when the list is short and fixed\.$/.test(tip(t, 'whole-set')[1]), tip(t, 'whole-set')[1]);
});

rule('Tip: a verdict not on a decide step or a gate', () => {
  const t = md(['process: x', 'title: X'], ['## S {#s}', '- [ ] {confirm} Mark the release READY or NOT READY {#v}', '- [ ] {decide} READY or NOT READY {#d}', '  options: READY, NOT READY', '- [ ] {review} Approve the design doc {#r}', '- [ ] {communicate} Share the go/no-go call {#c}', '- [ ] {confirm} Approve the change {#p}', '- [ ] {confirm} Ready the servers {#lower}', '']);
  same(ids(t).filter(x => /^verdict/.test(x)), ['verdict#v', 'verdict#c', 'verdict#p']);
  assert.ok(/^Step "Mark the release READY or NOT READY" \{#v\} reads like a verdict \("READY"\), but as a \{confirm\} step a run records only that it was checked, not which way it went\. Make it a \{decide\} step with the choices, or a named gate when a person approves it\.$/.test(tip(t, 'verdict')[0]), tip(t, 'verdict')[0]);
});

rule('Tip: runs: solo with more than one role at work; declared roles and run details nobody uses', () => {
  const t = md(['process: x', 'title: X', 'runs: solo', 'roles: lead, qa, spare', 'context: version, ticket, unused, made'], ['## S {#s}', '- [ ] {confirm} Check ^version @lead {#a}', '- [ ] {confirm} Note it @qa {#b}', '  link: https://example.com/^ticket', '- [ ] {confirm} Make it {#m}', '  sets: made', '## Gate: G · owner @lead {#g}', '']);
  same(ids(t).filter(x => /^(solo|unused)/.test(x)), ['solo-roles', 'unused-role', 'unused-detail']);
  same(tip(t, 'unused-role'), ['The role @spare is declared but no step or gate uses it. Use it or take it out of roles.']);
  same(tip(t, 'unused-detail'), ['The run detail ^unused is asked for at the start but no step, gate or condition uses it. Use it or take it out of context.']);
  assert.strictEqual(tip(t, 'solo-roles')[0], 'This checklist says runs: solo, but its steps and gates use 2 roles (@lead, @qa). If more than one person does the work, take out runs: solo. A solo run that hands a report to someone is fine.');
  const linked = t.replace('- [ ] {confirm} Make it {#m}', '- [ ] {run.process} Hand off {#h}\n  process: other\n- [ ] {confirm} Make it {#m}');
  assert.ok(!ids(linked).some(x => x === 'unused-detail'), 'a linked step without carry: passes every detail its child has');
});

rule('Tip: a search or gate another checklist already has, named with where', () => {
  const lib = L.inspect(procs(), []);
  const t = CLEANUP;
  same(L.lints(t, { library: lib, process: 'cleanup' }).filter(x => x.id === 'duplicate').map(x => x.text), [
    'Step "Stories in the version" {#in} runs the same search as Release {#stories}. If both need it, consider one shared checklist both link to; otherwise say in a note how they differ.',
    'Gate "Done" approves the same thing as Release {#approved}. Check whether one approval should serve both.']);
  assert.ok(!L.lints(t, {}).some(x => x.id === 'duplicate' || x.id === 'library-unread'), 'without the library, no duplicate tip and no claim');
});

rule('A role or run detail named with pattern characters never stops the tips: each name is matched as written', () => {
  const t = md(['process: x', 'title: X', 'roles: lead(, qa', 'context: env(, tag'], ['## S {#s}', '- [ ] {confirm} Check ^tag @qa {#a}', '']);
  let got; assert.doesNotThrow(() => { got = ids(t); });
  assert.ok(got.every(x => /^(unused-role|unused-detail)$/.test(x)), JSON.stringify(got));
});

rule('Tip: a verdict on a step that records which way it went (a required choice or yes/no) is no misplaced verdict', () => {
  const t = md(['process: x', 'title: X'], ['## S {#s}', '- [ ] {review} Review the READY or NOT READY verdict {#r}', '  document: https://example.com/d', '  require: verdict',
    '- [ ] {review} Review the READY call {#o}', '  document: https://example.com/d', '- [ ] {confirm} Say READY or NOT READY {#y}', '  evidence: yes-no', '- [ ] {review} Approve: READY {#all}', '  require: all', '']);
  same(ids(t).filter(x => /^verdict/.test(x)), ['verdict#o'], 'a review whose verdict isn\'t required can still be checked without one');
});

rule('Inspect: a draft with a line Flightdeck doesn\'t understand keeps what it read, and the library says it\'s partial', () => {
  const p = procs(); p[1].draft.md = CLEANUP.replace('## Gate: Done {#done}', 'stray line\n## Gate: Done {#done}');
  const lib = L.inspect(p, []);
  assert.ok(lib.checklists.some(c => c.process === 'cleanup' && c.source === 'draft' && c.searches.length === 1), 'what it read is kept');
  assert.strictEqual(lib.completeness.complete, false);
  same(lib.completeness.unread.map(u => u.process + ' ' + u.path), ['cleanup maps/drafts/cleanup.md']);
  assert.ok(/Line \d+/.test(lib.completeness.unread[0].why), lib.completeness.unread[0].why);
  same(L.inspect(p, [{ process: 'cleanup', path: 'maps/drafts/cleanup.md', why: 'named already' }]).completeness.unread.length, 1, 'named once');
});

rule('Inspect: versions that clash leave a checklist out, so the library says it\'s partial; a type that isn\'t known is neither built-in nor the team\'s', () => {
  const p = procs(); p[0] = { id: 'release', latest: null, all: [], clashes: [4], draft: null, draftChanged: false, skills: [] };
  const lib = L.inspect(p, []);
  assert.strictEqual(lib.completeness.complete, false);
  same(lib.completeness.unread.map(u => u.process + ' ' + u.path), ['release publications/release/']);
  assert.ok(/v4/.test(lib.completeness.unread[0].why), lib.completeness.unread[0].why);
  const q = procs(); q[0].clashes = [2];
  assert.strictEqual(L.inspect(q, []).completeness.complete, true, 'an older clash under a usable latest leaves nothing out');
  const r = procs(); r[1].draft.md = CLEANUP.replace('{jenkins.job} Run the deploy job', '{t100} Run the deploy job');
  const c = L.inspect(r, []).checklists.find(x => x.process === 'cleanup');
  same([c.types.indexOf('t100'), c.teamTypes.indexOf('t100'), c.unknownTypes], [-1, -1, ['t100']]);
});

rule('Design tips are advice: a checklist with every tip still publishes', () => {
  const t = md(['process: x', 'title: X', 'runs: solo', 'roles: lead, qa'], ['## S · READ-DO {#s}', '- [!] {confirm} All stories are READY @lead {#a}', '- [ ] {jira.search} No blockers @qa {#b}', '  query: a = 1', '  results: any', '']);
  assert.ok(L.lints(t).length >= 4);
  same(M.check(M.parse(t), {}).blockers, []);
});

run();
