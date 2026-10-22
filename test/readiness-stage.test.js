// Readiness and sign-offs from test runs (2.1 slice 6). A promoted version counts the clean test runs and the stage sign-offs
// (flightdeck-validation/2) of the stage it was made from only by the payload rule: its stagedFrom names that stage, the stage
// verifies, and the version's exact bytes are the stage's (a /2 version also by P.payloadHash). Only finished test runs on the
// stage's exact payload count, and only sign-offs by the owner (or the backup owner as backup) on that payload. They stay
// labeled, and nothing from a test run ever counts for any other version.
'use strict';
const assert = require('assert');
const fsN = require('fs'), path = require('path');
const { load, example, exampleSetup, rule, run, completeRun } = require('./harness');
const PF = load(), P = PF.publish, R = PF.run, S = PF.skills, repo = PF.repo;
const EX = exampleSetup(PF);
const NOW = '2026-10-22T09:00:00.000Z', LATER = '2026-10-22T11:00:00.000Z';
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const FIX = path.join(__dirname, 'fixtures', 'v2', 'folder');
const SAMPLE = fsN.readFileSync(path.join(FIX, 'validations', 'backup.stage-aaaa1111.w-twozero.json'), 'utf8');
const STAGE_INFO = JSON.parse(fsN.readFileSync(path.join(FIX, 'staged', 'backup', 'stage-aaaa1111', 'publication.json'), 'utf8'));
const people = JSON.parse(example('people.json'));
/* Release without its linked-run step: a test run starts no linked runs (slice 5), so a checklist with one never has a clean
   test run (see the rule below). */
const MD = example('maps/drafts/release.md').replace(/- \[ \] \{run\.process\}[^\n]*\n(  [^\n]*\n)*/, '');
const CHANGED = MD.replace('Smoke prompts return', 'Smoke prompts all return');
const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- The stage sign-off record ---------- */

rule('The frozen stage sign-off reads exactly: its stage, the proposed number, the payload fingerprint, who and when', () => {
  const c = S.cleanValidation(Object.assign(JSON.parse(SAMPLE), { _file: 'backup.stage-aaaa1111.w-twozero.json' }));
  assert.ok(c.ok, c.why);
  same([c.rec.process, c.rec.stage, c.rec.proposed, c.rec.payload, c.rec.by, c.rec.at, c.rec.note, c.rec.folder], ['backup', 'stage-aaaa1111', 3, JSON.parse(SAMPLE).payload, 'person-avery', '2026-10-20T09:00:00.000Z', 'Two clean test runs', '']);
  assert.strictEqual(S.stagePayloadHash(STAGE_INFO), JSON.parse(SAMPLE).payload, 'the payload fingerprint is the stage\'s, as the frozen sample has it');
});

rule('Any other shape of a stage sign-off is never counted: named as unreadable, never as a newer one', () => {
  const base = JSON.parse(SAMPLE), file = 'backup.stage-aaaa1111.w-twozero.json';
  const bad = {
    'stage with an extra key': Object.assign({}, base, { stage: { folder: 'stage-aaaa1111', proposed: 3, x: 1 } }),
    'stage that isn\'t a stage folder': Object.assign({}, base, { stage: { folder: 'v3-aaaa1111', proposed: 3 } }),
    'proposed 0': Object.assign({}, base, { stage: { folder: 'stage-aaaa1111', proposed: 0 } }),
    'payload that isn\'t a SHA-256': Object.assign({}, base, { payload: 'abc' }),
    'no by': (() => { const o = Object.assign({}, base); delete o.by; return o; })(),
    'an unknown field': Object.assign({}, base, { extra: 1 }),
    'a kind': Object.assign({}, base, { kind: 'validation' }),
    'a folder': Object.assign({}, base, { folder: 'v3-aaaa1111' })
  };
  Object.keys(bad).forEach(name => {
    const c = S.cleanValidation(Object.assign(clone(bad[name]), { _file: file }));
    assert.ok(!c.ok && c.kind !== 'newer', name + ': ' + JSON.stringify(c));
  });
  const elsewhere = S.cleanValidation(Object.assign(clone(base), { _file: 'release.stage-aaaa1111.w-twozero.json' }));
  assert.ok(!elsewhere.ok, 'a file named for another process or stage isn\'t this sign-off');
  assert.ok(!S.cleanValidation(Object.assign(clone(base), { _file: 'backup.stage-bbbb2222.w-twozero.json' })).ok);
  const v3 = S.cleanValidation(Object.assign(clone(base), { format: 'flightdeck-validation/3', _file: file }));
  assert.ok(!v3.ok && v3.kind === 'newer', 'a newer major is still newer');
});

rule('A stage sign-off is written in the frozen shape, under validations/<process>.<stage>.<window>.json', () => {
  const stage = { ok: true, folder: 'stage-aaaa1111', process: 'backup', info: STAGE_INFO };
  const s = S.stageSignoff(stage, { window: 'w-twozero', by: 'person-avery', at: '2026-10-20T09:00:00.000Z', note: 'Two clean test runs', evidence: { completed: 2, clean: 2, runs: ['run-t'] }, app: '2.0.0' });
  assert.strictEqual(s.path, 'validations/backup.stage-aaaa1111.w-twozero.json');
  assert.strictEqual(s.text, SAMPLE, 'byte for byte the frozen sample');
  const b = S.stageSignoff(stage, { window: 'w-x', by: 'person-blake', at: NOW, note: '', evidence: { completed: 3, clean: 3, runs: ['a', 'b', 'c'] }, as: 'backup', app: '2.1.0' });
  same(Object.keys(JSON.parse(b.text)).slice(-1), ['as'], 'a backup owner\'s says so, last');
  assert.ok(S.cleanValidation(Object.assign(JSON.parse(b.text), { _file: 'backup.stage-aaaa1111.w-x.json' })).rec.as === 'backup');
});

/* ---------- The payload rule ---------- */

const ONE_STAGE = (() => { const i = clone(STAGE_INFO); i.payload.pins = {}; return { ok: true, folder: 'stage-aaaa1111', process: 'backup', info: i }; })();
const exactOf1 = (st) => ({ 'map.md': st.info.payload.map, 'types.json': st.info.payload.types, images: clone(st.info.payload.images) });
const pub1 = (st, o) => ({ ok: true, info: Object.assign({ format: 'preflight-publication/1', process: 'backup', version: 3, folder: 'v3-prom0001', images: clone(st.info.images), payload: clone(st.info.payload), stagedFrom: { folder: st.folder, at: st.info.stagedAt } }, o || {}) });

rule('A /1 promotion carries its stage only when its exact bytes are the stage\'s, one part at a time', () => {
  const st = ONE_STAGE, ok = exactOf1(st);
  assert.strictEqual(S.carries(pub1(st), st, ok), '', 'exact bytes equal');
  const tweak = (fn) => { const e = clone(ok); fn(e); return S.carries(pub1(st), st, e); };
  assert.ok(tweak(e => { e['map.md'] = sha('other'); }), 'the checklist\'s bytes');
  assert.ok(tweak(e => { e['types.json'] = sha('other'); }), 'the step types\' bytes');
  assert.ok(tweak(e => { e.images['images/scratch.png'] = sha('other'); }), 'a screenshot');
  assert.ok(tweak(e => { delete e.images['images/counts.png']; }), 'a screenshot missing');
  assert.ok(tweak(e => { e.images['images/extra.png'] = sha('x'); }), 'a screenshot more');
  assert.ok(S.carries(pub1(st), st, null), 'bytes not read: never assumed');
  const pinned = clone(st); pinned.info.payload.pins = { children: { x: { process: 'verify', version: 4, folder: 'v4-cccc4444' } } };
  assert.ok(S.carries(pub1(pinned), pinned, exactOf1(pinned)), 'a stage with pins a /1 version can\'t carry');
  const ext = clone(st); ext.info.payload.extensions = { team: 'abc' };
  assert.ok(S.carries(pub1(ext), ext, exactOf1(ext)), 'a stage with an extension');
  assert.ok(S.carries(pub1(st, { stagedFrom: { folder: 'stage-bbbb2222', at: NOW } }), st, ok), 'stagedFrom naming another stage');
  assert.ok(S.carries(pub1(st, { stagedFrom: undefined }), st, ok), 'no stagedFrom');
  assert.ok(S.carries(pub1(st, { process: 'release' }), st, ok), 'another process');
  assert.ok(S.carries(pub1(st), Object.assign({}, st, { ok: false, why: 'x' }), ok), 'a stage that doesn\'t verify');
  assert.ok(S.carries(Object.assign(pub1(st), { ok: false }), st, ok), 'a version that doesn\'t verify');
});

rule('A /2 promotion carries its stage only when its payload is the stage\'s by P.payloadHash, and its bytes are', () => {
  const st = { ok: true, folder: 'stage-aaaa1111', process: 'backup', info: STAGE_INFO }, ok = exactOf1(st);
  const pub2 = (pl) => ({ ok: true, info: { format: 'preflight-publication/2', features: ['pinned-children'], process: 'backup', version: 3, folder: 'v3-prom0002', images: clone(STAGE_INFO.images), payload: pl, stagedFrom: { folder: 'stage-aaaa1111', at: NOW } } });
  assert.strictEqual(S.carries(pub2(clone(STAGE_INFO.payload)), st, ok), '');
  const reordered = {}; Object.keys(STAGE_INFO.payload).reverse().forEach(k => { reordered[k] = clone(STAGE_INFO.payload[k]); });
  assert.strictEqual(S.carries(pub2(reordered), st, ok), '', 'key order doesn\'t matter');
  const otherPin = clone(STAGE_INFO.payload); otherPin.pins.children.verify.folder = 'v4-dddd5555';
  assert.ok(S.carries(pub2(otherPin), st, ok), 'a pin to another folder with the same number');
  const otherSkill = clone(STAGE_INFO.payload); otherSkill.pins.skills.report.version = '1.2.1';
  assert.ok(S.carries(pub2(otherSkill), st, ok), 'a skill pin');
  const otherExt = clone(STAGE_INFO.payload); otherExt.extensions = { team: 'abc' };
  assert.ok(S.carries(pub2(otherExt), st, ok), 'an extension');
});

/* ---------- Readiness ---------- */

function folder() {
  const fs = new PF.fs.MemoryFS('ready:' + Math.random(), null);
  fs.reset({ 'people.json': example('people.json'), 'maps/drafts/release.md': MD });
  return fs;
}
const opts = (o) => Object.assign({ people, ...EX, by: 'person-avery', changes: 'Try the new smoke test', now: NOW, app: '2.1.0' }, o || {});
async function staged(fs) {
  const res = await repo.publish(fs, MD, opts({ changes: 'First version', existing: [] }));
  assert.ok(!res.blockers, String(res.blockers));
  const d = await repo.loadAll(fs), p = d.processes[0];
  const st = await repo.stage(fs, CHANGED, opts({ existing: p.pubs.map(x => ({ version: P.versionOf(x.folder) || 0 })), rand: 'abcd1234' }));
  assert.ok(st && !st.blockers, JSON.stringify(st));
  return repo.readStage(fs, 'release', 'stage-abcd1234');
}
const ROLES = { 'release-lead': 'person-avery', qa: 'person-blake', backend: 'person-casey' };
const testRun = (stage, i, o) => R.create(stage, Object.assign({ test: true, title: 'Try ' + i, id: 'run-try' + i, details: { ticket: 'T', commit: 'c', environment: 'p' }, roles: ROLES, by: 'person-avery', session: 'w', now: NOW, app: '2.1.0' }, o || {}));
async function promoted(fs, stage) {
  await repo.promote(fs, 'release', stage.folder, { by: 'person-casey', now: LATER, app: '2.1.0', rand: 'prom0001' });
  const d = await repo.loadAll(fs, { deep: true });
  return { d, pub: d.processes[0].latest || d.processes[0].index.latest };
}

rule('loadAll marks a promoted version with the stage it carries; anything that breaks the payload rule says why', async () => {
  const fs = folder(), stage = await staged(fs);
  const { d, pub } = await promoted(fs, stage);
  assert.ok(pub.info.stagedFrom && pub.info.format === 'preflight-publication/1', 'set-up: a /1 promotion');
  same([pub.fromStage.folder, pub.fromStage.ok, pub.fromStage.why], ['stage-abcd1234', true, '']);
  const v1 = d.processes[0].pubs.find(x => x.info.version === 1);
  assert.ok(!v1.fromStage, 'a version not made from a stage carries none');
  /* Same text, other bytes: a byte-order mark in front of the promoted checklist. */
  const mp = 'publications/release/' + pub.info.folder + '/map.md';
  await fs.write(mp, '﻿' + fs.files[mp].t);
  const why = await repo.stageCarried(fs, pub, stage);
  assert.ok(/byte for byte/.test(why), 'the bytes are read, never the text: ' + why);
  const again = (await repo.loadAll(fs, { deep: true })).processes[0].pubs.find(x => x.info.folder === pub.info.folder);
  assert.ok(again && (!again.ok || (again.fromStage && !again.fromStage.ok)), 'never carried: ' + JSON.stringify(again && again.fromStage && again.fromStage.why));
});

rule('A promoted version counts the finished, clean test runs on its stage\'s exact payload, labeled; nothing else from a test run', async () => {
  const fs = folder(), stage = await staged(fs);
  const runs = [1, 2, 3].map(i => completeRun(PF, testRun(stage, i), NOW));
  const open = testRun(stage, 4);
  const stopped = Object.assign(completeRun(PF, testRun(stage, 5), NOW), {}); stopped.ended = { outcome: 'Stopped early', at: NOW };
  const otherPayload = completeRun(PF, testRun(stage, 6), NOW); otherPayload.payload = Object.assign({}, otherPayload.payload, { map: sha('x') });
  const readOnly = completeRun(PF, testRun(stage, 7), NOW); readOnly._unrunnable = 'x';
  const otherStage = completeRun(PF, testRun(stage, 8), NOW); otherStage.folder = 'stage-zzzz9999'; otherStage.stage = { folder: 'stage-zzzz9999' };
  const { pub, d } = await promoted(fs, stage);
  const all = runs.concat([open, stopped, otherPayload, readOnly, otherStage]);
  const rd = S.readiness(all, pub, null);
  same([rd.completed, rd.clean, rd.tests, rd.enough], [3, 3, 3, true], JSON.stringify(rd.deviations));
  assert.ok(rd.cleanRuns.every(t => /^Test run: Try [123]$/.test(t)), 'labeled: ' + rd.cleanRuns.join(', '));
  same(rd.cleanIds.sort(), ['run-try1', 'run-try2', 'run-try3']);
  /* Never for anything else: v1, the stage's own process with no stagedFrom, or a promotion that doesn't carry it. */
  const v1 = d.processes[0].pubs.find(x => x.info.version === 1);
  same([S.readiness(all, v1, null).completed, S.readiness(all, v1, null).tests], [0, 0]);
  const broken = Object.assign({}, pub, { fromStage: Object.assign({}, pub.fromStage, { ok: false, why: 'x' }) });
  same([S.readiness(all, broken, null).completed, S.readiness(all, broken, null).tests], [0, 0], 'a promotion that doesn\'t carry the stage counts none');
  same(S.readiness(all, Object.assign({}, pub, { fromStage: undefined }), null).completed, 0, 'not worked out: none');
});

rule('A test run with a deviation is counted as completed but not clean, labeled in the reasons', async () => {
  const fs = folder(), stage = await staged(fs);
  const r = completeRun(PF, testRun(stage, 1), NOW), map = R.mapOf(r), first = map.phases[0].steps[0].id;
  r.steps[first].differently = { note: 'By hand' };
  const { pub } = await promoted(fs, stage);
  const rd = S.readiness([r], pub, null);
  same([rd.completed, rd.clean, rd.tests], [1, 0, 0]);
  assert.ok(rd.deviations.some(x => /^Test run: Try 1$/.test(x.run)), JSON.stringify(rd.deviations));
});

rule('A stage\'s own readiness counts its test runs by the same rule, and real runs never count for a stage', async () => {
  const fs = folder(), stage = await staged(fs);
  const runs = [1, 2, 3].map(i => completeRun(PF, testRun(stage, i), NOW));
  const d = await repo.loadAll(fs), v1 = d.processes[0].index.latest;
  const real = completeRun(PF, R.create(v1, { title: 'Real', details: { ticket: 'T', commit: 'c', environment: 'p' }, roles: ROLES, by: 'person-avery', session: 'w', now: NOW, id: 'run-real' }), NOW);
  const rd = S.readiness(runs.concat([real]), stage, null);
  same([rd.completed, rd.clean, rd.tests, rd.enough], [3, 3, 3, true]);
  same(S.readiness(runs.concat([real]), v1, null).completed, 1, 'v1 counts only its real run');
});

/* ---------- Sign-offs ---------- */

rule('A stage sign-off counts for the promotion that carries the stage, by the owner or the backup owner as backup, on its payload', async () => {
  const fs = folder(), stage = await staged(fs);
  const { pub } = await promoted(fs, stage);
  const mk = (by, o) => S.cleanValidation(Object.assign(JSON.parse(S.stageSignoff(stage, Object.assign({ window: 'w-' + by, by, at: NOW, note: '', evidence: { completed: 3, clean: 3, runs: [] }, app: '2.1.0' }, o || {})).text), { _file: 'release.stage-abcd1234.w-' + by + '.json' })).rec;
  const owner = mk('person-casey'), stranger = mk('person-blake'), backup = mk('person-avery', { as: 'backup' }), backupNoAs = mk('person-avery');
  assert.ok(owner && stranger && backup && backupNoAs, 'set-up');
  same(S.signoffs([owner, stranger, backup, backupNoAs], pub).map(v => v.by + (v.as ? '/' + v.as : '')).sort(), ['person-avery/backup', 'person-casey']);
  assert.ok(S.signoffs([owner], pub).every(v => v.stage === 'stage-abcd1234'), 'labeled with its stage');
  same(S.signoffs([owner], stage).length, 1, 'and for the stage itself');
  same(S.signoffs([Object.assign({}, owner, { payload: sha('other') })], pub).length, 0, 'another payload');
  same(S.signoffs([Object.assign({}, owner, { stage: 'stage-zzzz9999' })], pub).length, 0, 'another stage');
  same(S.signoffs([Object.assign({}, owner, { proposed: 9 })], pub).length, 0, 'another proposed number');
  same(S.signoffs([owner], Object.assign({}, pub, { fromStage: Object.assign({}, pub.fromStage, { ok: false }) })).length, 0, 'a promotion that doesn\'t carry it');
  const d = await repo.loadAll(fs), v1 = d.processes[0].pubs.find(x => x.info.version === 1);
  same(S.signoffs([owner], v1).length, 0, 'never for another version');
});

rule('recordStageValidation writes the sign-off once per window, and loadAll reads it back counted for the promotion', async () => {
  const fs = folder(), stage = await staged(fs);
  await repo.recordStageValidation(fs, stage, { window: 'w-casey', by: 'person-casey', note: 'Three clean test runs', evidence: { completed: 3, clean: 3, runs: ['run-try1', 'run-try2', 'run-try3'] }, app: '2.1.0', now: NOW });
  const f = 'validations/release.stage-abcd1234.w-casey.json';
  assert.ok(fs.files[f] && JSON.parse(fs.files[f].t).format === 'flightdeck-validation/2');
  const { d, pub } = await promoted(fs, stage);
  const v = d.validations.filter(x => x.stage === 'stage-abcd1234');
  same(v.length, 1, 'read back');
  same(S.signoffs(d.validations, pub).map(x => x.by), ['person-casey']);
  same(d.refused.filter(x => /validations\//.test(x.path)).length, 0, 'never refused as newer here');
});

rule('A checklist with a linked-run step never has a clean test run: the step can\'t be checked in a test run', async () => {
  const fs = new PF.fs.MemoryFS('ready:' + Math.random(), null), full = example('maps/drafts/release.md');
  fs.reset({ 'people.json': example('people.json'), 'maps/drafts/release.md': full });
  await repo.publish(fs, full, opts({ changes: 'First version', existing: [] }));
  const d = await repo.loadAll(fs), p = d.processes[0];
  await repo.stage(fs, full.replace('Smoke prompts return', 'Smoke prompts all return'), opts({ existing: p.pubs.map(x => ({ version: P.versionOf(x.folder) || 0 })), rand: 'abcd1234' }));
  const stage = await repo.readStage(fs, 'release', 'stage-abcd1234'), r = testRun(stage, 1), map = R.mapOf(r);
  assert.ok(/test run doesn.t start linked runs/.test(R.canStartChild(r, map, 'notes')));
});

run();
