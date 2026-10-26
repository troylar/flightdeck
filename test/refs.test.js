// Run-detail references (2.7): what the editor marks in a box, what a run fills in, and what the checks say.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { load, example, exampleSetup, rule, run } = require('./harness');
const PF = load(), M = PF.map, R = PF.run, X = PF.refs;
const EX = exampleSetup(PF);
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const check = t => M.check(M.parse(t), { types: EX.customTypes, workflows: EX.workflows });

const MAP = `---
process: refs-demo
title: Refs demo
owner: person-casey
context: ticket, environment, tag, hotfix:yes-no, mode:choice(^tag|other)
roles: lead
---

## Prepare · READ-DO {#prep}
- [!] {run.command} Build ^ticket for ^enviroment @lead {#build}
  command: grep ^ERROR build.log && echo ^tagg
- [ ] {confirm} Note the tag ^tag {#early}
- [ ] {confirm} Tag the build @lead {#tag-it}
  sets: tag
- [ ] {run.command} Push ^tag {#push}
  command: git push origin ^tag

## Gate: Ready · owner @lead {#ready}
  approves: release of ^tag to ^environment

## Ship · READ-DO {#ship}
- [!] {run.command} Deploy ^tag @lead {#deploy}
  command: deploy --tag ^tag --env ^environment
`;

rule('the token rule is fill()\'s: every ^word a run fills is a token, at the same places', () => {
  const corpus = ['^a', 'x^b-c y', '^^d', 'e^f_g!', '^', 'no refs', 'HEAD^ and ^1', '`^tag`', '^tag.^env', 'üñí^tag'];
  corpus.forEach(c => {
    const names = X.tokens(c).map(t => t.name), filled = [];
    R.fill(c, new Proxy({}, { get: (o, k) => { filled.push(k); return 'V'; } }));
    same(names, filled, c);
    X.tokens(c).forEach(t => assert.strictEqual(c.slice(t.start, t.end), '^' + t.name, c));
  });
});

rule('fill: a ^word that isn\'t a run detail stays as written; a listed detail with no value still says not set', () => {
  assert.strictEqual(R.fill('grep ^ERROR ^ticket ^tag', { ticket: 'T-1', tag: '' }, ['ticket', 'tag']), 'grep ^ERROR T-1 (tag not set)');
  assert.strictEqual(R.fill('git log HEAD^', {}, ['ticket']), 'git log HEAD^');
  // Without names, every ^word is a detail, as before 2.7.
  assert.strictEqual(R.fill('grep ^ERROR', {}), 'grep (ERROR not set)');
});

rule('fill: every caller in the app passes the shown checklist\'s run details', () => {
  const src = ['core/run.js', 'ui/views/run.js', 'ui/views/practice.js', 'ui/app.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
  const calls = src.match(/\bfill\((?!text, details)[^)]*\)/g) || [];
  assert.ok(calls.length >= 4, 'found ' + calls.length);
  calls.forEach(c => assert.ok(/map\.meta\.context\)$/.test(c), c));
});

rule('suggest: the one close name, never a guess between two', () => {
  const names = ['environment', 'ticket', 'tag', 'tags2', 'commit'];
  assert.strictEqual(X.suggest('enviroment', names), 'environment');
  assert.strictEqual(X.suggest('tikcet', names), 'ticket');
  assert.strictEqual(X.suggest('env', names), 'environment');
  assert.strictEqual(X.suggest('tagz', names), 'tag');
  assert.strictEqual(X.suggest('tab', ['tag', 'tap']), '');
  assert.strictEqual(X.suggest('zzzzzz', names), '');
  assert.strictEqual(X.suggest('t', names), '');
});

rule('verdicts: earlier phase is fine, same phase earlier is quiet, before its setter may not be set, the gate waits for its phase', () => {
  const map = M.parse(MAP), all = X.scan(map, { types: EX.customTypes });
  const at = (box, id, name) => all.filter(u => u.name === name && u.where.box === box && (u.where.kind === 'gate' ? u.where.gate.id : u.where.step.id) === id).map(u => u.verdict);
  assert.strictEqual(at('text', 'build', 'ticket')[0].v, 'ok');
  assert.ok(at('text', 'build', 'ticket')[0].start);
  assert.strictEqual(at('text', 'build', 'enviroment')[0].v, 'unknown');
  assert.strictEqual(at('text', 'build', 'enviroment')[0].suggest, 'environment');
  assert.strictEqual(at('field:command', 'build', 'ERROR')[0].v, 'unknown');
  assert.strictEqual(at('field:command', 'build', 'tagg')[0].suggest, 'tag');
  assert.strictEqual(at('text', 'early', 'tag')[0].v, 'maybe-unset');
  assert.strictEqual(at('text', 'push', 'tag')[0].v, 'ok');
  assert.ok(at('text', 'push', 'tag')[0].earlier);
  assert.strictEqual(at('approves', 'ready', 'tag')[0].v, 'ok');
  assert.strictEqual(at('field:command', 'deploy', 'tag')[0].v, 'ok');
  assert.ok(!at('field:command', 'deploy', 'tag')[0].earlier);
});

rule('verdicts: a setter in another track of the same phase, or a later phase, may not be set; a conditional setter is named', () => {
  const t = `---
process: tracks
title: Tracks
context: tag, hotfix:yes-no
roles: a, b
---

## One · READ-DO {#one}
- [ ] {confirm} Decide hotfix {#d}
  sets: hotfix

## Two · READ-DO {#two}
### Track: A @a {#ta}
- [ ] {confirm} Tag it {#t}
  sets: tag
  only when ^hotfix is yes
### Track: B @b {#tb}
- [ ] {run.command} Use it ^tag {#u}
  command: echo ^tag
`;
  const map = M.parse(t);
  same(map.errors.map(e => e.msg), []);
  const u = X.scan(map, {}).filter(x => x.where.step && x.where.step.id === 'u');
  u.forEach(x => assert.strictEqual(x.verdict.v, 'maybe-unset'));
  const sug = M.check(map, {}).suggestions.filter(s => /may not be set/.test(s));
  assert.ok(sug.some(s => s === 'Step "Use it": ^tag may not be set yet here: “Tag it” sets it in this phase (only when ^hotfix is yes).'), sug.join('\n'));
  assert.ok(sug.some(s => /\^tag in "command" may not be set yet/.test(s)), sug.join('\n'));
});

rule('judge: the token under the caret is typing and never marked', () => {
  const map = M.parse(MAP), step = M.findStep(map, 'deploy').step, at = X.atStep(map, step);
  const v = 'Deploy ^ta to ^environment';
  same(X.judge(map, v, at, 10).map(t => t.verdict.v), ['typing', 'ok']);
  same(X.judge(map, v, at).map(t => t.verdict.v), ['unknown', 'ok']);
  same(X.judge(map, v, at, 3).map(t => t.verdict.v), ['unknown', 'ok']);
});

rule('only fields a run fills in are read: sets, carry, process and the timing fields never are', () => {
  const map = M.parse(MAP), boxes = X.scan(map, { types: EX.customTypes }).map(u => u.where.box);
  assert.ok(boxes.indexOf('field:sets') < 0);
  ['sets', 'carry', 'process', 'version', 'expect', 'require', 'evidence', 'at'].forEach(f => assert.ok(!X.fillable('run.process', f), f));
  assert.ok(X.fillable('run.command', 'command'));
  assert.ok(X.fillable('confirm', 'link'));
});

rule('checks: unknown in step text blocks with a did-you-mean; in a field it is advice; maybe-unset is advice', () => {
  const c = check(MAP);
  assert.ok(c.blockers.indexOf('Step "Build for": is tied to ^enviroment, which isn\'t listed in context. Did you mean ^environment?'.replace('": is', '" is')) >= 0, c.blockers.join('\n'));
  assert.ok(c.suggestions.indexOf('Step "Build for": ^ERROR in "command" isn\'t a run detail, so a run shows it as written.') >= 0, c.suggestions.join('\n'));
  assert.ok(c.suggestions.indexOf('Step "Build for": ^tagg in "command" isn\'t a run detail, so a run shows it as written. Did you mean ^tag?') >= 0, c.suggestions.join('\n'));
  assert.ok(c.suggestions.indexOf('Step "Note the tag": ^tag may not be set yet here: “Tag the build” sets it in this phase.') >= 0, c.suggestions.join('\n'));
  assert.ok(!c.blockers.some(b => /ERROR|tagg|may not be set/.test(b)), c.blockers.join('\n'));
  // Same-phase earlier setter, and the gate at the end of the setter's phase, say nothing.
  assert.ok(!c.suggestions.some(s => /Push|Gate "Ready"/.test(s) && /\^tag/.test(s)), c.suggestions.join('\n'));
});

rule('checks: the example folder\'s checklists get no new reference advice', () => {
  fs.readdirSync(path.join(__dirname, '..', 'example-folder', 'maps', 'drafts')).forEach(f => {
    const s = check(example('maps/drafts/' + f)).suggestions.filter(x => /run detail, so|may not be set/.test(x));
    same(s, [], f);
  });
});

/* ---------- editing step text with references in place ---------- */
const O = PF.outline;
const ok = res => { assert.ok(res && !res.error, res && res.error); return res.text; };
const stepLine = (t, id) => t.split('\n').find(l => l.indexOf('{#' + id + '}') >= 0);

rule('editStepText: references stay where they were typed, roles keep their place, ties follow the text', () => {
  const t = ok(O.editStepText(MAP, 'deploy', 'Deploy ^tag to ^environment now'));
  assert.strictEqual(stepLine(t, 'deploy'), '- [!] {run.command} Deploy ^tag to ^environment now @lead {#deploy}');
  const st = M.findStep(M.parse(t), 'deploy').step;
  same(st.binds, ['tag', 'environment']);
  assert.strictEqual(st.text, 'Deploy to now');
  // The same text is no change at all.
  assert.ok(O.editStepText(t, 'deploy', 'Deploy ^tag to ^environment now').same);
});

rule('editStepText: refuses @, IDs, a type, and text that is only references', () => {
  assert.ok(/roles with their buttons/.test(O.editStepText(MAP, 'deploy', 'Deploy @lead').error));
  assert.ok(/IDs/.test(O.editStepText(MAP, 'deploy', 'Deploy {#x}').error));
  assert.ok(/IDs/.test(O.editStepText(MAP, 'deploy', '{confirm} Deploy').error));
  assert.ok(/needs some text/.test(O.editStepText(MAP, 'deploy', '^tag ^environment').error));
  assert.ok(/200/.test(O.editStepText(MAP, 'deploy', 'x'.repeat(201)).error));
});

rule('editStepText: an unknown name can be typed (Checks name it); the old text edit is unchanged', () => {
  const t = ok(O.editStepText(MAP, 'deploy', 'Deploy ^tagg'));
  assert.ok(/\^tagg/.test(stepLine(t, 'deploy')));
  assert.ok(/buttons/.test(O.editStep(MAP, 'deploy', { text: 'Deploy ^tag' }).error));
});

rule('tie buttons: on appends ^name at the end of the line (as before 2.7); off removes every inline use of it', () => {
  const t = ok(O.editStepText(MAP, 'deploy', 'Deploy ^tag to ^environment, ^tag again'));
  const off = ok(O.editStep(t, 'deploy', { bind: 'tag', on: false }));
  assert.strictEqual(stepLine(off, 'deploy'), '- [!] {run.command} Deploy to ^environment, again @lead {#deploy}');
  const on = ok(O.editStep(off, 'deploy', { bind: 'ticket', on: true }));
  assert.ok(/\^ticket \{#deploy\}$/.test(stepLine(on, 'deploy')), stepLine(on, 'deploy'));
});

/* ---------- renaming a run detail ---------- */
rule('renameDetail: every place, kind kept, whole tokens only, condition values and choice options untouched', () => {
  const t0 = MAP.replace('context: ticket, environment, tag, hotfix:yes-no, mode:choice(^tag|other)', 'context: ticket, environment, tag, tags, hotfix:yes-no, mode:choice(^tag|other)')
    .replace('- [ ] {confirm} Note the tag ^tag {#early}', '- [ ] {confirm} Note the tag ^tag and ^tags {#early}\n  only when ^mode is ^tag')
    .replace('## Ship · READ-DO {#ship}', '## Ship · READ-DO {#ship}\n  only when ^tag is set');
  const r = O.renameDetail(t0, 'tag', 'build_tag');
  const t = ok(r);
  const L = t.split('\n');
  assert.ok(L.includes('context: ticket, environment, build_tag, tags, hotfix:yes-no, mode:choice(^tag|other)'), L[4]);
  assert.ok(L.includes('- [ ] {confirm} Note the tag ^build_tag and ^tags {#early}'));
  assert.ok(L.includes('  only when ^mode is ^tag'));
  assert.ok(L.includes('  only when ^build_tag is set'));
  assert.ok(L.includes('  sets: build_tag'));
  assert.ok(L.includes('  approves: release of ^build_tag to ^environment'));
  assert.ok(L.includes('  command: deploy --tag ^build_tag --env ^environment'));
  assert.ok(L.includes('  command: grep ^ERROR build.log && echo ^tagg'));
  assert.strictEqual(r.places, t0.split('\n').filter((l, i) => l !== L[i]).length);
  same(M.parse(t).errors.map(e => e.msg), M.parse(t0).errors.map(e => e.msg));
});

rule('renameDetail: keeps a typed kind; refuses a taken name, a bad name and a vanished one', () => {
  const t = ok(O.renameDetail(MAP, 'hotfix', 'is_hotfix'));
  same(M.parse(t).meta.detailTypes.is_hotfix, M.parse(MAP).meta.detailTypes.hotfix);
  assert.ok(/already a run detail/.test(O.renameDetail(MAP, 'tag', 'ticket').error));
  assert.ok(/one word/.test(O.renameDetail(MAP, 'tag', 'two words').error));
  assert.ok(/isn't listed anymore/.test(O.renameDetail(MAP, 'nope', 'x').error));
  assert.ok(O.renameDetail(MAP, 'tag', '^tag').same);
});

rule('renameDetail: a step that carries the detail to a child it can\'t see still refuses, naming the step', () => {
  const r = O.renameDetail(example('maps/drafts/release.md'), 'commit', 'sha');
  assert.strictEqual(r.error, 'The step “Check in the release notes for this commit” passes ^commit to check-in under this name. Renaming it would stop that.');
});

/* 2.8: with the child known, the rename rewrites carry: and pass: so each child detail gets what it got before. */
const KID = (ctx) => M.parse(['---', 'process: kid', 'title: Kid', 'context: ' + ctx, '---', '', '## Go · READ-DO {#go}', '- [ ] {confirm} Go {#g}', ''].join('\n'));
const LINKED = (ctx, lines) => ['---', 'process: par', 'title: Par', 'context: ' + ctx, '---', '', '## Go · READ-DO {#go}', '- [ ] {run.process} Run the kid {#k}', '  process: kid'].concat(lines || []).concat(['']).join('\n');
const fieldsAfter = (text) => { const f = M.findStep(M.parse(text), 'k').step.fields; return { carry: f.carry, pass: f.pass }; };
const rowsOf = (text, kid) => { const m = M.parse(text); return PF.links.rows(M.findStep(m, 'k').step, m.meta.context, kid).rows.map(r => r.name + '<' + r.source + (r.from ? ':' + r.from : '') + (r.value != null ? '=' + r.value : '')); };
function renamed(ctx, lines, kidCtx, from, to) {
  const t = LINKED(ctx, lines), kid = KID(kidCtx), r = O.renameDetail(t, from, to, { child: () => kid });
  assert.ok(!r.error, r.error);
  const before = rowsOf(t, kid).map(x => x.replace(':' + from, ':' + to));
  same(rowsOf(r.text, kid), before, 'every child detail gets what it got before');
  return fieldsAfter(r.text);
}
rule('renameDetail (2.8): carry: with several names drops the renamed one and passes it under its old name', () => {
  same(renamed('env, tag', ['  carry: env, tag'], 'env, tag', 'env', 'stage'), { carry: 'tag', pass: 'env=^stage' });
});
rule('renameDetail (2.8): carry: with only the renamed name drops carry: and asks every other shared detail', () => {
  same(renamed('env, tag', ['  carry: env'], 'env, tag', 'env', 'stage'), { carry: undefined, pass: 'env=^stage, tag=?' });
});
rule('renameDetail (2.8): implicit sharing gains a bridge; a child that has the new name asks it rather than take it', () => {
  same(renamed('env, tag', [], 'env, tag', 'env', 'stage'), { carry: undefined, pass: 'env=^stage' });
  same(renamed('env, tag', [], 'env, tag, stage', 'env', 'stage'), { carry: undefined, pass: 'env=^stage, stage=?' });
  same(renamed('env', [], 'region', 'env', 'region'), { carry: undefined, pass: 'region=?' }, 'a child with only the new name');
});
rule('renameDetail (2.8): a new pass: line keeps Windows line endings and lands after the step\'s last field', () => {
  const t = LINKED('env, tag', ['  carry: env, tag', '  sets: tag']).replace(/\n/g, '\r\n'), kid = KID('env, tag');
  const r = O.renameDetail(t, 'env', 'stage', { child: () => kid });
  assert.ok(!r.error, r.error);
  assert.ok(/  process: kid\r\n  carry: tag\r\n  sets: tag\r\n  pass: env=\^stage\r\n/.test(r.text), JSON.stringify(r.text));
  assert.ok(!/[^\r]\n/.test(r.text), 'every line ends in CRLF');
});
rule('renameDetail (2.8): existing overrides are kept; a pass: source is renamed in place; an untouched step gets no edit', () => {
  same(renamed('env, tag', ['  pass: env=?, tag=fixed'], 'env, tag', 'env', 'stage'), { carry: undefined, pass: 'tag=fixed' }, 'env stays asked: no bridge; its ? is no longer needed once env isn\'t shared');
  same(renamed('env, tag', ['  pass: region=^env'], 'region, tag', 'env', 'stage'), { carry: undefined, pass: 'region=^stage' });
  const t = LINKED('env, tag', ['  carry: tag']), r = O.renameDetail(t, 'env', 'stage', { child: () => KID('tag') });
  assert.ok(!r.error); same(fieldsAfter(r.text), { carry: 'tag', pass: undefined });
});

rule('renameDetail (2.8): an entry for a name the child doesn\'t have keeps its place with its source renamed; a lone asked entry stays', () => {
  same(renamed('env, tag', ['  pass: removed=^env'], 'tag', 'env', 'stage'), { carry: undefined, pass: 'removed=^stage' });
  same(renamed('env, tag', ['  pass: env=?'], 'env, tag', 'env', 'stage'), { carry: undefined, pass: 'env=?' }, 'still asked, so the start form still opens');
  const t = LINKED('env, tag', ['  carry: env, tag']), r = O.renameDetail(t, 'env', 'stage', { child: () => KID('tag') });
  assert.ok(/lists \^env in carry:, which kid doesn't have/.test(r.error), r.error);
});

const PARENT = (carry, pin) => `---
process: parent
title: Parent
context: tag, other
---

## Go · READ-DO {#go}
- [ ] {run.process} Run the demo {#kid}
  process: refs-demo${carry == null ? '' : '\n  carry: ' + carry}${pin ? '\n  version: ' + pin : ''}
`;
rule('dependents: a Latest parent passing by name (implicit, carry or pass:) is warned with the fix (2.8, Q3); a pinned parent is only mentioned', () => {
  const me = M.parse(MAP), dep = p => X.dependents(me, 'tag', { others: [{ label: 'Parent', map: M.parse(p) }] });
  same(dep(PARENT(null)).map(d => d.refuse), [false]);
  same(dep(PARENT('tag')).map(d => d.refuse), [false]);
  assert.ok(/After you publish the rename, change that step to pass it under the new name/.test(dep(PARENT('tag'))[0].text));
  same(dep(PARENT('other')), []);
  same(dep(PARENT('other').replace('  carry: other', '  carry: other\n  pass: tag=^other')).map(d => d.refuse), [false], 'a pass: target counts');
  same(dep(PARENT(null).replace('  process: refs-demo', '  process: refs-demo\n  pass: tag=?')), [], 'name=? asks it instead');
  const pinned = dep(PARENT(null, '4'));
  same(pinned.map(d => d.refuse), [false]);
  assert.ok(/pinned to version 4/.test(pinned[0].text));
  // Warnings come back as notes; the rename goes ahead.
  same(O.renameDetail(MAP, 'tag', 'b', { depends: dep(PARENT(null)) }).notes, [dep(PARENT(null))[0].text]);
});

rule('dependents: this checklist\'s own linked steps aren\'t refused (the rename rewrites them, 2.8)', () => {
  const parent = M.parse(PARENT(null)), kid = M.parse(MAP);
  same(X.dependents(parent, 'tag', { child: p => p === 'refs-demo' ? kid : null }), []);
  const tied = M.parse(PARENT('other').replace('Run the demo {#kid}', 'Run the demo ^tag {#kid}'));
  same(X.dependents(tied, 'tag', { child: () => kid }), []);
});

rule('dependents: a Jira workflow filling a field from the detail is mentioned, not refused', () => {
  const wf = PF.jira.check({ Story: { statuses: ['To Do', 'Done'], transitions: [{ from: 'To Do', to: 'Done', fields: [{ name: 'Fix version', source: 'detail:tag' }] }] } });
  const t = MAP.replace('## Ship · READ-DO {#ship}', '## Ship · READ-DO {#ship}\n- [ ] {jira.issue} Close it {#close}\n  action: transition\n  issueType: Story\n  status: Done');
  const d = X.dependents(M.parse(t), 'tag', { workflows: wf.workflows });
  same(d.map(x => x.refuse), [false]);
  assert.ok(/Fix version/.test(d[0].text));
});

rule('renameDetail re-signs exactly the steps the signature rules say (listed by hand)', () => {
  const t0 = `---
process: sig
title: Sig
context: tag, risk:choice(low|high), other
---

## A · READ-DO {#a}
- [ ] {confirm} Uses tag ^tag {#s1}
- [ ] {confirm} Plain {#s2}

## B · READ-DO {#b}
- [ ] {confirm} Conditional {#s3}
  only when ^risk is high
- [ ] {confirm} Sibling {#s4}

## C · READ-DO {#c}
- [ ] {confirm} Next phase {#s5}

## D · READ-DO {#d}
- [ ] {run.process} Child {#s6}
  process: other-thing
- [ ] {confirm} Far {#s7}
`;
  const changed = (a, b) => { const A = PF.signature.steps(M.parse(a)), B = PF.signature.steps(M.parse(b)); return Object.keys(A).filter(k => A[k].sig !== B[k].sig).sort(); };
  // ^tag: its tied step, and the implicit-carry step (it signs the whole context).
  same(changed(t0, ok(O.renameDetail(t0, 'tag', 't2'))), ['s1', 's6']);
  // ^risk: tested by s3's condition, so phase B, the phase after it, and the implicit-carry step.
  same(changed(t0, ok(O.renameDetail(t0, 'risk', 'r2'))), ['s3', 's4', 's5', 's6']);
  // ^other: used nowhere, so only the implicit-carry step.
  same(changed(t0, ok(O.renameDetail(t0, 'other', 'o2'))), ['s6']);
  // A gate's approves: signs its phase and the next one, so renaming ^rel there re-signs B's and C's steps (and s6).
  const t1 = t0.replace('context: tag, risk:choice(low|high), other', 'context: tag, risk:choice(low|high), other, rel')
    .replace('## C · READ-DO {#c}', '## Gate: Ship it · owner @lead {#ship}\n  approves: release ^rel\n\n## C · READ-DO {#c}').replace('process: sig', 'process: sig\nroles: lead');
  assert.ok(/approves: release \^r2/.test(ok(O.renameDetail(t1, 'rel', 'r2'))), 'set-up: the gate holds it');
  same(changed(t1, ok(O.renameDetail(t1, 'rel', 'r2'))), ['s3', 's4', 's5', 's6']);
});

rule('review fixes: typed spacing is kept; a rename keeps each reference where it was; a Latest child is read published and as drafted', () => {
  const t0 = `---
process: rv
title: Rv
context: tag, other
---

## A · READ-DO {#a}
- [ ] {confirm} Ship ^tag now {#s1}
- [ ] {run.process} Child {#s2}
  process: kid
`;
  const sp = ok(O.editStepText(t0, O.parse(t0).steps[0].key, 'Run `printf \'a  b\'` for ^tag'));
  assert.ok(/Run `printf 'a  b'` for \^tag \{#s1\}/.test(sp), 'two spaces inside the command stay two');
  const rn = ok(O.renameDetail(t0, 'tag', 'build_tag'));
  same(M.steps(M.parse(rn))[0].step.textParts.map(q => q.t === 'ref' ? '^' + q.k : q.v).join(''), 'Ship ^build_tag now');
  const kid = d => M.parse(`---\nprocess: kid\ntitle: Kid\ncontext: ${d}\n---\n\n## K · READ-DO {#k}\n- [ ] {confirm} K {#k1}\n`);
  const pub = kid('other'), draft = kid('other, tag');
  assert.ok(!X.dependents(M.parse(t0), 'tag', { child: () => [pub] }).some(d => d.refuse), 'set-up: the published child doesn\'t take ^tag');
  // 2.8: its saved draft takes ^tag, so the rename keeps passing it there: the published and drafted details together count.
  const re = ok(O.renameDetail(t0, 'tag', 'build_tag', { child: () => [pub, draft] }));
  same(M.findStep(M.parse(re), 's2').step.fields.pass, 'tag=^build_tag');
  assert.strictEqual(M.findStep(M.parse(ok(O.renameDetail(t0, 'tag', 'build_tag', { child: () => [pub] }))), 's2').step.fields.pass, undefined, 'the published child alone takes nothing named tag');
});

rule('review fixes: rename matches the name exactly, so ^tag and ^TAG stay two details', () => {
  const t0 = `---
process: rc
title: Rc
context: tag, TAG
---

## A · READ-DO {#a}
- [ ] {confirm} Uses ^tag {#s1}
  only when ^TAG is set
- [ ] {confirm} Other {#s2}
  ONLY WHEN ^tag is set
`;
  const t1 = ok(O.renameDetail(t0, 'tag', 'build_tag'));
  assert.ok(/only when \^TAG is set/.test(t1) && /ONLY WHEN \^build_tag is set/.test(t1) && /context: build_tag, TAG/.test(t1), t1);
});

rule('review fixes: rename works on steps without IDs', () => {
  const t0 = `---
process: ni
title: Ni
context: tag
---

## A · READ-DO
- [ ] Build ^tag
- [ ] Ship ^tag now
`;
  const t1 = ok(O.renameDetail(t0, 'tag', 'build_tag'));
  assert.ok(/- \[ \] Build \^build_tag\n- \[ \] Ship \^build_tag now/.test(t1), t1);
});

run();
