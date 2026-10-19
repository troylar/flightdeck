// The outline builder's rules: it reads the same Markdown as the checklist parser, and every edit changes only the lines it
// touches, keeps every step ID, and keeps lines it doesn't model exactly as written.
'use strict';
const assert = require('assert');
const { load, example, exampleSetup, rule, run } = require('./harness');
const PF = load(), M = PF.map, O = PF.outline;
const EX = exampleSetup(PF);
const MAPS = ['release', 'check-in', 'sprint-start', 'new-skill', 'incident', 'jira-cleanup', 'github-pr'];
const RELEASE = example('maps/drafts/release.md');

const lines = t => t.split('\n');
const ids = t => M.steps(M.parse(t)).map(x => x.step.id);
const blockers = t => M.check(M.parse(t), { types: EX.customTypes, workflows: EX.workflows }).blockers;
const errors = t => M.parse(t).errors.map(e => e.msg);
/* What an edit did, line by line: the lines it removed and the lines it added. */
function changes(a, b) {
  const d = O.diff(a, b), A = lines(a), B = lines(b);
  return { removed: d.removed.map(i => A[i]), added: d.added.map(i => B[i]) };
}
function ok(res) { assert.ok(res && !res.error, res && res.error); return res.text; }
/* Nothing new is wrong, and every ID is still there. */
function healthy(before, after, msg) {
  /* Lines the parser doesn't understand are named by line number, which moves when lines are added above them. */
  const plain = t => blockers(t).map(b => b.replace(/^Line \d+: /, ''));
  const b0 = plain(before);
  plain(after).forEach(b => assert.ok(b0.includes(b) || /has no steps/.test(b), (msg || '') + ' new blocker: ' + b));
  errors(after).forEach(e => assert.ok(errors(before).includes(e), (msg || '') + ' new parse error: ' + e));
}
const sorted = a => a.slice().sort();
// Objects from the sandbox have their own prototypes, so compare plain JSON copies.
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

const ODD = [
  '---', 'process: odd', 'title: Odd one', 'roles: lead, qa', 'context: commit', '---', '',
  '<!-- Kept: a comment the builder never touches -->',
  '## First · READ-DO {#first}',
  '- [ ] {confirm} Alpha {#alpha}',
  '  where: Here',
  '   an indented line nobody understands',
  '',
  '<!-- between steps -->',
  '- [ ] {confirm} Beta @lead {#beta}',
  '- [!] {confirm} Gamma {#gamma}',
  '<!-- splits gamma from its field -->',
  '  where: There',
  '',
  '## Gate: Checked · owner @lead {#checked}',
  '  approves: `^commit`',
  '',
  '## Second · DO-CONFIRM {#second}',
  '- [ ] {confirm} Delta @qa {#delta}',
  ''
].join('\n');

rule('Builder: reading a draft finds the same steps, in the same order, as the checklist parser', () => {
  MAPS.forEach(name => {
    const md = example('maps/drafts/' + name + '.md'), o = O.parse(md);
    assert.strictEqual(o.unsupported, '', name);
    same(o.steps.map(s => s.id), ids(md), name);
    same(o.phases.map(p => p.id), M.parse(md).phases.map(p => p.id), name);
  });
});

rule('Builder: with no change, the text comes back identical, byte for byte (CRLF line endings too)', () => {
  [RELEASE, RELEASE.replace(/\n/g, '\r\n'), ODD, ''].forEach(md => {
    assert.strictEqual(O.parse(md).lines.join('\n'), md);
    const first = O.parse(md).steps[0];
    if (first) { const r = O.moveStepTo(md, first.key, { before: first.key }); assert.ok(r.same && r.text === md); }
    if (first) assert.strictEqual(ok(O.editStep(md, first.key, { text: first.text })), md, 'same text, same file');
  });
});

rule('Builder: moving a step up swaps it with the step above, moving only those lines and keeping every ID', () => {
  const after = ok(O.moveStep(RELEASE, 'flags', -1));
  const c = changes(RELEASE, after);
  same(sorted(c.removed), sorted(c.added), 'a pure reorder');
  const both = lines(RELEASE).filter(l => /\{#(tests|flags)\}/.test(l) || /web-app gate|ci\.example|require: run|Run the gate|New features ship off/.test(l));
  c.removed.forEach(l => assert.ok(both.includes(l), 'only the two steps moved: ' + l));
  same(sorted(ids(after)), sorted(ids(RELEASE)));
  same(ids(after).slice(0, 3), ['approved', 'flags', 'tests']);
  healthy(RELEASE, after);
  assert.strictEqual(ok(O.moveStep(after, 'flags', 1)), RELEASE, 'and back again gives the original');
});

rule('Builder: a step moves with its fields, notes and the indented lines under it', () => {
  const after = ok(O.moveStep(RELEASE, 'tests', 1));
  const L = lines(after), at = L.findIndex(l => /\{#tests\}/.test(l));
  same(L.slice(at, at + 5), lines(RELEASE).slice(lines(RELEASE).findIndex(l => /\{#tests\}/.test(l)), lines(RELEASE).findIndex(l => /\{#tests\}/.test(l)) + 5));
  const odd = ok(O.moveStep(ODD, 'alpha', 1));
  assert.ok(/Beta @lead \{#beta\}\n- \[ \] \{confirm\} Alpha \{#alpha\}\n  where: Here\n   an indented line nobody understands\n/.test(odd), 'the unknown indented line goes with Alpha');
  assert.ok(odd.startsWith(ODD.slice(0, ODD.indexOf('## First'))) && /<!-- between steps -->/.test(odd), 'comments stay where they were');
});

rule('Builder: at the edge of a phase a step moves into the next or previous phase, and never past the ends', () => {
  const down = ok(O.moveStep(RELEASE, 'announce', 1));
  assert.strictEqual(M.findStep(M.parse(down), 'announce').phase.id, 'deploy');
  assert.strictEqual(ids(down)[ids(down).indexOf('announce') + 1], 'merge', 'first in the next phase');
  const up = ok(O.moveStep(RELEASE, 'merge', -1));
  assert.strictEqual(M.findStep(M.parse(up), 'merge').phase.id, 'prep');
  assert.ok(/\{#merge\}[\s\S]*## Gate: Ready to deploy/.test(up), 'before the phase\'s gate');
  assert.strictEqual(O.moveStep(RELEASE, 'approved', -1).error, 'It\'s already first.');
  assert.strictEqual(O.moveStep(RELEASE, 'close', 1).error, 'It\'s already last.');
});

rule('Builder: moving across tracks changes the track (and the roles a step takes from it), nothing else', () => {
  const up = ok(O.moveStep(RELEASE, 'result', -1));
  const s = M.findStep(M.parse(up), 'result').step;
  assert.strictEqual(s.track, 'checks');
  const c = changes(RELEASE, up);
  same(sorted(c.removed), sorted(c.added));
  const back = ok(O.moveStep(up, 'result', 1));
  assert.strictEqual(M.findStep(M.parse(back), 'result').step.track, 'wrap');
  const toNone = ok(O.moveStep(RELEASE, 'smoke', -1));
  assert.strictEqual(M.findStep(M.parse(toNone), 'smoke').step.track, '', 'above the first track: no track');
  healthy(RELEASE, toNone);
});

rule('Builder: a step can be dropped before another step or at the end of a phase or track', () => {
  const t = ok(O.moveStepTo(RELEASE, 'pods', { before: 'approved' }));
  same(ids(t).slice(0, 2), ['pods', 'approved']);
  const e = ok(O.moveStepTo(RELEASE, 'approved', { phase: 'verify', track: 0, where: 'end' }));
  const x = M.findStep(M.parse(e), 'approved');
  assert.ok(x.phase.id === 'verify' && x.step.track === 'checks');
  same(sorted(ids(e)), sorted(ids(RELEASE)));
  assert.ok(O.moveStepTo(RELEASE, 'approved', { phase: 'nope', track: -1 }).error, 'a phase that isn\'t there');
});

rule('Builder: editing a step\'s text rewrites only its first line and keeps its ID, roles and run details', () => {
  const after = ok(O.editStep(RELEASE, 'flags', { text: 'Feature flags off in the values' }));
  same(changes(RELEASE, after), {
    removed: ['- [!] {confirm} Feature flags set in the deploy values ^environment @backend {#flags}'],
    added: ['- [!] {confirm} Feature flags off in the values ^environment @backend {#flags}'] });
  assert.ok(O.editStep(RELEASE, 'flags', { text: '' }).error);
  assert.ok(/buttons/.test(O.editStep(RELEASE, 'flags', { text: 'Ask @qa' }).error), 'roles go through their buttons');
  assert.ok(O.editStep(RELEASE, 'flags', { text: 'Sneaky {#other}' }).error, 'IDs can\'t be typed in');
});

rule('Builder: must-do, type, roles and run details each change one line', () => {
  const one = (after, msg) => { const c = changes(RELEASE, after); assert.ok(c.removed.length === 1 && c.added.length === 1, msg); same(ids(after), ids(RELEASE), msg); return c.added[0]; };
  assert.ok(/^- \[ \] \{confirm\} Feature flags/.test(one(ok(O.editStep(RELEASE, 'flags', { mark: ' ' })), 'must')));
  assert.ok(/^- \[~\]/.test(one(ok(O.editStep(RELEASE, 'flags', { mark: '~' })), 'planned')));
  assert.ok(/^- \[!\] \{ui\.action\} Feature flags/.test(one(ok(O.editStep(RELEASE, 'flags', { type: 'ui.action' })), 'type')));
  assert.ok(/@backend @qa \{#flags\}$/.test(one(ok(O.editStep(RELEASE, 'flags', { role: 'qa', on: true })), 'role on')));
  assert.ok(!/@backend/.test(one(ok(O.editStep(RELEASE, 'flags', { role: 'backend', on: false })), 'role off')));
  assert.ok(/\^commit \{#flags\}$/.test(one(ok(O.editStep(RELEASE, 'flags', { bind: 'commit', on: true })), 'detail on')));
  assert.ok(!/\^environment/.test(one(ok(O.editStep(RELEASE, 'flags', { bind: 'environment', on: false })), 'detail off')));
  assert.ok(O.editStep(RELEASE, 'flags', { role: 'backend', on: true }).same, 'already on: nothing to do');
  const untyped = '## P · READ-DO {#p}\n- [ ] Do it {#a}\n';
  assert.strictEqual(ok(O.editStep(untyped, 'a', { type: 'confirm' })), '## P · READ-DO {#p}\n- [ ] {confirm} Do it {#a}\n', 'a missing type is added');
});

rule('Builder: a field is changed in place, added after the other fields, or removed when emptied', () => {
  let c = changes(RELEASE, ok(O.editStep(RELEASE, 'jenkins', { field: 'job', value: 'web-app-deploy-canary' })));
  same(c, { removed: ['  job: web-app-deploy-prod'], added: ['  job: web-app-deploy-canary'] });
  const added = ok(O.editStep(RELEASE, 'flags', { field: 'where', value: 'The values file' }));
  same(changes(RELEASE, added), { removed: [], added: ['  where: The values file'] });
  assert.ok(/\{#flags\}\n  where: The values file\n  > New features/.test(added), 'before its note');
  const notes = ok(O.editStep(RELEASE, 'notes', { field: 'where', value: 'x' }));
  assert.ok(/  carry: commit\n  where: x\n  > Starts/.test(notes), 'after the last field');
  c = changes(RELEASE, ok(O.editStep(RELEASE, 'jenkins', { field: 'stage', value: '' })));
  same(c, { removed: ['  stage: Stage 5 asks for the release ticket number'], added: [] });
  assert.strictEqual(M.findStep(M.parse(added), 'flags').step.fields.where, 'The values file');
});

rule('Builder: a new step gets an ID made from its text, unique in the whole file, and adds exactly one line', () => {
  const a = ok(O.addStep(RELEASE, { after: 'flags' }, { text: 'Check the dashboards', type: 'confirm' }));
  same(changes(RELEASE, a), { removed: [], added: ['- [ ] {confirm} Check the dashboards {#check-the-dashboards}'] });
  assert.strictEqual(ids(a)[ids(a).indexOf('flags') + 1], 'check-the-dashboards', 'after flags, past its note');
  const dup = O.addStep(RELEASE, { phase: 'prep', where: 'end' }, { text: 'Approved', type: 'confirm' });
  assert.strictEqual(dup.id, 'approved-2', 'never reuses an ID');
  assert.strictEqual(O.addStep(RELEASE, { phase: 'prep' }, { text: 'Prep confirm' }).id, 'prep-confirm-2', 'an automatic gate ID counts as taken');
  const track = ok(O.addStep(RELEASE, { phase: 'verify', track: 1, where: 'end' }, { text: 'Thank the team', type: 'communicate' }));
  assert.strictEqual(M.findStep(M.parse(track), 'thank-the-team').step.track, 'wrap');
  healthy(RELEASE, a);
  assert.ok(O.addStep(RELEASE, { after: 'flags' }, { text: '' }).error);
  assert.ok(O.addStep(RELEASE, { after: 'flags' }, { text: 'Ping @qa' }).error);
});

rule('Builder: deleting a step removes its block and nothing else', () => {
  const after = ok(O.deleteStep(RELEASE, 'tests'));
  const c = changes(RELEASE, after);
  assert.strictEqual(c.added.length, 0);
  same(c.removed, lines(RELEASE).slice(lines(RELEASE).findIndex(l => /\{#tests\}/.test(l)), lines(RELEASE).findIndex(l => /\{#flags\}/.test(l))));
  same(ids(after), ids(RELEASE).filter(x => x !== 'tests'));
});

rule('Builder: phases are added, renamed, given a mode and reordered as whole blocks', () => {
  const add = O.addPhase(RELEASE, 'deploy', { title: 'Watch the metrics', mode: 'READ-DO' });
  same(changes(RELEASE, ok(add)).removed, []);
  same(M.parse(add.text).phases.map(p => p.id), ['prep', 'deploy', 'watch-the-metrics', 'verify']);
  assert.ok(/  approves: `\^commit` running in \^environment\n\n## Watch the metrics · READ-DO \{#watch-the-metrics\}\n\n## Verify/.test(add.text), 'blank lines around it');
  const end = ok(O.addPhase(RELEASE, null, { title: 'Celebrate', mode: 'DO-CONFIRM' }));
  assert.ok(end.endsWith('  status: Done\n\n## Celebrate · DO-CONFIRM {#celebrate}\n'));
  assert.ok(O.addPhase(RELEASE, null, { title: 'Gate: sneaky' }).error);
  const ren = ok(O.editPhase(RELEASE, 'verify', { title: 'Verify it' }));
  same(changes(RELEASE, ren), { removed: ['## Verify in production · READ-DO {#verify}'], added: ['## Verify it · READ-DO {#verify}'] });
  const mode = ok(O.editPhase(RELEASE, 'prep', { mode: 'READ-DO' }));
  same(changes(RELEASE, mode).added, ['## Before production changes · READ-DO {#prep}']);
  const noGate = ok(O.editPhase(ODD, 'second', { title: 'Later' }));
  assert.ok(/## Later · DO-CONFIRM \{#second\}/.test(noGate), 'a phase without a gate can be renamed too');
  const moved = ok(O.movePhase(RELEASE, 'verify', -1));
  same(M.parse(moved).phases.map(p => p.id), ['prep', 'verify', 'deploy']);
  same(sorted(ids(moved)), sorted(ids(RELEASE)));
  same(sorted(lines(moved)), sorted(lines(RELEASE)), 'the same lines, reordered');
  assert.strictEqual(ok(O.movePhase(moved, 'verify', 1)), RELEASE, 'and back');
  assert.ok(O.movePhase(RELEASE, 'prep', -1).error);
});

rule('Builder: a closing gate is added after the phase\'s steps, or edited in place', () => {
  const add = ok(O.setGate(ODD, 'second', { title: 'All good', owner: 'qa', approves: 'release of `^commit`' }));
  const c = changes(ODD, add);
  same([c.removed, sorted(c.added)], [[], sorted(['', '## Gate: All good · owner @qa {#all-good}', '  approves: release of `^commit`'])], 'a blank line, the gate and what it approves');
  const g = M.parse(add).phases[1].gate;
  assert.ok(!g.implicit && g.owner === 'qa' && g.binds[0] === 'commit');
  const ed = ok(O.setGate(RELEASE, 'prep', { title: 'Ready to ship' }));
  same(changes(RELEASE, ed), { removed: ['## Gate: Ready to deploy · owner @release-lead {#ready}'], added: ['## Gate: Ready to ship · owner @release-lead {#ready}'] });
  const ap = ok(O.setGate(RELEASE, 'prep', { approves: '' }));
  same(changes(RELEASE, ap), { removed: ['  approves: deploy of `^commit` to ^environment'], added: [] });
  const own = ok(O.setGate(RELEASE, 'prep', { owner: '' }));
  same(changes(RELEASE, own).added, ['## Gate: Ready to deploy {#ready}']);
  assert.ok(O.setGate(RELEASE, 'prep', { title: '' }).error);
});

rule('Builder: comments, blank lines and lines it doesn\'t understand are kept exactly', () => {
  let t = ODD;
  t = ok(O.editStep(t, 'beta', { text: 'Beta two' }));
  t = ok(O.addStep(t, { phase: 'second', where: 'end' }, { text: 'Epsilon' }));
  t = ok(O.moveStep(t, 'delta', 1));
  t = ok(O.editPhase(t, 'first', { mode: 'DO-CONFIRM' }));
  ['<!-- Kept: a comment the builder never touches -->', '<!-- between steps -->', '<!-- splits gamma from its field -->', '   an indented line nobody understands', '  where: There'].forEach(l => assert.ok(lines(t).includes(l), l));
  assert.strictEqual(lines(t).filter(l => l === '').length, lines(ODD).filter(l => l === '').length, 'no blank line added or lost');
  same(errors(t), errors(ODD), 'the same lines still aren\'t understood');
});

rule('Builder: a step whose lines are split up isn\'t moved or changed, and an edit that would change another step is refused', () => {
  assert.ok(O.parse(ODD).steps.find(s => s.id === 'gamma').odd, 'gamma\'s field is past a comment');
  assert.ok(/Edit it in Markdown/.test(O.moveStep(ODD, 'gamma', -1).error));
  assert.ok(/Edit it in Markdown/.test(O.editStep(ODD, 'gamma', { text: 'G' }).error));
  // A new step right after Gamma would take Gamma's separated field as its own, so the safety net refuses it.
  assert.ok(/change what other lines mean/.test(O.addStep(ODD, { after: 'gamma' }, { text: 'Between' }).error));
  // Moving Beta past Gamma would also hand Gamma's field to Beta.
  assert.ok(O.moveStep(ODD, 'beta', 1).error);
});

rule('Builder: a draft with a Questions section keeps it, and new phases go before it', () => {
  const md = RELEASE + '\n## Questions\n- Who approves the window?\n';
  const t = ok(O.addPhase(md, null, { title: 'Last', mode: 'READ-DO' }));
  assert.ok(/## Last · READ-DO \{#last\}\n\n## Questions\n- Who approves the window\?\n$/.test(t));
  assert.ok(O.parse(md).questions > 0);
});

rule('Builder: CRLF files stay CRLF', () => {
  const crlf = RELEASE.replace(/\n/g, '\r\n');
  const t = ok(O.addStep(ok(O.editStep(crlf, 'flags', { text: 'Flags off' })), { after: 'flags' }, { text: 'New one' }));
  assert.ok(!/[^\r]\n/.test(t), 'every line ends in CRLF');
  assert.ok(/Flags off \^environment @backend \{#flags\}\r\n/.test(t));
});

rule('Builder: every step of every example moves up and down without changing an ID or adding a problem', () => {
  MAPS.forEach(name => {
    const md = example('maps/drafts/' + name + '.md');
    O.parse(md).steps.forEach(s => [-1, 1].forEach(dir => {
      const r = O.moveStep(md, s.key, dir);
      if (r.error) { assert.ok(/already (first|last)/.test(r.error), name + ' ' + s.key + ': ' + r.error); return; }
      same(sorted(ids(r.text)), sorted(ids(md)), name + ' ' + s.key);
      same(sorted(lines(r.text)), sorted(lines(md)), name + ' ' + s.key + ': only reordered');
      healthy(md, r.text, name + ' ' + s.key);
    }));
  });
});

rule('Builder: a move that hands a field whose name starts with _ to another step is refused', () => {
  const md = ['## P · READ-DO {#p}', '- [ ] {confirm} C {#c}', '- [ ] {confirm} A {#a}', '<!-- a comment -->', '  _hint: belongs to A', ''].join('\n');
  assert.strictEqual(M.parse(md).phases[0].steps[1].fields._hint, 'belongs to A');
  const r = O.moveStep(md, 'c', 1);
  assert.ok(r.error, 'refused, not moved');
  same(M.parse(md).phases[0].steps.map(s => s.fields), [{}, { _hint: 'belongs to A' }]);
});

rule('Builder: a step added to an empty phase or track goes after an orphaned note, and never takes it as its own', () => {
  const ph = ['## P · READ-DO {#p}', '  > Existing explanation', '', '## Q · READ-DO {#q}', '- [ ] {confirm} Q1 {#q1}', ''].join('\n');
  const t = ok(O.addStep(ph, { phase: 'p', where: 'end' }, { text: 'New one' }));
  const s = M.parse(t).phases[0].steps[0];
  assert.strictEqual(s.id, 'new-one');
  assert.ok(!s.note, 'the note isn\'t the new step\'s');
  same(changes(ph, t).added, ['- [ ] {confirm} New one {#new-one}']);
  const tr = ['## P · READ-DO {#p}', '- [ ] {confirm} P1 {#p1}', '### Track: Web @lead', '  > Existing explanation', '', '## Q · READ-DO {#q}', ''].join('\n');
  const t2 = ok(O.addStep(tr, { phase: 'p', track: 0, where: 'start' }, { text: 'Web step' }));
  const w = M.parse(t2).phases[0].steps.filter(x => x.id === 'web-step')[0];
  assert.ok(w && !w.note, 'in the track, without the note');
  /* The safety net itself refuses a new step that picked up content it wasn't given. */
  const glued = ['## P · READ-DO {#p}', '- [ ] {confirm} P1 {#p1}', '<!-- c -->', '  where: orphaned', ''].join('\n');
  const r = O.addStep(glued, { after: 'p1' }, { text: 'Glued' });
  assert.ok(r.error, 'never a new step with a field it wasn\'t given');
});

rule('Builder: a new phase\'s ID never collides with an existing ID through its automatic gate', () => {
  const md = ['## Build · READ-DO {#build}', '- [ ] {confirm} Confirm the deploy {#deploy-confirm}', ''].join('\n');
  const r = O.addPhase(md, null, { title: 'Deploy', mode: 'READ-DO' });
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.id, 'deploy-2');
  const p = M.parse(r.text).phases[1];
  assert.notStrictEqual(p.gate.id, 'deploy-confirm');
});

rule('Builder: a field keeps the spaces inside its value, and setting it to what it already says changes nothing', () => {
  const md = ['## P · READ-DO {#p}', '- [ ] {run.command} Run it {#run}', '  command: echo "a  b"', ''].join('\n');
  const r = O.editStep(md, 'run', { field: 'command', value: 'echo "a  b"' });
  assert.ok(r.same && r.text === md, 'no edit at all');
  const t = ok(O.editStep(md, 'run', { field: 'command', value: '  echo "a  b"  c\n' }));
  assert.strictEqual(M.parse(t).phases[0].steps[0].fields.command, 'echo "a  b"  c');
  same(changes(md, t).added, ['  command: echo "a  b"  c']);
  const g = ok(O.setGate(md, 'p', { title: 'Done', approves: '`^commit`  as built' }));
  assert.strictEqual(M.parse(g).phases[0].gate.approves, '`^commit`  as built', 'a gate\'s approves line too');
});

rule('Builder: step text keeps the spaces inside it, and setting it to what it already says changes nothing', () => {
  const md = ['## P · READ-DO {#p}', '- [ ] Run `echo "a  b"` @ops {#run}', ''].join('\n');
  const r = O.editStep(md, 'run', { text: 'Run `echo "a  b"`' });
  assert.ok(r.same && r.text === md, 'no edit at all');
  const t = ok(O.editStep(md, 'run', { text: 'Run `echo "a  b"`  now' }));
  same(changes(md, t).added, ['- [ ] Run `echo "a  b"`  now @ops {#run}']);
  const a = ok(O.addStep(md, { phase: 'p' }, { text: 'Say `x  y`' }));
  assert.ok(a.indexOf('Say `x  y`') > 0, 'a new step keeps them too');
});

rule('Builder: phase and gate names keep the spaces inside them', () => {
  const md = ['## Ship  it · READ-DO {#p}', '- [ ] Go {#go}', ''].join('\n');
  const r = O.editPhase(md, 'p', { title: 'Ship  it' });
  assert.ok(r.same && r.text === md, 'an unchanged phase name changes nothing');
  const t = ok(O.editPhase(md, 'p', { title: 'Ship  it  now' }));
  assert.strictEqual(M.parse(t).phases[0].title, 'Ship  it  now');
  const a = ok(O.addPhase(md, null, { title: 'Roll  back', mode: 'READ-DO' }));
  const g = ok(O.setGate(md, 'p', { title: 'Approve  "a  b"' }));
  assert.strictEqual(M.parse(g).phases[0].gate.title, 'Approve  "a  b"', 'a gate name too');
  assert.ok(O.setGate(g, 'p', { title: 'Approve  "a  b"' }).same, 'and an unchanged one changes nothing');
  assert.ok(a.indexOf('Roll  back') > 0, 'a new phase keeps them too');
});

rule('Builder: the line diff finds the changed lines and leaves equal ones alone', () => {
  same(O.diff('a\nb\nc', 'a\nB\nc'), { added: [1], removed: [1] });
  same(O.diff('a\nb', 'a\nb'), { added: [], removed: [] });
  same(O.diff('a\nc', 'a\nb\nc'), { added: [1], removed: [] });
});

/* ---------- the parts box: lanes, gates, phases and where new parts can go ---------- */
const LANES = [
  '---', 'process: lanes', 'title: Lanes', 'roles: lead, qa', 'context: commit', '---', '',
  '## Build · READ-DO {#build}',
  '- [ ] {confirm} Compile {#compile}',
  '### Track: Web @lead {#web}',
  '- [ ] {confirm} Bundle the app {#bundle}',
  '  where: CI',
  '- [ ] {confirm} Own role @qa {#own}',
  '<!-- a comment inside the Web lane -->',
  '### Track: Docs @qa {#docs}',
  '- [ ] {confirm} Write the notes {#notes}',
  '  > A note on the step',
  '',
  '## Gate: Built · owner @lead {#built}',
  '  approves: `^commit`',
  '',
  '## Ship · DO-CONFIRM {#ship}',
  '- [!] {confirm} Ship it {#ship-it}',
  ''
].join('\n');

rule('Parts: a new lane is its heading and one first step, at the end of a phase or before another lane, with its role', () => {
  const end = O.addTrack(RELEASE, { phase: 'deploy' }, { title: 'Smoke checks', role: 'qa', text: 'Run the smoke tests' });
  same(changes(RELEASE, ok(end)), { removed: [], added: ['### Track: Smoke checks @qa {#smoke-checks}', '- [ ] {confirm} Run the smoke tests {#run-the-smoke-tests}'] });
  assert.ok(/expect: 10m\n### Track: Smoke checks/.test(end.text), 'after the last step, before the gate');
  const x = M.findStep(M.parse(end.text), 'run-the-smoke-tests');
  assert.ok(x.phase.id === 'deploy' && x.step.track === 'smoke-checks' && x.step.roles[0] === 'qa', 'the step is in the lane and works as its role');
  assert.strictEqual(end.id, 'smoke-checks'); assert.strictEqual(end.track, 0);
  healthy(RELEASE, end.text);
  same(sorted(ids(end.text)), sorted(ids(RELEASE).concat(['run-the-smoke-tests'])), 'every other ID kept');
  const mid = ok(O.addTrack(LANES, { phase: 'build', before: 1 }, { title: 'Tests', role: 'qa', text: 'Run the tests' }));
  same(M.parse(mid).phases[0].tracks.map(t => t.id), ['web', 'tests', 'docs']);
  assert.ok(/<!-- a comment inside the Web lane -->\n### Track: Tests @qa \{#tests\}\n- \[ \] \{confirm\} Run the tests \{#run-the-tests\}\n### Track: Docs/.test(mid), 'between lanes; the comment stays');
  same(M.parse(mid).phases[0].steps.map(s => [s.id, s.track]), [['compile', ''], ['bundle', 'web'], ['own', 'web'], ['run-the-tests', 'tests'], ['notes', 'docs']], 'no other step changed lanes');
  assert.ok(O.addTrack(RELEASE, { phase: 'deploy' }, { title: 'Lane @qa', text: 'x' }).error, 'a role goes in its own box');
  assert.ok(O.addTrack(RELEASE, { phase: 'deploy' }, { title: 'Lane' }).error, 'a lane needs a first step');
  assert.ok(O.addTrack(RELEASE, { phase: 'deploy', before: 3 }, { title: 'Lane', text: 'x' }).error, 'a lane that isn\'t there');
});

rule('Parts: a lane\'s role that isn\'t listed yet is added to roles in the front matter, so the checks pass', () => {
  const t = ok(O.addTrack(RELEASE, { phase: 'deploy' }, { title: 'Docs', role: 'writer', text: 'Update the docs' }));
  same(changes(RELEASE, t).removed, ['roles: release-lead, qa, backend']);
  assert.ok(lines(t).includes('roles: release-lead, qa, backend, writer'));
  same(blockers(t), blockers(RELEASE), 'no new blocker');
  const none = LANES.replace('roles: lead, qa\n', '');
  const n = ok(O.addTrack(none, { phase: 'ship' }, { title: 'Ops', role: 'ops', text: 'Watch it' }));
  assert.ok(/context: commit\nroles: ops\n---/.test(n), 'a new roles line before the end of the front matter');
  assert.strictEqual(M.findStep(M.parse(n), 'watch-it').step.track, 'ops');
  assert.ok(/no front matter/.test(O.addTrack('## P · READ-DO {#p}\n- [ ] {confirm} A {#a}\n', { phase: 'p' }, { title: 'L', role: 'x', text: 'y' }).error), 'nowhere to list it');
  assert.ok(!O.addTrack('## P · READ-DO {#p}\n- [ ] {confirm} A {#a}\n', { phase: 'p' }, { title: 'L', text: 'y' }).error, 'a lane without a role needs no front matter');
});

rule('Parts: renaming a lane or changing its role changes its heading; its steps without a role of their own follow it', () => {
  const ren = ok(O.editTrack(LANES, 'build', 0, { title: 'Website' }));
  same(changes(LANES, ren), { removed: ['### Track: Web @lead {#web}'], added: ['### Track: Website @lead {#web}'] });
  const role = ok(O.editTrack(LANES, 'build', 0, { role: 'qa' }));
  same(changes(LANES, role), { removed: ['### Track: Web @lead {#web}'], added: ['### Track: Web @qa {#web}'] });
  const st = M.parse(role).phases[0].steps;
  same([st[1].roles, st[2].roles], [['qa'], ['qa']], 'Bundle follows the lane; Own already said @qa');
  const none = ok(O.editTrack(LANES, 'build', 0, { role: '' }));
  assert.ok(lines(none).includes('### Track: Web {#web}'));
  const newRole = ok(O.editTrack(LANES, 'build', 1, { role: 'writer' }));
  assert.ok(lines(newRole).includes('roles: lead, qa, writer') && lines(newRole).includes('### Track: Docs @writer {#docs}'));
  assert.ok(O.editTrack(LANES, 'build', 0, { title: '' }).error);
  assert.ok(O.editTrack(LANES, 'build', 0, { title: 'Web' }).same, 'the same name changes nothing');
  assert.ok(O.editTrack(LANES, 'build', 5, { title: 'X' }).error);
});

rule('Parts: deleting a lane either moves its steps up into the phase, keeping who works them, or deletes them with it', () => {
  const keep0 = ok(O.deleteTrack(LANES, 'build', 0, { steps: 'keep' }));
  same(changes(LANES, keep0), { removed: ['### Track: Web @lead {#web}', '- [ ] {confirm} Bundle the app {#bundle}'], added: ['- [ ] {confirm} Bundle the app @lead {#bundle}'] });
  same(M.parse(keep0).phases[0].steps.map(s => [s.id, s.track, s.roles]), [['compile', '', []], ['bundle', '', ['lead']], ['own', '', ['qa']], ['notes', 'docs', ['qa']]]);
  const keep1 = ok(O.deleteTrack(LANES, 'build', 1, { steps: 'keep' }));
  same(M.parse(keep1).phases[0].steps.map(s => [s.id, s.track, s.roles]), [['compile', '', []], ['notes', '', ['qa']], ['bundle', 'web', ['lead']], ['own', 'web', ['qa']]], 'up into the phase, before the first lane');
  assert.ok(/- \[ \] \{confirm\} Compile \{#compile\}\n- \[ \] \{confirm\} Write the notes @qa \{#notes\}\n  > A note on the step\n### Track: Web/.test(keep1), 'with its note');
  assert.strictEqual(M.parse(keep1).phases[0].steps[1].note, 'A note on the step');
  const del = ok(O.deleteTrack(LANES, 'build', 0, {}));
  same(changes(LANES, del), { removed: ['### Track: Web @lead {#web}', '- [ ] {confirm} Bundle the app {#bundle}', '  where: CI', '- [ ] {confirm} Own role @qa {#own}'], added: [] });
  assert.ok(lines(del).includes('<!-- a comment inside the Web lane -->'), 'a comment isn\'t a step; it stays');
  assert.strictEqual(O.deleteTrack(LANES, 'build', 0, {}).steps, 2);
  healthy(LANES, del); healthy(LANES, keep1);
});

rule('Parts: a lane whose heading has a note under it isn\'t deleted, because the note would go to another step', () => {
  const md = LANES.replace('### Track: Docs @qa {#docs}', '### Track: Docs @qa {#docs}\n  > An orphaned note');
  assert.ok(/would also change what other lines mean/.test(O.deleteTrack(md, 'build', 1, { steps: 'keep' }).error));
  const odd = LANES.replace('- [ ] {confirm} Own role @qa {#own}', '- [ ] {confirm} Own role @qa {#own}\n<!-- split -->\n  where: far');
  assert.ok(/Edit it in Markdown/.test(O.deleteTrack(odd, 'build', 0, {}).error), 'a step whose lines are split up');
});

rule('Parts: a gate is added only to a phase without one, and removing one leaves the phase ending with its automatic check', () => {
  const add = ok(O.setGate(RELEASE, 'verify', { title: 'Release done', owner: 'release-lead' }));
  assert.ok(/status: Done\n\n## Gate: Release done · owner @release-lead \{#release-done\}\n$/.test(add));
  const rm = ok(O.removeGate(RELEASE, 'prep'));
  same(changes(RELEASE, rm).added, []);
  same(changes(RELEASE, rm).removed, ['## Gate: Ready to deploy · owner @release-lead {#ready}', '  approves: deploy of `^commit` to ^environment', '']);
  assert.ok(M.parse(rm).phases[0].gate.implicit && /verified\.\n\n## Deploy/.test(rm), 'one blank line between the phases');
  const last = ok(O.removeGate(LANES, 'build'));
  assert.ok(/A note on the step\n\n## Ship/.test(last));
  assert.ok(O.removeGate(RELEASE, 'verify').error, 'no gate to remove');
  const clash = RELEASE.replace('{#rollback}', '{#prep-confirm}');
  assert.ok(/prep-confirm/.test(O.removeGate(clash, 'prep').error), 'its automatic ID is taken');
  same(sorted(ids(rm)), sorted(ids(RELEASE)));
});

rule('Parts: deleting a phase takes its steps, lanes and gate, and leaves one blank line between its neighbors', () => {
  const mid = ok(O.deletePhase(RELEASE, 'deploy'));
  same(M.parse(mid).phases.map(p => p.id), ['prep', 'verify']);
  assert.ok(/to \^environment\n\n## Verify in production/.test(mid));
  same(ids(mid), ids(RELEASE).filter(x => !['merge', 'jenkins', 'approve', 'pods'].includes(x)));
  assert.strictEqual(O.deletePhase(RELEASE, 'deploy').steps, 4);
  const last = ok(O.deletePhase(RELEASE, 'verify'));
  assert.ok(last.endsWith('  approves: `^commit` running in ^environment\n'), 'the file ends as it did, with one line break');
  const q = ok(O.deletePhase(RELEASE + '\n## Questions\n- Who approves?\n', 'verify'));
  assert.ok(/running in \^environment\n\n## Questions\n- Who approves\?\n$/.test(q), 'a Questions section stays');
  const only = ok(O.deletePhase('---\nprocess: a\ntitle: A\n---\n\n## P · READ-DO {#p}\n- [ ] {confirm} A {#a}\n', 'p'));
  assert.strictEqual(only, '---\nprocess: a\ntitle: A\n---\n');
  assert.ok(O.deletePhase(RELEASE, 'nope').error);
});

rule('Parts: a phase can be added first, before every other phase', () => {
  const t = ok(O.addPhase(RELEASE, null, { title: 'Get ready', mode: 'READ-DO', first: true }));
  same(M.parse(t).phases.map(p => p.id), ['get-ready', 'prep', 'deploy', 'verify']);
  assert.ok(/roles: release-lead, qa, backend\n---\n\n## Get ready · READ-DO \{#get-ready\}\n\n## Before production changes/.test(t));
  const empty = ok(O.addPhase('---\nprocess: a\ntitle: A\n---\n', null, { title: 'One', mode: 'READ-DO', first: true }));
  assert.ok(/---\n\n## One · READ-DO \{#one\}\n$/.test(empty), empty);
});

rule('Parts: a part added in this window takes its ID from its first real text; nothing else ever changes an ID', () => {
  const add = O.addStep(RELEASE, { after: 'flags' }, { text: 'New step' });
  const t = ok(O.editStep(add.text, 'new-step', { text: 'Check the dashboards', reid: true }));
  assert.strictEqual(O.editStep(add.text, 'new-step', { text: 'Check the dashboards', reid: true }).id, 'check-the-dashboards');
  same(changes(RELEASE, t).added, ['- [ ] {confirm} Check the dashboards {#check-the-dashboards}']);
  assert.strictEqual(O.editStep(add.text, 'new-step', { text: 'Check the dashboards' }).id, 'new-step', 'without reid the ID stays');
  assert.strictEqual(O.editStep(add.text, 'new-step', { text: 'Approved', reid: true }).id, 'approved-2', 'still unique');
  const ph = O.addPhase(RELEASE, null, { title: 'New phase', mode: 'READ-DO' });
  const pr = O.editPhase(ph.text, 'new-phase', { title: 'Watch', reid: true });
  assert.strictEqual(pr.id, 'watch'); assert.strictEqual(M.parse(pr.text).phases[3].gate.id, 'watch-confirm', 'its automatic gate follows');
  const g = O.setGate(RELEASE, 'verify', { title: 'New gate' }), gr = O.setGate(g.text, 'verify', { title: 'Release done', reid: true });
  assert.strictEqual(gr.id, 'release-done');
  const tr = O.addTrack(RELEASE, { phase: 'deploy' }, { title: 'New lane', role: 'qa', text: 'First step in this lane' });
  const trr = O.editTrack(tr.text, 'deploy', 0, { title: 'Smoke', reid: true });
  assert.strictEqual(trr.id, 'smoke-2');
  assert.strictEqual(M.findStep(M.parse(trr.text), 'first-step-in-this-lane').step.track, 'smoke-2', 'its steps follow the new ID');
});

rule('Parts: each kind of part has its own places, named in words for the preview and for screen readers', () => {
  const step = O.places(RELEASE, 'step'), at = id => step.find(x => x.id === id);
  assert.strictEqual(at('before:jenkins').where, 'after “Merge the release branch to master”, inside Deploy');
  assert.strictEqual(at('before:jenkins').spoken, 'Deploy, after Merge the release branch to master, position 2 of 5');
  assert.strictEqual(at('before:smoke').spoken, 'Verify in production, Product checks lane, at the start, position 1 of 3');
  assert.strictEqual(at('end:verify:1').where, 'after “Close the release ticket”, inside Wrap-up');
  assert.ok(!at('end:verify:-1'), 'no group of its own before the first lane when it has no steps');
  same(O.places(RELEASE, 'gate').map(x => x.id), ['gate:verify'], 'only a phase without a gate');
  same(O.places(RELEASE, 'lanes').map(x => x.id), ['lane:prep:end', 'lane:deploy:end', 'lane:verify:0', 'lane:verify:1', 'lane:verify:end'], 'lanes only where no other step would join them');
  same(O.places(RELEASE, 'phase').map(x => x.spoken), ['Phases, first, before Before production changes, position 1 of 4', 'Phases, after Before production changes, position 2 of 4', 'Phases, after Deploy, position 3 of 4', 'Phases, after Verify in production, position 4 of 4']);
  same(O.places(ok(O.setGate(RELEASE, 'verify', { title: 'Done' })), 'gate'), [], 'every phase has a gate: nowhere for another');
  same(O.places('', 'step'), [], 'no phases: nowhere for a step');
  same(O.places('', 'phase').map(x => x.id), ['phase:^']);
  assert.strictEqual(O.nearest(RELEASE, 'step', { kind: 'step', key: 'flags' }), 'before:rollback', 'just after the selected step');
  assert.strictEqual(O.nearest(RELEASE, 'step', { kind: 'step', key: 'pods' }), 'end:deploy:-1');
  assert.strictEqual(O.nearest(RELEASE, 'lanes', { kind: 'track', key: 'verify', track: 0 }), 'lane:verify:1');
  assert.strictEqual(O.nearest(RELEASE, 'gate', null), 'gate:verify');
  assert.strictEqual(O.nearest(RELEASE, 'phase', { kind: 'phase', key: 'deploy' }), 'phase:deploy');
});

/* The op a part makes at a place, as app.js builds it. */
function placeOp(kind, id) {
  const [k, a, b] = id.split(':');
  if (kind === 'step') return k === 'before' ? { op: 'add', to: { before: a }, text: 'New step' } : { op: 'add', to: { phase: a, track: +b, where: 'end' }, text: 'New step' };
  if (kind === 'lanes') return { op: 'addTrack', to: { phase: a, before: b === 'end' ? null : +b }, title: 'New lane', role: 'lane-role', text: 'First step in this lane' };
  if (kind === 'gate') return { op: 'gate', phase: a, set: { title: 'New gate' } };
  return { op: 'addPhase', after: a === '^' ? null : a, first: a === '^', title: 'New phase', mode: 'READ-DO' };
}
rule('Parts: every place offered for every part, in every example and an awkward draft, takes the part without changing anything else', () => {
  const drafts = MAPS.map(n => [n, example('maps/drafts/' + n + '.md')]).concat([['odd', ODD], ['lanes', LANES], ['lanes-crlf', LANES.replace(/\n/g, '\r\n')]]);
  drafts.forEach(([name, md]) => ['step', 'lanes', 'gate', 'phase'].forEach(kind => O.places(md, kind).forEach(pl => {
    const r = O.apply(md, placeOp(kind, pl.id));
    assert.ok(!r.error, name + ' ' + pl.id + ': ' + r.error);
    healthy(md, r.text, name + ' ' + pl.id);
    assert.ok(ids(md).every(x => ids(r.text).includes(x)), name + ' ' + pl.id + ': every ID kept');
    if (/crlf/.test(name)) assert.ok(!/[^\r]\n/.test(r.text), name + ' ' + pl.id + ': still CRLF');
  })));
});

rule('Parts: the new operations keep CRLF line endings, comments and unicode names, and refuse what would change other lines', () => {
  const crlf = LANES.replace(/\n/g, '\r\n');
  let t = crlf;
  t = ok(O.addTrack(t, { phase: 'ship' }, { title: 'Prüfung ✓ 日本', role: 'qa', text: 'Überprüfen' }));
  t = ok(O.editTrack(t, 'build', 1, { title: 'Docs and notes' }));
  t = ok(O.deleteTrack(t, 'build', 0, { steps: 'keep' }));
  t = ok(O.removeGate(t, 'build'));
  t = ok(O.addPhase(t, null, { title: 'Zero', mode: 'READ-DO', first: true }));
  t = ok(O.deletePhase(t, 'zero'));
  assert.ok(!/[^\r]\n/.test(t), 'every line still ends in CRLF');
  assert.ok(t.includes('<!-- a comment inside the Web lane -->\r\n'), 'the comment is kept');
  const tr = M.parse(t).phases[1].tracks[0];
  same([tr.title, tr.id], ['Prüfung ✓ 日本', 'pr-fung'], 'a unicode name, an ID from the letters it can use');
  assert.strictEqual(O.addTrack(LANES, { phase: 'ship' }, { title: '日本', text: 'ステップ' }).id, 'lane', 'no usable letters: a plain ID');
  const fields = ['## P · READ-DO {#p}', '- [ ] {confirm} A {#a}', '<!-- c -->', '  where: orphaned', ''].join('\n');
  assert.ok(/change what other lines mean/.test(O.addTrack(fields, { phase: 'p' }, { title: 'M', text: 'C' }).error), 'a lane between a step and its separated field is refused');
});

rule('Parts: a place that would take a separated field or note is never offered', () => {
  const md = ['---', 'process: f', 'title: F', '---', '## P · READ-DO {#p}', '- [ ] {confirm} A {#a}', '<!-- c -->', '  where: orphaned', '', '## Q · READ-DO {#q}', '- [ ] {confirm} B {#b}', ''].join('\n');
  assert.ok(!O.places(md, 'step').some(x => x.id === 'end:p:-1'), 'not after A');
  assert.ok(!O.places(md, 'lanes').some(x => x.id === 'lane:p:end'), 'no lane after A');
  assert.ok(O.places(md, 'step').some(x => x.id === 'before:a') && O.places(md, 'gate').some(x => x.id === 'gate:p'), 'the safe places stay (a gate goes after the field)');
});

rule('Builder: a step whose ID is a name objects already have (constructor) keeps it as its key', () => {
  const md = '## P · READ-DO {#p}\n- [ ] {confirm} Build it {#constructor}\n- [ ] {confirm} Check it {#tostring}\n';
  same(O.parse(md).steps.map(s => s.key), ['constructor', 'tostring']);
  assert.strictEqual(O.addStep(md, { phase: 'p' }, { text: 'Constructor' }).id, 'constructor-2', 'and it counts as taken');
});

run();
