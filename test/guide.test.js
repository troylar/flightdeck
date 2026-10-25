// The entry-box guide (docs/design.md section 37): every box has a question, an example its own control accepts, and a why
// that says only what the code does and ends with what an empty box means. Display only: definitions, signatures and every
// file, receipt, log, brief and --json output stay as 2.4.0 made them.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const H = require('./harness'), { loadViews, example, exampleSetup, exactOf, rule, run } = H;
const { golden } = require('./entry-golden');
const PF = loadViews(), T = PF.types, G = PF.guide, M = PF.map, O = PF.outline, R = PF.run, P = PF.publish, V = PF.views;
const EX = exampleSetup(PF), people = JSON.parse(example('people.json'));
const NOW = '2026-10-17T21:00:00.000Z';
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const S = 'Shown with the step to whoever does it, and to an assistant doing it.', RCPT = 'Saved in the run and on its receipt.';
const chooses = d => !!d && (d.kind === 'choice' || !!d.optionsFrom || d.kind === 'yes-no');
const CHIPS = { require: 1, sets: 1 };
const entry = x => assert.ok(x && typeof x.q === 'string' && x.q && typeof x.why === 'string' && x.why, 'an entry with a question and a why: ' + JSON.stringify(x));

/* ---------- coverage ---------- */
rule('Guide: every built-in type\'s every field and record field, every common field, evidence kind and pin has a question, an example (unless it\'s a choice) and a why', () => {
  assert.ok(G, 'PF.guide exists');
  let n = 0;
  T.LIST.forEach(t => {
    Object.keys(t.fields).forEach(f => {
      const x = (G.FIELDS[t.id] || {})[f]; entry(x); n++;
      if (!chooses(t.fields[f])) assert.ok(x.eg, t.id + ' · ' + f + ' has an example');
    });
    t.record.forEach(d => {
      const x = (G.RECORD[t.id] || {})[d.name]; entry(x); n++;
      if (!chooses(d)) assert.ok(x.eg, t.id + ' ⏺ ' + d.name + ' has an example');
    });
  });
  Object.keys(T.COMMON).forEach(f => { entry(G.COMMON[f]); n++; if (!chooses(T.COMMON[f]) && !CHIPS[f]) assert.ok(G.COMMON[f].eg, f + ' has an example'); });
  T.EVIDENCE_KINDS.forEach(k => { entry(G.EVIDENCE[k]); n++; if (k !== 'yes-no') assert.ok(G.EVIDENCE[k].eg, 'evidence ' + k + ' has an example'); });
  Object.keys(T.PINS).forEach(id => Object.keys(T.PINS[id]).forEach(f => { entry(G.FIELDS[id][f]); assert.ok(G.FIELDS[id][f].eg, 'pin ' + f + ' has an example'); n++; }));
  ['text', 'roles', 'binds', 'note'].forEach(k => { entry(G.step(k)); n++; });
  assert.ok(n >= 110, 'all of them: ' + n);
});

/* Every box the editor draws is one the guide covers: a new box without an entry fails here. */
const BOX = {
  'ob-text': ['step', 'text'], 'ob-new-text': ['step', 'text'], 'ob-note': ['step', 'note'], 'ob-when': ['form', 'when'], 'ob-ph-when': ['form', 'ph-when'],
  'ob-shot-new': ['form', 'caption'], 'ob-shot-cap-': ['form', 'caption'], 'ob-ph-title': ['form', 'ph-title'], 'ob-new-title': ['form', 'ph-title'], 'ob-ph-mode': ['form', 'ph-mode'],
  'ob-new-mode': ['form', 'ph-mode'], 'ob-ph-note': ['form', 'ph-note'], 'ob-g-title': ['form', 'g-title'], 'ob-g-owner': ['form', 'g-owner'], 'ob-g-approves': ['form', 'g-approves'],
  'ob-tr-title': ['form', 'tr-title'], 'ob-tr-role': ['form', 'tr-role'], 'ob-owner': ['form', 'owner'], 'ob-backup': ['form', 'backup'], 'ob-add-role': ['form', 'role'],
  'ob-add-ctx': ['form', 'context'], 'ob-q-text': ['form', 'questions'], 'ob-fld-': ['field', null], 'ob-host': ['form', 'pr-host']
};
/* Not entry boxes: finding a part, choosing a type or a kind (radios with their own descriptions), choosing files. */
const NOT_BOXES = { 'ob-part-q': 1, 'ob-part-q2': 1, 'ob-type': 1, 'ob-new-type': 1, 'ob-shot-file': 1, 'ob-mark-': 1 };
rule('Guide: every input, textarea and select the editor draws has its guide entry, the Questions box included', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'views', 'builder.js'), 'utf8');
  const ids = new Set();
  for (const m of src.matchAll(/<(?:input|textarea|select)\b[^>]*?\bid="([^"]*?)(?:"|' \+)/g)) ids.add(m[1]);
  for (const m of src.matchAll(/<(?:input|textarea|select)\b[^>]*?\bid="' \+ (\w+) \+/g)) ids.add('var:' + m[1]);
  /* 2.6.0: the other forms draw their boxes through formBox, formSelect, personSelect and choices, each naming its entry. */
  const named = [...src.matchAll(/(?:formBox|formSelect|personSelect)\(ctx, '([\w-]+)', '([\w-]+)'/g), ...src.matchAll(/choices\(ctx, '([\w-]+)', G\.form\('([\w-]+)'\)/g)];
  named.forEach(m => { ids.add(m[1]); entry(G.form(m[2])); });
  assert.ok(ids.has('ob-q-text') && ids.has('ob-ph-mode') && ids.has('ob-owner'), 'set-up: the Questions box, phase mode and owner are found');
  ids.delete('');
  const left = [...ids].filter(id => {
    if (/^var:/.test(id)) return !['var:id', 'var:addId'].includes(id);
    const key = Object.keys(BOX).find(k => id === k || (k.endsWith('-') && id.startsWith(k))), not = Object.keys(NOT_BOXES).find(k => id === k || (k.endsWith('-') && id.startsWith(k)));
    if (not) return false;
    if (!key) return true;
    const [kind, name] = BOX[key];
    if (kind !== 'field') entry(G[kind](name));
    return false;
  });
  same(left, [], 'boxes without a guide entry');
});

/* ---------- the examples are values their own controls accept ---------- */
function oneStep(type, lines) {
  return '---\nprocess: guide-check\ntitle: Guide check\ncontext: tag, environment, hotfix\nroles: release-manager\n---\n\n## Do it · READ-DO {#do}\n- [ ] {' + type + '} The step {#s1}\n' + lines.map(l => '  ' + l).join('\n') + '\n';
}
const quiet = (map, f) => M.check(map, { people, types: EX.customTypes }).blockers.concat(M.check(map, { people, types: EX.customTypes }).suggestions).concat(map.errors.map(e => e.msg)).filter(m => m.indexOf('"' + f + '"') >= 0 || m.indexOf(f + ':') >= 0);
rule('Guide: each checklist-field example, written into a one-step checklist, reads with no error or tip about that field', () => {
  let n = 0;
  const check = (type, f, eg, also) => {
    const md = oneStep(type, (also || []).concat([f + ': ' + eg])), map = M.parse(md);
    same(quiet(map, f), [], type + ' · ' + f + ' = ' + eg);
    assert.strictEqual((M.findStep(map, 's1').step.fields || {})[f], eg, type + ' · ' + f + ' is read as written');
    n++;
  };
  T.LIST.forEach(t => {
    /* A field asked for only for one action is checked with that action. */
    Object.keys(t.fields).forEach(f => {
      const d = t.fields[f], x = G.FIELDS[t.id][f]; if (!x.eg) return;
      const also = d.requiredWhen ? Object.keys(d.requiredWhen).map(k => k + ': ' + d.requiredWhen[k]) : t.fields.action && f !== 'action' ? ['action: ' + t.fields.action.options[t.fields.action.options.length - 1]] : [];
      check(t.id, f, x.eg, also);
    });
  });
  Object.keys(T.COMMON).forEach(f => { const x = G.COMMON[f]; if (x.eg) check('confirm', f, x.eg); });
  check('run.process', 'version', G.FIELDS['run.process'].version.eg, ['process: database-migration']);
  check('run.skill', 'skillVersion', G.FIELDS['run.skill'].skillVersion.eg, ['skill: release-notes']);
  assert.ok(n >= 70, 'checked ' + n);
});
rule('Guide: each record example passes the type\'s own record check, and each evidence kind\'s passes its kind\'s', () => {
  let n = 0;
  T.LIST.forEach(t => t.record.forEach(d => {
    const x = G.RECORD[t.id][d.name]; if (!x.eg) return;
    const fields = Object.assign({}, d.when || {});
    const res = T.checkRecord(t, fields, { [d.name]: x.eg }, true);
    assert.ok(!res.error && res.values[d.name] != null, t.id + ' ⏺ ' + d.name + ' = ' + x.eg + ': ' + res.error);
    n++;
  }));
  T.EVIDENCE_KINDS.forEach(k => {
    const x = G.EVIDENCE[k]; if (!x.eg) return;
    const res = T.checkRecord(T.get('confirm'), { evidence: k }, { evidence: x.eg }, false);
    assert.ok(!res.error, 'evidence ' + k + ' = ' + x.eg + ': ' + res.error); n++;
  });
  assert.ok(n >= 30, 'checked ' + n);
});
const DRAFT = '---\nprocess: forms\ntitle: Forms\ncontext: environment:choice(staging|production), hotfix:yes-no\n---\n\n## Deploy · READ-DO {#deploy}\n- [ ] {confirm} Tag the release {#tag}\n\n### Track: Lane one {#lane}\n- [ ] {confirm} In the lane {#inlane}\n\n## Gate: Ready {#ready}\n';
rule('Guide: each other-forms example applies through the operation its box calls, with no refusal', () => {
  const o = O.parse(DRAFT), ph = o.phases[0], st = o.steps[0], ok = (res, what) => assert.ok(res && !res.error, what + ': ' + (res && res.error));
  ok(O.caption(G.form('caption').eg), 'caption');
  ok(O.apply(DRAFT, { op: 'meta', key: 'roles', set: { add: G.form('role').eg } }), 'role');
  ok(O.apply(DRAFT, { op: 'meta', key: 'context', set: { add: G.form('context').eg } }), 'run detail');
  ok(O.editPhase(DRAFT, ph.key, { title: G.form('ph-title').eg }), 'phase name');
  ok(O.setGate(DRAFT, ph.key, { title: G.form('g-title').eg }), 'gate name');
  ok(O.setGate(DRAFT, ph.key, { approves: G.form('g-approves').eg }), 'gate approves');
  assert.ok(ph.tracks.length && ph.gate, 'set-up: a lane and a gate');
  ok(O.editTrack(DRAFT, ph.key, 0, { title: G.form('tr-title').eg }), 'lane name');
  ok(O.apply(DRAFT, { op: 'when', step: st.key, text: G.form('when').eg }), 'step Only when');
  ok(O.apply(DRAFT, { op: 'when', phase: ph.key, text: G.form('ph-when').eg }), 'phase Only when');
  ok(O.editStep(DRAFT, st.key, { text: G.step('text').eg }), 'step text');
  ok(O.apply(DRAFT, { op: 'note', step: st.key, text: G.step('note').eg }), 'step note');
  ok(O.apply(DRAFT, { op: 'phaseNote', phase: ph.key, note: G.form('ph-note').eg }), 'phase note');
  ok(O.apply(DRAFT + '\n## Questions\n\n- Who signs off?\n', { op: 'questions', text: G.form('questions').eg }), 'questions');
});
rule('Guide: the process example is a file name the run finds by that exact ID, and the process\'s title isn\'t', () => {
  const eg = G.FIELDS['run.process'].process.eg, unpublished = name => PF.map.check(PF.map.parse(oneStep('run.process', ['process: ' + name])), { processes: [eg] }).suggestions.some(m => /isn't published yet/.test(m));
  assert.strictEqual(eg, 'database-migration');
  assert.strictEqual(unpublished(eg), false, 'the publish check finds it by its ID');
  assert.strictEqual(unpublished('Database migration'), true, 'not by its title');
  assert.ok(PF.map.PROCESS_ID.test(eg), 'and it is a process ID');
});

/* ---------- whys: what they claim is what the code does, and each ends with what empty means ---------- */
rule('Guide: every why ends with its empty-box sentence, from the definition and from the record definition in effect', () => {
  const TL = G.TAILS;
  T.LIST.forEach(t => Object.keys(t.fields).forEach(f => {
    const x = G.FIELDS[t.id][f], got = G.field(t, f, {}).why;
    if (x.own) { assert.strictEqual(got, x.why, t.id + ' · ' + f + ' keeps its own words'); return; }
    const want = G.usual(t.fields[f], {}) ? TL.usual : TL.optional;
    assert.ok(got.endsWith(want) && got.startsWith(x.why), t.id + ' · ' + f + ': ' + got);
  }));
  /* An action changes which fields are usual: Jira's project is usual only to create. */
  assert.ok(G.field(T.get('jira.issue'), 'project', { action: 'create' }).why.endsWith(TL.usual));
  assert.ok(G.field(T.get('jira.issue'), 'project', { action: 'update' }).why.endsWith(TL.optional));
  assert.ok(G.field(T.get('jira.issue'), 'issue', { action: 'update' }).why.endsWith(TL.usual), 'issue is usual unless creating');
  ['carry', 'version'].forEach(f => assert.strictEqual(G.field(T.get('run.process'), f, {}).why, G.FIELDS['run.process'][f].why, f + ' says what empty means itself'));
  assert.strictEqual(G.field(T.get('run.skill'), 'skillVersion', {}).why, G.FIELDS['run.skill'].skillVersion.why);
  Object.keys(T.COMMON).forEach(f => assert.ok(G.field(T.get('confirm'), f, {}).why.endsWith(TL.optional), 'common ' + f));
  /* Record fields: needed exactly when the run would require them, through R.evidenceFor. */
  const recFor = (md, id) => { const b = publish(md), r = R.create(b, { title: 'T', details: {}, roles: {}, by: 'person-casey', session: 's', now: NOW, id: 'g1' }), map = R.mapOf(r), st = M.findStep(map, id).step; return R.evidenceFor(r, st, R.fieldsOf(r, st), map).list.map(d => ({ d, g: G.record(T.get(st.type, r.types), d, R.fieldsOf(r, st)) })); };
  const base = '---\nprocess: rec\ntitle: Rec\ncontext: tag\n---\n\n## One · READ-DO {#one}\n';
  const req = recFor(base + '- [ ] {jenkins.job} Build {#b}\n  job: release\n  require: build\n', 'b');
  same(req.map(x => [x.d.name, x.g.why.endsWith(G.TAILS.needed), x.g.why.endsWith(G.TAILS.maybe)]), [['build', true, false], ['buildLink', false, true]], 'require: names one');
  const ev = recFor(base + '- [ ] {confirm} Pods up {#p}\n  evidence: number\n', 'p');
  same(ev.map(x => [x.d.name, x.g.q, x.g.why.endsWith(G.TAILS.needed)]), [['evidence', 'Which number?', true]], 'evidence: asks for its kind');
  const none = recFor(base + '- [ ] {run.command} Rebase {#c}\n  command: git rebase\n', 'c');
  same(none.map(x => [x.d.name, x.g.why.endsWith(G.TAILS.maybe)]), [['result', true]], 'neither: optional unless required');
  const all = recFor(base + '- [ ] {jenkins.job} Build {#b}\n  job: release\n  require: all\n', 'b');
  assert.ok(all.every(x => x.g.why.endsWith(G.TAILS.needed)), 'require: all');
  const sets = recFor(base + '- [ ] {confirm} Tag it {#t}\n  sets: tag\n', 't');
  same(sets.map(x => [x.g.q, x.g.why.endsWith(G.TAILS.needed), /use it as \^tag/.test(x.g.why)]), [['What\'s the ^tag?', true, true]], 'a run detail it sets');
  Object.keys(G.FORMS).forEach(k => assert.strictEqual(G.form(k).why, G.FORMS[k].why, k + ': its own words, nothing added'));
  ['text', 'roles', 'binds', 'note'].forEach(k => assert.strictEqual(G.step(k).why, G.STEP[k].why, k));
});
function publish(md) { const b = P.build(md, { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'guide001' }); assert.ok(b.folder, 'set-up: publishes: ' + JSON.stringify(b.errors || b.blockers)); return P.verify(b.folder, b.files, exactOf(PF, b.files)); }

rule('Guide: whys claim only what the code does: receipts print evidence, briefs print checklist fields, Copy is on code and messages, links open, ^name is for what sets a detail', () => {
  const allRows = [];
  T.LIST.forEach(t => {
    Object.keys(t.fields).forEach(f => allRows.push({ where: 'field', t, f, d: t.fields[f], x: G.FIELDS[t.id][f] }));
    t.record.forEach(d => allRows.push({ where: 'record', t, f: d.name, d, x: G.RECORD[t.id][d.name] }));
  });
  Object.keys(T.COMMON).forEach(f => allRows.push({ where: 'common', f, d: T.COMMON[f], x: G.COMMON[f] }));
  T.EVIDENCE_KINDS.forEach(k => allRows.push({ where: 'record', f: 'evidence', d: { kind: k }, x: G.EVIDENCE[k] }));
  Object.keys(G.FORMS).forEach(k => allRows.push({ where: 'form', f: k, x: G.FORMS[k] }));
  Object.keys(G.STEP).forEach(k => allRows.push({ where: 'step', f: k, x: G.STEP[k] }));
  allRows.forEach(({ where, t, f, d, x }) => {
    const tag = (t ? t.id + ' · ' : where + ' · ') + f, w = x.why;
    if (/receipt/.test(w) && !(where === 'step' && f === 'text')) assert.strictEqual(where, 'record', tag + ': only what is recorded goes on the receipt');
    if (/assistant/.test(w)) assert.strictEqual(where, 'field', tag + ': only checklist fields go into the brief');
    if (/Copy button/.test(w)) assert.ok(d && (d.kind === 'code' || d.kind === 'message'), tag + ': Copy is only on code and messages');
    if (/^Opens from the step/.test(w)) assert.ok(d && d.kind === 'url', tag + ': only a link opens');
    if (/use it as \^/.test(w)) assert.ok(f === 'sets' || f === 'context', tag + ': only a detail a step sets, or the run details themselves');
  });
  /* The mechanisms themselves. A recorded value is on the receipt and a checklist field isn't; the brief has the field. */
  const md = '---\nprocess: claim\ntitle: Claim\n---\n\n## One · READ-DO {#one}\n- [ ] {jenkins.job} Build it {#b}\n  job: release/build-and-test\n  parameters: BRANCH=main\n';
  const pub = publish(md), r = R.create(pub, { title: 'T', details: {}, roles: {}, by: 'person-casey', session: 's', now: NOW, id: 'claim1' }), map = R.mapOf(r);
  R.done(r, map, 'b', 'person-casey', NOW, { build: '412' });
  const rc = R.receipt(r, map, id => id, NOW, []);
  assert.ok(/412/.test(rc) && !/release\/build-and-test/.test(rc), 'the receipt prints evidence, not checklist fields');
  const brief = PF.skills.createBrief(pub, null, PF.skills.readiness([], pub, null), []);
  assert.ok(/release\/build-and-test/.test(brief), 'the brief prints checklist fields');
  /* The gate owner is shown, not enforced: passing isn't limited to the owner. */
  const gw = G.form('g-owner').why;
  assert.ok(/shows on the gate as its owner/.test(gw) && /Whoever passes it in the run is recorded/.test(gw) && !/only the owner|can pass it/i.test(gw), gw);
});

rule('Guide: an empty caption is refused on add and on edit; a step with no Only when in a skipped stage, and a stage whose steps are all skipped, are Not needed', () => {
  const md = '---\nprocess: shots\ntitle: Shots\ncontext: hotfix\n---\n\n## One · READ-DO {#one}\n- [ ] {confirm} Look {#look}\n  ![The button](images/a.png)\n';
  const o = O.parse(md), key = o.steps[0].key;
  const add = O.editShots(md, key, { add: { caption: '', src: 'images/b.png' } }), edit = O.editShots(md, key, { edit: 0, caption: '' });
  assert.ok(/Write a caption first/.test(add.error || '') && /Write a caption first/.test(edit.error || ''), 'refused: ' + add.error + ' / ' + edit.error);
  assert.ok(/a screenshot can't be added or kept without one/.test(G.form('caption').why));
  const cond = '---\nprocess: conds\ntitle: Conds\ncontext: hotfix:yes-no, risk:choice(low|high)\n---\n\n## Hotfix · READ-DO {#hot}\n  only when ^hotfix is yes\n- [ ] {confirm} Plain step {#plain}\n\n## Review · READ-DO {#rev}\n- [ ] {confirm} Board {#board}\n  only when ^risk is high\n';
  const pub = publish(cond), r = R.create(pub, { title: 'T', details: { hotfix: 'no', risk: 'low' }, roles: {}, by: 'person-casey', session: 's', now: NOW, id: 'cond1' }), map = R.mapOf(r);
  const ap = id => { const x = M.findStep(map, id); return R.applies(r, map, x.phaseIndex, x.step); };
  assert.ok(ap('plain').applies === false, 'a step with no Only when, in a stage that is skipped: ' + JSON.stringify(ap('plain')));
  assert.ok(ap('board').applies === false, 'set-up: the only step in Review is skipped');
  assert.ok(!map.phases[1].when && R.applies(r, map, 1).applies === false, 'a stage with no Only when whose steps are all skipped is Not needed');
  assert.ok(/still Not needed when every step in it is/.test(G.form('ph-when').why) && /its stage's conditions still apply/.test(G.form('when').why));
});

/* ---------- core ---------- */
rule('T.applies: no condition applies; requiredWhen only when it matches; requiredUnless unless it matches; case doesn\'t matter', () => {
  const J = T.get('jira.issue'), GH = T.get('github.pr');
  assert.strictEqual(T.applies(J, 'issueType', {}), true);
  assert.strictEqual(T.applies(J, 'project', { action: 'create' }), true);
  assert.strictEqual(T.applies(J, 'project', { action: 'CREATE' }), true, 'case-insensitive');
  assert.strictEqual(T.applies(J, 'project', { action: 'update' }), false);
  assert.strictEqual(T.applies(J, 'issue', { action: 'create' }), false, 'requiredUnless: not to create');
  assert.strictEqual(T.applies(J, 'issue', { action: 'link' }), true);
  assert.strictEqual(T.applies(GH, 'pull', { action: 'open' }), false);
  assert.strictEqual(T.applies(GH, 'pull', { action: 'merge' }), true);
  assert.strictEqual(T.applies(J, 'link', {}), true, 'a field every type accepts');
  assert.strictEqual(T.applies(T.get('run.process'), 'version', {}), true, 'a pin');
  assert.strictEqual(T.applies(J, 'nope', {}), false, 'a field the type doesn\'t have');
  /* The run's own list is unchanged: Fill in still shows issue for a create. */
  assert.ok(T.relevant(J, { action: 'create' }).indexOf('issue') >= 0, 'T.relevant is unchanged');
});
rule('Guide: the type definitions, the fields every type accepts and the pins are exactly 2.4.0\'s', () => {
  const was = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'entry-boxes', 'types-2.4.0.json'), 'utf8'));
  same(T.LIST, was.LIST, 'T.LIST'); same(T.COMMON, was.COMMON, 'T.COMMON'); same(T.PINS, was.PINS, 'pins');
});
rule('Guide: the example folder\'s publication files, signatures, brief, read contract, receipt and run log are byte for byte 2.4.0\'s', () => {
  const was = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'entry-boxes', 'golden-2.4.0.json'), 'utf8')), now = golden(H);
  Object.keys(was).forEach(id => Object.keys(was[id]).forEach(k => same(now[id][k], was[id][k], id + ' · ' + k)));
  same(Object.keys(now).sort(), Object.keys(was).sort());
});

/* ---------- the run screen's entry forms ---------- */
function runOf(md, details) {
  const pub = publish(md), r = R.create(pub, { title: 'T', details: details || {}, roles: {}, by: 'person-casey', session: 'me', now: NOW, id: 'rs1', workflows: EX.workflows });
  r._notes = []; r._conflicts = [];
  return r;
}
function screen(r, stateExtra) {
  const state = Object.assign({ view: 'run', me: 'person-casey', sel: null, refOpen: true, pick: null, edit: null, unfold: {}, msg: null, pendingFiles: [], unsaved: {}, saveErr: {}, startMode: {}, archive: {}, keys: true, fs: { kind: 'memory', name: 'x' }, fieldErr: null, showRoles: false, copyView: null }, stateExtra || {});
  const ctx = { state, canFolder: true, data: { people, validations: [], processes: [], runs: [r], plans: [], drafts: [], skills: [], legacy: [], readAt: NOW }, now: () => Date.parse(NOW), peopleById: Object.fromEntries(people.map(p => [p.id, p])),
    run: () => r, recording: x => !x.ended, attachments: () => [], canRecover: () => true, processTitle: id => id, processes: () => [], findRun: () => null, latestPub: () => null, suggestRole: () => null, localCopy: () => null, img: () => '<img src="blob:test">' };
  return V.run(ctx);
}
const BUILD = '---\nprocess: rs\ntitle: RS\n---\n\n## One · READ-DO {#one}\n- [ ] {jenkins.job} Build it {#b}\n  job: release/build-and-test\n  page: https://jenkins.acme.com/job/release\n  require: build\n';
const labelOf = (html, id) => { const m = new RegExp('<label[^>]*for="' + id + '"[^>]*>([\\s\\S]*?)</label>').exec(html); return m ? m[1].replace(/<[^>]+>/g, '') : null; };
rule('Run screen: the record form asks the guide\'s question, shows its example and why, and keeps "(optional)"; ids are unchanged', () => {
  const r = runOf(BUILD), html = screen(r, { sel: 'b' });
  assert.strictEqual(labelOf(html, 'rec-build'), 'Which build number?', 'question as the label');
  assert.strictEqual(labelOf(html, 'rec-buildLink'), 'Link to the build (optional)', 'with its suffix');
  assert.ok(/id="rec-build"[^>]*placeholder="412"/.test(html), 'example as the placeholder');
  assert.ok(/id="rec-buildLink"[^>]*placeholder="https:\/\/jenkins\.acme\.com\/job\/release\/412"/.test(html), 'a link\'s example replaces "https://"');
  const why = /<span class="small hint" id="hint-rec-build">([^<]*)<\/span>/.exec(html);
  assert.ok(why && why[1] === 'Saved in the run and on its receipt. Needed to check the step.', 'why under the box: ' + (why && why[1]));
  assert.ok(/id="rec-build"[^>]*aria-describedby="hint-rec-build"/.test(html), 'tied to its box');
});
rule('Run screen: a typed record box shows its example too: a number as its placeholder, a date (which shows none) in its why', () => {
  const box = k => { const html = screen(runOf('---\nprocess: ev\ntitle: Ev\n---\n\n## One · READ-DO {#one}\n- [ ] {confirm} Look {#l}\n  evidence: ' + k + '\n'), { sel: 'l' }); const m = /<input[^>]*id="(rec-[^"]+)"[^>]*>/.exec(html); assert.ok(m, k + ': its box'); return { tag: m[0], hint: (new RegExp('id="hint-' + m[1] + '">([^<]*)<').exec(html) || [])[1] || '' }; };
  const n = box('number'), d = box('date');
  assert.ok(/inputmode="decimal"/.test(n.tag) && new RegExp('placeholder="' + G.EVIDENCE.number.eg + '"').test(n.tag), n.tag);
  assert.ok(/type="date"/.test(d.tag) && !/placeholder=/.test(d.tag), d.tag);
  assert.ok(d.hint.indexOf('For example, ' + G.EVIDENCE.date.eg + '.') === 0, d.hint);
});
rule('Run screen: Fill in asks each field\'s question with its example and why, and keeps "(checklist says: X)"', () => {
  const r = runOf(BUILD), map = R.mapOf(r);
  R.setFields(r, map, 'b', { job: 'release/other' }, null, 'person-casey', NOW);
  const html = screen(r, { sel: 'b', pick: { kind: 'fields', id: 'b' } });
  assert.strictEqual(labelOf(html, 'fld-job'), 'Which job? (checklist says: release/build-and-test)');
  assert.strictEqual(labelOf(html, 'fld-stage'), 'Which stage do you watch?');
  assert.ok(new RegExp('id="fld-parameters"[^>]*placeholder="' + G.FIELDS['jenkins.job'].parameters.eg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '"').test(html), 'parameters, with its example');
  assert.ok(/<span class="small hint" id="hint-fld-stage">Shown with the step to whoever does it, and to an assistant doing it\. Optional\. Left empty, it isn(?:'|&#39;)t shown\.<\/span>/.test(html), 'why line');
  assert.ok(/id="fld-stage"[^>]*placeholder="Integration tests"/.test(html), 'example');
});
rule('Run screen: a Jira workflow\'s hint stays, with the why after it; a team type keeps its own labels', () => {
  const b = P.build(example('maps/drafts/release.md'), { people, ...EX, by: 'person-avery', changes: 'First', existing: [], now: NOW, rand: 'view0002' });
  const r = R.create(P.verify(b.folder, b.files, exactOf(PF, b.files)), { title: 'T', details: { ticket: 'ABC-1', commit: 'c0ffee1', environment: 'production' }, roles: { 'release-lead': 'person-casey', qa: 'person-blake', backend: 'person-avery' }, by: 'person-casey', session: 'me', now: NOW, workflows: EX.workflows });
  r._notes = []; r._conflicts = [];
  const html = screen(r, { unfold: { verify: true }, pick: { kind: 'fields', id: 'close' } });
  assert.ok(/The release name on the board/.test(html), 'the workflow\'s hint is kept');
  const team = screen(r, { sel: 'approved' });
  assert.ok(/for="rec-[^"]*"[^>]*>[^<]*(Change|number|Number)/.test(team), 'set-up: the team type\'s record box');
  assert.ok(!/Which build number\?/.test(team));
});
rule('Run screen: What to do names each kind of proof: a link, a note, a number, a yes or no, a date', () => {
  const kinds = { link: 'a link', note: 'a note', number: 'a number', 'yes-no': 'a yes or no', date: 'a date' };
  Object.keys(kinds).forEach(k => {
    const r = runOf('---\nprocess: ev\ntitle: Ev\n---\n\n## One · READ-DO {#one}\n- [ ] {confirm} Look {#l}\n  evidence: ' + k + '\n');
    const html = screen(r, { sel: 'l' });
    assert.ok(html.indexOf('<b>Evidence:</b> ' + kinds[k]) >= 0, k + ': ' + (/<b>Evidence:<\/b>[^<]*/.exec(html) || [''])[0]);
  });
});
rule('Run screen: the run log and the recorded chips still use the labels', () => {
  const r = runOf(BUILD), map = R.mapOf(r);
  R.setFields(r, map, 'b', { stage: 'Integration tests' }, null, 'person-casey', NOW);
  assert.ok(r.log.some(l => /Filled in Watch for/.test(l.what)), 'the log names the label');
  R.done(r, map, 'b', 'person-casey', NOW, { build: '412' });
  const html = screen(r, { sel: 'b' });
  assert.ok(/<b>Build number:<\/b> 412/.test(html), 'the recorded value is shown under its label');
});

run();
