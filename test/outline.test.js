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
  assert.ok(/expect: 20m\n### Track: Smoke checks/.test(end.text), 'after the last step, before the gate');
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

// ---------- applying a correction to the draft (corrections slice 2) ----------
const C = PF.corrections, RMAP = M.parse(RELEASE);
let cn = 0;
/* A group of one correction made in a run of the example release, as the process page has it. */
function group(o, map) {
  const n = C.build(Object.assign({ id: 'c' + (++cn), at: '2026-10-17T21:00:00.000Z', by: 'person-blake', map: map || RMAP, version: 1, folder: 'v1-abc' }, o));
  return C.status(C.groups(C.collect([{ process: 'release', id: 'r1', title: 'Release', version: 1, folder: 'v1-abc', _notes: [n] }], 'release')), [])[0];
}
const KINDS = [
  [{ step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes with no restarts' }, 'pods'],
  [{ step: 'flags', op: 'add', where: 'after', text: 'Tell QA the flags are set' }, null],
  [{ step: 'flags', op: 'add', where: 'end', text: 'Tell QA the flags are set' }, null],
  [{ step: 'announce', op: 'move', moveTo: 'start:prep' }, 'announce'],
  [{ step: 'flags', op: 'move', moveTo: 'after:rollback' }, 'flags'],
  [{ step: 'flags', op: 'roles', roles: ['qa'] }, 'flags'],
  [{ step: 'rollback', op: 'remove', why: 'The ticket template has it' }, 'rollback']
];

rule('Applying a correction changes only its own step\'s lines, and the draft then has it', () => {
  KINDS.forEach(([o, id]) => {
    const g = group(o), r = C.review(g, RELEASE);
    assert.strictEqual(r.state, 'clean', o.op + ': ' + r.reason);
    const ch = changes(RELEASE, r.text), own = l => /\{#(\w[\w-]*)\}/.exec(l);
    // Every line it removed or added is the step's own first line, or a new step.
    if (o.op === 'move') {
      // A move takes the step's whole block (its fields and notes) and nothing else: without that block, both read the same.
      const without = t => { const x = O.parse(t), s = x.steps.find(y => y.id === id); return x.lines.slice(0, s.line).concat(x.lines.slice(s.end)).join('\n'); };
      assert.strictEqual(without(r.text), without(RELEASE), o.op);
      same(sorted(lines(r.text)), sorted(lines(RELEASE)));
    } else ch.removed.concat(ch.added).forEach(l => assert.ok(id ? own(l) && own(l)[1] === id : /Tell QA the flags are set/.test(l), o.op + ' touched ' + l));
    healthy(RELEASE, r.text, o.op);
    assert.strictEqual(C.review(g, r.text).state, 'already', o.op + ' is then already in the draft');
  });
  const ids0 = ids(RELEASE), after = C.review(group(KINDS[0][0]), RELEASE).text;
  same(ids(after), ids0, 'every step ID is kept');
});

rule('The comparison says clean, already, changed, gone or manual, and never offers a change it can\'t make', () => {
  const words = group({ step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes with no restarts' });
  assert.strictEqual(C.review(words, RELEASE).state, 'clean');
  same([C.review(words, RELEASE).now.text, C.review(words, RELEASE).result.text], ['New pods stay up with no restarts', 'New pods stay up for 20 minutes with no restarts']);
  // Someone already wrote it, with other spacing.
  const had = RELEASE.replace('New pods stay up with no restarts', 'New pods stay up  for 20 minutes with no restarts');
  assert.strictEqual(C.review(words, had).state, 'already');
  // The step changed since the run's version: a person edits or confirms the result.
  const moved = RELEASE.replace('  command: kubectl get pods -l app=web-app', '  command: kubectl get pods -l app=web-app -w');
  const ch = C.review(words, moved);
  same([ch.state, /changed in the draft/.test(ch.reason), !!ch.text], ['changed', true, true]);
  // The step is gone from the draft.
  const gone = O.apply(RELEASE, { op: 'delete', step: 'pods' }).text;
  assert.strictEqual(C.review(words, gone).state, 'gone');
  // A removal is already made when the step is gone.
  assert.strictEqual(C.review(group({ step: 'pods', op: 'remove', why: 'Covered by the dashboard' }), gone).state, 'already');
  // Screenshots, described problems and suggested fixes from before 1.13 are made by a person in the editor.
  assert.strictEqual(C.review(group({ step: 'pods', op: 'describe', why: 'The command is wrong' }), RELEASE).state, 'manual');
  const legacy = C.groups(C.collect([{ process: 'release', id: 'r1', title: 'R', version: 1, _notes: [{ id: 'fx', kind: 'fix', step: 'pods', text: 'Wrong', at: 'x', by: 'a' }] }], 'release'))[0];
  assert.strictEqual(C.review(legacy, RELEASE).state, 'manual');
  // A change the builder's safety net refuses is manual too, with the builder's reason.
  const odd = RELEASE.replace('- [!] {run.command} New pods stay up with no restarts @backend {#pods}\n', '- [!] {run.command} New pods stay up with no restarts @backend {#pods}\n<!-- x -->\n');
  const r = C.review(words, odd);
  assert.ok(r.state === 'manual' || r.state === 'clean', r.state);
  // Who does it: "anyone" can't be said for one step of a lane with a role.
  const laned = ['---', 'process: release', 'title: T', 'roles: a, b', '---', '', '## P {#p}', '### Track: L @a {#l}', '- [ ] {confirm} One {#one}', ''].join('\n');
  const lmap = M.parse(laned);
  const anyone = group({ step: 'one', op: 'roles', roles: ['b'] }, lmap);
  anyone.change = { op: 'roles', to: [] };
  assert.strictEqual(C.review(anyone, laned).state, 'manual');
});

rule('A person\'s own wording replaces the proposal, through the same checks as the builder', () => {
  const g = group({ step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes with no restarts' });
  const r = C.review(g, RELEASE, 'New pods stay up for 30 minutes');
  same([r.state, r.result.text], ['clean', 'New pods stay up for 30 minutes']);
  assert.strictEqual(C.review(g, RELEASE, 'Ask @backend').state, 'manual', '@roles stay out of the wording');
  const add = group({ step: 'flags', op: 'add', where: 'after', text: 'Tell QA' });
  assert.strictEqual(C.review(add, RELEASE, 'Tell QA and the on-call').result.text, 'Tell QA and the on-call');
});

rule('Undoing an applied correction\'s operations gives back the draft exactly', () => {
  KINDS.filter(([o]) => o.op !== 'remove').forEach(([o]) => {
    const r = C.review(group(o), RELEASE), inv = C.inverse(RELEASE, r.ops, r.added);
    assert.ok(inv, o.op);
    let t = r.text; inv.forEach(op => { t = ok(O.apply(t, op)); });
    assert.strictEqual(t, RELEASE, o.op + ' round-trips');
  });
  const rm = C.review(group({ step: 'rollback', op: 'remove', why: 'x' }), RELEASE);
  assert.strictEqual(C.inverse(RELEASE, rm.ops, rm.added), null, 'a removed step comes back only through the editor\'s Undo');
});

rule('An applied correction records its result, and a later change to that step shows as changed since applied', () => {
  const g = group({ step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes with no restarts' }), text = C.review(g, RELEASE).text;
  const d = Object.assign(C.decision(g, 'person-casey', 'applied', '', '2026-10-17T22:00:00.000Z', { act: 'a1', result: C.outcome(g, text) }), { _file: g.id + '.w.1.json' });
  const clean = C.cleanDecision(JSON.parse(JSON.stringify(d)), 'release', d._file);
  same(clean.result, d.result, 'the result is read back');
  const [ap] = C.status([g], [Object.assign(clean, { _file: d._file })]);
  assert.strictEqual(C.changedSince(ap, text), false);
  assert.strictEqual(C.changedSince(ap, text.replace('for 20 minutes', 'for 25 minutes')), true);
  // A decision without a result (Mark as applied before 1.16) is never flagged.
  const [old] = C.status([g], [Object.assign(C.cleanDecision(Object.assign({}, d, { result: undefined }), 'release'), { _file: 'x.json' })]);
  assert.strictEqual(C.changedSince(old, RELEASE), false);
  // A new step is followed by its ID, even when a person reworded it while applying.
  const add = group({ step: 'flags', op: 'add', where: 'after', text: 'Tell QA' }), ra = C.review(add, RELEASE, 'Tell QA and the on-call');
  const da = C.cleanDecision(JSON.parse(JSON.stringify(C.decision(add, 'a', 'applied', '', 'x', { result: C.outcome(add, ra.text, ra.added) }))), 'release');
  const [aa] = C.status([add], [Object.assign(da, { _file: 'y.json' })]);
  assert.strictEqual(C.changedSince(aa, ra.text), false);
});

rule('A missing step counts as already there only at the place it was asked for', () => {
  const md = ['---', 'process: release', 'title: T', '---', '', '## P {#p}', '- [ ] {confirm} Begin {#begin}', '- [ ] {confirm} Verify {#verify}', '- [ ] {confirm} Finish {#finish}', '', '## Q {#q}', '- [ ] {confirm} Other {#other}', ''].join('\n');
  const map = M.parse(md);
  const after = group({ step: 'finish', op: 'add', where: 'after', text: 'Verify' }, map);
  const r = C.review(after, md);
  assert.strictEqual(r.state, 'clean', 'a "Verify" elsewhere in the phase isn\'t the one asked for');
  assert.strictEqual(C.review(after, r.text).state, 'already');
  const atEnd = group({ step: 'begin', op: 'add', where: 'end', text: 'Verify' }, map);
  assert.strictEqual(C.review(atEnd, md).state, 'clean', 'not at the end of the phase');
  assert.strictEqual(C.review(atEnd, C.review(atEnd, md).text).state, 'already');
  assert.strictEqual(C.review(group({ step: 'begin', op: 'add', where: 'after', text: 'Verify' }, map), md).state, 'already', 'right after it: already there');
});

rule('A correction is made by hand when two steps in the draft share its step\'s ID', () => {
  const md = ['---', 'process: release', 'title: T', '---', '', '## P {#p}', '- [ ] {confirm} Begin {#begin}', '- [ ] {confirm} Finish {#finish}', ''].join('\n');
  const g = group({ step: 'finish', op: 'remove', why: 'Not needed' }, M.parse(md));
  const dup = md.replace('Begin {#begin}', 'Begin {#finish}');
  const r = C.review(g, dup);
  assert.ok(r.state === 'manual' && /share the ID finish|ID finish/.test(r.reason), r.state + ' ' + r.reason);
  const w = group({ step: 'finish', op: 'wording', to: 'Finish it' }, M.parse(md));
  assert.strictEqual(C.review(w, dup).state, 'manual');
});

rule('What a person applied (their own wording) is recognized on the next look, so the correction can be linked', () => {
  const add = group({ step: 'flags', op: 'add', where: 'after', text: 'Verify' });
  const r = C.review(add, RELEASE, 'Verify twice'), applied = C.outcome(add, r.text, r.added);
  assert.strictEqual(C.review(add, r.text).state, 'clean', 'without the record, the original proposal still looks missing');
  const again = C.review(add, r.text, null, { applied });
  same([again.state, again.result.text], ['already', 'Verify twice']);
  assert.strictEqual(C.review(add, RELEASE, null, { applied }).state, 'clean', 'a record that the draft no longer matches is ignored');
  // Moved somewhere else afterwards, the remembered step isn't where it was asked for: the normal review applies.
  const moved = ok(O.apply(r.text, { op: 'moveTo', step: r.added, to: { phase: 'deploy', where: 'end', track: -1 } }));
  assert.strictEqual(C.review(add, moved, null, { applied }).state, 'clean', 'not linked to a step at another place');
  const w = group({ step: 'pods', op: 'wording', to: 'New pods stay up for 20 minutes with no restarts' });
  const rw = C.review(w, RELEASE, 'New pods stay up for 30 minutes');
  assert.strictEqual(C.review(w, rw.text, null, { applied: C.outcome(w, rw.text) }).state, 'already');
});

/* ---------- screenshots (1.19): a step's ![caption](images/…) lines ---------- */
const SHOTS = ['---', 'process: s', 'title: S', '---', '## One · READ-DO {#one}', '- [ ] {confirm} Alpha {#alpha}', '  where: Here', '  ![First](images/s/alpha-1.png)', '  > a note', '  ![Second](images/s/alpha-2.png)', '- [ ] {confirm} Beta {#beta}', ''].join('\n');
const capsOf = (t, id) => M.steps(M.parse(t)).filter(x => x.step.id === id)[0].step.shots.map(s => s.caption);

rule('Outline: a step\'s screenshots are read with their lines', () => {
  const s = O.parse(SHOTS).steps[0];
  same(s.shots.map(x => [x.caption, x.src, x.line]), [['First', 'images/s/alpha-1.png', 7], ['Second', 'images/s/alpha-2.png', 9]]);
});

rule('Outline: adding a screenshot puts one line after the step\'s own lines and changes nothing else', () => {
  const t = ok(O.apply(SHOTS, { op: 'addShot', step: 'alpha', caption: 'Third', src: 'images/s/alpha-3.png' }));
  same(changes(SHOTS, t), { removed: [], added: ['  ![Third](images/s/alpha-3.png)'] });
  assert.ok(lines(t).indexOf('  ![Third](images/s/alpha-3.png)') === lines(t).indexOf('  ![Second](images/s/alpha-2.png)') + 1, 'after the last one');
  same(capsOf(t, 'alpha'), ['First', 'Second', 'Third']);
  const b = ok(O.apply(SHOTS, { op: 'addShot', step: 'beta', caption: 'Only', src: 'images/s/beta-1.png' }));
  same(changes(SHOTS, b), { removed: [], added: ['  ![Only](images/s/beta-1.png)'] });
  same(capsOf(b, 'beta'), ['Only']);
  same(ids(t), ids(SHOTS)); healthy(SHOTS, t);
});

rule('Outline: a screenshot\'s caption is required plain text on one line, without [ or ]; its file must be under images/', () => {
  assert.ok(/caption/.test(O.apply(SHOTS, { op: 'addShot', step: 'alpha', caption: '  ', src: 'images/s/x.png' }).error));
  assert.ok(/Leave out \[ and \]/.test(O.apply(SHOTS, { op: 'addShot', step: 'alpha', caption: 'a ] b', src: 'images/s/x.png' }).error));
  assert.ok(O.apply(SHOTS, { op: 'addShot', step: 'alpha', caption: 'ok', src: '../x.png' }).error);
  assert.ok(O.apply(SHOTS, { op: 'addShot', step: 'alpha', caption: 'ok', src: 'images/s/a b.png' }).error);
  const t = ok(O.apply(SHOTS, { op: 'addShot', step: 'alpha', caption: ' Two\nlines  <b>x</b> ', src: 'images/s/x.png' }));
  assert.ok(lines(t).includes('  ![Two lines <b>x</b>](images/s/x.png)'), 'spaces collapse; text is kept as written (the page escapes it)');
  same(O.caption('  A  b '), { value: 'A b' });
});

rule('Outline: editing a caption, moving and removing a screenshot each change only its own line', () => {
  const e = ok(O.apply(SHOTS, { op: 'editShot', step: 'alpha', shot: 1, caption: 'Renamed' }));
  same(changes(SHOTS, e), { removed: ['  ![Second](images/s/alpha-2.png)'], added: ['  ![Renamed](images/s/alpha-2.png)'] });
  const m = ok(O.apply(SHOTS, { op: 'moveShot', step: 'alpha', shot: 1, dir: 'up' }));
  same(capsOf(m, 'alpha'), ['Second', 'First']);
  assert.ok(lines(m).indexOf('  > a note') === 8 && lines(m)[7] === '  ![Second](images/s/alpha-2.png)', 'the note between them stays put');
  assert.strictEqual(O.apply(SHOTS, { op: 'moveShot', step: 'alpha', shot: 0, dir: 'up' }).error, 'It\'s already first.');
  assert.strictEqual(O.apply(SHOTS, { op: 'moveShot', step: 'alpha', shot: 1, dir: 'down' }).error, 'It\'s already last.');
  const r = ok(O.apply(SHOTS, { op: 'removeShot', step: 'alpha', shot: 0 }));
  same(changes(SHOTS, r), { removed: ['  ![First](images/s/alpha-1.png)'], added: [] });
  assert.ok(O.apply(SHOTS, { op: 'removeShot', step: 'alpha', shot: 5 }).error, 'a screenshot that isn\'t there');
  [e, m, r].forEach(t => { same(ids(t), ids(SHOTS)); healthy(SHOTS, t); });
});

rule('Outline: a step with split lines, or a draft it can\'t read safely, takes no screenshot edits', () => {
  const split = SHOTS.replace('- [ ] {confirm} Beta {#beta}', '<!-- c -->\n  ![Late](images/s/late.png)\n- [ ] {confirm} Beta {#beta}');
  assert.ok(/Edit it in Markdown/.test(O.apply(split, { op: 'addShot', step: 'alpha', caption: 'x', src: 'images/s/x.png' }).error));
  assert.ok(O.apply(SHOTS.replace(/\n/g, '\r'), { op: 'removeShot', step: 'alpha', shot: 0 }).error);
});

/* ---------- 2.0: a phase's note and screenshots, a gate's screenshots ---------- */
const plain = o => JSON.parse(JSON.stringify(o));
const PHASED = ['---', 'process: p', 'title: P', '---', '', '## Prepare {#prep}', '  > Use the scratch server.', '  ![The scratch server](images/p/scratch.png)', '- [ ] {confirm} Look {#look}', '  > Step note.', '',
  '## Gate: Ready {#ready}', '  > Counts match.', '  ![Counts](images/p/counts.png)', '', '## Close {#close}', '- [ ] {confirm} File it {#file}', ''].join('\n');
rule('The builder reads a phase\'s note and screenshots and a gate\'s screenshots as map.js does, and edits elsewhere keep them', () => {
  const o = O.parse(PHASED), ph = o.phases[0];
  assert.strictEqual(ph.notes, 1); assert.deepStrictEqual(plain(ph.shots.map(x => [x.caption, x.src])), [['The scratch server', 'images/p/scratch.png']]);
  assert.deepStrictEqual(plain(ph.gate.shots.map(x => x.src)), ['images/p/counts.png']);
  assert.ok(!ph.odd && !ph.gate.odd);
  /* A step added at the start of the phase goes below the phase's lines, so they stay the phase's. */
  const t = ok(O.apply(PHASED, { op: 'add', to: { phase: 'prep', where: 'start' }, text: 'First' }));
  const m = M.parse(t);
  assert.strictEqual(m.phases[0].note, 'Use the scratch server.'); assert.strictEqual(m.phases[0].shots.length, 1);
  assert.strictEqual(m.phases[0].steps[0].text, 'First'); assert.strictEqual(m.phases[0].steps[0].note, '');
  const tr = ok(O.apply(PHASED, { op: 'addTrack', to: { phase: 'prep' }, title: 'Lane', text: 'Lane step' }));
  assert.strictEqual(M.parse(tr).phases[0].note, 'Use the scratch server.');
  const moved = ok(O.apply(PHASED, { op: 'movePhase', phase: 'close', dir: 'up' }));
  assert.strictEqual(M.parse(moved).phases[1].note, 'Use the scratch server.');
  assert.deepStrictEqual(plain(errors(moved)), []);
});
rule('The builder edits a phase\'s note: add one under the heading, change it (several lines), clear it; nothing else changes', () => {
  const bare = PHASED.replace('  > Use the scratch server.\n', '');
  const a = ok(O.apply(bare, { op: 'phaseNote', phase: 'prep', note: 'Read first.' }));
  assert.deepStrictEqual(plain(changes(bare, a)), { removed: [], added: ['  > Read first.'] });
  assert.strictEqual(lines(a)[lines(a).indexOf('## Prepare {#prep}') + 1], '  > Read first.', 'right under the heading');
  const b = ok(O.apply(PHASED, { op: 'phaseNote', phase: 'prep', note: 'Line one.\nLine two.' }));
  assert.strictEqual(M.parse(b).phases[0].note, 'Line one.\nLine two.');
  assert.deepStrictEqual(plain(changes(PHASED, b)), { removed: ['  > Use the scratch server.'], added: ['  > Line one.', '  > Line two.'] });
  const c = ok(O.apply(PHASED, { op: 'phaseNote', phase: 'prep', note: '  ' }));
  assert.strictEqual(M.parse(c).phases[0].note, ''); assert.deepStrictEqual(plain(changes(PHASED, c)), { removed: ['  > Use the scratch server.'], added: [] });
  assert.ok(O.apply(PHASED, { op: 'phaseNote', phase: 'prep', note: 'Use the scratch server.' }).same);
  assert.ok(O.apply(PHASED, { op: 'phaseNote', phase: 'nope', note: 'x' }).error);
});
rule('The builder adds, captions, moves and removes a phase\'s screenshots and a gate\'s, changing only those lines', () => {
  const a = ok(O.apply(PHASED, { op: 'addShot', phase: 'prep', caption: 'Second', src: 'images/p/two.png' }));
  assert.deepStrictEqual(plain(M.parse(a).phases[0].shots.map(x => x.caption)), ['The scratch server', 'Second']);
  assert.deepStrictEqual(plain(changes(PHASED, a)), { removed: [], added: ['  ![Second](images/p/two.png)'] });
  const b = ok(O.apply(a, { op: 'moveShot', phase: 'prep', shot: 1, dir: 'up' }));
  assert.deepStrictEqual(plain(M.parse(b).phases[0].shots.map(x => x.caption)), ['Second', 'The scratch server']);
  const c = ok(O.apply(b, { op: 'editShot', phase: 'prep', shot: 0, caption: 'Two' }));
  assert.strictEqual(M.parse(c).phases[0].shots[0].caption, 'Two');
  const d = ok(O.apply(c, { op: 'removeShot', phase: 'prep', shot: 0 }));
  assert.strictEqual(d, PHASED);
  const nonote = PHASED.replace('  > Use the scratch server.\n  ![The scratch server](images/p/scratch.png)\n', '');
  const e = ok(O.apply(nonote, { op: 'addShot', phase: 'prep', caption: 'Only', src: 'images/p/only.png' }));
  assert.strictEqual(lines(e)[lines(e).indexOf('## Prepare {#prep}') + 1], '  ![Only](images/p/only.png)');
  const g = ok(O.apply(PHASED, { op: 'addShot', gate: 'prep', caption: 'Lights', src: 'images/p/lights.png' }));
  assert.deepStrictEqual(plain(M.parse(g).phases[0].gate.shots.map(x => x.src)), ['images/p/counts.png', 'images/p/lights.png']);
  assert.ok(O.apply(PHASED, { op: 'addShot', phase: 'prep', caption: 'x', src: '../x.png' }).error);
});

/* ---------- checklist details, notes and the Questions section (1.22.0) ---------- */
const DET = [
  '---', 'process: det', 'title: Details', 'owner: person-casey', 'x-team-key: keep me  ', 'roles:   lead,qa', 'context: ticket, env', '# a comment line', '---', '',
  '## First · READ-DO {#first}',
  '- [ ] {confirm} Alpha @lead {#alpha}',
  '  where: Here',
  '  > a note',
  '  >',
  '  >   indented',
  '- [ ] {confirm} Beta {#beta}',
  '- [ ] {run.command} Gamma {#gamma}',
  '  command: echo ^env',
  '  where: There',
  '',
  '## Gate: Ready · owner @qa {#ready}',
  '  approves: `^ticket`',
  ''
].join('\n');
const metaOf = t => JSON.parse(JSON.stringify(M.parse(t).meta));
const noteOf = (t, id) => M.findStep(M.parse(t), id).step.note;

rule('Details: adding a role or run detail changes only its own front matter line, keeping its spacing', () => {
  const r = ok(O.apply(DET, { op: 'meta', key: 'roles', set: { add: 'backend' } }));
  same(changes(DET, r), { removed: ['roles:   lead,qa'], added: ['roles:   lead, qa, backend'] });
  same(metaOf(r).roles, ['lead', 'qa', 'backend']);
  const c = ok(O.apply(DET, { op: 'meta', key: 'context', set: { add: 'commit' } }));
  same(changes(DET, c), { removed: ['context: ticket, env'], added: ['context: ticket, env, commit'] });
  assert.ok(lines(c).includes('x-team-key: keep me  ') && lines(c).includes('# a comment line'), 'unknown keys and odd lines kept byte for byte');
  [r, c].forEach(t => { same(ids(t), ids(DET)); healthy(DET, t); });
});

rule('Details: a key without a line is added above the closing ---, and CRLF drafts keep their line endings', () => {
  const noRoles = DET.replace('roles:   lead,qa\n', '').replace(/@lead /, '').replace(' · owner @qa', '');
  const t = ok(O.apply(noRoles, { op: 'meta', key: 'roles', set: { add: 'lead' } }));
  same(changes(noRoles, t), { removed: [], added: ['roles: lead'] });
  assert.strictEqual(lines(t)[lines(t).indexOf('roles: lead') + 1], '---');
  const crlf = DET.replace(/\n/g, '\r\n'), u = ok(O.apply(crlf, { op: 'meta', key: 'context', set: { add: 'tag' } }));
  assert.strictEqual(u, crlf.replace('context: ticket, env\r\n', 'context: ticket, env, tag\r\n'));
  const b = ok(O.apply(crlf, { op: 'meta', key: 'backup', set: { value: 'person-avery' } }));
  assert.strictEqual(b, crlf.replace('# a comment line\r\n---', '# a comment line\r\nbackup: person-avery\r\n---'));
  const none = '## First · READ-DO {#first}\n- [ ] {confirm} Alpha {#alpha}\n';
  const f = ok(O.apply(none, { op: 'meta', key: 'owner', set: { value: 'person-casey' } }));
  assert.strictEqual(f, '---\nowner: person-casey\n---\n' + none, 'a draft without front matter gets one');
  assert.ok(/front matter/.test(O.apply('---\nprocess: x\n## First\n', { op: 'meta', key: 'owner', set: { value: 'p' } }).error), 'unclosed front matter is refused');
});

rule('Details: removing a name rewrites its line; the last one removes the line; one in use is refused with what uses it', () => {
  const free = DET.replace('  approves: `^ticket`', '  approves: it');
  const c = ok(O.apply(free, { op: 'meta', key: 'context', set: { remove: 'ticket' } }));
  same(changes(free, c), { removed: ['context: ticket, env'], added: ['context: env'] });
  assert.ok(/\^ticket/.test(O.apply(DET, { op: 'meta', key: 'context', set: { remove: 'ticket' } }).error), 'a gate approves it');
  assert.ok(/\^env/.test(O.apply(DET, { op: 'meta', key: 'context', set: { remove: 'env' } }).error), 'a field value uses ^env');
  assert.ok(/@lead/.test(O.apply(DET, { op: 'meta', key: 'roles', set: { remove: 'lead' } }).error), 'a step uses it');
  assert.ok(/@qa/.test(O.apply(DET, { op: 'meta', key: 'roles', set: { remove: 'qa' } }).error), 'a gate owner uses it');
  const one = free.replace('context: ticket, env', 'context: ticket').replace('echo ^env', 'echo');
  const gone = ok(O.apply(one, { op: 'meta', key: 'context', set: { remove: 'ticket' } }));
  same(changes(one, gone), { removed: ['context: ticket'], added: [] });
  const ow = ok(O.apply(DET, { op: 'meta', key: 'owner', set: { value: '' } }));
  same(changes(DET, ow), { removed: ['owner: person-casey'], added: [] });
  assert.strictEqual(metaOf(ow).owner, undefined);
  assert.ok(O.apply(DET, { op: 'meta', key: 'roles', set: { remove: 'nobody' } }).error, 'a name that isn\'t listed');
});

rule('Details: clearing the last of duplicate lines keeps an empty line, so the earlier value never comes back', () => {
  const dup = DET.replace('owner: person-casey', 'owner: person-old\nbackup: person-b1\ncontext: old-one\nowner: person-casey\nbackup: person-b2');
  const o = ok(O.apply(dup, { op: 'meta', key: 'owner', set: { value: '' } }));
  same(changes(dup, o), { removed: ['owner: person-casey'], added: ['owner:'] });
  assert.strictEqual(metaOf(o).owner, '');
  const b = ok(O.apply(dup, { op: 'meta', key: 'backup', set: { value: 'person-avery' } }));
  same(changes(dup, b), { removed: ['backup: person-b2'], added: ['backup: person-avery'] });
  const twice = dup.replace('roles:   lead,qa', 'roles: lead\nroles: lead,qa');
  const r = ok(O.apply(twice, { op: 'meta', key: 'roles', set: { add: 'ops' } }));
  same(changes(twice, r), { removed: ['roles: lead,qa'], added: ['roles: lead, qa, ops'] });
  const lone = dup.replace('  approves: `^ticket`', '  approves: it').replace('echo ^env', 'echo').replace('context: ticket, env', 'context: ticket');
  const c = ok(O.apply(lone, { op: 'meta', key: 'context', set: { remove: 'ticket' } }));
  same(changes(lone, c), { removed: ['context: ticket'], added: ['context:'] });
  same(metaOf(c).context, []);
});

rule('Details: hostile names and values are refused before anything is written', () => {
  ['__proto__', 'constructor', 'toString', 'a,b', 'a b', 'two\nlines', 'x'.repeat(61), '', ' ', '^x', '@x'].forEach(n => {
    assert.ok(O.apply(DET, { op: 'meta', key: 'roles', set: { add: n } }).error, 'role ' + JSON.stringify(n));
    assert.ok(O.apply(DET, { op: 'meta', key: 'context', set: { add: n } }).error, 'detail ' + JSON.stringify(n));
  });
  [42, null, undefined, {}, ['lead'], { toString: () => 'lead' }].forEach(n => {
    assert.ok(O.apply(DET, { op: 'meta', key: 'roles', set: { add: n } }).error, 'non-string ' + String(n));
    assert.ok(O.apply(DET, { op: 'meta', key: 'owner', set: { value: n } }).error, 'non-string owner ' + String(n));
  });
  ['two\nlines', 'a b', 'x'.repeat(81), '#x', '__proto__'].forEach(v => assert.ok(O.apply(DET, { op: 'meta', key: 'owner', set: { value: v } }).error, 'owner ' + JSON.stringify(v)));
  ['process', 'title', 'format', 'features', '__proto__', 'constructor', 'group'].forEach(k => assert.ok(O.apply(DET, { op: 'meta', key: k, set: { value: 'x' } }).error, 'key ' + k));
  assert.ok(/already/.test(O.apply(DET, { op: 'meta', key: 'roles', set: { add: 'qa' } }).error), 'a duplicate');
  assert.ok(O.apply(DET.replace('context: ticket, env', 'context: ' + Array.from({ length: 40 }, (_, i) => 'd' + i).join(', ')), { op: 'meta', key: 'context', set: { add: 'one-more' } }).error, 'at most 40 run details');
  const same1 = O.apply(DET, { op: 'meta', key: 'owner', set: { value: 'person-casey' } });
  assert.ok(same1.same && same1.text === DET, 'the same value is no change');
});

rule('Notes: a step\'s note is replaced in place, its indent kept; blank and indented lines round-trip exactly', () => {
  assert.strictEqual(noteOf(DET, 'alpha'), 'a note\n\n  indented');
  const n = ok(O.apply(DET, { op: 'note', step: 'alpha', text: 'new first\n\n  still indented\n> quoted' }));
  same(changes(DET, n), { removed: ['  > a note', '  >   indented'], added: ['  > new first', '  >   still indented', '  > > quoted'] });
  assert.strictEqual(noteOf(n, 'alpha'), 'new first\n\n  still indented\n> quoted');
  const t = ok(O.apply(DET, { op: 'note', step: 'beta', text: 'Beta\'s note\n' }));
  same(changes(DET, t), { removed: [], added: ['  > Beta\'s note', '  >'] });
  assert.strictEqual(noteOf(t, 'beta'), 'Beta\'s note\n', 'a trailing empty line is kept, as the parser reads it');
  const g = ok(O.apply(DET, { op: 'note', step: 'gamma', text: 'After the fields' }));
  assert.strictEqual(lines(g)[lines(g).indexOf('  where: There') + 1], '  > After the fields', 'at the end of the step\'s block');
  const e = ok(O.apply(DET, { op: 'note', step: 'alpha', text: '\n\n' }));
  same(changes(DET, e), { removed: ['  > a note', '  >', '  >   indented'], added: [] });
  const s = O.apply(DET, { op: 'note', step: 'alpha', text: '\n\na note\n\n  indented' });
  assert.ok(s.same, 'leading blank lines are dropped (the parser drops them), so this is the same note');
  const ws = DET.replace('  > a note\n  >\n', '  >  \n  > a note\n');
  assert.strictEqual(noteOf(ws, 'alpha'), ' \na note\n  indented', 'a leading line with a space is content');
  assert.ok(O.apply(ws, { op: 'note', step: 'alpha', text: ' \na note\n  indented' }).same, 'unchanged');
  const w2 = ok(O.apply(ws, { op: 'note', step: 'alpha', text: ' \na note' }));
  assert.strictEqual(noteOf(w2, 'alpha'), ' \na note', 'kept when edited too');
  const crlf = DET.replace(/\n/g, '\r\n'), c = ok(O.apply(crlf, { op: 'note', step: 'alpha', text: 'x\r\ny' }));
  assert.strictEqual(c, crlf.replace('  > a note\r\n  >\r\n  >   indented\r\n', '  > x\r\n  > y\r\n'));
  [n, t, g, e].forEach(x => { same(ids(x), ids(DET)); healthy(DET, x); });
});

rule('Notes: note lines split by fields are gathered at the first one; odd steps and hostile values are refused', () => {
  const split = DET.replace('  where: Here\n  > a note', '  > a note\n  where: Here');
  const t = ok(O.apply(split, { op: 'note', step: 'alpha', text: 'one\ntwo' }));
  assert.ok(/- \[ \] \{confirm\} Alpha @lead \{#alpha\}\n  > one\n  > two\n  where: Here\n- \[ \] \{confirm\} Beta/.test(t), t);
  assert.strictEqual(noteOf(t, 'alpha'), 'one\ntwo');
  const odd = DET.replace('- [ ] {confirm} Beta {#beta}', '<!-- c -->\n  > stray\n- [ ] {confirm} Beta {#beta}');
  assert.ok(/Markdown/.test(O.apply(odd, { op: 'note', step: 'alpha', text: 'x' }).error) || O.apply(odd, { op: 'note', step: 'alpha', text: 'x' }).error);
  [42, null, {}, ['x']].forEach(v => assert.ok(O.apply(DET, { op: 'note', step: 'alpha', text: v }).error, 'non-string ' + String(v)));
  assert.ok(O.apply(DET, { op: 'note', step: 'nope', text: 'x' }).error);
  assert.ok(/2000|long/.test(O.apply(DET, { op: 'note', step: 'alpha', text: 'x'.repeat(2001) }).error));
});

const QS = [
  '---', 'process: q', 'title: Q', '---', '',
  '## First · READ-DO {#first}', '- [ ] {confirm} Alpha {#alpha}', '',
  '## Questions for the owner', '', '- Who signs off?', '### Not a track', '- When?', '', ''
].join('\n');

rule('Questions: the section\'s text is edited below its heading, leading blank line and all; a heading or track line is refused', () => {
  const o = O.parse(QS);
  assert.strictEqual(o.qText, '\n- Who signs off?\n### Not a track\n- When?');
  const t = ok(O.apply(QS, { op: 'questions', text: '\n- Who signs off? Casey.\n- When? Fridays.' }));
  same(changes(QS, t), { removed: ['- Who signs off?', '### Not a track', '- When?'], added: ['- Who signs off? Casey.', '- When? Fridays.'] });
  assert.ok(t.endsWith('- When? Fridays.\n\n'), 'the blank lines after it stay');
  ['## Phase', '##\tQuestions again', 'x\n## Next · READ-DO', '### Track: Sneaky', '###\tTRACK:  x'].forEach(v => assert.ok(O.apply(QS, { op: 'questions', text: v }).error, JSON.stringify(v)));
  [42, null, {}].forEach(v => assert.ok(O.apply(QS, { op: 'questions', text: v }).error));
  assert.ok(O.apply(DET, { op: 'questions', text: 'x' }).error, 'no section');
  assert.ok(M.check(M.parse(t), {}).blockers.some(b => /Questions/.test(b)), 'still there until it\'s removed');
});

rule('Questions: Remove section takes out exactly its lines, at the end or before a phase, tabs and case included', () => {
  const r = ok(O.apply(QS, { op: 'removeQuestions' }));
  assert.strictEqual(r, QS.slice(0, QS.indexOf('## Questions')));
  assert.ok(!M.parse(r).questions && !M.check(M.parse(r), {}).blockers.some(b => /Questions/.test(b)));
  const mid = QS.replace('## Questions for the owner', '##\tQUESTIONS {#qs}') + '##\tSecond · READ-DO {#second}\n- [ ] {confirm} Beta {#beta}\n';
  const m = ok(O.apply(mid, { op: 'removeQuestions' }));
  assert.ok(/\{#alpha\}\n\n##\tSecond · READ-DO \{#second\}\n- \[ \] \{confirm\} Beta \{#beta\}\n$/.test(m), JSON.stringify(m));
  same(ids(m), ['alpha', 'beta'], 'the steps after it are read now');
  assert.strictEqual(O.apply(mid, { op: 'removeQuestions' }).later, 1, 'it says how many phases after it are read now');
  assert.strictEqual(O.apply(QS, { op: 'removeQuestions' }).later, 0);
  const two = QS + '## Questions, again\n- More?\n';
  const a = ok(O.apply(two, { op: 'removeQuestions' }));
  assert.ok(/## Questions, again/.test(a) && M.parse(a).questions, 'one section at a time');
  assert.ok(O.apply(DET, { op: 'removeQuestions' }).error, 'nothing to remove');
  const crlf = QS.replace(/\n/g, '\r\n');
  assert.strictEqual(ok(O.apply(crlf, { op: 'removeQuestions' })), crlf.slice(0, crlf.indexOf('## Questions')));
});

rule('Builder: "only when" lines stay with their phase or step through moves, adds and deletes', () => {
  const md = ['---', 'process: c', 'title: C', 'context: risk:choice(low|high), hot:yes-no', '---', '',
    '## First {#first}', '  only when ^hot is yes', '- [ ] {confirm} Alpha {#alpha}', '  only when ^risk is high', '- [ ] {confirm} Beta {#beta}', '',
    '## Second {#second}', '- [ ] {confirm} Gamma {#gamma}', '  only when ^risk is low', '- [ ] {confirm} Delta {#delta}', ''].join('\n');
  const whens = (t) => { const m = M.parse(t); same(m.errors.map(e => e.msg), []); const o = {}; m.phases.forEach(p => { o[p.id] = (p.when || []).map(w => w.text); p.steps.forEach(x => { o[x.id] = (x.when || []).map(w => w.text); }); }); return JSON.stringify(o); };
  const want = (t, o) => { const got = JSON.parse(whens(t)); Object.keys(o).forEach(k => assert.deepStrictEqual(got[k], o[k], k + ' in\n' + t)); };
  want(md, { first: ['^hot is yes'], alpha: ['^risk is high'], beta: [], gamma: ['^risk is low'], delta: [] });
  const down = ok(O.moveStep(md, 'alpha', 1));
  want(down, { first: ['^hot is yes'], alpha: ['^risk is high'], beta: [] });
  same(ids(down).slice(0, 2), ['beta', 'alpha']);
  const across = ok(O.moveStep(md, 'gamma', -1));
  want(across, { first: ['^hot is yes'], gamma: ['^risk is low'], second: [] });
  const phases = ok(O.movePhase(md, 'second', -1));
  want(phases, { first: ['^hot is yes'], second: [], alpha: ['^risk is high'], gamma: ['^risk is low'] });
  const added = ok(O.addStep(md, { phase: 'first', where: 'end' }, { text: 'Epsilon', type: 'confirm' }));
  want(added, { first: ['^hot is yes'], alpha: ['^risk is high'], beta: [], epsilon: [] });
  const gone = ok(O.deleteStep(md, 'alpha'));
  assert.ok(!/\^risk is high/.test(gone), 'the step\'s condition goes with it');
  want(gone, { first: ['^hot is yes'], beta: [] });
  assert.strictEqual(ok(O.moveStep(down, 'alpha', -1)), md, 'and back again gives the original');
});

/* ---------- Conditions in the builder (2.1): a phase's or step's "only when" lines, edited in place ---------- */
const CW = ['---', 'process: c', 'title: C', 'context: risk:choice(low|high), hot:yes-no, amount:number, path:choice(slow|fast)', '---', '',
  '## First {#first}', '  only when ^hot is yes', '  > Read this first.', '- [ ] {confirm} Alpha {#alpha}', '  only when ^risk is high', '  > A note.', '- [ ] {confirm} Beta {#beta}', '',
  '## Second {#second}', '- [ ] {confirm} Gamma {#gamma}', '  sets: path', '- [ ] {confirm} Delta {#delta}', ''].join('\n');
const whenOf = (t, id) => { let w = null; M.parse(t).phases.forEach(p => { if (p.id === id) w = p.when; p.steps.forEach(x => { if (x.id === id) w = x.when; }); }); return (w || []).map(x => x.text); };

rule('Builder conditions: the outline reads each phase\'s and step\'s "only when" texts, as written', () => {
  const o = O.parse(CW), first = o.phases[0], alpha = o.steps[0], beta = o.steps[1];
  same(first.when, ['^hot is yes']); same(alpha.when, ['^risk is high']); same(beta.when, []);
  assert.ok(!first.whenOdd && !alpha.whenOdd, 'written the usual way');
  const odd = O.parse(CW.replace('  only when ^risk is high', '    Only When   ^risk is high'));
  same(odd.steps[0].when, ['^risk is high']); assert.ok(odd.steps[0].whenOdd, 'written another way: shown, never rewritten');
});

rule('Builder conditions: add, change and remove on a step and a phase change only those lines, and round-trip exactly', () => {
  const add = ok(O.apply(CW, { op: 'when', step: 'beta', text: '^risk is low' }));
  same(changes(CW, add), { removed: [], added: ['  only when ^risk is low'] });
  assert.strictEqual(lines(add)[lines(add).indexOf('- [ ] {confirm} Beta {#beta}') + 1], '  only when ^risk is low', 'right under the step');
  same(whenOf(add, 'beta'), ['^risk is low']);
  assert.strictEqual(ok(O.apply(add, { op: 'when', step: 'beta', text: '' })), CW, 'removing it gives the original back');
  const two = ok(O.apply(CW, { op: 'when', step: 'alpha', text: '^risk is high\n\nonly when ^amount is at least 10000\n' }));
  same(changes(CW, two), { removed: [], added: ['  only when ^amount is at least 10000'] });
  same(whenOf(two, 'alpha'), ['^risk is high', '^amount is at least 10000']);
  const changed = ok(O.apply(two, { op: 'when', step: 'alpha', text: '^risk is low\n^amount is at least 10000' }));
  same(changes(two, changed), { removed: ['  only when ^risk is high'], added: ['  only when ^risk is low'] });
  const ph = ok(O.apply(CW, { op: 'when', phase: 'second', text: '^hot is no' }));
  same(changes(CW, ph), { removed: [], added: ['  only when ^hot is no'] });
  assert.strictEqual(lines(ph)[lines(ph).indexOf('## Second {#second}') + 1], '  only when ^hot is no', 'right under the heading');
  assert.strictEqual(ok(O.apply(ph, { op: 'when', phase: 'second', text: '  ' })), CW);
  const off = ok(O.apply(CW, { op: 'when', phase: 'first', text: '' }));
  same(changes(CW, off), { removed: ['  only when ^hot is yes'], added: [] });
  const sameRes = O.apply(CW, { op: 'when', step: 'alpha', text: '^risk is high' });
  assert.ok(sameRes.same && sameRes.text === CW, 'unchanged text is no edit');
  assert.ok(O.apply(CW, { op: 'when', step: 'alpha', text: 'only when ^risk is high\n' }).same, '"only when" typed in front is the same condition');
});

rule('Builder conditions: what it writes is what was typed (not respelled), and CRLF files keep CRLF', () => {
  const typed = ok(O.apply(CW, { op: 'when', step: 'beta', text: '^risk is HIGH' }));
  same(changes(CW, typed).added, ['  only when ^risk is HIGH']);
  same(whenOf(typed, 'beta'), ['^risk is high'], 'read canonically, written as typed');
  const crlf = CW.replace(/\n/g, '\r\n'), c2 = ok(O.apply(crlf, { op: 'when', step: 'beta', text: '^risk is low' }));
  assert.ok(/Beta \{#beta\}\r\n  only when \^risk is low\r\n/.test(c2), JSON.stringify(c2));
  assert.strictEqual(c2.split('\n').filter(l => !/\r$/.test(l)).length, 1, 'every line but the last ends in CRLF');
  assert.strictEqual(ok(O.apply(c2, { op: 'when', step: 'beta', text: '' })), crlf);
  /* CRLF without a final line break: the last step gets a condition, changed and removed, and every result stays CRLF. */
  const end = crlf.replace(/\r\n$/, ''), noCr = t => assert.ok(!/\r(?!\n)/.test(t), JSON.stringify(t.slice(-80)));
  const e1 = ok(O.apply(end, { op: 'when', step: 'delta', text: '^risk is low' }));
  noCr(e1); assert.ok(/Delta \{#delta\}\r\n  only when \^risk is low$/.test(e1), JSON.stringify(e1.slice(-60)));
  const e2 = ok(O.apply(e1, { op: 'when', step: 'delta', text: '^risk is high' })); noCr(e2); assert.ok(/  only when \^risk is high$/.test(e2));
  const e3 = ok(O.apply(e2, { op: 'when', step: 'delta', text: '^risk is high\n^hot is yes' })); noCr(e3); assert.ok(/high\r\n  only when \^hot is yes$/.test(e3));
  assert.strictEqual(ok(O.apply(e3, { op: 'when', step: 'delta', text: '' })), end, 'removed: the original, byte for byte');
  assert.ok(!O.parse(e3).unsupported);
});

rule('Builder conditions: a wrong condition, a fifth one, or one a later phase sets is refused with the reason', () => {
  assert.ok(/isn't listed in context/.test(O.apply(CW, { op: 'when', step: 'beta', text: '^nope is set' }).error));
  assert.ok(/choices \(low, high\)/.test(O.apply(CW, { op: 'when', step: 'beta', text: '^risk is medium' }).error));
  assert.ok(/Write a condition as/.test(O.apply(CW, { op: 'when', step: 'beta', text: 'risk is high' }).error));
  assert.ok(/at most 4/.test(O.apply(CW, { op: 'when', step: 'beta', text: '^risk is high\n^hot is yes\n^amount is set\n^path is set\n^risk is set' }).error));
  assert.ok(/later one \(sets:\)/.test(O.apply(CW, { op: 'when', phase: 'second', text: '^path is fast' }).error), 'forward only');
  assert.ok(/later one \(sets:\)/.test(O.apply(CW, { op: 'when', step: 'beta', text: '^path is fast' }).error));
  assert.ok(/Write a condition as/.test(O.apply(CW, { op: 'when', step: 'alpha', text: 'only when' }).error), 'a line with only "only when" is refused, never read as removing the condition');
  assert.ok(/Write a condition as/.test(O.apply(CW, { op: 'when', step: 'alpha', text: '^risk is high\n  only when  ' }).error));
  /* A draft already holding a forward-only error: changing that condition to another one on the same detail is still refused. */
  const bad = CW.replace('- [ ] {confirm} Alpha {#alpha}\n  only when ^risk is high', '- [ ] {confirm} Alpha {#alpha}\n  only when ^risk is high\n  sets: risk');
  assert.ok(M.parse(bad).errors.some(e => /later one/.test(e.msg)), 'set-up');
  assert.ok(/later one \(sets:\)/.test(O.apply(bad, { op: 'when', step: 'alpha', text: '^risk is low' }).error));
  const long = '^risk is one of ' + Array.from({ length: 2 }, () => 'low').join('|');
  assert.ok(O.apply(CW, { op: 'when', step: 'beta', text: long }).error, 'set-up: a value listed twice');
});

rule('Builder conditions: lines written another way, or a block the builder can\'t change safely, are never rewritten', () => {
  const odd = CW.replace('  only when ^risk is high', '    only when ^risk is high');
  assert.ok(/Edit (it|them) in Markdown/.test(O.apply(odd, { op: 'when', step: 'alpha', text: '^risk is low' }).error));
  const caps = CW.replace('  only when ^hot is yes', '  Only when ^hot is yes');
  assert.ok(/Edit (it|them) in Markdown/.test(O.apply(caps, { op: 'when', phase: 'first', text: '' }).error));
  const trail = CW.replace('  only when ^risk is high', '  only when ^risk is high  ');
  assert.ok(/Edit (it|them) in Markdown/.test(O.apply(trail, { op: 'when', step: 'alpha', text: '^risk is high\n^hot is yes' }).error));
  assert.ok(O.apply(odd, { op: 'when', step: 'beta', text: '^risk is low' }).text, 'another step is fine');
  assert.ok(O.apply(CW, { op: 'when', step: 'nope', text: '^risk is low' }).error, 'gone');
});

rule('Builder conditions: a step moved keeps its conditions', () => {
  const down = ok(O.moveStep(CW, 'alpha', 1));
  same(whenOf(down, 'alpha'), ['^risk is high']);
});

run();
