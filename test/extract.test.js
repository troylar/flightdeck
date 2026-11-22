// Moving part of a checklist to a new checklist (docs/design.md section 46): what moves, what it carries, what is refused,
// and that both checklists read exactly as the moved lines did.
'use strict';
const assert = require('assert');
const { load, example, rule, run } = require('./harness');
const fs = require('fs'), path = require('path');
const PF = load(), M = PF.map, O = PF.outline;

const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const steps = t => M.steps(M.parse(t)).map(x => x.step);
const byId = (t, id) => steps(t).filter(s => s.id === id)[0];
const NEW = { id: 'deploy-the-build', title: 'Deploy the build' };

const DRAFT = [
  '---', 'process: release', 'title: Release', 'category: Delivery', 'owner: person-avery',
  'context: commit, env:choice(dev|test|prod), tag, ticket', 'roles: lead, ops, qa', '---', '',
  '## Prepare · DO-CONFIRM {#prepare}',
  '- [ ] {confirm} Freeze ^commit @lead {#freeze}',
  '- [ ] {confirm} Write the notes for ^ticket @lead {#notes}',
  '',
  '## Deploy · READ-DO {#deploy}',
  '  > The deploy itself.',
  '- [!] {run.command} Build ^commit for ^env @ops {#build}',
  '  command: make build',
  '- [ ] {confirm} Tag the build @ops {#tag-it}',
  '  sets: tag',
  '  only when ^env is prod',
  '- [ ] {confirm} Check the dashboards @ops {#dash}',
  '',
  '### Track: Checks @qa {#checks-lane}',
  '- [ ] {confirm} Smoke test ^commit {#smoke}',
  '- [ ] {confirm} Read the logs @ops {#logs}',
  '',
  '## Gate: Deployed · owner @lead {#deployed}',
  '  approves: ^commit on ^env',
  '',
  '## Close · READ-DO {#close}',
  '- [ ] {confirm} Tell the team {#tell}',
  ''
].join('\n');

rule('A run of steps becomes a new checklist, and one linked step that runs it takes their place', () => {
  const res = O.extract(DRAFT, { kind: 'steps', from: 'build', to: 'tag-it' }, NEW);
  assert.ok(!res.error, res.error);
  assert.strictEqual(res.moved, 2);
  const ids = steps(res.text).map(s => s.id);
  same(ids, ['freeze', 'notes', 'deploy-the-build', 'dash', 'smoke', 'logs', 'tell'], 'the new step sits where the moved ones were');
  const st = byId(res.text, 'deploy-the-build');
  assert.strictEqual(st.type, 'run.process');
  assert.strictEqual(st.text, 'Deploy the build');
  assert.ok(st.must, 'a must-do moved, so the step that runs them is a must-do');
  same(st.roles, ['ops'], 'every moved step was worked by @ops');
  assert.strictEqual(st.fields.process, 'deploy-the-build');
  assert.strictEqual(st.fields.carry, 'commit, env', 'it passes down what the moved steps read');
  same(res.carry, ['commit', 'env']);
  const kid = M.parse(res.child.text);
  assert.strictEqual(kid.meta.process, 'deploy-the-build');
  assert.strictEqual(kid.meta.title, 'Deploy the build');
  same(kid.meta.context, ['commit', 'env', 'tag'], 'the details it reads and the one it sets');
  same(kid.meta.detailTypes.env, { kind: 'choice', options: ['dev', 'test', 'prod'] }, 'a typed detail keeps its kind');
  same(kid.meta.roles, ['ops']);
  assert.strictEqual(kid.meta.category, 'Delivery');
  assert.strictEqual(kid.meta.owner, 'person-avery');
  same(steps(res.child.text).map(s => s.id), ['build', 'tag-it'], 'moved steps keep their IDs');
  assert.strictEqual(kid.errors.length, 0);
  same(M.check(kid, {}).blockers, []);
});

rule('A detail only the moved steps set leaves the original, so its runs don\'t ask for it', () => {
  const res = O.extract(DRAFT, { kind: 'steps', from: 'build', to: 'tag-it' }, NEW);
  same(M.parse(res.text).meta.context, ['commit', 'env', 'ticket']);
  assert.ok(/context: commit, env:choice\(dev\|test\|prod\), ticket/.test(res.text), 'the other entries stay as written');
});

rule('The moved lines are copied exactly, conditions and fields included', () => {
  const res = O.extract(DRAFT, { kind: 'steps', from: 'build', to: 'tag-it' }, NEW);
  const tag = byId(res.child.text, 'tag-it'), was = byId(DRAFT, 'tag-it');
  same(tag.fields, was.fields);
  same(tag.when.map(w => w.text), was.when.map(w => w.text));
  assert.ok(res.child.text.includes('  command: make build\n'));
});

rule('A step that set a detail the rest of the checklist uses is refused, naming both', () => {
  const draft = DRAFT.replace('- [ ] {confirm} Check the dashboards @ops {#dash}', '- [ ] {confirm} Check the dashboards for ^tag @ops {#dash}');
  const res = O.extract(draft, { kind: 'steps', from: 'tag-it' }, NEW);
  assert.ok(res.error && !res.text);
  assert.ok(/Tag the build/.test(res.error) && /\^tag/.test(res.error) && /Check the dashboards/.test(res.error), res.error);
});

rule('Moving the steps that use a detail along with the one that sets it works', () => {
  const draft = DRAFT.replace('- [ ] {confirm} Check the dashboards @ops {#dash}', '- [ ] {confirm} Check the dashboards for ^tag @ops {#dash}');
  const res = O.extract(draft, { kind: 'steps', from: 'tag-it', to: 'dash' }, NEW);
  assert.ok(!res.error, res.error);
  same(res.carry, ['env'], 'what is set inside isn\'t carried');
});

rule('The detail a checklist returns as its result stays with its decision', () => {
  const draft = [
    '---', 'process: check', 'title: Check', 'context: verdict:choice(ok|bad)', 'result: verdict', '---', '',
    '## Look · READ-DO {#look}',
    '- [ ] {confirm} Look closely {#look-closely}',
    '- [ ] {decide} Is it ready? {#ready}',
    '  options: ok, bad',
    '  sets: verdict=decision', ''
  ].join('\n');
  const res = O.extract(draft, { kind: 'steps', from: 'ready' }, NEW);
  assert.ok(res.error && /result/.test(res.error), res.error);
});

rule('A lane moves without its heading, and its steps keep the lane\'s roles', () => {
  const res = O.extract(DRAFT, { kind: 'track', phase: 'deploy', track: 0 }, { id: 'checks', title: 'Checks' });
  assert.ok(!res.error, res.error);
  assert.ok(/### Track: Checks @qa \{#checks-lane\}\n- \[ \] \{run\.process\} Checks \{#checks\}\n  process: checks\n  carry: commit\n/.test(res.text), 'the lane stays, with the linked step in it');
  const st = byId(res.text, 'checks');
  same(st.roles, ['qa'], 'it takes the lane\'s role like any step there');
  same(byId(res.child.text, 'smoke').roles, ['qa'], 'the role it took from the lane is written on it');
  same(byId(res.child.text, 'logs').roles, ['ops']);
  assert.ok(res.child.text.includes('- [ ] {confirm} Smoke test ^commit @qa {#smoke}'));
  same(M.parse(res.child.text).meta.roles, ['ops', 'qa'], 'in the checklist\'s order');
  assert.ok(/^## Checks · READ-DO$/m.test(res.child.text), 'its phase is named after the lane');
});

rule('A whole phase moves with its lanes and gate; the original keeps the phase, its note and one step', () => {
  const res = O.extract(DRAFT, { kind: 'phase', phase: 'deploy' }, NEW);
  assert.ok(!res.error, res.error);
  const ph = M.parse(res.text).phases.filter(p => p.id === 'deploy')[0];
  same(ph.steps.map(s => s.id), ['deploy-the-build']);
  assert.ok(ph.gate.implicit, 'the phase now ends with the usual check');
  assert.strictEqual(ph.tracks.length, 0);
  assert.strictEqual(ph.note, 'The deploy itself.', 'the phase\'s note stays');
  const kid = M.parse(res.child.text), kp = kid.phases[0];
  assert.strictEqual(kid.phases.length, 1);
  assert.strictEqual(kp.id, 'deploy');
  same(kp.tracks.map(t => t.title), ['Checks']);
  assert.strictEqual(kp.gate.title, 'Deployed');
  assert.strictEqual(kp.gate.owner, 'lead');
  same(kid.meta.roles, ['lead', 'ops', 'qa'], 'the gate\'s owner comes along');
  same(steps(res.child.text).map(s => s.id), ['build', 'tag-it', 'dash', 'smoke', 'logs']);
  assert.ok(!byId(res.text, 'deploy-the-build').roles.length, 'steps worked by different roles: the linked step names none');
  same(M.check(kid, {}).blockers, []);
});

rule('A linked step that shares details by name must say what it carries first', () => {
  const draft = DRAFT.replace('- [ ] {confirm} Check the dashboards @ops {#dash}', '- [ ] {run.process} Run the checks @ops {#dash}\n  process: checks');
  const res = O.extract(draft, { kind: 'steps', from: 'dash' }, NEW);
  assert.ok(res.error && /carry:/.test(res.error), res.error);
  const ok = O.extract(draft.replace('  process: checks', '  process: checks\n  carry: commit'), { kind: 'steps', from: 'dash' }, NEW);
  assert.ok(!ok.error, ok.error);
  same(ok.carry, ['commit'], 'it passes on what that step carried');
});

rule('A loop and the search it reads stay together', () => {
  const draft = [
    '---', 'process: rel', 'title: Rel', 'context: fix', '---', '',
    '## Stories · READ-DO {#stories}',
    '- [!] {jira.search} Find the stories {#find}',
    '  query: fixVersion = ^fix',
    '  results: any',
    '- [!] {for.each} Check every story {#each}',
    '  process: story-check',
    '  from: #find',
    '  items: jira.issue',
    '  pass: issue=item:key',
    '  accepts: cleared', ''
  ].join('\n');
  const res = O.extract(draft, { kind: 'steps', from: 'each' }, NEW);
  assert.ok(res.error && /#find/.test(res.error), res.error);
  assert.ok(!O.extract(draft, { kind: 'steps', from: 'find', to: 'each' }, NEW).error);
});

rule('Timed steps say their times now count from the new checklist\'s start', () => {
  const draft = DRAFT.replace('  command: make build', '  command: make build\n  after: 2h');
  const res = O.extract(draft, { kind: 'steps', from: 'build' }, NEW);
  assert.ok(!res.error, res.error);
  assert.ok(res.warnings.some(w => /after:/.test(w)), 'warned');
  assert.strictEqual(O.extract(DRAFT, { kind: 'steps', from: 'build' }, NEW).warnings.length, 0);
});

rule('Steps from two lanes, or chosen last to first, are refused', () => {
  assert.ok(O.extract(DRAFT, { kind: 'steps', from: 'dash', to: 'smoke' }, NEW).error);
  assert.ok(O.extract(DRAFT, { kind: 'steps', from: 'tag-it', to: 'build' }, NEW).error);
  assert.ok(O.extract(DRAFT, { kind: 'steps', from: 'freeze', to: 'build' }, NEW).error, 'two phases');
});

rule('The new checklist needs a plain title and a file name of its own', () => {
  const sel = { kind: 'steps', from: 'build' };
  assert.strictEqual(O.extract(DRAFT, sel, { id: 'x', title: '' }).field, 'title');
  assert.ok(O.extract(DRAFT, sel, { id: 'x', title: 'Deploy @ops' }).error);
  assert.ok(O.extract(DRAFT, sel, { id: 'x', title: 'Deploy ^commit' }).error);
  assert.ok(O.extract(DRAFT, sel, { id: 'Bad Name', title: 'Deploy' }).error);
  assert.ok(O.extract(DRAFT, sel, { id: 'release', title: 'Release' }).error, 'not this checklist\'s own name');
});

rule('A file name comes from the title, past the ones taken', () => {
  assert.strictEqual(O.extractId('Deploy the build!', []), 'deploy-the-build');
  assert.strictEqual(O.extractId('Deploy', ['deploy', 'deploy-2']), 'deploy-3');
  assert.strictEqual(O.extractId('!!!', []), '');
});

rule('A run of steps can end at the chosen step or a later one in its lane', () => {
  same(O.extractRange(DRAFT, 'build').map(s => s.id), ['build', 'tag-it', 'dash']);
  same(O.extractRange(DRAFT, 'smoke').map(s => s.id), ['smoke', 'logs']);
  same(O.extractRange(DRAFT, 'nope'), []);
});

rule('An empty lane or phase, an odd step and a draft the builder can\'t read are refused', () => {
  const empty = DRAFT.replace('## Close · READ-DO {#close}\n- [ ] {confirm} Tell the team {#tell}\n', '## Close · READ-DO {#close}\n');
  assert.ok(/no steps/.test(O.extract(empty, { kind: 'phase', phase: 'close' }, NEW).error));
  assert.ok(O.extract(DRAFT, { kind: 'steps', from: 'gone' }, NEW).error);
  assert.ok(O.extract('a\rb', { kind: 'steps', from: 'x' }, NEW).error);
});

rule('Moving is one builder operation the apply path knows', () => {
  const res = O.apply(DRAFT, { op: 'extract', sel: { kind: 'steps', from: 'build' }, child: NEW });
  assert.ok(!res.error && res.child.id === 'deploy-the-build');
  assert.strictEqual(O.parse(res.text).steps.filter(s => s.id === res.id)[0].line, res.at, 'at is the new step\'s line');
});

rule('Windows line endings are kept in both checklists', () => {
  const crlf = DRAFT.replace(/\n/g, '\r\n');
  const res = O.extract(crlf, { kind: 'steps', from: 'build', to: 'tag-it' }, NEW);
  assert.ok(!res.error, res.error);
  assert.ok(!/[^\r]\n/.test(res.text), 'original');
  assert.ok(!/[^\r]\n/.test(res.child.text), 'new checklist');
});

rule('Every phase, lane and step of the example checklists either moves cleanly or is refused with a reason', () => {
  const dir = path.join(__dirname, '..', 'example-folder', 'maps', 'drafts');
  let moved = 0;
  fs.readdirSync(dir).filter(f => f.endsWith('.md')).forEach(f => {
    const text = example('maps/drafts/' + f), o = O.parse(text);
    if (o.unsupported) return;
    const sels = [].concat(
      o.phases.map(p => ({ kind: 'phase', phase: p.key })),
      ...o.phases.map(p => p.tracks.map((t, k) => ({ kind: 'track', phase: p.key, track: k }))),
      o.steps.map(s => ({ kind: 'steps', from: s.key })));
    sels.forEach(sel => {
      const res = O.extract(text, sel, NEW), at = f + ' ' + JSON.stringify(sel);
      if (res.error) { assert.ok(typeof res.error === 'string' && res.error.length > 10, at); return; }
      moved++;
      assert.strictEqual(steps(res.text).length, steps(text).length - res.moved + 1, at);
      assert.strictEqual(steps(res.child.text).length, res.moved, at);
      same(M.parse(res.child.text).errors, [], at);
      M.parse(res.text).errors.forEach(e => assert.ok(M.parse(text).errors.some(x => x.msg === e.msg), at + ' new error ' + e.msg));
    });
  });
  assert.ok(moved > 20, 'most of them move: ' + moved);
});

run();
