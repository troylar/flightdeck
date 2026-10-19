// Search (docs/design.md section 22): the index is built from what the app accepted, each document knows where it came from
// and what its contents were, names come from side indexes, and highlights point at the original text.
'use strict';
const assert = require('assert');
const { load, rule, run } = require('./harness');

const PF = load(), S = PF.search;
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

/* A small accepted state, as the app hands it over: runs with their notes, people, and nothing else unless a test adds it. */
function run1(o) {
  return Object.assign({ format: 'preflight-run/2', id: 'r1', process: 'release', version: 3, folder: 'v3-abcd1234', title: 'Release 2026.10.16', details: { ticket: 'ABC-123' },
    recorder: { person: 'person-avery', session: null }, roles: {}, steps: {}, gates: {}, followUps: [], created: '2026-10-16T09:00:00.000Z', state: 'running', ended: null,
    _fileHash: 'aaaa0001', _notes: [] }, o || {});
}
function note(o) { return Object.assign({ id: 'n1', at: '2026-10-16T09:10:00.000Z', by: 'person-blake', session: 'w1', step: 'pods', text: 'Pods restarted twice', files: [], fileInfo: {} }, o || {}); }
const PEOPLE = [{ id: 'person-avery', name: 'Avery Example' }, { id: 'person-blake', name: 'Blake Example' }];
function input(o) { return Object.assign({ runs: [], people: PEOPLE, pubs: [], drafts: [], skills: [], stepTypes: {}, corrDecisions: [], followUps: [] }, o || {}); }
function built(inp) { const ix = S.create(); S.sync(ix, S.docs(inp), inp); return ix; }
const ids = res => res.groups.reduce((a, g) => a.concat(g.items.map(x => x.id)), []);
const kinds = res => res.groups.reduce((a, g) => a.concat(g.items.map(x => x.kind)), []);

rule('Search: a note replaced with different text, with the same number of notes, is found by its new words and not its old ones', () => {
  const r = run1({ _notes: [note()] }), inp = input({ runs: [r] }), ix = built(inp);
  assert.ok(ids(S.query(ix, 'restarted')).some(id => /^note:/.test(id)), 'set-up: found by its words');
  const r2 = run1({ _notes: [note({ text: 'Cache warmed slowly' })] });
  S.sync(ix, S.docs(input({ runs: [r2] })), input({ runs: [r2] }));
  assert.ok(ids(S.query(ix, 'warmed')).some(id => /^note:/.test(id)), 'found by the new words');
  assert.ok(!ids(S.query(ix, 'restarted')).some(id => /^note:/.test(id)), 'the old words no longer find it');
});

rule('Search: renaming a person finds their runs by the new name without indexing any run again', () => {
  const r = run1(), ix = built(input({ runs: [r] }));
  assert.ok(ids(S.query(ix, 'avery')).indexOf('run:release/r1') >= 0, 'set-up: found by the recorder\'s name');
  const before = ix.stats.added;
  const renamed = input({ runs: [r], people: [{ id: 'person-avery', name: 'Avery Quinn' }, PEOPLE[1]] });
  S.sync(ix, S.docs(renamed), renamed);
  assert.strictEqual(ix.stats.added, before, 'no document was indexed again');
  assert.ok(ids(S.query(ix, 'quinn')).indexOf('run:release/r1') >= 0, 'found by the new name');
  assert.ok(ids(S.query(ix, 'avery')).indexOf('run:release/r1') >= 0, 'and still by the first name, which didn\'t change');
});

rule('Search: a decision whose contents changed under the same file name is updated, and a source that\'s gone disappears', () => {
  const dec = reason => ({ kind: 'correction-decision', process: 'release', group: 'g1', status: 'declined', reason, by: 'person-avery', at: '2026-10-17T10:00:00.000Z', rev: 1, _file: 'g1.w1.1.json', _dir: 'corrections' });
  let inp = input({ corrDecisions: [dec('Covered by the smoke tests')] });
  const ix = built(inp);
  assert.ok(ids(S.query(ix, 'smoke')).indexOf('corr:corrections/release/g1.w1.1.json') >= 0, 'set-up: found');
  inp = input({ corrDecisions: [dec('Already in the runbook')] });
  S.sync(ix, S.docs(inp), inp);
  assert.ok(ids(S.query(ix, 'runbook')).indexOf('corr:corrections/release/g1.w1.1.json') >= 0, 'new contents found');
  assert.strictEqual(ids(S.query(ix, 'smoke')).length, 0, 'old contents gone');
  inp = input({ runs: [run1({ _notes: [note()] })] });
  S.sync(ix, S.docs(inp), inp);
  inp = input();
  S.sync(ix, S.docs(inp), inp);
  assert.strictEqual(ids(S.query(ix, 'runbook')).length, 0, 'a deleted decision disappears');
  assert.strictEqual(ids(S.query(ix, 'restarted')).length, 0, 'a run that\'s gone takes its notes with it');
});

rule('Search: a word with a combining mark is highlighted whole, and the ranges point at the original text', () => {
  const decomposed = 'Café deploy at the café', precomposed = 'Café deploy';
  const segs = S.mark(decomposed, 'cafe');
  const hits = segs.filter(s => s.hit).map(s => s.t);
  same(hits, ['Café', 'café'], 'each hit includes its accent');
  assert.strictEqual(segs.map(s => s.t).join(''), decomposed, 'the segments are the original text, in order');
  same(S.mark(precomposed, 'café').filter(s => s.hit).map(s => s.t), ['Café'], 'an accent in the query folds too');
  const f = S.fold(decomposed);
  assert.strictEqual(f.text.slice(0, 4), 'cafe');
  assert.strictEqual(decomposed.slice(f.start[0], f.end[3]), 'Cafe', 'folded offsets map back to the original');
  const ix = built(input({ runs: [run1({ title: 'Ölçek café run' })] }));
  assert.ok(ids(S.query(ix, 'olcek cafe')).indexOf('run:release/r1') >= 0, 'found without typing the accents');
});

rule('Search: switching folders during a time-sliced build leaves no results from the old folder', () => {
  const many = [];
  for (let i = 0; i < 300; i++) many.push(run1({ id: 'old' + i, title: 'Oldfolder run ' + i, _fileHash: 'h' + i }));
  let clock = 0;
  const ixA = S.create(), jobA = S.start(ixA, S.docs(input({ runs: many })), input({ runs: many }));
  jobA.step(1, () => (clock += 0.4));
  assert.ok(!jobA.done && jobA.runs.done > 0 && jobA.runs.done < 300, 'set-up: part way through, ' + jobA.runs.done + ' of ' + jobA.runs.total + ' runs');
  jobA.cancel();
  assert.ok(jobA.step(8, () => (clock += 0.1)) === false && jobA.runs.done < 300, 'a canceled build does no more');
  const ixB = S.create(), inpB = input({ runs: [run1({ title: 'Newfolder release' })] }), jobB = S.start(ixB, S.docs(inpB), inpB);
  while (!jobB.step(8, () => (clock += 0.1))) { /* until done */ }
  assert.strictEqual(ids(S.query(ixB, 'oldfolder')).length, 0, 'nothing from the old folder');
  assert.ok(ids(S.query(ixB, 'newfolder')).length === 1);
  const progress = S.query(ixA, 'oldfolder');
  assert.ok(progress.total > 0 && progress.total < 300, 'the old index answered only from what it had read');
});

rule('Search: a build carries a token, so a newer build wins and the older one stops', () => {
  const inp = input({ runs: [run1()] }), ix = S.create();
  const a = S.start(ix, S.docs(inp), inp), b = S.start(ix, S.docs(inp), inp);
  assert.strictEqual(a.step(8, () => 0), false, 'the older build stops at once');
  assert.ok(a.canceled);
  while (!b.step(8, () => 0)) { /* until done */ }
  assert.ok(b.done && ids(S.query(ix, 'release')).indexOf('run:release/r1') >= 0);
});

rule('Search: regex characters match literally, constructor and __proto__ are ordinary words, and every result is plain text', () => {
  const r = run1({ _notes: [note({ id: 'a', text: 'Use a+b (c) [d] *e* for constructor' }), note({ id: 'b', text: 'The __proto__ key and <img src=x onerror=alert(1)> stays text' })] });
  const ix = built(input({ runs: [r] }));
  assert.ok(ids(S.query(ix, 'a+b (c)')).some(id => /:a#/.test(id)), 'punctuation in the query');
  assert.ok(ids(S.query(ix, '[d] *e*')).some(id => /:a#/.test(id)));
  assert.ok(ids(S.query(ix, 'constructor')).some(id => /:a#/.test(id)), 'constructor is a word');
  assert.ok(ids(S.query(ix, '__proto__')).some(id => /:b#/.test(id)), '__proto__ is a word');
  assert.strictEqual(S.query(ix, 'hasOwnProperty').total, 0);
  assert.strictEqual(S.query(ix, 'toString').total, 0);
  const html = S.mark('<img src=x onerror=alert(1)> stays', 'onerror').map(s => s.hit ? '<mark>' + PF.util.esc(s.t) + '</mark>' : PF.util.esc(s.t)).join('');
  assert.ok(!/<img/.test(html) && /&lt;img src=x <mark>onerror<\/mark>=alert\(1\)&gt;/.test(html), html);
});

rule('Search: every word must match, the last one as a prefix, and exact words and phrases rank first', () => {
  const runs = [run1({ id: 'a', title: 'Deploy the staging site', _fileHash: 'a' }), run1({ id: 'b', title: 'Deployment notes for staging', _fileHash: 'b' }), run1({ id: 'c', title: 'Staging clean-up, deploy later', _fileHash: 'c' })];
  const ix = built(input({ runs }));
  same(ids(S.query(ix, 'deploy staging')).sort(), ['run:release/a', 'run:release/c'], 'deploy isn\'t a prefix unless it\'s the last word');
  same(ids(S.query(ix, 'staging deplo')).sort(), ['run:release/a', 'run:release/b', 'run:release/c'], 'the last word is a prefix');
  assert.strictEqual(ids(S.query(ix, 'deploy the staging'))[0], 'run:release/a', 'the phrase ranks first');
  assert.strictEqual(S.query(ix, 'deploy zebra').total, 0, 'all words must match');
  assert.strictEqual(S.query(ix, '   ').total, 0, 'nothing typed, nothing found');
});

rule('Search: a ticket is found as typed, and a result from a run whose last read failed carries that status', () => {
  const r = run1(), ix = built(input({ runs: [r] }));
  const res = S.query(ix, 'abc-123', { status: { 'release/r1': 'unread' } });
  assert.strictEqual(ids(res)[0], 'run:release/r1');
  assert.strictEqual(res.groups[0].items[0].status, 'unread');
  assert.strictEqual(S.query(ix, 'abc-123').groups[0].items[0].status, '', 'no status when it read fine');
});

rule('Search: results are grouped by type, each with somewhere to go, and the context breaks ties', () => {
  const pubs = [{ process: 'release', pubs: [], index: { latest: null, all: [] } }];
  const r = run1({ _notes: [note({ text: 'Deploy waited for the backup' })], followUps: [{ id: 'f1', text: 'Deploy the backup script', owner: 'person-blake', at: '2026-10-16T10:00:00.000Z' }] });
  const fus = PF.followups.list([r], []);
  const inp = input({ runs: [r, run1({ id: 'r2', process: 'hotfix', title: 'Hotfix deploy', _fileHash: 'z' })], followUps: fus, pubs });
  const ix = built(inp), res = S.query(ix, 'deploy', { context: { run: 'hotfix/r2' } });
  ['followup', 'note', 'run'].forEach(k => assert.ok(res.groups.some(g => g.kind === k), k + ' group'));
  const runs = res.groups.filter(g => g.kind === 'run')[0];
  assert.strictEqual(runs.items[0].id, 'run:hotfix/r2', 'the open run first among equals');
  const n = res.groups.filter(g => g.kind === 'note')[0].items[0];
  same(n.target, { view: 'run', run: 'release/r1', step: 'pods', note: 'n1' });
  assert.ok(kinds(S.query(ix, 'folder health')).indexOf('page') >= 0, 'pages of the app are found too');
});

rule('Search: steps of the latest version, step types by label, skills and drafts are found; a type label is matched through its side index', () => {
  const md = '---\nprocess: release\ntitle: Production release\n---\n\n## Deploy · READ-DO {#deploy}\n- [ ] {jenkins.job} Run the deploy job {#job}\n- [ ] {confirm} Smoke test the login page {#smoke}\n';
  const v = PF.publish.verify('v1-abcd1234', PF.publish.build(md, { people: [], by: 'person-avery', changes: 'First version', existing: [], now: '2026-10-01T00:00:00.000Z', rand: 'abcd1234' }).files);
  assert.ok(v.ok, 'set-up: a published version');
  v.folder = 'v1-abcd1234'; v.process = 'release';
  const pubs = [{ process: 'release', pubs: [v], index: PF.publish.index([v]) }];
  const skills = [{ skill: { name: 'Release helper', process: 'release', implements: 1, description: 'Drafts the release notes' }, errors: [], file: 'release-helper.json' }];
  const inp = input({ pubs, skills, drafts: [{ file: 'intake.md', md: '---\nprocess: intake\ntitle: Customer intake\n---\n' }] }), ix = built(inp);
  const smoke = S.query(ix, 'smoke login');
  assert.strictEqual(ids(smoke)[0], 'step:release/v1-abcd1234/smoke');
  same(smoke.groups[0].items[0].target, { view: 'process', process: 'release', mapVer: 'v1-abcd1234', step: 'smoke' });
  assert.ok(ids(S.query(ix, 'jenkins job')).indexOf('step:release/v1-abcd1234/job') >= 0, 'found by its type\'s label');
  assert.ok(ids(S.query(ix, 'jenkins job')).indexOf('type:jenkins.job') >= 0, 'and the type itself');
  assert.ok(ids(S.query(ix, 'production release')).indexOf('pub:release/v1-abcd1234') >= 0, 'the process');
  assert.ok(ids(S.query(ix, 'release notes')).indexOf('skill:release-helper.json') >= 0, 'the skill');
  assert.ok(ids(S.query(ix, 'customer intake')).indexOf('draft:intake.md') >= 0, 'an unpublished draft');
});

rule('Search: a snippet shows the words around the first hit, with its marks in the original text', () => {
  const long = 'Start ' + 'filler '.repeat(40) + 'the Rollback plan was read aloud ' + 'tail '.repeat(40);
  const segs = S.snippet(long, 'rollback', 80), text = segs.map(s => s.t).join('');
  assert.ok(text.length <= 84 && /Rollback/.test(text), text);
  assert.ok(/^…/.test(text) && /…$/.test(text), 'cut on both sides');
  same(segs.filter(s => s.hit).map(s => s.t), ['Rollback']);
});

run();
